// E2E Propto (celular 390×844): proprietário avulso, corretor com plano, admin confere CRECI e intermediação.
import { chromium } from 'playwright'; import fs from 'node:fs'; import { unzipSync, strFromU8 } from 'fflate';
const OUT = process.env.OUT || '/tmp/claude-0/telas_propto'; fs.mkdirSync(OUT, { recursive: true });
const B = 'http://localhost:8898'; const FOT = '/tmp/claude-0/fotos_teste/';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true });
await ctx.route('**/fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
await ctx.route('https://sandbox.asaas.com/**', (r) => r.fulfill({ contentType: 'text/html', body: '<h1>Fatura Asaas (simulada)</h1>' }));
await ctx.addInitScript(() => { window.__fala = 'sala ampla com piso porcelanato, a casa tem 3 dormitórios e 2 vagas'; const SR = class { start() { setTimeout(() => { this.onresult && this.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: window.__fala }], { isFinal: true })] }); setTimeout(() => this.onend && this.onend(), 60); }, 200); } stop() { this.onend && this.onend(); } }; for (const k of ['webkitSpeechRecognition', 'SpeechRecognition']) Object.defineProperty(window, k, { value: SR, configurable: true, writable: true }); });
const errs = []; const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && !/fonts|ERR_|40[0-9]|sandbox/.test(m.text()) && errs.push(m.text()));
const W = (ms = 400) => p.waitForTimeout(ms);
const sh = async (n, pg = p) => { await pg.addStyleTag({ content: '#toast{display:none!important}' }).catch(() => {}); await pg.waitForTimeout(250); await pg.screenshot({ path: `${OUT}/${n}.png` }); console.log('📷', n); };
const ok = (c, m) => { if (!c) { console.error('✗', m); errs.push(m); } else console.log('✓', m); };
const esperar = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await W(250); } return false; };
const txt = (s = 'main') => p.textContent(s);
const comoUsuario = async (email) => { await ctx.clearCookies(); await ctx.addCookies([{ name: 'tu', value: encodeURIComponent(email), url: B }]); await p.goto(B + '/app'); await W(900); };
const pagar = async (filtro) => { const st = await (await fetch(B + '/__asaas')).json(); const pay = Object.values(st.pays).filter(filtro).at(-1); const r = await fetch(B + '/webhook/asaas', { method: 'POST', headers: { 'content-type': 'application/json', 'asaas-access-token': 'tok_webhook_123' }, body: JSON.stringify({ id: 'e2e_' + pay.id, event: 'PAYMENT_RECEIVED', payment: pay }) }); return r.status; };

