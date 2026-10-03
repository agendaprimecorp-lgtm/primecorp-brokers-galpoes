// E2E: pedido ao anunciante, Sala do Anunciante, autorização e comissão em 3 partes (celular 390×844).
import { chromium } from 'playwright'; import fs from 'node:fs';
const OUT = process.env.OUT || '/tmp/claude-0/telas2'; fs.mkdirSync(OUT, { recursive: true });
const HOST = 'https://primecorp-brokers-galpoes.netlify.app';
const FS = '/home/claude/app/node_modules/@fontsource/';
let css = '';
for (const w of [400, 500, 600, 700]) css += `@font-face{font-family:'Barlow';font-weight:${w};src:url(data:font/woff2;base64,${fs.readFileSync(FS + `barlow/files/barlow-latin-${w}-normal.woff2`).toString('base64')}) format('woff2')}`;
for (const w of [500, 600, 700]) css += `@font-face{font-family:'Barlow Condensed';font-weight:${w};src:url(data:font/woff2;base64,${fs.readFileSync(FS + `barlow-condensed/files/barlow-condensed-latin-${w}-normal.woff2`).toString('base64')}) format('woff2')}`;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, acceptDownloads: true });
await ctx.route('**/fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: css }));
await ctx.route(HOST + '/**', async r => { const resp = await r.fetch({ url: r.request().url().replace(HOST, 'http://localhost:8899') }); await r.fulfill({ response: resp }); });
const errs = []; const watch = (pg) => { pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => m.type() === 'error' && !/fonts|ERR_|404/.test(m.text()) && errs.push(m.text())); };
const p = await ctx.newPage(); watch(p);
const W = (ms = 500) => p.waitForTimeout(ms);
const sh = async (n, pg = p) => { await pg.addStyleTag({ content: '.toast{display:none!important}' }).catch(() => {}); await pg.waitForTimeout(250); await pg.screenshot({ path: `${OUT}/${n}.png` }); console.log('📷', n); };
const ok = (c, m) => { if (!c) { console.error('✗', m); errs.push(m); } else console.log('✓', m); };
await p.goto(HOST + '/'); await W(900);
const put = (col, o) => p.evaluate(async ([col, o]) => { const r = await fetch(`/api/dados/${col}/${o.id}`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: location.origin }, body: JSON.stringify(o) }); if (!r.ok) throw new Error(await r.text()); }, [col, o]);
const t0 = new Date().toISOString();

// dados: oferta PC-0007 (anúncio pobre), briefings, corretor parceiro e imobiliária no CRM
await put('contatos', { id: 'c_marcos', nome: 'Marcos Lima', empresa: 'Corretor autônomo', tipo: 'Corretor parceiro', creci: 'CRECI-SP 123456', telefone: '(19) 99111-2233', criado: t0, log: [] });
await put('contatos', { id: 'c_ana', nome: 'Ana Souza', empresa: 'Indústria X Ltda', tipo: 'Cliente (empresa)', telefone: '(19) 98888-7777', criado: t0, log: [] });
await put('briefings', { id: 'b1', nome: 'Indústria X · galpão 1,5 a 2 mil m²', tipo: 'Galpão', operacao: 'Venda', cidades: 'Sumaré, Hortolândia', areaMin: '1.400', areaMax: '2.200', valorMax: '8.000.000', status: 'ativo', cliente: 'c_ana', parceiro_id: 'c_marcos', parceiro: 'Marcos Lima', criado: t0 });
await put('briefings', { id: 'b2', nome: 'Investidor · galpão para renda', tipo: 'Galpão', operacao: 'Venda', areaMin: '1.000', areaMax: '3.000', valorMax: '9.000.000', status: 'ativo', criado: t0 });
await put('ofertas', { id: 'o7', tipo: 'Galpão', operacao: 'Venda', construida: '1.638', venda: '7.500.000', anunciante: 'Imobiliária Exemplo', anunciante_tipo: 'Imobiliária', anunciante_contato: '(19) 3222-4455', origem: 'Portal', status: 'revisada', link: 'https://portal.exemplo/1638', titulo: 'Galpão com 1.638 m² para venda', criado: t0 });
await p.reload(); await W(900);

// 1) oferta mostra ficha mínima baixa
await p.click('[data-tab="ofertas"]'); await W(); await p.click('[data-o="o7"]'); await W(700);
const ctxt = await p.textContent('#ctxt'); ok(/%/.test(ctxt) && !/Completa/.test(ctxt), 'ficha mínima mostra % e faltantes: ' + ctxt);
await sh('01_oferta_ficha_minima');

