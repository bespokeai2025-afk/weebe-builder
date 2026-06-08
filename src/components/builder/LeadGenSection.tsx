import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ChevronDown,
  Megaphone,
  SlidersHorizontal,
  Brain,
  GitBranch,
  Loader2,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBuilderStore } from "@/lib/builder/store";
import type { FlowNode } from "@/lib/builder/store";
import { getDataRecordSchema } from "@/lib/dashboard/data-records.functions";
import { PostCallVariableMappingSection } from "./PostCallVariableMappingSection";

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

function extractPlaceholders(text: string, seen: Set<string>) {
  for (const m of text.matchAll(/\{\{(\w+)\}\}/g)) seen.add(m[1]);
}

function parsePlaceholdersFromAll(globalPrompt: string, nodes: FlowNode[]): string[] {
  const seen = new Set<string>();
  extractPlaceholders(globalPrompt ?? "", seen);
  for (const node of nodes) {
    const d = node.data;
    if (d?.dialogue) extractPlaceholders(String(d.dialogue), seen);
    if (Array.isArray(d?.edges)) {
      for (const edge of d.edges as Array<{ condition?: string }>) {
        if (edge?.condition) extractPlaceholders(edge.condition, seen);
      }
    }
  }
  return Array.from(seen);
}

const TRIGGER = "group flex w-full min-h-[40px] items-center justify-between px-2.5 py-0 text-[11px] font-medium text-violet-600 dark:text-violet-400 hover:brightness-110 transition-colors";
const CONTENT = "space-y-1.5 px-2.5 pb-2.5";

