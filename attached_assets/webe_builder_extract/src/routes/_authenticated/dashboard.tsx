import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";

const DASHBOARD_URL = "https://id-preview--5ac2a13e-280d-409c-99e9-989a09464b56.lovable.app";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Receptionist Dashboard" }] }),
  component: DashboardEmbed,
});

function DashboardEmbed() {
  // Load the full dashboard app (including its mini sidebar) — no embedded flag.
  const src = `${DASHBOARD_URL}/dashboard`;
  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <div className="flex items-center justify-between border-b px-6 py-3">
        <h1 className="text-lg font-semibold">Receptionist Dashboard</h1>
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="h-4 w-4" />
          Open in new tab
        </a>
      </div>
      <iframe
        src={src}
        title="Receptionist Dashboard"
        className="flex-1 w-full border-0"
      />
    </div>
  );
}
