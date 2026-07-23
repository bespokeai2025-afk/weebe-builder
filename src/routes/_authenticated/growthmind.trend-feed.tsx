// GrowthMind → Trend Feed — discovered + scored trend items, run history,
// discovery/scoring triggers and cost controls.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  TrendingUp, Loader2, Sparkles, RefreshCw, Bookmark, X, ExternalLink,
  Settings2, ShieldAlert, Radar, Ban, Microscope,
} from "lucide-react";
import { GrowthMindShell } from "@/components/growthmind/GrowthMindShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  getTrendFeed, runTrendDiscoveryNow, runTrendAiScoring, applyTrendItemAction,
  updateTrendScoutSettings, type TrendFeedItem,
} from "@/lib/growthmind/growthmind.trend-feed";

export const Route = createFileRoute("/_authenticated/growthmind/trend-feed")({
  component: () => (
    <GrowthMindShell>
      <TrendFeedPage />
    </GrowthMindShell>
  ),
});

const STATUS_TABS = [
  { key: "all",         label: "All" },
  { key: "recommended", label: "Recommended" },
  { key: "screened",    label: "Screened" },
  { key: "discovered",  label: "New" },
  { key: "dismissed",   label: "Dismissed" },
] as const;

const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram", facebook: "Facebook", youtube: "YouTube",
  reddit: "Reddit", google_trends: "Google Trends", news: "News",
  meta_ad_library: "Ad Library", internal: "Your Data",
};

function scoreColor(n: number): string {
  if (n >= 70) return "text-emerald-400";
  if (n >= 50) return "text-amber-400";
  return "text-muted-foreground";
}

