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

export type EdiScoreFormula =
  | "points"
  | "points-plus-bonuses"
  | "points-times-multipliers-plus-bonuses"
  | "points-plus-bonuses-times-multipliers";

export const EDI_SCORE_FORMULAS: Record<EdiScoreFormula, string> = {
  points: "QSO points",
  "points-plus-bonuses": "QSO points + bonuses",
  "points-times-multipliers-plus-bonuses": "QSO points × multipliers + bonuses",
  "points-plus-bonuses-times-multipliers": "(QSO points + bonuses) × multipliers",
};

export interface EdiScoreRow {
  id: string;
  lineNumber: number;
  call: string;
  points: number;
  status: "counted" | "duplicate" | "error" | "incomplete";
}

export interface EdiScoreResult {
  formula: EdiScoreFormula;
  formulaLabel: string;
  inferred: boolean;
  total: number;
  claimedTotal: number | null;
  validQsos: number;
  duplicates: number;
  invalid: number;
  qsoPoints: number;
  newWwls: number;
  newExchanges: number;
  newDxccs: number;
  wwlBonus: number;
  exchangeBonus: number;
  dxccBonus: number;
  bonuses: number;
  wwlMultiplier: number;
  exchangeMultiplier: number;
  dxccMultiplier: number;
  multiplierProduct: number;
  rows: EdiScoreRow[];
  warnings: string[];
}

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

