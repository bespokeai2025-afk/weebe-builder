import { createFileRoute } from "@tanstack/react-router";
import { CampaignLeadsBoard } from "@/components/whatsapp/CampaignLeadsBoard";
import { useIsWbahWorkspace } from "@/hooks/useIsWbahWorkspace";

export const Route = createFileRoute("/_authenticated/campaign-leads")({
  head: () => ({ meta: [{ title: "Listing Leads — Webee" }] }),
  component: CampaignLeadsPage,
});

function CampaignLeadsPage() {
  const { isWbah } = useIsWbahWorkspace();
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
        <h1 className="text-2xl font-semibold tracking-tight">Listing leads</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Replies stay in Inbox until you set a remark. Then they appear here so you can keep chatting. Expired and closed chats stay off this list.
        </p>
      </div>
      <CampaignLeadsBoard />
    </div>
  );
}
