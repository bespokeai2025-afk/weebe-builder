import { useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Trash2,
  Megaphone,
  Clock,
  CheckCircle2,
  AlertCircle,
  PlayCircle,
  Rocket,
  Loader2,
  Upload,
  FileSpreadsheet,
  X,
  Users,
  Calendar,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { RelativeTime } from "@/components/ui/relative-time";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  listWACampaigns,
  createWACampaign,
  deleteWACampaign,
  listWATemplates,
  launchWACampaign,
  importWatiCampaignLeadsCsv,
  prepareCampaignAudienceFromContacts,
  listWAContacts,
  getBuzzchatOpsDashboard,
  checkCampaignAudienceOverlapFn,
} from "@/lib/dashboard/whatsapp.functions";
import {
  getWatiConnection,
  listWatiTemplates,
  getWatiWarmupDashboard,
} from "@/lib/whatsapp/wati.functions";
import {
  autoDetectCsvColumnMapping,
  csvScanRowCount,
  loadCsvSkipForFile,
  mapCsvRowsToLeads,
  parseCsvText,
  readCsvFileHead,
  saveCsvSkipForFile,
  type CsvColumnMapping,
} from "@/lib/whatsapp/csv-leads.shared";
import {
  defaultWatiTemplateParamMapping,
  extractWatiTemplateParamSlots,
  getTemplateSlotHint,
  validateWatiTemplateParamMapping,
  WATI_TEMPLATE_PARAM_FIELD_OPTIONS,
  encodeLiteralTemplateField,
  isLiteralTemplateField,
  literalTemplateFieldText,
  watiTemplateBodyOriginalText,
} from "@/lib/whatsapp/wati-template-params.shared";
import { toast } from "sonner";
import { BuzzchatEmptyState } from "@/components/whatsapp/buzzchat-ui";

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof AlertCircle }> = {
  draft: { label: "Draft", color: "secondary", icon: AlertCircle },
  scheduled: { label: "Scheduled", color: "outline", icon: Clock },
  running: { label: "Running", color: "default", icon: PlayCircle },
  active: { label: "Running", color: "default", icon: PlayCircle },
  completed: { label: "Completed", color: "secondary", icon: CheckCircle2 },
  failed: { label: "Failed", color: "destructive", icon: AlertCircle },
};

const LEAD_PARAM_FIELDS = WATI_TEMPLATE_PARAM_FIELD_OPTIONS;

function watiTemplateBodyPreview(template: Record<string, unknown> | null | undefined): string {
  return watiTemplateBodyOriginalText(template) ?? "";
}

type AudienceMode = "filters" | "csv" | "contacts";
type SendWhen = "now" | "later";

