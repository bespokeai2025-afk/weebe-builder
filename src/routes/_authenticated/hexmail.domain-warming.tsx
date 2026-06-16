import { createFileRoute } from "@tanstack/react-router";
import { HexMailDomainWarming } from "@/components/hexmail/HexMailDomainWarming";

export const Route = createFileRoute("/_authenticated/hexmail/domain-warming")({
  head: () => ({ meta: [{ title: "Domain Warming — HexMail" }] }),
  component: HexMailDomainWarming,
});
