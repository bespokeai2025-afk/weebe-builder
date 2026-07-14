// Shared per-agent filter for dashboard pages (Calls, Leads, Qualified, Data…).
// Purely additive: defaults to "All agents" (no filtering), so existing setups
// keep working exactly as before. Options show each agent's type.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getWorkspaceAgents } from "@/lib/agents/agents.functions";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type WorkspaceAgentOption = {
  id: string;
  name: string;
  agentType: string;
  isLive: boolean;
  isDeployed: boolean;
  retellAgentId?: string | null;
};

export const AGENT_TYPE_LABELS: Record<string, string> = {
  receptionist:         "Receptionist",
  lead_generation:      "Lead Generation",
  client_qualification: "Qualification",
  custom:               "Custom",
};

export function agentTypeLabel(t: string | null | undefined): string {
  if (!t) return "Receptionist";
  return AGENT_TYPE_LABELS[t] ?? t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function useWorkspaceAgentOptions() {
  const fn = useServerFn(getWorkspaceAgents);
  const q = useQuery({
    queryKey: ["workspace-agent-filter-options"],
    queryFn: () => fn(),
    staleTime: 60_000,
    throwOnError: false,
  });
  return (q.data ?? []) as WorkspaceAgentOption[];
}

/** True when a data row belongs to the given agent. Rows across pages carry
 *  the local agent UUID, the provider (Retell) agent id, or the agent's
 *  display name — match on any of them. */
export function rowMatchesAgent(
  agent: WorkspaceAgentOption,
  row: { agentId?: string | null; agentName?: string | null },
): boolean {
  if (row.agentId && row.agentId === agent.id) return true;
  if (row.agentId && agent.retellAgentId && row.agentId === agent.retellAgentId) return true;
  if (row.agentName && agent.name && row.agentName === agent.name) return true;
  return false;
}

export function AgentFilterSelect({
  agents, value, onChange, className,
}: {
  agents: WorkspaceAgentOption[];
  value: string;                       // agent id or "all"
  onChange: (v: string) => void;
  className?: string;
}) {
  if (agents.length === 0) return null;
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={cn("h-9 w-[190px] text-xs", className)}>
        <SelectValue placeholder="All agents" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all" className="text-xs">All agents</SelectItem>
        {agents.map((a) => (
          <SelectItem key={a.id} value={a.id} className="text-xs">
            {a.name}
            <span className="ml-1.5 text-[10px] text-muted-foreground">· {agentTypeLabel(a.agentType)}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
