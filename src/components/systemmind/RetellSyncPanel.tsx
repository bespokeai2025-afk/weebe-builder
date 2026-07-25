import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Loader2, RefreshCw, CheckCircle2, AlertTriangle, CloudOff, KeyRound,
  GitCompareArrows, Radio, Send, RotateCcw, ShieldCheck, Braces,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Section, EmptyState } from "./intelligence/shared";
import {
  listRetellSyncAgents,
  getRetellSyncStatus,
  compareRetellConfig,
  acknowledgeRetellImport,
  previewExtractionSchema,
  deployExtractionSchema,
  getWebhookHealth,
  retryFailedWebhooks,
  sendTestWebhook,
} from "@/lib/systemmind/retell-sync.functions";

const STATE_META: Record<string, { label: string; tone: string; icon: typeof CheckCircle2; hint: string }> = {
  in_sync: { label: "In sync", tone: "text-emerald-400 border-emerald-400/30 bg-emerald-400/10", icon: CheckCircle2, hint: "Builder and Retell match the last deployment." },
  webee_not_deployed: { label: "WEBEE changes not deployed", tone: "text-amber-400 border-amber-400/30 bg-amber-400/10", icon: CloudOff, hint: "The builder has changes Retell doesn't have yet — redeploy from the builder." },
  retell_not_imported: { label: "Retell changes not imported", tone: "text-sky-400 border-sky-400/30 bg-sky-400/10", icon: GitCompareArrows, hint: "The live Retell agent was edited outside WEBEE — import it in the builder, then acknowledge." },
  conflict: { label: "Conflict — both changed", tone: "text-red-400 border-red-400/30 bg-red-400/10", icon: AlertTriangle, hint: "Both the builder and live Retell changed since the last deploy. Choose a side: redeploy (WEBEE wins) or import (Retell wins)." },
  failed: { label: "Last deploy failed", tone: "text-red-400 border-red-400/30 bg-red-400/10", icon: AlertTriangle, hint: "The most recent deployment errored — fix and redeploy." },
  credentials_missing: { label: "Credentials missing", tone: "text-zinc-400 border-zinc-400/30 bg-zinc-400/10", icon: KeyRound, hint: "No Retell API key is available for this workspace." },
};

function StatusRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[11px] py-1 border-b border-white/[0.04] last:border-0">
      <span className="text-muted-foreground/70">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </div>
  );
}

