import { useState, useCallback } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Brain, TrendingUp, Server, Globe,
  Upload, Trash2, RefreshCw, Sparkles, Loader2,
  FileText, CheckCircle2, Clock, AlertCircle, Library,
  ChevronDown, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  listPlatformKnowledgeBases,
  getPlatformDocuments,
  getPlatformUploadUrl,
  recordPlatformDocument,
  deletePlatformDocument,
  reindexPlatformDocument,
  seedPlatformDefaults,
  getPlatformKnowledgeStats,
} from "@/lib/executives/platform-knowledge.server";

export const Route = createFileRoute("/_authenticated/admin/platform-knowledge")({
  component: PlatformKnowledgePage,
});

// ── Constants ─────────────────────────────────────────────────────────────────
const KB_META: Record<string, { icon: React.ElementType; accent: string; label: string }> = {
  platform_hivemind:   { icon: Brain,     accent: "text-violet-400 bg-violet-500/15 ring-violet-500/30",  label: "HiveMind" },
  platform_growthmind: { icon: TrendingUp,accent: "text-emerald-400 bg-emerald-500/15 ring-emerald-500/30", label: "GrowthMind" },
  platform_systemmind: { icon: Server,    accent: "text-sky-400 bg-sky-500/15 ring-sky-500/30",           label: "SystemMind" },
  platform_shared:     { icon: Globe,     accent: "text-amber-400 bg-amber-500/15 ring-amber-500/30",     label: "Shared" },
};

const STATUS_META: Record<string, { icon: React.ElementType; color: string; label: string }> = {
  indexed:    { icon: CheckCircle2, color: "text-emerald-400", label: "Indexed" },
  pending:    { icon: Clock,        color: "text-amber-400",   label: "Pending" },
  processing: { icon: Loader2,      color: "text-sky-400",     label: "Processing" },
  failed:     { icon: AlertCircle,  color: "text-red-400",     label: "Failed" },
};

// ── Page ─────────────────────────────────────────────────────────────────────
function PlatformKnowledgePage() {
  const qc = useQueryClient();
  const listFn    = useServerFn(listPlatformKnowledgeBases);
  const statsFn   = useServerFn(getPlatformKnowledgeStats);
  const seedFn    = useServerFn(seedPlatformDefaults);

  const { data: kbData, isLoading: kbLoading } = useQuery({
    queryKey: ["platform-kbs"],
    queryFn:  () => listFn(),
    throwOnError: false,
  });
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["platform-kb-stats"],
    queryFn:  () => statsFn(),
    throwOnError: false,
  });

  const [seeding, setSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState<string | null>(null);

  const handleSeedDefaults = useCallback(async () => {
    setSeeding(true);
    setSeedResult(null);
    try {
      let total = 0;
      for (let i = 0; i < 8; i++) {
        const r = await seedFn({ data: { limit: 2 } });
        total += r.processed;
        if (r.remaining === 0 || (r.processed === 0 && r.failed === 0)) break;
      }
      setSeedResult(`Seeded ${total} document${total !== 1 ? "s" : ""} successfully.`);
      qc.invalidateQueries({ queryKey: ["platform-kbs"] });
      qc.invalidateQueries({ queryKey: ["platform-kb-stats"] });
      qc.invalidateQueries({ queryKey: ["platform-docs"] });
    } catch (err: any) {
      setSeedResult(`Error: ${err?.message ?? "Seeding failed"}`);
    } finally {
      setSeeding(false);
    }
  }, [seedFn, qc]);

  const kbs = kbData?.kbs ?? [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/[0.04] ring-1 ring-white/[0.08]">
            <Library className="h-5 w-5 text-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-bold">Platform Knowledge</h1>
            <p className="text-xs text-muted-foreground">
              Global WEBEE knowledge available to all workspaces — admin managed.
            </p>
          </div>
        </div>
        <button
          onClick={handleSeedDefaults}
          disabled={seeding}
          className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-60 transition-colors"
        >
          {seeding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {seeding ? "Seeding…" : "Seed Defaults"}
        </button>
      </div>

      {/* Seed result banner */}
      {seedResult && (
        <div className={cn(
          "rounded-xl border px-4 py-3 text-xs",
          seedResult.startsWith("Error")
            ? "border-red-500/20 bg-red-500/[0.06] text-red-200"
            : "border-emerald-500/20 bg-emerald-500/[0.06] text-emerald-200",
        )}>
          {seedResult}
        </div>
      )}

      {/* Stats row */}
      {!statsLoading && stats && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Total Docs</p>
            <p className="mt-1 text-2xl font-bold">{stats.totalDocs}</p>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Indexed</p>
            <p className="mt-1 text-2xl font-bold text-emerald-400">{stats.totalIndexed}</p>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Total Chunks</p>
            <p className="mt-1 text-2xl font-bold">{stats.totalChunks}</p>
          </div>
        </div>
      )}

      {/* KB cards */}
      {kbLoading ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          {kbs.map((kb: any) => (
            <KbCard key={kb.id} kb={kb} stats={stats?.perKb?.find((s: any) => s.slug === kb.slug)} />
          ))}
        </div>
      )}

      {/* Explanation */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 text-xs text-muted-foreground leading-relaxed space-y-2">
        <p className="font-medium text-foreground/80">How Platform Knowledge Works</p>
        <p>Documents uploaded here are stored once globally and automatically included in every workspace's executive AI context. No duplication — all workspaces benefit instantly when you add or update content.</p>
        <p><strong className="text-foreground/70">Retrieval order:</strong> Workspace-specific knowledge is always retrieved first. Platform knowledge fills in when workspace content is sparse or a query matches platform material better.</p>
        <p><strong className="text-foreground/70">Security:</strong> Platform documents are read-only for workspace users. Only platform admins (user_type = admin) can add, edit or delete platform knowledge.</p>
      </div>
    </div>
  );
}

