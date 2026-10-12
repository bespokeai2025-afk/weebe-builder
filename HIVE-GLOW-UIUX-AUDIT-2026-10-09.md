# UI/UX audit: `/hive-glow` landing page

**Date:** 9 October 2026
**Page:** `/hive-glow` (the backlit hex wall landing page; current lead direction)
**Method:** checks on the built page (heading structure, links, landmarks,
contrast ratios, page weight) plus a code review of `HiveGlow.tsx`,
`HexBacklight.tsx`, `GlowSections.tsx`, the reused `/v2` sections and
`story.css`. The visual judgements also draw on the owner's screenshots. The
page was not tested in a real browser by the auditor, so motion feel and 3D
quality need a human eye.

---

## Summary

The hero is the strongest thing on the page: dark, warm and cinematic, with
a clear headline and good contrast throughout. The problems are mostly
underneath it. There's **one real accessibility/SEO bug in the headline**,
**phone visitors lose the navigation**, and **three pieces of content can't
ship as they are** (invented stats, placeholder testimonials, robotic demo
voice). Below the hero the page is long, and the sections repeat each other.

| Severity | Count |
|---|---|
| 🔴 Must fix before launch | 5 |
| 🟠 Fix soon | 5 |
| 🟡 Polish | 4 |
| ✅ Working well | 7 |

---

## 🔴 Must fix before launch

### 1. The headline reads "No leadwill be missed."
The two animated headline lines are separate blocks with no space between
them in the markup. Visually it looks fine. But screen readers, Google and
anyone copying the text get **"No leadwill be missed."** — that's your main
SEO heading and the first thing a blind visitor hears.
**Fix:** add a space between the two lines. No visual change.
*(`HiveGlow.tsx`, the `st-line` spans)*

### 2. Phone visitors have no navigation
Below 760px wide the nav links (Product, How it works, Pricing, Resources)
are hidden, and nothing replaces them: no menu button. On a phone, the only
way to reach Pricing from the top of the page is to scroll to the footer.
**Fix:** add a menu button that opens the links, as `/v2` already has.

### 3. The outcome numbers are invented
"What that one call was worth" shows **"0 missed", "38s", "0 min"**. These
are placeholder figures written for layout, and "38s call to booked" reads
like a measured benchmark. A prospect who checks one and finds it isn't
real stops trusting the rest of the page.
**Fix:** replace them with figures from your own call data, or reword them
as plain claims without numbers.

### 4. The testimonial section shows placeholders
"In their words" currently renders dashed boxes with "Replace with a real
customer quote…" and an amber "Placeholder content" warning. That's
deliberate (no fake quotes), but it can't go live like that.
**Fix:** add two real, permissioned quotes, or hide the section until you
have them. It hides itself automatically when its lists are empty.

### 5. The demo call voice sounds robotic
Pressing *Test this agent* plays the browser's built-in speech voice. On a
page whose whole promise is a natural-sounding AI receptionist, a robotic
voice argues against the product.
**Fix:** record the 7 lines in your real agent voice and drop them into
`public/audio/demo/` (the file list is in the README there). Until then,
consider starting the demo with sound off.

---

## 🟠 Fix soon

### 6. "Watch Demo" doesn't lead to a video
The button promises a video, but it scrolls to the interactive builder.
Visitors expecting to sit back and watch will be confused.
**Fix:** rename it ("Try the demo") or add a short real video.

### 7. Broken link: "Resources"
The nav link goes to `#resources`, which doesn't exist on the page. Clicking
it does nothing.
**Fix:** point it at a real page (docs, blog) or remove it.

### 8. Three different labels for the same action
"Get Started" (nav), "Get Started" (hero) and "Start free" (final section)
all lead to the same sign-up. "Start free" is the clearer promise.
**Fix:** use one label everywhere. Keeping two gold buttons on the first
screen is a style choice; the inconsistent wording is the real issue.

### 9. Keyboard focus on nav links is barely visible
The hero buttons have a clear gold focus ring, but the nav links rely on
the browser's default outline, which is hard to see on a near-black
page. Keyboard users lose track of where they are.
**Fix:** give nav links the same gold focus ring as the buttons.

### 10. The page is long and repeats itself
Below the hero there are 10 sections, and three of them tell the same
story: *How it works* (answers → qualifies → ranks), *Give your agent
tools* (the builder demo) and *What that one call was worth*. Visitors
meet the same idea three times before reaching the callback form.
**Fix:** merge *How it works* into the builder section's intro, and move
the callback form higher.

---

## 🟡 Polish

### 11. The jump from hero to sections is abrupt
The hero is cinematic: 3D, warm light, motion. The first section below is
a plain grid of three cards. The fade at the bottom of the hero helps, but
the change in mood is still sharp.
**Fix (small):** carry a little of the hero's warm light into the top of
"How it works", for example a faint amber glow behind the cards.

### 12. No "skip to content" link
Keyboard users have to tab through the whole nav before reaching the page.
The nav is short, so this is minor, but `/v2` already has one.

### 13. The headline appears late
The headline slides up from behind a mask between about 0.4 and 1.6
seconds after load. It looks good, but it is also the page's main element
for loading speed (LCP), so the animation makes the page measure slower
than it really is.
**Fix (optional):** shorten the headline's delay, or start it already
partly visible.

### 14. "Your 10 hottest leads" is a specific promise
The hero subline promises a ranked top-10 list. Make sure the product
actually delivers that today (for example in Smart Dash). If it doesn't,
soften the wording.

---

## ✅ Working well

- **Contrast passes WCAG AA everywhere checked:** headline 19.2:1, subline
  and nav 6.2:1, small print 5.0:1, gold pill text 12.1:1, button label
  on gold 11.2:1.
- **The heading structure is clean:** one h1, then a logical h2/h3 outline
  for every section.
- **Landmarks are in place:** main, header, nav, footer.
- **All images have alt text.**
- **The page loads light:** 78 KB of HTML and 7 JavaScript files at first
  paint. The 3D library (884 KB) only downloads on desktop, after the page
  has appeared.
- **Reduced motion is fully handled:** visitors who ask for less motion see
  a static, warm version of the hero and every section, with nothing hidden.
- **The lead board's example rows are clearly labelled "Example data"**, so
  nothing on the page claims to be a real customer.

---

## Suggested order

1. The bugs that don't change the look: **#1 headline space, #7 broken
   link, #9 focus ring, #12 skip link**. About 15 minutes, no visual change.
2. **#2 mobile menu.**
3. Content you need to supply: **#3 real numbers, #4 real quotes, #5 real
   voice recordings.**
4. Structural decisions: **#6 demo label, #8 one CTA label, #10 shorter page.**
5. Polish: **#11, #13, #14.**
