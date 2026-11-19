// RegAlert — logica della dashboard (file separato per consentire una Content Security Policy senza script inline)
const CONFIG = { url: "https://cyyblaqhuevqlcjvtmsm.supabase.co", key: "sb_publishable_8k8LK1arFyuj7jbNL30fsQ_33zES9iB" };

const STATUS = { new: "Da valutare", in_review: "In valutazione", action_required: "Azione richiesta", closed: "Chiuso", not_relevant: "Non pertinente" };
const PRIORITY = { critical: "Critica", high: "Alta", medium: "Media", low: "Bassa" };
const POL_TYPE = { policy: "Policy", procedura: "Procedura", regolamento: "Regolamento", manuale: "Manuale", altro: "Altro" };
const POL_ST = { in_force: "In vigore", under_review: "In revisione", draft: "Bozza", retired: "Ritirata" };
let policies = [], polHistory = {};
const PRIO_LVL = { critical: 3, high: 3, medium: 2, low: 1 };
const RELEVANCE = { high: "Rilevanza alta", medium: "Rilevanza media", low: "Rilevanza bassa", none: "Non rilevante" };
const KIND = { rss: "Feed RSS", links: "Nuovi link", page: "Testo pagina" };
const ROLE = { pending: "In attesa", viewer: "Viewer", analyst: "Analyst", admin: "Admin" };
const TABS = [
  { k: "open", label: "Aperti", test: (a) => !["closed", "not_relevant"].includes(a.status) },
  { k: "new", label: "Nuovi", test: (a) => a.status === "new" },
  { k: "in_review", label: "In corso", test: (a) => a.status === "in_review" },
  { k: "action_required", label: "Da agire", test: (a) => a.status === "action_required" },
  { k: "done", label: "Archivio", test: (a) => ["closed", "not_relevant"].includes(a.status) },
];
const AUTH_COLORS = { "ESMA": "#0b6e5c", "EBA": "#1f4fa3", "EIOPA": "#6b4fb3", "Banca d'Italia": "#9a6a10", "Consob": "#b23a48", "UIF": "#7a3b8f", "EUR-Lex": "#2c5f8a", "Commissione UE": "#2c5f8a" };
const AUTH_SHORT = { "Banca d'Italia": "BdI", "Consob": "CONSOB", "Commissione UE": "UE", "EUR-Lex": "EUR", "FATF/GAFI": "FATF" };

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = (u) => /^https?:\/\//i.test(u || "") ? u : null;
const icon = (id, cls = "") => `<svg class="${cls}"><use href="#i-${id}"/></svg>`;
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
const isOpen = (a) => !["closed", "not_relevant"].includes(a.status);

function hashColor(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return `hsl(${h} 45% 38%)`; }
const authColor = (a) => AUTH_COLORS[a] || hashColor(a);
const authShort = (a) => AUTH_SHORT[a] || String(a || "?").replace(/[^A-Za-z]/g, "").slice(0, 5).toUpperCase();
const authBadge = (a) => { const t = authShort(a); return `<span class="auth-badge" style="background:${authColor(a)};--fs:${t.length >= 6 ? .58 : t.length === 5 ? .66 : t.length === 4 ? .8 : 1}">${esc(t)}</span>`; };
const initials = (n) => String(n || "?").split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((p) => p[0].toUpperCase()).join("");
const avatar = (p, cls = "") => `<span class="avatar ${cls}" style="background:${hashColor(p?.email || p?.full_name)}">${esc(initials(p?.full_name || p?.email))}</span>`;

const TZ = "Europe/Rome";
const dayKey = (d) => new Date(d).toLocaleDateString("sv-SE", { timeZone: TZ });
function relTime(d) {
  if (!d) return "—";
  const s = (Date.now() - new Date(d)) / 1000;
  if (s < 60) return "ora";
  if (s < 3600) return `${Math.floor(s / 60)} min fa`;
  if (s < 86400 && dayKey(d) === dayKey(Date.now())) return new Date(d).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
  if (s < 7 * 86400) return new Date(d).toLocaleDateString("it-IT", { weekday: "short", day: "numeric", timeZone: TZ });
  return new Date(d).toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric", timeZone: TZ });
}
const fullDate = (d, time = true) => d ? new Date(d).toLocaleString("it-IT", { day: "numeric", month: "long", year: "numeric", ...(time ? { hour: "2-digit", minute: "2-digit" } : {}), timeZone: TZ }) : "—";
function dayLabel(d) {
  const k = dayKey(d), today = dayKey(Date.now()), yest = dayKey(Date.now() - 86400000);
  if (k === today) return "Oggi";
  if (k === yest) return "Ieri";
  if (Date.now() - new Date(d) < 7 * 86400000) return "Questa settimana";
  return new Date(d).toLocaleDateString("it-IT", { month: "long", year: "numeric", timeZone: TZ }).replace(/^./, (c) => c.toUpperCase());
}
const daysTo = (d) => Math.ceil((new Date(d + "T23:59:59") - Date.now()) / 86400000);
function dueText(d) { const n = daysTo(d); return n < 0 ? `scaduto da ${-n} g` : n === 0 ? "scade oggi" : n === 1 ? "scade domani" : `scade tra ${n} g`; }

let toastT;
function toast(msg, opts = {}) {
  const t = $("#toast"); t.className = "toast" + (opts.bad ? " bad" : "");
  t.innerHTML = (opts.busy ? `<span class="spin"></span>` : opts.bad ? "" : icon("check")) + `<span>${esc(msg)}</span>`;
  t.querySelector("svg")?.setAttribute("style", "width:16px;height:16px");
  t.hidden = false; clearTimeout(toastT);
  if (!opts.busy) toastT = setTimeout(() => (t.hidden = true), opts.bad ? 6000 : 2600);
}
function confirmBox(title, text, yes) {
  return new Promise((res) => {
    const d = $("#dlg-confirm"); $("#cf-title").textContent = title; $("#cf-text").textContent = text; $("#cf-yes").textContent = yes;
    const done = (v) => { d.close(); res(v); };
    $("#cf-yes").onclick = () => done(true); $("#cf-no").onclick = () => done(false); d.oncancel = () => res(false);
    d.showModal();
  });
}
const show = (id) => { window.__raStarted = true; $("#v-fatal").hidden = true; ["v-config", "v-auth", "v-pending", "v-offline", "v-reset", "v-mfa", "v-app"].forEach((v) => ($("#" + v).hidden = v !== id)); };

// ---------------------------------------------------------------- stato
let sb, me, profiles = [], sources = [], alerts = [], selectedId = null, tab = "open", dirty = false;
let attests = [], attIntegrity = null;
let secState = {}, teamSec = {};   // stato di sicurezza dell'utente e MFA/ultimo accesso del team   // registro delle attestazioni e ultima verifica della catena
const canEdit = () => ["admin", "analyst"].includes(me?.role);

function resolveConfig() {
  if (!CONFIG.url.startsWith("__")) return CONFIG;
  const url = store.get("ra_url"), key = store.get("ra_key");
  return url && key ? { url, key } : null;
}

async function boot() {
  const cfg = resolveConfig();
  if (!cfg) { show("v-config"); return; }
  // link dell'email di recupero: arriva con #...type=recovery (oppure con un errore, se scaduto o già usato)
  const hp = new URLSearchParams(location.hash.slice(1));
  const recovering = hp.get("type") === "recovery";
  const linkError = hp.get("error_code") || hp.get("error");
  sb = supabase.createClient(cfg.url, cfg.key);
  sb.auth.onAuthStateChange((ev, s) => {
    if (ev === "SIGNED_OUT") { me = null; show("v-auth"); }
    if (ev === "PASSWORD_RECOVERY") showReset(s);
  });
  const { data: { session } } = await sb.auth.getSession();
  if (linkError) {
    history.replaceState(null, "", location.pathname);
    if (!session) {
      show("v-auth"); setAuthMode("forgot");
      authMsg(/expired|otp/i.test(linkError + hp.get("error_description")) ? "Il link è scaduto o è già stato usato. Inserisci la tua email per riceverne uno nuovo." : "Il link non è valido. Richiedine uno nuovo.", true);
      return;
    }
  }
  if (recovering && session) { showReset(session); return; }
  if (!session) { show("v-auth"); return; }
  if (!navigator.onLine) { show("v-offline"); return; }
  await enter();
}

