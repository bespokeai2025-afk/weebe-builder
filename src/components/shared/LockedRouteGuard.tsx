/**
 * Centralized locked-route UX for direct URL access.
 *
 * Wraps the authenticated layout's <Outlet/>: when the current pathname maps
 * to a gated feature/page and the signed-in user's effective access (role ∩
 * package ∩ per-user Team Access overrides, resolved server-side by
 * getMyEntitlements) does not permit viewing, a full-page lock state renders
 * instead of the page:
 *   • Package-locked — "not included in your package" with View Packages /
 *     Request Upgrade / Back to Dashboard.
 *   • Role-locked — "ask your workspace admin".
 *
 * The UI is a courtesy layer — every server function enforces access
 * regardless. Fail open here on missing data so a transient fetch error never
 * blanks the app (backend still refuses).
 */
import { type ReactNode, useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Lock, ShieldAlert, ArrowLeft, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { getMyEntitlements } from "@/lib/packages/packages.functions";
import { getMyAdminStatus } from "@/lib/auth/auth.functions";
import { requestModuleUpgrade } from "@/lib/modules/modules.functions";
import {
  ROUTE_FEATURE_MAP,
  ROUTE_PAGE_MAP,
  FEATURE_LABELS,
  matchRouteKey,
} from "@/lib/packages/packages.shared";
import { PAGE_LABELS, pageLevelRank } from "@/lib/permissions/permissions.shared";
import { useServerFn } from "@tanstack/react-start";

type LockKind = "package" | "role" | null;

function LockScreen({
  kind,
  areaLabel,
  packageName,
}: {
  kind: Exclude<LockKind, null>;
  areaLabel: string;
  packageName: string;
}) {
  const requestUpgradeFn = useServerFn(requestModuleUpgrade);
  const [requesting, setRequesting] = useState(false);
  const isPackage = kind === "package";

  const handleRequestUpgrade = async () => {
    setRequesting(true);
    try {
      await requestUpgradeFn({
        data: { moduleId: "package_upgrade", moduleName: areaLabel },
      });
      toast.success("Upgrade request sent — our team will be in touch.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to send request");
    } finally {
      setRequesting(false);
    }
  };

  return (
    <div className="flex min-h-[70vh] items-center justify-center p-6">
      <Card className="max-w-md w-full">
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <div className="rounded-full bg-muted p-4">
            {isPackage ? (
              <Package className="h-8 w-8 text-muted-foreground" />
            ) : (
              <ShieldAlert className="h-8 w-8 text-muted-foreground" />
            )}
          </div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Lock className="h-4 w-4" /> {areaLabel} is locked
          </h2>
          {isPackage ? (
            <p className="text-sm text-muted-foreground">
              {areaLabel} is not included in your current package
              {packageName ? ` (${packageName})` : ""}. Upgrade your package to
              unlock it.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Your role doesn&apos;t have access to {areaLabel}. Ask your
              workspace admin to grant access in Team Access.
            </p>
          )}
          <div className="flex flex-col gap-2 w-full pt-2">
            {isPackage && (
              <>
                <Button asChild>
                  <Link to="/billing" search={{ checkout: undefined }}>
                    View Packages
                  </Link>
                </Button>
                <Button
                  variant="outline"
                  onClick={handleRequestUpgrade}
                  disabled={requesting}
                >
                  {requesting ? "Sending…" : "Request Upgrade"}
                </Button>
              </>
            )}
            <Button variant="ghost" asChild>
              <Link to="/dashboard">
                <ArrowLeft className="h-4 w-4 mr-1" /> Back to Dashboard
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function LockedRouteGuard({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const { data: access } = useQuery({
    queryKey: ["my-entitlements"],
    queryFn: () => getMyEntitlements(),
    staleTime: 30_000,
    retry: false,
    throwOnError: false,
  });
  const { data: adminStatus } = useQuery({
    queryKey: ["my-admin-status"],
    queryFn: () => getMyAdminStatus().catch(() => ({ isAdmin: false })),
    staleTime: 60_000,
    retry: false,
    throwOnError: false,
  });

  // Platform admins and unresolved states pass through (backend enforces anyway).
  if (!access || adminStatus?.isAdmin) return <>{children}</>;

  const feature = matchRouteKey(pathname, ROUTE_FEATURE_MAP);
  const page = matchRouteKey(pathname, ROUTE_PAGE_MAP);

  // Package lock: the route's owning feature is excluded from the package.
  if (feature && access.entitlements?.features?.[feature] === false) {
    return (
      <LockScreen
        kind="package"
        areaLabel={FEATURE_LABELS[feature] ?? feature}
        packageName={access.entitlements?.packageName ?? ""}
      />
    );
  }

  // Role/override lock: effective page level (role ∩ overrides ∩ package)
  // is hidden. Owners always retain at least view via role defaults.
  if (page && access.pageAccess) {
    const level = (access.pageAccess as Record<string, string>)[page] ?? "hidden";
    if (pageLevelRank(level as any) < pageLevelRank("view")) {
      return (
        <LockScreen
          kind="role"
          areaLabel={PAGE_LABELS[page] ?? page}
          packageName={access.entitlements?.packageName ?? ""}
        />
      );
    }
  }

  return <>{children}</>;
}
