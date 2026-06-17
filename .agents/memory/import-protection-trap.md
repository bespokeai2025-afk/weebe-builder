---
name: Import-protection file pattern trap
description: Vite SSR import-protection plugin blocks any file whose path matches **/*.client.* — affects route filenames containing `.client.`.
---

## The Rule
This project has a Vite plugin (`import-protection`) that blocks imports matching `**/*.client.*` in the SSR/server environment.

## How It Bites You
If you name a TanStack route file with `.client.` anywhere in the path, e.g.:
- `admin.accounts.client.$id.tsx` → contains `.client.` → SSR crashes
- Error: `[import-protection] Import denied in server environment / Denied by file pattern: **/*.client.*`

The routeTree.gen.ts auto-imports all route files, so the crash happens at startup even if the route is never visited.

## Fix
Never use `.client.` as a segment in route filenames (or any file that gets auto-imported). Instead use:
- `admin.accounts.workspace.$id.tsx` ✓
- `admin.accounts.detail.$id.tsx` ✓
- `admin.accounts.profile.$id.tsx` ✓

**Why:** The pattern is designed to prevent client-only code (Supabase browser client, etc.) from leaking into SSR bundles. File naming collision is a silent trap.
