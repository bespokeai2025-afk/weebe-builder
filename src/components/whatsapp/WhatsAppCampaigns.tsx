import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Megaphone, Clock, CheckCircle2, AlertCircle, PlayCircle, Rocket, Loader2, Upload, FileSpreadsheet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RelativeTime } from "@/components/ui/relative-time";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  listWACampaigns, createWACampaign, deleteWACampaign, listWATemplates, launchWACampaign,
  importWatiCampaignLeadsCsv,
} from "@/lib/dashboard/whatsapp.functions";
import { getWatiConnection, listWatiTemplates } from "@/lib/whatsapp/wati.functions";
import {
  autoDetectCsvColumnMapping,
  mapCsvRowsToLeads,
  parseCsvText,
  type CsvColumnMapping,
} from "@/lib/whatsapp/csv-leads.shared";
import { toast } from "sonner";

const TYPE_LABELS: Record<string, string> = {
  broadcast: "Broadcast",
  follow_up: "Follow-up",
  scheduled: "Scheduled",
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof AlertCircle }> = {
  draft:     { label: "Draft",     color: "secondary",    icon: AlertCircle },
  scheduled: { label: "Scheduled", color: "outline",      icon: Clock },
  running:   { label: "Running",   color: "default",      icon: PlayCircle },
  active:    { label: "Running",   color: "default",      icon: PlayCircle },
  completed: { label: "Completed", color: "secondary",    icon: CheckCircle2 },
  failed:    { label: "Failed",    color: "destructive",  icon: AlertCircle },
};

const LEAD_PARAM_FIELDS: Array<{ value: string; label: string }> = [
  { value: "full_name", label: "Full Name" },
  { value: "phone", label: "Phone" },
  { value: "email", label: "Email" },
  { value: "company_name", label: "Company" },
  { value: "call_summary", label: "Call Summary" },
  { value: "next_action", label: "Next Action" },
  { value: "source", label: "Source" },
  { value: "notes", label: "Notes" },
];

type AudienceMode = "filters" | "csv";

type CampaignForm = {
  name: string;
  type: "broadcast" | "follow_up" | "scheduled";
  template_id: string;
  scheduled_at: string;
  wati_template_name: string;
  wati_broadcast_name: string;
  template_params: Record<string, string>;
  audienceMode: AudienceMode;
  audience: {
    qualification_status: string;
    pipeline_stage: string;
    status: string;
    whatsapp_opt_in_only: boolean;
  };
};

function emptyForm(): CampaignForm {
  return {
    name: "",
    type: "broadcast",
    template_id: "",
    scheduled_at: "",
    wati_template_name: "",
    wati_broadcast_name: "",
    template_params: {},
    audienceMode: "csv",
    audience: {
      qualification_status: "",
      pipeline_stage: "",
      status: "",
      whatsapp_opt_in_only: true,
    },
  };
}

function watiTemplateParamSlots(components: unknown): string[] {
  const comps = Array.isArray(components) ? components : [];
  const slots = new Set<string>();
  for (const c of comps) {
    const text = (c as { text?: string; body?: string })?.text ?? (c as { body?: string })?.body ?? "";
    const matches = String(text).match(/\{\{(\d+)\}\}/g) ?? [];
    for (const m of matches) slots.add(m.replace(/\{\{|\}\}/g, ""));
  }
  return [...slots].sort((a, b) => Number(a) - Number(b));
}

function buildAudienceFilter(form: CampaignForm, csvLeadIds: string[]) {
  if (form.audienceMode === "csv") {
    if (csvLeadIds.length === 0) return undefined;
    return {
      lead_ids: csvLeadIds,
      whatsapp_opt_in_only: form.audience.whatsapp_opt_in_only,
    };
  }
  const f = form.audience;
  const filter: Record<string, unknown> = {};
  if (f.qualification_status) filter.qualification_status = f.qualification_status;
  if (f.pipeline_stage) filter.pipeline_stage = f.pipeline_stage;
  if (f.status) filter.status = f.status;
  if (f.whatsapp_opt_in_only) filter.whatsapp_opt_in_only = true;
  return Object.keys(filter).length ? filter : undefined;
}

