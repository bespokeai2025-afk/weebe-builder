import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Shield, Video, Image, Cpu, Save, Loader2, Info } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getGenerationLimits, setGenerationLimits, type GenerationLimits } from "@/lib/billing/generation-limits.server";

export const getMyGenerationLimits = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<GenerationLimits & { workspaceId: string }> => {
    const { supabase } = context;
    const { data } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", context.userId)
      .eq("role", "owner")
      .limit(1)
      .maybeSingle();
    const workspaceId = data?.workspace_id ?? "";
    const limits = workspaceId ? await getGenerationLimits(workspaceId) : {
      video_monthly_usd: null,
      image_monthly_usd: null,
      llm_monthly_usd:   null,
      enabled:           true,
    };
    return { ...limits, workspaceId };
  });

export const saveMyGenerationLimits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: Partial<GenerationLimits> & { workspaceId: string }) => data)
  .handler(async ({ data, context: _ }) => {
    const { workspaceId, ...limits } = data;
    await setGenerationLimits(workspaceId, limits);
    return { ok: true };
  });

function LimitField({
  icon, label, description, value, onChange, disabled,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-start gap-4 p-4 rounded-xl border border-white/[0.06] bg-card/40">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] ring-1 ring-white/[0.08]">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <Label className="text-sm font-medium">{label}</Label>
        <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>
        <div className="flex items-center gap-2 mt-2">
          <span className="text-sm text-muted-foreground">$</span>
          <Input
            type="number"
            min="0"
            step="5"
            placeholder="No limit"
            value={value}
            onChange={e => onChange(e.target.value)}
            disabled={disabled}
            className="max-w-[120px] h-8 text-sm"
          />
          <span className="text-xs text-muted-foreground">/ month</span>
        </div>
      </div>
    </div>
  );
}

export function AiCostLimitsPanel() {
  const qc         = useQueryClient();
  const getFn      = useServerFn(getMyGenerationLimits);
  const saveFn     = useServerFn(saveMyGenerationLimits);

  const { data, isLoading } = useQuery({
    queryKey: ["my-generation-limits"],
    queryFn:  () => getFn(),
    staleTime: 60_000,
  });

  const [enabled, setEnabled]    = useState<boolean | null>(null);
  const [videoVal, setVideoVal]  = useState("");
  const [imageVal, setImageVal]  = useState("");
  const [llmVal,   setLlmVal]    = useState("");

  const effectiveEnabled = enabled ?? data?.enabled ?? true;
  const effectiveVideo   = videoVal !== "" ? videoVal : String(data?.video_monthly_usd ?? "");
  const effectiveImage   = imageVal !== "" ? imageVal : String(data?.image_monthly_usd ?? "");
  const effectiveLlm     = llmVal   !== "" ? llmVal   : String(data?.llm_monthly_usd   ?? "");

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!data?.workspaceId) throw new Error("No workspace");
      return saveFn({ data: {
        workspaceId:       data.workspaceId,
        enabled:           effectiveEnabled,
        video_monthly_usd: effectiveVideo ? Number(effectiveVideo) : null,
        image_monthly_usd: effectiveImage ? Number(effectiveImage) : null,
        llm_monthly_usd:   effectiveLlm   ? Number(effectiveLlm)   : null,
      }});
    },
    onSuccess: () => {
      toast.success("Generation limits saved");
      qc.invalidateQueries({ queryKey: ["my-generation-limits"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Failed to save"),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/15 ring-1 ring-violet-500/25">
            <Shield className="h-4 w-4 text-violet-400" />
          </div>
          <div>
            <p className="text-sm font-semibold">AI Generation Limits</p>
            <p className="text-xs text-muted-foreground">Set monthly hard caps to prevent runaway AI costs</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{effectiveEnabled ? "Enabled" : "Disabled"}</span>
          <Switch
            checked={effectiveEnabled}
            onCheckedChange={setEnabled}
          />
        </div>
      </div>

      <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-4 py-3 flex items-start gap-2 text-xs text-blue-300/80">
        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span>Leave a field blank to apply no limit. When a cap is reached, generation is blocked with a clear error. Limits reset on the 1st of each month.</span>
      </div>

      <div className="space-y-3">
        <LimitField
          icon={<Video className="h-4 w-4 text-violet-400" />}
          label="Video generation"
          description="Veo 3 and Runway Gen-4 generations. Each clip costs approx $1.70–$2.40."
          value={effectiveVideo}
          onChange={setVideoVal}
          disabled={!effectiveEnabled}
        />
        <LimitField
          icon={<Image className="h-4 w-4 text-blue-400" />}
          label="Image generation"
          description="DALL-E, Imagen, and Flux generations."
          value={effectiveImage}
          onChange={setImageVal}
          disabled={!effectiveEnabled}
        />
        <LimitField
          icon={<Cpu className="h-4 w-4 text-emerald-400" />}
          label="LLM (AI text)"
          description="All OpenAI, Gemini, and Claude API calls."
          value={effectiveLlm}
          onChange={setLlmVal}
          disabled={!effectiveEnabled}
        />
      </div>

      <div className="flex justify-end">
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
          size="sm"
          className="gap-1.5 bg-violet-600 hover:bg-violet-500"
        >
          {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save Limits
        </Button>
      </div>
    </div>
  );
}
