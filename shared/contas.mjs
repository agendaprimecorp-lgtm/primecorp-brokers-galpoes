// Contas de clientes da Propto: planos, teste grátis, situação, limites de uso e dados separados por conta.
// A operação da PrimeCorp continua na tabela "registros"; cada cliente usa só "registros_conta" filtrado pela própria conta.
import crypto from "node:crypto";
import { db } from "./servidor.mjs";

export const PLANOS = {
  corretor: { nome: "Corretor", preco: 197, anual: 1970, usuarios: 1, imoveis: 20, docs: 5, ia: 600, resumo: "1 usuário · 20 imóveis por mês · 5 leituras de documento" },
  imobiliaria: { nome: "Imobiliária", preco: 490, anual: 4900, usuarios: 5, imoveis: 60, docs: 20, ia: 2000, resumo: "5 usuários · 60 imóveis por mês · 20 leituras de documento · envio ao site e portais" },
  plus: { nome: "Imobiliária Plus", preco: 890, anual: 8900, usuarios: 15, imoveis: 200, docs: 80, ia: 6000, resumo: "15 usuários · 200 imóveis por mês · 80 leituras de documento · suporte prioritário" },
};
export const TESTE = {
  dias: 30,
  corretor: { usuarios: 1, imoveis: 5, docs: 3, ia: 150 },
  imobiliaria: { usuarios: 3, imoveis: 15, docs: 3, ia: 300 },
};
/** Desconto de fundador: quem assina durante o teste paga 40% a menos por 12 meses (só no mensal). */
export const FUNDADOR = { desconto: 0.4, meses: 12 };
export const CARENCIA_DIAS = 3; // depois do vencimento, continua usando normalmente
export const SUSPENSAO_DIAS = 15; // depois do vencimento: anúncios saem do ar
export const ANUNCIOS_APOS_TESTE_DIAS = 7; // teste acabou sem assinatura: anúncios ficam no ar por mais 7 dias
export const COLECOES_CONTA = ["ofertas", "anuncios", "contatos", "config"];
export const RECURSOS = { imoveis: "imóveis captados", docs: "leituras de documento", ia: "usos da inteligência artificial" };

const DIA = 864e5;
const t = (d) => (d ? new Date(d).getTime() : NaN);
export const novoIdConta = () => "ct_" + crypto.randomBytes(6).toString("hex");
export const precoFundador = (plano) => Math.round(PLANOS[plano].preco * (1 - FUNDADOR.desconto) * 100) / 100;
export const brl = (v) => "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 });
export const somarMeses = (iso, n) => { const d = new Date(iso); const dia = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n); const fim = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(dia, fim)); return d.toISOString(); };
export const dataISO = (d) => new Date(d).toISOString().slice(0, 10);

/** Situação calculada pelas datas (não depende de rotina agendada). */
export function situacao(c, agora = new Date()) {
  const now = agora.getTime();
  const fimTeste = t(c.teste_fim);
  const diasTeste = Math.ceil((fimTeste - now) / DIA);
  if (c.cancelada_em) return { codigo: "cancelada", rotulo: "Cancelada", escrita: false, anuncios: false, dias: 0, msg: "Conta cancelada. Seus dados continuam disponíveis para consulta e exportação." };
  if (c.suspensa) return { codigo: "suspensa", rotulo: "Suspensa", escrita: false, anuncios: false, dias: 0, msg: "Conta suspensa pela equipe Propto. Fale com a gente pelo WhatsApp." };
  const assinada = !!(c.asaas && c.asaas.assinatura);
  const pago = t(c.pago_ate);
  if (!assinada && !(pago > 0)) {
    if (now < fimTeste) return { codigo: "teste", rotulo: "Teste grátis", escrita: true, anuncios: true, dias: diasTeste, msg: `Teste grátis: ${diasTeste} dia(s) restante(s).` };
    return { codigo: "expirada", rotulo: "Teste encerrado", escrita: false, anuncios: now < fimTeste + ANUNCIOS_APOS_TESTE_DIAS * DIA, dias: 0, msg: "O teste grátis terminou. Escolha um plano para continuar captando: seus imóveis e anúncios continuam aqui." };
  }
  const base = Math.max(pago > 0 ? pago : 0, assinada || !(pago > 0) ? fimTeste : 0);
  const pagando = pago > 0 && pago > fimTeste - DIA;
  if (c.cancelamento_em && now > base) return { codigo: "cancelada", rotulo: "Assinatura cancelada", escrita: false, anuncios: false, dias: 0, msg: "Assinatura cancelada. Seus dados continuam disponíveis para consulta e exportação; assine de novo quando quiser." };
  if (now <= base) {
    const d = Math.ceil((base - now) / DIA);
    return pagando ? { codigo: "ativa", rotulo: "Ativa", escrita: true, anuncios: true, dias: d, msg: "" }
      : { codigo: "teste", rotulo: "Teste grátis (plano escolhido)", escrita: true, anuncios: true, dias: d, msg: `Teste grátis: ${d} dia(s) restante(s). Plano escolhido; a primeira cobrança vence no fim do teste.` };
  }
  if (now <= base + CARENCIA_DIAS * DIA) return { codigo: "atrasada", rotulo: "Pagamento pendente", escrita: true, anuncios: true, dias: 0, msg: "Pagamento pendente. Pague a fatura para não interromper o uso." };
  if (now <= base + SUSPENSAO_DIAS * DIA) return { codigo: "atrasada", rotulo: "Pagamento em atraso", escrita: false, anuncios: true, dias: 0, msg: "Pagamento em atraso: o sistema está só para consulta. Pague a fatura para voltar a captar." };
  return { codigo: "suspensa", rotulo: "Suspensa por falta de pagamento", escrita: false, anuncios: false, dias: 0, msg: "Conta suspensa por falta de pagamento: anúncios fora do ar. Pague a fatura para reativar." };
}

