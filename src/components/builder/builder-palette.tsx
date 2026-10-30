/** Builder — node palette buttons and component icons. */
import { Globe, MessageSquare as MsgSq, Radio, Clock } from "lucide-react";
import {
  MessageCircle,
  Cpu,
  PhoneForwarded,
  Hash,
  GitBranch,
  Users,
  MessageSquare,
  Braces,
  Code as CodeIcon,
  Square,
  StickyNote,
  CalendarCheck,
  Image as ImageIcon,
  CalendarClock,
  LayoutGrid,
  PauseCircle,
  Tag,
  FileText,
  FolderOpen,
  Link,
  Flag,
} from "lucide-react";
import type { NodeKind } from "@/lib/builder/types";
import { paletteFor } from "@/lib/builder/node-registry";
import { type FlowComponentDef } from "@/lib/builder/flow-components";

export const PALETTE_UI: Record<NodeKind, { icon: React.ElementType; color: string }> = {
  begin: { icon: Flag, color: "text-violet-500" },
  conversation: { icon: MessageCircle, color: "text-sky-600" },
  wait: { icon: PauseCircle, color: "text-amber-500" },
  subagent: { icon: Users, color: "text-sky-500" },
  ending: { icon: Square, color: "text-rose-600" },
  function: { icon: Cpu, color: "text-violet-600" },
  call_transfer: { icon: PhoneForwarded, color: "text-emerald-600" },
  press_digit: { icon: Hash, color: "text-cyan-600" },
  logic_split: { icon: GitBranch, color: "text-pink-600" },
  agent_transfer: { icon: Users, color: "text-orange-600" },
  sms: { icon: MessageSquare, color: "text-amber-600" },
  extract_variable: { icon: Braces, color: "text-indigo-600" },
  code: { icon: CodeIcon, color: "text-slate-700" },
  note: { icon: StickyNote, color: "text-yellow-700" },
  check_documents: { icon: FolderOpen, color: "text-teal-600" },
  send_upload_link: { icon: Link, color: "text-sky-600" },
  http_request: { icon: Globe, color: "text-blue-600" },
  mcp: { icon: Radio, color: "text-fuchsia-500" },
  wa_start: { icon: MsgSq, color: "text-green-500" },
  wa_message: { icon: MsgSq, color: "text-green-600" },
  wa_media: { icon: ImageIcon, color: "text-lime-600" },
  wa_booking: { icon: CalendarCheck, color: "text-sky-600" },
  wa_delay: { icon: Clock, color: "text-teal-600" },
  wa_wait_reply: { icon: PauseCircle, color: "text-amber-600" },
  wa_extract_var: { icon: Braces, color: "text-indigo-600" },
  wa_tag: { icon: Tag, color: "text-purple-600" },
  wa_template: { icon: FileText, color: "text-blue-600" },
};

export function paletteButtons(channel: "voice" | "whatsapp") {
  return paletteFor(channel).map((d) => ({
    kind: d.kind,
    label: d.label,
    icon: PALETTE_UI[d.kind]?.icon ?? MessageCircle,
    color: PALETTE_UI[d.kind]?.color ?? "text-muted-foreground",
  }));
}

export const COMPONENT_ICONS: Record<FlowComponentDef["icon"], typeof CalendarClock> = {
  booking: CalendarClock,
  contact: Users,
  handoff: PhoneForwarded,
  wait: PauseCircle,
  http: Globe,
  end: Square,
  custom: LayoutGrid,
};
