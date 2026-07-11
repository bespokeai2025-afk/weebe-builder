// ── Business DNA — Knowledge Base document upload ─────────────────────────────
// Lets any workspace upload reference documentation (brand guides, pricing
// sheets, case studies, sales playbooks, etc.) straight from the Business DNA
// page. Uploads land in the workspace's GrowthMind executive knowledge base
// (slug "growthmind"), so they are:
//   1. Immediately part of GrowthMind's private RAG knowledge (read by every
//      GrowthMind AI generation/chat/strategy path), and
//   2. Picked up by the Business DNA discovery engine as an extra evidence
//      source alongside calls, leads, campaigns and executive events.
// Fully generic/per-workspace — no workspace is special-cased.

import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Upload, Loader2, FileText, Trash2, RefreshCw, CheckCircle2, AlertTriangle, Clock, BookOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getExecutiveUploadUrl, recordExecutiveDocument, listExecutiveDocuments,
  deleteExecutiveDocument, reindexExecutiveDocument,
} from "@/lib/executives/executive-knowledge.functions";

const ACCEPTED = ".pdf,.docx,.xlsx,.txt,.md,.csv";
const KB_SLUG = "growthmind";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { c: string; icon: React.ElementType; label: string }> = {
    indexed:    { c: "text-emerald-400 bg-emerald-500/10", icon: CheckCircle2, label: "Indexed" },
    pending:    { c: "text-amber-400 bg-amber-500/10",     icon: Clock,        label: "Pending" },
    processing: { c: "text-sky-400 bg-sky-500/10",         icon: Loader2,      label: "Processing" },
    failed:     { c: "text-red-400 bg-red-500/10",         icon: AlertTriangle, label: "Failed" },
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

export function BusinessDnaKnowledgeUpload({
  accent = "violet",
}: {
  accent?: "violet" | "emerald";
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const uploadUrlFn = useServerFn(getExecutiveUploadUrl);
  const recordFn    = useServerFn(recordExecutiveDocument);
  const listFn      = useServerFn(listExecutiveDocuments);
  const deleteFn    = useServerFn(deleteExecutiveDocument);
  const reindexFn   = useServerFn(reindexExecutiveDocument);

  const { data: docs, isLoading, refetch } = useQuery({
    queryKey: ["executive-documents", KB_SLUG],
    queryFn: () => listFn({ data: { slug: KB_SLUG } }),
    throwOnError: false,
  });

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      try {
        const { signedUrl, storagePath } = await uploadUrlFn({
          data: { slug: KB_SLUG, fileName: file.name, mimeType: file.type || undefined },
        });
        const put = await fetch(signedUrl, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type || "application/octet-stream", "x-upsert": "true" },
        });
        if (!put.ok) throw new Error(`Upload failed (${put.status})`);
        const doc: any = await recordFn({
          data: {
            slug: KB_SLUG, title: file.name, fileName: file.name,
            mimeType: file.type || undefined, fileSize: file.size, storagePath,
          },
        });
        if (doc?.embedding_status === "failed") {
          toast.error(`${file.name}: ${doc.error_message ?? "indexing failed"}`);
        } else {
          toast.success(`${file.name} indexed into GrowthMind knowledge`);
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
      toast.success("Document removed");
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

  const accentClasses = accent === "emerald"
    ? { bg: "bg-emerald-500/15", ring: "ring-emerald-500/25", text: "text-emerald-400" }
    : { bg: "bg-violet-500/15", ring: "ring-violet-500/25", text: "text-violet-400" };

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-[hsl(var(--card))] overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4">
        <div className={cn("flex h-7 w-7 items-center justify-center rounded-lg shrink-0", accentClasses.bg, "ring-1", accentClasses.ring)}>
          <BookOpen className={cn("h-3.5 w-3.5", accentClasses.text)} />
        </div>
        <div>
          <p className="text-sm font-semibold">Knowledge Base Documents</p>
          <p className="text-[11px] text-muted-foreground">
            Upload docs (brand guides, pricing, case studies, playbooks) — feeds Business DNA discovery and GrowthMind's private knowledge base
          </p>
        </div>
      </div>

      <div className="px-5 pb-5 space-y-4">
        <input
          ref={fileRef} type="file" multiple accept={ACCEPTED} className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/[0.12] bg-white/[0.02] py-6 transition-colors hover:border-white/[0.2] hover:bg-white/[0.04] disabled:opacity-60"
        >
          {uploading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : <Upload className="h-5 w-5 text-muted-foreground" />}
          <span className="text-xs font-medium">{uploading ? "Uploading & indexing…" : "Upload documents"}</span>
          <span className="text-[10px] text-muted-foreground">PDF, DOCX, XLSX, TXT, MD, CSV</span>
        </button>

        {isLoading ? (
          <div className="flex items-center justify-center py-6 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : (docs?.length ?? 0) === 0 ? (
          <p className="rounded-xl border border-white/[0.06] bg-white/[0.02] py-6 text-center text-xs text-muted-foreground">
            No documents yet. Upload reference material to sharpen your Business DNA and GrowthMind's knowledge.
          </p>
        ) : (
          <div className="space-y-1.5">
            {docs!.map((d: any) => (
              <div key={d.id} className="flex items-center gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{d.title}</p>
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                    <StatusBadge status={d.embedding_status} />
                    {d.chunk_count ? <span>{d.chunk_count} chunks</span> : null}
                    {d.embedding_status === "failed" && d.error_message ? (
                      <span className="truncate text-red-400/80">{d.error_message}</span>
                    ) : null}
                  </div>
                </div>
                <button onClick={() => handleReindex(d.id)} title="Re-index" className="rounded-md p-1 text-muted-foreground hover:bg-white/[0.06] hover:text-foreground">
                  <RefreshCw className="h-3 w-3" />
                </button>
                <button onClick={() => handleDelete(d.id)} title="Delete" className="rounded-md p-1 text-muted-foreground hover:bg-red-500/10 hover:text-red-400">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
