// Utilitários do servidor do Propto (somente functions).
import { getDatabase } from "@netlify/database";
import { getUser } from "@netlify/identity";
import Anthropic from "@anthropic-ai/sdk";
import { randomBytes } from "node:crypto";
import { PLANOS, acesso } from "./planos.mjs";

let _db = null;
export const db = () => (_db ||= getDatabase());
export const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
export const erro = (msg, status = 400, extra = {}) => json({ erro: msg, ...extra }, status);
export function env(n) { try { if (typeof Netlify !== "undefined" && Netlify.env) { const v = Netlify.env.get(n); if (v !== undefined) return v; } } catch {} return process.env[n]; }
export async function usuario() { try { return await getUser(); } catch { return null; } }
export const ehAdmin = (email) => (env("ADMIN_EMAILS") || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).includes(String(email || "").toLowerCase());
export const token = (n = 24) => randomBytes(n).toString("base64url");
export const novoId = (p) => p + "_" + randomBytes(9).toString("base64url");
export const soDig = (s) => String(s || "").replace(/\D/g, "");
export const hoje = () => new Date().toISOString().slice(0, 10);

/* ---------------- Contas ---------------- */
export async function contaPorEmail(email) {
  const r = await db().sql`SELECT id, email, org_id, dados, criado_em FROM contas WHERE email = ${String(email).toLowerCase()}`;
  return r[0] ? { ...r[0].dados, id: r[0].id, email: r[0].email, org_id: r[0].org_id, criado_em: r[0].criado_em } : null;
}
export async function contaPorId(id) {
  const r = await db().sql`SELECT id, email, org_id, dados, criado_em FROM contas WHERE id = ${id}`;
  return r[0] ? { ...r[0].dados, id: r[0].id, email: r[0].email, org_id: r[0].org_id, criado_em: r[0].criado_em } : null;
}
export async function salvarConta(c) {
  const { id, email, org_id, criado_em, ...dados } = c;
  await db().sql`INSERT INTO contas (id, email, org_id, dados) VALUES (${id}, ${String(email).toLowerCase()}, ${org_id}, ${JSON.stringify(dados)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET dados = EXCLUDED.dados, org_id = EXCLUDED.org_id, atualizado_em = NOW()`;
  return c;
}
/** Atualiza só alguns campos dentro de dados (merge atômico no banco). */
export async function mesclarConta(id, parcial) {
  await db().sql`UPDATE contas SET dados = dados || ${JSON.stringify(parcial)}::jsonb, atualizado_em = NOW() WHERE id = ${id}`;
}
export async function usoMes(org_id) {
  const r = await db().sql`SELECT COUNT(*)::int AS n FROM captacoes WHERE org_id = ${org_id} AND (dados->>'consumo') = 'plano' AND date_trunc('month', criado_em AT TIME ZONE 'America/Sao_Paulo') = date_trunc('month', NOW() AT TIME ZONE 'America/Sao_Paulo')`;
  return r[0]?.n || 0;
}
export async function acessoDe(conta, admin = false) {
  const org = conta.org_id === conta.id ? conta : await contaPorId(conta.org_id);
  return { org, ...acesso(org, await usoMes(conta.org_id), new Date(), admin) };
}
/** Consome 1 crédito avulso da organização, sem deixar ficar negativo. */
export async function consumirCredito(org_id) {
  const r = await db().sql`UPDATE contas SET dados = jsonb_set(dados, '{creditos}', to_jsonb((COALESCE((dados->>'creditos')::int, 0) - 1))), atualizado_em = NOW()
    WHERE id = ${org_id} AND COALESCE((dados->>'creditos')::int, 0) > 0 RETURNING id`;
  return r.length > 0;
}
export async function somarCredito(org_id, n = 1) {
  await db().sql`UPDATE contas SET dados = jsonb_set(dados, '{creditos}', to_jsonb(GREATEST(0, COALESCE((dados->>'creditos')::int, 0) + ${n}::int))), atualizado_em = NOW() WHERE id = ${org_id}`;
}
export async function proximoCodigo() { const r = await db().sql`SELECT nextval('codigo_prp') AS n`; return "PRP-" + String(r[0].n).padStart(6, "0"); }

