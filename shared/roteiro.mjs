// Roteiro guiado de visita: fotos e dados obrigatórios por tipo de imóvel.

export const TIPOS = ["Casa", "Casa em condomínio", "Apartamento", "Sobrado", "Cobertura", "Kitnet / studio", "Sala comercial", "Loja", "Ponto comercial", "Prédio comercial", "Imóvel comercial", "Galpão", "Galpão em condomínio", "Barracão", "Terreno", "Lote em condomínio", "Área / terreno", "Área industrial", "Área comercial", "Fazenda", "Sítio", "Chácara", "Haras"];

export function grupo(tipo) {
  const t = String(tipo || "").toLowerCase();
  if (/fazenda|s[ií]tio|ch[áa]cara|rancho|haras|rural/.test(t)) return "rural";
  if (/^(terreno|[áa]rea|lote)/.test(t)) return "area";
  if (/galp|barrac|armaz|dep[óo]sito|log[ií]st|industr/.test(t)) return "galpao";
  if (/terreno|área|area|lote/.test(t)) return "area";
  if (/sala|loja|pr[ée]dio|comercial|ponto/.test(t)) return "comercial";
  return "residencial";
}

const F = (id, nome, dica, obrigatorio = true, extra = {}) => ({ id, nome, dica, obrigatorio, ...extra });

