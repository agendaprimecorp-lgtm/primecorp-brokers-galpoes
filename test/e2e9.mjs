// E2E: verificação do imóvel (campos, varredura, matrícula por IA, relatório) e Zoe (simulador, conversa real pelo webhook, agenda).
import { chromium } from 'playwright'; import fs from 'node:fs'; import crypto from 'node:crypto';
const OUT = process.env.OUT || '/tmp/claude-0/telas9'; fs.mkdirSync(OUT, { recursive: true });
const HOST = 'https://primecorp-brokers-galpoes.netlify.app';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const errs = [];
const ok = (c, m) => { if (!c) { console.error('✗', m); errs.push(m); } else console.log('✓', m); };
async function abrir(vw) {
  const ctx = await b.newContext({ viewport: vw, deviceScaleFactor: 2, acceptDownloads: true });
  await ctx.route('**/fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
  await ctx.route(HOST + '/**', async (r) => { const resp = await r.fetch({ url: r.request().url().replace(HOST, 'http://localhost:8899') }); await r.fulfill({ response: resp }); });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && !/fonts|ERR_|40[0-9]|422/.test(m.text()) && errs.push(m.text()));
  await p.goto(HOST + '/'); await p.waitForTimeout(900); return p;
}
const p = await abrir({ width: 390, height: 844 });
const W = (ms = 450) => p.waitForTimeout(ms);
const sh = async (n, pg = p, full = false) => { await pg.addStyleTag({ content: '.toast{display:none!important}' }).catch(() => {}); await pg.waitForTimeout(250); await pg.screenshot({ path: `${OUT}/${n}.png`, fullPage: full }); console.log('📷', n); };
const esperar = async (fn, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await W(250); } return false; };
const put = (pg, col, o) => pg.evaluate(async ([col, o]) => { const r = await fetch(`/api/dados/${col}/${o.id}`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: location.origin }, body: JSON.stringify(o) }); if (!r.ok) throw new Error(await r.text()); }, [col, o]);
const t0 = new Date().toISOString();
await put(p, 'config', { id: 'geral', com_venda_pct: '6', com_locacao_alugueis: '1' });
await put(p, 'ofertas', { id: 'o9', codigo: 'PC-0009', tipo: 'Galpão', operacao: 'Locação', cidade: 'Sumaré', uf: 'SP', regiao: 'Eixo Anhanguera (RMC)', terreno: '10.000', construida: '6.000', fabril: '5.400', pe_direito: '10', docas: '6', aluguel: '150.000', status: 'revisada', origem: 'Imobiliária', anunciante: 'Imobiliária Horizonte', criado: t0 });
await put(p, 'briefings', { id: 'b9', nome: 'Log Z · galpão 5 a 7 mil', tipo: 'Galpão', operacao: 'Locação', cidades: 'Sumaré', areaMin: '5.000', areaMax: '7.000', status: 'ativo', criado: t0 });
await p.reload(); await W(900);

// 1) Verificação
await p.click('[data-tab="ofertas"]'); await W(); await p.click('[data-o="o9"]'); await W(600);
ok(/SEM DADOS/.test(await p.textContent('#vcard')), 'verificação começa sem dados (cinza)');
await p.$eval('#vcard', (el) => el.scrollIntoView()); await sh('01_verificacao_vazia');
await p.click('#vcard details:has(.grid) > summary');
for (const [k, v] of [['cep', '13170-000'], ['endereco', 'Rua Dom Barreto'], ['numero', '100'], ['matricula', '45.678'], ['cartorio', 'CRI de Sumaré'], ['inscricao', '123.456.789'], ['proprietario', 'Indústria X Ltda'], ['proprietario_doc', '11.222.333/0001-81']]) await p.fill(`[data-f="${k}"]`, v);
await W(400); ok(/Matrícula 45\.678/.test(await p.textContent('#vit')), 'índice reage ao preencher (matrícula e cartório)');
await p.click('#vvar'); ok(await esperar(async () => /Rua Dom Barreto, Jardim Bom Retiro, Sumaré\/SP/.test(await p.textContent('#vit'))), 'varredura: endereço confirmado pelo CEP');
ok(/INDUSTRIA X LTDA · situação ATIVA/.test(await p.textContent('#vit')), 'varredura: CNPJ ativo na Receita');
await p.$eval('#vcard', (el) => el.scrollIntoView()); await sh('02_verificacao_varrida');
// matrícula
fs.writeFileSync('/tmp/claude-0/mat.pdf', Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(2000, 32)]));
await p.setInputFiles('#vmat', '/tmp/claude-0/mat.pdf');
ok(await esperar(async () => !!(await p.$('details.mat')), 25000), 'matrícula lida em segundo plano e exibida');
const vt = await p.textContent('#vcard'); ok(/BLOQUEADO/.test(vt) && /Penhora/.test(vt), 'penhora ativa bloqueia (vermelho)'); ok(/Proprietário confere com a matrícula · Na matrícula: INDÚSTRIA X LTDA/.test(vt), 'proprietário confere com a matrícula');
await p.click('details.mat > summary'); await p.$eval('#vcard', (el) => el.scrollIntoView()); await sh('03_matricula_lida', p, false);
await p.click('#vcard details:has(.certs) > summary'); await p.check('[data-cert="c_onus"]'); await W(300); ok(/certidões 1\/7/.test(await p.textContent('#vtxt')), 'certidões do vendedor contam no índice');
const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.click('#vpdf')]); ok(/Verificacao_PC-0009\.pdf/.test(dl.suggestedFilename()), 'relatório de verificação em PDF');
await dl.saveAs(`${OUT}/Verificacao_PC-0009.pdf`);

