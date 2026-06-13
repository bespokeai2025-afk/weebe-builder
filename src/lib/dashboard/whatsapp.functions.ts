import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import twilio from "twilio";

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
      .insert({ workspace_id: workspaceId, ...data })
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
    return data ?? [];
  });

export const createWACampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      name: z.string().min(1),
      type: z.enum(["broadcast", "follow_up", "scheduled"]),
      template_id: z.string().optional(),
      scheduled_at: z.string().optional(),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabase as any;
    const { data: row, error } = await sb
      .from("whatsapp_campaigns")
      .insert({ workspace_id: workspaceId, ...data })
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

    const { data: msgs } = await sb
      .from("whatsapp_messages")
      .select("direction, status, sent_at")
      .eq("workspace_id", workspaceId);

    const all      = (msgs ?? []) as any[];
    const outbound = all.filter((m) => m.direction === "outbound");
    const inbound  = all.filter((m) => m.direction === "inbound");

    const sent      = outbound.length;
    const delivered = outbound.filter((m) => ["delivered", "read"].includes(m.status)).length;
    const read      = outbound.filter((m) => m.status === "read").length;
    const responses = inbound.length;
    const convRate  = sent > 0 ? Math.round((responses / sent) * 100) : 0;

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

    return { sent, delivered, read, responses, convRate, days, total: all.length };
  });

// ── WhatsApp Agents ───────────────────────────────────────────────────────────

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
      .select("twilio_account_sid, twilio_auth_token, whatsapp_phone_id, whatsapp_provider")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const domain = process.env.REPLIT_DEV_DOMAIN;
    const origin = domain ? `https://${domain}` : (process.env.VITE_PUBLIC_APP_URL ?? "");
    return {
      ...(data ?? {}),
      webhookUrl: `${origin}/api/public/whatsapp-webhook/${workspaceId}`,
    };
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

export const launchWACampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabase as any;

    // Get campaign + template
    const { data: campaign, error: cErr } = await sb
      .from("whatsapp_campaigns")
      .select("*, whatsapp_templates(body, name)")
      .eq("id", data.id)
      .eq("workspace_id", workspaceId)
      .single();
    if (cErr || !campaign) throw new Error(cErr?.message ?? "Campaign not found");

    if (campaign.status === "active") throw new Error("Campaign already active");

    const templateBody: string = campaign.whatsapp_templates?.body ?? "";
    if (!templateBody) throw new Error("Campaign has no template body");

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
