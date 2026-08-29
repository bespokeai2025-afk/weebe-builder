import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import twilio from "twilio";
import {
  buildWatiTemplateParams,
  findLeadByPhone,
  formatWatiSendError,
  getWatiConnectionForWorkspace,
  normalizeWhatsAppPhone,
  resolveCampaignAudienceLeads,
  sendWatiSessionMessage,
  sendWatiTemplateMessage,
  sendWatiTemplateMessagesBatch,
  type CampaignAudienceFilter,
} from "@/lib/whatsapp/wati-campaign.server";
import type { CsvLeadRow } from "@/lib/whatsapp/csv-leads.shared";
import { parseNotesToMeta } from "@/lib/whatsapp/csv-leads.shared";
import { batchImportCsvLeads } from "@/lib/whatsapp/csv-import-batch.server";
import {
  fetchWorkspaceMessageStatsMaps,
  lookupWaContactMessageStats,
  markWhatsappContactsMessaged,
} from "@/lib/whatsapp/wa-contact-message-stats.server";
import {
  buildBuzzchatExportCsv,
  checkCampaignAudienceOverlap,
  filterBuzzchatCampaignLeads,
  getBuzzchatTodayStats,
} from "@/lib/whatsapp/buzzchat-ops.server";
import {
  extractWatiTemplateParamSlots,
  validateWatiTemplateParamMapping,
  resolveWatiTemplateMessageBody,
  parseTemplateFallbackBody,
  rehydrateTemplateFallbackBody,
  watiTemplateBodyOriginalText,
} from "@/lib/whatsapp/wati-template-params.shared";
import { watiTemplateBodyPreview } from "@/lib/whatsapp/wati-template-status.shared";
import { assertNotWbahWorkspace } from "@/lib/wbah-exclusion.shared";
import {
  forceSyncWatiCampaigns,
  maybeAutoSyncWatiCampaigns,
} from "@/lib/whatsapp/wati-sync.server";
import { reconcileWatiOutboundMessageStatuses } from "@/lib/whatsapp/wati-message-status.server";
import {
  buildWhatsappThreadFromMessages,
  sortWhatsappInboxThreads,
} from "@/lib/whatsapp/wa-inbox-threads.shared";
import {
  maybeSyncWatiInboxFromApi,
  syncWatiInboxFromWatiApi,
} from "@/lib/whatsapp/wati-inbox-sync.server";
import { enrichInboxBodiesFromWatiApi } from "@/lib/whatsapp/wati-inbox-enrich.server";
import {
  WHATSAPP_CHAT_STATUSES,
  syncWhatsappConversation,
  type WhatsappConversationRow,
  WHATSAPP_CONVERSATION_COLUMNS,
} from "@/lib/whatsapp/whatsapp-conversations.server";
import { WATI_CHAT_STATUSES, resolveWatiChatStatus } from "@/lib/whatsapp/wati-chat-status.shared";
import { collapseOptimisticOutboundDuplicates } from "@/lib/whatsapp/whatsapp-message-dedupe.server";

// ── Inbox ─────────────────────────────────────────────────────────────────────

function isTemplateShorthandBody(body: unknown): body is string {
  return typeof body === "string" && body.trimStart().startsWith("[Template:");
}

async function enrichInboxMessageBodies(
  workspaceId: string,
  messages: Array<Record<string, unknown>>,
  opts?: { skipWatiApi?: boolean },
): Promise<void> {
  const shorthand = messages.filter((m) => isTemplateShorthandBody(m.body));
  if (shorthand.length === 0) return;

  const admin = supabaseAdmin as any;
  const campaignIds = new Set<string>();
  const leadIds = new Set<string>();

  for (const m of shorthand) {
    if (m.campaign_id) campaignIds.add(String(m.campaign_id));
    if (m.lead_id) leadIds.add(String(m.lead_id));
  }

  const campaignsById = new Map<
    string,
    { wati_template_name: string | null; template_params: Record<string, string> | null }
  >();
  if (campaignIds.size > 0) {
    const { data: campaigns } = await admin
      .from("whatsapp_campaigns")
      .select("id, wati_template_name, template_params")
      .eq("workspace_id", workspaceId)
      .in("id", Array.from(campaignIds));
    for (const c of campaigns ?? []) {
      campaignsById.set(String(c.id), c);
    }
  }

  const templatesByName = new Map<string, Record<string, unknown>>();
  {
    const { data: templates } = await admin
      .from("wati_templates")
      .select("name, components, body_preview")
      .eq("workspace_id", workspaceId);
    for (const t of templates ?? []) {
      templatesByName.set(String(t.name).toLowerCase(), t as Record<string, unknown>);
    }
  }

  const leadsById = new Map<string, Record<string, unknown>>();
  if (leadIds.size > 0) {
    const { data: leads } = await admin
      .from("leads")
      .select("*")
      .eq("workspace_id", workspaceId)
      .in("id", Array.from(leadIds));
    for (const l of leads ?? []) {
      leadsById.set(String(l.id), l as Record<string, unknown>);
    }
  }

  for (const m of shorthand) {
    const campaign = m.campaign_id ? campaignsById.get(String(m.campaign_id)) : undefined;
    const templateName =
      campaign?.wati_template_name ??
      parseTemplateFallbackBody(String(m.body))?.templateName ??
      "";
    const template = templateName
      ? templatesByName.get(templateName.toLowerCase())
      : undefined;
    const lead = m.lead_id ? leadsById.get(String(m.lead_id)) : undefined;
    const mapping = (campaign?.template_params ?? null) as Record<string, string> | null;

    let resolved: string | null = null;
    if (template && mapping && lead) {
      const bodyText =
        watiTemplateBodyOriginalText(template) ?? watiTemplateBodyPreview(template);
      const paramSlots = extractWatiTemplateParamSlots(template);
      if (bodyText && paramSlots.length > 0) {
        const parameters = buildWatiTemplateParams(lead, mapping, paramSlots);
        const rendered = resolveWatiTemplateMessageBody(bodyText, templateName, parameters);
        if (!rendered.startsWith("[Template:")) resolved = rendered;
      }
    }

    if (!resolved && template) {
      resolved = rehydrateTemplateFallbackBody(String(m.body), template);
    }

    if (resolved) m.body = resolved;
  }

  if (!opts?.skipWatiApi) {
    await enrichInboxBodiesFromWatiApi(admin, workspaceId, messages, isTemplateShorthandBody);
  }
}

const inboxFiltersSchema = z.object({
  search: z.string().trim().max(120).optional(),
  status: z.enum(WHATSAPP_CHAT_STATUSES).optional(),
  assigneeId: z.string().uuid().optional(),
  unassigned: z.boolean().optional(),
  tag: z.string().trim().max(60).optional(),
  unreadOnly: z.boolean().optional(),
  /** WATI's chat status — "expired" means the 24h reply window has closed. */
  chatStatus: z.enum(WATI_CHAT_STATUSES).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
});

/** PostgREST treats these as filter syntax inside or()/ilike patterns. */
function sanitizeSearchTerm(term: string): string {
  return term.replace(/[%,()*\\]/g, "").trim();
}

async function groupThreadsFromMessages(
  workspaceId: string,
  rows: Array<Record<string, unknown>>,
) {
  await enrichInboxMessageBodies(workspaceId, rows, { skipWatiApi: true });

  const threadMap = new Map<string, Array<Record<string, unknown>>>();
  for (const m of rows) {
    const phone = m.contact_phone as string;
    if (!phone) continue;
    const bucket = threadMap.get(phone) ?? [];
    bucket.push(m);
    threadMap.set(phone, bucket);
  }

  return [...threadMap.entries()]
    .map(([phone, msgs]) => buildWhatsappThreadFromMessages(phone, msgs as any))
    .filter((t): t is NonNullable<typeof t> => t != null);
}

/**
 * Adds canonical CRM lead IDs to inbox threads that predate message-level lead_id backfills.
 * Both conversation-state and message-only inbox paths use this lookup.
 */
type LeadLookupResult = {
  data?: Array<{
    id?: unknown;
    phone?: unknown;
    buzzchat_conversation_id?: unknown;
  }>;
};

type LeadLookupClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        in: (column: string, values: string[]) => Promise<LeadLookupResult>;
      };
    };
  };
};

