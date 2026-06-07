import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { type StripeEnv, verifyWebhook } from "@/lib/stripe.server";
import type { Database } from "@/integrations/supabase/types";
import { enqueueTransactionalEmail } from "@/lib/email/send-server";
import { planByPriceId } from "@/lib/billing/plans";

let _supabase: ReturnType<typeof createClient<Database>> | null = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient<Database>(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _supabase;
}

function resolvePriceId(item: any): string {
  return item?.price?.lookup_key || item?.price?.metadata?.lovable_external_id || item?.price?.id;
}

async function getUserEmail(userId: string): Promise<string | null> {
  const { data, error } = await getSupabase().auth.admin.getUserById(userId);
  if (error || !data?.user?.email) return null;
  return data.user.email;
}

async function upsertSubscription(subscription: any, env: StripeEnv) {
  const userId = subscription.metadata?.userId;
  if (!userId) {
    console.error("[webhook] subscription event missing metadata.userId", subscription.id);
    return { userId: null, priceId: null, prevPriceId: null, isNew: false };
  }
  const item = subscription.items?.data?.[0];
  const priceId = resolvePriceId(item);
  const productId = item?.price?.product;
  const periodStart = item?.current_period_start ?? subscription.current_period_start;
  const periodEnd = item?.current_period_end ?? subscription.current_period_end;

  // Capture previous price for upgrade detection
  const { data: existing } = await getSupabase()
    .from("subscriptions")
    .select("price_id")
    .eq("stripe_subscription_id", subscription.id)
    .eq("environment", env)
    .maybeSingle();
  const prevPriceId = existing?.price_id ?? null;
  const isNew = !existing;

  await getSupabase()
    .from("subscriptions")
    .upsert(
      {
        user_id: userId,
        stripe_subscription_id: subscription.id,
        stripe_customer_id: subscription.customer,
        product_id: productId,
        price_id: priceId,
        status: subscription.status,
        current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
        current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
        cancel_at_period_end: subscription.cancel_at_period_end || false,
        environment: env,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "stripe_subscription_id" },
    );

  return { userId, priceId, prevPriceId, isNew };
}

async function markCanceled(subscription: any, env: StripeEnv) {
  await getSupabase()
    .from("subscriptions")
    .update({ status: "canceled", updated_at: new Date().toISOString() })
    .eq("stripe_subscription_id", subscription.id)
    .eq("environment", env);
}

async function sendWelcomeEmail(userId: string, priceId: string | null, subId: string) {
  const email = await getUserEmail(userId);
  if (!email) {
    console.warn("[webhook] no email for user", userId);
    return;
  }
  const plan = planByPriceId(priceId);
  await enqueueTransactionalEmail({
    templateName: "welcome-purchase",
    recipientEmail: email,
    idempotencyKey: `welcome-${subId}`,
    templateData: { planName: plan.name },
  });
}

const TIER_RANK: Record<string, number> = { free: 0, lite: 1, pro: 2, enterprise: 3 };

async function maybeSendUpgradeEmail(
  userId: string,
  priceId: string | null,
  prevPriceId: string | null,
  subscription: any,
) {
  if (!prevPriceId || !priceId || prevPriceId === priceId) return;
  const prev = planByPriceId(prevPriceId);
  const next = planByPriceId(priceId);
  const isUpgrade = (TIER_RANK[next.tier] ?? 0) > (TIER_RANK[prev.tier] ?? 0);
  if (!isUpgrade) return;
  const email = await getUserEmail(userId);
  await enqueueTransactionalEmail({
    templateName: "plan-upgraded",
    idempotencyKey: `upgrade-${subscription.id}-${priceId}`,
    templateData: {
      customerEmail: email ?? "unknown",
      previousPlan: prev.name,
      newPlan: next.name,
      stripeSubscriptionId: subscription.id,
      stripeCustomerId: subscription.customer,
    },
  });
}

async function handle(event: { type: string; data: { object: any } }, env: StripeEnv) {
  switch (event.type) {
    case "customer.subscription.created":
    case "subscription.created": {
      const result = await upsertSubscription(event.data.object, env);
      if (result.userId) {
        await sendWelcomeEmail(result.userId, result.priceId, event.data.object.id);
      }
      break;
    }
    case "customer.subscription.updated":
    case "subscription.updated": {
      const result = await upsertSubscription(event.data.object, env);
      if (result.userId) {
        if (result.isNew) {
          await sendWelcomeEmail(result.userId, result.priceId, event.data.object.id);
        } else {
          await maybeSendUpgradeEmail(
            result.userId,
            result.priceId,
            result.prevPriceId,
            event.data.object,
          );
        }
      }
      break;
    }
    case "customer.subscription.deleted":
    case "subscription.canceled":
      await markCanceled(event.data.object, env);
      break;
    case "checkout.session.completed":
    case "invoice.paid":
    case "invoice.payment_failed":
    case "transaction.completed":
    case "transaction.payment_failed":
      console.log("[webhook] noted event:", event.type);
      break;
    default:
      console.log("[webhook] unhandled event:", event.type);
  }
}

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawEnv = new URL(request.url).searchParams.get("env");
        if (rawEnv !== "sandbox" && rawEnv !== "live") {
          console.error("[webhook] invalid env:", rawEnv);
          return Response.json({ received: true, ignored: "invalid env" });
        }
        try {
          const event = await verifyWebhook(request, rawEnv);
          await handle(event, rawEnv);
          return Response.json({ received: true });
        } catch (e) {
          console.error("[webhook] error:", e);
          return new Response("Webhook error", { status: 400 });
        }
      },
    },
  },
});
