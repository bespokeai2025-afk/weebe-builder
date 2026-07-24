// GrowthMind → Content Anatomy — multimodal deep analysis of ONE trend item
// plus original adaptation briefs (mechanism transfer, never copies).
import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Microscope, Loader2, Sparkles, ArrowLeft, ExternalLink, ShieldAlert,
  CheckCircle2, XCircle, Film, FileText, Wand2, Clapperboard,
} from "lucide-react";
import { GrowthMindShell } from "@/components/growthmind/GrowthMindShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  getContentAnatomyBundle, runDeepVideoAnalysis, generateTrendAdaptation,
  type AdaptationRecord,
} from "@/lib/growthmind/growthmind.anatomy";
import { createProjectFromRecommendation } from "@/lib/growthmind/growthmind.content-projects";

export const Route = createFileRoute("/_authenticated/growthmind/anatomy/$itemId")({
  validateSearch: (s: Record<string, unknown>) => ({ run: s.run === true || s.run === "true" ? true : undefined }),
  component: () => (
    <GrowthMindShell>
      <AnatomyPage />
    </GrowthMindShell>
  ),
});

const MODE_LABEL: Record<string, string> = {
  video_url:     "Full video analysed (URL)",
  video_inline:  "Full video analysed (uploaded)",
  metadata_only: "Metadata-only (video not accessible)",
};