async function enter() {
  const { data: { user }, error: uerr } = await sb.auth.getUser();
  if (!user && (!navigator.onLine || uerr?.name === "AuthRetryableFetchError")) { show("v-offline"); return; }
  if (!user) { show("v-auth"); return; }
  // secondo passaggio: chi ha attivato l'app di autenticazione deve inserire il codice prima di vedere i dati
  const { data: lvl } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  if (lvl && lvl.nextLevel === "aal2" && lvl.currentLevel !== "aal2") { showMfa("challenge"); return; }
  let { data: prof, error } = await sb.from("ra_profiles").select("*").eq("id", user.id).maybeSingle();
  if (!error && !prof) {
    await sb.rpc("ra_join");
    ({ data: prof, error } = await sb.from("ra_profiles").select("*").eq("id", user.id).maybeSingle());
  }
  if (error || !prof) { show("v-auth"); authMsg("Non riesco a caricare il profilo. Riprova tra qualche secondo.", true); return; }
  me = prof;
  if (me.role === "pending") { show("v-pending"); return; }
  const { data: sec } = await sb.rpc("ra_security_status");
  secState = sec || {};
  if (secState.require_mfa && !secState.has_factor) { showMfa("enroll"); return; }
  startIdleWatch();
  show("v-app");
  $("#me-avatar").outerHTML = avatar(me).replace('class="avatar "', 'class="avatar" id="me-avatar"');
  $("#me-name-side").textContent = me.full_name || me.email;
  $("#me-role-side").textContent = ROLE[me.role];
  $$("[data-admin]").forEach((e) => (e.hidden = me.role !== "admin"));
  $$("[data-edit]").forEach((e) => (e.hidden = !canEdit()));
  $("#f-priority").innerHTML = `<option value="">Priorità</option>` + Object.entries(PRIORITY).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
  tab = store.get("ra_tab") || "open";
  await Promise.all([loadProfiles(), loadSources(), loadAlerts(true), loadDeadlines(), loadPolicies()]);
  go(location.hash.slice(1) || store.get("ra_view") || "alerts");
  if (!window.__raLive) window.__raLive = sb.channel("ra-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "ra_alerts" }, () => loadAlerts(true))
    .on("postgres_changes", { event: "*", schema: "public", table: "ra_deadlines" }, () => loadDeadlines())
    .on("postgres_changes", { event: "*", schema: "public", table: "ra_policies" }, () => loadPolicies())
    .subscribe();
}

function go(view) {
  if (!VIEWS.includes(view)) view = "alerts";
  if (view === "settings" && me.role !== "admin") view = "alerts";
  $$("#nav button, #tabbar button[data-view]").forEach((b) => b.dataset.view === view ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"));
  VIEWS.forEach((v) => ($("#view-" + v).hidden = v !== view));
  $("#view-title").textContent = { alerts: "Alert", deadlines: "Scadenziario", policies: "Politiche", sources: "Fonti", team: "Team", settings: "Impostazioni" }[view];
  $("#search-box").hidden = view !== "alerts";
  store.set("ra_view", view);
  if (location.hash.slice(1) !== view) history.replaceState(null, "", "#" + view);
  closeNav();
  if (view === "alerts") renderAlerts();
  if (view === "sources") renderSources();
  if (view === "team") renderTeam();
  if (view === "settings") loadSettings();
  if (view === "deadlines") renderDeadlines();
  if (view === "policies") renderPolicies();
}
const VIEWS = ["alerts", "deadlines", "policies", "sources", "team", "settings"];
const closeNav = () => { $("#v-app").classList.remove("nav-open"); $("#scrim").hidden = true; };

// ---------------------------------------------------------------- dati
async function loadProfiles() {
  const [{ data }, ts] = await Promise.all([sb.from("ra_profiles").select("*").order("created_at"), sb.rpc("ra_team_security")]);
  profiles = data || [];
  teamSec = Object.fromEntries((ts.data || []).map((r) => [r.user_id, r]));
  const pend = profiles.filter((p) => p.role === "pending").length;
  $("#nav-pending").hidden = !(pend && me.role === "admin"); $("#nav-pending").textContent = pend;
}
async function loadSources() {
  const { data } = await sb.from("ra_sources").select("id,name,authority,jurisdiction,url,kind,link_pattern,css_selector,tags,active,check_every_minutes,last_checked_at,last_status,last_error").order("authority").order("name");
  sources = data || [];
  const cur = $("#f-authority").value;
  $("#f-authority").innerHTML = `<option value="">Autorità</option>` + [...new Set(sources.map((s) => s.authority))].sort().map((a) => `<option>${esc(a)}</option>`).join("");
  $("#f-authority").value = cur;
  renderHealth();
}
async function loadAlerts(silent = false) {
  const { data, error } = await sb.from("ra_alerts_view")
    .select("id,source_id,url,title,excerpt,diff,published_at,detected_at,tags,ai_summary,ai_relevance,ai_impact,ai_processed_at,status,priority,assignee,assignee_name,impact_assessment,actions,due_date,closed_at,source_name,source_authority,jurisdiction")
    .order("detected_at", { ascending: false }).limit(1000);
  if (error) { if (!silent) toast("Non riesco a caricare gli alert: " + error.message, { bad: true }); return; }
  alerts = data || [];
  const cur = $("#f-tag").value;
  $("#f-tag").innerHTML = `<option value="">Tema</option>` + [...new Set(alerts.flatMap((a) => a.tags || []))].sort().map((t) => `<option>${esc(t)}</option>`).join("");
  $("#f-tag").value = cur;
  const open = alerts.filter((a) => a.status === "new").length;
  $("#nav-count").hidden = !open; $("#nav-count").textContent = open;
  if (typeof updateDlBadge === "function" && me) updateDlBadge();
  if (!$("#view-alerts").hidden) { renderAlerts(); if (selectedId && !dirty) renderDetail(); }
}

function renderHealth() {
  const active = sources.filter((s) => s.active);
  const errs = active.filter((s) => s.last_status === "error");
  const last = active.map((s) => s.last_checked_at).filter(Boolean).sort().at(-1);
  $("#nav-src-err").hidden = !errs.length; $("#nav-src-err").textContent = errs.length;
  $("#side-health").innerHTML = `
    <div class="row-h"><span>Fonti attive</span><b style="color:#fff">${active.length}</b></div>
    <div class="row-h"><span>Con errori</span><b style="color:${errs.length ? "#ff9d8f" : "#fff"}">${errs.length}</b></div>
    <div class="row-h"><span>Ultimo controllo</span><b style="color:#fff">${last ? relTime(last) : "mai"}</b></div>`;
}

// ---------------------------------------------------------------- alert: elenco
function filtered(ignoreTab = false) {
  const q = $("#q").value.trim().toLowerCase();
  const au = $("#f-authority").value, tg = $("#f-tag").value, pr = $("#f-priority").value, mine = $("#f-mine").getAttribute("aria-pressed") === "true";
  const t = TABS.find((x) => x.k === tab) || TABS[0];
  return alerts.filter((a) =>
    (ignoreTab || t.test(a)) && (!au || a.source_authority === au) && (!tg || (a.tags || []).includes(tg)) && (!pr || a.priority === pr) &&
    (!mine || a.assignee === me.id) && (!q || `${a.title} ${a.ai_summary || ""} ${a.excerpt || ""} ${a.source_authority}`.toLowerCase().includes(q)));
}

function renderAlerts() {
  const base = filtered(true);
  $("#tabs").innerHTML = TABS.map((t) => `<button role="tab" data-tab="${t.k}" aria-selected="${t.k === tab}">${t.label}<span class="n">${base.filter(t.test).length}</span></button>`).join("");
  ["#f-authority", "#f-tag", "#f-priority"].forEach((s) => $(s).classList.toggle("on", !!$(s).value));
  const anyFilter = $("#f-authority").value || $("#f-tag").value || $("#f-priority").value || $("#f-mine").getAttribute("aria-pressed") === "true" || $("#q").value;
  $("#f-clear").hidden = !anyFilter;

  const rows = filtered();
  if (!rows.length) {
    const none = !alerts.length;
    $("#list").innerHTML = `<div class="empty">${icon("inbox")}<h3>${none ? "Ancora nessun alert" : anyFilter ? "Nessun risultato" : "Tutto valutato"}</h3><p>${
      none ? "Le fonti hanno registrato lo stato di partenza. Le novità compariranno qui dai prossimi controlli, ogni 30 minuti."
      : anyFilter ? "Nessun alert corrisponde ai filtri scelti." : "Non ci sono alert in questa scheda."}</p>${anyFilter ? `<button class="btn sm" data-clear>Azzera i filtri</button>` : ""}</div>`;
  } else {
    let html = "", last = "";
    for (const a of rows) {
      const g = dayLabel(a.detected_at);
      if (g !== last) { html += `<div class="group">${g}</div>`; last = g; }
      html += `<div class="item ${a.status === "new" ? "unread" : ""}" role="option" tabindex="-1" data-id="${a.id}" aria-selected="${a.id === selectedId}">
        ${authBadge(a.source_authority)}
        <div class="body">
          <div class="top"><b>${esc(a.source_authority)}</b><span>${esc(a.source_name.replace(/^.*?—\s*/, ""))}</span><span class="time">${relTime(a.detected_at)}</span></div>
          <div class="title">${esc(a.title)}</div>
          <div class="meta">
            ${a.status !== "new" ? `<span class="badge s-${a.status}"><span class="dot"></span>${STATUS[a.status]}</span>` : ""}
            ${a.ai_relevance && a.ai_relevance !== "none" && a.ai_relevance !== "low" ? `<span class="badge r-${a.ai_relevance}">${RELEVANCE[a.ai_relevance]}</span>` : ""}
            ${["critical", "high"].includes(a.priority) ? `<span class="badge p-${a.priority}" style="background:transparent;padding:0"><span class="prio" data-l="3"><i></i><i></i><i></i></span>${PRIORITY[a.priority]}</span>` : ""}
            ${a.due_date && isOpen(a) ? `<span class="${daysTo(a.due_date) <= 3 ? "due-soon" : "muted"}">${dueText(a.due_date)}</span>` : ""}
            ${(a.tags || []).slice(0, 3).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}
            ${a.assignee ? `<span style="margin-left:auto" title="${esc(a.assignee_name || "")}">${avatar(profiles.find((p) => p.id === a.assignee), "sm")}</span>` : ""}
          </div>
        </div></div>`;
    }
    $("#list").innerHTML = html;
  }
  $("#list-foot").textContent = `${rows.length} alert`;
  if (!selectedId || !rows.some((a) => a.id === selectedId)) {
    if (!matchMedia("(max-width: 860px)").matches && rows[0] && !dirty) select(rows[0].id, false);
    else if (!rows.some((a) => a.id === selectedId)) { selectedId = null; renderDetail(); }
  }
}

async function select(id, focus = true) {
  if (dirty && id !== selectedId && !(await confirmBox("Modifiche non salvate", "Hai modificato il triage di questo alert senza salvarlo. Vuoi uscire e perdere le modifiche?", "Esci senza salvare"))) return;
  dirty = false;
  selectedId = id;
  $$(".item").forEach((x) => x.setAttribute("aria-selected", Number(x.dataset.id) === id));
  if (focus) $(`.item[data-id="${id}"]`)?.scrollIntoView({ block: "nearest" });
  $("#view-alerts").classList.toggle("show-detail", !!id);
  renderDetail();
  if (focus && matchMedia("(max-width: 860px)").matches) $(".content").scrollTop = 0;
}

// ---------------------------------------------------------------- alert: dettaglio
function renderDetail() {
  const a = alerts.find((x) => x.id === selectedId);
  const r = $("#reader");
  if (!a) {
    r.innerHTML = `<div class="empty">${icon("doc")}<h3>Seleziona un alert</h3><p>Qui trovi la sintesi, il testo originale e il triage dell'alert.</p>
      <div class="shortcuts"><span><kbd>j</kbd> <kbd>k</kbd> scorri</span><span><kbd>/</kbd> cerca</span><span><kbd>t</kbd> prendo in carico</span><span><kbd>o</kbd> apri originale</span></div></div>`;
    return;
  }
  const ed = canEdit(), url = safeUrl(a.url);
  const members = profiles.filter((p) => ["analyst", "admin"].includes(p.role));
  const dis = ed ? "" : "disabled";
  const diffHtml = a.diff ? a.diff.split("\n").map((l) => `<span class="${l.startsWith("+ ") ? "add" : l.startsWith("- ") ? "del" : ""}">${esc(l)}</span>`).join("") : "";
  const quick = !ed ? "" : a.status === "new"
    ? `<button class="btn primary" data-quick="take">${icon("user")}Prendo in carico</button><button class="btn" data-quick="nr">Non pertinente</button>`
    : isOpen(a)
      ? `${a.assignee !== me.id ? `<button class="btn" data-quick="take">${icon("user")}Assegna a me</button>` : ""}${a.status !== "action_required" ? `<button class="btn" data-quick="action">${icon("flag")}Richiede azione</button>` : ""}<button class="btn" data-quick="close">${icon("check")}Chiudi</button>`
      : `<button class="btn" data-quick="reopen">Riapri</button>`;

  r.innerHTML = `<div class="reader-in">
    <button class="btn ghost sm back" id="b-back">${icon("back")}Alert</button>
    <header class="doc-head">
      <div class="doc-src">${authBadge(a.source_authority)}<span><b style="color:var(--fg)">${esc(a.source_authority)}</b> · ${esc(a.source_name.replace(/^.*?—\s*/, ""))}</span>
        <span>·</span><span title="${esc(fullDate(a.detected_at))}">Rilevato ${relTime(a.detected_at)}</span>
        ${a.published_at ? `<span>·</span><span>Pubblicato il ${fullDate(a.published_at, false)}</span>` : ""}</div>
      <h2>${esc(a.title)}</h2>
      <div class="doc-actions">
        ${url ? `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener">${icon("ext")}Apri l'originale</a>` : ""}
        ${quick}
        <span style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap">${(a.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</span>
      </div>
    </header>

    ${a.ai_summary ? `<section class="card ai">
        <div class="ai-h">${icon("spark")}<span class="eyebrow" style="color:var(--accent)">Sintesi automatica</span>${a.ai_relevance ? `<span class="badge r-${a.ai_relevance}" style="margin-left:auto">${RELEVANCE[a.ai_relevance]}</span>` : ""}</div>
        <p>${esc(a.ai_summary)}</p>
        ${a.ai_impact ? `<div class="impact"><div class="eyebrow" style="margin-bottom:4px">Possibile impatto</div><p>${esc(a.ai_impact)}</p></div>` : ""}
        <div class="disc">Valutazione preliminare generata automaticamente: verifica sempre sul testo ufficiale.</div>
      </section>`
      : `<div class="card ai-empty">${icon("spark")}<span>${a.ai_processed_at ? "La sintesi automatica non è riuscita per questo alert: apri l'originale per leggerlo." : "La sintesi automatica arriverà al prossimo controllo, se la chiave Anthropic è configurata."}</span></div>`}

    ${diffHtml ? `<section><div class="section-h"><h3>Cosa è cambiato nella pagina</h3><span class="hint">verde aggiunto · rosso rimosso</span></div><div class="card"><pre class="diff">${diffHtml}</pre></div></section>` : ""}
    ${a.excerpt && !a.diff ? `<section><div class="section-h"><h3>Estratto</h3></div><div class="card"><div class="excerpt">${esc(a.excerpt)}</div></div></section>` : ""}

    <section>
      <div class="section-h"><h3>Triage</h3>${ed ? "" : `<span class="hint">Solo lettura: il tuo ruolo è Viewer.</span>`}</div>
      <form class="card triage" id="f-triage">
        <div class="props">
          <div class="prop"><span class="eyebrow">Stato</span><select id="t-status" ${dis}>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${a.status === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
          <div class="prop"><span class="eyebrow">Priorità</span><select id="t-priority" ${dis}>${Object.entries(PRIORITY).map(([k, v]) => `<option value="${k}" ${a.priority === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
          <div class="prop"><span class="eyebrow">Responsabile</span><select id="t-assignee" ${dis}><option value="">Nessuno</option>${members.map((p) => `<option value="${p.id}" ${a.assignee === p.id ? "selected" : ""}>${esc(p.full_name || p.email)}${p.id === me.id ? " (tu)" : ""}</option>`).join("")}</select></div>
          <div class="prop"><span class="eyebrow">Scadenza interna</span><input type="date" id="t-due" value="${a.due_date || ""}" ${dis}></div>
        </div>
        <div class="triage-body">
          <div class="field"><label for="t-impact">Valutazione d'impatto</label><textarea id="t-impact" ${dis} placeholder="Quali processi, policy o controlli interni sono toccati? Se non è pertinente, spiega perché.">${esc(a.impact_assessment || "")}</textarea></div>
          <div class="field"><label for="t-actions">Azioni da intraprendere</label><textarea id="t-actions" ${dis} placeholder="Es. aggiornare la procedura KYC entro il 30/11; informare il CdA.">${esc(a.actions || "")}</textarea></div>
        </div>
        ${ed ? `<div class="savebar"><span class="state" id="save-state">Nessuna modifica</span><span class="spacer"></span><button type="button" class="btn ghost sm" id="b-revert" hidden>Annulla modifiche</button><button class="btn primary" id="b-save" disabled>Salva</button></div>` : ""}
      </form>
    </section>

    <section>
      <div class="section-h"><h3>Scadenze e attività collegate</h3>${ed ? `<span style="margin-left:auto;display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="btn ghost sm" data-task-from-alert="${a.id}">${icon("task")}Crea attività</button><button type="button" class="btn ghost sm" id="b-dl-from-alert">${icon("plus")}Aggiungi allo scadenziario</button></span>` : ""}</div>
      <div class="card linked" id="linked-dl">${linkedDeadlinesHtml(a)}</div>
    </section>

    <section>
      <div class="section-h"><h3>Storico e commenti</h3><span class="hint">registro non modificabile</span></div>
      <div class="card">
        ${ed ? `<form class="comment-form" id="f-comment"><input id="c-text" placeholder="Scrivi un commento per il team" aria-label="Commento"><button class="btn">Invia</button></form>` : ""}
        <div class="timeline" id="timeline"><div class="ev"><span class="ic"></span><span class="txt muted">Caricamento…</span></div></div>
      </div>
    </section>
  </div>`;
  loadTimeline(a.id);
}

const EV = {
  created: ["dot", "ha rilevato la novità"], status: ["dot", "ha cambiato lo stato"], priority: ["flag", "ha cambiato la priorità"], assignee: ["user", "ha cambiato il responsabile"],
  assessment: ["doc", "ha aggiornato la valutazione d'impatto"], actions: ["doc", "ha aggiornato le azioni"], due_date: ["cal", "ha impostato la scadenza"], comment: ["chat", "ha commentato"],
};
async function loadTimeline(id) {
  const { data } = await sb.from("ra_alert_events").select("*").eq("alert_id", id).order("created_at", { ascending: false });
  if (id !== selectedId || !$("#timeline")) return;
  const who = (uid) => uid ? esc(profiles.find((p) => p.id === uid)?.full_name || "Un membro del team") : "RegAlert";
  const val = (e, v) => esc(e.action === "status" ? STATUS[v] || v : e.action === "priority" ? PRIORITY[v] || v : e.action === "due_date" && v ? fullDate(v, false) : v);
  $("#timeline").innerHTML = (data || []).map((e) => {
    const [ic, verb] = EV[e.action] || ["dot", e.action];
    let extra = "";
    if (e.action === "comment") extra = `<div class="quote">${esc(e.note)}</div>`;
    else if (["assessment", "actions"].includes(e.action)) extra = `<div class="quote">${esc(e.to_value || "(testo rimosso)")}</div>`;
    else if (e.action !== "created") extra = `: <span class="muted">${val(e, e.from_value) || "—"}</span> → <b>${val(e, e.to_value) || "—"}</b>`;
    return `<div class="ev"><span class="ic">${icon(ic)}</span><div class="txt"><b>${who(e.actor)}</b> ${verb}${extra.startsWith(":") ? extra : ""}<span class="when" title="${esc(fullDate(e.created_at))}">${relTime(e.created_at)}</span>${extra.startsWith(":") ? "" : extra}</div></div>`;
  }).join("") || `<div class="ev"><span class="ic"></span><span class="txt muted">Nessun evento.</span></div>`;
}

function triageValues() {
  return { status: $("#t-status").value, priority: $("#t-priority").value, assignee: $("#t-assignee").value || null,
    due_date: $("#t-due").value || null, impact_assessment: $("#t-impact").value.trim() || null, actions: $("#t-actions").value.trim() || null };
}
function markDirty() {
  const a = alerts.find((x) => x.id === selectedId); if (!a || !$("#b-save")) return;
  const v = triageValues();
  dirty = Object.keys(v).some((k) => (v[k] ?? null) !== (a[k] ?? null));
  $("#b-save").disabled = !dirty; $("#b-revert").hidden = !dirty;
  $("#save-state").textContent = dirty ? "Modifiche non salvate" : "Nessuna modifica";
  $("#save-state").classList.toggle("dirty", dirty);
}
async function saveTriage(patch, msg = "Triage salvato") {
  if (patch.status === "not_relevant" && !(patch.impact_assessment ?? $("#t-impact")?.value.trim())) {
    toast("Per archiviare come non pertinente scrivi il motivo nella valutazione d'impatto: resta nello storico per l'audit.", { bad: true });
    $("#t-impact")?.focus(); return false;
  }
  const { error } = await sb.from("ra_alerts").update(patch).eq("id", selectedId);
  if (error) { toast("Salvataggio non riuscito: " + error.message, { bad: true }); return false; }
  dirty = false; toast(msg);
  await loadAlerts(true); renderDetail();
  return true;
}

// ---------------------------------------------------------------- fonti
function renderSources() {
  const ed = canEdit();
  const active = sources.filter((s) => s.active), errs = active.filter((s) => s.last_status === "error");
  const week = alerts.filter((a) => Date.now() - new Date(a.detected_at) < 7 * 86400000).length;
  $("#src-stats").innerHTML = [
    [active.length, "fonti attive"], [errs.length, "con errori", errs.length ? "var(--crit)" : ""], [week, "novità negli ultimi 7 giorni"],
    [new Set(active.map((s) => s.authority)).size, "autorità coperte"],
  ].map(([n, l, c]) => `<div class="card stat"><b style="${c ? `color:${c}` : ""}">${n}</b><span>${l}</span></div>`).join("");
  $("#src-list").innerHTML = sources.length ? sources.map((s) => {
    const h = !s.active ? ["wait", "In pausa"] : s.last_status === "error" ? ["err", "Errore"] : s.last_checked_at ? ["ok", "Funziona"] : ["wait", "In attesa del primo controllo"];
    const every = s.check_every_minutes >= 1440 ? "ogni giorno" : s.check_every_minutes >= 60 ? `ogni ${s.check_every_minutes / 60} h` : `ogni ${s.check_every_minutes} min`;
    const n = alerts.filter((a) => a.source_id === s.id).length;
    return `<div class="src ${s.active ? "" : "paused"}">
      ${authBadge(s.authority)}
      <div style="min-width:0"><div class="name">${esc(s.authority)} · ${esc(s.name.replace(/^.*?—\s*/, ""))}</div>
        <a class="url" href="${esc(safeUrl(s.url) || "#")}" target="_blank" rel="noopener">${esc(s.url.replace(/^https?:\/\/(www\.)?/, ""))}</a>
        <div class="line2"><span class="health ${h[0]}"><i></i>${h[1]}</span><span>${KIND[s.kind]} · ${every}</span><span>Ultimo controllo ${s.last_checked_at ? relTime(s.last_checked_at) : "mai"}</span><span>${n} alert</span>${(s.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div></div>
      ${ed ? `<div class="acts"><button class="btn ghost sm" data-check="${s.id}" title="Controlla ora">${icon("refresh")}</button><button class="btn ghost sm" data-toggle="${s.id}">${s.active ? "Pausa" : "Riattiva"}</button><button class="btn sm" data-edit-src="${s.id}">Modifica</button></div>` : ""}
      ${s.active && s.last_status === "error" ? `<div class="errmsg">${esc(humanError(s.last_error))}</div>` : ""}
    </div>`;
  }).join("") : `<div class="empty">${icon("radar")}<h3>Nessuna fonte</h3><p>Aggiungi la prima pagina da monitorare.</p></div>`;
}
function humanError(e) {
  const m = String(e || "");
  if (/HTTP 404/.test(m)) return "La pagina non esiste più (errore 404): l'autorità potrebbe averla spostata. Aggiorna l'indirizzo.";
  if (/HTTP 403|HTTP 401/.test(m)) return "Il sito rifiuta l'accesso automatico. Prova un feed RSS o un'altra pagina della stessa autorità.";
  if (/Timeout/i.test(m)) return "Il sito non ha risposto in tempo. RegAlert riproverà al prossimo controllo.";
  if (/Nessun link/i.test(m)) return "La pagina non contiene link che corrispondono al filtro: verifica il filtro o il tipo di monitoraggio.";
  if (/non è un feed/i.test(m)) return "L'indirizzo non è un feed RSS: scegli \"Nuovi link\" o usa l'indirizzo del feed vero.";
  return m;
}

let editingSource = null;
const kindVal = () => $('input[name="s-kind"]:checked').value;
function openSourceForm(s = null) {
  editingSource = s;
  $("#src-form-title").textContent = s ? "Modifica fonte" : "Nuova fonte";
  $("#s-url").value = s?.url || ""; $("#s-name").value = s?.name || ""; $("#s-authority").value = s?.authority || "";
  $("#s-jur").value = s?.jurisdiction || "EU";
  $$('input[name="s-kind"]').forEach((r) => (r.checked = r.value === (s?.kind || "links")));
  const ev = String(s?.check_every_minutes || 360);
  if (![...$("#s-every").options].some((o) => o.value === ev)) $("#s-every").insertAdjacentHTML("beforeend", `<option value="${ev}">Ogni ${ev} min</option>`);
  $("#s-every").value = ev;
  $("#s-tags").value = (s?.tags || []).join(", "); $("#s-pattern").value = s?.link_pattern || ""; $("#s-selector").value = s?.css_selector || "";
  $(".adv").open = !!(s?.link_pattern || s?.css_selector);
  $("#test-out").hidden = true; $("#b-delete-source").hidden = !s || me.role !== "admin";
  $("#dlg-source").showModal(); $("#s-url").focus();
}

async function callFn(name, body) {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (error) { let msg = error.message; try { msg = (await error.context.json()).error || msg; } catch {} throw new Error(msg); }
  return data;
}

// ---------------------------------------------------------------- team
function renderTeam() {
  $("#me-name").value = me.full_name || ""; $("#me-tg").value = me.telegram_chat_id || "";
  $("#me-daily").checked = me.notify_daily; $("#me-instant").checked = me.notify_instant;
  renderSecMe();
  const admin = me.role === "admin";
  const pend = profiles.filter((p) => p.role === "pending");
  $("#pending-box").innerHTML = admin && pend.length ? `<div class="pending-box">${icon("user")}<span>${pend.length === 1 ? "1 persona attende" : `${pend.length} persone attendono`} di essere approvata: assegna un ruolo qui sotto.</span></div>` : "";
  const order = { pending: 0, admin: 1, analyst: 2, viewer: 3 };
  $("#members").innerHTML = [...profiles].sort((a, b) => order[a.role] - order[b.role]).map((p) => `<div class="member">
    ${avatar(p)}
    <div style="min-width:0"><div class="nm">${esc(p.full_name || p.email)}${p.id === me.id ? ' <span class="muted" style="font-weight:400">(tu)</span>' : ""}</div>
      <div class="em">${esc(p.email)} · ${[p.notify_daily && "digest", p.notify_instant && "avvisi immediati", p.telegram_chat_id && "Telegram"].filter(Boolean).join(", ") || "nessuna notifica"}</div>
      <div class="em">${teamSec[p.id] ? `<span class="badge ${teamSec[p.id].has_mfa ? "mfa-on" : "mfa-off"}">${teamSec[p.id].has_mfa ? "2 passaggi attiva" : "senza 2 passaggi"}</span>` : ""}${teamSec[p.id]?.last_sign_in_at ? ` · ultimo accesso ${relTime(teamSec[p.id].last_sign_in_at)}` : ""}</div></div>
    ${admin && p.id !== me.id ? `<select data-role="${p.id}" aria-label="Ruolo di ${esc(p.email)}">${Object.entries(ROLE).map(([k, v]) => `<option value="${k}" ${p.role === k ? "selected" : ""}>${k === "pending" ? "Da approvare" : v}</option>`).join("")}</select>`
      : `<span class="badge role-txt ${p.role === "pending" ? "s-in_review" : ""}">${ROLE[p.role]}</span>`}
  </div>`).join("");
}

// ---------------------------------------------------------------- impostazioni
async function loadSettings() {
  const { data } = await sb.from("ra_settings").select("*");
  const m = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
  $("#set-org").value = m.org_profile || ""; $("#set-extra").value = m.digest_recipients_extra || "";
  $("#set-mfa").checked = m.require_mfa === "true"; $("#set-idle").value = m.idle_timeout_minutes || "30";
  loadAudit();
}

// ---------------------------------------------------------------- scadenziario
const DL_KIND = { regulatory: "Normativa", reporting: "Segnalazione", consultation: "Consultazione", internal: "Attività", control: "Controllo", policy: "Revisione politica" };
const canCompleteDl = (d) => !!d && d.status === "open" && (canEdit() || d.assignee === me.id);
const DL_REC = { weekly: "ogni settimana", monthly: "ogni mese", quarterly: "ogni trimestre", semiannual: "ogni semestre", yearly: "ogni anno" };
let deadlines = [], dlView = store.get("ra_dl_view") || "list", calMonth = null, editingDl = null;
const todayKey = () => dayKey(Date.now());
const dDays = (d) => Math.round((Date.parse(d + "T00:00:00Z") - Date.parse(todayKey() + "T00:00:00Z")) / 86400000);
const whenTxt = (n) => n < 0 ? `scaduta da ${-n} ${-n === 1 ? "giorno" : "giorni"}` : n === 0 ? "oggi" : n === 1 ? "domani" : `tra ${n} giorni`;
const whenCls = (n) => n < 0 ? "over" : n <= 7 ? "soon" : "later";
const MONTHS = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];

async function loadDeadlines() {
  const [{ data, error }, att] = await Promise.all([
    sb.from("ra_deadlines").select("*").order("due_date"),
    sb.from("ra_attestations").select("*").order("seq", { ascending: false }).limit(5000),
  ]);
  if (error) return;
  deadlines = data || [];
  if (!att.error) { attests = att.data || []; attIntegrity = null; }
  updateDlBadge();
  if (!$("#view-deadlines").hidden) renderDeadlines();
  if (selectedId && $("#linked-dl")) $("#linked-dl").innerHTML = linkedDeadlinesHtml(alerts.find((a) => a.id === selectedId));
}

function updateDlBadge() {
  const pres = deadlines.filter((d) => d.status === "open" && d.continuous).map((d) => d.due_date).sort();
  const open = [...deadlines.filter((d) => d.status === "open" && !d.continuous && d.due_date).map((d) => d.due_date), ...alerts.filter((a) => a.due_date && isOpen(a)).map((a) => a.due_date), ...pres.slice(0, 1)];
  const urgent = open.filter((d) => dDays(d) <= 7).length, late = open.some((d) => dDays(d) < 0);
  const props = deadlines.filter((d) => d.status === "proposed").length;
  const n = urgent + (canEdit() ? props : 0);
  $("#nav-dl").hidden = !n; $("#nav-dl").textContent = n;
  $("#nav-dl").style.background = late ? "var(--crit)" : "";
}

// scadenze manuali + scadenze di triage degli alert, in un formato unico
function dlItems({ includeDone = false } = {}) {
  const kind = $("#dl-f-kind").value, au = $("#dl-f-auth").value, ar = $("#dl-f-area").value, mine = $("#dl-f-mine").getAttribute("aria-pressed") === "true", withAlerts = $("#dl-f-alerts").getAttribute("aria-pressed") === "true";
  const items = deadlines.filter((d) => d.status !== "proposed" && (includeDone || d.status === "open")).map((d) => ({ ...d, _type: "dl" }));
  if (withAlerts) for (const a of alerts) if (a.due_date && (includeDone || isOpen(a)))
    items.push({ _type: "alert", id: "a" + a.id, alert_id: a.id, title: a.title, due_date: a.due_date, kind: "internal", authority: a.source_authority, assignee: a.assignee, status: isOpen(a) ? "open" : "done", recurrence: "none" });
  if ($("#dl-f-pol").getAttribute("aria-pressed") === "true") for (const p of policies) if (p.next_review && p.status !== "retired")
    items.push({ _type: "policy", id: "p" + p.id, policy_id: p.id, title: (p.code ? p.code + " · " : "") + p.title, due_date: p.next_review, kind: "policy", area: p.area, assignee: p.owner, owner_label: p.owner_label, status: "open", recurrence: "none", regulation: p.version ? "v" + p.version : null });
  return items.filter((d) => (!kind || d.kind === kind) && (!au || d.authority === au) && (!ar || d.area === ar) && (!mine || d.assignee === me.id))
    .sort((a, b) => (a.due_date || "9999").localeCompare(b.due_date || "9999") || PRI_RANK[a.priority || "medium"] - PRI_RANK[b.priority || "medium"]);
}
const PRI_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

function dateBox(d) {
  if (!d.due_date) return `<div class="datebox nodate" title="Senza data"><span>senza</span><b>—</b></div>`;
  const n = dDays(d.due_date), [y, m, dd] = d.due_date.split("-");
  const cls = d.status === "done" ? "" : n < 0 ? "over" : n <= 7 ? "soon" : "";
  return `<div class="datebox ${cls}" title="${esc(fullDate(d.due_date + "T12:00:00Z", false))}"><span>${MONTHS[+m - 1]}${y !== todayKey().slice(0, 4) ? " " + y.slice(2) : ""}</span><b>${+dd}</b></div>`;
}
function dlRow(d, compact = false) {
  const n = d.due_date ? dDays(d.due_date) : null, ed = canEdit(), who = profiles.find((p) => p.id === d.assignee);
  const isAlert = d._type === "alert", isPol = d._type === "policy", own = d._type === "dl" && canCompleteDl(d);
  const pre = isAlert ? "Triage · " : isPol ? "Revisione · " : "";
  return `<div class="dl ${d.status === "done" ? "done" : ""}" data-dl="${d.id}">
    ${dateBox(d)}
    <div style="min-width:0">
      <div class="dl-title">${pre ? `<span class="muted" style="font-weight:500">${pre}</span>` : ""}${esc(d.title)}</div>
      ${!compact && d.kind === "internal" && d.notes ? `<div class="dl-desc">${esc(d.notes)}</div>` : ""}
      <div class="dl-meta">
        ${d.status === "done" ? `<span>completata ${d.done_at ? relTime(d.done_at) : ""}</span>${d.outcome ? `<span class="badge out-${d.outcome}" title="${esc(d.outcome_note || "")}">${d.outcome === "ok" ? "conforme" : "con rilievi"}</span>` : ""}${attChip(d.id)}` : n === null ? `<span class="muted">senza data</span>` : `<span class="when ${whenCls(n)}">${whenTxt(n)}</span>`}${d.in_progress && d.status === "open" ? `<span class="badge st-doing">in corso</span>` : ""}${d.priority && d.priority !== "medium" ? `<span class="pri-${d.priority}" style="font-weight:600">${PRIORITY[d.priority].toLowerCase()}</span>` : ""}
        <span class="badge k-${d.kind}">${DL_KIND[d.kind]}</span>
        ${d.authority ? `<span>${esc(d.authority)}</span>` : ""}
        ${d.area ? `<span class="tag">${esc(d.area)}</span>` : ""}
        ${d.regulation ? `<span class="tag">${esc(d.regulation)}</span>` : ""}
        ${d.recurrence && d.recurrence !== "none" ? `<span title="Ricorrente">${icon("repeat").replace("<svg", '<svg style="width:13px;height:13px;vertical-align:-2px"')} ${DL_REC[d.recurrence]}</span>` : ""}
        ${who ? `<span style="display:inline-flex;gap:5px;align-items:center">${avatar(who, "sm")}${compact ? "" : esc(who.full_name || who.email)}</span>` : d.owner_label ? `<span>${icon("user").replace("<svg", '<svg style="width:13px;height:13px;vertical-align:-2px"')} ${esc(d.owner_label)}</span>` : `<span>senza responsabile</span>`}
        ${!compact && d.alert_id && !isAlert ? `<a href="#" data-goto-alert="${d.alert_id}">alert collegato</a>` : ""}
      </div>
    </div>
    <div class="dl-acts">
      ${isAlert ? `<button class="btn sm" data-goto-alert="${d.alert_id}">Apri alert</button>`
        : !ed && own ? `${d.kind === "internal" ? `<button class="btn ghost sm" data-progress="${d.id}" data-on="${d.in_progress ? 0 : 1}">${d.in_progress ? "Non in corso" : "Inizia"}</button>` : ""}<button class="btn sm" data-complete="${d.id}">${icon("check")}${d.kind === "control" || d.continuous ? "Attesta" : "Fatto"}</button>`
        : isPol ? `${ed ? `<button class="btn sm" data-pol-upd="${d.policy_id}">${icon("check")}Aggiornata</button>` : ""}<button class="btn ghost sm" data-open-pol="${d.policy_id}">Scheda</button>`
        : ed ? `${d.status === "open" && d.kind === "internal" && !compact ? `<button class="btn ghost sm" data-progress="${d.id}" data-on="${d.in_progress ? 0 : 1}">${d.in_progress ? "Non in corso" : "Inizia"}</button>` : ""}${d.status === "open" ? `<button class="btn sm" data-complete="${d.id}">${icon("check")}Completa</button>` : `<button class="btn ghost sm" data-reopen="${d.id}">Riapri</button>`}<button class="btn ghost sm" data-edit-dl="${d.id}">Modifica</button>` : ""}
    </div>
  </div>`;
}

function renderDeadlines() {
  const kinds = Object.entries(DL_KIND).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
  const curK = $("#dl-f-kind").value, curA = $("#dl-f-auth").value;
  $("#dl-f-kind").innerHTML = `<option value="">Tipo</option>${kinds}`; $("#dl-f-kind").value = curK;
  const auths = [...new Set([...deadlines.map((d) => d.authority), ...alerts.filter((a) => a.due_date).map((a) => a.source_authority)].filter(Boolean))].sort();
  $("#dl-f-auth").innerHTML = `<option value="">Autorità</option>${auths.map((a) => `<option>${esc(a)}</option>`).join("")}`; $("#dl-f-auth").value = curA;
  const areas = [...new Set(deadlines.map((d) => d.area).filter(Boolean))].sort(), curAr = $("#dl-f-area").value;
  $("#dl-f-area").innerHTML = `<option value="">Area</option>${areas.map((a) => `<option>${esc(a)}</option>`).join("")}`; $("#dl-f-area").value = curAr;
  $("#dl-f-area").parentElement.hidden = !areas.length;
  $("#dl-areas").innerHTML = areas.map((a) => `<option>${esc(a)}</option>`).join("");
  ["#dl-f-kind", "#dl-f-auth", "#dl-f-area"].forEach((s) => $(s).classList.toggle("on", !!$(s).value));
  $("#dl-v-list").setAttribute("aria-pressed", dlView === "list"); $("#dl-v-month").setAttribute("aria-pressed", dlView === "month");

  const all = dlItems();
  const open = all.filter((d) => !d.continuous);
  renderPresidi(all.filter((d) => d.continuous));
  const dated = open.filter((d) => d.due_date), nodate = open.filter((d) => !d.due_date);
  const over = dated.filter((d) => dDays(d.due_date) < 0), week = dated.filter((d) => dDays(d.due_date) >= 0 && dDays(d.due_date) <= 7);
  const month = dated.filter((d) => dDays(d.due_date) > 7 && dDays(d.due_date) <= 30), later = dated.filter((d) => dDays(d.due_date) > 30);
  $("#dl-stats").innerHTML = [[over.length, "scadute", over.length ? "var(--crit)" : ""], [week.length, "nei prossimi 7 giorni", week.length ? "var(--high)" : ""],
    [month.length, "entro 30 giorni"], [open.filter((d) => !d.assignee && !d.owner_label).length, "senza responsabile"]]
    .map(([n, l, c]) => `<div class="card stat"><b style="${c ? `color:${c}` : ""}">${n}</b><span>${l}</span></div>`).join("");

  const props = deadlines.filter((d) => d.status === "proposed");
  $("#dl-proposals").innerHTML = props.length && canEdit() ? `<div class="card proposals"><div class="ph">${icon("spark")}<b>Date trovate dall'AI nei documenti</b><span class="hint" style="margin-left:4px">Conferma quelle da tenere: finché non le confermi non entrano nello scadenziario né nel digest.</span></div>
    ${props.map((d) => `<div class="dl" data-dl="${d.id}">${dateBox(d)}<div style="min-width:0"><div class="dl-title">${esc(d.title)}</div><div class="dl-meta"><span class="badge k-${d.kind}">${DL_KIND[d.kind]}</span>${d.authority ? `<span>${esc(d.authority)}</span>` : ""}${d.alert_id ? `<a href="#" data-goto-alert="${d.alert_id}">dall'alert</a>` : ""}</div></div>
      <div class="dl-acts"><button class="btn sm primary" data-accept="${d.id}">Conferma</button><button class="btn ghost sm" data-edit-dl="${d.id}">Modifica</button><button class="btn ghost sm" data-reject="${d.id}">Scarta</button></div></div>`).join("")}</div>` : "";

  if (dlView === "month") { renderMonth(); return; }
  const group = (cls, label, list, note = "") => list.length ? `<div class="dl-group ${cls}"><div class="eyebrow">${label} <b>${list.length}</b>${note}</div><div class="card">${list.map((d) => dlRow(d)).join("")}</div></div>` : "";
  const done = dlItems({ includeDone: true }).filter((d) => d.status === "done" && !d.continuous).sort((a, b) => (b.done_at || b.due_date || "").localeCompare(a.done_at || a.due_date || "")).slice(0, 15);
  const body = group("overdue", "Scadute", over) + group("", "Prossimi 7 giorni", week) + group("", "Entro 30 giorni", month) + group("", "Più avanti", later) + group("", "Attività senza data", nodate) +
    (done.length ? `<details class="dl-group"><summary class="eyebrow" style="cursor:pointer;padding-bottom:8px">Completate di recente <b>${done.length}</b></summary><div class="card">${done.map((d) => dlRow(d)).join("")}</div></details>` : "");
  $("#dl-body").innerHTML = body || `<div class="card"><div class="empty">${icon("cal")}<h3>Nessuna scadenza in agenda</h3><p>Aggiungi scadenze normative e segnalazioni periodiche, oppure fissa una scadenza interna nel triage di un alert: comparirà qui.</p>${canEdit() ? `<button class="btn primary sm" data-new-dl>${icon("plus")}Nuova scadenza</button>` : ""}</div></div>`;
}

function renderMonth() {
  const base = calMonth || todayKey().slice(0, 7);
  const [y, m] = base.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)), startDow = (first.getUTCDay() + 6) % 7;
  const start = new Date(first.getTime() - startDow * 86400000);
  const items = dlItems({ includeDone: true }).filter((d) => !d.continuous && d.due_date);
  const byDay = {}; for (const d of items) (byDay[d.due_date] ||= []).push(d);
  const presByDay = {}; for (const d of dlItems().filter((x) => x.continuous)) presByDay[d.due_date] = (presByDay[d.due_date] || 0) + 1;
  let cells = "";
  for (let i = 0; i < 42; i++) {
    const day = new Date(start.getTime() + i * 86400000), k = day.toISOString().slice(0, 10);
    if (i >= 35 && day.getUTCMonth() !== m - 1) break;
    const evs = byDay[k] || [];
    const pres = presByDay[k] ? `<button class="cal-ev k-control" data-goto-presidi title="Attestazione dei presidi continuativi">Attestazione presidi (${presByDay[k]})</button>` : "";
    cells += `<div class="cal-d ${day.getUTCMonth() !== m - 1 ? "out" : ""} ${k === todayKey() ? "today" : ""}"><span class="n">${day.getUTCDate()}</span><div class="evs" style="display:grid;gap:3px">${pres}
      ${evs.slice(0, 3).map((d) => `<button class="cal-ev k-${d.kind} ${d.status === "done" ? "done" : ""}" ${d._type === "alert" ? `data-goto-alert="${d.alert_id}"` : d._type === "policy" ? `data-open-pol="${d.policy_id}"` : `data-edit-dl="${d.id}"`} title="${esc(d.title)}">${esc(d.title)}</button>`).join("")}
      ${evs.length > 3 ? `<span class="cal-more">+${evs.length - 3} altre</span>` : ""}</div></div>`;
  }
  const label = first.toLocaleDateString("it-IT", { month: "long", year: "numeric", timeZone: "UTC" }).replace(/^./, (c) => c.toUpperCase());
  $("#dl-body").innerHTML = `<div class="card" style="overflow:hidden">
    <div class="dlg-h" style="padding:12px 16px"><div class="cal-nav"><button class="btn ghost sm" data-cal="-1" aria-label="Mese precedente">${icon("left")}</button><b>${label}</b><button class="btn ghost sm" data-cal="1" aria-label="Mese successivo">${icon("right")}</button></div>
      <button class="btn sm" data-cal="0" style="margin-left:auto">Oggi</button></div>
    <div class="cal">${["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"].map((d) => `<div class="cal-h">${d}</div>`).join("")}${cells}</div></div>`;
}

function renderPresidi(list) {
  const box = $("#dl-presidi");
  const allDone = deadlines.filter((d) => d.continuous && d.status === "done");
  if (!list.length && !allDone.length) { box.innerHTML = ""; return; }
  // periodo corrente = attestazione aperta più vicina
  const period = list.map((d) => d.due_date).sort()[0] || allDone.map((d) => d.due_date).sort().at(-1);
  const pending = list.filter((d) => d.due_date <= period).sort((a, b) => a.title.localeCompare(b.title, "it", { numeric: true }));
  const attested = allDone.filter((d) => d.due_date === period).sort((a, b) => a.title.localeCompare(b.title, "it", { numeric: true }));
  const total = pending.length + attested.length, n = dDays(period);
  const late = pending.filter((d) => dDays(d.due_date) < 0).length;
  const monthLbl = new Date(period + "T12:00:00Z").toLocaleDateString("it-IT", { month: "long", year: "numeric", timeZone: "UTC" });
  const row = (d) => {
    const who = profiles.find((p) => p.id === d.assignee);
    const owner = who ? esc(who.full_name || who.email) : d.owner_label ? esc(d.owner_label) : "senza responsabile";
    const st = d.status === "done" ? (d.outcome || "ok") : "";
    return `<div class="pr ${st}"><span class="ic">${st ? icon("check") : ""}</span>
      <div style="min-width:0"><div class="t">${esc(d.title)}</div>
        <div class="dl-meta">${d.area ? `<span class="tag">${esc(d.area)}</span>` : ""}<span>${owner}</span>
          ${d.status === "done" ? `<span class="badge out-${st}">${st === "ok" ? "conforme" : "con rilievi"}</span><span>attestato ${relTime(d.done_at)}${d.done_by ? " da " + esc(profiles.find((p) => p.id === d.done_by)?.full_name || "un membro del team") : ""}</span>${attChip(d.id)}${d.outcome_note ? `<span title="${esc(d.outcome_note)}">· ${esc(d.outcome_note.slice(0, 80))}${d.outcome_note.length > 80 ? "…" : ""}</span>` : ""}` : dDays(d.due_date) < 0 ? `<span class="when over">${whenTxt(dDays(d.due_date))}</span>` : ""}</div></div>
      <div class="dl-acts">${canEdit() ? (d.status === "open" ? `<button class="btn sm" data-complete="${d.id}">${icon("check")}Attesta</button>` : "") + `<button class="btn ghost sm" data-edit-dl="${d.id}">Modifica</button>` : ""}</div></div>`;
  };
  const openNow = late > 0 || n <= 7;
  box.innerHTML = `<details class="card presidi" ${openNow || store.get("ra_presidi_open") === "1" ? "open" : ""}>
    <summary class="ph">
      <svg class="chev"><use href="#i-right"/></svg>
      <div><h3>Presidi continuativi</h3><div class="hint">Attestazione di ${monthLbl} · ${late ? `<span style="color:var(--crit);font-weight:600">${late} in ritardo</span>` : `entro il ${fullDate(period + "T12:00:00Z", false)} (${whenTxt(n)})`}</div></div>
      <div class="progress" aria-label="${attested.length} di ${total} attestati"><i style="width:${total ? Math.round(attested.length / total * 100) : 0}%"></i></div>
      <b class="mono">${attested.length}/${total}</b><span class="hint">attestati</span>
      <span style="margin-left:auto;display:flex;flex-wrap:wrap;gap:6px;min-width:0">
        <button type="button" class="btn ghost sm" id="b-pres-csv" title="Registro numerato delle attestazioni, esportabile in PDF e CSV">${icon("doc")}Registro</button>
        ${canEdit() && pending.length ? `<button type="button" class="btn sm" id="b-pres-all">${icon("check")}Attesta tutti conformi</button>` : ""}
      </span>
    </summary>
    ${pending.map(row).join("")}${attested.map(row).join("")}
  </details>`;
  box.querySelector("details").ontoggle = (e) => store.set("ra_presidi_open", e.target.open ? "1" : "0");
  $("#b-pres-csv").onclick = (e) => { e.preventDefault(); openRegister(d0period(period)); };
  if ($("#b-pres-all")) $("#b-pres-all").onclick = async (e) => {
    e.preventDefault();
    if (!(await confirmBox(`Attestare ${pending.length} presidi come conformi?`, `Ogni presidio ancora da attestare per ${monthLbl} viene registrato come conforme, a tuo nome e con l'ora attuale. Per segnalare un rilievo usa "Attesta" sulla singola riga.`, "Attesta tutti"))) return;
    toast("Registro le attestazioni…", { busy: true });
    let ok = 0;
    for (const d of pending) { const { error } = await sb.rpc("ra_complete_deadline", { p_id: d.id, p_outcome: "ok", p_note: null }); if (!error) ok++; }
    toast(`${ok} presidi attestati come conformi`, { bad: ok < pending.length }); loadDeadlines();
  };
}

// ---------------------------------------------------------------- registro delle attestazioni
// ogni attestazione ha numero progressivo, ID univoco e impronta SHA-256 concatenata alla precedente (migrazione 008)
const d0period = (due) => due ? due.slice(0, 7) : "";
const attFor = (deadlineId) => attests.find((a) => a.deadline_id === deadlineId);   // la più recente (ordine per seq decrescente)
const attChip = (deadlineId) => { const a = attFor(deadlineId); return a ? `<button class="att-no" data-att="${a.id}" title="Apri l'attestazione">${esc(a.number)}</button>` : ""; };
const attMonth = (a) => a.period.slice(0, 7);
const monthName = (ym) => new Date(ym + "-15T12:00:00Z").toLocaleDateString("it-IT", { month: "long", year: "numeric", timeZone: "UTC" });
const OUT_TXT = { ok: "Conforme", issues: "Con rilievi" };
const KIND_TXT = { presidio: "Presidio continuativo", controllo: "Controllo periodico" };
const stamp = (iso) => new Date(iso).toLocaleString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Rome" });

async function verifyChain(force = false) {
  if (attIntegrity && !force) return attIntegrity;
  const { data, error } = await sb.rpc("ra_verify_attestations");
  const r = error ? null : Array.isArray(data) ? data[0] : data;
  attIntegrity = r ? { total: +r.total, broken: +r.broken, first: r.first_broken, last: r.last_hash, at: new Date().toISOString() } : { error: error?.message || "verifica non disponibile" };
  return attIntegrity;
}
function integrityHtml(v) {
  if (!v) return `<span class="spin"></span>Verifico la catena delle impronte…`;
  if (v.error) return `${icon("flag")}<span>Non riesco a verificare il registro: ${esc(v.error)}</span>`;
  if (!v.total) return `${icon("doc")}<span>Il registro è vuoto: la prima attestazione riceverà il numero 1.</span>`;
  return v.broken ? `${icon("flag")}<span><b>Catena interrotta</b> a partire da ${esc(v.first)}: ${v.broken} attestazioni non corrispondono alla loro impronta. Segnalalo all'amministratore.</span>`
    : `${icon("check")}<span><b>Registro integro.</b> ${v.total} attestazioni, ogni impronta ricalcolata e collegata alla precedente.</span>`;
}

function openAttestation(attId) {
  const a = attests.find((x) => x.id === attId); if (!a) return;
  $("#att-h").textContent = a.number;
  const dl = (k, v, cls = "") => v ? `<dt>${k}</dt><dd class="${cls}">${v}</dd>` : "";
  $("#att-body").innerHTML = `
    <div class="integrity wait" id="att-int">${integrityHtml(attIntegrity)}</div>
    <dl class="kv">
      ${dl("Tipo", KIND_TXT[a.kind])}
      ${dl(a.kind === "presidio" ? "Presidio" : "Controllo", `<b>${esc(a.control_title)}</b>`)}
      ${dl("Codice del piano", a.control_code ? `<span class="mono">${esc(a.control_code)}</span>` : "")}
      ${dl("Area", esc(a.area || ""))}
      ${dl("Responsabile", esc(a.owner_label || ""))}
      ${dl("Periodo", a.kind === "presidio" ? monthName(a.period) : fullDate(a.period + "T12:00:00Z", false))}
      ${dl("Esito", `<span class="badge out-${a.outcome}">${OUT_TXT[a.outcome]}</span>`)}
      ${dl("Note ed evidenze", esc(a.note || "—").replace(/\n/g, "<br>"))}
      ${dl("Attestato da", `${esc(a.attested_by_name || "")}${a.attested_by_email ? ` <span class="muted">· ${esc(a.attested_by_email)}</span>` : ""}`)}
      ${dl("Data e ora", `${stamp(a.attested_at)} <span class="muted">(ora del server)</span>`)}
      ${a.backfilled ? dl("Nota", "Attestazione registrata prima dell'attivazione del registro e inserita in seguito con data e autore originali.") : ""}
      ${dl("ID univoco", `<span class="hash">${a.id}</span>`)}
      ${dl("Impronta SHA-256", `<span class="hash">${a.hash}</span>`)}
      ${dl("Impronta precedente", `<span class="hash">${a.prev_hash}</span>`)}
    </dl>`;
  $("#att-copy").onclick = async () => { try { await navigator.clipboard.writeText(`${a.number} · ${a.id}`); toast("ID copiato"); } catch { toast(a.id); } };
  $("#att-pdf").onclick = () => attestationPdf(a);
  $("#dlg-att").showModal();
  verifyChain().then((v) => { const el = $("#att-int"); if (el) { el.className = "integrity " + (v.error ? "wait" : v.broken ? "bad" : "good"); el.innerHTML = integrityHtml(v); } });
}

let regState = { period: "", kind: "" };
function regRows() { return attests.filter((a) => (!regState.period || attMonth(a) === regState.period) && (!regState.kind || a.kind === regState.kind)); }
function openRegister(period = "") {
  const months = [...new Set(attests.map(attMonth))].sort().reverse();
  regState.period = months.includes(period) ? period : months[0] || "";
  $("#reg-period").innerHTML = `<option value="">Tutti i periodi</option>` + months.map((m) => `<option value="${m}">${monthName(m)}</option>`).join("");
  $("#reg-period").value = regState.period; $("#reg-kind").value = regState.kind;
  renderRegister(); $("#dlg-reg").showModal();
  $("#reg-integrity").className = "integrity wait"; $("#reg-integrity").innerHTML = integrityHtml(null);
  verifyChain(true).then((v) => { $("#reg-integrity").className = "integrity " + (v.error ? "wait" : v.broken ? "bad" : "good"); $("#reg-integrity").innerHTML = integrityHtml(v); });
}
function renderRegister() {
  const rows = regRows();
  $("#reg-count").textContent = `${rows.length} attestazion${rows.length === 1 ? "e" : "i"}`;
  $("#reg-list").innerHTML = rows.length ? rows.map((a) => `<div class="reg-row" data-att="${a.id}" role="button" tabindex="0">
      <span class="att-no">${esc(a.number)}</span>
      <div style="min-width:0"><div class="t">${a.control_code ? `<span class="mono muted">${esc(a.control_code)}</span> · ` : ""}${esc(a.control_title)}</div>
        <div class="dl-meta"><span>${a.kind === "presidio" ? "Presidio · " + monthName(a.period) : "Controllo · " + fullDate(a.period + "T12:00:00Z", false)}</span><span>${esc(a.attested_by_name || "")}</span><span>${stamp(a.attested_at)}</span></div></div>
      <span class="badge out-${a.outcome}">${OUT_TXT[a.outcome].toLowerCase()}</span></div>`).join("")
    : `<div class="empty" style="padding:28px">${icon("doc")}<h3>Nessuna attestazione</h3><p>Le attestazioni compaiono qui appena un presidio o un controllo viene attestato.</p></div>`;
}
$("#reg-period").onchange = (e) => { regState.period = e.target.value; renderRegister(); };
$("#reg-kind").onchange = (e) => { regState.kind = e.target.value; renderRegister(); };
$("#reg-csv").onclick = () => exportAttestationsCsv(regRows());
$("#reg-pdf").onclick = () => registerPdf(regRows());
$("#b-reg").onclick = () => openRegister();
$$("dialog [data-close]").forEach((b) => (b.onclick = () => b.closest("dialog").close()));
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-att]"); if (!t || $("#v-app").hidden) return;
  e.preventDefault(); e.stopPropagation();
  if ($("#dlg-reg").open && !t.closest("#dlg-reg")) $("#dlg-reg").close();
  openAttestation(t.dataset.att);
}, true);
$("#reg-list").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.dataset.att) openAttestation(e.target.dataset.att); });

function exportAttestationsCsv(rows) {
  if (!rows.length) return toast("Nessuna attestazione da esportare");
  const cell = csvCell;
  const head = ["Numero", "ID univoco", "Tipo", "Codice piano", "Presidio o controllo", "Area", "Responsabile", "Periodo", "Esito", "Note ed evidenze", "Attestato da", "Email", "Data e ora (Europe/Rome)", "Data e ora (UTC, ISO 8601)", "Registrata successivamente", "Impronta SHA-256", "Impronta precedente"];
  const lines = [...rows].sort((a, b) => a.seq - b.seq).map((a) => [a.number, a.id, KIND_TXT[a.kind], a.control_code, a.control_title, a.area, a.owner_label, a.period, OUT_TXT[a.outcome], a.note, a.attested_by_name, a.attested_by_email, stamp(a.attested_at), new Date(a.attested_at).toISOString(), a.backfilled ? "sì" : "no", a.hash, a.prev_hash].map(cell).join(";"));
  const csv = "﻿" + [head.map(cell).join(";"), ...lines].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `regalert-registro-attestazioni${regState.period ? "-" + regState.period : ""}-${todayKey()}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`${rows.length} attestazioni esportate`); logEvent("export_register_csv", { rows: rows.length, period: regState.period || "tutti" });
}

// PDF: jsPDF caricato solo quando serve
let pdfLib = null;
function loadPdfLib() {
  if (pdfLib) return pdfLib;
  const add = (src) => new Promise((ok, ko) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => ko(new Error("libreria PDF non raggiungibile")); document.head.appendChild(s); });
  pdfLib = add("vendor/jspdf-2.5.1.umd.min.js")
    .then(() => add("vendor/jspdf-autotable-3.8.2.min.js"))
    .then(() => window.jspdf.jsPDF).catch((e) => { pdfLib = null; throw e; });
  return pdfLib;
}
// i font standard del PDF coprono il set latino occidentale: normalizza il resto
const pdfTxt = (v) => String(v ?? "").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, "...").replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ–—·€]/g, "?");
const NAVY = [24, 44, 77], GOLD = [242, 193, 78], GREY = [107, 122, 144], INK = [23, 34, 53];

function pdfHeader(doc, title, right) {
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(...NAVY); doc.rect(0, 0, W, 22, "F");
  doc.setFillColor(...GOLD); doc.circle(16, 11, 2.2, "F");
  doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text("RegAlert", 21, 12.6);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(200, 210, 228); doc.text(pdfTxt(title), 44, 12.6);
  doc.setFont("courier", "bold"); doc.setFontSize(11); doc.setTextColor(...GOLD); doc.text(pdfTxt(right), W - 14, 12.6, { align: "right" });
}
function pdfFooter(doc, line) {
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setDrawColor(225, 230, 238); doc.line(14, H - 14, W - 14, H - 14);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.setTextColor(...GREY);
    doc.text(doc.splitTextToSize(pdfTxt(line), W - 50), 14, H - 9.5);
    doc.text(`Pagina ${i} di ${n}`, W - 14, H - 9.5, { align: "right" });
  }
}
const genLine = (v) => `Generato da RegAlert il ${stamp(new Date().toISOString())} da ${me.full_name || me.email}. ` +
  (v && !v.error ? (v.broken ? `ATTENZIONE: catena delle impronte interrotta da ${v.first}.` : `Verifica della catena al momento dell'esportazione: integra (${v.total} attestazioni, impronta finale ${String(v.last).slice(0, 16)}...).`) : "Verifica della catena non disponibile.");

async function attestationPdf(a) {
  toast("Preparo il PDF…", { busy: true });
  let jsPDF, v;
  try { [jsPDF, v] = await Promise.all([loadPdfLib(), verifyChain()]); } catch (e) { return toast(e.message, { bad: true }); }
  const doc = new jsPDF({ unit: "mm", format: "a4" }), W = doc.internal.pageSize.getWidth(), L = 18, R = W - 18;
  doc.setProperties({ title: `${a.number} - ${a.control_title}`, subject: "Attestazione", author: a.attested_by_name || "", creator: "RegAlert" });
  pdfHeader(doc, "Registro attestazioni", a.number);
  let y = 38;
  doc.setTextColor(...GREY); doc.setFont("helvetica", "bold"); doc.setFontSize(8.5);
  doc.text((a.kind === "presidio" ? "ATTESTAZIONE DI PRESIDIO CONTINUATIVO" : "ATTESTAZIONE DI ESECUZIONE DEL CONTROLLO"), L, y);
  doc.setTextColor(...INK); doc.setFontSize(15);
  const title = doc.splitTextToSize(pdfTxt((a.control_code ? a.control_code + " · " : "") + a.control_title), R - L);
  doc.text(title, L, y += 8); y += title.length * 6.2 + 2;
  // esito
  const ok = a.outcome === "ok";
  doc.setFillColor(...(ok ? [230, 245, 236] : [253, 240, 226])); doc.roundedRect(L, y, R - L, 13, 2, 2, "F");
  doc.setTextColor(...(ok ? [22, 128, 75] : [180, 90, 10])); doc.setFont("helvetica", "bold"); doc.setFontSize(11);
  doc.text(`Esito: ${OUT_TXT[a.outcome]}`, L + 5, y + 8.3);
  doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
  doc.text(pdfTxt(a.kind === "presidio" ? `Periodo: ${monthName(a.period)}` : `Scadenza del controllo: ${fullDate(a.period + "T12:00:00Z", false)}`), R - 5, y + 8.3, { align: "right" });
  y += 20;
  const body = [
    ["Numero", a.number], ["Tipo", KIND_TXT[a.kind]], ["Codice del piano", a.control_code || "-"], ["Area", a.area || "-"], ["Responsabile", a.owner_label || "-"],
    ["Attestato da", `${a.attested_by_name || ""}${a.attested_by_email ? " <" + a.attested_by_email + ">" : ""}`],
    ["Data e ora", `${stamp(a.attested_at)} (Europe/Rome) - ${new Date(a.attested_at).toISOString()} UTC, ora del server`],
    ["Note ed evidenze", a.note || "-"],
  ];
  if (a.backfilled) body.push(["Nota", "Attestazione registrata prima dell'attivazione del registro e inserita in seguito con data e autore originali."]);
  doc.autoTable({ startY: y, margin: { left: L, right: 18 }, theme: "plain", body: body.map((r) => r.map(pdfTxt)),
    styles: { font: "helvetica", fontSize: 9.5, cellPadding: { top: 2.2, bottom: 2.2, left: 0, right: 4 }, textColor: INK, lineColor: [225, 230, 238], lineWidth: { bottom: 0.2 } },
    columnStyles: { 0: { cellWidth: 42, textColor: GREY } } });
  y = doc.lastAutoTable.finalY + 10;
  doc.setFont("helvetica", "bold"); doc.setFontSize(8.5); doc.setTextColor(...GREY); doc.text("DATI DI INTEGRITÀ", L, y); y += 3;
  doc.autoTable({ startY: y, margin: { left: L, right: 18 }, theme: "plain",
    body: [["ID univoco", a.id], ["Impronta SHA-256", a.hash], ["Impronta precedente", a.prev_hash],
      ["Verifica", v.error ? "non disponibile" : v.broken ? `catena interrotta da ${v.first}` : `catena integra al ${stamp(v.at)} (${v.total} attestazioni)`]].map((r) => r.map(pdfTxt)),
    styles: { font: "courier", fontSize: 8.5, cellPadding: { top: 1.8, bottom: 1.8, left: 0, right: 4 }, textColor: INK, overflow: "linebreak" },
    columnStyles: { 0: { cellWidth: 42, font: "helvetica", textColor: GREY } } });
  y = doc.lastAutoTable.finalY + 6;
  doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...GREY);
  const expl = doc.splitTextToSize("L'impronta è calcolata sui dati di questa attestazione e sull'impronta dell'attestazione precedente: qualsiasi modifica successiva al registro la renderebbe diversa. Per verificare il documento, confronta numero, ID e impronta con quelli presenti nel registro RegAlert.", R - L);
  doc.text(expl, L, y); y += expl.length * 3.6 + 14;
  if (y < 250) {
    doc.setDrawColor(...GREY); doc.line(L, y + 10, L + 70, y + 10); doc.line(R - 70, y + 10, R, y + 10);
    doc.setFontSize(8); doc.text("Luogo e data", L, y + 14.5); doc.text(pdfTxt("Firma — " + (a.attested_by_name || "")), R - 70, y + 14.5);
  }
  pdfFooter(doc, genLine(v));
  doc.save(`${a.number}${a.control_code ? "_" + a.control_code : ""}.pdf`);
  toast(`PDF di ${a.number} scaricato`); logEvent("export_attestation_pdf", { number: a.number });
}

async function registerPdf(rows) {
  if (!rows.length) return toast("Nessuna attestazione da esportare");
  toast("Preparo il PDF del registro…", { busy: true });
  let jsPDF, v;
  try { [jsPDF, v] = await Promise.all([loadPdfLib(), verifyChain()]); } catch (e) { return toast(e.message, { bad: true }); }
  rows = [...rows].sort((a, b) => a.seq - b.seq);
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" }), W = doc.internal.pageSize.getWidth();
  const scope = (regState.period ? monthName(regState.period) : "tutti i periodi") + (regState.kind ? ` · solo ${regState.kind === "presidio" ? "presidi" : "controlli"}` : "");
  doc.setProperties({ title: `Registro attestazioni - ${scope}`, creator: "RegAlert" });
  const ok = rows.filter((a) => a.outcome === "ok").length;
  doc.autoTable({
    startY: 50, margin: { top: 30, left: 14, right: 14, bottom: 20 },
    head: [["Numero", "Codice", "Presidio o controllo", "Area", "Periodo", "Esito", "Note ed evidenze", "Attestato da", "Data e ora", "Impronta (inizio)"]],
    body: rows.map((a) => [a.number + (a.backfilled ? " *" : ""), a.control_code || "", a.control_title, a.area || "", a.kind === "presidio" ? a.period : a.period.split("-").reverse().join("/"), OUT_TXT[a.outcome], a.note || "", a.attested_by_name || "", stamp(a.attested_at).slice(0, 17).replace(",", ""), a.hash.slice(0, 16)].map(pdfTxt)),
    styles: { font: "helvetica", fontSize: 7.6, cellPadding: 1.8, textColor: INK, lineColor: [225, 230, 238], lineWidth: 0.15, valign: "top" },
    headStyles: { fillColor: NAVY, textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [246, 248, 251] },
    columnStyles: { 0: { cellWidth: 31, font: "courier", fontStyle: "bold", fontSize: 7.4 }, 1: { cellWidth: 13 }, 2: { cellWidth: 50 }, 3: { cellWidth: 20 }, 4: { cellWidth: 18 }, 5: { cellWidth: 17 }, 6: { cellWidth: 46 }, 7: { cellWidth: 23 }, 8: { cellWidth: 23 }, 9: { cellWidth: 28, font: "courier", fontSize: 6.8 } },
    didParseCell: (c) => { if (c.section === "body" && c.column.index === 5) c.cell.styles.textColor = c.cell.raw === "Conforme" ? [22, 128, 75] : [180, 90, 10]; },
    didDrawPage: () => {
      pdfHeader(doc, "Registro attestazioni", scope);
      if (doc.getNumberOfPages() === 1) {
        doc.setTextColor(...INK); doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.text(pdfTxt("Registro attestazioni — " + scope), 14, 34);
        doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(...GREY);
        doc.text(pdfTxt(`${rows.length} attestazioni (${rows[0].number} – ${rows.at(-1).number}) · ${ok} conformi · ${rows.length - ok} con rilievi`), 14, 40.5);
        doc.text(pdfTxt(v.error ? "Verifica della catena non disponibile" : v.broken ? `ATTENZIONE: catena interrotta da ${v.first}` : `Catena delle impronte verificata il ${stamp(v.at)}: integra. Impronta finale del registro: ${v.last}`), 14, 45.5);
      }
    },
  });
  let y = doc.lastAutoTable.finalY + 6;
  if (rows.some((a) => a.backfilled)) { doc.setFontSize(7.5); doc.setTextColor(...GREY); doc.text("* Attestazione registrata prima dell'attivazione del registro e inserita in seguito con data e autore originali.", 14, y); }
  pdfFooter(doc, genLine(v) + " Ogni riga riporta i primi 16 caratteri dell'impronta SHA-256; impronte complete e ID univoci sono nel CSV e nel PDF di ogni attestazione.");
  doc.save(`Registro_attestazioni_${regState.period || "completo"}_${todayKey()}.pdf`);
  toast("PDF del registro scaricato"); logEvent("export_register_pdf", { rows: rows.length, period: regState.period || "tutti" });
}

// esito: chiesto per controlli e presidi, non per le altre scadenze
function askOutcome(d) {
  return new Promise((res) => {
    const dlg = $("#dlg-out");
    $("#out-title").textContent = d.continuous ? "Attestazione del presidio" : "Esito del controllo";
    $("#out-what").textContent = d.title;
    $("#out-ok-hint").textContent = d.continuous ? "Il presidio ha funzionato nel periodo." : "Nessun rilievo.";
    $("#o-save").textContent = d.continuous ? "Attesta" : "Registra e completa";
    $$('input[name="o-res"]').forEach((r) => (r.checked = r.value === "ok")); $("#o-note").value = "";
    const close = (v) => { dlg.close(); res(v); };
    $("#o-cancel").onclick = () => close(null);
    dlg.oncancel = () => res(null);
    $("#f-out").onsubmit = (e) => {
      e.preventDefault();
      const outcome = $('input[name="o-res"]:checked').value, note = $("#o-note").value.trim();
      if (outcome === "issues" && !note) { toast("Descrivi il rilievo nelle note: resta nello storico per l'audit.", { bad: true }); $("#o-note").focus(); return; }
      close({ outcome, note });
    };
    dlg.showModal();
  });
}

function linkedDeadlinesHtml(a) {
  if (!a) return "";
  const list = deadlines.filter((d) => d.alert_id === a.id && d.status !== "proposed").map((d) => ({ ...d, _type: "dl" }));
  const props = deadlines.filter((d) => d.alert_id === a.id && d.status === "proposed");
  return (list.map((d) => dlRow(d, true)).join("") +
    (props.length ? `<div class="ai-empty" style="border-top:1px solid var(--line)">${icon("spark")}<span>L'AI ha trovato ${props.length === 1 ? "una data" : props.length + " date"} in questo documento: confermale nello <a href="#deadlines">scadenziario</a>.</span></div>` : "")) ||
    (`<div class="ai-empty">${icon("cal")}<span>Nessuna scadenza o attività collegata. ${a.due_date ? "La scadenza interna del triage compare già nello scadenziario." : ""}</span></div>`);
}

async function setProgress(id, on) {
  const { error } = await sb.rpc("ra_set_in_progress", { p_id: id, p_on: on });
  if (error) return toast(error.message, { bad: true });
  toast(on ? "Segnata come in corso" : "Non più in corso"); loadDeadlines();
}
// la data è obbligatoria per tutto tranne che per le attività
function syncDlKind() {
  const k = $('input[name="d-kind"]:checked').value, task = k === "internal";
  $("#d-date-hint").hidden = !task; $("#fld-prog").hidden = !(task && editingDl?.status === "open");
  $("#d-title-lbl").textContent = task ? "Cosa fare" : "Cosa scade";
  $("#dl-form-title").textContent = editingDl ? (editingDl.status === "proposed" ? "Rivedi la data proposta" : task ? "Modifica attività" : "Modifica scadenza") : task ? "Nuova attività" : "Nuova scadenza";
}
$$('input[name="d-kind"]').forEach((r) => r.addEventListener("change", syncDlKind));
function openDlForm(d = null, fromAlert = null, opts = {}) {
  editingDl = d;
  const members = profiles.filter((p) => ["viewer", "analyst", "admin"].includes(p.role));
  $("#d-assignee").innerHTML = `<option value="">Nessuno</option>` + members.map((p) => `<option value="${p.id}">${esc(p.full_name || p.email)}${p.id === me.id ? " (tu)" : ""}</option>`).join("");
  $("#dl-form-title").textContent = d ? (d.status === "proposed" ? "Rivedi la data proposta" : "Modifica scadenza") : "Nuova scadenza";
  $("#d-title").value = d?.title || ""; $("#d-date").value = d?.due_date || "";
  $("#d-assignee").value = d?.assignee || (d ? "" : me.id);
  $$('input[name="d-kind"]').forEach((r) => (r.checked = r.value === (d?.kind || opts.kind || "regulatory")));
  $("#d-pri").value = d?.priority || "medium"; $("#d-prog").checked = !!d?.in_progress;
  if (!d && opts.title) $("#d-title").value = opts.title;
  $("#d-authority").value = d?.authority || fromAlert?.source_authority || ""; $("#d-reg").value = d?.regulation || "";
  $("#d-area").value = d?.area || ""; $("#d-owner-label").value = d?.owner_label || "";
  $("#d-rec").value = d?.recurrence || "none"; $("#d-remind").value = String(d?.remind_days ?? 7);
  if (![...$("#d-remind").options].some((o) => o.value === $("#d-remind").value)) $("#d-remind").value = "7";
  $("#d-url").value = d?.url || fromAlert?.url || ""; $("#d-notes").value = d?.notes || "";
  $("#d-cont").checked = !!d?.continuous;
  const linkId = d?.alert_id || fromAlert?.id;
  const la = linkId && alerts.find((a) => a.id === linkId);
  $("#dl-from-alert").hidden = !la; if (la) $("#dl-from-alert").innerHTML = `Collegata all'alert: <b>${esc(la.title)}</b>`;
  $("#dlg-dl").dataset.alertId = linkId || "";
  $("#b-del-dl").hidden = !d;
  syncDlKind();
  $("#dlg-dl").showModal(); $("#d-title").focus();
}

function exportIcs() {
  const items = dlItems().filter((d) => d.status === "open" && !d.continuous && d.due_date);
  const fold = (l) => l.replace(/(.{70})/g, "$1\r\n ").trimEnd();
  const tx = (t) => String(t || "").replace(/\\/g, "\\\\").replace(/[,;]/g, (c) => "\\" + c).replace(/\n/g, "\\n");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const ev = items.map((d) => {
    const day = d.due_date.replace(/-/g, ""), next = new Date(Date.parse(d.due_date + "T00:00:00Z") + 86400000).toISOString().slice(0, 10).replace(/-/g, "");
    const rr = { monthly: "FREQ=MONTHLY", quarterly: "FREQ=MONTHLY;INTERVAL=3", yearly: "FREQ=YEARLY" }[d.recurrence];
    const desc = [DL_KIND[d.kind], d.area, d.authority, d.regulation, d.owner_label && `Responsabile: ${d.owner_label}`, d.notes, d.url].filter(Boolean).join("\n");
    return ["BEGIN:VEVENT", `UID:regalert-${d.id}@regalert`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${day}`, `DTEND;VALUE=DATE:${next}`,
      fold(`SUMMARY:${tx(({ alert: "Triage: ", policy: "Revisione: " }[d._type] || (d.kind === "internal" ? "Attività: " : "")) + d.title)}`), fold(`DESCRIPTION:${tx(desc)}`), rr ? `RRULE:${rr}` : "",
      "BEGIN:VALARM", "ACTION:DISPLAY", `TRIGGER:-P${d.remind_days ?? 7}D`, fold(`DESCRIPTION:${tx(d.title)}`), "END:VALARM", "END:VEVENT"].filter(Boolean).join("\r\n");
  }).join("\r\n");
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//RegAlert//Scadenziario//IT", "CALSCALE:GREGORIAN", "X-WR-CALNAME:RegAlert scadenziario", ev, "END:VCALENDAR"].filter(Boolean).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
  a.download = `regalert-scadenziario-${todayKey()}.ics`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`${items.length} scadenze esportate: apri il file con Outlook o Google Calendar`);
}

function gotoAlert(id) {
  tab = "open"; const a = alerts.find((x) => x.id === Number(id));
  if (a && !isOpen(a)) tab = "done";
  store.set("ra_tab", tab); clearFiltersSilently(); go("alerts"); select(Number(id));
}
function clearFiltersSilently() { ["#f-authority", "#f-tag", "#f-priority", "#q"].forEach((s) => ($(s).value = "")); $("#f-mine").setAttribute("aria-pressed", "false"); }

// ---------------------------------------------------------------- importazione calendario controlli
const IMP_FIELDS = [
  { k: "title", label: "Controllo / attività", req: true, hints: ["controllo", "attivita", "titolo", "nome controllo", "nome", "adempimento", "oggetto", "task", "control", "activity", "summary", "verifica"] },
  { k: "due_date", label: "Data (prossima scadenza)", hints: ["prossima scadenza", "scadenza", "data", "entro", "termine", "due date", "deadline", "date", "dtstart", "quando"] },
  { k: "months", label: "Mesi pianificati", hints: ["mesi pianificati", "mesi", "mese", "pianificazione", "mese pianificato", "periodo", "timing"] },
  { k: "code", label: "Codice controllo", hints: ["id", "codice", "cod", "id controllo", "codice controllo", "rif"] },
  { k: "recurrence", label: "Frequenza", hints: ["frequenza", "periodicita", "ricorrenza", "cadenza", "frequency", "periodicity", "rrule"] },
  { k: "owner", label: "Responsabile", hints: ["responsabile", "owner", "assegnatario", "esecutore", "incaricato", "referente", "funzione"] },
  { k: "area", label: "Area / ambito", hints: ["area", "ambito", "processo", "categoria", "tema", "perimetro", "categories"] },
  { k: "regulation", label: "Riferimento normativo", hints: ["riferimento normativo", "normativa", "riferimento", "norma", "fonte", "regulation", "articolo"] },
  { k: "notes", label: "Note / output atteso", hints: ["note", "output", "evidenza", "evidenze", "modalita", "descrizione", "dettaglio", "description", "notes"] },
  { k: "doc", label: "Documento interno di riferimento", hints: ["documento fonte", "documento", "procedura", "policy", "fonte interna"] },
  { k: "kind", label: "Tipo", hints: ["tipo", "tipologia", "type"] },
  { k: "remind_days", label: "Preavviso (giorni)", hints: ["preavviso", "giorni prima", "reminder", "alert giorni"] },
];
const norm = (t) => String(t ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const isoOf = (y, m, d) => { const dt = new Date(Date.UTC(y, m - 1, d)); return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null; };
function parseDateAny(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date && !isNaN(v)) return isoOf(v.getFullYear(), v.getMonth() + 1, v.getDate());
  if (typeof v === "number") return v > 20000 && v < 80000 ? new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10) : null;
  const t = String(v).trim();
  let m;
  if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return isoOf(+m[1], +m[2], +m[3]);
  if ((m = t.match(/^(\d{4})(\d{2})(\d{2})(T|$)/))) return isoOf(+m[1], +m[2], +m[3]);
  if ((m = t.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2}|\d{4})$/))) return isoOf(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  if ((m = norm(t).match(/^(\d{1,2}) ([a-z]+) (\d{4})$/))) { const i = MESI.findIndex((x) => x.startsWith(m[2].slice(0, 3))); if (i >= 0) return isoOf(+m[3], i + 1, +m[1]); }
  if (/^\d{5}$/.test(t)) return parseDateAny(Number(t));
  return null;
}
function parseRec(v) {
  const t = norm(v);
  if (!t) return { rec: "none" };
  if (/settiman|weekly|freq weekly/.test(t)) return { rec: "weekly" };
  if (/semestr|semi ?annual|half ?year|ogni 6 mesi|interval 6/.test(t)) return { rec: "semiannual" };
  if (/trimestr|quarter|ogni 3 mesi|interval 3/.test(t)) return { rec: "quarterly" };
  if (/mensil|monthly|ogni mese|freq monthly/.test(t)) return { rec: "monthly" };
  if (/annual|annuo|annua|yearly|ogni anno|freq yearly/.test(t)) return { rec: "yearly" };
  if (/una tantum|one ?off|singol|nessun|^no$|^n a$|^na$|^-$/.test(t)) return { rec: "none" };
  return { rec: "none", warn: `frequenza "${String(v).slice(0, 30)}" non riconosciuta: importata come non ricorrente` };
}
function parseKind(v, def) {
  const t = norm(v);
  if (!t) return def;
  if (/controll|verific|control|test|monitor/.test(t)) return "control";
  if (/segnalaz|report|invio/.test(t)) return "reporting";
  if (/consultaz|consultation/.test(t)) return "consultation";
  if (/normativ|regulat|entrata in vigore/.test(t)) return "regulatory";
  if (/intern|internal/.test(t)) return "internal";
  return def;
}
// "Marzo", "Trimestrale (Gen/Apr/Lug/Ott)", "Semestrale (Feb/Ago)", "Mensile", "Continuativo", "Ad evento"
const MESI3 = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const MESI_EN = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
function parsePlan(monthsTxt, cadTxt) {
  const t = norm(monthsTxt), c = norm(cadTxt);
  const months = [];
  for (const w of t.split(" ")) {
    let i = MESI3.findIndex((m) => w.startsWith(m) && (w.length === 3 || MESI.some((full) => full.startsWith(w))));
    if (i < 0) i = MESI_EN.findIndex((m) => w === m || ["january", "february", "march", "april", "june", "july", "august", "september", "october", "november", "december"].includes(w) && w.startsWith(m));
    if (i >= 0 && !months.includes(i + 1)) months.push(i + 1);
  }
  if (!months.length) {
    if (/mensil|monthly|ogni mese/.test(t)) return { type: "dated", months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], rec: "monthly" };
    if (/continu|ongoing|giornalier|quotidian/.test(t || c)) return { type: "continuous" };
    if (/evento|tempestiv|on demand|al bisogno|event/.test(t || c)) return { type: "event" };
    return null;
  }
  months.sort((a, b) => a - b);
  const rec = /mensil/.test(t) || months.length >= 12 ? "monthly" : months.length === 4 || /trimestr/.test(t) ? "quarterly"
    : months.length === 2 || /semestr/.test(t) ? "semiannual" : months.length === 1 ? "yearly" : "none";
  // giorno esplicito nella cadenza, es. "Annuale (entro 31/03)"
  const m = String(cadTxt || "").match(/entro (?:il )?(\d{1,2})[\/.](\d{1,2})/i);
  return { type: "dated", months, rec, fixedDay: m ? { d: +m[1], m: +m[2] } : null, irregular: rec === "none" };
}
function nextPlannedDate(plan, dayMode, today) {
  const y0 = +today.slice(0, 4);
  const dayOf = (y, mo) => {
    if (plan.fixedDay && plan.fixedDay.m === mo) return isoOf(y, mo, plan.fixedDay.d);
    const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    return isoOf(y, mo, dayMode === "first" ? 1 : dayMode === "15" ? 15 : last);
  };
  for (const y of [y0, y0 + 1]) for (const mo of plan.months) { const d = dayOf(y, mo); if (d && d >= today) return d; }
  return null;
}

const addRec = (iso, rec, n = 1) => {
  const [y, m, d] = iso.split("-").map(Number);
  if (rec === "weekly") return new Date(Date.UTC(y, m - 1, d + 7 * n)).toISOString().slice(0, 10);
  const months = { monthly: 1, quarterly: 3, semiannual: 6, yearly: 12 }[rec] * n;
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, last))).toISOString().slice(0, 10);
};

function parseCsv(text) {
  const first = text.split(/\r?\n/).find((l) => l.trim()) || "";
  const delim = [";", "\t", ","].map((c) => [c, first.split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
function parseIcs(text) {
  const lines = text.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const out = [["Titolo", "Data", "Frequenza", "Note", "Area"]]; let ev = null;
  const un = (s) => s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1");
  for (const l of lines) {
    if (l === "BEGIN:VEVENT") ev = {};
    else if (l === "END:VEVENT" && ev) { out.push([ev.SUMMARY || "", ev.DTSTART || "", ev.RRULE || "", ev.DESCRIPTION || "", ev.CATEGORIES || ""]); ev = null; }
    else if (ev) { const i = l.indexOf(":"); if (i > 0) { const k = l.slice(0, i).split(";")[0].toUpperCase(); if (!(k in ev)) ev[k] = un(l.slice(i + 1)); } }
  }
  return out;
}
function rruleToText(r) {
  const f = (r.match(/FREQ=(\w+)/) || [])[1], n = Number((r.match(/INTERVAL=(\d+)/) || [])[1] || 1);
  if (f === "MONTHLY") return n === 3 ? "trimestrale" : n === 6 ? "semestrale" : n === 12 ? "annuale" : n === 1 ? "mensile" : r;
  if (f === "WEEKLY" && n === 1) return "settimanale";
  if (f === "YEARLY" && n === 1) return "annuale";
  return r;
}

const imp = { step: 1, file: null, sheets: null, sheet: null, rows: [], headerRow: 0, map: {}, defKind: "control", advance: true, dayMode: "last", items: [], batch: null };

function impSteps() {
  const st = ["File", "Colonne", "Verifica", "Fatto"];
  $("#imp-steps").innerHTML = st.map((l, i) => `<span class="${i + 1 === imp.step ? "on" : i + 1 < imp.step ? "ok" : ""}"><i>${i + 1 < imp.step ? "✓" : i + 1}</i>${l}</span>`).join(`<span aria-hidden="true">›</span>`);
}
function openImport() {
  Object.assign(imp, { step: 1, file: null, sheets: null, sheet: null, rows: [], headerRow: 0, map: {}, items: [], batch: null });
  renderImp(); $("#dlg-imp").showModal();
}
function renderImp() {
  impSteps();
  const B = $("#imp-body"), F = $("#imp-foot");
  if (imp.step === 1) {
    B.innerHTML = `
      <div class="drop" id="imp-drop" tabindex="0" role="button" aria-label="Scegli il file del calendario">${icon("sheet")}<b>Trascina qui il file o clicca per sceglierlo</b>
        <span class="hint">Excel (.xlsx, .xls), CSV o calendario (.ics). Una riga per controllo, con il nome e una data oppure i mesi pianificati.</span></div>
      <div class="grid2">
        <div class="field"><label for="imp-kind">Tipo da assegnare alle righe</label><select id="imp-kind">${Object.entries(DL_KIND).map(([k, v]) => `<option value="${k}" ${k === imp.defKind ? "selected" : ""}>${v}</option>`).join("")}</select><span class="hint">Se il file ha una colonna "Tipo", vale quella.</span></div>
        <div class="field"><label for="imp-day">Se il piano indica solo il mese, la scadenza cade</label><select id="imp-day"><option value="last" ${imp.dayMode === "last" ? "selected" : ""}>l'ultimo giorno del mese</option><option value="15" ${imp.dayMode === "15" ? "selected" : ""}>il 15 del mese</option><option value="first" ${imp.dayMode === "first" ? "selected" : ""}>il primo giorno del mese</option></select><span class="hint">Vale per colonne come "Mesi pianificati" (es. "Trimestrale (Gen/Apr/Lug/Ott)").</span></div>
        <div class="field"><label>&nbsp;</label><label class="switch"><input type="checkbox" id="imp-adv" ${imp.advance ? "checked" : ""}><span><b style="font-weight:500">Porta i controlli ricorrenti alla prossima data futura</b><br><span class="hint">Se il piano riporta la prima esecuzione dell'anno, RegAlert calcola la prossima.</span></span></label></div>
      </div>
      <div class="test-out">Non hai un file pronto? <a href="#" id="imp-tpl">Scarica il modello CSV</a> con le colonne previste: Controllo, Area, Riferimento normativo, Frequenza, Prossima scadenza, Responsabile, Note.</div>`;
    F.innerHTML = `<button class="btn" data-close-imp>Annulla</button>`;
    const drop = $("#imp-drop");
    drop.onclick = () => $("#imp-file").click();
    drop.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("#imp-file").click(); } };
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over"); };
    drop.ondragleave = () => drop.classList.remove("over");
    drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); if (e.dataTransfer.files[0]) readImpFile(e.dataTransfer.files[0]); };
    $("#imp-kind").onchange = (e) => (imp.defKind = e.target.value);
    $("#imp-adv").onchange = (e) => (imp.advance = e.target.checked);
    $("#imp-day").onchange = (e) => (imp.dayMode = e.target.value);
    $("#imp-tpl").onclick = (e) => { e.preventDefault(); downloadTemplate(); };
  }
  if (imp.step === 2) {
    const hdr = imp.rows[imp.headerRow] || [];
    const sample = (ci) => imp.rows.slice(imp.headerRow + 1).map((r) => r[ci]).find((x) => String(x ?? "").trim()) ?? "";
    const showSample = (ci) => { const v = sample(ci); return v instanceof Date ? v.toLocaleDateString("it-IT") : String(v); };
    B.innerHTML = `
      <div class="imp-sum"><span>${icon("sheet").replace("<svg", '<svg style="width:16px;height:16px;vertical-align:-3px"')} <b>${esc(imp.file.name)}</b></span>
        ${imp.sheets && imp.sheets.length > 1 ? `<span class="field" style="display:flex;gap:6px;align-items:center">Foglio <select id="imp-sheet" style="width:auto">${imp.sheets.map((n) => `<option ${n === imp.sheet ? "selected" : ""}>${esc(n)}</option>`).join("")}</select></span>` : ""}
        <span class="field" style="display:flex;gap:6px;align-items:center">Intestazioni alla riga <select id="imp-hdr" style="width:auto">${imp.rows.slice(0, 15).map((r, i) => r.some((x) => String(x ?? "").trim()) ? `<option value="${i}" ${i === imp.headerRow ? "selected" : ""}>${i + 1}</option>` : "").join("")}</select></span>
        <span class="muted">${imp.rows.slice(imp.headerRow + 1).filter((r) => r.some((x) => String(x ?? "").trim())).length} righe di dati</span></div>
      <p class="hint" style="margin:0">Ho abbinato le colonne del file ai campi dello scadenziario. Controlla e correggi se serve: gli esempi sotto ogni campo vengono dalla prima riga compilata.</p>
      <div class="map">${IMP_FIELDS.map((f) => `<div class="field"><label for="map-${f.k}">${f.label}${f.req ? ' <span style="color:var(--crit)">*</span>' : ""}${f.k === "due_date" || f.k === "months" ? ' <span class="hint">(uno dei due)</span>' : ""}</label>
        <select id="map-${f.k}" data-map="${f.k}"><option value="">— non presente —</option>${hdr.map((h, i) => `<option value="${i}" ${imp.map[f.k] === i ? "selected" : ""}>${esc(String(h || `Colonna ${i + 1}`))}</option>`).join("")}</select>
        <span class="sample">${imp.map[f.k] != null ? "es. " + esc((f.k === "due_date" ? (parseDateAny(sample(imp.map[f.k])) ? fullDate(parseDateAny(sample(imp.map[f.k])) + "T12:00:00Z", false) : showSample(imp.map[f.k]) + " (non leggibile)") : showSample(imp.map[f.k])).slice(0, 60)) : "&nbsp;"}</span></div>`).join("")}</div>`;
    F.innerHTML = `<button class="btn" id="imp-back">Indietro</button><button class="btn primary" id="imp-next">Verifica le righe</button>`;
    $$("[data-map]").forEach((s) => (s.onchange = () => { imp.map[s.dataset.map] = s.value === "" ? null : Number(s.value); renderImp(); }));
    $("#imp-hdr").onchange = (e) => { imp.headerRow = Number(e.target.value); autoMap(); renderImp(); };
    if ($("#imp-sheet")) $("#imp-sheet").onchange = (e) => { loadSheet(e.target.value); renderImp(); };
    $("#imp-back").onclick = () => { imp.step = 1; renderImp(); };
    $("#imp-next").onclick = () => {
      if (imp.map.title == null || (imp.map.due_date == null && imp.map.months == null && imp.map.recurrence == null)) return toast("Indica la colonna del controllo e quella della data o dei mesi pianificati.", { bad: true });
      buildItems(); imp.step = 3; renderImp();
    };
  }
  if (imp.step === 3) {
    const ok = imp.items.filter((r) => r.include && !r.err).length, err = imp.items.filter((r) => r.err).length, dup = imp.items.filter((r) => r.dup).length, warn = imp.items.filter((r) => r.include && !r.err && r.warns.length).length;
    const skip = imp.items.filter((r) => r.skip && !r.include).length;
    B.innerHTML = `
      <div class="imp-sum"><span><b style="color:var(--ok)">${ok}</b> da importare</span>${warn ? `<span><b style="color:var(--warn)">${warn}</b> con avvisi</span>` : ""}${err ? `<span><b style="color:var(--crit)">${err}</b> con errori (correggi o escludi)</span>` : ""}${dup ? `<span><b>${dup}</b> già presenti, escluse</span>` : ""}${skip ? `<span title="Continuativi o ad evento: per includerli indica una data nella riga"><b>${skip}</b> continuativi o ad evento, esclusi</span>` : ""}
        <label style="margin-left:auto;display:flex;gap:6px;align-items:center"><input type="checkbox" id="imp-only-err" style="width:auto"> Mostra solo righe da sistemare</label></div>
      <div class="prev-wrap"><table class="prev"><thead><tr><th></th><th>Stato</th><th>Controllo</th><th>Data</th><th>Frequenza</th><th>Tipo</th><th>Responsabile</th><th>Area</th></tr></thead><tbody id="imp-rows"></tbody></table></div>`;
    renderImpRows();
    F.innerHTML = `<button class="btn" id="imp-back">Indietro</button><button class="btn primary" id="imp-go" ${ok ? "" : "disabled"}>Importa ${ok} ${ok === 1 ? "scadenza" : "scadenze"}</button>`;
    $("#imp-only-err").onchange = renderImpRows;
    $("#imp-back").onclick = () => { imp.step = 2; renderImp(); };
    $("#imp-go").onclick = runImport;
  }
  if (imp.step === 4) {
    B.innerHTML = `<div class="empty" style="padding:28px 12px">${icon("check").replace("<svg", '<svg style="color:var(--ok)"')}<h3>${imp.done} ${imp.done === 1 ? "scadenza importata" : "scadenze importate"}</h3>
      <p>Le trovi nello scadenziario. I controlli ricorrenti, quando li completi, generano da soli la scadenza successiva. Se qualcosa non torna puoi annullare l'intera importazione.</p></div>`;
    F.innerHTML = `<button class="btn danger" id="imp-undo" style="margin-right:auto">Annulla questa importazione</button><button class="btn primary" data-close-imp>Vai allo scadenziario</button>`;
    $("#imp-undo").onclick = undoImport;
  }
}

const loadScript = (src) => new Promise((ok, ko) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = ko; document.head.appendChild(s); });
async function readImpFile(file) {
  imp.file = file;
  const name = file.name.toLowerCase();
  try {
    if (/\.(csv|txt)$/.test(name)) { imp.sheets = null; imp.rows = parseCsv(await file.text()); }
    else if (/\.ics$/.test(name)) {
      imp.sheets = null; imp.rows = parseIcs(await file.text());
      imp.rows = imp.rows.map((r, i) => i ? [r[0], r[1], r[2] && /FREQ=/.test(r[2]) ? rruleToText(r[2]) : r[2], r[3], r[4]] : r);
    } else {
      if (!window.XLSX) await loadScript("vendor/xlsx-0.18.5.full.min.js").catch(() => { throw new Error("non riesco a caricare il lettore Excel: controlla la connessione"); });
      // date lette come numero seriale e convertite in UTC: evita lo slittamento di un giorno dovuto ai fusi orari
      imp.wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
      imp.sheets = imp.wb.SheetNames; loadSheet(imp.sheets[0]);
    }
    if (imp.rows.filter((r) => r.some((x) => String(x).trim())).length < 2) throw new Error("il file non contiene righe di dati");
    if (!imp.wb || /\.(csv|txt|ics)$/.test(name)) detectHeader();
    autoMap(); imp.step = 2; renderImp();
  } catch (e) { toast("Non riesco a leggere il file: " + e.message, { bad: true }); }
}
function loadSheet(n) {
  imp.sheet = n;
  // righe vuote conservate: i numeri di riga mostrati coincidono con quelli del foglio
  imp.rows = XLSX.utils.sheet_to_json(imp.wb.Sheets[n], { header: 1, raw: true, defval: "", blankrows: true });
  detectHeader(); autoMap();
}
function detectHeader() {
  const all = IMP_FIELDS.flatMap((f) => f.hints);
  let best = 0, score = -1;
  imp.rows.slice(0, 15).forEach((r, i) => {
    const sc = r.filter((c) => typeof c === "string" && all.some((h) => norm(c).includes(h))).length;
    if (sc > score) { score = sc; best = i; }
  });
  imp.headerRow = best;
}
function autoMap() {
  const hdr = (imp.rows[imp.headerRow] || []).map(norm);
  const used = new Set(); imp.map = {};
  for (const f of IMP_FIELDS) {
    let bi = null, bs = 0;
    hdr.forEach((h, i) => {
      if (used.has(i) || !h) return;
      for (const [rank, hint] of f.hints.entries()) {
        const short = hint.length <= 3;   // "id", "cod", "rif": solo corrispondenza esatta o a inizio parola
        const s = h === hint ? 100 - rank : short ? (new RegExp(`^${hint}\\b`).test(h) ? 50 - rank : 0) : h.startsWith(hint) ? 60 - rank : h.includes(hint) ? 40 - rank : 0;
        if (s > bs) { bs = s; bi = i; }
      }
    });
    if (bi != null) { imp.map[f.k] = bi; used.add(bi); }
  }
  if (imp.map.title == null && imp.map.notes != null) { imp.map.title = imp.map.notes; imp.map.notes = null; }
}
function matchOwner(t) {
  const n = norm(t); if (!n) return { assignee: null, owner_label: null };
  const p = profiles.filter((x) => x.role !== "pending").find((x) => norm(x.full_name) === n || norm(x.email) === n || norm(x.email.split("@")[0]) === n.replace(/ /g, "."));
  return p ? { assignee: p.id, owner_label: null } : { assignee: null, owner_label: String(t).trim().slice(0, 120) };
}
function buildItems() {
  const get = (r, k) => imp.map[k] == null ? "" : r[imp.map[k]];
  const existing = new Set(deadlines.map((d) => norm(d.title) + "|" + d.due_date));
  const today = todayKey();
  imp.items = imp.rows.slice(imp.headerRow + 1).map((r, i) => {
    if (!r.some((x) => String(x ?? "").trim())) return null;
    const it = { line: imp.headerRow + i + 2, include: true, warns: [], err: null };
    const code = String(get(r, "code") ?? "").trim();
    it.title = ((code && code.length <= 12 ? code + " · " : "") + String(get(r, "title") ?? "").trim()).slice(0, 300);
    const rawDate = get(r, "due_date");
    it.due_date = parseDateAny(rawDate);
    const plan = parsePlan(get(r, "months"), get(r, "recurrence"));
    if (plan?.type === "dated") {
      it.recurrence = plan.rec;
      if (!it.due_date) { it.due_date = nextPlannedDate(plan, imp.dayMode, today); it.planned = true; }
      if (plan.irregular) it.warns.push("mesi pianificati irregolari: importato come una tantum sul primo mese utile");
    } else {
      const rc = parseRec(get(r, "recurrence")); it.recurrence = rc.rec;
      if (rc.warn && !plan) it.warns.push(rc.warn);
      if (plan && !it.due_date) it.skip = plan.type === "continuous" ? "controllo continuativo: non ha una scadenza da pianificare" : "controllo ad evento: non ha una scadenza da pianificare";
    }
    it.kind = parseKind(get(r, "kind"), imp.defKind);
    Object.assign(it, matchOwner(get(r, "owner")));
    it.area = String(get(r, "area") ?? "").trim().slice(0, 80) || null;
    it.regulation = String(get(r, "regulation") ?? "").trim().slice(0, 200) || null;
    const doc = String(get(r, "doc") ?? "").trim();
    it.notes = [String(get(r, "notes") ?? "").trim() && `Output: ${String(get(r, "notes")).trim()}`, doc && `Documento: ${doc}`].filter(Boolean).join("\n").slice(0, 2000) || null;
    if (imp.map.doc == null) it.notes = String(get(r, "notes") ?? "").trim().slice(0, 2000) || null;
    const rd = parseInt(get(r, "remind_days"), 10); it.remind_days = rd >= 0 && rd <= 90 ? rd : ({ weekly: 1, monthly: 3, quarterly: 7, semiannual: 14, yearly: 14 }[it.recurrence] ?? 7);
    if (it.due_date && it.recurrence !== "none" && imp.advance && it.due_date < today) {
      let d = it.due_date, n = 0; while (d < today && n < 600) { d = addRec(it.due_date, it.recurrence, ++n); }
      it.warns.push(`data nel file ${fullDate(it.due_date + "T12:00:00Z", false)}: portata alla prossima, ${fullDate(d + "T12:00:00Z", false)}`); it.due_date = d;
    } else if (it.due_date && it.due_date < today) it.warns.push("data passata: comparirà tra le scadute");
    validateItem(it, rawDate);
    if (it.skip && !it.due_date) { it.err = null; it.include = false; it.warns.unshift(it.skip); }
    it.dup = !it.err && !it.skip && existing.has(norm(it.title) + "|" + it.due_date);
    if (it.dup) { it.include = false; it.warns.push("già presente nello scadenziario"); }
    return it;
  }).filter((it) => it && (it.title || it.due_date));
  imp.items.sort((a, b) => (!!a.skip - !!b.skip) || (a.line - b.line));
}
function validateItem(it, rawDate) {
  it.err = !it.title ? "manca il nome del controllo" : !it.due_date ? (rawDate ? `data "${String(rawDate).slice(0, 20)}" non leggibile` : "manca la data") : null;
}
function renderImpRows() {
  const only = $("#imp-only-err")?.checked;
  const members = profiles.filter((p) => ["analyst", "admin"].includes(p.role));
  $("#imp-rows").innerHTML = imp.items.map((it, i) => (only && !it.err && !it.warns.length) ? "" : `<tr class="${it.err ? "bad" : it.include ? "" : "off"}" data-i="${i}">
    <td><input type="checkbox" data-f="include" ${it.include ? "checked" : ""} ${it.err || !it.due_date ? "disabled" : ""} aria-label="Includi riga ${it.line}" style="min-width:0;width:auto"></td>
    <td class="st ${it.err ? "err" : it.skip && !it.include ? "" : it.warns.length ? "warn" : "ok"}" style="${it.skip && !it.include ? "color:var(--muted)" : ""}" title="${esc([it.err, ...it.warns].filter(Boolean).join("\n"))}">riga ${it.line} · ${it.err ? esc(it.err) : it.warns.length ? esc(it.warns[0]) : it.planned ? "ok, dal mese pianificato" : "ok"}</td>
    <td class="t"><input data-f="title" value="${esc(it.title)}" aria-label="Controllo"></td>
    <td><input type="date" data-f="due_date" value="${it.due_date || ""}" aria-label="Data"></td>
    <td><select data-f="recurrence" aria-label="Frequenza"><option value="none">Una tantum</option>${Object.entries(DL_REC).map(([k, v]) => `<option value="${k}" ${it.recurrence === k ? "selected" : ""}>${v[0].toUpperCase() + v.slice(1)}</option>`).join("")}</select></td>
    <td><select data-f="kind" aria-label="Tipo">${Object.entries(DL_KIND).map(([k, v]) => `<option value="${k}" ${it.kind === k ? "selected" : ""}>${v}</option>`).join("")}</select></td>
    <td><select data-f="assignee" aria-label="Responsabile"><option value="">${it.owner_label ? esc(it.owner_label) + " (esterno)" : "Nessuno"}</option>${members.map((p) => `<option value="${p.id}" ${it.assignee === p.id ? "selected" : ""}>${esc(p.full_name || p.email)}</option>`).join("")}</select></td>
    <td><input data-f="area" value="${esc(it.area || "")}" aria-label="Area" style="min-width:90px"></td>
  </tr>`).join("");
}
function onImpEdit(e) {
  const tr = e.target.closest("tr[data-i]"); if (!tr) return;
  const it = imp.items[Number(tr.dataset.i)], f = e.target.dataset.f; if (!f) return;
  if (f === "include") it.include = e.target.checked;
  else if (f === "assignee") it.assignee = e.target.value || null;
  else it[f] = e.target.value.trim() || (f === "area" ? null : "");
  if (f === "title" || f === "due_date") {
    const was = !!it.err; validateItem(it, it.due_date);
    if (it.skip) { if (it.due_date) { it.include = true; it.err = null; } else { it.include = false; it.err = null; } }
    else if (was && !it.err) it.include = true;
  }
  if (e.type === "change") { const y = $(".prev-wrap").scrollTop; renderImp(); $(".prev-wrap").scrollTop = y; }
}
async function runImport() {
  const rows = imp.items.filter((r) => r.include && !r.err);
  if (!rows.length) return;
  imp.batch = "imp-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
  const btn = $("#imp-go"); btn.disabled = true; btn.innerHTML = `<span class="spin"></span>Importo…`;
  const payload = rows.map((r) => ({ title: r.title, due_date: r.due_date, kind: r.kind, recurrence: r.recurrence, remind_days: r.remind_days,
    assignee: r.assignee, owner_label: r.assignee ? null : r.owner_label, area: r.area, regulation: r.regulation, notes: r.notes,
    status: "open", source: "manual", import_batch: imp.batch }));
  for (let i = 0; i < payload.length; i += 200) {
    const { error } = await sb.from("ra_deadlines").insert(payload.slice(i, i + 200));
    if (error) {
      await sb.from("ra_deadlines").delete().eq("import_batch", imp.batch);
      btn.disabled = false; btn.textContent = "Riprova";
      return toast("Importazione non riuscita, nessuna riga salvata: " + error.message, { bad: true });
    }
  }
  imp.done = payload.length; imp.step = 4; renderImp(); await loadDeadlines();
}
async function undoImport() {
  if (!imp.batch) return;
  const { error } = await sb.from("ra_deadlines").delete().eq("import_batch", imp.batch).eq("status", "open");
  if (error) return toast(error.message, { bad: true });
  toast("Importazione annullata"); $("#dlg-imp").close(); loadDeadlines();
}
function downloadTemplate() {
  const rows = [["Controllo", "Area", "Riferimento normativo", "Frequenza", "Prossima scadenza", "Responsabile", "Note"],
    ["ESEMPIO - Verifica a campione dell'adeguata verifica della clientela", "AML", "D.Lgs. 231/2007", "Trimestrale", "31/03/2027", "Funzione Compliance", "Cancellare le righe di esempio prima di importare"],
    ["ESEMPIO - Test del piano di continuità operativa", "DORA", "Reg. (UE) 2022/2554", "Annuale", "30/06/2027", "Funzione IT", ""]];
  const csv = "﻿" + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = "regalert-modello-calendario-controlli.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------------- CSV
function exportCsv() {
  const rows = filtered();
  const cols = [["id", "ID"], ["source_authority", "Autorità"], ["title", "Titolo"], ["url", "URL"], ["published_at", "Pubblicato"], ["detected_at", "Rilevato"],
    ["status", "Stato"], ["priority", "Priorità"], ["assignee_name", "Responsabile"], ["due_date", "Scadenza"], ["ai_relevance", "Rilevanza AI"], ["ai_summary", "Sintesi"],
    ["impact_assessment", "Valutazione d'impatto"], ["actions", "Azioni"], ["closed_at", "Chiuso il"]];
  const cell = (v) => csvCell(Array.isArray(v) ? v.join(", ") : v);
  const csv = "﻿" + [cols.map((c) => cell(c[1])).join(";"), ...rows.map((r) => cols.map(([k]) => cell(k === "status" ? STATUS[r[k]] : k === "priority" ? PRIORITY[r[k]] : r[k])).join(";"))].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `regalert-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`Esportati ${rows.length} alert`); logEvent("export_alerts_csv", { rows: rows.length });
}

// ---------------------------------------------------------------- eventi: accesso
let signup = false, authMode = "login";
function authMsg(t, bad) { const m = $("#a-msg"); m.hidden = !t; m.textContent = t || ""; m.className = "msg " + (bad ? "err" : "ok"); }
// modalità del modulo di accesso: login | signup | forgot
function setAuthMode(mode) {
  authMode = mode; signup = mode === "signup";
  const T = {
    login: ["Accedi", "Usa l'account del team compliance.", "Accedi", "Prima volta qui?", "Crea un account"],
    signup: ["Crea il tuo account", "Il primo iscritto diventa amministratore; gli altri vengono approvati da lui.", "Crea account", "Hai già un account?", "Accedi"],
    forgot: ["Recupera la password", "Inserisci l'email del tuo account: ti mandiamo un link per sceglierne una nuova.", "Invia il link", "Ti è tornata in mente?", "Accedi"],
  }[mode];
  $("#a-title").textContent = T[0]; $("#a-sub").textContent = T[1]; $("#a-submit").textContent = T[2];
  $("#a-switch-text").textContent = T[3]; $("#a-switch").textContent = T[4];
  $("#fld-name").hidden = mode !== "signup"; $("#a-pass-hint").hidden = mode !== "signup";
  $("#fld-pass").hidden = mode === "forgot"; $("#a-forgot").hidden = mode !== "login";
  $("#a-pass").autocomplete = mode === "signup" ? "new-password" : "current-password"; authMsg("");
}
$("#a-switch").onclick = () => setAuthMode(authMode === "login" ? "signup" : "login");
$("#a-forgot").onclick = () => { setAuthMode("forgot"); $("#a-email").focus(); };
$("#f-auth").onsubmit = async (e) => {
  e.preventDefault();
  const email = $("#a-email").value.trim(), password = $("#a-pass").value;
  if (!/^\S+@\S+\.\S+$/.test(email)) return authMsg("Inserisci un indirizzo email valido.", true);
  if (authMode === "forgot") {
    $("#a-submit").disabled = true; authMsg("");
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    $("#a-submit").disabled = false;
    // stesso messaggio che l'account esista o no, per non rivelare quali email sono registrate
    if (error && /rate|seconds|too many/i.test(error.message)) return authMsg("Hai già chiesto un link da poco: attendi qualche minuto e riprova.", true);
    if (error && !/not found|user/i.test(error.message)) return authMsg("Non riesco a inviare l'email in questo momento. Riprova più tardi.", true);
    return authMsg(`Se ${email} corrisponde a un account, tra poco ricevi un'email con il link per scegliere una nuova password. Controlla anche lo spam; il link vale una sola volta.`, false);
  }
  if (signup && password.length < 12) return authMsg("Scegli una password di almeno 12 caratteri.", true);
  if (password.length < 6) return authMsg("Password non valida.", true);
  $("#a-submit").disabled = true; authMsg("");
  const res = signup
    ? await sb.auth.signUp({ email, password, options: { data: { full_name: $("#a-name").value.trim(), app: "regalert" }, emailRedirectTo: location.origin + location.pathname } })
    : await sb.auth.signInWithPassword({ email, password });
  $("#a-submit").disabled = false;
  if (res.error) {
    const m = res.error.message;
    return authMsg(/Invalid login/i.test(m) ? "Email o password non corretti." : /not confirmed/i.test(m) ? "Conferma prima l'indirizzo email: trovi il link nella posta in arrivo." : /already registered/i.test(m) ? "Esiste già un account con questa email: accedi." : m, true);
  }
  if (signup && !res.data.session) return authMsg("Ti abbiamo inviato un'email: conferma l'indirizzo e poi accedi da qui.", false);
  if (!signup) logEvent("login", { ua: navigator.userAgent.slice(0, 160) });
  await enter();
};
$("#f-config").onsubmit = (e) => { e.preventDefault(); store.set("ra_url", $("#cfg-url").value.trim().replace(/\/$/, "")); store.set("ra_key", $("#cfg-key").value.trim()); boot(); };
$("#b-logout").onclick = $("#p-logout").onclick = $("#mfa-logout").onclick = async () => { await logEvent("logout"); stopIdleWatch(); sb.auth.signOut(); };
$("#p-reload").onclick = () => location.reload();

// nuova password dal link di recupero
function showReset(session) {
  history.replaceState(null, "", location.pathname);
  $("#r-email").textContent = session?.user?.email || "";
  $("#r-msg").hidden = true; $("#r-pass").value = $("#r-pass2").value = "";
  show("v-reset"); setTimeout(() => $("#r-pass").focus(), 50);
}
$("#f-reset").onsubmit = async (e) => {
  e.preventDefault();
  const p1 = $("#r-pass").value, p2 = $("#r-pass2").value, m = $("#r-msg");
  const err = (t) => { m.hidden = false; m.className = "msg err"; m.textContent = t; };
  if (p1.length < 12) return err("La password deve avere almeno 12 caratteri.");
  if (p1 !== p2) return err("Le due password non coincidono.");
  $("#r-submit").disabled = true;
  const { error } = await sb.auth.updateUser({ password: p1 });
  $("#r-submit").disabled = false;
  if (error) return err(/different|same/i.test(error.message) ? "Scegli una password diversa da quella precedente." : /weak|pwned|leaked/i.test(error.message) ? "Password troppo debole o già comparsa in fughe di dati: scegline un'altra." : /session|expired|jwt/i.test(error.message) ? "Il link è scaduto: torna all'accesso e richiedine uno nuovo." : error.message);
  toast("Password aggiornata");
  logEvent("password_changed", { via: "link email" });
  await enter();
};

// ---------------------------------------------------------------- eventi: navigazione
$("#nav").onclick = (e) => { const v = e.target.closest("button")?.dataset.view; if (v) go(v); };
$("#b-menu").onclick = () => { $("#v-app").classList.add("nav-open"); $("#scrim").hidden = false; };
$("#scrim").onclick = closeNav;
$$("#tabbar button[data-view]").forEach((b) => (b.onclick = () => go(b.dataset.view)));
$("#tabbar [data-more]").onclick = () => { $("#v-app").classList.add("nav-open"); $("#scrim").hidden = false; };

// ---------------------------------------------------------------- politiche e procedure
let editingPol = null, updatingPol = null;
const addMonths = (iso, m) => { const d = new Date(iso + "T12:00:00Z"); const day = d.getUTCDate(); d.setUTCMonth(d.getUTCMonth() + m); if (d.getUTCDate() !== day) d.setUTCDate(0); return d.toISOString().slice(0, 10); };
const fmtDate = (iso) => iso ? iso.split("-").reverse().join("/") : "—";

async function loadPolicies() {
  const { data, error } = await sb.from("ra_policies").select("*").order("next_review", { ascending: true, nullsFirst: false }).limit(2000);
  if (error) return;
  policies = data || []; polHistory = {};
  const due = policies.filter((p) => p.status !== "retired" && p.next_review && dDays(p.next_review) <= p.remind_days);
  const late = due.some((p) => dDays(p.next_review) < 0);
  $("#nav-pol").hidden = !due.length; $("#nav-pol").textContent = due.length; $("#nav-pol").style.background = late ? "var(--crit)" : "";
  if (!$("#view-policies").hidden) renderPolicies();
  if (!$("#view-deadlines").hidden) renderDeadlines();
}
function polRow(p) {
  const n = p.next_review ? dDays(p.next_review) : null, who = profiles.find((x) => x.id === p.owner), ed = canEdit();
  const url = safeUrl(p.url);
  return `<div class="pol ${p.status}" data-open-pol="${p.id}">
    <div style="min-width:0">
      <div class="t">${p.code ? `<span class="mono muted">${esc(p.code)}</span> · ` : ""}${esc(p.title)}</div>
      <div class="dl-meta">
        <span class="badge">${POL_TYPE[p.doc_type]}</span>
        ${p.status !== "in_force" ? `<span class="badge ${p.status === "under_review" ? "s-in_review" : ""}">${POL_ST[p.status]}</span>` : ""}
        ${p.version ? `<span class="mono">v${esc(p.version)}</span>` : ""}
        ${p.area ? `<span class="tag">${esc(p.area)}</span>` : ""}
        ${who ? `<span style="display:inline-flex;gap:5px;align-items:center">${avatar(who, "sm")}${esc(who.full_name || who.email)}</span>` : p.owner_label ? `<span>${esc(p.owner_label)}</span>` : `<span class="muted">senza responsabile</span>`}
        ${p.approver ? `<span>approvata da ${esc(p.approver)}</span>` : ""}
        ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener" data-stop>documento ${icon("ext").replace("<svg", '<svg style="width:12px;height:12px;vertical-align:-1px"')}</a>` : ""}
      </div>
    </div>
    <div class="rev">
      <span class="muted">Aggiornata il <b style="color:var(--fg-2)">${fmtDate(p.last_updated)}</b></span>
      ${p.status === "retired" ? `<span class="muted">non più in uso</span>` : n === null ? `<span class="muted">nessuna revisione fissata</span>` : `<span>Rivedere entro <b>${fmtDate(p.next_review)}</b></span><span class="when ${whenCls(n)}">${whenTxt(n)}</span>`}
    </div>
    <div class="dl-acts acts">${ed && p.status !== "retired" ? `<button class="btn sm" data-pol-upd="${p.id}">${icon("check")}Aggiornata</button>` : ""}</div>
  </div>`;
}
function renderPolicies() {
  const areas = [...new Set(policies.map((p) => p.area).filter(Boolean))].sort();
  const curA = $("#pol-f-area").value, curS = $("#pol-f-status").value;
  $("#pol-f-area").innerHTML = `<option value="">Area</option>` + areas.map((a) => `<option>${esc(a)}</option>`).join(""); $("#pol-f-area").value = curA;
  $("#pol-f-area").parentElement.hidden = !areas.length;
  $("#pol-f-status").innerHTML = `<option value="">Stato</option>` + Object.entries(POL_ST).map(([k, v]) => `<option value="${k}">${v}</option>`).join(""); $("#pol-f-status").value = curS;
  $("#pol-areas").innerHTML = areas.map((a) => `<option>${esc(a)}</option>`).join("");
  ["#pol-f-area", "#pol-f-status"].forEach((s) => $(s).classList.toggle("on", !!$(s).value));

  const live = policies.filter((p) => p.status !== "retired");
  const late = live.filter((p) => p.next_review && dDays(p.next_review) < 0), soon = live.filter((p) => p.next_review && dDays(p.next_review) >= 0 && dDays(p.next_review) <= 60);
  $("#pol-stats").innerHTML = [[live.length, "in registro"], [late.length, "revisione scaduta", late.length ? "var(--crit)" : ""], [soon.length, "da rivedere entro 60 giorni", soon.length ? "var(--high)" : ""],
    [live.filter((p) => !p.next_review).length, "senza data di revisione"]].map(([n, l, c]) => `<div class="card stat"><b style="${c ? `color:${c}` : ""}">${n}</b><span>${l}</span></div>`).join("");

  const q = $("#pol-q").value.trim().toLowerCase(), ar = $("#pol-f-area").value, st = $("#pol-f-status").value, dueOnly = $("#pol-f-due").getAttribute("aria-pressed") === "true";
  const list = policies.filter((p) => (!q || `${p.code || ""} ${p.title} ${p.area || ""} ${p.regulation || ""}`.toLowerCase().includes(q)) && (!ar || p.area === ar)
    && (st ? p.status === st : p.status !== "retired" || q) && (!dueOnly || (p.next_review && p.status !== "retired" && dDays(p.next_review) <= Math.max(60, p.remind_days))))
    .sort((a, b) => (a.status === "retired") - (b.status === "retired") || (a.next_review || "9999").localeCompare(b.next_review || "9999") || a.title.localeCompare(b.title, "it", { numeric: true }));
  $("#pol-body").innerHTML = list.length ? `<div class="card">${list.map(polRow).join("")}</div>`
    : `<div class="card"><div class="empty">${icon("policy")}<h3>${policies.length ? "Nessuna politica con questi filtri" : "Il registro è vuoto"}</h3><p>Aggiungi le politiche e le procedure interne con la data dell'ultimo aggiornamento e la periodicità di revisione: RegAlert ti avvisa quando vanno riviste.</p>${canEdit() && !policies.length ? `<button class="btn primary sm" data-add="policy">${icon("plus")}Nuova politica</button>` : ""}</div></div>`;
}
$("#pol-q").oninput = renderPolicies; $("#pol-f-area").onchange = $("#pol-f-status").onchange = renderPolicies;
$("#pol-f-due").onclick = (e) => { e.currentTarget.setAttribute("aria-pressed", e.currentTarget.getAttribute("aria-pressed") !== "true"); renderPolicies(); };

function polNextFromForm() {
  const m = +$("#pl-every").value, last = $("#pl-last").value;
  return m && last ? addMonths(last, m) : "";
}
async function openPolForm(p = null) {
  editingPol = p; const ed = canEdit();
  const people = profiles.filter((x) => ["analyst", "admin", "viewer"].includes(x.role));
  $("#pl-h").textContent = p ? (p.code ? `${p.code} · ${p.title}` : p.title) : "Nuova politica";
  $("#pl-type").innerHTML = Object.entries(POL_TYPE).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
  $("#pl-status").innerHTML = Object.entries(POL_ST).map(([k, v]) => `<option value="${k}">${v}</option>`).join("");
  $("#pl-owner").innerHTML = `<option value="">Nessuno</option>` + people.map((x) => `<option value="${x.id}">${esc(x.full_name || x.email)}</option>`).join("");
  $("#pl-title").value = p?.title || ""; $("#pl-code").value = p?.code || ""; $("#pl-type").value = p?.doc_type || "policy"; $("#pl-status").value = p?.status || "in_force";
  $("#pl-area").value = p?.area || ""; $("#pl-reg").value = p?.regulation || ""; $("#pl-owner").value = p?.owner || ""; $("#pl-owner-label").value = p?.owner_label || "";
  $("#pl-approver").value = p?.approver || ""; $("#pl-version").value = p?.version || ""; $("#pl-last").value = p?.last_updated || "";
  $("#pl-every").value = p?.review_months ? String(p.review_months) : (p ? "" : "12");
  if (p?.review_months && ![...$("#pl-every").options].some((o) => o.value === String(p.review_months))) $("#pl-every").insertAdjacentHTML("beforeend", `<option value="${p.review_months}">Ogni ${p.review_months} mesi</option>`), ($("#pl-every").value = String(p.review_months));
  $("#pl-next").value = p?.next_review || ""; $("#pl-remind").value = String(p?.remind_days ?? 30);
  if (![...$("#pl-remind").options].some((o) => o.value === $("#pl-remind").value)) $("#pl-remind").value = "30";
  $("#pl-url").value = p?.url || ""; $("#pl-notes").value = p?.notes || "";
  $$("#f-pol input, #f-pol select, #f-pol textarea").forEach((el) => (el.disabled = !ed));
  $("#f-pol .dlg-f .btn.primary").hidden = !ed; $("#pl-del").hidden = !(p && ed);
  $("#pl-history").innerHTML = "";
  $("#dlg-pol").showModal(); if (ed) $("#pl-title").focus();
  if (p) {
    const { data } = await sb.from("ra_policy_versions").select("*").eq("policy_id", p.id).order("updated_on", { ascending: false }).order("recorded_at", { ascending: false });
    const h = data || [];
    $("#pl-history").innerHTML = `<div class="field"><label>Storico degli aggiornamenti</label>${h.length ? `<div class="hist">${h.map((v) => `<div><span class="mono">${fmtDate(v.updated_on)}</span><span class="mono">${v.version ? "v" + esc(v.version) : "—"}</span><span>${esc(v.note || "")}${v.approved_by ? ` <span class="muted">· approvata da ${esc(v.approved_by)}</span>` : ""}<span class="muted"> · registrata da ${esc(memberName(v.recorded_by) || "—")} ${relTime(v.recorded_at)}</span></span></div>`).join("")}</div>`
      : `<span class="hint">Nessun aggiornamento registrato da RegAlert. Usa "Aggiornata" quando esce una nuova versione: entrerà qui.</span>`}</div>`;
  }
}
["#pl-last", "#pl-every"].forEach((s) => $(s).addEventListener("change", () => { const n = polNextFromForm(); if (n) $("#pl-next").value = n; }));
$("#f-pol").onsubmit = async (e) => {
  e.preventDefault();
  const url = $("#pl-url").value.trim();
  const row = { title: $("#pl-title").value.trim(), code: $("#pl-code").value.trim() || null, doc_type: $("#pl-type").value, status: $("#pl-status").value,
    area: $("#pl-area").value.trim() || null, regulation: $("#pl-reg").value.trim() || null, owner: $("#pl-owner").value || null, owner_label: $("#pl-owner-label").value.trim() || null,
    approver: $("#pl-approver").value.trim() || null, version: $("#pl-version").value.trim() || null, last_updated: $("#pl-last").value || null,
    review_months: $("#pl-every").value ? +$("#pl-every").value : null, next_review: $("#pl-next").value || polNextFromForm() || null,
    remind_days: +$("#pl-remind").value, url: url || null, notes: $("#pl-notes").value.trim() || null };
  if (!row.title) return toast("Indica il titolo", { bad: true });
  if (url && !/^https?:\/\//i.test(url)) return toast("Il link deve iniziare con https://", { bad: true });
  if (row.last_updated && row.last_updated > todayKey()) return toast("L'ultimo aggiornamento non può essere nel futuro", { bad: true });
  const { error } = editingPol ? await sb.from("ra_policies").update(row).eq("id", editingPol.id) : await sb.from("ra_policies").insert(row);
  if (error) return toast(/duplicate|unique/i.test(error.message) ? "Esiste già una politica con questo codice" : error.message, { bad: true });
  $("#dlg-pol").close(); toast(editingPol ? "Politica aggiornata" : "Politica aggiunta al registro"); loadPolicies();
};
$("#pl-del").onclick = async () => {
  if (!editingPol) return; $("#dlg-pol").close();
  if (!(await confirmBox("Eliminare dal registro?", `"${editingPol.title}" e il suo storico verranno eliminati. Se non è più in uso, imposta piuttosto lo stato "Ritirata": resta consultabile.`, "Elimina"))) return;
  const { error } = await sb.from("ra_policies").delete().eq("id", editingPol.id);
  error ? toast(error.message, { bad: true }) : (toast("Politica eliminata"), loadPolicies());
};
function bumpVersion(v) {
  if (!v) return "1.0";
  const m = String(v).match(/^(.*?)(\d+)(?:\.(\d+))?$/);
  return m ? (m[3] !== undefined ? `${m[1]}${m[2]}.${+m[3] + 1}` : `${m[1]}${+m[2] + 1}`) : v;
}
function openPolUpdate(p) {
  updatingPol = p;
  $("#pu-what").textContent = (p.code ? p.code + " · " : "") + p.title + (p.version ? ` (in vigore: v${p.version})` : "");
  $("#pu-version").value = bumpVersion(p.version); $("#pu-date").value = todayKey(); $("#pu-approver").value = p.approver || ""; $("#pu-note").value = "";
  const calc = () => { $("#pu-next").value = p.review_months && $("#pu-date").value ? addMonths($("#pu-date").value, p.review_months) : ""; $("#pu-next-hint").textContent = p.review_months ? `Calcolata: revisione ogni ${p.review_months} mesi.` : "Nessuna periodicità impostata: indica tu la data."; };
  calc(); $("#pu-date").onchange = calc;
  $("#dlg-polupd").showModal(); $("#pu-version").focus();
}
$("#f-polupd").onsubmit = async (e) => {
  e.preventDefault();
  const date = $("#pu-date").value;
  if (!date) return toast("Indica la data dell'aggiornamento", { bad: true });
  if (date > todayKey()) return toast("La data non può essere nel futuro", { bad: true });
  const { data, error } = await sb.rpc("ra_policy_record_update", { p_id: updatingPol.id, p_version: $("#pu-version").value.trim(), p_date: date,
    p_approved_by: $("#pu-approver").value.trim() || null, p_note: $("#pu-note").value.trim() || null, p_next_review: $("#pu-next").value || null });
  if (error) return toast(error.message, { bad: true });
  $("#dlg-polupd").close();
  toast(data ? `Aggiornamento registrato: prossima revisione entro il ${fmtDate(data)}` : "Aggiornamento registrato"); loadPolicies();
};
$("#b-pol-csv").onclick = () => {
  if (!policies.length) return toast("Il registro è vuoto");
  const head = ["Codice", "Titolo", "Tipo", "Stato", "Area", "Riferimento normativo", "Responsabile", "Approvata da", "Versione", "Ultimo aggiornamento", "Revisione (mesi)", "Da rivedere entro", "Giorni alla revisione", "Link", "Note"];
  const rows = [...policies].sort((a, b) => (a.code || a.title).localeCompare(b.code || b.title, "it", { numeric: true }));
  const csv = "﻿" + [head.map(csvCell).join(";"), ...rows.map((p) => [p.code, p.title, POL_TYPE[p.doc_type], POL_ST[p.status], p.area, p.regulation, memberName(p.owner) || p.owner_label, p.approver, p.version,
    p.last_updated, p.review_months, p.next_review, p.next_review ? dDays(p.next_review) : "", p.url, p.notes].map(csvCell).join(";"))].join("\r\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `regalert-registro-politiche-${todayKey()}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`${rows.length} politiche esportate`); logEvent("export_policies_csv", { rows: rows.length });
};

// ---------------------------------------------------------------- "Nuovo": attività, scadenza o politica da qualunque sezione
const addMenu = $("#add-menu");
const closeAddMenu = () => { addMenu.hidden = true; $("#b-add").setAttribute("aria-expanded", "false"); };
$("#b-add").onclick = (e) => { e.stopPropagation(); const open = addMenu.hidden; addMenu.hidden = !open; $("#b-add").setAttribute("aria-expanded", String(open)); if (open) addMenu.querySelector("button").focus(); };
document.addEventListener("click", (e) => { if (!addMenu.hidden && !e.target.closest(".addmenu")) closeAddMenu(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !addMenu.hidden) { closeAddMenu(); $("#b-add").focus(); } });
document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-add],[data-task-from-alert],[data-open-pol],[data-pol-upd],[data-progress]");
  if (!t || $("#v-app").hidden) return;
  if (e.target.closest("[data-stop]")) return;   // link interni alla riga
  e.preventDefault(); e.stopPropagation(); closeAddMenu();
  if (t.dataset.add === "task") openDlForm(null, null, { kind: "internal" });
  else if (t.dataset.add === "deadline") openDlForm();
  else if (t.dataset.add === "policy") openPolForm();
  else if (t.dataset.taskFromAlert) { const a = alerts.find((x) => x.id === Number(t.dataset.taskFromAlert)); openDlForm(null, a, { kind: "internal", title: `Valutare: ${a?.title || ""}`.slice(0, 300) }); }
  else if (t.dataset.progress) setProgress(Number(t.dataset.progress), t.dataset.on === "1");
  else if (t.dataset.polUpd) openPolUpdate(policies.find((x) => x.id === Number(t.dataset.polUpd)));
  else if (t.dataset.openPol) openPolForm(policies.find((x) => x.id === Number(t.dataset.openPol)));
}, true);
$("#b-add-pol").onclick = () => openPolForm();

