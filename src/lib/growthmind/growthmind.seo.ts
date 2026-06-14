import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ── Types ───────────────────────────────────────────────────────────────────

export type SeoKeyword = {
  id:         string;
  term:       string;
  volume:     number | null;
  difficulty: number | null;
  rank:       number | null;
};

export type ContentIdea = {
  id:            string;
  title:         string;
  targetKeyword: string;
  status:        "idea" | "in-progress" | "published";
};

export type SeoSite = {
  id:           string;
  url:          string;
  keywords:     SeoKeyword[];
  contentIdeas: ContentIdea[];
  createdAt:    string;
  updatedAt:    string;
};

// ── Server functions ─────────────────────────────────────────────────────────

export const getSeoSite = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data } = await sb
      .from("growthmind_seo_sites")
      .select("id, url, keywords, content_ideas, created_at, updated_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data) return { site: null };

    return {
      site: {
        id:           data.id,
        url:          data.url,
        keywords:     (data.keywords     ?? []) as SeoKeyword[],
        contentIdeas: (data.content_ideas ?? []) as ContentIdea[],
        createdAt:    data.created_at,
        updatedAt:    data.updated_at,
      } as SeoSite,
    };
  });

export const saveSeoSite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id:           z.string().uuid().optional(),
      url:          z.string().url("Please enter a valid URL"),
      keywords:     z.array(z.object({
        id:         z.string(),
        term:       z.string(),
        volume:     z.number().nullable(),
        difficulty: z.number().min(0).max(100).nullable(),
        rank:       z.number().nullable(),
      })).default([]),
      contentIdeas: z.array(z.object({
        id:            z.string(),
        title:         z.string(),
        targetKeyword: z.string(),
        status:        z.enum(["idea","in-progress","published"]),
      })).default([]),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const payload = {
      workspace_id:  workspaceId,
      url:           data.url,
      keywords:      data.keywords,
      content_ideas: data.contentIdeas,
      updated_at:    new Date().toISOString(),
    };

    if (data.id) {
      const { error } = await sb
        .from("growthmind_seo_sites")
        .update(payload)
        .eq("id", data.id)
        .eq("workspace_id", workspaceId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await sb
        .from("growthmind_seo_sites")
        .insert({ ...payload, created_at: new Date().toISOString() });
      if (error) throw new Error(error.message);
    }

    return { ok: true };
  });
