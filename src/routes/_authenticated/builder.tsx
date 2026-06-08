import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Builder } from "@/components/builder/Builder";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { BookmarkPlus, Check, CircleDot, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { useBuilderStore } from "@/lib/builder/store";
import { SaveAsTemplateDialog } from "@/components/builder/SaveAsTemplateDialog";
import { upsertMyAgent } from "@/lib/agents/agents.functions";
import { cn } from "@/lib/utils";
import { OnboardingTour } from "@/components/onboarding/OnboardingTour";

export const Route = createFileRoute("/_authenticated/builder")({
  validateSearch: (search: Record<string, unknown>) => ({
    new: search.new === "1" || search.new === 1 ? ("1" as const) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Builder — Webee" },
      {
        name: "description",
        content: "Full-screen Webespoke AI script flow builder with JSON import and export.",
      },
    ],
  }),
  component: BuilderPage,
});

function formatRelative(ts: number | null): string {
  if (!ts) return "Not saved";
  const diff = Math.max(0, Date.now() - ts);
  const s = Math.floor(diff / 1000);
  if (s < 5) return "Just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function BuilderPage() {
  const { new: newAgent } = Route.useSearch();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (newAgent === "1") {
      useBuilderStore.getState().clearAll();
    }
  }, [newAgent]);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [, force] = useState(0);
  const saveAgent = useServerFn(upsertMyAgent);
  const currentAgentRowId = useBuilderStore((s) => s.currentAgentRowId);

  async function handleSave() {
    const s = useBuilderStore.getState();
    setSaving(true);
    try {
      const { id } = await saveAgent({
        data: {
          id: s.currentAgentRowId ?? undefined,
          retellAgentId: (s.settings as { agentId?: string }).agentId ?? null,
          name: s.settings.agentName || "Untitled agent",
          flowData: { nodes: s.nodes, edges: s.edges } as never,
          settings: s.settings as never,
          variables: s.variables as never,
          costSeconds: s.testCallTotalSec,
        },
      });
      if (!s.currentAgentRowId) s.setCurrentAgentRowId(id);
      setLastSavedAt(Date.now());
      toast.success("Agent saved", { description: s.settings.agentName });
    } catch (e) {
      toast.error("Save failed", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "s" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (!saving) handleSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saving]);

  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  const status = currentAgentRowId ? "Saved" : "Draft";
  const statusTone = currentAgentRowId ? "text-emerald-400" : "text-amber-400";

  const leading = (
    <div className="flex items-center gap-2 pl-1">
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full border border-white/[0.06] bg-white/[0.03] px-1.5 py-0.5 text-[10px] font-medium",
          statusTone,
        )}
      >
        <CircleDot className="h-2.5 w-2.5" />
        {status}
      </span>
      <span className="hidden items-center gap-1 text-[10px] text-muted-foreground md:inline-flex">
        {saving ? (
          <>
            <Loader2 className="h-3 w-3 animate-spin" />
            Saving…
          </>
        ) : (
          <>
            <Check className="h-3 w-3 opacity-60" />
            {formatRelative(lastSavedAt)}
          </>
        )}
      </span>
    </div>
  );

  const trailing = (
    <div className="flex items-center gap-0.5 rounded-md border border-white/[0.05] bg-white/[0.02] px-1 py-0.5">
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setSaveTemplateOpen(true)}
        title="Save as template"
        className="!h-8 !w-8 !p-0 text-muted-foreground/60 hover:text-foreground"
      >
        <BookmarkPlus />
      </Button>
      <div className="h-3.5 w-px bg-white/[0.07] mx-0.5" />
      <Button
        size="sm"
        variant="ghost"
        onClick={handleSave}
        disabled={saving}
        title="Save agent (⌘S)"
        className="!h-8 gap-1 px-2.5 text-[11px] font-medium text-muted-foreground/70 hover:text-foreground hover:bg-white/[0.06]"
      >
        {saving ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Save className="h-3 w-3" />
        )}
        Save
      </Button>
    </div>
  );

  return (
    <div className="flex h-screen flex-col bg-background">
      <Builder
        heightClass="h-full rounded-none border-0 bg-transparent shadow-none"
        toolbarStart={<SidebarTrigger className="!h-7 !w-7 !p-0" />}
        toolbarLeading={leading}
        toolbarTrailing={trailing}
      />
      <SaveAsTemplateDialog open={saveTemplateOpen} onOpenChange={setSaveTemplateOpen} />
      <OnboardingTour />
    </div>
  );
}
