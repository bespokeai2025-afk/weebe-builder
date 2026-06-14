import { useRef, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Upload, Loader2, FileText, Trash2, RefreshCw,
  CheckCircle2, AlertTriangle, Clock, BookOpen, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  getExecutiveUploadUrl,
  recordExecutiveDocument,
  listExecutiveDocuments,
  deleteExecutiveDocument,
  reindexExecutiveDocument,
  seedExecutiveStarterKnowledge,
} from "@/lib/executives/executive-knowledge.functions";
import { seedSystemMindPlaybooks, seedSystemMindKbs } from "@/lib/systemmind/systemmind-workflow.functions";

const SLUG = "systemmind";
const ACCEPTED = ".pdf,.docx,.xlsx,.txt,.md,.csv";

const CATEGORY_SUGGESTIONS = [
  "Architecture Decisions",
  "Deployment Guides",
  "Workflow Repair Guides",
  "Provider Integration Guides",
  "Security Policies",
  "Monitoring Runbooks",
  "Known Issues",
  "Cost Optimisation",
  "Best Practices",
  "Incident Post-Mortems",
];

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

export function SystemMindKnowledgePage() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const uploadUrlFn = useServerFn(getExecutiveUploadUrl);
  const recordFn    = useServerFn(recordExecutiveDocument);
  const listFn      = useServerFn(listExecutiveDocuments);
  const deleteFn    = useServerFn(deleteExecutiveDocument);
  const reindexFn   = useServerFn(reindexExecutiveDocument);
  const seedKbFn       = useServerFn(seedExecutiveStarterKnowledge);
  const seedPbFn       = useServerFn(seedSystemMindPlaybooks);
  const seedArchWfFn   = useServerFn(seedSystemMindKbs);

  const { data: docs, isLoading, refetch } = useQuery({
    queryKey: ["sm-knowledge", SLUG],
    queryFn: () => listFn({ data: { slug: SLUG } }),
    refetchInterval: (q) =>
      (q.state.data as any[])?.some((d: any) => d.embedding_status === "processing")
        ? 4000
        : false,
  });

  // Seed repair playbooks + executive starter knowledge + Architecture/Workflow KB on first mount.
  // Each seeder is idempotent — already-indexed docs are skipped automatically.
  useEffect(() => {
    (async () => {
      try { await seedPbFn({ data: {} }); } catch { /* graceful */ }
      try { await seedKbFn({ data: { limit: 4 } }); } catch { /* graceful */ }
      // Seed Architecture KB + Workflow KB in two batches (8 docs total, 4 per call)
      try { await seedArchWfFn({ data: { limit: 4 } }); } catch { /* graceful */ }
      try { await seedArchWfFn({ data: { limit: 4 } }); } catch { /* graceful */ }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      try {
        const { signedUrl, storagePath } = await uploadUrlFn({
          data: { slug: SLUG, fileName: file.name, mimeType: file.type || undefined },
        });
        const put = await fetch(signedUrl, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type || "application/octet-stream", "x-upsert": "true" },
        });
        if (!put.ok) throw new Error(`Upload failed (${put.status})`);
        const doc: any = await recordFn({
          data: {
            slug: SLUG, title: file.name, fileName: file.name,
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
    refetch();
  }

  async function handleDelete(id: string, title: string) {
    try {
      await deleteFn({ data: { id } });
      toast.success(`${title} deleted`);
      qc.invalidateQueries({ queryKey: ["sm-knowledge", SLUG] });
    } catch (e: any) {
      toast.error(e?.message ?? "Delete failed");
    }
  }

  async function handleReindex(id: string) {
    try {
      await reindexFn({ data: { id } });
      toast.success("Reindexing started");
      refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Reindex failed");
    }
  }

  async function handleSeedAll() {
    setSeeding(true);
    try {
      await seedKbFn({ data: { limit: 10 } });
      toast.success("Starter knowledge seeded");
      refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Seeding failed");
    } finally {
      setSeeding(false);
    }
  }

  const docList = (docs as any[]) ?? [];
  const indexedCount  = docList.filter((d) => d.embedding_status === "indexed").length;
  const pendingCount  = docList.filter((d) => d.embedding_status === "pending" || d.embedding_status === "processing").length;
  const failedCount   = docList.filter((d) => d.embedding_status === "failed").length;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">SystemMind Knowledge</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Upload architecture docs, runbooks, repair guides and best practices — SystemMind uses them to ground every AI response.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleSeedAll}
          disabled={seeding}
          className="text-xs gap-1.5"
        >
          {seeding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          Seed Starter Knowledge
        </Button>
      </div>

      {/* Stats */}
      {docList.length > 0 && (
        <div className="flex gap-3">
          {[
            { label: "Indexed",    value: indexedCount,  color: "text-emerald-400" },
            { label: "Processing", value: pendingCount,  color: "text-amber-400" },
            { label: "Failed",     value: failedCount,   color: "text-red-400" },
          ].map((s) => (
            <div key={s.label} className="flex items-center gap-1.5 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
              <span className={cn("text-base font-semibold", s.color)}>{s.value}</span>
              <span className="text-xs text-muted-foreground">{s.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Upload dropzone */}
      <div
        className="relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-white/[0.1] bg-white/[0.02] px-8 py-12 cursor-pointer hover:border-sky-500/40 hover:bg-sky-500/[0.03] transition-colors"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
        onClick={() => fileRef.current?.click()}
      >
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPTED}
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        {uploading ? (
          <Loader2 className="h-8 w-8 text-sky-400 animate-spin mb-3" />
        ) : (
          <Upload className="h-8 w-8 text-muted-foreground mb-3" />
        )}
        <p className="text-sm font-medium">
          {uploading ? "Uploading & indexing…" : "Drop files here or click to upload"}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          PDF, DOCX, XLSX, TXT, MD, CSV — max 50 MB each
        </p>
      </div>

      {/* Category suggestions */}
      <div>
        <p className="text-xs text-muted-foreground mb-2 font-medium">Suggested categories to document:</p>
        <div className="flex flex-wrap gap-1.5">
          {CATEGORY_SUGGESTIONS.map((cat) => (
            <Badge key={cat} variant="outline" className="text-[10px] text-muted-foreground border-white/[0.08]">
              {cat}
            </Badge>
          ))}
        </div>
      </div>

      {/* Document list */}
      <div className="space-y-2">
        <h2 className="text-sm font-medium flex items-center gap-2">
          <BookOpen className="h-3.5 w-3.5 text-sky-400" />
          Indexed Documents
          {isLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
        </h2>

        {!isLoading && docList.length === 0 && (
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] py-10 text-center">
            <FileText className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No documents yet</p>
            <p className="text-xs text-muted-foreground/60 mt-0.5">Upload your first document above, or click "Seed Starter Knowledge"</p>
          </div>
        )}

        {docList.map((doc: any) => (
          <div
            key={doc.id}
            className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
          >
            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">{doc.title}</p>
              <p className="text-[10px] text-muted-foreground">
                {doc.chunk_count ? `${doc.chunk_count} chunks` : "—"}
                {doc.file_size ? ` · ${(doc.file_size / 1024).toFixed(0)} KB` : ""}
              </p>
            </div>
            <StatusBadge status={doc.embedding_status} />
            {doc.embedding_status === "failed" && (
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 shrink-0"
                title="Retry indexing"
                onClick={() => handleReindex(doc.id)}
              >
                <RefreshCw className="h-3 w-3" />
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 shrink-0 text-muted-foreground hover:text-red-400"
              onClick={() => handleDelete(doc.id, doc.title)}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
