import { createClient } from "@supabase/supabase-js";
import { createStripeClient } from "@/lib/stripe.server";

export type OverageBillingResult =
  | { ok: true; invoiceItemId: string; overagePence: number; extraSeats: number }
  | { ok: false; reason: string };

/**
 * Bills a workspace for seat overages via a Stripe invoice item.
 * Creates a one-time invoice item on the customer's next invoice.
 *
 * This should be called once per billing period when:
 *  1. A workspace exceeds its included seat count
 *  2. The period rolls over and actual usage is known
 *
 * The stripe_invoice_item_id is persisted to seat_overage_events to prevent
 * double-billing.
 */
export async function billSeatOverage(opts: {
  workspaceId:      string;
  stripeCustomerId: string;
  extraSeats:       number;
  pricePerSeatPence: number;
  periodStart:      string;
  periodEnd:        string;
  environment:      "sandbox" | "live";
}): Promise<OverageBillingResult> {
  const { workspaceId, stripeCustomerId, extraSeats, pricePerSeatPence, periodStart, periodEnd, environment } = opts;

  if (extraSeats <= 0) {
    return { ok: false, reason: "No overage — extraSeats must be positive" };
  }

  const sb = createClient(
    process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // Guard: check if this period is already billed
  const { data: existing } = await sb
    .from("seat_overage_events")
    .select("stripe_invoice_item_id")
    .eq("workspace_id", workspaceId)
    .eq("period_start", periodStart)
    .not("stripe_invoice_item_id", "is", null)
    .maybeSingle();

  if (existing?.stripe_invoice_item_id) {
    return { ok: false, reason: `Period already billed: ${existing.stripe_invoice_item_id}` };
  }

  const overagePence = extraSeats * pricePerSeatPence;
  const overageGBP   = overagePence / 100;

  try {
    const stripe = createStripeClient(environment);

    const invoiceItem = await stripe.invoiceItems.create({
      customer:    stripeCustomerId,
      amount:      overagePence,
      currency:    "gbp",
      description: `Seat overage — ${extraSeats} extra seat${extraSeats > 1 ? "s" : ""} (${periodStart} – ${periodEnd})`,
      metadata: {
        workspace_id: workspaceId,
        extra_seats:  String(extraSeats),
        period_start: periodStart,
        period_end:   periodEnd,
        type:         "seat_overage",
      },
    });

    // Persist the invoice item ID so we never double-bill
    await sb
      .from("seat_overage_events")
      .upsert({
        workspace_id:            workspaceId,
        period_start:            periodStart,
        period_end:              periodEnd,
        extra_seats:             extraSeats,
        overage_amount_pence:    overagePence,
        stripe_invoice_item_id:  invoiceItem.id,
        billed_at:               new Date().toISOString(),
      }, { onConflict: "workspace_id,period_start" })
      .catch(() => {});

    console.log(
      `[seat-overage] billed workspace=${workspaceId} extraSeats=${extraSeats} amount=£${overageGBP.toFixed(2)} invoiceItem=${invoiceItem.id}`,
    );

    return { ok: true, invoiceItemId: invoiceItem.id, overagePence, extraSeats };
  } catch (e: any) {
    console.error(`[seat-overage] Stripe error for workspace=${workspaceId}:`, e?.message ?? e);
    return { ok: false, reason: e?.message ?? "Stripe error" };
  }
}
