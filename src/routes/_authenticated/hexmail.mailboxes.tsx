import { createFileRoute } from "@tanstack/react-router";
import { HexMailMailboxes } from "@/components/hexmail/HexMailMailboxes";

export const Route = createFileRoute("/_authenticated/hexmail/mailboxes")({
  head: () => ({ meta: [{ title: "Mailboxes — HexMail" }] }),
  component: HexMailMailboxes,
});
