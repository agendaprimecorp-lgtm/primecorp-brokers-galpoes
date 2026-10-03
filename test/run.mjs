import fsx from "node:fs";
import { NetlifyDB } from "@netlify/database-dev";
import assert from "node:assert/strict";
const db = new NetlifyDB(); const cs = await db.start(); await db.applyMigrations("./netlify/database/migrations");
process.env.NETLIFY_DB_URL = cs;
const api = (await import("./out/api.mjs")).default;
const sala = (await import("./out/sala.mjs")).default;
const backup = (await import("./out/backup-diario.mjs")).default;
const imovel = (await import("./out/imovel.mjs")).default;
const ctx = (params = {}) => ({ params, ip: "200.1.2.3", site: { url: "https://pc.test" } });
const R = (m, p, body, h = {}) => new Request("https://pc.test" + p, { method: m, headers: { "content-type": "application/json", origin: "https://pc.test", ...h }, body: body ? JSON.stringify(body) : undefined });
const J = async (r) => ({ s: r.status, j: await r.json().catch(() => null) });
let ok = 0; const t = async (n, f) => { await f(); ok++; console.log("✓", n); };

await t("401 sem login", async () => { assert.equal((await api(R("GET", "/api/dados"), ctx())).status, 401); });
globalThis.__user = { email: "contato@primecorpconsultoria.com.br" };
process.env.ADMIN_EMAILS = "contato@primecorpconsultoria.com.br";
await t("403 outro usuário", async () => { globalThis.__user = { email: "x@y.com" }; assert.equal((await api(R("GET", "/api/dados"), ctx())).status, 403); globalThis.__user = { email: "contato@primecorpconsultoria.com.br" }; });
await t("CSRF origem", async () => { assert.equal((await api(R("PUT", "/api/dados/ofertas/o1", { a: 1 }, { origin: "https://evil.com" }), ctx())).status, 403); });
await t("PUT/GET dados", async () => {
  let r = await J(await api(R("PUT", "/api/dados/ofertas/o1", { id: "o1", tipo: "Galpão", cidade: "Sumaré", regiao: "Eixo Anhanguera (RMC)", fabril: "12.400", aluguel: "266.600", link: "https://x/1" }), ctx())); assert.equal(r.s, 200);
  await api(R("PUT", "/api/dados/briefings/b1", { nome: "Ind X", tipo: "Galpão", operacao: "Locação" }), ctx());
  r = await J(await api(R("GET", "/api/dados"), ctx())); assert.equal(r.j.ofertas.length, 1); assert.equal(r.j.ofertas[0].id, "o1"); assert.ok(Array.isArray(r.j.contatos));
});
await t("coleção inválida / id inválido", async () => { assert.equal((await api(R("PUT", "/api/dados/x/o1", {}), ctx())).status, 400); assert.equal((await api(R("PUT", "/api/dados/ofertas/a%20b", {}), ctx())).status, 400); });
await t("DELETE suave", async () => { await api(R("PUT", "/api/dados/contatos/c9", { nome: "Z" }), ctx()); await api(R("DELETE", "/api/dados/contatos/c9"), ctx()); const r = await J(await api(R("GET", "/api/dados"), ctx())); assert.equal(r.j.contatos.length, 0); });
await t("código PC", async () => { const a = await J(await api(R("POST", "/api/codigo"), ctx())); const b = await J(await api(R("POST", "/api/codigo"), ctx())); assert.equal(a.j.codigo, "PC-0001"); assert.equal(b.j.codigo, "PC-0002"); });
let arq;
await t("emissão com PDF e download", async () => {
  const pdf = Buffer.from("%PDF-1.4 teste").toString("base64");
  const r = await J(await api(R("POST", "/api/emissoes", { tipo: "ficha_pdf", oferta_id: "o1", pdf_base64: pdf, nome_arquivo: "Ficha X.pdf" }), ctx()));
  assert.equal(r.s, 200); assert.match(r.j.codigo, /^EM-\d{5}$/); arq = r.j.arquivo;
  const d = await api(R("GET", "/api/arquivo?k=" + encodeURIComponent(arq)), ctx()); assert.equal(d.status, 200); assert.equal((await d.text()).slice(0, 4), "%PDF");
  const bad = await J(await api(R("POST", "/api/emissoes", { tipo: "ficha_pdf", pdf_base64: Buffer.from("xx").toString("base64") }), ctx())); assert.equal(bad.s, 400);
  const l = await J(await api(R("GET", "/api/emissoes"), ctx())); assert.equal(l.j.emissoes[0].tipo, "ficha_pdf"); assert.equal(l.j.emissoes[0].meta.usuario, "contato@primecorpconsultoria.com.br");
});
await t("extração um/vários", async () => {
  const a = await J(await api(R("POST", "/api/extrair", { modo: "um", texto: "x".repeat(60) }), ctx())); assert.equal(a.j.fabril, 12400);
  const b = await J(await api(R("POST", "/api/extrair", { modo: "varios", texto: "x".repeat(90) }), ctx())); assert.equal(b.j.ofertas.length, 1);
  const c = await J(await api(R("POST", "/api/extrair", { modo: "um", texto: "curto" }), ctx())); assert.equal(c.s, 400);
});
// SALA
const TOK = "AbCdEfGhIjKlMnOpQrStUvWxYz012345";
await api(R("PUT", "/api/dados/salas/" + TOK, { briefing: "b1", titulo: "Galpão · RMC", opcoes: [{ codigo: "PC-0001", oferta: "o1", titulo: "Galpão · Eixo Anhanguera (RMC)", linhas: ["Área fabril entre 12 e 13 mil m²"] }], termo_texto: "TERMO TESTE", termo_versao: "v1", expira: new Date(Date.now() + 864e5).toISOString(), status: "ativa", interesses: [] }), ctx());
const S = (m, body) => sala(new Request("https://pc.test/publico/sala/" + TOK, { method: m, headers: { "content-type": "application/json", "user-agent": "teste" }, body: body ? JSON.stringify(body) : undefined }), ctx({ token: TOK }));
await t("sala: antes do aceite não mostra opções nem id interno", async () => { const r = await J(await S("GET")); assert.equal(r.s, 200); assert.equal(r.j.aceito, false); assert.equal(r.j.opcoes.length, 0); assert.equal(r.j.total_opcoes, 1); assert.ok(!JSON.stringify(r.j).includes("o1")); });
await t("sala: interesse sem aceite = 403", async () => { assert.equal((await S("POST", { acao: "interesse", codigo: "PC-0001" })).status, 403); });
await t("sala: validações", async () => {
  assert.equal((await J(await S("POST", { acao: "aceite", razao: "Ind X", documento: "11.111.111/1111-11", responsavel: "Ana", email: "a@b.com", telefone: "19999990000", concordo: true }))).s, 400);
  assert.equal((await J(await S("POST", { acao: "aceite", razao: "Ind X", documento: "11.222.333/0001-81", responsavel: "Ana", email: "a@b.com", telefone: "19999990000", concordo: false }))).s, 400);
});
await t("sala: aceite válido registra IP, hash e emissão", async () => {
  const r = await J(await S("POST", { acao: "aceite", razao: "Ind X Ltda", documento: "11.222.333/0001-81", responsavel: "Ana", cargo: "Diretora", email: "Ana@B.com", telefone: "(19) 99999-0000", concordo: true }));
  assert.equal(r.s, 200); assert.equal(r.j.aceito, true); assert.equal(r.j.opcoes.length, 1); assert.ok(!JSON.stringify(r.j).includes('"o1"'));
  const d = await J(await api(R("GET", "/api/dados"), ctx())); const s = d.j.salas[0]; assert.equal(s.aceite.ip, "200.1.2.3"); assert.equal(s.aceite.email, "ana@b.com"); assert.equal(s.aceite.termo_sha256.length, 64);
});
await t("sala: interesse cria negócio e emissão", async () => {
  const r = await J(await S("POST", { acao: "interesse", codigo: "PC-0001" })); assert.equal(r.j.opcoes[0].interesse, true);
  const d = await J(await api(R("GET", "/api/dados"), ctx())); assert.equal(d.j.negocios.length, 1); assert.equal(d.j.negocios[0].etapa, "interesse"); assert.equal(d.j.negocios[0].oferta, "o1");
  await S("POST", { acao: "interesse", codigo: "PC-0001" }); const d2 = await J(await api(R("GET", "/api/dados"), ctx())); assert.equal(d2.j.negocios.length, 1);
  const e = await J(await api(R("GET", "/api/emissoes"), ctx())); assert.deepEqual(e.j.emissoes.map((x) => x.tipo).slice(0, 2), ["interesse", "aceite"]);
});
await t("sala: token inválido e expirada", async () => {
  assert.equal((await sala(new Request("https://pc.test/publico/sala/x"), ctx({ token: "x" }))).status, 404);
  const T2 = "ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ"; await api(R("PUT", "/api/dados/salas/" + T2, { status: "ativa", expira: "2020-01-01T00:00:00Z", opcoes: [] }), ctx());
  assert.equal((await sala(new Request("https://pc.test/publico/sala/" + T2), ctx({ token: T2 }))).status, 410);
});
await t("backup manual e restauração", async () => {
  const b = await (await api(R("GET", "/api/backup"), ctx())).json(); assert.ok(b.registros.length >= 5); assert.ok(b.emissoes.length >= 3);
  assert.equal((await api(R("POST", "/api/restaurar", { backup: b }), ctx())).status, 400);
  await api(R("DELETE", "/api/dados/ofertas/o1"), ctx());
  const r = await J(await api(R("POST", "/api/restaurar", { confirmacao: "RESTAURAR", backup: b }), ctx())); assert.equal(r.s, 200);
  const d = await J(await api(R("GET", "/api/dados"), ctx())); assert.equal(d.j.ofertas.length, 1);
});
await t("backup diário + listagem + rotação 30", async () => {
  const st = globalThis.__stores.backups || new Map(); globalThis.__stores.backups = st;
  for (let i = 1; i <= 31; i++) st.set(`backup-2025-01-${String(i).padStart(2, "0")}.json`, { data: "{}", metadata: {} });
  await backup(new Request("https://pc.test"), ctx());
  const l = await J(await api(R("GET", "/api/backups"), ctx())); assert.equal(l.j.backups.length, 30); assert.ok(l.j.backups[0].startsWith("backup-2026"));
  const g = await api(R("GET", "/api/backups/" + l.j.backups[0]), ctx()); assert.equal(g.status, 200);
  assert.equal((await api(R("GET", "/api/backups/..%2Fx"), ctx())).status, 400);
});
await t("status", async () => { const s = await J(await api(R("GET", "/api/status"), ctx())); assert.equal(s.j.coleta_configurada, false); });

