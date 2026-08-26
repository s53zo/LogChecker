import { adifValue } from "./adif";
import { formatQso, qsoColumns } from "./cabrillo";
import { bandFromFrequency, frequencyFromBand, frequencyToKHz, frequencyToMHz } from "./radio";
import { cabrilloModeMap, deprecatedModeMap, getContestLayout } from "./templates";
import { modeToAdif } from "./transformations/values";
import type { AdifDocument, AdifTag, CabrilloDocument, QsoData } from "./types";

export interface ConversionResult {
  content: string;
  warnings: string[];
  records: number;
  lossReport?: string[];
  previewRows?: Array<Record<string, string>>;
}

export interface ConversionMappingOptions {
  fieldMap?: Readonly<Record<string, string>>;
}

const CABRILLO_TO_ADIF: Readonly<Record<string, string>> = {
  FREQUENCY: "FREQ", MODE: "MODE", QSO_DATE: "QSO_DATE", TIME_ON: "TIME_ON",
  MY_CALL: "STATION_CALLSIGN", CALL: "CALL", RST_SENT: "RST_SENT", RST_RCVD: "RST_RCVD",
  STX: "STX", STX_STRING: "STX_STRING", SRX: "SRX", SRX_STRING: "SRX_STRING",
  FREQ_RX: "FREQ_RX", PROP_MODE: "PROP_MODE", SAT_MODE: "SAT_MODE",
  GRIDSQUARE: "GRIDSQUARE", MY_GRIDSQUARE: "MY_GRIDSQUARE",
};

const ADIF_TO_CABRILLO: Readonly<Record<string, string>> = {
  FREQ: "FREQUENCY", BAND: "FREQUENCY", MODE: "MODE", SUBMODE: "MODE",
  QSO_DATE: "QSO_DATE", TIME_ON: "TIME_ON", TIME_OFF: "TIME_ON",
  STATION_CALLSIGN: "MY_CALL", OPERATOR: "MY_CALL", CALL: "CALL",
  RST_SENT: "RST_SENT", RST_RCVD: "RST_RCVD", STX: "STX", STX_STRING: "STX_STRING",
  SRX: "SRX", SRX_STRING: "SRX_STRING", FREQ_RX: "FREQ_RX", PROP_MODE: "PROP_MODE",
  SAT_MODE: "SAT_MODE", GRIDSQUARE: "GRIDSQUARE", MY_GRIDSQUARE: "MY_GRIDSQUARE",
};

export const defaultCabrilloToAdifTarget = (key: string): string => CABRILLO_TO_ADIF[key.toUpperCase()] ?? "";

function addCollisionWarnings(names: readonly string[], targetFor: (name: string) => string, warnings: string[]): void {
  const byTarget = new Map<string, string[]>();
  for (const name of names) {
    const target = targetFor(name);
    if (!target) continue;
    byTarget.set(target, [...(byTarget.get(target) ?? []), name]);
  }
  for (const [target, sources] of byTarget) if (sources.length > 1) warnings.push(`${sources.join(", ")} all map to ${target}; later non-empty values take precedence.`);
}

export function defaultAdifToCabrilloTarget(name: string, contest = "GENERIC-CONTEST"): string {
  const desired = ADIF_TO_CABRILLO[name.toUpperCase()] ?? "";
  if (!desired) return "";
  const keys = new Set(qsoColumns(getContestLayout(contest)).map((cell) => cell.key));
  if (keys.has(desired)) return desired;
  if (desired === "STX" && keys.has("STX_STRING")) return "STX_STRING";
  if (desired === "STX_STRING" && keys.has("STX")) return "STX";
  if (desired === "SRX" && keys.has("SRX_STRING")) return "SRX_STRING";
  if (desired === "SRX_STRING" && keys.has("SRX")) return "SRX";
  return "";
}

const tag = (name: string, value: string, type?: string): string =>
  value ? `<${name}:${value.length}${type ? `:${type}` : ""}>${value}` : "";

