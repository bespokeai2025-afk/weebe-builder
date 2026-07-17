// ── SystemMind Build Drawer ─────────────────────────────────────────────────────
// Right-side drawer (~75% viewport, expandable to fullscreen; fullscreen on
// mobile) that hosts the SystemMind Build Workspace WITHOUT navigating away
// from the Agent Builder page. Spec: "SystemMind Workflow Builder" drawer.

import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Bot, ExternalLink, GitBranch, Maximize2, Minimize2, Phone, Radio } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { BuildSessionView } from "./BuildSessionView";

export function SystemMindBuildDrawer({
  open,
  onOpenChange,
  sessionId,
  initialPrompt,
  onInitialPromptConsumed,
  agentContext,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string | null;
  initialPrompt?: string | null;
  onInitialPromptConsumed?: () => void;
  agentContext?: {
    agentName?: string | null;
    agentType?: string | null;
    channelType?: string | null;
    isLive?: boolean | null;
    retellAgentId?: string | null;
  };
}) {
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState(false);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={cn(
          "flex w-full flex-col gap-0 p-0 sm:max-w-none",
          expanded ? "sm:w-screen" : "sm:w-[75vw]",
        )}
      >
        {/* Header */}
        <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-4 py-3 pr-12">
          <Bot className="h-4 w-4 shrink-0 text-sky-400" />
          <div className="min-w-0">
            <SheetTitle className="truncate text-sm font-semibold">
              SystemMind Workflow Builder
            </SheetTitle>
            <SheetDescription className="truncate text-[11px] text-muted-foreground">
              {agentContext?.agentName
                ? <>Configuring workflow for: <span className="font-medium text-foreground/80">{agentContext.agentName}</span></>
                : "Configure this agent's workflow with SystemMind"}
            </SheetDescription>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 pl-1">
            {agentContext?.agentType && (
              <Badge variant="secondary" className="text-[9px]">{agentContext.agentType.replace(/_/g, " ")}</Badge>
            )}
            {agentContext?.channelType && (
              <Badge variant="outline" className="gap-1 text-[9px]">
                <Phone className="h-2.5 w-2.5" /> {agentContext.channelType}
              </Badge>
            )}
            {agentContext?.isLive != null && (
              <Badge
                variant="outline"
                className={cn(
                  "gap-1 text-[9px]",
                  agentContext.isLive ? "border-emerald-500/50 text-emerald-300" : "border-white/20 text-muted-foreground",
                )}
              >
                <Radio className="h-2.5 w-2.5" /> {agentContext.isLive ? "live" : "draft"}
              </Badge>
            )}
            {agentContext?.retellAgentId && (
              <Badge variant="outline" className="hidden text-[9px] text-muted-foreground xl:inline-flex" title={agentContext.retellAgentId}>
                WEBEE Voice ID: {agentContext.retellAgentId.slice(0, 14)}…
              </Badge>
            )}
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Button
              size="sm" variant="outline"
              className="h-7 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
              onClick={() => {
                onOpenChange(false);
                navigate({
                  to: "/systemmind/build",
                  search: { tab: "workflows" } as never,
                });
              }}
            >
              <GitBranch className="h-3 w-3" /> Workflows
            </Button>
            {sessionId && (
              <Button
                size="sm" variant="outline"
                className="h-7 gap-1 px-2 text-[11px] border-sky-500/30 text-sky-400 hover:text-sky-300"
                onClick={() => {
                  onOpenChange(false);
                  navigate({
                    to: "/systemmind/build",
                    search: { session: sessionId, workflow: undefined, agent: undefined },
                  });
                }}
              >
                <ExternalLink className="h-3 w-3" /> Open in SystemMind
              </Button>
            )}
            <Button
              size="sm" variant="ghost"
              className="hidden h-7 w-7 p-0 text-muted-foreground sm:inline-flex"
              onClick={() => setExpanded((e) => !e)}
              title={expanded ? "Shrink" : "Expand to full screen"}
            >
              {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1 flex-col p-3">
          {sessionId ? (
            <BuildSessionView
              key={sessionId}
              sessionId={sessionId}
              embedded
              initialPrompt={initialPrompt}
              onInitialPromptConsumed={onInitialPromptConsumed}
              onDeleted={() => onOpenChange(false)}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
              Starting a build session…
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
