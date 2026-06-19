import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listTokens, createToken, revokeToken } from "@/lib/workspace/api-tokens.functions";
import { getCacheHealth, flushWorkspaceCache } from "@/lib/cache/cache-health.functions";
import { getMyAdminStatus } from "@/lib/auth/auth.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Copy, Eye, EyeOff, Plus, Trash2, Key, Webhook, BookOpen, CheckCircle2, AlertCircle, Globe, Lock, Database, RefreshCw, Flame } from "lucide-react";
import { format } from "date-fns";

export const Route = createFileRoute("/_authenticated/settings/developer")({
  component: DeveloperPage,
});

const PERMISSION_OPTIONS = [
  { value: "leads:read",       label: "Read Leads",         desc: "List and retrieve leads" },
  { value: "leads:write",      label: "Write Leads",        desc: "Create and update leads" },
  { value: "calls:read",       label: "Read Calls",         desc: "List call logs" },
  { value: "calls:trigger",    label: "Trigger Calls",      desc: "Initiate AI calls" },
  { value: "agents:read",      label: "Read Agents",        desc: "List agents" },
  { value: "campaigns:trigger",label: "Trigger Campaigns",  desc: "Enrol leads in campaigns" },
  { value: "knowledge:write",  label: "Write Knowledge",    desc: "Upload documents" },
  { value: "webhooks:manage",  label: "Manage Webhooks",    desc: "Create and manage webhooks" },
];

const API_BASE = typeof window !== "undefined"
  ? `${window.location.protocol}//${window.location.host}/api/v1`
  : "/api/v1";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
    >
      {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
    </Button>
  );
}

