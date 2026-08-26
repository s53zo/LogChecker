import { qsoColumns } from "./cabrillo";
import { bandFromFrequency, isPlausibleCallsign } from "./radio";
import type { CabrilloDocument, QsoCell } from "./types";

export interface PaperValidationIssue {
  index: number;
  key: string;
  message: string;
}

const REQUIRED_KEYS = new Set(["FREQUENCY", "MODE", "QSO_DATE", "TIME_ON", "MY_CALL", "CALL", "RST_SENT", "RST_RCVD"]);

function header(document: CabrilloDocument, key: string): string {
  return document.lines.find((line) => line.key === key)?.value?.trim() ?? "";
}

function modeDefault(document: CabrilloDocument): string {
  const value = header(document, "CATEGORY-MODE").toUpperCase();
  if (value === "SSB") return "PH";
  if (value === "RTTY") return "RY";
  if (value === "DIGITAL") return "DG";
  return /^(?:CW|PH|RY|DG|FM|AM)$/.test(value) ? value : "CW";
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function paperQsoColumns(document: CabrilloDocument, now = new Date()): QsoCell[] {
  const columns = qsoColumns(document.layout);
  const qsos = document.lines.flatMap((line) => line.qso ? [line.qso] : []);
  const last = qsos.at(-1);
  const lastValue = (key: string) => last?.cells.find((cell) => cell.key === key)?.value.trim() ?? "";
  const mode = last?.mode || modeDefault(document);
  const serialKey = columns.some((cell) => cell.key === "STX") ? "STX" : "STX_STRING";
  const serials = qsos.map((qso) => qso.cells.find((cell) => cell.key === serialKey)?.value.trim() ?? "").filter((value) => /^\d+$/.test(value));
  const serialWidth = Math.max(3, ...serials.map((value) => value.length));
  const nextSerial = String(Math.max(0, ...serials.map(Number)) + 1).padStart(serialWidth, "0");
  const rst = /^(?:PH|FM|AM)$/.test(mode.toUpperCase()) ? "59" : "599";
  const ownCall = header(document, "CALLSIGN") || last?.myCall || "";

  for (const cell of columns) {
    if (cell.key === "FREQUENCY") cell.value = last?.frequency || "14000";
    else if (cell.key === "MODE") cell.value = mode;
    else if (cell.key === "QSO_DATE") cell.value = now.toISOString().slice(0, 10);
    else if (cell.key === "TIME_ON") cell.value = now.toISOString().slice(11, 16).replace(":", "");
    else if (cell.key === "MY_CALL") cell.value = ownCall;
    else if (cell.key === "RST_SENT" || cell.key === "RST_RCVD") cell.value = lastValue(cell.key) || rst;
    else if (cell.key === serialKey) cell.value = nextSerial;
    else if (cell.key === "STX_STRING" || cell.key.startsWith("MY_")) cell.value = lastValue(cell.key);
    else cell.value = "";
  }
  return columns;
}

export function validatePaperQso(columns: readonly QsoCell[]): PaperValidationIssue[] {
  const issues: PaperValidationIssue[] = [];
  columns.forEach((cell, index) => {
    const value = cell.value.trim();
    const required = REQUIRED_KEYS.has(cell.key) || /^(?:STX|STX_STRING|SRX|SRX_STRING|GRIDSQUARE|MY_GRIDSQUARE)$/.test(cell.key);
    if (required && !value) issues.push({ index, key: cell.key, message: `${cell.label || cell.key} is required.` });
    if (value.length > cell.end - cell.start) issues.push({ index, key: cell.key, message: `${cell.label || cell.key} is ${value.length} characters; the recovered field allows ${cell.end - cell.start}.` });
    if ((cell.key === "CALL" || cell.key === "MY_CALL") && value && !isPlausibleCallsign(value)) issues.push({ index, key: cell.key, message: `${value} looks like an unusual callsign.` });
    if (cell.key === "FREQUENCY" && value && !bandFromFrequency(value)) issues.push({ index, key: cell.key, message: `${value} is not a recognized amateur band or frequency.` });
    if (cell.key === "MODE" && value && !/^(?:CW|PH|RY|DG|FM|AM)$/i.test(value)) issues.push({ index, key: cell.key, message: `${value} is not a Cabrillo mode.` });
    if (cell.key === "QSO_DATE" && value && !validDate(value)) issues.push({ index, key: cell.key, message: `${value} is not a valid YYYY-MM-DD date.` });
    if (cell.key === "TIME_ON" && value && !/^(?:[01]\d|2[0-3])[0-5]\d$/.test(value)) issues.push({ index, key: cell.key, message: `${value} is not a valid HHMM UTC time.` });
  });
  return issues;
}
