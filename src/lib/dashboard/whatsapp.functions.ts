import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import twilio from "twilio";
import {
  buildWatiTemplateParams,
  findLeadByPhone,
  getWatiConnectionForWorkspace,
  normalizeWhatsAppPhone,
  phoneTail,
  resolveCampaignAudienceLeads,
  sendWatiTemplateMessage,
  sendWatiTemplateMessagesBatch,
  type CampaignAudienceFilter,
} from "@/lib/whatsapp/wati-campaign.server";
import type { CsvLeadRow } from "@/lib/whatsapp/csv-leads.shared";
import {
  extractWatiTemplateParamSlots,
  validateWatiTemplateParamMapping,
} from "@/lib/whatsapp/wati-template-params.shared";
import { assertNotWbahWorkspace } from "@/lib/wbah-exclusion.shared";
import {
  forceSyncWatiCampaigns,
  maybeAutoSyncWatiCampaigns,
} from "@/lib/whatsapp/wati-sync.server";
import { reconcileWatiOutboundMessageStatuses } from "@/lib/whatsapp/wati-message-status.server";

// ── Inbox ─────────────────────────────────────────────────────────────────────

export const listWhatsappThreads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;

    const { data, error } = await sb
      .from("whatsapp_messages")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("sent_at", { ascending: false })
      .limit(1000);
    if (error) throw new Error(error.message);

    const threads = new Map<string, {
      phone: string; name: string | null; lastMessage: string | null;
      lastAt: string; unread: number; messages: any[];
    }>();
    for (const m of (data ?? []) as any[]) {
      const ex = threads.get(m.contact_phone);
      if (!ex) {
        threads.set(m.contact_phone, {
          phone: m.contact_phone, name: m.contact_name,
          lastMessage: m.body, lastAt: m.sent_at, unread: 0, messages: [m],
        });
      } else {
        ex.messages.push(m);
        if (new Date(m.sent_at) > new Date(ex.lastAt)) {
          ex.lastAt = m.sent_at;
          ex.lastMessage = m.body;
          if (m.direction === "inbound") ex.unread++;
        }
      }
    }
    return Array.from(threads.values()).sort(
      (a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime(),
    );
  });

export const sendWhatsappMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ to: z.string(), body: z.string().min(1), contactName: z.string().optional() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabase as any;

    const { data: ws } = await sb
      .from("workspace_settings")
      .select("twilio_account_sid, twilio_auth_token, whatsapp_phone_id")
      .eq("workspace_id", workspaceId)
      .single();

    const accountSid = ws?.twilio_account_sid ?? process.env.TWILIO_ACCOUNT_SID;
    const authToken  = ws?.twilio_auth_token  ?? process.env.TWILIO_AUTH_TOKEN;
    const fromPhone  = ws?.whatsapp_phone_id;

    if (!accountSid || !authToken || !fromPhone) {
      throw new Error("WhatsApp not configured. Add Twilio credentials in Settings.");
    }

    const client = twilio(accountSid, authToken);
    const contactPhone = data.to.replace("whatsapp:", "");
    const to   = `whatsapp:${contactPhone}`;
    const from = fromPhone.startsWith("whatsapp:") ? fromPhone : `whatsapp:${fromPhone}`;

    const msg = await client.messages.create({ from, to, body: data.body });

    await sb.from("whatsapp_messages").insert({
      workspace_id: workspaceId,
      external_id: msg.sid,
      contact_phone: contactPhone,
      contact_name: data.contactName ?? null,
      direction: "outbound",
      body: data.body,
      status: "sent",
      sent_at: new Date().toISOString(),
    });

    return { ok: true, sid: msg.sid };
  });

// ── Contacts ──────────────────────────────────────────────────────────────────

