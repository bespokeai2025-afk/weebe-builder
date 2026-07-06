---
name: Full-height page layout trap (h-full → auto)
description: Why a page root of `h-full` silently fails to bound its scroll areas inside the shadcn min-h-screen sidebar layout, and the fix.
---

# Full-height page layout trap (h-full → auto)

For any full-viewport page (kanban board, chat, split panes) whose root is
`flex flex-col h-full`, internal `overflow-*-auto` / `flex-1` scroll regions will
NOT engage — the page just grows to content and the whole app scrolls instead.

**Why:** the app's `_authenticated` chain gives no ancestor a *definite* height:
outer wrapper is `min-h-screen`, `SidebarProvider` inner is `min-h-svh`, and
`SidebarInset` is `flex-1 flex-col` with no explicit height. A `min-height` is not a
definite height for percentage resolution, so a child's `h-full` (height:100%)
resolves to `auto`. Every descendant then sizes to content: `flex-1` regions don't
cap, `overflow-y-auto` never activates, and a horizontal scrollbar on a tall board
renders at the bottom of the (very tall) content — below the fold, unreachable.
Diagnostic tell: the presence of the "scrollbar pushed off-screen" bug is itself
proof the container was never bounded (a bounded container would have pinned it).

**How to apply:**
- Bound height at the PAGE ROOT, not the shared layout: use a definite viewport
  value, e.g. `h-[calc(100dvh-3rem)]` where `3rem` = the `_authenticated` sticky
  `h-12` app header (shown on every route except `/builder`, where `hideHeader` is
  true → use full `100dvh` there). Default sidebar variant adds no margin; only the
  `inset` variant adds `m-2` (not used here), so no extra offset needed.
- Do NOT switch the shared `_authenticated`/`SidebarInset` chain to
  `h-screen overflow-hidden` — that changes every page.
- Once the root is definite, standard patterns work: board container
  `flex-1 overflow-x-auto overflow-y-hidden`, each column `h-full min-h-0`, cards
  area `flex-1 min-h-0 overflow-y-auto`. `min-h-0` is required so flex children can
  shrink below content and let their own scroll take over.
