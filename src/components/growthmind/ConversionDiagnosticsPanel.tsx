/**
 * Conversion Tracking diagnostics panel (Ads Performance page).
 * Shows the honest server-side tracking evidence: per-conversion recording,
 * Google acknowledgement status, duplicate protection and attribution
 * availability, plus the overall tracking-health signal.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, AlertTriangle, XCircle, HelpCircle, Radar } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { getConversionDiagnostics } from "@/lib/tracking/conversion-diagnostics.server";

const SIGNAL_META: Record<string, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  verified:    { label: "Verified",    cls: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10", Icon: CheckCircle2 },
  partial:     { label: "Partial",     cls: "text-amber-400 border-amber-500/30 bg-amber-500/10",       Icon: AlertTriangle },
  broken:      { label: "Broken",      cls: "text-red-400 border-red-500/30 bg-red-500/10",             Icon: XCircle },
  unavailable: { label: "Unavailable", cls: "text-muted-foreground border-white/[0.1] bg-white/[0.03]", Icon: HelpCircle },
};

export function ConversionDiagnosticsPanel() {
  const fetchDiagnostics = useServerFn(getConversionDiagnostics);
  const { data, isLoading, error } = useQuery({
    queryKey: ["conversion-diagnostics"],
    queryFn: () => fetchDiagnostics(),
    staleTime: 60_000,
    throwOnError: false,
  });

  if (isLoading) return null;
  if (error || !data) {
    return (
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
        <p className="text-xs text-muted-foreground">Conversion tracking diagnostics unavailable.</p>
      </div>
    );
  }

  const meta = SIGNAL_META[data.health.signal] ?? SIGNAL_META.unavailable;
  const { Icon } = meta;

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Radar className="h-4 w-4 text-sky-400" />
        <p className="text-sm font-medium flex-1">Conversion Tracking</p>
        <Badge variant="outline" className={cn("text-[11px] gap-1", meta.cls)}>
          <Icon className="h-3 w-3" /> {meta.label}
        </Badge>
      </div>

      <ul className="space-y-1">
        {data.health.reasons.map((r: string, i: number) => (
          <li key={i} className="text-[11px] text-muted-foreground leading-snug">• {r}</li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <Badge variant="outline" className="text-[10px] border-white/[0.1] bg-white/[0.03] text-muted-foreground">
          Transport: {data.uploadConfig.transport === "data_manager" ? "Google Data Manager API" : "Legacy click conversions (fallback)"}
        </Badge>
        {data.uploadConfig.hasDataManagerScope ? (
          <Badge variant="outline" className="text-[10px] gap-1 text-emerald-400 border-emerald-500/30 bg-emerald-500/10">
            <CheckCircle2 className="h-3 w-3" /> Data Manager access granted
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px] gap-1 text-amber-400 border-amber-500/30 bg-amber-500/10">
            <AlertTriangle className="h-3 w-3" /> Data Manager access not granted
          </Badge>
        )}
      </div>

      {data.uploadConfig.reauthorisationRequired && (
        <p className="text-[11px] text-amber-400/90 leading-snug">
          The Google connection was authorised before Data Manager access was added. Reconnect with
          Google (Advertising settings → Connect with Google) to grant the new permission — uploads
          are held until then.
        </p>
      )}

      {!data.uploadConfig.uploadActionConfigured && (
        <p className="text-[11px] text-amber-400/90 leading-snug">
          Google acknowledgement requires an upload-type conversion action in Google Ads plus the
          <span className="font-mono"> uploadConversionActionId</span> provider setting — a drafted
          Google Ads change awaiting approval.
        </p>
      )}

      {data.statusCounts && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span>Queued: <span className="text-foreground">{data.statusCounts.queued}</span></span>
          <span>Submitted: <span className="text-foreground">{data.statusCounts.submitted}</span></span>
          <span>Accepted: <span className={cn(data.statusCounts.accepted > 0 ? "text-emerald-400" : "text-foreground")}>{data.statusCounts.accepted}</span></span>
          <span>Awaiting verification: <span className="text-foreground">{data.statusCounts.verificationPending}</span></span>
          <span>Rejected: <span className={cn(data.statusCounts.rejected > 0 ? "text-red-400" : "text-foreground")}>{data.statusCounts.rejected}</span></span>
          <span>Duplicates blocked: <span className="text-foreground">{data.statusCounts.duplicates}</span></span>
        </div>
      )}

      {data.funnel && (data.funnel.callsStarted > 0 || data.funnel.avaBookings > 0 || data.funnel.webFormLeads > 0) && (
        <div className="space-y-1">
          <p className="text-[11px] font-medium text-muted-foreground">Funnel (last 30 days)</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span>Ava calls started: <span className="text-foreground">{data.funnel.callsStarted}</span></span>
            <span>Ava leads: <span className="text-foreground">{data.funnel.avaLeads}</span></span>
            <span>Ava bookings: <span className={cn(data.funnel.avaBookings > 0 ? "text-emerald-400" : "text-foreground")}>{data.funnel.avaBookings}</span></span>
            <span>Ads-attributed bookings: <span className="text-foreground">{data.funnel.adsAttributedBookings}</span></span>
            <span>Organic bookings: <span className="text-foreground">{data.funnel.organicBookings}</span></span>
            <span>Web-form leads: <span className="text-foreground">{data.funnel.webFormLeads}</span></span>
            {data.funnel.callToLeadRatePct != null && (
              <span>Call → lead: <span className="text-foreground">{data.funnel.callToLeadRatePct}%</span></span>
            )}
            {data.funnel.callToBookingRatePct != null && (
              <span>Call → booking: <span className="text-foreground">{data.funnel.callToBookingRatePct}%</span></span>
            )}
          </div>
        </div>
      )}

      {data.lastProviderError && (
        <p className="text-[11px] text-red-400/90 leading-snug break-all">
          Last provider error: {data.lastProviderError.message}
        </p>
      )}
      {data.lastSuccessfulUploadAt && (
        <p className="text-[11px] text-muted-foreground">
          Last successful upload: {new Date(data.lastSuccessfulUploadAt).toLocaleString()}
        </p>
      )}

      {data.conversions.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-muted-foreground/70 text-left">
                <th className="py-1 pr-3 font-medium">Conversion</th>
                <th className="py-1 pr-3 font-medium">Source</th>
                <th className="py-1 pr-3 font-medium">24h</th>
                <th className="py-1 pr-3 font-medium">30d</th>
                <th className="py-1 pr-3 font-medium">With click ID</th>
                <th className="py-1 pr-3 font-medium">Google acknowledged</th>
                <th className="py-1 pr-3 font-medium">Failed</th>
                <th className="py-1 pr-3 font-medium">Duplicates blocked</th>
                <th className="py-1 font-medium">Last event</th>
              </tr>
            </thead>
            <tbody>
              {data.conversions.map((c: any) => (
                <tr key={c.conversionName} className="border-t border-white/[0.04]">
                  <td className="py-1.5 pr-3 font-medium">{c.conversionName}</td>
                  <td className="py-1.5 pr-3 text-muted-foreground">{(c.sources ?? []).join(", ") || "—"}</td>
                  <td className="py-1.5 pr-3">{c.last24h}</td>
                  <td className="py-1.5 pr-3">{c.total}</td>
                  <td className="py-1.5 pr-3">{c.withClickId}</td>
                  <td className={cn("py-1.5 pr-3", c.uploaded > 0 ? "text-emerald-400" : "text-muted-foreground")}>
                    {c.uploaded}
                  </td>
                  <td className={cn("py-1.5 pr-3", c.failed > 0 ? "text-red-400" : "text-muted-foreground")}>{c.failed}</td>
                  <td className="py-1.5 pr-3">{c.duplicates}</td>
                  <td className="py-1.5 text-muted-foreground">
                    {c.lastEventAt ? new Date(c.lastEventAt).toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.conversions.length === 0 && (
        <p className="text-[11px] text-muted-foreground">
          No conversion events recorded in the last 30 days. Events are recorded automatically when a
          lead is created from a webform, the Talk to Us form, or a qualified Ava call.
        </p>
      )}

      <p className="text-[10px] text-muted-foreground/60">
        Last checked {new Date(data.checkedAt).toLocaleString()}
      </p>
    </div>
  );
}
