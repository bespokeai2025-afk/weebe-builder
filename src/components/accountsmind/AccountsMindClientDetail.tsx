import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  getClientDetail,
  computeAndStoreClientCost,
} from "@/lib/accountsmind/accountsmind.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCw, TrendingUp, TrendingDown, AlertTriangle,
  ChevronLeft, BarChart3, Mic, Brain, Phone, MessageSquare, Mail, Video, Image, HardDrive, Receipt,
} from "lucide-react";
import { cn } from "@/lib/utils";

const COST_CATEGORIES = [
  { key: "voice_cost_cents",          label: "Voice",       icon: Mic,           color: "text-blue-400" },
  { key: "llm_cost_cents",            label: "LLM / AI",   icon: Brain,         color: "text-purple-400" },
  { key: "telephony_cost_cents",      label: "Telephony",  icon: Phone,         color: "text-orange-400" },
  { key: "whatsapp_cost_cents",       label: "WhatsApp",   icon: MessageSquare, color: "text-green-400" },
  { key: "email_cost_cents",          label: "Email",      icon: Mail,          color: "text-pink-400" },
  { key: "video_cost_cents",          label: "Video",      icon: Video,         color: "text-yellow-400" },
  { key: "image_cost_cents",          label: "Image",      icon: Image,         color: "text-cyan-400" },
  { key: "storage_cost_cents",        label: "Storage",    icon: HardDrive,     color: "text-gray-400" },
  { key: "infrastructure_cost_cents", label: "Infra",      icon: BarChart3,     color: "text-gray-400" },
];

function fmt(cents: number) {
  return `£${(cents / 100).toFixed(2)}`;
}

