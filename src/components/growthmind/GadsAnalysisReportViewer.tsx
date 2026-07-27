/**
 * Tabbed viewer for a stored GrowthMind Google Ads deep-analysis report.
 * Renders the sections JSONB honestly (including per-section errors),
 * with CSV export for tabular tabs and a print/PDF export of the full report.
 */
import { useMemo, useState } from "react";
import {
  BarChart3, Search, KeyRound, MinusCircle, Megaphone, LayoutTemplate,
  Home, Swords, ClipboardCheck, Eye, FileDown, Printer, AlertTriangle,
  CheckCircle2, Database, Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Report = {
  id: string;
  campaign_id: string | null;
  campaign_name: string | null;
  date_from: string;
  date_to: string;
  status: string;
  sections: Record<string, any>;
  source_meta: Record<string, any> | null;
  created_at: string;
};

const TABS = [
  { key: "summary",    label: "Summary",          icon: Activity },
  { key: "campaign",   label: "Campaign",         icon: BarChart3 },
  { key: "keywords",   label: "Keywords",         icon: KeyRound },
  { key: "search_terms", label: "Search Terms",   icon: Search },
  { key: "opportunities", label: "Opportunities", icon: CheckCircle2 },
  { key: "negatives",  label: "Negatives",        icon: MinusCircle },
  { key: "ads",        label: "Ads & Concepts",   icon: Megaphone },
  { key: "landing",    label: "Landing Pages",    icon: LayoutTemplate },
  { key: "homepage",   label: "Homepage",         icon: Home },
  { key: "competitors", label: "Competitors",     icon: Swords },
  { key: "changes",    label: "Change Requests",  icon: ClipboardCheck },
  { key: "evidence",   label: "Evidence",         icon: Database },
] as const;

type TabKey = typeof TABS[number]["key"];

// ── CSV export helpers ────────────────────────────────────────────────────────

function toCsv(rows: Array<Record<string, any>>): string {
  if (!rows.length) return "";
  const cols = Array.from(new Set(rows.flatMap(r => Object.keys(r))));
  const esc = (v: any) => {
    const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map(r => cols.map(c => esc(r[c])).join(","))].join("\n");
}

function downloadCsv(filename: string, rows: Array<Record<string, any>>) {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ── small render primitives ──────────────────────────────────────────────────

function SectionError({ error }: { error?: string | null }) {
  if (!error) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 mb-3">
      <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
      <p className="text-[11px] text-amber-300/90">{error}</p>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: any; tone?: string }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={cn("text-sm font-semibold tabular-nums", tone)}>{value ?? "—"}</p>
    </div>
  );
}

