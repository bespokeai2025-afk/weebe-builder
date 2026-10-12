/**
 * Accent switcher — a development tool, not part of the page.
 *
 * Renders only when `?accent` is in the URL, so it can never appear for a
 * visitor. It rewrites --story-gold / --story-gold-hi / --story-on-gold on the
 * .webee-story root, which is the whole point of having the palette as tokens:
 * every gold on the page follows from three custom properties.
 *
 * Judging a colour from a hex value does not work. Judging it on the real
 * page, against the real type and the real CTA, does.
 */

import { useEffect, useState } from "react";

interface Shade {
  id: string;
  gold: string;
  hi: string;
  ink: string;
  name: string;
  sat: number;
}

/* Every option below clears WCAG AA both as text on the page background and
   as the CTA label on the gold fill, so the choice is purely aesthetic.
   `sat` is HSL saturation — the single best predictor of how loud a gold
   reads at large sizes. */
export const SHADES: Shade[] = [
  { id: "current", gold: "#F5B800", hi: "#FFD94A", ink: "#06162b", name: "Previous gold", sat: 100 },
  { id: "butter",  gold: "#FFD166", hi: "#FFE4A3", ink: "#241a00", name: "Warm butter", sat: 100 },
  { id: "lemon",   gold: "#FFC940", hi: "#FFE08A", ink: "#241a00", name: "Lemon gold (current)", sat: 100 },
  { id: "brass",   gold: "#E8B33C", hi: "#F7D183", ink: "#1d1402", name: "Muted brass", sat: 79 },
  { id: "amber",   gold: "#EFAF3A", hi: "#FACE84", ink: "#1d1402", name: "Amber gold", sat: 85 },
  { id: "antique", gold: "#D9A441", hi: "#EFC888", ink: "#1a1203", name: "Antique brass", sat: 67 },
  { id: "old",     gold: "#C9A227", hi: "#E3C464", ink: "#17110a", name: "Old gold", sat: 68 },
  { id: "champ",   gold: "#E3C77E", hi: "#F2DFB4", ink: "#1e1708", name: "Champagne", sat: 64 },
  { id: "sand",    gold: "#D8C9A3", hi: "#EDE3C9", ink: "#1b1710", name: "Sand", sat: 40 },
];

export function AccentLab() {
  const [on, setOn] = useState(false);
  const [active, setActive] = useState("lemon");
  const [open, setOpen] = useState(true);

  useEffect(() => {
    setOn(new URLSearchParams(window.location.search).has("accent"));
  }, []);

  useEffect(() => {
    if (!on) return;
    const s = SHADES.find((x) => x.id === active);
    const root = document.querySelector(".webee-story") as HTMLElement | null;
    if (!s || !root) return;
    root.style.setProperty("--story-gold", s.gold);
    root.style.setProperty("--story-gold-hi", s.hi);
    root.style.setProperty("--story-on-gold", s.ink);
  }, [active, on]);

  if (!on) return null;
  const current = SHADES.find((x) => x.id === active)!;

  return (
    <div className="st-accentlab" data-open={open}>
      <button
        type="button"
        className="st-accentlab-toggle"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="st-accentlab-dot" style={{ background: current.gold }} />
        {open ? "Hide" : current.name}
      </button>

      {open && (
        <div className="st-accentlab-body">
          <div className="st-accentlab-grid">
            {SHADES.map((s) => (
              <button
                key={s.id}
                type="button"
                title={`${s.name} — ${s.gold} — ${s.sat}% saturation`}
                aria-label={s.name}
                aria-pressed={active === s.id}
                data-active={active === s.id}
                className="st-accentlab-swatch"
                style={{ background: s.gold }}
                onClick={() => setActive(s.id)}
              />
            ))}
          </div>
          <div className="st-accentlab-meta">
            <strong>{current.name}</strong>
            <code>{current.gold}</code>
            <span>{current.sat}% saturation</span>
          </div>
        </div>
      )}
    </div>
  );
}