// SALA DO ANUNCIANTE
const anun = (await import("./out/anunciante.mjs")).default;
const TA = "AnUnCiAnTe0123456789abcdefghijKL";
await api(R("PUT", "/api/dados/ofertas/o7", { id: "o7", tipo: "Galpão", operacao: "Locação / Venda", construida: "1.638", venda: "7.500.000", codigo: "PC-0007", anunciante: "Imob Exemplo" }), ctx());
await api(R("PUT", "/api/dados/pedidos/" + TA, { oferta: "o7", codigo: "PC-0007", titulo: "Galpão com 1.638 m²", tipo_termo: "parceria", anunciante: "Imob Exemplo", demanda: 2,
  conhecidos: [["Área construída", "1.638 m²"]], faltam: [{ campo: "terreno", rotulo: "Área do terreno", pergunta: "Qual o terreno?", tipo: "m²" }, { campo: "iptu_periodo", rotulo: "IPTU", pergunta: "Mensal ou anual?", tipo: "sel:mensal|anual" }, { campo: "avcb", rotulo: "AVCB", pergunta: "AVCB?", tipo: "text" }],
  comissao: { base: "ambos", pct: 6, alugueis: 1, partes: [{ papel: "Imobiliária anunciante", pct: 50, nome: "Imob Exemplo" }, { papel: "PrimeCorp (indicação)", pct: 50 }], texto: "6% sobre a venda ou 1 aluguel" },
  termo_texto: "TERMO AUT", termo_versao: "v1", expira: new Date(Date.now() + 864e5).toISOString(), status: "aberto", respostas: [] }), ctx());
const A = (m, body) => anun(new Request("https://pc.test/publico/anunciante/" + TA, { method: m, headers: { "content-type": "application/json", "user-agent": "teste" }, body: body ? JSON.stringify(body) : undefined }), ctx({ token: TA }));
await t("anunciante: GET não expõe ids internos nem cliente", async () => { const r = await J(await A("GET")); assert.equal(r.s, 200); assert.equal(r.j.perguntas.length, 3); assert.equal(r.j.demanda, 2); const t0 = JSON.stringify(r.j); assert.ok(!t0.includes('"o7"')); assert.ok(!t0.includes("briefing")); });
await t("anunciante: token inválido / expirado", async () => {
  assert.equal((await anun(new Request("https://pc.test/x"), ctx({ token: "curto" }))).status, 404);
  const TX = "ExPiRaDo0123456789abcdefghijKLmn"; await api(R("PUT", "/api/dados/pedidos/" + TX, { oferta: "o7", expira: new Date(Date.now() - 1000).toISOString(), status: "aberto" }), ctx());
  assert.equal((await anun(new Request("https://pc.test/x"), ctx({ token: TX }))).status, 410);
});
await t("anunciante: validações", async () => {
  assert.equal((await A("POST", { acao: "responder", campos: {} })).status, 400);
  assert.equal((await A("POST", { acao: "responder", campos: { iptu_periodo: "semestral" } })).status, 400);
  assert.equal((await A("POST", { acao: "responder", campos: { terreno: "não sei" } })).status, 400);
  assert.equal((await A("POST", { acao: "responder", campos: {}, aceite: { razao: "Imob", documento: "11.222.333/0001-81", responsavel: "Paula", email: "p@i.com", telefone: "1932224455", concordo: true } })).status, 400, "parceria exige CRECI");
});
await t("anunciante: só campos pedidos entram; dados vão para a oferta", async () => {
  const r = await J(await A("POST", { acao: "responder", campos: { terreno: "3.200", avcb: "Vigente até 2027", aluguel: "1", venda: "1" } }));
  assert.equal(r.s, 200); assert.equal(r.j.aceito, false);
  const d = await J(await api(R("GET", "/api/dados"), ctx())); const o = d.j.ofertas.find((x) => x.id === "o7");
  assert.equal(o.terreno, "3.200"); assert.equal(o.avcb, "Vigente até 2027"); assert.equal(o.venda, "7.500.000"); assert.equal(o.fontes.terreno, "anunciante"); assert.equal(o.revisar_anunciante, true);
  const p = d.j.pedidos.find((x) => x.id === TA); assert.equal(p.status, "respondido"); assert.equal(p.respostas.length, 1);
});
await t("anunciante: autorização com CRECI registra IP, hash e emissões", async () => {
  const r = await J(await A("POST", { acao: "responder", campos: { iptu_periodo: "anual" }, aceite: { razao: "Imob Exemplo Ltda", documento: "11.222.333/0001-81", creci: "J-12345", responsavel: "Paula", cargo: "Gerente", email: "P@I.com", telefone: "(19) 3222-4455", concordo: true } }));
  assert.equal(r.s, 200); assert.equal(r.j.aceito, true);
  const d = await J(await api(R("GET", "/api/dados"), ctx())); const o = d.j.ofertas.find((x) => x.id === "o7"); const p = d.j.pedidos.find((x) => x.id === TA);
  assert.equal(p.status, "autorizado"); assert.equal(p.aceite.ip, "200.1.2.3"); assert.equal(p.aceite.termo_sha256.length, 64); assert.equal(p.aceite.email, "p@i.com");
  assert.equal(o.autorizacao.status, "aceita"); assert.equal(o.autorizacao.creci, "J-12345"); assert.equal(o.autorizacao.comissao.partes.length, 2); assert.equal(o.iptu_periodo, "anual");
  const e = await J(await api(R("GET", "/api/emissoes"), ctx())); const tipos = e.j.emissoes.map((x) => x.tipo);
  assert.ok(tipos.includes("autorizacao")); assert.ok(tipos.includes("anunciante_dados"));
  // segundo aceite não sobrescreve
  await A("POST", { acao: "responder", campos: {}, aceite: { razao: "Outra", documento: "11.222.333/0001-81", creci: "1234", responsavel: "X", email: "x@y.com", telefone: "19999990000", concordo: true } });
  const d2 = await J(await api(R("GET", "/api/dados"), ctx())); assert.equal(d2.j.pedidos.find((x) => x.id === TA).aceite.razao, "Imob Exemplo Ltda");
});

