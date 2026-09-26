import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  Phone,
  Plus,
  Trash2,
  RefreshCw,
  Check,
  Mic,
  MessageSquare,
  Search,
  Download,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { PhoneNumberWorkspace } from "@/components/telephony/PhoneNumberWorkspace";
import {
  listPhoneNumbers,
  savePhoneNumber,
  deletePhoneNumber,
} from "@/lib/telephony/telephony.functions";
import {
  importVoiceNumber,
  purchaseVoiceNumber,
  searchVoiceNumbers,
} from "@/lib/telephony/phone-provisioning.functions";
import { supabase } from "@/integrations/supabase/client";
import { PhoneNumberDetail } from "@/components/telephony/PhoneNumberDetail";
import { assignVoiceNumberToAgent } from "@/lib/telephony/phone-provisioning.functions";

export const Route = createFileRoute("/_authenticated/phone-numbers")({
  validateSearch: (search: Record<string, unknown>): { numberId?: string } => ({
    numberId: typeof search.numberId === "string" ? search.numberId : undefined,
  }),
  head: () => ({ meta: [{ title: "Phone Numbers — Webee" }] }),
  component: PhoneNumbersPage,
});

function PhoneNumbersPage() {
  const { numberId } = Route.useSearch();
  const navigate = Route.useNavigate();
  const assignFn = useServerFn(assignVoiceNumberToAgent);
  const closeDetail = () => {
    void navigate({ search: {} });
  };
  const qc = useQueryClient();
  const listFn = useServerFn(listPhoneNumbers);
  const saveFn = useServerFn(savePhoneNumber);
  const deleteFn = useServerFn(deletePhoneNumber);
  const [showAdd, setShowAdd] = useState(false);
  const [showBuy, setShowBuy] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const {
    data: numbers = [],
    isFetching,
    isPending,
    error: loadError,
    refetch,
  } = useQuery({
    queryKey: ["phone-numbers"],
    queryFn: () => listFn({}),
    throwOnError: false,
  });

  const { data: agents = [] } = useQuery({
    queryKey: ["agents-list"],
    queryFn: async () => {
      const { data } = await supabase.from("agents").select("id, name").order("name");
      return data ?? [];
    },
    throwOnError: false,
  });

  const saveMut = useMutation({
    mutationFn: (v: Parameters<typeof saveFn>[0]["data"]) => saveFn({ data: v }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["phone-numbers"] });
      setShowAdd(false);
      setEditId(null);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["phone-numbers"] });
      setDeleting(null);
      closeDetail();
    },
  });

  const number = numberId ? numbers.find((n) => n.id === numberId) : numbers[0];

  function renderDetail() {
    if (isPending || loadError || !number)
      return (
        <div className="space-y-4 p-6">
          <Button size="sm" variant="outline" onClick={closeDetail}>
            Back to phone numbers
          </Button>
          <p role={loadError ? "alert" : "status"}>
            {isPending
              ? "Loading phone number…"
              : loadError
                ? "Could not load this phone number."
                : numberId
                  ? "Phone number not found in this workspace."
                  : "Add a phone number to configure its call settings."}
          </p>
          {loadError && (
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              Try again
            </Button>
          )}
        </div>
      );
    return (
      <PhoneNumberDetail
        embedded
        key={number.id}
        number={number}
        agents={agents}
        onBack={closeDetail}
        onRename={async (friendlyName) => {
          const capabilities = number.capabilities;
          if (
            !capabilities ||
            typeof capabilities !== "object" ||
            Array.isArray(capabilities) ||
            typeof capabilities.voice !== "boolean" ||
            typeof capabilities.sms !== "boolean"
          ) {
            throw new Error(
              "This number's capabilities need to be reviewed before its name can be updated.",
            );
          }
          await saveFn({
            data: {
              id: number.id,
              phone_number: number.phone_number,
              friendly_name: friendlyName,
              agent_id: number.agent_id,
              capabilities: { voice: capabilities.voice, sms: capabilities.sms },
            },
          });
          await qc.invalidateQueries({ queryKey: ["phone-numbers"] });
        }}
        onAssign={async (agentId) => {
          const result = await assignFn({ data: { phoneNumberId: number.id, agentId } });
          await qc.invalidateQueries({ queryKey: ["phone-numbers"] });
          return result.webhooksConfigured
            ? "Agent assignment saved and provider routing refreshed."
            : "Agent assignment saved. Provider routing was not refreshed; check your provider configuration before relying on inbound calls.";
        }}
      />
    );
  }

  return (
    <>
      <PhoneNumberWorkspace
        numbers={numbers}
        selectedId={number?.id}
        onSelect={(id) => {
          void navigate({ search: { numberId: id } });
        }}
        loading={isPending}
        error={!!loadError}
        actions={
          <>
            <Button size="sm" className="flex-1" onClick={() => setShowBuy(true)}>
              <Plus />
              Get a number
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Refresh phone numbers"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={isFetching ? "animate-spin" : ""} />
            </Button>
            <Button size="sm" variant="ghost" className="w-full" onClick={() => setShowAdd(true)}>
              Add manually
            </Button>
          </>
        }
        management={
          number ? (
            <>
              <p className="text-xs text-muted-foreground">Selected number</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setEditId(number.id)}>
                  Edit record
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => setDeleting(number.id)}
                >
                  <Trash2 />
                  Delete
                </Button>
              </div>
              {deleting === number.id && (
                <div className="space-y-2 rounded-lg border border-border p-3">
                  <p className="break-words text-xs">
                    Delete {number.phone_number} from this workspace?
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={deleteMut.isPending}
                      onClick={() => deleteMut.mutate(number.id)}
                    >
                      {deleteMut.isPending ? "Deleting…" : "Confirm"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={deleteMut.isPending}
                      onClick={() => setDeleting(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
              {deleteMut.error && (
                <p role="alert" className="text-xs text-destructive">
                  {deleteMut.error.message}
                </p>
              )}
            </>
          ) : undefined
        }
      >
        {renderDetail()}
      </PhoneNumberWorkspace>
      {showBuy && (
        <GetNumberDialog
          agents={agents}
          onClose={() => setShowBuy(false)}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ["phone-numbers"] });
            setShowBuy(false);
          }}
        />
      )}

      {(showAdd || editId) && (
        <AddNumberDialog
          existing={editId ? numbers.find((n: any) => n.id === editId) : undefined}
          agents={agents}
          onSave={(v) => saveMut.mutate(v as any)}
          onClose={() => {
            setShowAdd(false);
            setEditId(null);
          }}
          saving={saveMut.isPending}
        />
      )}
    </>
  );
}

