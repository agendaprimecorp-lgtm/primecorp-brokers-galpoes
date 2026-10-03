// Planos, tipos de conta e regras de acesso do Propto (usado no servidor e no app).

export const PLANOS = {
  avulso: { id: "avulso", nome: "Avulso", preco: 49.9, ciclo: "unico", usuarios: 1, captacoes: 1, exigeCreci: false, desc: "1 anúncio completo: roteiro guiado, landing, PDF e exportação. Os arquivos ficam com você." },
  autonomo: { id: "autonomo", nome: "Corretor autônomo", preco: 99.99, ciclo: "mensal", usuarios: 1, captacoes: 30, exigeCreci: true, desc: "Para corretor(a) com CRECI. Até 30 captações por mês." },
  imob5: { id: "imob5", nome: "Imobiliária até 5", preco: 199.99, ciclo: "mensal", usuarios: 5, captacoes: 150, exigeCreci: true, desc: "Imobiliária com CRECI. Até 5 usuários (corretores e captadores), 150 captações por mês." },
  imob10: { id: "imob10", nome: "Imobiliária 6 a 10", preco: 299.99, ciclo: "mensal", usuarios: 10, captacoes: 300, exigeCreci: true, desc: "Imobiliária com CRECI. De 6 a 10 usuários, 300 captações por mês." },
};
export const PLANOS_MENSAIS = ["autonomo", "imob5", "imob10"];
export const CARENCIA_DIAS = 5; // dias de atraso antes do bloqueio

export const TIPOS_CONTA = {
  corretor: { nome: "Corretor(a) autônomo(a)", creci: "PF" },
  imobiliaria: { nome: "Imobiliária", creci: "PJ" },
  proprietario: { nome: "Proprietário(a) / vendedor(a) sem CRECI", creci: null },
};

export const UFS = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"];

/** Normaliza e valida o número do CRECI. PF: só dígitos. PJ: dígitos + "-J". */
export function validarCreci(numero, uf, natureza) {
  const n = String(numero || "").toUpperCase().replace(/\s+/g, "").replace(/^CRECI[-:]?/, "").replace(/^[A-Z]{2}[-:]?(?=\d)/, "");
  if (!UFS.includes(String(uf || "").toUpperCase())) return { ok: false, erro: "Informe a UF do CRECI." };
  const m = n.match(/^(\d{1,7})(?:-?([JF]))?$/);
  if (!m) return { ok: false, erro: "Número do CRECI inválido. Use só os números (PJ: números seguidos de J)." };
  const pj = natureza === "PJ";
  if (pj && m[2] === "F") return { ok: false, erro: "CRECI de imobiliária termina em J." };
  const fmt = `CRECI-${String(uf).toUpperCase()} ${Number(m[1])}${pj ? "-J" : ""}`;
  return { ok: true, numero: String(Number(m[1])) + (pj ? "-J" : ""), uf: String(uf).toUpperCase(), natureza: pj ? "PJ" : "PF", formatado: fmt };
}

/** Estado de acesso de uma conta (dados da conta do dono do plano + uso do mês). */
export function acesso(org, usoMes, agora = new Date(), admin = false) {
  if (admin) return { pode: true, motivo: "admin", restante: Infinity };
  const a = org?.assinatura || {};
  const plano = PLANOS[a.plano];
  const creditos = Number(org?.creditos || 0);
  if (plano && plano.ciclo === "mensal") {
    let st = a.status || "pendente";
    if (st === "atrasada" && a.atrasada_desde) {
      const dias = (agora.getTime() - new Date(a.atrasada_desde).getTime()) / 864e5;
      if (dias > CARENCIA_DIAS) st = "bloqueada";
    }
    if (st === "ativa" || st === "atrasada") {
      const restante = plano.captacoes - (usoMes || 0);
      if (restante <= 0) return { pode: creditos > 0, motivo: creditos > 0 ? "credito" : "limite", plano: plano.id, status: st, restante: 0, creditos };
      return { pode: true, motivo: st === "atrasada" ? "carencia" : "plano", plano: plano.id, status: st, restante, creditos };
    }
    if (creditos > 0) return { pode: true, motivo: "credito", plano: plano.id, status: st, restante: 0, creditos };
    return { pode: false, motivo: st === "bloqueada" ? "bloqueada" : st === "cancelada" ? "cancelada" : "pendente", plano: plano.id, status: st, restante: 0, creditos };
  }
  if (creditos > 0) return { pode: true, motivo: "credito", restante: creditos, creditos };
  return { pode: false, motivo: "sem_plano", restante: 0, creditos };
}

export const MENSAGEM_ACESSO = {
  limite: "Você usou todas as captações do mês no seu plano. Compre um anúncio avulso ou mude de plano.",
  bloqueada: "Acesso bloqueado por falta de pagamento. Seus anúncios e arquivos continuam disponíveis; regularize para captar de novo.",
  cancelada: "Sua assinatura foi cancelada. Seus arquivos continuam disponíveis; assine de novo para captar.",
  pendente: "Aguardando a confirmação do pagamento da assinatura.",
  sem_plano: "Para fazer um novo anúncio, compre o acesso avulso ou assine um plano.",
};
