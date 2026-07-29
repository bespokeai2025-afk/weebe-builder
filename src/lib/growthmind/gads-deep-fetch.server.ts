/**
 * GrowthMind Google Ads — DEEP read-only data fetch for campaign analysis.
 *
 * Pulls row-level structure and performance for one campaign (or the whole
 * account) directly from the Google Ads API via GAQL: campaign settings +
 * impression share, ad groups, keywords (with quality score), search terms,
 * ads (RSA assets), conversion actions, device/geo/day segments and
 * campaign-level criteria (locations, languages, ad schedule, negatives).
 *
 * HONESTY RULES:
 * - Every section is fault-isolated: a failed GAQL query records an error for
 *   that section instead of inventing empty "zero" data.
 * - This module NEVER mutates anything in Google Ads — GAQL search only.
 */
import {
  gaqlSearch,
  loadGadsCreds,
  type GaqlOptions,
} from "@/lib/growthmind/gads-live-core.server";

export interface DeepSection<T> {
  rows: T[];
  error: string | null;
  fetchedAt: string;
}

export interface GadsDeepData {
  campaign: DeepSection<any>;
  campaignDaily: DeepSection<any>;
  campaignCriteria: DeepSection<any>;
  adGroups: DeepSection<any>;
  keywords: DeepSection<any>;
  searchTerms: DeepSection<any>;
  ads: DeepSection<any>;
  conversionActions: DeepSection<any>;
  conversionsByAction: DeepSection<any>;
  deviceStats: DeepSection<any>;
  geoStats: DeepSection<any>;
  dayOfWeekStats: DeepSection<any>;
  meta: {
    customerId: string;
    campaignId: string | null;
    dateFrom: string;
    dateTo: string;
    fetchedAt: string;
    sectionErrors: string[];
  };
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const daysAgoIso = (n: number) => isoDate(new Date(Date.now() - n * 86_400_000));

const micros = (v: any) => (v != null ? Number(v) / 1_000_000 : null);
const num = (v: any) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);

function mapMetrics(m: any): Record<string, number | null> {
  m = m ?? {};
  return {
    cost: micros(m.costMicros) ?? 0,
    impressions: num(m.impressions) ?? 0,
    clicks: num(m.clicks) ?? 0,
    conversions: num(m.conversions) ?? 0,
    conversionsValue: num(m.conversionsValue) ?? 0,
    allConversions: num(m.allConversions),
    ctr: num(m.ctr),
    averageCpc: micros(m.averageCpc),
  };
}

async function section<T>(
  label: string,
  errors: string[],
  fn: () => Promise<T[]>,
): Promise<DeepSection<T>> {
  const fetchedAt = new Date().toISOString();
  try {
    const rows = await fn();
    return { rows, error: null, fetchedAt };
  } catch (err: any) {
    const msg = (err?.message ?? String(err)).slice(0, 300);
    errors.push(`${label}: ${msg}`);
    return { rows: [], error: msg, fetchedAt };
  }
}

/**
 * Fetch deep, row-level Google Ads data for one campaign.
 * `campaignId` null = whole account (campaign sections still returned per campaign).
 */
