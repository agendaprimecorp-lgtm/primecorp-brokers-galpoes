import type { Config } from "@netlify/functions";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { timingSafeEqual } from "node:crypto";
import { env, usuario, papelDe, db, salvarRegistro, registrarEmissao, chamarIA, PROMPT_VARIOS } from "../../shared/servidor.mjs";

// Lê os e-mails de alerta NÃO LIDOS da caixa dedicada, extrai as ofertas com IA e cria cada uma como "a revisar".
// Roda em segundo plano (até 15 min). Acionada pela coleta agendada (com segredo) ou pelo botão no app (usuário logado).
const MAX_EMAILS = 10;

function segredoOk(req: Request) {
  const esperado = env("COLETA_SEGREDO") || "";
  const veio = req.headers.get("x-coleta-segredo") || "";
  if (!esperado || esperado.length !== veio.length) return false;
  return timingSafeEqual(Buffer.from(esperado), Buffer.from(veio));
}
const NUM = ["fabril", "construida", "terreno", "pe_direito", "docas", "aluguel", "venda", "condominio", "iptu"];
const fmt = (k: string, v: unknown) => (typeof v === "number" ? (["aluguel", "venda", "condominio", "iptu"].includes(k) ? v.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : v.toLocaleString("pt-BR")) : String(v ?? ""));

export default async (req: Request) => {
  if (!segredoOk(req)) {
    const u = await usuario();
    if (!u || !(await papelDe(u))) { console.log("Coleta recusada: sem autorização."); return; }
  }
  const user = env("ALERTAS_IMAP_USER"), pass = env("ALERTAS_IMAP_SENHA");
  if (!user || !pass) { console.log("Coleta não configurada."); return; }

  const client = new ImapFlow({
    host: env("ALERTAS_IMAP_HOST") || "imap.gmail.com",
    port: Number(env("ALERTAS_IMAP_PORTA") || 993),
    secure: true,
    auth: { user, pass },
    logger: false,
  });
  let emails = 0, criadas = 0, duplicadas = 0, falhas = 0;
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    const desde = new Date(Date.now() - 7 * 864e5);
    const uids = ((await client.search({ seen: false, since: desde }, { uid: true })) || []).slice(0, MAX_EMAILS);
    const linksExistentes = new Set(
      (await db().sql`SELECT dados->>'link' AS link FROM registros WHERE colecao = 'ofertas' AND excluido = FALSE AND coalesce(dados->>'link','') <> ''`).map((r: any) => r.link),
    );
    for (const uid of uids) {
      const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
      if (!msg || !msg.source) continue;
      emails++;
      try {
        const mail = await simpleParser(msg.source);
        const texto = (mail.text || "").trim() || String(mail.html || "").replace(/<[^>]+>/g, " ");
        const assunto = mail.subject || "";
        const r = await chamarIA(PROMPT_VARIOS, `Assunto: ${assunto}\n\n${texto}`.slice(0, 30000), 6000);
        const lista = Array.isArray(r?.ofertas) ? r.ofertas.slice(0, 15) : [];
        for (const x of lista) {
          const link = String(x.link || "").trim();
          if (link && linksExistentes.has(link)) { duplicadas++; continue; }
          const id = "o" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          const agora = new Date().toISOString();
          const o: Record<string, unknown> = { origem: "Alerta de portal", status: "nova", link, anunciante: x.anunciante || "", alerta_assunto: assunto.slice(0, 200), criado: agora, atualizado: agora };
          for (const k of ["tipo", "operacao", "cidade", "uf", "regiao", "titulo", ...NUM]) if (x[k] !== null && x[k] !== undefined) o[k] = NUM.includes(k) ? fmt(k, x[k]) : String(x[k]);
          await salvarRegistro("ofertas", id, o);
          if (link) linksExistentes.add(link);
          criadas++;
        }
        await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
      } catch (e) {
        falhas++;
        console.error("Falha no e-mail", uid, e);
      }
    }
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
  await registrarEmissao({ tipo: "coleta", conteudo: `${emails} e-mail(s) lido(s) · ${criadas} oferta(s) nova(s) · ${duplicadas} repetida(s) · ${falhas} falha(s)` });
  console.log({ emails, criadas, duplicadas, falhas });
};

export const config: Config = { background: true };