/**
 * Buy a number from Twilio, or adopt one already in the account.
 *
 * Both paths wire the number to this app's inbound webhook server-side, which is
 * the step that makes a call actually reach an agent — a number added by hand in
 * the table has no routing until that happens.
 */
function GetNumberDialog({
  agents,
  onClose,
  onDone,
}: {
  agents: any[];
  onClose: () => void;
  onDone: () => void;
}) {
  const searchFn = useServerFn(searchVoiceNumbers);
  const buyFn = useServerFn(purchaseVoiceNumber);
  const importFn = useServerFn(importVoiceNumber);

  const [tab, setTab] = useState<"buy" | "import">("buy");
  const [country, setCountry] = useState("US");
  const [areaCode, setAreaCode] = useState("");
  const [tollFree, setTollFree] = useState(false);
  const [agentId, setAgentId] = useState("");
  const [importNumber, setImportNumber] = useState("");
  const [error, setError] = useState<string | null>(null);

  const searchMut = useMutation({
    mutationFn: () =>
      searchFn({
        data: {
          country,
          areaCode: areaCode.trim() || undefined,
          tollFree,
          limit: 20,
        },
      }),
    onError: (e: Error) => setError(e.message),
    onSuccess: () => setError(null),
  });

  const buyMut = useMutation({
    mutationFn: (phoneNumber: string) => buyFn({ data: { phoneNumber, agentId: agentId || null } }),
    onError: (e: Error) => setError(e.message),
    onSuccess: onDone,
  });

  const importMut = useMutation({
    mutationFn: () =>
      importFn({ data: { phoneNumber: importNumber.trim(), agentId: agentId || null } }),
    onError: (e: Error) => setError(e.message),
    onSuccess: onDone,
  });

  const results = searchMut.data ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-xl border border-border bg-card p-6 shadow-2xl">
        <h2 className="text-base font-semibold">Get a Phone Number</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Numbers are provisioned on Twilio and pointed at this workspace automatically.
        </p>

        <div className="mt-4 flex gap-1 rounded-lg bg-muted/40 p-1">
          {(["buy", "import"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTab(t);
                setError(null);
              }}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                tab === t ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "buy" ? "Search & Buy" : "Import Existing"}
            </button>
          ))}
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Assign to Agent
          </label>
          <select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">— Assign later —</option>
            {agents.map((a: any) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>

        {tab === "buy" ? (
          <>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div className="w-24">
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Country
                </label>
                <input
                  value={country}
                  onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))}
                  className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-sm uppercase focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="w-32">
                <label className="mb-1 block text-xs font-medium text-muted-foreground">
                  Area Code
                </label>
                <input
                  value={areaCode}
                  onChange={(e) => setAreaCode(e.target.value.replace(/\D/g, "").slice(0, 5))}
                  placeholder="415"
                  className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2 pb-2">
                <input
                  type="checkbox"
                  checked={tollFree}
                  onChange={(e) => setTollFree(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm">Toll-free</span>
              </label>
              <Button
                size="sm"
                variant="outline"
                onClick={() => searchMut.mutate()}
                disabled={searchMut.isPending || country.length !== 2}
              >
                <Search className="h-3.5 w-3.5" />
                {searchMut.isPending ? "Searching…" : "Search"}
              </Button>
            </div>

            {results.length > 0 && (
              <div className="mt-4 max-h-64 overflow-y-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-border">
                    {results.map((n: any) => (
                      <tr key={n.phoneNumber} className="hover:bg-muted/20">
                        <td className="px-3 py-2 font-mono">{n.phoneNumber}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {[n.locality, n.region].filter(Boolean).join(", ") || n.isoCountry}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex gap-1">
                            {n.capabilities.voice && <Mic className="h-3.5 w-3.5 text-primary" />}
                            {n.capabilities.sms && (
                              <MessageSquare className="h-3.5 w-3.5 text-primary" />
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            size="sm"
                            onClick={() => buyMut.mutate(n.phoneNumber)}
                            disabled={buyMut.isPending}
                          >
                            {buyMut.isPending && buyMut.variables === n.phoneNumber
                              ? "Buying…"
                              : "Buy"}
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {searchMut.isSuccess && results.length === 0 && (
              <p className="mt-4 text-sm text-muted-foreground">
                No numbers matched. Try a different area code or country.
              </p>
            )}
          </>
        ) : (
          <div className="mt-3 flex items-end gap-3">
            <div className="flex-1">
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                E.164 Number
              </label>
              <input
                value={importNumber}
                onChange={(e) => setImportNumber(e.target.value)}
                placeholder="+14155552671"
                className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <Button
              size="sm"
              onClick={() => importMut.mutate()}
              disabled={importMut.isPending || !importNumber.trim()}
            >
              <Download className="h-3.5 w-3.5" />
              {importMut.isPending ? "Importing…" : "Import"}
            </Button>
          </div>
        )}

        {error && (
          <p className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end">
          <Button size="sm" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

function AddNumberDialog({
  existing,
  agents,
  onSave,
  onClose,
  saving,
}: {
  existing?: any;
  agents: any[];
  onSave: (v: any) => void;
  onClose: () => void;
  saving: boolean;
}) {
  const [phone, setPhone] = useState(existing?.phone_number ?? "");
  const [friendly, setFriendly] = useState(existing?.friendly_name ?? "");
  const [agentId, setAgentId] = useState(existing?.agent_id ?? "");
  const [provider, setProvider] = useState<"twilio" | "frejun">(existing?.provider ?? "twilio");
  const [voice, setVoice] = useState(existing?.capabilities?.voice ?? true);
  const [sms, setSms] = useState(existing?.capabilities?.sms ?? false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    onSave({
      ...(existing?.id ? { id: existing.id } : {}),
      phone_number: phone.trim(),
      friendly_name: friendly.trim() || undefined,
      provider,
      agent_id: agentId || null,
      capabilities: { voice, sms },
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl"
      >
        <h2 className="mb-4 text-base font-semibold">
          {existing ? "Edit Number" : "Add Phone Number"}
        </h2>
        <div className="flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              E.164 Number *
            </label>
            <input
              required
              disabled={!!existing}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+14155552671"
              className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Friendly Name
            </label>
            <input
              value={friendly}
              onChange={(e) => setFriendly(e.target.value)}
              placeholder="Sales Hotline"
              className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Assign Agent
            </label>
            <select
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">— None —</option>
              {agents.map((a: any) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Provider</label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as "twilio" | "frejun")}
              disabled={!!existing}
              className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60"
            >
              <option value="twilio">Twilio</option>
              <option value="frejun">FreJun Teler</option>
            </select>
            {provider === "frejun" && !existing && (
              <p className="mt-1 text-xs text-muted-foreground">
                Purchase numbers in your{" "}
                <a
                  href="https://app.frejun.ai"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  FreJun dashboard
                </a>
                , assign them to a Voice App there, then enter the number above.
              </p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Capabilities
            </label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={voice}
                  onChange={(e) => setVoice(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm">Voice</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sms}
                  onChange={(e) => setSms(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm">SMS</span>
              </label>
            </div>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button size="sm" type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" type="submit" disabled={saving || !phone.trim()}>
            {saving ? "Saving…" : existing ? "Save Changes" : "Add Number"}
          </Button>
        </div>
      </form>
    </div>
  );
}
