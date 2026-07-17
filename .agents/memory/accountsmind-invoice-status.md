---
name: AccountsMind invoice status tracking
description: Which invoice statuses count as sales and how executives consume the invoiced-sales summary
---

# AccountsMind invoice status tracking

- Invoice lifecycle statuses: unpaid (default) / sent / paid / overdue / cancelled, plus due date and paid-at timestamps.
- **Rule: only `paid` counts toward total sales; `cancelled` is excluded from every aggregate.** Overdue = status overdue OR past due date while still open.
- One shared server-side summary (`getInvoiceSalesSummary`) is the single source of truth for invoiced-sales figures; HiveMind data + AI context, GrowthMind business context, the AccountsMind dashboard, and the Invoices page KPI cards all consume it.
- **Why:** a single definition of "invoiced sales" prevents drift between the customer-facing KPIs and what the AI executives report. Consumers use graceful dynamic imports (null on failure) so a missing migration never breaks callers.
- **How to apply:** any new surface needing invoice revenue must reuse the summary — never re-aggregate from the capped invoice listing (200 rows) or a single un-paged select (PostgREST 1000-row cap silently truncates; the summary pages through all rows).
- Marking an invoice paid busts that workspace's HiveMind platform cache so executive views update immediately; the HiveMind cache key was version-bumped when invoiceSales was added to the response shape.
