import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Loader2, Wand2, ScanSearch, CheckCircle2, XCircle, Pencil, RotateCcw,
  FlaskConical, AlertTriangle, ArrowRight, Shield,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SystemMindShell } from "./SystemMindShell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  listAgentsForVariableEngineFn,
  scanAgentVariablesFn,
  listDynamicVariablesFn,
  reviewDynamicVariableFn,
  testTransformationFn,
  listTransformationRulesFn,
  saveTransformationRuleFn,
  deleteTransformationRuleFn,
  listVariableMappingsFn,
  saveVariableMappingFn,
  deleteVariableMappingFn,
} from "@/lib/systemmind/variable-engine.functions";

const DATA_TYPES = [
  "text", "number", "currency", "boolean", "date", "datetime", "email",
  "phone", "url", "address", "single_select", "multi_select", "json", "record_id",
];
const DIRECTIONS: Array<{ value: string; label: string }> = [
  { value: "unassigned",               label: "Unassigned" },
  { value: "crm_to_webee",             label: "CRM → WEBEE" },
  { value: "webee_to_retell_precall",  label: "WEBEE → Voice agent (pre-call)" },
  { value: "retell_to_webee",          label: "Voice agent → WEBEE (post-call)" },
  { value: "webee_to_crm_postcall",    label: "WEBEE → CRM (post-call)" },
  { value: "retell_to_crm_via_webee",  label: "Voice agent → CRM (via WEBEE)" },
  { value: "bidirectional",            label: "Bidirectional" },
];
const SENSITIVITIES = ["standard", "personal", "sensitive_personal", "financial", "restricted"];
const RULE_TYPES = [
  "date_format", "phone_e164", "currency_format", "boolean_map", "enum_map",
  "concat", "name_split", "null_fallback", "conditional", "custom_json",
];

function statusBadge(status: string) {
  const map: Record<string, string> = {
    detected: "bg-sky-500/15 text-sky-300 border-sky-500/30",
    approved: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    edited:   "bg-amber-500/15 text-amber-300 border-amber-500/30",
    rejected: "bg-red-500/15 text-red-300 border-red-500/30",
  };
  return <Badge variant="outline" className={cn("text-[10px]", map[status] ?? "")}>{status}</Badge>;
}