// NÚCLEO: completude e comissão
const PC = (await import("../shared/core.mjs")).default;
await t("completude: caso PC-0007 (só área e venda)", async () => {
  const c = PC.completude({ tipo: "Galpão", operacao: "Locação / Venda", construida: "1.638", venda: "7.500.000" });
  assert.ok(c.pct < 25); assert.equal(c.ok, false); assert.ok(c.faltam.some((f) => f.campo === "terreno" && /construída ou de terreno/.test(f.pergunta))); assert.ok(c.faltam.some((f) => f.campo === "aluguel"));
});
await t("completude: galpão completo = 100%; IPTU sem periodicidade pede só isso", async () => {
  const full = { tipo: "Galpão", operacao: "Locação", cidade: "Sumaré", regiao: "Anhanguera", construida: "13.000", terreno: "25.000", pe_direito: "12", docas: "10", energia_kva: "500", piso_carga: "6", avcb: "Vigente", aluguel: "266.600", iptu: "9.800", iptu_periodo: "mensal", disponibilidade: "Imediata", documentacao: "Regular" };
  assert.equal(PC.completude(full).pct, 100);
  const c = PC.completude({ ...full, iptu_periodo: "" }); assert.equal(c.ok, false); assert.deepEqual(c.faltam.map((f) => f.campo), ["iptu_periodo"]);
  assert.equal(PC.completude({ tipo: "Área / terreno", operacao: "Venda", cidade: "X", regiao: "Y", terreno: "10.000", zoneamento: "ZUPI", venda: "1.000.000", iptu: "100", iptu_periodo: "anual", disponibilidade: "Imediata", documentacao: "Regular" }).pct, 100);
});
await t("comissão: 3 partes fecha 100%, valores e avisos de CRECI", async () => {
  const c = PC.calcComissao({ base: "venda", valor_base: "7.500.000", pct: "6", partes: [{ papel: "Imobiliária anunciante", pct: 50, nome: "Imob", creci: "J-12345" }, { papel: "Corretor parceiro", pct: 25, nome: "Marcos" }, { papel: "PrimeCorp (indicação)", pct: 25 }] });
  assert.equal(c.total, 450000); assert.deepEqual(c.partes.map((p) => p.valor), [225000, 112500, 112500]); assert.equal(c.ok, true); assert.ok(c.avisos.some((a) => /Marcos.*CRECI/.test(a)));
  const l = PC.calcComissao({ base: "locacao", valor_base: "266.600", alugueis: "1", partes: [{ papel: "Imobiliária anunciante", pct: 60, creci: "123" , nome: "I"}, { papel: "PrimeCorp (indicação)", pct: 30 }] });
  assert.equal(l.ok, false); assert.ok(/90%/.test(l.erros[0]));
  const d2 = PC.calcComissao({ base: "locacao", valor_base: "10.000", alugueis: "1", partes: [{ papel: "Imobiliária anunciante", pct: 33.33, nome: "I", creci: "123" }, { papel: "Corretor parceiro", pct: 33.33, nome: "C", creci: "456" }, { papel: "PrimeCorp (indicação)", pct: 33.34 }] });
  assert.equal(d2.ok, true); assert.equal(d2.partes.reduce((a, p) => a + p.valor, 0), 10000);
});
await t("itens a confirmar sem duplicidade", async () => {
  const d = PC.num({ construida: "1.638", itens: "Confirmar especificações técnicas (pé-direito, docas, carga)\nValidar se área informada é construída ou terreno\nConfirmar se 1.638 m² é área construída ou de terreno\nPé-direito livre a confirmar" });
  const it = PC.itensPDF(d, PC.checks(d, [])); const areas = it.filter((x) => /terreno/i.test(x)); assert.equal(areas.length, 1); assert.equal(it.filter((x) => /p[ée]-direito/i.test(x)).length, 1);
});
await t("PDF do anunciante tem campos editáveis", async () => {
  const { jsPDF } = await import("jspdf");
  const doc = PC.pdfAnunciante(jsPDF, { tipo: "Galpão", operacao: "Venda", construida: "1.638", venda: "7.500.000" }, { modo: "complementacao", codigo: "PC-0007", faltam: PC.completude({ tipo: "Galpão", operacao: "Venda", construida: "1.638", venda: "7.500.000" }).faltam, demanda: 1, link: "https://x/anunciante.html?t=abc", comissao: { base: "venda", pct: 6, partes: [{ papel: "PrimeCorp (indicação)", pct: 100 }] }, termo: "T", termo_versao: "v1" });
  const txt = doc.output(); assert.ok(txt.startsWith("%PDF")); assert.ok((txt.match(/\/FT \/Tx/g) || []).length >= 10);
});
await t("acordo de divisão: 2 e 4 partes, recebedor e texto preenchido", async () => {
  const { jsPDF } = await import("jspdf"); const { ACORDO_PADRAO } = await import("../src/termo.js");
  const c2 = { base: "locacao", valor_base: "48.000", alugueis: "1", partes: [{ papel: "Imobiliária anunciante", pct: 50, nome: "Imob Sul", creci: "J-111" }, { papel: "PrimeCorp (indicação)", pct: 50 }] };
  assert.equal(PC.recebedor(c2).nome, "Imob Sul");
  assert.equal(PC.recebedor({ ...c2, recebe: 1 }).papel, "PrimeCorp (indicação)");
  const v = PC.varsAcordo({ codigo: "PC-0009", titulo: "Galpão X", cliente: "Indústria X", comissao: c2 });
  assert.equal(v.TOTAL, "R$ 48.000,00"); assert.equal(v.QUADRO, "Imob Sul (Imobiliária anunciante): 50%; Rodrigo França Viana · PrimeCorp Brokers (indicação): 50%");
  const { varsPrazos, pendencias, CORRETOR_PADRAO } = await import("../src/termo.js");
  let txt = PC.preencher(ACORDO_PADRAO, v); assert.deepEqual(pendencias(txt).sort(), ["{{CORRETOR}}", "{{FORO}}", "{{PRAZO_NAO_CONTORNO}}", "{{PRAZO_REPASSE}}"]);
  txt = PC.preencher(txt, { ...varsPrazos({ prazo_repasse: "5", prazo_nao_contorno: "12", foro: "Sumaré/SP" }), CORRETOR: CORRETOR_PADRAO });
  assert.deepEqual(pendencias(txt), []); assert.ok(txt.includes("5 (cinco) dias úteis")); assert.ok(txt.includes("12 (doze) meses")); assert.ok(txt.includes("Indústria X"));
  const c4 = { base: "venda", valor_base: "7.500.000", pct: "6", recebe: 0, partes: [{ papel: "Imobiliária anunciante", pct: 40, nome: "Imob", creci: "J-1" }, { papel: "Corretor do anunciante", pct: 10, nome: "Ana", creci: "111" }, { papel: "Corretor parceiro", pct: 25, nome: "Marcos", creci: "222" }, { papel: "PrimeCorp (indicação)", pct: 25 }] };
  for (const c of [c2, c4]) { const doc = PC.pdfAcordo(jsPDF, { codigo: "PC-0009", titulo: "Galpão X", tipo: "Galpão", cliente: "Indústria X", comissao: c, texto: PC.preencher(ACORDO_PADRAO, PC.varsAcordo({ codigo: "PC-0009", titulo: "Galpão X", cliente: "Indústria X", comissao: c })), versao: "v1" });
    const out = doc.output(); assert.ok(out.startsWith("%PDF")); fsx.writeFileSync(`test/out/acordo_${c.partes.length}.pdf`, out, "binary"); }
  const { CLAUSULA_SPLIT, RECIBO_PADRAO, VISITA_PADRAO, MANDATO_PADRAO, reaisExtenso } = await import("../src/termo.js");
  assert.equal(reaisExtenso(112500), "cento e doze mil e quinhentos reais");
  for (const t of [VISITA_PADRAO, MANDATO_PADRAO]) assert.ok(pendencias(PC.preencher(t, { ...varsPrazos({ prazo_cliente: "24", prazo_mandato: "90", prazo_pos_autorizacao: "6", foro: "Sumaré/SP" }), CORRETOR: CORRETOR_PADRAO, OPERACAO: "compra", COMISSAO_VENDA: "6%" })).length === 0);
  const d = PC.pdfDoc(jsPDF, { kicker: "FICHA DE VISITA", titulo: "Ficha de visita", dados: [["Visitante", "Indústria X"], ["Endereço", ""]], texto: PC.preencher(VISITA_PADRAO, { PRAZO_CLIENTE: "24 (vinte e quatro) meses", CORRETOR: CORRETOR_PADRAO }), assinaturas: [{ nome: "Ana", sub: "Visitante" }, { nome: "Rodrigo", sub: "Corretor" }] });
  fsx.writeFileSync("test/out/visita.pdf", d.output(), "binary");
});

