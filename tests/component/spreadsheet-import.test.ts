import { describe, expect, it } from "vitest";
import {
  isExcelFile,
  readSpreadsheetFileHead,
  SPREADSHEET_ACCEPT,
} from "@/lib/whatsapp/csv-leads.shared";

function csvFile(text: string, name = "contacts.csv"): File {
  return new File([text], name, { type: "text/csv" });
}

async function xlsxFile(rows: unknown[][], name = "contacts.xlsx"): Promise<File> {
  const XLSX = await import("xlsx");
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Sheet1");
  const buf = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new File([buf], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

describe("isExcelFile", () => {
  it("recognizes xlsx and xls by extension and mime type", () => {
    expect(isExcelFile({ name: "leads.xlsx" })).toBe(true);
    expect(isExcelFile({ name: "leads.xls" })).toBe(true);
    expect(
      isExcelFile({
        name: "upload",
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    ).toBe(true);
  });

  it("leaves CSV on the existing text path", () => {
    expect(isExcelFile({ name: "leads.csv", type: "text/csv" })).toBe(false);
  });

  it("offers both formats to the file picker", () => {
    expect(SPREADSHEET_ACCEPT).toContain(".csv");
    expect(SPREADSHEET_ACCEPT).toContain(".xlsx");
    expect(SPREADSHEET_ACCEPT).toContain(".xls");
  });
});

describe("readSpreadsheetFileHead", () => {
  it("reads an Excel file into the same shape as the CSV path", async () => {
    const file = await xlsxFile([
      ["Owner Name", "Mobile 1", "Project"],
      ["Aisha Khan", "971501234567", "Samana Manhattan 2"],
      ["Tom Reed", "971509876543", "JVC Tower"],
    ]);
    const { headers, rows, truncated } = await readSpreadsheetFileHead(file, 1000);

    expect(headers).toEqual(["Owner Name", "Mobile 1", "Project"]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ "Owner Name": "Aisha Khan", "Mobile 1": "971501234567" });
    expect(truncated).toBe(false);
  });

  it("produces identical output for the same data as CSV or Excel", async () => {
    const asCsv = await readSpreadsheetFileHead(
      csvFile("Owner Name,Mobile 1\nAisha Khan,971501234567"),
      1000,
    );
    const asExcel = await readSpreadsheetFileHead(
      await xlsxFile([
        ["Owner Name", "Mobile 1"],
        ["Aisha Khan", "971501234567"],
      ]),
      1000,
    );
    expect(asExcel.headers).toEqual(asCsv.headers);
    expect(asExcel.rows).toEqual(asCsv.rows);
  });

  it("keeps a numeric-looking phone column as typed, not reformatted", async () => {
    const file = await xlsxFile([
      ["Mobile 1"],
      ["971501234567"],
    ]);
    const { rows } = await readSpreadsheetFileHead(file, 1000);
    expect(rows[0]!["Mobile 1"]).toBe("971501234567");
  });

  it("skips fully blank rows Excel leaves behind", async () => {
    const file = await xlsxFile([
      ["Owner Name", "Mobile 1"],
      ["Aisha Khan", "971501234567"],
      ["", ""],
    ]);
    const { rows } = await readSpreadsheetFileHead(file, 1000);
    expect(rows).toHaveLength(1);
  });

  it("reports truncation when the sheet exceeds the scan limit", async () => {
    const body = Array.from({ length: 12 }, (_, i) => [`Name ${i}`, `97150000000${i}`]);
    const file = await xlsxFile([["Owner Name", "Mobile 1"], ...body]);
    const { rows, truncated } = await readSpreadsheetFileHead(file, 5);
    expect(rows).toHaveLength(5);
    expect(truncated).toBe(true);
  });

  it("returns empty rather than throwing on a sheet with no header row", async () => {
    const file = await xlsxFile([]);
    const { headers, rows } = await readSpreadsheetFileHead(file, 100);
    expect(headers).toEqual([]);
    expect(rows).toEqual([]);
  });
});
