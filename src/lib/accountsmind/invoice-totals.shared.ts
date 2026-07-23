/**
 * Decimal-safe invoice totals engine (integer cents only — no float money).
 *
 * Shared between the browser (live preview) and the server (authoritative
 * recomputation before any save/generate). Quantities may be fractional
 * (e.g. 2.5 hours) but every monetary figure is an integer number of cents,
 * rounded half-up at the line level so the client preview and the server
 * always agree to the penny.
 */

export const INVOICE_UNITS = [
  "fixed",
  "each",
  "hour",
  "day",
  "week",
  "month",
  "call",
  "minute",
  "user",
  "licence",
  "project",
  "custom",
] as const;

export type TaxMode = "exclusive" | "inclusive";

export interface InvoiceLineInput {
  service_id?: string | null;
  description: string;
  service_date?: string | null; // free text date or period
  quantity: number;
  unit?: string | null;
  unit_price_cents: number;
  discount_percent?: number | null; // 0–100
  tax_rate_percent?: number | null; // 0–100
}

export interface InvoiceLineComputed extends InvoiceLineInput {
  gross_cents: number; // qty × unit price
  discount_cents: number;
  net_cents: number; // gross − discount (pre-tax in exclusive mode; tax-inclusive in inclusive mode)
  tax_cents: number;
  total_cents: number; // net + tax (exclusive) / net (inclusive)
}

export interface InvoiceTotals {
  lines: InvoiceLineComputed[];
  subtotal_cents: number; // sum of nets excluding tax
  discount_cents: number;
  tax_cents: number;
  tax_breakdown: Array<{ rate_percent: number; tax_cents: number }>;
  total_cents: number;
  amount_paid_cents: number;
  balance_due_cents: number;
}

const round = (n: number) => Math.round(n + Number.EPSILON);

export function computeLine(li: InvoiceLineInput, mode: TaxMode): InvoiceLineComputed {
  const qty = Number.isFinite(li.quantity) ? li.quantity : 0;
  const unitPrice = Number.isFinite(li.unit_price_cents) ? round(li.unit_price_cents) : 0;
  const discPct = Math.min(100, Math.max(0, Number(li.discount_percent ?? 0) || 0));
  const taxPct = Math.min(100, Math.max(0, Number(li.tax_rate_percent ?? 0) || 0));

  const gross = round(qty * unitPrice);
  const discount = round((gross * discPct) / 100);
  const net = gross - discount;

  let tax: number;
  let total: number;
  if (mode === "inclusive") {
    // net already contains tax; extract the tax portion.
    tax = net - round(net / (1 + taxPct / 100));
    total = net;
  } else {
    tax = round((net * taxPct) / 100);
    total = net + tax;
  }
  return { ...li, quantity: qty, unit_price_cents: unitPrice, discount_percent: discPct, tax_rate_percent: taxPct, gross_cents: gross, discount_cents: discount, net_cents: net, tax_cents: tax, total_cents: total };
}

export function computeInvoiceTotals(
  items: InvoiceLineInput[],
  opts: { taxMode?: TaxMode; amountPaidCents?: number } = {},
): InvoiceTotals {
  const mode: TaxMode = opts.taxMode === "inclusive" ? "inclusive" : "exclusive";
  const lines = items.map((li) => computeLine(li, mode));

  const discount = lines.reduce((s, l) => s + l.discount_cents, 0);
  const tax = lines.reduce((s, l) => s + l.tax_cents, 0);
  // Subtotal is always net-of-tax so exclusive and inclusive invoices read consistently.
  const subtotal = lines.reduce((s, l) => s + (mode === "inclusive" ? l.net_cents - l.tax_cents : l.net_cents), 0);
  const total = lines.reduce((s, l) => s + l.total_cents, 0);

  const byRate = new Map<number, number>();
  for (const l of lines) {
    const r = Number(l.tax_rate_percent ?? 0);
    if (l.tax_cents !== 0) byRate.set(r, (byRate.get(r) ?? 0) + l.tax_cents);
  }
  const paid = Math.max(0, round(opts.amountPaidCents ?? 0));
  return {
    lines,
    subtotal_cents: subtotal,
    discount_cents: discount,
    tax_cents: tax,
    tax_breakdown: [...byRate.entries()].sort((a, b) => a[0] - b[0]).map(([rate_percent, tax_cents]) => ({ rate_percent, tax_cents })),
    total_cents: total,
    amount_paid_cents: paid,
    balance_due_cents: total - paid,
  };
}

export function formatMoneyCents(cents: number, currency: string): string {
  const symbol = currency === "GBP" ? "£" : currency === "USD" ? "$" : currency === "EUR" ? "€" : currency === "AED" ? "AED " : `${currency} `;
  const sign = cents < 0 ? "−" : "";
  return `${sign}${symbol}${(Math.abs(cents) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Lifecycle statuses (superset of the legacy set — legacy "unpaid" maps to "ready"). */
export const INVOICE_LIFECYCLE_STATUSES = [
  "draft",
  "ready",
  "unpaid", // legacy alias of ready — kept valid for existing rows
  "sent",
  "viewed",
  "partially_paid",
  "paid",
  "overdue",
  "cancelled",
  "void",
  "refunded",
] as const;
export type InvoiceLifecycleStatus = (typeof INVOICE_LIFECYCLE_STATUSES)[number];

/** Statuses treated as "issued" — these may never be silently deleted. */
export const ISSUED_STATUSES: InvoiceLifecycleStatus[] = [
  "ready",
  "unpaid",
  "sent",
  "viewed",
  "partially_paid",
  "paid",
  "overdue",
  "refunded",
];

/** Allowed manual transitions (draft deletion handled separately). */
export const STATUS_TRANSITIONS: Record<string, InvoiceLifecycleStatus[]> = {
  draft: ["ready", "cancelled"],
  ready: ["sent", "paid", "partially_paid", "cancelled", "void"],
  unpaid: ["sent", "paid", "partially_paid", "overdue", "cancelled", "void"],
  sent: ["viewed", "paid", "partially_paid", "overdue", "cancelled", "void"],
  viewed: ["paid", "partially_paid", "overdue", "cancelled", "void"],
  partially_paid: ["paid", "overdue", "cancelled", "void", "refunded"],
  overdue: ["sent", "paid", "partially_paid", "cancelled", "void"],
  paid: ["refunded"],
  cancelled: [],
  void: [],
  refunded: [],
};

export function maskAccountValue(v: string): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (s.length <= 4) return "••••";
  return `••••${s.slice(-4)}`;
}
