import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, CircleDot, Eraser } from "lucide-react";
import { useBuilderStore } from "@/lib/builder/store";
import { validateFlow } from "@/lib/builder/validate";
import { cn } from "@/lib/utils";

const TYPE_TONE: Record<string, string> = {
  node: "text-sky-300",
  transition: "text-violet-300",
  vars: "text-emerald-300",
  tool: "text-amber-300",
  api: "text-amber-300",
  llm: "text-fuchsia-300",
  stt: "text-cyan-300",
  tts: "text-cyan-300",
  error: "text-rose-300",
  call: "text-muted-foreground",
};

export function BuilderDebugConsole() {
  const open = useBuilderStore((s) => s.debugOpen);
  const setOpen = useBuilderStore((s) => s.setDebugOpen);
  const events = useBuilderStore((s) => s.debugEvents);
  const clear = useBuilderStore((s) => s.clearDebugEvents);
  const selectNode = useBuilderStore((s) => s.selectNode);
  const nodes = useBuilderStore((s) => s.nodes);
  const edges = useBuilderStore((s) => s.edges);
  const variables = useBuilderStore((s) => s.variables);
  const [tab, setTab] = useState<"timeline" | "validation">("timeline");
  const issues = useMemo(() => validateFlow(nodes, edges, variables), [nodes, edges, variables]);

  return (
    <div className="shrink-0 border-t border-white/[0.06] bg-background/80">
      <div className="flex items-center gap-2 px-2 py-1">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
          Debugger
        </button>
        <button
          type="button"
          onClick={() => {
            setTab("timeline");
            setOpen(true);
          }}
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px]",
            tab === "timeline" && open ? "bg-white/[0.06] text-foreground" : "text-muted-foreground",
          )}
        >
          Timeline {events.length ? `(${events.length})` : ""}
        </button>
        <button
          type="button"
          onClick={() => {
            setTab("validation");
            setOpen(true);
          }}
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px]",
            tab === "validation" && open ? "bg-white/[0.06] text-foreground" : "text-muted-foreground",
          )}
        >
          Validation {issues.length ? `(${issues.length})` : ""}
        </button>
        <span className="ml-auto" />
        {tab === "timeline" && events.length > 0 && (
          <button
            type="button"
            onClick={clear}
            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
          >
            <Eraser className="h-3 w-3" />
            Clear
          </button>
        )}
      </div>
      {open && (
        <div className="max-h-48 overflow-y-auto px-2 pb-2">
          {tab === "timeline" ? (
            events.length === 0 ? (
              <p className="px-1 py-4 text-center text-[11px] text-muted-foreground">
                Start a test call to see node, transition, variable, tool, and latency events.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {events.map((ev) => (
                  <li key={ev.id}>
                    <button
                      type="button"
                      disabled={!ev.nodeId}
                      onClick={() => ev.nodeId && selectNode(ev.nodeId)}
                      className="flex w-full items-start gap-2 rounded px-1 py-0.5 text-left text-[11px] hover:bg-white/[0.04] disabled:hover:bg-transparent"
                    >
                      <span className="w-14 shrink-0 tabular-nums text-muted-foreground/70">
                        {new Date(ev.ts).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                      </span>
                      <span className={cn("w-16 shrink-0 uppercase", TYPE_TONE[ev.type] ?? "text-muted-foreground")}>
                        {ev.type}
                      </span>
                      <span className="min-w-0 flex-1 text-foreground/90">{ev.message}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : issues.length === 0 ? (
            <p className="px-1 py-4 text-center text-[11px] text-emerald-400">All checks pass.</p>
          ) : (
            <ul className="space-y-0.5">
              {issues.map((issue) => (
                <li key={`${issue.level}|${issue.nodeId ?? ""}|${issue.message}`}>
                  <button
                    type="button"
                    disabled={!issue.nodeId}
                    onClick={() => issue.nodeId && selectNode(issue.nodeId)}
                    className={cn(
                      "flex w-full items-start gap-2 rounded px-1 py-0.5 text-left text-[11px] hover:bg-white/[0.04]",
                      issue.level === "error" ? "text-rose-300" : "text-amber-200",
                    )}
                  >
                    <CircleDot className="mt-0.5 h-2.5 w-2.5 shrink-0" />
                    {issue.message}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
