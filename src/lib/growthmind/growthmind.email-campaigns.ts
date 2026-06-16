import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { formatDnaAsContext } from "./growthmind.business-dna";

// ── Types ──────────────────────────────────────────────────────────────────────

export type AudienceSegment =
  | { type: "all" }
  | { type: "tag"; tag: string }
  | { type: "status"; status: string }
  | { type: "manual"; emails: string[] };

export type EmailCampaign = {
  id:             string;
  name:           string;
  subject:        string;
  previewText:    string;
  bodyHtml:       string;
  bodyText:       string;
  ctaLabel:       string | null;
  ctaUrl:         string | null;
  fromName:       string | null;
  fromEmail:      string | null;
  audience:       AudienceSegment;
  recipientCount: number | null;
  status:         "draft" | "scheduled" | "sending" | "sent" | "failed";
  scheduledAt:    string | null;
  sentAt:         string | null;
  sendResult:     Record<string, unknown> | null;
  generatedByAi:  boolean;
  aiModel:        string | null;
  createdAt:      string;
  updatedAt:      string;
};

export type WarmupDayEntry = {
  day:        number;
  volume:     number;
  phase:      number;
  note:       string;
};

export type DomainWarmup = {
  id:             string;
  domain:         string;
  fromEmail:      string;
  startedAt:      string;
  phase:          number;
  currentDay:     number;
  totalDays:      number;
  dailyPlan:      WarmupDayEntry[];
  completedDays:  number[];
  reputationScore: number | null;
  bounceRate:     number | null;
  spamRate:       number | null;
  status:         "active" | "paused" | "completed" | "abandoned";
  notes:          string | null;
  createdAt:      string;
  updatedAt:      string;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function mapCampaignRow(r: any): EmailCampaign {
  return {
    id:             r.id,
    name:           r.name,
    subject:        r.subject ?? "",
    previewText:    r.preview_text ?? "",
    bodyHtml:       r.body_html ?? "",
    bodyText:       r.body_text ?? "",
    ctaLabel:       r.cta_label ?? null,
    ctaUrl:         r.cta_url ?? null,
    fromName:       r.from_name ?? null,
    fromEmail:      r.from_email ?? null,
    audience:       r.audience ?? { type: "all" },
    recipientCount: r.recipient_count ?? null,
    status:         r.status ?? "draft",
    scheduledAt:    r.scheduled_at ?? null,
    sentAt:         r.sent_at ?? null,
    sendResult:     r.send_result ?? null,
    generatedByAi:  r.generated_by_ai ?? false,
    aiModel:        r.ai_model ?? null,
    createdAt:      r.created_at,
    updatedAt:      r.updated_at,
  };
}

function mapWarmupRow(r: any): DomainWarmup {
  return {
    id:              r.id,
    domain:          r.domain,
    fromEmail:       r.from_email,
    startedAt:       r.started_at,
    phase:           r.phase ?? 1,
    currentDay:      r.current_day ?? 1,
    totalDays:       r.total_days ?? 30,
    dailyPlan:       r.daily_plan ?? [],
    completedDays:   r.completed_days ?? [],
    reputationScore: r.reputation_score ?? null,
    bounceRate:      r.bounce_rate != null ? Number(r.bounce_rate) : null,
    spamRate:        r.spam_rate != null ? Number(r.spam_rate) : null,
    status:          r.status ?? "active",
    notes:           r.notes ?? null,
    createdAt:       r.created_at,
    updatedAt:       r.updated_at,
  };
}

function buildWarmupSchedule(totalDays: number): WarmupDayEntry[] {
  const plan: WarmupDayEntry[] = [];
  for (let d = 1; d <= totalDays; d++) {
    let volume: number;
    let phase: number;
    let note: string;
    if (d <= 7) {
      phase = 1;
      volume = Math.round(10 + (d - 1) * 10);
      note = "Phase 1 — micro-sends to highest-engagement contacts only";
    } else if (d <= 14) {
      phase = 2;
      const offset = d - 7;
      volume = Math.round(80 + offset * 40);
      note = "Phase 2 — expand to engaged subscribers";
    } else if (d <= 21) {
      phase = 3;
      const offset = d - 14;
      volume = Math.round(360 + offset * 120);
      note = "Phase 3 — growing volume, monitor bounce/spam closely";
    } else {
      phase = 4;
      const offset = d - 21;
      volume = Math.round(1200 + offset * 400);
      note = "Phase 4 — full ramp to production volume";
    }
    plan.push({ day: d, volume, phase, note });
  }
  return plan;
}

// ── Server functions ──────────────────────────────────────────────────────────

export const listEmailCampaigns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data, error } = await sb
      .from("growthmind_email_campaigns")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error && error.code !== "42P01") throw new Error(error.message);
    return { campaigns: (data ?? []).map(mapCampaignRow) };
  });

