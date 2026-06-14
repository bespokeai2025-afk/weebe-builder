import { createFileRoute } from "@tanstack/react-router";
import { KnowledgeCentreDashboard } from "@/components/knowledge-centre/KnowledgeCentreDashboard";

export const Route = createFileRoute("/_authenticated/knowledge-centre/")({
  head: () => ({ meta: [{ title: "Knowledge Centre — Webee" }] }),
  component: KnowledgeCentreDashboard,
});
