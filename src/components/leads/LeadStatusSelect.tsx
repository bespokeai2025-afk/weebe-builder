import { useState } from "react";

/** One explicit status action per row; disable while the update is in flight. */
export function LeadStatusSelect<T extends string>({ value, options, onChange }: {
  value: string | null;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const known = options.some(option => option.value === value);
  return (
    <div className="flex min-w-40 items-center gap-2">
      <select
        aria-label="Lead status"
        aria-busy={saving}
        disabled={saving}
        value={value ?? ""}
        className="h-9 w-full rounded-lg border border-input bg-card px-3 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:cursor-wait"
        onChange={async event => {
          const option = options.find(item => item.value === event.target.value);
          if (!option) return;
          setSaving(true);
          try { await onChange(option.value); }
          finally { setSaving(false); }
        }}
      >
        {!known && <option value={value ?? ""}>{value || "Choose status"}</option>}
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      {saving && <span role="status" className="text-xs text-muted-foreground">Saving…</span>}
    </div>
  );
}
