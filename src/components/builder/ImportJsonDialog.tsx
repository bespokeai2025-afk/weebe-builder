import { useRef, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Upload, FileUp } from "lucide-react";
import { importAgentJson } from "@/lib/builder/import-conversation-flow";
import { desanitizeImportJson } from "@/lib/builder/sanitize-brand";

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
