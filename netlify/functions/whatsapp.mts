import type { Config, Context } from "@netlify/functions";
import { env, obterRegistro, salvarRegistro } from "../../shared/servidor.mjs";
import { assinaturaValida, lerEntradas, equipeWA, marcarLida } from "../../shared/whatsapp.mjs";
import { anexarMsg, waNum } from "../../shared/zoe.mjs";

// Webhook público do WhatsApp (Cloud API). Valida a assinatura da Meta, grava a mensagem e aciona a Zoe em segundo plano.
export default async (req: Request, _context: Context) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    const ok = url.searchParams.get("hub.mode") === "subscribe" && !!env("WHATSAPP_VERIFY_TOKEN") && url.searchParams.get("hub.verify_token") === env("WHATSAPP_VERIFY_TOKEN");
    return ok ? new Response(url.searchParams.get("hub.challenge") || "", { status: 200 }) : new Response("Proibido", { status: 403 });
  }
  if (req.method !== "POST") return new Response("Método não permitido", { status: 405 });
  const corpo = await req.text();
  if (!env("WHATSAPP_APP_SECRET")) return new Response("Não configurado", { status: 503 });
  if (!assinaturaValida(corpo, req.headers.get("x-hub-signature-256") || "", env("WHATSAPP_APP_SECRET"))) return new Response("Assinatura inválida", { status: 401 });
  let payload: any; try { payload = JSON.parse(corpo); } catch { return new Response("ok"); }
  const esperado = env("WHATSAPP_PHONE_ID");
  const msgs = lerEntradas(payload).filter((m) => !esperado || !m.numero_empresa || m.numero_empresa === esperado);
  const equipe = equipeWA(); const acionar = new Set<string>();
  for (const m of msgs) {
    const wa = waNum(m.de);
    const conv: any = (await obterRegistro("conversas", wa)) || { modo: "zoe", msgs: [], criado: new Date().toISOString(), canal: "whatsapp" };
    if ((conv.msgs || []).some((x: any) => x.id === m.id)) continue; // a Meta reenvia: ignora repetidas
    conv.equipe = equipe.includes(wa);
    if (!conv.nome && m.nome) conv.nome = m.nome;
    if (conv.optout && m.texto.trim()) conv.optout = false; // voltou a escrever: reabre
    anexarMsg(conv, { id: m.id, de: "cliente", t: m.t, texto: m.texto, ...(m.midia ? { midia: m.midia } : {}) });
    await salvarRegistro("conversas", wa, conv);
    marcarLida(m.id);
    acionar.add(wa);
  }
  const base = env("URL") || url.origin;
  for (const wa of acionar) {
    // função de segundo plano responde 202 na hora; a Zoe trabalha depois
    await fetch(new URL("/.netlify/functions/zoe-background", base), { method: "POST", headers: { "x-coleta-segredo": env("COLETA_SEGREDO") || "", "content-type": "application/json" }, body: JSON.stringify({ wa }) }).catch((e) => console.error("Zoe não acionada:", e));
  }
  return new Response("ok", { status: 200 });
};

export const config: Config = { path: "/whatsapp/webhook" };
