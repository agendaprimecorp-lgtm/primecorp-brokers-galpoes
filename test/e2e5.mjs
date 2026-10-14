// E2E: módulo link (fotos, contato, teaser), sinal verde automático, autorização do anunciante,
// fotos guardadas, roteiro guiado na captação e pacote para sistema de imobiliária (celular 390×844).
import { chromium } from 'playwright'; import fs from 'node:fs'; import { unzipSync, strFromU8 } from 'fflate';
const OUT = process.env.OUT || '/tmp/claude-0/telas5'; fs.mkdirSync(OUT, { recursive: true });
const HOST = 'https://primecorp-brokers-galpoes.netlify.app'; const FOT = '/tmp/claude-0/fotos_teste/';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true, permissions: ['camera', 'microphone'] });
await ctx.route('**/fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
await ctx.route(HOST + '/**', async (r) => { const resp = await r.fetch({ url: r.request().url().replace(HOST, 'http://localhost:8899') }); await r.fulfill({ response: resp }); });
await ctx.addInitScript(() => { const SR = class { start() { setTimeout(() => { this.onresult && this.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'fachada com portão' }], { isFinal: true })] }); }, 200); } stop() { this.onend && this.onend(); } }; for (const k of ['webkitSpeechRecognition', 'SpeechRecognition']) Object.defineProperty(window, k, { value: SR, configurable: true, writable: true }); });
const errs = []; const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && !/fonts|ERR_|40[0-9]|422/.test(m.text()) && errs.push(m.text()));
const W = (ms = 450) => p.waitForTimeout(ms);
const sh = async (n, pg = p) => { await pg.addStyleTag({ content: '.toast{display:none!important}' }).catch(() => {}); await pg.waitForTimeout(250); await pg.screenshot({ path: `${OUT}/${n}.png` }); console.log('📷', n); };
const ok = (c, m) => { if (!c) { console.error('✗', m); errs.push(m); } else console.log('✓', m); };
const esperar = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await W(250); } return false; };
const txt = (s = 'main') => p.textContent(s);
await p.goto(HOST + '/'); await W(900);
const put = (col, o) => p.evaluate(async ([col, o]) => { const r = await fetch(`/api/dados/${col}/${o.id}`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: location.origin }, body: JSON.stringify(o) }); if (!r.ok) throw new Error(await r.text()); }, [col, o]);
const t0 = new Date().toISOString();
await put('config', { id: 'geral', termo_revisado: true, aut_revisado: true, com_revisada: true, acordo_revisado: true, prazo_cliente: '24', prazo_indicacao: '12', prazo_repasse: '5', prazo_nao_contorno: '12', prazo_autorizacao: '90', prazo_pos_autorizacao: '6', prazo_mandato: '90', com_venda_pct: '6', com_locacao_alugueis: '1' });
await put('briefings', { id: 'b1', nome: 'Logística X · galpão 2 a 3 mil m²', tipo: 'Galpão', operacao: 'Locação', cidades: 'Hortolândia, Sumaré', areaMin: '2.000', areaMax: '3.000', status: 'ativo', criado: t0 });
await p.reload(); await W(900);

// 1) link com fotos e contato
await p.click('[data-tab="ofertas"]'); await W(); await p.click('#nv'); await W(400);
await p.fill('#url', 'https://93.184.215.14/galpao-fotos'); await p.click('#bx');
ok(await esperar(async () => (await p.$('[data-f="tipo"]')) && (await p.$eval('[data-f="tipo"]', (x) => x.value)) === 'Galpão'), 'link lido: galpão');
ok(/\(19\) 98765-4321/.test(await txt()), 'contato do anunciante extraído do anúncio (WhatsApp)');
ok(/4 foto\(s\) encontrada/.test(await txt()), 'fotos do anúncio encontradas (sem logo)');
await p.$eval('.thumbs', (el) => el.scrollIntoView()); // as miniaturas usam loading=lazy
ok(await esperar(async () => (await p.$$eval('.thumbs img', (xs) => xs.filter((i) => i.complete && i.naturalWidth > 0).length)) >= 4), 'fotos de referência carregadas pelo proxy');
ok(/Uso interno/.test(await txt()) && !(await p.$('#guardar')), 'aviso de uso interno; sem botão de guardar antes da autorização');
ok(/2\.\d{3}|mil m²/.test(await p.textContent('#tzt')) && !/Horizonte/.test(await p.textContent('#tzt')), 'teaser em faixas e sem o nome do anunciante');
await sh('01_oferta_link_fotos');
await p.evaluate(() => document.querySelector('#tzt').scrollIntoView()); await sh('02_teaser');
await p.click('#sv'); await W(700);
const oid = await p.evaluate(async () => { const r = await fetch('/api/dados'); const d = await r.json(); return d.ofertas.find((o) => o.anunciante === 'Imobiliária Horizonte').id; });

