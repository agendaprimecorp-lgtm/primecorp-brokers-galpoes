// Propto · app do usuário (PWA). Captação guiada, anúncio, landing, PDF e exportação.
import { handleAuthCallback, getUser, login, logout, signup, requestPasswordRecovery, updateUser } from "@netlify/identity";
import { zipSync, strToU8 } from "fflate";
import { tratarFoto, blobB64 } from "../../src/foto.js";
import { vozDisponivel, ditar } from "../../src/voz.js";
import { TIPOS, grupo, roteiroFotos, roteiroDados, progresso } from "../shared/roteiro.mjs";
import { PLANOS, UFS, TIPOS_CONTA } from "../shared/planos.mjs";
import { xmlVRSync, csvImovel, textoImovel, nomeFoto } from "../shared/exporta.mjs";
import { gerarPDF } from "./pdf.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const brl = (v) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const soDig = (s) => String(s || "").replace(/\D/g, "");
let EU = null; let rota = { v: "inicio" };
const toast = (m) => { const t = $("toast"); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3200); };
class ErroAPI extends Error { constructor(m, s, x) { super(m); this.status = s; this.extra = x; } }
async function api(caminho, opts = {}) {
  const r = await fetch("/api/" + caminho, { credentials: "same-origin", ...opts, headers: { "content-type": "application/json", ...(opts.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { telaEntrar("Sua sessão expirou. Entre de novo."); throw new ErroAPI("Sessão expirada", 401); }
  if (!r.ok) throw new ErroAPI(j.erro || "Erro " + r.status, r.status, j);
  return j;
}
const POST = (c, b) => api(c, { method: "POST", body: JSON.stringify(b || {}) });
const PUT = (c, b) => api(c, { method: "PUT", body: JSON.stringify(b || {}) });
const baixar = (blob, nome) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nome; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); };
async function compartilharOuBaixar(blob, nome, texto) {
  const f = new File([blob], nome, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f], title: nome, text: texto || "" }); return; } catch (e) { if (e.name === "AbortError") return; } }
  baixar(blob, nome);
}
const ICON = {
  inicio: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  captar: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  planos: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/>',
  conta: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  admin: '<path d="M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7z"/>',
};
function abas() {
  const t = $("tabs"); const L = [["inicio", "Início"], ["captar", "Captar"], ["planos", "Planos"], ["conta", "Conta"], ...(EU?.admin ? [["admin", "Admin"]] : [])];
  t.hidden = false; t.innerHTML = L.map(([k, l]) => `<button data-tab="${k}" class="${rota.v === k || (k === "captar" && rota.v === "cap") ? "on" : ""}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">${ICON[k]}</svg>${l}</button>`).join("");
  t.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => ir({ v: b.dataset.tab })));
}
function ir(r) { rota = r; try { history.replaceState(null, "", "#" + r.v + (r.id ? "/" + r.id : "")); } catch {} render(); window.scrollTo(0, 0); }
async function render() { abas(); try { await (VIEWS[rota.v] || VIEWS.inicio)(); } catch (e) { if (e.status !== 401) $("main").innerHTML = `<div class="card"><p class="status err">${esc(e.message)}</p><button id="rt">Tentar de novo</button></div>`, ($("rt").onclick = render); } }
async function carregarEu() { EU = await api("eu"); $("quem").textContent = EU.conta ? EU.conta.nome : EU.email; return EU; }

/* ================= Entrar / criar conta ================= */
function telaEntrar(msg, modo = "entrar") {
  $("tabs").hidden = true; $("quem").textContent = "";
  $("main").innerHTML = `<div class="entrar card">
  <h1>${modo === "criar" ? "Crie sua conta" : "Entrar no Propto"}</h1>
  <p class="hint">Visita terminou, anúncio pronto. Fotos guiadas, voz e IA no seu celular.</p>
  <div class="seg"><button data-m="entrar" class="${modo === "entrar" ? "on" : ""}">Entrar</button><button data-m="criar" class="${modo === "criar" ? "on" : ""}">Criar conta</button></div>
  <label>E-mail<input id="em" type="email" autocomplete="email" inputmode="email"></label>
  <label>Senha<input id="se" type="password" autocomplete="${modo === "criar" ? "new-password" : "current-password"}" placeholder="${modo === "criar" ? "mínimo 8 caracteres" : ""}"></label>
  <button class="p" id="ok">${modo === "criar" ? "Criar conta" : "Entrar"}</button>
  ${modo === "entrar" ? '<button class="g" id="esq">Esqueci a senha</button>' : '<p class="hint">Depois de criar, confirme pelo link que enviaremos ao seu e-mail.</p>'}
  <p class="status ${msg && /erro|inválid|não/i.test(msg) ? "err" : ""}" id="st">${esc(msg || "")}</p></div>`;
  document.querySelectorAll("[data-m]").forEach((b) => (b.onclick = () => telaEntrar("", b.dataset.m)));
  const st = $("st");
  $("ok").onclick = async () => {
    const e = $("em").value.trim(), s = $("se").value;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { st.className = "status err"; st.textContent = "E-mail inválido."; return; }
    if (modo === "criar" && s.length < 8) { st.className = "status err"; st.textContent = "A senha precisa de pelo menos 8 caracteres."; return; }
    $("ok").disabled = true; st.className = "status"; st.textContent = "Aguarde…";
    try {
      if (modo === "criar") { await signup(e, s); st.className = "status ok"; st.textContent = "Conta criada. Abra o e-mail de confirmação e toque no link para entrar."; return; }
      await login(e, s); await iniciar();
    } catch (err) { st.className = "status err"; st.textContent = /confirm/i.test(err.message) ? "Confirme seu e-mail antes de entrar." : modo === "criar" ? "Não foi possível criar a conta: " + err.message : "E-mail ou senha incorretos."; }
    finally { const b = $("ok"); if (b) b.disabled = false; }
  };
  const q = $("esq"); if (q) q.onclick = async () => { const e = $("em").value.trim(); if (!e) { st.textContent = "Digite seu e-mail acima."; return; } try { await requestPasswordRecovery(e); } catch {} st.className = "status ok"; st.textContent = "Se o e-mail estiver cadastrado, você receberá o link para criar uma nova senha."; };
}
function telaNovaSenha() {
  $("main").innerHTML = `<div class="entrar card"><h1>Nova senha</h1><label>Nova senha<input id="se" type="password" autocomplete="new-password"></label><button class="p" id="ok">Salvar</button><p class="status" id="st"></p></div>`;
  $("ok").onclick = async () => { const s = $("se").value; if (s.length < 8) { $("st").textContent = "Mínimo 8 caracteres."; return; } try { await updateUser({ password: s }); toast("Senha alterada."); iniciar(); } catch (e) { $("st").className = "status err"; $("st").textContent = e.message; } };
}

