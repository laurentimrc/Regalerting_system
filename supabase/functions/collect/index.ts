// RegAlert — raccolta automatica.
// Invocata da pg_cron (header x-cron-secret) o dalla dashboard da un analyst/admin (JWT utente).
// Body opzionale: { "source_id": 12 } per forzare una fonte, { "test_url": "https://..." } per provare una fonte nuova.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.49.4";
import {
  discoverFeed, extractLinks, extractText, formatDiff, type Item, lineDiff, looksLikeFeed, parseFeed, sha256, stripHtml,
} from "../_shared/parse.ts";
import { enrich } from "../_shared/ai.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET");

const UA = "Mozilla/5.0 (compatible; RegAlert/1.0; regulatory monitoring)";
const MAX_SNAPSHOT = 800;     // fingerprint ricordati per fonte
const BURST_LIMIT = 25;       // oltre questa soglia di link nuovi → un solo alert "pagina ristrutturata"
const FIRST_RUN_DAYS = 7;     // al primo giro, dai feed si importano solo le uscite recenti
const AI_BATCH = 15;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

interface Source {
  id: number; name: string; authority: string; url: string; kind: "rss" | "links" | "page";
  link_pattern: string | null; css_selector: string | null; tags: string[];
  last_checked_at: string | null; last_hash: string | null; last_snapshot: string | null;
  check_every_minutes: number;
}

async function fetchText(url: string) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,application/rss+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "it,en;q=0.8" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { body: await res.text(), contentType: res.headers.get("content-type") ?? "", finalUrl: res.url || url };
  } finally {
    clearTimeout(t);
  }
}

async function authorize(req: Request): Promise<boolean> {
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
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
  const { data, error } = await userClient.rpc("ra_can_edit");
  return !error && data === true;
}

