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
await t("Zoe: busca de galpão registra demanda, encontra opção sem endereço e responde com botões", async () => {
  const visto = [];
  globalThis.__zoe = (req) => { const last = req.messages[req.messages.length - 1];
    if (typeof last.content === "string") { visto.push(req.system); return passo("registrar_demanda", { nome: "Carlos", empresa: "Log Z", tipo: "Galpão", operacao: "Locação", cidades: "Sumaré, Hortolândia", area_min: 5000, area_max: 7000 }); }
    const res = JSON.parse(last.content[0].content);
    if (res.briefing) return passo("buscar_imoveis", { tipo: "Galpão", operacao: "Locação", cidades: "Sumaré", area_min: 5000, area_max: 7000 });
    visto.push(res); return fala("Achei 1 opção (PC-0001) com área entre 6 e 7 mil m². Quer agendar uma conversa?\n[[botoes: Agendar | Ver mais | Falar com corretor]]"); };
  const r = await zbg(new Request("https://pc.test/.netlify/functions/zoe-background", { method: "POST", headers: SEG, body: JSON.stringify({ wa: "5519911112222", espera: 0 }) }));
  assert.match(visto[0], /assistente virtual/); assert.match(visto[0], /LGPD/);
  assert.equal(visto[1].encontrados, 1); assert.equal(visto[1].imoveis[0].codigo, "PC-0001"); assert.ok(!JSON.stringify(visto[1]).includes("Dom Barreto")); assert.ok(!JSON.stringify(visto[1]).includes("45678"));
  const ult = enviados.filter((m) => m.to === "5519911112222").pop(); assert.ok(ult); assert.equal(ult.type, "interactive"); assert.equal(ult.interactive.action.buttons.length, 3);
  const d = await J(await api(R("GET", "/api/dados"), ctx()));
  const b = d.j.briefings.find((x) => x.origem === "WhatsApp · Zoe"); assert.ok(b); assert.equal(b.areaMin, "5000"); assert.equal(b.operacao, "Locação");
  const c = d.j.contatos.find((x) => x.telefone === "+5519911112222"); assert.equal(c.empresa, "Log Z"); assert.equal(b.cliente, c.id);
  const cv = d.j.conversas.find((x) => x.id === "5519911112222"); assert.equal(cv.ultima_de, "zoe"); assert.equal(cv.contato, c.id); assert.ok(!cv.processando);
  const e = await J(await api(R("GET", "/api/emissoes"), ctx())); assert.ok(e.j.emissoes.some((x) => x.tipo === "zoe_aviso" && /Nova demanda/.test(x.conteudo)));
  assert.ok(enviados.some((m) => m.to === "5519998051985" && /Nova demanda/.test(m.text?.body || "")), "equipe avisada no WhatsApp");
});
await t("Zoe: agenda só em horário livre e avisa a equipe", async () => {
  const conv = { id: "5519900000001", msgs: [{ de: "cliente", t: new Date().toISOString(), texto: "quero marcar" }] };
  const mem = { agenda: [], contatos: [], ofertas: [], anuncios: [], briefings: [], conversas: [], negocios: [] }; const av = [];
  const c = { agora: new Date("2026-10-05T12:00:00Z"), base: "https://pc.test", cfg: { zoe: {}, geral: {} }, listar: (k) => mem[k] || [], salvar: (k, id, d) => { const l = mem[k]; const i = l.findIndex((x) => x.id === id); if (i >= 0) l[i] = { ...d, id }; else l.push({ ...d, id }); }, avisar: (x) => av.push(x) };
  const hs = Z.executar(c, conv, "horarios_livres", { dias_a_frente: 2 }); assert.ok(hs.horarios.length >= 3);
  assert.ok(Z.executar(c, conv, "agendar", { inicio: "2026-10-05T03:00", tipo: "Ligação", assunto: "x", nome: "Ana" }).erro);
  const ok1 = Z.executar(c, conv, "agendar", { inicio: hs.horarios[0].inicio, tipo: "Reunião (vídeo)", assunto: "Galpão 6 mil m²", nome: "Ana" }); assert.ok(ok1.ok); assert.match(ok1.confirmado, /segunda/);
  assert.ok(Z.executar(c, conv, "agendar", { inicio: hs.horarios[0].inicio, tipo: "Ligação", assunto: "y", nome: "Ana" }).erro, "não marca duas vezes");
  assert.equal(Z.executar(c, conv, "meus_agendamentos", {}).agendamentos.length, 1);
  assert.ok(Z.executar(c, conv, "cancelar_agendamento", { id: ok1.id }).ok); assert.equal(mem.agenda[0].status, "cancelado");
  assert.ok(av.some((x) => /Agendado pela Zoe/.test(x)));
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
  assert.match(sys, /MODO EQUIPE/); assert.ok(enviados.some((m) => m.to === "5519998051985" && /Briefings ativos: 1/.test(m.text?.body || "")));
});
await t("Zoe: simulador não grava briefing de verdade", async () => {
  globalThis.__zoe = (req) => { const last = req.messages[req.messages.length - 1]; if (typeof last.content === "string") return passo("registrar_demanda", { nome: "Teste", tipo: "Casa", operacao: "Venda" }); return fala("Registrado."); };
  const antes = (await J(await api(R("GET", "/api/dados"), ctx()))).j.briefings.length;
  const r = await J(await api(R("POST", "/api/zoe/simular", { texto: "quero comprar uma casa" }), ctx())); assert.equal(r.s, 200); assert.equal(r.j.resposta, "Registrado."); assert.ok(r.j.simulado.some((x) => x.startsWith("briefings/")));
  assert.equal((await J(await api(R("GET", "/api/dados"), ctx()))).j.briefings.length, antes);
});
await t("Zoe: botões e limpeza da resposta", async () => {
  const f = Z.finalizar("Olá!\n[[botoes: Busco imóvel | Tenho um imóvel | Sou corretor(a) parceiro]]"); assert.equal(f.texto, "Olá!"); assert.equal(f.botoes.length, 3); assert.ok(f.botoes.every((b) => b.length <= 20));
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
  const faq0 = d.config.find((c) => c.id === "zoe")?.faq;
  assert.equal((await api(R("PUT", "/api/dados/zoe_sugestoes/" + pend[0].id, { status: "aprovada" }), ctx())).status, 403, "não aprova por fora");
  const fq = pend.find((x) => x.tipo === "faq"), or = pend.find((x) => x.tipo === "orientacao");
  assert.equal((await api(R("POST", "/api/zoe/sugestao", { id: fq.id, acao: "aprovar", texto: "- Fazem visita no sábado? Sim, das 9h às 12h, com agendamento." }), ctx())).status, 200);
  assert.equal((await api(R("POST", "/api/zoe/sugestao", { id: or.id, acao: "recusar" }), ctx())).status, 200);
  assert.equal((await api(R("POST", "/api/zoe/sugestao", { id: or.id, acao: "aprovar" }), ctx())).status, 409, "já decidida");
  d = (await J(await api(R("GET", "/api/dados"), ctx()))).j; const z = d.config.find((c) => c.id === "zoe");
  assert.match(z.faq, /das 9h às 12h/); assert.ok(z.faq.length > (faq0 || "").length); assert.ok(!/20 mil/.test(z.regras_extra || ""), "recusada não entra");
  assert.match(Z.promptSistema({ zoe: z, geral: {}, agora: new Date() }), /das 9h às 12h/, "a Zoe já usa");
  globalThis.__user = { email: "outra@x.com" };
  globalThis.__user = { email: "contato@primecorpconsultoria.com.br" }; delete globalThis.__revisao;
});
await t("modelo: padrão novo com reserva automática", async () => {
  const S = await import("../shared/servidor.mjs"); assert.equal(S.MODELO_PADRAO, "claude-sonnet-5-5");
  globalThis.__modelos = []; globalThis.__modelosFora = ["claude-sonnet-5-5"]; globalThis.__zoe = () => fala("ok");
  const r = await Z.responder({ agora: new Date(), cfg: { zoe: {}, geral: {} }, listar: () => [], salvar: () => {}, avisar: () => {}, cliente: new (await import("./mocks/anthropic.mjs")).default() }, { id: "m", msgs: [{ de: "cliente", t: new Date().toISOString(), texto: "oi" }] });
  assert.equal(r.texto, "ok"); assert.deepEqual(globalThis.__modelos.slice(0, 2), ["claude-sonnet-5-5", "claude-sonnet-4-5"]); globalThis.__modelosFora = [];
});