// 2) Zoe: simulador
await p.click('[data-tab="mais"]').catch(() => {}); await W(); await p.click('#m10'); await W(); await p.click('[data-aba="testar"]'); await W();
await p.fill('#ztx', 'Boa tarde'); await p.click('#zgo'); ok(await esperar(async () => /assistente virtual/.test(await p.textContent('#chat'))), 'simulador: Zoe se apresenta como assistente virtual (LGPD)');
await p.fill('#ztx', 'Procuro um galpão de 5 a 7 mil m² para alugar em Sumaré'); await p.click('#zgo');
ok(await esperar(async () => /PC-0009/.test(await p.textContent('#chat'))), 'simulador: registra demanda e encontra PC-0009 sem endereço');
ok(!/Dom Barreto|45\.678|Horizonte/.test(await p.textContent('#chat')), 'simulador: nada de endereço, matrícula ou anunciante');
ok(/gravaria briefings/.test(await p.textContent('#chat')), 'simulador mostra o que faria, sem gravar');
await sh('04_zoe_simulador');
await p.click('[data-eq="1"]'); await W(); await p.fill('#ztx', 'resumo do dia'); await p.click('#zgo'); ok(await esperar(async () => /briefings ativos/.test(await p.textContent('#chat'))), 'modo equipe: resumo da operação'); await sh('05_zoe_equipe');
await p.click('[data-aba="config"]'); await W(); await sh('06_zoe_conhecimento');

// 3) Conversa real pelo webhook (assinada) → Zoe responde → humano assume
const corpo = (texto, id) => JSON.stringify({ entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: '999' }, contacts: [{ wa_id: '5519911112222', profile: { name: 'Carlos · Log Z' } }], messages: [{ from: '5519911112222', id, timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: texto } }] } }] }] });
const mandar = async (texto, id) => { const c = corpo(texto, id); const r = await fetch('http://localhost:8899/whatsapp/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': 'sha256=' + crypto.createHmac('sha256', 'segredo-app').update(c).digest('hex') }, body: c }); return r.status; };
ok((await mandar('Oi, quero alugar um galpão de 6 mil m² em Sumaré', 'wamid.E1')) === 200, 'webhook aceita mensagem assinada');
await W(2500); await mandar('Podemos marcar uma reunião?', 'wamid.E2'); await W(2500);
await mandar('humano', 'wamid.E3'); await W(2000);
await p.click('[data-aba="conversas"]'); await W(); await p.reload(); await W(900); await p.click('#m10').catch(() => {}); await W();
if (!(await p.$('[data-zc="5519911112222"]'))) { await p.click('[data-tab="mais"]').catch(() => {}); await W(); await p.click('#m10'); await W(); }
ok(!!(await p.$('[data-zc="5519911112222"]')), 'conversa do WhatsApp aparece na lista'); await sh('07_zoe_conversas');
await p.click('[data-zc="5519911112222"]'); await W(600);
const ct = await p.textContent('main'); ok(/Assistente pediu você/.test(ct), 'transbordo: Zoe pede humano'); ok(/Tenho estes horários/.test(ct), 'Zoe ofereceu horários livres');
await p.fill('#htx', 'Oi Carlos, aqui é o Rodrigo. Te ligo em 10 minutos.'); await p.click('#hgo'); ok(await esperar(async () => /Rodrigo\. Te ligo/.test(await p.textContent('#chat'))), 'humano responde pelo app');
await sh('08_conversa', p, true);
await p.click('#dev'); ok(await esperar(async () => /Assistente atendendo/.test(await p.textContent('main'))), 'devolve para a Zoe');

// 4) Agenda e painel
await p.click('[data-tab="mais"]').catch(() => {}); await W(); await p.click('#m11'); await W(); await p.click('#nag');
const am = new Date(Date.now() + 864e5); am.setHours(10, 0, 0, 0); const loc = new Date(am.getTime() - am.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
await p.fill('#aini', loc); await p.fill('#anom', 'Carlos · Log Z'); await p.fill('#aass', 'Visita galpão PC-0009'); await p.selectOption('#atip', 'Visita ao imóvel'); await p.click('#asv'); await W(600);
ok(/Visita galpão PC-0009/.test(await p.textContent('main')), 'compromisso manual na agenda'); await sh('09_agenda');
await p.click('[data-tab="painel"]').catch(() => {}); await W(600); await sh('10_painel');

// 5) Computador
const d = await abrir({ width: 1366, height: 900 });
await d.click('[data-tab="ofertas"]').catch(() => {}); await d.waitForTimeout(500); await d.click('[data-o="o9"]'); await d.waitForTimeout(700); await d.$eval('#vcard', (el) => el.scrollIntoView()); await sh('11_desktop_verificacao', d);
await d.goto(HOST + '/'); await d.waitForTimeout(800);
console.log(errs.length ? '\nERROS:\n' + errs.join('\n') : '\nE2E 9 OK');
await b.close(); process.exit(errs.length ? 1 : 0);
