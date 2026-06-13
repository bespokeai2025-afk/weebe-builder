import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  CalendarDays,
  Clock,
  Loader2,
  Mail,
  Target,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  saveHexmailCampaign,
  type CampaignConfig,
} from "@/lib/hexmail/campaigns.functions";
import { listHexmailTemplates } from "@/lib/hexmail/templates.functions";

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Australia/Sydney",
  "UTC",
];

const LEAD_STATUSES = [
  { value: "pending_action", label: "Pending Action" },
  { value: "not_uploaded",   label: "Not Uploaded" },
  { value: "completed",      label: "Completed" },
  { value: "new",            label: "New Lead" },
  { value: "contacted",      label: "Contacted" },
];

function SectionCard({
  icon: Icon,
  title,
  children,
  className,
}: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border bg-card", className)}>
      <div className="flex items-center gap-2.5 border-b px-5 py-3.5">
        <Icon className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      <div className="px-5 py-4 space-y-4">{children}</div>
    </div>
  );
}

interface CreateCampaignFormProps {
  onBack: () => void;
  onSaved: (id: string) => void;
}

export function CreateCampaignForm({ onBack, onSaved }: CreateCampaignFormProps) {
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [config, setConfig] = useState<CampaignConfig>({
    template_id: null,
    target_statuses: [],
    start_date: "",
    end_date: "",
    execution_time: "",
    timezone: "America/New_York",
    frequency: "daily",
    interval_days: 1,
  });

  const templatesQ = useQuery({
    queryKey: ["hexmail-templates"],
    queryFn: () => listHexmailTemplates({ data: { includeArchived: false } }),
  });

  const emailTemplates = (templatesQ.data ?? []).filter((t) => t.type === "email");

  const patchConfig = (patch: Partial<CampaignConfig>) =>
    setConfig((prev) => ({ ...prev, ...patch }));

  const toggleStatus = (val: string) => {
    const cur = config.target_statuses ?? [];
    patchConfig({
      target_statuses: cur.includes(val) ? cur.filter((s) => s !== val) : [...cur, val],
    });
  };

  const saveMut = useMutation({
    mutationFn: (status: "draft" | "active") =>
      saveHexmailCampaign({
        data: {
          name: name.trim(),
          description: description.trim() || null,
          status,
          config,
          steps: [],
        },
      }),
    onSuccess: (result, status) => {
      qc.invalidateQueries({ queryKey: ["hexmail-campaigns"] });
      toast.success(status === "active" ? "Campaign launched!" : "Campaign saved as draft");
      onSaved(result.id);
    },
    onError: (e: any) => toast.error(e?.message ?? "Save failed"),
  });

  const canSave = name.trim().length > 0;

  return (
    <div className="space-y-5 max-w-2xl">
      {/* Back + title */}
      <div>
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Campaigns
        </button>
        <h2 className="text-lg font-semibold">Create Email Campaign</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Set up automated email campaigns with scheduling and targeting.
        </p>
      </div>

      {/* ── Campaign Details ── */}
      <SectionCard icon={Mail} title="Campaign Details">
        <div className="space-y-1.5">
          <Label>Campaign Name <span className="text-destructive">*</span></Label>
          <Input
            autoFocus
            placeholder="e.g., Weekly Lead Follow-up"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Description <span className="text-muted-foreground text-xs">(optional)</span></Label>
          <Input
            placeholder="What is this campaign for?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Email Template</Label>
          <Select
            value={config.template_id ?? "none"}
            onValueChange={(v) => patchConfig({ template_id: v === "none" ? null : v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a template…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No template</SelectItem>
              {emailTemplates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
              {emailTemplates.length === 0 && (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  No email templates yet
                </div>
              )}
            </SelectContent>
          </Select>
        </div>
      </SectionCard>

      {/* ── Audience Targeting ── */}
      <SectionCard icon={Users} title="Audience Targeting">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground uppercase tracking-wide">
            Target Leads by Status
          </Label>
          <div className="mt-2 rounded-md border divide-y overflow-hidden">
            {LEAD_STATUSES.map((s) => {
              const checked = (config.target_statuses ?? []).includes(s.value);
              return (
                <label
                  key={s.value}
                  className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
                >
                  <span className="text-sm">{s.label}</span>
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => toggleStatus(s.value)}
                  />
                </label>
              );
            })}
          </div>
        </div>
        {(config.target_statuses ?? []).length > 0 && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Target className="h-3.5 w-3.5 text-primary" />
            {(config.target_statuses ?? []).length} status
            {(config.target_statuses ?? []).length !== 1 ? "es" : ""} selected
          </p>
        )}
      </SectionCard>

      {/* ── Schedule Configuration ── */}
      <SectionCard icon={CalendarDays} title="Schedule Configuration">
        {/* Start / End date */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Start Date</Label>
            <Input
              type="date"
              value={config.start_date ?? ""}
              onChange={(e) => patchConfig({ start_date: e.target.value || null })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>End Date</Label>
            <Input
              type="date"
              value={config.end_date ?? ""}
              onChange={(e) => patchConfig({ end_date: e.target.value || null })}
            />
          </div>
        </div>

        {/* Execution time */}
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            Execution Time
          </Label>
          <Input
            type="time"
            value={config.execution_time ?? ""}
            onChange={(e) => patchConfig({ execution_time: e.target.value || null })}
          />
          {config.timezone && (
            <p className="text-xs text-muted-foreground">Timezone: {config.timezone}</p>
          )}
        </div>

        {/* Timezone */}
        <div className="space-y-1.5">
          <Label>Timezone</Label>
          <Select
            value={config.timezone ?? "UTC"}
            onValueChange={(v) => patchConfig({ timezone: v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEZONES.map((tz) => (
                <SelectItem key={tz} value={tz}>
                  {tz}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Separator />

        {/* Frequency */}
        <div className="space-y-2">
          <Label>Frequency</Label>
          <div className="grid grid-cols-2 gap-2">
            {(["daily", "custom_interval"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => patchConfig({ frequency: f })}
                className={cn(
                  "rounded-md border px-4 py-2.5 text-sm font-medium transition-colors",
                  config.frequency === f
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card text-muted-foreground hover:bg-muted/40",
                )}
              >
                {f === "daily" ? "Daily" : "Custom Interval"}
              </button>
            ))}
          </div>
        </div>

        {/* Interval */}
        {config.frequency === "custom_interval" && (
          <div className="space-y-1.5">
            <Label>Run every (days)</Label>
            <Input
              type="number"
              min={1}
              max={365}
              value={config.interval_days ?? 1}
              onChange={(e) =>
                patchConfig({ interval_days: Math.max(1, parseInt(e.target.value) || 1) })
              }
              className="w-32"
            />
          </div>
        )}
      </SectionCard>

      {/* Footer actions */}
      <div className="flex items-center justify-end gap-2 pt-1 pb-6">
        <Button variant="ghost" onClick={onBack} disabled={saveMut.isPending}>
          Cancel
        </Button>
        <Button
          variant="outline"
          disabled={!canSave || saveMut.isPending}
          onClick={() => saveMut.mutate("draft")}
        >
          {saveMut.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />}
          Save as Draft
        </Button>
        <Button
          disabled={!canSave || saveMut.isPending}
          onClick={() => saveMut.mutate("active")}
          className="gap-2"
        >
          {saveMut.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Launch Campaign
        </Button>
      </div>
    </div>
  );
}
