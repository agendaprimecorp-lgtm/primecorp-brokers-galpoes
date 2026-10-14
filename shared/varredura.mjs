// Varredura automática do imóvel (somente servidor): CEP, mapa, CNPJ e leitura da matrícula por IA.
// Fontes gratuitas e públicas; o que exige login/emolumentos (matrícula no ONR) entra pelo PDF que o corretor envia.
import Anthropic from "@anthropic-ai/sdk";
import { env, extrairJSON, MODELO_PADRAO, MODELOS_RESERVA, modeloIndisponivel } from "./servidor.mjs";
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

/* ---------------- Outros documentos: IPTU e cadastros rurais ---------------- */
const SCHEMA_IPTU = `{"doc":"iptu","tipo_documento":"carnê|certidão negativa|certidão positiva|certidão positiva com efeito de negativa|espelho cadastral|outro","municipio":"","exercicio":"ano|null","data_documento":"AAAA-MM-DD|null","inscricao":"inscrição imobiliária / cadastro municipal","contribuinte":"nome do contribuinte/compromissário|null","endereco":"logradouro e número como consta|null","bairro":"|null","cep":"|null","area_terreno":m²|null,"area_construida":m²|null,"valor_venal_terreno":R$|null,"valor_venal_construcao":R$|null,"valor_venal_total":R$|null,"uso":"residencial|comercial|industrial|territorial|null","debitos":true|false|null,"alertas":["divergências ou ressalvas da certidão"]}`;
const SCHEMA_RURAL = `{"doc":"rural","tipo_documento":"CCIR|recibo do CAR|demonstrativo do CAR|ITR/DITR|certidão SIGEF|outro","data_documento":"AAAA-MM-DD|null","denominacao":"nome do imóvel|null","municipio":"|null","titular":"declarante/titular|null","codigo_incra":"|null","ccir":"nº do CCIR|null","car":"código do CAR|null","situacao_car":"ativo|pendente|cancelado|suspenso|null","nirf":"|null","sigef":"código da parcela/certificação|null","area_ha":hectares|null,"modulos_fiscais":número|null,"reserva_legal_ha":número|null,"app_ha":número|null,"alertas":["sobreposições, pendências, área divergente"]}`;
export const PROMPT_DOCUMENTO = `Você classifica e lê UM documento de imóvel brasileiro. Identifique o tipo e responda SOMENTE um JSON conforme o caso:
1) MATRÍCULA do Registro de Imóveis (certidão ou visualização): siga as instruções abaixo e acrescente "doc":"matricula".
${PROMPT_MATRICULA.replace('Se o documento não for uma matrícula, responda {"erro":"não é matrícula"}.', "")}
2) IPTU (carnê, certidão de débitos, espelho/ficha cadastral municipal): ${SCHEMA_IPTU}
3) Cadastro RURAL (CCIR, recibo/demonstrativo do CAR, ITR/DITR, certidão SIGEF): ${SCHEMA_RURAL}
4) Outro documento (escritura, contrato, habite-se, planta…): {"doc":"outro","tipo_documento":"","resumo":"1 frase","alertas":[]}
Valores em R$ e áreas como números puros. Nunca invente: use null quando não constar.`;