export const listWAContacts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) return [];
    const sb = supabase as any;
    const { data, error } = await sb
      .from("whatsapp_contacts")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createWAContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      name: z.string().optional(),
      phone: z.string().min(1),
      tags: z.array(z.string()).optional(),
      source: z.string().optional(),
      lead_status: z.string().optional(),
      notes: z.string().optional(),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabase as any;
    const { data: row, error } = await sb
      .from("whatsapp_contacts")
      .upsert(
        { workspace_id: workspaceId, ...data, updated_at: new Date().toISOString() },
        { onConflict: "workspace_id,phone", ignoreDuplicates: false },
      )
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updateWAContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      id: z.string(),
      name: z.string().optional(),
      phone: z.string().optional(),
      tags: z.array(z.string()).optional(),
      source: z.string().optional(),
      lead_status: z.string().optional(),
      notes: z.string().optional(),
      archived: z.boolean().optional(),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabase as any;
    const { id, ...rest } = data;
    const { error } = await sb
      .from("whatsapp_contacts")
      .update({ ...rest, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteWAContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabase as any;
    const { error } = await sb
      .from("whatsapp_contacts")
      .delete()
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Templates ─────────────────────────────────────────────────────────────────

export const listWATemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) return [];
    const sb = supabase as any;
    const { data, error } = await sb
      .from("whatsapp_templates")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createWATemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      name: z.string().min(1),
      body: z.string().min(1),
      variables: z.array(z.string()).optional(),
      category: z.string().optional(),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabase as any;
    const { data: row, error } = await sb
      .from("whatsapp_templates")
      .insert({ workspace_id: workspaceId, ...data })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updateWATemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      id: z.string(),
      name: z.string().optional(),
      body: z.string().optional(),
      variables: z.array(z.string()).optional(),
      category: z.string().optional(),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabase as any;
    const { id, ...rest } = data;
    const { error } = await sb
      .from("whatsapp_templates")
      .update({ ...rest, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteWATemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabase as any;
    const { error } = await sb
      .from("whatsapp_templates")
      .delete()
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Campaigns ─────────────────────────────────────────────────────────────────

export const listWACampaigns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) return [];
    const sb = supabase as any;
    const { data, error } = await sb
      .from("whatsapp_campaigns")
      .select("*, whatsapp_templates(name)")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const campaigns = (data ?? []) as any[];
    const withStats = await Promise.all(
      campaigns.map(async (c) => {
        const { count: replied } = await sb
          .from("whatsapp_messages")
          .select("id", { count: "exact", head: true })
          .eq("campaign_id", c.id)
          .eq("direction", "inbound");
        const stats = { ...(c.stats ?? {}), replied: replied ?? 0 };
        return { ...c, stats };
      }),
    );
    return withStats;
  });

const audienceFilterSchema = z
  .object({
    qualification_status: z.string().optional(),
    pipeline_stage: z.string().optional(),
    status: z.string().optional(),
    whatsapp_opt_in_only: z.boolean().optional(),
    lead_ids: z.array(z.string()).optional(),
  })
  .optional();