async function processSource(db: SupabaseClient, s: Source) {
  const firstRun = !s.last_checked_at;
  const seen: string[] = s.last_snapshot && s.kind !== "page" ? JSON.parse(s.last_snapshot) : [];
  const seenSet = new Set(seen);
  const { body, contentType, finalUrl } = await fetchText(s.url);
  let newItems: Item[] = [];
  let snapshot: string | null = s.last_snapshot;
  let hash: string | null = s.last_hash;

  if (s.kind === "rss") {
    if (!looksLikeFeed(body, contentType)) throw new Error("La risposta non è un feed RSS/Atom");
    const items = parseFeed(body, finalUrl);
    const cutoff = Date.now() - FIRST_RUN_DAYS * 86400_000;
    newItems = items.filter((i) => !seenSet.has(i.fingerprint))
      .filter((i) => !firstRun || (i.published_at && new Date(i.published_at).getTime() >= cutoff));
    snapshot = JSON.stringify([...items.map((i) => i.fingerprint), ...seen.filter((f) => !items.some((i) => i.fingerprint === f))].slice(0, MAX_SNAPSHOT));
  } else if (s.kind === "links") {
    const links = extractLinks(body, finalUrl, s.css_selector, s.link_pattern);
    if (!links.length) throw new Error("Nessun link trovato: verificare selettore o pattern");
    const fresh = links.filter((l) => !seenSet.has(l.url));
    if (!firstRun && fresh.length > BURST_LIMIT) {
      newItems = [{
        fingerprint: `burst:${await sha256(fresh.map((f) => f.url).join("|"))}`,
        url: s.url,
        title: `${s.name}: ${fresh.length} nuovi link (pagina probabilmente ristrutturata)`,
        excerpt: fresh.slice(0, 40).map((f) => `${f.title} — ${f.url}`).join("\n"),
        published_at: null,
      }];
    } else if (!firstRun) {
      newItems = fresh.map((l) => ({ fingerprint: l.url, url: l.url, title: l.title, excerpt: null, published_at: null }));
    }
    snapshot = JSON.stringify([...links.map((l) => l.url), ...seen.filter((u) => !links.some((l) => l.url === u))].slice(0, MAX_SNAPSHOT));
  } else {
    const text = extractText(body, s.css_selector);
    if (text.length < 50) throw new Error("Contenuto troppo breve: verificare il selettore CSS");
    const h = await sha256(text);
    if (!firstRun && h !== s.last_hash && s.last_snapshot) {
      const d = lineDiff(s.last_snapshot, text);
      if (d.added.length || d.removed.length) {
        newItems = [{
          fingerprint: `page:${h}`,
          url: s.url,
          title: `Pagina modificata: ${s.name}`,
          excerpt: d.added.slice(0, 20).join("\n") || null,
          published_at: null,
        }];
        (newItems[0] as Item & { diff?: string }).diff = formatDiff(d);
      }
    }
    hash = h;
    snapshot = text.slice(0, 200_000);
  }

  let inserted = 0;
  if (newItems.length) {
    const rows = newItems.map((i) => ({
      source_id: s.id,
      fingerprint: i.fingerprint.slice(0, 1000),
      url: i.url,
      title: i.title.slice(0, 500),
      excerpt: i.excerpt,
      diff: (i as Item & { diff?: string }).diff ?? null,
      published_at: i.published_at,
      tags: s.tags,
    }));
    const { data, error } = await db.from("ra_alerts")
      .upsert(rows, { onConflict: "source_id,fingerprint", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(`Insert alert: ${error.message}`);
    inserted = data?.length ?? 0;
  }

  await db.from("ra_sources").update({
    last_checked_at: new Date().toISOString(),
    last_status: inserted ? "changed" : "ok",
    last_error: null,
    last_hash: hash,
    last_snapshot: snapshot,
  }).eq("id", s.id);

  return { source: s.name, new: inserted, baseline: firstRun };
}

/** Recupera il testo della pagina collegata quando l'alert non ha già un estratto sufficiente. */
async function textForAi(a: { url: string | null; excerpt: string | null; diff: string | null }) {
  if (a.diff) return a.diff;
  if (a.excerpt && a.excerpt.length > 300) return a.excerpt;
  if (a.url && !/\.pdf($|\?)/i.test(a.url)) {
    try {
      const { body } = await fetchText(a.url);
      return extractText(body).slice(0, 8000) || a.excerpt || "";
    } catch { /* ignora */ }
  }
  return a.excerpt ?? "";
}

async function enrichPending(db: SupabaseClient) {
  if (!Deno.env.get("ANTHROPIC_API_KEY")) return { enriched: 0, note: "ANTHROPIC_API_KEY non configurata" };
  const { data: settings } = await db.from("ra_settings").select("value").eq("key", "org_profile").maybeSingle();
  const { data: pending } = await db.from("ra_alerts_view")
    .select("id,title,url,excerpt,diff,tags,status,priority,source_authority")
    .is("ai_processed_at", null).order("detected_at", { ascending: false }).limit(AI_BATCH);
  let n = 0;
  const errors: string[] = [];
  for (const a of pending ?? []) {
    try {
      const r = await enrich(
        { title: a.title, authority: a.source_authority, url: a.url, text: await textForAi(a) },
        settings?.value ?? "",
      );
      if (!r) break;
      const patch: Record<string, unknown> = {
        ai_summary: r.summary, ai_relevance: r.relevance, ai_impact: r.impact, ai_topics: r.topics,
        ai_processed_at: new Date().toISOString(),
        tags: [...new Set([...(a.tags ?? []), ...r.topics.filter((t) => t !== "Altro")])],
      };
      // la priorità suggerita si applica solo se nessuno ha ancora fatto triage
      if (a.status === "new" && a.priority === "medium") patch.priority = r.priority;
      await db.from("ra_alerts").update(patch).eq("id", a.id);
      // date citate nel documento → proposte per lo scadenziario, da confermare nella dashboard
      if (r.deadlines.length) {
        const { data: have } = await db.from("ra_deadlines").select("due_date").eq("alert_id", a.id);
        const known = new Set((have ?? []).map((h: { due_date: string }) => h.due_date));
        const fresh = r.deadlines.filter((d) => !known.has(d.date) && !!known.add(d.date));
        if (fresh.length) {
          await db.from("ra_deadlines").insert(fresh.map((d) => ({
            title: d.label, due_date: d.date, kind: d.kind, authority: a.source_authority, url: a.url,
            alert_id: a.id, status: "proposed", source: "ai", created_by: null,
          })));
        }
      }
      n++;
    } catch (e) {
      errors.push(`#${a.id}: ${(e as Error).message}`);
      await db.from("ra_alerts").update({ ai_processed_at: new Date().toISOString(), ai_summary: null }).eq("id", a.id);
    }
  }
  return { enriched: n, errors };
}

async function testUrl(url: string) {
  const { body, contentType, finalUrl } = await fetchText(url);
  if (looksLikeFeed(body, contentType)) {
    const items = parseFeed(body, finalUrl);
    return { suggested_kind: "rss", items: items.slice(0, 10).map((i) => ({ title: i.title, url: i.url, published_at: i.published_at })) };
  }
  const feed = discoverFeed(body, finalUrl);
  const links = extractLinks(body, finalUrl);
  const text = extractText(body);
  return {
    suggested_kind: links.length >= 5 ? "links" : "page",
    discovered_feed: feed,
    title: stripHtml(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? ""),
    links: links.slice(0, 15),
    text_preview: text.slice(0, 800),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!(await authorize(req))) return json({ error: "non autorizzato" }, 401);

  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const body = await req.json().catch(() => ({}));

  if (body.test_url) {
    try { return json(await testUrl(String(body.test_url))); }
    catch (e) { return json({ error: (e as Error).message }, 400); }
  }

  let q = db.from("ra_sources").select("*").eq("active", true);
  if (body.source_id) q = db.from("ra_sources").select("*").eq("id", body.source_id);
  const { data: sources, error } = await q;
  if (error) return json({ error: error.message }, 500);

  const now = Date.now();
  const due = (sources as Source[]).filter((s) =>
    body.source_id || body.force || !s.last_checked_at ||
    now - new Date(s.last_checked_at).getTime() >= s.check_every_minutes * 60_000 - 60_000
  );

  const results: unknown[] = [];
  // concorrenza limitata per non sovraccaricare i siti delle autorità
  for (let i = 0; i < due.length; i += 4) {
    const batch = await Promise.all(due.slice(i, i + 4).map(async (s) => {
      try { return await processSource(db, s); }
      catch (e) {
        const msg = (e as Error).name === "AbortError" ? "Timeout" : (e as Error).message;
        await db.from("ra_sources").update({ last_checked_at: new Date().toISOString(), last_status: "error", last_error: msg.slice(0, 500) }).eq("id", s.id);
        return { source: s.name, error: msg };
      }
    }));
    results.push(...batch);
  }

  const ai = await enrichPending(db);
  return json({ checked: due.length, results, ai });
});
