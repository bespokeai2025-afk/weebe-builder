import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Workflow,
  Bot,
  ExternalLink,
  Loader2,
  CheckCircle2,
  Circle,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  WBAH_N8N_BRANCHES,
  WBAH_N8N_WEBHOOK_URL,
  WBAH_N8N_WORKFLOW_ID,
  WBAH_NEW_LEADS_AGENTS,
  WBAH_CALL_SCRIPT_TEMPLATE_NAME,
  WBAH_WEBEE_RETELL_WEBHOOK_URL,
} from "@/lib/systemmind/wbah-n8n-integration.shared";
import {
  createWbahNewLeadsBuildSessionFn,
  getWbahN8nIntegrationStatusFn,
  seedWbahN8nSystemMindFn,
} from "@/lib/systemmind/wbah-n8n-integration.functions";
import { WbahWorkflowBuilderPanel } from "@/components/wbah/WbahWorkflowBuilderPanel";

function StatusRow({
  ok,
  label,
  detail,
}: {
  ok: boolean;
  label: string;
  detail?: string;
}) {
  return (
    <div className="flex items-start gap-2 text-xs">
      {ok ? (
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
      ) : (
        <Circle className="h-3.5 w-3.5 text-gray-600 shrink-0 mt-0.5" />
      )}
      <div>
        <p className={ok ? "text-gray-200" : "text-gray-500"}>{label}</p>
        {detail && <p className="text-[10px] text-gray-500 mt-0.5">{detail}</p>}
      </div>
    </div>
  );
}

