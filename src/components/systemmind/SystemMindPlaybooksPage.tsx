import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Shield, ChevronDown, ChevronUp, Search, Loader2,
  AlertTriangle, Wrench, RotateCcw, CheckSquare, AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  getRepairPlaybooks,
  seedSystemMindPlaybooks,
} from "@/lib/systemmind/systemmind-workflow.functions";

const RISK_COLORS: Record<string, string> = {
  critical: "text-red-400 bg-red-500/10 border-red-500/20",
  high:     "text-orange-400 bg-orange-500/10 border-orange-500/20",
  medium:   "text-amber-400 bg-amber-500/10 border-amber-500/20",
  low:      "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
};

const RISK_ORDER = ["critical", "high", "medium", "low"];

function PlaybookCard({ pb }: { pb: any }) {
  const [open, setOpen] = useState(false);
  const riskCls = RISK_COLORS[pb.risk_level] ?? RISK_COLORS.medium;

  return (
    <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] overflow-hidden">
      <button
        className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <div className={cn("mt-0.5 shrink-0 rounded-full p-1", riskCls.split(" ")[1])}>
          <Shield className={cn("h-3 w-3", riskCls.split(" ")[0])} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold">{pb.problem}</span>
            <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded border", riskCls)}>
              {pb.risk_level.toUpperCase()}
            </span>
            {pb.provider && (
              <span className="text-[10px] text-muted-foreground border border-white/[0.08] rounded px-1.5 py-0.5">
                {pb.provider}
              </span>
            )}
          </div>
          {(pb.symptoms ?? []).length > 0 && (
            <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">
              Symptoms: {(pb.symptoms as string[]).join(", ")}
            </p>
          )}
        </div>
        {open ? (
          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
        )}
      </button>

      {open && (
        <div className="border-t border-white/[0.06] px-4 py-3 space-y-3">
          {/* Symptoms */}
          {(pb.symptoms ?? []).length > 0 && (
            <section>
              <div className="flex items-center gap-1.5 mb-1.5">
                <AlertCircle className="h-3 w-3 text-amber-400" />
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Symptoms</p>
              </div>
              <ul className="space-y-0.5">
                {(pb.symptoms as string[]).map((s, i) => (
                  <li key={i} className="text-xs text-muted-foreground flex gap-1.5">
                    <span className="text-muted-foreground/40 shrink-0">•</span>{s}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Checks */}
          {(pb.checks ?? []).length > 0 && (
            <section>
              <div className="flex items-center gap-1.5 mb-1.5">
                <CheckSquare className="h-3 w-3 text-sky-400" />
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Diagnostic Checks</p>
              </div>
              <ul className="space-y-0.5">
                {(pb.checks as string[]).map((s, i) => (
                  <li key={i} className="text-xs text-muted-foreground flex gap-1.5">
                    <span className="text-sky-500/60 shrink-0">{i + 1}.</span>{s}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Fix steps */}
          {(pb.fix_steps ?? []).length > 0 && (
            <section>
              <div className="flex items-center gap-1.5 mb-1.5">
                <Wrench className="h-3 w-3 text-emerald-400" />
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Fix Steps</p>
              </div>
              <ol className="space-y-0.5">
                {(pb.fix_steps as string[]).map((s, i) => (
                  <li key={i} className="text-xs text-muted-foreground flex gap-1.5">
                    <span className="text-emerald-500/60 shrink-0">{i + 1}.</span>{s}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* Rollback */}
          {pb.rollback_plan && (
            <section className="rounded-lg bg-amber-500/[0.06] border border-amber-500/10 px-3 py-2">
              <div className="flex items-center gap-1.5 mb-1">
                <RotateCcw className="h-3 w-3 text-amber-400" />
                <p className="text-[10px] font-semibold text-amber-400 uppercase tracking-wide">Rollback Plan</p>
              </div>
              <p className="text-xs text-muted-foreground">{pb.rollback_plan}</p>
            </section>
          )}

          {/* Affected files */}
          {(pb.affected_files ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1">
              {(pb.affected_files as string[]).map((f, i) => (
                <code key={i} className="text-[10px] bg-white/[0.04] border border-white/[0.06] rounded px-1.5 py-0.5 text-muted-foreground">
                  {f}
                </code>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SystemMindPlaybooksPage() {
  const [search, setSearch]         = useState("");
  const [catFilter, setCatFilter]   = useState<"all" | "repair" | "provider">("all");
  const [riskFilter, setRiskFilter] = useState<string>("all");
  const [seeding, setSeeding]       = useState(false);

  const listFn = useServerFn(getRepairPlaybooks);
  const seedFn = useServerFn(seedSystemMindPlaybooks);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["sm-playbooks", catFilter, riskFilter],
    queryFn: () =>
      listFn({
        data: {
          category:  catFilter  !== "all" ? catFilter  : undefined,
          riskLevel: riskFilter !== "all" ? riskFilter : undefined,
        },
      }),
  });

  // Auto-seed on first mount
  useEffect(() => {
    (async () => { try { await seedFn({ data: {} }); refetch(); } catch { /* graceful */ } })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSeed() {
    setSeeding(true);
    try {
      const res = await seedFn({ data: {} }) as any;
      toast.success(res.seeded > 0 ? `${res.seeded} playbooks seeded` : "All playbooks already seeded");
      refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Seeding failed");
    } finally {
      setSeeding(false);
    }
  }

  const allPlaybooks: any[] = (data as any[]) ?? [];
  const filtered = allPlaybooks
    .filter((p) => !search || p.problem.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const ra = RISK_ORDER.indexOf(a.risk_level);
      const rb = RISK_ORDER.indexOf(b.risk_level);
      return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb);
    });

  const repairCount   = allPlaybooks.filter((p) => p.category === "repair").length;
  const providerCount = allPlaybooks.filter((p) => p.category === "provider").length;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Repair Playbooks</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Step-by-step repair guides for common workflow and provider issues.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={handleSeed} disabled={seeding} className="text-xs gap-1.5">
          {seeding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Shield className="h-3 w-3" />}
          Seed Defaults
        </Button>
      </div>

      {/* Stats row */}
      {allPlaybooks.length > 0 && (
        <div className="flex gap-3 flex-wrap">
          {[
            { label: "Total",    value: allPlaybooks.length, color: "text-foreground" },
            { label: "Repair",   value: repairCount,         color: "text-sky-400" },
            { label: "Provider", value: providerCount,       color: "text-violet-400" },
          ].map((s) => (
            <div key={s.label} className="flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
              <span className={cn("text-base font-semibold", s.color)}>{s.value}</span>
              <span className="text-xs text-muted-foreground">{s.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 flex-wrap items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search playbooks…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-7 h-8 text-xs"
          />
        </div>

        {/* Category filter */}
        <div className="flex gap-1">
          {(["all", "repair", "provider"] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCatFilter(c)}
              className={cn(
                "px-2.5 py-1 rounded text-xs font-medium transition-colors",
                catFilter === c
                  ? "bg-sky-500/15 text-sky-300"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {c.charAt(0).toUpperCase() + c.slice(1)}
            </button>
          ))}
        </div>

        {/* Risk filter */}
        <div className="flex gap-1">
          {["all", ...RISK_ORDER].map((r) => (
            <button
              key={r}
              onClick={() => setRiskFilter(r)}
              className={cn(
                "px-2 py-1 rounded text-[10px] font-medium transition-colors border",
                riskFilter === r
                  ? "bg-white/[0.06] border-white/[0.12] text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {r.charAt(0).toUpperCase() + r.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] py-16 text-center">
          <AlertTriangle className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">
            {allPlaybooks.length === 0 ? "No playbooks yet — click Seed Defaults" : "No playbooks match your filters"}
          </p>
        </div>
      )}

      <div className="space-y-2">
        {filtered.map((pb) => (
          <PlaybookCard key={pb.id} pb={pb} />
        ))}
      </div>
    </div>
  );
}
