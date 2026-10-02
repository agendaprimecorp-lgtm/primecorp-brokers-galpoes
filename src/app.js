import PC from "../shared/core.mjs";
import { jsPDF } from "jspdf";
import { handleAuthCallback, getUser, login, logout, acceptInvite, updateUser, requestPasswordRecovery } from "@netlify/identity";
import { TERMO_PADRAO, TERMO_VERSAO } from "./termo.js";

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
const S = { briefings: [], ofertas: [], negocios: [], contatos: [], salas: [], config: [] };
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
  try { await store.carregar(); }
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
const TOP = ["painel", "briefings", "ofertas", "contatos", "mais"];
const TABS = [
  ["painel", "Painel", '<path d="M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z"/>'],
  ["briefings", "Briefings", '<path d="M8 4h8v3H8zM6 6H4v15h16V6h-2M8 12h8M8 16h5"/>'],
  ["ofertas", "Ofertas", '<path d="M3 21V9l9-6 9 6v12H3zM9 21v-6h6v6"/>'],
  ["contatos", "CRM", '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.8.8 3 2.5 3.5 5.2"/>'],
  ["mais", "Mais", '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>'],
];
const PAI = { briefing: "briefings", editb: "briefings", teaser: "briefings", novasala: "briefings", oferta: "ofertas", nova: "ofertas", negocio: "painel", contato: "contatos", editc: "contatos", sala: "mais", salas: "mais", relatorios: "mais", backup: "mais", config: "mais" };
function renderTabs() {
  const cur = TOP.includes(route.v) ? route.v : PAI[route.v] || "";
  $("tabs").className = "tabs-in c5";
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
  if (editing && ["editb", "oferta", "teaser", "nova", "editc", "novasala", "config"].includes(route.v)) return;
  try { (VIEWS[route.v] || VIEWS.painel)(); }
  catch (e) { console.error(e); $("main").innerHTML = `<div class="card"><p class="status err">Erro ao exibir esta tela: ${esc(e.message)}</p></div>`; }
}

/* ================= Helpers de domínio ================= */
const B = (id) => S.briefings.find((x) => x.id === id);
const O = (id) => S.ofertas.find((x) => x.id === id);
const N = (id) => S.negocios.find((x) => x.id === id);
const C = (id) => S.contatos.find((x) => x.id === id);
function hist(excl) { return S.ofertas.filter((x) => x.id !== excl && x.status !== "descartada").map((x) => { const d = PC.num(x); return { id: x.id, cidade: d.cidade, fabril: d.fabril, construida: d.construida, titulo: x.titulo || PC.autoTitle(d), quando: x.criado ? new Date(x.criado).toLocaleDateString("pt-BR") : "" }; }); }
const chkOf = (o) => PC.checks(PC.num(o), hist(o.id));
const tituloO = (o) => o.titulo || PC.autoTitle(PC.num(o));
const nomeB = (b) => (b ? b.nome || "Briefing sem nome" : "(briefing removido)");
const nomeC = (c) => (c ? c.nome || c.empresa || "Contato sem nome" : "");
const etapaNome = (e) => (PC.ETAPAS.find((x) => x[0] === e) || [0, e === "perdido" ? "Perdido" : e])[1];
function fmtIn(f, v) {
  if (v === null || v === undefined || v === "") return "";
  if (Array.isArray(v)) return v.join("\n");
  if (typeof v === "number") { const money = ["aluguel", "venda", "condominio", "iptu"].includes(f); return PC.nf(v, money ? (Number.isInteger(v) ? 0 : 2) : undefined); }
  return String(v);
}
const OF_FIELDS = ["tipo", "operacao", "cidade", "uf", "regiao", "subtitulo", "tipologia", "fabril", "construida", "terreno", "administrativo", "apoio", "pe_direito", "piso_carga", "docas", "energia_kva", "pontes", "avcb", "data_anuncio", "aluguel", "venda", "condominio", "iptu", "iptu_periodo", "titulo", "descricao", "diferenciais", "itens"];
function fromAI(o) { const r = {}; OF_FIELDS.forEach((f) => { if (o[f] !== undefined && o[f] !== null) r[f] = fmtIn(f, o[f]); }); return r; }
function ranking(b) { return S.ofertas.filter((o) => o.status !== "descartada").map((o) => { const c = chkOf(o); return Object.assign({ o, c }, PC.score(o, b, c)); }).sort((x, y) => y.score - x.score); }
function faixaArea(b) { const n = PC.numB(b); if (n.areaMin && n.areaMax) return PC.nf(n.areaMin) + " a " + PC.nf(n.areaMax) + " m²"; if (n.areaMin) return "a partir de " + PC.nf(n.areaMin) + " m²"; if (n.areaMax) return "até " + PC.nf(n.areaMax) + " m²"; return ""; }
function confirmar2(btn, txt, fn) { let armed = false; btn.onclick = async () => { if (!armed) { armed = true; btn.dataset.orig = btn.textContent; btn.textContent = txt; setTimeout(() => { armed = false; if (btn.isConnected) btn.textContent = btn.dataset.orig; }, 4000); return; } btn.disabled = true; try { await fn(); } finally { btn.disabled = false; } }; }

