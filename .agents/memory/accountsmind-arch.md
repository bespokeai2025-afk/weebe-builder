---
name: AccountsMind architecture
description: AccountsMind client costing + profit monitoring system — DB schema, aggregation engine, route structure, and integration points.
---

## Schema (4 tables — manual migration ACCOUNTSMIND_MIGRATION.sql)
- `client_billing_profiles` — per-workspace monthly charge config (monthly_charge_cents, currency, included_*, contract dates, status)
- `client_monthly_costs` — pre-computed monthly snapshots per workspace (voice/llm/telephony/whatsapp/email/video/image/storage/infra costs + gross_profit/margin)
- `provider_recharge_events` — platform-level credit top-up tracking (manual + future API ingestion)
- `accountsmind_alerts` — margin/cost/usage alerts with severity (info/warning/critical)

## Cost Aggregation Sources
- `call_profitability` → voice_cost_cents, llm_cost_cents, telephony_cost_cents, infra_cost_cents
- `provider_usage_log` → WhatsApp, email, storage, CRM costs (cost_usd column)
- `growthmind_generation_logs` → video, image, LLM generation costs (estimated_cost_usd)
- Billing profile `monthly_charge_cents` → revenue side

## Routes
- `/admin/accounts` — dashboard (KPIs, alerts, recharges, best/worst client)
- `/admin/accounts/clients` — list with billing profile editor dialog
- `/admin/accounts/workspace/$id` — per-client detail (NOT client.$id — see import-protection-trap.md)
- `/admin/accounts/costs` — provider cost breakdown table
- `/admin/accounts/recharges` — recharge event log + manual entry
- `/admin/accounts/profitability` — ranked margin table
- `/admin/accounts/alerts` — alert centre with resolve action
- `/admin/accounts/settings` — threshold docs + data source list

## Server logic
- `src/lib/accountsmind/client-costing.server.ts` — pure aggregation engine (computeClientMonthlyCost, upsertClientMonthlyCost, generateAccountsMindAlerts)
- `src/lib/accountsmind/accountsmind.functions.ts` — TanStack server fn wrappers (all admin-gated with requireSupabaseAuth + requirePlatformAdmin)

## Integrations
- **HiveMind**: block added at end of `generateOperatorActions` (before insert) — proposes `review_client_pricing` action for margin < 20%, surfaces critical alerts as tasks. Wrapped in try/catch (graceful if tables don't exist).
- **GrowthMind**: block added at end of `generateGrowthRecommendations` — reads `data.profitability` (optional injection); warns against expensive campaigns for low/negative margin clients.
- **Admin nav**: AccountsMind link added to admin.users.tsx header nav.

**Why:** Separate profitability layer (not merged into cost engine) to avoid breaking existing /admin/cost-engine, which is a pure rate-config tool. AccountsMind tracks actuals vs charges.

## Metric snapshots (trend/progress widget history)
- `accountsmind_metric_snapshots` — one row per ws+metric_key+UTC day (unique upsert), server-write-only (REVOKE ALL, members SELECT via RLS).
- Captured best-effort (never throws) from: client-config load, admin metric compute, workspace health check, and a once-per-ws-per-day sweep (`runMetricSnapshotSweepServer`) inside the campaign-executor cron route.
- **Trap:** never hook snapshot code into `accountsmind-scheduler.plugin.ts`/`executor.ts` — they load from vite.config context where `@/` aliases don't resolve; the cron ROUTE is app code and is safe.
- Client series exposure is safe by construction: series returned only for metric keys on `client_visible` trend/progress widgets; sensitive metrics are never client_visible.
- Sparkline UI: `MetricSparkline.tsx` renders when ≥2 daily points; otherwise "Collecting daily history" note.
