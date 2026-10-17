// Testes: verificação do imóvel (varredura, matrícula) e Zoe (webhook, cérebro, agenda, transbordo).
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { NetlifyDB } from "@netlify/database-dev";
const db = new NetlifyDB(); const cs = await db.start(); await db.applyMigrations("./netlify/database/migrations");
process.env.NETLIFY_DB_URL = cs;
process.env.ADMIN_EMAILS = "contato@primecorpconsultoria.com.br";
process.env.COLETA_SEGREDO = "s".repeat(40);
Object.assign(process.env, { WHATSAPP_APP_SECRET: "segredo-app", WHATSAPP_VERIFY_TOKEN: "tok-verif", WHATSAPP_TOKEN: "tk", WHATSAPP_PHONE_ID: "999", ZOE_EQUIPE: "19998051985" });
globalThis.__user = { email: "contato@primecorpconsultoria.com.br" };
globalThis.__aberto = true; // expediente aberto nos testes (o teste de expediente controla isso)
const api = (await import("./out/api.mjs")).default;
const wh = (await import("./out/whatsapp.mjs")).default;
const zbg = (await import("./out/zoe-background.mjs")).default;
const mbg = (await import("./out/matricula-background.mjs")).default;
const V = (await import("../shared/verif.mjs")).default;
const Z = await import("../shared/zoe.mjs");
const ctx = () => ({ params: {}, ip: "200.1.2.3", site: { url: "https://pc.test" } });
const R = (m, p, body, h = {}) => new Request("https://pc.test" + p, { method: m, headers: { "content-type": "application/json", origin: "https://pc.test", ...h }, body: body ? JSON.stringify(body) : undefined });
const J = async (r) => ({ s: r.status, j: await r.json().catch(() => null) });
let ok = 0; const t = async (n, f) => { await f(); ok++; console.log("✓", n); };
const SEG = { "x-coleta-segredo": "s".repeat(40) };

/* ---------- fontes externas simuladas ---------- */
globalThis.__fetchVerif = async (url) => {
  const u = String(url); const resp = (j, st = 200) => new Response(JSON.stringify(j), { status: st, headers: { "content-type": "application/json" } });
  if (u.includes("/cep/v2/13170000")) return resp({ cep: "13170000", state: "SP", city: "Sumaré", neighborhood: "Centro", street: "Rua Dom Barreto", location: { coordinates: { latitude: "-22.82", longitude: "-47.27" } } });
  if (u.includes("/cep/v2/")) return resp({ message: "não encontrado" }, 404);
  if (u.includes("viacep")) return resp({ erro: true });
  if (u.includes("nominatim")) return resp([{ lat: "-22.8211", lon: "-47.2671", address: { city: "Sumaré", state: "São Paulo" } }]);
  if (u.includes("/cnpj/v1/11222333000181")) return resp({ razao_social: "INDUSTRIA X LTDA", descricao_situacao_cadastral: "ATIVA", municipio: "SUMARE", uf: "SP", qsa: [{ nome_socio: "ANA SOUZA", qualificacao_socio: "Sócio-Administrador" }] });
  return resp({}, 404);
};
const enviados = []; globalThis.__fetchWA = async (url, op) => { enviados.push(JSON.parse(op.body)); return new Response(JSON.stringify({ messages: [{ id: "wamid." + enviados.length }] }), { status: 200 }); };

/* ---------- Verificação ---------- */
await api(R("PUT", "/api/dados/ofertas/o1", { id: "o1", codigo: "PC-0001", tipo: "Galpão", operacao: "Locação", cidade: "Sumaré", uf: "SP", terreno: "10.000", construida: "6.000", status: "revisada", regiao: "Eixo Anhanguera (RMC)", aluguel: "150.000" }), ctx());

await t("verificação: sem dados = cinza e pendências", async () => {
  const a = V.avaliar({ tipo: "Galpão" }); assert.equal(a.nivel, "cinza"); assert.ok(a.pendentes >= 8); assert.equal(a.pct, 0);
});
await t("varredura: CEP, mapa e CNPJ ativo", async () => {
  await api(R("PUT", "/api/dados/ofertas/o1", { id: "o1", codigo: "PC-0001", tipo: "Galpão", operacao: "Locação", cidade: "Sumaré", uf: "SP", terreno: "10.000", construida: "6.000", status: "revisada", regiao: "Eixo Anhanguera (RMC)", aluguel: "150.000", cep: "13170-000", endereco: "R. Dom Barreto", numero: "100", matricula: "45.678", cartorio: "CRI de Sumaré", inscricao: "123.456.789", proprietario: "Indústria X Ltda", proprietario_doc: "11.222.333/0001-81" }), ctx());
  const r = await J(await api(R("POST", "/api/verificar/o1"), ctx())); assert.equal(r.s, 200);
  assert.equal(r.j.verificacao.fontes.cep.cidade, "Sumaré"); assert.equal(r.j.verificacao.fontes.geo.cidade, "Sumaré"); assert.equal(r.j.verificacao.fontes.cnpj.situacao, "ATIVA");
  const it = Object.fromEntries(r.j.avaliacao.itens.map((x) => [x.k, x.st])); assert.equal(it.cep, "ok"); assert.equal(it.prop, "ok"); assert.equal(it.ident, "ok"); assert.equal(it.mat, "pend");
});
await t("varredura: CEP de outra cidade = vermelho", async () => {
  const a = V.avaliar({ tipo: "Casa", cidade: "Campinas", cep: "13170000", verificacao: { fontes: { cep: { cidade: "Sumaré", uf: "SP", logradouro: "Rua A" } } } });
  assert.equal(a.itens.find((x) => x.k === "cep").st, "v"); assert.equal(a.nivel, "vermelho");
});
await t("matrícula: valida arquivo, guarda e lê em segundo plano", async () => {
  assert.equal((await api(R("POST", "/api/matricula/o1", { tipo: "text/plain", base64: "aaa" }), ctx())).status, 400);
  assert.equal((await api(R("POST", "/api/matricula/o1", { tipo: "application/pdf", base64: Buffer.from("x".repeat(900)).toString("base64") }), ctx())).status, 400);
  const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(800, 32)]).toString("base64");
  const r = await J(await api(R("POST", "/api/matricula/o1", { tipo: "application/pdf", base64: pdf }), ctx())); assert.equal(r.s, 200); assert.equal(r.j.status, "lendo"); assert.match(r.j.chave, /^mat\/o1\//);
  globalThis.__matricula = { numero: "45678", cartorio: "Oficial de Registro de Imóveis de Sumaré", data_certidao: new Date(Date.now() - 5 * 864e5).toISOString().slice(0, 10), area_terreno: 10050, construcao_averbada: true, area_construida_averbada: 5900,
    proprietarios: [{ nome: "INDÚSTRIA X LTDA", documento: "11.222.333/0001-81", fracao: "100%" }], onus: [{ ato: "R-7", tipo: "Hipoteca", descricao: "Banco Y", cancelado: true, cancelado_por: "AV-9" }, { ato: "AV-10", tipo: "Penhora", descricao: "Execução fiscal", cancelado: false }], alertas: [] };
  await mbg(new Request("https://pc.test/.netlify/functions/matricula-background", { method: "POST", headers: SEG, body: JSON.stringify({ oferta: "o1", chave: r.j.chave, tipo: "application/pdf", usuario: "x" }) }));
  assert.equal(globalThis.__docs.pop(), "document");
  const d = await J(await api(R("GET", "/api/dados"), ctx())); const o = d.j.ofertas.find((x) => x.id === "o1");
  assert.equal(o.verificacao.leitura.status, "ok"); assert.equal(o.verificacao.matricula.numero, "45678"); assert.ok(o.verificacao.fontes.cep, "varredura anterior preservada");
  const a = V.avaliar(o); const it = Object.fromEntries(a.itens.map((x) => [x.k, x])); assert.equal(it.titular.st, "ok"); assert.equal(it.areas.st, "ok"); assert.equal(it.onus.st, "v"); assert.match(it.onus.msg, /Penhora/); assert.equal(a.nivel, "vermelho");
  const dl = await api(R("GET", "/api/arquivo?k=" + encodeURIComponent(r.j.chave)), ctx()); assert.equal(dl.status, 200); assert.equal((await dl.text()).slice(0, 4), "%PDF");
});
await t("matrícula: tela antiga não apaga a verificação gravada no servidor", async () => {
  await api(R("PUT", "/api/dados/ofertas/o1", { id: "o1", codigo: "PC-0001", tipo: "Galpão", cidade: "Sumaré", verificacao: { varrido_em: "2020-01-01" } }), ctx());
  const d = await J(await api(R("GET", "/api/dados"), ctx())); assert.equal(d.j.ofertas.find((x) => x.id === "o1").verificacao.matricula.numero, "45678");
});
await t("matrícula: ônus cancelado não pesa; sem ônus + certidões = verde", async () => {
  const o = { tipo: "Galpão", cidade: "Sumaré", cep: "13170000", endereco: "Rua Dom Barreto", matricula: "45678", cartorio: "CRI", inscricao: "1", proprietario: "Indústria X Ltda", proprietario_doc: "11222333000181", terreno: "10.000", construida: "6.000",
    certidoes: Object.fromEntries(V.CERTIDOES.map(([k]) => [k, "2026-10-01"])),
    verificacao: { fontes: { cep: { cidade: "Sumaré", uf: "SP", logradouro: "Rua Dom Barreto" }, geo: { lat: -22.8, lon: -47.2, cidade: "Sumaré" }, cnpj: { razao_social: "INDUSTRIA X LTDA", situacao: "ATIVA" } },
      matricula: { numero: "45.678", data_certidao: new Date().toISOString().slice(0, 10), area_terreno: 10000, construcao_averbada: true, area_construida_averbada: 6000, proprietarios: [{ nome: "Indústria X Ltda", documento: "11.222.333/0001-81" }], onus: [{ tipo: "Hipoteca", cancelado: true }] } } };
  const a = V.avaliar(o); assert.equal(a.pct, 100); assert.equal(a.nivel, "verde");
  delete o.certidoes.c_trab; assert.equal(V.avaliar(o).nivel, "amarelo");
});
await t("verificação: rural pede CAR/CCIR/NIRF/SIGEF; links oficiais", async () => {
  const a = V.avaliar({ tipo: "Fazenda", area_ha: "48" }); assert.match(a.itens.find((x) => x.k === "fiscal").msg, /CAR.*CCIR.*NIRF.*SIGEF/);
  const f = V.fontes({ tipo: "Fazenda", uf: "SP" }).map((x) => x.url).join(" "); assert.match(f, /car\.gov\.br/); assert.match(f, /sigef/); assert.match(f, /ridigital/);
});

