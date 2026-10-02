import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { build } from 'esbuild'; import { NetlifyDB } from "@netlify/database-dev";
const db = new NetlifyDB(); process.env.NETLIFY_DB_URL = await db.start(); await db.applyMigrations("./netlify/database/migrations");
globalThis.__user = { email: 'contato@primecorpconsultoria.com.br' };
fs.rmSync('test/www', { recursive: true, force: true }); fs.cpSync('public', 'test/www', { recursive: true });
await build({ entryPoints: ['src/app.js', 'src/sala.js'], bundle: true, format: 'esm', outdir: 'test/www', alias: { '@netlify/identity': './test/mocks/identity-client.mjs' }, external: ['html2canvas', 'dompurify', 'canvg'], logLevel: 'warning' });
const api = (await import('./out/api.mjs')).default; const sala = (await import('./out/sala.mjs')).default;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/json' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:8899');
  const chunks = []; for await (const c of req) chunks.push(c); const body = chunks.length ? Buffer.concat(chunks) : undefined;
  let fn = null, params = {};
  if (url.pathname.startsWith('/api/')) fn = api;
  const m = url.pathname.match(/^\/publico\/sala\/([^/]+)$/); if (m) { fn = sala; params = { token: m[1] }; }
  if (fn) {
    const h = { ...req.headers }; if (h.origin) h.origin = 'https://pc.test';
    const r = await fn(new Request('https://pc.test' + url.pathname + url.search, { method: req.method, headers: h, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), { params, ip: '127.0.0.1', site: { url: 'http://localhost:8899' } });
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  let f = path.join('test/www', url.pathname === '/' ? 'index.html' : url.pathname);
  if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
}).listen(8899, () => console.log('pronto'));
