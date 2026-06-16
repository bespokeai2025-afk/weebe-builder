import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Globe, Plus, RefreshCw, CheckCircle, XCircle, AlertTriangle,
  HelpCircle, Trash2, ChevronDown, ChevronUp, Copy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getSenderDomains, addSenderDomain, recheckDomainDns,
  deleteSenderDomain, updateDkimSelector,
} from "@/lib/hexmail/deliverability.server";

type DnsStatus = "pass" | "fail" | "warning" | "missing" | "unknown";

function StatusIcon({ status }: { status: DnsStatus }) {
  if (status === "pass")    return <CheckCircle  className="h-4 w-4 text-emerald-400" />;
  if (status === "fail")    return <XCircle      className="h-4 w-4 text-red-400" />;
  if (status === "warning") return <AlertTriangle className="h-4 w-4 text-amber-400" />;
  if (status === "missing") return <XCircle      className="h-4 w-4 text-red-400/70" />;
  return <HelpCircle className="h-4 w-4 text-muted-foreground/40" />;
}

function StatusBadge({ status, label }: { status: DnsStatus; label: string }) {
  const styles: Record<DnsStatus, string> = {
    pass:    "border-emerald-500/20 bg-emerald-500/5 text-emerald-400",
    fail:    "border-red-500/20 bg-red-500/5 text-red-400",
    warning: "border-amber-500/20 bg-amber-500/5 text-amber-400",
    missing: "border-red-500/20 bg-red-500/5 text-red-400/80",
    unknown: "border-white/10 bg-white/[0.02] text-muted-foreground/50",
  };
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium", styles[status])}>
      <StatusIcon status={status} />
      {label}
    </span>
  );
}

