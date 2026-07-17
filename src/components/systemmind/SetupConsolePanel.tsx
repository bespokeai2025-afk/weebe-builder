// ── SystemMind Setup Console panels ────────────────────────────────────────────
// Replit-style setup surface used inside BuildSessionView tabs:
//   • LinkedAgentCard      — agent link/scan status + actions
//   • CredentialsPanel     — CRM provider selector + credential boxes (masked)
//   • DetectedVariablesPanel — scanned {{variables}} with editable mappings
//   • CrmMappingPanel      — CRM field API-code mapping table
//   • TriggerRulesPanel    — status trigger mapping table
//   • SetupTestPanel       — test payload / run / approve
//   • RequiredInputsPanel  — grouped missing inputs with "Fill in" shortcuts
// All data flows through setup-console.functions.ts (workspace-scoped).
// Credential VALUES only ever go to the existing provider credential fn.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Bot, CheckCircle2, ChevronRight, CircleAlert, ExternalLink, KeyRound,
  Loader2, Plus, RefreshCw, ScanSearch, ShieldCheck, Sparkles, Trash2,
  Variable as VariableIcon, XCircle,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  scanAgentForSetup, getSetupState, updateSetupState, refreshSetupCrmStatus,
  generateSetupTestPayload, runSetupTest, approveSetup, listAgentsForSetup,
  saveSetupContext, autoSuggestSetupContext, confirmSetupContext,
} from "@/lib/systemmind/setup-console.functions";
import {
  saveProviderCredentials, testProviderConnection,
} from "@/lib/providers/providers.functions";

// ── Shared hook ────────────────────────────────────────────────────────────────

export function useSetupConsole(sessionId: string) {
  const qc = useQueryClient();
  const getFn = useServerFn(getSetupState);

  const query = useQuery({
    queryKey: ["smsc-state", sessionId],
    queryFn: () => getFn({ data: { sessionId } }),
    enabled: !!sessionId,
    throwOnError: false,
    staleTime: 15_000,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["smsc-state", sessionId] });
  const setData = (res: any) => {
    qc.setQueryData(["smsc-state", sessionId], res);
  };

  return {
    state: (query.data as any)?.state ?? null,
    requiredInputs: ((query.data as any)?.requiredInputs ?? []) as any[],
    contextCompleteness: ((query.data as any)?.contextCompleteness ?? null) as any,
    isLoading: query.isLoading,
    invalidate,
    setData,
  };
}

export function missingRequiredCount(requiredInputs: any[]): number {
  return requiredInputs.filter((i) => i.required && !i.done).length;
}

function scrollToAnchor(anchor: string) {
  // Deferred so the target tab has rendered first.
  setTimeout(() => {
    const el = document.getElementById(anchor);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-amber-400/80", "rounded-md");
      setTimeout(() => el.classList.remove("ring-2", "ring-amber-400/80", "rounded-md"), 2600);
    }
  }, 250);
}

const HELPER = {
  crmCode: "Enter the exact API/schema name used by your CRM — e.g. mobilephone, emailaddress1, new_budget or statuscode.",
  statusCode: "Enter the CRM's internal status code, not the display name. \"Qualified\" may have a code like 100000001.",
  triggerSource: "Choose where this workflow should start from — e.g. when a WEBEE lead becomes Positive, or when a Dynamics lead status changes to Qualified.",
  variable: "This variable was detected in your agent. Choose where it should be saved and whether it should also be sent to your CRM.",
};

// ── Linked Agent card ──────────────────────────────────────────────────────────

