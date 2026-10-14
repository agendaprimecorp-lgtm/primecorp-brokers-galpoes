// E2E: documentos do imóvel (IA identifica IPTU/matrícula, cruza e varre sozinha) e Sala do Anunciante com dados documentais e anexos (celular 390×844).
import { chromium } from 'playwright'; import fs from 'node:fs';
const OUT = process.env.OUT || '/tmp/claude-0/telas10'; fs.mkdirSync(OUT, { recursive: true });
const HOST = 'https://primecorp-brokers-galpoes.netlify.app'; const L = 'http://localhost:8899';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, acceptDownloads: true });
await ctx.route('**/fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
await ctx.route(HOST + '/**', async (r) => { const resp = await r.fetch({ url: r.request().url().replace(HOST, L) }); await r.fulfill({ response: resp }); });
const errs = []; const watch = (pg) => { pg.on('pageerror', (e) => errs.push(e.message)); pg.on('console', (m) => m.type() === 'error' && !/fonts|ERR_|40[0-9]|422/.test(m.text()) && errs.push(m.text())); };
const ok = (c, m) => { if (!c) { console.error('✗', m); errs.push(m); } else console.log('✓', m); };
const p = await ctx.newPage(); watch(p);
const W = (ms = 450) => p.waitForTimeout(ms);
const sh = async (n, pg = p) => { await pg.addStyleTag({ content: '.toast{display:none!important}' }).catch(() => {}); await pg.waitForTimeout(250); await pg.screenshot({ path: `${OUT}/${n}.png` }); console.log('📷', n); };
const esperar = async (fn, ms = 20000, pg = p) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await pg.waitForTimeout(300); } return false; };
const doc = (d) => fetch(L + '/__documento', { method: 'POST', body: JSON.stringify(d) });
const put = (col, o) => p.evaluate(async ([col, o]) => { const r = await fetch(`/api/dados/${col}/${o.id}`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: location.origin }, body: JSON.stringify(o) }); if (!r.ok) throw new Error(await r.text()); }, [col, o]);
const pdf = '/tmp/claude-0/doc.pdf'; fs.writeFileSync(pdf, Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(2000, 32)]));
await p.goto(HOST + '/'); await W(900);
await put('config', { id: 'geral', com_venda_pct: '6', com_locacao_alugueis: '1' });
await put('ofertas', { id: 'o10', codigo: 'PC-0010', tipo: 'Galpão', operacao: 'Venda', cidade: 'Sumaré', uf: 'SP', regiao: 'Eixo Anhanguera (RMC)', terreno: '10.000', construida: '6.000', venda: '9.000.000', status: 'revisada', anunciante: 'Imobiliária Horizonte', anunciante_tipo: 'Imobiliária', anunciante_contato: '(19) 3333-2211', criado: new Date().toISOString() });
await p.reload(); await W(900);

// 1) Corretor envia o carnê do IPTU: a IA identifica, completa, cruza e a varredura roda sozinha
await doc({ doc: 'iptu', tipo_documento: 'carnê', exercicio: '2026', inscricao: '34.0021.0450.000', contribuinte: 'Indústria X Ltda', endereco: 'Rua Dom Barreto, 120', cep: '13170-000', area_terreno: 10000, area_construida: 7400, valor_venal_total: 4500000, debitos: true, alertas: [] });
await p.click('[data-tab="ofertas"]'); await W(); await p.click('[data-o="o10"]'); await W(600);
ok(/Enviar documento \(matrícula, IPTU, CCIR\/CAR\)/.test(await p.textContent('#vcard')), 'botão único para qualquer documento');
await p.setInputFiles('#vmat', pdf);
ok(await esperar(async () => /IPTU 2026/.test(await p.textContent('#vcard'))), 'IA identificou o IPTU e mostra o resumo');
const vc = await p.textContent('#vcard');
ok(/com débitos/.test(vc) && /CONSTAM DÉBITOS/.test(vc), 'débitos de IPTU sinalizados');
ok(/difere 19% do IPTU/.test(vc), 'área construída da oferta (6.000) × IPTU (7.400) sinalizada');
ok(/pedida 2,0× o venal/.test(vc), 'valor pedido comparado ao venal (referência)');
ok(await esperar(async () => /Rua Dom Barreto, Centro, Sumaré\/SP|Endereço confirmado pelo CEP · Rua Dom Barreto/.test(await p.textContent('#vit'))), 'varredura do CEP rodou sozinha com o CEP lido do IPTU');
await p.click('#vcard details.mat > summary'); await p.$eval('#vcard', (el) => el.scrollIntoView()); await sh('01_iptu_lido');

