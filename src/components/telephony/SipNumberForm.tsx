import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface SipNumberInput {
  phoneNumber: string;
  terminationUri: string;
  sipUsername: string;
  sipPassword: string;
  nickname: string;
  agentId: string;
  direction: "inbound" | "outbound" | "both";
}

export function SipNumberForm({
  agents,
  loading,
  loadError,
  onRetry,
  onCancel,
  onSubmit,
  onBusyChange,
}: {
  agents: { id: string; name: string }[];
  loading: boolean;
  loadError: boolean;
  onRetry: () => void;
  onCancel: () => void;
  onSubmit: (input: SipNumberInput) => Promise<{ warning: string | null }>;
  onBusyChange: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [imported, setImported] = useState(false);
  const [warning, setWarning] = useState("");
  const [password, setPassword] = useState("");
  return (
    <section
      className="rounded-xl border border-border bg-card p-5 sm:p-6"
      aria-labelledby="sip-title"
    >
      <h2 id="sip-title" className="text-lg font-semibold">
        Connect SIP trunk
      </h2>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Bring an existing carrier number to your OmniVoice agent. This imports the number into
        Retell; it does not purchase a number or configure your carrier's trunk.
      </p>
      <form
        className="mt-6 max-w-2xl space-y-5"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy || imported) return;
          const values = new FormData(event.currentTarget);
          setBusy(true);
          onBusyChange(true);
          setError("");
          try {
            const result = await onSubmit({
              phoneNumber: String(values.get("phoneNumber")).trim(),
              terminationUri: String(values.get("terminationUri")).trim(),
              nickname: String(values.get("nickname")).trim(),
              sipUsername: String(values.get("sipUsername")).trim(),
              sipPassword: password,
              agentId: String(values.get("agentId")),
              direction: String(values.get("direction")) as SipNumberInput["direction"],
            });
            setImported(true);
            setWarning(result.warning ?? "");
          } catch (e) {
            setError(e instanceof Error ? e.message : "Import failed. Please try again.");
          } finally {
            setPassword("");
            setBusy(false);
            onBusyChange(false);
          }
        }}
      >
        <fieldset disabled={busy || imported} className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sip-phone">Phone number *</Label>
              <Input
                id="sip-phone"
                name="phoneNumber"
                type="tel"
                required
                pattern="\+[1-9][0-9]{6,14}"
                placeholder="+14155550100"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sip-name">Display name</Label>
              <Input id="sip-name" name="nickname" maxLength={100} placeholder="Reception" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="sip-uri">Carrier termination URI *</Label>
            <Input
              id="sip-uri"
              name="terminationUri"
              required
              maxLength={255}
              placeholder="your-trunk.pstn.twilio.com"
              aria-describedby="sip-uri-help"
            />
            <p id="sip-uri-help" className="text-xs text-muted-foreground">
              Use the SIP address provided by your carrier, not a website URL.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sip-user">SIP username (optional)</Label>
              <Input id="sip-user" name="sipUsername" autoComplete="off" maxLength={255} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sip-password">SIP password (optional)</Label>
              <Input
                id="sip-password"
                type="password"
                autoComplete="new-password"
                maxLength={1024}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Credentials are sent to the provider for import. They are not stored in this page or the
            workspace number record.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="sip-agent">OmniVoice agent *</Label>
              <select
                id="sip-agent"
                name="agentId"
                required
                defaultValue=""
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                disabled={loading || loadError}
              >
                <option value="">Select a deployed agent</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sip-direction">Call direction</Label>
              <select
                id="sip-direction"
                name="direction"
                defaultValue="both"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="both">Inbound and outbound</option>
                <option value="inbound">Inbound only</option>
                <option value="outbound">Outbound only</option>
              </select>
            </div>
          </div>
        </fieldset>
        {loading && (
          <p role="status" className="text-sm text-muted-foreground">
            Loading compatible agents…
          </p>
        )}
        {loadError && (
          <div role="alert">
            Could not load agents.{" "}
            <Button type="button" size="sm" variant="outline" onClick={onRetry}>
              Try again
            </Button>
          </div>
        )}
        {!loading && !loadError && !agents.length && (
          <p role="status" className="text-sm text-muted-foreground">
            Deploy an OmniVoice agent first. HyperStream numbers use the existing Twilio setup, not
            this SIP import.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {imported && (
          <p role="status" className="text-sm">
            {warning || "Number imported. Live connectivity has not been verified."}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            type="submit"
            disabled={busy || imported || loading || loadError || !agents.length}
          >
            {busy ? "Importing…" : "Import SIP number"}
          </Button>
          <Button size="sm" type="button" variant="outline" disabled={busy} onClick={onCancel}>
            {imported ? "Back to numbers" : "Cancel"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          After importing, verify carrier routing and perform an approved test call. Import success
          does not confirm a live connection.
        </p>
      </form>
    </section>
  );
}
