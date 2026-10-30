import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

export const MANUAL_FIELDS: Array<{
  key: string;
  label: string;
  placeholder: string;
  required?: boolean;
  type?: string;
}> = [
  { key: "name", label: "Full Name", placeholder: "Jane Smith", required: true },
  {
    key: "mobile_number",
    label: "Mobile Number",
    placeholder: "+1 555 000 0000",
    required: true,
    type: "tel",
  },
  { key: "first_name", label: "First Name", placeholder: "Jane" },
  { key: "last_name", label: "Last Name", placeholder: "Smith" },
  { key: "email", label: "Email", placeholder: "jane@example.com", type: "email" },
  { key: "title", label: "Job Title", placeholder: "Sales Manager" },
  { key: "client_name", label: "Company", placeholder: "Acme Corp" },
  { key: "unique_id", label: "Unique ID", placeholder: "CRM-001" },
  { key: "property_type", label: "Property Type", placeholder: "Apartment" },
  { key: "bedrooms", label: "Bedrooms", placeholder: "3" },
  { key: "address_line1", label: "Address Line 1", placeholder: "123 Main St" },
  { key: "address_line2", label: "Address Line 2", placeholder: "Suite 4" },
  { key: "city", label: "City", placeholder: "New York" },
  { key: "state", label: "State / Region", placeholder: "NY" },
  { key: "postal_code", label: "Postal Code", placeholder: "10001" },
  { key: "lead_external_id", label: "Lead External ID", placeholder: "EXT-001" },
];

