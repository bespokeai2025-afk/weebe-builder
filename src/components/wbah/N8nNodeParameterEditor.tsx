/**
 * Editable n8n-style node parameter panel — flexible forms per node kind.
 */
import type { ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { resolveNodeJavaScript } from "@/lib/wbah/workflow/wbah-n8n-code-snippets.shared";
import type { WbahN8nNodeKind } from "@/lib/wbah/workflow/wbah-n8n-node-catalog.shared";
import {
  mergeN8nNodeConfig,
  type N8nConditionRule,
  type WbahN8nNodeConfig,
} from "@/lib/wbah/workflow/wbah-n8n-node-presets.shared";
import { N8N_KIND_TYPE_LABEL } from "@/lib/wbah/workflow/wbah-node-display.shared";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] as const;
const BODY_TYPES = ["JSON", "Form Urlencoded", "Raw", "Form-Data"] as const;
const COMBINATORS = ["and", "or"] as const;
const OPERATORS = [
  "equals",
  "not equals",
  "exists",
  "does not exist",
  "is empty",
  "is not empty",
  "is true",
  "is false",
  "contains",
  "is valid",
] as const;
const CODE_MODES = ["Run Once for All Items", "Run Once for Each Item"] as const;
const MERGE_MODES = ["Append", "Combine", "Choose Branch", "Multiplex"] as const;
const WAIT_UNITS = ["seconds", "minutes", "hours"] as const;
const RESPONSE_MODES = ["On Received", "Last Node", "Response Node"] as const;

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <Label className="text-[10px] text-gray-500">{label}</Label>
      {children}
    </div>
  );
}

