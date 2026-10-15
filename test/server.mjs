import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { build } from 'esbuild'; import { NetlifyDB } from "@netlify/database-dev";
const db = new NetlifyDB(); process.env.NETLIFY_DB_URL = await db.start(); await db.applyMigrations("./netlify/database/migrations");
globalThis.__user = { email: 'contato@primecorpconsultoria.com.br' }; process.env.ADMIN_EMAILS = process.env.ADMIN_EMAILS || 'contato@primecorpconsultoria.com.br';
fs.rmSync('test/www', { recursive: true, force: true }); fs.cpSync('public', 'test/www', { recursive: true });
await build({ entryPoints: ['src/app.js', 'src/sala.js', 'src/anunciante.js', 'src/cadastro.js'], bundle: true, format: 'esm', outdir: 'test/www', alias: { '@netlify/identity': './test/mocks/identity-client.mjs' }, external: ['html2canvas', 'dompurify', 'canvg'], logLevel: 'warning' });
const api = (await import('./out/api.mjs')).default; const sala = (await import('./out/sala.mjs')).default; const anun = (await import('./out/anunciante.mjs')).default; const imov = (await import('./out/imovel.mjs')).default;
const wh = (await import('./out/whatsapp.mjs')).default; const plead = (await import('./out/propto-lead.mjs')).default; const pcad = (await import('./out/propto-cadastro.mjs')).default; const awh = (await import('./out/asaas-webhook.mjs')).default; const zbg = (await import('./out/zoe-background.mjs')).default; const mbg = (await import('./out/matricula-background.mjs')).default;
Object.assign(process.env, { COLETA_SEGREDO: 's'.repeat(40), WHATSAPP_APP_SECRET: 'segredo-app', WHATSAPP_VERIFY_TOKEN: 'tok', WHATSAPP_TOKEN: 'tk', WHATSAPP_PHONE_ID: '999', WHATSAPP_NUMERO: '(19) 99805-1985', ZOE_EQUIPE: '19998051985' });
process.env.ASAAS_API_KEY = '$aact_e2e'; process.env.ASAAS_WEBHOOK_TOKEN = 'w'.repeat(40); const _subs = {};
globalThis.__fetchAsaas = async (url, o) => { const u = String(url); const r = (j) => new Response(JSON.stringify(j), { status: 200, headers: { 'content-type': 'application/json' } }); const b = o.body ? JSON.parse(o.body) : {};
  if (u.endsWith('/customers')) return r({ id: 'cus_e2e' }); if (u.endsWith('/subscriptions') && o.method === 'POST') { const id = 'sub_' + Date.now().toString(36); _subs[id] = b; return r({ id }); }
  const m = u.match(/subscriptions\/(sub_[a-z0-9]+)\/payments/); if (m) { const s = _subs[m[1]] || {}; return r({ data: [{ id: 'pay_' + m[1], status: 'PENDING', dueDate: s.nextDueDate, value: s.value, invoiceUrl: 'https://sandbox.asaas.com/i/' + m[1] }] }); } return r({}); };
globalThis.__fetchWA = async () => new Response(JSON.stringify({ messages: [{ id: 'wamid.' + Date.now() }] }), { status: 200 });
globalThis.__fetchVerif = async (url) => { const u = String(url); const r = (j, st = 200) => new Response(JSON.stringify(j), { status: st, headers: { 'content-type': 'application/json' } });
  if (u.includes('/cep/v2/13170')) return r({ state: 'SP', city: 'Sumaré', neighborhood: 'Jardim Bom Retiro', street: 'Rua Dom Barreto', location: { coordinates: { latitude: '-22.82', longitude: '-47.27' } } });
  if (u.includes('nominatim')) return r([{ lat: '-22.8211', lon: '-47.2671', address: { city: 'Sumaré' } }]);
  if (u.includes('/cnpj/v1/11222333000181')) return r({ razao_social: 'INDUSTRIA X LTDA', descricao_situacao_cadastral: 'ATIVA', municipio: 'SUMARE', uf: 'SP' });
  return r({}, 404); };
globalThis.__matricula = { numero: '45678', cartorio: 'Oficial de Registro de Imóveis de Sumaré', data_certidao: new Date(Date.now() - 4 * 864e5).toISOString().slice(0, 10), descricao: 'Galpão industrial com terreno de 10.050 m², no loteamento Distrito Industrial.', area_terreno: 10050, construcao_averbada: true, area_construida_averbada: 5900,
  proprietarios: [{ nome: 'INDÚSTRIA X LTDA', documento: '11.222.333/0001-81', fracao: '100%' }], onus: [{ ato: 'R-7', tipo: 'Hipoteca', descricao: 'Banco Y S.A., cédula de crédito industrial', cancelado: true, cancelado_por: 'AV-9' }, { ato: 'AV-10', tipo: 'Penhora', descricao: 'Execução fiscal municipal, processo 1500123-45.2025', cancelado: false }], ultimos_atos: ['R-6 compra e venda (2019)', 'AV-10 penhora (2025)'], alertas: ['Penhora ativa: exigir baixa antes da escritura.'] };
