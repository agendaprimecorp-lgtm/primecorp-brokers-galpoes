// Apresentação em PDF (A4 retrato): capa com foto, ficha, descrição e fotos por ambiente.
import { jsPDF } from "jspdf";
import { grupo } from "../../shared/roteiro.mjs";

const hex = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h || ""); const n = parseInt(m ? m[1] : "C8102E", 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const nf = (v, d = 0) => { const n = Number(String(v ?? "").replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) && n > 0 ? n.toLocaleString("pt-BR", { maximumFractionDigits: d }) : ""; };
const brl = (v) => (nf(v) ? "R$ " + nf(v) : "");

/** Recorta a foto na proporção pedida (sem distorcer) e devolve JPEG em dataURL. */
async function recortar(blob, prop, larg = 1400) {
  const url = URL.createObjectURL(blob);
  try {
    const im = await new Promise((ok, f) => { const i = new Image(); i.onload = () => ok(i); i.onerror = f; i.src = url; });
    const w = im.naturalWidth, h = im.naturalHeight; let sw = w, sh = w / prop; if (sh > h) { sh = h; sw = h * prop; }
    const c = document.createElement("canvas"); c.width = larg; c.height = Math.round(larg / prop);
    c.getContext("2d").drawImage(im, (w - sw) / 2, (h - sh) / 2, sw, sh, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.82);
  } finally { URL.revokeObjectURL(url); }
}

/** cap = captação; fotos = [{ blob, ambiente }]; contato = { nome, creci, titulo, whatsapp, email, cor } */
export async function gerarPDF(cap, fotos, contato) {
  const doc = new jsPDF({ unit: "mm", format: "a4" }); const W = 210, H = 297, M = 14;
  const acc = hex(contato.cor); const ink = [30, 34, 39], g7 = [98, 108, 121], painel = [244, 245, 247];
  const d = cap.dados || {}, an = cap.anuncio || {}; const g = grupo(d.tipo);
  const rodape = () => {
    doc.setDrawColor(227, 230, 233); doc.line(M, H - 16, W - M, H - 16);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...g7);
    const q = [contato.nome, contato.titulo, contato.creci, contato.whatsapp, contato.email].filter(Boolean).join(" · ");
    doc.text(doc.splitTextToSize(q, W - 2 * M - 16)[0] || "", M, H - 10);
    doc.text("PrimeCorp Brokers · Tecnologia Propto", M, H - 5.5);
  };
  const faixa = () => { doc.setFillColor(...acc); doc.rect(0, 0, W, 3, "F"); };
  // ---- capa
  faixa();
  let y = 3;
  if (fotos[0]) { doc.addImage(await recortar(fotos[0].blob, W / 160), "JPEG", 0, y, W, 160); y += 160; }
  y += 10;
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...acc);
  doc.text([d.tipo, d.operacao, cap.codigo].filter(Boolean).join("  ·  ").toUpperCase(), M, y); y += 8;
  doc.setTextColor(...ink); doc.setFontSize(21); const tl = doc.splitTextToSize(an.titulo || d.tipo || "Imóvel", W - 2 * M); doc.text(tl, M, y); y += tl.length * 8.5;
  doc.setFont("helvetica", "normal"); doc.setFontSize(11.5); doc.setTextColor(...g7);
  const sub = [[d.bairro, d.cidade].filter(Boolean).join(", "), an.subtitulo].filter(Boolean).join(" · "); const sl = doc.splitTextToSize(sub, W - 2 * M); doc.text(sl, M, y); y += sl.length * 5.5 + 6;
  const kpis = [[brl(d.venda), "Venda"], [brl(d.aluguel), "Aluguel/mês"],
    ...(g === "rural" ? [[nf(d.area_ha, 2) && nf(d.area_ha, 2) + " ha", "Área total"]] : g === "galpao" ? [[nf(d.construida) && nf(d.construida) + " m²", "Construída"], [nf(d.pe_direito, 1) && nf(d.pe_direito, 1) + " m", "Pé-direito"], [nf(d.docas), "Docas"]] : g === "area" ? [[nf(d.terreno) && nf(d.terreno) + " m²", "Terreno"]] : [[nf(d.construida) && nf(d.construida) + " m²", "Área"], [nf(d.dormitorios), "Dormitórios"], [nf(d.vagas), "Vagas"]])].filter((x) => x[0]).slice(0, 4);
  if (kpis.length) { const kw = (W - 2 * M - (kpis.length - 1) * 4) / kpis.length; kpis.forEach((k, i) => { const x = M + i * (kw + 4); doc.setFillColor(...painel); doc.rect(x, y, kw, 20, "F"); doc.setFillColor(...acc); doc.rect(x, y, kw, 1.2, "F"); doc.setFont("helvetica", "bold"); doc.setFontSize(13); doc.setTextColor(...ink); doc.text(String(k[0]), x + 4, y + 10); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...g7); doc.text(k[1], x + 4, y + 16); }); }
  rodape();
  // ---- ficha e descrição
  doc.addPage(); faixa(); y = 18;
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...acc); doc.text("SOBRE O IMÓVEL", M, y); y += 8;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); doc.setTextColor(...ink);
  for (const p of String(an.descricao || "").split(/\n\s*\n/)) { const ll = doc.splitTextToSize(p, W - 2 * M); doc.text(ll, M, y); y += ll.length * 5 + 3; }
  y += 3;
  const ficha = [["Tipo", d.tipo], ["Operação", d.operacao], ["Local", [d.bairro, d.cidade, d.uf].filter(Boolean).join(", ")], ["Venda", brl(d.venda)], ["Aluguel mensal", brl(d.aluguel)], ["Condomínio", brl(d.condominio)], ["IPTU", brl(d.iptu)],
    ["Área construída / útil", nf(d.construida) && nf(d.construida) + " m²"], ["Terreno", nf(d.terreno) && nf(d.terreno) + " m²"], ["Área total", nf(d.area_ha, 2) && nf(d.area_ha, 2) + " ha"], ["Dormitórios", nf(d.dormitorios)], ["Suítes", nf(d.suites)], ["Banheiros", nf(d.banheiros)], ["Vagas", nf(d.vagas)],
    ["Pé-direito", nf(d.pe_direito, 1) && nf(d.pe_direito, 1) + " m"], ["Docas", nf(d.docas)], ["Energia", nf(d.energia_kva) && nf(d.energia_kva) + " kVA"], ["Aptidão", d.aptidao], ["Água", d.agua], ["Benfeitorias", d.benfeitorias], ["Documentação", d.documentacao], ["Disponibilidade", d.disponibilidade]].filter((x) => x[1]);
  doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...acc); doc.text("FICHA TÉCNICA", M, y); y += 4;
  doc.setFontSize(10);
  for (const [i, [k, v]] of ficha.entries()) {
    if (y > H - 30) { rodape(); doc.addPage(); faixa(); y = 18; }
    if (i % 2 === 0) { doc.setFillColor(...painel); doc.rect(M, y, W - 2 * M, 7.5, "F"); }
    doc.setFont("helvetica", "normal"); doc.setTextColor(...g7); doc.text(k, M + 3, y + 5.2);
    doc.setFont("helvetica", "bold"); doc.setTextColor(...ink); doc.text(doc.splitTextToSize(String(v), 100)[0], W - M - 3, y + 5.2, { align: "right" }); y += 7.5;
  }
  if ((an.destaques || []).length) {
    y += 6; if (y > H - 50) { rodape(); doc.addPage(); faixa(); y = 18; }
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(...acc); doc.text("DESTAQUES", M, y); y += 6;
    doc.setFont("helvetica", "normal"); doc.setFontSize(10.5); doc.setTextColor(...ink);
    for (const x of an.destaques.slice(0, 10)) { doc.setFillColor(...acc); doc.rect(M, y - 2.6, 2, 2, "F"); doc.text(doc.splitTextToSize(x, W - 2 * M - 6)[0], M + 5, y); y += 6; }
  }
  rodape();
  // ---- fotos (2 por página)
  const resto = fotos.slice(1, 25);
  for (let i = 0; i < resto.length; i += 2) {
    doc.addPage(); faixa();
    for (let j = 0; j < 2 && resto[i + j]; j++) {
      const f = resto[i + j]; const yy = 12 + j * 134; const hh = 120;
      doc.addImage(await recortar(f.blob, (W - 2 * M) / hh, 1200), "JPEG", M, yy, W - 2 * M, hh);
      doc.setFillColor(15, 23, 32); doc.rect(M, yy + hh - 9, W - 2 * M, 9, "F");
      doc.setFont("helvetica", "bold"); doc.setFontSize(9.5); doc.setTextColor(255, 255, 255); doc.text(String(f.ambiente || "").toUpperCase(), M + 4, yy + hh - 3.2);
    }
    rodape();
  }
  const n = doc.getNumberOfPages();
  for (let p = 1; p <= n; p++) { doc.setPage(p); doc.setFont("helvetica", "normal"); doc.setFontSize(8.5); doc.setTextColor(...g7); doc.text(`${p}/${n}`, W - M, H - 10, { align: "right" }); }
  return doc;
}
