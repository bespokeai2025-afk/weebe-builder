/**
 * Engine Status Tab — read-only view of workspace_api_profiles and api_engine_logs.
 * Shown as a standalone tab on the API Probe page. No new routes.
 */
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getApiEngineStatus, seedWbahProfile } from "@/lib/api-engine/api-engine.functions";
import { Activity, CheckCircle2, AlertTriangle, Clock, Database, RefreshCw, Loader2, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { toast } from "sonner";

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)   return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)   return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)   return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function StatusDot({ ok, warning }: { ok: boolean; warning?: boolean }) {
  const cls = ok
    ? "bg-emerald-400"
    : warning
      ? "bg-amber-400"
      : "bg-red-400";
  return <span className={cn("inline-block w-2 h-2 rounded-full", cls)} />;
}

// ── Module log row ─────────────────────────────────────────────────────────────

function ModuleLogRow({ log }: { log: any }) {
  const isOk = !log.hasError && log.lastStatus >= 200 && log.lastStatus < 300;
  const isWarn = log.lastStatus === 0 || (log.lastStatus >= 400 && log.lastStatus < 500);
  return (
    <div className="grid grid-cols-[1fr_80px_60px_70px_70px_80px] gap-2 items-center py-2 border-b border-white/[0.04] last:border-0 text-xs">
      <div className="flex items-center gap-1.5 min-w-0">
        <StatusDot ok={isOk} warning={isWarn} />
        <span className="font-mono text-gray-300 truncate">{log.dataSourceKey}</span>
        <span className="text-gray-600">/</span>
        <span className="text-sky-400 font-medium truncate">{log.moduleKey}</span>
      </div>
      <span className="text-gray-400 tabular-nums">{fmtRelative(log.lastRun)}</span>
      <span className={cn("tabular-nums font-mono", isOk ? "text-emerald-400" : isWarn ? "text-amber-400" : "text-red-400")}>
        {log.lastStatus ?? "—"}
      </span>
      <span className="text-gray-300 tabular-nums">{log.lastRecordCount ?? "—"}</span>
      <span className="text-gray-400 tabular-nums">{fmtMs(log.lastLatencyMs)}</span>
      <div className="min-w-0">
        {log.hasError ? (
          <span className="text-red-400 truncate text-[10px]" title={log.lastError ?? ""}>
            {log.lastError?.slice(0, 40) ?? "error"}
          </span>
        ) : (
          <span className="text-gray-600 text-[10px]">ok</span>
        )}
      </div>
    </div>
  );
}

// ── Profile card ───────────────────────────────────────────────────────────────