// 2) sinal verde a partir do interesse do cliente na Sala
await put('salas', { id: 'SALATESTE1234567890ABCD', briefing: 'b1', titulo: 'Opções Logística X', opcoes: [{ codigo: 'PC-9001', oferta: oid, titulo: 'Galpão · RMC', linhas: [] }], interesses: [{ codigo: 'PC-9001', em: t0 }], aceite: { razao: 'Logística X', responsavel: 'Ana', em: t0 }, status: 'ativa', expira: new Date(Date.now() + 9e8).toISOString(), criado: t0 });
await p.reload(); await W(900); await p.click('[data-tab="painel"]'); await W(600);
ok(/Sinal verde: 1 oferta/.test(await txt()), 'painel mostra sinal verde (cliente interessado, sem pedido)'); await sh('03_painel_sinal_verde');
await p.click('[data-sv]'); await W(1200);
ok(/anunciante\.html\?t=/.test(await txt('#lk')), 'pedido gerado automaticamente com link');
const wa = await p.$eval('a[href^="https://wa.me/"]', (a) => a.href); ok(/wa\.me\/5519987654321/.test(wa) && /autoriza/i.test(decodeURIComponent(wa)), 'WhatsApp do anunciante com mensagem pronta');
ok(/sinal verde/.test(await txt()), 'pedido marcado como sinal verde'); await sh('04_pedido_automatico');
const plink = (await txt('#lk')).trim();
await p.click('[data-tab="painel"]'); await W(500); ok(!/Sinal verde: 1/.test(await txt()), 'sinal verde some depois do pedido');

// 3) anunciante responde e autoriza (página pública)
const A = await ctx.newPage(); await A.goto(plink.replace(/^https?:\/\/[^/]+/, HOST)); await A.waitForTimeout(900);
ok(/1\.1\. MATERIAL DO IMÓVEL/.test(await A.textContent('main')), 'termo inclui o uso privado das fotos (v2.1)');
const camposA = await A.$$('[data-c]'); for (const el of camposA.slice(0, 3)) { const tag = await el.evaluate((x) => x.tagName); if (tag === 'SELECT') await el.selectOption({ index: 1 }); else await el.fill('5'); }
for (const [id, v] of [['razao', 'Imobiliária Horizonte Ltda'], ['documento', '11.222.333/0001-81'], ['creci', '45678-J'], ['responsavel', 'Carla'], ['telefone', '(19) 3333-2211'], ['email', 'carla@horizonte.com.br']]) await A.fill('#' + id, v);
await A.check('#ok'); await A.click('#env'); await A.waitForTimeout(1200); ok(/Autorização registrada|registradas/.test(await A.textContent('main')), 'anunciante autorizou'); await sh('05_anunciante_autorizou', A); await A.close();

// 4) fotos guardadas com autorização
await p.reload(); await W(900); await p.click('[data-tab="ofertas"]'); await W(); await p.click(`[data-o="${oid}"]`); await W(800);
ok(!!(await p.$('#guardar')), 'botão para guardar as fotos aparece após a autorização');
await p.click('#guardar'); ok(await esperar(async () => /4 foto\(s\) guardada/.test(await txt()), 25000), '4 fotos guardadas no sistema'); await sh('06_fotos_guardadas');

// 5) captação com roteiro guiado + pacote
await p.click('[data-tab="captar"]'); await W(500); await p.click('#nc'); await W(500); await p.click('[data-gp="res"]'); await p.click('[data-ti="Casa"]'); await W(200); await p.selectOption('#iop', 'Venda'); await p.click('#iniManual'); await W(900);
await p.selectOption('[data-c="tipo"]', 'Casa'); await W(600);
ok(/Registro fotográfico/.test(await txt()) && /^0\/\d+/.test(await txt('#ranel')) && (await p.$$('.rt.obr')).length >= 5, 'mosaico do roteiro da casa'); await sh('07_roteiro_casa');
await p.click('[data-rf="fachada"]'); await W(700); ok((await p.textContent('#vnome')) === 'Fachada', 'toque no mosaico abre a câmera no ambiente'); await esperar(async () => p.$eval('#vid', (v) => v.videoWidth > 0)); await p.click('#obt'); await esperar(async () => (await p.$$('#vthumbs img')).length === 1); await p.click('#bk'); await W(900);
ok(await esperar(async () => /^1/.test(await txt('#ranel')) && !!(await p.$('.rt.ok img'))), 'foto da fachada marca o item do roteiro (miniatura no mosaico)');
ok(await esperar(async () => (await p.$eval('.ambn', (x) => x.value)) === 'Fachada'), 'ambiente criado com o nome do roteiro (IA não renomeia)');
await p.setInputFiles('#camN', [FOT + 'f2.jpg']); await esperar(async () => (await p.$$('.amb')).length === 2);
await W(1500); await sh('08_roteiro_progresso');
for (const [k, v] of [['cidade', 'Sumaré'], ['regiao', 'Jardim Exemplo'], ['titulo', 'Casa com 3 dormitórios em Sumaré'], ['descricao', 'Casa térrea, 3 dormitórios.'], ['venda', '850000']]) await p.fill(`[data-c="${k}"]`, v);
await W(1000);
const [dz] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), p.click('#zipc')]); const zp = OUT + '/pacote.zip'; await dz.saveAs(zp);
const z = unzipSync(new Uint8Array(fs.readFileSync(zp))); const nomes = Object.keys(z);
ok(nomes.includes('imovel.xml') && nomes.includes('imovel.csv') && nomes.some((n) => /fotos\/01-fachada-1\.jpg/.test(n)), 'pacote exportado: ' + nomes.join(', '));
ok(/Residential \/ Home/.test(strFromU8(z['imovel.xml'])) && /850000/.test(strFromU8(z['imovel.xml'])), 'XML VRSync com tipo e preço');
await p.evaluate(() => document.querySelector('#fx').scrollIntoView()); await sh('09_passos_pacote');
console.log('sw', await p.evaluate(() => document.documentElement.scrollWidth));
console.log(errs.length ? 'ERROS: ' + JSON.stringify(errs) : 'sem erros'); await b.close(); process.exit(errs.length ? 1 : 0);
