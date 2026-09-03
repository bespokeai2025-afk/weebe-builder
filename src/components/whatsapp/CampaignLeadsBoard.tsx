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
  UserPlus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { AssignLeadsDialog } from "@/components/leads/AssignLeadsDialog";
import { LeadWhatsAppPanel } from "@/components/leads/LeadWhatsAppPanel";
import { CampaignQualificationForm } from "@/components/whatsapp/CampaignQualificationForm";
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
  updateCampaignLeadStage,
  updateCampaignQualification,
  updateListingOutcome,
  type CampaignLeadRow,
} from "@/lib/whatsapp/campaign-leads.functions";
import {
  CAMPAIGN_LEAD_STAGE_LABELS,
  CAMPAIGN_LEAD_STAGES,
  EMPTY_CAMPAIGN_QUALIFICATION,
  LISTING_OUTCOME_LABELS,
  LISTING_OUTCOMES,
  belongsOnListingBoard,
  whatsappPersonalLink,
  type CampaignLeadStage,
  type CampaignQualification,
  type ListingOutcome,
} from "@/lib/whatsapp/campaign-leads.shared";

const ALL = "__all__";
const UNASSIGNED = "__unassigned__";

const STAGE_TONE: Record<string, string> = {
  converted: "bg-success/15 text-success",
  no_activity: "bg-destructive/10 text-destructive",
  closed: "bg-muted text-muted-foreground",
};

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
  const metaFn = useServerFn(getWhatsappInboxMeta);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [area, setArea] = useState(ALL);
  const [stage, setStage] = useState(ALL);
  const [agent, setAgent] = useState(ALL);
  const [selected, setSelected] = useState<CampaignLeadRow | null>(null);
  const [draftQual, setDraftQual] = useState<CampaignQualification>(EMPTY_CAMPAIGN_QUALIFICATION);
  const [assignIds, setAssignIds] = useState<string[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim().toLowerCase()), 200);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["campaign-leads"],
    queryFn: () => listFn({ data: { limit: 500 } }),
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

  const remarkBase = useMemo(() => {
    return allLeads.filter((lead) => {
      if (search && !leadHaystack(lead).includes(search)) return false;
      if (area !== ALL && lead.area !== area) return false;
      if (stage !== ALL && (lead.stage || "new_response") !== stage) return false;
      if (agent === UNASSIGNED && lead.assigned_to) return false;
      if (agent !== ALL && agent !== UNASSIGNED && lead.assigned_to !== agent) return false;
      return true;
    });
  }, [allLeads, search, area, stage, agent]);

  const leads = useMemo(() => {
    return remarkBase.filter((lead) => belongsOnListingBoard(lead));
  }, [remarkBase]);

  const openLead = (lead: CampaignLeadRow) => {
    setSelected(lead);
    setDraftQual(lead.qualification ?? EMPTY_CAMPAIGN_QUALIFICATION);
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
    mutationFn: (input: { leadId: string; outcome: ListingOutcome }) =>
      outcomeFn({ data: input }),
    onSuccess: (_, input) => {
      qc.invalidateQueries({ queryKey: ["campaign-leads"] });
      qc.invalidateQueries({ queryKey: ["pipeline-leads"] });
      qc.invalidateQueries({ queryKey: ["wa-threads"] });
      setSelected((cur) =>
        cur?.id === input.leadId ? { ...cur, listing_outcome: input.outcome } : cur,
      );
      toast.success("Remark saved");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveQual = useMutation({
    mutationFn: () =>
      qualFn({
        data: { leadId: selected!.id, qualification: draftQual },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["campaign-leads"] });
      toast.success("Qualification saved");
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
    Boolean(search) || area !== ALL || stage !== ALL || agent !== ALL;
  const blankLeads = !hasFilters && leads.length === 0;
  const selectedStage = (selected?.stage as CampaignLeadStage | null) ?? null;

  const clearFilters = () => {
    setSearchInput("");
    setSearch("");
    setArea(ALL);
    setStage(ALL);
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

        <Select value={stage} onValueChange={setStage}>
          <SelectTrigger className={cn(BUZZ_SELECT, "w-40")} aria-label="Stage">
            <SelectValue placeholder="Stage" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All stages</SelectItem>
            {CAMPAIGN_LEAD_STAGES.map((id) => (
              <SelectItem key={id} value={id}>
                {CAMPAIGN_LEAD_STAGE_LABELS[id]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

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
                const stageId = (lead.stage as string) || "new_response";
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
                    </td>
                    <td className="max-w-56 px-3 py-2.5">
                      <p className="truncate text-foreground/90">{lead.property || "No property on file"}</p>
                      <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                        {[lead.area, lead.requirement].filter(Boolean).join(" · ") || "Area not set"}
                      </p>
                    </td>
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <Select
                        value={lead.listing_outcome ?? "__unset__"}
                        onValueChange={(v) => {
                          if (v === "__unset__") return;
                          saveOutcome.mutate({ leadId: lead.id, outcome: v as ListingOutcome });
                        }}
                      >
                        <SelectTrigger
                          className={cn(
                            "h-7 w-40 border-0 text-[11px] font-medium shadow-none",
                            lead.listing_outcome
                              ? "bg-muted/80"
                              : "bg-warning/15 text-warning",
                          )}
                        >
                          <SelectValue placeholder="Set remark" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__unset__">Needs remark</SelectItem>
                          {LISTING_OUTCOMES.map((id) => (
                            <SelectItem key={id} value={id}>
                              {LISTING_OUTCOME_LABELS[id]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <Select
                        value={stageId}
                        onValueChange={(v) =>
                          saveStage.mutate({ leadId: lead.id, stage: v as CampaignLeadStage })
                        }
                      >
                        <SelectTrigger
                          className={cn(
                            "h-7 w-36 border-0 text-[11px] font-medium shadow-none",
                            STAGE_TONE[stageId] ?? "bg-muted",
                          )}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CAMPAIGN_LEAD_STAGES.map((id) => (
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
                      <div className="flex items-center gap-2">
                        {lead.last_reply_at ? <RelativeTime date={lead.last_reply_at} /> : "No reply"}
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
              {selected.phone && (
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
                  {whatsappPersonalLink(selected.phone) && (
                    <a
                      href={whatsappPersonalLink(selected.phone)!}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Send from my WhatsApp
                    </a>
                  )}
                </div>
              )}
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
                    value={selected.listing_outcome ?? "__unset__"}
                    onValueChange={(v) => {
                      if (v === "__unset__") return;
                      saveOutcome.mutate({ leadId: selected.id, outcome: v as ListingOutcome });
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Set remark" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__unset__">Needs remark</SelectItem>
                      {LISTING_OUTCOMES.map((id) => (
                        <SelectItem key={id} value={id}>
                          {LISTING_OUTCOME_LABELS[id]}
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
                    value={selectedStage || "new_response"}
                    onValueChange={(v) => {
                      saveStage.mutate({ leadId: selected.id, stage: v as CampaignLeadStage });
                      setSelected({ ...selected, stage: v });
                    }}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CAMPAIGN_LEAD_STAGES.map((id) => (
                        <SelectItem key={id} value={id}>
                          {CAMPAIGN_LEAD_STAGE_LABELS[id]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setAssignIds([selected.id])}
                >
                  <UserPlus className="mr-1 h-3.5 w-3.5" />
                  {selected.assigned_name ? `Assigned · ${selected.assigned_name}` : "Assign agent"}
                </Button>
                <OpenLeadLink leadId={selected.id} />
              </div>

              <div className="border-t border-border pt-4">
                <LeadWhatsAppPanel leadId={selected.id} phone={selected.phone} />
              </div>

              <div className="border-t border-border pt-4">
                <p className="mb-3 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Qualification
                </p>
                <CampaignQualificationForm value={draftQual} onChange={setDraftQual} compact />
                <Button
                  type="button"
                  className="mt-4 w-full"
                  disabled={saveQual.isPending}
                  onClick={() => saveQual.mutate()}
                >
                  {saveQual.isPending ? "Saving…" : "Save qualification"}
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      <AssignLeadsDialog
        open={assignIds.length > 0}
        onOpenChange={(open) => !open && setAssignIds([])}
        leadIds={assignIds}
        currentAssignee={
          assignIds.length === 1
            ? (selected?.id === assignIds[0] ? selected.assigned_to : allLeads.find((l) => l.id === assignIds[0])?.assigned_to)
            : undefined
        }
        onAssigned={() => {
          qc.invalidateQueries({ queryKey: ["campaign-leads"] });
        }}
      />
    </div>
  );
}
