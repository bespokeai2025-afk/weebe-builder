// ── HiveMind Executive Intelligence Blocks (server only) ─────────────────────
// Deterministic derivations for the executive layer: calendar intelligence,
// email/follow-up exceptions, signup/onboarding pipeline and billing signals.
// All reads are workspace-scoped, date-windowed and row-capped; every builder
// is designed to be called inside a per-block try/catch in
// fetchFullPlatformData so one failed source degrades honestly to null.
//
// WBAH split: calendar/email/follow-up blocks skip the huge `leads` table for
// the WBAH workspace (its calendar_bookings is empty and its lead set derives
// from wbah_calls on demand elsewhere) — never mix WBAH and standard sources.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

const DAY = 86_400_000;

// ── Calendar intelligence ─────────────────────────────────────────────────────

export async function getCalendarIntelligence(workspaceId: string, isWbah: boolean) {
  // WBAH split: WBAH's bookings do NOT live in calendar_bookings — they are the
  // appointment fields captured on wbah_calls (appointment_date/appointment_time/
  // booking_status). Derive entirely from wbah_calls; never read calendar_bookings
  // or the oversized leads table for WBAH.
  if (isWbah) return getWbahCalendarIntelligence(workspaceId);
  const now = new Date();
  const nowIso = now.toISOString();
  const s60 = new Date(now.getTime() - 60 * DAY).toISOString();
  const in7d = new Date(now.getTime() + 7 * DAY).toISOString();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);

  // Two windowed queries so historical volume can never crowd out near-term
  // rows under the cap: future/today rows (ascending, capped separately) and
  // recent-past rows (descending = most recent kept if capped).
  const cols = "id,title,status,start_at,end_at,created_at,lead_id,attendee_name,source";
  const [futRes, pastRes] = await Promise.all([
    (supabaseAdmin as any)
      .from("calendar_bookings")
      .select(cols)
      .eq("workspace_id", workspaceId)
      .gte("start_at", todayStart.toISOString())
      .order("start_at", { ascending: true })
      .limit(300),
    (supabaseAdmin as any)
      .from("calendar_bookings")
      .select(cols)
      .eq("workspace_id", workspaceId)
      .gte("start_at", s60)
      .lt("start_at", todayStart.toISOString())
      .order("start_at", { ascending: false })
      .limit(300),
  ]);
  if (futRes.error) throw new Error(futRes.error.message);
  if (pastRes.error) throw new Error(pastRes.error.message);
  const rows: any[] = [...(pastRes.data ?? []).reverse(), ...(futRes.data ?? [])];

  const isCancelled = (b: any) => ["cancelled", "canceled", "rejected", "declined"].includes(String(b.status ?? "").toLowerCase());
  const isNoShow    = (b: any) => ["no_show", "noshow", "missed"].includes(String(b.status ?? "").toLowerCase());
  const isPending   = (b: any) => String(b.status ?? "").toLowerCase() === "pending";
  const active      = rows.filter((b) => !isCancelled(b) && !isNoShow(b));

  const todayAppts = active.filter((b) => b.start_at >= todayStart.toISOString() && b.start_at <= todayEnd.toISOString());
  const upcoming   = active.filter((b) => b.start_at > nowIso && b.start_at <= in7d);
  const cancellations30d = rows.filter((b) => isCancelled(b) && b.created_at >= new Date(now.getTime() - 30 * DAY).toISOString());
  const noShows30d = rows.filter((b) => isNoShow(b) && b.start_at >= new Date(now.getTime() - 30 * DAY).toISOString());
  // Unconfirmed = still pending and starting within 48h (needs confirmation now).
  const unconfirmedSoon = active.filter((b) => isPending(b) && b.start_at > nowIso && b.start_at <= new Date(now.getTime() + 2 * DAY).toISOString());

  // Double-bookings/conflicts: overlapping active future bookings.
  const future = active.filter((b) => b.start_at > nowIso).slice(0, 200);
  const conflicts: Array<{ a: string; b: string; startA: string; startB: string }> = [];
  for (let i = 0; i < future.length; i++) {
    for (let j = i + 1; j < future.length; j++) {
      const x = future[i], y = future[j];
      if (y.start_at >= x.end_at) break; // sorted by start_at — no later row can overlap x
      conflicts.push({ a: x.title ?? x.id, b: y.title ?? y.id, startA: x.start_at, startB: y.start_at });
      if (conflicts.length >= 10) break;
    }
    if (conflicts.length >= 10) break;
  }

  // Qualified leads with no booking + lead→booking lag (standard workspaces only —
  // WBAH's booking definition lives in wbah_calls and its leads table is unusable).
  let qualifiedNoBooking: Array<{ id: string; name: string; status: string; created_at: string }> = [];
  let avgLeadToBookingHours: number | null = null;
  if (!isWbah) {
    const { data: qleads, error: qErr } = await (supabaseAdmin as any)
      .from("leads")
      .select("id,full_name,status,created_at")
      .eq("workspace_id", workspaceId)
      .in("status", ["interested", "qualified"])
      .gte("created_at", s60)
      .limit(300);
    if (!qErr) {
      const bookedLeadIds = new Set(rows.filter((b) => b.lead_id && !isCancelled(b)).map((b) => b.lead_id));
      qualifiedNoBooking = (qleads ?? [])
        .filter((l: any) => !bookedLeadIds.has(l.id))
        .slice(0, 20)
        .map((l: any) => ({ id: l.id, name: l.full_name ?? "Unnamed", status: l.status, created_at: l.created_at }));

      // Lead→booking lag from bookings that reference one of these window leads.
      const leadCreated = new Map<string, string>((qleads ?? []).map((l: any) => [l.id, l.created_at]));
      const lags: number[] = [];
      for (const b of rows) {
        const lc = b.lead_id ? leadCreated.get(b.lead_id) : undefined;
        if (lc && b.created_at >= lc) lags.push((new Date(b.created_at).getTime() - new Date(lc).getTime()) / 3_600_000);
      }
      if (lags.length) avgLeadToBookingHours = Math.round((lags.reduce((s, v) => s + v, 0) / lags.length) * 10) / 10;
    }
  }

  // Booking→appointment lag: how far out appointments get scheduled.
  const schedLags = active
    .filter((b) => b.start_at >= b.created_at)
    .map((b) => (new Date(b.start_at).getTime() - new Date(b.created_at).getTime()) / 3_600_000);
  const avgBookingToApptHours = schedLags.length
    ? Math.round((schedLags.reduce((s, v) => s + v, 0) / schedLags.length) * 10) / 10
    : null;

  return {
    isWbah,
    today: todayAppts.slice(0, 10).map((b) => ({ title: b.title, start: b.start_at, attendee: b.attendee_name, status: b.status })),
    todayCount: todayAppts.length,
    upcoming7d: upcoming.length,
    upcomingSample: upcoming.slice(0, 8).map((b) => ({ title: b.title, start: b.start_at, status: b.status })),
    cancellations30d: cancellations30d.length,
    noShows30d: noShows30d.length,
    unconfirmedSoon: unconfirmedSoon.slice(0, 8).map((b) => ({ title: b.title, start: b.start_at })),
    conflicts,
    qualifiedNoBooking,
    avgLeadToBookingHours,
    avgBookingToApptHours,
  };
}

