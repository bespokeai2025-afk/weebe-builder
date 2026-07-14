// ── SystemMind prompt dock (Agent Builder) ─────────────────────────────────────
// Floating prompt box over the Builder canvas that opens the SystemMind Build
// Workspace as a right-side drawer, plus the "SystemMind Build" left-nav entry
// shown while a build session exists for the current agent.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Bot, Hammer, Lightbulb, Loader2, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SystemMindBuildDrawer } from "@/components/systemmind/SystemMindBuildDrawer";
import { createBuildSession, listBuildSessions } from "@/lib/systemmind/build-workspace.functions";

const HELPER_PROMPTS = [
  "Map the post-call data to Leads and Qualified.",
  "Create a workflow for positive and neutral leads.",
  "Add negative reason capture.",
  "Set this agent to call new webform leads instantly.",
  "Create a scheduled campaign with 50 calls per day.",
  "Create a 7-day follow-up sequence.",
  "Use WATI for WhatsApp follow-ups.",
  "Do not mark booked appointments as needs_to_call.",
];

export function useSystemMindBuildLauncher({
  agentRowId,
  agentName,
  channelType,
}: {
  agentRowId: string | null;
  agentName?: string | null;
  channelType?: string | null;
}) {
  const qc       = useQueryClient();
  const listFn   = useServerFn(listBuildSessions);
  const createFn = useServerFn(createBuildSession);

  const [open, setOpen]                   = useState(false);
  const [sessionId, setSessionId]         = useState<string | null>(null);
  const [initialPrompt, setInitialPrompt] = useState<string | null>(null);
  const [prompt, setPrompt]               = useState("");

  const { data: sessions, isPending: sessionsLoading } = useQuery({
    queryKey: ["smbw-sessions"],
    queryFn: () => listFn(),
    throwOnError: false,
    staleTime: 30_000,
  });

  // Reset all transient launcher state when the Builder switches to a different
  // agent, so a stale session from agent A never receives agent B's prompts.
  const prevAgentRef = useRef(agentRowId);
  useEffect(() => {
    if (prevAgentRef.current === agentRowId) return;
    prevAgentRef.current = agentRowId;
    setOpen(false);
    setSessionId(null);
    setInitialPrompt(null);
    setPrompt("");
  }, [agentRowId]);

  // Newest non-archived session already targeting this agent (list is newest-first).
  const existingSession = useMemo(() => {
    if (!agentRowId) return null;
    return (
      ((sessions ?? []) as any[]).find(
        (s) => s.target_agent_id === agentRowId && s.status !== "archived",
      ) ?? null
    );
  }, [sessions, agentRowId]);

  const createSession = useMutation({
    mutationFn: (_p: string) =>
      createFn({ data: { targetAgentId: agentRowId ?? null, sourcePage: "agent_builder" } }),
    onSuccess: (res: any, p) => {
      qc.invalidateQueries({ queryKey: ["smbw-sessions"] });
      setSessionId(res.sessionId);
      if (p) setInitialPrompt(p);
    },
    onError: (e: any) => {
      setOpen(false);
      toast.error("Could not start the SystemMind build", { description: e?.message });
    },
  });

  const launch = (text?: string) => {
    // Wait for the sessions list before creating, so we never race a reuse
    // check into a duplicate session for the same agent.
    if (sessionsLoading) return;
    const p = (text ?? prompt).trim();
    setPrompt("");
    setOpen(true);
    if (existingSession) {
      setSessionId(existingSession.id);
      if (p) setInitialPrompt(p);
    } else if (sessionId) {
      if (p) setInitialPrompt(p);
    } else if (!createSession.isPending) {
      createSession.mutate(p);
    }
  };

  const reopen = () => {
    if (existingSession) setSessionId(existingSession.id);
    setOpen(true);
  };

  const hasSession = Boolean(existingSession || sessionId);

  const dock = (
    <>
      <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-4">
        <div className="pointer-events-auto w-full max-w-xl rounded-xl border border-sky-500/20 bg-background/90 shadow-lg shadow-black/30 backdrop-blur-md">
          <form
            className="flex items-center gap-1.5 p-1.5 pl-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (prompt.trim()) launch();
            }}
          >
            <Bot className="h-3.5 w-3.5 shrink-0 text-sky-400" />
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Ask SystemMind to configure this agent workflow…"
              className="min-w-0 flex-1 bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button" size="sm" variant="ghost"
                  className="h-7 gap-1 px-2 text-[10px] text-muted-foreground hover:text-foreground"
                >
                  <Lightbulb className="h-3 w-3" /> Ideas
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-80">
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Try asking SystemMind…
                </DropdownMenuLabel>
                {HELPER_PROMPTS.map((p) => (
                  <DropdownMenuItem
                    key={p}
                    className="cursor-pointer text-[11px]"
                    onClick={() => launch(p)}
                  >
                    {p}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              type="submit" size="sm"
              className="h-7 gap-1 px-2.5 text-[10px]"
              disabled={!prompt.trim() || sessionsLoading}
            >
              {createSession.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              Build
            </Button>
          </form>
        </div>
      </div>

      <SystemMindBuildDrawer
        open={open}
        onOpenChange={setOpen}
        sessionId={sessionId ?? existingSession?.id ?? null}
        initialPrompt={initialPrompt}
        onInitialPromptConsumed={() => setInitialPrompt(null)}
        agentContext={{
          agentName: agentName ?? null,
          channelType: channelType ?? null,
        }}
      />
    </>
  );

  const navEntry = hasSession ? (
    <div className="border-b border-white/[0.04] p-1.5">
      <button
        onClick={reopen}
        className={cn(
          "flex w-full items-center gap-2 rounded-md border border-sky-500/25 bg-sky-500/[0.06] px-2 py-1.5",
          "text-[11px] font-medium text-sky-300 transition-colors hover:bg-sky-500/[0.12]",
        )}
      >
        <Hammer className="h-3 w-3 shrink-0" />
        <span className="truncate">SystemMind Build</span>
      </button>
    </div>
  ) : null;

  return { dock, navEntry, hasSession, reopen };
}
