import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Mail, FileText, Settings } from "lucide-react";
import { FollowUpCentre } from "@/components/hexmail/FollowUpCentre";
import { TemplateStudio } from "@/components/hexmail/TemplateStudio";
import { CampaignBuilderPage } from "@/components/hexmail/CampaignBuilderPage";
import { HexMailSettings } from "@/components/hexmail/HexMailSettings";

export const Route = createFileRoute("/_authenticated/hexmail")({
  component: HexmailPage,
});

interface FullPageState {
  open: boolean;
  campaignId?: string;
}

function HexmailPage() {
  const [fullPage, setFullPage] = useState<FullPageState>({ open: false });

  const handleOpenBuilder = (campaignId?: string) => {
    setFullPage({ open: true, campaignId });
  };

  const handleBack = () => {
    setFullPage({ open: false });
  };

  const handleSaved = (_id: string) => {
    setFullPage({ open: false });
  };

  if (fullPage.open) {
    return (
      <CampaignBuilderPage
        campaignId={fullPage.campaignId}
        onBack={handleBack}
        onSaved={handleSaved}
      />
    );
  }

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

        <TabsContent value="followup" className="flex-1 min-h-0 mt-4">
          <FollowUpCentre onOpenBuilder={handleOpenBuilder} />
        </TabsContent>

        <TabsContent value="settings" className="flex-1 overflow-y-auto mt-4">
          <HexMailSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