export async function enrichInboxThreadsWithLeadIds(
  sb: LeadLookupClient & Parameters<typeof findLeadByPhone>[0],
  workspaceId: string,
  threads: Array<{ phone: string; leadId?: string | null }>,
  conversationIdByPhone = new Map<string, string>(),
): Promise<void> {
  const unlinkedThreads = threads.filter((thread) => !thread.leadId);
  if (unlinkedThreads.length === 0) return;

  try {
    const conversationIds = [
      ...new Set(
        unlinkedThreads
          .map((thread) => conversationIdByPhone.get(normalizeWhatsAppPhone(thread.phone)))
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const byConversationResult = await (
      conversationIds.length > 0
        ? sb
            .from("leads")
            .select("id, buzzchat_conversation_id")
            .eq("workspace_id", workspaceId)
            .in("buzzchat_conversation_id", conversationIds)
        : Promise.resolve({ data: [] })
    );

    const leadByConversationId = new Map<string, string>();
    for (const lead of byConversationResult.data ?? []) {
      if (lead.buzzchat_conversation_id && lead.id) {
        leadByConversationId.set(String(lead.buzzchat_conversation_id), String(lead.id));
      }
    }

    const phoneLookups = await Promise.all(
      unlinkedThreads.map(async (thread) => ({
        thread,
        lead:
          leadByConversationId.get(
            conversationIdByPhone.get(normalizeWhatsAppPhone(thread.phone)) ?? "",
          )
            ? null
            : await findLeadByPhone(sb, workspaceId, thread.phone),
      })),
    );
    for (const { thread, lead } of phoneLookups) {
      const phone = normalizeWhatsAppPhone(thread.phone);
      thread.leadId =
        leadByConversationId.get(conversationIdByPhone.get(phone) ?? "") ??
        (lead?.id ? String(lead.id) : null) ??
        null;
    }
  } catch {
    // Lead linking is additive; an unavailable lookup must not take down the inbox.
  }
}

export const listWhatsappThreads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) => inboxFiltersSchema.parse(input ?? {}))
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;

    const limit = data.limit ?? 60;
    const search = sanitizeSearchTerm(data.search ?? "");
    const hasStructuralFilter = Boolean(
      data.status ||
        data.assigneeId ||
        data.unassigned ||
        data.tag ||
        data.unreadOnly ||
        data.chatStatus,
    );

    // Search matches a contact (name/phone) or anything they said, so collect candidate phones
    // from both sides before applying the structural filters.
    let searchPhones: string[] | null = null;
    if (search) {
      const [{ data: byContact }, { data: byBody }] = await Promise.all([
        sb
          .from("whatsapp_conversations")
          .select("contact_phone")
          .eq("workspace_id", workspaceId)
          .or(`contact_name.ilike.%${search}%,contact_phone.ilike.%${search}%`)
          .limit(300),
        sb
          .from("whatsapp_messages")
          .select("contact_phone")
          .eq("workspace_id", workspaceId)
          .ilike("body", `%${search}%`)
          .order("sent_at", { ascending: false })
          .limit(300),
      ]);

      searchPhones = [
        ...new Set(
          [...(byContact ?? []), ...(byBody ?? [])]
            .map((r: { contact_phone: string }) => r.contact_phone)
            .filter(Boolean),
        ),
      ];
      if (searchPhones.length === 0) return [];
    }

    let convQuery = sb
      .from("whatsapp_conversations")
      .select(WHATSAPP_CONVERSATION_COLUMNS)
      .eq("workspace_id", workspaceId)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(limit);

    if (data.status) convQuery = convQuery.eq("status", data.status);
    if (data.unassigned) convQuery = convQuery.is("assignee_id", null);
    else if (data.assigneeId) convQuery = convQuery.eq("assignee_id", data.assigneeId);
    if (data.tag) convQuery = convQuery.contains("tags", [data.tag]);
    if (data.unreadOnly) convQuery = convQuery.gt("unread_count", 0);
    if (searchPhones) convQuery = convQuery.in("contact_phone", searchPhones);

    const { data: convRows, error: convErr } = await convQuery;
    if (convErr) throw new Error(convErr.message);

    const conversations = (convRows ?? []) as WhatsappConversationRow[];

    // No conversation rows and nothing was filtered out — fall back to deriving threads straight
    // from messages so the inbox still works before/while conversation state is backfilled.
    if (conversations.length === 0) {
      if (search || hasStructuralFilter) return [];

      const { data: allRows, error } = await sb
        .from("whatsapp_messages")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("sent_at", { ascending: false })
        .limit(1000);
      if (error) throw new Error(error.message);

      const messageRows = (allRows ?? []) as Array<Record<string, unknown>>;
      const fallbackThreads = await groupThreadsFromMessages(workspaceId, messageRows);
      const conversationIdByPhone = new Map<string, string>();
      for (const row of messageRows) {
        if (!row.contact_phone || !row.conversation_id) continue;
        conversationIdByPhone.set(
          normalizeWhatsAppPhone(String(row.contact_phone)),
          String(row.conversation_id),
        );
      }
      await enrichInboxThreadsWithLeadIds(
        sb,
        workspaceId,
        fallbackThreads,
        conversationIdByPhone,
      );
      return sortWhatsappInboxThreads(fallbackThreads);
    }

    const phones = conversations.map((c) => c.contact_phone);
    const { data: msgRows, error: msgErr } = await sb
      .from("whatsapp_messages")
      .select("*")
      .eq("workspace_id", workspaceId)
      .in("contact_phone", phones)
      .order("sent_at", { ascending: false })
      .limit(Math.min(3000, phones.length * 100));
    if (msgErr) throw new Error(msgErr.message);

    const threads = await groupThreadsFromMessages(
      workspaceId,
      (msgRows ?? []) as Array<Record<string, unknown>>,
    );
    const threadByPhone = new Map(threads.map((t) => [t.phone, t]));

    const merged = conversations.map((conv) => {
      const thread = threadByPhone.get(conv.contact_phone);
      return {
        ...(thread ?? {
          phone: conv.contact_phone,
          name: conv.contact_name,
          lastMessage: null,
          lastAt: conv.last_message_at ?? new Date(0).toISOString(),
          lastDirection: conv.last_direction ?? undefined,
          needsReply: conv.last_direction === "inbound",
          unread: conv.unread_count,
          messages: [],
        }),
        name: thread?.name ?? conv.contact_name,
        conversationId: conv.id,
        leadId: thread?.leadId ?? null,
        status: conv.status,
        assigneeId: conv.assignee_id,
        assignedTeamId: conv.assigned_team_id,
        tags: conv.tags ?? [],
        attributes: conv.attributes ?? {},
        // Stored count is authoritative — it survives page reloads and is shared across agents.
        unread: conv.unread_count,
        lastReadAt: conv.last_read_at,
        watiChatStatus: conv.wati_chat_status,
        watiTopic: conv.wati_topic,
        watiAgentName: conv.wati_agent_name,
        lastInboundAt: conv.last_inbound_at,
        lastMessageOrigin: conv.last_message_origin,
      };
    });

    await enrichInboxThreadsWithLeadIds(
      sb,
      workspaceId,
      merged,
      new Map(
        conversations
          .filter((conversation) => Boolean(conversation.wati_conversation_id))
          .map((conversation) => [
            normalizeWhatsAppPhone(conversation.contact_phone),
            conversation.wati_conversation_id!,
          ]),
      ),
    );

    // Session expiry is a function of time, so it is resolved here rather than filtered in SQL
    // against a stored status that may be one poll behind.
    const filtered = data.chatStatus
      ? merged.filter(
          (t) =>
            resolveWatiChatStatus({
              watiChatStatus: t.watiChatStatus,
              lastInboundAt: t.lastInboundAt,
            }) === data.chatStatus,
        )
      : merged;

    return sortWhatsappInboxThreads(filtered);
  });

/** Clear the unread badge once an agent opens the thread. */
export const markWhatsappThreadRead = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ phone: z.string().min(5) }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");

    const phone = normalizeWhatsAppPhone(data.phone);
    if (!phone) throw new Error("Invalid phone number");

    const { error } = await (supabase as any)
      .from("whatsapp_conversations")
      .update({
        unread_count: 0,
        last_read_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", workspaceId)
      .eq("contact_phone", phone);
    if (error) throw new Error(error.message);

    return { ok: true as const };
  });

/** Chat status, assignment, and tags for one thread. */
export const updateWhatsappConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        phone: z.string().min(5),
        status: z.enum(WHATSAPP_CHAT_STATUSES).optional(),
        assigneeId: z.string().uuid().nullable().optional(),
        assignedTeamId: z.string().uuid().nullable().optional(),
        tags: z.array(z.string().trim().min(1).max(60)).max(25).optional(),
        attributes: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");

    const phone = normalizeWhatsAppPhone(data.phone);
    if (!phone) throw new Error("Invalid phone number");

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.status !== undefined) patch.status = data.status;
    if (data.assigneeId !== undefined) patch.assignee_id = data.assigneeId;
    if (data.assignedTeamId !== undefined) patch.assigned_team_id = data.assignedTeamId;
    if (data.tags !== undefined) patch.tags = [...new Set(data.tags)];
    if (data.attributes !== undefined) patch.attributes = data.attributes;

    const { data: updated, error } = await (supabase as any)
      .from("whatsapp_conversations")
      .update(patch)
      .eq("workspace_id", workspaceId)
      .eq("contact_phone", phone)
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated) throw new Error("Conversation not found");

    return { ok: true as const };
  });

// ── Teams (WATI parity: route a conversation to a team rather than one person) ────────────────

