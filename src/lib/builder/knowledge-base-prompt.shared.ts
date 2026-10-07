/**
 * Knowledge-base documents → one prompt section, for engines with no retrieval service.
 *
 * Retell retrieves from its own hosted knowledge base. HyperStream and WEBEE Native have no
 * retrieval, so the documents themselves go into the prompt. WEBEE Native used to send only the
 * knowledge-base ids ("Knowledge bases in scope: …"), so an FAQ agent on that engine answered
 * without its documents.
 *
 * The section sits in the global prompt, which every turn sends as an unchanged prefix — so after
 * the first turn providers serve it from their prompt cache and it costs little latency. It is
 * capped so a large upload cannot push the prompt past what a live call can afford.
 *
 * Relative imports only — reachable from the voice runtime.
 */

export interface KbDocLike {
  name?: string;
  type?: "text" | "url" | "file" | string;
  content?: string;
  url?: string;
  fileName?: string;
}

/** ~10k tokens. Enough for a real FAQ; past this the prompt stops being cheap per turn. */
export const KB_PROMPT_MAX_CHARS = 40_000;

export interface KnowledgeBaseSection {
  text: string;
  /** Documents with no local text (e.g. URL or PDF added for Retell only). */
  missing: string[];
  /** Documents cut or dropped to stay under the cap. */
  truncated: string[];
}

export function buildKnowledgeBaseSection(
  docs: KbDocLike[] | undefined,
  options: { instruction?: string; includeUrlReferences?: boolean; maxChars?: number } = {},
): KnowledgeBaseSection {
  const maxChars = options.maxChars ?? KB_PROMPT_MAX_CHARS;
  const parts: string[] = [];
  const missing: string[] = [];
  const truncated: string[] = [];
  let used = 0;

  for (const doc of docs ?? []) {
    const name = String(doc.name || doc.fileName || doc.url || "Document").trim();
    const content = String(doc.content ?? "").trim();
    let body = "";
    if (content) body = content;
    else if (doc.type === "url" && doc.url && options.includeUrlReferences) {
      body = `Source URL: ${doc.url}\n(Refer to this URL for accurate information on the topic.)`;
    } else {
      missing.push(name);
      continue;
    }
    const block = `## ${name}\n${body}`;
    const room = maxChars - used;
    if (room <= 200) {
      truncated.push(name);
      continue;
    }
    if (block.length > room) {
      parts.push(block.slice(0, room));
      used = maxChars;
      truncated.push(name);
      continue;
    }
    parts.push(block);
    used += block.length + 2;
  }

  if (parts.length === 0) return { text: "", missing, truncated };
  const instruction = options.instruction?.trim();
  const text = [
    "# Knowledge Base",
    "Use the following reference material to answer questions accurately. If the answer is not in it, say you will find out rather than guessing.",
    ...(instruction ? [instruction] : []),
    "",
    parts.join("\n\n"),
  ].join("\n");
  return { text, missing, truncated };
}
