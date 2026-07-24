import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ── Types ──────────────────────────────────────────────────────────────────────

export type BusinessDna = {
  id:                     string;
  workspaceId:            string;
  companyName:            string;
  website:                string;
  industry:               string;
  products:               string;
  services:               string;
  pricing:                string;
  offers:                 string;
  locations:              string;
  idealCustomerProfiles:  string;
  targetMarkets:          string;
  uniqueSellingPoints:    string;
  competitorsSummary:     string;
  revenueGoals:           string;
  monthlyMarketingBudget: number | null;
  mainGrowthObjective:    string;
  salesProcess:           string;
  averageDealValue:       number | null;
  profitMarginPct:        number | null;
  bestCustomers:          string;
  worstCustomers:         string;
  caseStudies:            string;
  brandVoice:             string;
  complianceNotes:        string;
  // ── Content Intelligence extension ──
  customerPainPoints:     string;
  commonObjections:       string;
  buyingTriggers:         string;
  approvedClaims:         string;
  restrictedClaims:       string;
  restrictedTopics:       string;
  preferredCtas:          string;
  contentStyles:          string;
  priorityTopics:         string;
  avoidTopics:            string;
  proofPoints:            string;
  brandAssets:            Record<string, unknown>;
  approvedVoices:         string;
  contentObjectives:      string;
  commercialObjectives:   string;
  dnaVersion:             number;
  updatedAt:              string;
};

export type DnaCompletionScore = {
  score:   number;
  total:   number;
  pct:     number;
  missing: string[];
  grade:   "A" | "B" | "C" | "D" | "F";
};

const DNA_FIELDS: { key: keyof BusinessDna; label: string; weight: number }[] = [
  { key: "companyName",            label: "Company Name",                weight: 3 },
  { key: "website",                label: "Website",                     weight: 2 },
  { key: "industry",               label: "Industry",                    weight: 3 },
  { key: "products",               label: "Products",                    weight: 2 },
  { key: "services",               label: "Services",                    weight: 2 },
  { key: "pricing",                label: "Pricing",                     weight: 2 },
  { key: "offers",                 label: "Current Offers",              weight: 2 },
  { key: "locations",              label: "Locations",                   weight: 1 },
  { key: "idealCustomerProfiles",  label: "Ideal Customer Profiles",     weight: 3 },
  { key: "targetMarkets",          label: "Target Markets",              weight: 2 },
  { key: "uniqueSellingPoints",    label: "Unique Selling Points",       weight: 3 },
  { key: "competitorsSummary",     label: "Competitors",                 weight: 2 },
  { key: "revenueGoals",           label: "Revenue Goals",               weight: 2 },
  { key: "monthlyMarketingBudget", label: "Monthly Marketing Budget",    weight: 2 },
  { key: "mainGrowthObjective",    label: "Main Growth Objective",       weight: 3 },
  { key: "salesProcess",           label: "Sales Process",              weight: 2 },
  { key: "averageDealValue",       label: "Average Deal Value",          weight: 2 },
  { key: "profitMarginPct",        label: "Profit Margin",               weight: 1 },
  { key: "bestCustomers",          label: "Best Customers",              weight: 2 },
  { key: "worstCustomers",         label: "Worst Customers",             weight: 1 },
  { key: "caseStudies",            label: "Case Studies",                weight: 2 },
  { key: "brandVoice",             label: "Brand Voice",                 weight: 2 },
  { key: "complianceNotes",        label: "Compliance Notes",            weight: 1 },
  { key: "customerPainPoints",     label: "Customer Pain Points",        weight: 3 },
  { key: "commonObjections",       label: "Common Objections",           weight: 2 },
  { key: "buyingTriggers",         label: "Buying Triggers",             weight: 2 },
  { key: "approvedClaims",         label: "Approved Claims",             weight: 2 },
  { key: "restrictedClaims",       label: "Restricted Claims",           weight: 2 },
  { key: "restrictedTopics",       label: "Restricted Topics",           weight: 1 },
  { key: "preferredCtas",          label: "Preferred Calls-to-Action",   weight: 2 },
  { key: "contentStyles",          label: "Content Styles",              weight: 2 },
  { key: "priorityTopics",         label: "Priority Topics",             weight: 2 },
  { key: "avoidTopics",            label: "Topics to Avoid",             weight: 1 },
  { key: "proofPoints",            label: "Proof Points & Evidence",     weight: 2 },
  { key: "approvedVoices",         label: "Approved Voices/Spokespeople", weight: 1 },
  { key: "contentObjectives",      label: "Content Objectives",          weight: 2 },
  { key: "commercialObjectives",   label: "Commercial Objectives",       weight: 2 },
];

