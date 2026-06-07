import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  type StripeEnv,
  createStripeClient,
  getStripeErrorMessage,
} from "@/lib/stripe.server";

type CheckoutResult = { clientSecret: string } | { error: string };
type PortalResult = { url: string } | { error: string };

async function resolveOrCreateCustomer(
  stripe: ReturnType<typeof createStripeClient>,
  opts: { email?: string; userId: string },
): Promise<string> {
  if (!/^[a-zA-Z0-9_-]+$/.test(opts.userId)) throw new Error("Invalid userId");
  const found = await stripe.customers.search({
    query: `metadata['userId']:'${opts.userId}'`,
    limit: 1,
  });
  if (found.data.length) return found.data[0].id;

  if (opts.email) {
    const existing = await stripe.customers.list({ email: opts.email, limit: 1 });
    if (existing.data.length) {
      const c = existing.data[0];
      if (c.metadata?.userId !== opts.userId) {
        await stripe.customers.update(c.id, {
          metadata: { ...c.metadata, userId: opts.userId },
        });
      }
      return c.id;
    }
  }

  const created = await stripe.customers.create({
    ...(opts.email && { email: opts.email }),
    metadata: { userId: opts.userId },
  });
  return created.id;
}

export const createBillingCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: { priceId: string; returnUrl: string; environment: StripeEnv }) => {
      if (!/^[a-zA-Z0-9_-]+$/.test(data.priceId)) throw new Error("Invalid priceId");
      return data;
    },
  )
  .handler(async ({ data, context }): Promise<CheckoutResult> => {
    const { userId } = context;
    try {
      const stripe = createStripeClient(data.environment);

      const prices = await stripe.prices.list({ lookup_keys: [data.priceId] });
      if (!prices.data.length) throw new Error("Price not found");
      const stripePrice = prices.data[0];

      const { data: userRes } = await context.supabase.auth.getUser();
      const email = userRes.user?.email ?? undefined;

      const customerId = await resolveOrCreateCustomer(stripe, { email, userId });

      const session = await stripe.checkout.sessions.create({
        line_items: [{ price: stripePrice.id, quantity: 1 }],
        mode: "subscription",
        ui_mode: "embedded_page",
        return_url: data.returnUrl,
        customer: customerId,
        metadata: { userId },
        subscription_data: { metadata: { userId } },
      });

      return { clientSecret: session.client_secret ?? "" };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

export const createBillingPortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { returnUrl?: string; environment: StripeEnv }) => data)
  .handler(async ({ data, context }): Promise<PortalResult> => {
    const { supabase, userId } = context;
    const { data: sub, error } = await supabase
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", userId)
      .eq("environment", data.environment)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !sub?.stripe_customer_id) {
      return { error: "No subscription found. Subscribe to a plan first." };
    }
    try {
      const stripe = createStripeClient(data.environment);
      const portal = await stripe.billingPortal.sessions.create({
        customer: sub.stripe_customer_id as string,
        ...(data.returnUrl && { return_url: data.returnUrl }),
      });
      return { url: portal.url };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

// Aggregated billing summary for the /billing page.
export const getBillingSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { environment: StripeEnv }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const [{ data: sub }, { data: agents }, { data: usageRows }] = await Promise.all([
      supabase
        .from("subscriptions")
        .select("*")
        .eq("user_id", userId)
        .eq("environment", data.environment)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("agents")
        .select("id", { count: "exact" })
        .eq("user_id", userId)
        .not("retell_agent_id", "is", null),
      supabase
        .from("usage_events")
        .select("minutes, cost_cents, occurred_at")
        .eq("user_id", userId)
        .order("occurred_at", { ascending: false })
        .limit(500),
    ]);

    const cycleStart = sub?.current_period_start
      ? new Date(sub.current_period_start as string)
      : new Date(new Date().setDate(1));

    const inCycle = (usageRows ?? []).filter(
      (r) => new Date(r.occurred_at as string) >= cycleStart,
    );
    const minutesUsed = inCycle.reduce((a, r) => a + Number(r.minutes ?? 0), 0);
    const cycleCostCents = inCycle.reduce((a, r) => a + Number(r.cost_cents ?? 0), 0);
    const callsMade = inCycle.length;

    return {
      subscription: sub
        ? {
            stripeSubscriptionId: sub.stripe_subscription_id as string,
            priceId: sub.price_id as string,
            status: sub.status as string,
            currentPeriodStart: sub.current_period_start as string | null,
            currentPeriodEnd: sub.current_period_end as string | null,
            cancelAtPeriodEnd: sub.cancel_at_period_end as boolean,
          }
        : null,
      activeAgents: agents?.length ?? 0,
      usage: {
        minutesUsed: Math.round(minutesUsed * 10) / 10,
        callsMade,
        cycleCostCents,
        cycleStart: cycleStart.toISOString(),
      },
    };
  });

// Used by the agent deploy flow to block over-quota deploys server-side.
export const getMyPlanGate = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { environment: StripeEnv }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const [{ data: sub }, { count }] = await Promise.all([
      supabase
        .from("subscriptions")
        .select("price_id, status, current_period_end")
        .eq("user_id", userId)
        .eq("environment", data.environment)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("agents")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .not("retell_agent_id", "is", null),
    ]);
    return {
      priceId: (sub?.price_id as string | undefined) ?? null,
      status: (sub?.status as string | undefined) ?? null,
      activeAgents: count ?? 0,
    };
  });
