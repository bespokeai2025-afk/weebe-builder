import { createFileRoute } from "@tanstack/react-router";
import { SystemMindReportsPage } from "@/components/systemmind/SystemMindReportsPage";

export const Route = createFileRoute("/_authenticated/systemmind/reports")({
  component: SystemMindReportsPage,
});
