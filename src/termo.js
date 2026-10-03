/* ===== Documentos jurídicos padrão PrimeCorp Brokers (v2 · out/2026) =====
   Variáveis {{…}} são preenchidas pelo sistema. Os PRAZOS e o FORO vêm de Mais → Configurações
   (preenchimento manual); enquanto algum estiver vazio, o documento não é emitido.
   Base legal: Código Civil, arts. 722 a 729 (corretagem); Lei nº 6.530/1978 e Decreto nº 81.871/1978
   (profissão de corretor); Resolução COFECI nº 326/1992 (Código de Ética); Lei nº 8.245/1991, art. 22, VII
   (locação: intermediação a cargo do locador); Lei nº 13.709/2018 (LGPD); MP nº 2.200-2/2001, art. 10, § 2º. */

export const VERSAO_DOCS = "v2 · out/2026";
export const PRAZOS = [
  ["prazo_cliente", "PRAZO_CLIENTE", "Não-contorno do cliente (Sala do Cliente)", "meses"],
  ["prazo_indicacao", "PRAZO_INDICACAO", "Validade da indicação na parceria com imobiliária/corretor", "meses"],
  ["prazo_repasse", "PRAZO_REPASSE", "Repasse dos honorários entre as partes", "dias úteis"],
  ["prazo_nao_contorno", "PRAZO_NAO_CONTORNO", "Não-contorno entre as partes do negócio", "meses"],
  ["prazo_autorizacao", "PRAZO_AUTORIZACAO", "Vigência da autorização do proprietário", "dias"],
  ["prazo_pos_autorizacao", "PRAZO_POS_AUTORIZACAO", "Honorários garantidos após o fim da autorização", "meses"],
  ["prazo_mandato", "PRAZO_MANDATO", "Vigência do mandato de busca com o cliente", "dias"],
];
export const CORRETOR_PADRAO = "RODRIGO FRANÇA VIANA, corretor de imóveis inscrito no CRECI-SP sob o nº 297692";

export const TERMO_VERSAO = VERSAO_DOCS;
export const TERMO_PADRAO = `TERMO DE APRESENTAÇÃO DE IMÓVEIS, CONFIDENCIALIDADE E NÃO-CONTORNO

Pelo presente termo, a pessoa física ou jurídica identificada no cadastro desta página ("INTERESSADO") declara que recebe de {{CORRETOR}}, que atua sob a marca PrimeCorp Brokers ("CORRETOR"), a apresentação de opções de imóveis selecionadas para a sua demanda, e se obriga nos seguintes termos:

1. IMÓVEIS APRESENTADOS. Consideram-se "Imóveis Apresentados" as opções exibidas nesta sala, identificadas pelos códigos PrimeCorp (PC-0000), bem como qualquer imóvel sobre o qual o CORRETOR venha a fornecer, a partir deste aceite, endereço, fotos, documentos, contatos ou outras informações ("Informações Confidenciais").

2. CONFIDENCIALIDADE. O INTERESSADO usará as Informações Confidenciais apenas para avaliar a sua própria demanda e não as repassará a terceiros, exceto a sócios, empregados e assessores que precisem conhecê-las e que fiquem sujeitos ao mesmo dever de sigilo.

3. NÃO-CONTORNO. Pelo prazo de {{PRAZO_CLIENTE}} contados deste aceite, o INTERESSADO não negociará, direta ou indiretamente, por si, por empresas do mesmo grupo, por sócios ou por outro intermediário, a locação, a compra ou qualquer outra forma de ocupação dos Imóveis Apresentados sem a participação do CORRETOR.

4. REMUNERAÇÃO. A remuneração da intermediação é paga por quem a contratou com o CORRETOR ou com o intermediário do imóvel, conforme o caso, e na locação cabe ao locador (Lei nº 8.245/1991, art. 22, VII). Se o INTERESSADO descumprir o item 3, concluindo negócio sobre Imóvel Apresentado sem a participação do CORRETOR, pagará a ele, a título de perdas e danos pré-fixadas, o valor equivalente à remuneração que lhe seria devida, fixada em {{COMISSAO_VENDA}} do valor da venda ou em {{COMISSAO_LOCACAO}}, no caso de locação (Código Civil, arts. 725 e 727).

5. IMÓVEL JÁ CONHECIDO. Se o INTERESSADO já negociava algum dos Imóveis Apresentados antes deste aceite, deverá informar o CORRETOR por escrito, com comprovação, em até 2 (dois) dias úteis contados do recebimento. Sem essa comunicação, o imóvel será considerado apresentado pelo CORRETOR.

6. NATUREZA DAS INFORMAÇÕES. As informações têm caráter preliminar, provêm de fontes de mercado e estão sujeitas a confirmação em vistoria e na documentação do imóvel. Não constituem oferta vinculante de quem detém o imóvel.

7. VISITAS E PROPOSTAS. As visitas serão agendadas e acompanhadas pelo CORRETOR e registradas em ficha de visita. Propostas e contrapropostas sobre os Imóveis Apresentados serão encaminhadas por intermédio do CORRETOR.

8. DADOS PESSOAIS. Os dados deste cadastro serão tratados pelo CORRETOR para identificar o INTERESSADO, registrar este aceite e conduzir a intermediação, com fundamento no art. 7º, incisos V e VI, da Lei nº 13.709/2018 (LGPD). O titular pode pedir informações, correção ou eliminação pelo e-mail contato@primecorpconsultoria.com.br, observados os prazos legais de guarda.

9. ACEITE ELETRÔNICO. O aceite deste termo, registrado com data, hora, endereço IP e dados do cadastro, vale como manifestação de vontade das partes, nos termos do art. 10, § 2º, da Medida Provisória nº 2.200-2/2001.

10. FORO. Fica eleito o foro da comarca de {{FORO}} para dirimir questões decorrentes deste termo.`;