/** Lista de fotos do roteiro. `d` são os dados já preenchidos (ex.: nº de dormitórios). */
export function roteiroFotos(tipo, d = {}) {
  const g = grupo(tipo);
  if (g === "residencial") {
    const L = [F("fachada", "Fachada", "De frente, do outro lado da rua, celular na horizontal. Evite carros e pessoas.")];
    if (/condom|apartamento|cobertura|kitnet/i.test(tipo)) L.push(F("condominio", "Portaria e áreas comuns", "Portaria, piscina, salão, academia, playground.", /condom/i.test(tipo)));
    L.push(F("sala", "Sala", "Do canto oposto à janela, pegando o ambiente inteiro. Luzes acesas e cortinas abertas."));
    L.push(F("cozinha", "Cozinha", "Mostre bancadas e armários. Tire objetos da pia."));
    const nd = Math.min(6, Math.max(1, Number(d.dormitorios) || 1));
    for (let i = 1; i <= nd; i++) L.push(F("dorm" + i, nd > 1 ? `Dormitório ${i}` : "Dormitório", "Da porta para dentro, cama arrumada, sem objetos pessoais."));
    const nb = Math.min(4, Math.max(1, Number(d.banheiros) || 1));
    for (let i = 1; i <= nb; i++) L.push(F("banho" + i, nb > 1 ? `Banheiro ${i}` : "Banheiro", "Tampa do vaso abaixada, toalhas fora. Fotografe do batente da porta."));
    L.push(F("servico", "Área de serviço", "Tanque e espaço para máquina.", !/kitnet/i.test(tipo)));
    if (!/apartamento|cobertura|kitnet/i.test(tipo)) L.push(F("externa", "Quintal / área externa", "Quintal, jardim, churrasqueira ou piscina.", false));
    L.push(F("vaga", "Garagem / vaga", "Mostre quantos carros cabem.", Number(d.vagas) > 0));
    L.push(F("vista", "Vista / varanda", "Da varanda ou da melhor janela.", false));
    return L;
  }
  if (g === "galpao") return [
    F("fachada", "Fachada e portaria", "Frente do galpão com o acesso de caminhões."),
    F("interna", "Área operacional", "Do canto, mostrando o vão livre inteiro. Luzes acesas."),
    F("pe_direito", "Pé-direito", "Foto vertical com uma referência (pessoa, porta, empilhadeira)."),
    F("docas", "Docas", "Docas niveladoras e portões.", Number(d.docas) > 0 || d.docas === undefined),
    F("piso", "Piso", "Estado do piso industrial e marcações."),
    F("energia", "Cabine primária / quadro de energia", "Cabine, transformador ou quadro geral."),
    F("escritorios", "Escritórios", "Mezanino ou bloco administrativo."),
    F("apoio", "Vestiários e refeitório", "Banheiros, vestiários, copa.", false),
    F("patio", "Pátio de manobra", "Mostre a área para carretas.", !/barrac/i.test(tipo)),
    F("cobertura", "Cobertura e iluminação", "Estrutura do telhado, telhas translúcidas, iluminação.", false),
    F("incendio", "Prevenção de incêndio", "Sprinklers, hidrantes, reservatório. Pergunte pelo AVCB.", false),
    F("estac", "Estacionamento", "Vagas de carros e motos para funcionários.", false),
    F("acesso", "Acesso e entorno", "Rua de acesso e distância até a rodovia.", false),
  ];
  if (g === "comercial") {
    const predio = /pr[ée]dio/i.test(tipo); const sala = /sala/i.test(tipo);
    return [
      F("fachada", sala ? "Fachada do edifício" : "Fachada / vitrine", sala ? "Entrada do prédio, de frente." : "De frente, mostrando a visibilidade para a rua."),
      ...(predio || sala ? [F("recepcao", "Recepção / hall", "Portaria e hall de entrada.", predio)] : []),
      F("salao", predio ? "Andar tipo" : sala ? "Sala principal" : "Salão principal", predio ? "Planta livre de um andar, do canto." : "Do fundo para a porta e da porta para o fundo."),
      ...(predio ? [F("elevador", "Elevadores e escadas", "Elevadores, escadas e acessibilidade.", false)] : []),
      F("banho", "Banheiros", "Inclua o banheiro acessível, se houver."),
      F("copa", "Copa / apoio", "Copa, depósito ou cozinha.", false),
      ...(sala ? [F("vista", "Vista da janela", "A melhor vista da sala.", false)] : []),
      F("vaga", "Estacionamento / vagas", "Vagas privativas ou de clientes.", predio),
      F("entorno", "Entorno", "Movimento da rua e comércio vizinho.", false),
    ];
  }
  if (g === "area") {
    const neg = /industr|comercial/i.test(tipo);
    return [
      F("geral", "Vista geral", "Do ponto mais alto, mostrando o terreno inteiro."),
      F("frente", "Frente / testada", "Toda a frente, de um lado ao outro."),
      F("acesso", "Rua de acesso", "Asfalto, guia, calçada."),
      ...(/condom/i.test(tipo) ? [F("condominio", "Portaria e áreas comuns", "Portaria, lazer e ruas internas do condomínio.")] : []),
      ...(neg ? [F("acesso_rod", "Acesso rodoviário", "Saída para a rodovia mais próxima e distância em km.")] : []),
      F("topografia", "Topografia", "Mostre se é plano, aclive ou declive."),
      F("divisas", "Divisas e marcos", "Cercas, muros ou marcos de divisa.", false),
      F("vizinhanca", "Vizinhança", "Construções ao lado e em frente.", false),
      F("infra", "Infraestrutura", neg ? "Rede de energia (média tensão), água, esgoto, gás." : "Poste de energia, rede de água e esgoto.", false),
    ];
  }
  const lazer = /s[ií]tio|ch[áa]cara|rancho/i.test(tipo); const haras = /haras/i.test(tipo);
  return [
    F("porteira", "Porteira e acesso", "Entrada e estrada até a sede."),
    F("sede", "Sede", "Fachada da casa principal."),
    F("sede_int", "Interior da sede", "Sala e cozinha da sede.", lazer),
    ...(lazer ? [F("lazer", "Lazer", "Piscina, churrasqueira, área gourmet, campo.")] : []),
    ...(haras ? [F("baias", "Baias e picadeiro", "Cocheiras, baias, picadeiro e redondel.")] : []),
    F("producao", lazer ? "Pomar / horta / pasto" : "Pastagem / lavoura", lazer ? "Árvores frutíferas, horta ou pasto." : "Área produtiva principal.", !lazer),
    F("agua", "Água", "Represa, rio, nascente ou poço."),
    F("benfeitorias", "Benfeitorias", lazer ? "Casa de caseiro, galpão, canil, depósito." : "Curral, barracão, casa de caseiro, galpão de máquinas.", !lazer),
    F("estradas", "Estradas internas", "Condição das estradas na propriedade.", false),
    F("geral", "Vista geral / drone", "Panorama da propriedade.", false),
  ];
}

