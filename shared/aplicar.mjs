// Aplica a matrícula lida à oferta: guarda o resultado e completa SÓ os campos vazios (nunca sobrescreve o que o corretor digitou).
const vazio = (v) => v == null || String(v).trim() === "";
const fmt = (n) => (n ? Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "");
export function aplicarMatricula(o, m, chave) {
  const p = {};
  const set = (k, v) => { if (vazio(o[k]) && !vazio(v)) p[k] = v; };
  set("matricula", m.numero); set("cartorio", m.cartorio); set("inscricao", m.inscricao); set("ccir", m.ccir); set("car", m.car); set("nirf", m.nirf);
  if ((m.proprietarios || []).length === 1) { set("proprietario", m.proprietarios[0].nome); set("proprietario_doc", m.proprietarios[0].documento); }
  else if ((m.proprietarios || []).length > 1) set("proprietario", m.proprietarios.map((x) => x.nome).join("; "));
  set("terreno", fmt(m.area_terreno)); set("area_ha", fmt(m.area_ha));
  if (vazio(o.documentacao)) p.documentacao = m.construcao_averbada === false ? "Matrícula lida: construção NÃO averbada" : m.construcao_averbada ? "Matrícula lida: construção averbada" : "Matrícula lida";
  const preenchidos = Object.keys(p);
  return { ...o, ...p, verificacao: { ...(o.verificacao || {}), matricula: { ...m, arquivo: chave, lida_em: new Date().toISOString(), preencheu: preenchidos } } };
}

/** Aplica qualquer documento lido (matrícula, IPTU, cadastro rural). Completa só campos vazios e guarda a leitura. */
export function aplicarDocumento(o, r, chave) {
  if (r.doc === "matricula") return aplicarMatricula(o, r.dados, chave);
  const p = {}; const set = (k, v) => { if (vazio(o[k]) && !vazio(v)) p[k] = v; };
  const vr = { ...(o.verificacao || {}) }; const quando = new Date().toISOString();
  if (r.doc === "iptu") {
    const d = r.dados;
    set("inscricao", d.inscricao); set("cep", d.cep); set("endereco", d.endereco ? d.endereco.replace(/,?\s*n?º?\s*\d+[\w\s/-]*$/i, "").trim() : ""); set("bairro", d.bairro);
    const nm = String(d.endereco || "").match(/,\s*(?:n[ºo°.]?\s*)?(\d{1,6})\b/i); if (nm) set("numero", nm[1]);
    set("terreno", fmt(d.area_terreno)); set("construida", fmt(d.area_construida));
    vr.iptu = { ...d, arquivo: chave, lida_em: quando, preencheu: Object.keys(p) };
  } else if (r.doc === "rural") {
    const d = r.dados;
    set("car", d.car); set("ccir", d.ccir); set("nirf", d.nirf); set("sigef", d.sigef); set("area_ha", fmt(d.area_ha));
    vr.rural = { ...d, arquivo: chave, lida_em: quando, preencheu: Object.keys(p) };
  } else {
    vr.outros = [...(vr.outros || []).slice(-9), { ...r.dados, arquivo: chave, lida_em: quando }];
  }
  return { ...o, ...p, verificacao: vr };
}
