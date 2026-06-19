import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getProviderCreditStatus } from "@/lib/providers/provider-credits.server";
import { AlertTriangle, CheckCircle2, XCircle, ExternalLink, CreditCard, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";

const CATEGORY_LABELS: Record<string, string> = {
  voice: "Voice",
  video: "Video",
  ai: "AI",
  messaging: "Messaging",
  email: "Email",
  advertising: "Ads",
  search: "Search",
  telephony: "Phone",
};

export function ProviderCreditsBar() {
  const fn = useServerFn(getProviderCreditStatus);
  const { data: providers, isLoading } = useQuery({
    queryKey: ["provider-credit-status"],
    queryFn: () => fn(),
    staleTime: 2 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    throwOnError: false,
  });

  if (isLoading) return null;
  if (!providers || providers.length === 0) return null;

  const warnings = providers.filter((p) => p.credits_warning || p.status === "error");
  const healthy = providers.filter((p) => !p.credits_warning && p.status === "connected");
  const disconnected = providers.filter((p) => !p.credits_warning && p.status === "disconnected");

  return (
    <div className="mx-6 mt-4 space-y-3">
      {warnings.length > 0 && (
        <div className="rounded-xl border border-red-500/25 bg-red-500/8 p-4">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-400" />
            <span className="text-xs font-semibold uppercase tracking-widest text-red-400">
              Action Required — Credits / Connection Issues
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {warnings.map((p) => (
              <a
                key={p.provider_name}
                href={p.billing_url}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors hover:opacity-90",
                  p.credits_warning
                    ? "border-red-500/40 bg-red-500/15 text-red-300 hover:bg-red-500/25"
                    : "border-amber-500/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25",
                )}
              >
                {p.credits_warning ? (
                  <CreditCard className="h-3.5 w-3.5" />
                ) : (
                  <XCircle className="h-3.5 w-3.5" />
                )}
                <span>{p.display_name}</span>
                <span className="opacity-60">·</span>
                <span className="opacity-80">
                  {p.credits_warning ? "Add credits" : "Reconnect"}
                </span>
                <ExternalLink className="h-3 w-3 opacity-50" />
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-white/[0.06] bg-card/40 px-4 py-3">
        <div className="mb-2.5 flex items-center gap-2">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Provider Status
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {providers.map((p) => {
            const isWarning = p.credits_warning;
            const isError = p.status === "error";
            const isDisconnected = p.status === "disconnected";
            const catLabel = CATEGORY_LABELS[p.provider_category] ?? p.provider_category;
            return (
              <a
                key={p.provider_name}
                href={p.billing_url}
                target="_blank"
                rel="noopener noreferrer"
                title={`${p.display_name} — click to manage billing`}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-all hover:opacity-90",
                  isWarning || isError
                    ? "border-red-500/30 bg-red-500/10 text-red-300"
                    : isDisconnected
                    ? "border-white/[0.06] bg-white/[0.03] text-muted-foreground"
                    : "border-emerald-500/20 bg-emerald-500/8 text-emerald-300",
                )}
              >
                {isWarning || isError ? (
                  <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                ) : isDisconnected ? (
                  <WifiOff className="h-3 w-3 opacity-50" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                )}
                <span className="font-medium">{p.display_name}</span>
                <span className="opacity-40">·</span>
                <span className="opacity-60">{catLabel}</span>
                {(isWarning || isError) && (
                  <ExternalLink className="h-2.5 w-2.5 ml-0.5 opacity-60" />
                )}
              </a>
            );
          })}
        </div>
        <p className="mt-2.5 text-[10px] text-muted-foreground/60">
          Click any provider to open its billing / settings page.
          {disconnected.length > 0 && (
            <> {disconnected.length} provider{disconnected.length > 1 ? "s" : ""} not yet connected.</>
          )}
        </p>
      </div>
    </div>
  );
}
