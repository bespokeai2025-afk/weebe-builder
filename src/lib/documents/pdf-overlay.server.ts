/**
 * PDF-overlay template renderer.
 *
 * A pdf_overlay template = an uploaded PDF used as the visual background,
 * plus positioned dynamic fields (fields_json) drawn over it with pdf-lib.
 * The PDF itself is never edited as flowing text.
 *
 * Field coordinates are stored as percentages of the page (x/y from the
 * top-left corner) so the editor canvas and the render stay in sync at any
 * zoom level.
 */
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export type OverlayField = {
  tag: string;            // payload key, e.g. "invoice_number", or the pseudo-field "items_table"
  page: number;           // 0-based page index
  xPct: number;           // 0-100, left edge of the field box
  yPct: number;           // 0-100, top edge of the field box (from page top)
  widthPct: number;       // 0-100 box width
  fontSize: number;
  bold: boolean;
  align: "left" | "center" | "right";
  lineSpacing: number;    // multiplier, e.g. 1.2
  color?: string;         // hex like "#111827"
};

function parseColor(hex: string | undefined) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!m) return rgb(0.07, 0.09, 0.15);
  const n = parseInt(m[1], 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function drawTextBox(
  page: PDFPage,
  font: PDFFont,
  text: string,
  f: OverlayField,
  opts: { pageW: number; pageH: number },
) {
  const boxX = (f.xPct / 100) * opts.pageW;
  const boxW = Math.max(20, (f.widthPct / 100) * opts.pageW);
  const topY = opts.pageH - (f.yPct / 100) * opts.pageH;
  const size = Math.max(5, Math.min(48, f.fontSize || 10));
  const lineH = size * (f.lineSpacing || 1.2);
  const color = parseColor(f.color);

  // Wrap each source line to the box width.
  const outLines: string[] = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    let line = "";
    for (const word of raw.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= boxW || !line) line = candidate;
      else { outLines.push(line); line = word; }
    }
    outLines.push(line);
  }

  let y = topY - size; // first baseline
  for (const line of outLines) {
    const w = font.widthOfTextAtSize(line, size);
    let x = boxX;
    if (f.align === "center") x = boxX + (boxW - w) / 2;
    if (f.align === "right") x = boxX + boxW - w;
    page.drawText(line, { x, y, size, font, color });
    y -= lineH;
    if (y < 0) break;
  }
  return topY - y - size; // consumed height (unused by callers today, useful for items)
}

/** Render payload values over the background PDF. Throws on unreadable PDF. */
export async function renderPdfOverlay(
  backgroundPdf: Buffer | Uint8Array,
  fields: OverlayField[],
  payload: Record<string, any>,
): Promise<Buffer> {
  const doc = await PDFDocument.load(backgroundPdf);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();

  for (const f of fields) {
    const page = pages[Math.min(Math.max(0, f.page | 0), pages.length - 1)];
    const { width: pageW, height: pageH } = page.getSize();
    const font = f.bold ? boldFont : regular;

    if (f.tag === "items_table") {
      const items: any[] = Array.isArray(payload.items) ? payload.items : [];
      const size = Math.max(5, Math.min(48, f.fontSize || 10));
      const lineH = size * (f.lineSpacing || 1.4);
      const boxX = (f.xPct / 100) * pageW;
      const boxW = Math.max(60, (f.widthPct / 100) * pageW);
      let y = pageH - (f.yPct / 100) * pageH - size;
      const color = parseColor(f.color);
      for (const it of items) {
        if (y < 0) break;
        const qty = `${it.quantity}${it.unit ? ` ${it.unit}` : ""} × ${it.unit_price}`;
        const amount = String(it.amount ?? "");
        const amountW = font.widthOfTextAtSize(amount, size);
        // Truncate description so it never collides with the amount column.
        let desc = String(it.description ?? "");
        const maxDescW = boxW - amountW - 12;
        while (desc && font.widthOfTextAtSize(desc, size) > maxDescW) desc = desc.slice(0, -1);
        page.drawText(desc, { x: boxX, y, size, font, color });
        page.drawText(amount, { x: boxX + boxW - amountW, y, size, font, color });
        y -= lineH * 0.85;
        if (y < 0) break;
        const qtyColor = rgb(0.45, 0.5, 0.58);
        page.drawText(qty, { x: boxX, y, size: size * 0.85, font: regular, color: qtyColor });
        y -= lineH;
      }
      continue;
    }

    const value = payload[f.tag];
    if (value == null || value === "") continue;
    drawTextBox(page, font, String(value), f, { pageW, pageH });
  }

  return Buffer.from(await doc.save());
}

/** Validate an uploaded PDF background and report its page count. */
export async function inspectPdfBackground(buf: Buffer): Promise<{ pageCount: number }> {
  const doc = await PDFDocument.load(buf);
  return { pageCount: doc.getPageCount() };
}
