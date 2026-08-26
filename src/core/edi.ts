import type { ConversionResult } from "./converter";
import type { EdiDocument, EdiLine, EdiRecord } from "./types";

export const EDI_QSO_FIELDS = [
  "DATE", "TIME", "CALL", "MODE_CODE", "RST_SENT", "QSO_SENT", "RST_RCVD",
  "QSO_RCVD", "EXCHANGE_RCVD", "WWL_RCVD", "QSO_POINTS", "NEW_EXCHANGE",
  "NEW_WWL", "NEW_DXCC", "DUPLICATE",
] as const;

export const EDI_MODE_NAMES: Record<string, string> = {
  "": "Not specified", "0": "Other", "1": "SSB", "2": "CW",
  "3": "SSB → CW", "4": "CW → SSB", "5": "AM", "6": "FM",
  "7": "RTTY", "8": "SSTV", "9": "ATV",
};

function makeId(index: number, raw: string): string {
  let hash = 2166136261;
  for (const char of raw) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `edi-${index + 1}-${(hash >>> 0).toString(36)}`;
}

export function ediField(record: EdiRecord, field: typeof EDI_QSO_FIELDS[number]): string {
  return record.fields[EDI_QSO_FIELDS.indexOf(field)] ?? "";
}

export function ediHeader(document: EdiDocument, key: string): string {
  return document.lines.find((line) => line.type === "header" && line.key?.toUpperCase() === key.toUpperCase())?.value ?? "";
}

export function parseEdi(source: string): EdiDocument {
  const newline = source.includes("\r\n") ? "\r\n" : source.includes("\n") ? "\n" : source.includes("\r") ? "\r" : "\n";
  const rawLines = source.split(/\r\n|\n|\r/);
  const trailingNewline = /(?:\r\n|\n|\r)$/.test(source);
  if (trailingNewline) rawLines.pop();
  let section: "header" | "remarks" | "records" = "header";
  let version = "";
  let declaredRecords: number | null = null;
  const records: EdiRecord[] = [];
  const lines: EdiLine[] = rawLines.map((raw, index) => {
    const base = { id: makeId(index, raw), lineNumber: index + 1, raw };
    const signature = raw.match(/^\s*\[REG1TEST;([^\]]+)\]\s*$/i);
    if (signature) {
      version = signature[1]?.trim() ?? "";
      return { ...base, type: "signature" };
    }
    if (/^\s*\[Remarks\]\s*$/i.test(raw)) {
      section = "remarks";
      return { ...base, type: "remarks-marker" };
    }
    const marker = raw.match(/^\s*\[QSORecords;(\d+)\]\s*$/i);
    if (marker) {
      section = "records";
      declaredRecords = Number(marker[1]);
      return { ...base, type: "records-marker" };
    }
    if (!raw) return { ...base, type: "blank" };
    if (/^\s*\[END(?:;[^\]]*)?\]\s*$/i.test(raw)) return { ...base, type: "footer" };
    if (section === "records") {
      const record: EdiRecord = { id: base.id, lineNumber: base.lineNumber, raw, fields: raw.split(";") };
      records.push(record);
      return { ...base, type: "qso", record };
    }
    if (section === "remarks") return { ...base, type: "remark" };
    const header = raw.match(/^([^=\s]+)=(.*)$/);
    if (header) return { ...base, type: "header", key: header[1], value: header[2] ?? "" };
    return { ...base, type: "unknown" };
  });
  return { format: "edi", source, newline, trailingNewline, lines, records, version, declaredRecords };
}

export function serializeEdi(document: EdiDocument): string {
  const text = document.lines.map((line) => line.raw).join(document.newline);
  return text + (document.trailingNewline ? document.newline : "");
}

export function updateEdiHeader(document: EdiDocument, key: string, value: string): EdiDocument {
  let found = false;
  const lines = document.lines.map((line) => {
    if (line.type !== "header" || line.key?.toUpperCase() !== key.toUpperCase()) return line;
    found = true;
    return { ...line, value, raw: `${line.key}=${value}` };
  });
  if (!found) {
    const markerIndex = lines.findIndex((line) => line.type === "remarks-marker" || line.type === "records-marker");
    const index = markerIndex < 0 ? lines.length : markerIndex;
    const lineNumber = index + 1;
    lines.splice(index, 0, { id: makeId(index, `${key}=${value}`), lineNumber, raw: `${key}=${value}`, type: "header", key, value });
    const normalized = lines.map((line, position) => {
      const lineNumber = position + 1;
      return line.record ? { ...line, lineNumber, record: { ...line.record, lineNumber } } : { ...line, lineNumber };
    });
    const records = normalized.flatMap((line) => line.record ? [line.record] : []);
    return { ...document, lines: normalized, records, source: serializeEdi({ ...document, lines: normalized, records }) };
  }
  return { ...document, lines, source: serializeEdi({ ...document, lines }) };
}

export function updateEdiRecord(document: EdiDocument, id: string, field: typeof EDI_QSO_FIELDS[number], value: string): EdiDocument {
  const fieldIndex = EDI_QSO_FIELDS.indexOf(field);
  const update = (record: EdiRecord): EdiRecord => {
    if (record.id !== id) return record;
    const fields = [...record.fields];
    while (fields.length < EDI_QSO_FIELDS.length) fields.push("");
    fields[fieldIndex] = value;
    return { ...record, fields, raw: fields.join(";"), dirty: true };
  };
  const records = document.records.map(update);
  const byId = new Map(records.map((record) => [record.id, record]));
  const lines = document.lines.map((line) => line.record ? { ...line, record: byId.get(line.record.id)!, raw: byId.get(line.record.id)!.raw } : line);
  return { ...document, records, lines, source: serializeEdi({ ...document, records, lines }) };
}

