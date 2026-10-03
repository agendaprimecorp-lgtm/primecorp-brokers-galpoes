import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { verifyRequestOrigin } from "@netlify/identity";
import {
  COLECOES, db, json, erro, usuario, papelDe, perfilDe, env,
  listarTudo, salvarRegistro, obterRegistro, registrarEmissao, proximoCodigoPC,
  chamarIA, chamarIAImagem, lerPagina, PROMPT_UM, PROMPT_VARIOS, PROMPT_AMBIENTE, PROMPT_ANUNCIO,
} from "../../shared/servidor.mjs";

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const MAX_PDF = 4 * 1024 * 1024; // 4 MB
const MAX_FOTO = 3 * 1024 * 1024; // 3 MB por foto já tratada no celular
const SO_ADMIN_COL = ["config", "usuarios"];
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
      if (req.method === "DELETE" && !admin) return erro("Somente o administrador exclui registros.", 403);
      if (req.method === "PUT") {
        const body = await req.json().catch(() => null);
        if (!body || typeof body !== "object" || Array.isArray(body)) return erro("Corpo inválido.");
        const dados = { ...body };
        delete (dados as Record<string, unknown>).id;
        delete (dados as Record<string, unknown>)._atualizado;
        const ant = await obterRegistro(a, b);
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
      if (!/^pdf\/[\w.-]+\.pdf$/.test(chave)) return erro("Arquivo inválido.");
      const r = await getStore("arquivos").getWithMetadata(chave, { type: "arrayBuffer" });
      if (!r) return erro("Arquivo não encontrado.", 404);
      const nome = String((r.metadata as Record<string, unknown>)?.nome || "ficha.pdf").replace(/[^\w.-]/g, "_");
      return new Response(r.data as ArrayBuffer, {
        headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${nome}"`, "cache-control": "no-store" },
      });
    }

    /* ---------- extração com IA ---------- */
    if (rota === "extrair" && req.method === "POST") {
      const body = await req.json().catch(() => null);
      let texto = String(body?.texto || "").trim();
      const modo = body?.modo === "varios" ? "varios" : "um";
      let lido = false;
      if (modo === "um" && texto.length < 40 && body?.url) {
        try { texto = await lerPagina(String(body.url)); lido = true; } catch (e) { return erro("Não consegui ler pelo link: " + (e instanceof Error ? e.message : String(e)) + ". Abra o anúncio, copie o texto e cole aqui.", 422); }
      }
      if (texto.length < 40) return erro("Texto curto demais.");
      const r = await chamarIA(modo === "varios" ? PROMPT_VARIOS : PROMPT_UM, texto.slice(0, modo === "varios" ? 30000 : 16000), modo === "varios" ? 6000 : 3000);
      return json(lido ? { ...r, _lido_pelo_link: true } : r);
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
      const r = await chamarIAImagem(PROMPT_AMBIENTE + `\nTipo de imóvel: ${String(body?.tipo || "não informado").slice(0, 60)}.`, fala, imgs, 1200);
      return json(r);
    }
    if (rota === "ia" && a === "anuncio" && req.method === "POST") {
      const body = await req.json().catch(() => null);
      const txt = JSON.stringify({ ficha: body?.ficha || {}, ambientes: body?.ambientes || [], fala_geral: body?.fala_geral || "" }).slice(0, 24000);
      const r = await chamarIA(PROMPT_ANUNCIO, txt, 2500);
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

    /* ---------- status / coleta ---------- */
    if (rota === "status" && req.method === "GET") {
      return json({
        usuario: u.email,
        papel,
        perfil: await perfilDe(u),
        coleta_configurada: !!(env("ALERTAS_IMAP_USER") && env("ALERTAS_IMAP_SENHA")),
        caixa_alertas: env("ALERTAS_IMAP_USER") || null,
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
