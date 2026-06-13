import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Loader2, RefreshCw, CheckCircle2, XCircle, Bot, Phone,
  CalendarCheck, MessageSquare, Brain, Zap, Megaphone, Link2,
  PhoneCall, MailCheck, Hash,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { HiveMindShell } from "@/components/hivemind/HiveMindShell";
import { getHiveMindPlatformData } from "@/lib/hivemind/hivemind.functions";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/_authenticated/hivemind/system-health")({
  head: () => ({ meta: [{ title: "System Health — HiveMind" }] }),
  component: HiveMindSystemHealth,
});

type Integration = {
  key: string;
  label: string;
  desc: string;
  icon: React.ElementType;
  setupHref: string;
  category: string;
  detail?: (d: any) => string;
};

const INTEGRATIONS: Integration[] = [
  {
    key: "retell", label: "Retell", desc: "Voice agent deployment platform",
    icon: Bot, setupHref: "/settings/integrations", category: "Voice",
    detail: d => d?.agents?.filter((a: any) => a.retell_agent_id || a.settings?.deployedRetellAgentId).length + " agent(s) deployed",
  },
  {
    key: "elevenlabs", label: "ElevenLabs", desc: "Custom voice provider (HyperStream)",
    icon: Brain, setupHref: "/settings/integrations", category: "Voice",
    detail: () => "Custom voice synthesis",
  },
  {
    key: "openai", label: "OpenAI", desc: "GPT-4o inference (VoxStream)",
    icon: Brain, setupHref: "/settings/integrations", category: "Voice",
    detail: () => "Realtime AI conversations",
  },
  {
    key: "calcom", label: "Cal.com", desc: "Appointment booking",
    icon: CalendarCheck, setupHref: "/settings/calendar", category: "Calendar",
    detail: d => d?.bookings?.total + " booking(s) total",
  },
  {
    key: "twilio", label: "Twilio", desc: "Telephony & SMS routing",
    icon: PhoneCall, setupHref: "/telephony-settings", category: "Telephony",
    detail: d => d?.telephony?.total + " call(s) in 30d",
  },
  {
    key: "phoneNumbers", label: "Phone Numbers", desc: "Assigned inbound numbers",
    icon: Phone, setupHref: "/phone-numbers", category: "Telephony",
    detail: d => (d?.phoneNumbers?.length ?? 0) + " number(s) configured",
  },
  {
    key: "whatsapp", label: "WhatsApp (WATI)", desc: "WhatsApp messaging channel",
    icon: MessageSquare, setupHref: "/whatsapp", category: "Messaging",
    detail: d => d?.whatsapp?.contacts + " contacts · " + d?.whatsapp?.total + " messages",
  },
  {
    key: "emailCampaigns", label: "Email Campaigns", desc: "Hexmail drip campaigns",
    icon: MailCheck, setupHref: "/hexmail", category: "Email",
    detail: d => (d?.email?.total ?? 0) + " campaign(s) · " + (d?.email?.active ?? 0) + " active",
  },
  {
    key: "agents", label: "Voice Agents", desc: "Agents created in workspace",
    icon: Bot, setupHref: "/my-agents", category: "Core",
    detail: d => (d?.agents?.length ?? 0) + " agent(s) total",
  },
  {
    key: "campaigns", label: "Call Campaigns", desc: "Outbound call campaigns",
    icon: Megaphone, setupHref: "/campaigns", category: "Outreach",
    detail: d => (d?.campaigns?.total ?? 0) + " campaign(s) · " + (d?.campaigns?.active ?? 0) + " active",
  },
  {
    key: "wati", label: "WATI Contacts", desc: "WhatsApp opted-in contact list",
    icon: Hash, setupHref: "/whatsapp", category: "Messaging",
    detail: d => (d?.whatsapp?.contacts ?? 0) + " opted-in contacts",
  },
];

const CATEGORIES = ["Core", "Voice", "Calendar", "Telephony", "Messaging", "Email", "Outreach"];

