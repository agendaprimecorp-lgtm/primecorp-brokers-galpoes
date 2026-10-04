import { build } from 'esbuild';
const alias = { '@netlify/identity': './test/mocks/identity.mjs', '@netlify/blobs': './test/mocks/blobs.mjs', '@anthropic-ai/sdk': './test/mocks/anthropic.mjs' };
for (const f of ['api', 'sala', 'anunciante', 'backup-diario', 'imovel', 'whatsapp', 'zoe-background', 'matricula-background', 'zoe-revisao-background']) {
  await build({ entryPoints: [`netlify/functions/${f}.mts`], bundle: true, platform: 'node', format: 'esm', outfile: `test/out/${f}.mjs`, alias, packages: 'external', external: ['@netlify/database', 'pg'], logLevel: 'warning' });
}
