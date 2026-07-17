/**
 * Built-in PDF invoice renderer (pdf-lib).
 *
 * Used when an invoice is generated with format "pdf" — draws a clean A4
 * invoice layout directly from the same payload that fills DOCX templates,
 * so no Word template is required for PDF output.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export interface InvoicePdfInput {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  clientName: string;
  fromName?: string;
  fromAddress?: string;
  toAddress?: string;
  period: string;
  currency: string;
  items: Array<{ description: string; quantity: number; unitPrice: string; amount: string }>;
  subtotal: string;
  taxRate: string;
  tax: string;
  total: string;
  notes: string;
}

const INK = rgb(0.13, 0.15, 0.19);
const MUTED = rgb(0.45, 0.49, 0.55);
const LINE = rgb(0.85, 0.87, 0.9);
const ACCENT = rgb(0.02, 0.53, 0.44);

export async function renderInvoicePdf(inp: InvoicePdfInput): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const pageW = 595.28; // A4
  const pageH = 841.89;
  const margin = 50;
  let page = doc.addPage([pageW, pageH]);
  let y = pageH - margin;

  const sanitize = (s: string) => s.replace(/[^\x20-\x7E£€]/g, "");
  const text = (s: string, x: number, size: number, f = font, color = INK) =>
    page.drawText(sanitize(s), { x, y, size, font: f, color });
  const rightText = (s: string, rightEdge: number, size: number, f = font, color = INK) => {
    const t = sanitize(s);
    page.drawText(t, { x: rightEdge - f.widthOfTextAtSize(t, size), y, size, font: f, color });
  };
  const hline = (yy: number, color = LINE) =>
    page.drawLine({ start: { x: margin, y: yy }, end: { x: pageW - margin, y: yy }, thickness: 0.7, color });

  const wrap = (s: string, f: typeof font, size: number, maxW: number): string[] => {
    const words = sanitize(s).split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const cand = cur ? `${cur} ${w}` : w;
      if (f.widthOfTextAtSize(cand, size) <= maxW) cur = cand;
      else { if (cur) lines.push(cur); cur = w; }
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [""];
  };

  const ensureSpace = (needed: number) => {
    if (y - needed < margin + 40) {
      page = doc.addPage([pageW, pageH]);
      y = pageH - margin;
    }
  };

  // Header
  text("INVOICE", margin, 26, bold, ACCENT);
  rightText(inp.invoiceNumber, pageW - margin, 14, bold);
  y -= 34;
  hline(y);
  y -= 24;

  // Sender ("From") block
  if (inp.fromName?.trim() || inp.fromAddress?.trim()) {
    text("From", margin, 9, font, MUTED);
    y -= 14;
    if (inp.fromName?.trim()) {
      text(inp.fromName, margin, 11, bold);
      y -= 14;
    }
    for (const rawLn of (inp.fromAddress ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
      for (const ln of wrap(rawLn, font, 9, pageW - margin * 2 - 160)) {
        text(ln, margin, 9, font, MUTED);
        y -= 12;
      }
    }
    y -= 12;
  }

  // Meta block
  text("Billed to", margin, 9, font, MUTED);
  rightText("Invoice date", pageW - margin - 120, 9, font, MUTED);
  page.drawText(sanitize(inp.invoiceDate), { x: pageW - margin - 110, y, size: 9, font });
  y -= 16;
  text(inp.clientName, margin, 13, bold);
  rightText("Due date", pageW - margin - 120, 9, font, MUTED);
  page.drawText(sanitize(inp.dueDate), { x: pageW - margin - 110, y, size: 9, font });
  y -= 16;
  for (const rawLn of (inp.toAddress ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    for (const ln of wrap(rawLn, font, 9, pageW - margin * 2 - 160)) {
      text(ln, margin, 9, font, MUTED);
      y -= 12;
    }
  }
  y -= 4;
  text(`Billing period: ${inp.period}`, margin, 10, font, MUTED);
  y -= 30;

  // Items table header
  const colQtyR = pageW - margin - 190;
  const colUnitR = pageW - margin - 90;
  const colAmtR = pageW - margin;
  const descW = colQtyR - margin - 60;
  text("Description", margin, 9, bold, MUTED);
  rightText("Qty", colQtyR, 9, bold, MUTED);
  rightText("Unit price", colUnitR, 9, bold, MUTED);
  rightText("Amount", colAmtR, 9, bold, MUTED);
  y -= 8;
  hline(y);
  y -= 16;

  for (const it of inp.items) {
    const lines = wrap(it.description, font, 10, descW);
    ensureSpace(lines.length * 13 + 10);
    const rowTop = y;
    for (const ln of lines) {
      text(ln, margin, 10);
      y -= 13;
    }
    const saveY = y;
    y = rowTop;
    rightText(String(it.quantity), colQtyR, 10);
    rightText(it.unitPrice, colUnitR, 10);
    rightText(it.amount, colAmtR, 10, bold);
    y = saveY - 4;
    hline(y + 8, rgb(0.93, 0.94, 0.96));
    y -= 6;
  }

  // Totals
  ensureSpace(90);
  y -= 8;
  const totalsLabelX = colUnitR - 80;
  const totalsRow = (label: string, value: string, big = false) => {
    page.drawText(label, { x: totalsLabelX, y, size: big ? 12 : 10, font: big ? bold : font, color: big ? INK : MUTED });
    rightText(value, colAmtR, big ? 12 : 10, big ? bold : font);
    y -= big ? 20 : 16;
  };
  totalsRow("Subtotal", inp.subtotal);
  totalsRow(`Tax (${inp.taxRate})`, inp.tax);
  hline(y + 6);
  y -= 6;
  totalsRow("Total due", inp.total, true);

  // Notes
  if (inp.notes?.trim()) {
    ensureSpace(60);
    y -= 14;
    text("Notes", margin, 9, bold, MUTED);
    y -= 14;
    for (const ln of wrap(inp.notes, font, 9, pageW - margin * 2)) {
      ensureSpace(12);
      text(ln, margin, 9, font, MUTED);
      y -= 12;
    }
  }

  return Buffer.from(await doc.save());
}