function MarginBar({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const color =
    pct >= 40 ? "bg-emerald-500" : pct >= 20 ? "bg-yellow-500" : pct >= 0 ? "bg-orange-500" : "bg-red-500";
  return (
    <div className="w-full bg-gray-800 rounded-full h-2">
      <div className={cn("h-2 rounded-full transition-all", color)} style={{ width: `${clamped}%` }} />
    </div>
  );
}

interface Props { workspaceId: string }

export function AccountsMindClientDetail({ workspaceId }: Props) {
  const getDetail  = useServerFn(getClientDetail);
  const computeFn  = useServerFn(computeAndStoreClientCost);
  const qc         = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["accountsmind-client", workspaceId],
    queryFn:  () => getDetail({ data: { workspaceId } }),
    throwOnError: false,
  });

  const compute = useMutation({
    mutationFn: () => computeFn({ data: { workspaceId } }),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["accountsmind-client", workspaceId] }),
  });

  if (isLoading) {
    return (
      <div className="p-8 flex items-center gap-3 text-gray-400">
        <RefreshCw className="w-4 h-4 animate-spin" /> Loading client…
      </div>
    );
  }

  const ws      = (data as any)?.workspace;
  const profile = (data as any)?.billingProfile;
  const curr    = (data as any)?.currentMonth;
  const history = ((data as any)?.history ?? []) as any[];
  const alerts  = ((data as any)?.alerts  ?? []) as any[];

  const currency = profile?.currency === "USD" ? "$" : "£";
  const chargeCents = profile?.monthly_charge_cents ?? 0;
  const totalCents  = curr?.total_cost_cents ?? 0;
  const profitCents = curr?.gross_profit_cents ?? 0;
  const marginPct   = curr?.gross_margin_percent ?? 0;
  const forecastPct = chargeCents > 0 ? ((curr?.forecast_month_end_cents ?? totalCents) / chargeCents * 100).toFixed(0) : "—";

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/admin/accounts/clients" className="text-gray-400 hover:text-white">
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-white">{ws?.name ?? "Client"}</h1>
          <p className="text-xs text-gray-500">Workspace ID: {workspaceId}</p>
        </div>
        <Link
          to="/admin/accounts/invoices"
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-sm text-sky-300 border border-sky-800/60 hover:bg-sky-900/30"
        >
          <Receipt className="w-3.5 h-3.5" /> Generate invoice
        </Link>
        <Button
          size="sm"
          onClick={() => compute.mutate()}
          disabled={compute.isPending}
          className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", compute.isPending && "animate-spin")} />
          Recompute
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="text-xs text-gray-500 mb-1">Monthly Charge</div>
          <div className="text-lg font-bold text-emerald-400">{currency}{(chargeCents / 100).toFixed(2)}</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="text-xs text-gray-500 mb-1">Month Cost (so far)</div>
          <div className="text-lg font-bold text-red-400">{currency}{(totalCents / 100).toFixed(2)}</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="text-xs text-gray-500 mb-1">Gross Profit</div>
          <div className={cn("text-lg font-bold", profitCents >= 0 ? "text-emerald-400" : "text-red-400")}>
            {currency}{(profitCents / 100).toFixed(2)}
          </div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <div className="text-xs text-gray-500 mb-1">Gross Margin</div>
          <div className={cn("text-lg font-bold", marginPct >= 30 ? "text-emerald-400" : marginPct >= 0 ? "text-yellow-400" : "text-red-400")}>
            {marginPct.toFixed(1)}%
          </div>
        </div>
      </div>

      {/* Margin bar + forecast */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-400">Margin</span>
          <span className="text-white font-semibold">{marginPct.toFixed(1)}%</span>
        </div>
        <MarginBar pct={marginPct} />
        <div className="flex items-center justify-between text-xs text-gray-500">
          <span>Month-end forecast: {currency}{((curr?.forecast_month_end_cents ?? totalCents) / 100).toFixed(2)}</span>
          <span>{forecastPct}% of charge</span>
        </div>
      </div>

      {/* Cost breakdown */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <h3 className="text-sm font-semibold text-white mb-3">Cost Breakdown</h3>
        {!curr && (
          <p className="text-xs text-gray-500">No cost data for this month. Click Recompute to generate.</p>
        )}
        <div className="space-y-2">
          {COST_CATEGORIES.map(({ key, label, icon: Icon, color }) => {
            const cents = curr?.[key] ?? 0;
            if (!cents) return null;
            const barPct = totalCents > 0 ? (cents / totalCents) * 100 : 0;
            return (
              <div key={key} className="flex items-center gap-3">
                <Icon className={cn("w-3.5 h-3.5 shrink-0", color)} />
                <span className="text-xs text-gray-400 w-24">{label}</span>
                <div className="flex-1 bg-gray-800 rounded-full h-1.5">
                  <div
                    className={cn("h-1.5 rounded-full", color.replace("text-", "bg-"))}
                    style={{ width: `${barPct}%` }}
                  />
                </div>
                <span className="text-xs text-gray-300 w-16 text-right">{currency}{(cents / 100).toFixed(2)}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-2">
          <h3 className="text-sm font-semibold text-white flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-yellow-400" /> Open Alerts
          </h3>
          {alerts.map((a: any) => (
            <div key={a.id} className="flex items-start gap-2 text-sm">
              <Badge className={cn("text-[10px] mt-0.5 shrink-0",
                a.severity === "critical" ? "bg-red-500/20 text-red-400" :
                a.severity === "warning"  ? "bg-yellow-500/20 text-yellow-400" :
                "bg-blue-500/20 text-blue-400"
              )}>{a.severity}</Badge>
              <div>
                <div className="text-gray-200">{a.title}</div>
                <div className="text-xs text-gray-500">{a.message}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* History */}
      {history.length > 1 && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-white mb-3">Monthly History</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-gray-300">
              <thead>
                <tr className="text-gray-500 border-b border-gray-800">
                  <th className="text-left pb-2">Month</th>
                  <th className="text-right pb-2">Charge</th>
                  <th className="text-right pb-2">Cost</th>
                  <th className="text-right pb-2">Profit</th>
                  <th className="text-right pb-2">Margin</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h: any) => (
                  <tr key={h.id} className="border-b border-gray-800/50 last:border-0">
                    <td className="py-1.5">{new Date(h.month).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}</td>
                    <td className="text-right">{currency}{(h.monthly_charge_cents / 100).toFixed(0)}</td>
                    <td className="text-right text-red-400">{currency}{(h.total_cost_cents / 100).toFixed(0)}</td>
                    <td className={cn("text-right", h.gross_profit_cents >= 0 ? "text-emerald-400" : "text-red-400")}>
                      {currency}{(h.gross_profit_cents / 100).toFixed(0)}
                    </td>
                    <td className={cn("text-right font-semibold", h.gross_margin_percent >= 30 ? "text-emerald-400" : h.gross_margin_percent >= 0 ? "text-yellow-400" : "text-red-400")}>
                      {h.gross_margin_percent.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
