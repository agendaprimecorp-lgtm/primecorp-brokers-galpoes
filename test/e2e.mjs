import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true });
const p = await ctx.newPage(); const errs = [];
const watch = (pg) => { pg.on('pageerror', e => errs.push(e.message + ' @ ' + (e.stack||'').split('\n').slice(0,3).join(' | '))); pg.on('console', m => m.type() === 'error' && !/fonts|ERR_/.test(m.text()) && errs.push(m.text())); };
watch(p); await ctx.route('**/fonts.googleapis.com/**', r => r.abort());
const sh = (n, pg = p) => pg.screenshot({ path: `/tmp/claude-0/e_${n}.png` });
const W = (ms = 400) => p.waitForTimeout(ms);
await p.goto('http://localhost:8899/'); await W(800); await sh('01painel');
// CRM
await p.click('[data-tab="contatos"]'); await p.click('#novo'); await p.fill('[data-k="nome"]', 'João Corretor'); await p.selectOption('[data-k="tipo"]', 'Corretor parceiro'); await p.fill('[data-k="telefone"]', '19 99999-0000'); await p.click('#sv'); await W(); await sh('02contato');
// Oferta
await p.click('[data-tab="ofertas"]'); await p.click('#nv'); await p.fill('#url', 'https://portal/123'); await p.fill('#src', 'x'.repeat(100)); await p.click('#bx'); await W(800);
await p.fill('[data-f="regiao"]', 'Eixo Anhanguera (RMC)'); await p.fill('[data-f="pe_direito"]', '12'); await p.fill('[data-f="docas"]', '10'); await sh('03oferta'); await p.click('#sv'); await W();
// Briefing
await p.click('[data-tab="briefings"]'); await p.click('#novo'); await p.fill('[data-k="nome"]', 'Indústria X · galpão 12 mil');
const opt = await p.$eval('[data-k="parceiro_id"]', s => [...s.options].find(o => o.text.includes('João')).value); await p.selectOption('[data-k="parceiro_id"]', opt);
await p.fill('[data-k="cidades"]', 'Sumaré, Hortolândia'); await p.fill('[data-k="areaMin"]', '10.000'); await p.fill('[data-k="areaMax"]', '14.000'); await p.fill('[data-k="peMin"]', '10'); await p.fill('[data-k="precoMaxM2"]', '28');
await p.click('#sv'); await W(); await sh('04briefing'); console.log('score', await p.$$eval('.score', x => x.map(e => e.textContent)));
// Sala bloqueada → config
await p.click('#sala'); await W(); console.log('bloqueio:', await p.textContent('main h2')); await p.click('#cf'); await W(600);
const termo = await p.$eval('[data-k="termo"]', t => t.value); await p.fill('[data-k="termo"]', termo.replace('[__] meses', '24 meses').replace('[__]% do valor', '6% do valor').replace('[__] aluguel', '1 aluguel'));
for (const [k, v] of [['prazo_cliente', '24'], ['prazo_indicacao', '12'], ['prazo_repasse', '5'], ['prazo_nao_contorno', '12'], ['prazo_autorizacao', '90'], ['prazo_pos_autorizacao', '6'], ['prazo_mandato', '90']]) await p.fill(`[data-k="${k}"]`, v);
await p.check('#rv'); await p.click('#sv'); await W(); await sh('05config');
await p.click('[data-tab="briefings"]'); await p.click('[data-b]'); await W(); await p.click('#sala'); await W(); await sh('06novasala'); await p.click('#cr'); await W(1200); await sh('07sala');
const link = await p.textContent('#lk'); console.log('link', link);
// Cliente
const c = await ctx.newPage(); watch(c); await c.goto(link.replace('https://pc.test', 'http://localhost:8899')); await c.waitForTimeout(600); await sh('08cliente', c);
await c.fill('#razao', 'Indústria X Ltda'); await c.fill('#documento', '11222333000181'); await c.fill('#responsavel', 'Ana Souza'); await c.fill('#cargo', 'Diretora'); await c.fill('#telefone', '(19) 98888-7777'); await c.fill('#email', 'ana@indx.com.br');
await c.click('#env'); await c.waitForTimeout(500); console.log('sem aceite:', await c.textContent('#st')); await c.check('#ok'); await c.click('#env'); await c.waitForTimeout(800); await sh('09opcoes', c);
await c.click('[data-c]'); await c.waitForTimeout(800); await sh('10interesse', c); console.log('cliente vê:', (await c.textContent('main')).slice(0, 400));
// Admin
await p.reload(); await W(1000); await sh('11painel');
await p.click('.deal'); await W(); await sh('12negocio'); console.log('pdf desabilitado:', await p.$eval('#pdf', e => e.disabled));
await p.click('[data-e="termo"]'); await W(); await p.click('#pdf'); await W(300); console.log('ficha incompleta pede 2º toque:', await p.textContent('#pdf')); const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.click('#pdf')]); console.log('download', dl.suggestedFilename()); await W(800); await sh('13negocio2');
await p.click('[data-tab="mais"]'); await p.click('#m3'); await W(800); await sh('14relatorios'); console.log('relatórios:', await p.$$eval('.tag', x => x.map(e => e.textContent)));
await p.click('[data-tab="mais"]'); await p.click('#m4'); await W(800); await sh('15backup');
await p.click('[data-tab="contatos"]'); await W(); await sh('16crm');
await p.click('[data-tab="mais"]'); await p.click('#m2'); await W(); await p.click('[data-s]'); await W(); await sh('17sala_admin'); await p.click('#crm').catch(()=>{}); await W(600);
console.log('sw', await p.evaluate(() => document.documentElement.scrollWidth), 'errs', errs);
await b.close();
