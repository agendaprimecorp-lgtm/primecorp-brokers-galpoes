// API do app para clientes da Propto (cada conta só enxerga e grava os próprios dados).
// Chamada por netlify/functions/api.mts quando o usuário logado é membro de uma conta.
import { getStore } from "@netlify/blobs";
import {
  COLECOES, db, json, erro, env, registrarEmissao,
  chamarIA, chamarIAImagem, limparAmbiente, limparAnuncio, lerAnuncio, buscarSeguro, PROMPT_UM, PROMPT_VARIOS, PROMPT_AMBIENTE, PROMPT_ANUNCIO,
} from "./servidor.mjs";
import { varrer } from "./varredura.mjs";
import V from "./verif.mjs";
import {
  PLANOS, TESTE, FUNDADOR, COLECOES_CONTA, situacao, limites, periodoUso, usoDe, consumir, msgLimite, resumoConta, gravarConta, obterConta,
  listarDaConta, salvarDaConta, obterDaConta, existiuNaConta, excluirDaConta, precoFundador, somarMeses, dataISO, emailEmUso, brl,
} from "./contas.mjs";
import { asaasConfigurado, asaasProducao, criarCliente, criarAssinatura, faturaAberta, cancelarAssinatura, documentoValido } from "./asaas.mjs";
import { criarUsuarioIdentity } from "./identidade.mjs";
import { avisarOuEnfileirar } from "./zoe-run.mjs";

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_PDF = 4 * 1024 * 1024;
const MAX_FOTO = 3 * 1024 * 1024;
const MAX_MAT = 4_300_000;
const MAT_TIPOS = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const FOTO_RE = /^fotos\/([A-Za-z0-9_-]{1,80})\/[\w-]{6,40}\.jpg$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
const idUsuario = (email) => "u_" + String(email).toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 60);
const limpo = (s, n = 120) => String(s ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, n);

export function planosPublicos(c) {
  const fundador = !!c && situacao(c).codigo === "teste" && !c.asaas?.assinatura;
  return Object.fromEntries(Object.entries(PLANOS).map(([k, p]) => [k, { ...p, preco_fundador: precoFundador(k), fundador }]));
}

