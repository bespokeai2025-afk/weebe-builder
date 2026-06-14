import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ── Compile a rich marketing system prompt ─────────────────────────────────────
function compileSystemPrompt(data: any, personality: string): string {
  if (!data) return "You are GrowthMind, an AI Chief Marketing Officer. You help identify revenue opportunities, improve marketing performance, and drive sustainable business growth.";

  const { calls, leads, bookings, campaigns, email, whatsapp, marketing, systemHealth } = data;

  const tone =
    personality === "friendly"     ? "warm, encouraging, and practical"
    : personality === "concise"    ? "direct, bullet-pointed, and brief"
    : "professional, data-driven, and strategic";

  const activeCampaignNames = campaigns?.stats
    ?.filter((c: any) => c.status === "running" || c.status === "active")
    .map((c: any) => c.name).join(", ") || "None";

  return `You are GrowthMind, an AI Chief Marketing Officer (CMO) built into the Webee platform.

Your communication style is ${tone}.

You are a pure marketing strategist. You focus exclusively on: lead generation, pipeline performance, campaign optimisation, content marketing, SEO, multi-channel engagement, conversion rate improvement, and revenue growth. You do not comment on technical infrastructure, API integrations, or platform setup — only marketing outcomes.

## Live Marketing Data

### Pipeline & Leads
- Total leads: ${leads?.total ?? 0} | Active: ${leads?.active ?? 0} | Need to call: ${leads?.needCall ?? 0}
- Stale (14d+): ${leads?.staleCount ?? 0} | Converted (sales): ${leads?.sales ?? 0}
- Conversion rate: ${leads?.conversionRate ?? 0}% | Follow-up coverage: ${leads?.followUpCoverage ?? 0}%
- New leads — last 7 days: ${leads?.newLast7 ?? 0} | Last 30 days: ${leads?.newLast30 ?? 0}
- Avg lead response time: ${leads?.avgResponseHrs !== null && leads?.avgResponseHrs !== undefined ? leads.avgResponseHrs + " hours" : "not measured"}

### Outreach Performance (last 30 days)
- Total calls: ${calls?.total ?? 0} | Success rate: ${calls?.successRate ?? 0}%
- Avg call duration: ${calls?.avgDuration ?? 0}s | Inbound: ${calls?.inbound ?? 0} | Outbound: ${calls?.outbound ?? 0}
- Calls last 7 days: ${calls?.last7 ?? 0}

### Bookings & Appointments
- Total bookings: ${bookings?.total ?? 0} | Last 7 days: ${bookings?.last7 ?? 0}
- Booking rate: ${bookings?.bookingRate ?? 0}%

### Campaigns
- Total: ${campaigns?.total ?? 0} | Active: ${campaigns?.active ?? 0}
- Active campaign names: ${activeCampaignNames}

### Multi-Channel Engagement
- WhatsApp: ${whatsapp?.total ?? 0} messages (${whatsapp?.inbound ?? 0} in / ${whatsapp?.outbound ?? 0} out, last 30d)
- Email campaigns: ${email?.total ?? 0} total | ${email?.active ?? 0} active

### Content & SEO Intelligence
- SEO keywords tracked: ${marketing?.seoKeywords ?? 0}
- Content published (last 14 days): ${marketing?.recentContentCount ?? 0} pieces
- Competitors being tracked: ${marketing?.competitorsCount ?? 0}
- Follow-up email sequences: ${marketing?.followUpCampaignsCount ?? 0}
- WhatsApp outbound messages (30d): ${marketing?.waOutboundLast30 ?? 0}

### Marketing Stack Status
- Outreach campaigns: ${systemHealth?.campaigns ? "✅ configured" : "❌ none"}
- Active campaigns running: ${systemHealth?.activeCampaigns ? "✅ yes" : "❌ paused/none"}
- Email campaigns: ${systemHealth?.emailCampaigns ? "✅ active" : "❌ none"}
- Follow-up sequences: ${systemHealth?.followUpCampaigns ? "✅ active" : "❌ none"}
- WhatsApp channel: ${systemHealth?.whatsapp ? "✅ connected" : "❌ not connected"}
- SEO monitoring: ${systemHealth?.seoKeywords ? "✅ keywords tracked" : "❌ no keywords"}
- Content publishing: ${systemHealth?.recentContent ? "✅ recently active" : "❌ no recent content"}
- Competitor tracking: ${systemHealth?.competitors ? "✅ tracking" : "❌ not tracking"}

## Your Role as CMO
You are the user's strategic marketing advisor. You:
1. Identify the highest-impact revenue opportunities in the data above
2. Recommend specific marketing actions with clear business impact and ROI estimates
3. Analyse trends and proactively flag risks before they become problems
4. Advise on campaign strategy, content marketing, SEO, and multi-channel outreach
5. Help prioritise where to focus for maximum marketing ROI
6. Provide competitive and market positioning guidance when relevant

Always cite specific numbers when making recommendations. Keep responses concise and actionable — every recommendation must have a clear next step. Focus entirely on marketing performance and growth strategy.`;
}

