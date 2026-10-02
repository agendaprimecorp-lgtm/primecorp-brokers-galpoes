import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { db, listarTudo } from "../../shared/servidor.mjs";

// Backup automático diário às 03:15 de Brasília (06:15 UTC; Brasília não tem horário de verão).
// Mantém os últimos 30 dias no armazenamento "backups".
export default async () => {
  const registros = await listarTudo(true);
  const emissoes = await db().sql`SELECT * FROM emissoes ORDER BY id`;
  const hoje = new Date().toISOString().slice(0, 10);
  const store = getStore("backups");
  await store.set(`backup-${hoje}.json`, JSON.stringify({ versao: 1, gerado_em: new Date().toISOString(), registros, emissoes }));
  const { blobs } = await store.list();
  const chaves = blobs.map((b) => b.key).filter((k) => /^backup-\d{4}-\d{2}-\d{2}\.json$/.test(k)).sort();
  for (const k of chaves.slice(0, Math.max(0, chaves.length - 30))) await store.delete(k);
  console.log(`Backup ${hoje}: ${registros.length} registros, ${emissoes.length} emissões.`);
};

export const config: Config = { schedule: "15 6 * * *" };
