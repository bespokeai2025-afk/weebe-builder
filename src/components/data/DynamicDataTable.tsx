import { useMemo } from "react";
import type { DataRecordRow } from "@/lib/dashboard/data-records.functions";
import { UserPlus, RotateCcw, Phone, Sparkles, Trash2 } from "lucide-react";
import { QuickDialerCallButton } from "@/components/leads/QuickDialerCallButton";
import { Checkbox } from "@/components/ui/checkbox";
import { fmtDate, statusBadgeClass } from "./data-format";

type OptionalColKey =
  | "email"
  | "title"
  | "client_name"
  | "unique_id"
  | "lead_external_id"
  | "property_type"
  | "bedrooms"
  | "address_line1"
  | "city"
  | "state"
  | "postal_code";

/** CSV extras stored on the record, shown as one column each. */
function metaValue(r: DataRecordRow, key: string): string | null {
  const meta = r.meta && typeof r.meta === "object" && !Array.isArray(r.meta) ? r.meta : null;
  const v = meta?.[key];
  return v == null ? null : String(v);
}

export const OPTIONAL_COLS: { key: OptionalColKey; label: string }[] = [
  { key: "email", label: "Email" },
  { key: "title", label: "Title" },
  { key: "client_name", label: "Client" },
  { key: "unique_id", label: "Unique ID" },
  { key: "lead_external_id", label: "Lead ID" },
  { key: "property_type", label: "Property Type" },
  { key: "bedrooms", label: "Bedrooms" },
  { key: "address_line1", label: "Address" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
  { key: "postal_code", label: "Postcode" },
];

export function DynamicDataTable({
  records,
  agents,
  selected,
  allSelected,
  toggleAll,
  toggleOne,
  onReset,
  onDelete,
  onAddToLead,
  addedLeadIds,
  onGenerate,
  canGenerate,
}: {
  records: DataRecordRow[];
  agents: Array<{ id: string; name: string }>;
  selected: Set<string>;
  allSelected: boolean;
  toggleAll: (v: boolean | "indeterminate") => void;
  toggleOne: (id: string) => void;
  onReset: (id: string) => void;
  onDelete: (id: string) => void;
  onAddToLead: (id: string) => void;
  /** Records sent to Leads this session — their button shows "In Leads". */
  addedLeadIds?: Set<string>;
  onGenerate: (record: DataRecordRow) => void;
  canGenerate: boolean;
}) {
  const extraCols = useMemo(
    () => OPTIONAL_COLS.filter((c) => records.some((r) => r[c.key])),
    [records],
  );

  const metaKeys = useMemo(() => {
    const keys = new Set<string>();
    records.forEach((r) => {
      if (r.meta && typeof r.meta === "object") {
        Object.keys(r.meta).forEach((k) => keys.add(k));
      }
    });
    return Array.from(keys).sort();
  }, [records]);

  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border dark:border-white/[0.06] bg-card/30">
            <th className="w-8 px-2 py-0.5">
              <Checkbox checked={allSelected} onCheckedChange={toggleAll} />
            </th>
            <th className="px-2 py-0.5 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Name
            </th>
            <th className="px-2 py-0.5 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Phone
            </th>
            {extraCols.map((c) => (
              <th
                key={c.key}
                className="whitespace-nowrap px-2 py-0.5 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
              >
                {c.label}
              </th>
            ))}
            {metaKeys.map((k) => (
              <th
                key={`meta_${k}`}
                className="whitespace-nowrap px-2 py-0.5 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
              >
                {k}
                <span className="ml-1 font-normal normal-case tracking-normal text-amber-500/70">
                  meta
                </span>
              </th>
            ))}
            <th className="px-2 py-0.5 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Status
            </th>
            <th className="px-2 py-0.5 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Agent
            </th>
            <th className="px-2 py-0.5 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Updated
            </th>
            <th className="px-2 py-0.5 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground" />
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr
              key={r.id}
              className={`group h-9 border-b border-border dark:border-white/4 align-middle hover:bg-muted/30 dark:hover:bg-white/[0.02] transition-colors ${selected.has(r.id) ? "bg-blue-500/5" : ""}`}
            >
              <td className="px-2.5 py-1">
                <Checkbox checked={selected.has(r.id)} onCheckedChange={() => toggleOne(r.id)} />
              </td>
              <td className="px-2.5 py-1 text-xs font-medium whitespace-nowrap">{r.name}</td>
              <td className="whitespace-nowrap px-2.5 py-1 text-muted-foreground text-[11px] font-mono">
                <span className="inline-flex items-center gap-1">
                  {r.mobile_number}
                  <QuickDialerCallButton phone={r.mobile_number} name={r.name} />
                </span>
              </td>
              {extraCols.map((c) => (
                <td key={c.key} className="px-2.5 py-1 text-muted-foreground text-[11px]">
                  {r[c.key] ?? "—"}
                </td>
              ))}
              {metaKeys.map((k) => (
                <td key={`meta_${k}`} className="px-2.5 py-1 text-muted-foreground text-[11px]">
                  {metaValue(r, k) ?? "—"}
                </td>
              ))}
              <td className="px-2.5 py-1">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ring-1 ${statusBadgeClass(r.call_status)}`}
                  >
                    {(r.call_status ?? "").replace(/_/g, " ") || "—"}
                  </span>
                  {/* Always visible: it used to appear only on hover, so most people never found it. */}
                  {addedLeadIds?.has(r.id) ? (
                    <span className="inline-flex items-center gap-0.5 rounded px-1 text-[10px] text-emerald-400">
                      <UserPlus className="h-3 w-3" />
                      In Leads
                    </span>
                  ) : (
                    <button
                      title="Send this record to Leads"
                      onClick={() => onAddToLead(r.id)}
                      className="inline-flex items-center gap-0.5 rounded border border-primary/25 px-1 py-0.5 text-[10px] font-medium text-primary/80 transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-primary"
                    >
                      <UserPlus className="h-3 w-3" />
                      Leads
                    </button>
                  )}
                  <button
                    title="Reset — mark as needs to call again"
                    onClick={() => onReset(r.id)}
                    className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100 focus:opacity-100"
                  >
                    <RotateCcw className="h-3 w-3" />
                  </button>
                  <button
                    title="Delete this record"
                    onClick={() => onDelete(r.id)}
                    className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-rose-400 group-hover:opacity-100 focus:opacity-100"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </td>
              <td className="px-2.5 py-1 text-muted-foreground text-[11px]">
                {r.assigned_agent_id
                  ? (agents.find((a) => a.id === r.assigned_agent_id)?.name ?? "—")
                  : "—"}
              </td>
              <td className="whitespace-nowrap px-2.5 py-1 text-muted-foreground text-[11px]">
                {fmtDate(r.updated_at)}
              </td>
              <td className="px-2.5 py-1">
                {canGenerate && (
                  <button
                    onClick={() => onGenerate(r)}
                    title="AI Sales Assistant"
                    className="flex items-center gap-1 rounded border border-primary/25 px-1.5 py-1 text-[10px] font-medium text-primary/80 transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-primary"
                  >
                    <Sparkles className="h-3 w-3" />
                    <span>Generate</span>
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