export function computeDnaCompletionScore(dna: Partial<BusinessDna>): DnaCompletionScore {
  const totalWeight = DNA_FIELDS.reduce((acc, f) => acc + f.weight, 0);
  let earned = 0;
  const missing: string[] = [];

  for (const field of DNA_FIELDS) {
    const val = dna[field.key];
    const filled = val !== null && val !== undefined && String(val).trim().length > 0;
    if (filled) {
      earned += field.weight;
    } else {
      missing.push(field.label);
    }
  }

  const pct = Math.round((earned / totalWeight) * 100);
  const grade: DnaCompletionScore["grade"] =
    pct >= 90 ? "A" : pct >= 70 ? "B" : pct >= 50 ? "C" : pct >= 30 ? "D" : "F";

  return { score: earned, total: totalWeight, pct, missing, grade };
}

// Returns DNA as a structured context string for AI prompts
export function formatDnaAsContext(dna: BusinessDna): string {
  const lines: string[] = ["## Business DNA Context"];

  if (dna.companyName)           lines.push(`Company: ${dna.companyName}`);
  if (dna.website)               lines.push(`Website: ${dna.website}`);
  if (dna.industry)              lines.push(`Industry: ${dna.industry}`);
  if (dna.products)              lines.push(`Products: ${dna.products}`);
  if (dna.services)              lines.push(`Services: ${dna.services}`);
  if (dna.pricing)               lines.push(`Pricing: ${dna.pricing}`);
  if (dna.offers)                lines.push(`Current Offers: ${dna.offers}`);
  if (dna.locations)             lines.push(`Locations: ${dna.locations}`);
  if (dna.idealCustomerProfiles) lines.push(`Ideal Customers: ${dna.idealCustomerProfiles}`);
  if (dna.targetMarkets)         lines.push(`Target Markets: ${dna.targetMarkets}`);
  if (dna.uniqueSellingPoints)   lines.push(`USPs: ${dna.uniqueSellingPoints}`);
  if (dna.competitorsSummary)    lines.push(`Competitors: ${dna.competitorsSummary}`);
  if (dna.revenueGoals)          lines.push(`Revenue Goals: ${dna.revenueGoals}`);
  if (dna.monthlyMarketingBudget != null) lines.push(`Monthly Marketing Budget: ${dna.monthlyMarketingBudget}`);
  if (dna.mainGrowthObjective)   lines.push(`Main Growth Objective: ${dna.mainGrowthObjective}`);
  if (dna.salesProcess)          lines.push(`Sales Process: ${dna.salesProcess}`);
  if (dna.averageDealValue != null) lines.push(`Average Deal Value: ${dna.averageDealValue}`);
  if (dna.profitMarginPct != null)  lines.push(`Profit Margin: ${dna.profitMarginPct}%`);
  if (dna.bestCustomers)         lines.push(`Best Customers: ${dna.bestCustomers}`);
  if (dna.worstCustomers)        lines.push(`Worst Customers / Avoid: ${dna.worstCustomers}`);
  if (dna.caseStudies)           lines.push(`Case Studies: ${dna.caseStudies}`);
  if (dna.brandVoice)            lines.push(`Brand Voice: ${dna.brandVoice}`);
  if (dna.complianceNotes)       lines.push(`Compliance Notes: ${dna.complianceNotes}`);
  if (dna.customerPainPoints)    lines.push(`Customer Pain Points: ${dna.customerPainPoints}`);
  if (dna.commonObjections)      lines.push(`Common Objections: ${dna.commonObjections}`);
  if (dna.buyingTriggers)        lines.push(`Buying Triggers: ${dna.buyingTriggers}`);
  if (dna.approvedClaims)        lines.push(`Approved Claims: ${dna.approvedClaims}`);
  if (dna.restrictedClaims)      lines.push(`Restricted Claims (never use): ${dna.restrictedClaims}`);
  if (dna.restrictedTopics)      lines.push(`Restricted Topics (never cover): ${dna.restrictedTopics}`);
  if (dna.preferredCtas)         lines.push(`Preferred CTAs: ${dna.preferredCtas}`);
  if (dna.contentStyles)         lines.push(`Content Styles: ${dna.contentStyles}`);
  if (dna.priorityTopics)        lines.push(`Priority Topics: ${dna.priorityTopics}`);
  if (dna.avoidTopics)           lines.push(`Topics to Avoid: ${dna.avoidTopics}`);
  if (dna.proofPoints)           lines.push(`Proof Points: ${dna.proofPoints}`);
  if (dna.approvedVoices)        lines.push(`Approved Voices/Spokespeople: ${dna.approvedVoices}`);
  if (dna.contentObjectives)     lines.push(`Content Objectives: ${dna.contentObjectives}`);
  if (dna.commercialObjectives)  lines.push(`Commercial Objectives: ${dna.commercialObjectives}`);

  return lines.join("\n");
}

