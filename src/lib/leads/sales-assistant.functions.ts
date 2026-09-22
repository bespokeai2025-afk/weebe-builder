/**
 * AI Sales Assistant for a single lead (or Data record).
 *
 * Reuses what already exists: requireSupabaseAuth for workspace scoping, resolvePermissions for the
 * assigned-records-only rule that upsertLead already honours, and the same OpenAI chat-completions
 * call pattern the GrowthMind features use. No new provider, no new key, no new dashboard.
 *
 * Company research is fetched server-side only — the page never sees a key or makes the request —
 * and the result is cached on the row so regenerating, or switching between the three modes, does
 * not refetch the same website.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertSalesAssistantAccess, canUseSalesAssistant } from "./webespoke-internal.shared";
import {
  ASSISTANT_SYSTEM_PROMPT,
  buildAssistantPrompt,
  htmlToText,
  isSafeResearchUrl,
  resolveResearchUrl,
  type AssistantMode,
  type AssistantSubject,
} from "./sales-assistant.shared";

/** Research older than this is refetched; company sites change slowly. */
const RESEARCH_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const RESEARCH_TIMEOUT_MS = 8000;
const RESEARCH_MAX_BYTES = 400_000;

type CachedResearch = { url: string; text: string; fetchedAt: string };

function str(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s || null;
}

function pushFact(facts: AssistantSubject["facts"], label: string, value: unknown) {
  const v = str(value);
  if (v) facts.push({ label, value: v });
}

/**
 * Fetches a company homepage. Guarded because the URL originates in imported spreadsheet data:
 * https only, no literal IPs or internal hostnames, a hard timeout, and a byte cap so a huge
 * response cannot exhaust memory.
 */
