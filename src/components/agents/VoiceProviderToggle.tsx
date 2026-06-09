import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Zap, Radio } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { setAgentVoiceProvider } from "@/lib/agents/agents.functions";

export type VoiceProvider = "RETELL" | "OPENAI_REALTIME";

interface Props {
  agentId: string;
  currentProvider: VoiceProvider;
  hasPhone: boolean;
}

const OPTIONS: { value: VoiceProvider; label: string; sub: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: "RETELL", label: "Retell AI", sub: "Managed cloud", icon: Radio },
  { value: "OPENAI_REALTIME", label: "In-House OpenAI Fast", sub: "Native realtime", icon: Zap },
];

export function VoiceProviderToggle({ agentId, currentProvider, hasPhone }: Props) {
  const qc = useQueryClient();
  const setProviderFn = useServerFn(setAgentVoiceProvider);
  const [active, setActive] = useState<VoiceProvider>(currentProvider);
  const [loading, setLoading] = useState(false);

  async function handleSwitch(next: VoiceProvider) {
    if (next === active || loading) return;
    setLoading(true);
    try {
      const result = await setProviderFn({ data: { id: agentId, provider: next } });
      setActive(next);
      qc.invalidateQueries({ queryKey: ["my-agents"] });

      if (result?.twilioWarning) {
        // DB saved successfully but Twilio webhook flip hit a non-fatal error
        toast.success("Voice Engine saved.", {
          description: `Provider updated, but the Twilio webhook could not be flipped: ${result.twilioWarning}`,
        });
      } else {
        toast.success("Voice Engine successfully reassigned!", {
          description:
            next === "RETELL"
              ? "Traffic now routes via Retell AI."
              : "Traffic now routes via In-House OpenAI Fast.",
        });
      }
    } catch (e) {
      toast.error("Routing switch failed", { description: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-md border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">Voice Engine Routing</p>
          <p className="text-xs text-muted-foreground">
            {hasPhone
              ? "Switch the live telephony route for this agent's inbound number."
              : "Attach a phone number first to enable live routing."}
          </p>
        </div>
        {loading && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Configuring Telecom Routing Carrier...
          </div>
        )}
      </div>

      <div className="flex gap-2">
        {OPTIONS.map(({ value, label, sub, icon: Icon }) => {
          const isActive = active === value;
          return (
            <button
              key={value}
              onClick={() => handleSwitch(value)}
              disabled={loading || (!hasPhone && value !== active)}
              className={cn(
                "flex-1 flex items-center gap-2.5 rounded-md border px-3 py-2.5 text-left transition-all duration-150",
                "disabled:cursor-not-allowed disabled:opacity-50",
                isActive
                  ? "border-primary/60 bg-primary/10 ring-1 ring-primary/30"
                  : "border-white/[0.08] bg-white/[0.02] hover:border-white/[0.16] hover:bg-white/[0.04]",
              )}
            >
              <Icon
                className={cn(
                  "h-4 w-4 shrink-0",
                  isActive ? "text-primary" : "text-muted-foreground",
                )}
              />
              <div className="min-w-0">
                <div
                  className={cn(
                    "text-xs font-medium truncate",
                    isActive ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {label}
                </div>
                <div className="text-[10px] text-muted-foreground/70">{sub}</div>
              </div>
              {isActive && (
                <span className="ml-auto shrink-0 h-1.5 w-1.5 rounded-full bg-primary" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
