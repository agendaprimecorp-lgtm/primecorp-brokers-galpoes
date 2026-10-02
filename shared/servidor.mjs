// Utilitários compartilhados pelas functions (somente servidor).
import { getDatabase } from "@netlify/database";
import { getUser } from "@netlify/identity";
import Anthropic from "@anthropic-ai/sdk";

export const COLECOES = ["briefings", "ofertas", "negocios", "contatos", "salas", "config"];

let _db = null;
export function db() {
  if (!_db) _db = getDatabase();
  return _db;
}

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

export const erro = (msg, status = 400) => json({ erro: msg }, status);

/** Usuário logado (Netlify Identity) ou null. */
export async function usuario() {
  try {
    return await getUser();
  } catch {
    return null;
  }
}

/** Lista de e-mails autorizados (variável ADMIN_EMAILS, separados por vírgula). Vazio = qualquer usuário do Identity. */
export function autorizado(u) {
  if (!u) return false;
  const lista = (env("ADMIN_EMAILS") || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return !lista.length || lista.includes(String(u.email || "").toLowerCase());
}

export function env(nome) {
  try {
    // eslint-disable-next-line no-undef
    if (typeof Netlify !== "undefined" && Netlify.env) return Netlify.env.get(nome);
  } catch {}
  return process.env[nome];
}

/* ---------------- Registros ---------------- */
export async function listarTudo(incluirExcluidos = false) {
  const rows = incluirExcluidos
    ? await db().sql`SELECT colecao, id, dados, criado_em, atualizado_em, excluido FROM registros ORDER BY colecao, atualizado_em DESC`
    : await db().sql`SELECT colecao, id, dados, criado_em, atualizado_em, excluido FROM registros WHERE excluido = FALSE ORDER BY colecao, atualizado_em DESC`;
  return rows;
}

export async function salvarRegistro(colecao, id, dados) {
  const rows = await db().sql`
    INSERT INTO registros (colecao, id, dados)
    VALUES (${colecao}, ${id}, ${JSON.stringify(dados)}::jsonb)
    ON CONFLICT (colecao, id) DO UPDATE
      SET dados = EXCLUDED.dados, atualizado_em = NOW(), excluido = FALSE
    RETURNING atualizado_em`;
  return rows[0];
}

export async function obterRegistro(colecao, id) {
  const rows = await db().sql`SELECT dados FROM registros WHERE colecao = ${colecao} AND id = ${id} AND excluido = FALSE`;
  return rows[0] ? rows[0].dados : null;
}

export async function registrarEmissao(e) {
  const seq = await db().sql`SELECT nextval('codigo_em') AS n`;
  const codigo = e.codigo || "EM-" + String(seq[0].n).padStart(5, "0");
  const rows = await db().sql`
    INSERT INTO emissoes (codigo, tipo, negocio_id, oferta_id, briefing_id, contato_id, sala_id, destinatario, conteudo, arquivo, meta)
    VALUES (${codigo}, ${e.tipo}, ${e.negocio_id || null}, ${e.oferta_id || null}, ${e.briefing_id || null},
            ${e.contato_id || null}, ${e.sala_id || null}, ${e.destinatario || null}, ${e.conteudo || null},
            ${e.arquivo || null}, ${JSON.stringify(e.meta || {})}::jsonb)
    RETURNING id, codigo, criado_em`;
  return rows[0];
}

export async function proximoCodigoPC() {
  const r = await db().sql`SELECT nextval('codigo_pc') AS n`;
  return "PC-" + String(r[0].n).padStart(4, "0");
}

/* ---------------- Extração com IA ---------------- */
export const PROMPT_UM = `Você extrai dados de anúncios imobiliários brasileiros (galpões, áreas, imóveis comerciais) para a ficha de um corretor.
Responda SOMENTE um objeto JSON com estas chaves (null quando o anúncio não informar; NUNCA invente):
{"tipo":"Galpão|Galpão em condomínio|Área / terreno|Prédio comercial|Imóvel comercial|Fazenda","operacao":"Locação|Venda|Locação / Venda","cidade":string,"uf":"SP","regiao":"região ampla ou eixo (ex.: 'Eixo Anhanguera (RMC)'), nunca bairro","subtitulo":"destaque de acesso SEM endereço (rodovia, aeroporto, distâncias)","tipologia":"Isolado|Em condomínio|null","terreno":número,"construida":número,"fabril":número,"administrativo":número,"apoio":número,"pe_direito":número,"piso_carga":número,"docas":número,"energia_kva":número,"pontes":"texto curto|null","avcb":"texto curto|null","aluguel":número mensal,"venda":número,"condominio":número mensal,"iptu":número,"iptu_periodo":"mensal|anual|null (só se explícito)","data_anuncio":"AAAA-MM-DD|null","anunciante":"nome da imobiliária/anunciante|null","titulo":"título curto, ex.: 'Galpão com 12.400 m² de área fabril em Sumaré'","descricao":"parágrafo de 350 a 550 caracteres, 3ª pessoa, só fatos do anúncio","diferenciais":["até 6 itens curtos"],"itens":["até 4 dúvidas específicas a confirmar"],"alertas_ia":[{"lvl":"a|v","msg":"inconsistência no próprio texto","item":"frase curta para itens a confirmar"}]}
REGRAS: números puros (12400). Se total = útil = construída com número redondo, use construida e alerte que pode ser o terreno. Em titulo, subtitulo, descricao e diferenciais é PROIBIDO citar rua, número, bairro, nome de condomínio, imobiliária, corretor, portal, código do anúncio, telefone ou e-mail.`;

export const PROMPT_VARIOS = `O texto abaixo é um e-mail de alerta de portal imobiliário (ou uma lista colada) com VÁRIOS anúncios. Responda SOMENTE {"ofertas":[...]} com até 15 itens, um por anúncio, cada um com as chaves: tipo, operacao, cidade, uf, regiao (região ampla, nunca bairro), titulo (sem endereço), fabril, construida, terreno, pe_direito, docas, aluguel, venda, condominio, iptu, link (URL do anúncio se aparecer, senão null), anunciante (se aparecer). Números puros; null quando não houver; NUNCA invente.`;

export function extrairJSON(txt) {
  const s = String(txt || "").trim();
  try {
    return JSON.parse(s);
  } catch {}
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      return JSON.parse(fence[1]);
    } catch {}
  }
  const i = s.indexOf("{"), j = s.lastIndexOf("}");
  if (i >= 0 && j > i) {
    try {
      return JSON.parse(s.slice(i, j + 1));
    } catch {}
  }
  throw new Error("Resposta da IA sem JSON válido");
}

export async function chamarIA(prompt, texto, maxTokens = 4000) {
  const client = new Anthropic(); // credenciais do AI Gateway da Netlify ou ANTHROPIC_API_KEY própria
  const model = env("MODELO_IA") || "claude-sonnet-4-5-20250929";
  const r = await client.messages.create({
    model,
    max_tokens: maxTokens,
    messages: [{ role: "user", content: `${prompt}\n\nTEXTO:\n"""\n${texto}\n"""` }],
  });
  const out = (r.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  return extrairJSON(out);
}
