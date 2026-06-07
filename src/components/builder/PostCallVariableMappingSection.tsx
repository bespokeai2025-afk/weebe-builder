/**
 * PostCallVariableMappingSection — shared collapsible for LeadGen + Qualification builder panels.
 * PreCallLeadMappingSection — maps {{placeholders}} → leads table fields (with dynamic field detection).
 */
import { ArrowRight, ChevronDown, Plus, X } from "lucide-react";
import { useState } from "react";
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
import { Button } from "@/components/ui/button";
import { useBuilderStore } from "@/lib/builder/store";

// Lead fields available as post-call mapping targets
export const LEAD_FIELD_OPTIONS: Array<{ value: string; label: string; group: string }> = [
  { value: "call_summary", label: "Call Summary", group: "Core" },
  { value: "next_action", label: "Next Action", group: "Core" },
  { value: "objections", label: "Objections", group: "Core" },
  { value: "lead_score", label: "Lead Score (number)", group: "Scoring" },
  { value: "interest_level", label: "Interest Level", group: "Scoring" },
  { value: "buying_intent", label: "Buying Intent", group: "Scoring" },
  { value: "qualification_status", label: "Qualification Status", group: "Qualification" },
  { value: "qualification_score", label: "Qualification Score (number)", group: "Qualification" },
  { value: "budget_confirmed", label: "Budget Confirmed (boolean)", group: "Qualification" },
  { value: "decision_maker", label: "Decision Maker (boolean)", group: "Qualification" },
  { value: "urgency", label: "Urgency", group: "Qualification" },
  { value: "next_step", label: "Next Step", group: "Qualification" },
  { value: "meeting_requested", label: "Meeting Requested (boolean)", group: "Flags" },
  { value: "callback_requested", label: "Callback Requested (boolean)", group: "Flags" },
  { value: "__meta__", label: "Store in lead meta (custom)", group: "Custom" },
];

// Standard lead fields always available as pre-call injection sources
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
  { value: "urgency", label: "Urgency" },
  { value: "next_step", label: "Next Step" },
  { value: "buying_intent", label: "Buying Intent" },
];

interface PostCallProps {
  mode: "leadgen" | "qualify";
  accentClass: string;
  postCallMappings: Record<string, string>;
  customScoringRules: Array<{ variable: string; points: number }>;
  onMappingChange: (m: Record<string, string>) => void;
  onScoringChange: (r: Array<{ variable: string; points: number }>) => void;
}

