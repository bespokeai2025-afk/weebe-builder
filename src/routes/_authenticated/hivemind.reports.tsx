import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  Loader2, RefreshCw, FileText, Download, ChevronDown, ChevronUp,
  Building2, BarChart3, Bot, Megaphone, DollarSign, Lightbulb,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { HiveMindShell } from "@/components/hivemind/HiveMindShell";
import { MarketingExecutiveSummary } from "@/components/hivemind/MarketingExecutiveSummary";
import { getHiveMindPlatformData } from "@/lib/hivemind/hivemind.functions";
import { generateRecommendations } from "@/lib/hivemind/recommendations";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/hivemind/reports")({
  head: () => ({ meta: [{ title: "Reports — HiveMind" }] }),
  component: HiveMindReports,
});

type Section = { id: string; icon: React.ElementType; label: string; content: string[] };

function buildReport(data: any, recs: ReturnType<typeof generateRecommendations>): Section[] {
  if (!data) return [];
  const { agents, agentScores, calls, leads, bookings, campaigns, whatsapp, telephony, email, phoneNumbers, costs, systemHealth } = data;
  const now = new Date().toLocaleString();
  const score = computeScore(data, recs);

  return [
    {
      id: "business",
      icon: Building2,
      label: "Business Summary",
      content: [
        `Report generated: ${now}`,
        `Platform health score: ${score}/100`,
        `Active issues: ${recs.length} total (${recs.filter(r => r.priority === "critical").length} critical, ${recs.filter(r => r.priority === "high").length} high)`,
        ``,
        `PIPELINE OVERVIEW`,
        `  Total leads:       ${leads.total}`,
        `  Active leads:      ${leads.active}`,
        `  Need call:         ${leads.needCall}`,
        `  Sales closed:      ${leads.sales}`,
        `  Stale (14d+):      ${leads.stale}`,
        `  Do not call:       ${leads.doNotCall}`,
        ``,
        `BOOKINGS`,
        `  Total bookings:    ${bookings.total}`,
        `  This week:         ${bookings.recent}`,
        `  Agent-booked:      ${bookings.agentBooked}`,
      ],
    },
    {
      id: "platform",
      icon: BarChart3,
      label: "Platform Summary",
      content: [
        `CALL PERFORMANCE (LAST 30 DAYS)`,
        `  Total calls:       ${calls.total}`,
        `  Successful calls:  ${calls.success}`,
        `  Success rate:      ${calls.successRate}%`,
        `  Avg duration:      ${calls.avgDuration}s`,
        `  Inbound:           ${calls.inbound}`,
        `  Outbound:          ${calls.outbound}`,
        ``,
        `CHANNELS`,
        `  WhatsApp messages: ${whatsapp.total} (${whatsapp.inbound} in / ${whatsapp.outbound} out)`,
        `  WhatsApp contacts: ${whatsapp.contacts}`,
        `  Telephony calls:   ${telephony.total} (${telephony.inbound} inbound)`,
        `  Email campaigns:   ${email.total} (${email.active} active)`,
        `  Phone numbers:     ${phoneNumbers?.length ?? 0}`,
        ``,
        `SYSTEM INTEGRATIONS`,
        ...Object.entries(systemHealth).map(([k, v]) => `  ${k.padEnd(20)} ${v ? "✅ Connected" : "❌ Not configured"}`),
      ],
    },
    {
      id: "agents",
      icon: Bot,
      label: "Agent Summary",
      content: [
        `AGENTS (${agents.length} total)`,
        `  Deployed:          ${agentScores?.filter((a: any) => a.deployed).length ?? 0}`,
        `  With phone number: ${agentScores?.filter((a: any) => a.hasPhone).length ?? 0}`,
        `  With knowledge base: ${agentScores?.filter((a: any) => a.hasKB).length ?? 0}`,
        ``,
        ...(agentScores ?? []).flatMap((a: any) => [
          `  ── ${a.name}`,
          `     Health score:  ${a.score}/100`,
          `     Status:        ${a.deployed ? "Deployed" : "Not deployed"}`,
          `     Calls (30d):   ${a.callCount}`,
          `     Success rate:  ${a.callCount > 0 ? a.successRate + "%" : "—"}`,
          `     Phone:         ${a.hasPhone ? a.phone || "Assigned" : "None"}`,
          `     Knowledge base: ${a.hasKB ? "Yes" : "None"}`,
          `     Mode:          ${a.deploymentMode}`,
          ``,
        ]),
      ],
    },
    {
      id: "campaigns",
      icon: Megaphone,
      label: "Campaign Summary",
      content: [
        `CAMPAIGNS (${campaigns.total} total)`,
        `  Active:            ${campaigns.active}`,
        `  Stopped/Paused:    ${campaigns.stopped}`,
        ``,
        ...(campaigns.stats?.length ? campaigns.stats.flatMap((c: any) => [
          `  ── ${c.name}`,
          `     Status:        ${c.status}`,
          `     Leads:         ${c.totalLeads}`,
          `     Calls done:    ${c.completedCalls}`,
          `     Completion:    ${c.completionPct}%`,
          ``,
        ]) : ["  No campaigns found."]),
      ],
    },
    {
      id: "cost",
      icon: DollarSign,
      label: "Cost Summary",
      content: [
        `COST ESTIMATES`,
        `  Retell call cost (est.): $${costs?.retellEst?.toFixed(2) ?? "0.00"}`,
        `  Basis: ${calls.total} calls × ${calls.avgDuration}s avg @ $0.05/min`,
        ``,
        `  Note: Actual costs depend on your Retell plan and usage tier.`,
        `  Visit your Retell dashboard for exact billing figures.`,
      ],
    },
    {
      id: "actions",
      icon: Lightbulb,
      label: "Recommended Actions",
      content: [
        `RECOMMENDATIONS (${recs.length} total)`,
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

function computeScore(data: any, recs: any[]) {
  if (!data) return 0;
  const { systemHealth, agentScores, calls, leads, bookings } = data;
  let s = 0;
  if (systemHealth.agents) s += 15;
  if (systemHealth.retell || systemHealth.elevenlabs) s += 10;
  if (systemHealth.calcom) s += 10;
  if (agentScores?.some((a: any) => a.deployed)) s += 15;
  if (calls.total > 0) s += 10;
  if (calls.successRate > 50) s += 10;
  if (leads.total > 0) s += 5;
  if (bookings.total > 0) s += 10;
  if (!recs.some(r => r.priority === "critical")) s += 10;
  if (!recs.some(r => r.priority === "high")) s += 5;
  return Math.min(s, 100);
}

function HiveMindReports() {
  const fn = useServerFn(getHiveMindPlatformData);
  const qc = useQueryClient();
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["hivemind-data"],
    queryFn: () => fn(),
    staleTime: 60_000,
  });

  const [previewOpen, setPreviewOpen] = useState<Set<string>>(new Set());
  const [generated, setGenerated] = useState(false);

  const recs = generateRecommendations(data);
  const sections = buildReport(data, recs);
  const score = computeScore(data, recs);

  function toggleSection(id: string) {
    setPreviewOpen(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  function handleGenerate() {
    if (!data) return;
    const lines: string[] = [
      "═══════════════════════════════════════════════════════════",
      "                    HIVEMIND PLATFORM REPORT               ",
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
    lines.push("              END OF HIVEMIND REPORT                       ");
    lines.push("═══════════════════════════════════════════════════════════");

    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `hivemind-report-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setGenerated(true);
    setPreviewOpen(new Set(sections.map(s => s.id)));
    toast.success("HiveMind Report downloaded", { description: "Full report saved to your device." });
  }

  const SECTION_ICONS: Record<string, React.ElementType> = {
    business: Building2, platform: BarChart3, agents: Bot,
    campaigns: Megaphone, cost: DollarSign, actions: Lightbulb,
  };

  return (
    <HiveMindShell>
      <div className="px-6 py-5 max-w-4xl">

        {/* Header */}
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">Reports</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Generate a comprehensive snapshot of your entire platform</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["hivemind-data"] })}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isFetching && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-24 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-violet-400" />
            <span className="text-sm">Gathering data…</span>
          </div>
        ) : (
          <div className="space-y-5">

            {/* Score card */}
            <div className="rounded-xl border border-white/[0.06] bg-card/60 p-5 flex items-center gap-6 flex-wrap">
              <div className="text-center">
                <div className={cn(
                  "text-5xl font-bold tabular-nums",
                  score >= 70 ? "text-emerald-400" : score >= 40 ? "text-amber-400" : "text-red-400"
                )}>{score}</div>
                <p className="text-[10px] text-muted-foreground mt-1 font-semibold uppercase tracking-[0.1em]">Platform Score</p>
              </div>
              <div className="flex-1 min-w-[200px] space-y-2">
                <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className={cn("h-full rounded-full transition-all", score >= 70 ? "bg-emerald-500" : score >= 40 ? "bg-amber-500" : "bg-red-500")}
                    style={{ width: `${score}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>Critical — needs work</span>
                  <span>Healthy</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs">
                <span className="text-muted-foreground">Agents deployed</span>
                <span className="font-medium tabular-nums">{data?.agentScores?.filter((a: any) => a.deployed).length ?? 0}/{data?.agents?.length ?? 0}</span>
                <span className="text-muted-foreground">Calls (30d)</span>
                <span className="font-medium tabular-nums">{data?.calls.total ?? 0}</span>
                <span className="text-muted-foreground">Open issues</span>
                <span className="font-medium tabular-nums">{recs.length}</span>
                <span className="text-muted-foreground">Sales closed</span>
                <span className="font-medium tabular-nums">{data?.leads.sales ?? 0}</span>
              </div>
            </div>

            {/* Marketing — CMO advisory */}
            <MarketingExecutiveSummary />

            {/* Report sections preview */}
            <div className="rounded-xl border border-white/[0.06] bg-card/60 overflow-hidden">
              <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
                <p className="text-sm font-semibold">Report Contents</p>
                <p className="text-[11px] text-muted-foreground">Click any section to preview</p>
              </div>
              <div className="divide-y divide-white/[0.04]">
                {sections.map(section => {
                  const open = previewOpen.has(section.id);
                  const Icon = SECTION_ICONS[section.id] ?? FileText;
                  return (
                    <div key={section.id}>
                      <button
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors text-left"
                        onClick={() => toggleSection(section.id)}
                      >
                        <Icon className="h-4 w-4 text-violet-400 shrink-0" />
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

            {/* Generate button */}
            <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-5">
              <div className="flex items-start gap-4 flex-wrap">
                <div className="flex-1 min-w-[200px]">
                  <h3 className="text-sm font-semibold mb-1">Generate HiveMind Report</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Download a complete platform report covering business performance, agent health, campaign activity, cost estimates, and all recommended actions.
                  </p>
                </div>
                <Button
                  size="default"
                  className="gap-2 bg-violet-600 hover:bg-violet-500 text-white shrink-0"
                  onClick={handleGenerate}
                  disabled={!data}
                >
                  <Download className="h-4 w-4" />
                  Download Report
                </Button>
              </div>
              {generated && (
                <p className="text-[11px] text-violet-400 mt-3 flex items-center gap-1.5">
                  <FileText className="h-3 w-3" />
                  Report saved as <code className="bg-violet-500/10 px-1 rounded">hivemind-report-{new Date().toISOString().slice(0, 10)}.txt</code>
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </HiveMindShell>
  );
}
