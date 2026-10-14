import { timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { env, obterRegistro, salvarRegistro, registrarEmissao } from "../../shared/servidor.mjs";
import { lerDocumento, varrer } from "../../shared/varredura.mjs";
import { aplicarDocumento } from "../../shared/aplicar.mjs";

// Leitura de documento do imóvel por IA em segundo plano (matrícula, IPTU ou cadastro rural; PDF longo pode levar mais de 30 s).
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
    const r = await lerDocumento(Buffer.from(buf as ArrayBuffer).toString("base64"), tipo) as any;
    if (r.erro) { await marcar({ status: "erro", msg: r.erro, em: new Date().toISOString() }); return; }
    const at = (await obterRegistro("ofertas", oferta)) || o;
    let novo = aplicarDocumento(at, r, chave);
    // O documento trouxe CEP/endereço/CNPJ novos? A varredura pública roda sozinha, sem ninguém apertar botão.
    if (["cep", "endereco", "numero", "proprietario_doc"].some((k) => String(novo[k] || "") !== String(at[k] || ""))) {
      try { const fontes = await varrer(novo); novo = { ...novo, verificacao: { ...novo.verificacao, fontes: { ...(novo.verificacao?.fontes || {}), ...fontes }, varrido_em: new Date().toISOString(), varrido_por: "automático (documento)" } }; } catch {}
    }
    const NOME: Record<string, string> = { matricula: "Matrícula", iptu: "IPTU", rural: "Cadastro rural", outro: "Documento" };
    await salvarRegistro("ofertas", oferta, { ...novo, verificacao: { ...novo.verificacao, leitura: { status: "ok", doc: r.doc, em: new Date().toISOString() } }, atualizado: new Date().toISOString() });
    const d = r.dados || {};
    const resumo = r.doc === "matricula" ? `Matrícula ${d.numero || ""} · ${d.cartorio || ""} · ${(d.proprietarios || []).map((p: any) => p.nome).join("; ")} · ${(d.onus || []).filter((x: any) => !x.cancelado).length} ônus ativo(s)`
      : r.doc === "iptu" ? `IPTU ${d.exercicio || ""} · inscrição ${d.inscricao || "?"} · ${d.area_construida ? d.area_construida + " m² construídos" : ""}${d.debitos === true ? " · COM DÉBITOS" : ""}`
      : r.doc === "rural" ? `${d.tipo_documento || "Cadastro rural"} · ${d.car || d.ccir || d.nirf || ""} · ${d.area_ha || "?"} ha` : `${d.tipo_documento || "Documento"}: ${d.resumo || ""}`;
    await registrarEmissao({ tipo: r.doc === "matricula" ? "matricula_lida" : "documento_lido", oferta_id: oferta, conteudo: `${NOME[r.doc] || "Documento"} lido(a) pela IA · ${resumo}`, meta: { usuario, chave, doc: r.doc } });
  } catch (e) {
    console.error(e); await marcar({ status: "erro", msg: String((e as Error)?.message || e).slice(0, 200), em: new Date().toISOString() });
  }
};
