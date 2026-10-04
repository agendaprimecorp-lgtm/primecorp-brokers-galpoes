// WhatsApp Business Platform (Cloud API da Meta): assinatura do webhook, leitura das mensagens e envio.
import crypto from "node:crypto";
import { env } from "./servidor.mjs";

export const GRAPH = () => `https://graph.facebook.com/${env("WHATSAPP_GRAPH_VERSAO") || "v25.0"}`;

/** Confere X-Hub-Signature-256 = sha256=HMAC(app secret, corpo bruto). */
export function assinaturaValida(corpo, cabecalho, segredo) {
  if (!segredo || !cabecalho || !cabecalho.startsWith("sha256=")) return false;
  const esperado = Buffer.from("sha256=" + crypto.createHmac("sha256", segredo).update(corpo, "utf8").digest("hex"));
  const recebido = Buffer.from(cabecalho);
  return esperado.length === recebido.length && crypto.timingSafeEqual(esperado, recebido);
}

/** Alternativa para provedores que não assinam o webhook: chave longa na URL (?chave=…). */
export function chaveValida(chave) {
  const esp = env("WHATSAPP_WEBHOOK_CHAVE") || "";
  if (esp.length < 24 || !chave || chave.length !== esp.length) return false;
  return crypto.timingSafeEqual(Buffer.from(esp), Buffer.from(chave));
}

/** Extrai as mensagens recebidas do payload do webhook. */
export function lerEntradas(payload) {
  const out = [];
  for (const e of payload?.entry || []) for (const ch of e.changes || []) {
    const v = ch.value || {}; if (ch.field && !["messages", "smb_message_echoes"].includes(ch.field)) continue;
    const nomes = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile?.name || ""]));
    // Coexistência: mensagens que a equipe enviou pelo app WhatsApp Business do celular
    for (const m of v.message_echoes || []) {
      const texto = m.type === "text" ? m.text?.body || "" : m[m.type]?.caption || `[${m.type} enviado pelo celular]`;
      out.push({ id: m.id, de: m.to, eco: true, t: new Date(Number(m.timestamp) * 1000 || Date.now()).toISOString(), texto: String(texto).slice(0, 4000), midia: m.type === "text" ? null : m.type, numero_empresa: v.metadata?.phone_number_id || "" });
    }
    for (const m of v.messages || []) {
      let texto = "", midia = null;
      if (m.type === "text") texto = m.text?.body || "";
      else if (m.type === "interactive") texto = m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || "";
      else if (m.type === "button") texto = m.button?.text || "";
      else if (m.type === "location") texto = `[localização enviada: ${m.location?.latitude}, ${m.location?.longitude}]`;
      else { midia = m.type; texto = m[m.type]?.caption || ""; }
      out.push({ id: m.id, de: m.from, nome: nomes[m.from] || "", t: new Date(Number(m.timestamp) * 1000 || Date.now()).toISOString(), texto: String(texto).slice(0, 4000), midia, ...(midia && m[m.type]?.id ? { midia_id: m[m.type].id } : {}), numero_empresa: v.metadata?.phone_number_id || "" });
    }
  }
  return out;
}

/** Status de entrega (sent/delivered/read/failed) com o erro da Meta, quando houver. */
export function lerStatus(payload) {
  const out = [];
  for (const e of payload?.entry || []) for (const ch of e.changes || []) for (const s of ch.value?.statuses || [])
    out.push({ id: s.id, para: s.recipient_id, status: s.status, erro: (s.errors || []).map((x) => `${x.code} ${x.title || ""} ${x.error_data?.details || x.message || ""}`.trim()).join(" | ") || null });
  return out;
}

