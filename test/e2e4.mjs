// E2E fase 7: multiusuário e multissegmento (boas-vindas, leitura por link, residencial da Joselia, rural do Rodrigo).
import { chromium } from 'playwright'; import fs from 'node:fs';
const OUT = process.env.OUT || '/tmp/claude-0/telas4'; fs.mkdirSync(OUT, { recursive: true });
const HOST = 'https://primecorp-brokers-galpoes.netlify.app';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await ctx.route('**/fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
await ctx.route(HOST + '/**', async r => { const resp = await r.fetch({ url: r.request().url().replace(HOST, 'http://localhost:8899') }); await r.fulfill({ response: resp }); });
const errs = []; const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && !/fonts|ERR_|404|422/.test(m.text()) && errs.push(m.text()));
const W = (ms = 500) => p.waitForTimeout(ms);
const sh = async (n) => { await p.addStyleTag({ content: '.toast{display:none!important}' }).catch(() => {}); await W(250); await p.screenshot({ path: `${OUT}/${n}.png` }); console.log('📷', n); };
const ok = (c, m) => { if (!c) { console.error('✗', m); errs.push(m); } else console.log('✓', m); };
const esperar = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await W(250); } return false; };
const visivel = (sel) => p.$eval(sel, (el) => !el.closest('[hidden]') && !!el.offsetParent).catch(() => false);
const comoJoselia = async () => { await ctx.addCookies([{ name: 'tu', value: 'comercial@primecorpconsultoria.com.br', url: HOST }]); await p.reload(); await W(1200); };
const comoRodrigo = async () => { await ctx.addCookies([{ name: 'tu', value: 'contato@primecorpconsultoria.com.br', url: HOST }]); await p.reload(); await W(1200); };

await p.goto(HOST + '/'); await W(900);
// 1) Rodrigo: boas-vindas e equipe
ok(/Bem-vindo/.test(await p.textContent('.boasvindas')) && /Rodrigo/.test(await p.textContent('.boasvindas h2')), 'boas-vindas do Rodrigo');
await p.click('[data-tab="mais"]'); await W(400); await p.click('#m9'); await W(500); await p.click('#seed'); await W(900);
await p.click('[data-u="u_comercial_primecorpconsultoria_com_br"]'); await W(300);
ok((await p.$eval('#uti', (x) => x.value)) === 'Corretora de Imóveis' && (await p.$eval('#uf', (x) => x.value)) === 'residencial', 'Joselia: residencial, assina como Corretora de Imóveis');
await p.click('[data-tab="painel"]'); await W(400); await p.click('#bvx'); await W(400);
ok(!(await p.$('.boasvindas')), 'boas-vindas some depois de "Entendi"');

