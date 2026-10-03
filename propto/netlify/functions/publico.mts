import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { db, soDig } from "../../shared/srv.mjs";

// Página pública do anúncio (/a/<token>) e as fotos dela. Sem endereço; contato conforme o tipo de conta.
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const nf = (v: unknown, d = 0) => { const n = Number(String(v ?? "").replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) && n > 0 ? n.toLocaleString("pt-BR", { maximumFractionDigits: d }) : ""; };
const brl = (v: unknown) => (nf(v) ? "R$ " + nf(v) : "");

function pagina(a: any, base: string, tk: string) {
  const fotos: any[] = a.fotos || []; const n = a.numeros || {}; const c = a.contato || {};
  const url = `${base}/a/${tk}`; const img = (i: number) => `/a/${tk}/f/${i}.jpg`;
  const cor = /^#[0-9a-fA-F]{6}$/.test(c.cor || "") ? c.cor : "#C8102E";
  const tel = soDig(c.whatsapp);
  const wa = tel ? `https://wa.me/${tel.length <= 11 ? "55" + tel : tel}?text=${encodeURIComponent(`Olá! Vi o anúncio ${a.codigo} (${a.titulo}) e gostaria de mais informações. ${url}`)}` : "";
  const valores = [[brl(n.venda), "Venda"], [brl(n.aluguel), "Aluguel mensal"], [brl(n.condominio), "Condomínio"], [brl(n.iptu), "IPTU"]].filter((x) => x[0]);
  const fatos = (a.grupo === "rural" ? [[nf(n.area_ha, 2) && nf(n.area_ha, 2) + " ha", "Área total"]] : a.grupo === "galpao" ? [[nf(n.construida) && nf(n.construida) + " m²", "Área construída"], [nf(n.terreno) && nf(n.terreno) + " m²", "Terreno"], [nf(n.pe_direito, 1) && nf(n.pe_direito, 1) + " m", "Pé-direito"], [nf(n.docas), "Docas"]] : a.grupo === "area" ? [[nf(n.terreno) && nf(n.terreno) + " m²", "Terreno"]] : [[nf(n.construida) && nf(n.construida) + " m²", "Área"], [nf(n.dormitorios), "Dormitórios"], [nf(n.suites), "Suítes"], [nf(n.banheiros), "Banheiros"], [nf(n.vagas), "Vagas"]]).filter((x) => x[0]);
  const grupos: { nome: string; itens: number[] }[] = [];
  fotos.forEach((f, i) => { const nm = f.ambiente || "Fotos"; let g = grupos.find((x) => x.nome === nm); if (!g) grupos.push((g = { nome: nm, itens: [] })); g.itens.push(i); });
  const ambDesc: Record<string, string> = Object.fromEntries((a.ambientes || []).map((x: any) => [x.nome, x.descricao || ""]));
  const quem = c.tipo === "proprietario" ? `<b>${esc(c.nome)}</b><span>Proprietário(a) · venda direta</span>` : `<b>${esc(c.nome)}</b><span>${esc([c.titulo, c.creci, c.empresa].filter(Boolean).join(" · "))}</span>`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex"><title>${esc(a.titulo)}</title>
<meta property="og:type" content="website"><meta property="og:title" content="${esc(a.titulo)}"><meta property="og:description" content="${esc(a.subtitulo || String(a.descricao || "").slice(0, 160))}">
${fotos.length ? `<meta property="og:image" content="${base}${img(0)}">` : ""}<meta property="og:url" content="${url}"><meta name="theme-color" content="#0F1720"><link rel="icon" href="/favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700&family=Barlow+Condensed:wght@600;700&display=swap">
<style>
:root{--ink:#1E2227;--ink2:#5A6068;--bg:#F4F5F7;--line:#E3E6E9;--acc:${cor}}
*{box-sizing:border-box;margin:0;padding:0}body{font-family:Barlow,system-ui,sans-serif;color:var(--ink);background:var(--bg);-webkit-font-smoothing:antialiased}
.hero{position:relative;background:#111;aspect-ratio:4/3;max-height:70vh;overflow:hidden}.hero img{width:100%;height:100%;object-fit:cover;display:block}
.hero .ct{position:absolute;right:12px;bottom:12px;background:rgba(0,0,0,.6);color:#fff;font-size:13px;padding:5px 10px;border-radius:999px}
.wrap{max-width:860px;margin:0 auto;padding:20px 16px 120px}
.k{font-size:13px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--acc)}
h1{font-family:'Barlow Condensed',sans-serif;font-size:28px;line-height:1.15;letter-spacing:-.02em;margin:8px 0;text-wrap:balance}.sub{color:var(--ink2);font-size:17px}
.preco{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0}.preco div{background:#fff;border-top:3px solid var(--acc);padding:10px 14px;flex:1;min-width:140px;border-radius:0 0 10px 10px}
.preco b{display:block;font-size:22px;font-variant-numeric:tabular-nums}.preco span{font-size:13px;color:var(--ink2)}
.fatos{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;margin:12px 0 20px}.fatos div{background:#fff;padding:10px 12px;border-radius:10px}
.fatos b{display:block;font-size:20px}.fatos span{font-size:13px;color:var(--ink2)}
h2{font-family:'Barlow Condensed',sans-serif;font-size:20px;margin:28px 0 10px}.txt p{font-size:17px;line-height:1.6;margin-bottom:10px;max-width:65ch}
ul.dest{list-style:none;display:flex;flex-wrap:wrap;gap:8px}ul.dest li{background:#fff;border:1px solid var(--line);padding:7px 12px;border-radius:999px;font-size:15px}
.amb h3{font-size:16px;margin:18px 0 4px}.amb p{color:var(--ink2);font-size:15px;margin-bottom:8px}
.gal{display:flex;gap:8px;overflow-x:auto;scroll-snap-type:x mandatory}.gal img{height:180px;border-radius:10px;scroll-snap-align:start;cursor:zoom-in;flex:none}
.cor{background:var(--ink);color:#fff;border-radius:14px;padding:18px;margin-top:28px}.cor b{font-size:19px;display:block}.cor span{display:block;color:#C2C9D2;font-size:14px;margin-top:4px}
.nota{font-size:13px;color:var(--ink2);margin-top:18px;line-height:1.45}
.feito{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--ink2);margin-top:24px}.feito img{width:96px}.feito a{color:var(--ink2)}
.cta{position:fixed;left:0;right:0;bottom:0;background:#fff;border-top:1px solid var(--line);padding:10px 16px calc(10px + env(safe-area-inset-bottom));z-index:6}
.cta a{display:block;text-align:center;text-decoration:none;font-weight:600;font-size:17px;padding:14px;border-radius:12px;background:var(--acc);color:#fff;max-width:860px;margin:0 auto}
#lb{position:fixed;inset:0;background:rgba(0,0,0,.94);display:none;align-items:center;justify-content:center;z-index:9}#lb img{max-width:100%;max-height:100%}#lb.on{display:flex}
@media(min-width:900px){h1{font-size:40px}.gal img{height:240px}}
</style></head><body>
${fotos.length ? `<div class="hero"><img src="${img(0)}" alt="${esc(fotos[0].ambiente || a.titulo)}" data-i="0"><span class="ct">${fotos.length} foto${fotos.length > 1 ? "s" : ""}</span></div>` : ""}
<div class="wrap">
<p class="k">${esc([a.tipo, a.operacao, a.codigo].filter(Boolean).join(" · "))}</p>
<h1>${esc(a.titulo)}</h1><p class="sub">${esc([a.bairro, a.cidade].filter(Boolean).join(", "))}${a.subtitulo ? " · " + esc(a.subtitulo) : ""}</p>
${valores.length ? `<div class="preco">${valores.map((v) => `<div><b>${esc(v[0])}</b><span>${esc(v[1])}</span></div>`).join("")}</div>` : ""}
${fatos.length ? `<div class="fatos">${fatos.map((v) => `<div><b>${esc(v[0])}</b><span>${esc(v[1])}</span></div>`).join("")}</div>` : ""}
<div class="txt">${String(a.descricao || "").split(/\n\s*\n/).map((p) => `<p>${esc(p)}</p>`).join("")}</div>
${(a.destaques || []).length ? `<h2>Destaques</h2><ul class="dest">${a.destaques.map((d: string) => `<li>${esc(d)}</li>`).join("")}</ul>` : ""}
${grupos.length ? `<h2>Ambientes</h2>${grupos.map((g) => `<div class="amb"><h3>${esc(g.nome)}</h3>${ambDesc[g.nome] ? `<p>${esc(ambDesc[g.nome])}</p>` : ""}<div class="gal">${g.itens.map((i) => `<img loading="lazy" src="${img(i)}" alt="${esc(g.nome)}" data-i="${i}">`).join("")}</div></div>`).join("")}` : ""}
<div class="cor" id="contato">${quem}${c.whatsapp ? `<span>WhatsApp ${esc(c.whatsapp)}</span>` : ""}</div>
<p class="nota">Informações sujeitas a confirmação na visita e na documentação do imóvel. Endereço informado no agendamento. Ref. ${esc(a.codigo)}.</p>
<p class="feito"><img src="/logo-escuro.png" alt="PrimeCorp Brokers" style="width:120px"> · Tecnologia <img src="/marca/propto-horizontal.svg" alt="Propto"></p>
</div>
${wa ? `<div class="cta"><a href="${wa}" target="_blank" rel="noopener">Falar pelo WhatsApp</a></div>` : ""}
<div id="lb"><img alt=""></div>
<script>(function(){var lb=document.getElementById('lb'),li=lb.querySelector('img');document.querySelectorAll('img[data-i]').forEach(function(im){im.onclick=function(){li.src=im.src;lb.className='on'}});lb.onclick=function(){lb.className=''}})();</script>
</body></html>`;
}

export default async (req: Request) => {
  const url = new URL(req.url);
  const m = url.pathname.match(/^\/a\/([^/]+)(?:\/f\/(\d{1,3})\.jpg)?\/?$/);
  if (!m || !TOKEN_RE.test(m[1])) return new Response("Página não encontrada.", { status: 404 });
  const r = await db().sql`SELECT dados, ativo FROM anuncios WHERE token = ${m[1]}`;
  if (!r[0] || !r[0].ativo) return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui;padding:40px;color:#0F1720"><h2>Anúncio indisponível</h2><p>Este imóvel não está mais em divulgação.</p>`, { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
  const a = r[0].dados;
  if (m[2] !== undefined) {
    const f = (a.fotos || [])[Number(m[2])];
    if (!f || !/^fotos\//.test(f.k)) return new Response("Foto não encontrada.", { status: 404 });
    const data = await getStore("fotos").get(f.k, { type: "arrayBuffer" });
    if (!data) return new Response("Foto não encontrada.", { status: 404 });
    return new Response(data as ArrayBuffer, { headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=3600" } });
  }
  try { await db().sql`UPDATE anuncios SET visitas = visitas + 1 WHERE token = ${m[1]}`; } catch {}
  return new Response(pagina(a, url.origin, m[1]), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY" } });
};

export const config: Config = { path: "/a/*", method: ["GET"], rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] } };