export function LeadGenSection() {
  const { settings, setSettings, nodes } = useBuilderStore();
  const leadGen = settings.leadGen ?? {};

  const placeholders = useMemo(
    () => parsePlaceholdersFromAll(settings.globalPrompt ?? "", nodes),
    [settings.globalPrompt, nodes],
  );

  const variableMappings: Record<string, string> =
    (leadGen.variableMappings as Record<string, string>) ?? {};
  const postCallMappings: Record<string, string> =
    (leadGen.postCallMappings as Record<string, string>) ?? {};
  const customScoringRules: Array<{ variable: string; points: number }> =
    (leadGen.customScoringRules as Array<{ variable: string; points: number }>) ?? [];

  const currentAgentRowId = useBuilderStore((s) => s.currentAgentRowId);

  const getSchemFn = useServerFn(getDataRecordSchema);
  const schemaQ = useQuery({
    queryKey: ["data-record-schema", currentAgentRowId],
    queryFn: () => getSchemFn({ data: { agentRowId: currentAgentRowId ?? null } }),
    staleTime: 0,
  });
  const schema = schemaQ.data;
  const fixedCols = schema?.fixed ?? [];
  const metaCols = schema?.meta ?? [];
  const hasSchema = fixedCols.length > 0 || metaCols.length > 0;

  function setLeadGen(patch: Record<string, unknown>) {
    setSettings({ leadGen: { ...leadGen, ...patch } } as any);
  }

  function setMapping(placeholder: string, column: string) {
    setLeadGen({ variableMappings: { ...variableMappings, [placeholder]: column } });
  }

  function toggleIntelligence(key: string, val: boolean) {
    setLeadGen({ [key]: val });
  }

  function colLabel(ref: string): string {
    if (ref.startsWith("meta.")) return ref.slice(5);
    return fixedCols.find((c) => c.value === ref)?.label ?? ref;
  }

  return (
    <div className="space-y-1.5">
      {/* Campaign Settings */}
      <Collapsible className="rounded-lg border border-violet-500/20 bg-violet-500/5">
        <CollapsibleTrigger className={TRIGGER}>
          <span className="flex items-center gap-1.5">
            <Megaphone className="h-3 w-3" />
            Campaign Settings
          </span>
          <ChevronDown className="h-3 w-3 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className={CONTENT}>
          <p className="text-[10px] text-muted-foreground">
            Name this campaign to group and track results in the Leads section.
          </p>
          <div>
            <Label className="text-[9px]">Campaign name</Label>
            <Input
              value={(leadGen.campaignName as string) ?? ""}
              onChange={(e) => setLeadGen({ campaignName: e.target.value })}
              placeholder="e.g. Q3 Outbound — SMB"
              className="h-6 text-[10px] mt-0.5"
            />
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Pre-Call Variable Mapping */}
      <Collapsible className="rounded-lg border border-violet-500/20 bg-violet-500/5">
        <CollapsibleTrigger className={TRIGGER}>
          <span className="flex items-center gap-1.5">
            <GitBranch className="h-3 w-3" />
            Pre-Call Variable Mapping
          </span>
          <ChevronDown className="h-3 w-3 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className={CONTENT}>
          <p className="text-[10px] text-muted-foreground">
            Map{" "}
            <code className="rounded bg-muted px-1">{"{{placeholders}}"}</code> in your script
            nodes to columns from your uploaded CSV.
          </p>

          {schemaQ.isLoading ? (
            <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading CSV columns…
            </p>
          ) : schema && schema.totalRecords > 0 ? (
            <p className="text-[10px] text-emerald-500">
              ✓ {schema.totalRecords} record{schema.totalRecords !== 1 ? "s" : ""} found
              {currentAgentRowId ? " (assigned to this agent)" : " (workspace)"}
              {metaCols.length > 0 ? ` · ${metaCols.length} custom column${metaCols.length !== 1 ? "s" : ""}` : ""}
            </p>
          ) : schema && schema.totalRecords === 0 ? (
            <div className="flex flex-col gap-1.5 rounded border border-amber-500/30 bg-amber-500/10 p-2">
              <div className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
                <div className="space-y-0.5">
                  <p className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                    No CSV data uploaded yet
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    Upload a CSV in the Data section and assign it to this agent.
                  </p>
                </div>
              </div>
              <Link
                to="/data"
                className="flex w-fit items-center gap-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 hover:bg-amber-500/30 dark:text-amber-400"
              >
                <ExternalLink className="h-2.5 w-2.5" />
                Go to Data &amp; upload CSV
              </Link>
            </div>
          ) : null}

          {placeholders.length === 0 ? (
            <p className="text-[10px] text-muted-foreground italic">
              No {"{{variables}}"} in your script yet.
            </p>
          ) : (
            <div className="space-y-1">
              {placeholders.map((p) => (
                <div key={p} className="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
                  <code className="rounded bg-muted px-1 py-0.5 text-[10px] text-violet-600 dark:text-violet-400 truncate">
                    {`{{${p}}}`}
                  </code>
                  <span className="text-[9px] text-muted-foreground">→</span>
                  <Select
                    value={variableMappings[p] ?? ""}
                    onValueChange={(v) => setMapping(p, v)}
                  >
                    <SelectTrigger className="h-6 text-[10px]">
                      <SelectValue placeholder="CSV column…">
                        {variableMappings[p] ? colLabel(variableMappings[p]) : undefined}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {hasSchema ? (
                        <>
                          {fixedCols.length > 0 && (
                            <SelectGroup>
                              <SelectLabel className="text-[9px]">CSV Fields</SelectLabel>
                              {fixedCols.map((col) => (
                                <SelectItem key={col.value} value={col.value} className="text-xs">
                                  {col.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          )}
                          {metaCols.length > 0 && (
                            <SelectGroup>
                              <SelectLabel className="text-[9px]">Custom Columns</SelectLabel>
                              {metaCols.map((col) => (
                                <SelectItem key={col.value} value={col.value} className="text-xs">
                                  {col.label}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          )}
                        </>
                      ) : (
                        <SelectGroup>
                          <SelectLabel className="text-[9px]">Standard Fields</SelectLabel>
                          {[
                            { value: "name", label: "Full Name" },
                            { value: "first_name", label: "First Name" },
                            { value: "last_name", label: "Last Name" },
                            { value: "mobile_number", label: "Mobile Number" },
                            { value: "email", label: "Email" },
                            { value: "title", label: "Title" },
                            { value: "client_name", label: "Client Name" },
                            { value: "property_type", label: "Property Type" },
                            { value: "city", label: "City" },
                            { value: "state", label: "State" },
                            { value: "postal_code", label: "Postal Code" },
                            { value: "notes", label: "Notes" },
                          ].map((col) => (
                            <SelectItem key={col.value} value={col.value} className="text-xs">
                              {col.label}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      )}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>

      {/* Post-Call Variable Mapping */}
      <PostCallVariableMappingSection
        mode="leadgen"
        accentClass="text-violet-600 dark:text-violet-400"
        postCallMappings={postCallMappings}
        customScoringRules={customScoringRules}
        onMappingChange={(m) => setLeadGen({ postCallMappings: m })}
        onScoringChange={(r) => setLeadGen({ customScoringRules: r })}
      />

      {/* Lead Intelligence */}
      <Collapsible className="rounded-lg border border-violet-500/20 bg-violet-500/5">
        <CollapsibleTrigger className={TRIGGER}>
          <span className="flex items-center gap-1.5">
            <Brain className="h-3 w-3" />
            Lead Intelligence
          </span>
          <ChevronDown className="h-3 w-3 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className={CONTENT}>
          <p className="text-[10px] text-muted-foreground">
            AI analyses each transcript and updates the lead record with:
          </p>
          {INTELLIGENCE_TOGGLES.map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between">
              <Label className="text-[10px]">{label}</Label>
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
        <CollapsibleTrigger className={TRIGGER}>
          <span className="flex items-center gap-1.5">
            <SlidersHorizontal className="h-3 w-3" />
            Lead Tracking
          </span>
          <ChevronDown className="h-3 w-3 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className={CONTENT}>
          <p className="text-[10px] text-muted-foreground">
            Completed calls automatically update the matching lead record.
          </p>
          <div className="flex items-center justify-between">
            <Label className="text-[10px]">Auto-update lead on call end</Label>
            <Switch
              checked={(leadGen.autoUpdateLead as boolean) !== false}
              onCheckedChange={(v) => setLeadGen({ autoUpdateLead: v })}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-[10px]">Write to campaign metrics</Label>
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
