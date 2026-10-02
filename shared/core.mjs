/* ===== Núcleo: formatação, checagens e PDF (compartilhado entre o app e o teste em Node) ===== */
const PC = {};

PC.parseBR = function (v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  let s = String(v).trim();
  if (!s) return null;
  s = s.replace(/[^0-9,.\-]/g, '');
  if (!s || s === '-' ) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
};
PC.nf = function (n, dec) {
  if (n === null || n === undefined || !isFinite(n)) return '';
  const d = dec === undefined ? (Number.isInteger(n) ? 0 : 2) : dec;
  return n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
};
PC.m2 = n => (n ? PC.nf(Math.round(n), 0) + ' m²' : null);
PC.brl = n => (n ? 'R$ ' + PC.nf(Math.round(n), 0) : null);
PC.brl2 = n => (n ? 'R$ ' + PC.nf(n, 2) : null);
PC.num = d => {
  const k = ['terreno', 'construida', 'fabril', 'administrativo', 'apoio', 'pe_direito', 'piso_carga', 'docas', 'energia_kva', 'aluguel', 'venda', 'condominio', 'iptu'];
  const o = Object.assign({}, d);
  k.forEach(f => (o[f] = PC.parseBR(d[f])));
  o.diferenciais = PC.lines(d.diferenciais);
  o.itens = PC.lines(d.itens);
  return o;
};
PC.lines = v => (Array.isArray(v) ? v : String(v || '').split('\n')).map(s => String(s).replace(/^[\s•\-–*·]+/, '').trim()).filter(Boolean);
PC.areaRef = d => d.fabril || d.construida || d.terreno || null;

PC.autoTitle = function (d) {
  const tipo = d.tipo || 'Galpão';
  const cid = d.cidade ? ' em ' + d.cidade : '';
  if (d.fabril) return `${tipo} com ${PC.m2(d.fabril)} de área fabril${cid}`;
  if (d.construida) return `${tipo} de ${PC.m2(d.construida)} construídos${cid}`;
  return tipo + cid;
};

