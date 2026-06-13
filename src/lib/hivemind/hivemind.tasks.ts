import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

  return results;
}

// ── runHiveMindScan ───────────────────────────────────────────────────────────
export const runHiveMindScan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb          = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

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

    const [tasksRes, eventsRes] = await Promise.all([
      sb.from("hivemind_tasks")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(200),
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