export function PostCallVariableMappingSection({
  mode,
  accentClass,
  postCallMappings,
  customScoringRules,
  onMappingChange,
  onScoringChange,
}: PostCallProps) {
  const variables = useBuilderStore((s) => s.variables);

  const borderClass = accentClass.includes("blue")
    ? "border-blue-500/20 bg-blue-500/5"
    : "border-violet-500/20 bg-violet-500/5";

  const groups = Array.from(new Set(LEAD_FIELD_OPTIONS.map((o) => o.group)));

  function setMapping(varName: string, field: string) {
    onMappingChange({
      ...postCallMappings,
      [varName]: field === "__meta__" ? `meta.${varName}` : field,
    });
  }

  function setPoints(varName: string, pts: number) {
    const existing = customScoringRules.filter((r) => r.variable !== varName);
    if (pts > 0) onScoringChange([...existing, { variable: varName, points: pts }]);
    else onScoringChange(existing);
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

  if (variables.length === 0) {
    return (
      <Collapsible className={`rounded-lg border ${borderClass}`}>
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

  return (
    <Collapsible className={`rounded-lg border ${borderClass}`}>
      <CollapsibleTrigger className={`flex w-full items-center justify-between p-3 text-xs font-medium ${accentClass}`}>
        <span className="flex items-center gap-1.5">
          <ArrowRight className="h-3.5 w-3.5" />
          Post-Call Variable Mapping
        </span>
        <ChevronDown className="h-3.5 w-3.5" />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 px-3 pb-3">
        <p className="text-[11px] text-muted-foreground">
          After each call, map extracted variables to lead fields.
          {mode === "qualify" && " Add points to boost the qualification score when a variable is truthy."}
        </p>
        <div className="space-y-2">
          <div className={`grid gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground ${mode === "qualify" ? "grid-cols-[1fr_auto_1fr_auto_5rem]" : "grid-cols-[1fr_auto_1fr]"}`}>
            <span>Variable</span>
            <span />
            <span>Lead Field</span>
            {mode === "qualify" && <><span /><span>+Pts</span></>}
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
              <Select value={fieldDisplayValue(v.name)} onValueChange={(val) => setMapping(v.name, val)}>
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
                        <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
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

interface PreCallProps {
  accentClass: string;
  placeholders: string[];
  preCallMappings: Record<string, string>;
  onMappingChange: (m: Record<string, string>) => void;
  /** Standard + meta fields fetched from the workspace's lead records */
  sourceFields?: Array<{ value: string; label: string; group?: string }>;
  /** Extra custom field names the user has manually added */
  customLeadFields?: string[];
  onCustomLeadFieldsChange?: (fields: string[]) => void;
}

/** Pre-call mapping collapsible: maps {{placeholders}} → leads table fields */
export function PreCallLeadMappingSection({
  accentClass,
  placeholders,
  preCallMappings,
  onMappingChange,
  sourceFields,
  customLeadFields = [],
  onCustomLeadFieldsChange,
}: PreCallProps) {
  const [newField, setNewField] = useState("");

  const borderClass = accentClass.includes("blue")
    ? "border-blue-500/20 bg-blue-500/5"
    : "border-violet-500/20 bg-violet-500/5";

  // Build combined source options: standard fields + meta fields + user-added custom fields
  const standardFields = sourceFields?.filter((f) => !f.group || f.group === "standard") ?? LEAD_SOURCE_FIELDS;
  const metaFields = sourceFields?.filter((f) => f.group === "meta") ?? [];
  const userFields = customLeadFields.map((f) => ({ value: `meta.${f}`, label: f }));

  function addCustomField() {
    if (!newField.trim()) return;
    const key = newField.trim().toLowerCase().replace(/\s+/g, "_");
    if (customLeadFields.includes(key)) return;
    onCustomLeadFieldsChange?.([...customLeadFields, key]);
    setNewField("");
  }

  function removeCustomField(key: string) {
    onCustomLeadFieldsChange?.(customLeadFields.filter((f) => f !== key));
    // Also clear any mapping pointing to this field
    const updated = { ...preCallMappings };
    for (const [ph, val] of Object.entries(updated)) {
      if (val === `meta.${key}`) delete updated[ph];
    }
    onMappingChange(updated);
  }

  function fieldLabel(val: string): string {
    if (val.startsWith("meta.")) {
      const key = val.slice(5);
      return metaFields.find((f) => f.value === val)?.label ?? userFields.find((f) => f.value === val)?.label ?? key;
    }
    return standardFields.find((f) => f.value === val)?.label ?? val;
  }

  return (
    <Collapsible className={`rounded-lg border ${borderClass}`}>
      <CollapsibleTrigger className={`flex w-full items-center justify-between p-3 text-xs font-medium ${accentClass}`}>
        <span className="flex items-center gap-1.5">
          <ArrowRight className="h-3.5 w-3.5" />
          Pre-Call Data Injection
        </span>
        <ChevronDown className="h-3.5 w-3.5" />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 px-3 pb-3">
        <p className="text-[11px] text-muted-foreground">
          Map <code className="bg-muted px-1 rounded">{"{{placeholders}}"}</code> in your script to lead fields. Values are injected before each outbound call.
        </p>

        {placeholders.length === 0 ? (
          <p className="text-[11px] text-muted-foreground italic">
            No <code className="bg-muted px-0.5 rounded">{"{{variables}}"}</code> found in your script yet. Add them to inject lead data.
          </p>
        ) : (
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
                      {preCallMappings[p] ? fieldLabel(preCallMappings[p]) : undefined}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectLabel className="text-[10px]">Lead Fields</SelectLabel>
                      {standardFields.map((f) => (
                        <SelectItem key={f.value} value={f.value} className="text-xs">{f.label}</SelectItem>
                      ))}
                    </SelectGroup>
                    {(metaFields.length > 0 || userFields.length > 0) && (
                      <SelectGroup>
                        <SelectLabel className="text-[10px]">Custom Fields (meta)</SelectLabel>
                        {metaFields.map((f) => (
                          <SelectItem key={f.value} value={f.value} className="text-xs">{f.label}</SelectItem>
                        ))}
                        {userFields.map((f) => (
                          <SelectItem key={f.value} value={f.value} className="text-xs">{f.label}</SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
        )}

        {/* Custom field manager */}
        <div className="pt-1 border-t border-border/40">
          <p className="text-[10px] text-muted-foreground mb-1.5 font-medium uppercase tracking-wider">Add custom lead field</p>
          {customLeadFields.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-2">
              {customLeadFields.map((f) => (
                <span key={f} className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px]">
                  meta.{f}
                  <button onClick={() => removeCustomField(f)} className="text-muted-foreground hover:text-destructive">
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex gap-1">
            <Input
              value={newField}
              onChange={(e) => setNewField(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCustomField()}
              placeholder="field_name"
              className="h-7 text-xs flex-1"
            />
            <Button size="sm" variant="outline" className="h-7 px-2" onClick={addCustomField}>
              <Plus className="h-3 w-3" />
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">Stored in lead <code className="bg-muted px-0.5 rounded">meta</code> — useful if you set custom fields via CSV upload or post-call mapping.</p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
