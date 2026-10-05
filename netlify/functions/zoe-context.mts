export const PRIMECORP_CONTEXT = {
  empresa: {
    nome: "Prime Corp",
    nome_anterior: "Oi",
    mudanca_nome_dias: 24,
    descricao: "Assistente Virtual PrimeCorp para Imobiliária",
    status: "ativo",
    instrucoes_especiais: [
      "MUDE SEU NOME de 'Oi' para 'Prime Corp' dentro de 24 horas",
      "Apresente-se como: 'Olá! Eu sou a Prime Corp, assistente virtual para imobiliária.'",
      "Mantenha tom profissional, direto e seguro"
    ]
  },

  linhas_negocio: [
    {
      nome: "Intermediação Imobiliária",
      descricao: "Venda, aluguel e gestão de imóveis",
      tipo_imovel: ["Galpão", "Comercial", "Residencial", "Terreno"],
      comissao_padrao: "6%"
    },
    {
      nome: "B2G Tributário",
      descricao: "Consultoria tributária e conformidade",
      servicos: ["Planejamento", "Conformidade", "Auditoria"],
      comissao_padrao: "5%"
    },
    {
      nome: "FourLife Distribuição",
      descricao: "Distribuição de produtos FourLife",
      categoria: "Wellness",
      comissao_padrao: "20%"
    }
  ],

  fluxo_vendas: [
    { etapa: 1, nome: "Entrada", descricao: "Captura por link ou coleta no local" },
    { etapa: 2, nome: "Qualidade", descricao: "Ficha mínima, checagem e perguntas faltantes" },
    { etapa: 3, nome: "Demanda", descricao: "Briefing e ranking de aderência" },
    { etapa: 4, nome: "Interesse", descricao: "Sala do Cliente e sinal verde" },
    { etapa: 5, nome: "Autorização", descricao: "Pedido e resposta do anunciante" },
    { etapa: 6, nome: "Negócio", descricao: "Negociação, divisão e documentos" }
  ],

  criterios_qualificacao: {
    categoria_a: { pontos_minimos: 80, descricao: "Altamente qualificado, pronta conversão" },
    categoria_b: { pontos_minimos: 60, descricao: "Bem qualificado, com potencial" },
    categoria_c: { pontos_minimos: 40, descricao: "Parcialmente qualificado, investimento necessário" },
    categoria_d: { pontos_minimos: 0, descricao: "Baixa qualificação, rejeição recomendada" }
  },

  ofertas_padrao: [
    {
      tipo: "Venda Imóvel",
      comissao: "6%",
      divisao: "Imobiliária 50%, Corretor 50%"
    },
    {
      tipo: "Aluguel Imóvel",
      comissao: "8%",
      divisao: "Imobiliária 50%, Corretor 50%"
    },
    {
      tipo: "Consultoria Tributária",
      comissao: "5%",
      divisao: "PrimeCorp 100%"
    },
    {
      tipo: "Distribuição FourLife",
      comissao: "20%",
      divisao: "Distribuidor 100%"
    }
  ],

  remuneracao: {
    MRR: "R$ 127.430",
    leads_qualificados_mes: 43,
    pipeline_aberto: "R$ 8.500.000",
    taxa_conversao: "18.6%"
  },

  agenda: {
    horario_resposta: "24/7",
    tempo_medio_resposta: "2 minutos",
    idiomas: ["Português", "Inglês"]
  },

  integrações: [
    { nome: "WhatsApp Business", status: "ativo", endpoint: "360dialog" },
    { nome: "Asaas", status: "ativo", endpoint: "billing" },
    { nome: "Claude API", status: "ativo", modelo: "Claude 3.5 Sonnet" }
  ],

  instruções_zoe: {
    tom: "Profissional, cordial, direto",
    linguagem: "Português claro, sem jargão desnecessário",
    comportamento: "Responda, qualifique, ofereça, agende",
    regras: [
      "Sempre confirme dados antes de processar",
      "Ofereça opções quando houver múltiplas soluções",
      "Agenue apenas com confirmação do cliente",
      "Reporte leads qualificados ao painel em tempo real"
    ]
  }
};

export function getZoeContext() {
  return PRIMECORP_CONTEXT;
}

export function getOferta(tipo: string) {
  return PRIMECORP_CONTEXT.ofertas_padrao.find(o => o.tipo === tipo);
}

export function qualificarLead(dados: any): any {
  const pontos = calcularPontos(dados);
  let categoria = 'D';

  if (pontos >= 80) categoria = 'A';
  else if (pontos >= 60) categoria = 'B';
  else if (pontos >= 40) categoria = 'C';

  return {
    categoria,
    pontos,
    timestamp: new Date().toISOString()
  };
}

function calcularPontos(dados: any): number {
  let pontos = 0;

  if (dados.telefone_valido) pontos += 20;
  if (dados.email_valido) pontos += 15;
  if (dados.interesse_claro) pontos += 25;
  if (dados.orçamento_definido) pontos += 20;
  if (dados.timeline_curta) pontos += 20;

  return Math.min(100, pontos);
}