export function cabrilloToAdif(document: CabrilloDocument, options: ConversionMappingOptions = {}): ConversionResult {
  const warnings: string[] = [];
  const lossReport: string[] = [];
  const contest = document.contest === "GENERIC-CONTEST" ? "" : document.contest;
  const previewRows: Array<Record<string, string>> = [];
  const rawTargetFor = (key: string) => options.fieldMap && Object.prototype.hasOwnProperty.call(options.fieldMap, key) ? options.fieldMap[key]!.trim().toUpperCase() : defaultCabrilloToAdifTarget(key);
  const invalidTargets = new Set<string>();
  const targetFor = (key: string) => {
    const target = rawTargetFor(key);
    if (target && !/^[A-Z][A-Z0-9_]{0,63}$/.test(target)) { invalidTargets.add(`${key} → ${target}`); return ""; }
    return target;
  };
  const sourceKeys = [...new Set(document.lines.flatMap((line) => line.qso?.cells.map((cell) => cell.key) ?? []))];
  addCollisionWarnings(sourceKeys, targetFor, warnings);
  const records = document.lines.filter((line) => line.qso && !line.raw.startsWith("X-QSO:")).map((line) => {
    const qso = line.qso!;
    const mapped = new Map<string, string>();
    for (const cell of qso.cells) {
      const target = targetFor(cell.key);
      if (!target || !cell.value) continue;
      if (cell.key === "MODE" && target === "MODE") {
        const converted = modeToAdif(cell.value);
        mapped.set("MODE", converted.mode);
        if (converted.submode) mapped.set("SUBMODE", converted.submode);
      } else if ((cell.key === "FREQUENCY" || cell.key === "FREQ_RX") && /^(?:FREQ|FREQ_RX)$/.test(target)) mapped.set(target, frequencyToMHz(cell.value));
      else if (cell.key === "FREQUENCY" && target === "BAND") mapped.set(target, bandFromFrequency(cell.value));
      else if (cell.key === "QSO_DATE" && target === "QSO_DATE") mapped.set(target, cell.value.replaceAll("-", ""));
      else mapped.set(target, cell.value);
    }
    if (!mapped.has("BAND") && qso.frequency) mapped.set("BAND", bandFromFrequency(qso.frequency));
    if (contest) mapped.set("CONTEST_ID", contest);
    mapped.set("APP_LOGCHECKER_CABRILLO_QSO", line.raw);
    previewRows.push(Object.fromEntries(mapped));
    return `${[...mapped].map(([name, fieldValue]) => tag(name, fieldValue)).filter(Boolean).join(" ")} <EOR>`;
  });
  const preservedLines = document.lines.filter((line) => !line.qso && line.key !== "START-OF-LOG" && line.key !== "END-OF-LOG");
  const preservationTags = preservedLines.map((line) => tag("APP_LOGCHECKER_CABRILLO_LINE", line.raw)).filter(Boolean);
  if (preservationTags.length) warnings.push(`${preservationTags.length} non-QSO source lines are embedded as APP_LOGCHECKER_CABRILLO_LINE fields for recovery.`);
  if (!document.layout) warnings.push("The selected contest has no detailed recovered field layout; exchange fields use generic STX_STRING and SRX_STRING mappings.");
  const unknownQsoKeys = [...new Set(document.lines.filter((line) => line.qso).flatMap((line) => line.qso!.cells.filter((cell) => cell.value && !targetFor(cell.key)).map((cell) => cell.key)))];
  if (unknownQsoKeys.length) lossReport.push(`No standard ADIF mapping for Cabrillo QSO fields: ${unknownQsoKeys.join(", ")}. Original QSO lines are embedded for recovery.`);
  if (invalidTargets.size) lossReport.push(`Invalid ADIF mapping targets were not emitted: ${[...invalidTargets].join(", ")}.`);
  return {
    content: `Generated by Contest Log Workbench\r\n${tag("ADIF_VER", "3.1.6")} ${tag("PROGRAMID", "CONTEST-LOG-WORKBENCH")} ${preservationTags.join(" ")} <EOH>\r\n${records.join("\r\n")}\r\n`,
    warnings,
    records: records.length,
    lossReport,
    previewRows,
  };
}

function value(recordTags: readonly AdifTag[], name: string): string {
  return recordTags.find((candidate) => candidate.name === name)?.value ?? "";
}

function adifModeToCabrillo(modeInput: string, submodeInput: string): string {
  const mode = (submodeInput || modeInput).toUpperCase();
  const current = deprecatedModeMap[mode] ?? mode;
  return cabrilloModeMap[current] ?? (current === "SSB" ? "PH" : current === "RTTY" ? "RY" : current.slice(0, 2));
}

