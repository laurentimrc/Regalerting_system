// RegAlert — service worker: rende l'app installabile e la apre anche senza rete.
// Solo l'interfaccia viene salvata sul telefono: i dati (Supabase) passano sempre dalla rete e non finiscono in cache.
const VERSION = "ra-v3";
const SHELL = ["./", "./index.html", "./app.js", "./guard.js", "./vendor/supabase-2.49.4.js", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon.svg"];
const FONTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  // elimina le copie delle versioni precedenti (comprese le librerie scaricate dalle CDN)
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const save = (req, r) => { if (r && r.ok && r.type === "basic" || r && r.ok && r.type === "cors") { const c = r.clone(); caches.open(VERSION).then((k) => k.put(req, c)); } return r; };
const networkFirst = (req, key) => fetch(req).then((r) => save(key || req, r)).catch(() => caches.match(key || req));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // pagina: prima la rete (versione sempre aggiornata), la copia salvata solo se offline
  if (req.mode === "navigate") { e.respondWith(networkFirst(req, "./index.html")); return; }
  if (url.origin === self.location.origin) {
    // librerie con la versione nel nome: dalla copia salvata
    if (url.pathname.includes("/vendor/")) { e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => save(req, r)))); return; }
    // codice dell'app, icone, manifest: sempre l'ultima versione, la copia solo se offline
    e.respondWith(networkFirst(req));
    return;
  }
  // font: dalla copia salvata
  if (FONTS.includes(url.hostname)) { e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => save(req, r)))); return; }
  // tutto il resto (API Supabase, autenticazione) non viene toccato
});