/* ================= Cadastro: o sistema reconhece o tipo de cliente ================= */
function telaCadastro() {
  $("tabs").hidden = true; let tipo = EU.convite ? "membro" : "";
  const desenhar = () => {
    const creci = tipo === "corretor" || tipo === "imobiliaria" || tipo === "membro";
    $("main").innerHTML = `<div class="card"><span class="k">Cadastro</span><h1>${EU.convite ? `Você foi convidado(a) por ${esc(EU.convite.org)}` : "Como você vai usar o Propto?"}</h1>
    ${EU.convite ? '<p class="hint">Sua conta usa o plano da imobiliária. Complete seus dados.</p>' : `<div class="contas">${Object.entries(TIPOS_CONTA).map(([k, t]) => `<button data-t="${k}" class="${tipo === k ? "on" : ""}"><b>${esc(t.nome)}</b><span>${k === "corretor" ? "Tenho CRECI (pessoa física). Planos mensais ou avulso." : k === "imobiliaria" ? "Tenho CRECI de pessoa jurídica. Planos para a equipe." : "Quero anunciar meu imóvel. Pago por anúncio e posso contar com um corretor parceiro."}</span></button>`).join("")}</div>`}</div>
    ${tipo ? `<div class="card"><div class="grid">
      <label class="full">${tipo === "imobiliaria" ? "Nome do responsável" : "Nome completo"}<input id="nm" autocomplete="name"></label>
      ${tipo === "imobiliaria" ? '<label class="full">Razão social<input id="rz" autocomplete="organization"></label>' : ""}
      ${tipo !== "membro" ? `<label>${tipo === "imobiliaria" ? "CNPJ" : "CPF"}<input id="doc" inputmode="numeric"></label>` : ""}
      <label>WhatsApp<input id="tel" type="tel" autocomplete="tel" placeholder="(19) 99999-0000"></label>
      ${creci ? `<label>CRECI${tipo === "membro" ? " (se tiver)" : ""}<input id="cn" inputmode="numeric" placeholder="${tipo === "imobiliaria" ? "ex.: 12345-J" : "só os números"}"></label><label>UF do CRECI<select id="cu">${UFS.map((u) => `<option ${u === "SP" ? "selected" : ""}>${u}</option>`).join("")}</select></label>` : ""}
      </div>
      ${creci && tipo !== "membro" ? '<p class="hint">Vamos conferir sua inscrição no CRECI e avisar se houver pendência. Você pode usar o app enquanto conferimos.</p>' : ""}
      ${tipo === "proprietario" ? '<p class="hint">Sem CRECI você anuncia o próprio imóvel. Se quiser, nossos corretores parceiros cuidam da venda ou locação (honorários de 6% na venda ou 1 aluguel na locação, só se fechar negócio).</p>' : ""}
      <label class="check"><input type="checkbox" id="ac"> <span>Li e aceito os <a href="/termos.html" target="_blank" rel="noopener">Termos de Uso e a Política de Privacidade</a>.</span></label>
      <button class="p" id="sv">Concluir cadastro</button><p class="status" id="st"></p></div>` : ""}`;
    document.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => { tipo = b.dataset.t; desenhar(); }));
    const sv = $("sv"); if (!sv) return;
    sv.onclick = async () => {
      const v = (id) => ($(id) ? $(id).value.trim() : "");
      const body = { tipo: tipo === "membro" ? undefined : tipo, nome: v("nm"), razao: v("rz"), documento: v("doc"), telefone: v("tel"), aceite_termos: $("ac").checked, creci: v("cn") ? { numero: v("cn"), uf: v("cu") } : undefined };
      sv.disabled = true; $("st").className = "status"; $("st").textContent = "Salvando…";
      try { await POST("cadastro", body); await iniciar(); toast("Bem-vindo(a) ao Propto!"); } catch (e) { $("st").className = "status err"; $("st").textContent = e.message; sv.disabled = false; }
    };
  };
  desenhar();
}

/* ================= Avisos de conta (CRECI e pagamento) ================= */
function avisosHTML() {
  const c = EU.conta, o = EU.org, ac = EU.acesso; const L = [];
  const cr = c.creci;
  if (cr && cr.situacao === "em_verificacao") L.push(`<div class="aviso info"><b>${esc(cr.formatado)} em verificação.</b><span>Pode usar o app normalmente. ${cr.doc_k ? "Documento recebido." : "Para agilizar, envie a foto da carteira ou a certidão em Conta."}</span></div>`);
  if (cr && ["inativo", "suspenso", "cancelado", "nao_encontrado"].includes(cr.situacao)) L.push(`<div class="aviso err" id="avcreci"><b>Pendência no ${esc(cr.formatado)}: ${esc({ inativo: "inscrição inativa", suspenso: "inscrição suspensa", cancelado: "inscrição cancelada", nao_encontrado: "inscrição não localizada" }[cr.situacao])}.</b><span>${esc(cr.obs || "")} Enquanto a situação não for regularizada, seus anúncios saem sem número de CRECI. Regularize no CRECI da sua região e nos avise em Conta.</span>${cr.ciente_em ? `<small>Ciência registrada em ${new Date(cr.ciente_em).toLocaleDateString("pt-BR")}.</small>` : '<button class="sm d" id="ciente">Estou ciente</button>'}</div>`);
  if (cr && cr.situacao === "ativo" && cr.verificado_em) L.push(`<div class="aviso ok"><b>${esc(cr.formatado)} ativo.</b><span>Conferido em ${new Date(cr.verificado_em).toLocaleDateString("pt-BR")}.</span></div>`);
  if (o.status === "atrasada" && ac.motivo === "carencia") L.push(`<div class="aviso warn"><b>Pagamento em atraso.</b><span>Regularize para não ter o acesso bloqueado.</span>${o.fatura_url && EU.conta.papel === "dono" ? `<a href="${esc(o.fatura_url)}" target="_blank" rel="noopener">Abrir fatura</a>` : ""}</div>`);
  if (!ac.pode && ac.motivo !== "sem_plano") L.push(`<div class="aviso ${ac.motivo === "pendente" ? "info" : "err"}"><b>${esc(ac.mensagem)}</b>${o.fatura_url && EU.conta.papel === "dono" ? `<a href="${esc(o.fatura_url)}" target="_blank" rel="noopener">Abrir fatura</a>` : ""}</div>`);
  return L.join("");
}
function ligarAvisos() { const b = $("ciente"); if (b) b.onclick = async () => { await POST("creci/ciente"); await carregarEu(); render(); }; }