function AnatomyPage() {
  const { itemId } = useParams({ from: "/_authenticated/growthmind/anatomy/$itemId" });
  const { run: autoRun } = Route.useSearch();
  const qc = useQueryClient();
  const bundleFn  = useServerFn(getContentAnatomyBundle);
  const analyseFn = useServerFn(runDeepVideoAnalysis);
  const adaptFn   = useServerFn(generateTrendAdaptation);
  const [analysing, setAnalysing] = useState(false);
  const [adapting, setAdapting]   = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["gm-anatomy", itemId],
    queryFn: () => bundleFn({ data: { itemId } }),
    throwOnError: false,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["gm-anatomy", itemId] });

  // "Analyse deeply" from the Trend Feed auto-runs the multimodal analysis once
  // (only when no anatomy exists yet).
  const autoRanRef = useRef(false);
  useEffect(() => {
    if (!autoRun || autoRanRef.current || isLoading || !data) return;
    if (data.anatomy || data.budget.usedToday >= data.budget.dailyLimit) return;
    autoRanRef.current = true;
    void runAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun, isLoading, data]);

  const runAnalysis = async () => {
    setAnalysing(true);
    try {
      const r = await analyseFn({ data: { itemId } });
      toast.success(`Deep analysis complete (${MODE_LABEL[r.analysisMode] ?? r.analysisMode}) — est. $${r.costUsd.toFixed(4)}`);
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Deep analysis failed");
    } finally { setAnalysing(false); }
  };

  const runAdaptation = async () => {
    setAdapting(true);
    try {
      const r = await adaptFn({ data: { itemId } });
      if (r.blocked) toast.error(`Adaptation blocked: ${r.blockedReasons.join(" ")}`);
      else toast.success(`Original adaptation brief created (similarity ${Math.round(r.similarity * 100)}%)`);
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Adaptation failed");
    } finally { setAdapting(false); }
  };

  if (isLoading) return <div className="p-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (error || !data) return (
    <div className="p-8 space-y-3">
      <p className="text-sm text-red-400">{(error as any)?.message ?? "Item not found."}</p>
      <Button variant="outline" size="sm" asChild><Link to="/growthmind/trend-feed"><ArrowLeft className="h-3 w-3 mr-1" /> Back to Trend Feed</Link></Button>
    </div>
  );

  const { item, anatomy, adaptations, budget } = data;
  const a: any = anatomy?.anatomy ?? {};
  const capReached = budget.usedToday >= budget.dailyLimit;

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-4xl">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="sm" className="h-7 text-xs" asChild>
          <Link to="/growthmind/trend-feed"><ArrowLeft className="h-3 w-3 mr-1" /> Trend Feed</Link>
        </Button>
        <h1 className="text-lg font-semibold flex items-center gap-2"><Microscope className="h-5 w-5 text-emerald-400" /> Content Anatomy</h1>
        <span className="text-[11px] text-muted-foreground ml-auto">
          Deep analyses today: {budget.usedToday}/{budget.dailyLimit}
        </span>
      </div>

      {/* Source item */}
      <div className="rounded-xl border bg-card p-4 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="secondary" className="text-[10px]">{item.platform}</Badge>
          {item.mediaType && <Badge variant="outline" className="text-[10px]">{item.mediaType}</Badge>}
          <Badge variant="secondary" className="text-[10px]">{item.status}</Badge>
        </div>
        <div className="text-sm font-medium">{item.title ?? item.caption?.slice(0, 140) ?? "(untitled)"}</div>
        <div className="text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap">
          {(item.authorHandle || item.authorName) && <span>by {item.authorHandle ?? item.authorName}</span>}
          {item.url && (
            <a href={item.url} target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline inline-flex items-center gap-0.5">
              view source <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>

      {/* Analysis */}
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-sm font-semibold flex items-center gap-2"><Film className="h-4 w-4" /> Deep video analysis</h2>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" className="h-7 text-xs" onClick={runAnalysis}
              disabled={analysing || (capReached && !anatomy)}>
              {analysing ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}
              {anatomy ? "Re-analyse" : "Run deep analysis"}
            </Button>
          </div>
        </div>
        {capReached && !anatomy && (
          <p className="text-xs text-amber-400/80">Daily deep-analysis limit reached ({budget.dailyLimit}/day).</p>
        )}
        {!anatomy && !capReached && (
          <p className="text-xs text-muted-foreground">
            Watches and deconstructs the video with multimodal AI: hook, structure, pacing, emotional driver,
            why it works, and how it could be adapted originally for your business.
          </p>
        )}
        {anatomy && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
              <Badge variant={anatomy.status === "completed" ? "default" : "secondary"}
                className={cn("text-[10px]", anatomy.status === "completed" && "bg-emerald-600")}>
                {anatomy.status}
              </Badge>
              <span>{MODE_LABEL[anatomy.analysisMode] ?? anatomy.analysisMode}</span>
              {anatomy.costEstimate > 0 && <span className="text-amber-400">${anatomy.costEstimate.toFixed(4)}</span>}
              {a.confidence != null && <span>confidence {a.confidence}/100</span>}
            </div>
            {anatomy.errorMessage && <p className="text-xs text-red-400">{anatomy.errorMessage}</p>}
            {a.successMechanism && (
              <p className="text-sm"><span className="text-muted-foreground">Why it works:</span> {a.successMechanism}</p>
            )}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
              {a.hookType && <Fact label="Hook" value={`${a.hookType}${a.hookDurationSeconds ? ` (${a.hookDurationSeconds}s)` : ""}`} />}
              {a.format && <Fact label="Format" value={a.format} />}
              {a.emotionalDriver && <Fact label="Emotional driver" value={a.emotionalDriver} />}
              {a.cta && <Fact label="CTA" value={a.cta} />}
              {a.targetAudience && <Fact label="Audience" value={a.targetAudience} />}
              {(a.sceneCount || a.paceSecondsPerScene) ? <Fact label="Pacing" value={`${a.sceneCount || "?"} scenes · ~${a.paceSecondsPerScene || "?"}s/scene`} /> : null}
              {a.relevance != null && <Fact label="Mechanism transferability" value={`${a.relevance}/100`} />}
              {a.reproductionDifficulty != null && <Fact label="Reproduction difficulty" value={`${a.reproductionDifficulty}/100`} />}
            </div>
            {Array.isArray(a.structure) && a.structure.length > 0 && (
              <div className="text-xs space-y-1">
                <div className="text-muted-foreground font-medium">Structure</div>
                <ol className="list-decimal list-inside space-y-0.5">{a.structure.map((s: string, i: number) => <li key={i}>{s}</li>)}</ol>
              </div>
            )}
            {Array.isArray(a.risks) && a.risks.length > 0 && (
              <div className="text-xs flex items-start gap-1 text-amber-400/90">
                <ShieldAlert className="h-3.5 w-3.5 shrink-0 mt-0.5" /> Risks: {a.risks.join(", ")}
              </div>
            )}
            {Array.isArray(a.adaptationOpportunities) && a.adaptationOpportunities.length > 0 && (
              <div className="text-xs space-y-1">
                <div className="text-muted-foreground font-medium">Adaptation opportunities</div>
                <ul className="list-disc list-inside space-y-0.5">{a.adaptationOpportunities.map((s: string, i: number) => <li key={i}>{s}</li>)}</ul>
              </div>
            )}
            <PerformanceSignals metrics={item.metrics} scores={item.scores} />
            {anatomy.onScreenText && (
              <div className="text-xs space-y-1">
                <div className="text-muted-foreground font-medium">On-screen text</div>
                <p className="whitespace-pre-wrap">{anatomy.onScreenText}</p>
              </div>
            )}
            {anatomy.transcript && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground inline-flex items-center gap-1"><FileText className="h-3 w-3" /> Transcript</summary>
                <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{anatomy.transcript}</p>
              </details>
            )}
          </div>
        )}
      </div>

      {/* Adaptations */}
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-sm font-semibold flex items-center gap-2"><Wand2 className="h-4 w-4" /> Original adaptations</h2>
          <Button size="sm" className="h-7 text-xs ml-auto" onClick={runAdaptation}
            disabled={adapting || !anatomy || anatomy.status === "failed"}
            title={!anatomy ? "Run deep analysis first" : undefined}>
            {adapting ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}
            Generate adaptation brief
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Transfers the mechanism (hook type, structure, pacing, emotional driver) into a fully original brief for
          your business — grounded in your Business DNA. Briefs too similar to the source or containing restricted
          claims are blocked automatically.
        </p>
        {adaptations.length === 0 && <p className="text-xs text-muted-foreground">No adaptations yet.</p>}
        {adaptations.map((ad) => <AdaptationCard key={ad.id} ad={ad} />)}
      </div>
    </div>
  );
}

