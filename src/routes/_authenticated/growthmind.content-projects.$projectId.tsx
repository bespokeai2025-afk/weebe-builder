// GrowthMind → Content Studio Project — production workspace for a project
// created from an adaptation recommendation: media, voiceover, approval
// workflow (routed via HiveMind actions) and Meta publishing job status.
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft, Loader2, Clapperboard, Mic, Send, Undo2, Archive,
  RefreshCw, ExternalLink, ShieldAlert, Sparkles, CheckCircle2, XCircle, Clock,
} from "lucide-react";
import { GrowthMindShell } from "@/components/growthmind/GrowthMindShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  getContentProject, updateContentProject, setProjectMedia,
  generateProjectVoiceover, submitProjectForApproval, requestProjectChanges,
  archiveContentProject, retryProjectPublishJob, returnProjectToProduction,
} from "@/lib/growthmind/growthmind.content-projects";
import { approvalFlagLabel } from "@/lib/growthmind/content-approval.shared";

export const Route = createFileRoute("/_authenticated/growthmind/content-projects/$projectId")({
  component: () => (
    <GrowthMindShell>
      <ProjectPage />
    </GrowthMindShell>
  ),
});

const STATUS_STYLE: Record<string, string> = {
  in_production:      "bg-sky-600",
  awaiting_assets:    "bg-amber-600",
  awaiting_approval:  "bg-violet-600",
  changes_requested:  "bg-orange-600",
  approved:           "bg-emerald-600",
  scheduled:          "bg-teal-600",
  publishing:         "bg-blue-600",
  published:          "bg-emerald-700",
  failed:             "bg-red-600",
  archived:           "bg-zinc-600",
};

const STATUS_LABEL: Record<string, string> = {
  in_production:     "In production",
  awaiting_assets:   "Awaiting assets",
  awaiting_approval: "Awaiting approval",
  changes_requested: "Changes requested",
  approved:          "Approved",
  scheduled:         "Scheduled",
  publishing:        "Publishing",
  published:         "Published",
  failed:            "Failed",
  archived:          "Archived",
};

const JOB_STATUS_STYLE: Record<string, string> = {
  scheduled:  "bg-teal-600",
  publishing: "bg-blue-600",
  published:  "bg-emerald-600",
  failed:     "bg-red-600",
  cancelled:  "bg-zinc-600",
};

