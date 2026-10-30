/** Node editor — booking presets, default prompt and the instruction-type tabs. */
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { FlowNodeData } from "@/lib/builder/types";
import { normalizeBuilderSpeechMode, type BuilderSpeechMode } from "@/lib/voice/graph/speech-mode.shared";
import { Fragment } from "react";

export const BOOKING_PRESETS: {
  id: string;
  label: string;
  defaultName: string;
  defaultDescription: string;
}[] = [
  {
    id: "check_availability",
    label: "Check Calendar Availability (Cal.com)",
    defaultName: "check_availability_cal",
    defaultDescription:
      "Fetch open calendar slots for a date range. Call this BEFORE attempting to book. Required arguments: `start_date` (ISO date, e.g. 2026-06-01) and `end_date` (ISO date). Optional: `timezone` (IANA, defaults to workspace tz). Returns a list of available slots in ISO 8601.",
  },
  {
    id: "book_appointment",
    label: "Book on the Calendar (Cal.com)",
    defaultName: "book_appointment_cal",
    defaultDescription:
      "Create a confirmed booking on the calendar. Only call this AFTER you have collected and verbally confirmed EVERY required field. Required arguments: `name` (caller's full name, first + last), `email` (a valid email — spell it back letter-by-letter to confirm; never guess), `phone` (E.164 format — always collect, even if the caller is calling from a known number), `start` (ISO 8601 start time taken from check_availability), `timezone` (IANA, e.g. America/New_York — infer from the caller's area code if possible, then confirm verbally; ask if uncertain). Optional: `notes` (short summary). Always pass both email AND phone — the API rejects bookings missing both contact methods.",
  },
  {
    id: "reschedule_appointment",
    label: "Reschedule Appointment (Cal.com)",
    defaultName: "reschedule_appointment_cal",
    defaultDescription:
      "Move an existing booking to a new slot. Required arguments: `booking_id` (uid returned at booking time, or look it up by email), `new_start` (ISO 8601 from check_availability). Optional: `reason`.",
  },
  {
    id: "cancel_appointment",
    label: "Cancel Appointment (Cal.com)",
    defaultName: "cancel_appointment_cal",
    defaultDescription:
      "Cancel an existing booking. Required: `booking_id` (uid). Optional: `reason`. Confirm with the caller before calling.",
  },
];

export const DEFAULT_PROMPT_TEMPLATE = (stepLabel: string) =>
  [
    `## Goal`,
    `Accomplish "${stepLabel}" in a natural, conversational way.`,
    "",
    "## What to do",
    "1. Greet the caller briefly (only on the first turn).",
    "2. Ask the questions you need, one at a time — never stack multiple questions in one turn.",
    '3. For every piece of data you must capture (name, email, phone, address, dates, etc.) repeat it back to confirm before moving on. For emails, spell letter-by-letter (e.g. "j-o-h-n at gmail dot com").',
    "4. If the caller mentions booking, scheduling, rescheduling, or cancelling:",
    "   a. Collect full name, a valid email (spelled back letter-by-letter), and phone number (even if they are already calling from a known number — ask to confirm).",
    "   b. Determine timezone: infer it from the caller's area code (e.g. 212 → America/New_York, 310 → America/Los_Angeles, 44 prefix → Europe/London) and say it aloud to confirm (e.g. 'I'll book that in Eastern Time — is that right?'). Ask if you cannot determine it.",
    "   c. Then call the appropriate booking tool with ALL required fields. Never call book_appointment without both a confirmed email AND phone.",
    "5. Keep replies short (1–2 sentences). Sound human; avoid reading raw JSON, IDs, or URLs.",
    "",
    "## Rules",
    "- Never invent information you don't have — ask the caller.",
    "- If a tool errors, apologize briefly and offer an alternative.",
    "- Move to the next step only when you have everything required here.",
  ].join("\n");

export function InstructionTypeTabs({
  value,
  onChange,
  compact,
}: {
  value: string;
  onChange: (value: BuilderSpeechMode) => void;
  compact?: boolean;
}) {
  const current = normalizeBuilderSpeechMode(value);
  const tabs = [
    {
      id: "static_text" as const,
      label: compact ? "Static" : "Static Sentence",
      hint: "Spoken word-for-word after variables resolve. No LLM.",
    },
    {
      id: "prompt" as const,
      label: "Prompt",
      hint: "LLM writes the line from your instruction.",
    },
  ];
  return (
    <div
      className={
        compact
          ? "rounded-md border border-border dark:border-white/[0.08] bg-black/20 p-0.5"
          : "rounded-lg border bg-muted/30 p-1"
      }
    >
      <div className={compact ? "grid grid-cols-2 gap-0.5" : "grid grid-cols-2 gap-1"}>
        {/* The hint is a tooltip rather than a permanent second line: it is
            read once while learning the two modes, then costs vertical space
            on every visit after that.
            Only in the side panel, never on the canvas card — a tooltip that
            follows the pointer across the graph fires while you are panning or
            reaching for another node, which is why the inline hint was
            `!compact` in the first place. */}
        {tabs.map((tab) => {
          const selected = current === tab.id;
          const button = (
            <button
              type="button"
              onClick={() => onChange(tab.id)}
              // w-full matters: in the compact case this button is wrapped for
              // keying, and without it the element shrank to its label and sat
              // as a small pill in the middle of an empty half.
              className={
                compact
                  ? `w-full rounded px-2 py-1 text-center text-[11px] font-medium leading-none transition-colors ${
                      selected
                        ? "bg-primary/15 text-primary ring-1 ring-primary/30"
                        : "text-muted-foreground hover:bg-muted dark:hover:bg-white/[0.04] hover:text-foreground"
                    }`
                  : `w-full rounded-md px-3 py-2 text-center text-sm font-medium transition-colors ${
                      selected
                        ? "bg-background shadow-sm ring-1 ring-border"
                        : "text-muted-foreground hover:text-foreground"
                    }`
              }
            >
              {tab.label}
            </button>
          );
          // Fragment, not a div: a wrapper element becomes the grid item and
          // stops the button from filling its track.
          if (compact) return <Fragment key={tab.id}>{button}</Fragment>;
          return (
            <Tooltip key={tab.id}>
              <TooltipTrigger asChild>{button}</TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[220px] text-[11px]">
                {tab.hint}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

export function patchSpeechMode(
  d: {
    kind: string;
    instructionType?: string;
    dialogue?: string;
    speechPrefix?: string;
    endingPrompt?: string;
  },
  next: BuilderSpeechMode,
): Partial<FlowNodeData> {
  const prev = normalizeBuilderSpeechMode(
    d.instructionType ?? (d.kind === "wait" || d.kind === "begin" ? "static_text" : "prompt"),
  );
  const patch: Partial<FlowNodeData> = { instructionType: next };
  const spoken = d.kind === "ending" ? d.endingPrompt : d.dialogue;
  // Legacy hybrid nodes kept their exact words in speechPrefix. Switching such
  // a node to Exact should recover those words rather than leave the box empty.
  if (next === "static_text" && d.speechPrefix && !spoken) {
    if (d.kind === "ending") patch.endingPrompt = d.speechPrefix;
    else patch.dialogue = d.speechPrefix;
    patch.speechPrefix = "";
  }
  return patch;
}
