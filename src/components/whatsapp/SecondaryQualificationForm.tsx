import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { SecondaryQualification } from "@/lib/whatsapp/campaign-types.shared";

export function SecondaryQualificationForm({
  value,
  onChange,
  compact = false,
}: {
  value: SecondaryQualification;
  onChange: (next: SecondaryQualification) => void;
  compact?: boolean;
}) {
  const inputClass = compact ? "h-8 text-xs" : "h-9 text-sm";
  const field = (
    key: keyof SecondaryQualification,
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
      {field("budget", "Budget", "e.g. AED 2M – 3M")}
      {field("preferred_area_community", "Preferred area / community", "e.g. JVC")}
      <div className="grid grid-cols-2 gap-2">
        {field("property_type", "Property type", "Villa / Apartment / Townhouse")}
        {field("bedrooms_size", "Bedrooms / size", "e.g. 3BR")}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {field("cash_or_mortgage", "Cash / mortgage", "Cash / Mortgage")}
        {field("ready_to_move_or_investment", "Ready to move / investment", "Ready to move / Investment")}
      </div>
      {field("purchase_timeline", "Purchase timeline", "e.g. Within 3 months")}
      {field("existing_property_preference", "Existing property / project preference", "e.g. Specific building")}
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
