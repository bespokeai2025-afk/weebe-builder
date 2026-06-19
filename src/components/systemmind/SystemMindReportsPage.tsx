import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { FileText, RefreshCw, Loader2, Sparkles, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SystemMindShell } from "./SystemMindShell";
import {
  listSystemMindReports,
  getSystemMindReport,
  generateSystemMindReport,
} from "@/lib/systemmind/systemmind-cto.functions";

export function SystemMindReportsPage() {
  const listFn = useServerFn(listSystemMindReports);
  const getFn = useServerFn(getSystemMindReport);
  const generateFn = useServerFn(generateSystemMindReport);
  const qc = useQueryClient();
  const [generating, setGenerating] = useState(false);
  const [selected, setSelected] = useState<any | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const { data: reports, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["systemmind-reports"],
    queryFn: () => listFn(),
    throwOnError: false,
  });

  async function openReport(report: any) {
    if (report.body) { setSelected(report); return; }
    setLoadingId(report.id);
    try {
      const full = await getFn({ data: { id: report.id } });
      setSelected(full ?? report);
    } finally {
      setLoadingId(null);
    }
  }

  async function generate() {
    setGenerating(true);
    try {
      const report = await generateFn({ data: {} });
      qc.invalidateQueries({ queryKey: ["systemmind-reports"] });
      setSelected(report);
    } finally {
      setGenerating(false);
    }
  }

  const renderedBody = useMemo(() => {
    if (!selected?.body) return "";
    try {
      const raw = marked.parse(selected.body, { async: false }) as string;
      return DOMPurify.sanitize(raw, {
        ALLOWED_TAGS: ["h1","h2","h3","h4","h5","h6","p","ul","ol","li","strong","em","code","pre","blockquote","br","hr","table","thead","tbody","tr","th","td"],
        ALLOWED_ATTR: [],
      });
    } catch {
      return DOMPurify.sanitize(selected.body);
    }
  }, [selected?.body]);

  if (selected) {
    return (
      <SystemMindShell>
        <div className="mx-auto max-w-4xl px-4 py-6 md:px-8">
          <div className="flex items-center gap-3 mb-6">
            <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </Button>
            <h2 className="text-sm font-semibold truncate">{selected.title}</h2>
            <div className="ml-auto flex items-center gap-2 shrink-0">
              {selected.model && (
                <span className="text-[10px] text-muted-foreground/50 bg-white/[0.04] rounded px-1.5 py-0.5">
                  {selected.model}
                </span>
              )}
              <span className="text-[11px] text-muted-foreground">
                {new Date(selected.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6">
            <div
              className="prose prose-sm prose-invert max-w-none prose-headings:text-foreground prose-p:text-foreground/80 prose-strong:text-foreground prose-li:text-foreground/80 prose-code:text-sky-300 prose-code:bg-white/[0.06] prose-code:px-1 prose-code:rounded"
              dangerouslySetInnerHTML={{ __html: renderedBody || selected.body || "" }}
            />
          </div>
        </div>
      </SystemMindShell>
    );
  }

  return (
    <SystemMindShell>
      <div className="mx-auto max-w-4xl px-4 py-6 md:px-8">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/15 ring-1 ring-emerald-500/25">
              <FileText className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Reports</h1>
              <p className="text-xs text-muted-foreground">AI-generated CTO technical reports with platform snapshot</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
              <RefreshCw className={cn("h-3.5 w-3.5", isRefetching && "animate-spin")} />
            </Button>
            <Button size="sm" onClick={generate} disabled={generating} className="bg-sky-600 hover:bg-sky-500 text-white">
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {generating ? "Generating…" : "Generate Report"}
            </Button>
          </div>
        </div>

        {generating && (
          <div className="rounded-xl border border-sky-500/25 bg-sky-500/[0.04] px-4 py-3 mb-5 flex items-center gap-2">
            <Loader2 className="h-4 w-4 text-sky-400 animate-spin shrink-0" />
            <p className="text-xs text-sky-300">Compiling platform data and generating your CTO report. This may take 15–30 seconds…</p>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-24 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : !(reports as any[])?.length ? (
          <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
            <FileText className="h-10 w-10 text-muted-foreground/30" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">No reports yet</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Click "Generate Report" to create a CTO weekly report based on live platform data.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {(reports as any[]).map((report) => (
              <button
                key={report.id}
                onClick={() => openReport(report)}
                disabled={loadingId === report.id}
                className="w-full text-left rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 flex items-center gap-3 hover:bg-white/[0.04] transition-colors group disabled:opacity-60"
              >
                {loadingId === report.id
                  ? <Loader2 className="h-4 w-4 text-emerald-400 shrink-0 animate-spin" />
                  : <FileText className="h-4 w-4 text-emerald-400 shrink-0" />}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate">{report.title}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {new Date(report.created_at).toLocaleDateString("en-US", {
                      weekday: "short", month: "short", day: "numeric",
                      hour: "2-digit", minute: "2-digit",
                    })}
                    {report.model && <span className="ml-2 opacity-50">· {report.model}</span>}
                  </p>
                </div>
                <span className="text-[10px] text-sky-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">View →</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </SystemMindShell>
  );
}
