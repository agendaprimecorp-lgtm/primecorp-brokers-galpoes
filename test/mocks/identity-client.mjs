let u = { email: 'contato@primecorpconsultoria.com.br' };
export const handleAuthCallback = async () => null;
export const getUser = async () => u;
export const login = async (e) => (u = { email: e });
export const logout = async () => { u = null; };
export const acceptInvite = async () => u; export const updateUser = async () => u; export const requestPasswordRecovery = async () => {};
