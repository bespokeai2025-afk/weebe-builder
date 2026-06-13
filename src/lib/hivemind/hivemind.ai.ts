import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ── Context builder ────────────────────────────────────────────────────────────
function buildPlatformContext(data: any): string {
  if (!data) return "No platform data available yet.";
  const { agents, agentScores, today, calls, leads, bookings, campaigns, whatsapp, systemHealth, tasks } = data;

  const lines: string[] = [];

  lines.push(`TODAY: ${today?.leads ?? 0} new leads | ${today?.bookings ?? 0} bookings | ${today?.calls ?? 0} calls | ${today?.messages ?? 0} WhatsApp msgs`);

  if (tasks) {
    lines.push(`\nHIVEMIND TASKS: ${tasks.suggested} suggested | ${tasks.approved} approved | ${tasks.inProgress} in-progress | ${tasks.completed} completed`);
    if (tasks.suggested > 0) lines.push(`  ⚠ ${tasks.suggested} task${tasks.suggested !== 1 ? "s" : ""} waiting for approval — check /hivemind/tasks`);
  }

  lines.push(`\nAGENTS (${agents?.length ?? 0} total):`);
  for (const a of (agentScores ?? []).slice(0, 8)) {
    const st = a.deployed ? "deployed" : "NOT DEPLOYED";
    const ph = a.hasPhone ? "has phone" : "no phone";
    lines.push(`  • "${a.name}": ${st}, ${a.callCount} calls (30d), ${a.successRate}% success, ${ph}`);
  }

  lines.push(`\nLEADS: ${leads?.total ?? 0} total | ${leads?.active ?? 0} active | ${leads?.needCall ?? 0} need call | ${leads?.sales ?? 0} sales | ${leads?.stale ?? 0} stale (14d+)`);

  lines.push(`\nCALLS (30d): ${calls?.total ?? 0} | ${calls?.successRate ?? 0}% success | avg ${calls?.avgDuration ?? 0}s | ${calls?.inbound ?? 0} inbound | ${calls?.outbound ?? 0} outbound`);

  lines.push(`\nBOOKINGS: ${bookings?.total ?? 0} total | ${bookings?.recent ?? 0} in last 7 days`);

  const campStats = campaigns?.stats ?? [];
  lines.push(`\nCAMPAIGNS: ${campaigns?.total ?? 0} total | ${campaigns?.active ?? 0} running | ${campaigns?.stopped ?? 0} paused`);
  for (const c of campStats.slice(0, 6)) {
    lines.push(`  • "${c.name}": ${c.status}, ${c.completionPct}% done (${c.completedCalls}/${c.totalLeads} leads)`);
  }

  lines.push(`\nWHATSAPP: ${whatsapp?.inbound ?? 0} inbound | ${whatsapp?.outbound ?? 0} outbound (30d) | ${whatsapp?.contacts ?? 0} contacts`);

  const health = systemHealth ?? {};
  const healthStr = Object.entries(health)
    .map(([k, v]) => `${k}:${v ? "✓" : "✗"}`)
    .join("  ");
  lines.push(`\nSYSTEM: ${healthStr}`);

  return lines.join("\n");
}

function buildSystemPrompt(context: string, personality = "professional"): string {
  const styles: Record<string, string> = {
    professional: "Respond in a formal, structured executive style. Use bullet points for multi-item answers. Be precise and data-driven.",
    friendly: "Respond conversationally and warmly. Use plain language. Be encouraging and direct.",
    concise: "3 sentences maximum. Critical numbers only. No preamble or fluff.",
  };
  const style = styles[personality] ?? styles.professional;

  return `You are HiveMind, the executive AI assistant built into the Webee voice AI platform. You have full visibility into all platform data: agents, leads, calls, bookings, campaigns, WhatsApp, and system health.

${style}

Answer from the platform data provided below. Reference specific names and numbers. If something is not in the data, say so — never fabricate metrics.

When recommending actions, be specific: name the agent, campaign, or lead status that needs attention.

--- LIVE PLATFORM DATA ---
${context}
--- END DATA ---

Current time: ${new Date().toLocaleString()}`;
}

