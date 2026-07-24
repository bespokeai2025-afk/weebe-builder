/**
 * Shared Mind tool registry — SERVER ONLY.
 *
 * One declarative registry + ONE execution entrypoint for every consequential
 * Mind capability. The entrypoint enforces, in order:
 *   1. Tool exists & platform compatible.
 *   2. Workspace membership + permissions (fail closed via resolvePermissions).
 *   3. Entitlement guard (requireAction) when the tool declares one.
 *   4. Mode gate for Mind-initiated writes (assertExecutionAllowed).
 *   5. Sensitive tools ALWAYS need explicit approval (approval_required).
 *   6. Input validation (zod) when the tool declares a schema.
 *   7. Audit trail with REAL status transitions in mind_tool_executions
 *      (running → completed / failed; blocked / approval_required rows for
 *      refused runs). No optimistic success — completion is only reported
 *      after the underlying implementation confirmed it.
 *
 * Audit rows are written with the service-role client (table is
 * server-write-only; members get SELECT via RLS). Parameters are scrubbed of
 * credential-shaped keys before storage.
 */
import type { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolvePermissions, requireAction, PermissionDeniedError } from "@/lib/permissions/permissions.server";
import { getHiveMindModeConfig, assertExecutionAllowed, ModeGateError } from "@/lib/hivemind/mode-gate.server";
import type {
  MindToolMeta,
  MindToolPlatform,
  MindToolExecutionStatus,
} from "./tool-registry.shared";

type Sb = any;

export interface MindToolContext {
  sb: Sb;
  workspaceId: string;
  userId: string | null;
  platform: MindToolPlatform;
  executionId: string;
}

export interface MindToolRunResult {
  /** Structured, non-secret result summary stored in the audit row. */
  result?: Record<string, unknown>;
  affectedRecordType?: string | null;
  affectedRecordId?: string | null;
  previousState?: unknown;
  newState?: unknown;
}

export interface MindToolDefinition extends MindToolMeta {
  inputSchema?: z.ZodTypeAny;
  /** Present only for surface === "registry" tools. */
  run?: (ctx: MindToolContext, input: any) => Promise<MindToolRunResult>;
}

const REGISTRY = new Map<string, MindToolDefinition>();

export function registerMindTool(def: MindToolDefinition): void {
  if (REGISTRY.has(def.name)) {
    // Idempotent re-registration (HMR / repeated imports) — last one wins,
    // but warn on genuine duplicates from different modules.
    REGISTRY.set(def.name, def);
    return;
  }
  REGISTRY.set(def.name, def);
}

export function getMindTool(name: string): MindToolDefinition | undefined {
  ensureToolsRegistered();
  return REGISTRY.get(name);
}