/* --- Checagem de consistência (regras da skill descritivo-galpao) --- */
PC.checks = function (d, history) {
  const A = [];
  const add = (lvl, msg, item) => A.push({ lvl, msg, item });
  const ref = d.fabril || d.construida;

  if (d.terreno && d.construida && d.construida > d.terreno * 1.02 && !/andar|pavimento|mezanino/i.test(d.descricao || ''))
    add('v', 'Construída maior que o terreno, sem andares declarados.', 'Área construída x terreno: divergência no anúncio (pedir matrícula)');
  if (d.construida && d.terreno && d.construida === d.terreno && d.construida % 1000 === 0)
    add('a', 'Construída igual ao terreno e número redondo: pode ser só o terreno.', 'Área construída efetiva (anúncio repete o valor do terreno)');
  if (d.fabril && d.construida && d.fabril > d.construida * 1.02)
    add('v', 'Área fabril maior que a construída.', 'Área fabril x construída: divergência no anúncio');
  if (d.fabril && d.construida && (d.administrativo || d.apoio)) {
    const s = d.fabril + (d.administrativo || 0) + (d.apoio || 0);
    if (Math.abs(s - d.construida) / d.construida > 0.1)
      add('a', `Soma das áreas (${PC.m2(s)}) não fecha com a construída (${PC.m2(d.construida)}).`, 'Quadro de áreas: soma não fecha com a área construída');
  }
  if (d.aluguel && (d.construida || d.fabril)) {
    const base = d.construida || d.fabril;
    const v = d.aluguel / base;
    if (v < 12) add('v', `Aluguel de ${PC.brl2(v)}/m² abaixo da faixa (R$ 13 a 30): área pode estar inflada (terreno?).`, 'Área locável efetiva (preço por m² fora da faixa de mercado)');
    else if (v > 35) add('a', `Aluguel de ${PC.brl2(v)}/m² acima da faixa (R$ 13 a 30).`, 'Valor de locação acima da média regional: negociar / confirmar');
  }
  if (d.iptu && d.aluguel && d.iptu > 0.3 * d.aluguel && d.iptu_periodo !== 'anual')
    add('a', 'IPTU maior que 30% do aluguel: provável valor anual.', 'IPTU: periodicidade a confirmar (valor sugere anual)');
  if (ref && ref > 3000 && (!d.energia_kva || d.energia_kva < 300))
    add('a', d.energia_kva ? `Energia de ${PC.nf(d.energia_kva)} kVA baixa para ${PC.m2(ref)}.` : 'Energia (kVA) não informada.',
      d.energia_kva ? `Energia: ${PC.nf(d.energia_kva)} kVA – verificar capacidade para uso industrial` : 'Energia: potência (kVA) e cabine primária a confirmar');
  if (!d.pe_direito) add('a', 'Pé-direito não informado.', 'Pé-direito livre a confirmar');
  else if (d.pe_direito < 8) add('a', `Pé-direito de ${PC.nf(d.pe_direito)} m limita armazenagem verticalizada.`, `Pé-direito de ${PC.nf(d.pe_direito)} m: verificar aderência à operação`);
  if (!d.piso_carga) add('a', 'Capacidade do piso não informada.', 'Capacidade do piso (t/m²) a confirmar');
  if (!d.avcb) add('a', 'AVCB / incêndio não informado.', 'AVCB e sistema de combate a incêndio a confirmar');
  if (d.data_anuncio) {
    const t = Date.parse(d.data_anuncio);
    if (t && Date.now() - t > 365 * 864e5) add('a', 'Material com mais de 12 meses.', 'Disponibilidade atual a confirmar (material antigo)');
  }
  (d.alertas_ia || []).forEach(x => x && x.msg && add(x.lvl === 'v' ? 'v' : 'a', x.msg, x.item || x.msg));
  if (history && ref) {
    history.forEach(h => {
      if (h.id === d.id) return;
      const hr = h.fabril || h.construida;
      if (hr && h.cidade && d.cidade && h.cidade.toLowerCase() === String(d.cidade).toLowerCase() && Math.abs(hr - ref) / ref < 0.05)
        add('a', `Parecido com "${h.titulo}" (${h.quando}): possível mesmo imóvel.`, 'Possível duplicidade com outro anúncio: confirmar matrícula');
    });
  }
  const forb = /\b(rua|r\.|avenida|av\.|alameda|travessa|n[ºo°]\s?\d|bairro|jardim|jd\.|vila|condom[ií]nio\s+[A-Z]|imobili[áa]ria|creci|c[óo]d(igo|\.)|ref\.?\s?\d|zap|viva ?real|imovelweb|olx|quintoandar)\b/i;
  const txt = [d.titulo, d.subtitulo, d.descricao].concat(d.diferenciais || []).join(' \n ');
  const hit = txt.match(forb);
  const privacy = hit ? `Texto contém "${hit[0]}": revise (sem endereço, bairro, condomínio, imobiliária ou portal).` : null;

  let sem = 'verde';
  if (A.some(a => a.lvl === 'v')) sem = 'vermelho';
  else if (A.length) sem = 'amarelo';
  return { alerts: A, sem, privacy };
};

/* --- Texto para WhatsApp --- */
PC.whats = function (d, chk) {
  const L = [];
  L.push(`*${d.titulo || PC.autoTitle(d)}*`);
  const sub = [d.operacao, d.cidade && d.cidade + (d.uf ? '/' + d.uf : ''), d.subtitulo].filter(Boolean).join(' · ');
  if (sub) L.push(sub);
  L.push('');
  if (d.fabril) L.push(`▪️ Área fabril: ${PC.m2(d.fabril)}`);
  if (d.construida) L.push(`▪️ Construída: ${PC.m2(d.construida)}`);
  if (d.terreno) L.push(`▪️ Terreno: ${PC.m2(d.terreno)}`);
  const est = [d.pe_direito && `pé-direito ${PC.nf(d.pe_direito)} m`, d.docas && `${PC.nf(d.docas)} docas`, d.energia_kva && `${PC.nf(d.energia_kva)} kVA`, d.piso_carga && `piso ${PC.nf(d.piso_carga)} t/m²`].filter(Boolean);
  if (est.length) L.push('▪️ ' + est.join(' · ').replace(/^./, c => c.toUpperCase()));
  if (d.aluguel) L.push(`▪️ Aluguel: ${PC.brl(d.aluguel)}/mês` + (d.construida ? ` (${PC.brl2(d.aluguel / d.construida)}/m²)` : ''));
  if (d.venda) L.push(`▪️ Venda: ${PC.brl(d.venda)}`);
  const enc = [d.condominio && `condomínio ${PC.brl(d.condominio)}`, d.iptu && `IPTU ${PC.brl(d.iptu)}${d.iptu_periodo === 'anual' ? '/ano' : d.iptu_periodo === 'mensal' ? '/mês' : ' (periodicidade a confirmar)'}`].filter(Boolean);
  if (enc.length) L.push('▪️ ' + enc.join(' · ').replace(/^./, c => c.toUpperCase()));
  if (d.diferenciais.length) { L.push(''); L.push('*Diferenciais:* ' + d.diferenciais.slice(0, 5).join('; ') + '.'); }
  const it = PC.itensPDF(d, chk);
  if (it.length) { L.push(''); L.push('*A confirmar:* ' + it.slice(0, 5).join('; ') + '.'); }
  L.push('');
  L.push('Descritivo completo em PDF. Agende uma visita.');
  L.push('Rodrigo França Viana · Corretor de Imóveis · CRECI-SP 297692');
  return L.join('\n');
};

