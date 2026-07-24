// ── SystemMind CRM Connections page (Task #457) ───────────────────────────────
// Guided per-CRM connection panels: credential fields with explanations,
// Test Connection with truthful evidence steps, schema discovery with counts.
// Credentials are write-only — reads always come back masked from the server.
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getCrmConnectorCatalogFn, listCrmConnectionsFn, saveCrmConnectionFn,
  deleteCrmConnectionFn, testCrmConnectionFn, refreshCrmCredentialsFn,
  runCrmDiscoveryFn, getCrmDiscoveryFn,
} from "@/lib/systemmind/crm-connections.functions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Loader2, Plug, CheckCircle2, XCircle, ShieldCheck, RefreshCw, Trash2,
  Search, ChevronDown, ChevronRight, Database, Lock as LockIcon,
} from "lucide-react";

type CatalogEntry = {
  provider: string; label: string; description: string;
  supportsDiscovery: boolean; supportsOAuthRefresh: boolean;
  fields: Array<{ key: string; label: string; type: string; required: boolean; help: string; placeholder?: string; options?: string[] }>;
};

function StatusBadge({ status }: { status: string }) {
  if (status === "connected") return <Badge className="bg-emerald-600/15 text-emerald-600 border-emerald-600/30">Connected</Badge>;
  if (status === "failed") return <Badge variant="destructive">Failed</Badge>;
  return <Badge variant="secondary">Not tested</Badge>;
}

