import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Loader2, CheckCircle2, AlertTriangle, ArrowRight, Search, FlaskConical,
  Braces, ShieldQuestion,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  listDynamicVariablesFn, listVariableMappingsFn, listTransformationRulesFn,
  reviewDynamicVariableFn, saveVariableMappingFn, testTransformationFn,
} from "@/lib/systemmind/variable-engine.functions";

const CONF_CLS: Record<string, string> = {
  high: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  medium: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  low: "bg-red-500/15 text-red-300 border-red-500/30",
};

function coord(system?: string, object?: string, field?: string): string {
  return [system, object, field].filter(Boolean).join(".") || "—";
}

export function WizardFieldMappingPanel({ agentId }: { agentId: string }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [showJson, setShowJson] = useState<string | null>(null);
  const [sampleValue, setSampleValue] = useState<Record<string, string>>({});
  const [sampleResult, setSampleResult] = useState<Record<string, string>>({});

  const listVars  = useServerFn(listDynamicVariablesFn);
  const listMaps  = useServerFn(listVariableMappingsFn);
  const listRules = useServerFn(listTransformationRulesFn);
  const reviewVar = useServerFn(reviewDynamicVariableFn);
  const saveMap   = useServerFn(saveVariableMappingFn);
  const testTx    = useServerFn(testTransformationFn);

  const varsQ = useQuery({
    queryKey: ["sm-wizard-mapping-vars", agentId],
    queryFn: () => listVars({ data: { agentId } }),
    enabled: Boolean(agentId),
    throwOnError: false,
  });
  const mapsQ = useQuery({
    queryKey: ["sm-wizard-mapping-maps", agentId],
    queryFn: () => listMaps({ data: { agentId } }),
    enabled: Boolean(agentId),
    throwOnError: false,
  });
  const rulesQ = useQuery({
    queryKey: ["sm-wizard-mapping-rules"],
    queryFn: () => listRules(),
    throwOnError: false,
  });

  const approveMut = useMutation({
    mutationFn: (variableId: string) => reviewVar({ data: { variableId, action: "approve" } }),
    onSuccess: () => { toast.success("Mapping approved"); qc.invalidateQueries({ queryKey: ["sm-wizard-mapping-vars", agentId] }); },
    onError: (e: any) => toast.error(e?.message ?? "Failed to approve"),
  });

  const ruleMut = useMutation({
    mutationFn: (input: { variable: any; ruleId: string | null }) => {
      const v = input.variable;
      const existing = (mapsQ.data ?? []).find((m: any) => m.variableId === v.id);
      return saveMap({
        data: {
          id: existing?.id ?? null,
          variableId: v.id,
          direction: v.direction || "webee_to_retell_precall",
          sourceSystem: v.sourceSystem || undefined,
          sourceObject: v.sourceObject || undefined,
          sourceField: v.sourceField || undefined,
          destinationSystem: v.destinationSystem || undefined,
          destinationObject: v.destinationObject || undefined,
          destinationField: v.destinationField || undefined,
          transformationRuleId: input.ruleId,
          isRequired: v.isRequired,
        },
      });
    },
    onSuccess: () => { toast.success("Transformation saved"); qc.invalidateQueries({ queryKey: ["sm-wizard-mapping-maps", agentId] }); },
    onError: (e: any) => toast.error(e?.message ?? "Failed to save"),
  });

  const vars = (varsQ.data?.variables ?? []) as any[];
  const maps = (mapsQ.data ?? []) as any[];
  const rules = (rulesQ.data ?? []) as any[];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return vars;
    return vars.filter((v) =>
      [v.name, v.label, v.sourceField, v.destinationField, v.sourceSystem, v.destinationSystem]
        .some((x: string) => (x ?? "").toLowerCase().includes(q)));
  }, [vars, search]);

  // Duplicate destination detection — two variables writing the same coordinate.
  const dupDest = useMemo(() => {
    const seen = new Map<string, number>();
    for (const v of vars) {
      const d = coord(v.destinationSystem, v.destinationObject, v.destinationField);
      if (d !== "—") seen.set(d, (seen.get(d) ?? 0) + 1);
    }
    return new Set([...seen.entries()].filter(([, n]) => n > 1).map(([d]) => d));
  }, [vars]);

  if (varsQ.isLoading) return <Loader2 className="h-4 w-4 animate-spin text-slate-500" />;
  if (!vars.length) {
    return (
      <div className="text-xs text-slate-500">
        No variables discovered yet — run a scan from the Variable Engine (SystemMind → Variables) first.
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-slate-500" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search fields…" className="h-8 pl-7 text-xs" />
        </div>
        <span className="text-[10px] text-slate-500">{filtered.length}/{vars.length} fields</span>
      </div>

      <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 px-2 text-[10px] font-medium uppercase tracking-wide text-slate-500">
        <span>Source</span><span>Transformation</span><span>Destination</span><span />
      </div>

      <div className="max-h-96 space-y-1 overflow-y-auto pr-1">
        {filtered.map((v) => {
          const m = maps.find((x: any) => x.variableId === v.id);
          const src = coord(v.sourceSystem, v.sourceObject, v.sourceField);
          const dst = coord(v.destinationSystem, v.destinationObject, v.destinationField);
          const missingSource = v.isRequired && src === "—";
          const lowConf = v.confidence === "low";
          const approved = ["approved", "edited"].includes(v.status);
          const dup = dst !== "—" && dupDest.has(dst);
          const ruleId = m?.transformationRuleId ?? null;
          const rule = rules.find((r: any) => r.id === ruleId);
          return (
            <div key={v.id} className={cn(
              "rounded border bg-slate-950/50 px-2 py-1.5",
              missingSource || dup ? "border-amber-500/40" : "border-slate-800",
            )}>
              <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2 text-xs">
                <div className="min-w-0">
                  <div className="truncate font-medium text-slate-200">{v.name}</div>
                  <div className="truncate text-[10px] text-slate-500">{src}</div>
                </div>
                <div className="flex min-w-0 items-center gap-1">
                  <ArrowRight className="h-3 w-3 shrink-0 text-slate-600" />
                  <Select
                    value={ruleId ?? "none"}
                    onValueChange={(val) => ruleMut.mutate({ variable: v, ruleId: val === "none" ? null : val })}
                  >
                    <SelectTrigger className="h-7 flex-1 text-[10px]">
                      <SelectValue placeholder="No transformation" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Pass through</SelectItem>
                      {rules.map((r: any) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <ArrowRight className="h-3 w-3 shrink-0 text-slate-600" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-slate-300">{dst}</div>
                  <div className="flex items-center gap-1 text-[10px]">
                    {v.confidence && (
                      <Badge variant="outline" className={cn("h-4 px-1 text-[9px]", CONF_CLS[v.confidence] ?? "")}>
                        {v.confidence} confidence
                      </Badge>
                    )}
                    {v.dataType && <span className="text-slate-600">{v.dataType}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {approved
                    ? <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    : (
                      <Button size="sm" variant={lowConf ? "outline" : "secondary"} className="h-6 px-2 text-[10px]"
                        onClick={() => approveMut.mutate(v.id)} disabled={approveMut.isPending}>
                        {lowConf && <ShieldQuestion className="mr-1 h-3 w-3 text-amber-400" />}Approve
                      </Button>
                    )}
                  <Button size="sm" variant="ghost" className="h-6 px-1.5"
                    onClick={() => setShowJson(showJson === v.id ? null : v.id)}>
                    <Braces className="h-3 w-3 text-slate-500" />
                  </Button>
                </div>
              </div>

              {(missingSource || dup || (lowConf && !approved)) && (
                <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-amber-300">
                  {missingSource && <span className="flex items-center gap-1"><AlertTriangle className="h-3 w-3" />Required field has no source</span>}
                  {dup && <span className="flex items-center gap-1"><AlertTriangle className="h-3 w-3" />Duplicate destination — another field also writes {dst}</span>}
                  {lowConf && !approved && <span className="flex items-center gap-1"><AlertTriangle className="h-3 w-3" />Low-confidence auto-mapping — approval required before use</span>}
                </div>
              )}

              {showJson === v.id && (
                <div className="mt-2 space-y-2">
                  {rule && (
                    <div className="flex items-center gap-1">
                      <Input
                        value={sampleValue[v.id] ?? v.exampleValue ?? ""}
                        onChange={(e) => setSampleValue((s) => ({ ...s, [v.id]: e.target.value }))}
                        placeholder="Sample value…" className="h-7 flex-1 text-[10px]"
                      />
                      <Button size="sm" variant="outline" className="h-7 px-2 text-[10px]"
                        onClick={async () => {
                          try {
                            const res: any = await testTx({ data: { ruleId, sampleValue: sampleValue[v.id] ?? v.exampleValue ?? "", dataType: v.dataType } });
                            setSampleResult((s) => ({ ...s, [v.id]: JSON.stringify(res?.result ?? res) }));
                          } catch (e: any) { toast.error(e?.message ?? "Test failed"); }
                        }}>
                        <FlaskConical className="mr-1 h-3 w-3" />Test
                      </Button>
                      {sampleResult[v.id] !== undefined && (
                        <span className="truncate text-[10px] text-emerald-300">→ {sampleResult[v.id]}</span>
                      )}
                    </div>
                  )}
                  <pre className="max-h-40 overflow-auto rounded bg-slate-950 p-2 text-[10px] text-slate-400">
                    {JSON.stringify({ variable: v, mapping: m ?? null }, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
