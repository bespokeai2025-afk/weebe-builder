import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";

/**
 * Number field that can actually be edited.
 *
 * A controlled `<Input type="number">` whose onChange does
 * `parseInt(value) || fallback` cannot be cleared: backspacing to an empty
 * string parses to NaN, falls through to the fallback, and the old number
 * reappears instantly. The only way to change 50 to 100 is to edit the digits
 * in place — which is what people were hitting.
 *
 * So hold the raw text while the field has focus and let it be empty or
 * half-typed, then parse and clamp once on blur. The committed value stays a
 * number, so callers are unchanged.
 */
export function NumberInput({
  value,
  onValueChange,
  min,
  max,
  fallback,
  className,
  ...rest
}: {
  value: number;
  onValueChange: (next: number) => void;
  min?: number;
  max?: number;
  /** Used when the field is left empty. Defaults to `min`, else 0. */
  fallback?: number;
  className?: string;
} & Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "type" | "min" | "max">) {
  const [draft, setDraft] = useState<string>(String(value));
  const editing = useRef(false);

  // Track external changes (reset, preset buttons) unless the user is mid-edit.
  useEffect(() => {
    if (!editing.current) setDraft(String(value));
  }, [value]);

  const commit = () => {
    editing.current = false;
    const parsed = Number.parseInt(draft, 10);
    const base = Number.isFinite(parsed) ? parsed : (fallback ?? min ?? 0);
    let next = base;
    if (typeof min === "number") next = Math.max(min, next);
    if (typeof max === "number") next = Math.min(max, next);
    setDraft(String(next));
    if (next !== value) onValueChange(next);
  };

  return (
    <Input
      {...rest}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      className={className}
      value={draft}
      onFocus={(e) => {
        editing.current = true;
        rest.onFocus?.(e);
      }}
      onChange={(e) => {
        editing.current = true;
        setDraft(e.target.value);
      }}
      onBlur={(e) => {
        commit();
        rest.onBlur?.(e);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        rest.onKeyDown?.(e);
      }}
    />
  );
}
