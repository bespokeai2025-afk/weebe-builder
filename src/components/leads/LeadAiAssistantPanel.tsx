/**
 * AI Sales Assistant panel for one lead or Data record.
 *
 * Deliberately a single dialog reused from both the Leads list and Data → Records, rather than a
 * new page or module: the Leads page itself is untouched apart from one button per row.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  Clock,
  Copy,
  Globe,
  ListChecks,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { RelativeTime } from "@/components/ui/relative-time";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  generateLeadSalesAssistant,
  getSavedLeadSalesAssistant,
} from "@/lib/leads/sales-assistant.functions";
import { ASSISTANT_MODES, type AssistantMode } from "@/lib/leads/sales-assistant.shared";

/**
 * A row id the assistant can actually load.
 *
 * Not every list on the Leads page is backed by a lead: the WBAH tab is derived from wbah_calls,
 * whose ids look like "call_d4504de7…". Passing one through produced a raw zod dump in the toast
 * ("Invalid uuid"), which tells the user nothing. Checked here so any future caller gets a
 * sentence instead of a validation payload.
 */
export function isAssistantTargetId(id: string | null | undefined): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id ?? ""));
}

export type AssistantTarget = {
  id: string;
  source: "lead" | "record";
  name: string | null;
  company: string | null;
};

type Result = {
  mode: string;
  content: string;
  researchUrl: string | null;
  historyUsed: number;
  generatedAt: string;
};

/**
 * Pulls the "## Demo checklist" section out of the generated markdown.
 *
 * It is the one part of a demo brief that gets used while doing something else, so it is rendered
 * as its own tickable list above the brief rather than as prose buried in the middle of it.
 */
export function splitChecklist(markdown: string): { items: string[]; rest: string } {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => /^##\s+demo checklist\s*$/i.test(l.trim()));
  if (start === -1) return { items: [], rest: markdown };

  const items: string[] = [];
  let i = start + 1;
  for (; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line.startsWith("## ")) break;
    const m = /^[-*]\s*\[[ xX]?\]\s*(.+)$/.exec(line);
    if (m) items.push(m[1].trim());
    else if (line && !/^[-*]\s*$/.test(line)) items.push(line.replace(/^[-*]\s+/, ""));
  }
  if (items.length === 0) return { items: [], rest: markdown };
  const rest = [...lines.slice(0, start), ...lines.slice(i)].join("\n").trim();
  return { items, rest };
}

/**
 * Pulls the "## Hook" line out of a sales pitch.
 *
 * It is the one line the rep actually says or types first, so it is shown as a quotable callout
 * rather than as a heading with a paragraph under it like every other section.
 */
export function splitHook(markdown: string): { hook: string | null; rest: string } {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => /^##\s+hook\s*$/i.test(l.trim()));
  if (start === -1) return { hook: null, rest: markdown };

  const collected: string[] = [];
  let i = start + 1;
  for (; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line.startsWith("## ")) break;
    if (line) collected.push(line.replace(/^[-*]\s+/, "").replace(/^["“]|["”]$/g, ""));
  }
  const hook = collected.join(" ").trim();
  if (!hook) return { hook: null, rest: markdown };
  const rest = [...lines.slice(0, start), ...lines.slice(i)].join("\n").trim();
  return { hook, rest };
}

/** Minimal markdown rendering — the model is asked for headings, bullets and bold only. */
function RenderedMarkdown({ text }: { text: string }) {
  const blocks = text.split("\n");
  return (
    <div className="space-y-1.5">
      {blocks.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={i} className="h-1" />;
        if (trimmed.startsWith("## ")) {
          return (
            <h4 key={i} className="pt-1.5 text-xs font-semibold text-foreground">
              {trimmed.slice(3)}
            </h4>
          );
        }
        if (trimmed.startsWith("# ")) {
          return (
            <h4 key={i} className="pt-1.5 text-xs font-semibold text-foreground">
              {trimmed.slice(2)}
            </h4>
          );
        }
        const bullet = /^[-*]\s+/.test(trimmed);
        const numbered = /^\d+[.)]\s+/.test(trimmed);
        const body = bullet ? trimmed.replace(/^[-*]\s+/, "") : trimmed;
        const parts = body.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
        const rendered = parts.map((p, j) =>
          p.startsWith("**") && p.endsWith("**") ? (
            <strong key={j} className="font-semibold text-foreground">
              {p.slice(2, -2)}
            </strong>
          ) : (
            <span key={j}>{p}</span>
          ),
        );
        return (
          <p
            key={i}
            className={cn(
              "text-[11px] leading-relaxed text-muted-foreground",
              (bullet || numbered) && "pl-3",
            )}
          >
            {bullet ? "• " : ""}
            {rendered}
          </p>
        );
      })}
    </div>
  );
}

