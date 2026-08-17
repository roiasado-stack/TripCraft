import * as XLSX from "xlsx";

/**
 * Turns any dropped file into CSV text the existing parsers understand.
 * Real .xlsx/.xls are binary, so they go through SheetJS; everything else is
 * read as plain text and passed through unchanged.
 */
export async function fileToParsableText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  const isSpreadsheet =
    name.endsWith(".xlsx") ||
    name.endsWith(".xls") ||
    name.endsWith(".xlsm") ||
    file.type.includes("spreadsheetml") ||
    file.type === "application/vnd.ms-excel";

  if (!isSpreadsheet) return file.text();

  const buffer = await file.arrayBuffer();
  const book = XLSX.read(buffer, { type: "array" });
  const firstSheetName = book.SheetNames[0];
  if (!firstSheetName) throw new Error("הקובץ ריק");
  const sheet = book.Sheets[firstSheetName];
  // Blank rows dropped; empty cells still emit a column so positions align.
  return XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
}

/** File-picker accept string covering everything the importers handle. */
export const TABULAR_ACCEPT = ".csv,.tsv,.txt,.json,.xlsx,.xls,.xlsm";
