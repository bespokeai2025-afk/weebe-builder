import { createFileRoute } from "@tanstack/react-router";
import { AccountsMindShell } from "@/components/accountsmind/AccountsMindShell";
import { AccountsMindAlerts } from "@/components/accountsmind/AccountsMindAlerts";

export const Route = createFileRoute("/_authenticated/admin/accounts/alerts")({
  component: AccountsMindAlertsPage,
});

function AccountsMindAlertsPage() {
  return (
    <AccountsMindShell>
      <AccountsMindAlerts />
    </AccountsMindShell>
  );
}