/* ---------- Agenda ---------- */
await t("agenda: horários livres respeitam expediente, antecedência e ocupação", async () => {
  const agora = new Date("2026-10-05T12:00:00Z"); // segunda 09:00 Brasília
  const hs = Z.horariosLivres({}, [], agora, { dias: 2, max: 50 });
  assert.equal(Z.fmtHora(hs[0]), "segunda, 05/10 às 12:00"); // 3 h de antecedência
  assert.ok(hs.every((d) => { const h = (d.getUTCHours() + 21) % 24; return h >= 9 && h < 18; }));
  const ocupado = [{ inicio: "2026-10-05T12:00:00-03:00", fim: "2026-10-05T13:00:00-03:00", status: "marcado" }];
  assert.equal(Z.fmtHora(Z.horariosLivres({}, ocupado, agora, { dias: 1 })[0]), "segunda, 05/10 às 13:00");
  const sab = Z.horariosLivres({}, [], new Date("2026-10-10T12:00:00Z"), { dias: 0 }); assert.equal(sab.length, 0);
  assert.equal(Z.horariosLivres({ bloqueios: ["2026-10-06"] }, [], new Date("2026-10-05T22:00:00Z"), { dias: 1 }).length, 0);
});

/* ---------- Webhook ---------- */
const assinar = (corpo, seg = "segredo-app") => "sha256=" + crypto.createHmac("sha256", seg).update(corpo).digest("hex");
const payload = (de, texto, id) => JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "999" }, contacts: [{ wa_id: de, profile: { name: "Carlos" } }], messages: [{ from: de, id, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: texto } }] } }] }] });
const W = (corpo, sig) => wh(new Request("https://pc.test/whatsapp/webhook", { method: "POST", headers: { "x-hub-signature-256": sig ?? assinar(corpo), "content-type": "application/json" }, body: corpo }), ctx());

await t("documento: IA identifica IPTU, completa a oferta, cruza áreas e roda a varredura sozinha", async () => {
  await api(R("PUT", "/api/dados/ofertas/o3", { id: "o3", codigo: "PC-0003", tipo: "Galpão", operacao: "Venda", cidade: "Sumaré", uf: "SP", terreno: "10.000", construida: "6.000", venda: "9.000.000", status: "revisada" }), ctx());
  const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(800, 32)]).toString("base64");
  const r = await J(await api(R("POST", "/api/documento/o3", { tipo: "application/pdf", base64: pdf }), ctx())); assert.equal(r.s, 200);
  globalThis.__documento = { doc: "iptu", tipo_documento: "carnê", exercicio: "2026", inscricao: "34.0021.0450.000", contribuinte: "Indústria X Ltda", endereco: "Rua Dom Barreto, 120", cep: "13170-000", area_terreno: 10000, area_construida: 7400, valor_venal_total: 4500000, debitos: true, alertas: [] };
  await mbg(new Request("https://pc.test/.netlify/functions/matricula-background", { method: "POST", headers: SEG, body: JSON.stringify({ oferta: "o3", chave: r.j.chave, tipo: "application/pdf", usuario: "x" }) }));
  const o = (await J(await api(R("GET", "/api/dados"), ctx()))).j.ofertas.find((x) => x.id === "o3");
  assert.equal(o.verificacao.leitura.doc, "iptu"); assert.equal(o.inscricao, "34.0021.0450.000"); assert.equal(o.cep, "13170-000"); assert.equal(o.endereco, "Rua Dom Barreto"); assert.equal(o.numero, "120");
  assert.equal(o.construida, "6.000", "não sobrescreve o que o corretor digitou");
  assert.equal(o.verificacao.fontes.cep.cidade, "Sumaré", "varredura automática após o documento trazer o CEP"); assert.match(o.verificacao.varrido_por, /automático/);
  const it = Object.fromEntries(V.avaliar(o).itens.map((x) => [x.k, x]));
  assert.equal(it.fiscal.st, "a"); assert.match(it.fiscal.msg, /DÉBITOS/); assert.match(it.fiscal.msg, /4\.500\.000/);
  assert.equal(it.areas.st, "a"); assert.match(it.areas.msg, /difere 19% do IPTU/);
  // com matrícula sem construção averbada, o IPTU denuncia a área não averbada
  globalThis.__documento = { doc: "matricula", numero: "999", cartorio: "CRI Sumaré", area_terreno: 10000, construcao_averbada: false, proprietarios: [{ nome: "Indústria X Ltda" }], onus: [] };
  const r2 = await J(await api(R("POST", "/api/documento/o3", { tipo: "application/pdf", base64: pdf }), ctx()));
  await mbg(new Request("https://pc.test/x", { method: "POST", headers: SEG, body: JSON.stringify({ oferta: "o3", chave: r2.j.chave, tipo: "application/pdf", usuario: "x" }) }));
  const o2 = (await J(await api(R("GET", "/api/dados"), ctx()))).j.ofertas.find((x) => x.id === "o3");
  assert.equal(o2.verificacao.matricula.numero, "999"); assert.ok(o2.verificacao.iptu, "IPTU preservado");
  assert.match(Object.fromEntries(V.avaliar(o2).itens.map((x) => [x.k, x])).areas.msg, /prefeitura cadastra 7400 m² construídos que não estão averbados/);
  globalThis.__documento = { doc: "rural", tipo_documento: "recibo do CAR", car: "SP-3552403-ABC", situacao_car: "pendente", area_ha: 60 };
  await api(R("PUT", "/api/dados/ofertas/o4", { id: "o4", codigo: "PC-0004", tipo: "Fazenda", operacao: "Venda", cidade: "Itapetininga", area_ha: "48,4", status: "revisada" }), ctx());
  const r3 = await J(await api(R("POST", "/api/documento/o4", { tipo: "application/pdf", base64: pdf }), ctx()));
  await mbg(new Request("https://pc.test/x", { method: "POST", headers: SEG, body: JSON.stringify({ oferta: "o4", chave: r3.j.chave, tipo: "application/pdf", usuario: "x" }) }));
  const o4 = (await J(await api(R("GET", "/api/dados"), ctx()))).j.ofertas.find((x) => x.id === "o4");
  assert.equal(o4.car, "SP-3552403-ABC"); const f4 = V.avaliar(o4).itens.find((x) => x.k === "fiscal"); assert.equal(f4.st, "a"); assert.match(f4.msg, /CAR com situação "pendente"/); assert.match(f4.msg, /\(60 ha\) difere 19% da oferta/);
  globalThis.__documento = null;
});
await t("Sala do Anunciante: dados documentais e envio de matrícula/IPTU com leitura automática", async () => {
  const anun = (await import("./out/anunciante.mjs")).default;
  const tk = "TOKENANUNCIANTE1234567890";
  await api(R("PUT", "/api/dados/ofertas/o5", { id: "o5", codigo: "PC-0005", tipo: "Galpão", operacao: "Venda", cidade: "Sumaré", uf: "SP", status: "revisada" }), ctx());
  await api(R("PUT", "/api/dados/pedidos/" + tk, { id: tk, oferta: "o5", codigo: "PC-0005", titulo: "Galpão", operacao: "Locação", tipo_termo: "parceria", faltam: [], status: "aberto", expira: new Date(Date.now() + 9e8).toISOString() }), ctx());
  const pc = (m, body) => anun(new Request("https://pc.test/publico/anunciante/" + tk, { method: m, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }), { params: { token: tk }, ip: "200.1.1.1" });
  const g = await J(await pc("GET")); assert.deepEqual(g.j.docs_campos.map((x) => x.campo), ["matricula", "cartorio", "inscricao", "cep"]); assert.equal(g.j.documentos.length, 0);
  assert.equal((await pc("POST", { acao: "responder", docs: { cep: "123" } })).status, 400, "CEP inválido");
  const r = await J(await pc("POST", { acao: "responder", docs: { matricula: "45.678", cep: "13170-000", inexistente: "x" } })); assert.equal(r.s, 200); assert.equal(r.j.docs_campos.find((x) => x.campo === "matricula").resposta, "45.678");
  let o = (await J(await api(R("GET", "/api/dados"), ctx()))).j.ofertas.find((x) => x.id === "o5");
  assert.equal(o.matricula, "45.678"); assert.equal(o.fontes.matricula, "anunciante"); assert.equal(o.inexistente, undefined); assert.equal(o.verificacao.fontes.cep.cidade, "Sumaré", "CEP do anunciante dispara a varredura");
  assert.equal((await pc("POST", { acao: "documento", tipo: "text/html", base64: "PGh0bWw+" })).status, 400);
  assert.equal((await pc("POST", { acao: "documento", tipo: "application/pdf", base64: Buffer.alloc(900, 65).toString("base64") })).status, 400, "não é PDF");
  const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(800, 32)]).toString("base64");
  const d = await J(await pc("POST", { acao: "documento", tipo: "application/pdf", nome: "matricula<script>.pdf", base64: pdf })); assert.equal(d.s, 200); assert.equal(d.j.documentos.length, 1); assert.doesNotMatch(d.j.documentos[0].nome, /[<>]/);
  o = (await J(await api(R("GET", "/api/dados"), ctx()))).j.ofertas.find((x) => x.id === "o5"); assert.equal(o.verificacao.leitura.status, "lendo"); assert.equal(o.verificacao.leitura.origem, "anunciante");
  const ped = (await J(await api(R("GET", "/api/dados"), ctx()))).j.pedidos.find((x) => x.id === tk); assert.match(ped.documentos[0].chave, /^mat\/o5\/an-/);
  globalThis.__documento = { doc: "matricula", numero: "45678", cartorio: "CRI Sumaré", proprietarios: [{ nome: "Fulano" }], onus: [] };
  await mbg(new Request("https://pc.test/x", { method: "POST", headers: SEG, body: JSON.stringify({ oferta: "o5", chave: ped.documentos[0].chave, tipo: "application/pdf", usuario: "anunciante" }) }));
  o = (await J(await api(R("GET", "/api/dados"), ctx()))).j.ofertas.find((x) => x.id === "o5"); assert.equal(o.verificacao.matricula.numero, "45678"); assert.equal(V.avaliar(o).itens.find((x) => x.k === "mat").st, "ok");
  for (let i = 0; i < 5; i++) await pc("POST", { acao: "documento", tipo: "application/pdf", base64: pdf });
  assert.equal((await pc("POST", { acao: "documento", tipo: "application/pdf", base64: pdf })).status, 400, "limite de documentos por pedido");
  globalThis.__documento = null;
});
await t("webhook: verificação GET e assinatura obrigatória", async () => {
  assert.equal(await (await wh(new Request("https://pc.test/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=tok-verif&hub.challenge=42"), ctx())).text(), "42");
  assert.equal((await wh(new Request("https://pc.test/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=errado&hub.challenge=42"), ctx())).status, 403);
  const c = payload("5519911112222", "Oi", "wamid.A1");
  assert.equal((await W(c, assinar(c, "outro"))).status, 401);
  assert.equal((await W(c)).status, 200); assert.equal((await W(c)).status, 200); // repetida
  const d = await J(await api(R("GET", "/api/dados"), ctx())); const cv = d.j.conversas.find((x) => x.id === "5519911112222");
  assert.equal(cv.msgs.length, 1); assert.equal(cv.nome, "Carlos"); assert.equal(cv.equipe, false); assert.equal(cv.ultima_de, "cliente");
});

