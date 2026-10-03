/* ===== Núcleo: formatação, checagens e PDF (compartilhado entre o app e o teste em Node) ===== */
const PC = {};
PC.SAC = 'sac@primecorpconsultoria.com.br'; // dúvidas, sugestões e reclamações

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
PC.ha = n => (n ? Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' ha' : null);
PC.titCor = c => (c && c.titulo) || 'Corretor de Imóveis';
PC.m2 = n => (n ? PC.nf(Math.round(n), 0) + ' m²' : null);
PC.brl = n => (n ? 'R$ ' + PC.nf(Math.round(n), 0) : null);
PC.brl2 = n => (n ? 'R$ ' + PC.nf(n, 2) : null);
PC.num = d => {
  const k = ['terreno', 'construida', 'fabril', 'administrativo', 'apoio', 'pe_direito', 'piso_carga', 'docas', 'energia_kva', 'aluguel', 'venda', 'condominio', 'iptu', 'frente', 'dormitorios', 'suites', 'banheiros', 'vagas', 'area_ha', 'distancia_asfalto'];
  const o = Object.assign({}, d);
  k.forEach(f => (o[f] = PC.parseBR(d[f])));
  o.diferenciais = PC.lines(d.diferenciais);
  o.itens = PC.lines(d.itens);
  return o;
};
PC.lines = v => (Array.isArray(v) ? v : String(v || '').split('\n')).map(s => String(s).replace(/^[\s•\-–*·]+/, '').trim()).filter(Boolean);
PC.areaRef = d => d.fabril || d.construida || d.terreno || null;

PC.RESID_RE = /casa|apartamento|sobrado|cobertura|kitnet|studio|flat/i;
PC.RURAL_RE = /fazenda|s[ií]tio|ch[áa]cara|rancho|haras|rural/i;
PC.ALQ_SP = 2.42;
PC.autoTitle = function (d) {
  const tipo = d.tipo || 'Galpão';
  const cid = d.cidade ? ' em ' + d.cidade : '';
  if (PC.RURAL_RE.test(tipo)) return d.area_ha ? `${tipo} de ${PC.ha(d.area_ha)}${cid}` : tipo + cid;
  if (/terreno|área|area/i.test(tipo) && d.terreno) return `${tipo} de ${PC.m2(d.terreno)}${cid}`;
  if (PC.RESID_RE.test(tipo)) {
    const q = d.dormitorios ? ` com ${PC.nf(d.dormitorios)} dormitório${d.dormitorios > 1 ? 's' : ''}` : d.construida ? ` de ${PC.m2(d.construida)}` : '';
    return `${tipo}${q}${cid}`;
  }
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
  const grp = PC.grupo(d.tipo); const galp = grp === 'galpao';
  if (grp === 'rural') {
    if (!d.area_ha) add('a', 'Área total (ha) não informada.', 'Área total em hectares a confirmar (matrícula / georreferenciamento)');
    if (!d.car) add('a', 'CAR não informado.', 'CAR (Cadastro Ambiental Rural) a confirmar');
    if (!d.ccir) add('a', 'CCIR/ITR não informados.', 'CCIR e ITR em dia a confirmar');
    if (!d.georref && d.area_ha && d.area_ha >= 25) add('a', 'Imóvel com 25 ha ou mais sem georreferenciamento informado (exigido para transferir a matrícula, Dec. 4.449/02).', 'Georreferenciamento certificado no SIGEF/INCRA a confirmar');
    if (!d.agua) add('a', 'Fontes de água não informadas.', 'Fontes de água (nascentes, rio, represa, poço) a confirmar');
  }
  if (grp === 'residencial' && d.aluguel && d.condominio && d.condominio > d.aluguel) add('a', 'Condomínio maior que o aluguel.', 'Valor do condomínio a confirmar');
  if (galp && d.aluguel && (d.construida || d.fabril)) {
    const base = d.construida || d.fabril;
    const v = d.aluguel / base;
    if (v < 12) add('v', `Aluguel de ${PC.brl2(v)}/m² abaixo da faixa (R$ 13 a 30): área pode estar inflada (terreno?).`, 'Área locável efetiva (preço por m² fora da faixa de mercado)');
    else if (v > 35) add('a', `Aluguel de ${PC.brl2(v)}/m² acima da faixa (R$ 13 a 30).`, 'Valor de locação acima da média regional: negociar / confirmar');
  }
  if (d.iptu && d.aluguel && d.iptu > 0.3 * d.aluguel && d.iptu_periodo !== 'anual')
    add('a', 'IPTU maior que 30% do aluguel: provável valor anual.', 'IPTU: periodicidade a confirmar (valor sugere anual)');
  if (galp && ref && ref > 3000 && (!d.energia_kva || d.energia_kva < 300))
    add('a', d.energia_kva ? `Energia de ${PC.nf(d.energia_kva)} kVA baixa para ${PC.m2(ref)}.` : 'Energia (kVA) não informada.',
      d.energia_kva ? `Energia: ${PC.nf(d.energia_kva)} kVA – verificar capacidade para uso industrial` : 'Energia: potência (kVA) e cabine primária a confirmar');
  if (!galp) {} else if (!d.pe_direito) add('a', 'Pé-direito não informado.', 'Pé-direito livre a confirmar');
  else if (d.pe_direito < 8) add('a', `Pé-direito de ${PC.nf(d.pe_direito)} m limita armazenagem verticalizada.`, `Pé-direito de ${PC.nf(d.pe_direito)} m: verificar aderência à operação`);
  if (galp && !d.piso_carga) add('a', 'Capacidade do piso não informada.', 'Capacidade do piso (t/m²) a confirmar');
  if (galp && !d.avcb) add('a', 'AVCB / incêndio não informado.', 'AVCB e sistema de combate a incêndio a confirmar');
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
  const forb2 = /\b(rua|r\.|avenida|av\.|alameda|travessa|n[ºo°]\s?\d|imobili[áa]ria|c[óo]d(igo|\.)|zap|viva ?real|imovelweb|olx|quintoandar)\b/i;
  const hit = txt.match(d.origem === 'Captação própria' ? forb2 : forb);
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
  L.push(`${d.corretor?.nome || 'Rodrigo França Viana'} · ${PC.titCor(d.corretor)} · ${d.corretor?.creci || 'CRECI-SP 297692'}`);
  return L.join('\n');
};

