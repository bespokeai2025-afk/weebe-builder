---
name: Shared PDF overlay engine
description: One PDF overlay renderer + designer serves both AccountsMind invoices and Hexmail Template Studio documents
---

The PDF overlay engine lives in shared locations, not per-feature:
- Renderer: `src/lib/documents/pdf-overlay.server.ts` (renderPdfOverlay/inspectPdfBackground, %-coords from top-left).
- Designer UI: `src/components/documents/PdfOverlayDesigner.tsx` (host-agnostic props: loadPdfUrl, availableFields, initialFields, onSave).

**Why:** avoid divergence — invoice templates and Template Studio documents must render identically; any new "fill fields onto an uploaded PDF" feature should wrap these, never fork them.

**How to apply:**
- Invoices: thin wrapper `PdfOverlayEditor` with a fixed field catalog; layout persisted in invoice template `fields_json`.
- Hexmail: layout persisted as `_pdfOverlay` key inside the content vars JSON (excluded from vars map, like `_header`); fields come from detected `{{vars}}`; render via `renderHexmailTemplatePdf`.
- SSRF rule: never `fetch()` a stored template URL server-side. Parse the storage path out of the public URL (`/storage/v1/object/public/<bucket>/…`), require the `<workspaceId>/` prefix, and download via `supabaseAdmin.storage.download()`.
