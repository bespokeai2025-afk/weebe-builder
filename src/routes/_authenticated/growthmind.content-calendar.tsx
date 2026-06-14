import { createFileRoute } from "@tanstack/react-router";
import { GrowthMindContentCalendar } from "@/components/growthmind/GrowthMindContentCalendar";

export const Route = createFileRoute("/_authenticated/growthmind/content-calendar")({
  head: () => ({ meta: [{ title: "Content Calendar — GrowthMind" }] }),
  component: GrowthMindContentCalendar,
});
