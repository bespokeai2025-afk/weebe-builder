import { useRef, useState } from "react";
import { useBuilderStore } from "@/lib/builder/store";
import { autoLayoutNodes } from "@/lib/builder/auto-layout";
import type { FlowNode } from "@/lib/builder/store";
import type { Edge } from "@xyflow/react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  FileUp,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  ScanSearch,
  User,
  Megaphone,
  ChevronLeft,
  Sparkles,
  GitBranch,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface ScannedAgent {
  name: string;
  role: string;
  persona: string;
  tone: string;
  keyPhrases: string[];
  expertise: string[];
}

interface ScannedCampaign {
  name: string;
  type: string;
  objective: string;
  keyStages: string[];
  branchingPoints: string[];
}

interface ScanResult {
  agents: ScannedAgent[];
  campaigns: ScannedCampaign[];
  globalPromptContent: string;
  rawText: string;
}

interface FlowResult {
  title: string;
  globalPromptSuggestion: string;
  suggestedAgentName: string;
  suggestedBeginMessage: string;
  voiceProvider: "RETELL" | "OPENAI_REALTIME";
  nodes: FlowNode[];
  edges: Edge[];
  nodeCount: number;
  segmentCount: number;
  globalPromptSegmentCount: number;
}

type Phase = "idle" | "scanning" | "select" | "generating" | "preview";

const CAMPAIGN_TYPE_COLORS: Record<string, string> = {
  outbound:      "bg-blue-500/15 text-blue-300 border-blue-500/20",
  inbound:       "bg-green-500/15 text-green-300 border-green-500/20",
  support:       "bg-orange-500/15 text-orange-300 border-orange-500/20",
  sales:         "bg-violet-500/15 text-violet-300 border-violet-500/20",
  "follow-up":   "bg-amber-500/15 text-amber-300 border-amber-500/20",
  booking:       "bg-cyan-500/15 text-cyan-300 border-cyan-500/20",
  qualification: "bg-rose-500/15 text-rose-300 border-rose-500/20",
};

const AGENT_AVATAR_COLORS = [
  "bg-violet-500/20 text-violet-300",
  "bg-blue-500/20 text-blue-300",
  "bg-emerald-500/20 text-emerald-300",
  "bg-rose-500/20 text-rose-300",
  "bg-amber-500/20 text-amber-300",
  "bg-cyan-500/20 text-cyan-300",
];

