import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import {
  Mail, CheckCircle, XCircle, AlertTriangle, ArrowRight, Flame,
  Globe, MessageSquare, PhoneCall,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getEmailReadinessScore } from "@/lib/hexmail/deliverability.server";

function GradeRing({ score, grade }: { score: number; grade: string }) {
  const color = score >= 80 ? "#34d399" : score >= 60 ? "#f59e0b" : score >= 40 ? "#f97316" : "#f87171";
  const r = 44;
  const circ = 2 * Math.PI * r;
  const pct = score / 100;
  return (
    <div className="relative flex items-center justify-center w-28 h-28">
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
        <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="8"
          strokeDasharray={`${pct * circ} ${circ}`} strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.8s ease" }} />
      </svg>
      <div className="flex flex-col items-center">
        <span className="text-3xl font-bold" style={{ color }}>{score}</span>
        <span className="text-sm font-semibold text-muted-foreground/60">{grade}</span>
      </div>
    </div>
  );
}

export function GrowthMindEmailReadiness() {
  const getScoreFn = useServerFn(getEmailReadinessScore);
  const { data, isLoading } = useQuery({
    queryKey:  ["email-readiness"],
    queryFn:   () => getScoreFn(),
    staleTime: 60_000,
    throwOnError: false,
  });

  const score = data?.score  ?? 0;
  const grade = (data as any)?.grade ?? "F";
  const issues = (data as any)?.issues ?? [];
  const recommendations = (data as any)?.recommendations ?? [];

  const altChannels = score < 60 ? [
    { icon: PhoneCall,    label: "AI Calling",  sub: "High deliverability, no domain needed",  to: "/calls" },
    { icon: MessageSquare, label: "WhatsApp",   sub: "Direct channel, no spam filters",        to: "/whatsapp" },
  ] : [];

  return (
    <div className="flex flex-col gap-6 p-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Email Readiness</h1>
        <p className="text-sm text-muted-foreground mt-1">
          GrowthMind's assessment of your email sending readiness before launching campaigns.
        </p>
      </div>

      {/* Score card */}
      <div className="rounded-xl border border-white/[0.08] bg-gradient-to-br from-white/[0.03] to-transparent p-6 flex flex-col sm:flex-row items-center gap-6">
        {isLoading ? (
          <div className="w-28 h-28 animate-pulse rounded-full bg-white/[0.06]" />
        ) : (
          <GradeRing score={score} grade={grade} />
        )}
        <div className="flex flex-col gap-2 flex-1">
          <h2 className="text-lg font-semibold">
            {score >= 80 ? "Email Ready" : score >= 60 ? "Nearly Ready" : score >= 40 ? "Needs Attention" : "Not Ready for Bulk Email"}
          </h2>
          <p className="text-sm text-muted-foreground/60">
            {score >= 80
              ? "Your sender domain and mailboxes are well configured. You can run email campaigns safely."
              : score >= 60
              ? "Most DNS records are in place. Fix the remaining issues before sending large campaigns."
              : score >= 40
              ? "Several DNS records are missing or invalid. Sending now risks spam folders and blacklisting."
              : "Your domain is not yet configured for safe email sending. Use alternative channels for now."}
          </p>
          <div className="flex items-center gap-3 text-xs text-muted-foreground/50 mt-1">
            <span>{(data as any)?.domainCount ?? 0} domain{(data as any)?.domainCount !== 1 ? "s" : ""}</span>
            <span>·</span>
            <span>{(data as any)?.mailboxCount ?? 0} mailbox{(data as any)?.mailboxCount !== 1 ? "es" : ""}</span>
          </div>
        </div>
      </div>

      {/* Issues */}
      {issues.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">Issues Detected</h2>
          {issues.map((issue: string, i: number) => (
            <div key={i} className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2.5 text-xs text-red-400">
              <XCircle className="h-3.5 w-3.5 shrink-0" /> {issue}
            </div>
          ))}
        </div>
      )}

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">GrowthMind Recommendations</h2>
          {recommendations.map((rec: string, i: number) => (
            <div key={i} className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {rec}
            </div>
          ))}
        </div>
      )}

      {/* All clear */}
      {!isLoading && issues.length === 0 && score >= 80 && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-3 text-xs text-emerald-400">
          <CheckCircle className="h-4 w-4 shrink-0" />
          <span>All systems go. Your domain is ready for email campaigns.</span>
        </div>
      )}

      {/* Alternative channels */}
      {altChannels.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-3">Recommended Alternative Channels</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {altChannels.map((ch) => (
              <Link key={ch.to} to={ch.to}
                className="group flex items-center justify-between rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 hover:border-white/[0.12] transition-all">
                <div className="flex items-center gap-3">
                  <ch.icon className="h-4 w-4 text-muted-foreground/50 group-hover:text-foreground transition-colors" />
                  <div>
                    <div className="text-sm font-medium">{ch.label}</div>
                    <div className="text-[11px] text-muted-foreground/50">{ch.sub}</div>
                  </div>
                </div>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors" />
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Fix actions */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-3">Fix in HexMail</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { icon: Globe,  label: "DNS Records",   sub: "Verify SPF, DKIM, DMARC", to: "/hexmail/sender-domains" },
            { icon: Flame,  label: "Domain Warming", sub: "Warmup schedules",        to: "/hexmail/domain-warming" },
            { icon: Mail,   label: "Deliverability", sub: "Full dashboard",          to: "/hexmail/deliverability" },
          ].map((link) => (
            <Link key={link.to} to={link.to}
              className="group flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5 hover:border-white/[0.12] hover:bg-white/[0.04] transition-all">
              <link.icon className="h-4 w-4 text-muted-foreground/50 group-hover:text-foreground transition-colors" />
              <div>
                <div className="text-xs font-medium">{link.label}</div>
                <div className="text-[10px] text-muted-foreground/40">{link.sub}</div>
              </div>
              <ArrowRight className="h-3 w-3 text-muted-foreground/30 ml-auto group-hover:text-muted-foreground transition-colors" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
