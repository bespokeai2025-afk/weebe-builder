import { Activity, Clock, Users, Wallet } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { type Plan, formatGBP } from "@/lib/billing/plans";

interface Props {
  plan: Plan;
  activeAgents: number;
  minutesUsed: number;
  callsMade: number;
  cycleCostCents: number;
  cycleStart: string;
  nextBillingAt: string | null;
}

function Card({
  icon,
  label,
  value,
  foot,
  progress,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  foot?: React.ReactNode;
  progress?: number;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-card/40 p-5 transition-colors hover:bg-card/60">
      <div className="flex items-center justify-between text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
        <span>{label}</span>
        <span className="text-muted-foreground/70">{icon}</span>
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{value}</div>
      {typeof progress === "number" && (
        <div className="mt-3">
          <Progress value={Math.min(100, progress)} className="h-1.5" />
        </div>
      )}
      {foot && <div className="mt-2 text-xs text-muted-foreground">{foot}</div>}
    </div>
  );
}

export function UsageCards({
  plan,
  activeAgents,
  minutesUsed,
  callsMade,
  cycleCostCents,
  cycleStart,
  nextBillingAt,
}: Props) {
  const included = plan.limits.includedMinutes;
  const unlimited = !Number.isFinite(included);
  const minutesPct = unlimited ? 0 : included > 0 ? (minutesUsed / included) * 100 : 0;
  const remaining = unlimited ? Infinity : Math.max(0, included - minutesUsed);

  const agentsMax = plan.limits.maxAgents;
  const agentsUnlimited = !Number.isFinite(agentsMax);
  const agentsPct = agentsUnlimited ? 0 : agentsMax > 0 ? (activeAgents / agentsMax) * 100 : 0;

  const cycleStartFmt = new Date(cycleStart).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
  const nextBillingFmt = nextBillingAt
    ? new Date(nextBillingAt).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Card
        icon={<Clock className="h-4 w-4" />}
        label="Minutes used"
        value={
          <>
            {minutesUsed.toFixed(1)}
            {!unlimited && (
              <span className="ml-1 text-sm font-normal text-muted-foreground">/ {included}</span>
            )}
          </>
        }
        progress={unlimited ? undefined : minutesPct}
        foot={
          unlimited
            ? "Unlimited included"
            : `${remaining.toFixed(1)} min remaining · cycle from ${cycleStartFmt}`
        }
      />
      <Card
        icon={<Users className="h-4 w-4" />}
        label="Active agents"
        value={
          <>
            {activeAgents}
            {!agentsUnlimited && (
              <span className="ml-1 text-sm font-normal text-muted-foreground">/ {agentsMax}</span>
            )}
          </>
        }
        progress={agentsUnlimited ? undefined : agentsPct}
        foot={agentsUnlimited ? "Unlimited on this plan" : `${plan.name} plan limit`}
      />
      <Card
        icon={<Activity className="h-4 w-4" />}
        label="Calls this cycle"
        value={callsMade}
        foot={`Since ${cycleStartFmt}`}
      />
      <Card
        icon={<Wallet className="h-4 w-4" />}
        label="Cycle usage cost"
        value={formatGBP(cycleCostCents)}
        foot={`Next bill: ${nextBillingFmt}`}
      />
    </div>
  );
}
