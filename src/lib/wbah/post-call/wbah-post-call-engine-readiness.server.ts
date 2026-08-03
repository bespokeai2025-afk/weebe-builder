/**
 * WBAH post-call engine readiness — env flags + automation engine status.
 */
import { getWbahPostCallReadiness } from "@/lib/wbah/post-call/wbah-post-call.server";
import { isWbahPostCallQueueEnabled } from "@/lib/wbah/post-call/wbah-post-call-queue.server";
import {
  isWbahAutomationEngineEnabled,
} from "@/lib/automation-engine/plugins/wbah/wbah-automation-pipeline.server";
import { WBAH_NODE_DEFINITIONS } from "@/lib/automation-engine/plugins/wbah/register-wbah-nodes";

export type WbahPostCallEngineReadiness = {
  executionEnabled: boolean;
  queueEnabled: boolean;
  dynamicsConfigured: boolean;
  calendlyConfigured: boolean;
  webespokeConfigured: boolean;
  automationEngineEnabled: boolean;
  automationEnginePhase: number;
  wbahPluginNodeCount: number;
  /** Which code path processes queued post-call jobs. */
  pipelineMode: "legacy" | "automation_engine";
  /** Human label for the active pipeline. */
  pipelineLabel: string;
};

export function getWbahPostCallEngineReadiness(): WbahPostCallEngineReadiness {
  const base = getWbahPostCallReadiness();
  const automationOn = isWbahAutomationEngineEnabled();

  return {
    executionEnabled: base.executionEnabled,
    queueEnabled: isWbahPostCallQueueEnabled(),
    dynamicsConfigured: base.dynamics,
    calendlyConfigured: base.calendly,
    webespokeConfigured: base.webespoke,
    automationEngineEnabled: automationOn,
    automationEnginePhase: 4,
    wbahPluginNodeCount: WBAH_NODE_DEFINITIONS.length,
    pipelineMode: automationOn ? "automation_engine" : "legacy",
    pipelineLabel: automationOn
      ? "Automation engine (WBAH plugins)"
      : "Legacy native pipeline",
  };
}
