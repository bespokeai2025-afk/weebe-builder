/**
 * Webuyanyhouse Workspace Integration — server functions.
 *
 * Syncs WeeBespoke AI Enterprise API data directly into the existing WEBEE
 * `leads` and `data_records` tables so all standard Smart Dash pages (Leads,
 * Qualified, Pipeline, Contacts, Calls, Campaigns) work without any new UI.
 *
 * Tokens are NEVER returned to the browser — stored server-side only.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  getAllCars,
  getAllBuyers,
  loginWithPassword,
} from "./client.server";

// ── Constants ─────────────────────────────────────────────────────────────────

const INTEGRATION_KEY  = "webespoke_enterprise";
const CLIENT_NAME      = "Webuyanyhouse";
const WBAH_SLUG        = "webuyanyhouse";
const WBAH_EMAIL       = "admin@webuyanyhouse.co.uk";
const WBAH_PASSWORD    = "Bespoke2025!";
const SOURCE_DETAIL    = "webespoke_enterprise";

// ── Workspace helpers ─────────────────────────────────────────────────────────

async function getWebuyanyhouseWorkspaceId(): Promise<string | null> {
  const { data } = await (supabaseAdmin as any)
    .from("workspaces")
    .select("id")
    .eq("slug", WBAH_SLUG)
    .maybeSingle();
  return data?.id ?? null;
}

// ── Token helpers (server-side only — never sent to browser) ──────────────────

async function getStoredTokens(): Promise<{ accessToken: string; refreshToken: string } | null> {
  const { data } = await (supabaseAdmin as any)
    .from("enterprise_integrations")
    .select("access_token, refresh_token, status")
    .eq("integration_key", INTEGRATION_KEY)
    .eq("client_name", CLIENT_NAME)
    .maybeSingle();
  if (!data || data.status !== "connected" || !data.access_token) return null;
  return { accessToken: data.access_token, refreshToken: data.refresh_token ?? "" };
}

async function saveNewAccessToken(token: string): Promise<void> {
  await (supabaseAdmin as any)
    .from("enterprise_integrations")
    .update({ access_token: token, status: "connected" })
    .eq("integration_key", INTEGRATION_KEY)
    .eq("client_name", CLIENT_NAME);
}

function makeTokenCallbacks() {
  return {
    getTokens: async () => {
      const tokens = await getStoredTokens();
      if (!tokens) throw new Error("Not connected — use Admin Connect first");
      return tokens;
    },
    saveNewAccessToken,
  };
}

// ── Classification helpers ────────────────────────────────────────────────────

type LeadStatus   = "need_to_call" | "not_interested" | "not_connected" | "qualified";
type SentimentVal = "positive" | "neutral" | "negative";

function pickStr(raw: any, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = raw?.[k];
    if (v != null && String(v).trim() && String(v) !== "null" && String(v) !== "undefined") {
      return String(v).trim();
    }
  }
  return null;
}

function statusHaystack(raw: any): string {
  return [
    raw?.status, raw?.leadStatus, raw?.crmStatus, raw?.pipelineStage,
    raw?.callStatus, raw?.booking_status,
    raw?.stage, raw?.category, raw?.section, raw?.listName, raw?.segment,
    raw?.tags, raw?.notes, raw?.callOutcome, raw?.lastCallOutcome,
    raw?.qualificationStatus, raw?.sentiment, raw?.sentimentAnalysis,
    raw?.disconnectionReason,
  ].filter(Boolean).join(" ").toLowerCase();
}

function classifyStatus(raw: any): LeadStatus {
  // WeeBespoke UAT: callStatus is the primary status field
  const cs = (raw?.callStatus ?? "").toLowerCase();
  const sa = (raw?.sentimentAnalysis ?? "").toLowerCase();

  // Explicit need_to_call flag from CRM data
  if (raw?.need_to_call === true) return "need_to_call";
  // Negative sentiment or disqualified
  if (raw?.is_negative_sentiment === true) return "not_interested";

  // callStatus-based classification
  if (cs === "need_to_call") return "need_to_call";
  if (cs === "ended" || cs === "call_analyzed") {
    if (/negative/.test(sa)) return "not_interested";
    if (/positive|neutral/.test(sa)) return "qualified";
    // Voicemail / no answer
    const dr = (raw?.disconnectionReason ?? "").toLowerCase();
    if (/voicemail|no_answer|no_input|dial_no_answer/.test(dr)) return "not_connected";
    return "qualified"; // answered call = qualified by default
  }
  if (cs === "not_connected" || cs === "no_answer" || cs === "voicemail") return "not_connected";

  // Generic haystack fallback
  const h = statusHaystack(raw);
  if (/disqualif|disqual|reject|unsuitable|do[_\s]?not[_\s]?call/.test(h)) return "not_interested";
  if (/tried.{0,10}contact|attempted.{0,10}contact|no[_\s]answer|unable.{0,10}contact|not.{0,5}reached|missed|voicemail/.test(h)) return "not_connected";
  if (/qualified|positive|neutral/.test(h)) return "qualified";
  return "need_to_call";
}

function classifySentiment(raw: any): SentimentVal | null {
  // WeeBespoke UAT returns sentimentAnalysis: "Positive" | "Neutral" | "Negative"
  const sa = (raw?.sentimentAnalysis ?? raw?.sentiment ?? "").toLowerCase();
  if (/positive|interested|keen|motivated/.test(sa)) return "positive";
  if (/neutral|maybe|unsure|undecided/.test(sa)) return "neutral";
  if (/negative|disqualif|not[_\s]interested|hostile/.test(sa)) return "negative";
  return null;
}

function classifyPipelineStage(status: LeadStatus): string | null {
  if (status === "not_interested") return "lost";
  if (status === "not_connected")  return "discovery";
  if (status === "qualified")      return "proposal";
  if (status === "need_to_call")   return "new_lead";
  return "new_lead";
}

function classifyQualificationStatus(raw: any): string | null {
  const h = statusHaystack(raw);
  if (/qualified|positive|neutral/.test(h))       return "qualified";
  if (/disqualif|reject|unsuitable/.test(h))       return "not_qualified";
  return null;
}

function isCallbackRequested(raw: any): boolean {
  return !!(raw?.callbackRequested || raw?.callback_requested ||
    raw?.callbackDate || raw?.callback_date ||
    /callback|call[_\s]?back/.test((raw?.status ?? "").toLowerCase()));
}

// ── Build `leads` table row from WeeBespoke payload ───────────────────────────
// Handles two source shapes:
//   get-userCall-lead : { name, toNumber, email, callStatus, sentimentAnalysis,
//                         agentName, transcript, recordingUrl, lead_id, … }
//   crm-data rows     : { name, mobile_number, email, lead_status, … }

function buildLeadRow(raw: any, workspaceId: string) {
  const status      = classifyStatus(raw);
  const sentiment   = classifySentiment(raw);
  const pipeline    = classifyPipelineStage(status);
  const qualStatus  = classifyQualificationStatus(raw);
  // get-userCall-lead uses `lead_id` as the stable external reference
  const externalId  = pickStr(raw, "lead_id", "id", "_id", "leadId", "sellerId") ?? null;
  const callbackAt  = raw?.appointment_date || raw?.callbackDate || raw?.callback_date || null;

  // CRM sub-object (present on get-all-calldata items)
  const crm = raw?.crmData ?? {};

  return {
    workspace_id:          workspaceId,
    full_name:             pickStr(raw, "name", "fullName", "leadName", "customerName", "sellerName")
                           ?? pickStr(crm, "name", "firstname")
                           ?? "Unknown",
    // get-userCall-lead stores the called number in `toNumber`; CRM uses `mobile_number`
    phone:                 pickStr(raw, "toNumber", "fromNumber", "phone", "phoneNumber", "mobile", "telephone")
                           ?? pickStr(crm, "mobile_number", "mobileNumber")
                           ?? "",
    email:                 pickStr(raw, "email", "emailAddress") ?? pickStr(crm, "email") ?? null,
    company_name:          null,
    status:                status as string,
    sentiment:             sentiment,
    pipeline_stage:        pipeline,
    qualification_status:  qualStatus,
    source:                "import",
    source_detail:         SOURCE_DETAIL,
    notes:                 pickStr(raw, "notes", "description", "comments"),
    // Use WeeBespoke transcript as call summary
    call_summary:          pickStr(raw, "transcript", "callSummary", "summary"),
    callback_date:         (isCallbackRequested(raw) && callbackAt) ? callbackAt : null,
    meta: {
      wbah_external_id:    externalId,
      wbah_synced_at:      new Date().toISOString(),
      // Property info from CRM sub-object
      property_address:    pickStr(crm, "new_propinfo_street2", "address1_line1")
                           ?? pickStr(raw, "address", "propertyAddress", "fullAddress"),
      property_city:       pickStr(crm, "new_propinfo_city", "address1_city"),
      postcode:            pickStr(crm, "new_propinfo_postalcode", "address1_postalcode")
                           ?? pickStr(raw, "postcode", "postCode"),
      property_type:       pickStr(crm, "property_type"),
      expected_price:      pickStr(raw, "askingPrice", "expectedPrice", "price", "salePrice"),
      assigned_agent:      pickStr(raw, "agentName", "assignedAgent", "agent"),
      call_status:         raw?.callStatus ?? null,
      call_id:             pickStr(raw, "callId"),
      recording_url:       pickStr(raw, "recordingUrl"),
      disconnection_reason: pickStr(raw, "disconnectionReason"),
      duration_ms:         raw?.durationMs ?? null,
      appointment_date:    pickStr(raw, "appointment_date"),
      appointment_time:    pickStr(raw, "appointment_time"),
      booking_status:      pickStr(raw, "booking_status"),
    },
  };
}

// ── Build `data_records` row from WeeBespoke CRM payload ─────────────────────
// Source: GET /crm-data/get-crm-data
// Shape: { name, mobile_number, email, lead_status, … }

function buildContactRow(raw: any, workspaceId: string) {
  const externalId = pickStr(raw, "id", "_id", "lead_id", "buyerId", "contactId") ?? null;
  const name = pickStr(raw, "name", "fullName", "contact_name", "firstname", "firstName") ?? "Unknown";
  // WeeBespoke CRM uses mobile_number not phone/mobile
  const phone = pickStr(raw, "mobile_number", "mobileNumber", "phone", "phoneNumber", "mobile", "telephone") ?? "";

  return {
    workspace_id:      workspaceId,
    name,
    first_name:        pickStr(raw, "firstname", "firstName", "first_name"),
    last_name:         pickStr(raw, "lastname", "lastName", "last_name"),
    mobile_number:     phone,
    email:             pickStr(raw, "email", "emailAddress"),
    address_line1:     pickStr(raw, "new_propinfo_street2", "address1_line1", "address", "addressLine1"),
    postal_code:       pickStr(raw, "new_propinfo_postalcode", "address1_postalcode", "postcode", "postCode"),
    city:              pickStr(raw, "new_propinfo_city", "address1_city", "city", "town"),
    client_name:       "Webuyanyhouse",
    lead_external_id:  externalId,
    is_active:         raw?.isActive ?? true,
    need_to_call:      raw?.need_to_call ?? false,
    meta: {
      wbah_source:     "crm",
      wbah_synced_at:  new Date().toISOString(),
      lead_status:     raw?.lead_status ?? null,
      crm_type:        raw?.crm_type ?? null,
      property_type:   raw?.property_type ?? null,
      unique_id:       raw?.unique_id ?? null,
    },
  };
}

// ── Upsert leads into existing `leads` table ──────────────────────────────────

async function upsertLeadsRows(rows: ReturnType<typeof buildLeadRow>[]): Promise<number> {
  if (!rows.length) return 0;
  const sb = supabaseAdmin as any;
  const workspaceId = rows[0].workspace_id;

  // Fetch existing records by phone to determine insert vs update
  const { data: existing } = await sb
    .from("leads")
    .select("id, phone")
    .eq("workspace_id", workspaceId)
    .eq("source", "import")
    .eq("source_detail", SOURCE_DETAIL);

  const existingByPhone = new Map<string, string>(
    (existing ?? []).map((l: any) => [String(l.phone).trim(), String(l.id)])
  );

  const toInsert: typeof rows = [];
  const toUpdate: Array<{ id: string } & (typeof rows)[0]> = [];

  for (const row of rows) {
    const phone = String(row.phone).trim();
    const existingId = phone ? existingByPhone.get(phone) : undefined;
    if (existingId) {
      toUpdate.push({ ...row, id: existingId });
    } else {
      toInsert.push(row);
    }
  }

  // Batch insert new
  if (toInsert.length) {
    const { error } = await sb.from("leads").insert(toInsert);
    if (error) console.error("[wbah-sync] leads insert error:", error.message);
  }

  // Update existing in batches of 50
  for (let i = 0; i < toUpdate.length; i += 50) {
    const batch = toUpdate.slice(i, i + 50);
    await Promise.allSettled(
      batch.map(({ id, ...row }) =>
        sb.from("leads").update(row).eq("id", id)
      )
    );
  }

  return rows.length;
}

// ── Upsert contacts into existing `data_records` table ───────────────────────

async function upsertContactRows(rows: ReturnType<typeof buildContactRow>[]): Promise<number> {
  if (!rows.length) return 0;
  const sb = supabaseAdmin as any;
  const workspaceId = rows[0].workspace_id;

  // Use lead_external_id for dedup (it has a unique index in WEBEE)
  const withId    = rows.filter(r => r.lead_external_id);
  const withoutId = rows.filter(r => !r.lead_external_id);

  if (withId.length) {
    // Check which external IDs already exist
    const externalIds = withId.map(r => r.lead_external_id);
    const { data: existing } = await sb
      .from("data_records")
      .select("id, lead_external_id")
      .eq("workspace_id", workspaceId)
      .in("lead_external_id", externalIds);

    const existingSet = new Set((existing ?? []).map((r: any) => r.lead_external_id));
    const toInsert = withId.filter(r => !existingSet.has(r.lead_external_id));
    const toSkip   = withId.filter(r =>  existingSet.has(r.lead_external_id));

    if (toInsert.length) {
      await sb.from("data_records").insert(toInsert);
    }
    // Update existing
    const existingMap = new Map((existing ?? []).map((r: any) => [r.lead_external_id, r.id]));
    await Promise.allSettled(
      toSkip.map(row => sb.from("data_records").update(row).eq("id", existingMap.get(row.lead_external_id)))
    );
  }

  if (withoutId.length) {
    await sb.from("data_records").insert(withoutId);
  }

  return rows.length;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN SERVER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

// ── Provision Webuyanyhouse WEBEE Account ─────────────────────────────────────

export const provisionWebuyanyhouseAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async () => {
    const sb = supabaseAdmin as any;

    // Find or create auth user
    const { data: existing } = await supabaseAdmin.auth.admin.listUsers();
    const existingUser = (existing?.users ?? []).find((u: any) => u.email === WBAH_EMAIL);

    let userId: string;
    let alreadyExisted = !!existingUser;

    if (existingUser) {
      userId = existingUser.id;
    } else {
      const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email: WBAH_EMAIL,
        password: WBAH_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: "Webuyanyhouse Admin" },
      });
      if (createErr || !newUser.user) {
        throw new Error(`Failed to create user: ${createErr?.message ?? "unknown"}`);
      }
      userId = newUser.user.id;

      await sb.from("profiles").upsert(
        { user_id: userId, email: WBAH_EMAIL, full_name: "Webuyanyhouse Admin", user_type: "user" },
        { onConflict: "user_id" },
      );
    }

    // Find or create workspace
    const existingWsId = await getWebuyanyhouseWorkspaceId();
    let workspaceId = existingWsId;

    if (!workspaceId) {
      const { data: ws, error: wsErr } = await supabaseAdmin
        .from("workspaces")
        .insert({ name: "Webuyanyhouse", slug: WBAH_SLUG, owner_id: userId })
        .select("id")
        .single();

      if (wsErr || !ws) throw new Error(`Workspace create failed: ${wsErr?.message}`);
      workspaceId = ws.id;

      await supabaseAdmin.from("workspace_members").upsert(
        { workspace_id: workspaceId, user_id: userId, role: "owner" },
        { onConflict: "workspace_id,user_id" },
      );
      await supabaseAdmin.from("workspace_settings").upsert(
        { workspace_id: workspaceId, business_name: "Webuyanyhouse" },
        { onConflict: "workspace_id" },
      );
      await supabaseAdmin.from("profiles")
        .update({ default_workspace_id: workspaceId })
        .eq("user_id", userId);

      await supabaseAdmin.from("telephony_configs")
        .upsert({ workspace_id: workspaceId, provider: "twilio", is_active: true }, { onConflict: "workspace_id,provider" })
        .then(() => {}).catch(() => {});
    }

    return { ok: true, email: WBAH_EMAIL, userId, workspaceId, alreadyExisted };
  });

// ── Admin: API connection status ──────────────────────────────────────────────

export const getWebuyanyhouseAdminStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async () => {
    const sb = supabaseAdmin as any;
    const workspaceId = await getWebuyanyhouseWorkspaceId();

    const { data: integration } = await sb
      .from("enterprise_integrations")
      .select("status, updated_at")
      .eq("integration_key", INTEGRATION_KEY)
      .eq("client_name", CLIENT_NAME)
      .maybeSingle();

    // Lead counts from the standard `leads` table (workspace-scoped)
    let leadCounts = { need_to_call: 0, not_connected: 0, not_interested: 0, qualified: 0 };
    let totalLeads = 0;
    let lastSynced: string | null = null;

    if (workspaceId) {
      const { data: counts } = await sb
        .from("leads")
        .select("status, updated_at")
        .eq("workspace_id", workspaceId)
        .eq("source", "import")
        .eq("source_detail", SOURCE_DETAIL)
        .order("updated_at", { ascending: false });

      for (const row of counts ?? []) {
        leadCounts[row.status as keyof typeof leadCounts] =
          (leadCounts[row.status as keyof typeof leadCounts] ?? 0) + 1;
        totalLeads++;
      }
      if (counts?.length) lastSynced = counts[0].updated_at;
    }

    return {
      workspaceId,
      workspaceCreated: !!workspaceId,
      apiStatus:   (integration?.status ?? "disconnected") as string,
      apiUpdatedAt: integration?.updated_at ?? null,
      lastSynced,
      totalLeads,
      leadCounts: {
        new_leads:        leadCounts.need_to_call,
        tried_to_contact: leadCounts.not_connected,
        disqualified:     leadCounts.not_interested,
        qualified:        leadCounts.qualified,
      },
    };
  });

// ── Admin: Connect API (password auth, server-side only) ─────────────────────

export const adminConnectWebuyanyhouseApi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async () => {
    const email    = process.env.WEBESPOKE_ADMIN_EMAIL;
    const password = process.env.WEBESPOKE_ADMIN_PASSWORD;
    if (!email || !password) {
      throw new Error("Set WEBESPOKE_ADMIN_EMAIL + WEBESPOKE_ADMIN_PASSWORD in Replit Secrets.");
    }

    const res = await loginWithPassword(email, password);
    if (!res.ok || !res.data) {
      throw new Error(res.error ?? `WeeBespoke login failed (HTTP ${res.status})`);
    }

    const d = res.data as any;
    const accessToken  = d.accessToken ?? d.token;
    const refreshToken = d.refreshToken ?? "";
    if (!accessToken) throw new Error("Login succeeded but no token returned");

    await (supabaseAdmin as any).from("enterprise_integrations").upsert(
      {
        integration_key: INTEGRATION_KEY,
        client_name:     CLIENT_NAME,
        access_token:    accessToken,
        refresh_token:   refreshToken,
        user_payload:    { email },
        status:          "connected",
      },
      { onConflict: "integration_key,client_name" },
    );
    return { ok: true };
  });

// ── Admin: Disconnect API ─────────────────────────────────────────────────────

export const adminDisconnectWebuyanyhouseApi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async () => {
    await (supabaseAdmin as any)
      .from("enterprise_integrations")
      .update({ access_token: null, refresh_token: null, status: "disconnected" })
      .eq("integration_key", INTEGRATION_KEY)
      .eq("client_name", CLIENT_NAME);
    return { ok: true };
  });

// ── Admin: Sync all leads into existing WEBEE tables ─────────────────────────
//
// Phase 4/12 of the Webuyanyhouse workspace spec:
// - Property sellers (cars endpoint) → standard `leads` table with WEBEE status/pipeline mapping
// - Buyers (buyers endpoint)         → standard `data_records` table (People/Contacts page)
// Both are workspace-scoped to Webuyanyhouse. All existing WEBEE pages work automatically.

export const adminSyncWebuyanyhouseLeads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async () => {
    const workspaceId = await getWebuyanyhouseWorkspaceId();
    if (!workspaceId) {
      throw new Error("Webuyanyhouse workspace not found — create the account first.");
    }

    const { getTokens, saveNewAccessToken: saveToken } = makeTokenCallbacks();

    // getAllCars = /call-output-data/get-userCall-lead (paginated — fetch all pages)
    // getAllBuyers = /crm-data/get-crm-data
    const [sellersRes, buyersRes] = await Promise.allSettled([
      getAllCars(getTokens, saveToken),
      getAllBuyers(getTokens, saveToken),
    ]);

    const results = {
      sellers:      0,
      contacts:     0,
      errors:       [] as string[],
    };

    // ── Property sellers → leads table ────────────────────────────────────────
    if (sellersRes.status === "fulfilled" && sellersRes.value.ok) {
      const records = Array.isArray(sellersRes.value.data) ? sellersRes.value.data : [];
      const rows = records.map((r: any) => buildLeadRow(r, workspaceId));
      results.sellers = await upsertLeadsRows(rows);
    } else {
      const err = sellersRes.status === "rejected"
        ? sellersRes.reason?.message
        : sellersRes.value?.error ?? "Sellers sync failed";
      results.errors.push(err);
      if ((sellersRes as any).value?.status === 401) {
        await (supabaseAdmin as any)
          .from("enterprise_integrations")
          .update({ status: "disconnected" })
          .eq("integration_key", INTEGRATION_KEY)
          .eq("client_name", CLIENT_NAME);
      }
    }

    // ── Buyer contacts → data_records table ───────────────────────────────────
    if (buyersRes.status === "fulfilled" && buyersRes.value.ok) {
      const records = Array.isArray(buyersRes.value.data) ? buyersRes.value.data : [];
      const rows = records.map((r: any) => buildContactRow(r, workspaceId));
      results.contacts = await upsertContactRows(rows);
    } else {
      const err = buyersRes.status === "rejected"
        ? buyersRes.reason?.message
        : buyersRes.value?.error ?? "Contacts sync failed";
      results.errors.push(err);
    }

    return results;
  });

// ═══════════════════════════════════════════════════════════════════════════════
// WORKSPACE SERVER FUNCTIONS (used by workspace-user checks)
// ═══════════════════════════════════════════════════════════════════════════════

export const checkWebuyanyhouseWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await (supabaseAdmin as any)
      .from("workspaces")
      .select("slug, name")
      .eq("id", context.workspaceId)
      .maybeSingle();
    return {
      isWebuyanyhouse: data?.slug === WBAH_SLUG,
      slug: data?.slug ?? null,
      name: data?.name ?? null,
    };
  });
