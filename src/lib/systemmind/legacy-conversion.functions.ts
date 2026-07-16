import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function requireWorkspaceId(workspaceId: string | undefined): string {
  if (!workspaceId) throw new Error("No workspace selected — join or create a workspace first.");
  return workspaceId;
}

const SOURCE_TYPES = [
  "agent",
  "workflow",
  "n8n",
  "hexmail_sequence",
  "wati_setup",
  "webform_auto_call",
  "manual_description",
] as const;

// ── Legacy Logic Converter ─────────────────────────────────────────────────────

export const listLegacyConversionSources = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    {
      const { requireSystemMindView } = await import(
        "@/lib/systemmind/systemmind-access.server"
      );
      await requireSystemMindView(context.workspaceId, context.userId);
    }
    const { listLegacyConversionSourcesServer } = await import(
      "@/lib/systemmind/legacy-conversion.server"
    );
    return listLegacyConversionSourcesServer(requireWorkspaceId(context.workspaceId));
  });

export const convertLegacySourceToDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      sourceType:  z.enum(SOURCE_TYPES),
      sourceId:    z.string().min(1).max(200).nullable().optional(),
      description: z.string().max(8000).nullable().optional(),
      sourcePage:  z.string().max(60).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    {
      const { requireSystemMindEdit } = await import(
        "@/lib/systemmind/systemmind-access.server"
      );
      await requireSystemMindEdit(context.workspaceId, context.userId);
    }
    const { convertLegacySourceServer } = await import(
      "@/lib/systemmind/legacy-conversion.server"
    );
    return convertLegacySourceServer({
      workspaceId: requireWorkspaceId(context.workspaceId),
      userId:      context.userId ?? null,
      sourceType:  data.sourceType,
      sourceId:    data.sourceId ?? null,
      description: data.description ?? null,
      sourcePage:  data.sourcePage,
    });
  });

export const getConversionForSession = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ sessionId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    {
      const { requireSystemMindView } = await import(
        "@/lib/systemmind/systemmind-access.server"
      );
      await requireSystemMindView(context.workspaceId, context.userId);
    }
    const { getConversionForSessionServer } = await import(
      "@/lib/systemmind/legacy-conversion.server"
    );
    return getConversionForSessionServer(requireWorkspaceId(context.workspaceId), data.sessionId);
  });

export const listLegacyConversions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    {
      const { requireSystemMindView } = await import(
        "@/lib/systemmind/systemmind-access.server"
      );
      await requireSystemMindView(context.workspaceId, context.userId);
    }
    const { listLegacyConversionsServer } = await import(
      "@/lib/systemmind/legacy-conversion.server"
    );
    return listLegacyConversionsServer(requireWorkspaceId(context.workspaceId));
  });
