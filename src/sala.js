// Sala do Cliente: página pública. Só recebe nível 1 do servidor, e só depois do aceite.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const token = new URLSearchParams(location.search).get("t") || "";
const fdt = (t) => { try { return new Date(t).toLocaleDateString("pt-BR"); } catch { return ""; } };
const mascaraDoc = (v) => { const d = v.replace(/\D/g, "").slice(0, 14); if (d.length <= 11) return d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2"); return d.replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d)/, "$1-$2"); };

async function chamar(metodo, corpo) {
  const r = await fetch(`/publico/sala/${encodeURIComponent(token)}`, { method: metodo, headers: { "content-type": "application/json" }, body: corpo ? JSON.stringify(corpo) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erro || "Não foi possível carregar. Tente novamente.");
  return j;
}
function rodape(s) {
  const c = s && s.contato;
  return `<div class="card"><h3>Seu corretor</h3><p>${esc(c?.nome || "Rodrigo França Viana")} · ${esc(c?.creci || "CRECI-SP 297692")}</p>
  <p class="hint">${esc([c?.whatsapp, c?.email].filter(Boolean).join(" · "))}</p>
  <p class="hint">As informações são preliminares e estão sujeitas a confirmação em vistoria e documentação. Seus dados são usados apenas para esta intermediação (LGPD).</p></div>`;
}
function telaErro(msg) { $("main").innerHTML = `<div class="card"><h2>Link indisponível</h2><p>${esc(msg)}</p></div>`; }

function telaAceite(s) {
  $("main").innerHTML = `<div class="card"><span class="k">Sala do Cliente</span><h2>${esc(s.titulo)}</h2>
  ${s.preparado_para ? `<p class="hint">Preparado para ${esc(s.preparado_para)}</p>` : ""}
  <p>Selecionamos <b>${s.total_opcoes} ${s.total_opcoes === 1 ? "opção" : "opções"}</b> para a sua demanda. Para ver, faça um cadastro rápido e aceite o termo abaixo.</p>
  ${s.expira ? `<p class="hint">Link válido até ${esc(fdt(s.expira))}.</p>` : ""}</div>
  <div class="card" id="f"><h2>Cadastro</h2><div class="grid">
  <label class="full">Razão social ou nome<input id="razao" autocomplete="organization"></label>
  <label>CNPJ ou CPF<input id="documento" inputmode="numeric"></label>
  <label>Responsável<input id="responsavel" autocomplete="name"></label>
  <label>Cargo<input id="cargo" autocomplete="organization-title"></label>
  <label>Telefone / WhatsApp<input id="telefone" type="tel" autocomplete="tel"></label>
  <label class="full">E-mail<input id="email" type="email" autocomplete="email"></label></div>
  <h3>Termo ${esc(s.termo_versao || "")}</h3><div class="termo">${esc(s.termo_texto)}</div>
  <label class="check"><input type="checkbox" id="ok"> Li e aceito o Termo de Apresentação, Confidencialidade e Não-Contorno.</label>
  <button class="p" id="env">Aceitar e ver as opções</button><div class="status" id="st"></div></div>${rodape(s)}`;
  $("documento").addEventListener("input", (e) => (e.target.value = mascaraDoc(e.target.value)));
  $("env").onclick = async () => {
    const st = $("st"); st.className = "status"; const v = (id) => $(id).value.trim();
    if (!$("ok").checked) { st.className = "status err"; st.textContent = "Marque o aceite do termo para continuar."; return; }
    $("env").disabled = true; st.textContent = "Registrando…";
    try { const r = await chamar("POST", { acao: "aceite", razao: v("razao"), documento: v("documento"), responsavel: v("responsavel"), cargo: v("cargo"), telefone: v("telefone"), email: v("email"), concordo: true }); telaOpcoes(r); window.scrollTo(0, 0); }
    catch (e) { st.className = "status err"; st.textContent = e.message; $("env").disabled = false; }
  };
}
function telaOpcoes(s) {
  $("main").innerHTML = `<div class="card"><span class="k">Sala do Cliente</span><h2>${esc(s.titulo)}</h2>
  <p class="hint">Termo aceito por ${esc(s.aceite?.responsavel || "")} (${esc(s.aceite?.razao || "")}) em ${esc(fdt(s.aceite?.em))}.</p>
  <p>Valores e áreas em faixas. Endereço, fotos e ficha completa são liberados no agendamento da visita.</p></div>
  ${s.opcoes.map((o) => `<div class="op"><span class="code">${esc(o.codigo)}</span><h3>${esc(o.titulo)}</h3><ul>${o.linhas.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
  ${o.interesse ? '<p class="tag ok" style="align-self:flex-start">Interesse registrado: seu corretor vai entrar em contato</p>' : `<button class="p" data-c="${esc(o.codigo)}">Tenho interesse</button>`}</div>`).join("")}
  ${rodape(s)}`;
  document.querySelectorAll("[data-c]").forEach((b) => (b.onclick = async () => {
    b.disabled = true; b.textContent = "Registrando…";
    try { telaOpcoes(await chamar("POST", { acao: "interesse", codigo: b.dataset.c })); }
    catch (e) { b.disabled = false; b.textContent = "Tenho interesse"; alertaInline(b, e.message); }
  }));
}
function alertaInline(el, msg) { const p = document.createElement("p"); p.className = "status err"; p.textContent = msg; el.after(p); }

(async () => {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return telaErro("Este link está incompleto. Peça um novo ao seu corretor.");
  try { const s = await chamar("GET"); s.aceito ? telaOpcoes(s) : telaAceite(s); }
  catch (e) { telaErro(e.message); }
})();