/** Provedor: "meta" (Cloud API direta, padrão) ou "360dialog" (parceiro oficial; permite coexistência com o app do celular). */
export const provedor = () => (env("WHATSAPP_PROVEDOR") || "meta").toLowerCase();
async function post(corpo) {
  const tok = env("WHATSAPP_TOKEN"); const p360 = provedor() === "360dialog"; const id = env("WHATSAPP_PHONE_ID");
  if (!tok || (!p360 && !id)) throw new Error("WhatsApp não configurado (WHATSAPP_TOKEN" + (p360 ? ")." : " / WHATSAPP_PHONE_ID)."));
  const url = p360 ? (env("WHATSAPP_API_BASE") || "https://waba-v2.360dialog.io") + "/messages" : `${GRAPH()}/${id}/messages`;
  const auth = p360 ? { "D360-API-KEY": tok } : { authorization: `Bearer ${tok}` };
  const r = await (globalThis.__fetchWA || fetch)(url, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", ...(corpo.status ? {} : { recipient_type: "individual" }), ...corpo }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j?.error?.message || `WhatsApp recusou (${r.status})`); e.codigo = j?.error?.code; throw e; }
  return j?.messages?.[0]?.id || null;
}

/** Texto simples ou com até 3 botões de resposta (só dentro da janela de 24 h). */
export function enviar(para, texto, botoes = []) {
  texto = String(texto).replace(/\*\*(.+?)\*\*/g, "*$1*").replace(/^#+\s*/gm, "").replace(/^---$/gm, ""); // markdown → formatação do WhatsApp
  if (botoes.length) return post({ to: para, type: "interactive", interactive: { type: "button", body: { text: texto.slice(0, 1024) }, action: { buttons: botoes.slice(0, 3).map((b, i) => ({ type: "reply", reply: { id: "b" + i, title: b.slice(0, 20) } })) } } });
  return post({ to: para, type: "text", text: { body: texto.slice(0, 4096), preview_url: true } });
}
/** Modelo aprovado (fora da janela de 24 h). Parâmetros vão no corpo, em ordem. */
export function enviarModelo(para, nome, parametros = [], idioma = "pt_BR") {
  return post({ to: para, type: "template", template: { name: nome, language: { code: idioma }, components: parametros.length ? [{ type: "body", parameters: parametros.map((p) => ({ type: "text", text: String(p).replace(/\s+/g, " ").trim().slice(0, 1000) || "-" })) }] : [] } });
}
/** 360dialog: aponta o webhook do número para o sistema, com a chave num cabeçalho privado. */
export async function conectarWebhook360(urlWebhook) {
  const tok = env("WHATSAPP_TOKEN"), chave = env("WHATSAPP_WEBHOOK_CHAVE");
  if (!tok || !chave || chave.length < 24) throw new Error("Cadastre WHATSAPP_TOKEN e WHATSAPP_WEBHOOK_CHAVE (24+ caracteres) no Netlify e faça novo deploy.");
  const r = await (globalThis.__fetchWA || fetch)((env("WHATSAPP_API_BASE") || "https://waba-v2.360dialog.io") + "/v1/configs/webhook", { method: "POST", headers: { "D360-API-KEY": tok, "content-type": "application/json" }, body: JSON.stringify({ url: urlWebhook, headers: { "x-chave-webhook": chave } }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.meta?.developer_message || j?.error?.message || `360dialog recusou (${r.status})`);
  return j;
}
/** 360dialog: cria o modelo "zoe_aviso" (utilidade) para avisar a equipe fora da janela de 24 h. */
export const MODELO_AVISO = "zoe_aviso";
export async function criarModeloAviso() {
  const tok = env("WHATSAPP_TOKEN"); if (!tok) throw new Error("WHATSAPP_TOKEN não configurado.");
  const r = await (globalThis.__fetchWA || fetch)((env("WHATSAPP_API_BASE") || "https://waba-v2.360dialog.io") + "/v1/configs/templates", { method: "POST", headers: { "D360-API-KEY": tok, "content-type": "application/json" }, body: JSON.stringify({ name: MODELO_AVISO, category: "UTILITY", language: "pt_BR", components: [{ type: "BODY", text: "Aviso da Zoe para a equipe PrimeCorp: {{1}}. Responda esta mensagem para abrir a conversa.", example: { body_text: [["cliente aguardando atendimento humano na conversa de Carlos"]] } }] }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok && !/already exists|duplicate|existe/i.test(JSON.stringify(j))) throw new Error(j?.meta?.developer_message || j?.error?.message || `360dialog recusou (${r.status})`);
  return { nome: MODELO_AVISO, status: j?.status || (r.ok ? "PENDING" : "já existia") };
}
export const marcarLida = (id) => post({ status: "read", message_id: id }).catch(() => null);

/** Números da equipe (variável ZOE_EQUIPE, separados por vírgula). */
export const equipeWA = () => (env("ZOE_EQUIPE") || "").split(",").map((s) => { const d = s.replace(/\D/g, ""); return d.length === 10 || d.length === 11 ? "55" + d : d; }).filter(Boolean);
export const janelaAberta = (conv, agora = Date.now()) => { const u = [...(conv?.msgs || [])].reverse().find((m) => m.de === "cliente"); return !!u && agora - Date.parse(u.t) < 24 * 3600e3 - 60e3; };
