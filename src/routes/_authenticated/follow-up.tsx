import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { LayoutGrid, CalendarDays, Sparkles } from "lucide-react";
import { FollowUpCentre } from "@/components/hexmail/FollowUpCentre";
import { CampaignCalendar } from "@/components/hexmail/CampaignCalendar";
import { CampaignBuilderPage } from "@/components/hexmail/CampaignBuilderPage";
import { CampaignBuilder } from "@/components/hexmail/CampaignBuilder";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/follow-up")({
  head: () => ({
    meta: [
      { title: "Follow-Up Centre — Webee" },
      { name: "description", content: "Multi-channel follow-up campaigns, day-by-day action timelines and campaign calendar." },
    ],
  }),
  component: FollowUpPage,
});

type View = "cards" | "visual" | "timeline";

const VIEW_TOGGLE: { value: View; icon: typeof LayoutGrid; label: string }[] = [
  { value: "cards",    icon: LayoutGrid,   label: "Campaigns" },
  { value: "visual",   icon: Sparkles,     label: "Visual"    },
  { value: "timeline", icon: CalendarDays, label: "Calendar"  },
];

function FollowUpPage() {
  const [view,              setView]              = useState<View>("cards");
  const [activeCampaignId,  setActiveCampaignId]  = useState<string | undefined>(undefined);
  const [formBuilderOpen,   setFormBuilderOpen]   = useState(false);
  const [formBuilderCampaignId, setFormBuilderCampaignId] = useState<string | undefined>(undefined);

  const openVisual = (id?: string) => {
    setActiveCampaignId(id);
    setView("visual");
  };

  const openFormBuilder = (id?: string) => {
    setFormBuilderCampaignId(id);
    setFormBuilderOpen(true);
  };

  const isVisual = view === "visual";

  return (
    <div className={cn("flex flex-col h-full p-6 gap-4", isVisual && "overflow-hidden")}>
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Follow-Up Centre</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Build and manage multi-channel follow-up campaigns.
          </p>
        </div>

        {/* View toggle */}
        <div className="flex items-center rounded-lg border bg-muted/30 p-0.5 gap-0.5">
          {VIEW_TOGGLE.map(({ value, icon: Icon, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setView(value)}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                view === value
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

      {/* Content */}
      <div className={cn("flex-1 min-h-0", isVisual ? "overflow-hidden flex flex-col" : "overflow-y-auto")}>
        {view === "cards" && (
          <FollowUpCentre
            onOpenVisualBuilder={openVisual}
            onOpenFormBuilder={openFormBuilder}
          />
        )}

        {view === "visual" && (
          <div className="flex-1 min-h-0 overflow-hidden h-full">
            <CampaignBuilderPage
              campaignId={activeCampaignId}
              onBack={() => setView("cards")}
              onSaved={(id) => {
                setActiveCampaignId(id);
                setView("cards");
              }}
            />
          </div>
        )}

        {view === "timeline" && (
          <CampaignCalendar initialCampaignId={activeCampaignId} />
        )}
      </div>

      {/* Form builder sheet — opened when user picks "Form Builder" on any campaign */}
      <CampaignBuilder
        open={formBuilderOpen}
        campaignId={formBuilderCampaignId}
        onClose={() => setFormBuilderOpen(false)}
        onSaved={() => {
          setFormBuilderOpen(false);
        }}
      />
    </div>
  );
}
