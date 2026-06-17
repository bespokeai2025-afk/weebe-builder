// ── AccountsMind Client Cost Aggregation Engine ───────────────────────────────
// Pulls provider costs from all existing tables and computes per-workspace
// monthly profitability. Does NOT modify cost_engine tables.

import { createClient } from "@supabase/supabase-js";

// Lazy — created on first use so the module can be imported at Vite config
// resolution time (when env vars are not yet available).
let _admin: ReturnType<typeof createClient> | null = null;
function getAdmin() {
  if (!_admin) {
    _admin = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }
  return _admin;
}
// Alias so existing function bodies keep working unchanged
const supabaseAdmin = new Proxy({} as ReturnType<typeof createClient>, {
  get(_t, prop) {
    return (getAdmin() as any)[prop];
  },
});

export interface MonthlyCostBreakdown {
  workspaceId:            string;
  month:                  string;
  monthlyChargeCents:     number;
  voiceCostCents:         number;
  llmCostCents:           number;
  telephonyCostCents:     number;
  whatsappCostCents:      number;
  emailCostCents:         number;
  videoCostCents:         number;
  imageCostCents:         number;
  storageCostCents:       number;
  infrastructureCostCents:number;
  totalCostCents:         number;
  grossProfitCents:       number;
  grossMarginPercent:     number;
  forecastMonthEndCents:  number;
  sourceBreakdown:        Record<string, number>;
}

function centsFromUsd(usd: number): number {
  return Math.round(usd * 100);
}

function monthBounds(monthDate: Date): { start: string; end: string } {
  const y = monthDate.getFullYear();
  const m = monthDate.getMonth();
  const start = new Date(y, m, 1).toISOString();
  const end   = new Date(y, m + 1, 1).toISOString();
  return { start, end };
}

export async function computeClientMonthlyCost(
  workspaceId: string,
  monthDate: Date = new Date(),
): Promise<MonthlyCostBreakdown> {
  const { start, end } = monthBounds(monthDate);
  const sb = supabaseAdmin;

  const [
    callProfRes,
    providerLogRes,
    genLogRes,
    billingRes,
  ] = await Promise.all([
    // Voice + LLM + telephony from call_profitability
    sb
      .from("call_profitability")
      .select("voice_cost_cents,llm_cost_cents,telephony_cost_cents,infra_cost_cents,total_cost_cents")
      .eq("workspace_id", workspaceId)
      .gte("created_at", start)
      .lt("created_at", end),

    // Provider usage log — WhatsApp, email, storage etc.
    sb
      .from("provider_usage_log")
      .select("provider_category,provider_name,cost_usd")
      .eq("workspace_id", workspaceId)
      .gte("created_at", start)
      .lt("created_at", end),

    // GrowthMind generation logs — video, image, LLM gen costs
    sb
      .from("growthmind_generation_logs")
      .select("task_type,provider,estimated_cost_usd")
      .eq("workspace_id", workspaceId)
      .eq("status", "success")
      .gte("created_at", start)
      .lt("created_at", end),

    // Billing profile for monthly charge
    sb
      .from("client_billing_profiles")
      .select("monthly_charge_cents")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
  ]);

  const calls    = callProfRes.data   ?? [];
  const provLog  = providerLogRes.data ?? [];
  const genLogs  = genLogRes.data     ?? [];
  const billing  = billingRes.data;

  const monthlyChargeCents = billing?.monthly_charge_cents ?? 0;

  // ── Voice + LLM + Telephony from call_profitability ───────────────────────
  let voiceCostCents      = 0;
  let llmCostCents        = 0;
  let telephonyCostCents  = 0;
  let infraFromCallsCents = 0;

  for (const c of calls) {
    voiceCostCents      += c.voice_cost_cents      ?? 0;
    llmCostCents        += c.llm_cost_cents        ?? 0;
    telephonyCostCents  += c.telephony_cost_cents  ?? 0;
    infraFromCallsCents += c.infra_cost_cents      ?? 0;
  }

  // ── Provider usage log breakdown ──────────────────────────────────────────
  let whatsappCostCents = 0;
  let emailCostCents    = 0;
  let storageCostCents  = 0;
  let crmCostCents      = 0;
  const sourceBreakdown: Record<string, number> = {};

  for (const p of provLog) {
    const cents = centsFromUsd(p.cost_usd ?? 0);
    const cat   = (p.provider_category ?? "other").toLowerCase();
    const key   = `${cat}:${p.provider_name ?? "unknown"}`;
    sourceBreakdown[key] = (sourceBreakdown[key] ?? 0) + cents;

    if (cat.includes("whatsapp") || cat.includes("wati") || cat.includes("meta")) {
      whatsappCostCents += cents;
    } else if (cat.includes("email") || cat.includes("resend") || cat.includes("sendgrid")) {
      emailCostCents += cents;
    } else if (cat.includes("storage")) {
      storageCostCents += cents;
    } else if (cat.includes("crm") || cat.includes("calendar")) {
      crmCostCents += cents;
    } else if (cat.includes("llm") || cat.includes("openai") || cat.includes("anthropic") || cat.includes("gemini")) {
      llmCostCents += cents;
    } else if (cat.includes("voice") || cat.includes("elevenlabs") || cat.includes("retell")) {
      voiceCostCents += cents;
    } else if (cat.includes("telephony") || cat.includes("twilio") || cat.includes("frejun")) {
      telephonyCostCents += cents;
    }
  }

  // ── GrowthMind generation logs ────────────────────────────────────────────
  let videoCostCents = 0;
  let imageCostCents = 0;
  let genLlmCents    = 0;

  for (const g of genLogs) {
    const cents     = centsFromUsd(g.estimated_cost_usd ?? 0);
    const taskType  = (g.task_type ?? "").toLowerCase();
    const provider  = (g.provider  ?? "").toLowerCase();

    if (taskType.includes("video") || provider === "veo" || provider === "runway") {
      videoCostCents += cents;
    } else if (taskType.includes("image") || provider.includes("imagen") || provider.includes("dall")) {
      imageCostCents += cents;
    } else {
      genLlmCents += cents;
    }
  }
  llmCostCents += genLlmCents;

  // ── Infrastructure — fixed monthly share ──────────────────────────────────
  const infrastructureCostCents = infraFromCallsCents;

  // ── Totals ────────────────────────────────────────────────────────────────
  const totalCostCents =
    voiceCostCents +
    llmCostCents +
    telephonyCostCents +
    whatsappCostCents +
    emailCostCents +
    videoCostCents +
    imageCostCents +
    storageCostCents +
    infrastructureCostCents +
    crmCostCents;

  const grossProfitCents  = monthlyChargeCents - totalCostCents;
  const grossMarginPercent =
    monthlyChargeCents > 0
      ? Math.round((grossProfitCents / monthlyChargeCents) * 10000) / 100
      : 0;

  // ── Forecast ──────────────────────────────────────────────────────────────
  const now          = new Date();
  const daysInMonth  = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysElapsed  = Math.max(1, now.getDate());
  const runRate      = totalCostCents / daysElapsed;
  const forecastMonthEndCents =
    monthDate.getMonth() === now.getMonth() && monthDate.getFullYear() === now.getFullYear()
      ? Math.round(runRate * daysInMonth)
      : totalCostCents;

  const monthStr = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1)
    .toISOString()
    .split("T")[0];

  return {
    workspaceId,
    month: monthStr,
    monthlyChargeCents,
    voiceCostCents,
    llmCostCents,
    telephonyCostCents,
    whatsappCostCents,
    emailCostCents,
    videoCostCents,
    imageCostCents,
    storageCostCents,
    infrastructureCostCents,
    totalCostCents,
    grossProfitCents,
    grossMarginPercent,
    forecastMonthEndCents,
    sourceBreakdown,
  };
}

