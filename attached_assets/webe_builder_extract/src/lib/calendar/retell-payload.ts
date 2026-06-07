/**
 * Normalize an incoming Retell custom-function webhook body.
 *
 * Retell sends `{ name, args, call }` for general_tools. The agent_id lives on
 * `call.agent_id`; the LLM-provided arguments live under `args`. We flatten
 * those into a single object so each endpoint can validate with one schema.
 */
export function normalizeRetellPayload(raw: string): Record<string, unknown> {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  } catch {
    return {};
  }
  const args = (parsed.args as Record<string, unknown> | undefined) ?? {};
  const call = (parsed.call as Record<string, unknown> | undefined) ?? {};
  const callId = (call.call_id as string | undefined) ?? (parsed.call_id as string | undefined);
  const agentId =
    (args.agent_id as string | undefined) ??
    (call.agent_id as string | undefined) ??
    (parsed.agent_id as string | undefined);
  return {
    ...parsed,
    ...args,
    agent_id: agentId,
    retell_call_id: callId,
  };
}
