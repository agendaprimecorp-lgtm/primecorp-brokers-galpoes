// Áudio do WhatsApp: baixa a mídia (Meta ou 360dialog) e transcreve com o Gemini (AI Gateway da Netlify).
import { GoogleGenAI } from "@google/genai";
import { env } from "./servidor.mjs";
import { provedor, GRAPH } from "./whatsapp.mjs";

const MAX = 12 * 1024 * 1024; // áudios do WhatsApp raramente passam de 2 MB

/** Baixa a mídia pelo id recebido no webhook. Devolve { buf, mime }. */
export async function baixarMidia(id) {
  const f = globalThis.__fetchWA || fetch; const tok = env("WHATSAPP_TOKEN");
  if (!tok || !id) throw new Error("Mídia sem id ou WhatsApp sem token.");
  const p360 = provedor() === "360dialog"; const base = env("WHATSAPP_API_BASE") || "https://waba-v2.360dialog.io";
  const auth = p360 ? { "D360-API-KEY": tok } : { authorization: `Bearer ${tok}` };
  const r = await f(p360 ? `${base}/${encodeURIComponent(id)}` : `${GRAPH()}/${encodeURIComponent(id)}`, { headers: auth });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.url) throw new Error(`Mídia não encontrada (${r.status}).`);
  // 360dialog: o link da Meta é baixado pelo próprio host da 360dialog, com o mesmo caminho
  const u = new URL(j.url); const alvo = p360 ? base + u.pathname + u.search : j.url;
  const d = await f(alvo, { headers: auth });
  if (!d.ok) throw new Error(`Download da mídia falhou (${d.status}).`);
  const buf = Buffer.from(await d.arrayBuffer());
  if (buf.length > MAX) throw new Error("Áudio grande demais.");
  return { buf, mime: String(j.mime_type || d.headers.get("content-type") || "audio/ogg").split(";")[0] };
}

/** Transcreve em português. Usa Gemini (aceita áudio OGG/Opus do WhatsApp direto). */
export async function transcrever(buf, mime = "audio/ogg") {
  if (globalThis.__transcrever) return globalThis.__transcrever(buf, mime);
  const ai = new GoogleGenAI({});
  let ult;
  for (const model of [env("MODELO_AUDIO") || "gemini-2.5-flash", "gemini-2.5-flash-lite"].filter((x, i, a) => a.indexOf(x) === i)) {
    try {
      const r = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ inlineData: { mimeType: mime, data: buf.toString("base64") } }, { text: "Transcreva fielmente este áudio em português do Brasil. Responda só com a transcrição, sem comentários. Se não houver fala compreensível, responda exatamente: [inaudível]" }] }],
      });
      const t = String(r.text || "").trim();
      if (t) return t.slice(0, 3000);
    } catch (e) { ult = e; }
  }
  throw ult || new Error("Transcrição vazia.");
}

/** Transcreve os áudios ainda não lidos das últimas mensagens do cliente (altera a conversa). Devolve quantos mudaram. */
export async function transcreverPendentes(conv) {
  let n = 0;
  for (const m of (conv.msgs || []).slice(-6)) {
    if (m.de !== "cliente" || !["audio", "voice"].includes(m.midia) || m.transcrito || !m.midia_id) continue;
    try {
      const { buf, mime } = await baixarMidia(m.midia_id);
      const t = await transcrever(buf, mime);
      m.texto = /^\[inaud[ií]vel\]$/i.test(t) ? "[áudio inaudível]" : `[áudio] ${t}`;
    } catch (e) { console.error("Áudio:", e?.message || e); m.texto = "[áudio não transcrito]"; }
    m.transcrito = true; n++;
  }
  return n;
}
