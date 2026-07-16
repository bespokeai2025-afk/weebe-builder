import { createFileRoute } from "@tanstack/react-router";
import { AccountsMindShell } from "@/components/accountsmind/AccountsMindShell";
import { AccountsMindInvoices } from "@/components/accountsmind/AccountsMindInvoices";

export const Route = createFileRoute("/_authenticated/admin/accounts/invoices")({
  component: AccountsMindInvoicesPage,
});

function AccountsMindInvoicesPage() {
  return (
    <AccountsMindShell>
      <AccountsMindInvoices />
    </AccountsMindShell>
  );
}