// ── KB Card ───────────────────────────────────────────────────────────────────
function KbCard({ kb, stats }: { kb: any; stats: any }) {
  const [open, setOpen] = useState(false);
  const meta = KB_META[kb.slug] ?? { icon: Library, accent: "text-foreground bg-white/[0.06] ring-white/[0.12]", label: kb.slug };
  const Icon = meta.icon;
  const ChevronIcon = open ? ChevronDown : ChevronRight;

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02]">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-white/[0.02] transition-colors rounded-xl"
      >
        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1", meta.accent)}>
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{kb.name}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] text-muted-foreground font-mono">
              {kb.slug}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground truncate mt-0.5">{kb.description}</p>
        </div>
        <div className="flex items-center gap-4 text-[11px] text-muted-foreground shrink-0">
          <span>{stats?.docCount ?? 0} docs</span>
          <span className="text-emerald-400/80">{stats?.indexed ?? 0} indexed</span>
          {(stats?.pending ?? 0) > 0 && <span className="text-amber-400/80">{stats.pending} pending</span>}
          {(stats?.failed ?? 0) > 0 && <span className="text-red-400/80">{stats.failed} failed</span>}
        </div>
        <ChevronIcon className="h-4 w-4 text-muted-foreground shrink-0 ml-2" />
      </button>

      {open && <KbDetail kbId={kb.id} kbSlug={kb.slug} />}
    </div>
  );
}