export async function fetchGadsDeepData(args: {
  workspaceId: string;
  customerId: string;
  loginCustomerId?: string | null;
  campaignId?: string | null;
  days?: number;
}): Promise<GadsDeepData> {
  const days = Math.min(Math.max(Number(args.days) || 30, 7), 90);
  const dateTo = isoDate(new Date());
  const dateFrom = daysAgoIso(days);
  const creds = await loadGadsCreds(args.workspaceId);
  const opts: GaqlOptions = {
    workspaceId: args.workspaceId,
    customerId: args.customerId,
    loginCustomerId: args.loginCustomerId ?? null,
    creds,
  };
  const campFilter = args.campaignId ? `AND campaign.id = ${Number(args.campaignId)}` : "";
  const campWhere = args.campaignId ? `WHERE campaign.id = ${Number(args.campaignId)}` : "";
  const dateRange = `segments.date BETWEEN '${dateFrom}' AND '${dateTo}'`;
  const errors: string[] = [];

  // 1. Campaign settings + aggregated metrics incl. impression share
  const campaign = await section("campaign", errors, async () => {
    const rows = await gaqlSearch(opts, `
      SELECT campaign.id, campaign.name, campaign.status,
             campaign.advertising_channel_type, campaign.bidding_strategy_type,
             campaign.start_date, campaign.serving_status,
             campaign.network_settings.target_google_search,
             campaign.network_settings.target_search_network,
             campaign.network_settings.target_content_network,
             campaign_budget.amount_micros, campaign_budget.delivery_method,
             metrics.cost_micros, metrics.impressions, metrics.clicks,
             metrics.conversions, metrics.conversions_value, metrics.all_conversions,
             metrics.ctr, metrics.average_cpc,
             metrics.search_impression_share,
             metrics.search_budget_lost_impression_share,
             metrics.search_rank_lost_impression_share,
             metrics.search_top_impression_share,
             metrics.search_absolute_top_impression_share
      FROM campaign
      WHERE ${dateRange} AND campaign.status != 'REMOVED' ${campFilter}
    `.trim());
    return rows.map((r: any) => ({
      id: String(r.campaign?.id ?? ""),
      name: r.campaign?.name ?? null,
      status: r.campaign?.status ?? null,
      channelType: r.campaign?.advertisingChannelType ?? null,
      biddingStrategyType: r.campaign?.biddingStrategyType ?? null,
      startDate: r.campaign?.startDate ?? null,
      servingStatus: r.campaign?.servingStatus ?? null,
      networks: {
        googleSearch: r.campaign?.networkSettings?.targetGoogleSearch ?? null,
        searchPartners: r.campaign?.networkSettings?.targetSearchNetwork ?? null,
        display: r.campaign?.networkSettings?.targetContentNetwork ?? null,
      },
      dailyBudget: micros(r.campaignBudget?.amountMicros),
      budgetDeliveryMethod: r.campaignBudget?.deliveryMethod ?? null,
      searchImpressionShare: num(r.metrics?.searchImpressionShare),
      searchBudgetLostIS: num(r.metrics?.searchBudgetLostImpressionShare),
      searchRankLostIS: num(r.metrics?.searchRankLostImpressionShare),
      searchTopIS: num(r.metrics?.searchTopImpressionShare),
      searchAbsTopIS: num(r.metrics?.searchAbsoluteTopImpressionShare),
      ...mapMetrics(r.metrics),
    }));
  });

  // 2. Daily trend for the campaign(s)
  const campaignDaily = await section("campaign_daily", errors, async () => {
    const rows = await gaqlSearch(opts, `
      SELECT campaign.id, segments.date,
             metrics.cost_micros, metrics.impressions, metrics.clicks,
             metrics.conversions, metrics.conversions_value
      FROM campaign
      WHERE ${dateRange} AND campaign.status != 'REMOVED' ${campFilter}
    `.trim());
    return rows.map((r: any) => ({
      campaignId: String(r.campaign?.id ?? ""),
      date: r.segments?.date ?? null,
      ...mapMetrics(r.metrics),
    }));
  });

  // 3. Campaign criteria: locations, languages, ad schedule, campaign negatives
  const campaignCriteria = await section("campaign_criteria", errors, async () => {
    const rows = await gaqlSearch(opts, `
      SELECT campaign.id, campaign_criterion.type, campaign_criterion.negative,
             campaign_criterion.status, campaign_criterion.bid_modifier,
             campaign_criterion.location.geo_target_constant,
             campaign_criterion.keyword.text, campaign_criterion.keyword.match_type,
             campaign_criterion.language.language_constant,
             campaign_criterion.ad_schedule.day_of_week,
             campaign_criterion.ad_schedule.start_hour,
             campaign_criterion.ad_schedule.end_hour,
             campaign_criterion.device.type
      FROM campaign_criterion
      ${campWhere}
    `.trim());
    return rows.map((r: any) => {
      const c = r.campaignCriterion ?? {};
      return {
        campaignId: String(r.campaign?.id ?? ""),
        type: c.type ?? null,
        negative: Boolean(c.negative),
        status: c.status ?? null,
        bidModifier: num(c.bidModifier),
        location: c.location?.geoTargetConstant ?? null,
        keywordText: c.keyword?.text ?? null,
        keywordMatchType: c.keyword?.matchType ?? null,
        language: c.language?.languageConstant ?? null,
        adScheduleDay: c.adSchedule?.dayOfWeek ?? null,
        adScheduleStartHour: c.adSchedule?.startHour ?? null,
        adScheduleEndHour: c.adSchedule?.endHour ?? null,
        deviceType: c.device?.type ?? null,
      };
    });
  });

  // 4. Ad groups
  const adGroups = await section("ad_groups", errors, async () => {
    const rows = await gaqlSearch(opts, `
      SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.type,
             ad_group.cpc_bid_micros, campaign.id,
             metrics.cost_micros, metrics.impressions, metrics.clicks,
             metrics.conversions, metrics.conversions_value, metrics.ctr, metrics.average_cpc
      FROM ad_group
      WHERE ${dateRange} AND ad_group.status != 'REMOVED' ${campFilter}
    `.trim());
    return rows.map((r: any) => ({
      id: String(r.adGroup?.id ?? ""),
      name: r.adGroup?.name ?? null,
      status: r.adGroup?.status ?? null,
      type: r.adGroup?.type ?? null,
      cpcBid: micros(r.adGroup?.cpcBidMicros),
      campaignId: String(r.campaign?.id ?? ""),
      ...mapMetrics(r.metrics),
    }));
  });

  // 5. Keywords with quality score components
  const keywords = await section("keywords", errors, async () => {
    const rows = await gaqlSearch(opts, `
      SELECT ad_group_criterion.criterion_id, ad_group_criterion.keyword.text,
             ad_group_criterion.keyword.match_type, ad_group_criterion.status,
             ad_group_criterion.negative,
             ad_group_criterion.quality_info.quality_score,
             ad_group_criterion.quality_info.creative_quality_score,
             ad_group_criterion.quality_info.post_click_quality_score,
             ad_group_criterion.quality_info.search_predicted_ctr,
             ad_group_criterion.effective_cpc_bid_micros,
             ad_group.id, ad_group.name, campaign.id,
             metrics.cost_micros, metrics.impressions, metrics.clicks,
             metrics.conversions, metrics.conversions_value, metrics.ctr, metrics.average_cpc
      FROM keyword_view
      WHERE ${dateRange} ${campFilter}
    `.trim());
    return rows.map((r: any) => {
      const c = r.adGroupCriterion ?? {};
      return {
        criterionId: String(c.criterionId ?? ""),
        text: c.keyword?.text ?? null,
        matchType: c.keyword?.matchType ?? null,
        status: c.status ?? null,
        negative: Boolean(c.negative),
        qualityScore: num(c.qualityInfo?.qualityScore),
        adRelevance: c.qualityInfo?.creativeQualityScore ?? null,
        landingPageExperience: c.qualityInfo?.postClickQualityScore ?? null,
        expectedCtr: c.qualityInfo?.searchPredictedCtr ?? null,
        effectiveCpcBid: micros(c.effectiveCpcBidMicros),
        adGroupId: String(r.adGroup?.id ?? ""),
        adGroupName: r.adGroup?.name ?? null,
        campaignId: String(r.campaign?.id ?? ""),
        ...mapMetrics(r.metrics),
      };
    });
  });

  // 6. Search terms
  const searchTerms = await section("search_terms", errors, async () => {
    const rows = await gaqlSearch(opts, `
      SELECT search_term_view.search_term, search_term_view.status,
             segments.search_term_match_type, segments.keyword.info.text,
             ad_group.id, ad_group.name, campaign.id,
             metrics.cost_micros, metrics.impressions, metrics.clicks,
             metrics.conversions, metrics.conversions_value, metrics.ctr, metrics.average_cpc
      FROM search_term_view
      WHERE ${dateRange} ${campFilter}
    `.trim());
    return rows.map((r: any) => ({
      searchTerm: String(r.searchTermView?.searchTerm ?? "").slice(0, 300),
      status: r.searchTermView?.status ?? null,
      matchType: r.segments?.searchTermMatchType ?? null,
      matchedKeyword: r.segments?.keyword?.info?.text ?? null,
      adGroupId: String(r.adGroup?.id ?? ""),
      adGroupName: r.adGroup?.name ?? null,
      campaignId: String(r.campaign?.id ?? ""),
      ...mapMetrics(r.metrics),
    }));
  });

  // 7. Ads (RSA headlines/descriptions, final URLs, ad strength, approval)
  const ads = await section("ads", errors, async () => {
    const rows = await gaqlSearch(opts, `
      SELECT ad_group_ad.ad.id, ad_group_ad.ad.type, ad_group_ad.status,
             ad_group_ad.ad_strength,
             ad_group_ad.policy_summary.approval_status,
             ad_group_ad.ad.final_urls,
             ad_group_ad.ad.responsive_search_ad.headlines,
             ad_group_ad.ad.responsive_search_ad.descriptions,
             ad_group_ad.ad.responsive_search_ad.path1,
             ad_group_ad.ad.responsive_search_ad.path2,
             ad_group.id, ad_group.name, campaign.id,
             metrics.cost_micros, metrics.impressions, metrics.clicks,
             metrics.conversions, metrics.conversions_value, metrics.ctr, metrics.average_cpc
      FROM ad_group_ad
      WHERE ${dateRange} AND ad_group_ad.status != 'REMOVED' ${campFilter}
    `.trim());
    return rows.map((r: any) => {
      const ad = r.adGroupAd?.ad ?? {};
      const rsa = ad.responsiveSearchAd ?? {};
      const assetText = (a: any) => ({
        text: a?.text ?? null,
        pinnedField: a?.pinnedField ?? null,
      });
      return {
        adId: String(ad.id ?? ""),
        type: ad.type ?? null,
        status: r.adGroupAd?.status ?? null,
        adStrength: r.adGroupAd?.adStrength ?? null,
        approvalStatus: r.adGroupAd?.policySummary?.approvalStatus ?? null,
        finalUrls: Array.isArray(ad.finalUrls) ? ad.finalUrls : [],
        headlines: Array.isArray(rsa.headlines) ? rsa.headlines.map(assetText) : [],
        descriptions: Array.isArray(rsa.descriptions) ? rsa.descriptions.map(assetText) : [],
        path1: rsa.path1 ?? null,
        path2: rsa.path2 ?? null,
        adGroupId: String(r.adGroup?.id ?? ""),
        adGroupName: r.adGroup?.name ?? null,
        campaignId: String(r.campaign?.id ?? ""),
        ...mapMetrics(r.metrics),
      };
    });
  });

  // 8. Conversion actions (account-level tracking setup)
  const conversionActions = await section("conversion_actions", errors, async () => {
    const rows = await gaqlSearch(opts, `
      SELECT conversion_action.id, conversion_action.name, conversion_action.type,
             conversion_action.category, conversion_action.status,
             conversion_action.primary_for_goal, conversion_action.counting_type,
             conversion_action.include_in_conversions_metric
      FROM conversion_action
      WHERE conversion_action.status != 'REMOVED'
    `.trim());
    return rows.map((r: any) => {
      const c = r.conversionAction ?? {};
      return {
        id: String(c.id ?? ""),
        name: c.name ?? null,
        type: c.type ?? null,
        category: c.category ?? null,
        status: c.status ?? null,
        primaryForGoal: c.primaryForGoal ?? null,
        countingType: c.countingType ?? null,
        includeInConversions: c.includeInConversionsMetric ?? null,
      };
    });
  });

  // 9. Conversions by action name for the campaign window
  const conversionsByAction = await section("conversions_by_action", errors, async () => {
    const rows = await gaqlSearch(opts, `
      SELECT campaign.id, segments.conversion_action_name,
             metrics.all_conversions, metrics.all_conversions_value
      FROM campaign
      WHERE ${dateRange} AND campaign.status != 'REMOVED' ${campFilter}
        AND metrics.all_conversions > 0
    `.trim());
    return rows.map((r: any) => ({
      campaignId: String(r.campaign?.id ?? ""),
      conversionActionName: r.segments?.conversionActionName ?? null,
      allConversions: num(r.metrics?.allConversions) ?? 0,
      allConversionsValue: num(r.metrics?.allConversionsValue) ?? 0,
    }));
  });

  // 10. Device split
  const deviceStats = await section("device_stats", errors, async () => {
    const rows = await gaqlSearch(opts, `
      SELECT campaign.id, segments.device,
             metrics.cost_micros, metrics.impressions, metrics.clicks,
             metrics.conversions, metrics.conversions_value
      FROM campaign
      WHERE ${dateRange} AND campaign.status != 'REMOVED' ${campFilter}
    `.trim());
    return rows.map((r: any) => ({
      campaignId: String(r.campaign?.id ?? ""),
      device: r.segments?.device ?? null,
      ...mapMetrics(r.metrics),
    }));
  });

  // 11. Geographic split
  const geoStats = await section("geo_stats", errors, async () => {
    const rows = await gaqlSearch(opts, `
      SELECT campaign.id, geographic_view.country_criterion_id, geographic_view.location_type,
             metrics.cost_micros, metrics.impressions, metrics.clicks,
             metrics.conversions, metrics.conversions_value
      FROM geographic_view
      WHERE ${dateRange} ${campFilter}
    `.trim());
    return rows.map((r: any) => ({
      campaignId: String(r.campaign?.id ?? ""),
      countryCriterionId: String(r.geographicView?.countryCriterionId ?? ""),
      locationType: r.geographicView?.locationType ?? null,
      ...mapMetrics(r.metrics),
    }));
  });

  // 12. Day-of-week split
  const dayOfWeekStats = await section("day_of_week_stats", errors, async () => {
    const rows = await gaqlSearch(opts, `
      SELECT campaign.id, segments.day_of_week,
             metrics.cost_micros, metrics.impressions, metrics.clicks,
             metrics.conversions, metrics.conversions_value
      FROM campaign
      WHERE ${dateRange} AND campaign.status != 'REMOVED' ${campFilter}
    `.trim());
    return rows.map((r: any) => ({
      campaignId: String(r.campaign?.id ?? ""),
      dayOfWeek: r.segments?.dayOfWeek ?? null,
      ...mapMetrics(r.metrics),
    }));
  });

  return {
    campaign, campaignDaily, campaignCriteria, adGroups, keywords, searchTerms,
    ads, conversionActions, conversionsByAction, deviceStats, geoStats, dayOfWeekStats,
    meta: {
      customerId: args.customerId,
      campaignId: args.campaignId ?? null,
      dateFrom, dateTo,
      fetchedAt: new Date().toISOString(),
      sectionErrors: errors,
    },
  };
}
