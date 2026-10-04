import { timingSafeEqual } from "node:crypto";
import { env } from "../../shared/servidor.mjs";
import { revisarSemana } from "../../shared/zoe-revisao.mjs";

// Revisão semanal da Zoe (segundo plano): analisa a semana e grava sugestões para aprovação.
function segredoOk(req: Request) {
  const esperado = env("COLETA_SEGREDO") || ""; const veio = req.headers.get("x-coleta-segredo") || "";
  return !!esperado && esperado.length === veio.length && timingSafeEqual(Buffer.from(esperado), Buffer.from(veio));
}
export default async (req: Request) => {
  if (!segredoOk(req)) { console.log("Revisão: chamada sem segredo recusada."); return; }
  try { console.log("Revisão da Zoe:", JSON.stringify(await revisarSemana({ base: env("URL") || new URL(req.url).origin }))); }
  catch (e) { console.error("Revisão da Zoe falhou:", e); }
};
