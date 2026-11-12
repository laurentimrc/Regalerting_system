import { deepStrictEqual as assertEquals, ok as assert } from "node:assert";
import { discoverFeed, extractLinks, extractText, formatDiff, lineDiff, looksLikeFeed, parseFeed } from "./parse.ts";

const RSS = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>EBA</title>
<item><title>EBA publishes RTS under MiCA &amp; AMLR</title><link>https://www.eba.europa.eu/a</link>
<guid isPermaLink="false">g-1</guid><description><![CDATA[<p>The EBA <b>today</b> published…</p>]]></description>
<pubDate>Tue, 10 Nov 2026 10:00:00 GMT</pubDate></item>
<item><title>Second</title><link>/b</link><pubDate>bad date</pubDate></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>X</title>
<entry><id>urn:1</id><title>Atom entry</title><link rel="alternate" href="https://x.eu/e1"/><updated>2026-11-09T08:00:00Z</updated><summary>Sum</summary></entry>
</feed>`;

const LISTING = `<html><head><link rel="alternate" type="application/rss+xml" href="/rss.xml"><title>News</title></head><body>
<header><a href="/press-news/esma-news/header-link-should-be-ignored">Header link should be ignored</a></header>
<main>
  <ul>
    <li><a href="/press-news/esma-news/esma-publishes-mica-guidelines">ESMA publishes MiCA guidelines on reverse solicitation</a></li>
    <li><a href="/press-news/esma-news/esma-statement-crypto">ESMA statement on crypto-asset transition</a> <a href="/press-news/esma-news/esma-statement-crypto">PDF</a></li>
    <li><a href="/press-news/esma-news?page=2">Next page of results</a></li>
    <li><a href="https://twitter.com/esma">Follow ESMA on social media</a></li>
    <li><a href="#top">Back to the top of the page</a></li>
  </ul>
</main></body></html>`;

Deno.test("RSS 2.0", () => {
  assert(looksLikeFeed(RSS));
  const items = parseFeed(RSS, "https://www.eba.europa.eu/rss.xml");
  assertEquals(items.length, 2);
  assertEquals(items[0].title, "EBA publishes RTS under MiCA & AMLR");
  assertEquals(items[0].fingerprint, "g-1");
  assertEquals(items[0].excerpt, "The EBA today published…");
  assertEquals(items[0].published_at, "2026-11-10T10:00:00.000Z");
  assertEquals(items[1].url, "https://www.eba.europa.eu/b");
  assertEquals(items[1].published_at, null);
});

Deno.test("Atom", () => {
  const items = parseFeed(ATOM, "https://x.eu/");
  assertEquals(items.length, 1);
  assertEquals(items[0].url, "https://x.eu/e1");
  assertEquals(items[0].fingerprint, "urn:1");
});

Deno.test("extractLinks con pattern, dedup, esclusioni", () => {
  const links = extractLinks(LISTING, "https://www.esma.europa.eu/press-news/esma-news", null, "/press-news/esma-news/.+");
  assertEquals(links.map((l) => l.url), [
    "https://www.esma.europa.eu/press-news/esma-news/esma-publishes-mica-guidelines",
    "https://www.esma.europa.eu/press-news/esma-news/esma-statement-crypto",
  ]);
  assertEquals(links[1].title, "ESMA statement on crypto-asset transition");
});

Deno.test("discoverFeed", () => {
  assertEquals(discoverFeed(LISTING, "https://www.esma.europa.eu/x"), "https://www.esma.europa.eu/rss.xml");
});

Deno.test("extractText + lineDiff", () => {
  const v1 = `<html><body><nav>menu</nav><main><h1>MiCA</h1><p>Interim register updated.</p><ul><li><p>Q&amp;A 1</p></li></ul><p>Last update: 1/1</p></main></body></html>`;
  const v2 = v1.replace("Interim register updated.", "Interim register updated on 10 November.").replace("<p>Last update: 1/1</p>", "<p>Last update: 2/2</p>");
  const t1 = extractText(v1), t2 = extractText(v2);
  assertEquals(t1, "MiCA\nInterim register updated.\nQ&A 1");
  const d = lineDiff(t1, t2);
  assertEquals(d.added, ["Interim register updated on 10 November."]);
  assertEquals(d.removed, ["Interim register updated."]);
  assertEquals(formatDiff(d), "+ Interim register updated on 10 November.\n- Interim register updated.");
});

Deno.test("titolo dal link generico", () => {
  const html = `<main><a href="/web/area-pubblica/w/comunicato-stampa-del-6-novembre">Leggi il comunicato</a></main>`;
  const l = extractLinks(html, "https://www.consob.it/web/consob/comunicati-stampa", null, "comunicato-stampa-del");
  assertEquals(l, [{ url: "https://www.consob.it/web/area-pubblica/w/comunicato-stampa-del-6-novembre", title: "Comunicato stampa del 6 novembre" }]);
});
