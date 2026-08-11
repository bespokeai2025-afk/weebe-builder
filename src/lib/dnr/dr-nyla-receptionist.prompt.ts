/**
 * Dr Nyla receptionist — Retell script (re-exports from dnr-voice.config).
 * Agent: agent_b2afcd65c127f79126ea57deb2
 */
export {
  DNR_RETELL_AGENT_ID,
  DNR_VOICE,
  DNR_RETELL_AGENT_SCRIPT,
  buildDnrRetellGeneralPrompt,
  dnrPublicToolUrl,
} from "./dnr-voice.config";

import { buildDnrRetellGeneralPrompt, DNR_VOICE } from "./dnr-voice.config";

export const DR_NYLA_RECEPTIONIST_BEGIN_MESSAGE = DNR_VOICE.beginMessage;

/** Use PUBLIC_BASE_URL when generating prompt for Retell dashboard. */
export function getDrNylaRetellPrompt(publicBaseUrl: string) {
  return {
    agent_id: "agent_b2afcd65c127f79126ea57deb2",
    agent_name: DNR_VOICE.agentDisplayName,
    begin_message: DNR_VOICE.beginMessage,
    general_prompt: buildDnrRetellGeneralPrompt(publicBaseUrl),
    webhook_path: DNR_VOICE.webhookPath,
    tools: DNR_VOICE.tools,
  };
}