PC.itensPDF = function (d, chk) {
  const out = [];
  const seen = new Set();
  d.itens.concat(chk.alerts.map(a => a.item)).forEach(s => {
    const k = s.toLowerCase().slice(0, 18);
    if (!seen.has(k)) { seen.add(k); out.push(s); }
  });
  return out;
};

/* --- PDF de 1 página (A4) --- */
PC.pdf = function (jsPDF, d, chk, logos) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  const W = 595.28, H = 841.89, M = 38, IW = W - 2 * M;
  const C = { g: [30, 34, 39], r: [200, 16, 46], p: [244, 245, 247], z: [250, 250, 251], t: [30, 34, 39], t2: [90, 96, 104], ln: [217, 220, 225], w: [255, 255, 255], wl: [190, 195, 202] };
  const fill = c => doc.setFillColor(c[0], c[1], c[2]);
  const ink = c => doc.setTextColor(c[0], c[1], c[2]);
  const pen = c => doc.setDrawColor(c[0], c[1], c[2]);
  const F = (s, b) => { doc.setFont('helvetica', b ? 'bold' : 'normal'); doc.setFontSize(s); };
  const clean = s => String(s == null ? '' : s).replace(/[≈]/g, '~').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[^\x00-\xFF–—•²³ºª·€]/g, '');
  const T = (s, x, y, o) => doc.text(clean(s), x, y, o);
  const AC = 'A confirmar';
  const op = (d.operacao || 'Locação').toUpperCase();

  // faixa e cabeçalho
  fill(C.r); doc.rect(0, 0, W, 8, 'F');
  let y = 34;
  F(8.2, true); ink(C.r); T([(d.tipo || 'Galpão'), d.cidade && (d.cidade + (d.uf ? '/' + d.uf : ''))].filter(Boolean).join(' · ').toUpperCase(), M, y);
  F(7.6, false); ink(C.t2); T('FICHA DESCRITIVA · ' + op, M, y + 12);
  if (logos && logos.dark) { const lh = 26, lw = lh * logos.ratio; doc.addImage(logos.dark, 'PNG', W - M - lw, y - 17, lw, lh); }

  // título
  y = 82;
  let ts = 21; F(ts, true);
  let tl = doc.splitTextToSize(clean(d.titulo || PC.autoTitle(d)), IW);
  if (tl.length > 1) { ts = 18; F(ts, true); tl = doc.splitTextToSize(clean(d.titulo || PC.autoTitle(d)), IW); }
  tl = tl.slice(0, 2);
  ink(C.t); tl.forEach((l, i) => T(l, M, y + i * (ts + 3)));
  y += (tl.length - 1) * (ts + 3) + 17;
  F(10.5, false); ink(C.t2);
  const sub = [d.cidade && d.cidade + (d.uf ? '/' + d.uf : ''), d.regiao, d.subtitulo].filter(Boolean).join(' · ');
  T(doc.splitTextToSize(clean(sub), IW)[0] || '', M, y);
  y += 11; pen(C.ln); doc.setLineWidth(0.8); doc.line(M, y, W - M, y);

  // KPIs
  y += 12;
  const k = [];
  k.push([d.fabril ? PC.m2(d.fabril) : AC, 'Área fabril / galpão']);
  k.push([d.construida ? PC.m2(d.construida) : AC, 'Área construída']);
  k.push([d.terreno ? PC.m2(d.terreno) : AC, 'Terreno']);
  if (d.pe_direito) k.push([PC.nf(d.pe_direito) + ' m', 'Pé-direito']);
  else if (d.docas) k.push([PC.nf(d.docas), 'Docas']);
  else k.push([d.energia_kva ? PC.nf(d.energia_kva) + ' kVA' : AC, 'Energia']);
  const kg = 8, kw = (IW - 3 * kg) / 4, kh = 50;
  k.forEach((c, i) => {
    const x = M + i * (kw + kg);
    fill(C.p); doc.rect(x, y, kw, kh, 'F'); fill(C.r); doc.rect(x, y, kw, 2.6, 'F');
    const v = c[0]; F(v === AC ? 12 : 16, true); ink(v === AC ? C.t2 : C.t); T(v, x + 10, y + 26);
    F(8.3, false); ink(C.t2); T(c[1], x + 10, y + 40);
  });
  y += kh + 20;

  // descrição
  F(9.6, false); ink(C.t);
  let pl = doc.splitTextToSize(clean(d.descricao || ''), IW).slice(0, 7);
  pl.forEach((l, i) => T(l, M, y + i * 14));
  y += pl.length ? pl.length * 14 + 8 : 0;

  // tabelas
  const table = (x, yt, w, title, rows, cw) => {
    fill(C.g); doc.rect(x, yt, w, 18, 'F'); F(8, true); ink(C.w); T(title, x + 8, yt + 12.2);
    let yy = yt + 18;
    rows.forEach((r, i) => {
      const rh = 16.5;
      if (i % 2) { fill(C.z); } else { fill(C.p); }
      doc.rect(x, yy, w, rh, 'F');
      F(8.4, false); ink(C.t2); T(r[0], x + 8, yy + 11.3);
      const isAC = r[1] === AC || /confirmar|não informado/i.test(r[1]);
      F(8.4, !isAC); ink(isAC ? C.t2 : C.t);
      if (r.length === 3) {
        T(r[1], x + cw[0], yy + 11.3);
        F(7.8, false); ink(C.t2); T(r[2], x + w - 8, yy + 11.3, { align: 'right' });
      } else T(doc.splitTextToSize(clean(r[1]), w - cw[0] - 8)[0], x + w - 8, yy + 11.3, { align: 'right' });
      yy += rh;
    });
    pen(C.ln); doc.setLineWidth(0.6); doc.line(x, yy, x + w, yy);
    return yy;
  };
  const tw = (IW - 12) / 2;
  const areas = [
    ['Terreno', d.terreno ? PC.m2(d.terreno) : AC],
    ['Área construída', d.construida ? PC.m2(d.construida) : AC],
    ['Galpão / área fabril', d.fabril ? PC.m2(d.fabril) : AC],
    ['Administrativo', d.administrativo ? PC.m2(d.administrativo) : AC],
    ['Apoio / outros', d.apoio ? PC.m2(d.apoio) : (d.apoio_txt || AC)],
    ['Tipologia', d.tipologia || AC],
  ];
  const estr = [
    ['Pé-direito', d.pe_direito ? PC.nf(d.pe_direito) + ' m' : AC],
    ['Piso (carga)', d.piso_carga ? PC.nf(d.piso_carga) + ' t/m²' : AC],
    ['Docas', d.docas ? PC.nf(d.docas) : AC],
    ['Energia', d.energia_kva ? PC.nf(d.energia_kva) + ' kVA' : AC],
    ['Pontes rolantes', d.pontes || 'Não informado'],
    ['AVCB / incêndio', d.avcb || AC],
  ];
  const y1 = table(M, y, tw, 'ÁREAS', areas, [90]);
  const y2 = table(M + tw + 12, y, tw, 'ESTRUTURA', estr, [90]);
  y = Math.max(y1, y2) + 14;

  // condições
  const cond = [];
  const base = d.construida || d.fabril;
  if (d.aluguel) cond.push(['Aluguel mensal', PC.brl(d.aluguel), base ? PC.brl2(d.aluguel / base) + '/m² ' + (d.construida ? 'construída' : 'fabril') : '']);
  if (d.venda) cond.push(['Venda', PC.brl(d.venda), base ? PC.brl2(d.venda / base) + '/m² ' + (d.construida ? 'construída' : 'fabril') : '']);
  if (!d.aluguel && !d.venda) cond.push(['Valor', 'Sob consulta', '']);
  cond.push(['Condomínio', d.condominio ? PC.brl(d.condominio) : (d.condominio_txt || AC), d.condominio ? 'mensal' : '']);
  const iptuAmb = d.iptu && d.iptu_periodo !== 'anual' && d.iptu_periodo !== 'mensal';
  const iptuAnualProv = d.iptu && d.aluguel && d.iptu > 0.3 * d.aluguel && d.iptu_periodo !== 'anual';
  cond.push(['IPTU', d.iptu ? PC.brl(d.iptu) : AC, d.iptu ? (d.iptu_periodo === 'anual' ? 'anual' : d.iptu_periodo === 'mensal' && !iptuAnualProv ? 'mensal' : 'periodicidade a confirmar') : '']);
  if (d.aluguel && d.condominio != null && d.iptu && d.iptu_periodo === 'mensal' && !iptuAnualProv && !iptuAmb) {
    const tot = d.aluguel + (d.condominio || 0) + d.iptu;
    cond.push(['Custo de ocupação', PC.brl(tot), base ? PC.brl2(tot / base) + '/m²' : '']);
  } else if (d.aluguel && d.iptu && d.iptu_periodo === 'anual') {
    const tot = d.aluguel + (d.condominio || 0) + d.iptu / 12;
    cond.push(['Custo de ocupação', PC.brl(tot), 'IPTU rateado mensal']);
  } else cond.push(['Disponibilidade', d.disponibilidade || AC, '']);
  y = table(M, y, IW, 'CONDIÇÕES COMERCIAIS', cond, [150]) + 16;

  // bullets
  const ctaY = H - 112;
  const itens = PC.itensPDF(d, chk);
  const dif = d.diferenciais.slice(0, 8);
  const it = itens.slice(0, 8);
  const cw = (IW - 18) / 2;
  let fs = 8.6, lh;
  const measure = (arr, s) => { F(s, false); return arr.reduce((h, b) => h + doc.splitTextToSize(clean(b), cw - 12).length * (s + 3) + 3, 0); };
  while (fs > 6.8 && Math.max(measure(dif, fs), measure(it, fs)) > ctaY - y - 30) fs -= 0.3;
  lh = fs + 3;
  const col = (x, title, arr) => {
    F(8.5, true); ink(C.r); T(title, x, y);
    pen(C.ln); doc.setLineWidth(0.6); doc.line(x, y + 5, x + cw, y + 5);
    let yy = y + 18;
    if (!arr.length) { F(fs, false); ink(C.t2); T('—', x, yy); return; }
    arr.forEach(b => {
      F(fs, false); ink(C.t);
      const ls = doc.splitTextToSize(clean(b), cw - 12);
      if (yy + ls.length * lh > ctaY - 10) return;
      fill(C.r); doc.rect(x, yy - fs * 0.62, 3.6, 3.6, 'F');
      ls.forEach((l, i) => T(l, x + 11, yy + i * lh));
      yy += ls.length * lh + 3;
    });
  };
  col(M, 'DIFERENCIAIS', dif);
  col(M + cw + 18, 'ITENS A CONFIRMAR', it);

  // CTA
  fill(C.g); doc.rect(M, ctaY, IW, 56, 'F'); fill(C.r); doc.rect(M, ctaY, 4, 56, 'F');
  F(13, true); ink(C.w); T('Agende uma visita', M + 18, ctaY + 24);
  F(8.4, false); ink(C.wl); T('Informações sujeitas a confirmação em vistoria e documentação do imóvel.', M + 18, ctaY + 40);
  if (logos && logos.white) { const lh2 = 24, lw2 = lh2 * logos.ratio; doc.addImage(logos.white, 'PNG', W - M - 14 - lw2, ctaY + 16, lw2, lh2); }

  // rodapé
  pen(C.ln); doc.setLineWidth(0.6); doc.line(M, H - 40, W - M, H - 40);
  F(7.6, false); ink(C.t2);
  T('Rodrigo França Viana · Corretor de Imóveis · CRECI-SP 297692 · contato@primecorpconsultoria.com.br', M, H - 27);
  T((d.codigo ? 'Ref. ' + d.codigo + ' · ' : '') + '1/1', W - M, H - 27, { align: 'right' });
  return doc;
};

