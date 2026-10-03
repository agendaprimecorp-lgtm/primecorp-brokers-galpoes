import { timingSafeEqual } from "node:crypto";
import { env } from "../../shared/servidor.mjs";
import { processarConversa } from "../../shared/zoe-run.mjs";

// Zoe em segundo plano: responde a conversa do WhatsApp (até 15 min de execução).
function segredoOk(req: Request) {
  const esperado = env("COLETA_SEGREDO") || ""; const veio = req.headers.get("x-coleta-segredo") || "";
  return !!esperado && esperado.length === veio.length && timingSafeEqual(Buffer.from(esperado), Buffer.from(veio));
}
export default async (req: Request) => {
  if (!segredoOk(req)) { console.log("Zoe: chamada sem segredo recusada."); return; }
  const { wa, espera } = await req.json().catch(() => ({}));
  if (!/^\d{8,15}$/.test(String(wa || ""))) return;
  const base = env("URL") || new URL(req.url).origin;
  let r = await processarConversa(String(wa), { base, esperaMs: espera === 0 ? 0 : 2500 });
  for (let i = 0; i < 2 && r?.reprocessar; i++) r = await processarConversa(String(wa), { base, esperaMs: 0 });
  console.log("Zoe:", wa, JSON.stringify(r).slice(0, 300));
};
