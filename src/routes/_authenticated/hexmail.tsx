import { createFileRoute } from "@tanstack/react-router";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Mail, FileText } from "lucide-react";
import { FollowUpCentre } from "@/components/hexmail/FollowUpCentre";
import { TemplateStudio } from "@/components/hexmail/TemplateStudio";

export const Route = createFileRoute("/_authenticated/hexmail")({
  component: HexmailPage,
});

function HexmailPage() {
  return (
    <div className="flex flex-col h-full p-6 gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">HexMail</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Multi-channel follow-up campaigns and reusable content templates.
        </p>
      </div>

      <Tabs defaultValue="followup" className="flex-1 flex flex-col min-h-0">
        <TabsList className="w-fit">
          <TabsTrigger value="followup" className="gap-2">
            <Mail className="h-4 w-4" />
            Follow-Up Centre
          </TabsTrigger>
          <TabsTrigger value="templates" className="gap-2">
            <FileText className="h-4 w-4" />
            Template Studio
          </TabsTrigger>
        </TabsList>

        <TabsContent value="followup" className="flex-1 min-h-0 mt-4">
          <FollowUpCentre />
        </TabsContent>

        <TabsContent value="templates" className="flex-1 flex flex-col min-h-0 mt-4">
          <TemplateStudio />
        </TabsContent>
      </Tabs>
    </div>
  );
}
