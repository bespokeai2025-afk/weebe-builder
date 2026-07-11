import { createFileRoute } from "@tanstack/react-router";
import { AccountsMindShell } from "@/components/accountsmind/AccountsMindShell";
import { AccountsMindSystemMind } from "@/components/accountsmind/AccountsMindSystemMind";

export const Route = createFileRoute("/_authenticated/admin/accounts/systemmind")({
  component: AccountsMindSystemMindPage,
});

function AccountsMindSystemMindPage() {
  return (
    <AccountsMindShell>
      <AccountsMindSystemMind />
    </AccountsMindShell>
  );
}