export const getEmailCampaign = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data: row, error } = await sb
      .from("growthmind_email_campaigns")
      .select("*")
      .eq("id", data.id)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!row) throw new Error("Campaign not found");
    return { campaign: mapCampaignRow(row) };
  });

export const saveEmailCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id:          z.string().uuid().optional(),
      name:        z.string().min(1).max(300),
      subject:     z.string().max(500).default(""),
      previewText: z.string().max(200).default(""),
      bodyHtml:    z.string().default(""),
      bodyText:    z.string().default(""),
      ctaLabel:    z.string().max(100).nullable().default(null),
      ctaUrl:      z.string().max(500).nullable().default(null),
      fromName:    z.string().max(100).nullable().default(null),
      fromEmail:   z.string().email().nullable().default(null),
      audience:    z.any().default({ type: "all" }),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const now = new Date().toISOString();
    const payload: any = {
      workspace_id: workspaceId,
      name:         data.name,
      subject:      data.subject,
      preview_text: data.previewText,
      body_html:    data.bodyHtml,
      body_text:    data.bodyText,
      cta_label:    data.ctaLabel,
      cta_url:      data.ctaUrl,
      from_name:    data.fromName,
      from_email:   data.fromEmail,
      audience:     data.audience,
      updated_at:   now,
    };

    if (data.id) {
      const { error } = await sb
        .from("growthmind_email_campaigns")
        .update(payload)
        .eq("id", data.id)
        .eq("workspace_id", workspaceId);
      if (error) throw new Error(error.message);
      return { id: data.id };
    } else {
      const { data: row, error } = await sb
        .from("growthmind_email_campaigns")
        .insert({ ...payload, created_at: now })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return { id: row.id };
    }
  });

