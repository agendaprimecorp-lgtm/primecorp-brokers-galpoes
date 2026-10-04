// Zoe — assistente virtual da PrimeCorp Brokers (WhatsApp e app).
// Cérebro independente de transporte: recebe a conversa e um contexto de dados, devolve a resposta e as ações executadas.
import Anthropic from "@anthropic-ai/sdk";
import PC from "./core.mjs";
import V from "./verif.mjs";
import { ZOE_PADRAO } from "./zoe-base.mjs";
import { MODELO_PADRAO, MODELOS_RESERVA, modeloIndisponivel } from "./servidor.mjs";

export const TZ = "-03:00"; // Brasília (sem horário de verão desde 2019)
const DIAS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

export { ZOE_PADRAO };

const fmtData = (d) => { const x = new Date(d.getTime() - 3 * 3600e3); return `${DIAS[x.getUTCDay()]}, ${String(x.getUTCDate()).padStart(2, "0")}/${String(x.getUTCMonth() + 1).padStart(2, "0")} às ${String(x.getUTCHours()).padStart(2, "0")}:${String(x.getUTCMinutes()).padStart(2, "0")}`; };
const local = (d) => { const x = new Date(d.getTime() - 3 * 3600e3); return { y: x.getUTCFullYear(), m: x.getUTCMonth(), d: x.getUTCDate(), wd: x.getUTCDay(), h: x.getUTCHours(), mi: x.getUTCMinutes() }; };
const deLocal = (y, m, d, h, mi) => new Date(Date.UTC(y, m, d, h + 3, mi));
const hm = (s) => { const [h, m] = String(s || "0:0").split(":").map(Number); return [h || 0, m || 0]; };
export const fmtHora = fmtData;

/** Horários livres a partir de amanhã (ou hoje, respeitando antecedência). */
export function horariosLivres(cfgZoe, agenda, agora, { dias = 7, turno = null, max = 8 } = {}) {
  const H = { ...ZOE_PADRAO.horario, ...(cfgZoe?.horario || {}) };
  const dur = Math.max(15, Number(H.duracao) || 60);
  const ocup = (agenda || []).filter((a) => a.status !== "cancelado").map((a) => [Date.parse(a.inicio), Date.parse(a.fim || a.inicio) || Date.parse(a.inicio) + dur * 60e3]);
  const bloq = new Set((cfgZoe?.bloqueios || []).map(String));
  const limite = agora.getTime() + (Number(H.antecedencia_h) || 0) * 3600e3;
  const out = []; const L = local(agora);
  for (let k = 0; k <= Math.min(21, dias) && out.length < max; k++) {
    const base = deLocal(L.y, L.m, L.d + k, 12, 0); const D = local(base);
    const iso = `${D.y}-${String(D.m + 1).padStart(2, "0")}-${String(D.d).padStart(2, "0")}`;
    const sab = D.wd === 6 && H.sabado_ate;
    if (bloq.has(iso) || (!H.dias.includes(D.wd) && !sab)) continue;
    const [hi, mi] = hm(H.inicio); const [hf, mf] = hm(sab ? H.sabado_ate : H.fim);
    for (let t = deLocal(D.y, D.m, D.d, hi, mi).getTime(); t + dur * 60e3 <= deLocal(D.y, D.m, D.d, hf, mf).getTime() && out.length < max; t += dur * 60e3) {
      const h = local(new Date(t)).h;
      if (turno === "manha" && h >= 12) continue; if (turno === "tarde" && h < 12) continue;
      if (t < limite) continue;
      if (ocup.some(([a, b]) => t < b && t + dur * 60e3 > a)) continue;
      out.push(new Date(t));
    }
  }
  return out;
}

