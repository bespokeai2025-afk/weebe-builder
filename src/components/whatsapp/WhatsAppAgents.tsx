import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Bot, Pencil, MessageSquare, GitBranch, Clock, Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { listWAAgents } from "@/lib/dashboard/whatsapp.functions";
import { getMyAgent } from "@/lib/agents/agents.functions";
import { useBuilderStore } from "@/lib/builder/store";
import type { BuilderSettings } from "@/lib/builder/types";
import { toast } from "sonner";

export function WhatsAppAgents() {
  const navigate    = useNavigate();
  const listFn      = useServerFn(listWAAgents);
  const fetchAgent  = useServerFn(getMyAgent);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const { data: agents = [], isLoading } = useQuery({
    queryKey: ["wa-agents"],
    queryFn:  () => listFn(),
    refetchOnWindowFocus: false,
  });

  async function openInBuilder(id: string) {
    setLoadingId(id);
    try {
      const row = await fetchAgent({ data: { id } });
      if (!row) throw new Error("Agent not found");
      const flow      = (row.flow_data ?? {}) as { nodes?: unknown; edges?: unknown };
      const nodes     = Array.isArray(flow.nodes) ? flow.nodes : [];
      const edges     = Array.isArray(flow.edges) ? flow.edges : [];
      const settings  = (row.settings ?? {}) as Record<string, unknown>;
      const variables = Array.isArray(row.variables) ? row.variables : [];

      useBuilderStore.getState().loadFlow({
        nodes:      nodes as never,
        edges:      edges as never,
        settings:   settings as never,
        variables:  variables as never,
        agentRowId: row.id,
      });

      const vp =
        (settings.voiceProvider as BuilderSettings["voiceProvider"] | undefined) ??
        "RETELL";
      useBuilderStore.getState().setSettings({
        voiceProvider:     vp,
        deploymentMode:    vp === "OPENAI_REALTIME" ? "OPENAI_NATIVE" : "RETELL",
        openaiVoice:          (settings.openaiVoice          as BuilderSettings["openaiVoice"]          | undefined) ?? "alloy",
        openaiReasoningEffort:(settings.openaiReasoningEffort as BuilderSettings["openaiReasoningEffort"]| undefined) ?? "low",
      });
      if (row.retell_agent_id) {
        useBuilderStore.getState().setSettings({ agentId: row.retell_agent_id });
      }

      navigate({ to: "/builder", search: { new: undefined } });
    } catch (e) {
      toast.error("Failed to open agent", { description: (e as Error).message });
    } finally {
      setLoadingId(null);
    }
  }

  function nodeCount(agent: any): number {
    try {
      const fd = typeof agent.flow_data === "string"
        ? JSON.parse(agent.flow_data)
        : (agent.flow_data ?? {});
      return (fd.nodes ?? []).length;
    } catch { return 0; }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Builder flows configured for WhatsApp. When a contact messages your Twilio number the
          matching agent replies automatically using GPT-4o mini.
        </p>
        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => {
            useBuilderStore.getState().resetFlow();
            useBuilderStore.getState().setSettings({ channelType: "whatsapp" });
            navigate({ to: "/builder", search: { new: true } });
          }}
        >
          <Plus className="h-3.5 w-3.5" /> New WA Agent
        </Button>
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
      ) : (agents as any[]).length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
          <Bot className="h-10 w-10 opacity-30" />
          <p className="text-sm font-medium">No WhatsApp agents yet</p>
          <p className="text-xs text-center max-w-xs">
            Open the Builder, switch the channel toggle to <strong>WhatsApp</strong>, build your
            flow and save — it will appear here automatically.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-2 gap-1.5"
            onClick={() => {
              useBuilderStore.getState().resetFlow();
              useBuilderStore.getState().setSettings({ channelType: "whatsapp" });
              navigate({ to: "/builder", search: { new: true } });
            }}
          >
            <Plus className="h-3.5 w-3.5" /> Create your first WA agent
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(agents as any[]).map((agent: any) => {
            const settings = typeof agent.settings === "string"
              ? JSON.parse(agent.settings)
              : (agent.settings ?? {});
            const nodes = nodeCount(agent);
            const isLive = !!agent.retell_agent_id;
            const isLoading = loadingId === agent.id;

            return (
              <div
                key={agent.id}
                className="group relative rounded-xl border border-border bg-card p-4 flex flex-col gap-3 hover:border-green-500/40 hover:bg-green-500/5 transition-colors"
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="shrink-0 flex h-8 w-8 items-center justify-center rounded-lg bg-green-500/10 border border-green-500/20">
                      <MessageSquare className="h-4 w-4 text-green-500" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{agent.name || "Untitled"}</p>
                      <p className="text-[10px] text-muted-foreground">WhatsApp agent</p>
                    </div>
                  </div>
                  <Badge
                    variant={isLive ? "default" : "secondary"}
                    className="text-[10px] shrink-0"
                  >
                    {isLive ? "Live" : "Draft"}
                  </Badge>
                </div>

                {/* Stats row */}
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <GitBranch className="h-3 w-3" />
                    {nodes} node{nodes !== 1 ? "s" : ""}
                  </span>
                  {settings.agentName && (
                    <span className="flex items-center gap-1">
                      <Bot className="h-3 w-3" />
                      {settings.agentName}
                    </span>
                  )}
                  <span className="flex items-center gap-1 ml-auto">
                    <Clock className="h-3 w-3" />
                    {new Date(agent.updated_at).toLocaleDateString()}
                  </span>
                </div>

                {/* Global prompt preview */}
                {settings.globalPrompt && (
                  <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed border-t border-border/60 pt-2">
                    {settings.globalPrompt}
                  </p>
                )}

                {/* Action */}
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full gap-1.5 mt-auto"
                  disabled={isLoading}
                  onClick={() => openInBuilder(agent.id)}
                >
                  {isLoading
                    ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Opening…</>
                    : <><Pencil className="h-3.5 w-3.5" /> Open in Builder</>
                  }
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
