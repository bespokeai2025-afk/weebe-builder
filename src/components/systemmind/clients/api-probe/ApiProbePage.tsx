import { useState, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listClientApiConnections,
  saveClientApiConnection,
  deleteClientApiConnection,
} from "@/lib/systemmind/client-api-connections.server";
import {
  testApiConnection,
  probeEndpoint,
  detectPagination,
  requestApiOtp,
  verifyApiOtp,
} from "@/lib/systemmind/api-probe-engine.server";
import {
  listEndpointMappings,
  saveEndpointMapping,
  deleteEndpointMapping,
  WEBEE_MODULE_KEYS,
} from "@/lib/systemmind/client-api-mappings.server";
import { seedWebuyanyhouse } from "@/lib/systemmind/client-api-connections.server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Activity, Plus, Trash2, Play, Save, RefreshCw, ChevronDown,
  ChevronRight, Shield, AlertTriangle, CheckCircle2, Clock, Database,
  ArrowRight, Loader2, Eye, EyeOff, Copy,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ── Types ─────────────────────────────────────────────────────────────────────

type AuthType = "bearer_token" | "api_key_header" | "basic_auth" | "oauth_placeholder" | "otp" | "custom_headers";

interface Connection {
  id: string;
  name: string;
  base_url: string;
  auth_type: AuthType;
  hasCredentials: boolean;
  status: string;
  notes?: string | null;
}

const AUTH_TYPE_LABELS: Record<AuthType, string> = {
  bearer_token:       "Bearer Token",
  api_key_header:     "API Key Header",
  basic_auth:         "Basic Auth (user:pass)",
  oauth_placeholder:  "OAuth (placeholder)",
  otp:                "OTP / Two-factor",
  custom_headers:     "Custom Headers (JSON)",
};

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    connected: "bg-emerald-500/20 text-emerald-400",
    error:     "bg-red-500/20 text-red-400",
    untested:  "bg-gray-700 text-gray-400",
  };
  return (
    <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-medium", colors[status] ?? colors.untested)}>
      {status}
    </span>
  );
}

// ── Panel wrapper ─────────────────────────────────────────────────────────────