/** Interpreta "AAAA-MM-DDTHH:MM" como horário de Brasília. */
export function lerHorario(s) {
  const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  return m ? deLocal(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : null;
}

/* ---------------- Ferramentas ---------------- */
const T = (name, description, properties, required = []) => ({ name, description, input_schema: { type: "object", properties, required } });
const s = (d) => ({ type: "string", description: d }); const nn = (d) => ({ type: "number", description: d });
const TIPOS = "Galpão, Galpão em condomínio, Área industrial, Área comercial, Terreno, Lote em condomínio, Sala comercial, Loja, Ponto comercial, Prédio comercial, Casa, Casa em condomínio, Apartamento, Sobrado, Cobertura, Sítio, Chácara, Fazenda, Haras";

export const FERRAMENTAS_CLIENTE = [
  T("buscar_imoveis", "Procura na base da PrimeCorp imóveis compatíveis. Devolve só faixas de área/valor e códigos (nunca endereço). Use depois de saber ao menos tipo, operação e cidade/região.", { tipo: s("Um de: " + TIPOS), operacao: s("Locação ou Venda"), cidades: s("cidades separadas por vírgula"), area_min: nn("m²"), area_max: nn("m²"), ha_min: nn("hectares (rural)"), dormitorios_min: nn(""), valor_max: nn("venda: valor total em R$"), aluguel_max: nn("locação: aluguel mensal total em R$") }, ["tipo", "operacao"]),
  T("registrar_demanda", "Registra a necessidade do cliente (briefing) para a equipe montar a Sala do Cliente com opções verificadas. Chame assim que tiver tipo, operação, local e tamanho ou orçamento.", { nome: s("nome da pessoa"), empresa: s("empresa, se houver"), documento: s("CNPJ/CPF, se informado"), email: s(""), perfil: s("Cliente (empresa) | Cliente (investidor) | Pessoa física | Corretor parceiro | Imobiliária"), tipo: s(TIPOS), operacao: s("Locação | Venda"), cidades: s(""), regiao: s(""), area_min: nn("m²"), area_max: nn("m²"), ha_min: nn(""), ha_max: nn(""), dormitorios_min: nn(""), vagas_min: nn(""), pe_direito_min: nn("m"), energia_min_kva: nn(""), docas_min: nn(""), aluguel_max: nn("R$/mês total"), preco_max_m2: nn("R$/m² aluguel"), valor_max: nn("compra R$"), prazo: s("quando precisa ocupar/comprar"), uso: s("atividade/uso pretendido"), observacoes: s("") }, ["nome", "tipo", "operacao"]),
  T("registrar_imovel_proprietario", "Registra um imóvel oferecido por proprietário ou corretor (entra como oferta 'a revisar' para a equipe). Peça o número da matrícula e o cartório se a pessoa souber.", { nome: s("quem oferece"), papel: s("Proprietário | Corretor | Imobiliária"), tipo: s(TIPOS), operacao: s("Locação | Venda | Locação / Venda"), cidade: s(""), bairro_regiao: s("bairro ou região (sem número)"), area_terreno: nn("m²"), area_construida: nn("m²"), area_ha: nn("rural"), dormitorios: nn(""), valor_venda: nn(""), valor_aluguel: nn(""), matricula: s("nº da matrícula"), cartorio: s("cartório de registro"), creci: s("se corretor/imobiliária"), observacoes: s("") }, ["nome", "tipo", "operacao", "cidade"]),
  T("horarios_livres", "Lista horários livres na agenda da equipe (horário de Brasília). Ofereça 2 ou 3 opções ao cliente.", { dias_a_frente: nn("1 a 14, padrão 7"), turno: s("manha | tarde | qualquer") }),
  T("agendar", "Marca reunião, visita ou ligação num horário livre. Confirme antes nome, assunto e horário com o cliente.", { inicio: s("AAAA-MM-DDTHH:MM (Brasília), exatamente um dos horários livres"), tipo: s("Reunião (vídeo) | Reunião presencial | Visita ao imóvel | Ligação | Captação no local"), assunto: s("resumo em 1 linha"), nome: s("nome de quem vai participar"), codigo_imovel: s("PC-0000, se houver") }, ["inicio", "tipo", "assunto", "nome"]),
  T("meus_agendamentos", "Lista os agendamentos futuros deste contato.", {}),
  T("cancelar_agendamento", "Cancela (ou libera para remarcar) um agendamento deste contato.", { id: s("id do agendamento") }, ["id"]),
  T("salvar_contato", "Atualiza dados do contato (nome, empresa, e-mail, documento, cidade, perfil).", { nome: s(""), empresa: s("empresa ou órgão público"), cargo: s("cargo/profissão (ex.: Secretário de Finanças, advogado OAB/SP 000)"), email: s(""), documento: s(""), cidade: s("cidade ou região de atuação"), observacoes: s("frentes de interesse, entes citados, relacionamento com gestores"), perfil: s("Cliente (empresa) | Cliente (investidor) | Corretor parceiro | Imobiliária | Proprietário | Órgão público | Parceiro tributário | Outro") }),
  T("chamar_equipe", "Transfere para um humano (Rodrigo ou Joselia). Use quando: pedirem pessoa, negociação de valores/comissão, proposta, reclamação, questão jurídica, prefeitura/órgão público ou parceiro tributário já qualificado (depois de coletar os dados da linha E/H), dúvida que você não sabe responder ou cliente irritado.", { motivo: s("1 frase"), urgente: { type: "boolean" } }, ["motivo"]),
];

export const FERRAMENTAS_EQUIPE = [
  T("resumo_operacao", "Números do sistema agora: briefings, ofertas a revisar, negócios por etapa, conversas que pedem humano, agenda de hoje.", {}),
  T("agenda_periodo", "Agenda da equipe entre duas datas (AAAA-MM-DD).", { de: s(""), ate: s("") }),
  T("conversas_pendentes", "Conversas do WhatsApp que pedem atendimento humano ou estão sem resposta.", {}),
  T("buscar_imoveis", FERRAMENTAS_CLIENTE[0].description.replace("(nunca endereço)", "(com código e verificação)"), FERRAMENTAS_CLIENTE[0].input_schema.properties, ["tipo", "operacao"]),
  T("verificacao_imovel", "Situação da verificação documental de um imóvel pelo código PC-0000.", { codigo: s("PC-0000") }, ["codigo"]),
  FERRAMENTAS_CLIENTE[2], FERRAMENTAS_CLIENTE[3],
];

/* ---------------- Prompt ---------------- */
function pctTxt(v) { const n = PC.parseBR(v) || 0; return `${PC.nf(n)}% sobre o valor da venda`; }
function alugTxt(v) { const n = PC.parseBR(v) || 1; return `${PC.nf(n)} aluguel${n === 1 ? "" : "éis"} mensal${n === 1 ? "" : "is"}`; }

export function promptSistema({ zoe, geral, agora, equipe, contato, conversa }) {
  const z = { ...ZOE_PADRAO, ...(zoe || {}) };
  const sub = (t) => String(t || "").replace("{{COMISSAO_VENDA}}", pctTxt(geral?.com_venda_pct || 6)).replace("{{COMISSAO_LOCACAO}}", alugTxt(geral?.com_locacao_alugueis || 1));
  const H = { ...ZOE_PADRAO.horario, ...(z.horario || {}) };
  const L = local(agora); const dentro = H.dias.includes(L.wd) && L.h * 60 + L.mi >= hm(H.inicio)[0] * 60 + hm(H.inicio)[1] && L.h * 60 + L.mi < hm(H.fim)[0] * 60 + hm(H.fim)[1];
  const base = `Você é a Zoe, assistente virtual da PrimeCorp Brokers no WhatsApp. Agora: ${fmtData(agora)} (horário de Brasília); ${dentro ? "dentro" : "FORA"} do horário de atendimento humano (${H.dias.map((d) => DIAS[d].slice(0, 3)).join(", ")} das ${H.inicio} às ${H.fim}).

QUEM SOMOS
${sub(z.quem_somos)}

O QUE OFERECEMOS
${sub(z.servicos)}

PERGUNTAS FREQUENTES
${sub(z.faq)}

${z.tributario || ZOE_PADRAO.tributario}

LOCAL DAS REUNIÕES: ${z.local_reuniao}
${z.regras_extra ? "\nORIENTAÇÕES DA EQUIPE\n" + z.regras_extra + "\n" : ""}`;
  if (equipe) return base + `
MODO EQUIPE: você está falando com ${contato?.nome || "um membro da equipe"} (equipe PrimeCorp). Seja uma secretária executiva: direta, números primeiro, sem saudações longas. Use as ferramentas para responder com dados reais do sistema. Pode citar códigos PC, nomes de clientes e situação de verificação. Nunca altere valores, comissões ou exclua registros: para isso, oriente a usar o app.`;
  return base + `
LINHAS DE CONVERSA (identifique a intenção na 1ª ou 2ª mensagem e siga a linha; se não estiver claro, ofereça botões: Imóveis | Prefeituras | Parceria tributária):
A) BUSCA DE IMÓVEL (empresa, investidor, família): pergunte UMA coisa por vez, nesta ordem, pulando o que já foi dito: 1 tipo e operação (alugar/comprar) · 2 cidade/região · 3 tamanho (m², ha ou dormitórios) · 4 orçamento · 5 prazo · 6 para empresa: atividade, pé-direito, docas, energia · 7 nome e empresa. Com tipo+operação+local+tamanho ou orçamento: chame registrar_demanda, depois buscar_imoveis. Se houver opções, mostre até 3 em faixas (código PC, tipo, região, faixa de área e valor) e diga que a ficha completa vai pela Sala do Cliente após o termo. Sempre ofereça agendar uma conversa de 30 a 60 min. Prometa retorno com opções verificadas em até 24 horas úteis.
B) PROPRIETÁRIO quer vender/alugar: tipo, operação, cidade e bairro, áreas, valor pretendido, nº da matrícula e cartório (se souber), se há financiamento/ônus, se está ocupado. Registre com registrar_imovel_proprietario e ofereça agendar a "Captação no local". Honorários: informe o padrão do texto acima, sem negociar; negociação = chamar_equipe.
C) CORRETOR OU IMOBILIÁRIA: pergunte se tem cliente (demanda) ou imóvel (estoque) e o CRECI. Demanda → linha A com perfil "Corretor parceiro"/"Imobiliária"; imóvel → linha B com papel Corretor/Imobiliária. Explique que a divisão de honorários é formalizada em acordo antes de qualquer apresentação.
D) INTERESSE EM ANÚNCIO (código PC, link /i/… ou "vi o anúncio"): use buscar_imoveis ou o código citado; informe só o que é público e ofereça visita (agendar tipo "Visita ao imóvel").
E) PREFEITURA / CÂMARA / ÓRGÃO PÚBLICO (crédito tributário/previdenciário): explique em 2 linhas o que a PrimeCorp Consultoria faz (êxito, sem custo antecipado, análise inicial sem custo). Pergunte UMA coisa por vez: 1 município/estado e órgão · 2 nome e cargo · 3 qual frente interessa (IRRF, PASEP, RAT/FAP, ISSQN, FGTS, FPM/FPE ou "todas") · 4 se já tem contrato vigente com outra consultoria no tema · 5 e-mail. Registre com salvar_contato (perfil "Órgão público", empresa = órgão) e ofereça reunião de apresentação com Rodrigo (horarios_livres → agendar, tipo "Reunião (vídeo)", assunto "B2G – <município>"). Depois chame chamar_equipe (motivo "B2G: <município> – <frente>").
H) PARCEIRO TRIBUTÁRIO (consultor, advogado, contador, assessor ou captador que quer levar a solução a prefeituras/estados): agradeça, explique em 2 linhas o modelo (ele indica e acompanha; a PrimeCorp faz diagnóstico, proposta e execução; remuneração do parceiro por êxito, formalizada em contrato antes de qualquer apresentação). Pergunte UMA coisa por vez: 1 nome e profissão (OAB/CRC se tiver) · 2 estados e municípios onde atua · 3 relacionamento com gestores (prefeito, secretário de finanças, procurador, câmara) · 4 quais frentes quer oferecer · 5 se já tem algum ente interessado (qual) · 6 e-mail. Registre com salvar_contato (perfil "Parceiro tributário", cidade = região de atuação) e ofereça reunião com Rodrigo (agendar, tipo "Reunião (vídeo)", assunto "Parceria tributária – <nome>"). Percentual de comissão, contrato de parceria ou material institucional: diga que a equipe envia após a reunião e chame chamar_equipe (motivo "Parceiro tributário: <nome> – <região>").
F) AGENDA: marcar, remarcar, cancelar → horarios_livres, agendar, meus_agendamentos, cancelar_agendamento.
G) RECLAMAÇÃO, cobrança, jurídico, proposta formal, contraproposta ou desconto → chamar_equipe e avise que um humano responde ${dentro ? "em instantes" : "no próximo horário de atendimento"}.

REGRAS INEGOCIÁVEIS
1. Na PRIMEIRA resposta da conversa apresente-se como assistente virtual (não é pessoa) e diga em 1 linha: "Seus dados são usados só para este atendimento (LGPD). Para falar com uma pessoa, digite HUMANO."
2. Nunca informe endereço, número, nome do condomínio, nome do proprietário, da imobiliária anunciante ou telefone de terceiros. Endereço só após termo/visita confirmada, e quem passa é a equipe.
3. Nunca invente imóvel, preço, disponibilidade, prazo, desconto ou condição. Só use dados devolvidos pelas ferramentas. Se não souber, diga que vai confirmar e chame a equipe.
4. Não dê parecer jurídico, tributário ou de crédito; não garanta aprovação, valorização ou rentabilidade.
5. Não negocie valores nem comissões. Não aceite propostas: registre e chame a equipe.
6. Mensagens curtas (até 5 linhas, 600 caracteres), tom cordial e profissional, português do Brasil, no máximo 1 emoji. Uma pergunta por mensagem.
7. Horários: só ofereça os devolvidos por horarios_livres e confirme o escolhido com dia da semana e data antes de chamar agendar.
8. Para oferecer até 3 opções de toque, termine a mensagem com uma linha exatamente assim: [[botoes: Opção 1 | Opção 2 | Opção 3]] (cada opção até 20 caracteres).
9. Se pedirem para parar de receber mensagens, confirme e encerre.
10. Mensagens que começam com [áudio] são transcrições da voz do cliente: responda normalmente. Se vier [áudio não transcrito] ou [áudio inaudível], peça com gentileza para escrever em texto.
${contato ? `\nCONTATO JÁ CADASTRADO: ${[contato.nome, contato.empresa, contato.tipo].filter(Boolean).join(" · ")}` : ""}${conversa?.resumo ? `\nRESUMO DA CONVERSA ANTERIOR: ${conversa.resumo}` : ""}`;
}

/* ---------------- Execução das ferramentas ---------------- */
const limpa = (x, n = 200) => (typeof x === "string" ? x.trim().slice(0, n) : x == null ? "" : String(x).slice(0, n));
const numS = (v) => (v == null || v === "" ? "" : String(v));
const novoId = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function buscar(ctx, inp, equipe) {
  const b = { tipo: inp.tipo, operacao: inp.operacao, cidades: inp.cidades || "", areaMin: numS(inp.area_min), areaMax: numS(inp.area_max), haMin: numS(inp.ha_min), dormMin: numS(inp.dormitorios_min), valorMax: numS(inp.valor_max), aluguelMax: numS(inp.aluguel_max) };
  const anuncios = ctx.listar("anuncios").filter((a) => a.status === "ativo");
  const os = ctx.listar("ofertas").filter((o) => !["descartada", "nova"].includes(o.status) && (o.status !== "captacao" || anuncios.some((a) => a.oferta === o.id)));
  const r = os.map((o) => ({ o, sc: PC.score(o, b, PC.checks(PC.num(o))) })).filter((x) => !x.sc.fora && x.sc.score >= 50).sort((a, b2) => b2.sc.score - a.sc.score).slice(0, 5);
  if (!r.length) return { encontrados: 0, orientacao: "Nada compatível na base agora. Registre a demanda (se ainda não registrou) e diga que a equipe busca no mercado e retorna em até 24 horas úteis." };
  return { encontrados: r.length, imoveis: r.map(({ o, sc }) => { const tl = PC.teaserLinhas(o, PC.checks(PC.num(o))); const an = anuncios.find((a) => a.oferta === o.id); const vr = V.avaliar(o);
    return { codigo: o.codigo || "(sem código)", resumo: tl.titulo, faixas: tl.linhas.filter((l) => !/^A confirmar/i.test(l)), aderencia: sc.score, ...(an ? { link_publico: `${ctx.base}/i/${an.id}` } : {}), verificacao: V.NIVEL[vr.nivel][0], ...(equipe ? { titulo: o.titulo || PC.autoTitle(PC.num(o)), cidade: o.cidade, status: o.status, indice_verificacao: vr.pct } : {}) }; }) };
}

function contatoDe(ctx, conv) { return conv.contato ? ctx.listar("contatos").find((c) => c.id === conv.contato) || null : null; }
function garantirContato(ctx, conv, d = {}) {
  let c = contatoDe(ctx, conv);
  const tel = "+" + conv.id;
  const tipo = /prefeit|munic|órgão|orgao/i.test(d.perfil || "") ? "Órgão público" : /tribut/i.test(d.perfil || "") ? "Parceiro tributário" : ["Cliente (empresa)", "Cliente (investidor)", "Corretor parceiro", "Imobiliária", "Proprietário", "Outro"].find((t) => t === d.perfil) || (/pessoa/i.test(d.perfil || "") ? "Outro" : d.perfil ? "Outro" : c?.tipo || "Outro");
  const novo = { ...(c || { id: novoId("c"), criado: ctx.agora.toISOString(), origem: "WhatsApp · Zoe", telefone: tel }), ...(d.nome ? { nome: limpa(d.nome, 120) } : {}), ...(d.empresa ? { empresa: limpa(d.empresa, 120) } : {}), ...(d.email ? { email: limpa(d.email, 120).toLowerCase() } : {}), ...(d.documento ? { documento: limpa(d.documento, 30) } : {}), ...(d.cidade ? { cidade: limpa(d.cidade, 80) } : {}), ...(d.creci ? { creci: limpa(d.creci, 30) } : {}), ...(d.cargo ? { cargo: limpa(d.cargo, 80) } : {}), ...(d.observacoes ? { obs: limpa(d.observacoes, 600) } : {}), tipo: d.perfil ? tipo : c?.tipo || tipo, atualizado: ctx.agora.toISOString() };
  if (!novo.nome) novo.nome = conv.nome || "Contato WhatsApp";
  ctx.salvar("contatos", novo.id, novo); conv.contato = novo.id; if (novo.nome) conv.nome = novo.nome;
  return novo;
}

export function executar(ctx, conv, nome, inp, equipe) {
  inp = inp && typeof inp === "object" ? inp : {};
  const agora = ctx.agora; const cfgZ = ctx.cfg.zoe || {};
  const agenda = () => ctx.listar("agenda");
  switch (nome) {
    case "buscar_imoveis": return buscar(ctx, inp, equipe);
    case "registrar_demanda": {
      const c = garantirContato(ctx, conv, inp);
      const parc = /corretor|imobili/i.test(inp.perfil || "");
      const b = { id: novoId("b"), criado: agora.toISOString(), atualizado: agora.toISOString(), status: "ativo", origem: "WhatsApp · Zoe", nome: `${limpa(inp.empresa || inp.nome, 60)} · ${limpa(inp.tipo, 40)} ${limpa(inp.operacao, 20)}`.trim(),
        tipo: limpa(inp.tipo, 40), operacao: /venda|compra/i.test(inp.operacao || "") ? "Venda" : "Locação", cidades: limpa(inp.cidades, 200), regiao: limpa(inp.regiao, 120),
        areaMin: numS(inp.area_min), areaMax: numS(inp.area_max), haMin: numS(inp.ha_min), haMax: numS(inp.ha_max), dormMin: numS(inp.dormitorios_min), vagasMin: numS(inp.vagas_min), peMin: numS(inp.pe_direito_min), kvaMin: numS(inp.energia_min_kva), docasMin: numS(inp.docas_min), aluguelMax: numS(inp.aluguel_max), precoMaxM2: numS(inp.preco_max_m2), valorMax: numS(inp.valor_max), prazo: limpa(inp.prazo, 80),
        desejaveis: limpa(inp.uso, 300), obs: `Registrado pela Zoe (WhatsApp +${conv.id}). ${limpa(inp.observacoes, 400)}`.trim(), ...(parc ? { parceiro_id: c.id, parceiro: c.nome, parceiro_tel: c.telefone } : { cliente: c.id }) };
      ctx.salvar("briefings", b.id, b); conv.briefings = [...new Set([...(conv.briefings || []), b.id])];
      ctx.avisar(`Nova demanda pela Zoe: ${b.nome} (${c.nome}, +${conv.id}).`, conv, false);
      return { ok: true, briefing: b.id, proximo: "Diga que a equipe monta as opções verificadas em até 24 horas úteis e ofereça buscar_imoveis/agendar." };
    }
    case "registrar_imovel_proprietario": {
      const c = garantirContato(ctx, conv, { nome: inp.nome, perfil: /corretor/i.test(inp.papel || "") ? "Corretor parceiro" : /imobili/i.test(inp.papel || "") ? "Imobiliária" : "Proprietário", creci: inp.creci });
      const o = { id: novoId("o"), criado: agora.toISOString(), atualizado: agora.toISOString(), status: "nova", origem: /corretor/i.test(inp.papel || "") ? "Corretor parceiro" : /imobili/i.test(inp.papel || "") ? "Imobiliária" : "Proprietário",
        anunciante_tipo: /corretor/i.test(inp.papel || "") ? "Corretor" : /imobili/i.test(inp.papel || "") ? "Imobiliária" : "Proprietário", anunciante: c.nome, anunciante_contato: c.telefone, anunciante_creci: limpa(inp.creci, 30),
        tipo: limpa(inp.tipo, 40), operacao: limpa(inp.operacao, 30) || "Venda", cidade: limpa(inp.cidade, 80), regiao: limpa(inp.bairro_regiao, 120), terreno: numS(inp.area_terreno), construida: numS(inp.area_construida), area_ha: numS(inp.area_ha), dormitorios: numS(inp.dormitorios), venda: numS(inp.valor_venda), aluguel: numS(inp.valor_aluguel),
        matricula: limpa(inp.matricula, 40), cartorio: limpa(inp.cartorio, 120), itens: limpa(inp.observacoes, 400), contato_origem: c.id, conversa: conv.id };
      ctx.salvar("ofertas", o.id, o);
      ctx.avisar(`Imóvel oferecido pela Zoe: ${o.tipo} em ${o.cidade} (${c.nome}, +${conv.id}). Está em Ofertas → A revisar.`, conv, false);
      return { ok: true, oferta: o.id, proximo: "Ofereça agendar a Captação no local (horarios_livres → agendar tipo 'Captação no local')." };
    }
    case "horarios_livres": {
      const hs = horariosLivres(cfgZ, agenda(), agora, { dias: Math.max(1, Math.min(14, Number(inp.dias_a_frente) || 7)), turno: inp.turno === "manha" || inp.turno === "tarde" ? inp.turno : null, max: 8 });
      return hs.length ? { horarios: hs.map((d) => ({ inicio: isoLocal(d), texto: fmtData(d) })) } : { horarios: [], orientacao: "Sem horários livres no período: ofereça outro período ou chame a equipe." };
    }
    case "agendar": {
      const ini = lerHorario(inp.inicio); if (!ini) return { erro: "Horário inválido. Use AAAA-MM-DDTHH:MM." };
      const livres = horariosLivres(cfgZ, agenda(), agora, { dias: 21, max: 400 });
      if (!livres.some((d) => d.getTime() === ini.getTime())) return { erro: "Esse horário não está livre. Chame horarios_livres e ofereça outro." };
      const c = garantirContato(ctx, conv, { nome: inp.nome });
      const dur = Number({ ...ZOE_PADRAO.horario, ...(cfgZ.horario || {}) }.duracao) || 60;
      const oferta = inp.codigo_imovel ? ctx.listar("ofertas").find((o) => o.codigo && o.codigo.toUpperCase() === String(inp.codigo_imovel).toUpperCase()) : null;
      const a = { id: novoId("ag"), criado: agora.toISOString(), inicio: isoLocal(ini) + ":00" + TZ, fim: isoLocal(new Date(ini.getTime() + dur * 60e3)) + ":00" + TZ, tipo: limpa(inp.tipo, 40), assunto: limpa(inp.assunto, 200), nome: limpa(inp.nome, 120), contato: c.id, conversa: conv.id, wa: conv.id, oferta: oferta?.id || null, codigo: oferta?.codigo || limpa(inp.codigo_imovel, 12), status: "marcado", criado_por: "Zoe" };
      ctx.salvar("agenda", a.id, a);
      ctx.avisar(`Agendado pela Zoe: ${a.tipo} · ${fmtData(ini)} · ${a.nome} (+${conv.id}) · ${a.assunto}`, conv, true);
      return { ok: true, id: a.id, confirmado: fmtData(ini), proximo: "Confirme ao cliente com dia da semana, data, hora e tipo; diga que receberá a confirmação/link da equipe." };
    }
    case "meus_agendamentos": {
      const ls = agenda().filter((a) => a.wa === conv.id && a.status !== "cancelado" && Date.parse(a.inicio) > agora.getTime());
      return { agendamentos: ls.map((a) => ({ id: a.id, quando: fmtData(new Date(Date.parse(a.inicio))), tipo: a.tipo, assunto: a.assunto })) };
    }
    case "cancelar_agendamento": {
      const a = agenda().find((x) => x.id === inp.id && x.wa === conv.id);
      if (!a) return { erro: "Agendamento não encontrado para este contato." };
      ctx.salvar("agenda", a.id, { ...a, status: "cancelado", cancelado_em: agora.toISOString() });
      ctx.avisar(`Cancelado pelo cliente (Zoe): ${a.tipo} de ${fmtData(new Date(Date.parse(a.inicio)))} · ${a.nome}`, conv, true);
      return { ok: true };
    }
    case "salvar_contato": { const c = garantirContato(ctx, conv, inp); return { ok: true, contato: c.nome }; }
    case "chamar_equipe": {
      conv.precisa_humano = { motivo: limpa(inp.motivo, 200), urgente: !!inp.urgente, em: agora.toISOString() };
      ctx.avisar(`${inp.urgente ? "URGENTE · " : ""}Zoe pede você na conversa com ${conv.nome || "+" + conv.id}: ${limpa(inp.motivo, 200)}`, conv, true);
      return { ok: true, orientacao: "Avise que a equipe foi chamada e responde por aqui. Continue disponível para dúvidas simples." };
    }
    /* ----- equipe ----- */
    case "resumo_operacao": {
      const ofs = ctx.listar("ofertas"); const ng = ctx.listar("negocios"); const hoje = local(agora);
      const ag = agenda().filter((a) => a.status !== "cancelado" && (() => { const l = local(new Date(Date.parse(a.inicio))); return l.y === hoje.y && l.m === hoje.m && l.d === hoje.d; })());
      const convs = ctx.listar("conversas");
      return { briefings_ativos: ctx.listar("briefings").filter((b) => (b.status || "ativo") === "ativo").length, ofertas_a_revisar: ofs.filter((o) => o.status === "nova").length, ofertas_na_base: ofs.filter((o) => o.status !== "descartada").length,
        negocios_por_etapa: Object.fromEntries(PC.ETAPAS.map(([k, l]) => [l, ng.filter((n) => n.etapa === k).length]).filter(([, n]) => n)), conversas_pedem_humano: convs.filter((c) => c.precisa_humano).length,
        agenda_hoje: ag.map((a) => `${fmtData(new Date(Date.parse(a.inicio)))} · ${a.tipo} · ${a.nome}`) };
    }
    case "agenda_periodo": {
      const de = lerHorario((inp.de || isoLocal(agora).slice(0, 10)) + "T00:00"), ate = lerHorario((inp.ate || inp.de || isoLocal(agora).slice(0, 10)) + "T23:59");
      if (!de || !ate) return { erro: "Datas inválidas (AAAA-MM-DD)." };
      return { itens: agenda().filter((a) => a.status !== "cancelado" && Date.parse(a.inicio) >= de.getTime() && Date.parse(a.inicio) <= ate.getTime()).sort((a, b) => a.inicio.localeCompare(b.inicio)).map((a) => `${fmtData(new Date(Date.parse(a.inicio)))} · ${a.tipo} · ${a.nome} · ${a.assunto}${a.codigo ? " · " + a.codigo : ""}`) };
    }
    case "conversas_pendentes": return { conversas: ctx.listar("conversas").filter((c) => c.precisa_humano || (c.ultima_de === "cliente" && c.modo === "humano")).map((c) => `${c.nome || "+" + c.id}: ${c.precisa_humano?.motivo || "aguardando resposta humana"}`) };
    case "verificacao_imovel": {
      const o = ctx.listar("ofertas").find((x) => x.codigo && x.codigo.toUpperCase() === String(inp.codigo || "").toUpperCase());
      return o ? { codigo: o.codigo, titulo: o.titulo || PC.autoTitle(PC.num(o)), resumo: V.resumo(o) } : { erro: "Código não encontrado." };
    }
  }
  return { erro: "Ferramenta desconhecida." };
}
function isoLocal(d) { const l = local(d); return `${l.y}-${String(l.m + 1).padStart(2, "0")}-${String(l.d).padStart(2, "0")}T${String(l.h).padStart(2, "0")}:${String(l.mi).padStart(2, "0")}`; }

/* ---------------- Resposta ---------------- */
/** Separa botões ([[botoes: A | B]]) do texto e limpa o que não pode sair. */
export function finalizar(txt) {
  let t = String(txt || "").trim(); let botoes = [];
  // formato oficial [[botoes: A | B]]; aceita também "[A | B]" no fim (a Zoe às vezes imita o histórico)
  const m = t.match(/\[\[\s*bot[oõ]es\s*:\s*([^\]]+)\]\]\s*$/i) || t.match(/\n\s*\[([^\[\]\n]{1,80}\|[^\[\]\n]{1,80})\]\s*$/);
  if (m) { botoes = m[1].split("|").map((x) => x.trim().slice(0, 20)).filter(Boolean).slice(0, 3); t = t.slice(0, m.index).trim(); }
  t = t.replace(/\[\[[^\]]*\]\]/g, "").trim().slice(0, 1500);
  return { texto: t, botoes };
}

