import type { Config } from "@netlify/functions";
import { entregarFila } from "../../shared/zoe-run.mjs";

// A cada 15 min: se o expediente começou, entrega à equipe os avisos acumulados fora do horário.
export default async () => {
  try { const r = await entregarFila(); if (r.entregues) console.log("Avisos entregues:", r.entregues); } catch (e) { console.error("Fila de avisos:", e); }
};

// PAUSADO em 24/10/2026 para economizar creditos (original: "*/15 * * * *"). Roda so 1x/ano ate reconfigurar.
export const config: Config = { schedule: "0 3 1 1 *" };
