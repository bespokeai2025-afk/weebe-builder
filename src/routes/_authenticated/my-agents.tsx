import { useState } from "react";
import { createFileRoute, Link, useNavigate, useSearch } from "@tanstack/react-router";
import { z } from "zod";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Radio, Search, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DeployAgentDialog } from "@/components/agents/DeployAgentDialog";
import { AgentCard, type AgentCardData, deriveVoiceProvider } from "@/components/agents/AgentCard";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useBuilderStore } from "@/lib/builder/store";
import type { BuilderSettings } from "@/lib/builder/types";
import { listMyAgents, getMyAgent, deleteMyAgent } from "@/lib/agents/agents.functions";

const voiceEngineSchema = z.object({
  engine: z.enum(["ALL", "RETELL", "OPENAI_REALTIME"]).optional().default("ALL"),
});

export const Route = createFileRoute("/_authenticated/my-agents")({
  validateSearch: voiceEngineSchema,
  head: () => ({
    meta: [
      { title: "Agents — Webee" },
      {
        name: "description",
        content: "Manage your saved Webespoke AI voice agents.",
      },
    ],
  }),
  component: MyAgentsPage,
});

function MyAgentsPage() {
  const navigate = useNavigate();
  const listAgents = useServerFn(listMyAgents);
  const fetchAgent = useServerFn(getMyAgent);
  const removeAgent = useServerFn(deleteMyAgent);
  const qc = useQueryClient();
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [query, setQuery] = useState("");
  const { engine: voiceFilter } = useSearch({ from: "/_authenticated/my-agents" });
  const [deployTarget, setDeployTarget] = useState<{
    id: string;
    name: string;
    retell_agent_id: string | null;
    settings?: Record<string, unknown> | null;
    voice_provider?: string | null;
    inbound_phone_number?: string | null;
  } | null>(null);

  const agentsQ = useQuery({
    queryKey: ["my-agents"],
    queryFn: () => listAgents(),
    refetchOnWindowFocus: false,
  });

  async function handleLoad(id: string) {
    setLoadingId(id);
    try {
      const row = await fetchAgent({ data: { id } });
      if (!row) throw new Error("Agent not found");
      const flow = (row.flow_data ?? {}) as { nodes?: unknown; edges?: unknown };
      const nodes = Array.isArray(flow.nodes) ? flow.nodes : [];
      const edges = Array.isArray(flow.edges) ? flow.edges : [];
      const settings = (row.settings ?? {}) as Record<string, unknown>;
      const variables = Array.isArray(row.variables) ? row.variables : [];
      useBuilderStore.getState().loadFlow({
        nodes: nodes as never,
        edges: edges as never,
        settings: settings as never,
        variables: variables as never,
        agentRowId: row.id,
      });
      // Explicitly restore voice provider fields so the builder sidebar
      // always shows the engine card that was saved, not the previous
      // session's value or the localStorage default.
      // IMPORTANT: also derive and set deploymentMode from vp so that stale
      // deploymentMode values persisted in localStorage from a previous session
      // cannot contaminate this agent.  resolveDeploymentMode() checks
      // deploymentMode FIRST, so if it's wrong the engine resolves incorrectly
      // and extractOpenAIParams throws "called on a RETELL definition".
      const rowAny = row as unknown as Record<string, unknown>;
      const vp =
        (settings.voiceProvider as BuilderSettings["voiceProvider"] | undefined) ??
        (rowAny.voice_provider as BuilderSettings["voiceProvider"] | undefined) ??
        "RETELL";
      const derivedDeploymentMode =
        vp === "OPENAI_REALTIME" ? "OPENAI_NATIVE" : "RETELL";
      useBuilderStore.getState().setSettings({
        voiceProvider: vp,
        deploymentMode: derivedDeploymentMode,
        openaiVoice:
          (settings.openaiVoice as BuilderSettings["openaiVoice"] | undefined) ?? "alloy",
        openaiReasoningEffort:
          (settings.openaiReasoningEffort as BuilderSettings["openaiReasoningEffort"] | undefined) ??
          "low",
      });
      if (row.retell_agent_id) {
        useBuilderStore.getState().setSettings({ agentId: row.retell_agent_id });
      }
      toast.success("Agent loaded", { description: row.name });
      navigate({ to: "/builder", search: { new: undefined } });
    } catch (e) {
      toast.error("Failed to load agent", { description: (e as Error).message });
    } finally {
      setLoadingId(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await removeAgent({ data: { id: deleteTarget.id } });
      toast.success("Agent deleted", { description: deleteTarget.name });
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ["my-agents"] });
    } catch (e) {
      toast.error("Delete failed", { description: (e as Error).message });
    } finally {
      setDeleting(false);
    }
  }

  const agents: AgentCardData[] = (agentsQ.data ?? []) as AgentCardData[];

  const queryMatch = (a: AgentCardData) =>
    !query.trim() || a.name.toLowerCase().includes(query.trim().toLowerCase());

  const engineCounts = {
    ALL: agents.filter(queryMatch).length,
    RETELL: agents.filter((a) => queryMatch(a) && deriveVoiceProvider(a) === "RETELL").length,
    OPENAI_REALTIME: agents.filter((a) => queryMatch(a) && deriveVoiceProvider(a) === "OPENAI_REALTIME").length,
  };

  const filtered = agents.filter((a) => {
    if (!queryMatch(a)) return false;
    if (voiceFilter !== "ALL" && deriveVoiceProvider(a) !== voiceFilter) return false;
    return true;
  });

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-7xl px-6 py-5 md:py-7">
        {/* Page header */}
        <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-base font-semibold tracking-tight text-foreground">Agents</h1>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Voice agents you've designed, deployed, and shipped.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Voice engine filter */}
            <div className="flex items-center rounded-lg bg-white/[0.03] p-0.5 ring-1 ring-white/[0.06]">
              {(
                [
                  { value: "ALL", label: "All" },
                  { value: "RETELL", label: "OmniVoice", icon: <Radio className="h-3 w-3 text-sky-400" /> },
                  { value: "OPENAI_REALTIME", label: "HyperStream", icon: <Zap className="h-3 w-3 text-violet-400" /> },
                ] as const
              ).map(({ value, label, icon }) => (
                <button
                  key={value}
                  onClick={() =>
                    navigate({
                      to: "/my-agents",
                      search: { engine: value === "ALL" ? undefined : value },
                      replace: true,
                    })
                  }
                  className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium transition-all ${
                    voiceFilter === value
                      ? "bg-white/[0.08] text-foreground shadow-sm ring-1 ring-white/[0.10]"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {icon}
                  {label}
                  {value !== "ALL" && (
                    <span className={`rounded px-1 py-px text-[10px] font-semibold tabular-nums leading-none ${
                      voiceFilter === value
                        ? "bg-white/[0.10] text-foreground"
                        : "bg-white/[0.05] text-muted-foreground"
                    }`}>
                      {engineCounts[value]}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search agents…"
                className="h-9 w-56 border-white/[0.06] bg-white/[0.02] pl-8 text-sm"
              />
            </div>
            <Button asChild size="sm" className="h-9 gap-1.5">
              <Link to="/agents/new">
                <Plus className="h-4 w-4" />
                New agent
              </Link>
            </Button>
          </div>
        </div>

        {agentsQ.isLoading ? (
          <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading your agents…
          </div>
        ) : agents.length === 0 ? (
          <div className="rounded-xl bg-card/60 p-8 text-center ring-1 ring-white/[0.06]">
            <h2 className="text-lg font-semibold tracking-tight">No agents yet</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Spin up your first voice agent in the builder.
            </p>
            <Button asChild size="sm" className="mt-5">
              <Link to="/agents/new">
                <Plus className="h-4 w-4 mr-1" />
                Build your first agent
              </Link>
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl bg-card/60 p-10 text-center ring-1 ring-white/[0.06] text-sm text-muted-foreground">
            {query.trim() && voiceFilter !== "ALL"
              ? `No ${voiceFilter === "OPENAI_REALTIME" ? "HyperStream" : "OmniVoice"} agents match "${query}".`
              : query.trim()
              ? `No agents match "${query}".`
              : `No ${voiceFilter === "OPENAI_REALTIME" ? "HyperStream" : "OmniVoice"} agents yet.`}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {filtered.map((a) => (
              <AgentCard
                key={a.id}
                agent={a}
                loading={loadingId === a.id}
                onOpen={handleLoad}
                onDeploy={() =>
                  setDeployTarget({
                    id: a.id,
                    name: a.name,
                    retell_agent_id: a.retell_agent_id,
                    settings: a.settings,
                    inbound_phone_number: (a as any).inbound_phone_number ?? null,
                  })
                }
                onDelete={() => setDeleteTarget({ id: a.id, name: a.name })}
              />
            ))}
          </div>
        )}
      </div>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this agent?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes <strong>{deleteTarget?.name}</strong> from your saved agents list. The
              underlying deployed agent (if any) will remain live — only your local copy is removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                confirmDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <DeployAgentDialog
        open={Boolean(deployTarget)}
        onOpenChange={(o) => !o && setDeployTarget(null)}
        agent={
          deployTarget
            ? ((agentsQ.data?.find((a) => a.id === deployTarget.id) as typeof deployTarget) ??
              deployTarget)
            : null
        }
      />
    </main>
  );
}
