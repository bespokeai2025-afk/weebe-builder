/**
 * Google Ads click-conversion upload (server-only, best-effort).
 *
 * Uploads a single click conversion for a recorded conversion_events row via
 * `customers/{cid}:uploadClickConversions`. Strictly gated:
 *   - the event must carry a REAL gclid / gbraid / wbraid (never fabricated);
 *   - the workspace's google_ads provider settings must contain
 *     `uploadConversionActionId` — the numeric ID of an upload-type
 *     conversion action created in Google Ads (an Ads-side change that is
 *     drafted for separate approval, never applied automatically here);
 *   - a connected Google Ads account row must resolve a customer ID.
 * When any gate fails, the event keeps an honest status ("pending_config")
 * instead of pretending Google acknowledged it.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolveConversionActionId } from "@/lib/tracking/datamanager-upload.server";

interface ConversionEventRow {
  id: string;
  workspace_id: string;
  conversion_name: string;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  created_at: string;
  delivery_status: string;
}

export interface UploadTarget {
  customerId: string;
  loginCustomerId: string | null;
  conversionActionId: string | null;
}

/** Resolve the workspace's Google Ads upload target (account + action). */
export async function resolveGadsUploadTarget(
  workspaceId: string,
  conversionName?: string | null,
): Promise<UploadTarget | null> {
  const { data: acc } = await supabaseAdmin
    .from("growthmind_ads_accounts")
    .select("customer_id, login_customer_id")
    .eq("workspace_id", workspaceId)
    .eq("platform", "google")
    .not("customer_id", "is", null)
    .limit(1)
    .maybeSingle();
  const customerId = (acc as { customer_id?: string | null } | null)?.customer_id?.replace(/\D/g, "") ?? "";
  if (!customerId) return null;

  const { data: ps } = await supabaseAdmin
    .from("provider_settings")
    .select("credentials")
    .eq("workspace_id", workspaceId)
    .eq("provider_category", "advertising")
    .eq("provider_name", "google_ads")
    .maybeSingle();
  const creds = ((ps as { credentials?: Record<string, string> } | null)?.credentials ?? {});
  const conversionActionId = resolveConversionActionId(creds, conversionName ?? null);

  return {
    customerId,
    loginCustomerId:
      (acc as { login_customer_id?: string | null } | null)?.login_customer_id?.replace(/\D/g, "") || null,
    conversionActionId,
  };
}

