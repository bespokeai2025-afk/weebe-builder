/**
 * Auto Dialer — user-facing server functions.
 *
 * Dials a list of real numbers one at a time; when one answers, rings 2 real
 * people simultaneously and bridges the call to whichever picks up first.
 * The actual dialling and queue advancement lives in `auto-dialer-engine.server`
 * and the `dialer-*` webhook routes — these functions only create/control a
 * session on behalf of the signed-in user.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  isValidE164,
  toE164,
  validateRouteNumbers,
  type DialerSessionStatus,
} from "./auto-dialer.shared";
import { dialNextDialerTarget } from "./auto-dialer-engine.server";

const targetInputSchema = z.object({
  name: z.string().trim().max(200).nullable().optional(),
  phone: z.string().trim().min(6).max(20),
});

/**
 * Resolve the number this workspace's dialer calls out from.
 *
 * Prefers an explicit choice; otherwise the workspace's first active number.
 * Distinct from `resolveFromNumber` in native-outbound.server, which prefers
 * an *agent's* own number — this dialer has no agent, just a workspace.
 */
async function resolveWorkspaceFromNumber(
  sb: any,
  workspaceId: string,
  requested?: string | null,
): Promise<string> {
  if (requested) {
    const { data } = await sb
      .from("phone_numbers")
      .select("phone_number")
      .eq("workspace_id", workspaceId)
      .eq("phone_number", requested)
      .eq("is_active", true)
      .maybeSingle();
    if (data?.phone_number) return data.phone_number as string;
    throw new Error(`"${requested}" isn't an active number on this workspace.`);
  }

  const { data } = await sb
    .from("phone_numbers")
    .select("phone_number")
    .eq("workspace_id", workspaceId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (!data?.phone_number) {
    throw new Error(
      "No active phone number for this workspace — add one under Telephony → Phone Numbers before starting the dialer.",
    );
  }
  return data.phone_number as string;
}

interface CreateSessionInput {
  name: string;
  routeNumbers: string[];
  targets: Array<{ name?: string | null; phone: string }>;
  fromNumber?: string;
  ringTimeoutSecs?: number;
}

/**
 * Insert a session + its targets. Shared by the bulk-list form and the
 * single-lead quick call — a quick call is just a run with one target that
 * starts itself immediately.
 */
async function insertDialerSessionWithTargets(
  supabase: any,
  workspaceId: string,
  userId: string | null,
  input: CreateSessionInput,
): Promise<{ sessionId: string; targetCount: number }> {
  const routeCheck = validateRouteNumbers(input.routeNumbers);
  if (!routeCheck.ok) throw new Error(routeCheck.error!);

  const invalidTargets = input.targets.filter((t) => !isValidE164(t.phone));
  if (invalidTargets.length > 0) {
    throw new Error(
      `${invalidTargets.length} number(s) aren't valid E.164 phone numbers (e.g. "${invalidTargets[0].phone}") — fix them before creating the run.`,
    );
  }

  const fromNumber = await resolveWorkspaceFromNumber(supabase, workspaceId, input.fromNumber);

  const { data: session, error: sessionErr } = await supabase
    .from("dialer_sessions")
    .insert({
      workspace_id: workspaceId,
      created_by: userId,
      name: input.name,
      status: "draft",
      from_number: fromNumber,
      route_numbers: input.routeNumbers,
      ring_timeout_secs: input.ringTimeoutSecs ?? 20,
      stats: { total: input.targets.length, dialed: 0, bridged: 0, no_answer: 0, failed: 0 },
    })
    .select("id")
    .single();
  if (sessionErr) throw new Error(sessionErr.message);

  const rows = input.targets.map((t, i) => ({
    session_id: session.id,
    workspace_id: workspaceId,
    position: i,
    name: t.name || null,
    phone: t.phone,
    status: "pending" as const,
  }));

  // Chunked: a 2000-row insert in one call risks the request body / statement
  // limits that the WhatsApp bulk-delete work in this codebase already hit.
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from("dialer_targets").insert(rows.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }

  return { sessionId: session.id as string, targetCount: rows.length };
}

export const createDialerSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        name: z.string().trim().min(1).max(200),
        routeNumbers: z.array(z.string().trim()).min(1).max(2),
        targets: z.array(targetInputSchema).min(1).max(2000),
        fromNumber: z.string().trim().optional(),
        ringTimeoutSecs: z.number().int().min(5).max(60).optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId, userId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    const result = await insertDialerSessionWithTargets(supabase, workspaceId, userId ?? null, data);
    return { ok: true, ...result };
  });

/**
 * Build a dialer run straight from uploaded Data records — the Admin → Data
 * page's own selection, rather than pasting or re-uploading a separate list.
 * Numbers and names are read server-side from `data_records` so the client
 * only ever sends the record ids it already had selected.
 */
