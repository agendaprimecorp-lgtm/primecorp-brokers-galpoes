import type { Config, Context } from "@netlify/functions";
import crypto from "node:crypto";
import { db, env, registrarEmissao, ehEquipePrimeCorp } from "../../shared/servidor.mjs";
import { TESTE, novoIdConta, gravarConta, emailEmUso } from "../../shared/contas.mjs";
import { criarUsuarioIdentity } from "../../shared/identidade.mjs";
import { avisarOuEnfileirar } from "../../shared/zoe-run.mjs";
import { enviarEmail, emailBoasVindas } from "../../shared/email.mjs";

// Público: cadastro do teste grátis de 30 dias na página propto.com.br.
// Cria a conta (dados separados), o acesso no Identity com a senha escolhida pela pessoa e avisa a equipe.
const ORIGENS = ["https://propto.com.br", "https://www.propto.com.br", "https://primecorp-radarnegocios.netlify.app"];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
const limpo = (s: unknown, n = 120) => String(s ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);
export const TERMOS_VERSAO = "2026-10-15";

export function validarCadastro(b: any) {
  const tipo = b?.tipo === "imobiliaria" ? "imobiliaria" : b?.tipo === "corretor" ? "corretor" : "";
  if (!tipo) throw new Error("Escolha: imobiliária ou corretor(a).");
  const nome = limpo(b.nome, 100); if (nome.length < 3 || !/\s/.test(nome)) throw new Error("Informe o nome completo.");
  const email = String(b.email || "").trim().toLowerCase(); if (!EMAIL_RE.test(email) || email.length > 120) throw new Error("Informe um e-mail válido.");
  const fone = String(b.fone || "").replace(/\D/g, ""); if (fone.length < 10 || fone.length > 13) throw new Error("Informe um WhatsApp com DDD.");
  const senha = String(b.senha || ""); if (senha.length < 8 || senha.length > 72) throw new Error("A senha precisa ter pelo menos 8 caracteres.");
  if (!/[A-Za-z]/.test(senha) || !/\d/.test(senha)) throw new Error("Use letras e números na senha.");
  const creci = limpo(b.creci, 30); if (!/\d{3,}/.test(creci)) throw new Error("Informe o número do CRECI.");
  const empresa = limpo(b.empresa, 120); if (tipo === "imobiliaria" && empresa.length < 2) throw new Error("Informe o nome da imobiliária.");
  if (b.consentimento !== true || b.termos !== true) throw new Error("Aceite os termos do teste e a autorização de contato para continuar.");
  return { tipo, nome, email, fone, senha, creci, empresa, municipio: limpo(b.municipio, 80), sistema: limpo(b.sistema, 80), segmento: limpo(b.segmento, 40), equipe: limpo(b.equipe, 20), site: limpo(b.site, 160) };
}

