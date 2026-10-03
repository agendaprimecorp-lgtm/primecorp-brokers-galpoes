// Gera capturas de tela de demonstração (celular 390×844 @3x) com dados fictícios.
import { chromium } from 'playwright'; import fs from 'node:fs';
const OUT = process.env.OUT || '/tmp/claude-0/telas'; fs.mkdirSync(OUT, { recursive: true });
const HOST = 'https://primecorp-brokers-galpoes.netlify.app';
const FS = '/home/claude/app/node_modules/@fontsource/';
let css = '';
for (const w of [400, 500, 600, 700]) css += `@font-face{font-family:'Barlow';font-weight:${w};src:url(data:font/woff2;base64,${fs.readFileSync(FS + `barlow/files/barlow-latin-${w}-normal.woff2`).toString('base64')}) format('woff2')}`;
for (const w of [500, 600, 700]) css += `@font-face{font-family:'Barlow Condensed';font-weight:${w};src:url(data:font/woff2;base64,${fs.readFileSync(FS + `barlow-condensed/files/barlow-condensed-latin-${w}-normal.woff2`).toString('base64')}) format('woff2')}`;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, acceptDownloads: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
await ctx.route('**/fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: css }));
await ctx.route('**/fonts.gstatic.com/**', r => r.abort());
await ctx.route(HOST + '/**', async r => { const req = r.request(); const u = req.url().replace(HOST, 'http://localhost:8899'); const resp = await r.fetch({ url: u }); await r.fulfill({ response: resp }); });
const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
const W = (ms = 500) => p.waitForTimeout(ms);
const sh = async (n, pg = p) => { await pg.addStyleTag({ content: '.toast{display:none!important}' }).catch(()=>{}); await pg.waitForTimeout(250); await pg.screenshot({ path: `${OUT}/${n}.png` }); console.log('📷', n); };
await p.goto(HOST + '/'); await W(900);

const put = (col, o) => p.evaluate(async ([col, o]) => { const r = await fetch(`/api/dados/${col}/${o.id}`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: location.origin }, body: JSON.stringify(o) }); if (!r.ok) throw new Error(await r.text()); }, [col, o]);
const cod = () => p.evaluate(async () => (await (await fetch('/api/codigo', { method: 'POST', headers: { origin: location.origin } })).json()).codigo);
const d = (dias, h = 10) => { const x = new Date('2026-10-02T13:00:00Z'); x.setUTCDate(x.getUTCDate() - dias); x.setUTCHours(h + 3); return x.toISOString(); };

// ---------- CRM ----------
const C = {
  ana: { id: 'c_ana', nome: 'Ana Souza', empresa: 'Indústria X Ltda', cargo: 'Diretora de Operações', tipo: 'Cliente (empresa)', telefone: '(19) 98888-7777', email: 'ana@industriax.com.br', cidade: 'Sumaré', origem: 'Indicação', criado: d(12), atualizado: d(1), log: [{ t: d(12, 9), ev: 'Reunião de briefing (30 min): galpão de 10 a 14 mil m² para centro de distribuição' }, { t: d(11, 15), ev: 'Enviado teaser com 3 opções pelo WhatsApp' }] },
  carlos: { id: 'c_carlos', nome: 'Carlos Mendes', empresa: 'Family office (cliente investidor)', cargo: 'Sócio', tipo: 'Cliente (investidor)', telefone: '(11) 97777-1212', email: 'carlos@exemplo.com.br', cidade: 'São Paulo', origem: 'LinkedIn', criado: d(20), atualizado: d(2), log: [{ t: d(20, 11), ev: 'Busca galpão locado para renda, até R$ 45 milhões' }, { t: d(3, 16), ev: 'Visita agendada · PC-0004' }] },
  marcos: { id: 'c_marcos', nome: 'Marcos Lima', empresa: 'Corretor autônomo', cargo: 'CRECI ativo', tipo: 'Corretor parceiro', telefone: '(19) 99111-2233', cidade: 'Campinas', origem: 'Rede de corretores', criado: d(30), atualizado: d(5), log: [{ t: d(30, 10), ev: 'Parceria 50/50 combinada por escrito' }] },
  paula: { id: 'c_paula', nome: 'Paula Reis', empresa: 'Imobiliária parceira', cargo: 'Gerente comercial', tipo: 'Imobiliária', telefone: '(19) 3222-4455', cidade: 'Hortolândia', origem: 'Portal', criado: d(9), atualizado: d(4), log: [{ t: d(4, 14), ev: 'Disponibilidade confirmada · PC-0002' }] },
  rui: { id: 'c_rui', nome: 'Rui Andrade', empresa: 'Proprietário', tipo: 'Proprietário', telefone: '(19) 98123-4567', cidade: 'Paulínia', origem: 'Indicação', criado: d(15), atualizado: d(3), log: [] },
};
for (const c of Object.values(C)) await put('contatos', c);

