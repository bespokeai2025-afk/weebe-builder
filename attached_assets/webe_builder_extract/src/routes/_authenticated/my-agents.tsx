import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DeployAgentDialog } from "@/components/agents/DeployAgentDialog";
import { AgentCard, type AgentCardData } from "@/components/agents/AgentCard";
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
import {
  listMyAgents,
  getMyAgent,
  deleteMyAgent,
} from "@/lib/agents/agents.functions";

export const Route = createFileRoute("/_authenticated/my-agents")({
  head: () => ({
    meta: [
      { title: "Agents — Webespoke AI" },
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
  const [deployTarget, setDeployTarget] = useState<{
    id: string;
    name: string;
    retell_agent_id: string | null;
    settings?: Record<string, unknown> | null;
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
      if (row.retell_agent_id) {
        useBuilderStore.getState().setSettings({ agentId: row.retell_agent_id });
      }
      toast.success("Agent loaded", { description: row.name });
      navigate({ to: "/builder" });
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
  const filtered = query.trim()
    ? agents.filter((a) => a.name.toLowerCase().includes(query.trim().toLowerCase()))
    : agents;

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-6xl px-6 py-10 md:py-14">
        {/* Page header */}
        <div className="bg-hero-radial mb-10 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Workspace
            </p>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground md:text-4xl">
              Agents
            </h1>
            <p className="max-w-xl text-sm text-muted-foreground">
              Voice agents you've designed, deployed, and shipped. Each card is a
              live infrastructure object — deploy, monitor, and iterate.
            </p>
          </div>
          <div className="flex items-center gap-2">
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
              <Link to="/builder">
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
          <div className="rounded-2xl bg-card/60 p-14 text-center ring-1 ring-white/[0.06]">
            <h2 className="text-lg font-semibold tracking-tight">No agents yet</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Spin up your first voice agent in the builder.
            </p>
            <Button asChild size="sm" className="mt-5">
              <Link to="/builder">
                <Plus className="h-4 w-4 mr-1" />
                Build your first agent
              </Link>
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl bg-card/60 p-10 text-center ring-1 ring-white/[0.06] text-sm text-muted-foreground">
            No agents match "{query}".
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
                  })
                }
                onDelete={() => setDeleteTarget({ id: a.id, name: a.name })}
              />
            ))}
          </div>
        )}
      </div>

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this agent?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes <strong>{deleteTarget?.name}</strong> from your saved
              agents list. The underlying deployed agent (if any) will remain
              live — only your local copy is removed.
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
        agent={deployTarget}
      />
    </main>
  );
}