// ---------------------------------------------------------------- sicurezza
// celle CSV: evita che un testo raccolto dal web venga eseguito come formula in Excel (CSV injection)
const csvCell = (v) => { let t = String(v ?? ""); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; };
const logEvent = (action, details = {}) => sb ? sb.rpc("ra_log_event", { p_action: action, p_details: details }).then(() => {}, () => {}) : Promise.resolve();

// --- verifica in due passaggi (TOTP)
let mfaMode = "challenge", mfaFactorId = null, mfaTries = 0, mfaLockUntil = 0;
async function cleanupUnverified() {
  const { data } = await sb.auth.mfa.listFactors();
  for (const f of (data?.all || []).filter((f) => f.status !== "verified")) await sb.auth.mfa.unenroll({ factorId: f.id }).catch(() => {});
}
async function startEnroll() {
  await cleanupUnverified();
  const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: `RegAlert ${new Date().toISOString().slice(0, 16)}` });
  if (error) throw error;
  return { id: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}
async function showMfa(mode) {
  mfaMode = mode; show("v-mfa"); $("#mfa-msg").hidden = true; $("#mfa-code").value = "";
  $("#mfa-enroll").hidden = mode !== "enroll";
  $("#mfa-title").textContent = mode === "enroll" ? "Attiva la verifica in due passaggi" : "Verifica in due passaggi";
  $("#mfa-sub").textContent = mode === "enroll"
    ? "L'amministratore l'ha resa obbligatoria. Inquadra il codice con un'app di autenticazione (Google Authenticator, Microsoft Authenticator, 1Password…) e inserisci il codice di 6 cifre."
    : "Apri l'app di autenticazione e inserisci il codice di 6 cifre per RegAlert.";
  $("#mfa-submit").textContent = mode === "enroll" ? "Attiva e accedi" : "Verifica";
  try {
    if (mode === "enroll") { const e = await startEnroll(); mfaFactorId = e.id; $("#mfa-qr").src = e.qr; $("#mfa-secret").textContent = e.secret; }
    else { const { data } = await sb.auth.mfa.listFactors(); mfaFactorId = data?.totp?.[0]?.id || null; }
  } catch (e) { mfaMsg("Non riesco a preparare la verifica: " + (e.message || e), true); }
  setTimeout(() => $("#mfa-code").focus(), 50);
}
function mfaMsg(t, bad) { const m = $("#mfa-msg"); m.hidden = !t; m.textContent = t || ""; m.className = "msg " + (bad ? "err" : "ok"); }
$("#mfa-code").oninput = (e) => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6); if (e.target.value.length === 6) $("#f-mfa").requestSubmit(); };
$("#f-mfa").onsubmit = async (e) => {
  e.preventDefault();
  const code = $("#mfa-code").value;
  if (Date.now() < mfaLockUntil) return mfaMsg(`Troppi tentativi: riprova tra ${Math.ceil((mfaLockUntil - Date.now()) / 1000)} secondi.`, true);
  if (!/^\d{6}$/.test(code)) return mfaMsg("Il codice ha 6 cifre.", true);
  if (!mfaFactorId) return mfaMsg("Nessuna app di autenticazione registrata per questo account.", true);
  $("#mfa-submit").disabled = true;
  const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: mfaFactorId, code });
  $("#mfa-submit").disabled = false;
  if (error) {
    mfaTries++; if (mfaTries >= 5) { mfaLockUntil = Date.now() + 30000; mfaTries = 0; }
    logEvent("mfa_failed"); $("#mfa-code").value = "";
    return mfaMsg("Codice non valido o scaduto. Controlla che l'ora del telefono sia corretta.", true);
  }
  logEvent("mfa_verified", { enroll: mfaMode === "enroll" });
  if (mfaMode === "enroll") toast("Verifica in due passaggi attivata");
  await enter();
};

