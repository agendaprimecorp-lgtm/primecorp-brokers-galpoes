// Frente tributária (B2G): parceiros, reservas de municípios/estados e solicitações, importados do PrimeGov.
// Nada aqui expõe parceiro a terceiros: disponibilidade diz só "livre" ou "reservado até".

export const STATUS_B2G = { prospec: "Prospecção", contato: "Contato iniciado", proposta: "Proposta enviada", contratado: "Contratado" };
export const RESERVA_DIAS = 90; // prazo usual de reserva praticado no PrimeGov

export const semAcento = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
/** Telefones do cadastro (formatos variados) → números WhatsApp com DDI. */
export function telefones(t) {
  return String(t || "").split(/[\/;,|]/).map((x) => x.replace(/\D/g, "")).filter((d) => d.length >= 10).map((d) => (d.length === 10 || d.length === 11 ? "55" + d : d));
}
/** Variante sem/com o 9 (o WhatsApp às vezes entrega números antigos sem o 9). */
const variantes = (wa) => { const d = String(wa || "").replace(/\D/g, ""); const out = new Set([d]); const m = d.match(/^55(\d{2})(9?)(\d{8})$/); if (m) { out.add(`55${m[1]}9${m[3]}`); out.add(`55${m[1]}${m[3]}`); } return out; };

const txtMov = (m) => String(m?.texto ?? m?.txt ?? "").replace(/\s+/g, " ").trim();
const dataMov = (m) => { const d = m?.ts || m?.data || ""; if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10); const x = String(d).match(/^(\d{2})\/(\d{2})\/(\d{4})/); return x ? `${x[3]}-${x[2]}-${x[1]}` : ""; };

/** Converte o backup do PrimeGov (formato backup-completo) em registros enxutos, sem contratos/anexos nem CPF/CNPJ. */
export function importarPrimeGov(backup) {
  const ps = backup?.central?.parceiros;
  if (!Array.isArray(ps)) throw new Error("Arquivo não é um backup do PrimeGov (central.parceiros).");
  return ps.filter((p) => p && p.id && p.nome).map((p) => ({
    id: "bp_" + String(p.id).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60),
    origem_id: p.id,
    nome: String(p.nome).trim().slice(0, 160),
    telefones: telefones(p.tel),
    email: String(p.email || "").trim().slice(0, 120),
    empresa: String(p.empresa || "").trim().slice(0, 160),
    perfil: p.termo === "captador" ? "Captador" : p.tipo === "empresa" ? "Empresa parceira" : "Parceiro",
    comissao: typeof p.comissao === "number" ? p.comissao : null,
    vigencia: p.vigIni || p.vigFim ? { inicio: p.vigIni || "", fim: p.vigFim || "" } : null,
    contrato: p.contrato?.nome ? String(p.contrato.nome).slice(0, 160) : "",
    reservas: (p.municipios || []).map((m) => {
      const movs = (m.mov || []).map((x) => ({ data: dataMov(x), texto: txtMov(x).slice(0, 400) })).filter((x) => x.texto);
      return { id: m.id, nome: String(m.nome || "").trim(), uf: m.uf && m.uf !== "—" ? m.uf : "", tipo: m.tipo || "municipio", inicio: m.ini || "", fim: m.fim || "", status: m.status || "prospec", movimentos: movs.slice(-5) };
    }),
  }));
}

const hoje = (agora) => new Date(agora.getTime() - 3 * 3600e3).toISOString().slice(0, 10);
export const reservaAtiva = (r, agora) => r.status === "contratado" || (!!r.fim && r.fim >= hoje(agora));
const fmt = (iso) => (iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : "");

export const parceirosDoNumero = (lista, wa) => { const v = variantes(wa); return (lista || []).filter((p) => !String(p.id).startsWith("sol_") && (p.telefones || []).some((t) => v.has(t))); };

/** Reservas do parceiro, prontas para a Zoe ler. */
export function resumoReservas(p, agora) {
  return (p.reservas || []).map((r) => ({
    ente: r.nome + (r.uf ? "/" + r.uf : ""), status: STATUS_B2G[r.status] || r.status,
    reserva: reservaAtiva(r, agora) ? (r.status === "contratado" ? "contratado" : `ativa até ${fmt(r.fim)}`) : `vencida em ${fmt(r.fim)}`,
    ultimo_andamento: r.movimentos?.length ? `${r.movimentos.at(-1).data ? fmt(r.movimentos.at(-1).data) + " – " : ""}${r.movimentos.at(-1).texto}` : "",
  }));
}

/** Procura um ente (município/estado/consórcio) entre as reservas. Nunca devolve o nome de outro parceiro. */
export function disponibilidade(lista, ente, uf, agora, waSolicitante = "") {
  const alvo = semAcento(ente).replace(/^(municipio|prefeitura|cidade) (de |do |da )?/, ""); const u = String(uf || "").toUpperCase().slice(0, 2);
  const meus = new Set(parceirosDoNumero(lista, waSolicitante).map((p) => p.id));
  const achados = [];
  for (const p of lista || []) for (const r of p.reservas || []) {
    const n = semAcento(r.nome);
    if (!(n === alvo || n === "estado de " + alvo || n.replace(/^estado d[eoa] /, "") === alvo)) continue;
    if (u && r.uf && r.uf !== u) continue;
    achados.push({ r, proprio: meus.has(p.id) });
  }
  const ativo = achados.find((x) => reservaAtiva(x.r, agora));
  if (!ativo) return { ente: ente + (u ? "/" + u : ""), livre: true, observacao: achados.length ? "Já teve reserva anterior, hoje vencida." : "" };
  if (ativo.proprio) return { ente: ativo.r.nome + "/" + ativo.r.uf, livre: false, sua_reserva: true, status: STATUS_B2G[ativo.r.status], ate: ativo.r.status === "contratado" ? "contratado" : fmt(ativo.r.fim) };
  return { ente: ativo.r.nome + (ativo.r.uf ? "/" + ativo.r.uf : ""), livre: false, sua_reserva: false, situacao: ativo.r.status === "contratado" ? "em atendimento pela PrimeCorp (contratado)" : `reservado para outro parceiro até ${fmt(ativo.r.fim)}`, fila: "pode entrar na fila de espera: se a reserva vencer sem avanço, a equipe avisa" };
}

/** Números do sistema para a equipe. */
export function painelB2G(lista, agora, { dias = 15 } = {}) {
  const ps = (lista || []).filter((p) => !String(p.id).startsWith("sol_")); const sols = (lista || []).filter((p) => String(p.id).startsWith("sol_") && p.status === "pendente");
  const todas = ps.flatMap((p) => (p.reservas || []).map((r) => ({ ...r, parceiro: p.nome })));
  const ativas = todas.filter((r) => reservaAtiva(r, agora)); const lim = new Date(agora.getTime() + dias * 864e5).toISOString().slice(0, 10);
  const porStatus = Object.fromEntries(Object.entries(STATUS_B2G).map(([k, v]) => [v, ativas.filter((r) => r.status === k).length]));
  return { parceiros: ps.length, reservas_ativas: ativas.length, por_status: porStatus, vencendo: ativas.filter((r) => r.status !== "contratado" && r.fim <= lim).map((r) => `${r.nome}/${r.uf} – ${r.parceiro} – vence ${fmt(r.fim)}`).slice(0, 15), solicitacoes_pendentes: sols.map((s) => `${s.ente} – ${s.nome || "+" + s.wa}`).slice(0, 15) };
}
