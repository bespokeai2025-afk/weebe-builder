import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ── Types ─────────────────────────────────────────────────────────────────────

export type PlanType = "30_day" | "60_day" | "90_day" | "annual";
export type TaskStatus = "pending" | "in_progress" | "completed" | "cancelled";
export type TaskPriority = "low" | "medium" | "high" | "urgent";

export const PLAN_LABELS: Record<PlanType, string> = {
  "30_day":  "30-Day Growth Plan",
  "60_day":  "60-Day Growth Plan",
  "90_day":  "90-Day Growth Plan",
  "annual":  "Annual Growth Plan",
};

export const TASK_TYPES = [
  "Publish Blog", "Create Landing Page", "Record Video", "Launch Campaign",
  "Review Keywords", "Create Lead Magnet", "Write Email Sequence",
  "Set Up Google Ad", "Set Up Meta Ad", "Build Referral System",
  "Create Case Study", "Design Infographic", "Write Newsletter",
  "Post Social Content", "Build Funnel", "Create Podcast", "PR Outreach",
  "Review Analytics", "Update Website", "General",
];

export interface MarketingTask {
  id:               string;
  title:            string;
  description:      string;
  taskType:         string;
  status:           TaskStatus;
  priority:         TaskPriority;
  dueDate:          string | null;
  completedAt:      string | null;
  calendarEntryId:  string | null;
  campaignId:       string | null;
  planId:           string | null;
  createdAt:        string;
  updatedAt:        string;
}

export interface GrowthPlan {
  id:                  string;
  name:                string;
  planType:            PlanType;
  status:              string;
  businessType:        string;
  industry:            string;
  targetAudience:      string;
  offer:               string;
  monthlyBudget:       number | null;
  targetMarkets:       string;
  keywords:            string[];
  growthGoals:         string;
  targetLeadsPerMonth: number;
  generatedSummary:    string;
  generatedAt:         string | null;
  createdAt:           string;
  updatedAt:           string;
}

export interface MarketingReadiness {
  contentScore:  number;
  campaignScore: number;
  seoScore:      number;
  overallScore:  number;
}

// ── Growth Plans ──────────────────────────────────────────────────────────────

export const getGrowthPlans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data, error } = await sb
      .from("growthmind_growth_plans")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);

    const plans: GrowthPlan[] = (data ?? []).map((r: any) => ({
      id:                  r.id,
      name:                r.name,
      planType:            r.plan_type,
      status:              r.status,
      businessType:        r.business_type        ?? "",
      industry:            r.industry             ?? "",
      targetAudience:      r.target_audience      ?? "",
      offer:               r.offer                ?? "",
      monthlyBudget:       r.monthly_budget       ?? null,
      targetMarkets:       r.target_markets       ?? "",
      keywords:            r.keywords             ?? [],
      growthGoals:         r.growth_goals         ?? "",
      targetLeadsPerMonth: r.target_leads_per_month ?? 0,
      generatedSummary:    r.generated_summary    ?? "",
      generatedAt:         r.generated_at         ?? null,
      createdAt:           r.created_at,
      updatedAt:           r.updated_at,
    }));

    return { plans };
  });

export const saveGrowthPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id:                  z.string().uuid().optional(),
      name:                z.string().min(1).max(300),
      planType:            z.enum(["30_day", "60_day", "90_day", "annual"]).default("90_day"),
      status:              z.string().default("draft"),
      businessType:        z.string().max(200).default(""),
      industry:            z.string().max(200).default(""),
      targetAudience:      z.string().max(500).default(""),
      offer:               z.string().max(500).default(""),
      monthlyBudget:       z.number().nullable().optional(),
      targetMarkets:       z.string().max(500).default(""),
      keywords:            z.array(z.string()).default([]),
      growthGoals:         z.string().max(2000).default(""),
      targetLeadsPerMonth: z.number().int().default(0),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const row = {
      workspace_id:           workspaceId,
      name:                   data.name,
      plan_type:              data.planType,
      status:                 data.status,
      business_type:          data.businessType,
      industry:               data.industry,
      target_audience:        data.targetAudience,
      offer:                  data.offer,
      monthly_budget:         data.monthlyBudget ?? null,
      target_markets:         data.targetMarkets,
      keywords:               data.keywords,
      growth_goals:           data.growthGoals,
      target_leads_per_month: data.targetLeadsPerMonth,
      updated_at:             new Date().toISOString(),
    };

    if (data.id) {
      const { error } = await sb
        .from("growthmind_growth_plans")
        .update(row)
        .eq("id", data.id)
        .eq("workspace_id", workspaceId);
      if (error) throw new Error(error.message);
      return { id: data.id };
    } else {
      const { data: inserted, error } = await sb
        .from("growthmind_growth_plans")
        .insert(row)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return { id: inserted.id as string };
    }
  });

