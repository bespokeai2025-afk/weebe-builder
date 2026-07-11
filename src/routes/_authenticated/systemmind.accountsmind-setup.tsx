import { createFileRoute } from "@tanstack/react-router";
import { SystemMindAccountsMindSetupPage } from "@/components/systemmind/SystemMindAccountsMindSetupPage";

export const Route = createFileRoute("/_authenticated/systemmind/accountsmind-setup")({
  head: () => ({ meta: [{ title: "AccountsMind Setup — SystemMind" }] }),
  component: SystemMindAccountsMindSetupPage,
});