function ApiKeyCard({ token, onRevoke }: { token: any; onRevoke: (id: string) => void }) {
  const isRevoked = !!token.revoked_at;
  return (
    <div className={`flex items-center gap-3 p-4 rounded-lg border ${isRevoked ? "opacity-50 bg-muted/30" : "bg-card"}`}>
      <Key className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{token.name}</span>
          {isRevoked && <Badge variant="destructive" className="text-[10px]">Revoked</Badge>}
        </div>
        <div className="flex items-center gap-2 mt-1">
          <code className="text-xs text-muted-foreground font-mono">{token.prefix}…</code>
          <span className="text-xs text-muted-foreground">
            Created {format(new Date(token.created_at), "MMM d, yyyy")}
          </span>
          {token.last_used_at && (
            <span className="text-xs text-muted-foreground">
              · Last used {format(new Date(token.last_used_at), "MMM d, yyyy")}
            </span>
          )}
        </div>
      </div>
      {!isRevoked && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Revoke API Key</AlertDialogTitle>
              <AlertDialogDescription>
                This will immediately revoke <strong>{token.name}</strong>. Any systems using this key will stop working. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => onRevoke(token.id)}
              >
                Revoke Key
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

function CodeBlock({ code, language = "bash" }: { code: string; language?: string }) {
  return (
    <div className="relative group">
      <pre className="bg-zinc-950 text-zinc-100 rounded-lg p-4 text-xs overflow-x-auto">
        <code>{code}</code>
      </pre>
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <CopyButton text={code} />
      </div>
    </div>
  );
}

function CacheHealthCard() {
  const healthFn = useServerFn(getCacheHealth);
  const flushFn  = useServerFn(flushWorkspaceCache);
  const adminFn  = useServerFn(getMyAdminStatus);
  const qc = useQueryClient();

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["cache-health"],
    queryFn: () => healthFn(),
    refetchInterval: 60_000,
    throwOnError: false,
  });

  const { data: adminData } = useQuery({
    queryKey: ["my-admin-status"],
    queryFn: () => adminFn(),
    throwOnError: false,
  });
  const isAdmin = adminData?.isAdmin === true;

  const flushMutation = useMutation({
    mutationFn: () => flushFn(),
    onSuccess: (result: any) => {
      const count = result?.deletedCount ?? 0;
      toast.success(count > 0 ? `Flushed ${count} cache key${count !== 1 ? "s" : ""}` : "Cache was already empty");
      qc.invalidateQueries({ queryKey: ["cache-health"] });
    },
    onError: () => toast.error("Failed to flush cache"),
  });

  const isConnected = data?.connected === true;
  const isConfigured = data?.configured !== false;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm">Cache Health</CardTitle>
          </div>
          <div className="flex items-center gap-1">
            {isConnected && isAdmin && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-destructive hover:text-destructive hover:bg-destructive/10 text-xs"
                    disabled={flushMutation.isPending}
                  >
                    <Flame className="h-3.5 w-3.5 mr-1" />
                    Flush Cache
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Flush Workspace Cache?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will delete all Redis cache keys for your workspace. Cached data will be re-fetched on the next request — there is no data loss, but responses may be slower until the cache warms up again.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() => flushMutation.mutate()}
                    >
                      Flush Cache
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
        <CardDescription>Upstash Redis cache layer used for rate limiting and data caching.</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            Checking cache…
          </div>
        ) : !isConfigured ? (
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/40" />
            <span className="text-sm text-muted-foreground">Not configured — set <code className="text-xs">UPSTASH_REDIS_REST_URL</code> and <code className="text-xs">UPSTASH_REDIS_REST_TOKEN</code> to enable caching.</span>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              {isConnected ? (
                <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
              ) : (
                <AlertCircle className="h-4 w-4 text-destructive shrink-0" />
              )}
              <span className={`text-sm font-medium ${isConnected ? "text-green-600" : "text-destructive"}`}>
                {isConnected ? "Connected" : "Disconnected"}
              </span>
              {data?.error && (
                <span className="text-xs text-muted-foreground truncate">— {data.error}</span>
              )}
            </div>
            {isConnected && (
              <div className="flex gap-4 text-xs text-muted-foreground">
                {data?.latencyMs != null && (
                  <div className="flex items-center gap-1">
                    <span className="font-medium text-foreground">{data.latencyMs} ms</span>
                    <span>latency</span>
                  </div>
                )}
                {data?.keyCount != null && (
                  <div className="flex items-center gap-1">
                    <span className="font-medium text-foreground">{data.keyCount.toLocaleString()}</span>
                    <span>keys</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DeveloperPage() {
  const qc = useQueryClient();
  const listFn   = useServerFn(listTokens);
  const createFn = useServerFn(createToken);
  const revokeFn = useServerFn(revokeToken);

  const { data: tokens = [], isLoading } = useQuery({
    queryKey: ["api-tokens"],
    queryFn: () => listFn(),
    throwOnError: false,
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [selectedPerms, setSelectedPerms] = useState<string[]>(["*"]);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);

  const createMutation = useMutation({
    mutationFn: () => createFn({ data: { name: newKeyName } }),
    onSuccess: (result: any) => {
      qc.invalidateQueries({ queryKey: ["api-tokens"] });
      setCreatedKey(result?.plaintext ?? result?.token ?? null);
      setNewKeyName("");
    },
    onError: () => toast.error("Failed to create API key"),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => revokeFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["api-tokens"] });
      toast.success("API key revoked");
    },
    onError: () => toast.error("Failed to revoke key"),
  });

  const activeTokens  = tokens.filter((t: any) => !t.revoked_at);
  const revokedTokens = tokens.filter((t: any) => t.revoked_at);

  const togglePerm = (p: string) => {
    if (p === "*") { setSelectedPerms(["*"]); return; }
    setSelectedPerms(prev => {
      const without = prev.filter(x => x !== "*" && x !== p);
      return prev.includes(p) ? without : [...without, p];
    });
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Developer API</h1>
        <p className="text-muted-foreground mt-1">
          Connect external systems to WEBEE using API keys and webhooks.
        </p>
      </div>

      <Tabs defaultValue="keys">
        <TabsList>
          <TabsTrigger value="keys"><Key className="h-3.5 w-3.5 mr-1.5" />API Keys</TabsTrigger>
          <TabsTrigger value="docs"><BookOpen className="h-3.5 w-3.5 mr-1.5" />Documentation</TabsTrigger>
          <TabsTrigger value="security"><Lock className="h-3.5 w-3.5 mr-1.5" />Webhook Security</TabsTrigger>
        </TabsList>

        {/* ── API Keys tab ───────────────────────────────────────── */}
        <TabsContent value="keys" className="mt-6 space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">WEBEE API Keys</CardTitle>
                  <CardDescription>
                    Keys authenticate requests to <code className="text-xs">/api/v1/*</code>. Store them securely — they are shown only once.
                  </CardDescription>
                </div>
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  New Key
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
              {!isLoading && activeTokens.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <Key className="h-8 w-8 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No API keys yet. Create one to start connecting external systems.</p>
                </div>
              )}
              {activeTokens.map((t: any) => (
                <ApiKeyCard key={t.id} token={t} onRevoke={(id) => revokeMutation.mutate(id)} />
              ))}
              {revokedTokens.length > 0 && (
                <details className="mt-4">
                  <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                    {revokedTokens.length} revoked key{revokedTokens.length !== 1 ? "s" : ""}
                  </summary>
                  <div className="mt-2 space-y-2">
                    {revokedTokens.map((t: any) => (
                      <ApiKeyCard key={t.id} token={t} onRevoke={() => {}} />
                    ))}
                  </div>
                </details>
              )}
            </CardContent>
          </Card>

          {/* Rate limits info */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Rate Limits</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 text-sm">
                <Badge variant="outline">60 requests / minute</Badge>
                <span className="text-muted-foreground">per API key. Returns <code>429</code> with <code>Retry-After</code> when exceeded.</span>
              </div>
            </CardContent>
          </Card>

          <div id="cache-health">
            <CacheHealthCard />
          </div>
        </TabsContent>

        {/* ── Documentation tab ──────────────────────────────────── */}
        <TabsContent value="docs" className="mt-6 space-y-6">
          {/* Authentication */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Authentication</CardTitle>
              <CardDescription>All API requests require a WEBEE API key in the Authorization header.</CardDescription>
            </CardHeader>
            <CardContent>
              <CodeBlock code={`Authorization: Bearer lvb_xxxxxxxxxxxxxxxx`} />
            </CardContent>
          </Card>

          {/* Base URL */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Base URL</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <code className="text-sm bg-muted px-3 py-1.5 rounded font-mono flex-1">{API_BASE}</code>
                <CopyButton text={API_BASE} />
              </div>
            </CardContent>
          </Card>

          {/* Endpoint Groups */}
          {[
            {
              group: "Agents",
              endpoints: [
                { method: "GET",  path: "/agents",         perm: "agents:read",    desc: "List all agents in your workspace.",
                  example: `curl "${API_BASE}/agents" -H "Authorization: Bearer YOUR_KEY"` },
                { method: "POST", path: "/agents/deploy",  perm: "agents:deploy",  desc: "Request deployment for an agent. Returns current deploy status.",
                  example: `curl -X POST "${API_BASE}/agents/deploy" -H "Authorization: Bearer YOUR_KEY" -H "Content-Type: application/json" -d '{"agent_id":"<uuid>"}'` },
                { method: "POST", path: "/agents/test",    perm: "calls:trigger",  desc: "Initiate a test outbound call from a deployed agent.",
                  example: `curl -X POST "${API_BASE}/agents/test" -H "Authorization: Bearer YOUR_KEY" -H "Content-Type: application/json" -d '{"agent_id":"<uuid>","to_number":"+15005550001"}'` },
                { method: "POST", path: "/agents/archive", perm: "agents:archive", desc: "Archive (soft-delete) an agent.",
                  example: `curl -X POST "${API_BASE}/agents/archive" -H "Authorization: Bearer YOUR_KEY" -H "Content-Type: application/json" -d '{"agent_id":"<uuid>"}'` },
              ],
            },
            {
              group: "Leads",
              endpoints: [
                { method: "GET",  path: "/leads",      perm: "leads:read",  desc: "List leads. Query: ?limit=50&offset=0&status=new",
                  example: `curl "${API_BASE}/leads?limit=20&status=new" -H "Authorization: Bearer YOUR_KEY"` },
                { method: "POST", path: "/leads",      perm: "leads:write", desc: "Create a new lead.",
                  example: `curl -X POST "${API_BASE}/leads" -H "Authorization: Bearer YOUR_KEY" -H "Content-Type: application/json" -d '{"full_name":"Jane Smith","phone":"+15005550001","email":"jane@acme.com"}'` },
              ],
            },
            {
              group: "Contacts",
              endpoints: [
                { method: "GET",   path: "/contacts",     perm: "contacts:read",  desc: "List contacts. Query: ?limit=50&q=search&tag=vip",
                  example: `curl "${API_BASE}/contacts?q=Jane" -H "Authorization: Bearer YOUR_KEY"` },
                { method: "POST",  path: "/contacts",     perm: "contacts:write", desc: "Create a contact.",
                  example: `curl -X POST "${API_BASE}/contacts" -H "Authorization: Bearer YOUR_KEY" -H "Content-Type: application/json" -d '{"full_name":"Jane Smith","phone":"+15005550001","tags":["vip"]}'` },
                { method: "PATCH", path: "/contacts/:id", perm: "contacts:write", desc: "Update a contact by ID.",
                  example: `curl -X PATCH "${API_BASE}/contacts/<id>" -H "Authorization: Bearer YOUR_KEY" -H "Content-Type: application/json" -d '{"status":"qualified","pipeline_stage":"Demo Scheduled"}'` },
              ],
            },
            {
              group: "Calls",
              endpoints: [
                { method: "GET",  path: "/calls",           perm: "calls:read",      desc: "List call logs. Query: ?limit=50&since=2026-01-01",
                  example: `curl "${API_BASE}/calls?limit=10" -H "Authorization: Bearer YOUR_KEY"` },
                { method: "POST", path: "/calls",           perm: "calls:trigger",   desc: "Trigger an AI outbound call.",
                  example: `curl -X POST "${API_BASE}/calls" -H "Authorization: Bearer YOUR_KEY" -H "Content-Type: application/json" -d '{"agent_id":"<uuid>","to_number":"+15005550001"}'` },
                { method: "GET",  path: "/calls/analytics", perm: "calls:analytics", desc: "Detailed call metrics with time-series and per-agent breakdown. Query: ?days=30&bucket=day|week&agent_id=",
                  example: `curl "${API_BASE}/calls/analytics?days=30&bucket=day" -H "Authorization: Bearer YOUR_KEY"` },
              ],
            },
            {
              group: "Bookings",
              endpoints: [
                { method: "GET",   path: "/bookings",     perm: "bookings:read",  desc: "List bookings. Query: ?limit=50&status=confirmed&since=2026-01-01&until=2026-12-31",
                  example: `curl "${API_BASE}/bookings?status=confirmed" -H "Authorization: Bearer YOUR_KEY"` },
                { method: "POST",  path: "/bookings",     perm: "bookings:write", desc: "Create a booking.",
                  example: `curl -X POST "${API_BASE}/bookings" -H "Authorization: Bearer YOUR_KEY" -H "Content-Type: application/json" -d '{"attendee_name":"Jane Smith","attendee_email":"jane@acme.com","start_at":"2026-07-01T10:00:00Z"}'` },
                { method: "PATCH", path: "/bookings/:id", perm: "bookings:write", desc: "Update a booking (status, time, notes).",
                  example: `curl -X PATCH "${API_BASE}/bookings/<id>" -H "Authorization: Bearer YOUR_KEY" -H "Content-Type: application/json" -d '{"status":"cancelled"}'` },
              ],
            },
            {
              group: "Campaigns",
              endpoints: [
                { method: "POST", path: "/campaigns",             perm: "campaigns:trigger", desc: "Enrol a lead/phone into a campaign.",
                  example: `curl -X POST "${API_BASE}/campaigns" -H "Authorization: Bearer YOUR_KEY" -H "Content-Type: application/json" -d '{"campaign_id":"<uuid>","phone":"+15005550001","name":"Jane Smith"}'` },
                { method: "GET",  path: "/campaigns/performance", perm: "campaigns:read",    desc: "Per-campaign stats: enrolled, completed, pending, completion rate. Query: ?days=30&campaign_id=",
                  example: `curl "${API_BASE}/campaigns/performance?days=30" -H "Authorization: Bearer YOUR_KEY"` },
              ],
            },
            {
              group: "Analytics",
              endpoints: [
                { method: "GET", path: "/analytics", perm: "analytics:read", desc: "Workspace-level overview: call totals, lead counts, booking counts. Query: ?days=30",
                  example: `curl "${API_BASE}/analytics?days=30" -H "Authorization: Bearer YOUR_KEY"` },
                { method: "GET", path: "/growthmind/recommendations", perm: "growthmind:read", desc: "Active AI growth recommendations and opportunities. Query: ?limit=20&category=&priority=high",
                  example: `curl "${API_BASE}/growthmind/recommendations" -H "Authorization: Bearer YOUR_KEY"` },
              ],
            },
            {
              group: "Billing & Costs",
              endpoints: [
                { method: "GET", path: "/billing",        perm: "billing:read", desc: "Workspace billing plan, included limits, and last 3 months of cost history.",
                  example: `curl "${API_BASE}/billing" -H "Authorization: Bearer YOUR_KEY"` },
                { method: "GET", path: "/costs",          perm: "billing:read", desc: "Provider cost breakdown for a calendar month. Query: ?month=2026-06",
                  example: `curl "${API_BASE}/costs?month=2026-06" -H "Authorization: Bearer YOUR_KEY"` },
                { method: "GET", path: "/profitability",  perm: "billing:read", desc: "Per-call profitability: cost, revenue, profit margin. Query: ?days=30&agent_id=",
                  example: `curl "${API_BASE}/profitability?days=30" -H "Authorization: Bearer YOUR_KEY"` },
                { method: "GET", path: "/provider-usage", perm: "billing:read", desc: "Aggregated requests, errors, and cost per provider. Query: ?days=30&category=voice",
                  example: `curl "${API_BASE}/provider-usage?days=30&category=voice" -H "Authorization: Bearer YOUR_KEY"` },
              ],
            },
            {
              group: "Knowledge & Webhooks",
              endpoints: [
                { method: "POST", path: "/knowledge", perm: "knowledge:write",  desc: "Upload a knowledge document to a WEBEE agent.",
                  example: `curl -X POST "${API_BASE}/knowledge" -H "Authorization: Bearer YOUR_KEY" -H "Content-Type: application/json" -d '{"agent_id":"<uuid>","title":"FAQ","content":"Q: Hours?\\nA: 9-5 Mon-Fri"}'` },
                { method: "GET",  path: "/webhooks",  perm: "webhooks:manage", desc: "List webhook subscriptions.",
                  example: `curl "${API_BASE}/webhooks" -H "Authorization: Bearer YOUR_KEY"` },
                { method: "POST", path: "/webhooks",  perm: "webhooks:manage", desc: "Create a webhook subscription.",
                  example: `curl -X POST "${API_BASE}/webhooks" -H "Authorization: Bearer YOUR_KEY" -H "Content-Type: application/json" -d '{"name":"Lead Sync","event_type":"lead.created","target_url":"https://your-app.com/webhooks/webee"}'` },
              ],
            },
          ].map(group => (
            <div key={group.group} className="space-y-3">
              <h3 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground pt-2">{group.group}</h3>
              {group.endpoints.map(ep => (
                <Card key={`${ep.method}-${ep.path}`}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="outline" className={
                        ep.method === "GET"   ? "border-blue-500 text-blue-600" :
                        ep.method === "POST"  ? "border-green-500 text-green-600" :
                        ep.method === "PATCH" ? "border-amber-500 text-amber-600" : ""
                      }>{ep.method}</Badge>
                      <code className="text-sm font-mono font-semibold">{ep.path}</code>
                      <Badge variant="secondary" className="text-[10px] ml-auto">{ep.perm}</Badge>
                    </div>
                    <CardDescription className="mt-1 text-xs">{ep.desc}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <CodeBlock code={ep.example} />
                  </CardContent>
                </Card>
              ))}
            </div>
          ))}

          {/* Webhook Events */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Webhook Event Types</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {[
                  "lead.created","lead.updated",
                  "call.started","call.completed","call.failed",
                  "booking.created","booking.updated","booking.cancelled",
                  "campaign.completed","document.uploaded","agent.deployed",
                ].map(e => (
                  <code key={e} className="bg-muted px-2 py-1 rounded text-xs font-mono">{e}</code>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Webhook Security tab ────────────────────────────────── */}
        <TabsContent value="security" className="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Verifying Webhook Signatures</CardTitle>
              <CardDescription>
                All WEBEE outbound webhooks are signed with <code>X-WEBEE-Signature</code> using HMAC-SHA256.
                Verify this to ensure requests are from WEBEE.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <CodeBlock language="typescript" code={`// Node.js — verify WEBEE webhook signature
import crypto from "node:crypto";

function verifyWebeeWebhook(
  rawBody: string,        // raw request body string (before JSON.parse)
  signature: string,      // X-WEBEE-Signature header value (format: "sha256=<hex>")
  webhookSecret: string,  // the secret shown when you created the webhook
): boolean {
  const expected = "sha256=" + crypto
    .createHmac("sha256", webhookSecret)
    .update(rawBody)
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected),
  );
}

// Express example
app.post("/webhooks/webee", express.raw({ type: "application/json" }), (req, res) => {
  const sig    = req.headers["x-webee-signature"] as string;
  const secret = process.env.WEBEE_WEBHOOK_SECRET!;
  if (!verifyWebeeWebhook(req.body.toString(), sig, secret)) {
    return res.status(403).send("Invalid signature");
  }
  const event = JSON.parse(req.body.toString());
  console.log("Event:", event.event, event.data);
  res.sendStatus(200);
});`} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Webhook Payload Shape</CardTitle>
            </CardHeader>
            <CardContent>
              <CodeBlock language="json" code={`{
  "event": "lead.created",
  "workspace_id": "a1b2c3...",
  "timestamp": "2026-06-17T10:30:00.000Z",
  "data": {
    "id": "lead-uuid",
    "full_name": "Jane Smith",
    "phone": "+15005550001",
    "email": "jane@example.com",
    "source": "api",
    "status": "new",
    "created_at": "2026-06-17T10:30:00.000Z"
  }
}`} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create Key Dialog */}
      <Dialog open={createOpen} onOpenChange={(o) => { if (!o && !createdKey) setCreateOpen(false); }}>
        <DialogContent className="max-w-md">
          {!createdKey ? (
            <>
              <DialogHeader>
                <DialogTitle>Create API Key</DialogTitle>
                <DialogDescription>
                  Give this key a descriptive name so you can identify it later.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div>
                  <Label>Key Name</Label>
                  <Input
                    placeholder="e.g. CRM Integration, Zapier, Production"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && newKeyName && createMutation.mutate()}
                  />
                </div>
                <div>
                  <Label className="mb-2 block">Permissions</Label>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedPerms.includes("*")}
                        onChange={() => togglePerm("*")}
                        className="rounded"
                      />
                      <span className="text-sm font-medium">Full Access (all permissions)</span>
                    </label>
                    {!selectedPerms.includes("*") && PERMISSION_OPTIONS.map(p => (
                      <label key={p.value} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedPerms.includes(p.value)}
                          onChange={() => togglePerm(p.value)}
                          className="rounded"
                        />
                        <span className="text-sm">
                          <span className="font-medium">{p.label}</span>
                          <span className="text-muted-foreground ml-1">— {p.desc}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button
                  disabled={!newKeyName || createMutation.isPending}
                  onClick={() => createMutation.mutate()}
                >
                  {createMutation.isPending ? "Creating…" : "Create Key"}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                  API Key Created
                </DialogTitle>
                <DialogDescription>
                  Copy this key now — it will not be shown again.
                </DialogDescription>
              </DialogHeader>
              <div className="py-4">
                <div className="flex items-center gap-2 bg-muted rounded-lg px-3 py-2">
                  <code className="text-xs font-mono flex-1 break-all select-all">
                    {showKey ? createdKey : createdKey.slice(0, 12) + "•".repeat(Math.max(0, createdKey.length - 12))}
                  </code>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowKey(v => !v)}>
                    {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </Button>
                  <CopyButton text={createdKey} />
                </div>
                <div className="mt-3 flex items-start gap-2 text-sm text-amber-700 bg-amber-50 rounded-lg p-3">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>Store this key securely. If you lose it, you'll need to create a new one.</span>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={() => { setCreatedKey(null); setCreateOpen(false); setShowKey(false); }}>
                  Done
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
