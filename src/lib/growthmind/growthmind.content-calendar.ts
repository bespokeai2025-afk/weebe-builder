import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ContentType =
  | "Blog" | "LinkedIn Post" | "Facebook Post" | "Instagram Post"
  | "TikTok Post" | "X Post" | "Video Script" | "Lead Magnet"
  | "Case Study" | "Landing Page" | "Google Ad" | "Meta Ad"
  | "Referral Campaign" | "PR Campaign" | "Podcast Episode" | "Newsletter";

export const CONTENT_TYPES: ContentType[] = [
  "Blog", "LinkedIn Post", "Facebook Post", "Instagram Post",
  "TikTok Post", "X Post", "Video Script", "Lead Magnet",
  "Case Study", "Landing Page", "Google Ad", "Meta Ad",
  "Referral Campaign", "PR Campaign", "Podcast Episode", "Newsletter",
];

export type ContentStatus = "Draft" | "Planned" | "Scheduled" | "Published" | "Archived" | "Cancelled";
export const CONTENT_STATUSES: ContentStatus[] = ["Draft", "Planned", "Scheduled", "Published", "Archived", "Cancelled"];

export type CampaignType =
  | "SEO Campaign" | "Meta Campaign" | "Google Campaign"
  | "Brand Awareness" | "Referral Campaign" | "Launch Campaign" | "Product Campaign";

export const CAMPAIGN_TYPES: CampaignType[] = [
  "SEO Campaign", "Meta Campaign", "Google Campaign",
  "Brand Awareness", "Referral Campaign", "Launch Campaign", "Product Campaign",
];

export type SeriesCadence = "daily" | "weekly" | "biweekly" | "monthly";
export const CADENCES: SeriesCadence[] = ["daily", "weekly", "biweekly", "monthly"];

export const CONTENT_TYPE_COLORS: Record<string, string> = {
  "Blog":             "#10b981",
  "LinkedIn Post":    "#0ea5e9",
  "Facebook Post":    "#3b82f6",
  "Instagram Post":   "#f59e0b",
  "TikTok Post":      "#ec4899",
  "X Post":           "#8b5cf6",
  "Video Script":     "#ef4444",
  "Lead Magnet":      "#14b8a6",
  "Case Study":       "#6366f1",
  "Landing Page":     "#f97316",
  "Google Ad":        "#22c55e",
  "Meta Ad":          "#3b82f6",
  "Referral Campaign":"#d946ef",
  "PR Campaign":      "#06b6d4",
  "Podcast Episode":  "#84cc16",
  "Newsletter":       "#a78bfa",
};

export interface CalendarEntry {
  id:            string;
  title:         string;
  contentType:   ContentType;
  channel:       string;
  status:        ContentStatus;
  campaignId:    string | null;
  seriesId:      string | null;
  owner:         string;
  scheduledDate: string | null;
  description:   string;
  notes:         string;
  planId:        string | null;
  sortOrder:     number;
  createdAt:     string;
  updatedAt:     string;
}

export interface GrowthCampaign {
  id:           string;
  name:         string;
  campaignType: CampaignType;
  description:  string;
  startDate:    string | null;
  endDate:      string | null;
  budget:       number | null;
  status:       string;
  color:        string;
  createdAt:    string;
}

export interface ContentSeries {
  id:          string;
  name:        string;
  description: string;
  contentType: ContentType;
  cadence:     SeriesCadence;
  dayOfWeek:   number;
  channel:     string;
  isActive:    boolean;
  nextDate:    string | null;
  createdAt:   string;
}

// ── Calendar entries ──────────────────────────────────────────────────────────

export const getCalendarEntries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      startDate:   z.string().optional(),
      endDate:     z.string().optional(),
      status:      z.string().optional(),
      contentType: z.string().optional(),
      campaignId:  z.string().uuid().optional(),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    let q = sb
      .from("growthmind_content_calendar")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("scheduled_date", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(500);

    if (data.startDate) q = q.gte("scheduled_date", data.startDate);
    if (data.endDate)   q = q.lte("scheduled_date", data.endDate);
    if (data.status)    q = q.eq("status", data.status);
    if (data.contentType) q = q.eq("content_type", data.contentType);
    if (data.campaignId)  q = q.eq("campaign_id", data.campaignId);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const entries: CalendarEntry[] = (rows ?? []).map((r: any) => ({
      id:            r.id,
      title:         r.title,
      contentType:   r.content_type,
      channel:       r.channel        ?? "",
      status:        r.status,
      campaignId:    r.campaign_id    ?? null,
      seriesId:      r.series_id      ?? null,
      owner:         r.owner          ?? "",
      scheduledDate: r.scheduled_date ?? null,
      description:   r.description   ?? "",
      notes:         r.notes         ?? "",
      planId:        r.plan_id        ?? null,
      sortOrder:     r.sort_order     ?? 0,
      createdAt:     r.created_at,
      updatedAt:     r.updated_at,
    }));

    return { entries };
  });