export function LeadAiAssistantPanel({
  target,
  onOpenChange,
}: {
  target: AssistantTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const generateFn = useServerFn(generateLeadSalesAssistant);
  const [mode, setMode] = useState<AssistantMode>("pitch");
  const [byMode, setByMode] = useState<Partial<Record<AssistantMode, Result>>>({});
  const [copied, setCopied] = useState(false);
  const [ticked, setTicked] = useState<Set<string>>(new Set());

  // What was generated for this lead previously. Kept on the row, so closing the panel — or
  // opening it from a different part of the app — no longer throws the work away.
  const canLoadSaved = !!target && isAssistantTargetId(target.id);
  const savedQuery = useQuery({
    queryKey: ["sales-assistant-saved", target?.source, target?.id],
    enabled: canLoadSaved,
    staleTime: 0,
    queryFn: () =>
      getSavedLeadSalesAssistant({
        data: { source: target!.source, id: target!.id },
      }) as Promise<Partial<Record<AssistantMode, Result>>>,
  });

  // Seed the panel from storage without clobbering anything generated in this session: a fresh
  // result is always newer than what was loaded.
  useEffect(() => {
    const saved = savedQuery.data;
    if (!saved) return;
    setByMode((prev) => {
      const merged = { ...prev };
      for (const [k, v] of Object.entries(saved)) {
        const key = k as AssistantMode;
        if (!merged[key] && v && typeof v === "object" && "content" in v) {
          merged[key] = v as Result;
        }
      }
      return merged;
    });
  }, [savedQuery.data]);

  const generate = useMutation({
    mutationFn: (opts: { mode: AssistantMode; refreshResearch?: boolean }) => {
      if (!isAssistantTargetId(target?.id)) {
        return Promise.reject(
          new Error(
            "This row is not a saved lead, so there is nothing to research. Open it from the Leads list.",
          ),
        );
      }
      return generateFn({
        data: {
          source: target!.source,
          id: target!.id,
          mode: opts.mode,
          refreshResearch: opts.refreshResearch,
        },
      });
    },
    onSuccess: (res: Result) => {
      setByMode((prev) => ({ ...prev, [res.mode as AssistantMode]: res }));
      setTicked(new Set());
      // Research and the generation itself are both stored on the row, so the
      // list's copy and the saved-generations query are now stale.
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["data-records"] });
      qc.invalidateQueries({ queryKey: ["sales-assistant-saved"] });
    },
    onError: (e: Error) => toast.error("Generation failed", { description: e.message }),
  });

  const result = byMode[mode];
  const isLoading = generate.isPending;
  const checklist = result ? splitChecklist(result.content) : { items: [], rest: "" };
  const hooked = splitHook(checklist.rest || result?.content || "");

  // Selecting a mode only selects it. Generating is an explicit act — the panel
  // used to fire a request the moment a mode was clicked, which spent a model
  // call before the rep had decided what they wanted.
  const pickMode = (next: AssistantMode) => {
    setMode(next);
    setCopied(false);
  };

  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy to clipboard");
    }
  };

  return (
    <Dialog
      open={!!target}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setByMode({});
          setMode("pitch");
          setCopied(false);
          setTicked(new Set());
          generate.reset();
        }
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Sparkles className="h-4 w-4 text-primary" />
            AI Sales Assistant
          </DialogTitle>
          <DialogDescription className="text-[11px]">
            {target?.name || "This lead"}
            {target?.company ? ` · ${target.company}` : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-1.5">
          {ASSISTANT_MODES.map((m) => (
            <Button
              key={m.id}
              size="sm"
              variant={mode === m.id ? "default" : "outline"}
              className="h-7 text-[11px]"
              onClick={() => pickMode(m.id)}
              disabled={isLoading}
            >
              {m.label}
              {/* A dot means something was already generated for this mode, so the
                  demo checklist and the other outputs can be found without
                  re-running them. */}
              {byMode[m.id] && (
                <span
                  className={cn(
                    "ml-1.5 h-1.5 w-1.5 rounded-full",
                    mode === m.id ? "bg-primary-foreground/70" : "bg-primary",
                  )}
                />
              )}
            </Button>
          ))}
        </div>
        <p className="-mt-1 text-[10px] text-muted-foreground">
          {ASSISTANT_MODES.find((m) => m.id === mode)?.blurb}
        </p>

        <div className="min-h-[220px] max-h-[52vh] overflow-y-auto rounded-md border border-border/60 bg-muted/20 p-3">
          {isLoading ? (
            <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 text-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <p className="text-[11px] text-muted-foreground">
                Reading this lead's history and researching the company…
              </p>
            </div>
          ) : generate.isError ? (
            <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 px-6 text-center">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <p className="text-[11px] text-destructive">
                {(generate.error as Error)?.message ?? "Something went wrong."}
              </p>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px]"
                onClick={() => generate.mutate({ mode })}
              >
                Try again
              </Button>
            </div>
          ) : result ? (
            <div className="space-y-3">
              {checklist.items.length > 0 && (
                <div className="rounded-md border border-primary/25 bg-primary/[0.06] p-2.5">
                  <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
                    <ListChecks className="h-3.5 w-3.5 text-primary" />
                    Demo checklist
                    <span className="ml-auto text-[10px] font-normal text-muted-foreground">
                      {[...ticked].filter((t) => checklist.items.includes(t)).length}/
                      {checklist.items.length} done
                    </span>
                  </p>
                  <div className="space-y-1">
                    {checklist.items.map((item) => (
                      <label
                        key={item}
                        className="flex cursor-pointer items-start gap-2 rounded px-1 py-0.5 hover:bg-white/[0.03]"
                      >
                        <Checkbox
                          className="mt-0.5"
                          checked={ticked.has(item)}
                          onCheckedChange={(v) =>
                            setTicked((prev) => {
                              const next = new Set(prev);
                              if (v === true) next.add(item);
                              else next.delete(item);
                              return next;
                            })
                          }
                        />
                        <span
                          className={cn(
                            "text-[11px] leading-relaxed",
                            ticked.has(item)
                              ? "text-muted-foreground line-through"
                              : "text-foreground",
                          )}
                        >
                          {item}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {hooked.hook && (
                <div className="rounded-md border border-primary/30 bg-primary/[0.08] px-3 py-2.5">
                  <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-primary/80">
                    Opening line
                  </p>
                  <p className="text-[13px] font-medium leading-snug text-foreground">
                    “{hooked.hook}”
                  </p>
                </div>
              )}
              <RenderedMarkdown text={hooked.rest || checklist.rest || result.content} />
            </div>
          ) : canLoadSaved && savedQuery.isLoading ? (
            <div className="flex h-full min-h-[200px] items-center justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 text-center">
              <p className="text-[11px] text-muted-foreground">
                Choose what you want above, then generate it. Nothing is sent until you do.
              </p>
              <Button
                size="sm"
                className="h-7 text-[11px]"
                onClick={() => generate.mutate({ mode })}
              >
                <Sparkles className="mr-1 h-3 w-3" />
                Generate {ASSISTANT_MODES.find((m) => m.id === mode)?.label}
              </Button>
            </div>
          )}
        </div>

        {result && (
          <div className="flex flex-wrap items-center gap-2">
            {/* Say what the answer was actually based on, so a generic-looking
                result can be explained rather than just distrusted. */}
            {result.researchUrl ? (
              <Badge variant="outline" className="gap-1 text-[10px]">
                <Globe className="h-2.5 w-2.5" />
                {result.researchUrl.replace(/^https?:\/\//, "")}
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1 text-[10px] text-amber-500">
                <AlertTriangle className="h-2.5 w-2.5" />
                No company website found
              </Badge>
            )}
            <Badge variant="outline" className="text-[10px]">
              {result.historyUsed > 0
                ? `${result.historyUsed} past interaction${result.historyUsed === 1 ? "" : "s"} used`
                : "No previous activity"}
            </Badge>
            {result.generatedAt && (
              <Badge variant="outline" className="gap-1 text-[10px] text-muted-foreground">
                <Clock className="h-2.5 w-2.5" />
                Generated <RelativeTime date={result.generatedAt} />
              </Badge>
            )}

            <div className="ml-auto flex gap-1.5">
              <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={copy}>
                {copied ? <Check className="mr-1 h-3 w-3" /> : <Copy className="mr-1 h-3 w-3" />}
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-[11px]"
                onClick={() => generate.mutate({ mode, refreshResearch: true })}
                disabled={isLoading}
              >
                <RefreshCw className="mr-1 h-3 w-3" />
                Regenerate
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
