/**
 * Lead capture.
 *
 * ISOLATION: posts to the existing public endpoint with plain `fetch`. That is
 * a runtime HTTP call, not a module import, so the story module graph stays
 * clean — no server functions, no Supabase, nothing from @/lib.
 *
 * The endpoint (src/routes/api/public/contact.ts) is already production-ready:
 * no auth, rate-limited to 5/min per IP, honeypot-checked, and it creates a
 * real lead in the admin workspace plus an email to admin@webespokeai.com.
 * It requires email OR phone, which is why validation below accepts either.
 *
 * WHY A CALLBACK RATHER THAN "REQUEST A DEMO": the product answers phones. The
 * lowest-friction, most on-brand conversion is a phone number and a promise to
 * ring back. It is one field, and it demonstrates the thing being sold.
 */

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Loader2, Phone } from "lucide-react";

const INTEREST = [
  "WEBEE Receptionist",
  "WEBEE Lead Generation",
  "WEBEE Client Qualification",
  "Custom AI Agent",
  "Full Platform Demo",
  "Pricing & Plans",
] as const;

type Status = "idle" | "sending" | "done" | "error";

/** Attribution captured once on mount — lost otherwise, and it is what tells
 *  you which campaign actually produced the lead. */
function useAttribution() {
  const ref = useRef<Record<string, string>>({});
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const pick = (k: string) => q.get(k) ?? "";
    ref.current = {
      source_page: window.location.pathname,
      landing_url: window.location.href,
      referrer: document.referrer || "",
      utm_source: pick("utm_source"),
      utm_medium: pick("utm_medium"),
      utm_campaign: pick("utm_campaign"),
      keyword: pick("keyword"),
      gclid: pick("gclid"),
      gbraid: pick("gbraid"),
      wbraid: pick("wbraid"),
    };
  }, []);
  return ref;
}

export function LeadForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    phone: "",
    email: "",
    company_name: "",
    interested_in: "WEBEE Receptionist",
    website_url: "", // honeypot — real people never fill a hidden field
  });
  const attribution = useAttribution();

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "sending") return;

    if (!form.phone.trim() && !form.email.trim()) {
      setError("Add a phone number or an email so we can reach you.");
      return;
    }

    setStatus("sending");
    setError(null);
    try {
      const res = await fetch("/api/public/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          ...attribution.current,
          preferred_contact_method: form.phone.trim() ? "Phone" : "Email",
          message: "Callback requested from the landing page.",
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          res.status === 429
            ? "Too many requests just now. Try again in a minute."
            : (body?.error ?? "Something went wrong."),
        );
      }
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  if (status === "done") {
    return (
      <div className="st-lead st-lead--done" role="status">
        <span className="st-lead-tick" aria-hidden="true">
          <Check size={20} />
        </span>
        <h3>We&rsquo;ll call you back.</h3>
        <p>
          Someone will ring {form.phone.trim() ? form.phone.trim() : "you"} shortly. If you
          would rather not wait, you can set an agent up yourself in under an hour.
        </p>
      </div>
    );
  }

  return (
    <form className="st-lead" onSubmit={submit} noValidate>
      <div className="st-lead-head">
        <Phone size={15} aria-hidden="true" />
        <span>Hear it for yourself</span>
      </div>
      <h3>Get a callback.</h3>
      <p className="st-lead-sub">
        Leave a number and we&rsquo;ll ring you back to walk through what an agent would do for
        your business. No obligation, no card.
      </p>

      <div className="st-field-row">
        <div className="st-field">
          <label htmlFor="lead-name">
            Your name <span className="st-opt">(optional)</span>
          </label>
          <input
            id="lead-name"
            name="name"
            value={form.name}
            onChange={set("name")}
            autoComplete="name"
            placeholder="Sam Taylor"
          />
        </div>
        <div className="st-field">
          <label htmlFor="lead-company">
            Business <span className="st-opt">(optional)</span>
          </label>
          <input
            id="lead-company"
            name="company_name"
            value={form.company_name}
            onChange={set("company_name")}
            autoComplete="organization"
            placeholder="Harborview Dental"
          />
        </div>
      </div>

      {/* Phone and email are one requirement: at least one of the two. A
          fieldset + legend says that once, for both fields, instead of a
          dangling "or" on one label. */}
      <fieldset className="st-fieldset" aria-describedby="lead-reach-hint">
        <legend>
          How should we reach you? <span className="st-req" aria-hidden="true">*</span>
        </legend>
        <p className="st-field-hint" id="lead-reach-hint">
          Phone or email, we need at least one.
        </p>
      <div className="st-field-row">
        <div className="st-field">
          <label htmlFor="lead-phone">Phone</label>
          <input
            id="lead-phone"
            name="phone"
            type="tel"
            inputMode="tel"
            value={form.phone}
            onChange={set("phone")}
            autoComplete="tel"
            placeholder="07700 900123"
          />
        </div>
        <div className="st-field">
          <label htmlFor="lead-email">Email</label>
          <input
            id="lead-email"
            name="email"
            type="email"
            value={form.email}
            onChange={set("email")}
            autoComplete="email"
            placeholder="you@business.co.uk"
          />
        </div>
      </div>
      </fieldset>

      <div className="st-field">
        <label htmlFor="lead-interest">What do you need it for?</label>
        <select id="lead-interest" name="interested_in" value={form.interested_in} onChange={set("interested_in")}>
          {INTEREST.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
      </div>

      {/* Honeypot. Hidden from people, irresistible to bots. */}
      <div className="st-hp" aria-hidden="true">
        <label htmlFor="website_url">Website</label>
        <input
          id="website_url"
          name="website_url"
          tabIndex={-1}
          autoComplete="off"
          value={form.website_url}
          onChange={set("website_url")}
        />
      </div>

      {error && (
        <p className="st-lead-err" role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="st-btn st-btn--primary st-lead-submit" disabled={status === "sending"}>
        {status === "sending" ? (
          <>
            <Loader2 size={16} className="st-spin" aria-hidden="true" /> Sending…
          </>
        ) : (
          <>
            Call me back <ArrowRight size={16} aria-hidden="true" />
          </>
        )}
      </button>

      <p className="st-lead-fine">
        We use your details only to contact you about WEBEE. No lists, no sharing.
      </p>
    </form>
  );
}