export function WhatsAppCampaigns() {
  const qc = useQueryClient();
  const listFn        = useServerFn(listWACampaigns);
  const createFn      = useServerFn(createWACampaign);
  const deleteFn      = useServerFn(deleteWACampaign);
  const tmplFn        = useServerFn(listWATemplates);
  const launchFn      = useServerFn(launchWACampaign);
  const watiConnFn    = useServerFn(getWatiConnection);
  const watiListFn    = useServerFn(listWatiTemplates);
  const importCsvFn   = useServerFn(importWatiCampaignLeadsCsv);
  const csvInputRef   = useRef<HTMLInputElement>(null);

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ["wa-campaigns"],
    queryFn: () => listFn(),
    throwOnError: false,
  });
  const { data: templates = [] } = useQuery({
    queryKey: ["wa-templates"],
    queryFn: () => tmplFn(),
    throwOnError: false,
  });

  const { data: watiConn } = useQuery({
    queryKey: ["wati-connection"],
    queryFn: () => watiConnFn(),
    throwOnError: false,
  });
  const watiConnected = !!watiConn && watiConn.status === "connected";

  const { data: watiTemplates = [] } = useQuery({
    queryKey: ["wati-templates"],
    queryFn: () => watiListFn(),
    enabled: watiConnected,
    throwOnError: false,
  });

  const [open, setOpen]           = useState(false);
  const [deleteId, setDeleteId]   = useState<string | null>(null);
  const [launchId, setLaunchId]   = useState<string | null>(null);
  const [launchCampaign, setLaunchCampaign] = useState<any>(null);
  const [form, setForm]           = useState(emptyForm());
  const [csvLeadIds, setCsvLeadIds] = useState<string[]>([]);
  const [csvStats, setCsvStats] = useState<{ inserted: number; updated: number; skipped: number; total: number } | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [csvMapping, setCsvMapping] = useState<CsvColumnMapping | null>(null);
  const [csvNeedsMapping, setCsvNeedsMapping] = useState(false);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);

  function resetCsvState() {
    setCsvLeadIds([]);
    setCsvStats(null);
    setCsvHeaders([]);
    setCsvRows([]);
    setCsvMapping(null);
    setCsvNeedsMapping(false);
    setCsvFileName(null);
    if (csvInputRef.current) csvInputRef.current.value = "";
  }

  function openCreateDialog() {
    setForm(emptyForm());
    resetCsvState();
    setOpen(true);
  }

  const selectedWatiTemplate = (watiTemplates as any[]).find((t) => t.name === form.wati_template_name);
  const paramSlots = selectedWatiTemplate ? watiTemplateParamSlots(selectedWatiTemplate.components) : [];

  const create = useMutation({
    mutationFn: () => {
      const audience_filter = buildAudienceFilter(form, csvLeadIds);
      const template_params = Object.keys(form.template_params).length ? form.template_params : undefined;
      return createFn({
        data: {
          name: form.name,
          type: form.type,
          template_id: !watiConnected ? form.template_id || undefined : undefined,
          scheduled_at: form.scheduled_at || undefined,
          provider: watiConnected ? "wati" : undefined,
          wati_template_name: watiConnected ? form.wati_template_name || undefined : undefined,
          wati_broadcast_name: watiConnected ? (form.wati_broadcast_name || form.name) : undefined,
          template_params,
          audience_filter,
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wa-campaigns"] });
      qc.invalidateQueries({ queryKey: ["leads-all"] });
      setOpen(false);
      setForm(emptyForm());
      resetCsvState();
      toast.success("Campaign created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const del = useMutation({
    mutationFn: () => deleteFn({ data: { id: deleteId! } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wa-campaigns"] });
      setDeleteId(null);
      toast.success("Campaign deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const launch = useMutation({
    mutationFn: () => launchFn({ data: { id: launchId! } }),
    onSuccess: (res: { sent?: number; failed?: number }) => {
      qc.invalidateQueries({ queryKey: ["wa-campaigns"] });
      setLaunchId(null);
      setLaunchCampaign(null);
      toast.success(`Campaign launched — ${res.sent ?? 0} sent, ${res.failed ?? 0} failed`);
    },
    onError: (e: Error) => {
      setLaunchId(null);
      setLaunchCampaign(null);
      toast.error(e.message);
    },
  });

  const canCreate =
    !!form.name &&
    (watiConnected
      ? !!form.wati_template_name &&
        (form.audienceMode === "filters" || csvLeadIds.length > 0)
      : true);

  async function handleCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const { headers, rows } = parseCsvText(text);
      const mapping = autoDetectCsvColumnMapping(headers);
      setCsvHeaders(headers);
      setCsvRows(rows);
      setCsvMapping(mapping ?? { phone: headers[0] ?? "" });
      setCsvNeedsMapping(!mapping);
      setCsvFileName(file.name);
      setCsvLeadIds([]);
      setCsvStats(null);
      if (mapping) {
        await runCsvImport(rows, mapping);
      } else {
        toast.message("Choose which column is the phone number", {
          description: `${rows.length} rows parsed from ${file.name}`,
        });
      }
    } catch (err) {
      toast.error("Could not parse CSV", { description: (err as Error).message });
      resetCsvState();
    }
    if (csvInputRef.current) csvInputRef.current.value = "";
  }

  async function runCsvImport(rows: Record<string, string>[], mapping: CsvColumnMapping) {
    if (!mapping.phone) {
      toast.error("Select a phone column");
      return;
    }
    const leads = mapCsvRowsToLeads(rows, mapping);
    if (leads.length === 0) {
      toast.error("No valid phone numbers found in CSV");
      return;
    }
    setCsvImporting(true);
    try {
      const result = await importCsvFn({ data: { rows: leads } });
      setCsvLeadIds(result.leadIds ?? []);
      setCsvStats({
        inserted: result.inserted ?? 0,
        updated: result.updated ?? 0,
        skipped: result.skipped ?? 0,
        total: result.total ?? 0,
      });
      toast.success(`Imported ${result.total} leads for this campaign`, {
        description: `${result.inserted} new · ${result.updated} updated · ${result.skipped} skipped`,
      });
    } catch (err) {
      toast.error("CSV import failed", { description: (err as Error).message });
    } finally {
      setCsvImporting(false);
    }
  }

  async function applyCsvMapping() {
    if (!csvMapping?.phone || csvRows.length === 0) return;
    await runCsvImport(csvRows, csvMapping);
  }

  function openLaunchDialog(c: any) {
    setLaunchId(c.id);
    setLaunchCampaign(c);
  }

  function templateLabel(c: any) {
    if (c.wati_template_name) return c.wati_template_name;
    return c.whatsapp_templates?.name ?? "—";
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            {watiConnected
              ? "Launch WATI template campaigns to leads from Webee."
              : "Create and manage broadcast campaigns (Twilio or connect WATI in Settings)."}
          </p>
          {watiConnected && (
            <p className="text-[11px] text-muted-foreground/70 mt-1">
              Upload a CSV audience or filter existing leads. Sync WATI templates under Templates first.
            </p>
          )}
        </div>
        <Button size="sm" onClick={openCreateDialog} className="gap-1.5 shrink-0">
          <Plus className="h-3.5 w-3.5" /> New Campaign
        </Button>
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
      ) : (campaigns as any[]).length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
          <Megaphone className="h-10 w-10 opacity-30" />
          <p className="text-sm font-medium">No campaigns yet</p>
          <p className="text-xs text-center max-w-sm">
            {watiConnected
              ? "Create a campaign, upload a CSV audience or filter leads, map template variables, and launch."
              : "Create a campaign to send messages to contacts."}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                {["Name", "Type", "Template", "Provider", "Status", "Sent", "Replied", "Created", ""].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {(campaigns as any[]).map((c: any) => {
                const sc = STATUS_CONFIG[c.status] ?? STATUS_CONFIG.draft;
                const Icon = sc.icon;
                const stats = c.stats ?? {};
                const isDraft = c.status === "draft" || c.status === "scheduled";
                return (
                  <tr key={c.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5 font-medium">{c.name}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className="text-[10px]">{TYPE_LABELS[c.type] ?? c.type}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{templateLabel(c)}</td>
                    <td className="px-4 py-2.5">
                      <Badge variant="outline" className="text-[10px] uppercase">{c.provider ?? "twilio"}</Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge variant={sc.color as "secondary" | "outline" | "default" | "destructive"} className="gap-1 text-[10px]">
                        <Icon className="h-3 w-3" />{sc.label}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-xs tabular-nums">{stats.sent ?? 0}</td>
                    <td className="px-4 py-2.5 text-xs tabular-nums">{stats.replied ?? 0}</td>
                    <td className="px-4 py-2.5 text-[11px] text-muted-foreground">
                      <RelativeTime date={c.created_at} />
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1">
                        {isDraft && (
                          <Button
                            variant="ghost" size="icon" className="h-7 w-7 text-green-500 hover:text-green-400"
                            title="Launch campaign"
                            onClick={() => openLaunchDialog(c)}
                          >
                            <Rocket className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => setDeleteId(c.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Campaign</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Campaign Name *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value, wati_broadcast_name: e.target.value })}
                placeholder="e.g. Summer Promo 2026"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Type</Label>
              <Select value={form.type} onValueChange={(v: CampaignForm["type"]) => setForm({ ...form, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="broadcast">Broadcast — send to lead audience</SelectItem>
                  <SelectItem value="follow_up">Follow-up</SelectItem>
                  <SelectItem value="scheduled">Scheduled</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {watiConnected ? (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">WATI Template *</Label>
                  <Select
                    value={form.wati_template_name}
                    onValueChange={(v) => setForm({ ...form, wati_template_name: v, template_params: {} })}
                  >
                    <SelectTrigger><SelectValue placeholder="Choose approved template…" /></SelectTrigger>
                    <SelectContent>
                      {(watiTemplates as any[])
                        .filter((t) => !t.status || String(t.status).toLowerCase() === "approved")
                        .map((t) => (
                          <SelectItem key={t.id} value={t.name}>{t.name}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                {paramSlots.length > 0 && (
                  <div className="space-y-2 rounded-md border border-border/60 p-3">
                    <Label className="text-xs">Template variable mapping</Label>
                    {paramSlots.map((slot) => (
                      <div key={slot} className="flex items-center gap-2">
                        <span className="text-[10px] text-muted-foreground w-8">{`{{${slot}}}`}</span>
                        <Select
                          value={form.template_params[slot] ?? ""}
                          onValueChange={(v) =>
                            setForm({
                              ...form,
                              template_params: { ...form.template_params, [slot]: v },
                            })
                          }
                        >
                          <SelectTrigger className="h-8 text-xs flex-1">
                            <SelectValue placeholder="Lead field…" />
                          </SelectTrigger>
                          <SelectContent>
                            {LEAD_PARAM_FIELDS.map((f) => (
                              <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-2 rounded-md border border-border/60 p-3">
                  <Label className="text-xs">Audience</Label>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={form.audienceMode === "csv" ? "default" : "outline"}
                      className="h-7 text-xs flex-1"
                      onClick={() => setForm({ ...form, audienceMode: "csv" })}
                    >
                      <Upload className="h-3 w-3 mr-1" /> CSV upload
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={form.audienceMode === "filters" ? "default" : "outline"}
                      className="h-7 text-xs flex-1"
                      onClick={() => setForm({ ...form, audienceMode: "filters" })}
                    >
                      Filter leads
                    </Button>
                  </div>

                  {form.audienceMode === "csv" ? (
                    <div className="space-y-2 pt-1">
                      <input
                        ref={csvInputRef}
                        type="file"
                        accept=".csv,text/csv"
                        className="hidden"
                        onChange={handleCsvFile}
                      />
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs gap-1.5 flex-1"
                          disabled={csvImporting}
                          onClick={() => csvInputRef.current?.click()}
                        >
                          {csvImporting ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <FileSpreadsheet className="h-3.5 w-3.5" />
                          )}
                          {csvFileName ? "Replace CSV" : "Upload CSV"}
                        </Button>
                        {csvFileName && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            onClick={resetCsvState}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                      {csvFileName && (
                        <p className="text-[10px] text-muted-foreground truncate">{csvFileName}</p>
                      )}
                      {csvRows.length > 0 && csvNeedsMapping && csvMapping && (
                        <div className="space-y-1.5 rounded border border-border/40 p-2">
                          <p className="text-[10px] text-muted-foreground">Map columns</p>
                          <Select
                            value={csvMapping.phone}
                            onValueChange={(v) => setCsvMapping({ ...csvMapping, phone: v })}
                          >
                            <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Phone column *" /></SelectTrigger>
                            <SelectContent>
                              {csvHeaders.map((h) => (
                                <SelectItem key={h} value={h}>{h}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Select
                            value={csvMapping.full_name ?? "__none__"}
                            onValueChange={(v) =>
                              setCsvMapping({
                                ...csvMapping,
                                full_name: v === "__none__" ? undefined : v,
                              })
                            }
                          >
                            <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="Name column (optional)" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">— None —</SelectItem>
                              {csvHeaders.map((h) => (
                                <SelectItem key={h} value={h}>{h}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            type="button"
                            size="sm"
                            className="h-7 text-xs w-full"
                            disabled={csvImporting || !csvMapping.phone}
                            onClick={() => applyCsvMapping()}
                          >
                            Import {csvRows.length} rows
                          </Button>
                        </div>
                      )}
                      {csvStats && (
                        <div className="rounded-md bg-green-500/10 border border-green-500/20 px-2.5 py-2 text-xs text-green-700 dark:text-green-400">
                          <strong>{csvStats.total}</strong> leads ready
                          <span className="text-muted-foreground ml-1">
                            ({csvStats.inserted} new, {csvStats.updated} matched)
                          </span>
                        </div>
                      )}
                      <p className="text-[10px] text-muted-foreground leading-relaxed">
                        CSV needs a phone column. Optional: name, email, company, notes. Duplicates are merged by phone.
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <Input
                          placeholder="Status (optional)"
                          value={form.audience.status}
                          onChange={(e) =>
                            setForm({ ...form, audience: { ...form.audience, status: e.target.value } })
                          }
                          className="h-8 text-xs"
                        />
                        <Input
                          placeholder="Pipeline stage (optional)"
                          value={form.audience.pipeline_stage}
                          onChange={(e) =>
                            setForm({ ...form, audience: { ...form.audience, pipeline_stage: e.target.value } })
                          }
                          className="h-8 text-xs"
                        />
                        <Input
                          placeholder="Qualification (optional)"
                          value={form.audience.qualification_status}
                          onChange={(e) =>
                            setForm({ ...form, audience: { ...form.audience, qualification_status: e.target.value } })
                          }
                          className="h-8 text-xs col-span-2"
                        />
                      </div>
                    </>
                  )}
                  <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                    <Checkbox
                      checked={form.audience.whatsapp_opt_in_only}
                      onCheckedChange={(v) =>
                        setForm({
                          ...form,
                          audience: { ...form.audience, whatsapp_opt_in_only: v === true },
                        })
                      }
                    />
                    Only leads with WhatsApp opt-in
                  </label>
                </div>
              </>
            ) : (
              <div className="space-y-1.5">
                <Label className="text-xs">Template (optional)</Label>
                <Select value={form.template_id} onValueChange={(v) => setForm({ ...form, template_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Choose a template…" /></SelectTrigger>
                  <SelectContent>
                    {(templates as any[]).map((t: any) => (
                      <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {form.type === "scheduled" && (
              <div className="space-y-1.5">
                <Label className="text-xs">Schedule Date & Time</Label>
                <Input
                  type="datetime-local"
                  value={form.scheduled_at}
                  onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={() => create.mutate()} disabled={!canCreate || create.isPending}>
              {create.isPending ? "Creating…" : "Create Campaign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete campaign?</AlertDialogTitle>
            <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => del.mutate()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!launchId} onOpenChange={(o) => { if (!o) { setLaunchId(null); setLaunchCampaign(null); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Rocket className="h-4 w-4 text-green-500" /> Launch campaign?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {launchCampaign?.audience_filter?.lead_ids?.length
                ? `This sends "${launchCampaign?.wati_template_name ?? "template"}" to ${launchCampaign.audience_filter.lead_ids.length} CSV-imported leads.`
                : launchCampaign?.provider === "wati" || launchCampaign?.wati_template_name
                  ? `This sends the WATI template "${launchCampaign?.wati_template_name ?? "template"}" to all matching leads with phone numbers.`
                  : "This sends the campaign template to opted-in WhatsApp contacts via Twilio."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={launch.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => launch.mutate()}
              disabled={launch.isPending}
              className="bg-green-600 text-white hover:bg-green-700"
            >
              {launch.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  Launching…
                </>
              ) : (
                "Launch Now"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
