import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const CallScheduleSchema = z.object({
  timezone: z.string().max(64).default("UTC"),
  days: z.array(z.number().int().min(0).max(6)).max(7),
  startHour: z.number().int().min(0).max(23),
  endHour: z.number().int().min(0).max(24),
  enabled: z.boolean().default(true),
});

export const getCallSchedule = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;

    const { data, error } = await sb
      .from("workspace_settings")
      .select("call_schedule, timezone")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      schedule: (data?.call_schedule ?? null) as null | z.infer<typeof CallScheduleSchema>,
      timezone: data?.timezone ?? "UTC",
    };
  });

export const setCallSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => CallScheduleSchema.parse(input))
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;

    const { error } = await sb.from("workspace_settings").upsert(
      {
        workspace_id: workspaceId,
        call_schedule: data,
        timezone: data.timezone,
      },
      { onConflict: "workspace_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });
