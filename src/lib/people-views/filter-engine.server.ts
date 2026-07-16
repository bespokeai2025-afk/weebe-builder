/**
 * Shared, safe filter engine for workspace People views and campaign filters.
 *
 * - Whitelisted fields + operators only; everything validated with Zod before
 *   saving or running.
 * - Compiles to workspace-scoped Supabase queries against the `leads` table.
 * - Dry-run only reads — never mutates, calls, or messages.
 */
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

// ── Field registry ───────────────────────────────────────────────────────────

export type FieldKind = "text" | "number" | "date" | "boolean" | "enum";

type FieldDef = {
  /** leads column, "meta.<key>" handled separately */
  column: string;
  kind: FieldKind;
  label: string;
  enumValues?: string[];
  /** derived booleans compile to special query fragments */
  derived?: "email_exists" | "phone_exists" | "voicemail" | "do_not_contact" | "opted_out";
};

export const FILTER_FIELDS: Record<string, FieldDef> = {
  sentiment:            { column: "sentiment", kind: "enum", label: "Sentiment", enumValues: ["positive", "neutral", "negative"] },
  lead_status:          { column: "status", kind: "enum", label: "Lead Status", enumValues: ["need_to_call", "calling", "completed", "interested", "not_interested", "not_connected", "do_not_call", "qualified"] },
  call_outcome:         { column: "call_outcome", kind: "text", label: "Call Outcome" },
  qualification_status: { column: "qualification_status", kind: "text", label: "Qualification Status" },
  appointment_booked:   { column: "meeting_requested", kind: "boolean", label: "Appointment Booked" },
  booking_date:         { column: "scheduled_call_at", kind: "date", label: "Booking / Scheduled Date" },
  callback_requested:   { column: "callback_requested", kind: "boolean", label: "Callback Requested" },
  callback_date:        { column: "callback_date", kind: "date", label: "Callback Date" },
  lead_source:          { column: "source", kind: "text", label: "Lead Source" },
  source_detail:        { column: "source_detail", kind: "text", label: "Source Detail" },
  preferred_contact:    { column: "meta.preferred_contact", kind: "text", label: "Preferred Contact Method" },
  campaign:             { column: "utm_campaign", kind: "text", label: "Campaign (UTM)" },
  assigned_agent:       { column: "scheduled_agent_id", kind: "text", label: "Assigned Agent" },
  created_date:         { column: "created_at", kind: "date", label: "Created Date" },
  last_call_date:       { column: "last_contacted_at", kind: "date", label: "Last Call Date" },
  next_follow_up_date:  { column: "scheduled_call_at", kind: "date", label: "Next Follow-up Date" },
  no_answer_count:      { column: "attempt_count", kind: "number", label: "No-answer / Attempt Count" },
  voicemail:            { column: "call_outcome", kind: "boolean", label: "Voicemail", derived: "voicemail" },
  email_exists:         { column: "email", kind: "boolean", label: "Email Exists", derived: "email_exists" },
  phone_exists:         { column: "phone", kind: "boolean", label: "Phone Exists", derived: "phone_exists" },
  whatsapp_available:   { column: "meta.whatsapp_available", kind: "boolean", label: "WhatsApp Available" },
  budget_value:         { column: "funding_amount", kind: "number", label: "Budget / Deal Value" },
  lead_score:           { column: "lead_score", kind: "number", label: "Lead Score" },
  do_not_contact:       { column: "status", kind: "boolean", label: "Do Not Contact", derived: "do_not_contact" },
  opted_out:            { column: "meta.opted_out", kind: "boolean", label: "Opted Out", derived: "opted_out" },
  duplicate_status:     { column: "meta.duplicate_status", kind: "text", label: "Duplicate Status" },
};

// ── Per-page dataset registries (additive; leads registry stays the default) ─

