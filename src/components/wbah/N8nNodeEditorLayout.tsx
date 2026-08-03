/**
 * n8n-style node editor — INPUT (left) | node config (center) | OUTPUT (right).
 */
import { useState } from "react";
import {
  ArrowLeft,
  Code2,
  Focus,
  Play,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { N8nIoPanel } from "@/components/wbah/N8nIoPanel";
import { N8nNodeParameterEditor } from "@/components/wbah/N8nNodeParameterEditor";
import { N8nNodeSettingsEditor } from "@/components/wbah/N8nNodeSettingsEditor";
import { getNodeImplementation } from "@/lib/wbah/workflow/wbah-n8n-node-implementations.shared";
import {
  WBAH_N8N_NODE_CATALOG,
  type WbahN8nNodeKind,
} from "@/lib/wbah/workflow/wbah-n8n-node-catalog.shared";
import { resolveNodeJavaScript } from "@/lib/wbah/workflow/wbah-n8n-code-snippets.shared";
import { N8N_KIND_TYPE_LABEL } from "@/lib/wbah/workflow/wbah-node-display.shared";
import type { WbahN8nNodeConfig } from "@/lib/wbah/workflow/wbah-n8n-node-presets.shared";
import type { Edge, Node } from "@xyflow/react";

export function N8nNodeEditorLayout({
  node,
  edges,
  onUpdate,
  onDelete,
  onClose,
  onFocusConnections,
  onDeleteEdge,
  onExecuteStep,
  executePending,
}: {
  node: Node;
  edges: Edge[];
  onUpdate: (patch: {
    label?: string;
    enabled?: boolean;
    config?: Partial<WbahN8nNodeConfig>;
  }) => void;
  onDelete: () => void;
  onClose: () => void;
  onFocusConnections: () => void;
  onDeleteEdge: (edgeId: string) => void;
  onExecuteStep?: () => Promise<void>;
  executePending?: boolean;
}) {
  const [executeError, setExecuteError] = useState<string | null>(null);
  const data = node.data as Record<string, unknown>;
  const config = (data.config ?? {}) as Record<string, unknown>;
  const kind = String(data.kind ?? "code") as WbahN8nNodeKind;
  const impl = getNodeImplementation(node.id);
  const incoming = edges.filter((e) => e.target === node.id);
  const outgoing = edges.filter((e) => e.source === node.id);
  const catalog = WBAH_N8N_NODE_CATALOG.find((c) => c.id === node.id);
  const typeLabel = N8N_KIND_TYPE_LABEL[kind] ?? kind;

  const inputData =
    config.pinData ??
    (config.lastExecution as { input?: unknown } | undefined)?.input ??
    null;
  const outputData =
    (config.lastExecution as { output?: unknown } | undefined)?.output ?? null;

  return (
    <div className="flex flex-1 min-h-0 bg-[#0a0a0f]">
      <div className="w-[26%] min-w-[240px] max-w-[380px] shrink-0 border-r border-gray-800 flex flex-col min-h-0">
        <N8nIoPanel
          side="input"
          data={inputData}
          editable
          onPinDataChange={(pin) => onUpdate({ config: { pinData: pin } })}
          emptyLabel="No input data yet. Pin test JSON in Form/JSON view, or run upstream nodes."
        />
      </div>

      <div className="flex-1 min-w-[340px] flex flex-col min-h-0 border-r border-gray-800 bg-[#111118]">
        <div className="shrink-0 border-b border-gray-800 px-4 py-3 flex items-start gap-3">
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 shrink-0 text-gray-400 hover:text-gray-100"
            onClick={onClose}
            title="Back to canvas"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] text-gray-500 uppercase tracking-wide">{typeLabel}</p>
            <Input
              value={String(data.label ?? "")}
              onChange={(e) => onUpdate({ label: e.target.value })}
              className="mt-0.5 h-9 text-sm font-semibold bg-transparent border-0 border-b border-transparent hover:border-gray-700 focus-visible:border-violet-500/50 focus-visible:ring-0 px-0 rounded-none"
            />
            <p className="text-[10px] text-gray-600 font-mono truncate">{node.id}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-[10px] border-gray-700 text-gray-300 hover:text-gray-100"
              disabled={!onExecuteStep || executePending}
              title="Execute this node with pinned input (HTTP runs in dry-run mode)"
              onClick={async () => {
                if (!onExecuteStep) return;
                setExecuteError(null);
                try {
                  await onExecuteStep();
                } catch (e) {
                  setExecuteError(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              {executePending ? (
                <span className="h-3 w-3 mr-1 inline-block animate-spin rounded-full border border-gray-500 border-t-violet-400" />
              ) : (
                <Play className="h-3 w-3 mr-1" />
              )}
              Execute step
            </Button>
            {node.id !== "webhook" && (
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-red-400/80 hover:text-red-300"
                onClick={onDelete}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        <div className="shrink-0 px-4 py-2 flex flex-wrap items-center gap-2 border-b border-gray-800/80">
          {catalog?.n8nRef != null && (
            <Badge variant="outline" className="text-[9px] border-gray-700">
              n8n #{catalog.n8nRef}
            </Badge>
          )}
          {data.executorStepId ? (
            <Badge variant="outline" className="text-[9px] border-violet-500/30 text-violet-300">
              step: {String(data.executorStepId)}
            </Badge>
          ) : null}
          <div className="flex items-center gap-2 ml-auto">
            <Label className="text-[10px] text-gray-500">Enabled</Label>
            <Switch
              checked={data.enabled !== false}
              onCheckedChange={(v) => onUpdate({ enabled: v })}
            />
          </div>
        </div>

        <Tabs key={node.id} defaultValue="parameters" className="flex-1 flex flex-col min-h-0">
          <TabsList className="mx-4 mt-3 shrink-0 bg-gray-900/80 border border-gray-800 h-9">
            <TabsTrigger value="parameters" className="text-xs flex-1">
              Parameters
            </TabsTrigger>
            <TabsTrigger value="settings" className="text-xs flex-1">
              Settings
            </TabsTrigger>
            <TabsTrigger value="code" className="text-xs flex-1">
              <Code2 className="h-3 w-3 mr-1" /> Code
            </TabsTrigger>
            <TabsTrigger value="wires" className="text-xs flex-1">
              Wires
            </TabsTrigger>
          </TabsList>

          <TabsContent value="parameters" className="flex-1 overflow-y-auto px-4 pb-4 mt-3 space-y-3">
            <N8nNodeParameterEditor
              kind={kind}
              nodeId={node.id}
              config={config}
              onChange={(patch) => onUpdate({ config: patch })}
            />
          </TabsContent>

          <TabsContent value="settings" className="flex-1 overflow-y-auto px-4 pb-4 mt-3">
            <N8nNodeSettingsEditor
              config={config}
              onChange={(patch) => onUpdate({ config: patch })}
            />
          </TabsContent>

          <TabsContent value="code" className="flex-1 overflow-y-auto px-4 pb-4 mt-3 space-y-3">
            {impl ? (
              <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3 space-y-2">
                <p className="text-[10px] text-violet-300 font-semibold uppercase tracking-wide">
                  WEBEE runs this
                </p>
                {impl.fn && <p className="text-xs font-mono text-emerald-300">{impl.fn}()</p>}
                <p className="text-[11px] text-gray-300 leading-relaxed">{impl.description}</p>
                <code className="text-[10px] text-sky-300 break-all block">{impl.file}</code>
              </div>
            ) : null}
            {(kind === "code" || config.code || config.codeHint) && (
              <div className="space-y-1">
                <Label className="text-[10px] text-gray-500">JavaScript</Label>
                <Textarea
                  value={resolveNodeJavaScript(node.id, config)}
                  onChange={(e) =>
                    onUpdate({ config: { code: e.target.value, codeHint: undefined } })
                  }
                  spellCheck={false}
                  className="min-h-[280px] text-[11px] font-mono bg-gray-950 border-gray-700 leading-relaxed"
                />
              </div>
            )}
          </TabsContent>

          <TabsContent value="wires" className="flex-1 overflow-y-auto px-4 pb-4 mt-3 space-y-3">
            <Button
              size="sm"
              variant="outline"
              className="w-full text-xs border-gray-700"
              onClick={onFocusConnections}
            >
              <Focus className="h-3.5 w-3.5 mr-1" /> Highlight on canvas
            </Button>
            <WireList label="Incoming" edges={incoming} direction="in" onDeleteEdge={onDeleteEdge} />
            <WireList label="Outgoing" edges={outgoing} direction="out" onDeleteEdge={onDeleteEdge} />
          </TabsContent>
        </Tabs>
      </div>

      <div className="w-[26%] min-w-[240px] max-w-[380px] shrink-0 flex flex-col min-h-0">
        <N8nIoPanel
          side="output"
          data={outputData}
          emptyLabel={
            executeError
              ? `Execute failed: ${executeError}`
              : "No output yet. Execute this node or run the workflow to populate output."
          }
        />
      </div>
    </div>
  );
}

function WireList({
  label,
  edges,
  direction,
  onDeleteEdge,
}: {
  label: string;
  edges: Edge[];
  direction: "in" | "out";
  onDeleteEdge: (id: string) => void;
}) {
  return (
    <div>
      <p className="text-[10px] text-gray-500 mb-1">
        {label} ({edges.length})
      </p>
      {edges.length === 0 ? (
        <p className="text-[10px] text-gray-600">None</p>
      ) : (
        <ul className="space-y-1">
          {edges.map((e) => (
            <li
              key={e.id}
              className="flex items-center justify-between gap-1 text-[10px] font-mono text-gray-400 bg-gray-900 rounded px-2 py-1.5"
            >
              <span className="truncate">
                {direction === "in" ? "←" : "→"}{" "}
                {direction === "in" ? e.source : e.target}
                {e.sourceHandle ? ` [${e.sourceHandle}]` : ""}
              </span>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 shrink-0 text-red-400 hover:text-red-300"
                onClick={() => onDeleteEdge(e.id)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