function DataTable({ columns, rows, maxRows = 200 }: {
  columns: Array<{ key: string; label: string; render?: (row: any) => any }>;
  rows: any[]; maxRows?: number;
}) {
  if (!rows?.length) return <p className="text-xs text-muted-foreground py-3">No rows.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-white/[0.06]">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="bg-white/[0.03] text-left">
            {columns.map(c => (
              <th key={c.key} className="px-2.5 py-2 font-medium text-muted-foreground whitespace-nowrap">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, maxRows).map((r, i) => (
            <tr key={i} className="border-t border-white/[0.04]">
              {columns.map(c => (
                <td key={c.key} className="px-2.5 py-1.5 align-top">
                  {c.render ? c.render(r) : (r[c.key] ?? "—")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > maxRows && (
        <p className="text-[10px] text-muted-foreground px-2.5 py-1.5 border-t border-white/[0.04]">
          Showing {maxRows} of {rows.length} rows — export CSV for the full set.
        </p>
      )}
    </div>
  );
}

const CLASS_TONES: Record<string, string> = {
  winner: "bg-emerald-500/15 text-emerald-400",
  converting: "bg-emerald-500/15 text-emerald-400",
  potential: "bg-sky-500/15 text-sky-400",
  relevant_no_conversion: "bg-sky-500/15 text-sky-400",
  underperformer: "bg-amber-500/15 text-amber-400",
  high_cost_no_conversion: "bg-red-500/15 text-red-400",
  money_waster: "bg-red-500/15 text-red-400",
  irrelevant: "bg-red-500/15 text-red-300",
  low_data: "bg-white/[0.06] text-muted-foreground",
};

function ClassBadge({ v }: { v: string }) {
  return (
    <span className={cn("inline-block rounded-full px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap", CLASS_TONES[v] ?? "bg-white/[0.06] text-muted-foreground")}>
      {String(v ?? "").replace(/_/g, " ")}
    </span>
  );
}

function Prose({ text }: { text: any }) {
  if (text == null) return null;
  return <p className="text-xs text-foreground/85 leading-relaxed whitespace-pre-wrap">{typeof text === "string" ? text : JSON.stringify(text, null, 1)}</p>;
}

// ── tab bodies ────────────────────────────────────────────────────────────────

function SummaryTab({ s, cur }: { s: Record<string, any>; cur: string }) {
  const es = s.executive_summary ?? {};
  const t = es.totalsSnapshot ?? {};
  return (
    <div className="space-y-4">
      <SectionError error={es.error} />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Spend" value={t.spend != null ? `${cur}${t.spend}` : "—"} />
        <Stat label="Clicks" value={t.clicks} />
        <Stat label="Conversions" value={t.conversions} tone={t.conversions === 0 ? "text-red-400" : "text-emerald-400"} />
        <Stat label="CTR" value={t.ctrPct != null ? `${t.ctrPct}%` : "—"} />
      </div>
      {es.headline && <h3 className="text-sm font-semibold">{es.headline}</h3>}
      <Prose text={es.situation} />
      {Array.isArray(es.rootCauses) && es.rootCauses.length > 0 && (
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">Root causes</p>
          <ul className="list-disc pl-4 space-y-1">{es.rootCauses.map((c: string, i: number) => <li key={i} className="text-xs text-foreground/85">{c}</li>)}</ul>
        </div>
      )}
      {Array.isArray(es.topPriorities) && es.topPriorities.length > 0 && (
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">Top priorities</p>
          <div className="space-y-2">
            {es.topPriorities.map((p: any, i: number) => (
              <div key={i} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
                <p className="text-xs font-semibold">{p.priority}. {p.action}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{p.why}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {es.whatHappensIfNothingChanges && (
        <div className="rounded-lg border border-red-500/15 bg-red-500/[0.04] px-3 py-2">
          <p className="text-[10px] text-red-300/80 uppercase tracking-wide mb-1">If nothing changes</p>
          <Prose text={es.whatHappensIfNothingChanges} />
        </div>
      )}
    </div>
  );
}

function CampaignTab({ s, cur }: { s: Record<string, any>; cur: string }) {
  const c = s.campaign ?? {};
  const is = c.impressionShare ?? {};
  const t = c.totals ?? {};
  return (
    <div className="space-y-4">
      <SectionError error={c.error} />
      {c.settings && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Status" value={c.settings.status} />
          <Stat label="Bidding" value={c.settings.biddingStrategy} />
          <Stat label="Daily budget" value={c.settings.dailyBudget != null ? `${cur}${c.settings.dailyBudget}` : "—"} />
          <Stat label="Started" value={c.settings.startDate} />
          <Stat label="Impr. share" value={is.searchImpressionSharePct != null ? `${is.searchImpressionSharePct}%` : "—"} />
          <Stat label="Lost to budget" value={is.lostToBudgetPct != null ? `${is.lostToBudgetPct}%` : "—"} tone={Number(is.lostToBudgetPct) > 30 ? "text-red-400" : undefined} />
          <Stat label="Lost to rank" value={is.lostToRankPct != null ? `${is.lostToRankPct}%` : "—"} />
          <Stat label="Avg CPC" value={t.avgCpc != null ? `${cur}${t.avgCpc}` : "—"} />
        </div>
      )}
      <div>
        <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">Daily trend</p>
        <DataTable
          columns={[
            { key: "date", label: "Date" }, { key: "spend", label: `Spend ${cur}` },
            { key: "impressions", label: "Impr." }, { key: "clicks", label: "Clicks" },
            { key: "conversions", label: "Conv." },
          ]}
          rows={c.dailyTrend ?? []}
        />
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">Devices</p>
          <DataTable columns={[{ key: "device", label: "Device" }, { key: "spend", label: `Spend ${cur}` }, { key: "clicks", label: "Clicks" }, { key: "conversions", label: "Conv." }]} rows={c.deviceSplit ?? []} />
        </div>
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">Day of week</p>
          <DataTable columns={[{ key: "day", label: "Day" }, { key: "spend", label: `Spend ${cur}` }, { key: "clicks", label: "Clicks" }, { key: "conversions", label: "Conv." }]} rows={c.dayOfWeekSplit ?? []} />
        </div>
      </div>
      {(s.tracking?.findings ?? []).length > 0 && (
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">Conversion tracking</p>
          <ul className="space-y-1.5">
            {s.tracking.findings.map((f: string, i: number) => (
              <li key={i} className="flex items-start gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-[11px] text-foreground/85">
                <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0 mt-0.5" />{f}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function KeywordsTab({ s, onCsv, cur }: { s: Record<string, any>; onCsv: (name: string, rows: any[]) => void; cur: string }) {
  const k = s.keywords ?? {};
  return (
    <div className="space-y-3">
      <SectionError error={k.error} />
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-2 flex-wrap">
          {Object.entries(k.counts ?? {}).map(([cls, n]) => (
            <span key={cls} className="text-[11px]"><ClassBadge v={cls} /> <span className="text-muted-foreground">{n as any}</span></span>
          ))}
        </div>
        <button onClick={() => onCsv("keywords", k.rows ?? [])} className="text-[11px] flex items-center gap-1 rounded-lg border border-white/[0.08] px-2 py-1 text-muted-foreground hover:text-foreground">
          <FileDown className="h-3 w-3" /> CSV
        </button>
      </div>
      {k.lowDataNote && <p className="text-[10px] text-muted-foreground">{k.lowDataNote}</p>}
      <DataTable
        columns={[
          { key: "text", label: "Keyword" }, { key: "matchType", label: "Match" },
          { key: "classification", label: "Class", render: r => <ClassBadge v={r.classification} /> },
          { key: "spend", label: `Spend ${cur}` }, { key: "impressions", label: "Impr." },
          { key: "clicks", label: "Clicks" }, { key: "ctrPct", label: "CTR %" },
          { key: "conversions", label: "Conv." }, { key: "qualityScore", label: "QS" },
          { key: "qc", label: "QS components", render: r => r.qualityComponents ? `${r.qualityComponents.expectedCtr ?? "—"} / ${r.qualityComponents.adRelevance ?? "—"} / ${r.qualityComponents.landingPageExperience ?? "—"}` : "—" },
          { key: "classificationReason", label: "Why" },
        ]}
        rows={k.rows ?? []}
      />
      <p className="text-[10px] text-muted-foreground">QS components: expected CTR / ad relevance / landing-page experience.</p>
    </div>
  );
}

function SearchTermsTab({ s, onCsv, cur }: { s: Record<string, any>; onCsv: (name: string, rows: any[]) => void; cur: string }) {
  const st = s.search_terms ?? {};
  const [filter, setFilter] = useState<string>("all");
  const rows = (st.rows ?? []).filter((r: any) => filter === "all" || r.classification === filter);
  return (
    <div className="space-y-3">
      <SectionError error={st.error} />
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1.5 flex-wrap">
          {["all", ...Object.keys(st.counts ?? {})].map(c => (
            <button key={c} onClick={() => setFilter(c)}
              className={cn("text-[10px] rounded-full px-2 py-1 border",
                filter === c ? "border-violet-500/40 bg-violet-500/15 text-violet-300" : "border-white/[0.08] text-muted-foreground hover:text-foreground")}>
              {c.replace(/_/g, " ")}{c !== "all" ? ` (${st.counts[c]})` : ` (${st.totalUniqueTerms ?? (st.rows ?? []).length})`}
            </button>
          ))}
        </div>
        <button onClick={() => onCsv("search-terms", st.rows ?? [])} className="text-[11px] flex items-center gap-1 rounded-lg border border-white/[0.08] px-2 py-1 text-muted-foreground hover:text-foreground">
          <FileDown className="h-3 w-3" /> CSV
        </button>
      </div>
      <DataTable
        columns={[
          { key: "searchTerm", label: "Search term" },
          { key: "classification", label: "Class", render: r => <ClassBadge v={r.classification} /> },
          { key: "matchedKeyword", label: "Matched keyword" }, { key: "matchType", label: "Match" },
          { key: "spend", label: `Spend ${cur}` }, { key: "impressions", label: "Impr." },
          { key: "clicks", label: "Clicks" }, { key: "conversions", label: "Conv." },
          { key: "classificationReason", label: "Why" },
        ]}
        rows={rows}
      />
    </div>
  );
}

function OpportunitiesTab({ s }: { s: Record<string, any> }) {
  const sk = s.suggested_keywords ?? {};
  return (
    <div className="space-y-4">
      <SectionError error={sk.error} />
      <p className="text-[10px] text-muted-foreground">Estimated volumes: {sk.volumeNote}</p>
      {(sk.groups ?? []).map((g: any, i: number) => (
        <div key={i} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          <p className="text-xs font-semibold mb-2">{g.theme}</p>
          <DataTable
            columns={[
              { key: "keyword", label: "Keyword" }, { key: "matchType", label: "Match" },
              { key: "intent", label: "Intent" }, { key: "priority", label: "Priority" },
              { key: "rationale", label: "Rationale" }, { key: "evidence", label: "Evidence" },
            ]}
            rows={g.keywords ?? []}
          />
        </div>
      ))}
      {sk.structureNotes && (
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Structure notes</p>
          <Prose text={sk.structureNotes} />
        </div>
      )}
      {s.structure_recommendation && !s.structure_recommendation.error && (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 space-y-2">
          <p className="text-xs font-semibold">Proposed campaign structure</p>
          {(s.structure_recommendation.currentIssues ?? []).map((c: string, i: number) => (
            <p key={i} className="text-[11px] text-amber-300/90">• {c}</p>
          ))}
          <DataTable
            columns={[
              { key: "adGroup", label: "Ad group" }, { key: "theme", label: "Theme" },
              { key: "keywords", label: "Keywords", render: r => (r.keywords ?? []).join(", ") },
              { key: "matchTypes", label: "Match types" }, { key: "rationale", label: "Rationale" },
            ]}
            rows={s.structure_recommendation.proposedStructure ?? []}
          />
          <Prose text={s.structure_recommendation.biddingNotes} />
          <Prose text={s.structure_recommendation.budgetNotes} />
        </div>
      )}
    </div>
  );
}

function NegativesTab({ s, onCsv, cur }: { s: Record<string, any>; onCsv: (name: string, rows: any[]) => void; cur: string }) {
  const n = s.negative_keywords ?? {};
  return (
    <div className="space-y-4">
      <SectionError error={n.error} />
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Observed waste (from real search terms)</p>
        <button onClick={() => onCsv("negative-candidates", n.deterministicCandidates ?? [])} className="text-[11px] flex items-center gap-1 rounded-lg border border-white/[0.08] px-2 py-1 text-muted-foreground hover:text-foreground">
          <FileDown className="h-3 w-3" /> CSV
        </button>
      </div>
      <DataTable
        columns={[
          { key: "term", label: "Term" }, { key: "spend", label: `Spend ${cur}` },
          { key: "clicks", label: "Clicks" }, { key: "reason", label: "Reason" },
        ]}
        rows={n.deterministicCandidates ?? []}
      />
      {(n.groups ?? []).map((g: any, i: number) => (
        <div key={i} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          <p className="text-xs font-semibold">{g.group} <span className="text-muted-foreground font-normal">({g.matchType})</span></p>
          <p className="text-[11px] text-foreground/80 mt-1">{(g.terms ?? []).join(", ")}</p>
          <p className="text-[10px] text-muted-foreground mt-1">{g.evidence} {g.spendAffected ? `— ${g.spendAffected}` : ""}</p>
        </div>
      ))}
    </div>
  );
}

function AdsTab({ s }: { s: Record<string, any> }) {
  const ads = s.ads ?? {}; const ac = s.ad_concepts ?? {};
  return (
    <div className="space-y-4">
      <SectionError error={ads.error} />
      {(ads.rows ?? []).map((a: any, i: number) => (
        <div key={i} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <p className="text-xs font-semibold">Current ad {a.adId}</p>
            <span className="text-[10px] rounded-full px-1.5 py-0.5 bg-white/[0.06] text-muted-foreground">{a.type}</span>
            <span className="text-[10px] rounded-full px-1.5 py-0.5 bg-white/[0.06] text-muted-foreground">Strength: {a.adStrength ?? "—"}</span>
            <span className="text-[10px] text-muted-foreground">{a.impressions} impr · {a.clicks} clicks · CTR {a.ctrPct ?? "—"}%</span>
          </div>
          <p className="text-[10px] text-muted-foreground mb-1">Headlines</p>
          <p className="text-[11px] text-foreground/85">{(a.headlines ?? []).map((h: any) => h.text ?? h).join(" · ")}</p>
          <p className="text-[10px] text-muted-foreground mt-2 mb-1">Descriptions</p>
          <p className="text-[11px] text-foreground/85">{(a.descriptions ?? []).map((d: any) => d.text ?? d).join(" · ")}</p>
          <p className="text-[10px] text-muted-foreground mt-2">Final URL: {(a.finalUrls ?? []).join(", ")}</p>
        </div>
      ))}
      <SectionError error={ac.error} />
      {(ac.critique ?? []).map((c: any, i: number) => (
        <div key={i} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          <p className="text-xs font-semibold mb-1">Critique — ad {c.adId}</p>
          <p className="text-[11px] text-emerald-300/90">Strengths: {(c.strengths ?? []).join("; ")}</p>
          <p className="text-[11px] text-amber-300/90 mt-1">Weaknesses: {(c.weaknesses ?? []).join("; ")}</p>
          <p className="text-[10px] text-muted-foreground mt-1">{c.evidence}</p>
        </div>
      ))}
      {(ac.concepts ?? []).map((c: any, i: number) => (
        <div key={i} className="rounded-lg border border-violet-500/15 bg-violet-500/[0.03] p-3">
          <p className="text-xs font-semibold">{i + 1}. {c.name} <span className="text-muted-foreground font-normal">— {c.angle}</span></p>
          <p className="text-[10px] text-muted-foreground mt-1 mb-1">Headlines ({(c.headlines ?? []).length})</p>
          <p className="text-[11px] text-foreground/85">{(c.headlines ?? []).join(" · ")}</p>
          <p className="text-[10px] text-muted-foreground mt-2 mb-1">Descriptions</p>
          <p className="text-[11px] text-foreground/85">{(c.descriptions ?? []).join(" · ")}</p>
          <p className="text-[10px] text-muted-foreground mt-2">URL: {c.finalUrl} {c.path1 ? `/${c.path1}` : ""}{c.path2 ? `/${c.path2}` : ""} · Target: {c.targetAdGroup}</p>
          <p className="text-[11px] text-foreground/80 mt-1">{c.rationale}</p>
          <p className="text-[10px] text-muted-foreground mt-1">Evidence: {c.evidence}</p>
        </div>
      ))}
    </div>
  );
}

function LandingTab({ s }: { s: Record<string, any> }) {
  const lp = s.landing_pages ?? {}; const bp = s.landing_page_blueprint ?? {};
  return (
    <div className="space-y-4">
      {(lp.snapshots ?? []).map((snap: any, i: number) => (
        <div key={i} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          <p className="text-xs font-semibold break-all">{snap.url}</p>
          {snap.error
            ? <p className="text-[11px] text-red-300 mt-1">Fetch failed: {snap.error}</p>
            : (
              <div className="mt-1 space-y-1">
                <p className="text-[11px] text-foreground/85">Title: {snap.title ?? "—"}</p>
                <p className="text-[11px] text-foreground/85">Meta: {snap.metaDescription ?? "—"}</p>
                <p className="text-[11px] text-foreground/85">H1: {(snap.h1 ?? []).join(" | ") || "—"}</p>
                <p className="text-[11px] text-foreground/85">CTAs seen: {(snap.ctaCandidates ?? []).join(" · ") || "—"}</p>
                <p className="text-[10px] text-muted-foreground">Fetched {snap.fetchedAt}</p>
              </div>
            )}
        </div>
      ))}
      <SectionError error={lp.analysisError} />
      {(lp.analysis ?? []).map((a: any, i: number) => (
        <div key={i} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          <p className="text-xs font-semibold break-all mb-1">Analysis — {a.url}</p>
          <p className="text-[11px] text-foreground/85">Message match: {a.messageMatch}</p>
          <p className="text-[11px] text-emerald-300/90 mt-1">Strengths: {(a.strengths ?? []).join("; ")}</p>
          <p className="text-[11px] text-amber-300/90 mt-1">Weaknesses: {(a.weaknesses ?? []).join("; ")}</p>
          <p className="text-[11px] text-foreground/80 mt-1">Quick wins: {(a.quickWins ?? []).join("; ")}</p>
        </div>
      ))}
      <SectionError error={bp.error} />
      {(bp.sections ?? []).length > 0 && (
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2">Landing-page blueprint {bp.targetUrl ? `for ${bp.targetUrl}` : ""}</p>
          <div className="space-y-2">
            {(bp.sections ?? []).map((sec: any, i: number) => (
              <div key={i} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                <p className="text-xs font-semibold">{sec.order}. {sec.section}</p>
                <p className="text-[11px] text-foreground/85 mt-1"><span className="text-muted-foreground">Heading:</span> {sec.suggestedHeading}</p>
                <p className="text-[11px] text-foreground/85 mt-0.5"><span className="text-muted-foreground">Copy:</span> {sec.suggestedCopy}</p>
                {sec.cta && <p className="text-[11px] text-foreground/85 mt-0.5"><span className="text-muted-foreground">CTA:</span> {sec.cta}</p>}
                <p className="text-[10px] text-muted-foreground mt-1">{sec.conversionRationale}</p>
                {(sec.requiredAsset || sec.mobileBehaviour) && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">Assets: {sec.requiredAsset ?? "—"} · Mobile: {sec.mobileBehaviour ?? "—"}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function HomepageTab({ s }: { s: Record<string, any> }) {
  const hp = s.homepage_blueprint ?? {};
  return (
    <div className="space-y-3">
      <SectionError error={hp.error} />
      <p className="text-[10px] text-amber-300/80">Design recommendation only — no website changes are made by this analysis.</p>
      {hp.heroLayout && <div><p className="text-[10px] text-muted-foreground uppercase">Hero</p><Prose text={hp.heroLayout} /></div>}
      {hp.productNavigation && <div><p className="text-[10px] text-muted-foreground uppercase">Product navigation</p><Prose text={hp.productNavigation} /></div>}
      {hp.visualHierarchy && <div><p className="text-[10px] text-muted-foreground uppercase">Visual hierarchy</p><Prose text={hp.visualHierarchy} /></div>}
      {hp.ctaHierarchy && <div><p className="text-[10px] text-muted-foreground uppercase">CTA hierarchy</p><Prose text={hp.ctaHierarchy} /></div>}
      {(hp.sections ?? []).map((sec: any, i: number) => (
        <div key={i} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          <p className="text-xs font-semibold">{sec.order}. {sec.section}</p>
          <p className="text-[11px] text-foreground/85 mt-1"><span className="text-muted-foreground">Heading:</span> {sec.suggestedHeading}</p>
          <p className="text-[11px] text-foreground/85 mt-0.5">{sec.contents}</p>
          {sec.cta && <p className="text-[11px] text-foreground/85 mt-0.5"><span className="text-muted-foreground">CTA:</span> {sec.cta}</p>}
          <p className="text-[10px] text-muted-foreground mt-1">{sec.conversionRationale}</p>
        </div>
      ))}
      {hp.trustSections && <div><p className="text-[10px] text-muted-foreground uppercase">Trust</p><Prose text={hp.trustSections} /></div>}
      {hp.pricingEntryPoints && <div><p className="text-[10px] text-muted-foreground uppercase">Pricing entry points</p><Prose text={hp.pricingEntryPoints} /></div>}
      {hp.footerStructure && <div><p className="text-[10px] text-muted-foreground uppercase">Footer</p><Prose text={hp.footerStructure} /></div>}
    </div>
  );
}

function CompetitorsTab({ s }: { s: Record<string, any> }) {
  const c = s.competitors ?? {};
  const TONE: Record<string, string> = {
    verified: "bg-emerald-500/15 text-emerald-400",
    inferred: "bg-amber-500/15 text-amber-400",
    unavailable: "bg-white/[0.06] text-muted-foreground",
  };
  return (
    <div className="space-y-3">
      <SectionError error={c.error} />
      <p className="text-[10px] text-muted-foreground">{c.methodNote}</p>
      {(c.rows ?? []).map((r: any, i: number) => (
        <div key={i} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          <div className="flex items-center gap-2 mb-1">
            <p className="text-xs font-semibold">{r.competitor}</p>
            <span className={cn("text-[10px] rounded-full px-1.5 py-0.5", TONE[r.dataStatus] ?? TONE.unavailable)}>{r.dataStatus}</span>
          </div>
          <p className="text-[11px] text-foreground/85">Positioning: {r.positioning}</p>
          <p className="text-[11px] text-foreground/85 mt-0.5">Offer: {r.offer} · CTA: {r.cta}</p>
          <p className="text-[11px] text-foreground/85 mt-0.5">Keyword themes: {(r.keywordThemes ?? []).join(", ")}</p>
          <p className="text-[11px] text-emerald-300/90 mt-1">Strengths: {(r.strengths ?? []).join("; ")}</p>
          <p className="text-[11px] text-amber-300/90 mt-0.5">Weaknesses: {(r.weaknesses ?? []).join("; ")}</p>
          <p className="text-[11px] text-foreground/80 mt-1">Differentiation: {r.differentiationOpportunity}</p>
          <p className="text-[10px] text-muted-foreground mt-1">Source: {r.source}</p>
        </div>
      ))}
    </div>
  );
}

function ChangesTab({ s, onCsv }: { s: Record<string, any>; onCsv: (name: string, rows: any[]) => void }) {
  const cr = s.change_requests ?? {};
  const groups = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const r of cr.rows ?? []) {
      m.set(r.group, [...(m.get(r.group) ?? []), r]);
    }
    return Array.from(m.entries());
  }, [cr.rows]);
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-violet-500/15 bg-violet-500/[0.04] px-3 py-2">
        <p className="text-[11px] text-foreground/85">{cr.note}</p>
      </div>
      <div className="flex justify-end">
        <button onClick={() => onCsv("change-requests", cr.rows ?? [])} className="text-[11px] flex items-center gap-1 rounded-lg border border-white/[0.08] px-2 py-1 text-muted-foreground hover:text-foreground">
          <FileDown className="h-3 w-3" /> CSV
        </button>
      </div>
      {groups.map(([g, rows]) => (
        <div key={g}>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-2">{g} ({rows.length})</p>
          <div className="space-y-2">
            {rows.map((r: any, i: number) => (
              <div key={i} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                <p className="text-xs font-semibold">{r.exactAction}</p>
                <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1 mt-2">
                  <p className="text-[11px]"><span className="text-muted-foreground">Object:</span> {r.affectedObject}</p>
                  <p className="text-[11px]"><span className="text-muted-foreground">Approval:</span> {r.approvalRequired}</p>
                  <p className="text-[11px]"><span className="text-muted-foreground">Now:</span> {r.currentState}</p>
                  <p className="text-[11px]"><span className="text-muted-foreground">Proposed:</span> {r.proposedState}</p>
                  <p className="text-[11px]"><span className="text-muted-foreground">Evidence:</span> {r.supportingEvidence}</p>
                  <p className="text-[11px]"><span className="text-muted-foreground">Expected impact:</span> {r.expectedDirectionalImpact}</p>
                  <p className="text-[11px]"><span className="text-muted-foreground">Risk:</span> {r.risk} · confidence {Math.round((r.confidence ?? 0) * 100)}%</p>
                  <p className="text-[11px]"><span className="text-muted-foreground">Owner:</span> {r.implementationOwner}</p>
                  <p className="text-[11px]"><span className="text-muted-foreground">Verify:</span> {r.verificationMethod}</p>
                  <p className="text-[11px]"><span className="text-muted-foreground">Rollback:</span> {r.rollbackMethod}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
      {s.monitoring && (
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
          <p className="text-xs font-semibold mb-1">Monitoring plan ({s.monitoring.cadence})</p>
          <ul className="list-disc pl-4 space-y-0.5">
            {(s.monitoring.checks ?? []).map((c: string, i: number) => <li key={i} className="text-[11px] text-foreground/85">{c}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function EvidenceTab({ s }: { s: Record<string, any> }) {
  const e = s.evidence ?? {};
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-emerald-500/15 bg-emerald-500/[0.04] px-3 py-2">
        <p className="text-[11px] text-emerald-300/90">{e.readOnlyConfirmation}</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {Object.entries(e.rowCounts ?? {}).map(([k, v]) => <Stat key={k} label={k} value={v as any} />)}
      </div>
      <div>
        <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5">Data sources</p>
        <ul className="space-y-1">
          {(e.dataSources ?? []).map((d: any, i: number) => (
            <li key={i} className="text-[11px] text-foreground/85">
              {d.source} {d.fetchedAt ? `— fetched ${d.fetchedAt}` : ""} {d.window ? `(${d.window.from} → ${d.window.to})` : ""} {d.present === false ? "(not present)" : ""}
            </li>
          ))}
        </ul>
      </div>
      {(e.aiModelsUsed ?? []).length > 0 && (
        <p className="text-[11px] text-muted-foreground">AI models used for advisory sections: {(e.aiModelsUsed ?? []).join(", ")}</p>
      )}
      {(e.sectionErrors ?? []).length > 0 && (
        <div>
          <p className="text-[10px] text-amber-300/80 uppercase tracking-wide mb-1">Section warnings</p>
          <ul className="space-y-1">{(e.sectionErrors ?? []).map((w: string, i: number) => <li key={i} className="text-[11px] text-amber-300/90">{w}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

// ── main viewer ───────────────────────────────────────────────────────────────

export function GadsAnalysisReportViewer({ report }: { report: Report }) {
  const [tab, setTab] = useState<TabKey>("summary");
  const s = report.sections ?? {};
  const cur = report.source_meta?.currencySymbol ?? "£";
  const slug = (report.campaign_name ?? "campaign").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
  const onCsv = (name: string, rows: any[]) => downloadCsv(`gads-${slug}-${name}-${report.date_to}.csv`, rows);

  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.015] print:border-0" data-gads-report>
      <div className="px-4 pt-4 pb-3 border-b border-white/[0.06] flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide flex items-center gap-1.5 mb-1">
            <Eye className="h-3 w-3" /> Google Ads Deep Analysis Report
          </p>
          <p className="text-sm font-semibold">{report.campaign_name ?? report.campaign_id}</p>
          <p className="text-[11px] text-muted-foreground">
            {report.date_from} → {report.date_to} · generated {new Date(report.created_at).toLocaleString()} ·{" "}
            <span className={report.status === "complete" ? "text-emerald-400" : "text-amber-400"}>{report.status.replace(/_/g, " ")}</span>
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="text-[11px] flex items-center gap-1 rounded-lg border border-white/[0.08] px-2.5 py-1.5 text-muted-foreground hover:text-foreground print:hidden"
        >
          <Printer className="h-3 w-3" /> Print / PDF
        </button>
      </div>

      <div className="px-4 pt-3 flex gap-1.5 flex-wrap print:hidden">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={cn("flex items-center gap-1 text-[11px] rounded-lg px-2.5 py-1.5 border transition-all",
              tab === t.key
                ? "border-violet-500/40 bg-violet-500/15 text-violet-300"
                : "border-white/[0.07] text-muted-foreground hover:text-foreground hover:bg-white/[0.03]")}>
            <t.icon className="h-3 w-3" /> {t.label}
          </button>
        ))}
      </div>

      <div className="p-4 print:hidden">
        {tab === "summary" && <SummaryTab s={s} cur={cur} />}
        {tab === "campaign" && <CampaignTab s={s} cur={cur} />}
        {tab === "keywords" && <KeywordsTab s={s} onCsv={onCsv} cur={cur} />}
        {tab === "search_terms" && <SearchTermsTab s={s} onCsv={onCsv} cur={cur} />}
        {tab === "opportunities" && <OpportunitiesTab s={s} />}
        {tab === "negatives" && <NegativesTab s={s} onCsv={onCsv} cur={cur} />}
        {tab === "ads" && <AdsTab s={s} />}
        {tab === "landing" && <LandingTab s={s} />}
        {tab === "homepage" && <HomepageTab s={s} />}
        {tab === "competitors" && <CompetitorsTab s={s} />}
        {tab === "changes" && <ChangesTab s={s} onCsv={onCsv} />}
        {tab === "evidence" && <EvidenceTab s={s} />}
      </div>

      {/* Print view: all sections stacked */}
      <div className="hidden print:block p-4 space-y-8">
        <SummaryTab s={s} cur={cur} /><CampaignTab s={s} cur={cur} /><KeywordsTab s={s} onCsv={onCsv} cur={cur} />
        <SearchTermsTab s={s} onCsv={onCsv} cur={cur} /><OpportunitiesTab s={s} /><NegativesTab s={s} onCsv={onCsv} cur={cur} />
        <AdsTab s={s} /><LandingTab s={s} /><HomepageTab s={s} /><CompetitorsTab s={s} />
        <ChangesTab s={s} onCsv={onCsv} /><EvidenceTab s={s} />
      </div>
    </div>
  );
}