// WBAH calendar intelligence — derived ONLY from wbah_calls appointment fields.
// WBAH display convention is Europe/London (see wbah-dashboard-timezone memory).
async function getWbahCalendarIntelligence(workspaceId: string) {
  const now = new Date();
  const londonDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Europe/London" }); // YYYY-MM-DD
  const today = londonDate(now);
  const d7 = londonDate(new Date(now.getTime() + 7 * DAY));
  const s60 = londonDate(new Date(now.getTime() - 60 * DAY));
  const s30 = londonDate(new Date(now.getTime() - 30 * DAY));

  // Two windowed queries (today/future ascending + recent-past descending) so
  // 60 days of historical volume can never crowd today's/upcoming rows out of
  // the cap.
  const wcols = "id,customer_name,appointment_date,appointment_time,booking_status,started_at";
  const [futRes, pastRes] = await Promise.all([
    (supabaseAdmin as any)
      .from("wbah_calls")
      .select(wcols)
      .eq("workspace_id", workspaceId)
      .not("appointment_date", "is", null)
      .gte("appointment_date", today)
      .order("appointment_date", { ascending: true })
      .limit(300),
    (supabaseAdmin as any)
      .from("wbah_calls")
      .select(wcols)
      .eq("workspace_id", workspaceId)
      .not("appointment_date", "is", null)
      .gte("appointment_date", s60)
      .lt("appointment_date", today)
      .order("appointment_date", { ascending: false })
      .limit(300),
  ]);
  if (futRes.error) throw new Error(futRes.error.message);
  if (pastRes.error) throw new Error(pastRes.error.message);
  const rows: any[] = [...(pastRes.data ?? []).reverse(), ...(futRes.data ?? [])];

  const isCancelled = (r: any) => ["cancelled", "canceled", "rejected", "declined"].includes(String(r.booking_status ?? "").toLowerCase());
  const isNoShow    = (r: any) => ["no_show", "noshow", "missed"].includes(String(r.booking_status ?? "").toLowerCase());
  const active      = rows.filter((r) => !isCancelled(r) && !isNoShow(r));

  const apptIso = (r: any) => `${r.appointment_date}T${String(r.appointment_time ?? "00:00").slice(0, 5)}`;
  const todayAppts = active.filter((r) => r.appointment_date === today);
  const upcoming   = active.filter((r) => r.appointment_date > today && r.appointment_date <= d7);
  const cancellations30d = rows.filter((r) => isCancelled(r) && r.appointment_date >= s30);
  const noShows30d = rows.filter((r) => isNoShow(r) && r.appointment_date >= s30);

  // Conflicts: two active future appointments at the exact same date+time slot.
  const bySlot = new Map<string, any[]>();
  for (const r of active) {
    if (r.appointment_date < today) continue;
    const key = apptIso(r);
    bySlot.set(key, [...(bySlot.get(key) ?? []), r]);
  }
  const conflicts: Array<{ a: string; b: string; startA: string; startB: string }> = [];
  for (const [slot, group] of bySlot) {
    if (group.length < 2) continue;
    conflicts.push({ a: group[0].customer_name ?? group[0].id, b: group[1].customer_name ?? group[1].id, startA: slot, startB: slot });
    if (conflicts.length >= 10) break;
  }

  // Booking→appointment lag: call time → scheduled appointment time.
  const lags = active
    .filter((r) => r.started_at)
    .map((r) => (new Date(apptIso(r)).getTime() - new Date(r.started_at).getTime()) / 3_600_000)
    .filter((h) => h >= 0 && Number.isFinite(h));
  const avgBookingToApptHours = lags.length
    ? Math.round((lags.reduce((s, v) => s + v, 0) / lags.length) * 10) / 10
    : null;

  return {
    isWbah: true,
    source: "wbah_calls" as const,
    today: todayAppts.slice(0, 10).map((r) => ({ title: r.customer_name ?? "Booked call", start: apptIso(r), attendee: r.customer_name, status: r.booking_status })),
    todayCount: todayAppts.length,
    upcoming7d: upcoming.length,
    upcomingSample: upcoming.slice(0, 8).map((r) => ({ title: r.customer_name ?? "Booked call", start: apptIso(r), status: r.booking_status })),
    cancellations30d: cancellations30d.length,
    noShows30d: noShows30d.length,
    unconfirmedSoon: [] as Array<{ title: string; start: string }>, // WBAH has no pending-confirmation state
    conflicts,
    // WBAH's leads table is unusable (dup-inflated ~400k rows) — lead-join analyses unavailable.
    qualifiedNoBooking: [] as Array<{ id: string; name: string; status: string; created_at: string }>,
    avgLeadToBookingHours: null as number | null,
    avgBookingToApptHours,
  };
}

