import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { retellFetch } from "@/lib/providers/retell/client.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const RecordIdsSchema = z.object({
  recordIds: z.array(z.string().uuid()).min(1).max(2000),
});

const DataRowSchema = z.object({
  name: z.string().min(1).max(200),
  mobile_number: z.string().min(3).max(40),
  first_name: z.string().max(120).nullable().optional(),
  last_name: z.string().max(120).nullable().optional(),
  email: z.string().email().max(200).nullable().optional().or(z.literal("")),
  title: z.string().max(120).nullable().optional(),
  client_name: z.string().max(200).nullable().optional(),
  unique_id: z.string().max(120).nullable().optional(),
  property_type: z.string().max(120).nullable().optional(),
  bedrooms: z.string().max(40).nullable().optional(),
  address_line1: z.string().max(255).nullable().optional(),
  address_line2: z.string().max(255).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  state: z.string().max(120).nullable().optional(),
  postal_code: z.string().max(40).nullable().optional(),
  lead_external_id: z.string().max(120).nullable().optional(),
  meta: z.record(z.string(), z.string()).optional(),
});

export const listDataRecords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        search: z.string().optional(),
        activeOnly: z.boolean().optional(),
        callStatus: z
          .enum(["all", "needs_to_call", "queued", "calling", "completed", "failed", "do_not_call", "disqualified"])
          .optional(),
        assignedAgentId: z.string().uuid().nullable().optional(),
        unassignedOnly: z.boolean().optional(),
        limit: z.number().int().min(1).max(10000).default(5000),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;

    let q = sb
      .from("data_records")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("is_deleted", false)
      .order("updated_at", { ascending: false })
      .limit(data.limit);
    if (data.activeOnly) q = q.eq("is_active", true);
    if (data.callStatus && data.callStatus !== "all") q = q.eq("call_status", data.callStatus);
    if (data.unassignedOnly) q = q.is("assigned_agent_id", null);
    else if (data.assignedAgentId) q = q.eq("assigned_agent_id", data.assignedAgentId);
    if (data.search)
      q = q.or(
        `name.ilike.%${data.search}%,mobile_number.ilike.%${data.search}%,email.ilike.%${data.search}%`,
      );
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    // Deduplicate by mobile_number — keep the most recently updated record per number
    const seen = new Set<string>();
    const deduped: typeof rows = [];
    for (const row of rows ?? []) {
      const key = (row.mobile_number ?? "").trim();
      if (!key || !seen.has(key)) {
        deduped.push(row);
        if (key) seen.add(key);
      }
    }
    return deduped;
  });

export const assignAgentToRecords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    RecordIdsSchema.extend({
      agentId: z.string().uuid().nullable(),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;

    const { error, count } = await sb
      .from("data_records")
      .update({ assigned_agent_id: data.agentId }, { count: "exact" })
      .eq("workspace_id", workspaceId)
      .in("id", data.recordIds);
    if (error) throw new Error(error.message);
    return { updated: count ?? 0 };
  });

export const scheduleCallsForRecords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    RecordIdsSchema.extend({
      scheduledAt: z.string().datetime().nullable(),
      agentId: z.string().uuid().nullable().optional(),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;

    const patch: Record<string, any> = {
      scheduled_call_at: data.scheduledAt,
      call_status: data.scheduledAt ? "queued" : "needs_to_call",
    };
    if (data.agentId !== undefined) patch.assigned_agent_id = data.agentId;
    const { error, count } = await sb
      .from("data_records")
      .update(patch, { count: "exact" })
      .eq("workspace_id", workspaceId)
      .in("id", data.recordIds);
    if (error) throw new Error(error.message);
    return { updated: count ?? 0 };
  });

export const setRecordCallStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    RecordIdsSchema.extend({
      status: z.enum(["needs_to_call", "queued", "calling", "completed", "failed", "do_not_call", "disqualified"]),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;

    const patch: Record<string, any> = {
      call_status: data.status,
      need_to_call: data.status !== "do_not_call" && data.status !== "completed",
    };
    const { error, count } = await sb
      .from("data_records")
      .update(patch, { count: "exact" })
      .eq("workspace_id", workspaceId)
      .in("id", data.recordIds);
    if (error) throw new Error(error.message);
    return { updated: count ?? 0 };
  });

/**
 * Reset one or more records back to "needs_to_call" and clear any per-day
 * attempt counters so they can be called again immediately (useful for testing).
 */
