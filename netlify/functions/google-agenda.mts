import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { randomBytes } from "node:crypto";

// Agenda Google da PrimeCorp (OAuth + horários livres + agendamento).
// Rotas:
//   GET  /google-agenda/conectar   -> inicia a autorização (uma vez, logado em GOOGLE_CALENDAR_ID)
//   GET  /google-agenda/callback   -> retorno do Google (URI de redirecionamento)
//   GET  /google-agenda/status     -> { conectado }
//   GET  /google-agenda/horarios?dia=AAAA-MM-DD -> horários livres
//   POST /google-agenda/agendar    -> { nome, email, telefone, assunto, inicio }
// Variáveis: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_CALENDAR_ID, GOOGLE_AGENDA_ORIGENS (opcional, separadas por vírgula).

const env = (k: string) => (globalThis as any).Netlify?.env?.get(k) ?? process.env[k] ?? "";
const ESCOPOS = "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly";
const TZ = "America/Sao_Paulo";
const OFFSET = "-03:00"; // Brasil sem horário de verão
const INICIO_H = 9, FIM_H = 18, DURACAO_MIN = 30, ANTECEDENCIA_MIN = 120, DIAS_MAX = 30;
const ORIGENS_PADRAO = [
  "https://conviteprimecorpconsultoria.netlify.app",
  "https://propto.com.br",
  "https://www.propto.com.br",
  "https://primecorp-radarnegocios.netlify.app",
];

const store = () => getStore({ name: "google-agenda", consistency: "strong" });

function origensPermitidas() {
  const extra = env("GOOGLE_AGENDA_ORIGENS").split(",").map((s: string) => s.trim()).filter(Boolean);
  return [...ORIGENS_PADRAO, ...extra];
}
function cors(req: Request): Record<string, string> {
  const o = req.headers.get("origin") || "";
  if (!origensPermitidas().includes(o)) return {};
  return { "access-control-allow-origin": o, "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type", vary: "origin" };
}
function json(req: Request, dados: unknown, status = 200) {
  return new Response(JSON.stringify(dados), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...cors(req) } });
}
function pagina(titulo: string, texto: string, status = 200) {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)}</title><body style="font-family:system-ui;max-width:560px;margin:60px auto;padding:0 16px"><h1>${esc(titulo)}</h1><p>${esc(texto)}</p></body>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
function lerCookie(req: Request, nome: string) {
  const m = (req.headers.get("cookie") || "").match(new RegExp("(?:^|;\\s*)" + nome + "=([^;]+)"));
  return m ? decodeURIComponent(m[1]) : "";
}
const redirectUri = (req: Request) => new URL(req.url).origin + "/google-agenda/callback";

async function tokenAcesso(): Promise<string> {
  const cache = (await store().get("acesso", { type: "json" })) as { token: string; expira: number } | null;
  if (cache && cache.expira > Date.now() + 60_000) return cache.token;
  const refresh = await store().get("refresh_token");
  if (!refresh) throw new Error("nao_conectado");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env("GOOGLE_CLIENT_ID"), client_secret: env("GOOGLE_CLIENT_SECRET"), refresh_token: refresh, grant_type: "refresh_token" }),
  });
  const d: any = await r.json();
  if (!r.ok || !d.access_token) throw new Error("token_invalido: " + (d.error || r.status));
  await store().setJSON("acesso", { token: d.access_token, expira: Date.now() + (d.expires_in || 3600) * 1000 });
  return d.access_token;
}
async function gcal(caminho: string, init: RequestInit = {}) {
  const t = await tokenAcesso();
  const r = await fetch("https://www.googleapis.com/calendar/v3" + caminho, { ...init, headers: { authorization: "Bearer " + t, "content-type": "application/json", ...(init.headers || {}) } });
  const d: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("google_" + r.status + ": " + (d?.error?.message || ""));
  return d;
}

