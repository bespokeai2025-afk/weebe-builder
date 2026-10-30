import { useState, useMemo, useEffect } from "react";
import { Search, X } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { SYSTEM_FIELDS, autoDetectMapping, toMetaKey } from "./data-csv.shared";

export function CsvMappingDialog({
  open,
  onOpenChange,
  headers,
  rows,
  importing,
  onImport,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  headers: string[];
  rows: Record<string, string>[];
  importing: boolean;
  onImport: (mapping: Record<string, string>, rows: Record<string, string>[]) => Promise<void>;
}) {
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [customKeys, setCustomKeys] = useState<Record<string, string>>({});
  const [autoCustom, setAutoCustom] = useState(false);
  const [previewSearch, setPreviewSearch] = useState("");

  useEffect(() => {
    if (open && headers.length > 0) {
      const detected = autoDetectMapping(headers);
      setMapping(detected);
      // Pre-populate custom key names for unrecognised columns
      const keys: Record<string, string> = {};
      for (const h of headers) {
        keys[h] = toMetaKey(h) || h;
      }
      setCustomKeys(keys);
      setPreviewSearch("");
      setAutoCustom(false);
    }
  }, [open, headers]);

  const mappedFields = useMemo(
    () =>
      new Set(
        Object.values(mapping).filter(
          (v) => v && v !== "__custom__" && !v.startsWith("__custom__:"),
        ),
      ),
    [mapping],
  );

  const hasName = Object.values(mapping).includes("name");
  const hasMobile = Object.values(mapping).includes("mobile_number");
  const canImport = hasName && hasMobile;

  const customCount = useMemo(() => {
    let n = 0;
    for (const [h, v] of Object.entries(mapping)) {
      if (v === "__custom__" || v.startsWith("__custom__:")) n++;
    }
    if (autoCustom) {
      for (const h of headers) {
        if (!mapping[h]) n++;
      }
    }
    return n;
  }, [mapping, autoCustom, headers]);

  const previewRows = useMemo(() => {
    const q = previewSearch.trim().toLowerCase();
    if (!q) return rows.slice(0, 50);
    return rows
      .filter((row) => {
        for (const [csvCol, sysField] of Object.entries(mapping)) {
          if (!sysField) continue;
          const val = (row[csvCol] ?? "").toLowerCase();
          if (val.includes(q)) return true;
        }
        return false;
      })
      .slice(0, 50);
  }, [rows, mapping, previewSearch]);

  function setField(csvCol: string, rawValue: string) {
    const sysField = rawValue === "__skip__" ? "" : rawValue;
    setMapping((prev) => {
      const next = { ...prev };
      if (sysField && sysField !== "__custom__" && !sysField.startsWith("__custom__:")) {
        for (const k of Object.keys(next)) {
          if (next[k] === sysField && k !== csvCol) next[k] = "";
        }
      }
      next[csvCol] = sysField;
      return next;
    });
  }

  function setCustomKey(csvCol: string, key: string) {
    setCustomKeys((prev) => ({ ...prev, [csvCol]: key }));
  }

  /** Build the final mapping with encoded custom keys before calling onImport */
  async function handleImport() {
    const finalMapping: Record<string, string> = {};
    for (const h of headers) {
      const v = mapping[h] ?? "";
      if (v === "__custom__") {
        const key = customKeys[h] || toMetaKey(h) || h;
        finalMapping[h] = `__custom__:${key}`;
      } else if (!v && autoCustom) {
        const key = customKeys[h] || toMetaKey(h) || h;
        finalMapping[h] = `__custom__:${key}`;
      } else {
        finalMapping[h] = v;
      }
    }
    await onImport(finalMapping, rows);
  }

  function isCustomField(sysField: string) {
    return sysField === "__custom__" || sysField.startsWith("__custom__:");
  }

  function getEffectiveMapping(h: string): string {
    const v = mapping[h] ?? "";
    if (!v && autoCustom) return "__custom__";
    return v;
  }

  function getFieldLabel(sysField: string): string | null {
    if (!sysField) return null;
    if (isCustomField(sysField)) return null;
    return SYSTEM_FIELDS.find((f) => f.value === sysField)?.label ?? sysField;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-full max-w-4xl flex-col gap-0 p-0">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>Map CSV Columns</DialogTitle>
          <DialogDescription>
            {rows.length} rows · {headers.length} columns detected — map each column to a system
            field or save as a custom field in lead meta.
          </DialogDescription>
        </DialogHeader>

        {/* Auto-custom toggle bar */}
        <div className="flex items-center gap-2 border-b border-border bg-muted/20 px-4 py-2">
          <label className="flex cursor-pointer items-center gap-2">
            <Checkbox checked={autoCustom} onCheckedChange={(v) => setAutoCustom(v === true)} />
            <span className="text-xs text-muted-foreground">
              Auto-save all unmapped columns as custom fields
            </span>
          </label>
          {customCount > 0 && (
            <span className="ml-auto rounded bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-500">
              {customCount} custom field{customCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 divide-x divide-border overflow-hidden">
            {/* Left: column mapping */}
            <div className="flex w-[380px] shrink-0 flex-col overflow-hidden">
              <div className="border-b border-border bg-muted/30 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Column Mapping
              </div>
              <div className="flex-1 overflow-y-auto">
                {headers.map((h) => {
                  const effective = getEffectiveMapping(h);
                  const isCustom = isCustomField(effective);
                  const fieldLabel = getFieldLabel(effective);
                  const isAutoCustom = !mapping[h] && autoCustom;
                  const customKeyVal = customKeys[h] || toMetaKey(h) || h;

                  return (
                    <div
                      key={h}
                      className={`border-b border-border/40 px-4 py-2.5 ${isCustom ? "bg-amber-500/[0.03]" : ""}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium" title={h}>
                            {h}
                          </p>
                          {effective && !isCustom && fieldLabel && (
                            <p className="text-[10px] text-muted-foreground">
                              → {fieldLabel}
                              {SYSTEM_FIELDS.find((f) => f.value === effective)?.required && (
                                <span className="ml-1 text-primary">*</span>
                              )}
                            </p>
                          )}
                          {isCustom && (
                            <p className="text-[10px] text-amber-500">
                              meta.{customKeyVal}
                              {isAutoCustom && " (auto)"}
                            </p>
                          )}
                        </div>
                        <Select
                          value={effective || "__skip__"}
                          onValueChange={(v) => setField(h, v === "__skip__" ? "" : v)}
                        >
                          <SelectTrigger className="h-7 w-[140px] text-xs">
                            <SelectValue placeholder="Skip" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__skip__">
                              {isAutoCustom ? "Override (skip)" : "Skip"}
                            </SelectItem>
                            {SYSTEM_FIELDS.map((f) => (
                              <SelectItem
                                key={f.value}
                                value={f.value}
                                disabled={mappedFields.has(f.value) && mapping[h] !== f.value}
                              >
                                {f.label}
                                {f.required ? " *" : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {/* Editable meta key when mapped as custom */}
                      {isCustom && (
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            meta key:
                          </span>
                          <Input
                            value={customKeyVal}
                            onChange={(e) =>
                              setCustomKey(
                                h,
                                e.target.value
                                  .toLowerCase()
                                  .replace(/\s+/g, "_")
                                  .replace(/[^a-z0-9_]/g, ""),
                              )
                            }
                            className="h-5 px-1.5 py-0 text-[11px] font-mono flex-1"
                            placeholder="field_name"
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right: preview */}
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Preview
                </span>
                <div className="relative ml-auto w-[200px]">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search rows…"
                    value={previewSearch}
                    onChange={(e) => setPreviewSearch(e.target.value)}
                    className="h-7 pl-7 text-xs"
                  />
                  {previewSearch && (
                    <button
                      onClick={() => setPreviewSearch("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {previewSearch
                    ? `${previewRows.length} match${previewRows.length !== 1 ? "es" : ""}`
                    : `${Math.min(rows.length, 50)} of ${rows.length}`}
                </span>
              </div>
              <div className="flex-1 overflow-auto">
                {previewRows.length === 0 ? (
                  <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                    No rows match your search.
                  </div>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-card">
                      <tr className="border-b border-border text-left">
                        {headers.map((h) => {
                          const effective = getEffectiveMapping(h);
                          const isCustom = isCustomField(effective);
                          const isMapped = Boolean(effective);
                          const f = SYSTEM_FIELDS.find((x) => x.value === effective);
                          const customKeyVal = customKeys[h] || toMetaKey(h) || h;
                          return (
                            <th key={h} className="whitespace-nowrap px-2 py-0.5 font-semibold">
                              <div className="text-[11px] text-foreground/80">{h}</div>
                              <div className="text-[10px] font-normal">
                                {isCustom ? (
                                  <span className="text-amber-500">meta.{customKeyVal}</span>
                                ) : isMapped ? (
                                  <span className="text-primary">
                                    → {f?.label ?? effective}
                                    {f?.required && " *"}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground/50">skip</span>
                                )}
                              </div>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {previewRows.map((row, i) => (
                        <tr key={i} className="border-b border-border/40">
                          {headers.map((h) => (
                            <td key={h} className="whitespace-nowrap px-2.5 py-1" title={row[h]}>
                              {row[h] || <span className="text-muted-foreground/50">—</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="border-t border-border px-6 py-3">
          <div className="mr-auto flex items-center gap-2 text-xs text-muted-foreground">
            {!hasName && (
              <Badge variant="destructive" className="text-[10px]">
                Name * required
              </Badge>
            )}
            {!hasMobile && (
              <Badge variant="destructive" className="text-[10px]">
                Mobile Number * required
              </Badge>
            )}
            {canImport && (
              <span className="text-emerald-500">
                {rows.length} row{rows.length !== 1 ? "s" : ""} ready
                {customCount > 0
                  ? ` · ${customCount} custom field${customCount !== 1 ? "s" : ""}`
                  : ""}
              </span>
            )}
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>
            Cancel
          </Button>
          <Button onClick={handleImport} disabled={!canImport || importing}>
            {importing ? "Importing…" : `Import ${rows.length} row${rows.length !== 1 ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