function EvidenceList({ report }: { report: any }) {
  if (!report?.steps?.length) return null;
  return (
    <div className="space-y-1.5 rounded-md border bg-muted/30 p-3">
      {report.steps.map((s: any, i: number) => (
        <div key={i} className="flex items-start gap-2 text-sm">
          {s.skipped ? (
            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          ) : s.ok ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          ) : (
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          )}
          <div>
            <span className="font-medium">{s.label}:</span>{" "}
            <span className={s.skipped ? "text-muted-foreground" : ""}>{s.detail}</span>
          </div>
        </div>
      ))}
      {report.sampleRecord && (
        <div className="mt-2 rounded bg-background/70 p-2 text-xs font-mono max-h-32 overflow-auto">
          {Object.entries(report.sampleRecord).map(([k, v]) => (
            <div key={k}><span className="text-muted-foreground">{k}:</span> {String(v)}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function ConnectionForm(props: {
  entry: CatalogEntry;
  existing: any | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { entry, existing } = props;
  const saveFn = useServerFn(saveCrmConnectionFn);
  const [label, setLabel] = useState<string>(existing?.label ?? entry.label);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const f of entry.fields) v[f.key] = "";
    return v;
  });
  const storedKeys = new Set(existing?.credentialKeys ?? []);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      saveFn({ data: { id: existing?.id ?? null, provider: entry.provider, label, credentials: values } }),
    onSuccess: () => { toast.success("Connection saved — credentials stored encrypted on the server."); props.onSaved(); },
    onError: (e: any) => toast.error(`Save failed: ${e?.message ?? String(e)}`),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-md border border-emerald-600/30 bg-emerald-600/5 p-2 text-xs text-emerald-700 dark:text-emerald-400">
        <ShieldCheck className="h-4 w-4 shrink-0" />
        Credentials are encrypted and stored server-side only. They are never shown again after saving — reads are always masked.
      </div>
      <div className="space-y-1.5">
        <Label>Connection name</Label>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} />
      </div>
      {entry.fields.map((f) => (
        <div key={f.key} className="space-y-1.5">
          <Label className="flex items-center gap-1.5">
            {f.label}
            {f.required && <span className="text-destructive">*</span>}
            {f.type === "secret" && <LockIcon className="h-3 w-3 text-muted-foreground" />}
          </Label>
          {f.type === "select" && f.options ? (
            <Select value={values[f.key] || undefined} onValueChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))}>
              <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>
                {f.options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <Input
              type={f.type === "secret" ? "password" : "text"}
              autoComplete="off"
              placeholder={existing && storedKeys.has(f.key) ? "Stored — leave blank to keep the saved value" : f.placeholder}
              value={values[f.key] ?? ""}
              onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))}
            />
          )}
          <p className="text-xs text-muted-foreground">{f.help}</p>
        </div>
      ))}
      {existing && (
        <div>
          <button type="button" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowAdvanced((v) => !v)}>
            {showAdvanced ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Advanced: stored configuration (JSON, secrets masked)
          </button>
          {showAdvanced && (
            <pre className="mt-2 max-h-48 overflow-auto rounded bg-muted p-2 text-xs">
              {JSON.stringify({ provider: existing.provider, label: existing.label, storedCredentialKeys: existing.credentialKeys, status: existing.status }, null, 2)}
            </pre>
          )}
        </div>
      )}
      <div className="flex gap-2">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {existing ? "Save changes" : "Save connection"}
        </Button>
        <Button variant="ghost" onClick={props.onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function ConnectionCard(props: { conn: any; entry: CatalogEntry | null; onChanged: () => void }) {
  const { conn, entry } = props;
  const qc = useQueryClient();
  const testFn = useServerFn(testCrmConnectionFn);
  const discoverFn = useServerFn(runCrmDiscoveryFn);
  const refreshFn = useServerFn(refreshCrmCredentialsFn);
  const deleteFn = useServerFn(deleteCrmConnectionFn);
  const getDiscoveryFn = useServerFn(getCrmDiscoveryFn);
  const [editing, setEditing] = useState(false);
  const [showDiscovery, setShowDiscovery] = useState(false);
  const [lastReport, setLastReport] = useState<any>(conn.lastTestReport);

  const discovery = useQuery({
    queryKey: ["crm-discovery", conn.id],
    queryFn: () => getDiscoveryFn({ data: { connectionId: conn.id } }),
    enabled: showDiscovery,
    throwOnError: false,
  });

  const test = useMutation({
    mutationFn: () => testFn({ data: { id: conn.id } }),
    onSuccess: (r: any) => { setLastReport(r.report); props.onChanged(); },
    onError: (e: any) => toast.error(`Test failed: ${e?.message ?? String(e)}`),
  });
  const discover = useMutation({
    mutationFn: () => discoverFn({ data: { id: conn.id } }),
    onSuccess: (r: any) => {
      toast.success(`Discovery complete — ${r.summary.fieldCount} fields across ${r.summary.objectCount} objects, ${r.summary.pipelineCount} pipeline(s), ${r.summary.ownerCount} owner(s).`);
      qc.invalidateQueries({ queryKey: ["crm-discovery", conn.id] });
      props.onChanged();
    },
    onError: (e: any) => toast.error(`Discovery failed: ${e?.message ?? String(e)}`),
  });
  const refresh = useMutation({
    mutationFn: () => refreshFn({ data: { id: conn.id } }),
    onSuccess: () => { toast.success("Token refreshed — a new access token was stored (encrypted)."); props.onChanged(); },
    onError: (e: any) => toast.error(`Refresh failed: ${e?.message ?? String(e)}`),
  });
  const remove = useMutation({
    mutationFn: () => deleteFn({ data: { id: conn.id } }),
    onSuccess: () => { toast.success("Connection removed"); props.onChanged(); },
    onError: (e: any) => toast.error(`Delete failed: ${e?.message ?? String(e)}`),
  });

  const snap: any = discovery.data;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Plug className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">{conn.label || entry?.label || conn.provider}</CardTitle>
            <StatusBadge status={conn.status} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" onClick={() => test.mutate()} disabled={test.isPending}>
              {test.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1 h-3.5 w-3.5" />}
              Test connection
            </Button>
            {entry?.supportsDiscovery && (
              <Button size="sm" variant="outline" onClick={() => discover.mutate()} disabled={discover.isPending}>
                {discover.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Search className="mr-1 h-3.5 w-3.5" />}
                {conn.hasDiscovery ? "Refresh discovery" : "Discover schema"}
              </Button>
            )}
            {entry?.supportsOAuthRefresh && (
              <Button size="sm" variant="outline" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
                {refresh.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
                Refresh token
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setEditing((v) => !v)}>Edit</Button>
            <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { if (confirm("Remove this CRM connection? Stored credentials will be deleted.")) remove.mutate(); }}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <CardDescription className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {conn.lastTestedAt && <span>Last tested {new Date(conn.lastTestedAt).toLocaleString()}</span>}
          {conn.tokenExpiresAt && <span>Token expires {new Date(conn.tokenExpiresAt).toLocaleString()}</span>}
          {conn.discoverySummary && (
            <span>
              Discovered: {conn.discoverySummary.fieldCount} fields · {conn.discoverySummary.objectCount} objects · {conn.discoverySummary.pipelineCount} pipeline(s) · {conn.discoverySummary.ownerCount} owner(s)
            </span>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {editing && entry && (
          <ConnectionForm entry={entry} existing={conn} onSaved={() => { setEditing(false); props.onChanged(); }} onCancel={() => setEditing(false)} />
        )}
        {!editing && lastReport && <EvidenceList report={lastReport} />}
        {!editing && conn.hasDiscovery && (
          <div>
            <button type="button" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowDiscovery((v) => !v)}>
              {showDiscovery ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              <Database className="h-3 w-3" /> View discovered schema
            </button>
            {showDiscovery && (
              discovery.isLoading ? <Loader2 className="mt-2 h-4 w-4 animate-spin" /> :
              snap ? (
                <div className="mt-2 space-y-2 text-xs">
                  {(snap.objects ?? []).map((o: any) => (
                    <div key={o.key} className="rounded border p-2">
                      <div className="font-medium">{o.crmObject} <span className="text-muted-foreground">({o.fields.length} fields, {o.fields.filter((f: any) => f.custom).length} custom)</span></div>
                      <div className="mt-1 max-h-28 overflow-auto text-muted-foreground">
                        {o.fields.map((f: any) => `${f.key} (${f.type})`).join(", ")}
                      </div>
                    </div>
                  ))}
                  {(snap.pipelines ?? []).map((p: any) => (
                    <div key={p.id} className="rounded border p-2">
                      <div className="font-medium">Pipeline: {p.label}</div>
                      <div className="mt-1 text-muted-foreground">{p.stages.map((s: any) => s.label).join(" → ")}</div>
                    </div>
                  ))}
                  {(snap.owners ?? []).length > 0 && (
                    <div className="rounded border p-2">
                      <div className="font-medium">Owners ({snap.owners.length})</div>
                      <div className="mt-1 max-h-20 overflow-auto text-muted-foreground">
                        {snap.owners.map((o: any) => o.name).join(", ")}
                      </div>
                    </div>
                  )}
                  {(snap.warnings ?? []).length > 0 && (
                    <div className="text-amber-600">{snap.warnings.join(" · ")}</div>
                  )}
                </div>
              ) : <p className="mt-2 text-xs text-muted-foreground">No discovery snapshot yet.</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function SystemMindCrmConnectionsPage() {
  const catalogFn = useServerFn(getCrmConnectorCatalogFn);
  const listFn = useServerFn(listCrmConnectionsFn);
  const qc = useQueryClient();
  const [adding, setAdding] = useState<string | null>(null);

  const catalog = useQuery<CatalogEntry[]>({
    queryKey: ["crm-connector-catalog"],
    queryFn: () => catalogFn() as Promise<CatalogEntry[]>,
    staleTime: 5 * 60_000,
    throwOnError: false,
  });
  const connections = useQuery({
    queryKey: ["crm-connections"],
    queryFn: () => listFn(),
    throwOnError: false,
  });

  const entries = catalog.data ?? [];
  const conns: any[] = (connections.data as any[]) ?? [];
  const entryFor = useMemo(() => new Map(entries.map((e) => [e.provider, e])), [entries]);
  const refetchAll = () => qc.invalidateQueries({ queryKey: ["crm-connections"] });
  const addingEntry = adding ? entryFor.get(adding) ?? null : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">CRM Connections</h1>
        <p className="text-sm text-muted-foreground">
          Connect your CRM so SystemMind can verify access, discover your schema and power call data mapping.
          Credentials are encrypted, stored server-side only, and always masked when displayed.
        </p>
      </div>

      {(catalog.isLoading || connections.isLoading) && <Loader2 className="h-5 w-5 animate-spin" />}
      {(catalog.error || connections.error) && (
        <p className="text-sm text-destructive">
          {String((catalog.error as any)?.message ?? (connections.error as any)?.message ?? "Failed to load CRM connections.")}
        </p>
      )}

      {conns.map((c) => (
        <ConnectionCard key={c.id} conn={c} entry={entryFor.get(c.provider) ?? null} onChanged={refetchAll} />
      ))}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add a CRM connection</CardTitle>
          <CardDescription>Pick your CRM — each panel explains exactly which credentials are needed and where to find them.</CardDescription>
        </CardHeader>
        <CardContent>
          {!addingEntry ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {entries.map((e) => (
                <button
                  key={e.provider}
                  type="button"
                  className="rounded-md border p-3 text-left transition-colors hover:bg-muted/50"
                  onClick={() => setAdding(e.provider)}
                >
                  <div className="flex items-center gap-2 font-medium"><Plug className="h-4 w-4" />{e.label}</div>
                  <p className="mt-1 text-xs text-muted-foreground">{e.description}</p>
                </button>
              ))}
            </div>
          ) : (
            <ConnectionForm
              entry={addingEntry}
              existing={null}
              onSaved={() => { setAdding(null); refetchAll(); }}
              onCancel={() => setAdding(null)}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
