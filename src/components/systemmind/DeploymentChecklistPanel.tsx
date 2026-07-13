// ── SystemMind Deployment Checklist Panel ──────────────────────────────────────
// The ONE deployment-guidance surface, embedded in: Agent Builder, Build
// Workspace, Deploy dialog, Agents page and the Workflows page. Renders the
// live-recomputed checklist, telephony options, approval prompts and the
// Apply & Go Live action. Every provider-affecting action goes through the
// approval-gated server fns — this component never talks to providers.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2,
  Circle,
  XCircle,
  ShieldAlert,
  MinusCircle,
  Ban,
  Loader2,
  Rocket,
  Phone,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  startAgentDeployment,
  getDeploymentForAgent,
  getDeploymentChecklist,
  setDeploymentChecklistOverride,
  requestDeploymentApproval,
  decideDeploymentApproval,
  executeApprovedDeploymentAction,
} from "@/lib/systemmind/deployment-orchestrator.functions";

type ChecklistStatus = "complete" | "missing" | "needs_approval" | "failed" | "optional" | "blocked";

const STATUS_META: Record<ChecklistStatus, { icon: React.ElementType; cls: string; label: string }> = {
  complete: { icon: CheckCircle2, cls: "text-emerald-400", label: "Complete" },
  missing: { icon: Circle, cls: "text-amber-400", label: "Missing" },
  needs_approval: { icon: ShieldAlert, cls: "text-violet-400", label: "Needs approval" },
  failed: { icon: XCircle, cls: "text-red-400", label: "Failed" },
  optional: { icon: MinusCircle, cls: "text-muted-foreground/60", label: "Optional" },
  blocked: { icon: Ban, cls: "text-red-400/80", label: "Blocked" },
};

