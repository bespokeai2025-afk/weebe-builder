import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Wand2, Loader2, Copy, Check, X, Star, Trash2, BookOpen,
  Newspaper, Layout, Search, Target, Users2, ThumbsUp, Camera,
  Hash, Mail, MessageCircle, Gift, Award, Video, PlayCircle,
  Mic, Phone, RefreshCw, Share2, FileText, Archive, Eye,
  CalendarDays, Library, ChevronLeft, ChevronRight, Sparkles,
  Plus, MoreHorizontal, Edit2, ArrowLeft, BarChart3, ExternalLink,
  Zap, SlidersHorizontal, Cpu, AlertCircle, Facebook, Send,
  Link, DollarSign, Settings2, ShieldCheck, Upload, Clapperboard,
  BookMarked, FlaskConical, ImageIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GrowthMindShell } from "./GrowthMindShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  generateContent, getContentAssets, saveContentAsset, deleteContentAsset,
  toggleFavourite, getContentStats,
  type ContentType, type ContentAsset, type SeoData,
} from "@/lib/growthmind/growthmind.content";
import {
  getMetaAdsSettings, saveMetaAdsSettings, verifyMetaCredentials, publishToMeta,
} from "@/lib/growthmind/growthmind.meta-publish";
import {
  getSmartRoute, MODEL_META, PROVIDERS,
  type Provider, type ModelId,
} from "@/lib/growthmind/model-router.shared";
import {
  getPromptTemplates, getWorkspaceContext, recordPromptTemplateUsage,
  type PromptTemplate,
} from "@/lib/growthmind/growthmind.prompt-studio";

// ── ContentType → relevant PromptTypes mapping ─────────────────────────────────
// Used to filter Prompt Studio templates by the active content type category.

const CONTENT_TYPE_TO_PROMPT_TYPES: Record<string, string[]> = {
  blog_article:            ["content"],
  landing_page:            ["landing_pages", "content", "funnels"],
  lead_magnet:             ["content"],
  case_study:              ["content"],
  sales_letter:            ["sales", "content"],
  google_ad:               ["google_ads"],
  meta_ad:                 ["meta_ads"],
  linkedin_post:           ["content", "campaign"],
  facebook_post:           ["content", "campaign"],
  instagram_caption:       ["content", "campaign"],
  x_post:                  ["content", "campaign"],
  email_campaign:          ["email", "campaign"],
  whatsapp_campaign:       ["whatsapp", "campaign"],
  follow_up_sequence:      ["campaign"],
  review_request_campaign: ["campaign"],
  referral_campaign:       ["campaign"],
  video_script:            ["video"],
  vsl_script:              ["video", "sales"],
  podcast_script:          ["video"],
  ai_call_script:          ["ai_calling", "agent_scripts"],
};

// ── Content type definitions ──────────────────────────────────────────────────

type ContentTypeDef = {
  id:       ContentType;
  label:    string;
  icon:     React.ElementType;
  category: "written" | "ads" | "social" | "messaging" | "scripts";
  color:    string;
};

const CONTENT_TYPES: ContentTypeDef[] = [
  { id: "blog_article",            label: "Blog Article",          icon: Newspaper,    category: "written",   color: "text-sky-400" },
  { id: "landing_page",            label: "Landing Page",          icon: Layout,       category: "written",   color: "text-sky-400" },
  { id: "lead_magnet",             label: "Lead Magnet",           icon: Gift,         category: "written",   color: "text-sky-400" },
  { id: "case_study",              label: "Case Study",            icon: Award,        category: "written",   color: "text-sky-400" },
  { id: "sales_letter",            label: "Sales Letter",          icon: FileText,     category: "written",   color: "text-sky-400" },
  { id: "google_ad",               label: "Google Ad",             icon: Search,       category: "ads",       color: "text-amber-400" },
  { id: "meta_ad",                 label: "Meta Ad",               icon: Target,       category: "ads",       color: "text-amber-400" },
  { id: "linkedin_post",           label: "LinkedIn Post",         icon: Users2,       category: "social",    color: "text-violet-400" },
  { id: "facebook_post",           label: "Facebook Post",         icon: ThumbsUp,     category: "social",    color: "text-violet-400" },
  { id: "instagram_caption",       label: "Instagram Caption",     icon: Camera,       category: "social",    color: "text-violet-400" },
  { id: "x_post",                  label: "X Post",                icon: Hash,         category: "social",    color: "text-violet-400" },
  { id: "email_campaign",          label: "Email Campaign",        icon: Mail,         category: "messaging", color: "text-emerald-400" },
  { id: "whatsapp_campaign",       label: "WhatsApp Campaign",     icon: MessageCircle, category: "messaging", color: "text-emerald-400" },
  { id: "follow_up_sequence",      label: "Follow-Up Sequence",    icon: RefreshCw,    category: "messaging", color: "text-emerald-400" },
  { id: "review_request_campaign", label: "Review Request",        icon: Star,         category: "messaging", color: "text-emerald-400" },
  { id: "referral_campaign",       label: "Referral Campaign",     icon: Share2,       category: "messaging", color: "text-emerald-400" },
  { id: "video_script",            label: "Video Script",          icon: Video,        category: "scripts",   color: "text-rose-400" },
  { id: "vsl_script",              label: "VSL Script",            icon: PlayCircle,   category: "scripts",   color: "text-rose-400" },
  { id: "podcast_script",          label: "Podcast Script",        icon: Mic,          category: "scripts",   color: "text-rose-400" },
  { id: "ai_call_script",          label: "AI Call Script",        icon: Phone,        category: "scripts",   color: "text-rose-400" },
];

const CATEGORY_LABELS: Record<string, string> = {
  written:   "Written Content",
  ads:       "Ads",
  social:    "Social Media",
  messaging: "Email & Messaging",
  scripts:   "Scripts",
};

const CATEGORY_ORDER = ["written", "ads", "social", "messaging", "scripts"];

// ── Library folder definitions (virtual — filter by category) ─────────────────

const LIBRARY_FILTERS = [
  { id: "all",       label: "All Content",    icon: BookOpen,     filter: null },
  { id: "favourites",label: "Favourites",     icon: Star,         filter: "favourites" },
  { id: "written",   label: "Written",        icon: FileText,     filter: "written" },
  { id: "ads",       label: "Ads",            icon: Target,       filter: "ads" },
  { id: "social",    label: "Social",         icon: Camera,       filter: "social" },
  { id: "messaging", label: "Email & Messaging", icon: Mail,      filter: "messaging" },
  { id: "scripts",   label: "Scripts",        icon: Mic,          filter: "scripts" },
];

