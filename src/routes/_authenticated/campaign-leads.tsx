import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { CampaignLeadsBoard } from "@/components/whatsapp/CampaignLeadsBoard";
import { ListingPipelineBoard } from "@/components/whatsapp/ListingPipelineBoard";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIsWbahWorkspace } from "@/hooks/useIsWbahWorkspace";

export const Route = createFileRoute("/_authenticated/campaign-leads")({
  head: () => ({ meta: [{ title: "Listing Leads — Webee" }] }),
  component: CampaignLeadsPage,
});

type BoardTab = "working" | "pipeline";

function CampaignLeadsPage() {
  const { isWbah } = useIsWbahWorkspace();
  const [tab, setTab] = useState<BoardTab>("working");

  if (isWbah) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Listing leads are not used in the Webuyanyhouse workspace.
      </div>
    );
  }
  return (
    <div className="flex h-[calc(100dvh-2.5rem)] min-h-0 flex-col overflow-hidden px-4 pb-3 pt-3 md:px-5">
      <div className="mb-4 shrink-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {tab === "working" ? "Listing leads" : "Listing pipeline"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {tab === "working"
                ? "Replies stay in Inbox until you set a remark. Then they appear here so you can keep chatting. Expired and closed chats stay off this list."
                : "Once a client agrees to list with you, the lead moves here — Agreed through Closed, tracking what happened to the listing."}
            </p>
          </div>
          <Tabs value={tab} onValueChange={(v) => setTab(v as BoardTab)}>
            <TabsList>
              <TabsTrigger value="working">Working leads</TabsTrigger>
              <TabsTrigger value="pipeline">Listing pipeline</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>
      {tab === "working" ? <CampaignLeadsBoard /> : <ListingPipelineBoard />}
    </div>
  );
}
