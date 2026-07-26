/**
 * AccountsMind typed financial audit work orders — Task #490 (section 16).
 *
 * AccountsMind commands must inspect ACTUAL clients/invoices/amounts/due
 * dates/outgoings/renewals and produce typed audits: records inspected,
 * exceptions with amounts and commercial impact, the exact proposed action,
 * the approval requirement and the evidence — never a shallow "Review
 * invoices" task.
 *
 * Honesty rules:
 *  - Every figure comes from real accountsmind_invoices /
 *    accountsmind_recurring_invoices rows read in this run — cents-only math,
 *    never invented amounts.
 *  - The final Execute stage is billing-sensitive and created BLOCKED behind
 *    the Findings/Actions approvals; nothing financial is changed by this
 *    proposal.
 *  - WBAH is excluded entirely.
 */
import {
  insertWorkOrderWithStageTasks,
  stagePacket,
  type StageTaskSpec,
} from "@/lib/hivemind/channel-work-orders.server";
import type { PacketEvidence, PacketTarget } from "@/lib/minds/intelligence-packet.shared";

type Sb = any;

export type FinancialAuditKind =
  | "invoice_audit"
  | "renewals_audit"
  | "client_costing_audit"
  | "outgoings_audit";

export const FINANCIAL_AUDIT_STAGES = [
  { key: "findings_review",  label: "Findings Review",  kind: "analysis",  finalSend: false },
  { key: "proposed_actions", label: "Proposed Actions", kind: "analysis",  finalSend: false },
  { key: "execute",          label: "Execute Actions",  kind: "execution", finalSend: true  },
] as const;

export interface FinancialAuditException {
  record_type: string;
  record_id: string;
  reference: string | null;
  client: string | null;
  amount_cents: number;
  currency: string;
  due_date: string | null;
  issue: string;
  commercial_impact: string;
  proposed_action: string;
  approval_requirement: string;
}

export interface FinancialAuditResult {
  kind: FinancialAuditKind;
  records_inspected: number;
  exceptions: FinancialAuditException[];
  totals: Record<string, number>;
  currency: string;
}

const OPEN_STATUSES = new Set(["unpaid", "sent", "overdue"]);

function pounds(cents: number, currency: string): string {
  const sym = currency === "GBP" ? "£" : currency === "USD" ? "$" : currency === "EUR" ? "€" : `${currency} `;
  return `${sym}${(cents / 100).toFixed(2)}`;
}

// ── Typed audits (real rows only) ────────────────────────────────────────────
// These are exported so execution adapters can run a pure read-only audit
// without calling createFinancialAuditWorkOrderCore (which inserts rows).

export async function runInvoiceAudit(sb: Sb, workspaceId: string): Promise<FinancialAuditResult> {
  const { data, error } = await sb.from("accountsmind_invoices")
    .select("id, invoice_number, client_name, status, total_cents, amount_paid_cents, currency, due_date, issue_date, paid_at")
    .eq("workspace_id", workspaceId)
    .neq("storage_path", "pending")
    .limit(1000);
  if (error) throw new Error(error.message);
  const rows: any[] = data ?? [];
  const currency = rows[0]?.currency ?? "GBP";
  const today = new Date().toISOString().slice(0, 10);

  const exceptions: FinancialAuditException[] = [];
  let outstandingCents = 0;
  let overdueCents = 0;

  for (const inv of rows) {
    if (inv.status === "cancelled" || inv.status === "paid" || inv.status === "draft") continue;
    if (!OPEN_STATUSES.has(String(inv.status))) continue;
    const outstanding = Math.max(0, Number(inv.total_cents ?? 0) - Number(inv.amount_paid_cents ?? 0));
    if (outstanding <= 0) continue;
    outstandingCents += outstanding;
    const isOverdue = inv.due_date && String(inv.due_date) < today;
    if (isOverdue) overdueCents += outstanding;
    exceptions.push({
      record_type: "invoice",
      record_id: String(inv.id),
      reference: inv.invoice_number ?? null,
      client: inv.client_name ?? null,
      amount_cents: outstanding,
      currency: String(inv.currency ?? currency),
      due_date: inv.due_date ?? null,
      issue: isOverdue
        ? `Overdue: due ${inv.due_date}, ${pounds(outstanding, inv.currency ?? currency)} unpaid.`
        : `Outstanding: ${pounds(outstanding, inv.currency ?? currency)} unpaid (due ${inv.due_date ?? "no due date"}).`,
      commercial_impact: `${pounds(outstanding, inv.currency ?? currency)} of revenue is ${isOverdue ? "overdue" : "uncollected"} from ${inv.client_name ?? "an unnamed client"}.`,
      proposed_action: isOverdue
        ? `Send a payment reminder for invoice ${inv.invoice_number ?? inv.id} and record any received payment.`
        : `Monitor invoice ${inv.invoice_number ?? inv.id} until its due date; chase on the due date if unpaid.`,
      approval_requirement: "Sending reminders or recording payments requires billing approval (sensitive).",
    });
  }

  return {
    kind: "invoice_audit",
    records_inspected: rows.length,
    exceptions: exceptions.sort((a, b) => b.amount_cents - a.amount_cents),
    totals: { outstanding_cents: outstandingCents, overdue_cents: overdueCents },
    currency,
  };
}

