// E2E: equipe/permissões, captação no local (câmera + voz + IA), anúncio publicado e landing (celular 390×844).
import { chromium } from 'playwright'; import fs from 'node:fs';
const OUT = process.env.OUT || '/tmp/claude-0/telas3'; fs.mkdirSync(OUT, { recursive: true });
const HOST = 'https://primecorp-brokers-galpoes.netlify.app';
const FOT = '/tmp/claude-0/fotos_teste/';
const FS = '/home/claude/app/node_modules/@fontsource/';
let css = '';
for (const w of [400, 500, 600, 700]) css += `@font-face{font-family:'Barlow';font-weight:${w};src:url(data:font/woff2;base64,${fs.readFileSync(FS + `barlow/files/barlow-latin-${w}-normal.woff2`).toString('base64')}) format('woff2')}`;
for (const w of [500, 600, 700]) css += `@font-face{font-family:'Barlow Condensed';font-weight:${w};src:url(data:font/woff2;base64,${fs.readFileSync(FS + `barlow-condensed/files/barlow-condensed-latin-${w}-normal.woff2`).toString('base64')}) format('woff2')}`;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
await ctx.route('**/fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: css }));
await ctx.route(HOST + '/**', async r => { const resp = await r.fetch({ url: r.request().url().replace(HOST, 'http://localhost:8899') }); await r.fulfill({ response: resp }); });
// ditado simulado (Web Speech API)
await ctx.addInitScript(() => { window.__fala = 'suíte com armário planejado, a casa tem 3 dormitórios e 2 vagas'; const SR = class { start() { setTimeout(() => { this.onresult && this.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: window.__fala }], { isFinal: true })] }); setTimeout(() => this.onend && this.onend(), 50); }, 250); } stop() {} }; for (const k of ['webkitSpeechRecognition', 'SpeechRecognition']) Object.defineProperty(window, k, { value: SR, configurable: true, writable: true }); });
const errs = []; const watch = (pg) => { pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => m.type() === 'error' && !/fonts|ERR_|404/.test(m.text()) && errs.push(m.text())); };
const p = await ctx.newPage(); watch(p);
const W = (ms = 500) => p.waitForTimeout(ms);
const sh = async (n, pg = p) => { await pg.addStyleTag({ content: '.toast{display:none!important}' }).catch(() => {}); await pg.waitForTimeout(300); await pg.screenshot({ path: `${OUT}/${n}.png` }); console.log('📷', n); };
const ok = (c, m) => { if (!c) { console.error('✗', m); errs.push(m); } else console.log('✓', m); };
const esperar = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await W(250); } return false; };