// ---------- Ofertas ----------
const O = [
  { id: 'o1', tipo: 'Galpão', operacao: 'Locação', cidade: 'Sumaré', uf: 'SP', regiao: 'Eixo Anhanguera (RMC)', terreno: '25.000', construida: '13.000', fabril: '12.400', administrativo: '600', pe_direito: '12', docas: '10', energia_kva: '500', piso_carga: '6', avcb: 'Vigente', aluguel: '266.600', condominio: '18.600', iptu: '9.800', iptu_periodo: 'mensal', origem: 'Portal', status: 'revisada', criado: d(11) },
  { id: 'o2', tipo: 'Galpão', operacao: 'Locação', cidade: 'Hortolândia', uf: 'SP', regiao: 'Hortolândia (RMC)', fabril: '11.000', construida: '11.600', pe_direito: '10', docas: '8', aluguel: '242.000', iptu: '118.000', origem: 'Imobiliária', status: 'revisada', criado: d(10) },
  { id: 'o3', tipo: 'Galpão', operacao: 'Locação', cidade: 'Campinas', uf: 'SP', regiao: 'Eixo Santos-Dumont (Campinas)', terreno: '30.000', construida: '14.600', fabril: '13.800', administrativo: '800', pe_direito: '14', docas: '14', energia_kva: '750', piso_carga: '6', avcb: 'Vigente', aluguel: '383.600', condominio: '22.000', iptu: '14.500', iptu_periodo: 'mensal', origem: 'Corretor parceiro', status: 'revisada', criado: d(9) },
  { id: 'o4', tipo: 'Galpão', operacao: 'Venda', cidade: 'Paulínia', uf: 'SP', regiao: 'Paulínia (RMC)', terreno: '22.000', construida: '9.800', fabril: '9.200', pe_direito: '12', docas: '9', energia_kva: '600', piso_carga: '5', avcb: 'Vigente', venda: '41.500.000', origem: 'Proprietário', status: 'revisada', criado: d(14), diferenciais: 'Locado · contrato típico de 10 anos' },
  { id: 'o5', tipo: 'Galpão', operacao: 'Locação', cidade: 'Jundiaí', uf: 'SP', regiao: 'Jundiaí · Anhanguera', fabril: '18.000', pe_direito: '12', docas: '16', aluguel: '432.000', origem: 'Alerta por e-mail', status: 'nova', criado: d(0, 8), link: 'https://portal.exemplo/anuncio' },
];
for (const o of O) { o.codigo = await cod(); o.atualizado = o.criado; o.link ||= 'https://portal.exemplo/' + o.id; await put('ofertas', o); }

// ---------- Briefings ----------
const B1 = { id: 'b1', nome: 'Indústria X · CD 12 mil m²', tipo: 'Galpão', operacao: 'Locação', cidades: 'Sumaré, Hortolândia, Campinas', regiao: 'RMC', areaMin: '10.000', areaMax: '14.000', peMin: '10', docasMin: '8', kvaMin: '300', precoMaxM2: '28', prazo: 'Ocupação em até 90 dias', status: 'ativo', cliente: 'c_ana', parceiro_id: 'c_marcos', parceiro: 'Marcos Lima', criado: d(12), atualizado: d(12) };
const B2 = { id: 'b2', nome: 'Investidor · galpão locado para renda', tipo: 'Galpão', operacao: 'Venda', cidades: 'Paulínia, Campinas, Jundiaí', regiao: 'RMC', areaMin: '8.000', areaMax: '20.000', valorMax: '45.000.000', status: 'ativo', cliente: 'c_carlos', criado: d(20), atualizado: d(20) };
await put('briefings', B1); await put('briefings', B2);

await p.reload(); await W(900);

// ---------- Termo (configuração) ----------
await p.click('[data-tab="mais"]'); await W(); await p.click('#m5'); await W(600);
const termo = await p.$eval('[data-k="termo"]', t => t.value);
await p.fill('[data-k="termo"]', termo.replace('[__] meses', '24 meses').replace('[__]% do valor', '6% do valor').replace('[__] aluguel', '1 aluguel'));
await p.check('#rv'); await p.click('#sv'); await W(700);

// ---------- Briefing + ranking + teaser ----------
await p.click('[data-tab="briefings"]'); await W(); await p.click('[data-b="b1"]'); await W(700); await sh('05_briefing');
await p.evaluate(() => window.scrollTo(0, document.querySelector('.score')?.closest('.card')?.offsetTop - 70 || 400)); await sh('06_ranking');
await p.evaluate(() => window.scrollTo(0, 0));
await p.click('button:has-text("Teaser")'); await W(700); await sh('07_teaser'); await p.click('.back'); await W(600);

// ---------- Sala ----------
await p.click('#sala'); await W(700);
{ const v = await p.$eval('select', s => [...s.options].find(o => o.text.includes('Ana'))?.value); if (v) await p.selectOption('select', v); }
await sh('08_novasala'); await p.click('#cr'); await W(1300); await sh('09_sala_admin');
const link = (await p.textContent('#lk')).trim(); console.log('link', link);