/* ================= PAINEL ================= */
VIEWS.painel = () => {
  header(usuarioAtual?.email || "");
  const abertos = S.negocios.filter((n) => n.etapa !== "perdido" && n.etapa !== "fechado");
  const ativos = S.briefings.filter((b) => (b.status || "ativo") === "ativo");
  const novas = S.ofertas.filter((o) => o.status === "nova");
  const salasNovas = S.salas.filter((s) => s.aceite && !s.visto_aceite).length + S.salas.reduce((a, s) => a + (s.interesses || []).filter((i) => !(s.vistos || []).includes(i.codigo)).length, 0);
  const cols = PC.ETAPAS.filter(([k]) => S.negocios.some((n) => n.etapa === k)).map(([k, l]) => {
    const ns = S.negocios.filter((n) => n.etapa === k).sort((a, b) => (b.atualizado || "").localeCompare(a.atualizado || ""));
    return `<div class="col"><h3><span>${l}</span><span class="muted">${ns.length}</span></h3>${ns.map((n) => { const o = O(n.oferta), b = B(n.briefing); return `<button class="deal" data-n="${n.id}"><b>${esc(o ? (o.codigo ? o.codigo + " · " : "") + tituloO(o) : "(oferta removida)")}</b><span>${esc(nomeB(b))}${n.parceiro ? " · " + esc(n.parceiro) : ""}</span></button>`; }).join("")}</div>`;
  }).join("");
  $("main").innerHTML = `
  <div class="kpis"><div class="kpi"><b>${ativos.length}</b><span>Briefings ativos</span></div><div class="kpi"><b>${S.ofertas.filter((o) => o.status !== "descartada").length}</b><span>Ofertas na base</span></div><div class="kpi"><b>${abertos.length}</b><span>Negócios abertos</span></div></div>
  ${novas.length ? `<button class="card" id="gonovas" style="text-align:left;cursor:pointer;flex-direction:row;align-items:center"><span class="dot amarelo"></span><span style="flex:1"><b>${novas.length} oferta${novas.length > 1 ? "s" : ""} a revisar</b><br><span class="hint">Confira os dados antes de cruzar com os briefings.</span></span><span>›</span></button>` : ""}
  ${salasNovas ? `<button class="card" id="gosalas" style="text-align:left;cursor:pointer;flex-direction:row;align-items:center"><span class="dot verde"></span><span style="flex:1"><b>${salasNovas} novidade(s) nas Salas do Cliente</b><br><span class="hint">Aceites de termo e interesses registrados.</span></span><span>›</span></button>` : ""}
  <div class="card"><div class="row" style="justify-content:space-between"><h2>Negócios</h2><button class="sm" id="csv">Exportar CSV</button></div>
  ${cols ? `<div class="kanban">${cols}</div>` : '<p class="empty">Nenhum negócio aberto. Abra um briefing, escolha uma oferta do ranking e envie o teaser ou crie uma Sala do Cliente.</p>'}
  ${S.negocios.some((n) => n.etapa === "perdido") ? `<p class="hint">${S.negocios.filter((n) => n.etapa === "perdido").length} negócio(s) perdido(s) fora do quadro.</p>` : ""}</div>
  <div class="row"><button class="grow" id="qnova">+ Nova oferta</button><button class="grow" id="qbrief">+ Novo briefing</button></div>
  <p class="foot">PrimeCorp Brokers · Rodrigo França Viana · CRECI-SP 297692</p>`;
  document.querySelectorAll("[data-n]").forEach((b) => (b.onclick = () => go({ v: "negocio", id: b.dataset.n })));
  const gn = $("gonovas"); if (gn) gn.onclick = () => go({ v: "ofertas", f: "nova" }, false);
  const gs = $("gosalas"); if (gs) gs.onclick = () => go({ v: "salas" });
  $("csv").onclick = exportCSV;
  $("qnova").onclick = () => go({ v: "nova" });
  $("qbrief").onclick = () => go({ v: "editb", id: null });
};
async function exportCSV() {
  const q = (s) => '"' + String(s == null ? "" : s).replace(/"/g, '""') + '"';
  const L = [["Negócio", "Etapa", "Briefing", "Código", "Oferta", "Cidade", "Parceiro/Cliente", "Telefone", "Data", "Evento"].map(q).join(";")];
  S.negocios.forEach((n) => { const o = O(n.oferta), b = B(n.briefing);
    (n.log && n.log.length ? n.log : [{ t: n.criado, ev: "" }]).forEach((e) => L.push([n.id, etapaNome(n.etapa), nomeB(b), o ? o.codigo || "" : "", o ? tituloO(o) : "", o ? o.cidade : "", n.parceiro, n.tel, fdt(e.t), e.ev].map(q).join(";"))); });
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
const CF = [["nome", "Nome", "text", "full"], ["empresa", "Empresa", "text", ""], ["tipo", "Tipo", "sel:" + TIPOS_C.join("|"), ""], ["documento", "CNPJ / CPF / CRECI", "text", ""], ["cargo", "Cargo", "text", ""], ["telefone", "WhatsApp", "tel", ""], ["email", "E-mail", "text", ""], ["cidade", "Cidade", "text", ""], ["origem", "Como chegou", "text", ""], ["obs", "Observações", "area", "full"]];
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
  ${n.teaser ? `<div class="card"><h3>Teaser enviado</h3><pre class="wa">${esc(n.teaser)}</pre></div>` : ""}`;
  const save = async (patch, ev) => { const atual = N(n.id) || n; try { await store.save("negocios", { ...atual, ...patch, atualizado: now(), log: [...(atual.log || []), { t: now(), ev }] }); } catch {} };
  document.querySelectorAll("[data-e]").forEach((x) => (x.onclick = () => { if (x.dataset.e === n.etapa) return; save({ etapa: x.dataset.e }, "Etapa: " + etapaNome(x.dataset.e)); }));
  $("add").onclick = () => { const t = $("nt").value.trim(); if (t) save({}, t); };
  $("lost").onclick = () => (perdido ? save({ etapa: n.etapa_ant || "teaser" }, "Negócio reaberto") : save({ etapa: "perdido", etapa_ant: n.etapa }, "Marcado como perdido"));
  const vo = $("vo"); if (vo) vo.onclick = () => go({ v: "oferta", id: o.id });
  $("pdf").onclick = async () => { const r = await gerarPDF(o, { negocio: n, briefing: b, destinatario: n.parceiro }); if (r) save({}, `Ficha PDF emitida (${r})`); };
};

/* ================= OFERTAS ================= */
VIEWS.ofertas = () => {
  header("Ofertas"); const f = route.f || "todas";
  let os = [...S.ofertas].sort((a, b) => (b.criado || "").localeCompare(a.criado || ""));
  if (f === "nova") os = os.filter((o) => o.status === "nova"); else if (f === "descartada") os = os.filter((o) => o.status === "descartada"); else os = os.filter((o) => o.status !== "descartada");
  $("main").innerHTML = `<button class="p" id="nv">+ Nova oferta</button><div class="seg">${[["todas", "Ativas"], ["nova", "A revisar"], ["descartada", "Descartadas"]].map(([k, l]) => `<button data-f="${k}" class="${f === k ? "on" : ""}">${l}</button>`).join("")}</div>
  <input id="q" placeholder="Buscar por código, cidade, tipo ou título" value="${esc(route.q || "")}">
  <div class="card"><div class="list" id="ls"></div></div>`;
  const draw = () => { const q = PC.norm($("q").value); const rows = os.filter((o) => !q || PC.norm([o.codigo, tituloO(o), o.cidade, o.tipo, o.regiao, o.origem].join(" ")).includes(q));
    $("ls").innerHTML = rows.map((o) => { const c = chkOf(o); return `<button class="item" data-o="${o.id}"><span class="dot ${c.sem}"></span><span class="t"><b>${esc((o.codigo ? o.codigo + " · " : "") + tituloO(o))}</b><span>${esc([o.cidade, o.origem, o.status === "nova" ? "a revisar" : ""].filter(Boolean).join(" · "))}</span></span><span class="chip">${esc(o.operacao || "")}</span></button>`; }).join("") || '<p class="empty">Nada por aqui.</p>';
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
<label>Anunciante<input data-f="anunciante"></label><label>Contato do anunciante<input data-f="anunciante_contato" type="tel"></label>
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
<label class="u">Apoio / outros<input data-f="apoio" inputmode="decimal"><span>m²</span></label></div></fieldset>
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
<label class="full">IPTU é<select data-f="iptu_periodo"><option value="">Periodicidade não informada</option><option value="mensal">Mensal</option><option value="anual">Anual</option></select></label></div></fieldset>
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
  $("main").innerHTML = `<div class="card" id="fo">${OFORM}</div>
  <div class="card"><h2>Checagem</h2><div class="sem" id="sem"><i></i><div><span id="semT"></span><small id="semS"></small></div></div><div class="priv" id="priv" hidden></div><ul class="alerts" id="al"></ul><p class="hint">O semáforo fica só aqui. Na ficha, os alertas viram “itens a confirmar”.</p></div>
  <div class="card"><div class="row"><button class="p grow" id="sv">Salvar</button><button class="grow" id="pdf">Ficha PDF</button></div><div id="pdfnote"></div>
  ${o.link ? `<a class="btn sm" href="${esc(o.link)}" target="_blank" rel="noopener">Abrir anúncio original</a>` : ""}<button class="g" id="del">Excluir oferta</button></div>`;
  const root = $("fo"); fillForm(root, o); editing = true;
  const upd = () => { const cur = { ...o, ...readForm(root) }; const c = chkOf(cur);
    $("sem").className = "sem " + c.sem; $("semT").textContent = SEM[c.sem][0]; $("semS").textContent = SEM[c.sem][1];
    $("al").innerHTML = c.alerts.map((a) => `<li class="${a.lvl}">${esc(a.msg)}</li>`).join("") || '<li class="ok">Dados completos e coerentes.</li>';
    $("priv").hidden = !c.privacy; $("priv").textContent = c.privacy || ""; root.querySelector('[data-f="titulo"]').placeholder = PC.autoTitle(PC.num(cur)); return cur; };
  upd(); root.addEventListener("input", () => { clearTimeout(upd._t); upd._t = setTimeout(upd, 200); }); root.addEventListener("change", upd);
  $("sv").onclick = async () => { const cur = upd(); const st = cur.status === "nova" ? "revisada" : cur.status; editing = false; try { await store.save("ofertas", { ...cur, status: st, atualizado: now() }); toast("Oferta salva" + (o.status === "nova" ? " e marcada como revisada." : ".")); back(); } catch { editing = true; } };
  let armed = false;
  $("pdf").onclick = async () => {
    const neg = S.negocios.find((n) => n.oferta === o.id && PC.etapaIdx(n.etapa) >= PC.etapaIdx("termo"));
    if (!neg && !armed) { armed = true; $("pdfnote").innerHTML = '<p class="note">Ficha é nível 2: envie só a quem assinou o termo. Toque de novo para gerar mesmo assim (fica registrado como emissão sem termo).</p>'; $("pdf").textContent = "Gerar mesmo assim"; return; }
    const cur = upd(); editing = false; try { await store.save("ofertas", { ...cur, atualizado: now() }); } catch { editing = true; return; }
    await gerarPDF(O(o.id), { negocio: neg || null, semTermo: !neg });
  };
  confirmar2($("del"), "Toque de novo para excluir", async () => { editing = false; await store.del("ofertas", o.id); back(); });
};
async function gerarPDF(o, ctx = {}) {
  try {
    const codigo = await garantirCodigo(o); const atual = O(o.id) || { ...o, codigo };
    const d = { ...PC.num(atual), codigo }; const chk = PC.checks(PC.num(atual), hist(atual.id));
    const doc = PC.pdf(jsPDF, d, chk, LOGOS.dark ? LOGOS : null);
    const blob = doc.output("blob"); const nome = PC.filename(d).replace(/\.pdf$/, `_${codigo}.pdf`);
    const em = await emitir({ tipo: "ficha_pdf", oferta_id: atual.id, negocio_id: ctx.negocio?.id || null, briefing_id: ctx.negocio?.briefing || null, contato_id: ctx.negocio?.contato || null, destinatario: ctx.destinatario || ctx.negocio?.parceiro || "", nome_arquivo: nome, pdf_base64: await blobToBase64(blob), conteudo: tituloO(atual), meta: { codigo, sem_termo: !!ctx.semTermo } });
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
  <button id="m1">Nova oferta <span>›</span></button><button id="m2">Salas do Cliente <span>›</span></button><button id="m3">Relatórios emitidos <span>›</span></button><button id="m4">Backup <span>›</span></button><button id="m5">Configurações <span>›</span></button><button id="m6">Sair <span>›</span></button></div></div>
  <p class="foot">Conectado como ${esc(usuarioAtual?.email || "")}</p>`;
  $("m1").onclick = () => go({ v: "nova" }); $("m2").onclick = () => go({ v: "salas" }); $("m3").onclick = () => go({ v: "relatorios" });
  $("m4").onclick = () => go({ v: "backup" }); $("m5").onclick = () => go({ v: "config" });
  $("m6").onclick = async () => { try { await logout(); } catch {} telaLogin("Você saiu."); };
};
const TIPOS_E = { teaser: "Teaser", ficha_pdf: "Ficha PDF", sala: "Sala criada", aceite: "Aceite de termo", interesse: "Interesse", coleta: "Coleta de alertas", restauracao: "Restauração" };
VIEWS.relatorios = async () => {
  header("Relatórios emitidos"); $("main").innerHTML = `<div class="card"><p class="hint">Carregando…</p></div>`;
  let em = []; try { em = (await api("emissoes?limite=500")).emissoes; } catch (e) { $("main").innerHTML = `<div class="card"><p class="status err">${esc(e.message)}</p></div>`; return; }
  if (route.v !== "relatorios") return;
  const f = route.f || "todos";
  const lista = em.filter((e) => f === "todos" || e.tipo === f);
  $("main").innerHTML = `<select id="ft"><option value="todos">Todos os tipos</option>${Object.entries(TIPOS_E).map(([k, l]) => `<option value="${k}" ${k === f ? "selected" : ""}>${l}</option>`).join("")}</select>
  <div class="card"><div class="list">${lista.map((e, i) => { const o = O(e.oferta_id); return `<details class="item" style="display:block;cursor:pointer"><summary style="display:flex;gap:10px;align-items:center;list-style:none"><span class="tag ${e.tipo === "aceite" || e.tipo === "interesse" ? "ok" : e.tipo === "ficha_pdf" ? "r" : ""}">${esc(TIPOS_E[e.tipo] || e.tipo)}</span><span class="t"><b>${esc(e.codigo)}${o ? " · " + esc((o.codigo ? o.codigo + " " : "") + tituloO(o)) : ""}</b><span>${esc(fdt(e.criado_em))}${e.destinatario ? " · " + esc(e.destinatario) : ""}${e.meta && e.meta.sem_termo ? " · SEM TERMO" : ""}</span></span></summary>
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
  <button class="p" id="sv">Salvar configurações</button><div class="status" id="st"></div></div>
  <div class="card"><h2>Coleta automática de alertas</h2><div id="cs"><p class="hint">Verificando…</p></div></div>`;
  editing = true;
  $("sv").onclick = async () => { const v = readK($("fc")); const rev = $("rv").checked;
    if (rev && v.termo.includes("[__")) { $("st").className = "status err"; $("st").textContent = "O termo ainda tem campos [__] sem preencher."; return; }
    editing = false; try { await store.save("config", { ...c, id: "geral", ...v, termo_revisado: rev, atualizado: now() }); toast("Configurações salvas."); } catch { editing = true; } };
  try { const s = await api("status"); if (!$("cs")) return;
    $("cs").innerHTML = s.coleta_configurada ? `<p>Caixa de alertas: <b>${esc(s.caixa_alertas)}</b>. A coleta roda a cada 30 minutos.</p><button class="sm" id="rc">Coletar agora</button><div class="status" id="rcs"></div>` : `<p class="hint">Ainda não configurada. Crie um Gmail só para alertas, ative a verificação em duas etapas, gere uma senha de app e cadastre no Netlify as variáveis ALERTAS_IMAP_USER, ALERTAS_IMAP_SENHA e COLETA_SEGREDO (veja o guia de publicação).</p>`;
    const rc = $("rc"); if (rc) rc.onclick = async () => { rc.disabled = true; try { await api("coleta", { method: "POST" }); $("rcs").textContent = "Coleta iniciada. As ofertas aparecem em “A revisar” em alguns minutos."; } catch (e) { $("rcs").className = "status err"; $("rcs").textContent = e.message; } };
  } catch {}
};

iniciar();
