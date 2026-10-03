import { timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { env, obterRegistro, salvarRegistro, registrarEmissao } from "../../shared/servidor.mjs";
import { lerMatricula } from "../../shared/varredura.mjs";
import { aplicarMatricula } from "../../shared/aplicar.mjs";

// Leitura da matrícula por IA em segundo plano (PDF longo pode levar mais de 30 s).
function segredoOk(req: Request) {
  const esperado = env("COLETA_SEGREDO") || ""; const veio = req.headers.get("x-coleta-segredo") || "";
  return !!esperado && esperado.length === veio.length && timingSafeEqual(Buffer.from(esperado), Buffer.from(veio));
}
export default async (req: Request) => {
  if (!segredoOk(req)) { console.log("Matrícula: chamada sem segredo recusada."); return; }
  const { oferta, chave, tipo, usuario } = await req.json().catch(() => ({}));
  const o = await obterRegistro("ofertas", String(oferta || ""));
  if (!o || !/^mat\/[\w-]+\/[\w.-]+$/.test(String(chave || ""))) return;
  const marcar = async (leitura: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
    const at = (await obterRegistro("ofertas", oferta)) || o;
    await salvarRegistro("ofertas", oferta, { ...at, ...extra, verificacao: { ...(at.verificacao || {}), ...(extra.verificacao as object || {}), leitura }, atualizado: new Date().toISOString() });
  };
  try {
    const buf = await getStore("arquivos").get(chave, { type: "arrayBuffer" });
    if (!buf) throw new Error("arquivo não encontrado");
    const m = await lerMatricula(Buffer.from(buf as ArrayBuffer).toString("base64"), tipo);
    if ((m as any).erro) { await marcar({ status: "erro", msg: (m as any).erro, em: new Date().toISOString() }); return; }
    const at = (await obterRegistro("ofertas", oferta)) || o;
    const novo = aplicarMatricula(at, m, chave);
    await salvarRegistro("ofertas", oferta, { ...novo, verificacao: { ...novo.verificacao, leitura: { status: "ok", em: new Date().toISOString() } }, atualizado: new Date().toISOString() });
    await registrarEmissao({ tipo: "matricula_lida", oferta_id: oferta, conteudo: `Matrícula ${m.numero || ""} · ${m.cartorio || ""} · ${(m.proprietarios || []).map((p) => p.nome).join("; ")} · ${(m.onus || []).filter((x) => !x.cancelado).length} ônus ativo(s)`, meta: { usuario, chave } });
  } catch (e) {
    console.error(e); await marcar({ status: "erro", msg: String((e as Error)?.message || e).slice(0, 200), em: new Date().toISOString() });
  }
};
