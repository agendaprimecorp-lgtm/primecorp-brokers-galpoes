// Utilitários compartilhados pelas functions (somente servidor).
import { getDatabase } from "@netlify/database";
import { getUser } from "@netlify/identity";
import Anthropic from "@anthropic-ai/sdk";
import dns from "node:dns/promises";
import net from "node:net";

export const COLECOES = ["briefings", "ofertas", "negocios", "contatos", "salas", "pedidos", "config", "usuarios", "anuncios", "conversas", "agenda", "zoe_sugestoes", "b2g", "site_leads"];

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
  if (Array.isArray(u.roles) && u.roles.includes("propto_cliente")) return null;
  if (lista.includes(email)) return "admin";
  // Clientes da Propto (contas) nunca entram na operação da PrimeCorp, nem com ADMIN_EMAILS vazio.
  if ((await db().sql`SELECT 1 FROM contas WHERE dados->'membros' @> ${JSON.stringify([{ email }])}::jsonb LIMIT 1`).length) return null;
  if (!lista.length) return "admin";
  const rows = await db().sql`SELECT dados FROM registros WHERE colecao = 'usuarios' AND excluido = FALSE`;
  const m = rows.map((r) => r.dados).find((d) => String(d.email || "").toLowerCase() === email && d.ativo !== false);
  if (!m) return null;
  return m.papel === "admin" ? "admin" : "corretor";
}
/** E-mail da equipe PrimeCorp (ADMIN_EMAILS ou cadastro de equipe)? */
export async function ehEquipePrimeCorp(email) {
  const e = String(email || "").trim().toLowerCase(); if (!e) return false;
  const lista = (env("ADMIN_EMAILS") || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (lista.includes(e)) return true;
  const rows = await db().sql`SELECT dados FROM registros WHERE colecao = 'usuarios' AND excluido = FALSE`;
  return rows.some((r) => String(r.dados?.email || "").toLowerCase() === e);
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
    INSERT INTO emissoes (codigo, tipo, negocio_id, oferta_id, briefing_id, contato_id, sala_id, destinatario, conteudo, arquivo, meta, conta)
    VALUES (${codigo}, ${e.tipo}, ${e.negocio_id || null}, ${e.oferta_id || null}, ${e.briefing_id || null},
            ${e.contato_id || null}, ${e.sala_id || null}, ${e.destinatario || null}, ${e.conteudo || null},
            ${e.arquivo || null}, ${JSON.stringify(e.meta || {})}::jsonb, ${e.conta || null})
    RETURNING id, codigo, criado_em`;
  return rows[0];
}

export async function proximoCodigoPC() {
  const r = await db().sql`SELECT nextval('codigo_pc') AS n`;
  return "PC-" + String(r[0].n).padStart(4, "0");
}

/* ---------------- Extração com IA ---------------- */
export const PROMPT_UM = `Você extrai dados de anúncios imobiliários brasileiros de QUALQUER segmento (residencial, comercial, galpão, terreno, rural) para a ficha de um corretor.
Responda SOMENTE um objeto JSON com estas chaves (null quando o anúncio não informar; NUNCA invente):
{"tipo":"Casa|Casa em condomínio|Apartamento|Sobrado|Cobertura|Kitnet / studio|Sala comercial|Loja|Ponto comercial|Prédio comercial|Imóvel comercial|Galpão|Galpão em condomínio|Barracão|Terreno|Lote em condomínio|Área / terreno|Área industrial|Área comercial|Fazenda|Sítio|Chácara|Haras","operacao":"Locação|Venda|Locação / Venda","cidade":string,"uf":"SP","regiao":"bairro ou região ampla (residencial/rural) ou eixo (galpão, ex.: 'Eixo Anhanguera (RMC)')","subtitulo":"destaque SEM endereço (acesso, vista, lazer, rodovia)","tipologia":"Isolado|Em condomínio|null",
"terreno":número m²,"construida":número m² (no residencial: área útil/privativa),"fabril":número,"administrativo":número,"apoio":número,"frente":número m,"zoneamento":string,"topografia":string,
"dormitorios":número,"suites":número,"banheiros":número,"vagas":número,
"pe_direito":número,"piso_carga":número,"docas":número,"energia_kva":número,"pontes":"texto curto|null","avcb":"texto curto|null",
"area_ha":número em HECTARES (converta: alqueire paulista = 2,42 ha; alqueire mineiro/goiano = 4,84 ha; m² ÷ 10.000),"aptidao":string,"agua":string,"benfeitorias":string,"car":string,"ccir":string,"georref":string,"distancia_asfalto":número km,
"aluguel":número mensal,"venda":número,"condominio":número mensal,"iptu":número,"iptu_periodo":"mensal|anual|null (só se explícito)","disponibilidade":string,"documentacao":string,"matricula":"nº da matrícula se o anúncio citar|null","cartorio":"cartório de registro se citado|null","inscricao":"inscrição imobiliária/IPTU se citada|null","cep":"CEP se aparecer|null","nirf":"NIRF se citado|null","data_anuncio":"AAAA-MM-DD|null","anunciante":"nome da imobiliária/anunciante|null",
"titulo":"título curto, ex.: 'Casa com 3 dormitórios em Sumaré', 'Fazenda de 48 ha em Mogi Mirim', 'Galpão com 12.400 m² de área fabril em Sumaré'","descricao":"parágrafo de 350 a 550 caracteres, 3ª pessoa, só fatos do anúncio","diferenciais":["até 6 itens curtos"],"itens":["até 4 dúvidas específicas a confirmar"],"alertas_ia":[{"lvl":"a|v","msg":"inconsistência no próprio texto","item":"frase curta para itens a confirmar"}]}
REGRAS: números puros (12400). Área rural sempre em hectares em area_ha, com a unidade original citada em alertas_ia se houver conversão de alqueire. Se total = útil = construída com número redondo, use construida e alerte que pode ser o terreno. Em titulo, subtitulo, descricao e diferenciais é PROIBIDO citar rua, número, nome de condomínio, imobiliária, corretor, portal, código do anúncio, telefone ou e-mail.`;

export const PROMPT_VARIOS = `O texto abaixo é um e-mail de alerta de portal imobiliário (ou uma lista colada) com VÁRIOS anúncios. Responda SOMENTE {"ofertas":[...]} com até 15 itens, um por anúncio, cada um com as chaves: tipo (Casa, Apartamento, Galpão, Terreno, Fazenda, Sítio, Sala comercial…), operacao, cidade, uf, regiao (bairro ou região ampla), titulo (sem endereço), fabril, construida, terreno, dormitorios, vagas, area_ha (hectares; alqueire paulista = 2,42 ha), pe_direito, docas, aluguel, venda, condominio, iptu, link (URL do anúncio se aparecer, senão null), anunciante (se aparecer). Números puros; null quando não houver; NUNCA invente.`;

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
  const model = env("MODELO_IA") || MODELO_PADRAO;
  const content = [
    ...imagens.slice(0, 4).map((b64) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } })),
    { type: "text", text: `${prompt}\n\nFALA DO CORRETOR:\n"""\n${texto || "(sem fala)"}\n"""` },
  ];
  const r = await criarComReserva(client, model, maxTokens, [{ role: "user", content }]);
  const out = (r.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  return extrairJSON(out);
}
/** Chama o modelo; se o modelo configurado não existir ou estiver sobrecarregado, tenta os de reserva. */
export const MODELO_PADRAO = "claude-sonnet-5-5"; // claude-sonnet-4-5-20250929 sai do ar em 30/11/2026
export const MODELOS_RESERVA = ["claude-sonnet-5-5", "claude-sonnet-4-5", "claude-haiku-4-5"];
export const modeloIndisponivel = (e) => { const st = e?.status || 0; return st === 404 || st === 529 || st === 503 || (st === 400 && /model/i.test(String(e?.message || ""))); };
async function criarComReserva(client, model, maxTokens, messages) {
  const fila = [model, ...MODELOS_RESERVA.filter((m) => m !== model)]; let ult;
  for (const m of fila) {
    try { return await client.messages.create({ model: m, max_tokens: maxTokens, messages }); }
    catch (e) { ult = e; if (!modeloIndisponivel(e)) throw e; }
  }
  throw ult;
}
const txt = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const lista = (v, n, m) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, m)).slice(0, n) : []);
const numOuNull = (v) => { const x = typeof v === "number" ? v : Number(String(v ?? "").replace(/\./g, "").replace(",", ".")); return Number.isFinite(x) && x > 0 ? x : null; };
/** Garante o formato da resposta da IA para um ambiente (evita tela quebrada com resposta fora do padrão). */
export function limparAmbiente(r) {
  const d = r && typeof r.dados === "object" && r.dados ? r.dados : {};
  const dados = {}; for (const k of ["dormitorios", "suites", "banheiros", "vagas", "construida", "terreno", "pe_direito", "docas", "area_ha", "aluguel", "venda", "condominio", "iptu"]) dados[k] = numOuNull(d[k]);
  const f = r && typeof r.foto === "object" && r.foto ? r.foto : {};
  return { ambiente: txt(r?.ambiente, 60), descricao: txt(r?.descricao, 600), caracteristicas: lista(r?.caracteristicas, 8, 60), dados, foto: { ok: f.ok !== false, problemas: lista(f.problemas, 5, 80) } };
}
export function limparAnuncio(r) {
  const d = r && typeof r.dados === "object" && r.dados ? r.dados : {}; const dados = {};
  for (const [k, v] of Object.entries(d)) dados[k] = ["aptidao", "agua", "benfeitorias", "iptu_periodo", "disponibilidade", "documentacao"].includes(k) ? (typeof v === "string" ? v.slice(0, 200) : null) : numOuNull(v);
  return { titulo: txt(r?.titulo, 90), subtitulo: txt(r?.subtitulo, 120), descricao: txt(r?.descricao, 2000), destaques: lista(r?.destaques, 10, 80), dados, pendencias: lista(r?.pendencias, 6, 120) };
}

export const PROMPT_AMBIENTE = `Você ajuda um corretor de imóveis brasileiro que está captando um imóvel no local. Recebe foto(s) de UM ambiente e o que o corretor falou sobre ele (transcrição de voz, pode ter erros).
Responda SOMENTE um objeto JSON:
{"ambiente":"nome curto do ambiente (ex.: 'Sala de estar', 'Cozinha', 'Suíte master', 'Fachada', 'Área de lazer', 'Galpão – área operacional', 'Docas', 'Sede', 'Curral', 'Pastagem', 'Represa', 'Vista do terreno')","descricao":"1 a 2 frases objetivas sobre o ambiente, 3ª pessoa, só o que se vê nas fotos ou o corretor disse","caracteristicas":["até 6 itens curtos, ex.: 'Piso porcelanato', 'Armários planejados'"],"dados":{"dormitorios":número|null,"suites":número|null,"banheiros":número|null,"vagas":número|null,"construida":número|null,"terreno":número|null,"pe_direito":número|null,"docas":número|null,"area_ha":número em hectares|null,"aluguel":número|null,"venda":número|null,"condominio":número|null,"iptu":número|null},"foto":{"ok":true|false,"problemas":["ex.: 'escura', 'tremida', 'torta', 'objetos pessoais à vista', 'pessoa na foto', 'placa de carro visível'"]}}
REGRAS: em "dados" só números DITOS pelo corretor (nunca estime pela foto); null quando não falou. Não invente materiais que não dá para ver. Não cite endereço.`;

export const PROMPT_ANUNCIO = `Você redige o anúncio de um imóvel captado diretamente por um corretor de imóveis brasileiro, a partir dos dados da ficha, dos ambientes registrados no local e das falas do corretor.
Responda SOMENTE um objeto JSON:
{"titulo":"até 70 caracteres, ex.: 'Casa com 3 dormitórios e piscina no Jardim X, Sumaré'","subtitulo":"até 90 caracteres com o principal atrativo","descricao":"2 parágrafos, 500 a 800 caracteres no total, 3ª pessoa, tom profissional e acolhedor, só fatos fornecidos","destaques":["4 a 8 itens curtos"],"dados":{"dormitorios":número|null,"suites":número|null,"banheiros":número|null,"vagas":número|null,"construida":número|null,"terreno":número|null,"area_ha":número em hectares (alqueire paulista = 2,42 ha)|null,"aptidao":"texto|null","agua":"texto|null","benfeitorias":"texto|null","aluguel":número|null,"venda":número|null,"condominio":número|null,"iptu":número|null,"iptu_periodo":"mensal|anual|null","disponibilidade":"texto|null","documentacao":"texto|null"},"pendencias":["até 5 informações que faltam para um anúncio completo"]}
REGRAS: NUNCA invente números, materiais ou itens de lazer. Não cite rua, número, nome do proprietário nem telefone. Bairro e cidade podem aparecer. Em "dados", só números informados nas falas ou na ficha.`;

export async function chamarIA(prompt, texto, maxTokens = 4000) {
  const client = new Anthropic(); // credenciais do AI Gateway da Netlify ou ANTHROPIC_API_KEY própria
  const model = env("MODELO_IA") || MODELO_PADRAO;
  const r = await criarComReserva(client, model, maxTokens, [{ role: "user", content: `${prompt}\n\nTEXTO:\n"""\n${texto}\n"""` }]);
  const out = (r.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  return extrairJSON(out);
}


/* ---------------- Leitura de anúncio pelo link (melhor esforço) ---------------- */
const ipPrivado = (ip) => {
  if (net.isIPv6(ip)) { const x = ip.toLowerCase(); return x === "::" || x === "::1" || /^f[cd]/.test(x) || x.startsWith("fe80") || x.startsWith("::ffff:") || x.startsWith("64:ff9b:"); }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
};
export function htmlParaTexto(html) {
  const h = String(html || "");
  const meta = [];
  const m = (re) => { const x = h.match(re); return x ? x[1] : ""; };
  meta.push(m(/<title[^>]*>([\s\S]*?)<\/title>/i), m(/property=["']og:title["'][^>]*content=["']([^"']+)/i), m(/property=["']og:description["'][^>]*content=["']([^"']+)/i), m(/name=["']description["'][^>]*content=["']([^"']+)/i));
  const ld = [...h.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((x) => x[1].trim()).join("\n").slice(0, 8000);
  const corpo = h.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)[^>]*>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  return [meta.filter(Boolean).join("\n"), ld && "DADOS ESTRUTURADOS:\n" + ld, corpo].filter(Boolean).join("\n\n");
}
async function validarURL(endereco) {
  let u; try { u = new URL(endereco); } catch { throw new Error("link inválido"); }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) throw new Error("link inválido");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(host)) throw new Error("link não permitido");
  const ips = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true }).catch(() => [])).map((x) => x.address);
  if (!ips.length) throw new Error("endereço não encontrado");
  if (ips.some(ipPrivado)) throw new Error("link não permitido");
  return u;
}
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
/** Busca com proteção: só internet pública, redirecionamentos revalidados, tamanho e tempo limitados. */
export async function buscarSeguro(endereco, { aceita = /html|text/i, max = 2_500_000, tempo = 12000, accept = "text/html,application/xhtml+xml", referer } = {}) {
  let u = await validarURL(endereco);
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), tempo);
  try {
    let r;
    for (let salto = 0; ; salto++) {
      r = await fetch(u, { redirect: "manual", signal: ctl.signal, headers: { "user-agent": UA, "accept-language": "pt-BR,pt;q=0.9", accept, ...(referer ? { referer } : {}) } });
      const loc = r.status >= 300 && r.status < 400 && r.headers.get("location");
      if (!loc) break;
      if (salto >= 4) throw new Error("redirecionamentos demais");
      u = await validarURL(new URL(loc, u).toString()); // cada salto é revalidado (sem rede interna)
    }
    if (!r.ok) throw new Error(`o portal recusou a leitura (${r.status})`);
    const tipo = r.headers.get("content-type") || "";
    if (!aceita.test(tipo)) throw new Error("conteúdo não aceito");
    const reader = r.body.getReader(); const partes = []; let tam = 0;
    while (true) { const { done, value } = await reader.read(); if (done) break; tam += value.length; if (tam > max) { ctl.abort(); throw new Error("arquivo grande demais"); } partes.push(value); }
    return { buf: Buffer.concat(partes.map((x) => Buffer.from(x))), tipo, url: u.toString() };
  } finally { clearTimeout(t); }
}

const IMG_RUIM = /logo|icon|ico[-_.]|sprite|avatar|placeholder|blank|pixel|spacer|banner|selo|badge|flag|bandeira|marker|pin[-_.]|mapa|map[-_.]|staticmap|qrcode|whatsapp|facebook|instagram|youtube|loading|lazy[-_.]?load|\.svg|\.gif/i;
/** Fotos do anúncio: og:image, dados estruturados (JSON-LD) e galeria. Só URLs públicas, sem duplicatas. */
export function extrairImagens(html, base) {
  const h = String(html || ""); const achadas = [];
  const add = (v) => { if (!v || typeof v !== "string") return; let s = v.trim().replace(/&amp;/g, "&"); if (!s || s.startsWith("data:")) return; try { s = new URL(s, base).toString(); } catch { return; } if (!/^https?:/.test(s) || IMG_RUIM.test(s)) return; if (!/\.(jpe?g|webp|png)(\?|$)/i.test(s) && !/(foto|image|img|photo|media|cdn|resize|crop)/i.test(s)) return; achadas.push(s); };
  for (const m of h.matchAll(/<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["'][^>]*content=["']([^"']+)/gi)) add(m[1]);
  for (const m of h.matchAll(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["']/gi)) add(m[1]);
  const anda = (x, d = 0) => { if (!x || d > 8) return; if (Array.isArray(x)) return x.forEach((y) => anda(y, d + 1)); if (typeof x !== "object") return; for (const [k, v] of Object.entries(x)) { if (/^(image|photo|images|photos|thumbnailUrl|contentUrl)$/i.test(k)) { if (typeof v === "string") add(v); else if (Array.isArray(v)) v.forEach((y) => (typeof y === "string" ? add(y) : add(y?.url || y?.contentUrl))); else if (v && typeof v === "object") add(v.url || v.contentUrl); } if (v && typeof v === "object") anda(v, d + 1); } };
  for (const m of h.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) { try { anda(JSON.parse(m[1].trim())); } catch {} }
  for (const m of h.matchAll(/<(?:img|source)\b[^>]*>/gi)) {
    const tag = m[0]; const at = (n) => (tag.match(new RegExp(`\\b${n}=["']([^"']+)["']`, "i")) || [])[1];
    const w = Number(at("width") || 0); if (w && w < 200) continue;
    const srcset = at("data-srcset") || at("srcset"); if (srcset) { const ult = srcset.split(",").map((x) => x.trim().split(/\s+/)[0]).filter(Boolean).pop(); add(ult); }
    add(at("data-src") || at("data-lazy") || at("data-original") || at("data-zoom-image") || at("src"));
  }
  const vistos = new Set(); const fora = [];
  for (const s of achadas) { const chave = s.replace(/\?.*$/, "").replace(/[-_/](\d{2,4})x(\d{2,4})(?=[-_./])/g, "").replace(/\/(fit-in|crop|resize|[0-9]{2,4}x[0-9]{2,4})\//g, "/").toLowerCase(); if (vistos.has(chave)) continue; vistos.add(chave); fora.push(s); }
  return fora.slice(0, 30);
}
/** Contatos públicos do anunciante na página (WhatsApp, telefone, e-mail). */
export function extrairContatos(html) {
  const h = String(html || ""); const tel = new Set(); const mail = new Set();
  for (const m of h.matchAll(/(?:wa\.me\/|api\.whatsapp\.com\/send\/?\?phone=|whatsapp\.com\/send\?phone=)\+?(\d{10,13})/gi)) tel.add(m[1]);
  for (const m of h.matchAll(/href=["']tel:([+\d\s().-]{10,20})["']/gi)) tel.add(m[1].replace(/\D/g, ""));
  for (const m of h.matchAll(/"telephone"\s*:\s*"([^"]{8,25})"/gi)) tel.add(m[1].replace(/\D/g, ""));
  for (const m of h.matchAll(/(?:mailto:|"email"\s*:\s*")([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/gi)) if (!/noreply|no-reply|sentry|example|wixpress/i.test(m[1])) mail.add(m[1].toLowerCase());
  const fmt = (d) => { const x = d.replace(/^55(?=\d{10,11}$)/, ""); return x.length === 11 ? `(${x.slice(0, 2)}) ${x.slice(2, 7)}-${x.slice(7)}` : x.length === 10 ? `(${x.slice(0, 2)}) ${x.slice(2, 6)}-${x.slice(6)}` : null; };
  return { telefones: [...tel].map(fmt).filter(Boolean).slice(0, 3), emails: [...mail].slice(0, 3) };
}
/** Lê o anúncio: texto para a IA, fotos e contatos do anunciante. */
export async function lerAnuncio(endereco) {
  const { buf, url } = await buscarSeguro(endereco);
  const html = buf.toString("utf8");
  const texto = htmlParaTexto(html);
  if (texto.length < 200 || /captcha|access denied|attention required|verifique que você é humano/i.test(texto.slice(0, 2000))) throw new Error("o portal bloqueou a leitura automática");
  return { texto: texto.slice(0, 16000), imagens: extrairImagens(html, url), contatos: extrairContatos(html), url };
}
export async function lerPagina(endereco) { return (await lerAnuncio(endereco)).texto; }

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

