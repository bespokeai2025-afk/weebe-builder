import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Guide content definition
// ─────────────────────────────────────────────────────────────────────────────
const SECTIONS: Array<{
  id: string;
  emoji: string;
  title: string;
  items: Array<{ label: string; body: React.ReactNode }>;
}> = [
  {
    id: "voice",
    emoji: "🎙️",
    title: "Voice Commands",
    items: [
      {
        label: "Switching modes",
        body: (
          <ul className="space-y-1.5">
            {[
              ['"Switch to Webee Build"', "Activates Macro Blueprint mode"],
              ['"Webee help"', "Opens Platform Helper mode (this guide)"],
              ['"Exit help" / "Switch back to normal"', "Returns to single-command mode"],
            ].map(([cmd, desc]) => (
              <li key={cmd} className="flex flex-col gap-0.5">
                <code className="text-purple-300 bg-purple-500/10 rounded px-1.5 py-0.5 text-[10px] font-mono">{cmd}</code>
                <span className="text-[10px] text-slate-400 pl-1">{desc}</span>
              </li>
            ))}
          </ul>
        ),
      },
      {
        label: "Single-command examples",
        body: (
          <ul className="space-y-1.5">
            {[
              ['"Add a logic split node"', "Creates a Logic Split"],
              ['"Connect Intro to Triage"', "Wires two nodes"],
              ['"Add a transition labelled Yes"', "Creates a handle"],
              ['"Delete the conversation node"', "Removes a node & wires"],
              ['"Rename this node to Welcome"', "Updates a node label"],
              ['"Set the welcome message to…"', "Updates node dialogue"],
            ].map(([cmd, desc]) => (
              <li key={cmd} className="flex flex-col gap-0.5">
                <code className="text-sky-300 bg-sky-500/10 rounded px-1.5 py-0.5 text-[10px] font-mono">{cmd}</code>
                <span className="text-[10px] text-slate-400 pl-1">{desc}</span>
              </li>
            ))}
          </ul>
        ),
      },
    ],
  },
  {
    id: "nodes",
    emoji: "🔷",
    title: "Node Types",
    items: [
      {
        label: "Conversation",
        body: (
          <p className="text-[11px] text-slate-300 leading-relaxed">
            The core speaking node. Write what the AI agent says in the <strong className="text-white">Dialogue</strong> field. Add transition handles (+ button) to branch to next nodes.
          </p>
        ),
      },
      {
        label: "Logic Split",
        body: (
          <p className="text-[11px] text-slate-300 leading-relaxed">
            Branches the conversation based on caller intent. Add conditions in the right panel — each becomes a labelled output handle. Wire each handle to the appropriate next node.
          </p>
        ),
      },
      {
        label: "Extract Variable",
        body: (
          <p className="text-[11px] text-slate-300 leading-relaxed">
            Captures a value the caller says (e.g. their name or order ID). Set a <code className="text-amber-300 bg-amber-500/10 rounded px-1 text-[10px]">variable_name</code> in snake_case. Reference it downstream using <code className="text-amber-300 bg-amber-500/10 rounded px-1 text-[10px]">{"{{variable_name}}"}</code>.
          </p>
        ),
      },
      {
        label: "Function",
        body: (
          <p className="text-[11px] text-slate-300 leading-relaxed">
            Calls an external API or tool mid-call. Set <code className="text-amber-300 bg-amber-500/10 rounded px-1 text-[10px]">function_name</code> to match a tool registered in your platform account (e.g. <code className="text-amber-300 bg-amber-500/10 rounded px-1 text-[10px]">check_availability</code>).
          </p>
        ),
      },
      {
        label: "Call Transfer",
        body: (
          <p className="text-[11px] text-slate-300 leading-relaxed">
            Forwards the live call to a phone number. Set <code className="text-amber-300 bg-amber-500/10 rounded px-1 text-[10px]">phone_number</code> in the properties panel (E.164 format, e.g. <code className="text-amber-300 bg-amber-500/10 rounded px-1 text-[10px]">+12125550100</code>).
          </p>
        ),
      },
      {
        label: "In-Call SMS",
        body: (
          <p className="text-[11px] text-slate-300 leading-relaxed">
            Sends a text message to the caller mid-call. Set <code className="text-amber-300 bg-amber-500/10 rounded px-1 text-[10px]">sms_body</code> with the message. You can include captured variables using <code className="text-amber-300 bg-amber-500/10 rounded px-1 text-[10px]">{"{{variable_name}}"}</code>.
          </p>
        ),
      },
      {
        label: "Agent Transfer",
        body: (
          <p className="text-[11px] text-slate-300 leading-relaxed">
            Hands off to a live agent queue. Configure the transfer destination in your agent's platform settings.
          </p>
        ),
      },
      {
        label: "Ending",
        body: (
          <p className="text-[11px] text-slate-300 leading-relaxed">
            Terminates the call gracefully. Always write a friendly sign-off in the Dialogue field. Every flow must have at least one Ending node.
          </p>
        ),
      },
    ],
  },
  {
    id: "blueprint",
    emoji: "⚡",
    title: "Blueprint Mode (MACRO)",
    items: [
      {
        label: "How to activate",
        body: (
          <p className="text-[11px] text-slate-300 leading-relaxed">
            Say <code className="text-yellow-300 bg-yellow-500/10 rounded px-1 text-[10px]">"Switch to Webee Build"</code> — a gold ⚡ badge appears on the mic button. In this mode, one voice sentence generates a complete multi-node flow.
          </p>
        ),
      },
      {
        label: "Trigger built-in blueprints",
        body: (
          <ul className="space-y-2">
            {[
              ['"Build me a receptionist for a dental clinic"', "Generates an 8-node appointment booking flow"],
              ['"Create a customer support system for an e-commerce store"', "Generates an 8-node support triage flow with KB lookup, SMS, and escalation"],
            ].map(([cmd, desc]) => (
              <li key={cmd} className="flex flex-col gap-0.5">
                <code className="text-yellow-300 bg-yellow-500/10 rounded px-1.5 py-0.5 text-[10px] font-mono break-words">{cmd}</code>
                <span className="text-[10px] text-slate-400 pl-1">{desc}</span>
              </li>
            ))}
          </ul>
        ),
      },
      {
        label: "Creative extrapolation",
        body: (
          <p className="text-[11px] text-slate-300 leading-relaxed">
            Describe the business and purpose and the AI fills in realistic labels, dialogues, variable names, and transition paths automatically. Include the industry and use case for best results — e.g. <em>"Build a lead gen flow for a solar panel company"</em>.
          </p>
        ),
      },
    ],
  },
  {
    id: "variables",
    emoji: "📦",
    title: "Variables & Data Capture",
    items: [
      {
        label: "Capturing a value",
        body: (
          <ol className="space-y-1 list-decimal list-inside text-[11px] text-slate-300 leading-relaxed">
            <li>Add an <strong className="text-white">Extract Variable</strong> node after a Conversation node.</li>
            <li>Set <code className="text-amber-300 bg-amber-500/10 rounded px-1 text-[10px]">variable_name</code> to a descriptive snake_case name, e.g. <code className="text-amber-300 bg-amber-500/10 rounded px-1 text-[10px]">caller_email</code>.</li>
            <li>The agent will listen and capture the caller's response automatically.</li>
          </ol>
        ),
      },
      {
        label: "Using a captured value",
        body: (
          <p className="text-[11px] text-slate-300 leading-relaxed">
            In any downstream Dialogue field, reference the variable with double curly braces: <code className="text-amber-300 bg-amber-500/10 rounded px-1 text-[10px]">{"Thanks {{caller_name}}, let me pull up your account."}</code>
          </p>
        ),
      },
      {
        label: "Post-call extraction",
        body: (
          <p className="text-[11px] text-slate-300 leading-relaxed">
            Captured variable names must match the post-call extraction fields configured in your agent settings under <strong className="text-white">Agent → Post-Call Data Retrieval</strong> exactly (case-sensitive).
          </p>
        ),
      },
    ],
  },
  {
    id: "transitions",
    emoji: "↔️",
    title: "Connections & Transitions",
    items: [
      {
        label: "Adding a handle",
        body: (
          <p className="text-[11px] text-slate-300 leading-relaxed">
            Click the <strong className="text-white">+</strong> button on the bottom of any node (or say <code className="text-sky-300 bg-sky-500/10 rounded px-1 text-[10px]">"Add a transition labelled [name]"</code>). Each handle represents a named exit path.
          </p>
        ),
      },
      {
        label: "Wiring nodes",
        body: (
          <p className="text-[11px] text-slate-300 leading-relaxed">
            Drag from a source handle to a target node. Or use voice: <code className="text-sky-300 bg-sky-500/10 rounded px-1 text-[10px]">"Connect [Node A] to [Node B] via [transition name]"</code>.
          </p>
        ),
      },
      {
        label: "Removing a wire",
        body: (
          <p className="text-[11px] text-slate-300 leading-relaxed">
            Right-click the wire and choose <strong className="text-white">Delete</strong>, or say <code className="text-sky-300 bg-sky-500/10 rounded px-1 text-[10px]">"Remove the wire between [A] and [B]"</code>. The transition handle is kept — only the wire is removed.
          </p>
        ),
      },
    ],
  },
  {
    id: "integrations",
    emoji: "🔧",
    title: "Voice & Integrations",
    items: [
      {
        label: "Cal.com — appointment booking",
        body: (
          <ol className="space-y-1 list-decimal list-inside text-[11px] text-slate-300 leading-relaxed">
            <li>Go to <strong className="text-white">Account → Integrations → Cal.com</strong>.</li>
            <li>Paste your Cal.com API key (found under Cal.com → Settings → API keys).</li>
            <li>Click Save. Your booking Function nodes will now use <code className="text-amber-300 bg-amber-500/10 rounded px-1 text-[10px]">check_availability</code> and <code className="text-amber-300 bg-amber-500/10 rounded px-1 text-[10px]">book_appointment</code> automatically.</li>
          </ol>
        ),
      },
      {
        label: "ElevenLabs — custom voice",
        body: (
          <ol className="space-y-1 list-decimal list-inside text-[11px] text-slate-300 leading-relaxed">
            <li>Go to <strong className="text-white">Account → Integrations → ElevenLabs</strong>.</li>
            <li>Paste your ElevenLabs API key and select or clone a voice.</li>
            <li>Back in the Builder, open <strong className="text-white">Agent Settings → Voice</strong> and choose your ElevenLabs voice from the dropdown.</li>
          </ol>
        ),
      },
      {
        label: "Function tools",
        body: (
          <p className="text-[11px] text-slate-300 leading-relaxed">
            Register your function tools in your platform account first, then set <code className="text-amber-300 bg-amber-500/10 rounded px-1 text-[10px]">function_name</code> on your Function node to the exact registered tool name. A mismatch will silently skip the call.
          </p>
        ),
      },
    ],
  },
  {
    id: "deploy",
    emoji: "🚀",
    title: "Going Live",
    items: [
      {
        label: "Pre-deploy checklist",
        body: (
          <ul className="space-y-1 text-[11px] text-slate-300 leading-relaxed">
            {[
              "All Call Transfer nodes have a phone_number set",
              "All Function nodes have a function_name matching a registered tool",
              "All Extract Variable nodes have a snake_case variable_name",
              "Every flow path ends at an Ending node",
              "Cal.com API key saved in Account → Integrations (if using booking)",
            ].map((item) => (
              <li key={item} className="flex items-start gap-1.5">
                <span className="text-emerald-400 mt-0.5 shrink-0">✓</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        ),
      },
      {
        label: "Publishing",
        body: (
          <ol className="space-y-1 list-decimal list-inside text-[11px] text-slate-300 leading-relaxed">
            <li>Click <strong className="text-white">Go Live</strong> in the top toolbar.</li>
            <li>The platform validates all required fields — fix any flagged errors.</li>
            <li>On success, the flow is published and activated using your production credentials.</li>
            <li>Test the live agent via your assigned phone number.</li>
          </ol>
        ),
      },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Accordion section
// ─────────────────────────────────────────────────────────────────────────────
function GuideSection({
  section,
}: {
  section: (typeof SECTIONS)[number];
}) {
  const [openItems, setOpenItems] = useState<Set<string>>(new Set());

  function toggle(label: string) {
    setOpenItems((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  const [sectionOpen, setSectionOpen] = useState(true);

  return (
    <div className="border border-white/[0.06] rounded-lg overflow-hidden">
      {/* Section header */}
      <button
        onClick={() => setSectionOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2.5 bg-white/[0.03] hover:bg-white/[0.05] transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm">{section.emoji}</span>
          <span className="text-[11px] font-bold text-white uppercase tracking-widest">{section.title}</span>
        </div>
        {sectionOpen
          ? <ChevronDown className="h-3 w-3 text-slate-500 shrink-0" />
          : <ChevronRight className="h-3 w-3 text-slate-500 shrink-0" />}
      </button>

      {/* Items */}
      {sectionOpen && (
        <div className="divide-y divide-white/[0.04]">
          {section.items.map((item) => {
            const isOpen = openItems.has(item.label);
            return (
              <div key={item.label}>
                <button
                  onClick={() => toggle(item.label)}
                  className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/[0.03] transition-colors text-left"
                >
                  <span className="text-[11px] text-slate-300 font-medium">{item.label}</span>
                  {isOpen
                    ? <ChevronDown className="h-3 w-3 text-slate-500 shrink-0" />
                    : <ChevronRight className="h-3 w-3 text-slate-500 shrink-0" />}
                </button>
                {isOpen && (
                  <div className="px-3 pb-3 pt-1">
                    {item.body}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main drawer
// ─────────────────────────────────────────────────────────────────────────────
export function PlatformGuideDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const innerRef = useRef<HTMLDivElement>(null);

  // ESC key to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <aside
      className={cn(
        "shrink-0 flex flex-col",
        "border-l border-slate-800 bg-[#0b0d12]",
        "overflow-hidden",
        "shadow-2xl",
        // When hidden, still in DOM so transition works
        !open && "pointer-events-none",
      )}
      style={{
        width: open ? 320 : 0,
        transition: "width 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
      }}
    >
      {/* Fixed-width inner so content doesn't reflow during transition */}
      <div ref={innerRef} className="w-[320px] h-full flex flex-col">

        {/* Sticky header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-[#0b0d12] sticky top-0 z-10 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm">📖</span>
            <span className="text-[11px] font-bold text-white tracking-tight">Platform User Guide</span>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center h-5 w-5 rounded text-slate-500 hover:text-white hover:bg-white/[0.08] transition-colors"
            title="Close guide (Esc)"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10">

          {/* Platform Helper callout */}
          <div className="rounded-lg border border-purple-500/30 bg-purple-500/10 px-3 py-2.5">
            <p className="text-[10px] text-purple-400 uppercase tracking-widest font-bold mb-1">Platform Helper Active</p>
            <p className="text-[11px] text-slate-300 leading-relaxed">
              Say any platform question aloud — e.g. <em>"How do I pass variables?"</em> — and the AI will answer directly. Say <code className="text-purple-300 bg-purple-500/10 rounded px-1 text-[10px]">"exit help"</code> to return to the canvas builder.
            </p>
          </div>

          {/* Guide sections */}
          {SECTIONS.map((section) => (
            <GuideSection key={section.id} section={section} />
          ))}

        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-slate-800 shrink-0">
          <p className="text-[9px] text-slate-600 text-center">
            Press <kbd className="px-1 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">Esc</kbd> or click ✕ to close
          </p>
        </div>

      </div>
    </aside>
  );
}
