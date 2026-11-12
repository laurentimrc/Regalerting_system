// Arricchimento AI degli alert tramite Anthropic Messages API.
// Attivo solo se il secret ANTHROPIC_API_KEY è impostato.

export interface AiResult {
  summary: string;
  relevance: "high" | "medium" | "low" | "none";
  topics: string[];
  impact: string;
  priority: "low" | "medium" | "high" | "critical";
}

const SYSTEM = `Sei un analista di compliance regolamentare UE e italiana (MiCAR, Travel Rule, AML/CFT, DORA, MiFID II, market abuse, tutela dei clienti).
Ricevi una novità pubblicata da un'autorità e il profilo dell'intermediario. Rispondi SOLO con un oggetto JSON valido, senza testo prima o dopo:
{
  "summary": "sintesi in italiano, max 3 frasi, fattuale: cosa è stato pubblicato, da chi, eventuali date/scadenze citate",
  "relevance": "high | medium | low | none  (rilevanza per QUESTO intermediario)",
  "topics": ["MiCAR" | "Travel Rule" | "AML" | "DORA" | "MiFID II" | "Market Abuse" | "Reclami" | "Conflitti di interesse" | "Fiscale" | "Altro"],
  "impact": "1-2 frasi su cosa potrebbe dover fare l'intermediario (valutazione preliminare, da confermare)",
  "priority": "low | medium | high | critical"
}
Regole: non inventare contenuti non presenti nel testo; se il testo è insufficiente dillo nella sintesi e usa relevance "low". "critical" solo per obblighi nuovi con scadenza ravvicinata o misure dirette verso CASP.`;

export async function enrich(
  input: { title: string; authority: string; url: string | null; text: string },
  orgProfile: string,
): Promise<AiResult | null> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return null;
  const model = Deno.env.get("AI_MODEL") ?? "claude-haiku-5-5";

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 600,
      system: SYSTEM,
      messages: [{
        role: "user",
        content:
          `PROFILO INTERMEDIARIO:\n${orgProfile}\n\nAUTORITÀ: ${input.authority}\nTITOLO: ${input.title}\nURL: ${input.url ?? "-"}\n\nTESTO:\n${input.text.slice(0, 8000)}`,
      }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const raw: string = data?.content?.find((c: { type: string }) => c.type === "text")?.text ?? "";
  const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
  const r = JSON.parse(json);
  const rel = ["high", "medium", "low", "none"].includes(r.relevance) ? r.relevance : "low";
  const pri = ["low", "medium", "high", "critical"].includes(r.priority) ? r.priority : "medium";
  return {
    summary: String(r.summary ?? "").slice(0, 1500),
    relevance: rel,
    topics: Array.isArray(r.topics) ? r.topics.map(String).slice(0, 6) : [],
    impact: String(r.impact ?? "").slice(0, 1000),
    priority: pri,
  };
}
