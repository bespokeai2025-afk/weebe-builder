import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Mail, Plus, Trash2, Send, Loader2, Sparkles, RefreshCw,
  CheckCircle, XCircle, Clock, Edit2, X, Users, Flame,
  ChevronRight, AlertTriangle, BarChart3, Calendar,
  Play, Pause, TrendingUp, Copy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GrowthMindShell } from "./GrowthMindShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  listEmailCampaigns,
  saveEmailCampaign,
  deleteEmailCampaign,
  generateEmailDraft,
  sendEmailCampaign,
  getCrmSegments,
  listDomainWarmups,
  createDomainWarmup,
  updateWarmupDay,
  updateWarmupStatus,
  type EmailCampaign,
  type DomainWarmup,
  type AudienceSegment,
} from "@/lib/growthmind/growthmind.email-campaigns";

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  draft:     "bg-slate-500/15 text-slate-400 border-slate-500/20",
  scheduled: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  sending:   "bg-amber-500/15 text-amber-400 border-amber-500/20",
  sent:      "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  failed:    "bg-red-500/15 text-red-400 border-red-500/20",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={cn(
      "rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize",
      STATUS_COLORS[status] ?? STATUS_COLORS.draft,
    )}>
      {status}
    </span>
  );
}

// ── Tab types ─────────────────────────────────────────────────────────────────

type Tab = "campaigns" | "warmup" | "audience";

// ── AI Draft Modal ────────────────────────────────────────────────────────────

