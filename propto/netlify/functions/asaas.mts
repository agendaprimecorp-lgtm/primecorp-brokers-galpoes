import type { Config } from "@netlify/functions";
import { timingSafeEqual } from "node:crypto";
import { db, json, erro, env, contaPorId, mesclarConta, somarCredito } from "../../shared/srv.mjs";

// Webhook do Asaas: libera, mantém ou bloqueia o acesso conforme os pagamentos.
// Configure no Asaas (Integrações → Webhooks) a URL https://SEU-SITE/webhook/asaas e o mesmo token de ASAAS_WEBHOOK_TOKEN.
const igual = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

async function orgDoPagamento(p: any) {
  const ref = String(p?.externalReference || "");
  const m = ref.match(/^(assinatura|avulso):([A-Za-z0-9_-]+)$/);
  if (m) return { org: await contaPorId(m[2]), avulso: m[1] === "avulso" };
  if (p?.subscription) { const r = await db().sql`SELECT id FROM contas WHERE dados->'assinatura'->>'sub' = ${p.subscription}`; if (r[0]) return { org: await contaPorId(r[0].id), avulso: false }; }
  if (p?.customer) { const r = await db().sql`SELECT id FROM contas WHERE dados->'assinatura'->>'cliente' = ${p.customer} AND org_id = id`; if (r[0]) return { org: await contaPorId(r[0].id), avulso: !p.subscription }; }
  return { org: null, avulso: false };
}

export default async (req: Request) => {
  const esperado = env("ASAAS_WEBHOOK_TOKEN") || "";
  if (!esperado || !igual(req.headers.get("asaas-access-token") || "", esperado)) return erro("Não autorizado.", 401);
  const ev = await req.json().catch(() => null);
  if (!ev?.event) return erro("Evento inválido.");
  const idEv = String(ev.id || `${ev.event}:${ev.payment?.id || ev.subscription?.id || ""}`);
  const p = ev.payment || null;
  const { org, avulso } = p ? await orgDoPagamento(p) : ev.subscription ? { org: await (async () => { const r = await db().sql`SELECT id FROM contas WHERE dados->'assinatura'->>'sub' = ${ev.subscription.id}`; return r[0] ? contaPorId(r[0].id) : null; })(), avulso: false } : { org: null, avulso: false };
  // idempotência: o mesmo evento nunca é aplicado duas vezes
  const ins = await db().sql`INSERT INTO pagamentos (id, org_id, evento, dados) VALUES (${idEv}, ${org?.id || null}, ${ev.event}, ${JSON.stringify(ev)}::jsonb) ON CONFLICT (id) DO NOTHING RETURNING id`;
  if (!ins.length || !org) return json({ ok: true, ignorado: !org });
  const ass = org.assinatura || {};
  switch (ev.event) {
    case "PAYMENT_CONFIRMED":
    case "PAYMENT_RECEIVED": {
      if (avulso) {
        // crédito por pagamento (CONFIRMED e RECEIVED do mesmo pagamento valem 1 só)
        const ja = await db().sql`SELECT 1 FROM pagamentos WHERE id <> ${idEv} AND evento IN ('PAYMENT_CONFIRMED','PAYMENT_RECEIVED') AND dados->'payment'->>'id' = ${p.id}`;
        if (!ja.length) await somarCredito(org.id, 1);
      } else {
        const prox = new Date(p.dueDate || Date.now()); prox.setMonth(prox.getMonth() + 1);
        await mesclarConta(org.id, { assinatura: { ...ass, status: "ativa", atrasada_desde: null, ultimo_pagamento: new Date().toISOString(), proximo_vencimento: prox.toISOString().slice(0, 10), fatura_url: null } });
      }
      break;
    }
    case "PAYMENT_OVERDUE":
      if (!avulso) await mesclarConta(org.id, { assinatura: { ...ass, status: "atrasada", atrasada_desde: ass.atrasada_desde || p.dueDate || new Date().toISOString().slice(0, 10), fatura_url: p.invoiceUrl || ass.fatura_url } });
      break;
    case "PAYMENT_CREATED":
      if (!avulso) await mesclarConta(org.id, { assinatura: { ...ass, proximo_vencimento: p.dueDate || ass.proximo_vencimento, fatura_url: ass.status === "ativa" ? ass.fatura_url : p.invoiceUrl || ass.fatura_url } });
      break;
    case "PAYMENT_REFUNDED":
    case "PAYMENT_CHARGEBACK_REQUESTED":
      if (avulso) await somarCredito(org.id, -1);
      else await mesclarConta(org.id, { assinatura: { ...ass, status: "atrasada", atrasada_desde: new Date(Date.now() - 864e5 * 30).toISOString().slice(0, 10) } });
      break;
    case "SUBSCRIPTION_DELETED":
    case "SUBSCRIPTION_INACTIVATED":
      await mesclarConta(org.id, { assinatura: { ...ass, status: "cancelada", cancelada_em: new Date().toISOString() } });
      break;
  }
  return json({ ok: true });
};

export const config: Config = { path: "/webhook/asaas", method: ["POST"] };
