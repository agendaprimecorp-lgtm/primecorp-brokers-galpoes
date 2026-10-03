const ck = () => (/(?:^|; )tu=([^;]+)/.exec(document.cookie) || [])[1];
let u = ck() ? { email: decodeURIComponent(ck()) } : null;
export const handleAuthCallback = async () => null;
export const getUser = async () => u;
export const login = async (e) => { document.cookie = 'tu=' + encodeURIComponent(e) + '; path=/'; return (u = { email: e }); };
export const signup = async (e) => ({ email: e });
export const logout = async () => { document.cookie = 'tu=; path=/; max-age=0'; u = null; };
export const updateUser = async () => u; export const requestPasswordRecovery = async () => {};
