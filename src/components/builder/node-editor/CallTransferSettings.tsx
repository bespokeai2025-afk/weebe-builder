/** Node editor — call transfer settings and destination agent picker. */
import { useBuilderStore } from "@/lib/builder/store";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listMyAgents } from "@/lib/agents/agents.functions";

export function CallTransferSettings({ nodeId }: { nodeId: string }) {
  const { nodes, updateNode } = useBuilderStore();
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const d = node.data;

  const mode = d.transferMode ?? "static";
  const transferType = d.transferType ?? "cold_transfer";
  const sipMethod = d.sipTransferMethod ?? "sip_invite";
  const callerId = d.callerIdMode ?? "agent";
  const ringSec = d.transferRingDurationSec ?? 30;
  const headers = d.customSipHeaders ?? {};
  const headerEntries = Object.entries(headers);

  const setHeader = (oldKey: string, newKey: string, value: string) => {
    const next: Record<string, string> = {};
    headerEntries.forEach(([k, v]) => {
      if (k === oldKey) {
        if (newKey.trim()) next[newKey] = value;
      } else {
        next[k] = v as string;
      }
    });
    updateNode(nodeId, { customSipHeaders: next });
  };
  const addHeader = () => updateNode(nodeId, { customSipHeaders: { ...headers, "": "" } });
  const removeHeader = (k: string) => {
    const next = { ...headers };
    delete next[k];
    updateNode(nodeId, { customSipHeaders: next });
  };

  return (
    <div className="rounded-md border bg-muted/30 p-4 space-y-5">
      <h3 className="text-sm font-semibold">Transfer Call Settings</h3>

      <div className="space-y-2">
        <Label className="text-sm">Transfer to</Label>
        <div className="inline-flex rounded-md border bg-background p-0.5">
          <button
            type="button"
            onClick={() => updateNode(nodeId, { transferMode: "static" })}
            className={`px-3 py-1 text-xs rounded ${mode === "static" ? "bg-foreground text-background" : "text-muted-foreground"}`}
          >
            Static Destination
          </button>
          <button
            type="button"
            onClick={() => updateNode(nodeId, { transferMode: "dynamic" })}
            className={`px-3 py-1 text-xs rounded ${mode === "dynamic" ? "bg-foreground text-background" : "text-muted-foreground"}`}
          >
            Dynamic Routing
          </button>
        </div>

        {mode === "static" ? (
          <>
            <Input
              value={d.transferNumber ?? ""}
              onChange={(e) => updateNode(nodeId, { transferNumber: e.target.value })}
              placeholder="+18563630633 or sip:user@host"
            />
            <p className="text-[11px] text-muted-foreground">
              Enter a static phone number, SIP URI, or dynamic variable.
            </p>
            <div className="flex items-center gap-4 flex-wrap">
              <label className="flex items-center gap-2 text-xs">
                <Switch
                  checked={!!d.ignoreE164Validation}
                  onCheckedChange={(v) => updateNode(nodeId, { ignoreE164Validation: v })}
                />
                Ignore E.164 validation
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={d.transferExtensionNumber !== undefined}
                  onChange={(e) =>
                    updateNode(nodeId, {
                      transferExtensionNumber: e.target.checked
                        ? (d.transferExtensionNumber ?? "")
                        : undefined,
                    })
                  }
                />
                Extension Number
              </label>
            </div>
            {d.transferExtensionNumber !== undefined && (
              <Input
                value={d.transferExtensionNumber ?? ""}
                onChange={(e) => updateNode(nodeId, { transferExtensionNumber: e.target.value })}
                placeholder="Extension digits (e.g. 1234)"
              />
            )}
          </>
        ) : (
          <>
            <Input
              value={d.transferDynamicVariable ?? ""}
              onChange={(e) =>
                updateNode(nodeId, { transferDynamicVariable: e.target.value.replace(/[{}]/g, "") })
              }
              placeholder="variable_name"
            />
            <p className="text-[11px] text-muted-foreground">
              Number/SIP URI is read at runtime from{" "}
              <code>{`{{${d.transferDynamicVariable || "variable_name"}}}`}</code>.
            </p>
          </>
        )}
      </div>

      <div className="space-y-2">
        <Label className="text-sm">How should the AI handle the transfer?</Label>
        <div className="space-y-2">
          {[
            { v: "cold_transfer", t: "Cold Transfer", desc: "AI transfers immediately" },
            {
              v: "warm_transfer",
              t: "Warm Transfer",
              desc: "AI gives a one-way brief to the agent",
            },
            {
              v: "agentic_warm_transfer",
              t: "Agentic Warm Transfer",
              desc: "AI has a 2-way conversation with agent, then bridges",
            },
          ].map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() =>
                updateNode(nodeId, {
                  transferType: o.v as "cold_transfer" | "warm_transfer" | "agentic_warm_transfer",
                })
              }
              className={`w-full text-left rounded-md border bg-background px-3 py-2 flex items-center justify-between ${transferType === o.v ? "ring-2 ring-foreground" : ""}`}
            >
              <div>
                <div className="text-sm font-medium">{o.t}</div>
                <div className="text-[11px] text-muted-foreground">{o.desc}</div>
              </div>
              <div
                className={`h-3 w-3 rounded-full border ${transferType === o.v ? "bg-foreground border-foreground" : ""}`}
              />
            </button>
          ))}
        </div>
        {(transferType === "warm_transfer" || transferType === "agentic_warm_transfer") && (
          <div className="space-y-2">
            <Textarea
              rows={3}
              placeholder="Prompt the AI uses for the three-way handoff message…"
              value={d.warmHandoffPrompt ?? ""}
              onChange={(e) => updateNode(nodeId, { warmHandoffPrompt: e.target.value })}
            />
            {transferType === "agentic_warm_transfer" && (
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={d.transferAgentId ?? ""}
                  onChange={(e) => updateNode(nodeId, { transferAgentId: e.target.value })}
                  placeholder="Transfer agent ID"
                />
                <Input
                  value={d.transferAgentVersion ?? "latest"}
                  onChange={(e) => updateNode(nodeId, { transferAgentVersion: e.target.value })}
                  placeholder="latest"
                />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label className="text-sm">SIP Transfer Method</Label>
        <div className="inline-flex rounded-md border bg-background p-0.5">
          {[
            { v: "sip_invite", t: "SIP INVITE" },
            { v: "sip_refer", t: "SIP REFER" },
          ].map((o) => (
            <button
              key={o.v}
              type="button"
              onClick={() =>
                updateNode(nodeId, { sipTransferMethod: o.v as "sip_invite" | "sip_refer" })
              }
              className={`px-3 py-1 text-xs rounded ${sipMethod === o.v ? "bg-foreground text-background" : "text-muted-foreground"}`}
            >
              {o.t}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-sm">Displayed Caller ID</Label>
        {[
          { v: "agent", t: "Agent's Number" },
          { v: "user", t: "User's Number" },
        ].map((o) => (
          <button
            key={o.v}
            type="button"
            onClick={() => updateNode(nodeId, { callerIdMode: o.v as "agent" | "user" })}
            className={`w-full text-left rounded-md border bg-background px-3 py-2 flex items-center justify-between ${callerId === o.v ? "ring-2 ring-foreground" : ""}`}
          >
            <span className="text-sm">{o.t}</span>
            <div
              className={`h-3 w-3 rounded-full border ${callerId === o.v ? "bg-foreground border-foreground" : ""}`}
            />
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <Label className="text-sm">Transfer Ring Duration</Label>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={5}
            max={90}
            step={1}
            value={ringSec}
            onChange={(e) =>
              updateNode(nodeId, { transferRingDurationSec: parseInt(e.target.value) })
            }
            className="flex-1 accent-foreground"
          />
          <span className="text-xs tabular-nums w-10 text-right">{ringSec}s</span>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm">Custom SIP Headers</Label>
            <p className="text-[11px] text-muted-foreground">
              Key/value pairs for call routing, metadata, or carrier integration.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={addHeader}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add
          </Button>
        </div>
        {headerEntries.length === 0 && (
          <p className="text-[11px] text-muted-foreground italic">No custom headers.</p>
        )}
        {headerEntries.map(([k, v], i) => (
          <div key={`${i}-${k}`} className="flex gap-2">
            <Input
              className="flex-1"
              placeholder="X-Header-Name"
              defaultValue={k}
              onBlur={(e) => setHeader(k, e.target.value, v as string)}
            />
            <Input
              className="flex-1"
              placeholder="value"
              value={v as string}
              onChange={(e) => setHeader(k, k, e.target.value)}
            />
            <Button size="icon" variant="ghost" onClick={() => removeHeader(k)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DestinationAgentPicker({
  value,
  currentRetellAgentId,
  onChange,
}: {
  value: string;
  currentRetellAgentId?: string;
  onChange: (v: string) => void;
}) {
  const fetchAgents = useServerFn(listMyAgents);
  const { data: agents, isLoading } = useQuery({
    queryKey: ["workspace-agents"],
    queryFn: () => fetchAgents({}),
    throwOnError: false,
  });

  const deployed = (agents ?? []).filter(
    (a) => a.retell_agent_id && a.retell_agent_id !== currentRetellAgentId,
  );

  // If the saved value isn't in the list (custom ID), keep it selectable.
  const valueIsCustom = !!value && !deployed.some((a) => a.retell_agent_id === value);

  return (
    <div>
      <Label>Destination agent</Label>
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue placeholder={isLoading ? "Loading agents…" : "Select an agent"} />
        </SelectTrigger>
        <SelectContent>
          {deployed.length === 0 && !valueIsCustom && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              No other deployed agents in this workspace. Deploy another agent first.
            </div>
          )}
          {deployed.map((a) => (
            <SelectItem key={a.id} value={a.retell_agent_id as string}>
              {a.name}
              <span className="ml-2 text-xs text-muted-foreground">{a.retell_agent_id}</span>
            </SelectItem>
          ))}
          {valueIsCustom && <SelectItem value={value}>{value} (manual)</SelectItem>}
        </SelectContent>
      </Select>
      <div className="mt-2 flex items-center gap-2">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Or paste an agent ID (agent_xxx)"
          className="text-xs"
        />
      </div>
      <p className="text-xs text-muted-foreground mt-1">
        Seamless transition — full call context preserved, appears as a single call.
      </p>
    </div>
  );
}