/* ---------- Zoe (cérebro com ferramentas) ---------- */
const passo = (tool, input) => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu" + Math.random(), name: tool, input }] });
const fala = (txt) => ({ stop_reason: "end_turn", content: [{ type: "text", text: txt }] });
// O canal do cliente atende só a recomposição de receitas (o antigo teste de busca de galpão saiu com o fluxo imobiliário do cliente).
await t("PrimeCorp IA: receitas qualificada registra contato, agenda reunião, chama a equipe e responde com botões", async () => {
  const visto = []; let tools;
  globalThis.__zoe = (req) => { const last = req.messages[req.messages.length - 1];
    if (typeof last.content === "string") { visto.push(req.system); tools = req.tools.map((x) => x.name); return passo("salvar_contato", { nome: "Carlos", empresa: "Prefeitura de Sumaré", cargo: "Secretário de Finanças", cidade: "Sumaré/SP", perfil: "Órgão público", observacoes: "Receitas · origem: convite · análise preliminar" }); }
    const res = JSON.parse(last.content[0].content); visto.push(res);
    if (res.contato) return passo("horarios_livres", { dias_a_frente: 7 });
    if (res.horarios) return passo("agendar", { inicio: res.horarios[0].inicio, tipo: "Reunião (vídeo)", assunto: "Receitas – Prefeitura de Sumaré/SP", nome: "Carlos" });
    if (res.confirmado) return passo("chamar_equipe", { motivo: "Receitas: Prefeitura de Sumaré/SP – Órgão público – Carlos/Secretário de Finanças", urgente: false });
    return fala("Agendado! A equipe técnica dá sequência por aqui.\n[[botoes: Análise de receitas | Indicação | Agendar reunião]]"); };
  await zbg(new Request("https://pc.test/.netlify/functions/zoe-background", { method: "POST", headers: SEG, body: JSON.stringify({ wa: "5519911112222", espera: 0 }) }));
  assert.match(visto[0], /PrimeCorp IA/); assert.match(visto[0], /LGPD/);
  for (const n of ["buscar_imoveis", "registrar_demanda", "registrar_imovel_proprietario"]) assert.ok(!tools.includes(n), n);
  assert.ok(visto.some((x) => x.horarios?.length >= 2)); assert.ok(visto.some((x) => x.confirmado));
  const ult = enviados.filter((m) => m.to === "5519911112222").pop(); assert.ok(ult); assert.equal(ult.type, "interactive"); assert.equal(ult.interactive.action.buttons.length, 3);
  const d = await J(await api(R("GET", "/api/dados"), ctx()));
  const c = d.j.contatos.find((x) => x.telefone === "+5519911112222"); assert.equal(c.empresa, "Prefeitura de Sumaré"); assert.equal(c.tipo, "Órgão público"); assert.match(c.obs, /^Receitas/);
  const ag = d.j.agenda.find((x) => x.wa === "5519911112222"); assert.equal(ag.tipo, "Reunião (vídeo)"); assert.match(ag.assunto, /^Receitas – Prefeitura de Sumaré\/SP/); assert.equal(ag.contato, c.id);
  const cv = d.j.conversas.find((x) => x.id === "5519911112222"); assert.equal(cv.ultima_de, "zoe"); assert.equal(cv.contato, c.id); assert.ok(!cv.processando); assert.match(cv.precisa_humano.motivo, /^Receitas: /);
  assert.ok(!d.j.briefings.some((x) => x.origem === "WhatsApp · Assistente"), "sem briefing de imóvel");
  const e = await J(await api(R("GET", "/api/emissoes"), ctx())); assert.ok(e.j.emissoes.some((x) => x.tipo === "zoe_aviso" && /Agendado pela PrimeCorp IA/.test(x.conteudo)));
  assert.ok(enviados.some((m) => m.to === "5519998051985" && /^🤖 PrimeCorp IA · .*Agendado pela PrimeCorp IA/s.test(m.text?.body || "")), "equipe avisada no WhatsApp");
});
await t("PrimeCorp IA: ferramentas imobiliárias recusadas no modo cliente (e liberadas para a equipe)", async () => {
  const mem = { ofertas: [], anuncios: [], briefings: [], contatos: [] }; const ctxZ = { agora: new Date(), base: "https://pc.test", cfg: { zoe: {}, geral: {} }, listar: (k) => mem[k] || [], salvar: (k, id, d) => { mem[k] = (mem[k] || []).concat({ ...d, id }); }, avisar: () => {} };
  for (const n of ["buscar_imoveis", "registrar_demanda", "registrar_imovel_proprietario"]) { const r = Z.executar(ctxZ, { id: "5519900008888" }, n, { nome: "X", tipo: "Galpão", operacao: "Locação", cidade: "Sumaré" }, false); assert.match(r.erro || "", /99805-1985/, n); }
  assert.equal(mem.briefings.length + mem.ofertas.length + mem.contatos.length, 0, "nada gravado");
  assert.equal(Z.executar(ctxZ, { id: "1" }, "buscar_imoveis", { tipo: "Galpão", operacao: "Locação" }, true).encontrados, 0, "equipe continua buscando");
});
await t("Zoe: agenda só em horário livre e avisa a equipe", async () => {
  const conv = { id: "5519900000001", msgs: [{ de: "cliente", t: new Date().toISOString(), texto: "quero marcar" }] };
  const mem = { agenda: [], contatos: [], ofertas: [], anuncios: [], briefings: [], conversas: [], negocios: [] }; const av = [];
  const c = { agora: new Date("2026-10-05T12:00:00Z"), base: "https://pc.test", cfg: { zoe: {}, geral: {} }, listar: (k) => mem[k] || [], salvar: (k, id, d) => { const l = mem[k]; const i = l.findIndex((x) => x.id === id); if (i >= 0) l[i] = { ...d, id }; else l.push({ ...d, id }); }, avisar: (x) => av.push(x) };
  const hs = Z.executar(c, conv, "horarios_livres", { dias_a_frente: 2 }); assert.ok(hs.horarios.length >= 3);
  assert.ok(Z.executar(c, conv, "agendar", { inicio: "2026-10-05T03:00", tipo: "Ligação", assunto: "x", nome: "Ana" }).erro);
  const ok1 = Z.executar(c, conv, "agendar", { inicio: hs.horarios[0].inicio, tipo: "Reunião (vídeo)", assunto: "Receitas – Prefeitura de Sumaré/SP", nome: "Ana" }); assert.ok(ok1.ok); assert.match(ok1.confirmado, /segunda/);
  assert.ok(Z.executar(c, conv, "agendar", { inicio: hs.horarios[0].inicio, tipo: "Ligação", assunto: "y", nome: "Ana" }).erro, "não marca duas vezes");
  assert.equal(Z.executar(c, conv, "meus_agendamentos", {}).agendamentos.length, 1);
  assert.ok(Z.executar(c, conv, "cancelar_agendamento", { id: ok1.id }).ok); assert.equal(mem.agenda[0].status, "cancelado");
  assert.ok(av.some((x) => /Agendado pela PrimeCorp IA/.test(x)));
});
await t("Zoe: HUMANO transfere sem IA e silencia a Zoe; humano responde pelo app", async () => {
  globalThis.__zoe = () => { throw new Error("não devia chamar a IA"); };
  const c = payload("5519911112222", "humano", "wamid.A2"); await W(c);
  await zbg(new Request("https://pc.test/x", { method: "POST", headers: SEG, body: JSON.stringify({ wa: "5519911112222", espera: 0 }) }));
  let d = await J(await api(R("GET", "/api/dados"), ctx())); let cv = d.j.conversas.find((x) => x.id === "5519911112222");
  assert.equal(cv.modo, "humano"); assert.ok(cv.precisa_humano); assert.match(cv.msgs[cv.msgs.length - 1].texto, /chamei a equipe/);
  await W(payload("5519911112222", "e o valor?", "wamid.A3"));
  const n = enviados.length; await zbg(new Request("https://pc.test/x", { method: "POST", headers: SEG, body: JSON.stringify({ wa: "5519911112222", espera: 0 }) })); assert.equal(enviados.length, n, "Zoe calada no modo humano");
  assert.equal((await api(R("PUT", "/api/dados/conversas/5519911112222", { modo: "zoe" }), ctx())).status, 403);
  const r = await J(await api(R("POST", "/api/zoe/enviar", { conversa: "5519911112222", texto: "Oi Carlos, Rodrigo aqui." }), ctx())); assert.equal(r.s, 200);
  d = await J(await api(R("GET", "/api/dados"), ctx())); cv = d.j.conversas.find((x) => x.id === "5519911112222"); assert.equal(cv.msgs[cv.msgs.length - 1].de, "humano"); assert.equal(cv.precisa_humano, null);
  await api(R("POST", "/api/zoe/modo", { conversa: "5519911112222", modo: "zoe" }), ctx());
  d = await J(await api(R("GET", "/api/dados"), ctx())); assert.equal(d.j.conversas.find((x) => x.id === "5519911112222").modo, "zoe");
});
await t("Zoe: SAIR encerra mensagens automáticas", async () => {
  await W(payload("5519933334444", "SAIR", "wamid.B1"));
  await zbg(new Request("https://pc.test/x", { method: "POST", headers: SEG, body: JSON.stringify({ wa: "5519933334444", espera: 0 }) }));
  const d = await J(await api(R("GET", "/api/dados"), ctx())); const cv = d.j.conversas.find((x) => x.id === "5519933334444"); assert.equal(cv.optout, true);
});
await t("Zoe: número da equipe entra no modo equipe (resumo da operação)", async () => {
  let sys = ""; globalThis.__zoe = (req) => { const last = req.messages[req.messages.length - 1]; if (typeof last.content === "string") { sys = req.system; assert.ok(req.tools.some((x) => x.name === "resumo_operacao")); return passo("resumo_operacao", {}); } const res = JSON.parse(last.content[0].content); return fala(`Briefings ativos: ${res.briefings_ativos}.`); };
  await W(payload("19998051985", "resumo do dia", "wamid.C1"));
  await zbg(new Request("https://pc.test/x", { method: "POST", headers: SEG, body: JSON.stringify({ wa: "5519998051985", espera: 0 }) }));
  assert.match(sys, /MODO EQUIPE/); assert.ok(enviados.some((m) => m.to === "5519998051985" && /Briefings ativos: \d+\./.test(m.text?.body || "")));
});
await t("Zoe: simulador não grava contato de verdade", async () => {
  globalThis.__zoe = (req) => { const last = req.messages[req.messages.length - 1]; if (typeof last.content === "string") return passo("salvar_contato", { nome: "Teste", empresa: "Prefeitura Teste", perfil: "Órgão público" }); return fala("Registrado."); };
  const antes = (await J(await api(R("GET", "/api/dados"), ctx()))).j.contatos.length;
  const r = await J(await api(R("POST", "/api/zoe/simular", { texto: "sou da prefeitura e recebi o convite" }), ctx())); assert.equal(r.s, 200); assert.equal(r.j.resposta, "Registrado."); assert.ok(r.j.simulado.some((x) => x.startsWith("contatos/")));
  assert.equal((await J(await api(R("GET", "/api/dados"), ctx()))).j.contatos.length, antes);
});
await t("Zoe: botões e limpeza da resposta", async () => {
  const f = Z.finalizar("Olá!\n[[botoes: Análise de receitas | Indicação | Agendar reunião]]"); assert.equal(f.texto, "Olá!"); assert.equal(f.botoes.length, 3); assert.ok(f.botoes.every((b) => b.length <= 20));
  assert.equal(Z.waNum("(19) 99805-1985"), "5519998051985");
});
await t("coexistência: resposta pelo celular pausa a Zoe e ela retoma depois do prazo", async () => {
  const eco = (texto, id, ts) => JSON.stringify({ entry: [{ changes: [{ field: "smb_message_echoes", value: { metadata: { phone_number_id: "999" }, message_echoes: [{ from: "558781315053", to: "5519955556666", id, timestamp: String(ts), type: "text", text: { body: texto } }] } }] }] });
  await W(payload("5519955556666", "Oi, tenho um terreno", "wamid.D1"));
  const velho = Math.floor(Date.now() / 1000) - 13 * 3600; await W(eco("Oi! Aqui é o Rodrigo, já te ligo.", "wamid.D2", velho));
  let d = await J(await api(R("GET", "/api/dados"), ctx())); let cv = d.j.conversas.find((x) => x.id === "5519955556666");
  assert.equal(cv.modo, "humano"); assert.equal(cv.msgs[cv.msgs.length - 1].de, "humano"); assert.equal(cv.msgs[cv.msgs.length - 1].por, "WhatsApp Business (celular)");
  globalThis.__zoe = () => fala("Oi de novo! Posso ajudar com o terreno?");
  await W(payload("5519955556666", "alguém aí?", "wamid.D3"));
  await zbg(new Request("https://pc.test/x", { method: "POST", headers: SEG, body: JSON.stringify({ wa: "5519955556666", espera: 0 }) }));
  d = await J(await api(R("GET", "/api/dados"), ctx())); cv = d.j.conversas.find((x) => x.id === "5519955556666"); assert.equal(cv.modo, "zoe"); assert.equal(cv.msgs[cv.msgs.length - 1].de, "zoe", "retomou após 12 h sem resposta humana");
  await W(eco("Respondo eu.", "wamid.D4", Math.floor(Date.now() / 1000))); await W(payload("5519955556666", "ok", "wamid.D5"));
  const n = enviados.length; await zbg(new Request("https://pc.test/x", { method: "POST", headers: SEG, body: JSON.stringify({ wa: "5519955556666", espera: 0 }) })); assert.equal(enviados.length, n, "resposta recente pelo celular: Zoe calada");
});
await t("360dialog: envio pelo parceiro e webhook com chave na URL", async () => {
  Object.assign(process.env, { WHATSAPP_PROVEDOR: "360dialog", WHATSAPP_WEBHOOK_CHAVE: "k".repeat(32) }); const urls = []; const ant = globalThis.__fetchWA;
  globalThis.__fetchWA = async (url, op) => { urls.push([url, op.headers]); return new Response(JSON.stringify({ messages: [{ id: "x" }] }), { status: 200 }); };
  const { enviar } = await import("../shared/whatsapp.mjs"); await enviar("5519900000000", "teste");
  assert.equal(urls[0][0], "https://waba-v2.360dialog.io/messages"); assert.equal(urls[0][1]["D360-API-KEY"], "tk");
  const c = payload("5519977778888", "Oi", "wamid.F1");
  assert.equal((await wh(new Request("https://pc.test/whatsapp/webhook?chave=" + "k".repeat(32), { method: "POST", body: c }), ctx())).status, 200);
  assert.equal((await wh(new Request("https://pc.test/whatsapp/webhook?chave=" + "x".repeat(32), { method: "POST", body: c }), ctx())).status, 401);
  globalThis.__fetchWA = ant; delete process.env.WHATSAPP_PROVEDOR; delete process.env.WHATSAPP_WEBHOOK_CHAVE;
});
await t("anúncio público: 'Tenho interesse' vai para o WhatsApp da Zoe", async () => {
  const imov = (await import("./out/imovel.mjs")).default; const TK = "A".repeat(24);
  await api(R("PUT", "/api/dados/anuncios/" + TK, { status: "ativo", codigo: "PC-0001", titulo: "Galpão", corretor: { nome: "Rodrigo", whatsapp: "19998051985" }, fotos: [] }), ctx());
  process.env.WHATSAPP_NUMERO = "(19) 98110-5192";
  let h = await (await imov(new Request("https://pc.test/i/" + TK), ctx())).text(); assert.match(h, /wa\.me\/5519981105192/);
  await api(R("PUT", "/api/dados/config/zoe", { anuncios_pela_zoe: false }), ctx());
  h = await (await imov(new Request("https://pc.test/i/" + TK), ctx())).text(); assert.match(h, /wa\.me\/5519998051985/);
  delete process.env.WHATSAPP_NUMERO;
});
await t("360dialog: botão conecta o webhook com chave em cabeçalho", async () => {
  Object.assign(process.env, { WHATSAPP_PROVEDOR: "360dialog", WHATSAPP_WEBHOOK_CHAVE: "k".repeat(32) }); const ant = globalThis.__fetchWA; let req;
  globalThis.__fetchWA = async (url, op) => { req = [url, JSON.parse(op.body), op.headers]; return new Response("{}", { status: 200 }); };
  const r = await J(await api(R("POST", "/api/zoe/conectar"), ctx())); assert.equal(r.s, 200);
  assert.equal(req[0], "https://waba-v2.360dialog.io/v1/configs/webhook"); assert.match(req[1].url, /\/whatsapp\/webhook$/); assert.equal(req[1].headers["x-chave-webhook"], "k".repeat(32));
  assert.equal((await wh(new Request("https://pc.test/whatsapp/webhook", { method: "POST", headers: { "x-chave-webhook": "k".repeat(32) }, body: payload("5519977770000", "Oi", "wamid.G1") }), ctx())).status, 200);
  globalThis.__fetchWA = ant; delete process.env.WHATSAPP_PROVEDOR; delete process.env.WHATSAPP_WEBHOOK_CHAVE;
});
await t("status mostra WhatsApp configurado e webhook", async () => { const s = await J(await api(R("GET", "/api/status"), ctx())); assert.equal(s.j.whatsapp_configurado, true); assert.match(s.j.webhook, /\/whatsapp\/webhook$/); });