function slotsDoDia(dia: string): Date[] {
  const base = new Date(`${dia}T00:00:00${OFFSET}`);
  if (isNaN(base.getTime())) return [];
  const semana = new Date(`${dia}T12:00:00${OFFSET}`).getUTCDay();
  if (semana === 0 || semana === 6) return [];
  const agora = Date.now();
  if (base.getTime() > agora + DIAS_MAX * 86_400_000) return [];
  const out: Date[] = [];
  for (let m = INICIO_H * 60; m + DURACAO_MIN <= FIM_H * 60; m += DURACAO_MIN) {
    const hh = String(Math.floor(m / 60)).padStart(2, "0"), mm = String(m % 60).padStart(2, "0");
    const d = new Date(`${dia}T${hh}:${mm}:00${OFFSET}`);
    if (d.getTime() >= agora + ANTECEDENCIA_MIN * 60_000) out.push(d);
  }
  return out;
}
async function ocupados(ini: Date, fim: Date) {
  const d = await gcal("/freeBusy", { method: "POST", body: JSON.stringify({ timeMin: ini.toISOString(), timeMax: fim.toISOString(), timeZone: TZ, items: [{ id: env("GOOGLE_CALENDAR_ID") }] }) });
  const cal = d.calendars?.[env("GOOGLE_CALENDAR_ID")];
  if (cal?.errors?.length) throw new Error("freebusy: " + cal.errors[0].reason);
  return (cal?.busy || []).map((b: any) => [new Date(b.start).getTime(), new Date(b.end).getTime()] as [number, number]);
}
const livre = (ini: number, busy: [number, number][]) => !busy.some(([a, b]) => ini < b && ini + DURACAO_MIN * 60_000 > a);

