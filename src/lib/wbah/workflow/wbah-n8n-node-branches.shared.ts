/**
 * n8n-style output branches per node kind — drives canvas handles + edge sourceHandle.
 */
import type { WbahN8nNodeKind } from "./wbah-n8n-node-catalog.shared";
import type { WbahN8nNodeConfig } from "./wbah-n8n-node-presets.shared";

export type N8nOutputBranch = {
  id: string;
  label: string;
  /** vertical offset 0–100% on the right edge (horizontal n8n flow) */
  topPct: number;
  color: string;
};

export type N8nNodeOutputLayout = {
  branches: N8nOutputBranch[];
};

export function getNodeOutputLayout(
  kind: WbahN8nNodeKind | string,
  config: Record<string, unknown> = {},
): N8nNodeOutputLayout {
  const k = kind as WbahN8nNodeKind;
  const settings = (config.settings ?? {}) as WbahN8nNodeConfig["settings"];

  if (k === "if") {
    return {
      branches: [
        { id: "true", label: "true", topPct: 32, color: "emerald" },
        { id: "false", label: "false", topPct: 68, color: "red" },
      ],
    };
  }

  if (k === "filter") {
    return {
      branches: [{ id: "main", label: "kept", topPct: 50, color: "violet" }],
    };
  }

  if (k === "http" || k === "code") {
    const showError =
      settings?.onError !== "stopWorkflow" || k === "http";
    if (showError) {
      return {
        branches: [
          { id: "main", label: "Success", topPct: 32, color: "emerald" },
          { id: "error", label: "Error", topPct: 68, color: "red" },
        ],
      };
    }
  }

  return {
    branches: [{ id: "main", label: "Output", topPct: 50, color: "violet" }],
  };
}

export function branchHandleClass(color: string): string {
  const map: Record<string, string> = {
    emerald: "!bg-emerald-400",
    red: "!bg-red-400/80",
    violet: "!bg-violet-400",
    amber: "!bg-amber-400",
  };
  return map[color] ?? "!bg-violet-400";
}