// 2) Sinal verde: pedido ao anunciante → Sala do Anunciante pede matrícula/IPTU e aceita anexos
const tk = 'PEDIDODOC1234567890ABCDEF';
await put('pedidos', { id: tk, oferta: 'o10', codigo: 'PC-0010', titulo: 'Galpão com 6.000 m² em Sumaré', operacao: 'Venda', tipo_termo: 'parceria', anunciante: 'Imobiliária Horizonte', faltam: [], conhecidos: [], termo_texto: 'Termo de teste', termo_versao: 'v2.1', status: 'aberto', expira: new Date(Date.now() + 9e8).toISOString(), criado: new Date().toISOString(), respostas: [], corretor: { nome: 'Rodrigo França Viana', creci: 'CRECI-SP 297692' } });
const A = await ctx.newPage(); watch(A); await A.goto(`${HOST}/anunciante.html?t=${tk}`); await A.waitForTimeout(900);
ok(/Documentação do imóvel/.test(await A.textContent('main')) && !!(await A.$('[data-d="matricula"]')), 'Sala do Anunciante pede matrícula, cartório, IPTU e CEP');
await A.$eval('#fd', (el) => el.scrollIntoView()); await sh('02_anunciante_documentacao', A);
await A.fill('[data-d="matricula"]', '45.678'); await A.fill('[data-d="cartorio"]', 'Oficial de Registro de Imóveis de Sumaré'); await A.click('#env');
ok(await esperar(async () => /Obrigado/.test(await A.textContent('main')), 10000, A), 'anunciante envia os dados documentais sem precisar aceitar ainda');
await doc({ doc: 'matricula', numero: '45678', cartorio: 'Oficial de Registro de Imóveis de Sumaré', data_certidao: new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10), area_terreno: 10050, construcao_averbada: false, proprietarios: [{ nome: 'INDÚSTRIA X LTDA', documento: '11.222.333/0001-81', fracao: '100%' }], onus: [{ ato: 'R-4', tipo: 'Alienação fiduciária', descricao: 'Banco Y', cancelado: false }], alertas: [] });
await A.setInputFiles('#fdoc', pdf);
ok(await esperar(async () => /recebido/.test(await A.textContent('main')), 10000, A), 'anexo da matrícula recebido');
await A.$eval('#fd', (el) => el.scrollIntoView()); await sh('03_anunciante_anexo', A);

// 3) De volta ao app: matrícula do anunciante lida sozinha e cruzada com o IPTU
await p.waitForTimeout(1500); await p.reload(); await W(900); await p.click('[data-tab="ofertas"]'); await W(); await p.click('[data-o="o10"]'); await W(700);
ok(await esperar(async () => /Matrícula 45678/.test(await p.textContent('#vcard'))), 'matrícula enviada pelo anunciante lida pela IA');
const v2 = await p.textContent('#vcard');
ok(/prefeitura cadastra 7400 m² construídos que não estão averbados/.test(v2), 'IPTU × matrícula: construção sem averbação apontada');
ok(/Alienação fiduciária/.test(v2), 'ônus ativo apontado');
ok((await p.$eval('[data-f="matricula"]', (x) => x.value)) === '45.678', 'nº da matrícula informado pelo anunciante entrou na oferta');
await p.$eval('#vcard', (el) => el.scrollIntoView()); await sh('04_oferta_cruzada');
await p.click('[data-tab="mais"]'); await W(); await p.click('#m7'); await W(); await p.click(`[data-p="${tk}"]`); await W(600);
ok(/Documentos enviados pelo anunciante/.test(await p.textContent('main')) && /Cartório de Registro de Imóveis/.test(await p.textContent('main')), 'pedido mostra anexos e dados documentais do anunciante');
await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await sh('05_pedido_documentos');
await doc(null);
console.log('sw', await p.evaluate(() => document.documentElement.scrollWidth), await A.evaluate(() => document.documentElement.scrollWidth));
console.log(errs.length ? 'ERROS: ' + JSON.stringify(errs) : 'sem erros'); await b.close(); process.exit(errs.length ? 1 : 0);
