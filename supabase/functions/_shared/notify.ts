// Canali di notifica: email (Resend) e Telegram. Ognuno attivo solo se il relativo secret è impostato.

export interface DigestAlert {
  id: number;
  title: string;
  url: string | null;
  source_authority: string;
  ai_summary: string | null;
  ai_relevance: string | null;
  priority: string;
  tags: string[];
  detected_at: string;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const REL_LABEL: Record<string, string> = { high: "Alta", medium: "Media", low: "Bassa", none: "Nessuna" };

export function digestHtml(alerts: DigestAlert[], dashboardUrl: string | null, heading: string): string {
  const rows = alerts.map((a) => `
    <tr><td style="padding:12px 0;border-bottom:1px solid #e5e7eb">
      <div style="font-size:12px;color:#6b7280">${esc(a.source_authority)} · ${esc((a.tags ?? []).join(", "))}${
        a.ai_relevance ? ` · rilevanza ${REL_LABEL[a.ai_relevance] ?? a.ai_relevance}` : ""}</div>
      <div style="font-size:15px;font-weight:600;margin:4px 0">${
        a.url ? `<a href="${esc(a.url)}" style="color:#111827">${esc(a.title)}</a>` : esc(a.title)}</div>
      ${a.ai_summary ? `<div style="font-size:14px;color:#374151">${esc(a.ai_summary)}</div>` : ""}
    </td></tr>`).join("");
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;margin:0 auto;padding:16px;color:#111827">
    <h2 style="margin:0 0 4px">${esc(heading)}</h2>
    <p style="color:#6b7280;margin:0 0 12px">${alerts.length} novità${dashboardUrl ? ` · <a href="${esc(dashboardUrl)}">Apri la dashboard</a>` : ""}</p>
    <table style="width:100%;border-collapse:collapse">${rows}</table>
    <p style="font-size:12px;color:#9ca3af;margin-top:16px">Sintesi generate automaticamente: verificare sempre sul testo ufficiale.</p>
  </body></html>`;
}

export async function sendEmail(to: string[], subject: string, html: string): Promise<string> {
  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("DIGEST_FROM") ?? "RegAlert <onboarding@resend.dev>";
  if (!key) return "email: RESEND_API_KEY non configurata";
  if (!to.length) return "email: nessun destinatario";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return `email: inviata a ${to.length} destinatari`;
}

export async function sendTelegram(chatIds: string[], alerts: DigestAlert[], heading: string): Promise<string> {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) return "telegram: TELEGRAM_BOT_TOKEN non configurato";
  if (!chatIds.length) return "telegram: nessun chat id";
  const body = [`<b>${esc(heading)}</b>`, ...alerts.slice(0, 15).map((a) =>
    `\n• <b>${esc(a.source_authority)}</b> — ${a.url ? `<a href="${esc(a.url)}">${esc(a.title)}</a>` : esc(a.title)}${
      a.ai_summary ? `\n${esc(a.ai_summary.slice(0, 280))}` : ""}`)].join("\n");
  for (const chat_id of chatIds) {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id, text: body.slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true }),
    });
    if (!res.ok) throw new Error(`Telegram ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return `telegram: inviato a ${chatIds.length} chat`;
}
