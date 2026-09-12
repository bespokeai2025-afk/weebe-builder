import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { OffPlanQualification } from "@/lib/whatsapp/campaign-types.shared";

export function OffPlanQualificationForm({
  value,
  onChange,
  compact = false,
}: {
  value: OffPlanQualification;
  onChange: (next: OffPlanQualification) => void;
  compact?: boolean;
}) {
  const inputClass = compact ? "h-8 text-xs" : "h-9 text-sm";
  const field = (
    key: keyof OffPlanQualification,
    label: string,
    placeholder: string,
  ) => (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input
        className={inputClass}
        placeholder={placeholder}
        value={value[key]}
        onChange={(e) => onChange({ ...value, [key]: e.target.value })}
      />
    </div>
  );

  return (
    <div className="space-y-3">
      {field("budget", "Budget", "e.g. AED 1.5M – 2M")}
      {field("preferred_area_project", "Preferred area / project", "e.g. Dubai Marina")}
      {field("developer_project", "Developer / project", "e.g. Emaar · Beachfront")}
      <div className="grid grid-cols-2 gap-2">
        {field("unit_type_size", "Unit type / size", "e.g. 1BR, 750 sqft")}
        {field("investment_or_end_use", "Investment or end use", "Investment / End use")}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {field("cash_or_financing", "Cash / financing", "Cash / Financing")}
        {field("preferred_payment_plan", "Preferred payment plan", "e.g. 60/40")}
      </div>
      {field("purchase_timeline", "Purchase timeline", "e.g. Within 3 months")}
      <div className="space-y-1.5">
        <Label className="text-xs">Specific requirements</Label>
        <Textarea
          className="text-xs min-h-16"
          placeholder="Any other requirements"
          value={value.specific_requirements}
          onChange={(e) => onChange({ ...value, specific_requirements: e.target.value })}
        />
      </div>
    </div>
  );
}