// ── KB Detail (expanded) ──────────────────────────────────────────────────────
function KbDetail({ kbId: _kbId, kbSlug }: { kbId: string; kbSlug: string }) {
  const qc = useQueryClient();
  const docsFn     = useServerFn(getPlatformDocuments);
  const uploadFn   = useServerFn(getPlatformUploadUrl);
  const recordFn   = useServerFn(recordPlatformDocument);
  const deleteFn   = useServerFn(deletePlatformDocument);
  const reindexFn  = useServerFn(reindexPlatformDocument);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["platform-docs", kbSlug],
    queryFn:  () => docsFn({ data: { kbSlug } }),
    throwOnError: false,
  });
  const docs = data?.docs ?? [];

  const deleteMut = useMutation({
    mutationFn: (documentId: string) => deleteFn({ data: { documentId } }),
    onSuccess:  () => { refetch(); qc.invalidateQueries({ queryKey: ["platform-kb-stats"] }); },
  });
  const reindexMut = useMutation({
    mutationFn: (documentId: string) => reindexFn({ data: { documentId } }),
    onSuccess:  () => refetch(),
  });

  // ── File upload ──────────────────────────────────────────────────────────
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadErr(null);
    try {
      const { signedUrl, storagePath, knowledgeBaseId: _kbId2 } = await uploadFn({
        data: { kbSlug, fileName: file.name, mimeType: file.type },
      });
      const uploadRes = await fetch(signedUrl, {
        method: "PUT",
        body:   file,
        headers: { "Content-Type": file.type || "application/octet-stream" },
      });
      if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}`);
      await recordFn({
        data: {
          kbSlug,
          title:       file.name.replace(/\.[^.]+$/, ""),
          fileName:    file.name,
          mimeType:    file.type,
          fileSize:    file.size,
          storagePath,
        },
      });
      refetch();
      qc.invalidateQueries({ queryKey: ["platform-kb-stats"] });
    } catch (err: any) {
      setUploadErr(err?.message ?? "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }, [kbSlug, uploadFn, recordFn, refetch, qc]);

  return (
    <div className="border-t border-white/[0.06] px-4 pb-4 pt-3 space-y-3">
      {/* Upload row */}
      <div className="flex items-center gap-3">
        <label className={cn(
          "flex items-center gap-2 rounded-lg border border-white/[0.08] px-3 py-1.5 text-xs font-medium cursor-pointer transition-colors",
          uploading ? "opacity-60 cursor-not-allowed" : "hover:bg-white/[0.04]",
        )}>
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          {uploading ? "Uploading…" : "Upload Document"}
          <input
            type="file"
            accept=".pdf,.docx,.txt,.md,.csv"
            className="hidden"
            disabled={uploading}
            onChange={handleFileUpload}
          />
        </label>
        {uploadErr && <span className="text-xs text-red-400">{uploadErr}</span>}
      </div>

      {/* Documents list */}
      {isLoading ? (
        <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading documents…
        </div>
      ) : docs.length === 0 ? (
        <p className="py-3 text-xs text-muted-foreground/60">
          No documents yet. Upload a file or click "Seed Defaults" to populate this KB.
        </p>
      ) : (
        <div className="space-y-1.5">
          {docs.map((doc: any) => {
            const sm = STATUS_META[doc.embedding_status] ?? STATUS_META.pending;
            const StatusIcon = sm.icon;
            return (
              <div
                key={doc.id}
                className="flex items-center gap-3 rounded-lg border border-white/[0.04] bg-white/[0.02] px-3 py-2 text-xs"
              >
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate font-medium">{doc.title}</span>
                {doc.seed_key && (
                  <span className="shrink-0 rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-400">seed</span>
                )}
                <div className={cn("flex items-center gap-1 shrink-0", sm.color)}>
                  <StatusIcon className={cn("h-3 w-3", doc.embedding_status === "processing" && "animate-spin")} />
                  <span>{sm.label}</span>
                </div>
                {doc.chunk_count > 0 && (
                  <span className="shrink-0 text-muted-foreground/60">{doc.chunk_count} chunks</span>
                )}
                {/* Re-index (only for uploaded docs with storage_path) */}
                {doc.source_type === "upload" && (
                  <button
                    onClick={() => reindexMut.mutate(doc.id)}
                    disabled={reindexMut.isPending}
                    title="Re-index"
                    className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-colors disabled:opacity-40"
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", reindexMut.isPending && "animate-spin")} />
                  </button>
                )}
                {/* Delete */}
                <button
                  onClick={() => {
                    if (confirm(`Delete "${doc.title}" from platform knowledge?`)) {
                      deleteMut.mutate(doc.id);
                    }
                  }}
                  disabled={deleteMut.isPending}
                  title="Delete"
                  className="shrink-0 rounded p-1 text-muted-foreground hover:text-red-400 hover:bg-red-500/[0.06] transition-colors disabled:opacity-40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
