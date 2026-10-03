import PC from "../shared/core.mjs";
import { jsPDF } from "jspdf";
import { handleAuthCallback, getUser, login, logout, acceptInvite, updateUser, requestPasswordRecovery } from "@netlify/identity";
import { tratarFoto, blobB64 } from "./foto.js";
import { ditar, vozDisponivel } from "./voz.js";
import { TERMO_PADRAO, TERMO_VERSAO, AUT_PARCERIA, AUT_PROPRIETARIO, AUT_VERSAO, ACORDO_PADRAO, ACORDO_VERSAO } from "./termo.js";

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
  if (!r.ok) throw new ErroAPI(j.erro || "Erro " + r.status, r.status);
  return j;
}
const S = { briefings: [], ofertas: [], negocios: [], contatos: [], salas: [], pedidos: [], config: [], usuarios: [], anuncios: [] };
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

/* ================= Autenticação ================= */
let usuarioAtual = null;
let EU = { papel: "admin", perfil: {} };
const ehAdmin = () => EU.papel === "admin";
function telaAuth(html) { $("hdr").innerHTML = ""; $("tabs").innerHTML = ""; $("main").innerHTML = `<div class="auth"><img class="logo d" src="/logo-escuro.png" alt="PrimeCorp Brokers"><img class="logo w" src="/logo-claro.png" alt="PrimeCorp Brokers">${html}</div>`; }
function telaLogin(msg) {
  usuarioAtual = null;
  telaAuth(`<div class="card"><h2>Entrar</h2>${msg ? `<p class="note">${esc(msg)}</p>` : ""}
  <label>E-mail<input id="le" type="email" autocomplete="username"></label>
  <label>Senha<input id="ls" type="password" autocomplete="current-password"></label>
  <button class="p" id="lb">Entrar</button><button class="g" id="lr">Esqueci a senha</button><div class="status" id="st"></div></div>`);
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
  try { await store.carregar(); try { EU = await api("status"); } catch {} }
  catch (e) { if (e.status !== 401) $("main").innerHTML = `<div class="card"><p class="status err">Não foi possível carregar: ${esc(e.message)}</p><button id="rt">Tentar de novo</button></div>`; const rt = $("rt"); if (rt) rt.onclick = abrir; return; }
  route = { v: "painel" }; stack.length = 0; render();
}
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible" || !usuarioAtual || editing) return;
  try { await store.carregar(); render(); } catch {}
});

