import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, BrainCircuit, Check, Eye, EyeOff, Loader2, Mic, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getElevenLabsKey,
  saveElevenLabsApiKey,
  getOpenAiKey,
  saveOpenAiApiKey,
} from "@/lib/dashboard/workspace-settings.functions";

export const Route = createFileRoute("/_authenticated/settings/integrations")({
  head: () => ({
    meta: [
      { title: "Integrations — Webee" },
      { name: "description", content: "Connect voice and productivity tools to your workspace." },
    ],
  }),
  component: IntegrationsPage,
});

const MIGRATION_SQL = `ALTER TABLE workspace_settings ADD COLUMN IF NOT EXISTS elevenlabs_api_key TEXT;`;
const OPENAI_MIGRATION_SQL = `ALTER TABLE workspace_settings ADD COLUMN IF NOT EXISTS openai_api_key TEXT;`;

function IntegrationsPage() {
  const qc = useQueryClient();
  const getFn = useServerFn(getElevenLabsKey);
  const saveFn = useServerFn(saveElevenLabsApiKey);
  const getOAIFn = useServerFn(getOpenAiKey);
  const saveOAIFn = useServerFn(saveOpenAiApiKey);

  const { data: elStatus, isLoading: elLoading } = useQuery({
    queryKey: ["el-key-status"],
    queryFn: () => getFn(),
    staleTime: 30_000,
  });

  const { data: oaiStatus, isLoading: oaiLoading } = useQuery({
    queryKey: ["oai-key-status"],
    queryFn: () => getOAIFn(),
    staleTime: 30_000,
  });

  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const [oaiKey, setOaiKey] = useState("");
  const [showOaiKey, setShowOaiKey] = useState(false);
  const [oaiSaving, setOaiSaving] = useState(false);
  const [oaiCopied, setOaiCopied] = useState(false);

  async function handleSave() {
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      const res = await saveFn({ data: { key: apiKey.trim() } });
      if (res.columnMissing) {
        toast.error("Database column missing", {
          description: "Run the SQL shown below in your Supabase dashboard, then try again.",
        });
        return;
      }
      toast.success("ElevenLabs connected");
      setApiKey("");
      qc.invalidateQueries({ queryKey: ["el-key-status"] });
    } catch (e) {
      toast.error("Save failed", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    setSaving(true);
    try {
      await saveFn({ data: { key: "" } });
      toast.success("ElevenLabs disconnected");
      qc.invalidateQueries({ queryKey: ["el-key-status"] });
    } catch (e) {
      toast.error("Failed", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function handleOaiSave() {
    if (!oaiKey.trim()) return;
    setOaiSaving(true);
    try {
      const res = await saveOAIFn({ data: { key: oaiKey.trim() } });
      if (res.columnMissing) {
        toast.error("Database column missing", {
          description: "Run the SQL shown below in your Supabase dashboard, then try again.",
        });
        return;
      }
      toast.success("OpenAI key saved");
      setOaiKey("");
      qc.invalidateQueries({ queryKey: ["oai-key-status"] });
    } catch (e) {
      toast.error("Save failed", { description: (e as Error).message });
    } finally {
      setOaiSaving(false);
    }
  }

  async function handleOaiDisconnect() {
    setOaiSaving(true);
    try {
      await saveOAIFn({ data: { key: "" } });
      toast.success("OpenAI key removed");
      qc.invalidateQueries({ queryKey: ["oai-key-status"] });
    } catch (e) {
      toast.error("Failed", { description: (e as Error).message });
    } finally {
      setOaiSaving(false);
    }
  }

  function copyMigration() {
    navigator.clipboard.writeText(MIGRATION_SQL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function copyOaiMigration() {
    navigator.clipboard.writeText(OPENAI_MIGRATION_SQL);
    setOaiCopied(true);
    setTimeout(() => setOaiCopied(false), 2000);
  }

  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <div className="mb-8 flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link to="/my-agents">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Back
            </Link>
          </Button>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Settings
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">Integrations</h1>
          </div>
        </div>

        {/* ElevenLabs */}
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Mic className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-base">ElevenLabs</CardTitle>
              </div>
              {!elLoading && elStatus && !elStatus.columnMissing && (
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    elStatus.connected
                      ? "bg-green-500/10 text-green-600 dark:text-green-400"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {elStatus.connected ? (
                    <><Check className="h-3 w-3" /> Connected</>
                  ) : (
                    <><X className="h-3 w-3" /> Not connected</>
                  )}
                </span>
              )}
            </div>
            <CardDescription>
              Connect your ElevenLabs account to search 1,000+ community voices and use custom
              voices in your agents.{" "}
              <a
                href="https://elevenlabs.io/app/settings/api-keys"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                Get your API key →
              </a>
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {elLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
              </div>
            ) : elStatus?.columnMissing ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
                <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
                  One-time database setup required
                </p>
                <p className="text-xs text-muted-foreground">
                  Run this SQL in your{" "}
                  <a
                    href="https://supabase.com/dashboard"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    Supabase SQL editor
                  </a>{" "}
                  and then refresh this page:
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded bg-muted px-3 py-2 font-mono text-xs break-all">
                    {MIGRATION_SQL}
                  </code>
                  <Button size="sm" variant="outline" onClick={copyMigration} className="shrink-0">
                    {copied ? <Check className="h-3.5 w-3.5" /> : "Copy"}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {elStatus?.connected && elStatus.masked && (
                  <div className="rounded-md bg-muted/50 px-3 py-2 flex items-center justify-between">
                    <span className="font-mono text-xs text-muted-foreground">{elStatus.masked}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs text-destructive hover:text-destructive"
                      onClick={handleDisconnect}
                      disabled={saving}
                    >
                      Disconnect
                    </Button>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label className="text-xs">
                    {elStatus?.connected ? "Replace API key" : "API key"}
                  </Label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Input
                        type={showKey ? "text" : "password"}
                        placeholder="sk_..."
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSave()}
                        className="pr-9 font-mono text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setShowKey((s) => !s)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                    <Button onClick={handleSave} disabled={!apiKey.trim() || saving}>
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* OpenAI */}
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BrainCircuit className="h-4 w-4 text-muted-foreground" />
                <CardTitle className="text-base">OpenAI</CardTitle>
              </div>
              {!oaiLoading && oaiStatus && !oaiStatus.columnMissing && (
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    oaiStatus.connected
                      ? "bg-green-500/10 text-green-600 dark:text-green-400"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {oaiStatus.connected ? (
                    <><Check className="h-3 w-3" /> Connected</>
                  ) : (
                    <><X className="h-3 w-3" /> Not connected</>
                  )}
                </span>
              )}
            </div>
            <CardDescription>
              Add your workspace OpenAI API key so VoxStream (ElevenLabs) agents use your account
              for GPT-4o inference and post-call analysis.{" "}
              <a
                href="https://platform.openai.com/api-keys"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                Get your API key →
              </a>
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4">
            {oaiLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
              </div>
            ) : oaiStatus?.columnMissing ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
                <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
                  One-time database setup required
                </p>
                <p className="text-xs text-muted-foreground">
                  Run this SQL in your{" "}
                  <a
                    href="https://supabase.com/dashboard"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    Supabase SQL editor
                  </a>{" "}
                  and then refresh this page:
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded bg-muted px-3 py-2 font-mono text-xs break-all">
                    {OPENAI_MIGRATION_SQL}
                  </code>
                  <Button size="sm" variant="outline" onClick={copyOaiMigration} className="shrink-0">
                    {oaiCopied ? <Check className="h-3.5 w-3.5" /> : "Copy"}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {oaiStatus?.connected && oaiStatus.masked && (
                  <div className="rounded-md bg-muted/50 px-3 py-2 flex items-center justify-between">
                    <span className="font-mono text-xs text-muted-foreground">{oaiStatus.masked}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs text-destructive hover:text-destructive"
                      onClick={handleOaiDisconnect}
                      disabled={oaiSaving}
                    >
                      Remove
                    </Button>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label className="text-xs">
                    {oaiStatus?.connected ? "Replace API key" : "API key"}
                  </Label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Input
                        type={showOaiKey ? "text" : "password"}
                        placeholder="sk-..."
                        value={oaiKey}
                        onChange={(e) => setOaiKey(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleOaiSave()}
                        className="pr-9 font-mono text-sm"
                      />
                      <button
                        type="button"
                        onClick={() => setShowOaiKey((s) => !s)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showOaiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                    <Button onClick={handleOaiSave} disabled={!oaiKey.trim() || oaiSaving}>
                      {oaiSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Webhook endpoints */}
        <Card>
          <CardHeader>
            <CardTitle>Voice Agent Webhook Endpoints</CardTitle>
            <CardDescription>
              Paste these URLs into the matching custom-function nodes in your voice agent. Every
              endpoint is signed with <code>x-retell-signature</code> using your{" "}
              <code>RETELL_WEBHOOK_SECRET</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: "Check availability", path: "/api/public/retell/availability" },
              { label: "Book appointment", path: "/api/public/retell/book" },
              { label: "Reschedule", path: "/api/public/retell/reschedule" },
              { label: "Cancel", path: "/api/public/retell/cancel" },
            ].map((row) => {
              const url = (typeof window !== "undefined" ? window.location.origin : "") + row.path;
              return (
                <div key={row.path} className="space-y-1">
                  <Label className="text-xs">{row.label}</Label>
                  <div className="flex gap-2">
                    <Input readOnly value={url} className="font-mono text-xs" />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        navigator.clipboard.writeText(url);
                        toast.success("Copied");
                      }}
                    >
                      Copy
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
