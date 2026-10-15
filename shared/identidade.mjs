// Criação de acesso (Netlify Identity) pelo servidor: o usuário já nasce confirmado e vinculado à conta.
import { admin } from "@netlify/identity";

export async function criarUsuarioIdentity(email, senha, { conta, nome } = {}) {
  try {
    return await admin.createUser({ email, password: senha, data: { app_metadata: { conta, roles: ["propto_cliente"] }, user_metadata: { full_name: nome || "" } } });
  } catch (e) {
    const msg = String(e?.message || e);
    if (/exist|registered|already|422/i.test(msg)) throw Object.assign(new Error("Este e-mail já tem acesso."), { status: 409 });
    throw Object.assign(new Error(msg), { status: 502 });
  }
}
