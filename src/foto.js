/* Tratamento de fotos no celular: orientação, redimensionamento, níveis automáticos,
   balanço de branco leve, clareamento de fotos escuras e checagem de nitidez. */
const carregar = (file) => new Promise((ok, falha) => {
  const url = URL.createObjectURL(file); const im = new Image();
  im.onload = () => { URL.revokeObjectURL(url); ok(im); };
  im.onerror = () => { URL.revokeObjectURL(url); falha(new Error("Não foi possível abrir a foto.")); };
  im.src = url;
});
const canvasDe = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
const toJPEG = (c, q) => new Promise((ok) => c.toBlob((b) => ok(b), "image/jpeg", q));
export const blobB64 = (b) => new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1]); r.readAsDataURL(b); });

/** Calcula as curvas de correção a partir dos pixels (função pura, testável). */
export function curvas(px, opts = {}) {
  const n = px.length / 4; const passo = Math.max(1, Math.floor(n / 60000));
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)]; let soma = [0, 0, 0], cont = 0, lum = 0;
  for (let i = 0; i < n; i += passo) { const o = i * 4; for (let c = 0; c < 3; c++) { hist[c][px[o + c]]++; soma[c] += px[o + c]; } lum += 0.299 * px[o] + 0.587 * px[o + 1] + 0.114 * px[o + 2]; cont++; }
  const pct = (h, p) => { let a = 0; const alvo = cont * p; for (let v = 0; v < 256; v++) { a += h[v]; if (a >= alvo) return v; } return 255; };
  const media = soma.map((s) => s / cont); const cinza = (media[0] + media[1] + media[2]) / 3; const lm = lum / cont / 255;
  const forca = opts.forca ?? 1;
  const luts = [0, 1, 2].map((c) => {
    let lo = pct(hist[c], 0.004), hi = pct(hist[c], 0.996);
    if (hi - lo < 40) { lo = 0; hi = 255; }
    const ganhoMax = 1.6; if (255 / (hi - lo) > ganhoMax) { const meio = (hi + lo) / 2, meia = 255 / ganhoMax / 2; lo = meio - meia; hi = meio + meia; }
    const wb = 1 + ((cinza / (media[c] || 1)) - 1) * 0.45 * forca; // balanço de branco parcial
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) { let x = ((v - lo) / (hi - lo)) * 255; x = v + (x - v) * forca; lut[v] = x * wb; }
    return lut;
  });
  let gama = 1; if (lm < 0.42) gama = Math.max(0.72, Math.log(0.47) / Math.log(Math.max(0.05, lm)));
  if (gama !== 1) for (const lut of luts) for (let v = 0; v < 256; v++) lut[v] = 255 * Math.pow(lut[v] / 255, gama);
  return { luts, lum: lm, gama };
}
/** Nitidez: variância do laplaciano numa versão pequena em cinza. */
export function nitidez(gray, w, h) {
  let s = 0, s2 = 0, k = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; const l = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w]; s += l; s2 += l * l; k++; }
  const m = s / k; return s2 / k - m * m;
}
/** Trata uma foto e devolve { blob, mini (base64 p/ IA), w, h, avisos[] }. */
export async function tratarFoto(file, { lado = 1920, tratar = true } = {}) {
  const im = await carregar(file);
  const esc = Math.min(1, lado / Math.max(im.naturalWidth, im.naturalHeight));
  const w = Math.round(im.naturalWidth * esc), h = Math.round(im.naturalHeight * esc);
  const c = canvasDe(w, h); const g = c.getContext("2d", { willReadFrequently: true }); g.imageSmoothingQuality = "high"; g.drawImage(im, 0, 0, w, h);
  const avisos = [];
  const sw = 320, sh = Math.round((320 * h) / w); const pc = canvasDe(sw, sh); const pg = pc.getContext("2d"); pg.drawImage(c, 0, 0, sw, sh);
  const pd = pg.getImageData(0, 0, sw, sh).data; const gray = new Float32Array(sw * sh);
  for (let i = 0; i < sw * sh; i++) gray[i] = 0.299 * pd[i * 4] + 0.587 * pd[i * 4 + 1] + 0.114 * pd[i * 4 + 2];
  const nit = nitidez(gray, sw, sh); if (nit < 60) avisos.push("Foto pode estar tremida: se possível, repita.");
  if (tratar) {
    const img = g.getImageData(0, 0, w, h); const d = img.data; const { luts, lum } = curvas(d);
    if (lum < 0.3) avisos.push("Ambiente escuro: acenda as luzes ou abra as janelas.");
    const sat = 1.08;
    for (let i = 0; i < d.length; i += 4) {
      let r = luts[0][d[i]], gg = luts[1][d[i + 1]], b = luts[2][d[i + 2]];
      const l = 0.299 * r + 0.587 * gg + 0.114 * b; r = l + (r - l) * sat; gg = l + (gg - l) * sat; b = l + (b - l) * sat;
      d[i] = r; d[i + 1] = gg; d[i + 2] = b;
    }
    g.putImageData(img, 0, 0);
  }
  if (h > w * 1.05) avisos.push("Foto na vertical: para anúncio, prefira o celular na horizontal.");
  const blob = await toJPEG(c, 0.85);
  const mw = 768, mh = Math.round((768 * h) / w); const mc = canvasDe(mw, mh); mc.getContext("2d").drawImage(c, 0, 0, mw, mh);
  const mini = await blobB64(await toJPEG(mc, 0.7));
  return { blob, mini, w, h, avisos, nitidez: Math.round(nit) };
}
