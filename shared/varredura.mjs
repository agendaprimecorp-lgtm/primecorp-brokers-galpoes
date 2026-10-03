// Varredura automática do imóvel (somente servidor): CEP, mapa, CNPJ e leitura da matrícula por IA.
// Fontes gratuitas e públicas; o que exige login/emolumentos (matrícula no ONR) entra pelo PDF que o corretor envia.
import Anthropic from "@anthropic-ai/sdk";
import { env, extrairJSON } from "./servidor.mjs";
import V from "./verif.mjs";

const UA = "PrimeCorpBrokers-Sistema/1.0 (contato@primecorpconsultoria.com.br)";
const TEMPO = 8000;

async function getJSON(url, headers = {}) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), TEMPO);
  try {
    const r = await (globalThis.__fetchVerif || fetch)(url, { signal: ctl.signal, headers: { "user-agent": UA, accept: "application/json", ...headers } });
    if (r.status === 404) return { __404: true };
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

/** CEP: BrasilAPI (v2, várias bases) com reserva no ViaCEP. */
export async function consultarCEP(cep) {
  const c = V.dig(cep);
  if (c.length !== 8) return { erro: "CEP deve ter 8 dígitos" };
  try {
    const j = await getJSON(`https://brasilapi.com.br/api/cep/v2/${c}`);
    if (!j.__404 && j.city) {
      const co = j.location?.coordinates || {};
      return { cep: c, logradouro: j.street || "", bairro: j.neighborhood || "", cidade: j.city, uf: j.state, lat: Number(co.latitude) || null, lon: Number(co.longitude) || null, fonte: "BrasilAPI" };
    }
  } catch {}
  try {
    const j = await getJSON(`https://viacep.com.br/ws/${c}/json/`);
    if (j && !j.erro && j.localidade) return { cep: c, logradouro: j.logradouro || "", bairro: j.bairro || "", cidade: j.localidade, uf: j.uf, ibge: j.ibge || null, fonte: "ViaCEP" };
    return { erro: "CEP inexistente" };
  } catch (e) { return { erro: "serviço de CEP indisponível (" + (e.message || e) + ")" }; }
}

/** Mapa: Nominatim/OpenStreetMap (1 consulta por varredura, identificada, sem uso em massa). */
export async function geolocalizar(o, cepInfo) {
  const rua = o.endereco || cepInfo?.logradouro; const cid = o.cidade || cepInfo?.cidade; const uf = o.uf || cepInfo?.uf;
  if (!rua || !cid) return cepInfo?.lat ? { lat: cepInfo.lat, lon: cepInfo.lon, cidade: cepInfo.cidade, precisao: "CEP", fonte: "BrasilAPI" } : { erro: "sem endereço" };
  const q = new URLSearchParams({ format: "jsonv2", addressdetails: "1", limit: "1", countrycodes: "br", street: [o.numero, rua].filter(Boolean).join(" "), city: cid, state: uf || "", postalcode: V.dig(o.cep || "") });
  try {
    const j = await getJSON("https://nominatim.openstreetmap.org/search?" + q.toString(), { "accept-language": "pt-BR" });
    const x = Array.isArray(j) ? j[0] : null;
    if (!x) return cepInfo?.lat ? { lat: cepInfo.lat, lon: cepInfo.lon, cidade: cepInfo.cidade, precisao: "CEP", fonte: "BrasilAPI" } : { erro: "não localizado" };
    const a = x.address || {};
    return { lat: Number(x.lat), lon: Number(x.lon), cidade: a.city || a.town || a.municipality || a.village || "", precisao: o.numero ? "número" : "logradouro", fonte: "OpenStreetMap (ODbL)" };
  } catch (e) { return { erro: "mapa indisponível (" + (e.message || e) + ")" }; }
}

/** CNPJ: BrasilAPI (dados públicos da Receita Federal). CPF não tem consulta pública: só o dígito verificador. */
export async function consultarCNPJ(doc) {
  const c = V.dig(doc);
  if (c.length !== 14) return null;
  if (!V.docValido(c)) return { erro: "CNPJ inválido" };
  try {
    const j = await getJSON(`https://brasilapi.com.br/api/cnpj/v1/${c}`);
    if (j.__404) return { erro: "CNPJ não encontrado na Receita" };
    return { cnpj: c, razao_social: j.razao_social || "", fantasia: j.nome_fantasia || "", situacao: j.descricao_situacao_cadastral || "", desde: j.data_situacao_cadastral || "", municipio: j.municipio || "", uf: j.uf || "", cnae: j.cnae_fiscal_descricao || "", socios: (j.qsa || []).slice(0, 8).map((s) => ({ nome: s.nome_socio, qualificacao: s.qualificacao_socio })), fonte: "BrasilAPI / Receita Federal" };
  } catch (e) { return { erro: "consulta indisponível (" + (e.message || e) + ")" }; }
}

/** Varre tudo o que é público e devolve as fontes com data. */
export async function varrer(o) {
  const em = new Date().toISOString();
  const cep = o.cep ? await consultarCEP(o.cep) : null;
  const [geo, cnpj] = await Promise.all([geolocalizar(o, cep && !cep.erro ? cep : null), consultarCNPJ(o.proprietario_doc || "")]);
  const fontes = {};
  if (cep) fontes.cep = { ...cep, em };
  if (geo && !(geo.erro === "sem endereço")) fontes.geo = { ...geo, em };
  if (cnpj) fontes.cnpj = { ...cnpj, em };
  return fontes;
}

/* ---------------- Leitura da matrícula por IA ---------------- */
export const PROMPT_MATRICULA = `Você é um analista de registro de imóveis brasileiro. Recebe a certidão ou visualização de uma MATRÍCULA (Lei 6.015/73). Leia TODOS os atos (R- registros e AV- averbações), em ordem, e responda SOMENTE um JSON:
{"numero":"nº da matrícula","cartorio":"nome do Registro de Imóveis e comarca","cns":"CNS do cartório|null","data_certidao":"AAAA-MM-DD (data de emissão da certidão/visualização)|null","tipo_documento":"certidão|visualização|cópia",
"descricao":"descrição do imóvel em 1 a 3 frases (sem confrontantes)","endereco":"endereço como consta, com atualizações averbadas","inscricao":"inscrição municipal / cadastro, se averbada|null","ccir":"|null","car":"|null","nirf":"|null",
"area_terreno":número em m²|null,"area_ha":número em hectares|null,"construcao_averbada":true|false|null,"area_construida_averbada":número m²|null,
"proprietarios":[{"nome":"","documento":"CPF/CNPJ como consta","fracao":"ex.: 100% ou 1/2","estado_civil_regime":"|null"}],
"onus":[{"ato":"ex.: R-5","tipo":"Hipoteca|Alienação fiduciária|Penhora|Arresto|Indisponibilidade|Usufruto|Servidão|Cláusula de inalienabilidade|Ação/citação|Locação|Promessa de compra e venda|Outro","descricao":"credor/processo/valor em 1 frase","cancelado":true|false,"cancelado_por":"ex.: AV-9|null"}],
"ultimos_atos":["até 6 últimos atos em 1 linha cada"],"alertas":["divergências, rasuras, atos ilegíveis, matrícula encerrada/transportada, georreferenciamento ausente para rural ≥ 25 ha, falta de averbação de construção, CND/ITBI pendentes"]}
REGRAS: Proprietários = quem detém o domínio APÓS o último ato de transmissão. Um ônus só é cancelado se houver averbação de cancelamento citando-o. Nunca invente; use null quando não constar. Se o documento não for uma matrícula, responda {"erro":"não é matrícula"}.`;

const s = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : null);
const n = (v) => { const x = typeof v === "number" ? v : Number(String(v ?? "").replace(/\./g, "").replace(",", ".")); return Number.isFinite(x) && x > 0 ? x : null; };
export function limparMatricula(r) {
  if (!r || typeof r !== "object") return { erro: "leitura vazia" };
  if (r.erro) return { erro: s(r.erro, 120) };
  return {
    numero: s(r.numero, 40), cartorio: s(r.cartorio, 160), cns: s(r.cns, 20), data_certidao: /^\d{4}-\d{2}-\d{2}$/.test(r.data_certidao || "") ? r.data_certidao : null, tipo_documento: s(r.tipo_documento, 30),
    descricao: s(r.descricao, 800), endereco: s(r.endereco, 300), inscricao: s(r.inscricao, 60), ccir: s(r.ccir, 40), car: s(r.car, 80), nirf: s(r.nirf, 30),
    area_terreno: n(r.area_terreno), area_ha: n(r.area_ha), construcao_averbada: typeof r.construcao_averbada === "boolean" ? r.construcao_averbada : null, area_construida_averbada: n(r.area_construida_averbada),
    proprietarios: (Array.isArray(r.proprietarios) ? r.proprietarios : []).slice(0, 12).map((p) => ({ nome: s(p?.nome, 160) || "", documento: s(p?.documento, 30) || "", fracao: s(p?.fracao, 30) || "", estado_civil_regime: s(p?.estado_civil_regime, 120) })),
    onus: (Array.isArray(r.onus) ? r.onus : []).slice(0, 30).map((x) => ({ ato: s(x?.ato, 20) || "", tipo: s(x?.tipo, 60) || "Outro", descricao: s(x?.descricao, 300) || "", cancelado: x?.cancelado === true, cancelado_por: s(x?.cancelado_por, 20) })),
    ultimos_atos: (Array.isArray(r.ultimos_atos) ? r.ultimos_atos : []).filter((x) => typeof x === "string").slice(0, 6).map((x) => x.slice(0, 200)),
    alertas: (Array.isArray(r.alertas) ? r.alertas : []).filter((x) => typeof x === "string").slice(0, 10).map((x) => x.slice(0, 240)),
  };
}

/** Lê a matrícula enviada (PDF ou foto JPEG/PNG em base64). */
export async function lerMatricula(b64, tipo) {
  const client = new Anthropic();
  const model = env("MODELO_IA") || "claude-sonnet-4-5-20250929";
  const doc = tipo === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
    : { type: "image", source: { type: "base64", media_type: tipo, data: b64 } };
  const fila = [model, "claude-sonnet-4-5", "claude-haiku-4-5"].filter((x, i, a) => a.indexOf(x) === i); let r, ult;
  for (const m of fila) { try { r = await client.messages.create({ model: m, max_tokens: 4000, messages: [{ role: "user", content: [doc, { type: "text", text: PROMPT_MATRICULA }] }] }); break; } catch (e) { ult = e; if (![404, 503, 529].includes(e?.status)) throw e; } }
  if (!r) throw ult;
  const out = (r.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  return limparMatricula(extrairJSON(out));
}
