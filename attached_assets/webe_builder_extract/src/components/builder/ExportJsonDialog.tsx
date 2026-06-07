import { useEffect, useState } from "react";
import { useBuilderStore } from "@/lib/builder/store";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Download, Copy, FileJson, Check } from "lucide-react";
import { exportAgentJson as exportAgent } from "@/lib/builder/export-conversation-flow";
import { sanitizeExportJson } from "@/lib/builder/sanitize-brand";
import { validateFlow } from "@/lib/builder/validate";


export function ExportJsonDialog({
  open: openProp,
  onOpenChange,
  hideTrigger = false,
}: {
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  hideTrigger?: boolean;
} = {}) {
  const { nodes, edges, settings, variables, setSettings } = useBuilderStore();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = (v: boolean) => {
    onOpenChange?.(v);
    if (openProp === undefined) setInternalOpen(v);
  };
  const [filename, setFilename] = useState("webespoke-agent.json");
  const [copied, setCopied] = useState(false);

  // Ensure a stable conversation_flow_id is persisted so re-imports update
  // the same flow instead of creating a new one each time.
  useEffect(() => {
    if (!settings.conversationFlowId) {
      setSettings({
        conversationFlowId: `conversation_flow_${Math.random().toString(16).slice(2, 14)}`,
      });
    }
  }, [settings.conversationFlowId, setSettings]);

  const issues = validateFlow(nodes, edges, variables);
  let json = "";
  let exportError: string | null = null;
  try {
    const payload = exportAgent(nodes, edges, settings, variables);
    json = sanitizeExportJson(JSON.stringify(payload, null, 2));
  } catch (e) {

    exportError = e instanceof Error ? e.message : String(e);
  }

  const download = () => {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "webespoke-agent.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const copy = async () => {
    await navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!hideTrigger && (
        <DialogTrigger asChild>
          <Button size="sm">
            <FileJson className="h-4 w-4 mr-1" /> Download JSON
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>Export Webespoke AI agent</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 space-y-3">
          <p className="text-xs text-muted-foreground">
            Exports the full agent JSON with a nested <code>conversationFlow</code>{" "}
            block.
          </p>

          {exportError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
              <div className="font-medium mb-1">Export error</div>
              {exportError}
            </div>
          )}

          {issues.length > 0 && (
            <div className="rounded-md border bg-muted/40 p-3 text-xs space-y-1 max-h-32 overflow-y-auto">
              <div className="font-medium mb-1">Validation</div>
              {issues.map((i, idx) => (
                <div
                  key={idx}
                  className={i.level === "error" ? "text-destructive" : "text-amber-700"}
                >
                  {i.level === "error" ? "✕" : "⚠"} {i.message}
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Agent ID (optional)</Label>
              <Input
                value={settings.agentId ?? ""}
                onChange={(e) => setSettings({ agentId: e.target.value })}
                placeholder="agent_xxxxxxxxxxxx"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Paste the existing agent ID so re-imports overwrite it.
              </p>
            </div>
            <div>
              <Label>conversation_flow_id</Label>
              <Input
                value={settings.conversationFlowId ?? ""}
                onChange={(e) => setSettings({ conversationFlowId: e.target.value })}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Stable per project — keep this to update the same flow.
              </p>
            </div>
          </div>


          <div>
            <Label>Filename</Label>
            <Input value={filename} onChange={(e) => setFilename(e.target.value)} />
          </div>

          <div>
            <Label>Preview</Label>
            <pre className="mt-1 max-h-24 overflow-auto rounded-md border bg-muted/40 p-2 text-[10px] leading-tight">
              {json}
            </pre>
          </div>
        </div>

        <DialogFooter className="gap-2 px-6 py-4 border-t bg-background sticky bottom-0">
          <Button variant="outline" onClick={copy} disabled={!!exportError || !json}>
            {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button onClick={download} disabled={!!exportError || !json}>
            <Download className="h-4 w-4 mr-1" /> Download
          </Button>
        </DialogFooter>

      </DialogContent>
    </Dialog>
  );
}
