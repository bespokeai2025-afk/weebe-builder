/**
 * HiveMind chat ↔ executive tool bridge — SERVER ONLY.
 *
 * Exposes the registered `hivemind.*` executive control tools to the HiveMind
 * chat model as OpenAI function-calling schemas, and executes model tool calls
 * through executeMindTool() so EVERY guard applies (membership, entitlements,
 * sensitive-approval, zod validation, audit trail).
 *
 * Honesty rules:
 *  - Chat runs are user-initiated (initiatedBy "user"), never auto-approved:
 *    sensitive tools come back as approval_required and the model must say so.
 *  - Failures are returned verbatim as { ok:false, error } — the model is
 *    instructed to report them, never claim success.
 */
import { z } from "zod";
import { listMindTools, executeMindTool, mindToolsReady } from "@/lib/minds/tool-registry.server";

// ── Minimal zod → JSON-schema conversion (covers the shapes our tools use) ───
function zodToJsonSchema(schema: any): any {
  if (!schema) return { type: "object", properties: {}, required: [] };
  const def = schema._def;
  const t = def?.typeName;
  switch (t) {
    case "ZodLazy":     return zodToJsonSchema(def.getter());
    case "ZodOptional":
    case "ZodNullable": return zodToJsonSchema(def.innerType);
    case "ZodEffects":  return zodToJsonSchema(def.schema);
    case "ZodString":   return { type: "string" };
    case "ZodNumber":   return { type: "number" };
    case "ZodBoolean":  return { type: "boolean" };
    case "ZodEnum":     return { type: "string", enum: def.values };
    case "ZodArray":    return { type: "array", items: zodToJsonSchema(def.type) };
    case "ZodObject": {
      const shape = typeof def.shape === "function" ? def.shape() : def.shape;
      const properties: Record<string, any> = {};
      const required: string[] = [];
      for (const [key, val] of Object.entries(shape as Record<string, any>)) {
        properties[key] = zodToJsonSchema(val);
        const vt = (val as any)?._def?.typeName;
        if (vt !== "ZodOptional" && vt !== "ZodDefault") required.push(key);
      }
      return { type: "object", properties, required };
    }
    default:            return { type: "object" };
  }
}

/** Chat-exposed tool names → registry names (short name without the mind prefix). */
export async function getHiveMindChatToolSchemas(): Promise<any[]> {
  await mindToolsReady();
  return listMindTools()
    .filter((t) => t.mind === "hivemind" && t.surface === "registry" && t.name.startsWith("hivemind."))
    .map((t) => ({
      type: "function",
      function: {
        name: t.name.slice("hivemind.".length),
        description:
          `${t.description}${t.access === "write" ? " This is a REAL write action." : ""}` +
          (t.sensitive ? " SENSITIVE: running it only files an approval request — it will NOT execute until a human approves it in the action centre." : ""),
        parameters: zodToJsonSchema(t.inputSchema),
      },
    }));
}

const ArgsSchema = z.record(z.string(), z.any());

/** Execute one model tool call through the guarded registry entrypoint. */
export async function executeHiveMindChatTool(opts: {
  sb: any;
  workspaceId: string;
  userId: string | null;
  name: string;
  args: Record<string, any>;
}): Promise<Record<string, unknown>> {
  const args = ArgsSchema.parse(opts.args ?? {});
  const outcome = await executeMindTool({
    sb: opts.sb,
    workspaceId: opts.workspaceId,
    userId: opts.userId,
    toolName: `hivemind.${opts.name}`,
    input: args,
    initiatedBy: "user",
    platform: "web",
  });
  if (outcome.status === "completed") {
    return { ok: true, ...((outcome.result ?? {}) as Record<string, unknown>) };
  }
  if (outcome.status === "approval_required") {
    return {
      ok: false,
      status: "approval_required",
      error: "This action is sensitive and now requires explicit human approval before it executes. Tell the user to approve it in the HiveMind action centre — do NOT claim it was done.",
    };
  }
  return { ok: false, status: outcome.status, error: outcome.error ?? `Tool run ${outcome.status}.` };
}
