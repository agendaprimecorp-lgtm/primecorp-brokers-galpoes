// Liga o cérebro da Zoe ao banco (Netlify Database) e ao WhatsApp.
import { db, env, obterRegistro, salvarRegistro, registrarEmissao } from "./servidor.mjs";
import { responder, anexarMsg, fmtHora } from "./zoe.mjs";
import { enviar, enviarModelo, equipeWA, janelaAberta } from "./whatsapp.mjs";
import { transcreverPendentes } from "./audio.mjs";

/** Contexto com leitura em memória e gravação adiada (sandbox = simulação, nada é gravado fora da conversa). */
export async function criarContexto({ base, sandbox = false } = {}) {
  const cache = {}; const pend = []; const avisos = [];
  const carregar = async (col) => {
    if (!cache[col]) { const rows = await db().sql`SELECT id, dados FROM registros WHERE colecao = ${col} AND excluido = FALSE`; cache[col] = rows.map((r) => ({ ...r.dados, id: r.id })); }
    return cache[col];
  };
  for (const c of ["ofertas", "anuncios", "briefings", "contatos", "agenda", "negocios", "conversas"]) await carregar(c);
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
      for (const a of avisos) {
        await registrarEmissao({ tipo: "zoe_aviso", conteudo: a.texto, meta: { conversa: a.conv, urgente: a.urgente } }).catch(() => null);
        for (const n of equipeWA()) {
          try { await enviar(n, "🤖 Zoe · " + a.texto); }
          catch { const tpl = env("ZOE_MODELO_AVISO") || "zoe_aviso"; if (tpl) await enviarModelo(n, tpl, [a.texto.slice(0, 900)]).catch(() => null); }
        }
      }
      return { gravados: pend.length, avisos };
    },
  };
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
  catch (e) { console.error("Zoe:", e); ctx.avisar(`Zoe com erro na conversa ${conv.nome || "+" + wa}: ${e?.message || e}`, conv, true); r = { texto: "Tive um problema técnico agora. Já avisei a equipe, que responde por aqui em breve.", botoes: [], acoes: ["erro"] }; conv.precisa_humano = { motivo: "erro técnico da Zoe", em: new Date().toISOString() }; }

  let enviadoId = null, falha = null;
  if (r.texto && janelaAberta(conv)) { try { enviadoId = await enviar(wa, r.texto, r.botoes); } catch (e) { falha = String(e?.message || e); } }
  await ctx.gravar();
  // relê para não perder mensagens que chegaram durante a resposta
  const atual = (await obterRegistro("conversas", wa)) || conv0;
  const novas = (atual.msgs || []).filter((m) => !(conv0.msgs || []).some((x) => x.id === m.id));
  const fin = { ...atual, contato: conv.contato || atual.contato || null, nome: conv.nome || atual.nome, briefings: conv.briefings || atual.briefings, precisa_humano: conv.precisa_humano ?? atual.precisa_humano ?? null, modo: atual.modo === "humano" && atual.modo_em !== conv0.modo_em ? "humano" : conv.modo || "zoe", optout: !!(conv.optout || atual.optout), processando: null, msgs: conv0.msgs || [] };
  if (r.texto) anexarMsg(fin, { id: enviadoId || "z" + Date.now().toString(36), de: "zoe", t: new Date().toISOString(), texto: r.texto + (r.botoes?.length ? "\n[" + r.botoes.join(" | ") + "]" : ""), acoes: r.acoes, ...(falha ? { falha } : {}) });
  for (const m of novas) anexarMsg(fin, m);
  await salvarRegistro("conversas", wa, fin);
  return { texto: r.texto, acoes: r.acoes, falha, reprocessar: novas.some((m) => m.de === "cliente") };
}

export { fmtHora };
