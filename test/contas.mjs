// Contas Propto: cadastro, isolamento entre contas, limites, assinatura (Asaas simulado), webhook, anúncio público e rotina diária.
import { NetlifyDB } from "@netlify/database-dev";
import assert from "node:assert/strict";
const db = new NetlifyDB(); process.env.NETLIFY_DB_URL = await db.start(); await db.applyMigrations("./netlify/database/migrations");
process.env.COLETA_SEGREDO = "s".repeat(40);
const api = (await import("./out/api.mjs")).default;
const cad = (await import("./out/propto-cadastro.mjs")).default;
const wh = (await import("./out/asaas-webhook.mjs")).default;
const imovel = (await import("./out/imovel.mjs")).default;
const diario = (await import("./out/contas-diario.mjs")).default;
const ctx = (ip = "200.1.2.3") => ({ params: {}, ip, site: { url: "https://pc.test" } });
const R = (m, p, body, h = {}) => new Request("https://pc.test" + p, { method: m, headers: { "content-type": "application/json", origin: "https://pc.test", ...h }, body: body ? JSON.stringify(body) : undefined });
const J = async (r) => ({ s: r.status, j: await r.json().catch(() => null) });
const como = (email) => { globalThis.__user = { email }; };
let ok = 0; const t = async (n, f) => { await f(); ok++; console.log("✓", n); };
const sql = async (q) => { const { getDatabase } = await import("@netlify/database"); return getDatabase().sql([q]); };

// Asaas simulado
const asaasLog = [];
globalThis.__fetchAsaas = async (url, o) => {
  const u = String(url); asaasLog.push({ u, m: o.method, b: o.body ? JSON.parse(o.body) : null, h: o.headers });
  const r = (j, s = 200) => new Response(JSON.stringify(j), { status: s, headers: { "content-type": "application/json" } });
  if (u.endsWith("/customers")) return r({ id: "cus_000001" });
  if (u.endsWith("/subscriptions") && o.method === "POST") return r({ id: "sub_000001" });
  if (/\/subscriptions\/sub_000001\/payments/.test(u)) { const sub = asaasLog.find((x) => x.u.endsWith("/subscriptions")); return r({ data: [{ id: "pay_1", status: "PENDING", dueDate: sub.b.nextDueDate, value: sub.b.value, invoiceUrl: "https://sandbox.asaas.com/i/pay_1" }] }); }
  if (/\/subscriptions\/sub_/.test(u)) return r({ ok: true });
  return r({ errors: [{ description: "rota simulada inexistente" }] }, 404);
};

const novoCad = (x = {}) => ({ tipo: "imobiliaria", nome: "Ana Souza", email: "ana@imobx.com.br", fone: "(19) 98888-7777", senha: "senhaForte1", creci: "12345-J", empresa: "Imobiliária X", municipio: "Campinas", sistema: "Kenlo", consentimento: true, termos: true, ...x });