function mapRow(r: any): BusinessDna {
  return {
    id:                     r.id,
    workspaceId:            r.workspace_id,
    companyName:            r.company_name             ?? "",
    website:                r.website                  ?? "",
    industry:               r.industry                 ?? "",
    products:               r.products                 ?? "",
    services:               r.services                 ?? "",
    pricing:                r.pricing                  ?? "",
    offers:                 r.offers                   ?? "",
    locations:              r.locations                ?? "",
    idealCustomerProfiles:  r.ideal_customer_profiles  ?? "",
    targetMarkets:          r.target_markets            ?? "",
    uniqueSellingPoints:    r.unique_selling_points     ?? "",
    competitorsSummary:     r.competitors_summary       ?? "",
    revenueGoals:           r.revenue_goals             ?? "",
    monthlyMarketingBudget: r.monthly_marketing_budget != null ? Number(r.monthly_marketing_budget) : null,
    mainGrowthObjective:    r.main_growth_objective     ?? "",
    salesProcess:           r.sales_process             ?? "",
    averageDealValue:       r.average_deal_value != null ? Number(r.average_deal_value) : null,
    profitMarginPct:        r.profit_margin_pct != null ? Number(r.profit_margin_pct) : null,
    bestCustomers:          r.best_customers            ?? "",
    worstCustomers:         r.worst_customers           ?? "",
    caseStudies:            r.case_studies              ?? "",
    brandVoice:             r.brand_voice               ?? "",
    complianceNotes:        r.compliance_notes          ?? "",
    customerPainPoints:     r.customer_pain_points      ?? "",
    commonObjections:       r.common_objections         ?? "",
    buyingTriggers:         r.buying_triggers           ?? "",
    approvedClaims:         r.approved_claims           ?? "",
    restrictedClaims:       r.restricted_claims         ?? "",
    restrictedTopics:       r.restricted_topics         ?? "",
    preferredCtas:          r.preferred_ctas            ?? "",
    contentStyles:          r.content_styles            ?? "",
    priorityTopics:         r.priority_topics           ?? "",
    avoidTopics:            r.avoid_topics              ?? "",
    proofPoints:            r.proof_points              ?? "",
    brandAssets:            (r.brand_assets ?? {}) as Record<string, unknown>,
    approvedVoices:         r.approved_voices           ?? "",
    contentObjectives:      r.content_objectives        ?? "",
    commercialObjectives:   r.commercial_objectives     ?? "",
    dnaVersion:             r.dna_version != null ? Number(r.dna_version) : 1,
    updatedAt:              r.updated_at,
  };
}

