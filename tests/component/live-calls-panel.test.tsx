import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, cleanup, fireEvent } from "@testing-library/react";
import React from "react";

type AuthCallback = (
  event: string,
  session: { access_token: string } | null,
) => void;

const authState = {
  session: null as { access_token: string } | null,
  refreshResult: {
    data: { session: null as { access_token: string } | null },
    error: null as { message: string } | null,
  },
  callbacks: [] as AuthCallback[],
  unsubscribe: vi.fn(),
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: authState.session } })),
      refreshSession: vi.fn(async () => authState.refreshResult),
      onAuthStateChange: vi.fn((cb: AuthCallback) => {
        authState.callbacks.push(cb);
        return { data: { subscription: { unsubscribe: authState.unsubscribe } } };
      }),
    },
  },
}));

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((evt: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }
}

import { LiveCallsPanel } from "@/components/dashboard/LiveCallsPanel";

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function lastEs(): MockEventSource {
  const es = MockEventSource.instances[MockEventSource.instances.length - 1];
  if (!es) throw new Error("no EventSource created");
  return es;
}

async function fireAuthEvent(
  event: string,
  session: { access_token: string } | null,
) {
  await act(async () => {
    for (const cb of authState.callbacks) cb(event, session);
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  MockEventSource.instances = [];
  authState.session = null;
  authState.refreshResult = { data: { session: null }, error: null };
  authState.callbacks = [];
  authState.unsubscribe = vi.fn();
  vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("LiveCallsPanel session recovery", () => {
  it("connects and shows streaming when a session token is available", async () => {
    authState.session = { access_token: "tok-1" };
    render(<LiveCallsPanel />);
    await flush();

    expect(MockEventSource.instances).toHaveLength(1);
    expect(lastEs().url).toContain("token=tok-1");

    await act(async () => {
      lastEs().onopen?.();
    });

    expect(screen.getByText("● streaming")).toBeTruthy();
  });

  it("shows the session-expired banner after repeated auth failures instead of retrying forever", async () => {
    authState.session = null;
    authState.refreshResult = {
      data: { session: null },
      error: { message: "refresh failed" },
    };

    render(<LiveCallsPanel />);
    await flush();

    // First attempt fails (no token) → "reconnecting…" with a slow retry.
    expect(screen.getByText("reconnecting…")).toBeTruthy();

    // Two more failed attempts exhaust the refresh-failure budget.
    await advance(15_000);
    await advance(15_000);

    expect(screen.getByText("session expired")).toBeTruthy();
    expect(
      screen.getByText(/Session expired — please sign in again/),
    ).toBeTruthy();
    expect(screen.getByText("Sign in again")).toBeTruthy();

    // No further retries are scheduled — it stays expired, not looping.
    const esCountBefore = MockEventSource.instances.length;
    await advance(60_000);
    expect(MockEventSource.instances.length).toBe(esCountBefore);
    expect(screen.getByText("session expired")).toBeTruthy();
  });

  it("auto-reconnects with the resuming banner when the user signs back in after expiry", async () => {
    authState.session = null;
    authState.refreshResult = {
      data: { session: null },
      error: { message: "refresh failed" },
    };

    render(<LiveCallsPanel />);
    await flush();
    await advance(15_000);
    await advance(15_000);
    expect(screen.getByText("session expired")).toBeTruthy();

    // User signs back in (e.g. another tab) — session is valid again.
    authState.session = { access_token: "tok-2" };
    authState.refreshResult = {
      data: { session: { access_token: "tok-2" } },
      error: null,
    };
    await fireAuthEvent("SIGNED_IN", { access_token: "tok-2" });

    // Transitional resuming banner replaces the red expired copy.
    expect(
      screen.getByText(/Signed in again — reconnecting live calls/),
    ).toBeTruthy();

    const es = lastEs();
    expect(es.url).toContain("token=tok-2");
    await act(async () => {
      es.onopen?.();
    });

    expect(screen.getByText("● streaming")).toBeTruthy();
    expect(screen.queryByText(/Session expired/)).toBeNull();
  });

  it("ignores TOKEN_REFRESHED while a stream is already up (no duplicate connections)", async () => {
    authState.session = { access_token: "tok-1" };
    render(<LiveCallsPanel />);
    await flush();
    await act(async () => {
      lastEs().onopen?.();
    });
    expect(MockEventSource.instances).toHaveLength(1);

    await fireAuthEvent("TOKEN_REFRESHED", { access_token: "tok-1b" });

    expect(MockEventSource.instances).toHaveLength(1);
    expect(lastEs().closed).toBe(false);
  });

  it("reconnects with exponential backoff after a stream error", async () => {
    authState.session = { access_token: "tok-1" };
    authState.refreshResult = {
      data: { session: { access_token: "tok-1" } },
      error: null,
    };
    render(<LiveCallsPanel />);
    await flush();
    const first = lastEs();
    await act(async () => {
      first.onopen?.();
    });

    await act(async () => {
      first.onerror?.();
    });
    expect(first.closed).toBe(true);
    expect(screen.getByText("reconnecting…")).toBeTruthy();

    // Backoff for the first failure is 3s.
    await advance(2_999);
    expect(MockEventSource.instances).toHaveLength(1);
    await advance(1);
    await flush();
    expect(MockEventSource.instances).toHaveLength(2);
  });

  it("renders incoming calls from stream messages", async () => {
    authState.session = { access_token: "tok-1" };
    render(<LiveCallsPanel />);
    await flush();
    const es = lastEs();
    await act(async () => {
      es.onopen?.();
    });

    await act(async () => {
      es.onmessage?.({
        data: JSON.stringify({
          calls: [
            {
              call_id: "c1",
              agent_name: "Ava",
              status: "live",
              call_status: "in_progress",
              direction: "inbound",
              call_type: "phone_call",
              from_number: "+441234567890",
              to_number: null,
              lead_name: "Jane Doe",
              start_timestamp: Date.now(),
              current_node_label: null,
              transcript: [{ role: "agent", content: "Hello, this is Ava." }],
            },
          ],
        }),
      });
    });

    expect(screen.getByText("1 active")).toBeTruthy();
    expect(screen.getByText("Ava")).toBeTruthy();
    expect(screen.getByText("Hello, this is Ava.")).toBeTruthy();
  });
});

type TranscriptLine = { role: string; content: string };

function makeCall(overrides: Record<string, unknown> = {}) {
  return {
    call_id: "c1",
    agent_name: "Ava",
    status: "live",
    call_status: "in_progress",
    direction: "inbound",
    call_type: "phone_call",
    from_number: "+441234567890",
    to_number: null,
    lead_name: "Jane Doe",
    start_timestamp: Date.now(),
    current_node_label: null,
    transcript: [] as TranscriptLine[],
    ...overrides,
  };
}

async function openStreamAndSend(calls: Record<string, unknown>[]) {
  authState.session = { access_token: "tok-1" };
  render(<LiveCallsPanel />);
  await flush();
  const es = lastEs();
  await act(async () => {
    es.onopen?.();
  });
  await act(async () => {
    es.onmessage?.({ data: JSON.stringify({ calls }) });
  });
  return es;
}

async function sendCalls(es: MockEventSource, calls: Record<string, unknown>[]) {
  await act(async () => {
    es.onmessage?.({ data: JSON.stringify({ calls }) });
  });
}

const OVERDUE_RE = /Live transcript unavailable/;
const WAITING_RE = /Waiting for Retell transcript_updated event/;

function getTranscriptContainer(): HTMLDivElement {
  const el = document.querySelector<HTMLDivElement>("div[style*='max-height']");
  if (!el) throw new Error("transcript container not found");
  return el;
}

describe("CallCard transcript-overdue warning", () => {
  it("shows the waiting indicator (not the warning) before 20s on a live call with no transcript", async () => {
    await openStreamAndSend([makeCall()]);

    expect(screen.getByText(WAITING_RE)).toBeTruthy();
    expect(screen.queryByText(OVERDUE_RE)).toBeNull();

    // Still under the 20s threshold.
    await advance(19_000);
    expect(screen.getByText(WAITING_RE)).toBeTruthy();
    expect(screen.queryByText(OVERDUE_RE)).toBeNull();
  });

  it("shows the webhook warning after 20s on a live call with an empty transcript", async () => {
    await openStreamAndSend([makeCall()]);

    await advance(21_000);
    expect(screen.getByText(OVERDUE_RE)).toBeTruthy();
    expect(screen.queryByText(WAITING_RE)).toBeNull();
  });

  it("never shows the warning once transcript lines exist, even after 20s", async () => {
    const es = await openStreamAndSend([makeCall()]);

    await sendCalls(es, [
      makeCall({
        transcript: [{ role: "agent", content: "Hello, this is Ava." }],
      }),
    ]);
    await advance(25_000);

    expect(screen.getByText("Hello, this is Ava.")).toBeTruthy();
    expect(screen.queryByText(OVERDUE_RE)).toBeNull();
  });

  it("shows 'No transcript recorded' (not the warning) for a completed call with no transcript", async () => {
    await openStreamAndSend([
      makeCall({
        status: "completed",
        call_status: "ended",
        start_timestamp: Date.now() - 60_000,
      }),
    ]);

    expect(screen.getByText(/No transcript recorded/)).toBeTruthy();
    expect(screen.queryByText(OVERDUE_RE)).toBeNull();

    await advance(25_000);
    expect(screen.getByText(/No transcript recorded/)).toBeTruthy();
    expect(screen.queryByText(OVERDUE_RE)).toBeNull();
  });
});

describe("CallCard transcript auto-scroll", () => {
  function mockScrollMetrics(el: HTMLElement, scrollHeight: number, clientHeight: number) {
    Object.defineProperty(el, "scrollHeight", {
      configurable: true,
      get: () => scrollHeight,
    });
    Object.defineProperty(el, "clientHeight", {
      configurable: true,
      get: () => clientHeight,
    });
  }

  function linesFor(n: number): TranscriptLine[] {
    return Array.from({ length: n }, (_, i) => ({
      role: i % 2 === 0 ? "agent" : "user",
      content: `Line ${i + 1}`,
    }));
  }

  it("sticks to the bottom when new transcript lines arrive and the user hasn't scrolled up", async () => {
    const es = await openStreamAndSend([makeCall({ transcript: linesFor(5) })]);

    const container = getTranscriptContainer();
    mockScrollMetrics(container, 600, 220);
    container.scrollTop = 380; // exactly at the bottom

    await sendCalls(es, [makeCall({ transcript: linesFor(6) })]);

    // Pinned to the (mocked) full scroll height.
    expect(container.scrollTop).toBe(600);
    expect(screen.getByText("Line 6")).toBeTruthy();
  });

  it("stays put when the user has scrolled up to read older lines", async () => {
    const es = await openStreamAndSend([makeCall({ transcript: linesFor(5) })]);

    const container = getTranscriptContainer();
    mockScrollMetrics(container, 600, 220);

    // User scrolls up well past the 40px stickiness threshold.
    container.scrollTop = 100;
    fireEvent.scroll(container);

    await sendCalls(es, [makeCall({ transcript: linesFor(6) })]);

    // New line rendered, but the scroll position was not yanked to the bottom.
    expect(screen.getByText("Line 6")).toBeTruthy();
    expect(container.scrollTop).toBe(100);
  });

  it("re-engages auto-scroll after the user scrolls back near the bottom", async () => {
    const es = await openStreamAndSend([makeCall({ transcript: linesFor(5) })]);

    const container = getTranscriptContainer();
    mockScrollMetrics(container, 600, 220);

    // Scroll up (unstick)…
    container.scrollTop = 100;
    fireEvent.scroll(container);
    // …then back to within 40px of the bottom (re-stick).
    container.scrollTop = 350;
    fireEvent.scroll(container);

    await sendCalls(es, [makeCall({ transcript: linesFor(6) })]);

    expect(container.scrollTop).toBe(600);
  });
});
