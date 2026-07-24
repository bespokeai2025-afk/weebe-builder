import { createFileRoute } from "@tanstack/react-router";
import { SystemMindSetupWizardPage } from "@/components/systemmind/SystemMindSetupWizardPage";

export const Route = createFileRoute("/_authenticated/systemmind/setup-wizard")({
  head: () => ({ meta: [{ title: "Setup Wizard — SystemMind" }] }),
  component: SystemMindSetupWizardPage,
});