// 2) pedido bloqueado até revisar termos/comissão
await p.click('#solic'); await W(600);
ok(/Revise os termos/.test(await p.textContent('main')), 'pedido bloqueado sem termos revisados');
await p.click('#cf'); await W(700);
for (const k of ['aut_parceria', 'aut_proprietario']) {
  const v = await p.$eval(`[data-k="${k}"]`, t => t.value);
  await p.fill(`[data-k="${k}"]`, v.replace(/\[__\] meses/g, '12 meses').replace(/\[__\] dias/g, '10 dias').replace(/\[__\]/g, '90'));
}
const tv = await p.$eval('[data-k="termo"]', t => t.value); await p.fill('[data-k="termo"]', tv.replace('[__] meses', '24 meses').replace('[__]% do valor', '6% do valor').replace('[__] aluguel', '1 aluguel'));
const av = await p.$eval('[data-k="acordo"]', t => t.value); await p.fill('[data-k="acordo"]', av.replace('[__] dias úteis', '5 dias úteis').replace('[__] meses', '12 meses'));
await p.check('#rv'); await p.check('#ra'); await p.check('#cr'); await p.check('#rac');
await p.evaluate(() => document.querySelector('#fm').scrollIntoView()); await sh('02_config_modelos');
await p.click('#sv'); await W(700);

// 3) cria o pedido com 3 partes (imobiliária + corretor parceiro + PrimeCorp)
await p.click('[data-tab="ofertas"]'); await W(); await p.click('[data-o="o7"]'); await W(700); await p.click('#solic'); await W(700);
await p.selectOption('#md', 'imob_cor_pc'); await W(300);
const soma = await p.textContent('#soma'); ok(soma.trim() === '100%', 'modelo 3 partes soma 100%: ' + soma);
await sh('03_novo_pedido');
const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.click('#cr')]); await dl.saveAs(`${OUT}/pedido.pdf`); await W(900);
ok(/Pedido PC-/.test(await p.textContent('#hdr')), 'pedido criado');
await sh('04_pedido');
const link = (await p.textContent('#lk')).trim();

// 4) anunciante responde e autoriza
const a = await ctx.newPage(); watch(a); await a.goto(link); await a.waitForTimeout(800);
ok(/2 clientes com demanda/.test(await a.textContent('main')), 'anunciante vê demanda compatível (2)');
ok(!/Indústria X|Ana Souza|Marcos/.test(await a.textContent('main')), 'anunciante não vê cliente nem parceiro por nome? (parceiro aparece só no quadro se tiver nome)');
await sh('05_anunciante_inicio', a);
const resp = { cidade: 'Sumaré', regiao: 'Eixo Anhanguera (RMC)', terreno: '3.200', pe_direito: '9', docas: '2', energia_kva: '150', piso_carga: '5', avcb: 'Vigente até 2027', iptu: '18.000', disponibilidade: 'Imediata', documentacao: 'Matrícula regular, construção averbada' };
for (const [k, v] of Object.entries(resp)) { const el = await a.$(`[data-c="${k}"]`); if (el) await el.fill(v); }
await a.selectOption('[data-c="iptu_periodo"]', 'anual');
await a.evaluate(() => document.querySelector('#fq').scrollIntoView()); await sh('06_anunciante_perguntas', a);
await a.fill('#razao', 'Imobiliária Exemplo Ltda'); await a.fill('#documento', '11222333000181'); await a.fill('#creci', 'J-12345'); await a.fill('#responsavel', 'Paula Reis'); await a.fill('#cargo', 'Gerente');
await a.fill('#telefone', '(19) 3222-4455'); await a.fill('#email', 'paula@imobexemplo.com.br'); await a.check('#ok');
await a.evaluate(() => document.querySelector('#fa').scrollIntoView()); await sh('07_anunciante_autorizacao', a);
await a.click('#env'); await a.waitForTimeout(1000);
ok(/Autorização registrada/.test(await a.textContent('main')), 'autorização registrada na página do anunciante');
await a.evaluate(() => window.scrollTo(0, 0)); await sh('08_anunciante_ok', a); await a.close();

// 5) admin: novidade, pedido com cruzamento, oferta com campos verdes
await p.goto(HOST + '/'); await W(1000);
ok(!!(await p.$('#gopeds')), 'painel mostra resposta de anunciante'); await sh('09_painel_novidade');
await p.click('#gopeds'); await W(); await p.click('[data-p]'); await W(800);
ok(/Autorizado/.test(await p.textContent('main')), 'pedido autorizado');
await sh('10_pedido_autorizado');
await p.evaluate(() => window.scrollTo(0, 99999)); await sh('11_pedido_cruzamento');
await p.click('#vo'); await W(800);
ok((await p.$$('.doanunciante')).length >= 10, 'campos do anunciante marcados na oferta');
const ct2 = await p.textContent('#ctxt'); ok(/Completa/.test(ct2), 'ficha completa após resposta: ' + ct2);
await sh('12_oferta_completa'); await p.click('#sv'); await W(700);

