import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getCrmSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;
    const { data, error } = await sb
      .from("workspace_settings")
      .select("hubspot_api_key, ghl_api_key, ghl_location_id, webespoke_api_key, webespoke_api_url")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return {
      hasHubspot:    Boolean(data?.hubspot_api_key),
      hasGhl:        Boolean(data?.ghl_api_key && data?.ghl_location_id),
      ghl_location_id: (data?.ghl_location_id as string | null) ?? null,
      hasWebespoke:  Boolean(data?.webespoke_api_key && data?.webespoke_api_url),
      webespoke_api_url: (data?.webespoke_api_url as string | null) ?? null,
    };
  });

export const saveCrmSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        hubspot_api_key:   z.string().nullable().optional(),
        ghl_api_key:       z.string().nullable().optional(),
        ghl_location_id:   z.string().nullable().optional(),
        webespoke_api_key: z.string().nullable().optional(),
        webespoke_api_url: z.string().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;

    const patch: Record<string, unknown> = { workspace_id: workspaceId };
    if ("hubspot_api_key"   in data) patch.hubspot_api_key   = data.hubspot_api_key   ?? null;
    if ("ghl_api_key"       in data) patch.ghl_api_key       = data.ghl_api_key       ?? null;
    if ("ghl_location_id"   in data) patch.ghl_location_id   = data.ghl_location_id   ?? null;
    if ("webespoke_api_key" in data) patch.webespoke_api_key = data.webespoke_api_key ?? null;
    if ("webespoke_api_url" in data) patch.webespoke_api_url = data.webespoke_api_url ?? null;

    const { error } = await sb
      .from("workspace_settings")
      .upsert(patch, { onConflict: "workspace_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const validateHubspotKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ apiKey: z.string().min(1) }).parse(input))
  .handler(async ({ data }) => {
    const { validateHubSpotKey } = await import("./hubspot.adapter");
    const ok = await validateHubSpotKey(data.apiKey);
    return { ok };
  });

export const validateGhlKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ apiKey: z.string().min(1), locationId: z.string().min(1) }).parse(input),
  )
  .handler(async ({ data }) => {
    const { validateGhlKey: validate } = await import("./gohighlevel.adapter");
    const ok = await validate(data.apiKey, data.locationId);
    return { ok };
  });

export const validateWebespokeKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ apiKey: z.string().min(1), apiUrl: z.string().url() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { validateWeeBespokeAiKey } = await import("./webespoke-ai.adapter");
    const ok = await validateWeeBespokeAiKey(data.apiKey, data.apiUrl);
    return { ok };
  });
