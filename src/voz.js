/* Ditado por voz (Web Speech API, pt-BR). Sem suporte: usa o microfone do teclado. */
export const vozDisponivel = () => !!(window.SpeechRecognition || window.webkitSpeechRecognition);
export function ditar({ aoTexto, aoParcial, aoFim, aoErro }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { aoErro && aoErro("sem-suporte"); return null; }
  const r = new SR(); r.lang = "pt-BR"; r.continuous = true; r.interimResults = true;
  let ativo = true;
  r.onresult = (e) => { let parcial = ""; for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) aoTexto && aoTexto(t.trim()); else parcial += t; } aoParcial && aoParcial(parcial); };
  r.onerror = (e) => { if (e.error === "no-speech" || e.error === "aborted") return; ativo = false; aoErro && aoErro(e.error); };
  r.onend = () => { if (ativo) { try { r.start(); } catch { ativo = false; aoFim && aoFim(); } } else aoFim && aoFim(); }; // iOS encerra sozinho: reinicia
  try { r.start(); } catch (e) { aoErro && aoErro(String(e)); return null; }
  return { parar() { ativo = false; try { r.stop(); } catch {} } };
}
