// RegAlert — notifiche. Body: { "mode": "daily" | "instant", "dry_run"?: true }
// daily   → tutte le novità non ancora inviate (escluse quelle valutate "non pertinenti")
// instant → solo rilevanza alta o priorità critica, appena arrivano
import { createClient } from "npm:@supabase/supabase-js@2.49.4";
import { type DigestAlert, digestHtml, sendEmail, sendTelegram } from "../_shared/notify.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET");
const DASHBOARD_URL_ENV = Deno.env.get("DASHBOARD_URL") ?? null;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function authorize(req: Request) {
  const cron = req.headers.get("x-cron-secret");
  if (cron) {
    if (CRON_SECRET) return cron === CRON_SECRET;
    // segreto custodito nel Vault del database (vedi migrazione 003)
    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data } = await svc.rpc("ra_check_cron", { p_secret: cron });
    return data === true;
  }
  const auth = req.headers.get("Authorization");
  if (!auth) return false;
  const c = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
  const { data, error } = await c.rpc("ra_is_admin");
  return !error && data === true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!(await authorize(req))) return json({ error: "non autorizzato" }, 401);

  const { mode = "daily", dry_run = false } = await req.json().catch(() => ({}));
  const instant = mode === "instant";
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  let q = db.from("ra_alerts_view")
    .select("id,title,url,source_authority,ai_summary,ai_relevance,priority,tags,detected_at,ai_processed_at")
    .neq("status", "not_relevant")
    .order("detected_at", { ascending: false })
    .limit(100);
  q = instant
    ? q.is("notified_instant_at", null).or("ai_relevance.eq.high,priority.eq.critical")
    : q.is("notified_daily_at", null).or("ai_relevance.is.null,ai_relevance.neq.none");
  const { data: alerts, error } = await q;
  if (error) return json({ error: error.message }, 500);

  // se l'AI è attiva, aspetta che l'alert sia stato elaborato prima di inviarlo
  const aiOn = !!Deno.env.get("ANTHROPIC_API_KEY");
  const ready = (alerts ?? []).filter((a) => !aiOn || a.ai_processed_at) as (DigestAlert & { ai_processed_at: string })[];
  if (!ready.length) return json({ sent: 0, note: "nessuna novità da inviare" });

  // ordina: prima rilevanza alta / priorità critica
  const rank = (a: DigestAlert) =>
    (a.priority === "critical" ? 0 : a.ai_relevance === "high" ? 1 : a.priority === "high" ? 2 : a.ai_relevance === "medium" ? 3 : 4);
  ready.sort((a, b) => rank(a) - rank(b));

  const flag = instant ? "notify_instant" : "notify_daily";
  const { data: peopleRaw } = await db.from("ra_profiles").select("email,telegram_chat_id")
    .in("role", ["viewer", "analyst", "admin"]).eq(flag, true);
  const people = (peopleRaw ?? []) as { email: string; telegram_chat_id: string | null }[];
  const { data: extra } = await db.from("ra_settings").select("value").eq("key", "digest_recipients_extra").maybeSingle();
  const emails = [...new Set([
    ...people.map((p) => p.email),
    ...String(extra?.value ?? "").split(/[,;\s]+/).filter((e) => e.includes("@")),
  ])];
  const chats = people.map((p) => p.telegram_chat_id).filter(Boolean) as string[];

  const { data: dash } = await db.from("ra_settings").select("value").eq("key", "dashboard_url").maybeSingle();
  const DASHBOARD_URL = DASHBOARD_URL_ENV ?? dash?.value ?? null;

  const date = new Date().toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Rome" });
  const heading = instant ? "RegAlert — novità ad alta rilevanza" : `RegAlert — digest del ${date}`;
  if (dry_run) return json({ would_send: ready.length, emails, chats, preview_html: digestHtml(ready, DASHBOARD_URL, heading) });

  const log: string[] = [];
  try { log.push(await sendEmail(emails, `${heading} (${ready.length})`, digestHtml(ready, DASHBOARD_URL, heading))); }
  catch (e) { log.push(`email: errore ${(e as Error).message}`); }
  try { log.push(await sendTelegram(chats, ready, heading)); }
  catch (e) { log.push(`telegram: errore ${(e as Error).message}`); }

  await db.from("ra_alerts")
    .update(instant ? { notified_instant_at: new Date().toISOString() } : { notified_daily_at: new Date().toISOString() })
    .in("id", ready.map((a) => a.id));

  return json({ sent: ready.length, log });
});
