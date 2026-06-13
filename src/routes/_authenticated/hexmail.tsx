import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Mail, FileText, Settings, LayoutGrid, CalendarDays } from "lucide-react";
import { FollowUpCentre } from "@/components/hexmail/FollowUpCentre";
import { TemplateStudio } from "@/components/hexmail/TemplateStudio";
import { HexMailSettings } from "@/components/hexmail/HexMailSettings";
import { CampaignTimeline } from "@/components/hexmail/CampaignTimeline";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/hexmail")({
  head: () => ({
    meta: [
      { title: "HexMail — Webee" },
      { name: "description", content: "Multi-channel follow-up campaigns and reusable content templates." },
    ],
  }),
  component: HexmailPage,
});

type FollowUpView = "cards" | "timeline";

function HexmailPage() {
  const [followUpView, setFollowUpView] = useState<FollowUpView>("cards");
  const [timelineCampaignId, setTimelineCampaignId] = useState<string | undefined>(undefined);

  const handleOpenBuilder = (campaignId?: string) => {
    setTimelineCampaignId(campaignId);
    setFollowUpView("timeline");
  };

  return (
    <div className="flex flex-col h-full p-6 gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">HexMail</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Multi-channel follow-up campaigns and reusable content templates.
        </p>
      </div>

      <Tabs defaultValue="templates" className="flex-1 flex flex-col min-h-0">
        <TabsList className="w-fit">
          <TabsTrigger value="templates" className="gap-2">
            <FileText className="h-4 w-4" />
            Template Studio
          </TabsTrigger>
          <TabsTrigger value="followup" className="gap-2">
            <Mail className="h-4 w-4" />
            Follow-Up Centre
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-2">
            <Settings className="h-4 w-4" />
            Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="templates" className="flex-1 flex flex-col min-h-0 mt-4">
          <TemplateStudio />
        </TabsContent>

        <TabsContent value="followup" className="flex-1 overflow-y-auto mt-4">
          <div className="space-y-4">
            {/* View toggle row */}
            <div className="flex items-center justify-end">
              <div className="flex items-center rounded-lg border bg-muted/30 p-0.5 gap-0.5">
                <button
                  type="button"
                  onClick={() => setFollowUpView("cards")}
                  title="Card view"
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                    followUpView === "cards"
                      ? "bg-background shadow-sm text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                  Campaigns
                </button>
                <button
                  type="button"
                  onClick={() => setFollowUpView("timeline")}
                  title="Timeline view"
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                    followUpView === "timeline"
                      ? "bg-background shadow-sm text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <CalendarDays className="h-3.5 w-3.5" />
                  Timeline
                </button>
              </div>
            </div>

            {/* View content */}
            {followUpView === "cards" ? (
              <FollowUpCentre onOpenBuilder={handleOpenBuilder} />
            ) : (
              <CampaignTimeline initialCampaignId={timelineCampaignId} />
            )}
          </div>
        </TabsContent>

        <TabsContent value="settings" className="flex-1 overflow-y-auto mt-4">
          <HexMailSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
