import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listTokens, createToken, revokeToken } from "@/lib/workspace/api-tokens.functions";
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
import { Copy, Eye, EyeOff, Plus, Trash2, Key, Webhook, BookOpen, CheckCircle2, AlertCircle, Globe, Lock } from "lucide-react";
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

function DeveloperPage() {
  const qc = useQueryClient();
  const listFn   = useServerFn(listTokens);
  const createFn = useServerFn(createToken);
  const revokeFn = useServerFn(revokeToken);

  const { data: tokens = [], isLoading } = useQuery({
    queryKey: ["api-tokens"],
    queryFn: () => listFn(),
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

          {/* Endpoints */}
          <div className="space-y-4">
            <h3 className="font-semibold text-sm uppercase tracking-wide text-muted-foreground">Endpoints</h3>

            {[
              {
                method: "GET", path: "/agents",
                desc: "List all WEBEE agents in your workspace.",
                perm: "agents:read",
                example: `curl -X GET "${API_BASE}/agents" \\
  -H "Authorization: Bearer YOUR_KEY"`,
              },
              {
                method: "GET", path: "/leads",
                desc: "List leads. Query params: ?limit=50&offset=0&status=new",
                perm: "leads:read",
                example: `curl -X GET "${API_BASE}/leads?limit=20" \\
  -H "Authorization: Bearer YOUR_KEY"`,
              },
              {
                method: "POST", path: "/leads",
                desc: "Create a new lead / contact.",
                perm: "leads:write",
                example: `curl -X POST "${API_BASE}/leads" \\
  -H "Authorization: Bearer YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"full_name":"Jane Smith","phone":"+15005550001","email":"jane@example.com","source":"crm"}'`,
              },
              {
                method: "POST", path: "/calls",
                desc: "Trigger an AI call from a WEBEE agent to a phone number.",
                perm: "calls:trigger",
                example: `curl -X POST "${API_BASE}/calls" \\
  -H "Authorization: Bearer YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"agent_id":"<agent-uuid>","to_number":"+15005550001"}'`,
              },
              {
                method: "GET", path: "/calls",
                desc: "List call logs. Query params: ?limit=50&since=2026-01-01",
                perm: "calls:read",
                example: `curl -X GET "${API_BASE}/calls?limit=10" \\
  -H "Authorization: Bearer YOUR_KEY"`,
              },
              {
                method: "POST", path: "/campaigns",
                desc: "Enrol a lead into a campaign by campaign_id + lead_id or phone.",
                perm: "campaigns:trigger",
                example: `curl -X POST "${API_BASE}/campaigns" \\
  -H "Authorization: Bearer YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"campaign_id":"<uuid>","phone":"+15005550001","name":"Jane Smith"}'`,
              },
              {
                method: "POST", path: "/knowledge",
                desc: "Upload a knowledge document (text or URL) to a WEBEE agent.",
                perm: "knowledge:write",
                example: `curl -X POST "${API_BASE}/knowledge" \\
  -H "Authorization: Bearer YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"agent_id":"<uuid>","title":"Company FAQ","content":"Q: What are your hours?\\nA: 9-5 Mon-Fri"}'`,
              },
              {
                method: "POST", path: "/webhooks",
                desc: "Create a webhook subscription for a specific event type.",
                perm: "webhooks:manage",
                example: `curl -X POST "${API_BASE}/webhooks" \\
  -H "Authorization: Bearer YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Lead Sync","event_type":"lead.created","target_url":"https://your-app.com/webhooks/webee"}'`,
              },
            ].map(ep => (
              <Card key={ep.path}>
                <CardHeader className="pb-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={
                      ep.method === "GET" ? "border-blue-500 text-blue-600" :
                      ep.method === "POST" ? "border-green-500 text-green-600" : ""
                    }>{ep.method}</Badge>
                    <code className="text-sm font-mono font-semibold">{ep.path}</code>
                    <Badge variant="secondary" className="text-[10px] ml-auto">{ep.perm}</Badge>
                  </div>
                  <CardDescription className="mt-1">{ep.desc}</CardDescription>
                </CardHeader>
                <CardContent>
                  <CodeBlock code={ep.example} />
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Webhook Events */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Webhook Event Types</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {[
                  "lead.created","lead.updated","call.started","call.completed",
                  "call.failed","booking.created","campaign.completed",
                  "document.uploaded","agent.deployed",
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
