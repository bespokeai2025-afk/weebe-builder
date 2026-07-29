---
name: TanStack file-route nesting needs Outlet
description: Dotted child route files silently render nothing if the parent page has no <Outlet/>; un-nest with the trailing-underscore filename convention.
---

**Rule:** In TanStack Router file-based routing, `foo.bar.tsx` + `foo.bar.$id.tsx` makes `$id` a CHILD of the `foo.bar` route. Navigating to the child URL changes the address but renders only the parent unless the parent component renders `<Outlet/>`. Symptom: a `<Link>` "does nothing" while the URL updates.

**Why:** Work Orders "Details" button (list → detail) was broken this way — link, route file, server fn all correct; the detail simply had nowhere to render.

**How to apply:** For a full-page detail that should replace the list, un-nest by renaming the file with a trailing underscore on the parent segment (e.g. `foo.bar_.$id.tsx`). The vite route plugin auto-rewrites the `createFileRoute()` id and regenerates `routeTree.gen.ts`; the public URL (`/foo/bar/$id`) and existing `<Link to>` stay unchanged. Only nest (keep dotted name) when the parent deliberately renders `<Outlet/>`.
