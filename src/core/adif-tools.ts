import { adifValue, parseAdif, updateAdifTag } from "./adif";
import { DEPRECATED_MODE_MAP } from "./adif-schema";
import { geography } from "./geography";
import { bandFromFrequency } from "./radio";
import type { AdifDocument, AdifRecord, AdifTag } from "./types";

export interface AdifFilter {
  dateFrom?: string;
  dateTo?: string;
  bands?: readonly string[];
  modes?: readonly string[];
  submodes?: readonly string[];
  cqZones?: readonly string[];
  callsign?: string;
  operator?: string;
  qslStatus?: readonly string[];
  continents?: readonly string[];
}

export type DuplicateStrategy = "keep-all" | "keep-first" | "keep-last";

export interface AdifMergeResult {
  document: AdifDocument;
  duplicates: Array<{ key: string; kept: string; discarded?: string }>;
}

export interface AdifExportOptions {
  tagCase?: "upper" | "lower";
  includeTypes?: boolean;
  decimalSeparator?: "." | ",";
  newline?: "\n" | "\r\n" | "\r";
}

function recordKey(record: AdifRecord): string {
  const band = adifValue(record, "BAND") || bandFromFrequency(adifValue(record, "FREQ"));
  return ["CALL", "QSO_DATE", "TIME_ON", "MODE", "SUBMODE"].map((name) => adifValue(record, name).trim().toUpperCase()).concat(band.toUpperCase()).join("|");
}

function rebuild(document: AdifDocument, records: readonly AdifRecord[], unparsedTail = document.unparsedTail): AdifDocument {
  const newline = document.newline;
  const header = document.headerOriginal || `<ADIF_VER:5>3.1.7${newline}<EOH>`;
  const recordSource = records.map((record) => record.original.trim() || `${record.tags.map((tag) => `<${tag.name}:${tag.value.length}${tag.type ? `:${tag.type}` : ""}>${tag.value}`).join(" ")} <EOR>`);
  return parseAdif(`${header}${recordSource.length ? newline : ""}${recordSource.join(newline)}${recordSource.length ? newline : ""}${unparsedTail}`);
}

export function mergeAdif(documents: readonly AdifDocument[], strategy: DuplicateStrategy = "keep-first"): AdifMergeResult {
  if (!documents.length) return { document: parseAdif("<ADIF_VER:5>3.1.7\n<EOH>\n"), duplicates: [] };
  const records: AdifRecord[] = [];
  const positions = new Map<string, number>();
  const duplicates: AdifMergeResult["duplicates"] = [];
  for (const document of documents) {
    for (const record of document.records) {
      const key = recordKey(record);
      const existing = positions.get(key);
      if (existing === undefined || strategy === "keep-all") {
        positions.set(key, records.length);
        records.push(record);
      } else if (strategy === "keep-last") {
        duplicates.push({ key, kept: record.id, discarded: records[existing]!.id });
        records[existing] = record;
      } else {
        duplicates.push({ key, kept: records[existing]!.id, discarded: record.id });
      }
    }
  }
  const tails = documents.map((document) => document.unparsedTail).filter((tail) => tail.trim());
  return { document: rebuild(documents[0]!, records, tails.join(documents[0]!.newline)), duplicates };
}

function selected(value: string, allowed?: readonly string[]): boolean {
  return !allowed?.length || allowed.map((item) => item.toUpperCase()).includes(value.toUpperCase());
}