export const deleteGrowthPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { error } = await sb
      .from("growthmind_growth_plans")
      .delete()
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── AI Growth Plan Generation ─────────────────────────────────────────────────

const WEEK_TEMPLATES: Record<PlanType, Array<{ week: number; items: Array<{ type: string; taskType: string }> }>> = {
  "30_day": [
    { week: 1, items: [{ type: "Blog", taskType: "Publish Blog" }, { type: "LinkedIn Post", taskType: "Post Social Content" }, { type: "Landing Page", taskType: "Create Landing Page" }, { type: "Google Ad", taskType: "Set Up Google Ad" }] },
    { week: 2, items: [{ type: "Meta Ad", taskType: "Set Up Meta Ad" }, { type: "Lead Magnet", taskType: "Create Lead Magnet" }, { type: "Newsletter", taskType: "Write Newsletter" }, { type: "Case Study", taskType: "Create Case Study" }] },
    { week: 3, items: [{ type: "Video Script", taskType: "Record Video" }, { type: "Instagram Post", taskType: "Post Social Content" }, { type: "Referral Campaign", taskType: "Build Referral System" }, { type: "Blog", taskType: "Publish Blog" }] },
    { week: 4, items: [{ type: "Facebook Post", taskType: "Post Social Content" }, { type: "PR Campaign", taskType: "PR Outreach" }, { type: "LinkedIn Post", taskType: "Post Social Content" }, { type: "Review Analytics", taskType: "Review Analytics" }] },
  ],
  "60_day": [
    { week: 1, items: [{ type: "Blog", taskType: "Publish Blog" }, { type: "LinkedIn Post", taskType: "Post Social Content" }, { type: "Landing Page", taskType: "Create Landing Page" }, { type: "Google Ad", taskType: "Set Up Google Ad" }] },
    { week: 2, items: [{ type: "Meta Ad", taskType: "Set Up Meta Ad" }, { type: "Lead Magnet", taskType: "Create Lead Magnet" }, { type: "Newsletter", taskType: "Write Newsletter" }, { type: "Case Study", taskType: "Create Case Study" }] },
    { week: 3, items: [{ type: "Video Script", taskType: "Record Video" }, { type: "Instagram Post", taskType: "Post Social Content" }, { type: "Referral Campaign", taskType: "Build Referral System" }, { type: "Blog", taskType: "Publish Blog" }] },
    { week: 4, items: [{ type: "Facebook Post", taskType: "Post Social Content" }, { type: "PR Campaign", taskType: "PR Outreach" }, { type: "LinkedIn Post", taskType: "Post Social Content" }, { type: "Newsletter", taskType: "Write Newsletter" }] },
    { week: 5, items: [{ type: "Blog", taskType: "Publish Blog" }, { type: "TikTok Post", taskType: "Post Social Content" }, { type: "Google Ad", taskType: "Set Up Google Ad" }, { type: "Lead Magnet", taskType: "Create Lead Magnet" }] },
    { week: 6, items: [{ type: "Case Study", taskType: "Create Case Study" }, { type: "Landing Page", taskType: "Create Landing Page" }, { type: "Meta Ad", taskType: "Set Up Meta Ad" }, { type: "Podcast Episode", taskType: "Create Podcast" }] },
    { week: 7, items: [{ type: "Video Script", taskType: "Record Video" }, { type: "LinkedIn Post", taskType: "Post Social Content" }, { type: "Blog", taskType: "Publish Blog" }, { type: "Newsletter", taskType: "Write Newsletter" }] },
    { week: 8, items: [{ type: "X Post", taskType: "Post Social Content" }, { type: "Referral Campaign", taskType: "Build Referral System" }, { type: "PR Campaign", taskType: "PR Outreach" }, { type: "Review Analytics", taskType: "Review Analytics" }] },
  ],
  "90_day": [
    { week: 1,  items: [{ type: "Blog", taskType: "Publish Blog" }, { type: "LinkedIn Post", taskType: "Post Social Content" }, { type: "Landing Page", taskType: "Create Landing Page" }, { type: "Google Ad", taskType: "Set Up Google Ad" }] },
    { week: 2,  items: [{ type: "Meta Ad", taskType: "Set Up Meta Ad" }, { type: "Lead Magnet", taskType: "Create Lead Magnet" }, { type: "Newsletter", taskType: "Write Newsletter" }, { type: "Case Study", taskType: "Create Case Study" }] },
    { week: 3,  items: [{ type: "Video Script", taskType: "Record Video" }, { type: "Instagram Post", taskType: "Post Social Content" }, { type: "Referral Campaign", taskType: "Build Referral System" }, { type: "Blog", taskType: "Publish Blog" }] },
    { week: 4,  items: [{ type: "Facebook Post", taskType: "Post Social Content" }, { type: "PR Campaign", taskType: "PR Outreach" }, { type: "LinkedIn Post", taskType: "Post Social Content" }, { type: "Newsletter", taskType: "Write Newsletter" }] },
    { week: 5,  items: [{ type: "Blog", taskType: "Publish Blog" }, { type: "TikTok Post", taskType: "Post Social Content" }, { type: "Google Ad", taskType: "Set Up Google Ad" }, { type: "Lead Magnet", taskType: "Create Lead Magnet" }] },
    { week: 6,  items: [{ type: "Case Study", taskType: "Create Case Study" }, { type: "Landing Page", taskType: "Create Landing Page" }, { type: "Meta Ad", taskType: "Set Up Meta Ad" }, { type: "Podcast Episode", taskType: "Create Podcast" }] },
    { week: 7,  items: [{ type: "Video Script", taskType: "Record Video" }, { type: "LinkedIn Post", taskType: "Post Social Content" }, { type: "Blog", taskType: "Publish Blog" }, { type: "Newsletter", taskType: "Write Newsletter" }] },
    { week: 8,  items: [{ type: "X Post", taskType: "Post Social Content" }, { type: "Referral Campaign", taskType: "Build Referral System" }, { type: "Instagram Post", taskType: "Post Social Content" }, { type: "Blog", taskType: "Publish Blog" }] },
    { week: 9,  items: [{ type: "Google Ad", taskType: "Set Up Google Ad" }, { type: "Case Study", taskType: "Create Case Study" }, { type: "Blog", taskType: "Publish Blog" }, { type: "LinkedIn Post", taskType: "Post Social Content" }] },
    { week: 10, items: [{ type: "Newsletter", taskType: "Write Newsletter" }, { type: "Landing Page", taskType: "Create Landing Page" }, { type: "Video Script", taskType: "Record Video" }, { type: "TikTok Post", taskType: "Post Social Content" }] },
    { week: 11, items: [{ type: "Lead Magnet", taskType: "Create Lead Magnet" }, { type: "Meta Ad", taskType: "Set Up Meta Ad" }, { type: "PR Campaign", taskType: "PR Outreach" }, { type: "Blog", taskType: "Publish Blog" }] },
    { week: 12, items: [{ type: "Referral Campaign", taskType: "Build Referral System" }, { type: "LinkedIn Post", taskType: "Post Social Content" }, { type: "Case Study", taskType: "Create Case Study" }, { type: "Review Analytics", taskType: "Review Analytics" }] },
  ],
  "annual": [
    { week: 1,  items: [{ type: "Blog", taskType: "Publish Blog" }, { type: "Landing Page", taskType: "Create Landing Page" }, { type: "Google Ad", taskType: "Set Up Google Ad" }, { type: "Newsletter", taskType: "Write Newsletter" }] },
    { week: 2,  items: [{ type: "Lead Magnet", taskType: "Create Lead Magnet" }, { type: "LinkedIn Post", taskType: "Post Social Content" }, { type: "Meta Ad", taskType: "Set Up Meta Ad" }, { type: "Case Study", taskType: "Create Case Study" }] },
    { week: 3,  items: [{ type: "Video Script", taskType: "Record Video" }, { type: "Instagram Post", taskType: "Post Social Content" }, { type: "Blog", taskType: "Publish Blog" }, { type: "Referral Campaign", taskType: "Build Referral System" }] },
    { week: 4,  items: [{ type: "PR Campaign", taskType: "PR Outreach" }, { type: "Facebook Post", taskType: "Post Social Content" }, { type: "Newsletter", taskType: "Write Newsletter" }, { type: "Review Analytics", taskType: "Review Analytics" }] },
    { week: 5,  items: [{ type: "Blog", taskType: "Publish Blog" }, { type: "Google Ad", taskType: "Set Up Google Ad" }, { type: "TikTok Post", taskType: "Post Social Content" }, { type: "Landing Page", taskType: "Create Landing Page" }] },
    { week: 6,  items: [{ type: "LinkedIn Post", taskType: "Post Social Content" }, { type: "Meta Ad", taskType: "Set Up Meta Ad" }, { type: "Lead Magnet", taskType: "Create Lead Magnet" }, { type: "Blog", taskType: "Publish Blog" }] },
    { week: 7,  items: [{ type: "Podcast Episode", taskType: "Create Podcast" }, { type: "Case Study", taskType: "Create Case Study" }, { type: "Newsletter", taskType: "Write Newsletter" }, { type: "Video Script", taskType: "Record Video" }] },
    { week: 8,  items: [{ type: "X Post", taskType: "Post Social Content" }, { type: "Blog", taskType: "Publish Blog" }, { type: "Referral Campaign", taskType: "Build Referral System" }, { type: "Google Ad", taskType: "Set Up Google Ad" }] },
    { week: 9,  items: [{ type: "Instagram Post", taskType: "Post Social Content" }, { type: "Meta Ad", taskType: "Set Up Meta Ad" }, { type: "Blog", taskType: "Publish Blog" }, { type: "Lead Magnet", taskType: "Create Lead Magnet" }] },
    { week: 10, items: [{ type: "PR Campaign", taskType: "PR Outreach" }, { type: "LinkedIn Post", taskType: "Post Social Content" }, { type: "Newsletter", taskType: "Write Newsletter" }, { type: "Landing Page", taskType: "Create Landing Page" }] },
    { week: 11, items: [{ type: "Case Study", taskType: "Create Case Study" }, { type: "TikTok Post", taskType: "Post Social Content" }, { type: "Blog", taskType: "Publish Blog" }, { type: "Video Script", taskType: "Record Video" }] },
    { week: 12, items: [{ type: "Referral Campaign", taskType: "Build Referral System" }, { type: "Google Ad", taskType: "Set Up Google Ad" }, { type: "Meta Ad", taskType: "Set Up Meta Ad" }, { type: "Review Analytics", taskType: "Review Analytics" }] },
  ],
};

