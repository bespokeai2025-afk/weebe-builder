---
name: AccountsMind invoice generator
description: Invoice generation in AccountsMind (DOCX templates + built-in PDF) — templating approach, storage, and concurrency rules.
---

- Two output formats: DOCX fills an admin-uploaded .docx template with docxtemplater + pizzip; PDF uses a built-in pdf-lib A4 layout (no template needed). DOCX→PDF conversion is still impossible on this platform (no Puppeteer/LibreOffice on NixOS) — PDF is drawn directly, not converted.
- PDF renderer uses Helvetica (WinAnsi): non-ASCII beyond £/€ is stripped — international names/notes need a Unicode font embed if that ever matters.
- **Rule:** invoice numbers (INV-YYYY-NNNN) are reserved by inserting the DB row FIRST and retrying on unique-violation 23505; the generated file is uploaded afterwards to a per-row-id storage path with NO upsert. Never compute-number-then-upload — a race overwrites another invoice's file.
- **Why:** architect review failed the first version for exactly this read-then-increment + `upsert:true` race.
- Rows with `storage_path = 'pending'` are in-flight reservations: hidden from lists, blocked from download, deleted on any generation failure.
- Templates/invoices live in private bucket `accountsmind-invoices`; downloads only via short-TTL signed URLs from platform-admin-gated server fns. Tables are server-write-only (RLS on, zero policies, REVOKE anon/authenticated).
