// ── SystemMind Required Context panel ─────────────────────────────────────────
// The "Required Context" tab of the Setup Console: 10 grouped context cards,
// a Context Completeness Score, Auto-suggest (from agent scan) and an explicit
// Confirm step. Apply/Go Live stays gated until required context is complete
// AND confirmed (enforced server-side via computeRequiredInputs).

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  BookOpenCheck, Building2, CalendarClock, CheckCircle2, CircleAlert,
  ClipboardCheck, Database, Loader2, MessageSquareMore, PhoneForwarded,
  ShieldCheck, Sparkles, Target, Workflow, Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  saveSetupContext, autoSuggestSetupContext, confirmSetupContext,
} from "@/lib/systemmind/setup-console.functions";
import { useSetupConsole } from "@/components/systemmind/SetupConsolePanel";

type Ctx = Record<string, any>;

const EMPTY_CTX: Ctx = {
  business: { businessName: "", industry: "", mainGoal: "", problem: "", audience: "", desiredOutcome: "", onSuccess: "", onFailure: "" },
  agent: { channel: "", direction: "", lifecycle: "", updateMode: "", scanTarget: "" },
  data: { requiredFields: [], optionalFields: [], preProvidedFields: [], postCallFields: [], saveToWebee: null, sendToCrm: null, fieldsConfirmed: false },
  crm: { syncRequired: null, objectTable: "", pipeline: "", owner: "", sourceCode: "", duplicateRule: "", updateFields: "", triggerStatuses: "" },
  trigger: { source: "", object: "", field: "", value: "", frequency: "", timing: "", scopeFilter: "" },
  outcome: { finalAction: "", actions: [], notes: "" },
  booking: { required: null, calendarProvider: "", eventType: "", bookingVariable: "", duration: "", timezone: "", availabilityRules: "", confirmationMessage: "", rebookingRules: "", cancellationHandling: "", crmAppointmentField: "" },
  followup: { enabled: null, channel: "", delay: "", attempts: "", stopConditions: "", templates: "", owner: "", stopStatuses: "" },
  compliance: { canContact: null, consentSource: "", dncRules: "", region: "", callingHours: "", disclaimers: "", escalationRules: "", handoverRules: "" },
  success: { definition: "", testProves: "", webeeExpectation: "", crmExpectation: "", mustNotHappen: "", approver: "" },
};