// --- sezione "Sicurezza dell'account" nel Team
let secEnrollId = null;
function renderSecMe() {
  const on = !!secState.has_factor;
  $("#sec-mfa-txt").textContent = on ? "Attiva: a ogni accesso RegAlert chiede anche il codice dell'app di autenticazione." : secState.require_mfa ? "Obbligatoria per questo team." : "Non attiva. Consigliata: protegge l'accesso anche se la password viene rubata.";
  $("#sec-mfa-acts").innerHTML = on ? `<span class="badge mfa-on">attiva</span> ${secState.require_mfa ? "" : `<button type="button" class="btn ghost sm" id="sec-off">Disattiva</button>`}` : `<button type="button" class="btn primary sm" id="sec-on">Attiva</button>`;
  if ($("#sec-on")) $("#sec-on").onclick = async () => {
    try { const e = await startEnroll(); secEnrollId = e.id; $("#sec-qr").src = e.qr; $("#sec-secret").textContent = e.secret; $("#sec-enroll").hidden = false; $("#sec-code").focus(); }
    catch (e) { toast("Non riesco ad avviare l'attivazione: " + (e.message || e), { bad: true }); }
  };
  if ($("#sec-off")) $("#sec-off").onclick = async () => {
    if (!(await confirmBox("Disattivare la verifica in due passaggi?", "Per accedere basterà di nuovo la sola password. Puoi riattivarla quando vuoi.", "Disattiva"))) return;
    const { data } = await sb.auth.mfa.listFactors();
    for (const f of data?.totp || []) { const { error } = await sb.auth.mfa.unenroll({ factorId: f.id }); if (error) return toast(error.message, { bad: true }); }
    await sb.auth.refreshSession(); secState.has_factor = false; renderSecMe(); toast("Verifica in due passaggi disattivata");
  };
}
$("#sec-cancel").onclick = async () => { $("#sec-enroll").hidden = true; if (secEnrollId) await sb.auth.mfa.unenroll({ factorId: secEnrollId }).catch(() => {}); secEnrollId = null; };
$("#sec-code").oninput = (e) => { e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6); };
$("#sec-verify").onclick = async () => {
  const code = $("#sec-code").value;
  if (!/^\d{6}$/.test(code) || !secEnrollId) return toast("Inserisci il codice di 6 cifre mostrato dall'app", { bad: true });
  const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: secEnrollId, code });
  if (error) { logEvent("mfa_failed"); return toast("Codice non valido: riprova con quello nuovo", { bad: true }); }
  logEvent("mfa_verified", { enroll: true });
  secEnrollId = null; $("#sec-enroll").hidden = true; $("#sec-code").value = "";
  secState.has_factor = true; renderSecMe(); loadProfiles().then(renderTeam); toast("Verifica in due passaggi attivata");
};
$("#sec-pw-open").onclick = () => { $("#f-pw").hidden = false; $("#pw-1").focus(); };
$("#pw-cancel").onclick = () => { $("#f-pw").hidden = true; $("#pw-1").value = $("#pw-2").value = ""; };
$("#f-pw").onsubmit = async (e) => {
  e.preventDefault();
  const a = $("#pw-1").value, b = $("#pw-2").value;
  if (a.length < 12) return toast("La password deve avere almeno 12 caratteri", { bad: true });
  if (a !== b) return toast("Le due password non coincidono", { bad: true });
  if (me && a.toLowerCase().includes(me.email.split("@")[0].toLowerCase())) return toast("La password non deve contenere il tuo nome utente", { bad: true });
  const { error } = await sb.auth.updateUser({ password: a });
  if (error) return toast(/different|same/i.test(error.message) ? "Scegli una password diversa da quella attuale" : /weak|pwned|leaked/i.test(error.message) ? "Password troppo debole o già comparsa in fughe di dati" : /reauth|aal2|recent/i.test(error.message) ? "Per sicurezza esci e rientra, poi riprova" : error.message, { bad: true });
  await sb.auth.signOut({ scope: "others" }).catch(() => {});
  logEvent("password_changed", { via: "profilo" });
  $("#pw-cancel").click(); toast("Password aggiornata: le altre sessioni sono state chiuse");
};

