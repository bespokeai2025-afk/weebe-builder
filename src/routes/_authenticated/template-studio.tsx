import { createFileRoute } from "@tanstack/react-router";
import { TemplateStudio } from "@/components/hexmail/TemplateStudio";

export const Route = createFileRoute("/_authenticated/template-studio")({
  head: () => ({
    meta: [
      { title: "Template Studio — Webee" },
      { name: "description", content: "Create and manage email, SMS, WhatsApp, and document templates." },
    ],
  }),
  component: TemplateStudioPage,
});

function TemplateStudioPage() {
  return (
    <div className="flex flex-col h-full p-6 gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Template Studio</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Create and manage email, SMS, WhatsApp, and document templates.
        </p>
      </div>
      <div className="flex-1 min-h-0">
        <TemplateStudio />
      </div>
    </div>
  );
}
