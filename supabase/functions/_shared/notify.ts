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

export interface DigestDeadline {
  title: string;
  due_date: string;
  kind: string;
  authority: string | null;
  assignee_name: string | null;
  days: number;
}

const KIND_LABEL: Record<string, string> = { regulatory: "Normativa", reporting: "Segnalazione", consultation: "Consultazione", internal: "Interna", control: "Controllo" };
const whenLabel = (n: number) => n < 0 ? `scaduta da ${-n} g` : n === 0 ? "oggi" : n === 1 ? "domani" : `tra ${n} giorni`;
const itDate = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("it-IT", { day: "numeric", month: "long", timeZone: "Europe/Rome" });

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const REL_LABEL: Record<string, string> = { high: "Alta", medium: "Media", low: "Bassa", none: "Nessuna" };

export function digestHtml(alerts: DigestAlert[], dashboardUrl: string | null, heading: string, deadlines: DigestDeadline[] = []): string {
  const rows = alerts.map((a) => `
    <tr><td style="padding:12px 0;border-bottom:1px solid #e5e7eb">
      <div style="font-size:12px;color:#6b7280">${esc(a.source_authority)} · ${esc((a.tags ?? []).join(", "))}${
        a.ai_relevance ? ` · rilevanza ${REL_LABEL[a.ai_relevance] ?? a.ai_relevance}` : ""}</div>
      <div style="font-size:15px;font-weight:600;margin:4px 0">${
        a.url ? `<a href="${esc(a.url)}" style="color:#111827">${esc(a.title)}</a>` : esc(a.title)}</div>
      ${a.ai_summary ? `<div style="font-size:14px;color:#374151">${esc(a.ai_summary)}</div>` : ""}
    </td></tr>`).join("");
  const dl = deadlines.map((d) => `
    <tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;width:110px;vertical-align:top;font-size:13px;color:${d.days < 0 ? "#b42318" : d.days <= 3 ? "#b54708" : "#374151"};font-weight:600">${esc(itDate(d.due_date))}<br><span style="font-weight:400">${esc(whenLabel(d.days))}</span></td>
    <td style="padding:8px 0 8px 12px;border-bottom:1px solid #e5e7eb;font-size:14px"><b>${esc(d.title)}</b><br><span style="font-size:12px;color:#6b7280">${esc([KIND_LABEL[d.kind] ?? d.kind, d.authority, d.assignee_name ? `responsabile ${d.assignee_name}` : "senza responsabile"].filter(Boolean).join(" · "))}</span></td></tr>`).join("");
  const parts = [
    alerts.length ? `${alerts.length} novità` : "",
    deadlines.length ? `${deadlines.length} scadenze in arrivo` : "",
  ].filter(Boolean).join(" · ");
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;margin:0 auto;padding:16px;color:#111827">
    <h2 style="margin:0 0 4px">${esc(heading)}</h2>
    <p style="color:#6b7280;margin:0 0 12px">${parts}${dashboardUrl ? ` · <a href="${esc(dashboardUrl)}">Apri la dashboard</a>` : ""}</p>
    ${deadlines.length ? `<h3 style="margin:16px 0 4px;font-size:15px">Scadenziario</h3><table style="width:100%;border-collapse:collapse">${dl}</table>` : ""}
    ${alerts.length ? `${deadlines.length ? `<h3 style="margin:20px 0 4px;font-size:15px">Novità</h3>` : ""}<table style="width:100%;border-collapse:collapse">${rows}</table>` : ""}
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

export async function sendTelegram(chatIds: string[], alerts: DigestAlert[], heading: string, deadlines: DigestDeadline[] = []): Promise<string> {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) return "telegram: TELEGRAM_BOT_TOKEN non configurato";
  if (!chatIds.length) return "telegram: nessun chat id";
  const body = [`<b>${esc(heading)}</b>`,
    ...(deadlines.length ? [`\n<b>Scadenze</b>`, ...deadlines.slice(0, 10).map((d) => `• ${esc(itDate(d.due_date))} (${esc(whenLabel(d.days))}) — ${esc(d.title)}`)] : []),
    ...(deadlines.length && alerts.length ? [`\n<b>Novità</b>`] : []),
    ...alerts.slice(0, 15).map((a) =>
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
