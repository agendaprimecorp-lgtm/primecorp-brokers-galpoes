// E2E: visita guiada com câmera ao vivo (câmera simulada do Chromium), voz, IA por ambiente,
// alternativa da câmera nativa e SAC nas páginas (celular 390×844). Rodar 2x seguidas para estabilidade.
import { chromium } from 'playwright'; import fs from 'node:fs';
const OUT = process.env.OUT || '/tmp/claude-0/telas6'; fs.mkdirSync(OUT, { recursive: true });
const HOST = 'https://primecorp-brokers-galpoes.netlify.app'; const FOT = '/tmp/claude-0/fotos_teste/';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const novoCtx = async () => { const c = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['camera', 'microphone'] });
  await c.route('**/fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
  await c.route(HOST + '/**', async (r) => { const resp = await r.fetch({ url: r.request().url().replace(HOST, 'http://localhost:8899') }); await r.fulfill({ response: resp }); });
  await c.addInitScript(() => { const SR = class { start() { setTimeout(() => { this.onresult && this.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: window.__fala || 'ambiente amplo' }], { isFinal: true })] }); }, 150); } stop() { setTimeout(() => this.onend && this.onend(), 30); } }; for (const k of ['webkitSpeechRecognition', 'SpeechRecognition']) Object.defineProperty(window, k, { value: SR, configurable: true, writable: true }); });
  return c; };
const ctx = await novoCtx();
const errs = []; const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && !/fonts|ERR_|40[0-9]/.test(m.text()) && errs.push(m.text()));
const W = (ms = 400) => p.waitForTimeout(ms);
const sh = async (n, pg = p) => { await pg.addStyleTag({ content: '.toast{display:none!important}' }).catch(() => {}); await pg.waitForTimeout(250); await pg.screenshot({ path: `${OUT}/${n}.png` }); console.log('📷', n); };
const ok = (c, m) => { if (!c) { console.error('✗', m); errs.push(m); } else console.log('✓', m); };
const esperar = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await W(200); } return false; };
const txt = (s = 'main') => p.textContent(s);
await p.goto(HOST + '/'); await W(900);

