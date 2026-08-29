import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CampaignQualification } from "@/lib/whatsapp/campaign-leads.shared";

const INTENT_NONE = "__none__";

export function CampaignQualificationForm({
  value,
  onChange,
  compact = false,
}: {
  value: CampaignQualification;
  onChange: (next: CampaignQualification) => void;
  compact?: boolean;
}) {
  const inputClass = compact ? "h-8 text-xs" : "h-9 text-sm";
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Requirement</Label>
        <Select
          value={value.intent || INTENT_NONE}
          onValueChange={(v) =>
            onChange({ ...value, intent: v === INTENT_NONE ? "" : (v as CampaignQualification["intent"]) })
          }
        >
          <SelectTrigger className={inputClass}>
            <SelectValue placeholder="Sell, rent, or both" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={INTENT_NONE}>Not set</SelectItem>
            <SelectItem value="sell">Sell</SelectItem>
            <SelectItem value="rent">Rent</SelectItem>
            <SelectItem value="both">Both</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {(value.intent === "sell" || value.intent === "both" || !value.intent) && (
        <div className="space-y-1.5">
          <Label className="text-xs">Asking price</Label>
          <Input
            className={inputClass}
            placeholder="e.g. AED 1.85M"
            value={value.asking_price}
            onChange={(e) => onChange({ ...value, asking_price: e.target.value })}
          />
        </div>
      )}

      {(value.intent === "rent" || value.intent === "both" || !value.intent) && (
        <div className="space-y-1.5">
          <Label className="text-xs">Rental price</Label>
          <Input
            className={inputClass}
            placeholder="e.g. AED 85,000 / year"
            value={value.rental_price}
            onChange={(e) => onChange({ ...value, rental_price: e.target.value })}
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Availability</Label>
          <Input
            className={inputClass}
            placeholder="Immediate / date"
            value={value.availability}
            onChange={(e) => onChange({ ...value, availability: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Property status</Label>
          <Input
            className={inputClass}
            placeholder="Ready / off-plan"
            value={value.property_status}
            onChange={(e) => onChange({ ...value, property_status: e.target.value })}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Viewing availability</Label>
        <Input
          className={inputClass}
          placeholder="Weekdays after 5pm…"
          value={value.viewing_availability}
          onChange={(e) => onChange({ ...value, viewing_availability: e.target.value })}
        />
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Qualification notes</Label>
        <Textarea
          className="min-h-[72px] text-xs"
          placeholder="Anything the next agent should know…"
          value={value.notes}
          onChange={(e) => onChange({ ...value, notes: e.target.value })}
        />
      </div>
    </div>
  );
}