function DomainCard({ domain, onRecheck, onDelete }: { domain: any; onRecheck: () => void; onDelete: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [selector, setSelector] = useState(domain.dkim_selector ?? "");
  const [saving, setSaving] = useState(false);
  const updateFn = useServerFn(updateDkimSelector);
  const qc = useQueryClient();

  const health = domain.healthScore;
  const scoreColor = health.score >= 80 ? "text-emerald-400" : health.score >= 60 ? "text-amber-400" : "text-red-400";

  async function saveSelector() {
    setSaving(true);
    try {
      await updateFn({ data: { domainId: domain.id, selector } });
      await onRecheck();
      qc.invalidateQueries({ queryKey: ["sender-domains"] });
    } finally { setSaving(false); }
  }

  const DNS_ROWS = [
    { key: "spf",   label: "SPF",   status: domain.spf_status,   record: domain.spf_record },
    { key: "dkim",  label: "DKIM",  status: domain.dkim_status,  record: domain.dkim_record },
    { key: "dmarc", label: "DMARC", status: domain.dmarc_status, record: domain.dmarc_record },
    { key: "mx",    label: "MX",    status: domain.mx_status,    record: (domain.mx_records ?? []).join(", ") },
  ];

  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <Globe className="h-4 w-4 text-muted-foreground/50" />
          <div>
            <div className="text-sm font-medium">{domain.domain}</div>
            <div className="text-[11px] text-muted-foreground/40 capitalize">{domain.provider} · {domain.status}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-1.5">
            <StatusBadge status={domain.spf_status}   label="SPF" />
            <StatusBadge status={domain.dkim_status}  label="DKIM" />
            <StatusBadge status={domain.dmarc_status} label="DMARC" />
            <StatusBadge status={domain.mx_status}    label="MX" />
          </div>
          <span className={cn("text-sm font-bold tabular-nums", scoreColor)}>{health.score}/100</span>
          <div className="flex items-center gap-1">
            <button onClick={onRecheck} title="Re-check DNS"
              className="rounded-md p-1.5 hover:bg-white/[0.06] text-muted-foreground/50 hover:text-foreground transition-colors">
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
            <button onClick={onDelete} title="Delete domain"
              className="rounded-md p-1.5 hover:bg-red-500/10 text-muted-foreground/50 hover:text-red-400 transition-colors">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => setExpanded(v => !v)}
              className="rounded-md p-1.5 hover:bg-white/[0.06] text-muted-foreground/50 transition-colors">
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-white/[0.06] px-4 py-4 flex flex-col gap-4">
          {/* DKIM selector */}
          <div className="flex items-end gap-2 flex-wrap">
            <div className="flex-1 min-w-[180px]">
              <Label className="text-xs text-muted-foreground/60 mb-1 block">DKIM Selector</Label>
              <Input value={selector} onChange={(e) => setSelector(e.target.value)}
                placeholder="e.g. default, google, resend"
                className="h-8 text-xs bg-white/[0.03] border-white/[0.08]" />
            </div>
            <Button onClick={saveSelector} disabled={saving || !selector.trim()} size="sm" variant="outline"
              className="h-8 text-xs border-white/[0.08]">
              {saving ? "Saving…" : "Save & Re-check"}
            </Button>
          </div>

          {/* DNS rows */}
          <div className="flex flex-col gap-2">
            {DNS_ROWS.map((row) => (
              <div key={row.key} className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
                <div className="flex items-center gap-2 mb-1">
                  <StatusIcon status={row.status as DnsStatus} />
                  <span className="text-xs font-medium">{row.label}</span>
                  <span className={cn("text-[10px] capitalize ml-auto",
                    row.status === "pass" ? "text-emerald-400" : row.status === "warning" ? "text-amber-400" : "text-red-400"
                  )}>{row.status}</span>
                </div>
                {row.record && (
                  <div className="flex items-center gap-1 mt-1">
                    <code className="flex-1 text-[10px] text-muted-foreground/50 break-all font-mono">{row.record}</code>
                    <button onClick={() => navigator.clipboard.writeText(row.record ?? "")}
                      className="shrink-0 p-1 hover:text-foreground text-muted-foreground/30 transition-colors">
                      <Copy className="h-3 w-3" />
                    </button>
                  </div>
                )}
                {row.status !== "pass" && (
                  <p className="text-[10px] text-muted-foreground/40 mt-1.5">
                    {row.key === "spf"   && "Add a TXT record: v=spf1 include:yourmailprovider.com ~all"}
                    {row.key === "dkim"  && "Add a TXT record at selector._domainkey." + domain.domain + " from your email provider."}
                    {row.key === "dmarc" && "Add a TXT record at _dmarc." + domain.domain + ": v=DMARC1; p=quarantine; rua=mailto:dmarc@" + domain.domain}
                    {row.key === "mx"    && "Add MX records from your mail provider."}
                  </p>
                )}
              </div>
            ))}
          </div>

          {domain.dns_checked_at && (
            <p className="text-[10px] text-muted-foreground/30">
              Last checked: {new Date(domain.dns_checked_at).toLocaleString()}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function HexMailSenderDomains() {
  const [showAdd, setShowAdd]     = useState(false);
  const [domain, setDomain]       = useState("");
  const [provider, setProvider]   = useState("resend");
  const [selector, setSelector]   = useState("");
  const qc = useQueryClient();

  const getDomainsFn   = useServerFn(getSenderDomains);
  const addDomainFn    = useServerFn(addSenderDomain);
  const recheckFn      = useServerFn(recheckDomainDns);
  const deleteDomainFn = useServerFn(deleteSenderDomain);

  const { data: domains = [], isLoading } = useQuery({
    queryKey: ["sender-domains"],
    queryFn:  () => getDomainsFn(),
  });

  const addMut = useMutation({
    mutationFn: () => addDomainFn({ data: { domain, provider, dkimSelector: selector || undefined } }),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ["sender-domains"] }); setShowAdd(false); setDomain(""); setSelector(""); },
  });

  async function recheck(domainId: string) {
    await recheckFn({ data: { domainId } });
    qc.invalidateQueries({ queryKey: ["sender-domains"] });
  }

  async function remove(domainId: string) {
    if (!confirm("Delete this sender domain?")) return;
    await deleteDomainFn({ data: { domainId } });
    qc.invalidateQueries({ queryKey: ["sender-domains"] });
  }

  return (
    <div className="flex flex-col gap-6 p-6 max-w-4xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sender Domains</h1>
          <p className="text-sm text-muted-foreground mt-1">Verify DNS records (SPF, DKIM, DMARC, MX) for your sending domains.</p>
        </div>
        <Button onClick={() => setShowAdd(v => !v)} size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" /> Add Domain
        </Button>
      </div>

      {showAdd && (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5 flex flex-col gap-4">
          <h2 className="text-sm font-semibold">Add Sender Domain</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground/60 mb-1 block">Domain *</Label>
              <Input value={domain} onChange={(e) => setDomain(e.target.value)}
                placeholder="yourdomain.com" className="bg-white/[0.03] border-white/[0.08]" />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground/60 mb-1 block">Provider</Label>
              <select value={provider} onChange={(e) => setProvider(e.target.value)}
                className="w-full h-10 rounded-md border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-foreground">
                <option value="resend">Resend</option>
                <option value="sendgrid">SendGrid</option>
                <option value="postmark">Postmark</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs text-muted-foreground/60 mb-1 block">DKIM Selector (optional — e.g. "resend", "google")</Label>
              <Input value={selector} onChange={(e) => setSelector(e.target.value)}
                placeholder="resend" className="bg-white/[0.03] border-white/[0.08]" />
            </div>
          </div>
          {addMut.error && (
            <p className="text-xs text-red-400">{(addMut.error as any).message}</p>
          )}
          <div className="flex gap-2">
            <Button onClick={() => addMut.mutate()} disabled={!domain.trim() || addMut.isPending} size="sm">
              {addMut.isPending ? "Checking DNS…" : "Add & Verify"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowAdd(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[...Array(2)].map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-white/[0.03]" />
          ))}
        </div>
      ) : domains.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/[0.10] p-10 text-center flex flex-col items-center gap-2">
          <Globe className="h-8 w-8 text-muted-foreground/30" />
          <p className="text-sm font-medium">No sender domains added yet</p>
          <p className="text-xs text-muted-foreground/50">Add your first domain to verify DNS and start warming up.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {domains.map((d: any) => (
            <DomainCard key={d.id} domain={d}
              onRecheck={() => recheck(d.id)}
              onDelete={() => remove(d.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
