import { cn } from "@/lib/utils";
import {
  NEW_LEAD_SYNC_SUB_SLUGS,
  newLeadSubBadgeLabel,
} from "@/lib/integrations/webespokeEnterprise/wbah-campaign-sync.types";

/** Sub-cohort badge for inbound New leads (server-assigned sync_category_slug). */
export function WbahNewLeadSubBadge({
  slug,
  className,
}: {
  slug: string | null | undefined;
  className?: string;
}) {
  const label = newLeadSubBadgeLabel(slug);
  if (!label) return null;

  const isCallNow =
    String(slug ?? "")
      .trim()
      .toLowerCase() === NEW_LEAD_SYNC_SUB_SLUGS.call_now;

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded border px-1 py-0 text-[9px] font-semibold uppercase tracking-wide",
        isCallNow
          ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-300"
          : "border-slate-400/40 bg-slate-500/15 text-slate-300",
        className,
      )}
      title={`sync_category_slug=${String(slug ?? "").trim()}`}
    >
      {label}
    </span>
  );
}

export function WbahNewLeadAutoDialBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded border border-emerald-400/40 bg-emerald-500/15 px-1 py-0 text-[9px] font-semibold uppercase tracking-wide text-emerald-300",
        className,
      )}
      title="Inbound New leads are auto-dialed by cron — not for manual campaigns"
    >
      Auto-dial
    </span>
  );
}