export const generateGrowthPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      planId:              z.string().uuid(),
      planType:            z.enum(["30_day", "60_day", "90_day", "annual"]).default("90_day"),
      businessType:        z.string().default(""),
      industry:            z.string().default(""),
      targetAudience:      z.string().default(""),
      offer:               z.string().default(""),
      monthlyBudget:       z.number().nullable().optional(),
      keywords:            z.array(z.string()).default([]),
      growthGoals:         z.string().default(""),
      targetLeadsPerMonth: z.number().int().default(0),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const settings = (context as any).settings ?? {};
    const apiKey   = process.env.OPENAI_API_KEY ?? settings.openai_api_key;

    const weeks = WEEK_TEMPLATES[data.planType] ?? WEEK_TEMPLATES["90_day"];
    const startDate = new Date();
    startDate.setHours(9, 0, 0, 0);

    const calendarRows: any[]  = [];
    const taskRows:     any[]  = [];
    const contentTitles: string[] = [];

    // Try AI-generated titles first
    let aiTitles: string[] | null = null;
    if (apiKey) {
      try {
        const totalItems = weeks.reduce((n, w) => n + w.items.length, 0);
        const typeList   = weeks.flatMap(w => w.items.map(i => i.type)).join(", ");
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method:  "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model:    "gpt-4o-mini",
            messages: [{
              role: "user",
              content: `You are GrowthMind, an AI CMO. Generate ${totalItems} content titles for a ${data.planType.replace("_", "-")} marketing plan for a ${data.businessType || "business"} in the ${data.industry || "general"} industry targeting ${data.targetAudience || "new leads"}. Their offer: ${data.offer || "services"}. Growth goal: ${data.growthGoals || "increase leads"}.

Content types in order: ${typeList}

Rules:
- One title per line, numbered 1-${totalItems}
- Each title should be specific, benefit-driven, and relevant to the industry
- Keep titles under 80 characters
- No quotes, no extra text

Return ONLY the numbered list.`,
            }],
            max_tokens:  1200,
            temperature: 0.7,
          }),
        });
        if (res.ok) {
          const json = await res.json() as any;
          const text = (json.choices?.[0]?.message?.content as string ?? "").trim();
          aiTitles = text
            .split("\n")
            .map((l: string) => l.replace(/^\d+\.\s*/, "").trim())
            .filter((l: string) => l.length > 3);
        }
      } catch {}
    }

    let titleIdx = 0;
    const FALLBACK_TITLES: Record<string, string[]> = {
      "Blog":             ["How to Generate More Leads in Your Industry", "The Ultimate Guide to Growing Your Business", "5 Marketing Strategies That Actually Work"],
      "LinkedIn Post":    ["Why Most Businesses Struggle With Lead Generation", "Our #1 Secret for Consistent Growth", "The Mindset Shift That Changed Our Marketing"],
      "Facebook Post":    ["Struggling with leads? Here's what we found.", "We tried 10 marketing tactics. Here's what worked.", "Client result worth sharing 🚀"],
      "Instagram Post":   ["Behind the scenes of our lead gen system", "Results don't lie — here's our growth story", "Marketing tip of the week"],
      "TikTok Post":      ["Marketing hack your competitors don't know", "How we doubled leads in 30 days", "The one thing that changed our business"],
      "X Post":           ["Hot take: most marketing advice is wrong", "Lead gen thread 🧵", "Our best performing content this month"],
      "Video Script":     ["How We Generate 50+ Leads a Month", "The Marketing System That Scales", "Client Success Story Interview"],
      "Lead Magnet":      ["Free Guide: 10 Ways to Get More Clients", "The Lead Generation Checklist", "Download: Growth Strategy Template"],
      "Case Study":       ["How We Helped a Client Double Their Leads", "From 10 to 100 Leads: A Growth Story", "Client Success: 3x ROI in 60 Days"],
      "Landing Page":     ["Get Your Free Consultation Today", "Join 500+ Businesses Growing With Us", "Start Your Growth Journey"],
      "Google Ad":        ["Looking for More Clients? We Can Help", "Trusted by 500+ Businesses — Get Started", "Affordable Marketing That Delivers Results"],
      "Meta Ad":          ["Still Struggling With Lead Generation?", "We Help Businesses Get More Clients", "Book a Free Strategy Call Today"],
      "Referral Campaign":["Refer a Friend — Earn Rewards", "Our Referral Program Is Live!", "Get £50 for Every Referral That Converts"],
      "PR Campaign":      ["New Service Launch Press Release", "Thought Leadership Feature in Industry Press", "Award Submission: Business Excellence"],
      "Podcast Episode":  ["Episode: Marketing Secrets for Growth", "Interview: How to Scale Without Burnout", "Episode: The Leads System That Works"],
      "Newsletter":       ["Monthly Marketing Update", "This Month in Growth: Insights & Tips", "Your Marketing Round-Up — What Worked"],
    };

    for (const week of weeks) {
      const weekStart = new Date(startDate);
      weekStart.setDate(weekStart.getDate() + (week.week - 1) * 7);

      for (let itemIdx = 0; itemIdx < week.items.length; itemIdx++) {
        const item = week.items[itemIdx];
        const itemDate = new Date(weekStart);
        itemDate.setDate(itemDate.getDate() + [1, 2, 3, 4][itemIdx % 4]);

        let title: string;
        if (aiTitles && aiTitles[titleIdx]) {
          title = aiTitles[titleIdx];
        } else {
          const pool = FALLBACK_TITLES[item.type] ?? ["Marketing Content"];
          title = pool[titleIdx % pool.length] ?? pool[0];
        }
        titleIdx++;

        contentTitles.push(title);

        calendarRows.push({
          workspace_id:   workspaceId,
          title,
          content_type:   item.type,
          channel:        item.type.includes("Post") ? item.type.replace(" Post", "") : "",
          status:         "Planned",
          scheduled_date: itemDate.toISOString(),
          plan_id:        data.planId,
          description:    `Week ${week.week} — Generated by ${PLAN_LABELS[data.planType] ?? "Growth Plan"}`,
          created_at:     new Date().toISOString(),
          updated_at:     new Date().toISOString(),
        });

        const taskDue = new Date(itemDate);
        taskDue.setDate(taskDue.getDate() - 2);
        taskRows.push({
          workspace_id: workspaceId,
          title:        `${item.taskType}: ${title}`,
          description:  `Week ${week.week} task from ${PLAN_LABELS[data.planType] ?? "Growth Plan"}`,
          task_type:    item.taskType,
          status:       "pending",
          priority:     week.week <= 2 ? "high" : "medium",
          due_date:     taskDue.toISOString().split("T")[0],
          plan_id:      data.planId,
          created_at:   new Date().toISOString(),
          updated_at:   new Date().toISOString(),
        });
      }
    }

    // Batch insert
    const { error: calErr } = await sb.from("growthmind_content_calendar").insert(calendarRows);
    if (calErr) throw new Error("Calendar insert failed: " + calErr.message);

    const { error: taskErr } = await sb.from("growthmind_marketing_tasks").insert(taskRows);
    if (taskErr) throw new Error("Task insert failed: " + taskErr.message);

    // Build AI summary
    let summary = `Generated ${calendarRows.length} content items and ${taskRows.length} marketing tasks covering ${weeks.length} weeks for your ${PLAN_LABELS[data.planType] ?? "growth plan"}.`;
    if (apiKey) {
      try {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method:  "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model:    "gpt-4o-mini",
            messages: [{
              role: "user",
              content: `Write a 2-sentence executive summary for a ${data.planType.replace("_", "-")} marketing plan for a ${data.businessType || "business"} in ${data.industry || "their industry"} targeting ${data.targetLeadsPerMonth} leads/month. The plan includes ${calendarRows.length} pieces of content across ${weeks.length} weeks. Be motivational and specific. Return ONLY 2 sentences.`,
            }],
            max_tokens:  100,
            temperature: 0.5,
          }),
        });
        if (res.ok) {
          const json = await res.json() as any;
          const txt = (json.choices?.[0]?.message?.content as string ?? "").trim();
          if (txt) summary = txt;
        }
      } catch {}
    }

    // Update plan with generated_at and summary
    await sb.from("growthmind_growth_plans")
      .update({ generated_at: new Date().toISOString(), generated_summary: summary, status: "active", updated_at: new Date().toISOString() })
      .eq("id", data.planId)
      .eq("workspace_id", workspaceId);

    return {
      calendarCount: calendarRows.length,
      taskCount:     taskRows.length,
      summary,
    };
  });