function finiteNumber(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function scoreTriple(document: EdiDocument, key: string): [number, number, number] {
  const values = ediHeader(document, key).split(";");
  return [finiteNumber(values[0] ?? "") ?? 0, finiteNumber(values[1] ?? "") ?? 0, finiteNumber(values[2] ?? "") ?? 1];
}

function effectiveCount(markerCount: number, declaredCount: number, label: string, warnings: string[]): number {
  if (markerCount > 0) {
    if (declaredCount !== markerCount) warnings.push(`${label}: ${markerCount} QSO marker${markerCount === 1 ? "" : "s"} replace the declared count of ${declaredCount}.`);
    return markerCount;
  }
  if (declaredCount > 0) {
    warnings.push(`${label}: no N marker is present in the QSO records, so the declared count of ${declaredCount} is retained.`);
    return declaredCount;
  }
  return 0;
}

function scoreForFormula(formula: EdiScoreFormula, points: number, bonuses: number, multipliers: number): number {
  if (formula === "points-plus-bonuses") return points + bonuses;
  if (formula === "points-times-multipliers-plus-bonuses") return points * multipliers + bonuses;
  if (formula === "points-plus-bonuses-times-multipliers") return (points + bonuses) * multipliers;
  return points;
}

/**
 * Recalculates REG1TEST summary values from its recorded per-QSO points and N/D flags.
 * EDI deliberately does not prescribe a universal CToSc formula, so QSO points are
 * never replaced with an assumed distance rule here.
 */
export function calculateEdiScore(document: EdiDocument, requestedFormula: EdiScoreFormula | "auto" = "auto"): EdiScoreResult {
  const warnings: string[] = [];
  const rows: EdiScoreRow[] = document.records.map((record) => {
    const call = ediField(record, "CALL").trim();
    const parsedPoints = finiteNumber(ediField(record, "QSO_POINTS"));
    const duplicate = ediField(record, "DUPLICATE").trim().toUpperCase() === "D";
    const error = call.toUpperCase() === "ERROR";
    const status: EdiScoreRow["status"] = duplicate ? "duplicate" : error ? "error" : parsedPoints === null || parsedPoints <= 0 ? "incomplete" : "counted";
    return { id: record.id, lineNumber: record.lineNumber, call: call || "—", points: parsedPoints ?? 0, status };
  });
  const acceptedIds = new Set(rows.filter((row) => row.status === "counted").map((row) => row.id));
  const acceptedRecords = document.records.filter((record) => acceptedIds.has(record.id));
  const qsoPoints = rows.filter((row) => row.status === "counted").reduce((sum, row) => sum + row.points, 0);
  const [declaredWwls, wwlBonusEach, rawWwlMultiplier] = scoreTriple(document, "CWWLs");
  const [declaredExchanges, exchangeBonusEach, rawExchangeMultiplier] = scoreTriple(document, "CExcs");
  const [declaredDxccs, dxccBonusEach, rawDxccMultiplier] = scoreTriple(document, "CDXCs");
  const markerCount = (field: "NEW_WWL" | "NEW_EXCHANGE" | "NEW_DXCC") => acceptedRecords.filter((record) => ediField(record, field).trim().toUpperCase() === "N").length;
  const newWwls = effectiveCount(markerCount("NEW_WWL"), declaredWwls, "WWL count", warnings);
  const newExchanges = effectiveCount(markerCount("NEW_EXCHANGE"), declaredExchanges, "Exchange count", warnings);
  const newDxccs = effectiveCount(markerCount("NEW_DXCC"), declaredDxccs, "DXCC count", warnings);
  const wwlBonus = newWwls * wwlBonusEach;
  const exchangeBonus = newExchanges * exchangeBonusEach;
  const dxccBonus = newDxccs * dxccBonusEach;
  const bonuses = wwlBonus + exchangeBonus + dxccBonus;
  const usableMultiplier = (value: number) => value > 0 ? value : 1;
  const wwlMultiplier = usableMultiplier(rawWwlMultiplier);
  const exchangeMultiplier = usableMultiplier(rawExchangeMultiplier);
  const dxccMultiplier = usableMultiplier(rawDxccMultiplier);
  const multiplierProduct = wwlMultiplier * exchangeMultiplier * dxccMultiplier;
  const claimedTotal = finiteNumber(ediHeader(document, "CToSc"));
  const candidates = Object.keys(EDI_SCORE_FORMULAS) as EdiScoreFormula[];
  const inferredFormula = claimedTotal === null ? null : candidates.find((candidate) => scoreForFormula(candidate, qsoPoints, bonuses, multiplierProduct) === claimedTotal) ?? null;
  const formula = requestedFormula === "auto" ? inferredFormula ?? "points" : requestedFormula;
  if (requestedFormula === "auto" && claimedTotal !== null && !inferredFormula) warnings.push("The declared CToSc does not match a standard points/bonus/multiplier combination. QSO points are used; choose another formula if the contest rules require it.");
  if (requestedFormula === "auto" && claimedTotal === null) warnings.push("No CToSc value is available for formula inference. QSO points are used by default.");
  const total = scoreForFormula(formula, qsoPoints, bonuses, multiplierProduct);
  return {
    formula, formulaLabel: EDI_SCORE_FORMULAS[formula], inferred: requestedFormula === "auto" && inferredFormula !== null,
    total, claimedTotal, validQsos: rows.filter((row) => row.status === "counted").length,
    duplicates: rows.filter((row) => row.status === "duplicate").length,
    invalid: rows.filter((row) => row.status === "error" || row.status === "incomplete").length,
    qsoPoints, newWwls, newExchanges, newDxccs, wwlBonus, exchangeBonus, dxccBonus, bonuses,
    wwlMultiplier, exchangeMultiplier, dxccMultiplier, multiplierProduct, rows, warnings,
  };
}

export function updateEdiScoreHeaders(document: EdiDocument, score: EdiScoreResult): EdiDocument {
  const bandMultiplier = scoreTriple(document, "CQSOs")[1] || 1;
  const [, wwlBonusEach] = scoreTriple(document, "CWWLs");
  const [, exchangeBonusEach] = scoreTriple(document, "CExcs");
  const [, dxccBonusEach] = scoreTriple(document, "CDXCs");
  let updated = updateEdiHeader(document, "CQSOs", `${score.validQsos};${bandMultiplier}`);
  updated = updateEdiHeader(updated, "CQSOP", String(score.qsoPoints));
  updated = updateEdiHeader(updated, "CWWLs", `${score.newWwls};${wwlBonusEach};${score.wwlMultiplier}`);
  updated = updateEdiHeader(updated, "CWWLB", String(score.wwlBonus));
  updated = updateEdiHeader(updated, "CExcs", `${score.newExchanges};${exchangeBonusEach};${score.exchangeMultiplier}`);
  updated = updateEdiHeader(updated, "CExcB", String(score.exchangeBonus));
  updated = updateEdiHeader(updated, "CDXCs", `${score.newDxccs};${dxccBonusEach};${score.dxccMultiplier}`);
  updated = updateEdiHeader(updated, "CDXCB", String(score.dxccBonus));
  return updateEdiHeader(updated, "CToSc", String(score.total));
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
