import { createFileRoute } from "@tanstack/react-router";
import { SystemMindSetupAssistantPage } from "@/components/systemmind/SystemMindSetupAssistantPage";

export const Route = createFileRoute("/_authenticated/systemmind/setup-assistant")({
  head: () => ({ meta: [{ title: "Setup Assistant — SystemMind" }] }),
  component: SystemMindSetupAssistantPage,
});
