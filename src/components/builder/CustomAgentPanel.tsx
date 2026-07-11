// ── CustomAgentPanel ───────────────────────────────────────────────────────────
// Builder right-panel section for agentType === "custom".
// Option A: Generate workflow from text description (SystemMind drafts → canvas).
// Option B: Configure deployment from existing script (full 12-section analysis).

import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Wand2,
  FileCode2,
  ChevronDown,
  Loader2,
  Import,
  CheckCircle,
  AlertTriangle,
  ClipboardList,
  Save,
  Wrench,
  Database,
  Webhook,
  Calendar,
  ListChecks,
  Variable,
  Target,
  Layers,
  Hammer,
} from "lucide-react";
import { useBuilderStore } from "@/lib/builder/store";
import type { NodeKind } from "@/lib/builder/types";
import {
  generateCustomWorkflowFn,
  analyzeScriptFn,
  saveCustomAgentConfigFn,
  createAdminChangeRequestFn,
} from "@/lib/systemmind/custom-agent.functions";

// ── Node type mapping from AI draft → Builder NodeKind ────────────────────────
function mapNodeKind(type: string): NodeKind {
  const t = (type ?? "").toLowerCase();
  if (t.includes("function") || t.includes("tool")) return "function";
  if (t.includes("transfer") || t.includes("call_transfer")) return "call_transfer";
  if (t.includes("end") || t.includes("ending")) return "ending";
  if (t.includes("logic") || t.includes("split") || t.includes("branch")) return "logic_split";
  if (t.includes("http") || t.includes("request") || t.includes("webhook")) return "http_request";
  if (t.includes("extract") || t.includes("variable")) return "extract_variable";
  return "conversation";
}

function importDraftToCanvas(draft: any) {
  const store = useBuilderStore.getState();
  store.clearAll();

  const idMap: Record<string, string> = {};
  const nodes: any[] = draft.nodes ?? [];

  nodes.forEach((n: any, i: number) => {
    const kind = mapNodeKind(n.type ?? "conversation");
    const col = i % 3;
    const row = Math.floor(i / 3);
    store.addNode(kind, { x: 160 + col * 240, y: 100 + row * 160 });

    const allNodes = useBuilderStore.getState().nodes;
    const added = allNodes[allNodes.length - 1];
    if (added) {
      idMap[n.id] = added.id;
      store.updateNode(added.id, {
        label: n.name ?? n.id,
        dialogue: n.instruction ?? n.description ?? "",
        ...(i === 0 ? { isStart: true } : {}),
      });
    }
  });

  const edges = (draft.edges ?? []).map((e: any) => ({
    id: `e_${e.from}_${e.to}_${Math.random().toString(36).slice(2)}`,
    source: idMap[e.from] ?? e.from,
    target: idMap[e.to] ?? e.to,
    label: e.condition ?? "",
    animated: false,
    type: "default",
  }));

  useBuilderStore.setState({ edges });
}

