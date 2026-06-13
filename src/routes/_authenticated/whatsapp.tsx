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
    <div className="mx-auto w-full max-w-6xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Buzzchat</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage conversations, contacts, campaigns and templates from one place.
        </p>
      </div>

      <Tabs defaultValue="inbox" className="space-y-6">
        <TabsList className="h-10 gap-1 p-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <TabsTrigger key={id} value={id} className="gap-1.5 px-4 text-xs">
              <Icon className="h-3.5 w-3.5" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="inbox"     className="mt-0"><WhatsAppInbox /></TabsContent>
        <TabsContent value="contacts"  className="mt-0"><WhatsAppContacts /></TabsContent>
        <TabsContent value="campaigns" className="mt-0"><WhatsAppCampaigns /></TabsContent>
        <TabsContent value="templates" className="mt-0"><WhatsAppTemplates /></TabsContent>
        <TabsContent value="agents"    className="mt-0"><WhatsAppAgents /></TabsContent>
        <TabsContent value="analytics" className="mt-0"><WhatsAppAnalytics /></TabsContent>
        <TabsContent value="settings"  className="mt-0"><WhatsAppSettings /></TabsContent>
      </Tabs>
    </div>
  );
}
