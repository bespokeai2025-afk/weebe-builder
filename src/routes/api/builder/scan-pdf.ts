import { createFileRoute } from "@tanstack/react-router";
import { PDFParse } from "pdf-parse";
import mammoth from "mammoth";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const SCAN_PROMPT = `You are a senior conversation designer and script analyst specialising in AI voice agents and call-centre scripts.

Perform a deep analytical scan of the provided document and extract every entity in each of the following categories.

OUTPUT ONLY valid JSON with exactly this shape (no markdown, no code fences):
{
  "agents": [
    {
      "name": "string — agent name or identifier (e.g. 'Alex', 'Support Agent')",
      "role": "string — job title or function (e.g. 'Sales Development Representative')",
      "persona": "string — 2-3 sentence communication style, personality, and approach",
      "tone": "string — one-line tone descriptor (e.g. 'Warm and consultative, never pushy')",
      "keyPhrases": ["string"] — 3-5 signature phrases or expressions this agent uses,
      "expertise": ["string"] — 3-5 skill or topic tags (e.g. 'lead qualification', 'objection handling')
    }
  ],
  "campaigns": [
    {
      "name": "string — campaign or pathway name",
      "type": "string — one of: outbound, inbound, support, sales, follow-up, booking, qualification, other",
      "objective": "string — 1-2 sentence goal of this campaign",
      "keyStages": ["string"] — ALL conversation stages in order (no limit, be exhaustive),
      "branchingPoints": ["string"] — conditional decision points (e.g. 'If customer is interested → booking', 'If objection raised → handle objection')
    }
  ],
  "globalPromptContent": "string — ALL standing instructions, agent identity statements, company background, product/service context, behavioral rules, constraints, compliance notes, and any other system-level guidance found in the document. This is everything that describes WHO the agent is and HOW it must behave — NOT dialogue steps. Write as a clear, consolidated prompt paragraph. Return empty string if nothing applies."
}

EXTRACTION RULES:
- Extract EVERY agent persona present — do not miss any even if they appear briefly
- Extract EVERY distinct campaign, call type, or conversation pathway
- For keyStages: be exhaustive — list every stage, substage, and branch endpoint mentioned
- For branchingPoints: capture every if/else, conditional path, or alternative scenario
- globalPromptContent: include agent name/identity, company name, product details, tone rules,
  compliance warnings, prohibited topics, escalation rules — anything a system prompt needs
- Do NOT invent entities — only extract what is clearly in the document
- Do NOT cap agents or campaigns — extract all of them`;

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
            return json({ error: "No file provided" }, 400);

          const buffer = Buffer.from(await file.arrayBuffer());
          const isDocx =
            file.name.toLowerCase().endsWith(".docx") ||
            file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
          const isPdf = file.type.includes("pdf") || file.name.toLowerCase().endsWith(".pdf");

          if (!isDocx && !isPdf)
            return json({ error: "File must be a PDF or Word document (.docx)" }, 400);
          if (file.size > 10 * 1024 * 1024)
            return json({ error: "File must be under 10 MB" }, 400);

          let rawText: string;
          if (isDocx) {
            const result = await mammoth.extractRawText({ buffer });
            rawText = result.value;
          } else {
            const parser = new PDFParse({ data: buffer });
            await parser.load();
            const extracted = await parser.getText();
            rawText = extracted.text;
          }

          const cleanedText = cleanText(rawText);
          if (!cleanedText)
            return json({ error: "Could not extract text from the document" }, 422);

          const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "gpt-4o",
              temperature: 0.1,
              response_format: { type: "json_object" },
              messages: [
                { role: "system", content: SCAN_PROMPT },
                {
                  role: "user",
                  content: `Perform a deep scan of this document and extract all agents, campaigns, and global prompt content:\n\n${cleanedText}`,
                },
              ],
            }),
          });

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
              tone: string;
              keyPhrases: string[];
              expertise: string[];
            }>;
            campaigns: Array<{
              name: string;
              type: string;
              objective: string;
              keyStages: string[];
              branchingPoints: string[];
            }>;
            globalPromptContent: string;
          };

          return json({
            agents: Array.isArray(scanned.agents) ? scanned.agents : [],
            campaigns: Array.isArray(scanned.campaigns) ? scanned.campaigns : [],
            globalPromptContent: scanned.globalPromptContent ?? "",
            rawText: cleanedText,
          });
        } catch (e) {
          console.error("[scan-pdf]", e);
          return json({ error: (e as Error).message ?? "Scanning failed" }, 500);
        }
      },
    },
  },
});
