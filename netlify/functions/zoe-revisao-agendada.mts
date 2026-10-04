import type { Config, Context } from "@netlify/functions";
import { env } from "../../shared/servidor.mjs";

// Toda segunda-feira às 08:00 (Brasília) dispara a revisão semanal da Zoe.
export default async (_req: Request, context: Context) => {
  if (!env("COLETA_SEGREDO")) { console.log("Revisão não disparada: defina COLETA_SEGREDO."); return; }
  const base = context.site?.url || env("URL");
  const r = await fetch(new URL("/.netlify/functions/zoe-revisao-background", base), { method: "POST", headers: { "x-coleta-segredo": env("COLETA_SEGREDO") as string } });
  console.log("Revisão da Zoe disparada:", r.status);
};

export const config: Config = { schedule: "0 11 * * 1" };
