/**
 * HexMail Deliverability & Domain Warming — server functions
 * Handles DNS checks, domain management, mailbox management,
 * warmup plans, reputation tracking, and the pre-send safety gate.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { promises as dns } from "dns";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ── Types ─────────────────────────────────────────────────────────────────────

export type DnsStatus = "pass" | "fail" | "warning" | "missing" | "unknown";

export interface DnsCheckResult {
  spf:     { status: DnsStatus; record: string | null; message: string };
  dkim:    { status: DnsStatus; record: string | null; message: string };
  dmarc:   { status: DnsStatus; record: string | null; message: string };
  mx:      { status: DnsStatus; records: string[];     message: string };
}

export interface DomainHealthScore {
  score:      number;  // 0–100
  grade:      "A" | "B" | "C" | "D" | "F";
  breakdown:  Record<string, number>;
  warnings:   string[];
}

export interface SendGateResult {
  allowed:      boolean;
  warnings:     string[];
  blockReasons: string[];
}

// ── DNS helpers (server-side only) ────────────────────────────────────────────

async function lookupTxt(host: string): Promise<string[]> {
  try {
    const records = await dns.resolveTxt(host);
    return records.flat();
  } catch {
    return [];
  }
}

async function lookupMx(host: string): Promise<string[]> {
  try {
    const records = await dns.resolveMx(host);
    return records.map((r) => r.exchange);
  } catch {
    return [];
  }
}

async function checkDns(domain: string, dkimSelector?: string | null): Promise<DnsCheckResult> {
  const [txtRecords, dmarc, mx] = await Promise.all([
    lookupTxt(domain),
    lookupTxt(`_dmarc.${domain}`),
    lookupMx(domain),
  ]);

  // SPF
  const spfRecord = txtRecords.find((r) => r.startsWith("v=spf1")) ?? null;
  const spf = spfRecord
    ? { status: "pass" as DnsStatus, record: spfRecord, message: "SPF record found and valid" }
    : { status: "missing" as DnsStatus, record: null, message: "No SPF record found. Add a TXT record: v=spf1 include:yourmailprovider.com ~all" };

  // DKIM
  let dkimResult: DnsCheckResult["dkim"] = { status: "unknown", record: null, message: "DKIM selector not configured — enter your selector to verify" };
  if (dkimSelector) {
    const selectors = [dkimSelector, ...["default", "google", "mail", "resend"].filter((s) => s !== dkimSelector)];
    let found: { selector: string; record: string } | null = null;
    for (const sel of selectors.slice(0, 3)) {
      const dkimRecords = await lookupTxt(`${sel}._domainkey.${domain}`);
      const rec = dkimRecords.find((r) => r.includes("v=DKIM1") || r.includes("k=rsa") || r.includes("p="));
      if (rec) { found = { selector: sel, record: rec }; break; }
    }
    dkimResult = found
      ? { status: "pass", record: found.record, message: `DKIM record found for selector "${found.selector}"` }
      : { status: "missing", record: null, message: `No DKIM record found for selector "${dkimSelector}". Check that selector._domainkey.${domain} has a TXT record.` };
  }

  // DMARC
  const dmarcRecord = dmarc.find((r) => r.startsWith("v=DMARC1")) ?? null;
  let dmarcStatus: DnsStatus = "missing";
  let dmarcMsg = `No DMARC record found. Add a TXT record at _dmarc.${domain}: v=DMARC1; p=quarantine; rua=mailto:dmarc@${domain}`;
  if (dmarcRecord) {
    const policy = dmarcRecord.match(/p=(\w+)/)?.[1] ?? "none";
    if (policy === "none") {
      dmarcStatus = "warning";
      dmarcMsg = `DMARC found but policy is "none" — consider upgrading to p=quarantine or p=reject`;
    } else {
      dmarcStatus = "pass";
      dmarcMsg = `DMARC record found (policy: ${policy})`;
    }
  }

  // MX
  const mxStatus: DnsStatus = mx.length > 0 ? "pass" : "missing";

  return {
    spf,
    dkim: dkimResult,
    dmarc: { status: dmarcStatus, record: dmarcRecord, message: dmarcMsg },
    mx:   { status: mxStatus, records: mx, message: mx.length > 0 ? `${mx.length} MX record(s) found` : `No MX records found for ${domain}` },
  };
}

function computeHealthScore(domain: {
  spf_status: string; dkim_status: string; dmarc_status: string; mx_status: string;
}): DomainHealthScore {
  const breakdown: Record<string, number> = {
    spf:   domain.spf_status   === "pass" ? 30 : 0,
    dkim:  domain.dkim_status  === "pass" ? 30 : 0,
    dmarc: domain.dmarc_status === "pass" ? 25 : domain.dmarc_status === "warning" ? 10 : 0,
    mx:    domain.mx_status    === "pass" ? 15 : 0,
  };
  const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
  const warnings: string[] = [];
  if (domain.spf_status   !== "pass") warnings.push("SPF record missing or invalid");
  if (domain.dkim_status  !== "pass") warnings.push("DKIM record not verified");
  if (domain.dmarc_status === "missing") warnings.push("DMARC policy missing");
  if (domain.dmarc_status === "warning") warnings.push("DMARC policy set to 'none' — limited protection");
  if (domain.mx_status    !== "pass") warnings.push("No MX records found");
  const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 55 ? "C" : score >= 35 ? "D" : "F";
  return { score, grade, breakdown, warnings };
}

// Compute warmup daily targets schedule
function buildWarmupSchedule(
  startingVolume: number,
  targetVolume: number,
  incrementType: string,
  incrementValue: number,
  totalDays = 56,
): number[] {
  const targets: number[] = [];
  let current = startingVolume;
  for (let day = 1; day <= totalDays; day++) {
    targets.push(Math.min(Math.round(current), targetVolume));
    if (current >= targetVolume) continue;
    if (incrementType === "weekly_double") {
      if (day % 7 === 0) current = Math.min(current * 2, targetVolume);
    } else if (incrementType === "weekly_fixed") {
      if (day % 7 === 0) current = Math.min(current + incrementValue, targetVolume);
    } else {
      current = Math.min(current + (incrementValue || 5), targetVolume);
    }
  }
  return targets;
}

// ── Server functions ──────────────────────────────────────────────────────────

// Get deliverability dashboard (aggregated)
export const getDeliverabilityDashboard = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const [domainsRes, mailboxesRes, plansRes, reputationRes] = await Promise.all([
      sb.from("email_sender_domains").select("*").eq("workspace_id", workspaceId).order("created_at"),
      sb.from("email_mailboxes").select("*").eq("workspace_id", workspaceId).order("created_at"),
      sb.from("email_warmup_plans").select("*").eq("workspace_id", workspaceId).order("created_at"),
      sb.from("email_reputation_events").select("event_type,severity,created_at")
        .eq("workspace_id", workspaceId)
        .gte("created_at", new Date(Date.now() - 30 * 86400_000).toISOString())
        .order("created_at", { ascending: false })
        .limit(200),
    ]);

    const domains  = domainsRes.data  ?? [];
    const mailboxes = mailboxesRes.data ?? [];
    const plans    = plansRes.data    ?? [];
    const events   = reputationRes.data ?? [];

    const bounces    = events.filter((e: any) => e.event_type === "bounce").length;
    const complaints = events.filter((e: any) => e.event_type === "complaint").length;
    const totalEvents = events.length;

    const domainHealthScores = domains.map((d: any) => computeHealthScore(d));
    const avgHealthScore = domainHealthScores.length
      ? Math.round(domainHealthScores.reduce((a: number, b: DomainHealthScore) => a + b.score, 0) / domainHealthScores.length)
      : 0;

    const sendsToday = mailboxes.reduce((sum: number, m: any) => sum + (m.sends_today ?? 0), 0);
    const sendAllowance = mailboxes.reduce((sum: number, m: any) => sum + (m.daily_send_limit ?? 0), 0);

    const activePlans = plans.filter((p: any) => p.status === "active").length;

    return {
      domains,
      mailboxes,
      plans,
      stats: {
        totalDomains:    domains.length,
        activeDomains:   domains.filter((d: any) => d.status === "active").length,
        totalMailboxes:  mailboxes.length,
        activePlans,
        sendsToday,
        sendAllowance,
        bounceCount:     bounces,
        complaintCount:  complaints,
        bounceRate:      totalEvents > 0 ? +(bounces / totalEvents * 100).toFixed(2) : 0,
        complaintRate:   totalEvents > 0 ? +(complaints / totalEvents * 100).toFixed(2) : 0,
        avgHealthScore,
        recentEvents:    events.slice(0, 10),
        warnings:        domainHealthScores.flatMap((s: DomainHealthScore) => s.warnings),
      },
    };
  });

// Get sender domains
export const getSenderDomains = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { data, error } = await sb
      .from("email_sender_domains")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at");
    if (error) throw error;
    return (data ?? []).map((d: any) => ({ ...d, healthScore: computeHealthScore(d) }));
  });

// Add sender domain
export const addSenderDomain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({
    domain:        z.string().min(3),
    provider:      z.string().default("resend"),
    dkimSelector:  z.string().optional(),
  }))
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const domain = data.domain.toLowerCase().trim().replace(/^https?:\/\//, "");

    const dnsResult = await checkDns(domain, data.dkimSelector);

    const { data: row, error } = await sb.from("email_sender_domains").insert({
      workspace_id:    workspaceId,
      domain,
      provider:        data.provider,
      dkim_selector:   data.dkimSelector ?? null,
      spf_status:      dnsResult.spf.status,
      dkim_status:     dnsResult.dkim.status,
      dmarc_status:    dnsResult.dmarc.status,
      mx_status:       dnsResult.mx.status,
      spf_record:      dnsResult.spf.record,
      dkim_record:     dnsResult.dkim.record,
      dmarc_record:    dnsResult.dmarc.record,
      mx_records:      dnsResult.mx.records,
      dns_checked_at:  new Date().toISOString(),
      tracking_domain_status: "unknown",
      status:          dnsResult.mx.status === "pass" ? "pending" : "pending",
    }).select().single();

    if (error?.code === "23505") throw new Error(`Domain "${domain}" is already registered in this workspace.`);
    if (error) throw error;

    await sb.from("email_deliverability_checks").insert({
      workspace_id: workspaceId,
      domain_id:    row.id,
      check_type:   "full",
      status:       [dnsResult.spf.status, dnsResult.dkim.status, dnsResult.dmarc.status, dnsResult.mx.status].every((s) => s === "pass") ? "pass" : "warning",
      details:      dnsResult,
    });

    return { domain: row, dns: dnsResult, healthScore: computeHealthScore(row) };
  });

// Re-check DNS for a domain
export const recheckDomainDns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ domainId: z.string().uuid() }))
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data: dom } = await sb.from("email_sender_domains")
      .select("*").eq("id", data.domainId).eq("workspace_id", workspaceId).single();
    if (!dom) throw new Error("Domain not found");

    const dnsResult = await checkDns(dom.domain, dom.dkim_selector);

    const allPass = ["pass"].every((s) =>
      [dnsResult.spf.status, dnsResult.dmarc.status, dnsResult.mx.status].includes(s)
    );

    await sb.from("email_sender_domains").update({
      spf_status:     dnsResult.spf.status,
      dkim_status:    dnsResult.dkim.status,
      dmarc_status:   dnsResult.dmarc.status,
      mx_status:      dnsResult.mx.status,
      spf_record:     dnsResult.spf.record,
      dkim_record:    dnsResult.dkim.record,
      dmarc_record:   dnsResult.dmarc.record,
      mx_records:     dnsResult.mx.records,
      dns_checked_at: new Date().toISOString(),
      status:         allPass ? "active" : dom.status,
      updated_at:     new Date().toISOString(),
    }).eq("id", data.domainId);

    await sb.from("email_deliverability_checks").insert({
      workspace_id: workspaceId,
      domain_id:    data.domainId,
      check_type:   "full",
      status:       allPass ? "pass" : "warning",
      details:      dnsResult,
    });

    return { dns: dnsResult };
  });

// Update domain DKIM selector
export const updateDkimSelector = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ domainId: z.string().uuid(), selector: z.string().min(1) }))
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    await sb.from("email_sender_domains")
      .update({ dkim_selector: data.selector, updated_at: new Date().toISOString() })
      .eq("id", data.domainId).eq("workspace_id", workspaceId);
    return { ok: true };
  });

// Delete sender domain
export const deleteSenderDomain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ domainId: z.string().uuid() }))
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    await sb.from("email_sender_domains").delete()
      .eq("id", data.domainId).eq("workspace_id", workspaceId);
    return { ok: true };
  });

// Get mailboxes
export const getMailboxes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { data, error } = await sb
      .from("email_mailboxes")
      .select("*, email_sender_domains(domain, status, spf_status, dkim_status, dmarc_status)")
      .eq("workspace_id", workspaceId)
      .order("created_at");
    if (error) throw error;
    return data ?? [];
  });

// Add mailbox
export const addMailbox = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({
    domainId:       z.string().uuid(),
    emailAddress:   z.string().email(),
    dailySendLimit: z.number().int().min(1).max(10000).default(50),
  }))
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { data: row, error } = await sb.from("email_mailboxes").insert({
      workspace_id:    workspaceId,
      domain_id:       data.domainId,
      email_address:   data.emailAddress.toLowerCase(),
      daily_send_limit: data.dailySendLimit,
      status:          "pending",
      warmup_stage:    0,
    }).select().single();
    if (error?.code === "23505") throw new Error(`Mailbox "${data.emailAddress}" already exists.`);
    if (error) throw error;
    return row;
  });

// Update mailbox status / limits
export const updateMailbox = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({
    mailboxId:      z.string().uuid(),
    status:         z.string().optional(),
    dailySendLimit: z.number().int().min(1).max(10000).optional(),
    warmupStage:    z.number().int().min(0).max(10).optional(),
  }))
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.status         !== undefined) patch.status = data.status;
    if (data.dailySendLimit !== undefined) patch.daily_send_limit = data.dailySendLimit;
    if (data.warmupStage    !== undefined) patch.warmup_stage = data.warmupStage;
    await sb.from("email_mailboxes").update(patch)
      .eq("id", data.mailboxId).eq("workspace_id", workspaceId);
    return { ok: true };
  });

// Delete mailbox
export const deleteMailbox = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ mailboxId: z.string().uuid() }))
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    await sb.from("email_mailboxes").delete()
      .eq("id", data.mailboxId).eq("workspace_id", workspaceId);
    return { ok: true };
  });

// Get warmup plans
export const getWarmupPlans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { data, error } = await sb
      .from("email_warmup_plans")
      .select("*, email_mailboxes(email_address), email_sender_domains(domain)")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

// Create warmup plan
export const createWarmupPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({
    domainId:             z.string().uuid(),
    mailboxId:            z.string().uuid(),
    name:                 z.string().min(1),
    startDate:            z.string(),
    startingDailyVolume:  z.number().int().min(1).default(5),
    targetDailyVolume:    z.number().int().min(10).default(200),
    incrementType:        z.enum(["weekly_double", "weekly_fixed", "daily_fixed"]).default("weekly_double"),
    incrementValue:       z.number().int().min(0).default(0),
  }))
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");

    const { data: plan, error } = await sb.from("email_warmup_plans").insert({
      workspace_id:          workspaceId,
      domain_id:             data.domainId,
      mailbox_id:            data.mailboxId,
      name:                  data.name,
      start_date:            data.startDate,
      starting_daily_volume: data.startingDailyVolume,
      target_daily_volume:   data.targetDailyVolume,
      increment_type:        data.incrementType,
      increment_value:       data.incrementValue,
      status:                "active",
      current_day:           0,
    }).select().single();
    if (error) throw error;

    // Pre-generate daily target rows
    const schedule = buildWarmupSchedule(
      data.startingDailyVolume, data.targetDailyVolume, data.incrementType, data.incrementValue
    );
    const targetRows = schedule.map((target, i) => ({
      workspace_id:   workspaceId,
      warmup_plan_id: plan.id,
      day_number:     i + 1,
      target_send_count: target,
    }));
    await sb.from("email_warmup_daily_targets").insert(targetRows);

    // Update mailbox status
    await sb.from("email_mailboxes").update({
      status: "warming", daily_send_limit: data.startingDailyVolume, warmup_stage: 1, updated_at: new Date().toISOString()
    }).eq("id", data.mailboxId);

    return plan;
  });

// Pause / resume / cancel warmup plan
export const updateWarmupPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({
    planId: z.string().uuid(),
    status: z.enum(["active", "paused", "cancelled"]),
  }))
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    await sb.from("email_warmup_plans").update({
      status: data.status, updated_at: new Date().toISOString()
    }).eq("id", data.planId).eq("workspace_id", workspaceId);
    return { ok: true };
  });

// Get warmup daily targets for a plan
export const getWarmupProgress = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ planId: z.string().uuid() }))
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { data: rows, error } = await sb
      .from("email_warmup_daily_targets")
      .select("*")
      .eq("warmup_plan_id", data.planId)
      .eq("workspace_id", workspaceId)
      .order("day_number");
    if (error) throw error;
    return rows ?? [];
  });

// Get reputation events
export const getReputationEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) throw new Error("No workspace");
    const { data, error } = await sb
      .from("email_reputation_events")
      .select("*, email_sender_domains(domain), email_mailboxes(email_address)")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return data ?? [];
  });

// Pre-send safety gate — checks if a sender email is safe to send from
export const checkSendGate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ senderEmail: z.string().email() }))
  .handler(async ({ context, data }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) return { allowed: true, warnings: [], blockReasons: [] };

    const emailDomain = data.senderEmail.split("@")[1];

    const [domainRes, mailboxRes] = await Promise.all([
      sb.from("email_sender_domains")
        .select("*").eq("workspace_id", workspaceId).eq("domain", emailDomain).maybeSingle(),
      sb.from("email_mailboxes")
        .select("*").eq("workspace_id", workspaceId).eq("email_address", data.senderEmail.toLowerCase()).maybeSingle(),
    ]);

    const domain  = domainRes.data;
    const mailbox = mailboxRes.data;

    const blockReasons: string[] = [];
    const warnings:     string[] = [];

    if (domain) {
      if (domain.status === "paused")    blockReasons.push("Sender domain is paused");
      if (domain.status === "suspended") blockReasons.push("Sender domain is suspended");
      if (domain.spf_status   === "fail")    blockReasons.push("SPF check fails for this domain");
      if (domain.dkim_status  === "fail")    blockReasons.push("DKIM check fails for this domain");
      if (domain.dmarc_status === "missing") warnings.push("DMARC policy is missing — emails may land in spam");
    }

    if (mailbox) {
      if (mailbox.status === "paused" || mailbox.status === "suspended") {
        blockReasons.push(`Mailbox "${data.senderEmail}" is ${mailbox.status}`);
      }
      if (mailbox.sends_today >= mailbox.daily_send_limit) {
        blockReasons.push(`Daily send limit reached for ${data.senderEmail} (${mailbox.sends_today}/${mailbox.daily_send_limit})`);
      } else if (mailbox.sends_today >= mailbox.daily_send_limit * 0.8) {
        warnings.push(`Approaching daily limit for ${data.senderEmail} (${mailbox.sends_today}/${mailbox.daily_send_limit} sent today)`);
      }
    }

    return { allowed: blockReasons.length === 0, warnings, blockReasons } as SendGateResult;
  });

// GrowthMind — Email Readiness Score
export const getEmailReadinessScore = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const workspaceId = context.workspaceId;
    if (!workspaceId) return { score: 0, grade: "F", issues: ["No workspace"], recommendations: [] };

    const [domainsRes, mailboxesRes, eventsRes] = await Promise.all([
      sb.from("email_sender_domains").select("*").eq("workspace_id", workspaceId),
      sb.from("email_mailboxes").select("*").eq("workspace_id", workspaceId),
      sb.from("email_reputation_events").select("event_type,severity")
        .eq("workspace_id", workspaceId)
        .gte("created_at", new Date(Date.now() - 30 * 86400_000).toISOString()),
    ]);

    const domains   = domainsRes.data  ?? [];
    const mailboxes = mailboxesRes.data ?? [];
    const events    = eventsRes.data   ?? [];

    const issues: string[] = [];
    const recommendations: string[] = [];

    if (domains.length === 0) {
      return {
        score: 0, grade: "F",
        issues: ["No sender domain configured"],
        recommendations: ["Add a verified sender domain in HexMail → Deliverability"],
      };
    }

    const topDomain = domains[0];
    const health = computeHealthScore(topDomain);
    let score = health.score;

    // Bonus for active mailboxes
    const activeMailboxes = mailboxes.filter((m: any) => m.status === "active" || m.status === "warming").length;
    if (activeMailboxes > 0) score = Math.min(score + 10, 100);

    // Penalty for recent bounces/complaints
    const bounces    = events.filter((e: any) => e.event_type === "bounce").length;
    const complaints = events.filter((e: any) => e.event_type === "complaint").length;
    if (bounces > 10)    { score = Math.max(score - 20, 0); issues.push(`${bounces} bounces in last 30 days`); }
    if (complaints > 2)  { score = Math.max(score - 25, 0); issues.push(`${complaints} complaints in last 30 days`); }

    issues.push(...health.warnings);

    if (health.warnings.length > 0) {
      recommendations.push("Fix DNS records in HexMail → Sender Domains");
    }
    if (activeMailboxes === 0) {
      recommendations.push("Set up a warmup plan for your mailboxes before sending bulk email");
    }
    if (score < 60) {
      recommendations.push("Consider starting with WhatsApp or AI Calling while domain reputation is being established");
    }

    const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 55 ? "C" : score >= 35 ? "D" : "F";
    return { score, grade, issues, recommendations, domainCount: domains.length, mailboxCount: mailboxes.length };
  });

// ── Exported helper for other server modules (no auth) ────────────────────────

export async function getEmailReadinessForWorkspace(workspaceId: string) {
  const sb = supabaseAdmin as any;
  const [domainsRes, mailboxesRes] = await Promise.all([
    sb.from("email_sender_domains").select("*").eq("workspace_id", workspaceId),
    sb.from("email_mailboxes").select("*").eq("workspace_id", workspaceId),
  ]);
  const domains   = domainsRes.data  ?? [];
  const mailboxes = mailboxesRes.data ?? [];
  if (domains.length === 0) return null;
  const health = computeHealthScore(domains[0]);
  const score  = Math.min(health.score + (mailboxes.some((m: any) => m.status === "active") ? 10 : 0), 100);
  return { score, grade: score >= 90 ? "A" : score >= 75 ? "B" : score >= 55 ? "C" : "D", issues: health.warnings };
}
