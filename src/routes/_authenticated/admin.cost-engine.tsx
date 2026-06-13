import React, { useEffect, useState, useCallback } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Pencil, Trash2, Plus, RefreshCw, TrendingUp, DollarSign,
  Cpu, Mic, Phone, Database, Wrench, Server, BarChart3, Zap,
  Users, Briefcase, X, ChevronDown, ChevronUp,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  getCostEngine, getCostAnalytics,
  saveLlmCost, deleteLlmCost,
  saveVoiceCost, deleteVoiceCost,
  saveTelephonyCost, deleteTelephonyCost,
  saveKnowledgeCost, saveToolsCost, saveInfrastructureCost,
  saveRetellCost, saveMarkup, savePlan, deletePlan,
  saveDevRole, deleteDevRole,
  getClientEstimates, saveClientEstimate, deleteClientEstimate,
  calcHyperstreamCostPerMin, calcRetellCostPerMin, calcRetellFullCostPerMin,
  applyMarkup, calcInfraCostPerMin,
} from "@/lib/cost-engine/cost-engine.functions";
import type {
  CostEngineData, CostAnalytics, LlmCost, VoiceCost, TelephonyCost,
  DevRole, ClientEstimate, TeamMember, AddonCharge, RetellCostBreakdown,
} from "@/lib/cost-engine/cost-engine.functions";

export const Route = createFileRoute("/_authenticated/admin/cost-engine")({
  component: CostEnginePage,
});

// ── Formatting helpers ────────────────────────────────────────────────────────

function fmtCurrency(v: number, decimals = 4): string {
  if (v === 0) return "$0";
  return `$${v.toFixed(decimals)}`;
}
function fmtPct(v: number): string { return `${v.toFixed(1)}%`; }
function fmtCents(v: number): string { return `$${(v / 100).toFixed(2)}`; }
function n(v: unknown): number { return Number(v) || 0; }

