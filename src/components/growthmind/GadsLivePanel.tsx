import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  Loader2, RefreshCw, CheckCircle2, AlertTriangle, Circle,
  Lightbulb, ChevronDown, ChevronUp, Search, ShieldCheck,
  MousePointerClick, Target, TrendingUp, TrendingDown, XCircle, FileClock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  getGadsConnection,
  discoverGadsAccounts,
  selectGadsAccount,
  runGadsRefreshNow,
  getGadsDashboard,
  setGadsRecommendationStatus,
} from "@/lib/growthmind/gads-live.server";

// ── 4-stage connection status card ─────────────────────────────────────────────

const STAGES = [
  { key: "oauthConnected",  label: "Google sign-in" },
  { key: "apiVerified",     label: "API access verified" },
  { key: "accountSelected", label: "Ads account selected" },
  { key: "syncHealthy",     label: "Data sync healthy" },
] as const;

function StageDot({ done, active }: { done: boolean; active: boolean }) {
  if (done) return <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />;
  if (active) return <Circle className="h-4 w-4 text-amber-400 shrink-0" />;
  return <Circle className="h-4 w-4 text-muted-foreground/30 shrink-0" />;
}

function fmtGBP(n: number, currency?: string | null) {
  const sym = currency === "USD" ? "$" : currency === "EUR" ? "€" : "£";
  return `${sym}${n.toLocaleString(undefined, { maximumFractionDigits: n >= 1000 ? 0 : 2 })}`;
}

function pctDelta(cur: number, prev: number): { text: string; up: boolean } | null {
  if (!prev) return null;
  const d = ((cur - prev) / prev) * 100;
  if (!isFinite(d)) return null;
  return { text: `${d > 0 ? "+" : ""}${d.toFixed(0)}%`, up: d > 0 };
}

const SECTION_LABELS: Record<string, string> = {
  budget:       "Budget",
  performance:  "Performance",
  keywords:     "Keywords",
  search_terms: "Search terms",
  devices:      "Devices",
  schedule:     "Schedule",
};

// ── Main panel ─────────────────────────────────────────────────────────────────

