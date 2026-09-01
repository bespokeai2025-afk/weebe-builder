import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  MessageCircle,
  Users,
  Megaphone,
  FileText,
  BarChart3,
  Settings,
  Bot,
  ClipboardList,
} from "lucide-react";
import { WhatsAppInbox } from "@/components/whatsapp/WhatsAppInbox";
import { WhatsAppContacts } from "@/components/whatsapp/WhatsAppContacts";
import { WhatsAppCampaigns } from "@/components/whatsapp/WhatsAppCampaigns";
import { WhatsAppTemplates } from "@/components/whatsapp/WhatsAppTemplates";
import { WhatsAppAnalytics } from "@/components/whatsapp/WhatsAppAnalytics";
import { WhatsAppSettings } from "@/components/whatsapp/WhatsAppSettings";
import { WhatsAppAgents } from "@/components/whatsapp/WhatsAppAgents";
import { CampaignLeadsBoard } from "@/components/whatsapp/CampaignLeadsBoard";
import { useIsWbahWorkspace } from "@/hooks/useIsWbahWorkspace";

const BUZZCHAT_TABS = [
  { id: "inbox", label: "Inbox", icon: MessageCircle },
  { id: "leads", label: "Leads", icon: ClipboardList },
  { id: "contacts", label: "Contacts", icon: Users },
  { id: "campaigns", label: "Campaigns", icon: Megaphone },
  { id: "templates", label: "Templates", icon: FileText },
  { id: "agents", label: "Agents", icon: Bot },
  { id: "analytics", label: "Analytics", icon: BarChart3 },
  { id: "settings", label: "Settings", icon: Settings },
] as const;

type BuzzchatTab = (typeof BUZZCHAT_TABS)[number]["id"];

function parseTab(value: unknown): BuzzchatTab {
  const tab = String(value ?? "inbox");
  return BUZZCHAT_TABS.some((t) => t.id === tab) ? (tab as BuzzchatTab) : "inbox";
}

export const Route = createFileRoute("/_authenticated/whatsapp")({
  validateSearch: (search: Record<string, unknown>): { tab?: BuzzchatTab } => {
    if (search.tab == null || search.tab === "") return {};
    return { tab: parseTab(search.tab) };
  },
  head: () => ({ meta: [{ title: "Buzzchat — Webee" }] }),
  component: WhatsappPage,
});

function WhatsappPage() {
  const navigate = useNavigate({ from: "/whatsapp" });
  const { tab = "inbox" } = Route.useSearch();
  const { isWbah } = useIsWbahWorkspace();

  const tabs = BUZZCHAT_TABS.filter((t) => !(isWbah && t.id === "leads"));
  const activeTab: BuzzchatTab = tab === "leads" && isWbah ? "inbox" : tab;

  return (
    <div className="flex h-[calc(100dvh-2.5rem)] min-h-0 flex-col overflow-hidden px-4 pb-3 pt-2 md:px-5">
      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          void navigate({ search: { tab: parseTab(value) } });
        }}
        className="flex min-h-0 flex-1 flex-col gap-3"
      >
        <div className="-mx-1 shrink-0 overflow-x-auto px-1">
          <TabsList className="h-11 w-full min-w-max justify-stretch p-1 sm:min-w-full">
            {tabs.map(({ id, label, icon: Icon }) => (
              <TabsTrigger
                key={id}
                value={id}
                className="h-9 min-w-24 flex-1 gap-2 px-4 text-[15px]"
              >
                <Icon className="h-[18px] w-[18px]" />
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="inbox" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden">
          <WhatsAppInbox />
        </TabsContent>
        <TabsContent value="leads" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden">
          <CampaignLeadsBoard />
        </TabsContent>
        <TabsContent value="contacts" className="mt-0 flex min-h-0 flex-1 flex-col overflow-hidden">
          <WhatsAppContacts />
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
