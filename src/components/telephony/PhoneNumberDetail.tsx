import { useState } from "react";
import { ArrowLeft, ChevronRight, Copy, MoreHorizontal, Pencil, PhoneOutgoing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface DetailNumber {
  id: string;
  phone_number: string;
  friendly_name?: string | null;
  provider: string;
  agent_id?: string | null;
  is_active?: boolean;
}

interface Props {
  number: DetailNumber;
  agents: { id: string; name: string }[];
  onBack: () => void;
  onRename: (name: string) => Promise<void>;
  onAssign: (agentId: string | null) => Promise<string>;
  embedded?: boolean;
}

function CountryField({ direction }: { direction: "inbound" | "outbound" }) {
  return (
    <div className="space-y-2">
      <label htmlFor={`${direction}-countries`} className="text-sm font-medium">
        Allowed {direction} countries
      </label>
      <Select disabled>
        <SelectTrigger
          id={`${direction}-countries`}
          className="h-10 bg-background disabled:opacity-70"
          aria-describedby={`${direction}-countries-help`}
        >
          <SelectValue placeholder="Country restrictions unavailable" />
        </SelectTrigger>
      </Select>
      <p id={`${direction}-countries-help`} className="text-xs text-muted-foreground">
        Country rules cannot be configured here. Your provider's restrictions still apply.
      </p>
    </div>
  );
}

function AgentField({
  direction,
  value,
  agents,
  disabled,
  onChange,
}: {
  direction: "inbound" | "outbound";
  value: string;
  agents: Props["agents"];
  disabled?: boolean;
  onChange?: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label htmlFor={`${direction}-agent`} className="text-sm font-medium">
          Call agent
        </label>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>A/B testing · unavailable</span>
          <Switch checked={false} disabled aria-label={`${direction} A/B testing unavailable`} />
        </div>
      </div>
      <Select value={value || "none"} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger
          id={`${direction}-agent`}
          className="h-10 bg-background disabled:opacity-70"
          aria-describedby={`${direction}-agent-help`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">None assigned</SelectItem>
          {value && !agents.some((a) => a.id === value) && (
            <SelectItem value={value}>Assigned agent</SelectItem>
          )}
          {agents.map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p id={`${direction}-agent-help`} className="text-xs leading-5 text-muted-foreground">
        {direction === "inbound"
          ? "Choose the agent that answers incoming calls. Assignment saves immediately. Removing it does not guarantee inbound calls are disabled."
          : "Uses the number's assigned agent by default. Separate outbound assignment is not available."}
      </p>
    </div>
  );
}

export function PhoneNumberDetail({
  number,
  agents,
  onBack,
  onRename,
  onAssign,
  embedded = false,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(number.friendly_name ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setMessage(await action());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to save changes. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className={
        embedded
          ? "min-w-0 text-foreground"
          : "mx-auto w-full max-w-5xl space-y-4 p-4 text-foreground sm:p-6 lg:p-8"
      }
    >
      {!embedded && (
        <Button size="sm" variant="ghost" className="-ml-3" onClick={onBack}>
          <ArrowLeft />
          Phone numbers
        </Button>
      )}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <header className="flex flex-col justify-between gap-5 border-b border-border p-5 sm:flex-row sm:flex-wrap sm:items-start sm:p-6">
          <div className="min-w-0 space-y-2">
            {editing ? (
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await onRename(name.trim());
                    setEditing(false);
                    return "Name saved.";
                  });
                }}
              >
                <div className="space-y-1">
                  <label htmlFor="number-name" className="text-xs font-medium">
                    Display name
                  </label>
                  <Input
                    autoFocus
                    id="number-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={64}
                    disabled={busy}
                    className="h-10"
                  />
                </div>
                <Button size="sm" type="submit" disabled={busy}>
                  {busy ? "Saving…" : "Save"}
                </Button>
                <Button
                  size="sm"
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </Button>
              </form>
            ) : (
              <div className="flex items-center gap-2">
                <h1 className="break-words text-xl font-semibold tracking-tight">
                  {number.friendly_name || number.phone_number}
                </h1>
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  aria-label="Edit display name"
                  onClick={() => {
                    setName(number.friendly_name ?? "");
                    setEditing(true);
                  }}
                >
                  <Pencil />
                </Button>
              </div>
            )}
            <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span className="font-mono">{number.phone_number}</span>
              <span>
                Provider:{" "}
                {number.provider === "twilio"
                  ? "Twilio"
                  : number.provider === "frejun"
                    ? "FreJun"
                    : number.provider}
              </span>
            </p>
          </div>
          <div className="space-y-2 sm:max-w-64">
            <div className="flex items-center gap-2">
              <Button size="sm" disabled className="flex-1" aria-describedby="outbound-call-help">
                <PhoneOutgoing />
                Make an outbound call
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label="Number actions">
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() =>
                      void run(async () => {
                        await navigator.clipboard.writeText(number.phone_number);
                        return "Phone number copied.";
                      })
                    }
                  >
                    <Copy className="mr-2 h-4 w-4" />
                    Copy phone number
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <p id="outbound-call-help" className="text-xs leading-5 text-muted-foreground">
              Calling from this detail view is not enabled yet.
            </p>
          </div>
        </header>
        {(message || error) && (
          <div className="border-b border-border px-5 py-3 sm:px-6">
            <p
              role={error ? "alert" : "status"}
              className={`text-sm ${error ? "text-destructive" : "text-muted-foreground"}`}
            >
              {error || message}
            </p>
          </div>
        )}
        <section
          aria-labelledby="inbound-heading"
          className="space-y-5 border-b border-border p-5 sm:p-6"
        >
          <h2 id="inbound-heading" className="text-sm font-semibold">
            Inbound call agent
          </h2>
          <AgentField
            direction="inbound"
            value={number.agent_id ?? ""}
            agents={agents}
            disabled={busy}
            onChange={(value) => void run(() => onAssign(value === "none" ? null : value))}
          />
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Checkbox
                id="inbound-webhook"
                checked={false}
                disabled
                aria-describedby="webhook-help"
              />
              <label htmlFor="inbound-webhook" className="text-sm">
                Add an inbound webhook
              </label>
            </div>
            <p id="webhook-help" className="pl-6 text-xs leading-5 text-muted-foreground">
              Custom inbound webhooks are unavailable. WEBEE manages provider routing.
            </p>
          </div>
          <CountryField direction="inbound" />
          <div className="space-y-2">
            <label htmlFor="fallback-number" className="text-sm font-medium">
              Fallback number
            </label>
            <p id="fallback-help" className="text-xs leading-5 text-muted-foreground">
              Forward calls when your agent cannot answer. Fallback routing is not available yet.
            </p>
            <Input
              id="fallback-number"
              type="tel"
              disabled
              placeholder="Not configured"
              aria-describedby="fallback-help"
              className="h-10 bg-background disabled:opacity-70"
            />
          </div>
        </section>
        <section
          aria-labelledby="outbound-heading"
          className="space-y-5 border-b border-border p-5 sm:p-6"
        >
          <h2 id="outbound-heading" className="text-sm font-semibold">
            Outbound call agent
          </h2>
          <AgentField direction="outbound" value={number.agent_id ?? ""} agents={agents} disabled />
          <CountryField direction="outbound" />
        </section>
        <section aria-labelledby="addons-heading" className="p-5 sm:p-6">
          <h2 id="addons-heading" className="mb-2 text-sm font-semibold">
            Advanced add-ons
          </h2>
          <div className="divide-y divide-border">
            {[
              {
                title: "SMS",
                description:
                  "Send text messages from this number. SMS setup is not available here.",
                action: "Setup SMS Function",
              },
              {
                title: "Verified phone number",
                description:
                  "Help recipients recognise legitimate calls. Verification setup is not available yet.",
                action: "Set up",
              },
              {
                title: "Branded call",
                description:
                  "Display your verified business name as caller ID. Branded calling is not available yet.",
                action: "Set up",
              },
            ].map((addon) => (
              <div
                key={addon.title}
                className="flex flex-col justify-between gap-3 py-4 sm:flex-row sm:items-center"
              >
                <div className="space-y-1">
                  <h3 className="text-sm font-medium">{addon.title}</h3>
                  <p className="max-w-xl text-xs leading-5 text-muted-foreground">
                    {addon.description}
                  </p>
                </div>
                <Button size="sm" variant="ghost" disabled className="self-start sm:self-center">
                  {addon.action}
                  <ChevronRight />
                </Button>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