export function LinkedAgentCard({
  sessionId, session, setup,
}: {
  sessionId: string;
  session: Record<string, any>;
  setup: ReturnType<typeof useSetupConsole>;
}) {
  const scanFn = useServerFn(scanAgentForSetup);
  const listFn = useServerFn(listAgentsForSetup);
  const [picking, setPicking] = useState(false);
  const [pickId, setPickId] = useState("");

  const { data: agents } = useQuery({
    queryKey: ["smsc-agents"],
    queryFn: () => listFn(),
    enabled: picking,
    throwOnError: false,
    staleTime: 60_000,
  });

  const scan = useMutation({
    mutationFn: (agentId?: string) =>
      scanFn({ data: { sessionId, agentId: agentId ?? null } }),
    onSuccess: (res: any) => {
      setup.setData({ state: res, requiredInputs: [] });
      setup.invalidate();
      setPicking(false);
      toast.success("Agent scanned", {
        description: `I found this agent, scanned the workflow, and detected ${res.scan?.variables?.length ?? 0} variables and setup requirements.`,
      });
    },
    onError: (e: any) => toast.error("Scan failed", { description: e?.message }),
  });

  const state = setup.state;
  const agentId = state?.agentId ?? session.target_agent_id ?? null;
  const missing = missingRequiredCount(setup.requiredInputs);

  if (!agentId) {
    return (
      <Card id="setup-linked-agent">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <Bot className="h-10 w-10 text-muted-foreground" />
          <div className="text-sm font-medium">No agent linked yet</div>
          <div className="max-w-sm text-xs text-muted-foreground">
            Select the agent this workflow should configure. Apply stays locked until an agent is linked and scanned.
          </div>
          {!picking ? (
            <Button size="sm" onClick={() => setPicking(true)}>Select agent</Button>
          ) : (
            <div className="flex w-full max-w-sm items-center gap-2">
              <Select value={pickId} onValueChange={setPickId}>
                <SelectTrigger className="h-8 flex-1 text-xs"><SelectValue placeholder="Choose an agent…" /></SelectTrigger>
                <SelectContent>
                  {(agents ?? []).map((a: any) => (
                    <SelectItem key={a.id} value={a.id}>{a.name} · {a.channel}{a.isLive ? " · live" : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" disabled={!pickId || scan.isPending} onClick={() => scan.mutate(pickId)}>
                {scan.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Link & scan"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  const s = state?.scan;
  return (
    <Card id="setup-linked-agent">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Bot className="h-4 w-4 text-sky-400" /> Linked Agent
          {s?.isLive
            ? <Badge className="bg-emerald-500/15 text-emerald-400 text-[10px]">live</Badge>
            : <Badge variant="outline" className="text-[10px]">draft</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-3">
          <Field label="Agent name" value={s?.agentName ?? session.target_agent_name ?? "—"} />
          <Field label="Agent ID" value={String(agentId).slice(0, 8) + "…"} />
          <Field label="Type" value={s?.agentType ?? "—"} />
          <Field label="Channel" value={s?.channel ?? "—"} />
          <Field label="Last scanned" value={s?.scannedAt ? new Date(s.scannedAt).toLocaleString() : "Not scanned yet"} />
          <Field label="Variables detected" value={String(s?.variables?.length ?? 0)} />
          <Field label="Required mappings" value={String((state?.mappings ?? []).filter((m: any) => m.required && !m.ignored).length)} />
          <Field label="Missing inputs" value={String(missing)} warn={missing > 0} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="secondary" className="h-7 text-xs" disabled={scan.isPending}
            onClick={() => scan.mutate(undefined)}>
            {scan.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ScanSearch className="mr-1 h-3 w-3" />}
            {s?.scannedAt ? "Re-scan agent" : "Scan agent"}
          </Button>
          {!picking ? (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setPicking(true)}>Change agent</Button>
          ) : (
            <span className="flex items-center gap-1.5">
              <Select value={pickId} onValueChange={setPickId}>
                <SelectTrigger className="h-7 w-48 text-xs"><SelectValue placeholder="Choose an agent…" /></SelectTrigger>
                <SelectContent>
                  {(agents ?? []).map((a: any) => (
                    <SelectItem key={a.id} value={a.id}>{a.name} · {a.channel}{a.isLive ? " · live" : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" className="h-7 text-xs" disabled={!pickId || scan.isPending} onClick={() => scan.mutate(pickId)}>Link & scan</Button>
            </span>
          )}
          <Button asChild size="sm" variant="outline" className="h-7 text-xs">
            <Link to="/builder" search={{ agent: agentId } as any}>
              <ExternalLink className="mr-1 h-3 w-3" /> Open Builder
            </Link>
          </Button>
        </div>
        {!s?.scannedAt && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-300">
            Run a scan so SystemMind can detect the agent's variables and setup requirements.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={warn ? "font-medium text-amber-400" : "font-medium"}>{value}</div>
    </div>
  );
}

// ── Credentials panel ──────────────────────────────────────────────────────────

const CRM_PROVIDERS: Array<{ value: string; label: string }> = [
  { value: "webee",       label: "WEBEE CRM (built in)" },
  { value: "dynamics",    label: "Microsoft Dynamics" },
  { value: "hubspot",     label: "HubSpot" },
  { value: "salesforce",  label: "Salesforce" },
  { value: "pipedrive",   label: "Pipedrive" },
  { value: "zoho",        label: "Zoho" },
  { value: "gohighlevel", label: "GoHighLevel" },
  { value: "custom",      label: "Custom API" },
  { value: "none",        label: "No CRM" },
];

const CRED_FIELDS: Record<string, Array<{ key: string; label: string; secret?: boolean }>> = {
  dynamics: [
    { key: "tenantId",     label: "Tenant ID" },
    { key: "clientId",     label: "Client ID" },
    { key: "clientSecret", label: "Client Secret", secret: true },
    { key: "orgUrl",       label: "Organization URL" },
    { key: "environmentUrl", label: "Environment URL" },
  ],
  hubspot:     [{ key: "apiKey", label: "Private App Token", secret: true }],
  salesforce:  [
    { key: "instanceUrl", label: "Instance URL" },
    { key: "accessToken", label: "Access Token", secret: true },
  ],
  pipedrive:   [{ key: "apiKey", label: "API Token", secret: true }],
  zoho:        [
    { key: "accountsUrl", label: "Accounts URL" },
    { key: "clientId",    label: "Client ID" },
    { key: "clientSecret", label: "Client Secret", secret: true },
    { key: "refreshToken", label: "Refresh Token", secret: true },
  ],
  gohighlevel: [{ key: "apiKey", label: "API Key", secret: true }],
  custom:      [{ key: "apiKey", label: "API Key / Bearer Token", secret: true }],
};

const CONN_BADGE: Record<string, { text: string; cls: string }> = {
  not_connected:       { text: "Not connected",       cls: "bg-zinc-500/15 text-zinc-400" },
  missing_credentials: { text: "Missing credentials", cls: "bg-amber-500/15 text-amber-400" },
  testing:             { text: "Testing…",            cls: "bg-sky-500/15 text-sky-400" },
  connected:           { text: "Connected",           cls: "bg-emerald-500/15 text-emerald-400" },
  failed:              { text: "Failed",              cls: "bg-red-500/15 text-red-400" },
  expired:             { text: "Expired",             cls: "bg-red-500/15 text-red-400" },
  permission_issue:    { text: "Permission issue",    cls: "bg-red-500/15 text-red-400" },
};

export function CredentialsPanel({
  sessionId, setup,
}: { sessionId: string; setup: ReturnType<typeof useSetupConsole> }) {
  const updateFn  = useServerFn(updateSetupState);
  const refreshFn = useServerFn(refreshSetupCrmStatus);
  const saveCredFn = useServerFn(saveProviderCredentials);
  const testCredFn = useServerFn(testProviderConnection);

  const state = setup.state;
  const crm = state?.crm ?? { provider: "none", connectionStatus: "not_connected", customEndpoints: {} };
  const provider = crm.provider ?? "none";
  const externalCrm = !["none", "webee"].includes(provider);
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [nonSecret, setNonSecret] = useState<Record<string, string>>({});

  const update = useMutation({
    mutationFn: (crmPatch: Record<string, unknown>) =>
      updateFn({ data: { sessionId, crmPatch } }),
    onSuccess: (res: any) => setup.setData(res),
    onError: (e: any) => toast.error("Could not save", { description: e?.message }),
  });

  const refreshStatus = useMutation({
    mutationFn: () => refreshFn({ data: { sessionId } }),
    onSuccess: (res: any) => setup.setData(res),
    onError: (e: any) => toast.error("Status check failed", { description: e?.message }),
  });

  const saveCreds = useMutation({
    mutationFn: async () => {
      const filled = Object.fromEntries(Object.entries(creds).filter(([, v]) => v.trim()));
      if (!Object.keys(filled).length) throw new Error("Enter at least one credential value first.");
      await saveCredFn({ data: { category: "crm", providerName: provider, credentials: filled } });
      return refreshFn({ data: { sessionId } });
    },
    onSuccess: (res: any) => {
      setCreds({});
      setup.setData(res);
      toast.success("Credentials saved securely", { description: "Values are stored server-side only and shown as •••••••• from now on." });
    },
    onError: (e: any) => toast.error("Could not save credentials", { description: e?.message }),
  });

  const testConn = useMutation({
    mutationFn: async () => {
      const r: any = await testCredFn({ data: { category: "crm", providerName: provider } });
      if (!r.ok) throw new Error(r.error ?? "Connection test failed");
      return refreshFn({ data: { sessionId } });
    },
    onSuccess: (res: any) => { setup.setData(res); toast.success("Connection test passed"); },
    onError: async (e: any) => {
      toast.error("Connection test failed", { description: e?.message });
      refreshStatus.mutate();
    },
  });

  if (!state) return <ScanFirstNote />;

  const badge = CONN_BADGE[crm.connectionStatus] ?? CONN_BADGE.not_connected;
  const fields = CRED_FIELDS[provider] ?? [];
  const savedCreds = !["not_connected", "missing_credentials"].includes(crm.connectionStatus);

  return (
    <Card id="setup-crm-credentials">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <KeyRound className="h-4 w-4 text-amber-400" /> CRM Access
          <Badge className={`text-[10px] ${badge.cls}`}>{badge.text}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label className="text-xs">CRM provider</Label>
          <Select value={provider} onValueChange={(v) => update.mutate({ provider: v })}>
            <SelectTrigger className="h-8 w-64 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CRM_PROVIDERS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {externalCrm && crm.connectionStatus === "missing_credentials" && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-300">
            CRM access is required before this workflow can be applied. Enter your {CRM_PROVIDERS.find((p) => p.value === provider)?.label} credentials below.
          </div>
        )}

        {externalCrm && (
          <div className="grid gap-2 sm:grid-cols-2">
            {fields.map((f) => (
              <div key={f.key} className="space-y-1">
                <Label className="text-xs">{f.label}</Label>
                <Input
                  type={f.secret ? "password" : "text"}
                  className="h-8 text-xs"
                  placeholder={savedCreds ? "••••••••  (saved — enter to replace)" : f.label}
                  value={creds[f.key] ?? ""}
                  onChange={(e) => setCreds((c) => ({ ...c, [f.key]: e.target.value }))}
                  autoComplete="off"
                />
              </div>
            ))}
            {provider === "custom" && (
              <>
                {([
                  ["baseUrl", "Base URL"], ["authType", "Auth type (bearer / api_key / basic)"],
                  ["testPath", "Test endpoint"], ["createLeadPath", "Create lead endpoint"],
                  ["updateLeadPath", "Update lead endpoint"], ["statusUpdatePath", "Status update endpoint"],
                ] as const).map(([k, label]) => (
                  <div key={k} className="space-y-1">
                    <Label className="text-xs">{label}</Label>
                    <Input className="h-8 text-xs" placeholder={label}
                      value={nonSecret[k] ?? crm.customEndpoints?.[k] ?? ""}
                      onChange={(e) => setNonSecret((c) => ({ ...c, [k]: e.target.value }))}
                      onBlur={() => update.mutate({ customEndpoints: { ...crm.customEndpoints, ...nonSecret } })}
                    />
                  </div>
                ))}
              </>
            )}
            {provider === "dynamics" && (
              <>
                {([
                  ["defaultOwner", "Default owner/user ID"],
                  ["defaultPipeline", "Default pipeline ID"],
                  ["defaultSource", "Default source code"],
                ] as const).map(([k, label]) => (
                  <div key={k} className="space-y-1">
                    <Label className="text-xs">{label}</Label>
                    <Input className="h-8 text-xs" placeholder={label}
                      value={nonSecret[k] ?? crm[k] ?? ""}
                      onChange={(e) => setNonSecret((c) => ({ ...c, [k]: e.target.value }))}
                      onBlur={() => update.mutate({ [k]: nonSecret[k] ?? crm[k] ?? "" })}
                    />
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {externalCrm && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" className="h-7 text-xs" disabled={saveCreds.isPending} onClick={() => saveCreds.mutate()}>
              {saveCreds.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ShieldCheck className="mr-1 h-3 w-3" />}
              Save credentials
            </Button>
            <Button size="sm" variant="secondary" className="h-7 text-xs" disabled={testConn.isPending || !savedCreds} onClick={() => testConn.mutate()}>
              {testConn.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <RefreshCw className="mr-1 h-3 w-3" />}
              Test connection
            </Button>
            <span className="text-[10px] text-muted-foreground">
              Secrets are never shown again after saving and never stored in setup drafts.
            </span>
          </div>
        )}
        {crm.lastTestError && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 p-2 text-[11px] text-red-300">{crm.lastTestError}</div>
        )}
        {!externalCrm && (
          <div className="text-[11px] text-muted-foreground">
            {provider === "webee"
              ? "Using the built-in WEBEE CRM — no external credentials needed."
              : "No CRM selected — extracted data stays on the WEBEE dashboard only."}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ScanFirstNote() {
  return (
    <Card>
      <CardContent className="py-8 text-center text-xs text-muted-foreground">
        Link and scan the agent first (Linked Agent tab) — the setup console builds itself from the scan.
      </CardContent>
    </Card>
  );
}

// ── Detected variables + mapping tables ────────────────────────────────────────

function mappingStatus(m: any, externalCrm: boolean): { text: string; cls: string } {
  if (m.ignored)                 return { text: "Ignored",              cls: "bg-zinc-500/15 text-zinc-400" };
  if (!m.webeeField?.trim())     return { text: "Missing WEBEE destination", cls: "bg-amber-500/15 text-amber-400" };
  if (externalCrm && m.required && !m.crmField?.trim())
                                 return { text: "Missing CRM field",    cls: "bg-amber-500/15 text-amber-400" };
  if (m.suggested && !m.approved) return { text: "Suggested — approve", cls: "bg-sky-500/15 text-sky-400" };
  return { text: "Mapped", cls: "bg-emerald-500/15 text-emerald-400" };
}

export function DetectedVariablesPanel({
  sessionId, setup, crmFocus = false,
}: { sessionId: string; setup: ReturnType<typeof useSetupConsole>; crmFocus?: boolean }) {
  const updateFn = useServerFn(updateSetupState);
  const state = setup.state;
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [newVar, setNewVar] = useState("");

  const update = useMutation({
    mutationFn: (mappingPatches: any[]) => updateFn({ data: { sessionId, mappingPatches } }),
    onSuccess: (res: any) => setup.setData(res),
    onError: (e: any) => toast.error("Could not save mapping", { description: e?.message }),
  });

  if (!state) return <ScanFirstNote />;
  const externalCrm = !["none", "webee"].includes(state.crm?.provider ?? "none");
  const scanned = new Map((state.scan?.variables ?? []).map((v: any) => [v.name, v]));
  const mappings: any[] = state.mappings ?? [];

  const commit = (variable: string, key: string, value: string) => {
    update.mutate([{ variable, [key]: value }]);
    setDrafts((d) => { const n = { ...d }; delete n[variable]?.[key]; return n; });
  };
  const draftVal = (variable: string, key: string, fallback: string) =>
    drafts[variable]?.[key] ?? fallback;
  const setDraft = (variable: string, key: string, value: string) =>
    setDrafts((d) => ({ ...d, [variable]: { ...d[variable], [key]: value } }));

  return (
    <Card id={crmFocus ? "setup-crm-mapping" : "setup-variables-table"}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <VariableIcon className="h-4 w-4 text-violet-400" />
          {crmFocus ? "CRM Field Mapping" : "Detected Agent Variables"}
          <Badge variant="outline" className="text-[10px]">{mappings.filter((m) => !m.ignored).length} active</Badge>
        </CardTitle>
        <p className="text-[11px] text-muted-foreground">
          {crmFocus ? HELPER.crmCode : HELPER.variable}
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <th className="py-1.5 pr-2">Variable</th>
                {!crmFocus && <th className="py-1.5 pr-2">Found in</th>}
                <th className="py-1.5 pr-2">Type</th>
                <th className="py-1.5 pr-2">Required</th>
                <th className="py-1.5 pr-2">WEBEE destination</th>
                <th className="py-1.5 pr-2">CRM field API code</th>
                {crmFocus && <th className="py-1.5 pr-2">Default value</th>}
                <th className="py-1.5 pr-2">Status</th>
                <th className="py-1.5" />
              </tr>
            </thead>
            <tbody>
              {mappings.map((m) => {
                const sv: any = scanned.get(m.variable);
                const st = mappingStatus(m, externalCrm);
                return (
                  <tr key={m.variable} id={`setup-var-${m.variable}`} className={`border-b border-border/50 align-top ${m.ignored ? "opacity-50" : ""}`}>
                    <td className="py-1.5 pr-2 font-mono text-[11px]">{`{{${m.variable}}}`}</td>
                    {!crmFocus && (
                      <td className="max-w-[160px] py-1.5 pr-2 text-[10px] text-muted-foreground">
                        {(sv?.foundIn ?? ["—"]).slice(0, 2).join("; ")}
                      </td>
                    )}
                    <td className="py-1.5 pr-2">{m.fieldType || sv?.type || "text"}</td>
                    <td className="py-1.5 pr-2">
                      <button className="text-[10px] underline-offset-2 hover:underline"
                        onClick={() => update.mutate([{ variable: m.variable, required: !m.required }])}>
                        {m.required ? "required" : "optional"}
                      </button>
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input className="h-6 w-44 text-[11px]" placeholder="lead.meta.…"
                        value={draftVal(m.variable, "webeeField", m.webeeField ?? "")}
                        onChange={(e) => setDraft(m.variable, "webeeField", e.target.value)}
                        onBlur={(e) => e.target.value !== m.webeeField && commit(m.variable, "webeeField", e.target.value)} />
                    </td>
                    <td className="py-1.5 pr-2">
                      <Input className="h-6 w-40 text-[11px]" placeholder={externalCrm ? "e.g. new_budget" : "(no CRM)"}
                        disabled={!externalCrm}
                        value={draftVal(m.variable, "crmField", m.crmField ?? "")}
                        onChange={(e) => setDraft(m.variable, "crmField", e.target.value)}
                        onBlur={(e) => e.target.value !== m.crmField && commit(m.variable, "crmField", e.target.value)} />
                    </td>
                    {crmFocus && (
                      <td className="py-1.5 pr-2">
                        <Input className="h-6 w-28 text-[11px]" placeholder="default"
                          value={draftVal(m.variable, "defaultValue", m.defaultValue ?? "")}
                          onChange={(e) => setDraft(m.variable, "defaultValue", e.target.value)}
                          onBlur={(e) => e.target.value !== m.defaultValue && commit(m.variable, "defaultValue", e.target.value)} />
                      </td>
                    )}
                    <td className="py-1.5 pr-2">
                      <Badge className={`text-[9px] ${st.cls}`}>{st.text}</Badge>
                      {m.suggested && !m.approved && m.confidence && (
                        <div className="mt-0.5 text-[9px] text-muted-foreground">confidence: {m.confidence}</div>
                      )}
                    </td>
                    <td className="py-1.5">
                      <div className="flex items-center gap-1">
                        {m.suggested && !m.approved && !m.ignored && (
                          <Button size="sm" variant="secondary" className="h-6 px-1.5 text-[10px]"
                            onClick={() => update.mutate([{ variable: m.variable, approved: true }])}>
                            <CheckCircle2 className="mr-0.5 h-3 w-3" /> Approve
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]"
                          onClick={() => update.mutate([{ variable: m.variable, ignored: !m.ignored }])}>
                          {m.ignored ? "Restore" : "Ignore"}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {mappings.length === 0 && (
                <tr><td colSpan={9} className="py-6 text-center text-muted-foreground">
                  No variables detected yet — run the agent scan from the Linked Agent tab.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <Input className="h-7 w-44 text-[11px]" placeholder="Add custom field name…"
            value={newVar} onChange={(e) => setNewVar(e.target.value)} />
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!newVar.trim() || update.isPending}
            onClick={() => {
              const name = newVar.trim().replace(/[^a-zA-Z0-9_.-]/g, "_");
              update.mutate([{ variable: name, webeeField: `lead.meta.${name.toLowerCase()}`, approved: true }]);
              setNewVar("");
            }}>
            <Plus className="mr-1 h-3 w-3" /> Add custom field
          </Button>
          {mappings.some((m) => m.suggested && !m.approved && !m.ignored) && (
            <Button size="sm" variant="secondary" className="h-7 text-xs" disabled={update.isPending}
              onClick={() => update.mutate(
                mappings.filter((m) => m.suggested && !m.approved && !m.ignored).map((m) => ({ variable: m.variable, approved: true })),
              )}>
              <Sparkles className="mr-1 h-3 w-3" /> Approve all suggestions
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Trigger rules panel ────────────────────────────────────────────────────────

const TRIGGER_SOURCES = [
  { value: "webee_lead_status",      label: "WEBEE lead status" },
  { value: "webee_pipeline",         label: "WEBEE qualified pipeline" },
  { value: "crm_lead_status",        label: "CRM lead status" },
  { value: "crm_deal_stage",         label: "CRM deal stage" },
  { value: "crm_appointment_status", label: "CRM appointment status" },
  { value: "campaign_event",         label: "Campaign event" },
  { value: "call_outcome",           label: "Call outcome" },
  { value: "custom_webhook",         label: "Custom webhook" },
];
const TRIGGER_OBJECTS = ["lead", "contact", "deal", "appointment", "campaign_lead", "custom"];

export function TriggerRulesPanel({
  sessionId, setup,
}: { sessionId: string; setup: ReturnType<typeof useSetupConsole> }) {
  const updateFn = useServerFn(updateSetupState);
  const state = setup.state;
  const [drafts, setDrafts] = useState<Record<string, any>>({});

  const update = useMutation({
    mutationFn: (triggers: any[]) => updateFn({ data: { sessionId, triggers } }),
    onSuccess: (res: any) => { setup.setData(res); setDrafts({}); },
    onError: (e: any) => toast.error("Could not save trigger rules", { description: e?.message }),
  });

  if (!state) return <ScanFirstNote />;
  const triggers: any[] = state.triggers ?? [];

  const saveRow = (id: string, patch: Record<string, string>) => {
    update.mutate(triggers.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };
  const addRow = () => {
    const id = `trg_${Date.now().toString(36)}`;
    update.mutate([...triggers, {
      id, source: "webee_lead_status", object: "lead", fieldLabel: "Status",
      fieldApiCode: "status", statusName: "", statusCode: "", condition: "changes_to", action: "",
    }]);
  };

  return (
    <Card id="setup-trigger-rules">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ChevronRight className="h-4 w-4 text-emerald-400" /> Workflow Trigger Rules
          <Badge variant="outline" className="text-[10px]">{triggers.length}</Badge>
        </CardTitle>
        <p className="text-[11px] text-muted-foreground">{HELPER.triggerSource}</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {triggers.map((t) => {
          const crmTrigger = /^crm_/.test(t.source);
          const d = drafts[t.id] ?? {};
          const val = (k: string) => d[k] ?? t[k] ?? "";
          const setD = (k: string, v: string) => setDrafts((all) => ({ ...all, [t.id]: { ...all[t.id], [k]: v } }));
          const blur = (k: string) => { if (d[k] !== undefined && d[k] !== t[k]) saveRow(t.id, { [k]: d[k] }); };
          return (
            <div key={t.id} id={`setup-trigger-${t.id}`} className="rounded-md border border-border p-2">
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-[10px]">Trigger source</Label>
                  <Select value={t.source} onValueChange={(v) => saveRow(t.id, { source: v })}>
                    <SelectTrigger className="h-7 text-[11px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TRIGGER_SOURCES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px]">Object</Label>
                  <Select value={t.object} onValueChange={(v) => saveRow(t.id, { object: v })}>
                    <SelectTrigger className="h-7 text-[11px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TRIGGER_OBJECTS.map((o) => <SelectItem key={o} value={o}>{o.replace("_", " ")}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px]">Condition</Label>
                  <Select value={t.condition || "changes_to"} onValueChange={(v) => saveRow(t.id, { condition: v })}>
                    <SelectTrigger className="h-7 text-[11px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="changes_to">changes to</SelectItem>
                      <SelectItem value="equals">equals</SelectItem>
                      <SelectItem value="contains">contains</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px]">Field label</Label>
                  <Input className="h-7 text-[11px]" value={val("fieldLabel")} placeholder="e.g. Lead Status"
                    onChange={(e) => setD("fieldLabel", e.target.value)} onBlur={() => blur("fieldLabel")} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px]">Field API code{crmTrigger ? " (required)" : ""}</Label>
                  <Input className="h-7 text-[11px]" value={val("fieldApiCode")} placeholder="e.g. statuscode"
                    onChange={(e) => setD("fieldApiCode", e.target.value)} onBlur={() => blur("fieldApiCode")} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px]">Status name</Label>
                  <Input className="h-7 text-[11px]" value={val("statusName")} placeholder="e.g. Qualified"
                    onChange={(e) => setD("statusName", e.target.value)} onBlur={() => blur("statusName")} />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px]">Status code{crmTrigger ? " (required)" : ""}</Label>
                  <Input className="h-7 text-[11px]" value={val("statusCode")} placeholder="e.g. 100000001"
                    onChange={(e) => setD("statusCode", e.target.value)} onBlur={() => blur("statusCode")} />
                  {crmTrigger && <p className="text-[9px] text-muted-foreground">{HELPER.statusCode}</p>}
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-[10px]">Action to run</Label>
                  <Input className="h-7 text-[11px]" value={val("action")} placeholder="e.g. Start follow-up workflow"
                    onChange={(e) => setD("action", e.target.value)} onBlur={() => blur("action")} />
                </div>
              </div>
              <div className="mt-1.5 flex justify-end">
                <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[10px] text-red-400"
                  onClick={() => update.mutate(triggers.filter((x) => x.id !== t.id))}>
                  <Trash2 className="mr-0.5 h-3 w-3" /> Remove
                </Button>
              </div>
            </div>
          );
        })}
        {triggers.length === 0 && (
          <div className="rounded-md border border-dashed border-border p-4 text-center text-[11px] text-muted-foreground">
            No trigger rules yet. Add at least one so the workflow knows where to start from.
          </div>
        )}
        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={update.isPending} onClick={addRow}>
          <Plus className="mr-1 h-3 w-3" /> Add trigger rule
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Test panel ─────────────────────────────────────────────────────────────────

export function SetupTestPanel({
  sessionId, setup,
}: { sessionId: string; setup: ReturnType<typeof useSetupConsole> }) {
  const genFn = useServerFn(generateSetupTestPayload);
  const runFn = useServerFn(runSetupTest);
  const approveFn = useServerFn(approveSetup);

  const gen = useMutation({
    mutationFn: () => genFn({ data: { sessionId } }),
    onSuccess: (res: any) => setup.setData(res),
    onError: (e: any) => toast.error("Could not generate payload", { description: e?.message }),
  });
  const run = useMutation({
    mutationFn: () => runFn({ data: { sessionId } }),
    onSuccess: (res: any) => {
      setup.setData(res);
      const t = res?.state?.test;
      t?.runOk ? toast.success("Test run passed") : toast.error("Test run found problems", { description: t?.runNotes });
    },
    onError: (e: any) => toast.error("Test run failed", { description: e?.message }),
  });
  const approve = useMutation({
    mutationFn: () => approveFn({ data: { sessionId } }),
    onSuccess: (res: any) => { setup.setData(res); toast.success("Setup approved — Apply is now unlocked (if everything else is complete)."); },
    onError: (e: any) => toast.error("Could not approve", { description: e?.message }),
  });

  const state = setup.state;
  if (!state) return <ScanFirstNote />;
  const test = state.test ?? {};

  return (
    <Card id="setup-test-payload">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Setup Test Payload</CardTitle>
        <p className="text-[11px] text-muted-foreground">
          A dry run checks the payload maps cleanly with your saved mappings and trigger rules — nothing is written to your CRM.
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" className="h-7 text-xs" disabled={gen.isPending} onClick={() => gen.mutate()}>
            {gen.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null} Generate test payload
          </Button>
          <Button size="sm" variant="secondary" className="h-7 text-xs" disabled={!test.payload || run.isPending} onClick={() => run.mutate()}>
            {run.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null} Run test
          </Button>
          <Button id="setup-test-approve" size="sm" variant="outline" className="h-7 text-xs"
            disabled={!test.runAt || test.runOk === false || approve.isPending || !!test.approvedAt}
            onClick={() => approve.mutate()}>
            {test.approvedAt ? <><CheckCircle2 className="mr-1 h-3 w-3 text-emerald-400" /> Approved</> : "Approve setup"}
          </Button>
        </div>
        {test.runAt && (
          <div className={`rounded-md border p-2 text-[11px] ${test.runOk ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-red-500/30 bg-red-500/10 text-red-300"}`}>
            {test.runNotes}
          </div>
        )}
        {test.payload && (
          <pre className="max-h-72 overflow-auto rounded-md border border-border bg-muted/30 p-2 text-[10px] leading-relaxed">
            {JSON.stringify(test.payload, null, 2)}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}

// ── Required inputs panel ──────────────────────────────────────────────────────

const GROUP_LABEL: Record<string, string> = {
  context: "Required Context", agent: "Agent", crm_access: "CRM Access",
  variables: "Variable Mapping", triggers: "Trigger Rules", testing: "Testing",
};

export function RequiredInputsPanel({
  setup, onGoToTab,
}: {
  setup: ReturnType<typeof useSetupConsole>;
  onGoToTab: (tab: string) => void;
}) {
  const items = setup.requiredInputs;
  const missing = missingRequiredCount(items);
  const groups = useMemo(() => {
    const g = new Map<string, any[]>();
    for (const i of items) {
      if (!g.has(i.group)) g.set(i.group, []);
      g.get(i.group)!.push(i);
    }
    return [...g.entries()];
  }, [items]);

  if (!setup.state) return null;

  return (
    <Card id="setup-required-inputs">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          {missing === 0
            ? <CheckCircle2 className="h-4 w-4 text-emerald-400" />
            : <CircleAlert className="h-4 w-4 text-amber-400" />}
          Required Setup Inputs
          <Badge className={`text-[10px] ${missing === 0 ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"}`}>
            {missing === 0 ? "all complete" : `${missing} remaining — fill them in below`}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {groups.map(([group, list]) => (
          <div key={group}>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {GROUP_LABEL[group] ?? group}
            </div>
            <div className="space-y-1">
              {list.map((i: any) => (
                <div key={i.key} className="flex items-center gap-2 text-xs">
                  {i.done
                    ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                    : <XCircle className="h-3.5 w-3.5 shrink-0 text-amber-400" />}
                  <span className={i.done ? "text-muted-foreground" : ""}>{i.label}</span>
                  {!i.done && (
                    <Button size="sm" variant="outline" className="ml-auto h-6 px-2 text-[10px]"
                      onClick={() => { onGoToTab(i.tab); scrollToAnchor(i.anchor); }}>
                      Fill in
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