// ── Marketing Tasks ───────────────────────────────────────────────────────────

export const getMarketingTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      status: z.string().optional(),
      planId: z.string().uuid().optional(),
      limit:  z.number().int().max(200).default(100),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    let q = sb
      .from("growthmind_marketing_tasks")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("due_date", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(data.limit);

    if (data.status) q = q.eq("status", data.status);
    if (data.planId) q = q.eq("plan_id", data.planId);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const tasks: MarketingTask[] = (rows ?? []).map((r: any) => ({
      id:              r.id,
      title:           r.title,
      description:     r.description      ?? "",
      taskType:        r.task_type,
      status:          r.status,
      priority:        r.priority,
      dueDate:         r.due_date          ?? null,
      completedAt:     r.completed_at      ?? null,
      calendarEntryId: r.calendar_entry_id ?? null,
      campaignId:      r.campaign_id       ?? null,
      planId:          r.plan_id           ?? null,
      createdAt:       r.created_at,
      updatedAt:       r.updated_at,
    }));

    return { tasks };
  });

export const saveMarketingTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id:          z.string().uuid().optional(),
      title:       z.string().min(1).max(500),
      description: z.string().max(2000).default(""),
      taskType:    z.string().default("General"),
      status:      z.enum(["pending", "in_progress", "completed", "cancelled"]).default("pending"),
      priority:    z.enum(["low", "medium", "high", "urgent"]).default("medium"),
      dueDate:     z.string().nullable().optional(),
      campaignId:  z.string().uuid().nullable().optional(),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const row = {
      workspace_id: workspaceId,
      title:        data.title,
      description:  data.description,
      task_type:    data.taskType,
      status:       data.status,
      priority:     data.priority,
      due_date:     data.dueDate     ?? null,
      campaign_id:  data.campaignId  ?? null,
      updated_at:   new Date().toISOString(),
    };

    if (data.id) {
      const { error } = await sb
        .from("growthmind_marketing_tasks")
        .update(row)
        .eq("id", data.id)
        .eq("workspace_id", workspaceId);
      if (error) throw new Error(error.message);
      return { id: data.id };
    } else {
      const { data: inserted, error } = await sb
        .from("growthmind_marketing_tasks")
        .insert(row)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      return { id: inserted.id as string };
    }
  });

