// E2E: página comercial da Propto (propto.com.br): leitura no celular e no computador, inscrição no teste grátis gravada no sistema.
import { chromium } from 'playwright'; import fs from 'node:fs';
const OUT = process.env.OUT || '/tmp/claude-0/telas11'; fs.mkdirSync(OUT, { recursive: true });
const HOST = 'https://primecorp-brokers-galpoes.netlify.app'; const L = 'http://localhost:8899';
const FS = '/home/claude/app/node_modules/@fontsource/'; let css = '';
if (fs.existsSync(FS + 'inter')) { for (const w of [400, 500, 600]) css += `@font-face{font-family:'Inter';font-weight:${w};src:url(data:font/woff2;base64,${fs.readFileSync(FS + `inter/files/inter-latin-${w}-normal.woff2`).toString('base64')}) format('woff2')}`; for (const w of [600, 700]) css += `@font-face{font-family:'Sora';font-weight:${w};src:url(data:font/woff2;base64,${fs.readFileSync(FS + `sora/files/sora-latin-${w}-normal.woff2`).toString('base64')}) format('woff2')}`; }
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errs = []; const ok = (c, m) => { if (!c) { console.error('✗', m); errs.push(m); } else console.log('✓', m); };
const abrir = async (vp) => { const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2 }); await ctx.route('**/fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: css })); await ctx.route(HOST + '/**', async (r) => { const resp = await r.fetch({ url: r.request().url().replace(HOST, L) }); await r.fulfill({ response: resp }); }); const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && !/fonts|ERR_/.test(m.text()) && errs.push(m.text())); await p.goto(HOST + '/propto.html'); await p.waitForTimeout(700); return p; };

// computador
const d = await abrir({ width: 1440, height: 900 });
await d.screenshot({ path: `${OUT}/01_pc_topo.png` }); console.log('📷 01_pc_topo');
ok(await d.locator('h1').innerText().then((t) => /antes de você sair da visita/.test(t)), 'título principal');
ok((await d.locator('text=/R\\$ ?\\d/').count()) === 0, 'nenhum preço na página');
const largura = await d.evaluate(() => document.documentElement.scrollWidth); ok(largura <= 1440, 'sem rolagem lateral no computador');
await d.locator('#integracao').scrollIntoViewIfNeeded(); await d.waitForTimeout(300); await d.screenshot({ path: `${OUT}/02_pc_integracao.png` });
await d.screenshot({ path: `${OUT}/00_pc_inteira.png`, fullPage: true });

// celular + inscrição
const p = await abrir({ width: 390, height: 844 });
await p.screenshot({ path: `${OUT}/03_cel_topo.png` });
ok(await p.evaluate(() => document.documentElement.scrollWidth) <= 390, 'sem rolagem lateral no celular');
await p.screenshot({ path: `${OUT}/04_cel_inteira.png`, fullPage: true });
await p.click('text=Quero testar grátis por 30 dias'); await p.waitForTimeout(500);
await p.click('label:has(input[value=corretor])');
ok(await p.locator('#creci').isVisible() && await p.locator('#senha').isVisible() && !(await p.locator('#empresa').isVisible()), 'corretor: pede CRECI e senha (cria a conta)');
await p.click('label:has(input[value=proprietario])');
ok(!(await p.locator('#senha').isVisible()) && await p.locator('#imovel').isVisible() && /anunciar/.test(await p.locator('#enviar').innerText()), 'proprietário: inscrição sem senha');
await p.click('#enviar'); await p.waitForTimeout(300);
ok(/nome/.test(await p.locator('#msg').innerText()), 'valida nome antes de enviar');
await p.fill('#nome', 'Marina Teste Proprietária'); await p.fill('#fone', '(19) 98888-1234'); await p.fill('#email', 'marina@exemplo.com'); await p.fill('#cidade', 'Campinas'); await p.selectOption('#imovel', 'Casa'); await p.selectOption('#operacao', 'Venda');
await p.click('#enviar'); await p.waitForTimeout(300);
ok(/autoriza/.test(await p.locator('#msg').innerText()), 'exige autorização LGPD');
await p.check('#consentimento'); await p.click('#enviar');
await p.waitForSelector('#feito:not([hidden])', { timeout: 10000 }).catch(() => {});
const cod = await p.locator('#codigo').innerText().catch(() => ''); ok(/^S[0-9A-F]{6}$/.test(cod), 'inscrição recebida com código ' + cod);
const wa = await p.locator('#wa').getAttribute('href'); ok(/wa\.me\/5519998051985/.test(wa) && /Propto/.test(decodeURIComponent(wa)), 'WhatsApp comercial da Propto com o código');
await p.locator('#feito').scrollIntoViewIfNeeded(); await p.screenshot({ path: `${OUT}/05_cel_inscrito.png` });
const r = await p.evaluate(async () => (await fetch('/api/dados')).json()).catch(() => null);
const leads = r?.site_leads || r?.dados?.site_leads || [];
const meu = leads.find((l) => l.codigo === cod);
ok(meu && meu.form === 'propto' && meu.extras?.imovel === 'Casa' && /Propto · teste Propriet/.test(meu.linha), 'lead do proprietário gravado no sistema');
console.log(errs.length ? 'ERROS: ' + JSON.stringify(errs) : 'sem erros');
await b.close(); process.exit(errs.length ? 1 : 0);
