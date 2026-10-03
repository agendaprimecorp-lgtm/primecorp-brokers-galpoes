import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { verifyRequestOrigin } from "@netlify/identity";
import {
  db, json, erro, usuario, ehAdmin, token, novoId, soDig, hoje, env,
  contaPorEmail, contaPorId, salvarConta, mesclarConta, acessoDe, consumirCredito, proximoCodigo, usoMes,
  cnpjValido, cpfValido, asaas, garantirCliente, primeiraFatura,
  chamarIA, chamarIAImagem, PROMPT_AMBIENTE, PROMPT_ANUNCIO, CORRETORES_PRIMECORP,
} from "../../shared/srv.mjs";
import { PLANOS, PLANOS_MENSAIS, TIPOS_CONTA, validarCreci, MENSAGEM_ACESSO } from "../../shared/planos.mjs";
import { progresso, grupo } from "../../../shared/roteiro.mjs";

const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
const MAX_FOTO = 3_000_000;
const lim = (s: unknown, n: number) => String(s ?? "").trim().slice(0, n);
const SITUACOES = ["em_verificacao", "ativo", "inativo", "suspenso", "cancelado", "nao_encontrado"];

/** O que o app pode ver da conta (nunca IDs do Asaas nem dados de outras contas). */
function publicaConta(c: any) {
  return { id: c.id, email: c.email, org_id: c.org_id, tipo: c.tipo, papel: c.org_id === c.id ? "dono" : "membro", nome: c.nome, razao: c.razao || "", documento: c.documento, telefone: c.telefone, whatsapp: c.whatsapp || c.telefone, cor: c.cor || "", creci: c.creci || null, termos_em: c.termos_em };
}
function publicaOrg(o: any) {
  const a = o?.assinatura || {};
  return { nome: o?.razao || o?.nome, tipo: o?.tipo, plano: a.plano || null, status: a.status || null, proximo_vencimento: a.proximo_vencimento || null, fatura_url: a.fatura_url || null, atrasada_desde: a.atrasada_desde || null, creditos: Number(o?.creditos || 0) };
}
async function captacaoDe(id: string, conta: any, admin: boolean) {
  if (!ID_RE.test(id)) return null;
  const r = await db().sql`SELECT id, conta_id, org_id, codigo, dados, criado_em, atualizado_em FROM captacoes WHERE id = ${id} AND excluido = FALSE`;
  const c = r[0]; if (!c) return null;
  const dono = conta.org_id === conta.id;
  if (!admin && !(c.conta_id === conta.id || (dono && c.org_id === conta.org_id))) return null;
  return { ...c.dados, id: c.id, conta_id: c.conta_id, org_id: c.org_id, codigo: c.codigo, criado_em: c.criado_em, atualizado_em: c.atualizado_em };
}
async function salvarCaptacao(c: any) {
  const { id, conta_id, org_id, codigo, criado_em, atualizado_em, ...dados } = c;
  await db().sql`UPDATE captacoes SET dados = ${JSON.stringify(dados)}::jsonb, atualizado_em = NOW() WHERE id = ${id}`;
}
/** Quem aparece como contato no anúncio publicado. */
function contatoAnuncio(conta: any, cap: any) {
  if (conta.tipo === "proprietario") {
    const im = cap.intermediacao;
    if (im?.status === "aceita" && CORRETORES_PRIMECORP[im.corretor as keyof typeof CORRETORES_PRIMECORP]) return { ...CORRETORES_PRIMECORP[im.corretor as keyof typeof CORRETORES_PRIMECORP], tipo: "corretor" };
    return { nome: conta.nome, whatsapp: conta.whatsapp || conta.telefone, tipo: "proprietario" };
  }
  const sit = conta.creci?.situacao;
  const creciOk = sit === "ativo" || sit === "em_verificacao";
  return { nome: conta.nome, whatsapp: conta.whatsapp || conta.telefone, email: conta.email, empresa: conta.tipo === "imobiliaria" ? conta.razao || conta.nome : conta.empresa || "", creci: creciOk ? conta.creci?.formatado || "" : "", titulo: creciOk ? conta.titulo || "Corretor(a) de Imóveis" : "", tipo: "corretor", cor: conta.cor || "" };
}

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const partes = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const [rota, a, b] = partes;
  const u = await usuario();
  if (!u?.email) return erro("Faça login.", 401);
  if (req.method !== "GET") { try { verifyRequestOrigin(req); } catch { return erro("Origem não permitida.", 403); } }
  const email = String(u.email).toLowerCase();
  const admin = ehAdmin(email);
  try {
    let conta = await contaPorEmail(email);

    /* ---------- sessão ---------- */
    if (rota === "eu" && req.method === "GET") {
      if (!conta) { const cv = await db().sql`SELECT org_id FROM convites WHERE email = ${email}`; let convite = null; if (cv[0]) { const o = await contaPorId(cv[0].org_id); convite = o ? { org: o.razao || o.nome } : null; } return json({ email, admin, conta: null, convite }); }
      const ac = await acessoDe(conta, admin);
      return json({ email, admin, conta: publicaConta(conta), org: publicaOrg(ac.org), acesso: { pode: ac.pode, motivo: ac.motivo, restante: ac.restante === Infinity ? null : ac.restante, mensagem: ac.pode ? "" : MENSAGEM_ACESSO[ac.motivo as keyof typeof MENSAGEM_ACESSO] || "" }, planos: PLANOS, uso_mes: await usoMes(conta.org_id) });
    }

    /* ---------- cadastro (o sistema reconhece o tipo de cliente) ---------- */
    if (rota === "cadastro" && req.method === "POST") {
      if (conta) return erro("Cadastro já feito.");
      const body = await req.json().catch(() => ({}));
      if (body.aceite_termos !== true) return erro("Aceite os Termos de Uso e a Política de Privacidade.");
      const nome = lim(body.nome, 120), telefone = lim(body.telefone, 30);
      if (nome.length < 3) return erro("Informe o nome completo.");
      if (soDig(telefone).length < 10) return erro("Informe um WhatsApp válido com DDD.");
      const cv = await db().sql`SELECT org_id FROM convites WHERE email = ${email}`;
      const id = novoId("c");
      if (cv[0]) { // membro de uma imobiliária
        const org = await contaPorId(cv[0].org_id);
        if (!org) return erro("Convite inválido.");
        const nova: any = { id, email, org_id: org.id, tipo: "corretor", nome, telefone, whatsapp: telefone, termos_em: new Date().toISOString(), criado: new Date().toISOString() };
        if (body.creci?.numero) { const v = validarCreci(body.creci.numero, body.creci.uf, "PF"); if (!v.ok) return erro(v.erro); nova.creci = { ...v, situacao: "em_verificacao", informado_em: new Date().toISOString() }; }
        await salvarConta(nova); await db().sql`DELETE FROM convites WHERE email = ${email}`;
        return json({ ok: true, conta: publicaConta(nova) });
      }
      const tipo = String(body.tipo || "");
      if (!(tipo in TIPOS_CONTA)) return erro("Escolha o tipo de conta.");
      const doc = soDig(body.documento);
      if (tipo === "imobiliaria" ? !cnpjValido(doc) : !(cpfValido(doc) || cnpjValido(doc))) return erro(tipo === "imobiliaria" ? "CNPJ inválido." : "CPF inválido.");
      const nova: any = { id, email, org_id: id, tipo, nome, razao: tipo === "imobiliaria" ? lim(body.razao, 160) || nome : "", documento: doc, telefone, whatsapp: telefone, creditos: 0, assinatura: {}, termos_em: new Date().toISOString(), criado: new Date().toISOString() };
      const nat = TIPOS_CONTA[tipo as keyof typeof TIPOS_CONTA].creci;
      if (nat) {
        const v = validarCreci(body.creci?.numero, body.creci?.uf, nat);
        if (!v.ok) return erro(v.erro);
        nova.creci = { ...v, situacao: "em_verificacao", informado_em: new Date().toISOString() };
      }
      await salvarConta(nova);
      return json({ ok: true, conta: publicaConta(nova) });
    }
    /* ---------- administração (Rodrigo e Joselia) ---------- */
    if (rota === "admin") {
      if (!admin) return erro("Somente administradores.", 403);
      if (a === "contas" && req.method === "GET") {
        const r = await db().sql`SELECT id, email, org_id, dados, criado_em FROM contas ORDER BY criado_em DESC LIMIT 500`;
        const usos = await db().sql`SELECT org_id, COUNT(*)::int AS n FROM captacoes WHERE (dados->>'consumo') = 'plano' AND date_trunc('month', criado_em) = date_trunc('month', NOW()) GROUP BY org_id`;
        return json({ contas: r.map((x: any) => ({ id: x.id, email: x.email, org_id: x.org_id, nome: x.dados.nome, razao: x.dados.razao, tipo: x.dados.tipo, documento: x.dados.documento, telefone: x.dados.telefone, creci: x.dados.creci || null, assinatura: { plano: x.dados.assinatura?.plano, status: x.dados.assinatura?.status, atrasada_desde: x.dados.assinatura?.atrasada_desde }, creditos: x.dados.creditos || 0, uso_mes: usos.find((u: any) => u.org_id === x.id)?.n || 0, criado_em: x.criado_em })) });
      }
      if (a === "creci" && b && req.method === "PUT") {
        const c = await contaPorId(b); if (!c?.creci) return erro("Conta sem CRECI.", 404);
        const body = await req.json().catch(() => ({}));
        if (!SITUACOES.includes(body.situacao)) return erro("Situação inválida.");
        await mesclarConta(c.id, { creci: { ...c.creci, situacao: body.situacao, obs: lim(body.obs, 300), verificado_em: new Date().toISOString(), verificado_por: email, ciente_em: c.creci.situacao === body.situacao ? c.creci.ciente_em : null } });
        return json({ ok: true });
      }
      if (a === "creci-doc" && b && req.method === "GET") {
        const c = await contaPorId(b); if (!c?.creci?.doc_k) return erro("Sem documento.", 404);
        const r = await getStore("arquivos").get(c.creci.doc_k, { type: "arrayBuffer" });
        if (!r) return erro("Sem documento.", 404);
        return new Response(r as ArrayBuffer, { headers: { "content-type": c.creci.doc_k.endsWith(".pdf") ? "application/pdf" : "image/jpeg", "cache-control": "private, no-store" } });
      }
      if (a === "intermediacoes" && !b && req.method === "GET") {
        const r = await db().sql`SELECT id, conta_id, captacao_id, dados, criado_em FROM intermediacoes ORDER BY criado_em DESC LIMIT 300`;
        return json({ intermediacoes: r.map((x: any) => ({ id: x.id, captacao_id: x.captacao_id, conta_id: x.conta_id, ...x.dados, criado_em: x.criado_em })) });
      }
      if (a === "intermediacoes" && b && req.method === "PUT") {
        const body = await req.json().catch(() => ({}));
        if (!["aceita", "recusada", "em_contato"].includes(body.status)) return erro("Status inválido.");
        if (body.status === "aceita" && !(body.corretor in CORRETORES_PRIMECORP)) return erro("Escolha o corretor responsável.");
        const r = await db().sql`SELECT captacao_id, dados FROM intermediacoes WHERE id = ${b}`; if (!r[0]) return erro("Não encontrada.", 404);
        const im = { ...r[0].dados, status: body.status, corretor: body.corretor || r[0].dados.corretor, decidido_em: new Date().toISOString(), decidido_por: email, autorizacao_assinada: body.status === "aceita" ? body.autorizacao_assinada === true : false };
        if (body.status === "aceita" && !im.autorizacao_assinada) return erro("Confirme que a autorização de venda/locação foi assinada pelo proprietário.");
        await db().sql`UPDATE intermediacoes SET dados = ${JSON.stringify(im)}::jsonb, atualizado_em = NOW() WHERE id = ${b}`;
        await db().sql`UPDATE captacoes SET dados = jsonb_set(dados, '{intermediacao}', ${JSON.stringify({ id: b, status: im.status, corretor: im.corretor, em: im.em })}::jsonb) WHERE id = ${r[0].captacao_id}`;
        // republica o anúncio com o contato do corretor, se já estiver no ar
        if (body.status === "aceita") await db().sql`UPDATE anuncios SET dados = jsonb_set(dados, '{contato}', ${JSON.stringify({ ...CORRETORES_PRIMECORP[im.corretor as keyof typeof CORRETORES_PRIMECORP], tipo: "corretor" })}::jsonb), atualizado_em = NOW() WHERE captacao_id = ${r[0].captacao_id}`;
        return json({ ok: true });
      }
      if (a === "resumo" && req.method === "GET") {
        const r = await db().sql`SELECT dados FROM contas WHERE org_id = id`;
        let mrr = 0; const porPlano: Record<string, number> = {}; const porStatus: Record<string, number> = {};
        for (const x of r) { const as = x.dados.assinatura || {}; if (as.plano) { porPlano[as.plano] = (porPlano[as.plano] || 0) + 1; porStatus[as.status || "?"] = (porStatus[as.status || "?"] || 0) + 1; if (as.status === "ativa" || as.status === "atrasada") mrr += PLANOS[as.plano as keyof typeof PLANOS]?.preco || 0; } }
        const av = await db().sql`SELECT COUNT(DISTINCT dados->'payment'->>'id')::int AS n FROM pagamentos WHERE evento IN ('PAYMENT_RECEIVED','PAYMENT_CONFIRMED') AND (dados->'payment'->>'externalReference') LIKE 'avulso:%' AND date_trunc('month', criado_em) = date_trunc('month', NOW())`;
        return json({ mrr: Math.round(mrr * 100) / 100, contas: r.length, porPlano, porStatus, avulsos_mes: av[0].n });
      }
    }
    if (!conta) return erro("Complete o cadastro.", 409);
    const dono = conta.org_id === conta.id;

    /* ---------- perfil ---------- */
    if (rota === "perfil" && req.method === "PUT") {
      const body = await req.json().catch(() => ({}));
      const p: any = {};
      if (body.nome !== undefined) { const n = lim(body.nome, 120); if (n.length < 3) return erro("Nome inválido."); p.nome = n; }
      if (body.whatsapp !== undefined) { if (soDig(body.whatsapp).length < 10) return erro("WhatsApp inválido."); p.whatsapp = lim(body.whatsapp, 30); }
      if (body.cor !== undefined) { if (!/^#[0-9a-fA-F]{6}$/.test(body.cor)) return erro("Cor inválida."); p.cor = body.cor; }
      if (body.titulo !== undefined) p.titulo = ["Corretor de Imóveis", "Corretora de Imóveis", "Corretor(a) de Imóveis"].includes(body.titulo) ? body.titulo : "Corretor(a) de Imóveis";
      if (body.creci) {
        if (conta.tipo === "proprietario") return erro("Conta de proprietário não usa CRECI.");
        const v = validarCreci(body.creci.numero, body.creci.uf, conta.tipo === "imobiliaria" ? "PJ" : "PF");
        if (!v.ok) return erro(v.erro);
        if (v.formatado !== conta.creci?.formatado) p.creci = { ...v, situacao: "em_verificacao", informado_em: new Date().toISOString() };
      }
      await mesclarConta(conta.id, p);
      return json({ ok: true, conta: publicaConta({ ...conta, ...p }) });
    }
    if (rota === "creci" && a === "documento" && req.method === "POST") {
      if (!conta.creci) return erro("Informe o CRECI primeiro.");
      const body = await req.json().catch(() => ({}));
      const bin = Buffer.from(String(body.base64 || ""), "base64");
      const ehPdf = bin.slice(0, 4).toString() === "%PDF", ehJpg = bin[0] === 0xff && bin[1] === 0xd8;
      if (!ehPdf && !ehJpg) return erro("Envie foto (JPEG) ou PDF da carteira ou certidão do CRECI.");
      if (bin.length > 5_000_000) return erro("Arquivo grande demais (máx. 5 MB).");
      const k = `creci/${conta.id}.${ehPdf ? "pdf" : "jpg"}`;
      await getStore("arquivos").set(k, new Blob([bin], { type: ehPdf ? "application/pdf" : "image/jpeg" }));
      await mesclarConta(conta.id, { creci: { ...conta.creci, doc_k: k, doc_em: new Date().toISOString(), situacao: conta.creci.situacao === "ativo" ? "ativo" : "em_verificacao" } });
      return json({ ok: true });
    }
    if (rota === "creci" && a === "ciente" && req.method === "POST") {
      if (!conta.creci) return erro("Sem CRECI.");
      await mesclarConta(conta.id, { creci: { ...conta.creci, ciente_em: new Date().toISOString(), ciente_situacao: conta.creci.situacao } });
      return json({ ok: true });
    }

    /* ---------- pagamentos (Asaas) ---------- */
    if (rota === "assinar" && req.method === "POST") {
      if (!dono) return erro("Quem assina é o responsável pela conta.", 403);
      const body = await req.json().catch(() => ({}));
      const plano = PLANOS[String(body.plano) as keyof typeof PLANOS];
      if (!plano || !PLANOS_MENSAIS.includes(plano.id)) return erro("Plano inválido.");
      if (conta.tipo === "proprietario") return erro("Os planos mensais são para quem tem CRECI. Para um imóvel, use o acesso avulso.", 403);
      if (conta.tipo === "corretor" && plano.id !== "autonomo") return erro("Os planos de imobiliária exigem conta de imobiliária (CRECI PJ).", 403);
      if (conta.tipo === "imobiliaria" && plano.id === "autonomo") return erro("Para imobiliária, escolha um plano de equipe.", 403);
      if (plano.id === "imob5" || plano.id === "imob10") {
        const n = await db().sql`SELECT COUNT(*)::int AS n FROM contas WHERE org_id = ${conta.id}`;
        if (n[0].n > plano.usuarios) return erro(`Sua equipe tem ${n[0].n} usuários: escolha um plano maior ou remova usuários.`);
      }
      const ass = conta.assinatura || {};
      const cliente = await garantirCliente(conta);
      let sub = ass.sub;
      if (sub && ["ativa", "atrasada", "pendente"].includes(ass.status)) {
        await asaas(`/subscriptions/${sub}`, { method: "POST", body: { value: plano.preco, description: `Propto · ${plano.nome}`, updatePendingPayments: true } });
      } else {
        const s = await asaas("/subscriptions", { method: "POST", body: { customer: cliente, billingType: "UNDEFINED", value: plano.preco, nextDueDate: hoje(), cycle: "MONTHLY", description: `Propto · ${plano.nome}`, externalReference: `assinatura:${conta.id}` } });
        sub = s.id;
      }
      const fatura = await primeiraFatura(sub);
      const novoStatus = ass.sub === sub && ["ativa", "atrasada"].includes(ass.status) ? ass.status : "pendente";
      await mesclarConta(conta.id, { assinatura: { ...ass, cliente, sub, plano: plano.id, status: novoStatus, fatura_url: fatura, alterada_em: new Date().toISOString() } });
      return json({ ok: true, url: fatura });
    }
    if (rota === "avulso" && req.method === "POST") {
      if (!dono) return erro("Quem compra é o responsável pela conta.", 403);
      const cliente = await garantirCliente(conta);
      const p = await asaas("/payments", { method: "POST", body: { customer: cliente, billingType: "UNDEFINED", value: PLANOS.avulso.preco, dueDate: hoje(), description: "Propto · Anúncio avulso", externalReference: `avulso:${conta.id}` } });
      return json({ ok: true, url: p.invoiceUrl });
    }
    if (rota === "cancelar" && req.method === "POST") {
      if (!dono) return erro("Só o responsável cancela.", 403);
      const ass = conta.assinatura || {};
      if (!ass.sub) return erro("Nenhuma assinatura ativa.");
      await asaas(`/subscriptions/${ass.sub}`, { method: "DELETE" });
      await mesclarConta(conta.id, { assinatura: { ...ass, status: "cancelada", cancelada_em: new Date().toISOString() } });
      return json({ ok: true });
    }

    /* ---------- equipe da imobiliária ---------- */
    if (rota === "equipe") {
      if (!dono || conta.tipo !== "imobiliaria") return erro("Disponível para a conta da imobiliária.", 403);
      if (req.method === "GET") {
        const m = await db().sql`SELECT id, email, dados FROM contas WHERE org_id = ${conta.id} ORDER BY criado_em`;
        const cv = await db().sql`SELECT email, criado_em FROM convites WHERE org_id = ${conta.id} ORDER BY criado_em`;
        return json({ membros: m.map((x: any) => ({ id: x.id, email: x.email, nome: x.dados.nome, creci: x.dados.creci?.formatado || "", dono: x.id === conta.id })), convites: cv });
      }
      if (req.method === "POST") {
        const body = await req.json().catch(() => ({}));
        const e = lim(body.email, 160).toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return erro("E-mail inválido.");
        if (await contaPorEmail(e)) return erro("Esse e-mail já tem conta no Propto.");
        const plano = PLANOS[conta.assinatura?.plano as keyof typeof PLANOS];
        const n = await db().sql`SELECT (SELECT COUNT(*) FROM contas WHERE org_id = ${conta.id}) + (SELECT COUNT(*) FROM convites WHERE org_id = ${conta.id}) AS n`;
        const max = plano?.usuarios || 1;
        if (Number(n[0].n) >= max) return erro(`Seu plano permite ${max} usuário(s). Mude para um plano maior.`);
        await db().sql`INSERT INTO convites (email, org_id) VALUES (${e}, ${conta.id}) ON CONFLICT (email) DO UPDATE SET org_id = EXCLUDED.org_id`;
        return json({ ok: true });
      }
      if (req.method === "DELETE") {
        const e = lim(url.searchParams.get("email"), 160).toLowerCase();
        if (e === conta.email) return erro("Você não pode se remover.");
        await db().sql`DELETE FROM convites WHERE email = ${e} AND org_id = ${conta.id}`;
        const m = await contaPorEmail(e);
        if (m && m.org_id === conta.id) await salvarConta({ ...m, org_id: m.id, tipo: "corretor", creditos: 0, assinatura: {}, removido_de: conta.id });
        return json({ ok: true });
      }
    }

    /* ---------- captações ---------- */
    if (rota === "captacoes" && !a && req.method === "GET") {
      const r = admin && url.searchParams.get("todas") ? await db().sql`SELECT id, conta_id, codigo, dados, criado_em, atualizado_em FROM captacoes WHERE excluido = FALSE ORDER BY criado_em DESC LIMIT 300`
        : dono ? await db().sql`SELECT id, conta_id, codigo, dados, criado_em, atualizado_em FROM captacoes WHERE org_id = ${conta.org_id} AND excluido = FALSE ORDER BY criado_em DESC`
        : await db().sql`SELECT id, conta_id, codigo, dados, criado_em, atualizado_em FROM captacoes WHERE conta_id = ${conta.id} AND excluido = FALSE ORDER BY criado_em DESC`;
      const an = await db().sql`SELECT token, captacao_id, ativo, visitas FROM anuncios WHERE org_id = ${conta.org_id}`;
      return json({ captacoes: r.map((x: any) => { const d = x.dados; const anc = an.find((y: any) => y.captacao_id === x.id); return { id: x.id, codigo: x.codigo, minha: x.conta_id === conta.id, tipo: d.dados?.tipo, operacao: d.dados?.operacao, cidade: d.dados?.cidade, bairro: d.dados?.bairro, titulo: d.anuncio?.titulo || "", status: d.status || "rascunho", fotos: (d.ambientes || []).reduce((s: number, z: any) => s + (z.fotos || []).length, 0), pct: progresso(d).pct, criado_em: x.criado_em, anuncio: anc ? { token: anc.token, ativo: anc.ativo, visitas: anc.visitas } : null }; }) });
    }
    if (rota === "captacoes" && !a && req.method === "POST") {
      const ac = await acessoDe(conta, admin);
      if (!ac.pode) return erro(MENSAGEM_ACESSO[ac.motivo as keyof typeof MENSAGEM_ACESSO] || "Sem acesso para novas captações.", 402, { motivo: ac.motivo });
      let consumo = admin ? "admin" : ac.motivo === "credito" ? "credito" : "plano";
      if (consumo === "credito" && !(await consumirCredito(conta.org_id))) return erro(MENSAGEM_ACESSO.sem_plano, 402, { motivo: "sem_plano" });
      const body = await req.json().catch(() => ({}));
      const id = novoId("cap"); const codigo = await proximoCodigo();
      const dados = { consumo, status: "rascunho", dados: { tipo: lim(body.tipo, 40) || "Casa", operacao: lim(body.operacao, 30) || "Venda", uf: "SP" }, ambientes: [], anuncio: {}, ia_chamadas: 0 };
      await db().sql`INSERT INTO captacoes (id, conta_id, org_id, codigo, dados) VALUES (${id}, ${conta.id}, ${conta.org_id}, ${codigo}, ${JSON.stringify(dados)}::jsonb)`;
      return json({ ok: true, id, codigo });
    }
    if (rota === "captacoes" && a) {
      const cap = await captacaoDe(a, conta, admin);
      if (!cap) return erro("Captação não encontrada.", 404);
      if (req.method === "GET") { const an = await db().sql`SELECT token, ativo, visitas FROM anuncios WHERE captacao_id = ${cap.id}`; return json({ captacao: cap, progresso: progresso(cap), anuncio_publicado: an[0] || null }); }
      if (req.method === "PUT") {
        const body = await req.json().catch(() => ({}));
        const d = typeof body.dados === "object" && body.dados ? body.dados : cap.dados;
        const ambs = Array.isArray(body.ambientes) ? body.ambientes.slice(0, 60) : cap.ambientes;
        const fotoOk = (k: string) => typeof k === "string" && k.startsWith(`fotos/${cap.org_id}/${cap.id}/`);
        for (const x of ambs) x.fotos = (x.fotos || []).filter((f: any) => fotoOk(f.k)).slice(0, 12);
        const novo = { ...cap, dados: Object.fromEntries(Object.entries(d).map(([k, v]) => [lim(k, 40), typeof v === "number" ? v : lim(v, 2000)])), ambientes: ambs, anuncio: typeof body.anuncio === "object" && body.anuncio ? body.anuncio : cap.anuncio, fala_geral: body.fala_geral !== undefined ? lim(body.fala_geral, 6000) : cap.fala_geral };
        if (JSON.stringify(novo).length > 400_000) return erro("Captação grande demais.");
        await salvarCaptacao(novo);
        return json({ ok: true, progresso: progresso(novo) });
      }
      if (req.method === "DELETE") {
        if (!dono && cap.conta_id !== conta.id) return erro("Sem permissão.", 403);
        await db().sql`UPDATE captacoes SET excluido = TRUE WHERE id = ${cap.id}`; await db().sql`UPDATE anuncios SET ativo = FALSE WHERE captacao_id = ${cap.id}`;
        return json({ ok: true });
      }
    }

    /* ---------- fotos ---------- */
    if (rota === "fotos" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const cap = await captacaoDe(String(body.captacao || ""), conta, admin);
      if (!cap) return erro("Captação inválida.");
      const bin = Buffer.from(String(body.jpeg_base64 || ""), "base64");
      if (bin.length < 200 || bin[0] !== 0xff || bin[1] !== 0xd8) return erro("Foto inválida (JPEG).");
      if (bin.length > MAX_FOTO) return erro("Foto grande demais.");
      const k = `fotos/${cap.org_id}/${cap.id}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      await getStore("fotos").set(k, new Blob([bin], { type: "image/jpeg" }));
      return json({ ok: true, k });
    }
    if (rota === "foto" && (req.method === "GET" || req.method === "DELETE")) {
      const k = String(url.searchParams.get("k") || "");
      const m = k.match(/^fotos\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\/[a-z0-9-]+\.jpg$/);
      if (!m) return erro("Foto inválida.");
      if (!admin && m[1] !== conta.org_id) return erro("Foto não encontrada.", 404);
      if (req.method === "DELETE") { await getStore("fotos").delete(k); return json({ ok: true }); }
      const r = await getStore("fotos").get(k, { type: "arrayBuffer" });
      if (!r) return erro("Foto não encontrada.", 404);
      return new Response(r as ArrayBuffer, { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=86400" } });
    }

    /* ---------- IA ---------- */
    if (rota === "ia" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const cap = await captacaoDe(String(body.captacao || ""), conta, admin);
      if (!cap) return erro("Captação inválida.");
      const n = Number(cap.ia_chamadas || 0);
      if (n >= 80 && !admin) return erro("Limite de uso da IA nesta captação atingido.", 429);
      await db().sql`UPDATE captacoes SET dados = jsonb_set(dados, '{ia_chamadas}', to_jsonb(${n + 1}::int)) WHERE id = ${cap.id}`;
      if (a === "ambiente") {
        const imgs = (Array.isArray(body.imagens) ? body.imagens : []).map(String).filter((x: string) => x.length > 100 && x.length < 1_500_000).slice(0, 3);
        const fala = lim(body.fala, 4000);
        if (!imgs.length && fala.length < 3) return erro("Envie uma foto ou a fala do ambiente.");
        return json(await chamarIAImagem(PROMPT_AMBIENTE + `\nTipo de imóvel: ${lim(cap.dados?.tipo, 40)}. Item do roteiro: ${lim(body.item, 60) || "livre"}.`, fala, imgs));
      }
      if (a === "anuncio") {
        const txt = JSON.stringify({ ficha: cap.dados, ambientes: (cap.ambientes || []).map((x: any) => ({ nome: x.nome, descricao: x.descricao, caracteristicas: x.caracteristicas, fala: x.fala })), fala_geral: cap.fala_geral || "" }).slice(0, 24000);
        return json(await chamarIA(PROMPT_ANUNCIO + (conta.tipo === "proprietario" ? "\nO anúncio é do próprio proprietário (venda direta)." : ""), txt));
      }
    }

    /* ---------- publicar landing ---------- */
    if (rota === "publicar" && a) {
      const cap = await captacaoDe(a, conta, admin);
      if (!cap) return erro("Captação não encontrada.", 404);
      if (req.method === "DELETE") { await db().sql`UPDATE anuncios SET ativo = FALSE, atualizado_em = NOW() WHERE captacao_id = ${cap.id}`; return json({ ok: true }); }
      const body = await req.json().catch(() => ({}));
      if (body.declaracao !== true) return erro(conta.tipo === "proprietario" ? "Confirme que você é o proprietário ou está autorizado por ele." : "Confirme que tem autorização do proprietário para divulgar.");
      if (!cap.anuncio?.titulo) return erro("Gere ou escreva o anúncio antes de publicar.");
      const autor = cap.conta_id === conta.id ? conta : await contaPorId(cap.conta_id);
      const d = cap.dados || {};
      const fotos: any[] = []; for (const amb of cap.ambientes || []) for (const f of amb.fotos || []) fotos.push({ k: f.k, ambiente: amb.nome });
      const ex = await db().sql`SELECT token FROM anuncios WHERE captacao_id = ${cap.id}`;
      const tk = ex[0]?.token || token(18);
      const snap = { codigo: cap.codigo, tipo: d.tipo, operacao: d.operacao, cidade: d.cidade, uf: d.uf, bairro: d.bairro, grupo: grupo(d.tipo), titulo: cap.anuncio.titulo, subtitulo: cap.anuncio.subtitulo || "", descricao: cap.anuncio.descricao || "", destaques: (cap.anuncio.destaques || []).slice(0, 10),
        numeros: { venda: d.venda, aluguel: d.aluguel, condominio: d.condominio, iptu: d.iptu, construida: d.construida, terreno: d.terreno, area_ha: d.area_ha, dormitorios: d.dormitorios, suites: d.suites, banheiros: d.banheiros, vagas: d.vagas, pe_direito: d.pe_direito, docas: d.docas },
        fotos: fotos.slice(0, 60), ambientes: (cap.ambientes || []).map((x: any) => ({ nome: x.nome, descricao: x.descricao || "" })), contato: contatoAnuncio(autor, cap), declaracao: { por: conta.email, em: new Date().toISOString() } };
      await db().sql`INSERT INTO anuncios (token, captacao_id, org_id, dados, ativo) VALUES (${tk}, ${cap.id}, ${cap.org_id}, ${JSON.stringify(snap)}::jsonb, TRUE)
        ON CONFLICT (token) DO UPDATE SET dados = EXCLUDED.dados, ativo = TRUE, atualizado_em = NOW()`;
      await salvarCaptacao({ ...cap, status: "publicada" });
      return json({ ok: true, token: tk, url: `${(env("URL_PUBLICA") || url.origin).replace(/\/$/, "")}/a/${tk}` });
    }

    /* ---------- proprietário pede a intermediação da PrimeCorp ---------- */
    if (rota === "intermediacao" && a && req.method === "POST") {
      if (conta.tipo !== "proprietario") return erro("Disponível para proprietários sem CRECI.", 403);
      const cap = await captacaoDe(a, conta, admin);
      if (!cap) return erro("Captação não encontrada.", 404);
      if (cap.intermediacao) return erro("Pedido já enviado.");
      const body = await req.json().catch(() => ({}));
      const id = novoId("im");
      const im = { status: "solicitada", em: new Date().toISOString(), obs: lim(body.obs, 600), corretor: grupo(cap.dados?.tipo) === "residencial" ? "joselia" : "rodrigo" };
      await db().sql`INSERT INTO intermediacoes (id, conta_id, captacao_id, dados) VALUES (${id}, ${conta.id}, ${cap.id}, ${JSON.stringify({ ...im, codigo: cap.codigo, nome: conta.nome, telefone: conta.telefone, email: conta.email, tipo: cap.dados?.tipo, cidade: cap.dados?.cidade })}::jsonb)`;
      await salvarCaptacao({ ...cap, intermediacao: { ...im, id } });
      return json({ ok: true });
    }

    return erro("Rota não encontrada.", 404);
  } catch (e: any) {
    console.error(e);
    return erro(e?.status && e.status < 600 ? e.message : "Erro interno. Tente novamente.", e?.status || 500);
  }
};

export const config: Config = { path: "/api/*", rateLimit: { windowLimit: 240, windowSize: 60, aggregateBy: ["ip", "domain"] } };