// ── Small reusable pieces ─────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, title, subtitle }: { icon: React.ElementType; title: string; subtitle?: string }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="p-2 rounded-lg bg-primary/10">
        <Icon className="w-4 h-4 text-primary" />
      </div>
      <div>
        <h3 className="font-semibold text-sm">{title}</h3>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className={`text-xl font-bold ${accent ?? ""}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

function NumInput({ label, value, onChange, step = "0.000001" }: { label: string; value: number; onChange: (v: number) => void; step?: string }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input type="number" step={step} value={value} onChange={e => onChange(Number(e.target.value))}
        className="h-7 text-xs mt-0.5" />
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function CostEnginePage() {
  const [data, setData] = useState<(CostEngineData & { tablesReady: boolean }) | null>(null);
  const [analytics, setAnalytics] = useState<CostAnalytics | null>(null);
  const [estimates, setEstimates] = useState<ClientEstimate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [d, a, e] = await Promise.all([
        getCostEngine(),
        getCostAnalytics().catch(() => null),
        getClientEstimates().catch(() => []),
      ]);
      setData(d as any);
      setAnalytics(a);
      setEstimates(e);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load cost engine");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const refresh = async () => { setBusy(true); await loadAll(); setBusy(false); };

  if (loading) {
    return <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">Loading cost engine…</div>;
  }

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/admin/users" className="text-xs text-muted-foreground hover:text-foreground">← Admin</Link>
          <div>
            <h1 className="text-xl font-bold">Cost Engine</h1>
            <p className="text-sm text-muted-foreground">Platform-wide pricing, profit, and margin management</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={busy}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${busy ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {data && !(data as any).tablesReady && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
          <p className="text-sm font-semibold text-amber-600 mb-1">⚠ Database Migration Required</p>
          <p className="text-xs text-amber-700 mb-3">The Cost Engine tables haven't been created yet. Apply the migration file to activate all features:</p>
          <code className="block text-xs bg-black/10 rounded p-2 font-mono text-amber-800 break-all">
            supabase/migrations/20260613130000_cost_engine.sql
          </code>
          <p className="text-xs text-amber-700 mt-2">Run: <code className="font-mono">supabase db push</code> (after linking your project), or paste the SQL into your Supabase dashboard → SQL Editor.</p>
        </div>
      )}

      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap h-auto gap-0.5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="llm">LLM Models</TabsTrigger>
          <TabsTrigger value="voice">Voice</TabsTrigger>
          <TabsTrigger value="telephony">Telephony</TabsTrigger>
          <TabsTrigger value="fixed">Fixed Costs</TabsTrigger>
          <TabsTrigger value="hyperstream">HyperStream</TabsTrigger>
          <TabsTrigger value="retell">Retell</TabsTrigger>
          <TabsTrigger value="profit">Profit & Plans</TabsTrigger>
          <TabsTrigger value="onboarding">Onboarding</TabsTrigger>
          <TabsTrigger value="clients">Client Estimates</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        {/* ── Overview ─────────────────────────────────────────────────────── */}
        <TabsContent value="overview" className="space-y-6 mt-4">
          {data && analytics && <OverviewTab data={data} analytics={analytics} />}
        </TabsContent>

        {/* ── LLM ──────────────────────────────────────────────────────────── */}
        <TabsContent value="llm" className="mt-4">
          {data && <LlmTab rows={data.llm} onSaved={loadAll} />}
        </TabsContent>

        {/* ── Voice ────────────────────────────────────────────────────────── */}
        <TabsContent value="voice" className="mt-4">
          {data && <VoiceTab rows={data.voice} onSaved={loadAll} />}
        </TabsContent>

        {/* ── Telephony ────────────────────────────────────────────────────── */}
        <TabsContent value="telephony" className="mt-4">
          {data && <TelephonyTab rows={data.telephony} onSaved={loadAll} />}
        </TabsContent>

        {/* ── Fixed Costs ──────────────────────────────────────────────────── */}
        <TabsContent value="fixed" className="mt-4 space-y-6">
          {data && <FixedCostsTab data={data} onSaved={loadAll} />}
        </TabsContent>

        {/* ── HyperStream ──────────────────────────────────────────────────── */}
        <TabsContent value="hyperstream" className="mt-4">
          {data && <HyperstreamTab data={data} />}
        </TabsContent>

        {/* ── Retell ───────────────────────────────────────────────────────── */}
        <TabsContent value="retell" className="mt-4">
          {data && <RetellCalculatorTab data={data} />}
        </TabsContent>

        {/* ── Profit & Plans ───────────────────────────────────────────────── */}
        <TabsContent value="profit" className="mt-4 space-y-6">
          {data && <ProfitTab data={data} onSaved={loadAll} />}
        </TabsContent>

        {/* ── Onboarding ───────────────────────────────────────────────────── */}
        <TabsContent value="onboarding" className="mt-4">
          {data && <OnboardingTab rows={data.dev_roles} onSaved={loadAll} />}
        </TabsContent>

        {/* ── Client Estimates ─────────────────────────────────────────────── */}
        <TabsContent value="clients" className="mt-4">
          {data && <ClientEstimatesTab data={data} estimates={estimates} onSaved={loadAll} />}
        </TabsContent>

        {/* ── Analytics ────────────────────────────────────────────────────── */}
        <TabsContent value="analytics" className="mt-4">
          {analytics && <AnalyticsTab analytics={analytics} />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Overview Tab ──────────────────────────────────────────────────────────────

function OverviewTab({ data, analytics }: { data: CostEngineData; analytics: CostAnalytics }) {
  const realtimeLlm = data.llm.find(l => l.audio_input_cost > 0) ?? data.llm[0] ?? null;
  const defaultVoice = data.voice[0] ?? null;
  const defaultTel = data.telephony[0] ?? null;
  const { total: hsTotal } = calcHyperstreamCostPerMin({ llm: realtimeLlm, voice: defaultVoice, telephony: defaultTel, knowledge: data.knowledge, tools: data.tools, infrastructure: data.infrastructure });
  const retellTotal = calcRetellCostPerMin(data.retell);
  const { selling: hsSelling, margin: hsMargin } = applyMarkup(hsTotal, data.markup);
  const { selling: rtSelling, margin: rtMargin } = applyMarkup(retellTotal, data.markup);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="HyperStream Cost/min" value={fmtCurrency(hsTotal)} sub="Calculated from components" />
        <StatCard label="HyperStream Selling/min" value={fmtCurrency(hsSelling)} sub={`${fmtPct(hsMargin)} margin`} accent="text-emerald-600" />
        <StatCard label="Retell Cost/min" value={fmtCurrency(retellTotal)} sub="From Retell settings" />
        <StatCard label="Retell Selling/min" value={fmtCurrency(rtSelling)} sub={`${fmtPct(rtMargin)} margin`} accent="text-emerald-600" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Calls Tracked" value={analytics.total_calls.toLocaleString()} />
        <StatCard label="Total Cost" value={fmtCents(analytics.total_cost_cents)} />
        <StatCard label="Total Revenue" value={fmtCents(analytics.total_revenue_cents)} accent="text-emerald-600" />
        <StatCard label="Total Profit" value={fmtCents(analytics.total_profit_cents)} sub={`${fmtPct(analytics.avg_margin_pct)} avg margin`} accent="text-emerald-600" />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-lg border p-4">
          <p className="text-sm font-medium mb-3">By Provider</p>
          {analytics.by_provider.length === 0 && <p className="text-xs text-muted-foreground">No call data yet</p>}
          {analytics.by_provider.map(p => (
            <div key={p.provider} className="flex items-center justify-between py-1.5 border-b last:border-0 text-sm">
              <span className="font-medium">{p.provider}</span>
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span>{p.calls} calls</span>
                <span>Cost: {fmtCents(p.cost_cents)}</span>
                <span className="text-emerald-600">+{fmtCents(p.profit_cents)}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-lg border p-4">
          <p className="text-sm font-medium mb-3">Active Plans</p>
          {data.plans.map(plan => (
            <div key={plan.id} className="flex items-center justify-between py-1.5 border-b last:border-0 text-sm">
              <span className="font-medium">{plan.plan_name}</span>
              <div className="flex gap-3 text-xs text-muted-foreground">
                <span>{plan.included_minutes}min/mo</span>
                <span>${n(plan.price_per_month)}/mo</span>
                <span>${n(plan.price_per_minute)}/min overage</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── LLM Tab ───────────────────────────────────────────────────────────────────

const LLM_BLANK: Omit<LlmCost, "id" | "is_current" | "created_at"> = {
  provider: "", model: "", input_token_cost: 0, output_token_cost: 0,
  audio_input_cost: 0, audio_output_cost: 0, cached_token_cost: 0, notes: null,
};

function LlmTab({ rows, onSaved }: { rows: LlmCost[]; onSaved: () => void }) {
  const [editId, setEditId] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<typeof LLM_BLANK>({ ...LLM_BLANK });
  const [busy, setBusy] = useState(false);

  const startEdit = (row: LlmCost) => { setEditId(row.id); setForm({ provider: row.provider, model: row.model, input_token_cost: n(row.input_token_cost), output_token_cost: n(row.output_token_cost), audio_input_cost: n(row.audio_input_cost), audio_output_cost: n(row.audio_output_cost), cached_token_cost: n(row.cached_token_cost), notes: row.notes }); };
  const startNew = () => { setEditId("new"); setForm({ ...LLM_BLANK }); };
  const cancel = () => { setEditId(null); };

  const save = async () => {
    setBusy(true);
    try {
      await saveLlmCost({ ...(editId !== "new" ? { id: editId! } : {}), ...form, notes: form.notes ?? undefined } as any);
      toast.success("Saved");
      setEditId(null);
      onSaved();
    } catch (e: any) { toast.error(e?.message ?? "Save failed"); }
    finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    if (!confirm("Remove this entry?")) return;
    setBusy(true);
    try { await deleteLlmCost({ id }); toast.success("Removed"); onSaved(); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
    finally { setBusy(false); }
  };

  const EditForm = () => (
    <tr className="bg-muted/30">
      <td colSpan={8} className="px-3 py-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
          <div><Label className="text-xs">Provider</Label><Input className="h-7 text-xs" value={form.provider} onChange={e => setForm(f => ({ ...f, provider: e.target.value }))} /></div>
          <div><Label className="text-xs">Model</Label><Input className="h-7 text-xs" value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} /></div>
          <NumInput label="Token In /1K" value={form.input_token_cost} onChange={v => setForm(f => ({ ...f, input_token_cost: v }))} />
          <NumInput label="Token Out /1K" value={form.output_token_cost} onChange={v => setForm(f => ({ ...f, output_token_cost: v }))} />
          <NumInput label="Audio In /min" value={form.audio_input_cost} onChange={v => setForm(f => ({ ...f, audio_input_cost: v }))} />
          <NumInput label="Audio Out /min" value={form.audio_output_cost} onChange={v => setForm(f => ({ ...f, audio_output_cost: v }))} />
          <NumInput label="Cached /1K" value={form.cached_token_cost} onChange={v => setForm(f => ({ ...f, cached_token_cost: v }))} />
          <div><Label className="text-xs">Notes</Label><Input className="h-7 text-xs" value={form.notes ?? ""} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={save} disabled={busy} className="h-7 text-xs">Save</Button>
          <Button size="sm" variant="outline" onClick={cancel} className="h-7 text-xs">Cancel</Button>
        </div>
      </td>
    </tr>
  );

  return (
    <div>
      <SectionHeader icon={Cpu} title="LLM / Model Costs" subtitle="Per 1K tokens or per minute for realtime audio models" />
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead className="bg-muted/50">
            <tr>
              {["Provider", "Model", "Token In /1K", "Token Out /1K", "Audio In /min", "Audio Out /min", "Cached /1K", ""].map(h => (
                <th key={h} className="text-left px-3 py-2 font-medium text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map(row => (
              <React.Fragment key={row.id}>
                <tr className="hover:bg-muted/20">
                  <td className="px-3 py-2 font-medium">{row.provider}</td>
                  <td className="px-3 py-2">{row.model}</td>
                  <td className="px-3 py-2">{fmtCurrency(n(row.input_token_cost))}</td>
                  <td className="px-3 py-2">{fmtCurrency(n(row.output_token_cost))}</td>
                  <td className="px-3 py-2">{fmtCurrency(n(row.audio_input_cost))}</td>
                  <td className="px-3 py-2">{fmtCurrency(n(row.audio_output_cost))}</td>
                  <td className="px-3 py-2">{fmtCurrency(n(row.cached_token_cost))}</td>
                  <td className="px-3 py-2">
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => startEdit(row)}><Pencil className="w-3 h-3" /></Button>
                      <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => remove(row.id)}><Trash2 className="w-3 h-3" /></Button>
                    </div>
                  </td>
                </tr>
                {editId === row.id && <EditForm key={`edit-${row.id}`} />}
              </React.Fragment>
            ))}
            {editId === "new" && <EditForm key="new" />}
          </tbody>
        </table>
      </div>
      {editId === null && (
        <Button variant="outline" size="sm" className="mt-3 h-7 text-xs" onClick={startNew}>
          <Plus className="w-3 h-3 mr-1" /> Add Model
        </Button>
      )}
    </div>
  );
}

// ── Voice Tab ─────────────────────────────────────────────────────────────────

const VOICE_BLANK: Omit<VoiceCost, "id" | "is_current" | "created_at"> = {
  provider: "", voice_id: "", voice_name: "", cost_per_character: 0, cost_per_minute: 0, cost_per_request: 0, notes: null,
};

function VoiceTab({ rows, onSaved }: { rows: VoiceCost[]; onSaved: () => void }) {
  const [editId, setEditId] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<typeof VOICE_BLANK>({ ...VOICE_BLANK });
  const [busy, setBusy] = useState(false);

  const startEdit = (row: VoiceCost) => { setEditId(row.id); setForm({ provider: row.provider, voice_id: row.voice_id, voice_name: row.voice_name, cost_per_character: n(row.cost_per_character), cost_per_minute: n(row.cost_per_minute), cost_per_request: n(row.cost_per_request), notes: row.notes }); };
  const save = async () => {
    setBusy(true);
    try { await saveVoiceCost({ ...(editId !== "new" ? { id: editId! } : {}), ...form, notes: form.notes ?? undefined } as any); toast.success("Saved"); setEditId(null); onSaved(); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); } finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    if (!confirm("Remove?")) return;
    setBusy(true);
    try { await deleteVoiceCost({ id }); toast.success("Removed"); onSaved(); } catch (e: any) { toast.error(e?.message ?? "Failed"); } finally { setBusy(false); }
  };

  const EditForm = () => (
    <tr className="bg-muted/30"><td colSpan={7} className="px-3 py-3">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-2">
        <div><Label className="text-xs">Provider</Label><Input className="h-7 text-xs" value={form.provider} onChange={e => setForm(f => ({ ...f, provider: e.target.value }))} /></div>
        <div><Label className="text-xs">Voice ID</Label><Input className="h-7 text-xs" value={form.voice_id} onChange={e => setForm(f => ({ ...f, voice_id: e.target.value }))} /></div>
        <div><Label className="text-xs">Voice Name</Label><Input className="h-7 text-xs" value={form.voice_name} onChange={e => setForm(f => ({ ...f, voice_name: e.target.value }))} /></div>
        <NumInput label="Per Character" value={form.cost_per_character} onChange={v => setForm(f => ({ ...f, cost_per_character: v }))} />
        <NumInput label="Per Minute" value={form.cost_per_minute} onChange={v => setForm(f => ({ ...f, cost_per_minute: v }))} />
        <NumInput label="Per Request" value={form.cost_per_request} onChange={v => setForm(f => ({ ...f, cost_per_request: v }))} />
        <div className="md:col-span-3"><Label className="text-xs">Notes</Label><Input className="h-7 text-xs" value={form.notes ?? ""} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
      </div>
      <div className="flex gap-2"><Button size="sm" onClick={save} disabled={busy} className="h-7 text-xs">Save</Button><Button size="sm" variant="outline" onClick={() => setEditId(null)} className="h-7 text-xs">Cancel</Button></div>
    </td></tr>
  );

  return (
    <div>
      <SectionHeader icon={Mic} title="Voice Costs" subtitle="Per character, per minute, or per request" />
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead className="bg-muted/50"><tr>{["Provider", "Voice", "/Char", "/Min", "/Request", "Notes", ""].map(h => <th key={h} className="text-left px-3 py-2 font-medium text-muted-foreground">{h}</th>)}</tr></thead>
          <tbody className="divide-y">
            {rows.map(row => (
              <React.Fragment key={row.id}>
                <tr className="hover:bg-muted/20">
                  <td className="px-3 py-2 font-medium">{row.provider}</td>
                  <td className="px-3 py-2">{row.voice_name}</td>
                  <td className="px-3 py-2">{fmtCurrency(n(row.cost_per_character))}</td>
                  <td className="px-3 py-2">{fmtCurrency(n(row.cost_per_minute))}</td>
                  <td className="px-3 py-2">{fmtCurrency(n(row.cost_per_request))}</td>
                  <td className="px-3 py-2 text-muted-foreground max-w-[160px] truncate">{row.notes}</td>
                  <td className="px-3 py-2"><div className="flex gap-1">
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => startEdit(row)}><Pencil className="w-3 h-3" /></Button>
                    <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => remove(row.id)}><Trash2 className="w-3 h-3" /></Button>
                  </div></td>
                </tr>
                {editId === row.id && <EditForm key={`edit-${row.id}`} />}
              </React.Fragment>
            ))}
            {editId === "new" && <EditForm key="new" />}
          </tbody>
        </table>
      </div>
      {editId === null && <Button variant="outline" size="sm" className="mt-3 h-7 text-xs" onClick={() => { setEditId("new"); setForm({ ...VOICE_BLANK }); }}><Plus className="w-3 h-3 mr-1" />Add Voice</Button>}
    </div>
  );
}

// ── Telephony Tab ─────────────────────────────────────────────────────────────

const TEL_BLANK: Omit<TelephonyCost, "id" | "is_current" | "created_at"> = {
  provider: "", country: "", inbound_cost_per_min: 0, outbound_cost_per_min: 0, recording_cost_per_min: 0, number_rental_monthly: 0, notes: null,
};

function TelephonyTab({ rows, onSaved }: { rows: TelephonyCost[]; onSaved: () => void }) {
  const [editId, setEditId] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<typeof TEL_BLANK>({ ...TEL_BLANK });
  const [busy, setBusy] = useState(false);

  const startEdit = (row: TelephonyCost) => { setEditId(row.id); setForm({ provider: row.provider, country: row.country, inbound_cost_per_min: n(row.inbound_cost_per_min), outbound_cost_per_min: n(row.outbound_cost_per_min), recording_cost_per_min: n(row.recording_cost_per_min), number_rental_monthly: n(row.number_rental_monthly), notes: row.notes }); };
  const save = async () => {
    setBusy(true);
    try { await saveTelephonyCost({ ...(editId !== "new" ? { id: editId! } : {}), ...form, notes: form.notes ?? undefined } as any); toast.success("Saved"); setEditId(null); onSaved(); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); } finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    if (!confirm("Remove?")) return;
    setBusy(true);
    try { await deleteTelephonyCost({ id }); toast.success("Removed"); onSaved(); } catch (e: any) { toast.error(e?.message ?? "Failed"); } finally { setBusy(false); }
  };

  const EditForm = () => (
    <tr className="bg-muted/30"><td colSpan={8} className="px-3 py-3">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-2">
        <div><Label className="text-xs">Provider</Label><Input className="h-7 text-xs" value={form.provider} onChange={e => setForm(f => ({ ...f, provider: e.target.value }))} /></div>
        <div><Label className="text-xs">Country</Label><Input className="h-7 text-xs" value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value }))} /></div>
        <NumInput label="Inbound /min" value={form.inbound_cost_per_min} onChange={v => setForm(f => ({ ...f, inbound_cost_per_min: v }))} />
        <NumInput label="Outbound /min" value={form.outbound_cost_per_min} onChange={v => setForm(f => ({ ...f, outbound_cost_per_min: v }))} />
        <NumInput label="Recording /min" value={form.recording_cost_per_min} onChange={v => setForm(f => ({ ...f, recording_cost_per_min: v }))} />
        <NumInput label="Number /month" value={form.number_rental_monthly} onChange={v => setForm(f => ({ ...f, number_rental_monthly: v }))} step="0.01" />
        <div className="md:col-span-3"><Label className="text-xs">Notes</Label><Input className="h-7 text-xs" value={form.notes ?? ""} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
      </div>
      <div className="flex gap-2"><Button size="sm" onClick={save} disabled={busy} className="h-7 text-xs">Save</Button><Button size="sm" variant="outline" onClick={() => setEditId(null)} className="h-7 text-xs">Cancel</Button></div>
    </td></tr>
  );

  return (
    <div>
      <SectionHeader icon={Phone} title="Telephony Costs" subtitle="Per-minute rates and number rental by provider and country" />
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead className="bg-muted/50"><tr>{["Provider", "Country", "Inbound /min", "Outbound /min", "Recording /min", "Number /mo", "Notes", ""].map(h => <th key={h} className="text-left px-3 py-2 font-medium text-muted-foreground">{h}</th>)}</tr></thead>
          <tbody className="divide-y">
            {rows.map(row => (
              <React.Fragment key={row.id}>
                <tr className="hover:bg-muted/20">
                  <td className="px-3 py-2 font-medium">{row.provider}</td>
                  <td className="px-3 py-2">{row.country}</td>
                  <td className="px-3 py-2">{fmtCurrency(n(row.inbound_cost_per_min))}</td>
                  <td className="px-3 py-2">{fmtCurrency(n(row.outbound_cost_per_min))}</td>
                  <td className="px-3 py-2">{fmtCurrency(n(row.recording_cost_per_min))}</td>
                  <td className="px-3 py-2">{fmtCurrency(n(row.number_rental_monthly), 2)}</td>
                  <td className="px-3 py-2 text-muted-foreground max-w-[140px] truncate">{row.notes}</td>
                  <td className="px-3 py-2"><div className="flex gap-1">
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => startEdit(row)}><Pencil className="w-3 h-3" /></Button>
                    <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => remove(row.id)}><Trash2 className="w-3 h-3" /></Button>
                  </div></td>
                </tr>
                {editId === row.id && <EditForm key={`edit-${row.id}`} />}
              </React.Fragment>
            ))}
            {editId === "new" && <EditForm key="new" />}
          </tbody>
        </table>
      </div>
      {editId === null && <Button variant="outline" size="sm" className="mt-3 h-7 text-xs" onClick={() => { setEditId("new"); setForm({ ...TEL_BLANK }); }}><Plus className="w-3 h-3 mr-1" />Add Rate</Button>}
    </div>
  );
}

// ── Fixed Costs Tab (Knowledge, Tools, Infrastructure, Retell) ────────────────

function FixedCostsTab({ data, onSaved }: { data: CostEngineData; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [kn, setKn] = useState({ embedding_cost_per_1k: n(data.knowledge?.embedding_cost_per_1k), vector_storage_per_gb_month: n(data.knowledge?.vector_storage_per_gb_month), retrieval_cost_per_query: n(data.knowledge?.retrieval_cost_per_query), storage_per_gb_month: n(data.knowledge?.storage_per_gb_month), notes: data.knowledge?.notes ?? "" });
  const [tools, setTools] = useState({ webhook_cost_per_call: n(data.tools?.webhook_cost_per_call), api_cost_per_call: n(data.tools?.api_cost_per_call), crm_cost_per_month: n(data.tools?.crm_cost_per_month), calendar_cost_per_month: n(data.tools?.calendar_cost_per_month), notes: data.tools?.notes ?? "" });
  const [infra, setInfra] = useState({ server_cost: n(data.infrastructure?.server_cost), database_cost: n(data.infrastructure?.database_cost), storage_cost: n(data.infrastructure?.storage_cost), bandwidth_cost: n(data.infrastructure?.bandwidth_cost), allocation_type: data.infrastructure?.allocation_type ?? "monthly", estimated_monthly_minutes: n(data.infrastructure?.estimated_monthly_minutes) || 1000, notes: data.infrastructure?.notes ?? "" });
  const [retell, setRetell] = useState({ subscription_cost_monthly: n(data.retell?.subscription_cost_monthly), minute_cost: n(data.retell?.minute_cost), number_cost_monthly: n(data.retell?.number_cost_monthly), voice_cost_per_min: n(data.retell?.voice_cost_per_min), transfer_cost_per_min: n(data.retell?.transfer_cost_per_min), notes: data.retell?.notes ?? "" });

  const act = async (fn: () => Promise<unknown>, label: string) => {
    setBusy(true);
    try { await fn(); toast.success(`${label} saved`); onSaved(); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); } finally { setBusy(false); }
  };

  const infraCostPerMin = calcInfraCostPerMin({ ...infra, id: "", is_current: true, notes: null });

  return (
    <div className="grid md:grid-cols-2 gap-6">
      {/* Knowledge */}
      <div className="rounded-lg border p-4">
        <SectionHeader icon={Database} title="Knowledge Base" subtitle="Embedding, storage, and retrieval" />
        <div className="grid grid-cols-2 gap-2">
          <NumInput label="Embedding /1K tokens" value={kn.embedding_cost_per_1k} onChange={v => setKn(f => ({ ...f, embedding_cost_per_1k: v }))} />
          <NumInput label="Vector storage /GB/mo" value={kn.vector_storage_per_gb_month} onChange={v => setKn(f => ({ ...f, vector_storage_per_gb_month: v }))} step="0.001" />
          <NumInput label="Retrieval /query" value={kn.retrieval_cost_per_query} onChange={v => setKn(f => ({ ...f, retrieval_cost_per_query: v }))} />
          <NumInput label="Storage /GB/mo" value={kn.storage_per_gb_month} onChange={v => setKn(f => ({ ...f, storage_per_gb_month: v }))} step="0.001" />
          <div className="col-span-2"><Label className="text-xs">Notes</Label><Input className="h-7 text-xs" value={kn.notes} onChange={e => setKn(f => ({ ...f, notes: e.target.value }))} /></div>
        </div>
        <Button size="sm" className="mt-3 h-7 text-xs" disabled={busy} onClick={() => act(() => saveKnowledgeCost(kn), "Knowledge")}>Save</Button>
      </div>

      {/* Tools */}
      <div className="rounded-lg border p-4">
        <SectionHeader icon={Wrench} title="Tool Costs" subtitle="Webhook, API, CRM, and calendar integration costs" />
        <div className="grid grid-cols-2 gap-2">
          <NumInput label="Webhook /call" value={tools.webhook_cost_per_call} onChange={v => setTools(f => ({ ...f, webhook_cost_per_call: v }))} />
          <NumInput label="API exec /call" value={tools.api_cost_per_call} onChange={v => setTools(f => ({ ...f, api_cost_per_call: v }))} />
          <NumInput label="CRM /month" value={tools.crm_cost_per_month} onChange={v => setTools(f => ({ ...f, crm_cost_per_month: v }))} step="0.01" />
          <NumInput label="Calendar /month" value={tools.calendar_cost_per_month} onChange={v => setTools(f => ({ ...f, calendar_cost_per_month: v }))} step="0.01" />
          <div className="col-span-2"><Label className="text-xs">Notes</Label><Input className="h-7 text-xs" value={tools.notes} onChange={e => setTools(f => ({ ...f, notes: e.target.value }))} /></div>
        </div>
        <Button size="sm" className="mt-3 h-7 text-xs" disabled={busy} onClick={() => act(() => saveToolsCost(tools), "Tools")}>Save</Button>
      </div>

      {/* Infrastructure */}
      <div className="rounded-lg border p-4">
        <SectionHeader icon={Server} title="Infrastructure" subtitle="Server, database, storage, and bandwidth" />
        <div className="grid grid-cols-2 gap-2">
          <NumInput label="Server cost" value={infra.server_cost} onChange={v => setInfra(f => ({ ...f, server_cost: v }))} step="0.01" />
          <NumInput label="Database cost" value={infra.database_cost} onChange={v => setInfra(f => ({ ...f, database_cost: v }))} step="0.01" />
          <NumInput label="Storage cost" value={infra.storage_cost} onChange={v => setInfra(f => ({ ...f, storage_cost: v }))} step="0.01" />
          <NumInput label="Bandwidth cost" value={infra.bandwidth_cost} onChange={v => setInfra(f => ({ ...f, bandwidth_cost: v }))} step="0.01" />
          <div>
            <Label className="text-xs">Allocation type</Label>
            <select className="w-full h-7 text-xs rounded border bg-background px-2 mt-0.5" value={infra.allocation_type} onChange={e => setInfra(f => ({ ...f, allocation_type: e.target.value as "monthly" | "per_minute" }))}>
              <option value="monthly">Monthly allocation</option>
              <option value="per_minute">Per-minute cost</option>
            </select>
          </div>
          {infra.allocation_type === "monthly" && <NumInput label="Est. monthly minutes" value={infra.estimated_monthly_minutes} onChange={v => setInfra(f => ({ ...f, estimated_monthly_minutes: v }))} step="100" />}
          <div className="col-span-2"><Label className="text-xs">Notes</Label><Input className="h-7 text-xs" value={infra.notes} onChange={e => setInfra(f => ({ ...f, notes: e.target.value }))} /></div>
        </div>
        <div className="mt-2 text-xs text-muted-foreground">Derived cost per minute: <span className="font-medium text-foreground">{fmtCurrency(infraCostPerMin)}</span></div>
        <Button size="sm" className="mt-2 h-7 text-xs" disabled={busy} onClick={() => act(() => saveInfrastructureCost(infra), "Infrastructure")}>Save</Button>
      </div>

      {/* Retell */}
      <div className="rounded-lg border p-4">
        <SectionHeader icon={Zap} title="Retell Costs" subtitle="Retell-specific billing components" />
        <div className="grid grid-cols-2 gap-2">
          <NumInput label="Subscription /mo" value={retell.subscription_cost_monthly} onChange={v => setRetell(f => ({ ...f, subscription_cost_monthly: v }))} step="0.01" />
          <NumInput label="Per minute" value={retell.minute_cost} onChange={v => setRetell(f => ({ ...f, minute_cost: v }))} />
          <NumInput label="Number /mo" value={retell.number_cost_monthly} onChange={v => setRetell(f => ({ ...f, number_cost_monthly: v }))} step="0.01" />
          <NumInput label="Voice /min" value={retell.voice_cost_per_min} onChange={v => setRetell(f => ({ ...f, voice_cost_per_min: v }))} />
          <NumInput label="Transfer /min" value={retell.transfer_cost_per_min} onChange={v => setRetell(f => ({ ...f, transfer_cost_per_min: v }))} />
          <div><Label className="text-xs">Notes</Label><Input className="h-7 text-xs" value={retell.notes} onChange={e => setRetell(f => ({ ...f, notes: e.target.value }))} /></div>
        </div>
        <div className="mt-2 text-xs text-muted-foreground">Total cost /min: <span className="font-medium text-foreground">{fmtCurrency(n(retell.minute_cost) + n(retell.voice_cost_per_min))}</span></div>
        <Button size="sm" className="mt-2 h-7 text-xs" disabled={busy} onClick={() => act(() => saveRetellCost(retell), "Retell")}>Save</Button>
      </div>
    </div>
  );
}

// ── HyperStream Tab ───────────────────────────────────────────────────────────

function HyperstreamTab({ data }: { data: CostEngineData }) {
  const [llmId, setLlmId] = useState(data.llm.find(l => l.audio_input_cost > 0)?.id ?? data.llm[0]?.id ?? "");
  const [voiceId, setVoiceId] = useState(data.voice[0]?.id ?? "");
  const [telId, setTelId] = useState(data.telephony[0]?.id ?? "");

  const selLlm = data.llm.find(l => l.id === llmId) ?? null;
  const selVoice = data.voice.find(v => v.id === voiceId) ?? null;
  const selTel = data.telephony.find(t => t.id === telId) ?? null;

  const { total, breakdown } = calcHyperstreamCostPerMin({ llm: selLlm, voice: selVoice, telephony: selTel, knowledge: data.knowledge, tools: data.tools, infrastructure: data.infrastructure });
  const retellTotal = calcRetellCostPerMin(data.retell);
  const hsMk = applyMarkup(total, data.markup);
  const rtMk = applyMarkup(retellTotal, data.markup);

  const Sel = ({ label, value, onChange, opts }: { label: string; value: string; onChange: (v: string) => void; opts: { id: string; label: string }[] }) => (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <select className="w-full h-8 text-xs rounded border bg-background px-2 mt-0.5" value={value} onChange={e => onChange(e.target.value)}>
        {opts.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </div>
  );

  const Row = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
    <div className="flex items-center justify-between py-2 border-b last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="text-right">
        <span className="text-sm font-medium">{value}</span>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <SectionHeader icon={Zap} title="HyperStream Cost Calculator" subtitle="Select components to compute exact cost per minute" />

      <div className="grid md:grid-cols-3 gap-3">
        <Sel label="LLM / Model" value={llmId} onChange={setLlmId} opts={data.llm.map(l => ({ id: l.id, label: `${l.provider} — ${l.model}` }))} />
        <Sel label="Voice" value={voiceId} onChange={setVoiceId} opts={data.voice.map(v => ({ id: v.id, label: `${v.provider} — ${v.voice_name}` }))} />
        <Sel label="Telephony" value={telId} onChange={setTelId} opts={data.telephony.map(t => ({ id: t.id, label: `${t.provider} — ${t.country}` }))} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-lg border p-4">
          <p className="text-sm font-semibold mb-3">HyperStream Cost Breakdown</p>
          <Row label="LLM (audio in + out)" value={fmtCurrency(breakdown.llm)} sub={selLlm ? `${selLlm.model}` : ""} />
          <Row label="Voice" value={fmtCurrency(breakdown.voice)} sub={selVoice ? selVoice.voice_name : ""} />
          <Row label="Telephony" value={fmtCurrency(breakdown.telephony)} sub={selTel ? `${selTel.provider} ${selTel.country}` : ""} />
          <Row label="Knowledge (~2 retrievals)" value={fmtCurrency(breakdown.knowledge)} />
          <Row label="Tools (~1 call)" value={fmtCurrency(breakdown.tools)} />
          <Row label="Infrastructure" value={fmtCurrency(breakdown.infra)} />
          <div className="mt-3 pt-3 border-t space-y-1">
            <Row label="Total Cost / min" value={fmtCurrency(total)} />
            <Row label="Selling Price / min" value={fmtCurrency(hsMk.selling)} sub={data.markup ? `${data.markup.markup_type === "percentage" ? `+${data.markup.markup_value}%` : `+$${data.markup.markup_value}`}` : "no markup"} />
            <Row label="Profit / min" value={fmtCurrency(hsMk.profit)} />
            <Row label="Margin" value={fmtPct(hsMk.margin)} />
          </div>
        </div>

        <div className="rounded-lg border p-4">
          <p className="text-sm font-semibold mb-3">Retell Comparison</p>
          <Row label="Retell Cost / min" value={fmtCurrency(retellTotal)} />
          <Row label="Selling Price / min" value={fmtCurrency(rtMk.selling)} />
          <Row label="Profit / min" value={fmtCurrency(rtMk.profit)} />
          <Row label="Margin" value={fmtPct(rtMk.margin)} />
          <div className="mt-4 p-3 rounded bg-muted/40 text-xs space-y-2">
            <p className="font-medium">Direct vs Retell Bundle — Cost Comparison</p>
            <p className="text-muted-foreground">
              {total < retellTotal
                ? <>Your direct cost is <span className="text-emerald-600 font-medium">{fmtCurrency(Math.abs(total - retellTotal))}/min lower</span> than the Retell bundle.</>
                : <>Your direct cost is <span className="font-medium">{fmtCurrency(Math.abs(total - retellTotal))}/min higher</span> than the Retell bundle — typically offset by greater control, quality, and margins on high-volume plans.</>
              }
            </p>
            <p className="text-muted-foreground">
              Profit advantage:{" "}
              {hsMk.profit > rtMk.profit
                ? <span className="text-emerald-600 font-medium">Direct yields {fmtCurrency(Math.abs(hsMk.profit - rtMk.profit))}/min more profit</span>
                : <span className="font-medium">Retell bundle yields {fmtCurrency(Math.abs(hsMk.profit - rtMk.profit))}/min more profit at current markup</span>
              }
            </p>
            <p className="text-muted-foreground/70 italic">Note: Retell's bundled rate includes LLM + voice. Adjust the Retell cost in Fixed Costs to match your actual contracted rate.</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Retell Calculator Tab ─────────────────────────────────────────────────────

function RetellCalculatorTab({ data }: { data: CostEngineData }) {
  const realtimeLlm = data.llm.find(l => l.audio_input_cost > 0) ?? data.llm[0] ?? null;
  const [llmId, setLlmId] = useState<string>(realtimeLlm?.id ?? "__bundled__");
  const [voiceId, setVoiceId] = useState<string>("__bundled__");
  const [telId, setTelId] = useState<string>(data.telephony[0]?.id ?? "__bundled__");
  const [direction, setDirection] = useState<"inbound" | "outbound">("inbound");
  const [monthlyMins, setMonthlyMins] = useState<number>(
    n(data.infrastructure?.estimated_monthly_minutes) || 1000
  );

  const selLlm = llmId === "__bundled__" ? null : (data.llm.find(l => l.id === llmId) ?? null);
  const selVoice = voiceId === "__bundled__" ? null : (data.voice.find(v => v.id === voiceId) ?? null);
  const selTel = telId === "__bundled__" ? null : (data.telephony.find(t => t.id === telId) ?? null);

  const bd = calcRetellFullCostPerMin({
    retell: data.retell,
    llm: selLlm,
    voice: selVoice,
    telephony: selTel,
    estimatedMonthlyMinutes: monthlyMins,
    callDirection: direction,
  });

  const mk = applyMarkup(bd.total, data.markup);
  const hsSel = data.llm.find(l => l.audio_input_cost > 0) ?? data.llm[0] ?? null;
  const { total: hsTotal } = calcHyperstreamCostPerMin({
    llm: hsSel, voice: data.voice[0] ?? null, telephony: data.telephony[0] ?? null,
    knowledge: data.knowledge, tools: data.tools, infrastructure: data.infrastructure,
  });
  const hsMk = applyMarkup(hsTotal, data.markup);

  const Row = ({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) => (
    <div className={`flex items-center justify-between py-2 border-b last:border-0 ${highlight ? "font-semibold" : ""}`}>
      <span className={`text-sm ${highlight ? "text-foreground" : "text-muted-foreground"}`}>{label}</span>
      <div className="text-right">
        <span className={`text-sm ${highlight ? "text-foreground" : ""}`}>{value}</span>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );

  const Sel = ({ label, value, onChange, opts }: { label: string; value: string; onChange: (v: string) => void; opts: { id: string; label: string }[] }) => (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <select className="w-full h-8 text-xs rounded border bg-background px-2 mt-0.5" value={value} onChange={e => onChange(e.target.value)}>
        {opts.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </div>
  );

  const noRetell = !data.retell;
  const pct = (v: number) => bd.total > 0 ? `${((v / bd.total) * 100).toFixed(1)}%` : "0%";

  return (
    <div className="space-y-6">
      <SectionHeader icon={Zap} title="Retell Full Cost Calculator"
        subtitle="All-in cost per minute: platform + LLM + voice + telephony + amortised fixed fees" />

      {noRetell && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700">
          No Retell cost config found — add it under <strong>Fixed Costs → Retell</strong> to populate platform, subscription and number rental rates.
        </div>
      )}

      {/* Controls */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
        <Sel label="LLM / Model"
          value={llmId}
          onChange={setLlmId}
          opts={[
            { id: "__bundled__", label: "— Retell bundled (no extra LLM cost)" },
            ...data.llm.map(l => ({ id: l.id, label: `${l.provider} — ${l.model}` })),
          ]}
        />
        <Sel label="Voice Provider"
          value={voiceId}
          onChange={setVoiceId}
          opts={[
            { id: "__bundled__", label: "— Retell bundled voice (use Retell rate)" },
            ...data.voice.map(v => ({ id: v.id, label: `${v.provider} — ${v.voice_name}` })),
          ]}
        />
        <Sel label="Telephony / Carrier"
          value={telId}
          onChange={setTelId}
          opts={[
            { id: "__bundled__", label: "— Retell transfer rate (use Retell config)" },
            ...data.telephony.map(t => ({ id: t.id, label: `${t.provider} — ${t.country}` })),
          ]}
        />
        <div>
          <Label className="text-xs text-muted-foreground">Call Direction</Label>
          <select className="w-full h-8 text-xs rounded border bg-background px-2 mt-0.5" value={direction} onChange={e => setDirection(e.target.value as "inbound" | "outbound")}>
            <option value="inbound">Inbound</option>
            <option value="outbound">Outbound</option>
          </select>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Est. Monthly Minutes (for fixed cost amortisation)</Label>
          <Input type="number" step="100" min="1" value={monthlyMins}
            onChange={e => setMonthlyMins(Math.max(1, Number(e.target.value)))}
            className="h-8 text-xs mt-0.5" />
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Cost breakdown */}
        <div className="rounded-lg border p-4 space-y-0">
          <p className="text-sm font-semibold mb-3">Cost Breakdown / minute</p>

          <Row label="Retell platform fee"
            value={fmtCurrency(bd.platform)}
            sub={data.retell ? `$${n(data.retell.minute_cost).toFixed(4)}/min · ${pct(bd.platform)} of total` : "not configured"} />

          <Row label={selLlm ? `LLM — ${selLlm.model}` : "LLM (bundled / none)"}
            value={fmtCurrency(bd.llm)}
            sub={selLlm
              ? (n(selLlm.audio_input_cost) > 0
                  ? `audio in+out · ${pct(bd.llm)} of total`
                  : `~150 tok/min · ${pct(bd.llm)} of total`)
              : "no additional LLM cost"} />

          <Row label={selVoice ? `Voice — ${selVoice.voice_name}` : "Voice (Retell bundled)"}
            value={fmtCurrency(bd.voice)}
            sub={selVoice ? `$${n(selVoice.cost_per_minute).toFixed(4)}/min · ${pct(bd.voice)} of total` : data.retell ? `$${n(data.retell.voice_cost_per_min).toFixed(4)}/min` : "not configured"} />

          <Row label={selTel ? `Telephony — ${selTel.provider} ${selTel.country}` : "Telephony (Retell transfer rate)"}
            value={fmtCurrency(bd.telephony)}
            sub={selTel
              ? `${direction} $${(direction === "inbound" ? n(selTel.inbound_cost_per_min) : n(selTel.outbound_cost_per_min)).toFixed(4)}/min · ${pct(bd.telephony)} of total`
              : data.retell ? `$${n(data.retell.transfer_cost_per_min).toFixed(4)}/min` : "not configured"} />

          <Row label="Phone number (amortised)"
            value={fmtCurrency(bd.number)}
            sub={data.retell ? `$${n(data.retell.number_cost_monthly).toFixed(2)}/mo ÷ ${monthlyMins.toLocaleString()} min` : "not configured"} />

          <Row label="Subscription (amortised)"
            value={fmtCurrency(bd.subscription)}
            sub={data.retell ? `$${n(data.retell.subscription_cost_monthly).toFixed(2)}/mo ÷ ${monthlyMins.toLocaleString()} min` : "not configured"} />

          <div className="pt-3 mt-1 border-t space-y-0">
            <Row label="Total Cost / min" value={fmtCurrency(bd.total)} highlight />
            <Row label="Selling Price / min" value={fmtCurrency(mk.selling)}
              sub={data.markup ? `${data.markup.markup_type === "percentage" ? `+${data.markup.markup_value}%` : `+$${data.markup.markup_value}`} markup` : "no markup set"} />
            <Row label="Profit / min" value={fmtCurrency(mk.profit)} />
            <Row label="Margin" value={fmtPct(mk.margin)}
              highlight />
          </div>
        </div>

        {/* Monthly projection + comparison */}
        <div className="space-y-4">
          <div className="rounded-lg border p-4">
            <p className="text-sm font-semibold mb-3">Monthly Projection ({monthlyMins.toLocaleString()} min)</p>
            <Row label="Total cost"     value={`$${(bd.total * monthlyMins).toFixed(2)}`} />
            <Row label="Revenue"        value={`$${(mk.selling * monthlyMins).toFixed(2)}`} />
            <Row label="Gross profit"   value={`$${(mk.profit * monthlyMins).toFixed(2)}`} highlight />
            <Row label="Margin"         value={fmtPct(mk.margin)} />
            <div className="mt-3 pt-3 border-t">
              <p className="text-xs text-muted-foreground font-medium mb-2">Fixed cost component</p>
              <Row label="Number rental" value={`$${n(data.retell?.number_cost_monthly).toFixed(2)}/mo`} />
              <Row label="Subscription"  value={`$${n(data.retell?.subscription_cost_monthly).toFixed(2)}/mo`} />
              <Row label="Total fixed / mo" value={`$${(n(data.retell?.number_cost_monthly) + n(data.retell?.subscription_cost_monthly)).toFixed(2)}`} highlight />
            </div>
          </div>

          <div className="rounded-lg border p-4">
            <p className="text-sm font-semibold mb-3">vs HyperStream (direct stack)</p>
            <Row label="Retell all-in / min"     value={fmtCurrency(bd.total)} />
            <Row label="HyperStream / min"        value={fmtCurrency(hsTotal)} />
            <Row label="Difference"
              value={`${bd.total > hsTotal ? "+" : ""}${fmtCurrency(bd.total - hsTotal)}`}
              sub={bd.total > hsTotal ? "Retell costs more" : "Retell costs less"} />
            <div className="mt-3 pt-3 border-t text-xs text-muted-foreground space-y-1.5">
              <p>Retell margin: <span className={mk.margin > 0 ? "text-emerald-600 font-medium" : "text-red-500 font-medium"}>{fmtPct(mk.margin)}</span></p>
              <p>HyperStream margin: <span className="text-emerald-600 font-medium">{fmtPct(hsMk.margin)}</span></p>
              <p className="italic pt-1 text-muted-foreground/70">
                {bd.total <= hsTotal
                  ? "Retell's bundle is competitive — good for rapid deployment without managing your own stack."
                  : "Direct stack is cheaper at scale — Retell's value is in speed-to-market and reduced ops overhead."}
              </p>
            </div>
          </div>

          {/* Cost pie / bar breakdown visual */}
          <div className="rounded-lg border p-4">
            <p className="text-sm font-semibold mb-3">Cost Share</p>
            {[
              { label: "Platform", value: bd.platform, color: "bg-blue-500" },
              { label: "LLM", value: bd.llm, color: "bg-violet-500" },
              { label: "Voice", value: bd.voice, color: "bg-pink-500" },
              { label: "Telephony", value: bd.telephony, color: "bg-orange-500" },
              { label: "Number", value: bd.number, color: "bg-yellow-500" },
              { label: "Subscription", value: bd.subscription, color: "bg-teal-500" },
            ].filter(r => r.value > 0).map(r => (
              <div key={r.label} className="mb-2">
                <div className="flex justify-between text-xs mb-0.5">
                  <span className="text-muted-foreground">{r.label}</span>
                  <span>{fmtCurrency(r.value)} · {pct(r.value)}</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className={`h-full rounded-full ${r.color}`} style={{ width: `${Math.min(100, (r.value / bd.total) * 100)}%` }} />
                </div>
              </div>
            ))}
            {bd.total === 0 && <p className="text-xs text-muted-foreground">Configure Retell costs in Fixed Costs to see breakdown.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Profit & Plans Tab ────────────────────────────────────────────────────────

function ProfitTab({ data, onSaved }: { data: CostEngineData; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [mk, setMk] = useState({ markup_type: (data.markup?.markup_type ?? "percentage") as "fixed" | "percentage", markup_value: n(data.markup?.markup_value) || 40, label: data.markup?.label ?? "Default" });
  const [plans, setPlans] = useState(data.plans.map(p => ({ ...p, price_per_month: n(p.price_per_month), price_per_minute: n(p.price_per_minute), included_minutes: n(p.included_minutes) })));
  const [editPlanId, setEditPlanId] = useState<string | "new" | null>(null);
  const [planForm, setPlanForm] = useState({ plan_name: "", description: "", included_minutes: 0, price_per_month: 0, price_per_minute: 0, sort_order: 0 });

  const realtimeLlm = data.llm.find(l => l.audio_input_cost > 0) ?? data.llm[0] ?? null;
  const { total: hsTotal } = calcHyperstreamCostPerMin({ llm: realtimeLlm, voice: data.voice[0] ?? null, telephony: data.telephony[0] ?? null, knowledge: data.knowledge, tools: data.tools, infrastructure: data.infrastructure });

  const previewMarkup = (cost: number) => {
    const selling = mk.markup_type === "percentage" ? cost * (1 + mk.markup_value / 100) : cost + mk.markup_value;
    const profit = selling - cost;
    const margin = selling > 0 ? (profit / selling) * 100 : 0;
    return { selling, profit, margin };
  };

  const hsPreview = previewMarkup(hsTotal);
  const retellPreview = previewMarkup(calcRetellCostPerMin(data.retell));

  const saveMarkupFn = async () => {
    setBusy(true);
    try { await saveMarkup(mk); toast.success("Markup saved"); onSaved(); } catch (e: any) { toast.error(e?.message ?? "Failed"); } finally { setBusy(false); }
  };

  const savePlanFn = async () => {
    setBusy(true);
    try {
      await savePlan({ ...(editPlanId !== "new" ? { id: editPlanId! } : {}), ...planForm });
      toast.success("Plan saved"); setEditPlanId(null); onSaved();
    } catch (e: any) { toast.error(e?.message ?? "Failed"); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-6">
      {/* Markup */}
      <div className="rounded-lg border p-4">
        <SectionHeader icon={TrendingUp} title="Profit Engine" subtitle="Set your platform markup applied to all cost calculations" />
        <div className="grid md:grid-cols-3 gap-4">
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Markup Type</Label>
              <select className="w-full h-8 text-xs rounded border bg-background px-2 mt-0.5" value={mk.markup_type} onChange={e => setMk(f => ({ ...f, markup_type: e.target.value as "fixed" | "percentage" }))}>
                <option value="percentage">Percentage (%)</option>
                <option value="fixed">Fixed amount ($)</option>
              </select>
            </div>
            <NumInput label={mk.markup_type === "percentage" ? "Markup %" : "Markup $ per minute"} value={mk.markup_value} onChange={v => setMk(f => ({ ...f, markup_value: v }))} step="0.5" />
            <Button size="sm" className="h-7 text-xs w-full" disabled={busy} onClick={saveMarkupFn}>Save Markup</Button>
          </div>
          <div className="rounded bg-muted/40 p-3 text-xs space-y-1">
            <p className="font-medium mb-2">HyperStream Preview</p>
            <p>Cost: {fmtCurrency(hsTotal)}/min</p>
            <p>Selling: <span className="text-emerald-600">{fmtCurrency(hsPreview.selling)}/min</span></p>
            <p>Profit: {fmtCurrency(hsPreview.profit)}/min</p>
            <p>Margin: {fmtPct(hsPreview.margin)}</p>
          </div>
          <div className="rounded bg-muted/40 p-3 text-xs space-y-1">
            <p className="font-medium mb-2">Retell Preview</p>
            <p>Cost: {fmtCurrency(calcRetellCostPerMin(data.retell))}/min</p>
            <p>Selling: <span className="text-emerald-600">{fmtCurrency(retellPreview.selling)}/min</span></p>
            <p>Profit: {fmtCurrency(retellPreview.profit)}/min</p>
            <p>Margin: {fmtPct(retellPreview.margin)}</p>
          </div>
        </div>
      </div>

      {/* Customer Plans */}
      <div className="rounded-lg border p-4">
        <SectionHeader icon={DollarSign} title="Customer Plan Builder" subtitle="Configure pricing tiers for your customers" />
        <div className="grid md:grid-cols-4 gap-3 mb-4">
          {plans.map(plan => {
            const mk2 = previewMarkup(hsTotal * plan.included_minutes);
            return (
              <div key={plan.id} className="rounded-lg border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-sm">{plan.plan_name}</p>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => { setEditPlanId(plan.id); setPlanForm({ plan_name: plan.plan_name, description: plan.description ?? "", included_minutes: plan.included_minutes, price_per_month: plan.price_per_month, price_per_minute: plan.price_per_minute, sort_order: plan.sort_order }); }}><Pencil className="w-3 h-3" /></Button>
                </div>
                <div className="text-xs text-muted-foreground space-y-0.5">
                  <p>{plan.included_minutes} minutes/mo</p>
                  <p className="text-base font-bold text-foreground">${n(plan.price_per_month)}<span className="text-xs font-normal">/mo</span></p>
                  <p>${n(plan.price_per_minute)}/min overage</p>
                  <div className="pt-1 border-t mt-1">
                    <p>Cost: {fmtCurrency(hsTotal * plan.included_minutes, 2)}</p>
                    <p className="text-emerald-600">Profit: {fmtCurrency((plan.price_per_month - hsTotal * plan.included_minutes), 2)}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {editPlanId && (
          <div className="rounded-lg border border-primary/30 p-3 bg-primary/5">
            <p className="text-sm font-medium mb-2">{editPlanId === "new" ? "New Plan" : "Edit Plan"}</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-3">
              <div><Label className="text-xs">Plan Name</Label><Input className="h-7 text-xs" value={planForm.plan_name} onChange={e => setPlanForm(f => ({ ...f, plan_name: e.target.value }))} /></div>
              <NumInput label="Included Minutes" value={planForm.included_minutes} onChange={v => setPlanForm(f => ({ ...f, included_minutes: v }))} step="50" />
              <NumInput label="Price /month ($)" value={planForm.price_per_month} onChange={v => setPlanForm(f => ({ ...f, price_per_month: v }))} step="1" />
              <NumInput label="Overage /minute ($)" value={planForm.price_per_minute} onChange={v => setPlanForm(f => ({ ...f, price_per_minute: v }))} step="0.01" />
              <div><Label className="text-xs">Description</Label><Input className="h-7 text-xs" value={planForm.description} onChange={e => setPlanForm(f => ({ ...f, description: e.target.value }))} /></div>
              <NumInput label="Sort Order" value={planForm.sort_order} onChange={v => setPlanForm(f => ({ ...f, sort_order: v }))} step="1" />
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={savePlanFn}>Save Plan</Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditPlanId(null)}>Cancel</Button>
              {editPlanId !== "new" && <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" disabled={busy} onClick={async () => { if (!confirm("Remove plan?")) return; setBusy(true); try { await deletePlan({ id: editPlanId }); toast.success("Removed"); setEditPlanId(null); onSaved(); } catch { toast.error("Failed"); } finally { setBusy(false); } }}>Delete</Button>}
            </div>
          </div>
        )}

        {editPlanId === null && (
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setEditPlanId("new"); setPlanForm({ plan_name: "", description: "", included_minutes: 0, price_per_month: 0, price_per_minute: 0, sort_order: plans.length }); }}>
            <Plus className="w-3 h-3 mr-1" /> Add Plan
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Analytics Tab ─────────────────────────────────────────────────────────────

function AnalyticsTab({ analytics }: { analytics: CostAnalytics }) {
  return (
    <div className="space-y-6">
      <SectionHeader icon={BarChart3} title="Real-Time Cost Analytics" subtitle="Aggregate profit data from all tracked calls" />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Calls" value={analytics.total_calls.toLocaleString()} />
        <StatCard label="Total Minutes" value={analytics.total_minutes.toLocaleString()} />
        <StatCard label="Total Cost" value={fmtCents(analytics.total_cost_cents)} />
        <StatCard label="Total Revenue" value={fmtCents(analytics.total_revenue_cents)} accent="text-emerald-600" />
        <StatCard label="Total Profit" value={fmtCents(analytics.total_profit_cents)} accent="text-emerald-600" />
        <StatCard label="Avg Margin" value={fmtPct(analytics.avg_margin_pct)} />
      </div>

      {analytics.by_provider.length > 0 && (
        <div className="rounded-lg border p-4">
          <p className="text-sm font-semibold mb-3">By Provider</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50"><tr>{["Provider", "Calls", "Cost", "Revenue", "Profit", "Margin"].map(h => <th key={h} className="text-left px-3 py-2 font-medium text-muted-foreground">{h}</th>)}</tr></thead>
              <tbody className="divide-y">
                {analytics.by_provider.map(p => {
                  const margin = p.revenue_cents > 0 ? (p.profit_cents / p.revenue_cents) * 100 : 0;
                  return (
                    <tr key={p.provider} className="hover:bg-muted/20">
                      <td className="px-3 py-2 font-medium">{p.provider}</td>
                      <td className="px-3 py-2">{p.calls}</td>
                      <td className="px-3 py-2">{fmtCents(p.cost_cents)}</td>
                      <td className="px-3 py-2">{fmtCents(p.revenue_cents)}</td>
                      <td className="px-3 py-2 text-emerald-600">{fmtCents(p.profit_cents)}</td>
                      <td className="px-3 py-2"><Badge variant={margin > 20 ? "default" : "secondary"}>{fmtPct(margin)}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {analytics.by_workspace.length > 0 && (
        <div className="rounded-lg border p-4">
          <p className="text-sm font-semibold mb-3">By Customer (Workspace)</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50"><tr>{["Workspace", "Calls", "Cost", "Profit", "Margin"].map(h => <th key={h} className="text-left px-3 py-2 font-medium text-muted-foreground">{h}</th>)}</tr></thead>
              <tbody className="divide-y">
                {analytics.by_workspace.map(w => (
                  <tr key={w.workspace_id} className="hover:bg-muted/20">
                    <td className="px-3 py-2 font-mono text-[10px]">{w.workspace_id.slice(0, 8)}…</td>
                    <td className="px-3 py-2">{w.calls}</td>
                    <td className="px-3 py-2">{fmtCents(w.cost_cents)}</td>
                    <td className="px-3 py-2 text-emerald-600">{fmtCents(w.profit_cents)}</td>
                    <td className="px-3 py-2"><Badge variant={w.margin_pct > 20 ? "default" : "secondary"}>{fmtPct(w.margin_pct)}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {analytics.total_calls === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <BarChart3 className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No call profitability data yet</p>
          <p className="text-xs mt-1">Data will appear here once calls are tracked via the cost engine</p>
        </div>
      )}
    </div>
  );
}

// ── Onboarding Tab ────────────────────────────────────────────────────────────

const ROLE_BLANK = { role_name: "", rate_per_hour: 0, hours_per_week: 40, notes: "", sort_order: 0 };

function OnboardingTab({ rows, onSaved }: { rows: DevRole[]; onSaved: () => void }) {
  const [editId, setEditId] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<typeof ROLE_BLANK>({ ...ROLE_BLANK });
  const [busy, setBusy] = useState(false);

  const startEdit = (row: DevRole) => {
    setEditId(row.id);
    setForm({ role_name: row.role_name, rate_per_hour: n(row.rate_per_hour), hours_per_week: n(row.hours_per_week), notes: row.notes ?? "", sort_order: n(row.sort_order) });
  };

  const save = async () => {
    setBusy(true);
    try {
      await saveDevRole({ ...(editId !== "new" ? { id: editId! } : {}), ...form, notes: form.notes || undefined });
      toast.success("Saved"); setEditId(null); onSaved();
    } catch (e: any) { toast.error(e?.message ?? "Failed"); } finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this role?")) return;
    setBusy(true);
    try { await deleteDevRole({ id }); toast.success("Deleted"); onSaved(); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); } finally { setBusy(false); }
  };

  const EditForm = () => (
    <tr className="bg-muted/30"><td colSpan={6} className="px-3 py-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-2">
        <div className="md:col-span-2"><Label className="text-xs">Role Name</Label><Input className="h-7 text-xs" value={form.role_name} onChange={e => setForm(f => ({ ...f, role_name: e.target.value }))} /></div>
        <NumInput label="Rate / hour ($)" value={form.rate_per_hour} onChange={v => setForm(f => ({ ...f, rate_per_hour: v }))} step="0.50" />
        <NumInput label="Hours / week" value={form.hours_per_week} onChange={v => setForm(f => ({ ...f, hours_per_week: Math.round(v) }))} step="1" />
        <div><Label className="text-xs">Notes</Label><Input className="h-7 text-xs" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
        <NumInput label="Sort Order" value={form.sort_order} onChange={v => setForm(f => ({ ...f, sort_order: Math.round(v) }))} step="1" />
      </div>
      <div className="flex gap-2"><Button size="sm" onClick={save} disabled={busy} className="h-7 text-xs">Save</Button><Button size="sm" variant="outline" onClick={() => setEditId(null)} className="h-7 text-xs">Cancel</Button></div>
    </td></tr>
  );

  return (
    <div className="space-y-4">
      <SectionHeader icon={Users} title="Development Team Rates" subtitle="Default hourly rates used when building client project estimates" />
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-xs">
          <thead className="bg-muted/50"><tr>{["Role", "Rate / hr", "Hrs / week", "Day Rate", "Notes", ""].map(h => <th key={h} className="text-left px-3 py-2 font-medium text-muted-foreground">{h}</th>)}</tr></thead>
          <tbody className="divide-y">
            {rows.map(row => (
              <React.Fragment key={row.id}>
                <tr className="hover:bg-muted/20">
                  <td className="px-3 py-2 font-medium">{row.role_name}</td>
                  <td className="px-3 py-2">${n(row.rate_per_hour).toFixed(2)}</td>
                  <td className="px-3 py-2">{row.hours_per_week}h</td>
                  <td className="px-3 py-2 text-muted-foreground">${(n(row.rate_per_hour) * n(row.hours_per_week) / 5).toFixed(2)}</td>
                  <td className="px-3 py-2 text-muted-foreground max-w-[200px] truncate">{row.notes}</td>
                  <td className="px-3 py-2"><div className="flex gap-1">
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => startEdit(row)}><Pencil className="w-3 h-3" /></Button>
                    <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive" onClick={() => remove(row.id)}><Trash2 className="w-3 h-3" /></Button>
                  </div></td>
                </tr>
                {editId === row.id && <EditForm key={`edit-${row.id}`} />}
              </React.Fragment>
            ))}
            {editId === "new" && <EditForm key="new" />}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && editId === null && (
        <p className="text-xs text-muted-foreground text-center py-6">No roles yet — apply the migration then refresh, or add one manually.</p>
      )}
      {editId === null && (
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setEditId("new"); setForm({ ...ROLE_BLANK }); }}>
          <Plus className="w-3 h-3 mr-1" />Add Role
        </Button>
      )}
    </div>
  );
}

// ── Client Estimates Tab ──────────────────────────────────────────────────────

type TeamRow = { role_id: string; role_name: string; rate_per_hour: number; hours_per_week: number; count: number; weeks: number };

function initTeamRows(devRoles: DevRole[], existingTeam: TeamMember[], defaultWeeks: number): TeamRow[] {
  return devRoles.map(role => {
    const existing = existingTeam.find(m => m.role_id === role.id);
    return {
      role_id: role.id,
      role_name: role.role_name,
      rate_per_hour: n(role.rate_per_hour),
      hours_per_week: n(role.hours_per_week),
      count: existing?.count ?? 0,
      weeks: existing?.weeks ?? defaultWeeks,
    };
  });
}

const EST_BLANK = { client_name: "", client_email: "", plan_id: "", project_weeks: 4, notes: "" };

function ClientEstimatesTab({ data, estimates, onSaved }: { data: CostEngineData; estimates: ClientEstimate[]; onSaved: () => void }) {
  const [editId, setEditId] = useState<string | "new" | null>(null);
  const [form, setForm] = useState({ ...EST_BLANK });
  const [teamRows, setTeamRows] = useState<TeamRow[]>([]);
  const [addons, setAddons] = useState<AddonCharge[]>([]);
  const [busy, setBusy] = useState(false);

  const platformCostPerMin = calcHyperstreamCostPerMin({
    llm: data.llm.find(l => n(l.audio_input_cost) > 0) ?? data.llm[0] ?? null,
    voice: data.voice[0] ?? null,
    telephony: data.telephony[0] ?? null,
    knowledge: data.knowledge,
    tools: data.tools,
    infrastructure: data.infrastructure,
  }).total;

  const openNew = () => {
    setForm({ ...EST_BLANK, project_weeks: 4 });
    setTeamRows(initTeamRows(data.dev_roles, [], 4));
    setAddons([]);
    setEditId("new");
  };

  const openEdit = (est: ClientEstimate) => {
    setForm({ client_name: est.client_name, client_email: est.client_email ?? "", plan_id: est.plan_id ?? "", project_weeks: est.project_weeks, notes: est.notes ?? "" });
    setTeamRows(initTeamRows(data.dev_roles, est.team_config, est.project_weeks));
    setAddons(est.monthly_addon_charges);
    setEditId(est.id);
  };

  const saveEst = async () => {
    setBusy(true);
    try {
      await saveClientEstimate({
        ...(editId !== "new" ? { id: editId! } : {}),
        client_name: form.client_name,
        client_email: form.client_email || undefined,
        plan_id: form.plan_id || undefined,
        project_weeks: form.project_weeks,
        team_config: teamRows.filter(r => r.count > 0),
        monthly_addon_charges: addons.filter(a => a.label),
        notes: form.notes || undefined,
      });
      toast.success("Estimate saved"); setEditId(null); onSaved();
    } catch (e: any) { toast.error(e?.message ?? "Failed"); } finally { setBusy(false); }
  };

  const removeEst = async (id: string) => {
    if (!confirm("Delete this estimate?")) return;
    setBusy(true);
    try { await deleteClientEstimate({ id }); toast.success("Deleted"); onSaved(); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); } finally { setBusy(false); }
  };

  const selectedPlan = data.plans.find(p => p.id === form.plan_id);
  const setupCost = teamRows.reduce((s, r) => r.count > 0 ? s + r.rate_per_hour * r.hours_per_week * r.weeks * r.count : s, 0);
  const monthlyRevenue = n(selectedPlan?.price_per_month) + addons.reduce((s, a) => s + n(a.amount), 0);
  const monthlyPlatformCost = n(selectedPlan?.included_minutes) * platformCostPerMin;
  const monthlyProfit = monthlyRevenue - monthlyPlatformCost;
  const marginPct = monthlyRevenue > 0 ? (monthlyProfit / monthlyRevenue) * 100 : 0;
  const breakEvenMonths = monthlyProfit > 0 ? setupCost / monthlyProfit : null;

  if (editId !== null) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <SectionHeader icon={Briefcase} title={editId === "new" ? "New Client Estimate" : "Edit Estimate"} subtitle="Define team, timeline, and assigned pricing plan" />
          <Button variant="ghost" size="sm" onClick={() => setEditId(null)}><X className="w-4 h-4 mr-1" />Cancel</Button>
        </div>

        <div className="grid md:grid-cols-3 gap-2">
          <div><Label className="text-xs">Client Name *</Label><Input className="h-7 text-xs mt-0.5" value={form.client_name} onChange={e => setForm(f => ({ ...f, client_name: e.target.value }))} placeholder="Acme Corp" /></div>
          <div><Label className="text-xs">Client Email</Label><Input className="h-7 text-xs mt-0.5" type="email" value={form.client_email} onChange={e => setForm(f => ({ ...f, client_email: e.target.value }))} placeholder="client@example.com" /></div>
          <div>
            <Label className="text-xs">Assigned Plan</Label>
            <select className="w-full h-7 text-xs rounded border bg-background px-2 mt-0.5" value={form.plan_id} onChange={e => setForm(f => ({ ...f, plan_id: e.target.value }))}>
              <option value="">— No plan —</option>
              {data.plans.map(p => <option key={p.id} value={p.id}>{p.plan_name} — ${n(p.price_per_month).toFixed(0)}/mo ({n(p.included_minutes)} min)</option>)}
            </select>
          </div>
          <div>
            <Label className="text-xs">Project Weeks</Label>
            <Input type="number" min={1} step={1} className="h-7 text-xs mt-0.5" value={form.project_weeks}
              onChange={e => {
                const w = Math.max(1, parseInt(e.target.value) || 1);
                setForm(f => ({ ...f, project_weeks: w }));
                setTeamRows(rows => rows.map(r => ({ ...r, weeks: w })));
              }} />
          </div>
          <div className="md:col-span-2"><Label className="text-xs">Notes</Label><Input className="h-7 text-xs mt-0.5" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Any additional context" /></div>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <p className="text-sm font-semibold">Development Team</p>
            {data.dev_roles.length === 0 ? (
              <p className="text-xs text-muted-foreground">No roles configured — add roles in the Onboarding tab first.</p>
            ) : (
              <div className="rounded-lg border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50"><tr>{["Role", "Rate/hr", "Count", "Weeks", "Total"].map(h => <th key={h} className="text-left px-3 py-1.5 font-medium text-muted-foreground">{h}</th>)}</tr></thead>
                  <tbody className="divide-y">
                    {teamRows.map((row, i) => {
                      const cost = row.count > 0 ? row.rate_per_hour * row.hours_per_week * row.weeks * row.count : 0;
                      return (
                        <tr key={row.role_id} className={row.count > 0 ? "bg-primary/5" : ""}>
                          <td className="px-3 py-1.5 font-medium">{row.role_name}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">${row.rate_per_hour}/hr</td>
                          <td className="px-3 py-1.5">
                            <Input type="number" min={0} step={1} className="h-6 w-14 text-xs p-1"
                              value={row.count}
                              onChange={e => setTeamRows(rows => rows.map((r, j) => j === i ? { ...r, count: Math.max(0, parseInt(e.target.value) || 0) } : r))} />
                          </td>
                          <td className="px-3 py-1.5">
                            <Input type="number" min={1} step={1} className="h-6 w-14 text-xs p-1"
                              value={row.weeks}
                              onChange={e => setTeamRows(rows => rows.map((r, j) => j === i ? { ...r, weeks: Math.max(1, parseInt(e.target.value) || 1) } : r))} />
                          </td>
                          <td className="px-3 py-1.5 font-medium">{cost > 0 ? `$${cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <p className="text-sm font-semibold">Monthly Add-ons</p>
            <div className="space-y-1.5">
              {addons.map((a, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Input className="h-7 text-xs flex-1" placeholder="Label (e.g. SMS credits)" value={a.label}
                    onChange={e => setAddons(arr => arr.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} />
                  <Input type="number" step="0.01" min="0" className="h-7 text-xs w-24" placeholder="$ amount"
                    value={a.amount}
                    onChange={e => setAddons(arr => arr.map((x, j) => j === i ? { ...x, amount: parseFloat(e.target.value) || 0 } : x))} />
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive flex-shrink-0"
                    onClick={() => setAddons(arr => arr.filter((_, j) => j !== i))}><X className="w-3 h-3" /></Button>
                </div>
              ))}
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setAddons(a => [...a, { label: "", amount: 0 }])}>
                <Plus className="w-3 h-3 mr-1" />Add monthly charge
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-semibold">Live P&L Preview</p>
            <div className="rounded-lg border p-4">
              {([
                { label: "Project setup cost (one-time)", value: `$${setupCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, bold: true },
                { sep: true },
                { label: "Plan revenue / month", value: selectedPlan ? `$${n(selectedPlan.price_per_month).toFixed(2)}` : "—" },
                ...addons.filter(a => a.label && a.amount > 0).map(a => ({ label: `+ ${a.label}`, value: `$${n(a.amount).toFixed(2)}` })),
                { label: "Total monthly revenue", value: `$${monthlyRevenue.toFixed(2)}`, accent: "text-blue-600" },
                { label: "Monthly platform cost", value: `−$${monthlyPlatformCost.toFixed(4)}`, accent: "text-red-500" },
                { sep: true },
                { label: "Monthly gross profit", value: `$${monthlyProfit.toFixed(2)}`, accent: monthlyProfit >= 0 ? "text-emerald-600" : "text-red-500", bold: true },
                { label: "Gross margin", value: `${marginPct.toFixed(1)}%`, accent: marginPct > 30 ? "text-emerald-600" : marginPct > 10 ? "text-amber-600" : "text-red-500" },
                { sep: true },
                { label: "Break-even point", value: breakEvenMonths !== null ? `${breakEvenMonths.toFixed(1)} months` : "—", accent: breakEvenMonths !== null && breakEvenMonths < 6 ? "text-emerald-600" : "text-amber-600" },
              ] as Array<{ sep?: boolean; label?: string; value?: string; bold?: boolean; accent?: string }>).map((row, i) =>
                row.sep
                  ? <div key={i} className="border-t my-2" />
                  : <div key={i} className="flex justify-between py-1 text-xs">
                      <span className="text-muted-foreground">{row.label}</span>
                      <span className={`font-medium ${row.accent ?? ""} ${row.bold ? "text-sm" : ""}`}>{row.value}</span>
                    </div>
              )}
            </div>
            {!selectedPlan && (
              <p className="text-xs text-amber-600">Assign a plan above to see monthly revenue and platform cost calculations.</p>
            )}
          </div>
        </div>

        <div className="flex gap-2 pt-2 border-t">
          <Button onClick={saveEst} disabled={busy || !form.client_name.trim()} className="h-8 text-sm">Save Estimate</Button>
          <Button variant="outline" size="sm" className="h-8" onClick={() => setEditId(null)}>Cancel</Button>
          {editId !== "new" && (
            <Button variant="ghost" size="sm" className="h-8 text-destructive ml-auto" onClick={() => removeEst(editId!)} disabled={busy}>Delete</Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <SectionHeader icon={Briefcase} title="Client Estimates" subtitle="Per-client project cost and recurring profit margin reports" />
        <Button size="sm" onClick={openNew} className="h-8 text-xs"><Plus className="w-3 h-3 mr-1.5" />New Estimate</Button>
      </div>

      {estimates.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <Briefcase className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">No client estimates yet</p>
          <p className="text-xs mt-1">Create one to model per-client project costs and monthly profit margins</p>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {estimates.map(est => {
          const plan = data.plans.find(p => p.id === est.plan_id);
          const estSetup = est.team_config.reduce((s, m) => s + n(m.rate_per_hour) * n(m.hours_per_week) * n(m.weeks) * n(m.count), 0);
          const estRevenue = n(plan?.price_per_month) + est.monthly_addon_charges.reduce((s, a) => s + n(a.amount), 0);
          const estPlatform = n(plan?.included_minutes) * platformCostPerMin;
          const estProfit = estRevenue - estPlatform;
          const estMargin = estRevenue > 0 ? (estProfit / estRevenue) * 100 : 0;
          const estBE = estProfit > 0 ? estSetup / estProfit : null;

          return (
            <div key={est.id} className="rounded-lg border p-4 space-y-3 hover:shadow-sm transition-shadow">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-sm">{est.client_name}</p>
                  {est.client_email && <p className="text-xs text-muted-foreground">{est.client_email}</p>}
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(est)}><Pencil className="w-3 h-3" /></Button>
                  <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeEst(est.id)}><Trash2 className="w-3 h-3" /></Button>
                </div>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {plan && <Badge variant="secondary" className="text-xs">{plan.plan_name} — ${n(plan.price_per_month).toFixed(0)}/mo</Badge>}
                <Badge variant="outline" className="text-xs">{est.project_weeks}w project</Badge>
                {est.team_config.map(m => (
                  <Badge key={m.role_id} variant="outline" className="text-xs">{m.count}× {m.role_name}</Badge>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                {([
                  { label: "Setup Cost", value: `$${estSetup.toLocaleString(undefined, { maximumFractionDigits: 0 })}` },
                  { label: "Monthly Rev", value: `$${estRevenue.toFixed(0)}`, accent: "text-blue-600" },
                  { label: "Monthly Profit", value: `$${estProfit.toFixed(0)}`, accent: estProfit >= 0 ? "text-emerald-600" : "text-red-500" },
                  { label: "Margin", value: `${estMargin.toFixed(1)}%`, accent: estMargin > 30 ? "text-emerald-600" : "text-amber-600" },
                  { label: "Break-even", value: estBE !== null ? `${estBE.toFixed(1)} mo` : "—", accent: estBE !== null && estBE < 6 ? "text-emerald-600" : "" },
                  { label: "Platform Cost", value: `$${estPlatform.toFixed(2)}/mo`, accent: "text-muted-foreground" },
                ] as Array<{ label: string; value: string; accent?: string }>).map(c => (
                  <div key={c.label} className="rounded-md bg-muted/40 p-2">
                    <p className="text-[10px] text-muted-foreground mb-0.5">{c.label}</p>
                    <p className={`text-xs font-semibold ${c.accent ?? ""}`}>{c.value}</p>
                  </div>
                ))}
              </div>

              {est.notes && <p className="text-xs text-muted-foreground italic truncate">{est.notes}</p>}
              <p className="text-[10px] text-muted-foreground">Created {new Date(est.created_at).toLocaleDateString()}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
