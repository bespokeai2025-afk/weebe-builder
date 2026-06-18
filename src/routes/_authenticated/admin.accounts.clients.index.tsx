import { createFileRoute } from "@tanstack/react-router";
import { AccountsMindShell } from "@/components/accountsmind/AccountsMindShell";
import { AccountsMindClients } from "@/components/accountsmind/AccountsMindClients";

export const Route = createFileRoute("/_authenticated/admin/accounts/clients/")({
  component: AccountsMindClientsPage,
});

function AccountsMindClientsPage() {
  return (
    <AccountsMindShell>
      <AccountsMindClients />
    </AccountsMindShell>
  );
}
