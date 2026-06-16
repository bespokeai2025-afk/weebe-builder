import { createFileRoute } from "@tanstack/react-router";
import { HexMailSenderDomains } from "@/components/hexmail/HexMailSenderDomains";

export const Route = createFileRoute("/_authenticated/hexmail/sender-domains")({
  head: () => ({ meta: [{ title: "Sender Domains — HexMail" }] }),
  component: HexMailSenderDomains,
});
