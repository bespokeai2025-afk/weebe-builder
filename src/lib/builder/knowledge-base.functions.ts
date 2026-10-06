import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { htmlToText, isSafeResearchUrl } from "@/lib/leads/sales-assistant.shared";

const RETELL_BASE = "https://api.retellai.com";

export async function resolveRetellKey(workspaceId: string | undefined): Promise<string> {
  if (workspaceId) {
    const { data: ws } = await (supabaseAdmin as any)
      .from("workspace_settings")
      .select("retell_workspace_id")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const wk = (ws?.retell_workspace_id as string | undefined)?.trim();
    if (wk && wk.startsWith("key_")) return wk;
  }
  const platformKey = process.env.RETELL_API_KEY;
  if (!platformKey) throw new Error("RETELL_API_KEY is not configured");
  return platformKey;
}

async function retellKbFetch(
  path: string,
  body: unknown,
  method = "POST",
  apiKey?: string,
): Promise<Record<string, unknown>> {
  const key = apiKey ?? process.env.RETELL_API_KEY;
  if (!key) throw new Error("RETELL_API_KEY is not configured");

  const res = await fetch(`${RETELL_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let parsed: unknown = text;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* keep text */ }

  if (!res.ok) {
    const msg =
      typeof parsed === "object" && parsed && "error_message" in parsed
        ? String((parsed as { error_message: unknown }).error_message)
        : typeof parsed === "object" && parsed && "message" in parsed
          ? String((parsed as { message: unknown }).message)
          : text || res.statusText;
    throw new Error(`Retell KB ${path} (${res.status}): ${msg}`);
  }
  return parsed as Record<string, unknown>;
}

async function retellKbFileFetch(
  path: string,
  kbId: string,
  fileBase64: string,
  fileName: string,
  mimeType: string,
  apiKey?: string,
): Promise<Record<string, unknown>> {
  const key = apiKey ?? process.env.RETELL_API_KEY;
  if (!key) throw new Error("RETELL_API_KEY is not configured");

  const buf = Buffer.from(fileBase64, "base64");
  const blob = new Blob([buf], { type: mimeType });

  const form = new FormData();
  form.append("knowledge_base_id", kbId);
  form.append("file", blob, fileName);

  const res = await fetch(`${RETELL_BASE}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });

  const text = await res.text();
  let parsed: unknown = text;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* keep text */ }
  if (!res.ok) {
    const msg =
      typeof parsed === "object" && parsed && "error_message" in parsed
        ? String((parsed as { error_message: unknown }).error_message)
        : text || res.statusText;
    throw new Error(`Retell KB file upload (${res.status}): ${msg}`);
  }
  return parsed as Record<string, unknown>;
}

export const listRetellKnowledgeBases = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const key = await resolveRetellKey((context as any).workspaceId);
    const data = await retellKbFetch("/v2/list-knowledge-bases", null, "GET", key);
    const items = Array.isArray(data) ? data : ((data.knowledge_bases ?? []) as unknown[]);
    return items as Array<{
      knowledge_base_id: string;
      knowledge_base_name: string;
      status?: string;
      sources?: unknown[];
    }>;
  });

export const createRetellKnowledgeBase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { name: string }) => d)
  .handler(async ({ context, data }) => {
    const key = await resolveRetellKey((context as any).workspaceId);
    const result = await retellKbFetch("/v2/create-knowledge-base", {
      knowledge_base_name: data.name,
      enable_auto_refresh: false,
    }, "POST", key);
    return result as { knowledge_base_id: string; knowledge_base_name: string };
  });

export const deleteRetellKnowledgeBase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { kbId: string }) => d)
  .handler(async ({ context, data }) => {
    const key = await resolveRetellKey((context as any).workspaceId);
    await retellKbFetch(`/v2/delete-knowledge-base/${data.kbId}`, null, "DELETE", key);
    return { ok: true };
  });

export const addTextToRetellKb = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { kbId: string; text: string; sourceId: string }) => d)
  .handler(async ({ context, data }) => {
    const key = await resolveRetellKey((context as any).workspaceId);
    const result = await retellKbFetch("/v2/add-knowledge-base-sources", {
      knowledge_base_id: data.kbId,
      sources: [{ type: "text", source_id: data.sourceId, text: data.text }],
    }, "POST", key);
    return result;
  });

