import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { obterRegistro, db } from "../../shared/servidor.mjs";

// Landing pública do anúncio (link para WhatsApp). Mostra só o que foi publicado (instantâneo), nunca o endereço.
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const soDig = (s: unknown) => String(s ?? "").replace(/\D/g, "");

function pagina(a: Record<string, any>, base: string, token: string) {
  const fotos: any[] = a.fotos || [];
  const url = `${base}/i/${token}`;
  const img = (i: number) => `/i/${token}/f/${i}.jpg`;
  const tel = soDig(a.corretor?.whatsapp);
  const wa = tel ? `https://wa.me/${tel.length <= 11 ? "55" + tel : tel}?text=${encodeURIComponent(`Olá, ${a.corretor?.nome?.split(" ")[0] || ""}! Tenho interesse no imóvel ${a.codigo || ""} (${a.titulo}). ${url}`)}` : "";
  const grupos: { nome: string; itens: { i: number; legenda: string }[] }[] = [];
  fotos.forEach((f, i) => { const n = f.ambiente || "Fotos"; let g = grupos.find((x) => x.nome === n); if (!g) grupos.push((g = { nome: n, itens: [] })); g.itens.push({ i, legenda: f.legenda || "" }); });
  const ambDesc: Record<string, string> = Object.fromEntries((a.ambientes || []).map((x: any) => [x.nome, x.descricao || ""]));
  const desc = String(a.descricao || "").split(/\n\s*\n/).map((p) => `<p>${esc(p)}</p>`).join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow"><title>${esc(a.titulo)} · PrimeCorp Brokers</title>
<meta property="og:type" content="website"><meta property="og:title" content="${esc(a.titulo)}"><meta property="og:description" content="${esc(a.subtitulo || String(a.descricao || "").slice(0, 160))}">
${fotos.length ? `<meta property="og:image" content="${base}${img(0)}"><meta property="og:image:width" content="1200">` : ""}<meta property="og:url" content="${url}">
<meta name="theme-color" content="#1E2227"><link rel="icon" href="/favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@600;700&display=swap">
<style>
:root{--ink:#1E2227;--ink2:#5A6068;--bg:#F4F5F7;--red:#C8102E;--line:#E3E6E9}
*{box-sizing:border-box;margin:0;padding:0}body{font-family:Barlow,Arial,sans-serif;color:var(--ink);background:var(--bg);-webkit-font-smoothing:antialiased}
.top{position:sticky;top:0;z-index:5;background:#fff;border-bottom:1px solid var(--line);padding:10px 16px;display:flex;align-items:center;justify-content:space-between;border-top:4px solid var(--red)}
.top img{height:28px}.top a{font-size:14px;font-weight:600;color:var(--red);text-decoration:none}
.hero{position:relative;background:#111;aspect-ratio:4/3;max-height:70vh;width:100%;overflow:hidden}.hero img{width:100%;height:100%;object-fit:cover;display:block}
.hero .ct{position:absolute;right:12px;bottom:12px;background:rgba(0,0,0,.6);color:#fff;font-size:13px;padding:5px 10px;border-radius:999px}
.wrap{max-width:860px;margin:0 auto;padding:18px 16px 120px}
.k{font-family:'Barlow Condensed';font-weight:600;letter-spacing:3px;text-transform:uppercase;color:var(--red);font-size:14px}
h1{font-family:'Barlow Condensed';font-size:32px;line-height:1.08;margin:6px 0 6px}.sub{color:var(--ink2);font-size:17px}
.preco{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0}.preco div{background:#fff;border-top:3px solid var(--red);padding:10px 14px;flex:1;min-width:140px}
.preco b{display:block;font-size:22px}.preco span{font-size:13px;color:var(--ink2)}
.fatos{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;margin:12px 0 18px}.fatos div{background:#fff;padding:10px 12px;border-radius:10px}
.fatos b{display:block;font-size:20px}.fatos span{font-size:13px;color:var(--ink2)}
h2{font-family:'Barlow Condensed';font-size:24px;margin:26px 0 10px}.txt p{font-size:17px;line-height:1.55;margin-bottom:10px}
ul.dest{list-style:none;display:flex;flex-wrap:wrap;gap:8px}ul.dest li{background:#fff;border:1px solid var(--line);padding:7px 12px;border-radius:999px;font-size:15px}
.amb h3{font-size:17px;margin:18px 0 4px}.amb p{color:var(--ink2);font-size:15px;margin-bottom:8px}
.gal{display:flex;gap:8px;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:4px}.gal img{height:180px;border-radius:10px;scroll-snap-align:start;cursor:zoom-in;flex:none}
.cor{background:var(--ink);color:#fff;border-radius:14px;padding:18px;margin-top:28px}.cor b{font-size:19px}.cor span{display:block;color:#C9CDD2;font-size:14px;margin-top:4px}
.nota{font-size:13px;color:var(--ink2);margin-top:18px;line-height:1.45}
.feito{display:flex;align-items:center;gap:8px;font-size:12px;color:#626C79;margin-top:22px}.feito img{width:104px;height:auto;display:block}
.cta{position:fixed;left:0;right:0;bottom:0;background:#fff;border-top:1px solid var(--line);padding:10px 16px calc(10px + env(safe-area-inset-bottom));display:flex;gap:10px;z-index:6}
.cta a{flex:1;text-align:center;text-decoration:none;font-weight:700;font-size:17px;padding:14px;border-radius:12px;background:var(--red);color:#fff}
.cta a.s{flex:none;background:#fff;color:var(--ink);border:1px solid var(--line);padding:14px 16px}
#lb{position:fixed;inset:0;background:rgba(0,0,0,.94);display:none;align-items:center;justify-content:center;z-index:9}#lb img{max-width:100%;max-height:100%}#lb.on{display:flex}
@media(min-width:900px){h1{font-size:44px}.gal img{height:240px}}
</style></head><body>
<div class="top"><img src="/logo-escuro.png" alt="PrimeCorp Brokers"><a href="#contato">Falar com o corretor</a></div>
${fotos.length ? `<div class="hero"><img src="${img(0)}" alt="${esc(fotos[0].ambiente || a.titulo)}" data-i="0"><span class="ct">${fotos.length} foto${fotos.length > 1 ? "s" : ""}</span></div>` : ""}
<div class="wrap">
<p class="k">${esc([a.tipo, a.operacao, a.codigo].filter(Boolean).join(" · "))}</p>
<h1>${esc(a.titulo)}</h1><p class="sub">${esc([a.regiao, a.cidade].filter(Boolean).join(", "))}${a.subtitulo ? " · " + esc(a.subtitulo) : ""}</p>
${(a.valores || []).length ? `<div class="preco">${a.valores.map((v: any) => `<div><b>${esc(v[1])}</b><span>${esc(v[0])}</span></div>`).join("")}</div>` : ""}
${(a.fatos || []).length ? `<div class="fatos">${a.fatos.map((v: any) => `<div><b>${esc(v[1])}</b><span>${esc(v[0])}</span></div>`).join("")}</div>` : ""}
<div class="txt">${desc}</div>
${(a.destaques || []).length ? `<h2>Destaques</h2><ul class="dest">${a.destaques.map((d: string) => `<li>${esc(d)}</li>`).join("")}</ul>` : ""}
${grupos.length ? `<h2>Ambientes</h2>${grupos.map((g) => `<div class="amb"><h3>${esc(g.nome)}</h3>${ambDesc[g.nome] ? `<p>${esc(ambDesc[g.nome])}</p>` : ""}<div class="gal">${g.itens.map((x) => `<img loading="lazy" src="${img(x.i)}" alt="${esc(g.nome)}" data-i="${x.i}">`).join("")}</div></div>`).join("")}` : ""}
<div class="cor" id="contato"><b>${esc(a.corretor?.nome || "PrimeCorp Brokers")}</b><span>Corretor(a) de imóveis${a.corretor?.creci ? " · " + esc(a.corretor.creci) : ""} · PrimeCorp Brokers</span>${a.corretor?.whatsapp ? `<span>WhatsApp ${esc(a.corretor.whatsapp)}</span>` : ""}</div>
<p class="nota">Informações fornecidas pelo proprietário e sujeitas a confirmação em visita e na documentação do imóvel. Endereço informado no agendamento da visita. Ref. ${esc(a.codigo || "")}.</p>
<p class="feito">Anúncio criado com <a href="https://www.propto.com.br" target="_blank" rel="noopener"><img src="/marca/propto-horizontal.svg" alt="Propto"></a></p>
</div>
${wa ? `<div class="cta"><a href="${wa}" target="_blank" rel="noopener">Agendar visita pelo WhatsApp</a></div>` : ""}
<div id="lb"><img alt=""></div>
<script>(function(){var lb=document.getElementById('lb'),li=lb.querySelector('img');document.querySelectorAll('img[data-i]').forEach(function(im){im.onclick=function(){li.src=im.src;lb.className='on'}});lb.onclick=function(){lb.className=''}})();</script>
</body></html>`;
}

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const m = url.pathname.match(/^\/i\/([^/]+)(?:\/f\/(\d{1,3})\.jpg)?\/?$/);
  if (!m || !TOKEN_RE.test(m[1])) return new Response("Página não encontrada.", { status: 404 });
  const a = await obterRegistro("anuncios", m[1]);
  if (!a || a.status !== "ativo") return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:Arial;padding:40px;color:#1E2227"><h2>Anúncio indisponível</h2><p>Este imóvel não está mais em divulgação. Fale com a PrimeCorp Brokers para conhecer outras opções.</p>`, { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
  if (m[2] !== undefined) {
    const f = (a.fotos || [])[Number(m[2])];
    if (!f || !/^fotos\//.test(f.k)) return new Response("Foto não encontrada.", { status: 404 });
    const data = await getStore("fotos").get(f.k, { type: "arrayBuffer" });
    if (!data) return new Response("Foto não encontrada.", { status: 404 });
    return new Response(data as ArrayBuffer, { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=3600" } });
  }
  try { await db().sql`UPDATE registros SET dados = jsonb_set(dados, '{visitas}', to_jsonb(COALESCE((dados->>'visitas')::int, 0) + 1)) WHERE colecao = 'anuncios' AND id = ${m[1]}`; } catch {}
  return new Response(pagina(a, url.origin, m[1]), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY" } });
};

export const config: Config = {
  path: "/i/*",
  method: ["GET"],
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
