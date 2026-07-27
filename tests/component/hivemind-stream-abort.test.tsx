// ── HiveMind streaming Stop button test (Task #524) ──────────────────────────
// Renders the REAL Assistant chat page (HiveMindChat) with the REAL
// streamHiveMindChat client, mocks only the network layer, and verifies:
//   1. Mid-stream abort keeps streamed text and appends "(Stopped)".
//   2. Abort before any token renders the bare "Stopped." state.
//   3. The AbortSignal reaches fetch and the in-flight read settles —
//      no orphaned network connection after abort.
//   4. The UI leaves the "thinking" state (Stop button disappears, input
//      re-enables) and the non-streaming fallback is NOT invoked on abort.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// ── Module mocks (network / server / router boundaries only) ─────────────────
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createFileRoute: (_path: string) => (opts: any) => opts,
}));
vi.mock("@tanstack/react-start", () => ({
  useServerFn: (fn: any) => fn,
}));

const aiFallbackFn = vi.fn(async () => ({ response: "fallback", workOrderProposals: [] }));
vi.mock("@/lib/hivemind/hivemind.ai", () => ({
  getHiveMindAIResponse: (...a: any[]) => aiFallbackFn(...a),
  getHiveMindMorningBriefing: vi.fn(async () => ({ briefing: "Morning briefing" })),
  getHiveMindTTS: vi.fn(async () => ({ audioBase64: null })),
  listHiveMindVoices: vi.fn(async () => ({ voices: [] })),
  getHiveMindSystemContext: vi.fn(async () => ({})),
}));
vi.mock("@/lib/hivemind/mind-execution-engine.server", () => ({
  approveAndRunTask: vi.fn(),
  getTaskExecutionDetail: vi.fn(async () => ({})),
}));
vi.mock("@/lib/hivemind/hivemind.actions", () => ({
  approveHiveMindAction: vi.fn(),
}));
vi.mock("@/components/hivemind/HiveMindShell", () => ({
  HiveMindShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
const persistMock = vi.fn(async () => true);
vi.mock("@/hooks/useMindConversation", () => ({
  useMindConversation: () => ({
    conversationId: "conv-1",
    // Non-empty history disables the morning-briefing query.
    initialMessages: [
      { id: "m0", role: "assistant", content: "Prior answer", createdAt: new Date().toISOString() },
    ],
    historyLoaded: true,
    persist: persistMock,
  }),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { access_token: "test-jwt" } } })),
    },
  },
}));

// ── Controllable fetch mock for /api/hivemind/chat-stream ────────────────────
const enc = new TextEncoder();

type StreamHarness = {
  url: string;
  signal: AbortSignal | undefined;
  reads: number;
  pendingSettled: boolean;
  emitToken: (text: string) => void;
};

let harness: StreamHarness | null = null;
/** When true the mock emits no token before hanging (abort-before-first-token). */
let emitNothing = false;

function installFetchMock() {
  harness = null;
  (globalThis as any).fetch = vi.fn(async (url: any, init: any) => {
    const signal: AbortSignal | undefined = init?.signal;
    const queue: Array<{ done: boolean; value?: Uint8Array }> = [];
    const waiters: Array<{
      resolve: (r: { done: boolean; value?: Uint8Array }) => void;
      reject: (e: unknown) => void;
    }> = [];
    const h: StreamHarness = {
      url: String(url),
      signal,
      reads: 0,
      pendingSettled: true,
      emitToken: (text: string) => {
        const chunk = enc.encode(`data: ${JSON.stringify({ type: "token", text })}\n\n`);
        const w = waiters.shift();
        if (w) {
          h.pendingSettled = true;
          w.resolve({ done: false, value: chunk });
        } else {
          queue.push({ done: false, value: chunk });
        }
      },
    };
    harness = h;
    const abortAll = () => {
      h.pendingSettled = true;
      while (waiters.length) {
        waiters.shift()!.reject(new DOMException("The operation was aborted.", "AbortError"));
      }
    };
    signal?.addEventListener("abort", abortAll, { once: true });
    if (!emitNothing) h.emitToken("Hello from HiveMind");

    const reader = {
      read: () => {
        h.reads += 1;
        if (signal?.aborted) {
          return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
        }
        const next = queue.shift();
        if (next) return Promise.resolve(next);
        h.pendingSettled = false;
        return new Promise<{ done: boolean; value?: Uint8Array }>((resolve, reject) => {
          waiters.push({ resolve, reject });
        });
      },
      cancel: () => Promise.resolve(),
      releaseLock: () => {},
    };
    return {
      ok: true,
      status: 200,
      body: { getReader: () => reader },
    } as any;
  });
}