export async function runRenewalsAudit(sb: Sb, workspaceId: string): Promise<FinancialAuditResult> {
  const { data, error } = await sb.from("accountsmind_recurring_invoices")
    .select("id, name, active, day_of_month, last_generated_month, currency, items_json, due_days")
    .eq("workspace_id", workspaceId)
    .limit(500);
  if (error) throw new Error(error.message);
  const rows: any[] = data ?? [];
  const currency = rows[0]?.currency ?? "GBP";
  const now = new Date();
  const month = now.toISOString().slice(0, 7);
  const dayOfMonth = now.getUTCDate();

  const exceptions: FinancialAuditException[] = [];
  let missedCents = 0;

  for (const sched of rows) {
    const items: any[] = Array.isArray(sched.items_json) ? sched.items_json : [];
    const scheduleCents = items.reduce(
      (sum, it) => sum + Math.round(Number(it.unit_price_cents ?? it.unit_amount_cents ?? 0) * Number(it.quantity ?? 1)),
      0,
    );
    if (!sched.active) {
      exceptions.push({
        record_type: "recurring_invoice",
        record_id: String(sched.id),
        reference: sched.name ?? null,
        client: null,
        amount_cents: scheduleCents,
        currency: String(sched.currency ?? currency),
        due_date: null,
        issue: `Recurring schedule "${sched.name}" is inactive.`,
        commercial_impact: `${pounds(scheduleCents, sched.currency ?? currency)}/month is not being billed while this schedule is inactive.`,
        proposed_action: `Confirm whether "${sched.name}" should be reactivated or archived.`,
        approval_requirement: "Reactivating billing requires billing approval (sensitive).",
      });
      continue;
    }
    const missed = sched.last_generated_month !== month && dayOfMonth >= Number(sched.day_of_month ?? 1);
    if (missed) {
      missedCents += scheduleCents;
      exceptions.push({
        record_type: "recurring_invoice",
        record_id: String(sched.id),
        reference: sched.name ?? null,
        client: null,
        amount_cents: scheduleCents,
        currency: String(sched.currency ?? currency),
        due_date: `${month}-${String(sched.day_of_month ?? 1).padStart(2, "0")}`,
        issue: `Schedule "${sched.name}" was due on day ${sched.day_of_month} but has not generated for ${month} (last generated: ${sched.last_generated_month ?? "never"}).`,
        commercial_impact: `${pounds(scheduleCents, sched.currency ?? currency)} of expected ${month} billing has not been raised.`,
        proposed_action: `Investigate why the recurring tick skipped "${sched.name}" and raise the ${month} invoice if genuinely missed.`,
        approval_requirement: "Raising an invoice requires billing approval (sensitive).",
      });
    }
  }

  return {
    kind: "renewals_audit",
    records_inspected: rows.length,
    exceptions,
    totals: { missed_this_month_cents: missedCents },
    currency,
  };
}

