import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Play, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useBuilderStore } from "@/lib/builder/store";
import { testBuilderFunction } from "@/lib/builder/test-function.functions";
import type { FlowNode } from "@/lib/builder/store";
import type { ToolInvocation, VariableValue } from "@/lib/voice/graph/types";

function varsRecord(
  variables: Array<{ name: string; defaultValue?: string }>,
): Record<string, VariableValue> {
  const out: Record<string, VariableValue> = {};
  for (const v of variables) {
    if (v.name && v.defaultValue) out[v.name] = v.defaultValue;
  }
  return out;
}

function defaultArgs(node: FlowNode, variables: Record<string, VariableValue>): Record<string, unknown> {
  const d = node.data;
  const toolId = String(d.toolId ?? d.httpToolName ?? "").trim();
  const first = String(variables.first_name ?? "").trim();
  const last = String(variables.last_name ?? "").trim();
  const name = [first, last].filter(Boolean).join(" ") || String(variables.name ?? "").trim();
  const email = String(variables.email ?? "").trim();
  if (toolId === "book_appointment" || /book[_ ]?appointment/i.test(String(d.toolName ?? ""))) {
    return {
      start: String(variables.appointment_time ?? variables.start ?? "").trim(),
      name,
      email,
      timezone: String(d.toolTimezone ?? variables.timezone ?? "Europe/London"),
    };
  }
  if (toolId === "check_availability" || /availab/i.test(String(d.toolName ?? d.httpToolName ?? ""))) {
    const today = new Date();
    const end = new Date(today.getTime() + 7 * 86400000);
    const iso = (dte: Date) => dte.toISOString().slice(0, 10);
    return {
      start_date: iso(today),
      end_date: iso(end),
      timezone: String(d.toolTimezone ?? variables.timezone ?? "Europe/London"),
    };
  }
  return { ...variables };
}

function parseHeaders(raw: string | undefined): Record<string, string> | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) out[k] = String(v);
    return out;
  } catch {
    return undefined;
  }
}

export function FunctionTestPanel({ node }: { node: FlowNode }) {
  const variables = useBuilderStore((s) => s.variables);
  const flowTools = useBuilderStore((s) => s.settings.flowTools);
  const pushDebugEvent = useBuilderStore((s) => s.pushDebugEvent);
  const setDebugOpen = useBuilderStore((s) => s.setDebugOpen);
  const runTest = useServerFn(testBuilderFunction);
  const varMap = useMemo(() => varsRecord(variables), [variables]);
  const [argsText, setArgsText] = useState(() =>
    JSON.stringify(defaultArgs(node, varMap), null, 2),
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; output: string; durationMs: number } | null>(
    null,
  );

  const run = async () => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(argsText || "{}") as Record<string, unknown>;
    } catch {
      setResult({ ok: false, output: JSON.stringify({ error: "Arguments must be valid JSON" }), durationMs: 0 });
      return;
    }
    const d = node.data;
    const toolId = String(d.toolId ?? d.httpToolName ?? `tool-${node.id}`).trim();
    const invocation: ToolInvocation = {
      toolId,
      toolName: String(d.toolName ?? d.httpToolName ?? d.label ?? toolId).trim() || toolId,
      toolType: d.httpUrl ? "webhook" : "local",
      url: d.httpUrl?.trim() || undefined,
      method: d.httpMethod,
      timeoutMs: d.httpTimeoutMs,
      headers: parseHeaders(d.httpHeaders),
      body: d.httpBody?.trim() || undefined,
      args,
      variables: varMap,
    };
    const isCalPreset = toolId === "check_availability" || toolId === "book_appointment";
    const tools = [
      ...(Array.isArray(flowTools) ? flowTools : []),
      ...(isCalPreset && d.toolApiKey && d.toolEventTypeId && !d.httpUrl
        ? [
            {
              name: invocation.toolName,
              tool_id: toolId,
              type:
                toolId === "check_availability"
                  ? "check_availability_cal"
                  : "book_appointment_cal",
              cal_api_key: d.toolApiKey,
              event_type_id: d.toolEventTypeId,
              timezone: d.toolTimezone,
            },
          ]
        : []),
    ];
    setBusy(true);
    setResult(null);
    try {
      const out = await runTest({ data: { invocation, tools } });
      setResult({ ok: out.ok, output: out.output, durationMs: out.durationMs });
      pushDebugEvent({
        type: "tool",
        nodeId: node.id,
        message: `${invocation.toolName} ${out.ok ? "ok" : "fail"} (${out.durationMs}ms)`,
        detail: { output: out.output.slice(0, 500), args },
      });
      setDebugOpen(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setResult({ ok: false, output: JSON.stringify({ error: message }), durationMs: 0 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2 rounded-md border border-white/[0.08] bg-white/[0.02] p-3">
      <Label>Test this function</Label>
      <p className="text-[11px] text-muted-foreground">
        Runs the same executor as a live call. Uses builder variable defaults as args — edit before
        sending.
      </p>
      <Textarea
        rows={6}
        value={argsText}
        onChange={(e) => setArgsText(e.target.value)}
        className="font-mono text-[11px]"
      />
      <Button type="button" size="sm" onClick={() => void run()} disabled={busy}>
        {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1 h-3.5 w-3.5" />}
        Test function
      </Button>
      {result && (
        <pre
          className={`max-h-40 overflow-auto rounded border p-2 font-mono text-[11px] ${
            result.ok
              ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-200"
              : "border-rose-500/30 bg-rose-500/5 text-rose-200"
          }`}
        >
          {result.ok ? "ok" : "fail"} · {result.durationMs}ms{"\n"}
          {result.output}
        </pre>
      )}
    </div>
  );
}
