import { useState } from "react";
import { cn } from "@/lib/utils";

type ToolCall = {
  name?: unknown;
  type?: unknown;
  success?: unknown;
  latency_ms?: unknown;
  tool_call_id?: unknown;
  start_time_sec?: unknown;
};

type InspectorTab = "transcript" | "variables" | "tools";

function fmtLatency(ms: unknown): string {
  const n = Number(ms);
  if (!Number.isFinite(n)) return "—";
  return n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`;
}

function fmtOffset(sec: unknown): string {
  const n = Number(sec);
  if (!Number.isFinite(n)) return "—";
  const m = Math.floor(n / 60);
  const s = Math.floor(n % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Variables worth hiding by default — call scaffolding, not captured answers. */
const NOISY_KEYS = new Set([
  "available_slots",
  "slot_message",
  "booking_message",
  "greeting",
  "current_date",
  "current_time",
  "current_datetime",
  "current_date_uk",
  "current_time_uk",
  "current_datetime_uk",
  "day_of_week",
  "day_of_week_uk",
  "timezone",
  "timezone_label",
  "retell_workspace_pool",
  "live_transfer_window",
  "live_transfer_open",
  "live_transfer_allowed",
  "live_transfer_fallback",
  "live_transfer_next_window",
  "live_transfer_today_window",
]);

export function CallInspectorPanel({
  transcript,
  collectedVariables,
  toolCalls,
}: {
  transcript: string | null | undefined;
  collectedVariables: Record<string, unknown> | null | undefined;
  toolCalls: Array<Record<string, unknown>> | null | undefined;
}) {
  const vars = collectedVariables && typeof collectedVariables === "object" ? collectedVariables : {};
  const tools: ToolCall[] = Array.isArray(toolCalls) ? (toolCalls as ToolCall[]) : [];
  const varEntries = Object.entries(vars);
  const signalEntries = varEntries.filter(([k]) => !NOISY_KEYS.has(k));
  const noisyCount = varEntries.length - signalEntries.length;

  const [tab, setTab] = useState<InspectorTab>(transcript ? "transcript" : "variables");
  const [showAllVars, setShowAllVars] = useState(false);

  const shown = showAllVars ? varEntries : signalEntries;

  const tabs: Array<{ id: InspectorTab; label: string; count: number | null }> = [
    { id: "transcript", label: "Transcript", count: null },
    { id: "variables", label: "Variables", count: varEntries.length },
    { id: "tools", label: "Tools", count: tools.length },
  ];

  return (
    <div className="rounded-lg border border-border bg-black/30">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "rounded px-2 py-1 text-[11px] font-medium transition-colors",
              tab === t.id
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {t.count !== null && (
              <span className="ml-1.5 tabular-nums text-muted-foreground">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      <div className="max-h-72 overflow-y-auto p-3">
        {tab === "transcript" && (
          <div className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-muted-foreground">
            {transcript?.trim() || "No transcript recorded."}
          </div>
        )}

        {tab === "variables" && (
          varEntries.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              No variables recorded for this call.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {shown.map(([key, value]) => (
                <div key={key} className="grid grid-cols-[minmax(0,180px)_1fr] gap-3 text-[11px]">
                  <span className="truncate font-mono text-primary" title={key}>
                    {key}
                  </span>
                  <span className="break-words text-foreground/90">
                    {value === null || value === undefined || String(value).trim() === "" ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      String(value)
                    )}
                  </span>
                </div>
              ))}
              {noisyCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAllVars((p) => !p)}
                  className="mt-1 self-start text-[11px] text-primary hover:underline"
                >
                  {showAllVars
                    ? `Hide ${noisyCount} call-setup variables`
                    : `Show ${noisyCount} call-setup variables`}
                </button>
              )}
            </div>
          )
        )}

        {tab === "tools" && (
          tools.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              No tools were called during this call.
            </p>
          ) : (
            <table className="w-full text-left text-[11px]">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="pb-1.5 pr-3 font-medium">At</th>
                  <th className="pb-1.5 pr-3 font-medium">Tool</th>
                  <th className="pb-1.5 pr-3 font-medium">Type</th>
                  <th className="pb-1.5 pr-3 font-medium">Result</th>
                  <th className="pb-1.5 font-medium">Latency</th>
                </tr>
              </thead>
              <tbody>
                {tools.map((t, i) => (
                  <tr key={String(t.tool_call_id ?? i)} className="border-t border-border/60">
                    <td className="py-1 pr-3 tabular-nums text-muted-foreground">
                      {fmtOffset(t.start_time_sec)}
                    </td>
                    <td className="py-1 pr-3 font-mono text-foreground/90">
                      {String(t.name ?? "—")}
                    </td>
                    <td className="py-1 pr-3 text-muted-foreground">
                      {String(t.type ?? "—").replace(/_/g, " ")}
                    </td>
                    <td className="py-1 pr-3">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px]",
                          t.success === false
                            ? "bg-destructive/15 text-destructive"
                            : "bg-success/15 text-success",
                        )}
                      >
                        {t.success === false ? "failed" : "ok"}
                      </span>
                    </td>
                    <td className="py-1 tabular-nums text-muted-foreground">
                      {fmtLatency(t.latency_ms)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>
    </div>
  );
}
