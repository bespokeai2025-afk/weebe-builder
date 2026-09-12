import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ClipboardList,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  MessageCircle,
  Phone,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { RelativeTime } from "@/components/ui/relative-time";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LeadWhatsAppPanel } from "@/components/leads/LeadWhatsAppPanel";
import { CampaignQualificationForm } from "@/components/whatsapp/CampaignQualificationForm";
import { OffPlanQualificationForm } from "@/components/whatsapp/OffPlanQualificationForm";
import { SecondaryQualificationForm } from "@/components/whatsapp/SecondaryQualificationForm";
import { OpenLeadLink } from "@/components/whatsapp/OpenLeadLink";
import { getWhatsappInboxMeta } from "@/lib/dashboard/whatsapp.functions";
import {
  BUZZ_SEARCH,
  BUZZ_SELECT,
  BuzzchatEmptyState,
  BuzzchatTableSkeleton,
} from "@/components/whatsapp/buzzchat-ui";
import {
  exportCampaignLeadsCsv,
  listCampaignLeads,
  updateCampaignFollowUp,
  updateCampaignLeadStage,
  updateCampaignQualification,
  updateListingOutcome,
  type CampaignLeadRow,
} from "@/lib/whatsapp/campaign-leads.functions";
import {
  CAMPAIGN_LEAD_STAGE_LABELS,
  SIMPLIFIED_LEAD_STAGES,
  SIMPLIFIED_LISTING_REMARKS,
  LISTING_OUTCOME_LABELS,
  EMPTY_CAMPAIGN_FOLLOW_UP,
  EMPTY_CAMPAIGN_QUALIFICATION,
  defaultWhatsappReengagementMessage,
  isCampaignFollowUpDueSoon,
  isCampaignFollowUpOverdue,
  isWhatsappFreeTextAllowed,
  whatsappPersonalLink,
  type CampaignFollowUp,
  type CampaignLeadStage,
  type CampaignQualification,
} from "@/lib/whatsapp/campaign-leads.shared";
import { WhatsAppWindowCountdown } from "@/components/whatsapp/WhatsAppWindowCountdown";
import {
  EMPTY_OFF_PLAN_QUALIFICATION,
  EMPTY_SECONDARY_QUALIFICATION,
  isActiveOutcomeForCampaignType,
  outcomeLabelsForCampaignType,
  type CampaignOutcome,
  type CampaignType,
  type OffPlanQualification,
  type SecondaryQualification,
} from "@/lib/whatsapp/campaign-types.shared";

const ALL = "__all__";
const UNASSIGNED = "__unassigned__";
const UNSET_STAGE = "__unset__";
const NEEDS_REMARK = "__unset__";

type SheetTab = "conversation" | "qualification";

const STAGE_TONE: Record<string, string> = {
  converted: "bg-success/15 text-success",
  follow_up: "bg-amber-500/15 text-amber-600",
  closed: "bg-muted text-muted-foreground",
};

/** A lead starts with no stage marked — only Follow-up/Converted/Cancelled are ever picked manually. */
function displayStage(stage: string | null): string {
  return (SIMPLIFIED_LEAD_STAGES as readonly string[]).includes(stage ?? "") ? (stage as string) : UNSET_STAGE;
}

/** Outcome value regardless of vocabulary — a lead is either a listing or buyer lead, never both. */
function leadOutcome(lead: CampaignLeadRow): CampaignOutcome | null {
  return lead.listing_outcome ?? lead.buyer_outcome ?? null;
}

/** Live remarked replies on the board — generalizes belongsOnListingBoard across all campaign types. */
function belongsOnBoard(lead: CampaignLeadRow, now: number = Date.now()): boolean {
  if (!isActiveOutcomeForCampaignType(lead.campaign_type, leadOutcome(lead))) return false;
  return isWhatsappFreeTextAllowed(lead.last_reply_at, now);
}

/** Stage "closed" (labeled "Cancelled") archives a lead out of the active working board by default. */
function isArchivedStage(lead: CampaignLeadRow): boolean {
  return lead.stage === "closed";
}