// ── Dynamic retrieval query builder ───────────────────────────────────────────
// Generates a semantically rich, context-specific embedding query from live
// GrowthMind platform data so RAG retrieval surfaces relevant knowledge instead
// of returning the same generic chunks every time.
function buildGrowthMindRetrievalQuery(pd: any): string {
  if (!pd) return "marketing growth priorities, lead generation, campaign optimisation, revenue opportunities";

  const parts: string[] = [];

  // Lead pipeline state
  if (pd.leads) {
    const { total = 0, newLast7 = 0, staleCount = 0, conversionRate = 0, sales = 0 } = pd.leads;
    parts.push(`Lead pipeline: ${total} total leads, ${newLast7} new this week, ${sales} converted, ${staleCount} stale`);
    if (conversionRate > 0) parts.push(`conversion rate ${conversionRate}%`);
    if (total > 10 && conversionRate < 5)  parts.push("low conversion — funnel improvement and lead qualification strategies");
    if (total > 0 && staleCount / total > 0.3) parts.push("high stale ratio — re-engagement campaigns and follow-up automation");
  }

  // Campaign context
  if (pd.campaigns) {
    const { total = 0, active = 0, stats = [] } = pd.campaigns;
    const activeNames = (stats as any[])
      .filter((c) => c.status === "running" || c.status === "active")
      .slice(0, 3).map((c) => c.name).join(", ");
    if (active > 0 && activeNames) parts.push(`Active campaigns: ${activeNames}`);
    if (active === 0 && total > 0) parts.push("all campaigns paused — campaign reactivation and lead nurturing recommendations");
    if (active === 0 && total === 0) parts.push("no campaigns configured — campaign strategy and outreach setup guidance");
  }

  // Booking & call performance
  if (pd.bookings) {
    const { total = 0, bookingRate = 0, last7 = 0 } = pd.bookings;
    parts.push(`Bookings: ${last7} this week, ${total} total (${bookingRate}% booking rate)`);
    if (bookingRate < 5 && total > 0) parts.push("low booking conversion — appointment scheduling and follow-up optimisation");
  }

  if (pd.calls) {
    const { total = 0, successRate = 0, last7 = 0 } = pd.calls;
    if (total > 0) parts.push(`Calls: ${last7} this week, ${successRate}% success rate`);
    if (total > 10 && successRate < 30) parts.push("low call success — outreach script, timing, and targeting improvements");
  }

  // Multi-channel channels
  if (pd.whatsapp?.total > 0) parts.push(`WhatsApp engagement: ${pd.whatsapp.total} messages (30d)`);
  if (pd.email) {
    const { total = 0, active = 0 } = pd.email;
    if (active > 0) parts.push(`${active} active email campaigns`);
    else if (total === 0) parts.push("no email campaigns — email marketing strategy and sequence setup");
  }

  // SEO / content gaps
  if (pd.marketing) {
    const { seoKeywords = 0, recentContentCount = 0, competitorsCount = 0 } = pd.marketing;
    if (seoKeywords > 0)          parts.push(`${seoKeywords} SEO keywords tracked`);
    else                           parts.push("SEO monitoring not configured — keyword strategy and organic growth");
    if (recentContentCount === 0)  parts.push("no recent content published — content marketing calendar and publishing strategy");
    if (competitorsCount > 0)      parts.push(`${competitorsCount} competitors being tracked`);
  }

  // System health gaps → what knowledge to surface
  if (pd.systemHealth) {
    const gaps: string[] = [];
    if (!pd.systemHealth.activeCampaigns) gaps.push("campaign activation and lead nurturing");
    if (!pd.systemHealth.followUpCampaigns) gaps.push("follow-up sequence automation");
    if (!pd.systemHealth.whatsapp)         gaps.push("WhatsApp outreach channel setup");
    if (!pd.systemHealth.seoKeywords)      gaps.push("SEO monitoring and keyword tracking");
    if (!pd.systemHealth.recentContent)    gaps.push("content publishing cadence");
    if (gaps.length) parts.push(`Priority knowledge areas: ${gaps.join(", ")}`);
  }

  return parts.join(". ") || "marketing growth priorities, lead generation, campaign optimisation, revenue opportunities";
}

// ── AI Response ────────────────────────────────────────────────────────────────
export const getGrowthMindAIResponse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      messages:    z.array(z.object({ role: z.enum(["user","assistant"]), content: z.string() })),
      platformData: z.any().optional(),
      personality: z.string().default("professional"),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    const settings = (context as any).settings ?? {};
    const apiKey = process.env.OPENAI_API_KEY ?? settings.openai_api_key;
    if (!apiKey) throw new Error("OpenAI API key not configured. Add it in Settings → Integrations.");

    const lastUser = [...data.messages].reverse().find((m) => m.role === "user")?.content ?? "marketing growth strategy";
    const { getRetrievedKnowledgeBlock } = await import("@/lib/executives/executive-knowledge.server");
    const knowledgeBlock = workspaceId
      ? await getRetrievedKnowledgeBlock({ workspaceId, mindType: "growthmind", query: lastUser, topK: 5 })
      : "";

    const systemPrompt = compileSystemPrompt(data.platformData, data.personality) + (knowledgeBlock ? `\n\n${knowledgeBlock}` : "");

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          ...data.messages,
        ],
        max_tokens: 800,
        temperature: 0.7,
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      throw new Error(`OpenAI error: ${err.slice(0, 200)}`);
    }
    const json = await res.json() as any;
    return { reply: (json.choices?.[0]?.message?.content as string) ?? "" };
  });