export const createDialerSessionFromDataRecords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        recordIds: z.array(z.string().uuid()).min(1).max(2000),
        routeNumbers: z.array(z.string().trim()).min(1).max(2),
        name: z.string().trim().max(200).optional(),
        fromNumber: z.string().trim().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId, userId } = context as any;
    if (!workspaceId) throw new Error("No workspace");

    const { data: rows, error } = await supabase
      .from("data_records")
      .select("id, name, mobile_number")
      .eq("workspace_id", workspaceId)
      .in("id", data.recordIds);
    if (error) throw new Error(error.message);
    if (!rows || rows.length === 0) throw new Error("None of the selected records could be found.");

    const targets: Array<{ name: string | null; phone: string }> = [];
    let skipped = 0;
    for (const row of rows) {
      const phone = toE164(row.mobile_number);
      if (!phone) {
        skipped++;
        continue;
      }
      targets.push({ name: row.name ?? null, phone });
    }
    if (targets.length === 0) {
      throw new Error(
        "None of the selected records have a phone number that could be dialled — check the Mobile Number column.",
      );
    }

    const result = await insertDialerSessionWithTargets(supabase, workspaceId, userId ?? null, {
      name: data.name?.trim() || `Data upload — ${new Date().toLocaleDateString()}`,
      routeNumbers: data.routeNumbers,
      targets,
      fromNumber: data.fromNumber,
    });

    return { ok: true, ...result, skipped };
  });

/**
 * Dial one person right now, via the phone icon beside a lead — no list, no
 * "start" step. Creates a single-target run and starts it in the same call.
 */
export const startQuickDialerCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        name: z.string().trim().max(200).nullable().optional(),
        phone: z.string().trim().min(6).max(20),
        routeNumbers: z.array(z.string().trim()).min(1).max(2),
        fromNumber: z.string().trim().optional(),
        saveAsDefault: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId, userId } = context as any;
    if (!workspaceId) throw new Error("No workspace");

    const { sessionId } = await insertDialerSessionWithTargets(supabase, workspaceId, userId ?? null, {
      name: `Quick call: ${data.name?.trim() || data.phone}`,
      routeNumbers: data.routeNumbers,
      targets: [{ name: data.name ?? null, phone: data.phone }],
      fromNumber: data.fromNumber,
    });

    if (data.saveAsDefault) {
      await supabase
        .from("workspace_settings")
        .update({ dialer_default_route_numbers: data.routeNumbers })
        .eq("workspace_id", workspaceId);
    }

    await setSessionStatus(supabase, workspaceId, sessionId, ["draft"], "running");
    await dialNextDialerTarget(supabase, sessionId);

    return { ok: true, sessionId };
  });

export const getDialerQuickCallDefaults = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    const { data } = await supabase
      .from("workspace_settings")
      .select("dialer_default_route_numbers")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const saved = (data?.dialer_default_route_numbers ?? null) as string[] | null;
    return { routeNumbers: saved && saved.length >= 1 && saved.length <= 2 ? saved : null };
  });

export const listDialerSessions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    const { data, error } = await supabase
      .from("dialer_sessions")
      .select("id, name, status, from_number, route_numbers, stats, created_at, updated_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return { sessions: data ?? [] };
  });

export const getDialerSession = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ sessionId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context as any;
    if (!workspaceId) throw new Error("No workspace");

    const { data: session, error } = await supabase
      .from("dialer_sessions")
      .select("id, name, status, from_number, route_numbers, ring_timeout_secs, stats, created_at, updated_at")
      .eq("id", data.sessionId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!session) throw new Error("Dialer run not found");

    const { data: targets, error: targetsErr } = await supabase
      .from("dialer_targets")
      .select(
        "id, position, name, phone, status, call_sid, bridged_number, duration_secs, started_at, ended_at, error_message",
      )
      .eq("session_id", data.sessionId)
      .order("position", { ascending: true })
      .limit(2000);
    if (targetsErr) throw new Error(targetsErr.message);

    return { session, targets: targets ?? [] };
  });

async function setSessionStatus(
  supabase: any,
  workspaceId: string,
  sessionId: string,
  from: DialerSessionStatus[],
  to: DialerSessionStatus,
) {
  const { data, error } = await supabase
    .from("dialer_sessions")
    .update({ status: to, updated_at: new Date().toISOString() })
    .eq("id", sessionId)
    .eq("workspace_id", workspaceId)
    .in("status", from)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Run isn't in a state that can be ${to === "running" ? "started" : to}.`);
}

export const startDialerSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ sessionId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    await setSessionStatus(supabase, workspaceId, data.sessionId, ["draft", "paused"], "running");
    await dialNextDialerTarget(supabase, data.sessionId);
    return { ok: true };
  });

export const pauseDialerSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ sessionId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    // The call currently in flight is not interrupted — Pause only stops the
    // *next* dial. Interrupting a live human conversation mid-call would be a
    // far more surprising thing for this button to do.
    await setSessionStatus(supabase, workspaceId, data.sessionId, ["running"], "paused");
    return { ok: true };
  });

export const cancelDialerSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ sessionId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    await setSessionStatus(
      supabase,
      workspaceId,
      data.sessionId,
      ["draft", "running", "paused"],
      "cancelled",
    );
    return { ok: true };
  });

export const deleteDialerSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ sessionId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    const { data: session } = await supabase
      .from("dialer_sessions")
      .select("status")
      .eq("id", data.sessionId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (session?.status === "running") {
      throw new Error("Pause or cancel this run before deleting it.");
    }
    const { error } = await supabase
      .from("dialer_sessions")
      .delete()
      .eq("id", data.sessionId)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listWorkspacePhoneNumbers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context as any;
    if (!workspaceId) throw new Error("No workspace");
    const { data, error } = await supabase
      .from("phone_numbers")
      .select("id, phone_number, friendly_name")
      .eq("workspace_id", workspaceId)
      .eq("is_active", true)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    return { numbers: data ?? [] };
  });