/* ===== Termos ao anunciante ===== */
export const AUT_VERSAO = VERSAO_DOCS;

// Anunciante é imobiliária ou corretor: parceria com divisão de honorários
export const AUT_PARCERIA = `TERMO DE PARCERIA E AUTORIZAÇÃO DE INDICAÇÃO

Pelo presente termo, a imobiliária ou o corretor identificado abaixo ("ANUNCIANTE") e {{CORRETOR}}, que atua sob a marca PrimeCorp Brokers ("CORRETOR INDICADOR"), ajustam o seguinte:

1. OBJETO. O ANUNCIANTE autoriza o CORRETOR INDICADOR a apresentar o imóvel identificado pela referência {{CODIGO}} ({{TITULO}}), para {{OPERACAO}}, a clientes interessados, sem exclusividade e sem anúncio público, nos termos do art. 20, III, da Lei nº 6.530/1978.

2. INFORMAÇÕES E PODERES. O ANUNCIANTE declara que as informações do imóvel prestadas neste documento correspondem às de que dispõe e que está autorizado por escrito pelo proprietário a intermediar o negócio.

3. INDICAÇÃO. Cada cliente indicado será identificado ao ANUNCIANTE por escrito (mensagem eletrônica basta) antes da visita. Considera-se indicado pelo CORRETOR INDICADOR o cliente assim identificado que concluir negócio sobre o imóvel no prazo de {{PRAZO_INDICACAO}} contados da identificação, ainda que o negócio se conclua sem a participação dele (Código Civil, art. 727).

4. HONORÁRIOS. Os honorários de intermediação são de {{COMISSAO}}, devidos pelo proprietário conforme o contrato que mantém com o ANUNCIANTE. Em negócio concluído com cliente indicado, os honorários serão divididos assim: {{QUADRO}}, sem acréscimo ao valor total (Código Civil, art. 728).

5. FORMA DE PAGAMENTO. Sempre que possível, o contrato do negócio (locação, compromisso ou escritura) indicará o pagamento direto, pelo proprietário, da parcela de cada parte. Não sendo possível, o ANUNCIANTE repassará a parte do CORRETOR INDICADOR em até {{PRAZO_REPASSE}} do recebimento, mediante recibo ou documento fiscal.

6. NÃO-CONTORNO. Pelo prazo do item 3, as partes não negociarão diretamente com o cliente ou com o proprietário apresentado pela outra parte, para este imóvel, sem a participação dela.

7. CRECI E ÉTICA. As partes declaram inscrição regular no Conselho Regional de Corretores de Imóveis, condição para a divisão de honorários, e se obrigam ao Código de Ética Profissional (Resolução COFECI nº 326/1992).

8. DADOS PESSOAIS. Os dados deste documento serão usados apenas para identificar as partes e conduzir a intermediação (Lei nº 13.709/2018, art. 7º, V).

9. ACEITE ELETRÔNICO. O aceite eletrônico, registrado com data, hora, endereço IP e os dados de identificação, vale como manifestação de vontade das partes (MP nº 2.200-2/2001, art. 10, § 2º).

10. FORO. Fica eleito o foro da comarca de {{FORO}}.`;

