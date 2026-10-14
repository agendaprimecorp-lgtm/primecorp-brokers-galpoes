import type { Config, Context } from "@netlify/functions";
import { createHash } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { json, erro, env, obterRegistro, salvarRegistro, registrarEmissao, soDig, cnpjValido, cpfValido } from "../../shared/servidor.mjs";
import { varrer } from "../../shared/varredura.mjs";

// Sala do Anunciante: rota PÚBLICA. O anunciante completa os dados do PRÓPRIO imóvel e aceita a autorização de indicação.
// Nunca expõe cliente, briefing ou identificadores internos.
const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;
const lim = (s: unknown, n: number) => String(s ?? "").trim().slice(0, n);
// Dados documentais que o anunciante pode informar sempre (completam a oferta só onde estiver vazio; ficam privados).
const DOC_CAMPOS: Record<string, [string, number]> = { matricula: ["Nº da matrícula", 40], cartorio: ["Cartório de Registro de Imóveis", 120], inscricao: ["Inscrição imobiliária (IPTU)", 60], cep: ["CEP", 9] };
const DOC_TIPOS: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };
const MAX_DOC = 4_300_000; const MAX_DOCS = 6;
const NUM = ["area_ha", "distancia_asfalto", "dormitorios", "suites", "banheiros", "vagas", "construida", "terreno", "fabril", "pe_direito", "docas", "energia_kva", "piso_carga", "aluguel", "venda", "iptu", "condominio", "frente"];

function publico(p: Record<string, any>) {
  return {
    codigo: p.codigo || "",
    titulo: p.titulo || "",
    operacao: p.operacao || "",
    grupo: p.grupo || "",
    tipo_termo: p.tipo_termo || "parceria",
    anunciante: p.anunciante || "",
    demanda: p.demanda || 0,
    conhecidos: p.conhecidos || [],
    perguntas: (p.faltam || []).map((f: any) => ({ campo: f.campo, rotulo: f.rotulo, pergunta: f.pergunta, tipo: f.tipo, resposta: p.respostas_atuais?.[f.campo] ?? "" })),
    comissao: p.comissao ? { texto: p.comissao.texto || "", partes: (p.comissao.partes || []).map((x: any) => ({ papel: x.papel, pct: x.pct })) } : null,
    termo_texto: p.termo_texto || "",
    termo_versao: p.termo_versao || "",
    expira: p.expira || null,
    aceito: !!p.aceite,
    aceite: p.aceite ? { razao: p.aceite.razao, responsavel: p.aceite.responsavel, em: p.aceite.em } : null,
    respondido_em: p.respondido_em || null,
    corretor: p.corretor || null,
    docs_campos: Object.entries(DOC_CAMPOS).map(([campo, [rotulo]]) => ({ campo, rotulo, resposta: p.docs_atuais?.[campo] ?? "" })),
    documentos: (p.documentos || []).map((d: any) => ({ nome: d.nome, em: d.em })),
    max_docs: MAX_DOCS,
  };
}