export const resetDataRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => RecordIdsSchema.parse(input))
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;

    const { data: rows, error: readErr } = await sb
      .from("data_records")
      .select("id, meta")
      .eq("workspace_id", workspaceId)
      .in("id", data.recordIds);
    if (readErr) throw new Error(readErr.message);

    let updated = 0;
    for (const row of rows ?? []) {
      const meta = { ...(row.meta ?? {}) };
      delete meta._dailyAttempts;
      delete meta._lastCallDate;
      const { error } = await sb
        .from("data_records")
        .update({ call_status: "needs_to_call", need_to_call: true, meta })
        .eq("id", row.id)
        .eq("workspace_id", workspaceId);
      if (!error) updated++;
    }
    return { updated };
  });

export const startCallingRecords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    RecordIdsSchema.extend({
      agentId: z.string().uuid().nullable().optional(),
      fromNumber: z.string().min(3).max(32).nullable().optional(),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;

    const { data: records, error } = await sb
      .from("data_records")
      .select("id, mobile_number, assigned_agent_id, name, first_name, last_name, email, title, client_name, unique_id, property_type, bedrooms, address_line1, address_line2, city, state, postal_code, lead_external_id, meta")
      .eq("workspace_id", workspaceId)
      .in("id", data.recordIds);
    if (error) throw new Error(error.message);

    const agentIds = Array.from(
      new Set(
        [data.agentId ?? null, ...(records ?? []).map((r: any) => r.assigned_agent_id)].filter(
          Boolean,
        ) as string[],
      ),
    );
    let agentsById: Record<string, { id: string; retell_agent_id: string | null; name: string; settings: Record<string, unknown> | null }> = {};
    if (agentIds.length) {
      const { data: ags, error: aErr } = await sb
        .from("agents")
        .select("id, retell_agent_id, name, settings")
        .in("id", agentIds);
      if (aErr) throw new Error(aErr.message);
      agentsById = Object.fromEntries((ags ?? []).map((a: any) => [a.id, { ...a, settings: a.settings ?? null }]));
    }

    // Preload per-agent production Retell keys from agent_retell_secrets.
    // These are stored when the user clones an agent to their client workspace.
    const agentKeyByDbId: Record<string, string> = {};
    if (agentIds.length && userId) {
      const { data: secrets } = await (supabaseAdmin as any)
        .from("agent_retell_secrets")
        .select("agent_id, production_api_key")
        .in("agent_id", agentIds)
        .eq("user_id", userId);
      for (const s of (secrets ?? []) as Array<{ agent_id: string; production_api_key: string | null }>) {
        const k = s.production_api_key?.trim();
        if (k?.startsWith("key_")) agentKeyByDbId[s.agent_id] = k;
      }
    }

    let queued = 0;
    let placed = 0;
    let failed = 0;
    const errors: { recordId: string; message: string }[] = [];

    // Read workspace settings: call schedule + per-client Retell API key
    const { data: wsSettings } = await sb
      .from("workspace_settings")
      .select("call_schedule, retell_workspace_id")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const callSchedule = (wsSettings?.call_schedule ?? {}) as Record<string, unknown>;
    const maxDailyAttempts = typeof callSchedule.maxDailyAttempts === "number"
      ? callSchedule.maxDailyAttempts
      : null;
    // Per-client Retell key (stored by admin during workspace approval)
    const clientRetellKey = (wsSettings as any)?.retell_workspace_id?.trim() || undefined;

    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD UTC

    for (const r of records ?? []) {
      const useAgentId = (data.agentId ?? r.assigned_agent_id) as string | null;
      const agent = useAgentId ? agentsById[useAgentId] : null;
      // Resolve the correct Retell agent ID + API key pair.
      // - deployedRetellAgentId → agent lives in client's Retell workspace → use client key
      // - retell_agent_id only  → agent lives in the platform workspace   → use platform key
      const agentSettings = (agent as any)?.settings as Record<string, unknown> | null;
      const deployedRetellAgentId =
        (agentSettings?.deployedRetellAgentId as string | undefined) ?? null;
      const retellAgentId = deployedRetellAgentId ?? agent?.retell_agent_id ?? null;
      // Resolve the right Retell API key when agent is in a client workspace:
      //   1. workspace_settings.retell_workspace_id (admin-provisioned)
      //   2. agent_retell_secrets.production_api_key (stored during clone)
      const resolvedClientKey = clientRetellKey || (useAgentId ? agentKeyByDbId[useAgentId] : undefined) || undefined;
      const retellApiKey = deployedRetellAgentId ? resolvedClientKey : undefined;

      // Enforce max daily call attempts from campaign schedule settings
      if (maxDailyAttempts != null && maxDailyAttempts > 0) {
        const meta = (r.meta ?? {}) as Record<string, unknown>;
        const lastCallDate = meta._lastCallDate as string | undefined;
        const dailyAttempts = lastCallDate === today
          ? (typeof meta._dailyAttempts === "number" ? meta._dailyAttempts : Number(meta._dailyAttempts ?? 0))
          : 0;
        if (dailyAttempts >= maxDailyAttempts) {
          errors.push({ recordId: r.id, message: `Daily call limit (${maxDailyAttempts}) reached` });
          failed += 1;
          continue;
        }
      }

      if (!retellAgentId || !data.fromNumber) {
        const { error: uErr } = await sb
          .from("data_records")
          .update({
            call_status: "queued",
            assigned_agent_id: useAgentId,
          })
          .eq("id", r.id)
          .eq("workspace_id", workspaceId);
        if (uErr) failed += 1;
        else queued += 1;
        continue;
      }

      try {
        // Build Retell dynamic variables from the agent's lead gen variable mappings
        const leadGenSettings = agentSettings?.leadGen as Record<string, unknown> | undefined;
        const variableMappings = leadGenSettings?.variableMappings as Record<string, string> | undefined;

        const retellDynamicVars: Record<string, string> = {};
        if (variableMappings && Object.keys(variableMappings).length > 0) {
          for (const [placeholder, colRef] of Object.entries(variableMappings)) {
            let val: string | null = null;
            if (colRef.startsWith("meta.")) {
              // meta.someKey → read from record.meta object
              const metaKey = colRef.slice(5);
              const meta = r.meta as Record<string, unknown> | null;
              val = meta?.[metaKey] != null ? String(meta[metaKey]) : null;
            } else {
              // Fixed DB column
              val = r[colRef] != null ? String(r[colRef]) : null;
            }
            if (val) retellDynamicVars[placeholder] = val;
          }
        }

        const callPayload: Record<string, unknown> = {
          from_number: data.fromNumber,
          to_number: r.mobile_number,
          override_agent_id: retellAgentId,
          metadata: { data_record_id: r.id, workspace_id: workspaceId },
        };
        if (Object.keys(retellDynamicVars).length > 0) {
          callPayload.retell_llm_dynamic_variables = retellDynamicVars;
        }

        const call = await retellFetch<any>("/v2/create-phone-call", callPayload, "POST", retellApiKey);

        // Increment daily attempt counter in meta
        const currentMeta = (r.meta ?? {}) as Record<string, unknown>;
        const lastCallDate = currentMeta._lastCallDate as string | undefined;
        const priorAttempts = lastCallDate === today
          ? (typeof currentMeta._dailyAttempts === "number" ? currentMeta._dailyAttempts : Number(currentMeta._dailyAttempts ?? 0))
          : 0;
        const updatedMeta = { ...currentMeta, _lastCallDate: today, _dailyAttempts: priorAttempts + 1 };

        await sb
          .from("data_records")
          .update({
            call_status: "calling",
            assigned_agent_id: useAgentId,
            meta: updatedMeta,
          })
          .eq("id", r.id)
          .eq("workspace_id", workspaceId);
        await sb.from("calls").insert({
          workspace_id: workspaceId,
          retell_call_id: call?.call_id ?? null,
          agent_id: retellAgentId,
          agent_name: agent?.name ?? null,
          from_number: data.fromNumber,
          to_number: r.mobile_number,
          call_type: "outbound",
          call_status: "initiated",
        });
        placed += 1;
      } catch (e: any) {
        failed += 1;
        errors.push({ recordId: r.id, message: e?.message ?? "Retell call failed" });
        await sb
          .from("data_records")
          .update({ call_status: "failed" })
          .eq("id", r.id)
          .eq("workspace_id", workspaceId);
      }
    }

    return { placed, queued, failed, errors };
  });

