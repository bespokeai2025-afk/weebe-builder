import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileText, RefreshCw, Loader2, Sparkles, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { SystemMindShell } from "./SystemMindShell";
import {
  listSystemMindReports,
  generateSystemMindReport,
} from "@/lib/systemmind/systemmind-cto.functions";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export function SystemMindReportsPage() {
  const listFn = useServerFn(listSystemMindReports);
  const generateFn = useServerFn(generateSystemMindReport);
  const qc = useQueryClient();
  const [generating, setGenerating] = useState(false);
  const [selected, setSelected] = useState<any | null>(null);

  const { data: reports, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["systemmind-reports"],
    queryFn: () => listFn(),
  });

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

  if (selected) {
    return (
      <SystemMindShell>
        <div className="mx-auto max-w-4xl px-4 py-6 md:px-8">
          <div className="flex items-center gap-3 mb-6">
            <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
              <ArrowLeft className="h-3.5 w-3.5" /> Back
            </Button>
            <h2 className="text-sm font-semibold truncate">{selected.title}</h2>
            <span className="text-[11px] text-muted-foreground ml-auto shrink-0">
              {new Date(selected.generated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6">
            <div className="prose prose-sm prose-invert max-w-none">
              <pre className="whitespace-pre-wrap text-xs text-foreground leading-relaxed font-sans">{selected.content}</pre>
            </div>
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
                onClick={() => setSelected(report)}
                className="w-full text-left rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 flex items-center gap-3 hover:bg-white/[0.04] transition-colors group"
              >
                <FileText className="h-4 w-4 text-emerald-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold truncate">{report.title}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {new Date(report.generated_at).toLocaleDateString("en-US", {
                      weekday: "short", month: "short", day: "numeric",
                      hour: "2-digit", minute: "2-digit",
                    })}
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