/* ===== v4: equipe, permissões, fotos, IA da captação e landing ===== */
const JOS = { email: "comercial@primecorpconsultoria.com.br" }, ADM = { email: "contato@primecorpconsultoria.com.br" };
await t("equipe: sem cadastro, Joselia não acessa", async () => { globalThis.__user = JOS; assert.equal((await api(R("GET", "/api/dados"), ctx())).status, 403); globalThis.__user = ADM; });
await t("equipe: só admin cadastra; corretora acessa com limites", async () => {
  assert.equal((await api(R("PUT", "/api/dados/usuarios/u_jos", { email: "comercial@primecorpconsultoria.com.br", nome: "Joselia Junqueira Viana", creci: "CRECI-SP 300760", telefone: "(19) 99919-4447", papel: "corretor", ativo: true }), ctx())).status, 200);
  globalThis.__user = JOS;
  assert.equal((await api(R("GET", "/api/dados"), ctx())).status, 200);
  const st = await J(await api(R("GET", "/api/status"), ctx())); assert.equal(st.j.papel, "corretor"); assert.equal(st.j.perfil.creci, "CRECI-SP 300760");
  assert.equal((await api(R("PUT", "/api/dados/config/geral", { x: 1 }), ctx())).status, 403);
  assert.equal((await api(R("PUT", "/api/dados/usuarios/u_x", { email: "x@y.com", papel: "admin" }), ctx())).status, 403);
  assert.equal((await api(R("DELETE", "/api/dados/ofertas/o1"), ctx())).status, 403);
  assert.equal((await api(R("GET", "/api/backup"), ctx())).status, 403);
  assert.equal((await api(R("PUT", "/api/dados/ofertas/cap1", { id: "cap1", origem: "Captação própria", status: "captacao", tipo: "Casa", captador: JOS.email }), ctx())).status, 200);
  globalThis.__user = ADM;
  await api(R("PUT", "/api/dados/ofertas/cap1", { id: "cap1", origem: "Captação própria", status: "captacao", tipo: "Casa", captador: JOS.email, cidade: "Sumaré" }), ctx());
  const d = await J(await api(R("GET", "/api/dados"), ctx())); const o = d.j.ofertas.find((x) => x.id === "cap1");
  assert.equal(o.criado_por, JOS.email); assert.equal(o.atualizado_por, ADM.email);
  await api(R("PUT", "/api/dados/usuarios/u_jos", { email: "comercial@primecorpconsultoria.com.br", nome: "Joselia", papel: "corretor", ativo: false }), ctx());
  globalThis.__user = JOS; assert.equal((await api(R("GET", "/api/dados"), ctx())).status, 403); globalThis.__user = ADM;
  await api(R("PUT", "/api/dados/usuarios/u_jos", { email: "comercial@primecorpconsultoria.com.br", nome: "Joselia Junqueira Viana", creci: "CRECI-SP 300760", telefone: "(19) 99919-4447", papel: "corretor", ativo: true }), ctx());
});
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(400, 7), Buffer.from([0xff, 0xd9])]);
let FK;
await t("fotos: valida JPEG, guarda e serve com login", async () => {
  assert.equal((await api(R("POST", "/api/fotos", { oferta: "cap1", jpeg_base64: Buffer.from("%PDF-1.4 xxxxx".repeat(30)).toString("base64") }), ctx())).status, 400);
  const r = await J(await api(R("POST", "/api/fotos", { oferta: "cap1", jpeg_base64: JPG.toString("base64") }), ctx())); assert.equal(r.s, 200); FK = r.j.k; assert.match(FK, /^fotos\/cap1\/.+\.jpg$/);
  const g = await api(R("GET", "/api/foto?k=" + encodeURIComponent(FK)), ctx()); assert.equal(g.headers.get("content-type"), "image/jpeg"); assert.equal(Buffer.from(await g.arrayBuffer()).length, JPG.length);
  assert.equal((await api(R("GET", "/api/foto?k=../x"), ctx())).status, 400);
  globalThis.__user = null; assert.equal((await api(R("GET", "/api/foto?k=" + encodeURIComponent(FK)), ctx())).status, 401); globalThis.__user = ADM;
});
await t("IA: ambiente com foto e fala; anúncio", async () => {
  const r = await J(await api(R("POST", "/api/ia/ambiente", { imagens: [JPG.toString("base64")], fala: "suíte com armário, casa tem 3 dormitórios e 2 vagas", tipo: "Casa" }), ctx()));
  assert.equal(r.s, 200); assert.equal(r.j.ambiente, "Suíte"); assert.equal(r.j.dados.dormitorios, 3);
  assert.equal(globalThis.__iaReq.messages[0].content.filter((c) => c.type === "image").length, 1);
  assert.equal((await api(R("POST", "/api/ia/ambiente", { imagens: [], fala: "" }), ctx())).status, 400);
  const a = await J(await api(R("POST", "/api/ia/anuncio", { ficha: { tipo: "Casa" }, ambientes: [{ nome: "Suíte" }], fala_geral: "venda 850 mil" }), ctx()));
  assert.equal(a.s, 200); assert.ok(a.j.titulo.length > 10); assert.equal(a.j.dados.venda, 850000);
});
await t("landing pública: só anúncio ativo, sem endereço, com foto e contador", async () => {
  const L = (p) => imovel(new Request("https://pc.test" + p), {});
  assert.equal((await L("/i/tokeninexistente123")).status, 404);
  await api(R("PUT", "/api/dados/ofertas/cap1", { id: "cap1", origem: "Captação própria", tipo: "Casa", endereco: "Rua Secreta, 123", cidade: "Sumaré" }), ctx());
  await api(R("PUT", "/api/dados/anuncios/TOKENLANDING1234567", { oferta: "cap1", status: "ativo", codigo: "PC-0100", titulo: "Casa com 3 dormitórios em Sumaré", descricao: "Casa ampla.\n\nQuintal.", destaques: ["2 vagas"], fatos: [["Dormitórios", "3"]], valores: [["Venda", "R$ 850.000"]], fotos: [{ k: FK, ambiente: "Fachada" }], ambientes: [{ nome: "Fachada", descricao: "Fachada térrea." }], corretor: { nome: "Joselia Junqueira Viana", creci: "CRECI-SP 300760", whatsapp: "(19) 99919-4447" } }), ctx());
  const h = await L("/i/TOKENLANDING1234567"); const html = await h.text();
  assert.equal(h.status, 200); assert.ok(html.includes("Casa com 3 dormitórios em Sumaré")); assert.ok(html.includes('og:image" content="https://pc.test/i/TOKENLANDING1234567/f/0.jpg"'));
  assert.ok(html.includes("wa.me/5519999194447")); assert.ok(!html.includes("Rua Secreta")); assert.ok(html.includes("CRECI-SP 300760"));
  const f = await L("/i/TOKENLANDING1234567/f/0.jpg"); assert.equal(f.headers.get("content-type"), "image/jpeg");
  assert.equal((await L("/i/TOKENLANDING1234567/f/5.jpg")).status, 404);
  await L("/i/TOKENLANDING1234567"); const d = await J(await api(R("GET", "/api/dados"), ctx())); assert.equal(d.j.anuncios.find((x) => x.id === "TOKENLANDING1234567").visitas, 2);
  await api(R("PUT", "/api/dados/anuncios/TOKENLANDING1234567", { ...d.j.anuncios[0], status: "encerrado" }), ctx());
  assert.equal((await L("/i/TOKENLANDING1234567")).status, 404);
});
await t("residencial: completude, título e ficha PDF", async () => {
  const c = PC.completude({ tipo: "Casa", operacao: "Venda", cidade: "Sumaré", regiao: "Jardim X", construida: "140", dormitorios: "3", banheiros: "2", vagas: "2", venda: "850.000", iptu: "2.400", iptu_periodo: "anual", condominio: "0", disponibilidade: "Imediata", documentacao: "Ok" });
  assert.equal(c.ok, true); assert.equal(c.grupo, "residencial");
  assert.equal(PC.checks(PC.num({ tipo: "Casa", aluguel: "3000", construida: "100" }), []).sem, "verde");
  const { jsPDF } = await import("jspdf"); const doc = PC.pdf(jsPDF, { ...PC.num({ tipo: "Casa", cidade: "Sumaré", dormitorios: "3", suites: "1", vagas: "2", construida: "140", venda: "850000" }), corretor: { nome: "Joselia Junqueira Viana", creci: "CRECI-SP 300760", email: "comercial@primecorpconsultoria.com.br" } }, { alerts: [], sem: "verde" }, null);
  fsx.writeFileSync("test/out/ficha_casa.pdf", doc.output(), "binary");
});