export const createWACampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        name: z.string().min(1),
        type: z.enum(["broadcast", "follow_up", "scheduled"]),
        template_id: z.string().optional(),
        scheduled_at: z.string().optional(),
        provider: z.enum(["twilio", "wati"]).optional(),
        wati_template_name: z.string().optional(),
        template_params: z.record(z.string()).optional(),
        wati_broadcast_name: z.string().optional(),
        audience_filter: audienceFilterSchema,
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabase as any;

    let provider = data.provider ?? "twilio";
    if (!data.provider) {
      const wati = await getWatiConnectionForWorkspace(sb, workspaceId);
      if (wati && data.wati_template_name) provider = "wati";
    }
    if (provider === "wati") assertNotWbahWorkspace(workspaceId);

    const { data: row, error } = await sb
      .from("whatsapp_campaigns")
      .insert({
        workspace_id: workspaceId,
        name: data.name,
        type: data.type,
        template_id: data.template_id ?? null,
        scheduled_at: data.scheduled_at ?? null,
        provider,
        wati_template_name: data.wati_template_name ?? null,
        template_params: data.template_params ?? null,
        wati_broadcast_name: data.wati_broadcast_name ?? data.name,
        audience_filter: data.audience_filter ?? null,
        status: "draft",
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteWACampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabase as any;
    const { error } = await sb
      .from("whatsapp_campaigns")
      .delete()
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Analytics ─────────────────────────────────────────────────────────────────

export const getWAAnalytics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) return null;
    const sb = supabase as any;

    const { data: watiConnRow } = await sb
      .from("wati_connections")
      .select("status")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (watiConnRow?.status === "connected") {
      await maybeAutoSyncWatiCampaigns(workspaceId);
      try {
        await reconcileWatiOutboundMessageStatuses(workspaceId);
      } catch (e) {
        console.warn("[WA analytics] WATI status reconcile failed:", (e as Error).message);
      }
    }

    const [{ data: msgs }, { data: campaigns }, { data: watiCamps }, { data: watiConn }] = await Promise.all([
      sb.from("whatsapp_messages").select("direction, status, sent_at, provider").eq("workspace_id", workspaceId),
      sb.from("whatsapp_campaigns").select("stats, provider").eq("workspace_id", workspaceId),
      sb.from("wati_campaigns").select("sent, delivered, read_count").eq("workspace_id", workspaceId),
      sb.from("wati_connections").select("status").eq("workspace_id", workspaceId).maybeSingle(),
    ]);

    const all      = (msgs ?? []) as any[];
    const outbound = all.filter((m) => m.direction === "outbound");
    const inbound  = all.filter((m) => m.direction === "inbound");

    let sent      = outbound.length;
    let delivered = outbound.filter((m) => ["delivered", "read"].includes(m.status)).length;
    let read      = outbound.filter((m) => m.status === "read").length;
    const responses = inbound.length;

    // Supplement from Webee campaign stats (WATI launches write sent count here)
    let campaignSent = 0;
    let campaignDelivered = 0;
    let campaignRead = 0;
    for (const c of (campaigns ?? []) as Array<{ stats?: Record<string, number> | null }>) {
      const s = c.stats ?? {};
      campaignSent += s.sent ?? 0;
      campaignDelivered += s.delivered ?? 0;
      campaignRead += s.read ?? 0;
    }

    let watiSyncedSent = 0;
    let watiSyncedDelivered = 0;
    let watiSyncedRead = 0;
    for (const c of (watiCamps ?? []) as Array<{ sent?: number; delivered?: number; read_count?: number }>) {
      watiSyncedSent += c.sent ?? 0;
      watiSyncedDelivered += c.delivered ?? 0;
      watiSyncedRead += c.read_count ?? 0;
    }

    sent = Math.max(sent, campaignSent, watiSyncedSent);
    delivered = Math.max(delivered, campaignDelivered, watiSyncedDelivered);
    read = Math.max(read, campaignRead, watiSyncedRead);

    const watiOutbound = outbound.filter((m) => m.provider === "wati");
    const twilioOutbound = outbound.filter((m) => !m.provider || m.provider === "twilio");

    const convRate = sent > 0 ? Math.round((responses / sent) * 100) : 0;

    const now  = new Date();
    const days: { date: string; sent: number; received: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const label  = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const dayStr = d.toISOString().slice(0, 10);
      days.push({
        date: label,
        sent:     outbound.filter((m) => m.sent_at?.slice(0, 10) === dayStr).length,
        received: inbound.filter((m)  => m.sent_at?.slice(0, 10) === dayStr).length,
      });
    }

    const watiConnected = watiConn?.status === "connected";
    const hasData = all.length > 0 || sent > 0 || watiSyncedSent > 0;

    return {
      sent,
      delivered,
      read,
      responses,
      convRate,
      days,
      total: all.length,
      watiConnected,
      hasData,
      providers: {
        twilio: {
          sent: twilioOutbound.length,
          delivered: twilioOutbound.filter((m) => ["delivered", "read"].includes(m.status)).length,
          read: twilioOutbound.filter((m) => m.status === "read").length,
        },
        wati: {
          sent: Math.max(watiOutbound.length, campaignSent, watiSyncedSent),
          delivered: Math.max(
            watiOutbound.filter((m) => ["delivered", "read"].includes(m.status)).length,
            campaignDelivered,
            watiSyncedDelivered,
          ),
          read: Math.max(
            watiOutbound.filter((m) => m.status === "read").length,
            campaignRead,
            watiSyncedRead,
          ),
        },
        messages: {
          sent: outbound.length,
          delivered: outbound.filter((m) => ["delivered", "read"].includes(m.status)).length,
          read: outbound.filter((m) => m.status === "read").length,
        },
      },
    };
  });

// ── WhatsApp Agents ───────────────────────────────────────────────────────────

export const getWAProviderStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) return { provider: null, twilioConfigured: false, watiConnected: false, isConfigured: false };
    const sb = supabase as any;

    const { data: ws } = await sb
      .from("workspace_settings")
      .select("twilio_account_sid, twilio_auth_token, whatsapp_phone_id, whatsapp_provider, meta_phone_number_id, meta_access_token")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    const twilioConfigured = !!(ws?.twilio_account_sid?.trim() && ws?.twilio_auth_token?.trim() && ws?.whatsapp_phone_id?.trim());
    const metaConfigured   = !!(ws?.meta_phone_number_id?.trim() && ws?.meta_access_token?.trim());

    const { data: watiRow } = await sb
      .from("wati_connections")
      .select("status")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    const watiConnected = watiRow?.status === "connected";

    const storedProvider = ws?.whatsapp_provider as string | undefined;
    const provider = storedProvider && storedProvider !== "" ? storedProvider : null;

    return {
      provider,
      twilioConfigured,
      watiConnected,
      metaConfigured,
      isConfigured: twilioConfigured || watiConnected || metaConfigured,
    };
  });

