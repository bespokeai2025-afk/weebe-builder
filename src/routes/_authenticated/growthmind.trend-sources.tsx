// GrowthMind → Trend Sources — manage the accounts, topics and exclusions that
// Trend Scout monitors for this workspace.
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Radar, Loader2, Plus, Trash2, Pause, Play, Ban } from "lucide-react";
import { GrowthMindShell } from "@/components/growthmind/GrowthMindShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  SOURCE_KINDS, SOURCE_KIND_META, type SourceKind,
  listMonitoredSources, addMonitoredSource, updateMonitoredSource, removeMonitoredSource,
} from "@/lib/growthmind/growthmind.trend-sources";

export const Route = createFileRoute("/_authenticated/growthmind/trend-sources")({
  component: () => (
    <GrowthMindShell>
      <TrendSourcesPage />
    </GrowthMindShell>
  ),
});

const GROUPS: Array<{ key: "accounts" | "topics" | "exclusions"; title: string; blurb: string }> = [
  { key: "accounts",   title: "Monitored Accounts", blurb: "Competitors, creators and brands whose content Trend Scout watches." },
  { key: "topics",     title: "Topics & Keywords",  blurb: "Subjects, search terms and hashtags to track for momentum." },
  { key: "exclusions", title: "Exclusions",         blurb: "Accounts and topics Trend Scout must never surface or recommend." },
];

const PLATFORM_OPTIONS = ["any", "instagram", "facebook", "youtube", "tiktok", "web"] as const;

function TrendSourcesPage() {
  const listFn   = useServerFn(listMonitoredSources);
  const addFn    = useServerFn(addMonitoredSource);
  const updateFn = useServerFn(updateMonitoredSource);
  const removeFn = useServerFn(removeMonitoredSource);
  const qc = useQueryClient();

  const [kind, setKind]         = useState<SourceKind>("competitor_direct");
  const [platform, setPlatform] = useState<string>("any");
  const [value, setValue]       = useState("");
  const [label, setLabel]       = useState("");
  const [busy, setBusy]         = useState(false);
  const [rowBusy, setRowBusy]   = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["gm-trend-sources"],
    queryFn:  () => listFn(),
    staleTime: 30_000,
    throwOnError: false,
  });
  const sources = data?.sources ?? [];

  async function handleAdd() {
    if (!value.trim()) return;
    setBusy(true);
    try {
      await addFn({ data: {
        sourceKind: kind,
        platform:   platform === "any" ? null : (platform as any),
        value:      value.trim(),
        label:      label.trim() || null,
      }});
      setValue(""); setLabel("");
      await qc.invalidateQueries({ queryKey: ["gm-trend-sources"] });
      toast.success("Source added");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to add source");
    } finally { setBusy(false); }
  }

  async function handleToggle(id: string, status: string) {
    setRowBusy(id);
    try {
      await updateFn({ data: { id, status: status === "active" ? "paused" : "active" } });
      await qc.invalidateQueries({ queryKey: ["gm-trend-sources"] });
    } catch (e: any) { toast.error(e?.message ?? "Update failed"); }
    finally { setRowBusy(null); }
  }

  async function handlePriority(id: string, priority: number) {
    setRowBusy(id);
    try {
      await updateFn({ data: { id, priority } });
      await qc.invalidateQueries({ queryKey: ["gm-trend-sources"] });
    } catch (e: any) { toast.error(e?.message ?? "Update failed"); }
    finally { setRowBusy(null); }
  }

  async function handleRemove(id: string, v: string) {
    if (!window.confirm(`Remove "${v}" from the monitoring list?`)) return;
    setRowBusy(id);
    try {
      await removeFn({ data: { id } });
      await qc.invalidateQueries({ queryKey: ["gm-trend-sources"] });
      toast.success("Source removed");
    } catch (e: any) { toast.error(e?.message ?? "Remove failed"); }
    finally { setRowBusy(null); }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-emerald-500/15 flex items-center justify-center">
          <Radar className="h-5 w-5 text-emerald-400" />
        </div>
        <div>
          <h1 className="text-base font-semibold">Trend Sources</h1>
          <p className="text-xs text-muted-foreground">
            Tell Trend Scout who and what to watch — competitors, creators, topics and hashtags. Discovery runs use these lists.
          </p>
        </div>
      </div>

      {/* Add form */}
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="text-sm font-medium">Add a source</div>
        <div className="grid gap-2 sm:grid-cols-[200px_140px_1fr_180px_auto]">
          <Select value={kind} onValueChange={(v) => setKind(v as SourceKind)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {SOURCE_KINDS.map(k => (
                <SelectItem key={k} value={k}>{SOURCE_KIND_META[k].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={platform} onValueChange={setPlatform}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {PLATFORM_OPTIONS.map(p => <SelectItem key={p} value={p}>{p === "any" ? "Any platform" : p}</SelectItem>)}
            </SelectContent>
          </Select>
          <Input
            placeholder={SOURCE_KIND_META[kind].group === "accounts" ? "@handle, page name or channel URL" : "topic, keyword or #hashtag"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          />
          <Input placeholder="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
          <Button onClick={handleAdd} disabled={busy || !value.trim()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            <span className="ml-1">Add</span>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{SOURCE_KIND_META[kind].hint} Up to {SOURCE_KIND_META[kind].cap} per workspace.</p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading sources…
        </div>
      ) : (
        GROUPS.map(group => {
          const kinds = SOURCE_KINDS.filter(k => SOURCE_KIND_META[k].group === group.key);
          const rows = sources.filter(s => kinds.includes(s.sourceKind));
          return (
            <div key={group.key} className="rounded-xl border bg-card">
              <div className="px-4 py-3 border-b">
                <div className="text-sm font-medium flex items-center gap-2">
                  {group.key === "exclusions" && <Ban className="h-4 w-4 text-red-400" />}
                  {group.title}
                  <Badge variant="secondary" className="text-[10px]">{rows.length}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{group.blurb}</p>
              </div>
              {rows.length === 0 ? (
                <div className="px-4 py-6 text-xs text-muted-foreground">Nothing here yet.</div>
              ) : (
                <div className="divide-y">
                  {rows.map(s => (
                    <div key={s.id} className="px-4 py-2.5 flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm truncate">
                          {s.label ? <>{s.label} <span className="text-muted-foreground">({s.value})</span></> : s.value}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {SOURCE_KIND_META[s.sourceKind]?.label ?? s.sourceKind}
                          {s.platform ? ` · ${s.platform}` : ""}
                        </div>
                      </div>
                      {group.key !== "exclusions" && (
                        <Select value={String(s.priority ?? 0)} onValueChange={(v) => handlePriority(s.id, Number(v))} disabled={rowBusy === s.id}>
                          <SelectTrigger className="h-7 w-[110px] text-xs" title="Priority — higher-priority sources are checked first">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="0">Normal</SelectItem>
                            <SelectItem value="5">High</SelectItem>
                            <SelectItem value="10">Top priority</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                      <Badge variant={s.status === "active" ? "default" : "secondary"} className={cn("text-[10px]", s.status === "active" && "bg-emerald-600")}>
                        {s.status}
                      </Badge>
                      {group.key !== "exclusions" && (
                        <Button variant="ghost" size="icon" className="h-7 w-7" disabled={rowBusy === s.id}
                          onClick={() => handleToggle(s.id, s.status)}
                          title={s.status === "active" ? "Pause" : "Resume"}>
                          {s.status === "active" ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-red-400" disabled={rowBusy === s.id}
                        onClick={() => handleRemove(s.id, s.value)} title="Remove">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
