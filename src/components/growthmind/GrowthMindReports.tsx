import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  Loader2, RefreshCw, FileText, Download,
  ChevronDown, ChevronUp, TrendingUp, Users,
  Megaphone, PhoneCall, Target, Lightbulb,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GrowthMindShell } from "./GrowthMindShell";
import { getGrowthMindData } from "@/lib/growthmind/growthmind.functions";
import { computeGrowthScore } from "@/lib/growthmind/growthmind.score";
import { generateGrowthRecommendations } from "@/lib/growthmind/growthmind.recommendations";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type Section = { id: string; icon: React.ElementType; label: string; content: string[] };

function buildReport(data: any, score: ReturnType<typeof computeGrowthScore>, recs: ReturnType<typeof generateGrowthRecommendations>): Section[] {
  if (!data) return [];
  const { calls, leads, bookings, campaigns, agentPerf, whatsapp, email } = data;
  const now = new Date().toLocaleString();

  return [
    {
      id: "executive", icon: TrendingUp, label: "Executive Summary",
      content: [
        `Report generated: ${now}`,
        `Growth Score: ${score.total}/100 (${score.grade} — ${score.label})`,
        `Marketing issues: ${recs.length} total (${recs.filter(r => r.priority === "critical").length} critical, ${recs.filter(r => r.priority === "high").length} high)`,
        ``,
        `PIPELINE SNAPSHOT`,
        `  Total leads:         ${leads.total}`,
        `  Active leads:        ${leads.active}`,
        `  Need to call:        ${leads.needCall}`,
        `  Stale (14d+):        ${leads.staleCount}`,
        `  Never called:        ${leads.neverCalledCount ?? 0}`,
        `  Converted (sales):   ${leads.sales}`,
        `  Conversion rate:     ${leads.conversionRate}%`,
        ``,
        `MARKETING PERFORMANCE`,
        `  Follow-up coverage:  ${leads.followUpCoverage}%`,
        `  Avg response time:   ${leads.avgResponseHrs !== null ? leads.avgResponseHrs + "h" : "unknown"}`,
        `  Booking rate:        ${bookings.bookingRate}%`,
        `  Total bookings:      ${bookings.total}`,
        `  No-shows:            ${bookings.noShowCount ?? 0}`,
      ],
    },
    {
      id: "pipeline", icon: Target, label: "Pipeline & Leads",
      content: [
        `LEAD ACTIVITY`,
        `  New leads (7d):      ${leads.newLast7}`,
        `  New leads (30d):     ${leads.newLast30}`,
        `  Active:              ${leads.active}`,
        `  Need to call:        ${leads.needCall}`,
        `  Stale (14d+):        ${leads.staleCount}`,
        `  Never called:        ${leads.neverCalledCount ?? 0}`,
        `  Repeat contacts:     ${leads.repeatContacts?.length ?? 0}`,
        `  Stalled pipeline:    ${leads.stalledPipeline?.length ?? 0}`,
        `  Sales closed:        ${leads.sales}`,
        ``,
        `CONVERSION METRICS`,
        `  Conversion rate:     ${leads.conversionRate}%`,
        `  Follow-up coverage:  ${leads.followUpCoverage}%`,
        `  Avg response time:   ${leads.avgResponseHrs !== null ? leads.avgResponseHrs + " hours" : "Not available"}`,
        ``,
        `BOOKINGS`,
        `  Total:               ${bookings.total}`,
        `  Last 7 days:         ${bookings.last7}`,
        `  Agent-booked:        ${bookings.agentBooked}`,
        `  Booking rate:        ${bookings.bookingRate}%`,
        `  No-shows:            ${bookings.noShowCount ?? 0}`,
      ],
    },
    {
      id: "calls", icon: PhoneCall, label: "Call Performance",
      content: [
        `CALL STATS (LAST 30 DAYS)`,
        `  Total calls:         ${calls.total}`,
        `  Successful:          ${calls.success}`,
        `  Success rate:        ${calls.successRate}%`,
        `  Avg duration:        ${calls.avgDuration}s`,
        `  Inbound:             ${calls.inbound}`,
        `  Outbound:            ${calls.outbound}`,
        `  Calls last 7d:       ${calls.last7}`,
        `  Calls today:         ${calls.today}`,
        ``,
        `AGENT PERFORMANCE`,
        ...(agentPerf ?? []).slice(0, 10).flatMap((a: any) => [
          `  ── ${a.name}`,
          `     Calls (30d):    ${a.callCount}`,
          `     Success rate:   ${a.successRate}%`,
          `     Deployed:       ${a.deployed ? "Yes" : "No"}`,
          ``,
        ]),
      ],
    },
    {
      id: "campaigns", icon: Megaphone, label: "Campaign Summary",
      content: [
        `CALL CAMPAIGNS (${campaigns.total} total)`,
        `  Active:              ${campaigns.active}`,
        ``,
        ...(campaigns.stats?.length ? campaigns.stats.flatMap((c: any) => [
          `  ── ${c.name}`,
          `     Status:         ${c.status}`,
          `     Total leads:    ${c.totalLeads}`,
          `     Calls done:     ${c.completedCalls}`,
          `     Completion:     ${c.completionPct}%`,
          ``,
        ]) : ["  No campaigns found."]),
        ``,
        `EMAIL CAMPAIGNS`,
        `  Total:               ${email.total}`,
        `  Active:              ${email.active}`,
        ``,
        `WHATSAPP (30d)`,
        `  Total messages:      ${whatsapp.total}`,
        `  Inbound:             ${whatsapp.inbound}`,
        `  Outbound:            ${whatsapp.outbound}`,
      ],
    },
    {
      id: "score", icon: TrendingUp, label: "Growth Score Breakdown",
      content: [
        `GROWTH SCORE: ${score.total}/100 (${score.grade} — ${score.label})`,
        ``,
        ...score.dimensions.map(d =>
          `  ${d.label.padEnd(24)} ${d.score}/${d.max}  — ${d.note}`
        ),
      ],
    },
    {
      id: "actions", icon: Lightbulb, label: "Recommended Actions",
      content: [
        `GROWTH RECOMMENDATIONS (${recs.length} total)`,
        ``,
        ...recs.map((r, i) => [
          `  ${i + 1}. [${r.priority.toUpperCase()}] ${r.problem}`,
          `     Category:  ${r.category}`,
          `     Impact:    ${r.impact}`,
          `     Fix:       ${r.fix}`,
          ``,
        ]).flat(),
      ],
    },
  ];
}

