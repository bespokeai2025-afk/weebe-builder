// ── HiveMind orb mini-chat — Stop control vs TTS voice playback (Task #528) ──
// Renders the REAL floating orb (HiveMindOrb → MiniChat) with the REAL
// streamHiveMindChat client, mocking only the network / server / Audio
// boundaries, and verifies the interaction between stopping an answer and the
// orb's voice (TTS) playback:
//   1. Aborting a streaming answer never triggers getHiveMindTTS for it.
//   2. A completed answer DOES trigger TTS (control — proves the spy works).
//   3. Pressing Stop while a previous answer's audio is playing pauses it.
//   4. Closing the panel (X) stops any playing audio via stopAudio().
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";

// ── Module mocks (network / server / router boundaries only) ─────────────────
const navigateMock = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useRouterState: ({ select }: { select: (s: any) => any }) =>
    select({ location: { pathname: "/dashboard" } }),
  useNavigate: () => navigateMock,
}));
vi.mock("@tanstack/react-start", () => ({
  useServerFn: (fn: any) => fn,
}));

const ttsMock = vi.fn(async () => ({ audioBase64: "QUJD" })); // "ABC"
const aiFallbackFn = vi.fn(async () => ({ response: "fallback", workOrderProposals: [] }));
vi.mock("@/lib/hivemind/hivemind.ai", () => ({
  getHiveMindAIResponse: (...a: any[]) => aiFallbackFn(...a),
  getHiveMindTTS: (...a: any[]) => ttsMock(...a),
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

// ── Fake HTMLAudioElement so we can observe play()/pause() ───────────────────
class FakeAudio {
  static instances: FakeAudio[] = [];
  src: string;
  playbackRate = 1;
  paused = false;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play = vi.fn(async () => { this.paused = false; });
  pause = vi.fn(() => { this.paused = true; });
  constructor(src?: string) {
    this.src = src ?? "";
    FakeAudio.instances.push(this);
  }
}

// ── Controllable fetch mock for /api/hivemind/chat-stream ────────────────────
const enc = new TextEncoder();

type StreamHarness = {
  url: string;
  signal: AbortSignal | undefined;
  pendingSettled: boolean;
  emitToken: (text: string) => void;
  emitDone: () => void;
};

let harness: StreamHarness | null = null;
/** When true the first token is NOT auto-emitted. */
let manualStream = false;

function installFetchMock() {
  harness = null;
  (globalThis as any).fetch = vi.fn(async (url: any, init: any) => {
    const signal: AbortSignal | undefined = init?.signal;
    const queue: Array<{ done: boolean; value?: Uint8Array }> = [];
    const waiters: Array<{
      resolve: (r: { done: boolean; value?: Uint8Array }) => void;
      reject: (e: unknown) => void;
    }> = [];
    const push = (item: { done: boolean; value?: Uint8Array }) => {
      const w = waiters.shift();
      if (w) { h.pendingSettled = true; w.resolve(item); }
      else queue.push(item);
    };
    const h: StreamHarness = {
      url: String(url),
      signal,
      pendingSettled: true,
      emitToken: (text: string) =>
        push({ done: false, value: enc.encode(`data: ${JSON.stringify({ type: "token", text })}\n\n`) }),
      emitDone: () => {
        push({ done: false, value: enc.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`) });
        push({ done: true });
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
    if (!manualStream) h.emitToken("Hello from HiveMind");

    const reader = {
      read: () => {
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

// ── Render helpers ────────────────────────────────────────────────────────────
async function renderOrbChat() {
  (Element.prototype as any).scrollIntoView = vi.fn();
  const { HiveMindOrb } = await import("@/components/hivemind/HiveMindOrb");
  await act(async () => {
    render(<HiveMindOrb />);
  });
  fireEvent.click(screen.getByLabelText("Open HiveMind Executive Assistant (drag to move)"));
  await screen.findByPlaceholderText("Ask HiveMind…", {}, { timeout: 5_000 });
  await screen.findByText(/online/i);
}

async function sendQuestion(text: string) {
  const box = screen.getByPlaceholderText("Ask HiveMind…");
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: "Enter" });
  await screen.findByTitle("Stop generating");
  await waitFor(() => expect(harness).not.toBeNull());
}

/** Completes the in-flight answer and waits for TTS audio to start playing. */
async function completeAnswerAndWaitForAudio() {
  await screen.findByText(/Hello from HiveMind/);
  await act(async () => {
    harness!.emitDone();
    await new Promise((r) => setTimeout(r, 20));
  });
  await waitFor(() => expect(ttsMock).toHaveBeenCalled());
  await waitFor(() => expect(FakeAudio.instances.length).toBeGreaterThan(0));
  await waitFor(() => expect(FakeAudio.instances[0]!.play).toHaveBeenCalled());
}

describe("HiveMind orb mini-chat — stopping an answer also stops voice playback", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    ttsMock.mockClear();
    aiFallbackFn.mockClear();
    persistMock.mockClear();
    FakeAudio.instances = [];
    (globalThis as any).Audio = FakeAudio as any;
    manualStream = false;
    installFetchMock();
    localStorage.clear();
  });
  afterEach(() => cleanup());

  it("aborting a streaming answer never triggers TTS for it", { timeout: 30_000 }, async () => {
    await renderOrbChat();
    await sendQuestion("Give me a long answer");
    await screen.findByText(/Hello from HiveMind/);

    fireEvent.click(screen.getByTitle("Stop generating"));
    await screen.findByText(/\(Stopped\)/);
    await waitFor(() => expect(screen.queryByTitle("Stop generating")).toBeNull());

    // Give any stray async TTS kick-off a chance to fire — it must not.
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(ttsMock).not.toHaveBeenCalled();
    expect(FakeAudio.instances.length).toBe(0);
    expect(aiFallbackFn).not.toHaveBeenCalled();
  });

  it("a completed answer DOES trigger TTS playback (spy sanity check)", { timeout: 30_000 }, async () => {
    await renderOrbChat();
    await sendQuestion("Quick answer");
    await completeAnswerAndWaitForAudio();
    expect(FakeAudio.instances.length).toBe(1);
  });

  it("pressing Stop while a previous answer's audio is playing pauses it", { timeout: 30_000 }, async () => {
    await renderOrbChat();
    // First answer completes and starts speaking.
    await sendQuestion("First answer");
    await completeAnswerAndWaitForAudio();
    const firstAudio = FakeAudio.instances[0]!;
    expect(firstAudio.pause).not.toHaveBeenCalled();

    // Second question streams; user hits Stop while the first audio still plays.
    manualStream = true;
    ttsMock.mockClear();
    await sendQuestion("Second answer");
    fireEvent.click(screen.getByTitle("Stop generating"));

    await screen.findByText("Stopped.");
    expect(firstAudio.pause).toHaveBeenCalled();
    // And no new TTS/audio was started for the aborted answer.
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(ttsMock).not.toHaveBeenCalled();
    expect(FakeAudio.instances.length).toBe(1);
  });

  it("closing the panel (X) stops playing audio via stopAudio()", { timeout: 30_000 }, async () => {
    await renderOrbChat();
    await sendQuestion("Speak this");
    await completeAnswerAndWaitForAudio();
    const audio = FakeAudio.instances[0]!;
    expect(audio.pause).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText("Close"));
    expect(audio.pause).toHaveBeenCalled();
  });
});
