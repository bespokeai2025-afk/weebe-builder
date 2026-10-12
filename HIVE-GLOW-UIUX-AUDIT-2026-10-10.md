# /hive-glow UI/UX audit — 2026-10-10

Second audit of the redesigned landing page. It follows the 2026-10-09 audit (`HIVE-GLOW-UIUX-AUDIT-2026-10-09.md`) and covers the round since then:
- Fraunces and Plus Jakarta Sans type
- Gold pass and the cursor light
- Smooth scrolling and hidden scrollbars
- Larger hero on wide screens
- Natural voices with phone-call feel in the demo

**Method**
- **Pages tested:** the production build, served locally and rendered in headless Chrome at 1440 px (desktop), 1863 px (large screen) and 390 px (phone).
- **Screenshots:** full-page and per-section.
- **Automated checks:** horizontal overflow, heading order, link targets, tap-target sizes, text under 12 px, images without alt text, buttons without names.
- **Not covered:** the 3D wall looks dimmer in headless Chrome than on a real GPU, so it's judged from the owner's screenshots. I can't hear audio, so the demo's sound is not assessed here.

---

## Summary

The page now looks premium and coherent. The hero, the lead board, the demo window and the callback form are strong, and the gold theme holds together from top to bottom. The audit-1 fixes held: skip link, focus rings, one CTA label, mobile menu, no broken anchors and no overflow.

What still holds it back is mostly **content and mobile flow**, not visuals:
- Several claims are presented as fact that nobody has confirmed. SOC 2 is the risky one.
- On phones, the demo's call plays below the fold.
- A handful of small layout inconsistencies make some sections feel less finished than the hero.

| Area | Grade | Note |
|---|---|---|
| Visual design and brand | A− | Distinctive and consistent. The demo window's navy is the one cold patch |
| Typography | A− | Strong pairing. Some headings leave one word on a line on its own; some text is 10.5–11 px |
| Layout and spacing | B+ | Hero, leads, demo and form are good. "Yours" and use-case sections are thin |
| Interaction and motion | A− | Restrained and purposeful. Mobile demo flow is the gap |
| Content and trust | C+ | Unconfirmed claims, made-up stats, no real social proof yet |
| Accessibility basics | A− | Passes the structural checks. Small tap targets on mobile |
| Conversion path | B | One clear CTA, but it goes to `/login` not `/signup` |

---

## 🔴 Fix before launch

### 1. On phones, the demo call plays off-screen
At 390 px the Conversation and "What the agent did" panels sit **below** the "Test this agent" button. A visitor taps Test and hears the call, but the transcript, word-by-word reveal and results are all out of sight. The demo is the page's best moment, and on mobile it's half invisible.
**Fix:** when the call starts on narrow screens, scroll the Conversation panel into view, using smooth scroll. Or on mobile, move the Conversation panel directly under the Test button and above the ledger.

### 2. Claims that need your confirmation before they ship
They read as facts, and some carry legal risk if untrue:
- **"UK data residency, GDPR-ready, SOC 2 controls"** ("Yours" section). Claiming SOC 2 without an audit report is a real liability. Keep only what you can evidence.
- **"No card required · Cancel any time"** (final CTA): is there a free start with no card?
- **"Set up your first agent in under an hour"** and **"Most businesses are live within the hour once they decide."**
- **Outcome stats "0 missed / 38s / 0 min"** (carried over from audit 1, item 3): these are illustrative, not measured. Label them "from the demo call above", or replace them with real figures.

### 3. Callback form: "Email or" is confusing
The email label reads **"Email or"**, which only makes sense if you notice it pairs with "Phone number" on the left. Name and Business have no placeholders while Phone and Email do, and nothing shows what's required.
**Fix:**
- Label the pair "Phone **or** email (we need one)", or put that hint under both fields.
- Use consistent placeholders.
- Mark required fields.

---

## 🟠 Fix soon

### 4. The demo window is the only cold block on the page
The Builder canvas is navy (`#0c1424`) with blue grid lines, inside an all-warm black and gold page. It mirrors the real Builder, which is a fair reason, but it reads as pasted in.
**Option (your call):** keep the app layout, but warm the canvas slightly towards charcoal and tint the grid to gold. That still looks like the product without breaking the palette.

### 5. Section headings leave one word on a line on its own
- "From ringing phone to ranked / **lead.**"
- "Give your agent tools. Watch it / **work.**"

The hero lede already balances its lines; the section `h2`s don't.
**Fix:** `text-wrap: balance` on section headings.

