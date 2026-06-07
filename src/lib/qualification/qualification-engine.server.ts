import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { applyCustomPostCallData } from "@/lib/lead-gen/lead-intelligence.server";

export interface QualificationResult {
  qualification_status: "qualified" | "partially_qualified" | "not_qualified" | "callback_required";
  qualification_score: number;
  budget_confirmed: boolean;
  decision_maker: boolean;
  urgency: "high" | "medium" | "low" | "none";
  interest_level: "high" | "medium" | "low" | "none";
  next_step: string | null;
  summary: string | null;
  sentiment: "positive" | "neutral" | "negative" | null;
}

export interface QualifySettings {
  postCallMappings?: Record<string, string>;
  customScoringRules?: Array<{ variable: string; points: number }>;
  [key: string]: unknown;
}

const QUALIFICATION_PROMPT = `You are a sales qualification analyst. Analyze the call transcript and determine whether the prospect qualifies as a sales lead.

Return ONLY valid JSON with this exact shape (no markdown, no explanation):
{
  "qualification_status": "<qualified|partially_qualified|not_qualified|callback_required>",
  "qualification_score": <integer 0-100>,
  "budget_confirmed": <true|false>,
  "decision_maker": <true|false>,
  "urgency": "<high|medium|low|none>",
  "interest_level": "<high|medium|low|none>",
  "next_step": "<sales_followup|callback|send_info|demo_scheduled|do_not_contact|nurture|null>",
  "summary": "<1-3 sentence qualification summary>",
  "sentiment": "<positive|neutral|negative>"
}

Qualification scoring rules:
- Decision maker confirmed: +25 points
- Budget confirmed or mentioned: +25 points
- High urgency or clear need: +20 points
- High interest level: +20 points
- Requested follow-up or next step: +10 points

Score interpretation:
- 70-100: qualified
- 40-69: partially_qualified
- 0-39: not_qualified

If prospect asked to be called back or needs more time: callback_required (regardless of score).`;

export async function analyzeQualification(
  transcript: string,
  retellSentiment?: string | null,
  retellSummary?: string | null,
): Promise<QualificationResult> {
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
        max_tokens: 400,
        messages: [
          { role: "system", content: QUALIFICATION_PROMPT },
          { role: "user", content: `TRANSCRIPT:\n${transcript.slice(0, 8000)}` },
        ],
      }),
    });

    if (!res.ok) {
      console.error("[QUALIFY] OpenAI error", res.status, await res.text().catch(() => ""));
      return buildFallback(retellSentiment, retellSummary);
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = json.choices?.[0]?.message?.content?.trim() ?? "";
    const parsed = JSON.parse(raw) as Partial<QualificationResult>;

    const score = clampScore(parsed.qualification_score);
    const status = deriveStatus(parsed.qualification_status, score);

    return {
      qualification_status: status,
      qualification_score: score,
      budget_confirmed: Boolean(parsed.budget_confirmed),
      decision_maker: Boolean(parsed.decision_maker),
      urgency: oneOf(parsed.urgency, ["high", "medium", "low", "none"]) ?? "none",
      interest_level: oneOf(parsed.interest_level, ["high", "medium", "low", "none"]) ?? "none",
      next_step: str(parsed.next_step),
      summary: str(parsed.summary) ?? retellSummary ?? null,
      sentiment: oneOf(parsed.sentiment, ["positive", "neutral", "negative"]),
    };
  } catch (err) {
    console.error("[QUALIFY] Analysis failed", err);
    return buildFallback(retellSentiment, retellSummary);
  }
}

