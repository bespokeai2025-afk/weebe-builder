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

export const analyseCompetitors = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      platformData: z.any().optional(),
      personality:  z.string().default("professional"),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const settings = (context as any).settings ?? {};
    const apiKey   = process.env.OPENAI_API_KEY ?? settings.openai_api_key;
    if (!apiKey) throw new Error("OpenAI API key not configured. Add it in Settings → Integrations.");

    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data: rows, error } = await sb
      .from("growthmind_competitors")
      .select("name, website, services, offers, positioning, observations")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) throw new Error(error.message);
    if (!rows || rows.length === 0) return { analysis: "No competitors added yet. Add competitors to generate a competitive analysis." };

    const competitorSummary = rows.map((c: any, i: number) =>
      `${i + 1}. **${c.name}**${c.website ? ` (${c.website})` : ""}\n` +
      (c.services    ? `   Services: ${c.services}\n`    : "") +
      (c.offers      ? `   Offers: ${c.offers}\n`        : "") +
      (c.positioning ? `   Positioning: ${c.positioning}\n` : "") +
      (c.observations ? `   Observations: ${c.observations}\n` : "")
    ).join("\n");

    const systemPrompt = `You are GrowthMind, an AI Chief Marketing Officer. Your tone is ${
      data.personality === "friendly" ? "warm and practical" :
      data.personality === "concise"  ? "direct and brief" :
      "professional and strategic"
    }. You help identify competitive advantages and market opportunities based on competitor intelligence.`;

    const userPrompt = `Here is my competitor intelligence:\n\n${competitorSummary}\n\nAnalyse this competitive landscape in 3-4 sentences:\n1. The main differentiators I should emphasise to stand out\n2. A gap or weakness in their collective positioning I could exploit\n3. A specific threat I need to defend against\n\nBe concrete and actionable.`;

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model:       "gpt-4o",
        messages:    [{ role: "system", content: systemPrompt }, { role: "user", content: userPrompt }],
        max_tokens:  500,
        temperature: 0.7,
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`OpenAI error: ${err.slice(0, 200)}`);
    }
    const json = await res.json() as any;
    return { analysis: (json.choices?.[0]?.message?.content as string) ?? "" };
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