export function DeploymentChecklistPanel({
  agentId,
  compact = false,
}: {
  agentId: string;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const startFn = useServerFn(startAgentDeployment);
  const forAgentFn = useServerFn(getDeploymentForAgent);
  const checklistFn = useServerFn(getDeploymentChecklist);
  const overrideFn = useServerFn(setDeploymentChecklistOverride);
  const requestFn = useServerFn(requestDeploymentApproval);
  const decideFn = useServerFn(decideDeploymentApproval);
  const executeFn = useServerFn(executeApprovedDeploymentAction);

  const [busy, setBusy] = useState<string | null>(null);
  const [areaCode, setAreaCode] = useState("");
  const [existingNumber, setExistingNumber] = useState("");
  const [sipNumber, setSipNumber] = useState("");
  const [sipUri, setSipUri] = useState("");

  const depQ = useQuery({
    queryKey: ["sm-deployment-for-agent", agentId],
    queryFn: () => forAgentFn({ data: { agentId } }),
    throwOnError: false,
  });
  const deploymentId = depQ.data?.deploymentId ?? null;

  const checklistQ = useQuery({
    queryKey: ["sm-deployment-checklist", deploymentId],
    queryFn: () => checklistFn({ data: { deploymentId: deploymentId! } }),
    enabled: !!deploymentId,
    throwOnError: false,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["sm-deployment-for-agent", agentId] });
    qc.invalidateQueries({ queryKey: ["sm-deployment-checklist", deploymentId] });
  };

  async function run(label: string, fn: () => Promise<unknown>, successMsg?: string) {
    setBusy(label);
    try {
      await fn();
      if (successMsg) toast.success(successMsg);
      refresh();
    } catch (e) {
      toast.error("Deployment step failed", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  if (depQ.isLoading) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking deployment status…
      </div>
    );
  }

  if (!deploymentId) {
    return (
      <div className="rounded-lg border border-white/[0.08] bg-card/60 p-4 space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Rocket className="h-4 w-4 text-primary" />
          SystemMind guided deployment
        </div>
        <p className="text-xs text-muted-foreground">
          Let SystemMind walk this agent through deployment: phone number or SIP setup, safety
          checks and Go Live — every billing or live-affecting step needs your approval first.
        </p>
        <Button
          size="sm"
          disabled={busy === "start"}
          onClick={() =>
            run("start", () => startFn({ data: { agentId } }), "Deployment checklist created")
          }
        >
          {busy === "start" ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
          Start guided deployment
        </Button>
      </div>
    );
  }

  const cl = checklistQ.data;
  if (checklistQ.isLoading || !cl) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Computing deployment checklist…
      </div>
    );
  }

  const pendingApprovals = cl.approvals.filter((a) => a.status === "pending");
  const executableApprovals = cl.approvals.filter((a) => a.status === "approved" && !a.consumed_at);
  const needsTelephony = cl.items.some(
    (i) => i.key === "number_selected" && (i.status === "missing" || i.status === "blocked"),
  );
  const telephonyBlocked = cl.items.some(
    (i) => i.key === "number_or_sip_required" && i.status === "blocked",
  );
  const goLiveItem = cl.items.find((i) => i.key === "go_live");
  const canRequestGoLive =
    cl.goLiveReady &&
    !cl.deployment.build_version_id &&
    !cl.approvals.some(
      (a) => a.action_type === "go_live" && (a.status === "pending" || (a.status === "approved" && !a.consumed_at)),
    );
  const goLiveExecutable = executableApprovals.find((a) => a.action_type === "go_live");

  const actionLabel: Record<string, string> = {
    purchase_number: "Purchase Retell number",
    assign_number: "Assign existing number",
    import_sip: "Import SIP trunk number",
    reassign_number: "Reassign number",
    go_live: "Go Live",
  };

  return (
    <div className="rounded-lg border border-white/[0.08] bg-card/60 p-4 space-y-4" data-testid="deployment-checklist-panel">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Rocket className="h-4 w-4 text-primary" />
          Deployment checklist
          <Badge variant="outline" className="text-[10px] capitalize">
            {cl.deployment.deployment_type.replace("_", " ")}
          </Badge>
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] capitalize",
              cl.deployment.status === "live" && "border-emerald-500/40 text-emerald-400",
              cl.deployment.status === "ready" && "border-primary/40 text-primary",
              cl.deployment.status === "blocked" && "border-red-500/40 text-red-400",
            )}
          >
            {cl.deployment.status.replace("_", " ")}
          </Badge>
        </div>
        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={refresh} title="Refresh">
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Checklist items */}
      <ol className="space-y-1.5">
        {cl.items.map((item, idx) => {
          const meta = STATUS_META[item.status as ChecklistStatus] ?? STATUS_META.missing;
          const Icon = meta.icon;
          return (
            <li key={item.key} className="flex items-start gap-2 text-xs" data-testid={`checklist-item-${item.key}`}>
              <Icon className={cn("h-3.5 w-3.5 mt-0.5 shrink-0", meta.cls)} />
              <div className="min-w-0">
                <span className="font-medium">
                  {idx + 1}. {item.label}
                </span>{" "}
                <span className={cn("text-[10px] uppercase tracking-wide", meta.cls)}>{meta.label}</span>
                {!compact && <p className="text-muted-foreground mt-0.5">{item.detail}</p>}
              </div>
            </li>
          );
        })}
      </ol>

      {/* Warnings + blockers */}
      {cl.warnings.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 space-y-1">
          {cl.warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-300 flex gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {w}
            </p>
          ))}
        </div>
      )}
      {cl.blockers.length > 0 && (
        <div className="rounded-md border border-red-500/30 bg-red-500/5 p-2.5 space-y-1" data-testid="deployment-blockers">
          {cl.blockers.map((b, i) => (
            <p key={i} className="text-xs text-red-300 flex gap-1.5">
              <Ban className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {b}
            </p>
          ))}
        </div>
      )}

      {/* Telephony options */}
      {needsTelephony && !telephonyBlocked && cl.deployment.status !== "live" && (
        <div className="rounded-md border border-white/[0.08] bg-white/[0.02] p-3 space-y-3">
          <div className="flex items-center gap-1.5 text-xs font-medium">
            <Phone className="h-3.5 w-3.5 text-primary" /> Phone number / SIP options
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="h-7 w-28 text-xs"
                placeholder="Area code"
                value={areaCode}
                onChange={(e) => setAreaCode(e.target.value.replace(/\D/g, ""))}
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={busy === "purchase"}
                data-testid="button-request-purchase"
                onClick={() =>
                  run(
                    "purchase",
                    async () => {
                      await overrideFn({
                        data: { deploymentId, overrides: { telephony_path: "purchase_retell" } },
                      });
                      await requestFn({
                        data: {
                          deploymentId,
                          actionType: "purchase_number",
                          payload: {
                            country: "US/UK (Retell inventory)",
                            number_type: "standard",
                            estimated_cost_usd: 2,
                            ...(areaCode ? { area_code: Number(areaCode) } : {}),
                          },
                        },
                      });
                    },
                    "Purchase request created — approve it below to buy the number.",
                  )
                }
              >
                {busy === "purchase" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
                Purchase new Retell number…
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="h-7 w-40 text-xs"
                placeholder="+15551234567"
                value={existingNumber}
                onChange={(e) => setExistingNumber(e.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={busy === "assign" || !existingNumber.trim()}
                data-testid="button-request-assign"
                onClick={() =>
                  run(
                    "assign",
                    async () => {
                      await overrideFn({
                        data: { deploymentId, overrides: { telephony_path: "existing_number" } },
                      });
                      await requestFn({
                        data: {
                          deploymentId,
                          actionType: "assign_number",
                          payload: { phone_number: existingNumber.trim() },
                        },
                      });
                    },
                    "Assignment request created — approve it below to assign the number.",
                  )
                }
              >
                Assign existing number…
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="h-7 w-36 text-xs"
                placeholder="+447533043457"
                value={sipNumber}
                onChange={(e) => setSipNumber(e.target.value)}
              />
              <Input
                className="h-7 w-48 text-xs"
                placeholder="sip.example.com (termination URI)"
                value={sipUri}
                onChange={(e) => setSipUri(e.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={busy === "sip" || !sipNumber.trim() || !sipUri.trim()}
                data-testid="button-request-sip"
                onClick={() =>
                  run(
                    "sip",
                    async () => {
                      await overrideFn({
                        data: { deploymentId, overrides: { telephony_path: "sip" } },
                      });
                      await requestFn({
                        data: {
                          deploymentId,
                          actionType: "import_sip",
                          payload: { phone_number: sipNumber.trim(), termination_uri: sipUri.trim() },
                        },
                      });
                    },
                    "SIP import request created — approve it below to import the trunk number.",
                  )
                }
              >
                Use SIP trunk…
              </Button>
            </div>

            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-muted-foreground"
              disabled={busy === "skip"}
              data-testid="button-skip-telephony"
              onClick={() =>
                run(
                  "skip",
                  () =>
                    overrideFn({
                      data: { deploymentId, overrides: { telephony_path: "skip" } },
                    }),
                  "Telephony skipped for now.",
                )
              }
            >
              Skip for now
            </Button>
          </div>
        </div>
      )}

      {/* Test call */}
      {cl.deployment.status !== "live" && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Test call:</span>
          {(["passed", "failed", "skipped"] as const).map((v) => (
            <Button
              key={v}
              size="sm"
              variant={cl.overrides.test_call === v ? "default" : "outline"}
              className="h-6 px-2 text-[11px] capitalize"
              disabled={busy === `test-${v}`}
              data-testid={`button-test-${v}`}
              onClick={() =>
                run(`test-${v}`, () =>
                  overrideFn({ data: { deploymentId, overrides: { test_call: v } } }),
                )
              }
            >
              {v}
            </Button>
          ))}
        </div>
      )}

      {/* Pending approvals */}
      {pendingApprovals.map((a) => (
        <div
          key={a.id}
          className="rounded-md border border-violet-500/30 bg-violet-500/5 p-3 space-y-2"
          data-testid={`approval-pending-${a.action_type}`}
        >
          <div className="text-xs font-medium flex items-center gap-1.5">
            <ShieldAlert className="h-3.5 w-3.5 text-violet-400" />
            Approval required: {actionLabel[a.action_type] ?? a.action_type}
          </div>
          <div className="text-[11px] text-muted-foreground space-y-0.5">
            {"phone_number" in a.payload && <p>Number: {String(a.payload.phone_number)}</p>}
            {"area_code" in a.payload && <p>Area code: {String(a.payload.area_code)}</p>}
            {"country" in a.payload && <p>Region: {String(a.payload.country)}</p>}
            {"estimated_cost_usd" in a.payload && (
              <p>Estimated provider cost: ~${String(a.payload.estimated_cost_usd)}/month</p>
            )}
            {"billing_warning" in a.payload && (
              <p className="text-amber-300/90">{String(a.payload.billing_warning)}</p>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              className="h-7 text-xs"
              disabled={busy === `approve-${a.id}`}
              data-testid={`button-approve-${a.action_type}`}
              onClick={() =>
                run(
                  `approve-${a.id}`,
                  () => decideFn({ data: { approvalId: a.id, approve: true } }),
                  "Approved — you can now run the action.",
                )
              }
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={busy === `reject-${a.id}`}
              onClick={() =>
                run(
                  `reject-${a.id}`,
                  () => decideFn({ data: { approvalId: a.id, approve: false } }),
                  "Rejected.",
                )
              }
            >
              Reject
            </Button>
          </div>
        </div>
      ))}

      {/* Approved, ready to execute (telephony actions) */}
      {executableApprovals
        .filter((a) => a.action_type !== "go_live")
        .map((a) => (
          <div key={a.id} className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
            <div className="text-xs font-medium">
              Approved: {actionLabel[a.action_type] ?? a.action_type}
            </div>
            <Button
              size="sm"
              className="h-7 text-xs"
              disabled={busy === `exec-${a.id}`}
              data-testid={`button-execute-${a.action_type}`}
              onClick={() =>
                run(
                  `exec-${a.id}`,
                  () => executeFn({ data: { approvalId: a.id } }),
                  "Done — the existing deployment logic handled it.",
                )
              }
            >
              {busy === `exec-${a.id}` ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
              Run {actionLabel[a.action_type] ?? a.action_type}
            </Button>
          </div>
        ))}

      {/* Go Live */}
      {cl.deployment.status !== "live" && !cl.deployment.build_version_id && (
        <div className="flex items-center gap-2">
          {canRequestGoLive && (
            <Button
              size="sm"
              className="h-8 text-xs"
              disabled={busy === "req-golive"}
              data-testid="button-request-golive"
              onClick={() =>
                run(
                  "req-golive",
                  () =>
                    requestFn({
                      data: { deploymentId, actionType: "go_live", payload: {} },
                    }),
                  "Go Live approval requested — approve it above to continue.",
                )
              }
            >
              <Rocket className="h-3.5 w-3.5 mr-1" /> Request Go Live approval
            </Button>
          )}
          {goLiveExecutable && (
            <Button
              size="sm"
              className="h-8 text-xs bg-emerald-600 hover:bg-emerald-500"
              disabled={busy === "golive"}
              data-testid="button-apply-golive"
              onClick={() =>
                run(
                  "golive",
                  () => executeFn({ data: { approvalId: goLiveExecutable.id } }),
                  "Agent is live — the existing Go Live logic ran.",
                )
              }
            >
              {busy === "golive" ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
              Apply & Go Live
            </Button>
          )}
          {!canRequestGoLive && !goLiveExecutable && goLiveItem?.status === "blocked" && (
            <p className="text-[11px] text-muted-foreground">{goLiveItem.detail}</p>
          )}
        </div>
      )}
      {cl.deployment.build_version_id && (
        <p className="text-[11px] text-muted-foreground">
          This agent was built in the Build Workspace — use <strong>Apply &amp; Go Live</strong>{" "}
          there. This checklist tracks readiness only.
        </p>
      )}
    </div>
  );
}
