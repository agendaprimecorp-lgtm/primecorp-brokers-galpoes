// Revisão semanal da PrimeCorp IA (Zoe): lê as conversas da semana e sugere melhorias no conhecimento. Nada muda sem aprovação.
import Anthropic from "@anthropic-ai/sdk";
import { db, env, salvarRegistro, obterRegistro, registrarEmissao, extrairJSON, MODELO_PADRAO, MODELOS_RESERVA, modeloIndisponivel } from "./servidor.mjs";
import { ZOE_PADRAO } from "./zoe-base.mjs";
import { enviar, enviarModelo, equipeWA } from "./whatsapp.mjs";

export const PROMPT_REVISAO = `Você é o supervisor de qualidade da PrimeCorp IA, assistente virtual de WhatsApp da PrimeCorp que atende somente a recomposição de receitas (convite PrimeCorp: análise preliminar para municípios, estados e empresas, indicações e agendamento de reunião com a equipe). Pedidos de imóveis não são atendidos neste canal: a assistente só informa o contato de imóveis.
Recebe o CONHECIMENTO ATUAL da PrimeCorp IA e as CONVERSAS DA SEMANA. Encontre onde ela errou, travou, repetiu pergunta, chamou a equipe por falta de informação, ou onde clientes perguntaram algo que o conhecimento não cobre.
Responda SOMENTE um objeto JSON:
{"resumo":"2 a 3 frases sobre a semana (volume, tipos de demanda, principais falhas)","sugestoes":[{"tipo":"faq"|"orientacao","titulo":"até 60 caracteres","texto":"o texto exato a ser acrescentado ao conhecimento (faq: '- Pergunta? Resposta.'; orientacao: instrução curta e objetiva para a PrimeCorp IA)","motivo":"por que, citando o que aconteceu nas conversas","exemplo":"trecho curto da conversa que motivou (sem telefone, sem endereço)"}]}
REGRAS: no máximo 6 sugestões, as de maior impacto primeiro. Nunca invente fatos da empresa (valores, honorários, prazos, resultados, endereços): se a resposta certa depende da equipe, a sugestão é uma orientação do tipo "Quando perguntarem X, diga que a equipe confirma e chame a equipe". Não repita o que já está no conhecimento. Nunca sugira afrouxar as regras de segurança (sigilo, negociação, LGPD, sem parecer jurídico/tributário, assistente virtual). Sem dados pessoais de clientes no texto sugerido. Se a semana não tiver nada a melhorar, devolva "sugestoes": [].`;

const DIAS7 = 7 * 864e5;

/** Monta o material da semana: conversas reais (sem simulação) com mensagens nos últimos 7 dias. */
export function digestSemana(convs, agora = Date.now()) {
  const desde = agora - DIAS7; const out = [];
  for (const c of convs) {
    if (c.simulacao || c.equipe) continue;
    const msgs = (c.msgs || []).filter((m) => Date.parse(m.t) >= desde);
    if (!msgs.some((m) => m.de === "cliente")) continue;
    out.push(`### Conversa ${out.length + 1}${c.precisa_humano ? " (pediu humano: " + (c.precisa_humano.motivo || "") + ")" : ""}\n` + msgs.slice(-25).map((m) => `${m.de === "cliente" ? "Cliente" : m.de === "zoe" ? "PrimeCorp IA" : "Equipe"}: ${String(m.texto || "[" + (m.midia || "mídia") + "]").replace(/\+?\d[\d\s().-]{8,}\d/g, "[tel]").slice(0, 400)}`).join("\n"));
    if (out.length >= 60) break;
  }
  return out;
}

const limpa = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");

