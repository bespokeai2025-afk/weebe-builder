import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createTelephonyProvider } from "./provider-factory";
import type { TelephonyConfig } from "./types";

// ── Telephony Config ───────────────────────────────────────────────────────────

export const getTelephonyConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const { data, error } = await supabaseAdmin
      .from("telephony_configs")
      .select("*")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return {
      ...data,
      auth_token: data.auth_token ? "••••••••" : null,
      api_secret: data.api_secret ? "••••••••" : null,
    };
  });

export const saveTelephonyConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        provider: z.enum(["twilio", "telnyx", "plivo", "vonage"]).default("twilio"),
        account_sid: z.string().min(1),
        auth_token: z.string().optional(),
        api_key: z.string().optional(),
        api_secret: z.string().optional(),
        is_active: z.boolean().default(true),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");

    const existing = await supabaseAdmin
      .from("telephony_configs")
      .select("id, auth_token, api_secret")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    const payload: Record<string, unknown> = {
      workspace_id: workspaceId,
      provider: data.provider,
      account_sid: data.account_sid,
      is_active: data.is_active,
      updated_at: new Date().toISOString(),
    };
    if (data.api_key) payload.api_key = data.api_key;

    if (data.auth_token && !data.auth_token.startsWith("•")) {
      payload.auth_token = data.auth_token;
    } else if (existing.data?.auth_token) {
      payload.auth_token = existing.data.auth_token;
    }

    if (data.api_secret && !data.api_secret.startsWith("•")) {
      payload.api_secret = data.api_secret;
    } else if (existing.data?.api_secret) {
      payload.api_secret = existing.data.api_secret;
    }

    if (existing.data?.id) {
      const { error } = await supabaseAdmin
        .from("telephony_configs")
        .update(payload)
        .eq("id", existing.data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin
        .from("telephony_configs")
        .insert(payload);
      if (error) throw new Error(error.message);
    }

    return { success: true };
  });

// ── Phone Numbers ──────────────────────────────────────────────────────────────

export const listPhoneNumbers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const { data, error } = await supabaseAdmin
      .from("phone_numbers")
      .select("*, agent:agents(id, name)")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const savePhoneNumber = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid().optional(),
        phone_number: z.string().min(1),
        friendly_name: z.string().optional(),
        provider: z.enum(["twilio", "telnyx", "plivo", "vonage"]).default("twilio"),
        provider_sid: z.string().optional(),
        agent_id: z.string().uuid().nullable().optional(),
        capabilities: z
          .object({ voice: z.boolean(), sms: z.boolean() })
          .default({ voice: true, sms: false }),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");

    const config = await supabaseAdmin
      .from("telephony_configs")
      .select("id")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (data.id) {
      const { error } = await supabaseAdmin
        .from("phone_numbers")
        .update({
          friendly_name: data.friendly_name,
          agent_id: data.agent_id,
          capabilities: data.capabilities,
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.id)
        .eq("workspace_id", workspaceId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin
        .from("phone_numbers")
        .insert({
          workspace_id: workspaceId,
          telephony_config_id: config.data?.id ?? null,
          phone_number: data.phone_number,
          friendly_name: data.friendly_name,
          provider: data.provider,
          provider_sid: data.provider_sid,
          agent_id: data.agent_id,
          capabilities: data.capabilities,
        });
      if (error) throw new Error(error.message);
    }

    return { success: true };
  });

export const deletePhoneNumber = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input ?? {}))
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const { error } = await supabaseAdmin
      .from("phone_numbers")
      .delete()
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return { success: true };
  });

// ── Telephony Calls ────────────────────────────────────────────────────────────

export const listTelephonyCalls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        direction: z.enum(["inbound", "outbound"]).optional(),
        status: z.string().optional(),
        limit: z.number().int().min(1).max(500).default(100),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");

    let q = (supabaseAdmin as any)
      .from("telephony_calls")
      .select("*, phone_number:phone_numbers(phone_number,friendly_name), agent:agents(id,name)")
      .eq("workspace_id", workspaceId)
      .order("started_at", { ascending: false, nullsFirst: false })
      .limit(data.limit);

    if (data.direction) q = q.eq("direction", data.direction);
    if (data.status && data.status !== "all") q = q.eq("status", data.status);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// ── Outbound call initiation ───────────────────────────────────────────────────