// ── Email + follow-up exceptions ──────────────────────────────────────────────

export async function getEmailIntelligence(workspaceId: string, isWbah: boolean) {
  const now = Date.now();
  const s30 = new Date(now - 30 * DAY).toISOString();
  const s7  = new Date(now - 7 * DAY).toISOString();

  const [logRes, enrollRes, waRes] = await Promise.all([
    (supabaseAdmin as any)
      .from("lead_email_log")
      .select("id,lead_id,to_email,status,error,trigger,created_at")
      .eq("workspace_id", workspaceId)
      .gte("created_at", s30)
      .limit(1000),
    (supabaseAdmin as any)
      .from("hexmail_campaign_enrollments")
      .select("id,campaign_id,lead_id,status,current_day,last_executed,enrolled_at")
      .eq("workspace_id", workspaceId)
      .order("enrolled_at", { ascending: false })
      .limit(1000),
    (supabaseAdmin as any)
      .from("whatsapp_messages")
      .select("contact_phone,contact_name,direction,created_at,lead_id")
      .eq("workspace_id", workspaceId)
      .gte("created_at", s30)
      .limit(1000),
  ]);
  if (logRes.error) throw new Error(logRes.error.message);

  const logs: any[] = logRes.data ?? [];
  const sent    = logs.filter((r) => ["sent", "delivered", "queued"].includes(String(r.status ?? "").toLowerCase()));
  const failed  = logs.filter((r) => ["failed", "error", "bounced"].includes(String(r.status ?? "").toLowerCase()));

  // Suppressed addresses — TENANT ISOLATION: suppressed_emails is a platform-wide
  // table with no workspace_id, so we only look up addresses whose sends FAILED for
  // THIS workspace (explaining the workspace's own failures). We never probe
  // successfully-delivered addresses, so a tenant cannot infer suppression state
  // created by another tenant's sending activity.
  let suppressedRecipients: Array<{ email: string; reason: string }> = [];
  const failedRecipients = [...new Set(
    logs
      .filter((r) => ["failed", "error", "bounced"].includes(String(r.status ?? "").toLowerCase()))
      .map((r) => String(r.to_email ?? "").toLowerCase())
      .filter(Boolean),
  )].slice(0, 200);
  if (failedRecipients.length) {
    const { data: sup } = await (supabaseAdmin as any)
      .from("suppressed_emails")
      .select("email,reason")
      .in("email", failedRecipients)
      .limit(50);
    suppressedRecipients = (sup ?? []).map((s: any) => ({ email: s.email, reason: s.reason }));
  }

  // Follow-up sequence exceptions:
  //  - failed: enrollment status itself indicates failure/error
  //  - stalled: active but no execution for 7d+
  //  - zero engagement: enrolled 7d+ ago and NEVER executed at all
  const allEnrolls: any[] = enrollRes.error ? [] : (enrollRes.data ?? []);
  const isFailedEnroll = (e: any) => ["failed", "error", "errored", "cancelled_error"].includes(String(e.status ?? "").toLowerCase());
  const failedEnrollments = allEnrolls.filter(isFailedEnroll);
  const enrolls = allEnrolls.filter((e) => String(e.status ?? "").toLowerCase() === "active");
  const zeroEngagement = enrolls.filter((e) => !e.last_executed && e.enrolled_at < s7);
  const stalled = enrolls.filter((e) => {
    const last = e.last_executed ?? e.enrolled_at;
    return !last || last < s7;
  });

  // Conversation exceptions from WhatsApp (standard workspaces; WBAH conversations
  // live in WeeBespoke, not here): last message inbound with no reply = awaiting
  // human action; only-outbound threads with no inbound in the window = silent.
  const waMsgs: any[] = waRes.error ? [] : (waRes.data ?? []);
  const byContact = new Map<string, any[]>();
  for (const m of waMsgs) {
    const key = m.contact_phone;
    if (!key) continue;
    const arr = byContact.get(key) ?? [];
    arr.push(m);
    byContact.set(key, arr);
  }
  const awaitingReply: Array<{ contact: string; name: string | null; waitingHours: number }> = [];
  const silentConversations: Array<{ contact: string; name: string | null; lastOutboundAt: string }> = [];
  for (const [contact, msgs] of byContact) {
    msgs.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const last = msgs[msgs.length - 1];
    const hasInbound = msgs.some((m) => m.direction === "inbound");
    if (last.direction === "inbound") {
      awaitingReply.push({
        contact,
        name: last.contact_name ?? null,
        waitingHours: Math.round((now - new Date(last.created_at).getTime()) / 3_600_000),
      });
    } else if (!hasInbound && msgs.length >= 2) {
      silentConversations.push({ contact, name: last.contact_name ?? null, lastOutboundAt: last.created_at });
    }
  }
  // Deterministic importance: longest-waiting inbound conversations first —
  // waiting time is the signal, not "every unread is important".
  awaitingReply.sort((a, b) => b.waitingHours - a.waitingHours);

  return {
    isWbah,
    windowDays: 30,
    emails: {
      sent: sent.length,
      failed: failed.length,
      failedSample: failed.slice(0, 8).map((r) => ({ to: r.to_email, error: String(r.error ?? "").slice(0, 120), at: r.created_at, trigger: r.trigger })),
      suppressedRecipients,
    },
    followUps: {
      activeEnrollments: enrolls.length,
      failed: failedEnrollments.length,
      failedSample: failedEnrollments.slice(0, 5).map((e) => ({ campaignId: e.campaign_id, status: e.status, day: e.current_day, enrolledAt: e.enrolled_at })),
      zeroEngagement: zeroEngagement.length,
      stalled: stalled.length,
      stalledSample: stalled.slice(0, 8).map((e) => ({ campaignId: e.campaign_id, day: e.current_day, lastExecuted: e.last_executed, enrolledAt: e.enrolled_at })),
    },
    conversations: {
      awaitingReply: awaitingReply.slice(0, 10),
      awaitingReplyCount: awaitingReply.length,
      silentCount: silentConversations.length,
      silentSample: silentConversations.slice(0, 5),
    },
  };
}