// 0) página de vendas
await p.goto(B + '/'); await W(500); ok(/anúncio pronto/.test(await txt('h1')) && /R\$ 99,99/.test(await txt('body')), 'página de vendas com planos'); await sh('00_vendas');
await p.evaluate(() => document.querySelector('#planos').scrollIntoView()); await sh('00b_vendas_planos');
// 1) entrar / criar conta
await p.goto(B + '/app'); await W(700); ok(/Entrar no Propto/.test(await txt()), 'tela de entrada'); await sh('01_entrar');
await p.click('[data-m="criar"]'); await p.fill('#em', 'pedro@exemplo.com'); await p.fill('#se', '123'); await p.click('#ok'); ok(/8 caracteres/.test(await txt('#st')), 'senha curta recusada');
await p.fill('#se', 'senhaforte1'); await p.click('#ok'); await W(300); ok(/confirmação/.test(await txt('#st')), 'conta criada pede confirmação por e-mail');
// 2) proprietário: cadastro → planos → avulso
await comoUsuario('pedro@exemplo.com'); ok(/Como você vai usar/.test(await txt()), 'cadastro pergunta o tipo de conta'); await sh('02_cadastro_tipos');
await p.click('[data-t="proprietario"]'); await W(200);
ok(!(await p.$('#cn')), 'proprietário não informa CRECI');
await p.fill('#nm', 'Pedro Dono'); await p.fill('#doc', '390.533.447-05'); await p.fill('#tel', '(19) 97777-6666');
await p.click('#sv'); await W(300); ok(/Termos/.test(await txt('#st')), 'exige aceite dos termos');
await p.check('#ac'); await sh('03_cadastro_proprietario'); await p.click('#sv'); await W(1200);
ok(/Nova captação/.test(await txt()) && /Escolha um plano/.test(await txt('#nova')), 'início: sem acesso ainda'); await sh('04_inicio_sem_plano');
await p.click('#nova'); await W(700); ok(/49,90/.test(await txt()) && !(/99,99/.test(await txt())), 'proprietário vê só o avulso'); await sh('05_planos_proprietario');
await p.click('[data-plano="avulso"]'); await p.waitForURL(/sandbox\.asaas\.com/); ok(true, 'redirecionado para a fatura do Asaas');
ok((await pagar((x) => /^avulso:/.test(x.externalReference))) === 200, 'webhook de pagamento aceito');
await p.goto(B + '/app'); await W(900); ok(/1 anúncio\(s\) avulso/.test(await txt('#nova')), 'crédito avulso liberado');
// 3) captação guiada
await p.click('#nova'); await W(500); await p.click('[data-t="Casa"]'); await W(150); await sh('06_nova_tipo'); await p.click('#go'); await W(1000);
ok(/Roteiro de fotos/.test(await txt()) && /Fachada/.test(await txt()) && /obrigatória/.test(await txt()), 'roteiro de fotos da casa');
await sh('07_roteiro');
await p.click('[data-foto="fachada"]').catch(() => {}); await p.setInputFiles('#cam', [FOT + 'f1.jpg']);
ok(await esperar(async () => (await p.$$('[data-r="fachada"] .thumbs img')).length === 1 && /iluminado/.test(await p.textContent('[data-r="fachada"] .desc'))), 'fachada: foto tratada, enviada e descrita pela IA');
await p.click('[data-foto="sala"]').catch(() => {}); await p.setInputFiles('#cam', [FOT + 'f2.jpg', FOT + 'f3.jpg']);
ok(await esperar(async () => (await p.$$('[data-r="sala"] .thumbs img')).length === 2), 'sala: 2 fotos');
await p.click('[data-mic="sala"]'); await W(700); await p.click('[data-mic="sala"]'); ok(await esperar(async () => /porcelanato/.test(await p.textContent('[data-r="sala"]'))), 'fala da sala registrada');
ok(await esperar(async () => /4 dorm|Dormitório 3/.test(await txt()) || (await p.$$('[data-r^="dorm"]')).length === 3), 'roteiro cresceu para 3 dormitórios após a fala');
await p.evaluate(() => document.querySelector('[data-r="sala"]').scrollIntoView()); await sh('08_roteiro_fotos');
await p.click('[data-p="dados"]'); await W(400);
for (const [k, v] of [['cidade', 'Sumaré'], ['bairro', 'Jardim Exemplo'], ['construida', '140'], ['banheiros', '2'], ['venda', '850000'], ['iptu', '2400'], ['documentacao', 'Matrícula regular'], ['disponibilidade', 'Imediata'], ['endereco', 'Rua Secreta, 99']]) await p.fill(`[data-k="${k}"]`, v);
ok((await p.$eval('[data-k="dormitorios"]', (x) => x.value)) === '3', 'IA preencheu dormitórios a partir da fala'); await W(900); await sh('09_dados');
await p.click('[data-p="anuncio"]'); await W(300); await p.click('#gerar'); ok(await esperar(async () => /3 dormitórios/.test(await p.$eval('#at', (x) => x.value))), 'anúncio gerado'); await sh('10_anuncio');
await p.click('[data-p="entregar"]'); await W(400); ok(/Falta para completar/.test(await txt()), 'checklist mostra o que falta'); await sh('11_entregar');
await p.click('#pub'); ok(/declaração/.test(await txt('#stp')), 'publicar exige declaração');
await p.check('#decl'); await p.click('#pub'); ok(await esperar(async () => /\/a\/[\w-]{16,}/.test(await txt('#lk'))), 'página publicada');
const link = (await txt('#lk')).trim(); await sh('12_publicado');
const [dl] = await Promise.all([p.waitForEvent('download'), p.click('#pdf')]); const pdfp = OUT + '/apresentacao.pdf'; await dl.saveAs(pdfp); ok(fs.readFileSync(pdfp).slice(0, 4).toString() === '%PDF' && fs.statSync(pdfp).size > 20000, 'PDF gerado: ' + dl.suggestedFilename());
const [dz] = await Promise.all([p.waitForEvent('download'), p.click('#zip')]); const zp = OUT + '/pacote.zip'; await dz.saveAs(zp);
const z = unzipSync(new Uint8Array(fs.readFileSync(zp))); const nomes = Object.keys(z);
ok(nomes.includes('imovel.xml') && nomes.includes('imovel.csv') && nomes.filter((n) => n.startsWith('fotos/')).length === 3, 'pacote: XML, CSV e 3 fotos: ' + nomes.join(', '));
const xml = strFromU8(z['imovel.xml']); ok(/<ListPrice currency="BRL">850000/.test(xml) && !/Rua Secreta/.test(xml) && /\/a\/.+\/f\/0\.jpg/.test(xml), 'XML com preço, fotos públicas e sem endereço');
await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await sh('13_entregas');
await p.click('#inter'); await W(500); ok(/Pedido enviado/.test(await txt()), 'pediu corretor parceiro');
const L = await ctx.newPage(); await L.goto(link.replace(/^https?:\/\/[^/]+/, B)); await L.waitForTimeout(700);
const lh = await L.content(); ok(!lh.includes('Rua Secreta') && /venda direta/.test(lh) && (await L.$$('.gal img')).length === 3, 'landing: sem endereço, venda direta, 3 fotos'); await sh('14_landing', L); await L.close();
await p.click('[data-tab="inicio"]'); await W(700); ok(/Escolha um plano/.test(await txt('#nova')), 'avulso usado: precisa comprar de novo'); ok(/no ar/.test(await txt()), 'continua vendo o anúncio feito'); await sh('15_inicio_pos_avulso');