function leadHaystack(lead: CampaignLeadRow): string {
  return [
    lead.full_name,
    lead.phone,
    lead.email,
    lead.property,
    lead.area,
    lead.requirement,
    lead.assigned_name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function CampaignLeadsBoard() {
  const qc = useQueryClient();
  const listFn = useServerFn(listCampaignLeads);
  const exportFn = useServerFn(exportCampaignLeadsCsv);
  const stageFn = useServerFn(updateCampaignLeadStage);
  const qualFn = useServerFn(updateCampaignQualification);
  const outcomeFn = useServerFn(updateListingOutcome);
  const followUpFn = useServerFn(updateCampaignFollowUp);
  const metaFn = useServerFn(getWhatsappInboxMeta);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [area, setArea] = useState(ALL);
  const [campaign, setCampaign] = useState(ALL);
  const [stage, setStage] = useState(ALL);
  const [remark, setRemark] = useState(ALL);
  const [agent, setAgent] = useState(ALL);
  const [selected, setSelected] = useState<CampaignLeadRow | null>(null);
  const [draftQual, setDraftQual] = useState<CampaignQualification>(EMPTY_CAMPAIGN_QUALIFICATION);
  const [draftOffPlanQual, setDraftOffPlanQual] = useState<OffPlanQualification>(EMPTY_OFF_PLAN_QUALIFICATION);
  const [draftSecondaryQual, setDraftSecondaryQual] = useState<SecondaryQualification>(EMPTY_SECONDARY_QUALIFICATION);
  const [draftFollowUp, setDraftFollowUp] = useState<CampaignFollowUp>(EMPTY_CAMPAIGN_FOLLOW_UP);
  const [draftOutcomeReason, setDraftOutcomeReason] = useState("");
  const [sheetTab, setSheetTab] = useState<SheetTab>("conversation");

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim().toLowerCase()), 200);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["campaign-leads"],
    queryFn: () => listFn({ data: { limit: 500 } }),
    staleTime: 15_000,
    throwOnError: false,
  });
  const { data: meta } = useQuery({
    queryKey: ["wa-inbox-meta"],
    queryFn: () => metaFn(),
    staleTime: 60_000,
    throwOnError: false,
  });

  const allLeads = data?.leads ?? [];

  const areas = useMemo(() => {
    const fromLeads = allLeads.map((l) => l.area).filter(Boolean);
    return [...new Set([...(meta?.areas ?? []), ...fromLeads])].sort((a, b) => a.localeCompare(b));
  }, [allLeads, meta?.areas]);

  const campaigns = useMemo(() => {
    const map = new Map<string, string>();
    for (const lead of allLeads) {
      if (lead.campaign_id) map.set(lead.campaign_id, lead.campaign_name || lead.campaign_id);
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [allLeads]);

  const remarkBase = useMemo(() => {
    return allLeads.filter((lead) => {
      if (search && !leadHaystack(lead).includes(search)) return false;
      if (area !== ALL && lead.area !== area) return false;
      if (campaign !== ALL && lead.campaign_id !== campaign) return false;
      if (stage !== ALL && displayStage(lead.stage) !== stage) return false;
      if (remark !== ALL && (leadOutcome(lead) ?? NEEDS_REMARK) !== remark) return false;
      if (agent === UNASSIGNED && lead.assigned_to) return false;
      if (agent !== ALL && agent !== UNASSIGNED && lead.assigned_to !== agent) return false;
      return true;
    });
  }, [allLeads, search, area, campaign, stage, remark, agent]);

  // Picking a specific Stage or Remark is a deliberate "browse the archive"
  // action — it drops the default working-board gates (active outcome, open
  // WhatsApp window, not-cancelled) so leads that already left the live view
  // (Cancelled, Not interested, Sold, etc.) can still be found.
  const browsingArchive = stage !== ALL || remark !== ALL;
  const leads = useMemo(() => {
    if (browsingArchive) return remarkBase;
    return remarkBase.filter((lead) => !isArchivedStage(lead) && belongsOnBoard(lead));
  }, [remarkBase, browsingArchive]);

  const openLead = (lead: CampaignLeadRow) => {
    setSelected(lead);
    setDraftQual(lead.qualification ?? EMPTY_CAMPAIGN_QUALIFICATION);
    setDraftOffPlanQual(lead.off_plan_qualification ?? EMPTY_OFF_PLAN_QUALIFICATION);
    setDraftSecondaryQual(lead.secondary_qualification ?? EMPTY_SECONDARY_QUALIFICATION);
    setDraftFollowUp(lead.follow_up ?? EMPTY_CAMPAIGN_FOLLOW_UP);
    setDraftOutcomeReason(lead.outcome_reason ?? "");
    setSheetTab("conversation");
  };

  const saveStage = useMutation({
    mutationFn: (input: { leadId: string; stage: CampaignLeadStage }) =>
      stageFn({ data: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaign-leads"] });
      qc.invalidateQueries({ queryKey: ["pipeline-leads"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveOutcome = useMutation({
    mutationFn: (input: {
      leadId: string;
      outcome: CampaignOutcome;
      campaignType: CampaignType;
      reason?: string | null;
    }) => outcomeFn({ data: { leadId: input.leadId, outcome: input.outcome, reason: input.reason ?? null } }),
    onSuccess: (_, input) => {
      qc.invalidateQueries({ queryKey: ["campaign-leads"] });
      qc.invalidateQueries({ queryKey: ["pipeline-leads"] });
      qc.invalidateQueries({ queryKey: ["wa-threads"] });
      setSelected((cur) =>
        cur?.id === input.leadId
          ? input.campaignType === "listing_acquisition"
            ? { ...cur, listing_outcome: input.outcome as never, buyer_outcome: null, outcome_reason: input.reason ?? null }
            : { ...cur, buyer_outcome: input.outcome as never, listing_outcome: null, outcome_reason: input.reason ?? null }
          : cur,
      );
      toast.success("Remark saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveQual = useMutation({
    mutationFn: () => {
      const type = selected?.campaign_type ?? "listing_acquisition";
      const qualification =
        type === "off_plan" ? draftOffPlanQual : type === "secondary" ? draftSecondaryQual : draftQual;
      return qualFn({
        data: { leadId: selected!.id, qualification: qualification as unknown as Record<string, string> },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaign-leads"] });
      toast.success("Qualification saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveFollowUp = useMutation({
    mutationFn: () =>
      followUpFn({
        data: { leadId: selected!.id, date: draftFollowUp.date, nextAction: draftFollowUp.nextAction },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaign-leads"] });
      toast.success("Follow-up saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const downloadCsv = async () => {
    try {
      const res = await exportFn({ data: {} });
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "listing-leads.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    }
  };

  const hasFilters =
    Boolean(search) || area !== ALL || campaign !== ALL || stage !== ALL || remark !== ALL || agent !== ALL;
  const blankLeads = !hasFilters && leads.length === 0;
  const selectedStage = (selected?.stage as CampaignLeadStage | null) ?? null;

  const clearFilters = () => {
    setSearchInput("");
    setSearch("");
    setArea(ALL);
    setCampaign(ALL);
    setStage(ALL);
    setRemark(ALL);
    setAgent(ALL);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search name, phone, area, or listing…"
            aria-label="Search listing leads"
            className={BUZZ_SEARCH}
          />
          {searchInput && (
            <button
              type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => {
                setSearchInput("");
                setSearch("");
              }}
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {areas.length > 0 && (
          <Select value={area} onValueChange={setArea}>
            <SelectTrigger className={cn(BUZZ_SELECT, "w-40")} aria-label="Area">
              <SelectValue placeholder="Area" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All areas</SelectItem>
              {areas.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {campaigns.length > 0 && (
          <Select value={campaign} onValueChange={setCampaign}>
            <SelectTrigger className={cn(BUZZ_SELECT, "w-40")} aria-label="Campaign">
              <SelectValue placeholder="Campaign" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All campaigns</SelectItem>
              {campaigns.map(([id, name]) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Select value={agent} onValueChange={setAgent}>
          <SelectTrigger className={cn(BUZZ_SELECT, "w-40")} aria-label="Agent">
            <SelectValue placeholder="Agent" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Anyone</SelectItem>
            <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
            {(meta?.members ?? []).map((m) => (
              <SelectItem key={m.userId} value={m.userId}>
                {m.name ?? m.userId.slice(0, 8)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasFilters && (
          <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
            Clear
          </Button>
        )}

        <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={downloadCsv}>
          <Download className="h-3.5 w-3.5" />
          Export
        </Button>
        {isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Refreshing" />}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-14 shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Stage
          </span>
          <Tabs value={stage} onValueChange={setStage}>
            <TabsList className="h-8 w-full justify-start overflow-x-auto sm:w-auto">
              <TabsTrigger value={ALL} className="text-xs">
                All
              </TabsTrigger>
              <TabsTrigger value={UNSET_STAGE} className="text-xs">
                Not set
              </TabsTrigger>
              {SIMPLIFIED_LEAD_STAGES.map((id) => (
                <TabsTrigger key={id} value={id} className="text-xs">
                  {CAMPAIGN_LEAD_STAGE_LABELS[id]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="w-14 shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Remark
          </span>
          <Tabs value={remark} onValueChange={setRemark}>
            <TabsList className="h-8 w-full justify-start overflow-x-auto sm:w-auto">
              <TabsTrigger value={ALL} className="text-xs">
                All
              </TabsTrigger>
              <TabsTrigger value={NEEDS_REMARK} className="text-xs">
                Needs remark
              </TabsTrigger>
              {SIMPLIFIED_LISTING_REMARKS.map((id) => (
                <TabsTrigger key={id} value={id} className="text-xs">
                  {LISTING_OUTCOME_LABELS[id]}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        {blankLeads
          ? "Waiting for remarks"
          : `${leads.length} lead${leads.length === 1 ? "" : "s"}${
              data?.total != null && data.total !== allLeads.length ? ` of ${data.total}` : ""
            }${hasFilters ? " matching" : ""}. Click a row to chat or assign.`}
      </p>

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border bg-card">
        {isLoading ? (
          <BuzzchatTableSkeleton />
        ) : leads.length === 0 ? (
          <BuzzchatEmptyState
            icon={ClipboardList}
            title={blankLeads ? "Listing leads is empty" : "Nothing matches"}
            description={
              blankLeads
                ? "Replies stay in Inbox until you set a remark. Expired, closed, and older remarked chats stay off this list."
                : "Clear search or the dropdowns to see the rest of the list."
            }
            action={
              hasFilters ? (
                <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : (
                <Button asChild size="sm">
                  <a href="/whatsapp?tab=inbox">Open inbox</a>
                </Button>
              )
            }
          />
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-10 bg-muted/90 text-xs font-medium uppercase tracking-wide text-muted-foreground backdrop-blur">
              <tr>
                <th className="px-3 py-2.5 font-medium">Owner</th>
                <th className="px-3 py-2.5 font-medium">Listing</th>
                <th className="px-3 py-2.5 font-medium">Remark</th>
                <th className="px-3 py-2.5 font-medium">Stage</th>
                <th className="px-3 py-2.5 font-medium">Agent</th>
                <th className="px-3 py-2.5 font-medium">Reply</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => {
                const stageId = displayStage(lead.stage);
                return (
                  <tr
                    key={lead.id}
                    className="cursor-pointer border-t border-border/60 hover:bg-muted/40"
                    onClick={() => openLead(lead)}
                  >
                    <td className="px-3 py-2.5">
                      <p className="font-medium text-foreground">{lead.full_name || lead.phone || "Unknown"}</p>
                      {lead.phone && (
                        <p className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Phone className="h-2.5 w-2.5" />
                          {lead.phone}
                        </p>
                      )}
                      {isCampaignFollowUpOverdue(lead.follow_up) ? (
                        <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-destructive/15 px-1.5 py-0.5 text-[9px] font-medium text-destructive">
                          Follow-up overdue
                        </span>
                      ) : isCampaignFollowUpDueSoon(lead.follow_up) ? (
                        <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-medium text-amber-500">
                          Follow-up due soon
                        </span>
                      ) : null}
                    </td>
                    <td className="max-w-56 px-3 py-2.5">
                      <p className="truncate text-foreground/90">{lead.property || "No property on file"}</p>
                      <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                        {[lead.area, lead.requirement].filter(Boolean).join(" · ") || "Area not set"}
                      </p>
                    </td>
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <Select
                        value={leadOutcome(lead) ?? "__unset__"}
                        onValueChange={(v) => {
                          if (v === "__unset__") return;
                          saveOutcome.mutate({
                            leadId: lead.id,
                            outcome: v as CampaignOutcome,
                            campaignType: lead.campaign_type,
                            reason: lead.outcome_reason,
                          });
                        }}
                      >
                        <SelectTrigger
                          className={cn(
                            "h-7 w-40 border-0 text-[11px] font-medium shadow-none",
                            leadOutcome(lead)
                              ? "bg-muted/80"
                              : "bg-warning/15 text-warning",
                          )}
                        >
                          <SelectValue placeholder="Set remark" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__unset__">Needs remark</SelectItem>
                          {outcomeLabelsForCampaignType(lead.campaign_type).map(({ id, label }) => (
                            <SelectItem key={id} value={id}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <Select
                        value={stageId}
                        onValueChange={(v) => {
                          if (v === UNSET_STAGE) return;
                          saveStage.mutate({ leadId: lead.id, stage: v as CampaignLeadStage });
                        }}
                      >
                        <SelectTrigger
                          className={cn(
                            "h-7 w-32 border-0 text-[11px] font-medium shadow-none",
                            STAGE_TONE[stageId] ?? "bg-muted text-muted-foreground",
                          )}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={UNSET_STAGE}>Not set</SelectItem>
                          {SIMPLIFIED_LEAD_STAGES.map((id) => (
                            <SelectItem key={id} value={id}>
                              {CAMPAIGN_LEAD_STAGE_LABELS[id]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={lead.assigned_name ? "text-foreground" : "text-muted-foreground"}>
                        {lead.assigned_name || "Unassigned"}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          {lead.last_reply_at ? <RelativeTime date={lead.last_reply_at} /> : "No reply"}
                        </div>
                        <WhatsAppWindowCountdown lastInboundAt={lead.last_reply_at} />
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-primary hover:bg-muted"
                          aria-label="Open chat"
                          onClick={(e) => {
                            e.stopPropagation();
                            openLead(lead);
                          }}
                        >
                          <MessageCircle className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <Sheet
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <SheetContent className="flex w-full flex-col overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle className="pr-6">{selected?.full_name || selected?.phone || "Listing lead"}</SheetTitle>
          </SheetHeader>
          {selected && (
            <div className="mt-4 space-y-5">
              {selected.phone && (() => {
                const sessionOpen = isWhatsappFreeTextAllowed(selected.last_reply_at);
                const reengagementMessage = !sessionOpen
                  ? defaultWhatsappReengagementMessage({
                      contactName: selected.full_name,
                      property: selected.property,
                    })
                  : null;
                const link = whatsappPersonalLink(selected.phone, reengagementMessage);
                return (
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        void navigator.clipboard.writeText(selected.phone ?? "");
                        toast.success("Number copied");
                      }}
                    >
                      <Phone className="h-3 w-3" />
                      {selected.phone}
                      <Copy className="h-3 w-3 opacity-60" />
                    </button>
                    <WhatsAppWindowCountdown lastInboundAt={selected.last_reply_at} />
                    {link && (
                      <a
                        href={link}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" />
                        {sessionOpen ? "Send from my WhatsApp" : "Chat on WhatsApp"}
                      </a>
                    )}
                  </div>
                );
              })()}
              <p className="text-xs text-muted-foreground">
                {[selected.area, selected.property].filter(Boolean).join(" · ") || "No property on file"}
                {selected.requirement ? ` · ${selected.requirement}` : ""}
              </p>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Remark
                  </p>
                  <Select
                    value={leadOutcome(selected) ?? "__unset__"}
                    onValueChange={(v) => {
                      if (v === "__unset__") return;
                      saveOutcome.mutate({
                        leadId: selected.id,
                        outcome: v as CampaignOutcome,
                        campaignType: selected.campaign_type,
                        reason: draftOutcomeReason || null,
                      });
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Set remark" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__unset__">Needs remark</SelectItem>
                      {outcomeLabelsForCampaignType(selected.campaign_type).map(({ id, label }) => (
                        <SelectItem key={id} value={id}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Stage
                  </p>
                  <Select
                    value={displayStage(selectedStage)}
                    onValueChange={(v) => {
                      if (v === UNSET_STAGE) return;
                      saveStage.mutate({ leadId: selected.id, stage: v as CampaignLeadStage });
                      setSelected({ ...selected, stage: v });
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNSET_STAGE}>Not set</SelectItem>
                      {SIMPLIFIED_LEAD_STAGES.map((id) => (
                        <SelectItem key={id} value={id}>
                          {CAMPAIGN_LEAD_STAGE_LABELS[id]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Remark reason (optional)
                </p>
                <div className="flex gap-2">
                  <Input
                    className="h-8 text-xs"
                    placeholder="e.g. Wants a higher price"
                    value={draftOutcomeReason}
                    onChange={(e) => setDraftOutcomeReason(e.target.value)}
                    onBlur={() => {
                      const outcome = leadOutcome(selected);
                      if (!outcome) return;
                      if ((selected.outcome_reason ?? "") === draftOutcomeReason) return;
                      saveOutcome.mutate({
                        leadId: selected.id,
                        outcome,
                        campaignType: selected.campaign_type,
                        reason: draftOutcomeReason || null,
                      });
                    }}
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <OpenLeadLink leadId={selected.id} />
              </div>

              <Tabs value={sheetTab} onValueChange={(v) => setSheetTab(v as SheetTab)} className="border-t border-border pt-3">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="conversation" className="gap-1.5 text-xs">
                    <MessageCircle className="h-3.5 w-3.5" />
                    Conversation
                  </TabsTrigger>
                  <TabsTrigger value="qualification" className="gap-1.5 text-xs">
                    <ClipboardList className="h-3.5 w-3.5" />
                    Qualification
                    {(isCampaignFollowUpOverdue(draftFollowUp) || isCampaignFollowUpDueSoon(draftFollowUp)) && (
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          isCampaignFollowUpOverdue(draftFollowUp) ? "bg-destructive" : "bg-amber-500",
                        )}
                      />
                    )}
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="conversation" className="pt-4">
                  <LeadWhatsAppPanel
                    leadId={selected.id}
                    phone={selected.phone}
                    contactName={selected.full_name}
                  />
                </TabsContent>

                <TabsContent value="qualification" className="space-y-5 pt-4">
                  <div>
                    <p className="mb-3 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Qualification
                    </p>
                    {selected.campaign_type === "off_plan" ? (
                      <OffPlanQualificationForm value={draftOffPlanQual} onChange={setDraftOffPlanQual} compact />
                    ) : selected.campaign_type === "secondary" ? (
                      <SecondaryQualificationForm value={draftSecondaryQual} onChange={setDraftSecondaryQual} compact />
                    ) : (
                      <CampaignQualificationForm value={draftQual} onChange={setDraftQual} compact />
                    )}
                    <Button
                      type="button"
                      className="mt-4 w-full"
                      disabled={saveQual.isPending}
                      onClick={() => saveQual.mutate()}
                    >
                      {saveQual.isPending ? "Saving…" : "Save qualification"}
                    </Button>
                  </div>

                  <div className="border-t border-border pt-4">
                    <div className="mb-3 flex items-center gap-2">
                      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Follow-up
                      </p>
                      {isCampaignFollowUpOverdue(draftFollowUp) && (
                        <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-medium text-destructive">
                          Overdue
                        </span>
                      )}
                      {!isCampaignFollowUpOverdue(draftFollowUp) && isCampaignFollowUpDueSoon(draftFollowUp) && (
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-500">
                          Due soon
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Follow-up date</Label>
                        <Input
                          type="datetime-local"
                          className="h-8 text-xs"
                          value={draftFollowUp.date ? draftFollowUp.date.slice(0, 16) : ""}
                          onChange={(e) =>
                            setDraftFollowUp({
                              ...draftFollowUp,
                              date: e.target.value ? new Date(e.target.value).toISOString() : null,
                            })
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Next action</Label>
                        <Input
                          className="h-8 text-xs"
                          placeholder="e.g. Call about the offer"
                          value={draftFollowUp.nextAction}
                          onChange={(e) => setDraftFollowUp({ ...draftFollowUp, nextAction: e.target.value })}
                        />
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-3 w-full"
                      disabled={saveFollowUp.isPending}
                      onClick={() => saveFollowUp.mutate()}
                    >
                      {saveFollowUp.isPending ? "Saving…" : "Save follow-up"}
                    </Button>
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          )}
        </SheetContent>
      </Sheet>

    </div>
  );
}