/* Assunto de um item a confirmar: evita repetir a mesma dúvida com palavras diferentes. */
PC.TOPICOS = [
  ['area', /constru[íi]da ou (de )?terreno|área (informada|constru|fabril|locável)|quadro de áreas|terreno x|x terreno|soma das áreas/i],
  ['pe', /p[ée]-direito/i], ['piso', /\bpiso\b/i], ['energia', /energia|kva|cabine/i], ['docas', /\bdocas?\b/i],
  ['avcb', /avcb|inc[êe]ndio/i], ['iptu', /iptu/i], ['aluguel', /aluguel|loca[çc][ãa]o mensal/i], ['venda', /valor de venda|pre[çc]o de venda/i],
  ['regiao', /localiza[çc][ãa]o|regi[ãa]o|endere[çc]o/i], ['disp', /disponib/i], ['dup', /duplic/i], ['doc', /matr[íi]cula|documenta/i],
];
PC.topico = s => { for (const [k, re] of PC.TOPICOS) if (re.test(s)) return k; return null; };
PC.itensPDF = function (d, chk) {
  const out = [];
  const seen = new Set();
  // checagens primeiro (mais específicas), depois as dúvidas digitadas/da IA
  chk.alerts.map(a => a.item).concat(d.itens).forEach(s => {
    if (!s) return;
    const genericos = /^confirmar especifica[çc][õo]es t[ée]cnicas/i.test(s) ? ['pe', 'piso', 'docas', 'energia'] : null;
    if (genericos && genericos.every(t => seen.has(t))) return;
    const k = PC.topico(s) || s.toLowerCase().replace(/[^a-zà-ú0-9]/g, '').slice(0, 24);
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
  // cartões: primeiro o que é conhecido, depois o que falta
  const resid = PC.RESID_RE.test(d.tipo || '') && !PC.RURAL_RE.test(d.tipo || '');
  const rural = PC.RURAL_RE.test(d.tipo || ''); const lote = !rural && PC.grupo(d.tipo) === 'area';
  const curto = (t, n = 16) => { t = String(t || ''); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
  const cand = rural ? [
    [d.area_ha && PC.ha(d.area_ha), 'Área total'],
    [d.area_ha && PC.nf(Math.round(d.area_ha / PC.ALQ_SP * 10) / 10) + ' alq.', 'Alqueires paulistas'],
    [d.aptidao && curto(d.aptidao), 'Aptidão / uso'],
    [d.distancia_asfalto != null && d.distancia_asfalto !== '' && PC.nf(d.distancia_asfalto) + ' km', 'Até o asfalto'],
  ] : lote ? [
    [d.terreno && PC.m2(d.terreno), 'Área do terreno'],
    [d.frente && PC.nf(d.frente) + ' m', 'Frente'],
    [d.zoneamento && curto(d.zoneamento), 'Zoneamento'],
    [d.topografia && curto(d.topografia), 'Topografia'],
  ] : resid ? [
    [d.construida && PC.m2(d.construida), 'Área útil / construída'],
    [d.dormitorios && PC.nf(d.dormitorios), d.suites ? `Dormitórios (${PC.nf(d.suites)} suíte${d.suites > 1 ? 's' : ''})` : 'Dormitórios'],
    [d.vagas && PC.nf(d.vagas), 'Vagas'],
    [d.terreno && PC.m2(d.terreno), 'Terreno'],
    [d.banheiros && PC.nf(d.banheiros), 'Banheiros'],
  ] : [
    [d.fabril && PC.m2(d.fabril), 'Área fabril / galpão'],
    [d.construida && PC.m2(d.construida), 'Área construída'],
    [d.terreno && PC.m2(d.terreno), 'Terreno'],
    [d.pe_direito && PC.nf(d.pe_direito) + ' m', 'Pé-direito'],
    [d.docas && PC.nf(d.docas), 'Docas'],
    [d.energia_kva && PC.nf(d.energia_kva) + ' kVA', 'Energia'],
  ];
  const k = cand.filter(c => c[0]).slice(0, 4);
  cand.filter(c => !c[0]).forEach(c => { if (k.length < 4) k.push([AC, c[1]]); });
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
  const areas = rural ? [
    ['Área total', d.area_ha ? PC.ha(d.area_ha) : AC],
    ['Alqueires paulistas', d.area_ha ? PC.nf(Math.round(d.area_ha / PC.ALQ_SP * 10) / 10) : AC],
    ['Aptidão / uso', d.aptidao || AC],
    ['Topografia', d.topografia || AC],
    ['Água', d.agua || AC],
    ['Benfeitorias', d.benfeitorias || AC],
  ] : lote ? [
    ['Área do terreno', d.terreno ? PC.m2(d.terreno) : AC],
    ['Frente', d.frente ? PC.nf(d.frente) + ' m' : AC],
    ['Topografia', d.topografia || AC],
    ['Zoneamento', d.zoneamento || AC],
  ] : resid ? [
    ['Área útil / construída', d.construida ? PC.m2(d.construida) : AC],
    ['Terreno', d.terreno ? PC.m2(d.terreno) : /apart|cobertura|flat|studio|kitnet/i.test(d.tipo || '') ? 'Não se aplica' : AC],
    ['Tipologia', d.tipologia || AC],
  ] : [
    ['Terreno', d.terreno ? PC.m2(d.terreno) : AC],
    ['Área construída', d.construida ? PC.m2(d.construida) : AC],
    ['Galpão / área fabril', d.fabril ? PC.m2(d.fabril) : AC],
    ['Administrativo', d.administrativo ? PC.m2(d.administrativo) : AC],
    ['Apoio / outros', d.apoio ? PC.m2(d.apoio) : (d.apoio_txt || AC)],
    ['Tipologia', d.tipologia || AC],
  ];
  const estr = rural ? [
    ['Matrícula', d.documentacao || AC],
    ['CAR', d.car || AC],
    ['CCIR e ITR', d.ccir || AC],
    ['Georreferenciamento', d.georref || AC],
    ['Até o asfalto', d.distancia_asfalto ? PC.nf(d.distancia_asfalto) + ' km' : AC],
    ['Disponibilidade', d.disponibilidade || AC],
  ] : lote ? [
    ['Matrícula', d.documentacao || AC],
    ['Disponibilidade', d.disponibilidade || AC],
    ['Construção existente', d.construida ? PC.m2(d.construida) : 'Não informada'],
    ['IPTU', d.iptu ? PC.brl(d.iptu) : AC],
  ] : resid ? [
    ['Dormitórios', d.dormitorios ? PC.nf(d.dormitorios) : AC],
    ['Suítes', d.suites != null ? PC.nf(d.suites) || '0' : AC],
    ['Banheiros', d.banheiros ? PC.nf(d.banheiros) : AC],
  ] : [
    ['Pé-direito', d.pe_direito ? PC.nf(d.pe_direito) + ' m' : AC],
    ['Piso (carga)', d.piso_carga ? PC.nf(d.piso_carga) + ' t/m²' : AC],
    ['Docas', d.docas ? PC.nf(d.docas) : AC],
    ['Energia', d.energia_kva ? PC.nf(d.energia_kva) + ' kVA' : AC],
    ['Pontes rolantes', d.pontes || 'Não informado'],
    ['AVCB / incêndio', d.avcb || AC],
  ];
  const y1 = table(M, y, tw, rural ? 'ÁREA E USO' : 'ÁREAS', areas, [90]);
  const y2 = table(M + tw + 12, y, tw, rural ? 'DOCUMENTAÇÃO E ACESSO' : lote ? 'DOCUMENTAÇÃO' : resid ? 'AMBIENTES' : 'ESTRUTURA', resid ? [...estr, ['Vagas', d.vagas ? PC.nf(d.vagas) : AC]] : estr, [90]);
  y = Math.max(y1, y2) + 14;

  // condições
  const cond = [];
  const base = rural || lote ? null : d.construida || d.fabril;
  if (rural && d.venda && d.area_ha) cond.push(['Venda', PC.brl(d.venda), PC.brl(d.venda / d.area_ha) + '/ha']);
  else if (lote && d.venda && d.terreno) cond.push(['Venda', PC.brl(d.venda), PC.brl2(d.venda / d.terreno) + '/m² de terreno']);
  if ((rural || lote) && d.venda) d = { ...d, _vendaFeita: true };
  if (d.aluguel) cond.push(['Aluguel mensal', PC.brl(d.aluguel), base ? PC.brl2(d.aluguel / base) + '/m² ' + (d.construida ? 'construída' : 'fabril') : '']);
  if (d.venda && !d._vendaFeita) cond.push(['Venda', PC.brl(d.venda), base ? PC.brl2(d.venda / base) + '/m² ' + (d.construida ? 'construída' : 'fabril') : '']);
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
  if (d.documentacao) cond.push(['Documentação', d.documentacao, '']);
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
  const cor = d.corretor || {};
  T(`${cor.nome || 'Rodrigo França Viana'} · ${PC.titCor(cor)} · ${cor.creci || 'CRECI-SP 297692'} · ${cor.email || 'contato@primecorpconsultoria.com.br'}`, M, H - 27);
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
PC.areaOf = d => (d.area_ha ? d.area_ha * 10000 : d.fabril || d.construida || d.terreno || null);
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
  if (b.dormMin) { if (!o.dormitorios) pen(8, 'Dormitórios a confirmar'); else if (o.dormitorios < b.dormMin) out = out || `${PC.nf(o.dormitorios)} dormitório(s), abaixo do pedido`; }
  if (b.suitesMin) { if (o.suites == null) pen(4, 'Suítes a confirmar'); else if (o.suites < b.suitesMin) pen(12, 'Menos suítes que o pedido'); }
  if (b.vagasMin) { if (!o.vagas) pen(5, 'Vagas a confirmar'); else if (o.vagas < b.vagasMin) pen(12, 'Menos vagas que o pedido'); }
  if (b.aluguelMax && (!bo || bo.startsWith('loc'))) { if (!o.aluguel) pen(10, 'Aluguel a confirmar'); else if (o.aluguel > b.aluguelMax * 1.15) out = out || 'Aluguel acima do orçamento'; else if (o.aluguel > b.aluguelMax) pen(15, 'Aluguel pouco acima do orçamento'); }
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
  ['areaMin', 'areaMax', 'peMin', 'kvaMin', 'docasMin', 'precoMaxM2', 'valorMax', 'haMin', 'haMax', 'dormMin', 'vagasMin', 'suitesMin', 'aluguelMax'].forEach(k => (o[k] = PC.parseBR(b[k])));
  if (o.haMin && !o.areaMin) o.areaMin = o.haMin * 10000;
  if (o.haMax && !o.areaMax) o.areaMax = o.haMax * 10000;
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
PC.bandHa = function (h) { if (!h) return null; if (h < 10) return `entre ${PC.nf(Math.floor(h))} e ${PC.nf(Math.floor(h) + 1)} ha`; const st = h < 100 ? 10 : h < 1000 ? 50 : 500; const lo = Math.floor(h / st) * st; return `entre ${PC.nf(lo)} e ${PC.nf(lo + st)} ha`; };
PC.bandAluguel = function (v) { if (v >= 10000) { const lo = Math.floor(v / 5000) * 5; return `faixa de R$ ${lo} a ${lo + 5} mil/mês`; } const lo = Math.floor(v / 500) * 500; return `faixa de R$ ${PC.nf(lo)} a ${PC.nf(lo + 500)}/mês`; };
PC.teaser = function (oRaw, chk, rotulo, corretor) {
  const o = PC.num(oRaw); const L = []; const g = PC.grupo(o.tipo);
  const assin = `${(corretor && corretor.nome) || 'Rodrigo França Viana'} · ${(corretor && corretor.creci) || 'CRECI-SP 297692'}`;
  if (g === 'residencial' || g === 'rural') {
    const reg0 = (oRaw.regiao || '').trim() || 'região a informar';
    L.push(`*${rotulo || 'Opção'} · ${o.tipo || 'Imóvel'} · ${reg0}*`);
    if (g === 'residencial') {
      const amb = [o.dormitorios && `${PC.nf(o.dormitorios)} dormitório${o.dormitorios > 1 ? 's' : ''}${o.suites ? ` (${PC.nf(o.suites)} suíte${o.suites > 1 ? 's' : ''})` : ''}`, o.vagas && `${PC.nf(o.vagas)} vaga${o.vagas > 1 ? 's' : ''}`].filter(Boolean);
      if (amb.length) L.push('▪ ' + amb.join(' · '));
      if (o.construida) L.push(`▪ Área útil ${PC.bandArea(o.construida)}`);
      if (o.aluguel) L.push(`▪ Locação: ${PC.bandAluguel(o.aluguel)}`);
    } else {
      if (o.area_ha) L.push(`▪ Área ${PC.bandHa(o.area_ha)} (cerca de ${PC.nf(Math.round(o.area_ha / PC.ALQ_SP))} alqueires paulistas)`);
      const usos = [o.aptidao && 'aptidão: ' + String(o.aptidao).toLowerCase(), o.agua && 'água: ' + String(o.agua).toLowerCase()].filter(Boolean);
      if (usos.length) L.push('▪ ' + usos.join(' · ').replace(/^./, c => c.toUpperCase()));
      if (o.aluguel) L.push(`▪ Arrendamento: valor sob consulta`);
    }
    if (o.venda) L.push(`▪ Venda: ${PC.bandValor(o.venda)}`);
    const it = (chk ? chk.alerts : []).map(x => x.item).filter(Boolean).slice(0, 2);
    if (it.length) L.push(`▪ A confirmar: ${it.map(t => t.replace(/ a confirmar.*$/i, '')).join('; ')}`);
    L.push(''); L.push('Interesse? Envio a ficha completa e agendo a visita.'); L.push(assin);
    return L.join('\n');
  }
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
  L.push(assin);
  return L.join('\n');
};

/* ===== v3: ficha mínima, completude, comissão e documento ao anunciante ===== */
PC.grupo = tipo => (PC.RURAL_RE.test(tipo || '') ? 'rural' : PC.RESID_RE.test(tipo || '') ? 'residencial' : /área|area|terreno|lote|fazenda/i.test(tipo || '') ? 'area' : /comercial|pr[ée]dio|sala|loja|ponto/i.test(tipo || '') ? 'comercial' : 'galpao');
// campo: [rótulo, pergunta objetiva, tipo de resposta]
PC.CAMPOS = {
  cidade: ['Cidade', 'Em qual cidade fica o imóvel?', 'text'],
  regiao: ['Região / eixo', 'Qual a região ou o eixo de acesso (ex.: Rod. Anhanguera, km aproximado)?', 'text'],
  construida: ['Área construída', 'Qual é a área construída total?', 'm²'],
  terreno: ['Área do terreno', 'Qual é a área do terreno?', 'm²'],
  fabril: ['Área do galpão', 'Qual é a área do galpão (armazenagem/produção)?', 'm²'],
  pe_direito: ['Pé-direito livre', 'Qual é o pé-direito livre (do piso à parte mais baixa da estrutura)?', 'm'],
  docas: ['Docas', 'Quantas docas para caminhão o imóvel tem?', 'nº'],
  energia_kva: ['Energia', 'Qual a potência de energia disponível (kVA)? Há cabine primária?', 'kVA'],
  piso_carga: ['Piso', 'Qual a capacidade de carga do piso?', 't/m²'],
  avcb: ['AVCB', 'O AVCB está vigente? Até quando?', 'text'],
  aluguel: ['Aluguel mensal', 'Qual o valor do aluguel mensal?', 'R$'],
  venda: ['Valor de venda', 'Qual o valor de venda?', 'R$'],
  iptu: ['IPTU', 'Qual o valor do IPTU?', 'R$'],
  iptu_periodo: ['IPTU: periodicidade', 'O valor do IPTU é mensal ou anual?', 'sel:mensal|anual'],
  condominio: ['Condomínio', 'Qual o condomínio mensal? (0 se não houver)', 'R$'],
  zoneamento: ['Zoneamento', 'Qual o zoneamento do terreno (uso permitido)?', 'text'],
  frente: ['Frente', 'Qual a medida de frente do terreno?', 'm'],
  disponibilidade: ['Disponibilidade', 'O imóvel está disponível? A partir de quando?', 'text'],
  documentacao: ['Documentação', 'A matrícula está regular e com a construção averbada?', 'text'],
  dormitorios: ['Dormitórios', 'Quantos dormitórios o imóvel tem?', 'nº'],
  suites: ['Suítes', 'Quantos dos dormitórios são suítes?', 'nº'],
  banheiros: ['Banheiros', 'Quantos banheiros no total?', 'nº'],
  vagas: ['Vagas', 'Quantas vagas de garagem?', 'nº'],
  area_ha: ['Área total', 'Qual a área total, em hectares ou alqueires (paulista ou mineiro)?', 'ha'],
  aptidao: ['Aptidão / uso', 'Qual o uso atual e a aptidão (pasto, lavoura, eucalipto, café, lazer)?', 'text'],
  agua: ['Água', 'Quais as fontes de água (rio, nascente, represa, poço artesiano)?', 'text'],
  benfeitorias: ['Benfeitorias', 'Quais as benfeitorias (sede, casas, curral, barracões, cercas, energia)?', 'text'],
  topografia: ['Topografia', 'Como é a topografia (plana, levemente ondulada, acidentada)?', 'text'],
  car: ['CAR', 'O imóvel tem CAR (Cadastro Ambiental Rural)? Qual a situação?', 'text'],
  ccir: ['CCIR e ITR', 'O CCIR e o ITR estão em dia?', 'text'],
  georref: ['Georreferenciamento', 'O imóvel é georreferenciado e certificado no SIGEF/INCRA?', 'text'],
  distancia_asfalto: ['Distância do asfalto', 'Quantos km de estrada de terra até o asfalto?', 'km'],
};
PC.CAMPOS_NUM = ['area_ha', 'distancia_asfalto', 'dormitorios', 'suites', 'banheiros', 'vagas', 'construida', 'terreno', 'fabril', 'pe_direito', 'docas', 'energia_kva', 'piso_carga', 'aluguel', 'venda', 'iptu', 'condominio', 'frente'];
PC.OBRIG = {
  galpao: ['cidade', 'regiao', 'construida', 'terreno', 'pe_direito', 'docas', 'energia_kva', 'piso_carga', 'avcb', 'VALOR', 'iptu', 'disponibilidade', 'documentacao'],
  area: ['cidade', 'regiao', 'terreno', 'zoneamento', 'VALOR', 'iptu', 'disponibilidade', 'documentacao'],
  comercial: ['cidade', 'regiao', 'construida', 'VALOR', 'iptu', 'condominio', 'disponibilidade', 'documentacao'],
  rural: ['cidade', 'regiao', 'area_ha', 'aptidao', 'agua', 'benfeitorias', 'VALOR', 'car', 'ccir', 'documentacao', 'disponibilidade'],
  residencial: ['cidade', 'regiao', 'construida', 'dormitorios', 'banheiros', 'vagas', 'VALOR', 'iptu', 'condominio', 'disponibilidade', 'documentacao'],
};
PC.completude = function (oRaw) {
  const d = PC.num(oRaw); const g = PC.grupo(d.tipo); const op = PC.norm(d.operacao || 'Locação');
  const campos = [];
  PC.OBRIG[g].forEach(c => {
    if (c !== 'VALOR') return campos.push(c);
    if (!op.startsWith('venda')) campos.push('aluguel');
    if (op.includes('venda')) campos.push('venda');
  });
  const vazio = c => {
    if (c === 'condominio' && String(oRaw.condominio ?? '').trim() === '0') return false;
    if (PC.CAMPOS_NUM.includes(c)) return !d[c];
    return String(oRaw[c] ?? '').trim() === '';
  };
  const faltam = [];
  const item = (campo, pergunta, extra) => faltam.push({ campo, rotulo: PC.CAMPOS[campo][0], pergunta: pergunta || PC.CAMPOS[campo][1], tipo: PC.CAMPOS[campo][2], extra: !!extra });
  let pend = 0;
  campos.forEach(c => {
    if (!vazio(c)) {
      if (c === 'iptu' && !['mensal', 'anual'].includes(oRaw.iptu_periodo)) { pend += 0.5; item('iptu_periodo', `O IPTU de ${PC.brl(d.iptu)} é mensal ou anual?`); }
      return;
    }
    pend++;
    let q = null;
    if (c === 'terreno' && d.construida && !d.fabril) q = `Os ${PC.m2(d.construida)} informados são de área construída ou de terreno? Qual é a área do terreno?`;
    if (c === 'construida' && d.fabril) q = `Além dos ${PC.m2(d.fabril)} de galpão, qual é a área construída total (com escritórios e apoio)?`;
    if (c === 'construida' && !d.fabril && d.terreno) q = `Os ${PC.m2(d.terreno)} informados são do terreno? Qual é a área construída?`;
    item(c, q);
    if (c === 'iptu') item('iptu_periodo', null, true);
  });
  const total = campos.length;
  const pct = Math.max(0, Math.round(((total - pend) / total) * 100));
  return { grupo: g, total, pct, ok: pend === 0, faltam };
};

/* --- Comissão dividida por indicação (2, 3 ou mais partes) --- */
PC.PAPEIS = ['Imobiliária anunciante', 'Corretor do anunciante', 'Corretor parceiro', 'PrimeCorp (indicação)', 'Outro'];
PC.MODELOS_PADRAO = [
  { id: 'imob_pc', nome: 'Imobiliária + PrimeCorp', partes: [{ papel: 'Imobiliária anunciante', pct: 50 }, { papel: 'PrimeCorp (indicação)', pct: 50 }] },
  { id: 'imob_cor_pc', nome: 'Imobiliária + Corretor parceiro + PrimeCorp', partes: [{ papel: 'Imobiliária anunciante', pct: 50 }, { papel: 'Corretor parceiro', pct: 25 }, { papel: 'PrimeCorp (indicação)', pct: 25 }] },
  { id: 'prop_pc', nome: 'Proprietário direto + PrimeCorp', partes: [{ papel: 'PrimeCorp (indicação)', pct: 100 }] },
  { id: 'prop_cor_pc', nome: 'Proprietário direto + Corretor parceiro + PrimeCorp', partes: [{ papel: 'Corretor parceiro', pct: 50 }, { papel: 'PrimeCorp (indicação)', pct: 50 }] },
];
PC.ehPC = p => /primecorp/i.test(p.papel || '');
PC.calcComissao = function (c) {
  const base = c.base === 'venda' ? 'venda' : 'locacao';
  const valor = PC.parseBR(c.valor_base) || 0;
  const pct = PC.parseBR(c.pct) || 0, alug = PC.parseBR(c.alugueis) || 0;
  const total = Math.round((base === 'venda' ? (valor * pct) / 100 : valor * alug) * 100) / 100;
  const partes = (c.partes || []).map(p => { const pp = PC.parseBR(p.pct) || 0; return { ...p, pct: pp, valor: Math.round(total * pp) / 100 }; });
  const soma = Math.round(partes.reduce((a, p) => a + p.pct, 0) * 100) / 100;
  const erros = [], avisos = [];
  if (!valor) erros.push(base === 'venda' ? 'Informe o valor de venda.' : 'Informe o aluguel mensal.');
  if (base === 'venda' && !pct) erros.push('Informe o percentual de comissão sobre a venda.');
  if (base === 'locacao' && !alug) erros.push('Informe quantos aluguéis compõem a comissão.');
  if (!partes.length) erros.push('Inclua as partes da divisão.');
  else if (Math.abs(soma - 100) > 0.01) erros.push(`A soma das partes é ${PC.nf(soma)}%: precisa fechar em 100%.`);
  if (partes.length && !partes.some(PC.ehPC)) avisos.push('A participação da PrimeCorp não está na divisão.');
  partes.forEach((p, i) => {
    if (PC.ehPC(p)) return;
    if (!p.nome) avisos.push(`Parte ${i + 1} (${p.papel}) sem nome.`);
    if (!/\d{3,}/.test(String(p.creci || ''))) avisos.push(`${p.nome || p.papel}: CRECI não informado. Honorários só se dividem com inscritos no CRECI.`);
  });
  return { base, valor, pct, alugueis: alug, total, partes, soma, erros, avisos, ok: !erros.length };
};
PC.textoComissao = c => (c.base === 'venda' ? `${PC.nf(PC.parseBR(c.pct) || 0)}% sobre o valor da venda` : `${PC.nf(PC.parseBR(c.alugueis) || 0)} aluguel(éis) mensal(is)`);
PC.quadroComissao = c => (c.partes || []).map(p => `${p.papel}${p.nome && !PC.ehPC(p) ? ' (' + p.nome + ')' : ''}: ${PC.nf(PC.parseBR(p.pct) || 0)}%`).join(' · ');
PC.preencher = (txt, v) => String(txt || '').replace(/\{\{(\w+)\}\}/g, (m, k) => (v[k] != null && v[k] !== '' ? String(v[k]) : m));

/* --- PDF ao anunciante: solicitação de informações e/ou ficha + autorização (campos editáveis) --- */
PC.valorCampo = function (d, c) {
  const v = d[c];
  if (v === null || v === undefined || v === '') return null;
  const u = PC.CAMPOS[c] ? PC.CAMPOS[c][2] : 'text';
  if (u === 'm²') return PC.m2(v);
  if (u === 'R$') return c === 'iptu' && d.iptu_periodo ? PC.brl(v) + (d.iptu_periodo === 'anual' ? '/ano' : '/mês') : PC.brl(v) + (c === 'aluguel' || c === 'condominio' ? '/mês' : '');
  if (u === 'm') return PC.nf(v) + ' m';
  if (u === 't/m²') return PC.nf(v) + ' t/m²';
  if (u === 'kVA') return PC.nf(v) + ' kVA';
  if (u === 'ha') return PC.ha(v);
  if (u === 'km') return PC.nf(v) + ' km';
  return String(v);
};
PC.conhecidos = function (oRaw) {
  const d = PC.num(oRaw);
  return ['cidade', 'regiao', 'construida', 'fabril', 'terreno', 'pe_direito', 'docas', 'energia_kva', 'piso_carga', 'avcb', 'aluguel', 'venda', 'condominio', 'iptu', 'zoneamento', 'frente', 'disponibilidade', 'documentacao']
    .concat(['dormitorios', 'suites', 'banheiros', 'vagas', 'area_ha', 'aptidao', 'agua', 'benfeitorias', 'topografia', 'car', 'ccir', 'georref', 'distancia_asfalto'])
    .map(c => [PC.CAMPOS[c][0], PC.valorCampo(d, c)]).filter(r => r[1]);
};
PC.pdfAnunciante = function (jsPDF, oRaw, o) {
  const d = PC.num(oRaw);
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  const W = 595.28, H = 841.89, M = 38, IW = W - 2 * M, BOT = H - 58;
  const C = { g: [30, 34, 39], r: [200, 16, 46], p: [244, 245, 247], z: [250, 250, 251], t: [30, 34, 39], t2: [90, 96, 104], ln: [217, 220, 225], w: [255, 255, 255], wl: [190, 195, 202] };
  const fill = c => doc.setFillColor(c[0], c[1], c[2]), ink = c => doc.setTextColor(c[0], c[1], c[2]), pen = c => doc.setDrawColor(c[0], c[1], c[2]);
  const F = (s, b) => { doc.setFont('helvetica', b ? 'bold' : 'normal'); doc.setFontSize(s); };
  const clean = s => String(s == null ? '' : s).replace(/[≈]/g, '~').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[^\x00-\xFF–—•²³ºª·€]/g, '');
  const T = (s, x, y, op) => doc.text(clean(s), x, y, op);
  const wrap = (s, w) => doc.splitTextToSize(clean(s), w);
  const aut = o.modo === 'autorizacao';
  let y = 0, nf = 0;
  const field = (name, x, yy, w, h, multi) => { const f = new doc.AcroFormTextField(); f.fieldName = 'f' + (++nf) + '_' + name; f.Rect = [x, yy, w, h]; f.fontSize = 9; f.multiline = !!multi; f.value = ''; f.maxFontSize = 9; doc.addField(f); pen(C.ln); doc.setLineWidth(0.6); fill(C.w); doc.rect(x, yy, w, h, 'FD'); };
  const cab = () => {
    fill(C.r); doc.rect(0, 0, W, 8, 'F');
    F(8.2, true); ink(C.r); T((aut ? 'FICHA DO IMÓVEL E AUTORIZAÇÃO DE INDICAÇÃO' : 'SOLICITAÇÃO DE INFORMAÇÕES E AUTORIZAÇÃO DE INDICAÇÃO'), M, 34);
    F(7.6, false); ink(C.t2); T(`${(d.tipo || 'Imóvel').toUpperCase()} · ${(d.operacao || '').toUpperCase()} · REF. ${o.codigo || ''}`, M, 46);
    if (o.logos && o.logos.dark) { const lh = 24, lw = lh * o.logos.ratio; doc.addImage(o.logos.dark, 'PNG', W - M - lw, 18, lw, lh); }
    y = 70;
  };
  const novaPag = () => { doc.addPage(); cab(); };
  const precisa = h => { if (y + h > BOT) novaPag(); };
  const secao = t => { precisa(40); F(8.6, true); ink(C.r); T(t, M, y); pen(C.ln); doc.setLineWidth(0.6); doc.line(M, y + 5, W - M, y + 5); y += 18; };
  const para = (txt, s = 9.4, cor = C.t, w = IW, x = M) => { F(s, false); ink(cor); wrap(txt, w).forEach(l => { precisa(s + 4); T(l, x, y); y += s + 4; }); };

  cab();
  F(18, true); ink(C.t);
  wrap(oRaw.titulo || PC.autoTitle(d), IW).slice(0, 2).forEach(l => { T(l, M, y); y += 22; });
  y += 2;
  F(9.4, false); ink(C.t2); T(`A/C: ${o.anunciante || 'Responsável pelo anúncio'}`, M, y); y += 18;
  para(`Atuo na representação de empresas e investidores que procuram imóveis (Tenant & Buyer Representation). Identifiquei o imóvel acima no seu anúncio e gostaria de apresentá-lo aos meus clientes${aut ? '. Os dados abaixo foram levantados e conferidos.' : ', mas faltam informações básicas para que ele entre na seleção.'} Peço, por gentileza, ${aut ? 'a sua autorização para a indicação' : 'que complete os dados e autorize a indicação'}.`);
  y += 4;
  if (o.demanda > 0) {
    precisa(34); fill(C.p); doc.rect(M, y, IW, 28, 'F'); fill(C.r); doc.rect(M, y, 3.5, 28, 'F');
    F(9.6, true); ink(C.t); T(`Tenho ${o.demanda} cliente${o.demanda > 1 ? 's' : ''} com demanda ativa compatível com este imóvel.`, M + 14, y + 18); y += 38;
  }
  if (o.link) {
    precisa(40); fill(C.g); doc.rect(M, y, IW, 34, 'F');
    F(8.6, true); ink(C.w); T('Mais rápido pelo celular: responda e autorize online', M + 12, y + 14);
    F(8, false); ink(C.wl); doc.textWithLink(clean(o.link), M + 12, y + 26, { url: o.link }); y += 46;
  }

  // dados já levantados
  const conhecidos = PC.conhecidos(oRaw);
  secao('DADOS JÁ LEVANTADOS');
  if (!conhecidos.length) para('Nenhum dado técnico consta no anúncio.', 9, C.t2);
  const cw = (IW - 12) / 2;
  for (let i = 0; i < conhecidos.length; i += 2) {
    precisa(17);
    [conhecidos[i], conhecidos[i + 1]].forEach((r, j) => { if (!r) return; const x = M + j * (cw + 12); fill((i / 2) % 2 ? C.z : C.p); doc.rect(x, y, cw, 16, 'F'); F(8.4, false); ink(C.t2); T(r[0], x + 8, y + 11); F(8.4, true); ink(C.t); T(wrap(r[1], cw - 110)[0], x + cw - 8, y + 11, { align: 'right' }); });
    y += 16.5;
  }
  y += 12;

  // informações necessárias (campos editáveis)
  const faltam = o.faltam || [];
  if (faltam.length) {
    secao('INFORMAÇÕES NECESSÁRIAS (PREENCHA NOS CAMPOS)');
    faltam.forEach((f, i) => {
      const ls = wrap(`${i + 1}. ${f.pergunta}`, IW - 190);
      const h = Math.max(20, ls.length * 11 + 6);
      precisa(h + 6);
      F(8.8, false); ink(C.t); ls.forEach((l, k) => T(l, M, y + 12 + k * 11));
      field(f.campo, W - M - 180, y + 1, 180, 18);
      y += h + 4;
    });
    y += 8;
  }

  // autorização e comissão
  secao('AUTORIZAÇÃO DE INDICAÇÃO E DIVISÃO DE HONORÁRIOS');
  if (o.comissao) {
    precisa(30 + (o.comissao.partes || []).length * 16);
    fill(C.g); doc.rect(M, y, IW, 18, 'F'); F(8, true); ink(C.w); T('Honorários totais: ' + PC.textoComissao(o.comissao), M + 8, y + 12.2); y += 18;
    (o.comissao.partes || []).forEach((p, i) => { fill(i % 2 ? C.z : C.p); doc.rect(M, y, IW, 16, 'F'); F(8.4, false); ink(C.t); T(p.papel + (p.nome && !PC.ehPC(p) ? ' · ' + p.nome : ''), M + 8, y + 11); F(8.4, true); T(PC.nf(PC.parseBR(p.pct) || 0) + '%', W - M - 8, y + 11, { align: 'right' }); y += 16; });
    y += 10;
  }
  if (o.termo) { F(7.4, true); ink(C.t2); precisa(14); T(`Termo ${o.termo_versao || ''}`, M, y); y += 11; para(o.termo, 7.6, C.t2); y += 8; }

  // identificação e aceite
  secao('IDENTIFICAÇÃO E ACEITE');
  const ids = [['Nome / razão social', 'razao'], ['CNPJ / CPF', 'documento'], ['CRECI (pessoa física ou jurídica)', 'creci'], ['Responsável', 'responsavel'], ['Cargo', 'cargo'], ['E-mail', 'email'], ['Telefone / WhatsApp', 'telefone'], ['Local e data', 'local_data']];
  for (let i = 0; i < ids.length; i += 2) {
    precisa(36);
    [ids[i], ids[i + 1]].forEach((r, j) => { if (!r) return; const x = M + j * (cw + 12); F(7.6, false); ink(C.t2); T(r[0], x, y + 8); field(r[1], x, y + 12, cw, 18); });
    y += 38;
  }
  precisa(60); y += 22; pen(C.t2); doc.setLineWidth(0.6); doc.line(M, y, M + cw, y); F(7.6, false); ink(C.t2); T('Assinatura do responsável', M, y + 11);
  y += 24;

  // rodapé em todas as páginas
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); pen(C.ln); doc.setLineWidth(0.6); doc.line(M, H - 40, W - M, H - 40);
    F(7.4, false); ink(C.t2);
    T(`${o.corretor?.nome || 'Rodrigo França Viana'} · ${PC.titCor(o.corretor)} · ${o.corretor?.creci || 'CRECI-SP 297692'} · ${o.corretor?.email || 'contato@primecorpconsultoria.com.br'}${o.corretor?.whatsapp ? ' · ' + o.corretor.whatsapp : ''}`, M, H - 27);
    T(`Ref. ${o.codigo || ''} · ${i}/${n}`, W - M, H - 27, { align: 'right' });
  }
  return doc;
};
PC.filenameAnunciante = (d, modo) => PC.filename(d).replace(/^Descritivo_/, modo === 'autorizacao' ? 'Autorizacao_' : 'Solicitacao_');

/* --- Acordo de divisão de honorários (todas as partes assinam) --- */
PC.recebedor = (c) => { const ps = c.partes || []; const i = Number.isInteger(c.recebe) && ps[c.recebe] ? c.recebe : Math.max(0, ps.findIndex(p => !PC.ehPC(p))); return ps[i] || null; };
PC.partes0Recebe = ps => Math.max(0, (ps || []).findIndex(p => !PC.ehPC(p)));
PC.nomeParte = p => (p ? (PC.ehPC(p) ? (p.nome || 'Rodrigo França Viana') + ' · PrimeCorp Brokers' : p.nome || p.papel) : '');
PC.pdfAcordo = function (jsPDF, o) {
  const c = PC.calcComissao(o.comissao);
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  const W = 595.28, H = 841.89, M = 38, IW = W - 2 * M, BOT = H - 58;
  const C = { g: [30, 34, 39], r: [200, 16, 46], p: [244, 245, 247], z: [250, 250, 251], t: [30, 34, 39], t2: [90, 96, 104], ln: [217, 220, 225], w: [255, 255, 255] };
  const fill = k => doc.setFillColor(k[0], k[1], k[2]), ink = k => doc.setTextColor(k[0], k[1], k[2]), pen = k => doc.setDrawColor(k[0], k[1], k[2]);
  const F = (s, b) => { doc.setFont('helvetica', b ? 'bold' : 'normal'); doc.setFontSize(s); };
  const clean = s => String(s == null ? '' : s).replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[^\x00-\xFF–—•²³ºª·€§]/g, '');
  const T = (s, x, yy, op) => doc.text(clean(s), x, yy, op);
  const wrap = (s, w) => doc.splitTextToSize(clean(s), w);
  let y = 0;
  const cab = () => {
    fill(C.r); doc.rect(0, 0, W, 8, 'F');
    F(8.2, true); ink(C.r); T('ACORDO DE DIVISÃO DE HONORÁRIOS', M, 34);
    F(7.6, false); ink(C.t2); T(`${(o.tipo || 'IMÓVEL').toUpperCase()} · ${(c.base === 'venda' ? 'VENDA' : 'LOCAÇÃO')} · REF. ${o.codigo || ''}`, M, 46);
    if (o.logos && o.logos.dark) { const lh = 24, lw = lh * o.logos.ratio; doc.addImage(o.logos.dark, 'PNG', W - M - lw, 18, lw, lh); }
    y = 70;
  };
  const precisa = h => { if (y + h > BOT) { doc.addPage(); cab(); } };
  const secao = t => { precisa(40); F(8.6, true); ink(C.r); T(t, M, y); pen(C.ln); doc.setLineWidth(0.6); doc.line(M, y + 5, W - M, y + 5); y += 18; };
  const para = (txt, s = 8.2, cor = C.t2) => { F(s, false); ink(cor); wrap(txt, IW).forEach(l => { precisa(s + 4); T(l, M, y); y += s + 4; }); };
  cab();
  F(17, true); ink(C.t); wrap(o.titulo || '', IW).slice(0, 2).forEach(l => { T(l, M, y); y += 21; });
  F(9.2, false); ink(C.t2); T(`Cliente: ${o.cliente || 'a identificar'}`, M, y); y += 20;
  // KPIs
  const kp = [[PC.brl2(c.total) || 'R$ 0,00', 'Honorários totais'], [c.base === 'venda' ? PC.nf(c.pct) + '% da venda' : PC.nf(c.alugueis) + (c.alugueis === 1 ? ' aluguel' : ' aluguéis'), 'Base de cálculo'], [PC.brl(c.valor) || '—', c.base === 'venda' ? 'Valor da venda' : 'Aluguel mensal'], [String(c.partes.length), 'Partes na divisão']];
  const kw = (IW - 18) / 4;
  kp.forEach((k, i) => { const x = M + i * (kw + 6); fill(C.r); doc.rect(x, y, kw, 3, 'F'); fill(C.p); doc.rect(x, y + 3, kw, 40, 'F'); F(12, true); ink(C.t); T(wrap(k[0], kw - 14)[0], x + 8, y + 21); F(7.4, false); ink(C.t2); T(k[1], x + 8, y + 35); });
  y += 58;
  // quadro
  secao('QUADRO DE DIVISÃO');
  const cols = [M + 8, M + 138, M + 300, W - M - 112, W - M - 8];
  fill(C.g); doc.rect(M, y, IW, 18, 'F'); F(7.8, true); ink(C.w);
  T('PAPEL', cols[0], y + 12); T('NOME / RAZÃO SOCIAL', cols[1], y + 12); T('CRECI', cols[2], y + 12); T('%', cols[3], y + 12, { align: 'right' }); T('VALOR ESTIMADO', cols[4], y + 12, { align: 'right' }); y += 18;
  const rec = PC.recebedor(o.comissao);
  c.partes.forEach((p, i) => {
    const nm = wrap(PC.ehPC(p) ? (p.nome || 'Rodrigo França Viana') : (p.nome || '—'), 150); const h = Math.max(18, nm.length * 10 + 8);
    precisa(h); fill(i % 2 ? C.z : C.p); doc.rect(M, y, IW, h, 'F');
    F(8.2, false); ink(C.t); T(wrap(p.papel, 135)[0], cols[0], y + 12); nm.forEach((l, k) => T(l, cols[1], y + 12 + k * 10));
    T(wrap(p.creci || (PC.ehPC(p) ? 'CRECI-SP 297692' : '—'), 92)[0], cols[2], y + 12); F(8.2, true); T(PC.nf(p.pct) + '%', cols[3], y + 12, { align: 'right' }); T(PC.brl2(p.valor) || '—', cols[4], y + 12, { align: 'right' });
    y += h;
  });
  fill(C.g); doc.rect(M, y, IW, 18, 'F'); F(8.2, true); ink(C.w); T('Total', cols[0], y + 12); T(PC.nf(c.soma) + '%', cols[3], y + 12, { align: 'right' }); T(PC.brl2(c.total) || '—', cols[4], y + 12, { align: 'right' }); y += 32;
  F(7.6, false); ink(C.t2); T(`Recebe e repassa: ${PC.nomeParte(rec)}. Valores estimados sobre o valor de referência; o cálculo final usa o valor contratado.`, M, y); y += 18;
  // cláusulas
  secao('CONDIÇÕES');
  F(7.4, true); ink(C.t2); precisa(12); T(`Acordo ${o.versao || ''}`, M, y); y += 11;
  String(o.texto || '').split(/\n\s*\n/).forEach(bl => { para(bl.trim()); y += 4; });
  // assinaturas
  precisa(70 + Math.ceil(c.partes.length / 2) * 64);
  secao('ASSINATURAS');
  F(7.6, false); ink(C.t2); T('Local e data: ______________________________________', M, y + 6); y += 26;
  const cw = (IW - 24) / 2;
  for (let i = 0; i < c.partes.length; i += 2) {
    precisa(64);
    [c.partes[i], c.partes[i + 1]].forEach((p, j) => { if (!p) return; const x = M + j * (cw + 24); pen(C.t2); doc.setLineWidth(0.6); doc.line(x, y + 26, x + cw, y + 26);
      F(8, true); ink(C.t); T(wrap(PC.nomeParte(p), cw)[0], x, y + 38); F(7.4, false); ink(C.t2); T(wrap(`${p.papel} · ${p.creci || (PC.ehPC(p) ? 'CRECI-SP 297692' : 'CRECI: ______')} · ${PC.nf(p.pct)}%`, cw)[0], x, y + 49); });
    y += 64;
  }
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) { doc.setPage(i); pen(C.ln); doc.setLineWidth(0.6); doc.line(M, H - 40, W - M, H - 40); F(7.4, false); ink(C.t2);
    T(`${o.corretor?.nome || 'Rodrigo França Viana'} · ${PC.titCor(o.corretor)} · ${o.corretor?.creci || 'CRECI-SP 297692'} · ${o.corretor?.email || 'contato@primecorpconsultoria.com.br'}`, M, H - 27);
    T(`Ref. ${o.codigo || ''} · ${i}/${n}`, W - M, H - 27, { align: 'right' }); }
  return doc;
};
PC.varsAcordo = (o) => { const c = PC.calcComissao(o.comissao); return { OPERACAO: c.base === 'venda' ? 'Venda' : 'Locação', CODIGO: o.codigo || '', TITULO: o.titulo || '', CLIENTE: o.cliente || 'a identificar', COMISSAO: PC.textoComissao(o.comissao), VALOR: (PC.brl(c.valor) || '—') + (c.base === 'venda' ? '' : '/mês'), TOTAL: PC.brl2(c.total) || '—', QUADRO: c.partes.map(p => `${PC.nomeParte(p)} (${PC.ehPC(p) ? 'indicação' : p.papel}): ${PC.nf(p.pct)}%`).join('; '), RECEBEDOR: PC.nomeParte(PC.recebedor(o.comissao)) }; };

