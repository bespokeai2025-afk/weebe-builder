import { createFileRoute } from "@tanstack/react-router";
import { SystemMindAuditsPage } from "@/components/systemmind/SystemMindAuditsPage";

export const Route = createFileRoute("/_authenticated/systemmind/audits")({
  component: SystemMindAuditsPage,
});