export default async (req: Request, context: Context) => {
  const origem = req.headers.get("origin") || "";
  const permitida = ORIGENS.includes(origem) || origem === new URL(req.url).origin;
  const cors: Record<string, string> = { "access-control-allow-origin": permitida ? origem : ORIGENS[0], "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type", vary: "origin" };
  const resp = (j: unknown, status = 200) => new Response(JSON.stringify(j), { status, headers: { ...cors, "content-type": "application/json", "cache-control": "no-store" } });
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return resp({ erro: "Método não permitido" }, 405);
  if (!permitida) return resp({ erro: "Origem não permitida" }, 403);
  const texto = await req.text(); if (texto.length > 6000) return resp({ erro: "Dados grandes demais" }, 413);
  let b: any; try { b = JSON.parse(texto); } catch { return resp({ erro: "Dados inválidos" }, 400); }
  if (b?.hp) return resp({ ok: true }); // robô
  let d; try { d = validarCadastro(b); } catch (e: any) { return resp({ erro: e.message }, 400); }

  const ipHash = crypto.createHash("sha256").update(String(context.ip || "") + (env("COLETA_SEGREDO") || "")).digest("hex").slice(0, 16);
  const recentes = await db().sql`SELECT COUNT(*)::int AS n FROM contas WHERE dados->'origem'->>'ip' = ${ipHash} AND criado_em > NOW() - INTERVAL '1 hour'`;
  if ((recentes[0]?.n || 0) >= 3) return resp({ erro: "Muitos cadastros a partir desta conexão. Tente mais tarde ou fale com a gente no WhatsApp." }, 429);
  if (await emailEmUso(d.email)) return resp({ erro: "Este e-mail já tem uma conta Propto. Entre com a sua senha." , entrar: true }, 409);
  if (await ehEquipePrimeCorp(d.email)) return resp({ erro: "Este e-mail é da equipe PrimeCorp. Use outro e-mail para o teste." }, 409);

  const id = novoIdConta();
  const agora = new Date();
  const conta = {
    nome: d.tipo === "imobiliaria" ? d.empresa : d.nome, tipo: d.tipo, empresa: d.empresa, municipio: d.municipio, sistema: d.sistema, site: d.site, segmento: d.segmento, equipe: d.equipe,
    plano: d.tipo === "imobiliaria" ? "imobiliaria" : "corretor",
    teste_inicio: agora.toISOString(), teste_fim: new Date(agora.getTime() + TESTE.dias * 864e5).toISOString(),
    membros: [{ email: d.email, nome: d.nome, creci: d.creci, telefone: d.fone, papel: "admin", foco: /comercial|galp|rural/i.test(d.segmento) ? "comercial" : "residencial", ativo: true, desde: agora.toISOString() }],
    termos: { versao: TERMOS_VERSAO, aceito_em: agora.toISOString(), ip: ipHash }, consentimento_contato: agora.toISOString(),
    origem: { ip: ipHash, pagina: limpo(b.pagina, 80), utm: limpo(b.utm, 200) }, avisos: {},
  };
  await gravarConta(id, conta);
  try { await criarUsuarioIdentity(d.email, d.senha, { conta: id, nome: d.nome }); }
  catch (e: any) { console.error("Cadastro Propto (Identity):", e?.message || e); try { await db().sql`DELETE FROM contas WHERE id = ${id}`; } catch {} return resp({ erro: e.status === 409 ? "Este e-mail já tem acesso. Entre com a sua senha ou use “Esqueci a senha”." : "Não foi possível criar o acesso agora. Tente de novo em instantes.", entrar: e.status === 409 }, e.status === 409 ? 409 : 502); }
  await registrarEmissao({ tipo: "conta_criada", conta: id, conteudo: `Conta criada · teste de ${TESTE.dias} dias · ${d.tipo === "imobiliaria" ? "Imobiliária " + d.empresa : "Corretor(a) " + d.nome}`, meta: { usuario: d.email } }).catch(() => null);
  const det = [d.tipo === "imobiliaria" ? "Imobiliária " + d.empresa : "Corretor(a)", d.nome, "CRECI " + d.creci, d.municipio, d.sistema && "sistema: " + d.sistema, d.equipe && d.equipe + " corretores", "+" + (d.fone.length <= 11 ? "55" + d.fone : d.fone)].filter(Boolean).join(" · ");
  await avisarOuEnfileirar(`Nova conta Propto (teste ${TESTE.dias} dias) · ${det}. Chame para a implantação de 30 minutos.`).catch((e) => console.error("Aviso da conta:", e));
  // Boas-vindas por e-mail (links do sistema, instalação no celular, suporte). Nunca leva senha; falha não impede o cadastro.
  try {
    const m = emailBoasVindas({ nome: d.nome, email: d.email, empresa: d.empresa, tipo: d.tipo, teste_fim: conta.teste_fim });
    const r = await enviarEmail({ para: d.email, assunto: m.assunto, html: m.html, texto: m.texto, tags: [{ name: "tipo", value: "boas_vindas" }] });
    if (r.enviado) await registrarEmissao({ tipo: "email_boas_vindas", conta: id, conteudo: `Boas-vindas enviado para ${d.email}`, meta: { id: r.id } }).catch(() => null);
  } catch (e: any) { console.error("E-mail de boas-vindas:", e?.message || e); }
  return resp({ ok: true, conta: id, teste_fim: conta.teste_fim });
};

export const config: Config = { path: "/propto/cadastro", rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip", "domain"] } };
