import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { verifyRequestOrigin } from "@netlify/identity";
import {
  COLECOES, db, json, erro, usuario, papelDe, perfilDe, env,
  listarTudo, salvarRegistro, obterRegistro, registrarEmissao, proximoCodigoPC,
  chamarIA, chamarIAImagem, limparAmbiente, limparAnuncio, lerAnuncio, buscarSeguro, PROMPT_UM, PROMPT_VARIOS, PROMPT_AMBIENTE, PROMPT_ANUNCIO,
} from "../../shared/servidor.mjs";
import { varrer } from "../../shared/varredura.mjs";
import V from "../../shared/verif.mjs";
import { criarContexto } from "../../shared/zoe-run.mjs";
import { responder, anexarMsg } from "../../shared/zoe.mjs";
import { enviar, janelaAberta, equipeWA, conectarWebhook360 } from "../../shared/whatsapp.mjs";

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_PDF = 4 * 1024 * 1024; // 4 MB
const MAX_FOTO = 3 * 1024 * 1024; // 3 MB por foto já tratada no celular
const SO_ADMIN_COL = ["config", "usuarios"];
const SO_SERVIDOR_COL = ["conversas"]; // gravadas só pelo servidor (evita sobrescrever mensagens que chegam)
const MAX_MAT = 4_300_000; // ~4,3 MB (limite de corpo das functions: 6 MB em base64)
const MAT_TIPOS: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const FOTO_RE = /^fotos\/[A-Za-z0-9_-]{1,80}\/[\w-]{6,40}\.jpg$/;

