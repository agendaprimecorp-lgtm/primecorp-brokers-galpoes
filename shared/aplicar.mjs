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
