export const getUser = async () => globalThis.__user || null;
export const verifyRequestOrigin = (req) => { const o = req.headers.get('origin'); if (o && o !== 'https://propto.test') { const e = new Error('Forbidden'); e.status = 403; throw e; } };
