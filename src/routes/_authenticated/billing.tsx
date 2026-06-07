import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ExternalLink, Receipt, Sparkles, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

import { createBillingPortalSession, getBillingSummary } from "@/lib/billing/billing.functions";
import { planByPriceId, type Plan, formatGBP } from "@/lib/billing/plans";
import { getStripeEnvironment } from "@/lib/stripe";

import { PaymentTestModeBanner } from "@/components/billing/PaymentTestModeBanner";
import { PricingCards } from "@/components/billing/PricingCards";
import { UsageCards } from "@/components/billing/UsageCards";
import { StripeEmbeddedCheckout } from "@/components/billing/StripeEmbeddedCheckout";

export const Route = createFileRoute("/_authenticated/billing")({
  validateSearch: (search: Record<string, unknown>) => ({
    checkout: typeof search.checkout === "string" ? search.checkout : undefined,
  }),
  component: BillingPage,
});

function BillingPage() {
  const queryClient = useQueryClient();
  const fetchSummary = useServerFn(getBillingSummary);
  const openPortal = useServerFn(createBillingPortalSession);
  const navigate = Route.useNavigate();
  const { checkout } = Route.useSearch();

  let environment: "sandbox" | "live" | null = null;
  let envError: string | null = null;
  try {
    environment = getStripeEnvironment();
  } catch (e) {
    envError = e instanceof Error ? e.message : "Payments not configured";
  }

  const summaryQuery = useQuery({
    queryKey: ["billing-summary", environment],
    queryFn: () => fetchSummary({ data: { environment: environment! } }),
    enabled: !!environment,
    refetchInterval: 30_000,
  });

  const [checkoutPlan, setCheckoutPlan] = useState<Plan | null>(null);

  useEffect(() => {
    if (checkout !== "success") return;
    setCheckoutPlan(null);
    toast.success("Payment successful 🎉", {
      description:
        "You'll receive an email shortly with the link to your dashboard. Welcome aboard!",
      duration: 8000,
    });
    queryClient.invalidateQueries({ queryKey: ["billing-summary"] });
    navigate({ search: { checkout: undefined }, replace: true });
  }, [checkout, navigate, queryClient]);

  const portalMutation = useMutation({
    mutationFn: async () => {
      const res = await openPortal({
        data: {
          environment: environment!,
          returnUrl: `${window.location.origin}/billing`,
        },
      });
      if ("error" in res) throw new Error(res.error);
      return res;
    },
    onSuccess: (res) => window.open(res.url, "_blank", "noopener,noreferrer"),
    onError: (e: Error) => toast.error("Couldn't open billing portal", { description: e.message }),
  });

  if (envError) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive">
          {envError}
        </div>
      </div>
    );
  }

  const data = summaryQuery.data;
  const currentPlan = planByPriceId(data?.subscription?.priceId ?? null);
  const sub = data?.subscription ?? null;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 p-5 lg:p-6">
      <PaymentTestModeBanner />

      {/* Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Billing</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Manage your subscription, payment methods, and usage.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => portalMutation.mutate()}
          disabled={portalMutation.isPending || !sub}
          className="gap-2"
        >
          {portalMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ExternalLink className="h-4 w-4" />
          )}
          Manage billing
        </Button>
      </header>

      {/* Current plan summary */}
      <section className="rounded-xl border border-white/[0.06] bg-gradient-to-br from-card/60 to-card/30 p-4 shadow-[0_30px_80px_-50px_rgba(79,140,255,0.4)]">
        {summaryQuery.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-4 w-80" />
          </div>
        ) : (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                Current plan
              </div>
              <div className="mt-1.5 flex items-baseline gap-3">
                <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                  {currentPlan.name}
                </h2>
                {sub && (
                  <Badge variant="secondary" className="capitalize">
                    {sub.status.replace("_", " ")}
                  </Badge>
                )}
                {sub?.cancelAtPeriodEnd && (
                  <Badge variant="destructive">Cancels at period end</Badge>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {currentPlan.amountPerMonth
                  ? `${formatGBP(currentPlan.amountPerMonth)} / month`
                  : currentPlan.tagline}
                {sub?.currentPeriodEnd && (
                  <>
                    {" · "}Renews{" "}
                    {new Date(sub.currentPeriodEnd).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </>
                )}
              </p>
            </div>
          </div>
        )}
      </section>

      {/* Usage */}
      <section>
        <h3 className="mb-3 text-sm font-medium uppercase tracking-[0.14em] text-muted-foreground">
          This cycle
        </h3>
        {summaryQuery.isLoading || !data ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        ) : (
          <UsageCards
            plan={currentPlan}
            activeAgents={data.activeAgents}
            minutesUsed={data.usage.minutesUsed}
            callsMade={data.usage.callsMade}
            cycleCostCents={data.usage.cycleCostCents}
            cycleStart={data.usage.cycleStart}
            nextBillingAt={sub?.currentPeriodEnd ?? null}
          />
        )}
      </section>

      {/* Pricing */}
      <section>
        <h3 className="mb-3 text-sm font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Plans
        </h3>
        <PricingCards
          currentPriceId={sub?.priceId ?? null}
          busyPriceId={checkoutPlan?.priceId ?? null}
          onChoose={(plan) => setCheckoutPlan(plan)}
          onContactSales={() => {
            window.location.href =
              "mailto:sales@webespokeaibuilder.com?subject=Business AI Ops enquiry";
          }}
        />
      </section>

      {/* Billing history (Stripe portal handles full list) */}
      <section className="rounded-2xl border border-white/[0.06] bg-card/40 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="flex items-center gap-2 text-base font-medium text-foreground">
              <Receipt className="h-4 w-4 text-primary" />
              Invoices & payment methods
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              View invoice history, download receipts, update your card, and cancel from the secure
              billing portal.
            </p>
          </div>
          <Button
            variant="secondary"
            onClick={() => portalMutation.mutate()}
            disabled={portalMutation.isPending || !sub}
            className="gap-2"
          >
            Open portal
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </div>
        {!sub && (
          <p className="mt-4 text-xs text-muted-foreground">
            The billing portal becomes available after your first subscription.
          </p>
        )}
      </section>

      {/* Checkout dialog */}
      <Dialog open={!!checkoutPlan} onOpenChange={(o) => !o && setCheckoutPlan(null)}>
        <DialogContent className="max-w-2xl p-0">
          <DialogHeader className="border-b border-white/[0.06] px-6 py-4">
            <DialogTitle>Subscribe to {checkoutPlan?.name}</DialogTitle>
          </DialogHeader>
          <div className="p-2 sm:p-4">
            {checkoutPlan?.priceId && (
              <StripeEmbeddedCheckout
                priceId={checkoutPlan.priceId}
                returnUrl={`${typeof window !== "undefined" ? window.location.origin : ""}/billing?checkout=success`}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
