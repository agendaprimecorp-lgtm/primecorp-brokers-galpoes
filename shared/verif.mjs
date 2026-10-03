/* ===== Verificação do imóvel: campos documentais, índice de verificação e fontes oficiais =====
   Compartilhado entre o app (tela) e o servidor (varredura). Funções puras, sem rede. */
const V = {};

const dig = (s) => String(s ?? "").replace(/\D/g, "");
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const num = (v) => { if (v == null || v === "") return null; if (typeof v === "number") return isFinite(v) ? v : null; let s = String(v).replace(/[^0-9,.\-]/g, ""); if (s.includes(",")) s = s.replace(/\./g, "").replace(",", "."); else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ""); const n = parseFloat(s); return isFinite(n) ? n : null; };
V.dig = dig; V.norm = norm;

/** Campos documentais (privados: nunca vão para teaser, sala, anúncio ou ficha). [chave, rótulo, placeholder, grupos] */
V.CAMPOS = [
  ["matricula", "Nº da matrícula", "ex.: 123.456", "todos"],
  ["cartorio", "Cartório de Registro de Imóveis", "ex.: 2º CRI de Campinas", "todos"],
  ["inscricao", "Inscrição imobiliária (IPTU)", "nº do carnê / cadastro municipal", "urbano"],
  ["cib", "CIB (Cadastro Imobiliário Brasileiro)", "se já tiver", "todos"],
  ["cep", "CEP", "00000-000", "todos"],
  ["endereco", "Logradouro", "rua, avenida, estrada", "todos"],
  ["numero", "Número", "", "todos"],
  ["complemento", "Complemento / quadra e lote", "", "todos"],
  ["bairro", "Bairro", "", "todos"],
  ["proprietario", "Proprietário (como na matrícula)", "nome completo ou razão social", "todos"],
  ["proprietario_doc", "CPF/CNPJ do proprietário", "", "todos"],
  ["nirf", "NIRF (Receita / ITR)", "", "rural"],
  ["sigef", "Código SIGEF / certificação INCRA", "", "rural"],
  ["habite_se", "Habite-se / auto de conclusão", "nº e data", "urbano"],
];
V.CHAVES = V.CAMPOS.map((c) => c[0]);

/** Certidões do vendedor/locador: conferência manual (o sistema guarda a data de cada uma). */
V.CERTIDOES = [
  ["c_onus", "Certidão de matrícula com ônus e ações reais (≤ 30 dias)"],
  ["c_iptu", "Certidão negativa de débitos de IPTU / ITR"],
  ["c_civel", "Distribuidor cível e de execuções (estadual) do vendedor"],
  ["c_federal", "Justiça Federal e certidão conjunta Receita/PGFN"],
  ["c_trab", "CNDT (Justiça do Trabalho)"],
  ["c_protesto", "Protestos (CENPROT)"],
  ["c_condominio", "Declaração de quitação do condomínio (se houver)"],
];

/** Ônus/ocorrências que travam ou exigem cuidado. */
const ONUS_GRAVE = /penhora|arresto|sequestro|indisponibilidade|a[cç][aã]o (real|reipersecut|pessoal reipersecut)|cita[cç][aã]o|execu[cç][aã]o|bloqueio|usucapi|desapropria|tombamento/i;
const ONUS_MEDIO = /hipoteca|aliena[cç][aã]o fiduci[aá]ria|usufruto|inalienabilidade|impenhorabilidade|incomunicabilidade|servid[aã]o|enfiteuse|aforamento|promessa de compra|compromisso de compra|loca[cç][aã]o com cl[aá]usula|direito de prefer|c[eé]dula/i;
V.gravidadeOnus = (t) => (ONUS_GRAVE.test(t || "") ? "v" : ONUS_MEDIO.test(t || "") ? "a" : "a");

/** Semelhança de nomes (0 a 1): fração dos sobrenomes/palavras relevantes em comum. */
V.semelhanca = (a, b) => {
  const fora = new Set(["de", "da", "do", "das", "dos", "e", "ltda", "me", "epp", "eireli", "sa", "s", "a", "cia", "companhia"]);
  const ta = norm(a).split(" ").filter((x) => x.length > 1 && !fora.has(x)); const tb = new Set(norm(b).split(" ").filter((x) => x.length > 1 && !fora.has(x)));
  if (!ta.length || !tb.size) return 0;
  return ta.filter((x) => tb.has(x)).length / Math.max(ta.length, tb.size);
};

/** Diferença relativa entre duas áreas (null se faltar). */
const dif = (a, b) => (a && b ? Math.abs(a - b) / Math.max(a, b) : null);
const diasDesde = (iso) => { const t = Date.parse(iso || ""); return t ? Math.floor((Date.now() - t) / 864e5) : null; };