export function ManualEntryDialog({
  open,
  onOpenChange,
  agents,
  defaultAgentId,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  agents: Array<{ id: string; name: string; settings?: Record<string, unknown> | null }>;
  defaultAgentId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onSave: (row: Record<string, any>, agentId: string) => Promise<void>;
}) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [agentId, setAgentId] = useState("");
  const [extraRows, setExtraRows] = useState<Array<{ key: string; label: string; value: string }>>(
    [],
  );
  const [newKey, setNewKey] = useState("");
  const [newVal, setNewVal] = useState("");
  const [loading, setLoading] = useState(false);

  function getAgentMeta(id: string) {
    const ag = agents.find((a) => a.id === id);
    const leadGen = ag?.settings?.leadGen as { variableMappings?: Record<string, string> } | undefined;
    const mappings = leadGen?.variableMappings ?? {};
    return {
      fixedCols: [...new Set(Object.values(mappings).filter((v) => !v.startsWith("meta.")))],
      metaRows: Object.entries(mappings)
        .filter(([, v]) => v.startsWith("meta."))
        .map(([placeholder, colRef]) => ({
          key: colRef.slice(5),
          label: placeholder,
          value: "",
        })),
    };
  }

  useEffect(() => {
    if (open) {
      setFields({});
      setNewKey("");
      setNewVal("");
      setLoading(false);
      const id = defaultAgentId;
      setAgentId(id);
      setExtraRows(id ? getAgentMeta(id).metaRows : []);
    }
  }, [open, defaultAgentId]);

  useEffect(() => {
    if (!open) return;
    setExtraRows(agentId ? getAgentMeta(agentId).metaRows : []);
  }, [agentId]);

  function setField(key: string, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  function addCustomRow() {
    const k = newKey.trim();
    const v = newVal.trim();
    if (!k) return;
    setExtraRows((prev) => [...prev, { key: k, label: k, value: v }]);
    setNewKey("");
    setNewVal("");
  }

  function removeCustomRow(i: number) {
    setExtraRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  function normalisePhone(raw: string): string {
    let s = raw.replace(/[\s.\-()]/g, "");
    if (s.startsWith("00")) s = "+" + s.slice(2);
    return s;
  }

  const canSave =
    (fields.name ?? "").trim().length > 0 && (fields.mobile_number ?? "").trim().length > 0;

  async function handleSave() {
    setLoading(true);
    try {
      const meta: Record<string, string> = {};
      for (const r of extraRows) {
        if (r.key && r.value) meta[r.key] = r.value;
      }
      const row = {
        name: fields.name?.trim() || "",
        mobile_number: normalisePhone(fields.mobile_number?.trim() || ""),
        first_name: fields.first_name?.trim() || null,
        last_name: fields.last_name?.trim() || null,
        email: fields.email?.trim() || null,
        title: fields.title?.trim() || null,
        client_name: fields.client_name?.trim() || null,
        unique_id: fields.unique_id?.trim() || null,
        property_type: fields.property_type?.trim() || null,
        bedrooms: fields.bedrooms?.trim() || null,
        address_line1: fields.address_line1?.trim() || null,
        address_line2: fields.address_line2?.trim() || null,
        city: fields.city?.trim() || null,
        state: fields.state?.trim() || null,
        postal_code: fields.postal_code?.trim() || null,
        lead_external_id: fields.lead_external_id?.trim() || null,
        ...(Object.keys(meta).length > 0 ? { meta } : {}),
      };
      await onSave(row, agentId);
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-full max-w-lg flex-col gap-0 p-0">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>Add Record Manually</DialogTitle>
          <DialogDescription>
            Enter contact details directly — no CSV required. Name and mobile number are required.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {/* Agent variable hints banner */}
          {(() => {
            if (!agentId) return null;
            const { fixedCols } = getAgentMeta(agentId);
            if (fixedCols.length === 0) return null;
            return (
              <div className="rounded-md border border-violet-200 bg-violet-50 p-2.5 dark:border-violet-800 dark:bg-violet-950/30">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-violet-700 dark:text-violet-300">
                  Fields this agent uses
                </p>
                <div className="flex flex-wrap gap-1">
                  {fixedCols.map((col) => (
                    <span
                      key={col}
                      className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:bg-violet-900 dark:text-violet-300"
                    >
                      {col}
                    </span>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Required fields */}
          <div className="space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Required
            </p>
            {MANUAL_FIELDS.filter((f) => f.required).map((f) => (
              <div key={f.key} className="space-y-1">
                <Label htmlFor={`mf-${f.key}`} className="text-xs">
                  {f.label} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id={`mf-${f.key}`}
                  type={f.type ?? "text"}
                  placeholder={f.placeholder}
                  value={fields[f.key] ?? ""}
                  onChange={(e) => setField(f.key, e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
            ))}
          </div>

          {/* Optional fields */}
          <div className="space-y-3 pt-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Optional
            </p>
            <div className="grid grid-cols-2 gap-3">
              {MANUAL_FIELDS.filter((f) => !f.required).map((f) => (
                <div key={f.key} className="space-y-1">
                  <Label htmlFor={`mf-${f.key}`} className="text-xs">
                    {f.label}
                  </Label>
                  <Input
                    id={`mf-${f.key}`}
                    type={f.type ?? "text"}
                    placeholder={f.placeholder}
                    value={fields[f.key] ?? ""}
                    onChange={(e) => setField(f.key, e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Custom fields */}
          <div className="space-y-2 pt-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Custom Fields
              <span className="ml-1 font-normal normal-case tracking-normal text-amber-500">
                stored in meta
              </span>
            </p>
            {extraRows.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="min-w-[120px] truncate text-xs font-medium">{row.label}</span>
                <span className="flex-1 truncate text-xs text-muted-foreground">{row.value}</span>
                <button
                  type="button"
                  onClick={() => removeCustomRow(i)}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <div className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <Label className="text-xs">Field name</Label>
                <Input
                  placeholder="e.g. suburb"
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  className="h-7 text-xs"
                  onKeyDown={(e) => e.key === "Enter" && addCustomRow()}
                />
              </div>
              <div className="flex-1 space-y-1">
                <Label className="text-xs">Value</Label>
                <Input
                  placeholder="e.g. Bondi"
                  value={newVal}
                  onChange={(e) => setNewVal(e.target.value)}
                  className="h-7 text-xs"
                  onKeyDown={(e) => e.key === "Enter" && addCustomRow()}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={addCustomRow}
                disabled={!newKey.trim()}
              >
                Add
              </Button>
            </div>
          </div>

          {/* Agent assignment */}
          <div className="space-y-1.5 pt-2 border-t border-border">
            <Label className="text-xs">Agent that will call this record</Label>
            <Select
              value={agentId || "__none__"}
              onValueChange={(v) => setAgentId(v === "__none__" ? "" : v)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="No agent — assign later" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No agent — assign later</SelectItem>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter className="border-t border-border px-6 py-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave || loading}>
            {loading ? "Saving…" : "Add Record"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
