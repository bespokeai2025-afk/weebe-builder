import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface LeadIntelligence {
  summary: string | null;
  interest_level: "high" | "medium" | "low" | null;
  buying_intent: "strong" | "moderate" | "weak" | "none" | null;
  lead_score: number | null;
  objections: string | null;
  next_action: string | null;
  meeting_requested: boolean;
  callback_requested: boolean;
  callback_date: string | null;
  decision_maker_status: "yes" | "no" | "unknown" | null;
  sentiment: "positive" | "neutral" | "negative" | null;
}

const EXTRACTION_PROMPT = `You are a lead intelligence analyst. Analyze the call transcript and extract structured data.

Return ONLY valid JSON with this exact shape (no markdown, no explanation):
{
  "summary": "<1-3 sentence call summary>",
  "interest_level": "<high|medium|low>",
  "buying_intent": "<strong|moderate|weak|none>",
  "lead_score": <integer 0-100>,
  "objections": "<comma-separated objections raised, or null>",
  "next_action": "<recommended next action for the sales team, or null>",
  "meeting_requested": <true|false>,
  "callback_requested": <true|false>,
  "callback_date": "<ISO date if a specific callback date was mentioned, or null>",
  "decision_maker_status": "<yes|no|unknown>",
  "sentiment": "<positive|neutral|negative>"
}

Lead score guidance: 80-100 = very high interest + decision maker; 60-79 = good interest; 40-59 = moderate; 20-39 = low; 0-19 = not interested.`;

export async function analyzeCallTranscript(
  transcript: string,
  retellSentiment?: string | null,
  retellSummary?: string | null,
): Promise<LeadIntelligence> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey || !transcript?.trim()) {
    return buildFallback(retellSentiment, retellSummary);
  }

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 500,
        messages: [
          { role: "system", content: EXTRACTION_PROMPT },
          { role: "user", content: `TRANSCRIPT:\n${transcript.slice(0, 8000)}` },
        ],
      }),
    });

    if (!res.ok) {
      console.error("[LEAD-GEN] OpenAI error", res.status, await res.text().catch(() => ""));
      return buildFallback(retellSentiment, retellSummary);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = json.choices?.[0]?.message?.content?.trim() ?? "";
    const parsed = JSON.parse(raw) as Partial<LeadIntelligence>;

    return {
      summary: str(parsed.summary) ?? retellSummary ?? null,
      interest_level: oneOf(parsed.interest_level, ["high", "medium", "low"]),
      buying_intent: oneOf(parsed.buying_intent, ["strong", "moderate", "weak", "none"]),
      lead_score: clampScore(parsed.lead_score),
      objections: str(parsed.objections),
      next_action: str(parsed.next_action),
      meeting_requested: Boolean(parsed.meeting_requested),
      callback_requested: Boolean(parsed.callback_requested),
      callback_date: str(parsed.callback_date),
      decision_maker_status: oneOf(parsed.decision_maker_status, ["yes", "no", "unknown"]),
      sentiment: oneOf(parsed.sentiment, ["positive", "neutral", "negative"]),
    };
  } catch (err) {
    console.error("[LEAD-GEN] Transcript analysis failed", err);
    return buildFallback(retellSentiment, retellSummary);
  }
}

/** Apply custom post-call variable mappings to a lead patch object */
export function applyCustomPostCallData(
  patch: Record<string, unknown>,
  customData: Record<string, unknown>,
  postCallMappings: Record<string, string>,
  customScoringRules: Array<{ variable: string; points: number }>,
  currentScore: number | null,
): void {
  // Apply field mappings
  for (const [varName, targetField] of Object.entries(postCallMappings)) {
    const value = customData[varName];
    if (value == null) continue;

    if (targetField.startsWith("meta.")) {
      // Store in the lead's meta JSON
      const metaKey = targetField.slice(5);
      const existingMeta = (patch.meta as Record<string, unknown>) ?? {};
      patch.meta = { ...existingMeta, [metaKey]: value };
    } else {
      // Write directly to the named lead column
      patch[targetField] = value;
    }
  }

  // Apply custom scoring rules to lead_score
  if (customScoringRules.length > 0) {
    let bonus = 0;
    for (const rule of customScoringRules) {
      const value = customData[rule.variable];
      if (value && value !== "false" && value !== "0" && value !== "none") {
        bonus += rule.points;
      }
    }
    if (bonus > 0) {
      const base = typeof patch.lead_score === "number"
        ? patch.lead_score
        : currentScore ?? 0;
      patch.lead_score = Math.min(100, base + bonus);
    }
  }
}