// ── Morning Growth Briefing ────────────────────────────────────────────────────
export const getGrowthMindBriefing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ platformData: z.any().optional() }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    const settings = (context as any).settings ?? {};
    const apiKey = process.env.OPENAI_API_KEY ?? settings.openai_api_key;

    if (!data.platformData || !apiKey) {
      const pd = data.platformData;
      const fallback = pd
        ? `Good ${getTimeOfDay()}! Here's your marketing summary:\n\n` +
          `• **Pipeline**: ${pd.leads?.total ?? 0} leads total, ${pd.leads?.newLast7 ?? 0} new this week\n` +
          `• **Calls**: ${pd.calls?.total ?? 0} calls in last 30 days (${pd.calls?.successRate ?? 0}% success)\n` +
          `• **Bookings**: ${pd.bookings?.total ?? 0} total bookings\n` +
          `• **Campaigns**: ${pd.campaigns?.active ?? 0} active campaigns\n\n` +
          `Ask me anything about your marketing performance or where to focus for growth.`
        : "Good " + getTimeOfDay() + "! I'm GrowthMind, your AI Chief Marketing Officer. Ask me anything about your pipeline, campaigns, or where to focus for growth.";
      return { briefing: fallback };
    }

    const { getRetrievedKnowledgeBlock } = await import("@/lib/executives/executive-knowledge.server");
    const knowledgeBlock = workspaceId
      ? await getRetrievedKnowledgeBlock({ workspaceId, mindType: "growthmind", query: buildGrowthMindRetrievalQuery(data.platformData), topK: 5 })
      : "";
    const systemPrompt = compileSystemPrompt(data.platformData, "professional") + (knowledgeBlock ? `\n\n${knowledgeBlock}` : "");
    const prompt = `Generate a concise morning marketing briefing (3-5 sentences) that:
1. Highlights the most important metric or opportunity
2. Flags the biggest risk in the current pipeline
3. Recommends the single most impactful action to take today

Be specific with numbers. Start with "Good ${getTimeOfDay()}!" Keep it under 100 words.`;

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        max_tokens: 200,
        temperature: 0.6,
      }),
    });
    if (!res.ok) {
      return { briefing: `Good ${getTimeOfDay()}! Platform data loaded. Ask me anything about your marketing performance.` };
    }
    const json = await res.json() as any;
    return { briefing: (json.choices?.[0]?.message?.content as string) ?? "" };
  });

// ── TTS ───────────────────────────────────────────────────────────────────────
export const getGrowthMindTTS = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      text:    z.string().max(3000),
      voiceId: z.string().default("21m00Tcm4TlvDq8ikWAM"),
      speed:   z.number().min(0.5).max(2).default(1.0),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const settings = (context as any).settings ?? {};
    const elKey = process.env.ELEVENLABS_API_KEY ?? settings.elevenlabs_api_key;
    if (!elKey) return { audioBase64: null };

    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${data.voiceId}`,
      {
        method: "POST",
        headers: { "xi-api-key": elKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          text: data.text.slice(0, 2000),
          model_id: "eleven_turbo_v2",
          voice_settings: { stability: 0.45, similarity_boost: 0.75, speed: data.speed },
        }),
      }
    );
    if (!res.ok) return { audioBase64: null };
    const bytes = await res.arrayBuffer();
    const b64   = Buffer.from(bytes).toString("base64");
    return { audioBase64: b64 };
  });

// ── List EL voices ─────────────────────────────────────────────────────────────
export const listGrowthMindVoices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const settings = (context as any).settings ?? {};
    const elKey = process.env.ELEVENLABS_API_KEY ?? settings.elevenlabs_api_key;
    if (!elKey) return { voices: [] };
    try {
      const res = await fetch("https://api.elevenlabs.io/v1/voices", {
        headers: { "xi-api-key": elKey },
      });
      if (!res.ok) return { voices: [] };
      const json = await res.json() as any;
      return {
        voices: (json.voices ?? []).map((v: any) => ({
          id: v.voice_id, name: v.name, category: v.category ?? "custom",
        })),
      };
    } catch { return { voices: [] }; }
  });

function getTimeOfDay() {
  const h = new Date().getHours();
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}

// ── System context (for external use) ─────────────────────────────────────────
export const getGrowthMindSystemContext = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ platformData: z.any().optional() }).parse(input)
  )
  .handler(async ({ context, data }) => {
    return { systemPrompt: compileSystemPrompt(data.platformData, "professional") };
  });