const passo = (tool, input) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu' + Math.random(), name: tool, input }] });
const fala = (t) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }] });
globalThis.__zoe = (req) => { const last = req.messages[req.messages.length - 1]; const eq = /MODO EQUIPE/.test(req.system);
  if (typeof last.content === 'string') { const t = last.content.toLowerCase();
    if (eq) return passo('resumo_operacao', {});
    if (/galp/.test(t)) return passo('registrar_demanda', { nome: 'Carlos', empresa: 'Log Z', tipo: 'Galpão', operacao: 'Locação', cidades: 'Sumaré', area_min: 5000, area_max: 7000 });
    if (/marcar|agendar|reuni/.test(t)) return passo('horarios_livres', { dias_a_frente: 5 });
    return fala('Olá! Sou a Zoe, assistente virtual da PrimeCorp Brokers. Seus dados são usados só para este atendimento (LGPD). Para falar com uma pessoa, digite HUMANO.\nComo posso ajudar?\n[[botoes: Busco imóvel | Tenho um imóvel | Sou corretor(a)]]'); }
  const res = JSON.parse(last.content[0].content);
  if (res.briefing) return passo('buscar_imoveis', { tipo: 'Galpão', operacao: 'Locação', cidades: 'Sumaré', area_min: 5000, area_max: 7000 });
  if (res.encontrados !== undefined) return fala(res.encontrados ? `Encontrei ${res.encontrados} opção: ${res.imoveis[0].codigo} · ${res.imoveis[0].resumo} — ${res.imoveis[0].faixas.join('; ')}.\nA ficha completa vai pela Sala do Cliente. Quer agendar uma conversa?\n[[botoes: Agendar | Mais opções]]` : 'Registrei sua demanda: a equipe retorna com opções verificadas em até 24 horas úteis.');
  if (res.horarios) return fala('Tenho estes horários: ' + res.horarios.slice(0, 3).map((h) => h.texto).join('; ') + '. Qual prefere?');
  if (res.briefings_ativos !== undefined) return fala(`Resumo: ${res.briefings_ativos} briefings ativos, ${res.ofertas_a_revisar} ofertas a revisar, ${res.conversas_pedem_humano} conversa(s) pedindo você.`);
  return fala('Certo.'); };
const MIME = { '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/json' };
// leitura de link simulada: só o IP público de teste; o resto segue o fetch real
const fetchReal = globalThis.fetch;
globalThis.fetch = async (u, o) => { const s = String(u); if (s.includes('/.netlify/functions/zoe-background') || s.includes('/.netlify/functions/matricula-background')) { const f = s.includes('zoe-') ? zbg : mbg; const req = new Request(s, { method: 'POST', headers: o.headers, body: s.includes('zoe-') ? JSON.stringify({ ...JSON.parse(o.body), espera: 0 }) : o.body }); setTimeout(() => f(req).catch((e) => console.error(e)), 50); return new Response(null, { status: 202 }); } if (s.startsWith('https://93.184.215.14/')) { if (/\/img\/(\d)\.jpg/.test(s)) return new Response(fs.readFileSync('/tmp/claude-0/fotos_teste/f' + (Number(s.match(/\/img\/(\d)/)[1]) % 4 + 1) + '.jpg'), { headers: { 'content-type': 'image/jpeg' } });
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
  if (url.pathname === '/whatsapp/webhook') fn = wh;
  if (url.pathname === '/propto/lead') fn = plead;
  if (url.pathname === '/propto/cadastro') fn = pcad;
  if (url.pathname === '/asaas/webhook') fn = awh;
  const tu = /(?:^|; )tu=([^;]+)/.exec(req.headers.cookie || ''); globalThis.__user = { email: tu ? decodeURIComponent(tu[1]) : 'contato@primecorpconsultoria.com.br' };
  if (url.pathname === '/__documento') { globalThis.__documento = body ? JSON.parse(body.toString() || 'null') : null; res.writeHead(200); res.end('ok'); return; }
  if (fn) {
    const h = { ...req.headers }; if (h.origin) h.origin = 'https://pc.test';
    const r = await fn(new Request('https://pc.test' + url.pathname + url.search, { method: req.method, headers: h, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), { params, ip: '127.0.0.1', site: { url: 'http://localhost:8899' } });
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  let f = path.join('test/www', url.pathname === '/' || url.pathname === '/app' || url.pathname.startsWith('/app/') ? 'index.html' : url.pathname);
  if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); res.end(fs.readFileSync(f));
}).listen(8899, () => console.log('pronto'));