/* ---------------- Documentos ---------------- */
export function cnpjValido(c) {
  if (!/^\d{14}$/.test(c) || /^(\d)\1+$/.test(c)) return false;
  const calc = (b) => { const p = b.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; const s = b.split("").reduce((a, d, i) => a + Number(d) * p[i], 0) % 11; return s < 2 ? 0 : 11 - s; };
  return calc(c.slice(0, 12)) === Number(c[12]) && calc(c.slice(0, 13)) === Number(c[13]);
}
export function cpfValido(c) {
  if (!/^\d{11}$/.test(c) || /^(\d)\1+$/.test(c)) return false;
  const dv = (n) => { const s = c.slice(0, n).split("").reduce((a, d, i) => a + Number(d) * (n + 1 - i), 0); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
}

/* ---------------- Asaas (cobrança recorrente) ---------------- */
export const asaasBase = () => (env("ASAAS_AMBIENTE") === "producao" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3");
export async function asaas(caminho, { method = "GET", body } = {}) {
  const chave = env("ASAAS_API_KEY");
  if (!chave) throw Object.assign(new Error("Pagamentos ainda não configurados (ASAAS_API_KEY)."), { status: 503 });
  const r = await fetch(asaasBase() + caminho, { method, headers: { access_token: chave, "content-type": "application/json", "user-agent": "Propto/1.0" }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j?.errors?.[0]?.description || `Asaas respondeu ${r.status}`), { status: 502 });
  return j;
}
export async function garantirCliente(org) {
  if (org.assinatura?.cliente) return org.assinatura.cliente;
  const c = await asaas("/customers", { method: "POST", body: { name: org.razao || org.nome, cpfCnpj: org.documento, email: org.email, mobilePhone: soDig(org.telefone), externalReference: org.id, notificationDisabled: false } });
  await mesclarConta(org.id, { assinatura: { ...(org.assinatura || {}), cliente: c.id } });
  org.assinatura = { ...(org.assinatura || {}), cliente: c.id };
  return c.id;
}
export async function primeiraFatura(subId) {
  const p = await asaas(`/subscriptions/${subId}/payments`);
  const f = (p.data || []).find((x) => ["PENDING", "OVERDUE"].includes(x.status)) || (p.data || [])[0];
  return f?.invoiceUrl || null;
}

/* ---------------- IA ---------------- */
export function extrairJSON(txt) {
  const s = String(txt || "").trim();
  try { return JSON.parse(s); } catch {}
  const f = s.match(/```(?:json)?\s*([\s\S]*?)```/i); if (f) { try { return JSON.parse(f[1]); } catch {} }
  const i = s.indexOf("{"), j = s.lastIndexOf("}"); if (i >= 0 && j > i) { try { return JSON.parse(s.slice(i, j + 1)); } catch {} }
  throw new Error("Resposta da IA sem JSON válido");
}
const modelo = () => env("MODELO_IA") || "claude-sonnet-4-5-20250929";
export async function chamarIA(prompt, texto, maxTokens = 2500) {
  const r = await new Anthropic().messages.create({ model: modelo(), max_tokens: maxTokens, messages: [{ role: "user", content: `${prompt}\n\nDADOS:\n"""\n${texto}\n"""` }] });
  return extrairJSON((r.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n"));
}
export async function chamarIAImagem(prompt, texto, imagens = [], maxTokens = 1200) {
  const content = [...imagens.slice(0, 3).map((b64) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } })), { type: "text", text: `${prompt}\n\nFALA DO USUÁRIO:\n"""\n${texto || "(sem fala)"}\n"""` }];
  const r = await new Anthropic().messages.create({ model: modelo(), max_tokens: maxTokens, messages: [{ role: "user", content }] });
  return extrairJSON((r.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n"));
}
export const PROMPT_AMBIENTE = `Você ajuda quem está fotografando um imóvel no local para anunciá-lo (corretor, imobiliária ou proprietário). Recebe foto(s) de UM ambiente, o nome do item do roteiro e o que a pessoa falou (transcrição de voz, pode ter erros).
Responda SOMENTE JSON:
{"ambiente":"nome curto (ex.: 'Sala de estar', 'Suíte', 'Fachada', 'Docas', 'Sede', 'Represa')","descricao":"1 a 2 frases objetivas, 3ª pessoa, só o que se vê ou foi dito","caracteristicas":["até 6 itens curtos"],"dados":{"dormitorios":número|null,"suites":número|null,"banheiros":número|null,"vagas":número|null,"construida":número|null,"terreno":número|null,"pe_direito":número|null,"docas":número|null,"area_ha":número|null,"aluguel":número|null,"venda":número|null,"condominio":número|null,"iptu":número|null},"foto":{"ok":true|false,"problemas":["ex.: 'escura','tremida','torta','objetos pessoais à vista','pessoa na foto','placa de carro visível','não mostra o ambiente pedido'"]}}
REGRAS: em "dados" só números DITOS (nunca estime pela foto). Não invente materiais. Não cite endereço. Se a foto não corresponder ao item do roteiro, diga em "problemas".`;
export const PROMPT_ANUNCIO = `Você redige o anúncio de um imóvel a partir da ficha, dos ambientes fotografados no local e das falas de quem captou.
Responda SOMENTE JSON:
{"titulo":"até 70 caracteres","subtitulo":"até 90 caracteres com o principal atrativo","descricao":"2 parágrafos, 500 a 800 caracteres, 3ª pessoa, tom profissional, só fatos fornecidos","destaques":["4 a 8 itens curtos"],"pendencias":["até 5 informações que ainda faltam"]}
REGRAS: NUNCA invente números, materiais ou lazer. Não cite rua, número, nome do proprietário, telefone ou imobiliária. Bairro e cidade podem aparecer.`;

/* ---------------- Corretores da PrimeCorp (intermediação para quem não tem CRECI) ---------------- */
export const CORRETORES_PRIMECORP = {
  rodrigo: { nome: "Rodrigo França Viana", creci: "CRECI-SP 297692", whatsapp: "(19) 99805-1985", email: "contato@primecorpconsultoria.com.br", empresa: "PrimeCorp Brokers" },
  joselia: { nome: "Joselia Junqueira Viana", creci: "CRECI-SP 300760", whatsapp: "(19) 99919-4447", email: "comercial@primecorpconsultoria.com.br", empresa: "PrimeCorp Brokers", titulo: "Corretora de Imóveis" },
};
export { PLANOS };
