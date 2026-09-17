/**
 * Editor for a JSON body/parameter schema.
 *
 * The plain textarea it replaces showed whatever the user (or an import)
 * pasted — in practice minified JSON wrapped across four rows, which is
 * unreadable and hides the shape of the schema entirely.
 *
 * Three changes: it pretty-prints (on demand and on blur), it says whether the
 * JSON parses, and it names the top-level properties so the shape is visible
 * without reading the braces. Editing stays free-text on purpose — a schema is
 * often pasted mid-edit and briefly invalid, and a structured form that refuses
 * to hold invalid text would make that impossible.
 */
import { useMemo, useState } from "react";
import { AlertCircle, Check, Braces } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Parsed =
  | { ok: true; value: unknown; keys: string[]; required: string[] }
  | { ok: false; error: string };

function parseSchema(text: string): Parsed | null {
  const t = text.trim();
  if (!t) return null;
  try {
    const value = JSON.parse(t) as Record<string, unknown>;
    const props = value?.properties;
    const keys =
      props && typeof props === "object" ? Object.keys(props as Record<string, unknown>) : [];
    const required = Array.isArray(value?.required) ? (value.required as string[]).map(String) : [];
    return { ok: true, value, keys, required };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Invalid JSON" };
  }
}

export function JsonSchemaField({
  value,
  onValueChange,
  rows = 8,
  placeholder = '{"type":"object","properties":{}}',
}: {
  value: string;
  onValueChange: (next: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  const [touched, setTouched] = useState(false);
  const parsed = useMemo(() => parseSchema(value), [value]);

  const format = () => {
    if (!parsed?.ok) return;
    onValueChange(JSON.stringify(parsed.value, null, 2));
  };

  return (
    <div className="space-y-1.5">
      <Textarea
        rows={rows}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        onBlur={() => {
          setTouched(true);
          // Tidy once the user is done, never mid-keystroke.
          if (parsed?.ok && !value.includes("\n")) format();
        }}
        placeholder={placeholder}
        spellCheck={false}
        className={cn(
          "font-mono text-[11px] leading-relaxed",
          touched && parsed && !parsed.ok && "border-destructive/60",
        )}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-6 px-1.5 text-[10px]"
          disabled={!parsed?.ok}
          onClick={format}
        >
          <Braces className="mr-1 h-3 w-3" />
          Format
        </Button>

        {parsed?.ok && (
          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400">
            <Check className="h-3 w-3" />
            Valid JSON
          </span>
        )}
        {parsed && !parsed.ok && (
          <span className="inline-flex items-center gap-1 text-[10px] text-destructive">
            <AlertCircle className="h-3 w-3" />
            {parsed.error.slice(0, 60)}
          </span>
        )}
      </div>

      {/* The shape, without making anyone parse braces in a small textarea. */}
      {parsed?.ok && parsed.keys.length > 0 && (
        <div className="flex flex-wrap gap-1 rounded-md border border-white/[0.06] bg-white/[0.02] p-1.5">
          {parsed.keys.map((k) => (
            <span
              key={k}
              className="inline-flex items-center gap-1 rounded bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10px]"
            >
              {k}
              {parsed.required.includes(k) && <span className="text-destructive">*</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