// ── Signup / onboarding pipeline ──────────────────────────────────────────────

export async function getOnboardingPipeline(workspaceId: string) {
  const s30 = new Date(Date.now() - 30 * DAY).toISOString();

  const [obRes, wsOwnerRes, firstCampRes, firstCallRes] = await Promise.all([
    (supabaseAdmin as any)
      .from("workspace_onboarding")
      .select("path,completed,dismissed,business_dna_done,knowledge_uploaded,connections_done,first_agent_done,first_campaign_done,analysis_done,telephony_done,updated_at")
      .eq("workspace_id", workspaceId)
      .limit(10),
    (supabaseAdmin as any)
      .from("workspaces")
      .select("owner_id")
      .eq("id", workspaceId)
      .maybeSingle(),
    (supabaseAdmin as any)
      .from("call_campaigns")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId),
    (supabaseAdmin as any)
      .from("calls")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .gte("started_at", s30),
  ]);
  if (obRes.error) throw new Error(obRes.error.message);

  const obRows: any[] = obRes.data ?? [];
  const STEPS: Array<[string, string]> = [
    ["business_dna_done", "Business DNA"],
    ["knowledge_uploaded", "Knowledge upload"],
    ["connections_done", "Connections"],
    ["first_agent_done", "First agent"],
    ["first_campaign_done", "First campaign"],
    ["telephony_done", "Telephony"],
    ["analysis_done", "Analysis"],
  ];
  const members = obRows.map((r) => {
    const blocked = STEPS.filter(([k]) => !r[k]).map(([, label]) => label);
    return { path: r.path, completed: r.completed, dismissed: r.dismissed, blockedSteps: blocked, updatedAt: r.updated_at };
  });
  const incomplete = members.filter((m) => !m.completed && !m.dismissed);
  const blockedStepCounts: Record<string, number> = {};
  for (const m of incomplete) for (const s of m.blockedSteps) blockedStepCounts[s] = (blockedStepCounts[s] ?? 0) + 1;

  // Platform-wide signup pipeline (pending workspace_requests) is GLOBAL state —
  // only surface it inside a workspace whose OWNER is a platform admin; regular
  // tenants must never see platform-level signup counts.
  let pendingWorkspaceRequests: number | null = null;
  const ownerId = wsOwnerRes.error ? null : wsOwnerRes.data?.owner_id;
  if (ownerId) {
    const { data: ownerProfile } = await (supabaseAdmin as any)
      .from("profiles")
      .select("user_type")
      .eq("user_id", ownerId)
      .maybeSingle();
    if (ownerProfile?.user_type === "admin") {
      const { count, error } = await (supabaseAdmin as any)
        .from("workspace_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending");
      if (!error) pendingWorkspaceRequests = count ?? 0;
    }
  }

  return {
    checklists: members.length,
    incomplete: incomplete.length,
    blockedStepCounts,
    pendingWorkspaceRequests,
    hasFirstCampaign: !firstCampRes.error && (firstCampRes.count ?? 0) > 0,
    hasRecentCalls: !firstCallRes.error && (firstCallRes.count ?? 0) > 0,
  };
}