await t("Zoe: botões no formato antigo viram botões de verdade", async () => {
  const f = Z.finalizar("Perfeito! E qual operação você precisa?\n[Alugar | Comprar]"); assert.equal(f.texto, "Perfeito! E qual operação você precisa?"); assert.deepEqual(f.botoes, ["Alugar", "Comprar"]);
  assert.equal(Z.finalizar("Veja [aqui] o link").botoes.length, 0, "colchete comum não vira botão");
  let hist; globalThis.__zoe = (req) => { hist = req.messages; return fala("Em qual cidade?\n[[botoes: Sumaré | Campinas]]"); };
  const conv = { id: "x", msgs: [{ de: "cliente", t: new Date().toISOString(), texto: "oi" }, { de: "zoe", t: new Date().toISOString(), texto: "Qual tipo?\n[Galpão | Casa]" }, { de: "cliente", t: new Date().toISOString(), texto: "Galpão" }] };
  const ctxZ = { agora: new Date(), cfg: { zoe: {}, geral: {} }, listar: () => [], salvar: () => {}, avisar: () => {}, cliente: new (await import("./mocks/anthropic.mjs")).default() };
  const r = await Z.responder(ctxZ, conv); assert.deepEqual(r.botoes, ["Sumaré", "Campinas"]);
  assert.match(hist.find((m) => m.role === "assistant").content, /\[\[botoes: Galpão \| Casa\]\]/, "histórico ensina o formato certo");
});
await t("Zoe: áudio do cliente é baixado, transcrito e respondido", async () => {
  const ant = globalThis.__fetchWA; const urls = [];
  globalThis.__fetchWA = async (url, op) => { urls.push(String(url));
    if (String(url).endsWith("/media.A1")) return new Response(JSON.stringify({ url: "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=A1", mime_type: "audio/ogg; codecs=opus" }), { status: 200 });
    if (String(url).includes("attachments")) return new Response(Buffer.from("OggS-audio"), { status: 200, headers: { "content-type": "audio/ogg" } });
    enviados.push(JSON.parse(op.body)); return new Response(JSON.stringify({ messages: [{ id: "wamid.a" + enviados.length }] }), { status: 200 }); };
  let ouvido; globalThis.__transcrever = async (buf, mime) => { ouvido = [buf.toString(), mime]; return "Quero alugar um galpão em Sumaré"; };
  let viu; globalThis.__zoe = (req) => { viu = req.messages.at(-1).content; return fala("Entendido, galpão para alugar em Sumaré."); };
  const corpo = JSON.stringify({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "999" }, contacts: [{ wa_id: "5519944443333", profile: { name: "Ana" } }], messages: [{ from: "5519944443333", id: "wamid.AU1", timestamp: String(Math.floor(Date.now() / 1000)), type: "audio", audio: { id: "media.A1", mime_type: "audio/ogg; codecs=opus", voice: true } }] } }] }] });
  assert.equal((await W(corpo)).status, 200);
  await zbg(new Request("https://pc.test/x", { method: "POST", headers: SEG, body: JSON.stringify({ wa: "5519944443333", espera: 0 }) }));
  assert.deepEqual(ouvido, ["OggS-audio", "audio/ogg"]); assert.match(viu, /\[áudio\] Quero alugar um galpão em Sumaré/);
  assert.ok(urls.some((u) => u.includes("graph.facebook.com") && u.endsWith("/media.A1")));
  const cv = (await J(await api(R("GET", "/api/dados"), ctx()))).j.conversas.find((x) => x.id === "5519944443333");
  assert.ok(cv.msgs.find((m) => m.id === "wamid.AU1").transcrito); assert.equal(cv.msgs.at(-1).de, "zoe");
  // 360dialog: baixa pelo host da 360dialog com a mesma rota
  Object.assign(process.env, { WHATSAPP_PROVEDOR: "360dialog" }); urls.length = 0;
  const { baixarMidia } = await import("../shared/audio.mjs"); const m = await baixarMidia("media.A1");
  assert.equal(urls[0], "https://waba-v2.360dialog.io/media.A1"); assert.equal(urls[1], "https://waba-v2.360dialog.io/whatsapp_business/attachments/?mid=A1"); assert.equal(m.mime, "audio/ogg");
  delete process.env.WHATSAPP_PROVEDOR; globalThis.__fetchWA = ant; delete globalThis.__transcrever;
});
await t("Zoe: falha na transcrição pede para escrever (sem travar)", async () => {
  globalThis.__transcrever = async () => { throw new Error("sem cota"); };
  const ant = globalThis.__fetchWA; globalThis.__fetchWA = async (url, op) => { if (String(url).endsWith("/media.B1")) return new Response(JSON.stringify({ url: "https://lookaside.fbsbx.com/x?mid=B1" }), { status: 200 }); if (String(url).includes("mid=B1")) return new Response("x", { status: 200 }); return ant(url, op); };
  let viu; globalThis.__zoe = (req) => { viu = req.messages.at(-1).content; return fala("Não consegui ouvir seu áudio. Pode escrever?"); };
  const corpo = JSON.stringify({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "999" }, messages: [{ from: "5519944442222", id: "wamid.AU2", timestamp: String(Math.floor(Date.now() / 1000)), type: "audio", audio: { id: "media.B1" } }] } }] }] });
  await W(corpo); await zbg(new Request("https://pc.test/x", { method: "POST", headers: SEG, body: JSON.stringify({ wa: "5519944442222", espera: 0 }) }));
  assert.match(viu, /\[áudio não transcrito\]/); globalThis.__fetchWA = ant; delete globalThis.__transcrever;
});
await t("revisão semanal: sugere, só aprende com aprovação", async () => {
  const rv = (await import("./out/zoe-revisao-background.mjs")).default;
  let prompt; globalThis.__revisao = (t) => { prompt = t; return { resumo: "Semana com 4 conversas; clientes perguntaram sobre visita no sábado.", sugestoes: [{ tipo: "faq", titulo: "Visita aos sábados", texto: "- Fazem visita no sábado? Sim, com agendamento até sexta.", motivo: "2 clientes perguntaram", exemplo: "vocês atendem sábado?" }, { tipo: "orientacao", titulo: "Galpão acima de 20 mil m²", texto: "Para galpões acima de 20 mil m², chame a equipe logo após entender a demanda.", motivo: "Zoe demorou" }, { tipo: "faq", texto: "" }] }; };
  const n0 = enviados.length;
  await rv(new Request("https://pc.test/x", { method: "POST", headers: SEG }));
  assert.match(prompt, /CONVERSAS DA SEMANA/); assert.ok(!/99805-1985|5519998051985/.test(prompt.split("CONVERSAS DA SEMANA")[1]), "sem equipe nem telefones");
  let d = (await J(await api(R("GET", "/api/dados"), ctx()))).j; const pend = d.zoe_sugestoes.filter((x) => x.status === "pendente"); assert.equal(pend.length, 2);
  assert.ok(enviados.slice(n0).some((m) => m.to === "5519998051985" && /Revisão semanal/.test(m.text?.body || "")), "equipe avisada no WhatsApp");
  const rx0 = d.config.find((c) => c.id === "zoe")?.regras_extra;
  assert.equal((await api(R("PUT", "/api/dados/zoe_sugestoes/" + pend[0].id, { status: "aprovada" }), ctx())).status, 403, "não aprova por fora");
  const fq = pend.find((x) => x.tipo === "faq"), or = pend.find((x) => x.tipo === "orientacao");
  assert.equal((await api(R("POST", "/api/zoe/sugestao", { id: fq.id, acao: "aprovar", texto: "- Fazem visita no sábado? Sim, das 9h às 12h, com agendamento." }), ctx())).status, 200);
  assert.equal((await api(R("POST", "/api/zoe/sugestao", { id: or.id, acao: "recusar" }), ctx())).status, 200);
  assert.equal((await api(R("POST", "/api/zoe/sugestao", { id: or.id, acao: "aprovar" }), ctx())).status, 409, "já decidida");
  d = (await J(await api(R("GET", "/api/dados"), ctx()))).j; const z = d.config.find((c) => c.id === "zoe");
  assert.match(z.regras_extra, /das 9h às 12h/, "FAQ aprovada entra nas orientações"); assert.ok(z.regras_extra.length > (rx0 || "").length); assert.ok(!/20 mil/.test(z.regras_extra || ""), "recusada não entra");
  assert.match(Z.promptSistema({ zoe: z, geral: {}, agora: new Date() }), /das 9h às 12h/, "a PrimeCorp IA já usa no atendimento ao cliente");
  assert.match(prompt, /PrimeCorp IA/); assert.match(prompt, /recomposição de receitas/); assert.doesNotMatch(prompt.split("CONVERSAS DA SEMANA")[0], /QUEM SOMOS|PERGUNTAS FREQUENTES/, "conhecimento = receitas + orientações");
  globalThis.__user = { email: "outra@x.com" };
  globalThis.__user = { email: "contato@primecorpconsultoria.com.br" }; delete globalThis.__revisao;
});
await t("modelo: padrão novo com reserva automática", async () => {
  const S = await import("../shared/servidor.mjs"); assert.equal(S.MODELO_PADRAO, "claude-sonnet-5-5");
  globalThis.__modelos = []; globalThis.__modelosFora = ["claude-sonnet-5-5"]; globalThis.__zoe = () => fala("ok");
  const r = await Z.responder({ agora: new Date(), cfg: { zoe: {}, geral: {} }, listar: () => [], salvar: () => {}, avisar: () => {}, cliente: new (await import("./mocks/anthropic.mjs")).default() }, { id: "m", msgs: [{ de: "cliente", t: new Date().toISOString(), texto: "oi" }] });
  assert.equal(r.texto, "ok"); assert.deepEqual(globalThis.__modelos.slice(0, 2), ["claude-sonnet-5-5", "claude-sonnet-4-5"]); globalThis.__modelosFora = [];
});