export function SystemMindVariableEnginePage() {
  const qc = useQueryClient();
  const [agentId, setAgentId] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, unknown>>({});

  const listAgentsFn = useServerFn(listAgentsForVariableEngineFn);
  const scanFn       = useServerFn(scanAgentVariablesFn);
  const listVarsFn   = useServerFn(listDynamicVariablesFn);
  const reviewFn     = useServerFn(reviewDynamicVariableFn);
  const testFn       = useServerFn(testTransformationFn);
  const listRulesFn  = useServerFn(listTransformationRulesFn);
  const saveRuleFn   = useServerFn(saveTransformationRuleFn);
  const deleteRuleFn = useServerFn(deleteTransformationRuleFn);
  const listMapsFn   = useServerFn(listVariableMappingsFn);
  const saveMapFn    = useServerFn(saveVariableMappingFn);
  const deleteMapFn  = useServerFn(deleteVariableMappingFn);

  const { data: agents, isLoading: agentsLoading, error: agentsError } = useQuery({
    queryKey: ["sm-variable-engine-agents"],
    queryFn: () => listAgentsFn(),
    throwOnError: false,
  });

  const { data: registry, isLoading: varsLoading, error: varsError } = useQuery({
    queryKey: ["sm-dynamic-variables", agentId],
    queryFn: () => listVarsFn({ data: { agentId } }),
    enabled: !!agentId,
    throwOnError: false,
  });

  const scanMut = useMutation({
    mutationFn: () => scanFn({ data: { agentId, useAi: true } }),
    onSuccess: (res: any) => {
      toast.success(`Scan complete — ${res.report.variableCount} variables found (${res.report.newVariableCount} new).`);
      qc.invalidateQueries({ queryKey: ["sm-dynamic-variables", agentId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Scan failed"),
  });

  const reviewMut = useMutation({
    mutationFn: (args: { variableId: string; action: string; edits?: Record<string, unknown> }) =>
      reviewFn({ data: args as any }),
    onSuccess: () => {
      setEditingId(null); setEdits({});
      qc.invalidateQueries({ queryKey: ["sm-dynamic-variables", agentId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Update failed"),
  });

  // Rule library
  const { data: rules, isLoading: rulesLoading, error: rulesError } = useQuery({
    queryKey: ["sm-transformation-rules"],
    queryFn: () => listRulesFn(),
    throwOnError: false,
  });

  const [ruleName, setRuleName] = useState("");
  const [ruleDescription, setRuleDescription] = useState("");
  const saveRuleMut = useMutation({
    mutationFn: async () => {
      if (!ruleName.trim()) throw new Error("Give the rule a name first.");
      let cfg: Record<string, unknown> = {};
      try { cfg = JSON.parse(testConfig || "{}"); } catch { throw new Error("Config is not valid JSON."); }
      return saveRuleFn({ data: { name: ruleName.trim(), description: ruleDescription.trim() || undefined, ruleType: testRuleType, config: cfg } });
    },
    onSuccess: () => {
      toast.success("Transformation rule saved.");
      setRuleName(""); setRuleDescription("");
      qc.invalidateQueries({ queryKey: ["sm-transformation-rules"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not save rule"),
  });
  const deleteRuleMut = useMutation({
    mutationFn: (id: string) => deleteRuleFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Rule deleted.");
      qc.invalidateQueries({ queryKey: ["sm-transformation-rules"] });
      qc.invalidateQueries({ queryKey: ["sm-variable-mappings", agentId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not delete rule"),
  });

  // Mappings
  const { data: mappings, error: mapsError } = useQuery({
    queryKey: ["sm-variable-mappings", agentId],
    queryFn: () => listMapsFn({ data: { agentId } }),
    enabled: !!agentId,
    throwOnError: false,
  });
  const [mapVariableId, setMapVariableId] = useState("");
  const [mapDirection, setMapDirection] = useState("webee_to_retell_precall");
  const [mapDestField, setMapDestField] = useState("");
  const [mapRuleId, setMapRuleId] = useState("none");
  const saveMapMut = useMutation({
    mutationFn: async () => {
      if (!mapVariableId) throw new Error("Pick a variable for the mapping.");
      return saveMapFn({ data: {
        variableId: mapVariableId,
        direction: mapDirection,
        destinationField: mapDestField.trim() || undefined,
        transformationRuleId: mapRuleId === "none" ? null : mapRuleId,
      } });
    },
    onSuccess: () => {
      toast.success("Mapping saved.");
      setMapVariableId(""); setMapDestField(""); setMapRuleId("none");
      qc.invalidateQueries({ queryKey: ["sm-variable-mappings", agentId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not save mapping"),
  });
  const deleteMapMut = useMutation({
    mutationFn: (id: string) => deleteMapFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Mapping removed.");
      qc.invalidateQueries({ queryKey: ["sm-variable-mappings", agentId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not remove mapping"),
  });

  // Transformation tester state
  const [testRuleType, setTestRuleType] = useState("phone_e164");
  const [testConfig, setTestConfig] = useState('{"defaultCountryCode":"44"}');
  const [testValue, setTestValue] = useState("07700 900123");
  const [testDataType, setTestDataType] = useState("phone");
  const [testResult, setTestResult] = useState<any>(null);

  const testMut = useMutation({
    mutationFn: async () => {
      let cfg: Record<string, unknown> = {};
      try { cfg = JSON.parse(testConfig || "{}"); } catch { throw new Error("Config is not valid JSON."); }
      return testFn({ data: { ruleType: testRuleType, config: cfg, sampleValue: testValue, dataType: testDataType } });
    },
    onSuccess: (res: any) => setTestResult(res),
    onError: (e: any) => toast.error(e?.message ?? "Test failed"),
  });

  const variables = registry?.variables ?? [];
  const report = registry?.latestScan?.report ?? null;
  const counts = useMemo(() => {
    const c = { detected: 0, approved: 0, edited: 0, rejected: 0 } as Record<string, number>;
    for (const v of variables) c[v.status] = (c[v.status] ?? 0) + 1;
    return c;
  }, [variables]);

  return (
    <SystemMindShell>
      <div className="p-5 md:p-6 max-w-5xl space-y-6">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <Wand2 className="h-4.5 w-4.5 text-sky-400" /> Variable Engine
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Scan an agent build to detect every dynamic variable it uses, then review each one — type, direction,
            sensitivity and where it flows. Nothing is sent anywhere until you approve it. Credential values are
            never read or stored.
          </p>
        </div>

        {/* Agent picker + scan */}
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-3">
          <p className="text-sm font-semibold flex items-center gap-2">
            <ScanSearch className="h-4 w-4 text-sky-400" /> Scan an agent
          </p>
          {agentsError ? (
            <p className="text-xs text-red-400 flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" /> Could not load agents: {(agentsError as any)?.message}
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Select value={agentId} onValueChange={setAgentId}>
                <SelectTrigger className="w-72 h-9 text-xs">
                  <SelectValue placeholder={agentsLoading ? "Loading agents…" : "Select an agent"} />
                </SelectTrigger>
                <SelectContent>
                  {(agents ?? []).map((a: any) => (
                    <SelectItem key={a.id} value={a.id} className="text-xs">
                      {a.name} {a.isDeployed ? "· live" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" disabled={!agentId || scanMut.isPending} onClick={() => scanMut.mutate()}>
                {scanMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <ScanSearch className="h-3.5 w-3.5 mr-1.5" />}
                Run scan
              </Button>
            </div>
          )}
          {!agentsLoading && (agents ?? []).length === 0 && !agentsError && (
            <p className="text-xs text-muted-foreground">No agents in this workspace yet — build one first, then scan it here.</p>
          )}
        </div>

        {/* Detected requirements report */}
        {agentId && report && (
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-2">
            <p className="text-sm font-semibold">Detected requirements — {report.agentName}</p>
            <div className="flex flex-wrap gap-1.5">
              {report.requiredIntegrations.map((i: string) => (
                <Badge key={i} variant="outline" className="text-[10px]">{i}</Badge>
              ))}
              {report.hasBookingLogic && <Badge variant="outline" className="text-[10px] text-emerald-300">booking logic</Badge>}
              {report.hasTransferLogic && <Badge variant="outline" className="text-[10px] text-amber-300">call transfer</Badge>}
              {report.hasWebhookLogic && <Badge variant="outline" className="text-[10px]">webhooks</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">
              Webhook events: {report.requiredWebhookEvents.join(", ") || "none"} ·
              Credentials needed (names only): {report.requiredCredentialNames.join("; ") || "none"}
            </p>
          </div>
        )}

        {/* Variable registry */}
        {agentId && (
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Variable registry</p>
              <p className="text-[11px] text-muted-foreground">
                {counts.detected ?? 0} to review · {counts.approved ?? 0} approved · {counts.edited ?? 0} edited · {counts.rejected ?? 0} rejected
              </p>
            </div>
            {varsError ? (
              <p className="text-xs text-red-400 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" /> Could not load variables: {(varsError as any)?.message}
              </p>
            ) : varsLoading ? (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</p>
            ) : variables.length === 0 ? (
              <p className="text-xs text-muted-foreground">No variables yet — run a scan to detect them.</p>
            ) : (
              <div className="space-y-2">
                {variables.map((v: any) => (
                  <div key={v.id} className="rounded-lg border border-white/[0.06] p-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="text-xs font-mono text-sky-300">{`{{${v.name}}}`}</code>
                      {statusBadge(v.status)}
                      <Badge variant="outline" className="text-[10px]">{v.dataType}</Badge>
                      <Badge variant="outline" className="text-[10px]">{DIRECTIONS.find((d) => d.value === v.direction)?.label ?? v.direction}</Badge>
                      {v.sensitivity !== "standard" && (
                        <Badge variant="outline" className="text-[10px] text-amber-300 flex items-center gap-1">
                          <Shield className="h-3 w-3" /> {v.sensitivity.replace(/_/g, " ")}
                        </Badge>
                      )}
                      {v.isRequired && <Badge variant="outline" className="text-[10px] text-red-300">required</Badge>}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Found in: {v.detectedSources.join("; ") || "—"}
                    </p>
                    <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                      {v.sourceSystem}.{v.sourceObject}.{v.sourceField} <ArrowRight className="h-3 w-3" /> {v.destinationSystem}.{v.destinationObject}.{v.destinationField}
                    </p>

                    {editingId === v.id ? (
                      <div className="grid gap-2 sm:grid-cols-2 pt-1">
                        <label className="text-[11px] space-y-1">
                          <span className="text-muted-foreground">Data type</span>
                          <Select value={String(edits.data_type ?? v.dataType)} onValueChange={(val) => setEdits((e) => ({ ...e, data_type: val }))}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>{DATA_TYPES.map((t) => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}</SelectContent>
                          </Select>
                        </label>
                        <label className="text-[11px] space-y-1">
                          <span className="text-muted-foreground">Direction</span>
                          <Select value={String(edits.direction ?? v.direction)} onValueChange={(val) => setEdits((e) => ({ ...e, direction: val }))}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>{DIRECTIONS.map((d) => <SelectItem key={d.value} value={d.value} className="text-xs">{d.label}</SelectItem>)}</SelectContent>
                          </Select>
                        </label>
                        <label className="text-[11px] space-y-1">
                          <span className="text-muted-foreground">Sensitivity</span>
                          <Select value={String(edits.sensitivity ?? v.sensitivity)} onValueChange={(val) => setEdits((e) => ({ ...e, sensitivity: val }))}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>{SENSITIVITIES.map((s) => <SelectItem key={s} value={s} className="text-xs">{s.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
                          </Select>
                        </label>
                        <label className="text-[11px] space-y-1">
                          <span className="text-muted-foreground">Destination field</span>
                          <Input className="h-8 text-xs" defaultValue={v.destinationField}
                            onChange={(ev) => setEdits((e) => ({ ...e, destination_field: ev.target.value }))} />
                        </label>
                        <label className="text-[11px] space-y-1">
                          <span className="text-muted-foreground">Fallback value (used when empty)</span>
                          <Input className="h-8 text-xs" defaultValue={v.fallbackValue}
                            onChange={(ev) => setEdits((e) => ({ ...e, fallback_value: ev.target.value }))} />
                        </label>
                        <div className="flex items-end gap-2">
                          <Button size="sm" disabled={reviewMut.isPending}
                            onClick={() => reviewMut.mutate({ variableId: v.id, action: "edit", edits })}>
                            {reviewMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
                            Save changes
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => { setEditingId(null); setEdits({}); }}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {v.status !== "approved" && (
                          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={reviewMut.isPending}
                            onClick={() => reviewMut.mutate({ variableId: v.id, action: "approve" })}>
                            <CheckCircle2 className="h-3 w-3 mr-1 text-emerald-400" /> Approve
                          </Button>
                        )}
                        <Button size="sm" variant="outline" className="h-7 text-xs"
                          onClick={() => { setEditingId(v.id); setEdits({}); }}>
                          <Pencil className="h-3 w-3 mr-1" /> Edit
                        </Button>
                        {v.status !== "rejected" ? (
                          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={reviewMut.isPending}
                            onClick={() => reviewMut.mutate({ variableId: v.id, action: "reject" })}>
                            <XCircle className="h-3 w-3 mr-1 text-red-400" /> Reject
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={reviewMut.isPending}
                            onClick={() => reviewMut.mutate({ variableId: v.id, action: "reopen" })}>
                            <RotateCcw className="h-3 w-3 mr-1" /> Reopen
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Variable mappings */}
        {agentId && (
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-3">
            <p className="text-sm font-semibold">Field mappings</p>
            <p className="text-[11px] text-muted-foreground">
              Connect a variable to a destination field, optionally passing it through a transformation rule.
            </p>
            {mapsError ? (
              <p className="text-xs text-red-400 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" /> Could not load mappings: {(mapsError as any)?.message}
              </p>
            ) : (mappings ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">No mappings yet.</p>
            ) : (
              <div className="space-y-1.5">
                {(mappings ?? []).map((m: any) => {
                  const v = variables.find((x: any) => x.id === m.variableId);
                  const rule = (rules ?? []).find((r: any) => r.id === m.transformationRuleId);
                  return (
                    <div key={m.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.06] p-2.5 text-xs">
                      <code className="font-mono text-sky-300">{v ? `{{${v.name}}}` : m.variableId}</code>
                      <Badge variant="outline" className="text-[10px]">{DIRECTIONS.find((d) => d.value === m.direction)?.label ?? m.direction}</Badge>
                      <span className="text-muted-foreground flex items-center gap-1">
                        <ArrowRight className="h-3 w-3" /> {m.destinationField || "(default field)"}
                      </span>
                      {rule && <Badge variant="outline" className="text-[10px] text-violet-300">rule: {rule.name}</Badge>}
                      <Button size="sm" variant="ghost" className="h-6 text-[11px] ml-auto" disabled={deleteMapMut.isPending}
                        onClick={() => deleteMapMut.mutate(m.id)}>
                        <XCircle className="h-3 w-3 mr-1 text-red-400" /> Remove
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="grid gap-2 sm:grid-cols-4 pt-1">
              <label className="text-[11px] space-y-1">
                <span className="text-muted-foreground">Variable</span>
                <Select value={mapVariableId} onValueChange={setMapVariableId}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Pick a variable" /></SelectTrigger>
                  <SelectContent>
                    {variables.map((v: any) => <SelectItem key={v.id} value={v.id} className="text-xs">{v.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </label>
              <label className="text-[11px] space-y-1">
                <span className="text-muted-foreground">Direction</span>
                <Select value={mapDirection} onValueChange={setMapDirection}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{DIRECTIONS.filter((d) => d.value !== "unassigned").map((d) => <SelectItem key={d.value} value={d.value} className="text-xs">{d.label}</SelectItem>)}</SelectContent>
                </Select>
              </label>
              <label className="text-[11px] space-y-1">
                <span className="text-muted-foreground">Destination field</span>
                <Input className="h-8 text-xs" placeholder="e.g. phone_number" value={mapDestField} onChange={(e) => setMapDestField(e.target.value)} />
              </label>
              <label className="text-[11px] space-y-1">
                <span className="text-muted-foreground">Transformation rule</span>
                <Select value={mapRuleId} onValueChange={setMapRuleId}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none" className="text-xs">None</SelectItem>
                    {(rules ?? []).map((r: any) => <SelectItem key={r.id} value={r.id} className="text-xs">{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </label>
            </div>
            <Button size="sm" disabled={!mapVariableId || saveMapMut.isPending} onClick={() => saveMapMut.mutate()}>
              {saveMapMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />}
              Add mapping
            </Button>
          </div>
        )}

        {/* Rule library */}
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-3">
          <p className="text-sm font-semibold">Transformation rule library</p>
          {rulesError ? (
            <p className="text-xs text-red-400 flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5" /> Could not load rules: {(rulesError as any)?.message}
            </p>
          ) : rulesLoading ? (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…</p>
          ) : (rules ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">No saved rules yet — build one in the tester below, then save it here.</p>
          ) : (
            <div className="space-y-1.5">
              {(rules ?? []).map((r: any) => (
                <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/[0.06] p-2.5 text-xs">
                  <span className="font-medium">{r.name}</span>
                  <Badge variant="outline" className="text-[10px]">{r.ruleType}</Badge>
                  {r.description && <span className="text-muted-foreground">{r.description}</span>}
                  <Button size="sm" variant="ghost" className="h-6 text-[11px] ml-auto" disabled={deleteRuleMut.isPending}
                    onClick={() => deleteRuleMut.mutate(r.id)}>
                    <XCircle className="h-3 w-3 mr-1 text-red-400" /> Delete
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Transformation tester */}
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-3">
          <p className="text-sm font-semibold flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-sky-400" /> Test a transformation
          </p>
          <p className="text-[11px] text-muted-foreground">
            Try any transformation with sample data before it's used in a live mapping — you'll see the exact
            output and whether it passes validation for the target type.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-[11px] space-y-1">
              <span className="text-muted-foreground">Rule type</span>
              <Select value={testRuleType} onValueChange={setTestRuleType}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{RULE_TYPES.map((t) => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <label className="text-[11px] space-y-1">
              <span className="text-muted-foreground">Validate output as</span>
              <Select value={testDataType} onValueChange={setTestDataType}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{DATA_TYPES.map((t) => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}</SelectContent>
              </Select>
            </label>
            <label className="text-[11px] space-y-1 sm:col-span-2">
              <span className="text-muted-foreground">Rule config (JSON)</span>
              <Textarea className="text-xs font-mono min-h-[60px]" value={testConfig} onChange={(e) => setTestConfig(e.target.value)} />
            </label>
            <label className="text-[11px] space-y-1 sm:col-span-2">
              <span className="text-muted-foreground">Sample input value</span>
              <Input className="h-8 text-xs" value={testValue} onChange={(e) => setTestValue(e.target.value)} />
            </label>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Button size="sm" disabled={testMut.isPending} onClick={() => testMut.mutate()}>
              {testMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <FlaskConical className="h-3.5 w-3.5 mr-1.5" />}
              Run test
            </Button>
            <Input className="h-8 text-xs w-56" placeholder="Rule name (to save it)" value={ruleName} onChange={(e) => setRuleName(e.target.value)} />
            <Input className="h-8 text-xs w-72" placeholder="Description (optional)" value={ruleDescription} onChange={(e) => setRuleDescription(e.target.value)} />
            <Button size="sm" variant="outline" disabled={!ruleName.trim() || saveRuleMut.isPending} onClick={() => saveRuleMut.mutate()}>
              {saveRuleMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />}
              Save as rule
            </Button>
          </div>
          {testResult && (
            <div className="rounded-lg border border-white/[0.06] p-3 text-xs space-y-1 font-mono">
              <p>input: {JSON.stringify(testResult.sourceValue)}</p>
              <p className={testResult.transformed.ok ? "text-emerald-300" : "text-red-300"}>
                transformed: {testResult.transformed.ok ? JSON.stringify(testResult.transformed.value) : `✗ ${testResult.transformed.error}`}
              </p>
              <p>destination value: {JSON.stringify(testResult.destinationValue)}</p>
              <p className={testResult.validation.valid ? "text-emerald-300" : "text-red-300"}>
                validation: {testResult.validation.valid ? "✓ passes" : `✗ ${testResult.validation.error}`}
              </p>
              {testResult.error && <p className="text-amber-300">note: {testResult.error}</p>}
            </div>
          )}
        </div>
      </div>
    </SystemMindShell>
  );
}
