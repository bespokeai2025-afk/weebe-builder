import { ExternalLink } from "lucide-react";

export function OpenLeadLink({ leadId }: { leadId?: string | null }) {
  if (!leadId) return null;

  return (
    <a
      href={`/leads?id=${encodeURIComponent(leadId)}`}
      className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:underline"
    >
      <ExternalLink className="h-3 w-3" />
      Open Lead
    </a>
  );
}