// Anunciante é o próprio proprietário: autorização de intermediação sem exclusividade
export const AUT_PROPRIETARIO = `AUTORIZAÇÃO DE INTERMEDIAÇÃO E DIVULGAÇÃO SEM EXCLUSIVIDADE

Pelo presente termo, o proprietário ou o representante legal identificado abaixo ("PROPRIETÁRIO") autoriza {{CORRETOR}}, que atua sob a marca PrimeCorp Brokers ("CORRETOR"), nas seguintes condições:

1. OBJETO. O CORRETOR fica autorizado a intermediar e a divulgar, inclusive em página própria na internet e por mensagens a clientes, o imóvel identificado pela referência {{CODIGO}} ({{TITULO}}), para {{OPERACAO}}, sem exclusividade, pelo prazo de {{PRAZO_AUTORIZACAO}} contados deste aceite (Lei nº 6.530/1978, art. 20, III). O endereço completo só será informado a interessados identificados, no agendamento de visita.

2. CONDIÇÕES. Valor pretendido: {{VALOR}}. Propostas recebidas serão encaminhadas por escrito ao PROPRIETÁRIO, a quem cabe aceitá-las ou não.

3. HONORÁRIOS. Concluído negócio com cliente apresentado pelo CORRETOR durante a autorização, ou em até {{PRAZO_POS_AUTORIZACAO}} após o seu término com cliente apresentado durante ela, o PROPRIETÁRIO pagará honorários de {{COMISSAO}} (Código Civil, arts. 725 e 727), devidos na assinatura do contrato de locação ou do compromisso de compra e venda. Quando houver corretor parceiro, a divisão será: {{QUADRO}}, sem acréscimo ao valor total, e o PROPRIETÁRIO poderá pagar diretamente a cada parte.

4. DECLARAÇÕES. O PROPRIETÁRIO declara ter poderes para autorizar a intermediação, que as informações e as fotos do imóvel podem ser divulgadas e que as informações prestadas são verdadeiras, comprometendo-se a informar ao CORRETOR qualquer ônus, pendência ou alteração de disponibilidade.

5. DADOS PESSOAIS. Os dados deste documento serão usados apenas para identificar as partes e conduzir a intermediação (Lei nº 13.709/2018, art. 7º, V).

6. ACEITE ELETRÔNICO. O aceite eletrônico, registrado com data, hora, endereço IP e os dados de identificação, vale como manifestação de vontade das partes (MP nº 2.200-2/2001, art. 10, § 2º).

7. FORO. Fica eleito o foro da comarca de {{FORO}}.`;

/* ===== Acordo de divisão de honorários entre as partes do negócio (2, 3 ou mais) ===== */
export const ACORDO_VERSAO = VERSAO_DOCS;
export const ACORDO_PADRAO = `ACORDO DE DIVISÃO DE HONORÁRIOS DE INTERMEDIAÇÃO

As partes identificadas no quadro de divisão, corretores de imóveis e imobiliárias inscritos no Conselho Regional de Corretores de Imóveis, ajustam a divisão dos honorários do negócio abaixo:

1. NEGÓCIO. {{OPERACAO}} do imóvel referência {{CODIGO}} ({{TITULO}}) ao cliente {{CLIENTE}}, apresentado por {{CORRETOR}}, que atua sob a marca PrimeCorp Brokers.

2. HONORÁRIOS. Os honorários totais são de {{COMISSAO}}, calculados sobre o valor efetivamente contratado. Valor de referência: {{VALOR}}; honorários estimados: {{TOTAL}}.

3. DIVISÃO. {{QUADRO}}. Os percentuais incidem sobre os honorários efetivamente pagos (Código Civil, art. 728). Cada parte responde pelos tributos sobre a sua própria parcela e emite o seu próprio recibo ou documento fiscal.

4. FORMA DE PAGAMENTO. Preferencialmente, o contrato do negócio trará cláusula de pagamento direto, pelo pagador, da parcela de cada parte. Não sendo possível, {{RECEBEDOR}} receberá os honorários e repassará a cada parte o seu percentual em até {{PRAZO_REPASSE}} do recebimento, mediante recibo ou documento fiscal da parte, respondendo pelo valor recebido e não repassado.

5. CONDIÇÃO. Os honorários são devidos com a conclusão do negócio: assinatura do contrato de locação ou do compromisso ou escritura de compra e venda (Código Civil, art. 725). Sem conclusão, nenhuma parte tem direito a honorários deste negócio.

6. NÃO-CONTORNO. Pelo prazo de {{PRAZO_NAO_CONTORNO}} contados deste acordo, nenhuma parte negociará o imóvel com o cliente indicado, direta ou indiretamente, sem a participação das demais.

7. CONFIDENCIALIDADE E DADOS PESSOAIS. As partes manterão em sigilo os dados do cliente e do negócio e os usarão apenas para esta intermediação (Lei nº 13.709/2018).

8. ÉTICA. As partes se obrigam ao Código de Ética Profissional dos Corretores de Imóveis (Resolução COFECI nº 326/1992).

9. ACEITE. Este acordo pode ser assinado fisicamente ou por meio eletrônico, que vale como manifestação de vontade das partes (MP nº 2.200-2/2001, art. 10, § 2º).

10. FORO. Fica eleito o foro da comarca de {{FORO}}.`;

