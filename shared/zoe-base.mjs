// Conhecimento padrão da Zoe (compartilhado entre o app e o servidor; sem dependências de servidor).
import PC from "./core.mjs";

/* ---------------- Base de conhecimento padrão (editável em Mais → Zoe) ---------------- */
export const ZOE_PADRAO = {
  ativa: true,
  nome: "PrimeCorp",
  quem_somos: `PrimeCorp Brokers — intermediação imobiliária com tecnologia própria. Atendimento de Rodrigo França Viana (corretor de imóveis, CRECI-SP 297692) e equipe, sediados em Sumaré/SP, com foco na Região Metropolitana de Campinas e atendimento em todo o Brasil por parceria.
Lema: unimos oferta e procura. Cada imóvel apresentado passa por checagem de dados e verificação documental (matrícula, cadastro, proprietário e ônus) antes de chegar ao cliente.`,
  servicos: `1) BUSCA SOB MEDIDA (empresas, investidores e famílias): locação e compra de galpões, áreas industriais e comerciais, terrenos, salas, lojas, casas, apartamentos, sítios e fazendas. O cliente informa a necessidade; em até 24 horas úteis recebe opções classificadas e verificadas numa Sala do Cliente (link privado, com termo de confidencialidade).
2) PROPRIETÁRIOS: venda ou locação do imóvel com captação no local (fotos tratadas, descrição, anúncio com link próprio), verificação documental e apresentação a compradores/locatários qualificados da nossa base. Honorários padrão: {{COMISSAO_VENDA}} na venda e {{COMISSAO_LOCACAO}} na locação, combinados por escrito antes de qualquer divulgação.
3) PARCERIAS COM CORRETORES E IMOBILIÁRIAS: quem tem o cliente ou o imóvel faz parceria conosco; a divisão de honorários é formalizada em acordo assinado por todas as partes antes da apresentação.
4) CONSULTORIA PARA PREFEITURAS E ÓRGÃOS PÚBLICOS (PrimeCorp Consultoria): recuperação de créditos tributários e previdenciários de municípios, com remuneração por êxito. Tratado diretamente com Rodrigo em reunião.`,
  faq: `- Atendemos a Região Metropolitana de Campinas (Campinas, Sumaré, Hortolândia, Americana, Indaiatuba, Nova Odessa, Monte Mor, Paulínia, Santa Bárbara d'Oeste) e outras regiões por parceria.
- Endereço exato dos imóveis só é informado depois do termo de confidencialidade/visita agendada.
- Para visitar: agendamos dia e horário com o responsável; levar documento com foto.
- Para alugar galpão/comercial a empresa costuma apresentar: contrato social, cartão CNPJ, balanço/DRE recente e garantia (seguro-fiança, caução, fiança bancária ou título de capitalização) — a lista final é do proprietário.
- SAC (dúvidas, sugestões e reclamações): ${PC.SAC}.`,
  tributario: `PRIMECORP CONSULTORIA — RECUPERAÇÃO DE CRÉDITOS PARA MUNICÍPIOS E ESTADOS (B2G)
O que fazemos: diagnóstico e recuperação de créditos tributários, previdenciários e de repasses de prefeituras, câmaras, autarquias e estados, com atuação administrativa e/ou judicial conduzida por equipe técnica e jurídica parceira.
Remuneração: exclusivamente por êxito (percentual sobre o valor efetivamente recuperado/compensado). Sem custo antecipado para o ente. Análise inicial sem custo.
Contratação pública: o ente contrata seguindo a Lei 14.133/2021 (o enquadramento — inexigibilidade, dispensa ou licitação — é decidido pela própria administração; temos modelos de Termo de Referência, minuta de contrato por êxito e parecer de apoio).
Frentes de análise (cada caso depende de diagnóstico; nunca prometer resultado):
- IRRF: imposto de renda retido na fonte pelo município/estado sobre pagamentos a pessoas físicas e jurídicas (tema 1130 do STF).
- PASEP: revisão da base de cálculo e de recolhimentos indevidos.
- RAT/FAP: revisão do grau de risco e do fator previdenciário sobre a folha do regime geral.
- ISSQN: revisão de arrecadação e de repasses do imposto.
- FGTS: revisão de recolhimentos de servidores celetistas.
- FPM/FPE: conferência de cotas e diferenças de repasse.
Como começa: 1) reunião de apresentação (online, 30 a 60 min) com Rodrigo; 2) envio de documentos para o diagnóstico (lista passada pela equipe após a reunião); 3) relatório de diagnóstico com as oportunidades; 4) contratação pelo ente e execução.
Fluxo praticado com os parceiros (reservas): 1) o parceiro pergunta pelo município/estado/consórcio — se já está na carteira da PrimeCorp, a resposta é "reservado"; se não está, nunca se diz "livre": o parceiro solicita a reserva e a equipe consulta a central de reservas; 2) confirmada na central, a equipe libera por 90 dias (exclusividade daquele parceiro no ente), prorrogável pela equipe quando há andamento; ente reservado por outro parceiro não pode ser trabalhado; 3) o parceiro marca a reunião (meet) do ente com a equipe técnica da PrimeCorp — participam normalmente prefeito, secretário de finanças, procurador ou controle interno; 4) proposta enviada ao ente por e-mail; 5) apoio à contratação: termo de referência, minuta de contrato e roteiro de contratação para o jurídico do ente (inexigibilidade ou licitação); em alguns casos pede-se procuração e-CAC para análise preliminar; 6) contratado → onboarding e envio de documentos. Etapas no sistema: Prospecção → Contato iniciado → Proposta enviada → Contratado. Consórcios e associações de municípios (ex.: consórcios intermunicipais) também podem ser reservados.
Canal de indicação: qualquer pessoa pode indicar seu estado ou município para análise inicial sem custo.
PARCEIROS (consultores, advogados, contadores, assessores e captadores com relacionamento com gestores públicos): o parceiro indica e acompanha o ente; a PrimeCorp conduz diagnóstico, proposta e execução. A remuneração do parceiro é por êxito, proporcional ao recebido pela PrimeCorp, e formalizada em contrato de parceria antes de qualquer apresentação. Percentuais e condições só a equipe informa.`,
  regras_extra: "",
  horario: { dias: [1, 2, 3, 4, 5], inicio: "09:00", fim: "18:00", fim_dia: { 5: "16:00" }, duracao: 60, antecedencia_h: 3, sabado_ate: "" }, // seg–qui 9–18, sex 9–16, fim de semana fechado
  local_reuniao: "Videochamada (link enviado na confirmação) ou presencial combinado com o corretor",
  saudacao_fora_horario: true,
};