/** Limites valem pelo plano só depois do primeiro pagamento; antes, os do teste. */
export function limites(c) {
  if (c.pago_ate && t(c.pago_ate) > t(c.teste_fim) - DIA && PLANOS[c.plano]) return { ...PLANOS[c.plano], fonte: "plano" };
  return { ...(TESTE[c.tipo] || TESTE.corretor), fonte: "teste" };
}
export function periodoUso(c, agora = new Date()) { return limites(c).fonte === "teste" ? "teste" : agora.toISOString().slice(0, 7); }

/* ---------------- banco ---------------- */
export async function obterConta(id) {
  const r = await db().sql`SELECT id, dados, criado_em FROM contas WHERE id = ${id}`;
  return r[0] ? { ...r[0].dados, id: r[0].id, criado_em: r[0].criado_em } : null;
}
export async function gravarConta(id, dados) {
  const { id: _i, criado_em: _c, membro: _m, ...d } = dados;
  await db().sql`INSERT INTO contas (id, dados) VALUES (${id}, ${JSON.stringify(d)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET dados = EXCLUDED.dados, atualizado_em = NOW()`;
}
export async function listarContas() {
  const r = await db().sql`SELECT id, dados, criado_em FROM contas ORDER BY criado_em DESC`;
  return r.map((x) => ({ ...x.dados, id: x.id, criado_em: x.criado_em }));
}
/** Conta da qual o e-mail é membro ativo (ou null). */
export async function contaDoEmail(email) {
  const e = String(email || "").trim().toLowerCase(); if (!e) return null;
  const r = await db().sql`SELECT id, dados, criado_em FROM contas WHERE dados->'membros' @> ${JSON.stringify([{ email: e }])}::jsonb LIMIT 1`;
  if (!r[0]) return null;
  const c = { ...r[0].dados, id: r[0].id, criado_em: r[0].criado_em };
  const membro = (c.membros || []).find((m) => m.email === e);
  return { ...c, membro };
}
export async function emailEmUso(email) {
  const e = String(email || "").trim().toLowerCase();
  const r = await db().sql`SELECT 1 FROM contas WHERE dados->'membros' @> ${JSON.stringify([{ email: e }])}::jsonb LIMIT 1`;
  return !!r[0];
}