/** Fixed DB columns present on every data_record row */
const FIXED_COLUMNS: Array<{ value: string; label: string }> = [
  { value: "name", label: "Full Name" },
  { value: "mobile_number", label: "Mobile Number" },
  { value: "first_name", label: "First Name" },
  { value: "last_name", label: "Last Name" },
  { value: "email", label: "Email" },
  { value: "title", label: "Title" },
  { value: "client_name", label: "Client Name" },
  { value: "unique_id", label: "Unique ID" },
  { value: "property_type", label: "Property Type" },
  { value: "bedrooms", label: "Bedrooms" },
  { value: "address_line1", label: "Address Line 1" },
  { value: "address_line2", label: "Address Line 2" },
  { value: "city", label: "City" },
  { value: "state", label: "State" },
  { value: "postal_code", label: "Postal Code" },
  { value: "lead_external_id", label: "Lead External ID" },
];

/**
 * Samples up to 50 data records to discover which fixed columns and `meta`
 * keys actually have data in this workspace.
 *
 * If agentRowId is supplied it filters to records assigned to that agent
 * (the "master CSV" for that agent). Falls back to all workspace records
 * so the dropdown is never empty when records exist.
 */
export const getDataRecordSchema = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ agentRowId: z.string().uuid().nullable().optional() }).parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;

    // 1. Try records assigned to this agent first
    let rows: Array<Record<string, unknown>> = [];
    if (data.agentRowId) {
      const { data: agentRows } = await sb
        .from("data_records")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("assigned_agent_id", data.agentRowId)
        .limit(50);
      rows = (agentRows ?? []) as Array<Record<string, unknown>>;
    }

    // 2. Fall back to all workspace records (catches unassigned CSVs)
    if (rows.length === 0) {
      const { data: allRows } = await sb
        .from("data_records")
        .select("*")
        .eq("workspace_id", workspaceId)
        .limit(50);
      rows = (allRows ?? []) as Array<Record<string, unknown>>;
    }

    // Which fixed columns have at least one non-empty value?
    const usedFixed = FIXED_COLUMNS.filter((col) =>
      rows.some((r) => r[col.value] != null && r[col.value] !== ""),
    );
    const fixedCols = usedFixed.length > 0 ? usedFixed : FIXED_COLUMNS;

    // Collect all meta keys across sampled rows
    const metaKeys = new Set<string>();
    for (const row of rows) {
      const meta = row.meta as Record<string, unknown> | null;
      if (meta && typeof meta === "object") {
        for (const k of Object.keys(meta)) metaKeys.add(k);
      }
    }
    const metaCols = Array.from(metaKeys)
      .sort()
      .map((k) => ({ value: `meta.${k}`, label: k, isMeta: true }));

    return {
      fixed: fixedCols.map((c) => ({ ...c, isMeta: false })),
      meta: metaCols,
      totalRecords: rows.length,
    };
  });