// --- impostazioni di sicurezza e registro (solo admin)
$("#f-security").onsubmit = async (e) => {
  e.preventDefault();
  const req = $("#set-mfa").checked;
  if (req && !secState.has_factor) return toast("Prima attiva la verifica in due passaggi sul tuo account (sezione Team)", { bad: true });
  if (req && !(await confirmBox("Rendere obbligatoria la verifica in due passaggi?", "Chi non l'ha ancora attivata non vedrà alcun dato finché non la attiva al prossimo accesso.", "Rendi obbligatoria"))) return;
  const { error } = await sb.from("ra_settings").upsert([{ key: "require_mfa", value: req ? "true" : "false" }, { key: "idle_timeout_minutes", value: $("#set-idle").value }]);
  if (error) return toast(error.message, { bad: true });
  secState.require_mfa = req; secState.idle_timeout_minutes = +$("#set-idle").value; startIdleWatch();
  toast("Impostazioni di sicurezza salvate"); loadAudit();
};
const AUDIT_TXT = {
  login: "Accesso", logout: "Uscita", idle_logout: "Uscita automatica per inattività", mfa_verified: "Codice di verifica corretto", mfa_failed: "Codice di verifica errato",
  mfa_enabled: "Verifica in due passaggi attivata", mfa_removed: "Verifica in due passaggi rimossa", password_changed: "Password cambiata",
  export_register_pdf: "Esportato il registro attestazioni (PDF)", export_register_csv: "Esportato il registro attestazioni (CSV)", export_attestation_pdf: "Esportata un'attestazione (PDF)",
  export_alerts_csv: "Esportati gli alert (CSV)", export_policies_csv: "Esportato il registro delle politiche (CSV)", export_ics: "Esportato il calendario (.ics)",
  signup: "Nuova iscrizione", remove: "Utente rimosso", role_change: "Ruolo cambiato", create: "Creata", update: "Modificata", delete: "Eliminata", insert: "Impostazione aggiunta", reopen: "Riaperta dopo il completamento",
};
const ENTITY_TXT = { source: "Fonte", setting: "Impostazione", deadline: "Scadenza", task: "Attività", policy: "Politica", profile: "Utente", session: "" };
let auditRows = [];
function auditDetail(r) {
  const d = r.details || {};
  if (r.entity === "profile" && r.action === "role_change") return `${d.email}: ${ROLE[d.from] || d.from} → ${ROLE[d.to] || d.to}`;
  if (r.entity === "profile") return d.email || "";
  if (r.entity === "source") return [d.name || d.to?.name, d.url || d.to?.url].filter(Boolean).join(" · ");
  if (r.entity === "setting") return `${r.entity_id}${r.entity_id === "org_profile" ? "" : `: ${d.from ?? "—"} → ${d.to ?? "—"}`}`;
  if (r.entity === "deadline") return `${d.title || ""}${d.due_date ? " · " + d.due_date : ""}`;
  return [d.number, d.period && `periodo ${d.period}`, d.rows != null && `${d.rows} righe`].filter(Boolean).join(" · ");
}
async function loadAudit() {
  const { data, error } = await sb.from("ra_audit_log").select("*").order("at", { ascending: false }).limit(500);
  auditRows = error ? [] : data || []; renderAudit();
}
function renderAudit() {
  const f = $("#audit-f").value, rows = auditRows.filter((r) => !f || r.entity === f);
  $("#audit-list").innerHTML = rows.length ? rows.slice(0, 300).map((r) => `<div class="audit-row"><time title="${esc(r.at)}">${esc(stamp(r.at).slice(0, 17).replace(",", ""))}</time>
    <div><b>${esc([ENTITY_TXT[r.entity], AUDIT_TXT[r.action] || r.action].filter(Boolean).join(" · "))}</b> <span class="muted">${esc(r.actor_email || "sistema")}${r.aal === "aal2" ? " · 2 passaggi" : ""}</span><div class="d">${esc(auditDetail(r))}</div></div></div>`).join("")
    : `<p class="hint" style="padding:12px 0;margin:0">Nessun evento registrato.</p>`;
}
$("#audit-f").onchange = renderAudit;
$("#audit-csv").onclick = () => {
  if (!auditRows.length) return toast("Nessun evento da esportare");
  const csv = "﻿" + [["Data e ora (UTC)", "Utente", "Livello", "Evento", "Oggetto", "ID oggetto", "Dettagli"].map(csvCell).join(";"),
    ...auditRows.map((r) => [new Date(r.at).toISOString(), r.actor_email, r.aal, AUDIT_TXT[r.action] || r.action, ENTITY_TXT[r.entity] || r.entity, r.entity_id, JSON.stringify(r.details || {})].map(csvCell).join(";"))].join("\r\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `regalert-registro-sicurezza-${todayKey()}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

// --- uscita automatica dopo un periodo di inattività
let idleTimer = null, lastActivity = Date.now();
const markActive = () => { lastActivity = Date.now(); };
["pointerdown", "keydown", "scroll", "touchstart"].forEach((ev) => addEventListener(ev, markActive, { passive: true, capture: true }));
function stopIdleWatch() { clearInterval(idleTimer); idleTimer = null; }
function startIdleWatch() {
  stopIdleWatch(); lastActivity = Date.now();
  const limit = Math.max(5, +secState.idle_timeout_minutes || 30) * 60000;
  const check = async () => {
    if (!me || Date.now() - lastActivity < limit) return;
    stopIdleWatch(); await logEvent("idle_logout"); await sb.auth.signOut();
    show("v-auth"); setAuthMode("login"); authMsg("Sessione chiusa dopo un periodo di inattività. Accedi di nuovo.", false);
  };
  idleTimer = setInterval(check, 20000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) check(); });
}