function Panel({ title, icon: Icon, children, accent = "sky" }: {
  title: string; icon: React.ElementType; children: React.ReactNode; accent?: string;
}) {
  const cls = accent === "emerald" ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20"
    : accent === "violet" ? "text-violet-400 bg-violet-500/10 border-violet-500/20"
    : "text-sky-400 bg-sky-500/10 border-sky-500/20";
  return (
    <div className="rounded-xl border border-white/[0.06] bg-gray-900/40 overflow-hidden">
      <div className={cn("flex items-center gap-2 px-4 py-3 border-b border-white/[0.06]", ``)}>
        <div className={cn("flex h-6 w-6 items-center justify-center rounded border", cls)}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <span className="text-sm font-semibold text-white">{title}</span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// ── Key-value editor ──────────────────────────────────────────────────────────

function KVEditor({
  value, onChange, placeholder = "key",
}: {
  value: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  placeholder?: string;
}) {
  const entries = Object.entries(value);
  return (
    <div className="space-y-1.5">
      {entries.map(([k, v], i) => (
        <div key={i} className="flex gap-1.5">
          <Input
            value={k}
            onChange={(e) => {
              const next = { ...value };
              delete next[k];
              next[e.target.value] = v;
              onChange(next);
            }}
            className="bg-gray-800 border-gray-700 text-white text-xs h-7 flex-1"
            placeholder={placeholder}
          />
          <Input
            value={v}
            onChange={(e) => onChange({ ...value, [k]: e.target.value })}
            className="bg-gray-800 border-gray-700 text-white text-xs h-7 flex-1"
            placeholder="value"
          />
          <button
            onClick={() => {
              const next = { ...value };
              delete next[k];
              onChange(next);
            }}
            className="text-gray-600 hover:text-red-400 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <button
        onClick={() => onChange({ ...value, "": "" })}
        className="flex items-center gap-1 text-xs text-gray-500 hover:text-sky-400 transition-colors"
      >
        <Plus className="w-3 h-3" /> Add row
      </button>
    </div>
  );
}

// ── OTP Sub-flow ──────────────────────────────────────────────────────────────

function OtpSubflow({ connectionId, baseUrl }: { connectionId: string; baseUrl: string }) {
  const [step, setStep]     = useState<"idle" | "sent" | "verified">("idle");
  const [email, setEmail]   = useState("admin@webuyanyhouse.co.uk");
  const [code, setCode]     = useState("");
  const [loading, setLoading] = useState(false);

  const requestFn = useServerFn(requestApiOtp);
  const verifyFn  = useServerFn(verifyApiOtp);

  async function handleRequest() {
    setLoading(true);
    try {
      await requestFn({ data: {
        connectionId,
        otpEndpoint:  "/admin/auth/request-otp",
        emailField:   "email",
        emailValue:   email,
      }});
      toast.success("OTP sent — check email");
      setStep("sent");
    } catch (e: any) {
      toast.error(e?.message ?? "OTP request failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify() {
    setLoading(true);
    try {
      await verifyFn({ data: {
        connectionId,
        verifyEndpoint: "/admin/auth/verify-otp",
        emailField:     "email",
        emailValue:     email,
        otpField:       "otp",
        otpValue:       code,
      }});
      toast.success("OTP verified — token stored server-side");
      setStep("verified");
    } catch (e: any) {
      toast.error(e?.message ?? "Verification failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-3 space-y-3">
      <p className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
        <Shield className="w-3.5 h-3.5" /> OTP Authentication Flow
      </p>

      <div className="space-y-2">
        <div>
          <Label className="text-xs text-gray-400">Admin Email</Label>
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 bg-gray-800 border-gray-700 text-white text-xs h-7"
            placeholder="admin@example.com"
          />
        </div>

        <Button
          size="sm"
          variant="outline"
          className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10 h-7 text-xs gap-1"
          onClick={handleRequest}
          disabled={loading || step === "verified"}
        >
          {loading && step === "idle" ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowRight className="w-3 h-3" />}
          {step === "idle" ? "Step 1: Request OTP" : "Resend OTP"}
        </Button>
      </div>

      {(step === "sent" || step === "verified") && (
        <div className="space-y-2">
          <div>
            <Label className="text-xs text-gray-400">OTP Code</Label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="mt-1 bg-gray-800 border-gray-700 text-white text-xs h-7 font-mono"
              placeholder="123456"
            />
          </div>
          <Button
            size="sm"
            className="bg-amber-600 hover:bg-amber-700 text-white h-7 text-xs gap-1"
            onClick={handleVerify}
            disabled={loading || !code || step === "verified"}
          >
            {loading && step === "sent" ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
            {step === "verified" ? "Verified ✓" : "Step 2: Verify OTP"}
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Saved Mappings Tab ────────────────────────────────────────────────────────

function SavedMappingsTab({ connectionId }: { connectionId: string }) {
  const listFn   = useServerFn(listEndpointMappings);
  const saveFn   = useServerFn(saveEndpointMapping);
  const deleteFn = useServerFn(deleteEndpointMapping);
  const qc       = useQueryClient();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editModule, setEditModule] = useState("");
  const [editMapping, setEditMapping] = useState("");

  const { data: mappings = [], isLoading } = useQuery({
    queryKey: ["endpoint-mappings", connectionId],
    queryFn:  () => listFn({ data: { connectionId } }),
    throwOnError: false,
  });

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this mapping?")) return;
    await deleteFn({ data: { id } });
    qc.invalidateQueries({ queryKey: ["endpoint-mappings", connectionId] });
    toast.success("Mapping deleted");
  };

  const handleSaveEdit = async (mapping: any) => {
    let fieldMapping: any = undefined;
    try { fieldMapping = JSON.parse(editMapping); } catch { fieldMapping = undefined; }
    await saveFn({ data: {
      id:                  mapping.id,
      connectionId:        mapping.client_api_connection_id,
      moduleKey:           editModule,
      endpointPath:        mapping.endpoint_path,
      method:              mapping.method,
      paginationStrategy:  mapping.pagination_strategy ?? undefined,
      detectedArrayPath:   mapping.detected_array_path ?? undefined,
      fieldMapping,
    }});
    qc.invalidateQueries({ queryKey: ["endpoint-mappings", connectionId] });
    setEditingId(null);
    toast.success("Mapping updated");
  };

  if (isLoading) return <div className="flex items-center gap-2 text-gray-500 text-sm"><Loader2 className="w-4 h-4 animate-spin" />Loading…</div>;

  return (
    <div className="space-y-2">
      {(mappings as any[]).length === 0 && (
        <p className="text-sm text-gray-500 py-4 text-center">No mappings saved yet. Use the Request Builder to probe endpoints and save mappings.</p>
      )}
      {(mappings as any[]).map((m: any) => (
        <div key={m.id} className="rounded-lg border border-white/[0.06] bg-gray-950/60 p-3">
          {editingId === m.id ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs text-gray-400">Module</Label>
                  <Select value={editModule} onValueChange={setEditModule}>
                    <SelectTrigger className="mt-1 bg-gray-800 border-gray-700 text-white text-xs h-7">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-gray-800 border-gray-700">
                      {WEBEE_MODULE_KEYS.map((mk) => (
                        <SelectItem key={mk.key} value={mk.key}>{mk.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-gray-400">Field Mapping (JSON)</Label>
                  <Input
                    value={editMapping}
                    onChange={(e) => setEditMapping(e.target.value)}
                    className="mt-1 bg-gray-800 border-gray-700 text-white text-xs h-7 font-mono"
                    placeholder='{"externalKey": "webeeField"}'
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="h-6 text-xs bg-sky-600 hover:bg-sky-700" onClick={() => handleSaveEdit(m)}>Save</Button>
                <Button size="sm" variant="outline" className="h-6 text-xs border-gray-700" onClick={() => setEditingId(null)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 flex-wrap">
              <div className="font-mono text-xs text-sky-300 truncate flex-1 min-w-0">{m.method} {m.endpoint_path}</div>
              <Badge className="text-[10px] bg-violet-500/20 text-violet-400 border-0">{m.module_key}</Badge>
              {m.pagination_strategy && m.pagination_strategy !== "none" && (
                <span className="text-[10px] text-gray-500">{m.pagination_strategy}</span>
              )}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => { setEditingId(m.id); setEditModule(m.module_key); setEditMapping(m.field_mapping ? JSON.stringify(m.field_mapping, null, 2) : ""); }}
                  className="text-xs text-gray-400 hover:text-white px-1.5 py-0.5 rounded border border-gray-700 hover:border-gray-500 transition-colors"
                >
                  Edit
                </button>
                <button onClick={() => handleDelete(m.id)} className="text-gray-600 hover:text-red-400 transition-colors p-0.5">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function ApiProbePage() {
  const listConnFn   = useServerFn(listClientApiConnections);
  const saveConnFn   = useServerFn(saveClientApiConnection);
  const deleteConnFn = useServerFn(deleteClientApiConnection);
  const testConnFn   = useServerFn(testApiConnection);
  const probeEndFn   = useServerFn(probeEndpoint);
  const detectPagFn  = useServerFn(detectPagination);
  const saveMappFn   = useServerFn(saveEndpointMapping);
  const seedWbahFn   = useServerFn(seedWebuyanyhouse);
  const qc           = useQueryClient();

  const [activeTab, setActiveTab] = useState<"probe" | "mappings">("probe");
  const [selectedId, setSelectedId]   = useState<string | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);

  const [newName, setNewName]       = useState("");
  const [newBaseUrl, setNewBaseUrl] = useState("");
  const [newAuthType, setNewAuthType] = useState<AuthType>("bearer_token");
  const [newCreds, setNewCreds]     = useState<Record<string, string>>({});
  const [newNotes, setNewNotes]     = useState("");
  const [showCreds, setShowCreds]   = useState(false);
  const [savingConn, setSavingConn] = useState(false);

  const [epPath, setEpPath]     = useState("");
  const [epMethod, setEpMethod] = useState("GET");
  const [epParams, setEpParams] = useState<Record<string, string>>({});
  const [epBody, setEpBody]     = useState("");

  const [probeResult, setProbeResult]   = useState<any | null>(null);
  const [testResult, setTestResult]     = useState<any | null>(null);
  const [pagResult, setPagResult]       = useState<any | null>(null);
  const [probing, setProbing]           = useState(false);
  const [testing, setTesting]           = useState(false);
  const [detectingPag, setDetectingPag] = useState(false);

  const [selectedModule, setSelectedModule] = useState("");
  const [savingMapping, setSavingMapping]   = useState(false);

  const { data: connections = [], isLoading } = useQuery({
    queryKey: ["client-api-connections"],
    queryFn:  () => listConnFn(),
    throwOnError: false,
  });

  const selectedConn = (connections as Connection[]).find((c) => c.id === selectedId) ?? null;

  useEffect(() => {
    if (!isLoading && (connections as Connection[]).length === 0 && !creatingNew) {
      seedWbahFn().then(() => {
        qc.invalidateQueries({ queryKey: ["client-api-connections"] });
      }).catch(() => {});
    }
  }, [isLoading, (connections as Connection[]).length]);

  function startNew() {
    setCreatingNew(true);
    setSelectedId(null);
    setNewName(""); setNewBaseUrl(""); setNewAuthType("bearer_token");
    setNewCreds({}); setNewNotes("");
  }

  async function handleSaveConnection() {
    if (!newName || !newBaseUrl) { toast.error("Name and base URL are required"); return; }
    setSavingConn(true);
    try {
      const saved = await saveConnFn({ data: {
        id:          selectedId ?? undefined,
        name:        newName,
        baseUrl:     newBaseUrl,
        authType:    newAuthType,
        credentials: Object.keys(newCreds).length > 0 ? newCreds : undefined,
        notes:       newNotes || undefined,
      }});
      qc.invalidateQueries({ queryKey: ["client-api-connections"] });
      setSelectedId((saved as Connection).id);
      setCreatingNew(false);
      setShowCreds(false);
      toast.success("Connection saved");
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    } finally {
      setSavingConn(false);
    }
  }

  function loadConnection(conn: Connection) {
    setSelectedId(conn.id);
    setCreatingNew(false);
    setNewName(conn.name);
    setNewBaseUrl(conn.base_url);
    setNewAuthType(conn.auth_type);
    setNewCreds({});
    setNewNotes(conn.notes ?? "");
    setProbeResult(null);
    setTestResult(null);
    setPagResult(null);
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this connection and all its mappings?")) return;
    await deleteConnFn({ data: { id } });
    qc.invalidateQueries({ queryKey: ["client-api-connections"] });
    if (selectedId === id) { setSelectedId(null); setCreatingNew(false); }
    toast.success("Connection deleted");
  }

  async function handleTest() {
    if (!selectedId) return;
    setTesting(true);
    try {
      const r = await testConnFn({ data: { connectionId: selectedId } });
      setTestResult(r);
      qc.invalidateQueries({ queryKey: ["client-api-connections"] });
      toast[r.ok ? "success" : "error"](r.ok ? `Connected (${r.latencyMs}ms)` : `Failed (HTTP ${r.status})`);
    } catch (e: any) {
      toast.error(e?.message ?? "Test failed");
    } finally {
      setTesting(false);
    }
  }

  async function handleProbe() {
    if (!selectedId || !epPath) return;
    setProbing(true);
    try {
      let body: Record<string, unknown> | undefined;
      if (epBody.trim()) { try { body = JSON.parse(epBody); } catch { toast.error("Invalid JSON in request body"); setProbing(false); return; } }
      const r = await probeEndFn({ data: {
        connectionId: selectedId,
        endpointPath: epPath,
        method:       epMethod,
        queryParams:  Object.keys(epParams).length > 0 ? epParams : undefined,
        body,
      }});
      setProbeResult(r);
      if (r.suggestedModules?.[0]) setSelectedModule(r.suggestedModules[0]);
    } catch (e: any) {
      toast.error(e?.message ?? "Probe failed");
    } finally {
      setProbing(false);
    }
  }

  async function handleDetectPagination() {
    if (!selectedId || !epPath) return;
    setDetectingPag(true);
    try {
      const r = await detectPagFn({ data: { connectionId: selectedId, endpointPath: epPath, method: epMethod } });
      setPagResult(r);
    } catch (e: any) {
      toast.error(e?.message ?? "Detection failed");
    } finally {
      setDetectingPag(false);
    }
  }

  async function handleSaveMapping() {
    if (!selectedId || !epPath || !selectedModule) { toast.error("Select a connection, endpoint, and module"); return; }
    setSavingMapping(true);
    try {
      await saveMappFn({ data: {
        connectionId:        selectedId,
        moduleKey:           selectedModule,
        endpointPath:        epPath,
        method:              epMethod,
        queryParams:         Object.keys(epParams).length > 0 ? epParams : undefined,
        detectedArrayPath:   probeResult?.arrayPath ?? undefined,
        paginationStrategy:  pagResult?.strategy ?? undefined,
      }});
      qc.invalidateQueries({ queryKey: ["endpoint-mappings", selectedId] });
      toast.success("Mapping saved");
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    } finally {
      setSavingMapping(false);
    }
  }

  const showOtp = (creatingNew || selectedConn) && (newAuthType === "otp");

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <Activity className="w-5 h-5 text-sky-400" /> API Probe
        </h1>
        <p className="text-sm text-gray-400 mt-0.5">Connect, test, and map external client APIs to WEBEE modules</p>
      </div>

      <div className="grid lg:grid-cols-[280px_1fr] gap-4">
        {/* ── Left: Connection list ─────────────────────────────────────────── */}
        <div className="space-y-2">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Connections</p>
            <button onClick={startNew} className="flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300 transition-colors">
              <Plus className="w-3 h-3" /> New
            </button>
          </div>

          {isLoading && <div className="flex items-center gap-2 text-gray-500 text-xs"><Loader2 className="w-3 h-3 animate-spin" />Loading…</div>}

          {(connections as Connection[]).map((conn) => (
            <button
              key={conn.id}
              onClick={() => loadConnection(conn)}
              className={cn(
                "w-full text-left rounded-lg border p-3 transition-all",
                selectedId === conn.id && !creatingNew
                  ? "border-sky-500/30 bg-sky-500/10"
                  : "border-white/[0.06] bg-gray-900/40 hover:border-white/10"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-white truncate">{conn.name}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(conn.id); }}
                  className="text-gray-600 hover:text-red-400 transition-colors shrink-0"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <StatusBadge status={conn.status} />
                <span className="text-[10px] text-gray-600 truncate">{conn.base_url}</span>
              </div>
            </button>
          ))}

          {!isLoading && (connections as Connection[]).length === 0 && !creatingNew && (
            <p className="text-xs text-gray-600 text-center py-2">No connections. Click New to add one.</p>
          )}
        </div>

        {/* ── Right: Panels ────────────────────────────────────────────────── */}
        <div className="space-y-4">
          {/* Panel A: Connection Settings */}
          {(selectedConn || creatingNew) && (
            <Panel title="Connection Settings" icon={Database} accent="sky">
              <div className="space-y-3">
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-gray-400">Name</Label>
                    <Input value={newName} onChange={(e) => setNewName(e.target.value)} className="mt-1 bg-gray-800 border-gray-700 text-white text-xs h-8" placeholder="e.g. Webuyanyhouse" />
                  </div>
                  <div>
                    <Label className="text-xs text-gray-400">Base URL</Label>
                    <Input value={newBaseUrl} onChange={(e) => setNewBaseUrl(e.target.value)} className="mt-1 bg-gray-800 border-gray-700 text-white text-xs h-8 font-mono" placeholder="https://api.example.com" />
                  </div>
                </div>

                <div>
                  <Label className="text-xs text-gray-400">Auth Type</Label>
                  <Select value={newAuthType} onValueChange={(v) => setNewAuthType(v as AuthType)}>
                    <SelectTrigger className="mt-1 bg-gray-800 border-gray-700 text-white text-xs h-8"><SelectValue /></SelectTrigger>
                    <SelectContent className="bg-gray-800 border-gray-700">
                      {Object.entries(AUTH_TYPE_LABELS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {newAuthType !== "otp" && newAuthType !== "oauth_placeholder" && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <Label className="text-xs text-gray-400">
                        Credentials
                        {selectedConn?.hasCredentials && !showCreds && (
                          <span className="ml-2 text-[10px] text-emerald-400">● Saved (hidden)</span>
                        )}
                      </Label>
                      <button onClick={() => setShowCreds(!showCreds)} className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1">
                        {showCreds ? <><EyeOff className="w-3 h-3" /> Hide</> : <><Eye className="w-3 h-3" /> Show</>}
                      </button>
                    </div>

                    {showCreds && (
                      <>
                        {newAuthType === "bearer_token" && (
                          <Input
                            type="password"
                            value={newCreds.token ?? ""}
                            onChange={(e) => setNewCreds({ token: e.target.value })}
                            className="bg-gray-800 border-gray-700 text-white text-xs h-8 font-mono"
                            placeholder="Bearer token value"
                          />
                        )}
                        {newAuthType === "api_key_header" && (
                          <div className="grid grid-cols-2 gap-2">
                            <Input value={newCreds.headerName ?? ""} onChange={(e) => setNewCreds({ ...newCreds, headerName: e.target.value })} className="bg-gray-800 border-gray-700 text-white text-xs h-8" placeholder="Header name (e.g. X-Api-Key)" />
                            <Input type="password" value={newCreds.apiKey ?? ""} onChange={(e) => setNewCreds({ ...newCreds, apiKey: e.target.value })} className="bg-gray-800 border-gray-700 text-white text-xs h-8 font-mono" placeholder="API key value" />
                          </div>
                        )}
                        {newAuthType === "basic_auth" && (
                          <div className="grid grid-cols-2 gap-2">
                            <Input value={newCreds.username ?? ""} onChange={(e) => setNewCreds({ ...newCreds, username: e.target.value })} className="bg-gray-800 border-gray-700 text-white text-xs h-8" placeholder="Username" />
                            <Input type="password" value={newCreds.password ?? ""} onChange={(e) => setNewCreds({ ...newCreds, password: e.target.value })} className="bg-gray-800 border-gray-700 text-white text-xs h-8 font-mono" placeholder="Password" />
                          </div>
                        )}
                        {newAuthType === "custom_headers" && (
                          <Textarea value={newCreds.headers ?? ""} onChange={(e) => setNewCreds({ headers: e.target.value })} className="bg-gray-800 border-gray-700 text-white text-xs font-mono" rows={3} placeholder='{"X-Custom-Header": "value"}' />
                        )}
                      </>
                    )}
                  </div>
                )}

                {newAuthType === "oauth_placeholder" && (
                  <div className="rounded-lg border border-gray-700 bg-gray-800/60 px-3 py-2 text-xs text-gray-500">
                    OAuth flows are not implemented in this version. Use Bearer Token or API Key Header for OAuth-issued tokens.
                  </div>
                )}

                <div>
                  <Label className="text-xs text-gray-400">Notes (optional)</Label>
                  <Input value={newNotes} onChange={(e) => setNewNotes(e.target.value)} className="mt-1 bg-gray-800 border-gray-700 text-white text-xs h-8" placeholder="Any notes about this connection" />
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <Button size="sm" onClick={handleSaveConnection} disabled={savingConn} className="bg-sky-600 hover:bg-sky-700 text-white text-xs h-7 gap-1">
                    {savingConn ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                    {creatingNew ? "Create" : "Update"}
                  </Button>
                  {selectedConn && (
                    <Button size="sm" variant="outline" onClick={handleTest} disabled={testing} className="border-gray-700 text-gray-300 text-xs h-7 gap-1">
                      {testing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                      Test Connection
                    </Button>
                  )}
                  {testResult && (
                    <span className={cn("text-xs", testResult.ok ? "text-emerald-400" : "text-red-400")}>
                      {testResult.ok ? `● ${testResult.status} (${testResult.latencyMs}ms)` : `✗ ${testResult.status} — ${testResult.error ?? "failed"}`}
                    </span>
                  )}
                </div>

                {/* OTP sub-flow */}
                {showOtp && selectedId && (
                  <OtpSubflow connectionId={selectedId} baseUrl={newBaseUrl} />
                )}
              </div>
            </Panel>
          )}

          {/* Tabs: Request Builder / Saved Mappings */}
          {selectedId && (
            <>
              <div className="flex gap-1 border-b border-white/[0.06] pb-px">
                {(["probe", "mappings"] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setActiveTab(t)}
                    className={cn(
                      "px-4 py-2 text-xs font-medium capitalize transition-colors border-b-2 -mb-px",
                      activeTab === t
                        ? "border-sky-400 text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {t === "probe" ? "Request Builder" : "Saved Mappings"}
                  </button>
                ))}
              </div>

              {/* Panel B: Request Builder */}
              {activeTab === "probe" && (
                <Panel title="Request Builder" icon={Play} accent="emerald">
                  <div className="space-y-3">
                    <div className="flex gap-2">
                      <Select value={epMethod} onValueChange={setEpMethod}>
                        <SelectTrigger className="w-24 bg-gray-800 border-gray-700 text-white text-xs h-8"><SelectValue /></SelectTrigger>
                        <SelectContent className="bg-gray-800 border-gray-700">
                          {["GET","POST","PUT","PATCH","DELETE","HEAD"].map((m) => (
                            <SelectItem key={m} value={m}>{m}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        value={epPath}
                        onChange={(e) => setEpPath(e.target.value)}
                        className="flex-1 bg-gray-800 border-gray-700 text-white text-xs h-8 font-mono"
                        placeholder="/endpoint/path"
                      />
                    </div>

                    <div>
                      <Label className="text-xs text-gray-400 mb-1 block">Query Params</Label>
                      <KVEditor value={epParams} onChange={setEpParams} />
                    </div>

                    {["POST","PUT","PATCH"].includes(epMethod) && (
                      <div>
                        <Label className="text-xs text-gray-400 mb-1 block">Request Body (JSON)</Label>
                        <Textarea
                          value={epBody}
                          onChange={(e) => setEpBody(e.target.value)}
                          className="bg-gray-800 border-gray-700 text-white text-xs font-mono"
                          rows={3}
                          placeholder="{}"
                        />
                      </div>
                    )}

                    <div className="flex items-center gap-2 flex-wrap">
                      <Button size="sm" onClick={handleProbe} disabled={probing || !epPath} className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-7 gap-1">
                        {probing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                        Probe Endpoint
                      </Button>
                      <Button size="sm" variant="outline" onClick={handleDetectPagination} disabled={detectingPag || !epPath} className="border-gray-700 text-gray-300 text-xs h-7 gap-1">
                        {detectingPag ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                        Detect Pagination
                      </Button>
                    </div>
                  </div>
                </Panel>
              )}

              {/* Panel C: Response Analysis */}
              {activeTab === "probe" && probeResult && (
                <Panel title="Response Analysis" icon={Activity} accent="violet">
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {[
                        { label: "Status", value: probeResult.status, ok: probeResult.status >= 200 && probeResult.status < 300 },
                        { label: "Response Time", value: `${probeResult.responseTime}ms`, ok: true },
                        { label: "Array Records", value: probeResult.recordCount ?? 0, ok: true },
                        { label: "Array Path", value: probeResult.arrayPath ?? "—", ok: true },
                      ].map((s) => (
                        <div key={s.label} className="rounded-lg bg-gray-950/60 p-2.5">
                          <p className="text-[10px] text-gray-500 uppercase tracking-wider">{s.label}</p>
                          <p className={cn("text-sm font-bold font-mono mt-0.5", s.ok ? "text-white" : "text-red-400")}>{s.value}</p>
                        </div>
                      ))}
                    </div>

                    {probeResult.topKeys?.length > 0 && (
                      <div>
                        <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Top-level Keys</p>
                        <div className="flex flex-wrap gap-1">
                          {probeResult.topKeys.map((k: string) => (
                            <span key={k} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-gray-800 text-gray-300">{k}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {probeResult.paginationKeys?.length > 0 && (
                      <div>
                        <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Pagination Keys Detected</p>
                        <div className="flex flex-wrap gap-1">
                          {probeResult.paginationKeys.map((k: string) => (
                            <span key={k} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">{k}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {probeResult.sampleRecord && (
                      <div>
                        <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Sample Record</p>
                        <pre className="rounded-lg bg-gray-950 border border-gray-800 p-3 text-[10px] text-emerald-300 font-mono overflow-x-auto max-h-40">
                          {JSON.stringify(probeResult.sampleRecord, null, 2)}
                        </pre>
                      </div>
                    )}

                    {/* Pagination analysis */}
                    {pagResult && (
                      <div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.04] p-3 space-y-2">
                        <p className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5" /> Pagination Analysis
                        </p>
                        <p className="text-xs text-gray-300"><span className="text-amber-400 font-semibold">Strategy:</span> {pagResult.strategy}</p>
                        <p className="text-xs text-gray-300">{pagResult.recommendation}</p>
                        {pagResult.bulkCount > 0 && (
                          <p className="text-xs text-gray-400">Bulk (?limit=10000): {pagResult.bulkCount} records</p>
                        )}
                      </div>
                    )}

                    {/* Suggested modules + save mapping */}
                    <div className="rounded-lg border border-violet-500/20 bg-violet-500/[0.04] p-3 space-y-2">
                      <p className="text-xs font-semibold text-violet-300 flex items-center gap-1.5">
                        <Database className="w-3.5 h-3.5" /> Map to WEBEE Module
                      </p>
                      {probeResult.suggestedModules?.length > 0 && (
                        <p className="text-[10px] text-gray-400">
                          Suggested: {probeResult.suggestedModules.join(", ")}
                        </p>
                      )}
                      <div className="flex items-center gap-2">
                        <Select value={selectedModule} onValueChange={setSelectedModule}>
                          <SelectTrigger className="flex-1 bg-gray-800 border-gray-700 text-white text-xs h-7"><SelectValue placeholder="Select module" /></SelectTrigger>
                          <SelectContent className="bg-gray-800 border-gray-700">
                            {WEBEE_MODULE_KEYS.map((mk) => (
                              <SelectItem key={mk.key} value={mk.key}>{mk.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button size="sm" onClick={handleSaveMapping} disabled={savingMapping || !selectedModule} className="bg-violet-600 hover:bg-violet-700 text-white text-xs h-7 gap-1">
                          {savingMapping ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                          Save Mapping
                        </Button>
                      </div>
                    </div>
                  </div>
                </Panel>
              )}

              {/* Panel D: Saved Mappings */}
              {activeTab === "mappings" && selectedId && (
                <Panel title="Saved Mappings" icon={Database} accent="violet">
                  <SavedMappingsTab connectionId={selectedId} />
                </Panel>
              )}
            </>
          )}

          {!selectedId && !creatingNew && (
            <div className="rounded-xl border border-dashed border-white/10 p-12 text-center">
              <Activity className="mx-auto h-8 w-8 text-gray-700 mb-3" />
              <p className="text-sm text-gray-500">Select a connection from the list or create a new one to begin probing.</p>
              <Button size="sm" onClick={startNew} className="mt-4 bg-sky-600 hover:bg-sky-700 text-white text-xs gap-1">
                <Plus className="w-3 h-3" /> New Connection
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