// ── Readiness badge ────────────────────────────────────────────────────────────
function ReadinessBadge({ score }: { score: number }) {
  const color =
    score >= 85
      ? "bg-green-500/10 text-green-400 border-green-500/20"
      : score >= 50
      ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/20"
      : "bg-red-500/10 text-red-400 border-red-500/20";
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border ${color}`}>
      {score >= 85 ? <CheckCircle className="h-2.5 w-2.5" /> : <AlertTriangle className="h-2.5 w-2.5" />}
      {score}% ready
    </span>
  );
}

// ── Section wrapper ────────────────────────────────────────────────────────────
function ResultSection({
  icon: Icon,
  title,
  badge,
  children,
}: {
  icon: any;
  title: string;
  badge?: string | number;
  children: React.ReactNode;
}) {
  return (
    <Collapsible className="rounded border border-white/[0.06]">
      <CollapsibleTrigger className="group flex w-full items-center justify-between px-2.5 py-2 text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors">
        <span className="flex items-center gap-1.5">
          <Icon className="h-3 w-3" />
          {title}
          {badge !== undefined && (
            <span className="ml-0.5 rounded px-1 py-0 bg-white/[0.06] text-[9px]">{badge}</span>
          )}
        </span>
        <ChevronDown className="h-2.5 w-2.5 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-2.5 pb-2.5 text-[10px] text-muted-foreground">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export function CustomAgentPanel() {
  const navigate = useNavigate();
  const currentAgentRowId = useBuilderStore((s) => s.currentAgentRowId);
  const [mode, setMode] = useState<"build" | "configure">("build");

  // Option A state
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("custom");
  const [draftResult, setDraftResult] = useState<any>(null);
  const [generatingA, setGeneratingA] = useState(false);
  const [importedToCanvas, setImportedToCanvas] = useState(false);

  // Option B state
  const [scriptText, setScriptText] = useState("");
  const [crmMode, setCrmMode] = useState("webee");
  const [extractionHints, setExtractionHints] = useState("");
  const [webhookSpec, setWebhookSpec] = useState("");
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [generatingB, setGeneratingB] = useState(false);
  const [savedConfigId, setSavedConfigId] = useState<string | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);

  // ── Option A: generate workflow draft ───────────────────────────────────────
  async function handleGenerateWorkflow() {
    if (!description.trim()) {
      toast.error("Enter a description first");
      return;
    }
    setGeneratingA(true);
    setDraftResult(null);
    setImportedToCanvas(false);
    try {
      const res = await generateCustomWorkflowFn({ data: { description, category } });
      setDraftResult(res.draft);
      toast.success("Workflow draft generated", {
        description: `${res.draft?.nodes?.length ?? 0} nodes · ${res.draft?.edges?.length ?? 0} edges`,
      });
    } catch (e: any) {
      toast.error("Generation failed", { description: e.message });
    } finally {
      setGeneratingA(false);
    }
  }

  function handleImportToCanvas() {
    if (!draftResult) return;
    try {
      importDraftToCanvas(draftResult);
      setImportedToCanvas(true);
      toast.success("Draft loaded into canvas", {
        description: "Review and adjust the nodes in the flow editor.",
      });
    } catch (e: any) {
      toast.error("Canvas import failed", { description: e.message });
    }
  }

  // ── Option B: analyze script ─────────────────────────────────────────────────
  async function handleAnalyzeScript() {
    if (!scriptText.trim()) {
      toast.error("Paste your script first");
      return;
    }
    setGeneratingB(true);
    setAnalysisResult(null);
    setSavedConfigId(null);
    try {
      const res = await analyzeScriptFn({
        data: { scriptText, crmMode, extractionHints, webhookSpec },
      });
      setAnalysisResult(res.config);
      toast.success("Script analysed", {
        description: `Readiness: ${res.config?.deployment_readiness_score ?? 0}%`,
      });
    } catch (e: any) {
      toast.error("Analysis failed", { description: e.message });
    } finally {
      setGeneratingB(false);
    }
  }

  async function handleSaveConfig() {
    if (!analysisResult) return;
    setSavingConfig(true);
    try {
      const res = await saveCustomAgentConfigFn({
        data: {
          title: analysisResult.deployment_config?.suggested_agent_type
            ? `Custom Config — ${analysisResult.deployment_config.suggested_agent_type}`
            : "Custom Agent Config",
          config: analysisResult,
          crm_mode: crmMode,
          source_script: scriptText,
          existingId: savedConfigId ?? undefined,
        },
      });
      setSavedConfigId(res.id);
      toast.success("Configuration saved");
    } catch (e: any) {
      toast.error("Save failed", { description: e.message });
    } finally {
      setSavingConfig(false);
    }
  }

  async function handleRequestAdmin(cap: any) {
    try {
      await createAdminChangeRequestFn({
        data: {
          requestType: "custom_tool",
          title: cap.capability,
          missingCapability: cap.capability,
          technicalSummary: cap.why_needed,
          configId: savedConfigId ?? undefined,
        },
      });
      toast.success("Admin request submitted", {
        description: "Our team will review and quote this capability.",
      });
    } catch (e: any) {
      toast.error("Request failed", { description: e.message });
    }
  }

  return (
    <div className="space-y-3 mt-1">
      {/* SystemMind Build Workspace entry */}
      <button
        onClick={() =>
          navigate({
            to: "/systemmind/build",
            search: currentAgentRowId
              ? { session: undefined, workflow: undefined, agent: currentAgentRowId }
              : { session: undefined, workflow: undefined, agent: undefined },
          })
        }
        className="w-full flex items-center gap-2 rounded-lg border border-sky-500/25 bg-sky-500/[0.06] px-2.5 py-2 text-left transition-colors hover:bg-sky-500/[0.12]"
      >
        <Hammer className="h-3.5 w-3.5 shrink-0 text-sky-400" />
        <div className="min-w-0">
          <p className="text-[10px] font-semibold text-sky-300 leading-none">Build with SystemMind</p>
          <p className="text-[9px] text-muted-foreground mt-0.5 leading-tight">
            Iterative chat builder — prompt, test, version, then apply.
          </p>
        </div>
      </button>

      {/* Mode tabs */}
      <div className="flex gap-1 rounded-lg border border-white/[0.06] p-0.5 bg-white/[0.02]">
        <button
          onClick={() => setMode("build")}
          className={`flex-1 flex items-center justify-center gap-1 py-1 rounded-md text-[10px] font-medium transition-colors ${
            mode === "build"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Wand2 className="h-2.5 w-2.5" />
          Build from Description
        </button>
        <button
          onClick={() => setMode("configure")}
          className={`flex-1 flex items-center justify-center gap-1 py-1 rounded-md text-[10px] font-medium transition-colors ${
            mode === "configure"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <FileCode2 className="h-2.5 w-2.5" />
          Configure from Script
        </button>
      </div>

      {/* ── Option A: Build from Description ─────────────────────────────────── */}
      {mode === "build" && (
        <div className="space-y-2">
          <div>
            <Label className="text-[9px]">What should this agent do?</Label>
            <Textarea
              className="mt-1 text-[10px] min-h-[72px] resize-none"
              placeholder="e.g. A receptionist that books appointments, collects caller name and email, qualifies by budget, and transfers to a human if they're a hot lead…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <button
            type="button"
            onClick={() => {
              setDescription(
                "You are an outbound lead-qualification voice agent for {{business_name}}. You automatically call every new lead the moment they come in from a website/webform enquiry.\n\n" +
                "Goal: quickly qualify the lead and book the next step.\n" +
                "1. Greet {{full_name}} by name and say you're calling about their enquiry with {{business_name}}.\n" +
                "2. Confirm you're speaking to the right person and that now is a good time.\n" +
                "3. Ask 2-4 short qualifying questions (their need, timeframe, budget/fit) — keep it natural.\n" +
                "4. If they're a good fit and interested, book the appointment / next step and confirm the details.\n" +
                "5. If they're not ready right now, offer a callback at a better time.\n" +
                "6. If it goes to voicemail or no answer, end politely — the system will automatically try again later (up to 3 attempts per day).\n\n" +
                "Tone: warm, professional, concise. Never be pushy. Always confirm contact details before ending.\n\n" +
                "Outcome mapping (drives the lead's status automatically):\n" +
                "- Positive / booked -> qualified\n" +
                "- Interested but not booked -> interested\n" +
                "- Wants a callback -> callback requested\n" +
                "- No answer / voicemail -> re-queued for the next run"
              );
              setCategory("client_qualification");
            }}
            className="text-[9px] text-primary hover:underline text-left w-full"
          >
            Use the standard lead-gen webform intake setup
          </button>

          <div>
            <Label className="text-[9px]">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="h-6 text-[10px] mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="custom">Custom</SelectItem>
                <SelectItem value="receptionist">Receptionist</SelectItem>
                <SelectItem value="lead_generation">Lead Generation</SelectItem>
                <SelectItem value="client_qualification">Client Qualification</SelectItem>
                <SelectItem value="appointment_booking">Appointment Booking</SelectItem>
                <SelectItem value="document_collection">Document Collection</SelectItem>
                <SelectItem value="follow_up">Follow-Up Campaign</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button
            size="sm"
            onClick={handleGenerateWorkflow}
            disabled={generatingA || !description.trim()}
            className="w-full h-7 text-[10px]"
          >
            {generatingA ? (
              <>
                <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <Wand2 className="h-3 w-3 mr-1.5" />
                Generate Workflow
              </>
            )}
          </Button>

          {/* Draft result */}
          {draftResult && (
            <div className="space-y-1.5 mt-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium text-foreground">{draftResult.title}</span>
                <Button
                  size="sm"
                  variant={importedToCanvas ? "outline" : "default"}
                  onClick={handleImportToCanvas}
                  className="h-6 text-[9px] px-2"
                >
                  {importedToCanvas ? (
                    <><CheckCircle className="h-2.5 w-2.5 mr-1" />Loaded</>
                  ) : (
                    <><Import className="h-2.5 w-2.5 mr-1" />Load to Canvas</>
                  )}
                </Button>
              </div>

              {/* Nodes preview */}
              {(draftResult.nodes ?? []).length > 0 && (
                <ResultSection icon={Layers} title="Nodes" badge={draftResult.nodes.length}>
                  <div className="space-y-1 pt-1">
                    {draftResult.nodes.map((n: any) => (
                      <div key={n.id} className="flex items-start gap-1.5">
                        <Badge variant="outline" className="text-[9px] py-0 shrink-0 capitalize">
                          {n.type?.replace(/_/g, " ") ?? "conv"}
                        </Badge>
                        <span className="text-[10px]">{n.name}</span>
                      </div>
                    ))}
                  </div>
                </ResultSection>
              )}

              {/* Variables */}
              {(draftResult.variables ?? []).length > 0 && (
                <ResultSection icon={Variable} title="Variables" badge={draftResult.variables.length}>
                  <div className="space-y-1 pt-1">
                    {draftResult.variables.map((v: any) => (
                      <div key={v.name} className="flex items-center gap-1.5">
                        <code className="text-[9px] text-violet-400">{v.name}</code>
                        <span className="text-[9px] opacity-60">({v.type})</span>
                        <span className="text-[9px] truncate">{v.description}</span>
                      </div>
                    ))}
                  </div>
                </ResultSection>
              )}

              {/* Tools */}
              {(draftResult.tools ?? []).length > 0 && (
                <ResultSection icon={Wrench} title="Tools" badge={draftResult.tools.length}>
                  <div className="space-y-1 pt-1">
                    {draftResult.tools.map((t: any) => (
                      <div key={t.name}>
                        <p className="text-[10px] font-medium text-foreground">{t.name}</p>
                        <p className="text-[9px] opacity-70">{t.description}</p>
                      </div>
                    ))}
                  </div>
                </ResultSection>
              )}

              {/* Suggestions */}
              {(draftResult.follow_up_suggestions ?? []).length > 0 && (
                <ResultSection icon={ListChecks} title="Suggestions">
                  <ul className="space-y-0.5 pt-1 list-disc list-inside">
                    {draftResult.follow_up_suggestions.map((s: string, i: number) => (
                      <li key={i} className="text-[9px]">{s}</li>
                    ))}
                  </ul>
                </ResultSection>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Option B: Configure from Script ──────────────────────────────────── */}
      {mode === "configure" && (
        <div className="space-y-2">
          <div>
            <Label className="text-[9px]">Paste script or transcript</Label>
            <Textarea
              className="mt-1 text-[10px] min-h-[90px] resize-none font-mono"
              placeholder="Paste your call script, conversation flow, or transcript here…"
              value={scriptText}
              onChange={(e) => setScriptText(e.target.value)}
            />
          </div>

          <div>
            <Label className="text-[9px]">CRM Mode</Label>
            <Select value={crmMode} onValueChange={setCrmMode}>
              <SelectTrigger className="h-6 text-[10px] mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="webee">WEBEE Smart Dash (built-in CRM)</SelectItem>
                <SelectItem value="existing_crm">Existing CRM (via webhook)</SelectItem>
                <SelectItem value="webhook_only">Webhook only (no CRM)</SelectItem>
                <SelectItem value="none">No CRM integration</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Collapsible className="rounded border border-white/[0.05]">
            <CollapsibleTrigger className="group flex w-full items-center justify-between px-2 py-1.5 text-[9px] text-muted-foreground hover:text-foreground transition-colors">
              <span>Advanced hints (optional)</span>
              <ChevronDown className="h-2.5 w-2.5 group-data-[state=open]:rotate-180 transition-transform" />
            </CollapsibleTrigger>
            <CollapsibleContent className="px-2 pb-2 space-y-2">
              <div>
                <Label className="text-[9px]">Data extraction hints</Label>
                <Input
                  className="h-6 text-[10px] mt-0.5"
                  placeholder="e.g. name, email, budget, property type…"
                  value={extractionHints}
                  onChange={(e) => setExtractionHints(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-[9px]">Webhook endpoint spec</Label>
                <Input
                  className="h-6 text-[10px] mt-0.5"
                  placeholder="https://your-crm.com/webhook/calls"
                  value={webhookSpec}
                  onChange={(e) => setWebhookSpec(e.target.value)}
                />
              </div>
            </CollapsibleContent>
          </Collapsible>

          <Button
            size="sm"
            onClick={handleAnalyzeScript}
            disabled={generatingB || !scriptText.trim()}
            className="w-full h-7 text-[10px]"
          >
            {generatingB ? (
              <>
                <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />
                Analysing script…
              </>
            ) : (
              <>
                <FileCode2 className="h-3 w-3 mr-1.5" />
                Analyse Script
              </>
            )}
          </Button>

          {/* Analysis results */}
          {analysisResult && (
            <div className="space-y-1.5 mt-1">
              {/* Header */}
              <div className="flex items-center justify-between py-1">
                <div className="flex items-center gap-2">
                  <ReadinessBadge score={analysisResult.deployment_readiness_score ?? 0} />
                  <Badge variant="outline" className="text-[9px] py-0 capitalize">
                    {analysisResult.deployment_config?.suggested_agent_type ?? "custom"}
                  </Badge>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleSaveConfig}
                  disabled={savingConfig}
                  className="h-6 text-[9px] px-2"
                >
                  {savingConfig ? (
                    <Loader2 className="h-2.5 w-2.5 animate-spin" />
                  ) : savedConfigId ? (
                    <><CheckCircle className="h-2.5 w-2.5 mr-1 text-green-400" />Saved</>
                  ) : (
                    <><Save className="h-2.5 w-2.5 mr-1" />Save</>
                  )}
                </Button>
              </div>

              {analysisResult.agent_summary && (
                <p className="text-[10px] text-muted-foreground leading-relaxed px-0.5">
                  {analysisResult.agent_summary}
                </p>
              )}

              {/* Required Variables */}
              {(analysisResult.required_variables ?? []).length > 0 && (
                <ResultSection
                  icon={Variable}
                  title="Required Variables"
                  badge={analysisResult.required_variables.length}
                >
                  <div className="space-y-1.5 pt-1">
                    {analysisResult.required_variables.map((v: any, i: number) => (
                      <div key={i} className="flex items-start gap-1.5">
                        <code className="text-[9px] text-violet-400 shrink-0">{v.name}</code>
                        <span className="text-[9px] opacity-60">({v.type})</span>
                        {v.required && (
                          <Badge variant="outline" className="text-[8px] py-0 px-1 text-red-400 border-red-500/20">
                            req
                          </Badge>
                        )}
                        <span className="text-[9px] truncate">{v.description}</span>
                      </div>
                    ))}
                  </div>
                </ResultSection>
              )}

              {/* Extraction Fields */}
              {(analysisResult.extraction_fields ?? []).length > 0 && (
                <ResultSection
                  icon={Database}
                  title="Extraction Fields"
                  badge={analysisResult.extraction_fields.length}
                >
                  <div className="space-y-1.5 pt-1">
                    {analysisResult.extraction_fields.map((f: any, i: number) => (
                      <div key={i} className="rounded bg-white/[0.03] px-2 py-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-medium text-foreground">
                            {f.display_name ?? f.field_name}
                          </span>
                          <Badge
                            variant="outline"
                            className={`text-[8px] py-0 px-1 ${
                              f.priority === "high"
                                ? "text-red-400 border-red-500/20"
                                : f.priority === "medium"
                                ? "text-yellow-400 border-yellow-500/20"
                                : "text-muted-foreground"
                            }`}
                          >
                            {f.priority}
                          </Badge>
                          <code className="text-[9px] text-muted-foreground">{f.type}</code>
                        </div>
                        {f.description && (
                          <p className="text-[9px] opacity-60 mt-0.5">{f.description}</p>
                        )}
                        {f.extract_after && (
                          <p className="text-[9px] opacity-50">After: {f.extract_after}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </ResultSection>
              )}

              {/* Outcome Schema */}
              {(analysisResult.outcome_schema ?? []).length > 0 && (
                <ResultSection
                  icon={Target}
                  title="Outcome Schema"
                  badge={analysisResult.outcome_schema.length}
                >
                  <div className="space-y-1.5 pt-1">
                    {analysisResult.outcome_schema.map((o: any, i: number) => {
                      const colorMap: Record<string, string> = {
                        green: "bg-green-500/10 text-green-400",
                        yellow: "bg-yellow-500/10 text-yellow-400",
                        red: "bg-red-500/10 text-red-400",
                        blue: "bg-blue-500/10 text-blue-400",
                      };
                      return (
                        <div key={i} className="flex items-start gap-1.5">
                          <span
                            className={`inline-flex shrink-0 items-center px-1.5 py-0.5 rounded text-[9px] ${colorMap[o.color] ?? colorMap.blue}`}
                          >
                            {o.label}
                          </span>
                          <span className="text-[9px] opacity-60">{o.description}</span>
                          {o.maps_to_status && (
                            <code className="text-[8px] text-muted-foreground ml-auto shrink-0">
                              → {o.maps_to_status}
                            </code>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </ResultSection>
              )}

              {/* CRM Field Mapping */}
              {analysisResult.crm_field_mapping && crmMode !== "none" && (
                <ResultSection icon={Database} title="CRM Field Mapping">
                  <div className="space-y-1.5 pt-1">
                    {analysisResult.crm_field_mapping.standard &&
                      Object.entries(analysisResult.crm_field_mapping.standard).map(([k, v]) => (
                        <div key={k} className="flex items-center gap-1.5 text-[9px]">
                          <code className="text-violet-400">{String(v)}</code>
                          <span className="opacity-40">→</span>
                          <span className="capitalize">{k}</span>
                        </div>
                      ))}
                    {(analysisResult.crm_field_mapping.custom ?? []).map((m: any, i: number) => (
                      <div key={i} className="flex items-center gap-1.5 text-[9px]">
                        <code className="text-violet-400">{m.webee_field}</code>
                        <span className="opacity-40">→</span>
                        <span>{m.crm_field}</span>
                        {m.transform && (
                          <code className="text-[8px] text-muted-foreground">({m.transform})</code>
                        )}
                      </div>
                    ))}
                  </div>
                </ResultSection>
              )}

              {/* Calendar Mapping */}
              {analysisResult.calendar_mapping?.trigger_outcome_ids?.length > 0 && (
                <ResultSection icon={Calendar} title="Calendar / Booking Mapping">
                  <div className="space-y-1 pt-1">
                    <div className="text-[9px]">
                      <span className="opacity-60">Trigger on: </span>
                      {analysisResult.calendar_mapping.trigger_outcome_ids.join(", ")}
                    </div>
                    {analysisResult.calendar_mapping.cal_event_type && (
                      <div className="text-[9px]">
                        <span className="opacity-60">Event type: </span>
                        {analysisResult.calendar_mapping.cal_event_type}
                      </div>
                    )}
                    {analysisResult.calendar_mapping.attendee_email_field && (
                      <div className="text-[9px]">
                        <span className="opacity-60">Email field: </span>
                        <code className="text-violet-400">
                          {analysisResult.calendar_mapping.attendee_email_field}
                        </code>
                      </div>
                    )}
                  </div>
                </ResultSection>
              )}

              {/* Webhook Payload */}
              {(crmMode === "webhook_only" || crmMode === "existing_crm") &&
                analysisResult.webhook_payload_schema?.payload && (
                  <ResultSection icon={Webhook} title="Webhook Payload Schema">
                    <div className="space-y-1 pt-1">
                      <div className="flex items-center gap-1.5 text-[9px] opacity-70">
                        <span>{analysisResult.webhook_payload_schema.method ?? "POST"}</span>
                        <code className="text-muted-foreground">
                          {analysisResult.webhook_payload_schema.url_placeholder}
                        </code>
                      </div>
                      {(analysisResult.webhook_payload_schema.payload?.fields ?? []).map(
                        (f: any, i: number) => (
                          <div key={i} className="flex items-center gap-1.5 text-[9px]">
                            <code className="text-blue-400">{f.key}</code>
                            <span className="opacity-40">←</span>
                            <code className="text-violet-400">{f.source_field}</code>
                            <span className="opacity-40">({f.type})</span>
                          </div>
                        ),
                      )}
                    </div>
                  </ResultSection>
                )}

              {/* Required Tools */}
              {(analysisResult.required_tools ?? []).length > 0 && (
                <ResultSection
                  icon={Wrench}
                  title="Required Tools"
                  badge={analysisResult.required_tools.length}
                >
                  <div className="space-y-1.5 pt-1">
                    {analysisResult.required_tools.map((t: any, i: number) => (
                      <div key={i} className="flex items-start gap-1.5">
                        <Badge
                          variant="outline"
                          className={`text-[8px] py-0 px-1 shrink-0 ${
                            t.available_in_builder
                              ? "text-green-400 border-green-500/20"
                              : "text-red-400 border-red-500/20"
                          }`}
                        >
                          {t.available_in_builder ? "✓" : "✗"}
                        </Badge>
                        <div>
                          <p className="text-[10px] font-medium text-foreground">{t.tool_name}</p>
                          <p className="text-[9px] opacity-60">{t.purpose}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </ResultSection>
              )}

              {/* Missing Capabilities */}
              {(analysisResult.missing_capabilities ?? []).length > 0 && (
                <ResultSection
                  icon={AlertTriangle}
                  title="Missing Capabilities"
                  badge={analysisResult.missing_capabilities.length}
                >
                  <div className="space-y-2 pt-1">
                    {analysisResult.missing_capabilities.map((c: any, i: number) => (
                      <div key={i} className="rounded bg-amber-500/[0.05] border border-amber-500/[0.12] px-2 py-1.5 space-y-1">
                        <p className="text-[10px] font-medium text-amber-400">{c.capability}</p>
                        <p className="text-[9px] opacity-70">{c.why_needed}</p>
                        {c.workaround && (
                          <p className="text-[9px] text-green-400 opacity-80">
                            Workaround: {c.workaround}
                          </p>
                        )}
                        {c.requires_admin_request && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleRequestAdmin(c)}
                            className="h-5 text-[8px] px-2 mt-1 border-amber-500/20 text-amber-400 hover:text-amber-300"
                          >
                            <ClipboardList className="h-2 w-2 mr-1" />
                            Request Admin Help
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </ResultSection>
              )}

              {/* Go Live Checklist */}
              {(analysisResult.go_live_checklist ?? []).length > 0 && (
                <ResultSection
                  icon={ListChecks}
                  title="Go-Live Checklist"
                  badge={analysisResult.go_live_checklist.length}
                >
                  <div className="space-y-1 pt-1">
                    {analysisResult.go_live_checklist.map((item: any, i: number) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <div
                          className={`h-3 w-3 rounded-sm border shrink-0 flex items-center justify-center ${
                            item.completed
                              ? "bg-green-500 border-green-500"
                              : "border-white/20"
                          }`}
                        />
                        <span className="text-[9px]">{item.item}</span>
                        {item.required && (
                          <span className="ml-auto text-[8px] text-red-400 shrink-0">req</span>
                        )}
                      </div>
                    ))}
                  </div>
                </ResultSection>
              )}

              {/* Deployment Config */}
              {analysisResult.deployment_config && (
                <ResultSection icon={Layers} title="Deployment Config">
                  <div className="space-y-1 pt-1">
                    {analysisResult.deployment_config.language && (
                      <div className="text-[9px] flex gap-1.5">
                        <span className="opacity-60">Language:</span>
                        <span>{analysisResult.deployment_config.language}</span>
                      </div>
                    )}
                    {analysisResult.deployment_config.estimated_call_duration_mins && (
                      <div className="text-[9px] flex gap-1.5">
                        <span className="opacity-60">Est. duration:</span>
                        <span>{analysisResult.deployment_config.estimated_call_duration_mins} min</span>
                      </div>
                    )}
                    {(analysisResult.deployment_config.key_behaviors ?? []).length > 0 && (
                      <ul className="mt-1 space-y-0.5 list-disc list-inside">
                        {analysisResult.deployment_config.key_behaviors.map((b: string, i: number) => (
                          <li key={i} className="text-[9px]">{b}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </ResultSection>
              )}

              {savedConfigId && (
                <p className="text-[9px] text-green-400 flex items-center gap-1">
                  <CheckCircle className="h-2.5 w-2.5" />
                  Config saved. Use Go Live when ready to deploy.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