// ── Server fns ─────────────────────────────────────────────────────────────────

export const getBusinessDna = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data, error } = await sb
      .from("growthmind_business_dna")
      .select("*")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    if (error && error.code !== "42P01") throw new Error(error.message);

    const dna: BusinessDna = data ? mapRow(data) : {
      id: "", workspaceId, companyName: "", website: "", industry: "",
      products: "", services: "", pricing: "", offers: "", locations: "",
      idealCustomerProfiles: "", targetMarkets: "", uniqueSellingPoints: "",
      competitorsSummary: "", revenueGoals: "", monthlyMarketingBudget: null,
      mainGrowthObjective: "", salesProcess: "", averageDealValue: null,
      profitMarginPct: null, bestCustomers: "", worstCustomers: "",
      caseStudies: "", brandVoice: "", complianceNotes: "",
      customerPainPoints: "", commonObjections: "", buyingTriggers: "",
      approvedClaims: "", restrictedClaims: "", restrictedTopics: "",
      preferredCtas: "", contentStyles: "", priorityTopics: "", avoidTopics: "",
      proofPoints: "", brandAssets: {}, approvedVoices: "",
      contentObjectives: "", commercialObjectives: "", dnaVersion: 1,
      updatedAt: "",
    };

    return { dna, completion: computeDnaCompletionScore(dna) };
  });

const UpsertSchema = z.object({
  companyName:            z.string().default(""),
  website:                z.string().default(""),
  industry:               z.string().default(""),
  products:               z.string().default(""),
  services:               z.string().default(""),
  pricing:                z.string().default(""),
  offers:                 z.string().default(""),
  locations:              z.string().default(""),
  idealCustomerProfiles:  z.string().default(""),
  targetMarkets:          z.string().default(""),
  uniqueSellingPoints:    z.string().default(""),
  competitorsSummary:     z.string().default(""),
  revenueGoals:           z.string().default(""),
  monthlyMarketingBudget: z.number().nullable().default(null),
  mainGrowthObjective:    z.string().default(""),
  salesProcess:           z.string().default(""),
  averageDealValue:       z.number().nullable().default(null),
  profitMarginPct:        z.number().nullable().default(null),
  bestCustomers:          z.string().default(""),
  worstCustomers:         z.string().default(""),
  caseStudies:            z.string().default(""),
  brandVoice:             z.string().default(""),
  complianceNotes:        z.string().default(""),
  customerPainPoints:     z.string().default(""),
  commonObjections:       z.string().default(""),
  buyingTriggers:         z.string().default(""),
  approvedClaims:         z.string().default(""),
  restrictedClaims:       z.string().default(""),
  restrictedTopics:       z.string().default(""),
  preferredCtas:          z.string().default(""),
  contentStyles:          z.string().default(""),
  priorityTopics:         z.string().default(""),
  avoidTopics:            z.string().default(""),
  proofPoints:            z.string().default(""),
  brandAssets:            z.record(z.unknown()).default({}),
  approvedVoices:         z.string().default(""),
  contentObjectives:      z.string().default(""),
  commercialObjectives:   z.string().default(""),
  changeSummary:          z.string().max(500).optional(),
});