// 2) Joselia: boas-vindas no feminino e foco residencial
await comoJoselia();
ok(/Bem-vinda/.test(await p.textContent('.boasvindas')) && /Joselia/.test(await p.textContent('.boasvindas h2')) && /Casas e apartamentos/.test(await p.textContent('.boasvindas')), 'boas-vindas da Joselia, foco residencial');
await sh('01_joselia_boasvindas');
await p.click('[data-bv="nova"]'); await W(500);
ok(/qualquer segmento/.test(await p.textContent('main')), 'tela "Nova oferta" aceita só o link');
// 2a) link de rede interna: recusado, pede o texto
await p.fill('#url', 'http://localhost:8080/admin'); await p.click('#bx'); ok(/Link inválido/.test(await p.textContent('#st')), 'link sem domínio: aviso na hora');
await p.fill('#url', 'http://10.0.0.5/admin'); await p.click('#bx');
ok(await esperar(async () => /cole aqui/.test(await p.textContent('#st'))), 'link de rede interna recusado: ' + (await p.textContent('#st')));
ok(await p.evaluate(() => document.activeElement?.id === 'src'), 'cursor vai para o campo de texto');
await sh('02_link_recusado');
// 2b) portal que recusa: mensagem clara
await p.fill('#url', 'https://93.184.215.14/bloqueado'); await p.click('#bx');
ok(await esperar(async () => /recusou/.test(await p.textContent('#st'))), 'portal que recusa: mensagem clara');
// 2c) link que abre: lê sozinho e reconhece apartamento
await p.fill('#url', 'https://93.184.215.14/apto-cambui'); await p.click('#bx');
ok(await esperar(async () => !!(await p.$('[data-f="dormitorios"]')) && (await p.$eval('[data-f="tipo"]', (x) => x.value)) === 'Apartamento'), 'link lido sozinho: Apartamento');
ok((await p.$eval('[data-f="dormitorios"]', (x) => x.value)) === '2' && (await p.$eval('[data-f="vagas"]', (x) => x.value)) === '1', 'dormitórios e vagas preenchidos');
ok(await visivel('[data-f="dormitorios"]') && !(await visivel('[data-f="pe_direito"]')) && !(await visivel('[data-f="area_ha"]')), 'formulário mostra só os campos residenciais');
ok(!(await visivel('[data-f="fabril"]')) && !(await visivel('[data-f="administrativo"]')) && await visivel('[data-f="construida"]'), 'apartamento sem campos de galpão (fabril, administrativo)');
await sh('03_oferta_apto_por_link');
await p.evaluate(() => document.querySelector('[data-f="dormitorios"]').scrollIntoView()); await sh('04_oferta_apto_campos');
// 3) lista de ofertas com segmento padrão residencial
await p.click('[data-tab="ofertas"]'); await W(600);
ok(/on/.test(await p.$eval('.segs [data-g="residencial"]', (x) => x.className)), 'chip Residencial ativo para a Joselia');
ok(/Apartamento/.test(await p.textContent('#ls')), 'apartamento na lista residencial');
await sh('05_ofertas_residencial');
await p.click('.segs [data-g="comercial"]'); await W(400); ok(!/Apartamento/.test(await p.textContent('#ls')), 'apartamento fora do filtro comercial');
// 4) preencher manual: padrão casa
await p.click('#nv'); await W(400); await p.click('#bm'); await W(700);
ok((await p.$eval('[data-f="tipo"]', (x) => x.value)) === 'Casa' && (await p.$eval('[data-f="operacao"]', (x) => x.value)) === 'Venda', 'manual da Joselia já começa como Casa à venda');
// 5) briefing residencial com troca para rural
await p.click('[data-tab="painel"]'); await W(400); await p.click('#qbrief'); await W(600);
ok(!!(await p.$('#fb')), 'formulário de briefing aberto');
ok((await p.$eval('#fb [data-k="tipo"]', (x) => x.value)) === 'Casa', 'briefing da Joselia começa em Casa');
ok(await visivel('#fb [data-k="dormMin"]') && !(await visivel('#fb [data-k="haMin"]')) && !(await visivel('#fb [data-k="peMin"]')), 'briefing residencial: dormitórios visíveis, ha e pé-direito ocultos');
await sh('06_briefing_residencial');
await p.selectOption('#fb [data-k="tipo"]', 'Fazenda'); await W(200);
ok(await visivel('#fb [data-k="haMin"]') && !(await visivel('#fb [data-k="dormMin"]')), 'trocando para Fazenda: hectares aparecem');
await sh('07_briefing_rural');

// 6) Rodrigo: captação rural
await comoRodrigo();
await p.click('[data-tab="captar"]'); await W(500); await p.click('#nc'); await W(500); await p.click('[data-gp="rur"]'); await p.click('[data-ti="Fazenda"]'); await W(200); await p.click('#iniManual'); await W(800);
await p.selectOption('[data-c="tipo"]', 'Fazenda'); await W(500);
ok(!!(await p.$('[data-c="area_ha"]')) && !!(await p.$('[data-c="aptidao"]')), 'captação rural mostra hectares e aptidão');
ok(!(await p.$('[data-c="dormitorios"]')), 'captação rural sem dormitórios');
await sh('08_captacao_fazenda');
console.log('sw', await p.evaluate(() => document.documentElement.scrollWidth));
console.log(errs.length ? 'ERROS: ' + JSON.stringify(errs) : 'sem erros'); await b.close(); process.exit(errs.length ? 1 : 0);
