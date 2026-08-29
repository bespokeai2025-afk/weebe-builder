import { useEffect, useMemo, useState } from "react";
import { Phone, Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  collectTestCallFields,
  testCallValuesStorageKey,
  type TestCallField,
} from "@/lib/builder/flow-variables";
import type { BuilderVariable, FlowNode } from "@/lib/builder/types";

export type TestCallStartSpeaker = "agent" | "user";

export interface TestCallPrepResult {
  variables: Record<string, string>;
  startSpeaker: TestCallStartSpeaker;
}

const SAMPLE_LEAD: Record<string, string> = {
  first_name: "Sarah",
  First_name: "Sarah",
  last_name: "Mitchell",
  email: "sarah.mitchell.test@example.com",
  mobile: "+447700900123",
  phone: "+447700900123",
  user_number: "+447700900123",
  bedrooms: "3",
  property_type: "Semi-detached",
  city: "Manchester",
  postcode_property: "M14 5PQ",
  postcode_contact: "M1 4BT",
};

const GROUP_LABEL: Record<TestCallField["group"], string> = {
  caller: "Caller",
  flow: "In this flow",
  booking: "Booking",
  system: "Date & time",
};

function loadSavedValues(agentId: string): Record<string, string> {
  if (typeof window === "undefined" || !agentId) return {};
  try {
    const raw = sessionStorage.getItem(testCallValuesStorageKey(agentId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

function saveValues(agentId: string, values: Record<string, string>) {
  if (typeof window === "undefined" || !agentId) return;
  try {
    sessionStorage.setItem(testCallValuesStorageKey(agentId), JSON.stringify(values));
  } catch {
    /* ignore quota */
  }
}

function seedValues(fields: TestCallField[], saved: Record<string, string>): Record<string, string> {
  const next: Record<string, string> = {};
  for (const field of fields) {
    next[field.name] = saved[field.name] ?? field.suggested ?? "";
  }
  return next;
}

export function TestCallPrepDialog({
  open,
  onOpenChange,
  nodes,
  declared,
  agentId,
  onStart,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodes: FlowNode[];
  declared: BuilderVariable[];
  agentId: string;
  onStart: (result: TestCallPrepResult) => void;
}) {
  const fields = useMemo(() => collectTestCallFields(nodes, declared), [nodes, declared]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [startSpeaker, setStartSpeaker] = useState<TestCallStartSpeaker>("agent");
  const [query, setQuery] = useState("");
  const [showSystem, setShowSystem] = useState(false);

  useEffect(() => {
    if (!open) return;
    setValues(seedValues(fields, loadSavedValues(agentId)));
    setStartSpeaker("agent");
    setQuery("");
    setShowSystem(false);
  }, [open, agentId, fields]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return fields.filter((field) => {
      if (field.group === "system" && !showSystem && !q) return false;
      if (!q) return true;
      return (
        field.name.toLowerCase().includes(q) ||
        (field.description ?? "").toLowerCase().includes(q)
      );
    });
  }, [fields, query, showSystem]);

  const grouped = useMemo(() => {
    const order: TestCallField["group"][] = ["caller", "flow", "booking", "system"];
    return order
      .map((group) => ({ group, items: filtered.filter((f) => f.group === group) }))
      .filter((g) => g.items.length > 0);
  }, [filtered]);

  const filledCount = fields.filter((f) => (values[f.name] ?? "").trim()).length;
  const filled = Object.fromEntries(
    Object.entries(values)
      .map(([k, v]) => [k, v.trim()] as const)
      .filter(([, v]) => v.length > 0),
  );

  const applySample = () => {
    setValues((prev) => {
      const next = { ...prev };
      for (const field of fields) {
        if ((next[field.name] ?? "").trim()) continue;
        if (SAMPLE_LEAD[field.name]) next[field.name] = SAMPLE_LEAD[field.name]!;
      }
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="space-y-1 border-b border-white/[0.06] px-5 py-4 text-left">
          <DialogTitle>Test call</DialogTitle>
          <DialogDescription>
            Pre-fill what the agent should already know. Leave a field empty to collect it live.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Who speaks first
            </p>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["agent", "Agent greets", "Speaks the start node immediately"],
                  ["user", "I speak first", "Agent waits for you"],
                ] as const
              ).map(([value, label, hint]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setStartSpeaker(value)}
                  className={
                    startSpeaker === value
                      ? "rounded-lg border border-sky-500/45 bg-sky-500/10 px-3 py-2 text-left"
                      : "rounded-lg border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-left hover:bg-white/[0.04]"
                  }
                >
                  <div className="text-xs font-medium text-foreground">{label}</div>
                  <div className="text-[10px] text-muted-foreground">{hint}</div>
                </button>
              ))}
            </div>
          </div>

          {fields.length === 0 ? (
            <p className="text-xs text-muted-foreground">No dynamic variables in this flow.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search variables…"
                    className="h-8 pl-8 text-xs"
                  />
                </div>
                <Button type="button" variant="outline" size="sm" className="h-8 shrink-0" onClick={applySample}>
                  <Sparkles className="mr-1 h-3 w-3" />
                  Sample
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                {filledCount} of {fields.length} filled
                {fields.some((f) => f.group === "system") && (
                  <>
                    {" · "}
                    <button
                      type="button"
                      className="text-sky-300 hover:underline"
                      onClick={() => setShowSystem((v) => !v)}
                    >
                      {showSystem ? "Hide" : "Show"} date & time
                    </button>
                  </>
                )}
              </p>

              {grouped.map(({ group, items }) => (
                <div key={group} className="space-y-1.5">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    {GROUP_LABEL[group]}
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {items.map((field) => (
                      <label key={field.name} className="block rounded-lg border border-white/[0.06] bg-white/[0.02] p-2">
                        <span className="font-mono text-[11px] text-foreground">{field.name}</span>
                        {field.description && (
                          <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                            {field.description}
                          </span>
                        )}
                        <Input
                          value={values[field.name] ?? ""}
                          onChange={(e) =>
                            setValues((prev) => ({ ...prev, [field.name]: e.target.value }))
                          }
                          placeholder={field.suggested || "Empty = collect on call"}
                          className="mt-1.5 h-8 text-xs"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 border-t border-white/[0.06] px-5 py-3 sm:justify-between">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              saveValues(agentId, values);
              onOpenChange(false);
              onStart({ variables: filled, startSpeaker });
            }}
          >
            <Phone className="mr-1.5 h-3.5 w-3.5" />
            Start test call
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
