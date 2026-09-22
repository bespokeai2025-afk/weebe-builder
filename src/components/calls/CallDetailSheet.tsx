/**
 * Retell-style call detail.
 *
 * Replaces an expandable table row, which gave the transcript a few hundred
 * pixels inside a scrolling table and put variables behind a dropdown. Reading
 * one call meant expanding it, scrolling the page, and losing the row you were
 * comparing against.
 *
 * Layout mirrors what Retell shows because the job is the same: a fixed header
 * you can identify the call by, the summary first because it answers most
 * questions on its own, then transcript beside the structured data rather than
 * nested inside it.
 */
import { useMemo, useState } from "react";
import {
  Bot,
  User,
  Wrench,
  Variable,
  FileText,
  Clock,
  Volume2,
  ClipboardCheck,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type CallDetailRow = {
  id?: string;
  retell_call_id?: string | null;
  agent_name?: string | null;
  call_status?: string | null;
  call_type?: string | null;
  from_number?: string | null;
  to_number?: string | null;
  duration_seconds?: number | null;
  started_at?: string | null;
  sentiment?: string | null;
  call_summary?: string | null;
  transcript?: string | null;
  recording_url?: string | null;
  disconnection_reason?: string | null;
  is_test_call?: boolean | null;
  collected_variables?: Record<string, unknown> | null;
  tool_calls?: Array<Record<string, unknown>> | null;
  /** Post-call analysis — the built-ins, and the agent's own fields keyed by name. */
  call_successful?: boolean | null;
  in_voicemail?: boolean | null;
  custom_analysis_data?: Record<string, unknown> | null;
};

/**
 * One post-call value, formatted for reading.
 *
 * Structured fields (structured_json_output and friends) arrive as objects or as JSON strings;
 * both are shown indented rather than as one unreadable line.
 */
function PostCallValue({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-muted-foreground">— not found in this call</span>;
  }
  if (typeof value === "boolean") return <span>{value ? "Yes" : "No"}</span>;
  let structured: unknown = null;
  if (typeof value === "object") structured = value;
  else if (typeof value === "string" && /^[\[{]/.test(value.trim())) {
    try {
      structured = JSON.parse(value);
    } catch {
      structured = null;
    }
  }
  if (structured && typeof structured === "object") {
    return (
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-black/20 p-1.5 font-mono text-[10px] leading-relaxed">
        {JSON.stringify(structured, null, 2)}
      </pre>
    );
  }
  return <span className="whitespace-pre-wrap break-words">{String(value)}</span>;
}

/** Setup variables that are plumbing, not conversation outcomes. */
const SETUP_KEYS = new Set([
  "lead_id",
  "leadId",
  "unique_id",
  "salesforce_uuid",
  "current_node",
  "previous_node",
  "slot_message",
  "booking_message",
  "user_number",
  "from_number",
  "caller_number",
  "agent_name",
  "live_transfer_next_window",
  "live_transfer_today_window",
]);

type Turn = { role: "agent" | "user"; text: string };

/**
 * Split a flat transcript into turns.
 *
 * Stored as "Agent: …\nUser: …", so speaker changes are recoverable. A line
 * with no recognised prefix is appended to the previous turn rather than
 * dropped — a wrapped long utterance is still that speaker talking.
 */
function parseTranscript(transcript: string | null | undefined): Turn[] {
  if (!transcript?.trim()) return [];
  const turns: Turn[] = [];
  for (const raw of transcript.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(agent|assistant|bot|user|caller|customer)\s*:\s*(.*)$/i);
    if (m) {
      const role = /^(user|caller|customer)$/i.test(m[1]!) ? "user" : "agent";
      turns.push({ role, text: m[2] ?? "" });
      continue;
    }
    if (turns.length) turns[turns.length - 1]!.text += ` ${line}`;
    else turns.push({ role: "agent", text: line });
  }
  return turns.filter((t) => t.text.trim());
}

function sentimentTone(v?: string | null) {
  const s = String(v ?? "").toLowerCase();
  if (s.includes("positive")) return "border-emerald-500/40 text-emerald-300";
  if (s.includes("negative")) return "border-rose-500/40 text-rose-300";
  if (s) return "border-white/20 text-muted-foreground";
  return "";
}

function fmtDuration(sec?: number | null) {
  if (!sec || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

function Panel({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: typeof Bot;
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-white/[0.07] bg-white/[0.015]">
      <header className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
        {count !== undefined && count > 0 && (
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">{count}</span>
        )}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

export function CallDetailSheet({
  call,
  open,
  onOpenChange,
}: {
  call: CallDetailRow | null;
  open: boolean;
  onOpenChange: (next: boolean) => void;
}) {
  const [showSetup, setShowSetup] = useState(false);

  const turns = useMemo(() => parseTranscript(call?.transcript), [call?.transcript]);
  const { outcome, setup } = useMemo(() => {
    const all = Object.entries(call?.collected_variables ?? {});
    return {
      outcome: all.filter(([k]) => !SETUP_KEYS.has(k)),
      setup: all.filter(([k]) => SETUP_KEYS.has(k)),
    };
  }, [call?.collected_variables]);
  const tools = Array.isArray(call?.tool_calls) ? call!.tool_calls! : [];

  if (!call) return null;
  const contact =
    call.to_number && call.to_number !== "web:test" ? call.to_number : call.from_number;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-3xl">
        <SheetHeader className="space-y-2 border-b border-white/[0.07] px-5 py-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <SheetTitle className="text-sm">{call.agent_name || "Call"}</SheetTitle>
            {call.is_test_call && (
              <Badge variant="outline" className="border-violet-500/40 text-[9px] text-violet-300">
                Test call
              </Badge>
            )}
            {call.sentiment && (
              <Badge
                variant="outline"
                className={cn("text-[9px] capitalize", sentimentTone(call.sentiment))}
              >
                {call.sentiment}
              </Badge>
            )}
            {call.call_status && (
              <Badge variant="outline" className="text-[9px] capitalize">
                {call.call_status}
              </Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-muted-foreground">
            <span>{fmtDuration(call.duration_seconds)}</span>
            {call.started_at && <span>{new Date(call.started_at).toLocaleString()}</span>}
            {contact && <span>{contact}</span>}
            {call.disconnection_reason && <span>ended: {call.disconnection_reason}</span>}
          </div>
        </SheetHeader>

        <div className="max-h-[calc(100vh-5.5rem)] space-y-3 overflow-y-auto px-5 py-4">
          {/* The bare <audio> element rendered with the browser's own chrome —
              a light grey bar that looked pasted onto a dark panel. Housed in
              the same surface as every other panel instead. */}
          {call.recording_url && (
            <div className="flex items-center gap-2.5 rounded-lg border border-white/[0.07] bg-white/[0.015] px-3 py-2">
              <Volume2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <audio
                controls
                preload="none"
                src={call.recording_url}
                className="h-7 min-w-0 flex-1 [color-scheme:dark]"
              />
              <a
                href={call.recording_url}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Open
              </a>
            </div>
          )}

          {/* Summary first — it answers most questions without the transcript. */}
          <Panel icon={FileText} title="Summary">
            <p className="text-[12.5px] leading-relaxed text-foreground/90">
              {call.call_summary?.trim() || (
                <span className="text-muted-foreground">No summary generated for this call.</span>
              )}
            </p>
          </Panel>

          {/* Post-call data, as Retell shows it: the built-in verdicts, then every
              field the agent defines, including the ones this call did not fill. */}
          <Panel
            icon={ClipboardCheck}
            title="Post-call data"
            count={Object.keys(call.custom_analysis_data ?? {}).length}
          >
            <div className="overflow-hidden rounded border border-white/[0.06]">
              <table className="w-full text-[11px]">
                <tbody>
                  {(
                    [
                      ["call_successful", call.call_successful],
                      ["user_sentiment", call.sentiment],
                      ["in_voicemail", call.in_voicemail],
                    ] as Array<[string, unknown]>
                  ).map(([k, v], i) => (
                    <tr key={k} className={cn(i > 0 && "border-t border-white/[0.04]")}>
                      <td className="w-[42%] bg-white/[0.02] px-2.5 py-1.5 align-top font-mono text-[10px] text-muted-foreground">
                        {k}
                      </td>
                      <td className="px-2.5 py-1.5 align-top font-medium">
                        <PostCallValue value={v} />
                      </td>
                    </tr>
                  ))}
                  {Object.entries(call.custom_analysis_data ?? {}).map(([k, v]) => (
                    <tr key={`custom-${k}`} className="border-t border-white/[0.04]">
                      <td className="w-[42%] bg-white/[0.02] px-2.5 py-1.5 align-top font-mono text-[10px] text-muted-foreground">
                        {k}
                      </td>
                      <td className="px-2.5 py-1.5 align-top font-medium">
                        <PostCallValue value={v} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {Object.keys(call.custom_analysis_data ?? {}).length === 0 && (
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                No custom fields were extracted for this call. Define them under Post-Call Data
                Retrieval on the agent; calls from before this was added will not have them.
              </p>
            )}
          </Panel>

          <Panel icon={Variable} title="Extracted variables" count={outcome.length}>
            {outcome.length === 0 && setup.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                No variables recorded. Variables are only stored for calls placed on a{" "}
                <span className="text-foreground">saved</span> agent.
              </p>
            ) : (
              <>
                {/* A table, not a dropdown: the point is to scan many at once. */}
                <div className="overflow-hidden rounded border border-white/[0.06]">
                  <table className="w-full text-[11px]">
                    <tbody>
                      {outcome.map(([k, v], i) => (
                        <tr key={k} className={cn(i > 0 && "border-t border-white/[0.04]")}>
                          <td className="w-[42%] bg-white/[0.02] px-2.5 py-1.5 align-top font-mono text-[10px] text-muted-foreground">
                            {k}
                          </td>
                          <td className="px-2.5 py-1.5 align-top font-medium break-words">
                            {typeof v === "object" && v !== null
                              ? JSON.stringify(v)
                              : String(v ?? "—")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {setup.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => setShowSetup((s) => !s)}
                      className="mt-2 text-[10px] text-muted-foreground underline-offset-2 hover:underline"
                    >
                      {showSetup ? "Hide" : "Show"} {setup.length} call-setup variables
                    </button>
                    {showSetup && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {setup.map(([k, v]) => (
                          <span
                            key={k}
                            className="rounded bg-white/[0.04] px-1.5 py-0.5 font-mono text-[9.5px] text-muted-foreground"
                          >
                            {k}={String(v ?? "")}
                          </span>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </Panel>

          {tools.length > 0 && (
            <Panel icon={Wrench} title="Tool calls" count={tools.length}>
              <div className="space-y-1">
                {tools.map((t, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded border border-white/[0.06] px-2 py-1 text-[11px]"
                  >
                    <span
                      className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full",
                        t.success === false ? "bg-rose-400" : "bg-emerald-400",
                      )}
                    />
                    <span className="font-mono">{String(t.name ?? t.tool_name ?? "tool")}</span>
                    {typeof t.latency_ms === "number" && (
                      <span className="ml-auto flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
                        <Clock className="h-2.5 w-2.5" />
                        {t.latency_ms}ms
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </Panel>
          )}

          <Panel icon={Bot} title="Transcript" count={turns.length}>
            {turns.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">No transcript recorded.</p>
            ) : (
              <div className="space-y-2">
                {turns.map((t, i) => (
                  <div key={i} className="flex gap-2">
                    <div
                      className={cn(
                        "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                        t.role === "agent"
                          ? "bg-primary/15 text-primary"
                          : "bg-white/[0.06] text-muted-foreground",
                      )}
                    >
                      {t.role === "agent" ? (
                        <Bot className="h-3 w-3" />
                      ) : (
                        <User className="h-3 w-3" />
                      )}
                    </div>
                    <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed">{t.text}</p>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </SheetContent>
    </Sheet>
  );
}
