// ── DNA Discovery Engine — server-only ────────────────────────────────────────
// Extracts Business DNA automatically from existing workspace data:
//   - Call transcripts & outcomes
//   - Lead profiles & sources
//   - Campaign performance signals
//   - Executive events history
//
// Updates growthmind_business_dna with discovered values + per-field confidence.
// Designed to run on the daily scheduler and on-demand from the DNA page.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ── Mini OpenAI helper ────────────────────────────────────────────────────────
async function gptMini(
  apiKey: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens = 1200,
): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: "gpt-4o-mini", messages, max_tokens: maxTokens, temperature: 0.3 }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text().catch(() => "")).slice(0, 120)}`);
  const j = (await res.json()) as any;
  return (j.choices?.[0]?.message?.content as string) ?? "";
}

function parseJson(raw: string, fallback: any = {}): any {
  try {
    return JSON.parse(raw.replace(/```json?\n?/g, "").replace(/```\n?/g, "").trim());
  } catch { return fallback; }
}

// ── Main discovery function ───────────────────────────────────────────────────
export async function runDnaDiscovery(
  workspaceId: string,
  apiKey: string,
): Promise<{
  updatedFields: string[];
  confidenceScores: Record<string, { score: number; source: string; last_updated: string }>;
  summary: string;
}> {
  const sb = supabaseAdmin as any;
  const now = new Date().toISOString();

  // ── 1. Pull data sources in parallel ───────────────────────────────────────
  const [callsRes, leadsRes, campaignRes, eventsRes, existingDnaRes] = await Promise.all([
    sb.from("calls")
      .select("transcript, call_status, call_successful, sentiment, metadata")
      .eq("workspace_id", workspaceId)
      .not("transcript", "is", null)
      .order("created_at", { ascending: false })
      .limit(40),

    sb.from("leads")
      .select("full_name, email, company_name, job_title, lead_source, status, tags, notes, custom_fields")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(100),

    sb.from("growthmind_campaign_drafts")
      .select("title, campaign_type, target_audience, channels, performance_data")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(20),

    sb.from("executive_events")
      .select("source, event_type, summary")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(30),

    sb.from("growthmind_business_dna")
      .select("*")
      .eq("workspace_id", workspaceId)
      .single(),
  ]);

  const calls      = callsRes.data ?? [];
  const leads      = leadsRes.data ?? [];
  const campaigns  = campaignRes.data ?? [];
  const events     = eventsRes.data ?? [];
  const existing   = existingDnaRes.data ?? {};

  // ── 2. Build concise context for AI ────────────────────────────────────────
  const callContext = calls
    .slice(0, 20)
    .map((c: any) => {
      const t = typeof c.transcript === "string"
        ? c.transcript.slice(0, 400)
        : JSON.stringify(c.transcript ?? "").slice(0, 400);
      return `[${c.call_successful ? "✓" : "✗"} ${c.sentiment ?? ""}] ${t}`;
    })
    .join("\n---\n");

  const leadContext = leads
    .slice(0, 40)
    .map((l: any) =>
      `${l.job_title ?? ""} @ ${l.company_name ?? ""} | source:${l.lead_source ?? ""} | status:${l.status ?? ""}`,
    )
    .join("\n");

  const campaignContext = campaigns
    .map((c: any) =>
      `${c.campaign_type ?? ""}: "${c.title ?? ""}" → audience: ${c.target_audience ?? ""} channels: ${(c.channels ?? []).join(",")}`,
    )
    .join("\n");

  const prompt = `You are a business intelligence AI. Analyse the following workspace data and extract/infer business DNA fields.

EXISTING DNA (partial):
Company: ${existing.company_name ?? "Unknown"}
Industry: ${existing.industry ?? "Unknown"}
Services: ${(existing.services ?? "").slice(0, 200)}
ICP: ${(existing.ideal_customer_profiles ?? "").slice(0, 200)}

CALL TRANSCRIPTS (last 20):
${callContext.slice(0, 3000)}

LEAD PROFILES (last 40):
${leadContext.slice(0, 1500)}

CAMPAIGN DATA:
${campaignContext.slice(0, 800)}

Based on this data, extract or infer the following fields. For each field, assign:
- value: your best inference (or "" if unclear)
- confidence: 0-100 (how certain you are from the data)
- source: which data drove this (e.g. "Call Transcripts", "Lead Profiles", "Both")

Return ONLY valid JSON:
{
  "industry": { "value": "", "confidence": 0, "source": "" },
  "sub_industry": { "value": "", "confidence": 0, "source": "" },
  "services": { "value": "", "confidence": 0, "source": "" },
  "products": { "value": "", "confidence": 0, "source": "" },
  "ideal_customer_profiles": { "value": "", "confidence": 0, "source": "" },
  "target_job_titles": { "value": "", "confidence": 0, "source": "" },
  "target_company_sizes": { "value": "", "confidence": 0, "source": "" },
  "target_industries": { "value": "", "confidence": 0, "source": "" },
  "target_markets": { "value": "", "confidence": 0, "source": "" },
  "lead_sources": { "value": "", "confidence": 0, "source": "" },
  "unique_selling_points": { "value": "", "confidence": 0, "source": "" },
  "competitors_summary": { "value": "", "confidence": 0, "source": "" },
  "sales_process": { "value": "", "confidence": 0, "source": "" },
  "qualification_criteria": { "value": "", "confidence": 0, "source": "" },
  "brand_voice": { "value": "", "confidence": 0, "source": "" },
  "tone_of_voice": { "value": "", "confidence": 0, "source": "" },
  "current_ad_platforms": { "value": "", "confidence": 0, "source": "" },
  "summary": "2-3 sentence summary of what you learned about this business"
}

Only include fields with confidence ≥ 20. Empty string for unknown.`;

  const raw = await gptMini(
    apiKey,
    [
      { role: "system", content: "Business intelligence analyst. Return ONLY valid JSON." },
      { role: "user", content: prompt },
    ],
    2000,
  );

  const parsed = parseJson(raw, {});

  // ── 3. Build updates + confidence map ─────────────────────────────────────
  const existingConfidence: Record<string, any> = existing.confidence_scores ?? {};
  const updatedConfidence: Record<string, any>  = { ...existingConfidence };
  const fieldUpdates: Record<string, any>        = {};
  const updatedFields: string[]                  = [];

  const FIELD_KEYS = [
    "industry", "sub_industry", "services", "products", "ideal_customer_profiles",
    "target_job_titles", "target_company_sizes", "target_industries", "target_markets",
    "lead_sources", "unique_selling_points", "competitors_summary", "sales_process",
    "qualification_criteria", "brand_voice", "tone_of_voice", "current_ad_platforms",
  ];

  for (const key of FIELD_KEYS) {
    const extracted = parsed[key];
    if (!extracted || !extracted.value || extracted.confidence < 20) continue;

    const existingVal  = existing[key] ?? "";
    const existingConf = existingConfidence[key]?.score ?? 0;

    // Only update if new confidence is higher OR field is empty
    if (!existingVal || extracted.confidence > existingConf) {
      fieldUpdates[key] = extracted.value;
      updatedConfidence[key] = {
        score:        extracted.confidence,
        source:       extracted.source ?? "Auto-discovery",
        last_updated: now,
      };
      updatedFields.push(key);
    }
  }

  // ── 4. Persist to DB ────────────────────────────────────────────────────────
  if (updatedFields.length > 0 || true) {
    const upsertPayload = {
      ...fieldUpdates,
      confidence_scores:    updatedConfidence,
      last_discovery_at:    now,
      updated_at:           now,
      discovery_run_count:  (existing.discovery_run_count ?? 0) + 1,
      discovery_sources: {
        calls_analysed:     calls.length,
        leads_analysed:     leads.length,
        campaigns_analysed: campaigns.length,
        last_run:           now,
      },
    };

    await sb
      .from("growthmind_business_dna")
      .update(upsertPayload)
      .eq("workspace_id", workspaceId);
  }

  return {
    updatedFields,
    confidenceScores: updatedConfidence,
    summary: parsed.summary ?? `Analysed ${calls.length} calls, ${leads.length} leads, ${campaigns.length} campaigns.`,
  };
}