const VIEWS = {};
/* ================= Início ================= */
VIEWS.inicio = async () => {
  await carregarEu(); const ac = EU.acesso;
  const { captacoes } = await api("captacoes");
  const plano = PLANOS[EU.org.plano];
  $("main").innerHTML = `${avisosHTML()}
  <button class="cta" id="nova" ${ac.pode ? "" : 'data-bloq="1"'}><img src="/marca/propto-symbol-negative.svg" alt=""><span><b>Nova captação</b><small>${ac.pode ? (ac.restante != null && plano?.ciclo === "mensal" && ac.motivo !== "credito" ? `${ac.restante} captação(ões) disponíveis no mês` : ac.motivo === "credito" ? `${EU.org.creditos} anúncio(s) avulso(s) disponível(is)` : "Roteiro guiado de fotos, voz e anúncio") : "Escolha um plano ou o avulso para captar"}</small></span></button>
  <div class="card"><div class="row"><h2 class="grow">Seus imóveis</h2><span class="tag">${captacoes.length}</span></div>
  <div class="list">${captacoes.map((c) => `<button class="item" data-c="${c.id}"><span class="t"><b>${esc(c.titulo || `${c.tipo || "Imóvel"}${c.cidade ? " em " + c.cidade : ""}`)}</b><span>${esc([c.codigo, c.operacao, c.anuncio?.ativo ? `no ar · ${c.anuncio.visitas} visita(s)` : c.status === "rascunho" ? "em captação" : c.status, !c.minha ? "equipe" : ""].filter(Boolean).join(" · "))}</span></span><span class="pct">${c.pct}%</span></button>`).join("") || '<p class="hint">Nenhum imóvel ainda. Toque em <b>Nova captação</b> e siga o roteiro: o app diz quais fotos tirar e quais dados pedir.</p>'}</div></div>
  <div class="card"><h3>Instale no celular</h3><p class="hint">No Android: menu do navegador → <b>Instalar app</b>. No iPhone: Compartilhar → <b>Adicionar à Tela de Início</b>.</p></div>`;
  ligarAvisos();
  $("nova").onclick = () => (ac.pode ? ir({ v: "captar" }) : ir({ v: "planos" }));
  document.querySelectorAll("[data-c]").forEach((b) => (b.onclick = () => ir({ v: "cap", id: b.dataset.c })));
};

/* ================= Nova captação ================= */
VIEWS.captar = async () => {
  if (!EU?.acesso?.pode) { await carregarEu(); if (!EU.acesso.pode) return ir({ v: "planos" }); }
  let tipo = "", op = "Venda";
  const desenhar = () => {
    $("main").innerHTML = `<div class="card"><span class="k">Nova captação</span><h1>Que imóvel é?</h1>
    <div class="tipos">${TIPOS.map((t) => `<button data-t="${esc(t)}" class="${tipo === t ? "on" : ""}">${esc(t)}</button>`).join("")}</div>
    <label>Operação<select id="op">${["Venda", "Locação", "Venda e locação"].map((o) => `<option ${o === op ? "selected" : ""}>${o}</option>`).join("")}</select></label>
    <button class="p" id="go" ${tipo ? "" : "disabled"}>Começar o roteiro</button>
    <p class="hint">${EU.acesso.motivo === "credito" ? "Isto usa 1 anúncio avulso." : ""}</p><p class="status" id="st"></p></div>`;
    document.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => { tipo = b.dataset.t; op = $("op").value; desenhar(); }));
    $("op").onchange = () => (op = $("op").value);
    $("go").onclick = async () => {
      $("go").disabled = true;
      try { const r = await POST("captacoes", { tipo, operacao: op === "Venda e locação" ? "Venda / Locação" : op }); await carregarEu(); ir({ v: "cap", id: r.id }); }
      catch (e) { $("st").className = "status err"; $("st").textContent = e.message; if (e.status === 402) setTimeout(() => ir({ v: "planos" }), 1800); }
    };
  };
  desenhar();
};