export async function runClientCostingAudit(sb: Sb, workspaceId: string): Promise<FinancialAuditResult> {
  const { data, error } = await sb.from("accountsmind_invoices")
    .select("id, invoice_number, client_name, status, total_cents, amount_paid_cents, currency, paid_at, due_date")
    .eq("workspace_id", workspaceId)
    .neq("storage_path", "pending")
    .limit(1000);
  if (error) throw new Error(error.message);
  const rows: any[] = data ?? [];
  const currency = rows[0]?.currency ?? "GBP";

  const byClient = new Map<string, { paid: number; outstanding: number; count: number }>();
  for (const inv of rows) {
    if (inv.status === "cancelled" || inv.status === "draft") continue;
    const key = String(inv.client_name ?? "Unnamed client");
    const agg = byClient.get(key) ?? { paid: 0, outstanding: 0, count: 0 };
    agg.count++;
    if (inv.status === "paid") agg.paid += Number(inv.total_cents ?? 0);
    else if (OPEN_STATUSES.has(String(inv.status))) {
      agg.outstanding += Math.max(0, Number(inv.total_cents ?? 0) - Number(inv.amount_paid_cents ?? 0));
    }
    byClient.set(key, agg);
  }

  const exceptions: FinancialAuditException[] = [];
  for (const [client, agg] of byClient) {
    if (agg.outstanding > 0 && agg.outstanding >= agg.paid) {
      exceptions.push({
        record_type: "client",
        record_id: client,
        reference: null,
        client,
        amount_cents: agg.outstanding,
        currency,
        due_date: null,
        issue: `Client "${client}" owes ${pounds(agg.outstanding, currency)} against only ${pounds(agg.paid, currency)} ever paid (${agg.count} invoice(s)).`,
        commercial_impact: `Collection risk: unpaid balance equals or exceeds this client's total paid revenue.`,
        proposed_action: `Review the account with "${client}": chase the outstanding balance and consider payment terms before further work.`,
        approval_requirement: "Client outreach on billing requires billing approval (sensitive).",
      });
    }
  }

  return {
    kind: "client_costing_audit",
    records_inspected: rows.length,
    exceptions: exceptions.sort((a, b) => b.amount_cents - a.amount_cents),
    totals: {
      clients: byClient.size,
      total_outstanding_cents: [...byClient.values()].reduce((s, a) => s + a.outstanding, 0),
    },
    currency,
  };
}

export async function runOutgoingsAudit(sb: Sb, workspaceId: string): Promise<FinancialAuditResult> {
  // Real provider spend rows (USD) — this month vs the previous month, per provider.
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const prevStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString();
  const [cur, prev] = await Promise.all([
    sb.from("provider_usage_log")
      .select("provider_category, provider_name, cost_usd")
      .eq("workspace_id", workspaceId).gte("created_at", monthStart).limit(5000),
    sb.from("provider_usage_log")
      .select("provider_category, provider_name, cost_usd")
      .eq("workspace_id", workspaceId).gte("created_at", prevStart).lt("created_at", monthStart).limit(5000),
  ]);
  if (cur.error) throw new Error(cur.error.message);
  if (prev.error) throw new Error(prev.error.message);

  const sumBy = (rows: any[]) => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) {
      const key = `${r.provider_category ?? "unknown"}:${r.provider_name ?? "unknown"}`;
      m.set(key, (m.get(key) ?? 0) + Math.round(Number(r.cost_usd ?? 0) * 100));
    }
    return m;
  };
  const curBy = sumBy(cur.data ?? []);
  const prevBy = sumBy(prev.data ?? []);
  const totalCents = [...curBy.values()].reduce((a, b) => a + b, 0);

  const exceptions: FinancialAuditException[] = [];
  for (const [key, cents] of curBy) {
    if (cents <= 0) continue;
    const baseline = prevBy.get(key) ?? 0;
    const spiked = baseline > 0 && cents > baseline * 1.5;
    const isNew = baseline === 0;
    if (!spiked && !isNew) continue;
    exceptions.push({
      record_type: "provider_spend",
      record_id: key,
      reference: key,
      client: null,
      amount_cents: cents,
      currency: "USD",
      due_date: null,
      issue: isNew
        ? `New provider spend this month on ${key}: ${pounds(cents, "USD")} with no spend last month.`
        : `Spend on ${key} is ${pounds(cents, "USD")} this month — more than 1.5× last month's ${pounds(baseline, "USD")}.`,
      commercial_impact: `${pounds(cents, "USD")} of month-to-date outgoings on ${key}${baseline ? ` (baseline ${pounds(baseline, "USD")})` : ""}.`,
      proposed_action: `Review ${key} usage: confirm the spend is expected, and adjust limits or disable unused features if not.`,
      approval_requirement: "Changing provider configuration or limits requires billing approval (sensitive).",
    });
  }

  return {
    kind: "outgoings_audit",
    records_inspected: (cur.data ?? []).length,
    exceptions: exceptions.sort((a, b) => b.amount_cents - a.amount_cents),
    totals: { month_to_date_cents: totalCents, providers: curBy.size },
    currency: "USD",
  };
}

