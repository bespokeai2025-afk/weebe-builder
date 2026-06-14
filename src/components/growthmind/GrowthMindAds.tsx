import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  BarChart2, Plus, Loader2, RefreshCw, Trash2, Edit2,
  X, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2,
  Eye, EyeOff, Lightbulb, TrendingUp, Link as LinkIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { GrowthMindShell } from "./GrowthMindShell";
import {
  getAdsAccounts,
  saveAdsAccount,
  deleteAdsAccount,
  getAdsCampaigns,
  saveAdsCampaign,
  deleteAdsCampaign,
  getAdsRecommendations,
  type AdsPlatform,
  type AdsAccount,
  type AdsCampaign,
} from "@/lib/growthmind/growthmind.ads";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { HiveMindReportBanner } from "./HiveMindReportBanner";

// ── Platform config ─────────────────────────────────────────────────────────────

const PLATFORMS: {
  id: AdsPlatform; label: string;
  color: string; bg: string; border: string;
  activeBorder: string; desc: string;
}[] = [
  {
    id: "google", label: "Google Ads",
    color: "text-blue-400", bg: "bg-blue-500/10", border: "border-blue-500/20",
    activeBorder: "border-blue-500/40",
    desc: "Search, Display & YouTube",
  },
  {
    id: "meta", label: "Meta Ads",
    color: "text-indigo-400", bg: "bg-indigo-500/10", border: "border-indigo-500/20",
    activeBorder: "border-indigo-500/40",
    desc: "Facebook & Instagram",
  },
  {
    id: "linkedin", label: "LinkedIn Ads",
    color: "text-sky-400", bg: "bg-sky-500/10", border: "border-sky-500/20",
    activeBorder: "border-sky-500/40",
    desc: "B2B lead generation",
  },
  {
    id: "tiktok", label: "TikTok Ads",
    color: "text-pink-400", bg: "bg-pink-500/10", border: "border-pink-500/20",
    activeBorder: "border-pink-500/40",
    desc: "Short-form video & content",
  },
];

function getPlatform(id: AdsPlatform) {
  return PLATFORMS.find(p => p.id === id) ?? PLATFORMS[0];
}

// ── Account Connect / Edit Modal ────────────────────────────────────────────────

interface AccountModalProps {
  initial?:          AdsAccount | null;
  defaultPlatform?:  AdsPlatform;
  onClose:           () => void;
  onSave:            (vals: { id?: string; platform: AdsPlatform; label: string; account_id: string; token?: string }) => Promise<void>;
  saving:            boolean;
}