// 4) corretora com CRECI: plano mensal
await comoUsuario('ana@exemplo.com'); await p.click('[data-t="corretor"]'); await W(150);
await p.fill('#nm', 'Ana Souza'); await p.fill('#doc', '529.982.247-25'); await p.fill('#tel', '(19) 98888-7777'); await p.fill('#cn', '123456'); await p.check('#ac'); await sh('16_cadastro_corretora'); await p.click('#sv'); await W(1200);
ok(/em verificação/.test(await txt()), 'CRECI em verificação avisado');
await p.click('[data-tab="planos"]'); await W(600); ok(/99,99/.test(await txt()) && !/199,99/.test(await txt()), 'corretora vê autônomo e avulso'); await sh('17_planos_corretora');
await p.click('[data-plano="autonomo"]'); await p.waitForURL(/sandbox\.asaas\.com/);
await pagar((x) => /^assinatura:/.test(x.externalReference || '') || !!x.subscription);
await p.goto(B + '/app'); await W(900); ok(/30 captação/.test(await txt('#nova')), 'plano ativo: 30 captações no mês'); await sh('18_inicio_corretora');
// 5) admin (Rodrigo): confere CRECI e aceita intermediação
await comoUsuario('contato@primecorpconsultoria.com.br'); await p.click('[data-t="corretor"]'); await W(150);
await p.fill('#nm', 'Rodrigo França Viana'); await p.fill('#doc', '529.982.247-25'); await p.fill('#tel', '(19) 99805-1985'); await p.fill('#cn', '297692'); await p.check('#ac'); await p.click('#sv'); await W(1200);
ok(/Roteiro guiado|disponíveis/.test(await txt('#nova')), 'admin capta sem plano');
await p.click('[data-tab="admin"]'); await W(900); ok(/99,99/.test(await txt()) && /Ana Souza/.test(await txt()), 'admin: MRR e CRECI para conferir'); await sh('19_admin');
await p.locator('[data-cid]', { hasText: 'Ana Souza' }).locator('[data-sit="suspenso"]').click(); await W(900);
const box = await p.$('[data-im]'); ok(/sugerido: joselia/.test(await box.textContent()), 'pedido residencial sugerido para a Joselia');
await p.click('[data-im] [data-st="aceita"]'); await W(500); ok(/autorização/.test(await p.textContent('#toast')), 'aceitar exige autorização assinada');
await p.check('[data-im] [data-aut]'); await p.click('[data-im] [data-st="aceita"]'); await W(900);
const L2 = await ctx.newPage(); await L2.goto(link.replace(/^https?:\/\/[^/]+/, B)); await L2.waitForTimeout(600); ok(/Joselia Junqueira Viana/.test(await L2.content()) && /300760/.test(await L2.content()), 'landing passa a mostrar a corretora'); await sh('20_landing_corretora', L2); await L2.close();
// 6) corretora vê a pendência no CRECI e dá ciência
await comoUsuario('ana@exemplo.com'); ok(/inscrição suspensa/.test(await txt()), 'pendência no CRECI avisada'); await sh('21_creci_pendente');
await p.click('#ciente'); await W(900); ok(/Ciência registrada/.test(await txt()), 'ciência registrada');
console.log('sw', await p.evaluate(() => document.documentElement.scrollWidth));
console.log(errs.length ? 'ERROS: ' + JSON.stringify(errs) : 'sem erros'); await b.close(); process.exit(errs.length ? 1 : 0);
