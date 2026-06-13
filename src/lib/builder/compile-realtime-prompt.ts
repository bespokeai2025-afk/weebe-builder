import type { Edge } from "@xyflow/react";
import type { FlowNode } from "./store";
import type { BuilderSettings, BuilderVariable } from "./types";

/**
 * Flatten the builder conversation-flow graph into a single system prompt for
 * OpenAI Realtime (HyperStream).
 *
 * Retell consumes the flow as a structured graph (nodes + edges + transitions).
 * OpenAI Realtime only accepts one free-text instruction string, so for test
 * calls we linearize the graph into a readable script: the global prompt, then
 * each reachable conversation step with its dialogue and the conditions that
 * lead to the next step.
 */
export function compileRealtimePrompt(
  nodes: FlowNode[],
  edges: Edge[],
  settings: BuilderSettings,
  variables: BuilderVariable[] = [],
): string {
  const sections: string[] = [];

  const agentName   = settings.agentName?.trim();
  const companyName = settings.companyName?.trim();
  const identity    = [agentName || "an AI voice agent", companyName ? `working for ${companyName}` : ""].filter(Boolean).join(", ");
  sections.push(`You are ${identity}. Speak naturally and conversationally.`);

  // Turn-taking rules are critical for OpenAI Realtime: without them the model
  // tends to read the whole script in one breath and talk over the caller.
  sections.push(
    [
      "# STRICT TURN-TAKING RULES — follow these before anything else",
      "- You speak ONE step per turn. After saying your line, you are DONE for that turn.",
      "- Every [WAIT FOR CALLER] marker means: output nothing further. Your response ends there.",
      "- Do NOT chain steps. Do NOT add transitions, summaries, or filler after your line.",
      "- After you speak, you MUST be completely silent until the caller speaks. No exceptions.",
      "- You will only generate your next response AFTER the caller has spoken.",
      "- If the script contains instruction text like 'pause and wait for user response', do NOT say those words — they are directions for you, not dialogue to speak aloud.",
      "- Keep each turn to 1–2 sentences. Never speak more than one step's worth of content.",
      "- Only advance to the next step when the caller's reply satisfies the transition condition.",
      "- Do not invent steps, filler questions, or content not in the script.",
    ].join("\n"),
  );

  const globalPrompt = settings.globalPrompt?.trim();
  if (globalPrompt) {
    sections.push(`# Overall instructions\n${globalPrompt}`);
  }

  // Inject Knowledge Base documents for HyperStream (no external KB retrieval available).
  const kbDocs = settings.kbDocuments ?? [];
  if (kbDocs.length > 0) {
    const kbInstruction = settings.kbConfig?.instruction?.trim();
    const kbParts: string[] = [];
    if (kbInstruction) kbParts.push(kbInstruction);
    for (const doc of kbDocs) {
      if (doc.type === "text" && doc.content) {
        kbParts.push(`## ${doc.name}\n${doc.content}`);
      } else if (doc.type === "url" && doc.url) {
        kbParts.push(`## ${doc.name || doc.url}\nSource URL: ${doc.url}\n(Refer to this URL for accurate information on the topic.)`);
      } else if (doc.type === "file" && doc.content) {
        kbParts.push(`## ${doc.name || doc.fileName || "Uploaded document"}\n${doc.content}`);
      }
    }
    if (kbParts.length > 0) {
      sections.push(`# Knowledge Base\nUse the following reference material to answer questions accurately:\n\n${kbParts.join("\n\n")}`);
    }
  }

  const beginMessage = settings.beginMessage?.trim();
  if (beginMessage) {
    sections.push(`# Greeting\nBegin the call by saying: "${beginMessage}"`);
  }

  const labelOf = (id: string | null | undefined) =>
    id ? (nodes.find((n) => n.id === id)?.data.label ?? id) : "the end of the call";

  // Order conversation steps starting from the start node, following edges
  // breadth-first so the script reads in conversation order.
  const convNodes = nodes.filter(
    (n) => n.data.kind === "conversation" && (n.data.dialogue?.trim() || n.data.label?.trim()),
  );
  const startNode =
    convNodes.find((n) => n.data.isStart) ?? convNodes[0] ?? nodes.find((n) => n.data.isStart);

  const reachable: FlowNode[] = [];
  const seen = new Set<string>();
  const queue: string[] = startNode ? [startNode.id] : [];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = nodes.find((n) => n.id === id);
    if (node && node.data.kind !== "note") reachable.push(node);
    const targets = [
      ...(node?.data.transitions ?? [])
        .map((t) => t.target)
        .filter((t): t is string => Boolean(t)),
      ...edges.filter((e) => e.source === id).map((e) => e.target),
    ];
    for (const t of targets) if (!seen.has(t)) queue.push(t);
  }
  // Nodes that exist in the flow but cannot be reached from the start node.
  // These are NOT part of the executable script — they're surfaced separately
  // so the model doesn't treat them as ordered steps.
  const unreachable = nodes.filter((n) => n.data.kind !== "note" && !seen.has(n.id));

  const transitionTextFor = (node: FlowNode) => {
    const transitions = [
      ...(node.data.transitions ?? []).map((t) => ({ condition: t.condition, target: t.target })),
      ...edges
        .filter((e) => e.source === node.id)
        .filter((e) => !(node.data.transitions ?? []).some((t) => t.target === e.target))
        .map((e) => ({ condition: "", target: e.target })),
    ];
    return transitions.length
      ? "\n" +
          transitions
            .map(
              (t) =>
                `  - If ${t.condition?.trim() || "the step is complete"}, go to "${labelOf(t.target)}".`,
            )
            .join("\n")
      : "";
  };

  // Retell uses sentinel strings in the dialogue field to mean "stay silent."
  // Filter them out so OpenAI doesn't read them aloud.
  const SILENT_SENTINELS = /^NO_RESPONSE_NEEDED$/i;

  // Phrases that node authors write as behavioral instructions but which must
  // never be spoken aloud. Strip them from the dialogue before rendering.
  // Matching is case-insensitive and trims surrounding punctuation/whitespace.
  const INSTRUCTION_PATTERNS: RegExp[] = [
    /[,.\s]*pause\s+and\s+wait\s+for\s+(user\s+)?response[,.\s]*/gi,
    /[,.\s]*wait\s+for\s+(the\s+)?(user'?s?\s+)?response[,.\s]*/gi,
    /[,.\s]*pause\s+here[,.\s]*/gi,
    /[,.\s]*\[?\s*wait\s+for\s+caller\s*\]?[,.\s]*/gi,
    /[,.\s]*listen\s+for\s+(the\s+)?caller[,.\s]*/gi,
    /[,.\s]*then\s+listen[,.\s]*/gi,
  ];

  function stripInstructionPhrases(text: string): string {
    let result = text;
    for (const pattern of INSTRUCTION_PATTERNS) {
      result = result.replace(pattern, " ");
    }
    return result.replace(/\s{2,}/g, " ").trim();
  }

  const renderNode = (node: FlowNode, headerPrefix: string): string | null => {
    const d = node.data;
    const transitionText = transitionTextFor(node);
    switch (d.kind) {
      case "conversation": {
        const rawDialogue = d.dialogue?.trim() ?? "";
        const isSilent = SILENT_SENTINELS.test(rawDialogue);
        // Strip any instruction-style directives before using as spoken text.
        const spokenDialogue = stripInstructionPhrases(rawDialogue);
        const body = isSilent || !spokenDialogue
          ? "Do NOT say anything here. Stay silent and wait for the caller's next input, then follow the transition below.\n[WAIT FOR CALLER]"
          : `${spokenDialogue}\n[WAIT FOR CALLER — you MUST be completely silent after saying the above until the caller speaks next]`;
        return `${headerPrefix} ${d.label || "Conversation"}\n${body}${transitionText}`;
      }
      case "function":
        return `${headerPrefix} ${d.label || d.toolName || "Run tool"}\nUse the "${d.toolName || d.toolId || "tool"}" tool${d.toolDescription ? ` (${d.toolDescription})` : ""}.${transitionText}`;
      case "call_transfer":
      case "agent_transfer":
        return `${headerPrefix} ${d.label || "Transfer"}\nTransfer the call when appropriate.${transitionText}`;
      case "sms":
        return `${headerPrefix} ${d.label || "Send SMS"}\nSend an SMS${d.smsMessage ? `: "${d.smsMessage}"` : ""}.${transitionText}`;
      case "extract_variable": {
        type RawVar = { name?: string; description?: string };
        const evItems = (d.extractVariables as RawVar[] | undefined);
        const varLines =
          evItems && evItems.length > 0
            ? evItems
                .map((v) =>
                  v.name
                    ? `- "${v.name}"${v.description ? ` — ${v.description}` : ""}`
                    : null,
                )
                .filter(Boolean)
                .join("\n")
            : `- "${d.variableName || "information"}"${d.variableDescription ? ` — ${d.variableDescription}` : ""}`;
        return `${headerPrefix} ${d.label || "Collect info"}\nCollect the following from the caller:\n${varLines}${transitionText}`;
      }
      case "logic_split":
        return `${headerPrefix} ${d.label || "Decision"}\nDecide which branch to follow based on the conversation so far.${transitionText || "\n  - (no branches defined)"}`;
      case "press_digit":
        return `${headerPrefix} ${d.label || "Wait for keypad input"}\nWait for the caller to press a digit, then continue.${transitionText}`;
      case "code":
        return `${headerPrefix} ${d.label || "Run logic"}\nRun the configured background logic, then continue.${transitionText}`;
      case "ending":
        return `${headerPrefix} ${d.label || "End call"}\n${d.endingPrompt?.trim() || d.dialogue?.trim() || "End the call politely."}`;
      default:
        return null;
    }
  };

  const mainSteps: string[] = [];
  let stepNum = 0;
  for (const node of reachable) {
    stepNum += 1;
    const rendered = renderNode(node, `## Step ${stepNum}:`);
    if (rendered) mainSteps.push(rendered);
    else stepNum -= 1;
  }

  if (mainSteps.length) {
    sections.push(
      `# Conversation script\nFollow these steps in order:\n\n${mainSteps.join("\n\n")}`,
    );
  }

  const otherSteps = unreachable
    .map((node) => renderNode(node, "##"))
    .filter((s): s is string => Boolean(s));
  if (otherSteps.length) {
    sections.push(
      `# Other steps (not connected to the main flow — only use if the conversation calls for them)\n\n${otherSteps.join("\n\n")}`,
    );
  }

  const namedVars = variables.filter((v) => v.name?.trim());
  if (namedVars.length) {
    sections.push(
      `# Information to collect\n${namedVars
        .map((v) => `- ${v.name}${v.description ? `: ${v.description}` : ""}`)
        .join("\n")}`,
    );
  }

  return sections.join("\n\n");
}
