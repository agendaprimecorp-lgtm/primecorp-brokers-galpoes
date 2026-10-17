// Leads do site primecorpconsultoria.com.br → sistema → assistente no WhatsApp.
import crypto from "node:crypto";
import { db, env, salvarRegistro, registrarEmissao } from "./servidor.mjs";
const waNum = (s) => { const d = String(s || "").replace(/\D/g, ""); return d.length === 10 || d.length === 11 ? "55" + d : d; };

export const NUMERO_ASSISTENTE = () => (env("WHATSAPP_NUMERO") || "(19) 98110-5192").replace(/\D/g, "").replace(/^(\d{10,11})$/, "55$1");
const limpa = (v, n = 200) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");

/** Valida e normaliza o que veio do site. Lança Error com mensagem amigável. */
export function normalizarLead(b) {
  if (!b || typeof b !== "object") throw new Error("Dados inválidos.");
  if (b.hp) throw Object.assign(new Error("ok"), { silencioso: true }); // honeypot
  if (!b.consentimento) throw new Error("É preciso autorizar o contato (LGPD).");
  const fone = String(b.fone || "").replace(/\D/g, "");
  if (fone.length < 10 || fone.length > 13) throw new Error("WhatsApp inválido.");
  const nome = limpa(b.nome, 120); if (nome.length < 2) throw new Error("Informe o nome.");
  const form = ["consulta", "indicacao", "imovel", "propto"].includes(b.form) ? b.form : "consulta";
  const extras = {}; for (const [k, v] of Object.entries(b.extras || {}).slice(0, 12)) if (/^[a-z_]{2,30}$/.test(k)) extras[k] = limpa(String(v ?? ""), 600);
  for (const k of CAMPOS_ORG) if (!extras[k] && b[k]) extras[k] = limpa(String(b[k]), 200); // campos do cadastro também aceitos no topo
  return { form, perfil: limpa(b.perfil, 80), nome, municipio: limpa(b.municipio, 120), wa: waNum(fone), email: limpa(b.email, 120).toLowerCase(), extras, pagina: limpa(b.pagina, 120) };
}

/* --- Tipo de cadastro: vem de "Tipo de organização" e "Tipo de ente"; cidade/UF sozinha não define tipo --- */
const CAMPOS_ORG = ["tipo_organizacao", "tipo_ente", "organizacao", "cnpj"];
const sem = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
export const TIPOS_ORG = { prefeitura: "PREFEITURA", governo_estadual: "GOVERNO DO ESTADO", ente_publico: "ENTE PÚBLICO", empresa: "EMPRESA" };

/** Classifica o cadastro: { tipo: prefeitura|governo_estadual|ente_publico|empresa|null, nome } (nome exatamente como veio). */
export function classificarOrganizacao(l) {
  const ex = l?.extras || {};
  const nome = ex.organizacao || ""; const n = sem(nome);
  const org = sem(ex.tipo_organizacao); const ente = sem(ex.tipo_ente);
  const cnpj = /\d{2}/.test(String(ex.cnpj || "").replace(/\D/g, ""));
  const r = (tipo) => ({ tipo, nome });
  if (/empresa|privad/.test(org)) return r("empresa");
  // ente público declarado pelo próprio cadastro (prefeituras também têm CNPJ)
  const prefeitura = /^prefeitura/.test(ente) || /^prefeitura municipal de /.test(n);
  const estado = /governo|estado/.test(ente) || /^governo do estado /.test(n);
  if (prefeitura) return r("prefeitura");
  if (estado) return r("governo_estadual");
  if (/ente|public/.test(org)) return r("ente_publico");
  if (cnpj) return r("empresa");
  return r(null); // não está claro: a assistente pergunta uma vez
}

/** Linha de atendimento sugerida pelo perfil escolhido no site. */
export function linhaDoPerfil(l) {
  const p = (l.perfil || "").toLowerCase();
  if (l.form === "propto") return "Propto · teste " + (l.perfil || "geral");
  if (l.form === "imovel") return "imóveis";
  const tipo = classificarOrganizacao(l).tipo;
  if (l.form === "indicacao") return tipo === "empresa" ? "indicação de empresa" : tipo === "governo_estadual" ? "indicação de estado" : tipo === "ente_publico" ? "indicação de ente público" : tipo === "prefeitura" ? "indicação de município" : "indicação";
  if (tipo === "empresa") return "empresas";
  if (tipo) return "setor público";
  if (/prefeit|secret|procurad|servidor|vereador/.test(p)) return "setor público";
  if (/empres/.test(p)) return "empresas";
  if (/ensino|filantr/.test(p)) return "ensino e filantropia";
  if (/contador|advogad|consultor/.test(p)) return "parceria tributária";
  if (/im[oó]v|propriet|investidor/.test(p)) return "imóveis";
  if (/cidad/.test(p)) return "indicação de município";
  return "consulta geral";
}

