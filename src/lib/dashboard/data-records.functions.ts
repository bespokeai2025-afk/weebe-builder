import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { retellFetch } from "@/lib/providers/retell/client.server";

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
          .enum(["all", "needs_to_call", "queued", "calling", "completed", "failed", "do_not_call"])
          .optional(),
        assignedAgentId: z.string().uuid().nullable().optional(),
        unassignedOnly: z.boolean().optional(),
        limit: z.number().int().min(1).max(2000).default(500),
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
    return rows ?? [];
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
      status: z.enum(["needs_to_call", "queued", "calling", "completed", "failed", "do_not_call"]),
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

export const startCallingRecords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    RecordIdsSchema.extend({
      agentId: z.string().uuid().nullable().optional(),
      fromNumber: z.string().min(3).max(32).nullable().optional(),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;

    const { data: records, error } = await sb
      .from("data_records")
      .select("id, mobile_number, assigned_agent_id, name, first_name, last_name, email, title, client_name, unique_id, property_type, bedrooms, address_line1, address_line2, city, state, postal_code, lead_external_id, notes, meta")
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
    let agentsById: Record<string, { retell_agent_id: string | null; name: string; settings: Record<string, unknown> | null }> = {};
    if (agentIds.length) {
      const { data: ags, error: aErr } = await sb
        .from("agents")
        .select("id, retell_agent_id, name, settings")
        .in("id", agentIds);
      if (aErr) throw new Error(aErr.message);
      agentsById = Object.fromEntries((ags ?? []).map((a: any) => [a.id, { ...a, settings: a.settings ?? null }]));
    }

    let queued = 0;
    let placed = 0;
    let failed = 0;
    const errors: { recordId: string; message: string }[] = [];

    for (const r of records ?? []) {
      const useAgentId = (data.agentId ?? r.assigned_agent_id) as string | null;
      const agent = useAgentId ? agentsById[useAgentId] : null;
      const retellAgentId = agent?.retell_agent_id ?? null;

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
        const agentSettings = (agent as any)?.settings as Record<string, unknown> | null;
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

        const call = await retellFetch<any>("/v2/create-phone-call", callPayload, "POST");
        await sb
          .from("data_records")
          .update({
            call_status: "calling",
            assigned_agent_id: useAgentId,
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
  { value: "notes", label: "Notes" },
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

    const COLS =
      "name,mobile_number,first_name,last_name,email,title,client_name,unique_id,property_type,bedrooms,address_line1,address_line2,city,state,postal_code,lead_external_id,notes,meta";

    // 1. Try records assigned to this agent first
    let rows: Array<Record<string, unknown>> = [];
    if (data.agentRowId) {
      const { data: agentRows } = await sb
        .from("data_records")
        .select(COLS)
        .eq("workspace_id", workspaceId)
        .eq("assigned_agent_id", data.agentRowId)
        .limit(50);
      rows = (agentRows ?? []) as Array<Record<string, unknown>>;
    }

    // 2. Fall back to all workspace records (catches unassigned CSVs)
    if (rows.length === 0) {
      const { data: allRows } = await sb
        .from("data_records")
        .select(COLS)
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

    const payload = data.rows.map((r) => ({
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
    return { inserted };
  });
