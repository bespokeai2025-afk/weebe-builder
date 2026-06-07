import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/settings/integrations")({
  head: () => ({
    meta: [
      { title: "Integrations — Webespoke AI" },
      {
        name: "description",
        content: "Push every published agent into your WE BE SMART DASH dashboard.",
      },
    ],
  }),
  component: IntegrationsPage,
});

function IntegrationsPage() {
  return (
    <main className="min-h-screen">
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <div className="mb-8 flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link to="/my-agents">
              <ArrowLeft className="mr-1 h-4 w-4" />
              Back
            </Link>
          </Button>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              Settings
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">Integrations</h1>
          </div>
        </div>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Retell Webhook Endpoints</CardTitle>
            <CardDescription>
              Paste these URLs into the matching custom-function nodes in your Retell agent. Every
              endpoint is signed with <code>x-retell-signature</code> using your{" "}
              <code>RETELL_WEBHOOK_SECRET</code>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {[
              { label: "Check availability", path: "/api/public/retell/availability" },
              { label: "Book appointment", path: "/api/public/retell/book" },
              { label: "Reschedule", path: "/api/public/retell/reschedule" },
              { label: "Cancel", path: "/api/public/retell/cancel" },
            ].map((row) => {
              const url = (typeof window !== "undefined" ? window.location.origin : "") + row.path;
              return (
                <div key={row.path} className="space-y-1">
                  <Label className="text-xs">{row.label}</Label>
                  <div className="flex gap-2">
                    <Input readOnly value={url} className="font-mono text-xs" />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        navigator.clipboard.writeText(url);
                        toast.success("Copied");
                      }}
                    >
                      Copy
                    </Button>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
