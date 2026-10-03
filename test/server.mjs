import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { build } from 'esbuild'; import { NetlifyDB } from "@netlify/database-dev";
const db = new NetlifyDB(); process.env.NETLIFY_DB_URL = await db.start(); await db.applyMigrations("./netlify/database/migrations");
globalThis.__user = { email: 'contato@primecorpconsultoria.com.br' }; process.env.ADMIN_EMAILS = process.env.ADMIN_EMAILS || 'contato@primecorpconsultoria.com.br';
fs.rmSync('test/www', { recursive: true, force: true }); fs.cpSync('public', 'test/www', { recursive: true });
await build({ entryPoints: ['src/app.js', 'src/sala.js', 'src/anunciante.js'], bundle: true, format: 'esm', outdir: 'test/www', alias: { '@netlify/identity': './test/mocks/identity-client.mjs' }, external: ['html2canvas', 'dompurify', 'canvg'], logLevel: 'warning' });
const api = (await import('./out/api.mjs')).default; const sala = (await import('./out/sala.mjs')).default; const anun = (await import('./out/anunciante.mjs')).default; const imov = (await import('./out/imovel.mjs')).default;
const MIME = { '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/json' };
// leitura de link simulada: só o IP público de teste; o resto segue o fetch real
const fetchReal = globalThis.fetch;
globalThis.fetch = async (u, o) => { const s = String(u); if (s.startsWith('https://93.184.215.14/')) { if (/\/img\/(\d)\.jpg/.test(s)) return new Response(fs.readFileSync('/tmp/claude-0/fotos_teste/f' + (Number(s.match(/\/img\/(\d)/)[1]) % 4 + 1) + '.jpg'), { headers: { 'content-type': 'image/jpeg' } });
  if (s.includes('/galpao-fotos')) return new Response(`<html><head><title>Galpão 2.400 m² Hortolândia</title><meta property="og:image" content="https://93.184.215.14/img/1.jpg"><script type="application/ld+json">{"@type":"Product","image":["https://93.184.215.14/img/2.jpg","https://93.184.215.14/img/3.jpg"],"seller":{"name":"Imobiliária Horizonte","telephone":"(19) 3333-2211"}}</script></head><body><img src="/img/logo.png"><img data-src="https://93.184.215.14/img/4.jpg"><a href="https://wa.me/5519987654321">WhatsApp</a><p>${'Galpão Industrial Exemplo com 2.400 m² de área construída, pé-direito 10 m, 4 docas. Locação R$ 60.000. '.repeat(6)}</p></body></html>`, { headers: { 'content-type': 'text/html' } });
  if (s.includes('/bloqueado')) return new Response('<html>Access denied</html>', { status: 403, headers: { 'content-type': 'text/html' } }); return new Response(`<html><head><title>Apartamento 2 dormitórios no Cambuí</title><meta property="og:description" content="Apartamento 2 dormitórios, 1 suíte, 68 m², R$ 520 mil"></head><body><p>${'Apartamento 2 dormitórios com varanda, lazer completo. '.repeat(10)}</p></body></html>`, { headers: { 'content-type': 'text/html' } }); } return fetchReal(u, o); };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:8899');
  const chunks = []; for await (const c of req) chunks.push(c); const body = chunks.length ? Buffer.concat(chunks) : undefined;
  let fn = null, params = {};
  if (url.pathname.startsWith('/api/')) fn = api;
  const m = url.pathname.match(/^\/publico\/sala\/([^/]+)$/); if (m) { fn = sala; params = { token: m[1] }; }
  const m2 = url.pathname.match(/^\/publico\/anunciante\/([^/]+)$/); if (m2) { fn = anun; params = { token: m2[1] }; }
  if (url.pathname.startsWith('/i/')) fn = imov;
  const tu = /(?:^|; )tu=([^;]+)/.exec(req.headers.cookie || ''); globalThis.__user = { email: tu ? decodeURIComponent(tu[1]) : 'contato@primecorpconsultoria.com.br' };
  if (fn) {
    const h = { ...req.headers }; if (h.origin) h.origin = 'https://pc.test';
    const r = await fn(new Request('https://pc.test' + url.pathname + url.search, { method: req.method, headers: h, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), { params, ip: '127.0.0.1', site: { url: 'http://localhost:8899' } });
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  let f = path.join('test/www', url.pathname === '/' ? 'index.html' : url.pathname);
  if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
}).listen(8899, () => console.log('pronto'));
