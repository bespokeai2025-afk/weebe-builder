import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const META_API_BASE = "https://graph.facebook.com/v19.0";

async function metaApi(
  method: "GET" | "POST",
  path: string,
  accessToken: string,
  body?: Record<string, unknown>,
): Promise<any> {
  let url: string;
  if (method === "GET") {
    const u = new URL(`${META_API_BASE}${path}`);
    u.searchParams.set("access_token", accessToken);
    url = u.toString();
  } else {
    url = `${META_API_BASE}${path}`;
  }

  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: method === "POST" ? JSON.stringify({ ...body, access_token: accessToken }) : undefined,
  });

  const data = await res.json();
  if (data.error) {
    throw new Error(`Meta API: ${data.error.message} (code ${data.error.code})`);
  }
  return data;
}

export const getMetaAdsSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data: ws } = await sb
      .from("workspaces")
      .select("settings")
      .eq("id", workspaceId)
      .maybeSingle();

    const s = ws?.settings ?? {};
    return {
      accessToken: (s.meta_ads_access_token ?? "") as string,
      adAccountId: (s.meta_ads_account_id   ?? "") as string,
      pageId:      (s.meta_ads_page_id      ?? "") as string,
      connected:   !!(s.meta_ads_access_token && s.meta_ads_account_id && s.meta_ads_page_id),
    };
  });

export const saveMetaAdsSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      accessToken: z.string().min(1),
      adAccountId: z.string().min(1),
      pageId:      z.string().min(1),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data: ws } = await sb
      .from("workspaces")
      .select("settings")
      .eq("id", workspaceId)
      .maybeSingle();

    const current = ws?.settings ?? {};
    const { error } = await sb
      .from("workspaces")
      .update({
        settings: {
          ...current,
          meta_ads_access_token: data.accessToken.trim(),
          meta_ads_account_id:   data.adAccountId.trim(),
          meta_ads_page_id:      data.pageId.trim(),
        },
      })
      .eq("id", workspaceId);

    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const verifyMetaCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      accessToken: z.string().min(1),
      adAccountId: z.string().min(1),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    try {
      const me   = await metaApi("GET", `/me`, data.accessToken);
      const acct = await metaApi(
        "GET",
        `/${data.adAccountId}?fields=name,account_status`,
        data.accessToken,
      );
      return { ok: true, userName: me.name as string, accountName: acct.name as string };
    } catch (err: any) {
      return { ok: false, error: err.message as string };
    }
  });

export const publishToMeta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      adContent:      z.string().min(1),
      adTitle:        z.string().min(1),
      campaignName:   z.string().min(1),
      destinationUrl: z.string().url(),
      dailyBudgetUsd: z.number().min(1).max(100000),
      objective:      z
        .enum(["OUTCOME_AWARENESS", "OUTCOME_TRAFFIC", "OUTCOME_LEADS"])
        .default("OUTCOME_AWARENESS"),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data: ws } = await sb
      .from("workspaces")
      .select("settings")
      .eq("id", workspaceId)
      .maybeSingle();

    const s = ws?.settings ?? {};
    const accessToken  = s.meta_ads_access_token as string | undefined;
    const adAccountId  = s.meta_ads_account_id   as string | undefined;
    const pageId       = s.meta_ads_page_id      as string | undefined;

    if (!accessToken || !adAccountId || !pageId) {
      throw new Error("Meta Ads not connected. Please save your credentials first.");
    }

    const optimizationGoal =
      data.objective === "OUTCOME_TRAFFIC" ? "LINK_CLICKS"
      : data.objective === "OUTCOME_LEADS" ? "LEAD_GENERATION"
      : "REACH";

    const campaign = await metaApi("POST", `/${adAccountId}/campaigns`, accessToken, {
      name:                  data.campaignName,
      objective:             data.objective,
      status:                "PAUSED",
      special_ad_categories: [],
    });

    const adSet = await metaApi("POST", `/${adAccountId}/adsets`, accessToken, {
      name:              `${data.campaignName} — Ad Set`,
      campaign_id:       campaign.id,
      daily_budget:      Math.round(data.dailyBudgetUsd * 100),
      billing_event:     "IMPRESSIONS",
      optimization_goal: optimizationGoal,
      targeting: {
        age_min: 18,
        age_max: 65,
        genders: [1, 2],
        geo_locations: { countries: ["US"] },
      },
      status:     "PAUSED",
      start_time: new Date(Date.now() + 3_600_000).toISOString(),
    });

    const creative = await metaApi("POST", `/${adAccountId}/adcreatives`, accessToken, {
      name: `${data.campaignName} — Creative`,
      object_story_spec: {
        page_id: pageId,
        link_data: {
          message:     data.adContent,
          link:        data.destinationUrl,
          name:        data.adTitle,
          description: data.adContent.slice(0, 90),
          call_to_action: {
            type:  "LEARN_MORE",
            value: { link: data.destinationUrl },
          },
        },
      },
    });

    await metaApi("POST", `/${adAccountId}/ads`, accessToken, {
      name:     `${data.campaignName} — Ad`,
      adset_id: adSet.id,
      creative: { creative_id: creative.id },
      status:   "PAUSED",
    });

    return {
      ok:         true,
      campaignId: campaign.id as string,
      adSetId:    adSet.id    as string,
      message:    "Ad created as draft (paused) in Meta Ads Manager.",
    };
  });
