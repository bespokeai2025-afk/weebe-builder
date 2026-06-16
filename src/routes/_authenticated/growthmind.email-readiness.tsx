import { createFileRoute } from "@tanstack/react-router";
import { GrowthMindEmailReadiness } from "@/components/growthmind/GrowthMindEmailReadiness";

export const Route = createFileRoute("/_authenticated/growthmind/email-readiness")({
  head: () => ({ meta: [{ title: "Email Readiness — GrowthMind" }] }),
  component: GrowthMindEmailReadiness,
});
