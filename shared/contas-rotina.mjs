// Rotina diária das contas Propto: avisos ao cliente (WhatsApp com modelo aprovado, se configurado) e à equipe.
import { env } from "./servidor.mjs";
import { listarContas, gravarConta, situacao, PLANOS, brl } from "./contas.mjs";
import { atualizarValor } from "./asaas.mjs";
import { enviarModelo } from "./whatsapp.mjs";
import { avisarOuEnfileirar } from "./zoe-run.mjs";

const DIA = 864e5;
const waDe = (t) => { const d = String(t || "").replace(/\D/g, ""); return d.length === 10 || d.length === 11 ? "55" + d : d; };

/** Mensagem ao cliente fora da janela de 24 h: só com modelo aprovado pela Meta (PROPTO_MODELO_TESTE, 2 variáveis: nome e texto). */
async function avisarCliente(c, texto) {
  const tpl = env("PROPTO_MODELO_TESTE"); const dono = (c.membros || []).find((m) => m.papel === "admin") || {};
  if (!tpl || !dono.telefone) return false;
  try { await enviarModelo(waDe(dono.telefone), tpl, [String(dono.nome || "").split(" ")[0] || "Olá", texto.slice(0, 900)]); return true; } catch (e) { console.error("Aviso ao cliente:", e); return false; }
}

export async function rotinaContas(agora = new Date()) {
  const acoes = [];
  for (const c of await listarContas()) {
    const s = situacao(c, agora); const av = { ...(c.avisos || {}) }; let mudou = false;
    const dono = (c.membros || []).find((m) => m.papel === "admin") || {};
    const quem = `${c.nome} (${dono.nome || ""}, +${waDe(dono.telefone)})`;
    // Fim do teste sem plano escolhido
    if (s.codigo === "teste" && !c.asaas?.assinatura) {
      for (const d of [5, 2]) {
        if (s.dias <= d && s.dias > 0 && !av["teste_d" + d]) {
          const enviado = await avisarCliente(c, `Faltam ${s.dias} dia(s) para terminar o seu teste grátis da Propto. Assinando durante o teste você garante 40% de desconto por 12 meses. Acesse o app em Mais → Plano e assinatura.`);
          await avisarOuEnfileirar(`Propto · teste de ${quem} termina em ${s.dias} dia(s)${enviado ? " (cliente avisado pelo WhatsApp)" : ""}. Bom momento para ligar.`).catch(() => null);
          av["teste_d" + d] = agora.toISOString(); mudou = true; acoes.push(`D-${d}: ${c.nome}`);
          break;
        }
      }
    }
    if (s.codigo === "expirada" && !av.teste_fim) {
      await avisarCliente(c, "Seu teste grátis da Propto terminou. Seus imóveis e anúncios continuam guardados; escolha um plano no app em Mais → Plano e assinatura para continuar captando.");
      await avisarOuEnfileirar(`Propto · teste de ${quem} terminou sem plano. Anúncios saem do ar em 7 dias.`).catch(() => null);
      av.teste_fim = agora.toISOString(); mudou = true; acoes.push(`fim do teste: ${c.nome}`);
    }
    // Atraso depois da carência
    if (s.codigo === "atrasada" && !s.escrita && av.atraso_ref !== c.pago_ate) {
      await avisarCliente(c, "Identificamos uma fatura da Propto em aberto. O app ficou só para consulta; pague a fatura em Mais → Plano e assinatura para voltar a captar.");
      await avisarOuEnfileirar(`Propto · ${quem} com fatura em atraso: app só para consulta.`).catch(() => null);
      av.atraso_ref = c.pago_ate || c.teste_fim; mudou = true; acoes.push(`atraso: ${c.nome}`);
    }
    // Retenção (termos: 90 dias após o fim do teste ou do período pago): a equipe decide a exclusão
    const fim = Math.max(Date.parse(c.teste_fim) || 0, Date.parse(c.pago_ate) || 0);
    if (["expirada", "cancelada", "suspensa"].includes(s.codigo) && fim && agora.getTime() - fim > 90 * DIA && !av.retencao) {
      await avisarOuEnfileirar(`Propto · conta ${quem} sem uso pago há mais de 90 dias: pelos termos, os dados podem ser excluídos (exportar antes, se for o caso).`).catch(() => null);
      av.retencao = agora.toISOString(); mudou = true; acoes.push(`retenção: ${c.nome}`);
    }
    // Fim do desconto de fundador: volta ao preço cheio
    const ass = c.asaas || {};
    if (ass.assinatura && ass.fundador && ass.fundador_ate && agora.getTime() > Date.parse(ass.fundador_ate) && !ass.reajustado_em && PLANOS[ass.plano]) {
      try {
        await atualizarValor(ass.assinatura, PLANOS[ass.plano].preco);
        c.asaas = { ...ass, valor: PLANOS[ass.plano].preco, reajustado_em: agora.toISOString() }; mudou = true;
        await avisarOuEnfileirar(`Propto · fim do desconto de fundador de ${c.nome}: mensalidade passa a ${brl(PLANOS[ass.plano].preco)}.`).catch(() => null);
        acoes.push(`reajuste: ${c.nome}`);
      } catch (e) { acoes.push(`reajuste falhou: ${c.nome}: ${e.message}`); }
    }
    if (mudou) await gravarConta(c.id, { ...c, avisos: av });
  }
  return { contas: acoes.length, acoes };
}
