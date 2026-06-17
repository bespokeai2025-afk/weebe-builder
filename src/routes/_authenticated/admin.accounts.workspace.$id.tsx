import { createFileRoute } from "@tanstack/react-router";
import { AccountsMindShell } from "@/components/accountsmind/AccountsMindShell";
import { AccountsMindClientDetail } from "@/components/accountsmind/AccountsMindClientDetail";

export const Route = createFileRoute("/_authenticated/admin/accounts/workspace/$id")({
  component: AccountsMindWorkspaceDetailPage,
});

function AccountsMindWorkspaceDetailPage() {
  const { id } = Route.useParams();
  return (
    <AccountsMindShell>
      <AccountsMindClientDetail workspaceId={id} />
    </AccountsMindShell>
  );
}
