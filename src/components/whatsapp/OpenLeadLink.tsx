import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

export function OpenLeadLink({
  leadId,
  className,
}: {
  leadId?: string | null;
  className?: string;
}) {
  if (!leadId) return null;

  return (
    <a
      href={`/leads?id=${encodeURIComponent(leadId)}`}
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <ExternalLink className="h-3.5 w-3.5" />
      Open lead
    </a>
  );
}
