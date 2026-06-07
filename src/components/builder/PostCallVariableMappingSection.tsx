/**
 * PostCallVariableMappingSection
 *
 * Shared collapsible used in both LeadGenSection and ClientQualificationSection.
 * Reads the custom variables defined in "Post Call Data Retrieval" (store.variables)
 * and lets the builder map each one to a lead field.
 *
 * For qualification agents it also exposes a "Score contribution" input so
 * boolean/truthy values add points to the qualification score.
 */
import { ChevronDown, ArrowRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBuilderStore } from "@/lib/builder/store";

// Lead fields available as mapping targets for post-call variables
export const LEAD_FIELD_OPTIONS: Array<{ value: string; label: string; group: string }> = [
  // Core intelligence fields
  { value: "call_summary", label: "Call Summary", group: "Core" },
  { value: "next_action", label: "Next Action", group: "Core" },
  { value: "objections", label: "Objections", group: "Core" },
  // Scoring / interest
  { value: "lead_score", label: "Lead Score (number)", group: "Scoring" },
  { value: "interest_level", label: "Interest Level", group: "Scoring" },
  { value: "buying_intent", label: "Buying Intent", group: "Scoring" },
  // Qualification
  { value: "qualification_status", label: "Qualification Status", group: "Qualification" },
  { value: "qualification_score", label: "Qualification Score (number)", group: "Qualification" },
  { value: "budget_confirmed", label: "Budget Confirmed (boolean)", group: "Qualification" },
  { value: "decision_maker", label: "Decision Maker (boolean)", group: "Qualification" },
  { value: "urgency", label: "Urgency", group: "Qualification" },
  { value: "next_step", label: "Next Step", group: "Qualification" },
  // Booleans
  { value: "meeting_requested", label: "Meeting Requested (boolean)", group: "Flags" },
  { value: "callback_requested", label: "Callback Requested (boolean)", group: "Flags" },
  // Custom meta — stored as meta.{variableName}
  { value: "__meta__", label: "Store in lead meta (custom)", group: "Custom" },
];

// Lead fields to inject BEFORE a call (pre-call from leads table)
export const LEAD_SOURCE_FIELDS: Array<{ value: string; label: string }> = [
  { value: "full_name", label: "Full Name" },
  { value: "phone", label: "Phone" },
  { value: "email", label: "Email" },
  { value: "company_name", label: "Company Name" },
  { value: "call_summary", label: "Last Call Summary" },
  { value: "next_action", label: "Last Next Action" },
  { value: "interest_level", label: "Interest Level" },
  { value: "notes", label: "Notes" },
  { value: "source", label: "Lead Source" },
];

interface Props {
  /** "leadgen" = no scoring rules; "qualify" = show score contribution column */
  mode: "leadgen" | "qualify";
  accentClass: string;
  /** current postCallMappings value */
  postCallMappings: Record<string, string>;
  /** current customScoringRules value */
  customScoringRules: Array<{ variable: string; points: number }>;
  onMappingChange: (mappings: Record<string, string>) => void;
  onScoringChange: (rules: Array<{ variable: string; points: number }>) => void;
}