function adifTag(name: string, value: string): string {
  return value ? `<${name}:${[...value].length}>${value}` : "";
}

function adifDate(date: string, contestStart: string): string {
  if (!/^\d{6}$/.test(date)) return "";
  const century = /^\d{8}$/.test(contestStart) ? contestStart.slice(0, 2) : Number(date.slice(0, 2)) >= 70 ? "19" : "20";
  return `${century}${date}`;
}

function adifBand(value: string): string {
  const normalized = value.replace(",", ".");
  const parsed = Number(normalized.match(/[\d.]+/)?.[0]);
  const frequency = /GHz/i.test(normalized) ? parsed * 1_000 : parsed;
  if (!Number.isFinite(frequency)) return "";
  if (frequency >= 50 && frequency < 54) return "6M";
  if (frequency >= 70 && frequency < 71) return "4M";
  if (frequency >= 144 && frequency < 148) return "2M";
  if (frequency >= 430 && frequency < 450) return "70CM";
  if (frequency >= 1200 && frequency <= 1300) return "23CM";
  if (frequency >= 2300 && frequency < 2450) return "13CM";
  if (frequency >= 3300 && frequency < 3500) return "9CM";
  if (frequency >= 5650 && frequency < 5925) return "6CM";
  if (frequency >= 10_000 && frequency < 10_500) return "3CM";
  if (frequency >= 24_000 && frequency < 24_250) return "1.25CM";
  if (frequency >= 47_000 && frequency < 47_200) return "6MM";
  if (frequency >= 75_500 && frequency < 81_500) return "4MM";
  if (frequency >= 122_000 && frequency < 123_000) return "2.5MM";
  if (frequency >= 134_000 && frequency < 141_000) return "2MM";
  if (frequency >= 241_000 && frequency < 250_000) return "1MM";
  return "";
}

const ADIF_MODES: Record<string, string> = { "1": "SSB", "2": "CW", "3": "SSB", "4": "CW", "5": "AM", "6": "FM", "7": "RTTY", "8": "SSTV", "9": "ATV" };

export function ediToAdif(document: EdiDocument): ConversionResult {
  const station = ediHeader(document, "PCall");
  const locator = ediHeader(document, "PWWLo");
  const contestDates = ediHeader(document, "TDate").split(";");
  const band = adifBand(ediHeader(document, "PBand"));
  const rows = document.records.map((record) => {
    const modeCode = ediField(record, "MODE_CODE");
    const values: Record<string, string> = {
      CALL: ediField(record, "CALL"), QSO_DATE: adifDate(ediField(record, "DATE"), contestDates[0] ?? ""),
      TIME_ON: ediField(record, "TIME"), MODE: ADIF_MODES[modeCode] ?? "", RST_SENT: ediField(record, "RST_SENT"),
      STX: ediField(record, "QSO_SENT"), RST_RCVD: ediField(record, "RST_RCVD"), SRX: ediField(record, "QSO_RCVD"),
      SRX_STRING: ediField(record, "EXCHANGE_RCVD"), GRIDSQUARE: ediField(record, "WWL_RCVD"),
      MY_GRIDSQUARE: locator, BAND: band, STATION_CALLSIGN: station,
      APP_LOGCHECKER_EDI_MODE_CODE: modeCode, APP_LOGCHECKER_EDI_QSO_POINTS: ediField(record, "QSO_POINTS"),
      APP_LOGCHECKER_EDI_FLAGS: [ediField(record, "NEW_EXCHANGE"), ediField(record, "NEW_WWL"), ediField(record, "NEW_DXCC"), ediField(record, "DUPLICATE")].join("/"),
      APP_LOGCHECKER_EDI_RECORD: record.raw,
    };
    return values;
  });
  const content = `Generated by Contest Log Workbench\r\n<ADIF_VER:5>3.1.6\r\n<EOH>\r\n${rows.map((row) => `${Object.entries(row).map(([name, value]) => adifTag(name, value)).filter(Boolean).join(" ")} <EOR>`).join("\r\n")}\r\n`;
  const warnings = ["REG1TEST claimed scoring, station equipment, and remarks have no direct ADIF QSO representation; keep the original EDI file."];
  if (document.records.some((record) => ["3", "4"].includes(ediField(record, "MODE_CODE")))) warnings.push("Cross-mode EDI contacts use their transmitted mode in ADIF; the original EDI mode code is retained in APP_LOGCHECKER_EDI_MODE_CODE.");
  if (!band) warnings.push(`PBand “${ediHeader(document, "PBand") || "empty"}” could not be mapped to an ADIF band.`);
  return { content, warnings, records: rows.length, previewRows: rows };
}

function csvQuote(value: string, delimiter: "," | ";"): string {
  return value.includes(delimiter) || /["\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function ediToCsv(document: EdiDocument, delimiter: "," | ";" = ","): ConversionResult {
  const rows = document.records.map((record) => EDI_QSO_FIELDS.map((field) => csvQuote(ediField(record, field), delimiter)).join(delimiter));
  return { content: `${EDI_QSO_FIELDS.join(delimiter)}\r\n${rows.join("\r\n")}\r\n`, warnings: [], records: rows.length };
}
