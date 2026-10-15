// E2E: cadastro real na página Propto → entra no app como cliente → teste de 30 dias, plano com desconto de fundador, equipe, limite e painel de contas da PrimeCorp.
import { chromium } from 'playwright'; import fs from 'node:fs';
const OUT = process.env.OUT || '/tmp/claude-0/telas12'; fs.mkdirSync(OUT, { recursive: true });
const L = 'http://localhost:8899';
const FS = '/home/claude/app/node_modules/@fontsource/'; let css = '';
if (fs.existsSync(FS + 'inter')) { for (const w of [400, 500, 600, 700]) { const f = FS + `inter/files/inter-latin-${w}-normal.woff2`; if (fs.existsSync(f)) css += `@font-face{font-family:'Inter';font-weight:${w};src:url(data:font/woff2;base64,${fs.readFileSync(f).toString('base64')}) format('woff2')}`; } for (const w of [600, 700]) css += `@font-face{font-family:'Sora';font-weight:${w};src:url(data:font/woff2;base64,${fs.readFileSync(FS + `sora/files/sora-latin-${w}-normal.woff2`).toString('base64')}) format('woff2')}`; }
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errs = []; const ok = (c, m) => { if (!c) { console.error('✗', m); errs.push(m); } else console.log('✓', m); };
const ctxCom = async (email, vp) => {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: 'tu', value: encodeURIComponent(email), url: L }]);
  await ctx.route('**/fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: css }));
  await ctx.route('https://sandbox.asaas.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<h1>Fatura Asaas (sandbox)</h1>' }));
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && !/fonts|ERR_|402|Failed to load resource/.test(m.text()) && errs.push(m.text()));
  return { ctx, p };
};
const foto = async (p, n) => { await p.waitForTimeout(500); await p.screenshot({ path: `${OUT}/${n}.png` }); console.log('📷', n); };

// 1) Cadastro na página
const EM = 'rita@imobteste.com.br';
const { p } = await ctxCom(EM, { width: 390, height: 844 });
await p.goto(L + '/propto.html'); await p.waitForTimeout(600);
await p.click('text=Quero testar grátis por 30 dias'); await p.waitForTimeout(400);
ok(await p.locator('#senha').isVisible() && await p.locator('#empresa').isVisible(), 'imobiliária: pede imobiliária, CRECI e senha');
await p.fill('#nome', 'Rita Andrade'); await p.fill('#empresa', 'Andrade Imóveis'); await p.fill('#creci', '45678-J'); await p.fill('#fone', '(19) 97777-6655'); await p.fill('#email', EM); await p.fill('#cidade', 'Campinas'); await p.fill('#sistema', 'Kenlo');
await p.fill('#senha', 'curta'); await p.fill('#senha2', 'curta'); await p.check('#consentimento'); await p.click('#enviar'); await p.waitForTimeout(300);
ok(/8 caracteres/.test(await p.locator('#msg').innerText()), 'valida a senha');
await p.fill('#senha', 'Andrade2026'); await p.fill('#senha2', 'Andrade2026'); await p.click('#enviar'); await p.waitForTimeout(300);
ok(/termos/.test(await p.locator('#msg').innerText()), 'exige aceite dos termos');
await p.check('#termos'); await p.locator('#teste').scrollIntoViewIfNeeded(); await foto(p, '01_cadastro_preenchido');
await Promise.all([p.waitForURL(/\/\?bemvindo=1/, { timeout: 15000 }).catch(() => {}), p.click('#enviar')]);
ok(/bemvindo=1/.test(p.url()), 'conta criada e entrada direta no app');
await p.waitForSelector('#qcap', { timeout: 15000 }).catch(() => {});

// 2) App no modo cliente
const tabs = await p.locator('#tabs [data-tab]').allInnerTexts();
ok(tabs.length === 5 && !tabs.some((t) => /Briefings/.test(t)) && tabs.some((t) => /Imóveis/.test(t)), 'menu do cliente sem módulos da PrimeCorp: ' + tabs.join('|'));
ok(/Teste grátis · 30 dia/.test(await p.locator('#fxc').innerText()), 'faixa do teste com 30 dias');
ok(!/PrimeCorp/i.test(await p.locator('main').innerText()), 'nenhuma menção à PrimeCorp no painel do cliente');
await foto(p, '02_painel_cliente');
await p.click('#bvx').catch(() => {}); await p.waitForTimeout(300);