export function PostCallVariableMappingSection({
  mode,
  accentClass,
  postCallMappings,
  customScoringRules,
  onMappingChange,
  onScoringChange,
}: Props) {
  const variables = useBuilderStore((s) => s.variables);

  if (variables.length === 0) {
    return (
      <Collapsible className={`rounded-lg border ${accentClass.replace("text-", "border-").replace("400", "500/20")} bg-current/5`}>
        <CollapsibleTrigger className={`flex w-full items-center justify-between p-3 text-xs font-medium ${accentClass}`}>
          <span className="flex items-center gap-1.5">
            <ArrowRight className="h-3.5 w-3.5" />
            Post-Call Variable Mapping
          </span>
          <ChevronDown className="h-3.5 w-3.5" />
        </CollapsibleTrigger>
        <CollapsibleContent className="px-3 pb-3">
          <p className="text-[11px] text-muted-foreground">
            No custom post-call variables defined yet. Add them in{" "}
            <span className="font-medium">Post Call Data Retrieval</span> above, then map each one to a lead field here.
          </p>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  function setMapping(varName: string, field: string) {
    onMappingChange({
      ...postCallMappings,
      [varName]: field === "__meta__" ? `meta.${varName}` : field,
    });
  }

  function setPoints(varName: string, pts: number) {
    const existing = customScoringRules.filter((r) => r.variable !== varName);
    if (pts > 0) {
      onScoringChange([...existing, { variable: varName, points: pts }]);
    } else {
      onScoringChange(existing);
    }
  }

  function currentPoints(varName: string): number {
    return customScoringRules.find((r) => r.variable === varName)?.points ?? 0;
  }

  function fieldDisplayValue(varName: string): string {
    const mapped = postCallMappings[varName];
    if (!mapped) return "";
    if (mapped.startsWith("meta.")) return "__meta__";
    return mapped;
  }

  function fieldLabel(field: string): string {
    if (field.startsWith("meta.")) return `meta.${field.slice(5)}`;
    return LEAD_FIELD_OPTIONS.find((o) => o.value === field)?.label ?? field;
  }

  // Group LEAD_FIELD_OPTIONS by group
  const groups = Array.from(new Set(LEAD_FIELD_OPTIONS.map((o) => o.group)));

  return (
    <Collapsible
      className={`rounded-lg border ${accentClass.includes("blue") ? "border-blue-500/20 bg-blue-500/5" : "border-violet-500/20 bg-violet-500/5"}`}
    >
      <CollapsibleTrigger className={`flex w-full items-center justify-between p-3 text-xs font-medium ${accentClass}`}>
        <span className="flex items-center gap-1.5">
          <ArrowRight className="h-3.5 w-3.5" />
          Post-Call Variable Mapping
        </span>
        <ChevronDown className="h-3.5 w-3.5" />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 px-3 pb-3">
        <p className="text-[11px] text-muted-foreground">
          After each call, map extracted variables to lead fields. Optionally add points to the score for truthy values.
        </p>
        <div className="space-y-2">
          <div className={`grid gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground ${mode === "qualify" ? "grid-cols-[1fr_auto_1fr_auto_5rem]" : "grid-cols-[1fr_auto_1fr]"}`}>
            <span>Variable</span>
            <span />
            <span>Lead Field</span>
            {mode === "qualify" && (
              <>
                <span />
                <span>+Points</span>
              </>
            )}
          </div>

          {variables.map((v) => (
            <div
              key={v.name}
              className={`grid items-center gap-1 ${mode === "qualify" ? "grid-cols-[1fr_auto_1fr_auto_5rem]" : "grid-cols-[1fr_auto_1fr]"}`}
            >
              <div className="rounded bg-muted px-1.5 py-1 text-[11px] font-mono truncate" title={v.name}>
                {v.name}
                {v.type && v.type !== "string" && (
                  <span className="ml-1 text-muted-foreground text-[10px]">({v.type})</span>
                )}
              </div>
              <ArrowRight className="h-3 w-3 text-muted-foreground" />
              <Select
                value={fieldDisplayValue(v.name)}
                onValueChange={(val) => setMapping(v.name, val)}
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="Lead field…">
                    {postCallMappings[v.name] ? fieldLabel(postCallMappings[v.name]) : undefined}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {groups.map((group) => (
                    <SelectGroup key={group}>
                      <SelectLabel className="text-[10px]">{group}</SelectLabel>
                      {LEAD_FIELD_OPTIONS.filter((o) => o.group === group).map((o) => (
                        <SelectItem key={o.value} value={o.value} className="text-xs">
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>

              {mode === "qualify" && (
                <>
                  <span className="text-[10px] text-muted-foreground text-center">+</span>
                  <Input
                    type="number"
                    min={0}
                    max={50}
                    value={currentPoints(v.name) || ""}
                    onChange={(e) => setPoints(v.name, parseInt(e.target.value, 10) || 0)}
                    placeholder="0"
                    className="h-7 text-xs text-center"
                  />
                </>
              )}
            </div>
          ))}
        </div>
        {mode === "qualify" && customScoringRules.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            Custom variables contribute{" "}
            <span className="font-medium text-foreground">
              +{customScoringRules.reduce((a, r) => a + r.points, 0)} pts max
            </span>{" "}
            to the qualification score.
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Pre-call mapping collapsible: maps {{placeholders}} → leads table fields */
export function PreCallLeadMappingSection({
  accentClass,
  placeholders,
  preCallMappings,
  onMappingChange,
}: {
  accentClass: string;
  placeholders: string[];
  preCallMappings: Record<string, string>;
  onMappingChange: (m: Record<string, string>) => void;
}) {
  if (placeholders.length === 0) {
    return (
      <Collapsible className="rounded-lg border border-blue-500/20 bg-blue-500/5">
        <CollapsibleTrigger className={`flex w-full items-center justify-between p-3 text-xs font-medium ${accentClass}`}>
          <span className="flex items-center gap-1.5">
            <ArrowRight className="h-3.5 w-3.5" />
            Pre-Call Data Injection
          </span>
          <ChevronDown className="h-3.5 w-3.5" />
        </CollapsibleTrigger>
        <CollapsibleContent className="px-3 pb-3">
          <p className="text-[11px] text-muted-foreground">
            No <code className="bg-muted px-1 rounded">{"{{variables}}"}</code> found in your script yet. Add them to inject lead data into the call.
          </p>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  return (
    <Collapsible className="rounded-lg border border-blue-500/20 bg-blue-500/5">
      <CollapsibleTrigger className={`flex w-full items-center justify-between p-3 text-xs font-medium ${accentClass}`}>
        <span className="flex items-center gap-1.5">
          <ArrowRight className="h-3.5 w-3.5" />
          Pre-Call Data Injection
        </span>
        <ChevronDown className="h-3.5 w-3.5" />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 px-3 pb-3">
        <p className="text-[11px] text-muted-foreground">
          Map <code className="bg-muted px-1 rounded">{"{{placeholders}}"}</code> in your script to lead fields. Values are injected before each qualification call.
        </p>
        <div className="space-y-1.5">
          {placeholders.map((p) => (
            <div key={p} className="grid grid-cols-[1fr_auto_1fr] items-center gap-1">
              <code className={`rounded bg-muted px-1.5 py-0.5 text-[11px] ${accentClass} truncate`}>
                {`{{${p}}}`}
              </code>
              <span className="text-[10px] text-muted-foreground">→</span>
              <Select
                value={preCallMappings[p] ?? ""}
                onValueChange={(v) => onMappingChange({ ...preCallMappings, [p]: v })}
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="Lead field…">
                    {preCallMappings[p]
                      ? LEAD_SOURCE_FIELDS.find((f) => f.value === preCallMappings[p])?.label ?? preCallMappings[p]
                      : undefined}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {LEAD_SOURCE_FIELDS.map((f) => (
                    <SelectItem key={f.value} value={f.value} className="text-xs">
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
