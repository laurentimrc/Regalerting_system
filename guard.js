// RegAlert — rete di sicurezza: se l'app non parte entro pochi secondi, mostra una schermata di ripristino invece di una pagina bianca.
(function () {
  var errors = [];
  window.addEventListener("error", function (e) {
    errors.push((e.message || "errore") + (e.filename ? " (" + e.filename.split("/").pop() + ")" : ""));
    if (e.target && e.target.tagName === "SCRIPT") errors.push("script non caricato: " + (e.target.src || "").split("/").pop());
  }, true);
  window.addEventListener("unhandledrejection", function (e) { errors.push(String(e.reason && e.reason.message || e.reason)); });
  function showFatal() {
    if (window.__raStarted) return;
    var f = document.getElementById("v-fatal");
    if (!f) return;
    var d = document.getElementById("fatal-detail");
    if (d) d.textContent = errors.length ? errors.slice(0, 3).join(" · ") : "nessun messaggio di errore";
    f.hidden = false;
  }
  setTimeout(showFatal, 7000);
  window.__raFatal = showFatal;
  async function reset() {
    var b = document.getElementById("fatal-reset"); if (b) { b.disabled = true; b.textContent = "Ripristino…"; }
    try {
      if (navigator.serviceWorker) { var regs = await navigator.serviceWorker.getRegistrations(); for (var i = 0; i < regs.length; i++) await regs[i].unregister(); }
      if (window.caches) { var ks = await caches.keys(); for (var j = 0; j < ks.length; j++) await caches.delete(ks[j]); }
    } catch (e) { /* si ricarica comunque */ }
    location.reload();
  }
  document.addEventListener("click", function (e) { if (e.target && e.target.id === "fatal-reset") reset(); });
})();