export async function updateLeadIntelligence(
  workspaceId: string,
  phone: string,
  intelligence: LeadIntelligence,
  hints?: {
    contactName?: string | null;
    agentName?: string | null;
    customData?: Record<string, unknown>;
    postCallMappings?: Record<string, string>;
    customScoringRules?: Array<{ variable: string; points: number }>;
  },
): Promise<void> {
  const digits = (s: string) => s.replace(/\D/g, "");
  const now = new Date().toISOString();

  const { data: leads } = await supabaseAdmin
    .from("leads")
    .select("id, phone, lead_score")
    .eq("workspace_id", workspaceId)
    .limit(500) as any;

  const matched = (leads ?? []).find(
    (l: any) => digits(l.phone ?? "") === digits(phone),
  );

  const intelligenceUpdate: Record<string, unknown> = {
    updated_at: now,
    last_contacted_at: now,
  };
  if (intelligence.summary != null) intelligenceUpdate.call_summary = intelligence.summary;
  if (intelligence.interest_level != null) intelligenceUpdate.interest_level = intelligence.interest_level;
  if (intelligence.buying_intent != null) intelligenceUpdate.buying_intent = intelligence.buying_intent;
  if (intelligence.lead_score != null) intelligenceUpdate.lead_score = intelligence.lead_score;
  if (intelligence.objections != null) intelligenceUpdate.objections = intelligence.objections;
  if (intelligence.next_action != null) intelligenceUpdate.next_action = intelligence.next_action;
  if (intelligence.meeting_requested) intelligenceUpdate.meeting_requested = true;
  if (intelligence.callback_requested) intelligenceUpdate.callback_requested = true;
  if (intelligence.callback_date != null) intelligenceUpdate.callback_date = intelligence.callback_date;
  if (intelligence.decision_maker_status != null)
    intelligenceUpdate.decision_maker_status = intelligence.decision_maker_status;
  if (intelligence.sentiment != null) intelligenceUpdate.sentiment = intelligence.sentiment as any;
  intelligenceUpdate.status = intelligence.sentiment === "positive" ? "interested" : "completed";

  // Apply custom post-call variable mappings
  if (hints?.customData && hints?.postCallMappings) {
    const currentScore = matched?.lead_score ?? null;
    applyCustomPostCallData(
      intelligenceUpdate,
      hints.customData,
      hints.postCallMappings,
      hints.customScoringRules ?? [],
      currentScore,
    );
    if (Object.keys(hints.customData).length > 0) {
      console.log("[LEAD-GEN] Applied custom post-call data", {
        variables: Object.keys(hints.customData),
        mappings: Object.keys(hints.postCallMappings),
      });
    }
  }

  if (matched) {
    await (supabaseAdmin.from("leads") as any)
      .update(intelligenceUpdate)
      .eq("id", matched.id as string);
    console.log("[LEAD-GEN] Lead intelligence updated", { leadId: matched.id, workspaceId });
    return;
  }

  // No existing lead row — look up data_records for contact name, then auto-create.
  let fullName: string | null = hints?.contactName ?? null;
  if (!fullName) {
    const { data: record } = await (supabaseAdmin.from("data_records") as any)
      .select("first_name, last_name")
      .eq("workspace_id", workspaceId)
      .eq("mobile_number", phone)
      .maybeSingle();
    if (record) {
      fullName =
        [record.first_name, record.last_name].filter(Boolean).join(" ").trim() || null;
    }
  }

  const newLead: Record<string, unknown> = {
    workspace_id: workspaceId,
    phone,
    full_name: fullName,
    source: "outbound",
    created_at: now,
    ...intelligenceUpdate,
  };

  const { data: inserted, error: insertErr } = await (supabaseAdmin.from("leads") as any)
    .insert(newLead)
    .select("id")
    .single();

  if (insertErr) {
    console.error("[LEAD-GEN] Auto-create lead failed", insertErr.message, { phone, workspaceId });
  } else {
    console.log("[LEAD-GEN] Lead auto-created from call", { leadId: inserted?.id, workspaceId, phone });
  }
}

function buildFallback(
  retellSentiment?: string | null,
  retellSummary?: string | null,
): LeadIntelligence {
  const sentiment = mapSentiment(retellSentiment);
  return {
    summary: retellSummary ?? null,
    interest_level: null,
    buying_intent: null,
    lead_score: sentimentToScore(sentiment),
    objections: null,
    next_action: null,
    meeting_requested: false,
    callback_requested: false,
    callback_date: null,
    decision_maker_status: null,
    sentiment,
  };
}

function mapSentiment(v?: string | null): "positive" | "neutral" | "negative" | null {
  if (!v) return null;
  const l = v.toLowerCase();
  if (l.includes("positive")) return "positive";
  if (l.includes("negative")) return "negative";
  if (l.includes("neutral")) return "neutral";
  return null;
}

function sentimentToScore(s: string | null): number | null {
  if (s === "positive") return 65;
  if (s === "neutral") return 35;
  if (s === "negative") return 10;
  return null;
}

function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "null") return v.trim();
  return null;
}

function oneOf<T extends string>(v: unknown, allowed: T[]): T | null {
  if (typeof v === "string" && (allowed as string[]).includes(v)) return v as T;
  return null;
}

function clampScore(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseInt(v, 10) : NaN;
  return Number.isNaN(n) ? null : Math.max(0, Math.min(100, Math.round(n)));
}
