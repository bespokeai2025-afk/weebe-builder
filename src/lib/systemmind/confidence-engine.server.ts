/**
 * SystemMind Confidence Engine — SERVER ONLY (Task #298, spec step 1).
 * Loaded dynamically inside admin-gated createServerFn handlers.
 *
 * Scores every curated Workflow Template across six deterministic dimensions and
 * persists the result to `systemmind_template_confidence`. Scores drive which
 * templates the Deployment Planner is allowed to recommend (overall >= the
 * workspace confidence threshold).
 *
 * DESCRIPTIVE ONLY — reads existing template columns, writes score rows. Never
 * deploys or provisions anything. Deterministic + reproducible (no AI, no
 * randomness): the template already carries an AI-derived `confidence`, so the
 * engine layers explainable structural signals on top of it.
 *
 * Each source column feeds EXACTLY ONE dimension (no double-counting):
 *   understanding        ← confidence, business_purpose
 *   documentation        ← description, business_summary, technical_summary, known_limitations
 *   reuse                ← template_type, status, is_trusted, category, tags
 *   crm_portability      ← supported_{agent,crm,calendar,telephony,messaging}_providers
 *   deployment_readiness ← readiness, structure, deployment_variables
 *   dependency           ← dependencies, required_apis, required_credentials
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ── Types ────────────────────────────────────────────────────────────────────

export type RiskRating = "low" | "medium" | "high";

export interface DimensionScore {
  score: number; // 0-100
  notes: string[];
}

export interface ConfidenceBreakdown {
  understanding: DimensionScore;
  documentation: DimensionScore;
  reuse: DimensionScore;
  crm_portability: DimensionScore;
  deployment_readiness: DimensionScore;
  dependency: DimensionScore;
  overall_score: number; // weighted 0-100
  risk_rating: RiskRating;
}

export interface TemplateConfidenceRow {
  template_id: string;
  name: string;
  category: string | null;
  status: string | null;
  understanding: number;
  documentation: number;
  reuse: number;
  crm_portability: number;
  deployment_readiness: number;
  dependency: number;
  overall_score: number;
  risk_rating: RiskRating;
  recommended: boolean; // computed at read time vs current threshold
  stale: boolean; // template edited since last scored
  computed_at: string | null;
  signals: Record<string, DimensionScore>;
}

// ── Named weights (sum = 1.0) ─────────────────────────────────────────────────

export const CONFIDENCE_WEIGHTS = {
  understanding: 0.22,
  documentation: 0.18,
  reuse: 0.18,
  crm_portability: 0.12,
  deployment_readiness: 0.2,
  dependency: 0.1,
} as const;

export const DEFAULT_CONFIDENCE_THRESHOLD = 70;

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function hasText(v: unknown, min = 3): boolean {
  return typeof v === "string" && v.trim().length >= min;
}

function arr(v: unknown): any[] {
  return Array.isArray(v) ? v : [];
}

/** Postgres "relation does not exist" (migration not applied yet). */
export function isRelationMissing(e: unknown): boolean {
  const msg = String((e as any)?.message ?? e ?? "").toLowerCase();
  return (
    (e as any)?.code === "42P01" ||
    (msg.includes("does not exist") && msg.includes("relation")) ||
    msg.includes("could not find the table") ||
    msg.includes("schema cache")
  );
}

// ── Dimension scorers ─────────────────────────────────────────────────────────

function scoreUnderstanding(t: any): DimensionScore {
  const notes: string[] = [];
  const conf = typeof t.confidence === "number" ? Math.max(0, Math.min(100, t.confidence)) : 0;
  let score = conf * 0.75;
  notes.push(`AI understanding confidence ${conf}`);
  if (hasText(t.business_purpose, 20)) {
    score += 25;
    notes.push("Business purpose documented");
  } else {
    notes.push("No business purpose recorded");
  }
  return { score: clamp(score), notes };
}

function scoreDocumentation(t: any): DimensionScore {
  const notes: string[] = [];
  let score = 0;
  if (hasText(t.description, 10)) { score += 25; notes.push("Description present"); }
  else notes.push("Missing description");
  if (hasText(t.business_summary, 20)) { score += 25; notes.push("Business summary present"); }
  else notes.push("Missing business summary");
  if (hasText(t.technical_summary, 20)) { score += 30; notes.push("Technical summary present"); }
  else notes.push("Missing technical summary");
  if (arr(t.known_limitations).length > 0) { score += 20; notes.push(`${arr(t.known_limitations).length} known limitation(s) documented`); }
  else notes.push("No known limitations documented");
  return { score: clamp(score), notes };
}

