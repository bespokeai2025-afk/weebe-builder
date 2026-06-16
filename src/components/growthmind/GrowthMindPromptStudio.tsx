import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Sparkles, Plus, Save, Trash2, Copy, Play, Clock, BarChart2,
  Star, StarOff, ChevronRight, Search, X, FlaskConical, Tag, Wand2,
  RotateCcw, CheckCircle2, AlertCircle, Loader2, Info, Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GrowthMindShell } from "./GrowthMindShell";
import {
  getPromptTemplates, savePromptTemplate, deletePromptTemplate,
  testPromptTemplate, seedLibraryPacks, restorePromptVersion, togglePromptFavorite, getPromptTemplate,
  getWorkspaceContext,
  type PromptTemplate, type PromptVariable, type PromptVersion,
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
  template, isSelected, onSelect, onFavorite,
}: {
  template: PromptTemplate;
  isSelected: boolean;
  onSelect: () => void;
  onFavorite: (val: boolean) => void;
}) {
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
          </div>
        </div>
        <button
          onClick={e => { e.stopPropagation(); onFavorite(!template.isFavorite); }}
          className={cn("opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5", template.isFavorite && "opacity-100")}
        >
          {template.isFavorite
            ? <Star className="h-3 w-3 text-yellow-400 fill-yellow-400" />
            : <StarOff className="h-3 w-3 text-muted-foreground" />
          }
        </button>
      </div>

      {template.stats && (
        <div className="flex items-center gap-2 mt-1.5">
          <StarRating score={template.stats.avgScore} />
          {template.stats.usageCount > 0 && (
            <span className="text-[10px] text-muted-foreground/60">{template.stats.usageCount} run{template.stats.usageCount !== 1 ? "s" : ""}</span>
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

  // State
  const [selectedId,  setSelectedId]  = useState<string | null>(null);
  const [editState,   setEditState]   = useState({ ...DEFAULT_EDIT });
  const [isDirty,     setIsDirty]     = useState(false);
  const [isSaving,    setIsSaving]    = useState(false);
  const [isDeleting,  setIsDeleting]  = useState(false);
  const [rightTab,    setRightTab]    = useState<"test" | "preview" | "versions" | "stats">("test");
  const [libTab,      setLibTab]      = useState<"library" | "custom">("library");
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter,  setTypeFilter]  = useState("all");
  const [testInputs,  setTestInputs]  = useState<Record<string, string>>({});
  const [testOutput,  setTestOutput]  = useState<any>(null);
  const [isRunning,   setIsRunning]   = useState(false);
  const [versions,    setVersions]    = useState<PromptVersion[]>([]);
  const [seedDone,    setSeedDone]    = useState(false);
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
    setVersions([]);

    // Load versions
    try {
      const res = await getTemplateFn({ data: { id: template.id } });
      setVersions(res.versions);
    } catch {}
  }, []);

  const handleNewTemplate = () => {
    setSelectedId(null);
    setEditState({ ...DEFAULT_EDIT });
    setIsDirty(false);
    setTestOutput(null);
    setVersions([]);
    setLibTab("custom");
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
    try {
      const res = await saveTemplateFn({ data: {
        name:               `${editState.name} (Copy)`,
        description:        editState.description,
        type:               editState.type,
        systemPrompt:       editState.systemPrompt,
        userPromptTemplate: editState.userPromptTemplate,
        variables:          editState.variables,
        chainSteps:         editState.chainSteps,
        tags:               editState.tags,
        isFavorite:         false,
      }});
      setSelectedId(res.id);
      setEditState(s => ({ ...s, name: `${s.name} (Copy)`, category: "custom", isFavorite: false }));
      setIsDirty(false);
      await qc.invalidateQueries({ queryKey: ["prompt-templates"] });
      setLibTab("custom");
    } catch {}
    finally { setIsSaving(false); }
  };

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
      const result = await testTemplateFn({ data: { templateId: selectedId, inputVariables: testInputs }});
      setTestOutput(result);
      qc.invalidateQueries({ queryKey: ["prompt-templates"] });
    } catch (e: any) {
      setTestOutput({ error: e?.message ?? "Test failed" });
    } finally {
      setIsRunning(false);
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
          <button
            onClick={handleNewTemplate}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/20 text-emerald-300 px-3 py-1.5 text-xs font-medium transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            New Template
          </button>
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

              {/* Library / Custom tabs */}
              <div className="flex border-b border-white/[0.06]">
                {(["library", "custom"] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setLibTab(tab)}
                    className={cn(
                      "flex-1 py-2 text-xs font-medium transition-colors",
                      libTab === tab
                        ? "text-emerald-300 border-b-2 border-emerald-400"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {tab === "library" ? `Library (${templates.filter(t => t.category === "library").length})` : `My Templates (${templates.filter(t => t.category === "custom").length})`}
                  </button>
                ))}
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
                    <FlaskConical className="h-6 w-6 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground">
                      {libTab === "custom" ? "No custom templates yet." : "No library templates found."}
                    </p>
                    {libTab === "custom" && (
                      <button onClick={handleNewTemplate} className="mt-2 text-xs text-emerald-400 hover:text-emerald-300">Create one</button>
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
                    <p className="text-xs text-muted-foreground mt-1">Choose from the library or create a new template</p>
                  </div>
                  <button
                    onClick={handleNewTemplate}
                    className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.08] hover:bg-emerald-500/15 text-emerald-300 px-4 py-2 text-sm transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                    New Template
                  </button>
                </div>
              ) : (
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
                    <textarea
                      value={editState.systemPrompt}
                      onChange={e => { setEditState(s => ({ ...s, systemPrompt: e.target.value })); setIsDirty(true); }}
                      disabled={isReadOnly}
                      rows={8}
                      className="mt-1 w-full bg-transparent border border-white/[0.08] rounded-lg px-3 py-2 text-xs font-mono resize-y outline-none focus:border-emerald-500/40 disabled:opacity-60 leading-relaxed"
                      placeholder="Define the AI persona, context, and instructions here..."
                    />
                  </div>

                  {/* User Prompt Template */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[10px] text-muted-foreground uppercase tracking-widest">User Prompt Template</label>
                      <span className="text-[10px] text-muted-foreground/50">Use <code className="text-emerald-400/70">{"{{variable_name}}"}</code> for dynamic values</span>
                    </div>
                    <textarea
                      value={editState.userPromptTemplate}
                      onChange={e => { setEditState(s => ({ ...s, userPromptTemplate: e.target.value })); setIsDirty(true); }}
                      disabled={isReadOnly}
                      rows={10}
                      className="w-full bg-transparent border border-white/[0.08] rounded-lg px-3 py-2 text-xs font-mono resize-y outline-none focus:border-emerald-500/40 disabled:opacity-60 leading-relaxed"
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
            </div>

            {/* ── Right panel: Test / Versions / Stats ──────────────────── */}
            <aside className="w-80 shrink-0 border-l border-white/[0.06] flex flex-col min-h-0">
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

                        <button
                          onClick={handleTest}
                          disabled={isRunning}
                          className="w-full flex items-center justify-center gap-2 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/20 text-emerald-300 py-2 text-xs font-medium transition-colors disabled:opacity-50"
                        >
                          {isRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                          {isRunning ? "Running…" : "Run Generation"}
                        </button>

                        {/* Test output */}
                        {testOutput && (
                          <div className="space-y-3">
                            {testOutput.error ? (
                              <div className="rounded-lg border border-red-500/30 bg-red-500/[0.08] p-3">
                                <p className="text-xs text-red-300">{testOutput.error}</p>
                              </div>
                            ) : (
                              <>
                                {/* Score cards */}
                                <div>
                                  <div className="flex items-center justify-between mb-2">
                                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Scores</p>
                                    <span className={cn("text-sm font-bold", scoreColor(testOutput.scores?.overall ?? 0))}>
                                      {testOutput.scores?.overall?.toFixed(1) ?? "—"}/10
                                    </span>
                                  </div>
                                  <div className="space-y-1.5">
                                    {Object.entries(SCORE_LABELS).map(([key, label]) => {
                                      const val = testOutput.scores?.[key] ?? 0;
                                      return (
                                        <div key={key}>
                                          <div className="flex items-center justify-between mb-0.5">
                                            <span className="text-[10px] text-muted-foreground">{label}</span>
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

                                {/* Output text */}
                                <div>
                                  <div className="flex items-center justify-between mb-1">
                                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Output</p>
                                    <span className="text-[10px] text-muted-foreground/50">{testOutput.provider}/{testOutput.model}</span>
                                  </div>
                                  <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 max-h-60 overflow-y-auto">
                                    <p className="text-xs text-foreground/80 whitespace-pre-wrap leading-relaxed">{testOutput.outputText}</p>
                                  </div>
                                  {testOutput.costUsd != null && (
                                    <p className="text-[10px] text-muted-foreground/50 mt-1">${testOutput.costUsd.toFixed(5)} generation cost</p>
                                  )}
                                </div>
                              </>
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