// ---------------------------------------------------------------- app installabile (PWA)
// contatori della barra laterale copiati nella barra in basso; alert aperti anche sull'icona dell'app
const syncTabBadges = () => {
  $$("#tabbar .tb").forEach((t) => { const src = $("#" + t.dataset.src); t.hidden = src.hidden; t.textContent = src.textContent;
    if (t.dataset.src === "nav-dl") t.classList.toggle("crit", !!src.style.background); });
  const n = +$("#nav-count").textContent || 0;
  if ("setAppBadge" in navigator) (n && !$("#nav-count").hidden ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
};
new MutationObserver(syncTabBadges).observe($("#nav"), { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["hidden", "style"] });

const netState = () => ($("#netbar").hidden = navigator.onLine);
addEventListener("online", () => { netState(); if (!$("#v-offline").hidden) enter(); else if (me) { loadAlerts(true); loadDeadlines(); } });
$("#off-retry").onclick = () => (navigator.onLine ? enter() : toast("Ancora nessuna connessione", { bad: true }));
addEventListener("offline", netState); netState();

const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
let installEvt = null;
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvt = e; $("#b-install").hidden = false; });
addEventListener("appinstalled", () => { installEvt = null; $("#b-install").hidden = true; toast("RegAlert è installata: la trovi tra le app"); });
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
if (isIos && !standalone) $("#b-install").hidden = false;
$("#b-install").onclick = async () => {
  closeNav();
  if (installEvt) { installEvt.prompt(); const r = await installEvt.userChoice; if (r.outcome === "accepted") $("#b-install").hidden = true; installEvt = null; return; }
  $("#dlg-ios").showModal();
};

