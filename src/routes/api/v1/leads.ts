/**
 * WEBEE Developer API v1 — Leads
 * GET  /api/v1/leads        — list leads (leads:read; JWT or API key)
 *      Query params:
 *        status         — lead status equals
 *        created_from / created_to — date-only (YYYY-MM-DD, workspace-timezone
 *                         day boundaries; WBAH = Europe/London) or ISO datetime
 *        filter         — URL-encoded JSON FilterConfig using the canonical
 *                         lead filter registry (same fields as saved views)
 *        limit / offset — pagination (limit ≤ 200)
 *      JWT callers with an assigned-records-only role (e.g. sales agents)
 *      are row-filtered to their own leads — fail closed.
 * POST /api/v1/leads        — create lead (leads:write; API key)
 */
import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { authenticateV1Request, jsonOk, jsonErr } from "@/lib/developer-api/v1-auth.middleware";
import { authenticateMindApiRequest } from "@/lib/developer-api/mind-auth.middleware";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const sb = () => createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

export const Route = createFileRoute("/api/v1/leads")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Dual auth: workspace API key (HMAC) or Supabase user JWT.
        const auth = await authenticateMindApiRequest(request, "leads:read");
        if (!auth.ok) return auth.response;
        const { workspaceId, userId } = auth.ctx;

        const url     = new URL(request.url);
        const limit   = Math.min(Math.max(parseInt(url.searchParams.get("limit") ?? "50") || 50, 1), 200);
        const offset  = Math.max(parseInt(url.searchParams.get("offset") ?? "0") || 0, 0);
        const status  = url.searchParams.get("status");
        const createdFrom = url.searchParams.get("created_from");
        const createdTo   = url.searchParams.get("created_to");
        const rawFilter   = url.searchParams.get("filter");

        // Assigned-records-only enforcement (JWT callers). Fail CLOSED: if
        // the caller's permissions cannot be resolved, refuse rather than
        // serving the whole workspace.
        let restrictToUserId: string | null = null;
        if (userId) {
          try {
            const { resolvePermissions } = await import("@/lib/permissions/permissions.server");
            const perms = await resolvePermissions(workspaceId, userId);
            if (!perms.isMember) return jsonErr("Not a member of this workspace", 403);
            if (perms.assignedRecordsOnly) restrictToUserId = userId;
          } catch (err: any) {
            return jsonErr("Could not resolve caller permissions", 500);
          }
        }

        // Canonical registry filter (same fields as saved views/pages).
        let filterConfig: any = null;
        const engine = await import("@/lib/people-views/filter-engine.server");
        if (rawFilter != null && rawFilter !== "") {
          let parsed: unknown;
          try { parsed = JSON.parse(rawFilter); }
          catch { return jsonErr("filter must be URL-encoded JSON", 400); }
          const v = engine.validateFilterConfig(parsed, {
            // API-key callers have no person — assigned_to_me is meaningless
            // and must be rejected rather than silently matching nothing.
            disallowFields: userId ? [] : ["assigned_to_me"],
          });
          if (!v.ok) return jsonErr(`Invalid filter: ${v.errors.join("; ")}`, 400);
          filterConfig = v.config;
        }

        // Date-only range params resolve to workspace-timezone day
        // boundaries (WBAH = Europe/London, otherwise UTC) — parity with
        // the web pages' date filters.
        const { isWbahWorkspaceId } = await import("@/lib/wbah-exclusion.shared");
        const tz = isWbahWorkspaceId(workspaceId) ? "Europe/London" : "UTC";
        const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
        const boundaryIso = (value: string, endOfDay: boolean): string | null => {
          if (!dateOnly.test(value)) {
            const ms = new Date(value).getTime();
            return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
          }
          // DST-safe: end-of-day = next local calendar day start − 1 ms.
          const startOfDayMs = (v: string): number => {
            const probe = new Date(`${v}T00:00:00Z`);
            const dtf = new Intl.DateTimeFormat("en-GB", {
              timeZone: tz, hour12: false,
              year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
            });
            const parts = Object.fromEntries(dtf.formatToParts(probe).map((p) => [p.type, p.value]));
            const tzAsUtc = Date.UTC(
              +parts.year, +(parts.month as any) - 1, +parts.day,
              +(parts.hour === "24" ? 0 : parts.hour), +parts.minute,
            );
            return probe.getTime() - (tzAsUtc - probe.getTime());
          };
          if (!endOfDay) return new Date(startOfDayMs(value)).toISOString();
          const d = new Date(`${value}T00:00:00Z`);
          d.setUTCDate(d.getUTCDate() + 1);
          return new Date(startOfDayMs(d.toISOString().slice(0, 10)) - 1).toISOString();
        };

        let fromIso: string | null = null;
        let toIso: string | null = null;
        if (createdFrom) {
          fromIso = boundaryIso(createdFrom, false);
          if (!fromIso) return jsonErr("created_from is not a valid date", 400);
        }
        if (createdTo) {
          toIso = boundaryIso(createdTo, true);
          if (!toIso) return jsonErr("created_to is not a valid date", 400);
        }

        // ?preset= shorthand — maps to canonical filter fields.
        // Applied BEFORE the explicit ?filter= param so filter can further narrow.
        const preset = url.searchParams.get("preset");
        const PRESET_FILTERS: Record<string, Record<string, unknown>> = {
          qualified:        { status: "qualified" },
          positive:         { sentiment: "positive" },
          booked:           { meeting_requested: true },
          needs_calling:    { status: "need_to_call" },
          buzzchat_replied: { has_buzzchat_reply: true },
        };
        // assigned_to_me resolved below (needs userId)

        // origin= filter param (canonical lead_origin channel)
        const originFilter = url.searchParams.get("origin");

        let q = sb().from("leads")
          .select(
            "id, full_name, phone, email, status, pipeline_stage, source, source_detail, created_at, updated_at, " +
            "assigned_to, assigned_at, assigned_by, " +
            "has_buzzchat_reply, last_buzzchat_reply_at, buzzchat_conversation_id, " +
            "lead_origin, origin_provider",
            { count: "exact" },
          )
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false })
          .range(offset, offset + limit - 1);

        // Apply preset filter first.
        if (preset === "assigned_to_me") {
          if (!userId) return jsonErr("preset=assigned_to_me requires JWT auth", 400);
          q = q.eq("assigned_to", userId);
        } else if (preset && PRESET_FILTERS[preset]) {
          const pf = PRESET_FILTERS[preset];
          for (const [col, val] of Object.entries(pf)) {
            q = (q as any).eq(col, val);
          }
        } else if (preset) {
          return jsonErr(`Unknown preset '${preset}'. Valid: ${Object.keys(PRESET_FILTERS).concat("assigned_to_me").join(", ")}`, 400);
        }

        if (status) q = q.eq("status", status);
        if (originFilter) q = q.eq("lead_origin", originFilter);
        if (fromIso) q = q.gte("created_at", fromIso);
        if (toIso) q = q.lte("created_at", toIso);
        if (filterConfig) {
          q = engine.applyFilterToQuery(q, filterConfig, undefined, { currentUserId: userId ?? null });
        }
        // Row-level restriction LAST so nothing can widen it.
        if (restrictToUserId) q = q.eq("assigned_to", restrictToUserId);

        const { data, error, count } = await q;
        if (error) return jsonErr(error.message, 500);

        // Enrich each row with camelCase canonical origin fields for mobile consumers.
        const ORIGIN_LABELS: Record<string, string> = {
          whatsapp: "WhatsApp", voice_call: "Voice", web_form: "Web Form",
          manual: "Manual", csv_import: "CSV / Import", crm: "CRM",
          email: "Email", sms: "SMS", campaign: "Campaign", api: "API", unknown: "Unknown",
        };
        const enriched = (data ?? []).map((row: any) => ({
          ...row,
          leadOrigin:     row.lead_origin   ?? null,
          originProvider: row.origin_provider ?? null,
          originLabel:    ORIGIN_LABELS[row.lead_origin as string] ?? row.lead_origin ?? null,
        }));

        return jsonOk({
          object: "list",
          data: enriched,
          total: count ?? null,
          limit,
          offset,
          assigned_records_only: restrictToUserId != null,
        });
      },

      POST: async ({ request }) => {
        const auth = await authenticateV1Request(request, "leads:write");
        if (!auth.ok) return auth.response;
        const { workspaceId } = auth.ctx;

        let body: any;
        try { body = await request.json(); }
        catch { return jsonErr("Invalid JSON body"); }

        const { name, full_name, phone, email, source, status, pipeline_stage, notes } = body ?? {};
        const leadName = full_name ?? name;
        if (!leadName && !phone && !email) {
          return jsonErr("At least one of: full_name, phone, email is required");
        }

        const { data, error } = await sb().from("leads").insert({
          workspace_id:    workspaceId,
          full_name:       leadName ?? null,
          name:            leadName ?? null,
          phone:           phone    ?? null,
          email:           email    ?? null,
          source:          source   ?? "api",
          lead_origin:     "api",
          origin_provider: "API",
          status:          status   ?? "new",
          pipeline_stage:  pipeline_stage ?? null,
          notes:           notes ?? null,
          created_at:      new Date().toISOString(),
          updated_at:      new Date().toISOString(),
        }).select("id, full_name, phone, email, status, source, lead_origin, origin_provider, created_at").single();

        if (error) return jsonErr(error.message, 500);

        // Fire webhook event (fire-and-forget)
        import("@/lib/developer-api/webhook-delivery.server")
          .then(m => m.fireWebhookEvent(workspaceId, "lead.created", data))
          .catch(() => {});

        // New-lead notification — best-effort, never throws.
        import("@/lib/lead-gen/lead-notify.server")
          .then(m => m.notifyNewLead({
            workspaceId, leadId: data.id,
            name: data.full_name, phone: data.phone, email: data.email,
            source: `API${data.source ? ` (${data.source})` : ""}`,
          }))
          .catch(() => {});

        // Auto-call automation — best-effort, never throws.
        const { triggerAutoCallForNewLead } = await import("@/lib/qualification/auto-call.server");
        await triggerAutoCallForNewLead(sb(), { workspaceId, leadId: data.id });

        return jsonOk({ object: "lead", ...data }, 201);
      },
    },
  },
});
