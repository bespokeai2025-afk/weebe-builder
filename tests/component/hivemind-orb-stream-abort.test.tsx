// ── HiveMind floating orb mini-chat Stop button test (Task #526) ─────────────
// Renders the REAL floating orb (HiveMindOrb → MiniChat) with the REAL
// streamHiveMindChat client, mocks only the network layer, and verifies the
// mini-chat offers the same mid-answer stop control as the Assistant page:
//   1. Mid-stream abort keeps streamed text and appends "(Stopped)".
//   2. Abort before any token renders the bare "Stopped." state.
//   3. The AbortSignal reaches fetch and the in-flight read settles.
//   4. The UI leaves the "thinking" state (Stop swaps back to Send) and the
//      non-streaming fallback is NOT invoked on abort.
//   5. The half-finished exchange is not persisted.
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";

// ── Module mocks (network / server / router boundaries only) ─────────────────
const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  // The orb hides itself on /hivemind pages — report a normal app page.
  useRouterState: ({ select }: { select: (s: any) => any }) =>
    select({ location: { pathname: "/dashboard" } }),
  useNavigate: () => navigateMock,
}));
vi.mock("@tanstack/react-start", () => ({
  useServerFn: (fn: any) => fn,
}));

const aiFallbackFn = vi.fn(async () => ({ response: "fallback", workOrderProposals: [] }));
vi.mock("@/lib/hivemind/hivemind.ai", () => ({
  getHiveMindAIResponse: (...a: any[]) => aiFallbackFn(...a),
  getHiveMindTTS: vi.fn(async () => ({ audioBase64: null })),
}));
const persistMock = vi.fn(async () => true);
vi.mock("@/hooks/useMindConversation", () => ({
  useMindConversation: () => ({
    conversationId: "conv-1",
    initialMessages: [],
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
async function renderOrbChat() {
  (Element.prototype as any).scrollIntoView = vi.fn();
  const { HiveMindOrb } = await import("@/components/hivemind/HiveMindOrb");
  await act(async () => {
    render(<HiveMindOrb />);
  });
  // Single click opens the mini chat after a ~220ms single/double-click debounce.
  fireEvent.click(screen.getByLabelText("Open HiveMind Executive Assistant (drag to move)"));
  await screen.findByPlaceholderText("Ask HiveMind…", {}, { timeout: 5_000 });
  // Greeting confirms the panel is fully mounted.
  await screen.findByText(/online/i);
}

async function sendQuestion(text: string) {
  const box = screen.getByPlaceholderText("Ask HiveMind…");
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: "Enter" });
  // The Stop control replaces Send while streaming.
  await screen.findByTitle("Stop generating");
  await waitFor(() => expect(harness).not.toBeNull());
}

describe("HiveMind orb mini-chat — Stop button aborts a streaming answer", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    aiFallbackFn.mockClear();
    persistMock.mockClear();
    navigateMock.mockClear();
    emitNothing = false;
    installFetchMock();
    localStorage.clear();
  });
  afterEach(() => cleanup());

  it("mid-stream abort keeps streamed text, appends (Stopped), and tears down the connection", { timeout: 30_000 }, async () => {
    await renderOrbChat();
    await sendQuestion("Give me a long answer");

    expect(harness!.url).toBe("/api/hivemind/chat-stream");
    // First token rendered incrementally.
    await screen.findByText(/Hello from HiveMind/);
    expect(harness!.signal?.aborted).toBe(false);

    fireEvent.click(screen.getByTitle("Stop generating"));

    // Streamed text is kept and the stopped marker renders.
    await screen.findByText(/\(Stopped\)/);
    expect(document.body.textContent).toContain("Hello from HiveMind");

    // Abort reached the network layer and the in-flight read settled.
    expect(harness!.signal?.aborted).toBe(true);
    await waitFor(() => expect(harness!.pendingSettled).toBe(true));

    // UI left the thinking state: Stop swapped back to Send.
    await waitFor(() => expect(screen.queryByTitle("Stop generating")).toBeNull());

    // Abort must NOT trigger the non-streaming fallback (that would restart the answer).
    expect(aiFallbackFn).not.toHaveBeenCalled();
    // The half-finished message must not be persisted as a completed exchange.
    expect(persistMock).not.toHaveBeenCalled();
  });

  it('abort before any token renders the bare "Stopped." state', { timeout: 30_000 }, async () => {
    emitNothing = true;
    await renderOrbChat();
    await sendQuestion("Another question");

    fireEvent.click(screen.getByTitle("Stop generating"));

    await screen.findByText("Stopped.");
    expect(harness!.signal?.aborted).toBe(true);
    await waitFor(() => expect(harness!.pendingSettled).toBe(true));
    await waitFor(() => expect(screen.queryByTitle("Stop generating")).toBeNull());
    expect(aiFallbackFn).not.toHaveBeenCalled();
  });

  it("a later token cannot resurrect a stopped message", { timeout: 30_000 }, async () => {
    await renderOrbChat();
    await sendQuestion("One more");
    await screen.findByText(/Hello from HiveMind/);

    fireEvent.click(screen.getByTitle("Stop generating"));
    await screen.findByText(/\(Stopped\)/);

    // Simulate a straggler token arriving after abort — it must be ignored.
    await act(async () => {
      harness!.emitToken(" LATE TOKEN");
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(document.body.textContent).not.toContain("LATE TOKEN");
    await waitFor(() => expect(screen.queryByTitle("Stop generating")).toBeNull());
  });
});