export const listWAAgents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) return [];
    const sb = supabase as any;
    const { data, error } = await sb
      .from("agents")
      .select("id, name, settings, flow_data, updated_at, created_at, retell_agent_id")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    const all = (data ?? []) as any[];
    return all.filter((a) => {
      const s = typeof a.settings === "string" ? JSON.parse(a.settings) : (a.settings ?? {});
      return s.channelType === "whatsapp";
    });
  });

// ── Settings ───────────────────────────────────────────────────────────────────

export const getWASettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) return null;
    const sb = supabase as any;
    const { data } = await sb
      .from("workspace_settings")
      .select("twilio_account_sid, twilio_auth_token, whatsapp_phone_id, whatsapp_provider, meta_phone_number_id, meta_waba_id, meta_access_token, meta_verify_token")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const domain = process.env.REPLIT_DEV_DOMAIN;
    const origin = domain ? `https://${domain}` : (process.env.VITE_PUBLIC_APP_URL ?? "");
    return {
      ...(data ?? {}),
      webhookUrl: `${origin}/api/public/whatsapp-webhook/${workspaceId}`,
    };
  });

export const saveMetaSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      data: z.object({
        meta_phone_number_id: z.string().min(1),
        meta_waba_id:         z.string().min(1),
        meta_access_token:    z.string().min(1),
        meta_verify_token:    z.string().optional(),
      }),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("Not authenticated");
    const sb = supabase as any;

    const verifyToken = data.data.meta_verify_token?.trim() ||
      crypto.randomUUID().replace(/-/g, "");

    await sb
      .from("workspace_settings")
      .upsert(
        {
          workspace_id:         workspaceId,
          whatsapp_provider:    "meta",
          meta_phone_number_id: data.data.meta_phone_number_id.trim(),
          meta_waba_id:         data.data.meta_waba_id.trim(),
          meta_access_token:    data.data.meta_access_token.trim(),
          meta_verify_token:    verifyToken,
        },
        { onConflict: "workspace_id" },
      );

    return { ok: true, meta_verify_token: verifyToken };
  });

export const saveWASettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      data: z.object({
        twilio_account_sid: z.string().optional(),
        twilio_auth_token:  z.string().optional(),
        whatsapp_phone_id:  z.string().optional(),
        whatsapp_provider:  z.string().optional(),
      }),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabase as any;
    const { error } = await sb
      .from("workspace_settings")
      .upsert({ workspace_id: workspaceId, ...data.data }, { onConflict: "workspace_id" });
    if (error) throw new Error(error.message);

    // Auto-register Twilio webhook on the phone number so the user doesn't
    // have to copy-paste the URL into the Twilio Console manually.
    const accountSid  = data.data.twilio_account_sid?.trim();
    const authToken   = data.data.twilio_auth_token?.trim();
    const phoneNumber = data.data.whatsapp_phone_id?.trim();

    if (accountSid && authToken && phoneNumber) {
      const domain = process.env.REPLIT_DEV_DOMAIN;
      const origin = domain
        ? `https://${domain}`
        : (process.env.VITE_PUBLIC_APP_URL ?? "");
      const webhookUrl = `${origin}/api/public/whatsapp-webhook/${workspaceId}`;
      const webhookResult = await registerTwilioWebhookForNumber(
        accountSid,
        authToken,
        phoneNumber,
        webhookUrl,
      );
      return { ok: true, webhookUrl, ...webhookResult };
    }

    return { ok: true, webhookUrl: null, webhookRegistered: false, webhookNote: "Enter all credentials to auto-register." };
  });

/**
 * Register our WhatsApp webhook URL on a Twilio phone number.
 * Looks up the IncomingPhoneNumber SID by phone number then PATCHes SmsUrl.
 */
