// E-mail transacional (Resend). Sem RESEND_API_KEY nada é enviado e o sistema segue normalmente.
// Regra: nenhum e-mail leva senha. Acesso é sempre criado pela própria pessoa.
import { env } from "./servidor.mjs";

export const emailConfigurado = () => !!env("RESEND_API_KEY");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const siteBase = () => String(env("PROPTO_SITE") || "https://propto.com.br").replace(/\/+$/, "");

export async function enviarEmail({ para, assunto, html, texto, tags = [] }) {
  if (!emailConfigurado()) return { enviado: false, motivo: "RESEND_API_KEY ausente" };
  if (/senha\s*[:=]/i.test(String(texto) + String(html))) throw new Error("E-mail com senha bloqueado.");
  const f = globalThis.__fetchEmail || fetch;
  const r = await f("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: "Bearer " + env("RESEND_API_KEY"), "content-type": "application/json", "user-agent": "ProptoImoveis/1.0" },
    body: JSON.stringify({ from: env("EMAIL_REMETENTE") || "Propto Imóveis <contato@propto.com.br>", to: [para], subject: assunto, html, text: texto, reply_to: env("EMAIL_RESPOSTA") || undefined, tags }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Resend: " + (j?.message || "erro " + r.status));
  return { enviado: true, id: j.id };
}

const suporteWA = () => { const d = String(env("PROPTO_WHATSAPP") || "(19) 99805-1985").replace(/\D/g, ""); return { link: "https://wa.me/" + (d.length <= 11 ? "55" + d : d), texto: env("PROPTO_WHATSAPP") || "(19) 99805-1985" }; };

function moldura(titulo, corpoHTML) {
  const base = siteBase();
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f7f8f9;font-family:Arial,Helvetica,sans-serif;color:#0f1720">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f8f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e1e5ea">
<tr><td style="background:#0b1118;border-top:4px solid #cc1b1b;padding:18px 24px"><img src="${base}/marca/propto-horizontal-negative-600.png" alt="Propto Imóveis" width="150" style="display:block;border:0"></td></tr>
<tr><td style="padding:26px 24px 8px"><h1 style="margin:0 0 12px;font-size:22px;line-height:1.25;color:#0f1720">${esc(titulo)}</h1>${corpoHTML}</td></tr>
<tr><td style="padding:16px 24px 24px;font-size:12px;color:#626c79;border-top:1px solid #e1e5ea">Propto Imóveis · <a href="${base}" style="color:#626c79">propto.com.br</a> · <a href="${base}/termos-propto.html" style="color:#626c79">Termos e privacidade</a><br>A Propto nunca pede a sua senha por e-mail, WhatsApp ou telefone.</td></tr>
</table></td></tr></table></body></html>`;
}
const botao = (url, txt) => `<p style="margin:18px 0"><a href="${url}" style="display:inline-block;background:#cc1b1b;color:#ffffff;text-decoration:none;font-weight:bold;padding:13px 22px;border-radius:10px">${esc(txt)}</a></p>`;
const p = (t) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#2b333d">${t}</p>`;
const instalacao = () => `<h2 style="margin:20px 0 8px;font-size:16px;color:#0f1720">Instale no celular (1 minuto)</h2>
<p style="margin:0 0 6px;font-size:14px;line-height:1.5;color:#2b333d"><b>Android:</b> abra o link no Chrome e toque em “Instalar app” (ou menu ⋮ → “Adicionar à tela inicial”).</p>
<p style="margin:0 0 12px;font-size:14px;line-height:1.5;color:#2b333d"><b>iPhone:</b> abra o link no Safari, toque em Compartilhar (quadrado com seta) → “Adicionar à Tela de Início”.</p>`;

/** Boas-vindas de quem criou a conta (sem senha; ele já criou a própria no cadastro). */
export function emailBoasVindas({ nome, email, empresa, tipo, teste_fim }) {
  const base = siteBase(); const app = base + "/app"; const wa = suporteWA();
  const primeiro = String(nome || "").split(" ")[0] || "Olá";
  const fim = teste_fim ? new Date(teste_fim).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "";
  const lim = tipo === "imobiliaria" ? "até 3 usuários e 15 imóveis" : "até 5 imóveis";
  const assunto = "Sua conta Propto está pronta: comece a captar hoje";
  const html = moldura(`${primeiro}, sua conta Propto está pronta.`,
    p(`O teste grátis${empresa ? ` da <b>${esc(empresa)}</b>` : ""} vai até <b>${esc(fim)}</b>, com todas as funções e ${lim}. Não pedimos cartão.`) +
    p(`<b>Login:</b> ${esc(email)}<br><b>Acesso:</b> com a senha que você mesmo criou no cadastro. Esqueceu? Use “Esqueci a senha” na tela de entrada.`) +
    botao(app, "Entrar no sistema") + instalacao() +
    `<h2 style="margin:20px 0 8px;font-size:16px;color:#0f1720">Primeiros passos</h2>
<ol style="margin:0 0 12px 18px;padding:0;font-size:14px;line-height:1.6;color:#2b333d"><li>No imóvel, toque em <b>Captar imóvel</b>: o app guia as fotos e você fala o que vê.</li><li>A inteligência artificial monta o anúncio; você revisa e publica o link.</li><li>Envie a matrícula ou o IPTU para a conferência documental.</li></ol>` +
    p(`Dúvidas? Fale com a equipe no WhatsApp <a href="${wa.link}" style="color:#cc1b1b">${esc(wa.texto)}</a>, em horário comercial.`));
  const texto = `${primeiro}, sua conta Propto está pronta.\n\nTeste grátis até ${fim}, ${lim}, sem cartão.\nLogin: ${email}\nAcesso: com a senha que você mesmo criou no cadastro (use "Esqueci a senha" se precisar).\n\nEntrar: ${app}\nSite: ${base}\n\nInstalar no celular:\n- Android: abra no Chrome e toque em "Instalar app".\n- iPhone: abra no Safari, Compartilhar > "Adicionar à Tela de Início".\n\nSuporte WhatsApp: ${wa.texto}\nA Propto nunca pede a sua senha.`;
  return { assunto, html, texto };
}

/** Corretor incluído por uma imobiliária: recebe à parte o e-mail para criar a senha. */
export function emailNovoMembro({ nome, email, empresa, quemIncluiu }) {
  const base = siteBase(); const app = base + "/app"; const wa = suporteWA();
  const primeiro = String(nome || "").split(" ")[0] || "Olá";
  const assunto = `${empresa || "Sua imobiliária"} incluiu você na Propto`;
  const html = moldura(`${primeiro}, você foi incluído(a) na equipe ${empresa ? "da " + empresa : ""} na Propto.`,
    p(`${quemIncluiu ? esc(quemIncluiu) + " cadastrou" : "Sua imobiliária cadastrou"} o seu acesso com o login <b>${esc(email)}</b>.`) +
    p(`<b>Para criar o seu acesso</b>, procure o e-mail “redefinir senha” (Reset password) que chegou junto com este, abra o link e escolha a sua senha. Se não chegou, use “Esqueci a senha” na tela de entrada.`) +
    botao(app, "Abrir o sistema") + instalacao() +
    p(`Dúvidas? WhatsApp do suporte Propto: <a href="${wa.link}" style="color:#cc1b1b">${esc(wa.texto)}</a>.`));
  const texto = `${primeiro}, você foi incluído(a) na equipe ${empresa || ""} na Propto.\nLogin: ${email}\nCrie o seu acesso pelo e-mail "redefinir senha" que chegou junto, ou use "Esqueci a senha" em ${app}.\n\nAndroid: Chrome > "Instalar app". iPhone: Safari > Compartilhar > "Adicionar à Tela de Início".\nSuporte: ${wa.texto}`;
  return { assunto, html, texto };
}
