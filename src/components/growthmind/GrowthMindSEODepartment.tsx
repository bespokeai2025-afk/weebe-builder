import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Loader2, RefreshCw, Plus, Trash2, CheckCircle2, AlertTriangle, Globe,
  Search, FileText, Rocket, GraduationCap, ShieldCheck, ExternalLink, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GrowthMindShell } from "./GrowthMindShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  getSeoDepartmentOverview,
  triggerGscSyncNow,
  inspectPriorityUrl,
  getSeoIntelligence,
  getSeoOpportunities,
  listSeoTeachings,
  saveSeoTeaching,
  deleteSeoTeaching,
  listSeoCampaigns,
  createSeoCampaign,
  approveSeoCampaignStage,
  markSeoPackageDeployed,
  cancelSeoCampaign,
  getSeoCampaignDetail,
  listSeoOpportunityQueue,
  refreshSeoOpportunityQueueNow,
  executeSeoOpportunity,
  dismissSeoOpportunity,
} from "@/lib/growthmind/growthmind.seo-department";

const TABS = ["Overview", "Queue", "Intelligence", "Campaigns", "Teachings"] as const;
type Tab = (typeof TABS)[number];

const STATUS_LABELS: Record<string, string> = {
  proposed: "Proposed",
  awaiting_strategy_approval: "Awaiting strategy approval",
  executing_analysis: "Analysing",
  awaiting_brief_approval: "Awaiting brief approval",
  drafting: "Drafting article",
  awaiting_content_approval: "Awaiting content approval",
  awaiting_deployment_approval: "Awaiting deployment approval",
  awaiting_website_deployment: "Awaiting manual website deployment",
  monitoring: "Live — monitoring",
  blocked: "Blocked",
  failed: "Failed",
  cancelled: "Cancelled",
  completed: "Completed",
};

const NEXT_STAGE: Record<string, "strategy" | "brief" | "content" | "deployment" | null> = {
  awaiting_strategy_approval: "strategy",
  awaiting_brief_approval: "brief",
  awaiting_content_approval: "content",
  awaiting_deployment_approval: "deployment",
};

function Pill({ ok, warn, children }: { ok?: boolean; warn?: boolean; children: React.ReactNode }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
      ok ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
        : warn ? "border-amber-500/25 bg-amber-500/10 text-amber-400"
        : "border-slate-500/25 bg-slate-500/10 text-slate-400",
    )}>
      {children}
    </span>
  );
}

function Card({ title, icon: Icon, children, action }: { title: string; icon: React.ElementType; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold"><Icon className="h-4 w-4 text-primary" />{title}</div>
        {action}
      </div>
      {children}
    </div>
  );
}

// ── Overview tab ─────────────────────────────────────────────────────────────

