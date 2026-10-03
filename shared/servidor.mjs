// Utilitários compartilhados pelas functions (somente servidor).
import { getDatabase } from "@netlify/database";
import { getUser } from "@netlify/identity";
import Anthropic from "@anthropic-ai/sdk";

export const COLECOES = ["briefings", "ofertas", "negocios", "contatos", "salas", "pedidos", "config", "usuarios", "anuncios"];

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


/** Papel do usuário: "admin" (ADMIN_EMAILS ou equipe com papel admin), "corretor" (equipe ativa) ou null (sem acesso). */
export async function papelDe(u) {
  if (!u || !u.email) return null;
  const email = String(u.email).toLowerCase();
  const lista = (env("ADMIN_EMAILS") || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!lista.length || lista.includes(email)) return "admin";
  const rows = await db().sql`SELECT dados FROM registros WHERE colecao = 'usuarios' AND excluido = FALSE`;
  const m = rows.map((r) => r.dados).find((d) => String(d.email || "").toLowerCase() === email && d.ativo !== false);
  if (!m) return null;
  return m.papel === "admin" ? "admin" : "corretor";
}
export async function perfilDe(u) {
  const email = String(u?.email || "").toLowerCase();
  const rows = await db().sql`SELECT dados FROM registros WHERE colecao = 'usuarios' AND excluido = FALSE`;
  const m = rows.map((r) => r.dados).find((d) => String(d.email || "").toLowerCase() === email);
  return m ? { nome: m.nome || "", creci: m.creci || "", telefone: m.telefone || "", email } : { nome: "", creci: "", telefone: "", email };
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

/** IA com imagens (JPEG em base64) + texto. */
export async function chamarIAImagem(prompt, texto, imagens = [], maxTokens = 1500) {
  const client = new Anthropic();
  const model = env("MODELO_IA") || "claude-sonnet-4-5-20250929";
  const content = [
    ...imagens.slice(0, 4).map((b64) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } })),
    { type: "text", text: `${prompt}\n\nFALA DO CORRETOR:\n"""\n${texto || "(sem fala)"}\n"""` },
  ];
  const r = await client.messages.create({ model, max_tokens: maxTokens, messages: [{ role: "user", content }] });
  const out = (r.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  return extrairJSON(out);
}

export const PROMPT_AMBIENTE = `Você ajuda um corretor de imóveis brasileiro que está captando um imóvel no local. Recebe foto(s) de UM ambiente e o que o corretor falou sobre ele (transcrição de voz, pode ter erros).
Responda SOMENTE um objeto JSON:
{"ambiente":"nome curto do ambiente (ex.: 'Sala de estar', 'Cozinha', 'Suíte master', 'Fachada', 'Área de lazer', 'Galpão – área operacional', 'Docas')","descricao":"1 a 2 frases objetivas sobre o ambiente, 3ª pessoa, só o que se vê nas fotos ou o corretor disse","caracteristicas":["até 6 itens curtos, ex.: 'Piso porcelanato', 'Armários planejados'"],"dados":{"dormitorios":número|null,"suites":número|null,"banheiros":número|null,"vagas":número|null,"construida":número|null,"terreno":número|null,"pe_direito":número|null,"docas":número|null,"aluguel":número|null,"venda":número|null,"condominio":número|null,"iptu":número|null},"foto":{"ok":true|false,"problemas":["ex.: 'escura', 'tremida', 'torta', 'objetos pessoais à vista', 'pessoa na foto', 'placa de carro visível'"]}}
REGRAS: em "dados" só números DITOS pelo corretor (nunca estime pela foto); null quando não falou. Não invente materiais que não dá para ver. Não cite endereço.`;

export const PROMPT_ANUNCIO = `Você redige o anúncio de um imóvel captado diretamente por um corretor de imóveis brasileiro (PrimeCorp Brokers), a partir dos dados da ficha, dos ambientes registrados no local e das falas do corretor.
Responda SOMENTE um objeto JSON:
{"titulo":"até 70 caracteres, ex.: 'Casa com 3 dormitórios e piscina no Jardim X, Sumaré'","subtitulo":"até 90 caracteres com o principal atrativo","descricao":"2 parágrafos, 500 a 800 caracteres no total, 3ª pessoa, tom profissional e acolhedor, só fatos fornecidos","destaques":["4 a 8 itens curtos"],"dados":{"dormitorios":número|null,"suites":número|null,"banheiros":número|null,"vagas":número|null,"construida":número|null,"terreno":número|null,"aluguel":número|null,"venda":número|null,"condominio":número|null,"iptu":número|null,"iptu_periodo":"mensal|anual|null","disponibilidade":"texto|null","documentacao":"texto|null"},"pendencias":["até 5 informações que faltam para um anúncio completo"]}
REGRAS: NUNCA invente números, materiais ou itens de lazer. Não cite rua, número, nome do proprietário nem telefone. Bairro e cidade podem aparecer. Em "dados", só números informados nas falas ou na ficha.`;

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

/* ---------------- Documentos (CNPJ/CPF) ---------------- */
export const soDig = (s) => s.replace(/\D/g, "");

export function cnpjValido(c) {
  const d = soDig(c);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = (base, pesos) => {
    const s = base.split("").reduce((acc, x, i) => acc + Number(x) * pesos[i], 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const p2 = [6, ...p1];
  const d1 = calc(d.slice(0, 12), p1);
  const d2 = calc(d.slice(0, 12) + d1, p2);
  return d.endsWith(`${d1}${d2}`);
}
export function cpfValido(c) {
  const d = soDig(c);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += Number(d[i]) * (10 - i);
  let r = (s * 10) % 11; if (r === 10) r = 0;
  if (r !== Number(d[9])) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += Number(d[i]) * (11 - i);
  r = (s * 10) % 11; if (r === 10) r = 0;
  return r === Number(d[10]);
}

