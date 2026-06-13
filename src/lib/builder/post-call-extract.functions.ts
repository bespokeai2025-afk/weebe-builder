/**
 * Post-call variable extraction via GPT-4.1-mini.
 *
 * Runs after a HyperStream or EL-Voice test call ends.
 * Takes the full transcript + the builder-defined variable list,
 * calls OpenAI in JSON-object mode, and returns structured results.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { BuilderVariable } from "@/lib/builder/types";

export interface PostCallExtracted {
  summary: string;
  successful: boolean | null;
  sentiment: "positive" | "neutral" | "negative" | null;
  variables: Record<string, string | number | boolean | null>;
}

export const extractPostCallVariables = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      transcript: Array<{ role: "user" | "agent"; text: string }>;
      variables: BuilderVariable[];
      agentName: string;
    }) => data,
  )
  .handler(async ({ data }): Promise<PostCallExtracted> => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

    const { transcript, variables, agentName } = data;

    const txText = transcript
      .map((t) => `${t.role === "user" ? "User" : "Agent"}: ${t.text}`)
      .join("\n");

    const varDefs =
      variables.length > 0
        ? variables
            .map(
              (v) =>
                `  - ${v.name} (${v.type ?? "string"}): ${v.description ?? ""}${
                  v.defaultValue ? ` Example: ${v.defaultValue}` : ""
                }`,
            )
            .join("\n")
        : "  (none defined)";

    const systemMsg = `You are a post-call analysis AI for a "${agentName}" voice agent.
Extract structured information from the call transcript.
Respond with a single JSON object containing:
  - summary: (string) 1-3 sentence call summary
  - successful: (boolean or null) whether the call met its primary objective
  - sentiment: ("positive" | "neutral" | "negative" | null) overall user sentiment
  - variables: (object) one key per custom variable below, value extracted from transcript (null if not found)

Custom variables to extract:
${varDefs}

Rules:
- Use null for any value that cannot be determined from the transcript
- Be concise and accurate
- Output only valid JSON, no markdown fences`;

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        messages: [
          { role: "system", content: systemMsg },
          { role: "user", content: `Call transcript:\n${txText}` },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 800,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => String(res.status));
      throw new Error(`OpenAI extraction error ${res.status}: ${body}`);
    }

    const result = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
    };

    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(result.choices[0].message.content) as Record<string, unknown>;
    } catch { /* malformed — return empty */ }

    const sentimentRaw = String(parsed.sentiment ?? "");
    const sentiment = (
      ["positive", "neutral", "negative"].includes(sentimentRaw) ? sentimentRaw : null
    ) as PostCallExtracted["sentiment"];

    return {
      summary: String(parsed.summary ?? ""),
      successful: typeof parsed.successful === "boolean" ? parsed.successful : null,
      sentiment,
      variables:
        parsed.variables != null && typeof parsed.variables === "object"
          ? (parsed.variables as Record<string, string | number | boolean | null>)
          : {},
    };
  });
