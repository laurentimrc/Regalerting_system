// Funzioni pure di parsing: feed RSS/Atom, link nuovi su pagine-elenco, testo di pagina e diff.
import { DOMParser } from "npm:linkedom@0.18.15";
import { XMLParser } from "npm:fast-xml-parser@5.12.0";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Element = any;

export interface Item {
  fingerprint: string;
  url: string | null;
  title: string;
  excerpt: string | null;
  published_at: string | null;
}

const decodeEntities = (s: string) =>
  s.replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

export const stripHtml = (s: string) =>
  decodeEntities(String(s ?? "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

const text = (v: unknown): string => {
  if (v == null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return text(o["#text"] ?? o["@_href"] ?? "");
  }
  return "";
};

const toIso = (s: string): string | null => {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
};

const arr = <T>(v: T | T[] | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);

export function looksLikeFeed(body: string, contentType = ""): boolean {
  if (/(rss|atom|xml)/i.test(contentType) && !/html/i.test(contentType)) return true;
  const head = body.slice(0, 500).toLowerCase();
  return head.includes("<rss") || head.includes("<feed") || head.includes("<rdf:rdf");
}

/** RSS 2.0, RSS 1.0 (RDF) e Atom. */
export function parseFeed(xml: string, baseUrl: string): Item[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", processEntities: true, htmlEntities: true });
  const doc = parser.parse(xml);
  const items: Item[] = [];

  const rssItems = arr(doc?.rss?.channel?.item).concat(arr(doc?.["rdf:RDF"]?.item));
  for (const it of rssItems) {
    const link = text(it.link) || text(it["@_rdf:about"]);
    const guid = text(it.guid);
    const title = stripHtml(text(it.title)) || "(senza titolo)";
    items.push({
      fingerprint: guid || link || title,
      url: link ? new URL(link, baseUrl).toString() : null,
      title,
      excerpt: stripHtml(text(it.description) || text(it["content:encoded"])).slice(0, 2000) || null,
      published_at: toIso(text(it.pubDate) || text(it["dc:date"])),
    });
  }

  for (const e of arr(doc?.feed?.entry)) {
    const links = arr(e.link);
    const alt = links.find((l: Record<string, string>) => !l["@_rel"] || l["@_rel"] === "alternate") ?? links[0];
    const link = alt ? text(alt) : "";
    const title = stripHtml(text(e.title)) || "(senza titolo)";
    items.push({
      fingerprint: text(e.id) || link || title,
      url: link ? new URL(link, baseUrl).toString() : null,
      title,
      excerpt: stripHtml(text(e.summary) || text(e.content)).slice(0, 2000) || null,
      published_at: toIso(text(e.updated) || text(e.published)),
    });
  }
  return items;
}

function root(html: string, selector?: string | null) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,noscript,svg,iframe,template").forEach((n: Element) => n.remove());
  if (selector) {
    const el = doc.querySelector(selector);
    if (el) return { doc, el };
  }
  // euristica: main/article, altrimenti body senza header/footer/nav
  const main = doc.querySelector("main") ?? doc.querySelector("[role=main]") ?? doc.querySelector("#main-content") ?? doc.querySelector("article");
  if (main) return { doc, el: main };
  doc.querySelectorAll("header,footer,nav,aside").forEach((n: Element) => n.remove());
  return { doc, el: doc.body ?? doc.documentElement };
}

export function discoverFeed(html: string, baseUrl: string): string | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const l = doc.querySelector('link[rel="alternate"][type="application/rss+xml"], link[rel="alternate"][type="application/atom+xml"]');
  const href = l?.getAttribute("href");
  return href ? new URL(href, baseUrl).toString() : null;
}

export interface LinkItem { url: string; title: string }

const GENERIC = /^(leggi|scopri|vai|visualizza|dettaglio|approfondisci|continua|read more|more|details|download|scarica)\b/i;

