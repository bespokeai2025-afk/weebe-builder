import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createClient } from "@supabase/supabase-js";

export type UsageSummary = {
  period:           { start: string; end: string };
  voice: {
    minutesUsed:    number;
    callsMade:      number;
    costUsd:        number;
    includedMinutes: number;
  };
  whatsapp: {
    messagesSent:   number;
    messagesRecv:   number;
    costUsd:        number;
  };
  email: {
    emailsSent:     number;
    costUsd:        number;
  };
  ai: {
    llmRequests:    number;
    videosGenerated: number;
    imagesGenerated: number;
    totalCostUsd:   number;
  };
  generation: {
    videoSpendUsd:  number;
    imageSpendUsd:  number;
    llmSpendUsd:    number;
    videoCap:       number | null;
    imageCap:       number | null;
    llmCap:         number | null;
  };
  topProviders:     { provider: string; costUsd: number }[];
};

function sb() {
  return createClient(
    process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "",
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

export const getWorkspaceUsageDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<UsageSummary> => {
    const { supabase } = context;

    const { data: wsData } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", context.userId)
      .eq("role", "owner")
      .limit(1)
      .maybeSingle();

    const workspaceId = wsData?.workspace_id;
    if (!workspaceId) {
      return emptyUsageSummary();
    }

    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const periodStart = monthStart.toISOString();
    const periodEnd   = new Date().toISOString();

    const admin = sb();

    const [callsRes, usageLogRes, waRes, emailRes, videoRes, settingsRes] = await Promise.all([
      admin
        .from("calls")
        .select("duration_seconds, call_status")
        .eq("workspace_id", workspaceId)
        .gte("started_at", periodStart),
      admin
        .from("provider_usage_log")
        .select("provider_category, provider_name, cost_usd, units")
        .eq("workspace_id", workspaceId)
        .gte("created_at", periodStart),
      admin
        .from("whatsapp_messages")
        .select("direction")
        .eq("workspace_id", workspaceId)
        .gte("created_at", periodStart),
      Promise.resolve(admin
        .from("hexmail_sends")
        .select("id")
        .eq("workspace_id", workspaceId)
        .gte("created_at", periodStart)
      ).catch(() => ({ data: [] })),
      admin
        .from("growthmind_generation_logs")
        .select("generation_type, estimated_cost_usd")
        .eq("workspace_id", workspaceId)
        .gte("created_at", periodStart),
      admin
        .from("workspace_settings")
        .select("generation_limits")
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
    ]);

    const calls       = callsRes.data ?? [];
    const usageLog    = usageLogRes.data ?? [];
    const waMessages  = waRes.data ?? [];
    const genLogs     = videoRes.data ?? [];
    const genLimits   = (settingsRes.data?.generation_limits ?? {}) as Record<string, number | null>;

    const completedCalls = calls.filter(c => c.call_status === "ended" || c.call_status === "completed");
    const minutesUsed    = completedCalls.reduce((acc, c) => acc + (Number(c.duration_seconds) || 0), 0) / 60;

    const voiceCostUsd = usageLog
      .filter(r => ["voice", "telephony", "retell", "hyperstream", "voxstream"].includes(r.provider_category))
      .reduce((acc, r) => acc + (Number(r.cost_usd) || 0), 0);

    const waCostUsd = usageLog
      .filter(r => ["whatsapp", "wati", "meta", "twilio"].includes(r.provider_category))
      .reduce((acc, r) => acc + (Number(r.cost_usd) || 0), 0);

    const emailCostUsd = usageLog
      .filter(r => ["email", "resend", "hexmail"].includes(r.provider_category))
      .reduce((acc, r) => acc + (Number(r.cost_usd) || 0), 0);

    const videoSpend   = genLogs.filter(g => g.generation_type?.includes("video")).reduce((a, g) => a + (Number(g.estimated_cost_usd) || 0), 0);
    const imageSpend   = genLogs.filter(g => g.generation_type?.includes("image")).reduce((a, g) => a + (Number(g.estimated_cost_usd) || 0), 0);
    const llmSpend     = usageLog.filter(r => ["llm", "openai", "gemini", "claude", "anthropic"].includes(r.provider_category)).reduce((a, r) => a + (Number(r.cost_usd) || 0), 0);
    const totalAiUsd   = videoSpend + imageSpend + llmSpend;

    const videosGenerated = genLogs.filter(g => g.generation_type?.includes("video")).length;
    const imagesGenerated = genLogs.filter(g => g.generation_type?.includes("image")).length;
    const llmRequests     = usageLog.filter(r => ["llm", "openai", "gemini", "claude", "anthropic"].includes(r.provider_category)).length;

    const providerMap: Record<string, number> = {};
    for (const r of usageLog) {
      const key = r.provider_name ?? r.provider_category ?? "unknown";
      providerMap[key] = (providerMap[key] ?? 0) + (Number(r.cost_usd) || 0);
    }
    const topProviders = Object.entries(providerMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([provider, costUsd]) => ({ provider, costUsd: Math.round(costUsd * 100) / 100 }));

    return {
      period: { start: periodStart, end: periodEnd },
      voice: {
        minutesUsed:     Math.round(minutesUsed * 10) / 10,
        callsMade:       completedCalls.length,
        costUsd:         Math.round(voiceCostUsd * 100) / 100,
        includedMinutes: 0,
      },
      whatsapp: {
        messagesSent:    waMessages.filter(m => m.direction === "outbound").length,
        messagesRecv:    waMessages.filter(m => m.direction === "inbound").length,
        costUsd:         Math.round(waCostUsd * 100) / 100,
      },
      email: {
        emailsSent:      (emailRes.data as any[])?.length ?? 0,
        costUsd:         Math.round(emailCostUsd * 100) / 100,
      },
      ai: {
        llmRequests,
        videosGenerated,
        imagesGenerated,
        totalCostUsd:    Math.round(totalAiUsd * 100) / 100,
      },
      generation: {
        videoSpendUsd:  Math.round(videoSpend * 100) / 100,
        imageSpendUsd:  Math.round(imageSpend * 100) / 100,
        llmSpendUsd:    Math.round(llmSpend * 100) / 100,
        videoCap:       genLimits.video_monthly_usd ?? null,
        imageCap:       genLimits.image_monthly_usd ?? null,
        llmCap:         genLimits.llm_monthly_usd   ?? null,
      },
      topProviders,
    };
  });

function emptyUsageSummary(): UsageSummary {
  const now = new Date().toISOString();
  return {
    period:       { start: now, end: now },
    voice:        { minutesUsed: 0, callsMade: 0, costUsd: 0, includedMinutes: 0 },
    whatsapp:     { messagesSent: 0, messagesRecv: 0, costUsd: 0 },
    email:        { emailsSent: 0, costUsd: 0 },
    ai:           { llmRequests: 0, videosGenerated: 0, imagesGenerated: 0, totalCostUsd: 0 },
    generation:   { videoSpendUsd: 0, imageSpendUsd: 0, llmSpendUsd: 0, videoCap: null, imageCap: null, llmCap: null },
    topProviders: [],
  };
}
