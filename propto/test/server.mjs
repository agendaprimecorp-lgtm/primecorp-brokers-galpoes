import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { build } from 'esbuild'; import { NetlifyDB } from "@netlify/database-dev";
import { instalarAsaas } from './mocks/asaas-fetch.mjs';
const db = new NetlifyDB(); process.env.NETLIFY_DB_URL = await db.start(); await db.applyMigrations("./netlify/database/migrations");
process.env.ADMIN_EMAILS = 'contato@primecorpconsultoria.com.br,comercial@primecorpconsultoria.com.br'; process.env.ASAAS_API_KEY = 'teste_asaas'; process.env.ASAAS_WEBHOOK_TOKEN = 'tok_webhook_123';
const st = instalarAsaas();
fs.rmSync('test/www', { recursive: true, force: true }); fs.cpSync('public', 'test/www', { recursive: true });
await build({ entryPoints: ['src/app.js'], bundle: true, format: 'esm', outdir: 'test/www', alias: { '@netlify/identity': './test/mocks/identity-client.mjs' }, external: ['html2canvas', 'dompurify', 'canvg'], logLevel: 'warning' });
const api = (await import('./out/api.mjs')).default; const wh = (await import('./out/asaas.mjs')).default; const pub = (await import('./out/publico.mjs')).default;
const MIME = { '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:8898');
  const chunks = []; for await (const c of req) chunks.push(c); const body = chunks.length ? Buffer.concat(chunks) : undefined;
  if (url.pathname === '/__asaas') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(st)); return; }
  let fn = null;
  if (url.pathname.startsWith('/api/')) fn = api; else if (url.pathname === '/webhook/asaas') fn = wh; else if (url.pathname.startsWith('/a/')) fn = pub;
  const tu = /(?:^|; )tu=([^;]+)/.exec(req.headers.cookie || ''); globalThis.__user = tu ? { email: decodeURIComponent(tu[1]) } : null;
  if (fn) {
    const h = { ...req.headers }; if (h.origin) h.origin = 'https://propto.test';
    const r = await fn(new Request('https://propto.test' + url.pathname + url.search, { method: req.method, headers: h, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), { params: {}, ip: '127.0.0.1' });
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  let p = url.pathname === '/' ? '/index.html' : url.pathname.startsWith('/app') && !path.extname(url.pathname) ? '/app.html' : url.pathname;
  const f = path.join('test/www', p);
  if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
}).listen(8898, () => console.log('pronto 8898'));
