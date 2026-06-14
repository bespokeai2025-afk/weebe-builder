import { useState, useEffect, useRef, useCallback } from "react";
import { useRelativeTime } from "@/lib/use-relative-time";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import {
  Search, Loader2, RefreshCw, Plus, Trash2,
  Sparkles, ExternalLink, Check, X, Edit2, Globe,
  Upload, FileText, AlertCircle,
  Link2, Link2Off, BarChart2,
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
  saveAiRecs,
  getGscStatus,
  getGscAuthUrl,
  connectGscToken,
  disconnectGsc,
  listGscProperties,
  saveGscProperty,
  fetchGscQueries,
  syncGscToKeywords,
  type SeoKeyword,
  type ContentIdea,
  type GscQuery,
} from "@/lib/growthmind/growthmind.seo";
import { HiveMindReportBanner } from "./HiveMindReportBanner";

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

// ── CSV import ───────────────────────────────────────────────────────────────

type ParsedCsvRow = {
  term:       string;
  volume:     number | null;
  difficulty: number | null;
  rank:       number | null;
};

type ColMap = {
  term:       number;
  volume:     number;
  difficulty: number;
  rank:       number;
};

function detectDelimiter(raw: string): string {
  const first = raw.split("\n")[0] ?? "";
  const tabs   = (first.match(/\t/g)  ?? []).length;
  const commas = (first.match(/,/g)   ?? []).length;
  const semis  = (first.match(/;/g)   ?? []).length;
  if (tabs >= commas && tabs >= semis) return "\t";
  if (semis > commas) return ";";
  return ",";
}

function parseRow(line: string, delim: string): string[] {
  if (delim !== ",") return line.split(delim).map(c => c.trim());
  const cells: string[] = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === "," && !inQ) {
      cells.push(cur.trim()); cur = "";
    } else {
      cur += ch;
    }
  }
  cells.push(cur.trim());
  return cells;
}

const TERM_KEYS       = ["keyword", "query", "term", "kw", "key word", "search term", "top queries"];
const VOLUME_KEYS     = ["volume", "vol", "search volume", "monthly volume", "avg monthly searches", "impressions"];
const DIFFICULTY_KEYS = ["difficulty", "diff", "kd", "keyword difficulty", "seo difficulty", "competition"];
const RANK_KEYS       = ["rank", "position", "pos", "ranking", "current rank", "serp position", "avg. position"];

function matchCol(headers: string[], keys: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
    if (keys.some(k => h === k || h.includes(k) || k.includes(h))) return i;
  }
  return -1;
}

function parseCsv(raw: string): { rawRows: string[][]; headers: string[]; colMap: ColMap; errors: string[] } {
  const lines = raw.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { rawRows: [], headers: [], colMap: { term: -1, volume: -1, difficulty: -1, rank: -1 }, errors: ["Need at least a header row and one data row."] };

  const delim   = detectDelimiter(raw);
  const headers = parseRow(lines[0], delim);

  const colMap: ColMap = {
    term:       matchCol(headers, TERM_KEYS),
    volume:     matchCol(headers, VOLUME_KEYS),
    difficulty: matchCol(headers, DIFFICULTY_KEYS),
    rank:       matchCol(headers, RANK_KEYS),
  };

  if (colMap.term === -1) {
    colMap.term = 0;
  }

  const errors: string[] = [];
  const rawRows: string[][] = [];

  for (let i = 1; i < lines.length; i++) {
    rawRows.push(parseRow(lines[i], delim));
  }

  return { rawRows, headers, colMap, errors };
}