async function fetchCompanyResearch(url: string): Promise<CachedResearch | null> {
  if (!isSafeResearchUrl(url)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RESEARCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "WeBeeBot/1.0 (+sales-assistant)", Accept: "text/html" },
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    if (!type.includes("html") && !type.includes("text")) return null;

    // A redirect can land somewhere the original guard did not cover.
    if (!isSafeResearchUrl(res.url || url)) return null;

    const buf = await res.arrayBuffer();
    const html = new TextDecoder().decode(buf.slice(0, RESEARCH_MAX_BYTES));
    const text = htmlToText(html);
    if (text.length < 80) return null;
    return { url, text, fetchedAt: new Date().toISOString() };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Everything already recorded about this lead, newest first. */
async function loadLeadHistory(
  sb: any,
  workspaceId: string,
  lead: Record<string, unknown>,
): Promise<AssistantSubject["history"]> {
  const history: AssistantSubject["history"] = [];
  const leadId = String(lead.id);
  const phone = str(lead.phone);

  const [notesRes, callsRes, waRes] = await Promise.all([
    sb
      .from("entity_notes")
      .select("body, created_at")
      .eq("workspace_id", workspaceId)
      .eq("entity_type", "lead")
      .eq("entity_id", leadId)
      .order("created_at", { ascending: false })
      .limit(10),
    sb
      .from("calls")
      .select("call_summary, transcript, started_at, sentiment, call_status")
      .eq("workspace_id", workspaceId)
      .eq("lead_id", leadId)
      .order("started_at", { ascending: false })
      .limit(5),
    phone
      ? sb
          .from("whatsapp_messages")
          .select("body, direction, sent_at")
          .eq("workspace_id", workspaceId)
          .eq("contact_phone", phone)
          .order("sent_at", { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [] }),
  ]);

  for (const n of (notesRes?.data ?? []) as Array<Record<string, unknown>>) {
    const body = str(n.body);
    if (body) history.push({ at: str(n.created_at), kind: "note", text: body.slice(0, 600) });
  }
  for (const c of (callsRes?.data ?? []) as Array<Record<string, unknown>>) {
    const summary = str(c.call_summary) ?? str(c.transcript)?.slice(0, 600);
    if (summary) {
      const sentiment = str(c.sentiment);
      history.push({
        at: str(c.started_at),
        kind: sentiment ? `call, ${sentiment}` : "call",
        text: summary.slice(0, 600),
      });
    }
  }
  for (const m of (waRes?.data ?? []) as Array<Record<string, unknown>>) {
    const body = str(m.body);
    if (body) {
      history.push({
        at: str(m.sent_at),
        kind: m.direction === "inbound" ? "WhatsApp from them" : "WhatsApp from us",
        text: body.slice(0, 400),
      });
    }
  }

  history.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  return history.slice(0, 20);
}

function subjectFromLead(lead: Record<string, unknown>): AssistantSubject {
  const facts: AssistantSubject["facts"] = [];
  pushFact(facts, "Business type", lead.business_type);
  pushFact(facts, "Address", lead.business_address);
  pushFact(facts, "Status", lead.status);
  pushFact(facts, "Pipeline stage", lead.pipeline_stage);
  pushFact(facts, "Qualification", lead.qualification_status);
  pushFact(facts, "Interest level", lead.interest_level);
  pushFact(facts, "Buying intent", lead.buying_intent);
  pushFact(facts, "Urgency", lead.urgency);
  pushFact(facts, "Decision maker", lead.decision_maker);
  pushFact(facts, "Budget confirmed", lead.budget_confirmed);
  // The single most important field for this feature: a recorded objection is
  // exactly what must not be ignored on the next contact.
  pushFact(facts, "Objections raised", lead.objections);
  pushFact(facts, "Latest call summary", lead.call_summary);
  pushFact(facts, "Agreed next step", lead.next_step ?? lead.next_action);
  pushFact(facts, "Notes", lead.notes);
  pushFact(facts, "Source", lead.source);
  pushFact(facts, "Last contacted", lead.last_contacted_at);
  pushFact(facts, "Contact attempts", lead.attempt_count);

  const meta = (lead.meta as Record<string, unknown> | null) ?? {};
  for (const [k, v] of Object.entries(meta)) {
    if (k === "ai_research") continue;
    const value = str(v);
    if (value && facts.length < 40) facts.push({ label: k, value: value.slice(0, 200) });
  }

  return {
    id: String(lead.id),
    kind: "lead",
    name: str(lead.full_name),
    company: str(lead.company_name),
    email: str(lead.email),
    phone: str(lead.phone),
    facts,
    history: [],
  };
}

function subjectFromRecord(row: Record<string, unknown>): AssistantSubject {
  const facts: AssistantSubject["facts"] = [];
  pushFact(facts, "Job title", row.title);
  pushFact(facts, "Property type", row.property_type);
  pushFact(facts, "Bedrooms", row.bedrooms);
  pushFact(
    facts,
    "Address",
    [row.address_line1, row.address_line2, row.city, row.state, row.postal_code]
      .map((p) => str(p))
      .filter(Boolean)
      .join(", "),
  );
  pushFact(facts, "Call status", row.call_status);
  pushFact(facts, "Last call outcome", row.last_call_outcome);
  pushFact(facts, "Last call sentiment", row.last_call_sentiment);
  pushFact(facts, "Last called", row.last_call_at);

  const meta = (row.meta as Record<string, unknown> | null) ?? {};
  for (const [k, v] of Object.entries(meta)) {
    if (k === "ai_research") continue;
    const value = str(v);
    if (value && facts.length < 40) facts.push({ label: k, value: value.slice(0, 200) });
  }

  const name =
    str(row.name) ?? [str(row.first_name), str(row.last_name)].filter(Boolean).join(" ") ?? null;

  return {
    id: String(row.id),
    kind: "record",
    name: name || null,
    company: str(row.client_name),
    email: str(row.email),
    phone: str(row.mobile_number),
    facts,
    history: [],
  };
}

/** Whether the signed-in user may see the assistant at all, for hiding the button. */
export const getSalesAssistantAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId, userId } = context;
    const { data: profile } = await (supabase as any)
      .from("profiles")
      .select("user_type")
      .eq("user_id", userId)
      .maybeSingle();
    return {
      allowed: canUseSalesAssistant({
        workspaceId,
        userType: profile?.user_type ?? null,
      }),
    };
  });

