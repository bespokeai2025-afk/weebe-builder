import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Search, Loader2, RefreshCw, Plus, Trash2, Save,
  Sparkles, ExternalLink, Check, X, Edit2, Globe,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GrowthMindShell } from "./GrowthMindShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getGrowthMindAIResponse } from "@/lib/growthmind/growthmind.ai";
import { getGrowthMindData } from "@/lib/growthmind/growthmind.functions";
import {
  getSeoSite,
  saveSeoSite,
  type SeoKeyword,
  type ContentIdea,
} from "@/lib/growthmind/growthmind.seo";

function nanoid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ── Status badge ────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<ContentIdea["status"], string> = {
  idea:          "bg-slate-500/15 text-slate-400 border-slate-500/20",
  "in-progress": "bg-amber-500/15 text-amber-400 border-amber-500/20",
  published:     "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
};

function StatusBadge({ status, onChange }: { status: ContentIdea["status"]; onChange: (s: ContentIdea["status"]) => void }) {
  const statuses: ContentIdea["status"][] = ["idea", "in-progress", "published"];
  const next = statuses[(statuses.indexOf(status) + 1) % statuses.length];
  return (
    <button
      onClick={() => onChange(next)}
      title="Click to advance status"
      className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize transition-colors", STATUS_STYLES[status])}
    >
      {status}
    </button>
  );
}

// ── Difficulty colour ────────────────────────────────────────────────────────

function diffColor(d: number | null): string {
  if (d === null) return "text-muted-foreground";
  if (d < 30) return "text-emerald-400";
  if (d < 60) return "text-amber-400";
  return "text-red-400";
}

// ── Keyword row — view or edit ────────────────────────────────────────────────

