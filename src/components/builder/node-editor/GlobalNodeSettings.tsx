/** Node editor — global node settings and conditions. */
import { useBuilderStore } from "@/lib/builder/store";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2 } from "lucide-react";
import { isWebeeNativeMode, resolveDeploymentMode } from "@/lib/runtime/adapter";
import { WEBEE_NATIVE_LLM_MODELS, defaultModelForProvider, resolveWebeeLlmProvider } from "@/lib/voice/webee-native.shared";

export type Override = {
  key: string;
  label: string;
  description?: string;
  defaultValue: number | string | boolean;
  control: "slider" | "select" | "switch";
  min?: number;
  max?: number;
  step?: number;
  options?: { label: string; value: string }[];
};

export const OVERRIDES: Override[] = [
  {
    key: "voice_speed",
    label: "Voice Speed",
    defaultValue: 1,
    control: "slider",
    min: 0.5,
    max: 2,
    step: 0.05,
  },
  {
    key: "responsiveness",
    label: "Response Eagerness",
    defaultValue: 1,
    control: "slider",
    min: 0,
    max: 1,
    step: 0.05,
  },
  {
    key: "interruption_sensitivity",
    label: "Interruption Sensitivity",
    defaultValue: 0.7,
    control: "slider",
    min: 0,
    max: 1,
    step: 0.05,
  },
  {
    key: "model",
    label: "LLM",
    description: "Choose a different LLM for this node",
    defaultValue: "gpt-4.1",
    control: "select",
    options: [
      { label: "GPT-4.1", value: "gpt-4.1" },
      { label: "GPT-4.1 mini", value: "gpt-4.1-mini" },
      { label: "GPT-4.1 nano", value: "gpt-4.1-nano" },
      { label: "GPT-5", value: "gpt-5" },
      { label: "GPT-5 mini", value: "gpt-5-mini" },
      { label: "Claude 4.6 Sonnet", value: "claude-4.6-sonnet" },
      { label: "Claude 4.5 Haiku", value: "claude-4.5-haiku" },
      { label: "Gemini 2.5 Flash", value: "gemini-2.5-flash" },
      { label: "Gemini 3.0 Flash", value: "gemini-3.0-flash" },
    ],
  },
  {
    key: "allow_dtmf_interruption",
    label: "Allow DTMF Interruption",
    description: "Override DTMF interruption behavior for this node",
    defaultValue: true,
    control: "switch",
  },
];

/**
 * Node overrides for the engine this agent actually runs on. The LLM list used to be the Retell
 * catalogue for every agent — Claude, Gemini, GPT-5 — so a WEBEE Native agent could pick a model its
 * provider cannot serve and that node failed at runtime. Native agents now see exactly the models
 * their selected provider offers.
 */
export function useNodeOverrides(): Override[] {
  const { settings } = useBuilderStore();
  if (!isWebeeNativeMode(resolveDeploymentMode(settings))) return OVERRIDES;
  const provider = resolveWebeeLlmProvider(settings as unknown as Record<string, unknown>);
  const models = WEBEE_NATIVE_LLM_MODELS[provider] ?? [];
  return OVERRIDES.map((o) =>
    o.key === "model"
      ? {
          ...o,
          defaultValue: settings.webeeSpeechModel ?? defaultModelForProvider(provider),
          options: models.map((m) => ({ label: m.label, value: m.id })),
        }
      : o,
  );
}