await t("PrimeCorp IA: atendimento ao cliente só tributário (sem imóveis/Propto)", async () => {
  const p = Z.promptSistema({ zoe: { nome: "Zoe", servicos: "texto antigo salvo" }, geral: {}, agora: new Date() });
  for (const x of [/PrimeCorp IA/, /RECOMPOSIÇÃO DE RECEITAS/, /Análise de receitas \| Indicação \| Agendar reunião/, /F\) AGENDA/, /R2\) INDICAÇÃO/, /99805-1985/, /contato@primecorpconsultoria\.com\.br/, /Reunião \(vídeo\)/, /Receitas – <organização>\/<UF>/, /Não dê parecer jurídico, tributário ou contábil; não garanta resultado/]) assert.match(p, x);
  for (const x of [/Propto/, /Zoe/, /BUSCA DE IMÓVEL/, /Imóveis \| Imobiliária/, /\| Imóveis\]\]/, /QUEM SOMOS/, /O QUE OFERECEMOS/, /PERGUNTAS FREQUENTES/, /CRECI/, /texto antigo salvo/, /Sala do Cliente/, /buscar_imoveis|registrar_demanda|registrar_imovel_proprietario/, /^[ABCD]\) /m]) assert.doesNotMatch(p, x);
  for (const x of [/PROGRAMA DE CRÉDITO SAUDÁVEL/, /Imposto de Renda/, /RAT-FAP/, /FPM\/FPE/, /PARCEIRO TRIBUTÁRIO CADASTRADO/, /consultar reservas/, /I\) EMPRESA/, /J\) ENSINO/, /K\) INDICADOR/]) assert.doesNotMatch(p, x);
  assert.ok(!Z.FERRAMENTAS_TRIBUTARIO, "ferramentas tributárias removidas");
  const eq = Z.promptSistema({ zoe: {}, geral: {}, agora: new Date(), equipe: true, contato: { nome: "Rodrigo" } });
  for (const x of [/MODO EQUIPE/, /equipe PrimeCorp/, /RECOMPOSIÇÃO DE RECEITAS/, /CRECI-SP 297692/, /QUEM SOMOS/]) assert.match(eq, x, "modo equipe mantém o conhecimento");
  assert.doesNotMatch(eq, /Zoe|equipe Propto Imóveis/);
});