type CampaignForm = {
  name: string;
  type: "broadcast" | "follow_up" | "scheduled";
  sendWhen: SendWhen;
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
    sendWhen: "now",
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

function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultScheduleLocal(): string {
  return toDatetimeLocal(new Date(Date.now() + 60 * 60 * 1000));
}

function watiTemplateParamSlots(template: Record<string, unknown> | null | undefined): string[] {
  return extractWatiTemplateParamSlots(template ?? undefined);
}

function buildAudienceFilter(form: CampaignForm, csvLeadIds: string[]) {
  if (form.audienceMode === "csv" || form.audienceMode === "contacts") {
    if (csvLeadIds.length === 0) return undefined;
    return { lead_ids: csvLeadIds };
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
  const listFn = useServerFn(listWACampaigns);
  const createFn = useServerFn(createWACampaign);
  const deleteFn = useServerFn(deleteWACampaign);
  const tmplFn = useServerFn(listWATemplates);
  const launchFn = useServerFn(launchWACampaign);
  const watiConnFn = useServerFn(getWatiConnection);
  const watiListFn = useServerFn(listWatiTemplates);
  const warmupDashFn = useServerFn(getWatiWarmupDashboard);
  const buzzchatOpsFn = useServerFn(getBuzzchatOpsDashboard);
  const overlapFn = useServerFn(checkCampaignAudienceOverlapFn);
  const importCsvFn = useServerFn(importWatiCampaignLeadsCsv);
  const loadContactsAudienceFn = useServerFn(prepareCampaignAudienceFromContacts);
  const listContactsFn = useServerFn(listWAContacts);
  const csvInputRef = useRef<HTMLInputElement>(null);

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

  const { data: warmupDash } = useQuery({
    queryKey: ["wati-warmup"],
    queryFn: () => warmupDashFn(),
    enabled: watiConnected,
    throwOnError: false,
  });

  const { data: buzzchatOps, refetch: refetchBuzzchatOps } = useQuery({
    queryKey: ["buzzchat-ops"],
    queryFn: () => buzzchatOpsFn(),
    enabled: watiConnected,
    throwOnError: false,
  });

  const [open, setOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [launchId, setLaunchId] = useState<string | null>(null);
  const [launchCampaign, setLaunchCampaign] = useState<any>(null);
  const [launchAllowOverlap, setLaunchAllowOverlap] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [csvLeadIds, setCsvLeadIds] = useState<string[]>([]);
  const [csvStats, setCsvStats] = useState<{
    inserted: number;
    updated: number;
    skipped: number;
    total: number;
    remaining?: number;
    unsentTotal?: number;
    source?: AudienceMode;
  } | null>(null);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [csvMapping, setCsvMapping] = useState<CsvColumnMapping | null>(null);
  const [csvNeedsMapping, setCsvNeedsMapping] = useState(false);
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvParsing, setCsvParsing] = useState(false);
  const [csvImportLimit, setCsvImportLimit] = useState(50);
  const [csvSkipCount, setCsvSkipCount] = useState(0);
  const [csvBuyersOnly, setCsvBuyersOnly] = useState(true);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [loadingContactsAudience, setLoadingContactsAudience] = useState(false);
  const [skipAlreadySent, setSkipAlreadySent] = useState(true);

  const { data: waContactsPayload } = useQuery({
    queryKey: ["wa-contacts"],
    queryFn: () => listContactsFn(),
    enabled: watiConnected,
    throwOnError: false,
  });
  const waContacts = waContactsPayload?.contacts ?? [];
  const contactsSummary = waContactsPayload?.summary;

  const { data: launchOverlap } = useQuery({
    queryKey: ["campaign-overlap", launchId],
    queryFn: () => overlapFn({ data: { campaignId: launchId! } }),
    enabled: !!launchId && watiConnected,
    throwOnError: false,
  });

  function resetCsvState() {
    setCsvLeadIds([]);
    setCsvStats(null);
    setCsvHeaders([]);
    setCsvRows([]);
    setCsvMapping(null);
    setCsvNeedsMapping(false);
    setCsvFileName(null);
    setCsvSkipCount(0);
    if (csvInputRef.current) csvInputRef.current.value = "";
  }

  function openCreateDialog() {
    setForm(emptyForm());
    resetCsvState();
    setSkipAlreadySent(true);
    setOpen(true);
  }

  const selectedWatiTemplate = (watiTemplates as any[]).find(
    (t) => t.name === form.wati_template_name,
  );
  const paramSlots = watiTemplateParamSlots(selectedWatiTemplate);
  const paramMappingError = validateWatiTemplateParamMapping(paramSlots, form.template_params);

  const create = useMutation({
    mutationFn: () => {
      const audience_filter = buildAudienceFilter(form, csvLeadIds);
      const template_params = Object.keys(form.template_params).length
        ? form.template_params
        : undefined;
      return createFn({
        data: {
          name: form.name,
          type: form.sendWhen === "later" ? "scheduled" : "broadcast",
          template_id: !watiConnected ? form.template_id || undefined : undefined,
          scheduled_at:
            form.sendWhen === "later" && form.scheduled_at
              ? new Date(form.scheduled_at).toISOString()
              : undefined,
          provider: watiConnected ? "wati" : undefined,
          wati_template_name: watiConnected ? form.wati_template_name || undefined : undefined,
          wati_broadcast_name: watiConnected ? form.wati_broadcast_name || form.name : undefined,
          template_params,
          audience_filter,
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wa-campaigns"] });
      qc.invalidateQueries({ queryKey: ["leads-all"] });
      const scheduled = form.sendWhen === "later" && form.scheduled_at;
      setOpen(false);
      setForm(emptyForm());
      resetCsvState();
      toast.success(
        scheduled
          ? `Scheduled for ${new Date(form.scheduled_at).toLocaleString()}`
          : "Draft saved — click the rocket to send",
      );
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
    mutationFn: () => launchFn({ data: { id: launchId!, allowOverlap: launchAllowOverlap } }),
    onSuccess: (res: {
      sent?: number;
      failed?: number;
      errors?: string[];
      overlap?: { skipped_dnc?: number; skipped_already_messaged?: number };
      warmup?: { truncated?: boolean; deferred?: number; warnings?: string[] };
    }) => {
      qc.invalidateQueries({ queryKey: ["wa-campaigns"] });
      qc.invalidateQueries({ queryKey: ["wati-warmup"] });
      qc.invalidateQueries({ queryKey: ["buzzchat-ops"] });
      qc.invalidateQueries({ queryKey: ["wa-contacts"] });
      qc.invalidateQueries({ queryKey: ["wa-threads"] });
      setLaunchId(null);
      setLaunchCampaign(null);
      setLaunchAllowOverlap(false);
      const errHint =
        (res.failed ?? 0) > 0 && res.sent === 0 && Array.isArray(res.errors) && res.errors[0]
          ? ` — ${res.errors[0]}`
          : "";
      const creditFailure =
        (res.sent ?? 0) === 0 &&
        Array.isArray(res.errors) &&
        res.errors.some((e) =>
          /insufficient\s+credit|not\s+enough\s+credit|credit.*deplet|wallet.*balance|low\s+balance/i.test(
            String(e),
          ),
        );
      if (creditFailure) {
        toast.error("WATI wallet has insufficient credits", {
          description:
            "Log in to live.wati.io → Wallet → Buy Credits. You need enough balance for your batch size (min ~$10 / ₹500 plus per-message fees).",
          duration: 12000,
        });
        return;
      }
      let msg = `Campaign launched — ${res.sent ?? 0} sent, ${res.failed ?? 0} failed${errHint}`;
      if (res.warmup?.truncated && res.warmup.deferred) {
        msg += `. Warm-up: ${res.warmup.deferred} contacts deferred to tomorrow.`;
      }
      toast.success(msg);
      if (res.warmup?.warnings?.length) {
        toast.warning(res.warmup.warnings[0]);
      }
      if (res.overlap?.skipped_dnc || res.overlap?.skipped_already_messaged) {
        const parts: string[] = [];
        if (res.overlap.skipped_dnc) parts.push(`${res.overlap.skipped_dnc} DNC`);
        if (res.overlap.skipped_already_messaged) {
          parts.push(`${res.overlap.skipped_already_messaged} already messaged`);
        }
        toast.message(`Filtered before send: ${parts.join(", ")}`);
      }
    },
    onError: (e: Error) => {
      setLaunchId(null);
      setLaunchCampaign(null);
      setLaunchAllowOverlap(false);
      toast.error(e.message);
    },
  });

  const scheduleOk =
    form.sendWhen === "now" ||
    (!!form.scheduled_at && new Date(form.scheduled_at).getTime() > Date.now() + 15_000);

  const canCreate =
    !!form.name &&
    scheduleOk &&
    (watiConnected
      ? !!form.wati_template_name &&
        (form.audienceMode === "filters" || csvLeadIds.length > 0) &&
        !paramMappingError
      : true);

  const audienceReady = csvLeadIds.length > 0;
  const contactsBatchCap = Math.max(
    1,
    Math.min(warmupDash?.remaining ?? warmupDash?.dailyCap ?? 50, 50),
  );

  function useContactsAudience() {
    setForm({ ...form, audienceMode: "contacts" });
    setCsvImportLimit(contactsBatchCap);
    setSkipAlreadySent(true);
    setCsvSkipCount(0);
  }

  async function loadExistingContactsAudience() {
    setLoadingContactsAudience(true);
    try {
      const limit = Math.max(1, Math.min(csvImportLimit, 5000));
      const offset = Math.max(0, csvSkipCount);
      const result = await loadContactsAudienceFn({
        data: { limit, offset: skipAlreadySent ? 0 : offset, skipMessaged: skipAlreadySent },
      });
      setCsvLeadIds(result.leadIds ?? []);
      const loaded = result.total ?? 0;
      const remaining = result.remainingUnsent ?? 0;
      const skipped = result.skippedMessaged ?? 0;
      const unsentTotal = result.unsentTotal ?? loaded + remaining;
      setCsvStats({
        inserted: result.inserted ?? 0,
        updated: result.updated ?? 0,
        skipped,
        total: loaded,
        remaining,
        unsentTotal,
        source: "contacts",
      });
      toast.success(
        `Loaded ${loaded} unsent contact${loaded === 1 ? "" : "s"} for this campaign`,
        {
          description: skipAlreadySent
            ? `${skipped} already messaged were left out · ${remaining} unsent still available for the next campaign`
            : `${result.inserted} new phones · ${result.updated} already on file`,
        },
      );
      if (!skipAlreadySent) {
        const nextSkip = offset + (result.total ?? 0);
        setCsvSkipCount(nextSkip);
      }
    } catch (err) {
      toast.error("Could not load contacts", { description: (err as Error).message });
    } finally {
      setLoadingContactsAudience(false);
    }
  }

  async function handleCsvFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvParsing(true);
    const limit = Math.max(1, Math.min(csvImportLimit, 5000));
    const skip = Math.max(0, csvSkipCount);
    try {
      const scanRows = csvScanRowCount(limit, skip);
      const { text, truncated } = await readCsvFileHead(file, scanRows);
      const { headers, rows } = parseCsvText(text);
      const mapping = autoDetectCsvColumnMapping(headers);
      setCsvHeaders(headers);
      setCsvRows(rows);
      setCsvMapping(
        mapping ?? {
          phone: headers.find((h) => h.toLowerCase().includes("mobile")) ?? headers[0] ?? "",
        },
      );
      setCsvNeedsMapping(!mapping);
      setCsvFileName(file.name);
      const savedSkip = loadCsvSkipForFile(file.name);
      const effectiveSkip = skip > 0 ? skip : savedSkip;
      if (effectiveSkip > 0 && skip === 0) setCsvSkipCount(effectiveSkip);
      setCsvLeadIds([]);
      setCsvStats(null);
      if (truncated) {
        toast.message(`Large file — scanned first ${scanRows.toLocaleString()} rows`, {
          description: `Importing up to ${limit} contacts after skipping ${effectiveSkip}.`,
        });
      }
      if (mapping) {
        await runCsvImport(rows, mapping, limit, effectiveSkip);
      } else {
        toast.message("Choose which column is the phone number", {
          description: `${rows.length.toLocaleString()} rows parsed · Mobile column recommended`,
        });
      }
    } catch (err) {
      toast.error("Could not parse CSV", { description: (err as Error).message });
      resetCsvState();
    } finally {
      setCsvParsing(false);
    }
    if (csvInputRef.current) csvInputRef.current.value = "";
  }

  async function runCsvImport(
    rows: Record<string, string>[],
    mapping: CsvColumnMapping,
    limit = csvImportLimit,
    skip = csvSkipCount,
  ) {
    if (!mapping.phone) {
      toast.error("Select a phone column");
      return;
    }
    const maxLeads = Math.max(1, Math.min(limit, 5000));
    const skipLeads = Math.max(0, skip);
    const leads = mapCsvRowsToLeads(rows, mapping, {
      maxLeads,
      skipLeads,
      buyersOnly: csvBuyersOnly,
    });
    if (leads.length === 0) {
      toast.error("No valid phone numbers found in CSV", {
        description: skipLeads
          ? `Skipped first ${skipLeads} — try a lower skip or scan more rows.`
          : "Map the Mobile column — many rows in this file are sellers without phones.",
      });
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
      const nextSkip = skipLeads + (result.total ?? 0);
      setCsvSkipCount(nextSkip);
      if (csvFileName) saveCsvSkipForFile(csvFileName, nextSkip);
      toast.success(`Imported ${result.total} for this campaign`, {
        description: `${result.inserted} new · ${result.updated} already in Contacts (updated, not duplicated) · next skip ${nextSkip}`,
      });
      qc.invalidateQueries({ queryKey: ["wa-contacts"] });
      qc.invalidateQueries({ queryKey: ["campaign-leads"] });
    } catch (err) {
      toast.error("CSV import failed", { description: (err as Error).message });
    } finally {
      setCsvImporting(false);
    }
  }

  async function applyCsvMapping() {
    if (!csvMapping?.phone || csvRows.length === 0) return;
    await runCsvImport(csvRows, csvMapping, csvImportLimit);
  }

  function openContinueWarmup() {
    const batch = warmupDash?.dailyCap ?? csvImportLimit;
    resetCsvState();
    setSkipAlreadySent(true);
    setForm({ ...emptyForm(), audienceMode: "contacts" });
    setCsvImportLimit(Math.min(batch, 5000));
    setCsvSkipCount(0);
    setOpen(true);
  }

  function openLaunchDialog(c: any) {
    setLaunchAllowOverlap(false);
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
        <p className="text-sm text-muted-foreground">
          {watiConnected
            ? `${contactsSummary?.not_messaged ?? 0} not sent · ${contactsSummary?.messaged ?? 0} already sent`
            : "Connect WATI in Settings to send template campaigns."}
        </p>
        <div className="flex items-center gap-2 shrink-0">
          {watiConnected && (contactsSummary?.messaged ?? 0) > 0 && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={openContinueWarmup}>
              <PlayCircle className="h-3.5 w-3.5" />
              Next unsent batch
            </Button>
          )}
          <Button size="sm" onClick={openCreateDialog} className="gap-1.5 shrink-0">
            <Plus className="h-3.5 w-3.5" /> New Campaign
          </Button>
        </div>
      </div>

      {watiConnected && buzzchatOps && (
        <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5 space-y-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="font-medium text-foreground">Today</span>
            <span>
              <strong>{buzzchatOps.today.sent}</strong> sent
            </span>
            <span className="text-emerald-400">{buzzchatOps.today.delivered} delivered</span>
            <span className="text-blue-400">{buzzchatOps.today.read} read</span>
            <span className="text-destructive">{buzzchatOps.today.failed} failed</span>
            <span className="text-muted-foreground">{buzzchatOps.today.inbound} replies</span>
            {buzzchatOps.warmup?.config?.enabled && !buzzchatOps.warmup.config.paused && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="text-amber-400">
                  Warm-up day {buzzchatOps.warmup.warmupDay}: {buzzchatOps.warmup.sentToday}/
                  {buzzchatOps.warmup.dailyCap} ({buzzchatOps.warmup.remaining} left)
                </span>
              </>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[10px] ml-auto"
              onClick={() => refetchBuzzchatOps()}
            >
              Refresh
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
      ) : (campaigns as any[]).length === 0 ? (
        <BuzzchatEmptyState
          icon={Megaphone}
          title="No campaigns yet"
          description={
            watiConnected
              ? "Create a campaign, pick an approved template, then send now or schedule."
              : "Connect WATI in Settings, then create a campaign to message contacts."
          }
          action={
            <Button size="sm" onClick={openCreateDialog} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              New campaign
            </Button>
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-card/60">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                {[
                  "Name",
                  "Template",
                  "Status",
                  "Sent",
                  "Replied",
                  "When",
                  "",
                ].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground"
                  >
                    {h}
                  </th>
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
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">
                      {templateLabel(c)}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge
                        variant={sc.color as "secondary" | "outline" | "default" | "destructive"}
                        className="gap-1 text-[10px]"
                      >
                        <Icon className="h-3 w-3" />
                        {sc.label}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5 text-xs tabular-nums">{stats.sent ?? 0}</td>
                    <td className="px-4 py-2.5 text-xs tabular-nums">{stats.replied ?? 0}</td>
                    <td className="px-4 py-2.5 text-[11px] text-muted-foreground">
                      {c.status === "scheduled" && c.scheduled_at ? (
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {new Date(c.scheduled_at).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      ) : (
                        <RelativeTime date={c.created_at} />
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-1">
                        {isDraft && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-green-500 hover:text-green-400"
                            title={c.status === "scheduled" ? "Send now" : "Launch campaign"}
                            onClick={() => openLaunchDialog(c)}
                          >
                            <Rocket className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
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
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Campaign</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Campaign Name *</Label>
              <Input
                value={form.name}
                onChange={(e) =>
                  setForm({ ...form, name: e.target.value, wati_broadcast_name: e.target.value })
                }
                placeholder="e.g. Summer Promo 2026"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">When</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={form.sendWhen === "now" ? "default" : "outline"}
                  className="h-8 text-xs"
                  onClick={() => setForm({ ...form, sendWhen: "now", type: "broadcast", scheduled_at: "" })}
                >
                  Send now (draft)
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={form.sendWhen === "later" ? "default" : "outline"}
                  className="h-8 text-xs gap-1.5"
                  onClick={() =>
                    setForm({
                      ...form,
                      sendWhen: "later",
                      type: "scheduled",
                      scheduled_at: form.scheduled_at || defaultScheduleLocal(),
                    })
                  }
                >
                  <Calendar className="h-3.5 w-3.5" />
                  Schedule
                </Button>
              </div>
              {form.sendWhen === "later" && (
                <Input
                  type="datetime-local"
                  value={form.scheduled_at}
                  min={toDatetimeLocal(new Date())}
                  onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })}
                  className="h-9 text-sm"
                />
              )}
            </div>

            {watiConnected ? (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">WATI Template *</Label>
                  <Select
                    value={form.wati_template_name}
                    onValueChange={(v) => {
                      const tpl = (watiTemplates as any[]).find((t) => t.name === v);
                      const slots = watiTemplateParamSlots(tpl);
                      setForm({
                        ...form,
                        wati_template_name: v,
                        template_params: defaultWatiTemplateParamMapping(slots, tpl),
                      });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Choose approved template…" />
                    </SelectTrigger>
                    <SelectContent>
                      {(watiTemplates as any[])
                        .filter((t) => !t.status || String(t.status).toLowerCase() === "approved")
                        .map((t) => (
                          <SelectItem key={t.id} value={t.name}>
                            {t.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                {selectedWatiTemplate && watiTemplateBodyPreview(selectedWatiTemplate) && (
                  <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground whitespace-pre-wrap">
                    {watiTemplateBodyPreview(selectedWatiTemplate)}
                  </div>
                )}

                {paramSlots.length > 0 && (
                  <div className="space-y-2 rounded-md border border-border/60 p-3">
                    <Label className="text-xs">Fill each {"{{variable}}"}</Label>
                    {paramSlots.map((slot) => {
                      const mapped = form.template_params[slot] ?? "";
                      const isFixed = isLiteralTemplateField(mapped);
                      const selectValue = isFixed ? "__fixed__" : mapped;
                      const slotHint = getTemplateSlotHint(selectedWatiTemplate, slot);
                      return (
                        <div key={slot} className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-muted-foreground w-20 shrink-0">{`{{${slot}}}`}</span>
                            <Select
                              value={selectValue || undefined}
                              onValueChange={(v) =>
                                setForm({
                                  ...form,
                                  template_params: {
                                    ...form.template_params,
                                    [slot]: v === "__fixed__" ? encodeLiteralTemplateField("") : v,
                                  },
                                })
                              }
                            >
                              <SelectTrigger className="h-8 text-xs flex-1">
                                <SelectValue placeholder="Lead / property field…" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__fixed__">
                                  Fixed text (same for everyone)
                                </SelectItem>
                                <SelectItem value="__group_lead__" disabled>
                                  — Lead fields —
                                </SelectItem>
                                {LEAD_PARAM_FIELDS.filter((f) => f.group === "lead").map((f) => (
                                  <SelectItem key={f.value} value={f.value}>
                                    {f.label}
                                  </SelectItem>
                                ))}
                                <SelectItem value="__group_property__" disabled>
                                  — Property / CSV fields —
                                </SelectItem>
                                {LEAD_PARAM_FIELDS.filter((f) => f.group === "property").map(
                                  (f) => (
                                    <SelectItem key={f.value} value={f.value}>
                                      {f.label}
                                    </SelectItem>
                                  ),
                                )}
                              </SelectContent>
                            </Select>
                          </div>
                          {slotHint && (
                            <p className="text-[10px] text-muted-foreground ml-[5.5rem]">
                              {slotHint}
                            </p>
                          )}
                          {isFixed && (
                            <Input
                              className="h-8 text-xs ml-[5.5rem]"
                              placeholder={
                                slotHint?.includes("agent")
                                  ? "Your agent name, e.g. Khisha"
                                  : "Same text on every message"
                              }
                              value={literalTemplateFieldText(mapped)}
                              onChange={(e) =>
                                setForm({
                                  ...form,
                                  template_params: {
                                    ...form.template_params,
                                    [slot]: encodeLiteralTemplateField(e.target.value),
                                  },
                                })
                              }
                            />
                          )}
                        </div>
                      );
                    })}
                    {paramMappingError && (
                      <p className="text-[11px] text-destructive">{paramMappingError}</p>
                    )}
                  </div>
                )}

                <div className="space-y-2 rounded-md border border-border/60 p-3">
                  <Label className="text-xs">Audience</Label>
                  <div className="grid grid-cols-3 gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={form.audienceMode === "csv" ? "default" : "outline"}
                      className="h-7 text-xs"
                      onClick={() => setForm({ ...form, audienceMode: "csv" })}
                    >
                      <Upload className="h-3 w-3 mr-1" /> New CSV
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={form.audienceMode === "contacts" ? "default" : "outline"}
                      className="h-7 text-xs"
                      onClick={() => useContactsAudience()}
                    >
                      <Users className="h-3 w-3 mr-1" /> Contacts
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={form.audienceMode === "filters" ? "default" : "outline"}
                      className="h-7 text-xs"
                      onClick={() => setForm({ ...form, audienceMode: "filters" })}
                    >
                      Filter
                    </Button>
                  </div>

                      {audienceReady && (
                    <div className="rounded-md bg-green-500/10 border border-green-500/20 px-2.5 py-2 text-xs text-green-700 dark:text-green-400 space-y-0.5">
                      {csvStats?.source === "contacts" ? (
                        <>
                          <p>
                            <strong>{csvStats.total}</strong> unsent people are on this campaign
                            {csvStats.unsentTotal != null && csvStats.unsentTotal > csvStats.total
                              ? ` (${csvStats.unsentTotal} unsent in total)`
                              : ""}
                            .
                          </p>
                          <p className="text-muted-foreground">
                            {csvStats.skipped} already messaged were not included.
                            {csvStats.remaining
                              ? ` ${csvStats.remaining} unsent left for the next campaign.`
                              : " No unsent contacts left after this batch."}
                          </p>
                        </>
                      ) : (
                        <p>
                          <strong>{csvStats?.total ?? csvLeadIds.length}</strong> ready
                          {csvStats && (
                            <span className="text-muted-foreground ml-1">
                              ({csvStats.inserted} new phones · {csvStats.updated} matched existing)
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                  )}

                  {form.audienceMode === "contacts" ? (
                    <div className="space-y-2 pt-1">
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-md bg-muted/30 px-2 py-1.5">
                          <p className="text-sm font-semibold tabular-nums">{contactsSummary?.total ?? waContacts.length}</p>
                          <p className="text-[10px] text-muted-foreground">Contacts</p>
                        </div>
                        <div className="rounded-md bg-muted/30 px-2 py-1.5">
                          <p className="text-sm font-semibold tabular-nums">{contactsSummary?.not_messaged ?? 0}</p>
                          <p className="text-[10px] text-muted-foreground">Not sent</p>
                        </div>
                        <div className="rounded-md bg-muted/30 px-2 py-1.5">
                          <p className="text-sm font-semibold tabular-nums">{contactsSummary?.messaged ?? 0}</p>
                          <p className="text-[10px] text-muted-foreground">Already sent</p>
                        </div>
                      </div>
                      <label className="flex items-center gap-2 text-xs cursor-pointer">
                        <Checkbox
                          checked={skipAlreadySent}
                          onCheckedChange={(v) => setSkipAlreadySent(v === true)}
                        />
                        Skip already sent (recommended)
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-xs">
                            This batch
                            {skipAlreadySent && (contactsSummary?.not_messaged ?? 0) > 0
                              ? ` of ${contactsSummary?.not_messaged} unsent`
                              : ""}
                          </Label>
                          <Input
                            type="number"
                            min={1}
                            max={5000}
                            value={csvImportLimit}
                            onChange={(e) =>
                              setCsvImportLimit(Math.max(1, parseInt(e.target.value, 10) || 50))
                            }
                            className="mt-1 h-8 text-xs"
                          />
                        </div>
                        {!skipAlreadySent && (
                          <div>
                            <Label className="text-xs">Skip first</Label>
                            <Input
                              type="number"
                              min={0}
                              max={500000}
                              value={csvSkipCount}
                              onChange={(e) =>
                                setCsvSkipCount(Math.max(0, parseInt(e.target.value, 10) || 0))
                              }
                              className="mt-1 h-8 text-xs"
                            />
                          </div>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 text-xs w-full gap-1.5"
                        disabled={loadingContactsAudience || waContacts.length === 0}
                        onClick={loadExistingContactsAudience}
                      >
                        {loadingContactsAudience ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Users className="h-3.5 w-3.5" />
                        )}
                        Load {csvImportLimit} {skipAlreadySent ? "unsent" : ""} contacts
                      </Button>
                      {waContacts.length === 0 && (
                        <p className="text-[10px] text-amber-400">
                          Import contacts first, or switch to New CSV.
                        </p>
                      )}
                    </div>
                  ) : form.audienceMode === "csv" ? (
                    <div className="space-y-2 pt-1">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-xs">This batch</Label>
                          <Input
                            type="number"
                            min={1}
                            max={5000}
                            value={csvImportLimit}
                            onChange={(e) =>
                              setCsvImportLimit(Math.max(1, parseInt(e.target.value, 10) || 50))
                            }
                            className="mt-1 h-8 text-xs"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Skip already used rows</Label>
                          <Input
                            type="number"
                            min={0}
                            max={500000}
                            value={csvSkipCount}
                            onChange={(e) =>
                              setCsvSkipCount(Math.max(0, parseInt(e.target.value, 10) || 0))
                            }
                            className="mt-1 h-8 text-xs"
                          />
                        </div>
                      </div>
                      <p className="text-[11px] text-muted-foreground leading-snug">
                        Same phone updates the existing contact — it is never added twice.
                        Skip 0 = first batch. After import this becomes the next start row
                        {csvSkipCount > 0 ? ` (currently ${csvSkipCount}).` : "."}
                      </p>
                      <label className="mt-2 flex items-center gap-2 text-xs">
                        <Checkbox
                          checked={csvBuyersOnly}
                          onCheckedChange={(v) => setCsvBuyersOnly(v === true)}
                        />
                        Buyers only
                      </label>
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
                          disabled={csvImporting || csvParsing}
                          onClick={() => csvInputRef.current?.click()}
                        >
                          {csvImporting || csvParsing ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <FileSpreadsheet className="h-3.5 w-3.5" />
                          )}
                          {csvParsing
                            ? "Parsing CSV…"
                            : csvImporting
                              ? "Importing…"
                              : csvFileName
                                ? "Replace CSV"
                                : "Upload CSV"}
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
                            <SelectTrigger className="h-7 text-xs">
                              <SelectValue placeholder="Phone column *" />
                            </SelectTrigger>
                            <SelectContent>
                              {csvHeaders.map((h) => (
                                <SelectItem key={h} value={h}>
                                  {h}
                                </SelectItem>
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
                            <SelectTrigger className="h-7 text-xs">
                              <SelectValue placeholder="Name column (optional)" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">— None —</SelectItem>
                              {csvHeaders.map((h) => (
                                <SelectItem key={h} value={h}>
                                  {h}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            type="button"
                            size="sm"
                            className="h-7 text-xs w-full"
                            disabled={csvImporting || csvParsing || !csvMapping.phone}
                            onClick={() => applyCsvMapping()}
                          >
                            Import up to {csvImportLimit} contacts
                          </Button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <Input
                          placeholder="Status (optional)"
                          value={form.audience.status}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              audience: { ...form.audience, status: e.target.value },
                            })
                          }
                          className="h-8 text-xs"
                        />
                        <Input
                          placeholder="Pipeline stage (optional)"
                          value={form.audience.pipeline_stage}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              audience: { ...form.audience, pipeline_stage: e.target.value },
                            })
                          }
                          className="h-8 text-xs"
                        />
                        <Input
                          placeholder="Qualification (optional)"
                          value={form.audience.qualification_status}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              audience: { ...form.audience, qualification_status: e.target.value },
                            })
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
                  Only opted-in WhatsApp numbers
                </label>
                <p className="text-[11px] text-muted-foreground">
                  Launch still skips DNC and already-sent numbers unless you allow a resend.
                </p>
                </div>
              </>
            ) : (
              <div className="space-y-1.5">
                <Label className="text-xs">Template (optional)</Label>
                <Select
                  value={form.template_id}
                  onValueChange={(v) => setForm({ ...form, template_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a template…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(templates as any[]).map((t: any) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter className="flex-col items-stretch gap-2 sm:flex-col sm:space-x-0">
            {!canCreate && watiConnected && form.audienceMode !== "filters" && !audienceReady && (
              <p className="text-xs text-amber-400 text-center">
                {form.audienceMode === "csv"
                  ? "Upload a CSV first."
                  : "Load contacts first."}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => create.mutate()} disabled={!canCreate || create.isPending}>
                {create.isPending
                  ? form.sendWhen === "later"
                    ? "Scheduling…"
                    : "Creating…"
                  : form.sendWhen === "later"
                    ? "Schedule campaign"
                    : "Create draft"}
              </Button>
            </div>
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
            <AlertDialogAction
              onClick={() => del.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!launchId}
        onOpenChange={(o) => {
          if (!o) {
            setLaunchId(null);
            setLaunchCampaign(null);
            setLaunchAllowOverlap(false);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Rocket className="h-4 w-4 text-green-500" /> Launch campaign?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  {launchCampaign?.audience_filter?.lead_ids?.length
                    ? `This sends "${launchCampaign?.wati_template_name ?? "template"}" to ${launchCampaign.audience_filter.lead_ids.length} CSV-imported leads.`
                    : launchCampaign?.provider === "wati" || launchCampaign?.wati_template_name
                      ? `This sends the WATI template "${launchCampaign?.wati_template_name ?? "template"}" to all matching leads with phone numbers.`
                      : "This sends the campaign template to opted-in WhatsApp contacts via Twilio."}
                </p>
                {launchOverlap && launchOverlap.total > 0 && (
                  <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-200/90">
                    Audience check: {launchOverlap.total} recipients —{" "}
                    <strong>{launchOverlap.alreadyMessaged}</strong> already messaged,{" "}
                    <strong>{launchOverlap.dnc}</strong> on DNC list. By default these are skipped.
                  </p>
                )}
                {launchOverlap &&
                  launchOverlap.alreadyMessaged > 0 &&
                  launchOverlap.alreadyMessaged === launchOverlap.total && (
                    <p className="text-xs text-destructive">
                      Everyone in this audience was already messaged. Enable resend below or load
                      the next batch with a higher skip.
                    </p>
                  )}
                {launchOverlap && launchOverlap.alreadyMessaged > 0 && (
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <Checkbox
                      checked={launchAllowOverlap}
                      onCheckedChange={(v) => setLaunchAllowOverlap(v === true)}
                    />
                    Include already messaged (allow overlap / resend)
                  </label>
                )}
                {warmupDash?.config?.enabled && !warmupDash.config.paused && (
                  <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-xs text-amber-200/90">
                    Warm-up day {warmupDash.warmupDay}: max <strong>{warmupDash.dailyCap}</strong>{" "}
                    sends today (<strong>{warmupDash.remaining}</strong> remaining). Audiences
                    larger than the daily cap are sent in batches.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={launch.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => launch.mutate()}
              disabled={
                launch.isPending ||
                (!!launchOverlap &&
                  launchOverlap.total > 0 &&
                  launchOverlap.alreadyMessaged >= launchOverlap.total &&
                  !launchAllowOverlap)
              }
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
