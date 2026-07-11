import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Hammer, RefreshCw, Save, Clock, Zap, Coins, TrendingUp, ShieldCheck, History } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { listAccountsClients } from "@/lib/accountsmind/accountsmind.functions";
import {
  getSystemMindUsageAdmin,
  getSystemMindPricing,
  listSystemMindPricingHistory,
  saveSystemMindPricing,
} from "@/lib/systemmind/build-workspace.functions";

const TASK_LABELS: Record<string, string> = {
  build_generate:     "Generate",
  build_simulate:     "Simulate",
  build_apply:        "Apply",
  build_apply_submit: "Apply (approval)",
};

function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

function fmtUsd(v: number): string {
  return `$${Number(v ?? 0).toFixed(4)}`;
}

const PRICING_FIELDS: Array<{ key: string; label: string; step: string; hint?: string }> = [
  { key: "base_charge_per_run_usd",    label: "Base charge per run ($)",  step: "0.001" },
  { key: "charge_per_minute_usd",      label: "Charge per minute ($)",    step: "0.001" },
  { key: "charge_per_1k_tokens_usd",   label: "Charge per 1k tokens ($)", step: "0.001" },
  { key: "charge_per_tool_call_usd",   label: "Charge per tool call ($)", step: "0.001" },
  { key: "included_runs_per_month",    label: "Included runs / month",    step: "1" },
  { key: "included_seconds_per_month", label: "Included seconds / month", step: "60" },
  { key: "included_tokens_per_month",  label: "Included tokens / month",  step: "1000" },
  { key: "overage_multiplier",         label: "Overage multiplier",       step: "0.1",
    hint: "Applied to the raw charge once any allowance is exceeded" },
];