function AccountModal({ initial, defaultPlatform = "google", onClose, onSave, saving }: AccountModalProps) {
  const [platform,  setPlatform]  = useState<AdsPlatform>(initial?.platform ?? defaultPlatform);
  const [label,     setLabel]     = useState(initial?.label ?? "");
  const [accountId, setAccountId] = useState(initial?.account_id ?? "");
  const [token,     setToken]     = useState("");
  const [showToken, setShowToken] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || !accountId.trim()) return;
    await onSave({ id: initial?.id, platform, label: label.trim(), account_id: accountId.trim(), token: token.trim() || undefined });
  }

  const isEdit = !!initial?.id;
  const p = getPlatform(platform);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl border border-white/[0.09] bg-[hsl(var(--card))] shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.07] flex items-center justify-between">
          <p className="text-sm font-semibold">{isEdit ? "Edit Ad Account" : "Connect Ad Account"}</p>
          <button onClick={onClose} className="p-1 rounded text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          {/* Platform picker */}
          <div>
            <label className="block text-xs text-muted-foreground mb-1.5">Platform</label>
            <div className="grid grid-cols-2 gap-2">
              {PLATFORMS.map(pl => (
                <button
                  key={pl.id} type="button" onClick={() => setPlatform(pl.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-all text-left",
                    platform === pl.id
                      ? `${pl.bg} ${pl.activeBorder} ${pl.color}`
                      : "border-white/[0.08] text-muted-foreground hover:text-foreground hover:border-white/20",
                  )}
                >
                  <span className={cn("h-2 w-2 rounded-full shrink-0", pl.bg, "ring-1", pl.border)} />
                  {pl.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-muted-foreground mb-1.5">Account Label</label>
            <input type="text" value={label} onChange={e => setLabel(e.target.value)}
              placeholder={`e.g. Main ${p.label} Account`}
              className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-emerald-500/30" required />
          </div>

          <div>
            <label className="block text-xs text-muted-foreground mb-1.5">Account ID / Customer ID</label>
            <input type="text" value={accountId} onChange={e => setAccountId(e.target.value)}
              placeholder="e.g. 123-456-7890"
              className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-emerald-500/30" required />
          </div>

          <div>
            <label className="block text-xs text-muted-foreground mb-1.5">
              API Token / Access Token{" "}
              {isEdit && initial?.has_token && <span className="text-emerald-400/60">(leave blank to keep existing)</span>}
            </label>
            <div className="relative">
              <input type={showToken ? "text" : "password"} value={token} onChange={e => setToken(e.target.value)}
                placeholder={isEdit && initial?.has_token ? "••••••••••••" : "Enter API token (encrypted at rest)"}
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 pr-9 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-emerald-500/30" />
              <button type="button" onClick={() => setShowToken(s => !s)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 hover:text-muted-foreground">
                {showToken ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground/50 mt-1">Encrypted with AES-256-GCM before storage — never returned to the browser</p>
          </div>

          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white gap-1.5"
              disabled={saving || !label.trim() || !accountId.trim()}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isEdit ? "Save Changes" : "Connect Account"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Campaign Form Modal ─────────────────────────────────────────────────────────

interface CampaignModalProps {
  account:  AdsAccount;
  initial?: AdsCampaign | null;
  onClose:  () => void;
  onSave:   (vals: any) => Promise<void>;
  saving:   boolean;
}

function CampaignModal({ account, initial, onClose, onSave, saving }: CampaignModalProps) {
  const [name,        setName]        = useState(initial?.name ?? "");
  const [status,      setStatus]      = useState<"active"|"paused"|"ended">(initial?.status ?? "active");
  const [spend,       setSpend]       = useState(initial?.spend?.toString() ?? "");
  const [impressions, setImpressions] = useState(initial?.impressions?.toString() ?? "");
  const [clicks,      setClicks]      = useState(initial?.clicks?.toString() ?? "");
  const [conversions, setConversions] = useState(initial?.conversions?.toString() ?? "");
  const [roas,        setRoas]        = useState(initial?.roas?.toString() ?? "");
  const [periodStart, setPeriodStart] = useState(initial?.period_start?.slice(0, 10) ?? "");
  const [periodEnd,   setPeriodEnd]   = useState(initial?.period_end?.slice(0, 10) ?? "");

  const p = getPlatform(account.platform);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    await onSave({
      id:             initial?.id,
      ads_account_id: account.id,
      platform:       account.platform,
      name:           name.trim(),
      status,
      spend:          parseFloat(spend) || 0,
      impressions:    parseInt(impressions) || 0,
      clicks:         parseInt(clicks) || 0,
      conversions:    parseInt(conversions) || 0,
      roas:           roas ? parseFloat(roas) : null,
      period_start:   periodStart || null,
      period_end:     periodEnd || null,
    });
  }

  const spendNum = parseFloat(spend) || 0;
  const convNum  = parseInt(conversions) || 0;
  const impNum   = parseInt(impressions) || 0;
  const clkNum   = parseInt(clicks) || 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl border border-white/[0.09] bg-[hsl(var(--card))] shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.07] flex items-center gap-3 justify-between">
          <div className="flex items-center gap-2">
            <span className={cn("h-2 w-2 rounded-full", p.bg, "ring-1", p.border)} />
            <p className="text-sm font-semibold">{initial?.id ? "Edit Campaign" : "Log Campaign"}</p>
            <span className={cn("text-xs", p.color)}>{account.label}</span>
          </div>
          <button onClick={onClose} className="p-1 rounded text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <form onSubmit={submit} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs text-muted-foreground mb-1.5">Campaign Name</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Lead Gen Q1 2025"
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-emerald-500/30" required />
            </div>

            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">Status</label>
              <select value={status} onChange={e => setStatus(e.target.value as any)}
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm focus:outline-none focus:border-emerald-500/30">
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="ended">Ended</option>
              </select>
            </div>

            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">Total Spend (£)</label>
              <input type="number" value={spend} onChange={e => setSpend(e.target.value)} placeholder="0.00" min="0" step="0.01"
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-emerald-500/30" />
            </div>

            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">Impressions</label>
              <input type="number" value={impressions} onChange={e => setImpressions(e.target.value)} placeholder="0" min="0"
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-emerald-500/30" />
            </div>

            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">Clicks</label>
              <input type="number" value={clicks} onChange={e => setClicks(e.target.value)} placeholder="0" min="0"
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-emerald-500/30" />
            </div>

            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">Conversions / Leads</label>
              <input type="number" value={conversions} onChange={e => setConversions(e.target.value)} placeholder="0" min="0"
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-emerald-500/30" />
            </div>

            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">ROAS (optional)</label>
              <input type="number" value={roas} onChange={e => setRoas(e.target.value)} placeholder="e.g. 3.2" min="0" step="0.1"
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-emerald-500/30" />
            </div>

            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">Period Start</label>
              <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)}
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm focus:outline-none focus:border-emerald-500/30" />
            </div>

            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">Period End</label>
              <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)}
                className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm focus:outline-none focus:border-emerald-500/30" />
            </div>
          </div>

          {/* Live CPL / CTR preview */}
          {(spendNum > 0 && convNum > 0) && (
            <div className="rounded-lg bg-emerald-500/[0.06] border border-emerald-500/15 px-3 py-2 flex items-center gap-2">
              <TrendingUp className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              <span className="text-xs text-emerald-300">
                CPL: <strong>£{(spendNum / convNum).toFixed(2)}</strong>
                {impNum > 0 && clkNum > 0 && ` · CTR: ${((clkNum / impNum) * 100).toFixed(2)}%`}
              </span>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={saving}>Cancel</Button>
            <Button type="submit" className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white gap-1.5" disabled={saving || !name.trim()}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Save Campaign
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Inline account detail (campaigns table + AI analysis) ──────────────────────

function AccountDetail({ account, onEdit, onDelete }: {
  account:  AdsAccount;
  onEdit:   (a: AdsAccount) => void;
  onDelete: (id: string) => void;
}) {
  const campaignsFn         = useServerFn(getAdsCampaigns);
  const saveAdsCampaignFn   = useServerFn(saveAdsCampaign);
  const deleteAdsCampaignFn = useServerFn(deleteAdsCampaign);
  const getRecosFn          = useServerFn(getAdsRecommendations);

  const [campaignModal,  setCampaignModal]  = useState<{ open: boolean; editing: AdsCampaign | null }>({ open: false, editing: null });
  const [savingCampaign, setSavingCampaign] = useState(false);
  const [showRecos,      setShowRecos]      = useState(false);
  const [recos,          setRecos]          = useState<{ priority: string; title: string; detail: string }[]>([]);
  const [recosLoading,   setRecosLoading]   = useState(false);

  const p = getPlatform(account.platform);

  const { data: campaignsData, isLoading: campaignsLoading, refetch: refetchCampaigns } = useQuery({
    queryKey: ["ads-campaigns", account.id],
    queryFn:  () => campaignsFn({ data: { accountId: account.id } }),
    staleTime: 30_000,
  });

  const campaigns = campaignsData?.campaigns ?? [];
  const totalSpend       = campaigns.reduce((s, c) => s + Number(c.spend ?? 0), 0);
  const totalConversions = campaigns.reduce((s, c) => s + Number(c.conversions ?? 0), 0);
  const totalClicks      = campaigns.reduce((s, c) => s + Number(c.clicks ?? 0), 0);
  const totalImpressions = campaigns.reduce((s, c) => s + Number(c.impressions ?? 0), 0);
  const blendedCPL       = totalConversions > 0 ? totalSpend / totalConversions : null;
  const avgROAS          = (() => {
    const withRoas = campaigns.filter(c => c.roas != null);
    return withRoas.length ? withRoas.reduce((s, c) => s + Number(c.roas), 0) / withRoas.length : null;
  })();

  async function handleSaveCampaign(vals: any) {
    setSavingCampaign(true);
    try {
      await saveAdsCampaignFn({ data: vals });
      await refetchCampaigns();
      setCampaignModal({ open: false, editing: null });
      toast.success("Campaign saved");
    } catch (e: any) {
      toast.error("Failed to save campaign", { description: e.message });
    } finally {
      setSavingCampaign(false);
    }
  }

  async function handleDeleteCampaign(id: string) {
    try {
      await deleteAdsCampaignFn({ data: { id } });
      await refetchCampaigns();
      toast.success("Campaign removed");
    } catch {
      toast.error("Failed to remove campaign");
    }
  }

  async function loadRecos() {
    if (showRecos) { setShowRecos(false); return; }
    setShowRecos(true);
    setRecosLoading(true);
    try {
      const r = await getRecosFn({ data: { accounts: [account], campaigns } });
      setRecos(r.recommendations);
    } catch {
      setRecos([]);
    } finally {
      setRecosLoading(false);
    }
  }

  return (
    <div className="border-t border-white/[0.06]">
      {/* Metrics bar */}
      {totalSpend > 0 && (
        <div className="px-4 py-3 grid grid-cols-3 sm:grid-cols-6 gap-3 bg-white/[0.01]">
          {[
            { label: "Spend",       value: `£${totalSpend.toFixed(2)}` },
            { label: "Impressions", value: totalImpressions >= 1000 ? `${(totalImpressions / 1000).toFixed(1)}k` : totalImpressions.toString() },
            { label: "Clicks",      value: totalClicks.toString() },
            { label: "Conversions", value: totalConversions.toString() },
            { label: "CPL",         value: blendedCPL != null ? `£${blendedCPL.toFixed(2)}` : "—" },
            { label: "Avg ROAS",    value: avgROAS != null ? `${avgROAS.toFixed(2)}×` : "—" },
          ].map(m => (
            <div key={m.label} className="text-center">
              <p className="text-sm font-bold tabular-nums">{m.value}</p>
              <p className="text-[10px] text-muted-foreground">{m.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Campaign table header */}
      <div className="px-4 py-2.5 flex items-center justify-between border-t border-white/[0.05]">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-[0.08em]">
          Campaigns ({campaigns.length})
        </p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-6 text-[11px] gap-1" onClick={loadRecos} disabled={recosLoading}>
            <Lightbulb className="h-3 w-3" />
            {showRecos ? "Hide Analysis" : "AI Analysis"}
          </Button>
          <Button size="sm" className="h-6 text-[11px] gap-1 bg-emerald-600 hover:bg-emerald-500 text-white"
            onClick={() => setCampaignModal({ open: true, editing: null })}>
            <Plus className="h-3 w-3" />
            Log Campaign
          </Button>
        </div>
      </div>

      {/* Campaigns */}
      {campaignsLoading ? (
        <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
          <span className="text-xs">Loading campaigns…</span>
        </div>
      ) : campaigns.length === 0 ? (
        <div className="px-4 pb-6 pt-2 text-center">
          <p className="text-xs text-muted-foreground mb-3">No campaigns logged yet — manually log spend & performance data to start tracking</p>
          <Button size="sm" variant="outline" onClick={() => setCampaignModal({ open: true, editing: null })} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            Log First Campaign
          </Button>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[600px] text-xs">
            <thead>
              <tr className="border-y border-white/[0.04] bg-white/[0.02]">
                {["Campaign", "Status", "Spend", "Impr.", "Clicks", "Conv.", "CPL", "ROAS", ""].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.08em] first:pl-4 last:pr-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.03]">
              {campaigns.map(c => {
                const cpl = c.cpl ?? (Number(c.conversions) > 0 ? Number(c.spend) / Number(c.conversions) : null);
                return (
                  <tr key={c.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-4 py-2.5 font-medium max-w-[160px] truncate">{c.name}</td>
                    <td className="px-3 py-2.5">
                      <span className={cn(
                        "rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase",
                        c.status === "active"  ? "bg-emerald-500/10 text-emerald-400" :
                        c.status === "paused"  ? "bg-amber-500/10 text-amber-400" :
                                                 "bg-slate-500/10 text-slate-400",
                      )}>{c.status}</span>
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">£{Number(c.spend ?? 0).toFixed(2)}</td>
                    <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                      {Number(c.impressions) >= 1000 ? `${(Number(c.impressions) / 1000).toFixed(1)}k` : c.impressions}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">{c.clicks}</td>
                    <td className="px-3 py-2.5 tabular-nums font-medium">{c.conversions}</td>
                    <td className="px-3 py-2.5 tabular-nums">{cpl != null ? `£${cpl.toFixed(2)}` : "—"}</td>
                    <td className="px-3 py-2.5 tabular-nums">{c.roas != null ? `${Number(c.roas).toFixed(2)}×` : "—"}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1">
                        <button onClick={() => setCampaignModal({ open: true, editing: c })} className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors">
                          <Edit2 className="h-3 w-3" />
                        </button>
                        <button onClick={() => handleDeleteCampaign(c.id)} className="p-1 rounded text-muted-foreground hover:text-red-400 transition-colors">
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* AI recommendations */}
      {showRecos && (
        <div className="border-t border-white/[0.06] px-4 py-4">
          <p className="text-xs font-semibold mb-3 flex items-center gap-1.5">
            <Lightbulb className="h-3.5 w-3.5 text-emerald-400" />
            GrowthMind Analysis
            {recosLoading && <Loader2 className="h-3 w-3 animate-spin text-emerald-400 ml-1" />}
          </p>
          {recosLoading ? (
            <p className="text-xs text-muted-foreground">Analysing campaign data…</p>
          ) : recos.length === 0 ? (
            <p className="text-xs text-muted-foreground">No recommendations yet. Log some campaign data first.</p>
          ) : (
            <div className="space-y-2">
              {recos.map((r, i) => (
                <div key={i} className={cn(
                  "rounded-lg border px-3 py-2.5 flex items-start gap-2.5",
                  r.priority === "high"   ? "border-orange-500/20 bg-orange-500/[0.05]" :
                  r.priority === "medium" ? "border-amber-500/15 bg-amber-500/[0.04]" :
                                           "border-white/[0.06] bg-white/[0.02]",
                )}>
                  <AlertTriangle className={cn(
                    "h-3.5 w-3.5 shrink-0 mt-0.5",
                    r.priority === "high"   ? "text-orange-400" :
                    r.priority === "medium" ? "text-amber-400" : "text-slate-400",
                  )} />
                  <div>
                    <p className="text-xs font-semibold leading-snug">{r.title}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{r.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Campaign modal */}
      {campaignModal.open && (
        <CampaignModal
          account={account}
          initial={campaignModal.editing}
          onClose={() => setCampaignModal({ open: false, editing: null })}
          onSave={handleSaveCampaign}
          saving={savingCampaign}
        />
      )}
    </div>
  );
}

// ── Platform Card — always shown for all 4 platforms ───────────────────────────

function PlatformCard({ platform, accounts, onConnect, onEdit, onDelete }: {
  platform:  typeof PLATFORMS[0];
  accounts:  AdsAccount[];
  onConnect: (platformId: AdsPlatform) => void;
  onEdit:    (a: AdsAccount) => void;
  onDelete:  (id: string) => void;
}) {
  const connected = accounts.length > 0;
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={cn(
      "rounded-xl border overflow-hidden bg-card/60 transition-colors",
      connected ? platform.activeBorder : platform.border,
    )}>
      {/* Platform header */}
      <div className="px-4 py-3.5 flex items-center gap-3">
        <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg shrink-0", platform.bg)}>
          <BarChart2 className={cn("h-4.5 w-4.5", platform.color)} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold">{platform.label}</p>
            {connected ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                <CheckCircle2 className="h-2.5 w-2.5" />
                {accounts.length} account{accounts.length !== 1 ? "s" : ""}
              </span>
            ) : (
              <span className="rounded-full bg-white/[0.05] px-1.5 py-0.5 text-[10px] text-muted-foreground/60">
                Not connected
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">{platform.desc}</p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => onConnect(platform.id)}>
            <Plus className="h-3 w-3" />
            {connected ? "Add" : "Connect"}
          </Button>
          {connected && (
            <button onClick={() => setExpanded(e => !e)}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-colors">
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
      </div>

      {/* Expanded: list of accounts with campaign detail */}
      {expanded && connected && (
        <div className="border-t border-white/[0.06] divide-y divide-white/[0.04]">
          {accounts.map(acct => (
            <div key={acct.id}>
              {/* Account sub-header */}
              <div className="px-4 py-2.5 flex items-center gap-2 bg-white/[0.015]">
                <LinkIcon className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-medium">{acct.label}</span>
                  <span className="text-[10px] text-muted-foreground ml-2">ID: {acct.account_id}</span>
                  {acct.has_token && (
                    <span className="text-[10px] text-emerald-400/60 ml-2 inline-flex items-center gap-0.5">
                      <CheckCircle2 className="h-2.5 w-2.5" /> token
                    </span>
                  )}
                </div>
                <span className={cn(
                  "text-[10px] rounded-full px-1.5 py-0.5 font-medium",
                  acct.status === "active"       ? "bg-emerald-500/10 text-emerald-400" :
                  acct.status === "paused"       ? "bg-amber-500/10 text-amber-400" :
                                                   "bg-slate-500/10 text-slate-400",
                )}>{acct.status}</span>
                <button onClick={() => onEdit(acct)} className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors">
                  <Edit2 className="h-3 w-3" />
                </button>
                <button onClick={() => onDelete(acct.id)} className="p-1 rounded text-muted-foreground hover:text-red-400 transition-colors">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>

              {/* Campaigns & AI for this account */}
              <AccountDetail account={acct} onEdit={onEdit} onDelete={onDelete} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────────

export function GrowthMindAds() {
  const accountsFn    = useServerFn(getAdsAccounts);
  const saveAccountFn = useServerFn(saveAdsAccount);
  const deleteAcctFn  = useServerFn(deleteAdsAccount);

  const [accountModal,  setAccountModal]  = useState<{ open: boolean; editing: AdsAccount | null; defaultPlatform?: AdsPlatform }>({ open: false, editing: null });
  const [savingAccount, setSavingAccount] = useState(false);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["ads-accounts"],
    queryFn:  () => accountsFn(),
    staleTime: 30_000,
  });

  const accounts = data?.accounts ?? [];

  async function handleSaveAccount(vals: any) {
    setSavingAccount(true);
    try {
      await saveAccountFn({ data: vals });
      await refetch();
      setAccountModal({ open: false, editing: null });
      toast.success(vals.id ? "Account updated" : "Account connected");
    } catch (e: any) {
      toast.error("Failed to save account", { description: e.message });
    } finally {
      setSavingAccount(false);
    }
  }

  async function handleDeleteAccount(id: string) {
    try {
      await deleteAcctFn({ data: { id } });
      await refetch();
      toast.success("Account disconnected");
    } catch {
      toast.error("Failed to disconnect account");
    }
  }

  // Group accounts by platform
  const accountsByPlatform = PLATFORMS.reduce<Record<AdsPlatform, AdsAccount[]>>((acc, p) => {
    acc[p.id] = accounts.filter(a => a.platform === p.id);
    return acc;
  }, { google: [], meta: [], linkedin: [], tiktok: [] });

  const totalConnected = accounts.length;

  return (
    <GrowthMindShell>
      <div className="px-6 py-5 max-w-4xl">

        {/* Header */}
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <BarChart2 className="h-5 w-5 text-emerald-400" />
              Ads Intelligence
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {totalConnected > 0
                ? `${totalConnected} account${totalConnected !== 1 ? "s" : ""} connected · Track spend, CPL & ROAS across all platforms`
                : "Track paid ad performance across Google, Meta, LinkedIn, and TikTok"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isFetching && "animate-spin")} />
              Refresh
            </Button>
            <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500 text-white gap-1.5"
              onClick={() => setAccountModal({ open: true, editing: null })}>
              <Plus className="h-3.5 w-3.5" />
              Connect Account
            </Button>
          </div>
        </div>

        <HiveMindReportBanner domain="Ads" />

        {isLoading ? (
          <div className="flex items-center justify-center py-24 gap-2 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
            <span className="text-sm">Loading ad accounts…</span>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Always show all 4 platform cards */}
            {PLATFORMS.map(p => (
              <PlatformCard
                key={p.id}
                platform={p}
                accounts={accountsByPlatform[p.id]}
                onConnect={platformId => setAccountModal({ open: true, editing: null, defaultPlatform: platformId })}
                onEdit={a => setAccountModal({ open: true, editing: a })}
                onDelete={handleDeleteAccount}
              />
            ))}

            {/* Info note */}
            <div className="rounded-xl border border-emerald-500/15 bg-emerald-500/[0.04] p-4 mt-2">
              <p className="text-xs text-muted-foreground leading-relaxed">
                <span className="text-emerald-400 font-medium">Note:</span> Live API syncing is coming soon. Log campaign stats manually to track CPL and ROAS now. Tokens are encrypted with AES-256-GCM before storage and never returned to the browser.
              </p>
            </div>
          </div>
        )}

        {/* Account modal */}
        {accountModal.open && (
          <AccountModal
            initial={accountModal.editing}
            defaultPlatform={accountModal.defaultPlatform}
            onClose={() => setAccountModal({ open: false, editing: null })}
            onSave={handleSaveAccount}
            saving={savingAccount}
          />
        )}

      </div>
    </GrowthMindShell>
  );
}
