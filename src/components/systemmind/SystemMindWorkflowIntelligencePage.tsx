import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Network, RefreshCw, Loader2, Search, Sparkles, ShieldAlert,
  Webhook, GitBranch, Zap, KeyRound, AlertTriangle, CheckCircle2,
  Boxes, Repeat, ArrowRight, Layers, Info, PlugZap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  listN8nWorkflowsFn,
  getN8nWorkflowDetailFn,
  scanN8nWorkflowsFn,
  understandN8nWorkflowFn,
} from "@/lib/systemmind/n8n-discovery.functions";

// ── Small presentational helpers ─────────────────────────────────────────────

function ConfidenceBadge({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-[10px] text-muted-foreground/40">not analysed</span>;
  const cls =
    value >= 80 ? "text-emerald-400 border-emerald-500/30 bg-emerald-500/[0.08]"
    : value >= 60 ? "text-sky-400 border-sky-500/30 bg-sky-500/[0.08]"
    : value >= 40 ? "text-amber-400 border-amber-500/30 bg-amber-500/[0.08]"
    : "text-red-400 border-red-500/30 bg-red-500/[0.08]";
  return (
    <span className={cn("text-[10px] font-bold border rounded px-1.5 py-0.5", cls)} title="AI confidence">
      {value}%
    </span>
  );
}

function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("text-[10px] border border-white/[0.08] rounded px-1.5 py-0.5 text-muted-foreground", className)}>
      {children}
    </span>
  );
}

function Section({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
      <p className="text-[11px] font-semibold flex items-center gap-1.5 mb-2">
        <Icon className="h-3.5 w-3.5 text-sky-400" /> {title}
      </p>
      {children}
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  if (!items?.length) return <p className="text-[11px] text-muted-foreground/50">—</p>;
  return (
    <ul className="space-y-1">
      {items.map((it, i) => (
        <li key={i} className="text-[11px] text-muted-foreground flex gap-1.5">
          <span className="text-sky-400/60 shrink-0">•</span>
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}

// ── Detail panel ─────────────────────────────────────────────────────────────

function DetailPanel({ id }: { id: string }) {
  const detailFn = useServerFn(getN8nWorkflowDetailFn);
  const understandFn = useServerFn(understandN8nWorkflowFn);
  const qc = useQueryClient();

  const { data: row, isLoading } = useQuery({
    queryKey: ["sm-n8n-detail", id],
    queryFn: () => detailFn({ data: { id } }),
    throwOnError: false,
  });

  const understandMut = useMutation({
    mutationFn: () => understandFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sm-n8n-detail", id] });
      qc.invalidateQueries({ queryKey: ["sm-n8n-list"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "AI analysis failed"),
  });

  // Auto-generate understanding on first open when missing.
  const hasUnderstanding = !!(row as any)?.understanding;
  useEffect(() => {
    if (row && !hasUnderstanding && !understandMut.isPending) {
      understandMut.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.id, hasUnderstanding]);

  if (isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }
  if (!row) {
    return <div className="py-16 text-center text-sm text-muted-foreground">Workflow not found.</div>;
  }

  const r: any = row;
  const meta = r.metadata ?? {};
  const u = r.understanding ?? null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/15 ring-1 ring-sky-500/25 shrink-0">
          <Network className="h-4 w-4 text-sky-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold">{r.name}</h3>
            {r.active
              ? <Chip className="border-emerald-500/40 text-emerald-400">active</Chip>
              : <Chip className="border-white/[0.08] text-muted-foreground/70">inactive</Chip>}
            <ConfidenceBadge value={r.confidence} />
          </div>
          <div className="flex items-center gap-2 flex-wrap mt-1">
            {r.folder && <Chip>{r.folder}</Chip>}
            {(r.tags ?? []).map((t: string) => <Chip key={t} className="text-sky-400/80 border-sky-500/20">{t}</Chip>)}
            <span className="text-[10px] text-muted-foreground">{r.node_count} nodes · {r.connection_count} connections</span>
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-[10px] gap-1 shrink-0"
          disabled={understandMut.isPending}
          onClick={() => understandMut.mutate()}
        >
          {understandMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          {u ? "Regenerate" : "Analyse"}
        </Button>
      </div>

      {understandMut.isPending && !u && (
        <div className="rounded-lg border border-sky-500/20 bg-sky-500/[0.05] px-3 py-2.5 text-[11px] text-sky-300 flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating AI understanding…
        </div>
      )}

      {/* AI understanding */}
      {u && (
        <>
          <div className="grid sm:grid-cols-2 gap-3">
            <Section icon={Info} title="Business summary">
              <p className="text-[11px] text-muted-foreground leading-relaxed">{u.business_summary || "—"}</p>
              {u.purpose && <p className="text-[10px] text-muted-foreground/60 mt-2"><span className="text-muted-foreground/80">Purpose:</span> {u.purpose}</p>}
            </Section>
            <Section icon={Layers} title="Technical summary">
              <p className="text-[11px] text-muted-foreground leading-relaxed">{u.technical_summary || "—"}</p>
              {u.trigger && <p className="text-[10px] text-muted-foreground/60 mt-2"><span className="text-muted-foreground/80">Trigger:</span> {u.trigger}</p>}
            </Section>
          </div>

          <Section icon={ArrowRight} title="Execution flow">
            {(u.execution_flow ?? []).length > 0 ? (
              <ol className="space-y-1">
                {u.execution_flow.map((s: string, i: number) => (
                  <li key={i} className="text-[11px] text-muted-foreground flex gap-2">
                    <span className="text-sky-400/60 shrink-0 font-mono">{i + 1}.</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
            ) : <p className="text-[11px] text-muted-foreground/50">—</p>}
          </Section>

          <div className="grid sm:grid-cols-2 gap-3">
            <Section icon={ArrowRight} title="Inputs"><BulletList items={u.inputs} /></Section>
            <Section icon={ArrowRight} title="Outputs"><BulletList items={u.outputs} /></Section>
            <Section icon={PlugZap} title="Required services"><BulletList items={u.required_services} /></Section>
            <Section icon={GitBranch} title="Dependencies"><BulletList items={u.dependencies} /></Section>
            <Section icon={AlertTriangle} title="Failure points"><BulletList items={u.failure_points} /></Section>
            <Section icon={ShieldAlert} title="Security considerations"><BulletList items={u.security_considerations} /></Section>
            <Section icon={KeyRound} title="Tenant-specific values"><BulletList items={u.tenant_specific_values} /></Section>
            <Section icon={Boxes} title="Reusable components"><BulletList items={u.reusable_components} /></Section>
          </div>

          {u.retry_behaviour && (
            <Section icon={Repeat} title="Retry / error behaviour">
              <p className="text-[11px] text-muted-foreground leading-relaxed">{u.retry_behaviour}</p>
            </Section>
          )}
        </>
      )}

      {/* Extracted structure (always available) */}
      <div className="grid sm:grid-cols-2 gap-3">
        <Section icon={Zap} title="Trigger types">
          <div className="flex gap-1 flex-wrap">
            {(meta.triggerTypes ?? []).length
              ? meta.triggerTypes.map((t: string) => <Chip key={t}>{t}</Chip>)
              : <span className="text-[11px] text-muted-foreground/50">none detected</span>}
          </div>
        </Section>
        <Section icon={PlugZap} title="Integrations detected">
          <div className="flex gap-1 flex-wrap">
            {(r.integrations ?? []).length
              ? r.integrations.map((t: string) => <Chip key={t} className="text-sky-400/80 border-sky-500/20">{t}</Chip>)
              : <span className="text-[11px] text-muted-foreground/50">none</span>}
          </div>
        </Section>
        {(meta.webhooks ?? []).length > 0 && (
          <Section icon={Webhook} title="Webhooks">
            <BulletList items={(meta.webhooks ?? []).map((w: any) => `${w.method} ${w.path || "(no path)"} — ${w.node}`)} />
          </Section>
        )}
        {(meta.httpRequests ?? []).length > 0 && (
          <Section icon={ArrowRight} title="HTTP requests">
            <BulletList items={(meta.httpRequests ?? []).map((h: any) => `${h.method} ${h.url || "(dynamic)"}`)} />
          </Section>
        )}
        {(meta.credentialTypes ?? []).length > 0 && (
          <Section icon={KeyRound} title="Credential types referenced">
            <div className="flex gap-1 flex-wrap">
              {meta.credentialTypes.map((t: string) => <Chip key={t}>{t}</Chip>)}
            </div>
          </Section>
        )}
        <Section icon={GitBranch} title="Node types">
          <div className="flex gap-1 flex-wrap">
            {(r.node_count ?? 0) === 0 && <span className="text-[11px] text-muted-foreground/50">no nodes</span>}
            {(meta.nodeTypes ?? []).slice(0, 24).map((t: string) => (
              <code key={t} className="text-[9px] bg-white/[0.04] border border-white/[0.05] rounded px-1 py-0.5 text-muted-foreground">{t}</code>
            ))}
          </div>
        </Section>
      </div>

      {r.understood_at && (
        <p className="text-[10px] text-muted-foreground/50 text-right">
          Analysed {new Date(r.understood_at).toLocaleString()} · {r.ai_model}
        </p>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function SystemMindWorkflowIntelligencePage() {
  const listFn = useServerFn(listN8nWorkflowsFn);
  const scanFn = useServerFn(scanN8nWorkflowsFn);
  const qc = useQueryClient();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [scanning, setScanning] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["sm-n8n-list"],
    queryFn: () => listFn(),
    throwOnError: false,
  });

  const configured = (data as any)?.configured ?? false;
  const baseUrl = (data as any)?.baseUrl ?? "";
  const workflows: any[] = (data as any)?.workflows ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return workflows;
    return workflows.filter(
      (w) =>
        w.name?.toLowerCase().includes(q) ||
        w.folder?.toLowerCase().includes(q) ||
        (w.tags ?? []).some((t: string) => t.toLowerCase().includes(q)) ||
        (w.integrations ?? []).some((t: string) => t.toLowerCase().includes(q)),
    );
  }, [workflows, search]);

  async function handleScan() {
    setScanning(true);
    try {
      const res: any = await scanFn();
      if (!res.configured) {
        toast.error("n8n is not connected — add the N8N_API_KEY secret.");
      } else {
        toast.success(`Discovered ${res.scanned} workflow${res.scanned !== 1 ? "s" : ""} · ${res.upserted} stored`);
      }
      qc.invalidateQueries({ queryKey: ["sm-n8n-list"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Scan failed");
    } finally {
      setScanning(false);
    }
  }

  return (
    <div className="p-5 space-y-5 max-w-7xl">
      {/* Header */}
      <div className="flex items-start gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <Network className="h-5 w-5 text-sky-400" /> Workflow Intelligence
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Read-only discovery of your n8n automation workflows, with AI-generated business &amp; technical understanding.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span
            className={cn(
              "text-[10px] rounded-full px-2 py-0.5 border flex items-center gap-1",
              configured
                ? "border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-400"
                : "border-amber-500/30 bg-amber-500/[0.08] text-amber-400",
            )}
          >
            <span className={cn("inline-block h-1.5 w-1.5 rounded-full", configured ? "bg-emerald-400" : "bg-amber-400")} />
            {configured ? "n8n connected" : "n8n not connected"}
          </span>
          <Button size="sm" onClick={handleScan} disabled={scanning} className="text-xs gap-1.5">
            {scanning ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Re-scan
          </Button>
        </div>
      </div>

      {/* Not connected banner */}
      {!isLoading && !configured && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.05] p-4">
          <p className="text-sm font-semibold text-amber-300 flex items-center gap-1.5">
            <ShieldAlert className="h-4 w-4" /> n8n is not connected
          </p>
          <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
            Add the <code className="text-amber-300">N8N_API_KEY</code> secret (an n8n public API key) to enable read-only
            workflow discovery. Optionally set <code className="text-amber-300">N8N_API_BASE_URL</code>
            {baseUrl ? <> (currently <code className="text-muted-foreground/80">{baseUrl}</code>)</> : null}.
            Discovery only ever reads — it never creates, edits, or toggles workflows.
          </p>
        </div>
      )}

      {isLoading && <div className="flex justify-center py-16"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}

      {!isLoading && configured && workflows.length === 0 && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] py-16 text-center">
          <Network className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">No workflows discovered yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Click “Re-scan” to catalog your n8n workflows.</p>
        </div>
      )}

      {!isLoading && workflows.length > 0 && (
        <div className="grid lg:grid-cols-[320px_1fr] gap-5 items-start">
          {/* List */}
          <div className="space-y-2">
            <div className="relative">
              <Search className="h-3.5 w-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search workflows…"
                className="h-8 text-xs pl-8"
              />
            </div>
            <p className="text-[10px] text-muted-foreground px-1">{filtered.length} of {workflows.length}</p>
            <div className="space-y-1.5 max-h-[70vh] overflow-y-auto pr-1">
              {filtered.map((w) => (
                <button
                  key={w.id}
                  onClick={() => setSelectedId(w.id)}
                  className={cn(
                    "w-full text-left rounded-lg border px-3 py-2.5 transition-colors",
                    selectedId === w.id
                      ? "border-sky-500/40 bg-sky-500/[0.08]"
                      : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium truncate flex-1">{w.name}</span>
                    {w.active && <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" title="active" />}
                    <ConfidenceBadge value={w.confidence} />
                  </div>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    {w.folder && <span className="text-[10px] text-muted-foreground/70">{w.folder}</span>}
                    <span className="text-[10px] text-muted-foreground/50">{w.node_count} nodes</span>
                    {w.has_webhook && <Webhook className="h-2.5 w-2.5 text-violet-400" />}
                  </div>
                  {(w.integrations ?? []).length > 0 && (
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {(w.integrations as string[]).slice(0, 3).map((t) => (
                        <span key={t} className="text-[9px] text-sky-400/70">{t}</span>
                      ))}
                      {(w.integrations as string[]).length > 3 && (
                        <span className="text-[9px] text-muted-foreground/40">+{(w.integrations as string[]).length - 3}</span>
                      )}
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Detail */}
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.01] p-4 min-h-[60vh]">
            {selectedId
              ? <DetailPanel id={selectedId} />
              : (
                <div className="flex flex-col items-center justify-center h-full py-20 text-center">
                  <CheckCircle2 className="h-8 w-8 text-muted-foreground/40 mb-2" />
                  <p className="text-sm text-muted-foreground">Select a workflow</p>
                  <p className="text-xs text-muted-foreground/50 mt-1">Its AI understanding and structure will appear here.</p>
                </div>
              )}
          </div>
        </div>
      )}
    </div>
  );
}