const docValido = (d) => {
  const x = dig(d);
  if (x.length === 11) { if (/^(\d)\1+$/.test(x)) return false; let s = 0; for (let i = 0; i < 9; i++) s += +x[i] * (10 - i); let r = (s * 10) % 11; if (r === 10) r = 0; if (r !== +x[9]) return false; s = 0; for (let i = 0; i < 10; i++) s += +x[i] * (11 - i); r = (s * 10) % 11; if (r === 10) r = 0; return r === +x[10]; }
  if (x.length === 14) { if (/^(\d)\1+$/.test(x)) return false; const c = (b, p) => { const s = b.split("").reduce((a, n, i) => a + +n * p[i], 0) % 11; return s < 2 ? 0 : 11 - s; }; const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; const d1 = c(x.slice(0, 12), p1); const d2 = c(x.slice(0, 12) + d1, [6, ...p1]); return x.endsWith(`${d1}${d2}`); }
  return false;
};
V.docValido = docValido;
V.ehRural = (tipo) => /fazenda|s[ií]tio|ch[áa]cara|rancho|haras|rural/i.test(tipo || "");

/**
 * Índice de verificação (0 a 100) a partir dos dados da oferta (o) e do resultado da varredura (o.verificacao).
 * Cada item: {k, rotulo, peso, st: 'ok'|'a'|'v'|'pend', msg}. 'pend' = ainda sem informação.
 */