export const deleteEmailCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid() }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { error } = await sb
      .from("growthmind_email_campaigns")
      .delete()
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);

    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const generateEmailDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      goal:         z.string().default(""),
      audience:     z.string().default(""),
      offer:        z.string().default(""),
      tone:         z.enum(["professional", "friendly", "urgent", "storytelling"]).default("professional"),
    }).parse(input)
  )
  .handler(async ({ context, data: input }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY not set");

    const dnaRes = await sb
      .from("growthmind_business_dna")
      .select("*")
      .eq("workspace_id", workspaceId)
      .maybeSingle()
      .catch(() => ({ data: null }));

    const dnaCtx = dnaRes?.data ? formatDnaAsContext(dnaRes.data) : "No business DNA configured.";
    const toneDesc =
      input.tone === "friendly"     ? "warm, conversational, and personable" :
      input.tone === "urgent"       ? "urgent, compelling, and action-driven" :
      input.tone === "storytelling" ? "narrative-driven, engaging, with a story arc" :
      "professional, clear, and benefit-focused";

    const prompt = `You are GrowthMind, an expert AI CMO. Write a complete email campaign.

## Business Context
${dnaCtx}

## Campaign Brief
- Goal: ${input.goal || "Not specified"}
- Target Audience: ${input.audience || "Existing contacts"}
- Offer / Message: ${input.offer || "Not specified"}
- Tone: ${toneDesc}

## Instructions
Generate a ready-to-send email campaign. Respond ONLY with valid JSON (no markdown):
{
  "subject": "compelling subject line (under 60 chars)",
  "previewText": "preview text shown in inbox (under 90 chars)",
  "bodyHtml": "full HTML email body with styled sections, no <html>/<body> tags — just the inner content",
  "bodyText": "plain text version",
  "ctaLabel": "Call to action button text",
  "ctaUrl": "",
  "fromName": "suggested sender name"
}

Write real, specific copy. Make the subject line punchy. The HTML should use inline styles for email clients. Tailor every word to the business context above.`;

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method:  "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model:       "gpt-4o-mini",
        messages:    [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens:  2000,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI error: ${err.slice(0, 200)}`);
    }

    const json = await res.json() as any;
    const raw  = json.choices?.[0]?.message?.content ?? "{}";

    let parsed: any = {};
    try {
      const clean = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
      parsed = JSON.parse(clean);
    } catch {
      throw new Error("Failed to parse AI response");
    }

    return {
      subject:     parsed.subject     ?? "",
      previewText: parsed.previewText ?? "",
      bodyHtml:    parsed.bodyHtml    ?? "",
      bodyText:    parsed.bodyText    ?? "",
      ctaLabel:    parsed.ctaLabel    ?? "Learn More",
      ctaUrl:      parsed.ctaUrl      ?? "",
      fromName:    parsed.fromName    ?? "",
    };
  });

export const sendEmailCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id:       z.string().uuid(),
      testOnly: z.boolean().default(false),
      testTo:   z.string().email().optional(),
    }).parse(input)
  )
  .handler(async ({ context, data: input }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const resendKey  = process.env.RESEND_API_KEY;
    const resendFrom = process.env.RESEND_FROM ?? "noreply@example.com";
    if (!resendKey) throw new Error("RESEND_API_KEY not configured");

    const { data: row, error: fetchErr } = await sb
      .from("growthmind_email_campaigns")
      .select("*")
      .eq("id", input.id)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (fetchErr) throw new Error(fetchErr.message);
    if (!row) throw new Error("Campaign not found");

    const campaign = mapCampaignRow(row);

    if (input.testOnly && input.testTo) {
      const res = await fetch("https://api.resend.com/emails", {
        method:  "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
        body: JSON.stringify({
          from:    campaign.fromEmail ? `${campaign.fromName ?? "GrowthMind"} <${campaign.fromEmail}>` : resendFrom,
          to:      [input.testTo],
          subject: `[TEST] ${campaign.subject}`,
          html:    campaign.bodyHtml,
          text:    campaign.bodyText || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Resend error: ${err.slice(0, 200)}`);
      }
      const data = await res.json() as any;
      return { ok: true, messageId: data.id, sent: 1, failed: 0, test: true };
    }

    let recipients: string[] = [];
    const seg = campaign.audience;

    if (seg.type === "manual" && seg.emails) {
      recipients = seg.emails;
    } else {
      let query = sb
        .from("leads")
        .select("email")
        .eq("workspace_id", workspaceId)
        .not("email", "is", null)
        .limit(5000);

      if (seg.type === "status" && seg.status) {
        query = query.eq("status", seg.status);
      } else if (seg.type === "tag" && seg.tag) {
        query = query.contains("tags", [seg.tag]);
      }

      const { data: leads } = await query;
      recipients = (leads ?? []).map((l: any) => l.email).filter(Boolean);
    }

    if (recipients.length === 0) {
      throw new Error("No recipients found for this audience segment");
    }

    await sb.from("growthmind_email_campaigns")
      .update({ status: "sending", updated_at: new Date().toISOString() })
      .eq("id", input.id)
      .eq("workspace_id", workspaceId);

    let sent = 0;
    let failed = 0;
    const BATCH = 50;

    for (let i = 0; i < recipients.length; i += BATCH) {
      const batch = recipients.slice(i, i + BATCH);
      try {
        const res = await fetch("https://api.resend.com/emails/batch", {
          method:  "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendKey}` },
          body: JSON.stringify(batch.map(to => ({
            from:    campaign.fromEmail ? `${campaign.fromName ?? "GrowthMind"} <${campaign.fromEmail}>` : resendFrom,
            to:      [to],
            subject: campaign.subject,
            html:    campaign.bodyHtml,
            text:    campaign.bodyText || undefined,
          }))),
        });
        if (res.ok) {
          sent += batch.length;
        } else {
          failed += batch.length;
        }
      } catch {
        failed += batch.length;
      }
    }

    const now = new Date().toISOString();
    await sb.from("growthmind_email_campaigns").update({
      status:          sent > 0 ? "sent" : "failed",
      sent_at:         now,
      recipient_count: recipients.length,
      send_result:     { sent, failed, totalRecipients: recipients.length },
      updated_at:      now,
    })
    .eq("id", input.id)
    .eq("workspace_id", workspaceId);

    return { ok: true, sent, failed, totalRecipients: recipients.length, test: false };
  });

