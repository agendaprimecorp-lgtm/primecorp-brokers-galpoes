// Cobrança recorrente pelo Asaas (Pix, boleto ou cartão, escolhidos pelo cliente na fatura).
// Chave só na variável ASAAS_API_KEY do Netlify. ASAAS_AMBIENTE=producao usa a conta real; qualquer outro valor usa o sandbox.
import { env } from "./servidor.mjs";

export const asaasConfigurado = () => !!env("ASAAS_API_KEY");
export const asaasProducao = () => (env("ASAAS_AMBIENTE") || "").toLowerCase() === "producao";
const BASE = () => (asaasProducao() ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3");

async function chamar(metodo, caminho, corpo) {
  if (!asaasConfigurado()) throw Object.assign(new Error("Cobrança ainda não configurada (ASAAS_API_KEY)."), { status: 503 });
  const f = globalThis.__fetchAsaas || fetch;
  const r = await f(BASE() + caminho, {
    method: metodo,
    headers: { access_token: env("ASAAS_API_KEY"), "content-type": "application/json", "user-agent": "ProptoImoveis/1.0 (propto.com.br)" },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error("Asaas: " + (j?.errors?.[0]?.description || "erro " + r.status)), { status: 502 });
  return j;
}

export const criarCliente = ({ nome, documento, email, fone, conta }) =>
  chamar("POST", "/customers", { name: nome, cpfCnpj: documento, email, mobilePhone: fone, externalReference: conta, notificationDisabled: false });

export const criarAssinatura = ({ cliente, valor, ciclo, vencimento, descricao, conta }) =>
  chamar("POST", "/subscriptions", { customer: cliente, billingType: "UNDEFINED", value: valor, nextDueDate: vencimento, cycle: ciclo, description: descricao, externalReference: conta });

/** Fatura em aberto mais próxima da assinatura (link onde o cliente escolhe Pix, boleto ou cartão). */
export async function faturaAberta(assinatura) {
  const j = await chamar("GET", `/subscriptions/${encodeURIComponent(assinatura)}/payments?limit=10`);
  const abertas = (j.data || []).filter((p) => ["PENDING", "OVERDUE"].includes(p.status)).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  const p = abertas[0] || (j.data || [])[0];
  return p ? { id: p.id, link: p.invoiceUrl, vencimento: p.dueDate, valor: p.value, status: p.status } : null;
}

export const atualizarValor = (assinatura, valor) => chamar("POST", `/subscriptions/${encodeURIComponent(assinatura)}`, { value: valor, updatePendingPayments: true });
export const cancelarAssinatura = (assinatura) => chamar("DELETE", `/subscriptions/${encodeURIComponent(assinatura)}`);

/** CPF/CNPJ com dígitos verificadores. */
export function documentoValido(d) {
  const s = String(d || "").replace(/\D/g, "");
  if (s.length === 11) {
    if (/^(\d)\1+$/.test(s)) return false;
    const dv = (n) => { let t = 0; for (let i = 0; i < n; i++) t += Number(s[i]) * (n + 1 - i); const r = (t * 10) % 11; return r === 10 ? 0 : r; };
    return dv(9) === Number(s[9]) && dv(10) === Number(s[10]);
  }
  if (s.length === 14) {
    if (/^(\d)\1+$/.test(s)) return false;
    const dv = (n) => { const p = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; let t = 0; for (let i = 0; i < n; i++) t += Number(s[i]) * p[i]; const r = t % 11; return r < 2 ? 0 : 11 - r; };
    return dv(12) === Number(s[12]) && dv(13) === Number(s[13]);
  }
  return false;
}
