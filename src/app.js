import PC from "../shared/core.mjs";
import V from "../shared/verif.mjs";
import { ZOE_PADRAO as ZOE_BASE } from "../shared/zoe-base.mjs";
import { importarPrimeGov, painelB2G, resumoReservas, PESSOAS_PADRAO } from "../shared/b2g.mjs";
import { jsPDF } from "jspdf";
import { handleAuthCallback, getUser, login, logout, acceptInvite, updateUser, requestPasswordRecovery } from "@netlify/identity";
import { tratarFoto, blobB64 } from "./foto.js";
import { ditar, vozDisponivel } from "./voz.js";
import { zipSync, strToU8 } from "fflate";
import qrcode from "qrcode-generator";
import { roteiroFotos, TIPOS as TIPOS_IMOVEL } from "../shared/roteiro.mjs";
import { xmlVRSync, csvImovel, textoImovel, nomeFoto } from "../shared/exporta.mjs";
import { TERMO_PADRAO, TERMO_VERSAO, AUT_PARCERIA, AUT_PROPRIETARIO, AUT_VERSAO, ACORDO_PADRAO, ACORDO_VERSAO, VISITA_PADRAO, RECIBO_PADRAO, CLAUSULA_SPLIT, MANDATO_PADRAO, VERSAO_DOCS, PRAZOS, CORRETOR_PADRAO, varsPrazos, pendencias, extenso, reaisExtenso } from "./termo.js";

/* ================= Utilidades ================= */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const now = () => new Date().toISOString();
const fdt = (t) => { try { const d = new Date(t); return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }) + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
function toast(m) { const t = $("toast"); t.textContent = m; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 3200); }
const LOGOS = { dark: null, white: null, ratio: 731 / 160 };
async function carregarLogos() {
  const toData = async (u) => { const b = await (await fetch(u)).blob(); return await new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); }); };
  try { LOGOS.dark = await toData("/logo-escuro.png"); LOGOS.white = await toData("/logo-claro.png"); } catch { /* PDF sai sem logo */ }
}
function tokenAleatorio(n = 32) { const a = new Uint8Array(n); crypto.getRandomValues(a); return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, n); }
const blobToBase64 = (b) => new Promise((r, j) => { const f = new FileReader(); f.onload = () => r(String(f.result).split(",")[1]); f.onerror = j; f.readAsDataURL(b); });
async function compartilharOuBaixar(blob, nome) {
  const file = new File([blob], nome, { type: blob.type || "application/octet-stream" });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: nome }); return true; }
  } catch (e) { if (e && e.name === "AbortError") return false; }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nome; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); return true;
}
async function copiar(txt, el) { try { await navigator.clipboard.writeText(txt); toast("Copiado."); } catch { if (el) { el.select?.(); } toast("Selecione e copie manualmente."); } }
function waLink(tel, txt) { const d = String(tel || "").replace(/\D/g, ""); const num = d ? (d.length <= 11 ? "55" + d : d) : ""; return "https://wa.me/" + num + "?text=" + encodeURIComponent(txt || ""); }

/* ================= API ================= */
class ErroAPI extends Error { constructor(m, s) { super(m); this.status = s; } }
async function api(path, opts = {}) {
  const r = await fetch("/api/" + path, { credentials: "same-origin", ...opts, headers: { "content-type": "application/json", ...(opts.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { telaLogin("Sua sessão expirou. Entre novamente."); throw new ErroAPI("Sessão expirada", 401); }
  if (r.status === 402 && typeof recarregarConta === "function") recarregarConta();
  if (!r.ok) throw new ErroAPI(j.erro || "Erro " + r.status, r.status);
  return j;
}
const S = { briefings: [], ofertas: [], negocios: [], contatos: [], salas: [], pedidos: [], config: [], usuarios: [], anuncios: [], conversas: [], agenda: [], zoe_sugestoes: [], b2g: [], site_leads: [] };
const store = {
  async carregar() { const d = await api("dados"); Object.keys(S).forEach((k) => (S[k] = d[k] || [])); },
  async save(n, o) {
    const ant = S[n].slice(); const i = S[n].findIndex((x) => x.id === o.id);
    const c = JSON.parse(JSON.stringify(o)); if (i >= 0) S[n][i] = c; else S[n].push(c);
    try { await api(`dados/${n}/${o.id}`, { method: "PUT", body: JSON.stringify(c) }); }
    catch (e) { S[n] = ant; toast("Não foi possível salvar: " + e.message); throw e; }
    render();
  },
  async del(n, id) {
    const ant = S[n].slice(); S[n] = S[n].filter((x) => x.id !== id);
    try { await api(`dados/${n}/${id}`, { method: "DELETE" }); } catch (e) { S[n] = ant; toast("Não foi possível excluir: " + e.message); throw e; }
    render();
  },
};
async function emitir(e) { try { return await api("emissoes", { method: "POST", body: JSON.stringify(e) }); } catch (er) { toast("Registro da emissão falhou: " + er.message); return null; } }
async function novoCodigo() { return (await api("codigo", { method: "POST" })).codigo; }
async function garantirCodigo(o) { if (o.codigo) return o.codigo; const codigo = await novoCodigo(); await store.save("ofertas", { ...o, codigo }); return codigo; }
const CFG = () => S.config.find((c) => c.id === "geral") || {};
/* ---- documentos: preenchimento padrão (prazos manuais, foro, corretor responsável) ---- */
function idCorretor(c) { if (!c || /rodrigo/i.test(c.nome || "")) return CORRETOR_PADRAO; const n = String(c.creci || "").replace(/\D/g, ""); return `${String(c.nome).toUpperCase()}, corretor(a) de imóveis inscrito(a) no CRECI-SP sob o nº ${n || "______"}`; }
function pctTexto(p) { const n = PC.parseBR(p) || 0; return `${PC.nf(n)}% (${extenso(Math.floor(n))}${n % 1 ? " vírgula " + extenso(Math.round((n % 1) * 100)) : ""} por cento)`; }
function alugTexto(a) { const n = PC.parseBR(a) || 0; return `${PC.nf(n)} (${extenso(Math.floor(n))}) ${n === 1 ? "aluguel mensal" : "aluguéis mensais"}`; }
function docVars(extra = {}, corretor) { const cfg = CFG(); return { FORO: "Sumaré/SP", ...varsPrazos(cfg), CORRETOR: idCorretor(corretor), COMISSAO_VENDA: pctTexto(cfg.com_venda_pct || 6), COMISSAO_LOCACAO: alugTexto(cfg.com_locacao_alugueis || 1), ...extra }; }
function preencherDoc(txt, extra, corretor) { return trocaCorretor(PC.preencher(txt, docVars(extra, corretor)), corretor); }
const faltasDoc = (t) => pendencias(t).filter((x) => /PRAZO|FORO|\[__/.test(x));
function avisoFaltas(f) { const nomes = f.map((x) => (PRAZOS.find((p) => "{{" + p[1] + "}}" === x) || [0, 0, x === "{{FORO}}" ? "Foro" : "campo [__]"])[2]); return "Preencha em Mais → Configurações → Prazos: " + [...new Set(nomes)].join("; ") + "."; }

/* ================= Autenticação ================= */
let usuarioAtual = null;
let EU = { papel: "admin", perfil: {} };
const ehAdmin = () => EU.papel === "admin";
const MARCA = `<span class="marca"><img class="logo d" src="/marca/propto-horizontal.svg" alt="Propto"><img class="logo w" src="/marca/propto-horizontal-negative.svg" alt="Propto"><span class="marca-sub">Imóveis</span></span>`;
function telaAuth(html) { $("hdr").innerHTML = ""; $("tabs").innerHTML = ""; $("main").innerHTML = `<div class="auth">${MARCA}${html}</div>`; }
function telaLogin(msg) {
  usuarioAtual = null;
  telaAuth(`<div class="card"><h2>Entrar</h2>${msg ? `<p class="note">${esc(msg)}</p>` : ""}
  <label>E-mail<input id="le" type="email" autocomplete="username"></label>
  <label>Senha<input id="ls" type="password" autocomplete="current-password"></label>
  <button class="p" id="lb">Entrar</button><button class="g" id="lr">Esqueci a senha</button><div class="status" id="st"></div></div><p class="endosso">Propto Imóveis · propto.com.br</p>`);
  const st = $("st");
  $("lb").onclick = async () => {
    st.className = "status"; st.textContent = "Entrando…";
    try { usuarioAtual = await login($("le").value.trim(), $("ls").value); await abrir(); }
    catch (e) { st.className = "status err"; st.textContent = "E-mail ou senha incorretos."; }
  };
  $("ls").addEventListener("keydown", (e) => { if (e.key === "Enter") $("lb").click(); });
  $("lr").onclick = async () => {
    const em = $("le").value.trim(); if (!em) { st.className = "status err"; st.textContent = "Digite seu e-mail acima."; return; }
    try { await requestPasswordRecovery(em); st.className = "status"; st.textContent = "Enviamos um link para redefinir a senha."; }
    catch { st.className = "status err"; st.textContent = "Não foi possível enviar o link."; }
  };
}
function telaSenha(tipo, token) {
  telaAuth(`<div class="card"><h2>${tipo === "invite" ? "Criar sua senha" : "Nova senha"}</h2>
  <label>Senha (mín. 8 caracteres)<input id="p1" type="password" autocomplete="new-password"></label>
  <label>Repita a senha<input id="p2" type="password" autocomplete="new-password"></label>
  <button class="p" id="pb">Salvar e entrar</button><div class="status" id="st"></div></div>`);
  $("pb").onclick = async () => {
    const st = $("st"); const a = $("p1").value, b = $("p2").value;
    if (a.length < 8 || a !== b) { st.className = "status err"; st.textContent = a !== b ? "As senhas não conferem." : "Use pelo menos 8 caracteres."; return; }
    try { usuarioAtual = tipo === "invite" ? await acceptInvite(token, a) : await updateUser({ password: a }); history.replaceState(null, "", location.pathname); await abrir(); }
    catch (e) { st.className = "status err"; st.textContent = "Link inválido ou expirado. Peça um novo convite."; }
  };
}
async function iniciar() {
  carregarLogos();
  try {
    const r = await handleAuthCallback();
    if (r && r.type === "invite") return telaSenha("invite", r.token);
    if (r && r.type === "recovery") return telaSenha("recovery");
  } catch { toast("Link de acesso inválido ou expirado."); }
  usuarioAtual = await getUser().catch(() => null);
  if (!usuarioAtual) return telaLogin();
  await abrir();
}
async function abrir() {
  $("main").innerHTML = `<div class="card"><p class="hint">Carregando dados…</p></div>`;
  try { await store.carregar(); try { EU = await api("status"); } catch {} if (CLIENTE()) await logosCliente(); }
  catch (e) { if (e.status !== 401) $("main").innerHTML = `<div class="card"><p class="status err">Não foi possível carregar: ${esc(e.message)}</p><button id="rt">Tentar de novo</button></div>`; const rt = $("rt"); if (rt) rt.onclick = abrir; return; }
  route = { v: "painel" }; stack.length = 0; assinaturaDados = assinatura(); ultimaSync = new Date(); render();
}
/* ---------- Modo de tela: celular (campo, alimenta o sistema) x computador (escritório, gestão) ---------- */
const lerPref = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const gravarPref = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };
const modoAuto = () => (window.matchMedia("(pointer: fine)").matches && window.innerWidth >= 1024 ? "escritorio" : "campo");
const MODO = () => document.documentElement.dataset.modo || "campo";
function aplicarModo() { const pref = lerPref("pc_modo"); const m = pref === "escritorio" || pref === "campo" ? pref : modoAuto(); if (document.documentElement.dataset.modo !== m) { document.documentElement.dataset.modo = m; return true; } return false; }
aplicarModo();
window.addEventListener("resize", () => { if (!lerPref("pc_modo") && aplicarModo() && usuarioAtual) render(); });
/** QR em SVG para abrir o sistema no celular. */
function qrSVG(txt, tam = 168) { const q = qrcode(0, "M"); q.addData(txt); q.make(); return q.createSvgTag({ cellSize: Math.max(2, Math.floor(tam / (q.getModuleCount() + 8))), margin: 4, scalable: true }); }
const cartaoCelular = (titulo, texto) => `<div class="card celular"><div class="qr">${qrSVG(location.origin + "/app")}</div><div><span class="k">Use o celular</span><h2>${esc(titulo)}</h2><p class="hint">${esc(texto)}</p><p class="hint">Aponte a câmera do celular para o código ou abra <b>${esc(location.host)}/app</b>. O que for registrado no celular aparece aqui em segundos.</p></div></div>`;
// No computador, o painel acompanha o que chega do celular (sincroniza a cada 20 s).
let ultimaSync = null, assinaturaDados = "";
const assinatura = () => (S.conversas || []).map((c) => c.id + (c.ultima_em || "") + (c.modo || "")).join("|") + (S.agenda || []).map((a) => a.id + a.status).join("|") + S.ofertas.map((o) => o.id + (o.atualizado || "")).join("|") + S.negocios.length + S.pedidos.map((p) => p.id + (p.respondido_em || "")).join("|") + (S.zoe_sugestoes || []).map((g) => g.id + g.status).join("|") + (S.b2g || []).map((g) => g.id + (g.status || "") + (g.importado_em || "")).join("|") + (S.site_leads || []).map((g) => g.id + g.status).join("|") + S.salas.map((x) => (x.interesses || []).length).join("");
async function sincronizar(forcar) {
  if (!usuarioAtual || document.visibilityState !== "visible") return;
  if (editing && !forcar) return;
  try { await store.carregar(); ultimaSync = new Date(); const a = assinatura(); const mudou = a !== assinaturaDados; assinaturaDados = a; const sy = document.getElementById("sync"); if (sy) sy.textContent = "Sincronizado " + ultimaSync.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }); if (mudou && !editing) render(); } catch {}
}
setInterval(() => { if (MODO() === "escritorio") sincronizar(); }, window.__syncMs || 20000);
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible" || !usuarioAtual || editing) return;
  try { await store.carregar(); render(); } catch {}
});

/* ================= Navegação ================= */
let route = { v: "painel" }; const stack = []; let editing = false;
// Histórico do navegador: o gesto de voltar do iPhone e o botão voltar do Android seguem a navegação do app.
let ignorarPop = 0;
function go(r, push = true) { editing = false; if (push) { stack.push(route); try { history.pushState({ pc: 1 }, ""); } catch {} } route = r; render(); window.scrollTo(0, 0); }
function back(doNavegador) { if (!doNavegador && history.state?.pc) { ignorarPop++; try { history.back(); } catch { ignorarPop--; } } editing = false; route = stack.pop() || { v: "painel" }; render(); window.scrollTo(0, 0); }
window.addEventListener("popstate", () => { if (ignorarPop) { ignorarPop--; return; } if (!usuarioAtual) return; if (stack.length || !TOP.includes(route.v)) back(true); });
const TOP = ["painel", "briefings", "captar", "ofertas", "contatos", "mais"];
const TABS = [
  ["painel", "Painel", '<path d="M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z"/>'],
  ["briefings", "Briefings", '<path d="M8 4h8v3H8zM6 6H4v15h16V6h-2M8 12h8M8 16h5"/>'],
  ["captar", "Captar", '<path d="M9 31.5 32 11l23 20.5" stroke-width="6.5"/><rect x="18.5" y="40" width="6.5" height="13" rx="3.25" fill="currentColor" stroke="none"/><rect x="28.75" y="33.5" width="6.5" height="19.5" rx="3.25" fill="currentColor" stroke="none"/><rect x="39" y="37" width="6.5" height="16" rx="3.25" fill="currentColor" stroke="none"/>'],
  ["ofertas", "Ofertas", '<path d="M3 21V9l9-6 9 6v12H3zM9 21v-6h6v6"/>'],
  ["contatos", "CRM", '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.8.8 3 2.5 3.5 5.2"/>'],
  ["mais", "Mais", '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>'],
];
const PAI = { plano: "mais", time: "mais", perfil: "mais", contasPropto: "mais", iniciar: "captar", visita: "captar", captacao: "captar", equipe: "mais", anuncios: "mais", briefing: "briefings", editb: "briefings", teaser: "briefings", novasala: "briefings", oferta: "ofertas", nova: "ofertas", novopedido: "ofertas", pedido: "mais", pedidos: "mais", negocio: "painel", comissao: "painel", contato: "contatos", editc: "contatos", sala: "mais", salas: "mais", relatorios: "mais", backup: "mais", config: "mais" };
function renderTabs() {
  const cur = TOP.includes(route.v) ? route.v : PAI[route.v] || "";
  $("tabs").className = CLIENTE() ? "tabs-in c5" : "tabs-in c6";
  $("tabs").innerHTML = TABS.filter(([k]) => !(CLIENTE() && k === "briefings")).map(([k, l0, p]) => [k, CLIENTE() && k === "ofertas" ? "Imóveis" : l0, p]).map(([k, l, p]) => `<button data-tab="${k}" class="${cur === k ? "on" : ""}"><svg viewBox="${k === "captar" ? "5 7 54 49" : "0 0 24 24"}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">${p}</svg>${l}</button>`).join("");
  if (MODO() === "escritorio") { $("tabs").insertAdjacentHTML("afterbegin", `<div class="side-top">${MARCA}<small>Escritório · gestão</small></div>`); $("tabs").insertAdjacentHTML("beforeend", `<div class="side-foot"><span id="sync" class="sync">${ultimaSync ? "Sincronizado " + ultimaSync.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : ""}</span><button class="sm" id="syncb">Atualizar agora</button></div>`); $("syncb").onclick = () => sincronizar(true); }
  $("tabs").querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { stack.length = 0; go({ v: b.dataset.tab }, false); }));
}
function header(title) {
  const top = TOP.includes(route.v);
  $("hdr").innerHTML = top
    ? `${MARCA}<div class="ttl" style="text-align:right;font-size:15px;color:var(--ink2)">${esc(title)}</div>`
    : `<button class="back" id="bk" aria-label="Voltar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg><span>Voltar</span></button><div class="ttl">${esc(title)}</div>`;
  const bk = $("bk"); if (bk) bk.onclick = () => back();
}
const VIEWS = {};
function render() {
  if (!usuarioAtual) return;
  if (route.v !== "visita") pararCamera();
  document.documentElement.classList.toggle("foco", route.v === "visita");
  renderTabs();
  if (editing && ["editb", "oferta", "teaser", "nova", "editc", "novasala", "config", "novopedido", "comissao", "captacao", "equipe", "visita"].includes(route.v)) return;
  if (CLIENTE() && SO_PC_VIEWS.includes(route.v)) { header("Indisponível"); $("main").innerHTML = `<div class="card"><p class="hint">Esta área faz parte da operação PrimeCorp e não está no seu plano.</p></div>`; return; }
  try { (VIEWS[route.v] || VIEWS.painel)(); aplicarModoCliente(); }
  catch (e) { console.error(e); $("main").innerHTML = `<div class="card"><p class="status err">Erro ao exibir esta tela: ${esc(e.message)}</p></div>`; }
}

/* ================= Helpers de domínio ================= */
const B = (id) => S.briefings.find((x) => x.id === id);
const O = (id) => S.ofertas.find((x) => x.id === id);
const N = (id) => S.negocios.find((x) => x.id === id);
const C = (id) => S.contatos.find((x) => x.id === id);
function hist(excl) { return S.ofertas.filter((x) => x.id !== excl && x.status !== "descartada" && x.status !== "captacao").map((x) => { const d = PC.num(x); return { id: x.id, cidade: d.cidade, fabril: d.fabril, construida: d.construida, titulo: x.titulo || PC.autoTitle(d), quando: x.criado ? new Date(x.criado).toLocaleDateString("pt-BR") : "" }; }); }
const chkOf = (o) => PC.checks(PC.num(o), hist(o.id));
const tituloO = (o) => o.titulo || PC.autoTitle(PC.num(o));
const nomeB = (b) => (b ? b.nome || "Briefing sem nome" : "(briefing removido)");
const nomeC = (c) => (c ? c.nome || c.empresa || "Contato sem nome" : "");
const etapaNome = (e) => (PC.ETAPAS.find((x) => x[0] === e) || [0, e === "perdido" ? "Perdido" : e])[1];
function fmtIn(f, v) {
  if (v === null || v === undefined || v === "") return "";
  if (Array.isArray(v)) return v.join("\n");
  if (typeof v === "number") { const money = ["aluguel", "venda", "condominio", "iptu", "valor_base"].includes(f); return PC.nf(v, money ? (Number.isInteger(v) ? 0 : 2) : undefined); }
  return String(v);
}
const OF_FIELDS = ["matricula", "cartorio", "inscricao", "cep", "nirf", "dormitorios", "suites", "banheiros", "vagas", "area_ha", "distancia_asfalto", "aptidao", "agua", "benfeitorias", "topografia", "car", "ccir", "georref", "tipo", "operacao", "cidade", "uf", "regiao", "subtitulo", "tipologia", "fabril", "construida", "terreno", "administrativo", "apoio", "frente", "zoneamento", "pe_direito", "piso_carga", "docas", "energia_kva", "pontes", "avcb", "data_anuncio", "aluguel", "venda", "condominio", "iptu", "iptu_periodo", "disponibilidade", "documentacao", "titulo", "descricao", "diferenciais", "itens"];
function fromAI(o) { const r = {}; OF_FIELDS.forEach((f) => { if (o[f] !== undefined && o[f] !== null) r[f] = fmtIn(f, o[f]); }); return r; }
function ranking(b) { return S.ofertas.filter((o) => o.status !== "descartada" && o.status !== "captacao").map((o) => { const c = chkOf(o); return Object.assign({ o, c }, PC.score(o, b, c)); }).sort((x, y) => y.score - x.score); }
function faixaArea(b) { const n = PC.numB(b); if (n.haMin || n.haMax) return n.haMin && n.haMax ? PC.nf(n.haMin) + " a " + PC.nf(n.haMax) + " ha" : n.haMin ? "a partir de " + PC.nf(n.haMin) + " ha" : "até " + PC.nf(n.haMax) + " ha"; if (n.areaMin && n.areaMax) return PC.nf(n.areaMin) + " a " + PC.nf(n.areaMax) + " m²"; if (n.areaMin) return "a partir de " + PC.nf(n.areaMin) + " m²"; if (n.areaMax) return "até " + PC.nf(n.areaMax) + " m²"; return ""; }
function confirmar2(btn, txt, fn) { let armed = false; btn.onclick = async () => { if (!armed) { armed = true; const orig = btn.innerHTML; const sp = btn.querySelector("span"); if (sp) sp.textContent = txt; else btn.textContent = txt; btn.classList.add("armado"); setTimeout(() => { armed = false; if (btn.isConnected) { btn.innerHTML = orig; btn.classList.remove("armado"); } }, 4000); return; } btn.disabled = true; try { await fn(); } finally { btn.disabled = false; } }; }

/* ================= PAINEL ================= */
VIEWS.painel = () => {
  if (CLIENTE()) return painelCliente();
  header(EU.perfil?.nome || usuarioAtual?.email || "");
  const abertos = S.negocios.filter((n) => n.etapa !== "perdido" && n.etapa !== "fechado");
  const ativos = S.briefings.filter((b) => (b.status || "ativo") === "ativo");
  const novas = S.ofertas.filter((o) => o.status === "nova");
  const salasNovas = S.salas.filter((s) => s.aceite && !s.visto_aceite).length + S.salas.reduce((a, s) => a + (s.interesses || []).filter((i) => !(s.vistos || []).includes(i.codigo)).length, 0);
  const pedNovos = S.pedidos.filter((p) => p.respondido_em && !p.visto);
  const comAbertas = abertos.filter((n) => n.comissao).map((n) => PC.calcComissao(n.comissao));
  const totCom = comAbertas.reduce((a, c) => a + c.total, 0), totPC = comAbertas.reduce((a, c) => a + c.partes.filter(PC.ehPC).reduce((x, p) => x + p.valor, 0), 0);
  const cols = PC.ETAPAS.filter(([k]) => S.negocios.some((n) => n.etapa === k)).map(([k, l]) => {
    const ns = S.negocios.filter((n) => n.etapa === k).sort((a, b) => (b.atualizado || "").localeCompare(a.atualizado || ""));
    return `<div class="col"><h3><span>${l}</span><span class="muted">${ns.length}</span></h3>${ns.map((n) => { const o = O(n.oferta), b = B(n.briefing); return `<button class="deal" data-n="${n.id}"><b>${esc(o ? (o.codigo ? o.codigo + " · " : "") + tituloO(o) : "(oferta removida)")}</b><span>${esc(nomeB(b))}${n.parceiro ? " · " + esc(n.parceiro) : ""}</span></button>`; }).join("")}</div>`;
  }).join("");
  const capAbertas = S.ofertas.filter((o) => o.status === "captacao" && (ehAdmin() || o.captador === EU.usuario)).length;
  const me = eu(); const chaveBV = "pc_boasvindas_" + (EU.usuario || ""); let bv = false; try { bv = !localStorage.getItem(chaveBV); } catch {}
  const resid = me.foco === "residencial";
  $("main").innerHTML = `
  ${bv ? `<div class="card boasvindas"><span class="k">${resid ? "Bem-vinda" : "Bem-vindo"}</span><h2>${esc(me.nome.split(" ")[0])}, seu escritório cabe na palma da mão.</h2>
  <p class="hint">${resid ? "Casas e apartamentos: fotografe, fale e o anúncio sai pronto, com a sua assinatura e o seu CRECI." : "Galpões, áreas, terrenos e rurais: leia anúncios por link, cruze com as demandas e capte no local."}</p>
  <div class="bv-passos"><button data-bv="captar"><b>1</b><span>Captar um imóvel</span></button><button data-bv="nova"><b>2</b><span>Ler um anúncio por link</span></button><button data-bv="editb"><b>3</b><span>Cadastrar a demanda de um cliente</span></button></div>
  <button class="g sm" id="bvx">Entendi, não mostrar de novo</button></div>` : ""}
  <button class="captar-cta" id="qcap"><img class="pt-sym" src="/marca/propto-symbol-negative.svg" alt="Propto"><span><b>Captar imóvel</b><small>${capAbertas ? capAbertas + " captação(ões) em andamento" : "Fotos, voz e anúncio no local da visita"}</small><em>O corretor fala, o app faz o resto</em></span><span>›</span></button>
  ${cardZoePainel()}
  <div class="kpis"><div class="kpi"><b>${ativos.length}</b><span>Briefings ativos</span></div><div class="kpi"><b>${S.ofertas.filter((o) => o.status !== "descartada").length}</b><span>Ofertas na base</span></div><div class="kpi"><b>${abertos.length}</b><span>Negócios abertos</span></div></div>
  ${MODO() === "escritorio" ? (() => { const cs = S.ofertas.filter((o) => o.origem === "Captação própria" && o.status !== "descartada").sort((a, b) => (b.atualizado || "").localeCompare(a.atualizado || "")).slice(0, 6);
    return `<div class="card campo"><div class="row" style="justify-content:space-between"><h2>Chegando do campo</h2><span class="hint">registros feitos no celular</span></div>${cs.length ? `<div class="campo-grid">${cs.map((o) => { const ambs = o.captacao?.ambientes || []; const k = o.capa || ambs.flatMap((a) => (a.fotos || []).map((f) => f.k))[0]; return `<button class="campo-it" data-cap="${o.id}">${k ? `<img loading="lazy" src="${fotoURL(k)}" alt="">` : '<span class="semfoto">sem foto</span>'}<span class="t"><b>${esc(o.titulo || [o.tipo, o.regiao || o.cidade].filter(Boolean).join(" · ") || "Captação")}</b><small>${esc([perfilPorEmail(o.captador).nome.split(" ")[0], fotosDe(o) + " foto(s)", ambs.filter((a) => a.descricao).length + " ambiente(s) descrito(s)", fdt(o.atualizado)].join(" · "))}</small></span></button>`; }).join("")}</div>` : '<p class="hint">Nenhum registro ainda. As visitas feitas no celular aparecem aqui automaticamente.</p>'}</div>`; })() : ""}
  ${(() => { const sv = sinaisVerdes(); return sv.length ? `<div class="card verde"><h3>🟢 Sinal verde: ${sv.length} oferta(s) com cliente interessado</h3><p class="hint">Ainda sem autorização nem pedido ao anunciante. Um toque gera o pedido com o termo e a comissão padrão.</p><div class="list">${sv.map((o) => `<div class="item" style="cursor:default"><span class="t"><b>${esc((o.codigo ? o.codigo + " · " : "") + tituloO(o))}</b><span>${esc([o.anunciante, o.anunciante_contato].filter(Boolean).join(" · ") || "Anunciante a identificar")}</span></span><button class="sm p" data-sv="${o.id}">Pedir</button></div>`).join("")}</div></div>` : ""; })()}
  ${novas.length ? `<button class="card" id="gonovas" style="text-align:left;cursor:pointer;flex-direction:row;align-items:center"><span class="dot amarelo"></span><span style="flex:1"><b>${novas.length} oferta${novas.length > 1 ? "s" : ""} a revisar</b><br><span class="hint">Confira os dados antes de cruzar com os briefings.</span></span><span>›</span></button>` : ""}
  ${pedNovos.length ? `<button class="card" id="gopeds" style="text-align:left;cursor:pointer;flex-direction:row;align-items:center"><span class="dot verde"></span><span style="flex:1"><b>${pedNovos.length} resposta(s) de anunciante</b><br><span class="hint">Dados completados ou autorizações de indicação recebidas.</span></span><span>›</span></button>` : ""}
  ${comAbertas.length ? `<div class="card"><h3>Honorários previstos</h3><p><b>${esc(PC.brl(totPC) || "R$ 0")}</b> participação PrimeCorp <span class="hint">· ${esc(PC.brl(totCom) || "R$ 0")} em honorários totais · ${comAbertas.length} negócio(s) com divisão definida</span></p></div>` : ""}
  ${salasNovas ? `<button class="card" id="gosalas" style="text-align:left;cursor:pointer;flex-direction:row;align-items:center"><span class="dot verde"></span><span style="flex:1"><b>${salasNovas} novidade(s) nas Salas do Cliente</b><br><span class="hint">Aceites de termo e interesses registrados.</span></span><span>›</span></button>` : ""}
  <div class="card"><div class="row" style="justify-content:space-between"><h2>Negócios</h2><button class="sm" id="csv">Exportar CSV</button></div>
  ${cols ? `<div class="kanban">${cols}</div>` : '<p class="empty">Nenhum negócio aberto. Abra um briefing, escolha uma oferta do ranking e envie o teaser ou crie uma Sala do Cliente.</p>'}
  ${S.negocios.some((n) => n.etapa === "perdido") ? `<p class="hint">${S.negocios.filter((n) => n.etapa === "perdido").length} negócio(s) perdido(s) fora do quadro.</p>` : ""}</div>
  <div class="row"><button class="grow" id="qnova">+ Nova oferta</button><button class="grow" id="qbrief">+ Novo briefing</button></div>
  <p class="foot">Propto Imóveis · ${esc(eu().nome)} · ${esc(eu().creci)}</p>`;
  document.querySelectorAll("[data-n]").forEach((b) => (b.onclick = () => go({ v: "negocio", id: b.dataset.n })));
  const gn = $("gonovas"); if (gn) gn.onclick = () => go({ v: "ofertas", f: "nova" }, false);
  const gs = $("gosalas"); if (gs) gs.onclick = () => go({ v: "salas" });
  const gp = $("gopeds"); if (gp) gp.onclick = () => go({ v: "pedidos" });
  document.querySelectorAll("[data-cap]").forEach((b) => (b.onclick = () => go({ v: "captacao", id: b.dataset.cap })));
  document.querySelectorAll("[data-sv]").forEach((b) => (b.onclick = async () => { b.disabled = true; try { const ped = await sinalVerde(O(b.dataset.sv)); if (ped) { toast("Pedido criado. Envie ao anunciante."); go({ v: "pedido", id: ped.id }); } } catch (e) { toast("Falhou: " + e.message); b.disabled = false; } }));
  $("csv").onclick = exportCSV;
  document.querySelectorAll("[data-bv]").forEach((b) => (b.onclick = () => go(b.dataset.bv === "editb" ? { v: "editb", id: null } : { v: b.dataset.bv }, b.dataset.bv !== "captar")));
  const bx = $("bvx"); if (bx) bx.onclick = () => { try { localStorage.setItem(chaveBV, "1"); } catch {} render(); };
  $("qnova").onclick = () => go({ v: "nova" }); $("qcap").onclick = () => go({ v: "captar" }, false);
  $("qbrief").onclick = () => go({ v: "editb", id: null });
  document.querySelectorAll("[data-zc]").forEach((b) => (b.onclick = () => go({ v: "conversa", id: b.dataset.zc })));
  const za = $("goagenda"); if (za) za.onclick = () => go({ v: "agenda" }); const zz = $("gozoe"); if (zz) zz.onclick = () => go({ v: "zoe" });
};
async function exportCSV() {
  const q = (s) => '"' + String(s == null ? "" : s).replace(/"/g, '""') + '"';
  const L = [["Negócio", "Etapa", "Briefing", "Código", "Oferta", "Cidade", "Parceiro/Cliente", "Telefone", "Honorários totais", "Participação PrimeCorp", "Divisão", "Data", "Evento"].map(q).join(";")];
  S.negocios.forEach((n) => { const o = O(n.oferta), b = B(n.briefing); const cm = n.comissao ? PC.calcComissao(n.comissao) : null;
    const cmv = cm ? [PC.nf(cm.total, 2), PC.nf(cm.partes.filter(PC.ehPC).reduce((a, p) => a + p.valor, 0), 2), PC.quadroComissao(n.comissao)] : ["", "", ""];
    (n.log && n.log.length ? n.log : [{ t: n.criado, ev: "" }]).forEach((e) => L.push([n.id, etapaNome(n.etapa), nomeB(b), o ? o.codigo || "" : "", o ? tituloO(o) : "", o ? o.cidade : "", n.parceiro, n.tel, ...cmv, fdt(e.t), e.ev].map(q).join(";"))); });
  await compartilharOuBaixar(new Blob(["﻿" + L.join("\n")], { type: "text/csv" }), "PrimeCorp_Negocios_" + new Date().toISOString().slice(0, 10) + ".csv");
}

/* ================= CRM (contatos) ================= */
const TIPOS_C = ["Cliente (empresa)", "Cliente (investidor)", "Corretor parceiro", "Imobiliária", "Proprietário", "Órgão público", "Parceiro tributário", "Outro"];
VIEWS.contatos = () => {
  header("CRM");
  const f = route.f || "todos";
  let cs = [...S.contatos].sort((a, b) => nomeC(a).localeCompare(nomeC(b)));
  if (f !== "todos") cs = cs.filter((c) => c.tipo === f);
  $("main").innerHTML = `<button class="p" id="novo">+ Novo contato</button>
  <select id="ft"><option value="todos">Todos os tipos</option>${TIPOS_C.map((t) => `<option ${t === f ? "selected" : ""}>${t}</option>`).join("")}</select>
  <input id="q" placeholder="Buscar por nome, empresa, cidade ou telefone">
  <div class="card"><div class="list" id="ls"></div></div>`;
  const draw = () => { const q = PC.norm($("q").value); const rows = cs.filter((c) => !q || PC.norm([c.nome, c.empresa, c.cidade, c.telefone, c.email, c.documento].join(" ")).includes(q));
    $("ls").innerHTML = rows.map((c) => { const nb = S.briefings.filter((b) => b.cliente === c.id || b.parceiro_id === c.id).length; const nn = S.negocios.filter((n) => n.contato === c.id || (B(n.briefing) && (B(n.briefing).cliente === c.id || B(n.briefing).parceiro_id === c.id))).length;
      return `<button class="item" data-c="${c.id}"><span class="t"><b>${esc(nomeC(c))}</b><span>${esc([c.tipo, c.empresa && c.nome ? c.empresa : "", c.cidade].filter(Boolean).join(" · "))}</span></span><span class="chip">${nb} brief. · ${nn} neg.</span></button>`; }).join("") || '<p class="empty">Nenhum contato.</p>';
    $("ls").querySelectorAll("[data-c]").forEach((x) => (x.onclick = () => go({ v: "contato", id: x.dataset.c }))); };
  draw(); $("q").addEventListener("input", draw);
  $("ft").onchange = () => { route = { v: "contatos", f: $("ft").value }; render(); };
  $("novo").onclick = () => go({ v: "editc", id: null });
};
const CF = [["nome", "Nome", "text", "full"], ["empresa", "Empresa", "text", ""], ["tipo", "Tipo", "sel:" + TIPOS_C.join("|"), ""], ["documento", "CNPJ / CPF", "text", ""], ["creci", "CRECI (corretor ou imobiliária)", "text", ""], ["cargo", "Cargo", "text", ""], ["telefone", "WhatsApp", "tel", ""], ["email", "E-mail", "text", ""], ["cidade", "Cidade", "text", ""], ["origem", "Como chegou", "text", ""], ["obs", "Observações", "area", "full"]];
function fieldHTML([k, l, t, cls, g], val) {
  const v = esc(val == null ? "" : val); if (g) cls = `${cls}" data-g="${g}`;
  if (t.startsWith("sel:")) return `<label class="${cls}">${l}<select data-k="${k}">${t.slice(4).split("|").map((o) => `<option ${o === val ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></label>`;
  if (t.startsWith("u:")) return `<label class="u ${cls}">${l}<input data-k="${k}" inputmode="decimal" value="${v}"><span>${t.slice(2)}</span></label>`;
  if (t === "area") return `<label class="${cls}">${l}<textarea data-k="${k}" rows="2">${v}</textarea></label>`;
  if (t === "num") return `<label class="${cls}">${l}<input data-k="${k}" inputmode="numeric" value="${v}"></label>`;
  if (t.startsWith("ref:")) { const tipos = t.slice(4).split("|"); const opts = S.contatos.filter((c) => tipos.some((x) => (c.tipo || "").startsWith(x))).sort((a, b) => nomeC(a).localeCompare(nomeC(b))); return `<label class="${cls}">${l}<select data-k="${k}"><option value="">— nenhum —</option>${opts.map((c) => `<option value="${c.id}" ${c.id === val ? "selected" : ""}>${esc(nomeC(c))}</option>`).join("")}</select></label>`; }
  return `<label class="${cls}">${l}<input data-k="${k}" type="${t === "tel" ? "tel" : "text"}" value="${v}"></label>`;
}
const GRUPOS_SEL = (tipo) => PC.grupo(tipo);
function aplicarGrupo(root, tipo) { const g = PC.grupo(tipo); root.querySelectorAll("[data-g]").forEach((el) => (el.hidden = !el.dataset.g.split(" ").includes(g))); }
const readK = (root) => { const o = {}; root.querySelectorAll("[data-k]").forEach((el) => (o[el.dataset.k] = el.value.trim())); return o; };
VIEWS.editc = () => {
  const c = route.id ? C(route.id) : null; header(c ? "Editar contato" : "Novo contato");
  const cur = c || { tipo: route.tipo || "Cliente (empresa)" };
  $("main").innerHTML = `<div class="card" id="fc"><div class="grid">${CF.map((f) => fieldHTML(f, cur[f[0]])).join("")}</div>
  <div class="row"><button class="p grow" id="sv">Salvar contato</button>${c ? '<button class="g" id="del">Excluir</button>' : ""}</div><div class="status" id="st"></div></div>`;
  editing = true;
  $("sv").onclick = async () => { const v = readK($("fc")); if (!v.nome && !v.empresa) { $("st").className = "status err"; $("st").textContent = "Informe nome ou empresa."; return; }
    const o = { ...(c || { id: uid("c"), criado: now(), log: [] }), ...v, atualizado: now() }; editing = false;
    try { await store.save("contatos", o); toast("Contato salvo."); if (route.volta) { const r = route.volta; stack.pop(); const parc = /^(Corretor|Imobili)/.test(o.tipo || ""); if (parc) r.parceiro_id = o.id; else r.cliente = o.id; route = r; render(); } else { route = { v: "contato", id: o.id }; render(); } } catch { editing = true; } };
  const d = $("del"); if (d) confirmar2(d, "Toque de novo para excluir", async () => { editing = false; await store.del("contatos", c.id); stack.length = 0; go({ v: "contatos" }, false); });
};
VIEWS.contato = () => {
  const c = C(route.id); if (!c) return back(); header(nomeC(c));
  const bs = S.briefings.filter((b) => b.cliente === c.id || b.parceiro_id === c.id);
  const ns = S.negocios.filter((n) => n.contato === c.id || bs.some((b) => b.id === n.briefing));
  const ss = S.salas.filter((s) => s.contato === c.id);
  $("main").innerHTML = `<div class="card"><div class="row" style="justify-content:space-between"><span class="k">${esc(c.tipo || "")}</span><button class="sm" id="ed">Editar</button></div>
  <h2>${esc(nomeC(c))}</h2><p class="hint">${esc([c.empresa && c.nome ? c.empresa : "", c.cargo, c.documento, c.cidade].filter(Boolean).join(" · "))}</p>
  <p>${esc([c.telefone, c.email].filter(Boolean).join(" · "))}</p>
  <div class="row">${c.telefone ? `<a class="btn sm" target="_blank" rel="noopener" href="${esc(waLink(c.telefone, ""))}">WhatsApp</a>` : ""}${c.email ? `<a class="btn sm" href="mailto:${esc(c.email)}">E-mail</a>` : ""}<button class="sm" id="nb">+ Briefing para este contato</button></div>
  ${c.obs ? `<p class="hint">${esc(c.obs)}</p>` : ""}</div>
  <div class="card"><h2>Briefings</h2><div class="list">${bs.map((b) => `<button class="item" data-b="${b.id}"><span class="t"><b>${esc(nomeB(b))}</b><span>${esc([b.tipo, b.operacao, b.status || "ativo"].join(" · "))}</span></span></button>`).join("") || '<p class="empty">Nenhum.</p>'}</div></div>
  <div class="card"><h2>Negócios</h2><div class="list">${ns.map((n) => { const o = O(n.oferta); return `<button class="item" data-n="${n.id}"><span class="t"><b>${esc(o ? tituloO(o) : "(oferta removida)")}</b><span>${esc(etapaNome(n.etapa))}</span></span></button>`; }).join("") || '<p class="empty">Nenhum.</p>'}</div></div>
  ${ss.length ? `<div class="card"><h2>Salas do Cliente</h2><div class="list">${ss.map((s) => `<button class="item" data-s="${s.id}"><span class="t"><b>${esc(s.titulo || "Sala")}</b><span>${s.aceite ? "Termo aceito " + fdt(s.aceite.em) : "Aguardando aceite"} · ${(s.interesses || []).length} interesse(s)</span></span></button>`).join("")}</div></div>` : ""}
  <div class="card"><h2>Histórico do contato</h2><div class="row"><input id="nt" placeholder="Ligação, reunião, retorno…" style="flex:1"><button class="sm d" id="add">Registrar</button></div>
  <ul class="log">${[...(c.log || [])].reverse().map((e) => `<li><time>${esc(fdt(e.t))}</time><span>${esc(e.ev)}</span></li>`).join("")}</ul></div>`;
  $("ed").onclick = () => go({ v: "editc", id: c.id });
  $("nb").onclick = () => go({ v: "editb", id: null, cliente: c.tipo && c.tipo.startsWith("Corretor") ? null : c.id, parceiro_id: c.tipo && c.tipo.startsWith("Corretor") ? c.id : null });
  $("add").onclick = async () => { const t = $("nt").value.trim(); if (!t) return; await store.save("contatos", { ...c, log: [...(c.log || []), { t: now(), ev: t }], atualizado: now() }); };
  document.querySelectorAll("[data-b]").forEach((x) => (x.onclick = () => go({ v: "briefing", id: x.dataset.b })));
  document.querySelectorAll("[data-n]").forEach((x) => (x.onclick = () => go({ v: "negocio", id: x.dataset.n })));
  document.querySelectorAll("[data-s]").forEach((x) => (x.onclick = () => go({ v: "sala", id: x.dataset.s })));
};

/* ================= BRIEFINGS ================= */
VIEWS.briefings = () => {
  header("Briefings");
  const bs = [...S.briefings].sort((a, b) => (b.atualizado || "").localeCompare(a.atualizado || ""));
  $("main").innerHTML = `<button class="p" id="novo">+ Novo briefing</button>
  <div class="card"><div class="list">${bs.map((b) => { const r = ranking(b).filter((x) => !x.fora).length; return `<button class="item" data-b="${b.id}"><span class="dot ${(b.status || "ativo") === "ativo" ? "verde" : "amarelo"}"></span><span class="t"><b>${esc(nomeB(b))}</b><span>${esc([b.tipo, b.operacao, b.cidades || b.regiao, faixaArea(b)].filter(Boolean).join(" · "))}</span></span><span class="chip ${r ? "r" : ""}">${r} aderente${r === 1 ? "" : "s"}</span></button>`; }).join("") || '<p class="empty">Nenhum briefing. Cadastre a demanda do cliente ou do parceiro.</p>'}</div></div>`;
  $("novo").onclick = () => go({ v: "editb", id: null });
  document.querySelectorAll("[data-b]").forEach((b) => (b.onclick = () => go({ v: "briefing", id: b.dataset.b })));
};
const BF = [
  ["nome", "Nome do briefing (interno)", "text", "full"],
  ["cliente", "Cliente (CRM)", "ref:Cliente|Proprietário|Outro", ""], ["parceiro_id", "Parceiro que trouxe (CRM)", "ref:Corretor|Imobiliária|Outro", ""],
  ["tipo", "Tipo", "sel:" + TIPOS_IMOVEL.join("|"), ""], ["operacao", "Operação", "sel:Locação|Venda", ""],
  ["cidades", "Cidades aceitas (separe por vírgula)", "text", "full"], ["regiao", "Região / eixo", "text", "full"],
  ["areaMin", "Área mínima", "u:m²", "", "galpao comercial area residencial"], ["areaMax", "Área máxima", "u:m²", "", "galpao comercial area residencial"],
  ["haMin", "Área mínima", "u:ha", "", "rural"], ["haMax", "Área máxima", "u:ha", "", "rural"],
  ["dormMin", "Dormitórios mín.", "num", "", "residencial"], ["suitesMin", "Suítes mín.", "num", "", "residencial"], ["vagasMin", "Vagas mín.", "num", "", "residencial"], ["aluguelMax", "Aluguel máx. (total)", "u:R$/mês", "", "residencial comercial"],
  ["peMin", "Pé-direito mín.", "u:m", "", "galpao"], ["kvaMin", "Energia mín.", "u:kVA", "", "galpao"], ["docasMin", "Docas mín.", "num", "", "galpao"],
  ["precoMaxM2", "Aluguel máx. por m²", "u:R$", "", "galpao comercial"], ["valorMax", "Compra: valor máx.", "u:R$", ""], ["prazo", "Prazo de ocupação", "text", ""],
  ["desejaveis", "Desejáveis", "area", "full"], ["obs", "Observações internas", "area", "full"], ["status", "Situação", "sel:ativo|pausado|encerrado", ""],
];
VIEWS.editb = () => {
  const b = route.id ? B(route.id) : null; header(b ? "Editar briefing" : "Novo briefing");
  const cur = { ...(b || { status: "ativo", ...(eu().foco === "residencial" ? { tipo: "Casa", operacao: "Venda" } : { tipo: "Galpão", operacao: "Locação" }) }), ...(route.draft || {}), ...(route.cliente ? { cliente: route.cliente } : {}), ...(route.parceiro_id ? { parceiro_id: route.parceiro_id } : {}) };
  $("main").innerHTML = `<div class="card" id="fb"><p class="hint">Requisitos obrigatórios eliminam ofertas; o resto vira pontuação. Nomes de cliente e parceiro nunca aparecem no teaser.</p><div class="grid">${BF.map((f) => fieldHTML(f, cur[f[0]])).join("")}</div>
  <button class="g" id="nc">+ Cadastrar contato novo no CRM</button>
  <div class="row"><button class="p grow" id="sv">Salvar briefing</button>${b ? '<button class="g" id="del">Excluir</button>' : ""}</div><div class="status" id="st"></div></div>`;
  editing = true;
  const tsel = $("fb").querySelector('[data-k="tipo"]'); aplicarGrupo($("fb"), tsel.value); tsel.onchange = () => aplicarGrupo($("fb"), tsel.value);
  $("nc").onclick = () => go({ v: "editc", id: null, volta: { v: "editb", id: route.id, draft: readK($("fb")) } });
  $("sv").onclick = async () => {
    const v = readK($("fb")); if (!v.nome) { $("st").className = "status err"; $("st").textContent = "Dê um nome ao briefing (ex.: Indústria X · galpão 12 mil)."; return; }
    const pc = C(v.parceiro_id); const o = { ...(b || { id: uid("b"), criado: now() }), ...v, parceiro: pc ? nomeC(pc) : b?.parceiro || "", parceiro_tel: pc ? pc.telefone || "" : b?.parceiro_tel || "", atualizado: now() };
    editing = false; try { await store.save("briefings", o); toast("Briefing salvo."); route = { v: "briefing", id: o.id }; render(); } catch { editing = true; }
  };
  const d = $("del"); if (d) confirmar2(d, "Toque de novo para excluir", async () => { editing = false; await store.del("briefings", b.id); stack.length = 0; go({ v: "briefings" }, false); });
};
VIEWS.briefing = () => {
  const b = B(route.id); if (!b) return back(); header(nomeB(b));
  const r = ranking(b); const ok = r.filter((x) => !x.fora), fora = r.filter((x) => x.fora);
  const negs = S.negocios.filter((n) => n.briefing === b.id); const cli = C(b.cliente), par = C(b.parceiro_id);
  const salas = S.salas.filter((s) => s.briefing === b.id);
  $("main").innerHTML = `<div class="card"><div class="row" style="justify-content:space-between"><span class="k">Briefing · ${esc(b.status || "ativo")}</span><button class="sm" id="ed">Editar</button></div>
  <h2>${esc([b.tipo, b.operacao].filter(Boolean).join(" · "))}</h2>
  <p class="hint">${esc([b.cidades || b.regiao, faixaArea(b), b.peMin && "pé-direito ≥ " + b.peMin + " m", b.kvaMin && "energia ≥ " + b.kvaMin + " kVA", b.precoMaxM2 && "até R$ " + b.precoMaxM2 + "/m²", b.valorMax && "até R$ " + b.valorMax, b.prazo].filter(Boolean).join(" · "))}</p>
  <div class="row">${cli ? `<button class="sm" data-c="${cli.id}">Cliente: ${esc(nomeC(cli))}</button>` : ""}${par ? `<button class="sm" data-c="${par.id}">Parceiro: ${esc(nomeC(par))}</button>` : ""}</div>
  <button class="p" id="sala">Criar Sala do Cliente</button><button class="sm" id="mand">Mandato de busca (contrato com o cliente)</button>
  ${salas.length ? `<div class="list">${salas.map((s) => `<button class="item" data-s="${s.id}"><span class="t"><b>${esc(s.titulo || "Sala")}</b><span>${s.aceite ? "Aceite " + fdt(s.aceite.em) : "Aguardando aceite"} · ${(s.opcoes || []).length} opção(ões) · ${(s.interesses || []).length} interesse(s)</span></span></button>`).join("")}</div>` : ""}</div>
  <div class="card"><div class="row" style="justify-content:space-between"><h2>Ranking</h2><span class="hint">${ok.length} aderente(s)</span></div>
  <div class="list">${ok.map((x, i) => { const neg = negs.find((n) => n.oferta === x.o.id); return `<div class="item" style="cursor:default;flex-wrap:wrap"><span class="dot ${x.c.sem}"></span><span class="t"><b>${esc((x.o.codigo ? x.o.codigo + " · " : "") + tituloO(x.o))}</b><span>${esc([x.o.cidade, x.o.origem].filter(Boolean).join(" · "))}</span><span class="reasons">${esc(x.motivos.slice(0, 3).join(" · ") || "Atende a todos os critérios")}</span></span><span class="score">${x.score}</span>
  <div class="row" style="width:100%;justify-content:flex-end">${neg ? `<button class="sm" data-n="${neg.id}">Negócio · ${esc(etapaNome(neg.etapa))}</button>` : `<button class="sm p" data-t="${x.o.id}" data-l="Opção ${String.fromCharCode(65 + (i % 26))}">Teaser</button>`}<button class="sm" data-o="${x.o.id}">Oferta</button></div></div>`; }).join("") || '<p class="empty">Nenhuma oferta aderente ainda.</p>'}</div>
  ${fora.length ? `<details><summary class="hint" style="cursor:pointer;padding:6px 0">${fora.length} fora do briefing</summary><div class="list">${fora.map((x) => `<button class="item" data-o="${x.o.id}"><span class="dot ${x.c.sem}"></span><span class="t"><b>${esc(tituloO(x.o))}</b><span>${esc(x.fora)}</span></span></button>`).join("")}</div></details>` : ""}</div>`;
  $("ed").onclick = () => go({ v: "editb", id: b.id });
  $("mand").onclick = () => gerarMandato(b); $("sala").onclick = () => go({ v: "novasala", b: b.id });
  document.querySelectorAll("[data-t]").forEach((x) => (x.onclick = () => go({ v: "teaser", b: b.id, o: x.dataset.t, l: x.dataset.l })));
  document.querySelectorAll("[data-o]").forEach((x) => (x.onclick = () => go({ v: "oferta", id: x.dataset.o })));
  document.querySelectorAll("[data-n]").forEach((x) => (x.onclick = () => go({ v: "negocio", id: x.dataset.n })));
  document.querySelectorAll("[data-c]").forEach((x) => (x.onclick = () => go({ v: "contato", id: x.dataset.c })));
  document.querySelectorAll("[data-s]").forEach((x) => (x.onclick = () => go({ v: "sala", id: x.dataset.s })));
};

/* ================= TEASER ================= */
VIEWS.teaser = () => {
  const b = B(route.b), o = O(route.o); if (!b || !o) return back();
  header("Teaser · nível 1"); const c = chkOf(o); const txt = PC.teaser(o, c, route.l || "Opção", eu());
  $("main").innerHTML = `<div class="card"><span class="k">Para: ${esc(nomeB(b))}</span><h2>${esc(tituloO(o))}</h2>
  <p class="hint">Faixas e região ampla. Nada de foto, endereço ou combinação rara de atributos. Envio privado, nunca em grupos.</p>
  ${!(o.regiao || "").trim() ? '<p class="note">Esta oferta está sem região. Preencha na oferta ou edite o texto.</p>' : ""}
  <label>Mensagem<textarea id="tx" rows="11">${esc(txt)}</textarea></label>
  <div class="grid"><label>Destinatário<input id="pn" value="${esc(b.parceiro || "")}"></label><label>WhatsApp<input id="pt" type="tel" value="${esc(b.parceiro_tel || "")}"></label></div>
  <div class="row"><button class="grow" id="cp">Copiar</button><a class="btn grow" id="wa" target="_blank" rel="noopener" href="#">Abrir WhatsApp</a></div>
  <button class="p" id="reg">Registrar envio e abrir negócio</button>
  <p class="hint">Cliente avulso? Prefira a <b>Sala do Cliente</b>: ele aceita o termo antes de ver as opções.</p></div>`;
  editing = true;
  const upd = () => ($("wa").href = waLink($("pt").value, $("tx").value)); upd(); ["tx", "pt"].forEach((i) => $(i).addEventListener("input", upd));
  $("cp").onclick = () => copiar($("tx").value, $("tx"));
  $("reg").onclick = async () => {
    const ex = S.negocios.find((n) => n.briefing === b.id && n.oferta === o.id);
    const ev = { t: now(), ev: "Teaser enviado" + ($("pn").value ? " a " + $("pn").value : "") };
    const n = ex ? { ...ex, log: [...(ex.log || []), ev], atualizado: now() } : { id: uid("n"), briefing: b.id, oferta: o.id, contato: b.parceiro_id || b.cliente || null, parceiro: $("pn").value.trim(), tel: $("pt").value.trim(), etapa: "teaser", teaser: $("tx").value, criado: now(), atualizado: now(), log: [ev] };
    editing = false;
    try { await store.save("negocios", n); await emitir({ tipo: "teaser", negocio_id: n.id, oferta_id: o.id, briefing_id: b.id, contato_id: n.contato, destinatario: $("pn").value.trim(), conteudo: $("tx").value }); toast("Envio registrado."); stack.pop(); route = { v: "negocio", id: n.id }; render(); } catch { editing = true; }
  };
};

/* ================= SALA DO CLIENTE (admin) ================= */
VIEWS.novasala = () => {
  const b = B(route.b); if (!b) return back(); header("Nova Sala do Cliente");
  const cfg = CFG(); const termo = preencherDoc(cfg.termo || TERMO_PADRAO, {}, perfilPorEmail(EU.usuario));
  if (!cfg.termo_revisado || faltasDoc(termo).length) {
    $("main").innerHTML = `<div class="card"><h2>Revise o termo antes</h2><p class="hint">A Sala do Cliente exige que o cliente aceite o Termo de Apresentação, Confidencialidade e Não-Contorno. ${faltasDoc(termo).length ? esc(avisoFaltas(faltasDoc(termo))) : "Confirme a revisão do termo em Configurações."}</p><button class="p" id="cf">Abrir configurações</button></div>`;
    $("cf").onclick = () => go({ v: "config" }); return;
  }
  const ok = ranking(b).filter((x) => !x.fora);
  const sugestao = C(b.cliente) || C(b.parceiro_id);
  $("main").innerHTML = `<div class="card" id="fs"><span class="k">${esc(nomeB(b))}</span>
  <p class="hint">O cliente abre o link, cadastra a empresa, aceita o termo e só então vê as opções em faixas, com código PrimeCorp. Cada aceite e cada interesse ficam registrados com data, hora e IP.</p>
  <label>Título da sala<input id="tt" value="${esc((b.tipo || "Imóvel") + " · " + (b.regiao || b.cidades || "sua região"))}"></label>
  <label>Contato que vai receber (CRM)<select id="ct"><option value="">— nenhum —</option>${S.contatos.map((c) => `<option value="${c.id}" ${sugestao && c.id === sugestao.id ? "selected" : ""}>${esc(nomeC(c))} · ${esc(c.tipo || "")}</option>`).join("")}</select></label>
  <label>Validade do link<select id="vd"><option value="7">7 dias</option><option value="15" selected>15 dias</option><option value="30">30 dias</option></select></label>
  <h3>Opções (máx. 8)</h3>
  <div class="list">${ok.map((x, i) => `<label class="check" style="padding:8px 0;border-top:1px solid var(--line)"><input type="checkbox" data-o="${x.o.id}" ${i < 3 && x.c.sem !== "vermelho" ? "checked" : ""}><span><b>${esc((x.o.codigo ? x.o.codigo + " · " : "") + tituloO(x.o))}</b><br><span class="hint">Nota ${x.score} · semáforo ${x.c.sem}${!(x.o.regiao || "").trim() ? " · SEM REGIÃO" : ""}</span></span></label>`).join("") || '<p class="empty">Nenhuma oferta aderente para este briefing.</p>'}</div>
  <button class="p" id="cr" ${ok.length ? "" : "disabled"}>Criar sala e gerar link</button><div class="status" id="st"></div></div>`;
  editing = true;
  $("cr").onclick = async () => {
    const st = $("st"); const sel = [...document.querySelectorAll("[data-o]:checked")].map((x) => O(x.dataset.o)).filter(Boolean);
    if (!sel.length) { st.className = "status err"; st.textContent = "Selecione ao menos uma opção."; return; }
    if (sel.length > 8) { st.className = "status err"; st.textContent = "No máximo 8 opções por sala."; return; }
    const semReg = sel.filter((o) => !(o.regiao || "").trim()); if (semReg.length) { st.className = "status err"; st.textContent = "Preencha a região das ofertas marcadas SEM REGIÃO antes."; return; }
    $("cr").disabled = true; st.className = "status"; st.textContent = "Gerando códigos e link…";
    try {
      const opcoes = [];
      for (const o0 of sel) { const codigo = await garantirCodigo(o0); const o = O(o0.id) || o0; const t = PC.teaserLinhas(o, chkOf(o)); opcoes.push({ codigo, oferta: o.id, titulo: t.titulo, linhas: t.linhas }); }
      const token = tokenAleatorio(32); const ct = C($("ct").value); const dias = Number($("vd").value);
      const sala = { id: token, briefing: b.id, contato: ct ? ct.id : null, titulo: $("tt").value.trim() || "Opções selecionadas", preparado_para: ct ? ct.empresa || ct.nome || "" : "", opcoes, termo_texto: termo, termo_versao: cfg.termo_versao || TERMO_VERSAO, expira: new Date(Date.now() + dias * 864e5).toISOString(), status: "ativa", criado: now(), interesses: [], contato_corretor: eu() };
      editing = false; await store.save("salas", sala);
      await emitir({ tipo: "sala", sala_id: token, briefing_id: b.id, contato_id: sala.contato, destinatario: sala.preparado_para, conteudo: `${location.origin}/sala.html?t=${token}\n` + opcoes.map((x) => x.codigo + " · " + x.titulo).join("\n") });
      stack.pop(); route = { v: "sala", id: token }; render(); toast("Sala criada.");
    } catch (e) { st.className = "status err"; st.textContent = "Falhou: " + e.message; $("cr").disabled = false; editing = true; }
  };
};
VIEWS.salas = () => {
  header("Salas do Cliente");
  const ss = [...S.salas].sort((a, b) => (b.criado || "").localeCompare(a.criado || ""));
  $("main").innerHTML = `<div class="card"><p class="hint">Crie uma sala a partir de um briefing.</p><div class="list">${ss.map((s) => { const novo = (s.aceite && !s.visto_aceite) || (s.interesses || []).some((i) => !(s.vistos || []).includes(i.codigo)); return `<button class="item" data-s="${s.id}"><span class="dot ${s.aceite ? "verde" : "amarelo"}"></span><span class="t"><b>${esc(s.titulo || "Sala")}</b><span>${esc(nomeB(B(s.briefing)))} · ${s.aceite ? "aceite " + fdt(s.aceite.em) : "aguardando aceite"} · ${(s.interesses || []).length} interesse(s)</span></span>${novo ? '<span class="tag r">novo</span>' : ""}</button>`; }).join("") || '<p class="empty">Nenhuma sala criada.</p>'}</div></div>`;
  document.querySelectorAll("[data-s]").forEach((x) => (x.onclick = () => go({ v: "sala", id: x.dataset.s })));
};
VIEWS.sala = () => {
  const s = S.salas.find((x) => x.id === route.id); if (!s) return back(); header("Sala do Cliente");
  const link = `${location.origin}/sala.html?t=${s.id}`; const expirada = s.expira && new Date(s.expira) < new Date();
  const msg = `Olá! Separei opções para a sua demanda. Para ver, acesse o link, faça um cadastro rápido e aceite o termo de confidencialidade:\n${link}`;
  const ct = C(s.contato);
  $("main").innerHTML = `<div class="card"><span class="k">${esc(nomeB(B(s.briefing)))}</span><h2>${esc(s.titulo)}</h2>
  <p class="hint">${s.status === "encerrada" ? "Encerrada" : expirada ? "Link expirado" : "Válida até " + fdt(s.expira)} · ${(s.opcoes || []).length} opção(ões)</p>
  <div class="linkbox" id="lk">${esc(link)}</div>
  <div class="row"><button class="grow" id="cp">Copiar link</button><a class="btn grow" target="_blank" rel="noopener" href="${esc(waLink(ct ? ct.telefone : "", msg))}">Enviar no WhatsApp</a></div>
  <div class="row"><button class="sm" id="pr">Prorrogar 15 dias</button>${s.status !== "encerrada" ? '<button class="sm" id="enc">Encerrar sala</button>' : ""}</div></div>
  <div class="card"><h2>Aceite do termo</h2>${s.aceite ? `<p><b>${esc(s.aceite.razao)}</b> · ${esc(s.aceite.documento)}<br>${esc(s.aceite.responsavel)}${s.aceite.cargo ? " (" + esc(s.aceite.cargo) + ")" : ""} · ${esc(s.aceite.email)} · ${esc(s.aceite.telefone)}</p><p class="hint">Aceito em ${esc(fdt(s.aceite.em))} · IP ${esc(s.aceite.ip || "—")} · termo ${esc(s.aceite.termo_versao || "")}<br>SHA-256 ${esc((s.aceite.termo_sha256 || "").slice(0, 24))}…</p>${!ct ? '<button class="sm" id="crm">Salvar no CRM</button>' : ""}` : '<p class="empty">Ainda não aceito. As opções ficam ocultas até o aceite.</p>'}</div>
  <div class="card"><h2>Opções e interesses</h2><div class="list">${(s.opcoes || []).map((op) => { const it = (s.interesses || []).find((i) => i.codigo === op.codigo); return `<div class="item" style="cursor:default"><span class="dot ${it ? "verde" : "amarelo"}"></span><span class="t"><b>${esc(op.codigo + " · " + op.titulo)}</b><span>${it ? "Interesse em " + esc(fdt(it.em)) : "Sem interesse registrado"}</span></span><button class="sm" data-o="${op.oferta}">Oferta</button></div>`; }).join("")}</div></div>`;
  $("cp").onclick = () => copiar(link);
  $("pr").onclick = async () => { await store.save("salas", { ...s, expira: new Date(Math.max(Date.now(), new Date(s.expira || 0).getTime()) + 15 * 864e5).toISOString(), status: s.status === "encerrada" ? "ativa" : s.status }); toast("Validade prorrogada."); };
  const enc = $("enc"); if (enc) confirmar2(enc, "Toque de novo para encerrar", async () => { await store.save("salas", { ...s, status: "encerrada" }); });
  const crm = $("crm"); if (crm) crm.onclick = async () => { const c = { id: uid("c"), nome: s.aceite.responsavel, empresa: s.aceite.razao, documento: s.aceite.documento, cargo: s.aceite.cargo, email: s.aceite.email, telefone: s.aceite.telefone, tipo: "Cliente (empresa)", origem: "Sala do Cliente", criado: now(), atualizado: now(), log: [{ t: s.aceite.em, ev: "Aceitou o termo na Sala do Cliente" }] }; await store.save("contatos", c); await store.save("salas", { ...(S.salas.find((x) => x.id === s.id) || s), contato: c.id }); toast("Contato criado no CRM."); };
  document.querySelectorAll("[data-o]").forEach((x) => (x.onclick = () => go({ v: "oferta", id: x.dataset.o })));
  if ((s.aceite && !s.visto_aceite) || (s.interesses || []).some((i) => !(s.vistos || []).includes(i.codigo))) {
    store.save("salas", { ...s, visto_aceite: !!s.aceite, vistos: (s.interesses || []).map((i) => i.codigo) }).catch(() => {});
  }
};

/* ================= NEGÓCIO ================= */
VIEWS.negocio = () => {
  const n = N(route.id); if (!n) return back();
  const o = O(n.oferta), b = B(n.briefing); header("Negócio");
  const idx = PC.etapaIdx(n.etapa); const perdido = n.etapa === "perdido"; const podeFicha = !perdido && idx >= PC.etapaIdx("termo");
  $("main").innerHTML = `<div class="card"><span class="k">${esc(nomeB(b))}</span><h2>${esc(o ? (o.codigo ? o.codigo + " · " : "") + tituloO(o) : "(oferta removida)")}</h2>
  <p class="hint">${esc([n.parceiro, n.tel].filter(Boolean).join(" · ") || "Sem parceiro informado")}${n.origem === "sala" ? " · veio da Sala do Cliente" : ""}</p>
  <div class="stages">${PC.ETAPAS.map(([k, l], i) => `<button data-e="${k}" class="${k === n.etapa ? "on" : !perdido && i < idx ? "done" : ""}">${l}</button>`).join("")}</div>
  <div class="row"><button class="grow ${podeFicha ? "p" : ""}" id="pdf" ${podeFicha && o ? "" : "disabled"}>Ficha PDF</button>${o ? `<button class="grow" id="vo">Ver oferta</button>` : ""}</div>
  ${!podeFicha ? '<p class="hint">A ficha completa só é liberada a partir de “Termo assinado”.</p>' : ""}
  <div class="row">${n.tel ? `<a class="btn sm" target="_blank" rel="noopener" href="${esc(waLink(n.tel, ""))}">WhatsApp</a>` : ""}<button class="sm" id="lost">${perdido ? "Reabrir" : "Marcar como perdido"}</button></div></div>
  <div class="card"><h2>Histórico</h2><div class="row"><input id="nt" placeholder="Anotação (ligação, retorno, pendência…)" style="flex:1"><button class="sm d" id="add">Registrar</button></div>
  <ul class="log">${[...(n.log || [])].reverse().map((e) => `<li><time>${esc(fdt(e.t))}</time><span>${esc(e.ev)}</span></li>`).join("")}</ul></div>
  ${cardComissao(n, o)}
  <div class="card"><h2>Documentos do negócio</h2><p class="hint">Padronizados, com base no Código Civil (arts. 722–729), na Lei 6.530/78 e no Código de Ética do COFECI.</p>
  <div class="row"><button class="grow" id="dvis">Ficha de visita</button>${n.comissao ? `<button class="grow" id="drec">Recibo da nossa parcela</button>` : ""}</div>
  ${n.comissao ? `<button id="dspl">Cláusula de pagamento direto (copiar para o contrato)</button>` : '<p class="hint">Defina a comissão para gerar o recibo e a cláusula de pagamento direto.</p>'}</div>
  ${n.teaser ? `<div class="card"><h3>Teaser enviado</h3><pre class="wa">${esc(n.teaser)}</pre></div>` : ""}`;
  const save = async (patch, ev) => { const atual = N(n.id) || n; try { await store.save("negocios", { ...atual, ...patch, atualizado: now(), log: [...(atual.log || []), { t: now(), ev }] }); } catch {} };
  let armFech = false;
  document.querySelectorAll("[data-e]").forEach((x) => (x.onclick = () => { if (x.dataset.e === n.etapa) return;
    if (x.dataset.e === "fechado" && !(n.comissao && n.comissao.acordado) && !armFech) { armFech = true; toast("A divisão de honorários ainda não está acordada. Defina a comissão antes de fechar, ou toque de novo para fechar assim (fica registrado)."); return; }
    save({ etapa: x.dataset.e }, "Etapa: " + etapaNome(x.dataset.e) + (x.dataset.e === "fechado" && !(n.comissao && n.comissao.acordado) ? " · sem divisão acordada" : "")); }));
  $("add").onclick = () => { const t = $("nt").value.trim(); if (t) save({}, t); };
  $("lost").onclick = () => (perdido ? save({ etapa: n.etapa_ant || "teaser" }, "Negócio reaberto") : save({ etapa: "perdido", etapa_ant: n.etapa }, "Marcado como perdido"));
  const vo = $("vo"); if (vo) vo.onclick = () => go({ v: "oferta", id: o.id });
  const comp = o ? PC.completude(o) : { ok: true };
  let armado = false;
  $("pdf").onclick = async () => {
    if (!comp.ok && !armado) { armado = true; $("pdf").textContent = "Gerar mesmo assim"; toast(`Ficha mínima em ${comp.pct}%: peça os dados ao anunciante. Toque de novo para gerar assim mesmo (fica registrado).`); return; }
    const r = await gerarPDF(o, { negocio: n, briefing: b, destinatario: n.parceiro, incompleta: !comp.ok }); if (r) save({}, `Ficha PDF emitida (${r})${comp.ok ? "" : " · incompleta"}`); };
  const ec = $("edcom"); if (ec) ec.onclick = () => go({ v: "comissao", id: n.id });
  const ap = $("acpdf"); if (ap) ap.onclick = () => gerarAcordo(n, o, b);
  $("dvis").onclick = () => gerarVisita(n, o, b);
  const dr = $("drec"); if (dr) dr.onclick = () => gerarRecibo(n, o);
  const ds = $("dspl"); if (ds) ds.onclick = () => copiarClausula(n);
};
function clienteDo(n, b) { const cli = b ? C(b.cliente) : null; const sl = n.sala ? S.salas.find((x) => x.id === n.sala) : null; return { nome: (cli && (cli.empresa || cli.nome)) || sl?.aceite?.razao || n.parceiro || "", doc: cli?.documento || sl?.aceite?.documento || "", resp: (cli && cli.empresa ? cli.nome : "") || sl?.aceite?.responsavel || "", tel: cli?.telefone || sl?.aceite?.telefone || n.tel || "" }; }
async function emitirDoc(tipo, doc, nome, n, o, conteudo) { const blob = doc.output("blob"); await emitir({ tipo, negocio_id: n.id, oferta_id: n.oferta, briefing_id: n.briefing, nome_arquivo: nome, pdf_base64: await blobToBase64(blob), conteudo }); const at = N(n.id) || n; await store.save("negocios", { ...at, atualizado: now(), log: [...(at.log || []), { t: now(), ev: conteudo.split("\n")[0] }] }); await compartilharOuBaixar(blob, nome); }
async function gerarVisita(n, o, b) {
  const cor = o ? corretorDaOferta(o) : perfilPorEmail(EU.usuario); const texto = preencherDoc(VISITA_PADRAO, {}, cor); const f = faltasDoc(texto); if (f.length) { toast(avisoFaltas(f)); return; }
  const cl = clienteDo(n, b);
  const doc = PC.pdfDoc(jsPDF, { kicker: "FICHA DE VISITA", ref: `NEGÓCIO · ${o?.codigo || ""}`, titulo: "Ficha de visita a imóvel", codigo: o?.codigo, corretor: cor, logos: LOGOS.dark ? LOGOS : null,
    dados: [["Visitante (nome / razão social)", cl.nome], ["CPF / CNPJ", cl.doc], ["Responsável", cl.resp], ["Telefone", cl.tel], ["Imóvel", o ? `${o.codigo || ""} · ${tituloO(o)}` : ""], ["Endereço do imóvel", o?.endereco || ""], ["Data e hora da visita", ""]],
    tituloTexto: "DECLARAÇÃO", texto, versao: "Documento " + VERSAO_DOCS, assinaturas: [{ nome: cl.resp || cl.nome || "Visitante", sub: "Visitante" }, { nome: cor.nome, sub: `Corretor(a) · ${cor.creci}` }] });
  await emitirDoc("ficha_visita", doc, `Ficha_Visita_${o?.codigo || n.id}.pdf`, n, o, `Ficha de visita emitida · ${cl.nome || "visitante"}`);
}
async function gerarRecibo(n, o) {
  const c = PC.calcComissao(n.comissao); const pc = c.partes.find(PC.ehPC); if (!pc) { toast("A PrimeCorp não está na divisão deste negócio."); return; }
  const cor = o ? corretorDaOferta(o) : perfilPorEmail(EU.usuario); const rec = PC.recebedor(n.comissao);
  const pagador = rec && !PC.ehPC(rec) ? rec.nome || rec.papel : "";
  const vars = { PAGADOR: pagador || "______________________________", VALOR_RECIBO: PC.brl2(pc.valor), VALOR_EXTENSO: reaisExtenso(pc.valor), OPERACAO: c.base === "venda" ? "venda" : "locação", CODIGO: o?.codigo || "", TITULO: o ? tituloO(o) : "", PCT: PC.nf(pc.pct) + "%", TOTAL: PC.brl2(c.total) };
  const texto = preencherDoc(RECIBO_PADRAO, vars, cor);
  const doc = PC.pdfDoc(jsPDF, { kicker: "RECIBO DE HONORÁRIOS", ref: `REF. ${o?.codigo || ""}`, titulo: `Recibo · ${PC.brl2(pc.valor)}`, codigo: o?.codigo, corretor: cor, logos: LOGOS.dark ? LOGOS : null,
    dados: [["Recebedor", `${cor.nome} · ${cor.creci}`], ["Pagador", pagador], ["CPF / CNPJ do pagador", ""], ["Valor", `${PC.brl2(pc.valor)} (${reaisExtenso(pc.valor)})`], ["Forma de pagamento", ""]],
    tituloTexto: "RECIBO", texto, assinaturas: [{ nome: cor.nome, sub: `Corretor(a) de imóveis · ${cor.creci}` }] });
  await emitirDoc("recibo", doc, `Recibo_Honorarios_${o?.codigo || n.id}.pdf`, n, o, `Recibo da parcela PrimeCorp: ${PC.brl2(pc.valor)}`);
}
function textoClausula(com) {
  const c = PC.calcComissao(com); const venda = c.base === "venda";
  const linhas = c.partes.map((p, i) => `${String.fromCharCode(97 + i)}) ${PC.nomeParte(p)} (${PC.ehPC(p) ? "corretor de imóveis" : p.papel.toLowerCase()}), ${p.creci || (PC.ehPC(p) ? "CRECI-SP 297692" : "CRECI ______")}: ${PC.nf(p.pct)}%, equivalente a ${PC.brl2(p.valor)} (${reaisExtenso(p.valor)}), por PIX ou depósito: ${p.pix || "______________________"};`).join("\n");
  return PC.preencher(CLAUSULA_SPLIT, { PAGADOR_PAPEL: venda ? "VENDEDOR" : "LOCADOR", TOTAL: PC.brl2(c.total), TOTAL_EXTENSO: reaisExtenso(c.total), MOMENTO: venda ? "no ato da assinatura deste instrumento" : "no ato da assinatura deste contrato", LINHAS_SPLIT: linhas });
}
async function copiarClausula(n) { const t = textoClausula(n.comissao); await copiar(t); toast("Cláusula copiada: cole no contrato de locação ou no compromisso de compra e venda."); }
async function gerarMandato(b) {
  const cor = perfilPorEmail(EU.usuario); const op = PC.norm(b.operacao || ""); const texto = preencherDoc(MANDATO_PADRAO, { OPERACAO: op.startsWith("venda") || op.startsWith("compra") ? "compra" : op.includes("venda") ? "compra ou locação" : "locação" }, cor);
  const f = faltasDoc(texto); if (f.length) { toast(avisoFaltas(f)); return; }
  const cli = C(b.cliente);
  const doc = PC.pdfDoc(jsPDF, { kicker: "MANDATO DE BUSCA", ref: "CONTRATO COM O CLIENTE", titulo: "Contrato de intermediação para busca de imóvel", corretor: cor, logos: LOGOS.dark ? LOGOS : null,
    dados: [["Cliente (nome / razão social)", cli ? cli.empresa || cli.nome : ""], ["CPF / CNPJ", cli?.documento || ""], ["Representante", cli && cli.empresa ? cli.nome : ""], ["E-mail / telefone", [cli?.email, cli?.telefone].filter(Boolean).join(" · ")], ["Demanda (briefing)", [b.tipo, b.operacao, b.cidades || b.regiao, faixaArea(b)].filter(Boolean).join(" · ")], ["Exclusividade", "(  ) Sim   (  ) Não"]],
    tituloTexto: "CLÁUSULAS", texto, versao: "Documento " + VERSAO_DOCS, assinaturas: [{ nome: cli ? cli.nome || cli.empresa : "Cliente", sub: "Contratante" }, { nome: cor.nome, sub: `Contratado · ${cor.creci}` }] });
  const blob = doc.output("blob"); const nome = `Mandato_Busca_${(nomeB(b) || "cliente").replace(/[^\w]+/g, "_").slice(0, 40)}.pdf`;
  await emitir({ tipo: "mandato", briefing_id: b.id, contato_id: b.cliente || null, destinatario: cli ? nomeC(cli) : "", nome_arquivo: nome, pdf_base64: await blobToBase64(blob), conteudo: "Mandato de busca · " + nomeB(b) });
  await compartilharOuBaixar(blob, nome);
}
async function gerarAcordo(n, o, b) {
  const cfg = CFG(); const texto0 = cfg.acordo || ACORDO_PADRAO;
  const falt = faltasDoc(preencherDoc(texto0, {}, null));
  if (!cfg.acordo_revisado || falt.length) { toast(falt.length ? avisoFaltas(falt) : "Antes: revise o acordo com seu advogado e marque a revisão em Configurações."); return go({ v: "config" }); }
  try {
    const d = o ? PC.num(o) : {}; const cli = b ? C(b.cliente) : null; const sl = n.sala ? S.salas.find((x) => x.id === n.sala) : null;
    const base = { codigo: o?.codigo || "", titulo: o ? tituloO(o) : "", tipo: d.tipo, cliente: (cli && (cli.empresa || cli.nome)) || sl?.aceite?.razao || (b ? nomeB(b) : ""), comissao: n.comissao };
    const texto = preencherDoc(texto0, PC.varsAcordo(base), o ? corretorDaOferta(o) : null);
    const doc = PC.pdfAcordo(jsPDF, { ...base, texto, versao: cfg.acordo_versao || ACORDO_VERSAO, corretor: o ? corretorDaOferta(o) : eu(), logos: LOGOS.dark ? LOGOS : null });
    const blob = doc.output("blob"); const nome = `Acordo_Divisao_Honorarios_${base.codigo || n.id}.pdf`;
    const c = PC.calcComissao(n.comissao);
    const em = await emitir({ tipo: "acordo_comissao", negocio_id: n.id, oferta_id: n.oferta, briefing_id: n.briefing, destinatario: c.partes.filter((p) => !PC.ehPC(p)).map((p) => p.nome || p.papel).join(", "), nome_arquivo: nome, pdf_base64: await blobToBase64(blob), conteudo: `Honorários ${PC.brl2(c.total)} · ${PC.quadroComissao(n.comissao)}`, meta: { partes: c.partes.length } });
    const atual = N(n.id) || n;
    await store.save("negocios", { ...atual, acordo_emitido: now(), atualizado: now(), log: [...(atual.log || []), { t: now(), ev: `Acordo de divisão emitido${em ? " (" + em.codigo + ")" : ""}: ${c.partes.length} partes` }] });
    await compartilharOuBaixar(blob, nome);
  } catch (e) { toast("Não foi possível gerar o acordo: " + e.message); }
}
function cardComissao(n, o) {
  if (!n.comissao) return `<div class="card"><div class="row" style="justify-content:space-between"><h2>Comissão</h2><button class="sm p" id="edcom">Definir divisão</button></div><p class="hint">Defina os honorários e a divisão entre imobiliária, corretor parceiro e PrimeCorp.${o && o.autorizacao ? " A autorização do anunciante já traz a divisão aceita." : ""}</p></div>`;
  const c = PC.calcComissao(n.comissao);
  return `<div class="card"><div class="row" style="justify-content:space-between"><h2>Comissão</h2><button class="sm" id="edcom">Editar</button></div>
  <p><b>${esc(PC.brl2(c.total) || "R$ 0")}</b> <span class="hint">· ${esc(PC.textoComissao(n.comissao))} · base ${esc(PC.brl(c.valor) || "—")}</span></p>
  <ul class="log">${c.partes.map((p) => `<li><time>${esc(PC.nf(p.pct))}%</time><span><b>${esc(p.papel)}</b>${p.nome && !PC.ehPC(p) ? " · " + esc(p.nome) : ""}${p.creci ? " · " + esc(creciTxt(p.creci)) : ""}<br>${esc(PC.brl2(p.valor) || "")}</span></li>`).join("")}</ul>
  ${c.erros.length ? `<p class="status err">${esc(c.erros.join(" "))}</p>` : ""}${c.avisos.length ? `<p class="note">${esc(c.avisos.join(" "))}</p>` : ""}
  <p class="hint">Recebe e repassa: <b>${esc(PC.nomeParte(PC.recebedor(n.comissao)))}</b></p>
  ${c.ok ? `<button class="p" style="width:100%" id="acpdf">Acordo de divisão (PDF para assinatura)</button>` : ""}
  <p class="hint">${n.comissao.acordado ? "Divisão acordada em " + esc(fdt(n.comissao.acordado_em)) : "Divisão ainda não marcada como acordada"}${n.acordo_emitido ? " · acordo emitido em " + esc(fdt(n.acordo_emitido)) : ""}</p></div>`;
}

/* ================= OFERTAS ================= */
VIEWS.ofertas = () => {
  header("Ofertas"); const f = route.f || "todas"; const sg = route.g || (eu().foco === "residencial" ? "residencial" : "todos");
  const SEGS = [["todos", "Todos"], ["residencial", "Residencial"], ["comercial", "Galpões e comerciais"], ["rural", "Rurais e terrenos"]];
  const noSeg = (o) => { const g = PC.grupo(o.tipo); return sg === "todos" || (sg === "residencial" && g === "residencial") || (sg === "comercial" && (g === "galpao" || g === "comercial")) || (sg === "rural" && (g === "rural" || g === "area")); };
  let os = [...S.ofertas].sort((a, b) => (b.criado || "").localeCompare(a.criado || ""));
  if (f === "nova") os = os.filter((o) => o.status === "nova"); else if (f === "descartada") os = os.filter((o) => o.status === "descartada"); else os = os.filter((o) => o.status !== "descartada");
  os = os.filter(noSeg);
  $("main").innerHTML = `<button class="p" id="nv">+ Nova oferta por link</button><div class="chips segs">${SEGS.map(([k, l]) => `<button class="chip ${sg === k ? "on" : ""}" data-g="${k}">${l}</button>`).join("")}</div><div class="seg">${[["todas", "Ativas"], ["nova", "A revisar"], ["descartada", "Descartadas"]].map(([k, l]) => `<button data-f="${k}" class="${f === k ? "on" : ""}">${l}</button>`).join("")}</div>
  <input id="q" placeholder="Buscar por código, cidade, tipo ou título" value="${esc(route.q || "")}">
  <div class="card"><div class="list" id="ls"></div></div>`;
  const draw = () => { const q = PC.norm($("q").value); const rows = os.filter((o) => !q || PC.norm([o.codigo, tituloO(o), o.cidade, o.tipo, o.regiao, o.origem].join(" ")).includes(q));
    $("ls").innerHTML = rows.map((o) => { const c = chkOf(o); return `<button class="item" data-o="${o.id}"><span class="dot ${c.sem}"></span><span class="t"><b>${esc((o.codigo ? o.codigo + " · " : "") + tituloO(o))}</b><span>${esc([o.cidade, o.origem, o.status === "nova" ? "a revisar" : o.status === "captacao" ? "em captação" : ""].filter(Boolean).join(" · "))}</span></span><span class="chip">${esc(o.operacao || "")}</span></button>`; }).join("") || '<p class="empty">Nada por aqui.</p>';
    $("ls").querySelectorAll("[data-o]").forEach((x) => (x.onclick = () => { route.q = $("q").value; go({ v: "oferta", id: x.dataset.o }); })); };
  draw(); $("q").addEventListener("input", draw);
  document.querySelectorAll(".seg [data-f]").forEach((x) => (x.onclick = () => { route = { v: "ofertas", f: x.dataset.f, g: sg }; render(); }));
  document.querySelectorAll(".segs [data-g]").forEach((x) => (x.onclick = () => { route = { v: "ofertas", f, g: x.dataset.g }; render(); }));
  $("nv").onclick = () => go({ v: "nova" });
};
const OFORM = `
<fieldset><legend>Origem (privado)</legend><div class="grid">
<label>Origem<select data-f="origem"><option>Portal</option><option>Alerta de portal</option><option>Imobiliária</option><option>Corretor parceiro</option><option>Leilão</option><option>Proprietário</option></select></label>
<label>Status<select data-f="status"><option value="nova">A revisar</option><option value="revisada">Revisada</option><option value="descartada">Descartada</option></select></label>
<label class="full">Link do anúncio<input data-f="link" type="url" inputmode="url"></label>
<label>Anunciante é<select data-f="anunciante_tipo"><option>Imobiliária</option><option>Corretor</option><option>Proprietário</option></select></label><label>Anunciante<input data-f="anunciante"></label><label>Contato do anunciante<input data-f="anunciante_contato" type="tel"></label><label>CRECI do anunciante<input data-f="anunciante_creci"></label>
</div></fieldset>
<fieldset><legend>Identificação</legend><div class="grid">
<label>Tipo<select data-f="tipo">${TIPOS_IMOVEL.map((t) => `<option>${t}</option>`).join("")}</select></label>
<label>Operação<select data-f="operacao"><option>Locação</option><option>Venda</option><option>Locação / Venda</option></select></label>
<label>Cidade<input data-f="cidade"></label><label>UF<input data-f="uf" maxlength="2" style="text-transform:uppercase"></label>
<label class="full">Região / bairro / eixo (vai no teaser e na sala)<input data-f="regiao" placeholder="Eixo Anhanguera (RMC) · Jardim X · zona rural"></label>
<label class="full">Acesso / destaque (sem endereço)<input data-f="subtitulo" placeholder="acesso direto pela Rod. Anhanguera"></label>
<label class="full">Tipologia<input data-f="tipologia" placeholder="Isolado / em condomínio"></label></div></fieldset>
<fieldset data-g="residencial"><legend>Residencial</legend><div class="grid">
<label>Dormitórios<input data-f="dormitorios" inputmode="numeric"></label><label>Suítes<input data-f="suites" inputmode="numeric"></label>
<label>Banheiros<input data-f="banheiros" inputmode="numeric"></label><label>Vagas<input data-f="vagas" inputmode="numeric"></label></div></fieldset>
<fieldset data-g="rural"><legend>Rural</legend><div class="grid">
<label class="u">Área total<input data-f="area_ha" inputmode="decimal"><span>ha</span></label><label class="u">Até o asfalto<input data-f="distancia_asfalto" inputmode="decimal"><span>km</span></label>
<label class="full">Aptidão / uso<input data-f="aptidao" placeholder="pasto, lavoura, eucalipto, lazer"></label>
<label class="full">Água<input data-f="agua" placeholder="rio, nascentes, represa, poço"></label>
<label class="full">Benfeitorias<input data-f="benfeitorias" placeholder="sede, casas, curral, barracões, cercas"></label>
<label>Topografia<input data-f="topografia"></label><label>CAR<input data-f="car"></label><label>CCIR e ITR<input data-f="ccir"></label><label>Georreferenciamento<input data-f="georref"></label></div>
<p class="hint">1 alqueire paulista = 2,42 ha · 1 alqueire mineiro = 4,84 ha</p></fieldset>
<fieldset data-g="galpao comercial area residencial"><legend>Áreas</legend><div class="grid">
<label data-g="galpao comercial" class="u">Fabril / galpão<input data-f="fabril" inputmode="decimal"><span>m²</span></label>
<label data-g="galpao comercial residencial" class="u">Construída<input data-f="construida" inputmode="decimal"><span>m²</span></label>
<label class="u">Terreno<input data-f="terreno" inputmode="decimal"><span>m²</span></label>
<label data-g="galpao comercial" class="u">Administrativo<input data-f="administrativo" inputmode="decimal"><span>m²</span></label>
<label data-g="galpao comercial" class="u">Apoio / outros<input data-f="apoio" inputmode="decimal"><span>m²</span></label>
<label data-g="galpao comercial area" class="u">Frente (terreno)<input data-f="frente" inputmode="decimal"><span>m</span></label><label data-g="galpao comercial area">Zoneamento<input data-f="zoneamento"></label></div></fieldset>
<fieldset data-g="galpao comercial"><legend>Estrutura</legend><div class="grid3">
<label class="u">Pé-direito<input data-f="pe_direito" inputmode="decimal"><span>m</span></label>
<label class="u">Piso<input data-f="piso_carga" inputmode="decimal"><span>t/m²</span></label>
<label>Docas<input data-f="docas" inputmode="numeric"></label>
<label class="u">Energia<input data-f="energia_kva" inputmode="decimal"><span>kVA</span></label>
<label>Pontes rol.<input data-f="pontes"></label><label>AVCB<input data-f="avcb"></label></div>
<label>Data do anúncio / material<input data-f="data_anuncio" type="date"></label></fieldset>
<fieldset><legend>Valores</legend><div class="grid">
<label class="u">Aluguel mensal<input data-f="aluguel" inputmode="decimal"><span>R$</span></label>
<label class="u">Venda<input data-f="venda" inputmode="decimal"><span>R$</span></label>
<label class="u">Condomínio<input data-f="condominio" inputmode="decimal"><span>R$</span></label>
<label class="u">IPTU<input data-f="iptu" inputmode="decimal"><span>R$</span></label>
<label class="full">IPTU é<select data-f="iptu_periodo"><option value="">Periodicidade não informada</option><option value="mensal">Mensal</option><option value="anual">Anual</option></select></label>
<label class="full">Disponibilidade<input data-f="disponibilidade" placeholder="Imediata / a partir de…"></label><label class="full">Documentação<input data-f="documentacao" placeholder="Matrícula regular, construção averbada…"></label></div></fieldset>
<fieldset><legend>Texto da ficha</legend>
<label>Título<input data-f="titulo" placeholder="(automático)"></label>
<label>Descrição<textarea data-f="descricao" rows="4"></textarea></label>
<label>Diferenciais (um por linha)<textarea data-f="diferenciais" rows="3"></textarea></label>
<label>Itens a confirmar extras (um por linha)<textarea data-f="itens" rows="2"></textarea></label></fieldset>`;
function fillForm(root, o) { root.querySelectorAll("[data-f]").forEach((el) => { const k = el.dataset.f; const v = o[k]; if (el.tagName === "SELECT") { const opt = [...el.options].find((x) => (x.value || x.text).toLowerCase() === String(v || "").toLowerCase()); if (opt) el.value = opt.value || opt.text; else el.selectedIndex = 0; } else el.value = fmtIn(k, v); }); const t = root.querySelector('[data-f="tipo"]'); if (t) { aplicarGrupo(root, t.value); t.addEventListener("change", () => aplicarGrupo(root, t.value)); } }
function readForm(root) { const o = {}; root.querySelectorAll("[data-f]").forEach((el) => (o[el.dataset.f] = el.value.trim())); if (o.uf) o.uf = o.uf.toUpperCase(); return o; }
const SEM = { verde: ["VERDE", "Pode circular com parceiros."], amarelo: ["AMARELO", "Circular com os itens a confirmar."], vermelho: ["VERMELHO", "Ligar para o anunciante antes de circular."] };
VIEWS.oferta = () => {
  const o = O(route.id); if (!o) return back(); header(o.codigo ? "Oferta " + o.codigo : "Oferta");
  const peds = S.pedidos.filter((p) => p.oferta === o.id).sort((a, b) => (b.criado || "").localeCompare(a.criado || ""));
  const au = o.autorizacao;
  const fontes = Object.keys(o.fontes || {}).filter((k) => o.fontes[k] === "anunciante");
  $("main").innerHTML = `<div class="card"><h2>Ficha mínima</h2><div class="meter"><i id="cbar"></i></div><p id="ctxt" class="hint"></p><ul class="alerts" id="cfal"></ul>
  ${o.revisar_anunciante ? `<p class="note">O anunciante enviou ${fontes.length} informação(ões)${au ? " e autorizou a indicação" : ""}. Confira os campos marcados e salve.</p>` : ""}
  <h3>Anunciante</h3><p>${esc(o.anunciante || "Não informado")}${o.anunciante_tipo ? " · " + esc(o.anunciante_tipo) : ""}${o.anunciante_creci ? " · CRECI " + esc(o.anunciante_creci) : ""}</p>
  ${au ? `<p class="tag ok" style="align-self:flex-start">Autorização aceita em ${esc(fdt(au.em))} por ${esc(au.responsavel)} (${esc(au.razao)})${au.creci ? " · CRECI " + esc(au.creci) : ""}</p>` : '<p class="hint">Sem autorização de indicação registrada.</p>'}
  ${peds.length ? `<div class="list">${peds.map((p) => `<button class="item" data-p="${p.id}"><span class="dot ${p.aceite ? "verde" : p.respondido_em ? "amarelo" : ""}"></span><span class="t"><b>Pedido de ${esc(fdt(p.criado))}</b><span>${esc(STATUS_P[p.status] || p.status)}</span></span></button>`).join("")}</div>` : ""}
  ${o.anunciante_contato || o.anunciante_email ? `<p class="hint">Contato do anúncio: ${esc([o.anunciante_contato, o.anunciante_email].filter(Boolean).join(" · "))}</p>` : ""}
  ${!au && o.origem !== "Captação própria" ? `<button class="p" id="verde">🟢 Sinal verde: pedir dados e autorização</button><p class="hint">Gera o link para o anunciante com as perguntas que faltam, o termo de parceria e a comissão padrão, e abre o WhatsApp do anunciante com a mensagem pronta.</p>` : ""}
  <button class="${au || o.origem !== "Captação própria" ? "" : "p"}" id="solic">${au ? "Novo pedido ao anunciante" : "Pedido personalizado ao anunciante"}</button></div>
  ${cardVerif(o)}
  <div class="card"><div class="row" style="justify-content:space-between"><h2>Para despertar interesse</h2><button class="sm" id="tz">Copiar teaser</button></div>
  <p class="hint">Texto curto para cliente ou parceiro: faixas de área e valor, sem endereço e sem o nome do anunciante.</p><pre class="teaserbox" id="tzt"></pre></div>
  ${(o.imagens_ref || []).length || (o.fotos_aut || []).length || o.link ? `<div class="card"><div class="row" style="justify-content:space-between"><h2>Fotos do anúncio</h2>${o.link ? '<button class="sm" id="reler">Reler anúncio</button>' : ""}</div>
  ${(o.fotos_aut || []).length ? `<p class="tag ok" style="align-self:flex-start">${o.fotos_aut.length} foto(s) guardada(s) com autorização</p><div class="thumbs">${o.fotos_aut.map((f) => `<div class="th"><img loading="lazy" src="${fotoURL(f.k)}" alt=""></div>`).join("")}</div>` : ""}
  ${(o.imagens_ref || []).length ? `<p class="hint">${o.imagens_ref.length} foto(s) encontrada(s) no anúncio. <b>Uso interno</b>: as fotos são do anunciante; envie ao cliente só depois da autorização.</p><div class="thumbs">${o.imagens_ref.slice(0, 12).map((u) => `<div class="th"><img loading="lazy" referrerpolicy="no-referrer" src="/api/img-ref?u=${encodeURIComponent(u)}${o.link ? "&de=" + encodeURIComponent(o.link) : ""}" alt="" onerror="this.parentNode.remove()"></div>`).join("")}</div>
    ${au || o.autorizacao_manual ? `<button id="guardar">Guardar fotos autorizadas no sistema</button>` : ""}` : '<p class="hint">Nenhuma foto lida neste anúncio.</p>'}<div class="status" id="stf"></div></div>` : ""}
  <div class="card" id="fo">${OFORM}</div>
  <div class="card"><h2>Checagem</h2><div class="sem" id="sem"><i></i><div><span id="semT"></span><small id="semS"></small></div></div><div class="priv" id="priv" hidden></div><ul class="alerts" id="al"></ul><p class="hint">O semáforo fica só aqui. Na ficha, os alertas viram “itens a confirmar”.</p></div>
  <div class="card"><div class="row"><button class="p grow" id="sv">Salvar</button><button class="grow" id="pdf">Ficha PDF</button></div><div id="pdfnote"></div>
  ${o.link ? `<a class="btn sm" href="${esc(o.link)}" target="_blank" rel="noopener">Abrir anúncio original</a>` : ""}<button class="g" id="del">Excluir oferta</button></div>`;
  const root = $("main"); fillForm(root, o); editing = true; fillCert(o);
  fontes.forEach((k) => { const el = root.querySelector(`[data-f="${k}"]`); if (el) { el.classList.add("doanunciante"); el.title = "Informado pelo anunciante"; } });
  document.querySelectorAll("[data-p]").forEach((x) => (x.onclick = () => go({ v: "pedido", id: x.dataset.p })));
  $("tzt").textContent = PC.teaser({ ...o, ...readForm(root) }, chkOf(o), o.codigo || "", corretorDaOferta(o));
  $("tz").onclick = () => copiar(PC.teaser({ ...o, ...readForm(root) }, chkOf({ ...o, ...readForm(root) }), o.codigo || "", corretorDaOferta(o)));
  const vb = $("verde"); if (vb) vb.onclick = async () => { vb.disabled = true; const cur = { ...o, ...readForm(root) }; editing = false; try { await store.save("ofertas", { ...cur, atualizado: now() }); const ped = await sinalVerde(O(o.id)); if (ped) { toast("Pedido criado. Envie ao anunciante."); go({ v: "pedido", id: ped.id }); } } catch (e) { toast("Falhou: " + e.message); vb.disabled = false; editing = true; } };
  const rl = $("reler"); if (rl) rl.onclick = async () => { rl.disabled = true; rl.textContent = "Lendo…"; try { const x = await api("extrair", { method: "POST", body: JSON.stringify({ modo: "um", texto: "", url: o.link }) }); const at = O(o.id) || o; const p = { imagens_ref: x.imagens_ref || at.imagens_ref || [], lido_em: now() }; if (!at.anunciante_contato && x.contatos_ref?.telefones?.[0]) p.anunciante_contato = x.contatos_ref.telefones[0]; if (!at.anunciante_email && x.contatos_ref?.emails?.[0]) p.anunciante_email = x.contatos_ref.emails[0]; editing = false; await store.save("ofertas", { ...at, ...p, atualizado: now() }); toast(`${(p.imagens_ref || []).length} foto(s) no anúncio.`); render(); } catch (e) { toast(e.message); rl.disabled = false; rl.textContent = "Reler anúncio"; } };
  const gd = $("guardar"); if (gd) gd.onclick = async () => { gd.disabled = true; const st = $("stf"); const urls = (o.imagens_ref || []).slice(0, 30); const ja = new Set((o.fotos_aut || []).map((f) => f.origem)); const novas = [];
    for (const [i, u] of urls.entries()) { if (ja.has(u)) continue; st.textContent = `Guardando ${i + 1} de ${urls.length}…`;
      try { const r = await fetch("/api/img-ref?u=" + encodeURIComponent(u) + (o.link ? "&de=" + encodeURIComponent(o.link) : ""), { credentials: "same-origin" }); if (!r.ok) continue; const b = await r.blob(); const t = await tratarFoto(new File([b], "f", { type: b.type }), { lado: 1920, tratar: false }); const up = await api("fotos", { method: "POST", body: JSON.stringify({ oferta: o.id, jpeg_base64: await blobB64(t.blob) }) }); novas.push({ k: up.k, origem: u, em: now() }); } catch {} }
    const at = O(o.id) || o; editing = false; await store.save("ofertas", { ...at, fotos_aut: [...(at.fotos_aut || []), ...novas], atualizado: now() }); toast(`${novas.length} foto(s) guardada(s).`); render(); };
  $("solic").onclick = async () => { const cur = { ...o, ...readForm(root) }; editing = false; try { await store.save("ofertas", { ...cur, atualizado: now() }); } catch { editing = true; return; } go({ v: "novopedido", o: o.id }); };
  const upd = () => { if (!$("sem")) return; const cur = { ...o, ...readForm(root) }; const c = chkOf(cur);
    $("sem").className = "sem " + c.sem; $("semT").textContent = SEM[c.sem][0]; $("semS").textContent = SEM[c.sem][1];
    $("al").innerHTML = c.alerts.map((a) => `<li class="${a.lvl}">${esc(a.msg)}</li>`).join("") || '<li class="ok">Dados completos e coerentes.</li>';
    $("priv").hidden = !c.privacy; $("priv").textContent = c.privacy || ""; root.querySelector('[data-f="titulo"]').placeholder = PC.autoTitle(PC.num(cur));
    cur.certidoes = readCert(); pintarVerif(cur);
    const cp = PC.completude(cur); $("cbar").style.width = cp.pct + "%"; $("cbar").className = cp.ok ? "ok" : cp.pct >= 60 ? "mid" : "";
    $("ctxt").textContent = cp.ok ? "Completa: pode gerar a ficha e a autorização." : `${cp.pct}% preenchida · ${cp.faltam.filter((f) => !f.extra).length} informação(ões) básica(s) faltando.`;
    $("cfal").innerHTML = cp.faltam.filter((f) => !f.extra).map((f) => `<li class="a">${esc(f.pergunta)}</li>`).join("");
    return cur; };
  upd(); root.addEventListener("input", () => { clearTimeout(upd._t); upd._t = setTimeout(upd, 200); }); root.addEventListener("change", upd);
  $("sv").onclick = async () => { const cur = upd(); const st = cur.status === "nova" ? "revisada" : cur.status; editing = false; try { await store.save("ofertas", { ...cur, status: st, revisar_anunciante: false, atualizado: now() }); toast("Oferta salva" + (o.status === "nova" ? " e marcada como revisada." : ".")); varrerSeMudou(o, cur); back(); } catch { editing = true; } };
  ligarVerif(o, root, upd);
  let armed = false;
  $("pdf").onclick = async () => {
    const neg = S.negocios.find((n) => n.oferta === o.id && PC.etapaIdx(n.etapa) >= PC.etapaIdx("termo"));
    const cp = PC.completude({ ...o, ...readForm(root) });
    if ((!neg || !cp.ok) && !armed) { armed = true; $("pdfnote").innerHTML = `<p class="note">${!neg ? "Ficha é nível 2: envie só a quem assinou o termo. " : ""}${!cp.ok ? `Ficha mínima em ${cp.pct}%: o ideal é pedir os dados ao anunciante antes. ` : ""}Toque de novo para gerar mesmo assim (fica registrado).</p>`; $("pdf").textContent = "Gerar mesmo assim"; return; }
    const cur = upd(); editing = false; try { await store.save("ofertas", { ...cur, atualizado: now() }); } catch { editing = true; return; }
    await gerarPDF(O(o.id), { negocio: neg || null, semTermo: !neg, incompleta: !cp.ok });
  };
  confirmar2($("del"), "Toque de novo para excluir", async () => { editing = false; await store.del("ofertas", o.id); back(); });
};
async function gerarPDF(o, ctx = {}) {
  try {
    const codigo = await garantirCodigo(o); const atual = O(o.id) || { ...o, codigo };
    const d = { ...PC.num(atual), codigo, corretor: corretorDaOferta(atual) }; const chk = PC.checks(PC.num(atual), hist(atual.id));
    const doc = PC.pdf(jsPDF, d, chk, LOGOS.dark ? LOGOS : null);
    const blob = doc.output("blob"); const nome = PC.filename(d).replace(/\.pdf$/, `_${codigo}.pdf`);
    const em = await emitir({ tipo: "ficha_pdf", oferta_id: atual.id, negocio_id: ctx.negocio?.id || null, briefing_id: ctx.negocio?.briefing || null, contato_id: ctx.negocio?.contato || null, destinatario: ctx.destinatario || ctx.negocio?.parceiro || "", nome_arquivo: nome, pdf_base64: await blobToBase64(blob), conteudo: tituloO(atual), meta: { codigo, sem_termo: !!ctx.semTermo, incompleta: !!ctx.incompleta } });
    await compartilharOuBaixar(blob, nome);
    return em ? em.codigo : codigo;
  } catch (e) { toast("Não foi possível gerar o PDF: " + e.message); return null; }
}

/* ================= NOVA (leitura) ================= */
VIEWS.nova = () => {
  header("Nova oferta"); const m = route.m || "um";
  $("main").innerHTML = `<div class="seg">${[["um", "Um anúncio"], ["varios", "E-mail de alerta"]].map(([k, l]) => `<button data-m="${k}" class="${m === k ? "on" : ""}">${l}</button>`).join("")}</div>
  <div class="card">${m === "um"
    ? `<p class="hint">Cole o link do anúncio (portal, imobiliária ou corretor; qualquer segmento) e toque em <b>Ler anúncio</b>. Se o portal bloquear a leitura, copie o texto do anúncio e cole abaixo.</p>
     <label>Link do anúncio<input id="url" type="url" inputmode="url" placeholder="https://…"></label>
     <label>Origem<select id="org"><option>Portal</option><option>Imobiliária</option><option>Corretor parceiro</option><option>Leilão</option><option>Proprietário</option></select></label>
     <label>Texto do anúncio (se o link não abrir)<textarea id="src" rows="5" placeholder="Opcional: cole o texto completo do anúncio…"></textarea></label>
     <div class="row"><button class="p grow" id="bx">Ler anúncio</button><button class="g" id="bm">Preencher manual</button></div>`
    : `<p class="hint">Cole o conteúdo inteiro de um e-mail de alerta (busca salva do portal). Cada anúncio vira uma oferta “a revisar”. Com a caixa de alertas configurada, isso acontece sozinho a cada 30 minutos.</p>
     <label>Conteúdo do e-mail<textarea id="src" rows="10" placeholder="Cole o e-mail inteiro…"></textarea></label>
     <button class="p" id="bx">Extrair ofertas</button>`}
  <div class="status" id="st"></div></div>`;
  editing = true; const st = $("st");
  document.querySelectorAll("[data-m]").forEach((x) => (x.onclick = () => { editing = false; route = { v: "nova", m: x.dataset.m }; render(); }));
  const fail = (e) => { st.className = "status err"; st.textContent = e.status === 422 ? e.message : "Não consegui extrair: " + e.message; };
  if (m === "um") {
    $("bm").onclick = async () => { const o = { id: uid("o"), link: $("url").value.trim(), origem: $("org").value, status: "nova", tipo: eu().foco === "residencial" ? "Casa" : "Galpão", operacao: eu().foco === "residencial" ? "Venda" : "Locação", responsavel: EU.usuario, criado: now(), atualizado: now() }; editing = false; await store.save("ofertas", o); stack.length = 0; go({ v: "oferta", id: o.id }, false); };
    $("bx").onclick = async () => { const txt = $("src").value.trim(); const url = $("url").value.trim();
      if (txt.length < 40 && !/^https?:\/\/\S+\.\S+/.test(url)) { st.className = "status err"; st.textContent = url ? "Link inválido: copie o endereço completo do anúncio (começa com https://)." : "Cole o link do anúncio ou o texto dele."; return; }
      const b = $("bx"); b.disabled = true; b.textContent = "Lendo…"; st.className = "status"; st.textContent = txt.length < 40 ? "Abrindo o link e lendo o anúncio (10 a 40 s)…" : "Lendo o anúncio (10 a 40 s)…";
      try { const x = await api("extrair", { method: "POST", body: JSON.stringify({ modo: "um", texto: txt, url }) });
        const link = $("url").value.trim(); const dup = link && S.ofertas.find((y) => y.link === link);
        const o = { id: uid("o"), link, origem: $("org").value, status: "nova", responsavel: EU.usuario, anunciante: x.anunciante || "", alertas_ia: Array.isArray(x.alertas_ia) ? x.alertas_ia : [], imagens_ref: Array.isArray(x.imagens_ref) ? x.imagens_ref.slice(0, 30) : [], anunciante_contato: x.contatos_ref?.telefones?.[0] || "", anunciante_email: x.contatos_ref?.emails?.[0] || "", lido_em: link ? now() : null, criado: now(), atualizado: now(), ...fromAI(x) };
        editing = false; await store.save("ofertas", o); stack.length = 0; go({ v: "oferta", id: o.id }, false);
        if (o.cep || o.endereco || o.proprietario_doc) api(`verificar/${o.id}`, { method: "POST" }).then((r) => { toast(`Varredura automática: índice ${r.avaliacao.pct}%`); sincronizar(true); }).catch(() => {});
        toast(dup ? "Atenção: esse link já existe na base (" + (dup.codigo || tituloO(dup)) + ")." : "Confira os dados e salve."); }
      catch (e) { fail(e); if (e.status === 422) $("src").focus(); } finally { b.disabled = false; b.textContent = "Ler anúncio"; } };
  } else {
    $("bx").onclick = async () => { const txt = $("src").value.trim();
      if (txt.length < 80) { st.className = "status err"; st.textContent = "Cole o conteúdo completo do e-mail."; return; }
      const b = $("bx"); b.disabled = true; b.textContent = "Extraindo…"; st.className = "status"; st.textContent = "Lendo o e-mail (até 60 s)…";
      try { const r = await api("extrair", { method: "POST", body: JSON.stringify({ modo: "varios", texto: txt }) }); const arr = Array.isArray(r.ofertas) ? r.ofertas : [];
        if (!arr.length) { st.className = "status err"; st.textContent = "Nenhum anúncio identificado."; return; }
        let n = 0, dup = 0; for (const x of arr.slice(0, 15)) { const link = String(x.link || "").trim(); if (link && S.ofertas.some((y) => y.link === link)) { dup++; continue; } const o = { id: uid("o"), link, origem: "Alerta de portal", status: "nova", anunciante: x.anunciante || "", criado: now(), atualizado: now(), ...fromAI(x) }; try { await store.save("ofertas", o); n++; } catch { break; } }
        editing = false; toast(`${n} oferta(s) criada(s)${dup ? `, ${dup} repetida(s) ignorada(s)` : ""}.`); stack.length = 0; go({ v: "ofertas", f: "nova" }, false); }
      catch (e) { fail(e); } finally { b.disabled = false; b.textContent = "Extrair ofertas"; } };
  }
};

/* ================= MAIS: relatórios, backup, configurações ================= */
VIEWS.mais = () => {
  if (CLIENTE()) return maisCliente();
  header("Mais");
  $("main").innerHTML = `<div class="card"><div class="menu">
  <button id="m10">Assistente · atendimento no WhatsApp <span>›</span></button><button id="m11">Agenda <span>›</span></button>
  <button id="m8">Anúncios publicados <span>›</span></button>${ehAdmin() ? '<button id="m9">Equipe e permissões <span>›</span></button><button id="m12">Contas Propto (clientes) <span>›</span></button>' : ""}
  <button id="m1">Nova oferta <span>›</span></button><button id="m2">Salas do Cliente <span>›</span></button><button id="m7">Anunciantes (pedidos e autorizações) <span>›</span></button><button id="m3">Relatórios emitidos <span>›</span></button>${ehAdmin() ? '<button id="m4">Backup <span>›</span></button><button id="m5">Configurações <span>›</span></button>' : ""}<button id="m6">Sair <span>›</span></button></div></div>
  <div class="card"><h3>Modo de tela</h3><p class="hint">Celular: registro de campo (câmera, voz, captação). Computador: gestão (painel largo, menu lateral, acompanha em tempo real o que chega do celular).</p>
  <div class="seg" id="modo">${[["auto", "Automático"], ["campo", "Celular"], ["escritorio", "Computador"]].map(([k, l]) => `<button data-modo="${k}" class="${(lerPref("pc_modo") || "auto") === k ? "on" : ""}">${l}</button>`).join("")}</div><p class="hint">Agora: <b>${MODO() === "escritorio" ? "computador (escritório)" : "celular (campo)"}</b></p></div>
  <div class="card"><h3>SAC · dúvidas, sugestões e reclamações</h3><p class="hint">Este e-mail aparece para clientes, anunciantes e proprietários nas páginas públicas (anúncio, Sala do Cliente e Sala do Anunciante).</p><div class="row"><b class="grow">${esc(PC.SAC)}</b><button class="sm" id="sacc">Copiar</button></div></div>
  <p class="foot">Conectado como ${esc(EU.usuario || usuarioAtual?.email || "")} · ${ehAdmin() ? "administrador" : "corretor(a)"}</p><p class="endosso">Propto Imóveis · propto.com.br</p>`;
  $("m1").onclick = () => go({ v: "nova" }); $("m2").onclick = () => go({ v: "salas" }); $("m3").onclick = () => go({ v: "relatorios" });
  if ($("m4")) $("m4").onclick = () => go({ v: "backup" }); if ($("m5")) $("m5").onclick = () => go({ v: "config" }); $("m7").onclick = () => go({ v: "pedidos" });
  $("m8").onclick = () => go({ v: "anuncios" }); $("m10").onclick = () => go({ v: "zoe" }); $("m11").onclick = () => go({ v: "agenda" }); if ($("m9")) $("m9").onclick = () => go({ v: "equipe" }); if ($("m12")) $("m12").onclick = () => go({ v: "contasPropto" });
  $("m6").onclick = async () => { try { await logout(); } catch {} telaLogin("Você saiu."); };
  $("sacc").onclick = () => copiar(PC.SAC);
  document.querySelectorAll("#modo [data-modo]").forEach((b) => (b.onclick = () => { gravarPref("pc_modo", b.dataset.modo === "auto" ? null : b.dataset.modo); aplicarModo(); render(); }));
};
const TIPOS_E = { matricula_lida: "Matrícula lida (IA)", verificacao_pdf: "Relatório de verificação", zoe_aviso: "Assistente · avisos", pacote_exportado: "Pacote exportado", teaser: "Teaser", ficha_pdf: "Ficha PDF", sala: "Sala criada", aceite: "Aceite de termo", interesse: "Interesse", pedido_anunciante: "Pedido ao anunciante", anunciante_dados: "Dados do anunciante", autorizacao: "Autorização do anunciante", comissao: "Comissão", acordo_comissao: "Acordo de divisão", ficha_visita: "Ficha de visita", recibo: "Recibo", mandato: "Mandato de busca", anuncio_publicado: "Anúncio publicado", coleta: "Coleta de alertas", restauracao: "Restauração" };
VIEWS.relatorios = async () => {
  header("Relatórios emitidos"); $("main").innerHTML = `<div class="card"><p class="hint">Carregando…</p></div>`;
  let em = []; try { em = (await api("emissoes?limite=500")).emissoes; } catch (e) { $("main").innerHTML = `<div class="card"><p class="status err">${esc(e.message)}</p></div>`; return; }
  if (route.v !== "relatorios") return;
  const f = route.f || "todos";
  const lista = em.filter((e) => f === "todos" || e.tipo === f);
  $("main").innerHTML = `<select id="ft"><option value="todos">Todos os tipos</option>${Object.entries(TIPOS_E).map(([k, l]) => `<option value="${k}" ${k === f ? "selected" : ""}>${l}</option>`).join("")}</select>
  <div class="card"><div class="list">${lista.map((e, i) => { const o = O(e.oferta_id); return `<details class="item" style="display:block;cursor:pointer"><summary style="display:flex;gap:10px;align-items:center;list-style:none"><span class="tag ${["aceite", "interesse", "autorizacao", "anunciante_dados"].includes(e.tipo) ? "ok" : ["ficha_pdf", "pedido_anunciante"].includes(e.tipo) ? "r" : ""}">${esc(TIPOS_E[e.tipo] || e.tipo)}</span><span class="t"><b>${esc(e.codigo)}${o ? " · " + esc((o.codigo ? o.codigo + " " : "") + tituloO(o)) : ""}</b><span>${esc(fdt(e.criado_em))}${e.destinatario ? " · " + esc(e.destinatario) : ""}${e.meta && e.meta.sem_termo ? " · SEM TERMO" : ""}${e.meta && e.meta.incompleta ? " · FICHA INCOMPLETA" : ""}</span></span></summary>
  ${e.conteudo ? `<pre class="wa" style="margin-top:8px">${esc(e.conteudo)}</pre>` : ""}${e.arquivo ? `<a class="btn sm" style="margin-top:8px" href="/api/arquivo?k=${encodeURIComponent(e.arquivo)}">Baixar PDF emitido</a>` : ""}</details>`; }).join("") || '<p class="empty">Nada emitido ainda.</p>'}</div></div>`;
  $("ft").onchange = () => { route = { v: "relatorios", f: $("ft").value }; render(); };
};
VIEWS.backup = async () => {
  header("Backup");
  $("main").innerHTML = `<div class="card"><h2>Backup agora</h2><p class="hint">Arquivo completo: CRM, briefings, ofertas, negócios, salas, configurações e o registro de emissões.</p><a class="btn p" href="/api/backup">Baixar backup completo</a></div>
  <div class="card"><h2>Backups automáticos</h2><p class="hint">Gerados todo dia às 03h15 (Brasília). Os últimos 30 ficam guardados.</p><div class="list" id="bl"><p class="hint">Carregando…</p></div></div>
  <div class="card"><h2>Restaurar</h2><p class="hint">Regrava os registros do arquivo por cima dos atuais com o mesmo identificador. Nada é apagado.</p>
  <input type="file" id="fi" accept="application/json,.json"><div id="rinfo"></div></div>`;
  try { const { backups } = await api("backups"); if (route.v !== "backup") return; $("bl").innerHTML = backups.map((k) => `<a class="item" href="/api/backups/${encodeURIComponent(k)}" style="text-decoration:none"><span class="t"><b>${esc(k.replace("backup-", "").replace(".json", ""))}</b></span><span class="chip">Baixar</span></a>`).join("") || '<p class="empty">Ainda nenhum. O primeiro sai na próxima madrugada.</p>'; } catch (e) { $("bl").innerHTML = `<p class="status err">${esc(e.message)}</p>`; }
  $("fi").onchange = async () => {
    const f = $("fi").files[0]; if (!f) return; let bk; try { bk = JSON.parse(await f.text()); } catch { $("rinfo").innerHTML = '<p class="status err">Arquivo inválido.</p>'; return; }
    const n = Array.isArray(bk.registros) ? bk.registros.length : 0; if (!n) { $("rinfo").innerHTML = '<p class="status err">Este arquivo não é um backup do sistema.</p>'; return; }
    $("rinfo").innerHTML = `<p class="note">${n} registros, gerado em ${esc(fdt(bk.gerado_em))}. Para restaurar, digite RESTAURAR:</p><input id="cf"><button class="p" id="go" style="margin-top:8px">Restaurar</button><div class="status" id="rs"></div>`;
    $("go").onclick = async () => { if ($("cf").value !== "RESTAURAR") { $("rs").className = "status err"; $("rs").textContent = "Digite RESTAURAR para confirmar."; return; }
      $("go").disabled = true; try { const r = await api("restaurar", { method: "POST", body: JSON.stringify({ confirmacao: "RESTAURAR", backup: bk }) }); await store.carregar(); toast(r.restaurados + " registros restaurados."); go({ v: "painel" }, false); } catch (e) { $("rs").className = "status err"; $("rs").textContent = e.message; $("go").disabled = false; } };
  };
};
VIEWS.config = async () => {
  header("Configurações"); const c = CFG();
  const termo = c.termo || TERMO_PADRAO;
  $("main").innerHTML = `<div class="card" id="fc"><h2>Seus dados na Sala do Cliente</h2><div class="grid">
  <label>Nome<input data-k="corretor_nome" value="${esc(c.corretor_nome || "Rodrigo França Viana")}"></label><label>CRECI<input data-k="corretor_creci" value="${esc(c.corretor_creci || "CRECI-SP 297692")}"></label>
  <label class="full">Endereço dos anúncios (opcional)<input data-k="anuncio_dominio" value="${esc(c.anuncio_dominio || "")}" placeholder="https://www.propto.com.br"></label>
  <label>WhatsApp<input data-k="corretor_whatsapp" value="${esc(c.corretor_whatsapp || "(19) 99805-1985")}"></label><label>E-mail<input data-k="corretor_email" value="${esc(c.corretor_email || "contato@primecorpconsultoria.com.br")}"></label></div>
  <h2>Prazos e foro dos documentos</h2>
  <p class="hint">Preenchimento manual. Os documentos usam estes valores escritos por extenso, ex.: "12 (doze) meses". Enquanto algum prazo usado por um documento estiver vazio, aquele documento não é emitido.</p>
  <div class="grid">${PRAZOS.map(([k, , l, un]) => `<label class="u">${esc(l)}<input data-k="${k}" inputmode="numeric" value="${esc(c[k] || "")}" placeholder="—"><span>${esc(un)}</span></label>`).join("")}
  <label>Foro (comarca)<input data-k="foro" value="${esc(c.foro || "Sumaré/SP")}"></label></div>
  <p class="hint">Documentos ${esc(VERSAO_DOCS)} · ${["{{CORRETOR}}", "{{PRAZO_…}}", "{{FORO}}"].join(", ")} são preenchidos automaticamente (o corretor é quem captou ou conduz o negócio).</p>
  <h2>Termo de Apresentação, Confidencialidade e Não-Contorno</h2>
  <p class="hint">É o texto que o cliente aceita antes de ver as opções. Revise com seu advogado. Cada sala guarda a versão aceita. <button class="sm g" data-rest="termo">Restaurar texto padrão ${esc(VERSAO_DOCS)}</button></p>
  <label>Versão<input data-k="termo_versao" value="${esc(c.termo_versao || TERMO_VERSAO)}"></label>
  <label>Texto<textarea data-k="termo" rows="16">${esc(termo)}</textarea></label>
  <label class="check"><input type="checkbox" id="rv" ${c.termo_revisado ? "checked" : ""}> Revisei o termo e autorizo o uso nas Salas do Cliente</label>
  <h2>Comissão padrão</h2><p class="hint">Valores sugeridos nos pedidos ao anunciante e nos negócios. Em cada negócio você ajusta.</p>
  <div class="grid"><label class="u">Venda<input data-k="com_venda_pct" inputmode="decimal" value="${esc(c.com_venda_pct || "6")}"><span>%</span></label><label class="u">Locação<input data-k="com_locacao_alugueis" inputmode="decimal" value="${esc(c.com_locacao_alugueis || "1")}"><span>aluguéis</span></label></div>
  <h3>Modelos de divisão</h3><div id="fm"></div><button class="sm" id="addm">+ Modelo</button>
  <label class="check"><input type="checkbox" id="cr" ${c.com_revisada ? "checked" : ""}> Conferi os percentuais e os modelos de divisão</label>
  <h2>Termos de autorização do anunciante</h2>
  <p class="hint">O anunciante aceita um destes textos pelo link ou no PDF. O sistema preenche {{CODIGO}}, {{TITULO}}, {{OPERACAO}}, {{COMISSAO}}, {{QUADRO}}, {{VALOR}}, {{CORRETOR}}, os prazos e o foro.</p>
  <label>Versão<input data-k="aut_versao" value="${esc(c.aut_versao || AUT_VERSAO)}"></label>
  <p><button class="sm g" data-rest="aut_parceria">Restaurar parceria padrão</button> <button class="sm g" data-rest="aut_proprietario">Restaurar autorização padrão</button></p>
  <label>Parceria com imobiliária ou corretor<textarea data-k="aut_parceria" rows="12">${esc(c.aut_parceria || AUT_PARCERIA)}</textarea></label>
  <label>Autorização do proprietário<textarea data-k="aut_proprietario" rows="12">${esc(c.aut_proprietario || AUT_PROPRIETARIO)}</textarea></label>
  <label class="check"><input type="checkbox" id="ra" ${c.aut_revisado ? "checked" : ""}> Revisei os dois termos de autorização e autorizo o uso</label>
  <h2>Acordo de divisão de honorários</h2>
  <p class="hint">Documento que todas as partes do negócio assinam (imobiliária, corretor parceiro e PrimeCorp). O sistema preenche {{OPERACAO}}, {{CODIGO}}, {{TITULO}}, {{CLIENTE}}, {{COMISSAO}}, {{VALOR}}, {{TOTAL}}, {{QUADRO}} e {{RECEBEDOR}}.</p>
  <label>Versão<input data-k="acordo_versao" value="${esc(c.acordo_versao || ACORDO_VERSAO)}"></label>
  <p><button class="sm g" data-rest="acordo">Restaurar acordo padrão</button></p>
  <label>Texto<textarea data-k="acordo" rows="14">${esc(c.acordo || ACORDO_PADRAO)}</textarea></label>
  <label class="check"><input type="checkbox" id="rac" ${c.acordo_revisado ? "checked" : ""}> Revisei o acordo de divisão e autorizo o uso</label>
  <button class="p" id="sv">Salvar configurações</button><div class="status" id="st"></div></div>
  <div class="card"><h2>Coleta automática de alertas</h2><div id="cs"><p class="hint">Verificando…</p></div></div>`;
  editing = true;
  const PADROES = { termo: TERMO_PADRAO, aut_parceria: AUT_PARCERIA, aut_proprietario: AUT_PROPRIETARIO, acordo: ACORDO_PADRAO };
  document.querySelectorAll("[data-rest]").forEach((b) => confirmar2(b, "Toque de novo para substituir o texto", async () => { const t = document.querySelector(`[data-k="${b.dataset.rest}"]`); if (t) { t.value = PADROES[b.dataset.rest]; toast("Texto padrão restaurado. Salve para aplicar."); } }));
  let mods = JSON.parse(JSON.stringify(Array.isArray(c.modelos) && c.modelos.length ? c.modelos : PC.MODELOS_PADRAO));
  const lerMods = () => [...$("fm").querySelectorAll("[data-m]")].map((el, i) => ({ id: mods[i]?.id || uid("m"), nome: el.querySelector("[data-mn]").value.trim(), partes: lerPartes(el).map((p) => ({ papel: p.papel, pct: PC.parseBR(p.pct) || 0 })) }));
  const drawMods = () => {
    $("fm").innerHTML = mods.map((m, i) => `<div data-m="${i}" style="border:1px solid var(--line);border-radius:12px;padding:10px;margin-bottom:10px"><div class="row"><input data-mn value="${esc(m.nome)}" style="flex:1"><button class="sm g" data-rmm="${i}">Excluir</button></div>${partesHTML(m.partes, false)}<div class="row"><button class="sm" data-addpm="${i}">+ Parte</button><span class="hint" data-sm></span></div></div>`).join("");
    const somas = () => $("fm").querySelectorAll("[data-m]").forEach((el) => { const t = lerPartes(el).reduce((a, p) => a + (PC.parseBR(p.pct) || 0), 0); const sp = el.querySelector("[data-sm]"); sp.textContent = "Soma " + PC.nf(t) + "%"; sp.style.color = Math.abs(t - 100) > 0.01 ? "var(--bad)" : "var(--ok)"; });
    $("fm").querySelectorAll("[data-m]").forEach((el) => ligarPartes(el, somas, false)); somas();
    $("fm").querySelectorAll("[data-rmm]").forEach((b) => (b.onclick = () => { mods = lerMods(); mods.splice(Number(b.dataset.rmm), 1); drawMods(); }));
    $("fm").querySelectorAll("[data-addpm]").forEach((b) => (b.onclick = () => { mods = lerMods(); mods[Number(b.dataset.addpm)].partes.push({ papel: "Corretor parceiro", pct: 0 }); drawMods(); }));
  };
  drawMods();
  $("addm").onclick = () => { mods = lerMods(); mods.push({ id: uid("m"), nome: "Novo modelo", partes: [{ papel: "PrimeCorp (indicação)", pct: 100 }] }); drawMods(); };
  $("sv").onclick = async () => { const v = readK($("fc")); const rev = $("rv").checked, ra = $("ra").checked, cr = $("cr").checked, rac = $("rac").checked; const st = $("st");
    const err = (m) => { st.className = "status err"; st.textContent = m; };
    if (PRAZOS.some(([k]) => v[k] && !/^\d{1,4}$/.test(v[k]))) return err("Prazos: use só números inteiros.");
    if (v.anuncio_dominio && !/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}$/i.test(v.anuncio_dominio.replace(/\/+$/, ""))) return err("Endereço dos anúncios: use o formato https://www.propto.com.br");
    if (rev && v.termo.includes("[__")) return err("O termo do cliente ainda tem campos [__]: restaure o texto padrão ou preencha.");
    if (ra && (v.aut_parceria.includes("[__") || v.aut_proprietario.includes("[__"))) return err("Os termos de autorização ainda têm campos [__]: restaure o texto padrão ou preencha.");
    if (rac && v.acordo.includes("[__")) return err("O acordo de divisão ainda tem campos [__]: restaure o texto padrão ou preencha.");
    const ms = lerMods(); const ruim = ms.find((m) => !m.nome || !m.partes.length || Math.abs(m.partes.reduce((a, p) => a + p.pct, 0) - 100) > 0.01);
    if (ruim) return err(`O modelo "${ruim.nome || "sem nome"}" precisa somar 100%.`);
    if (!PC.parseBR(v.com_venda_pct) || !PC.parseBR(v.com_locacao_alugueis)) return err("Informe a comissão padrão de venda e de locação.");
    editing = false; try { await store.save("config", { ...c, id: "geral", ...v, modelos: ms, termo_revisado: rev, aut_revisado: ra, com_revisada: cr, acordo_revisado: rac, atualizado: now() }); toast("Configurações salvas."); } catch { editing = true; } };
  try { const s = await api("status"); if (!$("cs")) return;
    $("cs").innerHTML = s.coleta_configurada ? `<p>Caixa de alertas: <b>${esc(s.caixa_alertas)}</b>. A coleta roda a cada 30 minutos.</p><button class="sm" id="rc">Coletar agora</button><div class="status" id="rcs"></div>` : `<p class="hint">Ainda não configurada. Crie um Gmail só para alertas, ative a verificação em duas etapas, gere uma senha de app e cadastre no Netlify as variáveis ALERTAS_IMAP_USER, ALERTAS_IMAP_SENHA e COLETA_SEGREDO (veja o guia de publicação).</p>`;
    const rc = $("rc"); if (rc) rc.onclick = async () => { rc.disabled = true; try { await api("coleta", { method: "POST" }); $("rcs").textContent = "Coleta iniciada. As ofertas aparecem em “A revisar” em alguns minutos."; } catch (e) { $("rcs").className = "status err"; $("rcs").textContent = e.message; } };
  } catch {}
};

/* ================= ANUNCIANTE: pedidos de dados e autorização ================= */
const STATUS_P = { aberto: "Aguardando resposta", respondido: "Dados recebidos, sem autorização", autorizado: "Autorizado", encerrado: "Encerrado" };
const modelosCfg = () => { const m = CFG().modelos; return Array.isArray(m) && m.length ? m : PC.MODELOS_PADRAO; };
const comPadrao = () => ({ pct: CFG().com_venda_pct || "6", alugueis: CFG().com_locacao_alugueis || "1" });
const baseDe = (o) => { const op = PC.norm(o.operacao || "Locação"); return op.startsWith("venda") ? "venda" : op.includes("venda") ? "ambos" : "locacao"; };
function textoComissaoPedido(c) {
  if (c.base === "ambos") return `${PC.nf(PC.parseBR(c.pct) || 0)}% sobre o valor da venda ou ${PC.nf(PC.parseBR(c.alugueis) || 0)} aluguel(éis) mensal(is) na locação`;
  return PC.textoComissao(c);
}
/** Termos e comissão revisados? Sem isso não se gera pedido ao anunciante. */
function pedidoBloqueado() { const cfg = CFG(); return !cfg.aut_revisado || [cfg.aut_parceria || AUT_PARCERIA, cfg.aut_proprietario || AUT_PROPRIETARIO].some((t) => faltasDoc(preencherDoc(t, {}, null)).length) || !cfg.com_revisada; }
const tipoTermoDe = (o) => (o.anunciante_tipo === "Proprietário" || o.origem === "Captação própria" ? "proprietario" : "parceria");
/** Comissão padrão do pedido: percentuais e modelo de divisão das Configurações. */
function comissaoPadraoPedido(o, tipo, anunciante) {
  const mods = modelosCfg(); const m = mods.find((x) => x.id === (tipo === "proprietario" ? "prop_pc" : "imob_pc")) || mods[0];
  const cp = comPadrao(); const base = baseDe(o);
  const partes = m.partes.map((p) => ({ ...p, nome: /imobili|anunciante/i.test(p.papel) ? anunciante || "" : p.nome || "", creci: /imobili|anunciante/i.test(p.papel) ? o.anunciante_creci || "" : p.creci || "", pct: PC.parseBR(p.pct) || 0 }));
  const com = { base, pct: base !== "locacao" ? cp.pct : "", alugueis: base !== "venda" ? cp.alugueis : "", partes }; com.texto = textoComissaoPedido(com); return com;
}
/** Cria o pedido ao anunciante (link + termo preenchido). Usado no formulário e no "sinal verde" automático. */
async function montarPedido(o, { tipo, anunciante, contatoId = null, com, validadeDias = 30, citarDemanda = true, origem = "manual" }) {
  const cfg = CFG(); const comp = PC.completude(o); const dem = demandaPara(o);
  const codigo = await garantirCodigo(o); const atual = O(o.id) || o; const d = PC.num(atual);
  const vars = { CODIGO: codigo, TITULO: PC.autoTitle(d), OPERACAO: (atual.operacao || "locação").toLowerCase(), COMISSAO: com.texto, QUADRO: PC.quadroComissao(com), VALOR: [d.venda && PC.brl(d.venda) + " (venda)", d.aluguel && PC.brl(d.aluguel) + "/mês (locação)"].filter(Boolean).join(" ou ") || "a definir" };
  const termo = preencherDoc(tipo === "proprietario" ? cfg.aut_proprietario || AUT_PROPRIETARIO : cfg.aut_parceria || AUT_PARCERIA, vars, corretorDaOferta(atual));
  const token = tokenAleatorio(32);
  const ped = { id: token, oferta: atual.id, codigo, titulo: tituloO(atual), operacao: atual.operacao || "", tipo_termo: tipo, anunciante: anunciante || "", contato: contatoId,
    demanda: citarDemanda ? dem.length : 0, conhecidos: PC.conhecidos(atual), faltam: comp.faltam, comissao: com, termo_texto: termo, termo_versao: cfg.aut_versao || AUT_VERSAO,
    grupo: PC.grupo(atual.tipo), modo: comp.ok ? "autorizacao" : "complementacao", expira: new Date(Date.now() + validadeDias * 864e5).toISOString(), status: "aberto", criado: now(), respostas: [],
    corretor: corretorDaOferta(atual), origem };
  await store.save("pedidos", ped);
  if (!atual.anunciante && ped.anunciante) await store.save("ofertas", { ...atual, anunciante: ped.anunciante, atualizado: now() });
  return ped;
}
/** Sinal verde: cliente (Sala ou negócio) com interesse numa oferta de terceiro sem autorização nem pedido em aberto. */
function sinaisVerdes() {
  const comInteresse = new Set();
  S.salas.forEach((s) => (s.interesses || []).forEach((i) => { const op = (s.opcoes || []).find((x) => x.codigo === i.codigo); if (op?.oferta) comInteresse.add(op.oferta); }));
  S.negocios.forEach((n) => { if (n.oferta && PC.etapaIdx(n.etapa) >= PC.etapaIdx("interesse") && n.etapa !== "perdido") comInteresse.add(n.oferta); });
  (S.ofertas || []).forEach((o) => { if (o.sinal_verde) comInteresse.add(o.id); });
  return [...comInteresse].map(O).filter((o) => o && o.status !== "descartada" && !o.autorizacao && !o.autorizacao_manual && !S.pedidos.some((p) => p.oferta === o.id && p.status !== "encerrado" && !(p.expira && new Date(p.expira) < new Date())));
}
async function sinalVerde(o) {
  if (pedidoBloqueado()) { toast("Antes do primeiro pedido: revise termos e comissão em Configurações."); go({ v: "config" }); return null; }
  const tipo = tipoTermoDe(o); const anunciante = o.anunciante || (tipo === "proprietario" ? o.proprietario_nome || "" : "");
  const ped = await montarPedido(o, { tipo, anunciante, com: comissaoPadraoPedido(o, tipo, anunciante), origem: "sinal_verde" });
  await store.save("ofertas", { ...(O(o.id) || o), sinal_verde: now(), atualizado: now() });
  return ped;
}
function demandaPara(o) { return S.briefings.filter((b) => (b.status || "ativo") === "ativo").map((b) => ({ b, r: PC.score(o, b, chkOf(o)) })).filter((x) => !x.r.fora); }
const creciTxt = (c) => (c ? (/creci/i.test(c) ? c : "CRECI " + c) : "");
function partesHTML(partes, comNomes) {
  const me = eu(); partes = partes.map((p) => (PC.ehPC(p) && !p.nome ? { ...p, nome: me.nome, creci: p.creci || me.creci } : p));
  const opts = (sel) => S.contatos.filter((c) => /^(Corretor|Imobili)/.test(c.tipo || "")).sort((a, b) => nomeC(a).localeCompare(nomeC(b))).map((c) => `<option value="${c.id}" ${c.id === sel ? "selected" : ""}>${esc(nomeC(c))}</option>`).join("");
  return partes.map((p) => `<div class="parte">
  <label>Papel<select data-pp="papel">${PC.PAPEIS.map((x) => `<option ${x === p.papel ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></label>
  <label class="u">Participação<input data-pp="pct" inputmode="decimal" value="${esc(p.pct ?? "")}"><span>%</span></label>
  ${comNomes ? `<label>Contato no CRM<select data-pp="contato"><option value="">—</option>${opts(p.contato)}</select></label><label>Nome<input data-pp="nome" value="${esc(p.nome || "")}"></label><label>CRECI<input data-pp="creci" value="${esc(p.creci || "")}"></label><label>PIX / dados bancários<input data-pp="pix" value="${esc(p.pix || "")}" placeholder="para pagamento direto"></label>` : ""}
  <div class="val"><span data-pv></span><button class="sm g" data-rm>Remover</button></div></div>`).join("");
}
function lerPartes(root) { return [...root.querySelectorAll(".parte")].map((el) => { const o = {}; el.querySelectorAll("[data-pp]").forEach((x) => (o[x.dataset.pp] = x.value.trim())); return o; }); }
function ligarPartes(root, onChange, comNomes) {
  root.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => { b.closest(".parte").remove(); onChange(); }));
  root.querySelectorAll('[data-pp="contato"]').forEach((s) => (s.onchange = () => { const c = C(s.value); const el = s.closest(".parte"); if (c) { el.querySelector('[data-pp="nome"]').value = c.empresa || c.nome || ""; el.querySelector('[data-pp="creci"]').value = c.creci || ""; } onChange(); }));
  root.addEventListener("input", onChange); root.addEventListener("change", onChange);
}

VIEWS.novopedido = () => {
  const o = O(route.o); if (!o) return back(); header("Pedido ao anunciante");
  const cfg = CFG();
  const pend = pedidoBloqueado();
  if (pend) {
    $("main").innerHTML = `<div class="card"><h2>Revise os termos e a comissão antes</h2><p class="hint">O anunciante vai aceitar um termo com a divisão de honorários. Em Configurações: preencha os prazos, confira os percentuais padrão de comissão e os modelos de divisão, e marque as revisões dos termos.</p><button class="p" id="cf">Abrir configurações</button></div>`;
    $("cf").onclick = () => go({ v: "config" }); return;
  }
  const comp = PC.completude(o); const dem = demandaPara(o); const base = baseDe(o); const cp = comPadrao();
  const tipoT = o.anunciante_tipo === "Proprietário" ? "proprietario" : "parceria";
  const mods = modelosCfg(); const mod0 = mods.find((m) => m.id === (tipoT === "proprietario" ? "prop_pc" : "imob_pc")) || mods[0];
  const partes0 = mod0.partes.map((p) => ({ ...p, nome: /imobili|anunciante/i.test(p.papel) ? o.anunciante || "" : "", creci: /imobili|anunciante/i.test(p.papel) ? o.anunciante_creci || "" : "" }));
  $("main").innerHTML = `<div class="card" id="fp"><span class="k">${esc(o.codigo || "")} ${esc(tituloO(o))}</span>
  <p class="hint">${comp.ok ? "Ficha completa: o anunciante recebe a ficha e a autorização de indicação." : `Ficha mínima em ${comp.pct}%: o anunciante recebe as ${comp.faltam.filter((f) => !f.extra).length} perguntas e a autorização.`} Ele responde pelo link no celular ou no PDF editável.</p>
  <label>Tipo de termo<select id="tt"><option value="parceria" ${tipoT === "parceria" ? "selected" : ""}>Parceria com imobiliária ou corretor</option><option value="proprietario" ${tipoT === "proprietario" ? "selected" : ""}>Autorização do proprietário</option></select></label>
  <div class="grid"><label>Anunciante<input id="an" value="${esc(o.anunciante || "")}"></label>
  <label>Contato no CRM<select id="ct"><option value="">— nenhum —</option>${S.contatos.filter((c) => /^(Corretor|Imobili|Propriet)/.test(c.tipo || "")).map((c) => `<option value="${c.id}">${esc(nomeC(c))} · ${esc(c.tipo)}</option>`).join("")}</select></label></div>
  <h3>Honorários</h3><div class="grid">
  ${base !== "locacao" ? `<label class="u">Venda<input id="pct" inputmode="decimal" value="${esc(cp.pct)}"><span>%</span></label>` : ""}
  ${base !== "venda" ? `<label class="u">Locação<input id="alg" inputmode="decimal" value="${esc(cp.alugueis)}"><span>aluguéis</span></label>` : ""}</div>
  <label>Modelo de divisão<select id="md">${mods.map((m) => `<option value="${m.id}" ${m.id === mod0.id ? "selected" : ""}>${esc(m.nome)}</option>`).join("")}</select></label>
  <div id="pts">${partesHTML(partes0, true)}</div><button class="sm" id="addp">+ Parte</button>
  <div class="tot"><span>Soma</span><span id="soma"></span></div><div id="perr"></div>
  <label>Validade do link<select id="vd"><option value="15">15 dias</option><option value="30" selected>30 dias</option><option value="60">60 dias</option></select></label>
  ${dem.length ? `<label class="check"><input type="checkbox" id="dm" checked> Citar que tenho ${dem.length} cliente(s) com demanda compatível (sem identificar)</label>` : '<p class="hint">Nenhum briefing ativo compatível agora: o pedido não cita demanda.</p>'}
  <button class="p" id="cr">Gerar link e PDF</button><div class="status" id="st"></div></div>`;
  editing = true;
  const pts = $("pts");
  const atualiza = () => { const ps = lerPartes(pts); const soma = ps.reduce((a, p) => a + (PC.parseBR(p.pct) || 0), 0); $("soma").textContent = PC.nf(soma) + "%"; $("soma").style.color = Math.abs(soma - 100) > 0.01 ? "var(--bad)" : "var(--ok)"; };
  const ligar = () => { ligarPartes(pts, atualiza, true); atualiza(); };
  ligar();
  $("md").onchange = () => { const m = mods.find((x) => x.id === $("md").value); pts.innerHTML = partesHTML(m.partes.map((p) => ({ ...p, nome: /imobili|anunciante/i.test(p.papel) ? $("an").value : "", creci: /imobili|anunciante/i.test(p.papel) ? o.anunciante_creci || "" : "" })), true); ligar(); };
  $("addp").onclick = () => { pts.insertAdjacentHTML("beforeend", partesHTML([{ papel: "Corretor parceiro", pct: "" }], true)); ligar(); };
  $("cr").onclick = async () => {
    const st = $("st"); const partes = lerPartes(pts).map((p) => ({ ...p, pct: PC.parseBR(p.pct) || 0 }));
    const com = { base, pct: $("pct") ? $("pct").value : "", alugueis: $("alg") ? $("alg").value : "", partes };
    const soma = partes.reduce((a, p) => a + p.pct, 0);
    if (!partes.length || Math.abs(soma - 100) > 0.01) { st.className = "status err"; st.textContent = `A divisão precisa fechar em 100% (está em ${PC.nf(soma)}%).`; return; }
    if ((base !== "locacao" && !PC.parseBR(com.pct)) || (base !== "venda" && !PC.parseBR(com.alugueis))) { st.className = "status err"; st.textContent = "Informe os honorários."; return; }
    com.texto = textoComissaoPedido(com);
    $("cr").disabled = true; st.className = "status"; st.textContent = "Gerando…";
    try {
      editing = false; const ct = C($("ct").value);
      const ped = await montarPedido(o, { tipo: $("tt").value, anunciante: $("an").value.trim(), contatoId: ct ? ct.id : null, com, validadeDias: Number($("vd").value), citarDemanda: !!($("dm") && $("dm").checked) });
      await pdfAnunciante(ped, true);
      stack.pop(); route = { v: "pedido", id: ped.id }; render(); toast("Pedido criado.");
    } catch (e) { st.className = "status err"; st.textContent = "Falhou: " + e.message; $("cr").disabled = false; editing = true; }
  };
};
async function pdfAnunciante(ped, registrar) {
  const o = O(ped.oferta) || {};
  const link = `${location.origin}/anunciante.html?t=${ped.id}`;
  const doc = PC.pdfAnunciante(jsPDF, { ...o, titulo: ped.titulo }, { modo: ped.modo, codigo: ped.codigo, faltam: ped.faltam, demanda: ped.demanda, link, anunciante: ped.anunciante, comissao: { ...ped.comissao, texto: ped.comissao.texto }, termo: ped.termo_texto, termo_versao: ped.termo_versao, corretor: ped.corretor, logos: LOGOS.dark ? LOGOS : null });
  const blob = doc.output("blob"); const nome = PC.filenameAnunciante(PC.num(o), ped.modo).replace(/\.pdf$/, `_${ped.codigo}.pdf`);
  if (registrar) await emitir({ tipo: "pedido_anunciante", oferta_id: ped.oferta, contato_id: ped.contato, destinatario: ped.anunciante, nome_arquivo: nome, pdf_base64: await blobToBase64(blob), conteudo: `${link}\n${ped.modo === "autorizacao" ? "Ficha e autorização" : ped.faltam.filter((f) => !f.extra).length + " pergunta(s) e autorização"} · ${ped.comissao.texto} · ${PC.quadroComissao(ped.comissao)}`, meta: { pedido: ped.id, codigo: ped.codigo } });
  await compartilharOuBaixar(blob, nome);
}
VIEWS.pedidos = () => {
  header("Anunciantes");
  const ps = [...S.pedidos].sort((a, b) => (b.respondido_em || b.criado || "").localeCompare(a.respondido_em || a.criado || ""));
  $("main").innerHTML = `<div class="card"><p class="hint">Pedidos de dados e autorização enviados aos anunciantes. Crie um pedido a partir da oferta.</p><div class="list">${ps.map((p) => `<button class="item" data-p="${p.id}"><span class="dot ${p.aceite ? "verde" : p.respondido_em ? "amarelo" : ""}"></span><span class="t"><b>${esc(p.codigo + " · " + (p.anunciante || "Anunciante"))}</b><span>${esc(STATUS_P[p.status] || p.status)} · ${esc(fdt(p.respondido_em || p.criado))}</span></span>${p.respondido_em && !p.visto ? '<span class="tag r">novo</span>' : ""}</button>`).join("") || '<p class="empty">Nenhum pedido ainda.</p>'}</div></div>`;
  document.querySelectorAll("[data-p]").forEach((x) => (x.onclick = () => go({ v: "pedido", id: x.dataset.p })));
};
VIEWS.pedido = () => {
  const p = S.pedidos.find((x) => x.id === route.id); if (!p) return back(); header("Pedido " + p.codigo);
  const o = O(p.oferta); const link = `${location.origin}/anunciante.html?t=${p.id}`; const expirado = p.expira && new Date(p.expira) < new Date();
  const ct = C(p.contato); const tel = (ct && ct.telefone) || (o && o.anunciante_contato) || "";
  const msg = `Olá${p.anunciante ? ", " + p.anunciante : ""}! Sou ${p.corretor?.nome || "Rodrigo França Viana"}, corretor de imóveis (${p.corretor?.creci || "CRECI-SP 297692"}).${p.demanda ? ` Tenho ${p.demanda} cliente${p.demanda > 1 ? "s" : ""} com demanda compatível com o seu imóvel` : " Tenho interesse em apresentar o seu imóvel"} (${p.titulo}, ref. ${p.codigo}) aos meus clientes.${p.modo === "autorizacao" ? " Preciso só da sua autorização de indicação." : " Para isso, preciso de algumas informações e da sua autorização de indicação."} Você responde pelo celular neste link${o && !o.verificacao?.matricula ? " (se puder, anexe também a matrícula e o IPTU: o cliente recebe o imóvel com a documentação conferida)" : ""}:\n${link}`;
  const adere = o ? demandaPara(o) : [];
  const resp = [...(p.respostas || [])].reverse();
  $("main").innerHTML = `<div class="card"><span class="k">${esc(STATUS_P[p.status] || p.status)}</span><h2>${esc(p.titulo)}</h2>
  <p class="hint">${esc(p.anunciante || "")} · ${p.tipo_termo === "proprietario" ? "Autorização do proprietário" : "Parceria"} · ${p.status === "encerrado" ? "encerrado" : expirado ? "link expirado" : "válido até " + esc(fdt(p.expira))}</p>
  <div class="linkbox" id="lk">${esc(link)}</div>
  <div class="row"><button class="grow" id="cp">Copiar link</button><a class="btn grow p" target="_blank" rel="noopener" href="${esc(waLink(tel, msg))}">WhatsApp${tel ? " " + esc(tel) : ""}</a>${o?.anunciante_email ? `<a class="btn grow" href="mailto:${esc(o.anunciante_email)}?subject=${encodeURIComponent(`Imóvel ${p.codigo}: dados e autorização de indicação`)}&body=${encodeURIComponent(msg)}">E-mail</a>` : ""}</div>
  ${p.origem === "sinal_verde" ? '<p class="hint">Pedido gerado no sinal verde, com a comissão padrão das Configurações.</p>' : ""}
  <div class="row"><button class="sm" id="pdf">PDF editável</button><button class="sm" id="pr">Prorrogar 30 dias</button>${p.status !== "encerrado" ? '<button class="sm" id="enc">Encerrar</button>' : ""}${o ? '<button class="sm" id="vo">Ver oferta</button>' : ""}</div></div>
  <div class="card"><h2>Honorários</h2><p>${esc(p.comissao?.texto || "")}</p><ul class="log">${(p.comissao?.partes || []).map((x) => `<li><time>${esc(PC.nf(x.pct))}%</time><span>${esc(x.papel)}${x.nome && !PC.ehPC(x) ? " · " + esc(x.nome) : ""}</span></li>`).join("")}</ul></div>
  <div class="card"><h2>Autorização</h2>${p.aceite ? `<p><b>${esc(p.aceite.razao)}</b> · ${esc(p.aceite.documento)}${p.aceite.creci ? " · CRECI " + esc(p.aceite.creci) : ""}<br>${esc(p.aceite.responsavel)}${p.aceite.cargo ? " (" + esc(p.aceite.cargo) + ")" : ""} · ${esc(p.aceite.email)} · ${esc(p.aceite.telefone)}</p><p class="hint">Aceito em ${esc(fdt(p.aceite.em))} · IP ${esc(p.aceite.ip || "—")} · termo ${esc(p.aceite.termo_versao || "")}<br>SHA-256 ${esc((p.aceite.termo_sha256 || "").slice(0, 24))}…</p>${!ct ? '<button class="sm" id="crm">Salvar anunciante no CRM</button>' : ""}` : '<p class="empty">Ainda não autorizado.</p>'}</div>
  <div class="card"><h2>Respostas</h2>${resp.length ? resp.map((r) => `<p class="hint">${esc(fdt(r.em))}</p><ul class="log">${Object.entries(r.campos).map(([k, v]) => `<li><time>${esc((PC.CAMPOS[k] || (V.CAMPOS.find((c) => c[0] === k) || []).slice(1).concat([]) || [k])[0] || k)}</time><span>${esc(v)}</span></li>`).join("")}</ul>`).join("") : '<p class="empty">Nenhuma resposta ainda.</p>'}
  ${o && o.revisar_anunciante ? '<p class="note">As respostas já estão na oferta, marcadas em verde. Abra a oferta, confira e salve.</p>' : ""}</div>
  ${(p.documentos || []).length ? `<div class="card"><h2>Documentos enviados pelo anunciante</h2><div class="list">${p.documentos.map((d) => `<a class="item" href="/api/arquivo?k=${encodeURIComponent(d.chave)}"><span class="t"><b>${esc(d.nome)}</b><span>${esc(fdt(d.em))} · lido automaticamente pela IA (resultado na verificação da oferta)</span></span><span>›</span></a>`).join("")}</div></div>` : ""}
  ${o ? `<div class="card"><h2>Cruzamento com os briefings</h2>${adere.length ? `<div class="list">${adere.map((x) => `<button class="item" data-b="${x.b.id}"><span class="t"><b>${esc(nomeB(x.b))}</b><span>${esc(x.r.motivos.slice(0, 2).join(" · ") || "Atende a todos os critérios")}</span></span><span class="score">${x.r.score}</span></button>`).join("")}</div>` : '<p class="empty">Nenhum briefing ativo compatível agora.</p>'}</div>` : ""}`;
  $("cp").onclick = () => copiar(link);
  $("pdf").onclick = () => pdfAnunciante(p, true);
  $("pr").onclick = async () => { await store.save("pedidos", { ...p, expira: new Date(Math.max(Date.now(), new Date(p.expira || 0).getTime()) + 30 * 864e5).toISOString(), status: p.status === "encerrado" ? (p.aceite ? "autorizado" : p.respondido_em ? "respondido" : "aberto") : p.status }); toast("Validade prorrogada."); };
  const enc = $("enc"); if (enc) confirmar2(enc, "Toque de novo para encerrar", async () => { await store.save("pedidos", { ...p, status: "encerrado" }); });
  const vo = $("vo"); if (vo) vo.onclick = () => go({ v: "oferta", id: o.id });
  const crm = $("crm"); if (crm) crm.onclick = async () => { const a = p.aceite; const c = { id: uid("c"), nome: a.responsavel, empresa: a.razao, documento: a.documento, creci: a.creci, cargo: a.cargo, email: a.email, telefone: a.telefone, tipo: p.tipo_termo === "proprietario" ? "Proprietário" : "Imobiliária", origem: "Sala do Anunciante", criado: now(), atualizado: now(), log: [{ t: a.em, ev: `Autorizou a indicação de ${p.codigo}` }] }; await store.save("contatos", c); await store.save("pedidos", { ...(S.pedidos.find((x) => x.id === p.id) || p), contato: c.id }); toast("Anunciante salvo no CRM."); };
  document.querySelectorAll("[data-b]").forEach((x) => (x.onclick = () => go({ v: "briefing", id: x.dataset.b })));
  if (p.respondido_em && !p.visto) store.save("pedidos", { ...p, visto: true }).catch(() => {});
};

/* ================= COMISSÃO do negócio ================= */
VIEWS.comissao = () => {
  const n = N(route.id); if (!n) return back(); header("Comissão do negócio");
  const o = O(n.oferta) || {}; const b = B(n.briefing) || {}; const d = PC.num(o); const cp = comPadrao();
  let cur = n.comissao;
  if (!cur) {
    const base = baseDe(o) === "venda" ? "venda" : "locacao";
    const au = o.autorizacao;
    let partes;
    if (au && au.comissao && au.comissao.partes) partes = au.comissao.partes.map((p) => ({ ...p, nome: /imobili|anunciante/i.test(p.papel) ? au.razao : p.nome || "", creci: /imobili|anunciante/i.test(p.papel) ? au.creci : p.creci || "" }));
    else { const m = modelosCfg().find((x) => x.id === (o.anunciante_tipo === "Proprietário" ? "prop_pc" : "imob_pc")) || modelosCfg()[0]; partes = m.partes.map((p) => ({ ...p, nome: /imobili|anunciante/i.test(p.papel) ? o.anunciante || "" : "", creci: /imobili|anunciante/i.test(p.papel) ? o.anunciante_creci || "" : "" })); }
    const par = C(b.parceiro_id); partes = partes.map((p) => (/corretor parceiro/i.test(p.papel) && par && !p.nome ? { ...p, contato: par.id, nome: par.nome || par.empresa, creci: par.creci || "" } : p));
    cur = { base, valor_base: base === "venda" ? d.venda || "" : d.aluguel || "", pct: au?.comissao?.pct || cp.pct, alugueis: au?.comissao?.alugueis || cp.alugueis, partes };
  }
  const mods = modelosCfg();
  $("main").innerHTML = `<div class="card" id="fk"><span class="k">${esc(o.codigo || "")} ${esc(o.titulo || PC.autoTitle(d))}</span>
  <div class="grid"><label>Base<select id="bs"><option value="venda" ${cur.base === "venda" ? "selected" : ""}>Venda</option><option value="locacao" ${cur.base !== "venda" ? "selected" : ""}>Locação</option></select></label>
  <label class="u">Valor do negócio<input id="vb" inputmode="decimal" value="${esc(fmtIn("valor_base", PC.parseBR(cur.valor_base)))}"><span>R$</span></label>
  <label class="u" id="lpct">Comissão<input id="pct" inputmode="decimal" value="${esc(cur.pct)}"><span>%</span></label>
  <label class="u" id="lalg">Comissão<input id="alg" inputmode="decimal" value="${esc(cur.alugueis)}"><span>aluguéis</span></label></div>
  <p class="hint">Na locação, o valor do negócio é o aluguel mensal acordado. Na venda, o preço final.</p>
  <label>Aplicar modelo<select id="md"><option value="">— manter as partes abaixo —</option>${mods.map((m) => `<option value="${m.id}">${esc(m.nome)}</option>`).join("")}</select></label>
  <div id="pts">${partesHTML(cur.partes, true)}</div><button class="sm" id="addp">+ Parte</button>
  <div class="tot"><span>Honorários totais</span><span id="tot"></span></div><div id="msgs"></div>
  <label>Quem recebe os honorários e repassa às demais partes<select id="rcb"></select></label>
  <label class="check"><input type="checkbox" id="ac" ${cur.acordado ? "checked" : ""}> Divisão acordada com as partes</label>
  <button class="p" id="sv">Salvar comissão</button><div class="status" id="st"></div></div>`;
  editing = true;
  const pts = $("pts");
  const ler = () => ({ base: $("bs").value, valor_base: $("vb").value, pct: $("pct").value, alugueis: $("alg").value, partes: lerPartes(pts) });
  const atualiza = () => {
    const v = ler(); $("lpct").hidden = v.base !== "venda"; $("lalg").hidden = v.base === "venda";
    const c = PC.calcComissao(v); $("tot").textContent = PC.brl2(c.total) || "R$ 0,00";
    pts.querySelectorAll(".parte").forEach((el, i) => { const p = c.partes[i]; el.querySelector("[data-pv]").textContent = p ? `${PC.brl2(p.valor) || "R$ 0,00"}` : ""; });
    const rs = $("rcb"); const sel = rs.value !== "" ? Number(rs.value) : Number.isInteger(cur.recebe) ? cur.recebe : null;
    const def = PC.partes0Recebe(c.partes); rs.innerHTML = c.partes.map((p, i) => `<option value="${i}" ${i === (sel != null && c.partes[sel] ? sel : def) ? "selected" : ""}>${esc(p.papel)}${p.nome ? " · " + esc(p.nome) : ""}</option>`).join("");
    $("msgs").innerHTML = (c.erros.length ? `<p class="status err">${esc(c.erros.join(" "))}</p>` : "") + (c.avisos.length ? `<p class="note">${esc(c.avisos.join(" "))}</p>` : "");
    return c;
  };
  const ligar = () => { ligarPartes(pts, atualiza, true); atualiza(); };
  ligar(); $("fk").addEventListener("input", atualiza); $("fk").addEventListener("change", atualiza);
  $("md").onchange = () => { const m = mods.find((x) => x.id === $("md").value); if (!m) return; pts.innerHTML = partesHTML(m.partes.map((p) => ({ ...p, nome: /imobili|anunciante/i.test(p.papel) ? o.autorizacao?.razao || o.anunciante || "" : "", creci: /imobili|anunciante/i.test(p.papel) ? o.autorizacao?.creci || o.anunciante_creci || "" : "" })), true); ligar(); };
  $("addp").onclick = () => { pts.insertAdjacentHTML("beforeend", partesHTML([{ papel: "Corretor parceiro", pct: "" }], true)); ligar(); };
  $("sv").onclick = async () => {
    const v = ler(); const c = atualiza();
    if (!c.ok) { $("st").className = "status err"; $("st").textContent = "Corrija antes de salvar: " + c.erros.join(" "); return; }
    const ac = $("ac").checked;
    const com = { ...v, recebe: Number($("rcb").value) || 0, partes: v.partes.map((p) => ({ ...p, pct: PC.parseBR(p.pct) || 0 })), acordado: ac, acordado_em: ac ? n.comissao?.acordado_em || now() : null };
    const atual = N(n.id) || n; editing = false;
    try {
      await store.save("negocios", { ...atual, comissao: com, atualizado: now(), log: [...(atual.log || []), { t: now(), ev: `Comissão ${ac ? "acordada" : "atualizada"}: ${PC.brl2(c.total)} · ${PC.quadroComissao(com)}` }] });
      await emitir({ tipo: "comissao", negocio_id: n.id, oferta_id: n.oferta, briefing_id: n.briefing, destinatario: n.parceiro || "", conteudo: `Honorários ${PC.brl2(c.total)} (${PC.textoComissao(com)} sobre ${PC.brl(c.valor)})\n` + c.partes.map((p) => `${p.papel}${p.nome && !PC.ehPC(p) ? " · " + p.nome : ""}${p.creci ? " · " + creciTxt(p.creci) : ""}: ${PC.nf(p.pct)}% = ${PC.brl2(p.valor)}`).join("\n"), meta: { acordado: ac } });
      toast("Comissão salva."); back();
    } catch { editing = true; }
  };
};

/* ================= EQUIPE, CAPTAÇÃO NO LOCAL E ANÚNCIOS ================= */
const RODRIGO_ID = "RODRIGO FRANÇA VIANA, corretor de imóveis inscrito no CRECI-SP sob o nº 297692";
const creciFmt = (c) => { const t = String(c || "").trim(); return !t ? "" : /creci/i.test(t) ? t : "CRECI-SP " + t; };
function perfilPorEmail(email) {
  const e = String(email || "").toLowerCase(); const cfg = CFG();
  const u = S.usuarios.find((x) => String(x.email || "").toLowerCase() === e);
  if (u) return { nome: u.nome || e, creci: creciFmt(u.creci), whatsapp: u.telefone || "", email: u.email, foco: u.foco || "comercial", papel: u.papel, titulo: u.titulo || "" };
  if (CLIENTE()) { const p = EU.perfil || {}; return { nome: p.nome || e, creci: creciFmt(p.creci), whatsapp: p.telefone || "", email: p.email || e, foco: "residencial" }; }
  return { nome: cfg.corretor_nome || "Rodrigo França Viana", creci: cfg.corretor_creci || "CRECI-SP 297692", whatsapp: cfg.corretor_whatsapp || "(19) 99805-1985", email: cfg.corretor_email || "contato@primecorpconsultoria.com.br" };
}
const eu = () => perfilPorEmail(EU.usuario || usuarioAtual?.email);
const ehEquipe = (email) => !!email && (S.usuarios.some((u) => String(u.email).toLowerCase() === String(email).toLowerCase()) || String(email).toLowerCase() === String(CFG().corretor_email || "contato@primecorpconsultoria.com.br").toLowerCase());
/** Corretor responsável: quem captou; senão quem cadastrou a oferta (se for da equipe); senão quem está usando o app. */
const corretorDaOferta = (o) => perfilPorEmail((o && o.origem === "Captação própria" && o.captador) || (o && ehEquipe(o.responsavel) && o.responsavel) || (o && ehEquipe(o.criado_por) && o.criado_por) || EU.usuario || usuarioAtual?.email);
function trocaCorretor(txt, c) {
  if (!c || /rodrigo/i.test(c.nome || "")) return txt;
  return String(txt).split(RODRIGO_ID).join(`${String(c.nome).toUpperCase()}, corretor(a) de imóveis inscrito(a) no ${c.creci || "CRECI"}`);
}

/* ---------- Equipe e permissões (administrador) ---------- */
const EQUIPE_INICIAL = [
  { nome: "Rodrigo França Viana", email: "contato@primecorpconsultoria.com.br", creci: "CRECI-SP 297692", telefone: "(19) 99805-1985", papel: "admin", foco: "comercial", ativo: true },
  { nome: "Joselia Junqueira Viana", email: "comercial@primecorpconsultoria.com.br", creci: "CRECI-SP 300760", telefone: "(19) 99919-4447", papel: "corretor", foco: "residencial", titulo: "Corretora de Imóveis", ativo: true },
];
const idUsuario = (email) => "u_" + String(email).toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 60);
VIEWS.equipe = () => {
  if (CLIENTE()) return go({ v: "time" }, false);
  header("Equipe e permissões");
  if (!ehAdmin()) { $("main").innerHTML = `<div class="card"><p class="status err">Somente o administrador acessa esta área.</p></div>`; return; }
  const us = [...S.usuarios].sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
  const faltam = EQUIPE_INICIAL.filter((e) => !us.some((u) => String(u.email).toLowerCase() === e.email));
  $("main").innerHTML = `<div class="card"><h2>Quem acessa o sistema</h2>
  <p class="hint"><b>Administrador:</b> tudo, inclusive configurações, termos, equipe, backup e exclusões. <b>Corretor(a):</b> capta imóveis, cria ofertas, briefings, salas, pedidos e negócios; não altera configurações nem exclui registros.</p>
  <div class="list">${us.map((u) => `<button class="item" data-u="${u.id}"><span class="dot ${u.ativo === false ? "" : "verde"}"></span><span class="t"><b>${esc(u.nome || u.email)}</b><span>${esc([u.email, creciFmt(u.creci), u.papel === "admin" ? "Administrador" : "Corretor(a)", u.ativo === false ? "INATIVO" : ""].filter(Boolean).join(" · "))}</span></span><span>›</span></button>`).join("") || '<p class="empty">Ninguém cadastrado ainda.</p>'}</div>
  ${faltam.length ? `<button class="p" id="seed">Cadastrar ${esc(faltam.map((f) => f.nome.split(" ")[0]).join(" e "))}</button>` : ""}
  <button id="novo">+ Pessoa</button></div>
  <div class="card" id="fu" hidden></div>
  <div class="card"><h2>Acesso (login)</h2><p class="hint">Cada pessoa cria a própria senha pelo convite. No Netlify: <b>Project configuration → Identity → Invite users</b> com o e-mail cadastrado acima. A pessoa abre o e-mail, toca no link e cria a senha. Senhas nunca ficam no sistema nem devem ser enviadas por mensagem.</p></div>`;
  editing = true;
  const form = (u) => {
    const f = $("fu"); f.hidden = false;
    f.innerHTML = `<h2>${u.id ? "Editar" : "Nova pessoa"}</h2><div class="grid">
    <label class="full">Nome<input id="un" value="${esc(u.nome || "")}"></label>
    <label class="full">E-mail de acesso<input id="ue" type="email" value="${esc(u.email || "")}" ${u.id ? "readonly" : ""}></label>
    <label>CRECI<input id="uc" value="${esc(u.creci || "")}"></label><label>WhatsApp<input id="ut" type="tel" value="${esc(u.telefone || "")}"></label>
    <label>Permissão<select id="up"><option value="corretor" ${u.papel !== "admin" ? "selected" : ""}>Corretor(a)</option><option value="admin" ${u.papel === "admin" ? "selected" : ""}>Administrador</option></select></label>
    <label class="full">Foco de atuação<select id="uf"><option value="residencial" ${u.foco === "residencial" ? "selected" : ""}>Residencial (casas, apartamentos)</option><option value="comercial" ${u.foco !== "residencial" ? "selected" : ""}>Galpões, comerciais, terrenos e rurais</option></select></label>
    <label>Assina como<select id="uti"><option ${u.titulo !== "Corretora de Imóveis" ? "selected" : ""}>Corretor de Imóveis</option><option ${u.titulo === "Corretora de Imóveis" ? "selected" : ""}>Corretora de Imóveis</option></select></label>
    <label>Situação<select id="ua"><option value="1" ${u.ativo !== false ? "selected" : ""}>Ativo</option><option value="0" ${u.ativo === false ? "selected" : ""}>Inativo (sem acesso)</option></select></label></div>
    <button class="p" id="us">Salvar</button><div class="status" id="ust"></div>`;
    f.scrollIntoView({ behavior: "smooth" });
    $("us").onclick = async () => {
      const email = $("ue").value.trim().toLowerCase(); const st = $("ust");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { st.className = "status err"; st.textContent = "E-mail inválido."; return; }
      if (!$("un").value.trim()) { st.className = "status err"; st.textContent = "Informe o nome."; return; }
      const reg = { ...u, id: u.id || idUsuario(email), email, nome: $("un").value.trim(), creci: creciFmt($("uc").value), telefone: $("ut").value.trim(), papel: $("up").value, foco: $("uf").value, titulo: $("uti").value, ativo: $("ua").value === "1", atualizado: now(), criado: u.criado || now() };
      editing = false; try { await store.save("usuarios", reg); toast("Equipe atualizada."); VIEWS.equipe(); } catch { editing = true; }
    };
  };
  document.querySelectorAll("[data-u]").forEach((b) => (b.onclick = () => form(S.usuarios.find((x) => x.id === b.dataset.u))));
  $("novo").onclick = () => form({ papel: "corretor", ativo: true });
  const sd = $("seed"); if (sd) sd.onclick = async () => { editing = false; for (const e of faltam) await store.save("usuarios", { ...e, id: idUsuario(e.email), criado: now(), atualizado: now() }); toast("Equipe cadastrada."); VIEWS.equipe(); };
};

/* ---------- Lista de captações ---------- */
const TIPOS_CAP = TIPOS_IMOVEL;
const baseAnuncios = () => String(CFG().anuncio_dominio || "").trim().replace(/\/+$/, "") || location.origin;
const fotosDe = (o) => (o.captacao?.ambientes || []).reduce((a, x) => a + (x.fotos || []).length, 0);
const anuncioDe = (o) => o.anuncio_token ? S.anuncios.find((a) => a.id === o.anuncio_token) : null;
function etapaCap(o) {
  const an = anuncioDe(o);
  if (an && an.status === "ativo") return ["verde", "Anúncio publicado"];
  if (o.autorizacao || o.autorizacao_manual) return ["verde", "Autorizado: pronto para publicar"];
  if (S.pedidos.some((p) => p.oferta === o.id && !p.aceite)) return ["amarelo", "Aguardando autorização"];
  if (o.descricao && o.titulo) return ["amarelo", "Anúncio gerado"];
  return ["", "Em captação"];
}
VIEWS.captar = () => {
  header("Captação no local"); const f = route.f || (ehAdmin() ? "todas" : "minhas");
  const caps = S.ofertas.filter((o) => o.origem === "Captação própria" && o.status !== "descartada" && (f === "todas" || o.captador === EU.usuario)).sort((a, b) => (b.atualizado || "").localeCompare(a.atualizado || ""));
  $("main").innerHTML = `${MODO() === "escritorio" ? cartaoCelular("No imóvel, use o celular", "A câmera guiada roda no celular e o registro chega aqui sozinho. No computador você também pode montar o anúncio com fotos recebidas (parceiro, proprietário): o app guia ambiente por ambiente, a IA trata as fotos e descreve, e a validação confere tudo antes de publicar.") : ""}<button class="captar-cta ${MODO() === "escritorio" ? "sec" : ""}" id="nc"><img class="pt-sym" src="/marca/propto-symbol-negative.svg" alt="Propto"><span><b>${MODO() === "escritorio" ? "Novo anúncio com fotos recebidas" : "Iniciar registro fotográfico"}</b><small>${MODO() === "escritorio" ? "Escolha o tipo, envie as fotos de cada ambiente e a IA monta o anúncio" : "Escolha o tipo: o app pede cada foto, você descreve e a IA organiza"}</small><em>O corretor fala, o app faz o resto</em></span><span>›</span></button>
  <div class="seg">${[["minhas", "Minhas"], ["todas", "Todas"]].map(([k, l]) => `<button data-f="${k}" class="${f === k ? "on" : ""}">${l}</button>`).join("")}</div>
  <div class="card"><div class="list">${caps.map((o) => { const [cor, et] = etapaCap(o); const an = anuncioDe(o); return `<button class="item" data-c="${o.id}"><span class="dot ${cor}"></span><span class="t"><b>${esc((o.codigo ? o.codigo + " · " : "") + (o.titulo || [o.tipo, o.regiao || o.cidade].filter(Boolean).join(" · ") || "Captação sem título"))}</b><span>${esc([et, fotosDe(o) + " foto(s)", perfilPorEmail(o.captador).nome.split(" ")[0], an ? (an.visitas || 0) + " visita(s)" : ""].filter(Boolean).join(" · "))}</span></span><span>›</span></button>`; }).join("") || '<p class="empty">Nenhuma captação ainda.</p>'}</div></div>`;
  document.querySelectorAll(".seg [data-f]").forEach((x) => (x.onclick = () => { route = { v: "captar", f: x.dataset.f }; render(); }));
  document.querySelectorAll("[data-c]").forEach((x) => (x.onclick = () => go({ v: "captacao", id: x.dataset.c })));
  $("nc").onclick = () => go({ v: "iniciar" });
};;

/* ---------- Iniciar registro fotográfico: tipo → visita guiada ---------- */
const GRUPOS_CAP = [["res", "Residencial", "Casa", ["Casa", "Casa em condomínio", "Sobrado", "Apartamento", "Cobertura", "Kitnet / studio"]], ["gal", "Galpões", "Galpão", ["Galpão", "Galpão em condomínio", "Barracão"]], ["com", "Comerciais", "Loja", ["Sala comercial", "Loja", "Ponto comercial", "Prédio comercial", "Imóvel comercial"]], ["are", "Terrenos e áreas", "Área / terreno", ["Terreno", "Lote em condomínio", "Área / terreno", "Área industrial", "Área comercial"]], ["rur", "Rurais", "Fazenda", ["Fazenda", "Sítio", "Chácara", "Haras"]]];
VIEWS.iniciar = () => {
  header("Registro fotográfico"); let tipo = ""; let op = eu().foco === "residencial" ? "Venda" : "Locação"; let cid = "", reg = "";
  let gp = eu().foco === "residencial" ? "res" : "gal";
  const desenhar = () => {
    const G = GRUPOS_CAP.find((x) => x[0] === gp) || GRUPOS_CAP[0]; const rot = tipo ? roteiroFotos(tipo, {}) : [];
    $("main").innerHTML = `<div class="card ini"><div class="ini-h"><span class="k">1 · Tipo de imóvel</span><small class="hint">O roteiro de fotos muda conforme o tipo.</small></div>
    <div class="gtabs" role="tablist">${GRUPOS_CAP.map(([k, l, ic]) => `<button data-gp="${k}" role="tab" class="${k === gp ? "on" : ""}">${icTipo(ic)}<span>${l}</span></button>`).join("")}</div>
    <div class="tipogrid">${G[3].map((t) => `<button data-ti="${esc(t)}" class="${tipo === t ? "on" : ""}">${icTipo(t)}<span>${esc(t)}</span></button>`).join("")}</div></div>
    <div class="card ini"><div class="ini-h"><span class="k">2 · Negócio e local</span></div>
    <div class="grid"><label>Operação<select id="iop">${["Venda", "Locação", "Locação / Venda"].map((x) => `<option ${x === op ? "selected" : ""}>${x}</option>`).join("")}</select></label><label>Cidade<input id="icid" value="${esc(cid)}"></label><label class="full">Bairro / região (aparece no anúncio)<input id="ireg" value="${esc(reg)}"></label></div></div>
    ${tipo ? `<div class="card ini"><div class="ini-h"><span class="k">3 · Roteiro de ${esc(tipo)}</span><small class="hint">${rot.filter((x) => x.obrigatorio).length} fotos obrigatórias · ${rot.filter((x) => !x.obrigatorio).length} opcionais</small></div>
    <div class="rchips">${rot.map((x) => `<span class="rch ${x.obrigatorio ? "" : "opc"}">${icAmb(x.id)}${esc(x.nome)}</span>`).join("")}</div></div>` : ""}
    <div class="acao-fixa"><button class="cta-cam" id="ini" ${tipo ? "" : "disabled"}><span class="ccam">${MODO() === "escritorio" ? icAc("upload") : icAmb("camera")}</span><span class="t"><b>${!tipo ? "Escolha o tipo de imóvel" : MODO() === "escritorio" ? "Começar: fotos guiadas" : "Começar: câmera guiada"}</b><small>${tipo ? esc(tipo) + " · " + rot.filter((x) => x.obrigatorio).length + (MODO() === "escritorio" ? " fotos no roteiro · envie ambiente por ambiente" : " fotos no roteiro") : MODO() === "escritorio" ? "Depois envie as fotos ambiente por ambiente" : "Depois toque aqui para abrir a câmera"}</small></span><span class="seta">›</span></button><button class="lnk" id="iniManual" ${tipo ? "" : "disabled"}>ou abrir a ficha ${MODO() === "escritorio" ? "e preencher livremente" : "sem câmera"}</button></div>`;
    const guardar = () => { op = $("iop").value; cid = $("icid").value; reg = $("ireg").value; };
    document.querySelectorAll("[data-gp]").forEach((b) => (b.onclick = () => { guardar(); gp = b.dataset.gp; desenhar(); }));
    document.querySelectorAll("[data-ti]").forEach((b) => (b.onclick = () => { guardar(); tipo = b.dataset.ti; desenhar(); }));
    $("iop").onchange = () => (op = $("iop").value);
    const criar = async (visita) => {
      const o = { id: uid("o"), origem: "Captação própria", status: "captacao", captador: EU.usuario || usuarioAtual?.email, tipo, operacao: $("iop").value, cidade: $("icid").value.trim(), regiao: $("ireg").value.trim(), uf: "SP", anunciante_tipo: "Proprietário", captacao: { iniciada: now(), ambientes: [], fala_geral: "" }, criado: now(), atualizado: now() };
      try { await store.save("ofertas", o); } catch { return; }
      stack.length = 0; stack.push({ v: "captar" }); route = { v: "captacao", id: o.id };
      if (visita) go({ v: "visita", id: o.id }); else { render(); window.scrollTo(0, 0); }
    };
    $("ini").onclick = () => criar(true); $("iniManual").onclick = () => criar(false);
  };
  desenhar();
};

/* ---------- Captação de um imóvel ---------- */
const MINI = {}; // miniaturas em memória para a IA (base64)
async function miniDe(k) {
  if (MINI[k]) return MINI[k];
  try { const b = await (await fetch("/api/foto?k=" + encodeURIComponent(k))).blob(); const r = await tratarFoto(new File([b], "f.jpg", { type: "image/jpeg" }), { lado: 768, tratar: false }); MINI[k] = r.mini; return r.mini; } catch { return null; }
}
const fotoURL = (k) => "/api/foto?k=" + encodeURIComponent(k);
const CAMPOS_RES = [["construida", "Área útil / construída", "m²"], ["terreno", "Terreno", "m²"], ["dormitorios", "Dormitórios", ""], ["suites", "Suítes", ""], ["banheiros", "Banheiros", ""], ["vagas", "Vagas", ""]];
const CAMPOS_GAL = [["construida", "Área construída", "m²"], ["fabril", "Galpão / fabril", "m²"], ["terreno", "Terreno", "m²"], ["pe_direito", "Pé-direito", "m"], ["docas", "Docas", ""], ["energia_kva", "Energia", "kVA"]];
const CAMPOS_RUR = [["area_ha", "Área total", "ha"], ["distancia_asfalto", "Até o asfalto", "km"], ["aptidao", "Aptidão / uso", ""], ["agua", "Água", ""], ["benfeitorias", "Benfeitorias", ""], ["topografia", "Topografia", ""], ["car", "CAR", ""], ["ccir", "CCIR e ITR", ""], ["georref", "Georreferenciamento", ""]];
const camposCap = (tipo) => (PC.grupo(tipo) === "residencial" ? CAMPOS_RES : PC.grupo(tipo) === "rural" ? CAMPOS_RUR : PC.grupo(tipo) === "area" ? [["terreno", "Terreno", "m²"], ["frente", "Frente", "m"], ["construida", "Construída", "m²"], ["zoneamento", "Zoneamento", ""], ["topografia", "Topografia", ""]] : CAMPOS_GAL);
const NUM_IA = ["area_ha", "dormitorios", "suites", "banheiros", "vagas", "construida", "terreno", "fabril", "pe_direito", "docas", "aluguel", "venda", "condominio", "iptu"];
function mesclarDados(o, dados) { const p = {}; Object.entries(dados || {}).forEach(([k, v]) => { if (v === null || v === undefined || v === "") return; if (NUM_IA.includes(k) && !PC.parseBR(o[k])) p[k] = fmtIn(k, Number(v)); else if (!NUM_IA.includes(k) && !String(o[k] || "").trim()) p[k] = String(v); }); return p; }

/** Pacote para sistemas de imobiliária: XML VRSync, CSV, texto e fotos nomeadas por ambiente. */
async function exportarPacote(o) {
  const codigo = await garantirCodigo(o); const at = O(o.id) || o; const an = anuncioDe(at); const cor = corretorDaOferta(at);
  const ambs = at.captacao?.ambientes || []; const fotos = [...ambs.flatMap((a) => (a.fotos || []).map((f) => ({ k: f.k, ambiente: a.nome }))), ...(at.fotos_aut || []).map((f) => ({ k: f.k, ambiente: "Foto do anúncio" }))];
  const c = { id: at.id, dados: { tipo: at.tipo, operacao: at.operacao, cidade: at.cidade, uf: at.uf || "SP", bairro: at.regiao, venda: at.venda, aluguel: at.aluguel, condominio: at.condominio, iptu: at.iptu, iptu_periodo: at.iptu_periodo, construida: at.construida, terreno: at.terreno, area_ha: at.area_ha, dormitorios: at.dormitorios, suites: at.suites, banheiros: at.banheiros, vagas: at.vagas, pe_direito: at.pe_direito, docas: at.docas, energia_kva: at.energia_kva, documentacao: at.documentacao, disponibilidade: at.disponibilidade },
    anuncio: { titulo: at.titulo || PC.autoTitle(PC.num(at)), subtitulo: at.subtitulo || "", descricao: at.descricao || "", destaques: PC.lines(at.diferenciais) } };
  const z = {}; const ref = []; const cnt = {};
  for (const [i, f] of fotos.entries()) { toast(`Preparando fotos ${i + 1}/${fotos.length}…`); const r = await fetch(fotoURL(f.k), { credentials: "same-origin" }); if (!r.ok) continue; cnt[f.ambiente] = (cnt[f.ambiente] || 0) + 1; const n = nomeFoto(i + 1, f.ambiente, cnt[f.ambiente]); z["fotos/" + n] = [new Uint8Array(await r.arrayBuffer()), { level: 0 }]; ref.push({ url: an && an.status === "ativo" ? `${baseAnuncios()}/i/${an.id}/f/${i}.jpg` : "fotos/" + n, legenda: f.ambiente }); }
  const contato = { nome: cor.nome, email: cor.email, telefone: cor.whatsapp };
  z["imovel.xml"] = strToU8(xmlVRSync(c, { fotos: ref, contato, codigo })); z["imovel.csv"] = strToU8(csvImovel(c, { codigo, fotos: ref })); z["anuncio.txt"] = strToU8(textoImovel(c, { codigo }));
  const nome = `${codigo}_pacote.zip`; await compartilharOuBaixar(new Blob([zipSync(z)], { type: "application/zip" }), nome);
  await emitir({ tipo: "pacote_exportado", oferta_id: at.id, destinatario: "Sistema de imobiliária", conteudo: `${nome} · ${ref.length} foto(s) · XML VRSync, CSV e texto` }).catch(() => {});
}
/* Ícones dos ambientes do roteiro (traço 1.8, 24×24) */
const IC_AMB = {
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  fachada: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  condominio: '<path d="M3 17c2 0 2-1.5 4.5-1.5S10 17 12 17s2.5-1.5 4.5-1.5S19 17 21 17"/><path d="M3 21c2 0 2-1.5 4.5-1.5S10 21 12 21s2.5-1.5 4.5-1.5S19 21 21 21"/><path d="M8 13V5a2 2 0 0 1 4 0M14 13V5"/>',
  sala: '<path d="M4 11V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3"/><path d="M3 11h18v6H3zM5 17v2M19 17v2"/>',
  cozinha: '<path d="M4 10h16v3a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6z"/><path d="M2 10h20M9 6c0-1 1-1 1-2M14 6c0-1 1-1 1-2"/>',
  dorm: '<path d="M3 18V7M3 13h18v5M21 18v-3a3 3 0 0 0-3-3h-8v1"/><circle cx="7" cy="10.5" r="1.8"/>',
  banho: '<path d="M4 12h16v2a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM6 12V6a2 2 0 0 1 4 0M7 19l-1 2M17 19l1 2"/>',
  servico: '<rect x="5" y="3" width="14" height="18" rx="2"/><circle cx="12" cy="13" r="4"/><path d="M8 6h2"/>',
  externa: '<path d="M12 21v-6M7 15h10l-5-11z"/><path d="M4 21h16"/>',
  vaga: '<path d="M5 16V11l2-5h10l2 5v5zM5 16v3M19 16v3M5 11h14"/><circle cx="8" cy="13.5" r=".8"/><circle cx="16" cy="13.5" r=".8"/>',
  vista: '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M12 4v16M4 12h16"/>',
  interna: '<path d="M2 21V9l10-5 10 5v12"/><path d="M6 21v-8h12v8M6 17h12"/>',
  pe_direito: '<path d="M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4"/>',
  docas: '<path d="M2 7h11v9H2zM13 10h4l3 3v3h-7"/><circle cx="6" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
  piso: '<path d="M3 9h18M3 15h18M9 3v18M15 3v18"/><rect x="3" y="3" width="18" height="18" rx="1"/>',
  energia: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  escritorios: '<rect x="3" y="7" width="18" height="13" rx="1"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
  apoio: '<path d="M7 3v8M5 3v4a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 2-2 6 0 8v10"/>',
  patio: '<path d="M4 21 9 3M20 21 15 3M12 6v2M12 11v2M12 16v2"/>',
  acesso: '<path d="M4 21 9 3M20 21 15 3M12 6v2M12 11v2M12 16v2"/>',
  salao: '<path d="M3 9l2-5h14l2 5M3 9h18v2a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0zM5 13v8h14v-8"/>',
  copa: '<path d="M5 8h11v6a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5zM16 10h2a2 2 0 0 1 0 4h-2M8 3v2M12 3v2"/>',
  entorno: '<path d="M12 21s-7-6-7-11a7 7 0 0 1 14 0c0 5-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  geral: '<path d="M3 20l6-10 4 6 3-4 5 8z"/><circle cx="17" cy="6" r="2"/>',
  frente: '<path d="M3 8h18v8H3zM7 8v3M11 8v4M15 8v3M19 8v4"/>',
  topografia: '<path d="M3 20l5-8 4 4 4-7 5 11z"/>',
  vizinhanca: '<path d="M2 21V11l5-4 5 4v10M12 21V8l5-4 5 4v13M2 21h20"/>',
  infra: '<path d="M12 2v20M6 6h12M8 10h8M12 6l-5 15M12 6l5 15"/>',
  porteira: '<path d="M3 5v16M21 5v16M3 9h18M3 15h18M3 9l18 6"/>',
  sede: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M9 14h2v2H9zM13 14h2v2h-2z"/>',
  sede_int: '<path d="M4 11V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3"/><path d="M3 11h18v6H3z"/>',
  producao: '<path d="M12 21V11M12 11c0-4 3-6 7-6 0 4-3 6-7 6zM12 14c0-3-2-5-6-5 0 3 2 5 6 5z"/>',
  agua: '<path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z"/>',
  benfeitorias: '<path d="M3 21V10l9-6 9 6v11z"/><path d="M8 21v-7h8v7M8 14l8 7M16 14l-8 7"/>',
  estradas: '<path d="M4 21 9 3M20 21 15 3M12 6v2M12 11v2M12 16v2"/>',
  cobertura: '<path d="M2 12 12 5l10 7M5 10v9h14v-9M8 12l4 4 4-4"/>',
  incendio: '<path d="M12 21c-4 0-7-3-7-7 0-4 4-6 4-10 3 2 4 4 4 6 1-1 2-2 2-3 2 2 4 4 4 7 0 4-3 7-7 7z"/>',
  estac: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M10 17V7h3a3 3 0 0 1 0 6h-3"/>',
  recepcao: '<path d="M4 18h16M6 18a6 6 0 0 1 12 0M12 10V8M10 8h4"/><path d="M3 21h18"/>',
  elevador: '<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M12 3v18M7.5 10 9 8l1.5 2M13.5 14l1.5 2 1.5-2"/>',
  acesso_rod: '<path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z"/><path d="M9 10h6M12 10v6"/>',
  divisas: '<path d="M5 21V6l2-2 2 2v15M15 21V6l2-2 2 2v15M3 10h18M3 16h18"/>',
  lazer: '<path d="M12 4a8 8 0 0 1 8 8H4a8 8 0 0 1 8-8zM12 12v9M8 21h8"/>',
  baias: '<path d="M7 20H5v-9a7 7 0 0 1 14 0v9h-2"/><path d="M5 15h2M17 15h2M5.5 9.5 7.5 10M18.5 9.5l-2 .5"/>',
};
/* Ícones das ações (próximos passos) */
const IC_AC = {
  doc: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>',
  enviar: '<path d="M21 3 3 10l7 3 3 7z"/><path d="M10 13l5-5"/>',
  zap: '<path d="M4 20l1.3-3.9A8 8 0 1 1 8 19z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 .8a4 4 0 0 1-2-2l.8-1-1-2z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7L11.5 6.8"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5"/>',
  olho: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  atualizar: '<path d="M20 11a8 8 0 0 0-14.6-4.5M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5M20 20v-4h-4"/>',
  fechar: '<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',
  megafone: '<path d="M3 10v4h4l8 5V5L7 10z"/><path d="M18 9a4 4 0 0 1 0 6"/>',
  banco: '<path d="M3 9l9-5 9 5M5 9v9M9.5 9v9M14.5 9v9M19 9v9M3 20h18"/>',
  pdf: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path d="M8.5 17v-4h1.2a1.2 1.2 0 0 1 0 2.4H8.5M12.5 13v4h.8a2 2 0 0 0 0-4zM16 17v-4h1.8M16 15h1.4"/>',
  pacote: '<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10M7.5 5l9 4"/>',
  oferta: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h6M7 13h10M7 17h4"/><circle cx="17" cy="9" r="1.5"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  galeria: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 8"/>',
};
const icAc = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC_AC[k] || ""}</svg>`;
/* Ícones dos tipos de imóvel (painel de escolha) */
const IC_TIPO = {
  "Casa": IC_AMB.fachada,
  "Casa em condomínio": '<path d="M2 21V11l5-4 5 4v10M12 21V8l5-4 5 4v13M2 21h20"/>',
  "Sobrado": '<path d="M4 10l8-6 8 6"/><path d="M6 9v12h12V9M6 15h12M10 21v-3h4v3M9 11h2M13 11h2"/>',
  "Apartamento": '<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M9 7h1M14 7h1M9 11h1M14 11h1M9 15h1M14 15h1M11 21v-3h2v3"/>',
  "Cobertura": '<path d="M6 21V9h12v12M4 9h16M8 9V5h8v4M9 13h1M14 13h1M9 17h1M14 17h1"/>',
  "Kitnet / studio": '<rect x="4" y="5" width="16" height="15" rx="1"/><path d="M7 17v-4h10v4M7 15h10M8 13v-2h4"/>',
  "Galpão": IC_AMB.interna,
  "Galpão em condomínio": '<path d="M1 21V12l5-3 5 3v9M13 21V12l5-3 5 3v9M1 21h22M4 21v-4h4v4M16 21v-4h4v4"/>',
  "Barracão": '<path d="M3 21V11a9 6 0 0 1 18 0v10"/><path d="M8 21v-6h8v6M3 21h18"/>',
  "Sala comercial": '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M8 7h3v3H8zM13 7h3v3h-3zM8 13h3v3H8zM13 13h3v3h-3z"/>',
  "Loja": IC_AMB.salao,
  "Ponto comercial": '<path d="M12 21s-6-5.5-6-10a6 6 0 0 1 12 0c0 4.5-6 10-6 10z"/><path d="M9 9h6l-.6 3H9.6zM9 9l-.5-1.5"/>',
  "Prédio comercial": '<path d="M3 21h18M5 21V4h8v17M13 9h6v12M8 8h2M8 12h2M8 16h2M16 13h1M16 17h1"/>',
  "Imóvel comercial": IC_AMB.escritorios,
  "Terreno": '<path d="M3 19l4-11h10l4 11z"/><path d="M7 8V5M17 8V5M5 14h14"/>',
  "Lote em condomínio": '<path d="M3 20l3-8h12l3 8z"/><path d="M10 12V4l4 1.5L10 7"/>',
  "Área / terreno": IC_AMB.topografia,
  "Área industrial": '<path d="M3 21V10l5 3v-3l5 3V9l5 3V4h3v17zM3 21h18"/>',
  "Área comercial": '<path d="M3 20l3-8h12l3 8z"/><path d="M8 12V8l1-3h6l1 3v4M8 8h8"/>',
  "Fazenda": '<path d="M3 21V10l4-5h10l4 5v11z"/><path d="M9 21v-7h6v7M9 14l6 7M15 14l-6 7"/>',
  "Sítio": '<path d="M3 21h18M5 21v-7l4-3 4 3v7"/><path d="M17 21v-5M17 16c-2 0-3-1.5-3-3.5S15.5 9 17 9s3 1.5 3 3.5-1 3.5-3 3.5z"/>',
  "Chácara": '<path d="M12 21v-6M12 15c-3 0-5-2-5-5s2-6 5-6 5 3 5 6-2 5-5 5z"/><path d="M3 21h18M3 18h4M17 18h4"/>',
  "Haras": '<path d="M7 20H5v-9a7 7 0 0 1 14 0v9h-2"/><path d="M5 15h2M17 15h2M5.5 9.5 7.5 10M18.5 9.5l-2 .5"/>',
};
const icTipo = (t) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC_TIPO[t] || IC_AMB.fachada}</svg>`;
const icAmb = (id) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC_AMB[id] || IC_AMB[String(id).replace(/\d+$/, "")] || IC_AMB[String(id).replace(/C$/, "")] || IC_AMB.camera}</svg>`;
/** Roteiro guiado: casa cada item obrigatório com um ambiente fotografado (pelo vínculo ou pelo nome). */
const KW_ROT = { fachada: /fachada|frente|portaria/, condominio: /condom|piscina|lazer|academia|sal[ãa]o de festa|playground/, sala: /sala/, cozinha: /cozinha/, dorm: /dormit|quarto|su[ií]te/, banho: /banheiro|lavabo|wc/, servico: /servi[cç]o|lavanderia/, externa: /quintal|externa|jardim|churrasq|piscina/, vaga: /garagem|vaga/, vista: /vista|varanda|sacada/, interna: /operacional|interna|galp[ãa]o/, pe_direito: /p[ée].?direito/, docas: /doca/, piso: /piso/, energia: /cabine|energia|transformador|quadro/, escritorios: /escrit|mezanino|administ/, apoio: /vesti|refeit|copa/, patio: /p[áa]tio|manobra/, acesso: /acesso|entorno|rua/, salao: /sal[ãa]o|loja|vitrine/, banhoC: /banheiro/, copa: /copa|dep[óo]sito/, entorno: /entorno|vizinh/, geral: /geral|drone|panor|vista/, frente: /frente|testada/, topografia: /topogra|declive|aclive|plano/, vizinhanca: /vizinh/, infra: /poste|infra|rede/, porteira: /porteira|entrada|acesso/, sede: /sede|casa principal/, sede_int: /sede.*(sala|cozinha|interior)/, producao: /pasto|pastagem|lavoura|planta[çc]/, agua: /represa|rio|nascente|po[çc]o|lago|a[çc]ude|[áa]gua/, benfeitorias: /curral|barrac|benfeit|caseiro|m[áa]quinas/, estradas: /estrada/, cobertura: /cobertura|telhad|telha/, incendio: /inc[êe]ndio|sprinkler|hidrante/, estac: /estacionamento/, recepcao: /recep|hall|portaria/, elevador: /elevador|escada/, acesso_rod: /rodovi|estrada/, divisas: /divisa|cerca|muro|marco/, lazer: /lazer|piscina|churrasq|gourmet/, baias: /baia|picadeiro|cocheira/ };
function casarRoteiro(o) {
  const itens = roteiroFotos(o.tipo, { dormitorios: PC.parseBR(o.dormitorios), banheiros: PC.parseBR(o.banheiros), vagas: PC.parseBR(o.vagas), docas: o.docas === undefined || o.docas === "" ? undefined : PC.parseBR(o.docas) });
  const ambs = (o.captacao?.ambientes || []).filter((a) => (a.fotos || []).length); const usados = new Set();
  const res = itens.map((it) => {
    let a = ambs.find((x) => x.roteiro === it.id && !usados.has(x.id));
    if (!a) { const chave = it.id.replace(/\d+$/, ""); const re = KW_ROT[chave] || KW_ROT[it.id]; if (re) a = ambs.find((x) => !usados.has(x.id) && !x.roteiro && re.test(PC.norm(x.nome || ""))); }
    if (a) usados.add(a.id); return { ...it, amb: a || null };
  });
  return { itens: res, faltam: res.filter((x) => x.obrigatorio && !x.amb) };
}
VIEWS.captacao = () => {
  const o0 = O(route.id); if (!o0) return back();
  header(o0.codigo ? "Captação " + o0.codigo : "Captação");
  const cur = () => O(route.id) || o0;
  let voz = null; const parar = () => { if (voz) { voz.parar(); voz = null; } document.querySelectorAll(".mic.on").forEach((b) => b.classList.remove("on")); };
  const salvar = async (patch, msg) => { const at = cur(); const n = { ...at, ...patch, captacao: { ...(at.captacao || {}), ...(patch.captacao || {}) }, atualizado: now() }; try { await store.save("ofertas", n); if (msg) toast(msg); return n; } catch { return null; } };
  const podeEditar = ehAdmin() || cur().captador === EU.usuario;
  const opts = (arr, v) => arr.map((x) => `<option ${String(v || "") === x ? "selected" : ""}>${esc(x)}</option>`).join("");
  const o = cur(); const usuarios = S.usuarios.filter((u) => u.ativo !== false);
  $("main").innerHTML = `<div id="capw" style="display:flex;flex-direction:column;gap:14px">
  <div class="card rotcard"><div class="rothead"><div class="anel" id="ranel"></div><div class="grow"><h2>Registro fotográfico</h2><span class="hint" id="rtc"></span></div></div>
  <button class="cta-cam" id="vguiada"><span class="ccam">${icAmb("camera")}</span><span class="t"><b id="vgt">Iniciar registro</b><small id="vgs"></small></span><span class="seta">›</span></button>
  <div class="rotgrid" id="rot"></div><button class="g sm" id="ropc" hidden></button><input type="file" id="camR" accept="image/*" capture="environment" multiple hidden></div>
  <div class="card" id="fi"><h2>Imóvel</h2><div class="grid">
  <label>Tipo<select data-c="tipo">${opts(TIPOS_CAP, o.tipo)}</select></label><label>Operação<select data-c="operacao">${opts(["Venda", "Locação", "Locação / Venda"], o.operacao)}</select></label>
  <label>Cidade<input data-c="cidade" value="${esc(o.cidade || "")}"></label><label>Bairro / região<input data-c="regiao" value="${esc(o.regiao || "")}" placeholder="aparece no anúncio"></label>
  <label class="full">Endereço completo (privado, não sai no anúncio)<input data-c="endereco" value="${esc(o.endereco || "")}"></label>
  <label>Proprietário<input data-c="proprietario_nome" value="${esc(o.proprietario_nome || "")}"></label><label>Telefone do proprietário<input data-c="proprietario_tel" type="tel" value="${esc(o.proprietario_tel || "")}"></label>
  <label class="full">Captado por<select data-c="captador" ${ehAdmin() ? "" : "disabled"}>${(usuarios.length ? usuarios : EQUIPE_INICIAL).map((u) => `<option value="${esc(u.email)}" ${String(u.email).toLowerCase() === String(o.captador || "").toLowerCase() ? "selected" : ""}>${esc(u.nome)} · ${esc(creciFmt(u.creci))}</option>`).join("")}</select></label></div></div>
  <div class="card"><div class="row" style="justify-content:space-between"><h2>Ambientes</h2><span class="chip" id="nf"></span></div>
  <p class="hint">Para cada ambiente: fotografe (celular na horizontal), toque em <b>Falar</b> e descreva o que vê. A IA nomeia o ambiente, organiza a descrição e confere as fotos.</p>
  <div id="ambs"></div>
  <label class="btn p cam"><input type="file" id="camN" accept="image/*" capture="environment" multiple hidden>📷 Novo ambiente: tirar fotos</label>
  <label class="btn sm"><input type="file" id="galN" accept="image/*" multiple hidden>Escolher da galeria</label></div>
  <div class="card"><h2>Informações gerais</h2><p class="hint">Fale valores, áreas, condomínio, IPTU, documentação, disponibilidade e o que o proprietário contou.</p>
  <textarea id="fg" rows="4" placeholder="Ex.: venda 850 mil, aceita financiamento, condomínio 620, IPTU 2.400 por ano, matrícula ok, desocupada…">${esc(o.captacao?.fala_geral || "")}</textarea>
  <div class="row"><button class="mic" data-mic="fg">🎙 Falar</button></div></div>
  <div class="card" id="fa"><div class="row" style="justify-content:space-between"><h2>Anúncio</h2><button class="sm p" id="ga">Gerar com IA</button></div>
  <div id="pend"></div>
  <div class="grid3" id="nums"></div>
  <div class="grid"><label class="u">Venda<input data-c="venda" inputmode="decimal" value="${esc(fmtIn("venda", PC.parseBR(o.venda)))}"><span>R$</span></label><label class="u">Aluguel<input data-c="aluguel" inputmode="decimal" value="${esc(fmtIn("aluguel", PC.parseBR(o.aluguel)))}"><span>R$/mês</span></label>
  <label class="u">Condomínio<input data-c="condominio" inputmode="decimal" value="${esc(fmtIn("condominio", PC.parseBR(o.condominio)))}"><span>R$/mês</span></label><label class="u">IPTU<input data-c="iptu" inputmode="decimal" value="${esc(fmtIn("iptu", PC.parseBR(o.iptu)))}"><span>R$</span></label>
  <label>IPTU é<select data-c="iptu_periodo"><option value="">—</option><option value="mensal" ${o.iptu_periodo === "mensal" ? "selected" : ""}>Mensal</option><option value="anual" ${o.iptu_periodo === "anual" ? "selected" : ""}>Anual</option></select></label>
  <label>Disponibilidade<input data-c="disponibilidade" value="${esc(o.disponibilidade || "")}"></label><label class="full">Documentação<input data-c="documentacao" value="${esc(o.documentacao || "")}" placeholder="Matrícula, averbação, financiável…"></label></div>
  <label>Título<input data-c="titulo" value="${esc(o.titulo || "")}"></label><label>Chamada<input data-c="subtitulo" value="${esc(o.subtitulo || "")}"></label>
  <label>Descrição<textarea data-c="descricao" rows="6">${esc(o.descricao || "")}</textarea></label>
  <label>Destaques (um por linha)<textarea data-c="diferenciais" rows="4">${esc(PC.lines(o.diferenciais).join("\n"))}</textarea></label>
  <div class="meter"><i id="cbar"></i></div><p class="hint" id="ctxt"></p></div>
  <div class="card" id="fx"></div></div>`;
  editing = true;
  if (!podeEditar) $("main").insertAdjacentHTML("afterbegin", `<p class="note">Captação de ${esc(perfilPorEmail(o.captador).nome)}: você pode ver, mas só quem captou ou o administrador altera.</p>`);

  const desenharNums = () => { const at = cur(); $("nums").innerHTML = camposCap(at.tipo).map(([k, l, u]) => u ? `<label class="u">${esc(l)}<input data-c="${k}" inputmode="decimal" value="${esc(fmtIn(k, PC.parseBR(at[k])))}"><span>${esc(u)}</span></label>` : `<label class="full">${esc(l)}<input data-c="${k}" value="${esc(at[k] || "")}"></label>`).join(""); };
  const medidor = () => { if (!$("cbar")) return; const at = cur(); const cp = PC.completude(at); $("cbar").style.width = cp.pct + "%"; $("cbar").className = cp.ok ? "ok" : cp.pct >= 60 ? "mid" : ""; $("ctxt").textContent = cp.ok ? "Ficha completa." : `Ficha ${cp.pct}% · falta: ${cp.faltam.filter((f) => !f.extra).map((f) => f.rotulo).join(", ")}`; $("nf").textContent = fotosDe(at) + " foto(s)"; if (typeof desenharRoteiro === "function" && $("rot")) desenharRoteiro(); };
  desenharNums();
  // salvar campos (debounce)
  let tSalvar = null; const lerCampos = () => { const p = {}; document.querySelectorAll("[data-c]").forEach((el) => (p[el.dataset.c] = el.value.trim())); p.anunciante = p.proprietario_nome; p.anunciante_contato = p.proprietario_tel; return p; };
  const agendar = () => { clearTimeout(tSalvar); tSalvar = setTimeout(async () => { await salvar(lerCampos()); medidor(); }, 700); };
  $("capw").addEventListener("input", (e) => { if (e.target.closest("[data-c]") || e.target.dataset.c) agendar(); });
  $("capw").addEventListener("change", (e) => { if (e.target.dataset.c === "tipo") { clearTimeout(tSalvar); salvar(lerCampos()).then(() => { desenharNums(); medidor(); }); } else if (e.target.dataset.c) agendar(); });
  $("fg").addEventListener("input", () => { clearTimeout($("fg")._t); $("fg")._t = setTimeout(() => salvar({ captacao: { fala_geral: $("fg").value } }), 700); });

  // ambientes
  const desenharAmbs = () => {
    const at = cur(); const ambs = at.captacao?.ambientes || [];
    const vivos = {}; document.querySelectorAll("[data-fala]").forEach((x) => (vivos[x.dataset.fala] = x.value));
    const micOn = document.querySelector(".mic.on")?.dataset.mic;
    $("ambs").innerHTML = ambs.map((a, i) => `<div class="amb" data-a="${a.id}"><div class="row" style="justify-content:space-between"><input class="ambn" data-an="${a.id}" value="${esc(a.nome || "Ambiente " + (i + 1))}"><button class="sm g" data-rm="${a.id}">Remover</button></div>
      <div class="thumbs">${(a.fotos || []).map((f) => `<div class="th ${at.capa === f.k ? "capa" : ""}"><img src="${fotoURL(f.k)}" loading="lazy" alt=""><button data-capa="${f.k}" title="Usar como capa">★</button><button data-xf="${a.id}|${f.k}" title="Excluir">✕</button>${(f.avisos || []).length ? `<i title="${esc(f.avisos.join(" "))}">!</i>` : ""}</div>`).join("")}
      <label class="th add"><input type="file" accept="image/*" capture="environment" multiple hidden data-addf="${a.id}">＋</label></div>
      ${(a.avisos || []).length ? `<p class="note">${esc(a.avisos.join(" · "))}</p>` : ""}
      <textarea data-fala="${a.id}" rows="2" placeholder="Fale ou digite: o que tem neste ambiente?">${esc(a.fala || "")}</textarea>
      ${a.descricao ? `<p class="desc">${esc(a.descricao)}</p>` : ""}${(a.caracteristicas || []).length ? `<div class="chips">${a.caracteristicas.map((c) => `<span class="chip">${esc(c)}</span>`).join("")}</div>` : ""}
      <div class="row"><button class="mic" data-mic="${a.id}">🎙 Falar</button><button class="sm" data-ia="${a.id}">${a.ia_em ? "Reorganizar" : "Organizar com IA"}</button></div></div>`).join("") || '<p class="empty">Nenhum ambiente ainda. Comece pela fachada.</p>';
    ambs.forEach((a) => { const el = document.querySelector(`[data-fala="${a.id}"]`); if (el && vivos[a.id] !== undefined && vivos[a.id] !== (a.fala || "")) { el.value = vivos[a.id]; salvarFala(a.id, el.value); } });
    if (micOn && micOn !== "fg") { const b = document.querySelector(`[data-mic="${micOn}"]`); if (b) b.classList.add("on"); }
    ligarAmbs(); medidor();
  };
  let itemFoto = null;
  let verOpc = false;
  var desenharRoteiro = () => { if (!$("ranel")) return; const r = casarRoteiro(cur()); const obrig = r.itens.filter((x) => x.obrigatorio); const feitas = obrig.length - r.faltam.length; const pct = obrig.length ? Math.round((feitas / obrig.length) * 100) : 0;
    $("ranel").style.setProperty("--p", pct); $("ranel").innerHTML = `<b>${feitas}</b><small>/${obrig.length}</small>`;
    $("rtc").textContent = r.faltam.length ? `${r.faltam.length} foto(s) obrigatória(s) faltando` : "Fotos obrigatórias completas ✓";
    const prox = r.faltam[0]; $("vgt").textContent = !feitas ? "Iniciar registro" : prox ? "Continuar registro" : "Revisar o registro"; $("vgs").textContent = prox ? "Próximo: " + prox.nome : "Câmera guiada, ambiente por ambiente";
    const opc = r.itens.filter((x) => !x.obrigatorio); const mostra = [...obrig, ...(verOpc ? opc : opc.filter((x) => x.amb))];
    const tile = (it) => { const f = it.amb?.fotos?.[0]; return `<button class="rt ${it.amb ? "ok" : it.obrigatorio ? "obr" : "opc"}" data-rf="${esc(it.id)}" title="${esc(it.dica)}">${f ? `<img src="${fotoURL(f.k)}" alt="" loading="lazy">` : ""}<span class="ri2">${it.amb ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>' : icAmb(it.id)}</span><span class="rn">${esc(it.nome)}</span>${it.amb ? `<span class="rc">${(it.amb.fotos || []).length}</span>` : ""}</button>`; };
    $("rot").innerHTML = mostra.map(tile).join("");
    const nOpc = opc.filter((x) => !x.amb).length; const bo = $("ropc"); bo.hidden = !nOpc && !verOpc; bo.textContent = verOpc ? "Ocultar opcionais" : `+ ${nOpc} foto(s) opcional(is)`; bo.onclick = () => { verOpc = !verOpc; desenharRoteiro(); };
    document.querySelectorAll("[data-rf]").forEach((b) => (b.onclick = async () => { parar(); clearTimeout(tSalvar); await salvar(lerCampos()); editing = false; go({ v: "visita", id: route.id, item: b.dataset.rf }); })); };
  const salvarFala = (id, v) => setAmbs((ambs) => { const a = ambs.find((y) => y.id === id); if (a) a.fala = v; });
  const setAmbs = async (fn) => { const at = cur(); const ambs = JSON.parse(JSON.stringify(at.captacao?.ambientes || [])); fn(ambs); return await salvar({ captacao: { ambientes: ambs } }); };
  const enviarFotos = async (files, ambId, item) => {
    if (!files || !files.length) return; parar();
    const prog = document.createElement("p"); prog.className = "status"; $("ambs").appendChild(prog);
    let alvo = ambId; if (!alvo) { alvo = uid("a"); await setAmbs((ambs) => ambs.push({ id: alvo, nome: item ? item.nome : "Ambiente " + (ambs.length + 1), ...(item ? { roteiro: item.id, nome_manual: true } : {}), fotos: [], fala: "", criado: now() })); desenharAmbs(); }
    const novas = [];
    for (let i = 0; i < files.length; i++) {
      prog.textContent = `Tratando e enviando foto ${i + 1} de ${files.length}…`;
      try {
        const r = await tratarFoto(files[i]);
        const up = await api("fotos", { method: "POST", body: JSON.stringify({ oferta: route.id, jpeg_base64: await blobB64(r.blob) }) });
        MINI[up.k] = r.mini; novas.push({ k: up.k, w: r.w, h: r.h, avisos: r.avisos, em: now() });
      } catch (e) { toast("Foto " + (i + 1) + ": " + e.message); }
    }
    await setAmbs((ambs) => { const a = ambs.find((x) => x.id === alvo); if (a) a.fotos = [...(a.fotos || []), ...novas]; });
    prog.remove(); desenharAmbs();
    if (novas.length) { const a = (cur().captacao.ambientes || []).find((x) => x.id === alvo); if (a && !a.ia_em) organizar(alvo); }
  };
  const organizar = async (id) => {
    const at = cur(); const a = (at.captacao?.ambientes || []).find((x) => x.id === id); if (!a) return;
    const btn = document.querySelector(`[data-ia="${id}"]`); if (btn) { btn.disabled = true; btn.textContent = "Organizando…"; }
    try {
      const imgs = (await Promise.all((a.fotos || []).slice(0, 3).map((f) => miniDe(f.k)))).filter(Boolean);
      const r = await api("ia/ambiente", { method: "POST", body: JSON.stringify({ imagens: imgs, fala: a.fala || "", tipo: at.tipo }) });
      await setAmbs((ambs) => { const x = ambs.find((y) => y.id === id); if (!x) return; if (!x.nome_manual && r.ambiente) x.nome = r.ambiente; x.descricao = r.descricao || x.descricao; x.caracteristicas = r.caracteristicas || []; x.avisos = r.foto && r.foto.ok === false ? r.foto.problemas || [] : []; x.ia_em = now(); });
      const p = mesclarDados(cur(), r.dados); if (Object.keys(p).length) { await salvar(p); desenharNums(); document.querySelectorAll("[data-c]").forEach((el) => { if (p[el.dataset.c] !== undefined) el.value = p[el.dataset.c]; }); toast("Dados da fala aplicados: " + Object.keys(p).map((k) => PC.CAMPOS[k]?.[0] || k).join(", ")); }
    } catch (e) { toast("IA indisponível: " + e.message); }
    desenharAmbs();
  };
  const microfone = (btn, alvoDe) => {
    if (btn.classList.contains("on")) return parar();
    parar();
    const mid = btn.dataset.mic; const botao = () => document.querySelector(`[data-mic="${mid}"]`);
    if (!vozDisponivel()) { alvoDe().focus(); toast("Use o microfone do teclado para ditar."); return; }
    btn.classList.add("on");
    voz = ditar({ aoTexto: (t) => { const alvo = alvoDe(); if (!alvo) return; alvo.value = (alvo.value ? alvo.value.replace(/\s+$/, "") + " " : "") + t; if (mid === "fg") alvo.dispatchEvent(new Event("input", { bubbles: true })); else salvarFala(mid, alvo.value); },
      aoParcial: () => {}, aoFim: () => { const b = botao(); if (b) b.classList.remove("on"); }, aoErro: (e) => { const b = botao(); if (b) b.classList.remove("on"); voz = null; const alvo = alvoDe(); if (alvo) alvo.focus(); toast(e === "not-allowed" ? "Libere o microfone para este site nas configurações do Safari." : "Ditado indisponível: use o microfone do teclado."); } });
  };
  function ligarAmbs() {
    document.querySelectorAll("[data-addf]").forEach((x) => (x.onchange = () => enviarFotos([...x.files], x.dataset.addf)));
    document.querySelectorAll("[data-ia]").forEach((x) => (x.onclick = () => organizar(x.dataset.ia)));
    document.querySelectorAll("[data-capa]").forEach((x) => (x.onclick = async () => { await salvar({ capa: x.dataset.capa }, "Capa definida."); desenharAmbs(); }));
    document.querySelectorAll("[data-xf]").forEach((x) => confirmar2(x, "?", async () => { const [aid, k] = x.dataset.xf.split("|"); await setAmbs((ambs) => { const a = ambs.find((y) => y.id === aid); if (a) a.fotos = a.fotos.filter((f) => f.k !== k); }); api("fotos?k=" + encodeURIComponent(k), { method: "DELETE" }).catch(() => {}); desenharAmbs(); }));
    document.querySelectorAll("[data-rm]").forEach((x) => confirmar2(x, "Confirmar", async () => { await setAmbs((ambs) => ambs.splice(ambs.findIndex((y) => y.id === x.dataset.rm), 1)); desenharAmbs(); }));
    document.querySelectorAll("[data-an]").forEach((x) => (x.onchange = () => setAmbs((ambs) => { const a = ambs.find((y) => y.id === x.dataset.an); if (a) { a.nome = x.value.trim(); a.nome_manual = true; } })));
    document.querySelectorAll("[data-fala]").forEach((x) => x.addEventListener("input", () => { clearTimeout(x._t); x._t = setTimeout(() => salvarFala(x.dataset.fala, x.value), 700); }));
    document.querySelectorAll("[data-mic]").forEach((b) => (b.onclick = () => microfone(b, () => (b.dataset.mic === "fg" ? $("fg") : document.querySelector(`[data-fala="${b.dataset.mic}"]`)))));
  }
  $("vguiada").onclick = async () => { parar(); clearTimeout(tSalvar); await salvar(lerCampos()); editing = false; go({ v: "visita", id: route.id }); };
  if (route.gerar) { route.gerar = false; setTimeout(() => $("ga") && $("ga").click(), 300); }
  $("camR").onchange = () => { if (itemFoto) enviarFotos([...$("camR").files], null, itemFoto); };
  $("camN").onchange = () => enviarFotos([...$("camN").files]); $("galN").onchange = () => enviarFotos([...$("galN").files]);
  desenharAmbs();

  // gerar anúncio
  $("ga").onclick = async () => {
    parar(); clearTimeout(tSalvar); await salvar({ ...lerCampos(), captacao: { fala_geral: $("fg").value } });
    const at = cur(); const b = $("ga"); b.disabled = true; b.textContent = "Gerando…";
    try {
      const ficha = {}; ["tipo", "operacao", "cidade", "regiao", ...NUM_IA, "iptu_periodo", "disponibilidade", "documentacao", "aptidao", "agua", "benfeitorias", "topografia", "car", "ccir", "georref", "zoneamento", "frente"].forEach((k) => { if (at[k]) ficha[k] = at[k]; });
      const r = await api("ia/anuncio", { method: "POST", body: JSON.stringify({ ficha, ambientes: (at.captacao?.ambientes || []).map((a) => ({ nome: a.nome, descricao: a.descricao, caracteristicas: a.caracteristicas, fala: a.fala, fotos: (a.fotos || []).length })), fala_geral: at.captacao?.fala_geral || "" }) });
      const p = { ...mesclarDados(at, r.dados), titulo: r.titulo || at.titulo, subtitulo: r.subtitulo || at.subtitulo, descricao: r.descricao || at.descricao, diferenciais: (r.destaques || []).join("\n") || at.diferenciais, pendencias: r.pendencias || [] };
      await salvar(p, "Anúncio gerado. Revise o texto.");
      Object.entries(p).forEach(([k, v]) => { const el = document.querySelector(`[data-c="${k}"]`); if (el && typeof v === "string") el.value = v; }); desenharNums();
      $("pend").innerHTML = (r.pendencias || []).length ? `<p class="note">Para completar: ${esc(r.pendencias.join(" · "))}</p>` : "";
    } catch (e) { toast("Não foi possível gerar: " + e.message); }
    b.disabled = false; b.textContent = "Gerar de novo"; medidor(); passos();
  };
  if ((o.pendencias || []).length) $("pend").innerHTML = `<p class="note">Para completar: ${esc(o.pendencias.join(" · "))}</p>`;

  // próximos passos
  const passos = () => {
    const at = cur(); const an = anuncioDe(at); const pedAb = S.pedidos.filter((p) => p.oferta === at.id).sort((a, b) => (b.criado || "").localeCompare(a.criado || ""))[0];
    const aut = at.autorizacao || at.autorizacao_manual; const nf = fotosDe(at);
    const falta = [!at.titulo && "título", !at.descricao && "descrição", nf < 3 && "pelo menos 3 fotos", !(PC.parseBR(at.venda) || PC.parseBR(at.aluguel)) && "valor"].filter(Boolean);
    const link = an ? `${baseAnuncios()}/i/${an.id}` : ""; const rot = casarRoteiro(at);
    const st1 = !!aut, st2 = !!(an && an.status === "ativo"), st3 = at.status !== "captacao";
    const num = (n, ok) => `<span class="pnum ${ok ? "ok" : ""}">${ok ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>' : n}</span>`;
    const ac = (id, ic, l, extra = "", tag = "button") => tag === "a" ? `<a class="acao" ${extra}>${icAc(ic)}<span>${l}</span></a>` : `<button class="acao" id="${id}" ${extra}>${icAc(ic)}<span>${l}</span></button>`;
    $("fx").innerHTML = `<h2>Próximos passos</h2><div class="passos">
    <div class="passo ${st1 ? "ok" : ""}">${num(1, st1)}<div class="pc"><b>Autorização de comercialização</b>
      ${at.autorizacao ? `<p class="tag ok">Autorizado por ${esc(at.autorizacao.responsavel || at.autorizacao.razao)} em ${esc(fdt(at.autorizacao.em))}</p>` : at.autorizacao_manual ? `<p class="tag ok">Autorização por escrito fora do sistema, registrada por ${esc(at.autorizacao_manual.por)} em ${esc(fdt(at.autorizacao_manual.em))}</p>` : pedAb ? `<p class="hint">Enviada em ${esc(fdt(pedAb.criado))}: ${esc(STATUS_P[pedAb.status] || pedAb.status)}.</p>` : `<p class="hint">O proprietário recebe a ficha e aceita a autorização pelo celular (link) ou no PDF.</p>`}
      ${!aut ? `<div class="acoes">${pedAb ? ac("vped", "doc", "Ver pedido") : ""}${ac("paut", "enviar", pedAb ? "Novo pedido" : "Pedir autorização", pedAb ? "" : 'data-p="1"')}</div><label class="check"><input type="checkbox" id="amanual"> O proprietário já assinou autorização por escrito (fica registrado em meu nome)</label>` : ""}</div></div>
    <div class="passo ${st2 ? "ok" : ""}">${num(2, st2)}<div class="pc"><b>Anúncio (página para WhatsApp)</b>
      ${falta.length ? `<p class="hint">Falta: ${esc(falta.join(", "))}.</p>` : ""}${rot.faltam.length ? `<p class="hint">Roteiro: falta foto de ${esc(rot.faltam.map((x) => x.nome).join(", "))}.</p>` : ""}
      ${st2 ? `<p class="linkbox">${esc(link)}</p><p class="hint">${an.visitas || 0} visita(s) · publicado em ${esc(fdt(an.publicado_em))}${an.atualizado_em ? " · atualizado " + esc(fdt(an.atualizado_em)) : ""}</p>
        <div class="acoes">${ac("", "zap", "WhatsApp", `data-p="1" target="_blank" rel="noopener" href="${esc(waLink("", `${at.titulo}\n${link}`))}"`, "a")}${ac("cpl", "link", "Copiar link")}${ac("", "olho", "Ver página", `target="_blank" rel="noopener" href="${esc(link)}"`, "a")}${ac("pub", "atualizar", "Atualizar")}${ac("enc", "fechar", "Encerrar", 'data-g="1"')}</div>`
      : `<div class="acoes">${ac("pub", "megafone", "Publicar anúncio", `data-p="1" ${falta.length || !aut ? "disabled" : ""}`)}</div>${!aut ? '<p class="hint">Publica depois da autorização do proprietário.</p>' : ""}`}</div></div>
    <div class="passo ${st3 ? "ok" : ""}">${num(3, st3)}<div class="pc"><b>Banco de ofertas</b>
      ${st3 ? `<p class="tag ok">No banco de ofertas${at.codigo ? " como " + esc(at.codigo) : ""}.</p>` : `<p class="hint">Entra no cruzamento com os briefings e no ranking.</p><button class="cta-banco" id="conc">${icAc("banco")}<span><b>Concluir captação</b><small>Enviar ao banco de ofertas</small></span><span class="seta">›</span></button>`}
      <div class="acoes">${ac("pdfc", "pdf", "Ficha PDF")}${ac("zipc", "pacote", "Pacote p/ sistema")}${ac("vof", "oferta", "Abrir oferta")}</div><p class="hint mini">Pacote: XML (VRSync), planilha e fotos nomeadas por ambiente.</p></div></div></div>`;
    $("fx").querySelectorAll(".acoes").forEach((x) => x.classList.add("n" + Math.min(3, x.children.length)));
    const paut = $("paut"); if (paut) paut.onclick = async () => { parar(); clearTimeout(tSalvar); await salvar({ ...lerCampos(), anunciante_tipo: "Proprietário" }); editing = false; go({ v: "novopedido", o: at.id }); };
    const am = $("amanual"); if (am) am.onchange = async () => { if (!am.checked) return; await salvar({ autorizacao_manual: { em: now(), por: EU.usuario || usuarioAtual?.email } }, "Autorização registrada."); passos(); };
    const vp = $("vped"); if (vp) vp.onclick = () => { editing = false; go({ v: "pedido", id: pedAb.id }); };
    const pub = $("pub"); if (pub) pub.onclick = publicar;
    const cpl = $("cpl"); if (cpl) cpl.onclick = () => copiar(link);
    const enc = $("enc"); if (enc) confirmar2(enc, "Toque de novo para encerrar", async () => { await store.save("anuncios", { ...an, status: "encerrado", encerrado_em: now() }); toast("Anúncio encerrado."); passos(); });
    const cc = $("conc"); if (cc) cc.onclick = async () => { const cod = await garantirCodigo(cur()); await salvar({ status: "revisada", codigo: cod, captacao: { concluida: now() } }, "Captação no banco de ofertas como " + cod + "."); header("Captação " + cod); passos(); };
    $("pdfc").onclick = async () => { clearTimeout(tSalvar); await salvar(lerCampos()); await gerarPDF(cur(), { semTermo: true }); };
    $("vof").onclick = () => { parar(); editing = false; go({ v: "oferta", id: at.id }); };
    $("zipc").onclick = async () => { clearTimeout(tSalvar); await salvar(lerCampos()); const b = $("zipc"); b.disabled = true; try { await exportarPacote(cur()); } catch (e) { toast("Falhou: " + e.message); } b.disabled = false; };
  };
  const publicar = async () => {
    clearTimeout(tSalvar); await salvar(lerCampos());
    const at = cur(); const d = PC.num(at); const codigo = await garantirCodigo(at); const a2 = cur();
    const res = PC.grupo(d.tipo) === "residencial"; const rur = PC.grupo(d.tipo) === "rural"; const lot = PC.grupo(d.tipo) === "area";
    const fatos = (rur ? [[d.area_ha && PC.ha(d.area_ha), "Área total"], [d.area_ha && PC.nf(Math.round(d.area_ha / PC.ALQ_SP * 10) / 10), "Alqueires paulistas"], [a2.aptidao, "Aptidão"], [a2.agua, "Água"], [d.distancia_asfalto && PC.nf(d.distancia_asfalto) + " km", "Até o asfalto"]]
      : lot ? [[d.terreno && PC.m2(d.terreno), "Terreno"], [d.frente && PC.nf(d.frente) + " m", "Frente"], [a2.zoneamento, "Zoneamento"], [a2.topografia, "Topografia"]]
      : res ? [[d.construida && PC.m2(d.construida), "Área útil"], [d.dormitorios && PC.nf(d.dormitorios) + (d.suites ? ` (${PC.nf(d.suites)} suíte${d.suites > 1 ? "s" : ""})` : ""), "Dormitórios"], [d.banheiros && PC.nf(d.banheiros), "Banheiros"], [d.vagas && PC.nf(d.vagas), "Vagas"], [d.terreno && PC.m2(d.terreno), "Terreno"]]
      : [[d.construida && PC.m2(d.construida), "Área construída"], [d.fabril && PC.m2(d.fabril), "Galpão"], [d.terreno && PC.m2(d.terreno), "Terreno"], [d.pe_direito && PC.nf(d.pe_direito) + " m", "Pé-direito"], [d.docas && PC.nf(d.docas), "Docas"], [d.energia_kva && PC.nf(d.energia_kva) + " kVA", "Energia"]]).filter((x) => x[0]).map(([v, l]) => [l, v]);
    const valores = [[d.venda && PC.brl(d.venda), "Venda"], [d.aluguel && PC.brl(d.aluguel) + "/mês", "Aluguel"], [d.condominio && PC.brl(d.condominio) + "/mês", "Condomínio"], [d.iptu && PC.brl(d.iptu) + (d.iptu_periodo === "anual" ? "/ano" : d.iptu_periodo === "mensal" ? "/mês" : ""), "IPTU"]].filter((x) => x[0]).map(([v, l]) => [l, v]);
    const ambs = a2.captacao?.ambientes || []; let fotos = ambs.flatMap((a) => (a.fotos || []).map((f) => ({ k: f.k, ambiente: a.nome })));
    const ci = fotos.findIndex((f) => f.k === a2.capa); if (ci > 0) fotos = [fotos[ci], ...fotos.slice(0, ci), ...fotos.slice(ci + 1)];
    const ant = anuncioDe(a2); const token = ant ? ant.id : tokenAleatorio(22);
    const reg = { ...(ant || {}), id: token, oferta: a2.id, status: "ativo", codigo, tipo: a2.tipo, operacao: a2.operacao, cidade: a2.cidade, regiao: a2.regiao, titulo: a2.titulo, subtitulo: a2.subtitulo || "", descricao: a2.descricao, destaques: PC.lines(a2.diferenciais).slice(0, 10), fatos, valores, fotos: fotos.slice(0, 60), ambientes: ambs.map((a) => ({ nome: a.nome, descricao: a.descricao || "" })), corretor: corretorDaOferta(a2), publicado_em: ant?.publicado_em || now(), atualizado_em: ant ? now() : null, visitas: ant?.visitas || 0 };
    try {
      await store.save("anuncios", reg);
      await salvar({ anuncio_token: token, status: a2.status === "captacao" ? "revisada" : a2.status, codigo });
      await emitir({ tipo: "anuncio_publicado", oferta_id: a2.id, destinatario: "Página pública", conteudo: `${baseAnuncios()}/i/${token}\n${a2.titulo} · ${fotos.length} foto(s) · ${corretorDaOferta(a2).nome}`, meta: { token, atualizacao: !!ant } });
      toast(ant ? "Página atualizada." : "Anúncio publicado."); header("Captação " + codigo); passos();
    } catch {}
  };
  medidor(); passos();
};

/* ---------- Visita guiada: câmera ao vivo, ambiente por ambiente ---------- */
let CAM = null; // stream da câmera aberta
function pararCamera() { if (CAM) { try { CAM.getTracks().forEach((t) => t.stop()); } catch {} CAM = null; } if (window.__vozVisita) { try { window.__vozVisita.parar(); } catch {} window.__vozVisita = null; } }
async function ambientesSalvar(id, fn) { const at = O(id); const ambs = JSON.parse(JSON.stringify(at.captacao?.ambientes || [])); const r = fn(ambs); await store.save("ofertas", { ...at, captacao: { ...(at.captacao || {}), ambientes: ambs }, atualizado: now() }); return r; }
/** Descrição pela IA com as fotos (até 3) e a fala do ambiente; aplica números falados na ficha. */
async function descreverAmbiente(oid, aid) {
  const at = O(oid); const a = (at.captacao?.ambientes || []).find((x) => x.id === aid); if (!a) return null;
  const imgs = (await Promise.all((a.fotos || []).slice(-3).map((f) => miniDe(f.k)))).filter(Boolean);
  const r = await api("ia/ambiente", { method: "POST", body: JSON.stringify({ imagens: imgs, fala: a.fala || "", tipo: at.tipo, item: a.nome }) });
  await ambientesSalvar(oid, (ambs) => { const x = ambs.find((y) => y.id === aid); if (!x) return; if (!x.nome_manual && r.ambiente) x.nome = r.ambiente; x.descricao = r.descricao || x.descricao; x.caracteristicas = r.caracteristicas || []; x.avisos = r.foto && r.foto.ok === false ? r.foto.problemas || [] : []; x.ia_em = now(); });
  const p = mesclarDados(O(oid), r.dados); if (Object.keys(p).length) await store.save("ofertas", { ...O(oid), ...p, atualizado: now() });
  return { r, aplicados: Object.keys(p) };
}
VIEWS.visita = () => {
  const o0 = O(route.id); if (!o0) return back();
  header("Visita guiada" + (o0.codigo ? " · " + o0.codigo : ""));
  const envio = MODO() === "escritorio" && !route.webcam; // computador: fotos enviadas (do celular, do parceiro), mesmo roteiro guiado
  const itens = () => { const r = casarRoteiro(O(route.id)); return [...r.itens.filter((x) => x.obrigatorio), ...r.itens.filter((x) => !x.obrigatorio)]; };
  let idx = Math.max(0, itens().findIndex((x) => x.obrigatorio && !x.amb)); if (route.idx != null) idx = route.idx; else if (route.item) { const i = itens().findIndex((x) => x.id === route.item); if (i >= 0) idx = i; route.item = null; route.idx = idx; }
  let extraId = null; // ambiente extra em andamento
  $("main").innerHTML = `<div class="visita">
    <div class="vtop"><div class="vt1"><span id="vpos"></span><button class="lnk" id="vfim">Concluir visita</button></div><b id="vnome"></b><small id="vdica" title="Toque para ver a dica inteira"></small></div>
    <div class="vstrip" id="vstrip"></div>
    ${envio ? `<label class="visor drop" id="vdrop"><input type="file" id="vup" accept="image/*" multiple hidden><span class="dz">${icAc("upload")}<b>Arraste aqui as fotos deste ambiente</b><small>ou clique para escolher · fotos do celular, do parceiro ou do proprietário · a IA trata luz, cor e nitidez</small></span>
      <em class="vguia" id="vguia"></em><span class="vcont" id="vcont"></span><div class="vthumbs" id="vthumbs"></div></label>
      <p class="hint mini">Está no imóvel com o celular? Use a câmera guiada no celular. <button class="lnk" id="wc">Usar a webcam deste computador</button></p>`
    : `<div class="visor"><video id="vid" playsinline muted autoplay></video><div class="vflash" id="vflash"></div><p class="vmsg" id="vmsg">Abrindo a câmera…</p>
      <em class="vguia" id="vguia"></em><span class="vcont" id="vcont"></span><div class="vthumbs" id="vthumbs"></div>
      <label class="vgal" title="Enviar fotos da galeria (ex.: recebidas do parceiro)" aria-label="Enviar fotos da galeria"><input type="file" id="vgal" accept="image/*" multiple hidden>${icAc("galeria")}</label>
      <button class="obt" id="obt" aria-label="Tirar foto"></button></div>`}
    <label class="btn sm" id="vfb" hidden><input type="file" id="vfile" accept="image/*" capture="environment" multiple hidden>📷 Usar a câmera do celular</label>
    <div class="vcard"><textarea id="vfala" rows="2" placeholder="Fale ou escreva: acabamento, tamanho, estado, diferenciais…"></textarea>
      <p class="desc" id="vdesc" hidden></p><p class="note" id="vprob" hidden></p><p class="status" id="vst"></p></div>
    <div class="vbar"><button id="vant" aria-label="Ambiente anterior">‹</button><button class="mic" id="vmic">🎙 Descrever</button><button class="p" id="vprox">Salvar e seguir ›</button></div></div>`;
  $("vdica").onclick = () => $("vdica").classList.toggle("aberta");
  const amb = () => { const it = itens()[idx]; const at = O(route.id); if (extraId) return (at.captacao?.ambientes || []).find((a) => a.id === extraId) || null; return it && it.amb ? (at.captacao?.ambientes || []).find((a) => a.id === it.amb.id) : null; };
  const desenhar = () => {
    const L = itens(); const it = L[idx]; const a = amb(); const falt = L.filter((x) => x.obrigatorio && !x.amb).length;
    $("vpos").textContent = extraId ? "Ambiente extra" : `${idx + 1} de ${L.length} · ${falt ? "faltam " + falt : "obrigatórias completas ✓"}`;
    $("vnome").textContent = extraId ? (a?.nome || "Ambiente extra") : it ? it.nome + (it.obrigatorio ? "" : " (opcional)") : "Roteiro concluído";
    $("vdica").textContent = extraId ? "Fotografe e fale: a IA dá o nome do ambiente." : it ? it.dica : "Toque em Concluir visita para gerar o anúncio.";
    $("vstrip").innerHTML = L.map((x, i) => `<button class="vs ${x.amb ? "ok" : x.obrigatorio ? "obr" : ""} ${i === idx && !extraId ? "on" : ""}" data-vi="${i}" title="${esc(x.nome)}" aria-label="${esc(x.nome)}">${icAmb(x.id)}</button>`).join("") + `<button class="vs mais ${extraId ? "on" : ""}" id="vextra" title="Ambiente extra" aria-label="Ambiente extra">+</button>`;
    $("vextra").onclick = novoExtra;
    $("vstrip").querySelectorAll("[data-vi]").forEach((b) => (b.onclick = () => irPara(Number(b.dataset.vi))));
    const on = $("vstrip").querySelector(".on"); if (on) on.scrollIntoView({ block: "nearest", inline: "center" });
    const fotos = a?.fotos || []; $("vcont").textContent = fotos.length ? fotos.length + " foto(s)" : "";
    $("vthumbs").innerHTML = fotos.map((f) => `<div class="th"><img src="${fotoURL(f.k)}" alt=""></div>`).join("");
    const fa = $("vfala"); if (document.activeElement !== fa) fa.value = a?.fala || "";
    $("vdesc").hidden = !a?.descricao; $("vdesc").textContent = a?.descricao || "";
    $("vprob").hidden = !(a?.avisos || []).length; $("vprob").textContent = (a?.avisos || []).length ? "⚠ " + a.avisos.join(" · ") : "";
    $("vant").disabled = idx === 0 && !extraId; $("vprox").textContent = idx >= L.length - 1 && !extraId ? "Concluir ✓" : fotos.length || !it?.obrigatorio || extraId ? "Salvar e seguir ›" : "Pular ›";
    const passo = !fotos.length ? (envio ? "1 · Envie as fotos deste ambiente" : "1 · Tire a foto deste ambiente") : !(a?.fala || "").trim() ? "2 · Agora descreva os detalhes" : "3 · Pronto: salve e siga";
    $("vguia").textContent = passo; $("vmic").classList.toggle("pulse", !!fotos.length && !(a?.fala || "").trim() && !window.__vozVisita);
  };
  const garantirAmb = async () => {
    const a = amb(); if (a) return a.id; const it = itens()[idx]; const id = uid("a");
    if (extraId) return extraId;
    await ambientesSalvar(route.id, (ambs) => ambs.push({ id, nome: it.nome, roteiro: it.id, nome_manual: true, fotos: [], fala: "", criado: now() }));
    return id;
  };
  const st = (m, err) => { if (!$("vst")) return; $("vst").className = "status" + (err ? " err" : ""); $("vst").textContent = m || ""; };
  let descrevendo = false, deNovo = false;
  const descrever = async () => { const a = amb(); if (!a) return; if (descrevendo) { deNovo = true; return; } descrevendo = true; st("IA descrevendo o ambiente…");
    try { const r = await descreverAmbiente(route.id, a.id); st(r?.aplicados.length ? "Dados da fala aplicados: " + r.aplicados.map((k) => PC.CAMPOS[k]?.[0] || k).join(", ") : ""); } catch (e) { st("IA indisponível agora: " + e.message + ". Siga a visita; dá para descrever depois.", true); }
    descrevendo = false; if ($("vdesc")) desenhar(); if (deNovo) { deNovo = false; descrever(); } };
  const registrar = async (files) => {
    const aid = await garantirAmb(); let n = 0;
    for (const [i, f] of files.entries()) { st(files.length > 1 ? `Tratando e enviando a foto ${i + 1} de ${files.length}…` : "Tratando e enviando a foto…");
      try { const r = await tratarFoto(f); const up = await api("fotos", { method: "POST", body: JSON.stringify({ oferta: route.id, jpeg_base64: await blobB64(r.blob) }) }); MINI[up.k] = r.mini; await ambientesSalvar(route.id, (ambs) => { const x = ambs.find((y) => y.id === aid); if (x) x.fotos = [...(x.fotos || []), { k: up.k, w: r.w, h: r.h, avisos: r.avisos, em: now() }]; }); n++; if (r.avisos.length) toast(r.avisos.join(" ")); }
      catch (e) { st("Foto não enviada: " + e.message, true); } }
    desenhar(); if (n) descrever();
  };
  // câmera ao vivo (com alternativa da câmera nativa)
  const abrir = async () => {
    pararCamera();
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("sem suporte");
      CAM = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      const v = $("vid"); if (!v) return pararCamera(); v.srcObject = CAM; await v.play().catch(() => {}); $("vmsg").hidden = true; $("obt").disabled = false;
    } catch (e) { $("vmsg").textContent = e && e.name === "NotAllowedError" ? "Câmera bloqueada: libere nas configurações do navegador ou use a câmera do celular abaixo." : "Câmera ao vivo indisponível: use a câmera do celular abaixo."; $("vfb").hidden = false; $("obt").disabled = true; }
  };
  if (envio) {
    const dz = $("vdrop"); $("vup").onchange = () => { registrar([...$("vup").files]); $("vup").value = ""; };
    dz.addEventListener("dragover", (e) => { e.preventDefault(); dz.classList.add("on"); }); dz.addEventListener("dragleave", () => dz.classList.remove("on"));
    dz.addEventListener("drop", (e) => { e.preventDefault(); dz.classList.remove("on"); const fs = [...(e.dataTransfer?.files || [])].filter((f) => /^image\//.test(f.type)); if (fs.length) registrar(fs); });
    $("wc").onclick = (e) => { e.preventDefault(); route.webcam = true; editing = false; VIEWS.visita(); };
  } else {
  $("vgal").onchange = () => { registrar([...$("vgal").files]); $("vgal").value = ""; };
  $("obt").onclick = async () => {
    const v = $("vid"); if (!CAM || !v.videoWidth) return;
    const c = document.createElement("canvas"); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext("2d").drawImage(v, 0, 0);
    $("vflash").classList.remove("on"); void $("vflash").offsetWidth; $("vflash").classList.add("on");
    const b = await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.92)); await registrar([new File([b], "foto.jpg", { type: "image/jpeg" })]);
  };
  $("vfile").onchange = () => registrar([...$("vfile").files]);
  }
  // fala
  const salvarFala = async (txt) => { const aid = await garantirAmb(); await ambientesSalvar(route.id, (ambs) => { const x = ambs.find((y) => y.id === aid); if (x) x.fala = txt; }); };
  $("vfala").addEventListener("input", () => { clearTimeout($("vfala")._t); $("vfala")._t = setTimeout(() => salvarFala($("vfala").value), 700); });
  $("vfala").addEventListener("change", () => { salvarFala($("vfala").value).then(descrever); });
  $("vmic").onclick = () => {
    const b = $("vmic");
    if (window.__vozVisita) { window.__vozVisita.parar(); return; }
    if (!vozDisponivel()) { $("vfala").focus(); toast("Use o microfone do teclado para ditar."); return; }
    b.classList.add("on"); b.textContent = "■ Parar";
    window.__vozVisita = ditar({ aoTexto: (t) => { const fa = $("vfala"); if (!fa) return; fa.value = (fa.value ? fa.value.replace(/\s+$/, "") + " " : "") + t; },
      aoFim: async () => { window.__vozVisita = null; const bb = $("vmic"); if (!bb) return; bb.classList.remove("on"); bb.textContent = "🎙 Descrever"; await salvarFala($("vfala").value); descrever(); },
      aoErro: (e) => { window.__vozVisita = null; const bb = $("vmic"); if (bb) { bb.classList.remove("on"); bb.textContent = "🎙 Descrever"; } toast(e === "not-allowed" ? "Libere o microfone para este site." : "Ditado indisponível: use o microfone do teclado."); } });
  };
  const mudar = async (d) => { if (window.__vozVisita) window.__vozVisita.parar(); const fa = $("vfala"); if (fa && fa.value !== (amb()?.fala || "")) await salvarFala(fa.value);
    const L = itens(); if (extraId) { extraId = null; desenhar(); return; } if (d > 0 && idx >= L.length - 1) return concluir(); idx = Math.max(0, Math.min(L.length - 1, idx + d)); route.idx = idx; st(""); desenhar(); };
  $("vprox").onclick = () => mudar(1); $("vant").onclick = () => mudar(-1);
  const irPara = async (i) => { if (window.__vozVisita) window.__vozVisita.parar(); const fa = $("vfala"); if (fa && fa.value !== (amb()?.fala || "")) await salvarFala(fa.value); extraId = null; idx = i; route.idx = i; st(""); desenhar(); };
  const novoExtra = async () => { const id = uid("a"); await ambientesSalvar(route.id, (ambs) => ambs.push({ id, nome: "Ambiente extra", fotos: [], fala: "", criado: now() })); extraId = id; st(""); desenhar(); };
  const concluir = () => { pararCamera(); const falt = itens().filter((x) => x.obrigatorio && !x.amb); if (falt.length) toast("Faltaram: " + falt.map((x) => x.nome).join(", ") + ". Você pode completar depois."); route.idx = null; const prev = stack[stack.length - 1]; const temFotos = (O(route.id)?.captacao?.ambientes || []).some((x) => (x.fotos || []).length); if (prev && prev.v === "captacao" && temFotos) prev.gerar = true; back(); };
  $("vfim").onclick = concluir;
  editing = true; // salvar não redesenha a tela (a câmera continua aberta)
  desenhar(); if (!envio) abrir();
};

/* ---------- Anúncios publicados ---------- */
VIEWS.anuncios = (recarregado) => {
  header("Anúncios publicados");
  if (recarregado !== true) store.carregar().then(() => { if (route.v === "anuncios") VIEWS.anuncios(true); }).catch(() => {});
  const as = [...S.anuncios].sort((a, b) => (b.publicado_em || "").localeCompare(a.publicado_em || ""));
  $("main").innerHTML = `<div class="card"><div class="list">${as.map((a) => `<div class="item"><span class="dot ${a.status === "ativo" ? "verde" : ""}"></span><span class="t"><b>${esc((a.codigo ? a.codigo + " · " : "") + a.titulo)}</b><span>${esc([a.status === "ativo" ? "No ar" : "Encerrado", (a.visitas || 0) + " visita(s)", (a.fotos || []).length + " foto(s)", a.corretor?.nome?.split(" ")[0], fdt(a.publicado_em)].filter(Boolean).join(" · "))}</span></span>${a.status === "ativo" ? `<a class="btn sm" target="_blank" rel="noopener" href="/i/${esc(a.id)}">Ver</a>` : ""}<button class="sm" data-oc="${esc(a.oferta)}">Abrir</button></div>`).join("") || '<p class="empty">Nenhum anúncio publicado. Publique a partir de uma captação.</p>'}</div></div>`;
  document.querySelectorAll("[data-oc]").forEach((b) => (b.onclick = () => go({ v: "captacao", id: b.dataset.oc })));
};

/* ================= VERIFICAÇÃO DO IMÓVEL ================= */
const ST_V = { ok: "ok", a: "", v: "v", pend: "p" };
function cardVerif(o) {
  const rural = V.ehRural(o.tipo); const m = o.verificacao?.matricula; const lei = o.verificacao?.leitura;
  const campos = V.CAMPOS.map(([k, l, ph, g]) => `<label class="${["endereco", "proprietario", "cartorio", "complemento"].includes(k) ? "full" : ""}" data-vg="${g}"${(g === "rural" && !rural) || (g === "urbano" && rural) ? " hidden" : ""}>${l}<input data-f="${k}" placeholder="${esc(ph)}"${k === "cep" ? ' inputmode="numeric"' : ""}></label>`).join("");
  const onus = (m?.onus || []);
  return `<div class="card" id="vcard"><div class="row" style="justify-content:space-between"><h2>Verificação do imóvel</h2><span class="tag">privado · não sai no anúncio</span></div>
  <div class="sem" id="vsem"><i></i><div><span id="vsemT"></span><small id="vsemS"></small></div></div>
  <div class="meter"><i id="vbar"></i></div><p class="hint" id="vtxt"></p><ul class="alerts verif" id="vit"></ul>
  <div class="row wrap"><button class="p" id="vvar">Varrer agora</button><label class="btn" for="vmat">Enviar documento (matrícula, IPTU, CCIR/CAR)</label><input type="file" id="vmat" accept="application/pdf,image/jpeg,image/png,image/webp" hidden><button id="vpdf">Relatório PDF</button></div>
  <div class="status" id="vst">${lei?.status === "lendo" ? (lei.origem === "anunciante" ? "Documento enviado pelo anunciante: lendo com IA…" : "Lendo o documento com IA… (até 1 minuto)") : lei?.status === "erro" ? "Leitura do documento falhou: " + esc(lei.msg || "") : o.verificacao?.varrido_em ? "Última varredura: " + esc(fdt(o.verificacao.varrido_em)) : "A varredura roda sozinha ao salvar com CEP, endereço ou CPF/CNPJ."}</div>
  ${m ? `<details class="mat"><summary><b>Matrícula ${esc(m.numero || "")}</b> · ${esc(m.cartorio || "")}${m.data_certidao ? " · certidão de " + esc(m.data_certidao.split("-").reverse().join("/")) : ""}</summary>
    ${m.descricao ? `<p class="hint">${esc(m.descricao)}</p>` : ""}
    <p><b>Proprietário(s):</b> ${esc((m.proprietarios || []).map((p) => [p.nome, p.documento, p.fracao].filter(Boolean).join(" · ")).join("; ") || "não identificado")}</p>
    <p><b>Áreas:</b> ${esc([m.area_terreno && PC.m2(m.area_terreno) + " de terreno", m.area_ha && PC.ha(m.area_ha), m.construcao_averbada === true ? "construção averbada" + (m.area_construida_averbada ? " (" + PC.m2(m.area_construida_averbada) + ")" : "") : m.construcao_averbada === false ? "construção NÃO averbada" : ""].filter(Boolean).join(" · ") || "—")}</p>
    ${onus.length ? `<ul class="alerts">${onus.map((x) => `<li class="${x.cancelado ? "ok" : V.gravidadeOnus(x.tipo + " " + x.descricao)}">${esc(`${x.ato ? x.ato + " · " : ""}${x.tipo}${x.descricao ? ": " + x.descricao : ""}${x.cancelado ? " — cancelado" + (x.cancelado_por ? " (" + x.cancelado_por + ")" : "") : " — ATIVO"}`)}</li>`).join("")}</ul>` : '<p class="hint">Nenhum ônus encontrado na certidão.</p>'}
    ${(m.alertas || []).length ? `<p class="note">${m.alertas.map(esc).join("<br>")}</p>` : ""}
    ${(m.ultimos_atos || []).length ? `<p class="hint">Últimos atos: ${m.ultimos_atos.map(esc).join(" · ")}</p>` : ""}
    ${(m.preencheu || []).length ? `<p class="hint">Campos completados pela leitura: ${esc(m.preencheu.join(", "))}.</p>` : ""}
    ${m.arquivo ? `<a class="btn sm" href="/api/arquivo?k=${encodeURIComponent(m.arquivo)}">Baixar matrícula enviada</a>` : ""}</details>` : ""}
  ${o.verificacao?.iptu ? (() => { const ip = o.verificacao.iptu; return `<details class="mat"><summary><b>IPTU${ip.exercicio ? " " + esc(ip.exercicio) : ""}</b> · inscrição ${esc(ip.inscricao || "?")}${ip.debitos === true ? ' · <span class="tag r">com débitos</span>' : ip.debitos === false ? " · sem débitos" : ""}</summary>
    <p>${esc([ip.contribuinte && "Contribuinte: " + ip.contribuinte, ip.endereco, ip.uso].filter(Boolean).join(" · "))}</p>
    <p><b>Áreas no cadastro municipal:</b> ${esc([ip.area_terreno && PC.m2(ip.area_terreno) + " de terreno", ip.area_construida && PC.m2(ip.area_construida) + " construídos"].filter(Boolean).join(" · ") || "—")}</p>
    ${ip.valor_venal_total ? `<p><b>Valor venal:</b> ${esc(PC.brl(ip.valor_venal_total))}${PC.parseBR(o.venda) ? ` · pedida ${esc((PC.parseBR(o.venda) / ip.valor_venal_total).toFixed(1).replace(".", ","))}× o venal` : ""} <span class="hint">(referência fiscal, não é avaliação de mercado)</span></p>` : ""}
    ${(ip.alertas || []).length ? `<p class="note">${ip.alertas.map(esc).join("<br>")}</p>` : ""}
    ${ip.arquivo ? `<a class="btn sm" href="/api/arquivo?k=${encodeURIComponent(ip.arquivo)}">Baixar IPTU enviado</a>` : ""}</details>`; })() : ""}
  ${o.verificacao?.rural ? (() => { const ru = o.verificacao.rural; return `<details class="mat"><summary><b>${esc(ru.tipo_documento || "Cadastro rural")}</b>${ru.denominacao ? " · " + esc(ru.denominacao) : ""}${ru.situacao_car ? " · CAR " + esc(ru.situacao_car) : ""}</summary>
    <p>${esc([ru.titular && "Titular: " + ru.titular, ru.area_ha && PC.ha(ru.area_ha), ru.modulos_fiscais && ru.modulos_fiscais + " módulos fiscais", ru.reserva_legal_ha && "reserva legal " + PC.ha(ru.reserva_legal_ha), ru.app_ha && "APP " + PC.ha(ru.app_ha)].filter(Boolean).join(" · "))}</p>
    <p class="hint">${esc([ru.car && "CAR " + ru.car, ru.ccir && "CCIR " + ru.ccir, ru.nirf && "NIRF " + ru.nirf, ru.codigo_incra && "INCRA " + ru.codigo_incra, ru.sigef && "SIGEF " + ru.sigef].filter(Boolean).join(" · "))}</p>
    ${(ru.alertas || []).length ? `<p class="note">${ru.alertas.map(esc).join("<br>")}</p>` : ""}
    ${ru.arquivo ? `<a class="btn sm" href="/api/arquivo?k=${encodeURIComponent(ru.arquivo)}">Baixar documento enviado</a>` : ""}</details>`; })() : ""}
  <details><summary>Dados do registro e do proprietário</summary><div class="grid">${campos}</div><p class="hint">Rural: CAR, CCIR e georreferenciamento ficam na ficha (bloco Rural).</p></details>
  <details><summary>Certidões do vendedor/locador <span id="vcn"></span></summary><div class="certs">${V.CERTIDOES.map(([k, l]) => `<label class="cert"><input type="checkbox" data-cert="${k}"><span>${esc(l)}</span><input type="date" data-certd="${k}"></label>`).join("")}</div><p class="hint">Marque quando tiver a certidão em mãos (negativa ou com ressalva analisada). Guarde as cópias no negócio.</p></details>
  <details><summary>Fontes oficiais (consulta em 1 toque)</summary><div class="list">${V.fontes(o).map((f) => `<a class="item" href="${esc(f.url)}" target="_blank" rel="noopener"><span class="t"><b>${esc(f.nome)}</b><span>${esc(f.obs)}</span></span><span>›</span></a>`).join("")}</div>
  <p class="hint">Automático, sem apertar botão: CEP (Correios via BrasilAPI/ViaCEP), mapa (OpenStreetMap) e CNPJ (Receita via BrasilAPI) rodam ao salvar, ao ler o anúncio pelo link e quando o anunciante informa o CEP. Matrícula e certidões exigem login e emolumentos nos portais oficiais: gere o PDF e envie aqui, ou peça na Sala do Anunciante — a IA identifica se é matrícula, IPTU ou CCIR/CAR, lê e cruza com a oferta.</p></details></div>`;
}
function fillCert(o) { const c = o.certidoes || {}; document.querySelectorAll("[data-cert]").forEach((el) => { el.checked = !!c[el.dataset.cert]; }); document.querySelectorAll("[data-certd]").forEach((el) => { el.value = c[el.dataset.certd] || ""; }); }
function readCert() { const o = {}; document.querySelectorAll("[data-cert]").forEach((el) => { if (el.checked) { const d = document.querySelector(`[data-certd="${el.dataset.cert}"]`); o[el.dataset.cert] = (d && d.value) || new Date().toISOString().slice(0, 10); } }); return o; }
function pintarVerif(cur) {
  if (!$("vsem")) return; const a = V.avaliar(cur); const N = V.NIVEL[a.nivel];
  $("vsem").className = "sem " + (a.nivel === "cinza" ? "" : a.nivel); $("vsemT").textContent = N[0]; $("vsemS").textContent = N[1];
  $("vbar").style.width = a.pct + "%"; $("vbar").className = a.nivel === "verde" ? "ok" : a.nivel === "vermelho" ? "" : a.pct >= 60 ? "mid" : "";
  $("vtxt").textContent = `Índice de verificação ${a.pct}% · certidões ${a.certidoes}/${a.total_certidoes}` + (a.pendentes ? ` · ${a.pendentes} item(ns) aguardando dados` : "");
  $("vit").innerHTML = a.itens.map((x) => `<li class="${ST_V[x.st]}"><span><b>${esc(x.rotulo)}</b> · ${esc(x.msg)}</span></li>`).join("");
  const cn = $("vcn"); if (cn) cn.textContent = `(${a.certidoes}/${a.total_certidoes})`;
  document.querySelectorAll("[data-vg]").forEach((el) => { const g = el.dataset.vg; const r = V.ehRural(cur.tipo); el.hidden = (g === "rural" && !r) || (g === "urbano" && r); });
}
const CHAVES_VARRER = ["cep", "endereco", "numero", "cidade", "proprietario_doc"];
function varrerSeMudou(antes, depois) {
  const mudou = CHAVES_VARRER.some((k) => String(antes[k] || "") !== String(depois[k] || ""));
  if (!mudou || !(depois.cep || depois.endereco || depois.proprietario_doc)) return;
  api(`verificar/${antes.id}`, { method: "POST" }).then((r) => { toast(`Varredura concluída · índice ${r.avaliacao.pct}%`); sincronizar(true); }).catch(() => {});
}
function ligarVerif(o, root, upd) {
  const salvarAtual = async () => { const cur = upd(); editing = false; await store.save("ofertas", { ...cur, atualizado: now() }); editing = true; return cur; };
  $("vvar").onclick = async () => { const b = $("vvar"); b.disabled = true; $("vst").textContent = "Consultando CEP, mapa e Receita…";
    try { await salvarAtual(); const r = await api(`verificar/${o.id}`, { method: "POST" }); editing = false; await store.carregar(); toast(`Varredura concluída · índice ${r.avaliacao.pct}%`); render(); } catch (e) { $("vst").className = "status err"; $("vst").textContent = e.message; b.disabled = false; editing = true; } };
  $("vmat").onchange = async (ev) => {
    const f = ev.target.files[0]; if (!f) return; const st = $("vst");
    try {
      st.className = "status"; st.textContent = "Preparando o arquivo…";
      let blob = f, tipo = f.type || "application/pdf";
      if (/^image\//.test(tipo)) { const t = await tratarFoto(f, { lado: 2400, tratar: false }); blob = t.blob; tipo = "image/jpeg"; }
      if (blob.size > 4_300_000) throw new Error("Arquivo acima de 4 MB. Envie só as páginas da certidão ou fotos de cada página.");
      await salvarAtual();
      st.textContent = "Enviando…"; await api(`documento/${o.id}`, { method: "POST", body: JSON.stringify({ tipo, base64: await blobB64(blob) }) });
      st.textContent = "Lendo o documento com IA… (até 1 minuto)";
      for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 4000)); await store.carregar(); const at = O(o.id); const l = at?.verificacao?.leitura; if (l && l.status !== "lendo") { editing = false; toast(l.status === "ok" ? ({ iptu: "IPTU lido e cruzado com a oferta.", rural: "Cadastro rural lido e cruzado com a oferta.", outro: "Documento lido e guardado." }[l.doc] || "Matrícula lida e cruzada com a oferta.") : "Leitura falhou: " + (l.msg || "")); if (route.v === "oferta" && route.id === o.id) render(); return; } if (route.v !== "oferta") return; }
      st.textContent = "A leitura está demorando. Volte a esta oferta em alguns minutos.";
    } catch (e) { st.className = "status err"; st.textContent = e.message; }
  };
  $("vpdf").onclick = async () => { try { const cur = await salvarAtual(); await pdfVerificacao(O(o.id) || cur); } catch (e) { toast("Falhou: " + e.message); } };
  document.querySelectorAll("[data-cert],[data-certd]").forEach((el) => el.addEventListener("change", () => { if (el.dataset.certd && el.value) { const c = document.querySelector(`[data-cert="${el.dataset.certd}"]`); if (c) c.checked = true; } upd(); }));
}
async function pdfVerificacao(o) {
  const codigo = await garantirCodigo(o); const at = O(o.id) || { ...o, codigo }; const a = V.avaliar(at); const m = at.verificacao?.matricula; const f = at.verificacao?.fontes || {};
  const SIT = { ok: "CONFERIDO", a: "ATENÇÃO", v: "DIVERGÊNCIA", pend: "PENDENTE" };
  const doc = PC.pdfDoc(jsPDF, { kicker: "VERIFICAÇÃO DO IMÓVEL · DOCUMENTO RESERVADO", ref: `${codigo} · emitido em ${fdt(now())}`, titulo: `${tituloO(at)} · ${V.NIVEL[a.nivel][0]} (${a.pct}%)`, codigo, corretor: corretorDaOferta(at), logos: LOGOS.dark ? LOGOS : null,
    tituloDados: "RESULTADO POR ITEM",
    dados: [...a.itens.map((x) => [`${x.rotulo} · ${SIT[x.st]}`, x.msg]),
      ["Certidões do vendedor", V.CERTIDOES.map(([k, l]) => `${(at.certidoes || {})[k] ? "✔ " + at.certidoes[k].split("-").reverse().join("/") : "pendente"} · ${l}`).join("\n")],
      ["Fontes consultadas", [f.cep && `CEP: ${f.cep.fonte || ""} em ${fdt(f.cep.em)}`, f.geo && `Mapa: ${f.geo.fonte || ""} em ${fdt(f.geo.em)}`, f.cnpj && `CNPJ: ${f.cnpj.fonte || ""} em ${fdt(f.cnpj.em)}`, m && `Matrícula: leitura por IA do documento enviado em ${fdt(m.lida_em)}`].filter(Boolean).join("\n") || "—"]],
    tituloTexto: "ALCANCE",
    texto: `Este relatório reúne as consultas automáticas a bases públicas (CEP, mapa e cadastro de CNPJ) e a leitura assistida por inteligência artificial da matrícula fornecida, cruzadas com os dados da oferta, na data de emissão.\n\nNão substitui a certidão de inteiro teor com ônus reais atualizada, as certidões pessoais do vendedor nem a análise jurídica antes de proposta, contrato ou escritura. Ônus ou divergências apontados devem ser resolvidos ou ressalvados por escrito.${m && (m.onus || []).length ? "\n\nÔNUS E OCORRÊNCIAS NA MATRÍCULA\n\n" + m.onus.map((x) => `${x.ato || "—"} · ${x.tipo}: ${x.descricao || ""} (${x.cancelado ? "cancelado" + (x.cancelado_por ? " por " + x.cancelado_por : "") : "ATIVO"})`).join("\n") : ""}` });
  const blob = doc.output("blob"); const nome = `Verificacao_${codigo}.pdf`;
  await emitir({ tipo: "verificacao_pdf", oferta_id: at.id, nome_arquivo: nome, pdf_base64: await blobToBase64(blob), conteudo: `${tituloO(at)} · ${V.NIVEL[a.nivel][0]} ${a.pct}%`, meta: { codigo, pct: a.pct, nivel: a.nivel } });
  await compartilharOuBaixar(blob, nome);
}

/* ================= ZOE · WHATSAPP E AGENDA ================= */
const CFGZ = () => S.config.find((c) => c.id === "zoe") || {};
const quandoAg = (iso) => { try { const d = new Date(iso); return d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }) + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); } catch { return iso; } };
const solPend = () => (S.b2g || []).filter((x) => String(x.id).startsWith("sol_") && x.status === "pendente").sort((a, b) => (b.em || "").localeCompare(a.em || ""));
const sugPend = () => (S.zoe_sugestoes || []).filter((x) => x.status === "pendente").sort((a, b) => (a.id || "").localeCompare(b.id || ""));
const convReais = () => (S.conversas || []).filter((c) => !c.simulacao).sort((a, b) => (b.ultima_em || "").localeCompare(a.ultima_em || ""));
const hojeAg = () => { const h = new Date().toDateString(); return (S.agenda || []).filter((a) => a.status !== "cancelado" && new Date(a.inicio).toDateString() === h).sort((a, b) => a.inicio.localeCompare(b.inicio)); };
function cardZoePainel() {
  const pend = convReais().filter((c) => c.precisa_humano); const hj = hojeAg(); const novas = convReais().filter((c) => c.ultima_de === "cliente" && c.modo === "humano");
  const sg = sugPend().length + solPend().length;
  if (!pend.length && !hj.length && !novas.length && !sg) return "";
  return `<div class="card zoe-p"><div class="row" style="justify-content:space-between"><h3>🤖 Assistente</h3><button class="sm" id="gozoe">Conversas</button></div>
  ${pend.length ? `<div class="list">${pend.slice(0, 5).map((c) => `<button class="item" data-zc="${c.id}"><span class="dot ${c.precisa_humano?.urgente ? "vermelho" : "amarelo"}"></span><span class="t"><b>${esc(c.nome || "+" + c.id)}</b><span>${esc(c.precisa_humano?.motivo || "")}</span></span><span>›</span></button>`).join("")}</div>` : ""}
  ${novas.filter((c) => !c.precisa_humano).length ? `<p class="hint">${novas.filter((c) => !c.precisa_humano).length} conversa(s) com você aguardando resposta.</p>` : ""}
  ${sg ? `<p class="hint">${sg} pendência(s) da assistente: sugestões em Assistente → Revisão e pedidos de parceiros em Assistente → Tributário.</p>` : ""}
  ${hj.length ? `<button class="item" id="goagenda" style="width:100%"><span class="t"><b>Hoje: ${hj.length} compromisso(s)</b><span>${esc(hj.map((a) => quandoAg(a.inicio).split(" ").pop() + " " + a.tipo + " · " + a.nome).join(" | "))}</span></span><span>›</span></button>` : ""}</div>`;
}
VIEWS.zoe = () => {
  header("Assistente · WhatsApp"); const aba = route.aba || "conversas"; const cfg = CFGZ();
  $("main").innerHTML = `<div class="seg">${[["conversas", "Conversas"], ["testar", "Testar a assistente"], ["config", "Conhecimento"], ["trib", "Tributário" + (solPend().length ? " (" + solPend().length + ")" : "")], ["revisao", "Revisão" + (sugPend().length ? " (" + sugPend().length + ")" : "")]].map(([k, l]) => `<button data-aba="${k}" class="${aba === k ? "on" : ""}">${l}</button>`).join("")}</div><div id="zb"></div>`;
  document.querySelectorAll("[data-aba]").forEach((b) => (b.onclick = () => { route = { v: "zoe", aba: b.dataset.aba }; render(); }));
  const zb = $("zb");
  if (aba === "conversas") {
    const cs = convReais();
    zb.innerHTML = `<div class="card"><div class="row" style="justify-content:space-between"><h2>Atendimento</h2><span class="tag ${EU.whatsapp_configurado ? "ok" : "r"}">${EU.whatsapp_configurado ? "WhatsApp conectado" + (EU.whatsapp_numero ? " · " + esc(EU.whatsapp_numero) : "") : "WhatsApp não conectado"}</span></div>
    ${cfg.ativa === false ? '<p class="note">A assistente está desligada: as mensagens chegam aqui e esperam resposta humana.</p>' : ""}
    ${EU.whatsapp_provedor === "360dialog" && ehAdmin() ? `<div class="row"><button class="${EU.whatsapp_configurado ? "" : "p"}" id="zcon">Conectar WhatsApp ao sistema</button><span class="hint">Aponta o número da 360dialog para a assistente. Depois mande "oi" do seu celular para ${esc(EU.whatsapp_numero || "o número da assistente")}.</span></div><div class="row"><button class="sm" id="zmod">Ativar modelos do WhatsApp</button><span class="hint">Cria na Meta os modelos "primecorp_aviso" (avisos à equipe fora das 24 h) e "primecorp_site" (primeiro contato com quem se cadastrou no site). Aprovação em minutos a horas.</span></div><div class="status" id="zcs"></div>` : ""}
    ${!EU.whatsapp_configurado ? `<p class="hint">Para ligar: cadastre o número na Meta (WhatsApp Business Platform) e as variáveis WHATSAPP_* no Netlify (veja o LEIAME). Endereço do webhook: <b>${esc(EU.webhook || location.origin + "/whatsapp/webhook")}</b></p>` : ""}
    ${(() => { const ls = (S.site_leads || []).slice().sort((a, b) => (b.criado || "").localeCompare(a.criado || "")).slice(0, 8); return ls.length ? `<h3>Cadastros do site</h3><div class="list">${ls.map((l) => `<button class="item" ${l.conversa || l.wa ? `data-zc="${esc(l.conversa || l.wa)}"` : ""}><span class="dot ${l.status === "conversando" || l.status === "atendido" ? "verde" : l.status === "novo" ? "amarelo" : ""}"></span><span class="t"><b>${esc(l.nome)} · ${esc(l.linha || "")}</b><span>${esc([l.municipio, l.perfil, fdt(l.criado), { novo: "aguardando contato", convidado: "assistente chamou", conversando: "em conversa", falha_convite: "convite não enviado" }[l.status] || l.status].filter(Boolean).join(" · "))}</span></span><span>›</span></button>`).join("")}</div>` : ""; })()}
    <div class="list">${cs.map((c) => { const u = (c.msgs || []).slice(-1)[0]; return `<button class="item" data-zc="${c.id}"><span class="dot ${c.precisa_humano ? (c.precisa_humano.urgente ? "vermelho" : "amarelo") : c.modo === "humano" ? "" : "verde"}"></span><span class="t"><b>${esc(c.nome || "+" + c.id)}${c.equipe ? " · equipe" : ""}</b><span>${esc((u ? (u.de === "cliente" ? "" : u.de === "zoe" ? "Assistente: " : "Você: ") + u.texto : "").slice(0, 90))}</span></span><span class="chip">${esc(c.modo === "humano" ? "humano" : "Assistente")}</span></button>`; }).join("") || '<p class="empty">Nenhuma conversa ainda.</p>'}</div></div>`;
    zb.querySelectorAll("[data-zc]").forEach((b) => (b.onclick = () => go({ v: "conversa", id: b.dataset.zc })));
    const zm = $("zmod"); if (zm) zm.onclick = async () => { zm.disabled = true; const st = $("zcs"); st.className = "status"; st.textContent = "Criando modelo…"; try { const r = await api("zoe/modelo-aviso", { method: "POST" }); st.className = "status ok"; st.textContent = `Modelo ${r.nome}: ${r.status}. A Meta aprova em minutos a horas.`; } catch (e) { st.className = "status err"; st.textContent = e.message; zm.disabled = false; } };
    const zc = $("zcon"); if (zc) zc.onclick = async () => { zc.disabled = true; const st = $("zcs"); st.className = "status"; st.textContent = "Conectando…"; try { const r = await api("zoe/conectar", { method: "POST" }); st.className = "status ok"; st.textContent = "Conectado: " + r.webhook + ". Agora mande uma mensagem de teste pelo seu celular."; } catch (e) { st.className = "status err"; st.textContent = e.message; zc.disabled = false; } };
  } else if (aba === "testar") {
    const eq = !!route.eq; const sid = "sim_" + String(EU.usuario || "").toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 60) + (eq ? "_eq" : ""); const conv = (S.conversas || []).find((c) => c.id === sid);
    zb.innerHTML = `<div class="card"><div class="row" style="justify-content:space-between"><h2>Testar a assistente</h2><div class="seg sm">${[[0, "Como cliente"], [1, "Como equipe"]].map(([k, l]) => `<button data-eq="${k}" class="${+eq === k ? "on" : ""}">${l}</button>`).join("")}</div></div>
    <p class="hint">Converse como ${eq ? "Rodrigo/Joselia (resumo, agenda, pendências)" : "um cliente, proprietário ou corretor"}. Nada é gravado de verdade: o que a assistente faria aparece em cinza.</p>
    <div class="chat" id="chat">${(conv?.msgs || []).map(bolha).join("") || '<p class="empty">Escreva como se fosse pelo WhatsApp. Ex.: "Boa tarde, procuro um galpão de 5 mil m² para alugar em Sumaré".</p>'}</div>
    <div class="row"><input id="ztx" class="grow" placeholder="Mensagem" autocomplete="off"><button class="p" id="zgo">Enviar</button></div><button class="g sm" id="zre">Recomeçar conversa</button><div class="status" id="zst"></div></div>`;
    zb.querySelectorAll("[data-eq]").forEach((b) => (b.onclick = () => { route = { v: "zoe", aba: "testar", eq: b.dataset.eq === "1" }; render(); }));
    const ch = $("chat"); ch.scrollTop = ch.scrollHeight;
    const env = async (reiniciar) => { const tx = $("ztx").value.trim(); if (!tx && !reiniciar) return; $("zgo").disabled = true; $("zst").textContent = reiniciar ? "" : "Assistente digitando…";
      if (tx) ch.insertAdjacentHTML("beforeend", bolha({ de: "cliente", texto: tx, t: now() })); $("ztx").value = ""; ch.scrollTop = ch.scrollHeight;
      try { const r = await api("zoe/simular", { method: "POST", body: JSON.stringify({ texto: tx, equipe: eq, reiniciar }) }); await store.carregar();
        if (reiniciar) { render(); return; }
        ch.insertAdjacentHTML("beforeend", bolha({ de: "zoe", texto: r.resposta + (r.botoes?.length ? "\n[" + r.botoes.join(" | ") + "]" : ""), t: now(), acoes: r.acoes }) + ((r.simulado || []).length || (r.avisos || []).length ? `<p class="sim">Simulação: ${esc([...(r.simulado || []).map((x) => "gravaria " + x.split("/")[0]), ...(r.avisos || []).map((x) => "avisaria a equipe: " + x)].join(" · "))}</p>` : "")); ch.scrollTop = ch.scrollHeight; $("zst").textContent = "";
      } catch (e) { $("zst").className = "status err"; $("zst").textContent = e.message; } $("zgo").disabled = false; $("ztx").focus(); };
    $("zgo").onclick = () => env(false); $("ztx").onkeydown = (e) => { if (e.key === "Enter") env(false); }; $("zre").onclick = () => env(true);
  } else if (aba === "trib") {
    const ps = (S.b2g || []).filter((x) => String(x.id).startsWith("bp_")).sort((a, b) => a.nome.localeCompare(b.nome)); const pn = painelB2G(S.b2g || [], new Date()); const sols = solPend(); const adm = ehAdmin();
    zb.innerHTML = `<div class="card"><h2>Frente tributária · parceiros e reservas</h2>
    <p class="hint">A assistente reconhece o parceiro pelo WhatsApp cadastrado, informa as reservas dele, consulta se um ente está livre (sem revelar outros parceiros), registra pedidos de reserva e andamentos. A carteira vem do backup do PrimeGov.</p>
    ${adm ? '<label class="btn sm">Importar backup do PrimeGov (.json)<input type="file" id="b2gf" accept=".json,application/json" hidden></label><div class="status" id="b2gs"></div>' : ""}
    <div class="kpis"><div class="kpi"><b>${pn.parceiros}</b><span>parceiros</span></div><div class="kpi"><b>${pn.reservas_ativas}</b><span>reservas ativas</span></div>${Object.entries(pn.por_status).map(([k, v]) => `<div class="kpi"><b>${v}</b><span>${esc(k)}</span></div>`).join("")}</div>
    ${pn.vencendo.length ? `<p class="note">Vencendo em 15 dias: ${esc(pn.vencendo.join(" | "))}</p>` : ""}</div>
    <div class="card"><h3>Pedidos dos parceiros pela assistente</h3>${sols.map((x) => `<div class="item"><span class="dot amarelo"></span><span class="t"><b>${esc((x.tipo === "reserva" ? "Reserva · " : "Andamento · ") + x.ente)}</b><span>${esc((x.nome || "+" + x.wa) + (x.cadastrado ? "" : " (não cadastrado)") + " · " + fdt(x.em) + (x.texto ? " · " + x.texto : "") + (x.contato_no_ente ? " · contato: " + x.contato_no_ente : ""))}</span></span><button class="sm" data-sol="${x.id}">Tratado</button></div>`).join("") || '<p class="empty">Nenhum pedido pendente.</p>'}
    <p class="hint">Pedido de reserva = consultar a central antes de liberar. Libere ou atualize no PrimeGov e importe o backup de novo para a assistente ver a carteira atualizada.</p></div>
    <div class="card"><h3>WhatsApp de quem atende cada carteira</h3><p class="hint">Uma pessoa por linha: <b>Nome; telefone; apelidos</b>. A assistente reconhece a pessoa pelo WhatsApp e mostra todas as carteiras cujo nome no PrimeGov contém o nome ou um apelido (ex.: "kronenberg" pega "ULISSES | RODRIGO KRONEMBERG").</p>
    <textarea id="b2gp" rows="6" ${adm ? "" : "disabled"}>${esc(CFGZ().b2g_pessoas ?? PESSOAS_PADRAO)}</textarea>${adm ? '<button class="sm" id="b2gps">Salvar</button>' : ""}</div>
    <div class="card"><h3>Parceiros (${ps.length})</h3><div class="list">${ps.map((p) => `<details><summary><b>${esc(p.nome)}</b> · ${(p.reservas || []).length} ente(s)${(p.telefones || []).length ? " · +" + esc(p.telefones[0]) : " · <span class='tag r'>sem WhatsApp</span>"}</summary>${resumoReservas(p, new Date()).map((r) => `<p class="hint"><b>${esc(r.ente)}</b> · ${esc(r.status)} · ${esc(r.reserva)}${r.ultimo_andamento ? "<br>" + esc(r.ultimo_andamento) : ""}</p>`).join("")}</details>`).join("") || '<p class="empty">Importe o backup do PrimeGov.</p>'}</div></div>`;
    const f = $("b2gf"); if (f) f.onchange = async () => { const st = $("b2gs"); st.className = "status"; st.textContent = "Lendo…"; try { const j = JSON.parse(await f.files[0].text()); const parceiros = importarPrimeGov(j); const r = await api("b2g/importar", { method: "POST", body: JSON.stringify({ parceiros }) }); st.className = "status ok"; st.textContent = `Importado: ${r.parceiros} parceiros, ${r.reservas} entes.`; await store.carregar(); render(); } catch (e) { st.className = "status err"; st.textContent = e.message; } };
    const bps = $("b2gps"); if (bps) bps.onclick = async () => { try { await store.save("config", { ...CFGZ(), id: "zoe", b2g_pessoas: $("b2gp").value.trim() }); toast("Salvo."); } catch (e) { toast(e.message); } };
    zb.querySelectorAll("[data-sol]").forEach((b) => (b.onclick = async () => { b.disabled = true; try { await api("b2g/solicitacao", { method: "POST", body: JSON.stringify({ id: b.dataset.sol }) }); await store.carregar(); render(); } catch (e) { toast(e.message); b.disabled = false; } }));
  } else if (aba === "revisao") {
    const pend = sugPend(); const feitas = (S.zoe_sugestoes || []).filter((x) => x.status !== "pendente").sort((a, b) => (b.decidido_em || "").localeCompare(a.decidido_em || "")).slice(0, 10); const adm = ehAdmin();
    zb.innerHTML = `<div class="card"><div class="row" style="justify-content:space-between"><h2>Revisão semanal</h2>${adm ? '<button class="sm" id="zrv">Revisar agora</button>' : ""}</div>
    <p class="hint">Toda segunda às 8h a assistente relê as conversas da semana e sugere o que aprender. Nada entra no conhecimento sem a sua aprovação. Você pode ajustar o texto antes de aprovar.</p><div class="status" id="zrs"></div>
    ${pend.map((g) => `<div class="card sug" data-sg="${g.id}"><div class="row" style="justify-content:space-between"><b>${esc(g.titulo || "Sugestão")}</b><span class="chip">${g.tipo === "faq" ? "Pergunta frequente" : "Orientação"}</span></div>
      <p class="hint">${esc(g.motivo || "")}${g.exemplo ? `<br><i>“${esc(g.exemplo)}”</i>` : ""}</p>
      <textarea rows="3" data-sgt ${adm ? "" : "disabled"}>${esc(g.texto)}</textarea>
      ${adm ? '<div class="row"><button class="p grow" data-ap>Aprovar</button><button class="grow" data-rc>Recusar</button></div>' : '<p class="note">Somente o administrador aprova.</p>'}</div>`).join("") || '<p class="empty">Nenhuma sugestão pendente.</p>'}
    ${feitas.length ? `<h3>Decididas</h3><div class="list">${feitas.map((g) => `<div class="item"><span class="dot ${g.status === "aprovada" ? "verde" : ""}"></span><span class="t"><b>${esc(g.titulo || g.texto.slice(0, 60))}</b><span>${esc((g.status === "aprovada" ? "Aprovada" : "Recusada") + " · " + fdt(g.decidido_em))}</span></span></div>`).join("")}</div>` : ""}</div>`;
    zb.querySelectorAll("[data-sg]").forEach((el) => {
      const dec = async (acao) => { el.querySelectorAll("button").forEach((b) => (b.disabled = true)); try { await api("zoe/sugestao", { method: "POST", body: JSON.stringify({ id: el.dataset.sg, acao, texto: el.querySelector("[data-sgt]").value }) }); toast(acao === "aprovar" ? "Aprendido. A assistente já usa a partir da próxima mensagem." : "Recusada."); await store.carregar(); render(); } catch (e) { toast(e.message); el.querySelectorAll("button").forEach((b) => (b.disabled = false)); } };
      const ap = el.querySelector("[data-ap]"); if (ap) ap.onclick = () => dec("aprovar"); const rc = el.querySelector("[data-rc]"); if (rc) rc.onclick = () => dec("recusar");
    });
    const rv = $("zrv"); if (rv) rv.onclick = async () => { rv.disabled = true; const st = $("zrs"); st.className = "status"; st.textContent = "Revisando as conversas da semana… (1 a 2 min)"; try { await api("zoe/revisar", { method: "POST" }); setTimeout(async () => { await store.carregar(); render(); }, 90000); } catch (e) { st.className = "status err"; st.textContent = e.message; rv.disabled = false; } };
  } else {
    const z = { ...ZOE_BASE, ...cfg }; const H = { ...ZOE_BASE.horario, ...(cfg.horario || {}), fim_dia: { ...ZOE_BASE.horario.fim_dia, ...((cfg.horario || {}).fim_dia || {}) } }; const so = !ehAdmin();
    zb.innerHTML = `<div class="card" id="zc"><h2>Conhecimento e regras da assistente</h2><p class="hint">Tudo o que a assistente sabe sobre a PrimeCorp vem daqui. Escreva fatos objetivos; ela não inventa o que não estiver aqui ou no sistema. As regras de segurança (sem endereço, sem negociar, LGPD, transbordo) são fixas.</p>
    <label class="cert"><input type="checkbox" data-z="ativa" ${z.ativa !== false ? "checked" : ""}><span>Assistente responde automaticamente no WhatsApp</span></label>
    <label class="cert"><input type="checkbox" data-z="boas_vindas_imagem" ${cfg.boas_vindas_imagem !== false ? "checked" : ""}><span>No primeiro contato, enviar o cartão de boas-vindas com a atendente virtual</span></label>
    <div class="row"><img src="/marca/primecorp-atendente-perfil.png" alt="" style="width:72px;height:72px;border-radius:50%"><span class="hint">Foto do WhatsApp: <a href="/marca/primecorp-atendente-perfil.png" download>baixar perfil</a> · <a href="/marca/primecorp-atendente-selo.png" download>selo</a> · <a href="/marca/primecorp-boas-vindas.jpg" download>cartão de boas-vindas</a></span></div>
    <label class="cert"><input type="checkbox" data-z="anuncios_pela_zoe" ${cfg.anuncios_pela_zoe !== false ? "checked" : ""}><span>Botão "Tenho interesse" das páginas de anúncio abre o WhatsApp da assistente${EU.whatsapp_numero ? " (" + esc(EU.whatsapp_numero) + ")" : ""}</span></label>
    <label>Nome da assistente (como ela se apresenta)<input data-z="nome" value="${esc(z.nome || "PrimeCorp")}"></label>
    <label>Quem somos<textarea data-z="quem_somos" rows="5">${esc(z.quem_somos)}</textarea></label>
    <label>O que oferecemos (use {{COMISSAO_VENDA}} e {{COMISSAO_LOCACAO}} para puxar a comissão padrão)<textarea data-z="servicos" rows="9">${esc(z.servicos)}</textarea></label>
    <label>Perguntas frequentes<textarea data-z="faq" rows="7">${esc(z.faq)}</textarea></label>
    <label>Frente tributária (prefeituras, estados e parceiros tributários)<textarea data-z="tributario" rows="10">${esc(z.tributario || "")}</textarea></label>
    <label>Institucional, grupo e credenciais<textarea data-z="institucional" rows="8">${esc(z.institucional || "")}</textarea></label>
    <label>Empresas (créditos, teses e CNPJ inapto)<textarea data-z="empresas" rows="8">${esc(z.empresas || "")}</textarea></label>
    <label>Ensino e filantropia<textarea data-z="filantropia" rows="8">${esc(z.filantropia || "")}</textarea></label>
    <label>Programa de indicação de municípios<textarea data-z="indicacao" rows="6">${esc(z.indicacao || "")}</textarea></label>
    <label>Orientações extras da equipe (ex.: campanha do mês, imóvel em destaque, regiões que não atendemos)<textarea data-z="regras_extra" rows="3">${esc(z.regras_extra || "")}</textarea></label>
    <label>Local das reuniões<input data-z="local_reuniao" value="${esc(z.local_reuniao)}"></label>
    <label>Assistente retoma a conversa após (horas) sem nova resposta sua pelo celular · 0 = só quando você devolver<input data-z="retomar_h" inputmode="numeric" value="${esc(cfg.retomar_h ?? 12)}"></label>
    <h3>Agenda</h3><div class="grid"><label>Início<input data-h="inicio" type="time" value="${esc(H.inicio)}"></label><label>Fim<input data-h="fim" type="time" value="${esc(H.fim)}"></label>
    <label>Duração (min)<input data-h="duracao" inputmode="numeric" value="${esc(H.duracao)}"></label><label>Antecedência mínima (h)<input data-h="antecedencia_h" inputmode="numeric" value="${esc(H.antecedencia_h)}"></label>
    <label>Sábado até (vazio = não atende)<input data-h="sabado_ate" type="time" value="${esc(H.sabado_ate || "")}"></label>
    <label>Término diferente por dia (ex.: sex=16:00)<input id="zfd" value="${esc(Object.entries(H.fim_dia || {}).map(([d, h]) => ["dom", "seg", "ter", "qua", "qui", "sex", "sab"][d] + "=" + h).join(", "))}"></label>
    <label class="full">Dias sem agenda (AAAA-MM-DD, separados por vírgula)<input data-z="bloqueios" value="${esc((cfg.bloqueios || []).join(", "))}"></label></div>
    <p class="hint">Dias de atendimento: ${esc((H.dias || []).map((d) => ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][d]).join(", "))}${H.sabado_ate ? " e sábado até " + esc(H.sabado_ate) : ""}. Compromissos marcados na Agenda bloqueiam o horário.</p>
    ${so ? '<p class="note">Somente o administrador altera o conhecimento da assistente.</p>' : '<button class="p" id="zsv">Salvar</button>'}<div class="status" id="zst"></div></div>`;
    editing = !so;
    const sv = $("zsv"); if (sv) sv.onclick = async () => { const o = { ...cfg, id: "zoe" }; document.querySelectorAll("[data-z]").forEach((el) => { o[el.dataset.z] = el.type === "checkbox" ? el.checked : el.value.trim(); });
      o.retomar_h = Math.max(0, Number(o.retomar_h) || 0); o.bloqueios = String(o.bloqueios || "").split(/[,;\s]+/).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)); o.horario = { ...H, dias: H.dias?.length ? H.dias : [1, 2, 3, 4, 5] }; document.querySelectorAll("[data-h]").forEach((el) => { o.horario[el.dataset.h] = ["duracao", "antecedencia_h"].includes(el.dataset.h) ? Number(el.value) || 0 : el.value; }); o.horario.fim_dia = {}; String($("zfd").value || "").split(/[,;]/).forEach((p) => { const [k, v] = p.split("=").map((x) => x.trim().toLowerCase()); const d = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"].indexOf((k || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").slice(0, 3)); if (d >= 0 && /^\d{2}:\d{2}$/.test(v || "")) o.horario.fim_dia[d] = v; });
      editing = false; try { await store.save("config", o); toast("Assistente atualizada."); } catch { editing = true; } };
  }
};
function bolha(m) { return `<div class="msg ${m.de}"><div>${esc(m.texto || (m.midia ? "[" + m.midia + "]" : "")).replace(/\n/g, "<br>")}</div><small>${esc((m.de === "humano" ? (m.por || "Equipe") + " · " : m.de === "zoe" ? "Assistente · " : "") + fdt(m.t))}${(m.acoes || []).length ? " · " + esc(m.acoes.join(", ")) : ""}${m.falha ? " · ⚠ " + esc(m.falha) : ""}</small></div>`; }
VIEWS.conversa = () => {
  const c = (S.conversas || []).find((x) => x.id === route.id); if (!c) return back(); header(c.nome || "+" + c.id);
  const ct = c.contato ? C(c.contato) : null; const bs = (c.briefings || []).map(B).filter(Boolean); const ags = (S.agenda || []).filter((a) => a.wa === c.id && a.status !== "cancelado");
  const janela = (() => { const u = [...(c.msgs || [])].reverse().find((m) => m.de === "cliente"); return u && Date.now() - Date.parse(u.t) < 24 * 3600e3; })();
  $("main").innerHTML = `<div class="card"><div class="row" style="justify-content:space-between"><span class="k">+${esc(c.id)}${c.equipe ? " · equipe" : ""}${c.optout ? " · pediu para não receber" : ""}</span><span class="tag ${c.modo === "humano" ? "r" : "ok"}">${c.modo === "humano" ? "Você está atendendo" : "Assistente atendendo"}</span></div>
  ${c.precisa_humano ? `<p class="note">Assistente pediu você${c.precisa_humano.urgente ? " (urgente)" : ""}: ${esc(c.precisa_humano.motivo || "")}</p>` : ""}
  <div class="row wrap">${ct ? `<button class="sm" data-c="${ct.id}">Contato: ${esc(nomeC(ct))}</button>` : ""}${bs.map((b) => `<button class="sm" data-b="${b.id}">Briefing: ${esc(nomeB(b))}</button>`).join("")}<a class="btn sm" href="https://wa.me/${esc(c.id)}" target="_blank" rel="noopener">Abrir no WhatsApp</a></div>
  ${ags.length ? `<p class="hint">Agenda: ${esc(ags.map((a) => quandoAg(a.inicio) + " · " + a.tipo).join(" | "))}</p>` : ""}</div>
  <div class="card"><div class="chat" id="chat">${(c.msgs || []).map(bolha).join("")}</div>
  ${janela ? `<div class="row"><input id="htx" class="grow" placeholder="Responder como ${esc(eu().nome.split(" ")[0] || "equipe")}" autocomplete="off"><button class="p" id="hgo">Enviar</button></div><p class="hint">Ao responder, a assistente pausa nesta conversa até você devolver.</p>` : '<p class="note">Mais de 24 h desde a última mensagem do cliente: o WhatsApp só aceita modelo aprovado. Use "Abrir no WhatsApp" ou ligue.</p>'}
  <div class="row">${c.modo === "humano" ? '<button class="grow" id="dev">Devolver para a assistente</button>' : '<button class="grow" id="ass">Assumir conversa</button>'}${c.precisa_humano ? '<button class="grow" id="res">Marcar resolvido</button>' : ""}</div><div class="status" id="hst"></div></div>`;
  const ch = $("chat"); ch.scrollTop = ch.scrollHeight;
  document.querySelectorAll("[data-c]").forEach((b) => (b.onclick = () => go({ v: "contato", id: b.dataset.c })));
  document.querySelectorAll("[data-b]").forEach((b) => (b.onclick = () => go({ v: "briefing", id: b.dataset.b })));
  const modo = async (m, extra = {}) => { try { await api("zoe/modo", { method: "POST", body: JSON.stringify({ conversa: c.id, modo: m, ...extra }) }); await store.carregar(); render(); } catch (e) { toast(e.message); } };
  const dv = $("dev"); if (dv) dv.onclick = () => modo("zoe"); const as = $("ass"); if (as) as.onclick = () => modo("humano"); const rs = $("res"); if (rs) rs.onclick = () => modo(c.modo, { resolvido: true });
  const hg = $("hgo"); if (hg) { const enviar = async () => { const tx = $("htx").value.trim(); if (!tx) return; hg.disabled = true; try { await api("zoe/enviar", { method: "POST", body: JSON.stringify({ conversa: c.id, texto: tx }) }); await store.carregar(); render(); } catch (e) { $("hst").className = "status err"; $("hst").textContent = e.message; hg.disabled = false; } }; hg.onclick = enviar; $("htx").onkeydown = (e) => { if (e.key === "Enter") enviar(); }; }
};
VIEWS.agenda = () => {
  header("Agenda"); const futuros = (S.agenda || []).filter((a) => a.status !== "cancelado" && Date.parse(a.inicio) >= Date.now() - 3 * 3600e3).sort((a, b) => a.inicio.localeCompare(b.inicio));
  const passados = (S.agenda || []).filter((a) => !futuros.includes(a)).sort((a, b) => b.inicio.localeCompare(a.inicio)).slice(0, 20);
  const linha = (a) => `<div class="item" style="cursor:default"><span class="dot ${a.status === "cancelado" ? "vermelho" : a.status === "realizado" ? "" : "verde"}"></span><span class="t"><b>${esc(quandoAg(a.inicio))} · ${esc(a.tipo || "")}</b><span>${esc([a.nome, a.assunto, a.codigo, a.criado_por === "Assistente" ? "marcado pela assistente" : ""].filter(Boolean).join(" · "))}</span></span>${a.wa ? `<button class="sm" data-zc="${esc(a.wa)}">Conversa</button>` : ""}${a.status === "marcado" ? `<button class="sm g" data-ok="${a.id}">Realizado</button><button class="sm g" data-cx="${a.id}">Cancelar</button>` : ""}</div>`;
  $("main").innerHTML = `<div class="card"><div class="row" style="justify-content:space-between"><h2>Próximos</h2><button class="sm p" id="nag">+ Compromisso</button></div><div class="list">${futuros.map(linha).join("") || '<p class="empty">Nada marcado.</p>'}</div></div>
  <div class="card" id="fag" hidden><h3>Novo compromisso</h3><div class="grid"><label>Data e hora<input type="datetime-local" id="aini"></label><label>Tipo<select id="atip">${["Reunião (vídeo)", "Reunião presencial", "Visita ao imóvel", "Ligação", "Captação no local", "Bloqueio (indisponível)"].map((x) => `<option>${x}</option>`).join("")}</select></label><label class="full">Com quem<input id="anom"></label><label class="full">Assunto<input id="aass"></label></div><button class="p" id="asv">Salvar</button></div>
  ${passados.length ? `<div class="card"><h3>Anteriores e cancelados</h3><div class="list">${passados.map(linha).join("")}</div></div>` : ""}
  <p class="hint">A assistente só oferece horários livres. Compromissos daqui (inclusive "Bloqueio") ocupam a agenda dela.</p>`;
  document.querySelectorAll("[data-zc]").forEach((b) => (b.onclick = () => go({ v: "conversa", id: b.dataset.zc })));
  const muda = async (id, status) => { const a = S.agenda.find((x) => x.id === id); await store.save("agenda", { ...a, status, [status + "_em"]: now() }); };
  document.querySelectorAll("[data-ok]").forEach((b) => (b.onclick = () => muda(b.dataset.ok, "realizado")));
  document.querySelectorAll("[data-cx]").forEach((b) => confirmar2(b, "Confirmar", () => muda(b.dataset.cx, "cancelado")));
  $("nag").onclick = () => { $("fag").hidden = false; $("aini").focus(); };
  $("asv").onclick = async () => { const v = $("aini").value; if (!v) return toast("Informe data e hora."); const ini = new Date(v); const dur = Number(CFGZ().horario?.duracao) || 60;
    const iso = (d) => { const x = new Date(d.getTime() - 3 * 3600e3); return x.toISOString().slice(0, 19) + "-03:00"; };
    await store.save("agenda", { id: uid("ag"), criado: now(), inicio: iso(ini), fim: iso(new Date(ini.getTime() + dur * 60e3)), tipo: $("atip").value, nome: $("anom").value.trim(), assunto: $("aass").value.trim(), status: "marcado", criado_por: EU.usuario || "" }); toast("Compromisso salvo."); };
};

/* ================= CONTA PROPTO (clientes: corretores e imobiliárias) ================= */
const CLIENTE = () => !!EU.conta;
const CT = () => EU.conta || {};
const SO_PC_VIEWS = ["briefings", "briefing", "editb", "teaser", "novasala", "salas", "sala", "negocio", "comissao", "pedidos", "pedido", "novopedido", "zoe", "conversa", "agenda", "backup", "config", "contasPropto"];
const OCULTAR_CLIENTE = ["verde", "solic", "paut", "qbrief", "csv"];
const brlC = (v) => "R$ " + Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: Number.isInteger(Number(v)) ? 0 : 2, maximumFractionDigits: 2 });
const dataBR = (iso) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "");
const waSuporte = (txt) => waLink(EU.suporte || "(19) 99805-1985", txt || `Olá! Preciso de ajuda com a Propto. Conta: ${CT().nome || ""}.`);
async function recarregarConta() { try { EU = await api("status"); } catch {} }
function usoLinha(rot, usado, lim) { const p = lim ? Math.min(100, Math.round((usado / lim) * 100)) : 0; return `<div class="uso"><div class="row" style="justify-content:space-between"><span>${esc(rot)}</span><b>${usado} de ${lim}</b></div><div class="meter"><i class="${p >= 100 ? "" : p >= 80 ? "mid" : "ok"}" style="width:${p}%"></i></div></div>`; }
function faixaConta() {
  if (!CLIENTE()) return "";
  const c = CT(); const s = c.situacao || {};
  if (s.codigo === "ativa" && !(c.uso && c.limites && c.uso.imoveis >= c.limites.imoveis)) return "";
  const cheio = c.uso && c.limites && c.uso.imoveis >= c.limites.imoveis;
  const cls = s.codigo === "teste" ? (s.dias <= 5 || cheio ? "alerta" : "") : s.escrita ? "alerta" : "erro";
  const txt = s.codigo === "teste" ? `<b>Teste grátis · ${s.dias} dia(s) restante(s)</b><span>${c.uso?.imoveis || 0} de ${c.limites?.imoveis || 0} imóveis usados${cheio ? " · limite do teste atingido" : ""}${c.assinatura ? " · plano escolhido" : " · assine no teste e ganhe 40% por 12 meses"}</span>`
    : s.codigo === "ativa" ? `<b>Limite do mês atingido</b><span>${c.uso.imoveis} de ${c.limites.imoveis} imóveis captados neste mês.</span>`
    : `<b>${esc(s.rotulo || "Conta")}</b><span>${esc(s.msg || "")}</span>`;
  return `<button class="faixa-conta ${cls}" id="fxc">${txt}<em>${c.assinatura && s.codigo !== "teste" ? "Pagar" : "Ver planos"} ›</em></button>`;
}
function aplicarModoCliente() {
  document.documentElement.classList.toggle("cliente", CLIENTE());
  if (!CLIENTE()) return;
  if (route.v !== "plano") { const fx = faixaConta(); if (fx) { $("main").insertAdjacentHTML("afterbegin", fx); $("fxc").onclick = () => go({ v: "plano" }); } }
  OCULTAR_CLIENTE.forEach((id) => { const el = $(id); if (!el) return; el.hidden = true; el.style.display = "none"; const nx = el.nextElementSibling; if (nx && nx.classList.contains("hint") && id === "verde") nx.style.display = "none"; });
}
async function logosCliente() {
  const toData = async (u) => { const b = await (await fetch(u)).blob(); return await new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); }); };
  try { LOGOS.dark = await toData("/marca/propto-horizontal-600.png"); LOGOS.white = await toData("/marca/propto-horizontal-negative-600.png"); LOGOS.ratio = 600 / 176; } catch {}
}

function painelCliente() {
  const me = eu(); const c = CT(); const s = c.situacao || {};
  const caps = S.ofertas.filter((o) => o.status !== "descartada").sort((a, b) => (b.atualizado || "").localeCompare(a.atualizado || ""));
  const anAtivos = S.anuncios.filter((a) => a.status === "ativo"); const visitas = S.anuncios.reduce((n, a) => n + (a.visitas || 0), 0);
  const verificados = S.ofertas.filter((o) => { try { return V.avaliar(o).pct >= 70; } catch { return false; } }).length;
  const chaveBV = "pt_boasvindas_" + (EU.usuario || ""); let bv = false; try { bv = !localStorage.getItem(chaveBV); } catch {}
  header(c.nome || me.nome);
  $("main").innerHTML = `
  ${bv ? `<div class="card boasvindas"><span class="k">Bem-vindo(a) à Propto</span><h2>${esc((me.nome || "").split(" ")[0])}, vamos captar o primeiro imóvel?</h2>
  <p class="hint">No imóvel, toque em Captar: o app guia as fotos ambiente por ambiente, você fala o que vê e a inteligência artificial monta o anúncio. Depois, confira a documentação e publique o link.</p>
  <div class="bv-passos"><button data-bv="captar"><b>1</b><span>Captar um imóvel</span></button><button data-bv="nova"><b>2</b><span>Ler um anúncio por link</span></button><button data-bv="plano"><b>3</b><span>Ver o seu plano</span></button></div>
  <button class="g sm" id="bvx">Entendi, não mostrar de novo</button></div>` : ""}
  <button class="captar-cta" id="qcap"><img class="pt-sym" src="/marca/propto-symbol-negative.svg" alt="Propto"><span><b>Captar imóvel</b><small>Fotos, voz e anúncio no local da visita</small><em>O corretor fala, o app faz o resto</em></span><span>›</span></button>
  <div class="kpis"><div class="kpi"><b>${caps.length}</b><span>Imóveis</span></div><div class="kpi"><b>${anAtivos.length}</b><span>Anúncios no ar</span></div><div class="kpi"><b>${visitas}</b><span>Visitas nos anúncios</span></div></div>
  <div class="card"><div class="row" style="justify-content:space-between"><h2>${esc(c.plano_nome && c.situacao?.codigo === "ativa" ? "Plano " + c.plano_nome : s.rotulo || "Sua conta")}</h2><button class="sm" id="gplano">Plano e assinatura</button></div>
  ${usoLinha("Imóveis captados" + (c.limites?.fonte === "teste" ? " no teste" : " neste mês"), c.uso?.imoveis || 0, c.limites?.imoveis || 0)}
  ${usoLinha("Leituras de documento pela IA", c.uso?.docs || 0, c.limites?.docs || 0)}
  ${usoLinha("Usuários", c.uso?.usuarios || 1, c.limites?.usuarios || 1)}
  <p class="hint">${verificados} imóvel(is) com documentação conferida (índice ≥ 70%).</p></div>
  <div class="card"><div class="row" style="justify-content:space-between"><h2>Últimos imóveis</h2><button class="sm" id="gofs">Ver todos</button></div>
  <div class="list">${caps.slice(0, 6).map((o) => { const an = anuncioDe(o); return `<button class="item" data-cap="${o.id}"><span class="dot ${an && an.status === "ativo" ? "verde" : o.descricao ? "amarelo" : ""}"></span><span class="t"><b>${esc((o.codigo ? o.codigo + " · " : "") + (o.titulo || [o.tipo, o.regiao || o.cidade].filter(Boolean).join(" · ") || "Imóvel sem título"))}</b><span>${esc([an && an.status === "ativo" ? "Anúncio no ar" : o.descricao ? "Anúncio gerado" : "Em captação", an ? (an.visitas || 0) + " visita(s)" : ""].filter(Boolean).join(" · "))}</span></span><span>›</span></button>`; }).join("") || '<p class="empty">Nenhum imóvel ainda. Toque em Captar imóvel.</p>'}</div></div>
  <a class="btn" href="${esc(waSuporte())}" target="_blank" rel="noopener">Falar com o suporte Propto no WhatsApp</a>
  <p class="foot">Propto Imóveis · ${esc(me.nome)}${me.creci ? " · " + esc(me.creci) : ""}</p>`;
  $("qcap").onclick = () => go({ v: "captar" }, false); $("gplano").onclick = () => go({ v: "plano" }); $("gofs").onclick = () => go({ v: "ofertas" }, false);
  document.querySelectorAll("[data-cap]").forEach((b) => (b.onclick = () => { const o = O(b.dataset.cap); go(o && o.origem === "Captação própria" ? { v: "captacao", id: o.id } : { v: "oferta", id: b.dataset.cap }); }));
  document.querySelectorAll("[data-bv]").forEach((b) => (b.onclick = () => go({ v: b.dataset.bv }, b.dataset.bv !== "captar")));
  const bx = $("bvx"); if (bx) bx.onclick = () => { try { localStorage.setItem(chaveBV, "1"); } catch {} render(); };
}

function maisCliente() {
  header("Mais"); const dono = ehAdmin(); const c = CT();
  $("main").innerHTML = `<div class="card"><div class="menu">
  <button id="cm1">Plano e assinatura <span>›</span></button>${dono && c.tipo === "imobiliaria" ? '<button id="cm2">Equipe da imobiliária <span>›</span></button>' : ""}<button id="cm3">Meu perfil <span>›</span></button>
  <button id="cm4">Anúncios publicados <span>›</span></button><button id="cm5">Ler anúncio por link <span>›</span></button><button id="cm6">Relatórios emitidos <span>›</span></button>
  ${dono ? '<button id="cm7">Exportar meus dados <span>›</span></button>' : ""}<button id="cm8">Sair <span>›</span></button></div></div>
  <div class="card"><h3>Modo de tela</h3><p class="hint">Celular: registro de campo (câmera, voz, captação). Computador: gestão (painel largo, menu lateral, acompanha em tempo real o que chega do celular).</p>
  <div class="seg" id="modo">${[["auto", "Automático"], ["campo", "Celular"], ["escritorio", "Computador"]].map(([k, l]) => `<button data-modo="${k}" class="${(lerPref("pc_modo") || "auto") === k ? "on" : ""}">${l}</button>`).join("")}</div></div>
  <div class="card"><h3>Suporte</h3><p class="hint">Dúvidas, sugestões ou problemas: fale com a equipe Propto no WhatsApp, em horário comercial.</p><a class="btn" href="${esc(waSuporte())}" target="_blank" rel="noopener">Abrir o WhatsApp</a>
  <p class="hint"><a href="/termos-propto.html" target="_blank" rel="noopener">Termos de uso e privacidade</a></p></div>
  <p class="foot">Conectado como ${esc(EU.usuario || "")} · ${dono ? "responsável pela conta" : "corretor(a)"} · ${esc(c.nome || "")}</p><p class="endosso">Propto Imóveis · propto.com.br</p>`;
  $("cm1").onclick = () => go({ v: "plano" }); if ($("cm2")) $("cm2").onclick = () => go({ v: "time" }); $("cm3").onclick = () => go({ v: "perfil" });
  $("cm4").onclick = () => go({ v: "anuncios" }); $("cm5").onclick = () => go({ v: "nova" }); $("cm6").onclick = () => go({ v: "relatorios" });
  if ($("cm7")) $("cm7").onclick = async () => { try { const r = await fetch("/api/conta/exportar", { credentials: "same-origin" }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).erro || "Falhou"); await compartilharOuBaixar(await r.blob(), `Propto_dados_${new Date().toISOString().slice(0, 10)}.json`); } catch (e) { toast(e.message); } };
  $("cm8").onclick = async () => { try { await logout(); } catch {} telaLogin("Você saiu."); };
  document.querySelectorAll("#modo [data-modo]").forEach((b) => (b.onclick = () => { gravarPref("pc_modo", b.dataset.modo === "auto" ? null : b.dataset.modo); aplicarModo(); render(); }));
}

VIEWS.plano = async () => {
  header("Plano e assinatura");
  if (!CLIENTE()) return back();
  await recarregarConta();
  const c = CT(); const s = c.situacao || {}; const P = EU.planos || {}; const dono = ehAdmin();
  const atual = c.assinatura ? c.plano : null; const fund = Object.values(P).some((p) => p.fundador);
  const sugerido = c.tipo === "imobiliaria" ? "imobiliaria" : "corretor";
  const cartao = (k) => { const p = P[k]; const promo = p.fundador; return `<div class="plano ${k === sugerido ? "dest" : ""} ${atual === k ? "atual" : ""}">${k === sugerido ? '<span class="tag r">Indicado para você</span>' : ""}<h3>${esc(p.nome)}</h3>
    ${atual === k && c.valor ? `<p class="preco">${c.valor < p.preco && c.ciclo !== "anual" ? `<s>${brlC(p.preco)}</s> ` : ""}<b>${brlC(c.valor)}</b><span>/${c.ciclo === "anual" ? "ano" : "mês"}</span></p><p class="hint">${c.fundador_ate ? `Preço de fundador até ${esc(dataBR(c.fundador_ate))}` : "Seu valor atual"}</p>`
    : `<p class="preco">${promo ? `<s>${brlC(p.preco)}</s> ` : ""}<b>${brlC(promo ? p.preco_fundador : p.preco)}</b><span>/mês</span></p>${promo ? `<p class="hint">Preço de fundador por 12 meses · depois ${brlC(p.preco)}/mês</p>` : `<p class="hint">ou ${brlC(p.anual)} por ano (2 meses grátis)</p>`}`}
    <p>${esc(p.resumo)}</p>${dono ? `<button class="${k === sugerido ? "p" : ""}" data-pl="${k}">${atual === k ? "Plano atual" : "Escolher " + esc(p.nome)}</button>` : ""}</div>`; };
  $("main").innerHTML = `<div class="card"><span class="k">Sua conta</span><h2>${esc(s.rotulo || "")}</h2>${s.msg ? `<p class="hint">${esc(s.msg)}</p>` : ""}
  ${c.situacao?.codigo === "teste" ? `<p class="hint">O teste termina em <b>${esc(dataBR(c.teste_fim))}</b>. Não pedimos cartão e nada é cobrado automaticamente durante o teste.</p>` : ""}
  ${c.pago_ate && s.codigo === "ativa" ? `<p class="hint">Plano <b>${esc(c.plano_nome || "")}</b> em dia até <b>${esc(dataBR(c.pago_ate))}</b>${c.valor ? ` · ${brlC(c.valor)}/${c.ciclo === "anual" ? "ano" : "mês"}` : ""}.</p>` : ""}
  ${c.fatura?.link ? `<a class="btn p" href="${esc(c.fatura.link)}" target="_blank" rel="noopener">Pagar fatura de ${brlC(c.fatura.valor)} · vence ${esc(dataBR(c.fatura.vencimento + "T12:00:00"))}</a><p class="hint">Na fatura você escolhe Pix, boleto ou cartão. A confirmação chega aqui sozinha.</p>` : ""}
  ${usoLinha("Imóveis captados" + (c.limites?.fonte === "teste" ? " no teste" : " neste mês"), c.uso?.imoveis || 0, c.limites?.imoveis || 0)}
  ${usoLinha("Leituras de documento pela IA", c.uso?.docs || 0, c.limites?.docs || 0)}
  ${usoLinha("Usuários", c.uso?.usuarios || 1, c.limites?.usuarios || 1)}</div>
  ${fund ? `<div class="card fundador"><span class="k">Desconto de fundador</span><h2>Assine durante o teste e pague 40% a menos por 12 meses.</h2><p class="hint">A primeira cobrança vence só no fim do teste (${esc(dataBR(c.teste_fim))}). Você escolhe o plano agora e continua testando.</p></div>` : ""}
  ${!dono ? `<div class="card"><p class="hint">Somente o responsável pela conta escolhe e paga o plano.</p></div>` : ""}
  <div class="planos">${["corretor", "imobiliaria", "plus"].filter((k) => P[k]).map(cartao).join("")}</div>
  <div class="card" id="fass" hidden><h2>Dados para a nota fiscal</h2><p class="hint" id="fassr"></p><div class="grid">
  <label class="full">Nome ou razão social<input id="anf" value="${esc(c.empresa || eu().nome || "")}"></label>
  <label>CPF ou CNPJ<input id="adoc" inputmode="numeric" placeholder="Somente números"></label>
  <label>Pagamento<select id="aci"><option value="mensal">Mensal</option><option value="anual">Anual (2 meses grátis)</option></select></label></div>
  <button class="p" id="aok">Confirmar e gerar a fatura</button><div class="status" id="ast"></div></div>
  ${c.assinatura && dono ? `<div class="card"><h3>Cancelar assinatura</h3><p class="hint">O acesso continua até o fim do período pago. Seus imóveis ficam disponíveis para consulta e exportação.</p><button class="g" id="acan">Cancelar assinatura</button></div>` : ""}
  ${EU.cobranca && !EU.cobranca.configurada ? `<div class="card"><p class="note">A cobrança online está sendo ativada. Para assinar agora, fale com a equipe Propto.</p><a class="btn" href="${esc(waSuporte("Olá! Quero assinar a Propto. Conta: " + (c.nome || "")))}" target="_blank" rel="noopener">Assinar pelo WhatsApp</a></div>` : ""}
  ${EU.cobranca && EU.cobranca.configurada && !EU.cobranca.producao ? `<p class="hint">Ambiente de testes de cobrança (sandbox): nenhuma cobrança é real.</p>` : ""}
  <p class="hint">Valores sem impostos adicionais. Nota fiscal emitida para o CPF ou CNPJ informado. <a href="/termos-propto.html" target="_blank" rel="noopener">Termos de uso</a>.</p>`;
  let escolhido = null;
  document.querySelectorAll("[data-pl]").forEach((b) => (b.onclick = () => {
    escolhido = b.dataset.pl; const p = P[escolhido]; const f = $("fass"); f.hidden = false;
    $("fassr").textContent = `Plano ${p.nome}: ${brlC(p.fundador ? p.preco_fundador : p.preco)}/mês${p.fundador ? " por 12 meses (fundador)" : ""} ou ${brlC(p.anual)}/ano. ${c.situacao?.codigo === "teste" ? "A primeira cobrança vence no fim do teste." : "A fatura vence hoje."}`;
    f.scrollIntoView({ behavior: "smooth" });
  }));
  if ($("aok")) $("aok").onclick = async () => {
    const st = $("ast"); st.className = "status"; st.textContent = "Gerando a fatura…"; $("aok").disabled = true;
    try {
      const r = await api("conta/assinar", { method: "POST", body: JSON.stringify({ plano: escolhido, ciclo: $("aci").value, documento: $("adoc").value, nome_fatura: $("anf").value }) });
      await recarregarConta(); st.textContent = "Plano escolhido.";
      if (r.fatura?.link) { st.innerHTML = `Plano escolhido. <a href="${esc(r.fatura.link)}" target="_blank" rel="noopener">Abrir a fatura</a>`; try { window.open(r.fatura.link, "_blank", "noopener"); } catch {} }
      setTimeout(() => VIEWS.plano(), 1200);
    } catch (e) { st.className = "status err"; st.textContent = e.message; $("aok").disabled = false; }
  };
  const ac = $("acan"); if (ac) confirmar2(ac, "Toque de novo para cancelar", async () => {
    const motivo = ""; try { await api("conta/cancelar", { method: "POST", body: JSON.stringify({ confirmacao: "CANCELAR", motivo }) }); toast("Assinatura cancelada."); VIEWS.plano(); } catch (e) { toast(e.message); }
  });
  aplicarModoCliente();
};

VIEWS.time = () => {
  header("Equipe da imobiliária");
  if (!CLIENTE() || !ehAdmin()) return back();
  const c = CT(); const ms = c.membros || [];
  $("main").innerHTML = `<div class="card"><h2>Quem usa a Propto na ${esc(c.nome || "imobiliária")}</h2><p class="hint">${c.uso?.usuarios || ms.length} de ${c.limites?.usuarios || 1} usuário(s) do seu plano. Cada corretor tem login próprio e assina os anúncios com o próprio CRECI.</p>
  <div class="list">${ms.map((m) => `<div class="item" style="cursor:default"><span class="dot ${m.ativo ? "verde" : ""}"></span><span class="t"><b>${esc(m.nome || m.email)}</b><span>${esc([m.email, m.creci && "CRECI " + m.creci, m.papel === "admin" ? "Responsável" : "Corretor(a)", m.ativo ? "" : "INATIVO"].filter(Boolean).join(" · "))}</span></span>${m.email !== EU.usuario ? `<button class="sm" data-at="${esc(m.email)}" data-v="${m.ativo ? 0 : 1}">${m.ativo ? "Desativar" : "Reativar"}</button>` : ""}</div>`).join("")}</div></div>
  <div class="card"><h2>Incluir corretor(a)</h2><div class="grid"><label class="full">Nome completo<input id="tn"></label><label class="full">E-mail<input id="te" type="email" autocomplete="off"></label>
  <label>CRECI<input id="tc"></label><label>WhatsApp<input id="tt" type="tel"></label></div><button class="p" id="tok">Incluir e enviar acesso</button><div class="status" id="tst"></div>
  <p class="hint">A pessoa recebe um e-mail para criar a própria senha. Senhas nunca passam por aqui.</p></div>`;
  $("tok").onclick = async () => {
    const st = $("tst"); st.className = "status"; st.textContent = "Incluindo…"; const email = $("te").value.trim().toLowerCase();
    try {
      await api("conta/membros", { method: "POST", body: JSON.stringify({ nome: $("tn").value, email, creci: $("tc").value, telefone: $("tt").value }) });
      try { await requestPasswordRecovery(email); } catch {}
      await recarregarConta(); await store.carregar(); toast("Corretor(a) incluído(a). O e-mail para criar a senha foi enviado."); VIEWS.time();
    } catch (e) { st.className = "status err"; st.textContent = e.message; }
  };
  document.querySelectorAll("[data-at]").forEach((b) => (b.onclick = async () => { try { await api("conta/membros/" + encodeURIComponent(b.dataset.at), { method: "PUT", body: JSON.stringify({ ativo: b.dataset.v === "1" }) }); await recarregarConta(); await store.carregar(); VIEWS.time(); } catch (e) { toast(e.message); } }));
  aplicarModoCliente();
};

VIEWS.perfil = () => {
  header("Meu perfil"); if (!CLIENTE()) return back();
  const p = EU.perfil || {}; const c = CT(); const dono = ehAdmin();
  $("main").innerHTML = `<div class="card"><h2>Como você aparece nos anúncios e PDFs</h2><div class="grid">
  <label class="full">Nome completo<input id="pn" value="${esc(p.nome || "")}"></label><label>CRECI<input id="pc" value="${esc(p.creci || "")}"></label><label>WhatsApp<input id="pt" type="tel" value="${esc(p.telefone || "")}"></label>
  ${dono && c.tipo === "imobiliaria" ? `<label class="full">Nome da imobiliária<input id="pe" value="${esc(c.empresa || c.nome || "")}"></label>` : ""}</div>
  <button class="p" id="pok">Salvar</button><div class="status" id="pst"></div><p class="hint">E-mail de acesso: ${esc(EU.usuario || "")}. Para trocar a senha, use “Esqueci a senha” na tela de entrada.</p></div>`;
  $("pok").onclick = async () => { const st = $("pst"); try { await api("conta/perfil", { method: "PUT", body: JSON.stringify({ nome: $("pn").value, creci: $("pc").value, telefone: $("pt").value, ...($("pe") ? { empresa: $("pe").value } : {}) }) }); await recarregarConta(); await store.carregar(); st.className = "status"; st.textContent = "Salvo."; } catch (e) { st.className = "status err"; st.textContent = e.message; } };
};

/* ---------- Administração das contas de clientes (operação PrimeCorp) ---------- */
VIEWS.contasPropto = async () => {
  header("Contas Propto (clientes)");
  if (CLIENTE() || !ehAdmin()) return back();
  $("main").innerHTML = `<div class="card"><p class="hint">Carregando contas…</p></div>`;
  let d; try { d = await api("contas"); } catch (e) { $("main").innerHTML = `<div class="card"><p class="status err">${esc(e.message)}</p></div>`; return; }
  const cs = d.contas || []; const cont = (k) => cs.filter((c) => c.situacao.codigo === k).length;
  const mrr = cs.filter((c) => c.situacao.codigo === "ativa" && c.valor).reduce((n, c) => n + (c.valor || 0), 0);
  $("main").innerHTML = `<div class="kpis"><div class="kpi"><b>${cont("teste")}</b><span>Em teste</span></div><div class="kpi"><b>${cont("ativa")}</b><span>Pagantes</span></div><div class="kpi"><b>${brlC(mrr)}</b><span>Receita mensal</span></div></div>
  <div class="card"><h2>Clientes</h2><div class="list">${cs.map((c) => `<div class="item" style="cursor:default;flex-wrap:wrap"><span class="dot ${c.situacao.codigo === "ativa" ? "verde" : c.situacao.codigo === "teste" ? "amarelo" : ""}"></span><span class="t"><b>${esc(c.nome)} · ${esc(c.situacao.rotulo)}${c.situacao.codigo === "teste" ? " · " + c.situacao.dias + " dia(s)" : ""}</b>
  <span>${esc([c.tipo === "imobiliaria" ? "Imobiliária" : "Corretor(a)", c.responsavel?.nome, c.responsavel?.creci && "CRECI " + c.responsavel.creci, c.municipio, `${c.uso.imoveis}/${c.limites.imoveis} imóveis`, `${c.usuarios} usuário(s)`, c.valor ? brlC(c.valor) + (c.fundador ? " fundador" : "") : "", "desde " + dataBR(c.criado_em)].filter(Boolean).join(" · "))}</span></span>
  <span class="row" style="gap:6px">${c.responsavel?.telefone ? `<a class="btn sm" href="${esc(waLink(c.responsavel.telefone, `Olá, ${(c.responsavel.nome || "").split(" ")[0]}! Aqui é da Propto Imóveis.`))}" target="_blank" rel="noopener">WhatsApp</a>` : ""}<button class="sm" data-pr="${c.id}">+7 dias</button>${c.situacao.codigo === "suspensa" ? `<button class="sm" data-re="${c.id}">Reativar</button>` : `<button class="sm" data-su="${c.id}">Suspender</button>`}<button class="sm" data-pm="${c.id}">Pagamento manual</button></span></div>`).join("") || '<p class="empty">Nenhuma conta ainda. As contas nascem no cadastro da página propto.com.br.</p>'}</div></div>
  <p class="hint">Pagamentos pelo Asaas atualizam as contas sozinhos. “Pagamento manual” serve para Pix ou transferência recebidos fora do Asaas.</p>`;
  const acao = async (id, body, msg) => { try { await api("contas/" + id, { method: "POST", body: JSON.stringify(body) }); toast(msg); VIEWS.contasPropto(); } catch (e) { toast(e.message); } };
  document.querySelectorAll("[data-pr]").forEach((b) => (b.onclick = () => acao(b.dataset.pr, { acao: "prorrogar", dias: 7 }, "Teste prorrogado.")));
  document.querySelectorAll("[data-su]").forEach((b) => confirmar2(b, "Confirmar", () => acao(b.dataset.su, { acao: "suspender" }, "Conta suspensa.")));
  document.querySelectorAll("[data-re]").forEach((b) => (b.onclick = () => acao(b.dataset.re, { acao: "reativar" }, "Conta reativada.")));
  document.querySelectorAll("[data-pm]").forEach((b) => confirmar2(b, "1 mês, plano da conta?", () => { const c = cs.find((x) => x.id === b.dataset.pm); return acao(b.dataset.pm, { acao: "pago_manual", plano: c.plano || (c.tipo === "imobiliaria" ? "imobiliaria" : "corretor"), meses: 1 }, "Pagamento registrado."); }));
};

iniciar();
