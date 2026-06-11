import { useRef, useState } from "react";
import { useBuilderStore } from "@/lib/builder/store";
import type { FlowNode } from "@/lib/builder/store";
import type { Edge } from "@xyflow/react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { FileUp, Loader2, CheckCircle2, AlertCircle, ArrowRight } from "lucide-react";
import { toast } from "sonner";

interface PDFFlowResult {
  title: string;
  nodes: FlowNode[];
  edges: Edge[];
  nodeCount: number;
}

export function ImportPDFDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { loadFlow } = useBuilderStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<"idle" | "processing" | "preview">("idle");
  const [result, setResult] = useState<PDFFlowResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");

  const reset = () => {
    setPhase("idle");
    setResult(null);
    setError(null);
    setFileName("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleClose = (v: boolean) => {
    if (!v) reset();
    onOpenChange(v);
  };

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("Please select a PDF file.");
      return;
    }
    setFileName(file.name);
    setError(null);
    setPhase("processing");

    const form = new FormData();
    form.append("pdf", file);

    try {
      const res = await fetch("/api/builder/import-pdf", { method: "POST", body: form });
      const data = (await res.json()) as PDFFlowResult & { error?: string };
      if (!res.ok || data.error) {
        setError(data.error ?? "Processing failed. Please try again.");
        setPhase("idle");
        return;
      }
      setResult(data);
      setPhase("preview");
    } catch {
      setError("Network error — please try again.");
      setPhase("idle");
    }
  };

  const handleImport = () => {
    if (!result) return;
    loadFlow({ nodes: result.nodes, edges: result.edges });
    toast.success(`"${result.title}" imported`, {
      description: `${result.nodeCount} nodes added to your flow.`,
    });
    handleClose(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileUp className="h-4 w-4 text-violet-400" />
            Import Script from PDF
          </DialogTitle>
        </DialogHeader>

        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />

        {/* ── Phase: idle ── */}
        {phase === "idle" && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Upload a call script or dialogue PDF and it will be automatically converted
              into a multi-step conversation flow.
            </p>
            {error && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {error}
              </div>
            )}
            <Button
              className="w-full"
              onClick={() => fileRef.current?.click()}
            >
              <FileUp className="mr-2 h-4 w-4" />
              Choose PDF file
            </Button>
          </div>
        )}

        {/* ── Phase: processing ── */}
        {phase === "processing" && (
          <div className="flex flex-col items-center gap-4 py-6">
            <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
            <div className="text-center">
              <p className="text-sm font-medium">Processing script…</p>
              <p className="text-xs text-muted-foreground mt-1">{fileName}</p>
            </div>
            <p className="text-xs text-muted-foreground text-center max-w-[260px]">
              Extracting text and converting to a conversation flow. This usually takes 5–15 seconds.
            </p>
          </div>
        )}

        {/* ── Phase: preview ── */}
        {phase === "preview" && result && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-md border border-green-500/20 bg-green-500/5 px-3 py-2">
              <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-green-300">{result.title}</p>
                <p className="text-[11px] text-muted-foreground">
                  {result.nodeCount} nodes · {result.edges.length} connections
                </p>
              </div>
            </div>

            <div className="rounded-md border border-white/[0.06] bg-white/[0.02] max-h-52 overflow-y-auto divide-y divide-white/[0.04]">
              {result.nodes.map((node, idx) => {
                const data = node.data as { kind: string; label: string; dialogue: string; isStart?: boolean };
                return (
                  <div key={node.id} className="flex items-start gap-2.5 px-3 py-2">
                    <span className="mt-0.5 text-[10px] text-muted-foreground/50 w-5 shrink-0 text-right">
                      {idx + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-medium truncate">{data.label}</span>
                        {data.isStart && (
                          <span className="shrink-0 rounded px-1 py-0 text-[9px] bg-violet-500/20 text-violet-300 uppercase tracking-wide">
                            start
                          </span>
                        )}
                        {data.kind === "ending" && (
                          <span className="shrink-0 rounded px-1 py-0 text-[9px] bg-red-500/20 text-red-300 uppercase tracking-wide">
                            end
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground line-clamp-2 mt-0.5">
                        {data.dialogue}
                      </p>
                    </div>
                    {idx < result.nodes.length - 1 && (
                      <ArrowRight className="mt-1 h-3 w-3 shrink-0 text-muted-foreground/30" />
                    )}
                  </div>
                );
              })}
            </div>

            <p className="text-[11px] text-muted-foreground">
              This will <strong>replace</strong> your current flow. You can undo with the
              undo button or import a new agent JSON to restore.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => handleClose(false)}>
            Cancel
          </Button>
          {phase === "preview" && (
            <>
              <Button variant="ghost" onClick={reset}>
                ← Re-upload
              </Button>
              <Button onClick={handleImport}>
                Import into Builder
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