/** Executa a revisão: grava sugestões pendentes e avisa a equipe. */
export async function revisarSemana({ agora = Date.now(), base = env("URL") } = {}) {
  const rows = await db().sql`SELECT id, dados FROM registros WHERE colecao = 'conversas' AND excluido = FALSE`;
  const convs = rows.map((r) => ({ ...r.dados, id: r.id }));
  const blocos = digestSemana(convs, agora);
  const semana = new Date(agora).toISOString().slice(0, 10);
  if (!blocos.length) { await registrarEmissao({ tipo: "zoe_revisao", conteudo: "Revisão semanal: sem conversas de clientes na semana." }).catch(() => null); return { conversas: 0, sugestoes: 0 }; }
  const cfg = (await obterRegistro("config", "zoe")) || {}; const z = { ...ZOE_PADRAO, ...cfg };
  const conhecimento = `${z.receitas || ZOE_PADRAO.receitas}\n\nORIENTAÇÕES DA EQUIPE\n${z.regras_extra || "(nenhuma)"}`;
  const client = new Anthropic(); const model = env("MODELO_IA") || MODELO_PADRAO; let r, ult;
  for (const m of [model, ...MODELOS_RESERVA].filter((x, i, a) => a.indexOf(x) === i)) {
    try { r = await client.messages.create({ model: m, max_tokens: 3000, messages: [{ role: "user", content: `${PROMPT_REVISAO}\n\nCONHECIMENTO ATUAL\n"""\n${conhecimento}\n"""\n\nCONVERSAS DA SEMANA (${blocos.length})\n"""\n${blocos.join("\n\n").slice(0, 120000)}\n"""` }] }); break; }
    catch (e) { ult = e; if (!modeloIndisponivel(e)) throw e; }
  }
  if (!r) throw ult;
  const j = extrairJSON((r.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n"));
  const sugs = (Array.isArray(j?.sugestoes) ? j.sugestoes : []).slice(0, 6)
    .map((s) => ({ tipo: s?.tipo === "faq" ? "faq" : "orientacao", titulo: limpa(s?.titulo, 80), texto: limpa(s?.texto, 600), motivo: limpa(s?.motivo, 400), exemplo: limpa(s?.exemplo, 300) }))
    .filter((s) => s.texto);
  const t = Date.now().toString(36);
  for (const [i, s] of sugs.entries()) await salvarRegistro("zoe_sugestoes", `sg_${t}_${i}`, { ...s, status: "pendente", semana, criado: new Date().toISOString() });
  const resumo = limpa(j?.resumo, 600);
  await registrarEmissao({ tipo: "zoe_revisao", conteudo: `Revisão semanal: ${blocos.length} conversa(s), ${sugs.length} sugestão(ões). ${resumo}`, meta: { semana } }).catch(() => null);
  if (sugs.length) {
    const msg = `🤖 PrimeCorp IA · Revisão semanal\n${resumo}\n\n${sugs.length} sugestão(ões) aguardando sua aprovação:\n${sugs.map((s, i) => `${i + 1}. ${s.titulo || s.texto.slice(0, 60)}`).join("\n")}\n\nAprove em: ${base || "o app"} → Assistente → Revisão`;
    for (const n of equipeWA()) { try { await enviar(n, msg); } catch { const tpl = env("ZOE_MODELO_AVISO") || "primecorp_aviso"; if (tpl) await enviarModelo(n, tpl, [msg.slice(0, 900)]).catch(() => null); } }
  }
  return { conversas: blocos.length, sugestoes: sugs.length, resumo };
}

/** Aprova (opcionalmente com texto editado) ou recusa uma sugestão. Aprovar acrescenta ao conhecimento da PrimeCorp IA. */
export async function decidirSugestao(id, acao, { texto, por } = {}) {
  const s = await obterRegistro("zoe_sugestoes", id);
  if (!s) throw Object.assign(new Error("Sugestão não encontrada."), { status: 404 });
  if (s.status !== "pendente") throw Object.assign(new Error("Sugestão já decidida."), { status: 409 });
  const quando = new Date().toISOString();
  if (acao === "recusar") { await salvarRegistro("zoe_sugestoes", id, { ...s, status: "recusada", decidido_por: por, decidido_em: quando }); return { status: "recusada" }; }
  const final = limpa(texto ?? s.texto, 600); if (!final) throw Object.assign(new Error("Texto vazio."), { status: 400 });
  const cfg = (await obterRegistro("config", "zoe")) || {};
  const novo = { ...cfg };
  // FAQ e orientação vão para as orientações da equipe: é o que o atendimento ao cliente (só receitas) lê.
  novo.regras_extra = `${String(cfg.regras_extra || "").trimEnd()}${cfg.regras_extra ? "\n" : ""}- ${final.replace(/^-\s*/, "")}`;
  novo.atualizado_por = por || "revisão"; await salvarRegistro("config", "zoe", novo);
  await salvarRegistro("zoe_sugestoes", id, { ...s, texto: final, status: "aprovada", decidido_por: por, decidido_em: quando });
  return { status: "aprovada" };
}
