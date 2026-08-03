/**
 * n8n node Settings tab — on error, retry, notes, etc.
 */
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_N8N_NODE_SETTINGS,
  type N8nNodeSettings,
  type WbahN8nNodeConfig,
} from "@/lib/wbah/workflow/wbah-n8n-node-presets.shared";

const ON_ERROR_OPTIONS = [
  { value: "continueErrorOutput", label: "Continue (using error output)" },
  { value: "continueRegularOutput", label: "Continue (regular output)" },
  { value: "stopWorkflow", label: "Stop Workflow" },
] as const;

export function N8nNodeSettingsEditor({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (patch: Partial<WbahN8nNodeConfig>) => void;
}) {
  const settings: N8nNodeSettings = {
    ...DEFAULT_N8N_NODE_SETTINGS,
    ...((config.settings ?? {}) as N8nNodeSettings),
  };

  const patchSettings = (patch: Partial<N8nNodeSettings>) => {
    onChange({ settings: { ...settings, ...patch } });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3 space-y-3">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Error handling</p>
        <div className="space-y-1">
          <Label className="text-[10px] text-gray-500">On Error</Label>
          <Select
            value={settings.onError ?? "continueErrorOutput"}
            onValueChange={(v) =>
              patchSettings({ onError: v as N8nNodeSettings["onError"] })
            }
          >
            <SelectTrigger className="h-8 text-xs bg-gray-900 border-gray-700">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ON_ERROR_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value} className="text-xs">
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[9px] text-gray-600">
            When enabled, error output appears as a second branch on HTTP and Code nodes (like n8n).
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3 space-y-3">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Retry</p>
        <div className="flex items-center justify-between">
          <Label className="text-xs text-gray-400">Retry On Fail</Label>
          <Switch
            checked={!!settings.retryOnFail}
            onCheckedChange={(v) => patchSettings({ retryOnFail: v })}
          />
        </div>
        {settings.retryOnFail && (
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[10px] text-gray-500">Max Tries</Label>
              <Input
                type="number"
                min={1}
                max={10}
                value={settings.maxTries ?? 3}
                onChange={(e) => patchSettings({ maxTries: Number(e.target.value) || 3 })}
                className="h-8 text-xs bg-gray-900 border-gray-700"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-gray-500">Wait (ms)</Label>
              <Input
                type="number"
                min={0}
                value={settings.waitBetweenTries ?? 1000}
                onChange={(e) =>
                  patchSettings({ waitBetweenTries: Number(e.target.value) || 0 })
                }
                className="h-8 text-xs bg-gray-900 border-gray-700"
              />
            </div>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3 space-y-3">
        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Execution</p>
        <div className="flex items-center justify-between">
          <Label className="text-xs text-gray-400">Always Output Data</Label>
          <Switch
            checked={!!settings.alwaysOutputData}
            onCheckedChange={(v) => patchSettings({ alwaysOutputData: v })}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label className="text-xs text-gray-400">Execute Once</Label>
          <Switch
            checked={!!settings.executeOnce}
            onCheckedChange={(v) => patchSettings({ executeOnce: v })}
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-[10px] text-gray-500">Notes</Label>
        <Textarea
          value={settings.notes ?? ""}
          onChange={(e) => patchSettings({ notes: e.target.value })}
          placeholder="Node notes (visible in n8n settings)…"
          className="min-h-[72px] text-[11px] bg-gray-900 border-gray-700"
        />
      </div>
    </div>
  );
}