export const saveCalendarEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id:            z.string().uuid().optional(),
      title:         z.string().min(1).max(500),
      contentType:   z.string().min(1),
      channel:       z.string().max(200).default(""),
      status:        z.string().default("Draft"),
      campaignId:    z.string().uuid().nullable().optional(),
      seriesId:      z.string().uuid().nullable().optional(),
      owner:         z.string().max(200).default(""),
      scheduledDate: z.string().nullable().optional(),
      description:   z.string().max(2000).default(""),
      notes:         z.string().max(2000).default(""),
      planId:        z.string().uuid().nullable().optional(),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const row = {
      workspace_id:   workspaceId,
      title:          data.title,
      content_type:   data.contentType,
      channel:        data.channel,
      status:         data.status,
      campaign_id:    data.campaignId   ?? null,
      series_id:      data.seriesId     ?? null,
      owner:          data.owner,
      scheduled_date: data.scheduledDate ?? null,
      description:    data.description,
      notes:          data.notes,
      plan_id:        data.planId       ?? null,
      updated_at:     new Date().toISOString(),
    };

    if (data.id) {
      const { error } = await sb
        .from("growthmind_content_calendar")
        .update(row)
        .eq("id", data.id)
        .eq("workspace_id", workspaceId);
      if (error) throw new Error(error.message);
      return { id: data.id };
    } else {
      const { data: inserted, error } = await sb
        .from("growthmind_content_calendar")
        .insert(row)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return { id: inserted.id as string };
    }
  });

export const deleteCalendarEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { error } = await sb
      .from("growthmind_content_calendar")
      .delete()
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Campaigns ─────────────────────────────────────────────────────────────────

export const getCampaigns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data, error } = await sb
      .from("growthmind_growth_campaigns")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);

    const campaigns: GrowthCampaign[] = (data ?? []).map((r: any) => ({
      id:           r.id,
      name:         r.name,
      campaignType: r.campaign_type,
      description:  r.description ?? "",
      startDate:    r.start_date  ?? null,
      endDate:      r.end_date    ?? null,
      budget:       r.budget      ?? null,
      status:       r.status,
      color:        r.color       ?? "#10b981",
      createdAt:    r.created_at,
    }));

    return { campaigns };
  });

export const saveCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id:           z.string().uuid().optional(),
      name:         z.string().min(1).max(300),
      campaignType: z.string().default("Brand Awareness"),
      description:  z.string().max(2000).default(""),
      startDate:    z.string().nullable().optional(),
      endDate:      z.string().nullable().optional(),
      budget:       z.number().nullable().optional(),
      status:       z.string().default("active"),
      color:        z.string().default("#10b981"),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const row = {
      workspace_id:  workspaceId,
      name:          data.name,
      campaign_type: data.campaignType,
      description:   data.description,
      start_date:    data.startDate ?? null,
      end_date:      data.endDate   ?? null,
      budget:        data.budget    ?? null,
      status:        data.status,
      color:         data.color,
      updated_at:    new Date().toISOString(),
    };

    if (data.id) {
      const { error } = await sb
        .from("growthmind_growth_campaigns")
        .update(row)
        .eq("id", data.id)
        .eq("workspace_id", workspaceId);
      if (error) throw new Error(error.message);
      return { id: data.id };
    } else {
      const { data: inserted, error } = await sb
        .from("growthmind_growth_campaigns")
        .insert(row)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return { id: inserted.id as string };
    }
  });

export const deleteCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { error } = await sb
      .from("growthmind_growth_campaigns")
      .delete()
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Content series ────────────────────────────────────────────────────────────

export const getSeries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data, error } = await sb
      .from("growthmind_content_series")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("name");
    if (error) throw new Error(error.message);

    const series: ContentSeries[] = (data ?? []).map((r: any) => ({
      id:          r.id,
      name:        r.name,
      description: r.description ?? "",
      contentType: r.content_type,
      cadence:     r.cadence,
      dayOfWeek:   r.day_of_week ?? 1,
      channel:     r.channel     ?? "",
      isActive:    r.is_active,
      nextDate:    r.next_date   ?? null,
      createdAt:   r.created_at,
    }));

    return { series };
  });

export const saveSeries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id:          z.string().uuid().optional(),
      name:        z.string().min(1).max(300),
      description: z.string().max(1000).default(""),
      contentType: z.string().default("Blog"),
      cadence:     z.enum(["daily", "weekly", "biweekly", "monthly"]).default("weekly"),
      dayOfWeek:   z.number().int().min(0).max(6).default(1),
      channel:     z.string().max(200).default(""),
      isActive:    z.boolean().default(true),
      nextDate:    z.string().nullable().optional(),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const row = {
      workspace_id: workspaceId,
      name:         data.name,
      description:  data.description,
      content_type: data.contentType,
      cadence:      data.cadence,
      day_of_week:  data.dayOfWeek,
      channel:      data.channel,
      is_active:    data.isActive,
      next_date:    data.nextDate ?? null,
      updated_at:   new Date().toISOString(),
    };

    if (data.id) {
      const { error } = await sb
        .from("growthmind_content_series")
        .update(row)
        .eq("id", data.id)
        .eq("workspace_id", workspaceId);
      if (error) throw new Error(error.message);
      return { id: data.id };
    } else {
      const { data: inserted, error } = await sb
        .from("growthmind_content_series")
        .insert(row)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return { id: inserted.id as string };
    }
  });

export const deleteSeries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { error } = await sb
      .from("growthmind_content_series")
      .delete()
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