export default async (req: Request, context: Context) => {
  const token = context.params.token || "";
  if (!TOKEN_RE.test(token)) return erro("Link inválido.", 404);
  try {
    const p = await obterRegistro("pedidos", token);
    if (!p || p.status === "encerrado") return erro("Este link não está disponível.", 404);
    if (p.expira && new Date(p.expira).getTime() < Date.now()) return erro("Este link expirou. Peça um novo ao corretor.", 410);
    if (req.method === "GET") return json(publico(p));
    if (req.method !== "POST") return erro("Método não permitido.", 405);

    const body = await req.json().catch(() => null);
    const agora = new Date().toISOString();

    // Documento do imóvel (matrícula, IPTU, CCIR/CAR): guardado em área privada e lido pela IA em segundo plano.
    if (body && body.acao === "documento") {
      if (!p.oferta) return erro("Pedido sem imóvel vinculado.");
      if ((p.documentos || []).length >= MAX_DOCS) return erro(`Limite de ${MAX_DOCS} documentos por pedido. Fale com o corretor.`);
      const tipo = String(body.tipo || ""); const ext = DOC_TIPOS[tipo];
      if (!ext) return erro("Envie PDF, JPG ou PNG.");
      const bin = Buffer.from(String(body.base64 || ""), "base64");
      if (bin.length < 500) return erro("Arquivo vazio.");
      if (bin.length > MAX_DOC) return erro("Arquivo acima de 4 MB: envie só as páginas necessárias ou fotos de cada página.");
      if (ext === "pdf" && bin.subarray(0, 4).toString() !== "%PDF") return erro("Arquivo não é PDF.");
      if (ext === "jpg" && !(bin[0] === 0xff && bin[1] === 0xd8)) return erro("Arquivo não é JPEG.");
      if (ext === "png" && bin.subarray(1, 4).toString() !== "PNG") return erro("Arquivo não é PNG.");
      const nome = lim(body.nome, 80).replace(/[^\w .()-]/g, "") || `documento.${ext}`;
      const chave = `mat/${p.oferta}/an-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
      await getStore("arquivos").set(chave, new Blob([bin], { type: tipo }), { metadata: { nome, tipo, por: "anunciante", pedido: token } });
      const novoP = { ...p, documentos: [...(p.documentos || []), { chave, nome, tipo, em: agora, ip: context.ip || null }], respondido_em: agora, status: p.aceite ? "autorizado" : "respondido", visto: false };
      await salvarRegistro("pedidos", token, novoP);
      const o = await obterRegistro("ofertas", p.oferta);
      if (o) await salvarRegistro("ofertas", p.oferta, { ...o, revisar_anunciante: true, verificacao: { ...(o.verificacao || {}), leitura: { status: "lendo", em: agora, arquivo: chave, origem: "anunciante" } }, atualizado: agora });
      await fetch(new URL("/.netlify/functions/matricula-background", env("URL") || new URL(req.url).origin), { method: "POST", headers: { "x-coleta-segredo": env("COLETA_SEGREDO") || "", "content-type": "application/json" }, body: JSON.stringify({ oferta: p.oferta, chave, tipo, usuario: "anunciante" }) }).catch(() => null);
      await registrarEmissao({ tipo: "anunciante_documento", oferta_id: p.oferta, destinatario: p.anunciante || "", conteudo: `${p.codigo}: documento enviado pelo anunciante (${nome}) · leitura automática pela IA`, meta: { pedido: token, chave, ip: context.ip || null } });
      return json(publico(novoP));
    }
    if (!body || body.acao !== "responder") return erro("Requisição inválida.");

    // 1) respostas: só os campos pedidos
    const permitidos = new Set((p.faltam || []).map((f: any) => f.campo));
    const campos: Record<string, string> = {};
    for (const [k, v0] of Object.entries(body.campos || {})) {
      if (!permitidos.has(k)) continue;
      const v = lim(v0, 300);
      if (!v) continue;
      if (k === "iptu_periodo" && !["mensal", "anual"].includes(v)) return erro("Informe se o IPTU é mensal ou anual.");
      if (NUM.includes(k) && !/\d/.test(v)) return erro(`Informe um número em "${(p.faltam.find((f: any) => f.campo === k) || {}).rotulo || k}".`);
      campos[k] = v;
    }

    // 2) aceite da autorização (opcional na mesma resposta; uma única vez)
    let aceite = p.aceite || null;
    let novoAceite = false;
    if (body.aceite && body.aceite.concordo === true && !p.aceite) {
      const a = body.aceite;
      const doc = soDig(String(a.documento || ""));
      const reg = {
        razao: lim(a.razao, 160), documento: doc, creci: lim(a.creci, 30), responsavel: lim(a.responsavel, 120),
        cargo: lim(a.cargo, 80), email: lim(a.email, 160).toLowerCase(), telefone: lim(a.telefone, 30),
      };
      if (!reg.razao || !reg.responsavel) return erro("Preencha nome/razão social e responsável.");
      if (!(doc.length === 14 ? cnpjValido(doc) : doc.length === 11 ? cpfValido(doc) : false)) return erro("CNPJ ou CPF inválido.");
      if (p.tipo_termo !== "proprietario" && !/\d{3,}/.test(reg.creci)) return erro("Informe o número do CRECI.");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(reg.email)) return erro("E-mail inválido.");
      if (soDig(reg.telefone).length < 10) return erro("Telefone inválido.");
      aceite = {
        ...reg, em: agora, ip: context.ip || null, agente: lim(req.headers.get("user-agent"), 300),
        termo_versao: p.termo_versao || "", termo_sha256: createHash("sha256").update(String(p.termo_texto || "")).digest("hex"),
      };
      novoAceite = true;
    }
    // 1b) dados documentais (sempre aceitos; privados)
    const docs: Record<string, string> = {};
    for (const [k, v0] of Object.entries(body.docs || {})) {
      if (!DOC_CAMPOS[k]) continue; const v = lim(v0, DOC_CAMPOS[k][1]); if (!v) continue;
      if (k === "cep" && soDig(v).length !== 8) return erro("CEP deve ter 8 dígitos.");
      docs[k] = v;
    }
    if (!Object.keys(campos).length && !Object.keys(docs).length && !novoAceite) return erro("Preencha ao menos uma informação ou aceite a autorização.");

    // 3) grava no pedido
    const respostas = [...(p.respostas || [])];
    if (Object.keys(campos).length) respostas.push({ em: agora, ip: context.ip || null, campos });
    if (Object.keys(docs).length) respostas.push({ em: agora, ip: context.ip || null, campos: docs, documental: true });
    const respostas_atuais = { ...(p.respostas_atuais || {}), ...campos };
    const docs_atuais = { ...(p.docs_atuais || {}), ...docs };
    const status = aceite ? "autorizado" : "respondido";
    const novo = { ...p, respostas, respostas_atuais, docs_atuais, aceite, status, respondido_em: agora, visto: false };
    await salvarRegistro("pedidos", token, novo);

    // 4) leva os dados para a oferta (marcados como informados pelo anunciante, para revisão)
    if (p.oferta) {
      const o = await obterRegistro("ofertas", p.oferta);
      if (o) {
        const fontes = { ...(o.fontes || {}) };
        Object.keys(campos).forEach((k) => (fontes[k] = "anunciante"));
        const atual: Record<string, any> = { ...o, ...campos, fontes, revisar_anunciante: true, atualizado: agora };
        for (const [k, v] of Object.entries(docs)) if (String(o[k] ?? "").trim() === "") { atual[k] = v; fontes[k] = "anunciante"; }
        // CEP novo: a varredura pública (Correios, mapa, Receita) roda sozinha.
        if (docs.cep && atual.cep !== o.cep) { try { const f = await varrer(atual); atual.verificacao = { ...(o.verificacao || {}), fontes: { ...((o.verificacao || {}).fontes || {}), ...f }, varrido_em: agora, varrido_por: "automático (anunciante)" }; } catch {} }
        if (novoAceite) {
          atual.autorizacao = { status: "aceita", pedido: token, em: aceite.em, razao: aceite.razao, documento: aceite.documento, creci: aceite.creci, responsavel: aceite.responsavel, termo_versao: aceite.termo_versao, termo_sha256: aceite.termo_sha256, tipo_termo: p.tipo_termo, comissao: p.comissao || null };
        }
        await salvarRegistro("ofertas", p.oferta, atual);
      }
    }

    // 5) registro (relatórios emitidos)
    if (Object.keys(docs).length) await registrarEmissao({ tipo: "anunciante_dados", oferta_id: p.oferta || null, destinatario: p.anunciante || "", conteudo: `${p.codigo}: dados documentais enviados pelo anunciante (${Object.keys(docs).map((k) => DOC_CAMPOS[k][0]).join(", ")})`, meta: { pedido: token, ip: context.ip || null } });
    if (Object.keys(campos).length) await registrarEmissao({ tipo: "anunciante_dados", oferta_id: p.oferta || null, destinatario: p.anunciante || "", conteudo: `${p.codigo}: ${Object.keys(campos).length} informação(ões) enviada(s) pelo anunciante\n` + Object.entries(campos).map(([k, v]) => `${k}: ${v}`).join("\n"), meta: { pedido: token, ip: context.ip || null } });
    if (novoAceite) await registrarEmissao({ tipo: "autorizacao", oferta_id: p.oferta || null, contato_id: p.contato || null, destinatario: `${aceite.razao} (${aceite.responsavel})`, conteudo: `Autorização de indicação ${p.codigo} · termo ${p.termo_versao || ""} · SHA-256 ${aceite.termo_sha256}`, meta: { pedido: token, ...aceite } });
    return json(publico(novo));
  } catch (e) {
    console.error(e);
    return erro("Não foi possível concluir agora. Tente novamente em instantes.", 500);
  }
};

export const config: Config = {
  path: "/publico/anunciante/:token",
  method: ["GET", "POST"],
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] },
  // corpo até ~6 MB: documento em base64 (limite das functions)
};
