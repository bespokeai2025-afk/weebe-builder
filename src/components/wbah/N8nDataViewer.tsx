/**
 * n8n-style data viewer — JSON / Table / Schema tabs for execution I/O and pin data.
 */
import { useMemo } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export type N8nDataViewMode = "json" | "table" | "schema";

function hasData(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true;
}

function inferSchema(value: unknown, depth = 0): Record<string, unknown> {
  if (depth > 4) return { type: "unknown" };
  if (value === null) return { type: "null" };
  if (Array.isArray(value)) {
    const first = value[0];
    return {
      type: "array",
      length: value.length,
      items: first != null ? inferSchema(first, depth + 1) : { type: "any" },
    };
  }
  if (typeof value === "object") {
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      props[k] = inferSchema(v, depth + 1);
    }
    return { type: "object", properties: props };
  }
  return { type: typeof value };
}

function flattenForTable(data: unknown): Array<Record<string, string>> {
  if (Array.isArray(data)) {
    return data.slice(0, 50).map((row, i) => {
      if (row && typeof row === "object" && !Array.isArray(row)) {
        const flat: Record<string, string> = { _index: String(i) };
        for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
          flat[k] =
            v != null && typeof v === "object"
              ? JSON.stringify(v).slice(0, 120)
              : String(v ?? "");
        }
        return flat;
      }
      return { _index: String(i), value: String(row ?? "") };
    });
  }
  if (data && typeof data === "object") {
    return [
      Object.fromEntries(
        Object.entries(data as Record<string, unknown>).map(([k, v]) => [
          k,
          v != null && typeof v === "object" ? JSON.stringify(v).slice(0, 120) : String(v ?? ""),
        ]),
      ),
    ];
  }
  return [{ value: String(data ?? "") }];
}

export function N8nDataViewer({
  data,
  emptyLabel = "No data",
  className,
  defaultMode = "json",
  maxHeight = "max-h-64",
  fillHeight = false,
  hideTabs = false,
}: {
  data: unknown;
  emptyLabel?: string;
  className?: string;
  defaultMode?: N8nDataViewMode;
  maxHeight?: string;
  /** Fill parent height (n8n I/O panels) */
  fillHeight?: boolean;
  /** External tab control — show content only */
  hideTabs?: boolean;
}) {
  const rows = useMemo(() => flattenForTable(data), [data]);
  const schema = useMemo(() => inferSchema(data), [data]);
  const columns = useMemo(() => {
    const keys = new Set<string>();
    for (const r of rows) Object.keys(r).forEach((k) => keys.add(k));
    return Array.from(keys);
  }, [rows]);

  if (!hasData(data)) {
    return (
      <div
        className={cn(
          "rounded border border-dashed border-gray-800 p-4 text-center text-[10px] text-gray-600",
          fillHeight && "h-full flex items-center justify-center",
          className,
        )}
      >
        {emptyLabel}
      </div>
    );
  }

  const contentHeight = fillHeight ? "flex-1 min-h-0 h-full" : maxHeight;

  const jsonBlock = (
    <pre
      className={cn(
        "overflow-auto rounded border border-gray-800 bg-gray-950 p-2.5 text-[10px] font-mono text-gray-300 leading-relaxed",
        contentHeight,
      )}
    >
      {JSON.stringify(data, null, 2)}
    </pre>
  );

  const tableBlock = (
    <div className={cn("overflow-auto rounded border border-gray-800", contentHeight)}>
      <table className="w-full text-[10px]">
        <thead className="sticky top-0 bg-gray-900">
          <tr>
            {columns.map((c) => (
              <th key={c} className="border-b border-gray-800 px-2 py-1 text-left text-gray-500 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-gray-800/60 last:border-0">
              {columns.map((c) => (
                <td key={c} className="px-2 py-1 text-gray-300 font-mono align-top break-all">
                  {row[c] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const schemaBlock = (
    <pre
      className={cn(
        "overflow-auto rounded border border-gray-800 bg-gray-950 p-2.5 text-[10px] font-mono text-sky-300/90 leading-relaxed",
        contentHeight,
      )}
    >
      {JSON.stringify(schema, null, 2)}
    </pre>
  );

  if (hideTabs) {
    return (
      <div className={cn("flex flex-col h-full min-h-0", className)}>
        {defaultMode === "table" && tableBlock}
        {defaultMode === "schema" && schemaBlock}
        {defaultMode === "json" && jsonBlock}
      </div>
    );
  }

  return (
    <Tabs defaultValue={defaultMode} className={cn("w-full", fillHeight && "flex flex-col h-full", className)}>
      <TabsList className="h-7 bg-gray-900/80 border border-gray-800 shrink-0">
        <TabsTrigger value="json" className="text-[10px] h-6 px-2">
          JSON
        </TabsTrigger>
        <TabsTrigger value="table" className="text-[10px] h-6 px-2">
          Table
        </TabsTrigger>
        <TabsTrigger value="schema" className="text-[10px] h-6 px-2">
          Schema
        </TabsTrigger>
      </TabsList>
      <TabsContent value="json" className={cn("mt-2", fillHeight && "flex-1 min-h-0 data-[state=active]:flex data-[state=active]:flex-col")}>
        {jsonBlock}
      </TabsContent>
      <TabsContent value="table" className={cn("mt-2", fillHeight && "flex-1 min-h-0")}>
        {tableBlock}
      </TabsContent>
      <TabsContent value="schema" className={cn("mt-2", fillHeight && "flex-1 min-h-0")}>
        {schemaBlock}
      </TabsContent>
    </Tabs>
  );
}

export { hasData as n8nDataHasContent };
