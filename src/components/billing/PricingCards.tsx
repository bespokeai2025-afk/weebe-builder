import { Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PLANS, type Plan, planByPriceId } from "@/lib/billing/plans";

interface Props {
  currentPriceId: string | null;
  busyPriceId: string | null;
  onChoose: (plan: Plan) => void;
  onContactSales: () => void;
}

export function PricingCards({ currentPriceId, busyPriceId, onChoose, onContactSales }: Props) {
  const current = planByPriceId(currentPriceId);

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {PLANS.map((plan) => {
        const isCurrent = current.tier === plan.tier;
        const isContactSales = plan.tier === "enterprise";
        const busy = busyPriceId === plan.priceId;

        return (
          <div
            key={plan.tier}
            className={cn(
              "group relative flex flex-col rounded-2xl border bg-card/40 p-6 transition-all duration-300",
              "hover:-translate-y-0.5 hover:bg-card/60 hover:shadow-[0_20px_60px_-30px_rgba(79,140,255,0.45)]",
              plan.highlighted
                ? "border-primary/40 shadow-[0_0_0_1px_rgba(79,140,255,0.18),0_24px_70px_-40px_rgba(79,140,255,0.6)]"
                : "border-white/[0.06]",
              isCurrent && "ring-1 ring-primary/40",
            )}
          >
            {plan.highlighted && (
              <Badge className="absolute -top-2 right-6 gap-1 bg-gradient-to-r from-primary to-primary/70 text-primary-foreground shadow-md">
                <Sparkles className="h-3 w-3" />
                Most popular
              </Badge>
            )}

            <div className="mb-5">
              <div className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {plan.name}
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                <span className="text-3xl font-semibold tracking-tight text-foreground">
                  {plan.priceLabel}
                </span>
                {plan.amountPerMonth !== null && (
                  <span className="text-sm text-muted-foreground">/ month</span>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{plan.tagline}</p>
            </div>

            <ul className="mb-6 flex-1 space-y-2.5 text-sm">
              {plan.features.map((f) => (
                <li key={f} className="flex items-start gap-2 text-muted-foreground">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            <Button
              variant={plan.highlighted ? "default" : isCurrent ? "secondary" : "outline"}
              disabled={isCurrent || busy}
              onClick={() => (isContactSales ? onContactSales() : onChoose(plan))}
              className={cn(
                "h-10 w-full transition-all",
                plan.highlighted && "shadow-[0_8px_24px_-12px_rgba(79,140,255,0.7)]",
              )}
            >
              {isCurrent ? "Current plan" : busy ? "Loading…" : plan.cta}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
