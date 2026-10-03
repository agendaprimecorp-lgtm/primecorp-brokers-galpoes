// E2E: computador (escritório) x celular (campo). O celular registra; o computador acompanha em tempo real.
import { chromium } from 'playwright'; import fs from 'node:fs';
const OUT = process.env.OUT || '/tmp/claude-0/telas7'; fs.mkdirSync(OUT, { recursive: true });
const HOST = 'https://primecorp-brokers-galpoes.netlify.app';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const ctxDe = async (viewport, extra = {}) => { const c = await b.newContext({ viewport, deviceScaleFactor: 1.5, permissions: ['camera', 'microphone'], ...extra });
  await c.route('**/fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
  await c.route(HOST + '/**', async (r) => { const resp = await r.fetch({ url: r.request().url().replace(HOST, 'http://localhost:8899') }); await r.fulfill({ response: resp }); });
  await c.addInitScript(() => { window.__syncMs = 1500; }); return c; };
const errs = []; const watch = (pg) => { pg.on('pageerror', (e) => errs.push(e.message)); pg.on('console', (m) => m.type() === 'error' && !/fonts|ERR_|40[0-9]/.test(m.text()) && errs.push(m.text())); };
const ok = (c, m) => { if (!c) { console.error('✗', m); errs.push(m); } else console.log('✓', m); };
const esperar = async (pg, fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await pg.waitForTimeout(250); } return false; };
const sh = async (pg, n) => { await pg.addStyleTag({ content: '.toast{display:none!important}' }).catch(() => {}); await pg.waitForTimeout(250); await pg.screenshot({ path: `${OUT}/${n}.png` }); console.log('📷', n); };

// computador
const cD = await ctxDe({ width: 1440, height: 900 }); const d = await cD.newPage(); watch(d);
await d.goto(HOST + '/'); await d.waitForTimeout(1200);
ok((await d.evaluate(() => document.documentElement.dataset.modo)) === 'escritorio', 'computador abre em modo escritório');
const side = await d.$eval('.tabs', (x) => ({ w: x.getBoundingClientRect().width, h: x.getBoundingClientRect().height })); ok(side.w > 200 && side.h > 800, 'menu lateral no computador');
ok((await d.$eval('main', (x) => x.getBoundingClientRect().width)) > 1000, 'área de trabalho larga');
ok(/Chegando do campo/.test(await d.textContent('main')), 'painel mostra o que chega do campo');
await sh(d, '01_computador_painel');
await d.click('[data-tab="captar"]'); await d.waitForTimeout(500);
ok(/Registro fotográfico é feito no celular/.test(await d.textContent('main')) && !!(await d.$('.qr svg')), 'Captar no computador: QR para abrir no celular');
await sh(d, '02_computador_captar_qr');
await d.click('[data-tab="painel"]'); await d.waitForTimeout(400);

// celular registra
const cM = await ctxDe({ width: 390, height: 844 }, { hasTouch: true, isMobile: true }); const m = await cM.newPage(); watch(m);
await m.goto(HOST + '/'); await m.waitForTimeout(1200);
ok((await m.evaluate(() => document.documentElement.dataset.modo)) === 'campo', 'celular abre em modo campo');
ok((await m.$eval('.tabs', (x) => x.getBoundingClientRect().top)) > 700, 'celular com abas embaixo');
await m.click('[data-tab="captar"]'); await m.waitForTimeout(400); await m.click('#nc'); await m.waitForTimeout(400);
await m.click('[data-ti="Galpão"]'); await m.fill('#icid', 'Hortolândia'); await m.click('#ini'); await m.waitForTimeout(800);
await esperar(m, async () => m.$eval('#vid', (v) => v.videoWidth > 0)); await m.click('#obt');
ok(await esperar(m, async () => (await m.$$('#vthumbs img')).length === 1), 'celular: foto registrada na visita');
await sh(m, '03_celular_visita');

// computador recebe sozinho
ok(await esperar(d, async () => (await d.$$('.campo-it img')).length >= 1 && /Hortolândia|Galpão/.test(await d.textContent('.campo')), 20000), 'computador recebeu o registro do celular sem recarregar');
ok(/Sincronizado/.test(await d.textContent('#sync')), 'indicador de sincronização');
await sh(d, '04_computador_recebeu');
await d.click('.campo-it'); await d.waitForTimeout(700); ok(/Captação/.test(await d.textContent('#hdr')), 'computador abre a captação para revisar');
await sh(d, '05_computador_captacao');
await d.click('#vguiada'); await d.waitForTimeout(500); ok(/Continue a visita no celular/.test(await d.textContent('main')), 'visita guiada no computador indica o celular');
await d.click('#wc'); await d.waitForTimeout(800); ok(!!(await d.$('#vid')), 'webcam opcional no computador');
await d.click('#bk'); await d.waitForTimeout(500);

// troca manual de modo
await d.click('[data-tab="mais"]'); await d.waitForTimeout(400); await d.click('#modo [data-modo="campo"]'); await d.waitForTimeout(400);
ok((await d.evaluate(() => document.documentElement.dataset.modo)) === 'campo' && (await d.$eval('.tabs', (x) => x.getBoundingClientRect().top)) > 700, 'modo celular escolhido no computador');
await d.click('#modo [data-modo="auto"]'); await d.waitForTimeout(400); ok((await d.evaluate(() => document.documentElement.dataset.modo)) === 'escritorio', 'volta ao automático');
await sh(d, '06_computador_mais');
for (const [pg, n] of [[d, 'computador'], [m, 'celular']]) { const sw = await pg.evaluate(() => document.documentElement.scrollWidth - innerWidth); ok(sw <= 0, `${n} sem rolagem lateral`); }
console.log(errs.length ? 'ERROS: ' + JSON.stringify(errs) : 'sem erros'); await b.close(); process.exit(errs.length ? 1 : 0);