export function GadsLivePanel({ onConnectClick }: { onConnectClick: () => void }) {
  const qc = useQueryClient();
  const connFn     = useServerFn(getGadsConnection);
  const discoverFn = useServerFn(discoverGadsAccounts);
  const selectFn   = useServerFn(selectGadsAccount);
  const refreshFn  = useServerFn(runGadsRefreshNow);
  const dashFn     = useServerFn(getGadsDashboard);
  const recStatusFn = useServerFn(setGadsRecommendationStatus);

  const [days, setDays] = useState(30);
  const [showRuns, setShowRuns] = useState(false);
  const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null);

  const { data: conn, isLoading: connLoading, refetch: refetchConn } = useQuery({
    queryKey: ["gads-connection"],
    queryFn:  () => connFn(),
    staleTime: 30_000,
    throwOnError: false,
  });

  const state = conn?.state;
  const showDashboard = !!state?.accountSelected;

  const { data: dash, isLoading: dashLoading, refetch: refetchDash } = useQuery({
    queryKey: ["gads-dashboard", days],
    queryFn:  () => dashFn({ data: { days, compare: true } }),
    staleTime: 60_000,
    enabled: showDashboard,
    throwOnError: false,
  });

  const discoverMut = useMutation({
    mutationFn: () => discoverFn(),
    onError: (e: any) => toast.error("Could not list your Google Ads accounts", { description: e?.message }),
  });

  const selectMut = useMutation({
    mutationFn: (input: { customerId: string; loginCustomerId?: string | null }) => selectFn({ data: input }),
    onSuccess: (r: any) => {
      toast.success(`Connected to ${r?.descriptiveName || r?.customerId} — first sync started`);
      refetchConn();
      setTimeout(() => { refetchConn(); refetchDash(); }, 8000);
    },
    onError: (e: any) => toast.error("Could not select that account", { description: e?.message }),
  });

  const refreshMut = useMutation({
    mutationFn: () => refreshFn(),
    onSuccess: (r: any) => {
      if (r?.ok) toast.success(`Synced ${r.campaigns} campaign${r.campaigns !== 1 ? "s" : ""} · ${fmtGBP(r.spend ?? 0)} spend`);
      else if (r?.status === "skipped") toast.info("A sync is already running — try again in a minute");
      else toast.error("Sync failed", { description: r?.error });
      refetchConn(); refetchDash();
      qc.invalidateQueries({ queryKey: ["ads-accounts"] });
    },
    onError: (e: any) => toast.error("Sync failed", { description: e?.message }),
  });

  const recMut = useMutation({
    mutationFn: (input: { id: string; status: "approved" | "dismissed" | "rejected" }) => recStatusFn({ data: input }),
    onSuccess: (r: any, vars) => {
      if (vars.status === "approved") {
        toast.success("Approved — logged as a change request for you to apply in Google Ads", {
          description: "WEBEE never edits your live Google Ads account automatically.",
        });
      } else {
        toast.success("Recommendation dismissed");
      }
      refetchDash();
    },
    onError: (e: any) => toast.error("Could not update recommendation", { description: e?.message }),
  });

  if (connLoading) {
    return (
      <div className="border-t border-white/[0.06] px-4 py-6 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
        <span className="text-xs">Checking Google Ads connection…</span>
      </div>
    );
  }
  if (!conn) return null;

  const discovered = (discoverMut.data as any)?.customers
    ?? (conn.account?.accessibleCustomers as any[] | null)
    ?? null;
  const selectable = discovered?.filter((c: any) => !c.isManager) ?? [];

  const kpis = dash?.kpis ?? null;
  const prevKpis = dash?.prevKpis ?? null;
  const campaigns: any[] = dash?.campaigns ?? [];
  const recommendations: any[] = (dash?.recommendations ?? []).filter((r: any) => r.status === "new" || r.status === "under_review");
  const changeRequests: any[] = dash?.changeRequests ?? [];
  const syncRuns: any[] = dash?.syncRuns ?? [];
  const currency = dash?.account?.currencyCode ?? conn.account?.currencyCode;

  return (
    <div className="border-t border-white/[0.06]">

      {/* ── 4-stage status ── */}
      <div className="px-4 py-3 bg-white/[0.015]">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {STAGES.map((s, i) => {
            const done = !!state?.[s.key];
            const firstIncomplete = STAGES.findIndex(st => !state?.[st.key]);
            return (
              <div key={s.key} className="flex items-center gap-1.5">
                <StageDot done={done} active={i === firstIncomplete} />
                <span className={cn("text-[11px]", done ? "text-foreground" : "text-muted-foreground/60")}>{s.label}</span>
              </div>
            );
          })}
        </div>
        {state?.detail && (
          <p className={cn(
            "text-[11px] mt-2 leading-relaxed",
            state.stateLabel === "sync_failed" || state.stateLabel === "needs_reconnect" ? "text-red-400/90" :
            state.syncHealthy ? "text-emerald-400/80" : "text-muted-foreground",
          )}>
            {state.detail}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 mt-2.5">
          {(!state?.oauthConnected || state?.stateLabel === "needs_reconnect") && (
            <Button size="sm" className="h-7 text-[11px] bg-white text-black hover:bg-white/90" onClick={onConnectClick}>
              Connect with Google
            </Button>
          )}
          {state?.apiVerified && !state?.accountSelected && (
            <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1.5"
              onClick={() => discoverMut.mutate()} disabled={discoverMut.isPending}>
              {discoverMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
              Find my Ads accounts
            </Button>
          )}
          {state?.accountSelected && (
            <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1.5"
              onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending}>
              {refreshMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Sync now
            </Button>
          )}
        </div>
      </div>

      {/* ── Account selector (after discovery, before selection) ── */}
      {state?.apiVerified && !state?.accountSelected && discovered && (
        <div className="px-4 py-3 border-t border-white/[0.05]">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.08em] mb-2">
            Select your advertising account
          </p>
          {selectable.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No client advertising accounts found under this Google login
              {discovered.length > 0 ? " (only manager accounts were found)" : ""}.
              Make sure you signed in with the Google account that has access to your Google Ads account.
            </p>
          ) : (
            <div className="space-y-1.5">
              {selectable.map((c: any) => (
                <button key={c.customerId}
                  className="w-full flex items-center gap-3 rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 hover:border-blue-500/30 transition-colors text-left"
                  disabled={selectMut.isPending}
                  onClick={() => selectMut.mutate({ customerId: c.customerId, loginCustomerId: c.loginCustomerId ?? null })}>
                  <Target className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{c.descriptiveName || `Account ${c.customerId}`}</p>
                    <p className="text-[10px] text-muted-foreground">
                      ID {c.customerId}{c.currencyCode ? ` · ${c.currencyCode}` : ""}{c.viaManager ? " · via manager account" : ""}
                    </p>
                  </div>
                  {selectMut.isPending
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    : <span className="text-[10px] text-blue-400 font-medium shrink-0">Use this account</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Live dashboard ── */}
      {showDashboard && (
        <>
          {/* Account line + window picker */}
          <div className="px-4 py-2.5 border-t border-white/[0.05] flex items-center gap-2 flex-wrap">
            <ShieldCheck className="h-3 w-3 text-blue-400 shrink-0" />
            <span className="text-[11px] text-muted-foreground">
              {conn.account?.descriptiveName || "Google Ads"} · ID {conn.account?.customerId}
              {currency ? ` · ${currency}` : ""}
            </span>
            <div className="ml-auto flex items-center gap-1">
              {[7, 30, 90].map(d => (
                <button key={d} onClick={() => setDays(d)}
                  className={cn(
                    "rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors",
                    days === d ? "bg-blue-500/15 text-blue-300" : "text-muted-foreground hover:text-foreground",
                  )}>
                  {d}d
                </button>
              ))}
            </div>
          </div>

          {dashLoading ? (
            <div className="px-4 py-6 flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
              <span className="text-xs">Loading live campaign data…</span>
            </div>
          ) : kpis ? (
            <>
              {/* KPI row */}
              <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-5 gap-3 border-t border-white/[0.04]">
                {[
                  { label: "Spend",       cur: kpis.spend,       prev: prevKpis?.spend ?? 0,       fmt: (n: number) => fmtGBP(n, currency), invert: false },
                  { label: "Impressions", cur: kpis.impressions, prev: prevKpis?.impressions ?? 0, fmt: (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n), invert: false },
                  { label: "Clicks",      cur: kpis.clicks,      prev: prevKpis?.clicks ?? 0,      fmt: (n: number) => n.toLocaleString(), invert: false },
                  { label: "Conversions", cur: kpis.conversions, prev: prevKpis?.conversions ?? 0, fmt: (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 }), invert: false },
                  { label: "Cost / conv", cur: kpis.conversions > 0 ? kpis.spend / kpis.conversions : 0,
                    prev: (prevKpis?.conversions ?? 0) > 0 ? (prevKpis!.spend / prevKpis!.conversions) : 0,
                    fmt: (n: number) => n > 0 ? fmtGBP(n, currency) : "—", invert: true },
                ].map(m => {
                  const delta = pctDelta(m.cur, m.prev);
                  const good = delta ? (m.invert ? !delta.up : delta.up) : null;
                  return (
                    <div key={m.label}>
                      <p className="text-[10px] text-muted-foreground/60 uppercase tracking-widest">{m.label}</p>
                      <p className="text-base font-bold tabular-nums mt-0.5">{m.fmt(m.cur)}</p>
                      {delta && (
                        <p className={cn("text-[10px] flex items-center gap-0.5", good ? "text-emerald-400" : "text-red-400")}>
                          {delta.up ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                          {delta.text} vs prior {days}d
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Campaigns table */}
              <div className="border-t border-white/[0.04]">
                <p className="px-4 pt-3 pb-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.08em]">
                  Live campaigns ({campaigns.length})
                </p>
                {campaigns.length === 0 ? (
                  <p className="px-4 pb-4 text-xs text-muted-foreground">
                    No campaign data in the last {days} days. If you just connected, the first sync may still be running.
                  </p>
                ) : (
                  <div className="overflow-x-auto pb-1">
                    <table className="w-full min-w-[560px] text-xs">
                      <thead>
                        <tr className="border-y border-white/[0.04] bg-white/[0.02]">
                          {["Campaign", "Status", "Spend", "Clicks", "Conv.", "Cost/conv", "Budget/day"].map(h => (
                            <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.08em] first:pl-4 last:pr-4">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.03]">
                        {campaigns.map((c: any) => (
                          <tr key={c.campaignId} className="hover:bg-white/[0.02] transition-colors cursor-pointer"
                            onClick={() => setExpandedCampaign(expandedCampaign === c.campaignId ? null : c.campaignId)}>
                            <td className="px-4 py-2 font-medium max-w-[200px] truncate">{c.name}</td>
                            <td className="px-3 py-2">
                              <span className={cn(
                                "rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase",
                                c.status === "ENABLED" ? "bg-emerald-500/10 text-emerald-400" :
                                c.status === "PAUSED"  ? "bg-amber-500/10 text-amber-400" :
                                                         "bg-slate-500/10 text-slate-400",
                              )}>{(c.status ?? "").toLowerCase() || "—"}</span>
                            </td>
                            <td className="px-3 py-2 tabular-nums">{fmtGBP(c.spend, currency)}</td>
                            <td className="px-3 py-2 tabular-nums">{c.clicks.toLocaleString()}</td>
                            <td className="px-3 py-2 tabular-nums font-medium">{Number(c.conversions).toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                            <td className="px-3 py-2 tabular-nums">{c.conversions > 0 ? fmtGBP(c.spend / c.conversions, currency) : "—"}</td>
                            <td className="px-3 py-2 tabular-nums text-muted-foreground">{c.budget != null ? fmtGBP(c.budget, currency) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Recommendations — approval-gated, never auto-applied */}
              {recommendations.length > 0 && (
                <div className="border-t border-white/[0.05] px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground mb-1 flex items-center gap-1.5">
                    <Lightbulb className="h-3 w-3 text-amber-400" />
                    GrowthMind recommendations ({recommendations.length})
                  </p>
                  <p className="text-[10px] text-muted-foreground/60 mb-2.5">
                    Approving logs a change request for your team — WEBEE never edits your live Google Ads account.
                  </p>
                  <div className="space-y-2">
                    {recommendations.map((r: any) => (
                      <div key={r.id} className={cn(
                        "rounded-lg border px-3 py-2.5",
                        r.priority === "high"   ? "border-orange-500/20 bg-orange-500/[0.05]" :
                        r.priority === "medium" ? "border-amber-500/15 bg-amber-500/[0.04]" :
                                                  "border-white/[0.06] bg-white/[0.02]",
                      )}>
                        <div className="flex items-start gap-2.5">
                          <AlertTriangle className={cn(
                            "h-3.5 w-3.5 shrink-0 mt-0.5",
                            r.priority === "high" ? "text-orange-400" : r.priority === "medium" ? "text-amber-400" : "text-slate-400",
                          )} />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-semibold leading-snug">
                              {r.title}
                              <span className="ml-2 text-[9px] font-medium text-muted-foreground/60 uppercase">{SECTION_LABELS[r.section] ?? r.section}</span>
                            </p>
                            {r.campaign_name && <p className="text-[10px] text-muted-foreground/70 mt-0.5">Campaign: {r.campaign_name}</p>}
                            <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{r.recommended_action}</p>
                            {r.expected_benefit && <p className="text-[10px] text-emerald-400/70 mt-1">{r.expected_benefit}</p>}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]"
                              disabled={recMut.isPending}
                              onClick={() => recMut.mutate({ id: r.id, status: "approved" })}>
                              Approve
                            </Button>
                            <button className="p-1 rounded text-muted-foreground/50 hover:text-muted-foreground"
                              disabled={recMut.isPending}
                              onClick={() => recMut.mutate({ id: r.id, status: "dismissed" })}>
                              <XCircle className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Approved change requests */}
              {changeRequests.filter((cr: any) => cr.status === "approved").length > 0 && (
                <div className="border-t border-white/[0.05] px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground mb-2 flex items-center gap-1.5">
                    <MousePointerClick className="h-3 w-3 text-blue-400" />
                    Approved change requests — apply these in Google Ads
                  </p>
                  <div className="space-y-1.5">
                    {changeRequests.filter((cr: any) => cr.status === "approved").slice(0, 5).map((cr: any) => (
                      <div key={cr.id} className="rounded-lg border border-blue-500/15 bg-blue-500/[0.04] px-3 py-2">
                        <p className="text-xs font-medium">{cr.payload?.title ?? cr.change_type}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{cr.payload?.recommendedAction}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Sync history */}
              <div className="border-t border-white/[0.05] px-4 py-2.5">
                <button className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowRuns(s => !s)}>
                  <FileClock className="h-3 w-3" />
                  Sync history
                  {showRuns ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>
                {showRuns && (
                  <div className="mt-2 space-y-1">
                    {syncRuns.length === 0 && <p className="text-[11px] text-muted-foreground">No syncs recorded yet.</p>}
                    {syncRuns.map((run: any) => (
                      <div key={run.id} className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        {run.status === "success"
                          ? <CheckCircle2 className="h-2.5 w-2.5 text-emerald-400 shrink-0" />
                          : run.status === "error"
                            ? <XCircle className="h-2.5 w-2.5 text-red-400 shrink-0" />
                            : <Loader2 className="h-2.5 w-2.5 animate-spin text-blue-400 shrink-0" />}
                        <span>{new Date(run.started_at).toLocaleString()}</span>
                        <span className="uppercase text-muted-foreground/50">{run.run_type}</span>
                        {run.status === "success" && <span>{run.campaigns_synced} campaigns · {fmtGBP(Number(run.spend_synced ?? 0), currency)}</span>}
                        {run.status === "error" && <span className="text-red-400/80 truncate max-w-[280px]" title={run.error_message}>{run.error_message}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <p className="px-4 py-4 text-xs text-muted-foreground border-t border-white/[0.04]">
              No synced data yet — the first sync runs right after you select an account.
            </p>
          )}
        </>
      )}
    </div>
  );
}