const hadSw = "serviceWorker" in navigator && !!navigator.serviceWorker.controller;
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("sw.js").then((reg) => {
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      w?.addEventListener("statechange", () => { if (w.state === "activated" && hadSw) toast("App aggiornata alla nuova versione"); });
    });
  }).catch(() => {});
}
window.addEventListener("hashchange", () => me && me.role !== "pending" && go(location.hash.slice(1)));

// ---------------------------------------------------------------- eventi: alert
$("#q").addEventListener("input", renderAlerts);
["#f-authority", "#f-tag", "#f-priority"].forEach((s) => $(s).addEventListener("change", renderAlerts));
$("#f-mine").onclick = (e) => { e.currentTarget.setAttribute("aria-pressed", e.currentTarget.getAttribute("aria-pressed") !== "true"); renderAlerts(); };
const clearFilters = () => { ["#f-authority", "#f-tag", "#f-priority", "#q"].forEach((s) => ($(s).value = "")); $("#f-mine").setAttribute("aria-pressed", "false"); renderAlerts(); };
$("#f-clear").onclick = clearFilters;
$("#tabs").onclick = (e) => { const k = e.target.closest("[data-tab]")?.dataset.tab; if (!k) return; tab = k; store.set("ra_tab", k); renderAlerts(); };
$("#list").onclick = (e) => { if (e.target.closest("[data-clear]")) return clearFilters(); const it = e.target.closest(".item"); if (it) select(Number(it.dataset.id)); };
$("#b-export").onclick = exportCsv;