function applyColMap(rawRows: string[][], colMap: ColMap): ParsedCsvRow[] {
  const rows: ParsedCsvRow[] = [];
  for (const cells of rawRows) {
    const termRaw = colMap.term >= 0 ? (cells[colMap.term] ?? "") : "";
    const term = termRaw.replace(/^["']|["']$/g, "").trim();
    if (!term) continue;

    const toNum = (idx: number, max?: number): number | null => {
      if (idx < 0) return null;
      const raw = (cells[idx] ?? "").replace(/[^0-9.-]/g, "");
      if (!raw) return null;
      const n = parseFloat(raw);
      if (isNaN(n)) return null;
      if (max !== undefined) return Math.min(max, Math.max(0, Math.round(n)));
      return Math.round(n);
    };

    rows.push({
      term,
      volume:     toNum(colMap.volume),
      difficulty: toNum(colMap.difficulty, 100),
      rank:       toNum(colMap.rank),
    });
  }
  return rows;
}

function CsvImportModal({
  onClose,
  onImport,
  existing,
}: {
  onClose:  () => void;
  onImport: (rows: ParsedCsvRow[]) => void;
  existing: string[];
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [raw,          setRaw]          = useState("");
  const [rawRows,      setRawRows]      = useState<string[][]>([]);
  const [parsed,       setParsed]       = useState<ParsedCsvRow[]>([]);
  const [headers,      setHeaders]      = useState<string[]>([]);
  const [colMap,       setColMap]       = useState<ColMap>({ term: -1, volume: -1, difficulty: -1, rank: -1 });
  const [errors,       setErrors]       = useState<string[]>([]);
  const [skipDupes,    setSkipDupes]    = useState(true);
  const [dragging,     setDragging]     = useState(false);

  const process = useCallback((text: string) => {
    setRaw(text);
    if (!text.trim()) { setRawRows([]); setParsed([]); setHeaders([]); setErrors([]); return; }
    const result = parseCsv(text);
    setRawRows(result.rawRows);
    setHeaders(result.headers);
    setColMap(result.colMap);
    setParsed(applyColMap(result.rawRows, result.colMap));
    setErrors(result.errors);
  }, []);

  function updateColMap(field: keyof ColMap, idx: number) {
    setColMap(prev => {
      const next = { ...prev, [field]: idx };
      setParsed(applyColMap(rawRows, next));
      return next;
    });
  }

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = e => process(e.target?.result as string ?? "");
    reader.readAsText(file);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  const toImport = skipDupes
    ? parsed.filter(r => !existing.includes(r.term.toLowerCase()))
    : parsed;

  const duplicateCount = parsed.length - toImport.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl border border-white/[0.08] bg-[#0f1117] shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] shrink-0">
          <div className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-emerald-400" />
            <p className="text-sm font-semibold">Import Keywords from CSV</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* Drop zone / file picker */}
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={cn(
              "relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed py-6 transition-colors cursor-pointer text-center",
              dragging ? "border-emerald-400/60 bg-emerald-400/[0.04]" : "border-white/[0.1] hover:border-white/[0.18]",
            )}
            onClick={() => fileRef.current?.click()}
          >
            <FileText className="h-7 w-7 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              Drop a <span className="text-foreground font-medium">.csv</span> or <span className="text-foreground font-medium">.tsv</span> file here, or click to browse
            </p>
            <p className="text-[11px] text-muted-foreground/60">
              Ahrefs, SEMrush, Google Search Console exports all work
            </p>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.tsv,.txt"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
          </div>

          {/* Paste area */}
          <div className="space-y-1.5">
            <Label className="text-[10px] text-muted-foreground">Or paste CSV / TSV data</Label>
            <textarea
              rows={5}
              className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-xs font-mono resize-none focus:outline-none focus:border-emerald-500/40 placeholder:text-muted-foreground/40"
              placeholder={"keyword,volume,difficulty,rank\nbuy solar panels,2400,35,14\nbest solar inverter,1200,42,\n…"}
              value={raw}
              onChange={e => process(e.target.value)}
            />
          </div>

          {/* Column mapping — editable dropdowns */}
          {headers.length > 0 && (
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold text-muted-foreground">Column mapping</p>
                <p className="text-[10px] text-muted-foreground/50">Override any auto-detected column below</p>
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {(["term", "volume", "difficulty", "rank"] as (keyof ColMap)[]).map(field => {
                  const label = field === "term" ? "Keyword" : field.charAt(0).toUpperCase() + field.slice(1);
                  const isRequired = field === "term";
                  return (
                    <div key={field} className="flex flex-col gap-1">
                      <label className="text-[10px] text-muted-foreground/70 flex items-center gap-1">
                        {label}
                        {isRequired && <span className="text-red-400/70">*</span>}
                      </label>
                      <select
                        value={colMap[field]}
                        onChange={e => updateColMap(field, Number(e.target.value))}
                        className="w-full rounded-md border border-white/[0.08] bg-[#0f1117] px-2 py-1 text-[11px] text-foreground focus:outline-none focus:border-emerald-500/40 appearance-none cursor-pointer"
                      >
                        {!isRequired && (
                          <option value={-1} className="bg-[#0f1117] text-muted-foreground">— not mapped —</option>
                        )}
                        {headers.map((h, i) => (
                          <option key={i} value={i} className="bg-[#0f1117]">{h || `Column ${i + 1}`}</option>
                        ))}
                      </select>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Errors */}
          {errors.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/[0.05] px-3 py-2.5">
              <AlertCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
              <div className="text-xs text-red-400 space-y-0.5">
                {errors.map((e, i) => <p key={i}>{e}</p>)}
              </div>
            </div>
          )}

          {/* Preview table */}
          {parsed.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold text-muted-foreground">
                  Preview — {parsed.length} row{parsed.length !== 1 ? "s" : ""} parsed
                  {duplicateCount > 0 && (
                    <span className="ml-1 text-amber-400/70">
                      ({duplicateCount} duplicate{duplicateCount !== 1 ? "s" : ""})
                    </span>
                  )}
                </p>
                <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-muted-foreground select-none">
                  <input
                    type="checkbox"
                    checked={skipDupes}
                    onChange={e => setSkipDupes(e.target.checked)}
                    className="accent-emerald-500 h-3 w-3"
                  />
                  Skip already-tracked keywords
                </label>
              </div>
              <div className="overflow-x-auto rounded-lg border border-white/[0.06] max-h-52">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-[#0f1117] z-10">
                    <tr className="border-b border-white/[0.06]">
                      {["Keyword", "Volume", "Difficulty", "Rank"].map(h => (
                        <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground/60">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {parsed.slice(0, 200).map((row, i) => {
                      const isDupe = existing.includes(row.term.toLowerCase());
                      return (
                        <tr
                          key={i}
                          className={cn(
                            "transition-colors",
                            isDupe && skipDupes ? "opacity-40 line-through" : "hover:bg-white/[0.02]",
                          )}
                        >
                          <td className="px-3 py-1.5 font-medium max-w-[200px] truncate">{row.term}</td>
                          <td className="px-3 py-1.5 tabular-nums text-muted-foreground">
                            {row.volume !== null ? row.volume.toLocaleString() : "—"}
                          </td>
                          <td className={cn("px-3 py-1.5 tabular-nums font-semibold", diffColor(row.difficulty))}>
                            {row.difficulty !== null ? row.difficulty : "—"}
                          </td>
                          <td className="px-3 py-1.5 tabular-nums text-muted-foreground">
                            {row.rank !== null ? `#${row.rank}` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                    {parsed.length > 200 && (
                      <tr>
                        <td colSpan={4} className="px-3 py-2 text-center text-muted-foreground/60 text-[11px]">
                          … and {parsed.length - 200} more rows
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-white/[0.06] shrink-0 bg-[#0f1117]">
          <Button variant="ghost" size="sm" onClick={onClose} className="text-xs h-8">
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => { if (toImport.length > 0) onImport(toImport); }}
            disabled={toImport.length === 0}
            className="h-8 text-xs"
          >
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            Import {toImport.length > 0 ? `${toImport.length} keyword${toImport.length !== 1 ? "s" : ""}` : "keywords"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── GSC Suggest Modal ─────────────────────────────────────────────────────────

function GscSuggestModal({
  queries,
  loading,
  error,
  existing,
  onClose,
  onImport,
}: {
  queries:  GscQuery[];
  loading:  boolean;
  error:    string | null;
  existing: string[];
  onClose:  () => void;
  onImport: (selected: GscQuery[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [skipDupes, setSkipDupes] = useState(true);

  const visible = skipDupes
    ? queries.filter(q => !existing.includes(q.term.toLowerCase()))
    : queries;

  const dupeCount = queries.length - visible.length;

  function toggleAll() {
    if (selected.size === visible.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(visible.map(q => q.term)));
    }
  }

  function toggle(term: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(term)) next.delete(term);
      else next.add(term);
      return next;
    });
  }

  const toImport = visible.filter(q => selected.has(q.term));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl border border-white/[0.08] bg-[#0f1117] shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06] shrink-0">
          <div className="flex items-center gap-2">
            <BarChart2 className="h-4 w-4 text-blue-400" />
            <p className="text-sm font-semibold">Auto-suggest from Search Console</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-blue-400" />
              <p className="text-sm">Fetching your top queries from Search Console…</p>
            </div>
          )}

          {error && !loading && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/[0.05] px-3 py-3">
              <AlertCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-red-400">Failed to fetch queries</p>
                <p className="text-xs text-red-400/80">{error}</p>
              </div>
            </div>
          )}

          {!loading && !error && queries.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
              <Search className="h-6 w-6" />
              <p className="text-sm">No search queries found for this property in the last 90 days.</p>
            </div>
          )}

          {!loading && !error && queries.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold text-muted-foreground">
                  Top {queries.length} queries by impressions (last 90 days)
                  {dupeCount > 0 && (
                    <span className="ml-1 text-amber-400/70">
                      · {dupeCount} already tracked
                    </span>
                  )}
                </p>
                <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-muted-foreground select-none">
                  <input
                    type="checkbox"
                    checked={skipDupes}
                    onChange={e => setSkipDupes(e.target.checked)}
                    className="accent-blue-500 h-3 w-3"
                  />
                  Hide already-tracked
                </label>
              </div>

              <div className="overflow-x-auto rounded-lg border border-white/[0.06]">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-[#0f1117] z-10">
                    <tr className="border-b border-white/[0.06]">
                      <th className="px-3 py-2 w-8">
                        <input
                          type="checkbox"
                          checked={selected.size === visible.length && visible.length > 0}
                          onChange={toggleAll}
                          className="accent-blue-500 h-3 w-3"
                        />
                      </th>
                      {["Query", "Clicks", "Impressions", "Avg Position"].map(h => (
                        <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.07em] text-muted-foreground/60">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {visible.map((q, i) => {
                      const isDupe = existing.includes(q.term.toLowerCase());
                      const checked = selected.has(q.term);
                      return (
                        <tr
                          key={i}
                          onClick={() => toggle(q.term)}
                          className={cn(
                            "cursor-pointer transition-colors",
                            checked ? "bg-blue-500/[0.06]" : "hover:bg-white/[0.02]",
                            isDupe && skipDupes ? "opacity-40" : "",
                          )}
                        >
                          <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggle(q.term)}
                              className="accent-blue-500 h-3 w-3"
                            />
                          </td>
                          <td className="px-3 py-2 font-medium max-w-[220px] truncate">{q.term}</td>
                          <td className="px-3 py-2 tabular-nums text-muted-foreground">{q.clicks.toLocaleString()}</td>
                          <td className="px-3 py-2 tabular-nums text-muted-foreground">{q.impressions.toLocaleString()}</td>
                          <td className="px-3 py-2 tabular-nums text-muted-foreground">
                            {q.position !== null ? `#${q.position}` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <p className="text-[11px] text-muted-foreground/60">
                Imported queries use GSC clicks as volume and avg position as rank. Keyword difficulty is not available from Search Console — you can fill that in manually after import.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-white/[0.06] shrink-0 bg-[#0f1117]">
          <Button variant="ghost" size="sm" onClick={onClose} className="text-xs h-8">
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => { if (toImport.length > 0) onImport(toImport); }}
            disabled={toImport.length === 0 || loading}
            className="h-8 text-xs bg-blue-600 hover:bg-blue-500 text-white"
          >
            <BarChart2 className="mr-1.5 h-3.5 w-3.5" />
            Add {toImport.length > 0 ? `${toImport.length} query${toImport.length !== 1 ? "s" : ""}` : "queries"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Keyword row — view or edit ────────────────────────────────────────────────

function GscBadge() {
  return (
    <span className="inline-flex items-center rounded-full border border-blue-500/30 bg-blue-500/[0.08] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-blue-400 select-none ml-1.5">
      GSC
    </span>
  );
}

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

  const hasGsc = kw.gsc_clicks != null || kw.gsc_impressions != null;

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
        {/* GSC columns — read-only even in edit mode */}
        <td className="px-3 py-2 tabular-nums text-muted-foreground/60 text-center">
          {kw.gsc_clicks != null ? kw.gsc_clicks.toLocaleString() : "—"}
        </td>
        <td className="px-3 py-2 tabular-nums text-muted-foreground/60 text-center">
          {kw.gsc_impressions != null ? kw.gsc_impressions.toLocaleString() : "—"}
        </td>
        <td className="px-3 py-2 tabular-nums text-muted-foreground/60 text-center">
          {kw.gsc_position != null ? `#${kw.gsc_position}` : "—"}
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
      <td className="px-4 py-2.5 font-medium">
        <span className="inline-flex items-center">
          {kw.term}
          {hasGsc && <GscBadge />}
        </span>
      </td>
      <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
        {kw.volume !== null ? kw.volume.toLocaleString() : "—"}
      </td>
      <td className={cn("px-4 py-2.5 tabular-nums font-semibold", diffColor(kw.difficulty))}>
        {kw.difficulty !== null ? kw.difficulty : "—"}
      </td>
      <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
        {kw.rank !== null ? `#${kw.rank}` : <span className="text-amber-400/80">Not ranking</span>}
      </td>
      <td className="px-4 py-2.5 tabular-nums text-center text-blue-300">
        {kw.gsc_clicks != null ? kw.gsc_clicks.toLocaleString() : <span className="text-muted-foreground/40">—</span>}
      </td>
      <td className="px-4 py-2.5 tabular-nums text-center text-blue-300/80">
        {kw.gsc_impressions != null ? kw.gsc_impressions.toLocaleString() : <span className="text-muted-foreground/40">—</span>}
      </td>
      <td className="px-4 py-2.5 tabular-nums text-center text-blue-300/70">
        {kw.gsc_position != null ? `#${kw.gsc_position}` : <span className="text-muted-foreground/40">—</span>}
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
    <div className="flex items-center gap-3 px-4 py-3 group hover:bg-white/[0.02] transition-colors border-b border-white/[0.04] last:border-0">
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

// ── GSC Connection Panel ──────────────────────────────────────────────────────

function GscConnectionPanel({
  gscStatus,
  gscLoading,
  onConnect,
  onDisconnect,
  onSuggest,
  connecting,
  siteUrl,
}: {
  gscStatus:    { configured: boolean; connected: boolean; propertyUrl: string | null; autoMatched?: boolean } | undefined;
  gscLoading:   boolean;
  onConnect:    () => void;
  onDisconnect: () => void;
  onSuggest:    (propertyUrl: string) => void;
  connecting:   boolean;
  siteUrl:      string;
}) {
  const [showPropertyPicker, setShowPropertyPicker] = useState(false);
  const [properties, setProperties]                 = useState<string[]>([]);
  const [propsLoading, setPropsLoading]             = useState(false);
  const [propsError, setPropsError]                 = useState<string | null>(null);
  const [selectedProp, setSelectedProp]             = useState<string>("");

  const listPropsFn    = useServerFn(listGscProperties);
  const savePropFn     = useServerFn(saveGscProperty);
  const qc             = useQueryClient();

  async function openPropertyPicker() {
    setShowPropertyPicker(true);
    setPropsLoading(true);
    setPropsError(null);
    try {
      const res = await listPropsFn();
      setProperties(res.sites);
      const current = gscStatus?.propertyUrl ?? "";
      if (current) {
        setSelectedProp(current);
      } else {
        const autoMatch = siteUrl ? findBestGscMatch(siteUrl, res.sites) : null;
        setSelectedProp(autoMatch || res.sites[0] || "");
      }
    } catch (e: any) {
      setPropsError(e.message);
    } finally {
      setPropsLoading(false);
    }
  }

  async function saveProperty() {
    if (!selectedProp) return;
    await savePropFn({ data: { propertyUrl: selectedProp, autoMatched: false } });
    qc.invalidateQueries({ queryKey: ["gsc-status"] });
    setShowPropertyPicker(false);
  }

  if (gscLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-xs py-1">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Checking Search Console…
      </div>
    );
  }

  if (!gscStatus?.configured) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.05] px-3 py-2.5 text-xs text-amber-400/90">
        <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span>
          Google OAuth credentials are not configured. Add <code className="font-mono text-amber-300">GOOGLE_CLIENT_ID</code> and <code className="font-mono text-amber-300">GOOGLE_CLIENT_SECRET</code> to your Replit secrets.
        </span>
      </div>
    );
  }

  if (!gscStatus.connected) {
    return (
      <Button
        size="sm" variant="outline"
        onClick={onConnect}
        disabled={connecting}
        className="h-7 text-xs border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
      >
        {connecting
          ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
          : <Link2 className="mr-1.5 h-3 w-3" />
        }
        Connect Search Console
      </Button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Property selector */}
      {gscStatus.propertyUrl ? (
        <div className="flex items-center gap-1.5 rounded-md border border-blue-500/20 bg-blue-500/[0.05] px-2.5 py-1.5">
          <BarChart2 className="h-3 w-3 text-blue-400 shrink-0" />
          <span className="text-xs text-blue-300 font-medium max-w-[200px] truncate">{gscStatus.propertyUrl}</span>
          {gscStatus.autoMatched && (
            <span
              title="This property was matched automatically from your site URL. Click the edit icon to change it."
              className="flex items-center gap-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/[0.08] px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400 select-none"
            >
              <Check className="h-2.5 w-2.5" />
              Auto-matched
            </span>
          )}
          <button
            onClick={openPropertyPicker}
            className="ml-1 text-muted-foreground hover:text-foreground transition-colors"
            title="Change property"
          >
            <Edit2 className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <Button
          size="sm" variant="outline"
          onClick={openPropertyPicker}
          className="h-7 text-xs border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
        >
          <BarChart2 className="mr-1.5 h-3 w-3" />
          Pick property
        </Button>
      )}

      <Button
        size="sm"
        onClick={() => gscStatus.propertyUrl && onSuggest(gscStatus.propertyUrl)}
        disabled={!gscStatus.propertyUrl}
        className="h-7 text-xs bg-blue-600 hover:bg-blue-500 text-white"
        title={gscStatus.propertyUrl ? undefined : "Pick a Search Console property first"}
      >
        <Sparkles className="mr-1.5 h-3 w-3" />
        Auto-suggest
      </Button>

      <Button
        size="sm" variant="ghost"
        onClick={onDisconnect}
        className="h-7 text-xs text-muted-foreground hover:text-red-400"
        title="Disconnect Search Console"
      >
        <Link2Off className="h-3 w-3" />
      </Button>

      {/* Property picker dropdown */}
      {showPropertyPicker && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) setShowPropertyPicker(false); }}
        >
          <div className="w-full max-w-sm rounded-2xl border border-white/[0.08] bg-[#0f1117] shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.06]">
              <p className="text-sm font-semibold">Select Search Console property</p>
              <button onClick={() => setShowPropertyPicker(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              {propsLoading && (
                <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
                  <span className="text-xs">Loading properties…</span>
                </div>
              )}
              {propsError && (
                <div className="text-xs text-red-400 py-2">{propsError}</div>
              )}
              {!propsLoading && !propsError && properties.length === 0 && (
                <p className="text-xs text-muted-foreground py-4 text-center">No properties found in this account.</p>
              )}
              {!propsLoading && !propsError && properties.map(p => (
                <label key={p} className="flex items-center gap-2.5 cursor-pointer group">
                  <input
                    type="radio"
                    name="gsc-property"
                    value={p}
                    checked={selectedProp === p}
                    onChange={() => setSelectedProp(p)}
                    className="accent-blue-500 h-3.5 w-3.5"
                  />
                  <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors truncate">{p}</span>
                </label>
              ))}
            </div>
            <div className="flex items-center justify-between px-5 py-4 border-t border-white/[0.06]">
              <Button variant="ghost" size="sm" onClick={() => setShowPropertyPicker(false)} className="text-xs h-7">
                Cancel
              </Button>
              <Button size="sm" onClick={saveProperty} disabled={!selectedProp} className="text-xs h-7">
                <Check className="mr-1.5 h-3 w-3" />
                Select
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────


// ── GSC property URL matcher ──────────────────────────────────────────────────

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    return u.hostname.replace(/^www\./, "") + u.pathname.replace(/\/+$/, "");
  } catch {
    return url.trim().toLowerCase().replace(/^www\./, "").replace(/\/+$/, "");
  }
}

function findBestGscMatch(siteUrl: string, properties: string[]): string | null {
  if (!siteUrl || properties.length === 0) return null;

  const normalizedSite = normalizeUrl(siteUrl);

  let hostname = normalizedSite.split("/")[0];

  for (const prop of properties) {
    if (prop.toLowerCase() === siteUrl.toLowerCase()) return prop;
    const trimProp = prop.replace(/\/+$/, "");
    if (trimProp.toLowerCase() === siteUrl.toLowerCase().replace(/\/+$/, "")) return prop;
  }

  for (const prop of properties) {
    if (normalizeUrl(prop) === normalizedSite) return prop;
  }

  for (const prop of properties) {
    if (prop.startsWith("sc-domain:")) {
      const domain = prop.slice("sc-domain:".length).replace(/^www\./, "");
      if (domain === hostname || hostname.endsWith("." + domain)) return prop;
    }
  }

  return null;
}

// ── Main component ───────────────────────────────────────────────────────────

export function GrowthMindSEO() {
  const qc            = useQueryClient();
  const getSiteFn     = useServerFn(getSeoSite);
  const saveSiteFn    = useServerFn(saveSeoSite);
  const saveAiRecsFn  = useServerFn(saveAiRecs);
  const aiRespFn      = useServerFn(getGrowthMindAIResponse);
  const getDataFn     = useServerFn(getGrowthMindData);
  const getStatusFn   = useServerFn(getGscStatus);
  const getAuthUrlFn  = useServerFn(getGscAuthUrl);
  const connectFn     = useServerFn(connectGscToken);
  const disconnectFn  = useServerFn(disconnectGsc);
  const fetchQueryFn  = useServerFn(fetchGscQueries);
  const listPropsFn   = useServerFn(listGscProperties);
  const savePropFn    = useServerFn(saveGscProperty);
  const syncGscFn     = useServerFn(syncGscToKeywords);
  const navigate      = useNavigate();

  const [urlInput, setUrlInput]         = useState("");
  const [saving, setSaving]             = useState(false);
  const [saveMsg, setSaveMsg]           = useState<{ text: string; isError: boolean } | null>(null);
  const [aiInsight, setAiInsight]       = useState<string | null>(null);
  const [aiRecAt, setAiRecAt]           = useState<string | null>(null);
  const [aiLoading, setAiLoading]       = useState(false);
  const aiRecRelTime = useRelativeTime(aiRecAt);
  const [aiSuggestedIdeas, setAiSuggestedIdeas] = useState<ContentIdea[]>([]);
  const [dismissedAiIdeaIds, setDismissedAiIdeaIds] = useState<Set<string>>(new Set());

  const [siteId, setSiteId]             = useState<string | undefined>();
  const [siteUrl, setSiteUrl]           = useState("");
  const [keywords, setKeywords]         = useState<SeoKeyword[]>([]);
  const [contentIdeas, setContentIdeas] = useState<ContentIdea[]>([]);

  const [newKw, setNewKw]               = useState({ term: "", volume: "", difficulty: "", rank: "" });
  const [newIdea, setNewIdea]           = useState({ title: "", targetKeyword: "" });
  const [showKwForm, setShowKwForm]     = useState(false);
  const [showIdeaForm, setShowIdeaForm] = useState(false);
  const [showCsvImport, setShowCsvImport] = useState(false);

  // GSC state
  const [gscConnecting, setGscConnecting]   = useState(false);
  const [showGscSuggest, setShowGscSuggest] = useState(false);
  const [gscQueries, setGscQueries]         = useState<GscQuery[]>([]);
  const [gscFetchLoading, setGscFetchLoading] = useState(false);
  const [gscFetchError, setGscFetchError]   = useState<string | null>(null);
  const [gscSyncing, setGscSyncing]         = useState(false);

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

  const { data: gscStatus, isLoading: gscStatusLoading } = useQuery({
    queryKey: ["gsc-status"],
    queryFn:  () => getStatusFn(),
    staleTime: 30_000,
  });

  useEffect(() => {
    const site = siteData?.site;
    if (!site) return;
    setSiteId(site.id);
    setSiteUrl(site.url);
    setKeywords(site.keywords);
    setContentIdeas(site.contentIdeas);
    if (site.aiRecs) setAiInsight(site.aiRecs);
    if (site.aiRecAt) setAiRecAt(site.aiRecAt);
  }, [siteData]);

  // ── Handle GSC OAuth callback (?code= in URL) ─────────────────────────────

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code   = params.get("code");
    const scope  = params.get("scope");
    const state  = params.get("state");

    if (!code || !scope?.includes("webmasters") || !state) return;

    const redirectUri = `${window.location.origin}/growthmind/seo`;

    setGscConnecting(true);

    connectFn({ data: { code, redirectUri, state } })
      .then(async () => {
        // Try to auto-match the site URL against GSC properties
        try {
          const [siteRes, propsRes] = await Promise.all([getSiteFn(), listPropsFn()]);
          const savedUrl = siteRes?.site?.url ?? "";
          if (savedUrl && propsRes.sites.length > 0) {
            const match = findBestGscMatch(savedUrl, propsRes.sites);
            if (match) {
              await savePropFn({ data: { propertyUrl: match, autoMatched: true } });
              flashMsg("Google Search Console connected & property matched!");
            } else {
              flashMsg("Google Search Console connected!");
            }
          } else {
            flashMsg("Google Search Console connected!");
          }
        } catch {
          flashMsg("Google Search Console connected!");
        }
        qc.invalidateQueries({ queryKey: ["gsc-status"] });
      })
      .catch((e: any) => {
        flashMsg("Failed to connect Search Console: " + e.message, true);
      })
      .finally(() => {
        setGscConnecting(false);
        navigate({ to: "/growthmind/seo", replace: true });
      });
  }, []);

  const connected = !!siteUrl;

  function flashMsg(text: string, isError = false) {
    setSaveMsg({ text, isError });
    setTimeout(() => setSaveMsg(null), 4000);
  }

  async function handleConnect() {
    if (!urlInput.trim()) return;
    let url = urlInput.trim();
    if (!url.startsWith("http")) url = "https://" + url;
    setSaving(true);
    try {
      await saveSiteFn({ data: { id: siteId, url, keywords, contentIdeas } });
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
      await saveSiteFn({ data: { id: siteId, url: siteUrl, keywords: kws, contentIdeas: ideas } });
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

  function handleCsvImport(rows: { term: string; volume: number | null; difficulty: number | null; rank: number | null }[]) {
    const newKws: SeoKeyword[] = rows.map(r => ({
      id:         nanoid(),
      term:       r.term,
      volume:     r.volume,
      difficulty: r.difficulty,
      rank:       r.rank,
    }));
    const updated = [...keywords, ...newKws];
    setKeywords(updated);
    setShowCsvImport(false);
    persistAll(updated, contentIdeas);
    flashMsg(`Imported ${newKws.length} keyword${newKws.length !== 1 ? "s" : ""}`);
  }

  // ── GSC ops ────────────────────────────────────────────────────────────────

  async function handleGscConnect() {
    setGscConnecting(true);
    try {
      const redirectUri = `${window.location.origin}/growthmind/seo`;
      const { url } = await getAuthUrlFn({ data: { redirectUri } });
      window.location.href = url;
    } catch (e: any) {
      flashMsg("Failed to start Google auth: " + e.message, true);
      setGscConnecting(false);
    }
  }

  async function handleGscDisconnect() {
    try {
      await disconnectFn();
      qc.invalidateQueries({ queryKey: ["gsc-status"] });
      flashMsg("Search Console disconnected");
    } catch (e: any) {
      flashMsg("Disconnect failed: " + e.message, true);
    }
  }

  async function handleGscSync(propertyUrl: string) {
    if (!siteId) return;
    setGscSyncing(true);
    try {
      const { matched, total } = await syncGscFn({ data: { siteId, propertyUrl } });
      await qc.invalidateQueries({ queryKey: ["growthmind-seo-site"] });
      const { site } = await getSiteFn();
      if (site) setKeywords(site.keywords);
      flashMsg(matched > 0
        ? `Synced GSC data for ${matched} of ${total} keyword${total !== 1 ? "s" : ""}`
        : `No GSC matches found for your ${total} tracked keyword${total !== 1 ? "s" : ""}`
      );
    } catch (e: any) {
      flashMsg("GSC sync failed: " + e.message, true);
    } finally {
      setGscSyncing(false);
    }
  }

  async function handleGscSuggest(propertyUrl: string) {
    setShowGscSuggest(true);
    setGscFetchLoading(true);
    setGscFetchError(null);
    setGscQueries([]);
    try {
      const { queries } = await fetchQueryFn({ data: { propertyUrl, rowLimit: 100 } });
      setGscQueries(queries);
    } catch (e: any) {
      setGscFetchError(e.message);
    } finally {
      setGscFetchLoading(false);
    }
  }

  function handleGscImport(selected: GscQuery[]) {
    const newKws: SeoKeyword[] = selected.map(q => ({
      id:         nanoid(),
      term:       q.term,
      volume:     q.clicks > 0 ? q.clicks : null,
      difficulty: null,
      rank:       q.position,
    }));
    const updated = [...keywords, ...newKws];
    setKeywords(updated);
    setShowGscSuggest(false);
    persistAll(updated, contentIdeas);
    flashMsg(`Added ${newKws.length} keyword${newKws.length !== 1 ? "s" : ""} from Search Console`);
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
    setAiSuggestedIdeas([]);
    setDismissedAiIdeaIds(new Set());
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
        data: {
          messages: [{
            role: "user",
            content: `Here are my tracked SEO keywords for ${siteUrl}:\n\n${kwSummary}\n\nBased on this data, do two things:\n\n1. In 3-4 sentences, identify the top priority keyword opportunities (high volume, lower difficulty, not yet ranking) and suggest the type of content that would best target them.\n\n2. Suggest 3-5 specific content ideas. Output them as a JSON block at the end of your reply using this exact format:\n\nCONTENT_IDEAS_JSON:\n[{"title":"...","targetKeyword":"..."},...]`,
          }],
          platformData,
          personality: "professional",
        },
      });

      // Split out the JSON block from the text insight
      const MARKER = "CONTENT_IDEAS_JSON:";
      const markerIdx = reply.indexOf(MARKER);
      let textPart = reply;
      let parsedIdeas: ContentIdea[] = [];

      if (markerIdx !== -1) {
        textPart = reply.slice(0, markerIdx).trim();
        const jsonStr = reply.slice(markerIdx + MARKER.length).trim();
        try {
          const raw = JSON.parse(jsonStr) as Array<{ title: string; targetKeyword: string }>;
          if (Array.isArray(raw)) {
            parsedIdeas = raw
              .filter(item => typeof item.title === "string" && item.title.trim())
              .map(item => ({
                id:            nanoid(),
                title:         item.title.trim(),
                targetKeyword: (item.targetKeyword ?? "").trim(),
                status:        "idea" as const,
              }));
          }
        } catch {
          // JSON parse failed — still show text insight, just no cards
        }
      }

      const now = new Date().toISOString();
      setAiInsight(textPart);
      setAiRecAt(now);
      setAiSuggestedIdeas(parsedIdeas);
      if (siteId) {
        try {
          await saveAiRecsFn({ data: { id: siteId, text: textPart } });
        } catch {
          // non-critical — insight is already shown in UI
        }
      }
    } catch (e: any) {
      setAiInsight("Unable to generate recommendations: " + e.message);
    } finally {
      setAiLoading(false);
    }
  }

  function addIdeaFromAI(idea: ContentIdea) {
    const updated = [...contentIdeas, { ...idea, status: "idea" as const }];
    setContentIdeas(updated);
    setAiSuggestedIdeas(prev => prev.filter(i => i.id !== idea.id));
    persistAll(keywords, updated);
  }

  function dismissAiIdea(id: string) {
    setDismissedAiIdeaIds(prev => new Set([...prev, id]));
  }

  // ── Existing keyword terms (lowercased) for dupe detection ─────────────────

  const existingTerms = keywords.map(k => k.term.toLowerCase());

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
            {gscConnecting && (
              <span className="text-xs text-blue-400 flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                Connecting…
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

        <HiveMindReportBanner domain="SEO" briefing={aiInsight} />

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

            {/* Google Search Console integration */}
            <div className="rounded-xl border border-white/[0.06] bg-card/60 p-5">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-sm font-semibold flex items-center gap-2">
                    <BarChart2 className="h-4 w-4 text-blue-400" />
                    Google Search Console
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {gscStatus?.connected
                      ? "Connected — click Auto-suggest to pull your top search queries"
                      : "Connect to auto-suggest keywords from your real search data"
                    }
                  </p>
                </div>
                <GscConnectionPanel
                  gscStatus={gscStatus}
                  gscLoading={gscStatusLoading}
                  onConnect={handleGscConnect}
                  onDisconnect={handleGscDisconnect}
                  onSuggest={handleGscSuggest}
                  connecting={gscConnecting}
                  siteUrl={siteUrl}
                />
              </div>
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
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      {gscStatus?.connected && gscStatus?.propertyUrl && keywords.length > 0 && (
                        <Button
                          size="sm"
                          onClick={() => handleGscSync(gscStatus.propertyUrl!)}
                          disabled={gscSyncing}
                          className="h-7 text-xs bg-blue-700 hover:bg-blue-600 text-white"
                        >
                          {gscSyncing
                            ? <><Loader2 className="mr-1 h-3 w-3 animate-spin" />Syncing…</>
                            : <><RefreshCw className="mr-1 h-3 w-3" />Sync from GSC</>
                          }
                        </Button>
                      )}
                      {gscStatus?.connected && gscStatus?.propertyUrl && (
                        <Button
                          size="sm"
                          onClick={() => handleGscSuggest(gscStatus.propertyUrl!)}
                          className="h-7 text-xs bg-blue-600 hover:bg-blue-500 text-white"
                        >
                          <Sparkles className="mr-1 h-3 w-3" />
                          Auto-suggest from Search Console
                        </Button>
                      )}
                      <Button
                        size="sm" variant="outline"
                        onClick={() => setShowCsvImport(true)}
                        className="h-7 text-xs"
                      >
                        <Upload className="mr-1 h-3 w-3" />
                        Import CSV
                      </Button>
                      <Button
                        size="sm" variant="outline"
                        onClick={() => { setShowKwForm(v => !v); }}
                        className="h-7 text-xs"
                      >
                        <Plus className="mr-1 h-3 w-3" />
                        Add keyword
                      </Button>
                    </div>
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
                    <div className="px-4 py-8 text-center space-y-3">
                      <p className="text-sm text-muted-foreground">
                        No keywords tracked yet. Add your first keyword, import from CSV, or pull from Search Console.
                      </p>
                      <div className="flex items-center justify-center gap-2 flex-wrap">
                        {gscStatus?.connected && gscStatus?.propertyUrl && (
                          <Button
                            variant="outline" size="sm"
                            onClick={() => handleGscSuggest(gscStatus.propertyUrl!)}
                            className="text-xs h-7 border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                          >
                            <Sparkles className="mr-1 h-3 w-3" />
                            Auto-suggest from Search Console
                          </Button>
                        )}
                        <Button
                          variant="outline" size="sm"
                          onClick={() => setShowCsvImport(true)}
                          className="text-xs h-7"
                        >
                          <Upload className="mr-1 h-3 w-3" />
                          Import from CSV
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-white/[0.06]">
                            {["Keyword", "Volume / mo", "Difficulty", "Current Rank"].map(h => (
                              <th key={h} className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/60">
                                {h}
                              </th>
                            ))}
                            {["Clicks", "Impressions", "GSC Pos"].map(h => (
                              <th key={h} className="px-4 py-2 text-center text-[10px] font-semibold uppercase tracking-[0.08em] text-blue-400/60">
                                {h}
                              </th>
                            ))}
                            <th className="px-4 py-2" />
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
                      <div className="flex items-center gap-3">
                        {aiRecAt && !aiLoading && (
                          <span className="text-[11px] text-muted-foreground">
                            Last generated: {aiRecRelTime}
                          </span>
                        )}
                        <Button
                          variant="outline" size="sm"
                          onClick={handleAIRecommendations}
                          disabled={aiLoading}
                          className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                        >
                          {aiLoading
                            ? <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />Analysing…</>
                            : aiInsight
                              ? <><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Refresh recommendations</>
                              : <><Sparkles className="mr-1.5 h-3.5 w-3.5" />Generate recommendations</>
                          }
                        </Button>
                      </div>
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
                      <p className="mt-3 text-sm leading-relaxed whitespace-pre-line text-muted-foreground">{aiInsight}</p>
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

                  {/* AI-suggested idea cards */}
                  {aiSuggestedIdeas.filter(i => !dismissedAiIdeaIds.has(i.id)).length > 0 && (
                    <div className="px-4 py-3 border-b border-white/[0.06] bg-emerald-500/[0.03] space-y-2">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-emerald-400/70 flex items-center gap-1.5">
                        <Sparkles className="h-3 w-3" />
                        AI Suggestions — click Add to track an idea
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {aiSuggestedIdeas
                          .filter(i => !dismissedAiIdeaIds.has(i.id))
                          .map(idea => (
                            <div
                              key={idea.id}
                              className="flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.05] px-3 py-2.5"
                            >
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium leading-snug">{idea.title}</p>
                                {idea.targetKeyword && (
                                  <p className="text-[11px] text-muted-foreground mt-0.5">
                                    Keyword: <span className="text-emerald-400/80">{idea.targetKeyword}</span>
                                  </p>
                                )}
                              </div>
                              <div className="flex items-center gap-1 shrink-0 mt-0.5">
                                <button
                                  onClick={() => addIdeaFromAI(idea)}
                                  title="Add to ideas"
                                  className="flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                                >
                                  <Plus className="h-3 w-3" />
                                  Add
                                </button>
                                <button
                                  onClick={() => dismissAiIdea(idea.id)}
                                  title="Dismiss"
                                  className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            </div>
                          ))
                        }
                      </div>
                    </div>
                  )}

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

                  {contentIdeas.length === 0 && aiSuggestedIdeas.filter(i => !dismissedAiIdeaIds.has(i.id)).length === 0 ? (
                    <div className="px-4 py-8 text-center">
                      <p className="text-sm text-muted-foreground">
                        No content ideas yet. Add your first content opportunity.
                      </p>
                    </div>
                  ) : contentIdeas.length === 0 ? null : (
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

      {/* CSV import modal */}
      {showCsvImport && (
        <CsvImportModal
          onClose={() => setShowCsvImport(false)}
          onImport={handleCsvImport}
          existing={existingTerms}
        />
      )}

      {/* GSC suggest modal */}
      {showGscSuggest && (
        <GscSuggestModal
          queries={gscQueries}
          loading={gscFetchLoading}
          error={gscFetchError}
          existing={existingTerms}
          onClose={() => setShowGscSuggest(false)}
          onImport={handleGscImport}
        />
      )}
    </GrowthMindShell>
  );
}
