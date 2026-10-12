/**
 * Social proof.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * NOTHING IN HERE IS INVENTED, AND NOTHING INVENTED SHOULD BE ADDED.
 *
 * Testimonials, customer names and logos below are EMPTY placeholders, marked
 * so they are obviously unfinished if they ever reach production by accident.
 * They are deliberately not plausible-looking fake quotes: a fabricated
 * testimonial is a legal and reputational liability, and a visitor who
 * recognises one stops believing everything else on the page.
 *
 * TO FILL THIS IN, replace the arrays with real, permissioned content:
 *   - a real quote, with the person's real name, role and business
 *   - written permission to use it (an email is enough)
 *   - logos only where the customer has agreed to be named
 *
 * The STATS array is separate: those are product facts the business can verify
 * from its own call data. Replace the placeholder values with real figures
 * before launch, or delete the block. Do not guess them.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { Quote } from "lucide-react";

interface Testimonial {
  quote: string;
  name: string;
  role: string;
  company: string;
}

/** Replace with real, permissioned quotes. Empty array hides the section. */
export const TESTIMONIALS: Testimonial[] = [];

/** Replace with figures from your own call data. Empty array hides the band. */
export const STATS: { value: string; label: string }[] = [];

/** Customer names you have permission to display. Empty array hides the row. */
export const CUSTOMERS: string[] = [];

const PLACEHOLDERS: Testimonial[] = [
  {
    quote: "Replace with a real customer quote about missed calls or booked appointments.",
    name: "Customer name",
    role: "Role",
    company: "Business name",
  },
  {
    quote: "Replace with a second real quote — ideally from a different industry.",
    name: "Customer name",
    role: "Role",
    company: "Business name",
  },
];

export function SocialProof({ showPlaceholders = true }: { showPlaceholders?: boolean }) {
  const items = TESTIMONIALS.length ? TESTIMONIALS : showPlaceholders ? PLACEHOLDERS : [];
  const isPlaceholder = TESTIMONIALS.length === 0;

  if (!items.length && !STATS.length && !CUSTOMERS.length) return null;

  return (
    <section className="st-section" style={{ background: "var(--story-bg-raised)" }}>
      <div className="st-wrap">
        {STATS.length > 0 && (
          <div className="st-specs" style={{ marginBottom: 48 }}>
            {STATS.map((s) => (
              <div className="st-spec" key={s.label}>
                <div className="st-spec-value">{s.value}</div>
                <div className="st-spec-label">{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {items.length > 0 && (
          <>
            <div style={{ textAlign: "center", maxWidth: 560, margin: "0 auto 36px" }}>
              <div className="st-kicker">In their words</div>
              <h2>Businesses that stopped missing calls.</h2>
            </div>

            {isPlaceholder && (
              <p className="st-placeholder-warn" role="note">
                Placeholder content — replace with real, permissioned customer quotes before
                this page goes live.
              </p>
            )}

            <div className="st-quotes">
              {items.map((t, i) => (
                <figure className="st-quote" data-placeholder={isPlaceholder} key={i}>
                  <Quote size={18} aria-hidden="true" className="st-quote-mark" />
                  <blockquote>{t.quote}</blockquote>
                  <figcaption>
                    <strong>{t.name}</strong>
                    <span>
                      {t.role} · {t.company}
                    </span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </>
        )}

        {CUSTOMERS.length > 0 && (
          <div className="st-customers">
            <span className="st-customers-label">Trusted by</span>
            <div className="st-customers-row">
              {CUSTOMERS.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