function AiDraftModal({
  onClose,
  onApply,
}: {
  onClose:  () => void;
  onApply:  (draft: any) => void;
}) {
  const genFn = useServerFn(generateEmailDraft);
  const [goal,     setGoal]     = useState("");
  const [audience, setAudience] = useState("");
  const [offer,    setOffer]    = useState("");
  const [tone,     setTone]     = useState<"professional"|"friendly"|"urgent"|"storytelling">("professional");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string|null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const draft = await genFn({ data: { goal, audience, offer, tone } });
      onApply(draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg rounded-2xl border border-white/[0.08] bg-[#0f1117] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-emerald-400" />
            <p className="text-sm font-semibold">AI Email Draft</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Campaign Goal</Label>
            <Input
              placeholder="e.g. Promote our summer offer, re-engage lapsed clients…"
              value={goal}
              onChange={e => setGoal(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Target Audience</Label>
            <Input
              placeholder="e.g. Existing customers, cold leads, local businesses…"
              value={audience}
              onChange={e => setAudience(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Offer / Key Message</Label>
            <Input
              placeholder="e.g. 20% off this month, free consultation, new product launch…"
              value={offer}
              onChange={e => setOffer(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Tone</Label>
            <div className="grid grid-cols-2 gap-2">
              {(["professional","friendly","urgent","storytelling"] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTone(t)}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-xs capitalize transition-colors",
                    tone === t
                      ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                      : "border-white/[0.08] text-muted-foreground hover:border-white/20",
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {error}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-white/[0.06]">
          <Button variant="ghost" size="sm" onClick={onClose} className="text-xs h-8">Cancel</Button>
          <Button
            size="sm"
            onClick={generate}
            disabled={loading}
            className="h-8 text-xs bg-emerald-600 hover:bg-emerald-500 text-white gap-1.5"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {loading ? "Generating…" : "Generate Draft"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Campaign Editor Modal ─────────────────────────────────────────────────────

function CampaignEditor({
  campaign,
  onClose,
  onSaved,
}: {
  campaign:  Partial<EmailCampaign> | null;
  onClose:   () => void;
  onSaved:   () => void;
}) {
  const saveFn     = useServerFn(saveEmailCampaign);
  const sendFn     = useServerFn(sendEmailCampaign);
  const segmentsFn = useServerFn(getCrmSegments);
  const qc         = useQueryClient();

  const [name,        setName]        = useState(campaign?.name ?? "");
  const [subject,     setSubject]     = useState(campaign?.subject ?? "");
  const [previewText, setPreviewText] = useState(campaign?.previewText ?? "");
  const [bodyHtml,    setBodyHtml]    = useState(campaign?.bodyHtml ?? "");
  const [bodyText,    setBodyText]    = useState(campaign?.bodyText ?? "");
  const [ctaLabel,    setCtaLabel]    = useState(campaign?.ctaLabel ?? "");
  const [ctaUrl,      setCtaUrl]      = useState(campaign?.ctaUrl ?? "");
  const [fromName,    setFromName]    = useState(campaign?.fromName ?? "");
  const [fromEmail,   setFromEmail]   = useState(campaign?.fromEmail ?? "");
  const [audience,    setAudience]    = useState<AudienceSegment>(campaign?.audience ?? { type: "all" });

  const [saving,      setSaving]      = useState(false);
  const [sending,     setSending]     = useState(false);
  const [testEmail,   setTestEmail]   = useState("");
  const [showAiModal, setShowAiModal] = useState(false);
  const [sendResult,  setSendResult]  = useState<string | null>(null);
  const [saveError,   setSaveError]   = useState<string | null>(null);
  const [tab,         setTab]         = useState<"content"|"audience"|"sender">("content");

  const { data: segData } = useQuery({
    queryKey:  ["crm-segments"],
    queryFn:   () => segmentsFn(),
    staleTime: 120_000,
  });

  async function save(andSend?: boolean, testOnly?: boolean) {
    setSaveError(null);
    setSaving(true);
    try {
      const payload = { id: campaign?.id, name, subject, previewText, bodyHtml, bodyText, ctaLabel: ctaLabel || null, ctaUrl: ctaUrl || null, fromName: fromName || null, fromEmail: fromEmail || null, audience };
      const { id } = await saveFn({ data: payload as any });
      qc.invalidateQueries({ queryKey: ["email-campaigns"] });

      if (andSend && !testOnly && id) {
        setSending(true);
        const result = await sendFn({ data: { id, testOnly: false } });
        setSendResult(`Sent to ${result.sent} recipients${result.failed > 0 ? `, ${result.failed} failed` : ""}.`);
        setSending(false);
        qc.invalidateQueries({ queryKey: ["email-campaigns"] });
        return;
      }
      if (andSend && testOnly && id && testEmail) {
        setSending(true);
        await sendFn({ data: { id, testOnly: true, testTo: testEmail } });
        setSendResult(`Test email sent to ${testEmail}`);
        setSending(false);
        return;
      }
      onSaved();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function applyDraft(draft: any) {
    setSubject(draft.subject ?? subject);
    setPreviewText(draft.previewText ?? previewText);
    setBodyHtml(draft.bodyHtml ?? bodyHtml);
    setBodyText(draft.bodyText ?? bodyText);
    setCtaLabel(draft.ctaLabel ?? ctaLabel);
    setCtaUrl(draft.ctaUrl ?? ctaUrl);
    if (draft.fromName && !fromName) setFromName(draft.fromName);
    setShowAiModal(false);
  }

  const subjectLen = subject.length;
  const metaLen = previewText.length;

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm"
        onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl border border-white/[0.08] bg-[#0f1117] shadow-2xl overflow-hidden">

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] shrink-0">
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-emerald-400" />
              <p className="text-sm font-semibold">{campaign?.id ? "Edit Campaign" : "New Campaign"}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAiModal(true)}
                className="h-7 text-xs gap-1.5 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
              >
                <Sparkles className="h-3 w-3" />
                AI Draft
              </Button>
              <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-white/[0.06] shrink-0">
            {([
              { id: "content",  label: "Content" },
              { id: "audience", label: "Audience" },
              { id: "sender",   label: "Sender & Test" },
            ] as const).map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "px-4 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors",
                  tab === t.id ? "border-emerald-400 text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {tab === "content" && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">Campaign Name *</Label>
                  <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Summer Promo 2026" className="h-8 text-xs" />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Subject Line *</Label>
                    <span className={cn("text-[10px]", subjectLen > 60 ? "text-amber-400" : "text-muted-foreground/50")}>{subjectLen}/60</span>
                  </div>
                  <Input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Your subject line…" className="h-8 text-xs" />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Preview Text</Label>
                    <span className={cn("text-[10px]", metaLen > 90 ? "text-amber-400" : "text-muted-foreground/50")}>{metaLen}/90</span>
                  </div>
                  <Input value={previewText} onChange={e => setPreviewText(e.target.value)} placeholder="Short preview shown in inbox…" className="h-8 text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Email Body (HTML)</Label>
                  <textarea
                    rows={8}
                    value={bodyHtml}
                    onChange={e => setBodyHtml(e.target.value)}
                    placeholder="<p>Your email content here…</p>"
                    className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs font-mono resize-none focus:outline-none focus:border-emerald-500/40 placeholder:text-muted-foreground/40"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">CTA Label</Label>
                    <Input value={ctaLabel} onChange={e => setCtaLabel(e.target.value)} placeholder="Book Now" className="h-8 text-xs" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">CTA URL</Label>
                    <Input value={ctaUrl} onChange={e => setCtaUrl(e.target.value)} placeholder="https://…" className="h-8 text-xs" />
                  </div>
                </div>
              </>
            )}

            {tab === "audience" && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-xs">Audience Segment</Label>
                  <div className="grid grid-cols-1 gap-2">
                    {[
                      { type: "all",    label: "All contacts with email", count: segData?.totalWithEmail ?? 0 },
                    ].map(opt => (
                      <button
                        key={opt.type}
                        onClick={() => setAudience({ type: "all" })}
                        className={cn(
                          "flex items-center justify-between rounded-lg border px-3 py-2.5 text-xs text-left transition-colors",
                          audience.type === "all"
                            ? "border-emerald-500/40 bg-emerald-500/[0.08] text-emerald-300"
                            : "border-white/[0.08] text-muted-foreground hover:border-white/20",
                        )}
                      >
                        <span>{opt.label}</span>
                        <span className="text-muted-foreground/60">{opt.count} contacts</span>
                      </button>
                    ))}
                  </div>
                </div>

                {segData && segData.statuses.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Filter by Lead Status</Label>
                    <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                      {segData.statuses.map(s => (
                        <button
                          key={s.status}
                          onClick={() => setAudience({ type: "status", status: s.status })}
                          className={cn(
                            "flex items-center justify-between rounded-lg border px-2.5 py-2 text-xs transition-colors",
                            audience.type === "status" && (audience as any).status === s.status
                              ? "border-emerald-500/40 bg-emerald-500/[0.08] text-emerald-300"
                              : "border-white/[0.06] text-muted-foreground hover:border-white/20",
                          )}
                        >
                          <span className="capitalize">{s.status.replace(/_/g, " ")}</span>
                          <span className="text-muted-foreground/60">{s.count}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {segData && segData.tags.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Filter by Tag</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {segData.tags.map(t => (
                        <button
                          key={t.tag}
                          onClick={() => setAudience({ type: "tag", tag: t.tag })}
                          className={cn(
                            "rounded-full border px-2 py-0.5 text-[10px] transition-colors",
                            audience.type === "tag" && (audience as any).tag === t.tag
                              ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                              : "border-white/[0.08] text-muted-foreground hover:border-white/20",
                          )}
                        >
                          {t.tag} ({t.count})
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {tab === "sender" && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">From Name</Label>
                    <Input value={fromName} onChange={e => setFromName(e.target.value)} placeholder="Your Company" className="h-8 text-xs" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">From Email</Label>
                    <Input value={fromEmail} onChange={e => setFromEmail(e.target.value)} placeholder="hello@yourdomain.com" className="h-8 text-xs" />
                  </div>
                </div>

                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
                  <p className="text-xs font-medium">Send Test Email</p>
                  <div className="flex gap-2">
                    <Input
                      value={testEmail}
                      onChange={e => setTestEmail(e.target.value)}
                      placeholder="test@example.com"
                      className="h-8 text-xs flex-1"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => save(true, true)}
                      disabled={!testEmail || saving || sending}
                      className="h-8 text-xs shrink-0"
                    >
                      {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                      Test
                    </Button>
                  </div>
                  {sendResult && (
                    <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-400">
                      <CheckCircle className="h-3.5 w-3.5 shrink-0" />
                      {sendResult}
                    </div>
                  )}
                </div>
              </div>
            )}

            {saveError && (
              <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {saveError}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-white/[0.06] shrink-0">
            <Button variant="ghost" size="sm" onClick={onClose} className="text-xs h-8">Cancel</Button>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => save(false)} disabled={saving || !name} className="h-8 text-xs">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                Save Draft
              </Button>
              <Button
                size="sm"
                onClick={() => save(true, false)}
                disabled={saving || sending || !name || !subject || !bodyHtml}
                className="h-8 text-xs bg-emerald-600 hover:bg-emerald-500 text-white gap-1.5"
              >
                {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                {sending ? "Sending…" : "Send Now"}
              </Button>
            </div>
          </div>
        </div>
      </div>
      {showAiModal && (
        <AiDraftModal
          onClose={() => setShowAiModal(false)}
          onApply={applyDraft}
        />
      )}
    </>
  );
}

// ── Campaigns Tab ─────────────────────────────────────────────────────────────

function CampaignsTab() {
  const listFn   = useServerFn(listEmailCampaigns);
  const deleteFn = useServerFn(deleteEmailCampaign);
  const qc       = useQueryClient();

  const [editing,    setEditing]   = useState<Partial<EmailCampaign> | null | undefined>(undefined);
  const [deleting,   setDeleting]  = useState<string | null>(null);

  const { data, isLoading, isFetching } = useQuery({
    queryKey:  ["email-campaigns"],
    queryFn:   () => listFn(),
    staleTime: 30_000,
  });

  const campaigns = data?.campaigns ?? [];

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      await deleteFn({ data: { id } });
      qc.invalidateQueries({ queryKey: ["email-campaigns"] });
    } catch {
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {campaigns.length} campaign{campaigns.length !== 1 ? "s" : ""}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => qc.invalidateQueries({ queryKey: ["email-campaigns"] })}
            className="h-7 text-xs"
          >
            <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
          </Button>
          <Button
            size="sm"
            onClick={() => setEditing({})}
            className="h-7 text-xs bg-emerald-600 hover:bg-emerald-500 text-white gap-1"
          >
            <Plus className="h-3 w-3" />
            New Campaign
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20 gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
          <span className="text-sm">Loading campaigns…</span>
        </div>
      ) : campaigns.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
          <Mail className="h-8 w-8 text-muted-foreground/30" />
          <div className="text-center">
            <p className="text-sm font-medium">No email campaigns yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Create your first campaign — AI can draft it using your Business DNA</p>
          </div>
          <Button size="sm" onClick={() => setEditing({})} className="h-8 text-xs bg-emerald-600 hover:bg-emerald-500 text-white gap-1.5 mt-2">
            <Plus className="h-3.5 w-3.5" />
            Create Campaign
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {campaigns.map(c => (
            <div
              key={c.id}
              className="group flex items-center gap-3 rounded-xl border border-white/[0.06] bg-card/40 p-4 hover:border-white/[0.1] transition-all"
            >
              <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                <Mail className="h-4 w-4 text-emerald-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium truncate">{c.name}</p>
                  {c.generatedByAi && (
                    <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-400">AI</span>
                  )}
                  <StatusBadge status={c.status} />
                </div>
                <p className="text-xs text-muted-foreground/60 truncate mt-0.5">{c.subject || "No subject"}</p>
                {c.sentAt && (
                  <p className="text-[10px] text-muted-foreground/40 mt-0.5">
                    Sent {new Date(c.sentAt).toLocaleDateString()} · {c.recipientCount ?? 0} recipients
                    {(c.sendResult as any)?.failed > 0 && (
                      <span className="text-amber-400/60"> · {(c.sendResult as any).failed} failed</span>
                    )}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => setEditing(c)}
                  className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-1.5 text-muted-foreground hover:text-foreground transition-colors"
                  title="Edit"
                >
                  <Edit2 className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => handleDelete(c.id)}
                  disabled={deleting === c.id}
                  className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-1.5 text-muted-foreground hover:text-red-400 transition-colors"
                  title="Delete"
                >
                  {deleting === c.id
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Trash2 className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing !== undefined && (
        <CampaignEditor
          campaign={editing}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            qc.invalidateQueries({ queryKey: ["email-campaigns"] });
          }}
        />
      )}
    </div>
  );
}

// ── Domain Warmup Tab ─────────────────────────────────────────────────────────

function WarmupPhaseLabel({ phase }: { phase: number }) {
  const labels = ["", "Micro-sends", "Expansion", "Growth", "Full Volume"];
  const colors = ["", "text-blue-400", "text-cyan-400", "text-amber-400", "text-emerald-400"];
  return (
    <span className={cn("text-[10px] font-semibold", colors[phase] ?? "text-muted-foreground")}>
      Phase {phase}: {labels[phase] ?? ""}
    </span>
  );
}

function AddWarmupModal({ onClose, onAdded }: { onClose: () => void; onAdded: (w: DomainWarmup) => void }) {
  const createFn = useServerFn(createDomainWarmup);
  const [domain,    setDomain]    = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [totalDays, setTotalDays] = useState(30);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  async function create() {
    setLoading(true);
    setError(null);
    try {
      const { warmup } = await createFn({ data: { domain, fromEmail, totalDays } });
      onAdded(warmup);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create warm-up plan");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-[#0f1117] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-2">
            <Flame className="h-4 w-4 text-orange-400" />
            <p className="text-sm font-semibold">Start Domain Warm-up</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Sending Domain *</Label>
            <Input value={domain} onChange={e => setDomain(e.target.value)} placeholder="yourdomain.com" className="h-8 text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">From Email *</Label>
            <Input value={fromEmail} onChange={e => setFromEmail(e.target.value)} placeholder="hello@yourdomain.com" type="email" className="h-8 text-xs" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Warm-up Duration</Label>
            <div className="flex gap-2">
              {[14, 21, 30, 45, 60].map(d => (
                <button
                  key={d}
                  onClick={() => setTotalDays(d)}
                  className={cn(
                    "flex-1 rounded-lg border py-1.5 text-xs font-medium transition-colors",
                    totalDays === d
                      ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                      : "border-white/[0.08] text-muted-foreground hover:border-white/20",
                  )}
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3 text-xs text-muted-foreground/70 space-y-1">
            <p className="font-medium text-foreground/70">4-Phase schedule generated automatically:</p>
            <p>Phase 1 (Days 1–7): 10–70 emails — highest-engagement contacts</p>
            <p>Phase 2 (Days 8–14): 80–360 emails — expand to engaged subscribers</p>
            <p>Phase 3 (Days 15–21): 360–1,200 emails — monitor bounce/spam rates</p>
            <p>Phase 4 (Days 22+): 1,200+ emails — ramp to full production volume</p>
          </div>
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              {error}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-white/[0.06]">
          <Button variant="ghost" size="sm" onClick={onClose} className="text-xs h-8">Cancel</Button>
          <Button
            size="sm"
            onClick={create}
            disabled={loading || !domain || !fromEmail}
            className="h-8 text-xs bg-orange-600 hover:bg-orange-500 text-white gap-1.5"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Flame className="h-3.5 w-3.5" />}
            {loading ? "Creating…" : "Start Warm-up"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function WarmupCard({ warmup, onRefresh }: { warmup: DomainWarmup; onRefresh: () => void }) {
  const updateDayFn    = useServerFn(updateWarmupDay);
  const updateStatusFn = useServerFn(updateWarmupStatus);
  const [expanded,    setExpanded]  = useState(false);
  const [updatingDay, setUpdatingDay] = useState<number | null>(null);
  const [bounceInput, setBounceInput] = useState("");
  const [spamInput,   setSpamInput]   = useState("");

  const pct = Math.round((warmup.completedDays.length / warmup.totalDays) * 100);
  const todayPlan = warmup.dailyPlan.find(d => d.day === warmup.currentDay);

  const repColor =
    warmup.reputationScore == null ? "text-muted-foreground" :
    warmup.reputationScore >= 80 ? "text-emerald-400" :
    warmup.reputationScore >= 60 ? "text-amber-400" :
    "text-red-400";

  async function markDayDone(day: number) {
    setUpdatingDay(day);
    try {
      await updateDayFn({ data: {
        id:              warmup.id,
        day,
        bounceRate:      bounceInput ? parseFloat(bounceInput) : null,
        spamRate:        spamInput   ? parseFloat(spamInput)   : null,
        reputationScore: null,
      }});
      onRefresh();
      setBounceInput("");
      setSpamInput("");
    } catch {
    } finally {
      setUpdatingDay(null);
    }
  }

  async function toggleStatus(s: "active" | "paused") {
    await updateStatusFn({ data: { id: warmup.id, status: s } });
    onRefresh();
  }

  return (
    <div className="rounded-xl border border-white/[0.08] bg-card/40 overflow-hidden">
      {/* Header */}
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-lg bg-orange-500/10 flex items-center justify-center shrink-0 mt-0.5">
            <Flame className="h-4.5 w-4.5 text-orange-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">{warmup.domain}</p>
                <p className="text-xs text-muted-foreground/60">{warmup.fromEmail}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize",
                  warmup.status === "active"    ? "border-emerald-500/30 text-emerald-400 bg-emerald-500/10" :
                  warmup.status === "paused"    ? "border-amber-500/30 text-amber-400 bg-amber-500/10" :
                  warmup.status === "completed" ? "border-blue-500/30 text-blue-400 bg-blue-500/10" :
                  "border-red-500/30 text-red-400 bg-red-500/10",
                )}>
                  {warmup.status}
                </span>
                {warmup.status === "active" && (
                  <button onClick={() => toggleStatus("paused")} title="Pause" className="text-muted-foreground hover:text-amber-400 transition-colors">
                    <Pause className="h-3.5 w-3.5" />
                  </button>
                )}
                {warmup.status === "paused" && (
                  <button onClick={() => toggleStatus("active")} title="Resume" className="text-muted-foreground hover:text-emerald-400 transition-colors">
                    <Play className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Progress bar */}
            <div className="mt-3 space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground/60">Day {warmup.currentDay} of {warmup.totalDays}</span>
                <span className={cn("font-semibold", pct === 100 ? "text-emerald-400" : "text-foreground")}>{pct}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                <div
                  className={cn("h-full rounded-full transition-all", pct === 100 ? "bg-emerald-500" : "bg-orange-500")}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>

            {/* Stats row */}
            <div className="mt-3 flex items-center gap-4 text-xs">
              {warmup.reputationScore != null && (
                <div>
                  <span className="text-muted-foreground/50">Rep Score </span>
                  <span className={cn("font-semibold", repColor)}>{warmup.reputationScore}</span>
                </div>
              )}
              {warmup.bounceRate != null && (
                <div>
                  <span className="text-muted-foreground/50">Bounce </span>
                  <span className={cn("font-semibold", warmup.bounceRate > 5 ? "text-red-400" : warmup.bounceRate > 2 ? "text-amber-400" : "text-emerald-400")}>
                    {warmup.bounceRate}%
                  </span>
                </div>
              )}
              {warmup.spamRate != null && (
                <div>
                  <span className="text-muted-foreground/50">Spam </span>
                  <span className={cn("font-semibold", warmup.spamRate > 0.3 ? "text-red-400" : warmup.spamRate > 0.1 ? "text-amber-400" : "text-emerald-400")}>
                    {warmup.spamRate}%
                  </span>
                </div>
              )}
              {todayPlan && warmup.status === "active" && (
                <div>
                  <span className="text-muted-foreground/50">Today's target </span>
                  <span className="font-semibold">{todayPlan.volume.toLocaleString()} emails</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Today's action */}
      {warmup.status === "active" && todayPlan && !warmup.completedDays.includes(warmup.currentDay) && (
        <div className="px-4 pb-4 pt-1">
          <div className="rounded-lg border border-orange-500/20 bg-orange-500/5 p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-orange-300">Today — Day {warmup.currentDay}</p>
                <WarmupPhaseLabel phase={todayPlan.phase} />
              </div>
              <p className="text-lg font-bold text-orange-300">{todayPlan.volume.toLocaleString()}</p>
            </div>
            <p className="text-[11px] text-muted-foreground/70">{todayPlan.note}</p>
            <div className="flex items-center gap-2">
              <div className="flex-1 grid grid-cols-2 gap-2">
                <Input
                  value={bounceInput}
                  onChange={e => setBounceInput(e.target.value)}
                  placeholder="Bounce % (optional)"
                  className="h-7 text-xs"
                />
                <Input
                  value={spamInput}
                  onChange={e => setSpamInput(e.target.value)}
                  placeholder="Spam % (optional)"
                  className="h-7 text-xs"
                />
              </div>
              <Button
                size="sm"
                onClick={() => markDayDone(warmup.currentDay)}
                disabled={updatingDay === warmup.currentDay}
                className="h-7 text-xs bg-orange-600 hover:bg-orange-500 text-white shrink-0"
              >
                {updatingDay === warmup.currentDay
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <CheckCircle className="h-3.5 w-3.5" />}
                Mark Done
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Schedule toggle */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2 border-t border-white/[0.04] text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors"
      >
        <span>Full schedule ({warmup.totalDays} days)</span>
        <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-90")} />
      </button>

      {expanded && (
        <div className="px-4 pb-4 overflow-x-auto">
          <div className="grid grid-cols-6 sm:grid-cols-10 gap-1 mt-2">
            {warmup.dailyPlan.map(d => {
              const done = warmup.completedDays.includes(d.day);
              const isToday = d.day === warmup.currentDay && warmup.status === "active";
              return (
                <div
                  key={d.day}
                  title={`Day ${d.day}: ${d.volume.toLocaleString()} emails — ${d.note}`}
                  className={cn(
                    "relative flex flex-col items-center rounded-lg border p-1.5 transition-colors",
                    done    ? "border-emerald-500/30 bg-emerald-500/10" :
                    isToday ? "border-orange-500/40 bg-orange-500/10" :
                    "border-white/[0.04] bg-white/[0.02]",
                  )}
                >
                  <span className="text-[9px] text-muted-foreground/50">{d.day}</span>
                  <span className={cn("text-[9px] font-semibold", done ? "text-emerald-400" : isToday ? "text-orange-400" : "text-muted-foreground/60")}>
                    {d.volume >= 1000 ? `${(d.volume/1000).toFixed(1)}k` : d.volume}
                  </span>
                  {done && <CheckCircle className="h-2.5 w-2.5 text-emerald-400 mt-0.5" />}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function WarmupTab() {
  const listFn = useServerFn(listDomainWarmups);
  const qc     = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);

  const { data, isLoading, isFetching } = useQuery({
    queryKey:  ["domain-warmups"],
    queryFn:   () => listFn(),
    staleTime: 30_000,
  });

  const warmups = data?.warmups ?? [];
  const active   = warmups.filter(w => w.status === "active");
  const inactive = warmups.filter(w => w.status !== "active");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs text-muted-foreground">
            {active.length} active warm-up{active.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["domain-warmups"] })} className="h-7 text-xs">
            <RefreshCw className={cn("h-3 w-3", isFetching && "animate-spin")} />
          </Button>
          <Button
            size="sm"
            onClick={() => setShowAdd(true)}
            className="h-7 text-xs bg-orange-600 hover:bg-orange-500 text-white gap-1"
          >
            <Plus className="h-3 w-3" />
            New Warm-up
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20 gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin text-orange-400" />
          <span className="text-sm">Loading warm-up plans…</span>
        </div>
      ) : warmups.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
          <Flame className="h-8 w-8 text-muted-foreground/30" />
          <div className="text-center">
            <p className="text-sm font-medium">No warm-up plans yet</p>
            <p className="text-xs text-muted-foreground/60 mt-1">Start a domain warm-up to build sending reputation before running email campaigns</p>
          </div>
          <Button size="sm" onClick={() => setShowAdd(true)} className="h-8 text-xs bg-orange-600 hover:bg-orange-500 text-white gap-1.5 mt-2">
            <Flame className="h-3.5 w-3.5" />
            Start Warm-up
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {active.map(w => (
            <WarmupCard
              key={w.id}
              warmup={w}
              onRefresh={() => qc.invalidateQueries({ queryKey: ["domain-warmups"] })}
            />
          ))}
          {inactive.length > 0 && (
            <>
              <p className="text-xs font-medium text-muted-foreground/50 pt-2">Paused / Completed</p>
              {inactive.map(w => (
                <WarmupCard
                  key={w.id}
                  warmup={w}
                  onRefresh={() => qc.invalidateQueries({ queryKey: ["domain-warmups"] })}
                />
              ))}
            </>
          )}
        </div>
      )}

      {showAdd && (
        <AddWarmupModal
          onClose={() => setShowAdd(false)}
          onAdded={() => {
            setShowAdd(false);
            qc.invalidateQueries({ queryKey: ["domain-warmups"] });
          }}
        />
      )}
    </div>
  );
}

// ── Audience Tab ──────────────────────────────────────────────────────────────

function AudienceTab() {
  const getFn = useServerFn(getCrmSegments);
  const { data, isLoading } = useQuery({
    queryKey:  ["crm-segments"],
    queryFn:   () => getFn(),
    staleTime: 120_000,
  });

  return (
    <div className="space-y-5">
      {isLoading ? (
        <div className="flex items-center justify-center py-20 gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
          <span className="text-sm">Loading audience data…</span>
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-white/[0.08] bg-card/40 p-5 flex items-center gap-5">
            <div className="h-12 w-12 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
              <Users className="h-6 w-6 text-emerald-400" />
            </div>
            <div>
              <p className="text-2xl font-bold tabular-nums">{(data?.totalWithEmail ?? 0).toLocaleString()}</p>
              <p className="text-xs text-muted-foreground/60 mt-0.5">Total contacts with email address</p>
            </div>
          </div>

          {(data?.statuses ?? []).length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.08em]">By Lead Status</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {(data?.statuses ?? []).map(s => {
                  const pct = data?.totalWithEmail ? Math.round((s.count / data.totalWithEmail) * 100) : 0;
                  return (
                    <div key={s.status} className="rounded-xl border border-white/[0.06] bg-card/30 p-3 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-medium capitalize">{s.status.replace(/_/g, " ")}</p>
                        <p className="text-sm font-bold tabular-nums">{s.count}</p>
                      </div>
                      <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
                        <div className="h-full rounded-full bg-emerald-500/60" style={{ width: `${pct}%` }} />
                      </div>
                      <p className="text-[10px] text-muted-foreground/40">{pct}% of addressable</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {(data?.tags ?? []).length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.08em]">Tags</h3>
              <div className="flex flex-wrap gap-2">
                {(data?.tags ?? []).map(t => (
                  <div
                    key={t.tag}
                    className="flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-xs"
                  >
                    <span className="font-medium">{t.tag}</span>
                    <span className="text-muted-foreground/50">({t.count})</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(data?.statuses ?? []).length === 0 && (data?.tags ?? []).length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground text-center">
              <Users className="h-6 w-6 text-muted-foreground/30" />
              <p className="text-sm">No CRM contacts with email addresses found.</p>
              <p className="text-xs text-muted-foreground/50">Import contacts or ensure your leads have email addresses set.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function GrowthMindEmailCampaigns() {
  const [activeTab, setActiveTab] = useState<Tab>("campaigns");

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: "campaigns", label: "Campaigns",    icon: Mail },
    { id: "warmup",    label: "Domain Warm-up", icon: Flame },
    { id: "audience",  label: "Audience",     icon: Users },
  ];

  return (
    <GrowthMindShell>
      <div className="px-6 py-5 max-w-4xl">

        {/* Page header */}
        <div className="mb-6">
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <Mail className="h-5 w-5 text-emerald-400" />
            Email Campaign Engine
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            AI-crafted campaigns, audience segmentation, and domain warm-up tracking
          </p>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 mb-5 border-b border-white/[0.06]">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors",
                activeTab === t.id
                  ? "border-emerald-400 text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === "campaigns" && <CampaignsTab />}
        {activeTab === "warmup"    && <WarmupTab />}
        {activeTab === "audience"  && <AudienceTab />}
      </div>
    </GrowthMindShell>
  );
}
