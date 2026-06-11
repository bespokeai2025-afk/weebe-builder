import { createFileRoute } from "@tanstack/react-router";
import { PDFParse } from "pdf-parse";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function buildSystemPrompt(
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
  const lines: string[] = [
    `You are a senior conversation flow architect specialising in AI voice agent scripts.`,
    `Convert the provided script into a complete, production-ready multi-step conversation flow.`,
  ];

  if (focusAgent) {
    lines.push(
      `\nAGENT PERSONA — every node's dialogue MUST reflect this agent's exact voice:`,
      `  Name: ${focusAgent.name}`,
      `  Role: ${focusAgent.role}`,
      `  Style: ${focusAgent.persona}`,
      ...(focusAgent.tone ? [`  Tone: ${focusAgent.tone}`] : []),
      ...(focusAgent.keyPhrases?.length
        ? [`  Signature phrases: ${focusAgent.keyPhrases.join(" | ")}`]
        : []),
      `  Expertise: ${focusAgent.expertise.join(", ")}`,
    );
  }

  if (focusCampaign) {
    lines.push(
      `\nCAMPAIGN FOCUS — nodes MUST follow this campaign's full structure:`,
      `  Campaign: ${focusCampaign.name} (${focusCampaign.type})`,
      `  Objective: ${focusCampaign.objective}`,
      `  Required stages (in order): ${focusCampaign.keyStages.join(" → ")}`,
      ...(focusCampaign.branchingPoints?.length
        ? [
            `  Branching scenarios to model as logic_split nodes:`,
            ...focusCampaign.branchingPoints.map((b) => `    • ${b}`),
          ]
        : []),
    );
  }

  lines.push(
    `
OUTPUT ONLY valid JSON — no markdown, no code fences, no extra text — with this exact shape:
{
  "title": "<2-4 word title for this flow>",
  "globalPromptSuggestion": "<everything that belongs in the agent's system prompt: identity, company context, product details, behavioral rules, tone guidelines, compliance constraints, escalation rules — NOT dialogue steps. Consolidate into a clean paragraph. Empty string if nothing.>",
  "nodes": [
    {
      "id": "n1",
      "label": "<3-6 word step name>",
      "kind": "conversation",
      "dialogue": "<exact agent script or instruction for this step — do not truncate>",
      "isStart": true,
      "transitions": [
        { "id": "t_n1_n2", "condition": "default", "target": "n2" }
      ]
    }
  ]
}

CRITICAL RULES — follow every one:

COMPLETENESS:
- Include a node for EVERY distinct dialogue step, decision point, and branch in the script
- Do NOT merge steps with different dialogue or purpose into one node
- Do NOT cap the number of nodes — use as many as the script requires
- Do NOT skip, summarise, or omit any part of the script

NODE KINDS:
- "conversation" — any agent dialogue or instruction step
- "logic_split"  — a decision/branching point (use whenever the script has if/else, conditional paths, or multiple customer response options)
- "ending"       — the final node (call close / goodbye)

TRANSITIONS (REQUIRED on every node):
- Every node MUST have a "transitions" array — never omit it
- Sequential step: [ { "id": "t_n1_n2", "condition": "default", "target": "n2" } ]
- Branching (logic_split): multiple transitions each with a specific, human-readable condition string
  Example: [
    { "id": "t_n3_a", "condition": "Customer is interested / agrees", "target": "n4" },
    { "id": "t_n3_b", "condition": "Customer declines or objects", "target": "n5" }
  ]
- "ending" node: "transitions": []
- All "target" values MUST match an "id" in the nodes array — no dangling references
- Transition ids must be unique across the entire flow

STRUCTURE:
- First node: "isStart": true
- Last node: "kind": "ending", closing dialogue, "transitions": []
- "label" must be a short descriptive name (e.g. "Greeting", "Qualify Interest", "Handle Objection", "Book Appointment")
- "dialogue" must be the complete agent script for that step — never cut it short`,
  );

  if (focusAgent || focusCampaign) {
    lines.push(
      `\nTARGETING: Tailor every node's dialogue to the specified agent's voice and campaign's objectives.`,
      `Ensure all required campaign stages appear as nodes and all branching points are modelled as logic_split nodes.`,
    );
  }

  return lines.join("\n");
}

function cleanText(raw: string): string {
  return raw
    .split("\n")
    .filter((line) => {
      const isPageNum =
        /^\s*Page\s+\d+\s*$/i.test(line) || /^\s*\d+\s*$/.test(line);
      const isBoilerplate =
        /^\s*(Confidential|Draft|Version|Copyright|Internal Use Only)/i.test(line);
      return !isPageNum && !isBoilerplate;
    })
    .join("\n")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 14000);
}