function ProjectPage() {
  const { projectId } = useParams({ from: "/_authenticated/growthmind/content-projects/$projectId" });
  const qc = useQueryClient();
  const getFn      = useServerFn(getContentProject);
  const updateFn   = useServerFn(updateContentProject);
  const mediaFn    = useServerFn(setProjectMedia);
  const voiceFn    = useServerFn(generateProjectVoiceover);
  const submitFn   = useServerFn(submitProjectForApproval);
  const changesFn  = useServerFn(requestProjectChanges);
  const archiveFn  = useServerFn(archiveContentProject);
  const retryFn    = useServerFn(retryProjectPublishJob);
  const returnFn   = useServerFn(returnProjectToProduction);

  const { data, isLoading, error } = useQuery({
    queryKey: ["gm-content-project", projectId],
    queryFn: () => getFn({ data: { projectId } }),
    throwOnError: false,
    refetchInterval: (q) => {
      const s = (q.state.data as any)?.project?.status;
      return s === "publishing" || s === "scheduled" ? 15_000 : false;
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["gm-content-project", projectId] });

  // Editable content fields (hydrated from the loaded project).
  const [form, setForm] = useState<Record<string, string>>({});
  const [hydratedFor, setHydratedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!data?.project || hydratedFor === data.project.id + data.project.updated_at) return;
    const p = data.project;
    setForm({
      title: p.title ?? "", caption: p.caption ?? "", cta: p.cta ?? "",
      subtitles: p.subtitles ?? "", voiceoverScript: p.voiceover_script ?? "",
      hashtags: Array.isArray(p.hashtags) ? p.hashtags.join(" ") : "",
      thumbnailText: p.thumbnail_text ?? "",
    });
    setHydratedFor(p.id + p.updated_at);
  }, [data, hydratedFor]);

  // Media form
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaType, setMediaType] = useState<"video" | "image">("video");
  const [mediaSource, setMediaSource] = useState<string>("uploaded");
  const [mediaIsAi, setMediaIsAi] = useState(false);

  const [connectionId, setConnectionId] = useState<string>("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<any>, okMsg?: string) => {
    setBusy(key);
    try {
      const r = await fn();
      if (okMsg) toast.success(okMsg);
      refresh();
      return r;
    } catch (e: any) {
      toast.error(e?.message ?? "Something went wrong");
    } finally { setBusy(null); }
  };

  if (isLoading) return <div className="p-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (error || !data) return (
    <div className="p-8 space-y-3">
      <p className="text-sm text-red-400">{(error as any)?.message ?? "Project not found."}</p>
      <Button variant="outline" size="sm" asChild><Link to="/growthmind/content-studio"><ArrowLeft className="h-3 w-3 mr-1" /> Content Studio</Link></Button>
    </div>
  );

  const { project: p, recommendation, jobs, connections, evaluation } = data;
  const editable = !["publishing", "published", "archived"].includes(p.status);
  const canSubmit = ["in_production", "awaiting_assets", "changes_requested"].includes(p.status);
  const insp: any = p.inspiration ?? {};

  const saveContent = () => run("save", () => updateFn({
    data: {
      projectId,
      title: form.title || undefined,
      caption: form.caption || null,
      cta: form.cta || null,
      subtitles: form.subtitles || null,
      voiceoverScript: form.voiceoverScript || null,
      thumbnailText: form.thumbnailText || null,
      hashtags: form.hashtags.split(/\s+/).map(h => h.trim()).filter(Boolean).slice(0, 30),
    },
  }).then((r: any) => {
    if (r.approvalReset) toast.info("Content changed — the project must be re-approved before publishing.");
  }), "Saved");

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-4xl">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="sm" className="h-7 text-xs" asChild>
          <Link to="/growthmind/content-studio"><ArrowLeft className="h-3 w-3 mr-1" /> Content Studio</Link>
        </Button>
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <Clapperboard className="h-5 w-5 text-emerald-400" /> {p.title}
        </h1>
        <Badge className={cn("text-[10px] ml-auto", STATUS_STYLE[p.status] ?? "bg-zinc-600")}>
          {STATUS_LABEL[p.status] ?? p.status}
        </Badge>
      </div>

      {/* Source recommendation link (bidirectional handoff) */}
      {recommendation && (
        <div className="rounded-lg border bg-card p-3 text-xs flex items-center gap-2 flex-wrap">
          <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
          <span className="text-muted-foreground">Created from adaptation:</span>
          <span className="font-medium">{recommendation.title}</span>
          <Badge variant="outline" className="text-[10px]">{recommendation.status}</Badge>
          {recommendation.trend_item_id && (
            <Button variant="ghost" size="sm" className="h-6 text-[11px] ml-auto" asChild>
              <Link to="/growthmind/anatomy/$itemId" params={{ itemId: recommendation.trend_item_id }}>
                View anatomy <ExternalLink className="h-3 w-3 ml-1" />
              </Link>
            </Button>
          )}
        </div>
      )}

      {/* Approval rules preview */}
      {evaluation?.flags?.length > 0 && p.status !== "published" && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs flex items-start gap-2">
          <ShieldAlert className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <div className="font-medium text-amber-300">Human approval will be required</div>
            <div className="text-muted-foreground">{evaluation.flags.map((f: string) => approvalFlagLabel(f)).join(" · ")}</div>
          </div>
        </div>
      )}

      {/* Content fields */}
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="text-sm font-medium">Content</div>
        <div className="space-y-2">
          <div><Label className="text-xs">Title</Label>
            <Input value={form.title ?? ""} disabled={!editable} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} /></div>
          <div><Label className="text-xs">Caption</Label>
            <Textarea rows={3} value={form.caption ?? ""} disabled={!editable} onChange={e => setForm(f => ({ ...f, caption: e.target.value }))} /></div>
          <div className="grid md:grid-cols-2 gap-2">
            <div><Label className="text-xs">Call to action</Label>
              <Input value={form.cta ?? ""} disabled={!editable} onChange={e => setForm(f => ({ ...f, cta: e.target.value }))} /></div>
            <div><Label className="text-xs">Thumbnail text</Label>
              <Input value={form.thumbnailText ?? ""} disabled={!editable} onChange={e => setForm(f => ({ ...f, thumbnailText: e.target.value }))} /></div>
          </div>
          <div><Label className="text-xs">Hashtags (space-separated)</Label>
            <Input value={form.hashtags ?? ""} disabled={!editable} onChange={e => setForm(f => ({ ...f, hashtags: e.target.value }))} /></div>
          <div><Label className="text-xs">Subtitles / on-screen text</Label>
            <Textarea rows={2} value={form.subtitles ?? ""} disabled={!editable} onChange={e => setForm(f => ({ ...f, subtitles: e.target.value }))} /></div>
          <div><Label className="text-xs">Voiceover script</Label>
            <Textarea rows={4} value={form.voiceoverScript ?? ""} disabled={!editable} onChange={e => setForm(f => ({ ...f, voiceoverScript: e.target.value }))} /></div>
        </div>
        {editable && (
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={saveContent} disabled={busy === "save"}>
              {busy === "save" && <Loader2 className="h-3 w-3 mr-1 animate-spin" />} Save content
            </Button>
            <Button size="sm" variant="outline" disabled={busy === "voice"} onClick={() =>
              run("voice", () => voiceFn({ data: { projectId } }), "AI voiceover generated (labelled as AI)")}>
              {busy === "voice" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Mic className="h-3 w-3 mr-1" />}
              Generate AI voiceover
            </Button>
          </div>
        )}
        {p.voiceover_url && (
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground flex items-center gap-2">
              Voiceover {p.voiceover_is_ai && <Badge variant="outline" className="text-[10px]">AI-generated</Badge>}
            </div>
            <audio controls src={p.voiceover_url} className="w-full h-9" />
          </div>
        )}
      </div>

      {/* Media */}
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="text-sm font-medium">Final media</div>
        {p.media_url ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs flex-wrap">
              <Badge variant="secondary" className="text-[10px]">{p.media_type}</Badge>
              {p.media_source && <Badge variant="outline" className="text-[10px]">{String(p.media_source).replace(/_/g, " ")}</Badge>}
              {p.media_is_ai && <Badge className="text-[10px] bg-violet-600">AI-generated media</Badge>}
              <a href={p.media_url} target="_blank" rel="noreferrer" className="text-[11px] text-blue-400 inline-flex items-center gap-1">
                Open <ExternalLink className="h-3 w-3" />
              </a>
            </div>
            {p.media_type === "image" && <img src={p.media_url} alt="Project media" className="max-h-64 rounded-lg border" />}
            {p.media_type === "video" && <video src={p.media_url} controls className="max-h-64 rounded-lg border" />}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No media attached yet. Real footage is preferred — AI-generated media is honestly labelled.</p>
        )}
        {editable && (
          <div className="space-y-2">
            <div className="grid md:grid-cols-[1fr,auto,auto] gap-2">
              <Input placeholder="https:// public URL of the final video or image" value={mediaUrl} onChange={e => setMediaUrl(e.target.value)} />
              <Select value={mediaType} onValueChange={(v) => setMediaType(v as any)}>
                <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="video">Video</SelectItem>
                  <SelectItem value="image">Image</SelectItem>
                </SelectContent>
              </Select>
              <Select value={mediaSource} onValueChange={setMediaSource}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="uploaded">Uploaded / own footage</SelectItem>
                  <SelectItem value="workspace_asset">Workspace asset</SelectItem>
                  <SelectItem value="video_studio">Video Studio</SelectItem>
                  <SelectItem value="image_studio">Image Studio</SelectItem>
                  <SelectItem value="stock">Stock</SelectItem>
                  <SelectItem value="ai_generated">AI-generated</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Switch checked={mediaIsAi || mediaSource === "ai_generated"} disabled={mediaSource === "ai_generated"} onCheckedChange={setMediaIsAi} />
                This media is AI-generated
              </label>
              <Button size="sm" variant="outline" className="ml-auto" disabled={!mediaUrl.trim() || busy === "media"} onClick={() =>
                run("media", () => mediaFn({
                  data: {
                    projectId, mediaUrl: mediaUrl.trim(), mediaType,
                    mediaSource: mediaSource as any, isAi: mediaIsAi,
                    thumbnailUrl: null,
                  },
                }), "Media attached")}>
                {busy === "media" && <Loader2 className="h-3 w-3 mr-1 animate-spin" />} Attach media
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Approval + publishing */}
      <div className="rounded-xl border bg-card p-4 space-y-3">
        <div className="text-sm font-medium">Approval &amp; publishing</div>
        {connections.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No connected social account. <Link to="/growthmind/social-accounts" className="text-blue-400">Connect Instagram or Facebook</Link> to publish.
          </p>
        ) : canSubmit ? (
          <div className="space-y-2">
            <div className="grid md:grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Publish to</Label>
                <Select value={connectionId || p.target_connection_id || ""} onValueChange={setConnectionId}>
                  <SelectTrigger><SelectValue placeholder="Choose account…" /></SelectTrigger>
                  <SelectContent>
                    {connections.map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.account_name ?? c.username ?? c.id} ({c.account_type === "facebook_page" ? "Facebook Page" : "Instagram"})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Schedule (optional — leave empty for right after approval)</Label>
                <Input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} />
              </div>
            </div>
            <Button size="sm" disabled={busy === "submit"} onClick={() =>
              run("submit", async () => {
                const r = await submitFn({
                  data: {
                    projectId,
                    connectionId: (connectionId || p.target_connection_id) || undefined,
                    scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
                  },
                });
                if (r.autoExecuted) toast.success("Approved automatically (operator mode) — publishing now.");
                else if (r.approvalFlags.length) toast.info(`Sent for approval — rules triggered: ${r.approvalFlags.map((f: string) => approvalFlagLabel(f)).join(", ")}`);
                else toast.success("Sent for approval — review it in HiveMind → Actions.");
              })}>
              {busy === "submit" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Send className="h-3 w-3 mr-1" />}
              Submit for approval
            </Button>
          </div>
        ) : p.status === "awaiting_approval" ? (
          <div className="space-y-2 text-xs">
            <p className="text-muted-foreground flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" /> Waiting for a decision in <Link to="/hivemind/actions" className="text-blue-400">HiveMind → Actions</Link>.
            </p>
            <Button size="sm" variant="outline" disabled={busy === "changes"} onClick={() =>
              run("changes", () => changesFn({ data: { projectId } }), "Approval withdrawn — back to production")}>
              {busy === "changes" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Undo2 className="h-3 w-3 mr-1" />}
              Withdraw &amp; request changes
            </Button>
          </div>
        ) : p.status === "published" ? (() => {
          const pubJob = jobs.find((j: any) => j.status === "published");
          const publishedAt = pubJob?.published_at ?? null;
          const permalink   = pubJob?.external_permalink ?? null;
          return (
            <p className="text-xs text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" /> Published{publishedAt ? ` on ${new Date(publishedAt).toLocaleString()}` : ""}.
              {permalink && (
                <a href={permalink} target="_blank" rel="noreferrer" className="text-blue-400 inline-flex items-center gap-1 ml-1">
                  View post <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </p>
          );
        })() : p.status === "failed" ? (
          <div className="space-y-2 text-xs">
            <p className="text-red-400 flex items-center gap-1">
              <XCircle className="h-3.5 w-3.5" /> Publishing failed. Retry the job below, or return the project to production to fix the content and re-submit.
            </p>
            <Button size="sm" variant="outline" disabled={busy === "return"} onClick={() =>
              run("return", () => returnFn({ data: { projectId } }), "Project returned to production")}>
              {busy === "return" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Undo2 className="h-3 w-3 mr-1" />}
              Return to production
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Status: {STATUS_LABEL[p.status] ?? p.status}</p>
        )}
      </div>

      {/* Publishing jobs */}
      {jobs.length > 0 && (
        <div className="rounded-xl border bg-card p-4 space-y-2">
          <div className="text-sm font-medium">Publishing jobs</div>
          {jobs.map((j: any) => (
            <div key={j.id} className="rounded-lg border p-2.5 text-xs space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className={cn("text-[10px]", JOB_STATUS_STYLE[j.status] ?? "bg-zinc-600")}>{j.status}</Badge>
                <Badge variant="outline" className="text-[10px]">{j.platform} · {j.target_type}</Badge>
                <span className="text-muted-foreground">attempts {j.attempts ?? 0}/{j.max_attempts ?? 5}</span>
                {j.scheduled_at && <span className="text-muted-foreground">scheduled {new Date(j.scheduled_at).toLocaleString()}</span>}
                {j.status === "failed" && (
                  <Button size="sm" variant="outline" className="h-6 text-[11px] ml-auto" disabled={busy === `retry-${j.id}`} onClick={() =>
                    run(`retry-${j.id}`, () => retryFn({ data: { jobId: j.id } }), "Retry queued")}>
                    {busy === `retry-${j.id}` ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                    Retry now
                  </Button>
                )}
              </div>
              {j.external_permalink && (
                <a href={j.external_permalink} target="_blank" rel="noreferrer" className="text-blue-400 inline-flex items-center gap-1">
                  View published post <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {j.error_message && (
                <p className="text-red-400 flex items-start gap-1"><XCircle className="h-3.5 w-3.5 shrink-0 mt-px" /> {j.error_message}</p>
              )}
              {j.guidance && <p className="text-amber-300/90">{j.guidance}</p>}
            </div>
          ))}
        </div>
      )}

      {/* Inspiration / brief context */}
      {(insp.hookOptions?.length > 0 || insp.audioDirection || insp.riskNotes?.length > 0) && (
        <details className="rounded-xl border bg-card p-4 text-xs">
          <summary className="cursor-pointer text-sm font-medium">Adaptation brief context</summary>
          <div className="mt-2 space-y-2">
            {Array.isArray(insp.hookOptions) && insp.hookOptions.length > 0 && (
              <div><span className="text-muted-foreground font-medium">Hooks:</span>
                <ul className="list-disc list-inside">{insp.hookOptions.map((h: string, i: number) => <li key={i}>{h}</li>)}</ul>
              </div>
            )}
            {insp.audioDirection && <div><span className="text-muted-foreground font-medium">Audio:</span> {insp.audioDirection}</div>}
            {insp.postingTime && <div><span className="text-muted-foreground font-medium">Posting time:</span> {insp.postingTime}</div>}
            {Array.isArray(insp.riskNotes) && insp.riskNotes.length > 0 && (
              <div className="text-amber-300/90"><span className="font-medium">Risk notes:</span> {insp.riskNotes.join(" ")}</div>
            )}
          </div>
        </details>
      )}

      {p.status !== "archived" && p.status !== "publishing" && (
        <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={busy === "archive"} onClick={() =>
          run("archive", () => archiveFn({ data: { projectId } }), "Project archived")}>
          {busy === "archive" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Archive className="h-3 w-3 mr-1" />}
          Archive project
        </Button>
      )}
    </div>
  );
}