export function filterAdifRecords(document: AdifDocument, filter: AdifFilter): AdifRecord[] {
  const callsign = filter.callsign?.trim().toUpperCase();
  const operator = filter.operator?.trim().toUpperCase();
  return document.records.filter((record) => {
    const date = adifValue(record, "QSO_DATE");
    const band = adifValue(record, "BAND") || bandFromFrequency(adifValue(record, "FREQ"));
    const location = geography.lookup(adifValue(record, "CALL"));
    const cqZone = adifValue(record, "CQZ") || (location?.cqZone === null || location?.cqZone === undefined ? "" : String(location.cqZone));
    const continent = adifValue(record, "CONT") || location?.continent || "";
    if (filter.dateFrom && date < filter.dateFrom.replaceAll("-", "")) return false;
    if (filter.dateTo && date > filter.dateTo.replaceAll("-", "")) return false;
    if (!selected(band, filter.bands)) return false;
    if (!selected(adifValue(record, "MODE"), filter.modes)) return false;
    if (!selected(adifValue(record, "SUBMODE"), filter.submodes)) return false;
    if (!selected(cqZone, filter.cqZones)) return false;
    if (!selected(adifValue(record, "QSL_RCVD") || adifValue(record, "QSL_SENT"), filter.qslStatus)) return false;
    if (!selected(continent, filter.continents)) return false;
    if (callsign && adifValue(record, "CALL").toUpperCase() !== callsign) return false;
    if (operator && adifValue(record, "OPERATOR").toUpperCase() !== operator) return false;
    return true;
  });
}

export function filterAdif(document: AdifDocument, filter: AdifFilter): AdifDocument {
  return rebuild(document, filterAdifRecords(document, filter));
}

function inferredType(tag: AdifTag): string {
  if (tag.type) return tag.type;
  if (/DATE$/.test(tag.name)) return "D";
  if (/^TIME_/.test(tag.name)) return "T";
  if (/^(?:FREQ|FREQ_RX|CQZ|ITUZ|STX|SRX)$/.test(tag.name)) return "N";
  return "S";
}

function exportedTag(tag: AdifTag, options: AdifExportOptions): string {
  const name = options.tagCase === "lower" ? tag.name.toLowerCase() : tag.name.toUpperCase();
  const value = options.decimalSeparator === "," && /^(?:FREQ|FREQ_RX)$/.test(tag.name) ? tag.value.replace(".", ",") : tag.value;
  const type = options.includeTypes ? `:${inferredType(tag)}` : "";
  return `<${name}:${value.length}${type}>${value}`;
}

export function serializeAdifWithOptions(document: AdifDocument, options: AdifExportOptions = {}): string {
  const newline = options.newline ?? document.newline;
  const header = document.header.length
    ? `${(document.header.some((tag) => tag.name === "ADIF_VER") ? document.header.map((tag) => tag.name === "ADIF_VER" ? { ...tag, value: "3.1.7" } : tag) : [{ name: "ADIF_VER", value: "3.1.7", raw: "" }, ...document.header]).map((tag) => exportedTag(tag, options)).join(" ")}${newline}<${options.tagCase === "lower" ? "eoh" : "EOH"}>`
    : `<${options.tagCase === "lower" ? "adif_ver" : "ADIF_VER"}:5${options.includeTypes ? ":S" : ""}>3.1.7${newline}<${options.tagCase === "lower" ? "eoh" : "EOH"}>`;
  const eor = `<${options.tagCase === "lower" ? "eor" : "EOR"}>`;
  return `${header}${document.records.length ? newline : ""}${document.records.map((record) => `${record.tags.map((tag) => exportedTag(tag, options)).join(" ")} ${eor}`).join(newline)}${document.records.length ? newline : ""}`;
}

export function extractAdifCallsigns(document: AdifDocument): string[] {
  return [...new Set(document.records.map((record) => adifValue(record, "CALL").trim().toUpperCase()).filter(Boolean))].sort();
}

export function modernizeDeprecatedModes(document: AdifDocument): { document: AdifDocument; changes: Array<{ recordId: string; before: string; after: string }> } {
  let next = document; const changes: Array<{ recordId: string; before: string; after: string }> = [];
  for (const record of document.records) { const before = adifValue(record, "MODE").toUpperCase(); const mapping = DEPRECATED_MODE_MAP[before]; if (!mapping) continue; next = updateAdifTag(next, record.id, "MODE", mapping.mode); if (mapping.submode && !adifValue(record, "SUBMODE")) next = updateAdifTag(next, record.id, "SUBMODE", mapping.submode); changes.push({ recordId: record.id, before, after: `${mapping.mode}${mapping.submode ? ` / ${mapping.submode}` : ""}` }); }
  return { document: next, changes };
}