/* ===== Ficha de visita (prova da apresentação) ===== */
export const VISITA_PADRAO = `FICHA DE VISITA A IMÓVEL

O(A) visitante identificado(a) abaixo ("VISITANTE") declara que, na data indicada, visitou o(s) imóvel(is) relacionado(s) neste documento, apresentado(s) e acompanhado(s) por {{CORRETOR}}, que atua sob a marca PrimeCorp Brokers ("CORRETOR"), e que:

1. O(s) imóvel(is) e seus dados lhe foram apresentados pelo CORRETOR, que não lhe era(m) previamente conhecido(s) pela mesma oferta.

2. Qualquer proposta ou negociação sobre o(s) imóvel(is) será feita por intermédio do CORRETOR. Concluído negócio sobre imóvel visitado no prazo de {{PRAZO_CLIENTE}} desta visita, ainda que sem a participação do CORRETOR, fica caracterizada a intermediação, com a remuneração devida nos termos dos arts. 725 e 727 do Código Civil.

3. As informações prestadas são preliminares e sujeitas à confirmação na documentação do imóvel.

4. Os dados desta ficha serão usados apenas para registrar a visita e conduzir a intermediação (Lei nº 13.709/2018, art. 7º, V).`;

/* ===== Recibo de honorários (emitido por quem recebe) ===== */
export const RECIBO_PADRAO = `RECIBO DE HONORÁRIOS DE INTERMEDIAÇÃO IMOBILIÁRIA

Recebi de {{PAGADOR}} a importância de {{VALOR_RECIBO}} ({{VALOR_EXTENSO}}), referente à minha parcela dos honorários de intermediação da {{OPERACAO}} do imóvel referência {{CODIGO}} ({{TITULO}}), correspondente a {{PCT}} dos honorários totais de {{TOTAL}}, conforme acordo de divisão de honorários entre as partes.

Pelo que dou plena e geral quitação quanto a esta parcela, sem prejuízo das parcelas devidas às demais partes do negócio.`;

/* ===== Cláusula de pagamento direto (para inserir no contrato do negócio) ===== */
export const CLAUSULA_SPLIT = `CLÁUSULA – DA REMUNERAÇÃO DA INTERMEDIAÇÃO

O(A) {{PAGADOR_PAPEL}} pagará os honorários de intermediação imobiliária deste negócio, no valor total de {{TOTAL}} ({{TOTAL_EXTENSO}}), {{MOMENTO}}, diretamente a cada intermediário, na forma abaixo:

{{LINHAS_SPLIT}}

Parágrafo primeiro. Cada intermediário dará quitação da sua parcela e emitirá ao pagador o respectivo recibo ou documento fiscal. O pagamento a um intermediário não quita a parcela dos demais.

Parágrafo segundo. Os honorários são devidos em razão da conclusão do negócio por intermédio das partes acima (Código Civil, arts. 722 a 728), não sendo restituíveis em caso de arrependimento das partes (art. 725).`;