export const completeMarketingTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { error } = await sb
      .from("growthmind_marketing_tasks")
      .update({ status: "completed", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteMarketingTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { error } = await sb
      .from("growthmind_marketing_tasks")
      .delete()
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Marketing Readiness ───────────────────────────────────────────────────────

export const getMarketingReadiness = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const now    = new Date();
    const past30 = new Date(now); past30.setDate(past30.getDate() - 30);
    const next30 = new Date(now); next30.setDate(next30.getDate() + 30);

    const [calendarRes, campaignsRes, seoRes, tasksRes] = await Promise.all([
      sb.from("growthmind_content_calendar").select("id, status, content_type, scheduled_date")
        .eq("workspace_id", workspaceId)
        .gte("scheduled_date", past30.toISOString())
        .lte("scheduled_date", next30.toISOString()),
      sb.from("growthmind_growth_campaigns").select("id, status")
        .eq("workspace_id", workspaceId)
        .eq("status", "active"),
      sb.from("growthmind_seo_sites").select("id")
        .eq("workspace_id", workspaceId)
        .limit(1),
      sb.from("growthmind_marketing_tasks").select("id, status, due_date")
        .eq("workspace_id", workspaceId)
        .neq("status", "cancelled"),
    ]);

    const entries    = calendarRes.data  ?? [];
    const campaigns  = campaignsRes.data ?? [];
    const seoSites   = seoRes.data       ?? [];
    const allTasks   = tasksRes.data     ?? [];

    const published    = entries.filter((e: any) => e.status === "Published").length;
    const scheduled    = entries.filter((e: any) => e.status === "Scheduled").length;
    const planned      = entries.filter((e: any) => e.status === "Planned").length;
    const totalEntries = entries.length;

    const contentScore = totalEntries === 0 ? 0
      : Math.min(100, Math.round(
          ((published * 1.0 + scheduled * 0.8 + planned * 0.5) / Math.max(totalEntries, 8)) * 100,
        ));

    const campaignScore = Math.min(100, campaigns.length * 20);

    const seoScore = seoSites.length > 0 ? 70 : 10;

    const completedTasks = allTasks.filter((t: any) => t.status === "completed").length;
    const totalActiveTasks = allTasks.filter((t: any) => t.status !== "cancelled").length;
    const taskScore = totalActiveTasks === 0 ? 50
      : Math.min(100, Math.round((completedTasks / totalActiveTasks) * 100));

    const overallScore = Math.round((contentScore + campaignScore + seoScore + taskScore) / 4);

    return {
      contentScore,
      campaignScore,
      seoScore,
      overallScore,
      taskScore,
      stats: {
        totalEntries,
        published,
        scheduled,
        planned,
        activeCampaigns: campaigns.length,
        pendingTasks:    allTasks.filter((t: any) => t.status === "pending").length,
        overdueTasks:    allTasks.filter((t: any) => t.status === "pending" && t.due_date && new Date(t.due_date) < now).length,
      },
    } satisfies MarketingReadiness & { taskScore: number; stats: any };
  });
