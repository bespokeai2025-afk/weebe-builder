import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { EXECUTIVE_TASK_TYPES } from "@/lib/executives/executive-council";

// ── Types ───────────────────────────────────────────────────────────────────
export type TaskStatus   = "suggested" | "approved" | "in_progress" | "completed";
export type TaskPriority = "low" | "medium" | "high" | "critical";
export type EventSeverity = "info" | "warning" | "critical";

export interface HiveMindTask {
  id: string;
  workspace_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigned_to: string | null;
  due_date: string | null;
  source: string;
  trigger_type: string | null;
  entity_type: string | null;
  entity_id: string | null;
  entity_name: string | null;
  comments: Array<{ id: string; author: string; text: string; ts: string }>;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface HiveMindEvent {
  id: string;
  workspace_id: string;
  event_type: string;
  severity: EventSeverity;
  title: string;
  description: string | null;
  entity_type: string | null;
  entity_id: string | null;
  entity_name: string | null;
  task_id: string | null;
  is_read: boolean;
  created_at: string;
}

// ── Scanner ──────────────────────────────────────────────────────────────────
interface ScanFinding {
  trigger_type: string;
  entity_type:  string;
  entity_id:    string;
  entity_name:  string;
  title:        string;
  description:  string;
  priority:     TaskPriority;
  severity:     EventSeverity;
  metadata?:    Record<string, unknown>;
}

// Workspaces younger than this never get the "setup completion low" nudge —
// give new customers a few days to work through onboarding first.
const SETUP_NUDGE_MIN_AGE_DAYS = 5;

async function scanPlatform(sb: any, workspaceId: string): Promise<ScanFinding[]> {
  const results: ScanFinding[] = [];
  const now    = new Date();
  const s14    = new Date(now); s14.setDate(now.getDate() - 14);
  const s2     = new Date(now); s2.setDate(now.getDate() - 2);
  const s7     = new Date(now); s7.setDate(now.getDate() - 7);

  const [agRes, leadRes, campRes, settingsRes, docRes] = await Promise.all([
    sb.from("agents").select("id,name,retell_agent_id,settings").eq("workspace_id", workspaceId),
    sb.from("leads").select("id,status,updated_at").eq("workspace_id", workspaceId).limit(3000),
    sb.from("call_campaigns").select("id,name,status,total_leads,completed_calls,created_at").eq("workspace_id", workspaceId).limit(100),
    sb.from("workspace_settings").select("whatsapp_phone_id,elevenlabs_api_key,openai_api_key,calcom_api_key").eq("workspace_id", workspaceId).maybeSingle(),
    sb.from("contact_documents").select("id,file_name,created_at").eq("workspace_id", workspaceId).gte("created_at", s7.toISOString()).limit(50),
  ]);

  const agents = agRes.data    ?? [];
  const leads  = leadRes.data  ?? [];
  const camps  = campRes.data  ?? [];
  const cfg    = settingsRes.data ?? {};
  const docs   = docRes.data   ?? [];

  // 1. Idle leads
  const activeStatuses = ["new","in_progress","need_to_call","contacted","callback_scheduled"];
  const idleLeads = leads.filter(
    (l: any) => activeStatuses.includes(l.status) && new Date(l.updated_at) < s14
  );
  if (idleLeads.length > 0) {
    results.push({
      trigger_type: "idle_leads",
      entity_type:  "leads",
      entity_id:    "aggregate",
      entity_name:  `${idleLeads.length} leads`,
      title:        `${idleLeads.length} lead${idleLeads.length !== 1 ? "s" : ""} idle for 14+ days`,
      description:  `${idleLeads.length} active lead${idleLeads.length !== 1 ? "s" : ""} have had no activity for over 14 days. Re-engage or update their status to keep your pipeline clean.`,
      priority:     idleLeads.length > 20 ? "high" : "medium",
      severity:     idleLeads.length > 20 ? "warning" : "info",
      metadata:     { count: idleLeads.length },
    });
  }

  // 2. Agents not deployed
  for (const agent of agents) {
    const s = agent.settings ?? {};
    const deployed = !!(s.deployedRetellAgentId || agent.retell_agent_id);
    if (!deployed) {
      results.push({
        trigger_type: "agent_not_deployed",
        entity_type:  "agent",
        entity_id:    agent.id,
        entity_name:  agent.name,
        title:        `Agent "${agent.name}" is not deployed`,
        description:  `The agent "${agent.name}" has been built but not deployed. Deploy it so it can start handling calls.`,
        priority:     "high",
        severity:     "warning",
      });
    }
  }

  // 3. Stalled campaigns
  for (const c of camps) {
    const isActive = ["active","running"].includes(c.status ?? "");
    const isOld    = new Date(c.created_at) < s2;
    const total    = c.total_leads ?? 0;
    const done     = c.completed_calls ?? 0;
    if (isActive && isOld && total > 0 && done === 0) {
      results.push({
        trigger_type: "campaign_stalled",
        entity_type:  "campaign",
        entity_id:    c.id,
        entity_name:  c.name,
        title:        `Campaign "${c.name}" is stalled`,
        description:  `Campaign "${c.name}" has been active for 2+ days with ${total} leads but 0 calls completed. Check the schedule or campaign configuration.`,
        priority:     "high",
        severity:     "warning",
        metadata:     { total_leads: total, completed_calls: done },
      });
    }
  }

  // 4. Documents uploaded without any agent knowledge base
  if (docs.length > 0) {
    const agentsWithKb = agents.filter((a: any) => {
      const s = a.settings ?? {};
      return !!(s.knowledgeBases?.length || s.knowledge_base || s.knowledgeBase);
    });
    if (agentsWithKb.length === 0 && agents.length > 0) {
      results.push({
        trigger_type: "document_no_kb",
        entity_type:  "documents",
        entity_id:    "aggregate",
        entity_name:  `${docs.length} document${docs.length !== 1 ? "s" : ""}`,
        title:        `${docs.length} document${docs.length !== 1 ? "s" : ""} uploaded — no knowledge base configured`,
        description:  `${docs.length} document${docs.length !== 1 ? "s" : ""} ${docs.length === 1 ? "was" : "were"} recently uploaded but no agents have a knowledge base configured. Attach these documents to an agent's knowledge base so the AI can reference them.`,
        priority:     "medium",
        severity:     "info",
        metadata:     { files: docs.slice(0, 5).map((d: any) => d.file_name) },
      });
    }
  }

  // 5. WhatsApp not configured
  if (!cfg.whatsapp_phone_id) {
    results.push({
      trigger_type: "whatsapp_not_configured",
      entity_type:  "integration",
      entity_id:    "whatsapp",
      entity_name:  "WhatsApp",
      title:        "WhatsApp is not connected",
      description:  "Your workspace does not have a WhatsApp phone number configured. Connect WhatsApp to enable two-way messaging with leads.",
      priority:     "low",
      severity:     "info",
    });
  }

  // 6. No AI model configured
  const hasOAI = !!(process.env.OPENAI_API_KEY || cfg.openai_api_key);
  if (!hasOAI) {
    results.push({
      trigger_type: "openai_missing",
      entity_type:  "integration",
      entity_id:    "openai",
      entity_name:  "OpenAI",
      title:        "OpenAI API key not configured",
      description:  "The HiveMind AI assistant requires an OpenAI API key. Add it in Settings → Integrations to enable chat and voice.",
      priority:     "critical",
      severity:     "critical",
    });
  }

  // 7. Setup completion stays low — nudge to the SystemMind Setup Assistant.
  // Only fires once the workspace is at least SETUP_NUDGE_MIN_AGE_DAYS old, so
  // brand-new workspaces get time to work through onboarding first. This is a
  // recommendation only (suggested task) — nothing is executed automatically.
  try {
    const { data: wsRow } = await sb.from("workspaces")
      .select("created_at").eq("id", workspaceId).maybeSingle();
    const createdAt = wsRow?.created_at ? new Date(wsRow.created_at) : null;
    const ageDays = createdAt
      ? Math.floor((now.getTime() - createdAt.getTime()) / 86_400_000)
      : null;
    if (ageDays !== null && ageDays >= SETUP_NUDGE_MIN_AGE_DAYS) {
      const { getSetupChecklistServer, runChecksServer, CHECK_KEYS } = await import(
        "@/lib/systemmind/workspace-setup.server"
      );
      const cl = await getSetupChecklistServer(workspaceId);
      let hasChecklist = false;
      let doneCount = 0;
      let totalCount = 0;
      if (cl.checklist && cl.totalCount > 0) {
        hasChecklist = true;
        doneCount = cl.doneCount;
        totalCount = cl.totalCount;
      } else {
        const derived = await runChecksServer(workspaceId, CHECK_KEYS);
        doneCount = Object.values(derived).filter(Boolean).length;
        totalCount = CHECK_KEYS.length;
      }
      const percent = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 100;
      if (totalCount > 0 && percent < 50) {
        results.push(hasChecklist
          ? {
              trigger_type: "setup_completion_low",
              entity_type:  "systemmind",
              entity_id:    "setup-assistant",
              entity_name:  "Setup Assistant",
              title:        `Setup checklist only ${percent}% complete after ${ageDays} days`,
              description:  `Your personalised setup checklist is ${percent}% complete (${doneCount} of ${totalCount} steps verified). Open the SystemMind Setup Assistant to finish the remaining steps and unlock the platform's full value.`,
              priority:     "high",
              severity:     "warning",
              metadata:     { percent, doneCount, totalCount, ageDays, href: "/systemmind/setup-assistant" },
            }
          : {
              trigger_type: "setup_assistant_unused",
              entity_type:  "systemmind",
              entity_id:    "setup-assistant",
              entity_name:  "Setup Assistant",
              title:        `Workspace setup is only ${percent}% complete — no setup plan yet`,
              description:  `Only ${doneCount} of ${totalCount} setup checks pass and no personalised setup plan exists. Run the SystemMind Setup Assistant — describe your business and it drafts a tailored setup checklist for your approval (nothing runs without sign-off).`,
              priority:     "medium",
              severity:     "info",
              metadata:     { percent, doneCount, totalCount, ageDays, href: "/systemmind/setup-assistant" },
            });
      }
    }
  } catch {}

  // 8. Build Workspace test-call gate — surface SystemMind builds that are
  // applied but blocked before Go Live because the mandatory test call hasn't
  // passed yet (or failed). Recommendation only — HiveMind never runs tests.
  try {
    const { data: appliedVersions } = await sb.from("systemmind_build_versions")
      .select("id, session_id, version_number, applied_at, status")
      .eq("workspace_id", workspaceId)
      .eq("status", "applied")
      .order("created_at", { ascending: false })
      .limit(25);
    const applied = appliedVersions ?? [];
    if (applied.length > 0) {
      const [tcRes, sessRes] = await Promise.all([
        sb.from("systemmind_test_calls")
          .select("version_id, passed, diagnosis, created_at")
          .eq("workspace_id", workspaceId)
          .in("version_id", applied.map((v: any) => v.id))
          .order("created_at", { ascending: false })
          .limit(200),
        sb.from("systemmind_build_sessions")
          .select("id, title")
          .eq("workspace_id", workspaceId)
          .in("id", applied.map((v: any) => v.session_id)),
      ]);
      const latestByVersion = new Map<string, { passed: boolean; diagnosis: string | null }>();
      for (const row of tcRes.data ?? []) {
        if (!latestByVersion.has(row.version_id)) {
          latestByVersion.set(row.version_id, { passed: !!row.passed, diagnosis: row.diagnosis ?? null });
        }
      }
      const sessionTitle = new Map<string, string>((sessRes.data ?? []).map((s: any) => [s.id, s.title ?? "Untitled build"]));
      for (const v of applied) {
        const latest = latestByVersion.get(v.id);
        if (latest?.passed) continue;
        const title = sessionTitle.get(v.session_id) ?? "Untitled build";
        if (latest && !latest.passed) {
          results.push({
            trigger_type: "build_test_call_failed",
            entity_type:  "build_version",
            entity_id:    v.id,
            entity_name:  `${title} (v${v.version_number})`,
            title:        `Build "${title}" failed its test call`,
            description:  `Version ${v.version_number} of build "${title}" is applied but its latest test call FAILED, so it cannot go live. ${latest.diagnosis ? `Diagnosis: ${String(latest.diagnosis).slice(0, 300)}` : "Open the build session to review the diagnosis and ask SystemMind to fix it."}`,
            priority:     "high",
            severity:     "warning",
            metadata:     { session_id: v.session_id, version_id: v.id, version_number: v.version_number, href: "/systemmind/build" },
          });
        } else {
          results.push({
            trigger_type: "build_awaiting_test_call",
            entity_type:  "build_version",
            entity_id:    v.id,
            entity_name:  `${title} (v${v.version_number})`,
            title:        `Build "${title}" is waiting on its test call`,
            description:  `Version ${v.version_number} of build "${title}" is applied but no test call has been validated yet — a passed real test call (or a HiveMind-approved manual pass) is mandatory before it can go live. Run a test call from the build session's Test panel.`,
            priority:     "medium",
            severity:     "info",
            metadata:     { session_id: v.session_id, version_id: v.id, version_number: v.version_number, href: "/systemmind/build" },
          });
        }
      }
    }
  } catch {}

  // GrowthMind intelligence scan
  try {
    const gmFindings = await scanGrowthMind(sb, workspaceId);
    results.push(...gmFindings);
  } catch {}

  // API Engine health scan
  try {
    const { scanApiEngine } = await import("@/lib/api-engine/api-engine-scanner.server");
    const engineRecs = await scanApiEngine(workspaceId);
    for (const rec of engineRecs) {
      results.push({
        trigger_type: rec.id,
        entity_type:  "api_engine",
        entity_id:    rec.id,
        entity_name:  "API Engine",
        title:        rec.problem,
        description:  `${rec.impact} ${rec.fix}`,
        priority:     (rec.priority === "critical" ? "critical"
                    : rec.priority === "high"     ? "high"
                    : rec.priority === "medium"   ? "medium"
                    : "low") as TaskPriority,
        severity:     (rec.priority === "critical" ? "critical"
                    : rec.priority === "high"     ? "warning"
                    : "info") as EventSeverity,
        metadata:     { category: rec.category, action: rec.action },
      });
    }
  } catch {}

  return results;
}

// ── GrowthMind intelligence scanner ──────────────────────────────────────────
async function scanGrowthMind(sb: any, workspaceId: string): Promise<ScanFinding[]> {
  const results: ScanFinding[] = [];
  const now   = new Date();
  const s14   = new Date(now); s14.setDate(now.getDate() - 14);
  const s28   = new Date(now); s28.setDate(now.getDate() - 28);

  const [seoRes, adsRes, funnelRes, compRes, playbookRes, leadsRecentRes, leadsPreRes, failedVideoRes] = await Promise.all([
    sb.from("growthmind_seo_sites")
      .select("id, keywords")
      .eq("workspace_id", workspaceId)
      .limit(1)
      .maybeSingle(),
    sb.from("growthmind_campaigns")
      .select("id, name, spend, roas")
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .limit(50),
    sb.from("growthmind_funnels")
      .select("id, stages")
      .eq("workspace_id", workspaceId)
      .order("snapshot_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb.from("growthmind_competitors")
      .select("id")
      .eq("workspace_id", workspaceId)
      .limit(1),
    sb.from("growthmind_playbooks")
      .select("id, industry")
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle(),
    sb.from("leads")
      .select("id")
      .eq("workspace_id", workspaceId)
      .gte("created_at", s14.toISOString())
      .limit(2000),
    sb.from("leads")
      .select("id")
      .eq("workspace_id", workspaceId)
      .gte("created_at", s28.toISOString())
      .lt("created_at", s14.toISOString())
      .limit(2000),
    sb.from("growthmind_video_assets")
      .select("id, title")
      .eq("workspace_id", workspaceId)
      .like("video_url", "[error:%")
      .limit(20)
      .catch(() => ({ data: null })),
  ]);

  // 1. SEO health
  const seoSite = seoRes.data;
  const keywords = (seoSite?.keywords ?? []) as any[];
  if (!seoSite) {
    results.push({
      trigger_type: "gm_no_seo_site",
      entity_type:  "growthmind",
      entity_id:    "seo",
      entity_name:  "SEO",
      title:        "No SEO site configured in GrowthMind",
      description:  "Add your website to GrowthMind SEO to start tracking keyword rankings and generating AI-powered content ideas.",
      priority:     "medium",
      severity:     "info",
      metadata:     { executive_task_type: EXECUTIVE_TASK_TYPES.SEO_CAMPAIGN },
    });
  } else if (keywords.length === 0) {
    results.push({
      trigger_type: "gm_no_seo_keywords",
      entity_type:  "growthmind",
      entity_id:    "seo",
      entity_name:  "SEO Keywords",
      title:        "No keywords tracked in GrowthMind SEO",
      description:  "Your SEO site is connected but no keywords are being tracked. Add keywords to monitor rankings and uncover content opportunities.",
      priority:     "medium",
      severity:     "info",
      metadata:     { executive_task_type: EXECUTIVE_TASK_TYPES.SEO_CAMPAIGN },
    });
  }

  // 1b. Live Google Ads (GrowthMind) — surface material pending recommendations
  // and a connection that needs attention as executive findings.
  try {
    const [gadsRecsRes, gadsAcctRes] = await Promise.all([
      sb.from("growthmind_gads_recommendations")
        .select("id, title, priority, section, campaign_name, recommended_action, expected_benefit, status")
        .eq("workspace_id", workspaceId)
        .eq("status", "new")
        .in("priority", ["critical", "high"])
        .order("created_at", { ascending: false })
        .limit(5),
      sb.from("growthmind_ads_accounts")
        .select("id, label, connection_state, sync_status, sync_error")
        .eq("workspace_id", workspaceId)
        .eq("platform", "google")
        .eq("status", "active")
        .limit(1)
        .maybeSingle(),
    ]);
    for (const rec of gadsRecsRes.data ?? []) {
      results.push({
        trigger_type: "gads_recommendation",
        entity_type:  "growthmind_gads",
        entity_id:    rec.id,
        entity_name:  rec.campaign_name ?? "Google Ads account",
        title:        rec.title,
        description:  `${rec.recommended_action}${rec.expected_benefit ? ` Expected benefit: ${rec.expected_benefit}.` : ""} Review and approve it in GrowthMind → Ads — no campaign change happens without your approval.`,
        priority:     (rec.priority === "critical" ? "critical" : "high") as TaskPriority,
        severity:     (rec.priority === "critical" ? "critical" : "warning") as EventSeverity,
        metadata:     { section: rec.section, recommendation_id: rec.id, href: "/growthmind/ads" },
      });
    }
    const gadsAcct = gadsAcctRes.data;
    if (gadsAcct && (gadsAcct.sync_status === "error" || gadsAcct.connection_state === "oauth_connected" || gadsAcct.connection_state === "api_verified")) {
      const needsSelection = gadsAcct.connection_state !== "sync_healthy" && gadsAcct.sync_status !== "error";
      results.push({
        trigger_type: "gads_connection_attention",
        entity_type:  "growthmind_gads",
        entity_id:    gadsAcct.id,
        entity_name:  gadsAcct.label ?? "Google Ads",
        title:        needsSelection ? "Google Ads setup is incomplete" : "Google Ads sync needs attention",
        description:  needsSelection
          ? "Google is connected but no advertising account is selected yet — open GrowthMind → Ads and choose the client account so live campaign data can sync."
          : `The Google Ads sync is failing${gadsAcct.sync_error ? `: ${String(gadsAcct.sync_error).slice(0, 160)}` : ""}. Open GrowthMind → Ads to reconnect or re-sync.`,
        priority:     "high",
        severity:     "warning",
        metadata:     { connection_state: gadsAcct.connection_state, sync_status: gadsAcct.sync_status, href: "/growthmind/ads" },
      });
    }
  } catch { /* live gads tables optional */ }

  // 2. Ads poor ROAS
  const activeCampaigns = adsRes.data ?? [];
  const poorRoas = activeCampaigns.filter(
    (c: any) => Number(c.roas ?? 0) > 0 && Number(c.roas) < 1.5 && Number(c.spend ?? 0) > 50
  );
  if (poorRoas.length > 0) {
    const worst = poorRoas[0];
    results.push({
      trigger_type: "gm_ads_low_roas",
      entity_type:  "growthmind",
      entity_id:    worst.id,
      entity_name:  worst.name,
      title:        `"${worst.name}" has a ROAS below 1.5×`,
      description:  `Campaign "${worst.name}" is returning less than £1.50 per £1.00 spent (ROAS ${Number(worst.roas).toFixed(2)}×). Review targeting and ad creative to improve return on ad spend.`,
      priority:     "high",
      severity:     "warning",
      metadata:     { roas: worst.roas, spend: worst.spend },
    });
  }

  // 3. Funnel high drop-off
  const funnelSnap = funnelRes.data;
  if (funnelSnap) {
    const stages: Array<{ label: string; dropPct: number | null }> = funnelSnap.stages ?? [];
    const highDrop = [...stages]
      .filter(s => (s.dropPct ?? 0) > 65)
      .sort((a, b) => (b.dropPct ?? 0) - (a.dropPct ?? 0))[0];
    if (highDrop) {
      results.push({
        trigger_type: "gm_funnel_high_drop",
        entity_type:  "growthmind",
        entity_id:    funnelSnap.id,
        entity_name:  highDrop.label,
        title:        `High funnel drop-off at "${highDrop.label}" stage`,
        description:  `${highDrop.dropPct}% of prospects drop off at the "${highDrop.label}" stage — above the 65% alert threshold. This is your biggest conversion bottleneck; address it to unlock pipeline growth.`,
        priority:     "high",
        severity:     "warning",
        metadata:     { stage: highDrop.label, dropPct: highDrop.dropPct, executive_task_type: EXECUTIVE_TASK_TYPES.LEAD_NURTURE },
      });
    }
  }

  // 4. No competitors tracked
  const compCount = (compRes.data ?? []).length;
  if (compCount === 0) {
    results.push({
      trigger_type: "gm_no_competitors",
      entity_type:  "growthmind",
      entity_id:    "competitors",
      entity_name:  "Competitor Intelligence",
      title:        "No competitors tracked in GrowthMind",
      description:  "Add your main competitors to GrowthMind to track positioning, offers, and emerging threats — then use AI analysis to find your edge.",
      priority:     "low",
      severity:     "info",
      metadata:     { executive_task_type: EXECUTIVE_TASK_TYPES.COMPETITOR_REVIEW },
    });
  }

  // 5. No active playbook
  const playbook = playbookRes.data;
  if (!playbook) {
    results.push({
      trigger_type: "gm_no_playbook",
      entity_type:  "growthmind",
      entity_id:    "playbooks",
      entity_name:  "Playbooks",
      title:        "No marketing playbook activated",
      description:  "Activate an industry-specific playbook in GrowthMind to get structured calling, email, and WhatsApp tactics proven for your sector.",
      priority:     "medium",
      severity:     "info",
    });
  }

  // 6. Declining lead volume
  const recentLeads = (leadsRecentRes.data ?? []).length;
  const prevLeads   = (leadsPreRes.data ?? []).length;
  if (prevLeads > 10 && recentLeads < prevLeads * 0.7) {
    const dropPct = Math.round(((prevLeads - recentLeads) / prevLeads) * 100);
    results.push({
      trigger_type: "gm_leads_declining",
      entity_type:  "growthmind",
      entity_id:    "forecast",
      entity_name:  "Lead Volume",
      title:        `Lead volume down ${dropPct}% in the last 14 days`,
      description:  `You received ${recentLeads} leads in the past 14 days vs ${prevLeads} in the preceding period — a ${dropPct}% decline. Review your top-of-funnel channels in GrowthMind Forecast.`,
      priority:     dropPct > 40 ? "high" : "medium",
      severity:     dropPct > 40 ? "warning" : "info",
      metadata:     { recentLeads, prevLeads, dropPct, executive_task_type: EXECUTIVE_TASK_TYPES.LEAD_NURTURE },
    });
  }

  // ── Content Calendar + Growth Scheduler findings ──────────────────────────
  const next7   = new Date(now); next7.setDate(now.getDate() + 7);
  const [calRes, overdueTasksRes, activePlansRes, bookingsRes] = await Promise.all([
    sb.from("growthmind_content_calendar")
      .select("id, title, content_type, status, scheduled_date")
      .eq("workspace_id", workspaceId)
      .gte("scheduled_date", now.toISOString())
      .lte("scheduled_date", next7.toISOString())
      .order("scheduled_date", { ascending: true })
      .limit(50),
    sb.from("growthmind_marketing_tasks")
      .select("id, title, due_date, priority")
      .eq("workspace_id", workspaceId)
      .eq("status", "pending")
      .lt("due_date", now.toISOString().split("T")[0])
      .order("due_date", { ascending: true })
      .limit(20),
    sb.from("growthmind_growth_plans")
      .select("id, name, plan_type, generated_at")
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .limit(5),
    sb.from("calendar_bookings")
      .select("id")
      .eq("workspace_id", workspaceId)
      .limit(500),
  ]);

  // 7. Upcoming content this week
  const upcomingContent = calRes.data ?? [];
  if (upcomingContent.length === 0) {
    results.push({
      trigger_type: "gm_no_content_this_week",
      entity_type:  "growthmind",
      entity_id:    "content-calendar",
      entity_name:  "Content Calendar",
      title:        "No content scheduled for the next 7 days",
      description:  "Your Content Calendar has no pieces scheduled for the next 7 days. A consistent publishing cadence is key to SEO and lead generation — add content now.",
      priority:     "medium",
      severity:     "warning",
      metadata:     { executive_task_type: EXECUTIVE_TASK_TYPES.CONTENT_PLAN },
    });
  } else {
    const publishedCount  = upcomingContent.filter((e: any) => e.status === "Published").length;
    const scheduledCount  = upcomingContent.filter((e: any) => e.status === "Scheduled").length;
    const draftCount      = upcomingContent.filter((e: any) => e.status === "Draft").length;
    if (draftCount > 0) {
      results.push({
        trigger_type: "gm_content_drafts_pending",
        entity_type:  "growthmind",
        entity_id:    "content-calendar",
        entity_name:  "Content Calendar",
        title:        `${draftCount} content piece${draftCount > 1 ? "s" : ""} still in Draft this week`,
        description:  `You have ${draftCount} draft item${draftCount > 1 ? "s" : ""} scheduled for the next 7 days that haven't been moved to Scheduled or Published. Review and progress them to avoid missed publishing windows.`,
        priority:     draftCount >= 3 ? "high" : "medium",
        severity:     "info",
        metadata:     { draftCount, scheduledCount, publishedCount, executive_task_type: EXECUTIVE_TASK_TYPES.CONTENT_PLAN },
      });
    }
  }

  // 8. Overdue marketing tasks
  const overdueTasks = overdueTasksRes.data ?? [];
  if (overdueTasks.length > 0) {
    const urgentOverdue  = overdueTasks.filter((t: any) => t.priority === "urgent" || t.priority === "high");
    const oldest         = overdueTasks[0];
    results.push({
      trigger_type: "gm_overdue_tasks",
      entity_type:  "growthmind",
      entity_id:    oldest.id,
      entity_name:  "Marketing Tasks",
      title:        `${overdueTasks.length} marketing task${overdueTasks.length > 1 ? "s" : ""} overdue`,
      description:  `${overdueTasks.length} marketing task${overdueTasks.length > 1 ? "s are" : " is"} past their due date${urgentOverdue.length > 0 ? `, including ${urgentOverdue.length} high-priority item${urgentOverdue.length > 1 ? "s" : ""}` : ""}. Overdue tasks slow your content pipeline and delay campaign launches.`,
      priority:     urgentOverdue.length > 0 ? "high" : "medium",
      severity:     urgentOverdue.length > 0 ? "warning" : "info",
      metadata:     { total: overdueTasks.length, highPriority: urgentOverdue.length },
    });
  }

  // 9. No active growth plan
  const activePlans = activePlansRes.data ?? [];
  if (activePlans.length === 0) {
    results.push({
      trigger_type: "gm_no_growth_plan",
      entity_type:  "growthmind",
      entity_id:    "growth-scheduler",
      entity_name:  "Growth Scheduler",
      title:        "No active growth plan in GrowthMind",
      description:  "Create a 30/60/90-day growth plan in the Growth Scheduler to auto-generate a full content calendar and marketing task list tailored to your industry and goals.",
      priority:     "low",
      severity:     "info",
    });
  } else {
    // Check if plan hasn't been generated
    const notGenerated = activePlans.filter((p: any) => !p.generated_at);
    if (notGenerated.length > 0) {
      results.push({
        trigger_type: "gm_plan_not_generated",
        entity_type:  "growthmind",
        entity_id:    notGenerated[0].id,
        entity_name:  notGenerated[0].name,
        title:        `Growth plan "${notGenerated[0].name}" hasn't been generated yet`,
        description:  "You have an active growth plan that hasn't been generated. Click Generate in the Growth Scheduler to auto-create your content calendar and marketing tasks.",
        priority:     "medium",
        severity:     "info",
      });
    }
  }

  // 10a. Campaign drafts without image creative assets
  const [draftImgRes, imgAssetRes] = await Promise.all([
    Promise.resolve(sb.from("growthmind_campaign_drafts")
      .select("id, name, campaign_type")
      .eq("workspace_id", workspaceId)
      .in("status", ["approved", "ready", "draft"])
      .limit(20)).catch(() => ({ data: [] })),
    Promise.resolve(sb.from("growthmind_image_assets")
      .select("campaign_id")
      .eq("workspace_id", workspaceId)
      .eq("status", "ready")
      .not("campaign_id", "is", null)
      .limit(100)).catch(() => ({ data: [] })),
  ]);
  const draftsWithImages = new Set(
    ((imgAssetRes as any).data ?? []).map((r: any) => r.campaign_id)
  );
  const draftsNeedingImages = ((draftImgRes as any).data ?? []).filter(
    (d: any) => !draftsWithImages.has(d.id)
  );
  if (draftsNeedingImages.length > 0) {
    const first = draftsNeedingImages[0];
    results.push({
      trigger_type: "gm_campaign_no_image",
      entity_type:  "growthmind",
      entity_id:    first.id,
      entity_name:  first.name,
      title:        `${draftsNeedingImages.length} campaign${draftsNeedingImages.length > 1 ? "s" : ""} missing image creatives`,
      description:  `${draftsNeedingImages.length} campaign draft${draftsNeedingImages.length > 1 ? "s have" : " has"} no image creative attached. Strong ad creative is one of the biggest levers on ROAS — generate images in Image Studio and attach them to your campaigns.`,
      priority:     draftsNeedingImages.length >= 3 ? "high" : "medium",
      severity:     "warning",
      metadata:     { count: draftsNeedingImages.length, firstCampaignId: first.id },
    });
  }

  // 10. Failed video jobs — need attention
  const failedVideos = (failedVideoRes?.data ?? []) as Array<{ id: string; title: string }>;
  if (failedVideos.length > 0) {
    results.push({
      trigger_type: "gm_video_jobs_failed",
      entity_type:  "growthmind",
      entity_id:    failedVideos[0].id,
      entity_name:  "Video Studio",
      title:        `${failedVideos.length} video job${failedVideos.length > 1 ? "s" : ""} failed in Video Studio`,
      description:  `${failedVideos.length} video generation job${failedVideos.length > 1 ? "s have" : " has"} failed. Go to GrowthMind Video Studio, open the affected asset${failedVideos.length > 1 ? "s" : ""}, and click "Retry" to regenerate. Check your provider credentials if failures persist.`,
      priority:     failedVideos.length >= 3 ? "high" : "medium",
      severity:     failedVideos.length >= 3 ? "warning" : "info",
      metadata:     { failedCount: failedVideos.length, failedIds: failedVideos.map(v => v.id) },
    });
  }

  // 11. Referral engine opportunity — happy customers but no referral campaign.
  // Only escalate when there is no active campaign that looks like a referral push,
  // so we don't nag when one is already running.
  const bookingCount = (bookingsRes.data ?? []).length;
  const hasReferralCampaign = activeCampaigns.some((c: any) => /referr/i.test(String(c.name ?? "")));
  if (bookingCount >= 3 && !hasReferralCampaign) {
    results.push({
      trigger_type: "gm_no_referral",
      entity_type:  "growthmind",
      entity_id:    "referrals",
      entity_name:  "Referral Engine",
      title:        `${bookingCount} booked customer${bookingCount > 1 ? "s" : ""} — no referral campaign running`,
      description:  `You have ${bookingCount} booked customer${bookingCount > 1 ? "s" : ""} but no referral campaign in motion. Referrals are your cheapest, highest-trust lead source — launch a referral ask to turn happy customers into new pipeline.`,
      priority:     "medium",
      severity:     "info",
      metadata:     { bookingCount, executive_task_type: EXECUTIVE_TASK_TYPES.REFERRAL_CAMPAIGN },
    });
  }

  return results;
}

// ── runHiveMindScan ───────────────────────────────────────────────────────────
export const runHiveMindScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    // Observe mode: HiveMind watches only — scanner must not create tasks/events.
    const { isProposalAllowed } = await import("@/lib/hivemind/mode-gate.server");
    if (!(await isProposalAllowed(sb, workspaceId))) {
      return { newTasks: 0, newEvents: 0, findings: 0, blocked: "observe" as const };
    }

    const findings = await scanPlatform(sb, workspaceId);

    const oneDayAgo = new Date(); oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    const [existingRes, recentEvRes] = await Promise.all([
      sb.from("hivemind_tasks")
        .select("trigger_type,entity_id")
        .eq("workspace_id", workspaceId)
        .neq("status", "completed"),
      sb.from("hivemind_events")
        .select("event_type,entity_id")
        .eq("workspace_id", workspaceId)
        .gte("created_at", oneDayAgo.toISOString()),
    ]);

    const existing = existingRes.data ?? [];
    const recent   = recentEvRes.data ?? [];

    const newTasks:  any[] = [];
    const newEvents: any[] = [];

    for (const f of findings) {
      const hasTask = existing.some(
        (t: any) => t.trigger_type === f.trigger_type && t.entity_id === f.entity_id
      );
      if (!hasTask) {
        newTasks.push({
          workspace_id: workspaceId,
          title:        f.title,
          description:  f.description,
          status:       "suggested",
          priority:     f.priority,
          source:       "ai_scan",
          trigger_type: f.trigger_type,
          entity_type:  f.entity_type,
          entity_id:    f.entity_id,
          entity_name:  f.entity_name,
          metadata:     f.metadata ?? null,
        });
      }

      const hasEvent = recent.some(
        (e: any) => e.event_type === f.trigger_type && e.entity_id === f.entity_id
      );
      if (!hasEvent) {
        newEvents.push({
          workspace_id: workspaceId,
          event_type:   f.trigger_type,
          severity:     f.severity,
          title:        f.title,
          description:  f.description,
          entity_type:  f.entity_type,
          entity_id:    f.entity_id,
          entity_name:  f.entity_name,
        });
      }
    }

    if (newTasks.length > 0)  await sb.from("hivemind_tasks").insert(newTasks);
    if (newEvents.length > 0) await sb.from("hivemind_events").insert(newEvents);

    return {
      newTasks:  newTasks.length,
      newEvents: newEvents.length,
      total:     findings.length,
    };
  });