function titleFromUrl(u: URL): string {
  const parts = u.pathname.split("/").filter((p) => p && !/^index\.(html?|php)$/i.test(p));
  const slug = decodeURIComponent(parts.at(-1) ?? "").replace(/\.(html?|pdf|php)$/i, "");
  const t = slug.replace(/[-_]+/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
}

/** Link "di contenuto" presenti in una pagina-elenco (news, comunicati, consultazioni). */
export function extractLinks(html: string, baseUrl: string, selector?: string | null, pattern?: string | null): LinkItem[] {
  const { el } = root(html, selector);
  const base = new URL(baseUrl);
  const re = pattern ? new RegExp(pattern, "i") : null;
  const seen = new Map<string, string>();
  for (const a of Array.from(el.querySelectorAll("a[href]")) as Element[]) {
    const href = a.getAttribute("href") ?? "";
    if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) continue;
    let u: URL;
    try { u = new URL(href, base); } catch { continue; }
    u.hash = "";
    const url = u.toString();
    if (url === base.toString()) continue;
    if (re ? !re.test(url) : u.hostname !== base.hostname) continue;
    // scarta paginazione e link di servizio
    if (/[?&]page=\d+/.test(url) || /\/(login|search|cerca|privacy|cookie)/i.test(u.pathname)) continue;
    let title = stripHtml(a.textContent ?? "") || a.getAttribute("title") || "";
    // testo generico ("Leggi il comunicato", "Visualizza") → titolo ricavato dall'indirizzo
    if (GENERIC.test(title)) title = titleFromUrl(u);
    if (title.length < 8) continue; // icone, "PDF", ecc.
    if (!seen.has(url) || (seen.get(url)!.length < title.length)) seen.set(url, title.slice(0, 300));
  }
  return [...seen].map(([url, title]) => ({ url, title }));
}

/** Testo normalizzato riga per riga, per il confronto tra versioni di una pagina. */
export function extractText(html: string, selector?: string | null): string {
  const { el } = root(html, selector);
  el.querySelectorAll("br").forEach((b: Element) => b.replaceWith("\n"));
  const blocks = el.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,td,th,dt,dd,pre,blockquote");
  const lines: string[] = [];
  if (blocks.length) {
    for (const b of Array.from(blocks) as Element[]) {
      // evita duplicati da blocchi annidati (li > p)
      if (b.querySelector("p,li,td")) continue;
      const t = stripHtml(b.textContent ?? "");
      if (t) lines.push(t);
    }
  } else {
    lines.push(...String(el.textContent ?? "").split("\n").map(stripHtml).filter(Boolean));
  }
  // rimuove righe "volatili" che cambiano a ogni visita
  return lines
    .filter((l) => !/^(ultimo aggiornamento|last update|page generated|©)/i.test(l))
    .join("\n");
}

/** Diff a livello di riga (multiset): righe aggiunte e rimosse. */
export function lineDiff(oldText: string, newText: string) {
  const count = (s: string) => {
    const m = new Map<string, number>();
    for (const l of s.split("\n")) if (l.trim()) m.set(l, (m.get(l) ?? 0) + 1);
    return m;
  };
  const a = count(oldText), b = count(newText);
  const added: string[] = [], removed: string[] = [];
  for (const [l, n] of b) for (let i = 0; i < n - (a.get(l) ?? 0); i++) added.push(l);
  for (const [l, n] of a) for (let i = 0; i < n - (b.get(l) ?? 0); i++) removed.push(l);
  return { added, removed };
}

export function formatDiff(d: { added: string[]; removed: string[] }, max = 60): string {
  const out = [
    ...d.added.slice(0, max).map((l) => `+ ${l}`),
    ...d.removed.slice(0, max).map((l) => `- ${l}`),
  ];
  const extra = d.added.length + d.removed.length - out.length;
  if (extra > 0) out.push(`… altre ${extra} righe modificate`);
  return out.join("\n");
}

export async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
