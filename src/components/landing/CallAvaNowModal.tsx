import { useState, useEffect, useRef } from "react";
import { X, Loader2, PhoneCall, ShieldCheck, CalendarDays } from "lucide-react";
import { TalkToUsForm } from "@/components/landing/TalkToUsForm";
import { AvaLiveOrb, type AvaLiveOrbState } from "@/components/landing/AvaLiveOrb";

interface CallAvaNowModalProps {
  onClose: () => void;
}

type OtpChannel = "twilio_verify" | "sms" | "email" | "dev";

/** Where the verification code was delivered, in user words. */
function channelCopy(channel: OtpChannel | null, fallback: boolean): { where: string; note: string | null } {
  if (channel === "twilio_verify" || channel === "sms") {
    return { where: "phone", note: null };
  }
  return {
    where: "email",
    note: fallback ? "We couldn't reach your phone by SMS, so we emailed your code instead." : null,
  };
}

/**
 * "Call Ava Now" homepage flow:
 *  1. Visitor enters name, email + phone (+ consent) → OTP sent by SMS or email
 *     (/api/public/ava-call/request)
 *  2. Visitor enters the 6-digit code → Ava calls them (/api/public/ava-call/verify)
 */
export function CallAvaNowModal({ onClose }: CallAvaNowModalProps) {
  const [step, setStep] = useState<"details" | "otp" | "calling">("details");
  const [form, setForm] = useState({ name: "", email: "", phone: "", website: "" });
  const [consent, setConsent] = useState(false);
  const [otp, setOtp] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [channel, setChannel] = useState<OtpChannel | null>(null);
  const [channelFallback, setChannelFallback] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showBookDemo, setShowBookDemo] = useState(false);
  const [showTalkToUs, setShowTalkToUs] = useState(false);
  const [liveState, setLiveState] = useState<AvaLiveOrbState>("connecting");

  // Simulate a convincing live-call cadence. The actual call is placed over the
  // phone (PSTN via Retell), so there is no in-browser speaking/listening
  // signal — we drive a plausible connecting → speaking ⇄ listening cycle.
  useEffect(() => {
    if (step !== "calling") return;
    setLiveState("connecting");
    const t = setTimeout(() => setLiveState("speaking"), 2400);
    return () => clearTimeout(t);
  }, [step]);

  useEffect(() => {
    if (step !== "calling" || liveState === "connecting" || liveState === "ended") return;
    const dur = liveState === "speaking" ? 3800 : 3000;
    const t = setTimeout(
      () => setLiveState((s) => (s === "speaking" ? "listening" : "speaking")),
      dur,
    );
    return () => clearTimeout(t);
  }, [step, liveState]);

  const endCallTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (endCallTimer.current) clearTimeout(endCallTimer.current);
  }, []);

  function endCall() {
    setLiveState("ended");
    // Let the orb's 0.5s fade-down finish before unmounting the modal.
    endCallTimer.current = setTimeout(onClose, 520);
  }

  if (showTalkToUs) {
    return <TalkToUsForm onClose={onClose} sourcePage="call-ava-now" />;
  }

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
    if (!consent) {
      setError("Please confirm you agree to receive a call from Ava.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setShowBookDemo(false);
    try {
      const res = await fetch("/api/public/ava-call/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, consent }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        if (data.code === "no_provider") setShowBookDemo(true);
        return;
      }
      setRequestId(data.requestId);
      setChannel((data.channel as OtpChannel) ?? "email");
      setChannelFallback(Boolean(data.fallback));
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
      setError(`Enter the 6-digit code from your ${channelCopy(channel, channelFallback).where}.`);
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
                We'll send you a 6-digit code to confirm it's really you.
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

            <label className="flex items-start gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5 h-3.5 w-3.5 rounded border-white/[0.2] bg-white/[0.03] accent-amber-400"
              />
              <span className="text-[11px] leading-relaxed text-muted-foreground">
                I agree to receive a one-off verification code and a phone call from Ava, WEBEE's AI
                agent, at the number above. *
              </span>
            </label>

            {error && (
              <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-xs text-red-400">
                <X className="h-3.5 w-3.5 shrink-0" />
                {error}
              </div>
            )}

            {showBookDemo && (
              <button
                type="button"
                onClick={() => setShowTalkToUs(true)}
                className="w-full rounded-lg border border-amber-400/40 bg-amber-400/10 hover:bg-amber-400/20 py-3 text-sm font-bold text-amber-300 transition-all flex items-center justify-center gap-2"
              >
                <CalendarDays className="h-4 w-4" /> Book a Demo instead
              </button>
            )}

            <button
              type="submit"
              disabled={submitting || !form.email || !form.phone || !consent}
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
              We've sent a 6-digit code to{" "}
              <span className="text-white font-medium">
                {channelCopy(channel, channelFallback).where === "phone" ? form.phone : form.email}
              </span>
              . Enter it below and Ava will call{" "}
              <span className="text-white font-medium">{form.phone}</span> straight away.
            </p>
            {channelCopy(channel, channelFallback).note && (
              <p className="text-[11px] text-amber-300/80">{channelCopy(channel, channelFallback).note}</p>
            )}
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
          <div
            className="flex flex-col items-center justify-center px-6 py-9 text-center"
            style={{ background: "radial-gradient(circle at 50% 36%, rgba(30,64,120,0.18), transparent 62%)" }}
          >
            {/* live status row */}
            <div className="flex items-center gap-2 mb-7">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[10.5px] font-semibold text-emerald-300">
                <ShieldCheck className="h-3 w-3" /> Verified
              </span>
              {liveState === "connecting" ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 py-1 text-[10.5px] font-semibold text-amber-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" /> Connecting
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-400/30 bg-sky-400/10 px-2.5 py-1 text-[10.5px] font-semibold text-sky-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-sky-400 animate-pulse" /> Live
                </span>
              )}
            </div>

            <AvaLiveOrb state={liveState} size="lg" />

            <p className="mt-7 text-lg font-semibold text-white">
              {liveState === "connecting"
                ? "Connecting you to Ava…"
                : liveState === "ended"
                  ? "Call ended"
                  : liveState === "listening"
                    ? "Ava is listening…"
                    : "Ava is speaking…"}
            </p>
            <p className="mt-1.5 text-xs text-muted-foreground max-w-xs">
              Keep your phone handy — Ava is calling{" "}
              <span className="text-white/90 font-medium">{form.phone}</span>. She can answer questions
              and book you a demo on the spot.
            </p>

            <button
              onClick={endCall}
              className="mt-7 inline-flex items-center gap-2 rounded-full border border-red-500/40 bg-red-500/10 hover:bg-red-500/20 px-6 py-2.5 text-sm font-bold text-red-300 transition-all"
            >
              <X className="h-4 w-4" /> End call
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
