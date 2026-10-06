import { Fragment } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBuilderStore } from "@/lib/builder/store";
import type { NodeField } from "@/lib/builder/node-registry";
import type { FlowNodeData } from "@/lib/builder/types";
import { VariableInput, VariableTextarea } from "./VariableAutocompleteField";

/** "Add a `timeout` transition" → text with the backticked part as code. */
function RichHint({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("`") && p.endsWith("`") ? (
          <code key={i}>{p.slice(1, -1)}</code>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </>
  );
}

/**
 * Renders a node kind's registry-declared fields. Consecutive `half` fields share a row.
 */
export function NodeSchemaFields({
  nodeId,
  data,
  fields,
}: {
  nodeId: string;
  data: FlowNodeData;
  fields: readonly NodeField[];
}) {
  const updateNode = useBuilderStore((s) => s.updateNode);
  const set = (key: string, value: unknown) => updateNode(nodeId, { [key]: value } as Partial<FlowNodeData>);
  const read = (key: string) => (data as Record<string, unknown>)[key];

  const renderField = (f: NodeField, i: number) => {
    switch (f.type) {
      case "help":
        return (
          <p key={i} className="text-[11px] text-muted-foreground leading-snug">
            <RichHint text={f.text} />
          </p>
        );
      case "number": {
        const value = read(f.key);
        return (
          <div key={f.key}>
            <Label>{f.label}</Label>
            <Input
              type="number"
              min={f.min}
              max={f.max}
              value={typeof value === "number" ? value : f.default}
              onChange={(e) => set(f.key, parseInt(e.target.value) || (f.fallback ?? f.default))}
            />
          </div>
        );
      }
      case "text":
      case "variableText": {
        const value = String(read(f.key) ?? "");
        return (
          <div key={f.key}>
            <Label>{f.label}</Label>
            {f.type === "variableText" ? (
              <VariableInput value={value} onValueChange={(v) => set(f.key, v)} placeholder={f.placeholder} />
            ) : (
              <Input value={value} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder} />
            )}
          </div>
        );
      }
      case "textarea":
      case "variableTextarea": {
        const value = String(read(f.key) ?? "");
        const className = f.mono ? "font-mono text-xs" : undefined;
        return (
          <div key={f.key}>
            <Label>{f.label}</Label>
            {f.type === "variableTextarea" ? (
              <VariableTextarea
                rows={f.rows ?? 3}
                className={className}
                value={value}
                onValueChange={(v) => set(f.key, v)}
                placeholder={f.placeholder}
              />
            ) : (
              <Textarea
                rows={f.rows ?? 3}
                className={className}
                value={value}
                onChange={(e) => set(f.key, e.target.value)}
                placeholder={f.placeholder}
              />
            )}
            {f.hint && (
              <p className="mt-1 text-[11px] text-muted-foreground leading-snug">
                <RichHint text={f.hint} />
              </p>
            )}
          </div>
        );
      }
      case "select":
        return (
          <div key={f.key}>
            <Label>{f.label}</Label>
            <Select value={String(read(f.key) ?? f.default)} onValueChange={(v) => set(f.key, v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {f.options.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      case "switch": {
        const value = read(f.key);
        return (
          <div key={f.key} className="flex items-center justify-between">
            <div>
              <Label>{f.label}</Label>
              {f.description && <p className="text-xs text-muted-foreground mt-0.5">{f.description}</p>}
            </div>
            <Switch
              checked={typeof value === "boolean" ? value : f.default}
              onCheckedChange={(v) => set(f.key, v)}
            />
          </div>
        );
      }
    }
  };

  // Group consecutive half-width fields into two-column rows.
  const rows: Array<{ half: boolean; items: NodeField[] }> = [];
  for (const f of fields) {
    const half = "half" in f && Boolean(f.half);
    const last = rows[rows.length - 1];
    if (half && last?.half && last.items.length < 2) last.items.push(f);
    else rows.push({ half, items: [f] });
  }

  return (
    <div className="space-y-3">
      {rows.map((row, i) =>
        row.half ? (
          <div key={i} className="grid grid-cols-2 gap-2">
            {row.items.map((f, j) => renderField(f, j))}
          </div>
        ) : (
          renderField(row.items[0]!, i)
        ),
      )}
    </div>
  );
}
