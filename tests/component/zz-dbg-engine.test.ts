/**
 * TEMPORARY replay (delete after use): which WBAH steps would newly run because merges no longer
 * stall. Reads recent jobs from production (read-only); every side-effecting step is stubbed and
 * all network is blocked before any workflow runs.
 */
import { readFileSync } from "node:fs";
import { it, vi } from "vitest";

for (const line of readFileSync(".env", "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.trim().replace(/^["']|["']$/g, "");
}

vi.mock("@/lib/automation-engine/plugins/wbah/wbah-step-handlers.server", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/automation-engine/plugins/wbah/wbah-step-handlers.server")>();
  return {
    ...real,
    wbahStepLiveTranscript: async () => {},
    wbahStepDashboardRaw: async () => {},
    wbahStepCalendlyLink: async (_b: unknown, f: { hasBookingSlot?: boolean }) =>
      f?.hasBookingSlot ? "https://calendly.example/slot" : null,
    wbahStepCalendlyInvitee: async () => {},
    wbahStepDashboardAnalyzed: async () => null,
    wbahStepCallsUpsert: async () => {},
    wbahStepDynamicsAllens: async () => {},
    wbahStepDynamicsAgentic: async () => {},
  };
});

it("replay", async () => {
  if (process.env.REPLAY !== "1") return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { resolveWbahPostCallWorkflowConfig } = await import("@/lib/wbah/workflow/wbah-workflow-resolver.server");
  const { attachAutomationToWbahPipeline } = await import("@/lib/automation-engine/sync-automation.server");
  const { wbahPipelineToAutomationDocument } = await import("@/lib/automation-engine/adapters/wbah-graph.adapter");
  const { resolveWbahRetellAgent } = await import("@/lib/wbah/post-call/wbah-retell-agents.shared");
  const { runExecution } = await import("@/lib/automation-engine/runtime/execution-runner");

  const { data: jobs, error } = await (supabaseAdmin as any)
    .from("wbah_post_call_jobs")
    .select("id, event, agent_id, payload")
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) throw new Error(error.message);

  const docs = new Map<string, unknown>();
  const plan: Array<{ job: any; agent: any; doc: unknown }> = [];
  for (const job of jobs as any[]) {
    const call = (job.payload?.call ?? {}) as Record<string, unknown>;
    const agent = resolveWbahRetellAgent(String(job.agent_id ?? call.agent_id ?? ""));
    if (!agent || agent.role === "rebooking") continue;
    const key = String(call.agent_id ?? job.agent_id);
    if (!docs.has(key)) {
      const cfg = await resolveWbahPostCallWorkflowConfig({ workspaceId: agent.workspaceId, agentId: key });
      if (cfg.workflow_kind === "wbah_rebook_post_call") continue;
      const withAutomation = cfg.automation ? cfg : attachAutomationToWbahPipeline(cfg);
      docs.set(key, (withAutomation.automation as unknown) ?? wbahPipelineToAutomationDocument(withAutomation));
    }
    plan.push({ job, agent, doc: docs.get(key) });
  }

  // Nothing below may reach the network.
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));

  const summary: Record<string, number> = {};
  const merges: Record<string, number> = {};
  let runs = 0;
  let withPartial = 0;
  const statuses: Record<string, number> = {};
  for (const { job, doc } of plan) {
    let logRef: any[] = [];
    let mark: number | null = null;
    const result = await runExecution({
      workflow: doc,
      mode: "manual",
      maxNodes: 150,
      trigger: {
        event: job.event,
        call: job.payload.call,
        body: { event: job.event, call: job.payload.call, ...job.payload },
        ...job.payload,
        _skipLiveTranscript: true,
      },
      onStep: async ({ ctx }) => {
        logRef = ctx.log;
      },
      onEvent: (e) => {
        if (e.meta?.partialMerge) {
          merges[`${job.event} ${e.nodeId} ${e.meta.received}/${e.meta.expected}`] =
            (merges[`${job.event} ${e.nodeId} ${e.meta.received}/${e.meta.expected}`] ?? 0) + 1;
          if (mark === null) mark = logRef.length;
        }
      },
    });
    runs++;
    statuses[result.status] = (statuses[result.status] ?? 0) + 1;
    if (mark === null) continue;
    withPartial++;
    const newly = new Set<string>();
    for (const entry of result.log.slice(mark)) {
      const out = entry.output as Record<string, unknown> | undefined;
      if (entry.status === "success" && typeof out?._wbahStep === "string" && !out._wbahSkipped) {
        newly.add(out._wbahStep);
      }
    }
    const k = `${job.event}: ${[...newly].sort().join(",") || "(no WBAH step)"}`;
    summary[k] = (summary[k] ?? 0) + 1;
  }
  throw new Error(
    `REPLAY runs=${runs} withPartialMerge=${withPartial}\nstatuses=${JSON.stringify(statuses)}\nnewlyRun=${JSON.stringify(summary, null, 1)}\nmerges=${JSON.stringify(merges, null, 1)}`,
  );
}, 600_000);
