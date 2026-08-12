/**
 * Website UX tab — Microsoft Clarity connection status + Website Change Queue.
 *
 * Every recommendation shows the full CURRENT / PROPOSED / WHY / DATA /
 * IMPACT / RISK / ROLLBACK structure. Executing routes through approval; an
 * approved change becomes a handoff package (WEBEE never edits the site).
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Loader2, RefreshCw, MousePointerClick, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getClarityStatus,
  syncClarityNow,
  listWebsiteChangeQueue,
  refreshWebsiteChangeQueueNow,
  executeWebsiteChange,
  dismissWebsiteChange,
} from "@/lib/growthmind/growthmind.website-ux";

const CHANGE_TYPE_LABELS: Record<string, string> = {
  headline: "Headline",
  cta_copy: "CTA copy",
  cta_position: "CTA position / mobile",
  section_order: "Section order",
  social_proof: "Social proof",
  pricing_presentation: "Pricing presentation",
  form_optimisation: "Form optimisation",
  ava_positioning: "Ava positioning",
  landing_content: "Landing content",
  faq: "FAQ structure",
};

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  executing: "Executing",
  handled: "Package delivered",
  dismissed: "Dismissed",
  expired: "Expired",
};

export function WebsiteUxQueue() {
  const qc = useQueryClient();
  const statusFn = useServerFn(getClarityStatus);
  const syncFn = useServerFn(syncClarityNow);
  const listFn = useServerFn(listWebsiteChangeQueue);
  const refreshFn = useServerFn(refreshWebsiteChangeQueueNow);
  const executeFn = useServerFn(executeWebsiteChange);
  const dismissFn = useServerFn(dismissWebsiteChange);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { data: status } = useQuery({
    queryKey: ["clarity-status"],
    queryFn: () => statusFn(),
    throwOnError: false,
  });
  const { data, isLoading } = useQuery({
    queryKey: ["website-change-queue"],
    queryFn: () => listFn(),
    throwOnError: false,
  });
  const changes = data?.changes ?? [];
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["website-change-queue"] });
    qc.invalidateQueries({ queryKey: ["clarity-status"] });
  };

  return (
    <div className="space-y-4">
      {/* Connection status */}
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex flex-wrap items-center gap-2">
          <MousePointerClick className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium">Microsoft Clarity</span>
          {status ? (
            status.connected ? (
              <span className="rounded bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-400">Connected</span>
            ) : (
              <span className="rounded bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400">Not connected</span>
            )
          ) : null}
          <div className="ml-auto flex items-center gap-1.5">
            <Link to="/settings/providers/$category" params={{ category: "analytics" }} className="text-xs text-primary hover:underline">
              Configure <ExternalLink className="ml-0.5 inline h-3 w-3" />
            </Link>
            {status?.connected && (
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busy === "sync"} onClick={async () => {
                setBusy("sync"); setError(null); setNotice(null);
                try {
                  const r = await syncFn();
                  if (!r.ok) setError(r.rateLimited ? "Clarity's daily API quota (10 requests/day) is used up — the sync will run again tomorrow." : (r.error ?? "Sync failed"));
                  else setNotice(`Synced ${r.rows} page rows from Clarity and re-analysed the queue.`);
                  refresh();
                } catch (e: any) { setError(e?.message ?? "Sync failed"); }
                finally { setBusy(null); }
              }}>
                {busy === "sync" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
                Sync now
              </Button>
            )}
          </div>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {status?.connected
            ? <>Last sync: {status.lastSync ? new Date(status.lastSync).toLocaleString() : "never"} · {status.metricRows} page-day rows stored{status.latestMetricDate ? ` (latest ${status.latestMetricDate})` : ""}.</>
            : "Connect Clarity in Settings → Providers → Analytics with a Data Export API token (Clarity → Settings → Data Export)."}
          {" "}Clarity's API only exposes aggregate counts for the last 1–3 days (max 10 requests/day, no recordings or heatmaps) — WEBEE syncs once daily and builds up history over time.
        </p>
      </div>

      {/* Queue */}
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          UX change recommendations built from Clarity frustration signals (rage/dead clicks, quick-backs, excessive scrolling) combined with your conversion outcomes.
          A signal must appear on at least 2 separate days before it becomes a recommendation. Executing routes through approval — approved changes become handoff packages; WEBEE never edits your website directly.
        </p>
        <Button size="sm" variant="outline" disabled={busy === "refresh"} onClick={async () => {
          setBusy("refresh"); setError(null); setNotice(null);
          try {
            const r = await refreshFn();
            if (!r.ok) setError(r.error ?? "Refresh failed");
            else setNotice(`Re-analysed: ${r.detected} detected, ${r.inserted} new, ${r.updated} updated, ${r.expired} expired.`);
            refresh();
          } finally { setBusy(null); }
        }}>
          {busy === "refresh" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
          Re-analyse
        </Button>
      </div>

      {error && <p className="rounded-lg border border-red-500/25 bg-red-500/10 p-2 text-xs text-red-400">{error}</p>}
      {notice && <p className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-2 text-xs text-emerald-400">{notice}</p>}

      {isLoading && <p className="text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading queue…</p>}
      {!isLoading && changes.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No website change recommendations yet. They appear automatically once Clarity has synced behavioural data on at least 2 separate days and a page shows meaningful frustration signals.
        </p>
      )}

      <div className="space-y-2">
        {changes.map((c: any) => (
          <div key={c.id} className="rounded-lg border border-border bg-card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">{Number(c.score).toFixed(1)}</span>
              <span className="text-sm font-medium">{c.title}</span>
              <span className={c.status === "open" ? "rounded bg-secondary px-2 py-0.5 text-[11px]" : "rounded bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-400"}>
                {STATUS_LABELS[c.status] ?? c.status}
              </span>
              <span className="text-[11px] text-muted-foreground">{CHANGE_TYPE_LABELS[c.change_type] ?? c.change_type}</span>
              <div className="ml-auto flex items-center gap-1.5">
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setExpanded(expanded === c.id ? null : c.id)}>
                  {expanded === c.id ? "Hide" : "Details"}
                </Button>
                {c.status === "open" && (
                  <>
                    <Button size="sm" className="h-7 px-2 text-xs" disabled={busy === c.id} onClick={async () => {
                      setBusy(c.id); setError(null); setNotice(null);
                      try {
                        const r = await executeFn({ data: { changeId: c.id } });
                        if (!r.ok) setError(r.detail ?? r.error ?? "Failed");
                        else setNotice(r.outcome === "awaiting_approval" ? "Queued for your approval in the Action Centre." : (r.detail ?? "Submitted."));
                        refresh();
                      } catch (e: any) { setError(e?.message ?? "Failed"); }
                      finally { setBusy(null); }
                    }}>
                      {busy === c.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}Execute
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busy === c.id} onClick={async () => {
                      setBusy(c.id);
                      try { await dismissFn({ data: { changeId: c.id } }); refresh(); }
                      catch (e: any) { setError(e?.message ?? "Failed"); }
                      finally { setBusy(null); }
                    }}>Dismiss</Button>
                  </>
                )}
              </div>
            </div>
            <p className="mt-1 break-all text-[11px] text-muted-foreground">{c.page_url}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{c.why}</p>
            {expanded === c.id && (
              <div className="mt-2 space-y-2 rounded-md border border-border/60 bg-background/50 p-2 text-[11px] text-muted-foreground">
                <div><p className="font-medium text-foreground">Current</p><p>{c.current_state}</p></div>
                <div><p className="font-medium text-foreground">Proposed</p><p>{c.proposed_state}</p></div>
                <div><p className="font-medium text-foreground">Expected impact</p><p>{c.expected_impact}</p></div>
                <div><p className="font-medium text-foreground">Risk</p><p>{c.risk}</p></div>
                <div><p className="font-medium text-foreground">Rollback</p><p>{c.rollback_plan}</p></div>
                <div>
                  <p className="font-medium text-foreground">Supporting data (Clarity + conversions)</p>
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(c.supporting_data, null, 1)}</pre>
                  <p className="mt-1">Confidence: {Number(c.confidence).toFixed(2)} · Last detected: {c.last_detected_at ? new Date(c.last_detected_at).toLocaleString() : "—"}</p>
                </div>
                {c.status === "handled" && (
                  <p className="text-amber-400">
                    A handoff package has been delivered — the change is NOT live until you deploy it on your website and mark the package deployed (Campaigns tab shows deployment packages).
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