// ── Morning briefing builder ────────────────────────────────────────────────────
function buildMorningBriefing(data: any): string {
  if (!data) return "Good morning. I'm scanning your platform now — please ask me anything.";

  const { today, leads, calls, campaigns, agentScores, systemHealth } = data;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const lines: string[] = [`${greeting}. Here's your platform snapshot:\n`];

  // Leads
  if ((today?.leads ?? 0) > 0) {
    lines.push(`• **${today.leads} new lead${today.leads !== 1 ? "s" : ""}** arrived in the last 24 hours`);
  } else {
    lines.push(`• No new leads in the last 24 hours`);
  }

  // Bookings
  if ((today?.bookings ?? 0) > 0) {
    lines.push(`• **${today.bookings} booking${today.bookings !== 1 ? "s" : ""}** confirmed today`);
  }

  // Calls
  if ((today?.calls ?? 0) > 0) {
    lines.push(`• **${today.calls} call${today.calls !== 1 ? "s" : ""}** made today — ${calls?.successRate ?? 0}% success rate (30d avg)`);
  }

  // Agents needing attention
  const offlineAgents = (agentScores ?? []).filter((a: any) => !a.deployed);
  if (offlineAgents.length > 0) {
    const names = offlineAgents.slice(0, 2).map((a: any) => `"${a.name}"`).join(", ");
    lines.push(`• **${offlineAgents.length} agent${offlineAgents.length !== 1 ? "s" : ""} not deployed** — ${names}${offlineAgents.length > 2 ? ` +${offlineAgents.length - 2} more` : ""}`);
  }

  // Campaigns
  const stalledCampaigns = (campaigns?.stats ?? []).filter((c: any) => c.completionPct === 0 && c.status === "running");
  if (stalledCampaigns.length > 0) {
    lines.push(`• **${stalledCampaigns.length} campaign${stalledCampaigns.length !== 1 ? "s" : ""} stalled** at 0% — "${stalledCampaigns[0].name}"${stalledCampaigns.length > 1 ? ` +${stalledCampaigns.length - 1} more` : ""}`);
  }

  // Stale leads
  if ((leads?.stale ?? 0) > 5) {
    lines.push(`• **${leads.stale} leads** have had no activity in 14+ days`);
  }

  // System issues
  const missing = Object.entries(systemHealth ?? {}).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length > 0) {
    lines.push(`• **System**: ${missing.join(", ")} not connected`);
  }

  if (lines.length === 1) {
    lines.push("• Everything looks healthy — no immediate issues detected");
  }

  lines.push("\nWhat would you like to know more about?");
  return lines.join("\n");
}

// ── API helpers ────────────────────────────────────────────────────────────────
async function getOpenAIKey(sb: any, workspaceId: string): Promise<string> {
  const envKey = process.env.OPENAI_API_KEY;
  if (envKey) return envKey;
  const { data } = await sb.from("workspace_settings")
    .select("openai_api_key").eq("workspace_id", workspaceId).maybeSingle();
  const key = data?.openai_api_key as string | undefined;
  if (!key) throw new Error("OpenAI API key not configured. Add it in Settings → Integrations.");
  return key;
}

async function getElevenLabsKey(sb: any, workspaceId: string): Promise<string> {
  const envKey = process.env.ELEVENLABS_API_KEY;
  if (envKey) return envKey;
  const { data } = await sb.from("workspace_settings")
    .select("elevenlabs_api_key").eq("workspace_id", workspaceId).maybeSingle();
  const key = data?.elevenlabs_api_key as string | undefined;
  if (!key) throw new Error("ElevenLabs API key not configured. Add it in Settings → Integrations.");
  return key;
}

// ── Server functions ───────────────────────────────────────────────────────────

