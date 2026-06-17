import { createFileRoute } from "@tanstack/react-router";
import { AccountsMindShell } from "@/components/accountsmind/AccountsMindShell";
import { AccountsMindSettings } from "@/components/accountsmind/AccountsMindSettings";

export const Route = createFileRoute("/_authenticated/admin/accounts/settings")({
  component: AccountsMindSettingsPage,
});

function AccountsMindSettingsPage() {
  return (
    <AccountsMindShell>
      <AccountsMindSettings />
    </AccountsMindShell>
  );
}
