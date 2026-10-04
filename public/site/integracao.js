/* Integra\u00e7\u00e3o do site primecorpconsultoria.com.br com a assistente virtual PrimeCorp (WhatsApp).
   Carregado por snippet da Netlify no site. N\u00e3o altera o envio por e-mail j\u00e1 existente. */
(function () {
  "use strict";
  if (window.__pcIntegracao) return; window.__pcIntegracao = true;
  var SRC = (document.currentScript && document.currentScript.src) || "https://primecorp-radarnegocios.netlify.app/site/integracao.js";
  var API = new URL("/site/lead", SRC).toString();
  var WA = "5519981105192", WA_FMT = "(19) 98110-5192", ANTIGO = "5519998051985", ANTIGO_FMT = /\(19\)\s*99805-1985/g;
  var PAGINAS = { "": "in\u00edcio", "setor-publico": "setor p\u00fablico", "empresas": "empresas", "ensino-e-filantropia": "ensino e filantropia", "imoveis": "im\u00f3veis", "indique-seu-municipio": "indica\u00e7\u00e3o de munic\u00edpio", "diferencial": "diferencial", "quem-somos": "quem somos", "experiencia": "experi\u00eancia", "contato": "contato" };
  var pagina = PAGINAS[location.pathname.replace(/^\/|\/$/g, "")] || location.pathname.replace(/\//g, " ").trim() || "in\u00edcio";
  var linkPadrao = function () { return "https://wa.me/" + WA + "?text=" + encodeURIComponent("Ol\u00e1! Vim pelo site da PrimeCorp (" + pagina + ")."); };

  /* 1) WhatsApp do site \u2192 assistente */
  function trocarLinks(raiz) {
    (raiz || document).querySelectorAll('a[href*="' + ANTIGO + '"]').forEach(function (a) { if (!a.dataset.pcLead) a.href = linkPadrao(); });
    var w = document.createTreeWalker(raiz || document.body, NodeFilter.SHOW_TEXT, null), n;
    while ((n = w.nextNode())) if (ANTIGO_FMT.test(n.nodeValue)) { ANTIGO_FMT.lastIndex = 0; n.nodeValue = n.nodeValue.replace(ANTIGO_FMT, WA_FMT); }
  }

  /* 2) Formul\u00e1rios \u2192 sistema (o e-mail do site continua) */
  var FORMS = [
    { form: "consulta", ok: "rOk", campos: { perfil: "rPerfil", nome: "rNome", municipio: "rMun", fone: "rFone", email: "rMail", consentimento: "rLgpd" }, extras: {} },
    { form: "indicacao", ok: "paOk", campos: { perfil: "paPerfil", nome: "paNome", municipio: "paMun", fone: "paFone", email: "paMail", consentimento: "paLgpd" }, extras: { acesso_gestao: "paAcesso", relato: "paObs", declaracao_nao_vinculo: "paDecl" } },
    { form: "imovel", ok: "iOk", campos: { perfil: "iPerfil", nome: "iNome", municipio: "iCidade", fone: "iFone", email: "iMail", consentimento: "iLgpd" }, extras: { tipo_imovel: "iTipo", valor: "iValor", descricao: "iObs" } },
  ];
  var memoria = {};
  function ler(id) { var e = document.getElementById(id); if (!e) return undefined; return e.type === "checkbox" ? e.checked : e.value; }
  function guardar(f) {
    var m = memoria[f.form] || (memoria[f.form] = { extras: {} });
    Object.keys(f.campos).forEach(function (k) { var v = ler(f.campos[k]); if (v !== undefined && v !== "" && v !== false) m[k] = v; else if (k === "consentimento" && v === true) m[k] = true; });
    Object.keys(f.extras).forEach(function (k) { var v = ler(f.extras[k]); if (v !== undefined && v !== "") m.extras[k] = typeof v === "boolean" ? (v ? "sim" : "n\u00e3o") : v; });
  }
  function visivel(el) { return !!el && el.offsetParent !== null && getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden"; }
  function enviar(f, okEl) {
    var m = memoria[f.form]; if (!m || !m.nome || !m.fone || okEl.dataset.pcEnviado) return; okEl.dataset.pcEnviado = "1";
    var corpo = { form: f.form, perfil: m.perfil || "", nome: m.nome, municipio: m.municipio || "", fone: m.fone, email: m.email || "", consentimento: !!m.consentimento, extras: m.extras, pagina: pagina, hp: (document.getElementById("pcHp") || {}).value || "" };
    fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo), mode: "cors" })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j && j.whatsapp) botao(okEl, j.whatsapp); else botao(okEl, linkPadrao()); })
      .catch(function () { botao(okEl, linkPadrao()); });
  }
  function botao(okEl, link) {
    var as = okEl.querySelectorAll('a[href*="wa.me"]');
    if (as.length) as.forEach(function (a) { a.href = link; a.dataset.pcLead = "1"; a.textContent = "Continuar no WhatsApp com a assistente"; a.target = "_blank"; a.rel = "noopener"; });
    else { var a = document.createElement("a"); a.href = link; a.target = "_blank"; a.rel = "noopener"; a.className = "btn btn-p btn-full"; a.dataset.pcLead = "1"; a.textContent = "Continuar no WhatsApp com a assistente"; a.style.marginTop = "10px"; okEl.appendChild(a); }
    var p = okEl.querySelector(".pc-nota"); if (!p) { p = document.createElement("p"); p.className = "pc-nota"; p.style.cssText = "font-size:13px;opacity:.8;margin-top:8px"; okEl.appendChild(p); }
    p.textContent = "Nossa atendente virtual j\u00e1 recebeu o seu cadastro e continua o atendimento pelo WhatsApp " + WA_FMT + ".";
  }
  function ligarForm(f) {
    var okEl = document.getElementById(f.ok); if (!okEl) return;
    var ids = Object.keys(f.campos).map(function (k) { return f.campos[k]; }).concat(Object.keys(f.extras).map(function (k) { return f.extras[k]; }));
    ids.forEach(function (id) { var e = document.getElementById(id); if (e) ["input", "change"].forEach(function (ev) { e.addEventListener(ev, function () { guardar(f); }); }); });
    document.addEventListener("click", function (ev) { var b = ev.target.closest && ev.target.closest('button[type="submit"],button'); if (b && okEl.parentElement && okEl.parentElement.contains(b)) guardar(f); }, true);
    // honeypot (campo invis\u00edvel que s\u00f3 rob\u00f4s preenchem)
    if (!document.getElementById("pcHp")) { var hp = document.createElement("input"); hp.id = "pcHp"; hp.name = "empresa_site"; hp.tabIndex = -1; hp.autocomplete = "off"; hp.setAttribute("aria-hidden", "true"); hp.style.cssText = "position:absolute;left:-9999px;width:1px;height:1px;opacity:0"; okEl.parentElement && okEl.parentElement.appendChild(hp); }
    var checar = function () { if (visivel(okEl)) { guardar(f); enviar(f, okEl); } };
    new MutationObserver(checar).observe(okEl, { attributes: true, childList: true, subtree: true });
    if (okEl.parentElement) new MutationObserver(checar).observe(okEl.parentElement, { attributes: true, attributeFilter: ["style", "class", "hidden"] });
    // texto LGPD: deixa claro o contato por WhatsApp e o atendimento inicial pela assistente virtual
    var cb = document.getElementById(f.campos.consentimento); var lb = cb && cb.closest("label");
    if (lb && !lb.querySelector(".pc-lgpd")) { var s = document.createElement("span"); s.className = "pc-lgpd"; s.textContent = " O contato pode ser feito pelo WhatsApp " + WA_FMT + ", com atendimento inicial pela nossa assistente virtual."; lb.appendChild(s); }
  }

  function iniciar() { trocarLinks(); FORMS.forEach(ligarForm); new MutationObserver(function (ms) { ms.forEach(function (m) { m.addedNodes.forEach(function (n) { if (n.nodeType === 1) trocarLinks(n); }); }); }).observe(document.body, { childList: true, subtree: true }); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})();