await t("rural: grupo, completude, título, checks, ficha e teaser sem endereço", async () => {
  assert.equal(PC.grupo("Fazenda"), "rural"); assert.equal(PC.grupo("Sítio"), "rural"); assert.equal(PC.grupo("Chácara"), "rural"); assert.equal(PC.grupo("Casa"), "residencial"); assert.equal(PC.grupo("Galpão"), "galpao");
  const base = { tipo: "Fazenda", operacao: "Venda", cidade: "Itapetininga", regiao: "Sudoeste paulista", area_ha: "48,4", aptidao: "Pecuária e grãos", agua: "Rio e 2 represas", benfeitorias: "Sede, curral, barracão", venda: "6.200.000", car: "SP-123", ccir: "Sim", documentacao: "Matrícula ok", disponibilidade: "Imediata", endereco: "Estrada X km 9" };
  const c = PC.completude(base); assert.equal(c.ok, true, JSON.stringify(c.faltam)); assert.equal(c.grupo, "rural");
  const o = PC.num(base); assert.equal(PC.areaOf(o), 484000);
  assert.match(PC.autoTitle(o), /Fazenda de 48,4 ha em Itapetininga/);
  const sem = PC.checks(PC.num({ ...base, car: "", area_ha: "150" }), []); assert.ok(sem.alerts.some((a) => /CAR/.test(a.msg)), JSON.stringify(sem.alerts)); assert.ok(sem.alerts.some((a) => /georref/i.test(a.msg)));
  const jose = { nome: "Joselia Junqueira Viana", creci: "CRECI-SP 300760", whatsapp: "(19) 99919-4447" };
  const tz = PC.teaser(base, { sem: "verde", alerts: [] }, "PC-0099", jose);
  assert.ok(!/Estrada X/.test(tz), "teaser não pode ter endereço"); assert.match(tz, /ha/); assert.match(tz, /Joselia/); assert.ok(!/RODRIGO|Rodrigo/.test(tz));
  const { jsPDF } = await import("jspdf"); const doc = PC.pdf(jsPDF, { ...o, codigo: "PC-0099", corretor: jose }, PC.checks(o, []), null);
  const txt = doc.output(); assert.ok(txt.length > 3000); fsx.writeFileSync("test/out/ficha_fazenda.pdf", txt, "binary");
  const lote = PC.num({ tipo: "Terreno", cidade: "Cotia", terreno: "1.200", venda: "900.000" }); assert.match(PC.autoTitle(lote), /Terreno de 1\.200 m² em Cotia/);
});
await t("cruzamento: briefing residencial e rural", async () => {
  const casa = { tipo: "Casa", operacao: "Locação", cidade: "Sumaré", dormitorios: "3", suites: "1", vagas: "2", aluguel: "4.200", construida: "140" };
  assert.ok(PC.score(casa, { tipo: "Casa", operacao: "Locação", dormMin: "3", vagasMin: "2", aluguelMax: "4.500" }).score >= 80);
  assert.match(PC.score(casa, { tipo: "Casa", operacao: "Locação", dormMin: "4" }).fora, /dormit/);
  assert.match(PC.score(casa, { tipo: "Casa", operacao: "Locação", aluguelMax: "3.000" }).fora, /orçamento/);
  const faz = { tipo: "Fazenda", operacao: "Venda", area_ha: "48", venda: "6.000.000" };
  assert.ok(PC.score(faz, { tipo: "Fazenda", operacao: "Venda", haMin: "40", haMax: "60" }).score >= 80);
  assert.match(PC.score(faz, { tipo: "Fazenda", operacao: "Venda", haMin: "100" }).fora, /abaixo do mínimo/);
});
await t("ler pelo link: bloqueia rede interna e lê página pública", async () => {
  for (const u of ["http://localhost/x", "http://127.0.0.1/x", "http://10.0.0.5/a", "http://169.254.169.254/latest", "http://192.168.0.1/", "file:///etc/passwd", "http://user:pw@200.1.1.1/", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://0.0.0.0/", "http://x.localhost/"]) {
    const r = await J(await api(R("POST", "/api/extrair", { modo: "um", texto: "", url: u }), ctx())); assert.equal(r.s, 422, u); assert.match(r.j.erro, /cole aqui/);
  }
  const orig = globalThis.fetch; let pedido;
  globalThis.fetch = async (u, o) => { pedido = String(u); return new Response(`<html><head><title>Casa 3 dorm Sumaré</title><meta property="og:description" content="Casa com 3 dormitórios, 2 vagas, R$ 850 mil"><script type="application/ld+json">{"@type":"House","numberOfRooms":3}</script><script>var lixo=1</script></head><body><h1>Casa à venda</h1><p>${"Ótima casa em bairro tranquilo. ".repeat(12)}</p></body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } }); };
  try {
    const r = await J(await api(R("POST", "/api/extrair", { modo: "um", texto: "", url: "https://93.184.215.14/anuncio/1" }), ctx()));
    assert.equal(r.s, 200, JSON.stringify(r.j)); assert.equal(r.j._lido_pelo_link, true); assert.match(pedido, /93\.184/);
    const m0 = globalThis.__iaReq.messages[0].content; const ultimo = typeof m0 === "string" ? m0 : m0.map((x) => x.text || "").join(""); { assert.match(ultimo, /3 dormitórios/); assert.match(ultimo, /numberOfRooms/); assert.ok(!/lixo/.test(ultimo)); }
    globalThis.fetch = async () => new Response("", { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } });
    const rd = await J(await api(R("POST", "/api/extrair", { modo: "um", url: "https://93.184.215.14/r" }), ctx())); assert.equal(rd.s, 422); assert.match(rd.j.erro, /não permitido/);
    globalThis.fetch = async () => new Response("<html>Access denied</html>", { status: 403, headers: { "content-type": "text/html" } });
    const b = await J(await api(R("POST", "/api/extrair", { modo: "um", url: "https://93.184.215.14/x" }), ctx())); assert.equal(b.s, 422); assert.match(b.j.erro, /recusou/);
    globalThis.fetch = async () => new Response("<html><body>" + "Verifique que você é humano captcha ".repeat(20) + "</body></html>", { headers: { "content-type": "text/html" } });
    const c = await J(await api(R("POST", "/api/extrair", { modo: "um", url: "https://93.184.215.14/y" }), ctx())); assert.equal(c.s, 422); assert.match(c.j.erro, /bloqueou/);
  } finally { globalThis.fetch = orig; }
  const tx = await J(await api(R("POST", "/api/extrair", { modo: "um", texto: "x".repeat(60), url: "http://localhost/" }), ctx())); assert.equal(tx.s, 200, "com texto colado o link não é lido");
});
console.log(`\n${ok} testes OK`);
await db.stop(); process.exit(0);
