import type { Config, Context } from "@netlify/functions";
import { normalizarLead, registrarLead } from "../../shared/site.mjs";
import { avisarOuEnfileirar } from "../../shared/zoe-run.mjs";

// Público: formulários do site primecorpconsultoria.com.br. Grava o lead, avisa a equipe e devolve o link da assistente no WhatsApp.
const ORIGENS = ["https://primecorpconsultoria.com.br", "https://www.primecorpconsultoria.com.br", "https://primecorp-consultoria.netlify.app"];
export default async (req: Request, context: Context) => {
  const origem = req.headers.get("origin") || "";
  const cors: Record<string, string> = { "access-control-allow-origin": ORIGENS.includes(origem) ? origem : ORIGENS[0], "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type", vary: "origin" };
  const resp = (j: unknown, status = 200) => new Response(JSON.stringify(j), { status, headers: { ...cors, "content-type": "application/json" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return resp({ erro: "Método não permitido" }, 405);
  if (!ORIGENS.includes(origem)) return resp({ erro: "Origem não permitida" }, 403);
  const texto = await req.text(); if (texto.length > 8000) return resp({ erro: "Dados grandes demais" }, 413);
  let dados; try { dados = normalizarLead(JSON.parse(texto)); } catch (e: any) { return e?.silencioso ? resp({ ok: true }) : resp({ erro: e?.message || "Dados inválidos" }, 400); }
  try {
    const r = await registrarLead(dados, context.ip || "");
    await avisarOuEnfileirar(`Novo cadastro no site · ${r.linha} · ${dados.nome}${dados.municipio ? " · " + dados.municipio : ""} · +${dados.wa} · código ${r.codigo}. A assistente assume pelo WhatsApp.`).catch((e) => console.error("Aviso do lead:", e));
    return resp({ ok: true, codigo: r.codigo, whatsapp: r.link });
  } catch (e: any) { return resp({ erro: e?.message || "Falha ao registrar" }, e?.status || 500); }
};

export const config: Config = { path: "/site/lead" };