export function AccountsMindSystemMind() {
  const qc = useQueryClient();
  const listClientsFn = useServerFn(listAccountsClients);
  const getUsageFn    = useServerFn(getSystemMindUsageAdmin);
  const getPricingFn  = useServerFn(getSystemMindPricing);
  const listHistoryFn = useServerFn(listSystemMindPricingHistory);
  const savePricingFn = useServerFn(saveSystemMindPricing);

  const [workspaceId, setWorkspaceId] = useState<string>("");
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [exposeProviderCost, setExposeProviderCost] = useState(false);
  const [notes, setNotes] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  const clientsQ = useQuery({
    queryKey: ["accountsmind-clients"],
    queryFn:  () => listClientsFn(),
    throwOnError: false,
  });
  const clients = (clientsQ.data ?? []) as any[];

  useEffect(() => {
    if (!workspaceId && clients.length > 0) setWorkspaceId(clients[0].id);
  }, [clients, workspaceId]);

  const usageQ = useQuery({
    queryKey: ["accountsmind-systemmind-usage", workspaceId],
    queryFn:  () => getUsageFn({ data: { workspaceId } }),
    enabled:  Boolean(workspaceId),
    throwOnError: false,
  });
  const usage = usageQ.data as any;

  const pricingQ = useQuery({
    queryKey: ["systemmind-pricing"],
    queryFn:  () => getPricingFn(),
    throwOnError: false,
  });
  const pricing = pricingQ.data as any;

  const historyQ = useQuery({
    queryKey: ["systemmind-pricing-history"],
    queryFn:  () => listHistoryFn(),
    enabled:  showHistory,
    throwOnError: false,
  });

  // Seed the editor form only after pricing has loaded SUCCESSFULLY — a
  // transient fetch error must never seed zeros that an admin could then
  // accidentally save as the live platform pricing.
  useEffect(() => {
    if (form !== null || !pricingQ.isSuccess) return;
    const src = pricing ?? {};
    const next: Record<string, string> = {};
    for (const f of PRICING_FIELDS) next[f.key] = String(src[f.key] ?? 0);
    setForm(next);
    setExposeProviderCost(Boolean(src.expose_provider_cost));
  }, [pricing, pricingQ.isLoading, form]);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!form) throw new Error("Pricing form not ready");
      const parsed: Record<string, number> = {};
      for (const f of PRICING_FIELDS) {
        const v = Number(form[f.key]);
        if (!Number.isFinite(v) || v < 0) throw new Error(`"${f.label}" must be a non-negative number.`);
        parsed[f.key] = v;
      }
      return savePricingFn({
        data: {
          base_charge_per_run_usd:    parsed.base_charge_per_run_usd,
          charge_per_minute_usd:      parsed.charge_per_minute_usd,
          charge_per_1k_tokens_usd:   parsed.charge_per_1k_tokens_usd,
          charge_per_tool_call_usd:   parsed.charge_per_tool_call_usd,
          included_runs_per_month:    parsed.included_runs_per_month,
          included_seconds_per_month: parsed.included_seconds_per_month,
          included_tokens_per_month:  parsed.included_tokens_per_month,
          overage_multiplier:         parsed.overage_multiplier,
          expose_provider_cost:       exposeProviderCost,
          notes:                      notes.trim() || undefined,
        },
      });
    },
    onSuccess: () => {
      toast.success("SystemMind pricing saved", {
        description: "New config is now current — future usage events bill at these rates.",
      });
      setNotes("");
      qc.invalidateQueries({ queryKey: ["systemmind-pricing"] });
      qc.invalidateQueries({ queryKey: ["systemmind-pricing-history"] });
      qc.invalidateQueries({ queryKey: ["accountsmind-systemmind-usage"] });
    },
    onError: (e: Error) => toast.error("Save failed", { description: e.message }),
  });

  const events = (usage?.events ?? []) as any[];

  return (
    <div className="p-6 space-y-5">
      {/* Header + workspace selector */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Hammer className="w-5 h-5 text-sky-400" /> SystemMind Usage
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Build Workspace runs, tokens, elapsed time and customer charges — current month
          </p>
        </div>
        <select
          value={workspaceId}
          onChange={(e) => setWorkspaceId(e.target.value)}
          className="bg-gray-900 border border-gray-800 rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-sky-500/50"
        >
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.name ?? c.id}</option>
          ))}
        </select>
      </div>

      {usageQ.isLoading && (
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <RefreshCw className="w-4 h-4 animate-spin" /> Loading usage…
        </div>
      )}

      {/* KPI cards */}
      {usage && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            <Kpi icon={Zap}         label="Runs"           value={String(usage.totalRuns ?? 0)} />
            <Kpi icon={Clock}       label="Elapsed time"   value={fmtMs(usage.totalElapsedMs ?? 0)} />
            <Kpi icon={Coins}       label="Tokens"         value={(usage.totalTokens ?? 0).toLocaleString()} />
            <Kpi icon={Coins}       label="Provider cost"  value={fmtUsd(usage.providerCostUsd)} />
            <Kpi icon={TrendingUp}  label="Raw charge"     value={fmtUsd(usage.rawChargeUsd)} />
            <Kpi
              icon={ShieldCheck}
              label="Allowance"
              value={(() => {
                if (!usage.pricing) return "No plan";
                const p = usage.pricing;
                const hasAllowance =
                  (p.included_runs_per_month ?? 0) > 0 ||
                  (p.included_seconds_per_month ?? 0) > 0 ||
                  (p.included_tokens_per_month ?? 0) > 0;
                if (!hasAllowance) return "No allowance";
                return usage.withinAllowance ? "Within" : "Exceeded";
              })()}
              accent={
                usage.withinAllowance
                  ? "text-emerald-400"
                  : usage.pricing &&
                      ((usage.pricing.included_runs_per_month ?? 0) > 0 ||
                        (usage.pricing.included_seconds_per_month ?? 0) > 0 ||
                        (usage.pricing.included_tokens_per_month ?? 0) > 0)
                    ? "text-amber-400"
                    : "text-gray-400"
              }
            />
            <Kpi icon={TrendingUp}  label="Billable charge" value={fmtUsd(usage.billableChargeUsd)} accent="text-white" />
          </div>

          {/* Margin strip */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex items-center justify-between">
            <span className="text-sm text-gray-400">
              Margin this month (billable charge − provider cost)
            </span>
            <span className={cn(
              "text-lg font-bold",
              (usage.marginUsd ?? 0) >= 0 ? "text-emerald-400" : "text-red-400",
            )}>
              {fmtUsd(usage.marginUsd)}
            </span>
          </div>

          {/* Events table */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <h3 className="text-sm font-semibold text-white mb-3">
              Usage events ({events.length})
            </h3>
            {events.length === 0 && (
              <p className="text-xs text-gray-500">No SystemMind usage recorded for this workspace this month.</p>
            )}
            {events.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-gray-500 text-left border-b border-gray-800">
                      <th className="py-1.5 pr-3 font-medium">When</th>
                      <th className="py-1.5 pr-3 font-medium">Task</th>
                      <th className="py-1.5 pr-3 font-medium">Model</th>
                      <th className="py-1.5 pr-3 font-medium text-right">Tokens</th>
                      <th className="py-1.5 pr-3 font-medium text-right">Elapsed</th>
                      <th className="py-1.5 pr-3 font-medium text-right">Provider $</th>
                      <th className="py-1.5 pr-3 font-medium text-right">Charge $</th>
                      <th className="py-1.5 font-medium">OK</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.slice(0, 100).map((ev) => (
                      <tr key={ev.id} className="border-b border-gray-800/50 last:border-0 text-gray-300">
                        <td className="py-1.5 pr-3 whitespace-nowrap">
                          {new Date(ev.created_at).toLocaleString()}
                        </td>
                        <td className="py-1.5 pr-3">{TASK_LABELS[ev.task_type] ?? ev.task_type}</td>
                        <td className="py-1.5 pr-3 text-gray-500">{ev.model_id ?? "—"}</td>
                        <td className="py-1.5 pr-3 text-right">{(ev.total_tokens ?? 0).toLocaleString()}</td>
                        <td className="py-1.5 pr-3 text-right">{fmtMs(ev.elapsed_ms ?? 0)}</td>
                        <td className="py-1.5 pr-3 text-right">{fmtUsd(ev.estimated_provider_cost_usd)}</td>
                        <td className="py-1.5 pr-3 text-right text-white">{fmtUsd(ev.customer_charge_usd)}</td>
                        <td className="py-1.5">
                          <span className={ev.success ? "text-emerald-400" : "text-red-400"}>
                            {ev.success ? "✓" : "✗"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Pricing editor */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white">Pricing configuration</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Platform-wide rates for SystemMind Build Workspace usage. Saving creates a new
              current config — existing events keep the rates they were billed at.
            </p>
          </div>
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors"
          >
            <History className="w-3.5 h-3.5" />
            {showHistory ? "Hide history" : "History"}
          </button>
        </div>

        {form && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {PRICING_FIELDS.map((f) => (
                <label key={f.key} className="block">
                  <span className="text-xs text-gray-400">{f.label}</span>
                  <input
                    type="number"
                    min="0"
                    step={f.step}
                    value={form[f.key]}
                    onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                    className="mt-1 w-full bg-gray-950 border border-gray-800 rounded-md px-2.5 py-1.5 text-sm text-white focus:outline-none focus:border-sky-500/50"
                  />
                  {f.hint && <span className="text-[10px] text-gray-600">{f.hint}</span>}
                </label>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={exposeProviderCost}
                  onChange={(e) => setExposeProviderCost(e.target.checked)}
                  className="accent-sky-500"
                />
                Expose provider cost to customers
              </label>
              <input
                type="text"
                placeholder="Change note (optional)"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="flex-1 min-w-48 bg-gray-950 border border-gray-800 rounded-md px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-sky-500/50"
              />
              <button
                onClick={() => saveMut.mutate()}
                disabled={saveMut.isPending || !pricingQ.isSuccess}
                className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-medium rounded-md px-3 py-2 transition-colors"
              >
                {saveMut.isPending
                  ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  : <Save className="w-3.5 h-3.5" />}
                Save pricing
              </button>
            </div>
          </>
        )}

        {showHistory && (
          <div className="border-t border-gray-800 pt-3">
            {historyQ.isLoading && (
              <p className="text-xs text-gray-500">Loading history…</p>
            )}
            {((historyQ.data ?? []) as any[]).map((h) => (
              <div key={h.id} className="flex items-center justify-between py-1.5 border-b border-gray-800/50 last:border-0 text-xs">
                <div className="text-gray-400">
                  {new Date(h.created_at).toLocaleString()}
                  {h.is_current && (
                    <span className="ml-2 text-emerald-400 font-medium">current</span>
                  )}
                  {h.notes && <span className="ml-2 text-gray-600">{h.notes}</span>}
                </div>
                <div className="text-gray-300">
                  run {fmtUsd(h.base_charge_per_run_usd)} · min {fmtUsd(h.charge_per_minute_usd)} · 1k tok {fmtUsd(h.charge_per_1k_tokens_usd)} · ×{Number(h.overage_multiplier ?? 1)}
                </div>
              </div>
            ))}
            {!historyQ.isLoading && ((historyQ.data ?? []) as any[]).length === 0 && (
              <p className="text-xs text-gray-500">No pricing configs saved yet.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, accent }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-3.5 h-3.5 text-gray-500" />
        <span className="text-xs text-gray-400">{label}</span>
      </div>
      <div className={cn("text-lg font-bold", accent ?? "text-white")}>{value}</div>
    </div>
  );
}