export const listWhatsappTeams = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;

    const { data: teams, error } = await sb
      .from("whatsapp_teams")
      .select("id, name, created_at")
      .eq("workspace_id", workspaceId)
      .order("name");
    if (error) throw new Error(error.message);

    const teamRows = (teams ?? []) as Array<{ id: string; name: string; created_at: string }>;
    if (teamRows.length === 0) return [];

    const { data: memberRows } = await sb
      .from("whatsapp_team_members")
      .select("team_id, user_id")
      .in(
        "team_id",
        teamRows.map((t) => t.id),
      );

    const membersByTeam = new Map<string, string[]>();
    for (const row of (memberRows ?? []) as Array<{ team_id: string; user_id: string }>) {
      membersByTeam.set(row.team_id, [...(membersByTeam.get(row.team_id) ?? []), row.user_id]);
    }

    return teamRows.map((t) => ({
      id: t.id,
      name: t.name,
      createdAt: t.created_at,
      memberIds: membersByTeam.get(t.id) ?? [],
    }));
  });

export const createWhatsappTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ name: z.string().trim().min(1).max(80) }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");

    const { data: created, error } = await (supabase as any)
      .from("whatsapp_teams")
      .insert({ workspace_id: workspaceId, name: data.name })
      .select("id")
      .single();

    if (error) {
      if (error.code === "23505" || String(error.message).includes("duplicate")) {
        throw new Error(`A team named "${data.name}" already exists`);
      }
      throw new Error(error.message);
    }

    return { id: created.id as string };
  });

export const deleteWhatsappTeam = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ teamId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");

    // whatsapp_conversations.assigned_team_id is ON DELETE SET NULL, so assigned chats simply
    // become unassigned rather than disappearing.
    const { error } = await (supabase as any)
      .from("whatsapp_teams")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("id", data.teamId);
    if (error) throw new Error(error.message);

    return { ok: true as const };
  });

export const setWhatsappTeamMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        teamId: z.string().uuid(),
        userIds: z.array(z.string().uuid()).max(200),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;

    const { data: team } = await sb
      .from("whatsapp_teams")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("id", data.teamId)
      .maybeSingle();
    if (!team) throw new Error("Team not found");

    // Only workspace members can be on a team.
    const { data: members } = await sb
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", workspaceId);
    const allowed = new Set(
      ((members ?? []) as Array<{ user_id: string }>).map((m) => m.user_id),
    );
    const userIds = [...new Set(data.userIds)].filter((id) => allowed.has(id));

    const { error: delErr } = await sb
      .from("whatsapp_team_members")
      .delete()
      .eq("team_id", data.teamId);
    if (delErr) throw new Error(delErr.message);

    if (userIds.length > 0) {
      const { error: insErr } = await sb
        .from("whatsapp_team_members")
        .insert(userIds.map((user_id) => ({ team_id: data.teamId, user_id })));
      if (insErr) throw new Error(insErr.message);
    }

    return { ok: true as const, memberCount: userIds.length };
  });

/** Assignable people, teams, and the tags already in use — for the inbox filter/assign controls. */
export const getWhatsappInboxMeta = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const sb = supabase as any;

    const [{ data: members }, { data: teams }, { data: tagRows }, { count: conversationCount }] =
      await Promise.all([
        sb
          .from("workspace_members")
          .select("user_id, role")
          .eq("workspace_id", workspaceId)
          .limit(200),
        sb
          .from("whatsapp_teams")
          .select("id, name")
          .eq("workspace_id", workspaceId)
          .order("name")
          .limit(100),
        sb
          .from("whatsapp_conversations")
          .select("tags")
          .eq("workspace_id", workspaceId)
          .limit(2000),
        sb
          .from("whatsapp_conversations")
          .select("id", { count: "exact", head: true })
          .eq("workspace_id", workspaceId),
      ]);

    const memberRows = (members ?? []) as Array<{ user_id: string; role: string | null }>;

    // workspace_members.user_id points at auth.users, not profiles, so there is no FK for
    // PostgREST to embed across — look the names up separately.
    const namesByUserId = new Map<string, string>();
    if (memberRows.length > 0) {
      const { data: profiles } = await sb
        .from("profiles")
        .select("user_id, full_name, email")
        .in(
          "user_id",
          memberRows.map((m) => m.user_id),
        );
      for (const p of (profiles ?? []) as Array<{
        user_id: string;
        full_name: string | null;
        email: string | null;
      }>) {
        const label = p.full_name?.trim() || p.email?.trim();
        if (label) namesByUserId.set(p.user_id, label);
      }
    }

    const tags = [
      ...new Set(
        ((tagRows ?? []) as Array<{ tags: string[] | null }>).flatMap((r) => r.tags ?? []),
      ),
    ].sort();

    return {
      members: memberRows.map((m) => ({
        userId: m.user_id,
        role: m.role ?? null,
        name: namesByUserId.get(m.user_id) ?? null,
      })),
      teams: ((teams ?? []) as Array<{ id: string; name: string }>).map((t) => ({
        id: t.id,
        name: t.name,
      })),
      tags,
      /** Total threads, so the inbox can tell the user how many are still below the fold. */
      conversationCount: conversationCount ?? 0,
    };
  });

/** Background WATI pull — call separately so inbox list stays fast. */
export const refreshWatiInboxFromWati = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const inserted = await maybeSyncWatiInboxFromApi(workspaceId);
    return { inserted };
  });

/** Pull latest WATI messages for one contact (local dev + open thread polling). */
export const syncWhatsappThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ phone: z.string().min(5) }).parse(input))
  .handler(async ({ context, data }) => {
    const { workspaceId } = context;
    if (!workspaceId) throw new Error("No active workspace");

    const phone = normalizeWhatsAppPhone(data.phone);
    if (!phone) throw new Error("Invalid phone number");

    const conn = await getWatiConnectionForWorkspace(supabaseAdmin as any, workspaceId);
    if (!conn) {
      return { ok: false as const, synced: 0, reason: "WATI not connected" };
    }

    try {
      const synced = await syncWatiInboxFromWatiApi(workspaceId, [phone], { maxPages: 5 });
      return { ok: true as const, synced };
    } catch (err) {
      console.error("[wa-inbox] WATI thread sync failed:", err);
      throw new Error(
        err instanceof Error ? err.message : "Could not sync conversation from WATI",
      );
    }
  });

export const sendWhatsappMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({ to: z.string(), body: z.string().min(1), contactName: z.string().optional() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabase as any;
    const contactPhone = normalizeWhatsAppPhone(data.to.replace("whatsapp:", ""));

    const watiConn = await getWatiConnectionForWorkspace(sb, workspaceId);
    if (watiConn) {
      const result = await sendWatiSessionMessage({
        tenantId: watiConn.tenant_id,
        apiKey: watiConn.api_key,
        apiHost: watiConn.api_host,
        toPhone: contactPhone,
        messageText: data.body,
      });
      if (!result.ok) throw new Error(result.error ?? "WATI send failed");

      await sb.from("whatsapp_messages").insert({
        workspace_id: workspaceId,
        external_id: result.messageId,
        contact_phone: contactPhone,
        contact_name: data.contactName ?? null,
        direction: "outbound",
        body: data.body,
        status: "sent",
        provider: "wati",
        sent_at: new Date().toISOString(),
      });

      // The inbox refetch that follows a send triggers an API sync, which writes the same message
      // again under WATI's real id. Drop whichever copy is redundant before the thread reloads.
      await collapseOptimisticOutboundDuplicates(workspaceId, contactPhone);

      await markWhatsappContactsMessaged(sb, workspaceId, [contactPhone]);
      await syncWhatsappConversation(workspaceId, contactPhone);
      const { applyOutboundCampaignStageByPhone } = await import(
        "@/lib/whatsapp/campaign-stage.server"
      );
      await applyOutboundCampaignStageByPhone(sb, workspaceId, contactPhone);

      return { ok: true, sid: result.messageId, provider: "wati" as const };
    }

    const { data: ws } = await sb
      .from("workspace_settings")
      .select("twilio_account_sid, twilio_auth_token, whatsapp_phone_id")
      .eq("workspace_id", workspaceId)
      .single();

    const accountSid = ws?.twilio_account_sid ?? process.env.TWILIO_ACCOUNT_SID;
    const authToken = ws?.twilio_auth_token ?? process.env.TWILIO_AUTH_TOKEN;
    const fromPhone = ws?.whatsapp_phone_id;

    if (!accountSid || !authToken || !fromPhone) {
      throw new Error(
        "WhatsApp not configured. Connect WATI in Buzzchat → Settings, or add Twilio credentials.",
      );
    }

    const client = twilio(accountSid, authToken);
    const to   = `whatsapp:${contactPhone}`;
    const from = fromPhone.startsWith("whatsapp:") ? fromPhone : `whatsapp:${fromPhone}`;

    const msg = await client.messages.create({ from, to, body: data.body });

    await sb.from("whatsapp_messages").insert({
      workspace_id: workspaceId,
      external_id: msg.sid,
      contact_phone: contactPhone,
      contact_name: data.contactName ?? null,
      direction: "outbound",
      body: data.body,
      status: "sent",
      provider: "twilio",
      sent_at: new Date().toISOString(),
    });

    await markWhatsappContactsMessaged(sb, workspaceId, [contactPhone]);
    await syncWhatsappConversation(workspaceId, contactPhone);

    return { ok: true, sid: msg.sid, provider: "twilio" as const };
  });