### 6. Final CTA: the shield icon is misaligned
The shield sits at the left edge of the text block while the heading and button are centred. It looks like a stray element.
**Fix:** centre it, or remove it.

### 7. "Yours, not a bot in a box" feels thin and off-palette
- Two columns float with a lot of empty space and no visual anchor.
- The check icons are **green**, the only green on the page apart from the "Booked" badge, where green means a status.

**Fix:**
- Use gold checks.
- Give the section a visual, for example a small "your number / your voice / your script" card stack.
- Or merge it into the How-it-works or trust area.

### 8. Use-case cards are inconsistent with the rest of the page
- No icons, while the How-it-works cards have them.
- "Trades & home services" wraps to two lines, so its body text starts lower than its neighbours'.
- No links, so the cards are a dead end.

**Fix:**
- Add matching icon tiles.
- Reserve two lines for titles so body text aligns.
- Make each card open the demo with that industry. That's Pass B, the industry picker.

### 9. Small text
The automated check found text at **10.5–11 px**:
- Node type labels and node descriptions in the demo, and "+14 more node types"
- The "Example data" tag and lead badges
- The "Sound on" pill on mobile

Eyebrow labels at 11 px uppercase with letter-spacing are acceptable. **Descriptive** text below 12 px is hard to read, especially on phones.
**Fix:** raise descriptive text to 12–13 px.

### 10. Small tap targets on phones
| Control | Size | Target |
|---|---|---|
| Node "remove" (×) buttons | 22×22 px | about 40–44 px |
| "Sound on" | 30 px tall | about 40–44 px |
| Footer links | 20 px tall | about 40–44 px |
| Palette items | 36 px tall | about 40–44 px |

**Fix:** enlarge the tappable area. Padding or an invisible hit area is enough; the visual size can stay.

### 11. Mobile hero: the pill wraps and there's empty space below the CTAs
"AI RECEPTIONIST PLATFORM" breaks onto two lines at 390 px, and there's a tall empty band under the buttons.
**Fix:**
- Smaller letter-spacing on mobile, or shorter pill copy ("AI receptionist").
- Reduce the mobile hero's minimum height so the next section peeks in, which invites scrolling.

### 12. "Get Started" goes to `/login`, and the final CTA goes somewhere different
- Nav and hero "Get Started" link to `/login`.
- The final CTA links to `/login?redirect=/dashboard`.

A `/signup` route exists. New visitors clicking "Get Started" expect to create an account, not log in.
**Fix:** point all three to `/signup`. Keep "Log in" as a small separate nav link.

---

## 🟡 Polish

13. **Inter still downloads (about 48 KB) on this page** even though nothing uses it. It comes from the global `@font-face` in `src/styles.css` and the root preload. Skip the preload on `/hive-glow`.
14. **Footer is minimal:** © and three links. Add the logo, product links, contact address or email, and socials once they exist.
15. **Step numbers (01 / 02 / 03) are low contrast.** Either make them a deliberate gold accent, or drop them. The steps already read in order.
16. **Demo canvas:** the zoom controls touch the bottom of the "Qualify Lead" card. Nudge them down or left.
17. **Palette header says "Node".** Change it to "Nodes", or better "Add a step".
18. **"Smart Dash shows you a month of them"** mentions a product the page never shows. This is planned for Pass C (the transition into Smart Dash). Until then, link it or cut the line.

---

## ✅ Working well (keep)

- **Hero:** strong focal point, big confident Fraunces headline with the gold italic, and it now scales properly on large screens.
- **Lead board:** the clearest product proof on the page. "Example data" is honestly labelled.
- **Demo:** looks like the real Builder. The SystemMind "Build" moment, ring and pick-up, phone-line caller voice, word-by-word transcript and live bars make it feel like a real call.
- **Callback form:** clean, well-spaced, with a clear privacy line under the button.
- **Motion:**
  - The cursor light is now subtle.
  - Smooth scroll, and sections fade in on scroll.
  - Startup no longer flashes a still image.
  - Every animated element has a reduced-motion path.
- **Accessibility basics:** skip link, visible focus rings, no images without alt text, no unnamed buttons, logical heading order (one h1, then h2/h3), and no horizontal overflow at any width.
- **One primary CTA label** ("Get Started") everywhere.

---

## Suggested order

1. **#1, mobile demo scroll.** Code only, small.
2. **#3, #5, #6, #9, #10, #11, #12.** Quick layout and copy fixes, can go in one pass.
3. **#2.** Needs your answers on what's true: SOC 2, card or trial, setup time, stats.
4. **#4, #7, #8.** Design decisions. #8 leads naturally into Pass B, the industry picker.
5. **🟡 polish.**
