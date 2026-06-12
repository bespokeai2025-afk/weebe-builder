import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const RETELL_BASE = "https://api.retellai.com";

async function resolveRetellKey(workspaceId: string | undefined): Promise<string> {
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
  .inputValidator((d: { name: string }) => d)
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
  .inputValidator((d: { kbId: string }) => d)
  .handler(async ({ context, data }) => {
    const key = await resolveRetellKey((context as any).workspaceId);
    await retellKbFetch(`/v2/delete-knowledge-base/${data.kbId}`, null, "DELETE", key);
    return { ok: true };
  });

export const addTextToRetellKb = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { kbId: string; text: string; sourceId: string }) => d)
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
  .inputValidator((d: { kbId: string; url: string; sourceId: string }) => d)
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
  .inputValidator((d: {
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
