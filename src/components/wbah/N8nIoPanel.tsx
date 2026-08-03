/**
 * n8n-style I/O side panel — INPUT (left) or OUTPUT (right) with Schema / Table / JSON / Form.
 */
import { useMemo, useState } from "react";
import { Pin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  N8nDataViewer,
  n8nDataHasContent,
  type N8nDataViewMode,
} from "@/components/wbah/N8nDataViewer";

const VIEW_MODES: {
  id: N8nDataViewMode | "form";
  label: string;
  hint: string;
}[] = [
  { id: "schema", label: "Schema", hint: "Shows field names and types" },
  { id: "table", label: "Table", hint: "Spreadsheet-style rows and columns" },
  { id: "json", label: "JSON", hint: "Raw JSON — full object as text" },
  {
    id: "form",
    label: "Form",
    hint: "Same data as JSON, but each field as a labeled input (easier to edit)",
  },
];

function itemCount(data: unknown): number {
  if (data == null) return 0;
  if (Array.isArray(data)) return data.length;
  if (typeof data === "object") return 1;
  return 1;
}

function unwrapJson(data: unknown): Record<string, unknown> {
  if (Array.isArray(data)) {
    const first = data[0];
    if (first && typeof first === "object" && "json" in (first as object)) {
      return ((first as { json?: Record<string, unknown> }).json ?? first) as Record<string, unknown>;
    }
    if (first && typeof first === "object") return first as Record<string, unknown>;
    return { value: first };
  }
  if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    if ("json" in o && o.json && typeof o.json === "object") return o.json as Record<string, unknown>;
    return o;
  }
  return { value: data };
}

function FormView({
  data,
  editable,
  onFieldChange,
}: {
  data: unknown;
  editable?: boolean;
  onFieldChange?: (key: string, value: string) => void;
}) {
  const fields = useMemo(() => {
    const obj = unwrapJson(data);
    return Object.entries(obj).slice(0, 80);
  }, [data]);

  if (fields.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-[11px] text-gray-600 p-4">
        No fields to display
      </div>
    );
  }

  return (
    <div className="overflow-y-auto h-full p-3 space-y-2.5">
      {fields.map(([key, value]) => {
        const display =
          value != null && typeof value === "object"
            ? JSON.stringify(value)
            : String(value ?? "");
        return (
          <div key={key} className="space-y-1">
            <Label className="text-[10px] text-gray-500 font-mono">{key}</Label>
            {editable && onFieldChange ? (
              <Input
                value={display}
                onChange={(e) => onFieldChange(key, e.target.value)}
                className="h-8 text-[11px] font-mono bg-gray-900 border-gray-700"
              />
            ) : (
              <div className="rounded border border-gray-800 bg-gray-900/60 px-2.5 py-1.5 text-[11px] font-mono text-gray-300 break-all">
                {display || "—"}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function N8nIoPanel({
  side,
  data,
  editable,
  onPinDataChange,
  emptyLabel,
  className,
}: {
  side: "input" | "output";
  data: unknown;
  editable?: boolean;
  onPinDataChange?: (data: unknown) => void;
  emptyLabel?: string;
  className?: string;
}) {
  const [mode, setMode] = useState<N8nDataViewMode | "form">("schema");
  const count = itemCount(data);
  const hasData = n8nDataHasContent(data);

  const handleFormField = (key: string, raw: string) => {
    if (!onPinDataChange) return;
    const base = unwrapJson(data);
    let parsed: unknown = raw;
    try {
      parsed = JSON.parse(raw);
    } catch {
      /* keep string */
    }
    onPinDataChange([{ json: { ...base, [key]: parsed } }]);
  };

  return (
    <div className={cn("flex flex-col h-full min-h-0 bg-[#0d0d14]", className)}>
      <div className="shrink-0 border-b border-gray-800 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold tracking-wide text-gray-400 uppercase">
            {side}
          </p>
          {side === "input" && editable && (
            <Pin className="h-3.5 w-3.5 text-amber-400/80" />
          )}
        </div>
        <p className="text-[10px] text-gray-600 mt-0.5">
          {count} {count === 1 ? "item" : "items"}
        </p>
        <div className="flex flex-wrap gap-0.5 mt-2">
          {VIEW_MODES.map((v) => (
            <Button
              key={v.id}
              type="button"
              size="sm"
              variant="ghost"
              title={v.hint}
              className={cn(
                "h-6 px-2 text-[10px] rounded-sm",
                mode === v.id
                  ? "bg-gray-800 text-gray-100"
                  : "text-gray-500 hover:text-gray-300 hover:bg-gray-900",
              )}
              onClick={() => setMode(v.id)}
            >
              {v.label}
            </Button>
          ))}
        </div>
        <p className="text-[9px] text-gray-600 mt-1.5 leading-snug">
          {VIEW_MODES.find((v) => v.id === mode)?.hint}
        </p>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {!hasData && !(editable && side === "input" && mode === "json") ? (
          <div className="flex flex-col items-center justify-center h-full p-6 text-center">
            <p className="text-[11px] text-gray-500 leading-relaxed max-w-[200px]">
              {emptyLabel ??
                (side === "input"
                  ? "No input data — pin test data or run a previous node."
                  : "No output data — execute this node to see results.")}
            </p>
            {editable && side === "input" && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-3 h-7 text-[10px] border-gray-700"
                onClick={() => {
                  setMode("json");
                  onPinDataChange?.([{ json: {} }]);
                }}
              >
                Pin test data
              </Button>
            )}
          </div>
        ) : mode === "form" ? (
          <FormView
            data={data}
            editable={editable && side === "input"}
            onFieldChange={handleFormField}
          />
        ) : mode === "json" && editable && side === "input" ? (
          <div className="h-full p-2 flex flex-col min-h-0">
            <Textarea
              value={hasData ? JSON.stringify(data, null, 2) : '[{ "json": {} }]'}
              onChange={(e) => {
                const raw = e.target.value.trim();
                if (!raw) {
                  onPinDataChange?.(undefined);
                  return;
                }
                try {
                  onPinDataChange?.(JSON.parse(raw));
                } catch {
                  /* keep typing */
                }
              }}
              placeholder='[{ "json": { "lead_id": "…" } }]'
              spellCheck={false}
              className="flex-1 min-h-0 text-[10px] font-mono bg-gray-950 border-gray-800 resize-none leading-relaxed"
            />
          </div>
        ) : (
          <div className="h-full p-2 overflow-hidden">
            <N8nDataViewer
              data={data}
              defaultMode={mode as N8nDataViewMode}
              fillHeight
              hideTabs
            />
          </div>
        )}
      </div>
    </div>
  );
}
