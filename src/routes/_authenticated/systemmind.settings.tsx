import { createFileRoute } from "@tanstack/react-router";
import { SystemMindSettingsPage } from "@/components/systemmind/SystemMindSettingsPage";

export const Route = createFileRoute("/_authenticated/systemmind/settings")({
  component: SystemMindSettingsPage,
});