export const upsertBusinessDna = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => UpsertSchema.parse(data))
  .handler(async ({ context, data }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const payload = {
      workspace_id:             workspaceId,
      company_name:             data.companyName,
      website:                  data.website,
      industry:                 data.industry,
      products:                 data.products,
      services:                 data.services,
      pricing:                  data.pricing,
      offers:                   data.offers,
      locations:                data.locations,
      ideal_customer_profiles:  data.idealCustomerProfiles,
      target_markets:            data.targetMarkets,
      unique_selling_points:     data.uniqueSellingPoints,
      competitors_summary:       data.competitorsSummary,
      revenue_goals:             data.revenueGoals,
      monthly_marketing_budget:  data.monthlyMarketingBudget,
      main_growth_objective:     data.mainGrowthObjective,
      sales_process:             data.salesProcess,
      average_deal_value:        data.averageDealValue,
      profit_margin_pct:         data.profitMarginPct,
      best_customers:            data.bestCustomers,
      worst_customers:           data.worstCustomers,
      case_studies:              data.caseStudies,
      brand_voice:               data.brandVoice,
      compliance_notes:          data.complianceNotes,
      customer_pain_points:      data.customerPainPoints,
      common_objections:         data.commonObjections,
      buying_triggers:           data.buyingTriggers,
      approved_claims:           data.approvedClaims,
      restricted_claims:         data.restrictedClaims,
      restricted_topics:         data.restrictedTopics,
      preferred_ctas:            data.preferredCtas,
      content_styles:            data.contentStyles,
      priority_topics:           data.priorityTopics,
      avoid_topics:              data.avoidTopics,
      proof_points:              data.proofPoints,
      brand_assets:              data.brandAssets,
      approved_voices:           data.approvedVoices,
      content_objectives:        data.contentObjectives,
      commercial_objectives:     data.commercialObjectives,
      updated_at:                new Date().toISOString(),
    };

    // Versioning: bump dna_version relative to the current row.
    const { data: existing } = await sb
      .from("growthmind_business_dna")
      .select("dna_version")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const nextVersion = (existing?.dna_version != null ? Number(existing.dna_version) : 0) + 1;
    (payload as any).dna_version = nextVersion;

    const { data: saved, error } = await sb
      .from("growthmind_business_dna")
      .upsert(payload, { onConflict: "workspace_id" })
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    const dna = mapRow(saved);

    // Snapshot this version + audit (server-write-only tables → admin client).
    const userId = (context as any).userId ?? null;
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error: verErr } = await (supabaseAdmin as any)
        .from("growthmind_dna_versions")
        .insert({
          workspace_id:       workspaceId,
          version:            nextVersion,
          snapshot:           saved,
          changed_by:         "user",
          changed_by_user_id: userId,
          change_summary:     data.changeSummary ?? null,
        });
      if (verErr) console.warn("[business-dna] version snapshot failed:", verErr.message);
    } catch (err: any) {
      console.warn("[business-dna] version snapshot error:", err?.message ?? err);
    }
    const { logGrowthMindActivity } = await import("@/lib/growthmind/growthmind.activity.server");
    await logGrowthMindActivity({
      workspaceId,
      actor: "user",
      actorUserId: userId,
      category: "dna",
      action: "dna.version_saved",
      entityType: "business_dna",
      entityId: saved.id,
      summary: `Business DNA saved (version ${nextVersion})`,
      detail: { version: nextVersion, changeSummary: data.changeSummary ?? null },
    });

    return { dna, completion: computeDnaCompletionScore(dna) };
  });

// ── Version history ────────────────────────────────────────────────────────────

export const getBusinessDnaVersions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const { data, error } = await sb
      .from("growthmind_dna_versions")
      .select("id, version, changed_by, change_summary, created_at")
      .eq("workspace_id", context.workspaceId)
      .order("version", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return { versions: data ?? [] };
  });

// ── DNA update proposals (GrowthMind proposes, user approves — never silent) ──

/**
 * SERVER ONLY helper: record a GrowthMind-proposed DNA update. Approving it is
 * always a separate, explicit user action — proposals never mutate the DNA row.
 */