// ── Billing / commercial signals ──────────────────────────────────────────────

export async function getBillingSignals(workspaceId: string) {
  const now = new Date();
  const monthStr = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
  const monthStartIso = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [profileRes, costRes] = await Promise.all([
    (supabaseAdmin as any)
      .from("client_billing_profiles")
      .select("monthly_charge_cents,currency,status,billing_cycle,included_minutes,included_messages,included_email_sends,contract_end_date")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    (supabaseAdmin as any)
      .from("client_monthly_costs")
      .select("month,monthly_charge_cents,total_cost_cents,gross_profit_cents,gross_margin_percent")
      .eq("workspace_id", workspaceId)
      .eq("month", monthStr)
      .maybeSingle(),
  ]);

  const profile = profileRes.error ? null : profileRes.data;
  const cost = costRes.error ? null : costRes.data;
  if (!profile && !cost) return null; // no commercial data — block honestly absent

  // Paged month-to-date minute sum: a single capped fetch silently undercounts
  // high-volume workspaces and skews the overage/upsell flags, so page through
  // in 1000-row chunks (PostgREST cap) up to 10 pages and flag truncation.
  let minutesUsed = 0;
  let usageTruncated = false;
  for (let page = 0; page < 10; page++) {
    const { data: chunk, error } = await (supabaseAdmin as any)
      .from("usage_events")
      .select("minutes")
      .eq("workspace_id", workspaceId)
      .gte("occurred_at", monthStartIso)
      .order("occurred_at", { ascending: true })
      .order("id", { ascending: true })
      .range(page * 1000, page * 1000 + 999);
    if (error) break;
    const rows: any[] = chunk ?? [];
    minutesUsed += rows.reduce((s: number, r: any) => s + (Number(r.minutes) || 0), 0);
    if (rows.length < 1000) break;
    if (page === 9) usageTruncated = true;
  }
  const includedMinutes = Number(profile?.included_minutes ?? 0);
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const projectedMinutes = dayOfMonth > 0 ? Math.round((minutesUsed / dayOfMonth) * daysInMonth) : minutesUsed;

  const flags: string[] = [];
  if (cost && Number(cost.gross_profit_cents) < 0) flags.push("loss_making");
  else if (cost && Number(cost.gross_margin_percent) < 20) flags.push("low_margin");
  if (includedMinutes > 0 && minutesUsed > includedMinutes) flags.push("over_included_minutes");
  else if (includedMinutes > 0 && projectedMinutes > includedMinutes) flags.push("projected_overage");
  if (profile?.contract_end_date) {
    const days = Math.round((new Date(profile.contract_end_date).getTime() - now.getTime()) / DAY);
    if (days >= 0 && days <= 60) flags.push("renewal_due_soon");
    if (days < 0) flags.push("contract_expired");
  }
  if (includedMinutes > 0 && minutesUsed > includedMinutes * 0.8) flags.push("upsell_candidate");

  return {
    month: monthStr,
    plan: profile
      ? { chargeCents: profile.monthly_charge_cents, currency: profile.currency, status: profile.status, includedMinutes, contractEndDate: profile.contract_end_date }
      : null,
    currentMonth: cost
      ? { totalCostCents: cost.total_cost_cents, grossProfitCents: cost.gross_profit_cents, grossMarginPercent: cost.gross_margin_percent }
      : null,
    usage: { minutesUsed: Math.round(minutesUsed * 10) / 10, projectedMinutes, includedMinutes, usageTruncated },
    flags,
  };
}