export function GlobalNodeSettings({ nodeId, value }: { nodeId: string; value: Record<string, unknown> }) {
  const { updateNode, nodes } = useBuilderStore();
  const overrides = useNodeOverrides();
  const node = nodes.find((n) => n.id === nodeId);
  const isGlobal = !!node?.data.isGlobalNode;

  const setOverride = (key: string, val: unknown) => {
    const next = { ...value, [key]: val };
    updateNode(nodeId, { globalNodeSetting: next });
  };

  const toggleOverride = (o: Override, enabled: boolean) => {
    const next = { ...value };
    if (enabled) next[o.key] = o.defaultValue;
    else delete next[o.key];
    updateNode(nodeId, { globalNodeSetting: next });
  };

  return (
    <div className="rounded-md border bg-muted/30 p-4 space-y-5">
      <div className="flex items-center gap-2">
        <div className="h-4 w-4 rounded-sm border border-foreground/40" />
        <h3 className="text-sm font-semibold">Node Settings</h3>
      </div>

      {/* Global Node */}
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label className="text-sm font-medium">Global Node</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Allow other nodes jump to this node without edges
            </p>
          </div>
          <Switch
            checked={isGlobal}
            onCheckedChange={(v) => updateNode(nodeId, { isGlobalNode: v })}
          />
        </div>

        {isGlobal && (
          <GlobalNodeConditions
            value={(value.conditions as string[]) ?? []}
            onChange={(conds) => {
              const next = { ...value };
              if (conds.length === 0) {
                delete next.conditions;
                delete next.condition;
              } else {
                next.conditions = conds;
                // The export schema uses a single `condition` prompt — join multiples with OR.
                next.condition = conds.filter(Boolean).join("\nOR\n");
              }
              updateNode(nodeId, { globalNodeSetting: next });
            }}
          />
        )}
      </div>

      <div className="border-t pt-4">
        <div className="mb-3">
          <Label className="text-sm font-medium">Node-level overrides</Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Override agent defaults for this node
          </p>
        </div>

        <div className="rounded-md border bg-background divide-y">
          {overrides.map((o) => {
            const enabled = value[o.key] !== undefined;
            const current = value[o.key];
            return (
              <div key={o.key} className="p-3 space-y-2">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-sm font-medium">{o.label}</div>
                    {o.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">{o.description}</p>
                    )}
                  </div>
                  <Switch checked={enabled} onCheckedChange={(v) => toggleOverride(o, v)} />
                </div>

                {enabled && o.control === "slider" && (
                  <div className="flex items-center gap-3 pt-1">
                    <input
                      type="range"
                      min={o.min}
                      max={o.max}
                      step={o.step}
                      value={Number(current ?? o.defaultValue)}
                      onChange={(e) => setOverride(o.key, parseFloat(e.target.value))}
                      className="flex-1 accent-foreground"
                    />
                    <span className="text-xs tabular-nums w-10 text-right">
                      {Number(current ?? o.defaultValue).toFixed(2)}
                    </span>
                  </div>
                )}

                {enabled && o.control === "select" && (
                  <Select
                    value={String(current ?? o.defaultValue)}
                    onValueChange={(v) => setOverride(o.key, v)}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {o.options!.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {enabled && o.control === "switch" && (
                  <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
                    <span className="text-xs text-muted-foreground">Enabled</span>
                    <Switch
                      checked={Boolean(current ?? o.defaultValue)}
                      onCheckedChange={(v) => setOverride(o.key, v)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function GlobalNodeConditions({
  value,
  onChange,
}: {
  value: string[];
  onChange: (conds: string[]) => void;
}) {
  const update = (i: number, text: string) => {
    const next = [...value];
    next[i] = text;
    onChange(next);
  };
  const add = () => onChange([...value, ""]);
  const remove = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  return (
    <div className="rounded-md border bg-background p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-xs font-medium">Conditions</Label>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            When any condition is met, the agent can jump to this node.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={add}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add
        </Button>
      </div>

      {value.length === 0 && (
        <p className="text-[11px] text-muted-foreground italic">
          No conditions — add at least one for the global jump to trigger.
        </p>
      )}

      {value.map((c, i) => (
        <div key={i} className="flex gap-2 items-start">
          <Textarea
            rows={2}
            className="text-xs"
            placeholder="e.g. User asks to speak to a human agent"
            value={c}
            onChange={(e) => update(i, e.target.value)}
          />
          <Button
            size="icon"
            variant="ghost"
            onClick={() => remove(i)}
            aria-label="Remove condition"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
    </div>
  );
}
