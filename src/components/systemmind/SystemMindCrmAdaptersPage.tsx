import { useMemo, useState, type ReactNode, type ElementType } from "react";
import {
  Share2, Zap, ShieldCheck, Search, CheckCircle2, XCircle, KeyRound,
  Link2, GitBranch, Repeat, AlertTriangle, Info, Layers, ArrowRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  listCrmAdapterDefinitions,
  type CrmAdapterSummary,
} from "@/lib/systemmind/crm-definitions/registry";
import type { CrmAdapterDefinition } from "@/lib/systemmind/crm-definitions/types";
import {
  listUniversalActions,
  UNIVERSAL_ACTION_CATEGORIES,
  type UniversalAction,
} from "@/lib/systemmind/universal-actions";
import { SystemMindShell } from "./SystemMindShell";

// ── Static data (pure, client-safe — no server calls) ─────────────────────────
const ADAPTERS: CrmAdapterDefinition[] = listCrmAdapterDefinitions();
const ACTIONS: UniversalAction[] = listUniversalActions();

const STATUS_CLS: Record<string, string> = {
  available: "border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-400",
  beta: "border-amber-500/30 bg-amber-500/[0.08] text-amber-400",
  planned: "border-white/[0.1] text-muted-foreground",
};

function Chip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("text-[10px] border border-white/[0.08] rounded px-1.5 py-0.5 text-muted-foreground", className)}>
      {children}
    </span>
  );
}

function Section({ icon: Icon, title, children }: { icon: ElementType; title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
      <p className="text-[11px] font-semibold flex items-center gap-1.5 mb-2">
        <Icon className="h-3.5 w-3.5 text-indigo-400" /> {title}
      </p>
      {children}
    </div>
  );
}

