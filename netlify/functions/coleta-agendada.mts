import type { Config, Context } from "@netlify/functions";
import { env } from "../../shared/servidor.mjs";

// A cada 30 minutos dispara a coleta de e-mails de alerta (só se a caixa estiver configurada).
export default async (req: Request, context: Context) => {
  if (!env("ALERTAS_IMAP_USER") || !env("ALERTAS_IMAP_SENHA") || !env("COLETA_SEGREDO")) {
    console.log("Coleta não configurada: defina ALERTAS_IMAP_USER, ALERTAS_IMAP_SENHA e COLETA_SEGREDO.");
    return;
  }
  const base = context.site?.url || env("URL");
  const r = await fetch(new URL("/.netlify/functions/coleta-background", base), {
    method: "POST",
    headers: { "x-coleta-segredo": env("COLETA_SEGREDO") as string },
  });
  console.log("Coleta disparada:", r.status);
};

export const config: Config = { schedule: "*/30 * * * *" };
