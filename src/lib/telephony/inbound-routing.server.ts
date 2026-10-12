/**
 * Server side of per-number inbound routing: verifying Twilio's signature against the account that
 * actually owns the number, calling the number's inbound webhook, and resolving agent overrides.
 *
 * Signature verification. Twilio signs each webhook with the auth token of the account that owns
 * the number. Numbers here live in different accounts — a workspace's own Twilio account (Settings →
 * Providers → Telephony), the platform account from the environment, or a WEBEE-managed subaccount
 * (numbers bought through the Numbers page). The request is accepted only if its signature matches
 * one of those accounts' tokens. It is never accepted unverified, and nothing is created on the call
 * path: a subaccount is only read if it already exists.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadWorkspaceTwilioCredentials, resolveTwilioCredentialsFromEnv } from "./twilio-credentials.server";
import {
  buildInboundWebhookPayload,
  parseInboundWebhookResponse,
  type InboundWebhookDecision,
} from "./number-routing.shared";

type DbClient = Pick<SupabaseClient, "from"> | { from: (table: string) => any };

/**
 * Verify a Twilio request signature.
 * https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
export function verifyTwilioSignature(
  authToken: string,
  twilioSignature: string | null,
  url: string,
  params: Record<string, string>,
): boolean {
  if (!twilioSignature || !authToken) return false;
  const sortedKeys = Object.keys(params).sort();
  const data = sortedKeys.reduce((acc, k) => acc + k + params[k], url);
  const expected = createHmac("sha1", authToken).update(data).digest("base64");
  const a = Buffer.from(twilioSignature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Auth tokens of every Twilio account a workspace's numbers can live in: an existing WEBEE
 * subaccount, the workspace's own account, then the platform account. Read-only.
 */
export async function candidateTwilioAuthTokens(
  sb: DbClient,
  workspaceId: string,
): Promise<string[]> {
  const tokens: string[] = [];
  try {
    const { data } = await sb
      .from("workspace_twilio_subaccounts")
      .select("twilio_subaccount_auth_token, status")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const token = String(data?.twilio_subaccount_auth_token ?? "").trim();
    if (token && (data?.status ?? "active") === "active") tokens.push(token);
  } catch {
    /* table missing or unreadable — fall through to the other accounts */
  }
  try {
    const ws = await loadWorkspaceTwilioCredentials(sb, workspaceId);
    if (ws?.authToken) tokens.push(ws.authToken);
  } catch {
    /* ignore */
  }
  const env = resolveTwilioCredentialsFromEnv();
  if (env?.authToken) tokens.push(env.authToken);
  return [...new Set(tokens)];
}

/** The URL Twilio signed: the public scheme and host it called, plus the path. */
export function signedUrlFor(request: Request, path: string): string {
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const host = request.headers.get("host") ?? "";
  const query = new URL(request.url, "http://local").search;
  return `${proto}://${host}${path}${query}`;
}

export type SignatureCheck =
  | { ok: true }
  | { ok: false; reason: "credentials_unavailable" | "invalid_signature" };

/** Fails closed: no known account, or no account whose token produced this signature. */
export async function verifyTwilioRequestForWorkspace(
  sb: DbClient,
  workspaceId: string,
  request: Request,
  path: string,
  params: Record<string, string>,
  candidates: (sb: DbClient, workspaceId: string) => Promise<string[]> = candidateTwilioAuthTokens,
): Promise<SignatureCheck> {
  const tokens = await candidates(sb, workspaceId).catch(() => [] as string[]);
  if (tokens.length === 0) return { ok: false, reason: "credentials_unavailable" };
  const signature = request.headers.get("X-Twilio-Signature");
  const url = signedUrlFor(request, path);
  return tokens.some((t) => verifyTwilioSignature(t, signature, url, params))
    ? { ok: true }
    : { ok: false, reason: "invalid_signature" };
}

// ── Inbound webhook ──────────────────────────────────────────────────────────

/** Twilio waits 15 s for our TwiML; two 4 s attempts leave room for the rest of the route. */
const WEBHOOK_TIMEOUT_MS = 4_000;
const WEBHOOK_ATTEMPTS = 2;

/**
 * POST the Retell-format `call_inbound` payload and read the decision. Null when every attempt
 * fails — the caller then routes to the number's own agent, as Retell does.
 */
export async function callInboundWebhook(
  url: string,
  args: { callId: string; agentId: string | null; fromNumber: string; toNumber: string },
  fetchImpl: typeof fetch = fetch,
): Promise<InboundWebhookDecision | null> {
  const body = JSON.stringify(buildInboundWebhookPayload(args));
  for (let attempt = 0; attempt < WEBHOOK_ATTEMPTS; attempt++) {
    try {
      const res = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "User-Agent": "WEBEE-Voice/1.0" },
        body,
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const text = await res.text();
      return parseInboundWebhookResponse(text ? JSON.parse(text) : {});
    } catch {
      /* timeout, network error or invalid JSON — retry, then give up */
    }
  }
  return null;
}

/**
 * Map a webhook's `override_agent_id` to an agent in this workspace. Accepts the WEBEE agent id, or
 * a Retell agent id belonging to one of the workspace's agents (so a webhook written for Retell
 * keeps working). Anything else is ignored — a webhook can never route a call to another workspace.
 */
export async function resolveOverrideAgent(
  sb: DbClient,
  workspaceId: string,
  overrideId: string,
): Promise<string | null> {
  const id = overrideId.trim();
  if (!id) return null;
  if (/^[0-9a-f-]{36}$/i.test(id)) {
    const { data } = await sb
      .from("agents")
      .select("id")
      .eq("id", id)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    return (data?.id as string | undefined) ?? null;
  }
  const { data } = await sb
    .from("agents")
    .select("id, retell_agent_id, settings")
    .eq("workspace_id", workspaceId);
  const match = ((data ?? []) as Array<{ id: string; retell_agent_id: string | null; settings: unknown }>).find(
    (a) =>
      a.retell_agent_id === id ||
      (a.settings as { deployedRetellAgentId?: string } | null)?.deployedRetellAgentId === id,
  );
  return match?.id ?? null;
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