function SyncStatusCard({ agentRowId }: { agentRowId: string }) {
  const qc = useQueryClient();
  const statusFn = useServerFn(getRetellSyncStatus);
  const compareFn = useServerFn(compareRetellConfig);
  const ackFn = useServerFn(acknowledgeRetellImport);
  const previewFn = useServerFn(previewExtractionSchema);
  const deployExtractFn = useServerFn(deployExtractionSchema);
  const [diff, setDiff] = useState<null | { hasSnapshot: boolean; diffCount: number; diffs: Array<{ path: string; changed: string }> }>(null);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["retell-sync-status", agentRowId],
    queryFn: () => statusFn({ data: { agentRowId } }),
    throwOnError: false,
    staleTime: 30_000,
  });

  const compareMut = useMutation({
    mutationFn: () => compareFn({ data: { agentRowId } }),
    onSuccess: (d) => setDiff(d),
    onError: (e: any) => toast.error(String(e?.message ?? e)),
  });
  const ackMut = useMutation({
    mutationFn: () => ackFn({ data: { agentRowId } }),
    onSuccess: () => {
      toast.success("Live Retell config acknowledged as imported.");
      qc.invalidateQueries({ queryKey: ["retell-sync-status", agentRowId] });
    },
    onError: (e: any) => toast.error(String(e?.message ?? e)),
  });
  const previewMut = useMutation({
    mutationFn: () => previewFn({ data: { agentRowId } }),
    onSuccess: (d) =>
      d.fields.length
        ? toast.success(`${d.fields.length} extraction field(s) ready: ${d.fields.map((f) => f.name).join(", ")}`)
        : toast.info("No approved Retell→WEBEE variables to extract."),
    onError: (e: any) => toast.error(String(e?.message ?? e)),
  });
  const deployExtractMut = useMutation({
    mutationFn: () => deployExtractFn({ data: { agentRowId } }),
    onSuccess: (d) => {
      if (d.verified) toast.success(`Extraction schema deployed & verified (${d.fieldCount} fields).`);
      else toast.warning(`Deployed but verification found mismatches: ${d.mismatches.join(", ")}`);
      qc.invalidateQueries({ queryKey: ["retell-sync-status", agentRowId] });
    },
    onError: (e: any) => toast.error(String(e?.message ?? e)),
  });

  if (isLoading) return <div className="flex items-center gap-2 text-xs text-muted-foreground py-8 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> Checking sync status…</div>;
  if (!data) return <EmptyState icon={CloudOff} title="Could not load sync status" />;

  const meta = STATE_META[data.state] ?? STATE_META.credentials_missing;
  const Icon = meta.icon;

  return (
    <div className="space-y-3">
      <div className={cn("rounded-lg border p-3 flex items-start gap-3", meta.tone)}>
        <Icon className="h-5 w-5 mt-0.5 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">{meta.label}</p>
          <p className="text-[11px] opacity-80 mt-0.5">{meta.hint}</p>
          {data.liveError ? <p className="text-[10px] mt-1 opacity-70 break-all">Live check: {data.liveError}</p> : null}
          {data.lastDeployError ? <p className="text-[10px] mt-1 opacity-70 break-all">Deploy error: {data.lastDeployError}</p> : null}
        </div>
        <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs shrink-0" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </Button>
      </div>

      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
        <StatusRow label="Retell agent" value={data.retellAgentId ? <code className="text-[10px]">{data.retellAgentId}</code> : "Not deployed"} />
        <StatusRow label="API key source" value={data.keySource === "workspace" ? "Workspace (Go Live)" : data.keySource === "platform" ? "WEBEE platform" : "None"} />
        <StatusRow label="Last deploy" value={data.lastDeployedAt ? `${new Date(data.lastDeployedAt).toLocaleString()} · ${data.lastDeployStatus}` : data.lastDeployStatus} />
        <StatusRow label="Live Retell reachable" value={data.liveReachable ? "Yes" : "No"} />
        <StatusRow
          label="Post-call extraction"
          value={
            data.extractionVerified
              ? <span className="text-emerald-400 inline-flex items-center gap-1"><ShieldCheck className="h-3 w-3" /> Verified · {data.extractionFieldCount} fields</span>
              : data.extractionFieldCount
                ? `${data.extractionFieldCount} fields (unverified)`
                : "Not configured"
          }
        />
        <StatusRow label="Checked" value={new Date(data.lastSyncedAt).toLocaleTimeString()} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => compareMut.mutate()} disabled={compareMut.isPending || !data.retellAgentId}>
          {compareMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitCompareArrows className="h-3.5 w-3.5" />} Compare with live
        </Button>
        {data.state === "retell_not_imported" || data.state === "conflict" ? (
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => ackMut.mutate()} disabled={ackMut.isPending}>
            {ackMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Accept live as imported
          </Button>
        ) : null}
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => previewMut.mutate()} disabled={previewMut.isPending}>
          {previewMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Braces className="h-3.5 w-3.5" />} Preview extraction
        </Button>
        <Button size="sm" className="h-7 text-xs gap-1.5" onClick={() => deployExtractMut.mutate()} disabled={deployExtractMut.isPending || !data.retellAgentId}>
          {deployExtractMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Deploy extraction schema
        </Button>
      </div>

      {diff ? (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          <p className="text-[11px] font-semibold mb-1.5">
            {diff.hasSnapshot
              ? diff.diffCount === 0
                ? "Live Retell config matches the last deployed snapshot."
                : `${diff.diffCount} field(s) differ from the last deployed snapshot:`
              : "No deployment snapshot exists yet — deploy once to enable field-level compare."}
          </p>
          {diff.diffs.length ? (
            <ul className="space-y-0.5 max-h-48 overflow-auto">
              {diff.diffs.map((d, i) => (
                <li key={i} className="text-[10px] font-mono text-muted-foreground/80">
                  <span className={cn("mr-1.5", d.changed === "different" ? "text-amber-400" : d.changed === "live_only" ? "text-sky-400" : "text-red-400")}>
                    {d.changed === "different" ? "≠" : d.changed === "live_only" ? "+live" : "−live"}
                  </span>
                  {d.path || "(root)"}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function WebhookHealthPanel({ retellAgentId }: { retellAgentId: string | null }) {
  const qc = useQueryClient();
  const healthFn = useServerFn(getWebhookHealth);
  const retryFn = useServerFn(retryFailedWebhooks);
  const testFn = useServerFn(sendTestWebhook);

  const { data, isLoading } = useQuery({
    queryKey: ["retell-webhook-health"],
    queryFn: () => healthFn(),
    throwOnError: false,
    staleTime: 30_000,
  });

  const retryMut = useMutation({
    mutationFn: (ledgerId?: string) => retryFn({ data: { ledgerId } }),
    onSuccess: (d) => {
      const ok = d.results.filter((r) => r.ok).length;
      toast.success(`Reprocessed ${d.results.length} delivery(ies) — ${ok} succeeded.`);
      qc.invalidateQueries({ queryKey: ["retell-webhook-health"] });
    },
    onError: (e: any) => toast.error(String(e?.message ?? e)),
  });
  const testMut = useMutation({
    mutationFn: () => {
      if (!retellAgentId) throw new Error("Select a deployed agent first");
      return testFn({ data: { retellAgentId } });
    },
    onSuccess: (d) => {
      toast.success(`Test webhook sent (${d.callId}) — ${d.ok ? "processed" : d.message}`);
      qc.invalidateQueries({ queryKey: ["retell-webhook-health"] });
    },
    onError: (e: any) => toast.error(String(e?.message ?? e)),
  });

  if (isLoading) return <div className="flex items-center gap-2 text-xs text-muted-foreground py-8 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> Loading webhook health…</div>;
  if (!data) return <EmptyState icon={Radio} title="Could not load webhook health" />;

  const c = data.counts7d;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {[
          { label: "Events (7d)", value: c.total, tone: "" },
          { label: "Failed", value: c.failed, tone: c.failed ? "text-amber-400" : "" },
          { label: "Dead-letter", value: c.dead, tone: c.dead ? "text-red-400" : "" },
          { label: "Duplicates blocked", value: c.duplicates, tone: "text-sky-400" },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
            <p className={cn("text-lg font-semibold tabular-nums", s.tone)}>{s.value}</p>
            <p className="text-[10px] text-muted-foreground/70">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
        <StatusRow label="Last event" value={data.config.lastEventAt ? new Date(data.config.lastEventAt).toLocaleString() : "Never"} />
        <StatusRow label="Last success" value={data.config.lastSuccessAt ? new Date(data.config.lastSuccessAt).toLocaleString() : "—"} />
        <StatusRow label="Last failure" value={data.config.lastFailureAt ? new Date(data.config.lastFailureAt).toLocaleString() : "—"} />
        <StatusRow label="Consecutive failures" value={data.config.consecutiveFailures} />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => testMut.mutate()} disabled={testMut.isPending || !retellAgentId}>
          {testMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send test webhook
        </Button>
        {data.retryable.length ? (
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5" onClick={() => retryMut.mutate(undefined)} disabled={retryMut.isPending}>
            {retryMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Retry failed ({data.retryable.length})
          </Button>
        ) : null}
      </div>

      {data.recentEvents.length ? (
        <Section icon={Radio} title="Recent webhook events">
          <div className="space-y-1 max-h-56 overflow-auto">
            {data.recentEvents.map((e) => (
              <div key={e.id} className="flex items-center gap-2 text-[10px] py-0.5 border-b border-white/[0.04] last:border-0">
                <span className={cn(
                  "px-1.5 py-0.5 rounded border text-[9px] shrink-0",
                  e.status === "processed" ? "text-emerald-400 border-emerald-400/30" :
                  e.status === "error" ? "text-red-400 border-red-400/30" :
                  e.status === "duplicate" ? "text-sky-400 border-sky-400/30" :
                  "text-zinc-400 border-zinc-400/30",
                )}>{e.status}</span>
                <span className="font-medium">{e.eventType}</span>
                {e.callId ? <code className="text-muted-foreground/60 truncate">{e.callId}</code> : null}
                <span className="ml-auto text-muted-foreground/60 shrink-0">{new Date(e.receivedAt).toLocaleTimeString()}</span>
              </div>
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}

export function RetellSyncPanel() {
  const listFn = useServerFn(listRetellSyncAgents);
  const { data, isLoading } = useQuery({
    queryKey: ["retell-sync-agents"],
    queryFn: () => listFn(),
    throwOnError: false,
  });
  const [selected, setSelected] = useState<string | null>(null);
  const agents = data?.agents ?? [];
  const activeId = selected ?? agents[0]?.id ?? null;
  const active = agents.find((a) => a.id === activeId) ?? null;

  if (isLoading) return <div className="flex items-center gap-2 text-xs text-muted-foreground py-10 justify-center"><Loader2 className="h-4 w-4 animate-spin" /> Loading agents…</div>;
  if (!agents.length) return <EmptyState icon={CloudOff} title="No builder agents in this workspace yet" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <label className="text-[11px] text-muted-foreground/70 shrink-0">Agent</label>
        <select
          className="h-8 text-xs rounded-md border border-white/[0.08] bg-background px-2 min-w-56"
          value={activeId ?? ""}
          onChange={(e) => setSelected(e.target.value)}
        >
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}{a.retellAgentId ? "" : " (not deployed)"}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Section icon={GitCompareArrows} title="Deployment sync">
          {activeId ? <SyncStatusCard agentRowId={activeId} /> : null}
        </Section>
        <Section icon={Radio} title="Webhook health">
          <WebhookHealthPanel retellAgentId={active?.retellAgentId ?? null} />
        </Section>
      </div>
    </div>
  );
}
