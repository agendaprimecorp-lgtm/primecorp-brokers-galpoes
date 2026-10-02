import type { Config, Context } from "@netlify/functions";
import { createHash } from "node:crypto";
import { json, erro, obterRegistro, salvarRegistro, registrarEmissao, db } from "../../shared/servidor.mjs";

// Sala do Cliente: rota PÚBLICA. Só entrega nível 1 (faixas), e só depois do aceite do termo.
const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;
const lim = (s: unknown, n: number) => String(s ?? "").trim().slice(0, n);
const soDig = (s: string) => s.replace(/\D/g, "");

function cnpjValido(c: string) {
  const d = soDig(c);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const calc = (base: string, pesos: number[]) => {
    const s = base.split("").reduce((acc, x, i) => acc + Number(x) * pesos[i], 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const p2 = [6, ...p1];
  const d1 = calc(d.slice(0, 12), p1);
  const d2 = calc(d.slice(0, 12) + d1, p2);
  return d.endsWith(`${d1}${d2}`);
}
function cpfValido(c: string) {
  const d = soDig(c);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += Number(d[i]) * (10 - i);
  let r = (s * 10) % 11; if (r === 10) r = 0;
  if (r !== Number(d[9])) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += Number(d[i]) * (11 - i);
  r = (s * 10) % 11; if (r === 10) r = 0;
  return r === Number(d[10]);
}

function publico(s: Record<string, any>) {
  const aceito = !!s.aceite;
  return {
    titulo: s.titulo || "Opções selecionadas",
    preparado_para: s.preparado_para || "",
    expira: s.expira || null,
    termo_texto: s.termo_texto || "",
    termo_versao: s.termo_versao || "",
    aceito,
    aceite: aceito ? { razao: s.aceite.razao, responsavel: s.aceite.responsavel, em: s.aceite.em } : null,
    opcoes: aceito
      ? (s.opcoes || []).map((o: any) => ({
          codigo: o.codigo,
          titulo: o.titulo,
          linhas: o.linhas || [],
          interesse: (s.interesses || []).some((i: any) => i.codigo === o.codigo),
        }))
      : [],
    total_opcoes: (s.opcoes || []).length,
    contato: s.contato_corretor || null,
  };
}

export default async (req: Request, context: Context) => {
  const token = context.params.token || "";
  if (!TOKEN_RE.test(token)) return erro("Link inválido.", 404);
  try {
    const s = await obterRegistro("salas", token);
    if (!s || s.status === "encerrada") return erro("Esta sala não está disponível.", 404);
    if (s.expira && new Date(s.expira).getTime() < Date.now()) return erro("Este link expirou. Peça um novo ao seu corretor.", 410);

    if (req.method === "GET") return json(publico(s));

    if (req.method === "POST") {
      const body = await req.json().catch(() => null);
      if (!body) return erro("Requisição inválida.");

      if (body.acao === "aceite") {
        if (s.aceite) return json(publico(s));
        const doc = soDig(String(body.documento || ""));
        const a = {
          razao: lim(body.razao, 160),
          documento: doc,
          responsavel: lim(body.responsavel, 120),
          cargo: lim(body.cargo, 80),
          email: lim(body.email, 160).toLowerCase(),
          telefone: lim(body.telefone, 30),
        };
        if (!a.razao || !a.responsavel) return erro("Preencha razão social (ou nome) e responsável.");
        if (!(doc.length === 14 ? cnpjValido(doc) : doc.length === 11 ? cpfValido(doc) : false)) return erro("CNPJ ou CPF inválido.");
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.email)) return erro("E-mail inválido.");
        if (soDig(a.telefone).length < 10) return erro("Telefone inválido.");
        if (body.concordo !== true) return erro("É preciso aceitar o termo para continuar.");
        const termoHash = createHash("sha256").update(String(s.termo_texto || "")).digest("hex");
        const aceite = {
          ...a,
          em: new Date().toISOString(),
          ip: context.ip || null,
          agente: lim(req.headers.get("user-agent"), 300),
          termo_versao: s.termo_versao || "",
          termo_sha256: termoHash,
        };
        const nova = { ...s, aceite, status: "aceita" };
        await salvarRegistro("salas", token, nova);
        await registrarEmissao({
          tipo: "aceite",
          sala_id: token,
          briefing_id: s.briefing || null,
          contato_id: s.contato || null,
          destinatario: `${a.razao} (${a.responsavel})`,
          conteudo: `Aceite do termo ${s.termo_versao || ""} · SHA-256 ${termoHash}`,
          meta: aceite,
        });
        return json(publico(nova));
      }

      if (body.acao === "interesse") {
        if (!s.aceite) return erro("Aceite o termo antes.", 403);
        const codigo = lim(body.codigo, 20);
        const op = (s.opcoes || []).find((o: any) => o.codigo === codigo);
        if (!op) return erro("Opção não encontrada.", 404);
        if ((s.interesses || []).some((i: any) => i.codigo === codigo)) return json(publico(s));
        const agora = new Date().toISOString();
        const interesses = [...(s.interesses || []), { codigo, em: agora, ip: context.ip || null }];
        const nova = { ...s, interesses };
        await salvarRegistro("salas", token, nova);

        // Abre ou atualiza o negócio (briefing x oferta) na etapa "interesse"
        let negocioId: string | null = null;
        if (s.briefing && op.oferta) {
          const rows = await db().sql`SELECT id, dados FROM registros WHERE colecao = 'negocios' AND excluido = FALSE AND dados->>'briefing' = ${s.briefing} AND dados->>'oferta' = ${op.oferta} LIMIT 1`;
          const ev = { t: agora, ev: `Interesse manifestado na Sala do Cliente (${codigo}) por ${s.aceite.razao}` };
          if (rows[0]) {
            const n = rows[0].dados as any;
            const etapas = ["teaser", "interesse", "termo", "parceria", "visita", "proposta", "fechado"];
            const etapa = etapas.indexOf(n.etapa) < 1 ? "interesse" : n.etapa;
            await salvarRegistro("negocios", rows[0].id, { ...n, etapa, atualizado: agora, log: [...(n.log || []), ev] });
            negocioId = rows[0].id;
          } else {
            negocioId = "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            await salvarRegistro("negocios", negocioId, {
              briefing: s.briefing, oferta: op.oferta, contato: s.contato || null,
              parceiro: s.aceite.razao, tel: s.aceite.telefone, etapa: "interesse",
              criado: agora, atualizado: agora, origem: "sala", sala: token, log: [ev],
            });
          }
        }
        await registrarEmissao({
          tipo: "interesse", sala_id: token, briefing_id: s.briefing || null, oferta_id: op.oferta || null,
          negocio_id: negocioId, contato_id: s.contato || null, destinatario: s.aceite.razao,
          conteudo: `Interesse em ${codigo}: ${op.titulo}`,
        });
        return json(publico(nova));
      }
      return erro("Ação inválida.");
    }
    return erro("Método não permitido.", 405);
  } catch (e) {
    console.error(e);
    return erro("Não foi possível carregar a sala agora. Tente novamente em instantes.", 500);
  }
};

export const config: Config = {
  path: "/publico/sala/:token",
  method: ["GET", "POST"],
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