/** Calls page dataset — real columns on the `calls` table. */
export const CALL_FILTER_FIELDS: Record<string, FieldDef> = {
  call_status:          { column: "call_status", kind: "enum", label: "Call Status", enumValues: ["initiated", "ringing", "in_progress", "completed", "failed", "no_answer", "busy", "voicemail"] },
  call_type:            { column: "call_type", kind: "enum", label: "Call Type", enumValues: ["inbound", "outbound"] },
  sentiment:            { column: "sentiment", kind: "enum", label: "Sentiment", enumValues: ["positive", "neutral", "negative"] },
  call_outcome:         { column: "call_outcome", kind: "text", label: "Call Outcome" },
  disconnection_reason: { column: "disconnection_reason", kind: "text", label: "Disconnection / End Reason" },
  voicemail:            { column: "is_voicemail", kind: "boolean", label: "Voicemail" },
  call_successful:      { column: "call_successful", kind: "boolean", label: "Call Successful" },
  agent_id:             { column: "agent_id", kind: "text", label: "Agent ID" },
  agent_name:           { column: "agent_name", kind: "text", label: "Agent Name" },
  from_number:          { column: "from_number", kind: "text", label: "From Number" },
  to_number:            { column: "to_number", kind: "text", label: "To Number" },
  provider:             { column: "provider", kind: "text", label: "Provider" },
  channel_type:         { column: "channel_type", kind: "text", label: "Channel" },
  duration_seconds:     { column: "duration_seconds", kind: "number", label: "Duration (seconds)" },
  cost_cents:           { column: "cost_cents", kind: "number", label: "Cost (cents)" },
  created_date:         { column: "created_at", kind: "date", label: "Created Date" },
  started_date:         { column: "started_at", kind: "date", label: "Started Date" },
  ended_date:           { column: "ended_at", kind: "date", label: "Ended Date" },
};

/** Campaigns page dataset — real columns on the `campaigns` table. */
export const CAMPAIGN_PAGE_FILTER_FIELDS: Record<string, FieldDef> = {
  campaign_name:   { column: "name", kind: "text", label: "Campaign Name" },
  campaign_status: { column: "status", kind: "enum", label: "Campaign Status", enumValues: ["draft", "active", "paused", "completed", "cancelled"] },
  agent_id:        { column: "agent_id", kind: "text", label: "Agent ID" },
  created_date:    { column: "created_at", kind: "date", label: "Created Date" },
  updated_date:    { column: "updated_at", kind: "date", label: "Updated Date" },
};

/** Workflows page dataset — real columns on `workspace_workflows`. */
export const WORKFLOW_FILTER_FIELDS: Record<string, FieldDef> = {
  workflow_name:   { column: "name", kind: "text", label: "Workflow Name" },
  workflow_status: { column: "status", kind: "text", label: "Workflow Status" },
  created_date:    { column: "created_at", kind: "date", label: "Created Date" },
  updated_date:    { column: "updated_at", kind: "date", label: "Updated Date" },
};

export type PageKey =
  | "people" | "leads" | "qualified" | "calls" | "data" | "campaigns"
  | "follow_up_centre" | "workflows" | "analytics" | "custom_people_view"
  | "custom_campaign_view";

export type PageDataset = {
  table: string;
  registry: Record<string, FieldDef>;
  /** whether meta.<key> custom fields are allowed (leads table only) */
  allowMeta: boolean;
  sampleColumns: string;
  defaultOrderCol: string;
};

const LEADS_DATASET: PageDataset = {
  table: "leads",
  registry: FILTER_FIELDS,
  allowMeta: true,
  sampleColumns: "id, full_name, phone, email, status, sentiment, source, created_at",
  defaultOrderCol: "updated_at",
};
const CALLS_DATASET: PageDataset = {
  table: "calls",
  registry: CALL_FILTER_FIELDS,
  allowMeta: false,
  sampleColumns: "id, to_number, from_number, call_status, call_type, sentiment, is_voicemail, duration_seconds, created_at",
  defaultOrderCol: "created_at",
};
const CAMPAIGNS_DATASET: PageDataset = {
  table: "campaigns",
  registry: CAMPAIGN_PAGE_FILTER_FIELDS,
  allowMeta: false,
  sampleColumns: "id, name, status, agent_id, created_at",
  defaultOrderCol: "updated_at",
};
const WORKFLOWS_DATASET: PageDataset = {
  table: "workspace_workflows",
  registry: WORKFLOW_FILTER_FIELDS,
  allowMeta: false,
  sampleColumns: "id, name, status, created_at",
  defaultOrderCol: "updated_at",
};