/* ================= Captação (roteiro guiado) ================= */
VIEWS.cap = async () => {
  const { captacao, anuncio_publicado } = await api("captacoes/" + rota.id);
  const C = captacao; C.dados = C.dados || {}; C.ambientes = C.ambientes || []; C.anuncio = C.anuncio || {};
  let passo = rota.passo || "fotos"; let pub = anuncio_publicado;
  let tSalvar = null; const salvar = (ja) => { clearTimeout(tSalvar); const f = async () => { try { const r = await PUT("captacoes/" + C.id, { dados: C.dados, ambientes: C.ambientes, anuncio: C.anuncio, fala_geral: C.fala_geral || "" }); const pg = $("pg"); if (pg) { pg.querySelector("i").style.width = r.progresso.pct + "%"; $("pgt").textContent = r.progresso.pct + "% do roteiro"; } } catch (e) { toast("Não salvou: " + e.message); } }; if (ja) return f(); tSalvar = setTimeout(f, 700); };
  const contato = () => { const c = EU.conta; const cr = c.creci; const ok = cr && ["ativo", "em_verificacao"].includes(cr.situacao); return C.intermediacao?.status === "aceita" ? null : { nome: c.nome, creci: ok ? cr.formatado : "", titulo: c.tipo === "proprietario" ? "Proprietário(a)" : ok ? "Corretor(a) de Imóveis" : "", whatsapp: c.whatsapp, email: c.email, cor: c.cor }; };
  const fotosTodas = () => { const L = []; for (const a of C.ambientes) for (const f of a.fotos || []) L.push({ k: f.k, ambiente: a.nome }); return L; };
  let gravando = null;

  const desenhar = () => {
    const pg = progresso(C); const d = C.dados;
    const head = `<div class="card"><span class="k">${esc([C.codigo, d.tipo, d.operacao].join(" · "))}</span><h2>${esc(C.anuncio.titulo || `${d.tipo}${d.cidade ? " em " + d.cidade : ""}`)}</h2>
      <div class="barra" id="pg"><i style="width:${pg.pct}%"></i></div><span class="hint" id="pgt">${pg.pct}% do roteiro</span>
      <div class="passos">${[["fotos", "1 · Fotos"], ["dados", "2 · Dados"], ["anuncio", "3 · Anúncio"], ["entregar", "4 · Entregar"]].map(([k, l]) => `<button data-p="${k}" class="${passo === k ? "on" : ""}">${l}</button>`).join("")}</div></div>`;
    let corpo = "";
    if (passo === "fotos") {
      const rot = roteiroFotos(d.tipo, d); const extras = C.ambientes.filter((a) => !a.roteiro || !rot.some((r) => r.id === a.roteiro));
      corpo = `<div class="card"><h3>Roteiro de fotos</h3><p class="hint">Siga a lista: o app trata luz e cor, avisa foto escura ou tremida e a IA descreve cada ambiente. Toque em <b>Falar</b> para contar o que vê.</p>
      ${rot.map((r) => itemRoteiro(r, C.ambientes.find((a) => a.roteiro === r.id))).join("")}
      ${extras.map((a) => itemRoteiro({ id: a.roteiro || a.id, nome: a.nome, dica: "Ambiente extra", obrigatorio: false, extra: true }, a)).join("")}
      <button id="extra">+ Ambiente extra</button>
      <input type="file" id="cam" accept="image/*" capture="environment" multiple hidden></div>`;
    } else if (passo === "dados") {
      const campos = roteiroDados(d.tipo, d.operacao);
      corpo = `<div class="card"><h3>Dados do imóvel</h3><div class="grid">${campos.map(([k, l, u]) => campoHTML(k, l, u, d[k])).join("")}</div></div>
      <div class="card"><h3>Privado (não sai no anúncio)</h3><div class="grid"><label class="full">Endereço completo<input data-k="endereco" value="${esc(d.endereco || "")}"></label>${EU.conta.tipo !== "proprietario" ? `<label>Proprietário<input data-k="proprietario" value="${esc(d.proprietario || "")}"></label><label>Telefone do proprietário<input data-k="proprietario_tel" type="tel" value="${esc(d.proprietario_tel || "")}"></label>` : ""}<label class="full">Observações internas<textarea data-k="obs" rows="2">${esc(d.obs || "")}</textarea></label></div></div>`;
    } else if (passo === "anuncio") {
      const a = C.anuncio;
      corpo = `<div class="card"><h3>Fala geral (opcional)</h3><p class="hint">Conte o que o comprador precisa saber: diferenciais, reformas, vizinhança.</p><textarea id="fg" rows="3">${esc(C.fala_geral || "")}</textarea>${vozDisponivel() ? '<button class="mic" id="micg">🎤 Falar</button>' : '<p class="hint">Use o microfone do teclado para ditar.</p>'}
      <button class="p" id="gerar">${a.titulo ? "Gerar de novo com a IA" : "Gerar anúncio com a IA"}</button><p class="status" id="sta"></p></div>
      <div class="card"><h3>Anúncio</h3><label>Título<input id="at" value="${esc(a.titulo || "")}" maxlength="90"></label><label>Subtítulo<input id="as" value="${esc(a.subtitulo || "")}" maxlength="110"></label><label>Descrição<textarea id="ad" rows="8">${esc(a.descricao || "")}</textarea></label><label>Destaques (um por linha)<textarea id="ah" rows="4">${esc((a.destaques || []).join("\n"))}</textarea></label>
      ${(a.pendencias || []).length ? `<div class="aviso warn"><b>Ainda falta informar:</b><span>${a.pendencias.map(esc).join(" · ")}</span></div>` : ""}</div>`;
    } else {
      const ok = pg.ok && C.anuncio.titulo; const prop = EU.conta.tipo === "proprietario";
      corpo = `<div class="card"><h3>Checklist</h3>${pg.ok ? '<div class="aviso ok"><b>Roteiro completo.</b></div>' : `<div class="aviso warn"><b>Falta para completar:</b><span>${[...pg.faltamFotos.map((f) => "foto: " + f.nome), ...pg.faltamDados.map((x) => x.rotulo)].map(esc).join(" · ")}</span></div>`}
      ${C.anuncio.titulo ? "" : '<div class="aviso warn"><b>Gere o anúncio no passo 3.</b></div>'}</div>
      <div class="card"><h3>Página do anúncio (landing)</h3>
      ${pub && pub.ativo ? `<p class="hint">No ar · ${pub.visitas} visita(s)</p><div class="linkbox" id="lk">${esc(location.origin + "/a/" + pub.token)}</div>
        <div class="acoes"><button id="cp">Copiar link</button><button id="wa">WhatsApp</button><button id="em">E-mail</button></div><div class="acoes"><button id="rep">Atualizar página</button><button class="g" id="des">Tirar do ar</button></div>`
        : `<label class="check"><input type="checkbox" id="decl"> <span>${prop ? "Sou o proprietário deste imóvel (ou estou autorizado por ele) e as informações são verdadeiras." : "Tenho autorização do proprietário para divulgar este imóvel e as informações conferem."}</span></label><button class="p" id="pub" ${C.anuncio.titulo ? "" : "disabled"}>Publicar página</button>`}
      <p class="status" id="stp"></p></div>
      <div class="card"><h3>Apresentação em PDF</h3><p class="hint">Capa com foto, ficha técnica e fotos por ambiente, com seus dados de contato.</p><div class="acoes"><button id="pdf" ${C.anuncio.titulo ? "" : "disabled"}>Gerar PDF</button></div><p class="status" id="stf"></p></div>
      <div class="card"><h3>Levar para o sistema da imobiliária</h3><p class="hint">Pacote .zip com as fotos nomeadas por ambiente, <b>imovel.xml</b> no padrão VRSync (o mesmo dos portais ZAP/OLX, aceito por muitos sistemas de imobiliária), <b>imovel.csv</b> para planilha e <b>anuncio.txt</b> para colar.</p><button id="zip" ${C.anuncio.titulo ? "" : "disabled"}>Exportar pacote</button><p class="status" id="stz"></p></div>
      ${prop ? `<div class="card"><h3>Quer um corretor cuidando da venda?</h3>${C.intermediacao ? `<div class="aviso ${C.intermediacao.status === "aceita" ? "ok" : "info"}"><b>${esc({ solicitada: "Pedido enviado. Um corretor da PrimeCorp Brokers vai falar com você.", em_contato: "Em contato com você.", aceita: "Intermediação contratada: o anúncio mostra o contato do corretor responsável.", recusada: "Pedido não aceito desta vez." }[C.intermediacao.status] || C.intermediacao.status)}</b></div>` : `<p class="hint">A PrimeCorp Brokers (corretores com CRECI) confere a documentação, divulga, atende interessados e acompanha até a escritura. Honorários só se fechar negócio: <b>6% do valor da venda</b> ou <b>1 aluguel</b> na locação, com contrato de autorização assinado por você.</p><button class="d" id="inter">Quero um corretor parceiro</button>`}</div>` : ""}`;
    }
    $("main").innerHTML = head + corpo;
    document.querySelectorAll("[data-p]").forEach((b) => (b.onclick = () => { if (gravando) gravando.parar(); passo = b.dataset.p; rota.passo = passo; desenhar(); window.scrollTo(0, 0); }));
    ligar();
  };
  const itemRoteiro = (r, a) => {
    const fotos = a?.fotos || []; const ok = fotos.length > 0;
    return `<div class="rot ${ok ? "ok" : ""}" data-r="${esc(r.id)}"><div class="cab"><span class="ic">${ok ? "✓" : ""}</span><b>${esc(a?.nome && r.extra ? a.nome : r.nome)} ${r.obrigatorio ? '<span class="obr">obrigatória</span>' : ""}</b>${ok ? `<small>${fotos.length} foto(s)</small>` : ""}</div>
    ${ok ? "" : `<p class="hint">${esc(r.dica)}</p>`}
    ${ok ? `<div class="thumbs">${fotos.map((f, i) => `<div class="th"><img loading="lazy" src="/api/foto?k=${encodeURIComponent(f.k)}" alt=""><button data-del="${i}" aria-label="Remover foto">×</button></div>`).join("")}</div>` : ""}
    ${a?.descricao ? `<p class="desc">${esc(a.descricao)}</p>` : ""}${(a?.problemas || []).length ? `<p class="probs">⚠ ${a.problemas.map(esc).join(" · ")}</p>` : ""}
    ${a?.fala ? `<p class="hint">🎤 “${esc(a.fala)}”</p>` : ""}
    <div class="acoes"><button class="${ok ? "" : "p"}" data-foto="${esc(r.id)}">📷 ${ok ? "Mais fotos" : "Fotografar"}</button><button class="mic" data-mic="${esc(r.id)}">🎤 Falar</button></div><p class="status" data-st="${esc(r.id)}"></p></div>`;
  };
  const campoHTML = (k, l, u, v) => u === "txt" ? `<label class="${/document|disponib|benfeit|aptid|agua/.test(k) ? "full" : ""}">${esc(l)}<input data-k="${k}" value="${esc(v || "")}"></label>` : `<label class="u">${esc(l)}<input data-k="${k}" inputmode="decimal" value="${esc(v || "")}">${u !== "n" ? `<span class="un">${esc(u)}</span>` : ""}</label>`;
  const ambDe = (rid) => { const r = roteiroFotos(C.dados.tipo, C.dados).find((x) => x.id === rid); let a = C.ambientes.find((x) => x.roteiro === rid); if (!a) { a = { id: "a" + Date.now().toString(36), roteiro: rid, nome: r ? r.nome : "Ambiente extra", fotos: [] }; C.ambientes.push(a); } return a; };
  async function iaAmbiente(a, st, minis = []) {
    if (st) { st.className = "status"; st.textContent = "IA organizando o ambiente…"; }
    try {
      const r = await POST("ia/ambiente", { captacao: C.id, item: a.nome, fala: a.fala || "", imagens: minis });
      a.descricao = r.descricao || a.descricao; a.caracteristicas = r.caracteristicas || []; a.problemas = r.foto && r.foto.ok === false ? r.foto.problemas || [] : [];
      if (a.roteiro?.startsWith("x") && r.ambiente) a.nome = r.ambiente;
      for (const [k, v] of Object.entries(r.dados || {})) if (v != null && (C.dados[k] == null || C.dados[k] === "")) C.dados[k] = String(v);
      await salvar(true); desenhar();
    } catch (e) { if (st) { st.className = "status err"; st.textContent = "IA indisponível agora: " + e.message; } }
  }
  function ligar() {
    if (passo === "fotos") {
      const cam = $("cam"); let alvo = null;
      document.querySelectorAll("[data-foto]").forEach((b) => (b.onclick = () => { alvo = b.dataset.foto; cam.value = ""; cam.click(); }));
      cam.onchange = async () => {
        const files = [...cam.files].slice(0, 6); if (!files.length || !alvo) return;
        const a = ambDe(alvo); const st = document.querySelector(`[data-st="${CSS.escape(alvo)}"]`); const minis = []; const avisos = [];
        for (const [i, f] of files.entries()) {
          if (st) st.textContent = `Tratando foto ${i + 1} de ${files.length}…`;
          try { const t = await tratarFoto(f); const up = await POST("fotos", { captacao: C.id, jpeg_base64: await blobB64(t.blob) }); a.fotos.push({ k: up.k, w: t.w, h: t.h, avisos: t.avisos }); minis.push(t.mini); avisos.push(...t.avisos); }
          catch (e) { toast("Foto não enviada: " + e.message); }
        }
        await salvar(true); desenhar();
        if (avisos.length) toast([...new Set(avisos)].join(" "));
        iaAmbiente(a, document.querySelector(`[data-st="${CSS.escape(alvo)}"]`), minis.slice(0, 3));
      };
      document.querySelectorAll("[data-mic]").forEach((b) => (b.onclick = () => {
        const rid = b.dataset.mic; const a = ambDe(rid);
        if (gravando) { gravando.parar(); gravando = null; return; }
        if (!vozDisponivel()) { toast("Seu navegador não tem ditado: use o microfone do teclado na descrição."); return; }
        b.classList.add("on"); b.textContent = "■ Parar";
        let texto = a.fala ? a.fala + " " : "";
        gravando = ditar({ aoTexto: (t) => { texto += t + " "; }, aoParcial: () => {}, aoFim: async () => { gravando = null; a.fala = texto.trim(); await salvar(true); if (a.fala) iaAmbiente(a, document.querySelector(`[data-st="${CSS.escape(rid)}"]`)); else desenhar(); }, aoErro: (e) => { gravando = null; toast(e === "not-allowed" ? "Permita o microfone nas configurações do navegador." : "Ditado indisponível."); desenhar(); } });
      }));
      document.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => { const rid = b.closest("[data-r]").dataset.r; const a = C.ambientes.find((x) => x.roteiro === rid); const f = a.fotos.splice(Number(b.dataset.del), 1)[0]; api("foto?k=" + encodeURIComponent(f.k), { method: "DELETE" }).catch(() => {}); await salvar(true); desenhar(); }));
      $("extra").onclick = () => { const id = "x" + Date.now().toString(36); C.ambientes.push({ id, roteiro: id, nome: "Ambiente extra", fotos: [] }); salvar(); desenhar(); };
    }
    if (passo === "dados") document.querySelectorAll("[data-k]").forEach((el) => el.addEventListener("input", () => { C.dados[el.dataset.k] = el.value; salvar(); }));
    if (passo === "anuncio") {
      const ler = () => { C.anuncio = { ...C.anuncio, titulo: $("at").value.trim(), subtitulo: $("as").value.trim(), descricao: $("ad").value.trim(), destaques: $("ah").value.split("\n").map((x) => x.trim()).filter(Boolean) }; C.fala_geral = $("fg").value; salvar(); };
      ["at", "as", "ad", "ah", "fg"].forEach((id) => $(id).addEventListener("input", ler));
      const mg = $("micg"); if (mg) mg.onclick = () => { if (gravando) { gravando.parar(); return; } mg.classList.add("on"); mg.textContent = "■ Parar"; gravando = ditar({ aoTexto: (t) => { $("fg").value = ($("fg").value + " " + t).trim(); ler(); }, aoFim: () => { gravando = null; mg.classList.remove("on"); mg.textContent = "🎤 Falar"; }, aoErro: () => { gravando = null; mg.classList.remove("on"); mg.textContent = "🎤 Falar"; } }); };
      $("gerar").onclick = async () => { const b = $("gerar"); b.disabled = true; $("sta").className = "status"; $("sta").textContent = "Escrevendo o anúncio (10 a 30 s)…"; await salvar(true);
        try { const r = await POST("ia/anuncio", { captacao: C.id }); C.anuncio = { titulo: r.titulo || "", subtitulo: r.subtitulo || "", descricao: r.descricao || "", destaques: r.destaques || [], pendencias: r.pendencias || [] }; await salvar(true); desenhar(); toast("Anúncio pronto. Revise e ajuste o que quiser."); }
        catch (e) { $("sta").className = "status err"; $("sta").textContent = e.message; b.disabled = false; } };
    }
    if (passo === "entregar") {
      const link = () => location.origin + "/a/" + pub.token;
      const pb = $("pub"); if (pb) pb.onclick = async () => { if (!$("decl").checked) { $("stp").className = "status err"; $("stp").textContent = "Marque a declaração para publicar."; return; } pb.disabled = true; try { await salvar(true); const r = await POST("publicar/" + C.id, { declaracao: true }); pub = { token: r.token, ativo: true, visitas: 0 }; desenhar(); toast("Página publicada."); } catch (e) { $("stp").className = "status err"; $("stp").textContent = e.message; pb.disabled = false; } };
      const rep = $("rep"); if (rep) rep.onclick = async () => { await salvar(true); await POST("publicar/" + C.id, { declaracao: true }); toast("Página atualizada."); };
      const des = $("des"); if (des) des.onclick = async () => { await api("publicar/" + C.id, { method: "DELETE" }); pub = { ...pub, ativo: false }; desenhar(); };
      const cp = $("cp"); if (cp) cp.onclick = async () => { try { await navigator.clipboard.writeText(link()); toast("Link copiado."); } catch { const s = getSelection(); const r = document.createRange(); r.selectNodeContents($("lk")); s.removeAllRanges(); s.addRange(r); toast("Selecionado: copie."); } };
      const wa = $("wa"); if (wa) wa.onclick = () => window.open("https://wa.me/?text=" + encodeURIComponent(`${C.anuncio.titulo}\n${link()}`), "_blank");
      const em = $("em"); if (em) em.onclick = () => (location.href = `mailto:?subject=${encodeURIComponent(C.anuncio.titulo)}&body=${encodeURIComponent(textoImovel(C, { codigo: C.codigo }) + "\n\n" + link())}`);
      const fotosBlobs = async (st) => { const L = fotosTodas(); const out = []; for (const [i, f] of L.entries()) { if (st) st.textContent = `Baixando fotos ${i + 1}/${L.length}…`; const r = await fetch("/api/foto?k=" + encodeURIComponent(f.k), { credentials: "same-origin" }); if (r.ok) out.push({ ...f, blob: await r.blob() }); } return out; };
      const contatoPDF = () => contato() || { nome: "PrimeCorp Brokers", titulo: "Corretor parceiro", cor: EU.conta.cor };
      const pdf = $("pdf"); if (pdf) pdf.onclick = async () => { pdf.disabled = true; const st = $("stf"); st.className = "status"; try { const fb = await fotosBlobs(st); st.textContent = "Montando o PDF…"; const doc = await gerarPDF(C, fb, contatoPDF()); const nome = `${C.codigo}_${(C.dados.tipo || "imovel").replace(/\W+/g, "_")}.pdf`; await compartilharOuBaixar(doc.output("blob"), nome, C.anuncio.titulo); st.className = "status ok"; st.textContent = "PDF gerado: " + nome; } catch (e) { st.className = "status err"; st.textContent = e.message; } finally { pdf.disabled = false; } };
      const zb = $("zip"); if (zb) zb.onclick = async () => { zb.disabled = true; const st = $("stz"); st.className = "status"; try {
        const fb = await fotosBlobs(st); const cont = { ...(contato() || {}), telefone: EU.conta.whatsapp }; const cnt = {}; const arqs = {}; const fotosRef = [];
        fb.forEach((f, i) => { cnt[f.ambiente] = (cnt[f.ambiente] || 0) + 1; const n = nomeFoto(i + 1, f.ambiente, cnt[f.ambiente]); arqs["fotos/" + n] = f; fotosRef.push({ url: pub?.ativo ? `${location.origin}/a/${pub.token}/f/${i}.jpg` : "fotos/" + n, legenda: f.ambiente }); });
        const z = { "imovel.xml": strToU8(xmlVRSync(C, { fotos: fotosRef, contato: cont, codigo: C.codigo })), "imovel.csv": strToU8(csvImovel(C, { codigo: C.codigo, fotos: fotosRef })), "anuncio.txt": strToU8(textoImovel(C, { codigo: C.codigo })) };
        for (const [n, f] of Object.entries(arqs)) z[n] = [new Uint8Array(await f.blob.arrayBuffer()), { level: 0 }];
        st.textContent = "Compactando…"; const out = zipSync(z); const nome = `${C.codigo}_pacote.zip`; await compartilharOuBaixar(new Blob([out], { type: "application/zip" }), nome); st.className = "status ok"; st.textContent = `Pacote gerado: ${nome} (${fb.length} fotos)`;
      } catch (e) { st.className = "status err"; st.textContent = e.message; } finally { zb.disabled = false; } };
      const it = $("inter"); if (it) it.onclick = async () => { it.disabled = true; try { await POST("intermediacao/" + C.id, {}); C.intermediacao = { status: "solicitada" }; desenhar(); toast("Pedido enviado."); } catch (e) { toast(e.message); it.disabled = false; } };
    }
  }
  desenhar();
};