export const getHiveMindAIResponse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      query:       z.string().min(1).max(2000),
      history:     z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).optional(),
      personality: z.string().optional(),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    // Fetch platform data, task counts + OpenAI key in parallel
    const [platformRes, taskCounts, apiKey] = await Promise.all([
      (async () => {
        const now = new Date();
        const s30 = new Date(now); s30.setDate(now.getDate() - 30);
        const s7  = new Date(now); s7.setDate(now.getDate() - 7);
        const s14 = new Date(now); s14.setDate(now.getDate() - 14);
        const todayStart = new Date(now); todayStart.setHours(0,0,0,0);
        const [ag, ca, le, bo, cp, wa, se] = await Promise.all([
          sb.from("agents").select("id,name,retell_agent_id,inbound_phone_number,settings").eq("workspace_id", workspaceId),
          sb.from("calls").select("id,agent_id,call_successful,duration_seconds,call_type,started_at").eq("workspace_id", workspaceId).gte("started_at", s30.toISOString()).limit(500),
          sb.from("leads").select("id,status,pipeline_stage,updated_at,created_at").eq("workspace_id", workspaceId).limit(2000),
          sb.from("calendar_bookings").select("id,status,created_at,title").eq("workspace_id", workspaceId).limit(200),
          sb.from("call_campaigns").select("id,name,status,total_leads,completed_calls").eq("workspace_id", workspaceId).limit(50),
          sb.from("whatsapp_messages").select("id,direction,created_at").eq("workspace_id", workspaceId).gte("created_at", s30.toISOString()).limit(500),
          sb.from("workspace_settings").select("retell_workspace_id,calcom_api_key,elevenlabs_api_key,openai_api_key,whatsapp_phone_id,twilio_auth_token").eq("workspace_id", workspaceId).maybeSingle(),
        ]);
        const agents = ag.data ?? [];
        const calls  = ca.data ?? [];
        const leads  = le.data ?? [];
        const bks    = bo.data ?? [];
        const camps  = cp.data ?? [];
        const msgs   = wa.data ?? [];
        const cfg    = se.data ?? {};
        const todayStr = todayStart.toISOString();
        const s14Str   = s14.toISOString();
        const s7Str    = s7.toISOString();
        const total = calls.length;
        const succ  = calls.filter((c:any) => c.call_successful).length;
        const durC  = calls.filter((c:any) => c.duration_seconds > 0);
        const avgD  = durC.length ? Math.round(durC.reduce((s:number,c:any)=>s+c.duration_seconds,0)/durC.length) : 0;
        const campStats = camps.map((c:any) => ({
          name: c.name, status: c.status,
          totalLeads: c.total_leads ?? 0, completedCalls: c.completed_calls ?? 0,
          completionPct: c.total_leads > 0 ? Math.round((c.completed_calls/c.total_leads)*100) : 0,
        }));
        const phoneByAgent = new Map<string,any>();
        // agentScores
        const agentScores = agents.map((a:any) => {
          const s = a.settings ?? {};
          const deployed = !!(s.deployedRetellAgentId || a.retell_agent_id);
          const hasPhone = !!(s.phoneNumber || a.inbound_phone_number);
          const agentCalls = calls.filter((c:any) => c.agent_id === a.id);
          const succ2 = agentCalls.filter((c:any) => c.call_successful).length;
          return { name: a.name, deployed, hasPhone, callCount: agentCalls.length, successRate: agentCalls.length ? Math.round((succ2/agentCalls.length)*100) : 0 };
        });
        return {
          agents, agentScores,
          today: { leads: leads.filter((l:any)=>l.created_at>=todayStr).length, bookings: bks.filter((b:any)=>b.created_at>=todayStr).length, calls: calls.filter((c:any)=>c.started_at>=todayStr).length, messages: msgs.filter((m:any)=>m.created_at>=todayStr).length },
          calls: { total, success: succ, successRate: total>0?Math.round((succ/total)*100):0, avgDuration: avgD, inbound: calls.filter((c:any)=>c.call_type==="inbound").length, outbound: calls.filter((c:any)=>c.call_type!=="inbound").length },
          leads: { total: leads.length, active: leads.filter((l:any)=>!["sale_done","do_not_call","not_interested"].includes(l.status)).length, needCall: leads.filter((l:any)=>l.status==="need_to_call").length, sales: leads.filter((l:any)=>l.status==="sale_done").length, stale: leads.filter((l:any)=>!["sale_done","do_not_call","not_interested"].includes(l.status) && l.updated_at<s14Str).length },
          bookings: { total: bks.length, recent: bks.filter((b:any)=>b.created_at>=s7Str).length },
          campaigns: { total: camps.length, active: camps.filter((c:any)=>["running","active"].includes(c.status)).length, stopped: camps.filter((c:any)=>["stopped","paused"].includes(c.status)).length, stats: campStats },
          whatsapp: { inbound: msgs.filter((m:any)=>m.direction==="inbound").length, outbound: msgs.filter((m:any)=>m.direction==="outbound").length, contacts: 0 },
          systemHealth: { retell: !!(cfg.retell_workspace_id), calcom: !!cfg.calcom_api_key, elevenlabs: !!cfg.elevenlabs_api_key, openai: !!cfg.openai_api_key, whatsapp: !!cfg.whatsapp_phone_id, twilio: !!cfg.twilio_auth_token },
        };
      })(),
      (async () => {
        try {
          const { data: rows } = await sb.from("hivemind_tasks").select("status").eq("workspace_id", workspaceId);
          const t = rows ?? [];
          return {
            suggested:  t.filter((r: any) => r.status === "suggested").length,
            approved:   t.filter((r: any) => r.status === "approved").length,
            inProgress: t.filter((r: any) => r.status === "in_progress").length,
            completed:  t.filter((r: any) => r.status === "completed").length,
          };
        } catch { return null; }
      })(),
      getOpenAIKey(sb, workspaceId),
    ]);

    const context2 = buildPlatformContext({ ...platformRes, tasks: taskCounts });
    const systemPrompt = buildSystemPrompt(context2, data.personality ?? "professional");

    const messages = [
      { role: "system", content: systemPrompt },
      ...(data.history ?? []).slice(-10),
      { role: "user", content: data.query },
    ];

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: "gpt-4o-mini", messages, max_tokens: 600, temperature: 0.4 }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI error: ${err.slice(0, 200)}`);
    }
    const json = await res.json() as any;
    const response = json.choices?.[0]?.message?.content ?? "I couldn't generate a response. Please try again.";
    return { response };
  });

// ── Morning Briefing ───────────────────────────────────────────────────────────
export const getHiveMindMorningBriefing = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const now = new Date();
    const s30 = new Date(now); s30.setDate(now.getDate() - 30);
    const s14 = new Date(now); s14.setDate(now.getDate() - 14);
    const s7  = new Date(now); s7.setDate(now.getDate() - 7);
    const todayStart = new Date(now); todayStart.setHours(0,0,0,0);

    const [ag, ca, le, bo, cp, wa, se] = await Promise.all([
      sb.from("agents").select("id,name,retell_agent_id,settings").eq("workspace_id", workspaceId),
      sb.from("calls").select("id,call_successful,duration_seconds,started_at").eq("workspace_id", workspaceId).gte("started_at", s30.toISOString()).limit(500),
      sb.from("leads").select("id,status,updated_at,created_at").eq("workspace_id", workspaceId).limit(2000),
      sb.from("calendar_bookings").select("id,created_at").eq("workspace_id", workspaceId).limit(100),
      sb.from("call_campaigns").select("id,name,status,total_leads,completed_calls").eq("workspace_id", workspaceId).limit(30),
      sb.from("whatsapp_messages").select("id,direction,created_at").eq("workspace_id", workspaceId).gte("created_at", s30.toISOString()).limit(200),
      sb.from("workspace_settings").select("retell_workspace_id,calcom_api_key,elevenlabs_api_key,openai_api_key,whatsapp_phone_id").eq("workspace_id", workspaceId).maybeSingle(),
    ]);

    const agents = ag.data ?? [];
    const calls  = ca.data ?? [];
    const leads  = le.data ?? [];
    const bks    = bo.data ?? [];
    const camps  = cp.data ?? [];
    const msgs   = wa.data ?? [];
    const cfg    = se.data ?? {};
    const todayStr = todayStart.toISOString();
    const s14Str   = s14.toISOString();
    const s7Str    = s7.toISOString();

    const total = calls.length;
    const succ  = calls.filter((c:any) => c.call_successful).length;

    const campStats = camps.map((c:any) => ({
      name: c.name, status: c.status,
      totalLeads: c.total_leads ?? 0, completedCalls: c.completed_calls ?? 0,
      completionPct: c.total_leads > 0 ? Math.round((c.completed_calls/c.total_leads)*100) : 0,
    }));

    const agentScores = agents.map((a:any) => {
      const s = a.settings ?? {};
      return { name: a.name, deployed: !!(s.deployedRetellAgentId || a.retell_agent_id) };
    });

    const data2 = {
      agents, agentScores,
      today: { leads: leads.filter((l:any)=>l.created_at>=todayStr).length, bookings: bks.filter((b:any)=>b.created_at>=todayStr).length, calls: calls.filter((c:any)=>c.started_at>=todayStr).length, messages: msgs.filter((m:any)=>m.created_at>=todayStr).length },
      calls: { total, successRate: total>0?Math.round((succ/total)*100):0 },
      leads: { stale: leads.filter((l:any)=>!["sale_done","do_not_call","not_interested"].includes(l.status) && l.updated_at<s14Str).length },
      campaigns: { stats: campStats },
      systemHealth: { retell: !!cfg.retell_workspace_id, calcom: !!cfg.calcom_api_key, elevenlabs: !!cfg.elevenlabs_api_key, openai: !!cfg.openai_api_key, whatsapp: !!cfg.whatsapp_phone_id },
    };

    return { briefing: buildMorningBriefing(data2) };
  });

// ── System context for voice relay ────────────────────────────────────────────
export const getHiveMindSystemContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ personality: z.string().optional(), voiceId: z.string().optional() }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data: cfg } = await sb.from("workspace_settings")
      .select("retell_workspace_id,calcom_api_key,elevenlabs_api_key,openai_api_key,whatsapp_phone_id").eq("workspace_id", workspaceId).maybeSingle();

    const hasEL  = !!(process.env.ELEVENLABS_API_KEY || cfg?.elevenlabs_api_key);
    const hasOAI = !!(process.env.OPENAI_API_KEY || cfg?.openai_api_key);

    // Minimal context for relay (we can't do full 7-query fetch for every relay start, just use a brief context)
    const context2 = "Real-time platform data is accessible. Answer questions about leads, agents, campaigns, calls, bookings, and system health.";
    const systemPrompt = buildSystemPrompt(context2, data.personality ?? "professional");
    const hour = new Date().getHours();
    const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    const beginMessage = `${greeting}. I'm HiveMind, your platform assistant. How can I help you today?`;

    return { systemPrompt, beginMessage, hasEL, hasOAI };
  });

