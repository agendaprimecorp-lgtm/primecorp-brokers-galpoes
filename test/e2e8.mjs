// E2E: botão Voltar em todas as telas, gesto de voltar do celular (histórico), painel de tipos com ícones
// e próximos passos em ícones (celular 390×844).
import { chromium } from 'playwright'; import fs from 'node:fs';
const OUT = process.env.OUT || '/tmp/claude-0/telas8'; fs.mkdirSync(OUT, { recursive: true });
const HOST = 'https://primecorp-brokers-galpoes.netlify.app';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['camera', 'microphone'] });
await ctx.route('**/fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
await ctx.route(HOST + '/**', async (r) => { const resp = await r.fetch({ url: r.request().url().replace(HOST, 'http://localhost:8899') }); await r.fulfill({ response: resp }); });
const errs = []; const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && !/fonts|ERR_|40[0-9]/.test(m.text()) && errs.push(m.text()));
const W = (ms = 400) => p.waitForTimeout(ms);
const sh = async (n) => { await p.addStyleTag({ content: '.toast{display:none!important}' }).catch(() => {}); await W(250); await p.screenshot({ path: `${OUT}/${n}.png` }); console.log('📷', n); };
const ok = (c, m) => { if (!c) { console.error('✗', m); errs.push(m); } else console.log('✓', m); };
const aba = () => p.$eval('.tabs .on', (x) => x.dataset.tab).catch(() => '');
await p.goto(HOST + '/'); await W(900);

// 1) Voltar em cada subtela de Mais e de Ofertas
for (const [bt, nome] of [['#m1', 'nova oferta'], ['#m2', 'salas'], ['#m3', 'relatórios'], ['#m4', 'backup'], ['#m5', 'configurações'], ['#m7', 'pedidos'], ['#m8', 'anúncios'], ['#m9', 'equipe']]) {
  await p.click('[data-tab="mais"]'); await W(300); if (!(await p.$(bt))) { console.log('· sem', nome); continue; }
  await p.click(bt); await W(450);
  const vis = await p.$eval('#bk', (x) => { const r = x.getBoundingClientRect(); return r.width > 40 && r.top >= 0 && r.top < 80 && /Voltar/.test(x.textContent); }).catch(() => false);
  await p.click('#bk'); await W(400);
  ok(vis && (await aba()) === 'mais' && !(await p.$('#bk')), `Voltar no topo em ${nome} → volta para Mais`);
}
// 2) gesto de voltar do celular (histórico do navegador) não sai do app
await p.click('[data-tab="briefings"]'); await W(300); const nb = await p.$('#nb'); if (nb) { await nb.click(); await W(400); await p.goBack(); await W(600); ok((await aba()) === 'briefings' && !(await p.$('#bk')) && p.url().startsWith(HOST), 'gesto de voltar do celular volta para Briefings sem sair do app'); }
await p.click('[data-tab="captar"]'); await W(300); await p.click('#nc'); await W(400); await p.goBack(); await W(600); ok((await aba()) === 'captar' && !!(await p.$('#nc')), 'gesto de voltar no registro fotográfico volta para Captar');

// 3) painel de tipos com ícones, por grupo
await p.click('#nc'); await W(400);
for (const [g, t, item] of [['gal', 'Galpão', 'Prevenção de incêndio'], ['com', 'Prédio comercial', 'Recepção / hall'], ['are', 'Área industrial', 'Acesso rodoviário'], ['rur', 'Haras', 'Baias e picadeiro'], ['rur', 'Chácara', 'Lazer']]) {
  await p.click(`[data-gp="${g}"]`); await W(200); await p.click(`[data-ti="${t}"]`); await W(250);
  const ics = await p.$$eval('.tipogrid button svg', (xs) => xs.length); const chips = await p.$$eval('.rch', (xs) => xs.map((x) => x.textContent.trim()));
  ok(ics >= 3 && chips.includes(item) && (await p.$$eval('.rch svg', (xs) => xs.length)) === chips.length, `${t}: ícones no painel e roteiro com "${item}"`);
  if (t === 'Galpão' || t === 'Haras') await sh('01_tipo_' + g);
}
const cta = await p.$eval('#ini', (x) => { const r = x.getBoundingClientRect(); return r.bottom <= innerHeight && !x.disabled; }); ok(cta, 'botão Começar visível sem rolar');
await p.click('#iniManual'); await W(900);
// 4) próximos passos com ações em ícones
await p.evaluate(() => document.querySelector('#fx').scrollIntoView()); await W(300);
ok((await p.$$eval('#fx .acao svg', (xs) => xs.length)) >= 4 && !!(await p.$('#conc svg')) && (await p.$$eval('#fx .pnum', (xs) => xs.length)) === 3, 'próximos passos: linha do tempo e ações com ícones');
await sh('02_passos');
await p.click('#conc'); await W(1200); ok(/No banco de ofertas como/.test(await p.textContent('#fx')) && !!(await p.$('#fx .pnum.ok')), 'concluir envia ao banco e marca o passo 3');
await p.evaluate(() => document.querySelector('#fx').scrollIntoView()); await sh('03_passos_banco');
await p.click('#bk'); await W(500); ok((await aba()) === 'captar' && !(await p.$('#bk')), 'Voltar da captação para a lista de Captar');
console.log('sw', await p.evaluate(() => document.documentElement.scrollWidth));
console.log(errs.length ? 'ERROS: ' + JSON.stringify(errs) : 'sem erros'); await b.close(); process.exit(errs.length ? 1 : 0);