export const initiateOutboundCall = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        to: z.string().min(1),
        phone_number_id: z.string().uuid(),
        agent_id: z.string().uuid().optional(),
        campaign_id: z.string().uuid().optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");

    const [configRes, numRes] = await Promise.all([
      supabaseAdmin
        .from("telephony_configs")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("is_active", true)
        .maybeSingle(),
      supabaseAdmin
        .from("phone_numbers")
        .select("*")
        .eq("id", data.phone_number_id)
        .eq("workspace_id", workspaceId)
        .single(),
    ]);

    if (!configRes.data) throw new Error("No active telephony configuration. Set up your provider in Telephony Settings.");
    if (!numRes.data) throw new Error("Phone number not found.");

    const { data: callRow, error: insertErr } = await supabaseAdmin
      .from("telephony_calls")
      .insert({
        workspace_id: workspaceId,
        phone_number_id: data.phone_number_id,
        agent_id: data.agent_id ?? numRes.data.agent_id,
        campaign_id: data.campaign_id,
        direction: "outbound",
        from_number: numRes.data.phone_number,
        to_number: data.to,
        status: "initiated",
        provider: configRes.data.provider,
      })
      .select("id")
      .single();

    if (insertErr) throw new Error(insertErr.message);

    const host = process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : process.env.PUBLIC_URL ?? "https://localhost:3000";

    const provider = createTelephonyProvider(configRes.data as TelephonyConfig);

    const callResult = await provider.makeCall({
      to: data.to,
      from: numRes.data.phone_number,
      statusCallbackUrl: `${host}/api/public/telephony/status`,
      streamUrl: `wss://${new URL(host).host}/api/telephony/stream/${callRow.id}`,
    });

    await supabaseAdmin
      .from("telephony_calls")
      .update({ call_sid: callResult.callSid, status: callResult.status })
      .eq("id", callRow.id);

    await supabaseAdmin.from("call_events").insert({
      call_id: callRow.id,
      workspace_id: workspaceId,
      event_type: "status_change",
      event_data: { from: "initiated", to: callResult.status },
    });

    return { callId: callRow.id, callSid: callResult.callSid, status: callResult.status };
  });

// ── Campaigns ─────────────────────────────────────────────────────────────────

export const listCampaigns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const { data, error } = await (supabaseAdmin as any)
      .from("campaigns")
      .select("*, agent:agents(id,name), phone_number:phone_numbers(phone_number,friendly_name)")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const saveCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid().optional(),
        name: z.string().min(1),
        description: z.string().optional(),
        agent_id: z.string().uuid().nullable().optional(),
        phone_number_id: z.string().uuid().nullable().optional(),
        targets: z
          .array(z.object({ phone: z.string(), name: z.string().optional() }))
          .default([]),
        schedule_config: z.record(z.unknown()).optional(),
        retry_config: z
          .object({ max_attempts: z.number(), retry_delay_minutes: z.number() })
          .default({ max_attempts: 3, retry_delay_minutes: 60 }),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");

    if (data.id) {
      const { error } = await supabaseAdmin
        .from("campaigns")
        .update({
          name: data.name,
          description: data.description,
          agent_id: data.agent_id,
          phone_number_id: data.phone_number_id,
          targets: data.targets,
          schedule_config: data.schedule_config ?? {},
          retry_config: data.retry_config,
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.id)
        .eq("workspace_id", workspaceId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin
        .from("campaigns")
        .insert({
          workspace_id: workspaceId,
          name: data.name,
          description: data.description,
          agent_id: data.agent_id,
          phone_number_id: data.phone_number_id,
          targets: data.targets,
          schedule_config: data.schedule_config ?? {},
          retry_config: data.retry_config,
          stats: { total: data.targets.length, called: 0, answered: 0, booked: 0, failed: 0 },
        });
      if (error) throw new Error(error.message);
    }

    return { success: true };
  });

export const updateCampaignStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["draft", "active", "paused", "completed", "cancelled"]),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const { error } = await supabaseAdmin
      .from("campaigns")
      .update({ status: data.status, updated_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return { success: true };
  });

export const deleteCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input ?? {}))
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const { error } = await supabaseAdmin
      .from("campaigns")
      .delete()
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return { success: true };
  });
