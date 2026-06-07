import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Loader2, Phone, PhoneCall, Calendar, ExternalLink, Check, Rocket } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Separator } from "@/components/ui/separator";
import {
  buyRetellPhoneNumber,
  importSipPhoneNumber,
  listRetellPhoneNumbers,
  assignNumberToAgent,
  cloneRetellAgentForDeploy,
} from "@/lib/builder/retell.functions";
import {
  saveAgentCalcom,
  saveAgentPhoneNumber,
  saveAgentDeployedRetellId,
  goLiveAgent,
  type AgentGoLiveType,
} from "@/lib/agents/agents.functions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getMyWorkspaceRequest, requestWorkspace } from "@/lib/agents/workspace.functions";
import { getDeployConfig } from "@/lib/deploy/deploy.functions";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent: {
    id: string;
    name: string;
    retell_agent_id: string | null;
    settings?: Record<string, unknown> | null;
  } | null;
}

type CallDirection = "inbound" | "outbound" | "both";

export function DeployAgentDialog({ open, onOpenChange, agent }: Props) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [goingLive, setGoingLive] = useState(false);
  const initialType =
    ((agent?.settings as Record<string, unknown> | null)?.dashboardAgentType as
      | AgentGoLiveType
      | undefined) ?? "receptionist";
  const [agentType, setAgentType] = useState<AgentGoLiveType>(initialType);
  const goLiveFn = useServerFn(goLiveAgent);

  async function handleGoLive() {
    if (!agent) return;
    setGoingLive(true);
    try {
      const res = await goLiveFn({ data: { id: agent.id, agentType } });
      qc.invalidateQueries({ queryKey: ["my-agents"] });
      qc.invalidateQueries({ queryKey: ["dashboard-live-agents"] });
      if (!res.ok) {
        toast.error("Go Live failed");
        return;
      }
      toast.success("Agent is live", {
        description: `${agent.name} is now live as ${agentType.replace("_", " ")}.`,
      });
      onOpenChange(false);
      navigate({ to: "/dashboard" });
    } catch (e) {
      toast.error("Go Live failed", {
        description:
          (e as Error).message || "Check your dashboard token in Settings → Integrations.",
      });
    } finally {
      setGoingLive(false);
    }
  }

  const buyFn = useServerFn(buyRetellPhoneNumber);
  const importFn = useServerFn(importSipPhoneNumber);
  const listFn = useServerFn(listRetellPhoneNumbers);
  const assignFn = useServerFn(assignNumberToAgent);
  const saveCalFn = useServerFn(saveAgentCalcom);
  const savePhoneFn = useServerFn(saveAgentPhoneNumber);
  const cloneFn = useServerFn(cloneRetellAgentForDeploy);
  const saveDeployedFn = useServerFn(saveAgentDeployedRetellId);
  const getWsReqFn = useServerFn(getMyWorkspaceRequest);
  const requestWsFn = useServerFn(requestWorkspace);
  const getDeployConfigFn = useServerFn(getDeployConfig);

  const deployConfigQ = useQuery({
    queryKey: ["deploy-config"],
    queryFn: () => getDeployConfigFn(),
    enabled: open,
    staleTime: 60_000,
  });
  // Workspace approval gate (first-time deployers) — skipped in retail mode
  const wsReqQ = useQuery({
    queryKey: ["my-workspace-request"],
    queryFn: () => getWsReqFn(),
    enabled: open && deployConfigQ.isSuccess && deployConfigQ.data?.mode === "approval",
  });
  const [wsName, setWsName] = useState("");
  const [submittingWs, setSubmittingWs] = useState(false);

  async function submitWorkspaceRequest() {
    const name = wsName.trim();
    if (name.length < 2) {
      toast.error("Enter a workspace name");
      return;
    }
    setSubmittingWs(true);
    try {
      await requestWsFn({ data: { workspaceName: name } });
      toast.success("Request sent", {
        description: "Our team will review your workspace shortly.",
      });
      qc.invalidateQueries({ queryKey: ["my-workspace-request"] });
      setWsName("");
    } catch (e) {
      toast.error("Could not submit request", { description: (e as Error).message });
    } finally {
      setSubmittingWs(false);
    }
  }

  // Direction (inbound vs outbound vs both) — applied to whichever number you attach.
  const [direction, setDirection] = useState<CallDirection>("inbound");

  // Buy state
  const [tollFree, setTollFree] = useState(false);
  const [areaCode, setAreaCode] = useState("");
  const [nickname, setNickname] = useState("");
  const [buying, setBuying] = useState(false);

  // SIP state
  const [sipPhone, setSipPhone] = useState("");
  const [sipUri, setSipUri] = useState("");
  const [sipUser, setSipUser] = useState("");
  const [sipPass, setSipPass] = useState("");
  const [sipNick, setSipNick] = useState("");
  const [importing, setImporting] = useState(false);

  // Cal.com state
  const [calApiKey, setCalApiKey] = useState("");
  const [calEventId, setCalEventId] = useState("");
  const [savingCal, setSavingCal] = useState(false);
  // Track a just-saved cal entry locally so the green banner appears immediately
  // without waiting for the parent query to refetch and pass new agent settings.
  const [calJustSaved, setCalJustSaved] = useState<{
    apiKey: string;
    eventTypeId: string | null;
    connectedAt: string;
  } | null>(null);

  // Production-workspace clone state
  const [cloning, setCloning] = useState(false);

  const settings = (agent?.settings ?? {}) as Record<string, unknown>;
  const deployedId = (settings.deployedRetellAgentId as string | undefined) ?? null;

  // The production API key is now stored server-side (workspace_settings.retell_workspace_id).
  // Phone-number operations always send productionApiKey: undefined and the server resolves it.
  const hasProductionKeyForOps = true;

  const numbersQ = useQuery({
    queryKey: ["retell-numbers", agent?.id, deployedId ? "prod" : "dev"],
    queryFn: () => listFn({ data: { agentRowId: agent!.id } }),
    enabled: open && !!agent && hasProductionKeyForOps,
  });

  if (!agent) return null;
  // Prefer the cloned production agent for number attachment; fall back to the source.
  const retellId = deployedId ?? agent.retell_agent_id;
  const needsDeploy = !retellId;

  function dirIds(): { inboundAgentId?: string; outboundAgentId?: string } {
    if (!retellId) return {};
    if (direction === "inbound") return { inboundAgentId: retellId };
    if (direction === "outbound") return { outboundAgentId: retellId };
    return { inboundAgentId: retellId, outboundAgentId: retellId };
  }

  async function attachAndSave(phoneNumber: string) {
    if (retellId) {
      await assignFn({
        data: { phoneNumber, ...dirIds(), agentRowId: agent!.id },
      });
    }
    await savePhoneFn({ data: { id: agent!.id, phoneNumber } });
    qc.invalidateQueries({ queryKey: ["my-agents"] });
    qc.invalidateQueries({ queryKey: ["retell-numbers"] });
  }

  async function handleClone() {
    if (!agent!.retell_agent_id) {
      toast.error("Deploy the agent from the builder first");
      return;
    }
    setCloning(true);
    try {
      const res = await cloneFn({
        data: {
          sourceAgentId: agent!.retell_agent_id,
          agentRowId: agent!.id,
        },
      });
      await saveDeployedFn({
        data: {
          id: agent!.id,
          deployedRetellAgentId: res.agentId,
          deployedConversationFlowId: res.conversationFlowId,
        },
      });
      qc.invalidateQueries({ queryKey: ["my-agents"] });
      const bookingNote = res.calendarConnected
        ? "Booking tools auto-attached."
        : "Cal.com not connected — booking tools NOT attached.";
      toast.success("Deployed to company workspace", {
        description: `${res.agentName} — ${res.agentId}\n${bookingNote}`,
      });
    } catch (e) {
      toast.error("Deploy failed", { description: (e as Error).message });
    } finally {
      setCloning(false);
    }
  }

  async function handleBuy() {
    setBuying(true);
    try {
      const res = await buyFn({
        data: {
          tollFree,
          areaCode: areaCode ? Number(areaCode) : undefined,
          nickname: nickname || agent!.name,
          ...dirIds(),
          agentRowId: agent!.id,
        },
      });

      await savePhoneFn({ data: { id: agent!.id, phoneNumber: res.phoneNumber } });
      qc.invalidateQueries({ queryKey: ["my-agents"] });
      qc.invalidateQueries({ queryKey: ["retell-numbers"] });
      toast.success("Number purchased", { description: res.phoneNumber });
      setAreaCode("");
      setNickname("");
    } catch (e) {
      toast.error("Purchase failed", { description: (e as Error).message });
    } finally {
      setBuying(false);
    }
  }

  async function handleSipImport() {
    setImporting(true);
    try {
      const res = await importFn({
        data: {
          phoneNumber: sipPhone.trim(),
          terminationUri: sipUri,
          sipUsername: sipUser || undefined,
          sipPassword: sipPass || undefined,
          nickname: sipNick || agent!.name,
          ...dirIds(),
          agentRowId: agent!.id,
        },
      });

      await savePhoneFn({ data: { id: agent!.id, phoneNumber: res.phoneNumber } });
      qc.invalidateQueries({ queryKey: ["my-agents"] });
      toast.success("SIP number connected", { description: res.phoneNumber });
      setSipPhone("");
      setSipUri("");
      setSipUser("");
      setSipPass("");
      setSipNick("");
    } catch (e) {
      toast.error("SIP import failed", { description: (e as Error).message });
    } finally {
      setImporting(false);
    }
  }

  async function handleSaveCal() {
    if (!calApiKey.trim()) {
      toast.error("Add a Cal.com API key first");
      return;
    }
    setSavingCal(true);
    try {
      const savedKey = calApiKey.trim();
      const savedEventId = calEventId.trim() || null;
      await saveCalFn({
        data: {
          id: agent!.id,
          calcomApiKey: savedKey,
          calcomEventTypeId: savedEventId,
        },
      });
      qc.invalidateQueries({ queryKey: ["my-agents"] });
      // Show the green banner immediately without waiting for the parent query
      // to refetch; `calJustSaved` acts as a local override until parent rerenders.
      setCalJustSaved({
        apiKey: savedKey,
        eventTypeId: savedEventId,
        connectedAt: new Date().toISOString(),
      });
      toast.success("Cal.com connected", {
        description: savedEventId
          ? `API key saved · Event Type ID: ${savedEventId}`
          : "API key saved to this agent",
      });
      setCalApiKey("");
      setCalEventId("");
    } catch (e) {
      toast.error("Save failed", { description: (e as Error).message });
    } finally {
      setSavingCal(false);
    }
  }

  async function handleDisconnectCal() {
    setSavingCal(true);
    try {
      await saveCalFn({
        data: { id: agent!.id, calcomApiKey: null, calcomEventTypeId: null },
      });
      qc.invalidateQueries({ queryKey: ["my-agents"] });
      setCalJustSaved(null);
      toast.success("Cal.com disconnected");
    } catch (e) {
      toast.error("Disconnect failed", { description: (e as Error).message });
    } finally {
      setSavingCal(false);
    }
  }

  const wsReq = wsReqQ.data;
  const wsStatus = wsReq?.status as "pending" | "approved" | "denied" | undefined;
  const showGate =
    deployConfigQ.data?.mode === "approval" && !wsReqQ.isLoading && wsStatus !== "approved";


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Deploy {agent.name}</DialogTitle>
          <DialogDescription>
            {showGate ? (
              <>Set up your workspace before deploying.</>
            ) : needsDeploy ? (
              <span className="text-amber-600 dark:text-amber-400">
                This agent hasn't been deployed yet. Deploy it from the builder first, then come
                back here to attach a number.
              </span>
            ) : (
              <>Connect a phone number and a calendar to your live agent.</>
            )}
          </DialogDescription>
        </DialogHeader>

        {!showGate &&
          !needsDeploy &&
          (() => {
            const savedPhone = (settings.phoneNumber as string | undefined) ?? null;
            // Go Live only needs the agent deployed to Retell (builder deploy is enough)
            // and a phone number attached. A dedicated production workspace clone is
            // optional — the builder agent can serve as the live agent.
            const canGoLive = !!savedPhone;
            return (
              <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-3">
                <div className="space-y-0.5">
                  <div className="text-sm font-medium flex items-center gap-1.5">
                    <Rocket className="h-3.5 w-3.5 text-primary" />
                    Go Live
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {canGoLive
                      ? "Pick the flow type, then push this agent to your live dashboard."
                      : "Attach a phone number to the agent first."}
                  </p>
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex-1 space-y-1">
                    <Label className="text-[11px] text-muted-foreground">Flow type</Label>
                    <Select
                      value={agentType}
                      onValueChange={(v) => setAgentType(v as AgentGoLiveType)}
                      disabled={goingLive}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="receptionist">Receptionist flow</SelectItem>
                        <SelectItem value="lead_generation">Lead generation flow</SelectItem>
                        <SelectItem value="client_qualification">
                          Client qualification flow
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    size="sm"
                    disabled={goingLive || !canGoLive}
                    onClick={handleGoLive}
                    className="shrink-0"
                  >
                    {goingLive ? (
                      <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    ) : (
                      <Rocket className="h-3 w-3 mr-1" />
                    )}
                    Go Live
                  </Button>
                </div>
              </div>
            );
          })()}

        {showGate ? (
          <div className="rounded-md border p-4 space-y-3">
            {wsStatus === "pending" ? (
              <>
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
                  <span className="text-sm font-medium">Workspace creation awaiting approval</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  We've sent your request for <strong>{wsReq?.workspace_name}</strong> to the
                  Webespoke team. You'll be able to deploy as soon as it's approved — typically
                  within a business day.
                </p>
              </>
            ) : wsStatus === "denied" ? (
              <>
                <p className="text-sm text-destructive font-medium">
                  Your previous workspace request was denied.
                </p>
                <p className="text-xs text-muted-foreground">
                  You can submit a new request below or contact support.
                </p>
                <div className="space-y-2">
                  <Label className="text-xs">Workspace name</Label>
                  <Input
                    placeholder="e.g. Acme Co."
                    value={wsName}
                    onChange={(e) => setWsName(e.target.value)}
                    maxLength={80}
                  />
                  <Button
                    size="sm"
                    onClick={submitWorkspaceRequest}
                    disabled={submittingWs || wsName.trim().length < 2}
                  >
                    {submittingWs && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                    Submit new request
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm">
                  Before deploying your first agent, we need to set up a workspace for you. Give it
                  a name below and our team will approve it shortly.
                </p>
                <div className="space-y-2">
                  <Label className="text-xs">Workspace name</Label>
                  <Input
                    placeholder="e.g. Acme Co."
                    value={wsName}
                    onChange={(e) => setWsName(e.target.value)}
                    maxLength={80}
                  />
                  <Button
                    size="sm"
                    onClick={submitWorkspaceRequest}
                    disabled={submittingWs || wsName.trim().length < 2}
                  >
                    {submittingWs && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                    Request workspace
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : (
          <>
            {/* Production workspace clone */}
            {agent.retell_agent_id && (
              <div className="rounded-md border p-3 text-xs space-y-3">
                {deployedId ? (
                  <div className="flex items-center gap-2">
                    <Check className="h-3 w-3 text-green-600" />
                    <span className="font-medium text-foreground">Production copy active</span>
                    <span className="font-mono text-[11px] text-muted-foreground truncate">
                      {deployedId}
                    </span>
                  </div>
                ) : null}
                <p className="text-muted-foreground">
                  {wsReqQ.data?.workspace_name
                    ? `Your dedicated workspace "${wsReqQ.data.workspace_name}" is provisioned. Click below to deploy this agent there.`
                    : "Clone this agent into your dedicated company workspace. The workspace is provisioned by your account manager — no API key needed."}
                </p>
                {wsReqQ.data?.workspace_name && (
                  <div className="flex items-center gap-1.5 rounded bg-muted/60 px-2 py-1">
                    <span className="text-muted-foreground">Workspace:</span>
                    <span className="font-medium text-foreground">{wsReqQ.data.workspace_name}</span>
                  </div>
                )}
                <Button
                  size="sm"
                  onClick={handleClone}
                  disabled={cloning}
                >
                  {cloning && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                  {deployedId ? "Re-deploy to workspace" : "Deploy to company workspace"}
                </Button>
              </div>
            )}

            {/* Call direction */}
            {!needsDeploy && (
              <div className="rounded-md border p-3 space-y-2">
                <Label className="text-xs font-medium">Call direction for attached number</Label>
                <RadioGroup
                  value={direction}
                  onValueChange={(v) => setDirection(v as CallDirection)}
                  className="flex flex-wrap gap-4"
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="inbound" id="dir-in" />
                    <Label htmlFor="dir-in" className="cursor-pointer text-sm">
                      Inbound only
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="outbound" id="dir-out" />
                    <Label htmlFor="dir-out" className="cursor-pointer text-sm">
                      Outbound only
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="both" id="dir-both" />
                    <Label htmlFor="dir-both" className="cursor-pointer text-sm">
                      Inbound + Outbound
                    </Label>
                  </div>
                </RadioGroup>
              </div>
            )}

            <Tabs defaultValue="buy" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="buy">
                  <Phone className="h-4 w-4 mr-1" /> Buy number
                </TabsTrigger>
                <TabsTrigger value="sip">
                  <PhoneCall className="h-4 w-4 mr-1" /> SIP trunk
                </TabsTrigger>
                <TabsTrigger value="calcom">
                  <Calendar className="h-4 w-4 mr-1" /> Cal.com
                </TabsTrigger>
              </TabsList>

              {/* BUY */}
              <TabsContent value="buy" className="space-y-4 mt-4">
                <div className="rounded-md border p-3 text-xs text-muted-foreground">
                  Numbers are provisioned via Twilio. Pricing:{" "}
                  <strong className="text-foreground">$5/mo standard</strong>,{" "}
                  <strong className="text-foreground">$10/mo toll-free</strong>. Per-minute call
                  charges apply separately.
                </div>

                <RadioGroup
                  value={tollFree ? "toll" : "standard"}
                  onValueChange={(v) => setTollFree(v === "toll")}
                  className="flex gap-6"
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="standard" id="std" />
                    <Label htmlFor="std" className="cursor-pointer text-sm">
                      Standard ($5/mo)
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="toll" id="toll" />
                    <Label htmlFor="toll" className="cursor-pointer text-sm">
                      Toll-free ($10/mo)
                    </Label>
                  </div>
                </RadioGroup>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Area code (optional)</Label>
                    <Input
                      placeholder="e.g. 415"
                      value={areaCode}
                      onChange={(e) => setAreaCode(e.target.value.replace(/\D/g, "").slice(0, 4))}
                      disabled={tollFree}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Nickname (optional)</Label>
                    <Input
                      placeholder={agent.name}
                      value={nickname}
                      onChange={(e) => setNickname(e.target.value)}
                    />
                  </div>
                </div>

                <Button
                  onClick={handleBuy}
                  disabled={buying || needsDeploy || !hasProductionKeyForOps}
                  className="w-full"
                >
                  {buying && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                  Purchase number
                </Button>

                {numbersQ.error && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
                    {(numbersQ.error as Error).message}
                  </div>
                )}
                {numbersQ.data && numbersQ.data.length > 0 && (
                  <>
                    <Separator />
                    <div>
                      <Label className="text-xs text-muted-foreground">
                        Or attach an existing number you already own:
                      </Label>
                      <div className="mt-2 max-h-48 overflow-y-auto rounded-md border divide-y">
                        {numbersQ.data.map((n) => {
                          const attached = n.inboundAgentId === retellId;
                          return (
                            <div
                              key={n.phoneNumber}
                              className="flex items-center justify-between px-3 py-2 text-sm"
                            >
                              <div className="min-w-0">
                                <div className="font-mono">{n.phoneNumber}</div>
                                {n.nickname && (
                                  <div className="text-xs text-muted-foreground truncate">
                                    {n.nickname}
                                  </div>
                                )}
                              </div>
                              <Button
                                size="sm"
                                variant={attached ? "ghost" : "outline"}
                                disabled={attached || needsDeploy || !hasProductionKeyForOps}
                                onClick={async () => {
                                  try {
                                    await attachAndSave(n.phoneNumber);
                                    toast.success("Number attached");
                                  } catch (e) {
                                    toast.error("Attach failed", {
                                      description: (e as Error).message,
                                    });
                                  }
                                }}
                              >
                                {attached ? (
                                  <>
                                    <Check className="h-3 w-3 mr-1" /> Attached
                                  </>
                                ) : (
                                  "Attach"
                                )}
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
              </TabsContent>

              {/* SIP */}
              <TabsContent value="sip" className="space-y-3 mt-4">
                <p className="text-xs text-muted-foreground">
                  Bring your own carrier number via SIP trunking. Phone number must be in E.164
                  format (e.g. +447533043457).
                </p>
                <div className="space-y-1">
                  <Label className="text-xs">Phone Number</Label>
                  <Input
                    placeholder="+447533043457"
                    value={sipPhone}
                    onChange={(e) => setSipPhone(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Termination URI</Label>
                  <Input
                    placeholder="your-trunk.pstn.twilio.com"
                    value={sipUri}
                    onChange={(e) => setSipUri(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">SIP Username (optional)</Label>
                    <Input value={sipUser} onChange={(e) => setSipUser(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">SIP Password (optional)</Label>
                    <Input
                      type="password"
                      value={sipPass}
                      onChange={(e) => setSipPass(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Nickname (optional)</Label>
                  <Input
                    placeholder={agent.name}
                    value={sipNick}
                    onChange={(e) => setSipNick(e.target.value)}
                  />
                </div>
                <Button
                  onClick={handleSipImport}
                  disabled={
                    importing || needsDeploy || !sipPhone || !sipUri || !hasProductionKeyForOps
                  }
                  className="w-full"
                >
                  {importing && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                  Save SIP number
                </Button>
              </TabsContent>

              {/* CAL.COM */}
              <TabsContent value="calcom" className="space-y-3 mt-4">
                {(() => {
                  // Use calJustSaved as immediate local override so the banner
                  // shows right after save without waiting for the parent query refetch.
                  const calFromSettings = (settings.calcom ?? null) as {
                    apiKey?: string;
                    eventTypeId?: string | null;
                    connectedAt?: string;
                  } | null;
                  const cal = calJustSaved
                    ? {
                        apiKey: calJustSaved.apiKey,
                        eventTypeId: calJustSaved.eventTypeId,
                        connectedAt: calJustSaved.connectedAt,
                      }
                    : calFromSettings;
                  if (!cal?.apiKey) return null;
                  const masked = `${cal.apiKey.slice(0, 8)}…${cal.apiKey.slice(-4)}`;
                  const when = cal.connectedAt ? new Date(cal.connectedAt).toLocaleString() : null;
                  return (
                    <div className="rounded-md border border-green-500/40 bg-green-500/10 p-3 text-xs space-y-1">
                      <div className="flex items-center gap-2 text-green-700 dark:text-green-400 font-medium">
                        <Check className="h-4 w-4" /> Cal.com connected
                      </div>
                      <div className="font-mono text-foreground">Key: {masked}</div>
                      {cal.eventTypeId && (
                        <div className="font-mono text-foreground">
                          Event Type ID: {cal.eventTypeId}
                        </div>
                      )}
                      {when && <div className="text-muted-foreground">Saved {when}</div>}
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2"
                        onClick={handleDisconnectCal}
                        disabled={savingCal}
                      >
                        Disconnect
                      </Button>
                    </div>
                  );
                })()}

                <div className="rounded-md border p-3 text-xs space-y-2">
                  <p className="text-muted-foreground">
                    Connect Cal.com so your agent can check calendar availability and book meetings.
                    Each client needs their own Cal.com account and API key.
                  </p>
                  <Button asChild variant="outline" size="sm">
                    <a
                      href="https://app.cal.com/auth/signup"
                      target="_blank"
                      rel="noreferrer"
                      className="gap-1"
                    >
                      Sign up for Cal.com <ExternalLink className="h-3 w-3" />
                    </a>
                  </Button>
                </div>

                <div className="rounded-md border bg-muted/30 p-3 text-xs space-y-2">
                  <p className="font-medium text-foreground">How to get your Cal.com API key</p>
                  <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                    <li>
                      Sign up or log in at{" "}
                      <a
                        href="https://app.cal.com"
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary underline underline-offset-2"
                      >
                        app.cal.com
                      </a>
                      .
                    </li>
                    <li>Complete onboarding and create at least one Event Type.</li>
                    <li>
                      Open{" "}
                      <a
                        href="https://app.cal.com/settings/developer/api-keys"
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary underline underline-offset-2"
                      >
                        Settings → Developer → API Keys
                      </a>
                      .
                    </li>
                    <li>
                      Click <strong className="text-foreground">+ Add</strong>, give it a name (e.g.
                      "Webespoke Agent"), pick an expiry (or "Never expires"), and click{" "}
                      <strong className="text-foreground">Save</strong>.
                    </li>
                    <li>
                      Copy the key shown (starts with <code>cal_live_</code>) — it is only shown
                      once — and paste it below.
                    </li>
                    <li>
                      To find your Event Type ID: open the event in Cal.com, look at the URL (e.g.{" "}
                      <code>/event-types/123456</code>) — the number is the ID.
                    </li>
                  </ol>
                </div>

                <div className="space-y-1">
                  <Label className="text-xs">Cal.com API Key</Label>
                  <Input
                    type="password"
                    placeholder="cal_live_..."
                    value={calApiKey}
                    onChange={(e) => setCalApiKey(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Default Event Type ID (optional)</Label>
                  <Input
                    placeholder="e.g. 123456"
                    value={calEventId}
                    onChange={(e) => setCalEventId(e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Found in your Cal.com event-type URL. Used as the default slot to check.
                  </p>
                </div>

                <Button onClick={handleSaveCal} disabled={savingCal} className="w-full">
                  {savingCal && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                  Save Cal.com credentials
                </Button>
              </TabsContent>
            </Tabs>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
