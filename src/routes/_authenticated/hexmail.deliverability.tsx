import { createFileRoute } from "@tanstack/react-router";
import { HexMailDeliverability } from "@/components/hexmail/HexMailDeliverability";

export const Route = createFileRoute("/_authenticated/hexmail/deliverability")({
  head: () => ({ meta: [{ title: "Deliverability Centre — HexMail" }] }),
  component: HexMailDeliverability,
});
