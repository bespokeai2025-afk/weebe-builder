import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listAccountsAlerts,
  resolveAlert,
} from "@/lib/accountsmind/accountsmind.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bell, CheckCircle, RefreshCw, AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

const SEVERITY_CONFIG = {
  critical: { color: "bg-red-500/20 text-red-400", icon: AlertTriangle, dot: "bg-red-500" },
  warning:  { color: "bg-yellow-500/20 text-yellow-400", icon: AlertTriangle, dot: "bg-yellow-500" },
  info:     { color: "bg-blue-500/20 text-blue-400", icon: Info, dot: "bg-blue-500" },
};

export function AccountsMindAlerts() {
  const listFn    = useServerFn(listAccountsAlerts);
  const resolveFn = useServerFn(resolveAlert);
  const qc        = useQueryClient();
  const [filter, setFilter] = useState<"open" | "resolved" | "all">("open");

  const { data = [], isLoading } = useQuery({
    queryKey: ["accountsmind-alerts", filter],
    queryFn:  () =>
      filter === "all"
        ? listFn({ data: {} })
        : listFn({ data: { status: filter } }),
  });

  const resolve = useMutation({
    mutationFn: (alertId: string) => resolveFn({ data: { alertId } }),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ["accountsmind-alerts"] }),
  });

  const rows = data as any[];
  const criticalCount = rows.filter((r: any) => r.severity === "critical" && r.status === "open").length;

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Bell className="w-5 h-5 text-yellow-400" /> Alerts
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">AccountsMind finance & margin alerts</p>
        </div>
        {criticalCount > 0 && (
          <Badge className="bg-red-500/20 text-red-400">
            {criticalCount} critical
          </Badge>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-lg p-1 w-fit">
        {(["open", "resolved", "all"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "px-3 py-1.5 rounded-md text-xs font-medium transition-colors capitalize",
              filter === f
                ? "bg-gray-700 text-white"
                : "text-gray-400 hover:text-white",
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <RefreshCw className="w-4 h-4 animate-spin" /> Loading alerts…
        </div>
      )}

      {rows.length === 0 && !isLoading && (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
          <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto mb-3" />
          <p className="text-sm text-gray-400">
            {filter === "open" ? "No open alerts. All clear!" : "No alerts found."}
          </p>
        </div>
      )}

      <div className="space-y-2">
        {rows.map((alert: any) => {
          const sev    = alert.severity as keyof typeof SEVERITY_CONFIG;
          const config = SEVERITY_CONFIG[sev] ?? SEVERITY_CONFIG.info;
          const Icon   = config.icon;
          return (
            <div
              key={alert.id}
              className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 flex items-start gap-3"
            >
              <div className={cn("p-1.5 rounded-md mt-0.5", config.color)}>
                <Icon className="w-3.5 h-3.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-medium text-white">{alert.title}</span>
                  <Badge className={cn("text-[10px]", config.color)}>{alert.severity}</Badge>
                </div>
                <p className="text-xs text-gray-400">{alert.message}</p>
                <div className="flex items-center gap-3 mt-1.5">
                  {alert.workspaces?.name && (
                    <span className="text-[10px] text-gray-500">
                      {alert.workspaces.name}
                    </span>
                  )}
                  <span className="text-[10px] text-gray-600">
                    {new Date(alert.created_at).toLocaleDateString()}
                  </span>
                  {alert.alert_type && (
                    <span className="text-[10px] text-gray-600 uppercase">{alert.alert_type.replace(/_/g, " ")}</span>
                  )}
                </div>
              </div>
              {alert.status === "open" && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => resolve.mutate(alert.id)}
                  disabled={resolve.isPending}
                  className="text-gray-400 hover:text-emerald-400 hover:bg-emerald-500/10 text-xs shrink-0"
                >
                  <CheckCircle className="w-3.5 h-3.5 mr-1" />
                  Resolve
                </Button>
              )}
              {alert.status === "resolved" && (
                <span className="text-[10px] text-emerald-400 shrink-0">Resolved</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