/** Uso no período. */
export async function usoDe(conta, periodo) {
  const r = await db().sql`SELECT recurso, n FROM uso_conta WHERE conta = ${conta} AND periodo = ${periodo}`;
  const out = { imoveis: 0, docs: 0, ia: 0 }; for (const x of r) out[x.recurso] = x.n; return out;
}
/** Consome n unidades se couber no limite (atômico). Devolve { ok, usado, limite }. */
export async function consumir(c, recurso, n = 1, agora = new Date()) {
  const lim = limites(c)[recurso]; const per = periodoUso(c, agora);
  if (!(lim > 0)) return { ok: false, usado: 0, limite: 0 };
  const r = await db().sql`INSERT INTO uso_conta (conta, recurso, periodo, n) SELECT ${c.id}::text, ${recurso}::text, ${per}::text, ${n}::int WHERE ${n}::int <= ${lim}::int
    ON CONFLICT (conta, recurso, periodo) DO UPDATE SET n = uso_conta.n + EXCLUDED.n WHERE uso_conta.n + EXCLUDED.n <= ${lim}::int
    RETURNING n`;
  if (r[0]) return { ok: true, usado: r[0].n, limite: lim };
  const atual = await db().sql`SELECT n FROM uso_conta WHERE conta = ${c.id} AND recurso = ${recurso} AND periodo = ${per}`;
  return { ok: false, usado: atual[0]?.n || 0, limite: lim };
}
export function msgLimite(c, recurso, l) {
  const fonte = limites(c).fonte;
  return fonte === "teste"
    ? `Limite do teste grátis atingido: ${l.limite} ${RECURSOS[recurso]}. Escolha um plano em Mais → Plano e assinatura para continuar.`
    : `Limite do plano atingido este mês: ${l.limite} ${RECURSOS[recurso]}. Mude de plano em Mais → Plano e assinatura ou aguarde o próximo mês.`;
}

/* ---------------- registros da conta ---------------- */
export async function listarDaConta(conta, incluirExcluidos = false) {
  return incluirExcluidos
    ? db().sql`SELECT colecao, id, dados, criado_em, atualizado_em, excluido FROM registros_conta WHERE conta = ${conta} ORDER BY colecao, atualizado_em DESC`
    : db().sql`SELECT colecao, id, dados, criado_em, atualizado_em, excluido FROM registros_conta WHERE conta = ${conta} AND excluido = FALSE ORDER BY colecao, atualizado_em DESC`;
}
export async function salvarDaConta(conta, colecao, id, dados) {
  const r = await db().sql`INSERT INTO registros_conta (conta, colecao, id, dados) VALUES (${conta}, ${colecao}, ${id}, ${JSON.stringify(dados)}::jsonb)
    ON CONFLICT (conta, colecao, id) DO UPDATE SET dados = EXCLUDED.dados, atualizado_em = NOW(), excluido = FALSE
    RETURNING atualizado_em`;
  return r[0];
}
export async function obterDaConta(conta, colecao, id) {
  const r = await db().sql`SELECT dados FROM registros_conta WHERE conta = ${conta} AND colecao = ${colecao} AND id = ${id} AND excluido = FALSE`;
  return r[0] ? r[0].dados : null;
}
/** Existe (mesmo excluído)? Usado para contar só imóveis novos. */
export async function existiuNaConta(conta, colecao, id) {
  const r = await db().sql`SELECT 1 FROM registros_conta WHERE conta = ${conta} AND colecao = ${colecao} AND id = ${id}`;
  return !!r[0];
}
export async function excluirDaConta(conta, colecao, id) {
  await db().sql`UPDATE registros_conta SET excluido = TRUE, atualizado_em = NOW() WHERE conta = ${conta} AND colecao = ${colecao} AND id = ${id}`;
}
/** Anúncio público de qualquer conta (o token é aleatório e único). */
export async function anuncioDeConta(token) {
  const r = await db().sql`SELECT conta, dados FROM registros_conta WHERE colecao = 'anuncios' AND id = ${token} AND excluido = FALSE LIMIT 1`;
  return r[0] ? { conta: r[0].conta, anuncio: r[0].dados } : null;
}

/** Visão pública/segura da conta para o app do cliente. */
export function resumoConta(c, uso, agora = new Date()) {
  const s = situacao(c, agora); const l = limites(c);
  return {
    id: c.id, nome: c.nome, tipo: c.tipo, plano: c.plano || null, plano_nome: PLANOS[c.plano]?.nome || null, ciclo: c.ciclo || null,
    teste_fim: c.teste_fim, pago_ate: c.pago_ate || null, situacao: s, limites: { usuarios: l.usuarios, imoveis: l.imoveis, docs: l.docs, fonte: l.fonte },
    uso: { ...uso, usuarios: (c.membros || []).filter((m) => m.ativo !== false).length },
    fatura: c.asaas?.fatura || null, assinatura: !!c.asaas?.assinatura, fundador_ate: c.asaas?.fundador_ate || null, valor: c.asaas?.valor || null,
    membros: (c.membros || []).map((m) => ({ email: m.email, nome: m.nome, creci: m.creci, telefone: m.telefone, papel: m.papel, ativo: m.ativo !== false })),
    empresa: c.empresa || "", documento_ok: !!c.documento,
  };
}
