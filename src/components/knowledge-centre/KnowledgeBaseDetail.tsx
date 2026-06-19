import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  ArrowLeft, Upload, Loader2, FileText, Trash2, RefreshCw, CheckCircle2, AlertTriangle, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  getExecutiveUploadUrl, recordExecutiveDocument, listExecutiveDocuments,
  deleteExecutiveDocument, reindexExecutiveDocument,
} from "@/lib/executives/executive-knowledge.functions";
import { DEFAULT_EXECUTIVE_KBS } from "@/lib/executives/executive-knowledge.config";

const ACCEPTED = ".pdf,.docx,.xlsx,.txt,.md,.csv";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { c: string; icon: React.ElementType; label: string }> = {
    indexed: { c: "text-emerald-400 bg-emerald-500/10", icon: CheckCircle2, label: "Indexed" },
    pending: { c: "text-amber-400 bg-amber-500/10", icon: Clock, label: "Pending" },
    processing: { c: "text-sky-400 bg-sky-500/10", icon: Loader2, label: "Processing" },
    failed: { c: "text-red-400 bg-red-500/10", icon: AlertTriangle, label: "Failed" },
  };
  const s = map[status] ?? map.pending;
  const Icon = s.icon;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium", s.c)}>
      <Icon className={cn("h-3 w-3", status === "processing" && "animate-spin")} />
      {s.label}
    </span>
  );
}

export function KnowledgeBaseDetail({ slug }: { slug: string }) {
  const kbDef = DEFAULT_EXECUTIVE_KBS.find((k) => k.slug === slug);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const uploadUrlFn = useServerFn(getExecutiveUploadUrl);
  const recordFn = useServerFn(recordExecutiveDocument);
  const listFn = useServerFn(listExecutiveDocuments);
  const deleteFn = useServerFn(deleteExecutiveDocument);
  const reindexFn = useServerFn(reindexExecutiveDocument);

  const { data: docs, isLoading, refetch } = useQuery({
    queryKey: ["executive-documents", slug],
    queryFn: () => listFn({ data: { slug } }),
    throwOnError: false,
  });

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      try {
        const { signedUrl, storagePath } = await uploadUrlFn({
          data: { slug, fileName: file.name, mimeType: file.type || undefined },
        });
        const put = await fetch(signedUrl, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type || "application/octet-stream", "x-upsert": "true" },
        });
        if (!put.ok) throw new Error(`Upload failed (${put.status})`);
        const doc: any = await recordFn({
          data: {
            slug, title: file.name, fileName: file.name,
            mimeType: file.type || undefined, fileSize: file.size, storagePath,
          },
        });
        if (doc?.embedding_status === "failed") {
          toast.error(`${file.name}: ${doc.error_message ?? "indexing failed"}`);
        } else {
          toast.success(`${file.name} indexed`);
        }
      } catch (e: any) {
        toast.error(`${file.name}: ${e?.message ?? "upload failed"}`);
      }
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
    refetch();
  }

  async function handleDelete(id: string) {
    try {
      await deleteFn({ data: { id } });
      toast.success("Document deleted");
      refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Delete failed");
    }
  }

  async function handleReindex(id: string) {
    try {
      const res: any = await reindexFn({ data: { id } });
      if (res?.ok) toast.success("Re-indexed");
      else toast.error(res?.error ?? "Re-index failed");
      refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Re-index failed");
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-8">
      <Link to="/knowledge-centre" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Knowledge Centre
      </Link>

      <div className="mt-3 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">{kbDef?.name ?? slug}</h1>
          <p className="mt-1 text-xs text-muted-foreground max-w-xl">{kbDef?.description}</p>
        </div>
      </div>

      {/* Upload */}
      <div className="mt-6">
        <input
          ref={fileRef} type="file" multiple accept={ACCEPTED} className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/[0.12] bg-white/[0.02] py-10 transition-colors hover:border-white/[0.2] hover:bg-white/[0.04] disabled:opacity-60"
        >
          {uploading ? <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /> : <Upload className="h-6 w-6 text-muted-foreground" />}
          <span className="text-sm font-medium">{uploading ? "Uploading & indexing…" : "Upload documents"}</span>
          <span className="text-[11px] text-muted-foreground">PDF, DOCX, XLSX, TXT, MD, CSV</span>
        </button>
      </div>

      {/* Documents */}
      <div className="mt-6">
        <h2 className="text-sm font-semibold mb-3">Documents</h2>
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (docs?.length ?? 0) === 0 ? (
          <p className="rounded-xl border border-white/[0.06] bg-white/[0.02] py-10 text-center text-sm text-muted-foreground">
            No documents yet. Upload reference material to ground this executive.
          </p>
        ) : (
          <div className="space-y-2">
            {docs!.map((d: any) => (
              <div key={d.id} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{d.title}</p>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <StatusBadge status={d.embedding_status} />
                    {d.chunk_count ? <span>{d.chunk_count} chunks</span> : null}
                    {d.embedding_status === "failed" && d.error_message ? (
                      <span className="truncate text-red-400/80">{d.error_message}</span>
                    ) : null}
                  </div>
                </div>
                <button onClick={() => handleReindex(d.id)} title="Re-index" className="rounded-md p-1.5 text-muted-foreground hover:bg-white/[0.06] hover:text-foreground">
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => handleDelete(d.id)} title="Delete" className="rounded-md p-1.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-400">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