export function listMindTools(): MindToolDefinition[] {
  ensureToolsRegistered();
  return [...REGISTRY.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// Lazy one-time registration to avoid import cycles.
let registered = false;
let registering: Promise<void> | null = null;
function ensureToolsRegistered(): void {
  if (registered) return;
  registered = true;
  // Static-literal dynamic import (prod Rollup requirement). Registration is
  // synchronous inside the module body, so awaiting is only needed once.
  registering = import("./register-tools.server").then(() => undefined).catch((err) => {
    registered = false;
    console.error("[mind-tools] registration failed:", err?.message ?? err);
  });
}
/** Await full registration (call in entrypoints before lookups). */
export async function mindToolsReady(): Promise<void> {
  ensureToolsRegistered();
  if (registering) await registering;
}

// ── Parameter scrubbing ──────────────────────────────────────────────────────
const SECRET_KEY_RE = /(secret|token|password|api[_-]?key|authorization|credential|bearer|private[_-]?key)/i;
const SECRET_VALUE_RE = /^(sk-|rt_|whsec_|eyJ[A-Za-z0-9_-]{10,})/;

export function scrubToolParams(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth-limited]";
  if (value == null) return value;
  if (typeof value === "string") {
    if (SECRET_VALUE_RE.test(value)) return "[redacted]";
    return value.length > 2000 ? value.slice(0, 2000) + "…" : value;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrubToolParams(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY_RE.test(k) ? "[redacted]" : scrubToolParams(v, depth + 1);
  }
  return out;
}

// ── Audit helpers (service-role writes; best-effort, never mask tool errors) ─
interface AuditBase {
  workspaceId: string;
  userId: string | null;
  platform: MindToolPlatform;
  mind: string;
  toolName: string;
  initiatedBy: "user" | "mind";
  parameters: unknown;
  approvalRef?: string | null;
  estimatedCost?: string;
}

async function insertAuditRow(
  base: AuditBase,
  status: MindToolExecutionStatus,
  extra?: Record<string, unknown>,
): Promise<string | null> {
  try {
    const { data, error } = await (supabaseAdmin as any)
      .from("mind_tool_executions")
      .insert({
        workspace_id:  base.workspaceId,
        user_id:       base.userId,
        platform:      base.platform,
        mind:          base.mind,
        tool_name:     base.toolName,
        initiated_by:  base.initiatedBy,
        status,
        parameters:    scrubToolParams(base.parameters),
        approval_ref:  base.approvalRef ?? null,
        estimated_cost: base.estimatedCost ?? null,
        ...(extra ?? {}),
      })
      .select("id")
      .single();
    if (error) {
      console.warn("[mind-tools] audit insert failed:", error.message);
      return null;
    }
    return data?.id ?? null;
  } catch (err: any) {
    console.warn("[mind-tools] audit insert failed:", err?.message ?? err);
    return null;
  }
}

async function updateAuditRow(id: string | null, patch: Record<string, unknown>): Promise<void> {
  if (!id) return;
  try {
    const { error } = await (supabaseAdmin as any)
      .from("mind_tool_executions")
      .update(patch)
      .eq("id", id);
    if (error) console.warn("[mind-tools] audit update failed:", error.message);
  } catch (err: any) {
    console.warn("[mind-tools] audit update failed:", err?.message ?? err);
  }
}

// ── Execution entrypoint ─────────────────────────────────────────────────────
export interface ExecuteMindToolInput {
  sb: Sb;
  workspaceId: string;
  /** null ONLY for Mind-initiated background runs (service context). */
  userId: string | null;
  platform: MindToolPlatform;
  toolName: string;
  input: unknown;
  initiatedBy: "user" | "mind";
  /** True when a human explicitly approved this specific run. */
  explicitApproval?: boolean;
  /** Reference to the approval record (e.g. hivemind_actions.id). */
  approvalRef?: string | null;
}

export interface ExecuteMindToolResult {
  status: MindToolExecutionStatus;
  executionId: string | null;
  result?: Record<string, unknown>;
  affectedRecordType?: string | null;
  affectedRecordId?: string | null;
  error?: string;
}

export async function executeMindTool(opts: ExecuteMindToolInput): Promise<ExecuteMindToolResult> {
  await mindToolsReady();
  const tool = REGISTRY.get(opts.toolName);
  if (!tool) {
    return { status: "blocked", executionId: null, error: `Unknown Mind tool: ${opts.toolName}` };
  }

  const auditBase: AuditBase = {
    workspaceId:  opts.workspaceId,
    userId:       opts.userId,
    platform:     opts.platform,
    mind:         tool.mind,
    toolName:     tool.name,
    initiatedBy:  opts.initiatedBy,
    parameters:   opts.input,
    approvalRef:  opts.approvalRef ?? null,
    estimatedCost: tool.estimatedCost,
  };

  const blocked = async (message: string): Promise<ExecuteMindToolResult> => {
    const id = await insertAuditRow(auditBase, "blocked", { error_message: message.slice(0, 1000) });
    return { status: "blocked", executionId: id, error: message };
  };

  try {
    if (!opts.workspaceId) return await blocked("Missing workspace scope.");
    if (!tool.platforms.includes(opts.platform)) {
      return await blocked(`Tool "${tool.name}" is not available on platform "${opts.platform}".`);
    }
    if (!tool.run || tool.surface !== "registry") {
      return await blocked(
        `Tool "${tool.name}" is not directly executable — it runs via its ${tool.surface} surface.`,
      );
    }

    // 1. Membership / permission resolution — fail closed.
    if (opts.userId) {
      const perms = await resolvePermissions(opts.workspaceId, opts.userId);
      if (!perms.isMember) return await blocked("Not a member of this workspace.");
      if (tool.requiredActionKey) {
        await requireAction(opts.workspaceId, opts.userId, tool.requiredActionKey);
      }
    } else if (opts.initiatedBy !== "mind") {
      return await blocked("A user identity is required for user-initiated tool runs.");
    }

    // 2. Mode gate for Mind-initiated writes.
    if (tool.access === "write" && opts.initiatedBy === "mind") {
      const cfg = await getHiveMindModeConfig(opts.sb ?? supabaseAdmin, opts.workspaceId);
      assertExecutionAllowed(cfg, tool.modeGateActionType ?? tool.name.split(".").pop()!, {
        explicitApproval: opts.explicitApproval === true,
      });
    }

    // 3. Sensitive tools always need explicit human approval.
    if (tool.sensitive && opts.explicitApproval !== true) {
      const id = await insertAuditRow(auditBase, "approval_required", {
        error_message: "Awaiting explicit human approval.",
      });
      return {
        status: "approval_required",
        executionId: id,
        error: "This tool is sensitive and requires explicit human approval.",
      };
    }

    // 4. Validate input.
    let parsedInput: unknown = opts.input;
    if (tool.inputSchema) {
      const parsed = tool.inputSchema.safeParse(opts.input);
      if (!parsed.success) {
        return await blocked(`Invalid input: ${parsed.error.issues.map((i) => i.message).join("; ").slice(0, 500)}`);
      }
      parsedInput = parsed.data;
    }

    // 5. Run with a real audit lifecycle.
    const startedAt = new Date().toISOString();
    const auditId = await insertAuditRow(auditBase, "running", { started_at: startedAt });
    try {
      const out = await tool.run(
        {
          sb: opts.sb ?? supabaseAdmin,
          workspaceId: opts.workspaceId,
          userId: opts.userId,
          platform: opts.platform,
          executionId: auditId ?? "unaudited",
        },
        parsedInput,
      );
      await updateAuditRow(auditId, {
        status:               "completed",
        finished_at:          new Date().toISOString(),
        result_summary:       scrubToolParams(out.result ?? null),
        affected_record_type: out.affectedRecordType ?? null,
        affected_record_id:   out.affectedRecordId ?? null,
        previous_state:       scrubToolParams(out.previousState ?? null),
        new_state:            scrubToolParams(out.newState ?? null),
      });
      return {
        status: "completed",
        executionId: auditId,
        result: out.result,
        affectedRecordType: out.affectedRecordType ?? null,
        affectedRecordId: out.affectedRecordId ?? null,
      };
    } catch (err: any) {
      const message = err?.message ?? String(err);
      await updateAuditRow(auditId, {
        status: "failed",
        finished_at: new Date().toISOString(),
        error_message: String(message).slice(0, 1000),
      });
      return { status: "failed", executionId: auditId, error: message };
    }
  } catch (err: any) {
    // Permission / mode-gate refusals land here — recorded as blocked.
    if (err instanceof ModeGateError || err instanceof PermissionDeniedError || err?.name === "PermissionDeniedError") {
      return await blocked(err.message);
    }
    const message = err?.message ?? String(err);
    const id = await insertAuditRow(auditBase, "failed", { error_message: String(message).slice(0, 1000) });
    return { status: "failed", executionId: id, error: message };
  }
}

/**
 * Audit wrapper for user-driven server functions (surface "server_fn"):
 * records the run in the registry audit trail with real statuses while the
 * existing function keeps its own behavior. The wrapped fn's errors are
 * rethrown unchanged.
 */
export async function auditServerFnToolRun<T>(
  args: {
    workspaceId: string;
    userId: string | null;
    platform?: MindToolPlatform;
    toolName: string;
    params?: unknown;
    affectedRecord?: (result: T) => { type?: string | null; id?: string | null } | null;
    /** Map a non-throwing result to success/failure (e.g. `{ ok:false }` envelopes). */
    outcome?: (result: T) => { ok: boolean; error?: string };
  },
  fn: () => Promise<T>,
): Promise<T> {
  await mindToolsReady();
  const tool = REGISTRY.get(args.toolName);
  const base: AuditBase = {
    workspaceId: args.workspaceId,
    userId:      args.userId,
    platform:    args.platform ?? "web",
    mind:        tool?.mind ?? (args.toolName.split(".")[0] as any) ?? "hivemind",
    toolName:    args.toolName,
    initiatedBy: "user",
    parameters:  args.params ?? null,
    estimatedCost: tool?.estimatedCost,
  };
  const auditId = await insertAuditRow(base, "running", { started_at: new Date().toISOString() });
  try {
    const result = await fn();
    const affected = args.affectedRecord ? args.affectedRecord(result) : null;
    const outcome = args.outcome ? args.outcome(result) : { ok: true };
    await updateAuditRow(auditId, {
      status: outcome.ok ? "completed" : "failed",
      finished_at: new Date().toISOString(),
      error_message: outcome.ok ? null : String(outcome.error ?? "Operation reported failure").slice(0, 1000),
      affected_record_type: affected?.type ?? null,
      affected_record_id:   affected?.id ?? null,
    });
    return result;
  } catch (err: any) {
    await updateAuditRow(auditId, {
      status: "failed",
      finished_at: new Date().toISOString(),
      error_message: String(err?.message ?? err).slice(0, 1000),
    });
    throw err;
  }
}
