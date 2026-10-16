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
4) IMÓVEIS (PrimeCorp Brokers, CRECI-SP 297692 e 300760): fazendas e áreas rurais, galpões e ativos logísticos, salas, lajes e pontos comerciais, terrenos e glebas para incorporação, residenciais, e imóveis em espólio, permuta e dação (com assessoria jurídica parceira). Documentação conferida antes da proposta; divulgação aberta ou reservada; corretagem só quando o negócio se concretiza (Lei 6.530/1978 e arts. 722 a 729 do CC).`,
  faq: `- Atendemos a Região Metropolitana de Campinas (Campinas, Sumaré, Hortolândia, Americana, Indaiatuba, Nova Odessa, Monte Mor, Paulínia, Santa Bárbara d'Oeste) e outras regiões por parceria.
- Endereço exato dos imóveis só é informado depois do termo de confidencialidade/visita agendada.
- Para visitar: agendamos dia e horário com o responsável; levar documento com foto.
- Para alugar galpão/comercial a empresa costuma apresentar: contrato social, cartão CNPJ, balanço/DRE recente e garantia (seguro-fiança, caução, fiança bancária ou título de capitalização) — a lista final é do proprietário.
- SAC (dúvidas, sugestões e reclamações): ${PC.SAC}.`,
  institucional: `PRIMECORP BROKERS — intermediação imobiliária · CNPJ 55.745.297/0001-06 · CRECI-SP 297692 e 300760 · Rua Maria Elisabeth Menuzzo, 87 — Parque Virgílio Viel, Sumaré/SP · telefone fixo (19) 2210-2894 · contato@ e comercial@primecorpconsultoria.com.br · Instagram @primecorpbrokers.
Corretor responsável: Rodrigo França Viana (CRECI-SP 297692). Atendimento de Rodrigo e equipe, com a plataforma Propto (captação e verificação de imóveis para corretores e imobiliárias).
A assistente organiza o atendimento e agenda reuniões; quem responde pelo negócio é o corretor responsável.`,
  regras_extra: "",
  horario: { dias: [1, 2, 3, 4, 5], inicio: "09:00", fim: "18:00", fim_dia: { 5: "16:00" }, duracao: 60, antecedencia_h: 3, sabado_ate: "" }, // seg–qui 9–18, sex 9–16, fim de semana fechado
  local_reuniao: "Videochamada (link enviado na confirmação) ou presencial combinado com o corretor",
  saudacao_fora_horario: true,
};

