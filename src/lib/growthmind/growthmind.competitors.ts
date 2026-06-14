import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ── Types ───────────────────────────────────────────────────────────────────

export type Competitor = {
  id:           string;
  name:         string;
  website:      string;
  services:     string;
  offers:       string;
  positioning:  string;
  observations: string;
  createdAt:    string;
  updatedAt:    string;
};

// ── Server functions ─────────────────────────────────────────────────────────

export const getCompetitors = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data, error } = await sb
      .from("growthmind_competitors")
      .select("id, name, website, services, offers, positioning, observations, created_at, updated_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw new Error(error.message);

    const competitors: Competitor[] = (data ?? []).map((r: any) => ({
      id:           r.id,
      name:         r.name,
      website:      r.website      ?? "",
      services:     r.services     ?? "",
      offers:       r.offers       ?? "",
      positioning:  r.positioning  ?? "",
      observations: r.observations ?? "",
      createdAt:    r.created_at,
      updatedAt:    r.updated_at,
    }));

    return { competitors };
  });

export const saveCompetitor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id:           z.string().uuid().optional(),
      name:         z.string().min(1).max(200),
      website:      z.string().max(500).default(""),
      services:     z.string().max(1000).default(""),
      offers:       z.string().max(1000).default(""),
      positioning:  z.string().max(2000).default(""),
      observations: z.string().max(2000).default(""),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const payload = {
      workspace_id: workspaceId,
      name:         data.name,
      website:      data.website,
      services:     data.services,
      offers:       data.offers,
      positioning:  data.positioning,
      observations: data.observations,
      updated_at:   new Date().toISOString(),
    };

    if (data.id) {
      const { error } = await sb
        .from("growthmind_competitors")
        .update(payload)
        .eq("id", data.id)
        .eq("workspace_id", workspaceId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await sb
        .from("growthmind_competitors")
        .insert({ ...payload, created_at: new Date().toISOString() });
      if (error) throw new Error(error.message);
    }

    return { ok: true };
  });

export const deleteCompetitor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { error } = await sb
      .from("growthmind_competitors")
      .delete()
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);

    if (error) throw new Error(error.message);
    return { ok: true };
  });
