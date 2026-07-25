/**
 * SEO Blog Campaign engine — approval-first, evidence-driven campaign
 * lifecycle (§5–§9 master programme).
 *
 * Stages: proposed → awaiting_strategy_approval → executing_analysis →
 * awaiting_brief_approval → drafting → awaiting_content_approval →
 * awaiting_deployment_approval → awaiting_website_deployment → monitoring.
 *
 * Rules honoured:
 *  - Never invents metrics — GSC evidence comes from synced tables; when the
 *    property is baseline-pending, campaigns proceed on business-context
 *    grounds with the limitation recorded on the row.
 *  - Existing-page-first: analysis checks synced page data + existing content
 *    projects/campaigns before proposing a new page.
 *  - Every consequential transition writes a hivemind_actions approval item;
 *    nothing is deployed automatically — deployment produces a manual
 *    Lovable package (WEBEE has no verified direct-publish hook).
 *  - Safety gate blocks: restricted claims / topics-to-avoid from teachings,
 *    duplicate/cannibalising topics, invalid metadata.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const sb = supabaseAdmin as any;

// ── AI helper (platform key first, workspace key fallback) ───────────────────

async function getAiKey(workspaceId: string): Promise<{ provider: "openai" | "gemini"; key: string } | null> {
  if (process.env.OPENAI_API_KEY) return { provider: "openai", key: process.env.OPENAI_API_KEY };
  if (process.env.GEMINI_API_KEY) return { provider: "gemini", key: process.env.GEMINI_API_KEY };
  const { data } = await sb
    .from("workspace_settings")
    .select("openai_api_key, gemini_api_key")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (data?.openai_api_key) return { provider: "openai", key: data.openai_api_key };
  if (data?.gemini_api_key) return { provider: "gemini", key: data.gemini_api_key };
  return null;
}

/** Best-effort AI cost log so AccountsMind can track SEO campaign spend (§13). */
function logSeoGeneration(workspaceId: string, provider: string, model: string, inputTokens: number, outputTokens: number, costUsd: number): void {
  void sb.from("growthmind_generation_logs").insert({
    workspace_id: workspaceId,
    asset_id: null,
    task_type: "seo_campaign",
    provider,
    model,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    estimated_cost_usd: costUsd,
    status: "success",
    fallback_from: null,
    created_at: new Date().toISOString(),
  }).then(() => {}, () => {});
}

async function callAiJson(workspaceId: string, system: string, user: string): Promise<any> {
  const ai = await getAiKey(workspaceId);
  if (!ai) throw new Error("No AI provider key configured for this workspace");
  if (ai.provider === "openai") {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${ai.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    const inTok = json.usage?.prompt_tokens ?? 0;
    const outTok = json.usage?.completion_tokens ?? 0;
    // gpt-4o-mini: $0.15/M input, $0.60/M output
    logSeoGeneration(workspaceId, "openai", "gpt-4o-mini", inTok, outTok, (inTok * 0.15 + outTok * 0.6) / 1_000_000);
    return JSON.parse(json.choices?.[0]?.message?.content ?? "{}");
  }
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${ai.key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.4 },
      }),
    },
  );
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  const gIn = json.usageMetadata?.promptTokenCount ?? 0;
  const gOut = json.usageMetadata?.candidatesTokenCount ?? 0;
  // gemini-2.0-flash: $0.10/M input, $0.40/M output
  logSeoGeneration(workspaceId, "gemini", "gemini-2.0-flash", gIn, gOut, (gIn * 0.1 + gOut * 0.4) / 1_000_000);
  return JSON.parse(json.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}");
}

// ── Business + teaching context ───────────────────────────────────────────────

async function buildBusinessContext(workspaceId: string): Promise<string> {
  const [{ data: dna }, { data: teachings }] = await Promise.all([
    sb.from("growthmind_business_dna")
      .select("company_name, website, industry, products, services, ideal_customer_profiles, target_markets, unique_selling_points")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    sb.from("growthmind_seo_teachings")
      .select("teaching_type, content")
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .limit(100),
  ]);
  const lines: string[] = [];
  if (dna) {
    lines.push(`Company: ${dna.company_name ?? "unknown"}`);
    if (dna.website) lines.push(`Website: ${dna.website}`);
    lines.push(`Industry: ${dna.industry ?? "unknown"}`);
    lines.push(`Products: ${dna.products ?? "unknown"}`);
    lines.push(`Services: ${dna.services ?? "unknown"}`);
    lines.push(`Ideal customers: ${dna.ideal_customer_profiles ?? "unknown"}`);
    if (dna.target_markets) lines.push(`Target markets: ${dna.target_markets}`);
    if (dna.unique_selling_points) lines.push(`Unique selling points: ${dna.unique_selling_points}`);
  }
  for (const t of teachings ?? []) lines.push(`Teaching [${t.teaching_type}]: ${t.content}`);
  return lines.join("\n");
}