export async function applyQualificationToLead(
  workspaceId: string,
  phone: string,
  result: QualificationResult,
  hints?: {
    contactName?: string | null;
    agentName?: string | null;
    customData?: Record<string, unknown>;
    qualifySettings?: QualifySettings;
  },
): Promise<void> {
  const digits = (s: string) => s.replace(/\D/g, "");
  const now = new Date().toISOString();

  const { data: leads } = await supabaseAdmin
    .from("leads")
    .select("id, phone, qualification_score")
    .eq("workspace_id", workspaceId)
    .limit(500) as any;

  const matched = (leads ?? []).find(
    (l: any) => digits(l.phone ?? "") === digits(phone),
  );

  // Start with base qualification data
  let finalScore = result.qualification_score;

  // Apply custom scoring rules from post-call variables
  const customData = hints?.customData ?? {};
  const qualifySettings = hints?.qualifySettings ?? {};
  const customScoringRules = qualifySettings.customScoringRules ?? [];
  const postCallMappings = qualifySettings.postCallMappings ?? {};

  if (customScoringRules.length > 0) {
    let bonus = 0;
    for (const rule of customScoringRules) {
      const value = customData[rule.variable];
      if (value && value !== "false" && value !== "0" && value !== "none") {
        bonus += rule.points;
        console.log("[QUALIFY] Custom scoring rule hit", { variable: rule.variable, points: rule.points, value });
      }
    }
    finalScore = Math.min(100, finalScore + bonus);
    if (bonus > 0) {
      console.log("[QUALIFY] Custom scoring bonus applied", { bonus, finalScore });
    }
  }

  const finalStatus = deriveStatus(result.qualification_status, finalScore);

  const patch: Record<string, unknown> = {
    updated_at: now,
    last_contacted_at: now,
    qualification_status: finalStatus,
    qualification_score: finalScore,
    budget_confirmed: result.budget_confirmed,
    decision_maker: result.decision_maker,
    urgency: result.urgency,
    interest_level: result.interest_level,
    next_step: result.next_step,
    call_summary: result.summary,
    sentiment: result.sentiment,
    status: deriveLeadStatus(result),
  };

  // Apply custom post-call field mappings
  if (Object.keys(postCallMappings).length > 0 && Object.keys(customData).length > 0) {
    const currentScore = matched?.qualification_score ?? null;
    applyCustomPostCallData(patch, customData, postCallMappings, [], currentScore);
    console.log("[QUALIFY] Applied custom post-call field mappings", {
      variables: Object.keys(customData),
      mappings: Object.keys(postCallMappings),
    });
  }

  if (matched) {
    await (supabaseAdmin.from("leads") as any).update(patch).eq("id", matched.id as string);
    console.log("[QUALIFY] Lead updated", { leadId: matched.id, status: finalStatus, score: finalScore });
    return;
  }

  // Auto-create lead if none exists
  let fullName: string | null = hints?.contactName ?? null;
  if (!fullName) {
    const { data: record } = await (supabaseAdmin.from("data_records") as any)
      .select("first_name, last_name")
      .eq("workspace_id", workspaceId)
      .eq("mobile_number", phone)
      .maybeSingle();
    if (record) {
      fullName = [record.first_name, record.last_name].filter(Boolean).join(" ").trim() || null;
    }
  }

  const newLead: Record<string, unknown> = {
    workspace_id: workspaceId,
    phone,
    full_name: fullName,
    source: "outbound",
    created_at: now,
    ...patch,
  };

  const { data: inserted, error: insertErr } = await (supabaseAdmin.from("leads") as any)
    .insert(newLead)
    .select("id")
    .single();

  if (insertErr) {
    console.error("[QUALIFY] Auto-create lead failed", insertErr.message, { phone, workspaceId });
  } else {
    console.log("[QUALIFY] Lead auto-created", { leadId: inserted?.id, status: finalStatus, score: finalScore });
  }
}

function deriveStatus(
  raw: unknown,
  score: number,
): QualificationResult["qualification_status"] {
  const allowed = ["qualified", "partially_qualified", "not_qualified", "callback_required"] as const;
  if (typeof raw === "string" && (allowed as readonly string[]).includes(raw))
    return raw as QualificationResult["qualification_status"];
  if (score >= 70) return "qualified";
  if (score >= 40) return "partially_qualified";
  return "not_qualified";
}

function deriveLeadStatus(result: QualificationResult): string {
  // Auto-route based on post-call sentiment — only called after a real call completes.
  // Positive → qualified (shown in Qualified section automatically).
  // Neutral   → interested (stays in Leads; qualification_status captures "partially_qualified").
  // Negative  → not_interested.
  // callback_required → need_to_call regardless of sentiment.
  if (result.qualification_status === "callback_required") return "callback_requested";
  if (result.sentiment === "positive") return "qualified";
  if (result.sentiment === "negative" || result.qualification_status === "not_qualified")
    return "not_interested";
  return "interested"; // neutral / partially_qualified stays visible in Leads
}

function buildFallback(
  retellSentiment?: string | null,
  retellSummary?: string | null,
): QualificationResult {
  const sentiment = mapSentiment(retellSentiment);
  const score = sentiment === "positive" ? 50 : sentiment === "neutral" ? 30 : 10;
  return {
    qualification_status: score >= 70 ? "qualified" : score >= 40 ? "partially_qualified" : "not_qualified",
    qualification_score: score,
    budget_confirmed: false,
    decision_maker: false,
    urgency: "none",
    interest_level: sentiment === "positive" ? "medium" : "none",
    next_step: null,
    summary: retellSummary ?? null,
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

function str(v: unknown): string | null {
  if (typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "null") return v.trim();
  return null;
}

function oneOf<T extends string>(v: unknown, allowed: T[]): T | null {
  if (typeof v === "string" && (allowed as string[]).includes(v)) return v as T;
  return null;
}

function clampScore(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseInt(v, 10) : NaN;
  return Number.isNaN(n) ? 0 : Math.max(0, Math.min(100, Math.round(n)));
}