/** Which dataset each page's saved filters run against. */
export const PAGE_DATASETS: Record<PageKey, PageDataset> = {
  people: LEADS_DATASET,
  leads: LEADS_DATASET,
  qualified: LEADS_DATASET,
  data: LEADS_DATASET,
  follow_up_centre: LEADS_DATASET,
  custom_people_view: LEADS_DATASET,
  custom_campaign_view: LEADS_DATASET,
  calls: CALLS_DATASET,
  analytics: CALLS_DATASET,
  campaigns: CAMPAIGNS_DATASET,
  workflows: WORKFLOWS_DATASET,
};

export const PAGE_KEYS = Object.keys(PAGE_DATASETS) as PageKey[];

export const FILTER_OPERATORS = [
  "equals", "not_equals", "contains", "not_contains",
  "is_empty", "is_not_empty", "greater_than", "less_than",
  "between", "before", "after", "in_list", "not_in_list",
] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

const OPERATORS_BY_KIND: Record<FieldKind, FilterOperator[]> = {
  text:    ["equals", "not_equals", "contains", "not_contains", "is_empty", "is_not_empty", "in_list", "not_in_list"],
  number:  ["equals", "not_equals", "greater_than", "less_than", "between", "is_empty", "is_not_empty"],
  date:    ["before", "after", "between", "is_empty", "is_not_empty"],
  boolean: ["equals"],
  enum:    ["equals", "not_equals", "in_list", "not_in_list", "is_empty", "is_not_empty"],
};

// ── Schemas ──────────────────────────────────────────────────────────────────

export const filterConditionSchema = z.object({
  field: z.string().min(1).max(120),
  operator: z.enum(FILTER_OPERATORS),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]).optional(),
  value2: z.union([z.string(), z.number()]).optional(), // for "between"
});
export type FilterCondition = z.infer<typeof filterConditionSchema>;

export const filterConfigSchema = z.object({
  conditions: z.array(filterConditionSchema).max(20).default([]),
  logic: z.enum(["and"]).default("and"),
});
export type FilterConfig = z.infer<typeof filterConfigSchema>;

export const safetyConfigSchema = z.object({
  excludeBooked: z.boolean().default(true),
  excludeDoNotContact: z.boolean().default(true),
  excludeOptedOut: z.boolean().default(true),
  excludeNoPhone: z.boolean().default(true),
  excludeActiveCampaign: z.boolean().default(true),
  excludeCalledToday: z.boolean().default(false),
});
export type SafetyConfig = z.infer<typeof safetyConfigSchema>;
export const DEFAULT_SAFETY: SafetyConfig = safetyConfigSchema.parse({});

const META_KEY_RE = /^meta\.[a-zA-Z0-9_\-. ]{1,80}$/;

/**
 * Safely quotes a value for a PostgREST `in.(...)` filter list.
 * Backslashes and double quotes are escaped so crafted values (quotes,
 * commas, parens) cannot break out of the quoted list element.
 */