async function getActiveTeachings(workspaceId: string, types: string[]): Promise<Array<{ teaching_type: string; content: string }>> {
  const { data } = await sb
    .from("growthmind_seo_teachings")
    .select("teaching_type, content")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .in("teaching_type", types);
  return data ?? [];
}

// ── Approval helper ──────────────────────────────────────────────────────────

async function createApprovalAction(opts: {
  workspaceId: string;
  campaignId: string;
  stage: string;
  title: string;
  description: string;
}): Promise<string | null> {
  const { data, error } = await sb
    .from("hivemind_actions")
    .insert({
      workspace_id: opts.workspaceId,
      action_type: "seo_campaign_approval",
      title: opts.title,
      description: opts.description,
      status: "pending",
      proposed_by: "growthmind",
      sensitive: true,
      sensitive_category: "campaign",
      action_payload: { campaignId: opts.campaignId, stage: opts.stage, sensitive: true },
    })
    .select("id")
    .single();
  if (error) {
    console.warn("[seo-campaign] approval action insert failed:", error.message);
    return null;
  }
  return data.id as string;
}

async function appendApproval(campaignId: string, entry: Record<string, unknown>): Promise<void> {
  const { data } = await sb.from("growthmind_seo_campaigns").select("approvals").eq("id", campaignId).maybeSingle();
  const approvals = Array.isArray(data?.approvals) ? data.approvals : [];
  approvals.push({ ...entry, at: new Date().toISOString() });
  await sb.from("growthmind_seo_campaigns").update({ approvals, updated_at: new Date().toISOString() }).eq("id", campaignId);
}

// ── Campaign creation ────────────────────────────────────────────────────────