async function registerTwilioWebhookForNumber(
  accountSid: string,
  authToken: string,
  phoneNumber: string,
  webhookUrl: string,
): Promise<{ webhookRegistered: boolean; webhookNote: string; phoneSid?: string }> {
  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const phoneE164 = phoneNumber.startsWith("+") ? phoneNumber : `+${phoneNumber}`;

  try {
    // 1. Find the IncomingPhoneNumber SID for this number
    const lookupRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phoneE164)}`,
      { headers: { Authorization: `Basic ${credentials}` } },
    );

    if (!lookupRes.ok) {
      const txt = await lookupRes.text();
      console.warn("[wa-settings] Twilio number lookup failed:", txt);
      return {
        webhookRegistered: false,
        webhookNote: `Credentials saved. Twilio number lookup failed (${lookupRes.status}) — paste the webhook URL manually in the Twilio Console.`,
      };
    }

    const lookupData = (await lookupRes.json()) as any;
    const phoneSid: string | undefined =
      lookupData?.incoming_phone_numbers?.[0]?.sid;

    if (!phoneSid) {
      return {
        webhookRegistered: false,
        webhookNote: `Credentials saved. The number ${phoneE164} was not found on this Twilio account — double-check the number and account SID. Paste the webhook URL in the Twilio Console manually.`,
      };
    }

    // 2. Set SmsUrl + SmsMethod on that number
    const updateRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers/${phoneSid}.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          SmsUrl: webhookUrl,
          SmsMethod: "POST",
        }),
      },
    );

    if (!updateRes.ok) {
      const txt = await updateRes.text();
      console.warn("[wa-settings] Twilio webhook update failed:", txt);
      return {
        webhookRegistered: false,
        webhookNote: `Credentials saved but webhook registration failed (${updateRes.status}). Paste the URL in the Twilio Console manually.`,
        phoneSid,
      };
    }

    return {
      webhookRegistered: true,
      webhookNote: `Webhook registered automatically on ${phoneE164} (SID ${phoneSid}). You don't need to configure anything in Twilio.`,
      phoneSid,
    };
  } catch (e) {
    console.error("[wa-settings] Twilio auto-register error", e);
    return {
      webhookRegistered: false,
      webhookNote: "Credentials saved. Auto-webhook registration failed — paste the URL into the Twilio Console manually.",
    };
  }
}

export const registerTwilioWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabase as any;
    const { data: ws } = await sb
      .from("workspace_settings")
      .select("twilio_account_sid, twilio_auth_token, whatsapp_phone_id")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    const accountSid  = ws?.twilio_account_sid?.trim();
    const authToken   = ws?.twilio_auth_token?.trim();
    const phoneNumber = ws?.whatsapp_phone_id?.trim();

    if (!accountSid || !authToken || !phoneNumber) {
      throw new Error("Save your Twilio credentials and phone number first.");
    }

    const domain = process.env.REPLIT_DEV_DOMAIN;
    const origin = domain ? `https://${domain}` : (process.env.VITE_PUBLIC_APP_URL ?? "");
    const webhookUrl = `${origin}/api/public/whatsapp-webhook/${workspaceId}`;

    const result = await registerTwilioWebhookForNumber(accountSid, authToken, phoneNumber, webhookUrl);
    return { webhookUrl, ...result };
  });

// ── Campaign launch ───────────────────────────────────────────────────────────