await p.goto(HOST + '/'); await W(900);
// 1) equipe
await p.click('[data-tab="mais"]'); await W(400); await p.click('#m9'); await W(500);
await p.click('#seed'); await W(900);
const eq = await p.$$eval('[data-u] b', xs => xs.map(x => x.textContent)); ok(eq.length === 2 && eq.includes('Joselia Junqueira Viana'), 'equipe cadastrada: ' + eq.join(', '));
await sh('01_equipe');
await p.click('[data-u="u_comercial_primecorpconsultoria_com_br"]'); await W(400); await p.evaluate(() => document.querySelector('#fu').scrollIntoView()); await sh('02_equipe_joselia');
// 2) captação
await p.click('[data-tab="painel"]'); await W(500); await sh('03_painel_captar');
await p.click('#qcap'); await W(500); await p.click('#nc'); await W(500); await p.click('[data-ti="Casa"]'); await W(200); await p.click('#iniManual'); await W(800);
await p.selectOption('[data-c="tipo"]', 'Casa'); await W(300);
await p.fill('[data-c="cidade"]', 'Sumaré'); await p.fill('[data-c="regiao"]', 'Jardim Exemplo'); await p.fill('[data-c="endereco"]', 'Rua Secreta, 123'); await p.fill('[data-c="proprietario_nome"]', 'Carlos Proprietário'); await p.fill('[data-c="proprietario_tel"]', '(19) 98888-1111');
await W(900); await sh('04_captacao_inicio');
await p.setInputFiles('#camN', [FOT + 'f1.jpg', FOT + 'f2.jpg']);
ok(await esperar(async () => (await p.$$('.th img')).length === 2 && !!(await p.$('[data-ia]')) && /Reorganizar/.test(await p.textContent('[data-ia]'))), 'ambiente 1: 2 fotos tratadas, enviadas e organizadas pela IA');
ok((await p.$eval('.ambn', x => x.value)) === 'Sala de estar', 'IA nomeou o ambiente: Sala de estar');
await p.setInputFiles('#camN', [FOT + 'f3.jpg']);
ok(await esperar(async () => (await p.$$('.amb')).length === 2 && (await p.$$('.th img')).length === 3 && /Reorganizar/.test(await p.textContent('.amb:nth-child(2) [data-ia]'))), 'ambiente 2 criado e organizado');
const avisoEscuro = await esperar(async () => /escuro/i.test(await p.$eval('.amb:nth-child(2) .th', x => x.querySelector('i')?.title || '')), 4000); ok(avisoEscuro, 'foto escura recebeu aviso');
await p.click('.amb:nth-child(2) [data-mic]'); await W(900);
ok(/3 dormit/.test(await p.$eval('.amb:nth-child(2) textarea', x => x.value)), 'ditado por voz preencheu a fala do ambiente');
await p.click('.amb:nth-child(2) [data-ia]');
ok(await esperar(async () => (await p.$eval('.amb:nth-child(2) .ambn', x => x.value)) === 'Suíte'), 'IA renomeou para Suíte com a fala');
ok(await esperar(async () => (await p.$eval('[data-c="dormitorios"]', x => x.value)) === '3' && (await p.$eval('[data-c="vagas"]', x => x.value)) === '2'), 'dormitórios e vagas vieram da fala');
await p.evaluate(() => document.querySelector('#ambs').scrollIntoView()); await sh('05_ambientes');
// capa = foto do 2º ambiente? usa a primeira
await p.click('.amb:nth-child(1) [data-capa]'); await W(500);
await p.fill('#fg', 'Venda 850 mil, IPTU 2.400 por ano, sem condomínio, matrícula regular, desocupada.');
await p.setInputFiles('#camN', [FOT + 'f4.jpg']); await esperar(async () => (await p.$$('.th img')).length === 4);
await p.click('#ga');
ok(await esperar(async () => /3 dormitórios/.test(await p.$eval('[data-c="titulo"]', x => x.value))), 'anúncio gerado pela IA');
ok((await p.$eval('[data-c="venda"]', x => x.value)) === '850.000', 'valor de venda veio da fala geral');
await p.evaluate(() => document.querySelector('#fa').scrollIntoView()); await sh('06_anuncio_gerado');
await p.evaluate(() => document.querySelector('#fx').scrollIntoView()); await sh('07_passos_sem_autorizacao');
ok(await p.$eval('#pub', x => x.disabled), 'publicar bloqueado sem autorização');
await p.check('#amanual'); await W(700);
ok(!(await p.$eval('#pub', x => x.disabled)), 'publicar liberado após autorização registrada');
await p.click('#pub'); await W(1200);
const link = (await p.textContent('.linkbox')).trim(); ok(/\/i\/[\w-]{16,}$/.test(link), 'landing publicada: ' + link);
await p.evaluate(() => document.querySelector('#fx').scrollIntoView()); await sh('08_publicado');
// 3) landing
const L = await ctx.newPage(); watch(L); await L.goto(link.replace(HOST, HOST)); await L.waitForTimeout(1200);
const html = await L.content();
ok(html.includes('og:image') && !html.includes('Rua Secreta') && html.includes('Jardim Exemplo'), 'landing com og:image, bairro e sem endereço');
ok((await L.$$('.gal img')).length === 4, 'landing com 4 fotos por ambiente');
ok(/wa\.me\/5519998051985/.test(await L.$eval('.cta a', a => a.href)), 'WhatsApp do captador (Rodrigo)');
await sh('09_landing_topo', L);
await L.evaluate(() => window.scrollTo(0, 650)); await sh('10_landing_meio', L);
await L.evaluate(() => document.querySelector('h2:nth-of-type(2)')?.scrollIntoView()); await L.evaluate(() => window.scrollBy(0, -60)); await sh('11_landing_ambientes', L);
await L.click('.gal img'); await L.waitForTimeout(400); await sh('12_landing_foto', L); await L.close();
// 4) anúncios publicados e lista
await p.click('[data-tab="mais"]'); await W(300); await p.click('#m8'); await W(500); ok(/1 visita/.test(await p.textContent('main')), 'contador de visitas: ' + (await p.textContent('main .item .t span')));
await sh('13_anuncios');
await p.click('[data-tab="captar"]'); await W(500); await sh('14_lista_captacoes');
// 5) Joselia (corretora)
await ctx.addCookies([{ name: 'tu', value: 'comercial@primecorpconsultoria.com.br', url: 'https://primecorp-brokers-galpoes.netlify.app' }]);
await p.reload(); await W(1200);
await p.click('[data-tab="mais"]'); await W(400);
const menu = await p.textContent('main'); ok(!/Configurações|Backup|Equipe/.test(menu) && /corretor\(a\)/.test(menu), 'corretora não vê configurações, backup nem equipe');
await sh('15_joselia_mais');
await p.click('[data-tab="captar"]'); await W(400); ok(/Nenhuma captação/.test(await p.textContent('main')), 'filtro "Minhas" vazio para Joselia');
await p.click('#nc'); await W(500); await p.click('[data-ti="Casa"]'); await W(200); await p.click('#iniManual'); await W(800);
const cap = await p.$eval('[data-c="captador"]', x => x.options[x.selectedIndex].text); ok(/Joselia/.test(cap) && await p.$eval('[data-c="captador"]', x => x.disabled), 'captação da Joselia em nome dela: ' + cap);
await p.fill('[data-c="cidade"]', 'Hortolândia'); await W(900);
await p.setInputFiles('#camN', [FOT + 'f1.jpg']); await esperar(async () => (await p.$$('.th img')).length === 1);
await sh('16_joselia_captacao');
console.log('sw', await p.evaluate(() => document.documentElement.scrollWidth));
console.log(errs.length ? 'ERROS: ' + JSON.stringify(errs) : 'sem erros'); await b.close(); process.exit(errs.length ? 1 : 0);
