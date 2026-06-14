import { createFileRoute } from "@tanstack/react-router";
import { SystemMindChatPage } from "@/components/systemmind/SystemMindChatPage";

export const Route = createFileRoute("/_authenticated/systemmind/chat")({
  component: SystemMindChatPage,
});
