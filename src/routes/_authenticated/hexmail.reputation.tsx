import { createFileRoute } from "@tanstack/react-router";
import { HexMailReputation } from "@/components/hexmail/HexMailReputation";

export const Route = createFileRoute("/_authenticated/hexmail/reputation")({
  head: () => ({ meta: [{ title: "Reputation Monitor — HexMail" }] }),
  component: HexMailReputation,
});
