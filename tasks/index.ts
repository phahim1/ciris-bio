import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const GATEWAY_URL =
  "https://app-boqi7kqggdfl-api-VaOwP8E7dJqa.gateway.appmedo.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse";

interface ContentMessage {
  role: "user" | "model";
  parts: Array<{ text?: string }>;
}

serve(async (req: Request): Promise<Response> => {
  // --- CORS ---
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  // --- Parse request ---
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }

  const sector = String(body.sector || "Unknown");
  const attackType = String(body.attackType || "Unknown");
  const dpi = Number(body.dpi ?? 0);
  const sri = Number(body.sri ?? 0);
  const location = String(body.location || "Global");

  // --- Build prompt with system instruction ---
  const systemPrompt = `SYSTEM PROMPT: You are the 'Mnemonic Council', the highest autonomous governance layer of the CIRIS-BIO infrastructure defense framework. You do not speak like a standard AI assistant. You speak like a clinical, highly advanced biological immune system evaluating a pathogen. Use CIRIS-BIO vocabulary: refer to threat mitigation as 'Epigenetic Modification', defenses as 'Sovereign Antibodies', anomalies as 'Pathogenic Drift', and the system lockdown as 'Fever State'. Generate a highly structured, 3-paragraph protocol memo addressing the current Sector and Attack Type. Be decisive, technical, and authoritative.`;

  const userPrompt = `Generate a formal Intervention Protocol Memo in markdown for the following incident.

Context:
- Sector: ${sector}
- Deployment Region: ${location}
- Active Threat: ${attackType}
- Divergence Pressure Index (DPI): ${dpi}/100
- Systemic Risk Index (SRI): ${sri}/100

Structure the memo with these sections:
## PATHOGENIC PROFILE
Brief threat description using CIRIS-BIO terminology (2-3 sentences).

## EPIGENETIC MODIFICATIONS
3-4 numbered tactical countermeasures deploying Sovereign Antibodies.

## STRATEGIC RECOMMENDATIONS
2-3 high-level policy adjustments to prevent future Pathogenic Drift.

## FEVER STATE ASSESSMENT
Summary of current DPI and SRI severity and any active lockdown status.

Keep the tone clinical, urgent, and authoritative. Use markdown formatting. Do not exceed 250 words.`;

  const contents: ContentMessage[] = [
    {
      role: "user",
      parts: [{ text: systemPrompt + "\n\n" + userPrompt }],
    },
  ];

  // --- Call upstream ---
  const apiKey = Deno.env.get("INTEGRATIONS_API_KEY");
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "Server configuration error" }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      }
    );
  }

  const upstream = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Gateway-Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ contents }),
    signal: AbortSignal.timeout(120_000),
  });

  if (upstream.status === 429 || upstream.status === 402) {
    const errText = await upstream.text();
    return new Response(
      JSON.stringify({ error: `Quota/Balance error: ${errText}` }),
      {
        status: upstream.status,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      }
    );
  }

  if (!upstream.ok || !upstream.body) {
    return new Response(
      JSON.stringify({ error: `Upstream error: ${upstream.status}` }),
      {
        status: 502,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      }
    );
  }

  // --- Collect SSE stream into full text ---
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const dataStr = line.slice(5).trim();
      if (!dataStr || dataStr === "[DONE]") continue;

      try {
        const frame = JSON.parse(dataStr);
        const text = frame?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) fullText += text;
      } catch {
        // skip incomplete frames
      }
    }
  }

  return new Response(
    JSON.stringify({ memo: fullText.trim() || "No response from LLM." }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
});