// ── ElevenLabs TTS ─────────────────────────────────────────────────────────────
export const getHiveMindTTS = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      text:    z.string().min(1).max(5000),
      voiceId: z.string().default("21m00Tcm4TlvDq8ikWAM"),
      speed:   z.number().min(0.5).max(2.0).default(1.0),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    let apiKey: string;
    try { apiKey = await getElevenLabsKey(sb, workspaceId); }
    catch { return { audioBase64: null, error: "ElevenLabs not configured" }; }

    try {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(data.voiceId)}`,
        {
          method: "POST",
          headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
          body: JSON.stringify({
            text: data.text,
            model_id: "eleven_turbo_v2_5",
            output_format: "mp3_44100_128",
            voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: data.speed },
          }),
        }
      );
      if (!res.ok) return { audioBase64: null, error: `TTS error ${res.status}` };
      const buf = await res.arrayBuffer();
      const b64 = Buffer.from(buf).toString("base64");
      return { audioBase64: b64, error: null };
    } catch (e: any) {
      return { audioBase64: null, error: String(e.message) };
    }
  });

// ── List ElevenLabs voices ─────────────────────────────────────────────────────
export const listHiveMindVoices = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) return { voices: [] };

    let apiKey: string;
    try { apiKey = await getElevenLabsKey(sb, workspaceId); }
    catch { return { voices: [] }; }

    try {
      const res = await fetch("https://api.elevenlabs.io/v1/voices", { headers: { "xi-api-key": apiKey } });
      if (!res.ok) return { voices: [] };
      const json = await res.json() as any;
      const voices = (json.voices ?? []).map((v: any) => ({
        id: v.voice_id as string,
        name: v.name as string,
        category: v.category as string,
        preview_url: v.preview_url as string | null,
      }));
      return { voices };
    } catch { return { voices: [] }; }
  });
