// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { VariableTextarea } from "@/components/builder/VariableAutocompleteField";

afterEach(cleanup);

/**
 * Mirrors how the node editor drives these fields: value lives in the parent,
 * every keystroke round-trips through it. That round-trip is where a caret
 * jump shows up — editing mid-sentence should not throw the caret to the end.
 */
function Controlled({ initial }: { initial: string }) {
  const [text, setText] = useState(initial);
  return (
    <VariableTextarea
      aria-label="field"
      value={text}
      onValueChange={setText}
    />
  );
}

/** Type one character at `pos`, the way a browser would. */
function typeAt(el: HTMLTextAreaElement, pos: number, ch: string) {
  el.setSelectionRange(pos, pos);
  const next = el.value.slice(0, pos) + ch + el.value.slice(pos);
  fireEvent.change(el, { target: { value: next, selectionStart: pos + ch.length } });
}

/**
 * The canvas node card binds `value` to React Flow's `data` prop, which is a
 * hop behind our Zustand store. So the field can re-render with the previous
 * string before the new one arrives — that stale write is what moves the
 * caret. This wrapper reproduces that lag.
 */
function Lagging({ initial }: { initial: string }) {
  const [committed, setCommitted] = useState(initial);
  const [, force] = useState(0);
  return (
    <VariableTextarea
      aria-label="lagging"
      value={committed}
      onValueChange={(next) => {
        // Re-render once with the OLD value still in place, as the extra hop does.
        force((n) => n + 1);
        setTimeout(() => setCommitted(next), 0);
      }}
    />
  );
}

describe("caret position while editing a node field mid-text", () => {
  it("keeps the caret after the typed character, not at the end", () => {
    render(<Controlled initial="hello world" />);
    const el = screen.getByLabelText("field") as HTMLTextAreaElement;

    typeAt(el, 5, "X");
    expect(el.value).toBe("helloX world");
    // The bug: caret lands at el.value.length instead of 6.
    expect(el.selectionStart).toBe(6);
  });

  it("stays put across several consecutive mid-text edits", () => {
    render(<Controlled initial="hello world" />);
    const el = screen.getByLabelText("field") as HTMLTextAreaElement;

    typeAt(el, 5, "A");
    typeAt(el, 6, "B");
    typeAt(el, 7, "C");
    expect(el.value).toBe("helloABC world");
    expect(el.selectionStart).toBe(8);
  });

  it("still appends normally when typing at the end", () => {
    render(<Controlled initial="abc" />);
    const el = screen.getByLabelText("field") as HTMLTextAreaElement;
    typeAt(el, 3, "d");
    expect(el.value).toBe("abcd");
    expect(el.selectionStart).toBe(4);
  });

  it("survives a parent that delivers the new value a render late", async () => {
    render(<Lagging initial="hello world" />);
    const el = screen.getByLabelText("lagging") as HTMLTextAreaElement;

    typeAt(el, 5, "X");
    // The stale re-render must not drag the caret to the end.
    expect(el.selectionStart).toBe(6);
    await new Promise((r) => setTimeout(r, 5));
    expect(el.value).toBe("helloX world");
    expect(el.selectionStart).toBe(6);
  });

  it("still adopts a genuine external change (undo, flow load)", () => {
    // The draft must not shut out real updates from elsewhere.
    function External() {
      const [text, setText] = useState("original");
      return (
        <>
          <VariableTextarea aria-label="ext" value={text} onValueChange={setText} />
          <button type="button" onClick={() => setText("replaced by undo")}>
            undo
          </button>
        </>
      );
    }
    render(<External />);
    const el = screen.getByLabelText("ext") as HTMLTextAreaElement;
    typeAt(el, 8, "!");
    expect(el.value).toBe("original!");

    fireEvent.click(screen.getByText("undo"));
    expect(el.value).toBe("replaced by undo");
  });

  it("does not resurrect a stale draft after an external replace", () => {
    function External() {
      const [text, setText] = useState("aaa");
      return (
        <>
          <VariableTextarea aria-label="ext2" value={text} onValueChange={setText} />
          <button type="button" onClick={() => setText("zzz")}>swap</button>
        </>
      );
    }
    render(<External />);
    const el = screen.getByLabelText("ext2") as HTMLTextAreaElement;
    typeAt(el, 3, "b");
    fireEvent.click(screen.getByText("swap"));
    expect(el.value).toBe("zzz");
    typeAt(el, 3, "!");
    expect(el.value).toBe("zzz!");
  });
});
