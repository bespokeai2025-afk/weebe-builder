export type Decision = {
  id: string;
  title: string;
  detail: string;
  action: string;
  to: "/calendar" | "/calls" | "/qualified" | "/agents/new" | "/my-agents" | "/analytics";
  count?: number;
};

type DecisionInput = {
  totals?: { pendingBookings: number; callsFailed: number; qualified: number };
  agents?: { isDeployed: boolean }[];
};

/** Only observed counts; no inferred urgency, lost revenue, or cohort conversion. */
export function getDashboardDecisions({ totals, agents }: DecisionInput): Decision[] {
  const decisions: Decision[] = [];
  if (totals?.pendingBookings && totals.pendingBookings > 0) decisions.push({
    id: "bookings", title: "Review pending bookings", count: totals.pendingBookings,
    detail: "Check booking details and status before planning your next follow-up.",
    action: "Open calendar", to: "/calendar",
  });
  if (totals?.callsFailed && totals.callsFailed > 0) decisions.push({
    id: "calls", title: "Investigate unsuccessful calls", count: totals.callsFailed,
    detail: "Includes failed, unanswered and busy calls. Review the outcomes before deciding whether to retry.",
    action: "Review calls", to: "/calls",
  });
  if (agents?.length === 0) decisions.push({
    id: "create", title: "Create your first agent",
    detail: "Set up an agent, test its conversation, then connect it to your workflow.",
    action: "Create agent", to: "/agents/new",
  });
  else if (agents?.length && !agents.some(agent => agent.isDeployed)) decisions.push({
    id: "deploy", title: "Get an agent ready to launch", count: agents.length,
    detail: "Your agents are still drafts. Review their setup and test a conversation before deploying.",
    action: "Review agents", to: "/my-agents",
  });
  if (totals?.qualified && totals.qualified > 0) decisions.push({
    id: "qualified", title: "Review qualified leads", count: totals.qualified,
    detail: "Check conversation history and choose the right next step. This count includes leads already followed up.",
    action: "Open qualified leads", to: "/qualified",
  });
  return decisions.slice(0, 3);
}