export function adifToCabrillo(document: AdifDocument, stationCall: string, contest: string, options: ConversionMappingOptions = {}): ConversionResult {
  const warnings: string[] = ["ADIF does not contain every contest-specific exchange position. Review the structured QSO table before submitting the Cabrillo file."];
  const lossReport: string[] = [];
  const recoveredLines = document.header.filter((headerTag) => headerTag.name === "APP_LOGCHECKER_CABRILLO_LINE").map((headerTag) => headerTag.value);
  const lines = [
    "START-OF-LOG: 3.0",
    `CALLSIGN: ${stationCall || "N0CALL"}`,
    `CONTEST: ${contest || "GENERIC-CONTEST"}`,
    "CREATED-BY: Contest Log Workbench",
    ...recoveredLines.filter((line) => !/^(?:START-OF-LOG|END-OF-LOG|CREATED-BY)\s*:/i.test(line)),
  ];
  const layout = getContestLayout(contest);
  const previewRows: Array<Record<string, string>> = [];
  const targetKeys = new Set(qsoColumns(layout).map((cell) => cell.key));
  const invalidTargets = new Set<string>();
  let inferredBandFrequency = false;
  const targetFor = (name: string) => {
    const target = options.fieldMap && Object.prototype.hasOwnProperty.call(options.fieldMap, name) ? options.fieldMap[name]!.trim().toUpperCase() : defaultAdifToCabrilloTarget(name, contest);
    if (target && !targetKeys.has(target)) { invalidTargets.add(`${name} → ${target}`); return ""; }
    return target;
  };
  const sourceTags = [...new Set(document.records.flatMap((record) => record.tags.map((entry) => entry.name)))];
  addCollisionWarnings(sourceTags, targetFor, warnings);
  for (const record of document.records) {
    const columns = qsoColumns(layout);
    const set = (key: string, fieldValue: string) => {
      const cell = columns.find((candidate) => candidate.key === key);
      if (cell) cell.value = fieldValue;
    };
    const ordered = [...record.tags].sort((left, right) => ["BAND", "TIME_OFF", "MODE"].includes(left.name) ? -1 : ["FREQ", "TIME_ON", "SUBMODE"].includes(left.name) ? 1 : 0);
    for (const entry of ordered) {
      const target = targetFor(entry.name);
      if (!target) continue;
      let fieldValue = entry.value;
      if (target === "FREQUENCY" && entry.name === "FREQ") fieldValue = frequencyToKHz(entry.value);
      else if (target === "FREQUENCY" && entry.name === "BAND") {
        fieldValue = frequencyFromBand(entry.value);
        inferredBandFrequency ||= Boolean(fieldValue);
      }
      else if (target === "QSO_DATE" && /^\d{8}$/.test(entry.value)) fieldValue = `${entry.value.slice(0, 4)}-${entry.value.slice(4, 6)}-${entry.value.slice(6)}`;
      else if (target === "TIME_ON") fieldValue = entry.value.slice(0, 4);
      else if (target === "MODE") fieldValue = adifModeToCabrillo(adifValue(record, "MODE"), adifValue(record, "SUBMODE"));
      set(target, fieldValue);
    }
    if (stationCall) set("MY_CALL", stationCall);
    const date = adifValue(record, "QSO_DATE");
    const qso: QsoData = {
      frequency: value(record.tags, "FREQ"), mode: value(record.tags, "MODE"),
      date, time: value(record.tags, "TIME_ON"), cells: columns,
      call: value(record.tags, "CALL"), myCall: stationCall,
      sentRst: value(record.tags, "RST_SENT"), receivedRst: value(record.tags, "RST_RCVD"),
      sentExchange: value(record.tags, "STX_STRING"), receivedExchange: value(record.tags, "SRX_STRING"),
    };
    lines.push(formatQso(qso, layout));
    previewRows.push(Object.fromEntries(columns.filter((cell) => cell.value).map((cell) => [cell.key, cell.value])));
    const recoveryOnly = new Set(["CONTEST_ID", "APP_LOGCHECKER_CABRILLO_QSO"]);
    const unknown = record.tags.filter((entry) => !targetFor(entry.name) && !recoveryOnly.has(entry.name));
    if (unknown.length) lossReport.push(`Record ${record.id}: ${unknown.map((entry) => entry.name).join(", ")} has no Cabrillo column mapping.`);
  }
  lines.push("END-OF-LOG:");
  if (document.unparsedTail.trim()) lossReport.push("The ADIF file contains an incomplete trailing fragment that cannot be represented in Cabrillo.");
  if (invalidTargets.size) lossReport.push(`Mapping targets outside the selected Cabrillo layout were not emitted: ${[...invalidTargets].join(", ")}.`);
  if (inferredBandFrequency) warnings.push("At least one Cabrillo frequency was inferred from ADIF BAND using a representative in-band frequency; review it before submission.");
  if (layout) warnings.push(`The recovered ${layout.name} fixed-column layout is active for this conversion.`);
  return { content: `${lines.join("\r\n")}\r\n`, warnings, records: document.records.length, lossReport, previewRows };
}

function quoteCsv(value: string, delimiter: "," | ";"): string {
  return value.includes(delimiter) || /["\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

export function documentToCsv(document: CabrilloDocument | AdifDocument, delimiter: "," | ";" = ","): ConversionResult {
  if (document.format === "cabrillo") {
    const headers = ["FREQUENCY", "MODE", "QSO_DATE", "TIME_ON", "MY_CALL", "CALL", "RST_SENT", "STX", "RST_RCVD", "SRX"];
    const rows = document.lines.filter((line) => line.qso).map((line) => {
      const qso = line.qso!;
      return [qso.frequency, qso.mode, qso.date, qso.time, qso.myCall, qso.call, qso.sentRst, qso.sentExchange, qso.receivedRst, qso.receivedExchange].map((value) => quoteCsv(value, delimiter)).join(delimiter);
    });
    return { content: `${headers.join(delimiter)}\r\n${rows.join("\r\n")}\r\n`, warnings: [], records: rows.length };
  }
  const headers = [...new Set(document.records.flatMap((record) => record.tags.map((entry) => entry.name)))];
  const rows = document.records.map((record) => headers.map((header) => quoteCsv(adifValue(record, header), delimiter)).join(delimiter));
  return { content: `${headers.join(delimiter)}\r\n${rows.join("\r\n")}\r\n`, warnings: [], records: rows.length };
}
