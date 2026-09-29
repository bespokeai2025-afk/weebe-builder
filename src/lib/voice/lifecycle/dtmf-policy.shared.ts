/**
 * `allowUserDtmf` / `allowDtmfInterruption` — whether keypad input is accepted at all, and
 * whether it may cut off the agent mid-sentence the way voice barge-in does.
 *
 * The graph VM already accepts a digit at any node (not just a dedicated press_digit node,
 * `graph/vm.ts`'s "digit" case checks the current node's own edges), which is correct — the gap
 * was that these two agent-level toggles were never actually consulted, so a caller could always
 * press digits and always interrupt with them regardless of what the agent had configured.
 *
 * Default is permissive (both undefined -> allowed) — an unset builder toggle should not silently
 * take away a capability the caller previously had.
 *
 * Relative imports only — reachable from the voice gateway bundle.
 */

export function shouldAcceptDtmf(
  settings: Record<string, unknown> | null | undefined,
  agentSpeaking: boolean,
): boolean {
  if (settings?.allowUserDtmf === false) return false;
  if (agentSpeaking && settings?.allowDtmfInterruption === false) return false;
  return true;
}
