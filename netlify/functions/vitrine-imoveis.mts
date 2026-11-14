import type { Config, Context } from "@netlify/functions";
import { db } from "../../shared/servidor.mjs";

// Vitrine pública para o site de imóveis (sem login).
// Devolve objetos no formato que o site (assets/propto.js) já entende e revalida.
// Só entra anúncio de venda, ativo, com CRECI do responsável e dados essenciais.
// A autorização do proprietário NÃO é exigida nesta fase (decisão do dono, 14/11/2026).
// Nunca devolve endereço exato nem contato pessoal.

const ORIGEM = "https://propto.com.br";
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

const sem = (t: unknown) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// "R$ 450.000,00" → 450000 ; número → número ; vazio → 0
function numeroBR(v: unknown): number {
  if (typeof v === "number") return v;
  const s = String(v ?? "").replace(/[^\d,.-]/g, "");
  if (!s) return 0;
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

// Preço principal de venda: o valor cujo rótulo fala de venda/preço; senão o primeiro.
function precoDeVenda(valores: any[]): number {
  if (!Array.isArray(valores) || !valores.length) return 0;
  const alvo = valores.find((v) => /venda|preco|valor/.test(sem(v?.[0])));
  return numeroBR((alvo ?? valores[0])?.[1]);
}

function motivoRecusa(a: any): string | null {
  if (sem(a?.status) !== "ativo") return "não ativo";
  if (!sem(a?.operacao).includes("venda") || sem(a?.operacao).includes("locac")) return "não é venda";
  if (!String(a?.corretor?.creci ?? "").trim()) return "sem CRECI";
  if (!a?.tipo || !a?.cidade) return "faltam tipo ou cidade";
  if (!(precoDeVenda(a?.valores) > 0)) return "sem preço de venda";
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
    imoveis.push({
      id: l.id,
      codigo: String(a.codigo ?? ""),
      status: "ativo",
      operacao: "venda",
      tipo: a.tipo,
      titulo: a.titulo || "",
      descricao: a.descricao || "",
      cidade: a.cidade,
      uf: String(a.uf || "SP").toUpperCase().slice(0, 2),
      bairro: a.bairro || "",
      regiao: a.regiao || "",
      preco: precoDeVenda(a.valores),
      creci: String(a.corretor.creci).trim(),
      fotos: (a.fotos || []).slice(0, 12).map((_: unknown, i: number) => `${ORIGEM}/i/${l.id}/f/${i}.jpg`),
      publicado_em: a.publicado_em || null,
    });
  }
  return new Response(JSON.stringify({ imoveis }), { headers: cab });
};

export const config: Config = { path: "/vitrine/imoveis", method: ["GET", "OPTIONS"], rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] } };
