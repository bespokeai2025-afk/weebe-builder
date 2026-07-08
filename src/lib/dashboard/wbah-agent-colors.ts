/** Shared agent colour tokens for WBAH surfaces (calendar, leads, qualified). */
export type WbahAgentStyle = {
  bg: string;
  text: string;
  dot: string;
  ring: string;
  hex: string;
};

export const WBAH_AGENT_PALETTE: WbahAgentStyle[] = [
  { bg: "bg-violet-500/20",  text: "text-violet-300",  dot: "bg-violet-400",  ring: "ring-violet-500/30",  hex: "#a78bfa" },
  { bg: "bg-cyan-500/20",    text: "text-cyan-300",    dot: "bg-cyan-400",    ring: "ring-cyan-500/30",    hex: "#22d3ee" },
  { bg: "bg-emerald-500/20", text: "text-emerald-300", dot: "bg-emerald-400", ring: "ring-emerald-500/30", hex: "#34d399" },
  { bg: "bg-pink-500/20",    text: "text-pink-300",    dot: "bg-pink-400",    ring: "ring-pink-500/30",    hex: "#f472b6" },
  { bg: "bg-orange-500/20",  text: "text-orange-300",  dot: "bg-orange-400",  ring: "ring-orange-500/30", hex: "#fb923c" },
  { bg: "bg-yellow-500/20",  text: "text-yellow-300",  dot: "bg-yellow-400",  ring: "ring-yellow-500/30", hex: "#facc15" },
  { bg: "bg-sky-500/20",     text: "text-sky-300",     dot: "bg-sky-400",     ring: "ring-sky-500/30",    hex: "#38bdf8" },
];

export const WBAH_UNKNOWN_AGENT_STYLE: WbahAgentStyle = {
  bg: "bg-slate-500/20",
  text: "text-slate-300",
  dot: "bg-slate-400",
  ring: "ring-slate-500/30",
  hex: "#94a3b8",
};

export function buildWbahAgentColorMap(agentNames: string[]): Map<string, WbahAgentStyle> {
  const unique = Array.from(new Set(agentNames.map((n) => n.trim()).filter(Boolean))).sort();
  const map = new Map<string, WbahAgentStyle>();
  unique.forEach((name, i) => map.set(name, WBAH_AGENT_PALETTE[i % WBAH_AGENT_PALETTE.length]));
  return map;
}

export function wbahAgentStyle(
  agentName: string | null | undefined,
  colorMap?: Map<string, WbahAgentStyle>,
): WbahAgentStyle {
  if (!agentName?.trim()) return WBAH_UNKNOWN_AGENT_STYLE;
  return colorMap?.get(agentName.trim()) ?? WBAH_UNKNOWN_AGENT_STYLE;
}
