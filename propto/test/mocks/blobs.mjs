const stores = globalThis.__stores = globalThis.__stores || {};
export function getStore(name) {
  const m = stores[name] = stores[name] || new Map();
  return {
    async set(k, v, o) { const data = v instanceof Blob ? Buffer.from(await v.arrayBuffer()) : typeof v === 'string' ? v : Buffer.from(v); m.set(k, { data, metadata: o?.metadata || {} }); },
    async get(k, o) { const r = m.get(k); if (!r) return null; return o?.type === 'text' ? String(r.data) : r.data; },
    async getWithMetadata(k, o) { const r = m.get(k); if (!r) return null; const d = Buffer.isBuffer(r.data) ? r.data : Buffer.from(r.data); return { data: d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength), metadata: r.metadata }; },
    async list() { return { blobs: [...m.keys()].map(key => ({ key })) }; },
    async delete(k) { m.delete(k); },
  };
}
