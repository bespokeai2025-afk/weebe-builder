import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Newspaper, Loader2, Copy, Check, Trash2, Eye,
  Wand2, Plus, RefreshCw, Settings2, ExternalLink,
  ChevronDown, ChevronUp, X, BarChart3, CalendarDays,
  Globe, Zap, FileText, Save, Send, ShieldCheck,
  AlertCircle, CheckCircle2, Clock, BookOpen, Sparkles,
  ArrowLeft, Edit2, Target, TrendingUp, Tag,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GrowthMindShell } from "./GrowthMindShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  generateBlogPost, getBlogPosts, saveBlogPost, deleteBlogPost,
  getBlogPublishSettings, saveBlogPublishSettings,
  publishToWordPress, publishToWebflow, autoQueueBlogDrafts,
  type BlogPost, type BlogPublishSettings,
} from "@/lib/growthmind/growthmind.blog-writer";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function useCopyText(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  function copy(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return [copied, copy];
}

const STATUS_STYLES: Record<string, string> = {
  Draft:     "bg-slate-500/15 text-slate-400 border-slate-500/20",
  Scheduled: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  Published: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  Archived:  "bg-zinc-500/15 text-zinc-400 border-zinc-500/20",
};

const TONE_OPTIONS   = ["Professional", "Friendly", "Persuasive", "Authoritative", "Casual", "Conversational", "Inspiring"];
const WC_OPTIONS     = [600, 800, 1000, 1200, 1500, 2000, 2500, 3000];

function SeoScoreBadge({ score }: { score: number }) {
  const color = score >= 80 ? "text-emerald-400 bg-emerald-500/15 border-emerald-500/20"
    : score >= 60 ? "text-amber-400 bg-amber-500/15 border-amber-500/20"
    : "text-red-400 bg-red-500/15 border-red-500/20";
  return (
    <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-bold", color)}>
      SEO {score}/100
    </span>
  );
}

// ── SEO panel ─────────────────────────────────────────────────────────────────

function SeoPanel({ post }: { post: BlogPost }) {
  const { seoData } = post;
  return (
    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-3.5 w-3.5 text-emerald-400" />
        <span className="text-xs font-semibold">SEO Analysis</span>
        <SeoScoreBadge score={seoData.seoScore} />
        <span className="ml-auto text-[10px] text-muted-foreground">{seoData.wordCount} words · {seoData.readingTimeMin} min read</span>
      </div>

      {seoData.primaryKeyword && (
        <div>
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1.5">Primary Keyword</p>
          <span className="rounded bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-xs text-emerald-300">
            {seoData.primaryKeyword}
          </span>
        </div>
      )}

      {seoData.secondaryKeywords?.length > 0 && (
        <div>
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1.5">Secondary Keywords</p>
          <div className="flex flex-wrap gap-1">
            {seoData.secondaryKeywords.map((k, i) => (
              <span key={i} className="rounded bg-white/[0.04] border border-white/[0.06] px-2 py-0.5 text-[10px] text-muted-foreground">{k}</span>
            ))}
          </div>
        </div>
      )}

      {seoData.metaTitle && (
        <div>
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1">Meta Title <span className="normal-case text-muted-foreground/40">({seoData.metaTitle.length} chars)</span></p>
          <p className="text-xs">{seoData.metaTitle}</p>
        </div>
      )}

      {seoData.metaDescription && (
        <div>
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1">Meta Description <span className="normal-case text-muted-foreground/40">({seoData.metaDescription.length} chars)</span></p>
          <p className="text-xs text-muted-foreground">{seoData.metaDescription}</p>
        </div>
      )}

      {seoData.suggestedHeadings?.length > 0 && (
        <div>
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1">Suggested H2s</p>
          <ul className="space-y-0.5">
            {seoData.suggestedHeadings.map((h, i) => (
              <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                <span className="text-emerald-400/60 mt-px shrink-0">—</span>{h}
              </li>
            ))}
          </ul>
        </div>
      )}

      {seoData.slug && (
        <div>
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1">URL Slug</p>
          <code className="text-xs text-sky-400/80">/{seoData.slug}</code>
        </div>
      )}
    </div>
  );
}

// ── Markdown renderer (lightweight, XSS-safe) ────────────────────────────────
// SECURITY: HTML-escape all user content FIRST so any embedded HTML/script in
// the post body is neutralised before markdown patterns introduce controlled tags.

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderMarkdown(md: string): string {
  const safe = escapeHtml(md);
  return safe
    .replace(/^# (.+)$/gm, '<h1 class="text-xl font-bold mt-6 mb-3">$1</h1>')
    .replace(/^## (.+)$/gm, '<h2 class="text-base font-semibold mt-5 mb-2 text-foreground/90">$1</h2>')
    .replace(/^### (.+)$/gm, '<h3 class="text-sm font-semibold mt-4 mb-1.5 text-foreground/80">$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, '<code class="rounded bg-white/[0.08] px-1 py-0.5 text-[11px] text-sky-300">$1</code>')
    .replace(/^- (.+)$/gm, '<li class="ml-4 list-disc">$1</li>')
    .replace(/^(\d+)\. (.+)$/gm, '<li class="ml-4 list-decimal">$2</li>')
    .replace(/(<li[^>]*>.*<\/li>)/gs, '<ul class="my-2 space-y-0.5 text-sm text-muted-foreground">$1</ul>')
    .replace(/\n\n/g, '</p><p class="text-sm text-muted-foreground leading-relaxed my-2">')
    .replace(/^(?!<[hul])/m, '<p class="text-sm text-muted-foreground leading-relaxed my-2">');
}

// ── Publish settings modal ────────────────────────────────────────────────────

function PublishSettingsModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const getSettingsFn  = useServerFn(getBlogPublishSettings);
  const saveSettingsFn = useServerFn(saveBlogPublishSettings);

  const [form, setForm] = useState({
    wordpressUrl: "", wordpressUsername: "", wordpressAppPassword: "",
    webflowApiToken: "", webflowCollectionId: "",
  });
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState("");

  useEffect(() => {
    getSettingsFn({}).then(s => {
      setForm({
        wordpressUrl:         s.wordpressUrl,
        wordpressUsername:    s.wordpressUsername,
        wordpressAppPassword: s.wordpressAppPassword,
        webflowApiToken:      s.webflowApiToken,
        webflowCollectionId:  s.webflowCollectionId,
      });
      setLoading(false);
    });
  }, []);

  async function handleSave() {
    setSaving(true); setError("");
    try {
      await saveSettingsFn({ data: form });
      onSaved();
    } catch (e: any) { setError(e.message); }
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/70 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-white/[0.08] bg-[hsl(var(--sidebar-background))] shadow-2xl p-6 space-y-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/15 border border-violet-500/20">
            <Settings2 className="h-4 w-4 text-violet-400" />
          </div>
          <div>
            <p className="text-sm font-semibold">Publish Settings</p>
            <p className="text-xs text-muted-foreground">Connect WordPress or Webflow for auto-publishing</p>
          </div>
          <button onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* WordPress */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <Globe className="h-3.5 w-3.5 text-sky-400" />
                <p className="text-xs font-semibold">WordPress REST API</p>
                {form.wordpressUrl && form.wordpressUsername && form.wordpressAppPassword && (
                  <span className="ml-auto rounded-full bg-emerald-500/15 border border-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-400">Connected</span>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Site URL</Label>
                <Input value={form.wordpressUrl} onChange={e => setForm(f => ({ ...f, wordpressUrl: e.target.value }))}
                  placeholder="https://yoursite.com" className="h-8 text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Username</Label>
                <Input value={form.wordpressUsername} onChange={e => setForm(f => ({ ...f, wordpressUsername: e.target.value }))}
                  placeholder="admin" className="h-8 text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Application Password</Label>
                <Input type="password" value={form.wordpressAppPassword}
                  onChange={e => setForm(f => ({ ...f, wordpressAppPassword: e.target.value }))}
                  placeholder="xxxx xxxx xxxx xxxx" className="h-8 text-xs font-mono" />
                <p className="text-[10px] text-muted-foreground/50">Generate in WP Admin → Users → Profile → Application Passwords</p>
              </div>
            </div>

            {/* Webflow */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <Zap className="h-3.5 w-3.5 text-amber-400" />
                <p className="text-xs font-semibold">Webflow CMS API</p>
                {form.webflowApiToken && form.webflowCollectionId && (
                  <span className="ml-auto rounded-full bg-emerald-500/15 border border-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-400">Connected</span>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">API Token</Label>
                <Input type="password" value={form.webflowApiToken}
                  onChange={e => setForm(f => ({ ...f, webflowApiToken: e.target.value }))}
                  placeholder="Bearer token from Webflow settings" className="h-8 text-xs font-mono" />
                <p className="text-[10px] text-muted-foreground/50">Webflow Dashboard → Settings → Integrations → API Token</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Blog Collection ID</Label>
                <Input value={form.webflowCollectionId}
                  onChange={e => setForm(f => ({ ...f, webflowCollectionId: e.target.value }))}
                  placeholder="64abc123..." className="h-8 text-xs font-mono" />
                <p className="text-[10px] text-muted-foreground/50">Found in Webflow Designer → CMS → your Blog collection → Settings</p>
              </div>
            </div>

            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/[0.05] px-3 py-2 text-xs text-red-400">
                {error}
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={onClose} className="ml-auto">Cancel</Button>
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
                Save Settings
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Publish panel ─────────────────────────────────────────────────────────────

function PublishPanel({
  post,
  settings,
  onPublished,
}: {
  post: BlogPost;
  settings: BlogPublishSettings;
  onPublished: (newStatus: "Published" | "Scheduled") => void;
}) {
  const publishWpFn  = useServerFn(publishToWordPress);
  const publishWfFn  = useServerFn(publishToWebflow);
  const savePostFn   = useServerFn(saveBlogPost);

  const [copied, copy] = useCopyText();
  const [publishing, setPublishing] = useState<"wp" | "wf" | null>(null);
  const [scheduleDate, setScheduleDate] = useState("");
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [expanded, setExpanded] = useState(true);

  const newStatus = scheduleDate ? "Scheduled" : "Published" as const;

  async function handlePublishWP() {
    setPublishing("wp"); setResult(null);
    try {
      const res = await publishWpFn({ data: { postId: post.id, scheduleDate: scheduleDate || null } });
      setResult({ ok: true, message: `${newStatus === "Scheduled" ? "Scheduled" : "Published"} on WordPress! ${res.publishedUrl ?? ""}` });
      onPublished(newStatus);
    } catch (e: any) {
      setResult({ ok: false, message: e.message });
    }
    setPublishing(null);
  }

  async function handlePublishWebflow() {
    setPublishing("wf"); setResult(null);
    try {
      const res = await publishWfFn({ data: { postId: post.id, scheduleDate: scheduleDate || null } });
      setResult({ ok: true, message: `${newStatus === "Scheduled" ? "Scheduled" : "Published"} on Webflow! Item ID: ${res.webflowItemId}` });
      onPublished(newStatus);
    } catch (e: any) {
      setResult({ ok: false, message: e.message });
    }
    setPublishing(null);
  }

  async function handleMarkPublished() {
    try {
      await savePostFn({ data: {
        id: post.id, title: post.title, excerpt: post.excerpt,
        body: post.body, seoData: post.seoData,
        status: "Published",
        scheduledDate: post.scheduledDate,
      }});
      onPublished("Published");
    } catch { /* ignore */ }
  }

  return (
    <div className="rounded-xl border border-white/[0.06] bg-card/60 overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
      >
        <Send className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
        <span className="text-xs font-semibold flex-1">Publish Post</span>
        {expanded ? <ChevronUp className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-white/[0.04]">
          {/* Schedule date */}
          <div className="space-y-1 pt-3">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Schedule Date (optional)</Label>
            <Input
              type="datetime-local"
              value={scheduleDate}
              onChange={e => setScheduleDate(e.target.value)}
              className="h-8 text-xs"
            />
            <p className="text-[10px] text-muted-foreground/50">Leave blank to publish immediately.</p>
          </div>

          {/* WordPress */}
          <Button
            size="sm"
            variant="outline"
            className="w-full justify-start gap-2 text-xs"
            onClick={handlePublishWP}
            disabled={!settings.wordpressConnected || publishing !== null}
          >
            {publishing === "wp" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5 text-sky-400" />}
            {settings.wordpressConnected ? (scheduleDate ? "Schedule on WordPress" : "Publish to WordPress") : "WordPress not connected"}
          </Button>

          {/* Webflow */}
          <Button
            size="sm"
            variant="outline"
            className="w-full justify-start gap-2 text-xs"
            onClick={handlePublishWebflow}
            disabled={!settings.webflowConnected || publishing !== null}
          >
            {publishing === "wf" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5 text-amber-400" />}
            {settings.webflowConnected ? (scheduleDate ? "Schedule on Webflow" : "Publish to Webflow") : "Webflow not connected"}
          </Button>

          {/* Copy */}
          <Button
            size="sm"
            variant="outline"
            className="w-full justify-start gap-2 text-xs"
            onClick={() => copy(post.body)}
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied!" : "Copy Markdown to Clipboard"}
          </Button>

          {/* Manual mark published */}
          {post.status !== "Published" && (
            <Button
              size="sm"
              variant="ghost"
              className="w-full justify-start gap-2 text-xs text-muted-foreground"
              onClick={handleMarkPublished}
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Mark as Published Manually
            </Button>
          )}

          {result && (
            <div className={cn(
              "rounded-lg border px-3 py-2 text-xs",
              result.ok
                ? "border-emerald-500/20 bg-emerald-500/[0.05] text-emerald-400"
                : "border-red-500/20 bg-red-500/[0.05] text-red-400",
            )}>
              {result.ok ? <CheckCircle2 className="h-3 w-3 inline mr-1.5" /> : <AlertCircle className="h-3 w-3 inline mr-1.5" />}
              {result.message}
            </div>
          )}

          {(!settings.wordpressConnected && !settings.webflowConnected) && (
            <p className="text-[10px] text-muted-foreground/50 text-center pt-1">
              Add WordPress or Webflow credentials in Publish Settings to enable direct publishing.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Blog post card ────────────────────────────────────────────────────────────

function BlogPostCard({
  post,
  onView,
  onDelete,
}: {
  post:     BlogPost;
  onView:   (p: BlogPost) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="group rounded-xl border border-white/[0.06] bg-card/60 p-4 flex flex-col gap-3 hover:border-white/[0.12] transition-all">
      <div className="flex items-start gap-3">
        <div className="shrink-0 flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/20">
          <Newspaper className="h-3.5 w-3.5 text-emerald-400" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold leading-snug line-clamp-2">{post.title}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">{post.seoData.wordCount || "—"} words · {post.seoData.readingTimeMin || 1} min read</p>
        </div>
      </div>

      {post.excerpt && (
        <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">{post.excerpt}</p>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize", STATUS_STYLES[post.status])}>
          {post.status}
        </span>
        {post.seoData.seoScore > 0 && <SeoScoreBadge score={post.seoData.seoScore} />}
        {post.scheduledDate && (
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
            <CalendarDays className="h-2.5 w-2.5" />{post.scheduledDate}
          </span>
        )}
        {post.publishedUrl && (
          <a href={post.publishedUrl} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 text-[10px] text-sky-400 hover:underline">
            <ExternalLink className="h-2.5 w-2.5" />Live
          </a>
        )}
      </div>

      <div className="flex items-center gap-2 mt-auto">
        <Button size="sm" variant="ghost" className="flex-1 h-7 text-xs gap-1.5" onClick={() => onView(post)}>
          <Eye className="h-3 w-3" /> View / Edit
        </Button>
        <button
          onClick={() => onDelete(post.id)}
          className="p-1.5 rounded text-muted-foreground/40 hover:text-red-400 transition-colors"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function GrowthMindBlogWriter() {
  const qc = useQueryClient();

  const generateFn       = useServerFn(generateBlogPost);
  const savePostFn       = useServerFn(saveBlogPost);
  const deletePostFn     = useServerFn(deleteBlogPost);
  const autoQueueFn      = useServerFn(autoQueueBlogDrafts);

  // Queries
  const postsQuery = useQuery({
    queryKey: ["blog-posts"],
    queryFn:  () => getBlogPosts({}),
    staleTime: 30_000,
    throwOnError: false,
  });

  const settingsQuery = useQuery({
    queryKey: ["blog-publish-settings"],
    queryFn:  () => getBlogPublishSettings({}),
    staleTime: 60_000,
    throwOnError: false,
  });

  // UI state
  const [view, setView] = useState<"list" | "generate" | "editor">("list");
  const [activePost, setActivePost] = useState<BlogPost | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // Generate form
  const [form, setForm] = useState({
    topic: "", keyword: "", tone: "Professional",
    wordCount: 1200, audience: "", cta: "",
  });
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError]     = useState("");

  // Auto-queue state
  const [autoQueuing, setAutoQueuing] = useState(false);
  const [autoMsg, setAutoMsg]         = useState("");

  // Save state
  const [saving, setSaving]     = useState(false);
  const [saveMsg, setSaveMsg]   = useState("");

  const posts = postsQuery.data?.posts ?? [];
  const settings = settingsQuery.data ?? {
    wordpressUrl: "", wordpressUsername: "", wordpressAppPassword: "",
    webflowApiToken: "", webflowCollectionId: "",
    wordpressConnected: false, webflowConnected: false,
  };

  async function handleGenerate() {
    if (!form.topic.trim()) { setGenError("Please enter a blog topic."); return; }
    setGenerating(true); setGenError("");
    try {
      const res = await generateFn({ data: form });
      setActivePost({ ...res.post, id: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      setView("editor");
    } catch (e: any) {
      setGenError(e.message ?? "Failed to generate blog post.");
    }
    setGenerating(false);
  }

  async function handleSave() {
    if (!activePost) return;
    setSaving(true); setSaveMsg("");
    try {
      const res = await savePostFn({ data: {
        id:            activePost.id || undefined,
        title:         activePost.title,
        excerpt:       activePost.excerpt,
        body:          activePost.body,
        seoData:       activePost.seoData,
        status:        activePost.status,
        scheduledDate: activePost.scheduledDate,
        publishedUrl:  activePost.publishedUrl,
        wordpressPostId: activePost.wordpressPostId,
        webflowItemId: activePost.webflowItemId,
      }});
      if (!activePost.id) {
        setActivePost(p => p ? { ...p, id: res.id } : p);
      }
      setSaveMsg("Saved!");
      qc.invalidateQueries({ queryKey: ["blog-posts"] });
      setTimeout(() => setSaveMsg(""), 2000);
    } catch (e: any) {
      setSaveMsg(`Error: ${e.message}`);
    }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this blog post?")) return;
    try {
      await deletePostFn({ data: { id } });
      qc.invalidateQueries({ queryKey: ["blog-posts"] });
      if (activePost?.id === id) { setActivePost(null); setView("list"); }
    } catch { /* ignore */ }
  }

  async function handleAutoQueue() {
    setAutoQueuing(true); setAutoMsg("");
    try {
      const res = await autoQueueFn({});
      setAutoMsg(res.message);
      qc.invalidateQueries({ queryKey: ["blog-posts"] });
    } catch (e: any) {
      setAutoMsg(e.message);
    }
    setAutoQueuing(false);
  }

  // ── Editor view ──────────────────────────────────────────────────────────

  if (view === "editor" && activePost) {
    return (
      <GrowthMindShell>
        <div className="flex flex-col h-full min-h-0">
          {/* Header */}
          <div className="border-b border-white/[0.06] px-6 py-4 flex items-center gap-3 shrink-0">
            <button
              onClick={() => setView("list")}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Blog Writer
            </button>
            <span className="text-muted-foreground/40">/</span>
            <span className="text-xs font-semibold truncate max-w-xs">{activePost.title}</span>
            <div className="ml-auto flex items-center gap-2">
              <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize", STATUS_STYLES[activePost.status])}>
                {activePost.status}
              </span>
              <Button size="sm" variant="outline" onClick={handleSave} disabled={saving} className="gap-1.5">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                {saveMsg || "Save Draft"}
              </Button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 min-h-0 flex gap-0 overflow-hidden">
            {/* Left: Post content */}
            <div className="flex-1 min-w-0 overflow-y-auto p-6 space-y-4">
              {/* Title editor */}
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-1.5 block">Post Title</Label>
                <textarea
                  value={activePost.title}
                  onChange={e => setActivePost(p => p ? { ...p, title: e.target.value } : p)}
                  rows={2}
                  className="w-full rounded-xl border border-input bg-transparent px-3 py-2 text-sm font-semibold text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                />
              </div>

              {/* Excerpt */}
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-1.5 block">Excerpt / Summary</Label>
                <textarea
                  value={activePost.excerpt}
                  onChange={e => setActivePost(p => p ? { ...p, excerpt: e.target.value } : p)}
                  rows={2}
                  className="w-full rounded-xl border border-input bg-transparent px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                />
              </div>

              {/* Body editor */}
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Post Body (Markdown)</Label>
                  <span className="ml-auto text-[10px] text-muted-foreground/40">{activePost.seoData.wordCount || "—"} words</span>
                </div>
                <textarea
                  value={activePost.body}
                  onChange={e => setActivePost(p => p ? { ...p, body: e.target.value } : p)}
                  rows={30}
                  className="w-full rounded-xl border border-input bg-transparent px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring resize-none font-mono"
                />
              </div>

              {/* Preview toggle */}
              <details className="rounded-xl border border-white/[0.06] overflow-hidden">
                <summary className="px-4 py-2.5 text-xs font-semibold cursor-pointer select-none hover:bg-white/[0.02] flex items-center gap-2">
                  <Eye className="h-3.5 w-3.5 text-muted-foreground" /> Preview Rendered Output
                </summary>
                <div
                  className="px-5 py-4 prose prose-invert prose-sm max-w-none border-t border-white/[0.04]"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(activePost.body) }}
                />
              </details>
            </div>

            {/* Right: SEO + Publish */}
            <div className="w-72 shrink-0 border-l border-white/[0.06] overflow-y-auto p-4 space-y-4">
              {/* Status + schedule */}
              <div className="rounded-xl border border-white/[0.06] bg-card/60 p-4 space-y-3">
                <p className="text-xs font-semibold flex items-center gap-2">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" /> Post Settings
                </p>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Status</Label>
                  <select
                    value={activePost.status}
                    onChange={e => setActivePost(p => p ? { ...p, status: e.target.value as BlogPost["status"] } : p)}
                    className="w-full h-8 rounded-md border border-input bg-transparent px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                  >
                    {["Draft", "Scheduled", "Published", "Archived"].map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Scheduled Date</Label>
                  <Input
                    type="date"
                    value={activePost.scheduledDate ?? ""}
                    onChange={e => setActivePost(p => p ? { ...p, scheduledDate: e.target.value || null } : p)}
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              {/* SEO */}
              <SeoPanel post={activePost} />

              {/* Publish */}
              {activePost.id && (
                <PublishPanel
                  post={activePost}
                  settings={settings}
                  onPublished={(newStatus) => {
                    qc.invalidateQueries({ queryKey: ["blog-posts"] });
                    setActivePost(p => p ? { ...p, status: newStatus } : p);
                  }}
                />
              )}

              {!activePost.id && (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-3 text-xs text-amber-400">
                  <AlertCircle className="h-3.5 w-3.5 inline mr-1.5" />
                  Save the post first to enable publishing.
                </div>
              )}
            </div>
          </div>
        </div>
      </GrowthMindShell>
    );
  }

  // ── Generate view ─────────────────────────────────────────────────────────

  if (view === "generate") {
    return (
      <GrowthMindShell>
        <div className="flex flex-col h-full min-h-0">
          <div className="border-b border-white/[0.06] px-6 py-4 flex items-center gap-3 shrink-0">
            <button
              onClick={() => setView("list")}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Blog Writer
            </button>
            <span className="text-muted-foreground/40">/</span>
            <span className="text-xs font-semibold">Generate New Post</span>
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="max-w-2xl mx-auto p-6 space-y-6">
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="h-4 w-4 text-emerald-400" />
                  <p className="text-sm font-semibold">AI Blog Generator</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  GrowthMind writes a full SEO-optimised blog post using your Business DNA — services, USPs, target audience, and brand voice.
                </p>
              </div>

              <div className="space-y-4">
                {/* Topic */}
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Blog Topic <span className="text-red-400">*</span></Label>
                  <textarea
                    value={form.topic}
                    onChange={e => setForm(f => ({ ...f, topic: e.target.value }))}
                    placeholder="e.g. How AI phone agents help real estate agents close more deals"
                    rows={2}
                    className="w-full rounded-xl border border-input bg-transparent px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring resize-none"
                  />
                </div>

                {/* Keyword */}
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                    <span className="flex items-center gap-1.5"><Tag className="h-3 w-3" /> Primary Keyword (SEO)</span>
                  </Label>
                  <Input
                    value={form.keyword}
                    onChange={e => setForm(f => ({ ...f, keyword: e.target.value }))}
                    placeholder="e.g. AI phone agent for real estate"
                    className="h-9 text-sm"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* Tone */}
                  <div className="space-y-1.5">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Tone</Label>
                    <select
                      value={form.tone}
                      onChange={e => setForm(f => ({ ...f, tone: e.target.value }))}
                      className="w-full h-9 rounded-md border border-input bg-transparent px-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      {TONE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>

                  {/* Word count */}
                  <div className="space-y-1.5">
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Target Word Count</Label>
                    <select
                      value={form.wordCount}
                      onChange={e => setForm(f => ({ ...f, wordCount: Number(e.target.value) }))}
                      className="w-full h-9 rounded-md border border-input bg-transparent px-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      {WC_OPTIONS.map(w => <option key={w} value={w}>{w} words</option>)}
                    </select>
                  </div>
                </div>

                {/* Audience */}
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Target Audience</Label>
                  <Input
                    value={form.audience}
                    onChange={e => setForm(f => ({ ...f, audience: e.target.value }))}
                    placeholder="e.g. Real estate agents and property managers (leave blank to use Business DNA)"
                    className="h-9 text-sm"
                  />
                </div>

                {/* CTA */}
                <div className="space-y-1.5">
                  <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Call-to-Action</Label>
                  <Input
                    value={form.cta}
                    onChange={e => setForm(f => ({ ...f, cta: e.target.value }))}
                    placeholder="e.g. Book a free demo (leave blank to use Business DNA)"
                    className="h-9 text-sm"
                  />
                </div>
              </div>

              {genError && (
                <div className="rounded-xl border border-red-500/20 bg-red-500/[0.05] px-4 py-3 text-sm text-red-400">
                  <AlertCircle className="h-4 w-4 inline mr-1.5" />{genError}
                </div>
              )}

              <Button
                size="lg"
                className="w-full gap-2 bg-emerald-600 hover:bg-emerald-500 text-white"
                onClick={handleGenerate}
                disabled={generating || !form.topic.trim()}
              >
                {generating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generating your blog post…
                  </>
                ) : (
                  <>
                    <Wand2 className="h-4 w-4" />
                    Generate Blog Post with AI
                  </>
                )}
              </Button>

              {generating && (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4 text-center space-y-2">
                  <p className="text-xs font-semibold text-emerald-400">GrowthMind is writing your post…</p>
                  <p className="text-[11px] text-muted-foreground">Analysing your business, researching keywords, structuring SEO outline, and writing the full article. This takes 15–30 seconds.</p>
                  <div className="flex justify-center gap-1.5 pt-1">
                    {["Building SEO outline", "Writing content", "Optimising for keywords"].map((step, i) => (
                      <span key={i} className="rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 text-[10px] text-emerald-400">
                        {step}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </GrowthMindShell>
    );
  }

  // ── List view (default) ───────────────────────────────────────────────────

  const drafts     = posts.filter(p => p.status === "Draft");
  const scheduled  = posts.filter(p => p.status === "Scheduled");
  const published  = posts.filter(p => p.status === "Published");

  return (
    <GrowthMindShell>
      <div className="flex flex-col h-full min-h-0 overflow-y-auto">
        {/* Header */}
        <div className="border-b border-white/[0.06] px-6 py-5 flex items-center gap-3 shrink-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 border border-emerald-500/20 shrink-0">
            <Newspaper className="h-4 w-4 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-sm font-semibold">AI Blog Writer</h1>
            <p className="text-xs text-muted-foreground">Generate, schedule, and publish SEO blog posts automatically</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setShowSettings(true)} className="gap-1.5 text-xs">
              <Settings2 className="h-3.5 w-3.5" /> Publish Settings
            </Button>
            <Button size="sm" onClick={() => setView("generate")} className="gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs">
              <Plus className="h-3.5 w-3.5" /> New Blog Post
            </Button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Stats + auto-queue */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Total Posts",   value: posts.length,     icon: BookOpen,     color: "text-sky-400" },
              { label: "Drafts",        value: drafts.length,    icon: FileText,     color: "text-slate-400" },
              { label: "Scheduled",     value: scheduled.length, icon: Clock,        color: "text-amber-400" },
              { label: "Published",     value: published.length, icon: CheckCircle2, color: "text-emerald-400" },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="rounded-xl border border-white/[0.06] bg-card/60 p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Icon className={cn("h-4 w-4", color)} />
                  <span className="text-xs text-muted-foreground">{label}</span>
                </div>
                <p className="text-2xl font-bold">{value}</p>
              </div>
            ))}
          </div>

          {/* Autonomous Draft Mode */}
          <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.04] p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/15 border border-violet-500/20 shrink-0 mt-0.5">
                <Sparkles className="h-4 w-4 text-violet-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">Autonomous Draft Mode</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  In HiveMind <strong>Operator</strong> mode, GrowthMind auto-drafts a weekly blog post from your Business DNA and queues it for one-click approval. Click below to run it manually.
                </p>
                {autoMsg && (
                  <p className="text-xs text-violet-400 mt-2 flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5" />{autoMsg}
                  </p>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleAutoQueue}
                disabled={autoQueuing}
                className="shrink-0 gap-1.5 border-violet-500/30 text-violet-400 hover:bg-violet-500/10"
              >
                {autoQueuing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                Auto-Draft Now
              </Button>
            </div>
          </div>

          {/* Publish integrations banner */}
          {!settings.wordpressConnected && !settings.webflowConnected && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-4 flex items-center gap-3">
              <AlertCircle className="h-4 w-4 text-amber-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-amber-300">No publish integrations connected</p>
                <p className="text-xs text-muted-foreground">Connect WordPress or Webflow to publish posts directly. Or use Copy to Clipboard.</p>
              </div>
              <Button size="sm" variant="outline" className="shrink-0 gap-1.5 border-amber-500/30 text-amber-400"
                onClick={() => setShowSettings(true)}>
                <Settings2 className="h-3.5 w-3.5" /> Connect
              </Button>
            </div>
          )}

          {settings.wordpressConnected || settings.webflowConnected ? (
            <div className="flex items-center gap-3 flex-wrap">
              {settings.wordpressConnected && (
                <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/[0.05] px-3 py-1.5 text-xs text-emerald-400">
                  <Globe className="h-3 w-3" /> WordPress connected
                </span>
              )}
              {settings.webflowConnected && (
                <span className="flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/[0.05] px-3 py-1.5 text-xs text-emerald-400">
                  <Zap className="h-3 w-3" /> Webflow connected
                </span>
              )}
              <button onClick={() => setShowSettings(true)} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
                <Settings2 className="h-3 w-3" /> Manage
              </button>
            </div>
          ) : null}

          {/* Posts list */}
          {postsQuery.isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : posts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/[0.08] p-12 text-center space-y-3">
              <Newspaper className="h-10 w-10 text-muted-foreground/30 mx-auto" />
              <p className="text-sm font-semibold">No blog posts yet</p>
              <p className="text-xs text-muted-foreground">Generate your first SEO blog post with GrowthMind AI — it uses your Business DNA to write content that attracts your ideal customers.</p>
              <Button onClick={() => setView("generate")} className="mt-2 gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white">
                <Wand2 className="h-4 w-4" /> Generate First Post
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Drafts */}
              {drafts.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50 mb-3">
                    Drafts ({drafts.length})
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {drafts.map(p => (
                      <BlogPostCard key={p.id} post={p}
                        onView={post => { setActivePost(post); setView("editor"); }}
                        onDelete={handleDelete} />
                    ))}
                  </div>
                </div>
              )}

              {/* Scheduled */}
              {scheduled.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50 mb-3">
                    Scheduled ({scheduled.length})
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {scheduled.map(p => (
                      <BlogPostCard key={p.id} post={p}
                        onView={post => { setActivePost(post); setView("editor"); }}
                        onDelete={handleDelete} />
                    ))}
                  </div>
                </div>
              )}

              {/* Published */}
              {published.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50 mb-3">
                    Published ({published.length})
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {published.map(p => (
                      <BlogPostCard key={p.id} post={p}
                        onView={post => { setActivePost(post); setView("editor"); }}
                        onDelete={handleDelete} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {showSettings && (
        <PublishSettingsModal
          onClose={() => setShowSettings(false)}
          onSaved={() => {
            setShowSettings(false);
            qc.invalidateQueries({ queryKey: ["blog-publish-settings"] });
          }}
        />
      )}
    </GrowthMindShell>
  );
}
