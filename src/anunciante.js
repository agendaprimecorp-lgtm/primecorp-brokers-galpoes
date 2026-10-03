// Sala do Anunciante: página pública. O anunciante completa os dados do próprio imóvel e autoriza a indicação.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const token = new URLSearchParams(location.search).get("t") || "";
const fdt = (t) => { try { return new Date(t).toLocaleDateString("pt-BR"); } catch { return ""; } };
const mascaraDoc = (v) => { const d = v.replace(/\D/g, "").slice(0, 14); if (d.length <= 11) return d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2"); return d.replace(/^(\d{2})(\d)/, "$1.$2").replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1/$2").replace(/(\d{4})(\d)/, "$1-$2"); };

async function chamar(metodo, corpo) {
  const r = await fetch(`/publico/anunciante/${encodeURIComponent(token)}`, { method: metodo, headers: { "content-type": "application/json" }, body: corpo ? JSON.stringify(corpo) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erro || "Não foi possível carregar. Tente novamente.");
  return j;
}
const telaErro = (msg) => ($("main").innerHTML = `<div class="card"><h2>Link indisponível</h2><p>${esc(msg)}</p></div>`);
const unid = (t) => (t && !t.startsWith("sel:") && t !== "text" ? `<span>${esc(t)}</span>` : "");
function campo(q) {
  if (q.tipo && q.tipo.startsWith("sel:")) return `<label class="full">${esc(q.pergunta)}<select data-c="${esc(q.campo)}"><option value="">Selecione</option>${q.tipo.slice(4).split("|").map((o) => `<option ${o === q.resposta ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></label>`;
  const num = q.tipo && q.tipo !== "text";
  return `<label class="full ${num ? "u" : ""}">${esc(q.pergunta)}<input data-c="${esc(q.campo)}" ${num ? 'inputmode="decimal"' : ""} value="${esc(q.resposta || "")}">${unid(q.tipo)}</label>`;
}

function tela(p, msg) {
  const parceria = p.tipo_termo !== "proprietario";
  $("main").innerHTML = `
  <div class="card"><span class="k">Ref. ${esc(p.codigo)} · ${esc(p.operacao)}</span><h2>${esc(p.titulo)}</h2>
  ${p.anunciante ? `<p class="hint">A/C: ${esc(p.anunciante)}</p>` : ""}
  <p>Represento ${p.grupo === "residencial" ? "famílias e investidores" : p.grupo === "rural" ? "produtores e investidores" : "empresas e investidores"} que procuram imóveis${p.grupo === "rural" ? " rurais" : ""}. Gostaria de apresentar este imóvel aos meus clientes${p.perguntas.length && !p.perguntas.every((q) => q.resposta) ? ": faltam algumas informações básicas" : ""}.</p>
  ${p.demanda > 0 ? `<p class="note"><b>Tenho ${p.demanda} cliente${p.demanda > 1 ? "s" : ""} com demanda ativa compatível com este imóvel.</b></p>` : ""}
  ${msg ? `<p class="status">${esc(msg)}</p>` : ""}</div>
  ${p.conhecidos.length ? `<div class="card"><h3>Dados que já temos</h3><ul class="log">${p.conhecidos.map((r) => `<li><time>${esc(r[0])}</time><span><b>${esc(r[1])}</b></span></li>`).join("")}</ul></div>` : ""}
  ${p.perguntas.length ? (p.perguntas.every((q) => q.resposta) ? `<details class="card" id="fq"><summary style="cursor:pointer"><b>Informações enviadas</b> <span class="hint">· toque para revisar ou corrigir</span></summary><div class="grid" style="margin-top:10px">${p.perguntas.map(campo).join("")}</div></details>` : `<div class="card" id="fq"><h3>Informações que faltam</h3><p class="hint">Responda o que souber. Pode voltar depois pelo mesmo link.</p><div class="grid">${p.perguntas.map(campo).join("")}</div></div>`) : ""}
  ${p.aceito ? `<div class="card"><h3>Autorização registrada</h3><p class="tag ok" style="align-self:flex-start">Aceita por ${esc(p.aceite.responsavel)} (${esc(p.aceite.razao)}) em ${esc(fdt(p.aceite.em))}</p></div>` : `
  <div class="card" id="fa"><h3>${parceria ? "Parceria e autorização de indicação" : "Autorização de intermediação"}</h3>
  ${p.comissao ? `<p><b>Honorários:</b> ${esc(p.comissao.texto)}</p>${p.comissao.partes.length > 1 || parceria ? `<ul class="log">${p.comissao.partes.map((x) => `<li><time>${esc(x.pct)}%</time><span>${esc(x.papel)}</span></li>`).join("")}</ul>` : ""}` : ""}
  <div class="termo">${esc(p.termo_texto)}</div><p class="hint">Termo ${esc(p.termo_versao)}</p>
  <div class="grid">
  <label class="full">Nome ou razão social<input id="razao" autocomplete="organization"></label>
  <label>CNPJ ou CPF<input id="documento" inputmode="numeric"></label>
  <label>CRECI${parceria ? "" : " (se houver)"}<input id="creci"></label>
  <label>Responsável<input id="responsavel" autocomplete="name"></label>
  <label>Cargo<input id="cargo" autocomplete="organization-title"></label>
  <label>Telefone / WhatsApp<input id="telefone" type="tel" autocomplete="tel"></label>
  <label>E-mail<input id="email" type="email" autocomplete="email"></label></div>
  <label class="check"><input type="checkbox" id="ok"> Li e aceito o termo acima.</label></div>`}
  <div class="card"><button class="p" id="env">${p.aceito ? "Enviar correções" : p.perguntas.length ? "Enviar informações e autorização" : "Aceitar e enviar"}</button>
  <p class="hint">Você pode enviar só as informações agora e autorizar depois.</p><div class="status" id="st"></div></div>
  <div class="card"><h3>Corretor</h3><p>${esc(p.corretor?.nome || "Rodrigo França Viana")} · ${esc(p.corretor?.creci || "CRECI-SP 297692")}</p><p class="hint">${esc([p.corretor?.whatsapp, p.corretor?.email].filter(Boolean).join(" · "))}</p>
  <p class="hint">Seus dados são usados apenas para esta intermediação (LGPD). O cliente final não é identificado nesta página.</p></div>`;
  const doc = $("documento"); if (doc) doc.addEventListener("input", (e) => (e.target.value = mascaraDoc(e.target.value)));
  $("env").onclick = async () => {
    const st = $("st"); st.className = "status";
    const campos = {}; document.querySelectorAll("[data-c]").forEach((el) => { if (el.value.trim()) campos[el.dataset.c] = el.value.trim(); });
    const body = { acao: "responder", campos };
    const ok = $("ok");
    if (ok && ok.checked) { const v = (id) => $(id).value.trim(); body.aceite = { razao: v("razao"), documento: v("documento"), creci: v("creci"), responsavel: v("responsavel"), cargo: v("cargo"), telefone: v("telefone"), email: v("email"), concordo: true }; }
    if (!Object.keys(campos).length && !body.aceite) { st.className = "status err"; st.textContent = "Preencha alguma informação ou marque o aceite."; return; }
    $("env").disabled = true; st.textContent = "Enviando…";
    try { const r = await chamar("POST", body); tela(r, body.aceite ? "Obrigado! Informações e autorização registradas." : "Obrigado! Informações registradas."); window.scrollTo(0, 0); }
    catch (e) { st.className = "status err"; st.textContent = e.message; $("env").disabled = false; }
  };
}

(async () => {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return telaErro("Este link está incompleto. Peça um novo ao corretor.");
  try { tela(await chamar("GET")); } catch (e) { telaErro(e.message); }
})();
