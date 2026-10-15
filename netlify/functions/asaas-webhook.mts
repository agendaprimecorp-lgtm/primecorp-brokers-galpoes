import type { Config } from "@netlify/functions";
import { timingSafeEqual } from "node:crypto";
import { db, env, registrarEmissao } from "../../shared/servidor.mjs";
import { obterConta, gravarConta, somarMeses, PLANOS, brl } from "../../shared/contas.mjs";
import { avisarOuEnfileirar } from "../../shared/zoe-run.mjs";

// Webhook do Asaas: pagamentos das assinaturas Propto atualizam a conta do cliente.
// Autenticação pelo cabeçalho asaas-access-token (= ASAAS_WEBHOOK_TOKEN). Entrega "pelo menos uma vez": o id do evento garante que nada é aplicado duas vezes.
function tokenOk(req: Request) {
  const esperado = env("ASAAS_WEBHOOK_TOKEN") || ""; const veio = req.headers.get("asaas-access-token") || "";
  return esperado.length >= 32 && esperado.length === veio.length && timingSafeEqual(Buffer.from(esperado), Buffer.from(veio));
}
const PAGOU = ["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"];
const ESTORNO = ["PAYMENT_REFUNDED", "PAYMENT_CHARGEBACK_REQUESTED", "PAYMENT_DELETED"];

export async function contaDoPagamento(p: any) {
  if (p?.subscription) {
    const r = await db().sql`SELECT id FROM contas WHERE dados->'asaas'->>'assinatura' = ${String(p.subscription)} OR dados->'asaas'->>'cancelada' = ${String(p.subscription)} LIMIT 1`;
    if (r[0]) return r[0].id;
  }
  const ref = String(p?.externalReference || "");
  if (/^ct_[a-f0-9]{12}$/.test(ref)) { const r = await db().sql`SELECT id FROM contas WHERE id = ${ref}`; if (r[0]) return r[0].id; }
  if (p?.customer) { const r = await db().sql`SELECT id FROM contas WHERE dados->'asaas'->>'cliente' = ${String(p.customer)} LIMIT 1`; if (r[0]) return r[0].id; }
  return null;
}

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Método não permitido", { status: 405 });
  if (!tokenOk(req)) return new Response("Não autorizado", { status: 401 });
  const ev: any = await req.json().catch(() => null);
  if (!ev || !ev.event) return new Response("ok");
  const p = ev.payment || {};
  const idEvento = String(ev.id || `${ev.event}_${p.id || ""}_${p.status || ""}`).slice(0, 120);
  const contaId = await contaDoPagamento(p);
  const novo = await db().sql`INSERT INTO cobranca_eventos (id, conta, evento, dados) VALUES (${idEvento}, ${contaId}, ${String(ev.event)}, ${JSON.stringify(ev)}::jsonb) ON CONFLICT (id) DO NOTHING RETURNING id`;
  if (!novo[0] || !contaId) return new Response("ok"); // repetido ou de fora da Propto
  const c: any = await obterConta(contaId); if (!c) return new Response("ok");
  const venc = p.dueDate ? String(p.dueDate) + "T12:00:00Z" : new Date().toISOString();
  const fatura = p.invoiceUrl ? { id: p.id, link: p.invoiceUrl, vencimento: p.dueDate, valor: p.value, status: p.status } : c.asaas?.fatura || null;
  const plano = PLANOS[c.plano]?.nome || c.plano;

  if (PAGOU.includes(ev.event)) {
    const meses = (c.asaas?.ciclo || c.ciclo) === "anual" ? 12 : 1;
    const ate = somarMeses(venc, meses);
    const pago_ate = c.pago_ate && Date.parse(c.pago_ate) > Date.parse(ate) ? c.pago_ate : ate;
    const pagos = { ...(c.pagamentos || {}) };
    if (!pagos[p.id]) pagos[p.id] = { valor: p.value, vencimento: p.dueDate, forma: p.billingType, em: new Date().toISOString() };
    await gravarConta(contaId, { ...c, pago_ate, pagamentos: pagos, ultimo_pagamento: { em: new Date().toISOString(), valor: p.value, forma: p.billingType, id: p.id }, asaas: { ...(c.asaas || {}), fatura: null } });
    if (ev.event === "PAYMENT_RECEIVED" || !c.pagamentos?.[p.id]) {
      await registrarEmissao({ tipo: "pagamento", conta: contaId, conteudo: `Pagamento ${ev.event === "PAYMENT_RECEIVED" ? "recebido" : "confirmado"} · ${brl(Number(p.value) || 0)} · plano ${plano} · em dia até ${pago_ate.slice(0, 10).split("-").reverse().join("/")}`, meta: { pagamento: p.id, forma: p.billingType } }).catch(() => null);
      if (!c.pagamentos?.[p.id]) await avisarOuEnfileirar(`Propto · pagamento de ${c.nome}: ${brl(Number(p.value) || 0)} (${p.billingType || "?"}) · plano ${plano}.`).catch(() => null);
    }
  } else if (ev.event === "PAYMENT_OVERDUE") {
    await gravarConta(contaId, { ...c, asaas: { ...(c.asaas || {}), fatura } });
    await registrarEmissao({ tipo: "pagamento_atrasado", conta: contaId, conteudo: `Fatura vencida em ${String(p.dueDate || "").split("-").reverse().join("/")} · ${brl(Number(p.value) || 0)}`, meta: { pagamento: p.id } }).catch(() => null);
    await avisarOuEnfileirar(`Propto · fatura vencida de ${c.nome}: ${brl(Number(p.value) || 0)} (venc. ${String(p.dueDate || "").split("-").reverse().join("/")}). Vale um contato.`).catch(() => null);
  } else if (ESTORNO.includes(ev.event)) {
    const pagos = { ...(c.pagamentos || {}) }; const era = pagos[p.id]; delete pagos[p.id];
    const pago_ate = era ? new Date().toISOString() : c.pago_ate || null; // estorno: o período pago termina hoje
    await gravarConta(contaId, { ...c, pagamentos: pagos, pago_ate });
    if (era) {
      await registrarEmissao({ tipo: "estorno", conta: contaId, conteudo: `${ev.event === "PAYMENT_DELETED" ? "Cobrança removida" : "Estorno"} · ${brl(Number(p.value) || 0)}`, meta: { pagamento: p.id } }).catch(() => null);
      await avisarOuEnfileirar(`Propto · ${ev.event === "PAYMENT_CHARGEBACK_REQUESTED" ? "CHARGEBACK" : "estorno"} na conta ${c.nome}: ${brl(Number(p.value) || 0)}.`, { urgente: true }).catch(() => null);
    }
  } else if (ev.event === "PAYMENT_CREATED" || ev.event === "PAYMENT_UPDATED") {
    await gravarConta(contaId, { ...c, asaas: { ...(c.asaas || {}), fatura } });
  }
  return new Response("ok");
};

export const config: Config = { path: "/asaas/webhook" };