export const generateLeadSalesAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        source: z.enum(["lead", "record"]).default("lead"),
        id: z.string().uuid(),
        mode: z.enum(["pitch", "meeting", "demo"]),
        /** Force a fresh website fetch instead of using the cached research. */
        refreshResearch: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId, userId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;

    // WeBespoke-only: this generates pitches for WEBEE itself, so it is
    // meaningless in a customer workspace. Enforced here as well as hidden in
    // the UI — the UI check is a courtesy, this is the control.
    const { data: profile } = await sb
      .from("profiles")
      .select("user_type")
      .eq("user_id", userId)
      .maybeSingle();
    assertSalesAssistantAccess({ workspaceId, userType: profile?.user_type ?? null });

    const table = data.source === "lead" ? "leads" : "data_records";
    const { data: row, error } = await sb
      .from(table)
      .select("*")
      .eq("id", data.id)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Lead not found in this workspace");

    // Same rule upsertLead applies: an assigned-records-only role may only work
    // its own leads.
    if (data.source === "lead") {
      const { resolvePermissions } = await import("@/lib/permissions/permissions.server");
      const perms = await resolvePermissions(workspaceId, userId);
      if (perms.assignedRecordsOnly && row.assigned_to !== userId) {
        throw new Error("This lead is not assigned to you");
      }
    }

    const subject = data.source === "lead" ? subjectFromLead(row) : subjectFromRecord(row);
    if (data.source === "lead") {
      subject.history = await loadLeadHistory(sb, workspaceId, row);
    }

    // ── Company research, cached on the row ────────────────────────────────
    const meta = (row.meta as Record<string, unknown> | null) ?? {};
    const cached = meta.ai_research as CachedResearch | undefined;
    const cacheFresh =
      cached?.text &&
      cached.fetchedAt &&
      Date.now() - Date.parse(cached.fetchedAt) < RESEARCH_TTL_MS;

    let research: CachedResearch | null = null;
    if (cacheFresh && !data.refreshResearch) {
      research = cached as CachedResearch;
    } else {
      const url = resolveResearchUrl(meta, subject.email);
      if (url) {
        research = await fetchCompanyResearch(url);
        if (research) {
          await sb
            .from(table)
            .update({ meta: { ...meta, ai_research: research } })
            .eq("id", data.id)
            .eq("workspace_id", workspaceId);
        }
      }
      // Nothing fetchable now: a stale cache still beats no research at all.
      if (!research && cached?.text) research = cached as CachedResearch;
    }

    // ── Generate ───────────────────────────────────────────────────────────
    const settings = (context as any).settings ?? {};
    const apiKey = process.env.OPENAI_API_KEY ?? settings.openai_api_key;
    if (!apiKey) {
      throw new Error("OpenAI API key not configured. Add it in Settings → Integrations.");
    }

    const prompt = buildAssistantPrompt(subject, data.mode as AssistantMode, research);
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: ASSISTANT_SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        max_tokens: 1200,
        temperature: 0.6,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => res.statusText);
      throw new Error(`AI request failed: ${detail.slice(0, 200)}`);
    }
    const json = (await res.json()) as any;
    const content = String(json.choices?.[0]?.message?.content ?? "").trim();
    if (!content) throw new Error("The AI returned an empty response — try Regenerate.");

    const result = {
      mode: data.mode,
      content,
      researchUrl: research?.url ?? null,
      researchFetchedAt: research?.fetchedAt ?? null,
      historyUsed: subject.history.length,
      generatedAt: new Date().toISOString(),
    };

    // Keep the latest generation per mode on the row, so reopening the panel shows what was
    // generated before instead of an empty box. Re-read meta first: the research step above may
    // have written to it, and this must not roll that back.
    const { data: fresh } = await sb
      .from(table)
      .select("meta")
      .eq("id", data.id)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const latestMeta = (fresh?.meta as Record<string, unknown> | null) ?? meta;
    const saved = (latestMeta.ai_assistant as Record<string, unknown> | undefined) ?? {};
    await sb
      .from(table)
      .update({ meta: { ...latestMeta, ai_assistant: { ...saved, [data.mode]: result } } })
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);

    return result;
  });

export type SavedAssistantGeneration = {
  mode: string;
  content: string;
  researchUrl: string | null;
  researchFetchedAt: string | null;
  historyUsed: number;
  generatedAt: string;
};

/** One stored generation per mode. Absent keys simply mean that mode was never run. */
export type SavedAssistantResults = {
  pitch?: SavedAssistantGeneration;
  meeting?: SavedAssistantGeneration;
  demo?: SavedAssistantGeneration;
};

/**
 * The most recent generation for each mode, so the panel can reopen where the rep left off.
 *
 * Access is checked the same way as generating: this returns WeBespoke's own pitch material.
 */
export const getSavedLeadSalesAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        source: z.enum(["lead", "record"]).default("lead"),
        id: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }): Promise<SavedAssistantResults> => {
    const { supabase, workspaceId, userId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;

    const { data: profile } = await sb
      .from("profiles")
      .select("user_type")
      .eq("user_id", userId)
      .maybeSingle();
    assertSalesAssistantAccess({ workspaceId, userType: profile?.user_type ?? null });

    const table = data.source === "lead" ? "leads" : "data_records";
    const { data: row, error } = await sb
      .from(table)
      .select("meta, assigned_to")
      .eq("id", data.id)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return {};

    if (data.source === "lead") {
      const { resolvePermissions } = await import("@/lib/permissions/permissions.server");
      const perms = await resolvePermissions(workspaceId, userId);
      if (perms.assignedRecordsOnly && row.assigned_to !== userId) {
        throw new Error("This lead is not assigned to you");
      }
    }

    const meta = (row.meta as Record<string, unknown> | null) ?? {};
    const saved = meta.ai_assistant;
    return saved && typeof saved === "object" && !Array.isArray(saved)
      ? (saved as SavedAssistantResults)
      : {};
  });
