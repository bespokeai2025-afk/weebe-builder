import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { listClientApiConnections } from "@/lib/systemmind/client-api-connections.server";
import { listEndpointMappings } from "@/lib/systemmind/client-api-mappings.server";
import { listAccountsClients } from "@/lib/accountsmind/accountsmind.functions";
import {
  Users, Activity, Settings, ArrowRight, Building2,
  CheckCircle2, AlertTriangle, Clock, Database, ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";

function StatCard({ label, value, icon: Icon, accent = "sky" }: {
  label: string; value: string | number; icon: React.ElementType; accent?: string;
}) {
  const cls = accent === "emerald" ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
    : accent === "violet"  ? "text-violet-400 bg-violet-500/10 border-violet-500/20"
    : accent === "amber"   ? "text-amber-400 bg-amber-500/10 border-amber-500/20"
    : "text-sky-400 bg-sky-500/10 border-sky-500/20";
  return (
    <div className="rounded-xl border border-white/[0.06] bg-gray-900/40 p-4">
      <div className={cn("inline-flex h-8 w-8 items-center justify-center rounded-lg border mb-3", cls)}>
        <Icon className="h-4 w-4" />
      </div>
      <div className="text-2xl font-bold text-white">{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const cls = status === "connected"
    ? "text-emerald-400"
    : status === "error"
    ? "text-red-400"
    : "text-gray-500";
  return <span className={cn("text-xs font-medium", cls)}>● {status}</span>;
}

export function ClientsOverviewPage() {
  const listConnFn    = useServerFn(listClientApiConnections);
  const listClientsFn = useServerFn(listAccountsClients);

  const { data: connections = [] } = useQuery({
    queryKey: ["client-api-connections"],
    queryFn:  () => listConnFn(),
    throwOnError: false,
  });

  const { data: clients = [] } = useQuery({
    queryKey: ["accountsmind-clients"],
    queryFn:  () => listClientsFn(),
    throwOnError: false,
  });

  const conns = connections as any[];
  const connected  = conns.filter((c) => c.status === "connected").length;
  const errored    = conns.filter((c) => c.status === "error").length;
  const untested   = conns.filter((c) => c.status === "untested").length;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <Users className="w-5 h-5 text-sky-400" /> Clients
        </h1>
        <p className="text-sm text-gray-400 mt-0.5">Admin-only platform workspace management and API integration hub</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total Workspaces"  value={(clients as any[]).length} icon={Building2} accent="sky"     />
        <StatCard label="API Connections"   value={conns.length}              icon={Activity}  accent="violet"  />
        <StatCard label="Connected"         value={connected}                 icon={CheckCircle2} accent="emerald" />
        <StatCard label="Need Attention"    value={errored + untested}        icon={AlertTriangle} accent="amber" />
      </div>

      {/* Quick navigation */}
      <div className="grid sm:grid-cols-2 gap-3">
        <Link
          to="/systemmind/clients/setup"
          className="group rounded-xl border border-white/[0.06] bg-gray-900/40 hover:border-sky-500/30 hover:bg-sky-500/[0.04] transition-all p-5 flex items-start gap-4"
        >
          <div className="h-10 w-10 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center shrink-0">
            <Settings className="h-5 w-5 text-sky-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-white">Workspace Setup</p>
              <ArrowRight className="h-3.5 w-3.5 text-gray-600 group-hover:text-sky-400 transition-colors" />
            </div>
            <p className="text-xs text-gray-400 mt-1 leading-relaxed">
              Configure module access, plan tiers, and billing profiles for each platform workspace.
            </p>
            <div className="mt-3 flex gap-2">
              <span className="text-[10px] px-2 py-0.5 rounded bg-sky-500/10 text-sky-400">{(clients as any[]).length} workspaces</span>
            </div>
          </div>
        </Link>

        <Link
          to="/systemmind/clients/api-probe"
          className="group rounded-xl border border-white/[0.06] bg-gray-900/40 hover:border-violet-500/30 hover:bg-violet-500/[0.04] transition-all p-5 flex items-start gap-4"
        >
          <div className="h-10 w-10 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0">
            <Activity className="h-5 w-5 text-violet-400" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-white">API Probe</p>
              <ArrowRight className="h-3.5 w-3.5 text-gray-600 group-hover:text-violet-400 transition-colors" />
            </div>
            <p className="text-xs text-gray-400 mt-1 leading-relaxed">
              Connect, test, and map external client APIs to WEBEE modules. Probe endpoints and detect pagination.
            </p>
            <div className="mt-3 flex gap-2">
              <span className={cn("text-[10px] px-2 py-0.5 rounded", connected > 0 ? "bg-emerald-500/10 text-emerald-400" : "bg-gray-800 text-gray-500")}>
                {connected} connected
              </span>
              {errored > 0 && (
                <span className="text-[10px] px-2 py-0.5 rounded bg-red-500/10 text-red-400">{errored} error</span>
              )}
              {untested > 0 && (
                <span className="text-[10px] px-2 py-0.5 rounded bg-gray-800 text-gray-500">{untested} untested</span>
              )}
            </div>
          </div>
        </Link>
      </div>

      {/* API Connections list (summary) */}
      {conns.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-600 mb-2">API Connections</p>
          <div className="space-y-1.5">
            {conns.map((c: any) => (
              <div key={c.id} className="flex items-center gap-3 rounded-lg border border-white/[0.06] bg-gray-900/40 px-4 py-2.5">
                <div className="h-7 w-7 rounded-md bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0">
                  <Database className="h-3.5 w-3.5 text-violet-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-white">{c.name}</span>
                  <span className="ml-2 text-xs font-mono text-gray-600 truncate">{c.base_url}</span>
                </div>
                <StatusDot status={c.status} />
                <span className="text-[10px] text-gray-600">{c.auth_type}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-end">
            <Link to="/systemmind/clients/api-probe" className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors">
              Manage connections <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </div>
      )}

      {/* AccountsMind link */}
      <div className="rounded-xl border border-gray-800 bg-gray-900/40 px-4 py-3 flex items-center gap-3">
        <ExternalLink className="w-4 h-4 text-gray-500 shrink-0" />
        <div className="flex-1">
          <p className="text-xs font-medium text-gray-300">Billing & Commercial Management</p>
          <p className="text-xs text-gray-500 mt-0.5">
            Billing profiles, enterprise subscription status, and recharge management are in{" "}
            <Link to="/admin/accounts/clients" className="text-sky-400 hover:underline">AccountsMind → Clients</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}
