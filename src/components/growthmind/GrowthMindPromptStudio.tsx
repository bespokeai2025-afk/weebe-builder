import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Sparkles, Plus, Save, Trash2, Copy, Play, Clock, BarChart2,
  Star, StarOff, ChevronRight, Search, X, FlaskConical, Tag, Wand2,
  RotateCcw, CheckCircle2, AlertCircle, Loader2, Info, Eye,
  Columns2, Trophy, GitCompare, Link2, GripVertical, ChevronDown, ChevronUp,
  ListOrdered, Zap, ArrowRight, Workflow,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GrowthMindShell } from "./GrowthMindShell";
import {
  getPromptTemplates, savePromptTemplate, deletePromptTemplate,
  testPromptTemplate, seedLibraryPacks, restorePromptVersion, togglePromptFavorite, getPromptTemplate,
  getWorkspaceContext, setPromptWinner, runPromptChain,
  type PromptTemplate, type PromptVariable, type PromptVersion, type PromptChainStep, type ChainStepMapping,
} from "@/lib/growthmind/growthmind.prompt-studio";

// ── Constants ──────────────────────────────────────────────────────────────────

const PROMPT_TYPES: { value: string; label: string }[] = [
  { value: "content",               label: "Content"            },
  { value: "video",                 label: "Video"              },
  { value: "campaign",              label: "Campaign"           },
  { value: "seo",                   label: "SEO"                },
  { value: "meta_ads",              label: "Meta Ads"           },
  { value: "google_ads",            label: "Google Ads"         },
  { value: "whatsapp",              label: "WhatsApp"           },
  { value: "email",                 label: "Email"              },
  { value: "sales",                 label: "Sales"              },
  { value: "ai_calling",            label: "AI Calling"         },
  { value: "landing_pages",         label: "Landing Pages"      },
  { value: "funnels",               label: "Funnels"            },
  { value: "agent_scripts",         label: "Agent Scripts"      },
  { value: "knowledge_extraction",  label: "Knowledge"          },
];

const TYPE_COLORS: Record<string, string> = {
  content:              "bg-blue-500/15 text-blue-300",
  video:                "bg-purple-500/15 text-purple-300",
  campaign:             "bg-orange-500/15 text-orange-300",
  seo:                  "bg-green-500/15 text-green-300",
  meta_ads:             "bg-blue-600/15 text-blue-400",
  google_ads:           "bg-red-500/15 text-red-300",
  whatsapp:             "bg-emerald-500/15 text-emerald-300",
  email:                "bg-yellow-500/15 text-yellow-300",
  sales:                "bg-rose-500/15 text-rose-300",
  ai_calling:           "bg-cyan-500/15 text-cyan-300",
  landing_pages:        "bg-indigo-500/15 text-indigo-300",
  funnels:              "bg-violet-500/15 text-violet-300",
  agent_scripts:        "bg-amber-500/15 text-amber-300",
  knowledge_extraction: "bg-teal-500/15 text-teal-300",
};

const SCORE_LABELS: Record<string, string> = {
  quality:              "Quality",
  completeness:         "Completeness",
  audience_fit:         "Audience Fit",
  brand_fit:            "Brand Fit",
  conversion_potential: "Conversion",
};

const DEFAULT_EDIT: Omit<PromptTemplate, "id" | "workspaceId" | "createdAt" | "updatedAt" | "stats"> = {
  name:               "Untitled Template",
  description:        "",
  type:               "content",
  category:           "custom",
  systemPrompt:       "",
  userPromptTemplate: "",
  variables:          [],
  chainSteps:         [],
  tags:               [],
  isActive:           true,
  isFavorite:         false,
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function extractVariables(text: string): string[] {
  const matches = text.match(/\{\{(\w+)\}\}/g) ?? [];
  const names   = matches.map(m => m.slice(2, -2));
  return [...new Set(names)];
}

function scoreColor(score: number): string {
  if (score >= 8) return "text-emerald-400";
  if (score >= 6) return "text-yellow-400";
  return "text-red-400";
}

function scoreBg(score: number): string {
  if (score >= 8) return "bg-emerald-500";
  if (score >= 6) return "bg-yellow-500";
  return "bg-red-500";
}

function StarRating({ score }: { score: number | null | undefined }) {
  if (score == null) return <span className="text-xs text-muted-foreground/50">—</span>;
  const stars = Math.round((score / 10) * 5);
  return (
    <span className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <span key={i} className={cn("text-[10px]", i < stars ? "text-yellow-400" : "text-white/15")}>★</span>
      ))}
      <span className="ml-1 text-[10px] text-muted-foreground">{score.toFixed(1)}</span>
    </span>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: string }) {
  const label = PROMPT_TYPES.find(t => t.value === type)?.label ?? type;
  return (
    <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-none", TYPE_COLORS[type] ?? "bg-white/10 text-muted-foreground")}>
      {label}
    </span>
  );
}