// Cliente
const c = await ctx.newPage(); c.on('pageerror', e => errs.push(e.message)); await c.goto(link); await c.waitForTimeout(800); await sh('10_cliente_cadastro', c);
await c.fill('#razao', 'Indústria X Ltda'); await c.fill('#documento', '11222333000181'); await c.fill('#responsavel', 'Ana Souza'); await c.fill('#cargo', 'Diretora de Operações'); await c.fill('#telefone', '(19) 98888-7777'); await c.fill('#email', 'ana@industriax.com.br');
await c.evaluate(() => document.querySelector('#ok').scrollIntoView({ block: 'center' })); await c.check('#ok'); await sh('11_cliente_termo', c);
await c.click('#env'); await c.waitForTimeout(900); await c.evaluate(() => window.scrollTo(0, 0)); await sh('12_cliente_opcoes', c);
const btns = await c.$$('[data-c]'); if (btns.length) { await btns[0].click(); await c.waitForTimeout(900); }
const btn2 = await c.$$('[data-c]'); if (btn2.length) { await btn2[0].click(); await c.waitForTimeout(900); }
await c.evaluate(() => document.querySelector('.tag.ok')?.closest('.op')?.scrollIntoView({ block: 'start' })); await sh('13_cliente_interesse', c);
await c.close();

// ---------- Negócios extras ----------
await put('negocios', { id: 'n_inv', briefing: 'b2', oferta: 'o4', contato: 'c_carlos', parceiro: 'Carlos Mendes', tel: '(11) 97777-1212', etapa: 'visita', origem: 'teaser', criado: d(6), atualizado: d(3), log: [{ t: d(6, 10), ev: 'Teaser enviado (PC-0004)' }, { t: d(5, 11), ev: 'Etapa: Termo assinado' }, { t: d(4, 15), ev: 'Etapa: Parceria · proprietário de acordo' }, { t: d(3, 16), ev: 'Etapa: Visita · agendada para 06/10' }] });
await put('negocios', { id: 'n_hort', briefing: 'b1', oferta: 'o2', contato: 'c_paula', parceiro: 'Indústria X Ltda', etapa: 'parceria', origem: 'teaser', criado: d(8), atualizado: d(4), log: [{ t: d(8, 10), ev: 'Teaser enviado (PC-0002)' }, { t: d(4, 14), ev: 'Etapa: Parceria · Imobiliária parceira confirmou disponibilidade' }] });
await p.reload(); await W(1000);

await p.click('[data-tab="painel"]').catch(() => {}); await W(700); await sh('01_painel');
await p.evaluate(() => window.scrollTo(0, 330)); await sh('02_painel_kanban'); await p.evaluate(() => window.scrollTo(0, 0));

// ---------- Ofertas ----------
await p.click('[data-tab="ofertas"]'); await W(600); await sh('03_ofertas');
await p.click('[data-o="o1"]'); await W(700); await sh('04_oferta');
await p.evaluate(() => window.scrollTo(0, 99999)); await sh('04b_oferta_fim'); await p.click('.back'); await W(500);
await p.click('[data-o="o2"]'); await W(700); await sh('04c_oferta_amarela'); await p.click('.back'); await W(500);
await p.click('#nv'); await W(500);
await p.fill('#url', 'https://portal.exemplo/galpao-sumare-12400');
await p.fill('#src', 'Galpão logístico para locação em Sumaré/SP, condomínio fechado com portaria 24h. Área fabril de 12.400 m², pé-direito livre de 12 m, 10 docas niveladoras, piso 6 t/m², cabine primária 500 kVA. Escritórios 600 m². Aluguel R$ 266.600/mês, condomínio R$ 18.600, IPTU R$ 9.800/mês. AVCB vigente.');
await sh('14_nova_oferta'); await p.click('.back').catch(() => {}); await W(500);

// ---------- Negócio ----------
await p.click('[data-tab="painel"]'); await W(600);
const deal = await p.$('.deal'); if (deal) { await deal.click(); await W(700); }
await sh('15_negocio_bloqueado');
await p.click('[data-e="termo"]'); await W(600);
const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.click('#pdf')]); await dl.saveAs(`${OUT}/ficha.pdf`); await W(900);
await sh('16_negocio');

// ---------- CRM ----------
await p.click('[data-tab="contatos"]'); await W(600); await sh('17_crm');
await p.click('text=Ana Souza'); await W(700); await sh('18_contato');

// ---------- Mais ----------
await p.click('[data-tab="mais"]'); await W(500); await sh('19_mais');
await p.click('#m3'); await W(800); await sh('20_relatorios');
await p.click('[data-tab="mais"]'); await p.click('#m4'); await W(800); await sh('21_backup');
await p.click('[data-tab="mais"]'); await p.click('#m2'); await W(600); await sh('22_salas'); await p.click('[data-s]'); await W(700); await p.evaluate(() => window.scrollTo(0, 330)); await sh('23_sala_aceite');
console.log('errs', errs); await b.close();