export async function createSeoCampaignCore(input: {
  workspaceId: string;
  userId: string | null;
  name: string;
  campaignType?: string;
  objective?: string;
  productService?: string;
  targetIndustry?: string;
  targetCountry?: string;
  language?: string;
  customerProblem?: string;
  primaryTopic?: string;
}): Promise<{ ok: boolean; campaignId?: string; status?: string; error?: string }> {
  // WBAH exclusion
  const { data: ws } = await sb.from("workspaces").select("name").eq("id", input.workspaceId).maybeSingle();
  if ((ws?.name ?? "").toLowerCase().includes("wbah")) {
    return { ok: false, error: "SEO campaigns are not available for this workspace." };
  }

  const { data: row, error } = await sb
    .from("growthmind_seo_campaigns")
    .insert({
      workspace_id: input.workspaceId,
      campaign_type: input.campaignType ?? "blog",
      name: input.name,
      status: "awaiting_strategy_approval",
      parent_objective: input.objective ?? null,
      product_service: input.productService ?? null,
      target_industry: input.targetIndustry ?? null,
      target_country: input.targetCountry ?? null,
      language: input.language ?? null,
      customer_problem: input.customerProblem ?? null,
      primary_topic: input.primaryTopic ?? input.name,
      created_by_user_id: input.userId,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  await createApprovalAction({
    workspaceId: input.workspaceId,
    campaignId: row.id,
    stage: "strategy",
    title: `SEO campaign proposed: ${input.name}`,
    description:
      `GrowthMind proposes a ${input.campaignType ?? "blog"} SEO campaign.\n` +
      `Objective: ${input.objective ?? "not stated"}\nTopic: ${input.primaryTopic ?? input.name}\n\n`,
  });

  return { ok: true, campaignId: row.id, status: "awaiting_strategy_approval" };
}

// ── Analysis stage (existing-page-first + GSC evidence) ──────────────────────

export async function runCampaignAnalysis(workspaceId: string, campaignId: string): Promise<{
  ok: boolean;
  pageDecision?: string;
  error?: string;
}> {
  const { data: campaign } = await sb
    .from("growthmind_seo_campaigns")
    .select("*")
    .eq("id", campaignId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!campaign) return { ok: false, error: "Campaign not found" };

  await sb.from("growthmind_seo_campaigns").update({ status: "executing_analysis", updated_at: new Date().toISOString() }).eq("id", campaignId);

  const { detectOpportunities, analyseDimension, getSyncStateForWorkspace } = await import(
    "@/lib/growthmind/seo-intelligence.server"
  );
  const { state } = await getSyncStateForWorkspace(workspaceId);
  const topic = (campaign.primary_topic ?? campaign.name ?? "").toLowerCase();
  const limitations: string[] = [];
  if (state?.baseline_pending) {
    limitations.push("Search Console baseline pending — campaign planned from business context; GSC evidence will attach once Google publishes performance rows.");
  }

  // GSC evidence: queries + pages relevant to the topic
  const [queryEnv, pageEnv] = await Promise.all([
    analyseDimension(workspaceId, "query", { days: 180, limit: 500 }),
    analyseDimension(workspaceId, "page", { days: 180, limit: 500 }),
  ]);
  const topicWords = topic.split(/\s+/).filter((w: string) => w.length > 3);
  const matches = (key: string) => topicWords.some((w: string) => key.toLowerCase().includes(w));
  const relatedQueries = queryEnv.deliverables.items.filter((q) => matches(q.key)).slice(0, 25);
  const relatedPages = pageEnv.deliverables.items.filter((p) => matches(p.key)).slice(0, 25);

  // Existing content: calendar entries + other campaigns on similar topics
  const [{ data: calendar }, { data: siblingCampaigns }] = await Promise.all([
    sb.from("growthmind_content_calendar")
      .select("id, title, status, notes")
      .eq("workspace_id", workspaceId)
      .eq("content_type", "Blog")
      .limit(200),
    sb.from("growthmind_seo_campaigns")
      .select("id, name, primary_topic, status")
      .eq("workspace_id", workspaceId)
      .neq("id", campaignId)
      .not("status", "in", "(cancelled,failed)")
      .limit(200),
  ]);
  const similarContent = (calendar ?? []).filter((c: any) => matches(c.title ?? ""));
  const similarCampaigns = (siblingCampaigns ?? []).filter((c: any) => matches(`${c.name} ${c.primary_topic ?? ""}`));

  const pageDecision =
    relatedPages.length > 0 ? "update_existing" : "create_new";
  const pageDecisionReason =
    relatedPages.length > 0
      ? `Existing page(s) already earn impressions for this topic (${relatedPages[0].key}) — strengthening beats duplicating.`
      : state?.baseline_pending
      ? "No page-level Search Console data yet (baseline pending) and no existing ranking page found — a new page is proposed on business-context grounds."
      : "No existing page earns impressions for this topic — a new page is warranted.";

  await sb.from("growthmind_seo_campaigns").update({
    status: "awaiting_brief_approval",
    gsc_evidence: {
      relatedQueries,
      relatedPages,
      recordsAnalysed: queryEnv.recordsAnalysed + pageEnv.recordsAnalysed,
      baselinePending: !!state?.baseline_pending,
    },
    data_limitations: limitations,
    related_pages: relatedPages,
    competing_pages: similarContent.map((c: any) => ({ id: c.id, title: c.title, status: c.status })),
    page_decision: pageDecision,
    page_decision_reason: pageDecisionReason,
    query_cluster: relatedQueries.map((q) => q.key),
    evidence: {
      similarCampaigns: similarCampaigns.map((c: any) => ({ id: c.id, name: c.name, status: c.status })),
      analysedAt: new Date().toISOString(),
    },
    updated_at: new Date().toISOString(),
  }).eq("id", campaignId);

  return { ok: true, pageDecision };
}

// ── Brief + article generation ────────────────────────────────────────────────

export async function generateCampaignBrief(workspaceId: string, campaignId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: campaign } = await sb
    .from("growthmind_seo_campaigns").select("*").eq("id", campaignId).eq("workspace_id", workspaceId).maybeSingle();
  if (!campaign) return { ok: false, error: "Campaign not found" };

  const context = await buildBusinessContext(workspaceId);
  const evidence = campaign.gsc_evidence ?? {};
  try {
    const brief = await callAiJson(
      workspaceId,
      "You are an SEO content strategist. Produce a JSON content brief. Never invent search metrics — only reference the evidence provided. Keys: proposedUrlSlug, proposedTitle, metaTitle (<=65 chars), metaDescription (120-160 chars), h1, searchIntent, idealReader, outline (array of {heading, points[]}), internalLinkSuggestions (array of strings), cta.",
      `Business context:\n${context}\n\nCampaign: ${campaign.name}\nType: ${campaign.campaign_type}\nTopic: ${campaign.primary_topic}\nObjective: ${campaign.parent_objective ?? "n/a"}\nCustomer problem: ${campaign.customer_problem ?? "n/a"}\nPage decision: ${campaign.page_decision} (${campaign.page_decision_reason})\n\nSearch Console evidence (may be empty if baseline pending):\n${JSON.stringify(evidence).slice(0, 4000)}`,
    );
    await sb.from("growthmind_seo_campaigns").update({
      brief,
      proposed_url: brief.proposedUrlSlug ? `/${String(brief.proposedUrlSlug).replace(/^\//, "")}` : null,
      proposed_title: brief.proposedTitle ?? null,
      meta_title: brief.metaTitle ?? null,
      meta_description: brief.metaDescription ?? null,
      h1: brief.h1 ?? null,
      search_intent: brief.searchIntent ?? null,
      ideal_reader: brief.idealReader ?? null,
      outline: brief.outline ?? null,
      updated_at: new Date().toISOString(),
    }).eq("id", campaignId);

    await createApprovalAction({
      workspaceId,
      campaignId,
      stage: "brief",
      title: `SEO brief ready: ${campaign.name}`,
      description: `Brief drafted for "${brief.proposedTitle ?? campaign.name}" (${campaign.page_decision}). Review the outline and approve to generate the article.`,
    });
    return { ok: true };
  } catch (e: any) {
    await sb.from("growthmind_seo_campaigns").update({ status: "blocked", blocked_reason: `Brief generation failed: ${e?.message}`, updated_at: new Date().toISOString() }).eq("id", campaignId);
    return { ok: false, error: e?.message ?? String(e) };
  }
}

export async function generateCampaignArticle(workspaceId: string, campaignId: string): Promise<{ ok: boolean; contentProjectId?: string; error?: string }> {
  const { data: campaign } = await sb
    .from("growthmind_seo_campaigns").select("*").eq("id", campaignId).eq("workspace_id", workspaceId).maybeSingle();
  if (!campaign) return { ok: false, error: "Campaign not found" };
  if (!campaign.brief) return { ok: false, error: "No approved brief on this campaign" };

  await sb.from("growthmind_seo_campaigns").update({ status: "drafting", updated_at: new Date().toISOString() }).eq("id", campaignId);
  const context = await buildBusinessContext(workspaceId);
  try {
    const article = await callAiJson(
      workspaceId,
      "You are an expert SEO content writer. Write the full article per the approved brief. JSON keys: title, body (markdown, 1200-1800 words, use the outline headings), excerpt, metaTitle, metaDescription. Follow all restricted-claim teachings strictly.",
      `Business context:\n${context}\n\nApproved brief:\n${JSON.stringify(campaign.brief).slice(0, 6000)}`,
    );

    // Safety gate BEFORE storing as ready-for-approval
    const gate = await runSeoSafetyGate(workspaceId, campaignId, {
      title: article.title ?? campaign.proposed_title ?? campaign.name,
      body: article.body ?? "",
      metaTitle: article.metaTitle ?? campaign.meta_title ?? "",
      metaDescription: article.metaDescription ?? campaign.meta_description ?? "",
      proposedUrl: campaign.proposed_url,
    });
    if (!gate.passed) {
      await sb.from("growthmind_seo_campaigns").update({
        status: "blocked",
        blocked_reason: `Safety gate failed: ${gate.failures.map((f) => f.check).join(", ")}`,
        safety_results: gate,
        updated_at: new Date().toISOString(),
      }).eq("id", campaignId);
      return { ok: false, error: `Safety gate blocked the draft: ${gate.failures.map((f) => `${f.check}: ${f.detail}`).join("; ")}` };
    }

    // Store into Content Studio calendar (existing backbone)
    const { data: inserted, error } = await sb
      .from("growthmind_content_calendar")
      .insert({
        workspace_id: workspaceId,
        title: `[SEO Campaign] ${article.title ?? campaign.name}`,
        content_type: "Blog",
        channel: "Blog",
        status: "Draft",
        description: article.body ?? "",
        notes: JSON.stringify({
          excerpt: article.excerpt ?? "",
          seoData: {
            primaryKeyword: campaign.primary_topic,
            metaTitle: article.metaTitle ?? "",
            metaDescription: article.metaDescription ?? "",
            slug: (campaign.proposed_url ?? "").replace(/^\//, ""),
          },
          seoCampaignId: campaignId,
        }),
        updated_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    await sb.from("growthmind_seo_campaigns").update({
      status: "awaiting_content_approval",
      content_project_id: inserted.id,
      safety_results: gate,
      updated_at: new Date().toISOString(),
    }).eq("id", campaignId);

    await createApprovalAction({
      workspaceId,
      campaignId,
      stage: "content",
      title: `SEO article drafted: ${article.title ?? campaign.name}`,
      description: `Full article drafted and passed the safety gate (${gate.checks.length} checks). Review the draft in Content Studio, then approve to build the deployment package.`,
    });
    return { ok: true, contentProjectId: inserted.id };
  } catch (e: any) {
    await sb.from("growthmind_seo_campaigns").update({ status: "blocked", blocked_reason: `Article generation failed: ${e?.message}`, updated_at: new Date().toISOString() }).eq("id", campaignId);
    return { ok: false, error: e?.message ?? String(e) };
  }
}

// ── Safety gate (§8) ─────────────────────────────────────────────────────────

export type SafetyGateResult = {
  passed: boolean;
  checks: Array<{ check: string; passed: boolean; detail: string }>;
  failures: Array<{ check: string; detail: string }>;
  ranAt: string;
};

export async function runSeoSafetyGate(
  workspaceId: string,
  campaignId: string | null,
  draft: { title: string; body: string; metaTitle: string; metaDescription: string; proposedUrl?: string | null },
): Promise<SafetyGateResult> {
  const checks: SafetyGateResult["checks"] = [];
  const add = (check: string, passed: boolean, detail: string) => checks.push({ check, passed, detail });

  // 1. Restricted claims / topics to avoid (teachings)
  const restrictions = await getActiveTeachings(workspaceId, ["restricted_claim", "topic_to_avoid"]);
  const haystack = `${draft.title}\n${draft.metaTitle}\n${draft.metaDescription}\n${draft.body}`.toLowerCase();
  const violated = restrictions.filter((r) => {
    const needle = r.content.toLowerCase().replace(/^(never|avoid|don'?t)\s+(say|claim|mention|write about)\s*/i, "").trim();
    return needle.length > 3 && haystack.includes(needle);
  });
  add("restricted_claims", violated.length === 0,
    violated.length === 0 ? `No restricted claims/topics matched (${restrictions.length} rules checked).` : `Matched restrictions: ${violated.map((v) => v.content).join("; ")}`);

  // 2. Metadata validity
  const mt = draft.metaTitle?.length ?? 0;
  const md = draft.metaDescription?.length ?? 0;
  add("meta_title_length", mt > 0 && mt <= 70, `Meta title ${mt} chars (target 1–70).`);
  add("meta_description_length", md >= 70 && md <= 170, `Meta description ${md} chars (target 70–170).`);

  // 3. Duplicate title / cannibalisation vs existing content + campaigns
  const [{ data: calendar }, { data: campaigns }] = await Promise.all([
    sb.from("growthmind_content_calendar").select("id, title").eq("workspace_id", workspaceId).eq("content_type", "Blog").limit(300),
    sb.from("growthmind_seo_campaigns").select("id, name, proposed_title").eq("workspace_id", workspaceId).not("status", "in", "(cancelled,failed)").limit(300),
  ]);
  const norm = (s: string) => s.toLowerCase().replace(/\[.*?\]/g, "").replace(/[^a-z0-9\s]/g, "").trim();
  const draftNorm = norm(draft.title);
  const dupContent = (calendar ?? []).filter((c: any) => norm(c.title ?? "") === draftNorm);
  const dupCampaign = (campaigns ?? []).filter((c: any) => c.id !== campaignId && norm(c.proposed_title ?? c.name ?? "") === draftNorm);
  add("duplicate_title", dupContent.length === 0 && dupCampaign.length === 0,
    dupContent.length || dupCampaign.length ? "An existing draft or campaign already targets this exact title." : "No duplicate titles found.");

  // 4. URL sanity
  const url = draft.proposedUrl ?? "";
  add("url_format", !url || /^\/[a-z0-9\-\/]*$/.test(url), url ? `Proposed URL "${url}" ${/^\/[a-z0-9\-\/]*$/.test(url) ? "is" : "is NOT"} a clean lowercase slug path.` : "No URL proposed yet.");

  // 5. Minimum substance (no thin content)
  const words = draft.body.split(/\s+/).filter(Boolean).length;
  add("content_depth", words >= 600, `Article body has ${words} words (minimum 600).`);

  const failures = checks.filter((c) => !c.passed).map((c) => ({ check: c.check, detail: c.detail }));
  return { passed: failures.length === 0, checks, failures, ranAt: new Date().toISOString() };
}

// ── Deployment package (§9 — manual Lovable handoff, never direct publish) ───

export async function buildDeploymentPackage(workspaceId: string, campaignId: string, userId: string | null): Promise<{ ok: boolean; packageId?: string; error?: string }> {
  const { data: campaign } = await sb
    .from("growthmind_seo_campaigns").select("*").eq("id", campaignId).eq("workspace_id", workspaceId).maybeSingle();
  if (!campaign) return { ok: false, error: "Campaign not found" };
  if (!campaign.content_project_id) return { ok: false, error: "No approved article on this campaign" };

  const { data: content } = await sb
    .from("growthmind_content_calendar")
    .select("title, description, notes")
    .eq("id", campaign.content_project_id)
    .maybeSingle();
  if (!content) return { ok: false, error: "Content draft not found" };

  let meta: any = {};
  try { meta = JSON.parse(content.notes ?? "{}"); } catch { /* ignore */ }

  const pageMode = campaign.page_decision === "update_existing" ? "existing_page" : "new_page";
  const route = campaign.proposed_url ?? `/${(meta.seoData?.slug ?? "").replace(/^\//, "")}`;

  const pkg = {
    pageMode,
    route,
    title: content.title?.replace(/^\[SEO Campaign\]\s*/, "") ?? campaign.name,
    h1: campaign.h1,
    metaTitle: campaign.meta_title ?? meta.seoData?.metaTitle ?? null,
    metaDescription: campaign.meta_description ?? meta.seoData?.metaDescription ?? null,
    bodyMarkdown: content.description ?? "",
    internalLinks: campaign.brief?.internalLinkSuggestions ?? [],
    cta: campaign.brief?.cta ?? null,
    structuredData: {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: campaign.meta_title ?? campaign.proposed_title ?? campaign.name,
      description: campaign.meta_description ?? null,
    },
    sitemapNote: "After the page is live, resubmit the sitemap in Search Console (or approve submit_approved_sitemap) so Google discovers the new URL.",
  };

  const manualInstructions = [
    "MANUAL LOVABLE DEPLOYMENT (WEBEE cannot publish to the Lovable-hosted site directly):",
    `1. In Lovable, ${pageMode === "new_page" ? `create a new page at route "${route}"` : `open the existing page "${route}"`}.`,
    "2. Paste the body content (markdown) into the page, matching the outline headings.",
    `3. Set the meta title: "${pkg.metaTitle ?? ""}"`,
    `4. Set the meta description: "${pkg.metaDescription ?? ""}"`,
    "5. Add the structured data (BlogPosting JSON-LD) to the page head.",
    "6. Publish the Lovable site.",
    "7. Return to WEBEE and mark the package as deployed with the live URL — WEBEE will then verify with URL Inspection and start monitoring.",
  ].join("\n");

  const { data: pkgRow, error } = await sb
    .from("growthmind_seo_deployment_packages")
    .insert({
      workspace_id: workspaceId,
      campaign_id: campaignId,
      content_project_id: campaign.content_project_id,
      status: "awaiting_deployment_approval",
      target_website: "Lovable Cloud site",
      page_mode: pageMode,
      proposed_route: route,
      package: pkg,
      rollback_content: pageMode === "existing_page"
        ? { note: "Capture the current live page content in Lovable BEFORE replacing it — paste it here to enable rollback." }
        : { note: "New page — rollback = unpublish the page in Lovable." },
      manual_instructions: manualInstructions,
      created_by_user_id: userId,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };

  await sb.from("growthmind_seo_campaigns").update({
    status: "awaiting_deployment_approval",
    deployment_package_id: pkgRow.id,
    updated_at: new Date().toISOString(),
  }).eq("id", campaignId);

  await createApprovalAction({
    workspaceId,
    campaignId,
    stage: "deployment",
    title: `Deployment package ready: ${campaign.name}`,
    description: `A manual Lovable deployment package is ready (${pageMode}, route ${route}). Approve to release the package for manual deployment.`,
  });
  return { ok: true, packageId: pkgRow.id };
}

// ── Stage advance (called after user approves in Action Centre / UI) ─────────

export async function advanceSeoCampaign(
  workspaceId: string,
  campaignId: string,
  approvedStage: "strategy" | "brief" | "content" | "deployment",
  userId: string | null,
): Promise<{ ok: boolean; status?: string; error?: string }> {
  const { data: campaign } = await sb
    .from("growthmind_seo_campaigns").select("id, status, name").eq("id", campaignId).eq("workspace_id", workspaceId).maybeSingle();
  if (!campaign) return { ok: false, error: "Campaign not found" };

  const expected: Record<string, string> = {
    strategy: "awaiting_strategy_approval",
    brief: "awaiting_brief_approval",
    content: "awaiting_content_approval",
    deployment: "awaiting_deployment_approval",
  };
  if (campaign.status !== expected[approvedStage]) {
    return { ok: false, error: `Campaign is in status "${campaign.status}" — cannot approve stage "${approvedStage}".` };
  }
  await appendApproval(campaignId, { stage: approvedStage, approvedBy: userId, decision: "approved" });

  if (approvedStage === "strategy") {
    const analysis = await runCampaignAnalysis(workspaceId, campaignId);
    if (!analysis.ok) return { ok: false, error: analysis.error };
    const brief = await generateCampaignBrief(workspaceId, campaignId);
    if (!brief.ok) return { ok: false, error: brief.error };
    return { ok: true, status: "awaiting_brief_approval" };
  }
  if (approvedStage === "brief") {
    const art = await generateCampaignArticle(workspaceId, campaignId);
    if (!art.ok) return { ok: false, error: art.error };
    return { ok: true, status: "awaiting_content_approval" };
  }
  if (approvedStage === "content") {
    const pkg = await buildDeploymentPackage(workspaceId, campaignId, userId);
    if (!pkg.ok) return { ok: false, error: pkg.error };
    return { ok: true, status: "awaiting_deployment_approval" };
  }
  // deployment approved → hand off for manual website deployment
  await sb.from("growthmind_seo_campaigns").update({ status: "awaiting_website_deployment", updated_at: new Date().toISOString() }).eq("id", campaignId);
  const { data: c2 } = await sb.from("growthmind_seo_campaigns").select("deployment_package_id").eq("id", campaignId).maybeSingle();
  if (c2?.deployment_package_id) {
    await sb.from("growthmind_seo_deployment_packages").update({ status: "awaiting_website_deployment", updated_at: new Date().toISOString() }).eq("id", c2.deployment_package_id);
  }
  return { ok: true, status: "awaiting_website_deployment" };
}

export async function markPackageDeployed(
  workspaceId: string,
  packageId: string,
  liveUrl: string,
): Promise<{ ok: boolean; verification?: any; error?: string }> {
  const { data: pkg } = await sb
    .from("growthmind_seo_deployment_packages")
    .select("id, campaign_id, status")
    .eq("id", packageId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!pkg) return { ok: false, error: "Package not found" };
  if (pkg.status !== "awaiting_website_deployment") {
    return { ok: false, error: `Package is "${pkg.status}" — approve deployment first.` };
  }

  // Verify with URL Inspection (real evidence, may be "URL is unknown to Google" for brand-new pages — honest state)
  const { inspectAndStoreUrl } = await import("@/lib/growthmind/gsc-sync-core");
  const inspection = await inspectAndStoreUrl(workspaceId, liveUrl);

  await sb.from("growthmind_seo_deployment_packages").update({
    status: "deployed",
    live_url: liveUrl,
    validation: { inspection, at: new Date().toISOString() },
    updated_at: new Date().toISOString(),
  }).eq("id", packageId);
  if (pkg.campaign_id) {
    await sb.from("growthmind_seo_campaigns").update({
      status: "monitoring",
      monitoring: {
        liveUrl,
        startedAt: new Date().toISOString(),
        note: "Daily GSC sync will surface impressions/clicks for this URL as Google indexes it. New pages typically take days–weeks to appear.",
        initialInspection: inspection,
      },
      updated_at: new Date().toISOString(),
    }).eq("id", pkg.campaign_id);
  }
  return { ok: true, verification: inspection };
}
