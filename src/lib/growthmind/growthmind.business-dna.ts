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
      caseStudies: "", brandVoice: "", complianceNotes: "", updatedAt: "",
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
      updated_at:                new Date().toISOString(),
    };

    const { data: saved, error } = await sb
      .from("growthmind_business_dna")
      .upsert(payload, { onConflict: "workspace_id" })
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    const dna = mapRow(saved);
    return { dna, completion: computeDnaCompletionScore(dna) };
  });
