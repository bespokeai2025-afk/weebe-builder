/**
 * Client helper for the streaming HiveMind chat endpoint (Task #523).
 *
 * Reads /api/hivemind/chat-stream (SSE-over-fetch) and forwards incremental
 * tokens to the caller so the answer starts rendering the moment the model
 * begins speaking, instead of after the full round-trip.
 *
 * Callers should FALL BACK to the non-streaming getHiveMindAIResponse server
 * fn when this throws — both paths share the same server-side pipeline.
 */
import { supabase } from "@/integrations/supabase/client";

export interface HiveMindStreamResult {
  response: string;
  actionsTaken: Array<{ tool: string; ok: boolean; status?: string }>;
  workOrderProposals: Array<{
    workOrderId: string;
    taskId: string;
    taskTitle: string;
    focusCampaign: { campaignId: string; campaignName: string } | null;
    days: number;
    readinessState: string | null;
    objective: string | null;
    approvalScopeSummary: string | null;
  }>;
}

export async function streamHiveMindChat(opts: {
  query: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  personality?: string;
  userName?: string;
  signal?: AbortSignal;
  onToken?: (fullText: string) => void;
  onStatus?: (label: string) => void;
}): Promise<HiveMindStreamResult> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess?.session?.access_token;
  if (!token) throw new Error("Not signed in");

  const res = await fetch("/api/hivemind/chat-stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    credentials: "same-origin",
    body: JSON.stringify({
      query: opts.query,
      history: opts.history,
      personality: opts.personality,
      userName: opts.userName,
    }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(`Stream unavailable (${res.status})`);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let accumulated = "";
  let done: HiveMindStreamResult | null = null;
  let errorMessage: string | null = null;

  for (;;) {
    const { done: eof, value } = await reader.read();
    if (eof) break;
    buf += dec.decode(value, { stream: true });
    const frames = buf.split("\n\n");
    buf = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        const evt = JSON.parse(line.slice(6));
        if (evt.type === "token" && typeof evt.text === "string") {
          accumulated += evt.text;
          opts.onToken?.(accumulated);
        } else if (evt.type === "status" && typeof evt.label === "string") {
          opts.onStatus?.(evt.label);
        } else if (evt.type === "done") {
          done = {
            response: typeof evt.response === "string" ? evt.response : accumulated,
            actionsTaken: Array.isArray(evt.actionsTaken) ? evt.actionsTaken : [],
            workOrderProposals: Array.isArray(evt.workOrderProposals) ? evt.workOrderProposals : [],
          };
        } else if (evt.type === "error") {
          errorMessage = typeof evt.message === "string" ? evt.message : "Stream error";
        }
      } catch {
        /* partial/garbled frame — ignore */
      }
    }
  }

  if (done) return done;
  if (errorMessage) {
    // Server sent an honest, user-facing failure message — surface it as the
    // answer rather than throwing into the generic fallback path.
    return { response: errorMessage, actionsTaken: [], workOrderProposals: [] };
  }
  throw new Error("Stream ended without a result");
}