const HUMANO_RE = /^\s*(humano|atendente|pessoa|falar com (uma )?pessoa|falar com (o )?(rodrigo|corretor|joselia))\s*[.!]?\s*$/i;
const SAIR_RE = /^\s*(sair|parar|pare|stop|descadastrar|n[aã]o quero mais (receber )?mensagens?)\s*[.!]?\s*$/i;

/**
 * Processa a conversa e devolve {texto, botoes, acoes}. Não envia nada: quem chama envia (WhatsApp ou simulador).
 * ctx: { listar(col), salvar(col,id,dados), avisar(txt, conv, urgente), agora: Date, base: url, cfg: {zoe, geral}, cliente?: Anthropic }
 */
export async function responder(ctx, conv, { equipe = false } = {}) {
  const ult = [...(conv.msgs || [])].reverse().find((m) => m.de === "cliente");
  const txt = ult?.texto || "";
  if (!equipe && SAIR_RE.test(txt)) { conv.optout = true; return { texto: "Pronto, não enviaremos mais mensagens automáticas. Se precisar, é só escrever. 🙏", botoes: [], acoes: ["optout"] }; }
  if (!equipe && HUMANO_RE.test(txt)) { executar(ctx, conv, "chamar_equipe", { motivo: "Cliente pediu atendimento humano", urgente: false }, false); conv.modo = "humano"; return { texto: "Certo! Já chamei a equipe — uma pessoa continua o atendimento por aqui" + (dentroHorario(ctx) ? " em instantes." : " no próximo horário de atendimento."), botoes: [], acoes: ["chamar_equipe"] }; }

  const client = ctx.cliente || new Anthropic();
  const model = ctx.modelo || MODELO_PADRAO;
  const sistema = promptSistema({ zoe: ctx.cfg.zoe, geral: ctx.cfg.geral, agora: ctx.agora, equipe, contato: contatoDe(ctx, conv), conversa: conv });
  const msgs = [];
  for (const m of (conv.msgs || []).slice(-30)) {
    const role = m.de === "cliente" ? "user" : "assistant"; let content = String(m.texto || (m.midia ? `[${m.midia} enviado]` : "")).slice(0, 2000) || "…";
    if (role === "assistant") content = content.replace(/\n\[([^\[\]\n]+\|[^\[\]\n]+)\]\s*$/, "\n[[botoes: $1]]");
    if (msgs.length && msgs[msgs.length - 1].role === role) msgs[msgs.length - 1].content += "\n" + content; else msgs.push({ role, content });
  }
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  if (!msgs.length) return { texto: "", botoes: [], acoes: [] };
  const tools = equipe ? FERRAMENTAS_EQUIPE : FERRAMENTAS_CLIENTE; const acoes = [];
  const fila = [model, ...MODELOS_RESERVA].filter((x, i, a) => a.indexOf(x) === i);
  const criar = async (body) => { let ult; for (const m of fila) { try { return await client.messages.create({ ...body, model: m }); } catch (e) { ult = e; if (!modeloIndisponivel(e)) throw e; } } throw ult; };
  for (let i = 0; i < 6; i++) {
    const r = await criar({ max_tokens: 900, system: sistema, tools, messages: msgs });
    const usos = (r.content || []).filter((c) => c.type === "tool_use");
    if (!usos.length || r.stop_reason !== "tool_use") {
      const out = finalizar((r.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n"));
      return { ...out, acoes };
    }
    msgs.push({ role: "assistant", content: r.content });
    msgs.push({ role: "user", content: usos.map((u) => { let res; try { res = executar(ctx, conv, u.name, u.input, equipe); } catch (e) { res = { erro: String(e?.message || e) }; } acoes.push(u.name); return { type: "tool_result", tool_use_id: u.id, content: JSON.stringify(res).slice(0, 8000) }; }) });
  }
  executar(ctx, conv, "chamar_equipe", { motivo: "A Zoe não concluiu a resposta (muitas etapas).", urgente: false }, equipe);
  return { texto: "Vou pedir para a equipe confirmar isso e já te respondemos por aqui.", botoes: [], acoes: [...acoes, "chamar_equipe"] };
}
function dentroHorario(ctx) { const H = { ...ZOE_PADRAO.horario, ...(ctx.cfg.zoe?.horario || {}) }; const L = local(ctx.agora); const min = L.h * 60 + L.mi; return H.dias.includes(L.wd) && min >= hm(H.inicio)[0] * 60 + hm(H.inicio)[1] && min < hm(H.fim)[0] * 60 + hm(H.fim)[1]; }

/* ---------------- Conversa: registro de mensagens ---------------- */
export const MAX_MSGS = 150;
export function anexarMsg(conv, m) { conv.msgs = [...(conv.msgs || []), m].slice(-MAX_MSGS); conv.ultima_em = m.t; conv.ultima_de = m.de; return conv; }

/** Normaliza número do WhatsApp para dígitos com DDI (55…). */
export const waNum = (s) => { const d = String(s || "").replace(/\D/g, ""); return d.length === 10 || d.length === 11 ? "55" + d : d; };
