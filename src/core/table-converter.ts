import { parseAdif } from "./adif";
import { serializeAdifWithOptions, type AdifExportOptions } from "./adif-tools";
import { adifToCabrillo, type ConversionResult } from "./converter";
import type { TableDocument } from "./tabular";

function mappedColumns(table: TableDocument): Array<{ index: number; name: string }> {
  return table.columns
    .map((column, index) => ({ index, name: column.name.trim().toUpperCase() }))
    .filter((column) => /^[A-Z][A-Z0-9_]*$/.test(column.name) && !/^COLUMN_\d+$/.test(column.name) && column.name !== "UNASSIGNED");
}

function mappingWarnings(table: TableDocument, cabrillo: boolean): string[] {
  const names = new Set(mappedColumns(table).map((column) => column.name));
  const warnings: string[] = [];
  for (const required of ["CALL", "QSO_DATE", "MODE"]) if (!names.has(required)) warnings.push(`${required} is not assigned to a column.`);
  if (!names.has("TIME_ON") && !names.has("TIME_OFF")) warnings.push("TIME_ON or TIME_OFF is required.");
  if (!names.has("BAND") && !names.has("FREQ")) warnings.push("BAND or FREQ is required.");
  if (cabrillo && !names.has("STX") && !names.has("STX_STRING")) warnings.push("A sent exchange column (STX or STX_STRING) is recommended for Cabrillo.");
  if (cabrillo && !names.has("SRX") && !names.has("SRX_STRING")) warnings.push("A received exchange column (SRX or SRX_STRING) is recommended for Cabrillo.");
  const ignored = table.columns.filter((column) => /^COLUMN_\d+$/.test(column.name) || column.name === "UNASSIGNED").length;
  if (ignored) warnings.push(`${ignored} unassigned column${ignored === 1 ? "" : "s"} will not be included in converted output.`);
  return warnings;
}

function rawAdif(table: TableDocument): string {
  const columns = mappedColumns(table);
  const records = table.rows.map((row) => columns.map((column) => {
    const value = row.cells[column.index] ?? "";
    return value ? `<${column.name}:${value.length}>${value}` : "";
  }).filter(Boolean).join(" ") + " <EOR>");
  return `<ADIF_VER:5>3.1.6\n<PROGRAMID:21>CONTEST-LOG-WORKBENCH\n<EOH>\n${records.join("\n")}\n`;
}

export function textTableToAdif(table: TableDocument, options: AdifExportOptions = {}): ConversionResult {
  const warnings = mappingWarnings(table, false);
  const document = parseAdif(rawAdif(table));
  return { content: serializeAdifWithOptions(document, options), warnings, records: table.rows.length };
}

export function textTableToCabrillo(table: TableDocument, stationCall: string, contest: string): ConversionResult {
  const warnings = mappingWarnings(table, true);
  const converted = adifToCabrillo(parseAdif(rawAdif(table)), stationCall, contest);
  return { ...converted, warnings: [...warnings, ...converted.warnings] };
}

function quote(value: string, delimiter: string): string {
  return value.includes(delimiter) || /["\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function textTableToCsv(table: TableDocument, delimiter: "," | ";" = ","): ConversionResult {
  const headers = table.columns.map((column) => quote(column.name, delimiter)).join(delimiter);
  const rows = table.rows.map((row) => row.cells.map((value) => quote(value, delimiter)).join(delimiter));
  return { content: `${headers}\r\n${rows.join("\r\n")}\r\n`, warnings: [], records: table.rows.length };
}