$("#reader").addEventListener("input", (e) => { if (e.target.closest("#f-triage")) markDirty(); });
$("#reader").addEventListener("change", (e) => { if (e.target.closest("#f-triage")) markDirty(); });
$("#reader").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (e.target.id === "f-triage") saveTriage(triageValues());
  if (e.target.id === "f-comment") {
    const note = $("#c-text").value.trim(); if (!note) return;
    const { error } = await sb.from("ra_alert_events").insert({ alert_id: selectedId, actor: me.id, action: "comment", note });
    if (error) return toast("Commento non salvato: " + error.message, { bad: true });
    $("#c-text").value = ""; loadTimeline(selectedId);
  }
});
$("#reader").addEventListener("click", async (e) => {
  if (e.target.closest("#b-back")) {
    if (dirty && !(await confirmBox("Modifiche non salvate", "Vuoi tornare all'elenco senza salvare il triage?", "Torna senza salvare"))) return;
    dirty = false; selectedId = null; $("#view-alerts").classList.remove("show-detail"); renderAlerts(); return;
  }
  if (e.target.closest("#b-revert")) { dirty = false; renderDetail(); return; }
  const q = e.target.closest("[data-quick]")?.dataset.quick; if (!q) return;
  const cur = triageValues();
  if (q === "take") saveTriage({ ...cur, assignee: me.id, status: cur.status === "new" ? "in_review" : cur.status }, "Preso in carico");
  if (q === "action") saveTriage({ ...cur, status: "action_required" }, "Segnato: richiede azione");
  if (q === "close") saveTriage({ ...cur, status: "closed" }, "Alert chiuso");
  if (q === "reopen") saveTriage({ ...cur, status: "in_review" }, "Alert riaperto");
  if (q === "nr") saveTriage({ ...cur, status: "not_relevant" }, "Archiviato come non pertinente");
});

// scorciatoie da tastiera
document.addEventListener("keydown", (e) => {
  if ($("#v-app").hidden || $("#view-alerts").hidden || document.querySelector("dialog[open]")) return;
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  if (e.key === "Escape" && typing) { document.activeElement.blur(); return; }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  const rows = filtered(), i = rows.findIndex((a) => a.id === selectedId);
  if (e.key === "/") { e.preventDefault(); $("#q").focus(); }
  else if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); if (rows[i + 1]) select(rows[i + 1].id); }
  else if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); if (rows[i - 1]) select(rows[i - 1].id); }
  else if (e.key === "o") { const u = safeUrl(alerts.find((a) => a.id === selectedId)?.url); if (u) window.open(u, "_blank", "noopener"); }
  else if (e.key === "t" && canEdit() && selectedId) $('[data-quick="take"]')?.click();
});
window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

$("#b-collect").onclick = async () => {
  const b = $("#b-collect"); b.disabled = true; toast("Controllo delle fonti in corso…", { busy: true });
  try {
    const r = await callFn("collect", { force: true });
    const nuovi = (r.results || []).reduce((n, x) => n + (x.new || 0), 0), errori = (r.results || []).filter((x) => x.error).length;
    toast(`${r.checked} fonti controllate · ${nuovi ? `${nuovi} novità` : "nessuna novità"}${errori ? ` · ${errori} con errore` : ""}`, { bad: errori > 0 && !nuovi });
    await Promise.all([loadSources(), loadAlerts(true)]); if (!$("#view-sources").hidden) renderSources();
  } catch (err) { toast("Controllo non riuscito: " + err.message, { bad: true }); }
  b.disabled = false;
};

// ---------------------------------------------------------------- eventi: fonti
$("#b-add-source").onclick = () => openSourceForm();
$("#b-cancel-source").onclick = $("#b-cancel-source2").onclick = () => $("#dlg-source").close();
$("#b-test").onclick = async () => {
  const url = $("#s-url").value.trim(); const out = $("#test-out");
  if (!/^https?:\/\//.test(url)) { out.hidden = false; out.className = "test-out err"; out.textContent = "Inserisci un indirizzo che inizi con https://"; return; }
  out.hidden = false; out.className = "test-out"; out.innerHTML = `<span class="spin" style="display:inline-block;vertical-align:-2px;margin-right:8px"></span>Leggo la pagina…`;
  try {
    const r = await callFn("collect", { test_url: url });
    $$('input[name="s-kind"]').forEach((x) => (x.checked = x.value === r.suggested_kind));
    if (!$("#s-name").value && r.title) $("#s-name").value = r.title.split(/\s[-|–]\s/)[0].slice(0, 80);
    if (r.suggested_kind === "rss") out.innerHTML = `<b>Feed valido</b> con ${r.items.length} elementi recenti, ad esempio:<ul>${r.items.slice(0, 3).map((i) => `<li>${esc(i.title)}</li>`).join("")}</ul>`;
    else out.innerHTML = `${r.discovered_feed ? `<b>La pagina ha un feed RSS</b>, più affidabile: <a href="#" id="use-feed" class="mono">${esc(r.discovered_feed)}</a><br>` : ""}<b>${r.links.length} link di contenuto</b> trovati${r.links.length ? `, ad esempio:<ul>${r.links.slice(0, 4).map((l) => `<li>${esc(l.title)}</li>`).join("")}</ul>` : "."} Tipo suggerito: <b>${KIND[r.suggested_kind]}</b>.`;
    $("#use-feed")?.addEventListener("click", (ev) => { ev.preventDefault(); $("#s-url").value = r.discovered_feed; $$('input[name="s-kind"]').forEach((x) => (x.checked = x.value === "rss")); $("#b-test").click(); });
  } catch (err) { out.className = "test-out err"; out.textContent = "Non riesco a leggere l'indirizzo: " + humanError(err.message); }
};
$("#f-source").onsubmit = async (e) => {
  e.preventDefault();
  const row = { url: $("#s-url").value.trim(), name: $("#s-name").value.trim(), authority: $("#s-authority").value.trim(), jurisdiction: $("#s-jur").value,
    kind: kindVal(), check_every_minutes: Number($("#s-every").value), tags: $("#s-tags").value.split(",").map((t) => t.trim()).filter(Boolean),
    link_pattern: $("#s-pattern").value.trim() || null, css_selector: $("#s-selector").value.trim() || null };
  if (!/^https?:\/\//.test(row.url) || !row.name || !row.authority) return toast("Compila indirizzo, autorità e nome della fonte.", { bad: true });
  if (row.link_pattern) { try { new RegExp(row.link_pattern); } catch { return toast("Il filtro sugli indirizzi non è un'espressione regolare valida.", { bad: true }); } }
  const reset = editingSource && (editingSource.url !== row.url || editingSource.kind !== row.kind) ? { last_checked_at: null, last_snapshot: null, last_hash: null, last_status: null, last_error: null } : {};
  const res = editingSource ? await sb.from("ra_sources").update({ ...row, ...reset }).eq("id", editingSource.id) : await sb.from("ra_sources").insert(row);
  if (res.error) return toast("Fonte non salvata: " + (/duplicate/.test(res.error.message) ? "questo indirizzo è già monitorato." : res.error.message), { bad: true });
  $("#dlg-source").close();
  toast(editingSource ? "Fonte aggiornata" : "Fonte aggiunta: al primo controllo registra lo stato di partenza");
  await loadSources(); renderSources();
};
$("#b-delete-source").onclick = async () => {
  if (!editingSource) return;
  $("#dlg-source").close();
  const n = alerts.filter((a) => a.source_id === editingSource.id).length;
  if (!(await confirmBox("Eliminare la fonte?", `Verranno eliminati anche i ${n} alert collegati e il loro storico. Per smettere di monitorarla conservando lo storico, usa "Pausa".`, "Elimina definitivamente"))) return;
  const { error } = await sb.from("ra_sources").delete().eq("id", editingSource.id);
  if (error) return toast(error.message, { bad: true });
  toast("Fonte eliminata"); await Promise.all([loadSources(), loadAlerts(true)]); renderSources();
};
$("#src-list").onclick = async (e) => {
  const b = e.target.closest("button"); if (!b) return;
  if (b.dataset.editSrc) openSourceForm(sources.find((s) => s.id == b.dataset.editSrc));
  if (b.dataset.toggle) {
    const s = sources.find((x) => x.id == b.dataset.toggle);
    const { error } = await sb.from("ra_sources").update({ active: !s.active }).eq("id", s.id);
    if (error) return toast(error.message, { bad: true });
    toast(s.active ? "Fonte in pausa" : "Fonte riattivata"); await loadSources(); renderSources();
  }
  if (b.dataset.check) {
    b.disabled = true; toast("Controllo in corso…", { busy: true });
    try { const r = await callFn("collect", { source_id: Number(b.dataset.check) }); const x = r.results?.[0] || {};
      toast(x.error ? humanError(x.error) : x.baseline ? "Stato di partenza registrato" : x.new ? `${x.new} novità trovate` : "Nessuna novità", { bad: !!x.error }); }
    catch (err) { toast(err.message, { bad: true }); }
    await Promise.all([loadSources(), loadAlerts(true)]); renderSources();
  }
};

// ---------------------------------------------------------------- eventi: team e impostazioni
$("#f-me").onsubmit = async (e) => {
  e.preventDefault();
  const patch = { full_name: $("#me-name").value.trim() || null, telegram_chat_id: $("#me-tg").value.trim() || null, notify_daily: $("#me-daily").checked, notify_instant: $("#me-instant").checked };
  const { error } = await sb.from("ra_profiles").update(patch).eq("id", me.id);
  if (error) return toast(error.message, { bad: true });
  Object.assign(me, patch); $("#me-name-side").textContent = me.full_name || me.email;
  await loadProfiles(); renderTeam(); toast("Preferenze salvate");
};
$("#members").onchange = async (e) => {
  const id = e.target.dataset.role; if (!id) return;
  const { error } = await sb.from("ra_profiles").update({ role: e.target.value }).eq("id", id);
  error ? toast(error.message, { bad: true }) : toast(`Ruolo aggiornato: ${ROLE[e.target.value]}`);
  await loadProfiles(); renderTeam();
};
$("#f-settings").onsubmit = async (e) => {
  e.preventDefault();
  const { error } = await sb.from("ra_settings").upsert([{ key: "org_profile", value: $("#set-org").value.trim() }, { key: "digest_recipients_extra", value: $("#set-extra").value.trim() }]);
  error ? toast(error.message, { bad: true }) : toast("Impostazioni salvate");
};
$("#b-preview-digest").onclick = async () => {
  const p = $("#digest-preview");
  try {
    const r = await callFn("digest", { mode: "daily", dry_run: true });
    p.hidden = false;
    if (!r.would_send) { p.innerHTML = `<div class="panel"><p class="muted" style="margin:0">Nessuna novità in coda: il prossimo digest partirà quando ce ne saranno.</p></div>`; return; }
    p.innerHTML = `<div class="dlg-h" style="border-bottom:1px solid var(--line)"><h3>Anteprima del digest</h3><span class="hint" style="margin-left:auto">${r.would_send} novità · ${r.emails.length} destinatari email · ${r.chats.length} chat Telegram</span></div><iframe title="Anteprima digest" style="width:100%;height:520px;border:0;background:#fff;display:block"></iframe>`;
    p.querySelector("iframe").srcdoc = r.preview_html;
  } catch (err) { toast(err.message, { bad: true }); }
};
$("#b-send-digest").onclick = async () => {
  if (!(await confirmBox("Inviare il digest adesso?", "Il digest parte subito verso tutti i destinatari con il digest attivo. Le novità incluse non verranno ripetute nel digest di domani mattina.", "Invia ora"))) return;
  try { const r = await callFn("digest", { mode: "daily" }); toast(r.sent ? `Digest inviato con ${r.sent} novità` : r.note, { bad: !r.sent && /canale/.test(r.note || "") }); }
  catch (err) { toast(err.message, { bad: true }); }
};

// ---------------------------------------------------------------- eventi: scadenziario
$("#dl-v-list").onclick = () => { dlView = "list"; store.set("ra_dl_view", "list"); renderDeadlines(); };
$("#dl-v-month").onclick = () => { dlView = "month"; store.set("ra_dl_view", "month"); renderDeadlines(); };
["#dl-f-kind", "#dl-f-auth", "#dl-f-area"].forEach((s) => $(s).addEventListener("change", renderDeadlines));
["#dl-f-mine", "#dl-f-alerts", "#dl-f-pol"].forEach((s) => ($(s).onclick = (e) => { e.currentTarget.setAttribute("aria-pressed", e.currentTarget.getAttribute("aria-pressed") !== "true"); renderDeadlines(); }));
$("#b-add-dl").onclick = () => openDlForm();
$("#b-ics").onclick = () => { exportIcs(); logEvent("export_ics"); };
$$("[data-close-dl]").forEach((b) => (b.onclick = () => $("#dlg-dl").close()));
$("#f-dl").onsubmit = async (e) => {
  e.preventDefault();
  const row = { title: $("#d-title").value.trim(), due_date: $("#d-date").value, kind: $('input[name="d-kind"]:checked').value,
    assignee: $("#d-assignee").value || null, authority: $("#d-authority").value.trim() || null, regulation: $("#d-reg").value.trim() || null,
    area: $("#d-area").value.trim() || null, owner_label: $("#d-owner-label").value.trim() || null,
    recurrence: $("#d-rec").value, remind_days: Number($("#d-remind").value), url: $("#d-url").value.trim() || null, notes: $("#d-notes").value.trim() || null, continuous: $("#d-cont").checked,
    alert_id: Number($("#dlg-dl").dataset.alertId) || null, priority: $("#d-pri").value };
  if (row.kind === "internal" && editingDl?.status === "open") row.in_progress = $("#d-prog").checked;
  if (!row.due_date) {
    if (row.kind !== "internal") return toast("Indica la data: è facoltativa solo per le attività.", { bad: true });
    if (row.recurrence !== "none" || row.continuous) return toast("Un'attività ricorrente o un presidio ha bisogno di una data.", { bad: true });
    row.due_date = null;
  }
  if (!row.title) return toast(row.kind === "internal" ? "Scrivi cosa c'è da fare." : "Indica cosa scade.", { bad: true });
  if (row.url && !/^https?:\/\//.test(row.url)) return toast("Il link deve iniziare con https://", { bad: true });
  if (editingDl?.status === "proposed") row.status = "open";
  const res = editingDl ? await sb.from("ra_deadlines").update(row).eq("id", editingDl.id) : await sb.from("ra_deadlines").insert(row);
  if (res.error) return toast("Scadenza non salvata: " + res.error.message, { bad: true });
  const what = row.kind === "internal" ? "Attività" : "Scadenza";
  $("#dlg-dl").close(); toast(editingDl ? `${what} aggiornata` : row.assignee && row.assignee !== me.id ? `${what} assegnata a ${profiles.find((p) => p.id === row.assignee)?.full_name || "un collega"}` : `${what} aggiunta`); await loadDeadlines();
};
$("#b-del-dl").onclick = async () => {
  if (!editingDl) return; $("#dlg-dl").close();
  if (!(await confirmBox("Eliminare la scadenza?", `"${editingDl.title}" verrà eliminata. Se è stata gestita, usa piuttosto "Completa": resta nello storico.`, "Elimina"))) return;
  const { error } = await sb.from("ra_deadlines").delete().eq("id", editingDl.id);
  error ? toast(error.message, { bad: true }) : (toast("Scadenza eliminata"), loadDeadlines());
};
document.addEventListener("click", async (e) => {
  const t = e.target.closest("[data-complete],[data-reopen],[data-edit-dl],[data-accept],[data-reject],[data-goto-alert],[data-goto-presidi],[data-new-dl],[data-cal],#b-dl-from-alert");
  if (!t || $("#v-app").hidden) return;
  e.preventDefault();
  const id = (k) => Number(t.dataset[k]);
  if (t.dataset.complete) {
    const dd = deadlines.find((x) => x.id === id("complete"));
    let res = { outcome: null, note: null };
    if (dd && (dd.kind === "control" || dd.continuous)) { res = await askOutcome(dd); if (!res) return; }
    const { data, error } = await sb.rpc("ra_complete_deadline", { p_id: id("complete"), p_outcome: res.outcome, p_note: res.note });
    if (error) return toast(error.message, { bad: true });
    const nx = data && (await sb.from("ra_deadlines").select("due_date").eq("id", data).maybeSingle()).data;
    const att = dd && (dd.kind === "control" || dd.continuous) ? (await sb.from("ra_attestations").select("number").eq("deadline_id", dd.id).order("seq", { ascending: false }).limit(1).maybeSingle()).data : null;
    toast(att ? `${dd.continuous ? "Presidio attestato" : "Controllo registrato"} con il n. ${att.number}${nx ? ` · prossimo il ${fullDate(nx.due_date + "T12:00:00Z", false)}` : ""}`
      : nx ? `Completata. Prossima scadenza: ${fullDate(nx.due_date + "T12:00:00Z", false)}` : "Scadenza completata"); loadDeadlines();
  } else if (t.dataset.reopen) {
    const { error } = await sb.from("ra_deadlines").update({ status: "open" }).eq("id", id("reopen"));
    error ? toast(error.message, { bad: true }) : (toast("Scadenza riaperta"), loadDeadlines());
  } else if (t.dataset.editDl) openDlForm(deadlines.find((d) => d.id === id("editDl")));
  else if (t.dataset.accept) {
    const { error } = await sb.from("ra_deadlines").update({ status: "open", assignee: me.id }).eq("id", id("accept"));
    error ? toast(error.message, { bad: true }) : (toast("Aggiunta allo scadenziario"), loadDeadlines());
  } else if (t.dataset.reject) {
    const { error } = await sb.from("ra_deadlines").delete().eq("id", id("reject"));
    error ? toast(error.message, { bad: true }) : (toast("Proposta scartata"), loadDeadlines());
  } else if (t.dataset.gotoAlert) gotoAlert(t.dataset.gotoAlert);
  else if (t.hasAttribute("data-new-dl")) openDlForm();
  else if (t.hasAttribute("data-goto-presidi")) { dlView = "list"; store.set("ra_dl_view", "list"); store.set("ra_presidi_open", "1"); renderDeadlines(); $("#dl-presidi").scrollIntoView({ behavior: "smooth" }); }
  else if (t.dataset.cal !== undefined) {
    const step = Number(t.dataset.cal);
    if (!step) calMonth = null; else { const [y, m] = (calMonth || todayKey().slice(0, 7)).split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + step, 1)); calMonth = d.toISOString().slice(0, 7); }
    renderMonth();
  } else if (t.id === "b-dl-from-alert") openDlForm(null, alerts.find((a) => a.id === selectedId));
});

// ---------------------------------------------------------------- eventi: importazione
$("#b-import").onclick = openImport;
$("#imp-file").onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) readImpFile(f); };
$("#dlg-imp").addEventListener("click", (e) => { if (e.target.closest("[data-close-imp]")) $("#dlg-imp").close(); });
$("#imp-body").addEventListener("change", onImpEdit);
$("#imp-body").addEventListener("input", (e) => { if (e.target.matches('input[data-f="title"], input[data-f="area"]')) onImpEdit(e); });

// aggiorna i tempi relativi ogni minuto
setInterval(() => { if (me && !$("#v-app").hidden) { renderHealth(); if (!$("#view-alerts").hidden && !dirty) renderAlerts(); } }, 60000);

boot().catch((e) => { console.error(e); if (!window.__raStarted && window.__raFatal) window.__raFatal(); });
