import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Rocket, Loader2, Sparkles, Trash2, ListChecks, KeyRound, Share2, Boxes,
  ServerCog, Webhook, ShieldCheck, ClipboardCheck, FlaskConical, Clock, Cpu,
  AlertTriangle, ArrowRight, Target, Network,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  generateDeploymentPlanFn, listDeploymentPlansFn, deleteDeploymentPlanFn,
} from "@/lib/systemmind/intelligence.functions";
import type { DeploymentPlanRecord, DeploymentPlanBody } from "@/lib/systemmind/deployment-planner.server";
import { SystemMindShell } from "./SystemMindShell";
import {
  Chip, Section, RiskPill, MigrationNotice, ExecutionBanner, EmptyState, InlineError,
} from "./intelligence/shared";

function List({ items, empty }: { items: string[]; empty?: string }) {
  if (!items?.length) return <p className="text-[11px] text-muted-foreground/50">{empty ?? "None"}</p>;
  return (
    <ul className="space-y-1">
      {items.map((s, i) => (
        <li key={i} className="text-[11px] text-foreground/80 flex items-start gap-1.5">
          <ArrowRight className="h-3 w-3 text-sky-400/60 shrink-0 mt-0.5" /> <span>{s}</span>
        </li>
      ))}
    </ul>
  );
}