/* ================= Planos e pagamento ================= */
VIEWS.planos = async () => {
  await carregarEu(); const o = EU.org, c = EU.conta; const dono = c.papel === "dono";
  const lista = c.tipo === "proprietario" ? ["avulso"] : c.tipo === "imobiliaria" ? ["imob5", "imob10", "avulso"] : c.papel === "membro" ? [] : ["autonomo", "avulso"];
  $("main").innerHTML = `${avisosHTML()}<div class="card"><span class="k">Planos</span><h1>${o.plano ? `Seu plano: ${esc(PLANOS[o.plano].nome)}` : "Escolha como usar"}</h1>
  ${o.plano ? `<p class="hint">Situação: <span class="tag ${o.status === "ativa" ? "ok" : o.status === "atrasada" ? "warn" : "err"}">${esc({ ativa: "em dia", atrasada: "em atraso", pendente: "aguardando pagamento", cancelada: "cancelada", bloqueada: "bloqueada" }[o.status] || o.status)}</span>${o.proximo_vencimento ? ` · próximo vencimento ${new Date(o.proximo_vencimento + "T12:00").toLocaleDateString("pt-BR")}` : ""} · ${EU.uso_mes} captação(ões) neste mês</p>` : ""}
  ${o.creditos ? `<p class="hint">${o.creditos} anúncio(s) avulso(s) disponível(is).</p>` : ""}
  ${c.papel === "membro" ? '<p class="hint">Sua conta usa o plano da imobiliária. Fale com o responsável.</p>' : ""}</div>
  <div class="planos">${lista.map((k) => { const p = PLANOS[k]; const atual = o.plano === k && ["ativa", "atrasada", "pendente"].includes(o.status); return `<div class="plano ${atual ? "atual" : ""}"><b>${esc(p.nome)}</b><div class="preco">${brl(p.preco)} <small>${p.ciclo === "mensal" ? "/mês" : "por anúncio"}</small></div><p class="hint">${esc(p.desc)}</p>${dono ? `<button class="${atual ? "" : "p"}" data-plano="${k}" ${atual && o.status !== "pendente" ? "disabled" : ""}>${atual ? (o.status === "pendente" ? "Pagar agora" : "Plano atual") : k === "avulso" ? "Comprar 1 anúncio" : o.plano && PLANOS_MENSAL(o.plano) ? "Mudar para este" : "Assinar"}</button>` : ""}</div>`; }).join("")}</div>
  <div class="card"><p class="hint">Pagamento por Pix, boleto ou cartão. A assinatura renova todo mês e pode ser cancelada quando quiser; após ${5} dias de atraso o acesso para novas captações é bloqueado, mas seus anúncios e arquivos continuam disponíveis.</p>${dono && o.plano && ["ativa", "atrasada", "pendente"].includes(o.status) ? '<button class="g" id="canc">Cancelar assinatura</button>' : ""}<p class="status" id="st"></p></div>`;
  ligarAvisos();
  document.querySelectorAll("[data-plano]").forEach((b) => (b.onclick = async () => {
    const k = b.dataset.plano; b.disabled = true; $("st").className = "status"; $("st").textContent = "Gerando a cobrança…";
    try { const r = k === "avulso" ? await POST("avulso") : await POST("assinar", { plano: k }); if (r.url) { $("st").innerHTML = `Abrindo o pagamento… <a href="${esc(r.url)}" target="_blank" rel="noopener">abrir</a>`; location.href = r.url; } else { await carregarEu(); render(); } }
    catch (e) { $("st").className = "status err"; $("st").textContent = e.message; b.disabled = false; }
  }));
  const cc = $("canc"); if (cc) { let arm = false; cc.onclick = async () => { if (!arm) { arm = true; cc.textContent = "Toque de novo para confirmar o cancelamento"; return; } await POST("cancelar"); toast("Assinatura cancelada."); render(); }; }
};
const PLANOS_MENSAL = (k) => PLANOS[k]?.ciclo === "mensal";