// 6) negócio com comissão em 3 partes
await put('negocios', { id: 'n1', briefing: 'b1', oferta: 'o7', contato: 'c_ana', parceiro: 'Indústria X Ltda', etapa: 'termo', criado: t0, atualizado: t0, log: [{ t: t0, ev: 'Termo assinado na Sala do Cliente' }] });
await p.reload(); await W(1000); await p.click('[data-n="n1"]'); await W(700);
await sh('13_negocio_sem_comissao');
await p.click('#edcom'); await W(700);
const tot = await p.textContent('#tot'); ok(/450\.000/.test(tot), 'honorários 6% de 7,5 mi = 450 mil: ' + tot);
const pts = await p.$$eval('.parte [data-pp="nome"]', xs => xs.map(x => x.value)); ok(pts[0] === 'Imobiliária Exemplo Ltda' && pts[1] === 'Marcos Lima', 'partes preenchidas da autorização e do briefing: ' + pts.join(' | '));
await p.fill('#vb', '7.200.000'); await W(200); ok(/432\.000/.test(await p.textContent('#tot')), 'recalcula com valor negociado');
const rcb = await p.$$eval('#rcb option', xs => xs.map(x => [x.textContent, x.selected])); ok(rcb.length === 3 && rcb[0][1] && /Imobiliária/.test(rcb[0][0]), 'recebedor padrão = imobiliária, 3 opções');
await p.check('#ac'); await sh('14_comissao_editor');
await p.evaluate(() => window.scrollTo(0, 400)); await sh('14b_comissao_partes');
await p.click('#sv'); await W(800);
await p.evaluate(() => document.querySelector('#edcom').closest('.card').scrollIntoView()); await sh('15_negocio_comissao');
const [dla] = await Promise.all([p.waitForEvent("download"), p.click("#acpdf")]); await dla.saveAs(OUT + '/acordo_3partes.pdf'); await W(800);
ok(/Acordo_Divisao_Honorarios_PC-/.test(dla.suggestedFilename()), 'acordo de divisão baixado: ' + dla.suggestedFilename());
ok(/Acordo de divisão emitido/.test(await p.textContent('main')), 'histórico registra o acordo');
// 6b) negócio direto com a imobiliária: 2 partes
await put('negocios', { id: 'n2', briefing: 'b2', oferta: 'o7', parceiro: 'Investidor', etapa: 'proposta', criado: t0, atualizado: t0, log: [{ t: t0, ev: 'Proposta enviada' }] });
await p.reload(); await W(1000); await p.click('[data-n="n2"]').catch(async () => { await p.evaluate(() => location.hash = '#negocio/n2'); }); await W(700);
await p.click('[data-e="fechado"]'); await W(400);
ok(!(await p.$eval('[data-e="fechado"]', x => x.classList.contains('on'))), 'fechar sem divisão acordada pede confirmação');
await p.click('#edcom'); await W(700); await p.selectOption('#md', 'imob_pc'); await W(300);
ok((await p.$$('.parte')).length === 2, 'modelo direto com imobiliária = 2 partes');
ok(/450\.000/.test(await p.textContent('#tot')), '2 partes: honorários 450 mil');
await p.check('#ac'); await p.evaluate(() => window.scrollTo(0, 0)); await sh('15b_comissao_2partes');
await p.click('#sv'); await W(800);
await p.click('[data-e="fechado"]'); await W(500);
ok(await p.$eval('[data-e="fechado"]', x => x.classList.contains('on')), 'com divisão acordada, fecha direto');
await p.evaluate(() => document.querySelector('#edcom').closest('.card').scrollIntoView()); await sh('15c_negocio_2partes_fechado');
await p.click('[data-tab="painel"]'); await W(700); ok(/108\.000/.test(await p.textContent('main')), 'painel: participação PrimeCorp prevista R$ 108.000');
await sh('16_painel_honorarios');
await p.click('[data-tab="mais"]'); await p.click('#m3'); await W(900); await sh('17_relatorios');
const tipos = await p.$$eval('.tag', x => x.map(e => e.textContent)); ok(['Comissão', 'Acordo de divisão', 'Autorização do anunciante', 'Dados do anunciante', 'Pedido ao anunciante'].every(t => tipos.includes(t)), 'relatórios com os 4 novos tipos');
console.log('sw', await p.evaluate(() => document.documentElement.scrollWidth));
console.log(errs.length ? 'ERROS: ' + JSON.stringify(errs) : 'sem erros'); await b.close(); process.exit(errs.length ? 1 : 0);