const CATEGORY_TYPES: Record<string, ContentType[]> = {
  written:   ["blog_article", "landing_page", "lead_magnet", "case_study", "sales_letter"],
  ads:       ["google_ad", "meta_ad"],
  social:    ["linkedin_post", "facebook_post", "instagram_caption", "x_post"],
  messaging: ["email_campaign", "whatsapp_campaign", "follow_up_sequence", "review_request_campaign", "referral_campaign"],
  scripts:   ["video_script", "vsl_script", "podcast_script", "ai_call_script"],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function typeDef(id: ContentType): ContentTypeDef {
  return CONTENT_TYPES.find(t => t.id === id) ?? CONTENT_TYPES[0];
}

const STATUS_STYLES: Record<string, string> = {
  draft:     "bg-slate-500/15 text-slate-400 border-slate-500/20",
  published: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  archived:  "bg-zinc-500/15 text-zinc-400 border-zinc-500/20",
};

function formatDate(iso: string): string {
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

// ── Brief form ────────────────────────────────────────────────────────────────

const TONE_OPTIONS   = ["Professional", "Friendly", "Persuasive", "Authoritative", "Casual", "Urgent", "Empathetic"];
const GOAL_OPTIONS   = ["Awareness", "Generate Leads", "Drive Conversions", "Nurture Prospects", "Customer Retention", "Brand Building"];
const LENGTH_OPTIONS = ["Short", "Medium", "Long", "Comprehensive"];

type BriefState = {
  businessType:   string;
  targetAudience: string;
  offer:          string;
  goal:           string;
  keyword:        string;
  location:       string;
  platform:       string;
  tone:           string;
  cta:            string;
  campaignType:   string;
  length:         string;
};

function SelectField({ label, value, options, onChange }: {
  label: string; value: string; options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">{label}</Label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full h-8 rounded-md border border-input bg-transparent px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      >
        <option value="">— select —</option>
        {options.map(o => <option key={o} value={o.toLowerCase()}>{o}</option>)}
      </select>
    </div>
  );
}

function TextField({ label, value, placeholder, onChange, multiline }: {
  label: string; value: string; placeholder?: string;
  onChange: (v: string) => void; multiline?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">{label}</Label>
      {multiline ? (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          rows={2}
          className="w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring resize-none"
        />
      ) : (
        <Input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="h-8 text-xs" />
      )}
    </div>
  );
}

// ── SEO Panel ─────────────────────────────────────────────────────────────────

function SeoPanel({ seoData }: { seoData: Partial<SeoData> }) {
  if (!seoData || Object.keys(seoData).length === 0) return null;
  return (
    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4 space-y-3">
      <p className="text-xs font-semibold flex items-center gap-2">
        <BarChart3 className="h-3.5 w-3.5 text-emerald-400" />
        SEO Recommendations
        {seoData.seoScore !== undefined && (
          <span className={cn(
            "ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold",
            seoData.seoScore >= 80 ? "bg-emerald-500/20 text-emerald-400"
            : seoData.seoScore >= 60 ? "bg-amber-500/20 text-amber-400"
            : "bg-red-500/20 text-red-400",
          )}>
            SEO {seoData.seoScore}/100
          </span>
        )}
      </p>
      {seoData.primaryKeyword && (
        <div>
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1">Primary Keyword</p>
          <span className="rounded bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-xs text-emerald-300">{seoData.primaryKeyword}</span>
        </div>
      )}
      {(seoData.secondaryKeywords ?? []).length > 0 && (
        <div>
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1">Secondary Keywords</p>
          <div className="flex flex-wrap gap-1">
            {seoData.secondaryKeywords!.map((k, i) => (
              <span key={i} className="rounded bg-white/[0.04] border border-white/[0.06] px-2 py-0.5 text-[10px] text-muted-foreground">{k}</span>
            ))}
          </div>
        </div>
      )}
      {seoData.metaTitle && (
        <div>
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1">Meta Title</p>
          <p className="text-xs">{seoData.metaTitle}</p>
        </div>
      )}
      {seoData.metaDescription && (
        <div>
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1">Meta Description</p>
          <p className="text-xs text-muted-foreground">{seoData.metaDescription}</p>
        </div>
      )}
      {(seoData.suggestedHeadings ?? []).length > 0 && (
        <div>
          <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1">Suggested Headings</p>
          <ul className="space-y-0.5">
            {seoData.suggestedHeadings!.map((h, i) => (
              <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                <span className="text-emerald-400/60 mt-px">—</span>{h}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ── Asset Card ────────────────────────────────────────────────────────────────

function AssetCard({ asset, onView, onDelete, onToggleFav, onStatusChange }: {
  asset:           ContentAsset;
  onView:          (a: ContentAsset) => void;
  onDelete:        (id: string) => void;
  onToggleFav:     (id: string, fav: boolean) => void;
  onStatusChange:  (id: string, status: ContentAsset["status"]) => void;
}) {
  const [menu, setMenu]   = useState(false);
  const [copied, copy]    = useCopyText();
  const td                = typeDef(asset.contentType);
  const Icon              = td.icon;

  return (
    <div className="group rounded-xl border border-white/[0.06] bg-card/60 p-4 flex flex-col gap-3 hover:border-white/[0.12] transition-all">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="shrink-0 flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.04] border border-white/[0.06]">
            <Icon className={cn("h-3.5 w-3.5", td.color)} />
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold truncate" title={asset.title}>{asset.title}</p>
            <p className={cn("text-[10px] mt-0.5", td.color)}>{td.label}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onToggleFav(asset.id, !asset.isFavourite)}
            className={cn("p-1 rounded transition-colors", asset.isFavourite ? "text-amber-400" : "text-muted-foreground/40 hover:text-amber-400")}
          >
            <Star className="h-3 w-3" fill={asset.isFavourite ? "currentColor" : "none"} />
          </button>
          <div className="relative">
            <button
              onClick={() => setMenu(v => !v)}
              className="p-1 rounded text-muted-foreground/40 hover:text-foreground transition-colors"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
            {menu && (
              <div className="absolute right-0 top-6 z-10 w-40 rounded-lg border border-white/[0.08] bg-popover shadow-xl py-1">
                <button onClick={() => { onView(asset); setMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-white/[0.04] transition-colors">
                  <Eye className="h-3 w-3" /> View / Edit
                </button>
                <button onClick={() => { copy(asset.content); setMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-white/[0.04] transition-colors">
                  {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />} Copy content
                </button>
                <button
                  onClick={() => {
                    setMenu(false);
                    const params = new URLSearchParams({
                      mode:   "freeform",
                      prompt: asset.content.slice(0, 1200),
                      title:  asset.title,
                    });
                    window.location.assign(`/growthmind/video-studio?${params.toString()}`);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-white/[0.04] transition-colors text-violet-400">
                  <Clapperboard className="h-3 w-3" /> Create Video
                </button>
                <button
                  onClick={() => {
                    setMenu(false);
                    const params = new URLSearchParams({
                      prompt:    asset.content.slice(0, 600),
                      assetType: "social_image",
                      contentAssetId: asset.id,
                    });
                    window.location.assign(`/growthmind/image-studio?${params.toString()}`);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-white/[0.04] transition-colors text-orange-400">
                  <ImageIcon className="h-3 w-3" /> Generate Image
                </button>
                {asset.status !== "published" && (
                  <button onClick={() => { onStatusChange(asset.id, "published"); setMenu(false); }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-white/[0.04] transition-colors">
                    <ExternalLink className="h-3 w-3 text-emerald-400" /> Mark published
                  </button>
                )}
                {asset.status !== "archived" && (
                  <button onClick={() => { onStatusChange(asset.id, "archived"); setMenu(false); }}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-white/[0.04] transition-colors text-muted-foreground">
                    <Archive className="h-3 w-3" /> Archive
                  </button>
                )}
                <div className="border-t border-white/[0.06] my-1" />
                <button onClick={() => { onDelete(asset.id); setMenu(false); }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-white/[0.04] text-red-400 transition-colors">
                  <Trash2 className="h-3 w-3" /> Delete
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground line-clamp-3 leading-relaxed">
        {asset.content.slice(0, 200)}
      </p>

      <div className="flex items-center justify-between mt-auto pt-1">
        <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize", STATUS_STYLES[asset.status])}>
          {asset.status}
        </span>
        <span className="text-[10px] text-muted-foreground/50">{formatDate(asset.createdAt)}</span>
      </div>

      {/* Close menu on outside click */}
      {menu && <div className="fixed inset-0 z-[9]" onClick={() => setMenu(false)} />}
    </div>
  );
}

// ── Meta Connect Modal ────────────────────────────────────────────────────────

function MetaConnectModal({ onClose, onSaved }: {
  onClose:  () => void;
  onSaved:  () => void;
}) {
  const getMetaFn    = useServerFn(getMetaAdsSettings);
  const saveMetaFn   = useServerFn(saveMetaAdsSettings);
  const verifyMetaFn = useServerFn(verifyMetaCredentials);

  const [form, setForm]       = useState({ accessToken: "", adAccountId: "", pageId: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified]   = useState<{ userName: string; accountName: string } | null>(null);
  const [error, setError]     = useState("");

  useEffect(() => {
    getMetaFn({}).then(s => {
      setForm({ accessToken: s.accessToken, adAccountId: s.adAccountId, pageId: s.pageId });
      setLoading(false);
    });
  }, []);

  async function handleVerify() {
    setVerifying(true); setError(""); setVerified(null);
    try {
      const r = await verifyMetaFn({ data: { accessToken: form.accessToken.trim(), adAccountId: form.adAccountId.trim() } });
      if (r.ok) setVerified({ userName: r.userName!, accountName: r.accountName! });
      else setError(r.error ?? "Verification failed");
    } catch (e: any) { setError(e.message); }
    setVerifying(false);
  }

  async function handleSave() {
    setSaving(true); setError("");
    try {
      await saveMetaFn({ data: { accessToken: form.accessToken.trim(), adAccountId: form.adAccountId.trim(), pageId: form.pageId.trim() } });
      onSaved();
    } catch (e: any) { setError(e.message); }
    setSaving(false);
  }

  const ready = form.accessToken.trim() && form.adAccountId.trim() && form.pageId.trim();

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/70 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-white/[0.08] bg-[hsl(var(--sidebar-background))] shadow-2xl p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/15 border border-blue-500/20">
            <Facebook className="h-4.5 w-4.5 text-blue-400" />
          </div>
          <div>
            <p className="text-sm font-semibold">Connect Meta Ads</p>
            <p className="text-xs text-muted-foreground">Enter your Meta Marketing API credentials</p>
          </div>
          <button onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Access Token</Label>
              <Input
                type="password"
                value={form.accessToken}
                onChange={e => setForm(f => ({ ...f, accessToken: e.target.value }))}
                placeholder="EAAxxxxxxx…"
                className="h-8 text-xs font-mono"
              />
              <p className="text-[10px] text-muted-foreground/50">A user or system access token with <code className="text-xs">ads_management</code> permission.</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Ad Account ID</Label>
              <Input
                value={form.adAccountId}
                onChange={e => setForm(f => ({ ...f, adAccountId: e.target.value }))}
                placeholder="act_123456789"
                className="h-8 text-xs font-mono"
              />
              <p className="text-[10px] text-muted-foreground/50">Found in Meta Business Suite → Accounts → Ad Accounts.</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Facebook Page ID</Label>
              <Input
                value={form.pageId}
                onChange={e => setForm(f => ({ ...f, pageId: e.target.value }))}
                placeholder="123456789"
                className="h-8 text-xs font-mono"
              />
              <p className="text-[10px] text-muted-foreground/50">The Facebook Page the ads will be published from.</p>
            </div>

            {verified && (
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.05] px-3 py-2.5 flex items-center gap-2 text-xs">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                <span className="text-emerald-300">Verified — <strong>{verified.userName}</strong> · {verified.accountName}</span>
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/[0.05] px-3 py-2 text-xs text-red-400">
                {error}
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={handleVerify} disabled={!form.accessToken.trim() || !form.adAccountId.trim() || verifying}>
                {verifying ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />}
                Verify
              </Button>
              <Button size="sm" className="ml-auto" onClick={handleSave} disabled={!ready || saving}>
                {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />}
                Save credentials
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Meta Publish Modal ────────────────────────────────────────────────────────

function MetaPublishModal({ asset, onClose }: {
  asset:   ContentAsset;
  onClose: () => void;
}) {
  const publishFn    = useServerFn(publishToMeta);
  const getMetaFn    = useServerFn(getMetaAdsSettings);
  const [showConnect, setShowConnect] = useState(false);
  const [connected, setConnected]     = useState<boolean | null>(null);
  const [publishing, setPublishing]   = useState(false);
  const [result, setResult]           = useState<{ campaignId: string; adSetId: string; message: string } | null>(null);
  const [error, setError]             = useState("");
  const [form, setForm] = useState({
    campaignName:   asset.title,
    destinationUrl: "",
    dailyBudgetUsd: 5,
    objective:      "OUTCOME_AWARENESS" as "OUTCOME_AWARENESS" | "OUTCOME_TRAFFIC" | "OUTCOME_LEADS",
  });

  useEffect(() => {
    getMetaFn({}).then(s => setConnected(s.connected));
  }, []);

  async function handlePublish() {
    setPublishing(true); setError("");
    try {
      const r = await publishFn({
        data: {
          adContent:      asset.content,
          adTitle:        asset.title,
          campaignName:   form.campaignName,
          destinationUrl: form.destinationUrl,
          dailyBudgetUsd: form.dailyBudgetUsd,
          objective:      form.objective,
        },
      });
      setResult({ campaignId: r.campaignId, adSetId: r.adSetId, message: r.message });
    } catch (e: any) { setError(e.message); }
    setPublishing(false);
  }

  if (showConnect) {
    return (
      <MetaConnectModal
        onClose={() => setShowConnect(false)}
        onSaved={() => { setShowConnect(false); setConnected(true); }}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background/70 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-white/[0.08] bg-[hsl(var(--sidebar-background))] shadow-2xl p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/15 border border-blue-500/20">
            <Upload className="h-4 w-4 text-blue-400" />
          </div>
          <div>
            <p className="text-sm font-semibold">Publish to Meta Ads</p>
            <p className="text-xs text-muted-foreground">Create a paused draft campaign in your Meta account</p>
          </div>
          <button onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        {connected === null ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : result ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4 space-y-2">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                <p className="text-sm font-semibold text-emerald-300">Published as draft!</p>
              </div>
              <p className="text-xs text-muted-foreground">{result.message}</p>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] px-3 py-2">
                  <p className="text-[10px] text-muted-foreground/50 mb-0.5">Campaign ID</p>
                  <p className="text-xs font-mono text-muted-foreground truncate">{result.campaignId}</p>
                </div>
                <div className="rounded-lg bg-white/[0.03] border border-white/[0.06] px-3 py-2">
                  <p className="text-[10px] text-muted-foreground/50 mb-0.5">Ad Set ID</p>
                  <p className="text-xs font-mono text-muted-foreground truncate">{result.adSetId}</p>
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground text-center">Go to Meta Ads Manager to review, edit targeting, and activate the campaign.</p>
            <Button className="w-full" size="sm" onClick={onClose}>Done</Button>
          </div>
        ) : !connected ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-4 flex items-start gap-3">
              <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-semibold text-amber-300 mb-1">Meta Ads not connected</p>
                <p className="text-xs text-muted-foreground">Connect your Meta account first to publish ads directly from here.</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={onClose} className="flex-1">Cancel</Button>
              <Button size="sm" onClick={() => setShowConnect(true)} className="flex-1">
                <Settings2 className="mr-1.5 h-3.5 w-3.5" />Connect Meta
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Campaign Name</Label>
              <Input value={form.campaignName} onChange={e => setForm(f => ({ ...f, campaignName: e.target.value }))} className="h-8 text-xs" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Destination URL</Label>
              <Input value={form.destinationUrl} onChange={e => setForm(f => ({ ...f, destinationUrl: e.target.value }))} placeholder="https://yoursite.com/landing" className="h-8 text-xs" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Daily Budget (USD)</Label>
                <Input
                  type="number" min={1} max={10000}
                  value={form.dailyBudgetUsd}
                  onChange={e => setForm(f => ({ ...f, dailyBudgetUsd: Number(e.target.value) }))}
                  className="h-8 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">Objective</Label>
                <select
                  value={form.objective}
                  onChange={e => setForm(f => ({ ...f, objective: e.target.value as typeof form.objective }))}
                  className="w-full h-8 rounded-md border border-input bg-transparent px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="OUTCOME_AWARENESS">Awareness</option>
                  <option value="OUTCOME_TRAFFIC">Traffic</option>
                  <option value="OUTCOME_LEADS">Leads</option>
                </select>
              </div>
            </div>

            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
              <p className="text-[10px] text-muted-foreground/50 mb-1.5">Ad Copy Preview</p>
              <p className="text-xs text-muted-foreground line-clamp-3 leading-relaxed">{asset.content.slice(0, 200)}{asset.content.length > 200 ? "…" : ""}</p>
            </div>

            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/[0.05] px-3 py-2 text-xs text-red-400">{error}</div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <p className="text-[10px] text-muted-foreground/40 flex items-center gap-1">
                <ShieldCheck className="h-3 w-3" /> Published as PAUSED draft
              </p>
              <div className="flex gap-2 ml-auto">
                <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
                <Button size="sm" onClick={handlePublish} disabled={publishing || !form.destinationUrl.trim() || !form.campaignName.trim()}>
                  {publishing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
                  Publish to Meta
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Asset Viewer Modal ────────────────────────────────────────────────────────

function AssetViewer({ asset, onClose, onSave, onDelete }: {
  asset:    ContentAsset;
  onClose:  () => void;
  onSave:   (updated: ContentAsset) => void;
  onDelete: (id: string) => void;
}) {
  const [content, setContent]           = useState(asset.content);
  const [title, setTitle]               = useState(asset.title);
  const [status, setStatus]             = useState(asset.status);
  const [dirty, setDirty]               = useState(false);
  const [saved, setSaved]               = useState(false);
  const [copied, copy]                  = useCopyText();
  const [showPublish, setShowPublish]   = useState(false);
  const [showConnect, setShowConnect]   = useState(false);
  const td                              = typeDef(asset.contentType);
  const Icon                            = td.icon;
  const isAd = asset.contentType === "meta_ad" || asset.contentType === "google_ad";

  function handleSave() {
    onSave({ ...asset, title, content, status });
    setDirty(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-stretch bg-background/80 backdrop-blur-sm">
        <div className="ml-auto flex w-full max-w-3xl flex-col border-l border-white/[0.08] bg-[hsl(var(--sidebar-background))] overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-3 px-5 py-3.5 border-b border-white/[0.06] shrink-0">
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors mr-1">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <Icon className={cn("h-4 w-4 shrink-0", td.color)} />
            <input
              value={title}
              onChange={e => { setTitle(e.target.value); setDirty(true); }}
              className="flex-1 bg-transparent text-sm font-semibold focus:outline-none min-w-0"
            />
            <div className="flex items-center gap-2 shrink-0">
              <select
                value={status}
                onChange={e => { setStatus(e.target.value as ContentAsset["status"]); setDirty(true); }}
                className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold bg-transparent focus:outline-none capitalize cursor-pointer", STATUS_STYLES[status])}
              >
                <option value="draft">draft</option>
                <option value="published">published</option>
                <option value="archived">archived</option>
              </select>
              <button onClick={() => copy(content)} className="p-1.5 rounded hover:bg-white/[0.04] transition-colors text-muted-foreground hover:text-foreground" title="Copy content">
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
              {dirty && (
                <Button size="sm" onClick={handleSave} className="h-7 text-xs">
                  {saved ? <><Check className="mr-1 h-3 w-3" />Saved</> : "Save changes"}
                </Button>
              )}
              <button
                onClick={() => { if (confirm("Delete this content?")) { onDelete(asset.id); onClose(); } }}
                className="p-1.5 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Ad Actions Bar — shown for meta_ad / google_ad */}
          {isAd && (
            <div className="flex items-center gap-2 px-5 py-3 border-b border-white/[0.06] shrink-0 bg-white/[0.01]">
              <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wider mr-1">Actions</span>
              {asset.contentType === "meta_ad" && (
                <Button
                  size="sm" variant="outline"
                  className="h-7 text-xs border-blue-500/30 text-blue-300 hover:bg-blue-500/10 hover:border-blue-400/50"
                  onClick={() => setShowPublish(true)}
                >
                  <Upload className="mr-1.5 h-3 w-3" />Publish to Meta
                </Button>
              )}
              <Button
                size="sm" variant="outline"
                className="h-7 text-xs border-rose-500/30 text-rose-300 hover:bg-rose-500/10 hover:border-rose-400/50"
                onClick={() => window.open("/__mockup/preview/AdVideoTemplate", "_blank")}
              >
                <Clapperboard className="mr-1.5 h-3 w-3" />Preview Video Ad
              </Button>
              {asset.contentType === "meta_ad" && (
                <button
                  onClick={() => setShowConnect(true)}
                  className="ml-auto flex items-center gap-1.5 text-[10px] text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                >
                  <Settings2 className="h-3 w-3" />Meta settings
                </button>
              )}
            </div>
          )}

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            <textarea
              value={content}
              onChange={e => { setContent(e.target.value); setDirty(true); }}
              className="w-full rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-sm leading-relaxed text-foreground focus:outline-none focus:ring-1 focus:ring-ring resize-none min-h-[400px] font-mono"
              style={{ height: "auto" }}
              onInput={e => { const t = e.currentTarget; t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; }}
            />
            {asset.seoData && Object.keys(asset.seoData).length > 0 && (
              <SeoPanel seoData={asset.seoData} />
            )}
            {asset.brief && Object.keys(asset.brief).length > 0 && (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-3">Brief Used</p>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                  {Object.entries(asset.brief).filter(([, v]) => v && String(v).length > 0 && !["contentType"].includes(String(v))).map(([k, v]) => (
                    <div key={k}>
                      <span className="text-[10px] text-muted-foreground/50 capitalize">{k.replace(/([A-Z])/g, " $1")}: </span>
                      <span className="text-[10px] text-muted-foreground">{String(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {showPublish && <MetaPublishModal asset={asset} onClose={() => setShowPublish(false)} />}
      {showConnect && <MetaConnectModal onClose={() => setShowConnect(false)} onSaved={() => setShowConnect(false)} />}
    </>
  );
}

// ── Calendar Tab ──────────────────────────────────────────────────────────────

function CalendarTab({ assets }: { assets: ContentAsset[] }) {
  const [year, setYear]   = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth());

  const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const DAY_NAMES   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();

  const assetsByDate: Record<string, ContentAsset[]> = {};
  for (const a of assets) {
    const d = new Date(a.scheduledAt ?? a.createdAt);
    if (d.getFullYear() === year && d.getMonth() === month) {
      const key = d.getDate().toString();
      if (!assetsByDate[key]) assetsByDate[key] = [];
      assetsByDate[key].push(a);
    }
  }

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }

  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div className="px-6 py-5 max-w-5xl">
      <div className="flex items-center gap-4 mb-5">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-emerald-400" />
          Content Calendar
        </h2>
        <div className="flex items-center gap-2 ml-auto">
          <button onClick={prevMonth} className="p-1 rounded hover:bg-white/[0.04] transition-colors text-muted-foreground">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-semibold w-36 text-center">{MONTH_NAMES[month]} {year}</span>
          <button onClick={nextMonth} className="p-1 rounded hover:bg-white/[0.04] transition-colors text-muted-foreground">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-white/[0.06] overflow-hidden">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b border-white/[0.06]">
          {DAY_NAMES.map(d => (
            <div key={d} className="px-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 text-center">
              {d}
            </div>
          ))}
        </div>
        {/* Calendar grid */}
        <div className="grid grid-cols-7">
          {cells.map((day, idx) => {
            const isToday = day !== null && today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
            const dayAssets = day ? (assetsByDate[String(day)] ?? []) : [];
            return (
              <div
                key={idx}
                className={cn(
                  "min-h-[80px] p-1.5 border-b border-r border-white/[0.04] last:border-r-0",
                  idx % 7 === 6 && "border-r-0",
                  !day && "bg-white/[0.01]",
                )}
              >
                {day && (
                  <>
                    <span className={cn(
                      "flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-medium mb-1",
                      isToday ? "bg-emerald-500 text-white" : "text-muted-foreground",
                    )}>
                      {day}
                    </span>
                    <div className="space-y-0.5">
                      {dayAssets.slice(0, 3).map(a => {
                        const td2 = typeDef(a.contentType);
                        return (
                          <div key={a.id} className={cn("rounded px-1 py-0.5 text-[9px] font-medium truncate border", STATUS_STYLES[a.status].split(" ").slice(0, 2).join(" "), "border-current/20")}>
                            {a.title}
                          </div>
                        );
                      })}
                      {dayAssets.length > 3 && (
                        <p className="text-[9px] text-muted-foreground/50 pl-1">+{dayAssets.length - 3} more</p>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {assets.length === 0 && (
        <p className="text-sm text-muted-foreground text-center mt-6">No content created yet. Generate your first piece above.</p>
      )}
    </div>
  );
}

// ── Inline Meta Publish button for output panel ───────────────────────────────

function MetaPublishFromOutput({ content, title }: { content: string; title: string }) {
  const [open, setOpen] = useState(false);
  const fakeAsset: ContentAsset = {
    id: "", folderId: null, title, contentType: "meta_ad",
    content, brief: {}, seoData: {}, status: "draft",
    isFavourite: false, scheduledAt: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
  return (
    <>
      <Button
        variant="outline" size="sm"
        className="border-blue-500/30 text-blue-300 hover:bg-blue-500/10 hover:border-blue-400/50"
        onClick={() => setOpen(true)}
      >
        <Upload className="mr-1.5 h-3.5 w-3.5" />Publish to Meta
      </Button>
      {open && <MetaPublishModal asset={fakeAsset} onClose={() => setOpen(false)} />}
    </>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

type Tab = "generate" | "library" | "calendar";

export function GrowthMindContentStudio() {
  const qc                    = useQueryClient();
  const generateFn            = useServerFn(generateContent);
  const getAssetsFn           = useServerFn(getContentAssets);
  const saveAssetFn           = useServerFn(saveContentAsset);
  const deleteAssetFn         = useServerFn(deleteContentAsset);
  const toggleFavFn           = useServerFn(toggleFavourite);
  const getStatsFn            = useServerFn(getContentStats);
  const getTemplatesFn        = useServerFn(getPromptTemplates);
  const getWorkspaceCtxFn     = useServerFn(getWorkspaceContext);
  const recordUsageFn         = useServerFn(recordPromptTemplateUsage);

  const [tab, setTab]                             = useState<Tab>("generate");
  const [selectedType, setSelectedType]           = useState<ContentType | null>(null);
  const [brief, setBrief]                         = useState<Partial<Record<string, string>>>({
    tone: "professional", goal: "generate leads", length: "medium",
  });
  const [generating, setGenerating]               = useState(false);
  const [genError, setGenError]                   = useState<string | null>(null);
  const [output, setOutput]                       = useState<{
    content: string; seoData: Partial<SeoData>; assetId: string; title: string;
    provider?: string; model?: string; usedFallback?: boolean; fallbackFrom?: string | null;
    promptTemplateId?: string;
  } | null>(null);
  const [aiMode, setAiMode]                       = useState<"smart" | "manual">("smart");
  const [manualProvider, setManualProvider]       = useState<Provider>("gemini");
  const [manualModel, setManualModel]             = useState<ModelId>("gemini-2.5-pro");
  const [copied, copy]                            = useCopyText();

  const [libraryFilter, setLibraryFilter]         = useState("all");
  const [viewingAsset, setViewingAsset]           = useState<ContentAsset | null>(null);

  // ── Prompt Studio template state ────────────────────────────────────────────
  const [promptSource, setPromptSource]           = useState<"brief" | "template">("brief");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [templateVars, setTemplateVars]           = useState<Record<string, string>>({});

  const { data: assetsData, isLoading: assetsLoading } = useQuery({
    queryKey: ["growthmind-content-assets", libraryFilter],
    queryFn:  () => {
      const filter = libraryFilter;
      if (filter === "all")        return getAssetsFn({});
      if (filter === "favourites") return getAssetsFn({ favourites: true });
      const types = CATEGORY_TYPES[filter];
      if (!types) return getAssetsFn({});
      return getAssetsFn({});
    },
    staleTime: 30_000,
    enabled: tab === "library" || tab === "calendar",
  });

  const { data: statsData } = useQuery({
    queryKey: ["growthmind-content-stats"],
    queryFn:  () => getStatsFn(),
    staleTime: 60_000,
    enabled: tab === "library",
  });

  // ── Prompt Studio template queries ─────────────────────────────────────────
  const { data: promptTemplatesData } = useQuery({
    queryKey: ["content-studio-prompt-templates"],
    queryFn:  () => getTemplatesFn(),
    staleTime: 60_000,
    enabled:  tab === "generate" && promptSource === "template",
  });

  const { data: workspaceCtx } = useQuery({
    queryKey: ["content-studio-workspace-ctx"],
    queryFn:  () => getWorkspaceCtxFn(),
    staleTime: 120_000,
    enabled:  tab === "generate" && promptSource === "template",
  });

  // Filter templates to those relevant to the selected content type
  const relevantTemplates = useMemo<PromptTemplate[]>(() => {
    const templates = promptTemplatesData?.templates ?? [];
    if (!selectedType) return templates;
    const relevant = CONTENT_TYPE_TO_PROMPT_TYPES[selectedType] ?? [];
    if (relevant.length === 0) return templates;
    return templates.filter(t => relevant.includes(t.type));
  }, [promptTemplatesData, selectedType]);

  const selectedTemplate = useMemo<PromptTemplate | null>(
    () => relevantTemplates.find(t => t.id === selectedTemplateId) ?? null,
    [relevantTemplates, selectedTemplateId],
  );

  // Auto-hydrate template variables from workspace context + brief fields
  useEffect(() => {
    if (!selectedTemplate) { setTemplateVars({}); return; }
    const ctx = workspaceCtx ?? {};
    const briefHints: Record<string, string> = {
      business_name:   brief.businessType   ?? ctx.business_name   ?? "",
      target_audience: brief.targetAudience ?? ctx.target_audience ?? "",
      offer:           brief.offer          ?? "",
      call_to_action:  brief.cta            ?? "",
      brand_voice:     brief.tone           ?? ctx.brand_voice      ?? "",
      location:        brief.location       ?? ctx.location        ?? "",
      industry:        ctx.industry         ?? "",
    };
    const defaults: Record<string, string> = {};
    for (const v of selectedTemplate.variables) {
      defaults[v.name] = briefHints[v.name] || v.defaultValue || "";
    }
    setTemplateVars(defaults);
  }, [selectedTemplateId, workspaceCtx]);

  // Reset selected template when content type changes
  useEffect(() => {
    setSelectedTemplateId(null);
    setTemplateVars({});
  }, [selectedType]);

  // Derive filtered assets client-side for instant response
  const allAssets = assetsData?.assets ?? [];
  const filteredAssets = (() => {
    if (libraryFilter === "all")        return allAssets;
    if (libraryFilter === "favourites") return allAssets.filter(a => a.isFavourite);
    const types = CATEGORY_TYPES[libraryFilter];
    if (types) return allAssets.filter(a => types.includes(a.contentType));
    return allAssets;
  })();

  // Force fetch all assets when switching to library/calendar
  useEffect(() => {
    if (tab === "library" || tab === "calendar") {
      qc.invalidateQueries({ queryKey: ["growthmind-content-assets"] });
    }
  }, [tab]);

  function setB(field: string, value: string) {
    setBrief(b => ({ ...b, [field]: value }));
  }

  async function handleGenerate() {
    if (!selectedType) return;
    setGenerating(true);
    setGenError(null);
    setOutput(null);

    // Capture template info at call time (state may change during async)
    const usingTemplate  = promptSource === "template" && !!selectedTemplate;
    const capturedTplId  = usingTemplate ? selectedTemplate!.id   : undefined;
    const capturedTplVars: Record<string, string> = usingTemplate ? { ...templateVars } : {};

    // Compile template prompts if in template mode
    let systemPromptOverride: string | undefined;
    let userPromptOverride:   string | undefined;
    if (usingTemplate && selectedTemplate) {
      const fill = (text: string) =>
        text.replace(/\{\{(\w+)\}\}/g, (_, k) => capturedTplVars[k] ?? `[${k}]`);
      systemPromptOverride = fill(selectedTemplate.systemPrompt);
      userPromptOverride   = fill(selectedTemplate.userPromptTemplate);
    }

    try {
      const result = await generateFn({ data: {
        contentType:    selectedType,
        businessType:   brief.businessType   ?? "",
        targetAudience: brief.targetAudience ?? "",
        offer:          brief.offer          ?? "",
        goal:           brief.goal           ?? "awareness",
        keyword:        brief.keyword        ?? "",
        location:       brief.location       ?? "",
        platform:       brief.platform       ?? "",
        tone:           brief.tone           ?? "professional",
        cta:            brief.cta            ?? "",
        campaignType:   brief.campaignType   ?? "",
        length:         brief.length         ?? "medium",
        aiMode,
        provider:            aiMode === "manual" ? manualProvider : undefined,
        model:               aiMode === "manual" ? manualModel    : undefined,
        systemPromptOverride,
        userPromptOverride,
        promptTemplateId:    capturedTplId,
      }});
      setOutput({ ...result, promptTemplateId: capturedTplId });
      qc.invalidateQueries({ queryKey: ["growthmind-content-assets"] });
      qc.invalidateQueries({ queryKey: ["growthmind-content-stats"] });

      // Record usage in Prompt Studio when a template was used
      if (usingTemplate && capturedTplId) {
        recordUsageFn({ data: {
          templateId:     capturedTplId,
          inputVariables: capturedTplVars,
          outputText:     result.content,
          model:          result.model,
          provider:       result.provider,
        } }).catch(() => {});
        qc.invalidateQueries({ queryKey: ["content-studio-prompt-templates"] });
      }
    } catch (e: any) {
      setGenError(e.message ?? "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  async function handleDeleteAsset(id: string) {
    await deleteAssetFn({ data: { id } }).catch(() => {});
    qc.invalidateQueries({ queryKey: ["growthmind-content-assets"] });
    qc.invalidateQueries({ queryKey: ["growthmind-content-stats"] });
  }

  async function handleToggleFav(id: string, isFavourite: boolean) {
    await toggleFavFn({ data: { id, isFavourite } }).catch(() => {});
    qc.invalidateQueries({ queryKey: ["growthmind-content-assets"] });
  }

  async function handleStatusChange(id: string, status: ContentAsset["status"]) {
    const asset = allAssets.find(a => a.id === id);
    if (!asset) return;
    await saveAssetFn({ data: { ...asset, folderId: asset.folderId ?? undefined, scheduledAt: asset.scheduledAt ?? undefined, status } }).catch(() => {});
    qc.invalidateQueries({ queryKey: ["growthmind-content-assets"] });
  }

  async function handleSaveAsset(updated: ContentAsset) {
    await saveAssetFn({ data: {
      id:          updated.id,
      folderId:    updated.folderId ?? undefined,
      title:       updated.title,
      contentType: updated.contentType,
      content:     updated.content,
      brief:       updated.brief,
      seoData:     updated.seoData,
      status:      updated.status,
      isFavourite: updated.isFavourite,
      scheduledAt: updated.scheduledAt ?? undefined,
    } }).catch(() => {});
    qc.invalidateQueries({ queryKey: ["growthmind-content-assets"] });
    if (viewingAsset?.id === updated.id) setViewingAsset(updated);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <GrowthMindShell>
      {viewingAsset && (
        <AssetViewer
          asset={viewingAsset}
          onClose={() => setViewingAsset(null)}
          onSave={handleSaveAsset}
          onDelete={handleDeleteAsset}
        />
      )}

      <div className="flex flex-col h-full min-h-0">
        {/* Page header + tab bar */}
        <div className="px-6 pt-5 pb-0 shrink-0">
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <div>
              <h1 className="text-lg font-semibold flex items-center gap-2">
                <Wand2 className="h-5 w-5 text-emerald-400" />
                Content Studio
              </h1>
              <p className="text-xs text-muted-foreground mt-0.5">
                AI-powered marketing content — blogs, ads, emails, scripts, and more
              </p>
            </div>
            {statsData && statsData.total > 0 && (
              <div className="ml-auto flex items-center gap-4 text-xs text-muted-foreground">
                <span>{statsData.total} assets</span>
                <span>{statsData.published} published</span>
                <span>{statsData.favourites} favourites</span>
              </div>
            )}
          </div>

          <div className="flex gap-1 border-b border-white/[0.06]">
            {([
              { id: "generate", label: "Generate", icon: Sparkles },
              { id: "library",  label: "Library",  icon: Library },
              { id: "calendar", label: "Calendar", icon: CalendarDays },
            ] as const).map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors",
                  tab === t.id
                    ? "border-emerald-400 text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <t.icon className="h-3.5 w-3.5" />
                {t.label}
                {t.id === "library" && statsData && statsData.total > 0 && (
                  <span className="ml-0.5 rounded-full bg-white/[0.08] px-1.5 py-0.5 text-[9px] font-semibold">{statsData.total}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div className="flex-1 min-h-0 overflow-y-auto">

          {/* ── GENERATE TAB ────────────────────────────────────────────── */}
          {tab === "generate" && (
            <div className="px-6 py-5 max-w-5xl">
              {!output ? (
                <div className="space-y-6">
                  {/* Step 1: Content type picker */}
                  <div>
                    <p className="text-sm font-semibold mb-3">1. Choose content type</p>
                    <div className="space-y-4">
                      {CATEGORY_ORDER.map(cat => {
                        const types = CONTENT_TYPES.filter(t => t.category === cat);
                        return (
                          <div key={cat}>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/50 mb-2">
                              {CATEGORY_LABELS[cat]}
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {types.map(t => {
                                const Icon = t.icon;
                                const active = selectedType === t.id;
                                return (
                                  <button
                                    key={t.id}
                                    onClick={() => setSelectedType(active ? null : t.id)}
                                    className={cn(
                                      "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-all",
                                      active
                                        ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                                        : "border-white/[0.06] bg-white/[0.02] text-muted-foreground hover:border-white/[0.12] hover:text-foreground",
                                    )}
                                  >
                                    <Icon className={cn("h-3.5 w-3.5 shrink-0", active ? "text-emerald-400" : t.color)} />
                                    {t.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Step 2: AI Mode */}
                  {selectedType && (() => {
                    const smartRoute = getSmartRoute(selectedType);
                    const smartMeta  = MODEL_META[smartRoute.model];
                    const providerModels = PROVIDERS.find(p => p.id === manualProvider)?.models ?? [];
                    const manualMeta     = MODEL_META[manualModel];
                    return (
                      <div>
                        <p className="text-sm font-semibold mb-3">2. AI Mode</p>
                        <div className="rounded-xl border border-white/[0.06] bg-card/60 p-4 space-y-3">
                          {/* Toggle */}
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => setAiMode("smart")}
                              className={cn(
                                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all border",
                                aiMode === "smart"
                                  ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                                  : "bg-white/[0.02] border-white/[0.06] text-muted-foreground hover:text-foreground",
                              )}
                            >
                              <Zap className="h-3 w-3" />
                              Smart Routing
                            </button>
                            <button
                              onClick={() => setAiMode("manual")}
                              className={cn(
                                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all border",
                                aiMode === "manual"
                                  ? "bg-blue-500/15 border-blue-500/40 text-blue-300"
                                  : "bg-white/[0.02] border-white/[0.06] text-muted-foreground hover:text-foreground",
                              )}
                            >
                              <SlidersHorizontal className="h-3 w-3" />
                              Manual
                            </button>
                          </div>

                          {/* Smart routing — show selected model */}
                          {aiMode === "smart" && (
                            <div className="flex items-center gap-2 text-xs">
                              <Cpu className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                              <span className="text-muted-foreground">Best model for this content:</span>
                              <span className="font-medium text-foreground">{smartMeta.label}</span>
                              <span className="text-muted-foreground/60">·</span>
                              <span className="text-muted-foreground">{smartMeta.bestFor}</span>
                              <span className={cn(
                                "ml-auto rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
                                smartMeta.tier === "premium" ? "bg-amber-500/15 text-amber-300" : "bg-white/[0.06] text-muted-foreground",
                              )}>{smartMeta.tier}</span>
                            </div>
                          )}

                          {/* Manual — provider + model dropdowns */}
                          {aiMode === "manual" && (
                            <div className="space-y-3">
                              <div className="grid grid-cols-2 gap-3">
                                <div>
                                  <p className="text-[10px] font-medium text-muted-foreground mb-1.5">Provider</p>
                                  <div className="flex flex-wrap gap-1.5">
                                    {PROVIDERS.map(p => (
                                      <button
                                        key={p.id}
                                        onClick={() => {
                                          setManualProvider(p.id);
                                          setManualModel(p.models[0]);
                                        }}
                                        className={cn(
                                          "rounded px-2.5 py-1 text-xs font-medium border transition-all",
                                          manualProvider === p.id
                                            ? "bg-blue-500/15 border-blue-500/40 text-blue-300"
                                            : "bg-white/[0.02] border-white/[0.06] text-muted-foreground hover:text-foreground",
                                        )}
                                      >
                                        {p.label}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                                <div>
                                  <p className="text-[10px] font-medium text-muted-foreground mb-1.5">Model</p>
                                  <div className="flex flex-wrap gap-1.5">
                                    {providerModels.map(m => (
                                      <button
                                        key={m}
                                        onClick={() => setManualModel(m)}
                                        className={cn(
                                          "rounded px-2.5 py-1 text-xs font-medium border transition-all",
                                          manualModel === m
                                            ? "bg-blue-500/15 border-blue-500/40 text-blue-300"
                                            : "bg-white/[0.02] border-white/[0.06] text-muted-foreground hover:text-foreground",
                                        )}
                                      >
                                        {MODEL_META[m].label}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              </div>
                              {manualMeta && (
                                <div className="rounded-lg bg-white/[0.02] border border-white/[0.04] px-3 py-2 grid grid-cols-4 gap-2 text-xs">
                                  <div>
                                    <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wide mb-0.5">Best For</p>
                                    <p className="text-muted-foreground leading-tight">{manualMeta.bestFor}</p>
                                  </div>
                                  <div>
                                    <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wide mb-0.5">Speed</p>
                                    <p className="text-foreground">{manualMeta.speed}</p>
                                  </div>
                                  <div>
                                    <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wide mb-0.5">Cost</p>
                                    <p className="text-foreground">{manualMeta.cost}</p>
                                  </div>
                                  <div>
                                    <p className="text-[9px] text-muted-foreground/50 uppercase tracking-wide mb-0.5">Quality</p>
                                    <p className={manualMeta.tier === "premium" ? "text-amber-300" : "text-muted-foreground"}>
                                      {manualMeta.tier === "premium" ? "Premium" : "Good"}
                                    </p>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Step 3: Brief / Template */}
                  {selectedType && (
                    <div>
                      {/* Step header + prompt source toggle */}
                      <div className="flex items-center gap-3 mb-3 flex-wrap">
                        <p className="text-sm font-semibold">3. Content brief</p>
                        <div className="flex items-center gap-1 rounded-lg border border-white/[0.06] bg-white/[0.02] p-0.5 ml-auto">
                          <button
                            onClick={() => setPromptSource("brief")}
                            className={cn(
                              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                              promptSource === "brief"
                                ? "bg-emerald-500/15 text-emerald-300"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            <FileText className="h-3 w-3" />
                            Standard Brief
                          </button>
                          <button
                            onClick={() => setPromptSource("template")}
                            className={cn(
                              "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                              promptSource === "template"
                                ? "bg-violet-500/15 text-violet-300"
                                : "text-muted-foreground hover:text-foreground",
                            )}
                          >
                            <BookMarked className="h-3 w-3" />
                            Prompt Studio Template
                          </button>
                        </div>
                      </div>

                      <div className="rounded-xl border border-white/[0.06] bg-card/60 p-5 space-y-4">

                        {/* ── Standard Brief ── */}
                        {promptSource === "brief" && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <TextField
                              label="Business Type"
                              value={brief.businessType ?? ""}
                              placeholder="e.g. Solar installation company"
                              onChange={v => setB("businessType", v)}
                            />
                            <TextField
                              label="Target Audience"
                              value={brief.targetAudience ?? ""}
                              placeholder="e.g. Homeowners aged 35–60 in Manchester"
                              onChange={v => setB("targetAudience", v)}
                            />
                            <TextField
                              label="Offer"
                              value={brief.offer ?? ""}
                              placeholder="e.g. Free solar survey — save £1,200/yr"
                              onChange={v => setB("offer", v)}
                            />
                            <SelectField
                              label="Goal"
                              value={brief.goal ?? ""}
                              options={GOAL_OPTIONS}
                              onChange={v => setB("goal", v)}
                            />
                            <TextField
                              label="Primary Keyword"
                              value={brief.keyword ?? ""}
                              placeholder="e.g. solar panels Manchester"
                              onChange={v => setB("keyword", v)}
                            />
                            <TextField
                              label="Location"
                              value={brief.location ?? ""}
                              placeholder="e.g. Manchester, UK"
                              onChange={v => setB("location", v)}
                            />
                            <TextField
                              label="Call to Action"
                              value={brief.cta ?? ""}
                              placeholder="e.g. Book your free survey today"
                              onChange={v => setB("cta", v)}
                            />
                            <SelectField
                              label="Tone of Voice"
                              value={brief.tone ?? "professional"}
                              options={TONE_OPTIONS}
                              onChange={v => setB("tone", v)}
                            />
                            <TextField
                              label="Campaign Type (optional)"
                              value={brief.campaignType ?? ""}
                              placeholder="e.g. Spring promotion, Lead gen"
                              onChange={v => setB("campaignType", v)}
                            />
                            <SelectField
                              label="Length"
                              value={brief.length ?? "medium"}
                              options={LENGTH_OPTIONS}
                              onChange={v => setB("length", v)}
                            />
                          </div>
                        )}

                        {/* ── Prompt Studio Template ── */}
                        {promptSource === "template" && (
                          <div className="space-y-4">
                            {/* Template picker */}
                            <div className="space-y-1.5">
                              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
                                Select a Prompt Studio template
                              </Label>
                              {relevantTemplates.length === 0 && !promptTemplatesData && (
                                <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                                  <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-400" />
                                  Loading templates…
                                </div>
                              )}
                              {promptTemplatesData && relevantTemplates.length === 0 && (
                                <div className="rounded-lg border border-violet-500/20 bg-violet-500/[0.04] px-4 py-3 text-xs text-muted-foreground">
                                  No Prompt Studio templates match this content type yet. Create templates in{" "}
                                  <span className="text-violet-300 font-medium">Prompt Studio</span> and they'll appear here.
                                </div>
                              )}
                              {relevantTemplates.length > 0 && (
                                <select
                                  value={selectedTemplateId ?? ""}
                                  onChange={e => setSelectedTemplateId(e.target.value || null)}
                                  className="w-full h-8 rounded-md border border-input bg-transparent px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                                >
                                  <option value="">— choose a template —</option>
                                  {relevantTemplates.map(t => (
                                    <option key={t.id} value={t.id}>
                                      {t.name}
                                      {t.stats?.usageCount ? ` (used ${t.stats.usageCount}×)` : ""}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>

                            {/* Template details + variables */}
                            {selectedTemplate && (
                              <>
                                {/* Template info badge */}
                                <div className="flex items-start gap-3 rounded-lg border border-violet-500/20 bg-violet-500/[0.04] p-3">
                                  <FlaskConical className="h-4 w-4 text-violet-400 shrink-0 mt-0.5" />
                                  <div className="min-w-0">
                                    <p className="text-xs font-medium text-violet-200 mb-0.5">{selectedTemplate.name}</p>
                                    {selectedTemplate.description && (
                                      <p className="text-[11px] text-muted-foreground leading-relaxed">{selectedTemplate.description}</p>
                                    )}
                                    {(selectedTemplate.stats?.usageCount ?? 0) > 0 && (
                                      <p className="text-[10px] text-violet-400/70 mt-1">
                                        Used {selectedTemplate.stats!.usageCount}× ·{" "}
                                        avg score {selectedTemplate.stats!.avgScore?.toFixed(1) ?? "—"}/10
                                      </p>
                                    )}
                                  </div>
                                </div>

                                {/* Variable inputs */}
                                {selectedTemplate.variables.length > 0 && (
                                  <div>
                                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 mb-2.5">
                                      Template Variables
                                      <span className="ml-1.5 text-muted-foreground/40 normal-case tracking-normal">
                                        — pre-filled from your workspace, edit as needed
                                      </span>
                                    </p>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                      {selectedTemplate.variables.map(v => (
                                        <div key={v.name} className="space-y-1">
                                          <Label className="text-[10px] uppercase tracking-wider text-muted-foreground/70 flex items-center gap-1.5">
                                            {v.name.replace(/_/g, " ")}
                                            {templateVars[v.name] ? (
                                              <span className="text-emerald-400/60 font-normal normal-case tracking-normal">✓ filled</span>
                                            ) : (
                                              <span className="text-amber-400/60 font-normal normal-case tracking-normal">empty</span>
                                            )}
                                          </Label>
                                          <Input
                                            value={templateVars[v.name] ?? ""}
                                            onChange={e => setTemplateVars(prev => ({ ...prev, [v.name]: e.target.value }))}
                                            placeholder={v.description || v.defaultValue || v.name}
                                            className="h-8 text-xs"
                                          />
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        )}

                        {/* Generate button — shared for both modes */}
                        <div className="pt-2 flex items-center gap-3 flex-wrap">
                          <Button
                            onClick={handleGenerate}
                            disabled={
                              generating || !selectedType ||
                              (promptSource === "template" && !selectedTemplate)
                            }
                            className="h-9"
                          >
                            {generating
                              ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Generating…</>
                              : <><Wand2 className="mr-2 h-4 w-4" />Generate {typeDef(selectedType!).label}</>
                            }
                          </Button>
                          {promptSource === "template" && !selectedTemplate && !generating && (
                            <p className="text-xs text-muted-foreground/60">Select a template above to continue</p>
                          )}
                          {generating && (
                            <p className="text-xs text-muted-foreground animate-pulse">
                              {promptSource === "template"
                                ? "GrowthMind is generating using your Prompt Studio template…"
                                : "GrowthMind is creating your content using company knowledge, keywords, and competitor data…"}
                            </p>
                          )}
                        </div>

                        {genError && (
                          <div className="rounded-lg border border-red-500/20 bg-red-500/[0.05] px-4 py-3 text-sm text-red-400">
                            {genError}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* Output panel */
                <div className="space-y-5">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div>
                      <p className="text-sm font-semibold">{output.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {typeDef(selectedType!).label} · Saved to Library automatically
                        <Check className="inline ml-1 h-3 w-3 text-emerald-400" />
                      </p>
                      {output.promptTemplateId && selectedTemplate && (
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <BookMarked className="h-3 w-3 text-violet-400 shrink-0" />
                          <span className="text-[10px] text-muted-foreground/60">
                            Generated using Prompt Studio template{" "}
                            <span className="text-violet-300 font-medium">{selectedTemplate.name}</span>
                            {" "}· usage recorded
                          </span>
                        </div>
                      )}
                      {output.model && (
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <Cpu className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                          <span className="text-[10px] text-muted-foreground/60">
                            Generated with <span className="text-muted-foreground font-medium">{MODEL_META[output.model as ModelId]?.label ?? output.model}</span>
                            {output.usedFallback && output.fallbackFrom && (
                              <span className="text-amber-400/70"> · Fallback from {output.fallbackFrom.split("/")[1]}</span>
                            )}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="ml-auto flex items-center gap-2 flex-wrap">
                      <Button
                        variant="outline" size="sm"
                        onClick={() => copy(output.content)}
                      >
                        {copied ? <><Check className="mr-1.5 h-3.5 w-3.5 text-emerald-400" />Copied</> : <><Copy className="mr-1.5 h-3.5 w-3.5" />Copy</>}
                      </Button>
                      {(selectedType === "meta_ad" || selectedType === "google_ad") && (
                        <Button
                          variant="outline" size="sm"
                          className="border-rose-500/30 text-rose-300 hover:bg-rose-500/10 hover:border-rose-400/50"
                          onClick={() => window.open("/__mockup/preview/AdVideoTemplate", "_blank")}
                        >
                          <Clapperboard className="mr-1.5 h-3.5 w-3.5" />Video Ad
                        </Button>
                      )}
                      {selectedType === "meta_ad" && output.assetId && (
                        <MetaPublishFromOutput content={output.content} title={output.title} />
                      )}
                      <Button
                        variant="outline" size="sm"
                        onClick={() => { setOutput(null); }}
                      >
                        <Plus className="mr-1.5 h-3.5 w-3.5" />
                        New content
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => { setTab("library"); setOutput(null); }}
                      >
                        <Library className="mr-1.5 h-3.5 w-3.5" />
                        View in Library
                      </Button>
                    </div>
                  </div>

                  <div className={cn("gap-5", output.seoData && Object.keys(output.seoData).length > 0 ? "grid grid-cols-1 lg:grid-cols-3" : "")}>
                    <div className={output.seoData && Object.keys(output.seoData).length > 0 ? "lg:col-span-2" : ""}>
                      <div className="rounded-xl border border-white/[0.06] bg-card/60 overflow-hidden">
                        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]">
                          <p className="text-xs font-semibold">Generated Content</p>
                        </div>
                        <pre className="whitespace-pre-wrap text-sm leading-relaxed p-5 font-sans text-foreground/90 overflow-x-auto">
                          {output.content}
                        </pre>
                      </div>
                    </div>

                    {output.seoData && Object.keys(output.seoData).length > 0 && (
                      <div className="lg:col-span-1">
                        <SeoPanel seoData={output.seoData} />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── LIBRARY TAB ─────────────────────────────────────────────── */}
          {tab === "library" && (
            <div className="flex h-full min-h-[600px]">
              {/* Filter sidebar */}
              <aside className="w-44 shrink-0 border-r border-white/[0.06] py-4 overflow-y-auto">
                <nav className="flex flex-col gap-0.5 px-2">
                  {LIBRARY_FILTERS.map(f => {
                    const Icon = f.icon;
                    const active = libraryFilter === f.id;
                    const count = f.id === "all" ? allAssets.length
                      : f.id === "favourites" ? allAssets.filter(a => a.isFavourite).length
                      : (CATEGORY_TYPES[f.id] ? allAssets.filter(a => CATEGORY_TYPES[f.id].includes(a.contentType)).length : 0);
                    return (
                      <button
                        key={f.id}
                        onClick={() => setLibraryFilter(f.id)}
                        className={cn(
                          "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors",
                          active
                            ? "bg-emerald-500/15 text-emerald-300"
                            : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
                        )}
                      >
                        <Icon className={cn("h-3.5 w-3.5 shrink-0", active && "text-emerald-400")} />
                        <span className="truncate">{f.label}</span>
                        {count > 0 && (
                          <span className="ml-auto text-[9px] text-muted-foreground/50">{count}</span>
                        )}
                      </button>
                    );
                  })}
                </nav>
              </aside>

              {/* Asset grid */}
              <div className="flex-1 min-w-0 p-5 overflow-y-auto">
                {assetsLoading ? (
                  <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
                    <span className="text-sm">Loading library…</span>
                  </div>
                ) : filteredAssets.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-20 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/20 mb-4">
                      <Library className="h-6 w-6 text-emerald-400" />
                    </div>
                    <p className="text-sm font-medium mb-1">No content here yet</p>
                    <p className="text-xs text-muted-foreground mb-4">
                      {libraryFilter === "favourites"
                        ? "Star content to see it here."
                        : "Generate content to start building your library."}
                    </p>
                    <Button size="sm" onClick={() => setTab("generate")}>
                      <Wand2 className="mr-1.5 h-3.5 w-3.5" />
                      Generate content
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredAssets.map(asset => (
                      <AssetCard
                        key={asset.id}
                        asset={asset}
                        onView={setViewingAsset}
                        onDelete={handleDeleteAsset}
                        onToggleFav={handleToggleFav}
                        onStatusChange={handleStatusChange}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── CALENDAR TAB ────────────────────────────────────────────── */}
          {tab === "calendar" && (
            <CalendarTab assets={allAssets} />
          )}
        </div>
      </div>
    </GrowthMindShell>
  );
}