function HiveMindSystemHealth() {
  const fn = useServerFn(getHiveMindPlatformData);
  const qc = useQueryClient();
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["hivemind-data"],
    queryFn: () => fn(),
    staleTime: 60_000,
  });

  const sh = (data?.systemHealth ?? {}) as Record<string, boolean>;
  const connectedCount = Object.values(sh).filter(Boolean).length;
  const totalCount = Object.keys(sh).length;

  return (
    <HiveMindShell>
      <div className="px-6 py-5 max-w-5xl">

        {/* Header */}
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">System Health</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Status of all platform integrations and services
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["hivemind-data"] })}>
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isFetching && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-24 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-violet-400" />
            <span className="text-sm">Checking integrations…</span>
          </div>
        ) : (
          <div className="space-y-6">

            {/* Summary bar */}
            <div className="flex items-center gap-4 rounded-xl border border-white/[0.06] bg-card/60 px-5 py-4 flex-wrap">
              <div>
                <p className="text-2xl font-bold tabular-nums">
                  <span className={connectedCount === totalCount ? "text-emerald-400" : connectedCount > totalCount / 2 ? "text-amber-400" : "text-red-400"}>
                    {connectedCount}
                  </span>
                  <span className="text-muted-foreground">/{totalCount}</span>
                </p>
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-[0.1em]">Services connected</p>
              </div>
              <div className="flex-1 h-2 rounded-full bg-white/[0.06] overflow-hidden min-w-[100px]">
                <div
                  className={cn("h-full rounded-full transition-all",
                    connectedCount === totalCount ? "bg-emerald-500" : connectedCount > totalCount / 2 ? "bg-amber-500" : "bg-red-500"
                  )}
                  style={{ width: `${(connectedCount / Math.max(totalCount, 1)) * 100}%` }}
                />
              </div>
              <div className="flex gap-3 text-xs">
                <span className="text-emerald-400 font-medium">{connectedCount} connected</span>
                <span className="text-muted-foreground">·</span>
                <span className="text-red-400 font-medium">{totalCount - connectedCount} missing</span>
              </div>
            </div>

            {/* By category */}
            {CATEGORIES.map(cat => {
              const items = INTEGRATIONS.filter(i => i.category === cat);
              return (
                <div key={cat}>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-2">{cat}</p>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {items.map(integration => {
                      const ok = sh[integration.key] === true;
                      const Icon = integration.icon;
                      const detail = integration.detail?.(data) ?? "";
                      return (
                        <div
                          key={integration.key}
                          className={cn(
                            "rounded-xl border p-4 flex items-start gap-3 transition-colors",
                            ok ? "border-emerald-500/15 bg-emerald-500/[0.03]" : "border-red-500/10 bg-red-500/[0.03]",
                          )}
                        >
                          <div className={cn(
                            "h-9 w-9 rounded-lg flex items-center justify-center shrink-0",
                            ok ? "bg-emerald-500/15" : "bg-red-500/10",
                          )}>
                            <Icon className={cn("h-4 w-4", ok ? "text-emerald-400" : "text-red-400/70")} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 mb-0.5">
                              <p className="text-xs font-semibold">{integration.label}</p>
                              {ok
                                ? <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
                                : <XCircle className="h-3 w-3 text-red-400/70 shrink-0" />
                              }
                            </div>
                            <p className="text-[11px] text-muted-foreground leading-snug">{integration.desc}</p>
                            {ok && detail && (
                              <p className="text-[10px] text-emerald-400/70 mt-1">{detail}</p>
                            )}
                            {!ok && (
                              <Button asChild size="sm" variant="ghost" className="h-6 px-0 text-[11px] text-muted-foreground hover:text-foreground mt-1.5">
                                <Link to={integration.setupHref}>
                                  <Link2 className="mr-1 h-3 w-3" />
                                  Configure →
                                </Link>
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Phone numbers detail */}
            {(data?.phoneNumbers?.length ?? 0) > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground mb-2">Phone Number Status</p>
                <div className="rounded-xl border border-white/[0.06] overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-white/[0.06] bg-white/[0.015]">
                        {["Number", "Status", "Agent Assigned"].map(h => (
                          <th key={h} className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.04]">
                      {data.phoneNumbers.map((p: any) => (
                        <tr key={p.id} className="hover:bg-white/[0.015]">
                          <td className="px-4 py-2.5 font-mono text-xs">{p.phone_number}</td>
                          <td className="px-4 py-2.5">
                            {p.active !== false
                              ? <span className="text-emerald-400 text-xs">Active</span>
                              : <span className="text-red-400 text-xs">Disconnected</span>}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground">
                            {p.agent_id ? (
                              <span className="text-foreground">
                                {data.agents?.find((a: any) => a.id === p.agent_id)?.name ?? "Agent"}
                              </span>
                            ) : (
                              <span className="text-red-400/80">Unassigned</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

          </div>
        )}
      </div>
    </HiveMindShell>
  );
}