function ProfileCard({ profile }: { profile: any }) {
  return (
    <div className="rounded-lg border border-white/[0.06] bg-gray-900/50 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Database className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" />
          <span className="text-sm font-semibold text-white">{profile.displayName}</span>
          {profile.isActive ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-medium">active</span>
          ) : (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-400 font-medium">inactive</span>
          )}
        </div>
        <span className="text-[10px] text-gray-500 font-mono">{profile.dataSourceKey}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-[10px]">
        <div>
          <p className="text-gray-500 uppercase tracking-wider mb-0.5">Auth</p>
          <p className="text-gray-300 font-mono">{profile.authStrategy}</p>
        </div>
        <div>
          <p className="text-gray-500 uppercase tracking-wider mb-0.5">Pagination</p>
          <p className="text-gray-300 font-mono">{profile.paginationStrategy}</p>
        </div>
        <div>
          <p className="text-gray-500 uppercase tracking-wider mb-0.5">Modules mapped</p>
          <p className="text-gray-300">{profile.moduleMappingCount}</p>
        </div>
      </div>
      <p className="text-[10px] text-gray-600">Updated {fmtRelative(profile.updatedAt)}</p>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function EngineStatusTab() {
  const statusFn   = useServerFn(getApiEngineStatus);
  const seedFn     = useServerFn(seedWbahProfile);

  const [seedWsId, setSeedWsId] = useState("");
  const [seeding, setSeeding]   = useState(false);

  const { data, isLoading, refetch, isRefetching } = useQuery({
    queryKey:     ["api-engine-status"],
    queryFn:      () => statusFn(),
    throwOnError: false,
    refetchInterval: 60_000,
  });

  const status = data as { profiles: any[]; moduleLogs: any[] } | undefined;

  async function handleSeed() {
    if (!seedWsId.trim()) { toast.error("Enter a workspace UUID"); return; }
    setSeeding(true);
    try {
      const res = await seedFn({ data: { workspaceId: seedWsId.trim() } }) as any;
      toast.success(res?.message ?? "Profile seeded");
      refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Seed failed");
    } finally {
      setSeeding(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-500">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading engine status…
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-violet-400" />
          <h3 className="text-sm font-semibold text-white">API Engine Status</h3>
          <span className="text-[10px] text-gray-500">live engine runtime data</span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => refetch()}
          disabled={isRefetching}
          className="text-gray-400 hover:text-white h-7 text-xs gap-1"
        >
          {isRefetching ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Refresh
        </Button>
      </div>

      {/* Active Profiles */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
          <Database className="w-3.5 h-3.5" /> Active API Profiles
        </p>
        {(status?.profiles ?? []).length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/10 p-6 text-center">
            <Database className="mx-auto h-6 w-6 text-gray-700 mb-2" />
            <p className="text-xs text-gray-500">No workspace API profiles configured yet.</p>
            <p className="text-[10px] text-gray-600 mt-1">Seed the Webuyanyhouse profile below to enable the engine.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {(status?.profiles ?? []).map((p: any) => (
              <ProfileCard key={p.id} profile={p} />
            ))}
          </div>
        )}
      </div>

      {/* Module execution log */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5" /> Last 48h Module Activity
        </p>
        {(status?.moduleLogs ?? []).length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/10 p-5 text-center">
            <Clock className="mx-auto h-5 w-5 text-gray-700 mb-1.5" />
            <p className="text-xs text-gray-500">No engine calls recorded in the last 48 hours.</p>
          </div>
        ) : (
          <div className="rounded-lg border border-white/[0.06] bg-gray-900/40 overflow-hidden">
            <div className="grid grid-cols-[1fr_80px_60px_70px_70px_80px] gap-2 px-3 py-2 border-b border-white/[0.06] text-[10px] text-gray-500 uppercase tracking-wider">
              <span>Source / Module</span>
              <span>Last Run</span>
              <span>Status</span>
              <span>Records</span>
              <span>Latency</span>
              <span>Error</span>
            </div>
            <div className="px-3">
              {(status?.moduleLogs ?? []).map((log: any, i: number) => (
                <ModuleLogRow key={`${log.workspaceId}:${log.dataSourceKey}:${log.moduleKey}:${i}`} log={log} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Seed WBAH Profile */}
      <div className="rounded-lg border border-violet-500/20 bg-violet-500/[0.04] p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Zap className="w-3.5 h-3.5 text-violet-400" />
          <p className="text-xs font-semibold text-violet-300">Seed Webuyanyhouse API Profile</p>
        </div>
        <p className="text-[10px] text-gray-400">
          Creates a <code className="text-violet-300">workspace_api_profiles</code> row for the WBAH workspace,
          mapping module keys to the endpoint mappings saved in API Probe. Auth is wired to the existing
          enterprise_integrations token store — no credential duplication.
        </p>
        <div className="flex gap-2">
          <Input
            value={seedWsId}
            onChange={(e) => setSeedWsId(e.target.value)}
            placeholder="Workspace UUID…"
            className="flex-1 bg-gray-800 border-gray-700 text-white text-xs h-8 font-mono"
          />
          <Button
            size="sm"
            onClick={handleSeed}
            disabled={seeding || !seedWsId.trim()}
            className="bg-violet-600 hover:bg-violet-700 text-white text-xs h-8 gap-1"
          >
            {seeding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
            Seed Profile
          </Button>
        </div>
      </div>

    </div>
  );
}