// ── Contacts ──────────────────────────────────────────────────────────────────

const csvLeadRowSchema = z.object({
  phone: z.string().min(3).max(40),
  full_name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  company_name: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  import_meta: z.record(z.string(), z.string()).nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  lead_status: z.string().nullable().optional(),
  qualification: z
    .object({
      intent: z.enum(["sell", "rent", "both", ""]).optional(),
      asking_price: z.string().optional(),
      rental_price: z.string().optional(),
      availability: z.string().optional(),
      property_status: z.string().optional(),
      viewing_availability: z.string().optional(),
      notes: z.string().optional(),
    })
    .nullable()
    .optional(),
});

export const listWAContacts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) return { contacts: [], summary: { total: 0, messaged: 0, replied: 0, not_messaged: 0, dnc: 0 } };
    const sb = supabase as any;
    const { data, error } = await sb
      .from("whatsapp_contacts")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const { byExact, byTail } = await fetchWorkspaceMessageStatsMaps(sb, workspaceId);
    let messaged = 0;
    let replied = 0;
    let dnc = 0;

    const contacts = (data ?? []).map((row: Record<string, unknown>) => {
      const stats = lookupWaContactMessageStats(String(row.phone ?? ""), byExact, byTail);
      if (stats.messaged) messaged++;
      if (stats.inbound_count > 0) replied++;
      if (row.do_not_contact) dnc++;
      return {
        ...row,
        wa_stats: stats,
      };
    });

    return {
      contacts,
      summary: {
        total: contacts.length,
        messaged,
        replied,
        not_messaged: contacts.length - messaged,
        dnc,
      },
    };
  });

export const createWAContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({
      name: z.string().optional(),
      phone: z.string().min(1),
      tags: z.array(z.string()).optional(),
      source: z.string().optional(),
      lead_status: z.string().optional(),
      notes: z.string().optional(),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabase as any;
    const { data: row, error } = await sb
      .from("whatsapp_contacts")
      .upsert(
        { workspace_id: workspaceId, ...data, updated_at: new Date().toISOString() },
        { onConflict: "workspace_id,phone", ignoreDuplicates: false },
      )
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updateWAContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({
      id: z.string(),
      name: z.string().optional(),
      phone: z.string().optional(),
      tags: z.array(z.string()).optional(),
      source: z.string().optional(),
      lead_status: z.string().optional(),
      notes: z.string().optional(),
      archived: z.boolean().optional(),
      do_not_contact: z.boolean().optional(),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabase as any;
    const { id, ...rest } = data;
    const { error } = await sb
      .from("whatsapp_contacts")
      .update({ ...rest, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteWAContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabase as any;
    const { error } = await sb
      .from("whatsapp_contacts")
      .delete()
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteAllWAContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabase as any;
    const { count } = await sb
      .from("whatsapp_contacts")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId);
    const { error } = await sb.from("whatsapp_contacts").delete().eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true, deleted: count ?? 0 };
  });

export const importWAContactsCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        rows: z.array(csvLeadRowSchema).min(1).max(5000),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabase as any;
    return batchImportCsvLeads(sb, workspaceId, data.rows as CsvLeadRow[], { syncWhatsappContacts: true });
  });

// ── Templates ─────────────────────────────────────────────────────────────────

export const listWATemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) return [];
    const sb = supabase as any;
    const { data, error } = await sb
      .from("whatsapp_templates")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createWATemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({
      name: z.string().min(1),
      body: z.string().min(1),
      variables: z.array(z.string()).optional(),
      category: z.string().optional(),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabase as any;
    const { data: row, error } = await sb
      .from("whatsapp_templates")
      .insert({ workspace_id: workspaceId, ...data })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updateWATemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({
      id: z.string(),
      name: z.string().optional(),
      body: z.string().optional(),
      variables: z.array(z.string()).optional(),
      category: z.string().optional(),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabase as any;
    const { id, ...rest } = data;
    const { error } = await sb
      .from("whatsapp_templates")
      .update({ ...rest, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteWATemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabase as any;
    const { error } = await sb
      .from("whatsapp_templates")
      .delete()
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Campaigns ─────────────────────────────────────────────────────────────────

export const listWACampaigns = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) return [];
    const sb = supabase as any;
    const { data, error } = await sb
      .from("whatsapp_campaigns")
      .select("*, whatsapp_templates(name)")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const campaigns = (data ?? []) as any[];
    const withStats = await Promise.all(
      campaigns.map(async (c) => {
        const { count: replied } = await sb
          .from("whatsapp_messages")
          .select("id", { count: "exact", head: true })
          .eq("campaign_id", c.id)
          .eq("direction", "inbound");
        const stats = { ...(c.stats ?? {}), replied: replied ?? 0 };
        return { ...c, stats };
      }),
    );
    return withStats;
  });

const audienceFilterSchema = z
  .object({
    qualification_status: z.string().optional(),
    pipeline_stage: z.string().optional(),
    status: z.string().optional(),
    whatsapp_opt_in_only: z.boolean().optional(),
    lead_ids: z.array(z.string()).optional(),
  })
  .optional();

export const createWACampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        name: z.string().min(1),
        type: z.enum(["broadcast", "follow_up", "scheduled"]),
        template_id: z.string().optional(),
        scheduled_at: z.string().optional(),
        provider: z.enum(["twilio", "wati"]).optional(),
        wati_template_name: z.string().optional(),
        template_params: z.record(z.string()).optional(),
        wati_broadcast_name: z.string().optional(),
        audience_filter: audienceFilterSchema,
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabase as any;

    let provider = data.provider ?? "twilio";
    if (!data.provider) {
      const wati = await getWatiConnectionForWorkspace(sb, workspaceId);
      if (wati && data.wati_template_name) provider = "wati";
    }
    if (provider === "wati") assertNotWbahWorkspace(workspaceId);

    const scheduledAt = data.scheduled_at ? new Date(data.scheduled_at) : null;
    const isScheduled = !!(scheduledAt && !Number.isNaN(scheduledAt.getTime()) && scheduledAt.getTime() > Date.now() + 15_000);
    if (data.scheduled_at && !isScheduled) {
      throw new Error("Pick a future date and time to schedule this campaign.");
    }

    const { data: row, error } = await sb
      .from("whatsapp_campaigns")
      .insert({
        workspace_id: workspaceId,
        name: data.name,
        type: isScheduled ? "scheduled" : data.type,
        template_id: data.template_id ?? null,
        scheduled_at: isScheduled ? scheduledAt!.toISOString() : null,
        provider,
        wati_template_name: data.wati_template_name ?? null,
        template_params: data.template_params ?? null,
        wati_broadcast_name: data.wati_broadcast_name ?? data.name,
        audience_filter: data.audience_filter ?? null,
        status: isScheduled ? "scheduled" : "draft",
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteWACampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ id: z.string() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabase as any;
    const { error } = await sb
      .from("whatsapp_campaigns")
      .delete()
      .eq("id", data.id)
      .eq("workspace_id", workspaceId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ── Analytics ─────────────────────────────────────────────────────────────────

export const getWAAnalytics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) return null;
    const sb = supabase as any;

    const { data: watiConnRow } = await sb
      .from("wati_connections")
      .select("status")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (watiConnRow?.status === "connected") {
      await maybeAutoSyncWatiCampaigns(workspaceId);
      try {
        await reconcileWatiOutboundMessageStatuses(workspaceId);
      } catch (e) {
        console.warn("[WA analytics] WATI status reconcile failed:", (e as Error).message);
      }
    }

    const [{ data: msgs }, { data: campaigns }, { data: watiCamps }, { data: watiConn }] =
      await Promise.all([
        sb
          .from("whatsapp_messages")
          .select("direction, status, sent_at, provider")
          .eq("workspace_id", workspaceId),
        sb.from("whatsapp_campaigns").select("stats, provider").eq("workspace_id", workspaceId),
        sb
          .from("wati_campaigns")
          .select("sent, delivered, read_count")
          .eq("workspace_id", workspaceId),
        sb.from("wati_connections").select("status").eq("workspace_id", workspaceId).maybeSingle(),
      ]);

    const all = (msgs ?? []) as any[];
    const outbound = all.filter((m) => m.direction === "outbound");
    const inbound = all.filter((m) => m.direction === "inbound");

    let sent      = outbound.length;
    let delivered = outbound.filter((m) => ["delivered", "read"].includes(m.status)).length;
    let read      = outbound.filter((m) => m.status === "read").length;
    const responses = inbound.length;

    // Supplement from Webee campaign stats (WATI launches write sent count here)
    let campaignSent = 0;
    let campaignDelivered = 0;
    let campaignRead = 0;
    for (const c of (campaigns ?? []) as Array<{ stats?: Record<string, number> | null }>) {
      const s = c.stats ?? {};
      campaignSent += s.sent ?? 0;
      campaignDelivered += s.delivered ?? 0;
      campaignRead += s.read ?? 0;
    }

    let watiSyncedSent = 0;
    let watiSyncedDelivered = 0;
    let watiSyncedRead = 0;
    for (const c of (watiCamps ?? []) as Array<{ sent?: number; delivered?: number; read_count?: number }>) {
      watiSyncedSent += c.sent ?? 0;
      watiSyncedDelivered += c.delivered ?? 0;
      watiSyncedRead += c.read_count ?? 0;
    }

    sent = Math.max(sent, campaignSent, watiSyncedSent);
    delivered = Math.max(delivered, campaignDelivered, watiSyncedDelivered);
    read = Math.max(read, campaignRead, watiSyncedRead);

    const watiOutbound = outbound.filter((m) => m.provider === "wati");
    const twilioOutbound = outbound.filter((m) => !m.provider || m.provider === "twilio");

    const convRate = sent > 0 ? Math.round((responses / sent) * 100) : 0;

    const now = new Date();
    const days: { date: string; sent: number; received: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const dayStr = d.toISOString().slice(0, 10);
      days.push({
        date: label,
        sent: outbound.filter((m) => m.sent_at?.slice(0, 10) === dayStr).length,
        received: inbound.filter((m) => m.sent_at?.slice(0, 10) === dayStr).length,
      });
    }

    const watiConnected = watiConn?.status === "connected";
    const hasData = all.length > 0 || sent > 0 || watiSyncedSent > 0;

    return {
      sent,
      delivered,
      read,
      responses,
      convRate,
      days,
      total: all.length,
      watiConnected,
      hasData,
      providers: {
        twilio: {
          sent: twilioOutbound.length,
          delivered: twilioOutbound.filter((m) => ["delivered", "read"].includes(m.status)).length,
          read: twilioOutbound.filter((m) => m.status === "read").length,
        },
        wati: {
          sent: Math.max(watiOutbound.length, campaignSent, watiSyncedSent),
          delivered: Math.max(
            watiOutbound.filter((m) => ["delivered", "read"].includes(m.status)).length,
            campaignDelivered,
            watiSyncedDelivered,
          ),
          read: Math.max(
            watiOutbound.filter((m) => m.status === "read").length,
            campaignRead,
            watiSyncedRead,
          ),
        },
        messages: {
          sent: outbound.length,
          delivered: outbound.filter((m) => ["delivered", "read"].includes(m.status)).length,
          read: outbound.filter((m) => m.status === "read").length,
        },
      },
    };
  });

// ── WhatsApp Agents ───────────────────────────────────────────────────────────

export const getWAProviderStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId)
      return { provider: null, twilioConfigured: false, watiConnected: false, isConfigured: false };
    const sb = supabase as any;

    const { data: ws } = await sb
      .from("workspace_settings")
      .select(
        "twilio_account_sid, twilio_auth_token, whatsapp_phone_id, whatsapp_provider, meta_phone_number_id, meta_access_token",
      )
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    const twilioConfigured = !!(
      ws?.twilio_account_sid?.trim() &&
      ws?.twilio_auth_token?.trim() &&
      ws?.whatsapp_phone_id?.trim()
    );
    const metaConfigured = !!(ws?.meta_phone_number_id?.trim() && ws?.meta_access_token?.trim());

    const { data: watiRow } = await sb
      .from("wati_connections")
      .select("status")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    const watiConnected = watiRow?.status === "connected";

    const storedProvider = ws?.whatsapp_provider as string | undefined;
    const provider = storedProvider && storedProvider !== "" ? storedProvider : null;

    return {
      provider,
      twilioConfigured,
      watiConnected,
      metaConfigured,
      isConfigured: twilioConfigured || watiConnected || metaConfigured,
    };
  });

