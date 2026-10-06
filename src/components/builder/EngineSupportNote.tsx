import { useBuilderStore } from "@/lib/builder/store";
import { settingSupport } from "@/lib/builder/engine-capabilities";
import type { BuilderSettings } from "@/lib/builder/types";

/** One line under a control when the agent's engine ignores (or only partly honours) it. */
export function EngineSupportNote({ setting }: { setting: keyof BuilderSettings }) {
  const settings = useBuilderStore((s) => s.settings);
  const { support, note } = settingSupport(setting, settings);
  if (support === "full" || !note) return null;
  return <p className="text-[10px] leading-snug text-amber-600 dark:text-amber-400">{note}</p>;
}

export function useSettingSupported(setting: keyof BuilderSettings): boolean {
  const settings = useBuilderStore((s) => s.settings);
  return settingSupport(setting, settings).support !== "none";
}
