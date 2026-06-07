import { useMemo } from "react";
import {
  ChevronDown,
  Megaphone,
  SlidersHorizontal,
  Brain,
  GitBranch,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBuilderStore } from "@/lib/builder/store";

const DATA_RECORD_COLUMNS = [
  { value: "name", label: "Name" },
  { value: "first_name", label: "First Name" },
  { value: "last_name", label: "Last Name" },
  { value: "email", label: "Email" },
  { value: "title", label: "Title" },
  { value: "client_name", label: "Client Name" },
  { value: "company", label: "Company (meta)" },
  { value: "industry", label: "Industry (meta)" },
  { value: "property_type", label: "Property Type" },
  { value: "city", label: "City" },
  { value: "state", label: "State" },
  { value: "postal_code", label: "Postal Code" },
  { value: "unique_id", label: "Unique ID" },
  { value: "notes", label: "Notes" },
];

const INTELLIGENCE_TOGGLES: Array<{ key: string; label: string }> = [
  { key: "trackInterestLevel", label: "Interest level" },
  { key: "trackBuyingIntent", label: "Buying intent" },
  { key: "trackLeadScore", label: "Lead score" },
  { key: "trackObjections", label: "Objections raised" },
  { key: "trackNextAction", label: "Next action" },
  { key: "trackMeetingRequested", label: "Meeting requested" },
  { key: "trackCallbackRequested", label: "Callback requested" },
  { key: "trackDecisionMaker", label: "Decision maker status" },
];

function parsePlaceholders(prompt: string): string[] {
  const matches = prompt.matchAll(/\{\{(\w+)\}\}/g);
  const seen = new Set<string>();
  for (const m of matches) seen.add(m[1]);
  return Array.from(seen);
}

export function LeadGenSection() {
  const { settings, setSettings } = useBuilderStore();
  const leadGen = settings.leadGen ?? {};

  const placeholders = useMemo(
    () => parsePlaceholders(settings.globalPrompt ?? ""),
    [settings.globalPrompt],
  );

  const variableMappings: Record<string, string> = (leadGen.variableMappings as Record<string, string>) ?? {};

  function setLeadGen(patch: Record<string, unknown>) {
    setSettings({ leadGen: { ...leadGen, ...patch } } as any);
  }

  function setMapping(placeholder: string, column: string) {
    setLeadGen({ variableMappings: { ...variableMappings, [placeholder]: column } });
  }

  function toggleIntelligence(key: string, val: boolean) {
    setLeadGen({ [key]: val });
  }

  return (
    <div className="space-y-2">
      {/* Campaign Settings */}
      <Collapsible className="rounded-lg border border-violet-500/20 bg-violet-500/5">
        <CollapsibleTrigger className="flex w-full items-center justify-between p-3 text-xs font-medium text-violet-600 dark:text-violet-400">
          <span className="flex items-center gap-1.5">
            <Megaphone className="h-3.5 w-3.5" />
            Campaign Settings
          </span>
          <ChevronDown className="h-3.5 w-3.5" />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 px-3 pb-3">
          <p className="text-[11px] text-muted-foreground">
            Name this campaign to group and track results in the Leads section.
          </p>
          <div>
            <Label className="text-xs">Campaign name</Label>
            <Input
              value={(leadGen.campaignName as string) ?? ""}
              onChange={(e) => setLeadGen({ campaignName: e.target.value })}
              placeholder="e.g. Q3 Outbound — SMB"
              className="h-7 text-xs mt-1"
            />
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Variable Mapping */}
      <Collapsible className="rounded-lg border border-violet-500/20 bg-violet-500/5">
        <CollapsibleTrigger className="flex w-full items-center justify-between p-3 text-xs font-medium text-violet-600 dark:text-violet-400">
          <span className="flex items-center gap-1.5">
            <GitBranch className="h-3.5 w-3.5" />
            Variable Mapping
          </span>
          <ChevronDown className="h-3.5 w-3.5" />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 px-3 pb-3">
          <p className="text-[11px] text-muted-foreground">
            Map <code className="rounded bg-muted px-1">{"{{placeholders}}"}</code> in your global
            prompt to CSV columns. These values are injected per-lead before each call.
          </p>
          {placeholders.length === 0 ? (
            <p className="text-[11px] text-muted-foreground italic">
              No {"{{variables}}"} found in your global prompt. Add them to enable personalisation.
            </p>
          ) : (
            <div className="space-y-1.5">
              {placeholders.map((p) => (
                <div key={p} className="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
                  <code className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-violet-600 dark:text-violet-400 truncate">
                    {`{{${p}}}`}
                  </code>
                  <span className="text-[10px] text-muted-foreground">→</span>
                  <Select
                    value={variableMappings[p] ?? ""}
                    onValueChange={(v) => setMapping(p, v)}
                  >
                    <SelectTrigger className="h-7 text-xs">
                      <SelectValue placeholder="CSV column…" />
                    </SelectTrigger>
                    <SelectContent>
                      {DATA_RECORD_COLUMNS.map((col) => (
                        <SelectItem key={col.value} value={col.value}>
                          {col.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>

      {/* Lead Intelligence */}
      <Collapsible className="rounded-lg border border-violet-500/20 bg-violet-500/5">
        <CollapsibleTrigger className="flex w-full items-center justify-between p-3 text-xs font-medium text-violet-600 dark:text-violet-400">
          <span className="flex items-center gap-1.5">
            <Brain className="h-3.5 w-3.5" />
            Lead Intelligence
          </span>
          <ChevronDown className="h-3.5 w-3.5" />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-1.5 px-3 pb-3">
          <p className="text-[11px] text-muted-foreground">
            After each call, AI analyses the transcript and updates the lead record with:
          </p>
          {INTELLIGENCE_TOGGLES.map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between">
              <Label className="text-xs">{label}</Label>
              <Switch
                checked={(leadGen[key] as boolean) !== false}
                onCheckedChange={(v) => toggleIntelligence(key, v)}
              />
            </div>
          ))}
        </CollapsibleContent>
      </Collapsible>

      {/* Lead Tracking */}
      <Collapsible className="rounded-lg border border-violet-500/20 bg-violet-500/5">
        <CollapsibleTrigger className="flex w-full items-center justify-between p-3 text-xs font-medium text-violet-600 dark:text-violet-400">
          <span className="flex items-center gap-1.5">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Lead Tracking
          </span>
          <ChevronDown className="h-3.5 w-3.5" />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-1.5 px-3 pb-3">
          <p className="text-[11px] text-muted-foreground">
            Every completed call automatically updates the matching lead record in the Leads section.
          </p>
          <div className="flex items-center justify-between">
            <Label className="text-xs">Auto-update lead on call end</Label>
            <Switch
              checked={(leadGen.autoUpdateLead as boolean) !== false}
              onCheckedChange={(v) => setLeadGen({ autoUpdateLead: v })}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-xs">Write to campaign metrics</Label>
            <Switch
              checked={(leadGen.writeCampaignMetrics as boolean) !== false}
              onCheckedChange={(v) => setLeadGen({ writeCampaignMetrics: v })}
            />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
