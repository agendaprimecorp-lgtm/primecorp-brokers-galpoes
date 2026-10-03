import type { Config, Context } from "@netlify/functions";
import { createHash } from "node:crypto";
import { json, erro, obterRegistro, salvarRegistro, registrarEmissao, soDig, cnpjValido, cpfValido } from "../../shared/servidor.mjs";

// Sala do Anunciante: rota PÚBLICA. O anunciante completa os dados do PRÓPRIO imóvel e aceita a autorização de indicação.
// Nunca expõe cliente, briefing ou identificadores internos.
const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;
const lim = (s: unknown, n: number) => String(s ?? "").trim().slice(0, n);
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
    if (!body || body.acao !== "responder") return erro("Requisição inválida.");
    const agora = new Date().toISOString();

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
    if (!Object.keys(campos).length && !novoAceite) return erro("Preencha ao menos uma informação ou aceite a autorização.");

    // 3) grava no pedido
    const respostas = [...(p.respostas || [])];
    if (Object.keys(campos).length) respostas.push({ em: agora, ip: context.ip || null, campos });
    const respostas_atuais = { ...(p.respostas_atuais || {}), ...campos };
    const status = aceite ? "autorizado" : "respondido";
    const novo = { ...p, respostas, respostas_atuais, aceite, status, respondido_em: agora, visto: false };
    await salvarRegistro("pedidos", token, novo);

    // 4) leva os dados para a oferta (marcados como informados pelo anunciante, para revisão)
    if (p.oferta) {
      const o = await obterRegistro("ofertas", p.oferta);
      if (o) {
        const fontes = { ...(o.fontes || {}) };
        Object.keys(campos).forEach((k) => (fontes[k] = "anunciante"));
        const atual: Record<string, any> = { ...o, ...campos, fontes, revisar_anunciante: true, atualizado: agora };
        if (novoAceite) {
          atual.autorizacao = { status: "aceita", pedido: token, em: aceite.em, razao: aceite.razao, documento: aceite.documento, creci: aceite.creci, responsavel: aceite.responsavel, termo_versao: aceite.termo_versao, termo_sha256: aceite.termo_sha256, tipo_termo: p.tipo_termo, comissao: p.comissao || null };
        }
        await salvarRegistro("ofertas", p.oferta, atual);
      }
    }

    // 5) registro (relatórios emitidos)
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
};
