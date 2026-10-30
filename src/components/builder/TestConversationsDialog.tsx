/**
 * Builder — saved test conversations: write what a caller says, say what should happen, and replay
 * it against the flow on screen. Publishing runs them first (BuilderVersionMenu).
 */
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, ClipboardPaste, Loader2, Play, Plus, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBuilderStore } from "@/lib/builder/store";
import { exportAgentJson } from "@/lib/builder/export-conversation-flow";
import { runTestConversations } from "@/lib/builder/test-conversations.functions";
import {
  callerLinesFromTranscript,
  MAX_CALLER_TURNS,
  MAX_TEST_CONVERSATIONS,
  type TestConversation,
  type TestConversationResult,
} from "@/lib/builder/test-conversations.shared";
import { cn } from "@/lib/utils";

const NO_STEP = "__none__";
const NO_TESTS: TestConversation[] = [];

/** Run the saved tests against the flow on screen. */
export function useRunTestConversations() {
  const runFn = useServerFn(runTestConversations);
  return async (tests: TestConversation[]): Promise<TestConversationResult[]> => {
    const { nodes, edges, settings, variables } = useBuilderStore.getState();
    const exported = exportAgentJson(nodes, edges, settings, variables) as Record<string, unknown>;
    const flow = exported.conversationFlow as Record<string, unknown> | undefined;
    if (!flow) throw new Error("This flow could not be exported for a test run");
    const nodeLabels = Object.fromEntries(nodes.map((n) => [n.id, n.data?.label || n.id]));
    const { results } = await runFn({
      data: { flow, settings: settings as unknown as Record<string, unknown>, tests, nodeLabels },
    });
    return results;
  };
}

function newTest(n: number): TestConversation {
  return { id: `test-${Date.now().toString(36)}`, name: `Test ${n}`, callerTurns: [], expect: {} };
}

