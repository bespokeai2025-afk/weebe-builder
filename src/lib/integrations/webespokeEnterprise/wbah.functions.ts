/**
 * Webuyanyhouse Workspace Integration — server functions.
 *
 * Admin functions (requirePlatformAdmin): account provisioning, API sync.
 * Workspace functions (requireSupabaseAuth): lead reads, scoped to WBAH workspace.
 *
 * Tokens are NEVER returned to the browser — stored server-side only.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requirePlatformAdmin } from "@/lib/auth/require-platform-admin";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  getAllCars,
  getAllBuyers,
  getAllDealers,
  loginWithPassword,
} from "./client.server";

// ── Constants ─────────────────────────────────────────────────────────────────

const INTEGRATION_KEY = "webespoke_enterprise";
const CLIENT_NAME = "Webuyanyhouse";
const WBAH_SLUG = "webuyanyhouse";
const WBAH_EMAIL = "admin@webuyanyhouse.co.uk";
const WBAH_PASSWORD = "Bespoke2025!";

// ── Workspace helpers ─────────────────────────────────────────────────────────

async function getWebuyanyhouseWorkspaceId(): Promise<string | null> {
  const sb = supabaseAdmin as any;
  const { data } = await sb
    .from("workspaces")
    .select("id")
    .eq("slug", WBAH_SLUG)
    .maybeSingle();
  return data?.id ?? null;
}

// ── Token helpers (server-side only) ─────────────────────────────────────────

async function getStoredTokens(): Promise<{ accessToken: string; refreshToken: string } | null> {
  const sb = supabaseAdmin as any;
  const { data } = await sb
    .from("enterprise_integrations")
    .select("access_token, refresh_token, status")
    .eq("integration_key", INTEGRATION_KEY)
    .eq("client_name", CLIENT_NAME)
    .maybeSingle();
  if (!data || data.status !== "connected" || !data.access_token) return null;
  return { accessToken: data.access_token, refreshToken: data.refresh_token ?? "" };
}

async function saveNewAccessToken(token: string): Promise<void> {
  const sb = supabaseAdmin as any;
  await sb
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

// ── Lead classification ───────────────────────────────────────────────────────

function classifyLead(raw: unknown): string {
  const haystack = JSON.stringify(raw).toLowerCase();

  // Check specific high-priority fields first
  const r = raw as any;
  const statusFields = [
    r?.status, r?.leadStatus, r?.crmStatus, r?.pipelineStage,
    r?.stage, r?.category, r?.source, r?.section, r?.listName,
    r?.segment, r?.tags, r?.notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (/disqualif|disqual/.test(statusFields)) return "disqualified";
  if (/tried.{0,10}contact|attempted.{0,10}contact|contact.{0,10}attempted|unable.{0,10}contact/.test(statusFields)) return "tried_to_contact";
  if (/\bnew.{0,5}lead|fresh.{0,5}lead|new_lead/.test(statusFields)) return "new_lead";

  // Fall back to full payload scan
  if (/disqualif|disqual/.test(haystack)) return "disqualified";
  if (/tried.{0,10}contact|attempted.{0,10}contact|contact.{0,10}attempted|unable.{0,10}contact/.test(haystack)) return "tried_to_contact";
  if (/\bnew.{0,5}lead|fresh.{0,5}lead|new_lead/.test(haystack)) return "new_lead";

  return "unknown";
}

function pickStr(raw: any, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = raw?.[k];
    if (v != null && v !== "" && v !== "null" && v !== "undefined") return String(v).trim();
  }
  return null;
}

function extractLeadFields(raw: any) {
  return {
    lead_name:             pickStr(raw, "name", "fullName", "leadName", "customerName", "sellerName", "contact_name", "firstName"),
    phone:                 pickStr(raw, "phone", "phoneNumber", "mobile", "telephone", "contact_phone", "mobileNumber"),
    email:                 pickStr(raw, "email", "emailAddress", "contact_email"),
    property_address:      pickStr(raw, "address", "propertyAddress", "fullAddress", "property_address", "make", "title"),
    postcode:              pickStr(raw, "postcode", "postCode", "zipCode", "postal_code", "zip"),
    expected_price:        pickStr(raw, "askingPrice", "expectedPrice", "price", "salePrice", "valuation", "offerPrice"),
    current_status:        pickStr(raw, "status", "leadStatus", "crmStatus", "pipelineStage", "stage", "listingStatus"),
    assigned_agent:        pickStr(raw, "assignedAgent", "agentName", "agent", "dealerName", "dealer"),
    call_attempt_count:    typeof raw?.callAttemptCount === "number" ? raw.callAttemptCount : null,
    call_outcome:          pickStr(raw, "callOutcome", "lastCallOutcome", "outcome"),
    qualification_status:  pickStr(raw, "qualificationStatus", "qualified", "qualStatus"),
    qualification_summary: pickStr(raw, "qualificationSummary", "summary", "qualification_summary"),
    sentiment:             pickStr(raw, "sentiment", "leadSentiment"),
    n8n_workflow_id:       pickStr(raw, "n8nWorkflowId", "workflowId", "n8n_workflow_id"),
    notes:                 pickStr(raw, "notes", "description", "comments"),
    last_call_attempt:     raw?.lastCallAttempt ?? raw?.last_call_attempt ?? null,
  };
}

function buildLeadRow(raw: any, workspaceId: string, sourceLabel: string) {
  const fields = extractLeadFields(raw);
  const externalId = raw?.id ? String(raw.id) : raw?._id ? String(raw._id) : null;
  return {
    workspace_id:          workspaceId,
    source:               "webespoke_enterprise_api",
    source_section:        classifyLead(raw),
    external_id:           externalId,
    raw_payload:           raw,
    synced_at:             new Date().toISOString(),
    ...fields,
  };
}

async function upsertLeads(rows: any[]): Promise<number> {
  if (!rows.length) return 0;
  const sb = supabaseAdmin as any;
  const { error } = await sb
    .from("webuyanyhouse_imported_leads")
    .upsert(rows, {
      onConflict: "workspace_id,source,external_id",
      ignoreDuplicates: false,
    });
  if (error) throw new Error(`Lead upsert failed: ${error.message}`);
  return rows.length;
}

// ── Admin: Provision Webuyanyhouse WEBEE Account ──────────────────────────────

export const provisionWebuyanyhouseAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async () => {
    const sb = supabaseAdmin as any;

    // Check if already exists
    const { data: existing } = await sb.auth.admin.listUsers();
    const existingUser = (existing?.users ?? []).find(
      (u: any) => u.email === WBAH_EMAIL
    );

    let userId: string;

    if (existingUser) {
      userId = existingUser.id;
    } else {
      // Create auth user
      const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email: WBAH_EMAIL,
        password: WBAH_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: "Webuyanyhouse Admin" },
      });
      if (createErr || !newUser.user) {
        throw new Error(`Failed to create user: ${createErr?.message ?? "unknown error"}`);
      }
      userId = newUser.user.id;

      // Create profile if trigger hasn't fired
      await sb.from("profiles").upsert({
        user_id: userId,
        email: WBAH_EMAIL,
        full_name: "Webuyanyhouse Admin",
        user_type: "user",
      }, { onConflict: "user_id" });
    }

    // Check if workspace already exists
    const existingWsId = await getWebuyanyhouseWorkspaceId();
    let workspaceId = existingWsId;

    if (!workspaceId) {
      const { data: ws, error: wsErr } = await supabaseAdmin
        .from("workspaces")
        .insert({ name: "Webuyanyhouse", slug: WBAH_SLUG, owner_id: userId })
        .select("id")
        .single();

      if (wsErr || !ws) {
        throw new Error(`Failed to create workspace: ${wsErr?.message ?? "unknown error"}`);
      }
      workspaceId = ws.id;

      await supabaseAdmin.from("workspace_members").upsert(
        { workspace_id: workspaceId, user_id: userId, role: "owner" },
        { onConflict: "workspace_id,user_id" }
      );

      await supabaseAdmin.from("workspace_settings").upsert(
        { workspace_id: workspaceId, business_name: "Webuyanyhouse" },
        { onConflict: "workspace_id" }
      );

      await supabaseAdmin.from("profiles")
        .update({ default_workspace_id: workspaceId })
        .eq("user_id", userId);

      // Telephony config so builder is ready
      await supabaseAdmin.from("telephony_configs")
        .upsert({ workspace_id: workspaceId, provider: "twilio", is_active: true }, { onConflict: "workspace_id,provider" })
        .then(() => {}).catch(() => {});
    }

    return {
      ok: true,
      email: WBAH_EMAIL,
      userId,
      workspaceId,
      alreadyExisted: !!existingUser,
    };
  });

// ── Admin: status ─────────────────────────────────────────────────────────────

export const getWebuyanyhouseAdminStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async () => {
    const sb = supabaseAdmin as any;

    const workspaceId = await getWebuyanyhouseWorkspaceId();

    // API connection status
    const { data: integration } = await sb
      .from("enterprise_integrations")
      .select("status, updated_at")
      .eq("integration_key", INTEGRATION_KEY)
      .eq("client_name", CLIENT_NAME)
      .maybeSingle();

    // Lead counts
    let leadCounts: Record<string, number> = {};
    let lastSynced: string | null = null;

    if (workspaceId) {
      const { data: counts } = await sb
        .from("webuyanyhouse_imported_leads")
        .select("source_section, synced_at")
        .eq("workspace_id", workspaceId)
        .order("synced_at", { ascending: false });

      for (const row of counts ?? []) {
        leadCounts[row.source_section] = (leadCounts[row.source_section] ?? 0) + 1;
      }
      if (counts?.length) lastSynced = counts[0].synced_at;
    }

    return {
      workspaceId,
      workspaceCreated: !!workspaceId,
      apiStatus: (integration?.status ?? "disconnected") as string,
      apiUpdatedAt: integration?.updated_at ?? null,
      lastSynced,
      totalLeads: Object.values(leadCounts).reduce((a, b) => a + b, 0),
      leadCounts: {
        disqualified:     leadCounts["disqualified"]     ?? 0,
        tried_to_contact: leadCounts["tried_to_contact"] ?? 0,
        new_lead:         leadCounts["new_lead"]         ?? 0,
        unknown:          leadCounts["unknown"]          ?? 0,
      },
    };
  });

// ── Admin: Connect API using stored credentials ───────────────────────────────

export const adminConnectWebuyanyhouseApi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async () => {
    const email    = process.env.WEBESPOKE_ADMIN_EMAIL;
    const password = process.env.WEBESPOKE_ADMIN_PASSWORD;

    if (!email || !password) {
      throw new Error(
        "Set WEBESPOKE_ADMIN_EMAIL and WEBESPOKE_ADMIN_PASSWORD in Replit Secrets."
      );
    }

    const res = await loginWithPassword(email, password);
    if (!res.ok || !res.data) {
      throw new Error(res.error ?? `Login failed (HTTP ${res.status})`);
    }

    const d = res.data as any;
    const accessToken  = d.accessToken ?? d.token;
    const refreshToken = d.refreshToken ?? "";
    if (!accessToken) throw new Error("Login succeeded but no token returned");

    await (supabaseAdmin as any).from("enterprise_integrations").upsert(
      {
        integration_key: INTEGRATION_KEY,
        client_name: CLIENT_NAME,
        access_token: accessToken,
        refresh_token: refreshToken,
        user_payload: { email },
        status: "connected",
      },
      { onConflict: "integration_key,client_name" }
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

// ── Admin: Sync all leads ─────────────────────────────────────────────────────

export const adminSyncWebuyanyhouseLeads = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, requirePlatformAdmin])
  .handler(async () => {
    const workspaceId = await getWebuyanyhouseWorkspaceId();
    if (!workspaceId) throw new Error("Webuyanyhouse workspace not found. Create the account first.");

    const { getTokens, saveNewAccessToken: saveToken } = makeTokenCallbacks();

    const [carsRes, buyersRes, dealersRes] = await Promise.allSettled([
      getAllCars(getTokens, saveToken),
      getAllBuyers(getTokens, saveToken),
      getAllDealers(getTokens, saveToken),
    ]);

    const results = { properties: 0, contacts: 0, organisations: 0, errors: [] as string[] };

    // Property seller leads (cars endpoint) — full classification
    if (carsRes.status === "fulfilled" && carsRes.value.ok) {
      const records = Array.isArray(carsRes.value.data) ? carsRes.value.data : [];
      const rows = records.map((r: any) => buildLeadRow(r, workspaceId, "property"));
      const withId = rows.filter((r: any) => r.external_id !== null);
      const withoutId = rows.filter((r: any) => r.external_id === null);

      if (withId.length) await upsertLeads(withId);
      if (withoutId.length) {
        await (supabaseAdmin as any).from("webuyanyhouse_imported_leads").insert(withoutId);
      }
      results.properties = records.length;
    } else {
      results.errors.push(
        carsRes.status === "rejected"
          ? carsRes.reason?.message
          : carsRes.value?.error ?? "Properties sync failed"
      );
    }

    // Buyer/contact records — stored with source section from classification
    if (buyersRes.status === "fulfilled" && buyersRes.value.ok) {
      const records = Array.isArray(buyersRes.value.data) ? buyersRes.value.data : [];
      const rows = records.map((r: any) => ({
        ...buildLeadRow(r, workspaceId, "contact"),
        source: "webespoke_enterprise_api_buyers",
      }));
      const withId = rows.filter((r: any) => r.external_id !== null);
      if (withId.length) await upsertLeads(withId);
      results.contacts = records.length;
    } else {
      results.errors.push(
        buyersRes.status === "rejected"
          ? buyersRes.reason?.message
          : buyersRes.value?.error ?? "Contacts sync failed"
      );
    }

    // Organisation/agent records
    if (dealersRes.status === "fulfilled" && dealersRes.value.ok) {
      const records = Array.isArray(dealersRes.value.data) ? dealersRes.value.data : [];
      const rows = records.map((r: any) => ({
        ...buildLeadRow(r, workspaceId, "organisation"),
        source: "webespoke_enterprise_api_dealers",
      }));
      const withId = rows.filter((r: any) => r.external_id !== null);
      if (withId.length) await upsertLeads(withId);
      results.organisations = records.length;
    } else {
      results.errors.push(
        dealersRes.status === "rejected"
          ? dealersRes.reason?.message
          : dealersRes.value?.error ?? "Organisations sync failed"
      );
    }

    return results;
  });

// ── Workspace: Check if current workspace is Webuyanyhouse ────────────────────

export const checkWebuyanyhouseWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = supabaseAdmin as any;
    const { data } = await sb
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

// ── Workspace: Get leads (scoped to current workspace) ────────────────────────

export const getWebuyanyhouseLeads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = supabaseAdmin as any;
    const { data } = await sb
      .from("webuyanyhouse_imported_leads")
      .select("*")
      .eq("workspace_id", context.workspaceId)
      .order("synced_at", { ascending: false });
    return data ?? [];
  });

// ── Workspace: Get lead stats ─────────────────────────────────────────────────

export const getWebuyanyhouseLeadStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = supabaseAdmin as any;
    const { data } = await sb
      .from("webuyanyhouse_imported_leads")
      .select("source_section, synced_at")
      .eq("workspace_id", context.workspaceId)
      .order("synced_at", { ascending: false });

    const counts: Record<string, number> = {};
    for (const row of data ?? []) {
      counts[row.source_section] = (counts[row.source_section] ?? 0) + 1;
    }

    return {
      total:            (data ?? []).length,
      disqualified:     counts["disqualified"]     ?? 0,
      tried_to_contact: counts["tried_to_contact"] ?? 0,
      new_lead:         counts["new_lead"]         ?? 0,
      unknown:          counts["unknown"]          ?? 0,
      lastSynced:       data?.[0]?.synced_at ?? null,
    };
  });
