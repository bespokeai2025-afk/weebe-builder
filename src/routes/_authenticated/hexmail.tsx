import { createFileRoute } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Settings, Inbox, BarChart2, Mail } from "lucide-react";
import { HexMailSettings } from "@/components/hexmail/HexMailSettings";
import { EmailViewer } from "@/components/hexmail/EmailViewer";
import { EmailAnalytics } from "@/components/hexmail/EmailAnalytics";
import { EmailTemplatesPanel } from "@/components/hexmail/EmailTemplatesPanel";

export const Route = createFileRoute("/_authenticated/hexmail")({
  head: () => ({
    meta: [
      { title: "HexMail — Webee" },
      { name: "description", content: "Email templates, inbox, sent mail and campaign analytics." },
    ],
  }),
  component: HexmailPage,
});

function HexmailPage() {
  return (
    <div className="flex flex-col h-full p-6 gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">HexMail</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Email templates, inbox, sent mail and campaign analytics.
        </p>
      </div>

      <Tabs defaultValue="templates" className="flex-1 flex flex-col min-h-0">
        <TabsList className="w-fit">
          <TabsTrigger value="templates" className="gap-2">
            <Mail className="h-4 w-4" />
            Email Templates
          </TabsTrigger>
          <TabsTrigger value="viewer" className="gap-2">
            <Inbox className="h-4 w-4" />
            Email Viewer
          </TabsTrigger>
          <TabsTrigger value="analytics" className="gap-2">
            <BarChart2 className="h-4 w-4" />
            Analytics
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-2">
            <Settings className="h-4 w-4" />
            Settings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="templates" className="flex-1 flex flex-col min-h-0 mt-4">
          <EmailTemplatesPanel />
        </TabsContent>

        <TabsContent value="viewer" className="flex-1 overflow-y-auto mt-4">
          <EmailViewer />
        </TabsContent>

        <TabsContent value="analytics" className="flex-1 overflow-y-auto mt-4">
          <EmailAnalytics />
        </TabsContent>

        <TabsContent value="settings" className="flex-1 overflow-y-auto mt-4">
          <HexMailSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