// 1) nova captação → visita guiada
await p.click('[data-tab="captar"]'); await W(400); ok(/Iniciar registro fotográfico/.test(await txt()), 'botão Iniciar registro fotográfico'); await p.click('#nc'); await W(500);
await p.click('[data-gp="res"]'); await p.click('[data-ti="Casa"]'); await W(250); ok((await p.$$eval('.rch', (xs) => xs.map((x) => x.textContent.trim()))).slice(0, 3).join(' · ') === 'Fachada · Sala · Cozinha', 'roteiro da casa mostrado antes de começar (com ícones)'); await sh('00_iniciar_tipo');
await p.click('#ini'); await W(800);
ok(await esperar(async () => p.$eval('#vid', (v) => v.videoWidth > 0 && !v.paused)), 'câmera ao vivo aberta dentro do app');
ok(/1 de \d+/.test(await txt('#vpos')) && (await txt('#vnome')) === 'Fachada', 'começa pelo primeiro ambiente do roteiro: Fachada');
await sh('01_visita_fachada');
// cabe numa tela de iPhone com as barras do Safari (390×664): foto, descrever e seguir sem rolar
await p.setViewportSize({ width: 390, height: 664 }); await W(400);
const cabe = await p.evaluate(() => ['#bk', '#vnome', '#obt', '#vmic', '#vprox', '#vant', '#vfala'].map((q) => { const r = document.querySelector(q).getBoundingClientRect(); return [q, r.top >= 0 && r.bottom <= innerHeight + 0.5]; }));
ok(cabe.every(([, v]) => v) && (await p.evaluate(() => scrollY)) === 0, 'visita cabe na tela sem rolar: ' + cabe.filter(([, v]) => !v).map(([q]) => q).join(' ') );
ok(await p.$eval('.tabs', (x) => getComputedStyle(x).display === 'none'), 'abas escondidas durante a visita (tela inteira para a câmera)');
await sh('01b_visita_664'); await p.setViewportSize({ width: 390, height: 844 }); await W(300);
ok(/Tire a foto/.test(await txt('#vguia')), 'guia: tire a foto'); await p.click('#obt'); ok(await esperar(async () => (await p.$$('#vthumbs img')).length === 1), 'disparo registra a foto'); ok(await esperar(async () => /descreva os detalhes/.test(await txt('#vguia')) && (await p.$eval('#vmic', (b) => b.classList.contains('pulse')))), 'guia: agora descreva os detalhes (microfone em destaque)');
ok(await esperar(async () => !(await p.$eval('#vdesc', (x) => x.hidden))), 'IA descreve o ambiente depois da foto');
await p.evaluate(() => (window.__fala = 'fachada com portão eletrônico, a casa tem 3 dormitórios e 2 vagas'));
await p.click('#vmic'); await W(500); ok(/Parar/.test(await txt('#vmic')), 'microfone gravando'); await p.click('#vmic');
ok(await esperar(async () => /portão eletrônico/.test(await p.$eval('#vfala', (x) => x.value))), 'fala registrada no ambiente');
ok(await esperar(async () => /Pronto: salve e siga/.test(await txt('#vguia'))), 'guia do passo: foto → descrever → salvar e seguir');
ok(await esperar(async () => /Dados da fala aplicados/.test(await txt('#vst'))), 'números da fala aplicados na ficha (dormitórios, vagas)');
await sh('02_visita_fala_ia'); ok((await p.$$('#vstrip .vs')).length >= 9 && !!(await p.$('#vstrip .vs.on')), 'faixa de ambientes na visita'); await p.click('#vstrip [data-vi="2"]'); await W(300); ok((await txt('#vnome')) === 'Cozinha', 'tocar na faixa pula para o ambiente'); await p.click('#vstrip [data-vi="0"]'); await W(300);
// 2) percorre o roteiro: fotografa as obrigatórias, pula as opcionais
let guarda = 0;
while (guarda++ < 30) {
  const nome = await txt('#vnome'); const prox = await txt('#vprox'); if (process.env.DBG) console.log('ANTES', guarda, nome, await txt('#vpos'), (await p.$$('#vthumbs img')).length);
  if (!/opcional/.test(nome) && (await p.$$('#vthumbs img')).length === 0) { await p.click('#obt'); await esperar(async () => (await p.$$('#vthumbs img')).length >= 1); }
  if (guarda === 3) await sh('03_visita_meio');
  if (/Concluir/.test(prox)) break;
  await p.click('#vprox'); await W(250);
}
ok(/obrigatórias completas/.test(await txt('#vpos')), 'todas as fotos obrigatórias feitas: ' + (await txt('#vpos')));
await p.click('#vant'); await W(300); ok(!/Concluir/.test(await txt('#vprox')), 'voltar para o ambiente anterior');
await p.click('#vextra'); await W(500); ok(/Ambiente extra/.test(await txt('#vpos')), 'ambiente extra'); await p.click('#obt'); await esperar(async () => (await p.$$('#vthumbs img')).length === 1);
await p.click('#vprox'); await W(300);
await p.click('#vfim'); await W(800);
ok(await esperar(async () => /3 dormitórios/.test(await p.$eval('[data-c="titulo"]', (x) => x.value)), 20000), 'ao concluir, volta e gera o anúncio com a IA');
const vid = await p.$('#vid'); ok(!vid, 'câmera fechada ao sair da visita');
const rtc = (await txt('#ranel')).replace(/\s/g, ''); const [f1, t1] = rtc.match(/(\d+)\/(\d+)/).slice(1).map(Number); const faltam = await p.$$eval('.rt.obr .rn', (xs) => xs.map((x) => x.textContent.trim()));
ok(f1 === t1 || (t1 - f1 === 1 && faltam[0] === 'Banheiro 2'), 'roteiro na captação: ' + rtc + (faltam.length ? ' · o anúncio informou 2 banheiros e o roteiro passou a pedir: ' + faltam.join(', ') : ''));
await sh('04_captacao_pos_visita');
await p.evaluate(() => document.querySelector('#ambs').scrollIntoView()); await sh('05_ambientes_descritos');
const ambs = await p.$$eval('.ambn', (xs) => xs.map((x) => x.value)); ok(ambs[0] === 'Fachada' && ambs.includes('Cozinha'), 'ambientes com os nomes do roteiro: ' + ambs.join(', '));
const descs = await p.$$eval('#ambs .desc', (xs) => xs.length); ok(descs >= 5, `${descs} ambientes descritos pela IA`);

// 3) câmera bloqueada: alternativa da câmera nativa
const c2 = await novoCtx(); await c2.addInitScript(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(Object.assign(new Error('negado'), { name: 'NotAllowedError' })); });
const p2 = await c2.newPage(); p2.on('pageerror', (e) => errs.push(e.message));
await p2.goto(HOST + '/'); await p2.waitForTimeout(900); await p2.click('[data-tab="captar"]'); await p2.waitForTimeout(400); await p2.click('#nc'); await p2.waitForTimeout(500); await p2.click('[data-gp="gal"]'); await p2.click('[data-ti="Galpão"]'); await p2.waitForTimeout(200); await p2.click('#ini'); await p2.waitForTimeout(900);
ok(/bloqueada/.test(await p2.textContent('#vmsg')) && !(await p2.$eval('#vfb', (x) => x.hidden)), 'câmera bloqueada: oferece a câmera do celular');
await p2.setInputFiles('#vfile', [FOT + 'f1.jpg']); ok(await (async () => { for (let i = 0; i < 40; i++) { if ((await p2.$$('#vthumbs img')).length === 1) return true; await p2.waitForTimeout(250); } return false; })(), 'foto pela câmera nativa registrada no ambiente');
await sh('06_camera_bloqueada', p2); await c2.close();

// 4) SAC
await p.click('[data-tab="mais"]'); await W(400); ok(/sac@primecorpconsultoria\.com\.br/.test(await txt()), 'SAC em Mais'); await sh('07_sac');
const sala = await (await fetch('http://localhost:8899/sala.js')).text(); const anun = await (await fetch('http://localhost:8899/anunciante.js')).text();
ok(sala.includes('sac@primecorpconsultoria.com.br') && anun.includes('sac@primecorpconsultoria.com.br'), 'SAC na Sala do Cliente e na Sala do Anunciante');
console.log('sw', await p.evaluate(() => document.documentElement.scrollWidth));
console.log(errs.length ? 'ERROS: ' + JSON.stringify(errs) : 'sem erros'); await b.close(); process.exit(errs.length ? 1 : 0);
