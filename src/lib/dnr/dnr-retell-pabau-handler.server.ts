/**
 * Shared auth + context for DNR Retell → Pabau custom tools.
 */
import { verifyRetellSignatureMultiKey } from "@/lib/calendar/retell-signature";
import { resolveRetellCandidateKeysByAgent } from "@/lib/calendar/retell-key-lookup";
import { DNR_RETELL_AGENT_ID, getDnrRetellApiKey } from "@/lib/dnr/dnr-voice.config";
import {
  getPabauClientConfigForWorkspace,
  resolveWorkspaceIdForRetellAgent,
} from "@/lib/dnr/dnr-pabau-credentials.server";
import { logReceptionistToolEvent } from "@/lib/dnr/dnr-receptionist-audit.server";
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

function parseAgentId(rawBody: string): string | undefined {
  try {
    const quick = JSON.parse(rawBody) as Record<string, unknown>;
    const args = (quick.args ?? {}) as Record<string, unknown>;
    const call = (quick.call ?? {}) as Record<string, unknown>;
    return (
      (args.agent_id as string) ??
      (call.agent_id as string) ??
      (quick.agent_id as string) ??
      undefined
    );
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

const RETELL_SIGNATURE_VERIFICATION_DISABLED =
  process.env.RETELL_SIGNATURE_VERIFICATION_ENABLED !== "true";

export async function authorizeDnrPabauTool(
  rawBody: string,
  request: Request,
): Promise<{ ok: true; ctx: DnrPabauToolContext } | { ok: false; response: Response }> {
  const agentId = parseAgentId(rawBody) ?? DNR_RETELL_AGENT_ID;
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
        hint: "SystemMind → CRM Connections → Pabau",
      }, 503),
    };
  }
  let args: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(rawBody) as Record<string, unknown>;
    args = (parsed.args ?? parsed) as Record<string, unknown>;
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
}