await t("Zoe: frente tributária (prefeituras e parceiros) no conhecimento", async () => {
  const p = Z.promptSistema({ zoe: {}, geral: {}, agora: new Date() });
  for (const x of [/RECUPERAÇÃO DE CRÉDITOS PARA MUNICÍPIOS/, /IRRF/, /RAT\/FAP/, /FPM\/FPE/, /exclusivamente por êxito/, /H\) PARCEIRO TRIBUTÁRIO/, /Prefeituras \| Parceria tributária/]) assert.match(p, x);
  const p2 = Z.promptSistema({ zoe: { servicos: "texto antigo salvo" }, geral: {}, agora: new Date() }); assert.match(p2, /tema 1130/, "vale mesmo com conhecimento antigo salvo");
  const salvos = []; const ctxZ = { agora: new Date(), cfg: { zoe: {}, geral: {} }, listar: () => [], salvar: (col, id, d) => salvos.push([col, d]), avisar: () => {} };
  Z.executar(ctxZ, { id: "5511999990000" }, "salvar_contato", { nome: "Dra. Paula", cargo: "Advogada OAB/MG 123", perfil: "Parceiro tributário", cidade: "Sul de Minas", observacoes: "atua com 12 municípios" }, false);
  const c = salvos.find((x) => x[0] === "contatos")[1]; assert.equal(c.tipo, "Parceiro tributário"); assert.equal(c.cargo, "Advogada OAB/MG 123"); assert.match(c.obs, /12 municípios/);
});