// ── Render helper ─────────────────────────────────────────────────────────────
async function renderChat() {
  // The route module reads localStorage voice settings + uses scrollIntoView.
  (Element.prototype as any).scrollIntoView = vi.fn();
  const mod = await import("@/routes/_authenticated/hivemind.chat");
  const Chat = (mod.Route as any).component as React.ComponentType;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    render(
      <QueryClientProvider client={qc}>
        {/* The TanStack Start vite transform can make route components lazy —
            a Suspense boundary keeps the first mount from suspending unhandled. */}
        <React.Suspense fallback={<div>loading…</div>}>
          <Chat />
        </React.Suspense>
      </QueryClientProvider>,
    );
  });
  // Wait for seeded history so the page is fully mounted. Generous timeout:
  // under the app-level vite config the route component loads lazily.
  await screen.findByText("Prior answer", {}, { timeout: 10_000 });
}

async function sendQuestion(text: string) {
  const box = screen.getByPlaceholderText("Ask HiveMind anything…");
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: "Enter" });
  // The Stop control replaces Send while streaming.
  await screen.findByTitle("Stop generating");
  await waitFor(() => expect(harness).not.toBeNull());
}

describe("HiveMind chat — Stop button aborts a streaming answer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    aiFallbackFn.mockClear();
    persistMock.mockClear();
    emitNothing = false;
    installFetchMock();
    localStorage.clear();
  });
  afterEach(() => cleanup());

  it("mid-stream abort keeps streamed text, appends (Stopped), and tears down the connection", { timeout: 30_000 }, async () => {
    await renderChat();
    await sendQuestion("Give me a long answer");

    expect(harness!.url).toBe("/api/hivemind/chat-stream");
    // First token rendered incrementally.
    await screen.findByText(/Hello from HiveMind/);
    expect(harness!.signal?.aborted).toBe(false);

    fireEvent.click(screen.getByTitle("Stop generating"));

    // Streamed text is kept and the stopped marker renders.
    await screen.findByText(/\(Stopped\)/);
    expect(document.body.textContent).toContain("Hello from HiveMind");

    // Abort reached the network layer and the in-flight read settled —
    // nothing is left waiting on the connection.
    expect(harness!.signal?.aborted).toBe(true);
    await waitFor(() => expect(harness!.pendingSettled).toBe(true));

    // UI left the thinking state: Stop is gone, input re-enabled.
    await waitFor(() => expect(screen.queryByTitle("Stop generating")).toBeNull());
    expect((screen.getByPlaceholderText("Ask HiveMind anything…") as HTMLTextAreaElement).disabled).toBe(false);

    // Abort must NOT trigger the non-streaming fallback (that would restart the answer).
    expect(aiFallbackFn).not.toHaveBeenCalled();
    // The half-finished message must not be persisted as a completed exchange.
    expect(persistMock).not.toHaveBeenCalled();
  });

  it('abort before any token renders the bare "Stopped." state', { timeout: 30_000 }, async () => {
    emitNothing = true;
    await renderChat();
    await sendQuestion("Another question");

    fireEvent.click(screen.getByTitle("Stop generating"));

    await screen.findByText("Stopped.");
    expect(harness!.signal?.aborted).toBe(true);
    await waitFor(() => expect(harness!.pendingSettled).toBe(true));
    await waitFor(() => expect(screen.queryByTitle("Stop generating")).toBeNull());
    expect(aiFallbackFn).not.toHaveBeenCalled();
  });

  it("a later token cannot resurrect a stopped message", { timeout: 30_000 }, async () => {
    await renderChat();
    await sendQuestion("One more");
    await screen.findByText(/Hello from HiveMind/);

    fireEvent.click(screen.getByTitle("Stop generating"));
    await screen.findByText(/\(Stopped\)/);

    // Simulate a straggler token arriving after abort — it must be ignored
    // (the waiter list was rejected; queued data has no reader anymore).
    await act(async () => {
      harness!.emitToken(" LATE TOKEN");
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(document.body.textContent).not.toContain("LATE TOKEN");
    await waitFor(() => expect(screen.queryByTitle("Stop generating")).toBeNull());
  });
});
