import { useState } from "react";
import { FlaskConical, History, Loader2, Rocket, RotateCcw, Undo2, Undo } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useBuilderStore } from "@/lib/builder/store";
import { previousPublishedVersion } from "@/lib/builder/flow-history";
import { normalizeTestConversations, type TestConversationResult } from "@/lib/builder/test-conversations.shared";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TestConversationsDialog, TestResultList, useRunTestConversations } from "./TestConversationsDialog";

export function BuilderVersionMenu() {
  const history = useBuilderStore((s) => s.settings.flowHistory);
  const published = useBuilderStore((s) => s.settings.publishedSnapshot);
  const publishFlow = useBuilderStore((s) => s.publishFlow);
  const restoreFlowVersion = useBuilderStore((s) => s.restoreFlowVersion);
  const unpublishFlow = useBuilderStore((s) => s.unpublishFlow);
  const rollbackPublished = useBuilderStore((s) => s.rollbackPublished);
  const publishLog = useBuilderStore((s) => s.settings.publishLog);
  const testConversations = useBuilderStore((s) => s.settings.testConversations);
  const runTests = useRunTestConversations();
  const [testsOpen, setTestsOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState<TestConversationResult[] | null>(null);
  const rollbackTo = published ? previousPublishedVersion(published.version, publishLog, history) : null;

  const publish = () =>
    publishFlow()
      .then((v) =>
        toast.success(`Published v${v}`, {
          description: "Live calls now use this graph. The canvas stays your draft.",
        }),
      )
      .catch((e) => toast.error("Publish failed", { description: (e as Error).message }));

  /** Saved test conversations run first; a failure asks before anything goes live. */
  async function publishAfterTests() {
    const tests = normalizeTestConversations(testConversations);
    if (!tests.length) return publish();
    setChecking(true);
    try {
      const results = await runTests(tests);
      const bad = results.filter((r) => !r.passed);
      if (bad.length) {
        setFailed(results);
        return;
      }
      toast.success(`All ${results.length} test conversations passed`);
      await publish();
    } catch (e) {
      toast.error("Could not run the test conversations", {
        description: `${(e as Error).message}. Nothing was published.`,
      });
    } finally {
      setChecking(false);
    }
  }

  return (
    <>
    <TestConversationsDialog open={testsOpen} onOpenChange={setTestsOpen} />
    <Dialog open={failed != null} onOpenChange={(o) => !o && setFailed(null)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {failed?.filter((r) => !r.passed).length} of {failed?.length} test conversations failed
          </DialogTitle>
          <DialogDescription>Nothing has been published. Fix the flow, or publish anyway.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] overflow-y-auto">{failed && <TestResultList results={failed} />}</div>
        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={() => setFailed(null)}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => {
              setFailed(null);
              void publish();
            }}
          >
            Publish anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          title={published ? `Published v${published.version}` : "Versions"}
          className="!h-8 gap-1 px-2 text-[11px] text-muted-foreground/70 hover:text-foreground"
        >
          <History className="h-3.5 w-3.5" />
          {published ? `v${published.version}` : "Draft"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-[11px]">Versions</DropdownMenuLabel>
        <DropdownMenuItem disabled={checking} onClick={() => void publishAfterTests()}>
          {checking ? (
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Rocket className="mr-2 h-3.5 w-3.5" />
          )}
          {checking ? "Running test conversations…" : "Publish current draft"}
        </DropdownMenuItem>
        {rollbackTo != null && (
          <DropdownMenuItem
            onClick={() => {
              void rollbackPublished()
                .then((v) =>
                  v != null
                    ? toast.success(`Live calls are back on v${v}`, {
                        description: "Your draft on the canvas is unchanged.",
                      })
                    : toast.error("No earlier published version to go back to"),
                )
                .catch((e) => toast.error("Roll back failed", { description: (e as Error).message }));
            }}
          >
            <Undo className="mr-2 h-3.5 w-3.5" />
            Roll back live to v{rollbackTo}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => setTestsOpen(true)}>
          <FlaskConical className="mr-2 h-3.5 w-3.5" />
          Test conversations{testConversations?.length ? ` (${testConversations.length})` : "…"}
        </DropdownMenuItem>
        {published && (
          <DropdownMenuItem
            onClick={() => {
              unpublishFlow();
              toast.success("Unpublished", { description: "Live calls will use the latest saved draft." });
            }}
          >
            <Undo2 className="mr-2 h-3.5 w-3.5" />
            Unpublish
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {(history ?? []).length === 0 ? (
          <p className="px-2 py-3 text-[11px] text-muted-foreground">No snapshots yet. Save or publish to create one.</p>
        ) : (
          [...(history ?? [])].reverse().map((snap) => (
            <DropdownMenuItem
              key={snap.version}
              onClick={() => {
                void restoreFlowVersion(snap.version)
                  .then((ok) => {
                    if (ok) toast.success(`Restored v${snap.version}`);
                  })
                  .catch((e) => toast.error("Restore failed", { description: (e as Error).message }));
              }}
            >
              <RotateCcw className="mr-2 h-3.5 w-3.5" />
              <span className="flex min-w-0 flex-col">
                <span>
                  v{snap.version} · {snap.label}
                  {published?.version === snap.version ? " · live" : ""}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(snap.createdAt).toLocaleString()}
                </span>
              </span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
    </>
  );
}
