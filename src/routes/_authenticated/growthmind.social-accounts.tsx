// GrowthMind → Social Accounts — Meta (Facebook Page / Instagram professional)
// connections. OAuth is server-driven; tokens are never visible here.
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Share2, Loader2, Plug, Unplug, CheckCircle2, AlertCircle, Instagram, Facebook, RefreshCw,
} from "lucide-react";
import { GrowthMindShell } from "@/components/growthmind/GrowthMindShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  getMetaSocialStatus, startMetaOAuth, disconnectMetaSocial,
} from "@/lib/growthmind/meta-oauth.functions";

export const Route = createFileRoute("/_authenticated/growthmind/social-accounts")({
  component: () => (
    <GrowthMindShell>
      <SocialAccountsPage />
    </GrowthMindShell>
  ),
});

function SocialAccountsPage() {
  const getStatusFn   = useServerFn(getMetaSocialStatus);
  const startOAuthFn  = useServerFn(startMetaOAuth);
  const disconnectFn  = useServerFn(disconnectMetaSocial);
  const qc = useQueryClient();

  const [connecting,     setConnecting]     = useState(false);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [appId,     setAppId]     = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [showCreds, setShowCreds] = useState(false);
  const [mounted,   setMounted]   = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["growthmind-social-status"],
    queryFn:  () => getStatusFn(),
    staleTime: 30_000,
    throwOnError: false,
  });

  const connections   = data?.connections ?? [];
  const activeConns   = connections.filter(c => c.status !== "disconnected");
  const hasCreds      = !!data?.hasAppId && !!data?.hasAppSecret;

  // Surface the OAuth redirect result once
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("meta");
    if (!result) return;
    if (result === "connected") {
      toast.success(`Meta connected — ${params.get("meta_count") ?? "1"} account(s) linked`);
      qc.invalidateQueries({ queryKey: ["growthmind-social-status"] });
    } else if (result === "error") {
      toast.error(params.get("meta_msg") ?? "Meta connection failed");
    }
    params.delete("meta"); params.delete("meta_msg"); params.delete("meta_count");
    const qs = params.toString();
    window.history.replaceState({}, "", window.location.pathname + (qs ? `?${qs}` : ""));
  }, [qc]);

  async function handleConnect() {
    setConnecting(true);
    try {
      const res = await startOAuthFn({ data: {
        origin:   window.location.origin,
        returnTo: "/growthmind/social-accounts",
        ...(appId.trim()     ? { appId:     appId.trim() }     : {}),
        ...(appSecret.trim() ? { appSecret: appSecret.trim() } : {}),
      }});
      if (res?.url) window.location.href = res.url;
      else throw new Error("No consent URL returned");
    } catch (err: any) {
      toast.error(err.message ?? "Could not start Meta sign-in");
      setConnecting(false);
    }
  }

  async function handleDisconnect(id: string, name: string) {
    if (!window.confirm(`Disconnect "${name}"? GrowthMind will no longer be able to publish or read insights for this account.`)) return;
    setDisconnectingId(id);
    try {
      await disconnectFn({ data: { connectionId: id } });
      await qc.invalidateQueries({ queryKey: ["growthmind-social-status"] });
      toast.success("Account disconnected");
    } catch (err: any) {
      toast.error(err.message ?? "Disconnect failed");
    } finally {
      setDisconnectingId(null);
    }
  }

  function expiryLabel(c: { token_expires_at: string | null }): string | null {
    if (!c.token_expires_at) return null;
    const days = Math.round((new Date(c.token_expires_at).getTime() - Date.now()) / 86400000);
    if (days < 0)  return "Token expired";
    if (days <= 7) return `Token expires in ${days} day${days === 1 ? "" : "s"}`;
    return `Token valid ~${days} days`;
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-emerald-500/15 flex items-center justify-center">
            <Share2 className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-base font-semibold">Social Accounts</h1>
            <p className="text-xs text-muted-foreground">Connect Instagram professional accounts and Facebook Pages so GrowthMind can analyse and (with your approval) publish content</p>
          </div>
        </div>
        <Button size="sm" onClick={handleConnect} disabled={connecting || (!hasCreds && (!appId.trim() || !appSecret.trim()))}
          className="gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-xs shrink-0">
          {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />}
          {activeConns.length > 0 ? "Reconnect with Meta" : "Connect with Meta"}
        </Button>
      </div>

      {/* App credentials */}
      <div className="rounded-xl border border-white/[0.06] bg-card/60 p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Meta App Credentials</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {hasCreds
                ? "App ID and Secret are saved for this workspace. Update them below if needed."
                : "Enter your Meta App ID and Secret (from developers.facebook.com) once — then connect with one click."}
            </p>
          </div>
          {hasCreds && (
            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" /> Saved
            </span>
          )}
        </div>
        {(!hasCreds || showCreds) ? (
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">App ID</Label>
              <Input value={appId} onChange={e => setAppId(e.target.value)} placeholder="e.g. 1234567890123456" className="bg-background/50 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">App Secret</Label>
              <Input type="password" value={appSecret} onChange={e => setAppSecret(e.target.value)} placeholder="••••••••••••••••" className="bg-background/50 text-sm" />
            </div>
          </div>
        ) : (
          <Button type="button" variant="ghost" size="sm" className="text-xs h-7" onClick={() => setShowCreds(true)}>
            Update credentials
          </Button>
        )}
        <p className="text-[11px] text-muted-foreground">
          Redirect URI for your Meta app settings: <code className="text-foreground/80">{mounted ? window.location.origin : ""}{data?.callbackPath ?? "/api/oauth/meta-callback"}</code>
        </p>
      </div>

      {/* Connections */}
      <div className="space-y-3">
        <p className="text-sm font-semibold">Connected accounts</p>
        {isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
        {!isLoading && activeConns.length === 0 && (
          <div className="rounded-xl border border-dashed border-white/[0.08] p-8 text-center">
            <p className="text-sm text-muted-foreground">No social accounts connected yet.</p>
            <p className="text-xs text-muted-foreground mt-1">Instagram must be a professional account linked to a Facebook Page.</p>
          </div>
        )}
        {activeConns.map(c => {
          const isIg   = c.account_type === "instagram_professional";
          const expiry = expiryLabel(c);
          const needsAttention = c.status !== "connected";
          return (
            <div key={c.id} className="rounded-xl border border-white/[0.06] bg-card/60 p-4 flex items-center gap-3">
              {c.profile_picture_url
                ? <img src={c.profile_picture_url} alt="" className="h-10 w-10 rounded-full object-cover" />
                : <div className="h-10 w-10 rounded-full bg-white/[0.06] flex items-center justify-center">
                    {isIg ? <Instagram className="h-5 w-5 text-pink-400" /> : <Facebook className="h-5 w-5 text-blue-400" />}
                  </div>}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium truncate">{c.account_name ?? c.external_account_id}</p>
                  {c.username && <span className="text-xs text-muted-foreground">@{c.username}</span>}
                </div>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <span className="text-[11px] text-muted-foreground">{isIg ? "Instagram professional" : c.account_type === "facebook_page" ? "Facebook Page" : c.account_type}</span>
                  <span className={cn("inline-flex items-center gap-1 text-[11px]",
                    needsAttention ? "text-amber-400" : "text-emerald-400")}>
                    {needsAttention ? <AlertCircle className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                    {c.status.replace(/_/g, " ")}
                  </span>
                  {expiry && <span className="text-[11px] text-muted-foreground">· {expiry}</span>}
                  {(c.capabilities as any)?.publishing && <span className="text-[11px] text-muted-foreground">· publishing</span>}
                  {(c.capabilities as any)?.analytics && <span className="text-[11px] text-muted-foreground">· insights</span>}
                </div>
                {(c.permissions as any)?.length > 0 && (
                  <div className="flex items-center gap-1 mt-1 flex-wrap">
                    <span className="text-[10px] text-muted-foreground">Permissions:</span>
                    {(c.permissions as string[]).map(p => (
                      <span key={p} className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.05] text-muted-foreground">{p}</span>
                    ))}
                  </div>
                )}
                <p className="text-[10px] text-muted-foreground mt-1">
                  Last sync: {c.last_sync_at ? (mounted ? new Date(c.last_sync_at).toLocaleString() : "") : "never"}
                </p>
                {c.last_error && <p className="text-[11px] text-amber-400 mt-1 truncate">{c.last_error}</p>}
              </div>
              {needsAttention && (
                <Button type="button" variant="ghost" size="sm" onClick={handleConnect} disabled={connecting}
                  className="text-xs gap-1 shrink-0">
                  <RefreshCw className="h-3 w-3" /> Reconnect
                </Button>
              )}
              <Button type="button" variant="ghost" size="sm"
                onClick={() => handleDisconnect(c.id, c.account_name ?? c.external_account_id)}
                disabled={disconnectingId === c.id}
                className="text-xs gap-1 text-muted-foreground hover:text-red-400 shrink-0">
                {disconnectingId === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unplug className="h-3 w-3" />}
                Disconnect
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