// ── getHiveMindTasksAndEvents ─────────────────────────────────────────────────
export const getHiveMindTasksAndEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    // Assigned-record visibility: restricted roles only see follow-up tasks
    // assigned to them (assigned_to may hold a user id or an email).
    const { resolvePermissions } = await import("@/lib/permissions/permissions.server");
    const perms = await resolvePermissions(workspaceId, context.userId);
    const assignedOnly = perms.assignedRecordsOnly === true;
    let myEmail: string | null = null;
    if (assignedOnly && context.userId) {
      const { data: prof } = await sb
        .from("profiles").select("email").eq("user_id", context.userId).maybeSingle();
      myEmail = prof?.email ?? null;
    }

    let tasksQuery = sb.from("hivemind_tasks")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (assignedOnly) {
      const keys = [context.userId, myEmail].filter(Boolean) as string[];
      tasksQuery = tasksQuery.in("assigned_to", keys.length ? keys : ["__none__"]);
    }

    const [tasksRes, eventsRes] = await Promise.all([
      tasksQuery,
      sb.from("hivemind_events")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    const tasks  = (tasksRes.data  ?? []) as HiveMindTask[];
    const events = (eventsRes.data ?? []) as HiveMindEvent[];
    const unread    = events.filter(e => !e.is_read).length;
    const suggested = tasks.filter(t => t.status === "suggested").length;

    return { tasks, events, unread, badge: unread + suggested };
  });

