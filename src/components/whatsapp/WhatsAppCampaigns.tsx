import { useEffect, useMemo, useRef, useState } from "react";
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
  FileSpreadsheet,
  X,
  Users,
  Calendar,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { RelativeTime } from "@/components/ui/relative-time";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
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
  prepareCampaignAudienceFromContacts,
  listWAContacts,
  getBuzzchatOpsDashboard,
  checkCampaignAudienceOverlapFn,
  getWhatsappInboxMeta,
  listLeadMetaFieldOptions,
  previewWatiTemplateSend,
} from "@/lib/dashboard/whatsapp.functions";
import {
  BOOKKEEPING_LEAD_COLUMNS,
  isOfferableFieldOption,
  mergeFieldOptions,
} from "@/lib/whatsapp/lead-meta-fields.shared";
import {
  CAMPAIGN_TYPE_LABELS,
  CAMPAIGN_TYPES,
  DEFAULT_CAMPAIGN_TYPE,
  EMPTY_OFF_PLAN_CAMPAIGN_FIELDS,
  EMPTY_SECONDARY_CAMPAIGN_FIELDS,
  type CampaignType,
  type OffPlanCampaignFields,
  type SecondaryCampaignFields,
} from "@/lib/whatsapp/campaign-types.shared";
import {
  getWatiConnection,
  listWatiTemplates,
  getWatiWarmupDashboard,
} from "@/lib/whatsapp/wati.functions";
import {
  defaultWatiTemplateParamMapping,
  extractWatiTemplateParamSlots,
  getTemplateSlotHint,
  templateSendsLiteralPlaceholders,
  validateWatiTemplateParamMapping,
  WATI_TEMPLATE_PARAM_FIELD_OPTIONS,
  encodeLiteralTemplateField,
  isLiteralTemplateField,
  literalTemplateFieldText,
  watiTemplateBodyOriginalText,
} from "@/lib/whatsapp/wati-template-params.shared";
import { toast } from "sonner";
import { BuzzchatEmptyState } from "@/components/whatsapp/buzzchat-ui";
import { cn } from "@/lib/utils";

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
  campaignType: CampaignType;
  offPlanFields: OffPlanCampaignFields;
  secondaryFields: SecondaryCampaignFields;
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
    campaignType: DEFAULT_CAMPAIGN_TYPE,
    offPlanFields: { ...EMPTY_OFF_PLAN_CAMPAIGN_FIELDS },
    secondaryFields: { ...EMPTY_SECONDARY_CAMPAIGN_FIELDS },
    sendWhen: "now",
    template_id: "",
    scheduled_at: "",
    wati_template_name: "",
    wati_broadcast_name: "",
    template_params: {},
    audienceMode: "contacts",
    audience: {
      qualification_status: "",
      pipeline_stage: "",
      status: "",
      whatsapp_opt_in_only: true,
    },
  };
}

