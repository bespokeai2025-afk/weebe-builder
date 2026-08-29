import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createVmHooks } from "@/lib/voice/graph/tools";
import type { ToolInvocation } from "@/lib/voice/graph/types";

/**
 * Run one builder function / webhook with the same executor a live call uses.
 * Used by the inspector Test button so authors can see args + result without a call.
 */
export const testBuilderFunction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: { invocation: ToolInvocation; tools?: Array<Record<string, unknown>> }) => input,
  )
  .handler(async ({ data }) => {
    const started = Date.now();
    const hooks = createVmHooks({
      tools: data.tools ?? [],
      log: (message, meta) => console.info(`[function-test] ${message}`, meta ?? ""),
    });
    if (!hooks.executeTool) {
      return {
        ok: false,
        output: JSON.stringify({ error: "no tool executor configured" }),
        durationMs: Date.now() - started,
      };
    }
    const outcome = await hooks.executeTool(data.invocation);
    return {
      ok: outcome.ok,
      output: outcome.output,
      variables: outcome.variables,
      durationMs: Date.now() - started,
    };
  });
