/**
 * Shared AI call summary text for Dynamics timeline annotations.
 */

function pickStr(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return null;
}

/** Prefer Retell detailed summary, then short call_summary from custom or analysis. */
export function resolveWbahCallSummaryText(
  custom: Record<string, unknown>,
  analysis?: Record<string, unknown> | null,
): string | null {
  return (
    pickStr(custom, "detailed_call_summary", "call_summary") ||
    pickStr(analysis ?? {}, "detailed_call_summary", "call_summary") ||
    null
  );
}

export function buildWbahAiTimelineNoteText(input: {
  label: string;
  callId?: string | null;
  userSentiment?: string | null;
  callSummary?: string | null;
  transcript?: string | null;
}): string {
  const header = [
    input.label,
    input.callId ? `call_id=${input.callId}` : null,
    input.userSentiment ? `sentiment=${input.userSentiment}` : null,
  ]
    .filter(Boolean)
    .join(" — ");

  const summary = input.callSummary?.trim() || "No summary";
  let body = `${header}\n\n${summary}`;

  const transcript = input.transcript?.trim();
  if (transcript) {
    const excerpt = transcript.length > 2000 ? `…${transcript.slice(-2000)}` : transcript;
    body += `\n\nTranscript:\n${excerpt}`;
  }

  return body.slice(0, 100_000);
}
