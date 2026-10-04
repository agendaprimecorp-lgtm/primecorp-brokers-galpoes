import type { Config } from "@netlify/functions";
import zlib from "node:zlib";

// TEMPORÁRIO: empacota o site público primecorpconsultoria.com.br (arquivos idênticos) num .zip
// para republicar pelo Netlify Drop e aplicar o snippet da assistente. Só lê conteúdo público.
const BASE = "https://primecorpconsultoria.com.br";
const PAGINAS = ["index", "setor-publico", "empresas", "ensino-e-filantropia", "imoveis", "indique-seu-municipio", "diferencial", "quem-somos", "experiencia", "contato"];

function zip(arqs: { nome: string; dados: Buffer }[]) {
  const partes: Buffer[] = []; const central: Buffer[] = []; let off = 0;
  for (const a of arqs) {
    const nome = Buffer.from(a.nome, "utf8"); const crc = zlib.crc32(a.dados) >>> 0;
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(0, 8);
    h.writeUInt32LE(0, 10); h.writeUInt32LE(crc, 14); h.writeUInt32LE(a.dados.length, 18); h.writeUInt32LE(a.dados.length, 22); h.writeUInt16LE(nome.length, 26); h.writeUInt16LE(0, 28);
    partes.push(h, nome, a.dados);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(0, 10);
    c.writeUInt32LE(0, 12); c.writeUInt32LE(crc, 16); c.writeUInt32LE(a.dados.length, 20); c.writeUInt32LE(a.dados.length, 24); c.writeUInt16LE(nome.length, 28);
    c.writeUInt32LE(off, 42); central.push(c, nome); off += 30 + nome.length + a.dados.length;
  }
  const cd = Buffer.concat(central); const fim = Buffer.alloc(22); fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(arqs.length, 8); fim.writeUInt16LE(arqs.length, 10);
  fim.writeUInt32LE(cd.length, 12); fim.writeUInt32LE(off, 16);
  return Buffer.concat([...partes, cd, fim]);
}

export default async (req: Request) => {
  const cors = { "access-control-allow-origin": "https://app.netlify.com", vary: "origin" };
  const fila = [...PAGINAS.map((p) => `/${p}.html`), "/404.html"]; const vistos = new Set<string>(); const arqs: { nome: string; dados: Buffer }[] = []; const log: string[] = [];
  while (fila.length) {
    const p = fila.shift()!; if (vistos.has(p)) continue; vistos.add(p);
    const r = await fetch(BASE + p, { redirect: "manual" });
    if (r.status !== 200 && !(p === "/404.html" && r.status === 404)) { log.push(`${p} ${r.status}`); continue; }
    const dados = Buffer.from(await r.arrayBuffer()); arqs.push({ nome: p.slice(1), dados }); log.push(`${p} ${r.status} ${dados.length}`);
    const tipo = r.headers.get("content-type") || "";
    if (/html|css|javascript/.test(tipo)) {
      const txt = dados.toString("utf8");
      const refs = [...txt.matchAll(/(?:src|href)=["']([^"'#?]+)["']/g), ...txt.matchAll(/url\(["']?([^"')#?]+)["']?\)/g), ...txt.matchAll(/["'](\/[\w\-\/.]+\.(?:png|jpe?g|webp|svg|gif|ico|pdf|js|css|json|woff2?|mp4))["']/g)].map((m) => m[1]);
      for (const ref of refs) {
        if (/^(data:|mailto:|tel:|javascript:)/.test(ref)) continue;
        let u: URL; try { u = new URL(ref, BASE + p); } catch { continue; }
        if (u.origin !== BASE) continue; let caminho = decodeURIComponent(u.pathname);
        if (caminho === "/" ) caminho = "/index.html"; else if (!/\.[a-z0-9]+$/i.test(caminho)) caminho = caminho.replace(/\/$/, "") + ".html";
        if (!vistos.has(caminho)) fila.push(caminho);
      }
    }
  }
  if (new URL(req.url).searchParams.has("lista")) return new Response(log.join("\n"), { headers: { ...cors, "content-type": "text/plain; charset=utf-8" } });
  return new Response(zip(arqs), { headers: { ...cors, "content-type": "application/zip", "content-disposition": "attachment; filename=primecorp-site.zip", "cache-control": "no-store" } });
};

export const config: Config = { path: "/site/espelho.zip" };
