/**
 * Whether a caller's reply is worth understanding at all.
 *
 * Used to skip a wasted extraction call on a plain ack/greeting/question — never used to guess
 * which single field a reply belongs to. That used to be regex keyword matching against a node's
 * instruction text (`inferCollectVariableName` + `FIELD_HINTS`), which is what stored a multi-fact
 * correction verbatim into one field and kept failing to "catch properly" no matter how many more
 * keyword patterns got added to it. Field understanding is now genuine LLM extraction — see
 * `ConversationVm.extractTurnVariables` in `vm.ts`.
 */
export function shouldCaptureCollectAnswer(userText: string): boolean {
  const t = userText.trim();
  if (!t || t.length < 2) return false;
  if (/^(yes|yeah|yep|yup|no|nope|nah|ok|okay|oke|sure|hello|hi|hey|what|huh|pardon)\.?$/i.test(t)) {
    return false;
  }
  if (/\?/.test(t) || /^(who|what|why|how|when|where)\b/i.test(t)) return false;
  return true;
}