function TrendFeedPage() {
  const feedFn      = useServerFn(getTrendFeed);
  const discoverFn  = useServerFn(runTrendDiscoveryNow);
  const scoreFn     = useServerFn(runTrendAiScoring);
  const actionFn    = useServerFn(applyTrendItemAction);
  const settingsFn  = useServerFn(updateTrendScoutSettings);
  const qc = useQueryClient();

  const [tab, setTab]               = useState<(typeof STATUS_TABS)[number]["key"]>("all");
  const [discovering, setDiscovering] = useState(false);
  const [scoring, setScoring]       = useState(false);
  const [itemBusy, setItemBusy]     = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [mounted, setMounted]       = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["gm-trend-feed", tab],
    queryFn:  () => feedFn({ data: { status: tab } }),
    staleTime: 30_000,
    throwOnError: false,
  });

  const items    = data?.items ?? [];
  const settings = data?.settings;

  const [dailyLimit, setDailyLimit] = useState<string>("");
  const [minScore, setMinScore]     = useState<string>("");
  useEffect(() => {
    if (settings) { setDailyLimit(String(settings.dailyLimit)); setMinScore(String(settings.minScore)); }
  }, [settings?.dailyLimit, settings?.minScore]);

  async function refresh() { await qc.invalidateQueries({ queryKey: ["gm-trend-feed"] }); }

  async function handleDiscover() {
    setDiscovering(true);
    try {
      const res = await discoverFn();
      toast.success(`Discovery complete — ${res.summary.totalNew} new item${res.summary.totalNew === 1 ? "" : "s"}, ${res.screening.screened} passed screening`);
      await refresh();
    } catch (e: any) { toast.error(e?.message ?? "Discovery failed"); }
    finally { setDiscovering(false); }
  }

  async function handleScore() {
    setScoring(true);
    try {
      const res = await scoreFn();
      if (res.scored === 0 && res.rejected === 0) toast.info("Nothing to score — run discovery first.");
      else toast.success(`AI scoring done — ${res.scored} recommended, ${res.rejected} below threshold (cost ~$${res.costUsd.toFixed(4)})`);
      await refresh();
    } catch (e: any) { toast.error(e?.message ?? "Scoring failed"); }
    finally { setScoring(false); }
  }

  async function handleAction(id: string, action: TrendItemAction) {
    setItemBusy(id);
    try {
      const res = await actionFn({ data: { id, action } });
      if (action === "analyse") toast.success(res?.status === "recommended" ? "Analysed — recommended opportunity" : "Analysed — below threshold, dismissed");
      else if (action === "block_source") toast.success("Source blocked and item dismissed");
      else if (action === "add_to_monitoring") toast.success("Account added to your monitored sources");
      await refresh();
    } catch (e: any) { toast.error(e?.message ?? "Action failed"); }
    finally { setItemBusy(null); }
  }

  async function saveSettings(patch: { dailyLimit?: number; minScore?: number; enabled?: boolean }) {
    try {
      await settingsFn({ data: patch });
      toast.success("Settings saved");
      await refresh();
    } catch (e: any) { toast.error(e?.message ?? "Failed to save settings"); }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-emerald-500/15 flex items-center justify-center">
            <TrendingUp className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-base font-semibold">Trend Feed</h1>
            <p className="text-xs text-muted-foreground">
              Trends and content opportunities from your monitored sources, screened cheaply first — AI scoring only when you ask.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowSettings(v => !v)}>
            <Settings2 className="h-4 w-4 mr-1" /> Limits
          </Button>
          <Button size="sm" variant="outline" onClick={handleDiscover} disabled={discovering || settings?.enabled === false}>
            {discovering ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
            Run discovery
          </Button>
          <Button size="sm" onClick={handleScore} disabled={scoring}>
            {scoring ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
            Score with AI
          </Button>
        </div>
      </div>

      {/* Cost / status strip */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
        <span>Discovery runs today: <b className="text-foreground">{data?.runsToday ?? 0}</b> / {settings?.dailyLimit ?? "—"}</span>
        <span>AI cost today: <b className="text-foreground">${(data?.costToday ?? 0).toFixed(4)}</b></span>
        <span>Minimum score: <b className="text-foreground">{settings?.minScore ?? "—"}</b></span>
        {settings?.enabled === false && (
          <Badge variant="destructive" className="text-[10px]">Trend Scout disabled</Badge>
        )}
        <Link to="/growthmind/trend-sources" className="text-emerald-400 hover:underline inline-flex items-center gap-1">
          <Radar className="h-3 w-3" /> Manage sources
        </Link>
      </div>

      {showSettings && (
        <div className="rounded-xl border bg-card p-4 space-y-3">
          <div className="text-sm font-medium">Cost controls</div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Scheduled discovery runs / day (1-24)</div>
              <div className="flex gap-2">
                <Input type="number" min={1} max={24} value={dailyLimit} onChange={(e) => setDailyLimit(e.target.value)} className="h-8" />
                <Button size="sm" variant="outline" onClick={() => saveSettings({ dailyLimit: Math.max(1, Math.min(24, Number(dailyLimit) || 4)) })}>Save</Button>
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Minimum opportunity score (0-100)</div>
              <div className="flex gap-2">
                <Input type="number" min={0} max={100} value={minScore} onChange={(e) => setMinScore(e.target.value)} className="h-8" />
                <Button size="sm" variant="outline" onClick={() => saveSettings({ minScore: Math.max(0, Math.min(100, Number(minScore) || 55)) })}>Save</Button>
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-xs text-muted-foreground">Trend Scout enabled</div>
              <Switch checked={settings?.enabled !== false} onCheckedChange={(v) => saveSettings({ enabled: v })} />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">Owner/admin only. Discovery itself is free — AI scoring is the paid stage and only runs when you press "Score with AI".</p>
        </div>
      )}

      {/* Status tabs */}
      <div className="flex gap-1 flex-wrap">
        {STATUS_TABS.map(t => (
          <button key={t.key}
            className={cn("px-3 py-1.5 rounded-lg text-xs border",
              tab === t.key ? "bg-emerald-600 text-white border-emerald-600" : "bg-card hover:bg-muted")}
            onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading trend feed…
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border bg-card p-10 text-center space-y-2">
          <TrendingUp className="h-8 w-8 mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No trend items here yet.</p>
          <p className="text-xs text-muted-foreground">
            Add sources under <Link to="/growthmind/trend-sources" className="text-emerald-400 hover:underline">Trend Sources</Link>, then press "Run discovery".
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map(item => (
            <TrendCard key={item.id} item={item} busy={itemBusy === item.id} mounted={mounted} onAction={handleAction} />
          ))}
        </div>
      )}

      {/* Recent runs */}
      {(data?.runs?.length ?? 0) > 0 && (
        <div className="rounded-xl border bg-card">
          <div className="px-4 py-3 border-b text-sm font-medium">Recent runs</div>
          <div className="divide-y max-h-64 overflow-y-auto">
            {data!.runs.slice(0, 20).map((r: any) => (
              <div key={r.id} className="px-4 py-2 flex items-center gap-3 text-xs">
                <Badge variant={r.status === "error" ? "destructive" : "secondary"} className="text-[10px] w-16 justify-center">
                  {r.status}
                </Badge>
                <span className="w-24 text-muted-foreground">{r.runKind}</span>
                <span className="flex-1 truncate">{r.source}{r.errorMessage ? ` — ${r.errorMessage}` : r.skipReason ? ` — ${r.skipReason}` : ""}</span>
                <span className="text-muted-foreground">found {r.itemsFound} · new {r.itemsNew}</span>
                {r.costEstimate > 0 && <span className="text-amber-400">${r.costEstimate.toFixed(4)}</span>}
                <span className="text-muted-foreground">{mounted ? new Date(r.createdAt).toLocaleString() : ""}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

type TrendItemAction = "save" | "ignore" | "restore" | "analyse" | "block_source" | "add_to_monitoring";

function TrendCard({ item, busy, mounted, onAction }: {
  item: TrendFeedItem; busy: boolean; mounted: boolean;
  onAction: (id: string, action: TrendItemAction) => void;
}) {
  const s = item.scores as any;
  const total = s.total != null ? Number(s.total) : null;
  const prescreen = s.prescreen != null ? Number(s.prescreen) : null;
  const riskFlags: string[] = Array.isArray(s.riskFlags) ? s.riskFlags.filter((f: string) => f && f !== "none") : [];

  return (
    <div className="rounded-xl border bg-card p-4 space-y-2">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary" className="text-[10px]">{PLATFORM_LABEL[item.platform] ?? item.platform}</Badge>
            {item.mediaType && <Badge variant="outline" className="text-[10px]">{item.mediaType}</Badge>}
            <Badge variant={item.status === "recommended" ? "default" : "secondary"}
              className={cn("text-[10px]", item.status === "recommended" && "bg-emerald-600")}>
              {item.status}
            </Badge>
            {riskFlags.length > 0 && (
              <Badge variant="destructive" className="text-[10px] inline-flex items-center gap-1">
                <ShieldAlert className="h-3 w-3" /> {riskFlags.join(", ")}
              </Badge>
            )}
          </div>
          <div className="text-sm font-medium truncate">{item.title ?? item.caption?.slice(0, 120) ?? "(untitled)"}</div>
          {item.title && item.caption && (
            <p className="text-xs text-muted-foreground line-clamp-2">{item.caption}</p>
          )}
          <div className="text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap">
            {(item.authorHandle || item.authorName) && <span>by {item.authorHandle ?? item.authorName}</span>}
            {item.publishedAt && mounted && <span>{new Date(item.publishedAt).toLocaleDateString()}</span>}
            {item.url && (
              <a href={item.url} target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline inline-flex items-center gap-0.5">
                view <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          {s.whySelected && <p className="text-xs"><span className="text-muted-foreground">Why:</span> {s.whySelected}</p>}
          {s.suggestedAngle && <p className="text-xs"><span className="text-muted-foreground">Angle:</span> {s.suggestedAngle}</p>}
          {s.rejectionReason && item.status === "dismissed" && (
            <p className="text-xs text-amber-400/80">{s.rejectionReason}</p>
          )}
        </div>
        <div className="text-right shrink-0 space-y-1">
          {total != null ? (
            <div>
              <div className={cn("text-2xl font-bold leading-none", scoreColor(total))}>{total}</div>
              <div className="text-[10px] text-muted-foreground">opportunity</div>
            </div>
          ) : prescreen != null ? (
            <div>
              <div className={cn("text-lg font-semibold leading-none", scoreColor(prescreen))}>{prescreen}</div>
              <div className="text-[10px] text-muted-foreground">prescreen</div>
            </div>
          ) : null}
          {(s.momentum != null) && (
            <div className="text-[10px] text-muted-foreground">
              mom {s.momentum} · fresh {s.freshness} · sat {s.saturation}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 pt-1 flex-wrap">
        {item.status !== "recommended" && item.status !== "dismissed" && (
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={() => onAction(item.id, "save")}>
            <Bookmark className="h-3 w-3 mr-1" /> Save
          </Button>
        )}
        {item.status !== "dismissed" && (
          <Button size="sm" variant="outline" className="h-7 text-xs" asChild
            title="Multimodal AI watches and deconstructs this content — anatomy, why it works, and original adaptation briefs">
            <Link to="/growthmind/anatomy/$itemId" params={{ itemId: item.id }} search={{ run: true }}>
              <Microscope className="h-3 w-3 mr-1" /> Analyse deeply
            </Link>
          </Button>
        )}
        {item.status !== "dismissed" && (
          <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" disabled={busy} onClick={() => onAction(item.id, "analyse")}
            title="Run AI opportunity scoring on just this item (uses your Business DNA)">
            <Sparkles className="h-3 w-3 mr-1" /> AI score
          </Button>
        )}
        {item.status !== "dismissed" ? (
          <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" disabled={busy} onClick={() => onAction(item.id, "ignore")}>
            <X className="h-3 w-3 mr-1" /> Ignore
          </Button>
        ) : (
          <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={busy} onClick={() => onAction(item.id, "restore")}>
            Restore
          </Button>
        )}
        {item.authorHandle && item.platform !== "internal" && (
          <>
            <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" disabled={busy}
              onClick={() => onAction(item.id, "add_to_monitoring")} title="Watch this account in future discovery runs">
              <Radar className="h-3 w-3 mr-1" /> Monitor
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs text-red-400/80" disabled={busy}
              onClick={() => onAction(item.id, "block_source")} title="Never show content from this account again">
              <Ban className="h-3 w-3 mr-1" /> Block source
            </Button>
          </>
        )}
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>
    </div>
  );
}
