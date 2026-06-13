import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getSignedUploadUrl, recordDocumentUpload } from "@/lib/dashboard/documents.functions";
import { Loader2, UploadCloud, CheckCircle2, XCircle, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/upload/$token")({
  component: UploadPage,
});

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function UploadPage() {
  const { token } = Route.useParams();
  const getUrlFn  = useServerFn(getSignedUploadUrl);
  const recordFn  = useServerFn(recordDocumentUpload);

  const [files,     setFiles]     = useState<File[]>([]);
  const [status,    setStatus]    = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [message,   setMessage]   = useState("");
  const [dragging,  setDragging]  = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    const arr = Array.from(incoming).filter((f) => f.size <= 52_428_800);
    setFiles((prev) => {
      const names = new Set(prev.map((f) => f.name));
      return [...prev, ...arr.filter((f) => !names.has(f.name))];
    });
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }, []);

  async function handleUpload() {
    if (!files.length) return;
    setStatus("uploading");
    setMessage("");
    try {
      for (const file of files) {
        const info = await getUrlFn({
          data: { token, fileName: file.name, mimeType: file.type || undefined },
        });
        const put = await fetch(info.signedUrl, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type || "application/octet-stream" },
        });
        if (!put.ok) throw new Error(`Upload failed for ${file.name}`);

        await recordFn({
          data: {
            uploadToken: token,
            fileName:    file.name,
            fileSize:    file.size,
            mimeType:    file.type || undefined,
            storagePath: info.storagePath,
            publicUrl:   info.publicUrl,
            uploadedBy:  "client",
          },
        });
      }
      setStatus("done");
      setFiles([]);
      setMessage(`${files.length} file${files.length > 1 ? "s" : ""} uploaded successfully.`);
    } catch (e: any) {
      setStatus("error");
      setMessage(e.message ?? "Upload failed. Please try again.");
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">

        {/* Brand */}
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Upload Documents</h1>
          <p className="text-sm text-muted-foreground">
            Securely upload files to share with your advisor.
          </p>
        </div>

        {status === "done" ? (
          <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-8 text-center space-y-3">
            <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto" />
            <p className="font-semibold text-green-600 dark:text-green-400">{message}</p>
            <p className="text-xs text-muted-foreground">
              Your advisor has been notified. You can close this page.
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setStatus("idle")}
            >
              Upload more files
            </Button>
          </div>
        ) : (
          <>
            {/* Drop zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              className={cn(
                "border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors space-y-3",
                dragging
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50 hover:bg-muted/30",
              )}
            >
              <UploadCloud className="h-10 w-10 mx-auto text-muted-foreground" />
              <div>
                <p className="font-medium text-sm">Drag &amp; drop files here</p>
                <p className="text-xs text-muted-foreground mt-0.5">or click to browse — max 50 MB per file</p>
              </div>
              <input
                ref={inputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => addFiles(e.target.files)}
              />
            </div>

            {/* File list */}
            {files.length > 0 && (
              <div className="space-y-2">
                {files.map((f, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm">
                    <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="flex-1 truncate">{f.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{fmtSize(f.size)}</span>
                    <button
                      className="text-muted-foreground hover:text-destructive transition-colors ml-1"
                      onClick={(e) => { e.stopPropagation(); setFiles((prev) => prev.filter((_, j) => j !== i)); }}
                    >
                      <XCircle className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {status === "error" && (
              <p className="text-sm text-destructive text-center">{message}</p>
            )}

            <Button
              className="w-full gap-2"
              onClick={handleUpload}
              disabled={!files.length || status === "uploading"}
            >
              {status === "uploading" ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Uploading…</>
              ) : (
                <><UploadCloud className="h-4 w-4" /> Upload {files.length > 0 ? `${files.length} file${files.length > 1 ? "s" : ""}` : "Files"}</>
              )}
            </Button>

            <p className="text-center text-[11px] text-muted-foreground">
              Files are stored securely and only accessible by your advisor.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
