/* ============================================================
   /api/publicos — a vitrine pública do Propto para o site
   Rota: https://propto.com.br/vitrine/imoveis
   Sem login: só devolve anúncio publicado, com autorização
   declarada, CRECI do responsável e operação de venda.
   Nunca devolve: endereço exato, anunciante terceiro, origem,
   contato pessoal, nem qualquer coisa de locação.
   ============================================================ */
import type { Config, Context } from "@netlify/functions";
import { db, env } from "../../shared/srv.mjs";
import { grupo } from "../../../shared/roteiro.mjs";

const BASE = "https://propto.com.br";
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

const semAcento = (t: unknown) =>
  String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/* Tipo do Propto → slug da carteira do site (assets/carteira.js) */
const SLUG: Record<string, string> = {
  "Casa": "casa", "Casa em condomínio": "casa-condominio", "Apartamento": "apartamento",
  "Sobrado": "sobrado", "Cobertura": "cobertura", "Kitnet / studio": "studio",
  "Sala comercial": "sala-comercial", "Loja": "loja-ponto", "Ponto comercial": "loja-ponto",
  "Prédio comercial": "predio-comercial", "Imóvel comercial": "sala-comercial",
  "Galpão": "galpao", "Galpão em condomínio": "galpao", "Barracão": "barracao",
  "Terreno": "terreno-urbano", "Lote em condomínio": "terreno-urbano", "Área / terreno": "terreno-urbano",
  "Área industrial": "area-industrial", "Área comercial": "area-comercial",
  "Fazenda": "fazenda", "Sítio": "sitio", "Chácara": "chacara", "Haras": "haras",
};
const ARTE: Record<string, string> = { galpao: "galpao", area: "terreno", comercial: "predio", rural: "rural", residencial: "residencial" };

const num = (v: unknown) => {
  const n = Number(String(v ?? "").replace(/[^\d.,-]/g, "").replace(/\.(?=\d{3})/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : 0;
};
const m2 = (n: number) => `${n.toLocaleString("pt-BR")} m²`;

/* Regras de publicação: as mesmas do site, aplicadas aqui também. */
function motivoRecusa(s: any): string | null {
  if (!semAcento(s.operacao).includes("venda") || semAcento(s.operacao).includes("locacao")) return "não é venda";
  if (!s.declaracao?.por || !s.declaracao?.em) return "sem declaração de autorização do proprietário";
  if (!String(s.contato?.creci ?? "").trim()) return "sem CRECI do responsável";
  if (!s.cidade || !s.tipo) return "faltam tipo ou cidade";
  if (!(num(s.numeros?.venda) > 0)) return "sem preço de venda";
  return null;
}

function paraVitrine(token: string, s: any) {
  const grp = grupo(s.tipo);
  const area = num(s.numeros?.construida) || num(s.numeros?.terreno) || Math.round(num(s.numeros?.area_ha) * 10000);
  const fotos = (s.fotos || []).slice(0, 12).map((_: unknown, i: number) => `${BASE}/a/${token}/f/${i}.jpg`);
  const dados: [string, string][] = [];
  if (area) dados.push(["Área", m2(area)]);
  if (num(s.numeros?.dormitorios)) dados.push(["Dormitórios", String(num(s.numeros.dormitorios))]);
  if (num(s.numeros?.vagas)) dados.push(["Vagas", String(num(s.numeros.vagas))]);
  return {
    ref: String(s.codigo ?? "").trim(),
    tipo: SLUG[s.tipo] ?? "casa",
    titulo: s.titulo || s.tipo,
    descricao: s.descricao || "",
    cidade: s.cidade,
    uf: String(s.uf || "SP").toUpperCase().slice(0, 2),
    onde: [s.cidade, s.uf || "SP"].filter(Boolean).join("/") + (s.bairro ? " · " + s.bairro : ""),
    preco: num(s.numeros.venda),
    area,
    creci: String(s.contato.creci).trim(),
    arte: ARTE[grp] ?? "residencial",
    dados: dados.slice(0, 3),
    fotos,
  };
}

export default async (req: Request, _context: Context) => {
  const cab: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": env("PUBLICOS_ORIGEM") || "https://www.primecorpimoveis.com.br",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=3600",
  };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cab });
  if (req.method !== "GET") return new Response("{}", { status: 405, headers: cab });

  const org = env("PUBLICOS_ORG_ID");
  if (!org) return new Response(JSON.stringify({ imoveis: [], aviso: "PUBLICOS_ORG_ID não configurada" }), { headers: cab });

  const linhas = await db().sql`SELECT token, dados, atualizado_em FROM anuncios WHERE ativo = TRUE AND org_id = ${org} ORDER BY atualizado_em DESC LIMIT 200`;
  const imoveis: any[] = [];
  for (const l of linhas) {
    if (!TOKEN_RE.test(l.token)) continue;
    if (motivoRecusa(l.dados)) continue;
    imoveis.push(paraVitrine(l.token, l.dados));
  }
  return new Response(JSON.stringify({ imoveis }), { headers: cab });
};

export const config: Config = { path: "/vitrine/imoveis", method: ["GET", "OPTIONS"], rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] } };
