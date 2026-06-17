import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listProviderRecharges,
  recordProviderRecharge,
} from "@/lib/accountsmind/accountsmind.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Zap, Plus, RefreshCw } from "lucide-react";

const PROVIDERS = [
  { cat: "llm",       name: "OpenAI" },
  { cat: "llm",       name: "Anthropic" },
  { cat: "llm",       name: "Gemini" },
  { cat: "voice",     name: "ElevenLabs" },
  { cat: "voice",     name: "WEBEE Voice" },
  { cat: "telephony", name: "Twilio" },
  { cat: "telephony", name: "FreJun" },
  { cat: "whatsapp",  name: "WATI" },
  { cat: "whatsapp",  name: "Meta" },
  { cat: "email",     name: "Resend" },
  { cat: "email",     name: "SendGrid" },
  { cat: "video",     name: "Veo / Google" },
  { cat: "video",     name: "Runway" },
  { cat: "payment",   name: "Stripe" },
  { cat: "other",     name: "Other" },
];

interface RechargeForm {
  providerCategory: string;
  providerName:     string;
  amountCents:      number;
  currency:         string;
  eventType:        string;
  description:      string;
  detectedAt:       string;
}

const DEFAULTS: RechargeForm = {
  providerCategory: "llm",
  providerName:     "OpenAI",
  amountCents:      0,
  currency:         "GBP",
  eventType:        "manual",
  description:      "",
  detectedAt:       new Date().toISOString().split("T")[0],
};

export function AccountsMindRecharges() {
  const listFn   = useServerFn(listProviderRecharges);
  const recordFn = useServerFn(recordProviderRecharge);
  const qc       = useQueryClient();

  const [open, setOpen]   = useState(false);
  const [form, setForm]   = useState<RechargeForm>(DEFAULTS);
  const [saving, setSaving] = useState(false);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["accountsmind-recharges"],
    queryFn:  () => listFn({ data: {} }),
  });

  const save = async () => {
    setSaving(true);
    try {
      await recordFn({ data: { ...form, workspaceId: null } });
      qc.invalidateQueries({ queryKey: ["accountsmind-recharges"] });
      setOpen(false);
      setForm(DEFAULTS);
    } finally {
      setSaving(false);
    }
  };

  const field = <K extends keyof RechargeForm>(key: K, val: RechargeForm[K]) =>
    setForm((f) => ({ ...f, [key]: val }));

  const selectProvider = (name: string) => {
    const found = PROVIDERS.find((p) => p.name === name);
    setForm((f) => ({ ...f, providerName: name, providerCategory: found?.cat ?? "other" }));
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Zap className="w-5 h-5 text-yellow-400" /> Provider Recharges
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">Track credit top-ups and billing events across providers</p>
        </div>
        <Button
          size="sm"
          onClick={() => setOpen(true)}
          className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
        >
          <Plus className="w-3.5 h-3.5" /> Record Recharge
        </Button>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <RefreshCw className="w-4 h-4 animate-spin" /> Loading…
        </div>
      )}

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {(rows as any[]).length === 0 && !isLoading && (
          <div className="p-6 text-center text-sm text-gray-500">
            No recharge events recorded yet. Click "Record Recharge" to add one.
          </div>
        )}
        {(rows as any[]).map((r: any) => (
          <div
            key={r.id}
            className="flex items-center gap-4 px-4 py-3 border-b border-gray-800/70 last:border-0"
          >
            <div className="w-8 h-8 rounded-lg bg-yellow-500/10 flex items-center justify-center">
              <Zap className="w-4 h-4 text-yellow-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-white">{r.provider_name}</div>
              <div className="text-xs text-gray-500">
                {r.provider_category} · {r.event_type} · {new Date(r.detected_at).toLocaleDateString()}
              </div>
              {r.description && (
                <div className="text-xs text-gray-400 mt-0.5 truncate">{r.description}</div>
              )}
            </div>
            <div className="text-right">
              <div className="text-base font-semibold text-yellow-400">
                {r.currency === "GBP" ? "£" : r.currency === "EUR" ? "€" : "$"}
                {(r.amount_cents / 100).toFixed(2)}
              </div>
              <div className="text-[10px] text-gray-500 uppercase">{r.source}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Record dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bg-gray-900 border-gray-700 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-yellow-400" /> Record Provider Recharge
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <Label className="text-xs text-gray-400">Provider</Label>
              <Select value={form.providerName} onValueChange={selectProvider}>
                <SelectTrigger className="mt-1 bg-gray-800 border-gray-700 text-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-gray-800 border-gray-700">
                  {PROVIDERS.map((p) => (
                    <SelectItem key={`${p.cat}-${p.name}`} value={p.name}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-gray-400">Amount (pence)</Label>
                <Input
                  type="number"
                  value={form.amountCents}
                  onChange={(e) => field("amountCents", Number(e.target.value))}
                  className="mt-1 bg-gray-800 border-gray-700 text-white"
                  placeholder="e.g. 10000 = £100"
                />
                <p className="text-[10px] text-gray-500 mt-1">
                  = {form.currency === "GBP" ? "£" : "$"}{(form.amountCents / 100).toFixed(2)}
                </p>
              </div>
              <div>
                <Label className="text-xs text-gray-400">Currency</Label>
                <Select value={form.currency} onValueChange={(v) => field("currency", v)}>
                  <SelectTrigger className="mt-1 bg-gray-800 border-gray-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-800 border-gray-700">
                    <SelectItem value="GBP">GBP (£)</SelectItem>
                    <SelectItem value="USD">USD ($)</SelectItem>
                    <SelectItem value="EUR">EUR (€)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-gray-400">Event Type</Label>
                <Select value={form.eventType} onValueChange={(v) => field("eventType", v)}>
                  <SelectTrigger className="mt-1 bg-gray-800 border-gray-700 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-800 border-gray-700">
                    <SelectItem value="manual">Manual Entry</SelectItem>
                    <SelectItem value="auto_recharge">Auto Recharge</SelectItem>
                    <SelectItem value="top_up">Top-Up</SelectItem>
                    <SelectItem value="subscription">Subscription</SelectItem>
                    <SelectItem value="overage">Overage Charge</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-gray-400">Date</Label>
                <Input
                  type="date"
                  value={form.detectedAt}
                  onChange={(e) => field("detectedAt", e.target.value)}
                  className="mt-1 bg-gray-800 border-gray-700 text-white"
                />
              </div>
            </div>

            <div>
              <Label className="text-xs text-gray-400">Notes</Label>
              <Textarea
                value={form.description}
                onChange={(e) => field("description", e.target.value)}
                className="mt-1 bg-gray-800 border-gray-700 text-white text-sm"
                rows={2}
                placeholder="Optional notes about this recharge"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setOpen(false)} className="border-gray-700 text-gray-300">
                Cancel
              </Button>
              <Button onClick={save} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700">
                {saving ? "Saving…" : "Save Recharge"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