export function ImportPDFDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { loadFlow, setSettings, settings } = useBuilderStore();
  const fileRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase]               = useState<Phase>("idle");
  const [error, setError]               = useState<string | null>(null);
  const [fileName, setFileName]         = useState("");
  const [scanResult, setScanResult]     = useState<ScanResult | null>(null);
  const [selectedAgent, setSelectedAgent]       = useState<ScannedAgent | null>(null);
  const [selectedCampaign, setSelectedCampaign] = useState<ScannedCampaign | null>(null);
  const [flowResult, setFlowResult]         = useState<FlowResult | null>(null);
  const [applyGlobalPrompt, setApplyGlobalPrompt]   = useState(true);
  const [applyAgentName, setApplyAgentName]         = useState(true);
  const [applyBeginMessage, setApplyBeginMessage]   = useState(true);

  const reset = () => {
    setPhase("idle");
    setError(null);
    setFileName("");
    setScanResult(null);
    setSelectedAgent(null);
    setSelectedCampaign(null);
    setFlowResult(null);
    setApplyGlobalPrompt(true);
    setApplyAgentName(true);
    setApplyBeginMessage(true);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleClose = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  // ── Phase 1: scan PDF for entities ──────────────────────────────────────
  const handleFile = async (file: File) => {
    const isDocx = file.name.toLowerCase().endsWith(".docx");
    const isPdf = file.name.toLowerCase().endsWith(".pdf");
    if (!isDocx && !isPdf) {
      setError("Please select a PDF or Word document (.docx).");
      return;
    }
    setFileName(file.name);
    setError(null);
    setPhase("scanning");

    const form = new FormData();
    form.append("pdf", file);

    try {
      const res = await fetch("/api/builder/scan-pdf", { method: "POST", body: form });
      const data = (await res.json()) as ScanResult & { error?: string };

      if (!res.ok || data.error) {
        setError(data.error ?? "Scanning failed. Please try again.");
        setPhase("idle");
        return;
      }

      setScanResult(data);

      if (data.agents.length === 0 && data.campaigns.length === 0) {
        await generateFlow(data.rawText, null, null);
      } else {
        setPhase("select");
      }
    } catch {
      setError("Network error — please try again.");
      setPhase("idle");
    }
  };

  // ── Phase 2: generate targeted flow ─────────────────────────────────────
  const generateFlow = async (
    rawText: string,
    agent: ScannedAgent | null,
    campaign: ScannedCampaign | null,
  ) => {
    setPhase("generating");
    setError(null);

    try {
      const res = await fetch("/api/builder/import-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawText,
          voiceProvider: settings.voiceProvider ?? "RETELL",
          ...(agent ? { focusAgent: agent } : {}),
          ...(campaign ? { focusCampaign: campaign } : {}),
        }),
      });

      const data = (await res.json()) as FlowResult & { error?: string };

      if (!res.ok || data.error) {
        setError(data.error ?? "Flow generation failed. Please try again.");
        setPhase(scanResult ? "select" : "idle");
        return;
      }

      setFlowResult(data);
      setPhase("preview");
    } catch {
      setError("Network error — please try again.");
      setPhase(scanResult ? "select" : "idle");
    }
  };

  // ── Import into builder ──────────────────────────────────────────────────
  const handleImport = () => {
    if (!flowResult) return;

    const laidOutNodes = autoLayoutNodes(flowResult.nodes, flowResult.edges);
    loadFlow({ nodes: laidOutNodes, edges: flowResult.edges });

    const settingsUpdate: Record<string, string> = {};
    if (applyGlobalPrompt && flowResult.globalPromptSuggestion)
      settingsUpdate.globalPrompt = flowResult.globalPromptSuggestion;
    if (applyAgentName && flowResult.suggestedAgentName)
      settingsUpdate.agentName = flowResult.suggestedAgentName;
    if (applyBeginMessage && flowResult.suggestedBeginMessage)
      settingsUpdate.beginMessage = flowResult.suggestedBeginMessage;
    if (Object.keys(settingsUpdate).length > 0)
      setSettings(settingsUpdate as Parameters<typeof setSettings>[0]);

    const parts: string[] = [];
    if (selectedAgent) parts.push(selectedAgent.name);
    if (selectedCampaign) parts.push(selectedCampaign.name);
    const label = parts.length > 0 ? parts.join(" · ") : flowResult.title;

    const applied = [
      `${flowResult.nodeCount} nodes`,
      `${flowResult.edges.length} transitions`,
      applyGlobalPrompt && flowResult.globalPromptSuggestion ? "prompt" : "",
      applyAgentName && flowResult.suggestedAgentName ? "name" : "",
      applyBeginMessage && flowResult.suggestedBeginMessage ? "greeting" : "",
    ].filter(Boolean).join(" · ");

    toast.success(`"${label}" imported`, { description: applied });
    handleClose(false);
  };

  // count logic_split nodes for the preview badge
  const branchCount = flowResult?.nodes.filter(
    (n) => (n.data as { kind: string }).kind === "logic_split",
  ).length ?? 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className={cn(
          "transition-all duration-200",
          phase === "select" ? "max-w-2xl" : "max-w-lg",
        )}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {phase === "scanning" ? (
              <ScanSearch className="h-4 w-4 text-violet-400" />
            ) : (
              <FileUp className="h-4 w-4 text-violet-400" />
            )}
            {phase === "idle"       && "Import Script from PDF"}
            {phase === "scanning"   && "Scanning Document…"}
            {phase === "select"     && "Detected in Your Script"}
            {phase === "generating" && "Building Flow…"}
            {phase === "preview"    && "Flow Preview"}
          </DialogTitle>
        </DialogHeader>

        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
        />

        {/* ── idle ──────────────────────────────────────────────────────── */}
        {phase === "idle" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Upload a call script or brief PDF. The system performs a deep scan
              for agent personas, campaign pathways, and global prompt content —
              then lets you choose exactly which flow to generate.
            </p>
            {error && <ErrorBanner message={error} />}
            <Button className="w-full" onClick={() => fileRef.current?.click()}>
              <FileUp className="mr-2 h-4 w-4" /> Choose PDF or Word file
            </Button>
          </div>
        )}

        {/* ── scanning ──────────────────────────────────────────────────── */}
        {phase === "scanning" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <div className="relative">
              <div className="h-12 w-12 rounded-full border border-violet-500/20 bg-violet-500/10 flex items-center justify-center">
                <ScanSearch className="h-5 w-5 text-violet-400" />
              </div>
              <Loader2 className="absolute -top-1 -right-1 h-4 w-4 animate-spin text-violet-400" />
            </div>
            <div className="text-center space-y-1">
              <p className="text-sm font-medium">Deep-scanning for agents, campaigns & prompt…</p>
              <p className="text-xs text-muted-foreground">{fileName}</p>
            </div>
            <p className="text-xs text-muted-foreground text-center max-w-[280px]">
              Extracting agent personas, campaign pathways, branching logic, and
              global prompt content. Usually 8–12 seconds.
            </p>
          </div>
        )}

        {/* ── select ────────────────────────────────────────────────────── */}
        {phase === "select" && scanResult && (
          <div className="space-y-5 max-h-[70vh] overflow-y-auto pr-1">
            {error && <ErrorBanner message={error} />}

            {/* Global Prompt Preview */}
            {scanResult.globalPromptContent && (
              <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="h-3 w-3 text-violet-400" />
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-violet-300">
                    Global Prompt Content Detected
                  </span>
                </div>
                <p className="text-[10px] text-muted-foreground leading-relaxed line-clamp-3">
                  {scanResult.globalPromptContent}
                </p>
                <p className="text-[10px] text-violet-300/60">
                  Will be offered for import into the Global Prompt panel after flow generation.
                </p>
              </div>
            )}

            {/* Agent Personas */}
            {scanResult.agents.length > 0 && (
              <div className="space-y-2">
                <SectionHeader icon={<User className="h-3 w-3" />} label="Agent Personas" hint="select one to focus on" />
                <div className="grid grid-cols-2 gap-2">
                  {scanResult.agents.map((agent, idx) => {
                    const isSelected = selectedAgent?.name === agent.name;
                    const avatarColor = AGENT_AVATAR_COLORS[idx % AGENT_AVATAR_COLORS.length];
                    return (
                      <button
                        key={agent.name}
                        onClick={() => setSelectedAgent(isSelected ? null : agent)}
                        className={cn(
                          "text-left rounded-lg border p-3 transition-all space-y-2",
                          isSelected
                            ? "border-violet-500/50 bg-violet-500/10 ring-1 ring-violet-500/30"
                            : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04]",
                        )}
                      >
                        <div className="flex items-start gap-2.5">
                          <div className={cn("mt-0.5 h-7 w-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold", avatarColor)}>
                            {agent.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold leading-tight truncate">{agent.name}</p>
                            <p className="text-[10px] text-muted-foreground truncate">{agent.role}</p>
                          </div>
                          {isSelected && <CheckCircle2 className="h-3.5 w-3.5 text-violet-400 shrink-0 mt-0.5" />}
                        </div>
                        <p className="text-[10px] text-muted-foreground line-clamp-2 leading-relaxed">{agent.persona}</p>
                        {agent.tone && (
                          <p className="text-[10px] text-violet-300/70 italic">"{agent.tone}"</p>
                        )}
                        {agent.keyPhrases?.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {agent.keyPhrases.slice(0, 3).map((p) => (
                              <span key={p} className="rounded px-1.5 py-0.5 text-[9px] bg-white/[0.04] text-muted-foreground border border-white/[0.06] italic">
                                "{p}"
                              </span>
                            ))}
                          </div>
                        )}
                        {agent.expertise?.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {agent.expertise.slice(0, 3).map((tag) => (
                              <span key={tag} className="rounded px-1.5 py-0.5 text-[9px] bg-white/[0.05] text-muted-foreground border border-white/[0.06]">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Campaign Pathways */}
            {scanResult.campaigns.length > 0 && (
              <div className="space-y-2">
                <SectionHeader icon={<Megaphone className="h-3 w-3" />} label="Campaign Pathways" hint="select one to focus on" />
                <div className="grid grid-cols-2 gap-2">
                  {scanResult.campaigns.map((campaign) => {
                    const isSelected = selectedCampaign?.name === campaign.name;
                    const typeColor = CAMPAIGN_TYPE_COLORS[campaign.type.toLowerCase()] ?? "bg-white/[0.05] text-muted-foreground border-white/[0.08]";
                    return (
                      <button
                        key={campaign.name}
                        onClick={() => setSelectedCampaign(isSelected ? null : campaign)}
                        className={cn(
                          "text-left rounded-lg border p-3 transition-all space-y-2",
                          isSelected
                            ? "border-blue-500/50 bg-blue-500/10 ring-1 ring-blue-500/30"
                            : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04]",
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-xs font-semibold leading-tight">{campaign.name}</p>
                          <div className="flex items-center gap-1 shrink-0">
                            {isSelected && <CheckCircle2 className="h-3.5 w-3.5 text-blue-400" />}
                            <span className={cn("rounded px-1.5 py-0.5 text-[9px] font-medium border capitalize", typeColor)}>
                              {campaign.type}
                            </span>
                          </div>
                        </div>
                        <p className="text-[10px] text-muted-foreground line-clamp-2 leading-relaxed">{campaign.objective}</p>
                        {campaign.keyStages?.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {campaign.keyStages.slice(0, 5).map((stage, i) => (
                              <span key={stage} className="flex items-center gap-0.5 text-[9px] text-muted-foreground">
                                {i > 0 && <ArrowRight className="h-2 w-2 text-muted-foreground/30" />}
                                <span className="rounded px-1 py-0 bg-white/[0.05] border border-white/[0.06]">{stage}</span>
                              </span>
                            ))}
                            {campaign.keyStages.length > 5 && (
                              <span className="text-[9px] text-muted-foreground/50">+{campaign.keyStages.length - 5} more</span>
                            )}
                          </div>
                        )}
                        {campaign.branchingPoints?.length > 0 && (
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1">
                              <GitBranch className="h-2.5 w-2.5 text-amber-400/70" />
                              <span className="text-[9px] text-amber-400/70 font-medium">{campaign.branchingPoints.length} branching {campaign.branchingPoints.length === 1 ? "point" : "points"}</span>
                            </div>
                            {campaign.branchingPoints.slice(0, 2).map((bp) => (
                              <p key={bp} className="text-[9px] text-muted-foreground/60 leading-relaxed line-clamp-1">• {bp}</p>
                            ))}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <p className="text-[11px] text-muted-foreground pb-1">
              {selectedAgent || selectedCampaign
                ? "Flow will be tailored to your selection. All nodes and transitions will be generated."
                : "Nothing selected — the full script will be converted with all nodes and transitions."}
            </p>
          </div>
        )}

        {/* ── generating ────────────────────────────────────────────────── */}
        {phase === "generating" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <div className="relative">
              <div className="h-12 w-12 rounded-full border border-violet-500/20 bg-violet-500/10 flex items-center justify-center">
                <FileUp className="h-5 w-5 text-violet-400" />
              </div>
              <Loader2 className="absolute -top-1 -right-1 h-4 w-4 animate-spin text-violet-400" />
            </div>
            <div className="text-center space-y-2">
              <p className="text-sm font-medium">Building complete conversation flow…</p>
              {(selectedAgent || selectedCampaign) && (
                <div className="flex items-center justify-center gap-1.5 flex-wrap">
                  {selectedAgent && (
                    <span className="text-[10px] rounded px-2 py-0.5 bg-violet-500/10 text-violet-300 border border-violet-500/20">
                      {selectedAgent.name}
                    </span>
                  )}
                  {selectedCampaign && (
                    <span className="text-[10px] rounded px-2 py-0.5 bg-blue-500/10 text-blue-300 border border-blue-500/20">
                      {selectedCampaign.name}
                    </span>
                  )}
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground text-center max-w-[280px]">
              Generating all nodes, branching logic, transitions, and global
              prompt content. Usually 10–20 seconds.
            </p>
          </div>
        )}

        {/* ── preview ───────────────────────────────────────────────────── */}
        {phase === "preview" && flowResult && (
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            {/* Summary header */}
            <div className="flex items-center gap-2 rounded-md border border-green-500/20 bg-green-500/5 px-3 py-2">
              <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-green-300 truncate">{flowResult.title}</p>
                <p className="text-[11px] text-muted-foreground">
                  {flowResult.nodeCount} nodes · {flowResult.edges.length} transitions
                  {branchCount > 0 && ` · ${branchCount} branch${branchCount > 1 ? "es" : ""}`}
                  {flowResult.globalPromptSegmentCount > 0 && (
                    <span className="text-violet-400/80"> · {flowResult.globalPromptSegmentCount} → prompt</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0 flex-wrap justify-end">
                <span className={cn(
                  "text-[9px] rounded px-1.5 py-0.5 border font-medium",
                  flowResult.voiceProvider === "RETELL"
                    ? "bg-orange-500/15 text-orange-300 border-orange-500/20"
                    : "bg-cyan-500/15 text-cyan-300 border-cyan-500/20",
                )}>
                  {flowResult.voiceProvider === "RETELL" ? "Retell format" : "OmniVoice format"}
                </span>
                {selectedAgent && (
                  <span className="text-[9px] rounded px-1.5 py-0.5 bg-violet-500/15 text-violet-300 border border-violet-500/20">
                    {selectedAgent.name}
                  </span>
                )}
                {selectedCampaign && (
                  <span className="text-[9px] rounded px-1.5 py-0.5 bg-blue-500/15 text-blue-300 border border-blue-500/20">
                    {selectedCampaign.name}
                  </span>
                )}
              </div>
            </div>

            {/* Node list */}
            <div className="rounded-md border border-white/[0.06] bg-white/[0.02] max-h-48 overflow-y-auto divide-y divide-white/[0.04]">
              {flowResult.nodes.map((node, idx) => {
                const data = node.data as { kind: string; label: string; dialogue: string; isStart?: boolean; transitions?: Array<{ condition: string }> };
                const txCount = data.transitions?.length ?? 0;
                const isBranch = data.kind === "logic_split";
                return (
                  <div key={node.id} className="flex items-start gap-2.5 px-3 py-2">
                    <span className="mt-0.5 text-[10px] text-muted-foreground/50 w-5 shrink-0 text-right">
                      {idx + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[11px] font-medium truncate">{data.label}</span>
                        {data.isStart && <Badge color="violet" label="start" />}
                        {data.kind === "ending" && <Badge color="red" label="end" />}
                        {isBranch && <Badge color="amber" label={`branch ×${txCount}`} />}
                      </div>
                      <p className="text-[10px] text-muted-foreground line-clamp-2 mt-0.5">{data.dialogue}</p>
                      {isBranch && data.transitions && data.transitions.length > 0 && (
                        <div className="mt-1 space-y-0.5">
                          {data.transitions.map((t, ti) => (
                            <p key={ti} className="text-[9px] text-amber-300/60">
                              → {t.condition}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                    {idx < flowResult.nodes.length - 1 && !isBranch && (
                      <ArrowRight className="mt-1 h-3 w-3 shrink-0 text-muted-foreground/30" />
                    )}
                  </div>
                );
              })}
            </div>

            {/* Agent name + Begin message */}
            {(flowResult.suggestedAgentName || flowResult.suggestedBeginMessage) && (
              <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3 space-y-2.5">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Agent Settings
                </p>
                {flowResult.suggestedAgentName && (
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] text-muted-foreground/60 mb-0.5">Agent Name</p>
                      <p className="text-xs font-medium truncate">{flowResult.suggestedAgentName}</p>
                    </div>
                    <label className="flex items-center gap-1.5 cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        checked={applyAgentName}
                        onChange={(e) => setApplyAgentName(e.target.checked)}
                        className="h-3 w-3 rounded accent-violet-500"
                      />
                      <span className="text-[10px] text-muted-foreground">Apply</span>
                    </label>
                  </div>
                )}
                {flowResult.suggestedBeginMessage && (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] text-muted-foreground/60 mb-0.5">Begin Message</p>
                      <p className="text-[11px] text-muted-foreground line-clamp-2 italic">
                        "{flowResult.suggestedBeginMessage}"
                      </p>
                    </div>
                    <label className="flex items-center gap-1.5 cursor-pointer shrink-0 mt-0.5">
                      <input
                        type="checkbox"
                        checked={applyBeginMessage}
                        onChange={(e) => setApplyBeginMessage(e.target.checked)}
                        className="h-3 w-3 rounded accent-violet-500"
                      />
                      <span className="text-[10px] text-muted-foreground">Apply</span>
                    </label>
                  </div>
                )}
              </div>
            )}

            {/* Global Prompt section */}
            {flowResult.globalPromptSuggestion && (
              <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="h-3 w-3 text-violet-400" />
                    <span className="text-[11px] font-semibold text-violet-300">
                      Global Prompt
                      <span className="ml-1.5 font-normal text-[9px] text-violet-300/60">
                        {flowResult.voiceProvider === "RETELL" ? "· Retell general_prompt style" : "· OmniVoice overall-instructions style"}
                      </span>
                    </span>
                  </div>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={applyGlobalPrompt}
                      onChange={(e) => setApplyGlobalPrompt(e.target.checked)}
                      className="h-3 w-3 rounded accent-violet-500"
                    />
                    <span className="text-[10px] text-muted-foreground">Apply to panel</span>
                  </label>
                </div>
                <p className="text-[10px] text-muted-foreground leading-relaxed line-clamp-4">
                  {flowResult.globalPromptSuggestion}
                </p>
              </div>
            )}

            <p className="text-[11px] text-muted-foreground">
              This will <strong>replace</strong> your current flow. Use the undo button or
              re-import a JSON to restore.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 flex-wrap">
          <Button variant="outline" onClick={() => handleClose(false)}>
            Cancel
          </Button>

          {phase === "select" && (
            <>
              <Button variant="ghost" onClick={reset} className="text-muted-foreground">
                <ChevronLeft className="mr-1 h-3.5 w-3.5" /> Re-upload
              </Button>
              <Button
                onClick={() => generateFlow(scanResult!.rawText, selectedAgent, selectedCampaign)}
              >
                Generate Flow{selectedAgent || selectedCampaign ? " →" : " (full script)"}
              </Button>
            </>
          )}

          {phase === "preview" && (
            <>
              {scanResult && (scanResult.agents.length > 0 || scanResult.campaigns.length > 0) && (
                <Button
                  variant="ghost"
                  onClick={() => { setFlowResult(null); setPhase("select"); }}
                  className="text-muted-foreground"
                >
                  <ChevronLeft className="mr-1 h-3.5 w-3.5" /> Re-select
                </Button>
              )}
              <Button onClick={handleImport}>Import into Builder</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── small helpers ────────────────────────────────────────────────────────────

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      {message}
    </div>
  );
}

function SectionHeader({
  icon,
  label,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-[10px] text-muted-foreground/50">· {hint}</span>
    </div>
  );
}

function Badge({
  color,
  label,
}: {
  color: "violet" | "red" | "amber";
  label: string;
}) {
  const cls = {
    violet: "bg-violet-500/20 text-violet-300",
    red:    "bg-red-500/20 text-red-300",
    amber:  "bg-amber-500/20 text-amber-300",
  }[color];
  return (
    <span className={cn("shrink-0 rounded px-1 py-0 text-[9px] uppercase tracking-wide", cls)}>
      {label}
    </span>
  );
}