await t("Zoe: conhecimento salvo antigo sem receitas usa o padrão; perfil Indicador", async () => {
  const antigo = { quem_somos: "x", servicos: "y", faq: "z", regras_extra: "" };
  assert.ok(!("receitas" in antigo)); assert.match(Z.promptSistema({ zoe: antigo, geral: {}, agora: new Date() }), /RECOMPOSIÇÃO DE RECEITAS \(convite PrimeCorp\)/);
  assert.match(Z.promptSistema({ zoe: { ...antigo, receitas: "" }, geral: {}, agora: new Date() }), /RECOMPOSIÇÃO DE RECEITAS \(convite PrimeCorp\)/, "campo vazio volta ao padrão");
  const mem = { contatos: [] }; const ctxZ = { agora: new Date(), cfg: { zoe: {}, geral: {} }, listar: (c) => mem[c] || [], salvar: (c, id, d) => { mem[c] = (mem[c] || []).filter((x) => x.id !== id).concat(d); }, avisar: () => {} };
  const conv = { id: "5519900007777" };
  const r = Z.executar(ctxZ, conv, "salvar_contato", { nome: "Marta", perfil: "Indicador", observacoes: "Receitas · origem: direto · indica prefeitura" }, false);
  assert.ok(!r.erro, JSON.stringify(r)); assert.equal(mem.contatos[0].tipo, "Indicador");
  Z.executar(ctxZ, { id: "5519900007778" }, "salvar_contato", { nome: "Paulo", perfil: "Órgão público" }, false); assert.equal(mem.contatos.at(-1).tipo, "Órgão público");
});