// ── updateHiveMindTask ────────────────────────────────────────────────────────
export const updateHiveMindTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      id:          z.string().uuid(),
      status:      z.enum(["suggested","approved","in_progress","completed"]).optional(),
      priority:    z.enum(["low","medium","high","critical"]).optional(),
      assigned_to: z.string().max(200).optional().nullable(),
      due_date:    z.string().optional().nullable(),
      title:       z.string().min(1).max(300).optional(),
      description: z.string().max(2000).optional().nullable(),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const { id, ...updates } = data;
    const { error } = await sb.from("hivemind_tasks")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("workspace_id", context.workspaceId);
    if (error) throw error;
    return { ok: true };
  });

// ── createHiveMindTask ────────────────────────────────────────────────────────
export const createHiveMindTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      title:       z.string().min(1).max(300),
      description: z.string().max(2000).optional(),
      priority:    z.enum(["low","medium","high","critical"]).default("medium"),
      assigned_to: z.string().max(200).optional(),
      due_date:    z.string().optional(),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const { assertProposalAllowed } = await import("@/lib/hivemind/mode-gate.server");
    await assertProposalAllowed(sb, context.workspaceId!);
    const { data: row, error } = await sb.from("hivemind_tasks")
      .insert({ workspace_id: context.workspaceId, ...data, status: "suggested", source: "manual" })
      .select()
      .single();
    if (error) throw error;
    return { task: row as HiveMindTask };
  });