export default async (req: Request) => {
  const url = new URL(req.url);
  const rota = url.pathname.replace(/^\/google-agenda\/?/, "").replace(/\/$/, "");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });

  if (!env("GOOGLE_CLIENT_ID") || !env("GOOGLE_CLIENT_SECRET") || !env("GOOGLE_CALENDAR_ID")) {
    return rota === "conectar" || rota === "callback"
      ? pagina("Agenda não configurada", "Cadastre GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e GOOGLE_CALENDAR_ID no Netlify e faça um novo deploy.", 503)
      : json(req, { erro: "agenda_nao_configurada" }, 503);
  }

  try {
    if (rota === "conectar" && req.method === "GET") {
      const state = randomBytes(24).toString("hex");
      const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      auth.search = new URLSearchParams({ client_id: env("GOOGLE_CLIENT_ID"), redirect_uri: redirectUri(req), response_type: "code", scope: ESCOPOS, access_type: "offline", prompt: "consent", include_granted_scopes: "true", login_hint: env("GOOGLE_CALENDAR_ID"), state }).toString();
      return new Response(null, { status: 302, headers: { location: auth.toString(), "set-cookie": `ga_state=${state}; Path=/google-agenda; HttpOnly; Secure; SameSite=Lax; Max-Age=600`, "cache-control": "no-store" } });
    }

    if (rota === "callback" && req.method === "GET") {
      const erro = url.searchParams.get("error");
      if (erro) return pagina("Autorização cancelada", "O Google retornou: " + erro, 400);
      const state = url.searchParams.get("state") || "";
      if (!state || state !== lerCookie(req, "ga_state")) return pagina("Sessão expirada", "Abra /google-agenda/conectar novamente.", 400);
      const r = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ code: url.searchParams.get("code") || "", client_id: env("GOOGLE_CLIENT_ID"), client_secret: env("GOOGLE_CLIENT_SECRET"), redirect_uri: redirectUri(req), grant_type: "authorization_code" }),
      });
      const d: any = await r.json();
      if (!r.ok || !d.access_token) return pagina("Falha na autorização", "Erro do Google: " + (d.error_description || d.error || r.status), 400);
      // Só aceita a conta definida em GOOGLE_CALENDAR_ID.
      const cal = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary", { headers: { authorization: "Bearer " + d.access_token } }).then((x) => x.json()).catch(() => ({}));
      if ((cal?.id || "").toLowerCase() !== env("GOOGLE_CALENDAR_ID").toLowerCase()) return pagina("Conta incorreta", "Autorize usando a conta " + env("GOOGLE_CALENDAR_ID") + ".", 403);
      if (!d.refresh_token) return pagina("Sem token de atualização", "Remova o acesso do app em myaccount.google.com/permissions e conecte de novo.", 400);
      await store().set("refresh_token", d.refresh_token);
      await store().setJSON("acesso", { token: d.access_token, expira: Date.now() + (d.expires_in || 3600) * 1000 });
      await store().setJSON("conexao", { conta: cal.id, em: new Date().toISOString() });
      return new Response(pagina("Agenda conectada", "A agenda " + cal.id + " está conectada. Pode fechar esta página.").body, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "set-cookie": "ga_state=; Path=/google-agenda; Max-Age=0", "cache-control": "no-store" } });
    }

    if (rota === "status" && req.method === "GET") {
      const c = await store().get("conexao", { type: "json" });
      return json(req, { conectado: !!c, desde: (c as any)?.em || null });
    }

    if (rota === "horarios" && req.method === "GET") {
      const dia = url.searchParams.get("dia") || "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return json(req, { erro: "dia_invalido" }, 400);
      const slots = slotsDoDia(dia);
      if (!slots.length) return json(req, { dia, horarios: [] });
      const busy = await ocupados(new Date(`${dia}T00:00:00${OFFSET}`), new Date(`${dia}T23:59:59${OFFSET}`));
      const horarios = slots.filter((s) => livre(s.getTime(), busy)).map((s) => ({ inicio: s.toISOString(), rotulo: s.toLocaleTimeString("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }) }));
      return json(req, { dia, duracao_min: DURACAO_MIN, horarios });
    }

    if (rota === "agendar" && req.method === "POST") {
      if (!cors(req)["access-control-allow-origin"]) return json(req, { erro: "origem_nao_permitida" }, 403);
      const b: any = await req.json().catch(() => ({}));
      if (b.site) return json(req, { ok: true }); // honeypot
      const nome = String(b.nome || "").trim().slice(0, 120);
      const email = String(b.email || "").trim().slice(0, 160);
      const telefone = String(b.telefone || "").trim().slice(0, 40);
      const assunto = String(b.assunto || "").trim().slice(0, 500);
      const inicio = new Date(String(b.inicio || ""));
      if (nome.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(req, { erro: "dados_invalidos" }, 400);
      if (isNaN(inicio.getTime())) return json(req, { erro: "horario_invalido" }, 400);
      const dia = inicio.toLocaleDateString("en-CA", { timeZone: TZ });
      if (!slotsDoDia(dia).some((s) => s.getTime() === inicio.getTime())) return json(req, { erro: "horario_invalido" }, 400);
      const fim = new Date(inicio.getTime() + DURACAO_MIN * 60_000);
      if (!livre(inicio.getTime(), await ocupados(inicio, fim))) return json(req, { erro: "horario_ocupado" }, 409);
      const ev = await gcal(`/calendars/${encodeURIComponent(env("GOOGLE_CALENDAR_ID"))}/events?conferenceDataVersion=1&sendUpdates=all`, {
        method: "POST",
        body: JSON.stringify({
          summary: `Conversa PrimeCorp — ${nome}`,
          description: `Agendado pelo convite PrimeCorp.\nNome: ${nome}\nE-mail: ${email}\nTelefone/WhatsApp: ${telefone || "-"}\n\n${assunto}`,
          start: { dateTime: inicio.toISOString(), timeZone: TZ },
          end: { dateTime: fim.toISOString(), timeZone: TZ },
          attendees: [{ email, displayName: nome }],
          conferenceData: { createRequest: { requestId: randomBytes(12).toString("hex"), conferenceSolutionKey: { type: "hangoutsMeet" } } },
          reminders: { useDefault: true },
        }),
      });
      return json(req, { ok: true, inicio: ev.start?.dateTime, meet: ev.hangoutLink || null });
    }

    return json(req, { erro: "rota_inexistente" }, 404);
  } catch (e: any) {
    const msg = String(e?.message || e);
    console.error("google-agenda:", msg);
    if (msg.startsWith("nao_conectado")) return json(req, { erro: "agenda_nao_conectada" }, 503);
    return json(req, { erro: "falha_agenda" }, 502);
  }
};

export const config: Config = {
  path: "/google-agenda/*",
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
