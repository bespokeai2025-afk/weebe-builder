// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";

afterEach(cleanup);

/**
 * Reproduces the duplicate-send bug from the Avenue Elite inbox: one reply was
 * delivered to the customer five times within ~1.7s, as five distinct WhatsApp
 * message ids.
 *
 * Cause: the send button was disabled while a request was in flight, but the
 * Enter-key handler was not, and the draft was only cleared on success — so
 * every Enter press during the round-trip fired another WATI call with the
 * same text still in the box.
 *
 * This mirrors the component's guard (synchronous ref + clear-on-submit)
 * rather than mounting the whole inbox, which needs Supabase and a router.
 */
function Composer({ onSend }: { onSend: (body: string) => Promise<void> }) {
  const [reply, setReply] = useState("");
  const [pending, setPending] = useState(false);
  const sendingRef = useRef(false);

  const submitReply = () => {
    // A ref, not `pending`: two keydowns in the same tick would both read
    // React state as false before a re-render lands.
    if (sendingRef.current || pending) return;
    const body = reply.trim();
    if (!body) return;
    sendingRef.current = true;
    setPending(true);
    setReply("");
    void onSend(body).finally(() => {
      sendingRef.current = false;
      setPending(false);
    });
  };

  return (
    <textarea
      aria-label="reply"
      value={reply}
      onChange={(e) => setReply(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          submitReply();
        }
      }}
    />
  );
}

describe("inbox composer send guard", () => {
  it("sends once when Enter is mashed during an in-flight request", async () => {
    let resolveSend: (() => void) | undefined;
    const onSend = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = resolve;
        }),
    );
    render(<Composer onSend={onSend} />);
    const box = screen.getByLabelText("reply") as HTMLTextAreaElement;

    fireEvent.change(box, { target: { value: "Glad to hear" } });
    for (let i = 0; i < 5; i++) {
      fireEvent.keyDown(box, { key: "Enter" });
    }

    // Previously: five presses, five WATI calls, five messages delivered.
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith("Glad to hear");

    resolveSend?.();
  });

  it("clears the draft on submit so a repeat press has nothing to resend", () => {
    const onSend = vi.fn(() => new Promise<void>(() => {}));
    render(<Composer onSend={onSend} />);
    const box = screen.getByLabelText("reply") as HTMLTextAreaElement;

    fireEvent.change(box, { target: { value: "Hello" } });
    fireEvent.keyDown(box, { key: "Enter" });

    expect(box.value).toBe("");
  });

  it("ignores Enter on an empty or whitespace-only draft", () => {
    const onSend = vi.fn(() => Promise.resolve());
    render(<Composer onSend={onSend} />);
    const box = screen.getByLabelText("reply") as HTMLTextAreaElement;

    fireEvent.keyDown(box, { key: "Enter" });
    fireEvent.change(box, { target: { value: "   " } });
    fireEvent.keyDown(box, { key: "Enter" });

    expect(onSend).not.toHaveBeenCalled();
  });

  it("allows a genuine second message once the first send settles", async () => {
    const onSend = vi.fn(() => Promise.resolve());
    render(<Composer onSend={onSend} />);
    const box = screen.getByLabelText("reply") as HTMLTextAreaElement;

    fireEvent.change(box, { target: { value: "first" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await Promise.resolve();
    await Promise.resolve();

    fireEvent.change(box, { target: { value: "second" } });
    fireEvent.keyDown(box, { key: "Enter" });

    expect(onSend).toHaveBeenCalledTimes(2);
    expect(onSend).toHaveBeenLastCalledWith("second");
  });

  it("does not send on Shift+Enter (newline, not submit)", () => {
    const onSend = vi.fn(() => Promise.resolve());
    render(<Composer onSend={onSend} />);
    const box = screen.getByLabelText("reply") as HTMLTextAreaElement;

    fireEvent.change(box, { target: { value: "line one" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });

    expect(onSend).not.toHaveBeenCalled();
  });
});