export function RequiredContextPanel({
  sessionId, setup, onGoToTab,
}: {
  sessionId: string;
  setup: ReturnType<typeof useSetupConsole>;
  onGoToTab: (tab: string) => void;
}) {
  const saveFn = useServerFn(saveSetupContext);
  const suggestFn = useServerFn(autoSuggestSetupContext);
  const confirmFn = useServerFn(confirmSetupContext);

  const serverCtx = setup.state?.context ?? null;
  const cc = setup.contextCompleteness;

  // Local editable copy; re-seeded whenever the server copy changes identity.
  const [ctx, setCtx] = useState<Ctx>(() => mergeCtx(serverCtx));
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setCtx(mergeCtx(serverCtx));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(serverCtx)]);

  const set = (group: string, key: string, value: any) => {
    setCtx((c) => ({ ...c, [group]: { ...c[group], [key]: value } }));
    setDirty(true);
  };

  const save = useMutation({
    mutationFn: () => saveFn({ data: { sessionId, patch: buildPatch(ctx) } }),
    onSuccess: (res: any) => {
      setup.setData(res); setDirty(false);
      toast.success("Context saved", { description: "Any previous confirmation was reset — review and confirm again when ready." });
    },
    onError: (e: any) => toast.error("Could not save context", { description: e?.message }),
  });

  const suggest = useMutation({
    mutationFn: () => suggestFn({ data: { sessionId } }),
    onSuccess: (res: any) => {
      setup.setData(res); setDirty(false);
      toast.success("Suggestions added", { description: "I filled the empty fields from the agent scan. Nothing was overwritten — please review and confirm." });
    },
    onError: (e: any) => toast.error("Auto-suggest failed", { description: e?.message }),
  });

  const confirm = useMutation({
    mutationFn: () => confirmFn({ data: { sessionId } }),
    onSuccess: (res: any) => {
      setup.setData(res);
      toast.success("Context confirmed", { description: "SystemMind will build against this context. You can continue to Credentials." });
    },
    onError: (e: any) => toast.error("Cannot confirm yet", { description: e?.message }),
  });

  if (!setup.state) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <BookOpenCheck className="h-10 w-10 text-muted-foreground" />
          <div className="text-sm font-medium">Link and scan an agent first</div>
          <div className="max-w-sm text-xs text-muted-foreground">
            Required Context builds on the agent scan. Link the agent on the Agent &amp; Scan tab, then come back here.
          </div>
          <Button size="sm" onClick={() => onGoToTab("agent")}>Go to Agent &amp; Scan</Button>
        </CardContent>
      </Card>
    );
  }

  // Defensive: some cached responses may lack contextCompleteness (older
  // mutation results). Never render "all complete" from missing data — show a
  // loading state instead and let the refetch fill it in.
  if (!cc) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking context completeness…
        </CardContent>
      </Card>
    );
  }

  const confirmed = !!serverCtx?.confirmed;
  const score = cc.score ?? 0;
  const missingReq = cc.missingRequired ?? 0;
  const items: any[] = cc.items ?? [];
  const missingByGroup = new Map<string, any[]>();
  for (const i of items.filter((x: any) => !x.done)) {
    if (!missingByGroup.has(i.groupLabel)) missingByGroup.set(i.groupLabel, []);
    missingByGroup.get(i.groupLabel)!.push(i);
  }
  const itemDone = (group: string, key: string) =>
    items.find((i) => i.group === group && i.key === key)?.done ?? false;

  return (
    <div className="space-y-4">
      {/* Score header */}
      <Card id="ctx-score">
        <CardContent className="flex flex-col gap-3 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              {confirmed
                ? <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                : missingReq === 0
                  ? <ClipboardCheck className="h-5 w-5 text-sky-400" />
                  : <CircleAlert className="h-5 w-5 text-amber-400" />}
              <span className="text-sm font-semibold">Context Completeness</span>
            </div>
            <Badge className={`text-[10px] ${score >= 100 ? "bg-emerald-500/15 text-emerald-400" : score >= 60 ? "bg-sky-500/15 text-sky-400" : "bg-amber-500/15 text-amber-400"}`}>
              {score}% complete
            </Badge>
            {confirmed
              ? <Badge className="bg-emerald-500/15 text-emerald-400 text-[10px]">confirmed — SystemMind can build</Badge>
              : missingReq === 0
                ? <Badge className="bg-sky-500/15 text-sky-400 text-[10px]">ready to confirm</Badge>
                : <Badge className="bg-amber-500/15 text-amber-400 text-[10px]">{missingReq} required item{missingReq === 1 ? "" : "s"} missing</Badge>}
            <div className="ml-auto flex flex-wrap gap-2">
              <Button size="sm" variant="outline" className="h-7 text-xs"
                disabled={suggest.isPending || !setup.state?.scan?.scannedAt}
                onClick={() => suggest.mutate()}>
                {suggest.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
                Auto-suggest from scan
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={save.isPending || !dirty}
                onClick={() => save.mutate()}>
                {save.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                Save context
              </Button>
              <Button size="sm" className="h-7 text-xs"
                disabled={confirm.isPending || confirmed || missingReq > (itemDone("confirm", "confirmed") ? 0 : 1) || dirty}
                onClick={() => confirm.mutate()}>
                {confirm.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="mr-1 h-3.5 w-3.5" />}
                {confirmed ? "Confirmed" : "Confirm context"}
              </Button>
              {confirmed && (
                <Button size="sm" className="h-7 text-xs" onClick={() => onGoToTab("credentials")}>
                  Continue to Credentials
                </Button>
              )}
            </div>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div className={`h-full rounded-full transition-all ${score >= 100 ? "bg-emerald-500" : "bg-sky-500"}`} style={{ width: `${score}%` }} />
          </div>
          {dirty && <div className="text-[11px] text-amber-400">Unsaved changes — save before confirming.</div>}
        </CardContent>
      </Card>

      {/* Missing items summary */}
      {missingByGroup.size > 0 && (
        <Card id="ctx-missing">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <CircleAlert className="h-4 w-4 text-amber-400" /> Missing Context
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[...missingByGroup.entries()].map(([groupLabel, list]) => (
              <div key={groupLabel}>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{groupLabel}</div>
                <div className="space-y-1">
                  {list.map((i: any) => (
                    <div key={`${i.group}-${i.key}`} className="flex items-center gap-2 text-xs">
                      <CircleAlert className={`h-3.5 w-3.5 shrink-0 ${i.required ? "text-amber-400" : "text-muted-foreground"}`} />
                      <span>{i.label}</span>
                      {i.required && <Badge variant="outline" className="text-[9px]">required</Badge>}
                      <Button size="sm" variant="outline" className="ml-auto h-6 px-2 text-[10px]"
                        onClick={() => scrollToCtxAnchor(i.anchor)}>
                        Fill in
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* 1. Business */}
      <CtxCard icon={<Building2 className="h-4 w-4 text-sky-400" />} title="Business Context" done={groupDone(items, "business")}>
        <CtxText id="ctx-business-mainGoal" label="Main goal of the agent *" value={ctx.business.mainGoal}
          onChange={(v) => set("business", "mainGoal", v)}
          placeholder="e.g. Qualify estate agency seller leads and book valuations" />
        <CtxText id="ctx-business-desiredOutcome" label="Desired outcome *" value={ctx.business.desiredOutcome}
          onChange={(v) => set("business", "desiredOutcome", v)}
          placeholder="e.g. Qualified lead with booking pushed to the CRM" />
        <div className="grid gap-3 sm:grid-cols-2">
          <CtxInput id="ctx-business-audience" label="Who is the agent speaking to?" value={ctx.business.audience}
            onChange={(v) => set("business", "audience", v)} placeholder="Inbound website leads, cold outbound sellers…" />
          <CtxInput id="ctx-business-industry" label="Industry" value={ctx.business.industry}
            onChange={(v) => set("business", "industry", v)} placeholder="e.g. Estate agency" />
          <CtxInput id="ctx-business-onSuccess" label="After a successful call/message" value={ctx.business.onSuccess}
            onChange={(v) => set("business", "onSuccess", v)} placeholder="Update lead, book slot, notify owner…" />
          <CtxInput id="ctx-business-onFailure" label="After an unsuccessful call/message" value={ctx.business.onFailure}
            onChange={(v) => set("business", "onFailure", v)} placeholder="Start follow-up, mark no-answer…" />
        </div>
        <CtxInput id="ctx-business-problem" label="What problem is this solving?" value={ctx.business.problem}
          onChange={(v) => set("business", "problem", v)} placeholder="The business pain this setup removes" />
      </CtxCard>

      {/* 2. Agent */}
      <CtxCard icon={<Zap className="h-4 w-4 text-violet-400" />} title="Agent Context" done={groupDone(items, "agent")}>
        <div className="grid gap-3 sm:grid-cols-3">
          <CtxSelect id="ctx-agent-channel" label="Channel *" value={ctx.agent.channel || setup.state?.scan?.channel || ""}
            onChange={(v) => set("agent", "channel", v)}
            options={[["voice", "Phone / Voice"], ["whatsapp", "WhatsApp"], ["sms", "SMS"], ["email", "Email"], ["mixed", "Mixed"]]} />
          <CtxSelect id="ctx-agent-direction" label="Inbound or outbound?" value={ctx.agent.direction}
            onChange={(v) => set("agent", "direction", v)}
            options={[["inbound", "Inbound"], ["outbound", "Outbound"], ["both", "Both"]]} />
          <CtxSelect id="ctx-agent-updateMode" label="Update mode" value={ctx.agent.updateMode}
            onChange={(v) => set("agent", "updateMode", v)}
            options={[["update_existing", "Update existing agent"], ["new_workflow", "Create new workflow"]]} />
        </div>
        <div className="text-[11px] text-muted-foreground" id="ctx-agent-linked">
          {setup.state?.agentId
            ? <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-400" /> Agent linked{setup.state?.scan?.scannedAt ? " and scanned" : " — scan pending"}.</span>
            : <span className="flex items-center gap-1"><CircleAlert className="h-3 w-3 text-amber-400" /> No agent linked — <button className="underline" onClick={() => onGoToTab("agent")}>link one on the Agent &amp; Scan tab</button>.</span>}
        </div>
        <span id="ctx-agent-scanned" />
      </CtxCard>

      {/* 3. Data */}
      <CtxCard icon={<Database className="h-4 w-4 text-emerald-400" />} title="Data Collection Context" done={groupDone(items, "data")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <CtxSelect id="ctx-data-saveDestination" label="Save collected data to WEBEE? *"
            value={ctx.data.saveToWebee === null ? "" : ctx.data.saveToWebee ? "yes" : "no"}
            onChange={(v) => set("data", "saveToWebee", v === "yes")}
            options={[["yes", "Yes — save to WEBEE"], ["no", "No"]]} />
          <CtxSelect label="Send collected data to the CRM?"
            value={ctx.data.sendToCrm === null ? "" : ctx.data.sendToCrm ? "yes" : "no"}
            onChange={(v) => set("data", "sendToCrm", v === "yes")}
            options={[["yes", "Yes — sync to CRM"], ["no", "No"]]} />
        </div>
        <FieldChips label="Required fields (must be collected)" values={ctx.data.requiredFields}
          onChange={(v) => set("data", "requiredFields", v)} />
        <FieldChips label="Post-call fields (summary, transcript, outcome)" values={ctx.data.postCallFields}
          onChange={(v) => set("data", "postCallFields", v)} />
        <div className="flex items-center gap-2" id="ctx-data-fieldsConfirmed">
          <input type="checkbox" className="h-3.5 w-3.5" checked={!!ctx.data.fieldsConfirmed}
            onChange={(e) => set("data", "fieldsConfirmed", e.target.checked)} />
          <span className="text-xs">I confirm these are the fields the agent must collect and save *</span>
        </div>
      </CtxCard>

      {/* 4. CRM (conditional) */}
      {(cc?.crmRelevant || ctx.data.sendToCrm === true) && (
        <CtxCard icon={<Workflow className="h-4 w-4 text-orange-400" />} title="CRM Context" done={groupDone(items, "crm")}>
          <div className="text-[11px] text-muted-foreground" id="ctx-crm-provider">
            CRM provider and credentials are configured on the Credentials tab —{" "}
            <button className="underline" onClick={() => onGoToTab("credentials")}>open Credentials</button>.
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <CtxInput id="ctx-crm-objectTable" label="CRM object/table *" value={ctx.crm.objectTable}
              onChange={(v) => set("crm", "objectTable", v)} placeholder="e.g. leads, contacts, opportunities" />
            <CtxInput id="ctx-crm-duplicateRule" label="Duplicate handling rule *" value={ctx.crm.duplicateRule}
              onChange={(v) => set("crm", "duplicateRule", v)} placeholder="e.g. update existing lead by phone number" />
            <CtxInput id="ctx-crm-pipeline" label="Pipeline / stage" value={ctx.crm.pipeline}
              onChange={(v) => set("crm", "pipeline", v)} placeholder="Where new records land" />
            <CtxInput id="ctx-crm-owner" label="Default owner" value={ctx.crm.owner}
              onChange={(v) => set("crm", "owner", v)} placeholder="Record owner in the CRM" />
            <CtxInput id="ctx-crm-sourceCode" label="Source/campaign code" value={ctx.crm.sourceCode}
              onChange={(v) => set("crm", "sourceCode", v)} placeholder="Attribution code" />
            <CtxInput id="ctx-crm-triggerStatuses" label="CRM statuses that drive the workflow" value={ctx.crm.triggerStatuses}
              onChange={(v) => set("crm", "triggerStatuses", v)} placeholder="e.g. Qualified = 100000001" />
          </div>
        </CtxCard>
      )}

      {/* 5. Trigger */}
      <CtxCard icon={<Zap className="h-4 w-4 text-amber-400" />} title="Trigger Context" done={groupDone(items, "trigger")}>
        <CtxText id="ctx-trigger-source" label="What starts this workflow? *" value={ctx.trigger.source}
          onChange={(v) => set("trigger", "source", v)}
          placeholder="e.g. WEBEE lead status becomes Positive; CRM lead becomes Qualified; call outcome is Appointment Booked" />
        <div className="grid gap-3 sm:grid-cols-3">
          <CtxSelect id="ctx-trigger-frequency" label="Trigger once or every time?" value={ctx.trigger.frequency}
            onChange={(v) => set("trigger", "frequency", v)}
            options={[["once", "Once per lead"], ["every_time", "Every matching change"]]} />
          <CtxSelect id="ctx-trigger-timing" label="Timing" value={ctx.trigger.timing}
            onChange={(v) => set("trigger", "timing", v)}
            options={[["immediate", "Immediately"], ["delayed", "After a delay"]]} />
          <CtxInput id="ctx-trigger-scopeFilter" label="Limit to campaigns/agents/sources" value={ctx.trigger.scopeFilter}
            onChange={(v) => set("trigger", "scopeFilter", v)} placeholder="Optional filter" />
        </div>
      </CtxCard>

      {/* 6. Outcome */}
      <CtxCard icon={<Target className="h-4 w-4 text-rose-400" />} title="Outcome Context" done={groupDone(items, "outcome")}>
        <CtxText id="ctx-outcome-finalAction" label="Final action after the trigger *" value={ctx.outcome.finalAction}
          onChange={(v) => set("outcome", "finalAction", v)}
          placeholder="e.g. Create/update lead in WEBEE, book the appointment, send WhatsApp confirmation" />
        <CtxInput label="Notes" value={ctx.outcome.notes} onChange={(v) => set("outcome", "notes", v)} placeholder="Anything else about the end result" />
      </CtxCard>

      {/* 7. Booking (conditional) */}
      <CtxCard icon={<CalendarClock className="h-4 w-4 text-sky-400" />} title="Booking Context" done={groupDone(items, "booking")}>
        <CtxSelect label="Does this setup involve booking appointments?"
          value={ctx.booking.required === null ? "" : ctx.booking.required ? "yes" : "no"}
          onChange={(v) => set("booking", "required", v === "yes")}
          options={[["yes", "Yes — booking involved"], ["no", "No booking"]]} />
        {(ctx.booking.required === true || (ctx.booking.required === null && cc?.bookingRelevant)) && (
          <div className="grid gap-3 sm:grid-cols-2">
            <CtxInput id="ctx-booking-calendarProvider" label="Calendar provider *" value={ctx.booking.calendarProvider}
              onChange={(v) => set("booking", "calendarProvider", v)} placeholder="e.g. Cal.com, Google Calendar" />
            <CtxInput id="ctx-booking-bookingVariable" label="Booking field/variable *" value={ctx.booking.bookingVariable}
              onChange={(v) => set("booking", "bookingVariable", v)} placeholder="Detected variable that carries the slot" />
            <CtxInput id="ctx-booking-eventType" label="Event type / booking link *" value={ctx.booking.eventType}
              onChange={(v) => set("booking", "eventType", v)} placeholder="e.g. valuation-30min" />
            <CtxInput id="ctx-booking-timezone" label="Timezone *" value={ctx.booking.timezone}
              onChange={(v) => set("booking", "timezone", v)} placeholder="e.g. Europe/London" />
            <CtxInput id="ctx-booking-confirmationMessage" label="Confirmation handling" value={ctx.booking.confirmationMessage}
              onChange={(v) => set("booking", "confirmationMessage", v)} placeholder="What the lead receives once booked" />
            <CtxInput id="ctx-booking-cancellationHandling" label="Cancellation/reschedule handling" value={ctx.booking.cancellationHandling}
              onChange={(v) => set("booking", "cancellationHandling", v)} placeholder="What happens on cancel/reschedule" />
          </div>
        )}
      </CtxCard>

      {/* 8. Follow-up (conditional) */}
      <CtxCard icon={<PhoneForwarded className="h-4 w-4 text-emerald-400" />} title="Follow-Up Context" done={groupDone(items, "followup")}>
        <CtxSelect label="Should there be automatic follow-up?"
          value={ctx.followup.enabled === null ? "" : ctx.followup.enabled ? "yes" : "no"}
          onChange={(v) => set("followup", "enabled", v === "yes")}
          options={[["yes", "Yes — follow up automatically"], ["no", "No follow-up"]]} />
        {ctx.followup.enabled === true && (
          <div className="grid gap-3 sm:grid-cols-2">
            <CtxSelect id="ctx-followup-channel" label="Channel *" value={ctx.followup.channel}
              onChange={(v) => set("followup", "channel", v)}
              options={[["call", "Call"], ["whatsapp", "WhatsApp"], ["sms", "SMS"], ["email", "Email"]]} />
            <CtxInput id="ctx-followup-delay" label="Delay before first follow-up *" value={ctx.followup.delay}
              onChange={(v) => set("followup", "delay", v)} placeholder="e.g. 30 minutes, next morning" />
            <CtxInput id="ctx-followup-attempts" label="Number of attempts *" value={ctx.followup.attempts}
              onChange={(v) => set("followup", "attempts", v)} placeholder="e.g. 3" />
            <CtxInput id="ctx-followup-stopConditions" label="Stop conditions *" value={ctx.followup.stopConditions}
              onChange={(v) => set("followup", "stopConditions", v)} placeholder="e.g. stop when booked or lead replies STOP" />
          </div>
        )}
      </CtxCard>

      {/* 9. Compliance */}
      <CtxCard icon={<ShieldCheck className="h-4 w-4 text-teal-400" />} title="Compliance & Guardrails" done={groupDone(items, "compliance")}>
        <div className="grid gap-3 sm:grid-cols-2">
          <CtxInput id="ctx-compliance-callingHours" label="Calling hours" value={ctx.compliance.callingHours}
            onChange={(v) => set("compliance", "callingHours", v)} placeholder="e.g. 9am–7pm Mon–Sat, Europe/London" />
          <CtxInput id="ctx-compliance-dncRules" label="Do-not-contact rules" value={ctx.compliance.dncRules}
            onChange={(v) => set("compliance", "dncRules", v)} placeholder="e.g. respect opt-outs, max 3 calls/day" />
          <CtxInput id="ctx-compliance-handoverRules" label="Human handover rules" value={ctx.compliance.handoverRules}
            onChange={(v) => set("compliance", "handoverRules", v)} placeholder="When should a human take over?" />
          <CtxInput label="Region / regulations" value={ctx.compliance.region}
            onChange={(v) => set("compliance", "region", v)} placeholder="e.g. UK, GDPR" />
        </div>
      </CtxCard>

      {/* 10. Success criteria */}
      <CtxCard icon={<MessageSquareMore className="h-4 w-4 text-fuchsia-400" />} title="Success Criteria" done={groupDone(items, "success")}>
        <CtxText id="ctx-success-definition" label="What does a successful setup mean? *" value={ctx.success.definition}
          onChange={(v) => set("success", "definition", v)}
          placeholder="e.g. Lead updated in WEBEE with all fields; CRM receives mapped fields; test payload passes" />
        <div className="grid gap-3 sm:grid-cols-2">
          <CtxInput id="ctx-success-testProves" label="What should the test prove?" value={ctx.success.testProves}
            onChange={(v) => set("success", "testProves", v)} placeholder="e.g. a fake lead flows end-to-end" />
          <CtxInput id="ctx-success-mustNotHappen" label="What should NOT happen?" value={ctx.success.mustNotHappen}
            onChange={(v) => set("success", "mustNotHappen", v)} placeholder="e.g. no duplicate CRM records" />
        </div>
      </CtxCard>

      {/* Confirm footer */}
      <Card id="ctx-confirm-confirmed">
        <CardContent className="flex flex-wrap items-center gap-3 py-4">
          {confirmed ? (
            <>
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              <div className="text-sm">
                Context confirmed{serverCtx?.confirmedAt ? ` on ${new Date(serverCtx.confirmedAt).toLocaleString()}` : ""}.
                Editing any field resets confirmation.
              </div>
              <Button size="sm" className="ml-auto h-7 text-xs" onClick={() => onGoToTab("credentials")}>
                Continue to Credentials
              </Button>
            </>
          ) : (
            <>
              <CircleAlert className="h-5 w-5 text-amber-400" />
              <div className="text-sm">
                SystemMind never builds on unconfirmed context. Save your changes, resolve the required items above, then confirm.
              </div>
              <div className="ml-auto flex gap-2">
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={save.isPending || !dirty} onClick={() => save.mutate()}>
                  Save context
                </Button>
                <Button size="sm" className="h-7 text-xs" disabled={confirm.isPending || dirty} onClick={() => confirm.mutate()}>
                  {confirm.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="mr-1 h-3.5 w-3.5" />}
                  Confirm context
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function mergeCtx(server: any): Ctx {
  const s = server && typeof server === "object" ? server : {};
  const out: Ctx = {};
  for (const [group, defaults] of Object.entries(EMPTY_CTX)) {
    out[group] = { ...(defaults as any), ...(s[group] ?? {}) };
  }
  return out;
}

function buildPatch(ctx: Ctx): Record<string, any> {
  // Send every group — the server merges and resets confirmation on save.
  const patch: Record<string, any> = {};
  for (const group of Object.keys(EMPTY_CTX)) patch[group] = ctx[group];
  return patch;
}

function groupDone(items: any[], group: string): boolean {
  const g = items.filter((i) => i.group === group && i.required);
  return g.length === 0 || g.every((i) => i.done);
}

function scrollToCtxAnchor(anchor: string) {
  setTimeout(() => {
    const el = document.getElementById(anchor);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-amber-400/80", "rounded-md");
      setTimeout(() => el.classList.remove("ring-2", "ring-amber-400/80", "rounded-md"), 2600);
    }
  }, 250);
}

function CtxCard({ icon, title, done, children }: { icon: React.ReactNode; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          {icon} {title}
          {done
            ? <Badge className="bg-emerald-500/15 text-emerald-400 text-[10px]">complete</Badge>
            : <Badge className="bg-amber-500/15 text-amber-400 text-[10px]">needs input</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

function CtxInput({ id, label, value, onChange, placeholder }: {
  id?: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div className="space-y-1" id={id}>
      <Label className="text-xs">{label}</Label>
      <Input className="h-8 text-xs" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function CtxText({ id, label, value, onChange, placeholder }: {
  id?: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div className="space-y-1" id={id}>
      <Label className="text-xs">{label}</Label>
      <Textarea className="min-h-[60px] text-xs" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function CtxSelect({ id, label, value, onChange, options }: {
  id?: string; label: string; value: string; onChange: (v: string) => void; options: [string, string][];
}) {
  return (
    <div className="space-y-1" id={id}>
      <Label className="text-xs">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Choose…" /></SelectTrigger>
        <SelectContent>
          {options.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function FieldChips({ label, values, onChange }: {
  label: string; values: string[]; onChange: (v: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex flex-wrap items-center gap-1.5">
        {values.map((v) => (
          <Badge key={v} variant="outline" className="gap-1 text-[10px]">
            {v}
            <button className="text-muted-foreground hover:text-foreground" onClick={() => onChange(values.filter((x) => x !== v))}>×</button>
          </Badge>
        ))}
        <Input className="h-7 w-44 text-xs" placeholder="Add field + Enter" value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              e.preventDefault();
              if (!values.includes(draft.trim())) onChange([...values, draft.trim()]);
              setDraft("");
            }
          }} />
      </div>
    </div>
  );
}