/* ===== Mandato de busca (cliente que contrata a PrimeCorp para encontrar imóvel) ===== */
export const MANDATO_PADRAO = `CONTRATO DE INTERMEDIAÇÃO IMOBILIÁRIA PARA BUSCA DE IMÓVEL (MANDATO DE BUSCA)

CONTRATANTE: a pessoa física ou jurídica identificada abaixo ("CLIENTE").
CONTRATADO: {{CORRETOR}}, que atua sob a marca PrimeCorp Brokers ("CORRETOR").

1. OBJETO. O CLIENTE contrata o CORRETOR para pesquisar, selecionar, verificar e apresentar imóveis aderentes à demanda descrita no briefing anexo, e para assessorá-lo na negociação, para {{OPERACAO}} (Código Civil, arts. 722 a 729).

2. PRAZO E EXCLUSIVIDADE. Este contrato vigora por {{PRAZO_MANDATO}} da assinatura. Se assinalada a opção de exclusividade, durante a vigência o CLIENTE não contratará outro intermediário para a mesma demanda (Código Civil, art. 726).

3. REMUNERAÇÃO. (a) Na compra, quando o vendedor ou o intermediário dele pagar os honorários, nada será devido pelo CLIENTE ao CORRETOR. Não havendo esse pagamento, o CLIENTE pagará honorários de {{COMISSAO_VENDA}} do valor da compra, na assinatura do compromisso ou da escritura. (b) Na locação, a remuneração da intermediação cabe ao locador (Lei nº 8.245/1991, art. 22, VII), e nada será cobrado do CLIENTE a esse título. (c) Serviços de consultoria pedidos à parte (estudo de localização, viabilidade ou portfólio) serão remunerados conforme proposta escrita específica.

4. RESULTADO. A remuneração é devida com a conclusão do negócio sobre imóvel apresentado pelo CORRETOR durante a vigência, ou em até {{PRAZO_POS_AUTORIZACAO}} após o término, ainda que concluído sem a participação dele (Código Civil, arts. 725 e 727).

5. OBRIGAÇÕES DO CORRETOR. Executar a busca com diligência e prudência, prestar ao CLIENTE as informações sobre o andamento e sobre riscos do negócio de que tenha conhecimento (Código Civil, art. 723), e manter sigilo sobre a demanda.

6. TRANSPARÊNCIA. O CORRETOR declarará por escrito ao CLIENTE qualquer remuneração que receba de terceiros relacionada ao negócio.

7. DADOS PESSOAIS. Os dados serão tratados apenas para a execução deste contrato (Lei nº 13.709/2018, art. 7º, V).

8. FORO. Fica eleito o foro da comarca de {{FORO}}.`;

/* ===== Utilidades: número por extenso e preenchimento ===== */
const UN = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const DZ = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CT = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];
function ate999(n) {
  if (n === 100) return "cem";
  const c = Math.floor(n / 100), r = n % 100, p = [];
  if (c) p.push(CT[c]);
  if (r) p.push(r < 20 ? UN[r] : DZ[Math.floor(r / 10)] + (r % 10 ? " e " + UN[r % 10] : ""));
  return p.join(" e ");
}
export function extenso(n) {
  n = Math.floor(Math.abs(Number(n) || 0));
  if (n === 0) return "zero";
  const grupos = [["", ""], ["mil", "mil"], ["milhão", "milhões"], ["bilhão", "bilhões"]];
  const partes = []; let i = 0;
  while (n > 0 && i < grupos.length) {
    const g = n % 1000;
    if (g) { const txt = i === 1 && g === 1 ? "mil" : ate999(g) + (i ? " " + (g === 1 ? grupos[i][0] : grupos[i][1]) : ""); partes.unshift({ txt, g, i }); }
    n = Math.floor(n / 1000); i++;
  }
  return partes.map((p, k) => (k === 0 ? "" : (k === partes.length - 1 && (p.g < 100 || p.g % 100 === 0) ? " e " : ", ")) + p.txt).join("");
}
export function reaisExtenso(v) {
  const t = Math.round((Number(v) || 0) * 100); const r = Math.floor(t / 100), c = t % 100;
  const mil = r >= 1e6 && r % 1e6 === 0 ? " de" : "";
  const sr = r ? extenso(r) + mil + (r === 1 ? " real" : " reais") : "";
  const sc = c ? extenso(c) + (c === 1 ? " centavo" : " centavos") : "";
  return [sr, sc].filter(Boolean).join(" e ") || "zero reais";
}
/** "90" + "dias" → "90 (noventa) dias". */
export function prazoTexto(v, unidade) {
  const n = Math.floor(Number(String(v || "").replace(/\D/g, "")));
  if (!n) return "";
  const u = n === 1 ? ({ meses: "mês", dias: "dia", "dias úteis": "dia útil" }[unidade] || unidade) : unidade;
  return `${n} (${extenso(n)}) ${u}`;
}
/** Variáveis de prazo e foro a partir da configuração. */
export function varsPrazos(cfg) {
  const v = {};
  PRAZOS.forEach(([k, VAR, , un]) => { const t = prazoTexto(cfg[k], un); if (t) v[VAR] = t; });
  if (String(cfg.foro || "").trim()) v.FORO = String(cfg.foro).trim();
  return v;
}
/** Campos que ainda faltam num texto já preenchido. */
export const pendencias = (txt) => [...new Set((String(txt).match(/\{\{[A-Z_]+\}\}|\[__\]?/g) || []))];