export function GrowthMindReports() {
  const fn = useServerFn(getGrowthMindData);
  const qc = useQueryClient();
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["growthmind-data"],
    queryFn:  () => fn(),
    staleTime: 60_000,
  });

  const [previewOpen, setPreviewOpen] = useState<Set<string>>(new Set());
  const [generated, setGenerated]     = useState(false);

  const score    = computeGrowthScore(data);
  const recs     = generateGrowthRecommendations(data);
  const sections = buildReport(data, score, recs);

  function toggleSection(id: string) {
    setPreviewOpen(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function handleGenerate() {
    if (!data) return;
    const lines: string[] = [
      "═══════════════════════════════════════════════════════════",
      "                   GROWTHMIND MARKETING REPORT             ",
      "═══════════════════════════════════════════════════════════",
      `Generated: ${new Date().toLocaleString()}`,
      "",
    ];
    for (const s of sections) {
      lines.push(`── ${s.label.toUpperCase()} ──────────────────────────────────────`);
      lines.push(...s.content);
      lines.push("");
    }
    lines.push("═══════════════════════════════════════════════════════════");
    lines.push("              END OF GROWTHMIND REPORT                     ");
    lines.push("═══════════════════════════════════════════════════════════");

    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url;
    a.download = `growthmind-report-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setGenerated(true);
    setPreviewOpen(new Set(sections.map(s => s.id)));
    toast.success("GrowthMind Report downloaded", { description: "Full marketing report saved to your device." });
  }

  const scoreColor = score.total >= 70 ? "text-emerald-400" : score.total >= 40 ? "text-amber-400" : "text-red-400";
  const barColor   = score.total >= 70 ? "bg-emerald-500" : score.total >= 40 ? "bg-amber-500" : "bg-red-500";

  return (
    <GrowthMindShell>
      <div className="px-6 py-5 max-w-4xl">

        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <FileText className="h-5 w-5 text-emerald-400" />
              Marketing Reports
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">Comprehensive marketing performance snapshot</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["growthmind-data"] })}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isFetching && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-24 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
            <span className="text-sm">Gathering marketing data…</span>
          </div>
        ) : (
          <div className="space-y-5">

            <div className="rounded-xl border border-white/[0.06] bg-card/60 p-5 flex items-center gap-6 flex-wrap">
              <div className="text-center">
                <div className={cn("text-5xl font-bold tabular-nums", scoreColor)}>{score.total}</div>
                <div className={cn("text-lg font-bold", scoreColor)}>{score.grade}</div>
                <p className="text-[10px] text-muted-foreground mt-0.5 font-semibold uppercase tracking-[0.1em]">Growth Score</p>
              </div>
              <div className="flex-1 min-w-[200px] space-y-2">
                <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
                  <div className={cn("h-full rounded-full transition-all", barColor)} style={{ width: `${score.total}%` }} />
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>Critical — needs work</span>
                  <span>Excellent growth</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs">
                <span className="text-muted-foreground">Conversion rate</span>
                <span className="font-medium tabular-nums">{data?.leads?.conversionRate ?? 0}%</span>
                <span className="text-muted-foreground">Active leads</span>
                <span className="font-medium tabular-nums">{data?.leads?.active ?? 0}</span>
                <span className="text-muted-foreground">Active campaigns</span>
                <span className="font-medium tabular-nums">{data?.campaigns?.active ?? 0}</span>
                <span className="text-muted-foreground">Open issues</span>
                <span className="font-medium tabular-nums">{recs.length}</span>
              </div>
            </div>

            <div className="rounded-xl border border-white/[0.06] bg-card/60 overflow-hidden">
              <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
                <p className="text-sm font-semibold">Report Contents</p>
                <p className="text-[11px] text-muted-foreground">Click any section to preview</p>
              </div>
              <div className="divide-y divide-white/[0.04]">
                {sections.map(section => {
                  const open = previewOpen.has(section.id);
                  const Icon = section.icon;
                  return (
                    <div key={section.id}>
                      <button
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors text-left"
                        onClick={() => toggleSection(section.id)}
                      >
                        <Icon className="h-4 w-4 text-emerald-400 shrink-0" />
                        <span className="text-sm font-medium flex-1">{section.label}</span>
                        <span className="text-[11px] text-muted-foreground mr-2">{section.content.filter(l => l.trim()).length} lines</span>
                        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                      </button>
                      {open && (
                        <div className="border-t border-white/[0.04] bg-black/20 px-4 py-3">
                          <pre className="text-[11px] text-muted-foreground leading-relaxed font-mono whitespace-pre-wrap">
                            {section.content.join("\n")}
                          </pre>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5">
              <div className="flex items-start gap-4 flex-wrap">
                <div className="flex-1 min-w-[200px]">
                  <h3 className="text-sm font-semibold mb-1">Generate GrowthMind Report</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Download a complete marketing report covering pipeline performance, growth score, campaign activity, and all recommended actions.
                  </p>
                </div>
                <Button
                  size="default"
                  className="gap-2 bg-emerald-600 hover:bg-emerald-500 text-white shrink-0"
                  onClick={handleGenerate}
                  disabled={!data}
                >
                  <Download className="h-4 w-4" />
                  Download Report
                </Button>
              </div>
              {generated && (
                <p className="text-[11px] text-emerald-400 mt-3 flex items-center gap-1.5">
                  <FileText className="h-3 w-3" />
                  Report saved as <code className="bg-emerald-500/10 px-1 rounded">growthmind-report-{new Date().toISOString().slice(0, 10)}.txt</code>
                </p>
              )}
            </div>

          </div>
        )}
      </div>
    </GrowthMindShell>
  );
}
