import type { DeploymentMode } from "@/lib/runtime/types";

/** Industries that agent templates are grouped by on the Templates page. */
export const TEMPLATE_INDUSTRIES = [
  { value: "real_estate", label: "Real estate" },
  { value: "healthcare", label: "Healthcare" },
  { value: "legal", label: "Legal" },
  { value: "finance", label: "Finance & lending" },
  { value: "home_services", label: "Home services" },
  { value: "recruitment", label: "Recruitment" },
  { value: "general", label: "General" },
] as const;

export type TemplateIndustry = (typeof TEMPLATE_INDUSTRIES)[number]["value"];

export function templateIndustryLabel(value: unknown): string {
  return TEMPLATE_INDUSTRIES.find((i) => i.value === value)?.label ?? "General";
}

/**
 * The engine a template's agent runs on. Uses the template's own deploymentMode; older templates
 * without one are Retell, or OpenAI Native when they use the realtime voice provider. Templates
 * used to always open as Retell (or OpenAI) here, so a WEBEE Native template lost its engine.
 */
export function templateDeploymentMode(settings: Record<string, unknown> | null | undefined): DeploymentMode {
  const mode = String(settings?.deploymentMode ?? "").trim() as DeploymentMode;
  if ((DEPLOYMENT_MODES as readonly string[]).includes(mode)) return mode;
  return settings?.voiceProvider === "OPENAI_REALTIME" ? "OPENAI_NATIVE" : "RETELL";
}

const DEPLOYMENT_MODES: readonly DeploymentMode[] = [
  "RETELL",
  "OPENAI_NATIVE",
  "ELEVENLABS_NATIVE",
  "WEBEE_NATIVE",
  "CLAUDE_NATIVE",
  "GEMINI_NATIVE",
];
