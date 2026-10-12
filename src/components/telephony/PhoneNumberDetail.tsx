import { useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  Copy,
  MoreHorizontal,
  Pencil,
  PhoneOutgoing,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
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
import {
  E164,
  normaliseAgentWeights,
  normaliseCountryList,
  validateAgentWeights,
  validateWebhookUrl,
  type AgentWeight,
} from "@/lib/telephony/number-routing.shared";

export interface DetailNumber {
  id: string;
  phone_number: string;
  friendly_name?: string | null;
  provider: string;
  agent_id?: string | null;
  is_active?: boolean;
  inbound_agents?: unknown;
  outbound_agents?: unknown;
  inbound_webhook_url?: string | null;
  fallback_number?: string | null;
  allowed_inbound_countries?: string[] | null;
  allowed_outbound_countries?: string[] | null;
}

/** What the settings form saves — mirrors `updatePhoneNumberRouting`. */
export interface RoutingPatch {
  inboundAgents?: AgentWeight[];
  outboundAgents?: AgentWeight[];
  inboundWebhookUrl?: string | null;
  fallbackNumber?: string | null;
  allowedInboundCountries?: string[];
  allowedOutboundCountries?: string[];
}

interface Props {
  number: DetailNumber;
  agents: { id: string; name: string }[];
  onBack: () => void;
  onRename: (name: string) => Promise<void>;
  onAssign: (agentId: string | null) => Promise<string>;
  /** Saves routing settings. Without it the routing controls are read-only. */
  onSaveRouting?: (patch: RoutingPatch) => Promise<string>;
  /** Places a call from this number. Without it the button stays disabled. */
  onPlaceCall?: (input: { to: string; dynamicVariables: Record<string, string> }) => Promise<string>;
  embedded?: boolean;
}

/** Rows as edited: weights shown as whole percentages. */
type Row = { agent_id: string; percent: number };

function rowsFrom(list: unknown, fallbackAgent: string | null | undefined): Row[] {
  const weights = normaliseAgentWeights(list);
  if (weights.length) return weights.map((w) => ({ agent_id: w.agent_id, percent: Math.round(w.weight * 100) }));
  return fallbackAgent ? [{ agent_id: fallbackAgent, percent: 100 }] : [];
}

function countriesText(list: string[] | null | undefined): string {
  return (list ?? []).join(", ");
}

function parseCountries(text: string): string[] {
  return normaliseCountryList(text.split(/[\s,]+/));
}

/** "name=Jane" per line → { name: "Jane" }. */
export function parseVariableLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const at = line.indexOf("=");
    if (at <= 0) continue;
    const key = line.slice(0, at).trim();
    if (key) out[key] = line.slice(at + 1).trim();
  }
  return out;
}