export const listWAAgents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) return [];
    const sb = supabase as any;
    const { data, error } = await sb
      .from("agents")
      .select("id, name, settings, flow_data, updated_at, created_at, retell_agent_id")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    const all = (data ?? []) as any[];
    return all.filter((a) => {
      const s = typeof a.settings === "string" ? JSON.parse(a.settings) : (a.settings ?? {});
      return s.channelType === "whatsapp";
    });
  });

// ── Settings ───────────────────────────────────────────────────────────────────

export const getWASettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) return null;
    const sb = supabase as any;
    const { data } = await sb
      .from("workspace_settings")
      .select(
        "twilio_account_sid, twilio_auth_token, whatsapp_phone_id, whatsapp_provider, meta_phone_number_id, meta_waba_id, meta_access_token, meta_verify_token",
      )
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const domain = process.env.REPLIT_DEV_DOMAIN;
    const origin = domain ? `https://${domain}` : (process.env.VITE_PUBLIC_APP_URL ?? "");
    return {
      ...(data ?? {}),
      webhookUrl: `${origin}/api/public/whatsapp-webhook/${workspaceId}`,
    };
  });

export const saveMetaSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({
      data: z.object({
        meta_phone_number_id: z.string().min(1),
        meta_waba_id:         z.string().min(1),
        meta_access_token:    z.string().min(1),
        meta_verify_token:    z.string().optional(),
      }),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("Not authenticated");
    const sb = supabase as any;

    const verifyToken =
      data.data.meta_verify_token?.trim() || crypto.randomUUID().replace(/-/g, "");

    await sb.from("workspace_settings").upsert(
      {
        workspace_id: workspaceId,
        whatsapp_provider: "meta",
        meta_phone_number_id: data.data.meta_phone_number_id.trim(),
        meta_waba_id: data.data.meta_waba_id.trim(),
        meta_access_token: data.data.meta_access_token.trim(),
        meta_verify_token: verifyToken,
      },
      { onConflict: "workspace_id" },
    );

    return { ok: true, meta_verify_token: verifyToken };
  });

export const saveWASettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({
      data: z.object({
        twilio_account_sid: z.string().optional(),
        twilio_auth_token:  z.string().optional(),
        whatsapp_phone_id:  z.string().optional(),
        whatsapp_provider:  z.string().optional(),
      }),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabase as any;
    const { error } = await sb
      .from("workspace_settings")
      .upsert({ workspace_id: workspaceId, ...data.data }, { onConflict: "workspace_id" });
    if (error) throw new Error(error.message);

    // Auto-register Twilio webhook on the phone number so the user doesn't
    // have to copy-paste the URL into the Twilio Console manually.
    const accountSid = data.data.twilio_account_sid?.trim();
    const authToken = data.data.twilio_auth_token?.trim();
    const phoneNumber = data.data.whatsapp_phone_id?.trim();

    if (accountSid && authToken && phoneNumber) {
      const domain = process.env.REPLIT_DEV_DOMAIN;
      const origin = domain ? `https://${domain}` : (process.env.VITE_PUBLIC_APP_URL ?? "");
      const webhookUrl = `${origin}/api/public/whatsapp-webhook/${workspaceId}`;
      const webhookResult = await registerTwilioWebhookForNumber(
        accountSid,
        authToken,
        phoneNumber,
        webhookUrl,
      );
      return { ok: true, webhookUrl, ...webhookResult };
    }

    return {
      ok: true,
      webhookUrl: null,
      webhookRegistered: false,
      webhookNote: "Enter all credentials to auto-register.",
    };
  });

/**
 * Register our WhatsApp webhook URL on a Twilio phone number.
 * Looks up the IncomingPhoneNumber SID by phone number then PATCHes SmsUrl.
 */
async function registerTwilioWebhookForNumber(
  accountSid: string,
  authToken: string,
  phoneNumber: string,
  webhookUrl: string,
): Promise<{ webhookRegistered: boolean; webhookNote: string; phoneSid?: string }> {
  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const phoneE164 = phoneNumber.startsWith("+") ? phoneNumber : `+${phoneNumber}`;

  try {
    // 1. Find the IncomingPhoneNumber SID for this number
    const lookupRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phoneE164)}`,
      { headers: { Authorization: `Basic ${credentials}` } },
    );

    if (!lookupRes.ok) {
      const txt = await lookupRes.text();
      console.warn("[wa-settings] Twilio number lookup failed:", txt);
      return {
        webhookRegistered: false,
        webhookNote: `Credentials saved. Twilio number lookup failed (${lookupRes.status}) — paste the webhook URL manually in the Twilio Console.`,
      };
    }

    const lookupData = (await lookupRes.json()) as any;
    const phoneSid: string | undefined = lookupData?.incoming_phone_numbers?.[0]?.sid;

    if (!phoneSid) {
      return {
        webhookRegistered: false,
        webhookNote: `Credentials saved. The number ${phoneE164} was not found on this Twilio account — double-check the number and account SID. Paste the webhook URL in the Twilio Console manually.`,
      };
    }

    // 2. Set SmsUrl + SmsMethod on that number
    const updateRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers/${phoneSid}.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          SmsUrl: webhookUrl,
          SmsMethod: "POST",
        }),
      },
    );

    if (!updateRes.ok) {
      const txt = await updateRes.text();
      console.warn("[wa-settings] Twilio webhook update failed:", txt);
      return {
        webhookRegistered: false,
        webhookNote: `Credentials saved but webhook registration failed (${updateRes.status}). Paste the URL in the Twilio Console manually.`,
        phoneSid,
      };
    }

    return {
      webhookRegistered: true,
      webhookNote: `Webhook registered automatically on ${phoneE164} (SID ${phoneSid}). You don't need to configure anything in Twilio.`,
      phoneSid,
    };
  } catch (e) {
    console.error("[wa-settings] Twilio auto-register error", e);
    return {
      webhookRegistered: false,
      webhookNote:
        "Credentials saved. Auto-webhook registration failed — paste the URL into the Twilio Console manually.",
    };
  }
}

