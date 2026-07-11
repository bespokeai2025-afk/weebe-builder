import { createFileRoute } from "@tanstack/react-router";
import { SystemMindAutomationPage } from "@/components/systemmind/SystemMindAutomationPage";

export const Route = createFileRoute("/_authenticated/systemmind/automation")({
  head: () => ({ meta: [{ title: "Automation — SystemMind" }] }),
  component: SystemMindAutomationPage,
});
