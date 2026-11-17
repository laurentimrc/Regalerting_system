// RegAlert — rete: scarica solo da siti pubblici (protezione SSRF) e limita le origini del browser (CORS).

const MAX_BYTES = 6 * 1024 * 1024;   // pagine e feed oltre 6 MB vengono troncati
const MAX_REDIRECTS = 5;

const BLOCKED_SUFFIX = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|svc|cluster\.local|supabase\.co|supabase\.in|supabase\.net)$/i;

/** true per indirizzi IP che non devono mai essere raggiunti dal raccoglitore (privati, loopback, link-local, metadati cloud...). */
export function isPrivateIp(ip: string): boolean {
  const v = ip.replace(/^\[|\]$/g, "").toLowerCase();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v)) {
    const [a, b] = v.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) || a >= 224;
  }
  if (v.includes(":")) {
    if (v === "::" || v === "::1") return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v) || v.startsWith("64:ff9b:") || v.startsWith("2001:db8");
  }
  return false;
}

/** Controlla un indirizzo prima di scaricarlo: solo http(s), porte standard, nome di dominio pubblico che non risolve su IP interni. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("Indirizzo non valido"); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Sono ammessi solo indirizzi http(s)");
  if (u.username || u.password) throw new Error("Indirizzo con credenziali non ammesso");
  if (u.port && u.port !== "80" && u.port !== "443") throw new Error("Porta non ammessa");
  const host = u.hostname.toLowerCase();
  if (!host.includes(".") || /^[\d.]+$/.test(host) || host.startsWith("[") || BLOCKED_SUFFIX.test(host)) throw new Error("Indirizzo interno o non pubblico non ammesso");
  // risoluzione DNS: blocca i nomi che puntano a reti interne (se il runtime la consente)
  for (const type of ["A", "AAAA"] as const) {
    let addrs: string[] = [];
    try { addrs = await Deno.resolveDns(host, type); } catch { /* record assente o DNS non disponibile */ }
    if (addrs.some(isPrivateIp)) throw new Error("Il dominio punta a una rete interna: non ammesso");
  }
  return u;
}

/** fetch con controllo di ogni redirect e limite di dimensione. */
export async function safeFetch(raw: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 25_000);
  try {
    let url = (await assertPublicUrl(raw)).toString();
    for (let hop = 0; ; hop++) {
      const res = await fetch(url, { ...init, signal: ctrl.signal, redirect: "manual" });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        if (hop >= MAX_REDIRECTS) throw new Error("Troppi reindirizzamenti");
        await res.body?.cancel();
        url = (await assertPublicUrl(new URL(res.headers.get("location")!, url).toString())).toString();
        continue;
      }
      if (!res.ok) { await res.body?.cancel(); throw new Error(`HTTP ${res.status}`); }
      const reader = res.body?.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > MAX_BYTES) { chunks.push(value.slice(0, value.length - (size - MAX_BYTES))); await reader.cancel(); break; }
          chunks.push(value);
        }
      }
      const buf = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0)); let o = 0;
      for (const c of chunks) { buf.set(c, o); o += c.length; }
      const contentType = res.headers.get("content-type") ?? "";
      const charset = /charset=([\w-]+)/i.exec(contentType)?.[1] ?? "utf-8";
      let body: string;
      try { body = new TextDecoder(charset).decode(buf); } catch { body = new TextDecoder().decode(buf); }
      return { body, contentType, finalUrl: url };
    }
  } finally {
    clearTimeout(timer);
  }
}

/** Intestazioni CORS: solo la dashboard (e lo sviluppo locale) possono chiamare le funzioni dal browser. */
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") ?? "https://laurentimrc.github.io")
  .split(",").map((s) => s.trim()).filter(Boolean);
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const ok = ALLOWED_ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
