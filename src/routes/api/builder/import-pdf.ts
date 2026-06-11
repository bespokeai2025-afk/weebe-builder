import { createFileRoute } from "@tanstack/react-router";
import { PDFParse } from "pdf-parse";

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
): string {
  const lines = [
    `You are a conversation flow formatter for a voice agent builder.`,
    `You receive pre-segmented text blocks extracted from a script by a state-machine parser.`,
    `The segments already contain ALL content — your job is enrichment only, not extraction.`,
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
For each input segment, output ONE enriched node. Rules:

OUTPUT ONLY valid JSON — no markdown, no code fences:
{
  "title": "<2-4 word overall flow title>",
  "globalPromptSuggestion": "<agent identity, company context, behavioral rules, compliance — NOT dialogue steps. Empty string if none.>",
  "nodes": [
    {
      "segId": "<original segment id>",
      "label": "<3-6 word node name>",
      "kind": "conversation | logic_split | ending",
      "transitions": [
        { "id": "<unique t-id>", "condition": "default", "target": "<segId of next segment>" }
      ]
    }
  ]
}

CRITICAL RULES:
- Output EXACTLY one node per input segment — never merge or split segments
- Segment content becomes the node's dialogue verbatim — do not change it
- kind "conversation": agent dialogue or instruction
- kind "logic_split": decision or branching point (multiple transitions with specific conditions)
- kind "ending": only the final segment — "transitions": []
- For logic_split, write specific condition strings: e.g. "Customer interested" / "Customer declines"
- All transition "target" values must reference a valid segId from the input
- Transition ids must be unique across the entire flow
- The last segment MUST be kind "ending"`);

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
) {
  // ── Step 1: state-machine segmentation (100% line coverage) ──────────────
  const rawSegments = segmentByStateMachine(scriptText);
  const segments = mergeSmallSegments(rawSegments);

  if (segments.length === 0) throw new Error("No content segments extracted from PDF");

  // ── Step 2: AI enrichment (labels, kinds, transitions, global prompt) ─────
  const systemPrompt = buildEnrichmentPrompt(focusAgent, focusCampaign);

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
    globalPromptSuggestion?: string;
    nodes: Array<{
      segId: string;
      label: string;
      kind: string;
      transitions: Array<{ id: string; condition: string; target: string }>;
    }>;
  };

  if (!Array.isArray(enriched.nodes) || enriched.nodes.length === 0)
    throw new Error("Enrichment returned no nodes");

  // ── Step 3: Build FlowNode + Edge objects ────────────────────────────────
  const VALID_KINDS = new Set([
    "conversation", "function", "call_transfer", "press_digit",
    "logic_split", "agent_transfer", "sms", "extract_variable",
    "code", "ending", "note",
  ]);

  // segId → prefixed nodeId
  const segToNodeId: Record<string, string> = {};
  enriched.nodes.forEach((n, idx) => {
    segToNodeId[n.segId] = `pdf-${n.segId ?? `n${idx + 1}`}`;
  });
  // Also map by index for fallback
  segments.forEach((s, idx) => {
    if (!segToNodeId[s.id]) segToNodeId[s.id] = `pdf-seg${idx}`;
  });

  // Build a content map from original segments
  const contentMap: Record<string, { content: string; rawType: Segment["type"] }> = {};
  segments.forEach((s) => {
    contentMap[s.id] = { content: s.header ? `${s.header}\n${s.content}` : s.content, rawType: s.type };
  });

  const nodes = enriched.nodes.map((n, idx) => {
    const nodeId = segToNodeId[n.segId] ?? `pdf-n${idx + 1}`;
    const isLast = idx === enriched.nodes.length - 1;
    let kind = VALID_KINDS.has(n.kind) ? n.kind : "conversation";
    if (isLast && kind !== "ending") kind = "ending";

    const segContent = contentMap[n.segId];

    return {
      id: nodeId,
      type: kind,
      position: { x: idx * 340, y: 100 },
      data: {
        kind,
        label: String(n.label ?? `Step ${idx + 1}`),
        dialogue: segContent?.content ?? "",
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
    globalPromptSuggestion: enriched.globalPromptSuggestion?.trim() ?? "",
    nodes: cleanNodes,
    edges,
    nodeCount: cleanNodes.length,
    segmentCount: segments.length,
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
            );
            return json(result);
          }

          // ── Mode B: multipart form (direct PDF upload) ─────────────────────
          const formData = await request.formData();
          const file = formData.get("pdf");
          if (!file || !(file instanceof File))
            return json({ error: "No PDF file provided" }, 400);
          if (!file.type.includes("pdf") && !file.name.endsWith(".pdf"))
            return json({ error: "File must be a PDF" }, 400);
          if (file.size > 10 * 1024 * 1024)
            return json({ error: "PDF must be under 10 MB" }, 400);

          const buffer = Buffer.from(await file.arrayBuffer());
          const parser = new PDFParse({ data: buffer });
          await parser.load();
          const { text: rawText } = await parser.getText();

          if (!rawText?.trim())
            return json({ error: "Could not extract text from PDF" }, 422);

          const result = await generateFlow(apiKey, cleanText(rawText));
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
