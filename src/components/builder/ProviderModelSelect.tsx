import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface ModelOption {
  id: string;
  label: string;
  description: string;
}

/**
 * Model picker for one voice provider (Deepgram, Cartesia). Options come from that provider's own
 * config file, so the builder never offers a model the engine does not know. A model stored on an
 * agent that is no longer offered (e.g. sonic-2) still shows, marked as older.
 */
export function ProviderModelSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly ModelOption[];
  onChange: (id: string) => void;
}) {
  const current = options.find((o) => o.id === value);
  return (
    <div className="space-y-1">
      <Label className="text-[10px] text-muted-foreground">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 text-[11px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {!current && value && (
            <SelectItem value={value}>{value} (no longer offered)</SelectItem>
          )}
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-[10px] leading-snug text-muted-foreground">
        {current?.description ?? "Pick a current model for the best speed and accuracy."}
      </p>
    </div>
  );
}