// 3) Plano e assinatura
await p.click('#fxc'); await p.waitForSelector('.planos', { timeout: 10000 });
const precos = await p.locator('.plano .preco b').allInnerTexts();
ok(precos.join('|') === 'R$ 118,20|R$ 294|R$ 534', 'preços de fundador (40% off): ' + precos.join('|'));
await foto(p, '03_planos');
await p.click('[data-pl=imobiliaria]'); await p.fill('#adoc', '11.222.333/0001-81'); await p.locator('#fass').scrollIntoViewIfNeeded(); await foto(p, '04_dados_nota');
p.context().on('page', (pg) => pg.close().catch(() => {}));
await p.click('#aok'); await p.waitForSelector('text=/Pagar fatura de R\\$ 294/', { timeout: 10000 }).catch(() => {});
ok(await p.locator('text=/Pagar fatura de R\\$ 294/').count() > 0, 'fatura de R$ 294 gerada (Pix, boleto ou cartão)');
await p.evaluate(() => window.scrollTo(0, 0)); await foto(p, '05_plano_escolhido');

// 4) Equipe e limite
await p.goto(L + '/'); await p.waitForSelector('#qcap'); await p.click('#tabs [data-tab=mais]'); await p.waitForTimeout(300); await foto(p, '06_mais_cliente');
await p.click('#cm2'); await p.fill('#tn', 'Paulo Corretor'); await p.fill('#te', 'paulo@imobteste.com.br'); await p.fill('#tc', '112233-F'); await p.click('#tok'); await p.waitForTimeout(800);
ok(await p.locator('text=Paulo Corretor').count() > 0, 'corretor incluído na equipe'); await foto(p, '07_equipe');
const lim = await p.evaluate(async () => { const out = []; for (let i = 1; i <= 16; i++) { const r = await fetch('/api/dados/ofertas/lim' + i, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ titulo: 'Imóvel ' + i, tipo: 'Casa', cidade: 'Campinas' }) }); out.push(r.status); } return out; });
ok(lim.slice(0, 15).every((s) => s === 200) && lim[15] === 402, 'teste da imobiliária: 15 imóveis, o 16º pede plano');
await p.goto(L + '/'); await p.waitForSelector('#qcap'); await foto(p, '08_painel_limite');
const isolado = await p.evaluate(async () => (await (await fetch('/api/dados')).json()).ofertas.every((o) => o.id.startsWith('lim')));
ok(isolado, 'cliente só enxerga os próprios imóveis');

// 5) Computador
const { p: d } = await ctxCom(EM, { width: 1440, height: 900 }); await d.goto(L + '/'); await d.waitForSelector('#qcap', { state: 'attached' }); await d.waitForTimeout(800);
await d.evaluate(() => { const b = [...document.querySelectorAll('#tabs [data-tab]')].find((x) => x.dataset.tab === 'mais'); b && b.click(); }); await d.waitForTimeout(300); await d.click('#cm1'); await d.waitForSelector('.planos'); await foto(d, '09_pc_planos');

// 6) Operação PrimeCorp: painel de contas
const { p: a } = await ctxCom('contato@primecorpconsultoria.com.br', { width: 1440, height: 900 }); await a.goto(L + '/'); await a.waitForTimeout(1200);
await a.evaluate(() => { const b = [...document.querySelectorAll('#tabs [data-tab]')].find((x) => x.dataset.tab === 'mais'); b && b.click(); }); await a.waitForTimeout(300);
await a.click('#m12'); await a.waitForSelector('text=Andrade Imóveis', { timeout: 10000 }).catch(() => {});
ok(await a.locator('text=Andrade Imóveis').count() > 0, 'PrimeCorp vê a conta nova no painel de contas'); await foto(a, '10_admin_contas');
const pcOf = await a.evaluate(async () => (await (await fetch('/api/dados')).json()).ofertas.some((o) => String(o.id).startsWith('lim')));
ok(!pcOf, 'imóveis do cliente não aparecem na base da PrimeCorp');

console.log(errs.length ? 'ERROS: ' + JSON.stringify(errs) : 'sem erros');
await b.close(); process.exit(errs.length ? 1 : 0);