await t("cadastro: validações", async () => {
  assert.equal((await J(await cad(R("POST", "/propto/cadastro", novoCad({ senha: "curta" })), ctx()))).s, 400);
  assert.equal((await J(await cad(R("POST", "/propto/cadastro", novoCad({ termos: false })), ctx()))).s, 400);
  assert.equal((await J(await cad(R("POST", "/propto/cadastro", novoCad({ creci: "" })), ctx()))).s, 400);
  assert.equal((await J(await cad(R("POST", "/propto/cadastro", novoCad(), { origin: "https://evil.com" }), ctx()))).s, 403);
  const hp = await J(await cad(R("POST", "/propto/cadastro", novoCad({ hp: "robo" })), ctx())); assert.equal(hp.s, 200); assert.equal(hp.j.conta, undefined);
});
let A, B;
await t("cadastro: cria conta de 30 dias e acesso no Identity", async () => {
  const r = await J(await cad(R("POST", "/propto/cadastro", novoCad()), ctx())); assert.equal(r.s, 200); A = r.j.conta; assert.match(A, /^ct_[a-f0-9]{12}$/);
  assert.equal(globalThis.__usuariosCriados["ana@imobx.com.br"], "senhaForte1");
  const dias = (Date.parse(r.j.teste_fim) - Date.now()) / 864e5; assert.ok(dias > 29.9 && dias <= 30);
  const d = await J(await cad(R("POST", "/propto/cadastro", novoCad()), ctx())); assert.equal(d.s, 409); assert.equal(d.j.entrar, true);
  const pc = await J(await cad(R("POST", "/propto/cadastro", novoCad({ email: "contato@primecorpconsultoria.com.br" })), ctx())); assert.equal(pc.s, 409);
  const rb = await J(await cad(R("POST", "/propto/cadastro", novoCad({ tipo: "corretor", nome: "Bruno Lima", email: "bruno@gmail.com", empresa: "" })), ctx())); assert.equal(rb.s, 200); B = rb.j.conta;
});
await t("cadastro: limite de 3 contas por conexão/hora", async () => {
  await cad(R("POST", "/propto/cadastro", novoCad({ email: "c3@x.com" })), ctx("9.9.9.9")); await cad(R("POST", "/propto/cadastro", novoCad({ email: "c4@x.com" })), ctx("9.9.9.9")); await cad(R("POST", "/propto/cadastro", novoCad({ email: "c5@x.com" })), ctx("9.9.9.9"));
  assert.equal((await cad(R("POST", "/propto/cadastro", novoCad({ email: "c6@x.com" })), ctx("9.9.9.9"))).status, 429);
});
await t("cliente nunca vira admin da PrimeCorp (ADMIN_EMAILS vazio)", async () => {
  delete process.env.ADMIN_EMAILS; como("ana@imobx.com.br");
  const s = await J(await api(R("GET", "/api/status"), ctx())); assert.equal(s.j.conta.id, A); assert.equal(s.j.papel, "admin"); assert.equal(s.j.conta.situacao.codigo, "teste");
  for (const p of ["/api/backup", "/api/contas", "/api/b2g/importar"]) assert.equal((await api(R(p.includes("importar") ? "POST" : "GET", p, p.includes("importar") ? {} : undefined), ctx())).status, 403, p);
  globalThis.__user = { email: "orfao@x.com", roles: ["propto_cliente"] }; assert.equal((await api(R("GET", "/api/dados"), ctx())).status, 403);
  process.env.ADMIN_EMAILS = "contato@primecorpconsultoria.com.br";
});
await t("dados separados: PrimeCorp e contas não se enxergam", async () => {
  como("contato@primecorpconsultoria.com.br"); await api(R("PUT", "/api/dados/ofertas/pc1", { titulo: "Galpão PrimeCorp" }), ctx());
  como("ana@imobx.com.br"); assert.equal((await J(await api(R("PUT", "/api/dados/ofertas/a1", { titulo: "Casa da Ana", tipo: "Casa" }), ctx()))).s, 200);
  let d = await J(await api(R("GET", "/api/dados"), ctx())); assert.deepEqual(d.j.ofertas.map((o) => o.id), ["a1"]); assert.equal(d.j.usuarios[0].email, "ana@imobx.com.br");
  como("bruno@gmail.com"); d = await J(await api(R("GET", "/api/dados"), ctx())); assert.equal(d.j.ofertas.length, 0);
  assert.equal((await api(R("PUT", "/api/dados/ofertas/a1", { titulo: "invasão" }), ctx())).status, 200); // grava na conta dele, não na da Ana
  como("ana@imobx.com.br"); d = await J(await api(R("GET", "/api/dados"), ctx())); assert.equal(d.j.ofertas[0].titulo, "Casa da Ana");
  como("contato@primecorpconsultoria.com.br"); d = await J(await api(R("GET", "/api/dados"), ctx())); assert.deepEqual(d.j.ofertas.map((o) => o.id), ["pc1"]);
  como("ana@imobx.com.br"); assert.equal((await api(R("PUT", "/api/dados/briefings/b1", { nome: "x" }), ctx())).status, 403);
});
await t("limite do teste: corretor capta 5 imóveis; o 6º pede plano", async () => {
  como("bruno@gmail.com"); // já usou 1 (a1 dele)
  for (let i = 2; i <= 5; i++) assert.equal((await api(R("PUT", "/api/dados/ofertas/b" + i, { titulo: "Imóvel " + i }), ctx())).status, 200);
  const r = await J(await api(R("PUT", "/api/dados/ofertas/b6", { titulo: "Sexto" }), ctx())); assert.equal(r.s, 402); assert.match(r.j.erro, /Limite do teste/);
  assert.equal((await api(R("PUT", "/api/dados/ofertas/b5", { titulo: "Editar o quinto" }), ctx())).status, 200); // editar não conta
  await api(R("DELETE", "/api/dados/ofertas/b5"), ctx()); assert.equal((await api(R("PUT", "/api/dados/ofertas/b5", { titulo: "volta" }), ctx())).status, 200); // excluir e recriar não libera vaga nova
  assert.equal((await api(R("PUT", "/api/dados/ofertas/b7", { titulo: "Sétimo" }), ctx())).status, 402);
});
await t("fotos e arquivos: só de imóveis da própria conta", async () => {
  como("ana@imobx.com.br");
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(400, 1)]).toString("base64");
  const f = await J(await api(R("POST", "/api/fotos", { oferta: "a1", jpeg_base64: jpg }), ctx())); assert.equal(f.s, 200);
  assert.equal((await api(R("GET", "/api/foto?k=" + encodeURIComponent(f.j.k)), ctx())).status, 200);
  como("bruno@gmail.com"); assert.equal((await api(R("GET", "/api/foto?k=" + encodeURIComponent(f.j.k).replace("a1", "zz")), ctx())).status, 400);
  assert.equal((await api(R("POST", "/api/fotos", { oferta: "naoexiste", jpeg_base64: jpg }), ctx())).status, 400);
  como("ana@imobx.com.br");
  const e = await J(await api(R("POST", "/api/emissoes", { tipo: "ficha_pdf", pdf_base64: Buffer.from("%PDF-1.4 x").toString("base64") }), ctx())); assert.equal(e.s, 200); assert.ok(e.j.arquivo.startsWith(`pdf/${A}_`));
  assert.equal((await api(R("GET", "/api/arquivo?k=" + encodeURIComponent(e.j.arquivo)), ctx())).status, 200);
  como("bruno@gmail.com"); assert.equal((await api(R("GET", "/api/arquivo?k=" + encodeURIComponent(e.j.arquivo)), ctx())).status, 400);
  const le = await J(await api(R("GET", "/api/emissoes"), ctx())); assert.ok(le.j.emissoes.every((x) => x.tipo !== "ficha_pdf"));
  como("contato@primecorpconsultoria.com.br"); const lp = await J(await api(R("GET", "/api/emissoes"), ctx())); assert.ok(!lp.j.emissoes.some((x) => x.tipo === "conta_criada" || x.tipo === "ficha_pdf"));
  como("ana@imobx.com.br"); const c1 = await J(await api(R("POST", "/api/codigo"), ctx())); assert.equal(c1.j.codigo, "PT-0001");
});
await t("equipe da imobiliária: 3 usuários no teste", async () => {
  como("ana@imobx.com.br");
  assert.equal((await api(R("POST", "/api/conta/membros", { nome: "Caio Reis", email: "caio@imobx.com.br", creci: "99887-F" }), ctx())).status, 200);
  assert.ok(globalThis.__usuariosCriados["caio@imobx.com.br"]);
  assert.equal((await api(R("POST", "/api/conta/membros", { nome: "Dora Melo", email: "dora@imobx.com.br" }), ctx())).status, 200);
  const r = await J(await api(R("POST", "/api/conta/membros", { nome: "Edu Ramos", email: "edu@imobx.com.br" }), ctx())); assert.equal(r.s, 402);
  assert.equal((await api(R("POST", "/api/conta/membros", { nome: "Bruno", email: "bruno@gmail.com" }), ctx())).status, 402);
  como("caio@imobx.com.br"); let d = await J(await api(R("GET", "/api/dados"), ctx())); assert.equal(d.j.ofertas[0].id, "a1"); // vê a carteira da imobiliária
  assert.equal((await api(R("POST", "/api/conta/membros", { nome: "X Y", email: "xy@x.com" }), ctx())).status, 403);
  assert.equal((await api(R("DELETE", "/api/dados/ofertas/a1"), ctx())).status, 403);
  como("ana@imobx.com.br"); await api(R("PUT", "/api/conta/membros/" + encodeURIComponent("caio@imobx.com.br"), { ativo: false }), ctx());
  como("caio@imobx.com.br"); assert.equal((await api(R("GET", "/api/dados"), ctx())).status, 403);
  como("ana@imobx.com.br"); assert.equal((await api(R("PUT", "/api/conta/membros/" + encodeURIComponent("ana@imobx.com.br"), { ativo: false }), ctx())).status, 400);
});
await t("anúncio público do cliente: marca e contato do cliente, nunca PrimeCorp", async () => {
  como("ana@imobx.com.br"); const tok = "TokAnaAnuncio1234567890";
  await api(R("PUT", "/api/dados/anuncios/" + tok, { status: "ativo", titulo: "Casa com 3 dormitórios", oferta: "a1", corretor: { nome: "Ana Souza", creci: "CRECI 12345-J", whatsapp: "(19) 98888-7777" }, fotos: [] }), ctx());
  como("bruno@gmail.com"); assert.equal((await api(R("PUT", "/api/dados/anuncios/" + tok, { status: "ativo", titulo: "Sequestro do link" }), ctx())).status, 409); como("ana@imobx.com.br");
  const r = await imovel(new Request("https://pc.test/i/" + tok), ctx()); assert.equal(r.status, 200); const h = await r.text();
  assert.ok(h.includes("Ana Souza") && h.includes("Imobiliária X")); assert.ok(!/PrimeCorp/i.test(h)); assert.ok(h.includes("wa.me/5519988887777"));
});
await t("assinatura: plano Imobiliária com desconto de fundador e 1º vencimento no fim do teste", async () => {
  como("ana@imobx.com.br");
  let r = await J(await api(R("POST", "/api/conta/assinar", { plano: "imobiliaria", ciclo: "mensal", documento: "11.222.333/0001-81" }), ctx())); assert.equal(r.s, 503); // sem chave
  process.env.ASAAS_API_KEY = "$aact_teste";
  r = await J(await api(R("POST", "/api/conta/assinar", { plano: "imobiliaria", ciclo: "mensal", documento: "11.111.111/1111-11" }), ctx())); assert.equal(r.s, 400);
  r = await J(await api(R("POST", "/api/conta/assinar", { plano: "imobiliaria", ciclo: "mensal", documento: "11.222.333/0001-81" }), ctx())); assert.equal(r.s, 200, JSON.stringify(r.j));
  assert.equal(r.j.valor, 294); assert.equal(r.j.fundador, true); assert.equal(r.j.fatura.link, "https://sandbox.asaas.com/i/pay_1");
  const sub = asaasLog.find((x) => x.u.endsWith("/subscriptions")); assert.equal(sub.b.billingType, "UNDEFINED"); assert.equal(sub.b.cycle, "MONTHLY"); assert.equal(sub.b.externalReference, A);
  assert.ok(sub.u.startsWith("https://api-sandbox.asaas.com/v3")); assert.equal(sub.h.access_token, "$aact_teste");
  const s = await J(await api(R("GET", "/api/status"), ctx())); assert.equal(s.j.conta.situacao.codigo, "teste"); assert.equal(s.j.conta.assinatura, true); assert.equal(s.j.conta.limites.fonte, "teste");
  assert.equal(sub.b.nextDueDate, s.j.conta.teste_fim.slice(0, 10));
});
await t("webhook Asaas: token, pagamento libera o plano, idempotente", async () => {
  process.env.ASAAS_WEBHOOK_TOKEN = "w".repeat(40);
  const ev = (id, event, extra = {}) => new Request("https://pc.test/asaas/webhook", { method: "POST", headers: { "content-type": "application/json", "asaas-access-token": "w".repeat(40) }, body: JSON.stringify({ id, event, payment: { id: "pay_1", subscription: "sub_000001", customer: "cus_000001", value: 294, dueDate: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10), billingType: "PIX", status: "RECEIVED", invoiceUrl: "https://sandbox.asaas.com/i/pay_1", ...extra } }) });
  assert.equal((await wh(new Request("https://pc.test/asaas/webhook", { method: "POST", headers: { "asaas-access-token": "errado" }, body: "{}" }))).status, 401);
  assert.equal((await wh(ev("evt_1", "PAYMENT_RECEIVED"))).status, 200);
  assert.equal((await wh(ev("evt_1", "PAYMENT_RECEIVED"))).status, 200);
  como("ana@imobx.com.br"); const s = await J(await api(R("GET", "/api/status"), ctx()));
  assert.equal(s.j.conta.situacao.codigo, "ativa"); assert.equal(s.j.conta.limites.fonte, "plano"); assert.equal(s.j.conta.limites.usuarios, 5);
  const pagos = await sql(`SELECT COUNT(*)::int AS n FROM cobranca_eventos WHERE conta = '${A}'`); assert.equal(pagos[0].n, 1);
  assert.equal((await api(R("POST", "/api/conta/membros", { nome: "Edu Ramos", email: "edu@imobx.com.br" }), ctx())).status, 200); // agora cabe (plano de 5)
  await wh(ev("evt_2", "PAYMENT_REFUNDED")); const s2 = await J(await api(R("GET", "/api/status"), ctx())); assert.notEqual(s2.j.conta.situacao.codigo, "ativa");
  await wh(ev("evt_3", "PAYMENT_RECEIVED"));
});
await t("situação: fim do teste, carência, só consulta e suspensão", async () => {
  const set = (id, q) => sql(`UPDATE contas SET dados = dados || '${JSON.stringify(q)}'::jsonb WHERE id = '${id}'`);
  await set(B, { teste_fim: new Date(Date.now() - 864e5).toISOString() });
  como("bruno@gmail.com"); let s = await J(await api(R("GET", "/api/status"), ctx())); assert.equal(s.j.conta.situacao.codigo, "expirada");
  assert.equal((await J(await api(R("PUT", "/api/dados/ofertas/b2", { titulo: "x" }), ctx()))).s, 402);
  assert.equal((await api(R("GET", "/api/dados"), ctx())).status, 200); // consulta continua
  await set(A, { pago_ate: new Date(Date.now() - 5 * 864e5).toISOString(), teste_fim: new Date(Date.now() - 40 * 864e5).toISOString() });
  como("ana@imobx.com.br"); s = await J(await api(R("GET", "/api/status"), ctx())); assert.equal(s.j.conta.situacao.codigo, "atrasada"); assert.equal(s.j.conta.situacao.escrita, false);
  let r = await imovel(new Request("https://pc.test/i/TokAnaAnuncio1234567890"), ctx()); assert.equal(r.status, 200);
  await set(A, { pago_ate: new Date(Date.now() - 20 * 864e5).toISOString() });
  r = await imovel(new Request("https://pc.test/i/TokAnaAnuncio1234567890"), ctx()); assert.equal(r.status, 404);
  await set(A, { pago_ate: new Date(Date.now() + 20 * 864e5).toISOString() });
});
await t("administração PrimeCorp: lista, prorroga e registra pagamento manual", async () => {
  como("contato@primecorpconsultoria.com.br");
  const l = await J(await api(R("GET", "/api/contas"), ctx())); assert.ok(l.j.contas.length >= 2); const b = l.j.contas.find((c) => c.id === B); assert.equal(b.situacao.codigo, "expirada");
  const p = await J(await api(R("POST", "/api/contas/" + B, { acao: "prorrogar", dias: 7 }), ctx())); assert.equal(p.j.situacao.codigo, "teste");
  const m = await J(await api(R("POST", "/api/contas/" + B, { acao: "pago_manual", plano: "corretor", meses: 1 }), ctx())); assert.equal(m.j.situacao.codigo, "ativa");
  como("joselia@x.com"); assert.equal((await api(R("GET", "/api/contas"), ctx())).status, 403);
});
await t("rotina diária: aviso 5 dias antes, uma vez só", async () => {
  await sql(`UPDATE contas SET dados = dados || '{"teste_fim":"${new Date(Date.now() + 4.5 * 864e5).toISOString()}"}'::jsonb WHERE dados->'membros' @> '[{"email":"c3@x.com"}]'::jsonb`);
  await diario(); await diario();
  const e = await sql(`SELECT conteudo FROM emissoes WHERE tipo = 'contas_rotina'`); assert.equal(e.length, 1); assert.match(e[0].conteudo, /D-5/);
});
await t("cancelamento pelo cliente", async () => {
  como("ana@imobx.com.br");
  assert.equal((await api(R("POST", "/api/conta/cancelar", {}), ctx())).status, 400);
  assert.equal((await api(R("POST", "/api/conta/cancelar", { confirmacao: "CANCELAR" }), ctx())).status, 200);
  assert.ok(asaasLog.some((x) => x.m === "DELETE" && x.u.includes("/subscriptions/sub_000001")));
  const s = await J(await api(R("GET", "/api/status"), ctx())); assert.equal(s.j.conta.situacao.codigo, "ativa"); // até o fim do período pago
  const ex = await api(R("GET", "/api/conta/exportar"), ctx()); assert.equal(ex.status, 200); const j = await ex.json(); assert.ok(j.registros.some((r) => r.id === "a1"));
});
await t("e-mail de boas-vindas e de novo membro: links, sem senha, falha não derruba o cadastro", async () => {
  const enviados = []; globalThis.__fetchEmail = async (u, o) => { enviados.push({ u, b: JSON.parse(o.body), h: o.headers }); return new Response(JSON.stringify({ id: "em_" + enviados.length }), { status: 200 }); };
  const sem = await J(await cad(R("POST", "/propto/cadastro", novoCad({ email: "semchave@x.com", nome: "Sem Chave" })), ctx("7.7.7.1"))); assert.equal(sem.s, 200); assert.equal(enviados.length, 0); // sem RESEND_API_KEY: não envia, cadastro ok
  process.env.RESEND_API_KEY = "re_teste"; process.env.PROPTO_SITE = "https://propto.com.br";
  const r = await J(await cad(R("POST", "/propto/cadastro", novoCad({ email: "lia@imobz.com", nome: "Lia Prado", senha: "Segredo2026x", empresa: "Imob Z" })), ctx("7.7.7.2"))); assert.equal(r.s, 200);
  const e = enviados[0]; assert.equal(e.u, "https://api.resend.com/emails"); assert.deepEqual(e.b.to, ["lia@imobz.com"]); assert.equal(e.h.authorization, "Bearer re_teste");
  assert.ok(e.b.html.includes("https://propto.com.br/app") && e.b.text.includes("https://propto.com.br/app")); assert.ok(/Adicionar à Tela de Início/.test(e.b.html));
  assert.ok(!JSON.stringify(e.b).includes("Segredo2026x"), "nunca leva a senha");
  const em = await sql(`SELECT 1 FROM emissoes WHERE tipo = 'email_boas_vindas' AND conta = '${r.j.conta}'`); assert.equal(em.length, 1);
  como("lia@imobz.com"); assert.equal((await api(R("POST", "/api/conta/membros", { nome: "Rui Costa", email: "rui@imobz.com" }), ctx())).status, 200);
  const m = enviados[1]; assert.deepEqual(m.b.to, ["rui@imobz.com"]); assert.match(m.b.subject, /Imob Z/); assert.ok(!JSON.stringify(m.b).includes(globalThis.__usuariosCriados["rui@imobz.com"]), "senha provisória nunca vai no e-mail");
  globalThis.__fetchEmail = async () => new Response("{}", { status: 500 });
  assert.equal((await J(await cad(R("POST", "/propto/cadastro", novoCad({ email: "falha@x.com", nome: "Fa Lha" })), ctx("7.7.7.3")))).s, 200); // Resend fora: cadastro segue
  delete process.env.RESEND_API_KEY;
});
console.log(`\n${ok} testes de contas Propto OK`);
await db.stop?.(); process.exit(0);