PC.filename = function (d) {
  const s = x => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const a = PC.areaRef(d);
  return `Descritivo_${s(d.tipo || 'Galpao')}_${s(d.cidade || 'Imovel')}${a ? '_' + Math.round(a) + 'm2' : ''}.pdf`;
};


/* ===== v2: cruzamento, teaser, etapas ===== */
PC.ETAPAS = [['teaser','Teaser'],['interesse','Interesse'],['termo','Termo assinado'],['parceria','Parceria'],['visita','Visita'],['proposta','Proposta'],['fechado','Fechado']];
PC.etapaIdx = e => PC.ETAPAS.findIndex(x => x[0] === e);
PC.areaOf = d => d.fabril || d.construida || d.terreno || null;
PC.norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

PC.score = function (oRaw, bRaw, chk) {
  const o = PC.num(oRaw), b = PC.numB(bRaw);
  const R = []; let s = 100, out = null;
  const pen = (n, msg) => { s -= n; R.push(msg); };
  // operação
  const op = PC.norm(o.operacao), bo = PC.norm(b.operacao);
  if (bo && op && !op.includes('/') && ((bo.startsWith('loc') && !op.startsWith('loc')) || (bo.startsWith('venda') || bo.startsWith('compra')) && !op.startsWith('venda')))
    out = 'Operação diferente do briefing';
  // tipo
  if (b.tipo && o.tipo && PC.norm(b.tipo).split(' ')[0] !== PC.norm(o.tipo).split(' ')[0]) pen(20, 'Tipo diferente');
  // área
  const a = PC.areaOf(o);
  if (!a) pen(15, 'Área a confirmar');
  else {
    if (b.areaMin && a < b.areaMin * 0.9) out = out || `Área (${PC.m2(a)}) abaixo do mínimo`;
    else if (b.areaMax && a > b.areaMax * 1.1) out = out || `Área (${PC.m2(a)}) acima do máximo`;
    else if ((b.areaMin && a < b.areaMin) || (b.areaMax && a > b.areaMax)) pen(12, 'Área um pouco fora da faixa');
  }
  // localização
  const cids = PC.norm(b.cidades).split(/[,;\/]+/).map(x => x.trim()).filter(Boolean);
  if (cids.length && o.cidade && !cids.includes(PC.norm(o.cidade))) {
    if (b.regiao && o.regiao && PC.norm(o.regiao).includes(PC.norm(b.regiao))) pen(5, 'Fora das cidades listadas, mesma região');
    else pen(25, 'Fora das cidades do briefing');
  }
  // pé-direito
  if (b.peMin) { if (!o.pe_direito) pen(8, 'Pé-direito a confirmar'); else if (o.pe_direito < b.peMin) out = out || `Pé-direito (${PC.nf(o.pe_direito)} m) abaixo do mínimo`; }
  // energia
  if (b.kvaMin) { if (!o.energia_kva) pen(8, 'Energia a confirmar'); else if (o.energia_kva < b.kvaMin) pen(20, `Energia (${PC.nf(o.energia_kva)} kVA) abaixo do pedido`); }
  // docas
  if (b.docasMin) { if (!o.docas) pen(4, 'Docas a confirmar'); else if (o.docas < b.docasMin) pen(10, 'Menos docas que o pedido'); }
  // preço
  if (b.precoMaxM2 && (!bo || bo.startsWith('loc'))) {
    if (!o.aluguel) pen(10, 'Aluguel a confirmar');
    else if (a) { const v = o.aluguel / a; if (v > b.precoMaxM2 * 1.15) out = out || `R$ ${PC.nf(v, 2)}/m² acima do orçamento`; else if (v > b.precoMaxM2) pen(15, `R$ ${PC.nf(v, 2)}/m², pouco acima do orçamento`); }
  }
  if (b.valorMax && (bo.startsWith('venda') || bo.startsWith('compra'))) {
    if (!o.venda) pen(10, 'Valor de venda a confirmar');
    else if (o.venda > b.valorMax * 1.15) out = out || 'Valor acima do orçamento';
    else if (o.venda > b.valorMax) pen(15, 'Valor pouco acima do orçamento');
  }
  if (chk) { if (chk.sem === 'vermelho') pen(15, 'Semáforo vermelho'); else if (chk.sem === 'amarelo') pen(5, 'Itens a confirmar'); }
  s = Math.max(0, Math.min(100, Math.round(s)));
  return { score: out ? 0 : s, fora: out, motivos: R };
};
PC.numB = function (b) {
  const o = Object.assign({}, b);
  ['areaMin', 'areaMax', 'peMin', 'kvaMin', 'docasMin', 'precoMaxM2', 'valorMax'].forEach(k => (o[k] = PC.parseBR(b[k])));
  return o;
};