function TemplateCard({
  template, isSelected, onSelect, onFavorite, onRun,
}: {
  template: PromptTemplate;
  isSelected: boolean;
  onSelect: () => void;
  onFavorite: (val: boolean) => void;
  onRun?: () => void;
}) {
  const isWorkflow = template.category === "workflow";
  const hasSteps   = template.chainSteps.length > 0;

  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full text-left rounded-lg p-2.5 border transition-all group",
        isSelected
          ? "border-emerald-500/30 bg-emerald-500/[0.08]"
          : "border-white/[0.04] hover:border-white/[0.1] hover:bg-white/[0.03]",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className={cn("text-xs font-medium leading-tight truncate", isSelected ? "text-emerald-300" : "text-foreground")}>
            {template.name}
          </p>
          <div className="flex items-center gap-1.5 mt-1">
            <TypeBadge type={template.type} />
            {template.category === "library" && (
              <span className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-none bg-emerald-500/15 text-emerald-400">
                Library
              </span>
            )}
            {isWorkflow && (
              <span className="rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-none bg-violet-500/15 text-violet-300">
                {hasSteps ? `${template.chainSteps.length} steps` : "Workflow"}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0 mt-0.5">
          {isWorkflow && hasSteps && onRun && (
            <button
              onClick={e => { e.stopPropagation(); onRun(); }}
              title="Run workflow"
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-violet-500/15 text-muted-foreground hover:text-violet-300"
            >
              <Play className="h-3 w-3" />
            </button>
          )}
          <button
            onClick={e => { e.stopPropagation(); onFavorite(!template.isFavorite); }}
            className={cn("opacity-0 group-hover:opacity-100 transition-opacity", template.isFavorite && "opacity-100")}
          >
            {template.isFavorite
              ? <Star className="h-3 w-3 text-yellow-400 fill-yellow-400" />
              : <StarOff className="h-3 w-3 text-muted-foreground" />
            }
          </button>
        </div>
      </div>

      {template.stats && (
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <StarRating score={template.stats.avgScore} />
          {template.stats.usageCount > 0 && (
            <span className="text-[10px] text-muted-foreground/60">{template.stats.usageCount} run{template.stats.usageCount !== 1 ? "s" : ""}</span>
          )}
          {template.stats.successRate != null && template.stats.usageCount > 0 && (
            <span className="text-[10px] text-emerald-400/70">{template.stats.successRate.toFixed(0)}% success</span>
          )}
        </div>
      )}
    </button>
  );
}

function VariableEditor({
  variables,
  onChange,
  readOnly,
}: {
  variables: PromptVariable[];
  onChange: (v: PromptVariable[]) => void;
  readOnly: boolean;
}) {
  return (
    <div className="space-y-2">
      {variables.map((v, i) => (
        <div key={i} className="flex items-start gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] p-2">
          <div className="flex-1 grid grid-cols-2 gap-2">
            <div>
              <p className="text-[10px] text-muted-foreground mb-0.5">Variable</p>
              <code className="text-xs text-emerald-300 font-mono">{`{{${v.name}}}`}</code>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground mb-0.5">Default</p>
              {readOnly
                ? <p className="text-xs text-foreground truncate">{v.defaultValue || "—"}</p>
                : (
                  <input
                    className="w-full bg-transparent border border-white/[0.08] rounded px-1.5 py-0.5 text-xs text-foreground outline-none focus:border-emerald-500/40"
                    value={v.defaultValue}
                    onChange={e => {
                      const next = [...variables];
                      next[i] = { ...v, defaultValue: e.target.value };
                      onChange(next);
                    }}
                    placeholder="default value"
                  />
                )
              }
            </div>
            <div className="col-span-2">
              <p className="text-[10px] text-muted-foreground mb-0.5">Description</p>
              {readOnly
                ? <p className="text-xs text-muted-foreground">{v.description || "—"}</p>
                : (
                  <input
                    className="w-full bg-transparent border border-white/[0.08] rounded px-1.5 py-0.5 text-xs text-foreground outline-none focus:border-emerald-500/40"
                    value={v.description}
                    onChange={e => {
                      const next = [...variables];
                      next[i] = { ...v, description: e.target.value };
                      onChange(next);
                    }}
                    placeholder="describe this variable"
                  />
                )
              }
            </div>
          </div>
          {!readOnly && (
            <button
              onClick={() => onChange(variables.filter((_, j) => j !== i))}
              className="mt-0.5 p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}
      {!readOnly && (
        <button
          onClick={() => onChange([...variables, { name: "new_variable", description: "", defaultValue: "" }])}
          className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
        >
          <Plus className="h-3 w-3" /> Add variable
        </button>
      )}
    </div>
  );
}

// Stable empty workspace context — avoids infinite render loop when query hasn't resolved yet
const EMPTY_WS_CTX: Record<string, string> = {};

// ── HighlightedTextarea ─────────────────────────────────────────────────────────
// Renders {{variable}} tokens with emerald highlight spans using a backdrop overlay.
// The textarea sits on top with transparent text / white caret so the highlight shows through.

function HighlightedTextarea({
  value,
  onChange,
  disabled,
  rows = 8,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  rows?: number;
  placeholder?: string;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);

  const highlightedHtml = useMemo(() => {
    const safe = value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const html = safe.replace(
      /(\{\{(\w+)\}\})/g,
      '<mark style="background:rgba(52,211,153,0.18);color:#6ee7b7;border-radius:2px;font-style:normal">$1</mark>',
    );
    return html + "\u200b"; // zero-width space prevents scroll clamp
  }, [value]);

  const syncScroll = () => {
    if (bgRef.current && taRef.current) {
      bgRef.current.scrollTop  = taRef.current.scrollTop;
      bgRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  };

  return (
    <div className="relative rounded-lg overflow-hidden border border-white/[0.08] focus-within:border-emerald-500/40">
      {/* Highlight backdrop — shows all text at normal opacity; {{variable}} marks are emerald.
          The textarea on top is transparent so this layer is what the user reads. */}
      <div
        ref={bgRef}
        aria-hidden="true"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: highlightedHtml }}
        className="absolute inset-0 px-3 py-2 text-xs font-mono leading-relaxed whitespace-pre-wrap break-words overflow-hidden pointer-events-none text-white/80"
      />
      {/* Actual textarea — transparent text so backdrop shows through; white caret */}
      <textarea
        ref={taRef}
        value={value}
        onChange={e => onChange(e.target.value)}
        onScroll={syncScroll}
        disabled={disabled}
        rows={rows}
        placeholder={placeholder}
        className="relative w-full bg-transparent px-3 py-2 text-xs font-mono leading-relaxed resize-y outline-none disabled:opacity-60 placeholder:text-muted-foreground/40"
        style={{ color: "transparent", caretColor: "white" }}
      />
    </div>
  );
}

// ── ChainBuilderEditor ─────────────────────────────────────────────────────────
// Drag-to-reorder list of chain steps. Each step picks a template and maps
// the previous step's output text into one or more of its input variables.

function ChainBuilderEditor({
  steps,
  onChange,
  templates,
  readOnly,
}: {
  steps:     PromptChainStep[];
  onChange:  (steps: PromptChainStep[]) => void;
  templates: PromptTemplate[];
  readOnly:  boolean;
}) {
  const dragIdx    = useRef<number | null>(null);
  const dragOverIdx = useRef<number | null>(null);

  const sorted = useMemo(() => [...steps].sort((a, b) => a.order - b.order), [steps]);

  function reorder(from: number, to: number) {
    if (from === to) return;
    const next = [...sorted];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next.map((s, i) => ({ ...s, order: i + 1 })));
  }

  function addStep() {
    const maxOrder = sorted.reduce((m, s) => Math.max(m, s.order), 0);
    onChange([...steps, { order: maxOrder + 1, templateId: null, label: `Step ${maxOrder + 1}`, description: "", outputSections: [], inputMappings: [], autoInjectSections: false }]);
  }

  function removeStep(idx: number) {
    const next = sorted.filter((_, i) => i !== idx);
    onChange(next.map((s, i) => ({ ...s, order: i + 1 })));
  }

  function updateStep(idx: number, patch: Partial<PromptChainStep>) {
    const next = sorted.map((s, i) => i === idx ? { ...s, ...patch } : s);
    onChange(next);
  }

  function updateMapping(stepIdx: number, varName: string, encodedValue: string) {
    // encodedValue format: "<fromStep>:<fromSection>" e.g. "0:", "1:", "1:Headline"
    const colonIdx   = encodedValue.indexOf(":");
    const fromStep   = Number(encodedValue.slice(0, colonIdx));
    const fromSection = encodedValue.slice(colonIdx + 1) || undefined;

    const step     = sorted[stepIdx];
    const existing = step.inputMappings.filter(m => m.toVar !== varName);
    const mappings: ChainStepMapping[] = fromStep === 0
      ? existing // fromStep=0 is the default (use test inputs), so no explicit mapping needed
      : [...existing, { toVar: varName, fromStep, ...(fromSection ? { fromSection } : {}) }];
    updateStep(stepIdx, { inputMappings: mappings });
  }

  function getMappingEncoded(step: PromptChainStep, varName: string): string {
    const m = step.inputMappings.find(mp => mp.toVar === varName);
    if (!m) return "0:";
    return `${m.fromStep}:${m.fromSection ?? ""}`;
  }

  function getMappingLabel(step: PromptChainStep, varName: string): string {
    const m = step.inputMappings.find(mp => mp.toVar === varName);
    if (!m || m.fromStep === 0) return "Test inputs";
    const prevStep = sorted[m.fromStep - 1];
    const label = prevStep?.label || `Step ${m.fromStep}`;
    return m.fromSection ? `Step ${m.fromStep} › ${m.fromSection}` : `Step ${m.fromStep} output (${label})`;
  }

  // Collect variables from a template
  function templateVars(tplId: string | null): string[] {
    if (!tplId) return [];
    const tpl = templates.find(t => t.id === tplId);
    if (!tpl) return [];
    const fromSystem = (tpl.systemPrompt.match(/\{\{(\w+)\}\}/g) ?? []).map((m: string) => m.slice(2, -2));
    const fromUser   = (tpl.userPromptTemplate.match(/\{\{(\w+)\}\}/g) ?? []).map((m: string) => m.slice(2, -2));
    return [...new Set([...fromSystem, ...fromUser])];
  }

  if (sorted.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
        <div className="h-10 w-10 rounded-xl bg-violet-500/10 ring-1 ring-violet-500/20 flex items-center justify-center">
          <Link2 className="h-5 w-5 text-violet-400" />
        </div>
        <div>
          <p className="text-sm font-medium text-foreground">No chain steps yet</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-xs">
            Add steps to build a multi-step pipeline. The output of each step feeds into the next.
          </p>
        </div>
        {!readOnly && (
          <button
            onClick={addStep}
            className="flex items-center gap-2 rounded-lg border border-violet-500/30 bg-violet-500/[0.08] hover:bg-violet-500/15 text-violet-300 px-4 py-2 text-xs font-medium transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> Add First Step
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sorted.map((step, idx) => {
        const vars        = templateVars(step.templateId);
        const tplName     = templates.find(t => t.id === step.templateId)?.name ?? null;

        return (
          <div
            key={`${step.order}-${idx}`}
            draggable={!readOnly}
            onDragStart={() => { dragIdx.current = idx; }}
            onDragOver={e => { e.preventDefault(); dragOverIdx.current = idx; }}
            onDrop={() => {
              if (dragIdx.current !== null && dragOverIdx.current !== null) {
                reorder(dragIdx.current, dragOverIdx.current);
              }
              dragIdx.current = null;
              dragOverIdx.current = null;
            }}
            className="rounded-lg border border-white/[0.06] bg-white/[0.02] overflow-hidden"
          >
            {/* Step header */}
            <div className="flex items-center gap-2 px-3 py-2 bg-white/[0.02] border-b border-white/[0.04]">
              {!readOnly && (
                <span className="cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground/60 shrink-0">
                  <GripVertical className="h-3.5 w-3.5" />
                </span>
              )}
              <span className="h-5 w-5 rounded-full bg-violet-500/20 text-violet-300 text-[10px] font-bold flex items-center justify-center shrink-0">
                {idx + 1}
              </span>
              {readOnly ? (
                <span className="text-xs font-medium text-foreground flex-1">{step.label || `Step ${idx + 1}`}</span>
              ) : (
                <input
                  value={step.label}
                  onChange={e => updateStep(idx, { label: e.target.value })}
                  className="flex-1 bg-transparent text-xs font-medium outline-none placeholder:text-muted-foreground/40 min-w-0"
                  placeholder={`Step ${idx + 1} label`}
                />
              )}
              {!readOnly && (
                <button
                  onClick={() => removeStep(idx)}
                  className="ml-auto p-1 rounded hover:bg-red-500/10 text-muted-foreground/40 hover:text-red-400 transition-colors shrink-0"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            <div className="p-3 space-y-2.5">
              {/* Template picker */}
              <div>
                <label className="text-[10px] text-muted-foreground/70 uppercase tracking-widest">Template</label>
                {readOnly ? (
                  <p className="mt-1 text-xs text-foreground">{tplName ?? <span className="text-muted-foreground/50 italic">None selected</span>}</p>
                ) : (
                  <select
                    value={step.templateId ?? ""}
                    onChange={e => updateStep(idx, { templateId: e.target.value || null, inputMappings: [] })}
                    className="mt-1 w-full rounded-md bg-white/[0.04] border border-white/[0.08] px-2 py-1.5 text-xs text-foreground outline-none focus:border-violet-500/40 [&>option]:bg-[#1a1a2e]"
                  >
                    <option value="">— select template —</option>
                    {templates.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Output sections — named headings this step will produce */}
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <ListOrdered className="h-3 w-3 text-muted-foreground/40" />
                  <label className="text-[10px] text-muted-foreground/70 uppercase tracking-widest">Output Sections</label>
                  {!readOnly && (
                    <span className="text-[10px] text-muted-foreground/40 normal-case ml-1">(named sections downstream steps can extract)</span>
                  )}
                </div>
                {readOnly ? (
                  step.outputSections?.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {step.outputSections.map((sec, si) => (
                        <span key={si} className="rounded px-1.5 py-0.5 text-[9px] font-mono bg-violet-500/10 text-violet-300 border border-violet-500/20">{sec}</span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[10px] text-muted-foreground/40 italic">No sections defined — downstream steps will use full output</p>
                  )
                ) : (
                  <div className="space-y-1">
                    {(step.outputSections ?? []).map((sec, si) => (
                      <div key={si} className="flex items-center gap-1.5">
                        <input
                          value={sec}
                          onChange={e => {
                            const next = [...(step.outputSections ?? [])];
                            next[si] = e.target.value;
                            updateStep(idx, { outputSections: next });
                          }}
                          className="flex-1 bg-transparent border border-white/[0.06] rounded px-1.5 py-0.5 text-[10px] font-mono text-violet-300 outline-none focus:border-violet-500/40 placeholder:text-muted-foreground/30"
                          placeholder="e.g. Headline, Summary, CTA"
                        />
                        <button
                          onClick={() => {
                            const next = (step.outputSections ?? []).filter((_, j) => j !== si);
                            updateStep(idx, { outputSections: next });
                          }}
                          className="p-0.5 rounded hover:bg-red-500/10 text-muted-foreground/40 hover:text-red-400 transition-colors shrink-0"
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => updateStep(idx, { outputSections: [...(step.outputSections ?? []), ""] })}
                      className="flex items-center gap-1 text-[10px] text-violet-400/70 hover:text-violet-300 transition-colors"
                    >
                      <Plus className="h-2.5 w-2.5" /> Add section
                    </button>
                  </div>
                )}

                {/* Auto-inject toggle */}
                {(step.outputSections ?? []).some(s => s.trim()) && (
                  <div className="mt-2">
                    {readOnly ? (
                      step.autoInjectSections && (
                        <div className="flex items-center gap-1.5">
                          <Zap className="h-3 w-3 text-amber-400/70 shrink-0" />
                          <span className="text-[10px] text-amber-300/80">Auto-inject sections as variables is on</span>
                        </div>
                      )
                    ) : (
                      <button
                        type="button"
                        onClick={() => updateStep(idx, { autoInjectSections: !step.autoInjectSections })}
                        className={cn(
                          "flex items-center gap-1.5 rounded px-2 py-1 text-[10px] transition-colors border",
                          step.autoInjectSections
                            ? "bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/15"
                            : "bg-white/[0.03] border-white/[0.06] text-muted-foreground/50 hover:text-muted-foreground hover:bg-white/[0.05]"
                        )}
                      >
                        <Zap className="h-2.5 w-2.5 shrink-0" />
                        Auto-inject sections as variables
                        <span className={cn(
                          "ml-1 rounded-full h-3.5 w-6 relative transition-colors shrink-0",
                          step.autoInjectSections ? "bg-amber-500/60" : "bg-white/10"
                        )}>
                          <span className={cn(
                            "absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-transform",
                            step.autoInjectSections ? "translate-x-3" : "translate-x-0.5"
                          )} />
                        </span>
                      </button>
                    )}
                    {step.autoInjectSections && (
                      <div className="mt-1.5 rounded bg-amber-500/[0.06] border border-amber-500/20 px-2 py-1.5 space-y-0.5">
                        <p className="text-[9px] text-amber-300/60 uppercase tracking-widest mb-1">Available auto-variables in downstream steps</p>
                        <div className="flex flex-wrap gap-1">
                          {(step.outputSections ?? []).filter(s => s.trim()).map((sec, si) => {
                            const key = `step${idx + 1}_${sec.trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/[^\w]/g, "")}`;
                            return (
                              <code key={si} className="rounded px-1.5 py-0.5 text-[9px] font-mono bg-amber-500/10 text-amber-300 border border-amber-500/20">{`{{${key}}}`}</code>
                            );
                          })}
                          <code className="rounded px-1.5 py-0.5 text-[9px] font-mono bg-amber-500/10 text-amber-300 border border-amber-500/20">{`{{step${idx + 1}_output}}`}</code>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Input mappings — for each variable in the selected template */}
              {vars.length > 0 && (
                <div>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <ArrowRight className="h-3 w-3 text-muted-foreground/40" />
                    <label className="text-[10px] text-muted-foreground/70 uppercase tracking-widest">Input Variable Sources</label>
                  </div>
                  {/* Auto-variable hint: show which {{stepN_x}} vars are available from upstream auto-inject steps */}
                  {(() => {
                    const autoVars: string[] = [];
                    sorted.slice(0, idx).forEach((prevStep, prevIdx) => {
                      if (!prevStep.autoInjectSections) return;
                      const stepNum = prevIdx + 1;
                      (prevStep.outputSections ?? []).filter(s => s.trim()).forEach(sec => {
                        const key = `step${stepNum}_${sec.trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/[^\w]/g, "")}`;
                        autoVars.push(key);
                      });
                      autoVars.push(`step${stepNum}_output`);
                    });
                    if (!autoVars.length) return null;
                    return (
                      <div className="mb-2 rounded bg-amber-500/[0.06] border border-amber-500/20 px-2 py-1.5">
                        <p className="text-[9px] text-amber-300/60 uppercase tracking-widest mb-1 flex items-center gap-1">
                          <Zap className="h-2.5 w-2.5" />Auto-injected variables available
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {autoVars.map(v => (
                            <code key={v} className="rounded px-1.5 py-0.5 text-[9px] font-mono bg-amber-500/10 text-amber-300 border border-amber-500/20">{`{{${v}}}`}</code>
                          ))}
                        </div>
                        <p className="text-[9px] text-muted-foreground/40 mt-1">Use these in your template prompt — they are filled automatically at runtime.</p>
                      </div>
                    );
                  })()}
                  <div className="space-y-1.5">
                    {vars.map(varName => {
                      const currentEncoded = getMappingEncoded(step, varName);
                      return (
                        <div key={varName} className="flex items-center gap-2">
                          <code className="text-[10px] font-mono text-emerald-400/80 shrink-0 w-28 truncate">{`{{${varName}}}`}</code>
                          <span className="text-[10px] text-muted-foreground/40 shrink-0">←</span>
                          {readOnly ? (
                            <span className="text-[10px] text-muted-foreground">
                              {getMappingLabel(step, varName)}
                            </span>
                          ) : (
                            <select
                              value={currentEncoded}
                              onChange={e => updateMapping(idx, varName, e.target.value)}
                              className="flex-1 rounded bg-white/[0.04] border border-white/[0.06] px-1.5 py-0.5 text-[10px] text-foreground outline-none focus:border-violet-500/40 [&>option]:bg-[#1a1a2e]"
                            >
                              <option value="0:">From test inputs</option>
                              {sorted.slice(0, idx).map((prevStep, prevIdx) => {
                                const stepNum = prevIdx + 1;
                                const stepLabel = prevStep.label || `Step ${stepNum}`;
                                const sections = prevStep.outputSections ?? [];
                                return (
                                  <optgroup key={prevIdx} label={`Step ${stepNum} — ${stepLabel}`}>
                                    <option value={`${stepNum}:`}>Full output</option>
                                    {sections.filter(s => s.trim()).map((sec, si) => (
                                      <option key={si} value={`${stepNum}:${sec}`}>
                                        Section: {sec}
                                      </option>
                                    ))}
                                  </optgroup>
                                );
                              })}
                            </select>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Step description */}
              {!readOnly && (
                <div>
                  <label className="text-[10px] text-muted-foreground/70 uppercase tracking-widest">Notes <span className="normal-case text-muted-foreground/40">(optional)</span></label>
                  <input
                    value={step.description}
                    onChange={e => updateStep(idx, { description: e.target.value })}
                    className="mt-1 w-full bg-transparent border border-white/[0.06] rounded px-2 py-1 text-[11px] text-muted-foreground outline-none focus:border-white/[0.12]"
                    placeholder="Describe what this step does…"
                  />
                </div>
              )}
              {readOnly && step.description && (
                <p className="text-[11px] text-muted-foreground/60 italic">{step.description}</p>
              )}
            </div>

            {/* Arrow connector between steps */}
            {idx < sorted.length - 1 && (
              <div className="flex items-center justify-center py-0.5 bg-white/[0.01]">
                <ChevronDown className="h-3 w-3 text-violet-400/40" />
              </div>
            )}
          </div>
        );
      })}

      {!readOnly && (
        <button
          onClick={addStep}
          className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/[0.1] hover:border-violet-500/30 text-muted-foreground hover:text-violet-300 py-2 text-xs font-medium transition-colors"
        >
          <Plus className="h-3.5 w-3.5" /> Add Step
        </button>
      )}
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function GrowthMindPromptStudio() {
  const qc = useQueryClient();

  // Server functions
  const getTemplatesFn    = useServerFn(getPromptTemplates);
  const getTemplateFn     = useServerFn(getPromptTemplate);
  const saveTemplateFn    = useServerFn(savePromptTemplate);
  const deleteTemplateFn  = useServerFn(deletePromptTemplate);
  const testTemplateFn    = useServerFn(testPromptTemplate);
  const seedPacksFn       = useServerFn(seedLibraryPacks);
  const restoreVersionFn  = useServerFn(restorePromptVersion);
  const toggleFavoriteFn  = useServerFn(togglePromptFavorite);
  const getWorkspaceCtxFn = useServerFn(getWorkspaceContext);
  const setWinnerFn       = useServerFn(setPromptWinner);
  const runChainFn        = useServerFn(runPromptChain);

  // State
  const [selectedId,     setSelectedId]     = useState<string | null>(null);
  const [editState,      setEditState]      = useState({ ...DEFAULT_EDIT });
  const [isDirty,        setIsDirty]        = useState(false);
  const [isSaving,       setIsSaving]       = useState(false);
  const [isDeleting,     setIsDeleting]     = useState(false);
  const [centerTab,      setCenterTab]      = useState<"prompts" | "chain">("prompts");
  const [rightTab,       setRightTab]       = useState<"test" | "preview" | "versions" | "stats">("test");
  const [libTab,         setLibTab]         = useState<"library" | "custom" | "workflow">("library");
  const [searchQuery,    setSearchQuery]    = useState("");
  const [typeFilter,     setTypeFilter]     = useState("all");
  const [testInputs,     setTestInputs]     = useState<Record<string, string>>({});
  const [testOutput,     setTestOutput]     = useState<any>(null);
  const [isRunning,      setIsRunning]      = useState(false);
  const [chainOutput,    setChainOutput]    = useState<any>(null);
  const [isRunningChain, setIsRunningChain] = useState(false);
  const [expandedChainStep, setExpandedChainStep] = useState<number | null>(null);
  const [abEnabled,      setAbEnabled]      = useState(false);
  const [variantBSys,    setVariantBSys]    = useState("");
  const [variantBUser,   setVariantBUser]   = useState("");
  const [isSettingWinner, setIsSettingWinner] = useState(false);
  const [winnerSet,       setWinnerSet]       = useState<"A" | "B" | null>(null);
  const [versions,       setVersions]       = useState<PromptVersion[]>([]);
  const [seedDone,       setSeedDone]       = useState(false);
  const autoSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Queries
  const { data: templatesData, isLoading } = useQuery({
    queryKey: ["prompt-templates"],
    queryFn:  () => getTemplatesFn(),
  });

  const { data: workspaceCtx = EMPTY_WS_CTX } = useQuery({
    queryKey: ["workspace-context"],
    queryFn:  () => getWorkspaceCtxFn(),
    staleTime: 5 * 60 * 1000,
  });

  const templates    = templatesData?.templates ?? [];
  const migrationNeeded = templatesData?.migrationNeeded ?? false;

  // Auto-seed library packs on first load
  useEffect(() => {
    if (!seedDone && templates.length === 0 && !isLoading && !migrationNeeded) {
      setSeedDone(true);
      seedPacksFn().then(() => qc.invalidateQueries({ queryKey: ["prompt-templates"] })).catch(() => {});
    }
  }, [templates.length, isLoading, migrationNeeded, seedDone]);

  // Filter templates
  const filteredTemplates = useMemo(() => {
    return templates.filter(t => {
      if (t.category !== libTab) return false;
      if (typeFilter !== "all" && t.type !== typeFilter) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        return t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) || t.tags.some(tag => tag.toLowerCase().includes(q));
      }
      return true;
    });
  }, [templates, libTab, typeFilter, searchQuery]);

  const workflowCount = useMemo(() => templates.filter(t => t.category === "workflow").length, [templates]);

  // Detected variables from current prompts
  const detectedVarNames = useMemo(() => {
    const fromSystem = extractVariables(editState.systemPrompt);
    const fromUser   = extractVariables(editState.userPromptTemplate);
    return [...new Set([...fromSystem, ...fromUser])];
  }, [editState.systemPrompt, editState.userPromptTemplate]);

  // Keep variable list in sync with detected variables
  useEffect(() => {
    if (!selectedId && !isDirty) return;
    const existing = new Set(editState.variables.map(v => v.name));
    const missing  = detectedVarNames.filter(n => !existing.has(n));
    if (missing.length > 0) {
      setEditState(s => ({
        ...s,
        variables: [
          ...s.variables,
          ...missing.map(n => ({ name: n, description: "", defaultValue: "" })),
        ],
      }));
    }
  }, [detectedVarNames.join(",")]);

  // Populate test inputs from variables — priority: existing user input > workspace context > variable default
  useEffect(() => {
    const inputs: Record<string, string> = {};
    for (const v of editState.variables) {
      inputs[v.name] = testInputs[v.name] || (workspaceCtx as Record<string,string>)[v.name] || v.defaultValue || "";
    }
    setTestInputs(inputs);
  }, [editState.variables, workspaceCtx]);

  // Live preview — resolved prompts with current test inputs substituted
  // Priority: test input > workspace context > variable default > [name]
  const resolveVars = useCallback((text: string) =>
    text.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const v = editState.variables.find(v => v.name === key);
      return testInputs[key] || (workspaceCtx as Record<string,string>)[key] || v?.defaultValue || `[${key}]`;
    }), [editState.variables, testInputs, workspaceCtx]);

  const livePreviewSystem = useMemo(() => resolveVars(editState.systemPrompt),       [editState.systemPrompt, resolveVars]);
  const livePreviewUser   = useMemo(() => resolveVars(editState.userPromptTemplate), [editState.userPromptTemplate, resolveVars]);

  // Debounced autosave — triggers 5 s after last change when dirty + not read-only
  useEffect(() => {
    if (!isDirty || isReadOnly || !editState.name.trim() || !selectedId) return;
    if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    autoSaveRef.current = setTimeout(() => {
      handleSave();
    }, 5000);
    return () => {
      if (autoSaveRef.current) clearTimeout(autoSaveRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty, editState.systemPrompt, editState.userPromptTemplate, editState.name, editState.variables, selectedId]);

  // Load a template into the editor
  const loadTemplate = useCallback(async (template: PromptTemplate) => {
    setSelectedId(template.id);
    setEditState({
      name:               template.name,
      description:        template.description,
      type:               template.type,
      category:           template.category,
      systemPrompt:       template.systemPrompt,
      userPromptTemplate: template.userPromptTemplate,
      variables:          template.variables,
      chainSteps:         template.chainSteps,
      tags:               template.tags,
      isActive:           template.isActive,
      isFavorite:         template.isFavorite,
    });
    setIsDirty(false);
    setTestOutput(null);
    setChainOutput(null);
    setVersions([]);
    setAbEnabled(false);
    setVariantBSys("");
    setVariantBUser("");
    setWinnerSet(null);

    // Workflow templates open directly on the chain builder
    if (template.category === "workflow") {
      setCenterTab("chain");
    }

    // Load versions
    try {
      const res = await getTemplateFn({ data: { id: template.id } });
      setVersions(res.versions);
    } catch {}
  }, []);

  const handleNewTemplate = () => {
    setSelectedId(null);
    setEditState({ ...DEFAULT_EDIT });
    setIsDirty(true);   // must be true so the editor panel renders (gate: !selectedId && !isDirty)
    setTestOutput(null);
    setVersions([]);
    setCenterTab("prompts");
    setLibTab("custom");
  };

  const handleNewWorkflow = () => {
    setSelectedId(null);
    setEditState({
      ...DEFAULT_EDIT,
      name:     "Untitled Workflow",
      category: "workflow",
    });
    setIsDirty(true);
    setTestOutput(null);
    setChainOutput(null);
    setVersions([]);
    setCenterTab("chain");   // chain builder is the primary editor for workflows
    setLibTab("workflow");
  };

  const handleSave = async () => {
    if (!editState.name.trim()) return;
    setIsSaving(true);
    try {
      const res = await saveTemplateFn({ data: {
        id:                 selectedId ?? undefined,
        name:               editState.name,
        description:        editState.description,
        type:               editState.type,
        category:           editState.category === "library" ? "custom" : editState.category as "custom" | "workflow",
        systemPrompt:       editState.systemPrompt,
        userPromptTemplate: editState.userPromptTemplate,
        variables:          editState.variables,
        chainSteps:         editState.chainSteps,
        tags:               editState.tags,
        isFavorite:         editState.isFavorite,
      }});
      setSelectedId(res.id);
      setIsDirty(false);
      await qc.invalidateQueries({ queryKey: ["prompt-templates"] });
    } catch (e) {
      console.error("Save failed:", e);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDuplicate = async () => {
    setIsSaving(true);
    const dupCategory: "custom" | "workflow" = editState.category === "workflow" ? "workflow" : "custom";
    try {
      const res = await saveTemplateFn({ data: {
        name:               `${editState.name} (Copy)`,
        description:        editState.description,
        type:               editState.type,
        category:           dupCategory,
        systemPrompt:       editState.systemPrompt,
        userPromptTemplate: editState.userPromptTemplate,
        variables:          editState.variables,
        chainSteps:         editState.chainSteps,
        tags:               editState.tags,
        isFavorite:         false,
      }});
      setSelectedId(res.id);
      setEditState(s => ({ ...s, name: `${s.name} (Copy)`, category: dupCategory, isFavorite: false }));
      setIsDirty(false);
      await qc.invalidateQueries({ queryKey: ["prompt-templates"] });
      setLibTab(dupCategory);
    } catch {}
    finally { setIsSaving(false); }
  };

  const handleRunWorkflow = useCallback(async (template: PromptTemplate) => {
    await loadTemplate(template);
    // Give React a tick to apply state before triggering the chain run
    setTimeout(() => {
      setRightTab("test");
    }, 50);
  }, [loadTemplate]);

  const handleDelete = async () => {
    if (!selectedId || editState.category === "library") return;
    if (!confirm("Delete this prompt template? This cannot be undone.")) return;
    setIsDeleting(true);
    try {
      await deleteTemplateFn({ data: { id: selectedId } });
      setSelectedId(null);
      setEditState({ ...DEFAULT_EDIT });
      await qc.invalidateQueries({ queryKey: ["prompt-templates"] });
    } catch {}
    finally { setIsDeleting(false); }
  };

  const handleToggleFavorite = async (templateId: string, val: boolean) => {
    await toggleFavoriteFn({ data: { id: templateId, isFavorite: val } });
    if (selectedId === templateId) setEditState(s => ({ ...s, isFavorite: val }));
    qc.invalidateQueries({ queryKey: ["prompt-templates"] });
  };

  const handleTest = async () => {
    if (!selectedId) return;
    setIsRunning(true);
    setTestOutput(null);
    try {
      const payload: Record<string, any> = { templateId: selectedId, inputVariables: testInputs };
      if (abEnabled && variantBSys.trim() && variantBUser.trim()) {
        payload.variantBSystemPrompt = variantBSys;
        payload.variantBUserPrompt   = variantBUser;
      }
      const result = await testTemplateFn({ data: payload as any });
      setTestOutput(result);
      qc.invalidateQueries({ queryKey: ["prompt-templates"] });
    } catch (e: any) {
      setTestOutput({ error: e?.message ?? "Test failed" });
    } finally {
      setIsRunning(false);
    }
  };

  const handleSetAsWinner = async (label: "A" | "B") => {
    if (!selectedId || isReadOnly) return;
    const isB = label === "B";
    const sysPrompt  = isB ? (testOutput?.variantBSystemPrompt ?? variantBSys) : editState.systemPrompt;
    const userPrompt = isB ? (testOutput?.variantBUserPrompt ?? variantBUser) : editState.userPromptTemplate;

    if (label === "A") {
      // A is already the template — just confirm the choice
      setWinnerSet("A");
      setAbEnabled(false);
      setTestOutput(null);
      return;
    }

    setIsSettingWinner(true);
    try {
      await setWinnerFn({ data: {
        templateId:   selectedId,
        systemPrompt: sysPrompt,
        userPrompt:   userPrompt,
        winnerLabel:  label,
      }});
      // Update the editor to reflect the winner's prompts
      setEditState(s => ({ ...s, systemPrompt: sysPrompt, userPromptTemplate: userPrompt }));
      setIsDirty(false);
      setWinnerSet("B");
      setAbEnabled(false);
      setTestOutput(null);
      // Refresh versions + templates
      const res = await getTemplateFn({ data: { id: selectedId } });
      setVersions(res.versions);
      await qc.invalidateQueries({ queryKey: ["prompt-templates"] });
    } catch (e: any) {
      console.error("Set winner failed:", e);
    } finally {
      setIsSettingWinner(false);
    }
  };

  const handleRunChain = async () => {
    const activeSteps = editState.chainSteps.filter(s => s.templateId);
    if (activeSteps.length === 0) return;
    setIsRunningChain(true);
    setChainOutput(null);
    setExpandedChainStep(null);
    try {
      const result = await runChainFn({ data: {
        chainSteps:       editState.chainSteps,
        inputVariables:   testInputs,
        parentTemplateId: selectedId ?? undefined,
      }});
      setChainOutput(result);
      // Auto-expand the last step
      if (result.steps?.length > 0) {
        setExpandedChainStep(result.steps[result.steps.length - 1].stepOrder);
      }
      qc.invalidateQueries({ queryKey: ["prompt-templates"] });
    } catch (e: any) {
      setChainOutput({ error: e?.message ?? "Chain run failed" });
    } finally {
      setIsRunningChain(false);
    }
  };

  const handleRestoreVersion = async (versionId: string) => {
    if (!selectedId) return;
    if (!confirm("Restore this version? The current prompt will be overwritten.")) return;
    try {
      await restoreVersionFn({ data: { versionId, templateId: selectedId } });
      // Fetch fresh data from the server — don't rely on stale in-memory templates array
      const res = await getTemplateFn({ data: { id: selectedId } });
      if (res.template) {
        setSelectedId(res.template.id);
        setEditState({
          name:               res.template.name,
          description:        res.template.description,
          type:               res.template.type,
          category:           res.template.category,
          systemPrompt:       res.template.systemPrompt,
          userPromptTemplate: res.template.userPromptTemplate,
          variables:          res.template.variables,
          chainSteps:         res.template.chainSteps,
          tags:               res.template.tags,
          isActive:           res.template.isActive,
          isFavorite:         res.template.isFavorite,
        });
        setIsDirty(false);
        setTestOutput(null);
      }
      setVersions(res.versions);
      qc.invalidateQueries({ queryKey: ["prompt-templates"] });
    } catch {}
  };

  const isReadOnly = editState.category === "library";
  const selectedTemplate = templates.find(t => t.id === selectedId);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <GrowthMindShell>
      <div className="flex h-full min-h-0 flex-col">
        {/* Page header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.06] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500/15 ring-1 ring-emerald-500/20">
              <Sparkles className="h-3.5 w-3.5 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-sm font-semibold">Prompt Studio</h1>
              <p className="text-[11px] text-muted-foreground leading-none mt-0.5">Build, test and score AI prompt templates</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleNewWorkflow}
              className="flex items-center gap-1.5 rounded-lg bg-violet-500/15 hover:bg-violet-500/20 text-violet-300 px-3 py-1.5 text-xs font-medium transition-colors"
            >
              <Workflow className="h-3.5 w-3.5" />
              New Workflow
            </button>
            <button
              onClick={handleNewTemplate}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/20 text-emerald-300 px-3 py-1.5 text-xs font-medium transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              New Template
            </button>
          </div>
        </div>

        {migrationNeeded && (
          <div className="m-4 rounded-lg border border-amber-500/30 bg-amber-500/[0.08] p-4 flex items-start gap-3">
            <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-300">Migration required</p>
              <p className="text-xs text-muted-foreground mt-0.5">Apply <code className="text-amber-400">PROMPT_STUDIO_MIGRATION.sql</code> in your Supabase SQL Editor to enable Prompt Studio, then reload the page.</p>
            </div>
          </div>
        )}

        {!migrationNeeded && (
          <div className="flex flex-1 min-h-0">
            {/* ── Left panel: Template Library ───────────────────────────── */}
            <aside className="w-72 shrink-0 border-r border-white/[0.06] flex flex-col min-h-0">
              {/* Search */}
              <div className="p-2.5 border-b border-white/[0.06]">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                  <input
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search templates..."
                    className="w-full pl-7 pr-7 py-1.5 rounded-md bg-white/[0.04] border border-white/[0.08] text-xs outline-none focus:border-emerald-500/40 placeholder:text-muted-foreground/50"
                  />
                  {searchQuery && (
                    <button onClick={() => setSearchQuery("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>

              {/* Library / Custom / Workflows tabs */}
              <div className="flex border-b border-white/[0.06]">
                <button
                  onClick={() => setLibTab("library")}
                  className={cn(
                    "flex-1 py-2 text-xs font-medium transition-colors",
                    libTab === "library"
                      ? "text-emerald-300 border-b-2 border-emerald-400"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Library ({templates.filter(t => t.category === "library").length})
                </button>
                <button
                  onClick={() => setLibTab("custom")}
                  className={cn(
                    "flex-1 py-2 text-xs font-medium transition-colors",
                    libTab === "custom"
                      ? "text-emerald-300 border-b-2 border-emerald-400"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Mine ({templates.filter(t => t.category === "custom").length})
                </button>
                <button
                  onClick={() => setLibTab("workflow")}
                  className={cn(
                    "flex-1 py-2 text-xs font-medium transition-colors",
                    libTab === "workflow"
                      ? "text-violet-300 border-b-2 border-violet-400"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Workflows ({workflowCount})
                </button>
              </div>

              {/* Type filter pills */}
              <div className="flex gap-1 px-2.5 py-2 overflow-x-auto border-b border-white/[0.06] scrollbar-none">
                <button
                  onClick={() => setTypeFilter("all")}
                  className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap transition-colors shrink-0",
                    typeFilter === "all" ? "bg-emerald-500/20 text-emerald-300" : "bg-white/[0.04] text-muted-foreground hover:text-foreground"
                  )}
                >All</button>
                {PROMPT_TYPES.map(t => (
                  <button
                    key={t.value}
                    onClick={() => setTypeFilter(t.value)}
                    className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium whitespace-nowrap transition-colors shrink-0",
                      typeFilter === t.value ? "bg-emerald-500/20 text-emerald-300" : "bg-white/[0.04] text-muted-foreground hover:text-foreground"
                    )}
                  >{t.label}</button>
                ))}
              </div>

              {/* Template list */}
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {isLoading && (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                )}
                {!isLoading && filteredTemplates.length === 0 && (
                  <div className="py-8 text-center">
                    {libTab === "workflow"
                      ? <Workflow className="h-6 w-6 text-muted-foreground/30 mx-auto mb-2" />
                      : <FlaskConical className="h-6 w-6 text-muted-foreground/30 mx-auto mb-2" />
                    }
                    <p className="text-xs text-muted-foreground">
                      {libTab === "custom"   ? "No custom templates yet."
                      : libTab === "workflow" ? "No workflows yet."
                      : "No library templates found."}
                    </p>
                    {libTab === "custom" && (
                      <button onClick={handleNewTemplate} className="mt-2 text-xs text-emerald-400 hover:text-emerald-300">Create one</button>
                    )}
                    {libTab === "workflow" && (
                      <button onClick={handleNewWorkflow} className="mt-2 text-xs text-violet-400 hover:text-violet-300">Build a workflow</button>
                    )}
                  </div>
                )}
                {filteredTemplates.map(t => (
                  <TemplateCard
                    key={t.id}
                    template={t}
                    isSelected={selectedId === t.id}
                    onSelect={() => loadTemplate(t)}
                    onFavorite={val => handleToggleFavorite(t.id, val)}
                    onRun={t.category === "workflow" ? () => handleRunWorkflow(t) : undefined}
                  />
                ))}
              </div>
            </aside>

            {/* ── Center panel: Editor ───────────────────────────────────── */}
            <div className="flex-1 min-w-0 flex flex-col min-h-0 overflow-y-auto">
              {!selectedId && !isDirty ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
                  <div className="h-12 w-12 rounded-xl bg-emerald-500/10 ring-1 ring-emerald-500/20 flex items-center justify-center">
                    <Sparkles className="h-6 w-6 text-emerald-400" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium">Select a template to edit</p>
                    <p className="text-xs text-muted-foreground mt-1">Choose from the library, create a template, or build a reusable workflow</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleNewWorkflow}
                      className="flex items-center gap-2 rounded-lg border border-violet-500/30 bg-violet-500/[0.08] hover:bg-violet-500/15 text-violet-300 px-4 py-2 text-sm transition-colors"
                    >
                      <Workflow className="h-4 w-4" />
                      New Workflow
                    </button>
                    <button
                      onClick={handleNewTemplate}
                      className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.08] hover:bg-emerald-500/15 text-emerald-300 px-4 py-2 text-sm transition-colors"
                    >
                      <Plus className="h-4 w-4" />
                      New Template
                    </button>
                  </div>
                </div>
              ) : (
                <>
                {/* Center tab bar: Prompts | Chain */}
                <div className="flex border-b border-white/[0.06] shrink-0">
                  <button
                    onClick={() => setCenterTab("prompts")}
                    className={cn(
                      "flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors border-b-2",
                      centerTab === "prompts"
                        ? "text-emerald-300 border-emerald-400"
                        : "text-muted-foreground hover:text-foreground border-transparent",
                    )}
                  >
                    <Sparkles className="h-3 w-3" />
                    Prompts
                  </button>
                  <button
                    onClick={() => setCenterTab("chain")}
                    className={cn(
                      "flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors border-b-2",
                      centerTab === "chain"
                        ? "text-violet-300 border-violet-400"
                        : "text-muted-foreground hover:text-foreground border-transparent",
                    )}
                  >
                    <Link2 className="h-3 w-3" />
                    Chain
                    {editState.chainSteps.length > 0 && (
                      <span className={cn(
                        "ml-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold leading-none",
                        centerTab === "chain" ? "bg-violet-500/20 text-violet-300" : "bg-white/[0.08] text-muted-foreground",
                      )}>
                        {editState.chainSteps.length}
                      </span>
                    )}
                  </button>
                </div>

                {/* ── Prompts tab ── */}
                {centerTab === "prompts" && (
                <div className="p-4 space-y-4">
                  {/* Read-only notice for library packs */}
                  {isReadOnly && (
                    <div className="flex items-center gap-2 rounded-lg bg-blue-500/[0.08] border border-blue-500/20 px-3 py-2">
                      <Info className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                      <p className="text-xs text-blue-300">Library pack — read-only. Click <strong>Duplicate</strong> to create your own editable copy.</p>
                    </div>
                  )}

                  {/* Name + type row */}
                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      <label className="text-[10px] text-muted-foreground uppercase tracking-widest">Template Name</label>
                      <input
                        value={editState.name}
                        onChange={e => { setEditState(s => ({ ...s, name: e.target.value })); setIsDirty(true); }}
                        disabled={isReadOnly}
                        className="mt-1 w-full bg-transparent border border-white/[0.08] rounded-lg px-3 py-2 text-sm font-medium outline-none focus:border-emerald-500/40 disabled:opacity-60"
                        placeholder="Template name"
                      />
                    </div>
                  </div>

                  {/* Description */}
                  <div>
                    <label className="text-[10px] text-muted-foreground uppercase tracking-widest">Description</label>
                    <input
                      value={editState.description}
                      onChange={e => { setEditState(s => ({ ...s, description: e.target.value })); setIsDirty(true); }}
                      disabled={isReadOnly}
                      className="mt-1 w-full bg-transparent border border-white/[0.08] rounded-lg px-3 py-2 text-xs outline-none focus:border-emerald-500/40 disabled:opacity-60"
                      placeholder="Brief description of what this template does"
                    />
                  </div>

                  {/* Type chips */}
                  <div>
                    <label className="text-[10px] text-muted-foreground uppercase tracking-widest">Type</label>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {PROMPT_TYPES.map(t => (
                        <button
                          key={t.value}
                          onClick={() => { if (!isReadOnly) { setEditState(s => ({ ...s, type: t.value })); setIsDirty(true); }}}
                          className={cn(
                            "rounded-full px-2.5 py-1 text-[10px] font-medium transition-all",
                            editState.type === t.value
                              ? (TYPE_COLORS[t.value] ?? "bg-emerald-500/20 text-emerald-300") + " ring-1 ring-current/30"
                              : "bg-white/[0.04] text-muted-foreground hover:bg-white/[0.07]",
                            isReadOnly && "cursor-default",
                          )}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* System Prompt */}
                  <div>
                    <label className="text-[10px] text-muted-foreground uppercase tracking-widest">System Prompt</label>
                    <div className="mt-1">
                      <HighlightedTextarea
                        value={editState.systemPrompt}
                        onChange={v => { setEditState(s => ({ ...s, systemPrompt: v })); setIsDirty(true); }}
                        disabled={isReadOnly}
                        rows={8}
                        placeholder="Define the AI persona, context, and instructions here..."
                      />
                    </div>
                  </div>

                  {/* User Prompt Template */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] text-muted-foreground uppercase tracking-widest">User Prompt Template</label>
                      <span className="text-[10px] text-muted-foreground/50">Use <code className="text-emerald-400/70">{"{{variable_name}}"}</code> for dynamic values</span>
                    </div>
                    <HighlightedTextarea
                      value={editState.userPromptTemplate}
                      onChange={v => { setEditState(s => ({ ...s, userPromptTemplate: v })); setIsDirty(true); }}
                      disabled={isReadOnly}
                      rows={10}
                      placeholder="Write the user message template here. Use {{variable_name}} for dynamic values..."
                    />
                    {/* Detected variables */}
                    {detectedVarNames.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        <span className="text-[10px] text-muted-foreground/60 mr-1">Detected:</span>
                        {detectedVarNames.map(n => (
                          <span key={n} className="rounded-full bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 text-[10px] font-mono">{`{{${n}}}`}</span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Variables */}
                  <div>
                    <label className="text-[10px] text-muted-foreground uppercase tracking-widest">Variables</label>
                    <div className="mt-2">
                      <VariableEditor
                        variables={editState.variables}
                        onChange={v => { setEditState(s => ({ ...s, variables: v })); setIsDirty(true); }}
                        readOnly={isReadOnly}
                      />
                    </div>
                  </div>

                  {/* Tags */}
                  {!isReadOnly && (
                    <div>
                      <label className="text-[10px] text-muted-foreground uppercase tracking-widest">Tags</label>
                      <div className="mt-1.5 flex flex-wrap gap-1.5 items-center">
                        {editState.tags.map((tag, i) => (
                          <span key={i} className="flex items-center gap-1 rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-muted-foreground">
                            {tag}
                            <button onClick={() => { setEditState(s => ({ ...s, tags: s.tags.filter((_, j) => j !== i) })); setIsDirty(true); }}>
                              <X className="h-2.5 w-2.5 hover:text-foreground" />
                            </button>
                          </span>
                        ))}
                        <input
                          className="bg-transparent text-xs outline-none placeholder:text-muted-foreground/50 min-w-[80px]"
                          placeholder="+ add tag"
                          onKeyDown={e => {
                            if (e.key === "Enter" || e.key === ",") {
                              e.preventDefault();
                              const val = (e.target as HTMLInputElement).value.trim().replace(/,/g, "");
                              if (val && !editState.tags.includes(val)) {
                                setEditState(s => ({ ...s, tags: [...s.tags, val] }));
                                setIsDirty(true);
                              }
                              (e.target as HTMLInputElement).value = "";
                            }
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Toolbar */}
                  <div className="flex items-center gap-2 pt-2 border-t border-white/[0.06]">
                    {!isReadOnly && (
                      <button
                        onClick={handleSave}
                        disabled={isSaving || !editState.name.trim()}
                        className="flex items-center gap-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/20 text-emerald-300 px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
                      >
                        {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                        {isSaving ? "Saving…" : isDirty ? "Save*" : "Saved"}
                      </button>
                    )}
                    <button
                      onClick={handleDuplicate}
                      disabled={isSaving}
                      className="flex items-center gap-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.07] text-muted-foreground hover:text-foreground px-3 py-1.5 text-xs font-medium transition-colors"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {isReadOnly ? "Duplicate to Edit" : "Duplicate"}
                    </button>
                    {!isReadOnly && selectedId && (
                      <button
                        onClick={handleDelete}
                        disabled={isDeleting}
                        className="flex items-center gap-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-400 px-3 py-1.5 text-xs font-medium transition-colors ml-auto"
                      >
                        {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        Delete
                      </button>
                    )}
                  </div>
                </div>
                )}

                {/* ── Chain tab ── */}
                {centerTab === "chain" && (
                  <div className="p-4 space-y-4">
                    {isReadOnly && (
                      <div className="flex items-center gap-2 rounded-lg bg-blue-500/[0.08] border border-blue-500/20 px-3 py-2">
                        <Info className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                        <p className="text-xs text-blue-300">Library pack — read-only. Duplicate to create an editable chain.</p>
                      </div>
                    )}

                    {/* Workflow name editor (shown when it's a workflow template) */}
                    {editState.category === "workflow" && !isReadOnly && (
                      <div>
                        <label className="text-[10px] text-muted-foreground uppercase tracking-widest">Workflow Name</label>
                        <input
                          value={editState.name}
                          onChange={e => { setEditState(s => ({ ...s, name: e.target.value })); setIsDirty(true); }}
                          className="mt-1 w-full bg-transparent border border-white/[0.08] rounded-lg px-3 py-2 text-sm font-medium outline-none focus:border-violet-500/40"
                          placeholder="Workflow name"
                        />
                        {editState.description !== undefined && (
                          <input
                            value={editState.description}
                            onChange={e => { setEditState(s => ({ ...s, description: e.target.value })); setIsDirty(true); }}
                            className="mt-1.5 w-full bg-transparent border border-white/[0.08] rounded-lg px-3 py-2 text-xs outline-none focus:border-violet-500/40"
                            placeholder="Brief description (optional)"
                          />
                        )}
                      </div>
                    )}

                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-widest">
                          {editState.category === "workflow" ? "Workflow Steps" : "Chain Pipeline"}
                        </p>
                        <p className="text-[11px] text-muted-foreground/60 mt-0.5">Output of each step feeds into the next. Run the chain from the Test panel.</p>
                      </div>
                      {editState.chainSteps.length > 0 && (
                        <button
                          onClick={() => { setRightTab("test"); }}
                          className="flex items-center gap-1.5 rounded-lg bg-violet-500/15 hover:bg-violet-500/20 text-violet-300 px-2.5 py-1.5 text-xs font-medium transition-colors"
                        >
                          <Play className="h-3 w-3" />
                          {editState.category === "workflow" ? "Run Workflow" : "Run Chain"}
                        </button>
                      )}
                    </div>

                    <ChainBuilderEditor
                      steps={editState.chainSteps}
                      onChange={steps => { setEditState(s => ({ ...s, chainSteps: steps })); setIsDirty(true); }}
                      templates={templates}
                      readOnly={isReadOnly}
                    />

                    {/* Toolbar — always shown for non-read-only */}
                    {!isReadOnly && (
                      <div className="flex items-center gap-2 pt-2 border-t border-white/[0.06]">
                        <button
                          onClick={handleSave}
                          disabled={isSaving || !editState.name.trim()}
                          className="flex items-center gap-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/20 text-emerald-300 px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
                        >
                          {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                          {isSaving ? "Saving…" : isDirty ? "Save*" : "Saved"}
                        </button>
                        <button
                          onClick={handleDuplicate}
                          disabled={isSaving}
                          className="flex items-center gap-1.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.07] text-muted-foreground hover:text-foreground px-3 py-1.5 text-xs font-medium transition-colors"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          Duplicate
                        </button>
                        {selectedId && (
                          <button
                            onClick={handleDelete}
                            disabled={isDeleting}
                            className="flex items-center gap-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-400 px-3 py-1.5 text-xs font-medium transition-colors ml-auto"
                          >
                            {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                            Delete
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
                </>
              )}
            </div>

            {/* ── Right panel: Test / Versions / Stats ──────────────────── */}
            <aside className={cn(
              "shrink-0 border-l border-white/[0.06] flex flex-col min-h-0 transition-all duration-300",
              abEnabled && testOutput?.variantB ? "w-[680px]" : "w-80",
            )}>
              {/* Tab bar */}
              <div className="flex border-b border-white/[0.06]">
                {(["test", "preview", "versions", "stats"] as const).map(tab => {
                  const icons = { test: FlaskConical, preview: Eye, versions: Clock, stats: BarChart2 };
                  const labels = { test: "Test", preview: "Preview", versions: "History", stats: "Stats" };
                  const Icon = icons[tab];
                  return (
                    <button
                      key={tab}
                      onClick={() => setRightTab(tab)}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-1 py-2.5 text-[10px] font-medium transition-colors",
                        rightTab === tab
                          ? "text-emerald-300 border-b-2 border-emerald-400"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <Icon className="h-3 w-3" />
                      {labels[tab]}
                    </button>
                  );
                })}
              </div>

              <div className="flex-1 overflow-y-auto">

                {/* ── Test tab ── */}
                {rightTab === "test" && (
                  <div className="p-3 space-y-3">
                    {!selectedId ? (
                      <p className="text-xs text-muted-foreground text-center py-6">Select a template to test it</p>
                    ) : (
                      <>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Variable Values</p>
                        {editState.variables.length === 0 ? (
                          <p className="text-xs text-muted-foreground/50">No variables detected in this template.</p>
                        ) : (
                          <div className="space-y-2">
                            {editState.variables.map(v => (
                              <div key={v.name}>
                                <label className="text-[10px] text-muted-foreground/70 font-mono">{`{{${v.name}}}`}</label>
                                {v.description && <p className="text-[10px] text-muted-foreground/50 leading-none mb-0.5">{v.description}</p>}
                                <input
                                  value={testInputs[v.name] ?? ""}
                                  onChange={e => setTestInputs(s => ({ ...s, [v.name]: e.target.value }))}
                                  className="w-full bg-transparent border border-white/[0.08] rounded px-2 py-1 text-xs outline-none focus:border-emerald-500/40"
                                  placeholder={v.defaultValue || "Enter value…"}
                                />
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Compare mode toggle */}
                        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <GitCompare className="h-3 w-3 text-blue-400" />
                              <div>
                                <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Compare Mode</p>
                                <p className="text-[10px] text-muted-foreground/50 mt-0.5">Test two prompt versions side-by-side</p>
                              </div>
                            </div>
                            <button
                              onClick={() => {
                                const next = !abEnabled;
                                setAbEnabled(next);
                                setTestOutput(null);
                                setWinnerSet(null);
                                if (next) {
                                  // Pre-fill B with current template prompts for delta editing
                                  if (!variantBSys)  setVariantBSys(editState.systemPrompt);
                                  if (!variantBUser) setVariantBUser(editState.userPromptTemplate);
                                }
                              }}
                              className={cn(
                                "relative h-5 w-9 rounded-full transition-colors",
                                abEnabled ? "bg-blue-500" : "bg-white/[0.12]",
                              )}
                            >
                              <span className={cn(
                                "absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                                abEnabled && "translate-x-4",
                              )} />
                            </button>
                          </div>

                          {abEnabled && (
                            <div className="space-y-2 pt-1 border-t border-white/[0.06]">
                              <div className="flex items-center gap-1.5">
                                <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-blue-500/20 text-[9px] font-bold text-blue-300">B</span>
                                <p className="text-[10px] text-blue-300/80 uppercase tracking-widest">Variant B — edit what you want to test differently</p>
                              </div>
                              <div>
                                <label className="text-[10px] text-muted-foreground/70">System Prompt</label>
                                <textarea
                                  value={variantBSys}
                                  onChange={e => setVariantBSys(e.target.value)}
                                  rows={4}
                                  placeholder="System prompt for Variant B…"
                                  className="mt-1 w-full bg-transparent border border-blue-500/20 rounded-lg px-3 py-2 text-xs font-mono leading-relaxed resize-y outline-none focus:border-blue-500/40"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] text-muted-foreground/70">User Prompt Template</label>
                                <textarea
                                  value={variantBUser}
                                  onChange={e => setVariantBUser(e.target.value)}
                                  rows={4}
                                  placeholder="User prompt template for Variant B…"
                                  className="mt-1 w-full bg-transparent border border-blue-500/20 rounded-lg px-3 py-2 text-xs font-mono leading-relaxed resize-y outline-none focus:border-blue-500/40"
                                />
                              </div>
                            </div>
                          )}
                        </div>

                        <button
                          onClick={handleTest}
                          disabled={isRunning || isRunningChain}
                          className="w-full flex items-center justify-center gap-2 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/20 text-emerald-300 py-2 text-xs font-medium transition-colors disabled:opacity-50"
                        >
                          {isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : abEnabled ? <Columns2 className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                          {isRunning ? (abEnabled ? "Running comparison…" : "Running…") : abEnabled ? "Run Side-by-Side Comparison" : "Run Generation"}
                        </button>

                        {/* Chain runner — only shown when chain steps exist */}
                        {editState.chainSteps.length > 0 && (
                          <div className="rounded-lg border border-violet-500/20 bg-violet-500/[0.05] p-2.5 space-y-2">
                            <div className="flex items-center gap-2">
                              <Link2 className="h-3 w-3 text-violet-400 shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Chain Pipeline</p>
                                <p className="text-[10px] text-muted-foreground/50 mt-0.5">
                                  {editState.chainSteps.filter(s => s.templateId).length} of {editState.chainSteps.length} step{editState.chainSteps.length !== 1 ? "s" : ""} configured
                                </p>
                              </div>
                              <button
                                onClick={() => setCenterTab("chain")}
                                className="text-[10px] text-violet-400/70 hover:text-violet-300 transition-colors"
                              >
                                Edit
                              </button>
                            </div>
                            <button
                              onClick={handleRunChain}
                              disabled={isRunning || isRunningChain || editState.chainSteps.filter(s => s.templateId).length === 0}
                              className="w-full flex items-center justify-center gap-2 rounded-lg bg-violet-500/15 hover:bg-violet-500/25 text-violet-300 py-2 text-xs font-medium transition-colors disabled:opacity-50"
                            >
                              {isRunningChain
                                ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Running chain…</>
                                : <><Zap className="h-3.5 w-3.5" /> Run Chain ({editState.chainSteps.length} steps)</>
                              }
                            </button>
                          </div>
                        )}

                        {/* Chain output — per-step expandable results */}
                        {chainOutput && (
                          <div className="space-y-2">
                            {chainOutput.error ? (
                              <div className="rounded-lg border border-red-500/30 bg-red-500/[0.08] p-3">
                                <p className="text-xs text-red-300">{chainOutput.error}</p>
                              </div>
                            ) : (
                              <>
                                <div className="flex items-center gap-2">
                                  <ListOrdered className="h-3 w-3 text-violet-400" />
                                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Chain Results</p>
                                  {chainOutput.totalCostUsd != null && (
                                    <span className="ml-auto text-[9px] text-muted-foreground/50">${chainOutput.totalCostUsd.toFixed(5)} total</span>
                                  )}
                                </div>

                                {/* Per-step cards */}
                                {(chainOutput.steps ?? []).map((step: any) => {
                                  const isExpanded = expandedChainStep === step.stepOrder;
                                  const hasError   = !!step.error;
                                  return (
                                    <div
                                      key={step.stepOrder}
                                      className={cn(
                                        "rounded-lg border overflow-hidden",
                                        hasError
                                          ? "border-red-500/20 bg-red-500/[0.04]"
                                          : "border-violet-500/15 bg-violet-500/[0.04]",
                                      )}
                                    >
                                      {/* Step header — click to expand/collapse */}
                                      <button
                                        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/[0.02] transition-colors"
                                        onClick={() => setExpandedChainStep(isExpanded ? null : step.stepOrder)}
                                      >
                                        <span className="h-4 w-4 rounded-full bg-violet-500/20 text-violet-300 text-[9px] font-bold flex items-center justify-center shrink-0">
                                          {step.stepOrder}
                                        </span>
                                        <span className="flex-1 text-[11px] font-medium text-foreground truncate">{step.stepLabel || `Step ${step.stepOrder}`}</span>
                                        <span className="text-[10px] text-muted-foreground/60 shrink-0">{step.templateName}</span>
                                        {!hasError && (
                                          <span className={cn("text-xs font-bold shrink-0 ml-1", scoreColor(step.scores?.overall ?? 0))}>
                                            {(step.scores?.overall ?? 0).toFixed(1)}
                                          </span>
                                        )}
                                        {isExpanded
                                          ? <ChevronUp className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                                          : <ChevronDown className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                                        }
                                      </button>

                                      {/* Expanded step content */}
                                      {isExpanded && (
                                        <div className="border-t border-white/[0.04] px-3 py-2 space-y-2">
                                          {hasError ? (
                                            <p className="text-xs text-red-300">{step.error}</p>
                                          ) : (
                                            <>
                                              {/* Score bars */}
                                              <div className="space-y-1">
                                                {Object.entries(SCORE_LABELS).map(([key, slabel]) => {
                                                  const val = step.scores?.[key] ?? 0;
                                                  return (
                                                    <div key={key}>
                                                      <div className="flex items-center justify-between mb-0.5">
                                                        <span className="text-[9px] text-muted-foreground">{slabel}</span>
                                                        <span className={cn("text-[9px] font-medium", scoreColor(val))}>{val}/10</span>
                                                      </div>
                                                      <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
                                                        <div className={cn("h-full rounded-full", scoreBg(val))} style={{ width: `${val * 10}%` }} />
                                                      </div>
                                                    </div>
                                                  );
                                                })}
                                              </div>

                                              {/* Output text */}
                                              <div>
                                                <div className="flex items-center justify-between mb-1">
                                                  <p className="text-[9px] text-muted-foreground uppercase tracking-widest">Output</p>
                                                  <span className="text-[9px] text-muted-foreground/50">{step.provider ?? "—"}/{step.model ?? "—"}</span>
                                                </div>
                                                <div className="rounded border border-white/[0.06] bg-black/20 p-2 max-h-40 overflow-y-auto">
                                                  <p className="text-[10px] text-foreground/80 whitespace-pre-wrap leading-relaxed">{step.outputText}</p>
                                                </div>
                                                {step.costUsd != null && (
                                                  <p className="text-[9px] text-muted-foreground/40 mt-0.5">${step.costUsd.toFixed(5)}</p>
                                                )}
                                              </div>
                                            </>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}

                                {/* Final output summary */}
                                {chainOutput.finalOutput && (
                                  <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] p-2.5">
                                    <p className="text-[10px] text-emerald-400/70 uppercase tracking-widest font-medium mb-1.5">Final Output</p>
                                    <div className="rounded border border-white/[0.06] bg-black/20 p-2 max-h-48 overflow-y-auto">
                                      <p className="text-xs text-foreground/80 whitespace-pre-wrap leading-relaxed">{chainOutput.finalOutput}</p>
                                    </div>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        )}

                        {/* Winner set confirmation */}
                        {winnerSet && !testOutput && (
                          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/[0.08] p-3 flex items-start gap-2">
                            <Trophy className="h-3.5 w-3.5 text-yellow-400 shrink-0 mt-0.5" />
                            <div>
                              <p className="text-xs font-medium text-emerald-300">
                                Variant {winnerSet} saved as new template version
                              </p>
                              <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                                {winnerSet === "B" ? "The editor now reflects the winning prompts." : "Template A kept unchanged."}
                              </p>
                            </div>
                          </div>
                        )}

                        {/* Test output */}
                        {testOutput && (
                          <div className="space-y-3">
                            {testOutput.error ? (
                              <div className="rounded-lg border border-red-500/30 bg-red-500/[0.08] p-3">
                                <p className="text-xs text-red-300">{testOutput.error}</p>
                              </div>
                            ) : testOutput.variantB ? (
                              /* ── Side-by-side comparison layout ── */
                              <div className="space-y-3">
                                <div className="flex items-center gap-2">
                                  <Columns2 className="h-3 w-3 text-muted-foreground" />
                                  <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Side-by-Side Results</p>
                                  {!isReadOnly && (
                                    <span className="ml-auto text-[10px] text-muted-foreground/50">Pick the winner →</span>
                                  )}
                                </div>

                                {/* Score comparison header */}
                                <div className="grid grid-cols-2 gap-2">
                                  {([
                                    { label: "A", data: testOutput, accent: "emerald", isWinner: testOutput.scores?.overall >= testOutput.variantB.scores?.overall },
                                    { label: "B", data: testOutput.variantB, accent: "blue", isWinner: testOutput.variantB.scores?.overall > testOutput.scores?.overall },
                                  ] as const).map(({ label, data: vd, accent, isWinner }) => (
                                    <div key={label} className={cn(
                                      "rounded-lg border p-2 space-y-2",
                                      accent === "emerald" ? "border-emerald-500/20 bg-emerald-500/[0.04]" : "border-blue-500/20 bg-blue-500/[0.04]",
                                    )}>
                                      {/* Variant header */}
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-1.5">
                                          <span className={cn(
                                            "inline-flex items-center justify-center h-4 w-4 rounded-full text-[9px] font-bold",
                                            accent === "emerald" ? "bg-emerald-500/20 text-emerald-300" : "bg-blue-500/20 text-blue-300",
                                          )}>{label}</span>
                                          <span className={cn("text-[10px] font-semibold uppercase tracking-widest", accent === "emerald" ? "text-emerald-300" : "text-blue-300")}>
                                            {label === "A" ? "Template" : "Variant B"}
                                          </span>
                                          {isWinner && (
                                            <Trophy className="h-3 w-3 text-yellow-400" />
                                          )}
                                        </div>
                                        <span className={cn("text-sm font-bold", scoreColor(vd.scores?.overall ?? 0))}>
                                          {vd.scores?.overall?.toFixed(1) ?? "—"}/10
                                        </span>
                                      </div>

                                      {/* Score bars */}
                                      <div className="space-y-1">
                                        {Object.entries(SCORE_LABELS).map(([key, slabel]) => {
                                          const val  = vd.scores?.[key] ?? 0;
                                          const otherVal = label === "A"
                                            ? testOutput.variantB?.scores?.[key] ?? 0
                                            : testOutput.scores?.[key] ?? 0;
                                          const better = val > otherVal;
                                          const equal  = val === otherVal;
                                          return (
                                            <div key={key}>
                                              <div className="flex items-center justify-between mb-0.5">
                                                <span className="text-[9px] text-muted-foreground">{slabel}</span>
                                                <span className={cn("text-[9px] font-medium flex items-center gap-0.5", scoreColor(val))}>
                                                  {val}/10
                                                  {!equal && <span className={better ? "text-emerald-400" : "text-red-400"}>{better ? "▲" : "▼"}</span>}
                                                </span>
                                              </div>
                                              <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
                                                <div className={cn("h-full rounded-full transition-all", scoreBg(val))} style={{ width: `${val * 10}%` }} />
                                              </div>
                                            </div>
                                          );
                                        })}
                                      </div>

                                      {/* Output text */}
                                      <div>
                                        <div className="flex items-center justify-between mb-1">
                                          <p className="text-[9px] text-muted-foreground uppercase tracking-widest">Output</p>
                                          <span className="text-[9px] text-muted-foreground/50">{vd.provider ?? "—"}/{vd.model ?? "—"}</span>
                                        </div>
                                        <div className="rounded border border-white/[0.06] bg-black/20 p-2 max-h-40 overflow-y-auto">
                                          <p className="text-[10px] text-foreground/80 whitespace-pre-wrap leading-relaxed">{vd.outputText}</p>
                                        </div>
                                        {vd.costUsd != null && (
                                          <p className="text-[9px] text-muted-foreground/50 mt-0.5">${vd.costUsd.toFixed(5)}</p>
                                        )}
                                      </div>

                                      {/* Set as winner button */}
                                      {!isReadOnly && selectedId && (
                                        <button
                                          onClick={() => handleSetAsWinner(label)}
                                          disabled={isSettingWinner}
                                          className={cn(
                                            "w-full flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[10px] font-medium transition-colors disabled:opacity-50",
                                            isWinner
                                              ? accent === "emerald"
                                                ? "bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300"
                                                : "bg-blue-500/20 hover:bg-blue-500/30 text-blue-300"
                                              : "bg-white/[0.04] hover:bg-white/[0.08] text-muted-foreground hover:text-foreground",
                                          )}
                                        >
                                          {isSettingWinner ? (
                                            <Loader2 className="h-3 w-3 animate-spin" />
                                          ) : (
                                            <Trophy className="h-3 w-3" />
                                          )}
                                          Set Variant {label} as Winner
                                        </button>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : (
                              /* ── Single variant output (no compare mode) ── */
                              <div className="space-y-2">
                                <div>
                                  <div className="flex items-center justify-between mb-2">
                                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Scores</p>
                                    <span className={cn("text-sm font-bold", scoreColor(testOutput.scores?.overall ?? 0))}>
                                      {testOutput.scores?.overall?.toFixed(1) ?? "—"}/10
                                    </span>
                                  </div>
                                  <div className="space-y-1.5">
                                    {Object.entries(SCORE_LABELS).map(([key, slabel]) => {
                                      const val = testOutput.scores?.[key] ?? 0;
                                      return (
                                        <div key={key}>
                                          <div className="flex items-center justify-between mb-0.5">
                                            <span className="text-[10px] text-muted-foreground">{slabel}</span>
                                            <span className={cn("text-[10px] font-medium", scoreColor(val))}>{val}/10</span>
                                          </div>
                                          <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
                                            <div className={cn("h-full rounded-full transition-all", scoreBg(val))} style={{ width: `${val * 10}%` }} />
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                                <div>
                                  <div className="flex items-center justify-between mb-1">
                                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Output</p>
                                    <span className="text-[10px] text-muted-foreground/50">{testOutput.provider}/{testOutput.model}</span>
                                  </div>
                                  <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 max-h-48 overflow-y-auto">
                                    <p className="text-xs text-foreground/80 whitespace-pre-wrap leading-relaxed">{testOutput.outputText}</p>
                                  </div>
                                  {testOutput.costUsd != null && (
                                    <p className="text-[10px] text-muted-foreground/50 mt-1">${testOutput.costUsd.toFixed(5)} generation cost</p>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* ── Preview tab ── */}
                {rightTab === "preview" && (
                  <div className="p-3 space-y-3">
                    {!selectedId ? (
                      <p className="text-xs text-muted-foreground text-center py-6">Select a template to see a live preview</p>
                    ) : (
                      <>
                        <div className="flex items-center gap-1.5">
                          <Eye className="h-3 w-3 text-emerald-400" />
                          <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Live Preview</p>
                          <span className="ml-auto text-[9px] text-muted-foreground/50">Variables resolved from test inputs</span>
                        </div>

                        {editState.variables.length > 0 && (
                          <div className="space-y-1.5">
                            <p className="text-[10px] text-muted-foreground/70">Substituting {editState.variables.length} variable{editState.variables.length !== 1 ? "s" : ""} — edit values in the Test tab</p>
                            <div className="flex flex-wrap gap-1">
                              {editState.variables.map(v => (
                                <span key={v.name} className={cn(
                                  "text-[9px] font-mono px-1.5 py-0.5 rounded-full",
                                  testInputs[v.name]
                                    ? "bg-emerald-500/15 text-emerald-300"
                                    : "bg-white/[0.06] text-muted-foreground/60"
                                )}>
                                  {`{{${v.name}}}`} = {testInputs[v.name] ? `"${testInputs[v.name].slice(0, 12)}${testInputs[v.name].length > 12 ? "…" : ""}"` : "empty"}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="space-y-2">
                          <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-2.5">
                            <p className="text-[9px] text-emerald-400/60 uppercase tracking-widest font-medium mb-1.5">System Prompt</p>
                            <p className="text-[11px] text-foreground/80 whitespace-pre-wrap leading-relaxed font-mono">
                              {livePreviewSystem || <span className="text-muted-foreground/50 italic">No system prompt</span>}
                            </p>
                          </div>

                          <div className="rounded-lg border border-white/[0.06] bg-white/[0.015] p-2.5">
                            <p className="text-[9px] text-blue-400/60 uppercase tracking-widest font-medium mb-1.5">User Prompt</p>
                            <p className="text-[11px] text-foreground/80 whitespace-pre-wrap leading-relaxed font-mono">
                              {livePreviewUser || <span className="text-muted-foreground/50 italic">No user prompt template</span>}
                            </p>
                          </div>
                        </div>

                        {editState.systemPrompt.includes("{{") || editState.userPromptTemplate.includes("{{") ? (
                          <p className="text-[9px] text-muted-foreground/40 text-center">
                            Unresolved variables shown as <code className="text-orange-400/60">[name]</code>
                          </p>
                        ) : null}
                      </>
                    )}
                  </div>
                )}

                {/* ── Versions tab ── */}
                {rightTab === "versions" && (
                  <div className="p-3 space-y-2">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Version History</p>
                    {!selectedId ? (
                      <p className="text-xs text-muted-foreground text-center py-6">Select a template to view its history</p>
                    ) : versions.length === 0 ? (
                      <p className="text-xs text-muted-foreground/50 py-4 text-center">No versions saved yet. Save the template to create version 1.</p>
                    ) : (
                      versions.map((v, i) => (
                        <div key={v.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-medium text-foreground">v{v.version}</span>
                                {i === 0 && <span className="text-[9px] text-emerald-400 bg-emerald-500/15 px-1.5 py-0.5 rounded-full">Latest</span>}
                              </div>
                              <p className="text-[10px] text-muted-foreground mt-0.5">
                                {new Date(v.createdAt).toLocaleString()}
                              </p>
                              {v.changeNote && <p className="text-[10px] text-muted-foreground/70 mt-0.5 italic">{v.changeNote}</p>}
                            </div>
                            {i > 0 && !isReadOnly && (
                              <button
                                onClick={() => handleRestoreVersion(v.id)}
                                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-emerald-400 transition-colors"
                              >
                                <RotateCcw className="h-2.5 w-2.5" />
                                Restore
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {/* ── Stats tab ── */}
                {rightTab === "stats" && (
                  <div className="p-3 space-y-4">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Performance</p>
                    {!selectedTemplate?.stats || selectedTemplate.stats.usageCount === 0 ? (
                      <div className="text-center py-6">
                        <BarChart2 className="h-6 w-6 text-muted-foreground/30 mx-auto mb-2" />
                        <p className="text-xs text-muted-foreground">No test data yet.</p>
                        <p className="text-[11px] text-muted-foreground/60 mt-1">Run the prompt to generate performance stats.</p>
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            { label: "Total Runs",    value: selectedTemplate.stats.usageCount?.toString() ?? "0" },
                            { label: "Avg Score",     value: selectedTemplate.stats.avgScore != null ? `${selectedTemplate.stats.avgScore}/10` : "—" },
                            { label: "Success Rate",  value: selectedTemplate.stats.successRate != null ? `${selectedTemplate.stats.successRate}%` : "—" },
                            { label: "Last Run",      value: selectedTemplate.stats.lastUsedAt ? new Date(selectedTemplate.stats.lastUsedAt).toLocaleDateString() : "—" },
                          ].map(stat => (
                            <div key={stat.label} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
                              <p className="text-[10px] text-muted-foreground">{stat.label}</p>
                              <p className="text-sm font-semibold mt-0.5">{stat.value}</p>
                            </div>
                          ))}
                        </div>

                        {selectedTemplate.stats.avgScore != null && (
                          <div>
                            <p className="text-[10px] text-muted-foreground mb-2">Average Score</p>
                            <div className="flex items-center gap-3">
                              <div className="flex-1 h-2 rounded-full bg-white/[0.06] overflow-hidden">
                                <div
                                  className={cn("h-full rounded-full transition-all", scoreBg(selectedTemplate.stats.avgScore))}
                                  style={{ width: `${selectedTemplate.stats.avgScore * 10}%` }}
                                />
                              </div>
                              <span className={cn("text-sm font-bold", scoreColor(selectedTemplate.stats.avgScore))}>
                                {selectedTemplate.stats.avgScore.toFixed(1)}
                              </span>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

              </div>
            </aside>
          </div>
        )}
      </div>
    </GrowthMindShell>
  );
}