await t("equipe ajusta horário pelo WhatsApp (seg-qui 9-18, sex 9-16)", async () => {
  const salvos = []; const ctxZ = { agora: new Date("2026-10-05T12:00:00-03:00"), cfg: { zoe: { faq: "x" }, geral: {} }, listar: () => [], salvar: (c, id, d) => salvos.push([c, id, d]), avisar: () => {} };
  assert.ok(Z.executar(ctxZ, { id: "1" }, "ajustar_horario", { dias: "seg a sex" }, false).erro, "cliente não altera");
  const r = Z.executar(ctxZ, { id: "1" }, "ajustar_horario", { dias: "seg a sex", inicio: "9h", fim: "18:00", fim_por_dia: "sex=16:00" }, true);
  assert.equal(r.horario, "seg 09:00–18:00, ter 09:00–18:00, qua 09:00–18:00, qui 09:00–18:00, sex 09:00–16:00");
  const cfg = salvos.at(-1)[2]; assert.equal(cfg.faq, "x", "não apaga o resto"); assert.equal(cfg.horario.fim_dia[5], "16:00");
  const sexta = Z.horariosLivres(cfg, [], new Date("2026-10-08T20:00:00-03:00"), { dias: 2, max: 20 }).map((d) => d.toISOString()).filter((x) => x.startsWith("2026-10-09"));
  assert.ok(sexta.length && sexta.every((x) => x < "2026-10-09T19:00"), "sexta acaba às 16h (19h UTC)");
  assert.match(Z.promptSistema({ zoe: cfg, geral: {}, agora: new Date() }), /sex 9h–16h/);
});
await t("modelo de aviso: criação na 360dialog e envio fora das 24 h sem quebra de linha", async () => {
  Object.assign(process.env, { WHATSAPP_PROVEDOR: "360dialog" }); const ant = globalThis.__fetchWA; const reqs = [];
  globalThis.__fetchWA = async (url, op) => { reqs.push([String(url), JSON.parse(op.body)]); return new Response(JSON.stringify({ status: "PENDING" }), { status: 200 }); };
  const r = await J(await api(R("POST", "/api/zoe/modelo-aviso"), ctx())); assert.equal(r.s, 200); assert.equal(r.j.nome, "propto_site PENDING · primecorp_aviso PENDING · primecorp_site PENDING");
  const site = reqs.find((x) => x[1].name === "primecorp_site")?.[1]; assert.ok(site, "modelo do site criado"); assert.match(JSON.stringify(site), /Quero continuar/); assert.match(JSON.stringify(site), /responda SAIR/);
  assert.equal(reqs[0][0], "https://waba-v2.360dialog.io/v1/configs/templates"); assert.equal(reqs[0][1].category, "UTILITY"); assert.match(reqs[0][1].components[0].text, /\{\{1\}\}/);
  const { enviarModelo } = await import("../shared/whatsapp.mjs"); await enviarModelo("5519998051985", "zoe_aviso", ["linha 1\nlinha   2"]);
  assert.equal(reqs.at(-1)[1].template.components[0].parameters[0].text, "linha 1 linha 2");
  globalThis.__fetchWA = ant; delete process.env.WHATSAPP_PROVEDOR;
});

await t("Zoe: ferramentas de atendimento: só agenda, contato e equipe (sem imóveis nem frente tributária antiga)", async () => {
  const tools = Z.FERRAMENTAS_CLIENTE.map((x) => x.name);
  assert.deepEqual(tools, ["horarios_livres", "agendar", "meus_agendamentos", "cancelar_agendamento", "salvar_contato", "chamar_equipe"]);
  const ag = Z.FERRAMENTAS_CLIENTE.find((x) => x.name === "agendar"); assert.ok(!("codigo_imovel" in ag.input_schema.properties)); assert.equal(ag.input_schema.properties.tipo.description, "Reunião (vídeo) | Reunião presencial | Ligação");
  const eq = Z.FERRAMENTAS_EQUIPE.map((x) => x.name); for (const n of ["resumo_operacao", "agenda_periodo", "conversas_pendentes", "buscar_imoveis", "verificacao_imovel", "registrar_imovel_proprietario", "horarios_livres", "ajustar_horario"]) assert.ok(eq.includes(n), "equipe: " + n);
  for (const n of ["minhas_reservas", "consultar_ente", "solicitar_reserva", "painel_tributario", "buscar_reserva"]) assert.ok(!tools.includes(n), n);
});

await t("assistente se chama PrimeCorp IA (nome salvo antigo ignorado) e ajusta o tratamento pelo nome", async () => {
  const p = Z.promptSistema({ zoe: {}, geral: {}, agora: new Date(), conversa: { nome: "Juliana" } });
  assert.match(p, /Você é a PrimeCorp IA, assistente virtual da PrimeCorp no WhatsApp/); assert.match(p, /"Sou a PrimeCorp IA, assistente virtual da PrimeCorp"/); assert.match(p, /Para falar com uma pessoa, digite HUMANO/);
  assert.ok(!/Zoe/.test(p)); assert.match(p, /NOME NO PERFIL DO WHATSAPP: Juliana/); assert.match(p, /Nunca pergunte o gênero/);
  for (const nome of ["PrimeCorp", "Propto Imóveis", "Zoe", "Clara"]) { const q = Z.promptSistema({ zoe: { nome }, geral: {}, agora: new Date() }); assert.match(q, /Você é a PrimeCorp IA/, nome); assert.ok(!q.includes("Seu nome é"), nome); }
  assert.equal(Z.NOME_ASSISTENTE, "PrimeCorp IA");
});
await t("primeiro contato recebe o cartão de boas-vindas uma única vez", async () => {
  globalThis.__zoe = () => fala("Olá! Sou a PrimeCorp, sua atendente virtual.");
  const n0 = enviados.length; await W(payload("5519900001111", "Oi", "wamid.BV1"));
  await zbg(new Request("https://pc.test/x", { method: "POST", headers: SEG, body: JSON.stringify({ wa: "5519900001111", espera: 0 }) }));
  const img = enviados.slice(n0).filter((m) => m.type === "image"); assert.equal(img.length, 1); assert.match(img[0].image.link, /\/marca\/primecorp-boas-vindas\.jpg$/);
  const n1 = enviados.length; await W(payload("5519900001111", "Quero alugar galpão", "wamid.BV2"));
  await zbg(new Request("https://pc.test/x", { method: "POST", headers: SEG, body: JSON.stringify({ wa: "5519900001111", espera: 0 }) }));
  assert.equal(enviados.slice(n1).filter((m) => m.type === "image").length, 0, "só na primeira vez");
});

await t("expediente: seg-qui 9-18, sex 9-16; fora disso a assistente atende e os avisos esperam", async () => {
  const Zm = Z; const at = (iso) => new Date(iso);
  assert.equal(Zm.estaAberto({}, at("2026-10-08T17:30:00-03:00")), true, "quinta 17h30");
  assert.equal(Zm.estaAberto({}, at("2026-10-09T16:30:00-03:00")), false, "sexta 16h30");
  assert.equal(Zm.estaAberto({}, at("2026-10-10T10:00:00-03:00")), false, "sábado");
  assert.equal(Zm.proximaAbertura({}, at("2026-10-09T17:00:00-03:00")), "segunda-feira às 09:00");
  assert.equal(Zm.proximaAbertura({}, at("2026-10-07T20:00:00-03:00")), "amanhã às 09:00");
  assert.equal(Zm.descreverHorario({}), "seg a qui 9h–18h, sex 9h–16h");
  const r = await Zm.responder({ agora: at("2026-10-10T11:00:00-03:00"), cfg: { zoe: {}, geral: {} }, listar: () => [], salvar: () => {}, avisar: () => {} }, { id: "x", msgs: [{ de: "cliente", t: new Date().toISOString(), texto: "humano" }] });
  assert.match(r.texto, /segunda-feira às 09:00/); assert.match(r.texto, /seg a qui 9h–18h, sex 9h–16h/);
  // fila: aviso fora do horário não dispara WhatsApp na hora; entregarFila manda tudo junto no expediente
  const RUN = await import("../shared/zoe-run.mjs");
  globalThis.__aberto = false; // equipe fora do expediente
  globalThis.__zoe = (req) => { const last = req.messages.at(-1); if (typeof last.content === "string") return passo("chamar_equipe", { motivo: "quer proposta", urgente: false }); return fala("Nossa equipe retorna no próximo expediente."); };
  const n0 = enviados.length; await W(payload("5519900002222", "quero proposta", "wamid.FL1"));
  await zbg(new Request("https://pc.test/x", { method: "POST", headers: SEG, body: JSON.stringify({ wa: "5519900002222", espera: 0 }) }));
  assert.ok(!enviados.slice(n0).some((m) => m.to === "5519998051985"), "fora do horário: equipe não é acordada");
  globalThis.__aberto = true;
  const e = await RUN.entregarFila(); assert.ok(e.entregues >= 1); assert.ok(enviados.slice(n0).some((m) => m.to === "5519998051985" && /fora do horário chegaram/.test(m.text?.body || "")));
  assert.equal((await RUN.entregarFila()).entregues, 0, "não repete");
});

