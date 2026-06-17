import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Wand2, Loader2, ChevronRight, AlertTriangle, CheckCircle2,
  XCircle, Wrench, Layers, Variable, ArrowRight, Info,
  Send, Eye, GitBranch, Cpu,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SystemMindShell } from "./SystemMindShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  generateWorkflowDraft,
  proposeSendDraftToBuilder,
  updateGeneratorDraftStatus,
} from "@/lib/systemmind/systemmind-workflow-generator.functions";
import type { WorkflowDraftFull, MissingCapability, ValidationResult } from "@/lib/systemmind/systemmind-workflow-generator.server";

const WORKFLOW_TYPES = [
  { value: "receptionist",         label: "Receptionist"          },
  { value: "lead_qualification",   label: "Lead Qualification"    },
  { value: "rebooking",            label: "Rebooking"             },
  { value: "appointment_booking",  label: "Appointment Booking"   },
  { value: "callback_scheduling",  label: "Callback Scheduling"   },
  { value: "document_collection",  label: "Document Collection"   },
  { value: "call_transfer",        label: "Call Transfer"         },
  { value: "whatsapp_followup",    label: "WhatsApp Follow-up"    },
  { value: "crm_update",           label: "CRM Update"            },
  { value: "post_call_summary",    label: "Post-Call Summary"     },
  { value: "client_intake",        label: "Client Intake"         },
  { value: "complaint_handling",   label: "Complaint Handling"    },
  { value: "sales_enquiry",        label: "Sales Enquiry"         },
  { value: "custom_workflow",      label: "Custom Workflow"       },
];

const EXAMPLE_PROMPTS: Record<string, string> = {
  rebooking:
    "If the caller wants a callback, collect preferred date and time, check calendar availability, confirm the slot, update CRM, and schedule the callback.",
  appointment_booking:
    "Greet the caller, collect their name and contact details, ask for their preferred appointment date and time, check availability, confirm the booking, and send a confirmation SMS.",
  lead_qualification:
    "Ask the caller about their business needs, budget range, timeline, and decision-making authority. Score the lead and route hot leads to sales, warm leads to nurture campaign.",
  receptionist:
    "Welcome callers to the company. Identify their need (sales, support, billing, or general enquiry). Route to the correct department or take a message if unavailable.",
  complaint_handling:
    "Listen to the caller's complaint, gather details, apologise empathetically, escalate urgent issues to a human agent, and log the complaint in the CRM.",
};

function RiskBadge({ risk }: { risk: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "text-[10px] font-semibold",
        risk === "high"   && "border-red-500/40   text-red-400",
        risk === "medium" && "border-amber-500/40 text-amber-400",
        risk === "low"    && "border-green-500/40 text-green-400",
      )}
    >
      {risk}
    </Badge>
  );
}

function ValidationRow({ result }: { result: ValidationResult }) {
  return (
    <div className="flex items-start gap-2.5 py-2 border-b border-white/[0.04] last:border-0">
      {result.passed ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0 mt-0.5" />
      ) : (
        <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
      )}
      <div className="min-w-0">
        <p className="text-xs font-medium">{result.check}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">{result.message}</p>
      </div>
    </div>
  );
}

function MissingCapabilityCard({ cap }: { cap: MissingCapability }) {
  return (
    <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-3 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-amber-300">{cap.name}</p>
        <div className="flex items-center gap-1.5">
          <RiskBadge risk={cap.risk} />
          {cap.approval_required && (
            <Badge variant="outline" className="text-[10px] border-sky-500/40 text-sky-400">
              Approval required
            </Badge>
          )}
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">{cap.description}</p>
      <div className="flex items-start gap-1.5">
        <Wrench className="h-3 w-3 text-sky-400 shrink-0 mt-0.5" />
        <p className="text-[11px] text-sky-300/80">{cap.suggested_fix}</p>
      </div>
    </div>
  );
}