function quotePgrstListValue(v: unknown): string {
  return `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * Validates a filter config: known fields (or meta.*), operator allowed for
 * the field kind, values present where required. Returns normalized config
 * or a list of errors (including unknown fields, so SystemMind can offer to
 * create workspace custom fields).
 */
export function validateFilterConfig(
  raw: unknown,
  opts?: { registry?: Record<string, FieldDef>; allowMeta?: boolean },
): {
  ok: boolean;
  config?: FilterConfig;
  errors: string[];
  unknownFields: string[];
} {
  const registry = opts?.registry ?? FILTER_FIELDS;
  const allowMeta = opts?.allowMeta ?? true;
  const errors: string[] = [];
  const unknownFields: string[] = [];
  const parsed = filterConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => i.message), unknownFields };
  }
  for (const c of parsed.data.conditions) {
    const def = registry[c.field];
    const isMeta = !def && allowMeta && META_KEY_RE.test(c.field);
    if (!def && !isMeta) {
      unknownFields.push(c.field);
      errors.push(`Unknown field "${c.field}" — a workspace custom field (meta.${c.field}) can be proposed instead.`);
      continue;
    }
    const kind: FieldKind = def?.kind ?? "text";
    if (!OPERATORS_BY_KIND[kind].includes(c.operator)) {
      errors.push(`Operator "${c.operator}" is not valid for ${c.field} (${kind}).`);
    }
    const needsValue = !["is_empty", "is_not_empty"].includes(c.operator);
    if (needsValue && (c.value === undefined || c.value === null || c.value === "")) {
      errors.push(`Condition on "${c.field}" requires a value for operator "${c.operator}".`);
    }
    if (c.operator === "between" && (c.value === undefined || c.value2 === undefined)) {
      errors.push(`"between" on "${c.field}" requires both value and value2.`);
    }
    if (["in_list", "not_in_list"].includes(c.operator) && !Array.isArray(c.value)) {
      errors.push(`"${c.operator}" on "${c.field}" requires a list value.`);
    }
    if (def?.kind === "enum" && def.enumValues && !["is_empty", "is_not_empty"].includes(c.operator)) {
      const vals = Array.isArray(c.value) ? c.value : [c.value];
      for (const v of vals) {
        if (v !== undefined && !def.enumValues.includes(String(v))) {
          errors.push(`"${v}" is not a valid value for ${c.field}. Allowed: ${def.enumValues.join(", ")}.`);
        }
      }
    }
  }
  return { ok: errors.length === 0, config: parsed.data, errors, unknownFields };
}

// ── Query compilation ────────────────────────────────────────────────────────

function pgColumn(field: string, registry: Record<string, FieldDef> = FILTER_FIELDS): string {
  const def = registry[field];
  const col = def?.column ?? field; // meta.* passes through
  if (col.startsWith("meta.")) return `meta->>${col.slice(5)}`;
  return col;
}

function applyDerivedBoolean(q: any, def: FieldDef, truthy: boolean): any {
  switch (def.derived) {
    case "email_exists":
      return truthy ? q.not("email", "is", null).neq("email", "") : q.or("email.is.null,email.eq.");
    case "phone_exists":
      return truthy ? q.not("phone", "is", null).neq("phone", "") : q.or("phone.is.null,phone.eq.");
    case "voicemail":
      return truthy
        ? q.ilike("call_outcome", "%voicemail%")
        : q.or("call_outcome.is.null,call_outcome.not.ilike.%voicemail%");
    case "do_not_contact":
      return truthy ? q.eq("status", "do_not_call") : q.neq("status", "do_not_call");
    case "opted_out":
      return truthy ? q.eq("meta->>opted_out", "true") : q.or("meta->>opted_out.is.null,meta->>opted_out.neq.true");
    default:
      return q;
  }
}

/**
 * Applies a validated FilterConfig to a supabase query builder on `leads`.
 * Caller MUST have already applied .eq("workspace_id", ...).
 */
export function applyFilterToQuery(
  q: any,
  config: FilterConfig,
  registry: Record<string, FieldDef> = FILTER_FIELDS,
): any {
  for (const c of config.conditions) {
    const def = registry[c.field];
    if (def?.derived && def.kind === "boolean") {
      const truthy = c.value === true || c.value === "true";
      q = applyDerivedBoolean(q, def, truthy);
      continue;
    }
    const col = pgColumn(c.field, registry);
    switch (c.operator) {
      case "equals":
        if (def?.kind === "boolean") q = q.eq(col, c.value === true || c.value === "true");
        else q = q.eq(col, c.value as any);
        break;
      case "not_equals":  q = q.neq(col, c.value as any); break;
      case "contains":    q = q.ilike(col, `%${String(c.value)}%`); break;
      case "not_contains": q = q.not(col, "ilike", `%${String(c.value)}%`); break;
      case "is_empty":    q = q.is(col, null); break;
      case "is_not_empty": q = q.not(col, "is", null); break;
      case "greater_than": q = q.gt(col, c.value as any); break;
      case "less_than":   q = q.lt(col, c.value as any); break;
      case "between":     q = q.gte(col, c.value as any).lte(col, c.value2 as any); break;
      case "before":      q = q.lt(col, c.value as any); break;
      case "after":       q = q.gt(col, c.value as any); break;
      case "in_list":     q = q.in(col, (c.value as any[]) ?? []); break;
      case "not_in_list": q = q.not(col, "in", `(${((c.value as any[]) ?? []).map(quotePgrstListValue).join(",")})`); break;
    }
  }
  return q;
}

/** Applies campaign safety exclusions (additive) to a leads query. */
export function applySafetyExclusions(q: any, safety: SafetyConfig): any {
  if (safety.excludeBooked) q = q.eq("meeting_requested", false);
  if (safety.excludeDoNotContact) q = q.neq("status", "do_not_call");
  if (safety.excludeOptedOut) q = q.or("meta->>opted_out.is.null,meta->>opted_out.neq.true");
  if (safety.excludeNoPhone) q = q.not("phone", "is", null).neq("phone", "");
  if (safety.excludeActiveCampaign) q = q.neq("status", "calling");
  return q;
}

// ── Dry-run ──────────────────────────────────────────────────────────────────

export type DryRunResult = {
  totalMatching: number;
  sample: Array<Record<string, any>>;
  excludedCount: number;
  exclusionBreakdown: Record<string, number>;
  includesBooked: boolean;
  includesOptedOut: boolean;
  includesDoNotContact: boolean;
  includesActiveCampaignLeads: boolean;
  includesNoPhone: boolean;
  estimatedCallVolume: number;
  warnings: string[];
  riskLevel: "low" | "medium" | "high";
  ranAt: string;
};

const SAMPLE_COLUMNS = "id, full_name, phone, email, status, sentiment, source, created_at";

async function countWith(
  sb: SupabaseClient,
  workspaceId: string,
  build: (q: any) => any,
): Promise<number> {
  const base = (sb as any)
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);
  const { count, error } = await build(base);
  if (error) throw new Error(`Dry-run query failed: ${error.message}`);
  return count ?? 0;
}

/**
 * Generic, read-only dry run for a page dataset (any PAGE_DATASETS entry).
 * Counts + samples only; never mutates, calls or messages.
 */
export async function runPageFilterDryRun(
  sb: SupabaseClient,
  workspaceId: string,
  pageKey: PageKey,
  rawConfig: unknown,
): Promise<DryRunResult> {
  const ds = PAGE_DATASETS[pageKey];
  if (!ds) throw new Error(`Unknown page "${pageKey}".`);
  const validated = validateFilterConfig(rawConfig, { registry: ds.registry, allowMeta: ds.allowMeta });
  if (!validated.ok || !validated.config) {
    throw new Error(`Invalid filter config: ${validated.errors.join("; ")}`);
  }
  const config = validated.config;

  const base = (sb as any)
    .from(ds.table)
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);
  const { count, error } = await applyFilterToQuery(base, config, ds.registry);
  if (error) throw new Error(`Dry-run query failed: ${error.message}`);
  const totalMatching = count ?? 0;

  let sampleQ = (sb as any)
    .from(ds.table)
    .select(ds.sampleColumns)
    .eq("workspace_id", workspaceId)
    .limit(5);
  sampleQ = applyFilterToQuery(sampleQ, config, ds.registry);
  const { data: sample } = await sampleQ;

  const warnings: string[] = [];
  if (totalMatching === 0) warnings.push("Filter currently matches no records.");

  return {
    totalMatching,
    sample: (sample ?? []) as Array<Record<string, unknown>>,
    excludedCount: 0,
    exclusionBreakdown: {},
    includesBooked: false,
    includesOptedOut: false,
    includesDoNotContact: false,
    includesActiveCampaignLeads: false,
    includesNoPhone: false,
    estimatedCallVolume: 0,
    warnings,
    riskLevel: "low",
    ranAt: new Date().toISOString(),
  };
}

/**
 * Read-only dry run. Never mutates, calls or messages.
 * `mode: "campaign"` also applies safety exclusions and estimates call volume.
 */
export async function runFilterDryRun(
  sb: SupabaseClient,
  workspaceId: string,
  rawConfig: unknown,
  opts?: { mode?: "view" | "campaign"; safety?: SafetyConfig },
): Promise<DryRunResult> {
  const mode = opts?.mode ?? "view";
  const safety = opts?.safety ?? DEFAULT_SAFETY;
  const validated = validateFilterConfig(rawConfig);
  if (!validated.ok || !validated.config) {
    throw new Error(`Invalid filter config: ${validated.errors.join("; ")}`);
  }
  const config = validated.config;

  const rawMatches = await countWith(sb, workspaceId, (q) => applyFilterToQuery(q, config));

  // Overlap probes — do raw matches include unsafe segments?
  const [bookedIn, dncIn, optedOutIn, activeIn, noPhoneIn] = await Promise.all([
    countWith(sb, workspaceId, (q) => applyFilterToQuery(q, config).eq("meeting_requested", true)),
    countWith(sb, workspaceId, (q) => applyFilterToQuery(q, config).eq("status", "do_not_call")),
    countWith(sb, workspaceId, (q) => applyFilterToQuery(q, config).eq("meta->>opted_out", "true")),
    countWith(sb, workspaceId, (q) => applyFilterToQuery(q, config).eq("status", "calling")),
    countWith(sb, workspaceId, (q) => applyFilterToQuery(q, config).or("phone.is.null,phone.eq.")),
  ]);

  let finalCount = rawMatches;
  const exclusionBreakdown: Record<string, number> = {};
  if (mode === "campaign") {
    finalCount = await countWith(sb, workspaceId, (q) =>
      applySafetyExclusions(applyFilterToQuery(q, config), safety),
    );
    if (safety.excludeBooked) exclusionBreakdown.booked = bookedIn;
    if (safety.excludeDoNotContact) exclusionBreakdown.do_not_contact = dncIn;
    if (safety.excludeOptedOut) exclusionBreakdown.opted_out = optedOutIn;
    if (safety.excludeNoPhone) exclusionBreakdown.no_phone = noPhoneIn;
    if (safety.excludeActiveCampaign) exclusionBreakdown.in_active_campaign = activeIn;
  }

  let sampleQ = (sb as any)
    .from("leads")
    .select(SAMPLE_COLUMNS)
    .eq("workspace_id", workspaceId)
    .limit(5);
  sampleQ = applyFilterToQuery(sampleQ, config);
  if (mode === "campaign") sampleQ = applySafetyExclusions(sampleQ, safety);
  const { data: sample } = await sampleQ;

  const includesBooked = mode === "campaign" ? (!safety.excludeBooked && bookedIn > 0) : bookedIn > 0;
  const includesDoNotContact = mode === "campaign" ? (!safety.excludeDoNotContact && dncIn > 0) : dncIn > 0;
  const includesOptedOut = mode === "campaign" ? (!safety.excludeOptedOut && optedOutIn > 0) : optedOutIn > 0;
  const includesActiveCampaignLeads = mode === "campaign" ? (!safety.excludeActiveCampaign && activeIn > 0) : activeIn > 0;
  const includesNoPhone = mode === "campaign" ? (!safety.excludeNoPhone && noPhoneIn > 0) : noPhoneIn > 0;

  const warnings: string[] = [];
  if (mode === "campaign") {
    if (includesBooked) warnings.push("Filter would call leads with booked appointments.");
    if (includesDoNotContact) warnings.push("Filter would call do-not-contact leads.");
    if (includesOptedOut) warnings.push("Filter would call opted-out leads.");
    if (includesActiveCampaignLeads) warnings.push("Filter would call leads already being called by an active campaign.");
    if (includesNoPhone) warnings.push("Filter matches leads without a phone number (they cannot be called).");
    if (finalCount > 200) warnings.push(`Matches ${finalCount} leads but each campaign run is capped at 200 calls.`);
  }
  if (rawMatches === 0) warnings.push("Filter currently matches no records.");

  const riskLevel: DryRunResult["riskLevel"] =
    mode === "campaign" && (includesBooked || includesDoNotContact || includesOptedOut)
      ? "high"
      : mode === "campaign" && (includesActiveCampaignLeads || finalCount > 200)
        ? "medium"
        : "low";

  return {
    totalMatching: finalCount,
    sample: (sample ?? []) as Array<Record<string, unknown>>,
    excludedCount: Math.max(0, rawMatches - finalCount),
    exclusionBreakdown,
    includesBooked,
    includesOptedOut,
    includesDoNotContact,
    includesActiveCampaignLeads,
    includesNoPhone,
    estimatedCallVolume: mode === "campaign" ? Math.min(finalCount, 200) : 0,
    warnings,
    riskLevel,
    ranAt: new Date().toISOString(),
  };
}