function AgentRows({
  direction,
  rows,
  agents,
  abTesting,
  disabled,
  allowAb = true,
  onRows,
  onAbTesting,
}: {
  direction: "inbound" | "outbound";
  rows: Row[];
  agents: Props["agents"];
  abTesting: boolean;
  disabled?: boolean;
  /** A/B lists can only be saved through the routing settings. */
  allowAb?: boolean;
  onRows: (rows: Row[]) => void;
  onAbTesting: (on: boolean) => void;
}) {
  const single = rows[0]?.agent_id ?? "";
  const nameFor = (id: string) => agents.find((a) => a.id === id)?.name ?? "Assigned agent";
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label htmlFor={`${direction}-agent`} className="text-sm font-medium">
          Call agent
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>A/B testing</span>
          <Switch
            checked={abTesting}
            disabled={disabled || !allowAb}
            onCheckedChange={(on) => {
              onAbTesting(on);
              if (on && rows.length === 1) onRows([{ ...rows[0]!, percent: 50 }, { agent_id: "", percent: 50 }]);
              if (!on) onRows(rows.slice(0, 1).map((r) => ({ ...r, percent: 100 })));
            }}
            aria-label={`${direction} A/B testing`}
          />
        </label>
      </div>
      {!abTesting ? (
        <Select
          value={single || "none"}
          onValueChange={(value) => onRows(value === "none" ? [] : [{ agent_id: value, percent: 100 }])}
          disabled={disabled}
        >
          <SelectTrigger id={`${direction}-agent`} className="h-10 bg-background">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None assigned</SelectItem>
            {single && !agents.some((a) => a.id === single) && (
              <SelectItem value={single}>Assigned agent</SelectItem>
            )}
            {agents.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <div className="space-y-2">
          {rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <Select
                value={row.agent_id || "none"}
                onValueChange={(value) =>
                  onRows(rows.map((r, j) => (j === i ? { ...r, agent_id: value === "none" ? "" : value } : r)))
                }
                disabled={disabled}
              >
                <SelectTrigger className="h-10 flex-1 bg-background" aria-label={`${direction} agent ${i + 1}`}>
                  <SelectValue placeholder="Choose agent">{row.agent_id ? nameFor(row.agent_id) : "Choose agent"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Choose agent</SelectItem>
                  {agents.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={row.percent}
                  disabled={disabled}
                  onChange={(e) =>
                    onRows(rows.map((r, j) => (j === i ? { ...r, percent: Number(e.target.value) } : r)))
                  }
                  className="h-10 w-20 bg-background tabular-nums"
                  aria-label={`${direction} agent ${i + 1} share (%)`}
                />
                <span className="text-xs text-muted-foreground">%</span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={disabled || rows.length <= 2}
                onClick={() => onRows(rows.filter((_, j) => j !== i))}
                aria-label={`Remove ${direction} agent ${i + 1}`}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || rows.length >= 10}
            onClick={() => onRows([...rows, { agent_id: "", percent: 0 }])}
          >
            <Plus />
            Add agent
          </Button>
          <p className="text-xs text-muted-foreground">
            Each call picks one agent at random by share. Shares are rescaled to add up to 100%.
          </p>
        </div>
      )}
    </div>
  );
}

function CountryField({
  direction,
  value,
  disabled,
  onChange,
}: {
  direction: "inbound" | "outbound";
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={`${direction}-countries`} className="text-sm font-medium">
        Allowed {direction} countries
      </label>
      <Input
        id={`${direction}-countries`}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        placeholder="All countries"
        className="h-10 bg-background"
        aria-describedby={`${direction}-countries-help`}
      />
      <p id={`${direction}-countries-help`} className="text-xs text-muted-foreground">
        {direction === "inbound"
          ? "Two-letter codes, e.g. GB, IE. Calls from other countries are rejected. Leave empty to allow all."
          : "Two-letter codes, e.g. GB. Calls to other countries are blocked before dialling. Leave empty to allow all."}
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
  onSaveRouting,
  onPlaceCall,
  embedded = false,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(number.friendly_name ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const initialInbound = rowsFrom(number.inbound_agents, number.agent_id);
  const initialOutbound = rowsFrom(number.outbound_agents, number.agent_id);
  const [inboundRows, setInboundRows] = useState<Row[]>(initialInbound);
  const [outboundRows, setOutboundRows] = useState<Row[]>(initialOutbound);
  const [inboundAb, setInboundAb] = useState(initialInbound.length > 1);
  const [outboundAb, setOutboundAb] = useState(initialOutbound.length > 1);
  const [webhookOn, setWebhookOn] = useState(Boolean(number.inbound_webhook_url));
  const [webhookUrl, setWebhookUrl] = useState(number.inbound_webhook_url ?? "");
  const [fallback, setFallback] = useState(number.fallback_number ?? "");
  const [inboundCountries, setInboundCountries] = useState(countriesText(number.allowed_inbound_countries));
  const [outboundCountries, setOutboundCountries] = useState(countriesText(number.allowed_outbound_countries));
  const [callOpen, setCallOpen] = useState(false);
  const [callTo, setCallTo] = useState("");
  const [callVars, setCallVars] = useState("");

  const canSave = Boolean(onSaveRouting);
  const settingsDisabled = busy || !canSave;

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

  function weightsFrom(rows: Row[]): AgentWeight[] {
    const list = rows
      .filter((r) => r.agent_id)
      .map((r) => ({ agent_id: r.agent_id, weight: r.percent }));
    const problem = validateAgentWeights(list);
    if (problem) throw new Error(problem);
    return list;
  }

  function saveInbound() {
    void run(async () => {
      const webhook = webhookOn ? webhookUrl.trim() : "";
      if (webhookOn) {
        if (!webhook) throw new Error("Enter the inbound webhook URL, or untick it.");
        const problem = validateWebhookUrl(webhook);
        if (problem) throw new Error(problem);
      }
      const fallbackNumber = fallback.trim();
      if (fallbackNumber && !E164.test(fallbackNumber)) {
        throw new Error("Fallback number must be in international format, e.g. +447700900123.");
      }
      const inbound = weightsFrom(inboundRows);
      if (!onSaveRouting) {
        return onAssign(inbound[0]?.agent_id ?? null);
      }
      return onSaveRouting({
        inboundAgents: inbound,
        inboundWebhookUrl: webhook || null,
        fallbackNumber: fallbackNumber || null,
        allowedInboundCountries: parseCountries(inboundCountries),
      });
    });
  }

  function saveOutbound() {
    void run(async () => {
      if (!onSaveRouting) throw new Error("Saving outbound settings is not available here.");
      return onSaveRouting({
        outboundAgents: weightsFrom(outboundRows),
        allowedOutboundCountries: parseCountries(outboundCountries),
      });
    });
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
              <Button
                size="sm"
                disabled={!onPlaceCall || busy}
                className="flex-1"
                aria-describedby="outbound-call-help"
                aria-expanded={callOpen}
                onClick={() => setCallOpen((open) => !open)}
              >
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
              {onPlaceCall
                ? "Calls with this number's outbound agent."
                : "Calling from this detail view is not enabled yet."}
            </p>
          </div>
        </header>
        {callOpen && onPlaceCall && (
          <form
            className="space-y-3 border-b border-border p-5 sm:p-6"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const to = callTo.trim();
                if (!E164.test(to)) throw new Error("Enter the number to call in international format, e.g. +447700900123.");
                const result = await onPlaceCall({ to, dynamicVariables: parseVariableLines(callVars) });
                setCallOpen(false);
                setCallTo("");
                return result;
              });
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor="call-to" className="text-sm font-medium">
                  Number to call
                </label>
                <Input
                  id="call-to"
                  type="tel"
                  value={callTo}
                  onChange={(e) => setCallTo(e.target.value)}
                  placeholder="+447700900123"
                  className="h-10 bg-background"
                  disabled={busy}
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="call-vars" className="text-sm font-medium">
                  Dynamic variables (optional)
                </label>
                <Textarea
                  id="call-vars"
                  rows={2}
                  value={callVars}
                  onChange={(e) => setCallVars(e.target.value)}
                  placeholder={"first_name=Jane\naddress=42 Baker Street"}
                  className="bg-background font-mono text-xs"
                  disabled={busy}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" type="submit" disabled={busy}>
                {busy ? "Calling…" : "Call now"}
              </Button>
              <Button size="sm" type="button" variant="ghost" disabled={busy} onClick={() => setCallOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}
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
          <AgentRows
            direction="inbound"
            rows={inboundRows}
            agents={agents}
            abTesting={inboundAb}
            allowAb={canSave}
            disabled={busy}
            onRows={setInboundRows}
            onAbTesting={setInboundAb}
          />
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="inbound-webhook"
                checked={webhookOn}
                disabled={settingsDisabled}
                onCheckedChange={(v) => setWebhookOn(v === true)}
                aria-describedby="webhook-help"
              />
              <label htmlFor="inbound-webhook" className="text-sm">
                Add an inbound webhook
              </label>
            </div>
            {webhookOn && (
              <Input
                aria-label="Inbound webhook URL"
                value={webhookUrl}
                disabled={settingsDisabled}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://example.com/inbound-call"
                className="h-10 bg-background"
              />
            )}
            <p id="webhook-help" className="pl-6 text-xs leading-5 text-muted-foreground">
              Called before each inbound call connects, in Retell's format. Your endpoint can reject the
              call, choose another agent, or pass dynamic variables.
            </p>
          </div>
          <CountryField
            direction="inbound"
            value={inboundCountries}
            disabled={settingsDisabled}
            onChange={setInboundCountries}
          />
          <div className="space-y-2">
            <label htmlFor="fallback-number" className="text-sm font-medium">
              Fallback number
            </label>
            <p id="fallback-help" className="text-xs leading-5 text-muted-foreground">
              Calls are forwarded here when no agent can answer — none is assigned, or the voice
              engine could not start.
            </p>
            <Input
              id="fallback-number"
              type="tel"
              value={fallback}
              disabled={settingsDisabled}
              onChange={(e) => setFallback(e.target.value)}
              placeholder="Not configured"
              aria-describedby="fallback-help"
              className="h-10 bg-background"
            />
          </div>
          <Button size="sm" disabled={busy} onClick={saveInbound}>
            {busy ? "Saving…" : "Save inbound settings"}
          </Button>
        </section>
        <section
          aria-labelledby="outbound-heading"
          className="space-y-5 border-b border-border p-5 sm:p-6"
        >
          <h2 id="outbound-heading" className="text-sm font-semibold">
            Outbound call agent
          </h2>
          <AgentRows
            direction="outbound"
            rows={outboundRows}
            agents={agents}
            abTesting={outboundAb}
            allowAb={canSave}
            disabled={settingsDisabled}
            onRows={setOutboundRows}
            onAbTesting={setOutboundAb}
          />
          <CountryField
            direction="outbound"
            value={outboundCountries}
            disabled={settingsDisabled}
            onChange={setOutboundCountries}
          />
          <Button size="sm" disabled={settingsDisabled} onClick={saveOutbound}>
            {busy ? "Saving…" : "Save outbound settings"}
          </Button>
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