V.avaliar = function (o) {
  const vr = o.verificacao || {}; const f = vr.fontes || {}; const m = vr.matricula || null; const rural = V.ehRural(o.tipo);
  const it = []; const add = (k, rotulo, peso, st, msg) => it.push({ k, rotulo, peso, st, msg });

  // 1. Identificação no registro
  if (o.matricula && o.cartorio) add("ident", "Matrícula e cartório", 12, "ok", `Matrícula ${o.matricula} · ${o.cartorio}`);
  else add("ident", "Matrícula e cartório", 12, "pend", o.matricula ? "Informe o cartório (CRI) da matrícula." : "Informe o número da matrícula e o cartório.");

  // 2. Cadastro fiscal (IPTU urbano; CAR/CCIR/georreferenciamento rural)
  if (rural) {
    const ha = num(o.area_ha); const falta = [!o.car && "CAR", !o.ccir && "CCIR", !(o.nirf) && "NIRF", ha >= 25 && !(o.sigef || o.georref) && "georreferenciamento SIGEF"].filter(Boolean);
    add("fiscal", "Cadastros rurais (CAR, CCIR, NIRF, SIGEF)", 10, falta.length ? (falta.length > 2 ? "pend" : "a") : "ok", falta.length ? "Falta: " + falta.join(", ") + "." : "CAR, CCIR e NIRF informados.");
  } else add("fiscal", "Inscrição imobiliária (IPTU)", 10, o.inscricao ? "ok" : "pend", o.inscricao ? `Inscrição ${o.inscricao}` : "Informe a inscrição imobiliária (carnê do IPTU).");

  // 3. Endereço pelo CEP (Correios via BrasilAPI/ViaCEP)
  if (!o.cep) add("cep", "Endereço confirmado pelo CEP", 10, "pend", "Informe o CEP.");
  else if (!f.cep) add("cep", "Endereço confirmado pelo CEP", 10, "pend", "Rode a varredura para consultar o CEP.");
  else if (f.cep.erro) add("cep", "Endereço confirmado pelo CEP", 10, "v", "CEP não encontrado na base dos Correios: " + f.cep.erro);
  else {
    const cidOk = !o.cidade || norm(f.cep.cidade) === norm(o.cidade); const ruaOk = !o.endereco || !f.cep.logradouro || V.semelhanca(o.endereco, f.cep.logradouro) >= 0.5;
    add("cep", "Endereço confirmado pelo CEP", 10, cidOk && ruaOk ? "ok" : cidOk ? "a" : "v", cidOk && ruaOk ? `${[f.cep.logradouro, f.cep.bairro, f.cep.cidade + "/" + f.cep.uf].filter(Boolean).join(", ")}` : !cidOk ? `CEP é de ${f.cep.cidade}/${f.cep.uf}, mas a oferta diz ${o.cidade}.` : `Logradouro do CEP (${f.cep.logradouro}) difere do informado (${o.endereco}).`);
  }

  // 4. Localização no mapa
  if (f.geo && f.geo.lat) add("geo", "Localização no mapa", 4, f.geo.cidade && o.cidade && norm(f.geo.cidade) !== norm(o.cidade) ? "a" : "ok", `${f.geo.lat.toFixed(5)}, ${f.geo.lon.toFixed(5)}${f.geo.cidade ? " · " + f.geo.cidade : ""}`);
  else add("geo", "Localização no mapa", 4, "pend", f.geo && f.geo.erro ? "Endereço não localizado no mapa: confira número e logradouro." : "Rode a varredura com o endereço preenchido.");

  // 5. Proprietário identificado e documento
  if (!o.proprietario || !o.proprietario_doc) add("prop", "Proprietário identificado", 10, "pend", "Informe nome e CPF/CNPJ do proprietário.");
  else if (!docValido(o.proprietario_doc)) add("prop", "Proprietário identificado", 10, "v", "CPF/CNPJ do proprietário com dígito verificador inválido.");
  else if (dig(o.proprietario_doc).length === 14) {
    const r = f.cnpj;
    if (!r) add("prop", "Proprietário identificado", 10, "pend", "Rode a varredura para consultar o CNPJ na Receita.");
    else if (r.erro) add("prop", "Proprietário identificado", 10, "a", "Consulta do CNPJ indisponível agora: " + r.erro);
    else {
      const ativa = /ativa/i.test(r.situacao || ""); const nomeOk = V.semelhanca(o.proprietario, r.razao_social) >= 0.5;
      add("prop", "Proprietário identificado", 10, !ativa ? "v" : nomeOk ? "ok" : "a", `${r.razao_social} · situação ${r.situacao || "?"}${!nomeOk ? " (nome diferente do informado)" : ""}`);
    }
  } else add("prop", "Proprietário identificado", 10, "ok", `${o.proprietario} · CPF válido (conferir com a matrícula)`);

  // 6. Matrícula lida (certidão) e atualidade
  if (!m) add("mat", "Certidão da matrícula lida", 16, "pend", "Envie a certidão/visualização da matrícula (PDF ou foto): a IA lê proprietários, áreas e ônus.");
  else {
    const numOk = !o.matricula || !m.numero || dig(o.matricula) === dig(m.numero);
    add("mat", "Certidão da matrícula lida", 10, numOk ? "ok" : "v", numOk ? `Matrícula ${m.numero || o.matricula}${m.cartorio ? " · " + m.cartorio : ""}` : `Número lido na certidão (${m.numero}) difere do informado (${o.matricula}).`);
    const dias = diasDesde(m.data_certidao);
    add("data", "Certidão atualizada (≤ 30 dias)", 6, dias == null ? "a" : dias <= 30 ? "ok" : "a", dias == null ? "Data da certidão não identificada." : dias <= 30 ? `Emitida há ${dias} dia(s).` : `Emitida há ${dias} dias: peça nova certidão antes de proposta/escritura.`);
  }

  // 7. Proprietário confere com a matrícula
  if (m && (m.proprietarios || []).length) {
    const nomes = m.proprietarios.map((p) => p.nome).filter(Boolean);
    const docs = m.proprietarios.map((p) => dig(p.documento)).filter(Boolean);
    const bate = (o.proprietario && nomes.some((n) => V.semelhanca(o.proprietario, n) >= 0.6)) || (o.proprietario_doc && docs.includes(dig(o.proprietario_doc)));
    add("titular", "Proprietário confere com a matrícula", 10, !o.proprietario && !o.proprietario_doc ? "a" : bate ? "ok" : "v", `Na matrícula: ${nomes.join("; ") || "—"}${!bate && (o.proprietario || o.proprietario_doc) ? " · quem oferece não aparece como proprietário" : ""}`);
  } else add("titular", "Proprietário confere com a matrícula", 10, "pend", "Depende da leitura da matrícula.");

  // 8. Ônus e ações
  if (m) {
    const ativos = (m.onus || []).filter((x) => !x.cancelado);
    const grave = ativos.filter((x) => V.gravidadeOnus(x.tipo + " " + (x.descricao || "")) === "v");
    add("onus", "Ônus, gravames e ações", 12, grave.length ? "v" : ativos.length ? "a" : "ok", grave.length ? "Impeditivo: " + grave.map((x) => x.tipo).join("; ") + ". Não avance sem parecer jurídico." : ativos.length ? "Ativo: " + ativos.map((x) => x.tipo).join("; ") + " (exige quitação/anuência na negociação)." : "Nenhum ônus ativo na certidão lida.");
  } else add("onus", "Ônus, gravames e ações", 12, "pend", "Depende da leitura da matrícula.");

  // 9. Áreas e construção averbada
  if (m) {
    const terr = num(o.terreno), cons = num(o.construida), ha = num(o.area_ha);
    const dT = rural ? dif(ha, num(m.area_ha) || (num(m.area_terreno) ? num(m.area_terreno) / 1e4 : null)) : dif(terr, num(m.area_terreno));
    const avOk = !cons || m.construcao_averbada === true; const dC = cons && num(m.area_construida_averbada) ? dif(cons, num(m.area_construida_averbada)) : null;
    const msgs = [];
    if (dT != null && dT > 0.05) msgs.push(`área ${rural ? "total" : "do terreno"} difere ${Math.round(dT * 100)}% da matrícula`);
    if (!avOk) msgs.push("construção não averbada na matrícula (risco para financiamento e escritura)");
    else if (dC != null && dC > 0.1) msgs.push(`área construída difere ${Math.round(dC * 100)}% da averbada`);
    add("areas", "Áreas e construção averbada", 10, msgs.length ? (dT != null && dT > 0.2 ? "v" : "a") : dT == null && !cons ? "a" : "ok", msgs.length ? msgs.join("; ").replace(/^./, (c) => c.toUpperCase()) + "." : dT == null ? "Sem área para comparar." : "Áreas conferem com a matrícula.");
  } else add("areas", "Áreas e construção averbada", 10, "pend", "Depende da leitura da matrícula.");

  // Pontuação: ok = peso cheio; 'a' = metade; 'v' e 'pend' = zero.
  const total = it.reduce((s, x) => s + x.peso, 0);
  const pts = it.reduce((s, x) => s + (x.st === "ok" ? x.peso : x.st === "a" ? x.peso / 2 : 0), 0);
  const pct = Math.round((pts / total) * 100);
  const certs = V.CERTIDOES.filter(([k]) => (o.certidoes || {})[k]).length;
  const nivel = it.some((x) => x.st === "v") ? "vermelho" : pct >= 90 && !it.some((x) => x.st === "a") && certs === V.CERTIDOES.length ? "verde" : pct >= 60 ? "amarelo" : "cinza";
  return { pct, nivel, itens: it, certidoes: certs, total_certidoes: V.CERTIDOES.length, pendentes: it.filter((x) => x.st === "pend").length };
};

