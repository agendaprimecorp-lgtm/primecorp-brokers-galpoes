import { NetlifyDB } from "@netlify/database-dev";
import assert from "node:assert/strict";
const db = new NetlifyDB(); const cs = await db.start(); await db.applyMigrations("./netlify/database/migrations");
process.env.NETLIFY_DB_URL = cs;
const api = (await import("./out/api.mjs")).default;
const sala = (await import("./out/sala.mjs")).default;
const backup = (await import("./out/backup-diario.mjs")).default;
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
console.log(`\n${ok} testes OK`);
await db.stop(); process.exit(0);