// ── Adapter detail ────────────────────────────────────────────────────────────
function AdapterDetail({ def }: { def: CrmAdapterDefinition }) {
  const actionById = useMemo(() => new Map(ACTIONS.map((a) => [a.id, a])), []);
  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-semibold">{def.label}</h3>
          <span className={cn("text-[10px] rounded-full px-2 py-0.5 border", STATUS_CLS[def.status] ?? STATUS_CLS.planned)}>
            {def.status}
          </span>
          <Chip className="text-indigo-400/80 border-indigo-500/20">{def.vendor}</Chip>
        </div>
        <p className="text-xs text-muted-foreground mt-1">{def.description}</p>
        {def.docsUrl && (
          <a href={def.docsUrl} target="_blank" rel="noreferrer" className="text-[10px] text-indigo-400 hover:underline inline-flex items-center gap-1 mt-1">
            <Info className="h-3 w-3" /> API documentation
          </a>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Section icon={KeyRound} title="Authentication">
          <p className="text-[11px] text-foreground/90 mb-1">{def.auth.label} <Chip className="ml-1">{def.auth.type}</Chip></p>
          <ul className="space-y-1">
            {def.auth.fields.map((f) => (
              <li key={f.key} className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                {f.type === "secret" ? <ShieldCheck className="h-3 w-3 text-amber-400" /> : <Link2 className="h-3 w-3 text-muted-foreground/60" />}
                <span className="text-foreground/80">{f.label}</span>
                {f.required && <span className="text-red-400/70">*</span>}
              </li>
            ))}
          </ul>
          {def.auth.notes && <p className="text-[10px] text-muted-foreground/70 mt-1.5">{def.auth.notes}</p>}
        </Section>

        <Section icon={Layers} title="Objects">
          <div className="flex flex-wrap gap-1">
            {def.objects.map((o) => (
              <Chip key={o.key} className="text-foreground/70">
                {o.key} → {o.crmObject}
              </Chip>
            ))}
          </div>
        </Section>

        <Section icon={Repeat} title="Pipeline & status mapping">
          <div className="space-y-1">
            {def.pipelineMappings.map((p) => (
              <div key={p.universalStage} className="text-[10px] text-muted-foreground flex items-center gap-1">
                <span className="text-foreground/80 w-20 inline-block">{p.universalStage}</span>
                <ArrowRight className="h-2.5 w-2.5" />
                <span>{p.crmStage}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section icon={ShieldCheck} title="Capabilities & limits">
          <div className="flex flex-wrap gap-1 mb-2">
            {Object.entries(def.capabilities).map(([k, v]) => (
              <Chip key={k} className={v ? "text-emerald-400/80 border-emerald-500/20" : "text-muted-foreground/40 line-through"}>
                {k}
              </Chip>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground/70">
            Pagination: <span className="text-foreground/70">{def.pagination.style}</span> · Retry:{" "}
            <span className="text-foreground/70">{def.retryStrategy.backoff} × {def.retryStrategy.maxRetries}</span>
          </p>
          {def.rateLimits.notes && <p className="text-[10px] text-muted-foreground/60 mt-1">{def.rateLimits.notes}</p>}
        </Section>
      </div>

      <Section icon={Zap} title={`Action mappings (${def.actionMappings.filter((a) => a.supported).length}/${def.actionMappings.length})`}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1">
          {def.actionMappings.map((m) => {
            const ua = actionById.get(m.action);
            return (
              <div key={m.action} className="flex items-start gap-1.5 py-0.5">
                {m.supported
                  ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
                  : <XCircle className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0 mt-0.5" />}
                <div className="min-w-0">
                  <p className={cn("text-[11px]", m.supported ? "text-foreground/90" : "text-muted-foreground/50")}>
                    {ua?.label ?? m.action}
                  </p>
                  {m.supported && (m.method || m.endpoint) && (
                    <p className="text-[9px] text-muted-foreground/60 font-mono truncate">
                      {m.method} {m.endpoint}
                    </p>
                  )}
                  {!m.supported && m.notes && (
                    <p className="text-[9px] text-amber-400/60">{m.notes}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section icon={CheckCircle2} title="Connection test method">
        <p className="text-[11px] text-foreground/80">{def.testMethod.description}</p>
        {(def.testMethod.method || def.testMethod.endpoint) && (
          <p className="text-[9px] text-muted-foreground/60 font-mono mt-1">{def.testMethod.method} {def.testMethod.endpoint}</p>
        )}
        <p className="text-[10px] text-muted-foreground/70 mt-1">Expect: {def.testMethod.expectation}</p>
      </Section>
    </div>
  );
}

// ── Universal actions catalog ─────────────────────────────────────────────────
function ActionsCatalog() {
  const grouped = useMemo(() => {
    const g: Record<string, UniversalAction[]> = {};
    for (const a of ACTIONS) (g[a.category] ??= []).push(a);
    return g;
  }, []);
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-lg border border-indigo-500/20 bg-indigo-500/[0.05] p-3">
        <Info className="h-4 w-4 text-indigo-400 shrink-0 mt-0.5" />
        <p className="text-[11px] text-muted-foreground">
          Universal actions describe <span className="text-foreground/90">what</span> a business wants to happen,
          independent of any CRM. Each CRM adapter maps these onto its own objects and endpoints. This is a
          descriptive catalogue — nothing here executes.
        </p>
      </div>
      {Object.entries(grouped).map(([cat, actions]) => (
        <div key={cat}>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 mb-1.5">
            {UNIVERSAL_ACTION_CATEGORIES[cat as keyof typeof UNIVERSAL_ACTION_CATEGORIES] ?? cat}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {actions.map((a) => (
              <div key={a.id} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5">
                <div className="flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-lime-400 shrink-0" />
                  <span className="text-[11px] font-semibold">{a.label}</span>
                  {a.idempotent && <Chip className="text-emerald-400/70 border-emerald-500/20">idempotent</Chip>}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">{a.description}</p>
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {a.inputs.map((i) => (
                    <Chip key={i.name} className={i.required ? "text-foreground/70" : "text-muted-foreground/50"}>
                      {i.name}{i.required ? "*" : ""}
                    </Chip>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export function SystemMindCrmAdaptersPage() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string>(ADAPTERS[0]?.name ?? "");

  const summaries: CrmAdapterSummary[] = useMemo(
    () =>
      ADAPTERS.filter((d) =>
        !query ||
        d.label.toLowerCase().includes(query.toLowerCase()) ||
        d.vendor.toLowerCase().includes(query.toLowerCase()),
      ).map((d) => ({
        name: d.name,
        label: d.label,
        vendor: d.vendor,
        status: d.status,
        authType: d.auth.type,
        supportedActions: d.actionMappings.filter((a) => a.supported).length,
        totalActions: d.actionMappings.length,
      })),
    [query],
  );

  const selectedDef = ADAPTERS.find((d) => d.name === selected) ?? ADAPTERS[0];

  return (
    <SystemMindShell>
    <div className="p-5 max-w-6xl mx-auto">
      <div className="mb-4">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <Share2 className="h-4.5 w-4.5 text-indigo-400" /> CRM Abstraction
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          A descriptive catalogue of supported CRMs and the universal business actions they map onto. Knowledge only —
          no CRM is contacted from this page.
        </p>
      </div>

      <Tabs defaultValue="adapters" className="w-full">
        <TabsList>
          <TabsTrigger value="adapters" className="text-xs gap-1.5"><Share2 className="h-3.5 w-3.5" /> CRM Adapters</TabsTrigger>
          <TabsTrigger value="actions" className="text-xs gap-1.5"><Zap className="h-3.5 w-3.5" /> Universal Actions</TabsTrigger>
        </TabsList>

        <TabsContent value="adapters" className="mt-3">
          <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-4">
            {/* Adapter list */}
            <div>
              <div className="relative mb-2">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground/50" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search CRMs…"
                  className="pl-7 h-8 text-xs"
                />
              </div>
              <div className="space-y-1">
                {summaries.map((s) => (
                  <button
                    key={s.name}
                    onClick={() => setSelected(s.name)}
                    className={cn(
                      "w-full text-left rounded-lg border p-2.5 transition-colors",
                      selected === s.name
                        ? "border-indigo-500/40 bg-indigo-500/[0.08]"
                        : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium">{s.label}</span>
                      <span className={cn("text-[9px] rounded-full px-1.5 py-0.5 border", STATUS_CLS[s.status] ?? STATUS_CLS.planned)}>
                        {s.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <Chip>{s.authType}</Chip>
                      <span className="text-[9px] text-muted-foreground/60">
                        {s.supportedActions}/{s.totalActions} actions
                      </span>
                    </div>
                  </button>
                ))}
                {summaries.length === 0 && (
                  <p className="text-[11px] text-muted-foreground/60 py-4 text-center flex items-center justify-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5" /> No CRMs match “{query}”.
                  </p>
                )}
              </div>
            </div>

            {/* Detail */}
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.01] p-4">
              {selectedDef ? <AdapterDetail def={selectedDef} /> : (
                <p className="text-xs text-muted-foreground">Select a CRM to view its mapping.</p>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="actions" className="mt-3">
          <ActionsCatalog />
        </TabsContent>
      </Tabs>
    </div>
    </SystemMindShell>
  );
}
