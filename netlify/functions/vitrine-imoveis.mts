import type { Config, Context } from "@netlify/functions";
import { db } from "../../shared/servidor.mjs";

// Vitrine pública para o site de imóveis (sem login).
// Só entra anúncio: status "ativo", autorização do proprietário "aceita", operação de venda,
// CRECI do responsável. Nunca devolve endereço exato, contato pessoal nem dados internos.

const ORIGEM = "https://propto.com.br";
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

const sem = (t: unknown) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

const TIPO: Record<string, string> = {
  casa: "casa", apartamento: "apartamento", terreno: "terreno-urbano", lote: "terreno-urbano",
  galpao: "galpao", galpão: "galpao", barracao: "barracao", barracão: "barracao",
  sala: "sala-comercial", loja: "loja-ponto", ponto: "loja-ponto", predio: "predio-comercial", prédio: "predio-comercial",
  fazenda: "fazenda", sitio: "sitio", sítio: "sitio", chacara: "chacara", chácara: "chacara",
};
const tipoSlug = (t: unknown) => { const s = sem(t); const k = Object.keys(TIPO).find((x) => s.includes(sem(x))); return k ? TIPO[k] : "casa"; };
const arteDe = (slug: string) =>
  /galpao|barracao|area-industrial/.test(slug) ? "galpao" : /terreno|area/.test(slug) ? "terreno" : /predio|sala|loja/.test(slug) ? "predio" : /fazenda|sitio|chacara|haras|rural/.test(slug) ? "rural" : "residencial";

function motivoRecusa(a: any): string | null {
  if (a?.status !== "ativo") return "não ativo";
  if (a?.autorizacao?.status !== "aceita") return "sem autorização do proprietário";
  if (!String(a?.corretor?.creci ?? "").trim()) return "sem CRECI";
  if (!sem(a?.operacao).includes("venda") || sem(a?.operacao).includes("locac")) return "não é venda";
  return null;
}

export default async (req: Request, _context: Context) => {
  const cab: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "https://www.primecorpimoveis.com.br",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=3600",
  };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cab });
  if (req.method !== "GET") return new Response("{}", { status: 405, headers: cab });

  const linhas = await db().sql`SELECT id, dados FROM registros WHERE colecao = 'anuncios' AND excluido = FALSE ORDER BY atualizado_em DESC LIMIT 300`;
  const imoveis: any[] = [];
  for (const l of linhas) {
    const a = l.dados || {};
    if (!TOKEN_RE.test(l.id) || motivoRecusa(a)) continue;
    const slug = tipoSlug(a.tipo);
    const fotos = (a.fotos || []).slice(0, 12).map((_: unknown, i: number) => `${ORIGEM}/i/${l.id}/f/${i}.jpg`);
    imoveis.push({
      ref: String(a.codigo ?? ""),
      tipo: slug,
      titulo: a.titulo || "",
      descricao: a.descricao || "",
      cidade: a.cidade || "",
      uf: String(a.uf || "SP").toUpperCase().slice(0, 2),
      bairro: a.bairro || "",
      precos: (a.valores || []).map((v: any) => [String(v[0] ?? ""), String(v[1] ?? "")]),
      creci: String(a.corretor.creci).trim(),
      arte: arteDe(slug),
      fotos,
      url: `${ORIGEM}/i/${l.id}`,
    });
  }
  return new Response(JSON.stringify({ imoveis }), { headers: cab });
};

export const config: Config = { path: "/vitrine/imoveis", method: ["GET", "OPTIONS"], rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] } };
