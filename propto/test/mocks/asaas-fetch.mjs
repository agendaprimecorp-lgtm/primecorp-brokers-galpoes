// Asaas simulado: intercepta fetch para api-sandbox.asaas.com e guarda as chamadas.
export function instalarAsaas() {
  const real = globalThis.fetch; const st = globalThis.__asaas = { chamadas: [], n: 0, subs: {}, pays: {} };
  globalThis.fetch = async (u, o = {}) => {
    const s = String(u); if (!s.startsWith('https://api-sandbox.asaas.com/v3')) return real(u, o);
    const p = s.slice('https://api-sandbox.asaas.com/v3'.length); const m = o.method || 'GET'; const body = o.body ? JSON.parse(o.body) : null;
    st.chamadas.push({ m, p, body, h: o.headers }); const id = (x) => `${x}_${++st.n}`; const J = (j, s = 200) => new Response(JSON.stringify(j), { status: s, headers: { 'content-type': 'application/json' } });
    if (o.headers?.access_token !== 'teste_asaas') return J({ errors: [{ description: 'chave inválida' }] }, 401);
    if (p === '/customers' && m === 'POST') { if (!body.cpfCnpj) return J({ errors: [{ description: 'CPF/CNPJ obrigatório' }] }, 400); return J({ id: id('cus') }); }
    if (p === '/subscriptions' && m === 'POST') { const sid = id('sub'); const pid = id('pay'); st.subs[sid] = { ...body, pay: pid }; st.pays[pid] = { id: pid, subscription: sid, customer: body.customer, value: body.value, dueDate: body.nextDueDate, status: 'PENDING', invoiceUrl: 'https://sandbox.asaas.com/i/' + pid, externalReference: body.externalReference }; return J({ id: sid, ...body }); }
    let r = p.match(/^\/subscriptions\/([^/]+)\/payments$/); if (r) return J({ data: Object.values(st.pays).filter((x) => x.subscription === r[1]) });
    r = p.match(/^\/subscriptions\/([^/]+)$/); if (r && m === 'POST') { Object.assign(st.subs[r[1]] || {}, body); return J({ id: r[1], ...body }); }
    if (r && m === 'DELETE') return J({ deleted: true, id: r[1] });
    if (p === '/payments' && m === 'POST') { const pid = id('pay'); st.pays[pid] = { id: pid, customer: body.customer, value: body.value, dueDate: body.dueDate, status: 'PENDING', invoiceUrl: 'https://sandbox.asaas.com/i/' + pid, externalReference: body.externalReference }; return J(st.pays[pid]); }
    return J({ errors: [{ description: 'rota não simulada ' + p }] }, 404);
  };
  return st;
}