export function WorkflowGeneratorPage() {
  const navigate    = useNavigate();
  const qc          = useQueryClient();
  const genFn        = useServerFn(generateWorkflowDraft);
  const proposeFn    = useServerFn(proposeSendDraftToBuilder);
  const updateFn     = useServerFn(updateGeneratorDraftStatus);

  const [title, setTitle]               = useState("");
  const [workflowType, setWorkflowType] = useState("rebooking");
  const [description, setDescription]   = useState("");
  const [draft, setDraft]               = useState<WorkflowDraftFull | null>(null);
  const [activeSection, setActiveSection] = useState<"nodes" | "variables" | "tools" | "validation" | "missing">("nodes");

  const generate = useMutation({
    mutationFn: async () => {
      if (!title.trim())       throw new Error("Please enter a workflow title.");
      if (!description.trim()) throw new Error("Please describe the workflow.");
      return genFn({ data: { title: title.trim(), description: description.trim(), workflowType } });
    },
    onSuccess: (d) => {
      setDraft(d as WorkflowDraftFull);
      qc.invalidateQueries({ queryKey: ["generator-drafts"] });
      toast.success("Workflow draft generated!");
    },
    onError: (e: any) => toast.error(e.message ?? "Generation failed"),
  });

  const propose = useMutation({
    mutationFn: async () => {
      if (!draft) return;
      await updateFn({ data: { draftId: draft.id, status: "needs_review" } });
      return proposeFn({
        data: {
          draftId:                  draft.id,
          draftTitle:               draft.title,
          nodeCount:                draft.nodes.length,
          variableCount:            draft.variables.length,
          toolCount:                draft.tools.length,
          missingCapabilitiesCount: draft.missing_capabilities_json.length,
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["generator-drafts"] });
      toast.success("Sent to HiveMind for approval.");
      navigate({ to: "/hivemind/actions" });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to propose action"),
  });

  const handleUseExample = () => {
    const ex = EXAMPLE_PROMPTS[workflowType] ?? EXAMPLE_PROMPTS.rebooking;
    setDescription(ex);
    if (!title) {
      const wt = WORKFLOW_TYPES.find((w) => w.value === workflowType);
      setTitle(wt ? `${wt.label} Workflow` : "New Workflow");
    }
  };

  const validationPassed = draft
    ? draft.validation_results_json.filter((v) => !v.passed).length === 0
    : false;
  const missingCount = draft?.missing_capabilities_json.length ?? 0;

  return (
    <SystemMindShell>
      <div className="p-6 max-w-5xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Wand2 className="h-4 w-4 text-sky-400" />
              <h1 className="text-lg font-semibold">Workflow Generator</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Describe a workflow in plain English. SystemMind generates a Builder-ready draft.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={() => navigate({ to: "/systemmind/workflow-drafts" })}
          >
            <Eye className="mr-1.5 h-3.5 w-3.5" />
            View All Drafts
          </Button>
        </div>

        {/* Approval notice */}
        <div className="flex items-start gap-2.5 rounded-lg border border-sky-500/20 bg-sky-500/[0.04] px-3.5 py-2.5">
          <Info className="h-3.5 w-3.5 text-sky-400 shrink-0 mt-0.5" />
          <p className="text-xs text-sky-300/80">
            SystemMind may only <strong>create drafts</strong>. Sending to Builder and deploying agents
            require <strong>HiveMind approval</strong>. No live agent will be modified automatically.
          </p>
        </div>

        {/* Form */}
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Workflow Title</label>
              <Input
                placeholder="e.g. Rebooking Workflow"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Workflow Type</label>
              <Select value={workflowType} onValueChange={setWorkflowType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WORKFLOW_TYPES.map((wt) => (
                    <SelectItem key={wt.value} value={wt.value}>{wt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">Describe the Workflow</label>
              <button
                type="button"
                onClick={handleUseExample}
                className="text-[11px] text-sky-400 hover:text-sky-300 transition-colors"
              >
                Use example
              </button>
            </div>
            <Textarea
              placeholder="Describe step by step what the agent should do. Include intents, data to collect, tools to call, and how to handle success / failure..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
            />
          </div>
          <Button
            onClick={() => generate.mutate()}
            disabled={generate.isPending || !title.trim() || !description.trim()}
            className="bg-sky-600 hover:bg-sky-500 text-white"
          >
            {generate.isPending ? (
              <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />Generating…</>
            ) : (
              <><Wand2 className="mr-2 h-3.5 w-3.5" />Generate Workflow Draft</>
            )}
          </Button>
        </div>

        {/* Draft result */}
        {draft && (
          <div className="space-y-4">
            {/* Summary bar */}
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <h2 className="font-semibold text-sm">{draft.title}</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">{draft.description}</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="text-[10px]">
                    <GitBranch className="mr-1 h-2.5 w-2.5" />{draft.nodes.length} nodes
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    <Variable className="mr-1 h-2.5 w-2.5" />{draft.variables.length} variables
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    <Cpu className="mr-1 h-2.5 w-2.5" />{draft.tools.length} tools
                  </Badge>
                  {missingCount > 0 ? (
                    <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-400">
                      <AlertTriangle className="mr-1 h-2.5 w-2.5" />{missingCount} gaps
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px] border-green-500/40 text-green-400">
                      <CheckCircle2 className="mr-1 h-2.5 w-2.5" />Ready
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            {/* Section tabs */}
            <div className="flex gap-1 overflow-x-auto">
              {(["nodes","variables","tools","validation","missing"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setActiveSection(s)}
                  className={cn(
                    "px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors",
                    activeSection === s
                      ? "bg-sky-500/15 text-sky-300"
                      : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
                  )}
                >
                  {s === "nodes"      && `Nodes (${draft.nodes.length})`}
                  {s === "variables"  && `Variables (${draft.variables.length})`}
                  {s === "tools"      && `Tools (${draft.tools.length})`}
                  {s === "validation" && `Validation (${draft.validation_results_json.filter(v=>!v.passed).length} issues)`}
                  {s === "missing"    && `Gaps (${missingCount})`}
                </button>
              ))}
            </div>

            {/* Nodes */}
            {activeSection === "nodes" && (
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-1.5">
                {draft.nodes.map((node, idx) => (
                  <div key={node.id} className="flex items-start gap-3 py-2 border-b border-white/[0.04] last:border-0">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-sky-500/10 text-[10px] font-bold text-sky-400">
                      {idx + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-medium">{node.data?.label ?? node.id}</p>
                        <Badge variant="outline" className="text-[9px] font-mono">{node.data?.kind ?? node.type}</Badge>
                        {node.data?.isStart && (
                          <Badge variant="outline" className="text-[9px] border-green-500/40 text-green-400">start</Badge>
                        )}
                      </div>
                      {node.data?.dialogue && (
                        <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{node.data.dialogue}</p>
                      )}
                      {node.data?.transitions?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {node.data.transitions.map((t: any) => (
                            <span key={t.id} className="inline-flex items-center gap-1 rounded bg-white/[0.04] px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              <ArrowRight className="h-2.5 w-2.5" />{t.condition || "→"}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Variables */}
            {activeSection === "variables" && (
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-2">
                {draft.variables.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No variables defined.</p>
                ) : draft.variables.map((v: any, i: number) => (
                  <div key={i} className="flex items-start gap-3 py-2 border-b border-white/[0.04] last:border-0">
                    <code className="text-[11px] bg-white/[0.04] rounded px-1.5 py-0.5 text-sky-300 font-mono shrink-0">
                      {v.name}
                    </code>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] text-muted-foreground">{v.description}</p>
                      <div className="flex gap-1.5 mt-1">
                        <Badge variant="outline" className="text-[9px]">{v.type}</Badge>
                        {v.required && <Badge variant="outline" className="text-[9px] border-amber-500/40 text-amber-400">required</Badge>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Tools */}
            {activeSection === "tools" && (
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-2">
                {draft.tools.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No tools defined.</p>
                ) : draft.tools.map((t: any, i: number) => (
                  <div key={i} className="py-2 border-b border-white/[0.04] last:border-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <code className="text-[11px] bg-white/[0.04] rounded px-1.5 py-0.5 text-sky-300 font-mono">
                        {t.name}
                      </code>
                      {t.exists ? (
                        <Badge variant="outline" className="text-[9px] border-green-500/40 text-green-400">available</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[9px] border-amber-500/40 text-amber-400">needs creation</Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">{t.description}</p>
                    {t.parameters?.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {t.parameters.map((p: any, pi: number) => (
                          <span key={pi} className="text-[10px] bg-white/[0.04] rounded px-1.5 py-0.5 text-muted-foreground font-mono">
                            {p.name}: {p.type}{p.required ? "" : "?"}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Validation */}
            {activeSection === "validation" && (
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
                {draft.validation_results_json.map((r, i) => (
                  <ValidationRow key={i} result={r} />
                ))}
              </div>
            )}

            {/* Missing capabilities */}
            {activeSection === "missing" && (
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4 space-y-3">
                {missingCount === 0 ? (
                  <div className="flex items-center gap-2 text-green-400">
                    <CheckCircle2 className="h-4 w-4" />
                    <p className="text-sm">No capability gaps detected.</p>
                  </div>
                ) : draft.missing_capabilities_json.map((cap, i) => (
                  <MissingCapabilityCard key={i} cap={cap} />
                ))}
              </div>
            )}

            {/* Required integrations */}
            {draft.required_integrations_json.length > 0 && (
              <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-4 py-3">
                <p className="text-xs font-medium mb-2 text-muted-foreground uppercase tracking-wide">Required Integrations</p>
                <div className="flex flex-wrap gap-1.5">
                  {draft.required_integrations_json.map((ri, i) => (
                    <Badge key={i} variant="outline" className="text-[10px]">{ri}</Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-3 flex-wrap">
              <Button
                onClick={() => propose.mutate()}
                disabled={propose.isPending}
                className="bg-sky-600 hover:bg-sky-500 text-white"
              >
                {propose.isPending ? (
                  <><Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />Sending…</>
                ) : (
                  <><Send className="mr-2 h-3.5 w-3.5" />Send to HiveMind for Approval</>
                )}
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate({ to: "/systemmind/workflow-drafts" })}
              >
                <Eye className="mr-2 h-3.5 w-3.5" />View All Drafts
              </Button>
              <Button variant="ghost" onClick={() => setDraft(null)}>
                Generate New
              </Button>
            </div>

            {missingCount > 0 && (
              <p className="text-xs text-amber-400/80 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                {missingCount} capability gap(s) require approval before this draft can be deployed.
              </p>
            )}
          </div>
        )}
      </div>
    </SystemMindShell>
  );
}
