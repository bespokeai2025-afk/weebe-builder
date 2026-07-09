import { useState } from "react";
import { X, Loader2, PhoneCall, ShieldCheck, CheckCircle2 } from "lucide-react";

interface CallAvaNowModalProps {
  onClose: () => void;
}

/**
 * "Call Ava Now" homepage flow:
 *  1. Visitor enters name, email + phone → OTP emailed (/api/public/ava-call/request)
 *  2. Visitor enters the 6-digit code → Ava calls them (/api/public/ava-call/verify)
 */
export function CallAvaNowModal({ onClose }: CallAvaNowModalProps) {
  const [step, setStep] = useState<"details" | "otp" | "calling">("details");
  const [form, setForm] = useState({ name: "", email: "", phone: "", website: "" });
  const [otp, setOtp] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(key: string) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }));
  }

  async function handleRequest(e: React.FormEvent) {
    e.preventDefault();
    if (!form.email || !form.phone) {
      setError("Please provide your email and phone number.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/public/ava-call/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      setRequestId(data.requestId);
      setStep("otp");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(otp.trim())) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/public/ava-call/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, otp: otp.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Verification failed. Please try again.");
        return;
      }
      setStep("calling");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls =
    "w-full rounded-lg border border-white/[0.1] bg-white/[0.03] px-3 py-2.5 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-amber-400/50";

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-md px-4">
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-white/[0.1] bg-[#0e0e16] shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-white/[0.07] bg-[#0e0e16]/95 px-6 py-4 backdrop-blur-sm z-10">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-amber-400/15 flex items-center justify-center">
              <PhoneCall className="h-4 w-4 text-amber-400" />
            </div>
            <div>
              <p className="font-semibold text-sm text-white">Call Ava now</p>
              <p className="text-[11px] text-muted-foreground">
                Ava, our AI agent, will phone you within seconds.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors p-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {step === "details" && (
          <form onSubmit={handleRequest} className="px-6 py-5 space-y-4">
            {/* Honeypot — hidden from real users */}
            <input type="text" name="_hp" style={{ display: "none" }} tabIndex={-1} autoComplete="off" />

            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1.5">Name</label>
              <input value={form.name} onChange={set("name")} placeholder="Jane Smith" className={inputCls} />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1.5">Email *</label>
              <input type="email" value={form.email} onChange={set("email")} placeholder="jane@company.com" className={inputCls} />
              <p className="mt-1 text-[10px] text-muted-foreground/60">
                We'll email you a 6-digit code to confirm it's really you.
              </p>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1.5">Phone (with country code) *</label>
              <input type="tel" value={form.phone} onChange={set("phone")} placeholder="+44 7700 000000" className={inputCls} />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-muted-foreground mb-1.5">Website (optional)</label>
              <input value={form.website} onChange={set("website")} placeholder="https://yoursite.com" className={inputCls} />
            </div>

            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-xs text-red-400">
                <X className="h-3.5 w-3.5 shrink-0" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !form.email || !form.phone}
              className="w-full rounded-lg bg-amber-400 hover:bg-amber-300 py-3 text-sm font-bold text-[#06162B] transition-all disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitting ? "Sending code…" : "Send my verification code"}
            </button>

            <p className="text-[10px] text-center text-muted-foreground/40 flex items-center justify-center gap-1.5">
              <ShieldCheck className="h-3 w-3" /> Verified requests only — your data is never shared.
            </p>
          </form>
        )}

        {step === "otp" && (
          <form onSubmit={handleVerify} className="px-6 py-6 space-y-4 text-center">
            <p className="text-sm text-muted-foreground">
              We've emailed a 6-digit code to{" "}
              <span className="text-white font-medium">{form.email}</span>. Enter it below and Ava
              will call <span className="text-white font-medium">{form.phone}</span> straight away.
            </p>
            <input
              inputMode="numeric"
              autoFocus
              maxLength={6}
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
              placeholder="••••••"
              className="w-44 mx-auto text-center tracking-[0.5em] text-xl font-bold rounded-lg border border-white/[0.15] bg-white/[0.03] px-3 py-3 focus:outline-none focus:ring-1 focus:ring-amber-400/60"
            />

            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-xs text-red-400 text-left">
                <X className="h-3.5 w-3.5 shrink-0" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || otp.length !== 6}
              className="w-full rounded-lg bg-amber-400 hover:bg-amber-300 py-3 text-sm font-bold text-[#06162B] transition-all disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitting ? "Starting your call…" : "Verify & call me now"}
            </button>
            <p className="text-[10px] text-muted-foreground/50">
              Code expires in 10 minutes. Wrong details?{" "}
              <button type="button" onClick={() => { setStep("details"); setOtp(""); setError(null); }} className="underline hover:text-foreground">
                Go back
              </button>
            </p>
          </form>
        )}

        {step === "calling" && (
          <div className="flex flex-col items-center justify-center py-14 px-6 text-center">
            <div className="h-14 w-14 rounded-full bg-emerald-500/15 flex items-center justify-center mb-4">
              <CheckCircle2 className="h-7 w-7 text-emerald-400" />
            </div>
            <p className="text-lg font-semibold mb-2 text-white">Ava is calling you now!</p>
            <p className="text-sm text-muted-foreground max-w-xs">
              Keep your phone handy — the call from Ava should arrive within a few seconds. She can
              answer questions and book you a demo appointment on the spot.
            </p>
            <button
              onClick={onClose}
              className="mt-6 rounded-lg bg-amber-400 hover:bg-amber-300 px-6 py-2.5 text-sm font-bold text-[#06162B] transition-all"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Hook to open the Call Ava Now modal from anywhere on the landing page.
 * Usage: const { open, CallAvaNow } = useCallAvaNow();
 */
export function useCallAvaNow() {
  const [isOpen, setIsOpen] = useState(false);
  return {
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    CallAvaNow: isOpen ? <CallAvaNowModal onClose={() => setIsOpen(false)} /> : null,
  };
}