await t("equipe ajusta horário pelo WhatsApp (seg-qui 9-18, sex 9-16)", async () => {
  const salvos = []; const ctxZ = { agora: new Date("2026-10-05T12:00:00-03:00"), cfg: { zoe: { faq: "x" }, geral: {} }, listar: () => [], salvar: (c, id, d) => salvos.push([c, id, d]), avisar: () => {} };
  assert.ok(Z.executar(ctxZ, { id: "1" }, "ajustar_horario", { dias: "seg a sex" }, false).erro, "cliente não altera");
  const r = Z.executar(ctxZ, { id: "1" }, "ajustar_horario", { dias: "seg a sex", inicio: "9h", fim: "18:00", fim_por_dia: "sex=16:00" }, true);
  assert.equal(r.horario, "seg 09:00–18:00, ter 09:00–18:00, qua 09:00–18:00, qui 09:00–18:00, sex 09:00–16:00");
  const cfg = salvos.at(-1)[2]; assert.equal(cfg.faq, "x", "não apaga o resto"); assert.equal(cfg.horario.fim_dia[5], "16:00");
  const sexta = Z.horariosLivres(cfg, [], new Date("2026-10-08T20:00:00-03:00"), { dias: 2, max: 20 }).map((d) => d.toISOString()).filter((x) => x.startsWith("2026-10-09"));
  assert.ok(sexta.length && sexta.every((x) => x < "2026-10-09T19:00"), "sexta acaba às 16h (19h UTC)");
  assert.match(Z.promptSistema({ zoe: cfg, geral: {}, agora: new Date() }), /sex 09:00–16:00/);
});
await t("modelo de aviso: criação na 360dialog e envio fora das 24 h sem quebra de linha", async () => {
  Object.assign(process.env, { WHATSAPP_PROVEDOR: "360dialog" }); const ant = globalThis.__fetchWA; const reqs = [];
  globalThis.__fetchWA = async (url, op) => { reqs.push([String(url), JSON.parse(op.body)]); return new Response(JSON.stringify({ status: "PENDING" }), { status: 200 }); };
  const r = await J(await api(R("POST", "/api/zoe/modelo-aviso"), ctx())); assert.equal(r.s, 200); assert.equal(r.j.nome, "zoe_aviso");
  assert.equal(reqs[0][0], "https://waba-v2.360dialog.io/v1/configs/templates"); assert.equal(reqs[0][1].category, "UTILITY"); assert.match(reqs[0][1].components[0].text, /\{\{1\}\}/);
  const { enviarModelo } = await import("../shared/whatsapp.mjs"); await enviarModelo("5519998051985", "zoe_aviso", ["linha 1\nlinha   2"]);
  assert.equal(reqs.at(-1)[1].template.components[0].parameters[0].text, "linha 1 linha 2");
  globalThis.__fetchWA = ant; delete process.env.WHATSAPP_PROVEDOR;
});

console.log(`\n${ok} testes de verificação e Zoe OK`);
await db.stop(); process.exit(0);