// ── addHiveMindTaskComment ────────────────────────────────────────────────────
export const addHiveMindTaskComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({
      taskId: z.string().uuid(),
      author: z.string().min(1).max(100),
      text:   z.string().min(1).max(2000),
    }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const { data: task, error: fe } = await sb.from("hivemind_tasks")
      .select("comments")
      .eq("id", data.taskId)
      .eq("workspace_id", context.workspaceId)
      .single();
    if (fe) throw fe;
    const comments = [
      ...((task.comments as any[]) ?? []),
      { id: Math.random().toString(36).slice(2), author: data.author, text: data.text, ts: new Date().toISOString() },
    ];
    const { error } = await sb.from("hivemind_tasks")
      .update({ comments, updated_at: new Date().toISOString() })
      .eq("id", data.taskId)
      .eq("workspace_id", context.workspaceId);
    if (error) throw error;
    return { ok: true };
  });

// ── deleteHiveMindTask ────────────────────────────────────────────────────────
export const deleteHiveMindTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const { error } = await sb.from("hivemind_tasks")
      .delete()
      .eq("id", data.id)
      .eq("workspace_id", context.workspaceId);
    if (error) throw error;
    return { ok: true };
  });

// ── markHiveMindEventsRead ────────────────────────────────────────────────────
export const markHiveMindEventsRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ ids: z.array(z.string().uuid()).optional() }).parse(input)
  )
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    let q = sb.from("hivemind_events")
      .update({ is_read: true })
      .eq("workspace_id", context.workspaceId);
    if (data.ids?.length) q = q.in("id", data.ids);
    else q = q.eq("is_read", false);
    const { error } = await q;
    if (error) throw error;
    return { ok: true };
  });