export const textoWhatsApp = (codigo, linha) => linha.startsWith("Propto") ? `Olá! Me inscrevi no teste grátis da Propto Imóveis. Código ${codigo}.` : `Olá! Acabei de me cadastrar no site da PrimeCorp (${linha}). Código ${codigo}.`;
export const NUMERO_PROPTO = () => (env("PROPTO_WHATSAPP") || "(19) 98110-5192").replace(/\D/g, "").replace(/^(\d{10,11})$/, "55$1");

/** Grava o lead (limite por IP), devolve código e link do WhatsApp da assistente. */
export async function registrarLead(dados, ip = "") {
  const ipHash = crypto.createHash("sha256").update(String(ip) + (env("COLETA_SEGREDO") || "")).digest("hex").slice(0, 16);
  const recentes = await db().sql`SELECT COUNT(*)::int AS n FROM registros WHERE colecao = 'site_leads' AND dados->>'ip' = ${ipHash} AND criado_em > NOW() - INTERVAL '1 hour'`;
  if ((recentes[0]?.n || 0) >= 6) throw Object.assign(new Error("Muitos envios. Tente mais tarde."), { status: 429 });
  const codigo = "S" + crypto.randomBytes(3).toString("hex").toUpperCase();
  const linha = linhaDoPerfil(dados);
  const lead = { ...dados, linha, codigo, ip: ipHash, status: "novo", criado: new Date().toISOString() };
  await salvarRegistro("site_leads", "sl_" + codigo, lead);
  await registrarEmissao({ tipo: "site_lead", conteudo: `${dados.nome} · ${linha}${dados.municipio ? " · " + dados.municipio : ""}`, meta: { codigo } }).catch(() => null);
  const link = `https://wa.me/${dados.form === "propto" ? NUMERO_PROPTO() : NUMERO_ASSISTENTE()}?text=${encodeURIComponent(textoWhatsApp(codigo, linha))}`;
  return { codigo, linha, link, lead };
}

/** Lead do site ligado a esta conversa (pelo telefone ou pelo código citado na mensagem). */
export function leadDaConversa(leads, conv) {
  const cod = [...(conv.msgs || [])].reverse().map((m) => String(m.texto || "").match(/\bS[0-9A-F]{6}\b/)).find(Boolean)?.[0];
  const v = String(conv.id || "");
  const alt = v.replace(/^55(\d{2})9(\d{8})$/, "55$1$2"); const alt2 = v.replace(/^55(\d{2})(\d{8})$/, "55$19$2");
  return (leads || []).filter((l) => (cod && l.codigo === cod) || [v, alt, alt2].includes(l.wa)).sort((a, b) => (b.criado || "").localeCompare(a.criado || ""))[0] || null;
}

export function resumoLead(l) {
  const ex = Object.entries(l.extras || {}).filter(([, v]) => v).map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`).join("; ");
  const { tipo, nome } = classificarOrganizacao(l);
  const quem = l.form === "indicacao" ? "Essa indicação é" : "Essa solicitação é";
  const tipoTxt = tipo
    ? `TIPO DE CADASTRO: ${TIPOS_ORG[tipo]}${nome ? ` — organização: "${nome}" (use este nome exatamente como está, sem trocar, completar nem abreviar)` : ""}.${tipo === "empresa" ? " Trate como empresa privada, nunca como prefeitura, mesmo com cidade/UF." : ""} Não pergunte de novo o tipo.`
    : `TIPO DE CADASTRO: não informado. Cidade/UF sozinha não define o tipo: não presuma prefeitura nem empresa. Pergunte uma única vez: "${quem} de uma prefeitura ou de uma empresa?"${nome ? ` Organização: "${nome}" (use este nome exatamente como está).` : ""}`;
  return `CADASTRO PELO SITE (${new Date(l.criado).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}, código ${l.codigo}): ${l.nome} · perfil "${l.perfil || l.form}" · ${l.municipio || "sem município"}${l.email ? " · " + l.email : ""}${ex ? " · " + ex : ""}. Linha sugerida: ${l.linha}.
${tipoTxt}
Não peça de novo o que já está aqui; confirme e siga a qualificação a partir do próximo dado que falta. Na primeira resposta sobre este cadastro: não cite agenda, dia, hora, reserva, carteira nem honorários e não pergunte o contato do decisor.`;
}
