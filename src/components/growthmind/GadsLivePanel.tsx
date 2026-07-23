import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Fragment, useEffect, useRef, useState } from "react";
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
  getGadsCampaignDetail,
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
  immediate_attention: "Immediate attention",
  wasted_spend:        "Wasted spend",
  budget_opportunity:  "Budget opportunity",
  conversion:          "Conversion",
  tracking_quality:    "Tracking quality",
  growth:              "Growth",
};

const DIMENSION_LABELS: Record<string, string> = {
  ad_group:    "Ad groups",
  keyword:     "Keywords",
  search_term: "Search terms",
  device:      "Devices",
  location:    "Locations",
  schedule:    "Schedule",
};

type SortKey = "name" | "status" | "spend" | "impressions" | "clicks" | "ctr" | "cpc" | "conversions" | "costPerConv" | "budget";

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
  const [changingAccount, setChangingAccount] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("spend");
  const [sortDesc, setSortDesc] = useState(true);
  const [statusFilter, setStatusFilter] = useState<"all" | "enabled" | "paused">("all");
  const autoSelectTried = useRef(false);

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
    onMutate: () => { autoSelectTried.current = false; }, // each fresh discovery may auto-select again
    onError: (e: any) => toast.error("Could not list your Google Ads accounts", { description: e?.message }),
  });

  const selectMut = useMutation({
    mutationFn: (input: { customerId: string; loginCustomerId?: string | null }) => selectFn({ data: input }),
    onSuccess: (r: any) => {
      toast.success(`Connected to ${r?.descriptiveName || r?.customerId} — first sync started`);
      setChangingAccount(false);
      refetchConn();
      setTimeout(() => { refetchConn(); refetchDash(); }, 8000);
    },
    onError: (e: any) => toast.error("Could not select that account", { description: e?.message }),
  });

  // Auto-select when discovery finds exactly one client (non-manager) account.
  const autoSelectable = (discoverMut.data as any)?.autoSelectable ?? null;
  useEffect(() => {
    if (!autoSelectable || autoSelectTried.current || selectMut.isPending) return;
    if (state?.accountSelected && !changingAccount) return;
    autoSelectTried.current = true;
    toast.info(`Found one advertising account — connecting to ${autoSelectable.descriptiveName || autoSelectable.customerId}…`);
    selectMut.mutate({ customerId: autoSelectable.customerId, loginCustomerId: autoSelectable.loginCustomerId ?? null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSelectable]);

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

  const detailFn = useServerFn(getGadsCampaignDetail);
  const { data: campDetail, isLoading: detailLoading } = useQuery({
    queryKey: ["gads-campaign-detail", expandedCampaign],
    queryFn:  () => detailFn({ data: { campaignId: expandedCampaign! } }),
    enabled: !!expandedCampaign,
    staleTime: 60_000,
    throwOnError: false,
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

  const visibleCampaigns = (() => {
    const filtered = statusFilter === "all" ? campaigns : campaigns.filter((c: any) => (c.status ?? "").toLowerCase() === statusFilter);
    const val = (c: any): string | number => {
      switch (sortKey) {
        case "name":        return (c.name ?? "").toLowerCase();
        case "status":      return c.status ?? "";
        case "spend":       return c.spend ?? 0;
        case "impressions": return c.impressions ?? 0;
        case "clicks":      return c.clicks ?? 0;
        case "ctr":         return c.impressions > 0 ? c.clicks / c.impressions : 0;
        case "cpc":         return c.clicks > 0 ? c.spend / c.clicks : 0;
        case "conversions": return c.conversions ?? 0;
        case "costPerConv": return c.conversions > 0 ? c.spend / c.conversions : 0;
        case "budget":      return c.budget ?? 0;
      }
    };
    return [...filtered].sort((a, b) => {
      const va = val(a), vb = val(b);
      const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return sortDesc ? -cmp : cmp;
    });
  })();
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
          {state?.accountSelected && (
            <Button size="sm" variant="ghost" className="h-7 text-[11px] gap-1.5 text-muted-foreground"
              onClick={() => {
                const next = !changingAccount;
                setChangingAccount(next);
                if (next) {
                  autoSelectTried.current = false; // allow re-auto-select in the change flow
                  if (!discoverMut.isPending) discoverMut.mutate();
                }
              }}
              disabled={discoverMut.isPending}>
              {discoverMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
              {changingAccount ? "Cancel change" : "Change advertising account"}
            </Button>
          )}
        </div>
      </div>

      {/* ── Account selector (after discovery before selection, or when changing account) ── */}
      {state?.apiVerified && (changingAccount || !state?.accountSelected) && discovered && (
        <div className="px-4 py-3 border-t border-white/[0.05]">
          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.08em] mb-2">
            {changingAccount ? "Change advertising account" : "Select your advertising account"}
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
              <div className="px-4 py-3 grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-3 border-t border-white/[0.04]">
                {[
                  { label: "Spend",       cur: kpis.spend,       prev: prevKpis?.spend ?? 0,       fmt: (n: number) => fmtGBP(n, currency), invert: false },
                  { label: "Impressions", cur: kpis.impressions, prev: prevKpis?.impressions ?? 0, fmt: (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n), invert: false },
                  { label: "Clicks",      cur: kpis.clicks,      prev: prevKpis?.clicks ?? 0,      fmt: (n: number) => n.toLocaleString(), invert: false },
                  { label: "CTR",
                    cur: kpis.impressions > 0 ? (kpis.clicks / kpis.impressions) * 100 : 0,
                    prev: (prevKpis?.impressions ?? 0) > 0 ? (prevKpis!.clicks / prevKpis!.impressions) * 100 : 0,
                    fmt: (n: number) => n > 0 ? `${n.toFixed(2)}%` : "—", invert: false },
                  { label: "Avg CPC",
                    cur: kpis.clicks > 0 ? kpis.spend / kpis.clicks : 0,
                    prev: (prevKpis?.clicks ?? 0) > 0 ? (prevKpis!.spend / prevKpis!.clicks) : 0,
                    fmt: (n: number) => n > 0 ? fmtGBP(n, currency) : "—", invert: true },
                  { label: "Conversions", cur: kpis.conversions, prev: prevKpis?.conversions ?? 0, fmt: (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 }), invert: false },
                  { label: "Cost / conv", cur: kpis.conversions > 0 ? kpis.spend / kpis.conversions : 0,
                    prev: (prevKpis?.conversions ?? 0) > 0 ? (prevKpis!.spend / prevKpis!.conversions) : 0,
                    fmt: (n: number) => n > 0 ? fmtGBP(n, currency) : "—", invert: true },
                  { label: "Conv. value", cur: kpis.conversionsValue ?? 0, prev: prevKpis?.conversionsValue ?? 0,
                    fmt: (n: number) => n > 0 ? fmtGBP(n, currency) : "—", invert: false },
                  { label: "ROAS",
                    cur: kpis.spend > 0 ? (kpis.conversionsValue ?? 0) / kpis.spend : 0,
                    prev: (prevKpis?.spend ?? 0) > 0 ? ((prevKpis!.conversionsValue ?? 0) / prevKpis!.spend) : 0,
                    fmt: (n: number) => n > 0 ? `${n.toFixed(2)}x` : "—", invert: false },
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

              {/* Campaigns table — sortable, filterable, click a row for detail */}
              <div className="border-t border-white/[0.04]">
                <div className="px-4 pt-3 pb-1.5 flex items-center gap-2 flex-wrap">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.08em]">
                    Live campaigns ({visibleCampaigns.length})
                  </p>
                  <div className="ml-auto flex items-center gap-1">
                    {([["all", "All"], ["enabled", "Enabled"], ["paused", "Paused"]] as const).map(([v, l]) => (
                      <button key={v} onClick={() => setStatusFilter(v)}
                        className={cn(
                          "rounded-md px-2 py-0.5 text-[10px] font-medium transition-colors",
                          statusFilter === v ? "bg-blue-500/15 text-blue-300" : "text-muted-foreground hover:text-foreground",
                        )}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                {visibleCampaigns.length === 0 ? (
                  <p className="px-4 pb-4 text-xs text-muted-foreground">
                    {campaigns.length === 0
                      ? <>No campaign data in the last {days} days. If you just connected, the first sync may still be running.</>
                      : <>No {statusFilter.toLowerCase()} campaigns in the last {days} days.</>}
                  </p>
                ) : (
                  <div className="overflow-x-auto pb-1">
                    <table className="w-full min-w-[700px] text-xs">
                      <thead>
                        <tr className="border-y border-white/[0.04] bg-white/[0.02]">
                          {([
                            ["name", "Campaign"], ["status", "Status"], ["spend", "Spend"],
                            ["clicks", "Clicks"], ["ctr", "CTR"], ["cpc", "CPC"],
                            ["conversions", "Conv."], ["costPerConv", "Cost/conv"], ["budget", "Budget/day"],
                          ] as Array<[SortKey, string]>).map(([k, h]) => (
                            <th key={k}
                              className="px-3 py-2 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.08em] first:pl-4 last:pr-4 cursor-pointer select-none hover:text-foreground"
                              onClick={() => {
                                if (sortKey === k) setSortDesc(d => !d);
                                else { setSortKey(k); setSortDesc(k !== "name" && k !== "status"); }
                              }}>
                              {h}{sortKey === k ? (sortDesc ? " ↓" : " ↑") : ""}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.03]">
                        {visibleCampaigns.map((c: any) => (
                          <Fragment key={c.campaignId}>
                            <tr className="hover:bg-white/[0.02] transition-colors cursor-pointer"
                              onClick={() => setExpandedCampaign(expandedCampaign === c.campaignId ? null : c.campaignId)}>
                              <td className="px-4 py-2 font-medium max-w-[200px] truncate">
                                <span className="inline-flex items-center gap-1">
                                  {expandedCampaign === c.campaignId ? <ChevronUp className="h-3 w-3 text-muted-foreground shrink-0" /> : <ChevronDown className="h-3 w-3 text-muted-foreground/50 shrink-0" />}
                                  {c.name}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                <span className={cn(
                                  "rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase",
                                  (c.status ?? "").toLowerCase() === "enabled" ? "bg-emerald-500/10 text-emerald-400" :
                                  (c.status ?? "").toLowerCase() === "paused"  ? "bg-amber-500/10 text-amber-400" :
                                                                                 "bg-slate-500/10 text-slate-400",
                                )}>{(c.status ?? "").toLowerCase() || "—"}</span>
                              </td>
                              <td className="px-3 py-2 tabular-nums">{fmtGBP(c.spend, currency)}</td>
                              <td className="px-3 py-2 tabular-nums">{c.clicks.toLocaleString()}</td>
                              <td className="px-3 py-2 tabular-nums">{c.impressions > 0 ? `${((c.clicks / c.impressions) * 100).toFixed(2)}%` : "—"}</td>
                              <td className="px-3 py-2 tabular-nums">{c.clicks > 0 ? fmtGBP(c.spend / c.clicks, currency) : "—"}</td>
                              <td className="px-3 py-2 tabular-nums font-medium">{Number(c.conversions).toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                              <td className="px-3 py-2 tabular-nums">{c.conversions > 0 ? fmtGBP(c.spend / c.conversions, currency) : "—"}</td>
                              <td className="px-3 py-2 tabular-nums text-muted-foreground">{c.budget != null ? fmtGBP(c.budget, currency) : "—"}</td>
                            </tr>
                            {expandedCampaign === c.campaignId && (
                              <tr>
                                <td colSpan={9} className="px-4 py-3 bg-white/[0.015]">
                                  {detailLoading ? (
                                    <div className="flex items-center gap-2 text-muted-foreground py-2">
                                      <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />
                                      <span className="text-[11px]">Loading campaign detail…</span>
                                    </div>
                                  ) : campDetail ? (
                                    <div className="space-y-3">
                                      {(campDetail.findings ?? []).length > 0 && (
                                        <div>
                                          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.08em] mb-1.5 flex items-center gap-1">
                                            <Lightbulb className="h-3 w-3 text-amber-400" /> Findings for this campaign
                                          </p>
                                          <div className="space-y-1">
                                            {(campDetail.findings ?? []).map((f: any) => (
                                              <p key={f.id} className="text-[11px] text-muted-foreground leading-snug">
                                                <span className="font-medium text-foreground">{f.title}</span>
                                                <span className="ml-1.5 text-[9px] uppercase text-muted-foreground/60">{SECTION_LABELS[f.section] ?? f.section}</span>
                                                {f.recommended_action && <span className="block text-muted-foreground/80">{f.recommended_action}</span>}
                                              </p>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                      {Object.keys(campDetail.dimensions ?? {}).length === 0 && (campDetail.findings ?? []).length === 0 && (
                                        <p className="text-[11px] text-muted-foreground">No breakdown data synced for this campaign yet — run a sync to pull ad group, keyword and device stats.</p>
                                      )}
                                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                        {Object.entries(campDetail.dimensions ?? {}).map(([dim, rows]: [string, any]) => (
                                          <div key={dim} className="rounded-lg border border-white/[0.06] bg-white/[0.01] p-2.5">
                                            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.08em] mb-1.5">
                                              {DIMENSION_LABELS[dim] ?? dim.replace(/_/g, " ")}
                                            </p>
                                            <div className="space-y-1">
                                              {(rows as any[]).slice(0, 8).map((r: any, i: number) => (
                                                <div key={`${r.key}-${i}`} className="flex items-center justify-between gap-2 text-[10px]">
                                                  <span className="truncate text-muted-foreground" title={r.label}>{r.label || r.key}</span>
                                                  <span className="tabular-nums shrink-0">
                                                    {fmtGBP(r.spend, currency)} · {r.clicks} cl · {Number(r.conversions).toLocaleString(undefined, { maximumFractionDigits: 1 })} conv
                                                  </span>
                                                </div>
                                              ))}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  ) : (
                                    <p className="text-[11px] text-muted-foreground">Could not load campaign detail.</p>
                                  )}
                                </td>
                              </tr>
                            )}
                          </Fragment>
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
                    Every recommendation is generated deterministically from your synced Google Ads data (and CRM lead outcomes where attribution exists) — each one carries its numeric evidence.
                    Approving logs a change request for your team — WEBEE never edits your live Google Ads account. Critical findings are also forwarded to HiveMind.
                  </p>
                  <div className="space-y-2">
                    {recommendations.map((r: any) => (
                      <div key={r.id} className={cn(
                        "rounded-lg border px-3 py-2.5",
                        r.priority === "critical" ? "border-red-500/25 bg-red-500/[0.06]" :
                        r.priority === "high"   ? "border-orange-500/20 bg-orange-500/[0.05]" :
                        r.priority === "medium" ? "border-amber-500/15 bg-amber-500/[0.04]" :
                                                  "border-white/[0.06] bg-white/[0.02]",
                      )}>
                        <div className="flex items-start gap-2.5">
                          <AlertTriangle className={cn(
                            "h-3.5 w-3.5 shrink-0 mt-0.5",
                            r.priority === "critical" ? "text-red-400" : r.priority === "high" ? "text-orange-400" : r.priority === "medium" ? "text-amber-400" : "text-slate-400",
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
                <p className="mt-1 text-[10px] text-muted-foreground/60">
                  Auto-refreshes every {conn.account?.syncConfig?.incrementalMinutes ?? 15} minutes ·
                  full 35-day history refresh every {conn.account?.syncConfig?.historicalHours ?? 24} hours
                </p>
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
