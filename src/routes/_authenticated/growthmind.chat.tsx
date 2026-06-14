import { createFileRoute } from "@tanstack/react-router";
import { GrowthMindChat } from "@/components/growthmind/GrowthMindChat";

export const Route = createFileRoute("/_authenticated/growthmind/chat")({
  head: () => ({ meta: [{ title: "GrowthMind Assistant — Webee" }] }),
  component: GrowthMindChat,
});