export async function upsertClientMonthlyCost(
  breakdown: MonthlyCostBreakdown,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("client_monthly_costs")
    .upsert(
      {
        workspace_id:              breakdown.workspaceId,
        month:                     breakdown.month,
        monthly_charge_cents:      breakdown.monthlyChargeCents,
        total_cost_cents:          breakdown.totalCostCents,
        voice_cost_cents:          breakdown.voiceCostCents,
        llm_cost_cents:            breakdown.llmCostCents,
        telephony_cost_cents:      breakdown.telephonyCostCents,
        whatsapp_cost_cents:       breakdown.whatsappCostCents,
        email_cost_cents:          breakdown.emailCostCents,
        video_cost_cents:          breakdown.videoCostCents,
        image_cost_cents:          breakdown.imageCostCents,
        storage_cost_cents:        breakdown.storageCostCents,
        infrastructure_cost_cents: breakdown.infrastructureCostCents,
        gross_profit_cents:        breakdown.grossProfitCents,
        gross_margin_percent:      breakdown.grossMarginPercent,
        source_breakdown_json:     breakdown.sourceBreakdown,
        computed_at:               new Date().toISOString(),
        updated_at:                new Date().toISOString(),
      },
      { onConflict: "workspace_id,month" },
    );
  if (error) throw new Error(`Failed to upsert monthly cost: ${error.message}`);
}

export async function generateAccountsMindAlerts(
  workspaceId: string,
  breakdown: MonthlyCostBreakdown,
  workspaceName: string,
): Promise<void> {
  const sb      = supabaseAdmin;
  const alerts: object[] = [];
  const now     = new Date().toISOString();

  // Low margin warning
  if (breakdown.monthlyChargeCents > 0 && breakdown.grossMarginPercent < 20) {
    const severity = breakdown.grossMarginPercent < 0 ? "critical" : "warning";
    alerts.push({
      workspace_id:     workspaceId,
      alert_type:       "low_margin",
      severity,
      title:            breakdown.grossMarginPercent < 0
        ? `${workspaceName} is loss-making this month`
        : `${workspaceName} has low margin (${breakdown.grossMarginPercent.toFixed(1)}%)`,
      message:          `Monthly charge: £${(breakdown.monthlyChargeCents / 100).toFixed(2)}. Total cost: £${(breakdown.totalCostCents / 100).toFixed(2)}. Gross margin: ${breakdown.grossMarginPercent.toFixed(1)}%.`,
      amount_cents:     breakdown.grossProfitCents,
      status:           "open",
      created_at:       now,
    });
  }

  // Forecast exceeds charge
  if (
    breakdown.monthlyChargeCents > 0 &&
    breakdown.forecastMonthEndCents > breakdown.monthlyChargeCents
  ) {
    alerts.push({
      workspace_id:     workspaceId,
      alert_type:       "forecast_overrun",
      severity:         "warning",
      title:            `${workspaceName} forecast to exceed monthly charge`,
      message:          `At current run-rate, month-end costs will be £${(breakdown.forecastMonthEndCents / 100).toFixed(2)} against a £${(breakdown.monthlyChargeCents / 100).toFixed(2)} charge.`,
      amount_cents:     breakdown.forecastMonthEndCents - breakdown.monthlyChargeCents,
      status:           "open",
      created_at:       now,
    });
  }

  // High video cost
  if (breakdown.videoCostCents > 5000) {
    alerts.push({
      workspace_id:     workspaceId,
      alert_type:       "high_video_cost",
      severity:         "info",
      title:            `${workspaceName} video generation cost is high (£${(breakdown.videoCostCents / 100).toFixed(2)})`,
      message:          `Video generation has used £${(breakdown.videoCostCents / 100).toFixed(2)} this month. Consider reviewing generation frequency.`,
      provider_category:"video",
      amount_cents:     breakdown.videoCostCents,
      status:           "open",
      created_at:       now,
    });
  }

  if (alerts.length > 0) {
    await sb.from("accountsmind_alerts").insert(alerts);
  }
}