/** Dados obrigatórios por grupo: [campo, rótulo, tipo]. */
export function roteiroDados(tipo, operacao) {
  const g = grupo(tipo);
  const valor = /venda/i.test(operacao || "") && /loca/i.test(operacao || "") ? [["venda", "Valor de venda", "R$"], ["aluguel", "Aluguel mensal", "R$"]] : /loca/i.test(operacao || "") ? [["aluguel", "Aluguel mensal", "R$"]] : [["venda", "Valor de venda", "R$"]];
  const base = [["cidade", "Cidade", "txt"], ["bairro", "Bairro / região", "txt"]];
  const fim = [["documentacao", "Documentação (matrícula, escritura, IPTU)", "txt"], ["disponibilidade", "Disponibilidade (desocupado, a partir de…)", "txt"]];
  if (g === "residencial") return [...base, ["construida", /apartamento|cobertura|kitnet/i.test(tipo) ? "Área útil" : "Área construída", "m²"], ["dormitorios", "Dormitórios", "n"], ["suites", "Suítes", "n"], ["banheiros", "Banheiros", "n"], ["vagas", "Vagas", "n"], ...valor, ["iptu", "IPTU", "R$"], ...(/condom|apartamento|cobertura|kitnet/i.test(tipo) ? [["condominio", "Condomínio (mensal)", "R$"]] : []), ...fim];
  if (g === "galpao") return [...base, ["construida", "Área construída", "m²"], ["terreno", "Área do terreno", "m²"], ["pe_direito", "Pé-direito livre", "m"], ["docas", "Docas", "n"], ["energia_kva", "Energia", "kVA"], ...valor, ["iptu", "IPTU", "R$"], ["avcb", "AVCB (situação)", "txt"], ...fim];
  if (g === "comercial") return [...base, ["construida", "Área", "m²"], ["banheiros", "Banheiros", "n"], ["vagas", "Vagas", "n"], ...valor, ["iptu", "IPTU", "R$"], ...fim];
  if (g === "area") return [...base, ["terreno", "Área do terreno", "m²"], ["frente", "Frente", "m"], ["zoneamento", "Zoneamento", "txt"], ...valor, ["iptu", "IPTU", "R$"], ...fim];
  return [...base, ["area_ha", "Área total", "ha"], ["aptidao", "Aptidão (pecuária, grãos, lazer…)", "txt"], ["agua", "Água", "txt"], ["benfeitorias", "Benfeitorias", "txt"], ...valor, ["car", "CAR", "txt"], ["ccir", "CCIR / ITR", "txt"], ...fim];
}

const vazio = (v) => v === undefined || v === null || String(v).trim() === "";

/** Progresso do roteiro: o que falta para finalizar. */
export function progresso(c) {
  const d = c.dados || {};
  const fotos = roteiroFotos(d.tipo, d);
  const ambs = c.ambientes || [];
  const faltamFotos = fotos.filter((f) => f.obrigatorio && !ambs.some((a) => a.roteiro === f.id && (a.fotos || []).length));
  const faltamDados = roteiroDados(d.tipo, d.operacao).filter(([k]) => vazio(d[k])).map(([k, r]) => ({ campo: k, rotulo: r }));
  const obrig = fotos.filter((f) => f.obrigatorio).length + roteiroDados(d.tipo, d.operacao).length;
  const feitos = obrig - faltamFotos.length - faltamDados.length;
  return { pct: obrig ? Math.round((feitos / obrig) * 100) : 0, faltamFotos, faltamDados, ok: !faltamFotos.length && !faltamDados.length };
}