/** Google Ads wants "yyyy-MM-dd HH:mm:ss+00:00". */
function toGadsDateTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}+00:00`;
}

/**
 * Attempt the upload for one event. Updates the row's delivery_status and
 * provider_response with the honest outcome. Never throws.
 */
export async function maybeUploadClickConversion(eventId: string): Promise<void> {
  try {
    const { data } = await supabaseAdmin
      .from("conversion_events")
      .select("id, workspace_id, conversion_name, gclid, gbraid, wbraid, created_at, delivery_status, record_ref")
      .eq("id", eventId)
      .maybeSingle();
    const ev = data as (ConversionEventRow & { record_ref?: Record<string, unknown> | null }) | null;
    if (!ev) return;
    if (!(ev.gclid || ev.gbraid || ev.wbraid)) return; // never upload without real attribution
    // LEGACY adapter — disabled by default. Runs only behind the explicit
    // legacyClickConversionFallback="true" flag in google_ads provider
    // settings (documented fallback for proven allowlisted accounts). The
    // primary transport is the Data Manager API (datamanager-upload.server.ts).
    {
      const { data: ps } = await supabaseAdmin
        .from("provider_settings")
        .select("credentials")
        .eq("workspace_id", ev.workspace_id)
        .eq("provider_category", "advertising")
        .eq("provider_name", "google_ads")
        .maybeSingle();
      const flag = ((ps as { credentials?: Record<string, string> } | null)?.credentials ?? {})
        .legacyClickConversionFallback;
      if (flag !== "true") {
        await supabaseAdmin
          .from("conversion_events")
          .update({
            delivery_status: "pending_config",
            last_error: "Legacy uploadClickConversions is disabled — Data Manager API is the primary transport",
            updated_at: new Date().toISOString(),
          } as never)
          .eq("id", ev.id)
          .in("delivery_status", ["recorded", "queued"]);
        return;
      }
    }
    // Idempotency: claim the event before uploading (same CAS rule as the
    // Data Manager transport — legacy and DM can never both run one event).
    {
      const { data: claimed } = await supabaseAdmin
        .from("conversion_events")
        .update({ delivery_status: "upload_attempted", updated_at: new Date().toISOString() } as never)
        .eq("id", ev.id)
        .in("delivery_status", ["recorded", "queued"])
        .select("id");
      if (!claimed || (claimed as unknown[]).length === 0) return;
    }

    const setStatus = async (
      status: string,
      patch: Record<string, unknown> = {},
    ) => {
      await supabaseAdmin
        .from("conversion_events")
        .update({ delivery_status: status, updated_at: new Date().toISOString(), ...patch } as never)
        .eq("id", ev.id);
    };

    const target = await resolveGadsUploadTarget(ev.workspace_id, ev.conversion_name);
    if (!target || !target.conversionActionId) {
      await setStatus("pending_config", {
        last_error: !target
          ? "No connected Google Ads account for workspace"
          : "uploadConversionActionId not configured in google_ads provider settings",
      });
      return;
    }

    const { loadGadsCreds, getGadsAccessToken, GADS_BASE } =
      await import("@/lib/growthmind/gads-live-core.server");
    const creds = await loadGadsCreds(ev.workspace_id);
    if (!creds.developerToken) {
      await setStatus("pending_config", { last_error: "Google Ads developer token missing" });
      return;
    }
    const token = await getGadsAccessToken(ev.workspace_id, creds);

    const conversion: Record<string, unknown> = {
      conversionAction: `customers/${target.customerId}/conversionActions/${target.conversionActionId}`,
      conversionDateTime: toGadsDateTime(ev.created_at),
      // Provider-side dedup: the order/booking reference wins when present.
      ...(typeof ev.record_ref?.order_id === "string" && ev.record_ref.order_id
        ? { orderId: ev.record_ref.order_id }
        : {}),
    };
    if (ev.gclid) conversion.gclid = ev.gclid;
    else if (ev.gbraid) conversion.gbraid = ev.gbraid;
    else if (ev.wbraid) conversion.wbraid = ev.wbraid;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "developer-token": creds.developerToken,
      "Content-Type": "application/json",
    };
    if (target.loginCustomerId) headers["login-customer-id"] = target.loginCustomerId;
    else if (creds.managerId) headers["login-customer-id"] = creds.managerId.replace(/\D/g, "");

    const res = await fetch(
      `${GADS_BASE}/customers/${target.customerId}:uploadClickConversions`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ conversions: [conversion], partialFailure: true }),
      },
    );
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    const partialError = (json.partialFailureError ?? null) as Record<string, unknown> | null;
    if (!res.ok || json.error) {
      await setStatus("upload_failed", {
        provider_response: json,
        last_error: `HTTP ${res.status}: ${JSON.stringify((json as any).error?.message ?? json).slice(0, 400)}`,
      });
      return;
    }
    if (partialError) {
      await setStatus("upload_failed", {
        provider_response: json,
        last_error: String((partialError as any).message ?? "partial failure").slice(0, 400),
      });
      return;
    }
    await setStatus("uploaded", {
      provider_response: json,
      uploaded_at: new Date().toISOString(),
      last_error: null,
    });
    console.log("[CONVERSION] Google acknowledged click conversion", { eventId: ev.id });
  } catch (err) {
    console.error("[CONVERSION] maybeUploadClickConversion errored:", (err as Error)?.message);
    try {
      await supabaseAdmin
        .from("conversion_events")
        .update({
          delivery_status: "upload_failed",
          last_error: String((err as Error)?.message ?? "unknown").slice(0, 400),
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id", eventId);
    } catch { /* best-effort */ }
  }
}