function scoreReuse(t: any): DimensionScore {
  const notes: string[] = [];
  let score = 0;
  const typeScore: Record<string, number> = {
    reusable_template: 40, experimental: 15, customer_specific: 10, legacy: 5, archive: 0,
  };
  const ts = typeScore[String(t.template_type)] ?? 10;
  score += ts;
  notes.push(`Template type "${t.template_type ?? "unknown"}"`);
  const statusScore: Record<string, number> = {
    approved: 25, pending_approval: 12, draft: 5, archived: 0,
  };
  score += statusScore[String(t.status)] ?? 5;
  notes.push(`Status "${t.status ?? "draft"}"`);
  if (t.is_trusted) { score += 15; notes.push("Trusted (approved)"); }
  if (hasText(t.category) && t.category !== "General") { score += 12; notes.push(`Categorised as "${t.category}"`); }
  else notes.push("Generic / uncategorised");
  if (arr(t.tags).length > 0) { score += 8; notes.push(`${arr(t.tags).length} tag(s)`); }
  return { score: clamp(score), notes };
}

function scoreCrmPortability(t: any): DimensionScore {
  const notes: string[] = [];
  const crm = arr(t.supported_crm_providers);
  const buckets = [
    arr(t.supported_agent_providers),
    crm,
    arr(t.supported_calendar_providers),
    arr(t.supported_telephony_providers),
    arr(t.supported_messaging_providers),
  ];
  const total = buckets.reduce((n, b) => n + b.length, 0);
  const otherProviders = total - crm.length;
  if (total === 0) {
    notes.push("No external providers — self-contained");
    return { score: 45, notes };
  }
  let score = 35 + crm.length * 20 + Math.min(otherProviders * 5, 30);
  if (crm.length >= 2) { score += 10; notes.push(`${crm.length} CRM providers supported (portable)`); }
  else if (crm.length === 1) notes.push("Single CRM provider supported");
  else notes.push("No CRM providers mapped");
  notes.push(`${total} provider integration(s) across the stack`);
  return { score: clamp(score), notes };
}

function scoreDeploymentReadiness(t: any): DimensionScore {
  const notes: string[] = [];
  let score = 0;
  const readinessScore: Record<string, number> = { ready: 55, needs_review: 30, not_ready: 10 };
  score += readinessScore[String(t.readiness)] ?? 10;
  notes.push(`Readiness "${t.readiness ?? "not_ready"}"`);
  const nodes = arr(t.structure?.nodes);
  if (nodes.length > 0) { score += 25; notes.push(`Structure snapshot (${nodes.length} nodes)`); }
  else notes.push("No structure snapshot");
  const dv = arr(t.deployment_variables);
  if (dv.length > 0) { score += 20; notes.push(`${dv.length} deployment variable(s) extracted`); }
  else notes.push("No deployment variables extracted");
  return { score: clamp(score), notes };
}

function scoreDependency(t: any): DimensionScore {
  const notes: string[] = [];
  const credCount = arr(t.required_credentials).length;
  const depCount = arr(t.dependencies).length;
  const apiCount = arr(t.required_apis).length;
  const credPenalty = Math.min(credCount * 10, 45);
  const depPenalty = Math.min(depCount * 4, 25);
  const apiPenalty = Math.min(apiCount * 2, 15);
  const score = clamp(100 - credPenalty - depPenalty - apiPenalty);
  notes.push(`${credCount} credential(s), ${apiCount} API(s), ${depCount} dependency reference(s)`);
  if (depCount > 0) notes.push("Dependencies enumerated");
  if (credCount === 0) notes.push("No external credentials required");
  return { score, notes };
}

// ── Aggregate ─────────────────────────────────────────────────────────────────

function deriveRisk(overall: number, t: any, credCount: number): RiskRating {
  let risk: RiskRating = overall >= 75 ? "low" : overall >= 50 ? "medium" : "high";
  if (String(t.risk_rating) === "high") risk = risk === "low" ? "medium" : "high";
  if (credCount >= 5) risk = "high";
  else if (credCount >= 3 && risk === "low") risk = "medium";
  return risk;
}

