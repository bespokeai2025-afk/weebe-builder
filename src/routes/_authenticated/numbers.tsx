import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";
import { Phone, Search, Mic, MessageSquare, User, RefreshCw, ShieldCheck, Link2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { listPhoneNumbers } from "@/lib/telephony/telephony.functions";
import {
  previewVoiceNumberPrice,
  purchaseVoiceNumber,
  searchVoiceNumbers,
} from "@/lib/telephony/phone-provisioning.functions";
import { supabase } from "@/integrations/supabase/client";
import type { AvailableNumber } from "@/lib/telephony/twilio-numbers.server";
import { formatGbpPence } from "@/lib/telephony/format-price";

export const Route = createFileRoute("/_authenticated/numbers")({
  head: () => ({ meta: [{ title: "Phone Numbers — Webee" }] }),
  component: NumbersPage,
});

function NumbersPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listPhoneNumbers);
  const searchFn = useServerFn(searchVoiceNumbers);
  const previewFn = useServerFn(previewVoiceNumberPrice);
  const buyFn = useServerFn(purchaseVoiceNumber);

  const [country, setCountry] = useState("US");
  const [areaCode, setAreaCode] = useState("");
  const [tollFree, setTollFree] = useState(false);
  const [agentId, setAgentId] = useState("");
  const [confirmNumber, setConfirmNumber] = useState<AvailableNumber | null>(null);
  const countryInputRef = useRef<HTMLInputElement>(null);

  const { data: numbers = [], isFetching: numbersLoading, refetch: refetchNumbers } = useQuery({
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

  const searchMut = useMutation({
    mutationFn: () =>
      searchFn({ data: { country: country.toUpperCase(), areaCode: areaCode.trim() || undefined, tollFree, limit: 20 } }),
    onError: (e: unknown) => toast.error("Search failed", { description: (e as Error).message }),
  });

  const previewMut = useMutation({
    mutationFn: () => previewFn({ data: { country: country.toUpperCase(), tollFree } }),
  });

  function runSearch() {
    searchMut.mutate();
    previewMut.mutate();
  }

  const buyMut = useMutation({
    mutationFn: (n: AvailableNumber) =>
      buyFn({
        data: {
          phoneNumber: n.phoneNumber,
          friendlyName: n.friendlyName !== n.phoneNumber ? n.friendlyName : undefined,
          agentId: agentId || null,
          country: country.toUpperCase(),
          tollFree,
        },
      }),
    onSuccess: (result) => {
      toast.success("Number purchased", {
        description: `${result.phoneNumber} — ${formatGbpPence(result.priceGbpPence)}/month.`,
      });
      qc.invalidateQueries({ queryKey: ["phone-numbers"] });
      setConfirmNumber(null);
    },
    onError: (e: unknown) => {
      toast.error("Purchase failed", { description: (e as Error).message });
      setConfirmNumber(null);
    },
  });

  const results = searchMut.data ?? [];
  const previewPriceLabel = previewMut.isPending
    ? "Checking price…"
    : previewMut.data
      ? `${formatGbpPence(previewMut.data.priceGbpPence)}/month`
      : null;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-6 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand/15 text-brand">
          <Phone className="h-4 w-4" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Phone Numbers</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Get a WEBEE-managed phone number and connect it to an agent — no Twilio account needed.
          </p>
        </div>
      </div>

      <Card className="border-t-2 border-t-brand">
        <CardHeader>
          <CardTitle className="text-base">Get a number</CardTitle>
          <CardDescription>Search for an available number, then confirm to purchase it.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              runSearch();
            }}
          >
            {/* Search criteria — one grouped control cluster */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-[5rem_1fr_auto]">
              <div>
                <label htmlFor="numbers-country" className="mb-1 block text-xs font-medium text-muted-foreground">
                  Country
                </label>
                <input
                  id="numbers-country"
                  ref={countryInputRef}
                  value={country}
                  onChange={(e) => setCountry(e.target.value.toUpperCase().slice(0, 2))}
                  maxLength={2}
                  className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-sm uppercase focus:outline-none focus:ring-1 focus:ring-brand"
                />
              </div>
              <div>
                <label htmlFor="numbers-area-code" className="mb-1 block text-xs font-medium text-muted-foreground">
                  Area code
                </label>
                <input
                  id="numbers-area-code"
                  value={areaCode}
                  onChange={(e) => setAreaCode(e.target.value.replace(/\D/g, "").slice(0, 5))}
                  placeholder="Optional"
                  className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand"
                />
              </div>
              <label className="flex items-center gap-2 self-end pb-2 text-sm text-muted-foreground">
                <input type="checkbox" checked={tollFree} onChange={(e) => setTollFree(e.target.checked)} />
                Toll-free
              </label>
            </div>

            {/* Assignment — a related but distinct decision from the search criteria */}
            <div>
              <label htmlFor="numbers-agent" className="mb-1 block text-xs font-medium text-muted-foreground">
                Assign to agent
              </label>
              <select
                id="numbers-agent"
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand sm:max-w-xs"
              >
                <option value="">— Assign later —</option>
                {agents.map((a: { id: string; name: string }) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>

            <Button
              type="submit"
              disabled={searchMut.isPending}
              className="self-start gap-1.5 bg-brand text-brand-foreground shadow-none hover:bg-brand/90 hover:brightness-100"
            >
              <Search className="h-3.5 w-3.5" />
              {searchMut.isPending ? "Searching…" : "Search numbers"}
            </Button>
          </form>

          {previewPriceLabel && (
            <p className="text-xs text-muted-foreground">
              Numbers in this search: <span className="font-medium text-foreground">{previewPriceLabel}</span>
            </p>
          )}

          {searchMut.isSuccess && results.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No numbers matched. Try a different area code or country.
            </p>
          )}

          {results.length > 0 && (
            <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Number</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Capabilities</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((n: AvailableNumber) => (
                    <TableRow key={n.phoneNumber}>
                      <TableCell className="font-mono text-sm">{n.phoneNumber}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {[n.locality, n.region].filter(Boolean).join(", ") || "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 text-muted-foreground">
                          {n.capabilities.voice && <Mic className="h-3.5 w-3.5" aria-label="Voice" />}
                          {n.capabilities.sms && <MessageSquare className="h-3.5 w-3.5" aria-label="SMS" />}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" onClick={() => setConfirmNumber(n)}>
                          Buy
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Your numbers</CardTitle>
            <CardDescription>Numbers connected to this workspace.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetchNumbers()} disabled={numbersLoading}>
            <RefreshCw className={`h-3.5 w-3.5 ${numbersLoading ? "animate-spin" : ""}`} />
          </Button>
        </CardHeader>
        <CardContent>
          {numbers.length === 0 && !numbersLoading ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-5 py-8 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <Phone className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">No phone numbers yet</p>
                <p className="mt-1 text-xs text-muted-foreground">Search above to get your first WEBEE-managed number.</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  countryInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                  countryInputRef.current?.focus();
                }}
              >
                <Search className="h-3.5 w-3.5" />
                Search for a number
              </Button>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Number</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {numbers.map((n: any) => {
                    const webeeManaged = Boolean(n.twilio_subaccount_sid);
                    return (
                      <TableRow key={n.id}>
                        <TableCell className="font-mono text-sm">
                          {n.phone_number}
                          {n.friendly_name && (
                            <div className="text-xs text-muted-foreground">{n.friendly_name}</div>
                          )}
                        </TableCell>
                        <TableCell>
                          {webeeManaged ? (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <ShieldCheck className="h-3.5 w-3.5" /> WEBEE-managed
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <Link2 className="h-3.5 w-3.5" /> Imported
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <StatusBadge tone={n.is_active ? "success" : "neutral"}>
                            {n.is_active ? "Active" : "Inactive"}
                          </StatusBadge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {n.agent ? (
                            <span className="inline-flex items-center gap-1.5">
                              <User className="h-3.5 w-3.5 text-muted-foreground" /> {n.agent.name}
                            </span>
                          ) : (
                            <span className="text-xs italic text-muted-foreground">Unassigned</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-sm">
                          {formatGbpPence(n.price_gbp_pence_monthly)}
                          {n.price_gbp_pence_monthly != null && (
                            <span className="text-muted-foreground">/mo</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmNumber !== null} onOpenChange={(open) => { if (!open) setConfirmNumber(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm purchase</AlertDialogTitle>
            <AlertDialogDescription>
              Buy <span className="font-mono text-foreground">{confirmNumber?.phoneNumber}</span> for this workspace
              {previewMut.data ? (
                <> at <span className="font-medium text-foreground">{formatGbpPence(previewMut.data.priceGbpPence)}/month</span></>
              ) : null}
              . This charges your workspace on a recurring monthly basis and cannot be undone from here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={buyMut.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={buyMut.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (confirmNumber) buyMut.mutate(confirmNumber);
              }}
            >
              {buyMut.isPending ? "Purchasing…" : "Confirm purchase"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
