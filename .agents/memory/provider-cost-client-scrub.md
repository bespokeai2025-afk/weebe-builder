---
name: Provider costs never reach client-facing surfaces
description: Retell USD cost fields are platform-admin-only; every client surface shows only the GBP usage charge
---
Rule: provider costs (Retell USD — `cost_cents`, `total_cost_cents`, `costPerCallCents`, `costPerConnectedCents`, provider reconciliation blocks) must never appear in any client-facing response or UI. Clients see only the GBP Client Usage Charge (£0.36/min). Platform admins (profiles.user_type='admin' OR user_roles admin — fail closed) may see an explicit "Admin diagnostics" block.

**Why:** WBAH saw raw Retell USD costs mislabeled as £ in campaign usage, Analytics Hub tabs, and stored report snapshots — a commercial leak of WEBEE's margin. Fixed July 2026 (campaign-usage stripping, report generators no longer store total_cost_cents, tabs/columns removed, legacy report keys hidden via METRIC_HIDDEN).

**How to apply:** Any new endpoint/report/mind-tool that aggregates call data must exclude provider-cost fields at the server (strip at response, not just UI), and generated report snapshots must never persist provider costs. Use `stripProviderCostData` + `isPlatformAdminUser` in campaign-usage.server.ts as the pattern. AccountsMind/cost-engine/platform-oversight are admin-internal and exempt.
