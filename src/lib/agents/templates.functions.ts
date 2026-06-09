import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";

type Json = Database["public"]["Tables"]["agents"]["Row"]["flow_data"];

export type TemplateScope = "global" | "personal";

export interface AgentTemplateRow {
  id: string;
  scope: TemplateScope;
  owner_user_id: string | null;
  name: string;
  description: string;
  flow_data: Json;
  settings: Json;
  variables: Json;
  created_at: string;
  updated_at: string;
}

async function isAdmin(
  supabase: {
    from: (t: string) => {
      select: (c: string) => {
        eq: (
          col: string,
          val: string,
        ) => { maybeSingle: () => Promise<{ data: { user_type: string } | null }> };
      };
    };
  },
  userId: string,
) {
  const { data } = await supabase
    .from("profiles")
    .select("user_type")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.user_type === "admin";
}

/** List all templates the current user can see (global + their personal). */
export const listAgentTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("agent_templates")
      .select("id, scope, owner_user_id, name, description, settings, updated_at, created_at")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as Array<{
      id: string;
      scope: TemplateScope;
      owner_user_id: string | null;
      name: string;
      description: string;
      settings: Record<string, unknown> | null;
      updated_at: string;
      created_at: string;
    }>;
  });

/** Load a single template by id. */
export const getAgentTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { data: row, error } = await supabase
      .from("agent_templates")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row as AgentTemplateRow | null;
  });

/** Create or update a template. Scope=global requires admin role. */
export const upsertAgentTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      id?: string;
      scope: TemplateScope;
      name: string;
      description?: string;
      flowData: Json;
      settings: Json;
      variables: Json;
    }) => {
      if (!input.name || input.name.trim().length < 1) throw new Error("Template name is required");
      if (input.name.length > 120) throw new Error("Template name too long");
      if (input.scope !== "global" && input.scope !== "personal") throw new Error("Invalid scope");
      return input;
    },
  )
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;

    if (data.scope === "global") {
      const admin = await isAdmin(supabase as never, userId);
      if (!admin) throw new Error("Only admins can manage global templates");
    }

    const base = {
      scope: data.scope,
      owner_user_id: data.scope === "personal" ? userId : null,
      name: data.name.trim(),
      description: (data.description ?? "").slice(0, 1000),
      flow_data: data.flowData,
      settings: data.settings,
      variables: data.variables,
    };

    // Use admin client for global writes so we bypass RLS after the role check.
    const client = data.scope === "global" ? supabaseAdmin : supabase;

    if (data.id) {
      const { data: row, error } = await client
        .from("agent_templates")
        .update(base)
        .eq("id", data.id)
        .select("id")
        .maybeSingle();
      if (error) throw new Error(error.message);
      return { id: (row?.id as string) ?? data.id };
    }
    const { data: row, error } = await client
      .from("agent_templates")
      .insert(base)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { id: row!.id as string };
  });

export const deleteAgentTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    // Look up scope first to know if we need admin client.
    const { data: row, error: readErr } = await supabase
      .from("agent_templates")
      .select("scope")
      .eq("id", data.id)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!row) throw new Error("Template not found");
    if (row.scope === "global") {
      const admin = await isAdmin(supabase as never, userId);
      if (!admin) throw new Error("Only admins can delete global templates");
      const { error } = await supabaseAdmin.from("agent_templates").delete().eq("id", data.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabase.from("agent_templates").delete().eq("id", data.id);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

/** Whether the current user is an admin (used by the UI to show global controls). */
export const isCurrentUserAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    return { isAdmin: await isAdmin(supabase as never, userId) };
  });