export async function proposeDnaUpdateServer(input: {
  workspaceId: string;
  fieldChanges: Record<string, { current: unknown; proposed: unknown }>;
  rationale?: string;
  source?: string;
}): Promise<{ id: string | null }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const sb = supabaseAdmin as any;
  const { data, error } = await sb.from("growthmind_dna_proposals").insert({
    workspace_id:  input.workspaceId,
    proposed_by:   "growthmind",
    field_changes: input.fieldChanges,
    rationale:     input.rationale ?? null,
    source:        input.source ?? null,
  }).select("id").maybeSingle();
  if (error) {
    console.warn("[business-dna] proposal insert failed:", error.message);
    return { id: null };
  }
  const { logGrowthMindActivity } = await import("@/lib/growthmind/growthmind.activity.server");
  await logGrowthMindActivity({
    workspaceId: input.workspaceId,
    actor: "growthmind",
    category: "dna",
    action: "dna.update_proposed",
    entityType: "dna_proposal",
    entityId: data?.id ?? null,
    summary: "GrowthMind proposed a Business DNA update",
    detail: { fields: Object.keys(input.fieldChanges), source: input.source ?? null },
  });
  return { id: data?.id ?? null };
}

export const getDnaProposals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const { data, error } = await sb
      .from("growthmind_dna_proposals")
      .select("id, proposed_by, field_changes, rationale, source, status, created_at")
      .eq("workspace_id", context.workspaceId)
      .eq("status", "proposed")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return { proposals: data ?? [] };
  });

/** Snake_case DNA columns a proposal is allowed to touch. */
const PROPOSAL_ALLOWED_COLUMNS = new Set([
  "company_name","website","industry","products","services","pricing","offers",
  "locations","ideal_customer_profiles","target_markets","unique_selling_points",
  "competitors_summary","revenue_goals","monthly_marketing_budget",
  "main_growth_objective","sales_process","average_deal_value","profit_margin_pct",
  "best_customers","worst_customers","case_studies","brand_voice","compliance_notes",
  "customer_pain_points","common_objections","buying_triggers","approved_claims",
  "restricted_claims","restricted_topics","preferred_ctas","content_styles",
  "priority_topics","avoid_topics","proof_points","approved_voices",
  "content_objectives","commercial_objectives",
]);

export const resolveDnaProposal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      proposalId: z.string().uuid(),
      decision:   z.enum(["approve", "reject"]),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const userId = (context as any).userId ?? null;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;

    const { data: proposal, error: pErr } = await admin
      .from("growthmind_dna_proposals")
      .select("*")
      .eq("id", data.proposalId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!proposal) throw new Error("Proposal not found");
    if (proposal.status !== "proposed") throw new Error("Proposal already resolved");

    if (data.decision === "approve") {
      const changes = (proposal.field_changes ?? {}) as Record<string, { proposed?: unknown }>;
      const update: Record<string, unknown> = {};
      for (const [col, ch] of Object.entries(changes)) {
        if (PROPOSAL_ALLOWED_COLUMNS.has(col)) update[col] = ch?.proposed ?? null;
      }
      if (Object.keys(update).length > 0) {
        const { data: cur } = await admin
          .from("growthmind_business_dna")
          .select("dna_version")
          .eq("workspace_id", workspaceId)
          .maybeSingle();
        const nextVersion = (cur?.dna_version != null ? Number(cur.dna_version) : 0) + 1;
        update.dna_version = nextVersion;
        update.updated_at  = new Date().toISOString();
        const { data: savedRow, error: uErr } = await admin
          .from("growthmind_business_dna")
          .update(update)
          .eq("workspace_id", workspaceId)
          .select("*")
          .maybeSingle();
        if (uErr) throw new Error(uErr.message);
        if (!savedRow) throw new Error("No Business DNA row exists yet — save the DNA first, then approve proposals.");
        await admin.from("growthmind_dna_versions").insert({
          workspace_id:       workspaceId,
          version:            nextVersion,
          snapshot:           savedRow,
          changed_by:         "growthmind",
          changed_by_user_id: userId,
          change_summary:     `Approved GrowthMind proposal: ${proposal.rationale ?? "DNA update"}`,
        });
      }
    }

    const { error: rErr } = await admin
      .from("growthmind_dna_proposals")
      .update({
        status: data.decision === "approve" ? "approved" : "rejected",
        resolved_by_user_id: userId,
        resolved_at: new Date().toISOString(),
        updated_at:  new Date().toISOString(),
      })
      .eq("id", data.proposalId)
      .eq("workspace_id", workspaceId)
      .eq("status", "proposed");
    if (rErr) throw new Error(rErr.message);

    const { logGrowthMindActivity } = await import("@/lib/growthmind/growthmind.activity.server");
    await logGrowthMindActivity({
      workspaceId,
      actor: "user",
      actorUserId: userId,
      category: "dna",
      action: data.decision === "approve" ? "dna.proposal_approved" : "dna.proposal_rejected",
      entityType: "dna_proposal",
      entityId: data.proposalId,
      summary: `Business DNA proposal ${data.decision === "approve" ? "approved" : "rejected"}`,
    });

    return { ok: true };
  });