function KeywordRow({
  kw, onSave, onDelete,
}: {
  kw: SeoKeyword;
  onSave: (updated: SeoKeyword) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState({
    term:       kw.term,
    volume:     kw.volume     !== null ? String(kw.volume)     : "",
    difficulty: kw.difficulty !== null ? String(kw.difficulty) : "",
    rank:       kw.rank       !== null ? String(kw.rank)       : "",
  });

  function commit() {
    if (!draft.term.trim()) return;
    const diff = draft.difficulty ? Math.min(100, Math.max(1, parseInt(draft.difficulty))) : null;
    onSave({
      ...kw,
      term:       draft.term.trim(),
      volume:     draft.volume     ? parseInt(draft.volume)     : null,
      difficulty: diff,
      rank:       draft.rank       ? parseInt(draft.rank)       : null,
    });
    setEditing(false);
  }

  function cancel() {
    setDraft({
      term:       kw.term,
      volume:     kw.volume     !== null ? String(kw.volume)     : "",
      difficulty: kw.difficulty !== null ? String(kw.difficulty) : "",
      rank:       kw.rank       !== null ? String(kw.rank)       : "",
    });
    setEditing(false);
  }

  if (editing) {
    return (
      <tr className="bg-white/[0.02]">
        <td className="px-3 py-2">
          <Input
            autoFocus
            value={draft.term}
            onChange={e => setDraft(v => ({ ...v, term: e.target.value }))}
            onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") cancel(); }}
            className="h-6 text-xs w-full min-w-[120px]"
          />
        </td>
        <td className="px-3 py-2">
          <Input
            type="number" min={0}
            value={draft.volume}
            onChange={e => setDraft(v => ({ ...v, volume: e.target.value }))}
            onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") cancel(); }}
            className="h-6 text-xs w-20 tabular-nums"
          />
        </td>
        <td className="px-3 py-2">
          <Input
            type="number" min={1} max={100}
            value={draft.difficulty}
            onChange={e => setDraft(v => ({ ...v, difficulty: e.target.value }))}
            onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") cancel(); }}
            className="h-6 text-xs w-20 tabular-nums"
          />
        </td>
        <td className="px-3 py-2">
          <Input
            type="number" min={1}
            value={draft.rank}
            onChange={e => setDraft(v => ({ ...v, rank: e.target.value }))}
            onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") cancel(); }}
            className="h-6 text-xs w-20 tabular-nums"
          />
        </td>
        <td className="px-3 py-2">
          <div className="flex items-center gap-1">
            <button onClick={commit} className="text-emerald-400 hover:text-emerald-300 transition-colors" title="Save">
              <Check className="h-3.5 w-3.5" />
            </button>
            <button onClick={cancel} className="text-muted-foreground hover:text-foreground transition-colors" title="Cancel">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="hover:bg-white/[0.02] transition-colors group">
      <td className="px-4 py-2.5 font-medium">{kw.term}</td>
      <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
        {kw.volume !== null ? kw.volume.toLocaleString() : "—"}
      </td>
      <td className={cn("px-4 py-2.5 tabular-nums font-semibold", diffColor(kw.difficulty))}>
        {kw.difficulty !== null ? kw.difficulty : "—"}
      </td>
      <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
        {kw.rank !== null ? `#${kw.rank}` : <span className="text-amber-400/80">Not ranking</span>}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => setEditing(true)}
            className="text-muted-foreground hover:text-foreground transition-colors"
            title="Edit"
          >
            <Edit2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onDelete(kw.id)}
            className="text-muted-foreground hover:text-red-400 transition-colors"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── Content idea row — view or edit ──────────────────────────────────────────

function ContentIdeaRow({
  idea, onSave, onDelete, onStatusChange,
}: {
  idea: ContentIdea;
  onSave: (updated: ContentIdea) => void;
  onDelete: (id: string) => void;
  onStatusChange: (id: string, status: ContentIdea["status"]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState({ title: idea.title, targetKeyword: idea.targetKeyword });

  function commit() {
    if (!draft.title.trim()) return;
    onSave({ ...idea, title: draft.title.trim(), targetKeyword: draft.targetKeyword.trim() });
    setEditing(false);
  }

  function cancel() {
    setDraft({ title: idea.title, targetKeyword: idea.targetKeyword });
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-white/[0.03] border-b border-white/[0.06]">
        <div className="flex-1 flex flex-wrap gap-2 items-center">
          <Input
            autoFocus
            value={draft.title}
            onChange={e => setDraft(v => ({ ...v, title: e.target.value }))}
            onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") cancel(); }}
            placeholder="Content title"
            className="h-6 text-xs flex-1 min-w-[180px]"
          />
          <Input
            value={draft.targetKeyword}
            onChange={e => setDraft(v => ({ ...v, targetKeyword: e.target.value }))}
            onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") cancel(); }}
            placeholder="Target keyword"
            className="h-6 text-xs w-44"
          />
        </div>
        <button onClick={commit} className="text-emerald-400 hover:text-emerald-300 transition-colors shrink-0" title="Save">
          <Check className="h-3.5 w-3.5" />
        </button>
        <button onClick={cancel} className="text-muted-foreground hover:text-foreground transition-colors shrink-0" title="Cancel">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-white/[0.02] transition-colors group">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate">{idea.title}</p>
        {idea.targetKeyword && (
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Target: <span className="text-emerald-400/80">{idea.targetKeyword}</span>
          </p>
        )}
      </div>
      <StatusBadge status={idea.status} onChange={s => onStatusChange(idea.id, s)} />
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <button
          onClick={() => setEditing(true)}
          className="text-muted-foreground hover:text-foreground transition-colors"
          title="Edit"
        >
          <Edit2 className="h-3 w-3" />
        </button>
        <button
          onClick={() => onDelete(idea.id)}
          className="text-muted-foreground hover:text-red-400 transition-colors"
          title="Delete"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function GrowthMindSEO() {
  const qc         = useQueryClient();
  const getSiteFn  = useServerFn(getSeoSite);
  const saveSiteFn = useServerFn(saveSeoSite);
  const aiRespFn   = useServerFn(getGrowthMindAIResponse);
  const getDataFn  = useServerFn(getGrowthMindData);

  const [urlInput, setUrlInput]         = useState("");
  const [saving, setSaving]             = useState(false);
  const [saveMsg, setSaveMsg]           = useState<{ text: string; isError: boolean } | null>(null);
  const [aiInsight, setAiInsight]       = useState<string | null>(null);
  const [aiLoading, setAiLoading]       = useState(false);

  const [siteId, setSiteId]             = useState<string | undefined>();
  const [siteUrl, setSiteUrl]           = useState("");
  const [keywords, setKeywords]         = useState<SeoKeyword[]>([]);
  const [contentIdeas, setContentIdeas] = useState<ContentIdea[]>([]);

  const [newKw, setNewKw]               = useState({ term: "", volume: "", difficulty: "", rank: "" });
  const [newIdea, setNewIdea]           = useState({ title: "", targetKeyword: "" });
  const [showKwForm, setShowKwForm]     = useState(false);
  const [showIdeaForm, setShowIdeaForm] = useState(false);

  const { data: siteData, isLoading } = useQuery({
    queryKey: ["growthmind-seo-site"],
    queryFn:  () => getSiteFn(),
    staleTime: 60_000,
  });

  const { data: platformData } = useQuery({
    queryKey: ["growthmind-data"],
    queryFn:  () => getDataFn(),
    staleTime: 120_000,
  });

  useEffect(() => {
    const site = siteData?.site;
    if (!site) return;
    setSiteId(site.id);
    setSiteUrl(site.url);
    setKeywords(site.keywords);
    setContentIdeas(site.contentIdeas);
  }, [siteData]);

  const connected = !!siteUrl;

  function flashMsg(text: string, isError = false) {
    setSaveMsg({ text, isError });
    setTimeout(() => setSaveMsg(null), 3000);
  }

  async function handleConnect() {
    if (!urlInput.trim()) return;
    let url = urlInput.trim();
    if (!url.startsWith("http")) url = "https://" + url;
    setSaving(true);
    try {
      await saveSiteFn({ id: siteId, url, keywords, contentIdeas });
      setSiteUrl(url);
      flashMsg("Site connected!");
      qc.invalidateQueries({ queryKey: ["growthmind-seo-site"] });
    } catch (e: any) {
      flashMsg("Failed to save: " + e.message, true);
    } finally {
      setSaving(false);
    }
  }

  async function persistAll(kws: SeoKeyword[], ideas: ContentIdea[]) {
    try {
      await saveSiteFn({ id: siteId, url: siteUrl, keywords: kws, contentIdeas: ideas });
      qc.invalidateQueries({ queryKey: ["growthmind-seo-site"] });
    } catch (e: any) {
      flashMsg("Failed to save changes: " + e.message, true);
    }
  }

  // ── Keyword ops ────────────────────────────────────────────────────────────

  function addKeyword() {
    if (!newKw.term.trim()) return;
    const diff = newKw.difficulty ? Math.min(100, Math.max(1, parseInt(newKw.difficulty))) : null;
    const kw: SeoKeyword = {
      id:         nanoid(),
      term:       newKw.term.trim(),
      volume:     newKw.volume ? parseInt(newKw.volume) : null,
      difficulty: diff,
      rank:       newKw.rank   ? parseInt(newKw.rank)   : null,
    };
    const updated = [...keywords, kw];
    setKeywords(updated);
    setNewKw({ term: "", volume: "", difficulty: "", rank: "" });
    setShowKwForm(false);
    persistAll(updated, contentIdeas);
  }

  function saveKeyword(updated: SeoKeyword) {
    const next = keywords.map(k => k.id === updated.id ? updated : k);
    setKeywords(next);
    persistAll(next, contentIdeas);
  }

  function removeKeyword(id: string) {
    const updated = keywords.filter(k => k.id !== id);
    setKeywords(updated);
    persistAll(updated, contentIdeas);
  }

  // ── Content idea ops ───────────────────────────────────────────────────────

  function addIdea() {
    if (!newIdea.title.trim()) return;
    const idea: ContentIdea = {
      id:            nanoid(),
      title:         newIdea.title.trim(),
      targetKeyword: newIdea.targetKeyword.trim(),
      status:        "idea",
    };
    const updated = [...contentIdeas, idea];
    setContentIdeas(updated);
    setNewIdea({ title: "", targetKeyword: "" });
    setShowIdeaForm(false);
    persistAll(keywords, updated);
  }

  function saveIdea(updated: ContentIdea) {
    const next = contentIdeas.map(i => i.id === updated.id ? updated : i);
    setContentIdeas(next);
    persistAll(keywords, next);
  }

  function removeIdea(id: string) {
    const updated = contentIdeas.filter(i => i.id !== id);
    setContentIdeas(updated);
    persistAll(keywords, updated);
  }

  function updateIdeaStatus(id: string, status: ContentIdea["status"]) {
    const updated = contentIdeas.map(i => i.id === id ? { ...i, status } : i);
    setContentIdeas(updated);
    persistAll(keywords, updated);
  }

  // ── AI recommendations ─────────────────────────────────────────────────────

  async function handleAIRecommendations() {
    if (keywords.length === 0) return;
    setAiLoading(true);
    setAiInsight(null);
    try {
      const kwSummary = keywords
        .slice()
        .sort((a, b) => {
          const scoreA = (a.volume ?? 0) / Math.max(1, a.difficulty ?? 50);
          const scoreB = (b.volume ?? 0) / Math.max(1, b.difficulty ?? 50);
          return scoreB - scoreA;
        })
        .slice(0, 10)
        .map(k =>
          `"${k.term}" — vol: ${k.volume ?? "unknown"}, difficulty: ${k.difficulty ?? "unknown"}/100, rank: ${k.rank !== null ? `#${k.rank}` : "Not ranking"}`
        ).join("\n");

      const { reply } = await aiRespFn({
        messages: [{
          role: "user",
          content: `Here are my tracked SEO keywords for ${siteUrl}:\n\n${kwSummary}\n\nBased on this data, identify the top 3 priority keyword opportunities (high volume, lower difficulty, not yet ranking). For each, suggest the type of content that would best target it. Be specific and actionable in 3-4 sentences total.`,
        }],
        platformData,
        personality: "professional",
      });
      setAiInsight(reply);
    } catch (e: any) {
      setAiInsight("Unable to generate recommendations: " + e.message);
    } finally {
      setAiLoading(false);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <GrowthMindShell>
      <div className="px-6 py-5 max-w-4xl">

        {/* Header */}
        <div className="mb-6 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <Search className="h-5 w-5 text-emerald-400" />
              SEO Tracker
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Track keyword opportunities and content ideas for organic growth
            </p>
          </div>
          <div className="flex items-center gap-2">
            {saveMsg && (
              <span className={cn("text-xs font-medium", saveMsg.isError ? "text-red-400" : "text-emerald-400")}>
                {saveMsg.text}
              </span>
            )}
            <Button
              variant="outline" size="sm"
              onClick={() => qc.invalidateQueries({ queryKey: ["growthmind-seo-site"] })}
            >
              <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isLoading && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-24 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
            <span className="text-sm">Loading SEO data…</span>
          </div>
        ) : (
          <div className="space-y-5">

            {/* Site connection */}
            <div className="rounded-xl border border-white/[0.06] bg-card/60 p-5">
              <p className="text-sm font-semibold flex items-center gap-2 mb-4">
                <Globe className="h-4 w-4 text-emerald-400" />
                Site Connection
              </p>
              {connected ? (
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.05] px-3 py-2 flex-1">
                    <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                    <a
                      href={siteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-emerald-300 font-medium truncate hover:underline flex items-center gap-1"
                    >
                      {siteUrl}
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                  </div>
                  <Button
                    variant="ghost" size="sm"
                    onClick={() => { setSiteUrl(""); setUrlInput(siteUrl); }}
                    className="h-8 text-xs text-muted-foreground"
                  >
                    <Edit2 className="mr-1.5 h-3 w-3" />
                    Change
                  </Button>
                </div>
              ) : (
                <div className="flex items-end gap-3 flex-wrap">
                  <div className="space-y-1.5 flex-1 min-w-[260px]">
                    <Label className="text-xs">Website URL</Label>
                    <Input
                      placeholder="https://yoursite.com"
                      value={urlInput}
                      onChange={e => setUrlInput(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && handleConnect()}
                      className="h-8 text-xs"
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={handleConnect}
                    disabled={saving || !urlInput.trim()}
                  >
                    {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                    Connect site
                  </Button>
                </div>
              )}
            </div>

            {connected && (
              <>
                {/* Keyword opportunities */}
                <div className="rounded-xl border border-white/[0.06] bg-card/60 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
                    <div>
                      <p className="text-sm font-semibold">Keyword Opportunities</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Track target keywords — hover a row to edit or delete
                      </p>
                    </div>
                    <Button
                      size="sm" variant="outline"
                      onClick={() => { setShowKwForm(v => !v); }}
                      className="h-7 text-xs"
                    >
                      <Plus className="mr-1 h-3 w-3" />
                      Add keyword
                    </Button>
                  </div>

                  {showKwForm && (
                    <div className="px-4 py-3 border-b border-white/[0.06] bg-white/[0.02]">
                      <div className="flex flex-wrap gap-2 items-end">
                        <div className="space-y-1 flex-1 min-w-[150px]">
                          <Label className="text-[10px]">Keyword</Label>
                          <Input
                            autoFocus
                            placeholder="e.g. buy solar panels uk"
                            value={newKw.term}
                            onChange={e => setNewKw(v => ({ ...v, term: e.target.value }))}
                            onKeyDown={e => { if (e.key === "Enter") addKeyword(); if (e.key === "Escape") setShowKwForm(false); }}
                            className="h-7 text-xs"
                          />
                        </div>
                        <div className="space-y-1 w-24">
                          <Label className="text-[10px]">Volume / mo</Label>
                          <Input
                            type="number" min={0} placeholder="2400"
                            value={newKw.volume}
                            onChange={e => setNewKw(v => ({ ...v, volume: e.target.value }))}
                            className="h-7 text-xs"
                          />
                        </div>
                        <div className="space-y-1 w-24">
                          <Label className="text-[10px]">Difficulty (1–100)</Label>
                          <Input
                            type="number" min={1} max={100} placeholder="35"
                            value={newKw.difficulty}
                            onChange={e => setNewKw(v => ({ ...v, difficulty: e.target.value }))}
                            className="h-7 text-xs"
                          />
                        </div>
                        <div className="space-y-1 w-24">
                          <Label className="text-[10px]">Current Rank</Label>
                          <Input
                            type="number" min={1} placeholder="14"
                            value={newKw.rank}
                            onChange={e => setNewKw(v => ({ ...v, rank: e.target.value }))}
                            className="h-7 text-xs"
                          />
                        </div>
                        <Button size="sm" onClick={addKeyword} className="h-7 text-xs">
                          <Check className="mr-1 h-3 w-3" /> Add
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setShowKwForm(false)} className="h-7 text-xs">
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  )}

                  {keywords.length === 0 ? (
                    <div className="px-4 py-8 text-center">
                      <p className="text-sm text-muted-foreground">
                        No keywords tracked yet. Add your first keyword above.
                      </p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-white/[0.06]">
                            {["Keyword", "Volume / mo", "Difficulty", "Current Rank", ""].map(h => (
                              <th key={h} className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/60">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/[0.04]">
                          {keywords.map(kw => (
                            <KeywordRow
                              key={kw.id}
                              kw={kw}
                              onSave={saveKeyword}
                              onDelete={removeKeyword}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* AI recommendations */}
                {keywords.length > 0 && (
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-5">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 text-emerald-400 shrink-0" />
                        <p className="text-sm font-semibold">AI SEO Recommendations</p>
                      </div>
                      <Button
                        variant="outline" size="sm"
                        onClick={handleAIRecommendations}
                        disabled={aiLoading}
                        className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                      >
                        {aiLoading
                          ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Analysing…</>
                          : <><Sparkles className="mr-1.5 h-3.5 w-3.5" />Generate recommendations</>
                        }
                      </Button>
                    </div>
                    {!aiInsight && !aiLoading && (
                      <p className="mt-3 text-sm text-muted-foreground">
                        GrowthMind will analyse your keyword list and surface priority opportunities based on volume/difficulty ratio.
                      </p>
                    )}
                    {aiLoading && (
                      <p className="mt-3 text-sm text-muted-foreground animate-pulse">
                        Analysing keyword opportunities…
                      </p>
                    )}
                    {aiInsight && !aiLoading && (
                      <p className="mt-3 text-sm leading-relaxed whitespace-pre-line">{aiInsight}</p>
                    )}
                  </div>
                )}

                {/* Content opportunities */}
                <div className="rounded-xl border border-white/[0.06] bg-card/60 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
                    <div>
                      <p className="text-sm font-semibold">Content Opportunities</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Track blog posts, guides, and landing pages — hover a row to edit
                      </p>
                    </div>
                    <Button
                      size="sm" variant="outline"
                      onClick={() => setShowIdeaForm(v => !v)}
                      className="h-7 text-xs"
                    >
                      <Plus className="mr-1 h-3 w-3" />
                      Add idea
                    </Button>
                  </div>

                  {showIdeaForm && (
                    <div className="px-4 py-3 border-b border-white/[0.06] bg-white/[0.02]">
                      <div className="flex flex-wrap gap-2 items-end">
                        <div className="space-y-1 flex-1 min-w-[200px]">
                          <Label className="text-[10px]">Content Title</Label>
                          <Input
                            autoFocus
                            placeholder="e.g. Complete guide to solar panel installation"
                            value={newIdea.title}
                            onChange={e => setNewIdea(v => ({ ...v, title: e.target.value }))}
                            onKeyDown={e => { if (e.key === "Enter") addIdea(); if (e.key === "Escape") setShowIdeaForm(false); }}
                            className="h-7 text-xs"
                          />
                        </div>
                        <div className="space-y-1 w-48">
                          <Label className="text-[10px]">Target Keyword</Label>
                          <Input
                            placeholder="e.g. solar panel installation"
                            value={newIdea.targetKeyword}
                            onChange={e => setNewIdea(v => ({ ...v, targetKeyword: e.target.value }))}
                            onKeyDown={e => { if (e.key === "Enter") addIdea(); if (e.key === "Escape") setShowIdeaForm(false); }}
                            className="h-7 text-xs"
                          />
                        </div>
                        <Button size="sm" onClick={addIdea} className="h-7 text-xs">
                          <Check className="mr-1 h-3 w-3" /> Add
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setShowIdeaForm(false)} className="h-7 text-xs">
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  )}

                  {contentIdeas.length === 0 ? (
                    <div className="px-4 py-8 text-center">
                      <p className="text-sm text-muted-foreground">
                        No content ideas yet. Add your first content opportunity.
                      </p>
                    </div>
                  ) : (
                    <div className="divide-y divide-white/[0.04]">
                      {contentIdeas.map(idea => (
                        <ContentIdeaRow
                          key={idea.id}
                          idea={idea}
                          onSave={saveIdea}
                          onDelete={removeIdea}
                          onStatusChange={updateIdeaStatus}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </GrowthMindShell>
  );
}
