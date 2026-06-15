import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Loader2, RefreshCw, Megaphone,
  Play, Pause, BarChart3, Mail, MessageSquare, Clapperboard,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { GrowthMindShell } from "./GrowthMindShell";
import { getGrowthMindData } from "@/lib/growthmind/growthmind.functions";
import { Button } from "@/components/ui/button";

function ProgressBar({ pct, color = "emerald" }: { pct: number; color?: string }) {
  return (
    <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
      <div
        className={cn("h-full rounded-full transition-all", `bg-${color}-500`)}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
    </div>
  );
}

export function GrowthMindCampaigns() {
  const fn = useServerFn(getGrowthMindData);
  const qc = useQueryClient();
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["growthmind-data"],
    queryFn:  () => fn(),
    staleTime: 60_000,
  });

  const campaigns = data?.campaigns?.stats ?? [];
  const active    = campaigns.filter((c: any) => c.status === "running" || c.status === "active");
  const stopped   = campaigns.filter((c: any) => c.status !== "running" && c.status !== "active");

  return (
    <GrowthMindShell>
      <div className="px-6 py-5 max-w-4xl">

        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <Megaphone className="h-5 w-5 text-emerald-400" />
              Campaign Performance
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">Marketing campaign analytics across all channels</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["growthmind-data"] })}>
              <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isFetching && "animate-spin")} />
              Refresh
            </Button>
            <Link to="/campaigns">
              <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500 text-white gap-1.5">
                <Megaphone className="h-3.5 w-3.5" />
                Manage Campaigns
              </Button>
            </Link>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-24 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
            <span className="text-sm">Loading campaign data…</span>
          </div>
        ) : (
          <div className="space-y-6">

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Total Campaigns",  value: campaigns.length,        color: "text-foreground" },
                { label: "Active",           value: active.length,           color: "text-emerald-400" },
                { label: "Paused / Stopped", value: stopped.length,          color: "text-amber-400" },
                { label: "Email Campaigns",  value: data?.email?.total ?? 0, color: "text-blue-400" },
              ].map(s => (
                <div key={s.label} className="rounded-xl border border-white/[0.06] bg-card/60 p-4 text-center">
                  <p className={cn("text-2xl font-bold tabular-nums", s.color)}>{s.value}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-white/[0.06] bg-card/60 overflow-hidden">
              <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
                <p className="text-sm font-semibold flex items-center gap-1.5">
                  <BarChart3 className="h-4 w-4 text-emerald-400" />
                  Call Campaigns
                </p>
                <span className="text-[11px] text-muted-foreground">{campaigns.length} total</span>
              </div>

              {campaigns.length === 0 ? (
                <div className="px-4 py-12 flex flex-col items-center gap-3 text-center">
                  <Megaphone className="h-8 w-8 text-muted-foreground/30" />
                  <p className="text-sm font-medium text-muted-foreground">No call campaigns yet</p>
                  <p className="text-xs text-muted-foreground max-w-xs">
                    Create your first campaign to start automating lead outreach at scale.
                  </p>
                  <Link to="/campaigns">
                    <Button size="sm" className="mt-1 bg-emerald-600 hover:bg-emerald-500 text-white">
                      Create Campaign
                    </Button>
                  </Link>
                </div>
              ) : (
                <div className="divide-y divide-white/[0.04]">
                  {campaigns.map((c: any) => {
                    const isActive = c.status === "running" || c.status === "active";
                    return (
                      <div key={c.id} className="px-4 py-4">
                        <div className="flex items-start gap-3 mb-3">
                          <div className={cn(
                            "flex h-7 w-7 items-center justify-center rounded-lg shrink-0",
                            isActive ? "bg-emerald-500/10" : "bg-white/[0.04]",
                          )}>
                            {isActive
                              ? <Play className="h-3.5 w-3.5 text-emerald-400" />
                              : <Pause className="h-3.5 w-3.5 text-muted-foreground" />
                            }
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-semibold">{c.name}</p>
                              <span className={cn(
                                "rounded-full px-2 py-0.5 text-[10px] font-medium capitalize",
                                isActive ? "bg-emerald-500/15 text-emerald-400" : "bg-white/[0.06] text-muted-foreground",
                              )}>
                                {c.status}
                              </span>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-xs font-medium tabular-nums">{c.completionPct}%</p>
                            <p className="text-[10px] text-muted-foreground">complete</p>
                          </div>
                        </div>

                        <ProgressBar pct={c.completionPct} color={isActive ? "emerald" : "slate"} />

                        <div className="flex items-center justify-between mt-2 text-[11px] text-muted-foreground">
                          <span>{c.completedCalls} / {c.totalLeads} calls</span>
                          <span>{c.totalLeads - c.completedCalls} remaining</span>
                        </div>

                        <div className="mt-3 flex justify-end">
                          <button
                            onClick={() => {
                              const p = new URLSearchParams({
                                mode:         "freeform",
                                platform:     "meta",
                                prompt:       `Video ad for campaign: ${c.name}`,
                                campaignId:   c.id,
                                campaignName: c.name,
                              });
                              window.location.assign(`/growthmind/video-studio?${p.toString()}`);
                            }}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-violet-500/10 border border-violet-500/20 px-2.5 py-1 text-[11px] font-medium text-violet-400 hover:bg-violet-500/15 hover:border-violet-500/30 transition-colors"
                          >
                            <Clapperboard className="h-3 w-3" />
                            Generate Video Ad
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-xl border border-white/[0.06] bg-card/60 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Mail className="h-4 w-4 text-blue-400" />
                  <p className="text-sm font-semibold">HexMail Campaigns</p>
                </div>
                {data?.email?.total === 0 ? (
                  <div className="py-4 text-center">
                    <p className="text-xs text-muted-foreground mb-2">No email campaigns</p>
                    <Link to="/hexmail">
                      <Button size="sm" variant="outline" className="text-xs h-7">Open HexMail</Button>
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Total campaigns</span>
                      <span className="font-medium">{data?.email?.total}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Active</span>
                      <span className="font-medium text-emerald-400">{data?.email?.active}</span>
                    </div>
                    <Link to="/hexmail" className="block mt-3">
                      <Button size="sm" variant="outline" className="w-full text-xs h-7">View in HexMail</Button>
                    </Link>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-white/[0.06] bg-card/60 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <MessageSquare className="h-4 w-4 text-emerald-400" />
                  <p className="text-sm font-semibold">WhatsApp Reach</p>
                </div>
                {data?.whatsapp?.total === 0 ? (
                  <div className="py-4 text-center">
                    <p className="text-xs text-muted-foreground mb-2">No WhatsApp activity</p>
                    <Link to="/whatsapp">
                      <Button size="sm" variant="outline" className="text-xs h-7">Set Up Buzzchat</Button>
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Total messages (30d)</span>
                      <span className="font-medium">{data?.whatsapp?.total}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Inbound</span>
                      <span className="font-medium text-emerald-400">{data?.whatsapp?.inbound}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Outbound</span>
                      <span className="font-medium">{data?.whatsapp?.outbound}</span>
                    </div>
                    <Link to="/whatsapp" className="block mt-3">
                      <Button size="sm" variant="outline" className="w-full text-xs h-7">View in Buzzchat</Button>
                    </Link>
                  </div>
                )}
              </div>
            </div>

          </div>
        )}
      </div>
    </GrowthMindShell>
  );
}