export async function apiConta({ req, url, partes, u, cx }) {
  const [rota, a, b] = partes;
  const email = String(u.email).toLowerCase();
  const dono = cx.membro?.papel === "admin";
  if (cx.membro && cx.membro.ativo === false) return erro("Seu acesso a esta conta foi desativado pelo responsável.", 403);
  const agora = new Date();
  const sit = situacao(cx, agora);
  const exigeEscrita = () => (sit.escrita ? null : erro(sit.msg || "Conta sem permissão de gravação.", 402));
  const C = cx.id;

  /* ---------- status ---------- */
  if (rota === "status" && req.method === "GET") {
    const uso = await usoDe(C, periodoUso(cx, agora));
    const m = cx.membro || {};
    return json({
      usuario: email, papel: dono ? "admin" : "corretor",
      perfil: { nome: m.nome || "", creci: m.creci || "", telefone: m.telefone || "", email },
      conta: resumoConta(cx, uso, agora), planos: planosPublicos(cx), teste: TESTE, fundador: FUNDADOR,
      cobranca: { configurada: asaasConfigurado(), producao: asaasProducao() },
      suporte: (env("PROPTO_WHATSAPP") || "(19) 99805-1985"),
    });
  }

  /* ---------- dados ---------- */
  if (rota === "dados" && req.method === "GET" && !a) {
    const rows = await listarDaConta(C, false);
    const out = {}; COLECOES.forEach((c) => (out[c] = []));
    for (const r of rows) if (out[r.colecao]) out[r.colecao].push({ ...r.dados, id: r.id, _atualizado: r.atualizado_em });
    out.usuarios = (cx.membros || []).map((m) => ({ id: idUsuario(m.email), email: m.email, nome: m.nome, creci: m.creci, telefone: m.telefone, papel: m.papel === "admin" ? "admin" : "corretor", foco: m.foco || "residencial", titulo: m.titulo || "", ativo: m.ativo !== false }));
    return json(out);
  }
  if (rota === "dados" && a && b) {
    if (!COLECOES_CONTA.includes(a)) return erro("Esta área não faz parte do seu plano.", 403);
    if (!ID_RE.test(b)) return erro("Identificador inválido.");
    if (a === "config" && !dono) return erro("Somente o responsável pela conta altera as configurações.", 403);
    if (req.method === "DELETE") {
      if (!dono) return erro("Somente o responsável pela conta exclui registros.", 403);
      await excluirDaConta(C, a, b); return json({ ok: true });
    }
    if (req.method === "PUT") {
      const bloq = exigeEscrita(); if (bloq) return bloq;
      const body = await req.json().catch(() => null);
      if (!body || typeof body !== "object" || Array.isArray(body)) return erro("Corpo inválido.");
      const dados = { ...body }; delete dados.id; delete dados._atualizado;
      const ant = await obterDaConta(C, a, b);
      // Link público de anúncio é único no sistema: ninguém publica com o token de outra conta (nem da PrimeCorp).
      if (a === "anuncios" && !ant) {
        if (!/^[A-Za-z0-9_-]{16,64}$/.test(b)) return erro("Identificador de anúncio inválido.");
        const dono = await db().sql`SELECT 1 FROM registros_conta WHERE colecao = 'anuncios' AND id = ${b} AND conta <> ${C} UNION ALL SELECT 1 FROM registros WHERE colecao = 'anuncios' AND id = ${b} LIMIT 1`;
        if (dono.length) return erro("Identificador de anúncio já usado.", 409);
      }
      if (a === "ofertas" && !ant && !(await existiuNaConta(C, a, b))) {
        const l = await consumir(cx, "imoveis", 1, agora);
        if (!l.ok) return erro(msgLimite(cx, "imoveis", l), 402);
      }
      if (a === "ofertas" && ant?.verificacao) {
        const carimbo = (v) => [v?.varrido_em, v?.matricula?.lida_em, v?.iptu?.lida_em, v?.rural?.lida_em, v?.leitura?.em].filter(Boolean).sort().pop() || "";
        if (carimbo(ant.verificacao) > carimbo(dados.verificacao)) dados.verificacao = ant.verificacao;
      }
      dados.criado_por = (ant && ant.criado_por) || dados.criado_por || email;
      dados.atualizado_por = email;
      if (JSON.stringify(dados).length > 400_000) return erro("Registro grande demais.");
      const r = await salvarDaConta(C, a, b, dados);
      return json({ ok: true, atualizado: r.atualizado_em });
    }
  }

  /* ---------- código do imóvel (sequência própria da conta) ---------- */
  if (rota === "codigo" && req.method === "POST") {
    const r = await db().sql`INSERT INTO uso_conta (conta, recurso, periodo, n) VALUES (${C}, 'codigo', 'seq', 1)
      ON CONFLICT (conta, recurso, periodo) DO UPDATE SET n = uso_conta.n + 1 RETURNING n`;
    return json({ codigo: "PT-" + String(r[0].n).padStart(4, "0") });
  }

  /* ---------- emissões ---------- */
  if (rota === "emissoes" && req.method === "GET") {
    const lim = Math.min(1000, Math.max(1, Number(url.searchParams.get("limite")) || 300));
    const rows = await db().sql`SELECT id, codigo, tipo, negocio_id, oferta_id, briefing_id, contato_id, sala_id, destinatario, conteudo, arquivo, meta, criado_em FROM emissoes WHERE conta = ${C} ORDER BY criado_em DESC LIMIT ${lim}`;
    return json({ emissoes: rows });
  }
  if (rota === "emissoes" && req.method === "POST") {
    const body = await req.json().catch(() => null);
    if (!body || !body.tipo) return erro("Informe o tipo da emissão.");
    let arquivo = null;
    if (body.pdf_base64) {
      const bin = Buffer.from(String(body.pdf_base64), "base64");
      if (bin.length > MAX_PDF) return erro("PDF grande demais.");
      if (bin.subarray(0, 4).toString() !== "%PDF") return erro("Arquivo não é PDF.");
      arquivo = `pdf/${C}_${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`;
      await getStore("arquivos").set(arquivo, new Blob([bin], { type: "application/pdf" }), { metadata: { nome: String(body.nome_arquivo || "ficha.pdf"), conta: C } });
    }
    const r = await registrarEmissao({ ...body, codigo: undefined, arquivo, conta: C, meta: { ...(body.meta || {}), usuario: email } });
    return json({ ok: true, ...r, arquivo });
  }
  if (rota === "arquivo" && req.method === "GET") {
    const chave = url.searchParams.get("k") || "";
    const m = chave.match(/^mat\/([\w-]+)\/[\w-]+\.(pdf|jpg|png|webp)$/);
    const nosso = (chave.startsWith(`pdf/${C}_`) && /^pdf\/[\w.-]+\.pdf$/.test(chave)) || (m && (await obterDaConta(C, "ofertas", m[1])));
    if (!nosso) return erro("Arquivo inválido.");
    const r = await getStore("arquivos").getWithMetadata(chave, { type: "arrayBuffer" });
    if (!r) return erro("Arquivo não encontrado.", 404);
    const meta = r.metadata || {};
    const nome = String(meta.nome || "ficha.pdf").replace(/[^\w.-]/g, "_");
    return new Response(r.data, { headers: { "content-type": String(meta.tipo || "application/pdf"), "content-disposition": `attachment; filename="${nome}"`, "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  }

  /* ---------- IA (conta no limite de uso) ---------- */
  const usarIA = async () => { const l = await consumir(cx, "ia", 1, agora); return l.ok ? null : erro(msgLimite(cx, "ia", l), 402); };
  if (rota === "extrair" && req.method === "POST") {
    const bloq = exigeEscrita() || (await usarIA()); if (bloq) return bloq;
    const body = await req.json().catch(() => null);
    let texto = String(body?.texto || "").trim();
    const modo = body?.modo === "varios" ? "varios" : "um";
    let lido = null;
    if (modo === "um" && texto.length < 40 && body?.url) {
      try { lido = await lerAnuncio(String(body.url)); texto = lido.texto; lido.doTexto = true; } catch (e) { return erro("Não consegui ler pelo link: " + (e?.message || String(e)) + ". Abra o anúncio, copie o texto e cole aqui.", 422); }
    }
    if (texto.length < 40) return erro("Texto curto demais.");
    else if (modo === "um" && body?.url && !lido) { try { lido = await lerAnuncio(String(body.url)); } catch {} }
    const r = await chamarIA(modo === "varios" ? PROMPT_VARIOS : PROMPT_UM, texto.slice(0, modo === "varios" ? 30000 : 16000), modo === "varios" ? 6000 : 3000);
    return json(lido ? { ...r, ...(lido.doTexto ? { _lido_pelo_link: true } : {}), imagens_ref: lido.imagens, contatos_ref: lido.contatos } : r);
  }
  if (rota === "img-ref" && req.method === "GET") {
    const alvo = String(url.searchParams.get("u") || "");
    try {
      const r = await buscarSeguro(alvo, { aceita: /^image\/(jpeg|jpg|png|webp)/i, max: 6_000_000, tempo: 10000, accept: "image/avif,image/webp,image/*;q=0.8", referer: url.searchParams.get("de") || undefined });
      return new Response(r.buf, { headers: { "content-type": r.tipo, "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" } });
    } catch (e) { return erro("Imagem indisponível: " + (e?.message || ""), 422); }
  }
  if (rota === "ia" && a === "ambiente" && req.method === "POST") {
    const bloq = exigeEscrita() || (await usarIA()); if (bloq) return bloq;
    const body = await req.json().catch(() => null);
    const imgs = (Array.isArray(body?.imagens) ? body.imagens : []).map(String).filter((x) => x.length > 100 && x.length < 1_500_000).slice(0, 3);
    const fala = String(body?.fala || "").slice(0, 4000);
    if (!imgs.length && fala.length < 3) return erro("Envie ao menos uma foto ou a fala do ambiente.");
    const r = limparAmbiente(await chamarIAImagem(PROMPT_AMBIENTE + `\nTipo de imóvel: ${String(body?.tipo || "não informado").slice(0, 60)}.` + (body?.item ? ` Item do roteiro: ${String(body.item).slice(0, 60)} (se a foto mostrar outro ambiente, diga em foto.problemas).` : ""), fala, imgs, 1200));
    return json(r);
  }
  if (rota === "ia" && a === "anuncio" && req.method === "POST") {
    const bloq = exigeEscrita() || (await usarIA()); if (bloq) return bloq;
    const body = await req.json().catch(() => null);
    const txt = JSON.stringify({ ficha: body?.ficha || {}, ambientes: body?.ambientes || [], fala_geral: body?.fala_geral || "" }).slice(0, 24000);
    const r = limparAnuncio(await chamarIA(PROMPT_ANUNCIO, txt, 2500));
    if (!r.titulo && !r.descricao) return erro("A IA não devolveu o anúncio. Tente de novo.", 502);
    return json(r);
  }

  /* ---------- fotos (só de imóveis da própria conta) ---------- */
  if (rota === "fotos" && req.method === "POST") {
    const bloq = exigeEscrita(); if (bloq) return bloq;
    const body = await req.json().catch(() => null);
    const of = String(body?.oferta || "");
    if (!ID_RE.test(of) || !(await obterDaConta(C, "ofertas", of))) return erro("Imóvel inválido.");
    const bin = Buffer.from(String(body?.jpeg_base64 || ""), "base64");
    if (bin.length < 200 || bin[0] !== 0xff || bin[1] !== 0xd8) return erro("Foto inválida (JPEG).");
    if (bin.length > MAX_FOTO) return erro("Foto grande demais.");
    const k = `fotos/${of}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    await getStore("fotos").set(k, new Blob([bin], { type: "image/jpeg" }), { metadata: { por: email, conta: C, em: agora.toISOString() } });
    return json({ ok: true, k });
  }
  if (rota === "foto" || rota === "fotos") {
    const k = url.searchParams.get("k") || ""; const m = k.match(FOTO_RE);
    if (!m || !(await obterDaConta(C, "ofertas", m[1]))) return erro("Foto inválida.");
    if (req.method === "GET") {
      const r = await getStore("fotos").get(k, { type: "arrayBuffer" });
      if (!r) return erro("Foto não encontrada.", 404);
      return new Response(r, { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=86400" } });
    }
    if (req.method === "DELETE") { await getStore("fotos").delete(k); return json({ ok: true }); }
  }

  /* ---------- verificação ---------- */
  if (rota === "verificar" && a && req.method === "POST") {
    const bloq = exigeEscrita(); if (bloq) return bloq;
    if (!ID_RE.test(a)) return erro("Imóvel inválido.");
    const o = await obterDaConta(C, "ofertas", a); if (!o) return erro("Imóvel não encontrado.", 404);
    const fontes = await varrer(o);
    const at = (await obterDaConta(C, "ofertas", a)) || o;
    const verificacao = { ...(at.verificacao || {}), fontes: { ...((at.verificacao || {}).fontes || {}), ...fontes }, varrido_em: new Date().toISOString(), varrido_por: email };
    const novo = { ...at, verificacao, atualizado: new Date().toISOString() };
    await salvarDaConta(C, "ofertas", a, novo);
    return json({ ok: true, verificacao, avaliacao: V.avaliar(novo) });
  }
  if ((rota === "matricula" || rota === "documento") && a && req.method === "POST") {
    const bloq = exigeEscrita(); if (bloq) return bloq;
    if (!ID_RE.test(a)) return erro("Imóvel inválido.");
    const o = await obterDaConta(C, "ofertas", a); if (!o) return erro("Imóvel não encontrado.", 404);
    const body = await req.json().catch(() => null);
    const tipo = String(body?.tipo || ""); const ext = MAT_TIPOS[tipo];
    if (!ext) return erro("Envie PDF, JPG, PNG ou WEBP.");
    const bin = Buffer.from(String(body?.base64 || ""), "base64");
    if (bin.length < 500) return erro("Arquivo vazio.");
    if (bin.length > MAX_MAT) return erro("Arquivo acima de 4 MB: envie só as páginas necessárias em PDF ou fotos de cada página.");
    if (ext === "pdf" && bin.subarray(0, 4).toString() !== "%PDF") return erro("Arquivo não é PDF.");
    if (ext === "jpg" && !(bin[0] === 0xff && bin[1] === 0xd8)) return erro("Arquivo não é JPEG.");
    if (ext === "png" && bin.subarray(1, 4).toString() !== "PNG") return erro("Arquivo não é PNG.");
    const l = await consumir(cx, "docs", 1, agora); if (!l.ok) return erro(msgLimite(cx, "docs", l), 402);
    const chave = `mat/${a}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
    await getStore("arquivos").set(chave, new Blob([bin], { type: tipo }), { metadata: { nome: `Documento_${o.codigo || a}.${ext}`, tipo, por: email, conta: C } });
    await salvarDaConta(C, "ofertas", a, { ...o, verificacao: { ...(o.verificacao || {}), leitura: { status: "lendo", em: agora.toISOString(), arquivo: chave } }, atualizado: agora.toISOString() });
    const r = await fetch(new URL("/.netlify/functions/matricula-background", env("URL") || url.origin), { method: "POST", headers: { "x-coleta-segredo": env("COLETA_SEGREDO") || "", "content-type": "application/json" }, body: JSON.stringify({ oferta: a, chave, tipo, usuario: email, conta: C }) }).catch(() => null);
    return json({ ok: true, chave, status: "lendo", acionado: !!(r && (r.status === 202 || r.ok)) });
  }

  /* ---------- conta: plano, assinatura, equipe, perfil, exportação ---------- */
  if (rota === "conta") {
    if (!a && req.method === "GET") return json({ conta: resumoConta(cx, await usoDe(C, periodoUso(cx, agora)), agora), planos: planosPublicos(cx) });

    if (a === "assinar" && req.method === "POST") {
      if (!dono) return erro("Somente o responsável pela conta assina o plano.", 403);
      if (!asaasConfigurado()) return erro("A cobrança online está sendo ativada. Fale com a equipe Propto pelo WhatsApp para assinar agora.", 503);
      const body = await req.json().catch(() => null);
      const plano = String(body?.plano || ""); const ciclo = body?.ciclo === "anual" ? "anual" : "mensal";
      if (!PLANOS[plano]) return erro("Plano inválido.");
      if (plano === "corretor" && cx.tipo === "imobiliaria" && (cx.membros || []).filter((m) => m.ativo !== false).length > PLANOS.corretor.usuarios) return erro("O plano Corretor é para 1 usuário. Desative os outros usuários ou escolha o plano Imobiliária.");
      const documento = String(body?.documento || cx.documento || "").replace(/\D/g, "");
      if (!documentoValido(documento)) return erro("Informe um CPF ou CNPJ válido para a nota fiscal.");
      const nomeFatura = limpo(body?.nome_fatura || cx.empresa || cx.nome, 120);
      if (cx.asaas?.assinatura) {
        if (cx.asaas.plano === plano && cx.asaas.ciclo === ciclo) { const f = await faturaAberta(cx.asaas.assinatura).catch(() => null); return json({ ok: true, fatura: f || cx.asaas.fatura || null }); }
        try { await cancelarAssinatura(cx.asaas.assinatura); } catch (e) { console.error("Cancelar assinatura anterior:", e); }
      }
      const fundador = situacao(cx, agora).codigo === "teste" && !cx.asaas?.assinatura && ciclo === "mensal";
      const valor = ciclo === "anual" ? PLANOS[plano].anual : fundador ? precoFundador(plano) : PLANOS[plano].preco;
      const fimTeste = new Date(cx.teste_fim);
      const venc = dataISO(fimTeste > agora ? fimTeste : agora);
      const dono0 = (cx.membros || []).find((m) => m.papel === "admin") || cx.membro || {};
      let cliente = cx.asaas?.cliente;
      if (!cliente) cliente = (await criarCliente({ nome: nomeFatura, documento, email: dono0.email || email, fone: String(dono0.telefone || "").replace(/\D/g, ""), conta: C })).id;
      const ass = await criarAssinatura({ cliente, valor, ciclo: ciclo === "anual" ? "YEARLY" : "MONTHLY", vencimento: venc, descricao: `Propto Imóveis · plano ${PLANOS[plano].nome} (${ciclo})${fundador ? " · desconto de fundador por 12 meses" : ""}`, conta: C });
      const fatura = await faturaAberta(ass.id).catch(() => null);
      const novo = { ...cx, plano, ciclo, documento, empresa: cx.empresa || nomeFatura, cancelamento_em: null,
        asaas: { cliente, assinatura: ass.id, plano, ciclo, valor, fundador, fundador_ate: fundador ? somarMeses(venc + "T12:00:00Z", FUNDADOR.meses) : null, criada_em: agora.toISOString(), fatura } };
      await gravarConta(C, novo);
      await registrarEmissao({ tipo: "assinatura", conta: C, conteudo: `Plano ${PLANOS[plano].nome} (${ciclo}) · ${brl(valor)}${fundador ? " com desconto de fundador" : ""} · 1º vencimento ${venc.split("-").reverse().join("/")}`, meta: { usuario: email, assinatura: ass.id } }).catch(() => null);
      await avisarOuEnfileirar(`Propto · ${cx.nome} escolheu o plano ${PLANOS[plano].nome} (${ciclo}) · ${brl(valor)}${fundador ? " (fundador)" : ""} · 1º vencimento ${venc.split("-").reverse().join("/")}.`).catch(() => null);
      return json({ ok: true, fatura, valor, vencimento: venc, fundador });
    }

    if (a === "fatura" && req.method === "GET") {
      if (!cx.asaas?.assinatura) return erro("Nenhum plano assinado ainda.", 404);
      const f = await faturaAberta(cx.asaas.assinatura).catch(() => null);
      if (f) { await gravarConta(C, { ...cx, asaas: { ...cx.asaas, fatura: f } }); }
      return json({ fatura: f || cx.asaas.fatura || null });
    }

    if (a === "cancelar" && req.method === "POST") {
      if (!dono) return erro("Somente o responsável pela conta cancela o plano.", 403);
      const body = await req.json().catch(() => null);
      if (body?.confirmacao !== "CANCELAR") return erro("Confirme o cancelamento.");
      if (cx.asaas?.assinatura) { try { await cancelarAssinatura(cx.asaas.assinatura); } catch (e) { return erro(e.message, 502); } }
      await gravarConta(C, { ...cx, cancelamento_em: agora.toISOString(), asaas: { ...(cx.asaas || {}), assinatura: null, cancelada: cx.asaas?.assinatura || null } });
      await registrarEmissao({ tipo: "cancelamento", conta: C, conteudo: "Assinatura cancelada pelo cliente", meta: { usuario: email, motivo: limpo(body?.motivo, 300) } }).catch(() => null);
      await avisarOuEnfileirar(`Propto · ${cx.nome} cancelou a assinatura${body?.motivo ? " · motivo: " + limpo(body.motivo, 200) : ""}.`).catch(() => null);
      return json({ ok: true });
    }

    if (a === "membros" && req.method === "POST") {
      if (!dono) return erro("Somente o responsável pela conta cadastra usuários.", 403);
      const bloq = exigeEscrita(); if (bloq) return bloq;
      const body = await req.json().catch(() => null);
      const em = String(body?.email || "").trim().toLowerCase();
      const nome = limpo(body?.nome, 100);
      if (!EMAIL_RE.test(em)) return erro("E-mail inválido.");
      if (nome.length < 3) return erro("Informe o nome.");
      const ativos = (cx.membros || []).filter((m) => m.ativo !== false);
      const ja = (cx.membros || []).find((m) => m.email === em);
      if (!ja && ativos.length >= limites(cx).usuarios) return erro(`Seu plano permite ${limites(cx).usuarios} usuário(s). Mude de plano para incluir mais pessoas.`, 402);
      if (!ja && (await emailEmUso(em))) return erro("Este e-mail já usa a Propto em outra conta.", 409);
      const membro = { email: em, nome, creci: limpo(body?.creci, 30), telefone: limpo(body?.telefone, 20), papel: body?.papel === "admin" ? "admin" : "corretor", foco: body?.foco === "comercial" ? "comercial" : "residencial", ativo: true, desde: agora.toISOString() };
      if (!ja) {
        const senha = "Pt" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + "!9";
        try { await criarUsuarioIdentity(em, senha, { conta: C, nome }); }
        catch (e) { if (e.status !== 409) return erro("Não foi possível criar o acesso: " + e.message, 502); }
      }
      const membros = ja ? cx.membros.map((m) => (m.email === em ? { ...m, ...membro, desde: m.desde } : m)) : [...(cx.membros || []), membro];
      await gravarConta(C, { ...cx, membros });
      return json({ ok: true, novo: !ja });
    }
    if (a === "membros" && b && req.method === "PUT") {
      if (!dono) return erro("Somente o responsável pela conta altera usuários.", 403);
      const em = decodeURIComponent(b).toLowerCase();
      const m = (cx.membros || []).find((x) => x.email === em); if (!m) return erro("Usuário não encontrado.", 404);
      const body = await req.json().catch(() => null) || {};
      if (em === email && (body.ativo === false || body.papel === "corretor")) return erro("Você não pode tirar o seu próprio acesso de responsável.");
      if (body.ativo === true && m.ativo === false && (cx.membros || []).filter((x) => x.ativo !== false).length >= limites(cx).usuarios) return erro(`Seu plano permite ${limites(cx).usuarios} usuário(s).`, 402);
      const novo = { ...m, ...(body.nome ? { nome: limpo(body.nome, 100) } : {}), ...(body.creci !== undefined ? { creci: limpo(body.creci, 30) } : {}), ...(body.telefone !== undefined ? { telefone: limpo(body.telefone, 20) } : {}),
        ...(body.papel ? { papel: body.papel === "admin" ? "admin" : "corretor" } : {}), ...(typeof body.ativo === "boolean" ? { ativo: body.ativo } : {}), ...(body.foco ? { foco: body.foco === "comercial" ? "comercial" : "residencial" } : {}) };
      await gravarConta(C, { ...cx, membros: cx.membros.map((x) => (x.email === em ? novo : x)) });
      return json({ ok: true });
    }
    if (a === "perfil" && req.method === "PUT") {
      const body = await req.json().catch(() => null) || {};
      const membros = (cx.membros || []).map((m) => (m.email === email ? { ...m, nome: limpo(body.nome || m.nome, 100), creci: limpo(body.creci ?? m.creci, 30), telefone: limpo(body.telefone ?? m.telefone, 20), foco: body.foco === "comercial" ? "comercial" : body.foco === "residencial" ? "residencial" : m.foco } : m));
      const extra = dono && body.empresa !== undefined ? { empresa: limpo(body.empresa, 120), nome: limpo(body.empresa, 120) || cx.nome } : {};
      await gravarConta(C, { ...cx, ...extra, membros });
      return json({ ok: true });
    }
    if (a === "exportar" && req.method === "GET") {
      if (!dono) return erro("Somente o responsável pela conta exporta os dados.", 403);
      const registros = await listarDaConta(C, false);
      return new Response(JSON.stringify({ versao: 1, conta: { id: C, nome: cx.nome, empresa: cx.empresa || "" }, gerado_em: agora.toISOString(), registros }), {
        headers: { "content-type": "application/json", "content-disposition": `attachment; filename="Propto_dados_${new Date().toISOString().slice(0, 10)}.json"`, "cache-control": "no-store" },
      });
    }
  }

  return erro("Esta função faz parte da operação PrimeCorp e não está no seu plano.", 403);
}