async function launchWatiCampaignFromWebee(
  sb: any,
  workspaceId: string,
  campaign: Record<string, unknown>,
): Promise<{ ok: true; sent: number; failed: number; total: number; errors?: string[] }> {
  assertNotWbahWorkspace(workspaceId);
  const conn = await getWatiConnectionForWorkspace(sb, workspaceId);
  if (!conn) throw new Error("WATI not connected — go to Buzzchat → Settings");

  const templateName = String(campaign.wati_template_name ?? "").trim();
  if (!templateName) {
    throw new Error("Campaign has no WATI template — edit the campaign and select a template");
  }

  const audienceFilter = (campaign.audience_filter ?? null) as CampaignAudienceFilter | null;
  const leads = await resolveCampaignAudienceLeads(sb, workspaceId, audienceFilter);
  if (leads.length === 0) {
    throw new Error("No leads with phone numbers match this campaign audience");
  }

  const mapping = (campaign.template_params ?? {}) as Record<string, string>;
  const broadcastName = String(campaign.wati_broadcast_name ?? campaign.name ?? "webee_campaign");
  const campaignId = String(campaign.id);

  const { data: tplRow } = await sb
    .from("wati_templates")
    .select("components, name")
    .eq("workspace_id", workspaceId)
    .eq("name", templateName)
    .maybeSingle();

  const paramSlots = extractWatiTemplateParamSlots(tplRow ?? { name: templateName });
  const mappingError = validateWatiTemplateParamMapping(paramSlots, mapping);
  if (mappingError) throw new Error(mappingError);

  await sb
    .from("whatsapp_campaigns")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", campaignId);

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  const sendItems = leads
    .map((lead) => {
      const phone = normalizeWhatsAppPhone(String(lead.phone ?? ""));
      if (!phone) return null;
      const parameters = buildWatiTemplateParams(lead, mapping);
      const bodyPreview =
        `[Template: ${templateName}] ${parameters.map((p) => p.value).filter(Boolean).join(" · ") || ""}`.trim();
      return {
        phone,
        parameters,
        leadId: String(lead.id),
        contactName: (lead.full_name as string | null) ?? null,
        bodyPreview,
      };
    })
    .filter(Boolean) as Array<{
    phone: string;
    parameters: Array<{ name: string; value: string }>;
    leadId: string;
    contactName: string | null;
    bodyPreview: string;
  }>;

  failed += leads.length - sendItems.length;

  const { results: sendResults } = await sendWatiTemplateMessagesBatch({
    tenantId: conn.tenant_id,
    apiKey: conn.api_key,
    apiHost: conn.api_host,
    templateName,
    broadcastName,
    items: sendItems,
  });

  const itemByPhone = new Map(sendItems.map((item) => [item.phone, item]));

  for (const result of sendResults) {
    const item = itemByPhone.get(result.phone);
    if (result.ok && result.messageId) {
      sent++;
      await sb.from("whatsapp_messages").insert({
        workspace_id: workspaceId,
        external_id: result.messageId,
        contact_phone: result.phone,
        contact_name: item?.contactName ?? null,
        lead_id: result.leadId ?? item?.leadId ?? null,
        campaign_id: campaignId,
        direction: "outbound",
        body: item?.bodyPreview ?? `[Template: ${templateName}]`,
        status: "sent",
        provider: "wati",
        sent_at: new Date().toISOString(),
      });
    } else {
      failed++;
      if (result.error) errors.push(`${result.phone}: ${result.error}`);
    }
  }

  const status = failed > 0 && sent === 0 ? "failed" : "completed";
  await sb
    .from("whatsapp_campaigns")
    .update({
      status,
      stats: {
        sent,
        failed,
        delivered: 0,
        read: 0,
        replied: 0,
        errors: errors.slice(0, 20),
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", campaignId);

  await forceSyncWatiCampaigns(workspaceId);

  return { ok: true, sent, failed, total: leads.length, errors: errors.slice(0, 5) };
}

export const launchWACampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabase as any;

    const { data: campaign, error: cErr } = await sb
      .from("whatsapp_campaigns")
      .select("*")
      .eq("id", data.id)
      .eq("workspace_id", workspaceId)
      .single();
    if (cErr || !campaign) throw new Error(cErr?.message ?? "Campaign not found");

    if (campaign.status === "active" || campaign.status === "running") {
      throw new Error("Campaign already running");
    }

    const watiConn = await getWatiConnectionForWorkspace(sb, workspaceId);
    const useWati =
      campaign.provider === "wati" ||
      (!!watiConn && !!campaign.wati_template_name);

    if (useWati) {
      assertNotWbahWorkspace(workspaceId);
      return launchWatiCampaignFromWebee(sb, workspaceId, campaign);
    }

    // ── Legacy Twilio path ──
    const { data: campaignWithTpl, error: cErr2 } = await sb
      .from("whatsapp_campaigns")
      .select("*, whatsapp_templates(body, name)")
      .eq("id", data.id)
      .eq("workspace_id", workspaceId)
      .single();
    if (cErr2 || !campaignWithTpl) throw new Error(cErr2?.message ?? "Campaign not found");

    if (campaignWithTpl.status === "active") throw new Error("Campaign already active");

    const templateBody: string = campaignWithTpl.whatsapp_templates?.body ?? "";
    if (!templateBody) throw new Error("Campaign has no template body — use WATI template or add a native template");

    // Get workspace settings for Twilio creds
    const { data: ws } = await sb
      .from("workspace_settings")
      .select("twilio_account_sid, twilio_auth_token, whatsapp_phone_id")
      .eq("workspace_id", workspaceId)
      .single();

    const accountSid = ws?.twilio_account_sid;
    const authToken  = ws?.twilio_auth_token;
    const fromPhone  = ws?.whatsapp_phone_id;
    if (!accountSid || !authToken || !fromPhone) {
      throw new Error("Twilio credentials not configured — go to WhatsApp → Settings");
    }

    // Get all contacts for this workspace
    const { data: contacts } = await sb
      .from("whatsapp_contacts")
      .select("phone, first_name, last_name")
      .eq("workspace_id", workspaceId)
      .eq("opted_in", true);

    const contactList = (contacts ?? []) as any[];
    if (contactList.length === 0) throw new Error("No opted-in contacts to send to");

    // Mark as active
    await sb
      .from("whatsapp_campaigns")
      .update({ status: "active", started_at: new Date().toISOString() })
      .eq("id", data.id);

    // Send messages
    const credentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

    let sent = 0;
    let failed = 0;
    for (const contact of contactList) {
      const name = [contact.first_name, contact.last_name].filter(Boolean).join(" ") || "there";
      const body = templateBody.replace(/\{\{name\}\}/gi, name);
      try {
        const res = await fetch(twilioUrl, {
          method: "POST",
          headers: {
            Authorization: `Basic ${credentials}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            To:   `whatsapp:${contact.phone}`,
            From: `whatsapp:${fromPhone}`,
            Body: body,
          }),
        });
        const json = (await res.json()) as any;
        if (json?.sid) {
          sent++;
          await sb.from("whatsapp_messages").insert({
            workspace_id: workspaceId,
            external_id:  json.sid,
            contact_phone: contact.phone,
            contact_name:  name,
            direction:     "outbound",
            body,
            status: "sent",
            sent_at: new Date().toISOString(),
          });
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }

    // Mark completed with stats (campaigns uses a stats JSONB column)
    await sb
      .from("whatsapp_campaigns")
      .update({
        status: "completed",
        stats: { sent, failed, delivered: 0, read: 0, replied: 0 },
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id);

    return { ok: true, sent, failed, total: contactList.length };
  });

// ── WATI campaign CSV audience ────────────────────────────────────────────────

const csvLeadRowSchema = z.object({
  phone: z.string().min(3).max(40),
  full_name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  company_name: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

export const importWatiCampaignLeadsCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ rows: z.array(csvLeadRowSchema).min(1).max(5000) }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    assertNotWbahWorkspace(workspaceId);
    const sb = supabase as any;

    const { data: existingRows } = await sb
      .from("leads")
      .select("id, phone, full_name, email, company_name, notes")
      .eq("workspace_id", workspaceId)
      .not("phone", "is", null)
      .limit(15000);

    const byExact = new Map<string, { id: string; full_name: string | null; email: string | null; company_name: string | null; notes: string | null; phone: string }>();
    const byTail = new Map<string, string>();
    for (const lead of existingRows ?? []) {
      const normalized = normalizeWhatsAppPhone(lead.phone);
      if (normalized) byExact.set(normalized, lead);
      const tail = phoneTail(normalized);
      if (tail && !byTail.has(tail)) byTail.set(tail, lead.id);
    }

    const leadIds: string[] = [];
    let inserted = 0;
    let updated = 0;
    let skipped = 0;

    for (const row of data.rows as CsvLeadRow[]) {
      const phone = normalizeWhatsAppPhone(row.phone);
      if (!phone || phone.replace(/\D/g, "").length < 7) {
        skipped++;
        continue;
      }

      const tail = phoneTail(phone);
      const existing =
        byExact.get(phone) ??
        (tail && byTail.has(tail)
          ? (existingRows ?? []).find((l: { id: string; phone: string }) => l.id === byTail.get(tail))
          : null);

      if (existing?.id) {
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (row.full_name && !existing.full_name) patch.full_name = row.full_name;
        if (row.email && !existing.email) patch.email = row.email;
        if (row.company_name && !existing.company_name) patch.company_name = row.company_name;
        if (row.notes && !existing.notes) patch.notes = row.notes;
        if (Object.keys(patch).length > 1) {
          await sb.from("leads").update(patch).eq("id", existing.id);
          updated++;
        }
        leadIds.push(existing.id);
        continue;
      }

      const { data: created, error } = await sb
        .from("leads")
        .insert({
          workspace_id: workspaceId,
          phone,
          full_name: row.full_name ?? null,
          email: row.email ?? null,
          company_name: row.company_name ?? null,
          notes: row.notes ?? null,
          source: "import",
          whatsapp_opt_in: true,
        })
        .select("id, phone")
        .single();

      if (error || !created?.id) {
        skipped++;
        continue;
      }

      inserted++;
      leadIds.push(created.id);
      byExact.set(phone, { ...created, full_name: row.full_name ?? null, email: row.email ?? null, company_name: row.company_name ?? null, notes: row.notes ?? null });
      if (tail) byTail.set(tail, created.id);
    }

    return {
      leadIds,
      inserted,
      updated,
      skipped,
      total: leadIds.length,
    };
  });

// ── Lead WhatsApp (WATI) ──────────────────────────────────────────────────────

export const listLeadWhatsappMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ leadId: z.string() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    assertNotWbahWorkspace(workspaceId);
    const sb = supabase as any;

    const { data: rows, error } = await sb
      .from("whatsapp_messages")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("lead_id", data.leadId)
      .order("sent_at", { ascending: true })
      .limit(200);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const sendLeadWhatsappTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        leadId: z.string(),
        templateName: z.string().min(1),
        templateParams: z.record(z.string()).optional(),
        broadcastName: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    assertNotWbahWorkspace(workspaceId);
    const sb = supabase as any;

    const conn = await getWatiConnectionForWorkspace(sb, workspaceId);
    if (!conn) throw new Error("WATI not connected — go to Buzzchat → Settings");

    const { data: lead, error: leadErr } = await sb
      .from("leads")
      .select("*")
      .eq("id", data.leadId)
      .eq("workspace_id", workspaceId)
      .single();
    if (leadErr || !lead) throw new Error(leadErr?.message ?? "Lead not found");

    const phone = normalizeWhatsAppPhone(String(lead.phone ?? ""));
    if (!phone) throw new Error("Lead has no phone number");

    const mapping = data.templateParams ?? {};
    const templateName = data.templateName.trim();

    const { data: tplRow } = await sb
      .from("wati_templates")
      .select("components, name")
      .eq("workspace_id", workspaceId)
      .eq("name", templateName)
      .maybeSingle();

    const paramSlots = extractWatiTemplateParamSlots(tplRow ?? { name: templateName });
    const mappingError = validateWatiTemplateParamMapping(paramSlots, mapping);
    if (mappingError) throw new Error(mappingError);

    const parameters = buildWatiTemplateParams(lead, mapping);
    const broadcastName = data.broadcastName ?? `lead_${data.leadId.slice(0, 8)}`;

    const result = await sendWatiTemplateMessage({
      tenantId: conn.tenant_id,
      apiKey: conn.api_key,
      apiHost: conn.api_host,
      toPhone: phone,
      templateName,
      parameters,
      broadcastName,
    });
    if (!result.ok) throw new Error(result.error ?? "WATI send failed");

    const bodyPreview = `[Template: ${templateName}] ${parameters.map((p) => p.value).filter(Boolean).join(" · ") || ""}`.trim();

    const { data: row, error: insErr } = await sb
      .from("whatsapp_messages")
      .insert({
        workspace_id: workspaceId,
        external_id: result.messageId,
        contact_phone: phone,
        contact_name: lead.full_name ?? null,
        lead_id: lead.id,
        direction: "outbound",
        body: bodyPreview,
        status: "sent",
        provider: "wati",
        sent_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (insErr) throw new Error(insErr.message);

    await sb
      .from("leads")
      .update({ last_contacted_at: new Date().toISOString() })
      .eq("id", lead.id);

    return { ok: true, message: row };
  });

/**
 * Search available Twilio phone numbers that can be used for WhatsApp.
 * Uses the caller's Account SID + Auth Token so they can search before saving.
 */
export const searchTwilioNumbers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      accountSid:  z.string().min(1),
      authToken:   z.string().min(1),
      countryCode: z.string().default("US"),
      areaCode:    z.string().optional(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const { accountSid, authToken, countryCode, areaCode } = data as {
      accountSid: string; authToken: string; countryCode: string; areaCode?: string;
    };
    const client = twilio(accountSid, authToken);

    const list = await client
      .availablePhoneNumbers(countryCode.toUpperCase())
      .local.list({
        smsEnabled: true,
        ...(areaCode?.trim() ? { areaCode: areaCode.trim() } : {}),
        pageSize: 10,
      });

    return list.map((n) => ({
      phoneNumber:  n.phoneNumber,
      friendlyName: n.friendlyName,
      locality:     n.locality     ?? "",
      region:       n.region       ?? "",
      sms:          !!(n.capabilities as any)?.sms,
      mms:          !!(n.capabilities as any)?.mms,
      voice:        !!(n.capabilities as any)?.voice,
    }));
  });

/**
 * Purchase a Twilio phone number and save it to workspace_settings.
 * The purchased number is auto-filled into whatsapp_phone_id.
 */
export const purchaseTwilioNumber = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      accountSid:  z.string().min(1),
      authToken:   z.string().min(1),
      phoneNumber: z.string().min(1),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    const { accountSid, authToken, phoneNumber } = data as {
      accountSid: string; authToken: string; phoneNumber: string;
    };

    if (!workspaceId) throw new Error("No workspace");

    const client = twilio(accountSid, authToken);
    const purchased = await client.incomingPhoneNumbers.create({ phoneNumber });

    const sb = supabase as any;
    await sb
      .from("workspace_settings")
      .upsert(
        { workspace_id: workspaceId, whatsapp_phone_id: purchased.phoneNumber },
        { onConflict: "workspace_id" },
      );

    return {
      ok:           true,
      phoneNumber:  purchased.phoneNumber,
      friendlyName: purchased.friendlyName,
      sid:          purchased.sid,
    };
  });