function PlanView({ plan }: { plan: DeploymentPlanBody }) {
  const p = plan;
  const providerEntries = Object.entries(p.providers).filter(([, v]) => (v as string[]).length > 0);
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-sky-500/20 bg-sky-500/[0.05] p-3">
        <p className="text-[11px] font-semibold flex items-center gap-1.5 text-sky-200">
          <Target className="h-3.5 w-3.5" /> Interpreted goal
        </p>
        <p className="text-xs text-foreground/90 mt-1">{p.interpreted_goal}</p>
        <p className="text-[11px] text-muted-foreground mt-2">{p.summary}</p>
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <RiskPill rating={p.risk_assessment.rating} />
          <Chip className="text-sky-300 border-sky-500/20"><Clock className="h-2.5 w-2.5 inline mr-1" />~{p.estimated_minutes} min (human)</Chip>
          <Chip className="text-amber-300 border-amber-500/20">requires human execution</Chip>
        </div>
      </div>

      <div className="rounded-md border border-amber-500/20 bg-amber-500/[0.05] px-3 py-2">
        <p className="text-[10px] text-amber-200/90 flex items-start gap-1.5">
          <ShieldCheck className="h-3 w-3 shrink-0 mt-0.5" /> {p.execution_note}
        </p>
      </div>

      <Section icon={Boxes} title={`Selected templates (${p.selected_templates.length})`}>
        <div className="space-y-1.5">
          {p.selected_templates.map((t) => (
            <div key={t.id} className="flex items-center justify-between gap-2 rounded border border-white/[0.06] bg-white/[0.02] px-2.5 py-1.5">
              <div className="min-w-0">
                <p className="text-[11px] font-medium truncate">{t.name}</p>
                <p className="text-[10px] text-muted-foreground/60">{t.category ?? "General"} · {t.status ?? "draft"}</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {t.recommended && <Chip className="text-emerald-400/80 border-emerald-500/20">recommended</Chip>}
                <Chip className="tabular-nums">{t.confidence ?? "—"}</Chip>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section icon={ListChecks} title="Deployment order (human-performed)">
        <ol className="space-y-1">
          {p.deployment_order.map((s) => (
            <li key={s.step} className="text-[11px] text-foreground/80 flex items-start gap-2">
              <span className="text-[10px] rounded-full bg-sky-500/15 text-sky-300 w-4 h-4 flex items-center justify-center shrink-0 mt-0.5">{s.step}</span>
              <span><span className="font-medium">{s.template}</span> <span className="text-muted-foreground/60">— {s.action}</span></span>
            </li>
          ))}
        </ol>
      </Section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Section icon={ServerCog} title="Infrastructure"><List items={p.infrastructure_requirements} /></Section>
        <Section icon={KeyRound} title="Required credentials (labels only)">
          <List items={p.required_credentials} empty="No external credentials" />
        </Section>
        <Section icon={Share2} title="CRM adapters">
          {p.required_adapters.length ? (
            <div className="flex flex-wrap gap-1">
              {p.required_adapters.map((a) => (
                <Chip key={a.name} className={a.matched ? "text-emerald-400/80 border-emerald-500/20" : "text-amber-400/80 border-amber-500/20"}>
                  {a.label}{!a.matched && " (custom)"}
                </Chip>
              ))}
            </div>
          ) : <p className="text-[11px] text-muted-foreground/50">No CRM required</p>}
        </Section>
        <Section icon={Cpu} title="Providers">
          {providerEntries.length ? (
            <div className="space-y-1">
              {providerEntries.map(([k, v]) => (
                <div key={k} className="flex items-start gap-2">
                  <span className="text-[10px] text-muted-foreground/60 w-16 shrink-0 capitalize">{k}</span>
                  <div className="flex gap-1 flex-wrap">{(v as string[]).map((x) => <Chip key={x} className="text-sky-400/80 border-sky-500/20">{x}</Chip>)}</div>
                </div>
              ))}
            </div>
          ) : <p className="text-[11px] text-muted-foreground/50">Self-contained</p>}
        </Section>
      </div>

      {p.configuration_variables.length > 0 && (
        <Section icon={KeyRound} title={`Configuration variables (${p.configuration_variables.length} keys — no values)`}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
            {p.configuration_variables.map((v) => (
              <div key={v.key} className="text-[10px] flex items-center gap-1.5">
                <code className="text-sky-300 bg-sky-500/[0.08] px-1 rounded">{v.key}</code>
                <span className="text-muted-foreground/60 truncate">{v.name}</span>
                {v.required && <span className="text-red-400/70">*</span>}
                <Chip className="ml-auto">{v.category}</Chip>
              </div>
            ))}
          </div>
        </Section>
      )}

      {p.webhook_requirements.length > 0 && (
        <Section icon={Webhook} title="Webhook requirements">
          <List items={p.webhook_requirements.map((w) => `${w.name} (${w.key})`)} />
        </Section>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Section icon={ShieldCheck} title="Security"><List items={p.security_requirements} /></Section>
        <Section icon={ClipboardCheck} title="Validation"><List items={p.validation_steps} /></Section>
        <Section icon={FlaskConical} title="Testing"><List items={p.testing_steps} /></Section>
      </div>

      {p.knowledge_graph && (
        <Section
          icon={Network}
          title={`Knowledge graph${p.knowledge_graph.consulted ? ` (${p.knowledge_graph.matched_nodes} matched)` : ""}`}
        >
          {!p.knowledge_graph.consulted ? (
            <p className="text-[11px] text-muted-foreground/60">
              Knowledge graph unavailable — plan composition used template metadata only.
            </p>
          ) : (
            <div className="space-y-2">
              {p.knowledge_graph.prerequisites.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-sky-200/80 mb-1">Dependencies &amp; links</p>
                  <ul className="space-y-1">
                    {p.knowledge_graph.prerequisites.map((d, i) => (
                      <li key={i} className="text-[11px] text-foreground/80 flex items-start gap-1.5">
                        <ArrowRight className="h-3 w-3 text-sky-400/60 shrink-0 mt-0.5" />
                        <span>
                          <span className="font-medium">{d.template}</span>{" "}
                          <span className="text-muted-foreground/60">{d.edge}</span>{" "}
                          <span className="font-medium">{d.depends_on}</span>{" "}
                          <Chip className="ml-1">{d.node_type.replace(/_/g, " ")}</Chip>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {p.knowledge_graph.architecture.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-sky-200/80 mb-1">Linked architecture</p>
                  <div className="flex flex-wrap gap-1">
                    {p.knowledge_graph.architecture.map((a) => (
                      <Chip key={a.label} className="text-sky-400/80 border-sky-500/20">{a.label}</Chip>
                    ))}
                  </div>
                </div>
              )}
              {p.knowledge_graph.related_failures.length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-red-300/80 mb-1">Linked failure reports</p>
                  <List items={p.knowledge_graph.related_failures} />
                </div>
              )}
              <List items={p.knowledge_graph.notes} />
            </div>
          )}
        </Section>
      )}

      <Section icon={AlertTriangle} title="Risk assessment">
        <div className="flex items-center gap-2 mb-1.5"><RiskPill rating={p.risk_assessment.rating} /></div>
        <List items={p.risk_assessment.notes} />
      </Section>
    </div>
  );
}

export function SystemMindDeploymentPlannerPage() {
  const [request, setRequest] = useState("");
  const [active, setActive] = useState<DeploymentPlanRecord | null>(null);
  const qc = useQueryClient();

  const generateFn = useServerFn(generateDeploymentPlanFn);
  const listFn = useServerFn(listDeploymentPlansFn);
  const deleteFn = useServerFn(deleteDeploymentPlanFn);

  const { data: plansData, isLoading } = useQuery({
    queryKey: ["systemmind-deployment-plans"],
    queryFn: () => listFn(),
    throwOnError: false,
  });

  const genMut = useMutation({
    mutationFn: () => generateFn({ data: { requestText: request.trim() } }),
    onSuccess: (rec: DeploymentPlanRecord) => {
      setActive(rec);
      qc.invalidateQueries({ queryKey: ["systemmind-deployment-plans"] });
      toast.success("Deployment plan assembled (descriptive — not executed).");
    },
    onError: (e: any) => {
      const msg = String(e?.message ?? e);
      toast.error(msg === "MIGRATION_NOT_APPLIED" ? "Run the SystemMind migration first." : msg);
    },
  });

  const delMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: (_r, id) => {
      if (active?.id === id) setActive(null);
      qc.invalidateQueries({ queryKey: ["systemmind-deployment-plans"] });
      toast.success("Plan deleted.");
    },
    onError: (e: any) => toast.error(String(e?.message ?? e)),
  });

  const notApplied = plansData && plansData.applied === false;
  const plans = plansData?.plans ?? [];

  return (
    <SystemMindShell>
      <div className="p-5 max-w-6xl mx-auto">
        <div className="mb-4">
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <Rocket className="h-4.5 w-4.5 text-sky-400" /> Deployment Planner
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Describe what you want to deploy. SystemMind assembles a complete, descriptive plan from your template
            library, CRM adapters and knowledge graph — it does not deploy anything.
          </p>
        </div>

        <div className="mb-4"><ExecutionBanner /></div>

        {notApplied && <div className="mb-4"><MigrationNotice what="The Deployment Planner" /></div>}

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
          {/* Composer + result */}
          <div className="space-y-3">
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.01] p-3">
              <Textarea
                value={request}
                onChange={(e) => setRequest(e.target.value)}
                placeholder="e.g. Deploy an AI receptionist that qualifies inbound leads, books appointments in the calendar, and syncs contacts to HubSpot."
                className="min-h-[96px] text-xs resize-none"
                maxLength={2000}
              />
              <div className="flex items-center justify-between mt-2">
                <span className="text-[10px] text-muted-foreground/50">{request.length}/2000</span>
                <Button
                  size="sm"
                  className="h-8 text-xs gap-1.5"
                  disabled={request.trim().length < 4 || genMut.isPending}
                  onClick={() => genMut.mutate()}
                >
                  {genMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  Assemble plan
                </Button>
              </div>
            </div>

            {genMut.isError && !genMut.isPending && (
              <InlineError message={String((genMut.error as any)?.message ?? "Failed to assemble plan.")} />
            )}

            {active ? (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.01] p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{active.title ?? "Deployment plan"}</p>
                    <p className="text-[10px] text-muted-foreground/60">
                      {active.generated_by === "ai" ? "AI-assembled" : "Heuristic"} · {new Date(active.created_at).toLocaleString()}
                    </p>
                  </div>
                  <Chip className="text-emerald-400/80 border-emerald-500/20">{active.execution_status}</Chip>
                </div>
                <PlanView plan={active.plan} />
              </div>
            ) : (
              !genMut.isPending && (
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.01]">
                  <EmptyState icon={Rocket} title="No plan selected" hint="Describe a deployment above, or pick a saved plan on the right." />
                </div>
              )
            )}
          </div>

          {/* Saved plans */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 mb-2">Saved plans</p>
            {isLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-6 justify-center">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
              </div>
            ) : plans.length === 0 ? (
              <p className="text-[11px] text-muted-foreground/50 py-4 text-center">No saved plans yet.</p>
            ) : (
              <div className="space-y-1.5">
                {plans.map((pl) => (
                  <div
                    key={pl.id}
                    className={cn(
                      "group rounded-lg border p-2.5 transition-colors cursor-pointer",
                      active?.id === pl.id ? "border-sky-500/40 bg-sky-500/[0.08]" : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]",
                    )}
                    onClick={() => setActive(pl)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[11px] font-medium line-clamp-2">{pl.title ?? pl.request_text.slice(0, 60)}</p>
                      <button
                        className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                        onClick={(e) => { e.stopPropagation(); delMut.mutate(pl.id); }}
                        title="Delete plan"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground/60 hover:text-red-400" />
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <RiskPill rating={pl.risk_rating} />
                      <Chip className="tabular-nums">conf {pl.confidence ?? "—"}</Chip>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </SystemMindShell>
  );
}
