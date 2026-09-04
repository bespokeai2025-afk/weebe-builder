/**
 * Shared auth + context for DNR Retell → Pabau custom tools.
 */
import { verifyRetellSignatureMultiKey } from "@/lib/calendar/retell-signature";
import { resolveRetellCandidateKeysByAgent } from "@/lib/calendar/retell-key-lookup";
import { getDnrRetellApiKey } from "@/lib/dnr/dnr-voice.config";
import {
  getPabauClientConfigForWorkspace,
  parseDnrRetellAgentId,
  resolveWorkspaceIdForRetellAgent,
} from "@/lib/dnr/dnr-pabau-credentials.server";
import { logReceptionistToolEvent } from "@/lib/dnr/dnr-receptionist-audit.server";
import { normalizeRetellPayload } from "@/lib/calendar/retell-payload";
import type { PabauClientConfig } from "@/lib/pabau/pabau-receptionist.server";

export const DNR_PABAU_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-retell-signature",
};

export function dnrPabauJson(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...DNR_PABAU_CORS, "Content-Type": "application/json" },
  });
}

function parseRetellCallId(rawBody: string): string | undefined {
  try {
    const quick = JSON.parse(rawBody) as Record<string, unknown>;
    const call = (quick.call ?? {}) as Record<string, unknown>;
    const id = call.call_id ?? quick.call_id;
    return typeof id === "string" && id.trim() ? id.trim() : undefined;
  } catch {
    return undefined;
  }
}

export type DnrPabauToolContext = {
  agentId: string;
  workspaceId: string;
  retellCallId?: string;
  pabau: PabauClientConfig;
  args: Record<string, unknown>;
};

// Secure by default: signature verification is ALWAYS on unless explicitly
// disabled for local development — and the dev opt-out is ignored in production.
const RETELL_SIGNATURE_VERIFICATION_DISABLED =
  process.env.RETELL_SIGNATURE_VERIFICATION_ENABLED === "false" &&
  process.env.NODE_ENV !== "production";

export async function authorizeDnrPabauTool(
  rawBody: string,
  request: Request,
): Promise<{ ok: true; ctx: DnrPabauToolContext } | { ok: false; response: Response }> {
  const agentId = parseDnrRetellAgentId(rawBody);
  const keys = await resolveRetellCandidateKeysByAgent(agentId);
  const dnrKey = getDnrRetellApiKey();
  const sig = request.headers.get("x-retell-signature");
  if (!RETELL_SIGNATURE_VERIFICATION_DISABLED) {
    if (
      !verifyRetellSignatureMultiKey(rawBody, sig, keys, {
        prependKeys: dnrKey ? [dnrKey] : [],
        skipPlatformKey: Boolean(process.env.RETELL_API_KEY_DNR?.trim()),
      })
    ) {
      console.warn("[dnr-pabau] invalid signature", {
        agentId,
        hasSig: Boolean(sig),
        keyCount: keys.length,
        hasDnrKey: Boolean(dnrKey),
      });
      return {
        ok: false,
        response: dnrPabauJson(
          {
            error: "invalid signature",
            hint:
              "Set RETELL_API_KEY_DNR in .env to the Retell account that owns this agent. Run: node scripts/verify-dnr-retell-key.mjs",
          },
          401,
        ),
      };
    }
  } else {
    console.log("[dnr-pabau] signature validation skipped (dev mode)");
  }
  const workspaceId = await resolveWorkspaceIdForRetellAgent(agentId);
  if (!workspaceId) {
    return {
      ok: false,
      response: dnrPabauJson({
        error: "agent not linked to WEBEE workspace",
        hint: "Run: node scripts/link-dnr-retell-agent.mjs",
        agent_id: agentId,
      }, 404),
    };
  }
  const pabau = await getPabauClientConfigForWorkspace(workspaceId);
  if (!pabau) {
    return {
      ok: false,
      response: dnrPabauJson({
        error: "Pabau not connected for this workspace",
        hint: "Pabau is saved in SystemMind but this host could not read the API key. Re-test the CRM connection, or set PABAU_API_KEY on the server.",
        workspace_id: workspaceId,
      }, 503),
    };
  }
  let args: Record<string, unknown> = {};
  try {
    const flat = normalizeRetellPayload(rawBody);
    const { call, name, args: nestedArgs, ...rest } = flat;
    void call;
    void name;
    void nestedArgs;
    args = rest;
    delete args.retell_call_id;
  } catch {
    return { ok: false, response: dnrPabauJson({ error: "invalid json" }, 400) };
  }
  return { ok: true, ctx: { agentId, workspaceId, retellCallId: parseRetellCallId(rawBody), pabau, args } };
}

export async function handleDnrPabauPost(
  request: Request,
  toolName: string,
  handler: (ctx: DnrPabauToolContext) => Promise<Response>,
) {
  const rawBody = await request.text();
  try {
    const auth = await authorizeDnrPabauTool(rawBody, request);
    if (!auth.ok) return auth.response;
    const response = await handler(auth.ctx);
    try {
      const clone = response.clone();
      const responseBody = await clone.json().catch(() => ({}));
      void logReceptionistToolEvent({
        workspaceId: auth.ctx.workspaceId,
        toolName,
        rawBody,
        requestArgs: auth.ctx.args,
        responseStatus: response.status,
        responseBody,
      });
    } catch {
      /* non-fatal */
    }
    return response;
  } catch (e) {
    console.error(`[dnr-pabau] ${toolName} unhandled error`, e);
    return dnrPabauJson(
      {
        error: "internal server error",
        tool: toolName,
        hint: "Check dev server logs for [dnr-pabau]. Retry after server restart.",
        detail: e instanceof Error ? e.message : String(e),
      },
      500,
    );
  }
}
