import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Mail, FileText, Settings, LayoutGrid, CalendarDays, Sparkles } from "lucide-react";
import { FollowUpCentre } from "@/components/hexmail/FollowUpCentre";
import { TemplateStudio } from "@/components/hexmail/TemplateStudio";
import { HexMailSettings } from "@/components/hexmail/HexMailSettings";
import { CampaignCalendar } from "@/components/hexmail/CampaignCalendar";
import { CampaignBuilderPage } from "@/components/hexmail/CampaignBuilderPage";
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

type FollowUpView = "cards" | "timeline" | "visual";

const VIEW_TOGGLE: { value: FollowUpView; icon: typeof LayoutGrid; label: string }[] = [
  { value: "cards",    icon: LayoutGrid,   label: "Campaigns" },
  { value: "visual",   icon: Sparkles,     label: "Visual"    },
  { value: "timeline", icon: CalendarDays, label: "Calendar"  },
];

function HexmailPage() {
  const [followUpView, setFollowUpView] = useState<FollowUpView>("cards");
  const [activeCampaignId, setActiveCampaignId] = useState<string | undefined>(undefined);

  const handleOpenBuilder = (campaignId?: string) => {
    setActiveCampaignId(campaignId);
    setFollowUpView("visual");
  };

  const handleOpenVisual = (campaignId?: string) => {
    setActiveCampaignId(campaignId);
    setFollowUpView("visual");
  };

  const isVisual = followUpView === "visual";

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

        {/* Follow-Up Centre — switches between 3 views */}
        <TabsContent
          value="followup"
          className={cn(
            "mt-4",
            isVisual
              ? "flex-1 min-h-0 overflow-hidden flex flex-col"
              : "flex-1 overflow-y-auto",
          )}
        >
          {/* View toggle — always visible */}
          <div className="flex items-center justify-end mb-4 shrink-0">
            <div className="flex items-center rounded-lg border bg-muted/30 p-0.5 gap-0.5">
              {VIEW_TOGGLE.map(({ value, icon: Icon, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setFollowUpView(value)}
                  title={label}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                    followUpView === value
                      ? "bg-background shadow-sm text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* View content */}
          {followUpView === "cards" && (
            <FollowUpCentre
              onOpenBuilder={(id) => {
                setActiveCampaignId(id);
                setFollowUpView("timeline");
              }}
            />
          )}

          {followUpView === "timeline" && (
            <CampaignCalendar initialCampaignId={activeCampaignId} />
          )}

          {followUpView === "visual" && (
            <div className="flex-1 min-h-0 overflow-hidden">
              <CampaignBuilderPage
                campaignId={activeCampaignId}
                onBack={() => setFollowUpView("cards")}
                onSaved={(id) => {
                  setActiveCampaignId(id);
                  setFollowUpView("cards");
                }}
              />
            </div>
          )}
        </TabsContent>

        <TabsContent value="settings" className="flex-1 overflow-y-auto mt-4">
          <HexMailSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
