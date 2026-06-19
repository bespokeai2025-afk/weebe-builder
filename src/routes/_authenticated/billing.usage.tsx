import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Phone, MessageSquare, Mail, Cpu, Video, Image, AlertTriangle, TrendingUp, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageShell";
import { getWorkspaceUsageDashboard } from "@/lib/billing/usage-dashboard.server";

export const Route = createFileRoute("/_authenticated/billing/usage")({
  head: () => ({ meta: [{ title: "Usage — WEBEE" }] }),
  component: UsageDashboardPage,
});

function UsageMeter({
  label, value, cap, unit, icon, color,
}: {
  label: string;
  value: number;
  cap: number | null;
  unit: string;
  icon: React.ReactNode;
  color: string;
}) {
  const pct    = cap != null ? Math.min((value / cap) * 100, 100) : 0;
  const atRisk = cap != null && pct >= 80;
  const over   = cap != null && value > cap;

  return (
    <div className="rounded-xl border border-white/[0.06] bg-card/60 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}/15 ring-1 ${color}/25`}>
            {icon}
          </div>
          <span className="text-sm font-medium">{label}</span>
        </div>
        {over && <AlertTriangle className="h-4 w-4 text-red-400" />}
        {atRisk && !over && <AlertTriangle className="h-4 w-4 text-amber-400" />}
      </div>
      <div className="flex items-end justify-between mb-2">
        <span className="text-2xl font-bold tabular-nums">
          {unit === "$" ? `$${value.toFixed(2)}` : `${value}${unit ? ` ${unit}` : ""}`}
        </span>
        {cap != null && (
          <span className="text-xs text-muted-foreground">
            {over ? <span className="text-red-400">Limit exceeded</span> : `/ ${unit === "$" ? `$${cap.toFixed(0)}` : `${cap} ${unit}`}`}
          </span>
        )}
        {cap == null && <span className="text-xs text-muted-foreground">No limit set</span>}
      </div>
      {cap != null && (
        <div className="h-1.5 w-full bg-white/[0.06] rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${over ? "bg-red-500" : atRisk ? "bg-amber-500" : "bg-emerald-500"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-card/60 p-4">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-xl font-bold tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function UsageDashboardPage() {
  const getFn = useServerFn(getWorkspaceUsageDashboard);

  const { data, isLoading } = useQuery({
    queryKey: ["workspace-usage-dashboard"],
    queryFn:  () => getFn(),
    staleTime: 60_000,
    refetchInterval: 120_000,
    throwOnError: false,
  });

  if (isLoading) {
    return (
      <div className="px-6 py-5 flex items-center justify-center h-64">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) return null;

  const periodLabel = new Date(data.period.start).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  return (
    <div className="px-6 py-5 max-w-4xl space-y-6">
      <PageHeader
        title="Usage Dashboard"
        description={`Month-to-date usage for ${periodLabel}`}
        icon={<TrendingUp className="h-4 w-4 text-violet-400" />}
      />

      {/* Voice */}
      <div>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Voice</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatCard label="Calls made" value={data.voice.callsMade} />
          <StatCard label="Minutes used" value={`${data.voice.minutesUsed.toFixed(1)} min`} />
          <StatCard label="Voice cost" value={`$${data.voice.costUsd.toFixed(2)}`} />
        </div>
      </div>

      {/* WhatsApp */}
      <div>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">WhatsApp</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <StatCard label="Messages sent" value={data.whatsapp.messagesSent} />
          <StatCard label="Messages received" value={data.whatsapp.messagesRecv} />
          <StatCard label="Messaging cost" value={`$${data.whatsapp.costUsd.toFixed(2)}`} />
        </div>
      </div>

      {/* AI Generation with cap meters */}
      <div>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">AI Generation</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <UsageMeter
            label="Video generation"
            value={data.generation.videoSpendUsd}
            cap={data.generation.videoCap}
            unit="$"
            icon={<Video className="h-4 w-4 text-violet-400" />}
            color="text-violet-400 bg-violet-500"
          />
          <UsageMeter
            label="Image generation"
            value={data.generation.imageSpendUsd}
            cap={data.generation.imageCap}
            unit="$"
            icon={<Image className="h-4 w-4 text-blue-400" />}
            color="text-blue-400 bg-blue-500"
          />
          <UsageMeter
            label="LLM (AI text)"
            value={data.generation.llmSpendUsd}
            cap={data.generation.llmCap}
            unit="$"
            icon={<Cpu className="h-4 w-4 text-emerald-400" />}
            color="text-emerald-400 bg-emerald-500"
          />
        </div>
        <p className="text-[11px] text-muted-foreground mt-2">
          Generation limits can be configured in{" "}
          <a href="/settings/providers" className="text-violet-400 hover:underline">Settings → Providers</a>.
        </p>
      </div>

      {/* Top cost providers */}
      {data.topProviders.length > 0 && (
        <div>
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Top Cost Drivers</h2>
          <div className="rounded-xl border border-white/[0.06] bg-card/60 divide-y divide-white/[0.04]">
            {data.topProviders.map(p => (
              <div key={p.provider} className="flex items-center justify-between px-4 py-3">
                <span className="text-sm capitalize">{p.provider.replace(/_/g, " ")}</span>
                <span className="text-sm font-mono font-semibold">${p.costUsd.toFixed(3)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-300/80">
        <strong className="text-amber-300">About these costs:</strong> Figures show estimated costs from provider usage logs this month. Your Stripe invoice may differ if your plan includes bundled usage. Contact support for billing queries.
      </div>
    </div>
  );
}