export function WbahN8nSystemMindPanel() {
  const qc = useQueryClient();
  const statusFn = useServerFn(getWbahN8nIntegrationStatusFn);
  const seedFn = useServerFn(seedWbahN8nSystemMindFn);
  const buildFn = useServerFn(createWbahNewLeadsBuildSessionFn);
  const [busy, setBusy] = useState<string | null>(null);

  const { data: status, isLoading } = useQuery({
    queryKey: ["wbah-n8n-systemmind"],
    queryFn: () => statusFn(),
    throwOnError: false,
  });

  async function run(action: string, fn: () => Promise<unknown>) {
    setBusy(action);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ["wbah-n8n-systemmind"] });
      toast.success(`${action} complete`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function openBuildSession() {
    setBusy("build");
    try {
      const res = (await buildFn()) as { sessionId: string };
      toast.success("SystemMind build session created");
      window.location.href = `/systemmind/build?session=${res.sessionId}`;
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <WbahWorkflowBuilderPanel />

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Workflow className="h-4 w-4 text-violet-400" />
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            SystemMind — WBAH Post-Call (n8n → WEBEE)
          </h3>
        </div>
        <Badge variant="outline" className="text-[10px] border-violet-500/40 text-violet-300">
          {WBAH_N8N_WORKFLOW_ID.slice(0, 8)}…
        </Badge>
      </div>

      <p className="text-[11px] text-gray-400 leading-relaxed">
        Native WEBEE post-call pipeline replaces n8n workflow{" "}
        <code className="text-gray-500">{WBAH_N8N_WORKFLOW_ID}</code>. SystemMind registers the
        call script, outcome rules, and migration checklist. Point Retell agents at{" "}
        <code className="text-emerald-400/90 break-all">{WBAH_WEBEE_RETELL_WEBHOOK_URL}</code>{" "}
        after enabling <code className="text-gray-500">WBAH_POST_CALL_ENABLED=true</code>.
      </p>

      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading integration status…
        </div>
      ) : status ? (
        <div className="grid gap-2 bg-gray-950 rounded-lg p-3">
          <StatusRow
            ok={status.n8nWorkflowRegistered}
            label="n8n workflow registered in SystemMind"
            detail={status.n8nWorkflowRowId ?? undefined}
          />
          <StatusRow
            ok={!!status.systemmindTemplateId}
            label="Workflow template library entry"
            detail={
              status.systemmindTemplateStatus
                ? `Status: ${status.systemmindTemplateStatus}`
                : undefined
            }
          />
          <StatusRow
            ok={status.migration?.executionEnabled ?? false}
            label="WBAH_POST_CALL_ENABLED (dashboard + CRM writes)"
            detail={
              status.migration?.executionEnabled
                ? "Side effects active"
                : "Live transcript only — set env to true for cutover"
            }
          />
          <StatusRow
            ok={status.migration?.queueEnabled ?? false}
            label="WBAH_POST_CALL_QUEUE (async job processing)"
            detail={
              status.migration?.queueEnabled
                ? "Webhooks enqueue post-call jobs"
                : "Synchronous pipeline only"
            }
          />
          <StatusRow
            ok={status.migration?.automationEngineEnabled ?? false}
            label="WBAH_USE_AUTOMATION_ENGINE (graph executor)"
            detail={
              status.migration?.automationEngineEnabled
                ? `${status.migration.pipelineLabel ?? "Automation engine"} · Phase ${status.migration.automationEnginePhase ?? 4} · ${status.migration.wbahPluginNodeCount ?? 0} WBAH plugin nodes`
                : "Legacy imperative pipeline — set env to true to use canvas graph executor"
            }
          />
          <StatusRow
            ok={status.migration?.dynamicsConfigured ?? false}
            label="Dynamics 365 credentials"
          />
          <StatusRow
            ok={status.migration?.calendlyConfigured ?? false}
            label="Calendly API token"
          />
          <StatusRow
            ok={status.migration?.readyForCutover ?? false}
            label="Ready for Retell webhook cutover"
            detail={status.migration?.webeeWebhookUrl}
          />
        </div>
      ) : null}

      <div className="space-y-2">
        <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">
          Legacy n8n webhook (disable after cutover)
        </p>
        <code className="text-[10px] text-gray-600 break-all">{WBAH_N8N_WEBHOOK_URL}</code>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">
          WBAH dialer agents (Retell → WEBEE)
        </p>
        <ul className="space-y-1">
          {WBAH_NEW_LEADS_AGENTS.map((a) => (
            <li
              key={a.retellAgentId}
              className="flex items-center gap-2 text-[10px] text-gray-400 font-mono"
            >
              <Bot className="h-3 w-3 text-gray-600" />
              {a.label}
              <span className="text-gray-600">·</span>
              {a.retellAgentId}
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-1.5">
        <p className="text-[10px] font-medium text-gray-500 uppercase tracking-wide">
          n8n branches (documented)
        </p>
        {WBAH_N8N_BRANCHES.map((b) => (
          <div key={b.id} className="text-[10px] text-gray-500">
            <span className="text-gray-400">{b.label}</span>
            <span className="text-gray-600"> — </span>
            {b.summary}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs border-gray-700"
          disabled={!!busy}
          onClick={() => run("Seed", () => seedFn())}
        >
          {busy === "Seed" ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
          Register in SystemMind
        </Button>
        <Button
          size="sm"
          className="h-8 text-xs bg-violet-600 hover:bg-violet-500"
          disabled={!!busy}
          onClick={openBuildSession}
        >
          {busy === "build" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
          ) : (
            <Sparkles className="h-3.5 w-3.5 mr-1" />
          )}
          Create Build Session
        </Button>
        {status?.lastBuildSessionId && (
          <Button size="sm" variant="ghost" className="h-8 text-xs" asChild>
            <Link to="/systemmind/build" search={{ session: status.lastBuildSessionId }}>
              Open last session
            </Link>
          </Button>
        )}
        <Button size="sm" variant="ghost" className="h-8 text-xs" asChild>
          <a href={WBAH_N8N_WEBHOOK_URL} target="_blank" rel="noreferrer">
            n8n webhook <ExternalLink className="h-3 w-3 ml-1 inline" />
          </a>
        </Button>
        <Button size="sm" variant="ghost" className="h-8 text-xs" asChild>
          <Link to="/systemmind/template-library">Template library</Link>
        </Button>
      </div>
      </div>
    </div>
  );
}
