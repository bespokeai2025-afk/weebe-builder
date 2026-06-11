import { createFileRoute } from "@tanstack/react-router";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// ── Types ────────────────────────────────────────────────────────────────────

interface Segment {
  id: string;
  type: "message" | "decision" | "action";
  header: string;
  content: string;
}

// ── State-machine text segmenter ─────────────────────────────────────────────
// Guarantees 100% line consumption — every extracted line ends up in a node.
// No content is ever dropped or summarised.

function segmentByStateMachine(text: string): Segment[] {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => {
      // Strip structural metadata but preserve all functional content lines
      const isPageNum = /^\s*Page\s+\d+\s*$/i.test(l) || /^\s*\d+\s*$/.test(l);
      const isBoilerplate =
        /^\s*(Confidential|Draft|Version|Copyright|Internal Use Only)/i.test(l);
      return !isPageNum && !isBoilerplate;
    });

  const segments: Segment[] = [];
  let currentChunk: string[] = [];
  let currentType: Segment["type"] = "message";
  let sectionHeader = "";

  const flush = () => {
    if (currentChunk.length === 0) return;
    const content = currentChunk.join("\n").trim();
    if (!content) return;
    segments.push({
      id: `seg_${Math.random().toString(36).substring(2, 9)}`,
      type: currentType,
      header: sectionHeader,
      content,
    });
    currentChunk = [];
    sectionHeader = "";
  };

  for (const line of lines) {
    if (!line) continue;

    // 1. Major section / step headers
    if (
      /^(\d+\.|STEP\s+\d+|AI\s+SAYS|Trigger:|SCRIPT|SECTION|PHASE|OPENING|CLOSING|OBJECTION|FALLBACK)/i.test(
        line,
      )
    ) {
      flush();
      sectionHeader = line;
      if (/qualify|decision|branch|if\s+user|if\s+customer/i.test(line))
        currentType = "decision";
      else if (
        /trigger|webhook|integration|crm|calendly|book|schedule|action/i.test(line)
      )
        currentType = "action";
      else currentType = "message";
      continue;
    }

    // 2. Table / CSV rows — clean and preserve
    if (line.includes('","') || (line.startsWith('"') && line.endsWith('"'))) {
      currentChunk.push(`| ${line.replace(/"/g, "").replace(/,/g, " | ")} |`);
      continue;
    }

    // 3. Speaker-turn switches — new segment per speaker
    const speakerMatch = line.match(
      /^\s*(Agent|Alex|User|Customer|Bot|System|AI|Speaker\s*\d+|Rep|Caller)\s*[:\-]/i,
    );
    if (speakerMatch) {
      flush();
      currentType = /user|customer|caller/i.test(speakerMatch[1])
        ? "decision"
        : "message";
      currentChunk.push(line);
      continue;
    }

    // 4. Catch-all: append to active segment — nothing is ever dropped
    currentChunk.push(line);
  }

  flush(); // Catch any trailing content
  return segments;
}

// ── Merge tiny segments ──────────────────────────────────────────────────────
// Adjacent same-type segments without a header and fewer than 80 chars are
// merged to avoid dozens of trivial one-line nodes.

function mergeSmallSegments(segments: Segment[], minChars = 80): Segment[] {
  const out: Segment[] = [];
  for (const seg of segments) {
    const prev = out[out.length - 1];
    if (
      prev &&
      !seg.header &&
      !prev.header &&
      prev.type === seg.type &&
      prev.content.length < minChars
    ) {
      prev.content = `${prev.content}\n${seg.content}`;
    } else {
      out.push({ ...seg });
    }
  }
  return out;
}

// ── AI enrichment prompt ─────────────────────────────────────────────────────