/* ================= Conta, CRECI e equipe ================= */
VIEWS.conta = async () => {
  await carregarEu(); const c = EU.conta;
  $("main").innerHTML = `${avisosHTML()}<div class="card"><span class="k">${esc(TIPOS_CONTA[c.tipo]?.nome || "Conta")}${c.papel === "membro" ? " · equipe" : ""}</span><h2>${esc(c.nome)}</h2><p class="hint">${esc(c.email)}</p>
  <div class="grid"><label class="full">Nome que aparece nos anúncios<input id="nm" value="${esc(c.nome)}"></label><label>WhatsApp dos anúncios<input id="wh" type="tel" value="${esc(c.whatsapp || "")}"></label><label>Cor da sua marca<input id="cor" type="color" value="${esc(c.cor || "#CC1B1B")}"></label></div>
  <button class="p" id="svp">Salvar</button><p class="status" id="stp"></p></div>
  ${c.tipo !== "proprietario" ? `<div class="card"><h3>CRECI</h3>${c.creci ? `<p><b>${esc(c.creci.formatado)}</b> <span class="tag ${c.creci.situacao === "ativo" ? "ok" : c.creci.situacao === "em_verificacao" ? "" : "err"}">${esc({ em_verificacao: "em verificação", ativo: "ativo", inativo: "inativo", suspenso: "suspenso", cancelado: "cancelado", nao_encontrado: "não localizado" }[c.creci.situacao])}</span></p>` : '<p class="hint">Nenhum CRECI informado.</p>'}
  <div class="grid"><label>Número<input id="cn" value="${esc(c.creci?.numero || "")}"></label><label>UF<select id="cu">${UFS.map((u) => `<option ${u === (c.creci?.uf || "SP") ? "selected" : ""}>${u}</option>`).join("")}</select></label></div>
  <label>Carteira ou certidão (foto ou PDF)<input type="file" id="cd" accept="image/jpeg,application/pdf"></label><button id="svc">Enviar para conferência</button><p class="status" id="stc"></p></div>` : ""}
  ${c.tipo === "imobiliaria" && c.papel === "dono" ? `<div class="card"><h3>Equipe</h3><p class="hint">Convide corretores e captadores pelo e-mail. Eles criam a conta no Propto com esse e-mail e entram direto na sua equipe.</p><div id="eq" class="list"></div><div class="row"><input id="ce" type="email" class="grow" placeholder="email@corretor.com"><button id="cv">Convidar</button></div><p class="status" id="ste"></p></div>` : ""}
  <div class="card"><button id="sair">Sair</button></div>`;
  ligarAvisos();
  $("svp").onclick = async () => { try { await PUT("perfil", { nome: $("nm").value, whatsapp: $("wh").value, cor: $("cor").value }); $("stp").className = "status ok"; $("stp").textContent = "Salvo."; await carregarEu(); } catch (e) { $("stp").className = "status err"; $("stp").textContent = e.message; } };
  const svc = $("svc"); if (svc) svc.onclick = async () => { const st = $("stc"); st.className = "status"; try {
    if ($("cn").value.trim()) await PUT("perfil", { creci: { numero: $("cn").value, uf: $("cu").value } });
    const f = $("cd").files[0]; if (f) { if (f.size > 5e6) throw new Error("Arquivo maior que 5 MB."); let b64; if (f.type === "application/pdf") b64 = await blobB64(f); else { const t = await tratarFoto(f, { lado: 1600, tratar: false }); b64 = await blobB64(t.blob); } await POST("creci/documento", { base64: b64 }); }
    st.className = "status ok"; st.textContent = "Recebido. Vamos conferir e avisar aqui."; await carregarEu(); setTimeout(render, 900);
  } catch (e) { st.className = "status err"; st.textContent = e.message; } };
  if ($("eq")) {
    const eq = async () => { const r = await api("equipe"); $("eq").innerHTML = r.membros.map((m) => `<div class="item"><span class="t"><b>${esc(m.nome || m.email)}</b><span>${esc([m.email, m.creci, m.dono ? "responsável" : ""].filter(Boolean).join(" · "))}</span></span>${m.dono ? "" : `<button class="sm g" data-rm="${esc(m.email)}">Remover</button>`}</div>`).join("") + r.convites.map((x) => `<div class="item"><span class="t"><b>${esc(x.email)}</b><span>convite pendente</span></span><button class="sm g" data-rm="${esc(x.email)}">Cancelar</button></div>`).join(""); document.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = async () => { await api("equipe?email=" + encodeURIComponent(b.dataset.rm), { method: "DELETE" }); eq(); })); };
    eq(); $("cv").onclick = async () => { try { await POST("equipe", { email: $("ce").value }); $("ce").value = ""; $("ste").className = "status ok"; $("ste").textContent = "Convite registrado. Envie o link " + location.origin + "/app para a pessoa criar a conta com esse e-mail."; eq(); } catch (e) { $("ste").className = "status err"; $("ste").textContent = e.message; } };
  }
  $("sair").onclick = async () => { try { await logout(); } catch {} telaEntrar("Você saiu."); };
};

