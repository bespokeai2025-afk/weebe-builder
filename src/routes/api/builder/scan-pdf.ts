import { createFileRoute } from "@tanstack/react-router";
import { PDFParse } from "pdf-parse";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const SCAN_PROMPT = `You are a document analyst specialising in voice agent and call centre scripts.

Scan the provided document and extract:
1. Agent identities / personas — distinct AI or human agent characters described in the document
2. Campaign pathways — distinct call scenarios, use cases, or conversation flows

Output ONLY valid JSON with this exact shape:
{
  "agents": [
    {
      "name": "string (agent name or identifier)",
      "role": "string (job title or function, e.g. Sales Representative)",
      "persona": "string (1-2 sentence communication style / personality description)",
      "expertise": ["string", "string"] (2-4 topic or skill tags)
    }
  ],
  "campaigns": [
    {
      "name": "string (campaign or pathway name)",
      "type": "string (one of: outbound, inbound, support, sales, follow-up, booking, other)",
      "objective": "string (one sentence — what this campaign achieves)",
      "keyStages": ["string", "string"] (3-6 stage names in order)
    }
  ]
}

Rules:
- Extract only entities clearly present in the document — do not invent anything
- Maximum 6 agents and 6 campaigns
- If no distinct agents are found, return "agents": []
- If no distinct campaigns are found, return "campaigns": []
- Expertise tags should be 1-3 words each (e.g. "lead qualification", "objection handling")
- keyStages should be brief action labels (e.g. "Greeting", "Verify Identity", "Close")`;

function cleanText(raw: string): string {
  return raw
    .split("\n")
    .filter((line) => {
      const isPageNum =
        /^\s*Page\s+\d+\s*$/i.test(line) || /^\s*\d+\s*$/.test(line);
      const isBoilerplate =
        /^\s*(Confidential|Draft|Version|Copyright|Internal Use Only)/i.test(
          line,
        );
      return !isPageNum && !isBoilerplate;
    })
    .join("\n")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 12000);
}

export const Route = createFileRoute("/api/builder/scan-pdf")({
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

          const cleanedText = cleanText(rawText);
          if (!cleanedText)
            return json({ error: "Could not extract text from PDF" }, 422);

          const aiRes = await fetch(
            "https://api.openai.com/v1/chat/completions",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: "gpt-4o-mini",
                temperature: 0.1,
                response_format: { type: "json_object" },
                messages: [
                  { role: "system", content: SCAN_PROMPT },
                  {
                    role: "user",
                    content: `Scan this document and extract agent personas and campaign pathways:\n\n${cleanedText}`,
                  },
                ],
              }),
            },
          );

          if (!aiRes.ok) {
            const err = await aiRes.text();
            return json({ error: `OpenAI error: ${err.slice(0, 200)}` }, 502);
          }

          const aiJson = (await aiRes.json()) as {
            choices: Array<{ message: { content: string } }>;
          };

          const scanned = JSON.parse(aiJson.choices[0].message.content) as {
            agents: Array<{
              name: string;
              role: string;
              persona: string;
              expertise: string[];
            }>;
            campaigns: Array<{
              name: string;
              type: string;
              objective: string;
              keyStages: string[];
            }>;
          };

          return json({
            agents: Array.isArray(scanned.agents) ? scanned.agents : [],
            campaigns: Array.isArray(scanned.campaigns)
              ? scanned.campaigns
              : [],
            rawText: cleanedText,
          });
        } catch (e) {
          console.error("[scan-pdf]", e);
          return json(
            { error: (e as Error).message ?? "Scanning failed" },
            500,
          );
        }
      },
    },
  },
});