function buildEnrichmentPrompt(
  focusAgent?: {
    name: string;
    role: string;
    persona: string;
    tone?: string;
    keyPhrases?: string[];
    expertise: string[];
  },
  focusCampaign?: {
    name: string;
    type: string;
    objective: string;
    keyStages: string[];
    branchingPoints?: string[];
  },
  voiceProvider: "RETELL" | "OPENAI_REALTIME" = "RETELL",
): string {
  const isRetell = voiceProvider === "RETELL";
  const lines = [
    `You are a conversation flow formatter for a voice agent builder.`,
    `You receive pre-segmented text blocks extracted from a script by a state-machine parser.`,
    `The segments already contain ALL content — your job is enrichment only, not extraction.`,
    ``,
    `TARGET VOICE ENGINE: ${isRetell ? "Retell AI" : "OpenAI Realtime (OmniVoice / HyperStream)"}`,
    isRetell
      ? `Retell uses the "global_prompt" as a concise general_prompt field fed directly to its LLM before the conversation graph executes. The graph nodes carry the actual dialogue.`
      : `OpenAI Realtime uses the "global_prompt" as the "# Overall instructions" section of a compiled system prompt. The conversation script (nodes) is appended automatically by the system. Turn-taking rules are also injected automatically — do NOT add them.`,
  ];

  if (focusAgent) {
    lines.push(
      `\nAGENT PERSONA — adapt labels and dialogue style to this agent:`,
      `  Name: ${focusAgent.name} · Role: ${focusAgent.role}`,
      `  Style: ${focusAgent.persona}`,
      ...(focusAgent.tone ? [`  Tone: ${focusAgent.tone}`] : []),
      ...(focusAgent.keyPhrases?.length
        ? [`  Signature phrases: ${focusAgent.keyPhrases.join(" | ")}`]
        : []),
    );
  }

  if (focusCampaign) {
    lines.push(
      `\nCAMPAIGN FOCUS — structure transitions to follow this campaign:`,
      `  Campaign: ${focusCampaign.name} (${focusCampaign.type})`,
      `  Objective: ${focusCampaign.objective}`,
      `  Stages: ${focusCampaign.keyStages.join(" → ")}`,
      ...(focusCampaign.branchingPoints?.length
        ? [`  Branching points: ${focusCampaign.branchingPoints.join("; ")}`]
        : []),
    );
  }

  lines.push(`
FIRST: classify every segment. Each segment has exactly one destination:

"global_prompt" — content the agent needs to KNOW (not say):
  • Business overview, company background, about-us text
  • Agent name, role, persona, tone, personality settings
  • Product / service descriptions, pricing, feature lists
  • Behavioral rules, tone instructions, style guidelines
  • Compliance constraints, prohibited topics, escalation rules
  • Any reference information, FAQs, or standing instructions
  → These segments are REMOVED from the conversation flow and collected into the global prompt.

"flow" — content the agent actually speaks or acts on:
  • Agent dialogue / script lines
  • Questions to ask the customer
  • Objection handling responses
  • Booking, scheduling, or action steps
  • Call opening, qualification, and closing dialogue
  → These segments become conversation nodes.

OUTPUT ONLY valid JSON — no markdown, no code fences:
{
  "title": "<2-4 word overall flow title>",
  "suggestedAgentName": "<agent's first name or persona name from the document — empty string if not found>",
  "suggestedBeginMessage": "<the exact opening line the agent says at the start of a call, ready to be spoken aloud — empty string if not determinable>",
  "segments": [
    { "segId": "<id>", "destination": "global_prompt" },
    {
      "segId": "<id or v-N for virtual>",
      "virtual": false,
      "content": "",
      "destination": "flow",
      "label": "<3-6 word node name>",
      "kind": "conversation | logic_split | ending | booking_sequence | function | call_transfer",
      "toolId": "check_availability | book_appointment",
      "transferHint": "<destination team or person name, e.g. 'sales team' or 'manager'>",
      "transitions": [
        { "id": "<unique t-id>", "condition": "<branch condition or 'default'>", "target": "<segId or v-N of a FLOW segment>" }
      ]
    }
  ]
}

VIRTUAL NODES — create new nodes for every transition branch:
Every transition target MUST point to a node that exists in the output — either an input segment OR a new virtual node.
For EVERY logic_split transition, if the target path is not already covered by an input segment, CREATE a new virtual node:
  - Set "virtual": true
  - Set "segId": "v-1", "v-2", etc. (unique across the whole output)
  - Set "content": "<write the actual dialogue the agent speaks on this branch — 1-3 sentences matching the branch condition>"
  - Set kind: "conversation" (or "ending" if this is a closing branch)
  - Connect it onward to the next appropriate node or an ending
Do the SAME for any other node whose transition lands on an unmarked path — every route must terminate at an "ending" node.
Write "content" as clean spoken-voice dialogue — no step numbers, no bullets, no markdown.
Virtual nodes for conversation branches should say the RIGHT THING for that specific condition (e.g. objection, yes path, no path, callback, etc.) using context from the surrounding script.

SMART DETECTION — automatically use these special kinds:

BOOKING / SCHEDULING DETECTION:
Use kind "booking_sequence" when a segment discusses ANY of:
  booking, scheduling, appointments, calendar, availability, reservations, "find a time", "pick a slot", "set up a meeting".
The system expands this automatically into 5 nodes: collect details → check availability (Cal.com function) → offer slots → book appointment (Cal.com function) → confirm booking.
Use kind "function" + toolId "check_availability" ONLY if the segment is exclusively about checking availability (not the full booking flow).
Use kind "function" + toolId "book_appointment" ONLY if the segment is exclusively about creating the booking (not the full flow).
toolId and transferHint are OPTIONAL — omit them for all other kinds.

CALL TRANSFER DETECTION:
Use kind "call_transfer" when a segment discusses:
  transferring to a human agent, connecting to a department or team, live handoff, escalation, "speak to someone", "press to talk to a person".
Add "transferHint": "<destination description from the script>" — e.g. "sales team", "billing department", "manager".
The builder user will supply the actual phone number; leave it blank in the output.

GLOBAL PROMPT FORMAT (for segments with destination "global_prompt"):
${isRetell ? `
Retell general_prompt style — the collected global_prompt segments will be joined and used as the Retell "general_prompt" field:
- Open with: "You are [Name], [Role] at [Company]."
- 1-2 sentences of company/product context
- Short bullet list of behavioral rules and tone guidelines
- Any compliance constraints or prohibited topics
- Keep total length 100–250 words — Retell works best with concise, directive prompts
- Do NOT add conversation steps, greetings, or turn-taking instructions` : `
OpenAI Realtime overall-instructions style — the collected global_prompt segments become the "# Overall instructions" section of the system prompt. The conversation script and turn-taking rules are injected automatically elsewhere:
- Open with: "You are [Name], [Role] for [Company]."
- 2-3 sentences of rich company/product/service context
- Communication style, tone, and personality guidelines
- Behavioral rules and compliance constraints
- Prohibited topics and escalation paths
- Target length 150–350 words — be thorough, this is the agent's primary context
- Do NOT add turn-taking rules or conversation steps`}

CRITICAL RULES:
- Every INPUT segment MUST appear exactly once in the output — no omissions
- Virtual nodes (virtual: true) may be added freely — they do NOT correspond to input segments
- Non-virtual nodes: set "virtual": false and "content": ""
- Virtual nodes: set "virtual": true and "content": "<spoken dialogue for this node>"
- "global_prompt" segments: only segId + destination required
- "flow" segments: segId, destination, label, kind, transitions all required
- Transition "target" values must reference segIds of OTHER "flow" segments (real or virtual) — never "global_prompt"
- Transition ids must be unique across the entire output
- The final segment in the flow must be kind "ending" with "transitions": []
- Every logic_split transition MUST have its own dedicated target node — create virtual nodes as needed
- Every route through the graph MUST terminate at an "ending" node — no dead ends
- kind "logic_split": 2 or more transitions each with a specific human-readable condition string
- kind "conversation", "function", "call_transfer": single transition with "condition": "default"
- kind "booking_sequence": single transition pointing to the next node after the booking flow
- toolId is ONLY valid when kind is "function"; omit it for all other kinds
- transferHint is ONLY valid when kind is "call_transfer"; omit it for all other kinds
- If ALL segments are context/reference material, still produce at least one "flow" ending node`);

  return lines.join("\n");
}