export default async (req: Request, context: Context) => {
  const url = new URL(req.url);
  const partes = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const [rota, a, b] = partes;

  // Toda rota daqui é privada (a Sala do Cliente tem function própria).
  const u = await usuario();
  if (!u) return erro("Faça login.", 401);
  const papel = await papelDe(u);
  if (!papel) return erro("Usuário sem permissão.", 403);
  const admin = papel === "admin";
  if (req.method !== "GET") {
    try {
      verifyRequestOrigin(req);
    } catch {
      return erro("Origem não permitida.", 403);
    }
  }

  try {
    /* ---------- dados ---------- */
    if (rota === "dados" && req.method === "GET" && !a) {
      const rows = await listarTudo(false);
      const out: Record<string, unknown[]> = {};
      COLECOES.forEach((c) => (out[c] = []));
      for (const r of rows) {
        if (out[r.colecao]) out[r.colecao].push({ ...r.dados, id: r.id, _atualizado: r.atualizado_em });
      }
      return json(out);
    }
    if (rota === "dados" && a && b) {
      if (!COLECOES.includes(a)) return erro("Coleção inválida.");
      if (!ID_RE.test(b)) return erro("Identificador inválido.");
      if (SO_ADMIN_COL.includes(a) && !admin) return erro("Somente o administrador altera esta área.", 403);
      if (SO_SERVIDOR_COL.includes(a) && req.method === "PUT") return erro("Conversas são gravadas pelo servidor.", 403);
      if (req.method === "DELETE" && !admin) return erro("Somente o administrador exclui registros.", 403);
      if (req.method === "PUT") {
        const body = await req.json().catch(() => null);
        if (!body || typeof body !== "object" || Array.isArray(body)) return erro("Corpo inválido.");
        const dados = { ...body };
        delete (dados as Record<string, unknown>).id;
        delete (dados as Record<string, unknown>)._atualizado;
        const ant = await obterRegistro(a, b);
        if (a === "ofertas" && ant?.verificacao) { // a varredura e a leitura da matrícula gravam no servidor: não deixe uma tela antiga apagar
          const carimbo = (v: any) => [v?.varrido_em, v?.matricula?.lida_em, v?.leitura?.em].filter(Boolean).sort().pop() || "";
          if (carimbo(ant.verificacao) > carimbo((dados as any).verificacao)) (dados as any).verificacao = ant.verificacao;
        }
        (dados as Record<string, unknown>).criado_por = (ant && ant.criado_por) || (dados as Record<string, unknown>).criado_por || u.email;
        (dados as Record<string, unknown>).atualizado_por = u.email;
        const tam = JSON.stringify(dados).length;
        if (tam > 400_000) return erro("Registro grande demais.");
        const r = await salvarRegistro(a, b, dados);
        return json({ ok: true, atualizado: r.atualizado_em });
      }
      if (req.method === "DELETE") {
        await db().sql`UPDATE registros SET excluido = TRUE, atualizado_em = NOW() WHERE colecao = ${a} AND id = ${b}`;
        return json({ ok: true });
      }
    }

    /* ---------- código PrimeCorp ---------- */
    if (rota === "codigo" && req.method === "POST") {
      return json({ codigo: await proximoCodigoPC() });
    }

    /* ---------- emissões (histórico de relatórios) ---------- */
    if (rota === "emissoes" && req.method === "GET") {
      const lim = Math.min(1000, Math.max(1, Number(url.searchParams.get("limite")) || 300));
      const rows = await db().sql`SELECT id, codigo, tipo, negocio_id, oferta_id, briefing_id, contato_id, sala_id, destinatario, conteudo, arquivo, meta, criado_em FROM emissoes ORDER BY criado_em DESC LIMIT ${lim}`;
      return json({ emissoes: rows });
    }
    if (rota === "emissoes" && req.method === "POST") {
      const body = await req.json().catch(() => null);
      if (!body || !body.tipo) return erro("Informe o tipo da emissão.");
      let arquivo: string | null = null;
      if (body.pdf_base64) {
        const bin = Buffer.from(String(body.pdf_base64), "base64");
        if (bin.length > MAX_PDF) return erro("PDF grande demais.");
        if (bin.subarray(0, 4).toString() !== "%PDF") return erro("Arquivo não é PDF.");
        arquivo = `pdf/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`;
        await getStore("arquivos").set(arquivo, new Blob([bin], { type: "application/pdf" }), { metadata: { nome: String(body.nome_arquivo || "ficha.pdf") } });
      }
      const r = await registrarEmissao({ ...body, arquivo, meta: { ...(body.meta || {}), usuario: u.email } });
      return json({ ok: true, ...r, arquivo });
    }

    /* ---------- arquivos emitidos ---------- */
    if (rota === "arquivo" && req.method === "GET") {
      const chave = url.searchParams.get("k") || "";
      if (!/^pdf\/[\w.-]+\.pdf$/.test(chave) && !/^mat\/[\w-]+\/[\w-]+\.(pdf|jpg|png|webp)$/.test(chave)) return erro("Arquivo inválido.");
      const r = await getStore("arquivos").getWithMetadata(chave, { type: "arrayBuffer" });
      if (!r) return erro("Arquivo não encontrado.", 404);
      const meta = (r.metadata || {}) as Record<string, unknown>;
      const nome = String(meta.nome || "ficha.pdf").replace(/[^\w.-]/g, "_");
      return new Response(r.data as ArrayBuffer, {
        headers: { "content-type": String(meta.tipo || "application/pdf"), "content-disposition": `attachment; filename="${nome}"`, "cache-control": "no-store", "x-content-type-options": "nosniff" },
      });
    }

    /* ---------- extração com IA ---------- */
    if (rota === "extrair" && req.method === "POST") {
      const body = await req.json().catch(() => null);
      let texto = String(body?.texto || "").trim();
      const modo = body?.modo === "varios" ? "varios" : "um";
      let lido: any = null;
      if (modo === "um" && texto.length < 40 && body?.url) {
        try { lido = await lerAnuncio(String(body.url)); texto = lido.texto; lido.doTexto = true; } catch (e) { return erro("Não consegui ler pelo link: " + (e instanceof Error ? e.message : String(e)) + ". Abra o anúncio, copie o texto e cole aqui.", 422); }
      }
      if (texto.length < 40) return erro("Texto curto demais.");
      else if (modo === "um" && body?.url && !lido) { try { lido = await lerAnuncio(String(body.url)); } catch {} } // texto colado: ainda tenta pegar fotos e contatos
      const r = await chamarIA(modo === "varios" ? PROMPT_VARIOS : PROMPT_UM, texto.slice(0, modo === "varios" ? 30000 : 16000), modo === "varios" ? 6000 : 3000);
      return json(lido ? { ...r, ...(lido.doTexto ? { _lido_pelo_link: true } : {}), imagens_ref: lido.imagens, contatos_ref: lido.contatos } : r);
    }

    /* ---------- fotos do anúncio de terceiros: visualização interna (proxy protegido) ---------- */
    if (rota === "img-ref" && req.method === "GET") {
      const alvo = String(url.searchParams.get("u") || "");
      try {
        const r = await buscarSeguro(alvo, { aceita: /^image\/(jpeg|jpg|png|webp)/i, max: 6_000_000, tempo: 10000, accept: "image/avif,image/webp,image/*;q=0.8", referer: url.searchParams.get("de") || undefined });
        return new Response(r.buf, { headers: { "content-type": r.tipo, "cache-control": "private, max-age=86400", "x-content-type-options": "nosniff" } });
      } catch (e) { return erro("Imagem indisponível: " + (e instanceof Error ? e.message : ""), 422); }
    }

    /* ---------- fotos da captação ---------- */
    if (rota === "fotos" && req.method === "POST") {
      const body = await req.json().catch(() => null);
      const of = String(body?.oferta || "");
      if (!ID_RE.test(of)) return erro("Oferta inválida.");
      const bin = Buffer.from(String(body?.jpeg_base64 || ""), "base64");
      if (bin.length < 200 || bin[0] !== 0xff || bin[1] !== 0xd8) return erro("Foto inválida (JPEG).");
      if (bin.length > MAX_FOTO) return erro("Foto grande demais.");
      const k = `fotos/${of}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      await getStore("fotos").set(k, new Blob([bin], { type: "image/jpeg" }), { metadata: { por: u.email, em: new Date().toISOString() } });
      return json({ ok: true, k });
    }
    if (rota === "foto" && req.method === "GET") {
      const k = url.searchParams.get("k") || "";
      if (!FOTO_RE.test(k)) return erro("Foto inválida.");
      const r = await getStore("fotos").get(k, { type: "arrayBuffer" });
      if (!r) return erro("Foto não encontrada.", 404);
      return new Response(r as ArrayBuffer, { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=86400" } });
    }
    if (rota === "fotos" && req.method === "DELETE") {
      const k = url.searchParams.get("k") || "";
      if (!FOTO_RE.test(k)) return erro("Foto inválida.");
      await getStore("fotos").delete(k);
      return json({ ok: true });
    }

    /* ---------- IA da captação ---------- */
    if (rota === "ia" && a === "ambiente" && req.method === "POST") {
      const body = await req.json().catch(() => null);
      const imgs = (Array.isArray(body?.imagens) ? body.imagens : []).map(String).filter((x: string) => x.length > 100 && x.length < 1_500_000).slice(0, 3);
      const fala = String(body?.fala || "").slice(0, 4000);
      if (!imgs.length && fala.length < 3) return erro("Envie ao menos uma foto ou a fala do ambiente.");
      const r = limparAmbiente(await chamarIAImagem(PROMPT_AMBIENTE + `\nTipo de imóvel: ${String(body?.tipo || "não informado").slice(0, 60)}.` + (body?.item ? ` Item do roteiro: ${String(body.item).slice(0, 60)} (se a foto mostrar outro ambiente, diga em foto.problemas).` : ""), fala, imgs, 1200));
      return json(r);
    }
    if (rota === "ia" && a === "anuncio" && req.method === "POST") {
      const body = await req.json().catch(() => null);
      const txt = JSON.stringify({ ficha: body?.ficha || {}, ambientes: body?.ambientes || [], fala_geral: body?.fala_geral || "" }).slice(0, 24000);
      const r = limparAnuncio(await chamarIA(PROMPT_ANUNCIO, txt, 2500));
      if (!r.titulo && !r.descricao) return erro("A IA não devolveu o anúncio. Tente de novo.", 502);
      return json(r);
    }

    /* ---------- backup ---------- */
    if (["backup", "backups", "restaurar"].includes(rota) && !admin) return erro("Somente o administrador acessa o backup.", 403);
    if (rota === "backup" && req.method === "GET") {
      const registros = await listarTudo(true);
      const emissoes = await db().sql`SELECT * FROM emissoes ORDER BY id`;
      const nome = `PrimeCorp_Backup_${new Date().toISOString().slice(0, 10)}.json`;
      return new Response(JSON.stringify({ versao: 1, gerado_em: new Date().toISOString(), registros, emissoes }), {
        headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${nome}"`, "cache-control": "no-store" },
      });
    }
    if (rota === "backups" && req.method === "GET" && !a) {
      const { blobs } = await getStore("backups").list();
      return json({ backups: blobs.map((x) => x.key).sort().reverse() });
    }
    if (rota === "backups" && req.method === "GET" && a) {
      const chave = decodeURIComponent(a);
      if (!/^backup-\d{4}-\d{2}-\d{2}\.json$/.test(chave)) return erro("Backup inválido.");
      const data = await getStore("backups").get(chave, { type: "text" });
      if (!data) return erro("Backup não encontrado.", 404);
      return new Response(data, { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="PrimeCorp_${chave}"` } });
    }
    if (rota === "restaurar" && req.method === "POST") {
      const body = await req.json().catch(() => null);
      if (!body || body.confirmacao !== "RESTAURAR" || !Array.isArray(body.backup?.registros)) return erro("Backup inválido ou sem confirmação.");
      let n = 0;
      for (const r of body.backup.registros) {
        if (!COLECOES.includes(r.colecao) || !ID_RE.test(String(r.id)) || typeof r.dados !== "object") continue;
        await db().sql`
          INSERT INTO registros (colecao, id, dados, excluido)
          VALUES (${r.colecao}, ${r.id}, ${JSON.stringify(r.dados)}::jsonb, ${!!r.excluido})
          ON CONFLICT (colecao, id) DO UPDATE SET dados = EXCLUDED.dados, excluido = EXCLUDED.excluido, atualizado_em = NOW()`;
        n++;
      }
      await registrarEmissao({ tipo: "restauracao", conteudo: `${n} registros restaurados`, meta: { usuario: u.email } });
      return json({ ok: true, restaurados: n });
    }

    /* ---------- verificação do imóvel ---------- */
    if (rota === "verificar" && a && req.method === "POST") {
      if (!ID_RE.test(a)) return erro("Oferta inválida.");
      const o = await obterRegistro("ofertas", a); if (!o) return erro("Oferta não encontrada.", 404);
      const fontes = await varrer(o);
      const at = (await obterRegistro("ofertas", a)) || o;
      const verificacao = { ...(at.verificacao || {}), fontes: { ...((at.verificacao || {}).fontes || {}), ...fontes }, varrido_em: new Date().toISOString(), varrido_por: u.email };
      const novo = { ...at, verificacao, atualizado: new Date().toISOString() };
      await salvarRegistro("ofertas", a, novo);
      return json({ ok: true, verificacao, avaliacao: V.avaliar(novo) });
    }
    if (rota === "matricula" && a && req.method === "POST") {
      if (!ID_RE.test(a)) return erro("Oferta inválida.");
      const o = await obterRegistro("ofertas", a); if (!o) return erro("Oferta não encontrada.", 404);
      const body = await req.json().catch(() => null);
      const tipo = String(body?.tipo || ""); const ext = MAT_TIPOS[tipo];
      if (!ext) return erro("Envie PDF, JPG, PNG ou WEBP.");
      const bin = Buffer.from(String(body?.base64 || ""), "base64");
      if (bin.length < 500) return erro("Arquivo vazio.");
      if (bin.length > MAX_MAT) return erro("Arquivo acima de 4 MB: gere a matrícula em PDF só com as páginas da certidão ou envie fotos.");
      if (ext === "pdf" && bin.subarray(0, 4).toString() !== "%PDF") return erro("Arquivo não é PDF.");
      if (ext === "jpg" && !(bin[0] === 0xff && bin[1] === 0xd8)) return erro("Arquivo não é JPEG.");
      if (ext === "png" && bin.subarray(1, 4).toString() !== "PNG") return erro("Arquivo não é PNG.");
      const chave = `mat/${a}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
      await getStore("arquivos").set(chave, new Blob([bin], { type: tipo }), { metadata: { nome: `Matricula_${o.codigo || a}.${ext}`, tipo, por: u.email } });
      await salvarRegistro("ofertas", a, { ...o, verificacao: { ...(o.verificacao || {}), leitura: { status: "lendo", em: new Date().toISOString(), arquivo: chave } }, atualizado: new Date().toISOString() });
      const r = await fetch(new URL("/.netlify/functions/matricula-background", env("URL") || url.origin), { method: "POST", headers: { "x-coleta-segredo": env("COLETA_SEGREDO") || "", "content-type": "application/json" }, body: JSON.stringify({ oferta: a, chave, tipo, usuario: u.email }) }).catch(() => null);
      return json({ ok: true, chave, status: "lendo", acionado: !!(r && (r.status === 202 || r.ok)) });
    }

    /* ---------- Zoe ---------- */
    if (rota === "zoe" && a === "simular" && req.method === "POST") {
      const body = await req.json().catch(() => null);
      const texto = String(body?.texto || "").trim().slice(0, 2000);
      const id = "sim_" + String(u.email).toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 60) + (body?.equipe ? "_eq" : "");
      let conv: any = (await obterRegistro("conversas", id)) || null;
      if (body?.reiniciar || !conv) conv = { modo: "zoe", msgs: [], simulacao: true, equipe: !!body?.equipe, nome: body?.equipe ? (await perfilDe(u)).nome || u.email : "Simulação", criado: new Date().toISOString() };
      if (!texto) { await salvarRegistro("conversas", id, conv); return json({ ok: true, conversa: id, msgs: conv.msgs }); }
      anexarMsg(conv, { id: "s" + Date.now().toString(36), de: "cliente", t: new Date().toISOString(), texto });
      conv.id = id;
      const ctx = await criarContexto({ base: env("URL") || url.origin, sandbox: true });
      let r: any; try { r = await responder(ctx, conv, { equipe: !!body?.equipe }); } catch (e) { return erro("A Zoe não respondeu: " + (e instanceof Error ? e.message : String(e)), 502); }
      const g = await ctx.gravar();
      anexarMsg(conv, { id: "z" + Date.now().toString(36), de: "zoe", t: new Date().toISOString(), texto: r.texto + (r.botoes?.length ? "\n[" + r.botoes.join(" | ") + "]" : ""), acoes: r.acoes });
      if (conv.modo === "humano") conv.modo = "zoe"; // na simulação, segue com a Zoe
      delete conv.id; await salvarRegistro("conversas", id, conv);
      return json({ ok: true, conversa: id, resposta: r.texto, botoes: r.botoes, acoes: r.acoes, simulado: g.simulado, avisos: (g.avisos || []).map((x: any) => x.texto) });
    }
    if (rota === "zoe" && a === "conectar" && req.method === "POST") {
      if (!admin) return erro("Somente o administrador conecta o WhatsApp.", 403);
      if ((env("WHATSAPP_PROVEDOR") || "").toLowerCase() !== "360dialog") return erro("Conexão automática só no modo 360dialog (WHATSAPP_PROVEDOR=360dialog).");
      const destino = (env("URL") || url.origin) + "/whatsapp/webhook";
      try { await conectarWebhook360(destino); } catch (e) { return erro(e instanceof Error ? e.message : String(e), 502); }
      await registrarEmissao({ tipo: "zoe_aviso", conteudo: "WhatsApp conectado ao sistema: " + destino, meta: { usuario: u.email } });
      return json({ ok: true, webhook: destino });
    }
    if (rota === "zoe" && (a === "enviar" || a === "modo") && req.method === "POST") {
      const body = await req.json().catch(() => null);
      const wa = String(body?.conversa || "");
      if (!/^\d{8,15}$/.test(wa)) return erro("Conversa inválida.");
      const conv: any = await obterRegistro("conversas", wa); if (!conv) return erro("Conversa não encontrada.", 404);
      if (a === "modo") {
        const modo = body?.modo === "humano" ? "humano" : "zoe";
        await salvarRegistro("conversas", wa, { ...conv, modo, ...(modo === "zoe" || body?.resolvido ? { precisa_humano: null } : {}), modo_por: u.email, modo_em: new Date().toISOString() });
        return json({ ok: true, modo });
      }
      const texto = String(body?.texto || "").trim().slice(0, 4000);
      if (!texto) return erro("Escreva a mensagem.");
      if (!janelaAberta(conv)) return erro("Passaram 24 h desde a última mensagem do cliente: o WhatsApp só permite modelo aprovado. Ligue ou use um modelo.", 409);
      let id: string | null = null;
      try { id = await enviar(wa, texto); } catch (e) { return erro("WhatsApp recusou: " + (e instanceof Error ? e.message : String(e)), 502); }
      const perfil = await perfilDe(u);
      anexarMsg(conv, { id: id || "h" + Date.now().toString(36), de: "humano", por: perfil.nome || u.email, t: new Date().toISOString(), texto });
      await salvarRegistro("conversas", wa, { ...conv, modo: "humano", precisa_humano: null });
      return json({ ok: true });
    }

    /* ---------- status / coleta ---------- */
    if (rota === "status" && req.method === "GET") {
      return json({
        usuario: u.email,
        papel,
        perfil: await perfilDe(u),
        coleta_configurada: !!(env("ALERTAS_IMAP_USER") && env("ALERTAS_IMAP_SENHA")),
        caixa_alertas: env("ALERTAS_IMAP_USER") || null,
        whatsapp_configurado: !!(env("WHATSAPP_TOKEN") && ((env("WHATSAPP_PHONE_ID") && env("WHATSAPP_APP_SECRET") && env("WHATSAPP_VERIFY_TOKEN")) || ((env("WHATSAPP_PROVEDOR") || "").toLowerCase() === "360dialog" && env("WHATSAPP_WEBHOOK_CHAVE")))),
        whatsapp_provedor: (env("WHATSAPP_PROVEDOR") || "meta").toLowerCase(),
        whatsapp_numero: env("WHATSAPP_NUMERO") || null,
        zoe_equipe: equipeWA().length,
        webhook: (env("URL") || url.origin) + "/whatsapp/webhook",
      });
    }
    if (rota === "coleta" && req.method === "POST") {
      const r = await fetch(new URL("/.netlify/functions/coleta-background", url.origin), {
        method: "POST",
        headers: { "x-coleta-segredo": env("COLETA_SEGREDO") || "", cookie: req.headers.get("cookie") || "" },
      });
      return json({ ok: r.status === 202 || r.ok, status: r.status });
    }

    return erro("Rota não encontrada.", 404);
  } catch (e) {
    console.error(e);
    return erro("Erro interno: " + (e instanceof Error ? e.message : String(e)), 500);
  }
};

export const config: Config = { path: "/api/*" };
