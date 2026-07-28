import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  MinusCircle,
  FlaskConical,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getAgentHealth, type AgentHealthReport, type HealthStatus } from "@/lib/agents/agent-health.server";

export const Route = createFileRoute("/_authenticated/agent-health")({
  head: () => ({ meta: [{ title: "Agent Health — Webee" }] }),
  component: AgentHealthPage,
});

const STATUS_META: Record<
  HealthStatus,
  { label: string; icon: typeof CheckCircle2; className: string }
> = {
  operational: {
    label: "Operational",
    icon: CheckCircle2,
    className: "border-emerald-500/30 text-emerald-400 bg-emerald-500/5",
  },
  warning: {
    label: "Warning",
    icon: AlertTriangle,
    className: "border-amber-500/30 text-amber-400 bg-amber-500/5",
  },
  failed: {
    label: "Failed",
    icon: XCircle,
    className: "border-red-500/30 text-red-400 bg-red-500/5",
  },
  not_configured: {
    label: "Not configured",
    icon: MinusCircle,
    className: "border-white/[0.10] text-muted-foreground bg-white/[0.02]",
  },
  test_required: {
    label: "Test required",
    icon: FlaskConical,
    className: "border-sky-500/30 text-sky-400 bg-sky-500/5",
  },
};

function StatusBadge({ status }: { status: HealthStatus }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <Badge variant="outline" className={cn("gap-1 text-[10px]", meta.className)}>
      <Icon className="h-2.5 w-2.5" />
      {meta.label}
    </Badge>
  );
}

function AgentHealthCard({ report }: { report: AgentHealthReport }) {
  return (
    <Card className="border-white/[0.06] bg-white/[0.02]">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">{report.agentName}</CardTitle>
        <CardDescription className="text-[11px]">
          {report.lastSuccessfulCallAt
            ? `Last successful call: ${new Date(report.lastSuccessfulCallAt).toLocaleString()}`
            : "No successful calls recorded yet."}
          {" · "}Checked {new Date(report.checkedAt).toLocaleString()}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-2 sm:grid-cols-2">
          {report.items.map((it) => (
            <div
              key={it.key}
              className="flex items-start justify-between gap-3 rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2.5"
            >
              <div className="min-w-0">
                <div className="text-[12px] font-medium text-foreground">{it.label}</div>
                <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{it.detail}</div>
              </div>
              <StatusBadge status={it.status} />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function AgentHealthPage() {
  const fetchHealth = useServerFn(getAgentHealth);
  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey: ["agent-health"],
    queryFn: () => fetchHealth(),
    staleTime: 60_000,
    retry: false,
    throwOnError: false,
  });

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-5xl px-6 py-5 md:py-7">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <Link
              to="/my-agents"
              className="mb-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3 w-3" /> Agents
            </Link>
            <h1 className="text-base font-semibold tracking-tight text-foreground">Agent Health</h1>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              A live health check of your deployed voice agents — phone routing, voice, model,
              calendar booking, webhooks and post-call data.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Recheck
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Running health checks…
          </div>
        ) : error ? (
          <Card className="border-red-500/20 bg-red-500/5">
            <CardContent className="py-6 text-sm text-red-400">
              The health check could not be completed right now. Please try again.
            </CardContent>
          </Card>
        ) : !data || data.length === 0 ? (
          <Card className="border-white/[0.06] bg-white/[0.02]">
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No live agents found in this workspace. Deploy an agent to see its health here.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {data.map((r) => (
              <AgentHealthCard key={r.agentId} report={r} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
