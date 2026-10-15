import type { Config } from "@netlify/functions";
import { env, registrarEmissao } from "../../shared/servidor.mjs";
import { rotinaContas } from "../../shared/contas-rotina.mjs";

// Todo dia às 09:10 de Brasília: avisos do fim do teste (5 e 2 dias antes e no fim), atrasos e fim do desconto de fundador.
export default async () => {
  const r = await rotinaContas(new Date());
  if (r.acoes.length) await registrarEmissao({ tipo: "contas_rotina", conteudo: r.acoes.join(" · ").slice(0, 3000) }).catch(() => null);
  console.log("Rotina de contas:", JSON.stringify(r));
};
export const config: Config = { schedule: "10 12 * * *" };