/** Pure deterministic scoring of a single template row. */
export function computeTemplateConfidence(t: any): ConfidenceBreakdown {
  const understanding = scoreUnderstanding(t);
  const documentation = scoreDocumentation(t);
  const reuse = scoreReuse(t);
  const crm_portability = scoreCrmPortability(t);
  const deployment_readiness = scoreDeploymentReadiness(t);
  const dependency = scoreDependency(t);

  const overall = clamp(
    understanding.score * CONFIDENCE_WEIGHTS.understanding +
      documentation.score * CONFIDENCE_WEIGHTS.documentation +
      reuse.score * CONFIDENCE_WEIGHTS.reuse +
      crm_portability.score * CONFIDENCE_WEIGHTS.crm_portability +
      deployment_readiness.score * CONFIDENCE_WEIGHTS.deployment_readiness +
      dependency.score * CONFIDENCE_WEIGHTS.dependency,
  );

  const risk = deriveRisk(overall, t, arr(t.required_credentials).length);

  return {
    understanding, documentation, reuse, crm_portability, deployment_readiness, dependency,
    overall_score: overall,
    risk_rating: risk,
  };
}

// ── Persistence ────────────────────────────────────────────────────────────────

const SCORING_COLUMNS =
  "id, name, category, status, template_type, is_trusted, confidence, readiness, risk_rating, " +
  "known_limitations, description, business_purpose, business_summary, technical_summary, tags, " +
  "supported_agent_providers, supported_crm_providers, supported_calendar_providers, " +
  "supported_telephony_providers, supported_messaging_providers, required_apis, required_credentials, " +
  "deployment_variables, dependencies, structure, current_version";

/** Recompute + persist confidence for every template in the workspace. */
export async function scoreAllTemplates(workspaceId: string) {
  const sb = supabaseAdmin as any;
  const { data: templates, error } = await sb
    .from("systemmind_workflow_templates")
    .select(SCORING_COLUMNS)
    .eq("workspace_id", workspaceId)
    .limit(500);
  if (error) throw new Error(error.message);

  const now = new Date().toISOString();
  let scored = 0;
  for (const t of (templates ?? []) as any[]) {
    const b = computeTemplateConfidence(t);
    const row = {
      workspace_id: workspaceId,
      template_id: t.id,
      understanding: b.understanding.score,
      documentation: b.documentation.score,
      reuse: b.reuse.score,
      crm_portability: b.crm_portability.score,
      deployment_readiness: b.deployment_readiness.score,
      dependency: b.dependency.score,
      overall_score: b.overall_score,
      risk_rating: b.risk_rating,
      signals: {
        understanding: b.understanding,
        documentation: b.documentation,
        reuse: b.reuse,
        crm_portability: b.crm_portability,
        deployment_readiness: b.deployment_readiness,
        dependency: b.dependency,
      },
      template_current_version: t.current_version ?? 1,
      computed_at: now,
      updated_at: now,
    };
    const { error: upErr } = await sb
      .from("systemmind_template_confidence")
      .upsert(row, { onConflict: "template_id" });
    if (upErr) {
      if (isRelationMissing(upErr)) throw new Error("MIGRATION_NOT_APPLIED");
      throw new Error(upErr.message);
    }
    scored += 1;
  }
  return { scored, total: (templates ?? []).length };
}

/**
 * Read persisted confidence rows, joined with the current template so the UI can
 * flag stale scores. `recommended` is computed here against the live threshold.
 */
export async function listTemplateConfidence(
  workspaceId: string,
  threshold: number,
): Promise<{ applied: boolean; threshold: number; rows: TemplateConfidenceRow[] }> {
  const sb = supabaseAdmin as any;
  try {
    const { data: conf, error } = await sb
      .from("systemmind_template_confidence")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("overall_score", { ascending: false });
    if (error) {
      if (isRelationMissing(error)) return { applied: false, threshold, rows: [] };
      throw new Error(error.message);
    }

    const { data: templates } = await sb
      .from("systemmind_workflow_templates")
      .select("id, name, category, status, current_version")
      .eq("workspace_id", workspaceId)
      .limit(500);
    const tplById = new Map<string, any>((templates ?? []).map((t: any) => [t.id, t]));

    const rows: TemplateConfidenceRow[] = (conf ?? []).map((c: any) => {
      const tpl = tplById.get(c.template_id);
      return {
        template_id: c.template_id,
        name: tpl?.name ?? "(deleted template)",
        category: tpl?.category ?? null,
        status: tpl?.status ?? null,
        understanding: c.understanding,
        documentation: c.documentation,
        reuse: c.reuse,
        crm_portability: c.crm_portability,
        deployment_readiness: c.deployment_readiness,
        dependency: c.dependency,
        overall_score: c.overall_score,
        risk_rating: c.risk_rating,
        recommended: c.overall_score >= threshold,
        stale: tpl ? (tpl.current_version ?? 1) !== (c.template_current_version ?? 1) : true,
        computed_at: c.computed_at,
        signals: c.signals ?? {},
      };
    });
    return { applied: true, threshold, rows };
  } catch (e) {
    if (isRelationMissing(e)) return { applied: false, threshold, rows: [] };
    throw e;
  }
}