export const getCrmSegments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const [leadsRes, statusRes] = await Promise.all([
      sb.from("leads")
        .select("email, status, tags")
        .eq("workspace_id", workspaceId)
        .not("email", "is", null)
        .limit(5000)
        .catch(() => ({ data: [] })),
      sb.from("leads")
        .select("status")
        .eq("workspace_id", workspaceId)
        .limit(5000)
        .catch(() => ({ data: [] })),
    ]);

    const allLeads = leadsRes.data ?? [];
    const withEmail = allLeads.filter((l: any) => l.email);

    const statusMap: Record<string, number> = {};
    const tagMap: Record<string, number> = {};

    for (const l of withEmail) {
      const s = l.status ?? "unknown";
      statusMap[s] = (statusMap[s] ?? 0) + 1;
      for (const t of (l.tags ?? [])) {
        tagMap[t] = (tagMap[t] ?? 0) + 1;
      }
    }

    const statuses = Object.entries(statusMap)
      .sort((a, b) => b[1] - a[1])
      .map(([status, count]) => ({ status, count }));

    const tags = Object.entries(tagMap)
      .sort((a, b) => b[1] - a[1])
      .map(([tag, count]) => ({ tag, count }));

    return {
      totalWithEmail: withEmail.length,
      statuses,
      tags,
    };
  });

export const listDomainWarmups = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data, error } = await sb
      .from("growthmind_domain_warmups")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error && error.code !== "42P01") throw new Error(error.message);
    return { warmups: (data ?? []).map(mapWarmupRow) };
  });

export const createDomainWarmup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      domain:    z.string().min(3).max(253),
      fromEmail: z.string().email(),
      totalDays: z.number().int().min(14).max(60).default(30),
    }).parse(input)
  )
  .handler(async ({ context, data: input }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const dailyPlan = buildWarmupSchedule(input.totalDays);
    const now = new Date().toISOString();

    const { data: row, error } = await sb
      .from("growthmind_domain_warmups")
      .insert({
        workspace_id:  workspaceId,
        domain:        input.domain,
        from_email:    input.fromEmail,
        total_days:    input.totalDays,
        daily_plan:    dailyPlan,
        started_at:    now,
        created_at:    now,
        updated_at:    now,
      })
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    return { warmup: mapWarmupRow(row) };
  });

export const updateWarmupDay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id:              z.string().uuid(),
      day:             z.number().int().min(1),
      bounceRate:      z.number().min(0).max(100).nullable().default(null),
      spamRate:        z.number().min(0).max(100).nullable().default(null),
      reputationScore: z.number().int().min(0).max(100).nullable().default(null),
    }).parse(input)
  )
  .handler(async ({ context, data: input }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data: row, error: fetchErr } = await sb
      .from("growthmind_domain_warmups")
      .select("completed_days, total_days, daily_plan")
      .eq("id", input.id)
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (fetchErr) throw new Error(fetchErr.message);
    if (!row) throw new Error("Warmup not found");

    const completedDays = Array.isArray(row.completed_days)
      ? [...new Set([...row.completed_days, input.day])]
      : [input.day];

    const isComplete = completedDays.length >= row.total_days;
    const currentDay = isComplete ? row.total_days : Math.max(...completedDays) + 1;

    const updates: any = {
      completed_days:   completedDays,
      current_day:      currentDay,
      status:           isComplete ? "completed" : "active",
      updated_at:       new Date().toISOString(),
    };

    if (input.bounceRate != null)      updates.bounce_rate     = input.bounceRate;
    if (input.spamRate != null)        updates.spam_rate       = input.spamRate;
    if (input.reputationScore != null) updates.reputation_score = input.reputationScore;

    const { error } = await sb
      .from("growthmind_domain_warmups")
      .update(updates)
      .eq("id", input.id)
      .eq("workspace_id", workspaceId);

    if (error) throw new Error(error.message);
    return { ok: true, isComplete };
  });

export const updateWarmupStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id:     z.string().uuid(),
      status: z.enum(["active", "paused", "completed", "abandoned"]),
    }).parse(input)
  )
  .handler(async ({ context, data: input }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { error } = await sb
      .from("growthmind_domain_warmups")
      .update({ status: input.status, updated_at: new Date().toISOString() })
      .eq("id", input.id)
      .eq("workspace_id", workspaceId);

    if (error) throw new Error(error.message);
    return { ok: true };
  });
