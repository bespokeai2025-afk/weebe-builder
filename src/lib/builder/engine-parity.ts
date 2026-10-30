/**
 * Retell ↔ WEBEE Native parity, checked on the flow on screen.
 *
 * The builder edits one flow for every engine. For WEBEE Native, two things can make a call behave
 * differently from the canvas: the engine's flow compiler dropping or rewiring something it cannot
 * run (unknown node types, edges to missing nodes, an invalid start node), and settings the engine
 * ignores or only partly honours (engine-capabilities.ts). Both used to surface only in server
 * logs during a call; this lists them in the deploy check, next to the flow's other issues.
 */
import type { Edge } from "@xyflow/react";
import { compileFlow } from "@/lib/voice/graph/flow";
import { resolveDeploymentMode } from "@/lib/runtime/adapter";
import { exportAgentJson } from "./export-conversation-flow";
import { SETTING_ENGINE_RULES, settingSupport } from "./engine-capabilities";
import type { BuilderSettings, BuilderVariable, FlowNode } from "./types";
import type { ValidationIssue } from "./validate";

const SETTING_LABELS: Partial<Record<keyof BuilderSettings, string>> = {
  voiceEmotion: "Voice emotion",
  voiceTemperature: "Voice expressiveness",
  ambientSound: "Background sound",
  ambientSoundVolume: "Background sound volume",
  denoisingMode: "Noise reduction",
};

function isSet(value: unknown): boolean {
  if (value == null || value === "" || value === false) return false;
  if (typeof value === "string" && /^(none|off|default)$/i.test(value)) return false;
  return true;
}

/** Engine-specific issues for the flow on screen; empty unless the agent runs on WEBEE Native. */
export function nativeEngineIssues(
  nodes: FlowNode[],
  edges: Edge[],
  settings: BuilderSettings,
  variables: BuilderVariable[],
): ValidationIssue[] {
  if (resolveDeploymentMode(settings) !== "WEBEE_NATIVE") return [];
  const issues: ValidationIssue[] = [];
  const nodeIds = new Set(nodes.map((n) => n.id));

  let flow: unknown;
  try {
    flow = (exportAgentJson(nodes, edges, settings, variables) as Record<string, unknown>).conversationFlow;
  } catch (e) {
    return [
      {
        level: "error",
        message: `WEBEE Native cannot read this flow: ${(e as Error).message}`,
      },
    ];
  }

  for (const warning of compileFlow(flow).warnings) {
    const nodeId = warning.match(/node "([^"]+)"/)?.[1];
    issues.push({
      level: /no executable nodes/.test(warning) ? "error" : "warn",
      message: `WEBEE Native: ${warning}.`,
      nodeId: nodeId && nodeIds.has(nodeId) ? nodeId : undefined,
    });
  }

  for (const key of Object.keys(SETTING_ENGINE_RULES) as Array<keyof BuilderSettings>) {
    if (!isSet(settings[key])) continue;
    const { support, note } = settingSupport(key, settings);
    if (support === "full" || !note) continue;
    issues.push({
      level: "warn",
      message: `${SETTING_LABELS[key] ?? String(key)}: ${note}`,
    });
  }
  return issues;
}
