import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBuilderStore } from "@/lib/builder/store";
import { LEGACY_PHONE_COUNTRY_CODE } from "@/lib/builder/export-conversation-flow";

const LEGACY_TIMEZONE = "Europe/London";

function timezoneList(): string[] {
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    return fn ? fn("timeZone") : [];
  } catch {
    return [];
  }
}

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Where the agent operates. Both values used to be fixed in code (UK time, +44 numbers); unset,
 * they keep those defaults so existing agents behave exactly as before.
 */
export function LocaleSettingsFields() {
  const settings = useBuilderStore((s) => s.settings);
  const setSettings = useBuilderStore((s) => s.setSettings);
  const zones = useMemo(timezoneList, []);
  const tz = settings.timezone ?? "";
  const cc = settings.phoneCountryCode ?? "";
  const tzInvalid = tz.trim() !== "" && !isValidTimezone(tz.trim());

  return (
    <div className="grid grid-cols-2 gap-2">
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">Timezone</Label>
        <Input
          className="h-8 text-[11px]"
          list="builder-timezones"
          placeholder={`${LEGACY_TIMEZONE} (default)`}
          value={tz}
          onChange={(e) => setSettings({ timezone: e.target.value || undefined })}
        />
        <datalist id="builder-timezones">
          {zones.map((z) => (
            <option key={z} value={z} />
          ))}
        </datalist>
        {tzInvalid ? (
          <p className="text-[10px] text-destructive">Not a timezone name — pick one from the list.</p>
        ) : (
          <p className="text-[10px] text-muted-foreground">Dates, times and calendar slots.</p>
        )}
      </div>
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground">Phone country code</Label>
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-muted-foreground">+</span>
          <Input
            className="h-8 text-[11px]"
            inputMode="numeric"
            placeholder={`${LEGACY_PHONE_COUNTRY_CODE} (default)`}
            value={cc}
            onChange={(e) =>
              setSettings({ phoneCountryCode: e.target.value.replace(/\D/g, "").slice(0, 4) || undefined })
            }
          />
        </div>
        <p className="text-[10px] text-muted-foreground">Used for numbers written with a leading 0.</p>
      </div>
    </div>
  );
}
