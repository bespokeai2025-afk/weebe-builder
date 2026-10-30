/**
 * Builder test conversations — scripted caller lines replayed through the agent's flow before it
 * is published, with checks on what the agent did.
 *
 * Saved on the agent (settings.testConversations). Runs use the same graph engine as live calls
 * (shadow/replay.ts), text only: no audio, so a run costs the model calls and nothing else.
 */

export type TestConversationExpect = {
  /** Step (node id) the conversation must reach. */
  reachesNodeId?: string | null;
  /** The agent must end the call by the last line. */
  endsCall?: boolean;
  /** Phrases the agent must say at some point (case-insensitive). */
  mustSay?: string[];
  /** Phrases the agent must never say (case-insensitive). */
  mustNotSay?: string[];
};

export type TestConversation = {
  id: string;
  name: string;
  /** What the caller says, one line per turn. */
  callerTurns: string[];
  expect: TestConversationExpect;
};

export type TestConversationCheck = { label: string; ok: boolean; detail?: string };

export type TestConversationResult = {
  id: string;
  name: string;
  passed: boolean;
  checks: TestConversationCheck[];
  agentLines: string[];
  nodePath: string[];
  endReason: string | null;
  error: string | null;
};

/** Limits per run, so one click cannot spend unbounded model calls. */
export const MAX_TEST_CONVERSATIONS = 10;
export const MAX_CALLER_TURNS = 15;

export type ReplayOutcome = {
  agentLines: string[];
  nodePath: string[];
  endReason: string | null;
  errors: string[];
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Turn a replay into pass/fail checks. A replay error always fails the test. */
export function evaluateTestConversation(
  test: TestConversation,
  outcome: ReplayOutcome,
  nodeLabel: (id: string) => string = (id) => id,
): TestConversationResult {
  const said = norm(outcome.agentLines.join(" \n "));
  const checks: TestConversationCheck[] = [];
  const e = test.expect ?? {};

  if (e.reachesNodeId) {
    const ok = outcome.nodePath.includes(e.reachesNodeId);
    checks.push({
      label: `Reaches “${nodeLabel(e.reachesNodeId)}”`,
      ok,
      detail: ok ? undefined : `Path: ${outcome.nodePath.map(nodeLabel).join(" → ") || "(none)"}`,
    });
  }
  if (e.endsCall) {
    checks.push({
      label: "Ends the call",
      ok: outcome.endReason != null,
      detail: outcome.endReason ? undefined : "The call was still open after the last caller line",
    });
  }
  for (const phrase of (e.mustSay ?? []).map((p) => p.trim()).filter(Boolean)) {
    checks.push({ label: `Says “${phrase}”`, ok: said.includes(norm(phrase)) });
  }
  for (const phrase of (e.mustNotSay ?? []).map((p) => p.trim()).filter(Boolean)) {
    checks.push({ label: `Never says “${phrase}”`, ok: !said.includes(norm(phrase)) });
  }
  if (outcome.errors.length) {
    checks.push({ label: "Runs without errors", ok: false, detail: outcome.errors[0] });
  }

  return {
    id: test.id,
    name: test.name,
    passed: checks.every((c) => c.ok),
    checks,
    agentLines: outcome.agentLines,
    nodePath: outcome.nodePath,
    endReason: outcome.endReason,
    error: outcome.errors[0] ?? null,
  };
}

/** Keep only what can run: named, with caller lines, inside the per-run limits. */
export function normalizeTestConversations(tests: unknown): TestConversation[] {
  if (!Array.isArray(tests)) return [];
  return tests
    .filter((t): t is TestConversation => !!t && typeof t === "object" && typeof (t as TestConversation).id === "string")
    .map((t) => ({
      id: t.id,
      name: String(t.name ?? "").trim() || "Untitled test",
      callerTurns: (Array.isArray(t.callerTurns) ? t.callerTurns : [])
        .map((l) => String(l ?? "").trim())
        .filter(Boolean)
        .slice(0, MAX_CALLER_TURNS),
      expect: t.expect ?? {},
    }))
    .filter((t) => t.callerTurns.length > 0)
    .slice(0, MAX_TEST_CONVERSATIONS);
}

/** Caller lines from a pasted transcript ("User: …" / "Caller: …"), or every line if none are marked. */
export function callerLinesFromTranscript(text: string): string[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const marked = lines
    .map((l) => l.match(/^(?:user|caller|customer|lead)\s*:\s*(.+)$/i)?.[1]?.trim())
    .filter((l): l is string => Boolean(l));
  return (marked.length ? marked : lines).slice(0, MAX_CALLER_TURNS);
}