/* ================= Navegação ================= */
let route = { v: "painel" }; const stack = []; let editing = false;
function go(r, push = true) { editing = false; if (push) stack.push(route); route = r; render(); window.scrollTo(0, 0); }
function back() { editing = false; route = stack.pop() || { v: "painel" }; render(); window.scrollTo(0, 0); }
const TOP = ["painel", "briefings", "captar", "ofertas", "contatos", "mais"];
const TABS = [
  ["painel", "Painel", '<path d="M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z"/>'],
  ["briefings", "Briefings", '<path d="M8 4h8v3H8zM6 6H4v15h16V6h-2M8 12h8M8 16h5"/>'],
  ["captar", "Captar", '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.6"/>'],
  ["ofertas", "Ofertas", '<path d="M3 21V9l9-6 9 6v12H3zM9 21v-6h6v6"/>'],
  ["contatos", "CRM", '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.8.8 3 2.5 3.5 5.2"/>'],
  ["mais", "Mais", '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>'],
];
const PAI = { captacao: "captar", equipe: "mais", anuncios: "mais", briefing: "briefings", editb: "briefings", teaser: "briefings", novasala: "briefings", oferta: "ofertas", nova: "ofertas", novopedido: "ofertas", pedido: "mais", pedidos: "mais", negocio: "painel", comissao: "painel", contato: "contatos", editc: "contatos", sala: "mais", salas: "mais", relatorios: "mais", backup: "mais", config: "mais" };
function renderTabs() {
  const cur = TOP.includes(route.v) ? route.v : PAI[route.v] || "";
  $("tabs").className = "tabs-in c6";
  $("tabs").innerHTML = TABS.map(([k, l, p]) => `<button data-tab="${k}" class="${cur === k ? "on" : ""}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">${p}</svg>${l}</button>`).join("");
  $("tabs").querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { stack.length = 0; go({ v: b.dataset.tab }, false); }));
}
function header(title) {
  const top = TOP.includes(route.v);
  $("hdr").innerHTML = top
    ? `<img class="logo d" src="/logo-escuro.png" alt="PrimeCorp Brokers"><img class="logo w" src="/logo-claro.png" alt="PrimeCorp Brokers"><div class="ttl" style="text-align:right;font-size:15px;color:var(--ink2)">${esc(title)}</div>`
    : `<button class="back" id="bk">‹ Voltar</button><div class="ttl">${esc(title)}</div>`;
  const bk = $("bk"); if (bk) bk.onclick = back;
}
const VIEWS = {};
function render() {
  if (!usuarioAtual) return;
  renderTabs();
  if (editing && ["editb", "oferta", "teaser", "nova", "editc", "novasala", "config", "novopedido", "comissao", "captacao", "equipe"].includes(route.v)) return;
  try { (VIEWS[route.v] || VIEWS.painel)(); }
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
const OF_FIELDS = ["tipo", "operacao", "cidade", "uf", "regiao", "subtitulo", "tipologia", "fabril", "construida", "terreno", "administrativo", "apoio", "frente", "zoneamento", "pe_direito", "piso_carga", "docas", "energia_kva", "pontes", "avcb", "data_anuncio", "aluguel", "venda", "condominio", "iptu", "iptu_periodo", "disponibilidade", "documentacao", "titulo", "descricao", "diferenciais", "itens"];
function fromAI(o) { const r = {}; OF_FIELDS.forEach((f) => { if (o[f] !== undefined && o[f] !== null) r[f] = fmtIn(f, o[f]); }); return r; }
function ranking(b) { return S.ofertas.filter((o) => o.status !== "descartada" && o.status !== "captacao").map((o) => { const c = chkOf(o); return Object.assign({ o, c }, PC.score(o, b, c)); }).sort((x, y) => y.score - x.score); }
function faixaArea(b) { const n = PC.numB(b); if (n.areaMin && n.areaMax) return PC.nf(n.areaMin) + " a " + PC.nf(n.areaMax) + " m²"; if (n.areaMin) return "a partir de " + PC.nf(n.areaMin) + " m²"; if (n.areaMax) return "até " + PC.nf(n.areaMax) + " m²"; return ""; }
function confirmar2(btn, txt, fn) { let armed = false; btn.onclick = async () => { if (!armed) { armed = true; btn.dataset.orig = btn.textContent; btn.textContent = txt; setTimeout(() => { armed = false; if (btn.isConnected) btn.textContent = btn.dataset.orig; }, 4000); return; } btn.disabled = true; try { await fn(); } finally { btn.disabled = false; } }; }

/* ================= PAINEL ================= */
VIEWS.painel = () => {
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
  $("main").innerHTML = `
  <button class="captar-cta" id="qcap"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.6"/></svg><span><b>Captar imóvel</b><small>${capAbertas ? capAbertas + " captação(ões) em andamento" : "Fotos, voz e anúncio no local da visita"}</small></span><span>›</span></button>
  <div class="kpis"><div class="kpi"><b>${ativos.length}</b><span>Briefings ativos</span></div><div class="kpi"><b>${S.ofertas.filter((o) => o.status !== "descartada").length}</b><span>Ofertas na base</span></div><div class="kpi"><b>${abertos.length}</b><span>Negócios abertos</span></div></div>
  ${novas.length ? `<button class="card" id="gonovas" style="text-align:left;cursor:pointer;flex-direction:row;align-items:center"><span class="dot amarelo"></span><span style="flex:1"><b>${novas.length} oferta${novas.length > 1 ? "s" : ""} a revisar</b><br><span class="hint">Confira os dados antes de cruzar com os briefings.</span></span><span>›</span></button>` : ""}
  ${pedNovos.length ? `<button class="card" id="gopeds" style="text-align:left;cursor:pointer;flex-direction:row;align-items:center"><span class="dot verde"></span><span style="flex:1"><b>${pedNovos.length} resposta(s) de anunciante</b><br><span class="hint">Dados completados ou autorizações de indicação recebidas.</span></span><span>›</span></button>` : ""}
  ${comAbertas.length ? `<div class="card"><h3>Honorários previstos</h3><p><b>${esc(PC.brl(totPC) || "R$ 0")}</b> participação PrimeCorp <span class="hint">· ${esc(PC.brl(totCom) || "R$ 0")} em honorários totais · ${comAbertas.length} negócio(s) com divisão definida</span></p></div>` : ""}
  ${salasNovas ? `<button class="card" id="gosalas" style="text-align:left;cursor:pointer;flex-direction:row;align-items:center"><span class="dot verde"></span><span style="flex:1"><b>${salasNovas} novidade(s) nas Salas do Cliente</b><br><span class="hint">Aceites de termo e interesses registrados.</span></span><span>›</span></button>` : ""}
  <div class="card"><div class="row" style="justify-content:space-between"><h2>Negócios</h2><button class="sm" id="csv">Exportar CSV</button></div>
  ${cols ? `<div class="kanban">${cols}</div>` : '<p class="empty">Nenhum negócio aberto. Abra um briefing, escolha uma oferta do ranking e envie o teaser ou crie uma Sala do Cliente.</p>'}
  ${S.negocios.some((n) => n.etapa === "perdido") ? `<p class="hint">${S.negocios.filter((n) => n.etapa === "perdido").length} negócio(s) perdido(s) fora do quadro.</p>` : ""}</div>
  <div class="row"><button class="grow" id="qnova">+ Nova oferta</button><button class="grow" id="qbrief">+ Novo briefing</button></div>
  <p class="foot">PrimeCorp Brokers · Rodrigo França Viana · CRECI-SP 297692</p>`;
  document.querySelectorAll("[data-n]").forEach((b) => (b.onclick = () => go({ v: "negocio", id: b.dataset.n })));
  const gn = $("gonovas"); if (gn) gn.onclick = () => go({ v: "ofertas", f: "nova" }, false);
  const gs = $("gosalas"); if (gs) gs.onclick = () => go({ v: "salas" });
  const gp = $("gopeds"); if (gp) gp.onclick = () => go({ v: "pedidos" });
  $("csv").onclick = exportCSV;
  $("qnova").onclick = () => go({ v: "nova" }); $("qcap").onclick = () => go({ v: "captar" }, false);
  $("qbrief").onclick = () => go({ v: "editb", id: null });
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
const TIPOS_C = ["Cliente (empresa)", "Cliente (investidor)", "Corretor parceiro", "Imobiliária", "Proprietário", "Outro"];
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
function fieldHTML([k, l, t, cls], val) {
  const v = esc(val == null ? "" : val);
  if (t.startsWith("sel:")) return `<label class="${cls}">${l}<select data-k="${k}">${t.slice(4).split("|").map((o) => `<option ${o === val ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></label>`;
  if (t.startsWith("u:")) return `<label class="u ${cls}">${l}<input data-k="${k}" inputmode="decimal" value="${v}"><span>${t.slice(2)}</span></label>`;
  if (t === "area") return `<label class="${cls}">${l}<textarea data-k="${k}" rows="2">${v}</textarea></label>`;
  if (t === "num") return `<label class="${cls}">${l}<input data-k="${k}" inputmode="numeric" value="${v}"></label>`;
  if (t.startsWith("ref:")) { const tipos = t.slice(4).split("|"); const opts = S.contatos.filter((c) => tipos.some((x) => (c.tipo || "").startsWith(x))).sort((a, b) => nomeC(a).localeCompare(nomeC(b))); return `<label class="${cls}">${l}<select data-k="${k}"><option value="">— nenhum —</option>${opts.map((c) => `<option value="${c.id}" ${c.id === val ? "selected" : ""}>${esc(nomeC(c))}</option>`).join("")}</select></label>`; }
  return `<label class="${cls}">${l}<input data-k="${k}" type="${t === "tel" ? "tel" : "text"}" value="${v}"></label>`;
}
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
  ["tipo", "Tipo", "sel:Galpão|Galpão em condomínio|Área / terreno|Prédio comercial|Imóvel comercial|Fazenda", ""], ["operacao", "Operação", "sel:Locação|Venda", ""],
  ["cidades", "Cidades aceitas (separe por vírgula)", "text", "full"], ["regiao", "Região / eixo", "text", "full"],
  ["areaMin", "Área mínima", "u:m²", ""], ["areaMax", "Área máxima", "u:m²", ""], ["peMin", "Pé-direito mín.", "u:m", ""], ["kvaMin", "Energia mín.", "u:kVA", ""], ["docasMin", "Docas mín.", "num", ""],
  ["precoMaxM2", "Aluguel máx. por m²", "u:R$", ""], ["valorMax", "Compra: valor máx.", "u:R$", ""], ["prazo", "Prazo de ocupação", "text", ""],
  ["desejaveis", "Desejáveis", "area", "full"], ["obs", "Observações internas", "area", "full"], ["status", "Situação", "sel:ativo|pausado|encerrado", ""],
];
VIEWS.editb = () => {
  const b = route.id ? B(route.id) : null; header(b ? "Editar briefing" : "Novo briefing");
  const cur = { ...(b || { status: "ativo", tipo: "Galpão", operacao: "Locação" }), ...(route.draft || {}), ...(route.cliente ? { cliente: route.cliente } : {}), ...(route.parceiro_id ? { parceiro_id: route.parceiro_id } : {}) };
  $("main").innerHTML = `<div class="card" id="fb"><p class="hint">Requisitos obrigatórios eliminam ofertas; o resto vira pontuação. Nomes de cliente e parceiro nunca aparecem no teaser.</p><div class="grid">${BF.map((f) => fieldHTML(f, cur[f[0]])).join("")}</div>
  <button class="g" id="nc">+ Cadastrar contato novo no CRM</button>
  <div class="row"><button class="p grow" id="sv">Salvar briefing</button>${b ? '<button class="g" id="del">Excluir</button>' : ""}</div><div class="status" id="st"></div></div>`;
  editing = true;
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
  <button class="p" id="sala">Criar Sala do Cliente</button>
  ${salas.length ? `<div class="list">${salas.map((s) => `<button class="item" data-s="${s.id}"><span class="t"><b>${esc(s.titulo || "Sala")}</b><span>${s.aceite ? "Aceite " + fdt(s.aceite.em) : "Aguardando aceite"} · ${(s.opcoes || []).length} opção(ões) · ${(s.interesses || []).length} interesse(s)</span></span></button>`).join("")}</div>` : ""}</div>
  <div class="card"><div class="row" style="justify-content:space-between"><h2>Ranking</h2><span class="hint">${ok.length} aderente(s)</span></div>
  <div class="list">${ok.map((x, i) => { const neg = negs.find((n) => n.oferta === x.o.id); return `<div class="item" style="cursor:default;flex-wrap:wrap"><span class="dot ${x.c.sem}"></span><span class="t"><b>${esc((x.o.codigo ? x.o.codigo + " · " : "") + tituloO(x.o))}</b><span>${esc([x.o.cidade, x.o.origem].filter(Boolean).join(" · "))}</span><span class="reasons">${esc(x.motivos.slice(0, 3).join(" · ") || "Atende a todos os critérios")}</span></span><span class="score">${x.score}</span>
  <div class="row" style="width:100%;justify-content:flex-end">${neg ? `<button class="sm" data-n="${neg.id}">Negócio · ${esc(etapaNome(neg.etapa))}</button>` : `<button class="sm p" data-t="${x.o.id}" data-l="Opção ${String.fromCharCode(65 + (i % 26))}">Teaser</button>`}<button class="sm" data-o="${x.o.id}">Oferta</button></div></div>`; }).join("") || '<p class="empty">Nenhuma oferta aderente ainda.</p>'}</div>
  ${fora.length ? `<details><summary class="hint" style="cursor:pointer;padding:6px 0">${fora.length} fora do briefing</summary><div class="list">${fora.map((x) => `<button class="item" data-o="${x.o.id}"><span class="dot ${x.c.sem}"></span><span class="t"><b>${esc(tituloO(x.o))}</b><span>${esc(x.fora)}</span></span></button>`).join("")}</div></details>` : ""}</div>`;
  $("ed").onclick = () => go({ v: "editb", id: b.id });
  $("sala").onclick = () => go({ v: "novasala", b: b.id });
  document.querySelectorAll("[data-t]").forEach((x) => (x.onclick = () => go({ v: "teaser", b: b.id, o: x.dataset.t, l: x.dataset.l })));
  document.querySelectorAll("[data-o]").forEach((x) => (x.onclick = () => go({ v: "oferta", id: x.dataset.o })));
  document.querySelectorAll("[data-n]").forEach((x) => (x.onclick = () => go({ v: "negocio", id: x.dataset.n })));
  document.querySelectorAll("[data-c]").forEach((x) => (x.onclick = () => go({ v: "contato", id: x.dataset.c })));
  document.querySelectorAll("[data-s]").forEach((x) => (x.onclick = () => go({ v: "sala", id: x.dataset.s })));
};

/* ================= TEASER ================= */
VIEWS.teaser = () => {
  const b = B(route.b), o = O(route.o); if (!b || !o) return back();
  header("Teaser · nível 1"); const c = chkOf(o); const txt = PC.teaser(o, c, route.l || "Opção");
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
  const cfg = CFG(); const termo = cfg.termo || "";
  if (!cfg.termo_revisado || !termo.trim() || termo.includes("[__")) {
    $("main").innerHTML = `<div class="card"><h2>Revise o termo antes</h2><p class="hint">A Sala do Cliente exige que o cliente aceite o Termo de Apresentação, Confidencialidade e Não-Contorno. Preencha os campos marcados com [__] e confirme a revisão em Configurações.</p><button class="p" id="cf">Abrir configurações</button></div>`;
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
      const sala = { id: token, briefing: b.id, contato: ct ? ct.id : null, titulo: $("tt").value.trim() || "Opções selecionadas", preparado_para: ct ? ct.empresa || ct.nome || "" : "", opcoes, termo_texto: cfg.termo, termo_versao: cfg.termo_versao || TERMO_VERSAO, expira: new Date(Date.now() + dias * 864e5).toISOString(), status: "ativa", criado: now(), interesses: [], contato_corretor: { nome: cfg.corretor_nome || "Rodrigo França Viana", creci: cfg.corretor_creci || "CRECI-SP 297692", whatsapp: cfg.corretor_whatsapp || "", email: cfg.corretor_email || "" } };
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
};
async function gerarAcordo(n, o, b) {
  const cfg = CFG(); const texto0 = cfg.acordo || ACORDO_PADRAO;
  if (!cfg.acordo_revisado || texto0.includes("[__")) { toast("Antes: preencha os campos [__] do acordo em Mais → Configurações, revise com seu advogado e marque a revisão."); return go({ v: "config" }); }
  try {
    const d = o ? PC.num(o) : {}; const cli = b ? C(b.cliente) : null; const sl = n.sala ? S.salas.find((x) => x.id === n.sala) : null;
    const base = { codigo: o?.codigo || "", titulo: o ? tituloO(o) : "", tipo: d.tipo, cliente: (cli && (cli.empresa || cli.nome)) || sl?.aceite?.razao || (b ? nomeB(b) : ""), comissao: n.comissao };
    const texto = PC.preencher(texto0, PC.varsAcordo(base));
    const doc = PC.pdfAcordo(jsPDF, { ...base, texto, versao: cfg.acordo_versao || ACORDO_VERSAO, corretor: { nome: cfg.corretor_nome, creci: cfg.corretor_creci }, logos: LOGOS.dark ? LOGOS : null });
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
  header("Ofertas"); const f = route.f || "todas";
  let os = [...S.ofertas].sort((a, b) => (b.criado || "").localeCompare(a.criado || ""));
  if (f === "nova") os = os.filter((o) => o.status === "nova"); else if (f === "descartada") os = os.filter((o) => o.status === "descartada"); else os = os.filter((o) => o.status !== "descartada");
  $("main").innerHTML = `<button class="p" id="nv">+ Nova oferta</button><div class="seg">${[["todas", "Ativas"], ["nova", "A revisar"], ["descartada", "Descartadas"]].map(([k, l]) => `<button data-f="${k}" class="${f === k ? "on" : ""}">${l}</button>`).join("")}</div>
  <input id="q" placeholder="Buscar por código, cidade, tipo ou título" value="${esc(route.q || "")}">
  <div class="card"><div class="list" id="ls"></div></div>`;
  const draw = () => { const q = PC.norm($("q").value); const rows = os.filter((o) => !q || PC.norm([o.codigo, tituloO(o), o.cidade, o.tipo, o.regiao, o.origem].join(" ")).includes(q));
    $("ls").innerHTML = rows.map((o) => { const c = chkOf(o); return `<button class="item" data-o="${o.id}"><span class="dot ${c.sem}"></span><span class="t"><b>${esc((o.codigo ? o.codigo + " · " : "") + tituloO(o))}</b><span>${esc([o.cidade, o.origem, o.status === "nova" ? "a revisar" : o.status === "captacao" ? "em captação" : ""].filter(Boolean).join(" · "))}</span></span><span class="chip">${esc(o.operacao || "")}</span></button>`; }).join("") || '<p class="empty">Nada por aqui.</p>';
    $("ls").querySelectorAll("[data-o]").forEach((x) => (x.onclick = () => { route.q = $("q").value; go({ v: "oferta", id: x.dataset.o }); })); };
  draw(); $("q").addEventListener("input", draw);
  document.querySelectorAll(".seg [data-f]").forEach((x) => (x.onclick = () => { route = { v: "ofertas", f: x.dataset.f }; render(); }));
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
<label>Tipo<select data-f="tipo"><option>Galpão</option><option>Galpão em condomínio</option><option>Área / terreno</option><option>Prédio comercial</option><option>Imóvel comercial</option><option>Fazenda</option></select></label>
<label>Operação<select data-f="operacao"><option>Locação</option><option>Venda</option><option>Locação / Venda</option></select></label>
<label>Cidade<input data-f="cidade"></label><label>UF<input data-f="uf" maxlength="2" style="text-transform:uppercase"></label>
<label class="full">Região / eixo (vai no teaser e na sala)<input data-f="regiao" placeholder="Eixo Anhanguera (RMC)"></label>
<label class="full">Acesso / destaque (sem endereço)<input data-f="subtitulo" placeholder="acesso direto pela Rod. Anhanguera"></label>
<label class="full">Tipologia<input data-f="tipologia" placeholder="Isolado / em condomínio"></label></div></fieldset>
<fieldset><legend>Áreas</legend><div class="grid">
<label class="u">Fabril / galpão<input data-f="fabril" inputmode="decimal"><span>m²</span></label>
<label class="u">Construída<input data-f="construida" inputmode="decimal"><span>m²</span></label>
<label class="u">Terreno<input data-f="terreno" inputmode="decimal"><span>m²</span></label>
<label class="u">Administrativo<input data-f="administrativo" inputmode="decimal"><span>m²</span></label>
<label class="u">Apoio / outros<input data-f="apoio" inputmode="decimal"><span>m²</span></label>
<label class="u">Frente (terreno)<input data-f="frente" inputmode="decimal"><span>m</span></label><label>Zoneamento<input data-f="zoneamento"></label></div></fieldset>
<fieldset><legend>Estrutura</legend><div class="grid3">
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
function fillForm(root, o) { root.querySelectorAll("[data-f]").forEach((el) => { const k = el.dataset.f; const v = o[k]; if (el.tagName === "SELECT") { const opt = [...el.options].find((x) => (x.value || x.text).toLowerCase() === String(v || "").toLowerCase()); if (opt) el.value = opt.value || opt.text; else el.selectedIndex = 0; } else el.value = fmtIn(k, v); }); }
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
  <button class="${au ? "" : "p"}" id="solic">${au ? "Novo pedido ao anunciante" : "Solicitar dados e autorização ao anunciante"}</button></div>
  <div class="card" id="fo">${OFORM}</div>
  <div class="card"><h2>Checagem</h2><div class="sem" id="sem"><i></i><div><span id="semT"></span><small id="semS"></small></div></div><div class="priv" id="priv" hidden></div><ul class="alerts" id="al"></ul><p class="hint">O semáforo fica só aqui. Na ficha, os alertas viram “itens a confirmar”.</p></div>
  <div class="card"><div class="row"><button class="p grow" id="sv">Salvar</button><button class="grow" id="pdf">Ficha PDF</button></div><div id="pdfnote"></div>
  ${o.link ? `<a class="btn sm" href="${esc(o.link)}" target="_blank" rel="noopener">Abrir anúncio original</a>` : ""}<button class="g" id="del">Excluir oferta</button></div>`;
  const root = $("fo"); fillForm(root, o); editing = true;
  fontes.forEach((k) => { const el = root.querySelector(`[data-f="${k}"]`); if (el) { el.classList.add("doanunciante"); el.title = "Informado pelo anunciante"; } });
  document.querySelectorAll("[data-p]").forEach((x) => (x.onclick = () => go({ v: "pedido", id: x.dataset.p })));
  $("solic").onclick = async () => { const cur = { ...o, ...readForm(root) }; editing = false; try { await store.save("ofertas", { ...cur, atualizado: now() }); } catch { editing = true; return; } go({ v: "novopedido", o: o.id }); };
  const upd = () => { if (!$("sem")) return; const cur = { ...o, ...readForm(root) }; const c = chkOf(cur);
    $("sem").className = "sem " + c.sem; $("semT").textContent = SEM[c.sem][0]; $("semS").textContent = SEM[c.sem][1];
    $("al").innerHTML = c.alerts.map((a) => `<li class="${a.lvl}">${esc(a.msg)}</li>`).join("") || '<li class="ok">Dados completos e coerentes.</li>';
    $("priv").hidden = !c.privacy; $("priv").textContent = c.privacy || ""; root.querySelector('[data-f="titulo"]').placeholder = PC.autoTitle(PC.num(cur));
    const cp = PC.completude(cur); $("cbar").style.width = cp.pct + "%"; $("cbar").className = cp.ok ? "ok" : cp.pct >= 60 ? "mid" : "";
    $("ctxt").textContent = cp.ok ? "Completa: pode gerar a ficha e a autorização." : `${cp.pct}% preenchida · ${cp.faltam.filter((f) => !f.extra).length} informação(ões) básica(s) faltando.`;
    $("cfal").innerHTML = cp.faltam.filter((f) => !f.extra).map((f) => `<li class="a">${esc(f.pergunta)}</li>`).join("");
    return cur; };
  upd(); root.addEventListener("input", () => { clearTimeout(upd._t); upd._t = setTimeout(upd, 200); }); root.addEventListener("change", upd);
  $("sv").onclick = async () => { const cur = upd(); const st = cur.status === "nova" ? "revisada" : cur.status; editing = false; try { await store.save("ofertas", { ...cur, status: st, revisar_anunciante: false, atualizado: now() }); toast("Oferta salva" + (o.status === "nova" ? " e marcada como revisada." : ".")); back(); } catch { editing = true; } };
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
    ? `<p class="hint">No anúncio: toque e segure no texto → Selecionar tudo → Copiar. Cole aqui. O link fica registrado só para você.</p>
     <label>Link do anúncio<input id="url" type="url" inputmode="url" placeholder="https://…"></label>
     <label>Origem<select id="org"><option>Portal</option><option>Imobiliária</option><option>Corretor parceiro</option><option>Leilão</option><option>Proprietário</option></select></label>
     <label>Texto do anúncio<textarea id="src" rows="7" placeholder="Cole o texto completo do anúncio…"></textarea></label>
     <div class="row"><button class="p grow" id="bx">Extrair dados</button><button class="g" id="bm">Preencher manual</button></div>`
    : `<p class="hint">Cole o conteúdo inteiro de um e-mail de alerta (busca salva do portal). Cada anúncio vira uma oferta “a revisar”. Com a caixa de alertas configurada, isso acontece sozinho a cada 30 minutos.</p>
     <label>Conteúdo do e-mail<textarea id="src" rows="10" placeholder="Cole o e-mail inteiro…"></textarea></label>
     <button class="p" id="bx">Extrair ofertas</button>`}
  <div class="status" id="st"></div></div>`;
  editing = true; const st = $("st");
  document.querySelectorAll("[data-m]").forEach((x) => (x.onclick = () => { editing = false; route = { v: "nova", m: x.dataset.m }; render(); }));
  const fail = (e) => { st.className = "status err"; st.textContent = "Não consegui extrair: " + e.message; };
  if (m === "um") {
    $("bm").onclick = async () => { const o = { id: uid("o"), link: $("url").value.trim(), origem: $("org").value, status: "nova", tipo: "Galpão", operacao: "Locação", criado: now(), atualizado: now() }; editing = false; await store.save("ofertas", o); stack.length = 0; go({ v: "oferta", id: o.id }, false); };
    $("bx").onclick = async () => { const txt = $("src").value.trim();
      if (txt.length < 40) { st.className = "status err"; st.textContent = "Cole o texto do anúncio (o link sozinho não basta)."; return; }
      const b = $("bx"); b.disabled = true; b.textContent = "Extraindo…"; st.className = "status"; st.textContent = "Lendo o anúncio (10 a 40 s)…";
      try { const x = await api("extrair", { method: "POST", body: JSON.stringify({ modo: "um", texto: txt }) });
        const link = $("url").value.trim(); const dup = link && S.ofertas.find((y) => y.link === link);
        const o = { id: uid("o"), link, origem: $("org").value, status: "nova", anunciante: x.anunciante || "", alertas_ia: Array.isArray(x.alertas_ia) ? x.alertas_ia : [], criado: now(), atualizado: now(), ...fromAI(x) };
        editing = false; await store.save("ofertas", o); stack.length = 0; go({ v: "oferta", id: o.id }, false); toast(dup ? "Atenção: esse link já existe na base (" + (dup.codigo || tituloO(dup)) + ")." : "Confira os dados e salve."); }
      catch (e) { fail(e); } finally { b.disabled = false; b.textContent = "Extrair dados"; } };
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
  header("Mais");
  $("main").innerHTML = `<div class="card"><div class="menu">
  <button id="m8">Anúncios publicados <span>›</span></button>${ehAdmin() ? '<button id="m9">Equipe e permissões <span>›</span></button>' : ""}
  <button id="m1">Nova oferta <span>›</span></button><button id="m2">Salas do Cliente <span>›</span></button><button id="m7">Anunciantes (pedidos e autorizações) <span>›</span></button><button id="m3">Relatórios emitidos <span>›</span></button>${ehAdmin() ? '<button id="m4">Backup <span>›</span></button><button id="m5">Configurações <span>›</span></button>' : ""}<button id="m6">Sair <span>›</span></button></div></div>
  <p class="foot">Conectado como ${esc(EU.usuario || usuarioAtual?.email || "")} · ${ehAdmin() ? "administrador" : "corretor(a)"}</p>`;
  $("m1").onclick = () => go({ v: "nova" }); $("m2").onclick = () => go({ v: "salas" }); $("m3").onclick = () => go({ v: "relatorios" });
  if ($("m4")) $("m4").onclick = () => go({ v: "backup" }); if ($("m5")) $("m5").onclick = () => go({ v: "config" }); $("m7").onclick = () => go({ v: "pedidos" });
  $("m8").onclick = () => go({ v: "anuncios" }); if ($("m9")) $("m9").onclick = () => go({ v: "equipe" });
  $("m6").onclick = async () => { try { await logout(); } catch {} telaLogin("Você saiu."); };
};
const TIPOS_E = { teaser: "Teaser", ficha_pdf: "Ficha PDF", sala: "Sala criada", aceite: "Aceite de termo", interesse: "Interesse", pedido_anunciante: "Pedido ao anunciante", anunciante_dados: "Dados do anunciante", autorizacao: "Autorização do anunciante", comissao: "Comissão", acordo_comissao: "Acordo de divisão", anuncio_publicado: "Anúncio publicado", coleta: "Coleta de alertas", restauracao: "Restauração" };
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
  <label>WhatsApp<input data-k="corretor_whatsapp" value="${esc(c.corretor_whatsapp || "(19) 99805-1985")}"></label><label>E-mail<input data-k="corretor_email" value="${esc(c.corretor_email || "contato@primecorpconsultoria.com.br")}"></label></div>
  <h2>Termo de Apresentação, Confidencialidade e Não-Contorno</h2>
  <p class="hint">É o texto que o cliente aceita antes de ver as opções. Preencha os campos [__] e revise com seu advogado. Cada sala guarda a versão aceita.</p>
  <label>Versão<input data-k="termo_versao" value="${esc(c.termo_versao || TERMO_VERSAO)}"></label>
  <label>Texto<textarea data-k="termo" rows="16">${esc(termo)}</textarea></label>
  <label class="check"><input type="checkbox" id="rv" ${c.termo_revisado ? "checked" : ""}> Revisei o termo e autorizo o uso nas Salas do Cliente</label>
  <h2>Comissão padrão</h2><p class="hint">Valores sugeridos nos pedidos ao anunciante e nos negócios. Em cada negócio você ajusta.</p>
  <div class="grid"><label class="u">Venda<input data-k="com_venda_pct" inputmode="decimal" value="${esc(c.com_venda_pct || "6")}"><span>%</span></label><label class="u">Locação<input data-k="com_locacao_alugueis" inputmode="decimal" value="${esc(c.com_locacao_alugueis || "1")}"><span>aluguéis</span></label></div>
  <h3>Modelos de divisão</h3><div id="fm"></div><button class="sm" id="addm">+ Modelo</button>
  <label class="check"><input type="checkbox" id="cr" ${c.com_revisada ? "checked" : ""}> Conferi os percentuais e os modelos de divisão</label>
  <h2>Termos de autorização do anunciante</h2>
  <p class="hint">O anunciante aceita um destes textos pelo link ou no PDF. O sistema preenche {{CODIGO}}, {{TITULO}}, {{OPERACAO}}, {{COMISSAO}}, {{QUADRO}} e {{VALOR}}. Os campos [__] você define com seu advogado.</p>
  <label>Versão<input data-k="aut_versao" value="${esc(c.aut_versao || AUT_VERSAO)}"></label>
  <label>Parceria com imobiliária ou corretor<textarea data-k="aut_parceria" rows="12">${esc(c.aut_parceria || AUT_PARCERIA)}</textarea></label>
  <label>Autorização do proprietário<textarea data-k="aut_proprietario" rows="12">${esc(c.aut_proprietario || AUT_PROPRIETARIO)}</textarea></label>
  <label class="check"><input type="checkbox" id="ra" ${c.aut_revisado ? "checked" : ""}> Revisei os dois termos de autorização e autorizo o uso</label>
  <h2>Acordo de divisão de honorários</h2>
  <p class="hint">Documento que todas as partes do negócio assinam (imobiliária, corretor parceiro e PrimeCorp). O sistema preenche {{OPERACAO}}, {{CODIGO}}, {{TITULO}}, {{CLIENTE}}, {{COMISSAO}}, {{VALOR}}, {{TOTAL}}, {{QUADRO}} e {{RECEBEDOR}}.</p>
  <label>Versão<input data-k="acordo_versao" value="${esc(c.acordo_versao || ACORDO_VERSAO)}"></label>
  <label>Texto<textarea data-k="acordo" rows="14">${esc(c.acordo || ACORDO_PADRAO)}</textarea></label>
  <label class="check"><input type="checkbox" id="rac" ${c.acordo_revisado ? "checked" : ""}> Revisei o acordo de divisão e autorizo o uso</label>
  <button class="p" id="sv">Salvar configurações</button><div class="status" id="st"></div></div>
  <div class="card"><h2>Coleta automática de alertas</h2><div id="cs"><p class="hint">Verificando…</p></div></div>`;
  editing = true;
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
    if (rev && v.termo.includes("[__")) return err("O termo do cliente ainda tem campos [__] sem preencher.");
    if (ra && (v.aut_parceria.includes("[__") || v.aut_proprietario.includes("[__"))) return err("Os termos de autorização ainda têm campos [__] sem preencher.");
    if (rac && v.acordo.includes("[__")) return err("O acordo de divisão ainda tem campos [__] sem preencher.");
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
function demandaPara(o) { return S.briefings.filter((b) => (b.status || "ativo") === "ativo").map((b) => ({ b, r: PC.score(o, b, chkOf(o)) })).filter((x) => !x.r.fora); }
const creciTxt = (c) => (c ? (/creci/i.test(c) ? c : "CRECI " + c) : "");
function partesHTML(partes, comNomes) {
  const cfg = CFG(); partes = partes.map((p) => (PC.ehPC(p) && !p.nome ? { ...p, nome: cfg.corretor_nome || "Rodrigo França Viana", creci: p.creci || cfg.corretor_creci || "CRECI-SP 297692" } : p));
  const opts = (sel) => S.contatos.filter((c) => /^(Corretor|Imobili)/.test(c.tipo || "")).sort((a, b) => nomeC(a).localeCompare(nomeC(b))).map((c) => `<option value="${c.id}" ${c.id === sel ? "selected" : ""}>${esc(nomeC(c))}</option>`).join("");
  return partes.map((p) => `<div class="parte">
  <label>Papel<select data-pp="papel">${PC.PAPEIS.map((x) => `<option ${x === p.papel ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></label>
  <label class="u">Participação<input data-pp="pct" inputmode="decimal" value="${esc(p.pct ?? "")}"><span>%</span></label>
  ${comNomes ? `<label>Contato no CRM<select data-pp="contato"><option value="">—</option>${opts(p.contato)}</select></label><label>Nome<input data-pp="nome" value="${esc(p.nome || "")}"></label><label class="full">CRECI<input data-pp="creci" value="${esc(p.creci || "")}"></label>` : ""}
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
  const pend = !cfg.aut_revisado || [cfg.aut_parceria, cfg.aut_proprietario].some((t) => !t || t.includes("[__")) || !cfg.com_revisada;
  if (pend) {
    $("main").innerHTML = `<div class="card"><h2>Revise os termos e a comissão antes</h2><p class="hint">O anunciante vai aceitar um termo com a divisão de honorários. Em Configurações: preencha os campos [__] dos dois termos de autorização, confira os percentuais padrão de comissão e os modelos de divisão, e marque as revisões.</p><button class="p" id="cf">Abrir configurações</button></div>`;
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
      const codigo = await garantirCodigo(o); const atual = O(o.id) || o;
      const tipo = $("tt").value; const d = PC.num(atual);
      const vars = { CODIGO: codigo, TITULO: PC.autoTitle(d), OPERACAO: (atual.operacao || "locação").toLowerCase(), COMISSAO: com.texto, QUADRO: PC.quadroComissao(com), VALOR: [d.venda && PC.brl(d.venda) + " (venda)", d.aluguel && PC.brl(d.aluguel) + "/mês (locação)"].filter(Boolean).join(" ou ") || "a definir" };
      const termo = trocaCorretor(PC.preencher(tipo === "proprietario" ? cfg.aut_proprietario : cfg.aut_parceria, vars), corretorDaOferta(atual));
      const token = tokenAleatorio(32); const ct = C($("ct").value);
      const ped = { id: token, oferta: atual.id, codigo, titulo: tituloO(atual), operacao: atual.operacao || "", tipo_termo: tipo, anunciante: $("an").value.trim(), contato: ct ? ct.id : null,
        demanda: $("dm") && $("dm").checked ? dem.length : 0, conhecidos: PC.conhecidos(atual), faltam: comp.faltam, comissao: com, termo_texto: termo, termo_versao: cfg.aut_versao || AUT_VERSAO,
        modo: comp.ok ? "autorizacao" : "complementacao", expira: new Date(Date.now() + Number($("vd").value) * 864e5).toISOString(), status: "aberto", criado: now(), respostas: [],
        corretor: corretorDaOferta(atual) };
      editing = false; await store.save("pedidos", ped);
      if (!atual.anunciante && ped.anunciante) await store.save("ofertas", { ...atual, anunciante: ped.anunciante, atualizado: now() });
      await pdfAnunciante(ped, true);
      stack.pop(); route = { v: "pedido", id: token }; render(); toast("Pedido criado.");
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
  const msg = `Olá${p.anunciante ? ", " + p.anunciante : ""}! Sou ${p.corretor?.nome || "Rodrigo França Viana"}, corretor de imóveis (${p.corretor?.creci || "CRECI-SP 297692"}).${p.demanda ? ` Tenho ${p.demanda} cliente${p.demanda > 1 ? "s" : ""} com demanda compatível com o seu imóvel` : " Tenho interesse em apresentar o seu imóvel"} (${p.titulo}, ref. ${p.codigo}) aos meus clientes.${p.modo === "autorizacao" ? " Preciso só da sua autorização de indicação." : " Para isso, preciso de algumas informações e da sua autorização de indicação."} Você responde pelo celular neste link:\n${link}`;
  const adere = o ? demandaPara(o) : [];
  const resp = [...(p.respostas || [])].reverse();
  $("main").innerHTML = `<div class="card"><span class="k">${esc(STATUS_P[p.status] || p.status)}</span><h2>${esc(p.titulo)}</h2>
  <p class="hint">${esc(p.anunciante || "")} · ${p.tipo_termo === "proprietario" ? "Autorização do proprietário" : "Parceria"} · ${p.status === "encerrado" ? "encerrado" : expirado ? "link expirado" : "válido até " + esc(fdt(p.expira))}</p>
  <div class="linkbox" id="lk">${esc(link)}</div>
  <div class="row"><button class="grow" id="cp">Copiar link</button><a class="btn grow" target="_blank" rel="noopener" href="${esc(waLink(tel, msg))}">Enviar no WhatsApp</a></div>
  <div class="row"><button class="sm" id="pdf">PDF editável</button><button class="sm" id="pr">Prorrogar 30 dias</button>${p.status !== "encerrado" ? '<button class="sm" id="enc">Encerrar</button>' : ""}${o ? '<button class="sm" id="vo">Ver oferta</button>' : ""}</div></div>
  <div class="card"><h2>Honorários</h2><p>${esc(p.comissao?.texto || "")}</p><ul class="log">${(p.comissao?.partes || []).map((x) => `<li><time>${esc(PC.nf(x.pct))}%</time><span>${esc(x.papel)}${x.nome && !PC.ehPC(x) ? " · " + esc(x.nome) : ""}</span></li>`).join("")}</ul></div>
  <div class="card"><h2>Autorização</h2>${p.aceite ? `<p><b>${esc(p.aceite.razao)}</b> · ${esc(p.aceite.documento)}${p.aceite.creci ? " · CRECI " + esc(p.aceite.creci) : ""}<br>${esc(p.aceite.responsavel)}${p.aceite.cargo ? " (" + esc(p.aceite.cargo) + ")" : ""} · ${esc(p.aceite.email)} · ${esc(p.aceite.telefone)}</p><p class="hint">Aceito em ${esc(fdt(p.aceite.em))} · IP ${esc(p.aceite.ip || "—")} · termo ${esc(p.aceite.termo_versao || "")}<br>SHA-256 ${esc((p.aceite.termo_sha256 || "").slice(0, 24))}…</p>${!ct ? '<button class="sm" id="crm">Salvar anunciante no CRM</button>' : ""}` : '<p class="empty">Ainda não autorizado.</p>'}</div>
  <div class="card"><h2>Respostas</h2>${resp.length ? resp.map((r) => `<p class="hint">${esc(fdt(r.em))}</p><ul class="log">${Object.entries(r.campos).map(([k, v]) => `<li><time>${esc((PC.CAMPOS[k] || [k])[0])}</time><span>${esc(v)}</span></li>`).join("")}</ul>`).join("") : '<p class="empty">Nenhuma resposta ainda.</p>'}
  ${o && o.revisar_anunciante ? '<p class="note">As respostas já estão na oferta, marcadas em verde. Abra a oferta, confira e salve.</p>' : ""}</div>
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
  if (u) return { nome: u.nome || e, creci: creciFmt(u.creci), whatsapp: u.telefone || "", email: u.email };
  return { nome: cfg.corretor_nome || "Rodrigo França Viana", creci: cfg.corretor_creci || "CRECI-SP 297692", whatsapp: cfg.corretor_whatsapp || "(19) 99805-1985", email: cfg.corretor_email || "contato@primecorpconsultoria.com.br" };
}
const corretorDaOferta = (o) => perfilPorEmail(o && o.origem === "Captação própria" && o.captador ? o.captador : CFG().corretor_email || "contato@primecorpconsultoria.com.br");
function trocaCorretor(txt, c) {
  if (!c || /rodrigo/i.test(c.nome || "")) return txt;
  return String(txt).split(RODRIGO_ID).join(`${String(c.nome).toUpperCase()}, corretor(a) de imóveis inscrito(a) no ${c.creci || "CRECI"}`);
}

/* ---------- Equipe e permissões (administrador) ---------- */
const EQUIPE_INICIAL = [
  { nome: "Rodrigo França Viana", email: "contato@primecorpconsultoria.com.br", creci: "CRECI-SP 297692", telefone: "(19) 99805-1985", papel: "admin", ativo: true },
  { nome: "Joselia Junqueira Viana", email: "comercial@primecorpconsultoria.com.br", creci: "CRECI-SP 300760", telefone: "(19) 99919-4447", papel: "corretor", ativo: true },
];
const idUsuario = (email) => "u_" + String(email).toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 60);
VIEWS.equipe = () => {
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
    <label>Situação<select id="ua"><option value="1" ${u.ativo !== false ? "selected" : ""}>Ativo</option><option value="0" ${u.ativo === false ? "selected" : ""}>Inativo (sem acesso)</option></select></label></div>
    <button class="p" id="us">Salvar</button><div class="status" id="ust"></div>`;
    f.scrollIntoView({ behavior: "smooth" });
    $("us").onclick = async () => {
      const email = $("ue").value.trim().toLowerCase(); const st = $("ust");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { st.className = "status err"; st.textContent = "E-mail inválido."; return; }
      if (!$("un").value.trim()) { st.className = "status err"; st.textContent = "Informe o nome."; return; }
      const reg = { ...u, id: u.id || idUsuario(email), email, nome: $("un").value.trim(), creci: creciFmt($("uc").value), telefone: $("ut").value.trim(), papel: $("up").value, ativo: $("ua").value === "1", atualizado: now(), criado: u.criado || now() };
      editing = false; try { await store.save("usuarios", reg); toast("Equipe atualizada."); VIEWS.equipe(); } catch { editing = true; }
    };
  };
  document.querySelectorAll("[data-u]").forEach((b) => (b.onclick = () => form(S.usuarios.find((x) => x.id === b.dataset.u))));
  $("novo").onclick = () => form({ papel: "corretor", ativo: true });
  const sd = $("seed"); if (sd) sd.onclick = async () => { editing = false; for (const e of faltam) await store.save("usuarios", { ...e, id: idUsuario(e.email), criado: now(), atualizado: now() }); toast("Equipe cadastrada."); VIEWS.equipe(); };
};

/* ---------- Lista de captações ---------- */
const TIPOS_CAP = ["Casa", "Casa em condomínio", "Apartamento", "Sobrado", "Cobertura", "Chácara", "Terreno", "Área / terreno", "Galpão", "Galpão em condomínio", "Sala comercial", "Loja", "Prédio comercial", "Imóvel comercial"];
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
  $("main").innerHTML = `<button class="captar-cta" id="nc"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.6"/></svg><span><b>Nova captação</b><small>Fotografe cada ambiente e fale sobre ele</small></span><span>›</span></button>
  <div class="seg">${[["minhas", "Minhas"], ["todas", "Todas"]].map(([k, l]) => `<button data-f="${k}" class="${f === k ? "on" : ""}">${l}</button>`).join("")}</div>
  <div class="card"><div class="list">${caps.map((o) => { const [cor, et] = etapaCap(o); const an = anuncioDe(o); return `<button class="item" data-c="${o.id}"><span class="dot ${cor}"></span><span class="t"><b>${esc((o.codigo ? o.codigo + " · " : "") + (o.titulo || [o.tipo, o.regiao || o.cidade].filter(Boolean).join(" · ") || "Captação sem título"))}</b><span>${esc([et, fotosDe(o) + " foto(s)", perfilPorEmail(o.captador).nome.split(" ")[0], an ? (an.visitas || 0) + " visita(s)" : ""].filter(Boolean).join(" · "))}</span></span><span>›</span></button>`; }).join("") || '<p class="empty">Nenhuma captação ainda.</p>'}</div></div>`;
  document.querySelectorAll(".seg [data-f]").forEach((x) => (x.onclick = () => { route = { v: "captar", f: x.dataset.f }; render(); }));
  document.querySelectorAll("[data-c]").forEach((x) => (x.onclick = () => go({ v: "captacao", id: x.dataset.c })));
  $("nc").onclick = async () => {
    const o = { id: uid("o"), origem: "Captação própria", status: "captacao", captador: EU.usuario || usuarioAtual?.email, tipo: "Casa", operacao: "Venda", uf: "SP", anunciante_tipo: "Proprietário",
      captacao: { iniciada: now(), ambientes: [], fala_geral: "" }, criado: now(), atualizado: now() };
    try { await store.save("ofertas", o); go({ v: "captacao", id: o.id }); } catch {}
  };
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
const camposCap = (tipo) => (PC.grupo(tipo) === "residencial" ? CAMPOS_RES : PC.grupo(tipo) === "area" ? [["terreno", "Terreno", "m²"], ["frente", "Frente", "m"], ["construida", "Construída", "m²"]] : CAMPOS_GAL);
const NUM_IA = ["dormitorios", "suites", "banheiros", "vagas", "construida", "terreno", "fabril", "pe_direito", "docas", "aluguel", "venda", "condominio", "iptu"];
function mesclarDados(o, dados) { const p = {}; Object.entries(dados || {}).forEach(([k, v]) => { if (v === null || v === undefined || v === "") return; if (NUM_IA.includes(k) && !PC.parseBR(o[k])) p[k] = fmtIn(k, Number(v)); else if (!NUM_IA.includes(k) && !String(o[k] || "").trim()) p[k] = String(v); }); return p; }

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

  const desenharNums = () => { const at = cur(); $("nums").innerHTML = camposCap(at.tipo).map(([k, l, u]) => `<label class="u">${esc(l)}<input data-c="${k}" inputmode="decimal" value="${esc(fmtIn(k, PC.parseBR(at[k])))}"><span>${esc(u)}</span></label>`).join(""); };
  const medidor = () => { const at = cur(); const cp = PC.completude(at); $("cbar").style.width = cp.pct + "%"; $("cbar").className = cp.ok ? "ok" : cp.pct >= 60 ? "mid" : ""; $("ctxt").textContent = cp.ok ? "Ficha completa." : `Ficha ${cp.pct}% · falta: ${cp.faltam.filter((f) => !f.extra).map((f) => f.rotulo).join(", ")}`; $("nf").textContent = fotosDe(at) + " foto(s)"; };
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
  const salvarFala = (id, v) => setAmbs((ambs) => { const a = ambs.find((y) => y.id === id); if (a) a.fala = v; });
  const setAmbs = async (fn) => { const at = cur(); const ambs = JSON.parse(JSON.stringify(at.captacao?.ambientes || [])); fn(ambs); return await salvar({ captacao: { ambientes: ambs } }); };
  const enviarFotos = async (files, ambId) => {
    if (!files || !files.length) return; parar();
    const prog = document.createElement("p"); prog.className = "status"; $("ambs").appendChild(prog);
    let alvo = ambId; if (!alvo) { alvo = uid("a"); await setAmbs((ambs) => ambs.push({ id: alvo, nome: "Ambiente " + (ambs.length + 1), fotos: [], fala: "", criado: now() })); desenharAmbs(); }
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
  $("camN").onchange = () => enviarFotos([...$("camN").files]); $("galN").onchange = () => enviarFotos([...$("galN").files]);
  desenharAmbs();

  // gerar anúncio
  $("ga").onclick = async () => {
    parar(); clearTimeout(tSalvar); await salvar({ ...lerCampos(), captacao: { fala_geral: $("fg").value } });
    const at = cur(); const b = $("ga"); b.disabled = true; b.textContent = "Gerando…";
    try {
      const ficha = {}; ["tipo", "operacao", "cidade", "regiao", ...NUM_IA, "iptu_periodo", "disponibilidade", "documentacao"].forEach((k) => { if (at[k]) ficha[k] = at[k]; });
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
    const link = an ? `${location.origin}/i/${an.id}` : "";
    $("fx").innerHTML = `<h2>Próximos passos</h2>
    <div class="passo ${aut ? "ok" : ""}"><b>1 · Autorização de comercialização</b>
      ${at.autorizacao ? `<p class="tag ok">Autorizado por ${esc(at.autorizacao.responsavel || at.autorizacao.razao)} em ${esc(fdt(at.autorizacao.em))}</p>` : at.autorizacao_manual ? `<p class="tag ok">Autorização por escrito fora do sistema, registrada por ${esc(at.autorizacao_manual.por)} em ${esc(fdt(at.autorizacao_manual.em))}</p>` : pedAb ? `<p class="hint">Enviada em ${esc(fdt(pedAb.criado))}: ${esc(STATUS_P[pedAb.status] || pedAb.status)}.</p><button class="sm" id="vped">Ver pedido</button>` : `<p class="hint">O proprietário recebe a ficha do imóvel e aceita a autorização pelo celular (link) ou no PDF.</p>`}
      ${!aut ? `<button class="${pedAb ? "sm" : "p"}" id="paut">${pedAb ? "Novo pedido de autorização" : "Pedir autorização ao proprietário"}</button><label class="check"><input type="checkbox" id="amanual"> O proprietário já assinou autorização por escrito (fica registrado em meu nome)</label>` : ""}</div>
    <div class="passo ${an && an.status === "ativo" ? "ok" : ""}"><b>2 · Anúncio (página para WhatsApp)</b>
      ${falta.length ? `<p class="hint">Falta: ${esc(falta.join(", "))}.</p>` : ""}
      ${an && an.status === "ativo" ? `<p class="linkbox">${esc(link)}</p><p class="hint">${an.visitas || 0} visita(s) · publicado em ${esc(fdt(an.publicado_em))}${an.atualizado_em ? " · atualizado " + esc(fdt(an.atualizado_em)) : ""}</p>
        <div class="row"><a class="btn sm p" target="_blank" rel="noopener" href="${esc(waLink("", `${at.titulo}\n${link}`))}">Enviar no WhatsApp</a><button class="sm" id="cpl">Copiar link</button><a class="btn sm" href="${esc(link)}" target="_blank" rel="noopener">Ver página</a></div>
        <div class="row"><button class="sm" id="pub">Atualizar página</button><button class="sm g" id="enc">Encerrar anúncio</button></div>`
      : `<button class="p" id="pub" ${falta.length || !aut ? "disabled" : ""}>Publicar anúncio</button>${!aut ? '<p class="hint">Publica depois da autorização do proprietário.</p>' : ""}`}</div>
    <div class="passo ${at.status !== "captacao" ? "ok" : ""}"><b>3 · Banco de ofertas</b>
      ${at.status === "captacao" ? `<p class="hint">Entra no cruzamento com os briefings e no ranking.</p><button id="conc">Concluir captação e enviar ao banco</button>` : `<p class="tag ok">No banco de ofertas${at.codigo ? " como " + esc(at.codigo) : ""}.</p>`}
      <div class="row"><button class="sm" id="pdfc">Ficha PDF</button><button class="sm" id="vof">Abrir como oferta</button></div></div>`;
    const paut = $("paut"); if (paut) paut.onclick = async () => { parar(); clearTimeout(tSalvar); await salvar({ ...lerCampos(), anunciante_tipo: "Proprietário" }); editing = false; go({ v: "novopedido", o: at.id }); };
    const am = $("amanual"); if (am) am.onchange = async () => { if (!am.checked) return; await salvar({ autorizacao_manual: { em: now(), por: EU.usuario || usuarioAtual?.email } }, "Autorização registrada."); passos(); };
    const vp = $("vped"); if (vp) vp.onclick = () => { editing = false; go({ v: "pedido", id: pedAb.id }); };
    const pub = $("pub"); if (pub) pub.onclick = publicar;
    const cpl = $("cpl"); if (cpl) cpl.onclick = () => copiar(link);
    const enc = $("enc"); if (enc) confirmar2(enc, "Toque de novo para encerrar", async () => { await store.save("anuncios", { ...an, status: "encerrado", encerrado_em: now() }); toast("Anúncio encerrado."); passos(); });
    const cc = $("conc"); if (cc) cc.onclick = async () => { const cod = await garantirCodigo(cur()); await salvar({ status: "revisada", codigo: cod, captacao: { concluida: now() } }, "Captação no banco de ofertas como " + cod + "."); header("Captação " + cod); passos(); };
    $("pdfc").onclick = async () => { clearTimeout(tSalvar); await salvar(lerCampos()); await gerarPDF(cur(), { semTermo: true }); };
    $("vof").onclick = () => { parar(); editing = false; go({ v: "oferta", id: at.id }); };
  };
  const publicar = async () => {
    clearTimeout(tSalvar); await salvar(lerCampos());
    const at = cur(); const d = PC.num(at); const codigo = await garantirCodigo(at); const a2 = cur();
    const res = PC.grupo(d.tipo) === "residencial";
    const fatos = (res ? [[d.construida && PC.m2(d.construida), "Área útil"], [d.dormitorios && PC.nf(d.dormitorios) + (d.suites ? ` (${PC.nf(d.suites)} suíte${d.suites > 1 ? "s" : ""})` : ""), "Dormitórios"], [d.banheiros && PC.nf(d.banheiros), "Banheiros"], [d.vagas && PC.nf(d.vagas), "Vagas"], [d.terreno && PC.m2(d.terreno), "Terreno"]]
      : [[d.construida && PC.m2(d.construida), "Área construída"], [d.fabril && PC.m2(d.fabril), "Galpão"], [d.terreno && PC.m2(d.terreno), "Terreno"], [d.pe_direito && PC.nf(d.pe_direito) + " m", "Pé-direito"], [d.docas && PC.nf(d.docas), "Docas"], [d.energia_kva && PC.nf(d.energia_kva) + " kVA", "Energia"]]).filter((x) => x[0]).map(([v, l]) => [l, v]);
    const valores = [[d.venda && PC.brl(d.venda), "Venda"], [d.aluguel && PC.brl(d.aluguel) + "/mês", "Aluguel"], [d.condominio && PC.brl(d.condominio) + "/mês", "Condomínio"], [d.iptu && PC.brl(d.iptu) + (d.iptu_periodo === "anual" ? "/ano" : d.iptu_periodo === "mensal" ? "/mês" : ""), "IPTU"]].filter((x) => x[0]).map(([v, l]) => [l, v]);
    const ambs = a2.captacao?.ambientes || []; let fotos = ambs.flatMap((a) => (a.fotos || []).map((f) => ({ k: f.k, ambiente: a.nome })));
    const ci = fotos.findIndex((f) => f.k === a2.capa); if (ci > 0) fotos = [fotos[ci], ...fotos.slice(0, ci), ...fotos.slice(ci + 1)];
    const ant = anuncioDe(a2); const token = ant ? ant.id : tokenAleatorio(22);
    const reg = { ...(ant || {}), id: token, oferta: a2.id, status: "ativo", codigo, tipo: a2.tipo, operacao: a2.operacao, cidade: a2.cidade, regiao: a2.regiao, titulo: a2.titulo, subtitulo: a2.subtitulo || "", descricao: a2.descricao, destaques: PC.lines(a2.diferenciais).slice(0, 10), fatos, valores, fotos: fotos.slice(0, 60), ambientes: ambs.map((a) => ({ nome: a.nome, descricao: a.descricao || "" })), corretor: corretorDaOferta(a2), publicado_em: ant?.publicado_em || now(), atualizado_em: ant ? now() : null, visitas: ant?.visitas || 0 };
    try {
      await store.save("anuncios", reg);
      await salvar({ anuncio_token: token, status: a2.status === "captacao" ? "revisada" : a2.status, codigo });
      await emitir({ tipo: "anuncio_publicado", oferta_id: a2.id, destinatario: "Página pública", conteudo: `${location.origin}/i/${token}\n${a2.titulo} · ${fotos.length} foto(s) · ${corretorDaOferta(a2).nome}`, meta: { token, atualizacao: !!ant } });
      toast(ant ? "Página atualizada." : "Anúncio publicado."); header("Captação " + codigo); passos();
    } catch {}
  };
  medidor(); passos();
};

/* ---------- Anúncios publicados ---------- */
VIEWS.anuncios = (recarregado) => {
  header("Anúncios publicados");
  if (recarregado !== true) store.carregar().then(() => { if (route.v === "anuncios") VIEWS.anuncios(true); }).catch(() => {});
  const as = [...S.anuncios].sort((a, b) => (b.publicado_em || "").localeCompare(a.publicado_em || ""));
  $("main").innerHTML = `<div class="card"><div class="list">${as.map((a) => `<div class="item"><span class="dot ${a.status === "ativo" ? "verde" : ""}"></span><span class="t"><b>${esc((a.codigo ? a.codigo + " · " : "") + a.titulo)}</b><span>${esc([a.status === "ativo" ? "No ar" : "Encerrado", (a.visitas || 0) + " visita(s)", (a.fotos || []).length + " foto(s)", a.corretor?.nome?.split(" ")[0], fdt(a.publicado_em)].filter(Boolean).join(" · "))}</span></span>${a.status === "ativo" ? `<a class="btn sm" target="_blank" rel="noopener" href="/i/${esc(a.id)}">Ver</a>` : ""}<button class="sm" data-oc="${esc(a.oferta)}">Abrir</button></div>`).join("") || '<p class="empty">Nenhum anúncio publicado. Publique a partir de uma captação.</p>'}</div></div>`;
  document.querySelectorAll("[data-oc]").forEach((b) => (b.onclick = () => go({ v: "captacao", id: b.dataset.oc })));
};

iniciar();
