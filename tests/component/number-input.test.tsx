// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { NumberInput } from "@/components/ui/number-input";

function setup(initial = 50) {
  let value = initial;
  const onValueChange = (next: number) => {
    value = next;
  };
  const utils = render(
    <NumberInput
      value={initial}
      onValueChange={onValueChange}
      min={1}
      max={5000}
      fallback={50}
      aria-label="batch"
    />,
  );
  return { input: screen.getByLabelText("batch") as HTMLInputElement, get value() { return value; }, utils };
}

afterEach(cleanup);

describe("NumberInput", () => {
  it("lets the field be cleared instead of snapping back to the old number", () => {
    const { input } = setup(50);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    // Previously "" parsed to NaN and fell back to 50 on the spot, making the
    // field impossible to clear.
    expect(input.value).toBe("");
  });

  it("accepts a freshly typed number after clearing", () => {
    const { input } = setup(50);
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.change(input, { target: { value: "100" } });
    fireEvent.blur(input);
    expect(input.value).toBe("100");
  });

  it("commits the typed value to the caller on blur", () => {
    const state = setup(50);
    fireEvent.focus(state.input);
    fireEvent.change(state.input, { target: { value: "100" } });
    fireEvent.blur(state.input);
    expect(state.value).toBe(100);
  });

  it("falls back only when the field is left empty", () => {
    const state = setup(50);
    fireEvent.focus(state.input);
    fireEvent.change(state.input, { target: { value: "" } });
    fireEvent.blur(state.input);
    expect(state.input.value).toBe("50");
  });

  it("clamps to min and max on commit, not while typing", () => {
    const state = setup(50);
    fireEvent.focus(state.input);
    fireEvent.change(state.input, { target: { value: "99999" } });
    // Still free-form mid-edit.
    expect(state.input.value).toBe("99999");
    fireEvent.blur(state.input);
    expect(state.input.value).toBe("5000");
    expect(state.value).toBe(5000);
  });

  it("commits on Enter without needing to blur", () => {
    const state = setup(50);
    fireEvent.focus(state.input);
    fireEvent.change(state.input, { target: { value: "120" } });
    fireEvent.keyDown(state.input, { key: "Enter" });
    expect(state.value).toBe(120);
  });
});