/* --- Documento padrão (ficha de visita, recibo, cláusula, mandato) --- */
PC.pdfDoc = function (jsPDF, o) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
  const W = 595.28, H = 841.89, M = 38, IW = W - 2 * M, BOT = H - 58;
  const C = { g: [30, 34, 39], r: [200, 16, 46], p: [244, 245, 247], z: [250, 250, 251], t: [30, 34, 39], t2: [90, 96, 104], ln: [217, 220, 225], w: [255, 255, 255] };
  const fill = k => doc.setFillColor(k[0], k[1], k[2]), ink = k => doc.setTextColor(k[0], k[1], k[2]), pen = k => doc.setDrawColor(k[0], k[1], k[2]);
  const F = (sz, b) => { doc.setFont('helvetica', b ? 'bold' : 'normal'); doc.setFontSize(sz); };
  const clean = x => String(x == null ? '' : x).replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[^\x00-\xFF–—•²³ºª·€§]/g, '');
  const T = (x, a, b, op) => doc.text(clean(x), a, b, op);
  const wrap = (x, w) => doc.splitTextToSize(clean(x), w);
  let y = 0;
  const cab = () => { fill(C.r); doc.rect(0, 0, W, 8, 'F'); F(8.2, true); ink(C.r); T(o.kicker || o.titulo, M, 34); F(7.6, false); ink(C.t2); T(o.ref || '', M, 46);
    if (o.logos && o.logos.dark) { const lh = 24, lw = lh * o.logos.ratio; doc.addImage(o.logos.dark, 'PNG', W - M - lw, 18, lw, lh); } y = 72; };
  const precisa = h => { if (y + h > BOT) { doc.addPage(); cab(); } };
  const secao = t => { precisa(40); F(8.6, true); ink(C.r); T(t, M, y); pen(C.ln); doc.setLineWidth(0.6); doc.line(M, y + 5, W - M, y + 5); y += 18; };
  cab();
  F(16, true); ink(C.t); wrap(o.titulo, IW).forEach(l => { T(l, M, y); y += 20; }); y += 4;
  if ((o.dados || []).length) {
    secao(o.tituloDados || 'IDENTIFICAÇÃO');
    o.dados.forEach((r, i) => { const v = wrap(r[1] || '_______________________________________', IW - 170); const h = Math.max(17, v.length * 11 + 6); precisa(h); fill(i % 2 ? C.z : C.p); doc.rect(M, y, IW, h, 'F'); F(8.2, false); ink(C.t2); T(r[0], M + 8, y + 11.5); F(8.4, true); ink(C.t); v.forEach((l, k) => T(l, M + 160, y + 11.5 + k * 11)); y += h; });
    y += 12;
  }
  if ((o.tabela || []).length) {
    const cols = o.colunas || [];
    precisa(40); fill(C.g); doc.rect(M, y, IW, 18, 'F'); F(7.8, true); ink(C.w); cols.forEach(cn => T(cn[0], cn[2] === 'r' ? M + cn[1] : M + cn[1], y + 12, cn[2] === 'r' ? { align: 'right' } : undefined)); y += 18;
    o.tabela.forEach((row, i) => { precisa(18); fill(i % 2 ? C.z : C.p); doc.rect(M, y, IW, 18, 'F'); F(8.2, false); ink(C.t); row.forEach((c, j) => { const cn = cols[j]; T(wrap(c, 160)[0] || '', M + cn[1], y + 12, cn[2] === 'r' ? { align: 'right' } : undefined); }); y += 18; });
    y += 12;
  }
  if (o.texto) {
    secao(o.tituloTexto || 'CONDIÇÕES');
    if (o.versao) { F(7.4, true); ink(C.t2); T(o.versao, M, y); y += 11; }
    String(o.texto).split(/\n\s*\n/).forEach(bl => { const first = bl.trim(); F(first === first.toUpperCase() && first.length < 90 ? 9 : 8.4, first === first.toUpperCase() && first.length < 90); ink(C.t); wrap(first, IW).forEach(l => { precisa(13); T(l, M, y); y += 12; }); y += 5; });
  }
  if ((o.assinaturas || []).length) {
    precisa(70 + Math.ceil(o.assinaturas.length / 2) * 64);
    secao('ASSINATURAS'); F(7.8, false); ink(C.t2); T(o.localData || 'Local e data: ______________________________________', M, y + 6); y += 26;
    const cw = (IW - 24) / 2;
    for (let i = 0; i < o.assinaturas.length; i += 2) { precisa(64);
      [o.assinaturas[i], o.assinaturas[i + 1]].forEach((a, j) => { if (!a) return; const x = M + j * (cw + 24); pen(C.t2); doc.setLineWidth(0.6); doc.line(x, y + 26, x + cw, y + 26); F(8, true); ink(C.t); T(wrap(a.nome, cw)[0], x, y + 38); F(7.4, false); ink(C.t2); T(wrap(a.sub || '', cw)[0] || '', x, y + 49); });
      y += 64; }
  }
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) { doc.setPage(i); pen(C.ln); doc.setLineWidth(0.6); doc.line(M, H - 40, W - M, H - 40); F(7.4, false); ink(C.t2);
    T(`${o.corretor?.nome || 'Rodrigo França Viana'} · ${PC.titCor(o.corretor)} · ${o.corretor?.creci || 'CRECI-SP 297692'} · ${o.corretor?.email || 'contato@primecorpconsultoria.com.br'}`, M, H - 27);
    T(`${o.codigo ? 'Ref. ' + o.codigo + ' · ' : ''}${i}/${n}`, W - M, H - 27, { align: 'right' }); }
  return doc;
};

export default PC;