await t("site: formulário vira lead, avisa a equipe e leva o cliente à assistente no WhatsApp", async () => {
  const sl = (await import("./out/site-lead.mjs")).default; const S = await import("../shared/site.mjs"); const { db: sdb } = await import("../shared/servidor.mjs");
  const SITE = "https://primecorpconsultoria.com.br";
  const post = (b, origin = SITE, ip = "201.0.0.1") => sl(new Request("https://pc.test/site/lead", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(b) }), { ip });
  const base = { form: "consulta", perfil: "Instituição de ensino / filantrópica", nome: "Ana Souza", municipio: "Campinas/SP", fone: "(19) 99777-1234", email: "ana@escola.org", consentimento: true, pagina: "ensino e filantropia" };
  const op = await sl(new Request("https://pc.test/site/lead", { method: "OPTIONS", headers: { origin: SITE } }), {}); assert.equal(op.status, 204); assert.equal(op.headers.get("access-control-allow-origin"), SITE);
  assert.equal((await post(base, "https://malicioso.com")).status, 403);
  assert.equal((await post({ ...base, consentimento: false })).status, 400, "sem LGPD não grava");
  assert.equal((await post({ ...base, fone: "123" })).status, 400);
  const hp = await J(await post({ ...base, hp: "robô" })); assert.equal(hp.s, 200); assert.ok(!hp.j.codigo, "honeypot: finge sucesso e não grava");
  const n0 = enviados.length; const r = await J(await post(base));
  assert.equal(r.s, 200); assert.match(r.j.codigo, /^S[0-9A-F]{6}$/); assert.match(r.j.whatsapp, /^https:\/\/wa\.me\/5519981105192\?text=/);
  assert.match(decodeURIComponent(r.j.whatsapp), new RegExp("ensino e filantropia.*" + r.j.codigo));
  assert.ok(enviados.slice(n0).some((m) => m.to === "5519998051985" && /Novo cadastro no site · ensino e filantropia · Ana Souza/.test(m.text?.body || "")), "equipe avisada");
  const lead = (await sdb().sql`SELECT dados FROM registros WHERE colecao='site_leads' AND id=${"sl_" + r.j.codigo}`)[0].dados;
  assert.equal(lead.wa, "5519997771234"); assert.equal(lead.status, "novo"); assert.ok(!lead.ip.includes("201."), "IP só em hash");
  // indicação com extras
  const ind = await J(await post({ form: "indicacao", perfil: "Cidadão", nome: "Carlos", municipio: "Hortolândia/SP", fone: "19988887777", consentimento: true, extras: { acesso_gestao: "conheço o secretário", declaracao_nao_vinculo: true } }, SITE, "201.0.0.2"));
  assert.equal(ind.s, 200); assert.match(decodeURIComponent(ind.j.whatsapp), /\(indicação\)/);
  // a conversa que cita o código já chega com o cadastro no contexto
  const L = (await sdb().sql`SELECT dados FROM registros WHERE colecao='site_leads'`).map((x) => x.dados);
  const conv = { id: "5511900000001", msgs: [{ de: "cliente", t: new Date().toISOString(), texto: `Olá! Acabei de me cadastrar no site da PrimeCorp (ensino e filantropia). Código ${r.j.codigo}.` }] };
  assert.equal(S.leadDaConversa(L, conv)?.codigo, r.j.codigo, "pelo código");
  assert.equal(S.leadDaConversa(L, { id: "5519997771234", msgs: [] })?.codigo, r.j.codigo, "pelo telefone");
  assert.equal(S.leadDaConversa(L, { id: "551997771234", msgs: [] })?.codigo, r.j.codigo, "telefone sem o 9");
  let sys = ""; globalThis.__zoe = (req) => { sys = typeof req.system === "string" ? req.system : JSON.stringify(req.system); return fala("Olá, Ana!"); };
  const salvos = []; await Z.responder({ agora: new Date(), cfg: { zoe: {}, geral: {} }, listar: (c) => (c === "site_leads" ? L : []), salvar: (c, id, d) => salvos.push([c, d]), avisar: () => {}, cliente: new (await import("./mocks/anthropic.mjs")).default() }, conv);
  assert.match(sys, /CADASTRO PELO SITE/); assert.match(sys, /Ana Souza/); assert.match(sys, /Não peça de novo/);
  assert.ok(salvos.some(([c, d]) => c === "site_leads" && d.status === "conversando"));
  // limite por IP
  for (let i = 0; i < 6; i++) await post({ ...base, nome: "Spam " + i }, SITE, "9.9.9.9");
  assert.equal((await post(base, SITE, "9.9.9.9")).status, 429);
});

await t("site: tipo de cadastro (prefeitura, empresa com CNPJ, empresa só com cidade/UF, governo do estado)", async () => {
  const S = await import("../shared/site.mjs");
  const lead = (form, municipio, extras) => ({ ...S.normalizarLead({ form, perfil: "Cidadão", nome: "Paula Lima", municipio, fone: "19988881111", consentimento: true, extras }), codigo: "S0A0B0C", criado: new Date().toISOString() });
  const casos = [
    ["prefeitura", "PREFEITURA", lead("indicacao", "Hortolândia/SP", { tipo_organizacao: "Ente público", tipo_ente: "Prefeitura (município)", organizacao: "Prefeitura Municipal de Hortolândia", cnpj: "45.787.660/0001-00" }), "Prefeitura Municipal de Hortolândia", "indicação de município"],
    ["empresa", "EMPRESA", lead("indicacao", "Sumaré/SP", { organizacao: "Metalúrgica Sumaré Ltda.", cnpj: "12.345.678/0001-90" }), "Metalúrgica Sumaré Ltda.", "indicação de empresa"],
    ["empresa", "EMPRESA", lead("consulta", "Campinas/SP", { tipo_organizacao: "Empresa privada", organizacao: "Transportes Campinas" }), "Transportes Campinas", "empresas"],
    ["governo_estadual", "GOVERNO DO ESTADO", lead("indicacao", "MG", { tipo_organizacao: "Ente público", tipo_ente: "Governo do Estado", organizacao: "Governo do Estado de Minas Gerais" }), "Governo do Estado de Minas Gerais", "indicação de estado"],
  ];
  for (const [tipo, rotulo, l, nome, linha] of casos) {
    const c = S.classificarOrganizacao(l); assert.equal(c.tipo, tipo, nome); assert.equal(c.nome, nome, "nome exatamente como veio");
    assert.equal(S.linhaDoPerfil(l), linha, nome);
    const r = S.resumoLead({ ...l, linha }); assert.match(r, new RegExp(`TIPO DE CADASTRO: ${rotulo} — organização: "${nome.replace(/[.()]/g, "\\$&")}"`)); assert.doesNotMatch(r, /prefeitura ou de uma empresa\?/);
    assert.match(r, /não cite agenda, dia, hora, reserva, carteira nem honorários e não pergunte o contato do decisor/);
    if (tipo !== "prefeitura") assert.doesNotMatch(r, /TIPO DE CADASTRO: PREFEITURA/, nome + " nunca vira prefeitura");
  }
  assert.match(S.resumoLead({ ...casos[1][2], linha: "x" }), /nunca como prefeitura, mesmo com cidade\/UF/);
  // cidade/UF sozinha não define o tipo: pergunta uma vez
  const vago = lead("indicacao", "Paulínia/SP", {}); assert.equal(S.classificarOrganizacao(vago).tipo, null); assert.equal(S.linhaDoPerfil(vago), "indicação");
  assert.match(S.resumoLead({ ...vago, linha: "indicação" }), /Pergunte uma única vez: "Essa indicação é de uma prefeitura ou de uma empresa\?"/);
  // "Prefeitura" no nome sem "Municipal de" não basta; "Empresa privada" vence o nome
  assert.equal(S.classificarOrganizacao({ extras: { organizacao: "Prefeitura de Itu" } }).tipo, null);
  assert.equal(S.classificarOrganizacao({ extras: { tipo_organizacao: "Empresa privada", organizacao: "Prefeitura Municipal de Itu" } }).tipo, "empresa");
  // campos também aceitos no topo do envio
  assert.equal(S.normalizarLead({ nome: "Ana", fone: "19999990000", consentimento: true, tipo_organizacao: "Empresa privada" }).extras.tipo_organizacao, "Empresa privada");
  const p = Z.promptSistema({ zoe: {}, geral: {}, agora: new Date(), lead: { ...casos[3][2], linha: casos[3][4] } });
  assert.match(p, /TIPO DE CADASTRO: GOVERNO DO ESTADO/); assert.match(p, /cidade\/UF sozinha não define o tipo/);
});

await t("site: quem não chamou em 10 min recebe o convite (modelo aprovado) uma vez", async () => {
  const RUN = await import("../shared/zoe-run.mjs"); const { db: sdb } = await import("../shared/servidor.mjs");
  await sdb().sql`UPDATE registros SET criado_em = NOW() - INTERVAL '15 minutes' WHERE colecao = 'site_leads'`;
  await sdb().sql`UPDATE registros SET dados = jsonb_set(dados, '{criado}', to_jsonb((NOW() - INTERVAL '15 minutes')::text)) WHERE colecao = 'site_leads'`;
  // Carlos (indicação) chamou no WhatsApp depois do cadastro → não recebe convite
  await W(payload("5519988887777", "oi, vim do site", "wamid.SITE1"));
  const n0 = enviados.length; const r = await RUN.convidarLeads(new Date("2026-10-06T14:00:00-03:00"));
  const tpls = enviados.slice(n0).filter((m) => m.type === "template");
  assert.ok(tpls.some((m) => m.to === "5519997771234" && m.template.name === "primecorp_site" && JSON.stringify(m.template).includes("Ana")), "Ana convidada");
  assert.ok(!tpls.some((m) => m.to === "5519988887777"), "quem já falou não recebe modelo");
  assert.ok(r.convidados >= 1);
  const st = Object.fromEntries((await sdb().sql`SELECT dados FROM registros WHERE colecao='site_leads'`).map((x) => [x.dados.wa, x.dados.status]));
  assert.equal(st["5519997771234"], "convidado"); assert.equal(st["5519988887777"], "conversando");
  const n1 = enviados.length; await RUN.convidarLeads(new Date()); assert.equal(enviados.slice(n1).filter((m) => m.to === "5519997771234").length, 0, "não repete");
  const ab = globalThis.__aberto; globalThis.__aberto = false;
  assert.equal((await RUN.convidarLeads(new Date("2026-10-06T23:30:00-03:00"))).convidados, 0, "não chama de madrugada"); globalThis.__aberto = ab;
});

console.log(`\n${ok} testes de verificação e Zoe OK`);
await db.stop(); process.exit(0);
