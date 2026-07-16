---
name: AccountsMind invoice generator
description: DOCX-template invoice generation in AccountsMind — templating approach, storage, and concurrency rules.
---

- Invoice generation fills an admin-uploaded .docx template with docxtemplater + pizzip (both installed for this feature); there is no server-side PDF path on this platform (Puppeteer fails on NixOS) — output stays DOCX, users print to PDF from Word.
- **Rule:** invoice numbers (INV-YYYY-NNNN) are reserved by inserting the DB row FIRST and retrying on unique-violation 23505; the generated file is uploaded afterwards to a per-row-id storage path with NO upsert. Never compute-number-then-upload — a race overwrites another invoice's file.
- **Why:** architect review failed the first version for exactly this read-then-increment + `upsert:true` race.
- Rows with `storage_path = 'pending'` are in-flight reservations: hidden from lists, blocked from download, deleted on any generation failure.
- Templates/invoices live in private bucket `accountsmind-invoices`; downloads only via short-TTL signed URLs from platform-admin-gated server fns. Tables are server-write-only (RLS on, zero policies, REVOKE anon/authenticated).
