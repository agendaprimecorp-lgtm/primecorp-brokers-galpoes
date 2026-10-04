import type { Config } from "@netlify/functions";
import { convidarLeads } from "../../shared/zoe-run.mjs";

// A cada 5 min: quem se cadastrou no site e não chamou no WhatsApp em 10 min recebe o primeiro contato da assistente (8h–20h).
export default async () => {
  try { const r = await convidarLeads(); if (r.convidados) console.log("Leads convidados:", r.convidados); } catch (e) { console.error("Leads do site:", e); }
};

export const config: Config = { schedule: "*/5 * * * *" };
