import { useState } from "react";
import { ChevronDown, Copy, Flag } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useBuilderStore } from "@/lib/builder/store";
import { sourceLabel } from "@/lib/builder/flow-variables";
import { useFlowVariables } from "./VariableAutocompleteField";
import { toast } from "sonner";

export function FlowVariablesSection() {
  const vars = useFlowVariables();
  const selectNode = useBuilderStore((s) => s.selectNode);
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (name: string) => {
    const token = `{{${name}}}`;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(name);
      window.setTimeout(() => setCopied((c) => (c === name ? null : c)), 1200);
    } catch {
      toast.error("Could not copy");
    }
  };

  return (
    <Collapsible className="rounded-lg border border-white/[0.06] bg-white/[0.01]">
      <CollapsibleTrigger className="group flex w-full min-h-[44px] items-center justify-between px-2.5 py-0 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors">
        <span>Variables</span>
        <span className="flex items-center gap-1.5">
          <span className="text-[10px] tabular-nums">{vars.length}</span>
          <ChevronDown className="h-3 w-3 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-1.5 px-2.5 pb-2.5">
        <p className="text-[10px] text-muted-foreground leading-snug">
          Type <code className="font-mono">{"{{"}</code> in a prompt or equation to insert. Click a
          name to copy.
        </p>
        <div className="space-y-1 max-h-56 overflow-y-auto">
          {vars.map((v) => (
            <div
              key={`${v.source}-${v.name}-${v.nodeId ?? ""}`}
              className="flex items-center gap-1.5 rounded border bg-muted/30 px-1.5 py-1"
            >
              <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={() => copy(v.name)}
                title="Copy {{name}}"
              >
                <span className="block truncate font-mono text-[10px]">{`{{${v.name}}}`}</span>
                <span className="block truncate text-[9px] text-muted-foreground">
                  {sourceLabel(v.source)}
                  {v.nodeLabel ? ` · ${v.nodeLabel}` : ""}
                </span>
              </button>
              {v.nodeId && (
                <button
                  type="button"
                  className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  title="Select defining node"
                  onClick={() => selectNode(v.nodeId!)}
                >
                  <Flag className="h-3 w-3" />
                </button>
              )}
              <button
                type="button"
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Copy"
                onClick={() => copy(v.name)}
              >
                <Copy className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
        {copied && (
          <p className="text-[10px] text-emerald-600">Copied {`{{${copied}}}`}</p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