export const importDataRecords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        rows: z.array(DataRowSchema).min(1).max(5000),
        agentId: z.string().uuid().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;

    // Deduplicate within the incoming batch itself first (same number repeated in CSV)
    const batchSeen = new Set<string>();
    const uniqueRows = data.rows.filter((r) => {
      const key = r.mobile_number.trim();
      if (batchSeen.has(key)) return false;
      batchSeen.add(key);
      return true;
    });

    // Fetch all existing mobile numbers for this workspace so we can skip them
    const { data: existingRows, error: existErr } = await sb
      .from("data_records")
      .select("mobile_number")
      .eq("workspace_id", workspaceId)
      .eq("is_deleted", false);
    if (existErr) throw new Error(existErr.message);
    const existingNumbers = new Set<string>(
      (existingRows ?? []).map((r: any) => (r.mobile_number ?? "").trim()),
    );

    const newRows = uniqueRows.filter((r) => !existingNumbers.has(r.mobile_number.trim()));
    if (newRows.length === 0) return { inserted: 0, skipped: uniqueRows.length };

    const payload = newRows.map((r) => ({
      workspace_id: workspaceId,
      name: r.name,
      mobile_number: r.mobile_number,
      first_name: r.first_name || null,
      last_name: r.last_name || null,
      email: r.email || null,
      title: r.title || null,
      client_name: r.client_name || null,
      unique_id: r.unique_id || null,
      property_type: r.property_type || null,
      bedrooms: r.bedrooms || null,
      address_line1: r.address_line1 || null,
      address_line2: r.address_line2 || null,
      city: r.city || null,
      state: r.state || null,
      postal_code: r.postal_code || null,
      lead_external_id: r.lead_external_id || null,
      meta: r.meta && Object.keys(r.meta).length > 0 ? r.meta : {},
      ...(data.agentId ? { assigned_agent_id: data.agentId } : {}),
    }));
    const CHUNK = 1000;
    let inserted = 0;
    for (let i = 0; i < payload.length; i += CHUNK) {
      const slice = payload.slice(i, i + CHUNK);
      const { error, count } = await sb.from("data_records").insert(slice, { count: "exact" });
      if (error) throw new Error(`Chunk ${i / CHUNK + 1}: ${error.message}`);
      inserted += count ?? slice.length;
    }
    return { inserted, skipped: uniqueRows.length - newRows.length };
  });

export type QualifiedLeadRow = {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  sentiment: string | null;
  status: string | null;
  source: string | null;
  created_at: string | null;
};