const VALID_KINDS = new Set([
  "conversation", "function", "call_transfer", "press_digit",
  "logic_split", "agent_transfer", "sms", "extract_variable",
  "code", "ending", "note",
]);

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
  const systemPrompt = buildSystemPrompt(focusAgent, focusCampaign);

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
          content: `Convert this complete script into a conversation flow — include every step and all branching logic:\n\n${scriptText}`,
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

  const raw = JSON.parse(aiJson.choices[0].message.content) as {
    title: string;
    globalPromptSuggestion?: string;
    nodes: Array<{
      id: string;
      label: string;
      kind: string;
      dialogue: string;
      isStart?: boolean;
      transitions?: Array<{ id: string; condition: string; target: string }>;
    }>;
  };

  if (!Array.isArray(raw.nodes) || raw.nodes.length === 0)
    throw new Error("AI returned no nodes");

  // Build raw-id → prefixed-id map for resolving transition targets
  const idMap: Record<string, string> = {};
  raw.nodes.forEach((n, idx) => {
    const rawId = String(n.id ?? `n${idx + 1}`);
    idMap[rawId] = `pdf-${rawId}`;
  });

  // Build node objects
  const nodes = raw.nodes.map((n, idx) => {
    const rawId = String(n.id ?? `n${idx + 1}`);
    const nodeId = idMap[rawId];
    const isLast = idx === raw.nodes.length - 1;
    let kind = VALID_KINDS.has(n.kind) ? n.kind : "conversation";
    if (isLast && kind !== "ending") kind = "ending";

    // Compute position: branch nodes spread vertically
    const x = idx * 340;
    const y = 100;

    return {
      id: nodeId,
      type: kind,
      position: { x, y },
      data: {
        kind,
        label: String(n.label ?? `Step ${idx + 1}`),
        dialogue: String(n.dialogue ?? ""),
        isStart: idx === 0 ? true : undefined,
        transitions: [] as Array<{ id: string; condition: string; target: string | null }>,
      },
      _rawId: rawId,
      _aiTransitions: n.transitions ?? null,
    };
  });

  // Build edges — use AI-provided transitions; fall back to sequential
  const edges: Array<{
    id: string;
    source: string;
    target: string;
    sourceHandle: string;
  }> = [];
  const usedTransitionIds = new Set<string>();

  nodes.forEach((node, idx) => {
    if (node.data.kind === "ending") return;

    const aiTransitions = node._aiTransitions;

    if (Array.isArray(aiTransitions) && aiTransitions.length > 0) {
      for (const t of aiTransitions) {
        const resolvedTarget = idMap[String(t.target)] ?? null;
        if (!resolvedTarget) continue; // skip dangling references

        // Ensure unique transition id
        let tId = String(t.id ?? `t-${node.id}-${resolvedTarget}`);
        if (usedTransitionIds.has(tId)) tId = `${tId}-${idx}`;
        usedTransitionIds.add(tId);

        node.data.transitions.push({
          id: tId,
          condition: String(t.condition ?? "default"),
          target: resolvedTarget,
        });
        edges.push({ id: tId, source: node.id, target: resolvedTarget, sourceHandle: tId });
      }
    } else {
      // Sequential fallback: connect to next node
      const next = nodes[idx + 1];
      if (!next) return;
      const tId = `t-${node.id}-${next.id}`;
      usedTransitionIds.add(tId);
      node.data.transitions.push({ id: tId, condition: "default", target: next.id });
      edges.push({ id: tId, source: node.id, target: next.id, sourceHandle: tId });
    }
  });

  // Strip internal helper fields before returning
  const cleanNodes = nodes.map(({ _rawId: _r, _aiTransitions: _a, ...rest }) => rest);

  return {
    title: String(raw.title ?? "Imported Script"),
    globalPromptSuggestion: raw.globalPromptSuggestion?.trim() ?? "",
    nodes: cleanNodes,
    edges,
    nodeCount: cleanNodes.length,
  };
}

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
              body.rawText,
              body.focusAgent,
              body.focusCampaign,
            );
            return json(result);
          }

          // ── Mode B: multipart form (direct PDF upload, no entity selection) ─
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
          const scriptText = cleanText(rawText);

          if (!scriptText)
            return json({ error: "Could not extract text from PDF" }, 422);

          const result = await generateFlow(apiKey, scriptText);
          return json(result);
        } catch (e) {
          console.error("[import-pdf]", e);
          return json({ error: (e as Error).message ?? "Processing failed" }, 500);
        }
      },
    },
  },
});