export const registerTwilioWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabase as any;
    const { data: ws } = await sb
      .from("workspace_settings")
      .select("twilio_account_sid, twilio_auth_token, whatsapp_phone_id")
      .eq("workspace_id", workspaceId)
      .maybeSingle();

    const accountSid = ws?.twilio_account_sid?.trim();
    const authToken = ws?.twilio_auth_token?.trim();
    const phoneNumber = ws?.whatsapp_phone_id?.trim();

    if (!accountSid || !authToken || !phoneNumber) {
      throw new Error("Save your Twilio credentials and phone number first.");
    }

    const domain = process.env.REPLIT_DEV_DOMAIN;
    const origin = domain ? `https://${domain}` : (process.env.VITE_PUBLIC_APP_URL ?? "");
    const webhookUrl = `${origin}/api/public/whatsapp-webhook/${workspaceId}`;

    const result = await registerTwilioWebhookForNumber(
      accountSid,
      authToken,
      phoneNumber,
      webhookUrl,
    );
    return { webhookUrl, ...result };
  });

// ── Campaign launch ───────────────────────────────────────────────────────────

export async function launchWatiCampaignFromWebee(
  sb: any,
  workspaceId: string,
  campaign: Record<string, unknown>,
  options: { allowOverlap?: boolean } = {},
): Promise<{
  ok: true;
  sent: number;
  failed: number;
  total: number;
  sentThisBatch?: number;
  overlap?: { skipped_dnc: number; skipped_already_messaged: number; audience_before: number };
  warmup?: {
    day: number;
    dailyCap: number;
    sentToday: number;
    truncated: boolean;
    deferred: number;
    warnings: string[];
  };
  errors?: string[];
}> {
  assertNotWbahWorkspace(workspaceId);
  const conn = await getWatiConnectionForWorkspace(sb, workspaceId);
  if (!conn) throw new Error("WATI not connected — go to Buzzchat → Settings");

  const templateName = String(campaign.wati_template_name ?? "").trim();
  if (!templateName) {
    throw new Error("Campaign has no WATI template — edit the campaign and select a template");
  }

  const audienceFilter = (campaign.audience_filter ?? null) as CampaignAudienceFilter | null;
  const rawLeads = await resolveCampaignAudienceLeads(sb, workspaceId, audienceFilter);
  if (rawLeads.length === 0) {
    const ids = audienceFilter?.lead_ids?.length ?? 0;
    if (ids > 0) {
      throw new Error(
        `No leads found for this campaign (${ids} imported IDs). Re-upload the CSV in New Campaign, or import contacts again.`,
      );
    }
    throw new Error(
      "No leads with phone numbers match this campaign audience. Upload a CSV when creating the campaign, or import contacts first.",
    );
  }

  const filtered = await filterBuzzchatCampaignLeads(sb, workspaceId, rawLeads, {
    allowOverlap: options.allowOverlap,
  });
  const allLeads = filtered.leads;
  if (allLeads.length === 0) {
    const parts: string[] = [];
    if (filtered.skippedDnc > 0) parts.push(`${filtered.skippedDnc} on do-not-contact list`);
    if (filtered.skippedOverlap > 0) {
      parts.push(`${filtered.skippedOverlap} already messaged (enable “Include already messaged” to resend)`);
    }
    throw new Error(
      parts.length
        ? `No eligible recipients — ${parts.join(", ")}.`
        : "No eligible recipients after filtering.",
    );
  }

  const { checkWatiWarmupSendGate, splitItemsByChannelAllocations } = await import(
    "@/lib/whatsapp/wati-warmup.server"
  );
  const gate = await checkWatiWarmupSendGate(workspaceId, allLeads.length, { autoStart: true });
  if (!gate.allowed) {
    throw new Error(
      gate.blockReasons[0] ??
        `Send blocked by warm-up limit (${gate.sentToday}/${gate.dailyCap} sent today).`,
    );
  }
  const leads = allLeads.slice(0, gate.willSend);

  const mapping = (campaign.template_params ?? {}) as Record<string, string>;
  const broadcastName = String(campaign.wati_broadcast_name ?? campaign.name ?? "webee_campaign");
  const campaignId = String(campaign.id);

  const admin = supabaseAdmin as any;
  const { data: tplRow } = await admin
    .from("wati_templates")
    .select("components, name, body_preview")
    .eq("workspace_id", workspaceId)
    .eq("name", templateName)
    .maybeSingle();

  const paramSlots = extractWatiTemplateParamSlots(tplRow ?? { name: templateName });
  const mappingError = validateWatiTemplateParamMapping(paramSlots, mapping);
  if (mappingError) throw new Error(mappingError);

  const templateBodyText =
    watiTemplateBodyOriginalText(tplRow ?? null) ??
    watiTemplateBodyPreview(tplRow ?? { name: templateName });

  await sb
    .from("whatsapp_campaigns")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", campaignId);

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  const sendItems = leads
    .map((lead) => {
      const phone = normalizeWhatsAppPhone(String(lead.phone ?? ""));
      if (!phone) return null;
      const parameters = buildWatiTemplateParams(lead, mapping, paramSlots);
      const bodyPreview = resolveWatiTemplateMessageBody(
        templateBodyText,
        templateName,
        parameters,
      );
      return {
        phone,
        parameters,
        leadId: String(lead.id),
        contactName: (lead.full_name as string | null) ?? null,
        bodyPreview,
      };
    })
    .filter(Boolean) as Array<{
    phone: string;
    parameters: Array<{ name: string; value: string }>;
    leadId: string;
    contactName: string | null;
    bodyPreview: string;
  }>;

  failed += leads.length - sendItems.length;

  const batches = splitItemsByChannelAllocations(sendItems, gate.channelAllocations);
  const allSendResults: Array<{
    phone: string;
    leadId?: string;
    ok: boolean;
    messageId?: string;
    error?: string;
    senderChannel?: string | null;
  }> = [];

  if (batches.length === 0) {
    const { results: sendResults } = await sendWatiTemplateMessagesBatch({
      tenantId: conn.tenant_id,
      apiKey: conn.api_key,
      apiHost: conn.api_host,
      templateName,
      broadcastName,
      channel: null,
      items: sendItems,
    });
    for (const r of sendResults) {
      allSendResults.push({ ...r, senderChannel: null });
    }
  } else {
    for (const batch of batches) {
      const { results: sendResults } = await sendWatiTemplateMessagesBatch({
        tenantId: conn.tenant_id,
        apiKey: conn.api_key,
        apiHost: conn.api_host,
        templateName,
        broadcastName,
        channel: batch.channel,
        items: batch.items,
      });
      for (const r of sendResults) {
        allSendResults.push({ ...r, senderChannel: batch.channel });
      }
    }
  }

  const itemByPhone = new Map(sendItems.map((item) => [item.phone, item]));

  for (const result of allSendResults) {
    const item = itemByPhone.get(result.phone);
    if (result.ok && result.messageId) {
      sent++;
      const msgRow = {
        workspace_id: workspaceId,
        external_id: result.messageId,
        contact_phone: result.phone,
        contact_name: item?.contactName ?? null,
        lead_id: result.leadId ?? item?.leadId ?? null,
        campaign_id: campaignId,
        direction: "outbound",
        body:
          item?.bodyPreview && !isTemplateShorthandBody(item.bodyPreview)
            ? item.bodyPreview
            : resolveWatiTemplateMessageBody(
                templateBodyText,
                templateName,
                item?.parameters ?? [],
              ),
        status: "sent",
        provider: "wati",
        sender_channel: result.senderChannel ?? null,
        sent_at: new Date().toISOString(),
      };
      const { error: insErr } = await sb.from("whatsapp_messages").insert(msgRow);
      if (insErr && /sender_channel|column/.test(insErr.message ?? "")) {
        const { sender_channel: _s, ...withoutChannel } = msgRow;
        await sb.from("whatsapp_messages").insert(withoutChannel);
      } else if (insErr) {
        console.warn("[wati-campaign] message log insert failed:", insErr.message);
      }
    } else {
      failed++;
      if (result.error) errors.push(`${result.phone}: ${formatWatiSendError(result.error)}`);
    }
  }

  const sentPhones = allSendResults.filter((r) => r.ok).map((r) => r.phone);
  if (sentPhones.length > 0) {
    await markWhatsappContactsMessaged(sb, workspaceId, sentPhones);
  }

  const status = failed > 0 && sent === 0 ? "failed" : "completed";
  await sb
    .from("whatsapp_campaigns")
    .update({
      status,
      stats: {
        sent,
        failed,
        delivered: 0,
        read: 0,
        replied: 0,
        errors: errors.slice(0, 20),
        warmupDay: gate.warmupDay,
        dailyCap: gate.dailyCap,
        audienceTotal: allLeads.length,
        deferred: gate.truncated ? allLeads.length - leads.length : 0,
        warmupWarnings: gate.warnings.slice(0, 5),
        channelAllocations: gate.channelAllocations,
        numbersUsed: Object.keys(gate.channelAllocations).length,
      },
      updated_at: new Date().toISOString(),
    })
    .eq("id", campaignId);

  await forceSyncWatiCampaigns(workspaceId);

  return {
    ok: true,
    sent,
    failed,
    total: allLeads.length,
    sentThisBatch: leads.length,
    overlap: {
      skipped_dnc: filtered.skippedDnc,
      skipped_already_messaged: filtered.skippedOverlap,
      audience_before: filtered.totalBeforeFilter,
    },
    warmup: {
      day: gate.warmupDay,
      dailyCap: gate.dailyCap,
      sentToday: gate.sentToday + sent,
      truncated: gate.truncated,
      deferred: gate.truncated ? allLeads.length - leads.length : 0,
      warnings: gate.warnings,
    },
    errors: errors.slice(0, 5),
  };
}

