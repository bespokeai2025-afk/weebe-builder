import { createFileRoute } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MessageCircle, Users, Megaphone, FileText, BarChart3, Settings, Bot } from "lucide-react";
import { WhatsAppInbox }     from "@/components/whatsapp/WhatsAppInbox";
import { WhatsAppContacts }  from "@/components/whatsapp/WhatsAppContacts";
import { WhatsAppCampaigns } from "@/components/whatsapp/WhatsAppCampaigns";
import { WhatsAppTemplates } from "@/components/whatsapp/WhatsAppTemplates";
import { WhatsAppAnalytics } from "@/components/whatsapp/WhatsAppAnalytics";
import { WhatsAppSettings }  from "@/components/whatsapp/WhatsAppSettings";
import { WhatsAppAgents }    from "@/components/whatsapp/WhatsAppAgents";

export const Route = createFileRoute("/_authenticated/whatsapp")({
  head: () => ({ meta: [{ title: "Buzzchat — Webee" }] }),
  component: WhatsappPage,
});

const TABS = [
  { id: "inbox",     label: "Inbox",     icon: MessageCircle },
  { id: "contacts",  label: "Contacts",  icon: Users },
  { id: "campaigns", label: "Campaigns", icon: Megaphone },
  { id: "templates", label: "Templates", icon: FileText },
  { id: "agents",    label: "Agents",    icon: Bot },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "settings",  label: "Settings",  icon: Settings },
];

function WhatsappPage() {
  return (
    <div className="flex h-[calc(100dvh-2.5rem)] min-h-0 flex-col overflow-hidden px-4 pb-3 pt-3 md:px-5">
      <div className="mb-3 shrink-0">
        <h1 className="text-xl font-semibold tracking-tight">Buzzchat</h1>
        <p className="text-sm text-muted-foreground">
          Inbox, contacts, and campaigns — same workspace as your other modules.
        </p>
      </div>

      <Tabs defaultValue="inbox" className="flex min-h-0 flex-1 flex-col gap-3">
        <TabsList className="flex h-auto min-h-10 w-full shrink-0 flex-wrap justify-start gap-1 p-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <TabsTrigger key={id} value={id} className="gap-1.5 px-3 text-xs">
              <Icon className="h-3.5 w-3.5" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="inbox" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="h-full min-h-0 flex-1">
            <WhatsAppInbox />
          </div>
        </TabsContent>
        <TabsContent value="contacts" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="h-full min-h-0 flex-1">
            <WhatsAppContacts />
          </div>
        </TabsContent>
        <TabsContent value="campaigns" className="mt-0 min-h-0 flex-1 overflow-y-auto">
          <WhatsAppCampaigns />
        </TabsContent>
        <TabsContent value="templates" className="mt-0 min-h-0 flex-1 overflow-y-auto">
          <WhatsAppTemplates />
        </TabsContent>
        <TabsContent value="agents" className="mt-0 min-h-0 flex-1 overflow-y-auto">
          <WhatsAppAgents />
        </TabsContent>
        <TabsContent value="analytics" className="mt-0 min-h-0 flex-1 overflow-y-auto">
          <WhatsAppAnalytics />
        </TabsContent>
        <TabsContent value="settings" className="mt-0 min-h-0 flex-1 overflow-y-auto">
          <WhatsAppSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}