// ── Work order builder ───────────────────────────────────────────────────────

const AUDIT_TITLES: Record<FinancialAuditKind, string> = {
  invoice_audit: "Invoice audit (outstanding & overdue)",
  renewals_audit: "Renewals & recurring billing audit",
  client_costing_audit: "Client revenue & collection-risk audit",
  outgoings_audit: "Outgoings audit (provider spend)",
};

export interface FinancialAuditOptions {
  objective?: string | null;
  instruction?: string | null;
  source?: string;
}

export async function createFinancialAuditWorkOrderCore(
  sb: Sb,
  workspaceId: string,
  userId: string | null,
  kind: FinancialAuditKind,
  opts: FinancialAuditOptions = {},
): Promise<{ workOrder: any; tasks: any[]; audit: FinancialAuditResult }> {
  const { assertNotWbahWorkspace } = await import("@/lib/wbah-exclusion.shared");
  assertNotWbahWorkspace(workspaceId);
  const { assertProposalAllowed } = await import("@/lib/hivemind/mode-gate.server");
  await assertProposalAllowed(sb, workspaceId);
  const { buildIntelligencePacket, evidenceItem } = await import("@/lib/minds/intelligence-packet.server");

  const audit: FinancialAuditResult =
    kind === "invoice_audit" ? await runInvoiceAudit(sb, workspaceId)
    : kind === "renewals_audit" ? await runRenewalsAudit(sb, workspaceId)
    : kind === "outgoings_audit" ? await runOutgoingsAudit(sb, workspaceId)
    : await runClientCostingAudit(sb, workspaceId);

  // Evidence/target labelling must match the REAL inspected source per kind.
  const auditSourceTable =
    kind === "renewals_audit" ? "accountsmind_recurring_invoices"
    : kind === "outgoings_audit" ? "provider_usage_log"
    : "accountsmind_invoices";
  const targets: PacketTarget[] = [{
    domain: "finance",
    entity_type:
      kind === "renewals_audit" ? "recurring_invoice_book"
      : kind === "outgoings_audit" ? "provider_spend_ledger"
      : "invoice_book",
    entity_id: workspaceId,
    entity_name: AUDIT_TITLES[kind],
    resolved: true,
  }];

  const evidence: PacketEvidence[] = [
    evidenceItem(
      auditSourceTable,
      `Inspected ${audit.records_inspected} real record(s); found ${audit.exceptions.length} exception(s). Totals: ${Object.entries(audit.totals).map(([k, v]) => `${k}=${k.endsWith("_cents") ? pounds(v, audit.currency) : v}`).join(", ") || "none"}.`,
      { records_inspected: audit.records_inspected, totals: audit.totals, exception_count: audit.exceptions.length },
    ),
    ...audit.exceptions.slice(0, 25).map((ex) =>
      evidenceItem(
        auditSourceTable,
        `${ex.issue} ${ex.commercial_impact}`,
        {
          record_type: ex.record_type, record_id: ex.record_id, reference: ex.reference,
          client: ex.client, amount_cents: ex.amount_cents, currency: ex.currency, due_date: ex.due_date,
        },
      )),
  ];

  const objective = opts.objective?.trim()
    || `${AUDIT_TITLES[kind]}: inspect real financial records, surface every exception with amounts and commercial impact, and propose exact billing actions for approval.`;

  const diagnosis = audit.exceptions.length
    ? `Inspected ${audit.records_inspected} record(s): ${audit.exceptions.length} exception(s) totalling ${pounds(audit.exceptions.reduce((s, e) => s + e.amount_cents, 0), audit.currency)}. Top exception: ${audit.exceptions[0].issue}`
    : `Inspected ${audit.records_inspected} record(s): no exceptions found — the ${AUDIT_TITLES[kind].toLowerCase()} is clean as of this run.`;

  const planSteps = [
    { title: "Findings review", detail: `Review the ${audit.exceptions.length} exception(s) with per-record amounts, due dates and commercial impact.` },
    { title: "Proposed actions", detail: audit.exceptions.length ? `Approve/adjust the exact per-record actions: ${audit.exceptions.slice(0, 3).map((e) => e.proposed_action).join(" | ")}${audit.exceptions.length > 3 ? " | …" : ""}` : "No actions required — record the clean audit outcome." },
    { title: "Execute", detail: "Execute only the approved billing actions through the existing gated AccountsMind functions (reminders, payment recording, invoice raising)." },
  ];

  const stageTasks: StageTaskSpec[] = FINANCIAL_AUDIT_STAGES.map((stage) => ({
    stage: stage as any,
    title: `${stage.label}: ${AUDIT_TITLES[kind]}`,
    description: planSteps.find((p) => p.title.toLowerCase().startsWith(stage.label.split(" ")[0].toLowerCase()))?.detail
      ?? `${stage.label} stage of the ${AUDIT_TITLES[kind].toLowerCase()}.`,
    packet: stagePacket({
      buildIntelligencePacket,
      mind: "accountsmind",
      objective,
      intentSource: opts.source ?? `accountsmind_tool:create_financial_audit_work_order:${kind}`,
      instruction: opts.instruction ?? null,
      stage: stage as any,
      allStages: FINANCIAL_AUDIT_STAGES as any,
      targets,
      evidence,
      diagnosis,
      planSteps,
      proposedChanges: audit.exceptions.slice(0, 25).map((ex) => ({
        target: `${ex.record_type}:${ex.record_id}`,
        change: ex.proposed_action,
        reversible: true,
      })),
      deliverables: [
        `Typed audit report: ${audit.records_inspected} record(s) inspected, ${audit.exceptions.length} exception(s) with amounts and impact`,
        "Exact per-record proposed actions with approval requirements",
        "Post-execution reconciliation summary",
      ],
      successCriteria: audit.exceptions.length
        ? [`Every approved action executed and reconciled; outstanding exposure reduced from ${pounds(audit.exceptions.reduce((s, e) => s + e.amount_cents, 0), audit.currency)}.`]
        : ["Clean audit recorded; next audit scheduled."],
      limitations: [
        "All figures come from real invoice/schedule rows read during this audit — nothing estimated.",
        "No billing change happens until the Execute stage is approved; every action runs through the existing billing-gated functions.",
      ],
      approvalSummary: stage.finalSend
        ? `Execute the ${audit.exceptions.length} approved billing action(s) from the ${AUDIT_TITLES[kind].toLowerCase()}.`
        : `Approve the ${stage.label} stage of the ${AUDIT_TITLES[kind].toLowerCase()}.`,
      sensitive: stage.finalSend,
      costNote: "Audit itself is read-only; approved actions may send reminders or raise invoices.",
    }),
  }));

  const { workOrder, tasks } = await insertWorkOrderWithStageTasks(sb, workspaceId, userId, {
    title: AUDIT_TITLES[kind],
    objective,
    source: opts.source ?? "accountsmind_tool",
    metadata: {
      depth_kind: kind,
      audit: {
        kind: audit.kind,
        records_inspected: audit.records_inspected,
        exception_count: audit.exceptions.length,
        totals: audit.totals,
        currency: audit.currency,
        exceptions: audit.exceptions.slice(0, 50),
      },
    },
    packet: stageTasks[0].packet,
    readiness: "ready_for_analysis_approval",
    stageTasks,
    triggerType: `accountsmind_${kind}`,
  });

  return { workOrder, tasks, audit };
}