export function limparIPTU(r) {
  const deb = r?.debitos === true ? true : r?.debitos === false ? false : null;
  return {
    tipo_documento: s(r?.tipo_documento, 60), municipio: s(r?.municipio, 80), exercicio: s(String(r?.exercicio ?? ""), 4) || null, data_documento: /^\d{4}-\d{2}-\d{2}$/.test(r?.data_documento || "") ? r.data_documento : null,
    inscricao: s(r?.inscricao, 60), contribuinte: s(r?.contribuinte, 160), endereco: s(r?.endereco, 200), bairro: s(r?.bairro, 80), cep: s(r?.cep, 12),
    area_terreno: n(r?.area_terreno), area_construida: n(r?.area_construida), valor_venal_terreno: n(r?.valor_venal_terreno), valor_venal_construcao: n(r?.valor_venal_construcao), valor_venal_total: n(r?.valor_venal_total),
    uso: s(r?.uso, 30), debitos: deb, alertas: (Array.isArray(r?.alertas) ? r.alertas : []).filter((x) => typeof x === "string").slice(0, 8).map((x) => x.slice(0, 240)),
  };
}
export function limparRural(r) {
  return {
    tipo_documento: s(r?.tipo_documento, 60), data_documento: /^\d{4}-\d{2}-\d{2}$/.test(r?.data_documento || "") ? r.data_documento : null, denominacao: s(r?.denominacao, 120), municipio: s(r?.municipio, 80), titular: s(r?.titular, 160),
    codigo_incra: s(r?.codigo_incra, 40), ccir: s(r?.ccir, 40), car: s(r?.car, 80), situacao_car: s(r?.situacao_car, 30), nirf: s(r?.nirf, 30), sigef: s(r?.sigef, 80),
    area_ha: n(r?.area_ha), modulos_fiscais: n(r?.modulos_fiscais), reserva_legal_ha: n(r?.reserva_legal_ha), app_ha: n(r?.app_ha),
    alertas: (Array.isArray(r?.alertas) ? r.alertas : []).filter((x) => typeof x === "string").slice(0, 8).map((x) => x.slice(0, 240)),
  };
}
/** Normaliza a leitura de qualquer documento: {doc:'matricula'|'iptu'|'rural'|'outro', dados} ou {erro}. Sem "doc" = matrícula (compatibilidade). */
export function limparDocumento(r) {
  if (!r || typeof r !== "object") return { erro: "leitura vazia" };
  if (r.erro) return { erro: s(r.erro, 120) };
  const doc = ["matricula", "iptu", "rural", "outro"].includes(r.doc) ? r.doc : "matricula";
  if (doc === "matricula") { const m = limparMatricula(r); return m.erro ? m : { doc, dados: m }; }
  if (doc === "iptu") return { doc, dados: limparIPTU(r) };
  if (doc === "rural") return { doc, dados: limparRural(r) };
  return { doc, dados: { tipo_documento: s(r.tipo_documento, 60), resumo: s(r.resumo, 300), alertas: (Array.isArray(r.alertas) ? r.alertas : []).filter((x) => typeof x === "string").slice(0, 6) } };
}
async function chamarDoc(b64, tipo, prompt) {
  const client = new Anthropic();
  const model = env("MODELO_IA") || MODELO_PADRAO;
  const doc = tipo === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
    : { type: "image", source: { type: "base64", media_type: tipo, data: b64 } };
  const fila = [model, ...MODELOS_RESERVA].filter((x, i, a) => a.indexOf(x) === i); let r, ult;
  for (const m of fila) { try { r = await client.messages.create({ model: m, max_tokens: 4000, messages: [{ role: "user", content: [doc, { type: "text", text: prompt }] }] }); break; } catch (e) { ult = e; if (!modeloIndisponivel(e)) throw e; } }
  if (!r) throw ult;
  return extrairJSON((r.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n"));
}
/** Lê qualquer documento do imóvel (a IA identifica se é matrícula, IPTU ou cadastro rural). */
export async function lerDocumento(b64, tipo) { return limparDocumento(await chamarDoc(b64, tipo, PROMPT_DOCUMENTO)); }

/** Lê a matrícula enviada (PDF ou foto JPEG/PNG em base64). */
export async function lerMatricula(b64, tipo) {
  const client = new Anthropic();
  const model = env("MODELO_IA") || MODELO_PADRAO;
  const doc = tipo === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
    : { type: "image", source: { type: "base64", media_type: tipo, data: b64 } };
  const fila = [model, ...MODELOS_RESERVA].filter((x, i, a) => a.indexOf(x) === i); let r, ult;
  for (const m of fila) { try { r = await client.messages.create({ model: m, max_tokens: 4000, messages: [{ role: "user", content: [doc, { type: "text", text: PROMPT_MATRICULA }] }] }); break; } catch (e) { ult = e; if (!modeloIndisponivel(e)) throw e; } }
  if (!r) throw ult;
  const out = (r.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
  return limparMatricula(extrairJSON(out));
}