// ── Initial auto-generation from existing WEBEE data ──────────────────────────
// Builds suggestions from the workspace's live WEBEE data + AI. Returns
// suggested field values for the UI to prefill — NEVER saves automatically;
// the user must review, edit and save explicitly.

export const generateInitialDna = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const sb = context.supabase as any;

    const { buildBusinessContext, formatContextForAI } =
      await import("@/lib/growthmind/growthmind.business-context");
    const ctx = await buildBusinessContext(sb, workspaceId);
    const contextText = formatContextForAI(ctx);

    const { data: currentRow } = await sb
      .from("growthmind_business_dna")
      .select("*")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const current = currentRow ? mapRow(currentRow) : null;

    const camelKeys = DNA_FIELDS.map(f => f.key);
    const system =
      "You are GrowthMind, an AI CMO. Draft a Business DNA profile for this workspace " +
      "using ONLY the real workspace data provided. Do not invent facts, revenue numbers, claims " +
      "or customer evidence — leave a field as an empty string when the data does not support it. " +
      "Respond with a single JSON object whose keys are exactly the requested field names and whose " +
      "values are concise plain-text strings (or null for numeric fields you cannot infer).";
    const user =
      `Requested fields (camelCase): ${camelKeys.join(", ")}\n\n` +
      `Current DNA (do not degrade existing filled values — improve or keep them):\n` +
      JSON.stringify(current ?? {}, null, 0).slice(0, 6000) +
      `\n\nWorkspace data:\n${contextText}`.slice(0, 24000);

    const { routeGenerate } = await import("@/lib/growthmind/model-router.server");
    const result = await routeGenerate({
      system,
      user,
      contentType: "strategy" as any,
      maxTokens: 3000,
      mode: "smart",
      settings: (context as any).settings ?? {},
      workspaceId,
      sb,
    });

    // Parse the JSON object out of the response (tolerate code fences).
    let suggestions: Record<string, unknown> = {};
    try {
      const raw = result.text.replace(/```(?:json)?/g, "").trim();
      const start = raw.indexOf("{");
      const end   = raw.lastIndexOf("}");
      if (start >= 0 && end > start) suggestions = JSON.parse(raw.slice(start, end + 1));
    } catch {
      throw new Error("AI returned an unreadable draft — please try again.");
    }

    // Only allow known camelCase keys; coerce to strings (numbers stay numbers).
    const numericKeys = new Set(["monthlyMarketingBudget", "averageDealValue", "profitMarginPct"]);
    const cleaned: Record<string, string | number | null> = {};
    for (const key of camelKeys) {
      const v = (suggestions as any)[key];
      if (v == null) continue;
      if (numericKeys.has(key)) {
        const n = Number(v);
        if (Number.isFinite(n)) cleaned[key] = n;
      } else if (typeof v === "string" && v.trim()) {
        cleaned[key] = v.trim();
      }
    }

    const { logGrowthMindActivity } = await import("@/lib/growthmind/growthmind.activity.server");
    await logGrowthMindActivity({
      workspaceId,
      actor: "growthmind",
      category: "dna",
      action: "dna.draft_generated",
      summary: "GrowthMind drafted Business DNA suggestions from workspace data",
      detail: { fieldsSuggested: Object.keys(cleaned).length },
    });

    return { suggestions: cleaned };
  });
