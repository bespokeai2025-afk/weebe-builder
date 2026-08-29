import { createContext, useContext } from "react";

export type NodeIssueLevel = "error" | "warn";

export const NodeIssueContext = createContext<ReadonlyMap<string, NodeIssueLevel>>(
  new Map(),
);

export function useNodeIssue(id: string): NodeIssueLevel | undefined {
  return useContext(NodeIssueContext).get(id);
}

export function issueMapFromList(
  issues: Array<{ level: "error" | "warn"; nodeId?: string }>,
): Map<string, NodeIssueLevel> {
  const map = new Map<string, NodeIssueLevel>();
  for (const issue of issues) {
    if (!issue.nodeId) continue;
    const prev = map.get(issue.nodeId);
    if (prev === "error") continue;
    map.set(issue.nodeId, issue.level);
  }
  return map;
}
