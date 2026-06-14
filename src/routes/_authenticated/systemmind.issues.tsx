import { createFileRoute } from "@tanstack/react-router";
import { SystemMindIssuesPage } from "@/components/systemmind/SystemMindIssuesPage";

export const Route = createFileRoute("/_authenticated/systemmind/issues")({
  component: SystemMindIssuesPage,
});