function OverviewTab() {
  const qc = useQueryClient();
  const overviewFn = useServerFn(getSeoDepartmentOverview);
  const syncFn = useServerFn(triggerGscSyncNow);
  const inspectFn = useServerFn(inspectPriorityUrl);
  const [syncing, setSyncing] = useState(false);
  const [inspectUrl, setInspectUrl] = useState("");
  const [inspecting, setInspecting] = useState(false);
  const [inspectResult, setInspectResult] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["seo-dept-overview"],
    queryFn: () => overviewFn(),
    throwOnError: false,
  });

  if (isLoading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!data) return <p className="text-sm text-muted-foreground">Could not load the SEO department overview.</p>;

  const conn = data.connection;
  const sync = data.sync;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Search Console connection" icon={Globe}>
        <div className="space-y-2 text-sm">
          <div className="flex flex-wrap gap-2">
            <Pill ok={conn.connected} warn={!conn.connected}>{conn.connected ? "Connected" : "Not connected"}</Pill>
            {conn.propertyUrl && <Pill ok>{conn.propertyType}</Pill>}
            <Pill ok={conn.tokenHealthy} warn={!conn.tokenHealthy}>{conn.tokenHealthy ? "Token healthy" : "Token needs re-auth"}</Pill>
            {conn.refreshTokenAvailable && <Pill ok>Auto-refresh enabled</Pill>}
          </div>
          {conn.propertyUrl && <p className="font-mono text-xs text-muted-foreground">{conn.propertyUrl}</p>}
          {data.currentBlocker && (
            <p className="flex items-start gap-1.5 rounded-lg border border-amber-500/25 bg-amber-500/10 p-2 text-xs text-amber-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{data.currentBlocker}
            </p>
          )}
          <p className="text-xs text-muted-foreground">Website hosting: {data.website.host}. {data.website.deploymentCapability}</p>
        </div>
      </Card>

      <Card
        title="Data sync"
        icon={RefreshCw}
        action={
          <Button size="sm" variant="outline" disabled={syncing} onClick={async () => {
            setSyncing(true);
            try { await syncFn(); await qc.invalidateQueries({ queryKey: ["seo-dept-overview"] }); } finally { setSyncing(false); }
          }}>
            {syncing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}Sync now
          </Button>
        }
      >
        {sync ? (
          <div className="space-y-2 text-sm">
            <div className="flex flex-wrap gap-2">
              <Pill ok={sync.status === "completed"} warn={sync.status !== "completed"}>
                {sync.status === "baseline_pending" ? "Baseline pending" : sync.status}
              </Pill>
              <Pill>{sync.sync_kind} sync</Pill>
              <Pill ok={sync.rows_imported > 0} warn={sync.rows_imported === 0}>{sync.rows_imported.toLocaleString()} rows</Pill>
            </div>
            <p className="text-xs text-muted-foreground">
              Window {sync.requested_start_date} → {sync.requested_end_date}.
              Last synced {sync.last_synced_at ? new Date(sync.last_synced_at).toLocaleString() : "never"}.
              Next sync {sync.next_sync_at ? new Date(sync.next_sync_at).toLocaleString() : "—"}.
            </p>
            <p className="text-xs text-muted-foreground">{data.dataProcessing.note}</p>
            {(sync.warnings ?? []).map((w: string, i: number) => (
              <p key={i} className="text-xs text-amber-400/80">• {w}</p>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{data.dataProcessing.note}</p>
        )}
      </Card>

      <Card title="Sitemaps" icon={FileText}>
        {data.sitemaps.count === 0 ? (
          <p className="text-sm text-muted-foreground">No sitemaps submitted to Search Console yet. GrowthMind can prepare a sitemap submission — it always needs your approval first.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {data.sitemaps.items.map((s: any) => (
              <li key={s.path} className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-xs">{s.path}</span>
                <Pill ok={Number(s.errors) === 0} warn={Number(s.errors) > 0}>{Number(s.errors)} errors</Pill>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="URL Inspection" icon={Search}>
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input placeholder="https://www.example.com/page" value={inspectUrl} onChange={(e) => setInspectUrl(e.target.value)} className="h-8 text-xs" />
            <Button size="sm" disabled={inspecting || !inspectUrl.startsWith("http")} onClick={async () => {
              setInspecting(true); setInspectResult(null);
              try {
                const r = await inspectFn({ data: { url: inspectUrl } });
                setInspectResult(r.ok ? `${r.verdict ?? "UNKNOWN"} — ${r.coverageState ?? "no coverage state"}` : `Failed: ${r.error}`);
                qc.invalidateQueries({ queryKey: ["seo-dept-overview"] });
              } finally { setInspecting(false); }
            }}>
              {inspecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Inspect"}
            </Button>
          </div>
          {inspectResult && <p className="text-xs text-muted-foreground">{inspectResult}</p>}
          {data.urlInspection.recent.length > 0 && (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {data.urlInspection.recent.slice(0, 6).map((i: any) => (
                <li key={i.url} className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono">{i.url}</span>
                  <Pill ok={i.verdict === "PASS"} warn={i.verdict !== "PASS"}>{i.verdict ?? "?"}</Pill>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}

// ── Intelligence tab ─────────────────────────────────────────────────────────

function IntelligenceTab() {
  const intelFn = useServerFn(getSeoIntelligence);
  const oppsFn = useServerFn(getSeoOpportunities);
  const [dimension, setDimension] = useState<"query" | "page" | "country" | "device">("query");

  const { data: intel, isLoading } = useQuery({
    queryKey: ["seo-intel", dimension],
    queryFn: () => intelFn({ data: { dimension, days: 90, limit: 50 } }),
    throwOnError: false,
  });
  const { data: opps } = useQuery({
    queryKey: ["seo-opps"],
    queryFn: () => oppsFn({ data: { kinds: [] } }),
    throwOnError: false,
  });

  return (
    <div className="space-y-4">
      {intel?.limitations?.length ? (
        <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-400">
          {intel.limitations.map((l: string, i: number) => <p key={i}>• {l}</p>)}
        </div>
      ) : null}

      <Card title="Search performance" icon={Search} action={
        <div className="flex gap-1">
          {(["query", "page", "country", "device"] as const).map((d) => (
            <button key={d} onClick={() => setDimension(d)}
              className={cn("rounded-md px-2 py-1 text-xs capitalize", dimension === d ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}>
              {d}
            </button>
          ))}
        </div>
      }>
        {isLoading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> :
          !intel || intel.deliverables.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No {dimension} data yet ({intel?.recordsAnalysed ?? 0} rows analysed). Data appears here as soon as Google publishes performance rows for the property.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-muted-foreground">
                  <th className="pb-2 pr-3">{dimension}</th><th className="pb-2 pr-3">Clicks</th><th className="pb-2 pr-3">Impressions</th><th className="pb-2 pr-3">CTR</th><th className="pb-2 pr-3">Position</th><th className="pb-2">Trend</th>
                </tr></thead>
                <tbody>
                  {intel.deliverables.items.slice(0, 30).map((r: any) => (
                    <tr key={r.key} className="border-t border-border/50">
                      <td className="max-w-[280px] truncate py-1.5 pr-3">{r.key}</td>
                      <td className="py-1.5 pr-3">{r.clicks}</td>
                      <td className="py-1.5 pr-3">{r.impressions}</td>
                      <td className="py-1.5 pr-3">{(r.ctr * 100).toFixed(1)}%</td>
                      <td className="py-1.5 pr-3">{r.position != null ? r.position.toFixed(1) : "—"}</td>
                      <td className="py-1.5"><Pill ok={r.trend === "growing"} warn={r.trend === "declining"}>{r.trend.replace("_", " ")}</Pill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Card>

      <Card title="Opportunities" icon={Rocket}>
        {!opps || opps.deliverables.opportunities.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No opportunities detected yet ({opps?.recordsAnalysed ?? 0} rows analysed). Opportunity detection activates once performance data arrives.
          </p>
        ) : (
          <ul className="space-y-2">
            {opps.deliverables.opportunities.slice(0, 20).map((o: any, i: number) => (
              <li key={i} className="rounded-lg border border-border/60 p-2.5 text-xs">
                <div className="mb-1 flex items-center gap-2">
                  <Pill ok>{o.kind.replace(/_/g, " ")}</Pill>
                  <span className="truncate font-medium">{o.key}</span>
                </div>
                <p className="text-muted-foreground">{o.rationale} → {o.recommendedAction}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// ── Campaigns tab ────────────────────────────────────────────────────────────

function CampaignsTab() {
  const qc = useQueryClient();
  const listFn = useServerFn(listSeoCampaigns);
  const createFn = useServerFn(createSeoCampaign);
  const approveFn = useServerFn(approveSeoCampaignStage);
  const cancelFn = useServerFn(cancelSeoCampaign);
  const detailFn = useServerFn(getSeoCampaignDetail);
  const deployedFn = useServerFn(markSeoPackageDeployed);

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [objective, setObjective] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [liveUrl, setLiveUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["seo-campaigns"],
    queryFn: () => listFn(),
    throwOnError: false,
  });
  const { data: detail } = useQuery({
    queryKey: ["seo-campaign-detail", expanded],
    queryFn: () => detailFn({ data: { campaignId: expanded! } }),
    enabled: !!expanded,
    throwOnError: false,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["seo-campaigns"] });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Every campaign pauses for your approval at each stage: strategy → brief → article → deployment package. Nothing is published automatically — deployment is a manual Lovable handoff.
        </p>
        <Button size="sm" onClick={() => setShowCreate((v) => !v)}><Plus className="mr-1.5 h-3.5 w-3.5" />New campaign</Button>
      </div>

      {error && <p className="rounded-lg border border-red-500/25 bg-red-500/10 p-2 text-xs text-red-400">{error}</p>}

      {showCreate && (
        <Card title="Propose a blog campaign" icon={Rocket}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label className="text-xs">Campaign name</Label><Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1 h-8 text-sm" placeholder="AI receptionists for dental clinics" /></div>
            <div><Label className="text-xs">Primary topic</Label><Input value={topic} onChange={(e) => setTopic(e.target.value)} className="mt-1 h-8 text-sm" placeholder="AI receptionist dental practice" /></div>
            <div className="sm:col-span-2"><Label className="text-xs">Objective (optional)</Label><Textarea value={objective} onChange={(e) => setObjective(e.target.value)} className="mt-1 text-sm" rows={2} placeholder="What should this campaign achieve commercially?" /></div>
          </div>
          <Button size="sm" className="mt-3" disabled={name.length < 3 || busy === "create"} onClick={async () => {
            setBusy("create"); setError(null);
            try {
              const r = await createFn({ data: { name, campaignType: "blog", primaryTopic: topic || undefined, objective: objective || undefined } });
              if (!r.ok) setError(r.error ?? "Failed");
              else { setShowCreate(false); setName(""); setTopic(""); setObjective(""); refresh(); }
            } finally { setBusy(null); }
          }}>
            {busy === "create" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}Propose campaign
          </Button>
        </Card>
      )}

      {isLoading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> :
        (data?.campaigns ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No SEO campaigns yet. Propose one above, or ask GrowthMind in chat.</p>
        ) : (
          <div className="space-y-2">
            {(data?.campaigns ?? []).map((c: any) => {
              const stage = NEXT_STAGE[c.status] ?? null;
              return (
                <div key={c.id} className="rounded-xl border border-border bg-card p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button className="text-left" onClick={() => setExpanded(expanded === c.id ? null : c.id)}>
                      <p className="text-sm font-medium">{c.name}</p>
                      <p className="text-xs text-muted-foreground">{c.campaign_type} · {c.primary_topic ?? "no topic"}{c.proposed_url ? ` · ${c.proposed_url}` : ""}</p>
                    </button>
                    <div className="flex items-center gap-2">
                      <Pill ok={c.status === "monitoring" || c.status === "completed"} warn={c.status === "blocked" || c.status === "failed"}>
                        {STATUS_LABELS[c.status] ?? c.status}
                      </Pill>
                      {stage && (
                        <Button size="sm" variant="outline" disabled={busy === c.id} onClick={async () => {
                          setBusy(c.id); setError(null);
                          try {
                            const r = await approveFn({ data: { campaignId: c.id, stage } });
                            if (!r.ok) setError(r.error ?? "Approval failed");
                            refresh();
                          } finally { setBusy(null); }
                        }}>
                          {busy === c.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}
                          Approve {stage}
                        </Button>
                      )}
                      {!["cancelled", "completed", "monitoring"].includes(c.status) && (
                        <Button size="sm" variant="ghost" onClick={async () => { await cancelFn({ data: { campaignId: c.id } }); refresh(); }}>
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {c.blocked_reason && <p className="mt-1.5 text-xs text-amber-400">Blocked: {c.blocked_reason}</p>}

                  {expanded === c.id && detail?.campaign && (
                    <div className="mt-3 space-y-2 border-t border-border/60 pt-3 text-xs">
                      {detail.campaign.page_decision && (
                        <p><span className="font-medium">Page decision:</span> {detail.campaign.page_decision} — {detail.campaign.page_decision_reason}</p>
                      )}
                      {(detail.campaign.data_limitations ?? []).map((l: string, i: number) => (
                        <p key={i} className="text-amber-400/80">• {l}</p>
                      ))}
                      {detail.campaign.brief && (
                        <div className="rounded-lg bg-muted/40 p-2">
                          <p className="font-medium">Brief: {detail.campaign.proposed_title}</p>
                          <p className="text-muted-foreground">Meta: {detail.campaign.meta_title} — {detail.campaign.meta_description}</p>
                          {(detail.campaign.outline ?? []).map((o: any, i: number) => <p key={i} className="text-muted-foreground">§ {o.heading}</p>)}
                        </div>
                      )}
                      {detail.campaign.safety_results && (
                        <p className="flex items-center gap-1.5">
                          <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                          Safety gate: {detail.campaign.safety_results.passed ? "passed" : "FAILED"} ({detail.campaign.safety_results.checks?.length ?? 0} checks)
                        </p>
                      )}
                      {detail.deploymentPackage && (
                        <div className="rounded-lg bg-muted/40 p-2">
                          <p className="font-medium">Deployment package ({detail.deploymentPackage.status}) — {detail.deploymentPackage.page_mode} at {detail.deploymentPackage.proposed_route}</p>
                          <pre className="mt-1 whitespace-pre-wrap text-[11px] text-muted-foreground">{detail.deploymentPackage.manual_instructions}</pre>
                          {detail.deploymentPackage.status === "awaiting_website_deployment" && (
                            <div className="mt-2 flex gap-2">
                              <Input placeholder="Live URL after deploying in Lovable" value={liveUrl} onChange={(e) => setLiveUrl(e.target.value)} className="h-8 text-xs" />
                              <Button size="sm" disabled={!liveUrl.startsWith("http") || busy === "deploy"} onClick={async () => {
                                setBusy("deploy"); setError(null);
                                try {
                                  const r = await deployedFn({ data: { packageId: detail.deploymentPackage.id, liveUrl } });
                                  if (!r.ok) setError(r.error ?? "Failed");
                                  refresh(); qc.invalidateQueries({ queryKey: ["seo-campaign-detail", c.id] });
                                } finally { setBusy(null); }
                              }}>Mark deployed</Button>
                            </div>
                          )}
                          {detail.deploymentPackage.live_url && (
                            <a href={detail.deploymentPackage.live_url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-primary">
                              <ExternalLink className="h-3 w-3" />{detail.deploymentPackage.live_url}
                            </a>
                          )}
                        </div>
                      )}
                      {detail.campaign.monitoring && (
                        <p className="flex items-center gap-1.5 text-muted-foreground">
                          <Clock className="h-3.5 w-3.5" />{detail.campaign.monitoring.note}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}

// ── Teachings tab ────────────────────────────────────────────────────────────

const TEACHING_TYPES = [
  "priority_product","priority_service","target_industry","target_country","target_language",
  "customer_problem","customer_question","sales_objection","search_topic","topic_to_avoid",
  "competitor","restricted_claim","preferred_cta","publishing_limit","approval_requirement",
  "commercial_objective","temporary_instruction","experiment",
] as const;

function TeachingsTab() {
  const qc = useQueryClient();
  const listFn = useServerFn(listSeoTeachings);
  const saveFn = useServerFn(saveSeoTeaching);
  const deleteFn = useServerFn(deleteSeoTeaching);
  const [type, setType] = useState<(typeof TEACHING_TYPES)[number]>("priority_service");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["seo-teachings"],
    queryFn: () => listFn(),
    throwOnError: false,
  });

  return (
    <div className="space-y-4">
      <Card title="Teach GrowthMind SEO" icon={GraduationCap}>
        <p className="mb-3 text-xs text-muted-foreground">
          Teachings steer every future campaign: priority products, target industries, restricted claims, topics to avoid, publishing limits and more. Restricted claims and avoided topics are enforced by the safety gate.
        </p>
        <div className="flex flex-wrap gap-2">
          <select value={type} onChange={(e) => setType(e.target.value as any)} className="h-8 rounded-md border border-border bg-background px-2 text-xs">
            {TEACHING_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
          </select>
          <Input value={content} onChange={(e) => setContent(e.target.value)} placeholder="e.g. Never claim guaranteed rankings" className="h-8 flex-1 text-xs" />
          <Button size="sm" disabled={content.length < 2 || saving} onClick={async () => {
            setSaving(true);
            try { await saveFn({ data: { teachingType: type, content } }); setContent(""); qc.invalidateQueries({ queryKey: ["seo-teachings"] }); }
            finally { setSaving(false); }
          }}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Teach"}
          </Button>
        </div>
      </Card>

      {isLoading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : (
        <div className="space-y-1.5">
          {(data?.teachings ?? []).map((t: any) => (
            <div key={t.id} className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-card px-3 py-2 text-xs">
              <div className="flex min-w-0 items-center gap-2">
                <Pill ok={t.status === "active"} warn={t.status !== "active"}>{t.teaching_type.replace(/_/g, " ")}</Pill>
                <span className="truncate">{t.content}</span>
              </div>
              <button onClick={async () => { await deleteFn({ data: { id: t.id } }); qc.invalidateQueries({ queryKey: ["seo-teachings"] }); }}>
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-red-400" />
              </button>
            </div>
          ))}
          {(data?.teachings ?? []).length === 0 && <p className="text-sm text-muted-foreground">No teachings yet.</p>}
        </div>
      )}
    </div>
  );
}

// ── Queue tab ────────────────────────────────────────────────────────────────

const KIND_LABELS: Record<string, string> = {
  high_impression_low_ctr: "High impressions, low clicks",
  title_meta_weak: "Weak title/meta",
  near_page_one: "Near page one",
  declining_query: "Declining query",
  declining_page: "Declining page",
  missing_content: "Missing content",
  keyword_cannibalisation: "Keyword cannibalisation",
  indexing_issue: "Indexing issue",
  sitemap_missing: "Sitemap missing",
  thin_or_outdated: "Thin / outdated content",
};

const EXECUTION_LABELS: Record<string, string> = {
  create_article: "Write a new article (approval-first campaign)",
  refresh_content: "Refresh existing content (approval-first campaign)",
  faq_section: "Add an FAQ section (approval-first campaign)",
  metadata_change: "Title/meta rework (approval-first campaign)",
  page_change: "Page change (website handoff package)",
  internal_links: "Internal links (approval-first campaign)",
  sitemap_submit: "Submit sitemap to Search Console",
};

const OPP_STATUS_LABELS: Record<string, string> = {
  open: "Open",
  executing: "Awaiting approval / executing",
  handled: "Handled",
};

function QueueTab() {
  const qc = useQueryClient();
  const listFn = useServerFn(listSeoOpportunityQueue);
  const refreshFn = useServerFn(refreshSeoOpportunityQueueNow);
  const executeFn = useServerFn(executeSeoOpportunity);
  const dismissFn = useServerFn(dismissSeoOpportunity);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["seo-opportunity-queue"],
    queryFn: () => listFn(),
    throwOnError: false,
  });
  const opps = data?.opportunities ?? [];
  const refresh = () => qc.invalidateQueries({ queryKey: ["seo-opportunity-queue"] });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Ranked opportunities detected from your Search Console data (score = business value × ranking opportunity × confidence ÷ effort).
          Executing an item routes it through approval — nothing changes without your sign-off, and website changes are handed off as packages (WEBEE never edits your site directly).
        </p>
        <Button size="sm" variant="outline" disabled={busy === "refresh"} onClick={async () => {
          setBusy("refresh"); setError(null); setNotice(null);
          try {
            const r = await refreshFn();
            if (!r.ok) setError(r.error ?? "Refresh failed");
            else setNotice(`Refreshed: ${r.detected} detected, ${r.inserted} new, ${r.updated} updated, ${r.expired} expired.`);
            refresh();
          } finally { setBusy(null); }
        }}>
          {busy === "refresh" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
          Refresh queue
        </Button>
      </div>

      {error && <p className="rounded-lg border border-red-500/25 bg-red-500/10 p-2 text-xs text-red-400">{error}</p>}
      {notice && <p className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 p-2 text-xs text-emerald-400">{notice}</p>}

      {isLoading && <p className="text-sm text-muted-foreground"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />Loading queue…</p>}
      {!isLoading && opps.length === 0 && (
        <p className="text-sm text-muted-foreground">No opportunities in the queue yet. The queue fills automatically after each Search Console sync — or press Refresh queue.</p>
      )}

      <div className="space-y-2">
        {opps.map((o: any) => (
          <div key={o.id} className="rounded-lg border border-border bg-card p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">{Number(o.score).toFixed(1)}</span>
              <span className="text-sm font-medium">{o.title}</span>
              <Pill warn={o.status !== "open"}>{OPP_STATUS_LABELS[o.status] ?? o.status}</Pill>
              <span className="text-[11px] text-muted-foreground">{KIND_LABELS[o.kind] ?? o.kind}</span>
              <div className="ml-auto flex items-center gap-1.5">
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setExpanded(expanded === o.id ? null : o.id)}>
                  {expanded === o.id ? "Hide" : "Details"}
                </Button>
                {o.status === "open" && (
                  <>
                    <Button size="sm" className="h-7 px-2 text-xs" disabled={busy === o.id} onClick={async () => {
                      setBusy(o.id); setError(null); setNotice(null);
                      try {
                        const r = await executeFn({ data: { opportunityId: o.id } });
                        if (!r.ok) setError(r.detail ?? r.error ?? "Failed");
                        else setNotice(r.outcome === "awaiting_approval" ? "Queued for your approval in the Action Centre." : (r.detail ?? "Submitted."));
                        refresh();
                      } catch (e: any) { setError(e?.message ?? "Failed"); }
                      finally { setBusy(null); }
                    }}>
                      {busy === o.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}Execute
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busy === o.id} onClick={async () => {
                      setBusy(o.id);
                      try { await dismissFn({ data: { opportunityId: o.id } }); refresh(); }
                      catch (e: any) { setError(e?.message ?? "Failed"); }
                      finally { setBusy(null); }
                    }}>Dismiss</Button>
                  </>
                )}
              </div>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{o.rationale}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Recommended: {EXECUTION_LABELS[o.recommended_execution] ?? o.recommended_execution}</p>
            {expanded === o.id && (
              <div className="mt-2 grid gap-2 rounded-md border border-border/60 bg-background/50 p-2 text-[11px] text-muted-foreground sm:grid-cols-2">
                <div>
                  <p className="font-medium text-foreground">Score breakdown</p>
                  <p>Business value: {Number(o.business_value).toFixed(2)} · Ranking opportunity: {Number(o.ranking_opportunity).toFixed(2)}</p>
                  <p>Confidence: {Number(o.confidence).toFixed(2)} · Effort: {Number(o.effort).toFixed(1)}</p>
                  <p className="mt-1 font-medium text-foreground">Target</p>
                  <p className="break-all">{o.dim_key}</p>
                </div>
                <div>
                  <p className="font-medium text-foreground">Evidence (from Search Console)</p>
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(o.evidence, null, 1)}</pre>
                  <p className="mt-1">Last detected: {o.last_detected_at ? new Date(o.last_detected_at).toLocaleString() : "—"}</p>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function GrowthMindSEODepartment() {
  const [tab, setTab] = useState<Tab>("Overview");
  return (
    <GrowthMindShell>
      <div className="space-y-4 p-4 lg:p-6">
        <div>
          <h1 className="text-lg font-semibold">SEO Department</h1>
          <p className="text-sm text-muted-foreground">
            Evidence-driven SEO run by GrowthMind on real Search Console data — with your approval at every consequential step.
          </p>
        </div>
        <div className="flex gap-1 border-b border-border">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={cn("border-b-2 px-3 py-2 text-sm", tab === t ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
              {t}
            </button>
          ))}
        </div>
        {tab === "Overview" && <OverviewTab />}
        {tab === "Queue" && <QueueTab />}
        {tab === "Intelligence" && <IntelligenceTab />}
        {tab === "Campaigns" && <CampaignsTab />}
        {tab === "Teachings" && <TeachingsTab />}
      </div>
    </GrowthMindShell>
  );
}