function KeyValueListEditor({
  label,
  items,
  onChange,
  namePlaceholder = "Name",
  valuePlaceholder = "Value",
}: {
  label: string;
  items: Array<{ name: string; value: string }>;
  onChange: (items: Array<{ name: string; value: string }>) => void;
  namePlaceholder?: string;
  valuePlaceholder?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-[10px] text-gray-500">{label}</Label>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-6 text-[10px] text-violet-300 hover:text-violet-200"
          onClick={() => onChange([...items, { name: "", value: "" }])}
        >
          <Plus className="h-3 w-3 mr-1" /> Add
        </Button>
      </div>
      {items.length === 0 ? (
        <p className="text-[10px] text-gray-600 italic">No entries — click Add.</p>
      ) : (
        <div className="space-y-1.5">
          {items.map((row, i) => (
            <div key={`kv-${i}`} className="flex gap-1.5 items-start">
              <Input
                value={row.name}
                placeholder={namePlaceholder}
                onChange={(e) => {
                  const next = [...items];
                  next[i] = { ...next[i]!, name: e.target.value };
                  onChange(next);
                }}
                className="h-7 text-[10px] font-mono bg-gray-900 border-gray-700 flex-1"
              />
              <Input
                value={row.value}
                placeholder={valuePlaceholder}
                onChange={(e) => {
                  const next = [...items];
                  next[i] = { ...next[i]!, value: e.target.value };
                  onChange(next);
                }}
                className="h-7 text-[10px] font-mono bg-gray-900 border-gray-700 flex-[1.4]"
              />
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0 text-red-400/80"
                onClick={() => onChange(items.filter((_, j) => j !== i))}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ConditionsEditor({
  combinator,
  conditions,
  onChange,
}: {
  combinator: "and" | "or";
  conditions: N8nConditionRule[];
  onChange: (combinator: "and" | "or", conditions: N8nConditionRule[]) => void;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
      <Field label="Combinator">
        <Select
          value={combinator}
          onValueChange={(v) => onChange(v as "and" | "or", conditions)}
        >
          <SelectTrigger className="h-8 text-xs bg-gray-900 border-gray-700">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COMBINATORS.map((c) => (
              <SelectItem key={c} value={c} className="text-xs uppercase">
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-[10px] text-gray-500">Conditions</Label>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 text-[10px] text-amber-300"
            onClick={() =>
              onChange(combinator, [...conditions, { field: "", operator: "equals", value: "" }])
            }
          >
            <Plus className="h-3 w-3 mr-1" /> Add condition
          </Button>
        </div>
        {conditions.map((rule, i) => (
          <div key={`cond-${i}`} className="rounded border border-gray-800 bg-gray-950/80 p-2 space-y-1.5">
            <div className="flex justify-between items-center">
              <span className="text-[9px] text-gray-500 font-medium">Condition {i + 1}</span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-6 w-6 text-red-400/80"
                onClick={() => onChange(combinator, conditions.filter((_, j) => j !== i))}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
            <Input
              value={rule.field}
              placeholder="{{ $json.body.event }}"
              onChange={(e) => {
                const next = [...conditions];
                next[i] = { ...next[i]!, field: e.target.value };
                onChange(combinator, next);
              }}
              className="h-7 text-[10px] font-mono bg-gray-900 border-gray-700"
            />
            <div className="flex gap-1.5">
              <Select
                value={rule.operator ?? "equals"}
                onValueChange={(v) => {
                  const next = [...conditions];
                  next[i] = { ...next[i]!, operator: v };
                  onChange(combinator, next);
                }}
              >
                <SelectTrigger className="h-7 text-[10px] bg-gray-900 border-gray-700 w-[130px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPERATORS.map((op) => (
                    <SelectItem key={op} value={op} className="text-xs">
                      {op}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={rule.value ?? ""}
                placeholder="value (optional)"
                onChange={(e) => {
                  const next = [...conditions];
                  next[i] = { ...next[i]!, value: e.target.value };
                  onChange(combinator, next);
                }}
                className="h-7 text-[10px] font-mono bg-gray-900 border-gray-700 flex-1"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function bodyToEditorString(cfg: WbahN8nNodeConfig): string {
  const raw = cfg.jsonBody ?? cfg.body;
  if (raw == null) return "";
  if (typeof raw === "string") return raw;
  try {
    return JSON.stringify(raw, null, 2);
  } catch {
    return String(raw);
  }
}

function parseBodyEditorString(text: string, contentType: string): Partial<WbahN8nNodeConfig> {
  const trimmed = text.trim();
  if (!trimmed) return { jsonBody: undefined, body: undefined, sendBody: false };
  if (contentType === "JSON") {
    try {
      return { jsonBody: JSON.parse(trimmed), body: undefined, sendBody: true };
    } catch {
      return { jsonBody: trimmed, body: undefined, sendBody: true };
    }
  }
  return { body: trimmed, jsonBody: undefined, sendBody: true };
}

export type N8nNodeParameterEditorProps = {
  kind: WbahN8nNodeKind;
  nodeId: string;
  config: Record<string, unknown>;
  onChange: (patch: Partial<WbahN8nNodeConfig>) => void;
};

export function N8nNodeParameterEditor({ kind, nodeId, config, onChange }: N8nNodeParameterEditorProps) {
  const cfg = mergeN8nNodeConfig(nodeId, kind, config);
  const typeLabel = N8N_KIND_TYPE_LABEL[kind] ?? kind;

  const patch = (p: Partial<WbahN8nNodeConfig>) => onChange(p);

  if (kind === "trigger") {
    return (
      <div className="space-y-3">
        <p className="text-[10px] font-semibold text-sky-300/90">{typeLabel}</p>
        <Field label="HTTP Method">
          <Select
            value={String(cfg.httpMethod ?? cfg.method ?? "POST")}
            onValueChange={(v) => patch({ httpMethod: v, method: v })}
          >
            <SelectTrigger className="h-8 text-xs bg-gray-900 border-gray-700">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HTTP_METHODS.map((m) => (
                <SelectItem key={m} value={m} className="text-xs">
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Path">
          <Input
            value={String(cfg.path ?? cfg.url ?? "")}
            onChange={(e) => patch({ path: e.target.value, url: e.target.value })}
            placeholder="/webhook/my-flow"
            className="h-8 text-xs font-mono bg-gray-900 border-gray-700"
          />
        </Field>
        <Field label="Authentication">
          <Input
            value={String(cfg.authentication ?? "None")}
            onChange={(e) => patch({ authentication: e.target.value })}
            className="h-8 text-xs bg-gray-900 border-gray-700"
          />
        </Field>
        <Field label="Response Mode">
          <Select
            value={String(cfg.responseMode ?? "On Received")}
            onValueChange={(v) => patch({ responseMode: v })}
          >
            <SelectTrigger className="h-8 text-xs bg-gray-900 border-gray-700">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RESPONSE_MODES.map((m) => (
                <SelectItem key={m} value={m} className="text-xs">
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Notes">
          <Textarea
            value={String(cfg.summary ?? "")}
            onChange={(e) => patch({ summary: e.target.value })}
            className="min-h-[56px] text-[11px] bg-gray-900 border-gray-700"
          />
        </Field>
      </div>
    );
  }

  if (kind === "filter" || kind === "if") {
    const combinator = (cfg.combinator ?? "and") as "and" | "or";
    let conditions = cfg.conditions ?? [];
    if (!conditions.length && cfg.condition) {
      conditions = [{ field: cfg.condition, operator: undefined, value: undefined }];
    }
    return (
      <div className="space-y-3">
        <p className="text-[10px] font-semibold text-amber-300/90">{typeLabel}</p>
        <ConditionsEditor
          combinator={combinator}
          conditions={conditions}
          onChange={(c, rules) =>
            patch({
              combinator: c,
              conditions: rules,
              condition: undefined,
            })
          }
        />
        <Field label="Notes">
          <Textarea
            value={String(cfg.summary ?? "")}
            onChange={(e) => patch({ summary: e.target.value })}
            className="min-h-[48px] text-[11px] bg-gray-900 border-gray-700"
          />
        </Field>
      </div>
    );
  }

  if (kind === "http") {
    const headers = cfg.headers ?? [];
    const queryParams = cfg.queryParameters ?? [];
    const bodyType = String(cfg.bodyContentType ?? "JSON");
    return (
      <div className="space-y-3">
        <p className="text-[10px] font-semibold text-rose-300/90">{typeLabel}</p>
        <Field label="Method">
          <Select value={String(cfg.method ?? "GET")} onValueChange={(v) => patch({ method: v })}>
            <SelectTrigger className="h-8 text-xs bg-gray-900 border-gray-700">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {HTTP_METHODS.map((m) => (
                <SelectItem key={m} value={m} className="text-xs">
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="URL">
          <Textarea
            value={String(cfg.url ?? cfg.path ?? "")}
            onChange={(e) => patch({ url: e.target.value, path: e.target.value })}
            placeholder="https://api.example.com/endpoint"
            className="min-h-[52px] text-[11px] font-mono bg-gray-900 border-gray-700"
          />
        </Field>
        <Field label="Authentication">
          <Input
            value={String(cfg.authentication ?? "None")}
            onChange={(e) => patch({ authentication: e.target.value })}
            placeholder="None, Bearer Auth, Header Auth, OAuth2…"
            className="h-8 text-xs bg-gray-900 border-gray-700"
          />
        </Field>
        <div className="flex items-center justify-between rounded-lg border border-gray-800 px-3 py-2">
          <Label className="text-xs text-gray-400">Send Query Parameters</Label>
          <Switch
            checked={cfg.sendQueryParameters === true}
            onCheckedChange={(v) => patch({ sendQueryParameters: v })}
          />
        </div>
        {cfg.sendQueryParameters && (
          <KeyValueListEditor
            label="Query Parameters"
            items={queryParams}
            onChange={(items) => patch({ queryParameters: items, sendQueryParameters: true })}
          />
        )}
        <div className="flex items-center justify-between rounded-lg border border-gray-800 px-3 py-2">
          <Label className="text-xs text-gray-400">Send Headers</Label>
          <Switch
            checked={cfg.sendHeaders !== false}
            onCheckedChange={(v) => patch({ sendHeaders: v, headers: v ? headers : [] })}
          />
        </div>
        {cfg.sendHeaders !== false && (
          <KeyValueListEditor
            label="Headers"
            items={headers}
            onChange={(items) => patch({ headers: items, sendHeaders: true })}
          />
        )}
        <div className="flex items-center justify-between rounded-lg border border-gray-800 px-3 py-2">
          <Label className="text-xs text-gray-400">Send Body</Label>
          <Switch
            checked={cfg.sendBody !== false}
            onCheckedChange={(v) => {
              if (!v) patch({ sendBody: false, body: undefined, jsonBody: undefined });
              else patch({ sendBody: true, bodyContentType: bodyType || "JSON" });
            }}
          />
        </div>
        {cfg.sendBody !== false && (
          <>
            <Field label="Body Content Type">
              <Select value={bodyType} onValueChange={(v) => patch({ bodyContentType: v })}>
                <SelectTrigger className="h-8 text-xs bg-gray-900 border-gray-700">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BODY_TYPES.map((t) => (
                    <SelectItem key={t} value={t} className="text-xs">
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={bodyType === "JSON" ? "JSON" : "Body"}>
              <Textarea
                value={bodyToEditorString(cfg)}
                onChange={(e) => patch(parseBodyEditorString(e.target.value, bodyType))}
                placeholder={bodyType === "JSON" ? '{\n  "key": "{{ $json.value }}"\n}' : "key=value&…"}
                className="min-h-[120px] text-[10px] font-mono bg-gray-900 border-gray-700"
              />
            </Field>
          </>
        )}
        <Field label="Notes">
          <Textarea
            value={String(cfg.summary ?? "")}
            onChange={(e) => patch({ summary: e.target.value })}
            className="min-h-[48px] text-[11px] bg-gray-900 border-gray-700"
          />
        </Field>
      </div>
    );
  }

  if (kind === "code") {
    const codeValue = resolveNodeJavaScript(nodeId, cfg);
    return (
      <div className="space-y-3">
        <p className="text-[10px] font-semibold text-violet-300/90">{typeLabel}</p>
        <Field label="Mode">
          <Select
            value={String(cfg.mode ?? CODE_MODES[0])}
            onValueChange={(v) => patch({ mode: v })}
          >
            <SelectTrigger className="h-8 text-xs bg-gray-900 border-gray-700">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CODE_MODES.map((m) => (
                <SelectItem key={m} value={m} className="text-xs">
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Language">
          <Input
            value={String(cfg.language ?? "JavaScript")}
            onChange={(e) => patch({ language: e.target.value })}
            className="h-8 text-xs bg-gray-900 border-gray-700"
          />
        </Field>
        <Field label="JavaScript">
          <Textarea
            value={codeValue}
            onChange={(e) => patch({ code: e.target.value, codeHint: undefined })}
            placeholder="// const items = $input.all();"
            className="min-h-[360px] text-[10px] font-mono bg-gray-950 border-gray-700 leading-relaxed"
            spellCheck={false}
          />
        </Field>
        <Field label="Notes">
          <Textarea
            value={String(cfg.summary ?? "")}
            onChange={(e) => patch({ summary: e.target.value })}
            className="min-h-[48px] text-[11px] bg-gray-900 border-gray-700"
          />
        </Field>
      </div>
    );
  }

  if (kind === "merge") {
    return (
      <div className="space-y-3">
        <p className="text-[10px] font-semibold text-cyan-300/90">{typeLabel}</p>
        <Field label="Mode">
          <Select
            value={String(cfg.mergeMode ?? MERGE_MODES[0])}
            onValueChange={(v) => patch({ mergeMode: v })}
          >
            <SelectTrigger className="h-8 text-xs bg-gray-900 border-gray-700">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MERGE_MODES.map((m) => (
                <SelectItem key={m} value={m} className="text-xs">
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Notes">
          <Textarea
            value={String(cfg.summary ?? "")}
            onChange={(e) => patch({ summary: e.target.value })}
            className="min-h-[48px] text-[11px] bg-gray-900 border-gray-700"
          />
        </Field>
      </div>
    );
  }

  if (kind === "wait") {
    return (
      <div className="space-y-3">
        <p className="text-[10px] font-semibold text-orange-300/90">{typeLabel}</p>
        <Field label="Resume">
          <Input
            value={String(cfg.resume ?? "After Time Interval")}
            onChange={(e) => patch({ resume: e.target.value })}
            className="h-8 text-xs bg-gray-900 border-gray-700"
          />
        </Field>
        <div className="flex gap-2">
          <Field label="Amount" className="flex-1">
            <Input
              value={String(cfg.amount ?? cfg.duration ?? "")}
              onChange={(e) => patch({ amount: e.target.value })}
              placeholder="5"
              className="h-8 text-xs bg-gray-900 border-gray-700"
            />
          </Field>
          <Field label="Unit" className="w-[120px]">
            <Select
              value={String(cfg.unit ?? "seconds")}
              onValueChange={(v) => patch({ unit: v })}
            >
              <SelectTrigger className="h-8 text-xs bg-gray-900 border-gray-700">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WAIT_UNITS.map((u) => (
                  <SelectItem key={u} value={u} className="text-xs">
                    {u}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <Field label="Notes">
          <Textarea
            value={String(cfg.summary ?? "")}
            onChange={(e) => patch({ summary: e.target.value })}
            className="min-h-[48px] text-[11px] bg-gray-900 border-gray-700"
          />
        </Field>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-[10px] font-semibold text-gray-400">{typeLabel}</p>
      <Field label="Notes">
        <Textarea
          value={String(cfg.summary ?? cfg.description ?? "")}
          onChange={(e) => patch({ summary: e.target.value })}
          className="min-h-[80px] text-[11px] bg-gray-900 border-gray-700"
        />
      </Field>
    </div>
  );
}
