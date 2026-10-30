/**
 * Agent matching for data rows — no UI imports, so server functions can filter by agent too.
 */

export type AgentMatchTarget = {
  id: string;
  name?: string | null;
  retellAgentId?: string | null;
};

/** True when a data row belongs to the given agent. Rows across pages carry
 *  the local agent UUID, the provider (Retell) agent id, or the agent's
 *  display name — match on any of them. */
export function rowMatchesAgent(
  agent: AgentMatchTarget,
  row: { agentId?: string | null; agentName?: string | null },
): boolean {
  if (row.agentId && row.agentId === agent.id) return true;
  if (row.agentId && agent.retellAgentId && row.agentId === agent.retellAgentId) return true;
  if (row.agentName && agent.name && row.agentName === agent.name) return true;
  return false;
}
