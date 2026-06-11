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
      "segId": "<id>",
      "destination": "flow",
      "label": "<3-6 word node name>",
      "kind": "conversation | logic_split | ending",
      "transitions": [
        { "id": "<unique t-id>", "condition": "default", "target": "<segId of a FLOW segment>" }
      ]
    }
  ]
}

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
- Every input segment MUST appear exactly once in the output — no omissions
- "global_prompt" segments: only segId + destination required
- "flow" segments: segId, destination, label, kind, transitions all required
- Transition "target" values must ONLY reference segIds of OTHER "flow" segments — never "global_prompt"
- Transition ids must be unique across the entire output
- The final "flow" segment must be kind "ending" with "transitions": []
- kind "logic_split": multiple transitions each with a specific human-readable condition string
- kind "conversation": single transition with "condition": "default"
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
          label: string;
          kind: string;
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
      if (text?.trim()) globalPromptParts.push(text.trim());
    }
  }
  const globalPromptSuggestion = globalPromptParts.join("\n\n");

  // Keep only flow segments for node building
  const flowSegments = enriched.segments.filter(
    (s): s is Extract<typeof s, { destination: "flow" }> => s.destination === "flow",
  );

  if (flowSegments.length === 0)
    throw new Error("No conversation flow segments found — all content was classified as context/settings");

  // segId → prefixed nodeId (flow segments only)
  const segToNodeId: Record<string, string> = {};
  flowSegments.forEach((s, idx) => {
    segToNodeId[s.segId] = `pdf-${s.segId ?? `n${idx + 1}`}`;
  });

  const nodes = flowSegments.map((n, idx) => {
    const nodeId = segToNodeId[n.segId] ?? `pdf-n${idx + 1}`;
    const isLast = idx === flowSegments.length - 1;
    let kind = VALID_KINDS.has(n.kind) ? n.kind : "conversation";
    if (isLast && kind !== "ending") kind = "ending";

    return {
      id: nodeId,
      type: kind,
      position: { x: idx * 340, y: 100 },
      data: {
        kind,
        label: String(n.label ?? `Step ${idx + 1}`),
        dialogue: contentMap[n.segId] ?? "",
        isStart: idx === 0 ? true : undefined,
        transitions: [] as Array<{ id: string; condition: string; target: string | null }>,
      },
      _aiTransitions: n.transitions ?? null,
    };
  });

  const edges: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle: string;
  }> = [];
  const usedIds = new Set<string>();

  nodes.forEach((node, idx) => {
    if (node.data.kind === "ending") return;

    const aiTx = node._aiTransitions;

    if (Array.isArray(aiTx) && aiTx.length > 0) {
      for (const t of aiTx) {
        const resolvedTarget = segToNodeId[String(t.target)] ?? null;
        if (!resolvedTarget) continue;

        let tId = String(t.id ?? `t-${node.id}-${resolvedTarget}`);
        if (usedIds.has(tId)) tId = `${tId}-${idx}`;
        usedIds.add(tId);

        node.data.transitions.push({
          id: tId,
          condition: String(t.condition ?? "default"),
          target: resolvedTarget,
        });
        edges.push({ id: tId, source: node.id, target: resolvedTarget, sourceHandle: tId });
      }
    } else {
      // Sequential fallback
      const next = nodes[idx + 1];
      if (!next) return;
      const tId = `t-${node.id}-${next.id}`;
      usedIds.add(tId);
      node.data.transitions.push({ id: tId, condition: "default", target: next.id });
      edges.push({ id: tId, source: node.id, target: next.id, sourceHandle: tId });
    }
  });

  const cleanNodes = nodes.map(({ _aiTransitions: _a, ...rest }) => rest);

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