export const launchWACampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({ id: z.string(), allowOverlap: z.boolean().optional() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    const sb = supabase as any;

    const { data: campaign, error: cErr } = await sb
      .from("whatsapp_campaigns")
      .select("*")
      .eq("id", data.id)
      .eq("workspace_id", workspaceId)
      .single();
    if (cErr || !campaign) throw new Error(cErr?.message ?? "Campaign not found");

    if (campaign.status === "active" || campaign.status === "running") {
      throw new Error("Campaign already running");
    }

    const watiConn = await getWatiConnectionForWorkspace(sb, workspaceId);
    const useWati =
      campaign.provider === "wati" ||
      (!!watiConn && !!campaign.wati_template_name);

    if (useWati) {
      assertNotWbahWorkspace(workspaceId);
      return launchWatiCampaignFromWebee(sb, workspaceId, campaign, {
        allowOverlap: data.allowOverlap,
      });
    }

    // ── Legacy Twilio path ──
    const { data: campaignWithTpl, error: cErr2 } = await sb
      .from("whatsapp_campaigns")
      .select("*, whatsapp_templates(body, name)")
      .eq("id", data.id)
      .eq("workspace_id", workspaceId)
      .single();
    if (cErr2 || !campaignWithTpl) throw new Error(cErr2?.message ?? "Campaign not found");

    if (campaignWithTpl.status === "active") throw new Error("Campaign already active");

    const templateBody: string = campaignWithTpl.whatsapp_templates?.body ?? "";
    if (!templateBody) throw new Error("Campaign has no template body — use WATI template or add a native template");

    // Get workspace settings for Twilio creds
    const { data: ws } = await sb
      .from("workspace_settings")
      .select("twilio_account_sid, twilio_auth_token, whatsapp_phone_id")
      .eq("workspace_id", workspaceId)
      .single();

    const accountSid = ws?.twilio_account_sid;
    const authToken = ws?.twilio_auth_token;
    const fromPhone = ws?.whatsapp_phone_id;
    if (!accountSid || !authToken || !fromPhone) {
      throw new Error("Twilio credentials not configured — go to WhatsApp → Settings");
    }

    // Get all contacts for this workspace
    const { data: contacts } = await sb
      .from("whatsapp_contacts")
      .select("phone, first_name, last_name")
      .eq("workspace_id", workspaceId)
      .eq("opted_in", true);

    const contactList = (contacts ?? []) as any[];
    if (contactList.length === 0) throw new Error("No opted-in contacts to send to");

    // Mark as active
    await sb
      .from("whatsapp_campaigns")
      .update({ status: "active", started_at: new Date().toISOString() })
      .eq("id", data.id);

    // Send messages
    const credentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

    let sent = 0;
    let failed = 0;
    for (const contact of contactList) {
      const name = [contact.first_name, contact.last_name].filter(Boolean).join(" ") || "there";
      const body = templateBody.replace(/\{\{name\}\}/gi, name);
      try {
        const res = await fetch(twilioUrl, {
          method: "POST",
          headers: {
            Authorization: `Basic ${credentials}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            To: `whatsapp:${contact.phone}`,
            From: `whatsapp:${fromPhone}`,
            Body: body,
          }),
        });
        const json = (await res.json()) as any;
        if (json?.sid) {
          sent++;
          await sb.from("whatsapp_messages").insert({
            workspace_id: workspaceId,
            external_id: json.sid,
            contact_phone: contact.phone,
            contact_name: name,
            direction: "outbound",
            body,
            status: "sent",
            sent_at: new Date().toISOString(),
          });
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }

    // Mark completed with stats (campaigns uses a stats JSONB column)
    await sb
      .from("whatsapp_campaigns")
      .update({
        status: "completed",
        stats: { sent, failed, delivered: 0, read: 0, replied: 0 },
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id);

    return { ok: true, sent, failed, total: contactList.length };
  });

// ── WATI campaign CSV audience ────────────────────────────────────────────────

export const importWatiCampaignLeadsCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({ rows: z.array(csvLeadRowSchema).min(1).max(5000) }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    assertNotWbahWorkspace(workspaceId);
    const sb = supabase as any;
    return batchImportCsvLeads(sb, workspaceId, data.rows as CsvLeadRow[], {
      syncWhatsappContacts: true,
    });
  });

/** Turn Buzzchat contacts into campaign lead IDs (for audience without re-uploading CSV). */
export const prepareCampaignAudienceFromContacts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        limit: z.number().int().min(1).max(5000).optional(),
        offset: z.number().int().min(0).max(500000).optional(),
        skipMessaged: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    assertNotWbahWorkspace(workspaceId);
    const sb = supabase as any;
    const limit = data.limit ?? 20;
    const offset = data.offset ?? 0;
    const skipMessaged = data.skipMessaged !== false;

    const { data: contacts, error: cErr } = await sb
      .from("whatsapp_contacts")
      .select("phone, name, notes, lead_status")
      .eq("workspace_id", workspaceId)
      .not("phone", "is", null)
      .neq("phone", "")
      .or("do_not_contact.is.null,do_not_contact.eq.false")
      .order("created_at", { ascending: true });

    if (cErr) throw new Error(cErr.message);
    if (!contacts?.length) {
      throw new Error(
        "No Buzzchat contacts yet — import your CSV under Contacts first, or use New CSV.",
      );
    }

    const { byExact, byTail } = await fetchWorkspaceMessageStatsMaps(sb, workspaceId);
    let skippedMessaged = 0;
    const eligible = (
      contacts as Array<{
        phone: string;
        name?: string | null;
        notes?: string | null;
        lead_status?: string | null;
      }>
    ).filter((c) => {
      if (!skipMessaged) return true;
      const stats = lookupWaContactMessageStats(c.phone, byExact, byTail);
      const status = String(c.lead_status ?? "").toLowerCase();
      if (stats.messaged || status === "contacted") {
        skippedMessaged++;
        return false;
      }
      return true;
    });

    const sliced = eligible.slice(offset, offset + limit);
    if (sliced.length === 0) {
      throw new Error(
        skipMessaged
          ? "Everyone left in Contacts was already messaged. Turn off “Skip already sent” to resend, or import a new CSV."
          : "No contacts in this range — lower Skip or import more contacts.",
      );
    }

    const rows: CsvLeadRow[] = sliced.map((c) => ({
      phone: c.phone,
      full_name: c.name ?? null,
      notes: c.notes ?? null,
      import_meta: parseNotesToMeta(c.notes),
    }));

    const result = await batchImportCsvLeads(sb, workspaceId, rows);
    if (result.leadIds.length === 0) {
      throw new Error("Contacts found but none have valid phone numbers for WhatsApp.");
    }

    return {
      leadIds: result.leadIds,
      inserted: result.inserted,
      updated: result.updated,
      total: result.total,
      contactCount: sliced.length,
      skippedMessaged,
      remainingUnsent: Math.max(0, eligible.length - offset - sliced.length),
      unsentTotal: eligible.length,
    };
  });

export const listLeadWhatsappMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ leadId: z.string() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    assertNotWbahWorkspace(workspaceId);
    const sb = supabase as any;

    const { data: rows, error } = await sb
      .from("whatsapp_messages")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("lead_id", data.leadId)
      .order("sent_at", { ascending: true })
      .limit(200);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const sendLeadWhatsappTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        leadId: z.string().optional(),
        phone: z.string().optional(),
        contactName: z.string().optional(),
        templateName: z.string().min(1),
        templateParams: z.record(z.string()).optional(),
        broadcastName: z.string().optional(),
      })
      .refine((d) => Boolean(d.leadId || d.phone), { message: "leadId or phone is required" })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    assertNotWbahWorkspace(workspaceId);
    const sb = supabase as any;

    const conn = await getWatiConnectionForWorkspace(sb, workspaceId);
    if (!conn) throw new Error("WATI not connected — go to Buzzchat → Settings");

    let lead: Record<string, unknown> | null = null;
    if (data.leadId) {
      const { data: row, error: leadErr } = await sb
        .from("leads")
        .select("*")
        .eq("id", data.leadId)
        .eq("workspace_id", workspaceId)
        .single();
      if (leadErr || !row) throw new Error(leadErr?.message ?? "Lead not found");
      lead = row;
    } else if (data.phone) {
      lead = await findLeadByPhone(sb, workspaceId, normalizeWhatsAppPhone(data.phone));
    }

    const phone = normalizeWhatsAppPhone(String(lead?.phone ?? data.phone ?? ""));
    if (!phone) throw new Error("No phone number to send to");

    const mapping = data.templateParams ?? {};
    const templateName = data.templateName.trim();

    const { data: tplRow } = await (supabaseAdmin as any)
      .from("wati_templates")
      .select("components, name, body_preview")
      .eq("workspace_id", workspaceId)
      .eq("name", templateName)
      .maybeSingle();

    const paramSlots = extractWatiTemplateParamSlots(tplRow ?? { name: templateName });
    const mappingError = validateWatiTemplateParamMapping(paramSlots, mapping);
    if (mappingError) throw new Error(mappingError);

    const templateBodyText =
    watiTemplateBodyOriginalText(tplRow ?? null) ??
    watiTemplateBodyPreview(tplRow ?? { name: templateName });
    const leadForParams = lead ?? {
      phone,
      full_name: data.contactName ?? null,
      meta: {},
    };
    const parameters = buildWatiTemplateParams(leadForParams, mapping, paramSlots);
    const broadcastName =
      data.broadcastName ?? `lead_${String(lead?.id ?? phone).replace(/\W/g, "").slice(0, 12)}`;

    const result = await sendWatiTemplateMessage({
      tenantId: conn.tenant_id,
      apiKey: conn.api_key,
      apiHost: conn.api_host,
      toPhone: phone,
      templateName,
      parameters,
      broadcastName,
    });
    if (!result.ok) throw new Error(result.error ?? "WATI send failed");

    const bodyPreview = resolveWatiTemplateMessageBody(
      templateBodyText,
      templateName,
      parameters,
    );

    const { data: row, error: insErr } = await sb
      .from("whatsapp_messages")
      .insert({
        workspace_id: workspaceId,
        external_id: result.messageId,
        contact_phone: phone,
        contact_name: (lead?.full_name as string | null) ?? data.contactName ?? null,
        lead_id: (lead?.id as string | undefined) ?? null,
        direction: "outbound",
        body: bodyPreview,
        status: "sent",
        provider: "wati",
        sent_at: new Date().toISOString(),
      })
      .select()
      .single();
    if (insErr) throw new Error(insErr.message);

    if (lead?.id) {
      await sb
        .from("leads")
        .update({ last_contacted_at: new Date().toISOString() })
        .eq("id", lead.id);
      const { applyOutboundCampaignStage } = await import("@/lib/whatsapp/campaign-stage.server");
      await applyOutboundCampaignStage(sb, workspaceId, String(lead.id));
    }

    await markWhatsappContactsMessaged(sb, workspaceId, [phone]);

    return { ok: true, message: row };
  });

// ── Buzzchat ops (contacts tracking, overlap, export, backfill) ───────────────

export const getBuzzchatOpsDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { workspaceId } = context;
    if (!workspaceId) {
      return {
        today: { sent: 0, failed: 0, delivered: 0, read: 0, inbound: 0 },
        warmup: null,
      };
    }
    assertNotWbahWorkspace(workspaceId);
    const sb = context.supabase as any;
    const today = await getBuzzchatTodayStats(sb, workspaceId);
    const { getWatiWarmupDashboard } = await import("@/lib/whatsapp/wati-warmup.server");
    let warmup = null;
    try {
      warmup = await getWatiWarmupDashboard(workspaceId);
    } catch {
      warmup = null;
    }
    return { today, warmup };
  });

export const checkCampaignAudienceOverlapFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ campaignId: z.string() }).parse(input))
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    assertNotWbahWorkspace(workspaceId);
    const sb = supabase as any;

    const { data: campaign, error } = await sb
      .from("whatsapp_campaigns")
      .select("audience_filter")
      .eq("id", data.campaignId)
      .eq("workspace_id", workspaceId)
      .single();
    if (error || !campaign) throw new Error(error?.message ?? "Campaign not found");

    const leads = await resolveCampaignAudienceLeads(
      sb,
      workspaceId,
      (campaign.audience_filter ?? null) as CampaignAudienceFilter | null,
    );
    const phones = leads
      .map((l) => normalizeWhatsAppPhone(String(l.phone ?? "")))
      .filter((p) => p.length >= 7);
    return checkCampaignAudienceOverlap(sb, workspaceId, phones);
  });

export const exportBuzzchatContactsCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        filter: z
          .enum(["all", "messaged", "not_messaged", "replied", "dnc"])
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    assertNotWbahWorkspace(workspaceId);
    const sb = supabase as any;
    const filter = data.filter ?? "all";

    const { data: rows, error } = await sb
      .from("whatsapp_contacts")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const { byExact, byTail } = await fetchWorkspaceMessageStatsMaps(sb, workspaceId);
    type ExportRow = Record<string, unknown> & {
      wa_stats: ReturnType<typeof lookupWaContactMessageStats>;
    };
    let contacts: ExportRow[] = (rows ?? []).map((row: Record<string, unknown>) => ({
      ...row,
      wa_stats: lookupWaContactMessageStats(String(row.phone ?? ""), byExact, byTail),
    }));

    if (filter === "messaged") {
      contacts = contacts.filter((c) => c.wa_stats.messaged);
    } else if (filter === "not_messaged") {
      contacts = contacts.filter((c) => !c.wa_stats.messaged);
    } else if (filter === "replied") {
      contacts = contacts.filter((c) => c.wa_stats.inbound_count > 0);
    } else if (filter === "dnc") {
      contacts = contacts.filter((c) => Boolean(c.do_not_contact));
    }

    return { csv: buildBuzzchatExportCsv(contacts), count: contacts.length };
  });

export const backfillWhatsappContactedStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, workspaceId } = context;
    if (!workspaceId) throw new Error("No workspace");
    assertNotWbahWorkspace(workspaceId);
    const sb = supabase as any;

    const { data, error } = await sb
      .from("whatsapp_messages")
      .select("contact_phone")
      .eq("workspace_id", workspaceId)
      .eq("direction", "outbound")
      .limit(25000);
    if (error) throw new Error(error.message);

    const phones: string[] = [
      ...new Set(
        (data ?? [])
          .map((r: { contact_phone: string }) => normalizeWhatsAppPhone(r.contact_phone))
          .filter((p) => p.length >= 7),
      ),
    ];
    if (phones.length === 0) return { updated: 0 };

    await markWhatsappContactsMessaged(sb, workspaceId, phones);
    return { updated: phones.length };
  });

/**
 * Search available Twilio phone numbers that can be used for WhatsApp.
 * Uses the caller's Account SID + Auth Token so they can search before saving.
 */
export const searchTwilioNumbers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({
      accountSid:  z.string().min(1),
      authToken:   z.string().min(1),
      countryCode: z.string().default("US"),
      areaCode:    z.string().optional(),
    }).parse(input),
  )
  .handler(async ({ data }) => {
    const { accountSid, authToken, countryCode, areaCode } = data as {
      accountSid: string;
      authToken: string;
      countryCode: string;
      areaCode?: string;
    };
    const client = twilio(accountSid, authToken);

    const list = await client.availablePhoneNumbers(countryCode.toUpperCase()).local.list({
      smsEnabled: true,
      ...(areaCode?.trim() ? { areaCode: areaCode.trim() } : {}),
      pageSize: 10,
    });

    return list.map((n) => ({
      phoneNumber: n.phoneNumber,
      friendlyName: n.friendlyName,
      locality: n.locality ?? "",
      region: n.region ?? "",
      sms: !!(n.capabilities as any)?.sms,
      mms: !!(n.capabilities as any)?.mms,
      voice: !!(n.capabilities as any)?.voice,
    }));
  });

/**
 * Purchase a Twilio phone number and save it to workspace_settings.
 * The purchased number is auto-filled into whatsapp_phone_id.
 */
export const purchaseTwilioNumber = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({
      accountSid:  z.string().min(1),
      authToken:   z.string().min(1),
      phoneNumber: z.string().min(1),
    }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { supabase, workspaceId } = context;
    const { accountSid, authToken, phoneNumber } = data as {
      accountSid: string;
      authToken: string;
      phoneNumber: string;
    };

    if (!workspaceId) throw new Error("No workspace");

    const client = twilio(accountSid, authToken);
    const purchased = await client.incomingPhoneNumbers.create({ phoneNumber });

    const sb = supabase as any;
    await sb
      .from("workspace_settings")
      .upsert(
        { workspace_id: workspaceId, whatsapp_phone_id: purchased.phoneNumber },
        { onConflict: "workspace_id" },
      );

    return {
      ok: true,
      phoneNumber: purchased.phoneNumber,
      friendlyName: purchased.friendlyName,
      sid: purchased.sid,
    };
  });