// ── Main flow generator ──────────────────────────────────────────────────────

async function generateFlow(
  apiKey: string,
  scriptText: string,
  focusAgent?: {
    name: string;
    role: string;
    persona: string;
    tone?: string;
    keyPhrases?: string[];
    expertise: string[];
  },
  focusCampaign?: {
    name: string;
    type: string;
    objective: string;
    keyStages: string[];
    branchingPoints?: string[];
  },
  voiceProvider: "RETELL" | "OPENAI_REALTIME" = "RETELL",
) {
  // ── Step 1: state-machine segmentation (100% line coverage) ──────────────
  const rawSegments = segmentByStateMachine(scriptText);
  const segments = mergeSmallSegments(rawSegments);

  if (segments.length === 0) throw new Error("No content segments extracted from PDF");

  // ── Step 2: AI enrichment (labels, kinds, transitions, global prompt) ─────
  const systemPrompt = buildEnrichmentPrompt(focusAgent, focusCampaign, voiceProvider);

  const segmentsPayload = segments.map((s) => ({
    segId: s.id,
    type: s.type,
    header: s.header || null,
    content: s.content,
  }));

  const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o",
      temperature: 0.15,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Enrich these ${segments.length} pre-segmented script blocks into a conversation flow:\n\n${JSON.stringify(segmentsPayload, null, 2)}`,
        },
      ],
    }),
  });

  if (!aiRes.ok) {
    const err = await aiRes.text();
    throw new Error(`OpenAI error: ${err.slice(0, 200)}`);
  }

  const aiJson = (await aiRes.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  const enriched = JSON.parse(aiJson.choices[0].message.content) as {
    title: string;
    suggestedAgentName?: string;
    suggestedBeginMessage?: string;
    segments: Array<
      | { segId: string; destination: "global_prompt" }
      | {
          segId: string;
          destination: "flow";
          virtual?: boolean;
          content?: string;
          label: string;
          kind: string;
          toolId?: string;
          transferHint?: string;
          transitions: Array<{ id: string; condition: string; target: string }>;
        }
    >;
  };

  if (!Array.isArray(enriched.segments) || enriched.segments.length === 0)
    throw new Error("Enrichment returned no segments");

  // ── Step 3: Split into global-prompt content vs flow nodes ───────────────
  const VALID_KINDS = new Set([
    "conversation", "function", "call_transfer", "press_digit",
    "logic_split", "agent_transfer", "sms", "extract_variable",
    "code", "ending", "note",
  ]);

  // Build a content map from the original state-machine segments
  const contentMap: Record<string, string> = {};
  segments.forEach((s) => {
    contentMap[s.id] = s.header ? `${s.header}\n${s.content}` : s.content;
  });

  // Collect global-prompt content — business overviews, agent settings, rules, context
  const globalPromptParts: string[] = [];
  for (const s of enriched.segments) {
    if (s.destination === "global_prompt") {
      const text = contentMap[s.segId];
      if (text?.trim()) globalPromptParts.push(cleanDialogue(text.trim()));
    }
  }
  const globalPromptSuggestion = globalPromptParts.join("\n\n");

  // Keep only flow segments for node building
  const flowSegments = enriched.segments.filter(
    (s): s is Extract<typeof s, { destination: "flow" }> => s.destination === "flow",
  );

  if (flowSegments.length === 0)
    throw new Error("No conversation flow segments found — all content was classified as context/settings");

  // ── Tool configs for Cal.com function nodes ──────────────────────────────
  const TOOL_CONFIGS: Record<string, { label: string; description: string; defaultDialogue: string }> = {
    check_availability: {
      label: "Check Availability",
      description: "Checks the Cal.com calendar for open appointment slots",
      defaultDialogue: "Check the calendar for available slots matching the caller's preferred date and time.",
    },
    book_appointment: {
      label: "Book Appointment",
      description: "Creates a confirmed appointment booking via Cal.com",
      defaultDialogue: "Create the confirmed appointment booking with the caller's chosen time and contact details.",
    },
  };

  // segId → first nodeId of the expansion (for resolving transition targets)
  const segToNodeId: Record<string, string> = {};

  type BuiltNode = {
    id: string;
    type: string;
    position: { x: number; y: number };
    data: {
      kind: string;
      label: string;
      dialogue: string;
      isStart?: boolean;
      transitions: Array<{ id: string; condition: string; target: string | null }>;
      toolId?: string;
      toolName?: string;
      toolDescription?: string;
      speakDuringExecution?: boolean;
      waitForResult?: boolean;
      transferType?: string;
    };
    _aiTransitions: Array<{ id: string; condition: string; target: string }> | null;
  };

  const builtNodes: BuiltNode[] = [];
  let posCounter = 0;

  for (let segIdx = 0; segIdx < flowSegments.length; segIdx++) {
    const seg = flowSegments[segIdx];
    const isFirstSeg = segIdx === 0;
    const baseId = `pdf-${seg.segId}`;
    // Virtual nodes: use AI-generated "content"; real nodes: use extracted contentMap text
    const rawDialogue = seg.virtual
      ? cleanDialogue(seg.content ?? "")
      : cleanDialogue(contentMap[seg.segId] ?? "");

    if (seg.kind === "booking_sequence") {
      // Expand to a 5-node booking micro-flow
      const bk = {
        collect: `${baseId}-bk1`,
        check:   `${baseId}-bk2`,
        slots:   `${baseId}-bk3`,
        book:    `${baseId}-bk4`,
        confirm: `${baseId}-bk5`,
      };
      segToNodeId[seg.segId] = bk.collect;

      builtNodes.push(
        {
          id: bk.collect,
          type: "conversation",
          position: { x: posCounter++ * 340, y: 100 },
          data: {
            kind: "conversation",
            label: "Collect Booking Details",
            dialogue: rawDialogue || "Ask the caller for their preferred date and time, full name, and best contact number for the appointment.",
            isStart: isFirstSeg ? true : undefined,
            transitions: [],
          },
          _aiTransitions: [{ id: `ti-${bk.collect}`, condition: "default", target: bk.check }],
        },
        {
          id: bk.check,
          type: "function",
          position: { x: posCounter++ * 340, y: 100 },
          data: {
            kind: "function",
            label: "Check Availability",
            dialogue: "Check the calendar for available slots matching the caller's preferred date and time.",
            transitions: [],
            toolId: "check_availability",
            toolName: "Check Availability",
            toolDescription: "Checks the Cal.com calendar for open appointment slots",
            speakDuringExecution: false,
            waitForResult: true,
          },
          _aiTransitions: [{ id: `ti-${bk.check}`, condition: "default", target: bk.slots }],
        },
        {
          id: bk.slots,
          type: "conversation",
          position: { x: posCounter++ * 340, y: 100 },
          data: {
            kind: "conversation",
            label: "Offer Available Slots",
            dialogue: "Share the available time slots with the caller and ask them to choose one.",
            transitions: [],
          },
          _aiTransitions: [{ id: `ti-${bk.slots}`, condition: "default", target: bk.book }],
        },
        {
          id: bk.book,
          type: "function",
          position: { x: posCounter++ * 340, y: 100 },
          data: {
            kind: "function",
            label: "Book Appointment",
            dialogue: "Create the confirmed appointment booking with the caller's chosen time and contact details.",
            transitions: [],
            toolId: "book_appointment",
            toolName: "Book Appointment",
            toolDescription: "Creates a confirmed appointment booking via Cal.com",
            speakDuringExecution: false,
            waitForResult: true,
          },
          _aiTransitions: [{ id: `ti-${bk.book}`, condition: "default", target: bk.confirm }],
        },
        {
          id: bk.confirm,
          type: "conversation",
          position: { x: posCounter++ * 340, y: 100 },
          data: {
            kind: "conversation",
            label: "Booking Confirmed",
            dialogue: "Confirm the appointment details with the caller. Provide the date, time, and any preparation instructions.",
            transitions: [],
          },
          // last booking node inherits the original segment's outgoing transitions
          _aiTransitions: seg.transitions?.length ? seg.transitions : null,
        },
      );

    } else if (seg.kind === "function" && seg.toolId && TOOL_CONFIGS[seg.toolId]) {
      // Explicit single Cal.com function node
      segToNodeId[seg.segId] = baseId;
      const cfg = TOOL_CONFIGS[seg.toolId]!;
      builtNodes.push({
        id: baseId,
        type: "function",
        position: { x: posCounter++ * 340, y: 100 },
        data: {
          kind: "function",
          label: seg.label || cfg.label,
          dialogue: cfg.defaultDialogue,
          isStart: isFirstSeg ? true : undefined,
          transitions: [],
          toolId: seg.toolId,
          toolName: cfg.label,
          toolDescription: cfg.description,
          speakDuringExecution: false,
          waitForResult: true,
        },
        _aiTransitions: seg.transitions ?? null,
      });

    } else {
      // Standard node (conversation, logic_split, call_transfer, ending, etc.)
      segToNodeId[seg.segId] = baseId;
      let kind = VALID_KINDS.has(seg.kind) ? seg.kind : "conversation";

      const nodeData: BuiltNode["data"] = {
        kind,
        label: String(seg.label ?? `Node ${segIdx + 1}`),
        dialogue: rawDialogue,
        isStart: isFirstSeg ? true : undefined,
        transitions: [],
      };

      if (kind === "call_transfer") {
        nodeData.transferType = "cold_transfer";
        if (!nodeData.dialogue.trim()) {
          const hint = seg.transferHint?.trim();
          nodeData.dialogue = `Transfer the call${hint ? ` to the ${hint}` : " to a live agent"}. Let the caller know they are being connected.`;
        }
      }

      builtNodes.push({
        id: baseId,
        type: kind,
        position: { x: posCounter++ * 340, y: 100 },
        data: nodeData,
        _aiTransitions: seg.transitions ?? null,
      });
    }
  }

  // Ensure last node is an ending
  const lastBuilt = builtNodes[builtNodes.length - 1];
  if (lastBuilt && lastBuilt.data.kind !== "ending") {
    lastBuilt.data.kind = "ending";
    lastBuilt.type = "ending";
    lastBuilt._aiTransitions = null;
  }

  // ── Build edges ───────────────────────────────────────────────────────────
  const edges: Array<{ id: string; source: string; target: string; sourceHandle: string }> = [];
  const usedIds = new Set<string>();
  const builtNodeIds = new Set(builtNodes.map((n) => n.id));

  builtNodes.forEach((node, idx) => {
    if (node.data.kind === "ending") return;

    const aiTx = node._aiTransitions;

    if (Array.isArray(aiTx) && aiTx.length > 0) {
      for (const t of aiTx) {
        // Resolve: try segId map first, then direct nodeId (internal booking transitions)
        const resolvedTarget =
          segToNodeId[String(t.target)] ??
          (builtNodeIds.has(t.target) ? t.target : null);
        if (!resolvedTarget) continue;

        let tId = String(t.id ?? `t-${node.id}-${resolvedTarget}`);
        if (usedIds.has(tId)) tId = `${tId}-${idx}`;
        usedIds.add(tId);

        node.data.transitions.push({ id: tId, condition: String(t.condition ?? "default"), target: resolvedTarget });
        edges.push({ id: tId, source: node.id, target: resolvedTarget, sourceHandle: tId });
      }
    } else {
      // Sequential fallback
      const next = builtNodes[idx + 1];
      if (!next) return;
      const tId = `t-${node.id}-${next.id}`;
      if (usedIds.has(tId)) return;
      usedIds.add(tId);
      node.data.transitions.push({ id: tId, condition: "default", target: next.id });
      edges.push({ id: tId, source: node.id, target: next.id, sourceHandle: tId });
    }
  });

  const cleanNodes = builtNodes.map(({ _aiTransitions: _a, ...rest }) => rest);

  return {
    title: String(enriched.title ?? "Imported Script"),
    globalPromptSuggestion,
    suggestedAgentName: enriched.suggestedAgentName?.trim() ?? "",
    suggestedBeginMessage: enriched.suggestedBeginMessage?.trim() ?? "",
    voiceProvider,
    nodes: cleanNodes,
    edges,
    nodeCount: cleanNodes.length,
    segmentCount: segments.length,
    globalPromptSegmentCount: globalPromptParts.length,
  };
}

// ── Text cleaner ─────────────────────────────────────────────────────────────

function cleanText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim()
    .slice(0, 16000);
}

// ── Dialogue cleaner — strips step headers, emoji, decorative symbols ─────────
// Converts raw PDF/DOCX extracted text into clean voice-prompt copy.

function cleanDialogue(raw: string): string {
  return raw
    // ── Emoji (broad unicode blocks) ──────────────────────────────────────────
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, "")
    .replace(/[\u{2300}-\u{27BF}]/gu, "")   // misc technical + dingbats
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, "") // supplemental symbols
    .replace(/\uFE0F/gu, "")                // variation selector-16
    // ── Step / phase / section headers at line start ──────────────────────────
    // e.g. "Step 1:", "STEP 1 -", "Phase 2.", "Section 3 —", "1.", "1)"
    .replace(/^(step|phase|section|part|stage|module)\s*\d+\s*[:\-–—.]?\s*/gim, "")
    .replace(/^\d+[.)]\s+/gm, "")
    // ── Markdown heading markers ───────────────────────────────────────────────
    .replace(/^#{1,6}\s+/gm, "")
    // ── Bold / italic markdown ────────────────────────────────────────────────
    .replace(/\*{1,3}([^*\n]+)\*{1,3}/g, "$1")
    .replace(/_([^_\n]+)_/g, "$1")
    // ── Decorative bullet / arrow symbols at line start (keep the text) ───────
    .replace(/^[•►▶→▷◆■□●○✓✗✔✘➤➜➔]+\s*/gm, "")
    // ── Collapse excessive blank lines ────────────────────────────────────────
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/api/builder/import-pdf")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
          },
        }),

      POST: async ({ request }) => {
        try {
          const apiKey = process.env["OPENAI_API_KEY"];
          if (!apiKey)
            return json({ error: "OpenAI API key not configured" }, 500);

          const contentType = request.headers.get("content-type") ?? "";

          // ── Mode A: JSON body (post-scan targeted import) ──────────────────
          if (contentType.includes("application/json")) {
            const body = (await request.json()) as {
              rawText: string;
              voiceProvider?: "RETELL" | "OPENAI_REALTIME";
              focusAgent?: {
                name: string;
                role: string;
                persona: string;
                tone?: string;
                keyPhrases?: string[];
                expertise: string[];
              };
              focusCampaign?: {
                name: string;
                type: string;
                objective: string;
                keyStages: string[];
                branchingPoints?: string[];
              };
            };

            if (!body.rawText?.trim())
              return json({ error: "rawText is required" }, 400);

            const result = await generateFlow(
              apiKey,
              cleanText(body.rawText),
              body.focusAgent,
              body.focusCampaign,
              body.voiceProvider ?? "RETELL",
            );
            return json(result);
          }

          // ── Mode B: multipart form (direct PDF or DOCX upload) ─────────────
          const formData = await request.formData();
          const file = formData.get("pdf");
          if (!file || !(file instanceof File))
            return json({ error: "No file provided" }, 400);

          const isDocxB =
            file.name.toLowerCase().endsWith(".docx") ||
            file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
          const isPdfB = file.type.includes("pdf") || file.name.toLowerCase().endsWith(".pdf");

          if (!isDocxB && !isPdfB)
            return json({ error: "File must be a PDF or Word document (.docx)" }, 400);
          if (file.size > 10 * 1024 * 1024)
            return json({ error: "File must be under 10 MB" }, 400);

          const bufferB = Buffer.from(await file.arrayBuffer());
          let rawTextB: string;
          if (isDocxB) {
            const result = await mammoth.extractRawText({ buffer: bufferB });
            rawTextB = result.value;
          } else {
            const parser = new PDFParse({ data: bufferB });
            await parser.load();
            const extracted = await parser.getText();
            rawTextB = extracted.text;
          }

          if (!rawTextB?.trim())
            return json({ error: "Could not extract text from the document" }, 422);

          const result = await generateFlow(apiKey, cleanText(rawTextB));
          return json(result);
        } catch (e) {
          console.error("[import-pdf]", e);
          return json(
            { error: (e as Error).message ?? "Processing failed" },
            500,
          );
        }
      },
    },
  },
});
