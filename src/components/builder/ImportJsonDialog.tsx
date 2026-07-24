import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useBuilderStore } from "@/lib/builder/store";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Upload, FileUp, CloudDownload, Loader2 } from "lucide-react";
import { importAgentJson } from "@/lib/builder/import-conversation-flow";
import { desanitizeImportJson } from "@/lib/builder/sanitize-brand";
import {
  listWorkspaceRetellAgents,
  fetchWorkspaceRetellAgent,
} from "@/lib/builder/retell.functions";

export function ImportJsonDialog({
  open: openProp,
  onOpenChange,
  hideTrigger = false,
}: {
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  hideTrigger?: boolean;
} = {}) {
  const { loadFlow } = useBuilderStore();
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = (v: boolean) => {
    onOpenChange?.(v);
    if (openProp === undefined) setInternalOpen(v);
  };
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // ── Load directly from the workspace's own voice (Retell) account ──
  const listFn = useServerFn(listWorkspaceRetellAgents);
  const fetchFn = useServerFn(fetchWorkspaceRetellAgent);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [loadingLive, setLoadingLive] = useState(false);
  const liveQ = useQuery({
    queryKey: ["workspace-retell-agents"],
    queryFn: () => listFn(),
    enabled: open,
    // Always refetch on dialog open — the active workspace can change
    // in-session and the key isn't workspace-scoped on the client.
    staleTime: 0,
    throwOnError: false,
  });
  const liveAgents = (liveQ.data?.ok ? liveQ.data.agents : []).filter((a) => a.isFlow);

  const handleLoadLive = async () => {
    if (!selectedAgentId) return;
    setLoadingLive(true);
    setError(null);
    try {
      const res = await fetchFn({ data: { agentId: selectedAgentId } });
      if (!res.ok) {
        setError(res.error ?? "Could not load this agent.");
        return;
      }
      const { nodes, edges, settings, variables } = importAgentJson(res.agentJson);
      if (!nodes.length) {
        setError("This agent's flow has no nodes to load.");
        return;
      }
      // agentRowId: null detaches the builder from any previously-open local
      // agent so saving the loaded flow can't silently overwrite that row.
      loadFlow({ nodes, edges, settings, variables, agentRowId: null });
      setOpen(false);
      setText("");
      setSelectedAgentId("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this agent.");
    } finally {
      setLoadingLive(false);
    }
  };

  const handleFile = async (f: File) => {
    const t = await f.text();
    setText(t);
    setError(null);
  };

  const handleImport = () => {
    try {
      const { nodes, edges, settings, variables } = importAgentJson(desanitizeImportJson(text));

      if (!nodes.length) {
        setError("No nodes found in JSON.");
        return;
      }
      loadFlow({ nodes, edges, settings, variables });
      setOpen(false);
      setText("");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid JSON");
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!hideTrigger && (
        <DialogTrigger asChild>
          <Button size="sm" variant="outline">
            <Upload className="h-4 w-4 mr-1" /> Import JSON
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Webespoke AI agent</DialogTitle>
        </DialogHeader>

        {/* ── Live agents from the workspace's own voice account ── */}
        {(liveQ.isLoading || liveAgents.length > 0) && (
          <div className="space-y-2 rounded-lg border border-white/[0.08] bg-card/40 p-3">
            <p className="text-xs font-medium text-foreground">
              Load from your voice workspace
            </p>
            <p className="text-xs text-muted-foreground">
              Pull one of your live agents straight into the builder — no file needed.
            </p>
            {liveQ.isLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking your voice workspace…
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Select value={selectedAgentId} onValueChange={setSelectedAgentId}>
                  <SelectTrigger className="h-9 flex-1 text-xs">
                    <SelectValue placeholder={`Choose an agent (${liveAgents.length} available)`} />
                  </SelectTrigger>
                  <SelectContent>
                    {liveAgents.map((a) => (
                      <SelectItem key={a.agentId} value={a.agentId} className="text-xs">
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  onClick={handleLoadLive}
                  disabled={!selectedAgentId || loadingLive}
                >
                  {loadingLive ? (
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                  ) : (
                    <CloudDownload className="h-4 w-4 mr-1" />
                  )}
                  Load agent
                </Button>
              </div>
            )}
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Load a previously exported agent JSON to restore your flow.
        </p>

        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />

        <Button variant="outline" onClick={() => fileRef.current?.click()}>
          <FileUp className="h-4 w-4 mr-1" /> Choose file
        </Button>

        <Textarea
          rows={14}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          placeholder="…or paste agent JSON here"
          className="text-xs font-mono"
        />

        {error && <p className="text-xs text-destructive">{error}</p>}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={!text.trim()}>
            <Upload className="h-4 w-4 mr-1" /> Replace flow
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
