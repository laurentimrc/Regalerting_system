// RegAlert — service worker: rende l'app installabile e la apre anche senza rete.
// Solo l'interfaccia viene salvata sul telefono: i dati (Supabase) passano sempre dalla rete e non finiscono in cache.
const VERSION = "ra-v2";
const SHELL = ["./", "./index.html", "./app.js", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon.svg"];
const CDN = ["cdn.jsdelivr.net", "cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // pagina: prima la rete (versione sempre aggiornata), la copia salvata solo se offline
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then((r) => { const c = r.clone(); caches.open(VERSION).then((k) => k.put("./index.html", c)); return r; })
      .catch(() => caches.match("./index.html")));
    return;
  }
  // codice dell'app: sempre la versione appena pubblicata, la copia salvata solo se offline
  if (url.origin === self.location.origin && url.pathname.endsWith("/app.js")) {
    e.respondWith(fetch(req).then((r) => { if (r.ok) { const c = r.clone(); caches.open(VERSION).then((k) => k.put(req, c)); } return r; })
      .catch(() => caches.match(req)));
    return;
  }
  // librerie e font con versione fissa: dalla cache, scaricati la prima volta
  if (CDN.includes(url.hostname)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => {
      if (r.ok || r.type === "opaque") { const c = r.clone(); caches.open(VERSION).then((k) => k.put(req, c)); }
      return r;
    })));
    return;
  }
  // file dell'app (icone, manifest): cache e aggiornamento in sottofondo
  if (url.origin === self.location.origin) {
    e.respondWith(caches.match(req).then((hit) => {
      const net = fetch(req).then((r) => { if (r.ok) { const c = r.clone(); caches.open(VERSION).then((k) => k.put(req, c)); } return r; }).catch(() => hit);
      return hit || net;
    }));
  }
  // tutto il resto (API Supabase, autenticazione) non viene toccato
});