V.NIVEL = {
  verde: ["VERIFICADO", "Registro, cadastro, proprietário, ônus e certidões conferidos."],
  amarelo: ["EM VERIFICAÇÃO", "Há pontos de atenção ou certidões pendentes."],
  vermelho: ["BLOQUEADO", "Divergência ou ônus impeditivo: não avance sem resolver."],
  cinza: ["SEM DADOS", "Preencha matrícula, CEP e proprietário e rode a varredura."],
};

/** Links oficiais para o que exige login, pagamento de emolumentos ou captcha (consultas que a lei não abre por API). */
V.fontes = function (o) {
  const cid = encodeURIComponent([o.endereco, o.numero, o.cidade, o.uf].filter(Boolean).join(", "));
  const L = [
    ["Matrícula (visualização ou certidão digital) · ONR / RI Digital", "https://ridigital.org.br/", "Pago (emolumentos), exige login. Gere o PDF e envie aqui para a IA ler."],
    ["Mapa dos cartórios de registro (qual CRI atende o endereço)", "https://www.registrodeimoveis.org.br/", "Gratuito."],
    ["Protestos em nome do proprietário · CENPROT", "https://www.pesquisaprotesto.com.br/", "Gratuito, por CPF/CNPJ."],
    ["CNDT · Justiça do Trabalho", "https://cndt-certidao.tst.jus.br/inicio.faces", "Gratuito, por CPF/CNPJ."],
    ["Certidão conjunta Receita Federal / PGFN", "https://servicos.receitafederal.gov.br/servico/certidoes/", "Gratuito."],
  ];
  if ((o.uf || "SP").toUpperCase() === "SP") L.push(["Distribuidor cível e execuções · TJSP (certidões)", "https://esaj.tjsp.jus.br/sco/abrirCadastro.do", "Gratuito, por CPF/CNPJ."]);
  if (V.ehRural(o.tipo)) L.push(["CAR · consulta pública (SICAR)", "https://consultapublica.car.gov.br/publico/imoveis/index", "Gratuito."], ["SIGEF · parcelas certificadas (INCRA)", "https://sigef.incra.gov.br/consultar/parcelas/", "Gratuito."], ["CCIR · emissão (SNCR/INCRA)", "https://sncr.serpro.gov.br/ccir/emissao", "Gratuito."]);
  if (o.endereco || o.cep) L.push(["Ver no mapa", "https://www.openstreetmap.org/search?query=" + cid, "Confira fachada e entorno."]);
  return L.map(([nome, url, obs]) => ({ nome, url, obs }));
};

/** Comparação final em texto (para relatório e para a Zoe). Sem endereço. */
V.resumo = function (o) {
  const a = V.avaliar(o); const N = V.NIVEL[a.nivel];
  return `${N[0]} · índice ${a.pct}% · certidões ${a.certidoes}/${a.total_certidoes}\n` + a.itens.map((x) => `${{ ok: "✔", a: "!", v: "✖", pend: "…" }[x.st]} ${x.rotulo}: ${x.msg}`).join("\n");
};

export default V;
