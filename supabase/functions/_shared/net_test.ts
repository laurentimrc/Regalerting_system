import { deepStrictEqual as assertEquals, rejects } from "node:assert";
const assertRejects = (fn: () => Promise<unknown>, _e?: unknown, _m?: unknown, msg?: string) => rejects(fn, Error, msg);
import { assertPublicUrl, isPrivateIp } from "./net.ts";

Deno.test("IP privati e riservati", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"])
    assertEquals(isPrivateIp(ip), true, ip);
  for (const ip of ["8.8.8.8", "151.101.1.1", "2a00:1450:4002::64"]) assertEquals(isPrivateIp(ip), false, ip);
});

Deno.test("indirizzi rifiutati senza rete", async () => {
  for (const u of ["javascript:alert(1)", "file:///etc/passwd", "http://localhost/", "http://127.0.0.1/", "http://169.254.169.254/latest/meta-data",
    "https://abc.supabase.co/rest/v1/", "https://user:pw@example.com/", "https://example.com:8443/", "http://[::1]/", "http://kong.internal/"])
    await assertRejects(() => assertPublicUrl(u), Error, undefined, u);
});

Deno.test("indirizzi pubblici ammessi", async () => {
  const u = await assertPublicUrl("https://www.esma.europa.eu/press-news/esma-news");
  assertEquals(u.hostname, "www.esma.europa.eu");
});