/* ================= Administração (Rodrigo e Joselia) ================= */
VIEWS.admin = async () => {
  if (!EU.admin) return ir({ v: "inicio" });
  const [res, cs, im] = await Promise.all([api("admin/resumo"), api("admin/contas"), api("admin/intermediacoes")]);
  const pend = cs.contas.filter((c) => c.creci && c.creci.situacao === "em_verificacao");
  $("main").innerHTML = `<div class="card"><span class="k">Administração</span><h2>Receita recorrente</h2><div class="kpis"><div class="kpi"><b>${brl(res.mrr)}</b><span>MRR (planos em dia)</span></div><div class="kpi"><b>${res.contas}</b><span>Contas (responsáveis)</span></div><div class="kpi"><b>${res.avulsos_mes}</b><span>Avulsos no mês</span></div><div class="kpi"><b>${res.porStatus.atrasada || 0}</b><span>Em atraso</span></div></div></div>
  <div class="card"><h3>CRECI para conferir (${pend.length})</h3><p class="hint">Confira no site do CRECI da UF e marque a situação. O usuário recebe o aviso no app.</p>
  ${pend.map((c) => `<div class="rot" data-cid="${c.id}"><b>${esc(c.nome)} · ${esc(c.creci.formatado)}</b><span class="hint">${esc([c.email, c.tipo, c.creci.doc_k ? "documento enviado" : "sem documento"].join(" · "))}</span>
    <div class="acoes">${c.creci.doc_k ? `<button class="sm" data-doc="${c.id}">Ver documento</button>` : ""}<button class="sm" data-sit="ativo">Ativo</button><button class="sm" data-sit="inativo">Inativo</button><button class="sm" data-sit="suspenso">Suspenso</button><button class="sm" data-sit="nao_encontrado">Não localizado</button></div></div>`).join("") || '<p class="hint">Nada pendente.</p>'}</div>
  <div class="card"><h3>Pedidos de intermediação (${im.intermediacoes.filter((x) => x.status === "solicitada").length} novos)</h3>
  ${im.intermediacoes.map((x) => `<div class="rot" data-im="${x.id}"><b>${esc(x.codigo)} · ${esc(x.tipo || "")} em ${esc(x.cidade || "?")}</b><span class="hint">${esc([x.nome, x.telefone, x.email].join(" · "))} · <span class="tag">${esc(x.status)}</span> · sugerido: ${esc(x.corretor)}</span>${x.obs ? `<p class="desc">${esc(x.obs)}</p>` : ""}
    ${x.status === "aceita" ? "" : `<label>Corretor responsável<select data-cor><option value="rodrigo" ${x.corretor === "rodrigo" ? "selected" : ""}>Rodrigo · CRECI-SP 297692</option><option value="joselia" ${x.corretor === "joselia" ? "selected" : ""}>Joselia · CRECI-SP 300760</option></select></label>
    <label class="check"><input type="checkbox" data-aut> <span>Autorização de venda/locação assinada pelo proprietário</span></label>
    <div class="acoes"><button class="sm" data-st="em_contato">Em contato</button><button class="sm p" data-st="aceita">Aceitar</button><button class="sm g" data-st="recusada">Recusar</button></div>`}</div>`).join("") || '<p class="hint">Nenhum pedido.</p>'}</div>
  <div class="card"><h3>Contas</h3><div class="tabela"><table><tr><th>Nome</th><th>Tipo</th><th>Plano</th><th>CRECI</th><th>Uso</th></tr>${cs.contas.map((c) => `<tr><td>${esc(c.razao || c.nome)}<br><span class="hint">${esc(c.email)}</span></td><td>${esc(c.org_id !== c.id ? "membro" : c.tipo)}</td><td>${esc(c.assinatura.plano ? `${c.assinatura.plano} · ${c.assinatura.status}` : c.creditos ? c.creditos + " avulso(s)" : "-")}</td><td>${esc(c.creci ? `${c.creci.formatado} · ${c.creci.situacao}` : "-")}</td><td>${c.uso_mes}</td></tr>`).join("")}</table></div></div>`;
  document.querySelectorAll("[data-sit]").forEach((b) => (b.onclick = async () => { const id = b.closest("[data-cid]").dataset.cid; await PUT("admin/creci/" + id, { situacao: b.dataset.sit }); toast("Situação registrada."); render(); }));
  document.querySelectorAll("[data-doc]").forEach((b) => (b.onclick = async () => { const r = await fetch("/api/admin/creci-doc/" + b.dataset.doc, { credentials: "same-origin" }); if (!r.ok) return toast("Sem documento."); window.open(URL.createObjectURL(await r.blob()), "_blank"); }));
  document.querySelectorAll("[data-im] [data-st]").forEach((b) => (b.onclick = async () => { const box = b.closest("[data-im]"); try { await PUT("admin/intermediacoes/" + box.dataset.im, { status: b.dataset.st, corretor: box.querySelector("[data-cor]").value, autorizacao_assinada: box.querySelector("[data-aut]").checked }); toast("Atualizado."); render(); } catch (e) { toast(e.message); } }));
};

/* ================= Início do app ================= */
async function iniciar() {
  try { const r = await handleAuthCallback(); if (r && r.type === "recovery") return telaNovaSenha(); } catch (e) { return telaEntrar("Link inválido ou expirado. Entre ou peça um novo."); }
  let u = null; try { u = await getUser(); } catch {}
  if (!u) return telaEntrar();
  await carregarEu();
  if (!EU.conta) return telaCadastro();
  const h = location.hash.slice(1).split("/"); if (h[0] && VIEWS[h[0]]) rota = { v: h[0], id: h[1] };
  render();
}
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
iniciar();
