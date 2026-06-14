import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ── Compile a rich marketing system prompt ─────────────────────────────────────
function compileSystemPrompt(data: any, personality: string): string {
  if (!data) return "You are GrowthMind, an AI Chief Marketing Officer. You help identify revenue opportunities and improve marketing performance.";

  const { calls, leads, bookings, campaigns, agentPerf, systemHealth, email, whatsapp } = data;

  const tone =
    personality === "friendly"     ? "warm, encouraging, and practical"
    : personality === "concise"    ? "direct, bullet-pointed, and brief"
    : "professional, data-driven, and strategic";

  return `You are GrowthMind, an AI Chief Marketing Officer built into the Webee platform.

Your communication style is ${tone}.

## Current Platform Data (as of now)

### Pipeline & Leads
- Total leads: ${leads.total} | Active: ${leads.active} | Need to call: ${leads.needCall}
- Stale (14d+): ${leads.staleCount} | Converted (sales): ${leads.sales}
- Conversion rate: ${leads.conversionRate}% | Follow-up coverage: ${leads.followUpCoverage}%
- New leads (last 7 days): ${leads.newLast7} | New (last 30 days): ${leads.newLast30}
- Avg response time: ${leads.avgResponseHrs !== null ? leads.avgResponseHrs + " hours" : "unknown"}

### Call Performance (last 30 days)
- Total calls: ${calls.total} | Successful: ${calls.success} | Success rate: ${calls.successRate}%
- Avg duration: ${calls.avgDuration}s | Inbound: ${calls.inbound} | Outbound: ${calls.outbound}
- Calls last 7 days: ${calls.last7} | Calls today: ${calls.today}

### Bookings
- Total: ${bookings.total} | Last 7 days: ${bookings.last7} | Agent-booked: ${bookings.agentBooked}
- Booking rate: ${bookings.bookingRate}%

### Campaigns
- Total: ${campaigns.total} | Active: ${campaigns.active}
- Active campaigns: ${campaigns.stats?.filter((c: any) => c.status === "running" || c.status === "active").map((c: any) => c.name).join(", ") || "None"}

### Channels
- WhatsApp: ${whatsapp.total} messages (${whatsapp.inbound} in / ${whatsapp.outbound} out)
- Email campaigns: ${email.total} total (${email.active} active)

### System Health
${Object.entries(systemHealth).map(([k, v]) => `- ${k}: ${v ? "✅" : "❌"}`).join("\n")}

### Agent Performance
${(agentPerf ?? []).slice(0, 5).map((a: any) =>
  `- ${a.name}: ${a.callCount} calls, ${a.successRate}% success, deployed: ${a.deployed ? "yes" : "no"}`
).join("\n") || "No agent data"}

## Your Role
You are the user's strategic marketing advisor. You:
1. Identify revenue opportunities in the data above
2. Recommend specific actions with clear business impact
3. Analyse trends and flag risks before they become problems
4. Help prioritise where to focus for maximum ROI
5. Answer questions about their marketing performance with specific data references

Always cite specific numbers from the platform data when making recommendations.
Keep responses concise and actionable — each recommendation should have a clear next step.`;
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
    const settings = (context as any).settings ?? {};
    const apiKey = process.env.OPENAI_API_KEY ?? settings.openai_api_key;
    if (!apiKey) throw new Error("OpenAI API key not configured. Add it in Settings → Integrations.");

    const systemPrompt = compileSystemPrompt(data.platformData, data.personality);

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

    const systemPrompt = compileSystemPrompt(data.platformData, "professional");
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