export function TestResultList({ results }: { results: TestConversationResult[] }) {
  return (
    <div className="space-y-2">
      {results.map((r) => (
        <div key={r.id} className="rounded-lg border border-border p-2.5">
          <div className="flex items-center gap-1.5 text-xs font-medium">
            {r.passed ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <XCircle className="h-3.5 w-3.5 text-red-500" />
            )}
            {r.name}
            <span className="ml-auto text-[10px] font-normal text-muted-foreground">
              {r.checks.filter((c) => c.ok).length}/{r.checks.length} checks
            </span>
          </div>
          <ul className="mt-1.5 space-y-0.5 text-[11px]">
            {r.checks.map((c, i) => (
              <li key={i} className={cn(c.ok ? "text-muted-foreground" : "text-red-600 dark:text-red-400")}>
                {c.ok ? "✓" : "✗"} {c.label}
                {c.detail ? <span className="block pl-3 text-[10px] opacity-80">{c.detail}</span> : null}
              </li>
            ))}
          </ul>
          {r.agentLines.length > 0 && (
            <details className="mt-1.5 text-[11px] text-muted-foreground">
              <summary className="cursor-pointer">What the agent said ({r.agentLines.length} lines)</summary>
              <ol className="mt-1 list-decimal space-y-0.5 pl-4">
                {r.agentLines.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ol>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}

export function TestConversationsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  // A stable empty list: a fresh `[]` from the selector reads as a new value on every render,
  // which made React re-render without end ("Maximum update depth exceeded") on the builder.
  const tests = useBuilderStore((s) => s.settings.testConversations ?? NO_TESTS);
  const nodes = useBuilderStore((s) => s.nodes);
  const setSettings = useBuilderStore((s) => s.setSettings);
  const run = useRunTestConversations();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<TestConversationResult[] | null>(null);
  const [paste, setPaste] = useState("");

  const selected = tests.find((t) => t.id === selectedId) ?? tests[0] ?? null;
  const stepOptions = useMemo(
    () => nodes.map((n) => ({ id: n.id, label: n.data?.label || n.id })),
    [nodes],
  );

  const save = (next: TestConversation[]) => setSettings({ testConversations: next });
  const update = (patch: Partial<TestConversation>) =>
    selected && save(tests.map((t) => (t.id === selected.id ? { ...t, ...patch } : t)));
  const updateExpect = (patch: Partial<TestConversation["expect"]>) =>
    selected && update({ expect: { ...selected.expect, ...patch } });

  async function runAll() {
    setRunning(true);
    setResults(null);
    try {
      const r = await run(tests);
      setResults(r);
      const failed = r.filter((x) => !x.passed).length;
      if (failed) toast.error(`${failed} of ${r.length} tests failed`);
      else toast.success(`All ${r.length} tests passed`);
    } catch (e) {
      toast.error("Test run failed", { description: (e as Error).message });
    } finally {
      setRunning(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Test conversations</DialogTitle>
          <DialogDescription>
            What a caller says, and what the agent should do. They replay against the flow on screen, and run
            before every publish. Each agent reply is one model call.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-[360px] grid-cols-[180px_1fr] gap-3">
          <div className="space-y-1 border-r border-border pr-2">
            {tests.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                className={cn(
                  "block w-full truncate rounded-md px-2 py-1 text-left text-xs",
                  selected?.id === t.id ? "bg-primary/10 text-primary" : "hover:bg-muted",
                )}
              >
                {t.name}
                <span className="ml-1 text-[10px] text-muted-foreground">({t.callerTurns.length})</span>
              </button>
            ))}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-full justify-start text-xs"
              disabled={tests.length >= MAX_TEST_CONVERSATIONS}
              onClick={() => {
                const t = newTest(tests.length + 1);
                save([...tests, t]);
                setSelectedId(t.id);
              }}
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> New test
            </Button>
          </div>

          {selected ? (
            <div className="space-y-3 overflow-y-auto pr-1">
              <div className="flex items-center gap-2">
                <Input value={selected.name} onChange={(e) => update({ name: e.target.value })} className="h-8 text-xs" />
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8 text-xs text-red-600"
                  onClick={() => {
                    save(tests.filter((t) => t.id !== selected.id));
                    setSelectedId(null);
                  }}
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
                </Button>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">What the caller says — one line per turn (up to {MAX_CALLER_TURNS})</Label>
                <Textarea
                  value={selected.callerTurns.join("\n")}
                  onChange={(e) => update({ callerTurns: e.target.value.split("\n").slice(0, MAX_CALLER_TURNS) })}
                  placeholder={"Yes, that's me\nIt's a three-bed semi\nTuesday at 2 works"}
                  className="min-h-[110px] text-xs"
                />
                <div className="flex items-center gap-2">
                  <Input
                    value={paste}
                    onChange={(e) => setPaste(e.target.value)}
                    placeholder="…or paste a call transcript (User: / Agent: lines)"
                    className="h-7 text-[11px]"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-[11px]"
                    disabled={!paste.trim()}
                    onClick={() => {
                      update({ callerTurns: callerLinesFromTranscript(paste) });
                      setPaste("");
                    }}
                  >
                    <ClipboardPaste className="mr-1 h-3 w-3" /> Use caller lines
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Should reach this step</Label>
                  <Select
                    value={selected.expect.reachesNodeId ?? NO_STEP}
                    onValueChange={(v) => updateExpect({ reachesNodeId: v === NO_STEP ? null : v })}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_STEP} className="text-xs">
                        Any step
                      </SelectItem>
                      {stepOptions.map((o) => (
                        <SelectItem key={o.id} value={o.id} className="text-xs">
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <label className="flex items-center gap-2 pt-5 text-xs">
                  <Switch checked={!!selected.expect.endsCall} onCheckedChange={(v) => updateExpect({ endsCall: v })} />
                  The agent ends the call
                </label>
                <div className="space-y-1">
                  <Label className="text-xs">Must say (one per line)</Label>
                  <Textarea
                    value={(selected.expect.mustSay ?? []).join("\n")}
                    onChange={(e) => updateExpect({ mustSay: e.target.value.split("\n") })}
                    className="min-h-[60px] text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Must never say (one per line)</Label>
                  <Textarea
                    value={(selected.expect.mustNotSay ?? []).join("\n")}
                    onChange={(e) => updateExpect({ mustNotSay: e.target.value.split("\n") })}
                    className="min-h-[60px] text-xs"
                  />
                </div>
              </div>

              {results && <TestResultList results={results} />}
            </div>
          ) : (
            <p className="self-center text-center text-xs text-muted-foreground">
              No tests yet. Add one, or paste a transcript from a call that went wrong.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button size="sm" onClick={runAll} disabled={running || tests.length === 0}>
            {running ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}
            Run {tests.length || ""} test{tests.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