PC.bandArea = function (a) {
  if (!a) return null;
  if (a >= 1000) { const lo = Math.floor(a / 1000); return `entre ${PC.nf(lo)} e ${PC.nf(lo + 1)} mil m²`; }
  const lo = Math.floor(a / 100) * 100; return `entre ${PC.nf(lo)} e ${PC.nf(lo + 100)} m²`;
};
PC.bandM2 = function (v) { const lo = Math.max(1, Math.floor(v) - 1), hi = Math.ceil(v) + 1; return `faixa de R$ ${lo} a ${hi} por m²`; };
PC.bandValor = function (v) {
  if (v >= 1e6) { const lo = Math.floor(v / 5e5) * 0.5, hi = lo + 0.5; return `faixa de R$ ${PC.nf(lo, lo % 1 ? 1 : 0)} a ${PC.nf(hi, hi % 1 ? 1 : 0)} milhões`; }
  const lo = Math.floor(v / 1e5) * 100; return `faixa de R$ ${lo} a ${lo + 100} mil`;
};
PC.teaserLinhas = function (oRaw, chk) {
  const t = PC.teaser(oRaw, chk, '');
  const L = t.split('\n');
  const titulo = `${oRaw.tipo || 'Imóvel'} · ${(oRaw.regiao || '').trim() || 'região a informar'}`;
  const linhas = L.slice(1).filter(x => x.startsWith('▪')).map(x => x.replace(/^▪\s*/, ''));
  return { titulo, linhas };
};
PC.teaser = function (oRaw, chk, rotulo) {
  const o = PC.num(oRaw); const L = [];
  const reg = (oRaw.regiao || '').trim() || 'região a informar';
  L.push(`*${rotulo || 'Opção'} · ${o.tipo || 'Imóvel'} · ${reg}*`);
  const a = PC.areaOf(o);
  if (a) L.push(`▪ ${o.fabril ? 'Área fabril' : o.construida ? 'Área construída' : 'Terreno'} ${PC.bandArea(a)}`);
  const est = [];
  if (o.pe_direito) { const n = Math.max(4, Math.floor((o.pe_direito - 1) / 2) * 2); est.push(`pé-direito acima de ${n} m`); }
  if (o.docas) est.push('docas');
  if (o.energia_kva) est.push(`energia acima de ${Math.floor(o.energia_kva / 100) * 100} kVA`);
  if (est.length) L.push('▪ ' + est.join(' · ').replace(/^./, c => c.toUpperCase()));
  if (o.aluguel && a) L.push(`▪ Locação: ${PC.bandM2(o.aluguel / a)}`);
  else if (o.aluguel) L.push('▪ Locação: valor sob consulta');
  if (o.venda) L.push(`▪ Venda: ${PC.bandValor(o.venda)}`);
  const curto = t => /energia|kva/i.test(t) ? 'energia' : /piso/i.test(t) ? 'piso' : /avcb|incêndio/i.test(t) ? 'AVCB' : /pé-direito/i.test(t) ? 'pé-direito' : /iptu/i.test(t) ? 'IPTU' : /disponib/i.test(t) ? 'disponibilidade' : /duplic/i.test(t) ? 'duplicidade' : /área|terreno|construída/i.test(t) ? 'áreas' : /idade/i.test(t) ? 'idade' : 'documentação';
  const it = (chk ? chk.alerts : []).map(x => curto(x.item + ' ' + x.msg));
  const uniq = [...new Set(it)].slice(0, 3);
  if (uniq.length) L.push(`▪ A confirmar: ${uniq.join('; ')}`);
  L.push('');
  L.push('Interesse? Formalizamos a parceria e envio a ficha completa.');
  L.push('Rodrigo França Viana · CRECI-SP 297692');
  return L.join('\n');
};

export default PC;