function PerformanceSignals({ metrics, scores }: { metrics: Record<string, unknown>; scores: Record<string, unknown> }) {
  const fmt = (v: unknown) => (typeof v === "number" ? (v >= 1000 ? `${(v / 1000).toFixed(v >= 100000 ? 0 : 1)}k` : String(v)) : String(v));
  const metricEntries = Object.entries(metrics ?? {}).filter(([, v]) => typeof v === "number" && (v as number) > 0);
  const scoreEntries = Object.entries(scores ?? {}).filter(([, v]) => typeof v === "number");
  if (metricEntries.length === 0 && scoreEntries.length === 0) return null;
  return (
    <div className="text-xs space-y-1">
      <div className="text-muted-foreground font-medium">Performance signals</div>
      <div className="flex items-center gap-3 flex-wrap">
        {metricEntries.map(([k, v]) => (
          <span key={k}><span className="text-muted-foreground">{k.replace(/_/g, " ")}:</span> <span className="font-medium">{fmt(v)}</span></span>
        ))}
        {scoreEntries.map(([k, v]) => (
          <span key={k}><span className="text-muted-foreground">{k.replace(/_/g, " ")} score:</span> <span className="font-medium">{fmt(v)}/100</span></span>
        ))}
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function AdaptationCard({ ad }: { ad: AdaptationRecord }) {
  const p: any = ad.payload ?? {};
  const brief: any = p.brief ?? {};
  const orig: any = p.originality ?? {};
  const comp: any = p.compliance ?? {};
  const blocked = comp.blocked === true || ad.status === "failed";
  const navigate = useNavigate();
  const createProjectFn = useServerFn(createProjectFromRecommendation);
  const [sending, setSending] = useState(false);
  const inStudio = ["in_content_studio", "awaiting_approval", "changes_requested", "published"].includes(ad.status);
  const canSend = !blocked && (["recommended", "analysed", "drafting"].includes(ad.status) || inStudio);

  const sendToStudio = async () => {
    setSending(true);
    try {
      const r = await createProjectFn({ data: { recommendationId: ad.id } });
      toast.success(r.existed ? "Opening the existing Content Studio project" : "Content Studio project created");
      navigate({ to: "/growthmind/content-projects/$projectId", params: { projectId: r.projectId } });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not create the project");
    } finally { setSending(false); }
  };

  return (
    <div className={cn("rounded-lg border p-3 space-y-2", blocked && "border-red-500/40")}>
      <div className="flex items-center gap-2 flex-wrap">
        {blocked
          ? <Badge variant="destructive" className="text-[10px] inline-flex items-center gap-1"><XCircle className="h-3 w-3" /> blocked</Badge>
          : <Badge className="text-[10px] bg-emerald-600 inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> {ad.status}</Badge>}
        {ad.targetPlatform && <Badge variant="outline" className="text-[10px]">{ad.targetPlatform}</Badge>}
        {orig.similarity != null && (
          <span className="text-[10px] text-muted-foreground">similarity {Math.round(Number(orig.similarity) * 100)}%</span>
        )}
      </div>
      <div className="text-sm font-medium">{ad.title}</div>
      {ad.brief && <p className="text-xs text-muted-foreground">{ad.brief}</p>}
      {canSend && (
        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={sending} onClick={sendToStudio}>
          {sending ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Clapperboard className="h-3 w-3 mr-1" />}
          {inStudio ? "Open Content Studio project" : "Send to Content Studio"}
        </Button>
      )}
      {blocked && Array.isArray(comp.blockedReasons) && comp.blockedReasons.length > 0 && (
        <p className="text-xs text-red-400">{comp.blockedReasons.join(" ")}</p>
      )}
      {Array.isArray(comp.warnings) && comp.warnings.length > 0 && (
        <p className="text-xs text-amber-400/80">{comp.warnings.join(" ")}</p>
      )}
      {orig.whyOriginal && <p className="text-xs"><span className="text-muted-foreground">Why original:</span> {orig.whyOriginal}</p>}
      {brief.script && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Full brief (script, shot list, caption…)</summary>
          <div className="mt-2 space-y-2">
            {Array.isArray(brief.hookOptions) && brief.hookOptions.length > 0 && (
              <div><span className="text-muted-foreground font-medium">Hooks:</span>
                <ul className="list-disc list-inside">{brief.hookOptions.map((h: string, i: number) => <li key={i}>{h}</li>)}</ul>
              </div>
            )}
            <div><span className="text-muted-foreground font-medium">Script:</span>
              <p className="whitespace-pre-wrap">{brief.script}</p>
            </div>
            {Array.isArray(brief.shotList) && brief.shotList.length > 0 && (
              <div><span className="text-muted-foreground font-medium">Shot list:</span>
                <ol className="list-decimal list-inside space-y-0.5">
                  {brief.shotList.map((s: any, i: number) => (
                    <li key={i}>{s.shot}{s.duration ? ` (${s.duration}s)` : ""}{s.onScreenText ? ` — "${s.onScreenText}"` : ""}</li>
                  ))}
                </ol>
              </div>
            )}
            {Array.isArray(brief.brollRequirements) && brief.brollRequirements.length > 0 && (
              <div><span className="text-muted-foreground font-medium">B-roll:</span> {brief.brollRequirements.join("; ")}</div>
            )}
            {brief.caption && <div><span className="text-muted-foreground font-medium">Caption:</span> {brief.caption}</div>}
            {brief.cta && <div><span className="text-muted-foreground font-medium">CTA:</span> {brief.cta}</div>}
            {brief.audioDirection && <div><span className="text-muted-foreground font-medium">Audio:</span> {brief.audioDirection}</div>}
            {Array.isArray(brief.hashtags) && brief.hashtags.length > 0 && (
              <div><span className="text-muted-foreground font-medium">Hashtags:</span> {brief.hashtags.join(" ")}</div>
            )}
            {brief.postingTime && <div><span className="text-muted-foreground font-medium">Posting time:</span> {brief.postingTime}</div>}
            {brief.expectedOutcome && <div><span className="text-muted-foreground font-medium">Expected outcome:</span> {brief.expectedOutcome}</div>}
          </div>
        </details>
      )}
    </div>
  );
}
