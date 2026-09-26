import { useState, type ReactNode } from "react";
import { Phone, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { DetailNumber } from "./PhoneNumberDetail";

interface Props {
  numbers: DetailNumber[];
  selectedId?: string;
  onSelect: (id: string) => void;
  actions: ReactNode;
  management?: ReactNode;
  loading?: boolean;
  error?: boolean;
  children: ReactNode;
}

export function PhoneNumberWorkspace({
  numbers,
  selectedId,
  onSelect,
  actions,
  management,
  loading,
  error,
  children,
}: Props) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const visible = numbers.filter((number) =>
    `${number.friendly_name ?? ""} ${number.phone_number}`.toLowerCase().includes(query),
  );
  return (
    <main className="grid min-w-0 gap-3 p-3 text-foreground md:grid-cols-[260px_minmax(0,1fr)] lg:p-4">
      <aside
        aria-label="Phone number directory"
        className="min-w-0 self-start rounded-xl border border-border bg-card p-4 md:sticky md:top-4"
      >
        <div className="mb-4 flex items-center justify-between gap-2">
          <h1 className="flex items-center gap-2 text-sm font-semibold">
            <Phone className="h-4 w-4 text-muted-foreground" />
            Phone Numbers
          </h1>
          <span className="text-xs tabular-nums text-muted-foreground">{numbers.length}</span>
        </div>
        <div className="mb-4 flex flex-wrap gap-2">{actions}</div>
        <label htmlFor="phone-directory-search" className="sr-only">
          Search phone numbers
        </label>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground"
          />
          <Input
            id="phone-directory-search"
            className="h-10 pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name or number"
          />
        </div>
        <nav
          aria-label="Owned phone numbers"
          className="mt-3 max-h-52 space-y-1 overflow-y-auto md:max-h-[calc(100dvh-320px)]"
        >
          {visible.map((number) => (
            <button
              key={number.id}
              type="button"
              aria-current={selectedId === number.id ? "true" : undefined}
              onClick={() => onSelect(number.id)}
              className={`w-full rounded-lg border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedId === number.id ? "border-yellow-400/40 bg-yellow-400/10" : "border-transparent hover:bg-muted"}`}
            >
              <span className="block break-words text-sm font-medium">
                {number.friendly_name || number.phone_number}
              </span>
              {number.friendly_name && (
                <span className="mt-1 block break-all font-mono text-xs text-muted-foreground">
                  {number.phone_number}
                </span>
              )}
              <span className="mt-1 block text-xs text-muted-foreground">
                {number.is_active === false
                  ? "Inactive"
                  : number.agent_id
                    ? "Agent assigned"
                    : "Unassigned"}
              </span>
            </button>
          ))}
          {!visible.length && (
            <p role="status" className="px-2 py-5 text-sm text-muted-foreground">
              {loading
                ? "Loading numbers…"
                : error
                  ? "Numbers could not be loaded."
                  : numbers.length
                    ? "No matching numbers."
                    : "No phone numbers yet."}
            </p>
          )}
        </nav>
        {management && (
          <div className="mt-4 space-y-2 border-t border-border pt-4">{management}</div>
        )}
      </aside>
      <div className="min-w-0">{children}</div>
    </main>
  );
}