export const addUrlToRetellKb = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { kbId: string; url: string; sourceId: string }) => d)
  .handler(async ({ context, data }) => {
    const key = await resolveRetellKey((context as any).workspaceId);
    const result = await retellKbFetch("/v2/add-knowledge-base-sources", {
      knowledge_base_id: data.kbId,
      sources: [{ type: "url", source_id: data.sourceId, url: data.url }],
    }, "POST", key);
    return result;
  });

export const addFileToRetellKb = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: {
    kbId: string;
    fileBase64: string;
    fileName: string;
    mimeType: string;
  }) => d)
  .handler(async ({ context, data }) => {
    const key = await resolveRetellKey((context as any).workspaceId);
    const result = await retellKbFileFetch(
      "/v2/add-knowledge-base-sources",
      data.kbId,
      data.fileBase64,
      data.fileName,
      data.mimeType,
      key,
    );
    return result;
  });


const KB_URL_TIMEOUT_MS = 10_000;
const KB_URL_MAX_BYTES = 2_000_000;
const KB_URL_MAX_CHARS = 20_000;

/**
 * Fetch a page's readable text for engines that keep knowledge-base content locally (WEBEE Native,
 * HyperStream) — they have no crawler, so a URL document needs its text captured when it is added.
 * Same guard as other user-supplied fetches: https only, no literal IPs or internal hosts, a hard
 * timeout and a byte cap.
 */
export const fetchKbUrlText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { url: string }) => d)
  .handler(async ({ data }) => {
    const url = String(data.url ?? "").trim();
    if (!isSafeResearchUrl(url)) {
      throw new Error("Use a public https:// address.");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), KB_URL_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: { "User-Agent": "WeBeeBot/1.0 (+knowledge-base)", Accept: "text/html,text/plain" },
      });
      if (!res.ok) throw new Error(`The page returned HTTP ${res.status}.`);
      if (!isSafeResearchUrl(res.url || url)) throw new Error("The page redirected somewhere unsafe.");
      const type = res.headers.get("content-type") ?? "";
      if (!type.includes("html") && !type.includes("text")) {
        throw new Error("That address is not a web page or text file.");
      }
      const buf = await res.arrayBuffer();
      const raw = new TextDecoder().decode(buf.slice(0, KB_URL_MAX_BYTES));
      const text = type.includes("html") ? htmlToText(raw, KB_URL_MAX_CHARS) : raw.slice(0, KB_URL_MAX_CHARS);
      if (text.trim().length < 40) throw new Error("No readable text was found on that page.");
      return { text };
    } finally {
      clearTimeout(timer);
    }
  });

/** ~10 MB of file; base64 inflates it by a third on the way in. */
const KB_FILE_MAX_BASE64_CHARS = 14_000_000;
const KB_FILE_MAX_TEXT_CHARS = 60_000;

/**
 * Extract readable text from an uploaded document (PDF, DOCX, XLSX, text) for engines that keep
 * knowledge-base content locally. Reading a PDF in the browser with `file.text()` produced binary
 * noise, so those engines either got garbage or (WEBEE Native) refused the file.
 */
export const extractKbFileText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d: { fileBase64: string; fileName: string; mimeType?: string }) => d)
  .handler(async ({ data }) => {
    const b64 = String(data.fileBase64 ?? "");
    if (!b64) throw new Error("The file is empty.");
    if (b64.length > KB_FILE_MAX_BASE64_CHARS) throw new Error("The file is larger than 10 MB.");
    const { extractTextFromBuffer } = await import(
      "@/lib/executives/executive-document-processing.server"
    );
    const text = (
      await extractTextFromBuffer(Buffer.from(b64, "base64"), data.mimeType ?? "", data.fileName ?? "")
    )
      .replace(/\u0000/g, "")
      // pdf-parse page markers ("-- 1 of 3 --") are not document content.
      .replace(/^-- \d+ of \d+ --$/gm, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (text.length < 20) {
      throw new Error("No readable text was found. A scanned PDF needs OCR first.");
    }
    return { text: text.slice(0, KB_FILE_MAX_TEXT_CHARS), truncated: text.length > KB_FILE_MAX_TEXT_CHARS };
  });
