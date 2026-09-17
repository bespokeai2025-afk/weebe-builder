import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type KeyboardEvent } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useBuilderStore } from "@/lib/builder/store";
import {
  collectFlowVariables,
  filterFlowVariables,
  incompleteVariableToken,
  insertVariableToken,
  sourceLabel,
  type FlowVariableRef,
} from "@/lib/builder/flow-variables";

export function useFlowVariables(): FlowVariableRef[] {
  const nodes = useBuilderStore((s) => s.nodes);
  const declared = useBuilderStore((s) => s.variables);
  return useMemo(() => collectFlowVariables(nodes, declared), [nodes, declared]);
}

function VariableMenu({
  items,
  active,
  onPick,
}: {
  items: FlowVariableRef[];
  active: number;
  onPick: (name: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <ul
      role="listbox"
      className="nodrag nopan nowheel absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-md border bg-popover py-1 text-xs shadow-md"
    >
      {items.map((item, i) => (
        <li key={`${item.source}-${item.name}-${item.nodeId ?? ""}`}>
          <button
            type="button"
            role="option"
            aria-selected={i === active}
            className={cn(
              "flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left",
              i === active ? "bg-accent text-accent-foreground" : "hover:bg-muted",
            )}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(item.name);
            }}
          >
            <span className="font-mono truncate">{`{{${item.name}}}`}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">{sourceLabel(item.source)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function useTokenMenu(
  value: string,
  onValueChange: (next: string) => void,
  extraVars?: FlowVariableRef[],
) {
  const storeVars = useFlowVariables();
  const variables = extraVars ?? storeVars;

  /**
   * Local draft, because the value can come back a render late.
   *
   * On the canvas the field is bound to React Flow's `data` prop, which is one
   * hop behind the builder store. That extra hop meant the field re-rendered
   * with the *previous* string, React wrote it to the DOM, and the caret was
   * dragged to the end — so editing mid-sentence typed one character in place
   * and then jumped to the end of the box.
   *
   * The draft is authoritative while this field is the one making changes. An
   * incoming value is adopted only when it differs from what we last emitted,
   * which is exactly the case for a real external change (undo, flow load,
   * another editor) and never the case for the parent echoing our own edit.
   */
  const [draft, setDraft] = useState(value);
  const emittedRef = useRef(value);
  useEffect(() => {
    if (value === emittedRef.current) return;
    emittedRef.current = value;
    setDraft(value);
  }, [value]);

  const emit = (next: string) => {
    emittedRef.current = next;
    setDraft(next);
    onValueChange(next);
  };

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const cursorRef = useRef(0);
  const items = useMemo(() => filterFlowVariables(variables, query).slice(0, 12), [variables, query]);

  /**
   * Caret restoration after inserting a token.
   *
   * `pick()` rewrites the whole string, so on the next render the browser puts
   * the caret at the end — inserting a variable in the middle of a sentence
   * threw you to the bottom of the box and you had to click back. The element
   * is registered here so the hook can put the caret back where the insert
   * finished, straight after the closing braces.
   */
  const elementRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const restoreToRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const target = restoreToRef.current;
    if (target === null) return;
    restoreToRef.current = null;
    const el = elementRef.current;
    if (!el) return;
    const pos = Math.min(target, el.value.length);
    try {
      el.focus();
      el.setSelectionRange(pos, pos);
    } catch {
      /* selection is unsupported on some input types — harmless */
    }
  }, [draft]);

  const syncFrom = (text: string, cursor: number) => {
    cursorRef.current = cursor;
    const token = incompleteVariableToken(text, cursor);
    if (!token) {
      setOpen(false);
      return;
    }
    setQuery(token.query);
    setActive(0);
    setOpen(true);
  };

  const pick = (name: string) => {
    const next = insertVariableToken(draft, cursorRef.current, name);
    emit(next.text);
    cursorRef.current = next.cursor;
    // Applied in the layout effect above, once the new value has rendered.
    restoreToRef.current = next.cursor;
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (!open || items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + items.length) % items.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      pick(items[active]!.name);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  };

  /** Callback ref — avoids variance problems between input and textarea refs. */
  const registerElement = (el: HTMLInputElement | HTMLTextAreaElement | null) => {
    elementRef.current = el;
  };

  return { open, items, active, pick, syncFrom, onKeyDown, setOpen, registerElement, draft, emit };
}

type TextareaProps = Omit<ComponentProps<typeof Textarea>, "onChange" | "value"> & {
  value: string;
  onValueChange: (value: string) => void;
};

export function VariableTextarea({
  value,
  onValueChange,
  className,
  onKeyDown,
  onBlur,
  ...props
}: TextareaProps) {
  const menu = useTokenMenu(value, onValueChange);
  return (
    <div className="relative min-w-0 w-full flex-1">
      <Textarea
        {...props}
        ref={menu.registerElement}
        value={menu.draft}
        className={cn("w-full min-w-0", className)}
        onChange={(e) => {
          menu.emit(e.target.value);
          menu.syncFrom(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onSelect={(e) => {
          const el = e.currentTarget;
          menu.syncFrom(el.value, el.selectionStart ?? el.value.length);
        }}
        onKeyDown={(e) => {
          menu.onKeyDown(e);
          onKeyDown?.(e);
        }}
        onBlur={(e) => {
          window.setTimeout(() => menu.setOpen(false), 120);
          onBlur?.(e);
        }}
      />
      {menu.open && <VariableMenu items={menu.items} active={menu.active} onPick={menu.pick} />}
    </div>
  );
}

type InputProps = Omit<ComponentProps<typeof Input>, "onChange" | "value"> & {
  value: string;
  onValueChange: (value: string) => void;
};

export function VariableInput({
  value,
  onValueChange,
  className,
  onKeyDown,
  onBlur,
  ...props
}: InputProps) {
  const menu = useTokenMenu(value, onValueChange);
  return (
    <div className="relative flex-1 min-w-0">
      <Input
        {...props}
        ref={menu.registerElement}
        value={menu.draft}
        className={className}
        onChange={(e) => {
          menu.emit(e.target.value);
          menu.syncFrom(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onSelect={(e) => {
          const el = e.currentTarget;
          menu.syncFrom(el.value, el.selectionStart ?? el.value.length);
        }}
        onKeyDown={(e) => {
          menu.onKeyDown(e);
          onKeyDown?.(e);
        }}
        onBlur={(e) => {
          window.setTimeout(() => menu.setOpen(false), 120);
          onBlur?.(e);
        }}
      />
      {menu.open && <VariableMenu items={menu.items} active={menu.active} onPick={menu.pick} />}
    </div>
  );
}

/** Unstyled input for canvas node cards. */
export function VariableBareInput({
  value,
  onValueChange,
  className,
  onKeyDown,
  onBlur,
  onClick,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  value: string;
  onValueChange: (value: string) => void;
}) {
  const menu = useTokenMenu(value, onValueChange);
  return (
    <div className="relative min-w-0 flex-1">
      <input
        {...props}
        ref={menu.registerElement}
        value={menu.draft}
        className={className}
        onChange={(e) => {
          menu.emit(e.target.value);
          menu.syncFrom(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onSelect={(e) => {
          const el = e.currentTarget;
          menu.syncFrom(el.value, el.selectionStart ?? el.value.length);
        }}
        onKeyDown={(e) => {
          menu.onKeyDown(e);
          onKeyDown?.(e);
        }}
        onBlur={(e) => {
          window.setTimeout(() => menu.setOpen(false), 120);
          onBlur?.(e);
        }}
        onClick={onClick}
      />
      {menu.open && <VariableMenu items={menu.items} active={menu.active} onPick={menu.pick} />}
    </div>
  );
}

/** Auto-growing textarea for canvas transition prompts so long conditions stay visible. */
export function VariableBareTextarea({
  value,
  onValueChange,
  className,
  onKeyDown,
  onBlur,
  onClick,
  autoFocus,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  value: string;
  onValueChange: (value: string) => void;
}) {
  const menu = useTokenMenu(value, onValueChange);
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(22, el.scrollHeight)}px`;
  }, [value]);

  useLayoutEffect(() => {
    if (!autoFocus) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    try {
      el.setSelectionRange(end, end);
    } catch {
      /* ignore */
    }
  }, [autoFocus]);

  return (
    <div className="relative min-w-0 flex-1">
      <textarea
        {...props}
        ref={(el) => {
          ref.current = el;
          menu.registerElement(el);
        }}
        rows={1}
        value={menu.draft}
        className={className}
        onChange={(e) => {
          menu.emit(e.target.value);
          const el = e.currentTarget;
          el.style.height = "auto";
          el.style.height = `${Math.max(22, el.scrollHeight)}px`;
          menu.syncFrom(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onSelect={(e) => {
          const el = e.currentTarget;
          menu.syncFrom(el.value, el.selectionStart ?? el.value.length);
        }}
        onKeyDown={(e) => {
          menu.onKeyDown(e);
          onKeyDown?.(e);
        }}
        onBlur={(e) => {
          window.setTimeout(() => menu.setOpen(false), 120);
          onBlur?.(e);
        }}
        onClick={onClick}
      />
      {menu.open && <VariableMenu items={menu.items} active={menu.active} onPick={menu.pick} />}
    </div>
  );
}