function typeFieldsForSubmit(form: CampaignForm): Record<string, string> {
  if (form.campaignType === "off_plan") return { ...form.offPlanFields };
  if (form.campaignType === "secondary") return { ...form.secondaryFields };
  return {};
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

/** Radix Select cannot hold an empty string, so "all uploads" needs a token. */
const AUDIENCE_ALL_UPLOADS = "__all_uploads__";

const CAMPAIGN_STATUS_FILTERS = [
  "all",
  "draft",
  "scheduled",
  "running",
  "completed",
  "failed",
] as const;

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

function StepTitle({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
        {n}
      </span>
      <span className="text-sm font-medium">{title}</span>
    </div>
  );
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
  const loadContactsAudienceFn = useServerFn(prepareCampaignAudienceFromContacts);
  const listContactsFn = useServerFn(listWAContacts);
  const metaFn = useServerFn(getWhatsappInboxMeta);

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ["wa-campaigns"],
    queryFn: () => listFn(),
    throwOnError: false,
  });
  const { data: inboxMeta } = useQuery({
    queryKey: ["wa-inbox-meta"],
    queryFn: () => metaFn(),
    staleTime: 60_000,
    throwOnError: false,
  });
  const uploadTypeOptions = useMemo(
    () => (inboxMeta?.uploadTypes ?? []) as string[],
    [inboxMeta?.uploadTypes],
  );

  const isAvenueElite = inboxMeta?.isAvenueElite === true;
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
  const [errorsCampaign, setErrorsCampaign] = useState<any>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [launchId, setLaunchId] = useState<string | null>(null);
  const [launchCampaign, setLaunchCampaign] = useState<any>(null);
  const [launchAllowOverlap, setLaunchAllowOverlap] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [csvLeadIds, setCsvLeadIds] = useState<string[]>([]);
  const [csvImportLimit, setCsvImportLimit] = useState(50);
  /** Which import batch this campaign draws its audience from. "" = all. */
  const [audienceUploadType, setAudienceUploadType] = useState("");
  /** Phones ticked in the audience table. Empty = fall back to the batch walk. */
  const [pickedPhones, setPickedPhones] = useState<Set<string>>(new Set());
  const [audienceSearch, setAudienceSearch] = useState("");

  const [skipAlreadySent, setSkipAlreadySent] = useState(true);

  // Deliberately not gated on `watiConnected`: the contact list is WeBee's own imported data,
  // not a WATI read, so it doesn't need to wait for that separate connection check to resolve
  // first. Gating it here meant opening the campaign composer paid for the wati-connection round
  // trip before the contacts fetch even started, one avoidable wait stacked in front of another.
  const { data: waContactsPayload } = useQuery({
    queryKey: ["wa-contacts"],
    queryFn: () => listContactsFn(),
    throwOnError: false,
  });
  const waContacts = waContactsPayload?.contacts ?? [];

  /**
   * Contacts eligible for this campaign, as shown in the audience table.
   *
   * Filtered client-side from the contacts already loaded for this page, so
   * ticking rows needs no extra round trip. The same predicates the server
   * applies (upload type, already-sent) are mirrored here so the table and the
   * resulting send agree.
   */
  /**
   * Counts for the upload currently selected.
   *
   * The tiles used to show workspace-wide totals while the table below was
   * filtered, so picking an upload with nothing left to send displayed
   * "378 not sent" above "No unsent contacts" — the panel arguing with itself.
   */
  const audienceScope = useMemo(() => {
    const want = audienceUploadType.trim();
    const inScope = (waContacts as Array<Record<string, unknown>>).filter((c) => {
      if (!want) return true;
      const meta = (c.import_meta as Record<string, unknown> | null) ?? {};
      return String(meta.upload_type ?? "").trim() === want;
    });
    let sent = 0;
    for (const c of inScope) {
      const stats = c.wa_stats as { messaged?: boolean } | undefined;
      const status = String(c.lead_status ?? "").toLowerCase();
      if (stats?.messaged || status === "contacted") sent++;
    }
    return { total: inScope.length, sent, unsent: inScope.length - sent };
  }, [waContacts, audienceUploadType]);

  /** Per upload: how many contacts, and how many not messaged yet — shown in the list picker. */
  const uploadCounts = useMemo(() => {
    const out: Record<string, { total: number; unsent: number }> = {};
    for (const c of waContacts as Array<Record<string, unknown>>) {
      const meta = (c.import_meta as Record<string, unknown> | null) ?? {};
      const key = String(meta.upload_type ?? "").trim();
      if (!key) continue;
      const entry = (out[key] ??= { total: 0, unsent: 0 });
      entry.total += 1;
      const messaged =
        (c.wa_stats as { messaged?: boolean } | undefined)?.messaged ||
        String(c.lead_status ?? "").toLowerCase() === "contacted";
      if (!messaged) entry.unsent += 1;
    }
    return out;
  }, [waContacts]);

  const audienceRows = useMemo(() => {
    const want = audienceUploadType.trim();
    const q = audienceSearch.trim().toLowerCase();
    return (waContacts as Array<Record<string, unknown>>).filter((c) => {
      const meta = (c.import_meta as Record<string, unknown> | null) ?? {};
      if (want && String(meta.upload_type ?? "").trim() !== want) return false;
      if (skipAlreadySent) {
        const stats = c.wa_stats as { messaged?: boolean } | undefined;
        const status = String(c.lead_status ?? "").toLowerCase();
        if (stats?.messaged || status === "contacted") return false;
      }
      if (q) {
        const hay = `${c.name ?? ""} ${c.phone ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [waContacts, audienceUploadType, audienceSearch, skipAlreadySent]);

  // A phone ticked under one upload must not silently ride along after the
  // filter changes — the visible table is the audience.
  useEffect(() => {
    setPickedPhones((prev) => {
      if (prev.size === 0) return prev;
      const visible = new Set(audienceRows.map((c) => String(c.phone ?? "").trim()));
      const next = new Set([...prev].filter((p) => visible.has(p)));
      return next.size === prev.size ? prev : next;
    });
  }, [audienceRows]);

  const contactsSummary = waContactsPayload?.summary;

  const { data: launchOverlap } = useQuery({
    queryKey: ["campaign-overlap", launchId],
    queryFn: () => overlapFn({ data: { campaignId: launchId! } }),
    enabled: !!launchId && watiConnected,
    throwOnError: false,
  });

  function resetCsvState() {
    setCsvLeadIds([]);
  }

  function openCreateDialog() {
    setForm(emptyForm());
    resetCsvState();
    setSkipAlreadySent(true);
    setPickedPhones(new Set());
    setAudienceSearch("");
    setCsvImportLimit(contactsBatchCap);
    setOpen(true);
  }

  const selectedWatiTemplate = (watiTemplates as any[]).find(
    (t) => t.name === form.wati_template_name,
  );
  const paramSlots = watiTemplateParamSlots(selectedWatiTemplate);
  const paramMappingError = validateWatiTemplateParamMapping(paramSlots, form.template_params);
  const templateLiteralPlaceholders = templateSendsLiteralPlaceholders(selectedWatiTemplate);

  // The property fields this workspace's leads actually have. The hardcoded list
  // is one dataset's column spellings; a workspace whose column imported as
  // "UNIT NUMBER" had nothing to pick, chose the nearest option and silently
  // sent filler. These are the real keys, most-populated first.
  const metaFieldsFn = useServerFn(listLeadMetaFieldOptions);
  const { data: metaFields } = useQuery({
    queryKey: ["wa-lead-meta-fields", audienceUploadType || null],
    queryFn: () => metaFieldsFn({ data: { uploadType: audienceUploadType.trim() || null } }),
    staleTime: 60_000,
    throwOnError: false,
  });
  type FieldOption = {
    value: string;
    label: string;
    filled: number;
    coverage: number;
    sample: string;
  };
  const discoveredFields = (metaFields?.fields ?? []) as FieldOption[];
  const leadColumnFields = (metaFields?.leadFields ?? []) as FieldOption[];

  // Everything the picker offers, split by whether this upload type actually holds data for it.
  // An import leaves stray keys behind — Bliss 2 carries 25 meta keys but only three are on more
  // than a couple of its leads — and the generic property list describes a different dataset
  // entirely. Showing all of it buried the handful that work, and picking a dead one sends filler.
  const [showAllParamFields, setShowAllParamFields] = useState(false);
  // Coverage is measured over whichever audience is selected — one upload, or the whole list when
  // it is "All uploads". Either way it answers the only question that matters when mapping a
  // variable: will this field actually have a value for the people about to be messaged. Gating
  // this on an upload type being chosen meant the default "All uploads" audience got no filtering
  // at all, which is the state the picker was reported in.
  const haveCoverage = (metaFields?.leadsSampled ?? 0) > 0;

  const rankByCoverage = (a: FieldOption, b: FieldOption) =>
    b.coverage - a.coverage || a.label.localeCompare(b.label);

  // One merged list. "Lead fields" vs "imported columns" is an implementation detail — the reader
  // just saw "Email 100%" in both groups with no way to choose between them.
  const allFields = haveCoverage
    ? mergeFieldOptions(leadColumnFields, discoveredFields)
    : LEAD_PARAM_FIELDS.filter(
        (f) => f.group === "lead" && !BOOKKEEPING_LEAD_COLUMNS.has(f.value),
      ).map((f) => ({
        value: f.value,
        label: f.label,
        filled: 0,
        coverage: 0,
        sample: "",
      }));

  // Offered by default: the columns this upload actually carries, plus the identity columns the
  // import normalised. Held back: columns this upload is empty on, and our own bookkeeping
  // columns, which the importer writes at 100% on every upload and so coverage can never remove.
  const relevantFields = haveCoverage ? allFields.filter(isOfferableFieldOption) : allFields;
  const emptyFields = haveCoverage ? allFields.filter((f) => !isOfferableFieldOption(f)) : [];
  const genericPropertyFields = LEAD_PARAM_FIELDS.filter(
    (f) =>
      f.group === "property" &&
      // Hide a generic option when the real column is already offered under its own name.
      !discoveredFields.some((d) => d.value === f.value),
  );
  const hiddenFieldCount = emptyFields.length + genericPropertyFields.length;
  /**
   * A slot saved against a field that is now hidden (an old campaign, or a column this upload
   * happens to be sparse on) would render as a blank dropdown and read as a lost mapping. Keep the
   * full list open whenever that is the case, so what is already chosen stays visible.
   */
  const mappingUsesHiddenField = Object.values(form.template_params ?? {}).some(
    (v) =>
      typeof v === "string" &&
      v !== "" &&
      !isLiteralTemplateField(v) &&
      !relevantFields.some((f) => f.value === v),
  );
  const showEveryField = showAllParamFields || mappingUsesHiddenField;

  // Render the template as it will actually send, and report any variable that
  // resolves for nobody — the failure that otherwise reaches customers.
  const previewFn = useServerFn(previewWatiTemplateSend);
  // Any chosen template previews — one with no variables too (it used to show nothing at all).
  const mappingComplete = Boolean(form.wati_template_name) && !paramMappingError;
  const previewPhones = useMemo(() => [...pickedPhones].slice(0, 50), [pickedPhones]);
  const {
    data: sendPreview,
    isFetching: previewLoading,
    // Surfaced in the UI: a preview whose own failures are silent is worse than
    // no preview, because it reads as "everything is fine".
    error: previewError,
  } = useQuery({
    queryKey: [
      "wa-template-preview",
      form.wati_template_name,
      JSON.stringify(form.template_params),
      audienceUploadType || null,
      previewPhones.join(","),
    ],
    queryFn: () =>
      previewFn({
        data: {
          templateName: form.wati_template_name,
          mapping: form.template_params,
          uploadType: audienceUploadType.trim() || null,
          // Preview the people actually ticked, when any are.
          phones: previewPhones.length ? previewPhones : undefined,
          limit: 2,
        },
      }),
    enabled: Boolean(form.wati_template_name) && mappingComplete,
    staleTime: 15_000,
    retry: 1,
  });
  const deadSlots = (
    (sendPreview?.perSlot ?? []) as Array<{
      slot: string;
      fieldKey: string;
      resolvedCount: number;
      checked: number;
    }>
  ).filter((p) => p.checked > 0 && p.resolvedCount === 0);

  /**
   * The campaign's recipients, gathered at Create time: the ticked contacts, or the first N shown.
   * This used to be a separate "Load contacts" step that had to be clicked before Create worked.
   */
  async function gatherRecipientLeadIds(): Promise<string[]> {
    const picked = pickedPhones.size > 0;
    const result = await loadContactsAudienceFn({
      data: {
        limit: Math.max(1, Math.min(csvImportLimit, 5000)),
        offset: 0,
        skipMessaged: skipAlreadySent,
        uploadType: audienceUploadType.trim() || null,
        phones: picked ? [...pickedPhones] : undefined,
      },
    });
    const ids = (result.leadIds ?? []) as string[];
    if (ids.length === 0) throw new Error("No recipients to send to — tick contacts or include already messaged.");
    return ids;
  }

  const create = useMutation({
    mutationFn: async () => {
      const leadIds = watiConnected ? await gatherRecipientLeadIds() : csvLeadIds;
      const audience_filter = buildAudienceFilter(form, leadIds);
      const template_params = Object.keys(form.template_params).length
        ? form.template_params
        : undefined;
      return createFn({
        data: {
          name: form.name,
          type: form.sendWhen === "later" ? "scheduled" : "broadcast",
          campaignType: form.campaignType,
          typeFields: typeFieldsForSubmit(form),
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

  const filteredCampaigns = (campaigns as any[]).filter((c) => {
    if (statusFilter !== "all" && c.status !== statusFilter) return false;
    if (typeFilter !== "all" && (c.campaign_type ?? "listing_acquisition") !== typeFilter)
      return false;
    return true;
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

  /** How many people Create will send to. */
  const recipientCount =
    pickedPhones.size > 0 ? pickedPhones.size : Math.min(csvImportLimit, audienceRows.length);
  const createBlocker = !form.name.trim()
    ? "Give the campaign a name."
    : !scheduleOk
      ? "Pick a time in the future."
      : watiConnected && recipientCount === 0
        ? "Choose who to send to."
        : watiConnected && !form.wati_template_name
          ? "Choose a template."
          : watiConnected && paramMappingError
            ? paramMappingError
            : null;
  const canCreate = createBlocker === null;

  const contactsBatchCap = Math.max(
    1,
    Math.min(warmupDash?.remaining ?? warmupDash?.dailyCap ?? 50, 50),
  );




  function openContinueWarmup() {
    const batch = warmupDash?.dailyCap ?? csvImportLimit;
    resetCsvState();
    setSkipAlreadySent(true);
    setForm({ ...emptyForm(), audienceMode: "contacts" });
    setCsvImportLimit(Math.min(batch, 5000));
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

      {!isLoading && (campaigns as any[]).length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CAMPAIGN_STATUS_FILTERS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s === "all" ? "All statuses" : (STATUS_CONFIG[s]?.label ?? s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isAvenueElite && (
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="h-8 w-44 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All campaign types</SelectItem>
                {CAMPAIGN_TYPES.map((id) => (
                  <SelectItem key={id} value={id}>
                    {CAMPAIGN_TYPE_LABELS[id]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {(statusFilter !== "all" || typeFilter !== "all") && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs text-muted-foreground"
              onClick={() => {
                setStatusFilter("all");
                setTypeFilter("all");
              }}
            >
              Clear filters
            </Button>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {filteredCampaigns.length} of {(campaigns as any[]).length}
          </span>
        </div>
      )}

      {isLoading ? (
        <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-card/60">
          <div className="divide-y divide-border/60">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3.5 animate-pulse">
                <div className="h-4 w-32 rounded bg-muted" />
                <div className="h-4 w-24 rounded bg-muted" />
                <div className="h-5 w-20 rounded-full bg-muted" />
                <div className="h-4 w-12 rounded bg-muted" />
                <div className="ml-auto h-4 w-16 rounded bg-muted" />
              </div>
            ))}
          </div>
        </div>
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
      ) : filteredCampaigns.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          No campaigns match these filters.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/[0.06] bg-card/60">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                {[
                  "Name",
                  ...(isAvenueElite ? ["Type"] : []),
                  "Template",
                  "Status",
                  "Sent",
                  "Failed",
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
              {filteredCampaigns.map((c: any) => {
                const sc = STATUS_CONFIG[c.status] ?? STATUS_CONFIG.draft;
                const Icon = sc.icon;
                const stats = c.stats ?? {};
                const isDraft = c.status === "draft" || c.status === "scheduled";
                const failedCount = stats.failed ?? 0;
                const campaignType = c.campaign_type ?? "listing_acquisition";
                return (
                  <tr key={c.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-2.5 font-medium">{c.name}</td>
                    {isAvenueElite && (
                      <td className="px-4 py-2.5">
                        <Badge variant="outline" className="text-[10px]">
                          {CAMPAIGN_TYPE_LABELS[campaignType as CampaignType] ?? campaignType}
                        </Badge>
                      </td>
                    )}
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
                    <td className="px-4 py-2.5 text-xs tabular-nums">
                      {failedCount > 0 ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-full bg-destructive/15 px-2 py-0.5 text-destructive hover:bg-destructive/25"
                          title="Click to see why these failed"
                          onClick={() => setErrorsCampaign(c)}
                        >
                          {failedCount}
                        </button>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
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
            <StepTitle n={1} title="Details" />
            <div className="space-y-1.5">
              <Label className="text-xs">Campaign name</Label>
              <Input
                value={form.name}
                onChange={(e) =>
                  setForm({ ...form, name: e.target.value, wati_broadcast_name: e.target.value })
                }
                placeholder="e.g. Summer Promo 2026"
              />
            </div>
            {isAvenueElite && (
              <div className="space-y-1.5">
                <Label className="text-xs">Campaign Type *</Label>
                <Select
                  value={form.campaignType}
                  onValueChange={(v) => setForm({ ...form, campaignType: v as CampaignType })}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CAMPAIGN_TYPES.map((id) => (
                      <SelectItem key={id} value={id}>
                        {CAMPAIGN_TYPE_LABELS[id]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {isAvenueElite && form.campaignType === "off_plan" && (
              <div className="space-y-3 rounded-md border border-border/60 p-3">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Off-Plan campaign details
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Developer</Label>
                    <Input
                      className="h-8 text-xs"
                      placeholder="e.g. Emaar"
                      value={form.offPlanFields.developer}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          offPlanFields: { ...form.offPlanFields, developer: e.target.value },
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Project</Label>
                    <Input
                      className="h-8 text-xs"
                      placeholder="e.g. Beachfront"
                      value={form.offPlanFields.project}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          offPlanFields: { ...form.offPlanFields, project: e.target.value },
                        })
                      }
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Area</Label>
                  <Input
                    className="h-8 text-xs"
                    placeholder="e.g. Dubai Marina"
                    value={form.offPlanFields.area}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        offPlanFields: { ...form.offPlanFields, area: e.target.value },
                      })
                    }
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Unit / property focus</Label>
                    <Input
                      className="h-8 text-xs"
                      placeholder="e.g. 1-2BR"
                      value={form.offPlanFields.unit_focus}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          offPlanFields: { ...form.offPlanFields, unit_focus: e.target.value },
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Buyer / investor objective</Label>
                    <Input
                      className="h-8 text-xs"
                      placeholder="e.g. Investment"
                      value={form.offPlanFields.buyer_objective}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          offPlanFields: { ...form.offPlanFields, buyer_objective: e.target.value },
                        })
                      }
                    />
                  </div>
                </div>
              </div>
            )}
            {isAvenueElite && form.campaignType === "secondary" && (
              <div className="space-y-3 rounded-md border border-border/60 p-3">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Secondary campaign details
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Area / community</Label>
                    <Input
                      className="h-8 text-xs"
                      placeholder="e.g. JVC"
                      value={form.secondaryFields.area}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          secondaryFields: { ...form.secondaryFields, area: e.target.value },
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Property type</Label>
                    <Input
                      className="h-8 text-xs"
                      placeholder="e.g. Apartment"
                      value={form.secondaryFields.property_type}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          secondaryFields: {
                            ...form.secondaryFields,
                            property_type: e.target.value,
                          },
                        })
                      }
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Bedrooms / unit focus</Label>
                    <Input
                      className="h-8 text-xs"
                      placeholder="e.g. 2-3BR"
                      value={form.secondaryFields.bedrooms_focus}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          secondaryFields: {
                            ...form.secondaryFields,
                            bedrooms_focus: e.target.value,
                          },
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Buyer objective</Label>
                    <Input
                      className="h-8 text-xs"
                      placeholder="e.g. End-user"
                      value={form.secondaryFields.buyer_objective}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          secondaryFields: {
                            ...form.secondaryFields,
                            buyer_objective: e.target.value,
                          },
                        })
                      }
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Price range (optional)</Label>
                  <Input
                    className="h-8 text-xs"
                    placeholder="e.g. AED 1.5M - 2.5M"
                    value={form.secondaryFields.price_range}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        secondaryFields: { ...form.secondaryFields, price_range: e.target.value },
                      })
                    }
                  />
                </div>
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs">When</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={form.sendWhen === "now" ? "default" : "outline"}
                  className="h-8 text-xs"
                  onClick={() =>
                    setForm({ ...form, sendWhen: "now", type: "broadcast", scheduled_at: "" })
                  }
                >
                  Save as draft
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

            {watiConnected && (
              <section className="space-y-2 border-t border-border/60 pt-3">
                <StepTitle n={2} title="Recipients" />
                {uploadTypeOptions.length > 0 && (
                  <Select
                    value={audienceUploadType || AUDIENCE_ALL_UPLOADS}
                    onValueChange={(v) => {
                      setAudienceUploadType(v === AUDIENCE_ALL_UPLOADS ? "" : v);
                      setShowAllParamFields(false);
                    }}
                  >
                    <SelectTrigger className="h-9 text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={AUDIENCE_ALL_UPLOADS}>All contacts</SelectItem>
                      {uploadTypeOptions.map((t: string) => (
                        <SelectItem key={t} value={t}>
                          {t}
                          {uploadCounts[t] ? ` · ${uploadCounts[t].unsent} not messaged` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">
                    {audienceScope.unsent} not messaged · {audienceScope.sent} already messaged
                  </span>
                  <label className="flex cursor-pointer items-center gap-1.5">
                    <Checkbox
                      checked={!skipAlreadySent}
                      onCheckedChange={(v) => setSkipAlreadySent(v !== true)}
                    />
                    Include already messaged
                  </label>
                </div>

                <div className="rounded-md border border-border/60">
                  <div className="flex items-center gap-2 border-b border-border/60 px-2 py-1.5">
                    <Checkbox
                      checked={audienceRows.length > 0 && pickedPhones.size === audienceRows.length}
                      onCheckedChange={(v) =>
                        setPickedPhones(
                          v === true
                            ? new Set(audienceRows.map((c) => String(c.phone ?? "").trim()))
                            : new Set(),
                        )
                      }
                      aria-label="Select all"
                    />
                    <Input
                      value={audienceSearch}
                      onChange={(e) => setAudienceSearch(e.target.value)}
                      placeholder="Search name or phone"
                      className="h-7 flex-1 border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0"
                    />
                    {pickedPhones.size > 0 && (
                      <button
                        type="button"
                        onClick={() => setPickedPhones(new Set())}
                        className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground"
                      >
                        Clear ({pickedPhones.size})
                      </button>
                    )}
                  </div>
                  <div className="max-h-48 overflow-y-auto p-1">
                    {audienceRows.length === 0 ? (
                      <div className="space-y-2 py-4 text-center text-xs text-muted-foreground">
                        <p>
                          {audienceSearch.trim()
                            ? "No contacts match your search."
                            : audienceScope.total === 0
                              ? "No contacts here yet. Import them under Contacts."
                              : "Everyone in this list has already been messaged."}
                        </p>
                        {audienceScope.total > 0 && skipAlreadySent && !audienceSearch.trim() && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 text-[11px]"
                            onClick={() => setSkipAlreadySent(false)}
                          >
                            Show them
                          </Button>
                        )}
                      </div>
                    ) : (
                      audienceRows.slice(0, 500).map((c) => {
                        const phone = String(c.phone ?? "").trim();
                        const sent = Boolean(
                          (c.wa_stats as { messaged?: boolean } | undefined)?.messaged,
                        );
                        return (
                          <label
                            key={phone}
                            className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-white/[0.03]"
                          >
                            <Checkbox
                              checked={pickedPhones.has(phone)}
                              onCheckedChange={(v) =>
                                setPickedPhones((prev) => {
                                  const next = new Set(prev);
                                  if (v === true) next.add(phone);
                                  else next.delete(phone);
                                  return next;
                                })
                              }
                            />
                            <span className="min-w-0 flex-1 truncate text-xs">
                              {String(c.name ?? "") || phone}
                            </span>
                            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                              {phone}
                            </span>
                            {sent && <span className="shrink-0 text-[10px] text-amber-400">sent</span>}
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
                {pickedPhones.size === 0 && audienceRows.length > 0 && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>No one ticked — send to the first</span>
                    <NumberInput
                      min={1}
                      max={Math.max(1, Math.min(5000, audienceRows.length))}
                      fallback={contactsBatchCap}
                      value={csvImportLimit}
                      onValueChange={setCsvImportLimit}
                      className="h-7 w-20 text-xs"
                    />
                    <span>of {audienceRows.length}</span>
                  </div>
                )}
              </section>
            )}

            <section className="space-y-2 border-t border-border/60 pt-3">
              <StepTitle n={watiConnected ? 3 : 2} title="Message" />
            {watiConnected ? (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">Template</Label>
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

                {/* The raw template text, until the real preview below is available. */}
                {selectedWatiTemplate &&
                  watiTemplateBodyPreview(selectedWatiTemplate) &&
                  !(sendPreview?.samples ?? []).length && (
                  <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground whitespace-pre-wrap">
                    {watiTemplateBodyPreview(selectedWatiTemplate)}
                  </div>
                )}

                {/* Placeholder-looking text with no variables behind it goes out
                    verbatim — WhatsApp only fills declared variables. */}
                {templateLiteralPlaceholders.length > 0 && (
                  <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-600 dark:text-amber-400">
                    <strong>{templateLiteralPlaceholders.join(", ")}</strong> is sent to everyone
                    exactly as written — this template has no variables.
                  </p>
                )}

                {paramSlots.length > 0 && (
                  <div className="space-y-2 rounded-md border border-border/60 p-3">
                    <Label className="text-xs">Personalise the message</Label>
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
                              onValueChange={(v) => {
                                // Reveals the rest of the list instead of mapping the slot.
                                if (v === "__show_all__") {
                                  setShowAllParamFields(true);
                                  return;
                                }
                                setForm({
                                  ...form,
                                  template_params: {
                                    ...form.template_params,
                                    [slot]: v === "__fixed__" ? encodeLiteralTemplateField("") : v,
                                  },
                                });
                              }}
                            >
                              <SelectTrigger className="h-8 text-xs flex-1">
                                <SelectValue placeholder="Lead / property field…" />
                              </SelectTrigger>
                              <SelectContent>
                                {relevantFields.map((f) => (
                                  <SelectItem key={f.value} value={f.value}>
                                    {f.label}
                                    {haveCoverage && (
                                      <span className="ml-1.5 text-[10px] text-muted-foreground">
                                        {f.sample ? `e.g. ${f.sample}` : `${f.coverage}% filled`}
                                      </span>
                                    )}
                                  </SelectItem>
                                ))}

                                {/* Not a field — an escape hatch for wording the template does not
                                    hold, like an agent name. Sits at the end so the actual data
                                    fields read as the primary choice. */}
                                <SelectItem value="__fixed__" className="text-muted-foreground">
                                  Type the same words for everyone…
                                </SelectItem>

                                {hiddenFieldCount > 0 && !showEveryField && (
                                  <SelectItem value="__show_all__" className="text-muted-foreground">
                                    Show {hiddenFieldCount} more field
                                    {hiddenFieldCount === 1 ? "" : "s"}
                                    {audienceUploadType.trim()
                                      ? ` not in "${audienceUploadType.trim()}"…`
                                      : "…"}
                                  </SelectItem>
                                )}

                                {showEveryField && (
                                  <>
                                    <SelectItem value="__group_empty__" disabled>
                                      — Not in this upload, or internal —
                                    </SelectItem>
                                    {[...emptyFields, ...genericPropertyFields.map((f) => ({
                                      value: f.value,
                                      label: f.label,
                                      coverage: 0,
                                      sample: "",
                                    }))].map((f) => (
                                      <SelectItem key={f.value} value={f.value}>
                                        {f.label}
                                      </SelectItem>
                                    ))}
                                  </>
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
                      <>
                        <p className="text-[11px] text-destructive">{paramMappingError}</p>
                      </>
                    )}

                  </div>
                )}

                {/* What will actually be sent. A variable that resolves for
                    nobody still sends — WATI rejects blank variables, so a
                    generic sample goes out instead — and nothing else in the
                    product surfaces that before customers receive it. */}
                {mappingComplete && (
                  <div className="space-y-2 border-t border-border/60 pt-2">
                    <div className="flex items-center gap-2">
                      <Label className="text-xs">Preview</Label>
                      {previewLoading && (
                        <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                      )}
                    </div>

                    {previewError && (
                      <div className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2">
                        <p className="text-[11px] text-destructive">
                          Preview could not load: {(previewError as Error).message}
                        </p>
                      </div>
                    )}

                    {deadSlots.length > 0 && (
                      <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2">
                        {deadSlots.map((p) => (
                          <p
                            key={p.slot}
                            className="text-[11px] text-amber-600 dark:text-amber-400"
                          >
                            <strong>{`{{${p.slot}}}`}</strong> uses <code>{p.fieldKey}</code>, which is empty for these contacts — pick another column.
                          </p>
                        ))}
                      </div>
                    )}

                    {(sendPreview?.samples ?? []).map(
                      (sample: {
                        leadId: string;
                        name: string | null;
                        phone: string | null;
                        body: string;
                        params: Array<{ name: string; value: string; resolved: boolean }>;
                      }) => (
                        <div
                          key={sample.leadId}
                          className="rounded-md border border-border/50 bg-muted/20 px-2.5 py-2"
                        >
                          <p className="mb-1 text-[10px] text-muted-foreground">
                            To {sample.name || "—"} · {sample.phone}
                          </p>
                          <p className="whitespace-pre-wrap text-[11px] leading-relaxed">
                            {sample.body}
                          </p>
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {sample.params.map((prm) => (
                              <span
                                key={prm.name}
                                className={cn(
                                  "rounded px-1 py-0.5 text-[9px]",
                                  prm.resolved
                                    ? "bg-white/[0.06] text-muted-foreground"
                                    : "bg-amber-500/15 text-amber-600 dark:text-amber-400",
                                )}
                              >
                                {prm.name}: {prm.value}
                                {prm.resolved ? "" : " (filler)"}
                              </span>
                            ))}
                          </div>
                        </div>
                      ),
                    )}

                    {sendPreview && sendPreview.samples.length === 0 && (
                      <p className="text-[11px] text-muted-foreground">
                        Nobody to preview yet — choose recipients above.
                      </p>
                    )}
                  </div>
                )}

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
            </section>
          </div>
          <DialogFooter className="flex-col items-stretch gap-2 sm:flex-col sm:space-x-0">
            <p
              className={cn(
                "text-center text-xs",
                createBlocker ? "text-amber-400" : "text-muted-foreground",
              )}
            >
              {createBlocker ??
                (watiConnected
                  ? `Will send to ${recipientCount} ${recipientCount === 1 ? "person" : "people"}`
                  : "")}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => create.mutate()} disabled={!canCreate || create.isPending}>
                {create.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
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

      <Dialog open={!!errorsCampaign} onOpenChange={(o) => !o && setErrorsCampaign(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-4 w-4" />
              {errorsCampaign?.stats?.failed ?? 0} message
              {(errorsCampaign?.stats?.failed ?? 0) === 1 ? "" : "s"} failed to send
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <p className="text-xs text-muted-foreground">
              "{errorsCampaign?.name}" — these are the exact errors WATI returned. "Sent" only means
              WATI accepted the request; it does not mean the recipient received it — a failed
              delivery shows up here, not as a success.
            </p>
            {Array.isArray(errorsCampaign?.stats?.errors) &&
            errorsCampaign.stats.errors.length > 0 ? (
              <ul className="max-h-64 space-y-1.5 overflow-y-auto rounded-md border border-border bg-muted/30 p-2">
                {errorsCampaign.stats.errors.map((err: string, i: number) => (
                  <li key={i} className="rounded bg-card px-2 py-1.5 text-xs text-destructive">
                    {err}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">
                No detailed error text was recorded for this send.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setErrorsCampaign(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
