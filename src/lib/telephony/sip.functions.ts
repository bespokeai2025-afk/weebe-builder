import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  importSipPhoneNumberService,
  resolveAgentIdForWorkspace,
} from "@/lib/builder/retell-telephony.server";
import { saveAgentPhoneNumberService } from "@/lib/agents/agent-golive.server";

function deployedId(row: { settings: unknown; retell_agent_id: string | null }) {
  const settings = (row.settings ?? {}) as Record<string, unknown>;
  if (settings.voiceProvider === "OPENAI_REALTIME" || settings.deploymentMode === "WEBEE_NATIVE")
    return null;
  const id = settings.deployedRetellAgentId ?? row.retell_agent_id;
  return typeof id === "string" && id.startsWith("agent_") ? id : null;
}

// Return labels only; never send agent settings or production credentials to the form.
export const listSipAgents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (!context.workspaceId) throw new Error("No active workspace");
    const { data, error } = await context.supabase
      .from("agents")
      .select("id, name, settings, retell_agent_id")
      .eq("workspace_id", context.workspaceId)
      .order("name");
    if (error) throw new Error("Could not load SIP-compatible agents.");
    return (data ?? [])
      .filter((row) => deployedId(row))
      .map((row) => ({ id: row.id, name: row.name }));
  });

export const connectWorkspaceSipNumber = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        phoneNumber: z
          .string()
          .trim()
          .regex(/^\+[1-9]\d{6,14}$/, "Use international format, e.g. +14155550100"),
        terminationUri: z
          .string()
          .trim()
          .min(1)
          .max(255)
          .refine(
            (value) => !/\s|https?:\/\//i.test(value),
            "Enter your carrier SIP address, not an HTTP URL",
          ),
        sipUsername: z.string().trim().max(255).optional(),
        sipPassword: z.string().max(1024).optional(),
        nickname: z.string().trim().max(100),
        agentId: z.string().uuid(),
        direction: z.enum(["inbound", "outbound", "both"]),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    const { workspaceId, supabase, userId } = context;
    if (!workspaceId) throw new Error("No active workspace");
    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("id, settings, retell_agent_id")
      .eq("id", data.agentId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (agentError || !agent) throw new Error("Agent not found in this workspace.");
    const agentId = deployedId(agent);
    if (!agentId || !(await resolveAgentIdForWorkspace(agentId, agent.id, workspaceId))) {
      throw new Error(
        "Deploy this OmniVoice agent to the production workspace before importing a SIP number.",
      );
    }
    const { data: existing, error: readError } = await supabase
      .from("phone_numbers")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("phone_number", data.phoneNumber)
      .limit(1);
    if (readError) throw new Error("Could not check the phone number directory. Try again.");
    if (existing?.length)
      throw new Error("This number already exists in your workspace. No changes were made.");
    try {
      await importSipPhoneNumberService({
        userId,
        workspaceId,
        agentRowId: agent.id,
        phoneNumber: data.phoneNumber,
        terminationUri: data.terminationUri,
        sipUsername: data.sipUsername || undefined,
        sipPassword: data.sipPassword || undefined,
        nickname: data.nickname,
        inboundAgentId: data.direction !== "outbound" ? agentId : undefined,
        outboundAgentId: data.direction !== "inbound" ? agentId : undefined,
      });
    } catch {
      // Provider error bodies may echo submitted credentials. Do not return them.
      throw new Error(
        "Import was not confirmed. Check the provider's number list before retrying, then verify the SIP details and production credentials.",
      );
    }
    const { data: saved, error: saveError } = await supabase
      .from("phone_numbers")
      .insert({
        workspace_id: workspaceId,
        phone_number: data.phoneNumber,
        friendly_name: data.nickname || null,
        provider: "retell_sip",
        agent_id: agent.id,
        capabilities: { voice: true, sms: false },
      })
      .select("id")
      .single();
    if (saveError || !saved) {
      return {
        id: null,
        warning:
          "Imported into Retell, but the workspace directory could not be updated. Do not import again; ask an administrator to reconcile the number.",
        phoneNumber: data.phoneNumber,
      };
    }
    let warning: string | null = null;
    try {
      await saveAgentPhoneNumberService({ supabase, id: agent.id, phoneNumber: data.phoneNumber });
    } catch {
      warning =
        "Number imported and listed, but the agent's saved phone setting could not be updated. Review agent deployment settings before going live.";
    }
    return { id: saved.id, warning, phoneNumber: data.phoneNumber };
  });
