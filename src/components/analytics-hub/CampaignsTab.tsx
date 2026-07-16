import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Megaphone, AlertTriangle, CalendarClock, CheckCircle2, Clock, PauseCircle, PhoneCall, PhoneOff, Voicemail, Smile, Frown, CalendarCheck } from "lucide-react";
import { getCampaignAnalytics } from "@/lib/analytics-hub/analytics-hub.functions";
import { wbahDateTimeOptions } from "@/lib/dashboard/wbah-timezone";
import { LoadingProgress } from "@/components/dashboard/LoadingProgress";
import { EmptyState, TableHead, Th } from "@/components/dashboard/PageShell";
import {
  type AnalyticsFilterState, filterPayload, filterKey,
  ChartCard, InsightCard, TabError, MetricTile, CompactDonut,
  CHART, SENTIMENT_COLORS, gbp, pct, fmtInt, fmtSecs,
} from "./shared";

export function CampaignsTab({ filter }: { filter: AnalyticsFilterState }) {
  const fn = useServerFn(getCampaignAnalytics);
  const q = useQuery({
    queryKey: ["analytics-campaigns", filterKey(filter)],
    queryFn: () => fn({ data: filterPayload(filter) }),
    staleTime: 60_000,
    throwOnError: false,
  });

  if (q.isLoading) return <LoadingProgress label="Loading campaigns" estimatedMs={7000} />;
  if (q.error) return <TabError message={`Could not load campaigns: ${String((q.error as any)?.message ?? q.error)}`} />;
  const d: any = q.data ?? {};
  if (d.error === "not_available_for_wbah")
    return <div className="px-6 pt-6"><EmptyState icon={Megaphone} title="Not available" message="Campaign analytics is not applicable to this workspace." /></div>;
  if (d.error) return <TabError message={`Campaign error: ${d.error}`} />;
  if (d.mode === "wbah_dialler") return <WbahDiallerView w={d.wbah ?? {}} />;

  const campaigns: any[] = d.campaigns ?? [];
  const failures: any[] = d.failures ?? [];
  const schedule: any[] = d.schedule ?? [];

  return (
    <div className="space-y-5 px-6 pt-5">
      <ChartCard title="Today's Schedule" icon={CalendarClock} color={CHART.primary}>
        {schedule.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="No scheduled campaigns"
            message="No campaigns have a daily call schedule set up. Schedule one from the Data, Qualified or Leads pages."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <TableHead>
                <Th>Campaign</Th><Th>Runs at</Th><Th>Frequency</Th><Th>Last run</Th><Th>Today</Th>
              </TableHead>
              <tbody>
                {schedule.map((s) => (
                  <tr key={s.id} className="h-11 border-b border-white/[0.04] hover:bg-white/[0.02]">
                    <td className="px-3 py-2.5 font-medium">{s.name}</td>
                    <td className="px-3 py-2.5 tabular-nums">{s.callTime} <span className="text-xs text-muted-foreground">({s.timezone})</span></td>
                    <td className="px-3 py-2.5 capitalize">{s.frequency}</td>
                    <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{s.lastRunDate ?? "Never"}</td>
                    <td className="px-3 py-2.5">
                      {!s.active ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><PauseCircle className="h-3.5 w-3.5" /> Paused</span>
                      ) : s.ranToday ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400"><CheckCircle2 className="h-3.5 w-3.5" /> Ran today</span>
                      ) : s.runsToday ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-sky-400"><Clock className="h-3.5 w-3.5" /> Runs today at {s.callTime}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Clock className="h-3.5 w-3.5" /> Not due today</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>

      <ChartCard title="Campaign Performance" icon={Megaphone} color={CHART.primary}>
        {campaigns.length === 0 ? (
          <EmptyState icon={Megaphone} title="No campaigns" message="No campaigns found in this range." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <TableHead>
                <Th>Campaign</Th><Th>Status</Th><Th>Calls</Th><Th>Connected</Th>
                <Th>Conn. rate</Th><Th>Positive</Th><Th>Cost</Th><Th>Cost / conn.</Th>
              </TableHead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.id} className="h-11 border-b border-white/[0.04] hover:bg-white/[0.02]">
                    <td className="px-3 py-2.5 font-medium">{c.name}</td>
                    <td className="px-3 py-2.5 text-xs capitalize text-muted-foreground">{c.status}</td>
                    <td className="px-3 py-2.5 tabular-nums">{fmtInt(c.callsTotal)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{fmtInt(c.callsConnected)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{pct(c.connectionRate)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{fmtInt(c.positiveSentiment)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{gbp(c.totalCostCents)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{gbp(c.costPerConnectedCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>

      {failures.length > 0 && (
        <div className="space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <AlertTriangle className="h-4 w-4 text-red-400" /> Campaign failures
          </h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {failures.map((f, i) => (
              <InsightCard key={i} tone="danger" icon={AlertTriangle} title={`${f.campaign ?? "Campaign"} — ${f.type}`}>
                {f.reason ?? f.error ?? "Failure reported."}
                {f.stage ? <span className="block text-xs text-muted-foreground">Stage: {f.stage}</span> : null}
                {Array.isArray(f.recommendations) && f.recommendations.length > 0 && (
                  <ul className="mt-1.5 list-disc pl-4 text-xs text-foreground/70">
                    {f.recommendations.slice(0, 3).map((r: any, j: number) => (
                      <li key={j}>{typeof r === "string" ? r : r?.action ?? JSON.stringify(r)}</li>
                    ))}
                  </ul>
                )}
              </InsightCard>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** WBAH — WeeBespoke dialler activity report (WBAH has no WEBEE campaigns). */
function WbahDiallerView({ w }: { w: any }) {
  const total = Number(w.total ?? 0);
  const sent = w.sentiment ?? {};
  const reasons: any[] = w.reasons ?? [];
  const campaigns: any[] = w.campaigns ?? [];
  const converted: any[] = w.converted ?? [];
  const negatives: any[] = w.negatives ?? [];
  const when = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString("en-GB", wbahDateTimeOptions(true, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })) : "—";

  if (total === 0) {
    return (
      <div className="px-6 pt-6">
        <EmptyState icon={PhoneCall} title="No dialler activity" message="No WeeBespoke dialler calls found in this date range." />
      </div>
    );
  }

  return (
    <div className="space-y-5 px-6 pt-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MetricTile label="Calls dialled" value={fmtInt(total)} icon={PhoneCall} color={CHART.primary} />
        <MetricTile label="Connected" value={fmtInt(w.connected)} sub={`${pct(w.connectionRate)} connect rate`} icon={PhoneCall} color={CHART.success} />
        <MetricTile label="Voicemail" value={fmtInt(w.voicemail)} sub={`${pct(w.voicemailRate)} of dials`} icon={Voicemail} color={CHART.warning} />
        <MetricTile label="Positive sentiment" value={fmtInt(sent.positive)} icon={Smile} color={CHART.success} />
        <MetricTile label="Negative sentiment" value={fmtInt(sent.negative)} icon={Frown} color={CHART.danger} />
        <MetricTile label="Booked" value={fmtInt(w.booked)} icon={CalendarCheck} color={CHART.accent} />
      </div>

      {w.truncated && (
        <InsightCard tone="warning" icon={AlertTriangle} title="Large date range">
          This range has more calls than can be analysed in one pass — numbers cover the most recent calls only. Narrow the date range for exact figures.
        </InsightCard>
      )}

      {campaigns.length > 0 && (
        <ChartCard title="Performance by Dialler Campaign" icon={Megaphone} color={CHART.primary}>
          <div className="max-h-80 overflow-auto">
            <table className="w-full text-sm">
              <TableHead>
                <Th>Campaign</Th><Th>Runs at</Th><Th>Targets</Th><Th>Calls</Th><Th>Connected</Th><Th>Positive</Th><Th>Booked</Th><Th>Voicemail</Th>
              </TableHead>
              <tbody>
                {campaigns.map((c: any) => (
                  <tr key={c.id} className="h-10 border-b border-white/[0.04] hover:bg-white/[0.02]">
                    <td className="px-3 py-2 font-medium">{c.name}</td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">{c.scheduledTime ? `${c.scheduledTime} UK` : "—"}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{c.leadStatus ?? "—"}</td>
                    <td className="px-3 py-2 tabular-nums">{fmtInt(c.calls)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmtInt(c.connected)} <span className="text-xs text-muted-foreground">({pct(c.connectionRate)})</span></td>
                    <td className="px-3 py-2 tabular-nums text-emerald-400">{fmtInt(c.positive)}</td>
                    <td className="px-3 py-2 tabular-nums">{fmtInt(c.booked)}</td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">{fmtInt(c.voicemail)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {Number(w.campaignsUnattributed ?? 0) > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {fmtInt(w.campaignsUnattributed)} call(s) could not be matched to a campaign (agent not linked to any scheduled campaign).
            </p>
          )}
        </ChartCard>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ChartCard title="Sentiment Breakdown" icon={Smile} color={CHART.success}>
          <CompactDonut
            data={[
              { name: "Positive", value: Number(sent.positive ?? 0) },
              { name: "Neutral", value: Number(sent.neutral ?? 0) },
              { name: "Negative", value: Number(sent.negative ?? 0) },
              { name: "No sentiment", value: Number(sent.unknown ?? 0) },
            ]}
            colors={SENTIMENT_COLORS}
            centerLabel="Calls"
            centerValue={fmtInt(total)}
          />
        </ChartCard>

        <ChartCard title="Disconnection Reasons" icon={PhoneOff} color={CHART.danger}>
          <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
            {reasons.map((r) => (
              <div key={r.reason} className="flex items-center gap-3">
                <span className="w-44 shrink-0 truncate text-xs text-muted-foreground" title={r.reason}>{r.reason.replace(/_/g, " ")}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
                  <div className="h-full rounded-full" style={{ width: `${Math.max(2, r.pct)}%`, background: CHART.primary }} />
                </div>
                <span className="w-20 shrink-0 text-right text-xs tabular-nums">{fmtInt(r.count)} ({pct(r.pct)})</span>
              </div>
            ))}
          </div>
        </ChartCard>
      </div>

      <ChartCard title={`Converted Leads — Positive Sentiment (${fmtInt(converted.length)})`} icon={Smile} color={CHART.success}>
        {converted.length === 0 ? (
          <EmptyState icon={Smile} title="None yet" message="No positive-sentiment calls in this range." />
        ) : (
          <div className="max-h-80 overflow-auto">
            <table className="w-full text-sm">
              <TableHead>
                <Th>Name</Th><Th>Phone</Th><Th>Booked</Th><Th>Duration</Th><Th>When</Th>
              </TableHead>
              <tbody>
                {converted.map((c) => (
                  <tr key={c.id} className="h-10 border-b border-white/[0.04] hover:bg-white/[0.02]">
                    <td className="px-3 py-2 font-medium">{c.name}</td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">{c.phone ?? "—"}</td>
                    <td className="px-3 py-2">
                      {c.booked
                        ? <span className="inline-flex items-center gap-1 text-xs text-emerald-400"><CalendarCheck className="h-3.5 w-3.5" /> Booked{c.appointmentDate ? ` · ${c.appointmentDate}` : ""}</span>
                        : <span className="text-xs text-muted-foreground">Not booked</span>}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{fmtSecs(c.durationSeconds)}</td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">{when(c.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>

      <ChartCard title={`Negative Sentiment Calls (${fmtInt(negatives.length)})`} icon={Frown} color={CHART.danger}>
        {negatives.length === 0 ? (
          <EmptyState icon={Frown} title="None" message="No negative-sentiment calls in this range." />
        ) : (
          <div className="max-h-80 overflow-auto">
            <table className="w-full text-sm">
              <TableHead>
                <Th>Name</Th><Th>Phone</Th><Th>Disconnection reason</Th><Th>Duration</Th><Th>When</Th>
              </TableHead>
              <tbody>
                {negatives.map((c) => (
                  <tr key={c.id} className="h-10 border-b border-white/[0.04] hover:bg-white/[0.02]">
                    <td className="px-3 py-2 font-medium">{c.name}</td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">{c.phone ?? "—"}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{String(c.reason ?? "unknown").replace(/_/g, " ")}</td>
                    <td className="px-3 py-2 tabular-nums">{fmtSecs(c.durationSeconds)}</td>
                    <td className="px-3 py-2 tabular-nums text-muted-foreground">{when(c.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>
    </div>
  );
}
