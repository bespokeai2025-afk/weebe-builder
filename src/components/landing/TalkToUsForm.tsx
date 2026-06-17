import { useState } from "react";
import { X, Loader2, CheckCircle2, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface TalkToUsFormProps {
  onClose: () => void;
  sourcePage?: string;
}

const INTERESTED_IN_OPTIONS = [
  "WEBEE Receptionist",
  "WEBEE Lead Generation",
  "WEBEE Client Qualification",
  "HiveMind AI Operating System",
  "GrowthMind AI CMO",
  "Custom AI Agent",
  "Full Platform Demo",
  "Pricing & Plans",
];

const CONTACT_METHOD_OPTIONS = ["Email", "Phone", "WhatsApp"];

export function TalkToUsForm({ onClose, sourcePage }: TalkToUsFormProps) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    company_name: "",
    website: "",
    interested_in: "",
    message: "",
    preferred_contact_method: "Email",
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(key: string) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [key]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.email && !form.phone) {
      setError("Please provide an email or phone number.");
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      // Capture UTM from URL
      const urlParams = typeof window !== "undefined"
        ? new URLSearchParams(window.location.search)
        : new URLSearchParams();

      const res = await fetch("/api/public/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          source_page:  sourcePage ?? (typeof window !== "undefined" ? window.location.pathname : ""),
          utm_source:   urlParams.get("utm_source"),
          utm_campaign: urlParams.get("utm_campaign"),
          utm_medium:   urlParams.get("utm_medium"),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      setSubmitted(true);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-md px-4">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-white/[0.1] bg-[#0e0e16] shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-white/[0.07] bg-[#0e0e16]/95 px-6 py-4 backdrop-blur-sm z-10">
          <div>
            <p className="font-semibold text-sm">Talk to us</p>
            <p className="text-[11px] text-muted-foreground">Tell us what you need — we'll be in touch today.</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-1">
            <X className="h-4 w-4" />
          </button>
        </div>

        {submitted ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <div className="h-14 w-14 rounded-full bg-emerald-500/15 flex items-center justify-center mb-4">
              <CheckCircle2 className="h-7 w-7 text-emerald-400" />
            </div>
            <p className="text-lg font-semibold mb-2">Message sent!</p>
            <p className="text-sm text-muted-foreground max-w-xs">
              We'll review your enquiry and get back to you shortly. You can expect a response within 1 business day.
            </p>
            <button
              onClick={onClose}
              className="mt-6 rounded-lg bg-violet-600 hover:bg-violet-700 px-6 py-2.5 text-sm font-semibold text-white transition-all"
            >
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
            {/* Honeypot — hidden from real users */}
            <input type="text" name="_hp" style={{ display: "none" }} tabIndex={-1} autoComplete="off" />

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1.5">Name</label>
                <input
                  value={form.name}
                  onChange={set("name")}
                  placeholder="Jane Smith"
                  className="w-full rounded-lg border border-white/[0.1] bg-white/[0.03] px-3 py-2.5 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1.5">Company</label>
                <input
                  value={form.company_name}
                  onChange={set("company_name")}
                  placeholder="Acme Ltd"
                  className="w-full rounded-lg border border-white/[0.1] bg-white/[0.03] px-3 py-2.5 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1.5">Email *</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={set("email")}
                  placeholder="jane@company.com"
                  className="w-full rounded-lg border border-white/[0.1] bg-white/[0.03] px-3 py-2.5 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-muted-foreground mb-1.5">Phone</label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={set("phone")}
                  placeholder="+44 7700 000000"
                  className="w-full rounded-lg border border-white/[0.1] bg-white/[0.03] px-3 py-2.5 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1.5">Website</label>
              <input
                type="url"
                value={form.website}
                onChange={set("website")}
                placeholder="https://yoursite.com"
                className="w-full rounded-lg border border-white/[0.1] bg-white/[0.03] px-3 py-2.5 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1.5">Interested in</label>
              <div className="relative">
                <select
                  value={form.interested_in}
                  onChange={set("interested_in")}
                  className="w-full appearance-none rounded-lg border border-white/[0.1] bg-[#0e0e16] px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-violet-500/50 pr-8"
                >
                  <option value="">Select a product…</option>
                  {INTERESTED_IN_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1.5">Message</label>
              <textarea
                value={form.message}
                onChange={set("message")}
                rows={3}
                placeholder="Tell us about your business and what you're looking to achieve…"
                className="w-full rounded-lg border border-white/[0.1] bg-white/[0.03] px-3 py-2.5 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-violet-500/50 resize-none"
              />
            </div>

            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1.5">Preferred contact method</label>
              <div className="flex gap-2">
                {CONTACT_METHOD_OPTIONS.map(opt => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, preferred_contact_method: opt }))}
                    className={cn(
                      "flex-1 rounded-lg border py-2 text-xs font-medium transition-all",
                      form.preferred_contact_method === opt
                        ? "border-violet-500/40 bg-violet-500/15 text-violet-300"
                        : "border-white/[0.1] text-muted-foreground hover:text-foreground hover:bg-white/[0.04]",
                    )}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-xs text-red-400">
                <X className="h-3.5 w-3.5 shrink-0" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || (!form.email && !form.phone)}
              className="w-full rounded-lg bg-violet-600 hover:bg-violet-700 py-3 text-sm font-semibold text-white transition-all disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitting ? "Sending…" : "Send message"}
            </button>

            <p className="text-[10px] text-center text-muted-foreground/40">
              Your data is handled securely. We'll never share it with third parties.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

/**
 * Hook to open the Talk to Us form from anywhere in the app.
 * Usage: const { open, TalkToUs } = useTalkToUs();
 */
export function useTalkToUs() {
  const [isOpen, setIsOpen] = useState(false);
  return {
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    TalkToUs: isOpen ? <TalkToUsForm onClose={() => setIsOpen(false)} /> : null,
  };
}
