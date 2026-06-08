import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ChevronDown,
  ShieldCheck,
  GitBranch,
  SlidersHorizontal,
  Zap,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBuilderStore } from "@/lib/builder/store";
import type { FlowNode } from "@/lib/builder/store";
import { getLeadCustomFields } from "@/lib/dashboard/leads.functions";
import {
  PostCallVariableMappingSection,
  PreCallLeadMappingSection,
} from "./PostCallVariableMappingSection";

const QUALIFICATION_CRITERIA = [
  { key: "trackBudget", label: "Budget confirmed", points: 25 },
  { key: "trackDecisionMaker", label: "Decision maker", points: 25 },
  { key: "trackUrgency", label: "Urgency / need", points: 20 },
  { key: "trackInterestLevel", label: "Interest level", points: 20 },
  { key: "trackFollowUp", label: "Follow-up requested", points: 10 },
  { key: "trackBusinessSize", label: "Business size", points: 0 },
  { key: "trackLocation", label: "Location match", points: 0 },
  { key: "trackCurrentProvider", label: "Current provider", points: 0 },
];

const OUTCOME_OPTIONS = [
  { value: "qualified", label: "Qualified" },
  { value: "partially_qualified", label: "Partially Qualified" },
  { value: "not_qualified", label: "Not Qualified" },
  { value: "callback_required", label: "Callback Required" },
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

const TRIGGER = "group flex w-full min-h-[40px] items-center justify-between px-2.5 py-0 text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:brightness-110 transition-colors";
const CONTENT = "space-y-1.5 px-2.5 pb-2.5";

export function ClientQualificationSection() {
  const { settings, setSettings, nodes } = useBuilderStore();
  const qualify = settings.qualify ?? {};

  const placeholders = useMemo(
    () => parsePlaceholdersFromAll(settings.globalPrompt ?? "", nodes),
    [settings.globalPrompt, nodes],
  );

  const preCallMappings: Record<string, string> =
    (qualify.preCallMappings as Record<string, string>) ?? {};
  const postCallMappings: Record<string, string> =
    (qualify.postCallMappings as Record<string, string>) ?? {};
  const customScoringRules: Array<{ variable: string; points: number }> =
    (qualify.customScoringRules as Array<{ variable: string; points: number }>) ?? [];
  const customLeadFields: string[] =
    (qualify.customLeadFields as string[]) ?? [];

  const getLeadFieldsFn = useServerFn(getLeadCustomFields);
  const leadFieldsQ = useQuery({
    queryKey: ["lead-custom-fields"],
    queryFn: () => getLeadFieldsFn(),
    staleTime: 60_000,
  });

  const standardFields = (leadFieldsQ.data?.standardFields ?? []).map((f) => ({
    ...f,
    group: "standard" as const,
  }));
  const metaFields = (leadFieldsQ.data?.metaFields ?? []).map((f) => ({
    ...f,
    group: "meta" as const,
  }));
  const allSourceFields = [...standardFields, ...metaFields];

  function setQualify(patch: Partial<NonNullable<typeof settings.qualify>>) {
    setSettings({ qualify: { ...qualify, ...patch } });
  }

  function toggleCriteria(key: keyof NonNullable<typeof settings.qualify>, val: boolean) {
    setQualify({ [key]: val });
  }

  return (
    <div className="space-y-1.5">
      {/* Lead Source */}
      <Collapsible defaultOpen className="rounded-lg border border-blue-500/20 bg-blue-500/5">
        <CollapsibleTrigger className={TRIGGER}>
          <span className="flex items-center gap-1.5">
            <GitBranch className="h-3 w-3" />
            Lead Source
          </span>
          <ChevronDown className="h-3 w-3 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className={CONTENT}>
          <p className="text-[10px] text-muted-foreground">
            Where the agent pulls contacts for qualification calls.
          </p>
          <div>
            <Label className="text-[9px]">Source</Label>
            <Select
              value={qualify.leadSource ?? "data_section"}
              onValueChange={(v) => setQualify({ leadSource: v as "data_section" | "leads_section" })}
            >
              <SelectTrigger className="h-6 text-[10px] mt-0.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="data_section" className="text-xs">
                  Data Section (CSV uploads)
                </SelectItem>
                <SelectItem value="leads_section" className="text-xs">
                  Leads Section (existing leads)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          {(qualify.leadSource as string) === "leads_section" && (
            <div className="rounded border border-blue-500/20 bg-blue-500/5 p-1.5 text-[10px] text-blue-600 dark:text-blue-400">
              Leads page → select leads → Actions → Assign Qualification Agent.
            </div>
          )}
        </CollapsibleContent>
      </Collapsible>

      {/* Pre-Call Data Injection */}
      {(qualify.leadSource === "leads_section" || qualify.leadSource == null) && (
        <PreCallLeadMappingSection
          accentClass="text-blue-600 dark:text-blue-400"
          placeholders={placeholders}
          preCallMappings={preCallMappings}
          onMappingChange={(m) => setQualify({ preCallMappings: m })}
          sourceFields={allSourceFields.length > 0 ? allSourceFields : undefined}
          customLeadFields={customLeadFields}
          onCustomLeadFieldsChange={(fields) => setQualify({ customLeadFields: fields } as any)}
        />
      )}

      {/* Qualification Criteria */}
      <Collapsible className="rounded-lg border border-blue-500/20 bg-blue-500/5">
        <CollapsibleTrigger className={TRIGGER}>
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="h-3 w-3" />
            Qualification Criteria
          </span>
          <ChevronDown className="h-3 w-3 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className={CONTENT}>
          <p className="text-[10px] text-muted-foreground">
            Signals AI should detect after each call to build the qualification score.
          </p>
          {QUALIFICATION_CRITERIA.map(({ key, label, points }) => (
            <div key={key} className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                <Label className="text-[10px]">{label}</Label>
                {points > 0 && (
                  <span className="rounded bg-blue-500/10 px-1 py-0.5 text-[9px] text-blue-500">
                    +{points}
                  </span>
                )}
              </div>
              <Switch
                checked={(qualify[key as keyof typeof qualify] as boolean) !== false}
                onCheckedChange={(v) => toggleCriteria(key as keyof NonNullable<typeof settings.qualify>, v)}
              />
            </div>
          ))}
        </CollapsibleContent>
      </Collapsible>

      {/* Post-Call Variable Mapping */}
      <PostCallVariableMappingSection
        mode="qualify"
        accentClass="text-blue-600 dark:text-blue-400"
        postCallMappings={postCallMappings}
        customScoringRules={customScoringRules}
        onMappingChange={(m) => setQualify({ postCallMappings: m })}
        onScoringChange={(r) => setQualify({ customScoringRules: r })}
      />

      {/* Qualification Scoring */}
      <Collapsible className="rounded-lg border border-blue-500/20 bg-blue-500/5">
        <CollapsibleTrigger className={TRIGGER}>
          <span className="flex items-center gap-1.5">
            <SlidersHorizontal className="h-3 w-3" />
            Qualification Scoring
          </span>
          <ChevronDown className="h-3 w-3 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className={CONTENT}>
          <p className="text-[10px] text-muted-foreground">
            Scores calculated automatically from enabled criteria.
            {customScoringRules.length > 0 && (
              <> Custom variables add up to <span className="font-medium text-foreground">+{customScoringRules.reduce((a, r) => a + r.points, 0)} pts</span>.</>
            )}
          </p>
          <div className="space-y-0.5">
            {[
              { range: "70 – 100", label: "Qualified", color: "text-emerald-400" },
              { range: "40 – 69", label: "Partially Qualified", color: "text-amber-400" },
              { range: "0 – 39", label: "Not Qualified", color: "text-red-400" },
            ].map(({ range, label, color }) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">{range}</span>
                <span className={`text-[10px] font-medium ${color}`}>{label}</span>
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Outcome Routing */}
      <Collapsible className="rounded-lg border border-blue-500/20 bg-blue-500/5">
        <CollapsibleTrigger className={TRIGGER}>
          <span className="flex items-center gap-1.5">
            <Zap className="h-3 w-3" />
            Outcome Routing
          </span>
          <ChevronDown className="h-3 w-3 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className={CONTENT}>
          <p className="text-[10px] text-muted-foreground">
            Where leads go in the Leads section based on call sentiment.
          </p>
          {(["positive", "neutral", "negative"] as const).map((sentiment) => {
            const defaultVal = sentiment === "negative" ? "not_qualified" : "qualified";
            const key = `route_${sentiment}` as keyof NonNullable<typeof settings.qualify>;
            return (
              <div key={sentiment} className="flex items-center justify-between gap-2">
                <Label className="text-[10px] capitalize">{sentiment}</Label>
                <Select
                  value={(qualify[key] as string) ?? defaultVal}
                  onValueChange={(v) => setQualify({ [key]: v })}
                >
                  <SelectTrigger className="h-6 w-32 text-[10px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OUTCOME_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value} className="text-xs">
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          })}
          <div className="flex items-center justify-between pt-1 border-t border-border/40">
            <Label className="text-[10px]">Auto-route after call</Label>
            <Switch
              checked={(qualify.autoRoute as boolean) !== false}
              onCheckedChange={(v) => setQualify({ autoRoute: v })}
            />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