export const fetchQualifiedLeads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({}).parse(input ?? {}))
  .handler(async ({ context }): Promise<QualifiedLeadRow[]> => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");

    const { data, error } = await (supabaseAdmin as any)
      .from("leads")
      .select("id, full_name, phone, email, sentiment, status, source, created_at")
      .eq("workspace_id", workspaceId)
      .eq("sentiment", "positive")
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) throw new Error(error.message);
    return (data ?? []) as QualifiedLeadRow[];
  });

export type CrmPersonRow = {
  external_id: string;
  name: string;
  phone: string;
  email: string;
  source: string;
  created_at: string;
  status: string;
};

export const fetchCrmPeople = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({}).parse(input ?? {}))
  .handler(async ({ context }): Promise<CrmPersonRow[]> => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No active workspace");

    const { data: settings, error: sErr } = await (supabaseAdmin as any)
      .from("workspace_settings")
      .select("webespoke_api_key, webespoke_api_url, hubspot_api_key, ghl_api_key, ghl_location_id")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (sErr) throw new Error(sErr.message);

    const wsKey = ((settings?.webespoke_api_key as string | undefined) ?? "").trim();
    const wsUrl = ((settings?.webespoke_api_url as string | undefined) ?? "").trim();
    const hsKey = ((settings?.hubspot_api_key as string | undefined) ?? "").trim();
    const ghlKey = ((settings?.ghl_api_key as string | undefined) ?? "").trim();
    const ghlLoc = ((settings?.ghl_location_id as string | undefined) ?? "").trim();

    let raw: any[] = [];

    if (wsKey && wsUrl) {
      const base = wsUrl.replace(/\/$/, "");
      const res = await fetch(`${base}/api/crm/leads`, {
        headers: { Authorization: `Bearer ${wsKey}`, "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`WeeBespoke CRM returned ${res.status}: ${body.slice(0, 200)}`);
      }
      const json = await res.json();
      raw = Array.isArray(json) ? json : (Array.isArray(json?.leads) ? json.leads : []);
    } else if (hsKey) {
      const res = await fetch(
        "https://api.hubapi.com/crm/v3/objects/contacts?limit=100&properties=firstname,lastname,phone,email,hs_lead_status,createdate,hs_analytics_source",
        { headers: { Authorization: `Bearer ${hsKey}`, "Content-Type": "application/json" } },
      );
      if (!res.ok) throw new Error(`HubSpot returned ${res.status}`);
      const json = await res.json();
      raw = (json.results ?? []).map((c: any) => ({
        external_id: c.id,
        name: [c.properties?.firstname, c.properties?.lastname].filter(Boolean).join(" ") || c.id,
        phone: c.properties?.phone ?? "",
        email: c.properties?.email ?? "",
        source: c.properties?.hs_analytics_source ?? "HubSpot",
        status: c.properties?.hs_lead_status ?? "",
        created_at: c.properties?.createdate ?? "",
      }));
    } else if (ghlKey && ghlLoc) {
      const res = await fetch(
        `https://services.leadconnectorhq.com/contacts/?locationId=${ghlLoc}&limit=100`,
        { headers: { Authorization: `Bearer ${ghlKey}`, Version: "2021-07-28", "Content-Type": "application/json" } },
      );
      if (!res.ok) throw new Error(`GHL returned ${res.status}`);
      const json = await res.json();
      raw = (json.contacts ?? []).map((c: any) => ({
        external_id: c.id,
        name: c.contactName ?? ([c.firstName, c.lastName].filter(Boolean).join(" ") || c.id),
        phone: c.phone ?? "",
        email: c.email ?? "",
        source: c.source ?? "GoHighLevel",
        status: c.tags?.join(", ") ?? "",
        created_at: c.dateAdded ?? "",
      }));
    } else {
      throw new Error("No CRM connected. Go to Settings → CRM to connect WeeBespoke, HubSpot, or GoHighLevel.");
    }

    return raw.map((l: any) => ({
      external_id: String(l.external_id ?? l.id ?? ""),
      name: String(l.name ?? l.full_name ?? l.contact_name ?? "").trim(),
      phone: String(l.phone ?? l.mobile ?? l.mobile_number ?? "").trim(),
      email: String(l.email ?? "").trim(),
      source: String(l.source ?? l.lead_source ?? "CRM").trim(),
      created_at: String(l.created_at ?? l.date_added ?? l.dateAdded ?? ""),
      status: String(l.status ?? l.lead_status ?? "").trim(),
    })).filter((l) => l.name || l.phone);
  });
