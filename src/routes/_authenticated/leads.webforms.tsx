import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  Globe, Plus, Copy, Check, Trash2, Settings, Eye, EyeOff,
  ExternalLink, Loader2, ChevronDown, ChevronUp, Code, Mail,
  AlertCircle, RefreshCw, Zap, BarChart3, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  listWebformSources, createWebformSource, updateWebformSource,
  deleteWebformSource, listWebformSubmissions, getWebformStats,
} from "@/lib/lead-gen/webforms.functions";

export const Route = createFileRoute("/_authenticated/leads/webforms")({
  head: () => ({ meta: [{ title: "Webforms — WEBEE Leads" }] }),
  component: WebformsPage,
});

const SOURCE_TYPE_OPTIONS = [
  "website_form", "landing_page", "facebook_lead_form", "google_ads_lead_form",
  "tiktok_lead_form", "linkedin_lead_form", "zapier", "make", "custom_form",
];

function getPublicBase() {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : "https://webeebuilder.com";
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <button
      onClick={copy}
      className={cn(
        "flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-all",
        copied
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
          : "border-white/[0.12] bg-white/[0.04] text-muted-foreground hover:text-foreground hover:bg-white/[0.08]",
      )}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied!" : label}
    </button>
  );
}

function CreateFormDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (v: any) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [sourceType, setSourceType] = useState("website_form");
  const [sourceDetail, setSourceDetail] = useState("");
  const [notifyEmail, setNotifyEmail] = useState("");
  const [domains, setDomains] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onCreate({
        name: name.trim(),
        default_source_type: sourceType,
        default_source_detail: sourceDetail.trim() || undefined,
        notify_email: notifyEmail.trim() || undefined,
        allowed_domains: domains.split(",").map(d => d.trim()).filter(Boolean),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
      <div className="w-full max-w-md rounded-2xl border border-white/[0.09] bg-[hsl(var(--card))] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-4">
          <p className="font-semibold text-sm">New Webform Endpoint</p>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={submit} className="px-5 py-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">Form Name *</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Homepage Contact Form"
              className="w-full rounded-lg border border-white/[0.1] bg-white/[0.03] px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
              required
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">Source Type</label>
            <select
              value={sourceType}
              onChange={e => setSourceType(e.target.value)}
              className="w-full rounded-lg border border-white/[0.1] bg-[hsl(var(--background))] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-violet-500/50"
            >
              {SOURCE_TYPE_OPTIONS.map(t => (
                <option key={t} value={t}>{t.replace(/_/g, " ")}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">Source Detail <span className="text-muted-foreground/50">(optional)</span></label>
            <input
              value={sourceDetail}
              onChange={e => setSourceDetail(e.target.value)}
              placeholder="e.g. contact_page, demo_request"
              className="w-full rounded-lg border border-white/[0.1] bg-white/[0.03] px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">Notification Email <span className="text-muted-foreground/50">(optional)</span></label>
            <input
              type="email"
              value={notifyEmail}
              onChange={e => setNotifyEmail(e.target.value)}
              placeholder="notifications@yourcompany.com"
              className="w-full rounded-lg border border-white/[0.1] bg-white/[0.03] px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5 block">Allowed Domains <span className="text-muted-foreground/50">(comma-separated, optional)</span></label>
            <input
              value={domains}
              onChange={e => setDomains(e.target.value)}
              placeholder="yoursite.com, anotherdomain.co.uk"
              className="w-full rounded-lg border border-white/[0.1] bg-white/[0.03] px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
            />
            <p className="text-[10px] text-muted-foreground/50 mt-1">Leave blank to allow submissions from any domain.</p>
          </div>
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-white/[0.1] py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving || !name.trim()} className="flex-1 rounded-lg bg-violet-600 hover:bg-violet-700 py-2 text-sm font-semibold text-white transition-all disabled:opacity-40 flex items-center justify-center gap-2">
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SubmissionsPanel({ sourceId, onClose }: { sourceId: string; onClose: () => void }) {
  const listFn = useServerFn(listWebformSubmissions);
  const { data, isLoading } = useQuery({
    queryKey: ["webform-submissions", sourceId],
    queryFn: () => listFn({ data: { webformSourceId: sourceId, limit: 50 } }),
    staleTime: 30_000,
    throwOnError: false,
  });
  const submissions = data?.submissions ?? [];

  return (
    <div className="mt-4 rounded-xl border border-white/[0.07] bg-white/[0.02]">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
        <p className="text-xs font-semibold">Recent Submissions</p>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
      </div>
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : submissions.length === 0 ? (
        <div className="py-8 text-center text-xs text-muted-foreground">No submissions yet</div>
      ) : (
        <div className="divide-y divide-white/[0.05] max-h-80 overflow-y-auto">
          {submissions.map((s: any) => (
            <div key={s.id} className="px-4 py-3">
              <div className="flex items-center gap-2 mb-1">
                <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded border",
                  s.status === "processed" ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" :
                  s.status === "duplicate" ? "text-amber-400 bg-amber-500/10 border-amber-500/20" :
                  s.status === "spam"      ? "text-red-400 bg-red-500/10 border-red-500/20" :
                  "text-muted-foreground bg-white/[0.04] border-white/[0.08]"
                )}>{s.status}</span>
                <span className="text-[10px] text-muted-foreground/50">{new Date(s.created_at).toLocaleString()}</span>
                {s.utm_source && <span className="text-[10px] text-blue-400/60">{s.utm_source}</span>}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                {Object.entries(s.mapped_payload ?? {})
                  .filter(([k]) => ["full_name","email","phone","company_name"].includes(k))
                  .map(([k, v]) => (
                    <span key={k} className="text-xs text-foreground/70"><span className="text-muted-foreground/50">{k.replace(/_/g," ")}:</span> {String(v)}</span>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WebformCard({ source, onDelete, onRefresh }: { source: any; onDelete: (id: string) => void; onRefresh: () => void }) {
  const [open, setOpen] = useState(false);
  const [showSubmissions, setShowSubmissions] = useState(false);
  const [showEmbed, setShowEmbed] = useState(false);
  const base = getPublicBase();
  const endpointUrl = `${base}/api/public/webforms/${source.form_token}`;

  const embedHtml = `<!-- WEBEE Webform - ${source.name} -->
<form action="${endpointUrl}" method="POST">
  <input type="text"   name="full_name"    placeholder="Your Name"    required />
  <input type="email"  name="email"        placeholder="Email Address" required />
  <input type="tel"    name="phone"        placeholder="Phone Number" />
  <input type="text"   name="company_name" placeholder="Company" />
  <textarea            name="message"      placeholder="Message"></textarea>
  <!-- Honeypot (hidden) -->
  <input type="text" name="_hp" style="display:none" tabindex="-1" autocomplete="off" />
  <button type="submit">Send</button>
</form>`;

  return (
    <div className={cn("rounded-xl border bg-[hsl(var(--card))] transition-all",
      source.status === "active" ? "border-white/[0.09]" : "border-white/[0.04] opacity-60"
    )}>
      <div className="flex items-start gap-3 p-4">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/15 ring-1 ring-blue-500/25 mt-0.5">
          <Globe className="h-4 w-4 text-blue-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <p className="font-semibold text-sm">{source.name}</p>
            <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded border",
              source.status === "active" ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" :
              "text-muted-foreground bg-white/[0.04] border-white/[0.08]"
            )}>{source.status}</span>
            <span className="text-[10px] text-muted-foreground/50 bg-white/[0.03] border border-white/[0.06] px-1.5 py-0.5 rounded">
              {source.default_source_type}
            </span>
          </div>
          <div className="flex items-center gap-1 mt-1">
            <code className="text-[10px] text-violet-400/80 bg-violet-500/[0.06] border border-violet-500/15 px-2 py-0.5 rounded font-mono truncate max-w-xs">
              {endpointUrl}
            </code>
          </div>
          {source.notify_email && (
            <p className="text-[10px] text-muted-foreground/50 mt-0.5 flex items-center gap-1">
              <Mail className="h-2.5 w-2.5" /> {source.notify_email}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <CopyButton text={endpointUrl} />
          <button
            onClick={() => setOpen(o => !o)}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/[0.04] transition-colors"
          >
            {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-white/[0.06] px-4 py-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <button
              onClick={() => { setShowSubmissions(s => !s); setShowEmbed(false); }}
              className={cn("flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-all",
                showSubmissions ? "border-blue-500/30 bg-blue-500/10 text-blue-400" : "border-white/[0.1] text-muted-foreground hover:text-foreground hover:bg-white/[0.04]"
              )}
            >
              <Eye className="h-3.5 w-3.5" /> View Submissions
            </button>
            <button
              onClick={() => { setShowEmbed(s => !s); setShowSubmissions(false); }}
              className={cn("flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-all",
                showEmbed ? "border-violet-500/30 bg-violet-500/10 text-violet-400" : "border-white/[0.1] text-muted-foreground hover:text-foreground hover:bg-white/[0.04]"
              )}
            >
              <Code className="h-3.5 w-3.5" /> Embed Code
            </button>
            <button
              onClick={() => onDelete(source.id)}
              className="flex items-center gap-1.5 rounded-lg border border-red-500/20 px-3 py-2 text-xs font-medium text-red-400/70 hover:text-red-400 hover:bg-red-500/10 transition-all"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          </div>

          {source.allowed_domains?.length > 0 && (
            <div>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Allowed Domains</p>
              <div className="flex flex-wrap gap-1">
                {source.allowed_domains.map((d: string) => (
                  <span key={d} className="text-[10px] bg-white/[0.03] border border-white/[0.07] px-2 py-0.5 rounded text-foreground/70">{d}</span>
                ))}
              </div>
            </div>
          )}

          {showEmbed && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">HTML Embed Snippet</p>
                <CopyButton text={embedHtml} label="Copy HTML" />
              </div>
              <pre className="text-[10px] bg-black/30 border border-white/[0.07] rounded-lg p-3 overflow-x-auto text-foreground/70 font-mono leading-relaxed">
                {embedHtml}
              </pre>
              <div className="mt-3 rounded-lg border border-blue-500/15 bg-blue-500/[0.04] p-3">
                <p className="text-[11px] text-blue-400 font-medium mb-1">Connect via Zapier / Make</p>
                <p className="text-[11px] text-muted-foreground/70">Use a <strong>Webhook</strong> action and POST JSON to:</p>
                <code className="text-[10px] text-violet-400 font-mono mt-1 block">{endpointUrl}</code>
              </div>
            </div>
          )}

          {showSubmissions && <SubmissionsPanel sourceId={source.id} onClose={() => setShowSubmissions(false)} />}
        </div>
      )}
    </div>
  );
}

function WebformsPage() {
  const qc = useQueryClient();
  const listFn   = useServerFn(listWebformSources);
  const createFn = useServerFn(createWebformSource);
  const deleteFn = useServerFn(deleteWebformSource);
  const statsFn  = useServerFn(getWebformStats);
  const [showCreate, setShowCreate] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["webform-sources"],
    queryFn: () => listFn(),
    staleTime: 60_000,
    throwOnError: false,
  });
  const { data: statsData } = useQuery({
    queryKey: ["webform-stats"],
    queryFn: () => statsFn(),
    staleTime: 120_000,
    throwOnError: false,
  });

  const sources = data?.sources ?? [];
  const stats = statsData ?? { activeForms: 0, leads30d: 0, duplicates30d: 0, total30d: 0 };

  async function handleCreate(v: any) {
    await createFn({ data: v });
    await refetch();
    qc.invalidateQueries({ queryKey: ["webform-stats"] });
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this webform endpoint? All submission history will be removed.")) return;
    setDeleting(id);
    try { await deleteFn({ data: { id } }); await refetch(); }
    finally { setDeleting(null); }
  }

  const base = getPublicBase();

  return (
    <div className="min-h-screen bg-[hsl(var(--background))]">
      {/* Header */}
      <div className="sticky top-0 z-20 border-b border-white/[0.07] bg-[hsl(var(--background))]/95 backdrop-blur-sm px-5 py-3 flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/20 ring-1 ring-blue-500/30 shrink-0">
          <Globe className="h-4 w-4 text-blue-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">Webform Connectors</p>
          <p className="text-[11px] text-muted-foreground">Capture leads from your website, WordPress, Webflow, Zapier and more</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white transition-all"
        >
          <Plus className="h-3.5 w-3.5" />
          New Form
        </button>
      </div>

      <div className="px-5 py-6 space-y-6">
        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Active Forms",    value: stats.activeForms, icon: Globe,     color: "text-blue-400" },
            { label: "Leads (30d)",     value: stats.leads30d,    icon: Zap,       color: "text-emerald-400" },
            { label: "Duplicates (30d)",value: stats.duplicates30d,icon: RefreshCw, color: "text-amber-400" },
            { label: "Total (30d)",     value: stats.total30d,    icon: BarChart3, color: "text-violet-400" },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="rounded-xl border border-white/[0.07] bg-[hsl(var(--card))] px-4 py-3">
              <div className="flex items-center gap-2 mb-1">
                <Icon className={cn("h-3.5 w-3.5", color)} />
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
              </div>
              <p className="text-xl font-bold">{value}</p>
            </div>
          ))}
        </div>

        {/* How it works */}
        <div className="rounded-xl border border-blue-500/15 bg-blue-500/[0.04] p-4">
          <p className="text-xs font-semibold text-blue-400 mb-2">How to connect your website form</p>
          <ol className="space-y-1.5">
            {[
              "Create a Webform Endpoint below.",
              `Set your form's action URL to: ${base}/api/public/webforms/{your-token}`,
              "Set method=\"POST\" and add name attributes matching: full_name, email, phone, company_name, message.",
              "Optionally use Zapier or Make — send a POST webhook with the same fields.",
              "Every submission creates a lead in your WEBEE Leads section.",
            ].map((step, i) => (
              <li key={i} className="flex gap-2 text-[11px] text-foreground/70">
                <span className="text-blue-400 font-semibold shrink-0 w-4">{i + 1}.</span>
                {step}
              </li>
            ))}
          </ol>
        </div>

        {/* Forms list */}
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />Loading…
          </div>
        ) : sources.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="h-12 w-12 rounded-full bg-blue-500/10 flex items-center justify-center mb-3">
              <Globe className="h-5 w-5 text-blue-400" />
            </div>
            <p className="text-sm font-medium">No webform endpoints yet</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs">
              Create a webform endpoint and connect it to your website, WordPress, Webflow, or any form tool.
            </p>
            <button
              onClick={() => setShowCreate(true)}
              className="mt-4 flex items-center gap-1.5 rounded-lg bg-blue-500/15 border border-blue-500/30 px-4 py-2 text-xs font-medium text-blue-400 hover:bg-blue-500/25 transition-all"
            >
              <Plus className="h-3.5 w-3.5" /> Create your first endpoint
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {sources.map((s: any) => (
              <WebformCard
                key={s.id}
                source={s}
                onDelete={handleDelete}
                onRefresh={refetch}
              />
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateFormDialog
          onClose={() => setShowCreate(false)}
          onCreate={handleCreate}
        />
      )}
    </div>
  );
}
