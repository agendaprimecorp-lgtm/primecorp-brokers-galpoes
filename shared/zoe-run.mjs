// Liga o cérebro da Zoe ao banco (Netlify Database) e ao WhatsApp.
import { db, env, obterRegistro, salvarRegistro, registrarEmissao } from "./servidor.mjs";
import { responder, anexarMsg, fmtHora, estaAberto, proximaAbertura } from "./zoe.mjs";
import { enviar, enviarModelo, enviarImagem, equipeWA, janelaAberta } from "./whatsapp.mjs";
import { transcreverPendentes } from "./audio.mjs";

/** Contexto com leitura em memória e gravação adiada (sandbox = simulação, nada é gravado fora da conversa). */
export async function criarContexto({ base, sandbox = false } = {}) {
  const cache = {}; const pend = []; const avisos = [];
  const carregar = async (col) => {
    if (!cache[col]) { const rows = await db().sql`SELECT id, dados FROM registros WHERE colecao = ${col} AND excluido = FALSE`; cache[col] = rows.map((r) => ({ ...r.dados, id: r.id })); }
    return cache[col];
  };
  for (const c of ["ofertas", "anuncios", "briefings", "contatos", "agenda", "negocios", "conversas", "b2g", "site_leads"]) await carregar(c);
  const cfgRows = await db().sql`SELECT id, dados FROM registros WHERE colecao = 'config' AND excluido = FALSE`;
  const cfg = Object.fromEntries(cfgRows.map((r) => [r.id, r.dados]));
  return {
    agora: new Date(), base, sandbox, cfg: { zoe: cfg.zoe || {}, geral: cfg.geral || {} }, modelo: env("MODELO_IA") || undefined,
    listar: (col) => cache[col] || [],
    salvar: (col, id, dados) => { const l = (cache[col] ||= []); const i = l.findIndex((x) => x.id === id); const v = { ...dados, id }; if (i >= 0) l[i] = v; else l.push(v); pend.push([col, id, dados]); },
    avisar: (texto, conv, urgente) => avisos.push({ texto, conv: conv?.id, urgente: !!urgente }),
    async gravar() {
      if (sandbox) return { gravados: 0, simulado: pend.map(([c, id]) => `${c}/${id}`), avisos };
      for (const [c, id, d] of pend) { const { id: _x, ...dados } = d; await salvarRegistro(c, id, dados); }
      const aberto = globalThis.__aberto ?? estaAberto(cfg.zoe, new Date()); // __aberto: só testes
      for (const a of avisos) {
        await registrarEmissao({ tipo: "zoe_aviso", conteudo: a.texto, meta: { conversa: a.conv, urgente: a.urgente } }).catch(() => null);
        // fora do expediente só o que é URGENTE vai na hora; o resto entra na fila e chega no início do expediente
        if (!aberto && !/^URGENTE/.test(a.texto)) { await salvarRegistro("zoe_fila", "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), { texto: a.texto, conversa: a.conv || null, em: new Date().toISOString() }).catch(() => null); continue; }
        await avisarEquipe(a.texto);
      }
      return { gravados: pend.length, avisos };
    },
  };
}

/** Mensagem para Rodrigo/Joselia (texto livre na janela de 24 h; fora dela, modelo aprovado). */
export async function avisarEquipe(texto) {
  for (const n of equipeWA()) {
    try { await enviar(n, "🤖 Assistente PrimeCorp · " + texto); }
    catch { const tpl = env("ZOE_MODELO_AVISO") || "primecorp_aviso"; if (tpl) await enviarModelo(n, tpl, [texto.slice(0, 900)]).catch(() => null); }
  }
}

/** Aviso à equipe respeitando o expediente (fora dele vai para a fila). */
export async function avisarOuEnfileirar(texto, { urgente = false } = {}) {
  const cfgRows = await db().sql`SELECT dados FROM registros WHERE colecao = 'config' AND id = 'zoe' AND excluido = FALSE`;
  const aberto = globalThis.__aberto ?? estaAberto(cfgRows[0]?.dados || {}, new Date());
  await registrarEmissao({ tipo: "zoe_aviso", conteudo: texto, meta: { urgente } }).catch(() => null);
  if (aberto || urgente) return avisarEquipe(texto);
  await salvarRegistro("zoe_fila", "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), { texto, em: new Date().toISOString() });
}

/** Leads do site que não chamaram no WhatsApp em 10 min: a assistente chama primeiro com o modelo aprovado (8h–20h). */
export async function convidarLeads(agora = new Date()) {
  const h = Number(new Date(agora.getTime() - 3 * 3600e3).toISOString().slice(11, 13));
  if (!globalThis.__aberto && (h < 8 || h >= 20)) return { convidados: 0, motivo: "fora da janela de contato" };
  const rows = await db().sql`SELECT id, dados FROM registros WHERE colecao = 'site_leads' AND excluido = FALSE AND dados->>'status' = 'novo' AND criado_em < NOW() - INTERVAL '10 minutes' AND criado_em > NOW() - INTERVAL '48 hours'`;
  const tpl = env("ZOE_MODELO_SITE") || "primecorp_site"; let n = 0;
  for (const r of rows) {
    const l = r.dados; const conv = await obterRegistro("conversas", l.wa);
    const falou = (conv?.msgs || []).some((m) => m.de === "cliente" && m.t >= l.criado);
    if (falou) { await salvarRegistro("site_leads", r.id, { ...l, status: "conversando" }); continue; }
    try { await enviarModelo(l.wa, tpl, [String(l.nome || "").split(" ")[0] || "tudo bem", l.linha || "seu atendimento"]); await salvarRegistro("site_leads", r.id, { ...l, status: "convidado", convidado_em: new Date().toISOString() }); n++; }
    catch (e) { await salvarRegistro("site_leads", r.id, { ...l, status: "falha_convite", erro: String(e?.message || e).slice(0, 200) }); }
  }
  return { convidados: n };
}

/** Início do expediente: entrega de uma vez o que chegou fora do horário. */
export async function entregarFila(agora = new Date()) {
  const cfgRows = await db().sql`SELECT dados FROM registros WHERE colecao = 'config' AND id = 'zoe' AND excluido = FALSE`;
  const cfgZoe = cfgRows[0]?.dados || {};
  if (!(globalThis.__aberto ?? estaAberto(cfgZoe, agora))) return { entregues: 0, motivo: "fora do horário" };
  const fila = await db().sql`SELECT id, dados FROM registros WHERE colecao = 'zoe_fila' AND excluido = FALSE ORDER BY criado_em`;
  if (!fila.length) return { entregues: 0 };
  const linhas = fila.map((r) => "• " + String(r.dados.texto || "").slice(0, 300));
  await avisarEquipe(`Início do expediente · fora do horário chegaram ${fila.length} aviso(s):\n${linhas.join("\n").slice(0, 3500)}`);
  for (const r of fila) await db().sql`UPDATE registros SET excluido = TRUE, atualizado_em = NOW() WHERE colecao = 'zoe_fila' AND id = ${r.id}`;
  return { entregues: fila.length };
}

/** Processa a última mensagem da conversa e responde no WhatsApp. */
export async function processarConversa(wa, { base, esperaMs = 2500 } = {}) {
  if (esperaMs) await new Promise((r) => setTimeout(r, esperaMs)); // agrupa mensagens enviadas em sequência
  const conv0 = await obterRegistro("conversas", wa);
  if (!conv0 || conv0.ultima_de !== "cliente" || conv0.optout) return { pulou: "nada a responder" };
  if (conv0.processando && Date.now() - Date.parse(conv0.processando) < 60e3) return { pulou: "em andamento" };
  const equipe = !!conv0.equipe;
  const ctx = await criarContexto({ base });
  const retomarH = Number(ctx.cfg.zoe.retomar_h ?? 12); // resposta pelo celular pausa a Zoe; sem nova resposta humana nesse prazo, ela retoma
  const ultHumano = [...(conv0.msgs || [])].reverse().find((m) => m.de === "humano");
  const humanoAtivo = conv0.modo === "humano" && !(conv0.modo_por === "celular" && retomarH > 0 && ultHumano && Date.now() - Date.parse(ultHumano.t) > retomarH * 3600e3);
  if (!equipe && (humanoAtivo || ctx.cfg.zoe.ativa === false)) return { pulou: "atendimento humano" };
  const hoje = (conv0.msgs || []).filter((m) => m.de === "zoe" && Date.now() - Date.parse(m.t) < 864e5).length;
  if (!equipe && hoje >= 60) return { pulou: "limite diário" };
  await transcreverPendentes(conv0); // áudios do cliente viram texto antes da Zoe ler
  await salvarRegistro("conversas", wa, { ...conv0, processando: new Date().toISOString() });

  const conv = { ...JSON.parse(JSON.stringify(conv0)), id: wa };
  if (conv.modo === "humano" && !humanoAtivo && !equipe) { conv.modo = "zoe"; conv.modo_por = "retomada automática"; }
  let r;
  try { r = await responder(ctx, conv, { equipe }); }
  catch (e) { console.error("Zoe:", e); ctx.avisar(`Assistente com erro na conversa ${conv.nome || "+" + wa}: ${e?.message || e}`, conv, true); r = { texto: "Tive um problema técnico agora. Já avisei a equipe, que responde por aqui em breve.", botoes: [], acoes: ["erro"] }; conv.precisa_humano = { motivo: "erro técnico da assistente", em: new Date().toISOString() }; }

  let enviadoId = null, falha = null;
  // primeiro contato: cartão de boas-vindas com a atendente virtual (uma vez por conversa)
  const primeiro = !equipe && !(conv0.msgs || []).some((m) => m.de === "zoe" || m.de === "humano") && !conv0.boas_vindas;
  if (primeiro && r.texto && ctx.cfg.zoe.boas_vindas_imagem !== false && base && janelaAberta(conv)) {
    try { await enviarImagem(wa, new URL("/marca/primecorp-boas-vindas.jpg", base).toString()); conv.boas_vindas = new Date().toISOString(); } catch (e) { console.error("Boas-vindas:", e?.message || e); }
  }
  if (r.texto && janelaAberta(conv)) { try { enviadoId = await enviar(wa, r.texto, r.botoes); } catch (e) { falha = String(e?.message || e); } }
  await ctx.gravar();
  // relê para não perder mensagens que chegaram durante a resposta
  const atual = (await obterRegistro("conversas", wa)) || conv0;
  const novas = (atual.msgs || []).filter((m) => !(conv0.msgs || []).some((x) => x.id === m.id));
  const fin = { ...atual, ...(conv.boas_vindas ? { boas_vindas: conv.boas_vindas } : {}), contato: conv.contato || atual.contato || null, nome: conv.nome || atual.nome, briefings: conv.briefings || atual.briefings, precisa_humano: conv.precisa_humano ?? atual.precisa_humano ?? null, modo: atual.modo === "humano" && atual.modo_em !== conv0.modo_em ? "humano" : conv.modo || "zoe", optout: !!(conv.optout || atual.optout), processando: null, msgs: conv0.msgs || [] };
  if (r.texto) anexarMsg(fin, { id: enviadoId || "z" + Date.now().toString(36), de: "zoe", t: new Date().toISOString(), texto: r.texto + (r.botoes?.length ? "\n[" + r.botoes.join(" | ") + "]" : ""), acoes: r.acoes, ...(falha ? { falha } : {}) });
  for (const m of novas) anexarMsg(fin, m);
  await salvarRegistro("conversas", wa, fin);
  return { texto: r.texto, acoes: r.acoes, falha, reprocessar: novas.some((m) => m.de === "cliente") };
}

export { fmtHora };
