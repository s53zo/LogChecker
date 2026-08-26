import { bandFromFrequency, frequencyFromBand, frequencyToKHz, frequencyToMHz } from "../radio";
import { cabrilloModeMap, deprecatedModeMap } from "../templates";

export type DateFormat = "YYYYMMDD" | "YYYY-MM-DD" | "YYYY.MM.DD" | "YYYY/MM/DD" | "DD-MMM-YYYY" | "DD/MM/YYYY" | "MM/DD/YYYY";
export type TimeFormat = "HHMM" | "HHMMSS" | "HH:MM" | "HH:MM:SS";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

function validParts(year: number, month: number, day: number): boolean {
  if (year < 1930 || month < 1 || month > 12 || day < 1) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function convertDateValue(value: string, from: DateFormat, to: "YYYYMMDD" | "YYYY-MM-DD"): string | null {
  const input = value.trim();
  let year = 0;
  let month = 0;
  let day = 0;
  let match: RegExpMatchArray | null = null;
  if (from === "YYYYMMDD" && (match = input.match(/^(\d{4})(\d{2})(\d{2})$/))) [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if (from === "YYYY-MM-DD" && (match = input.match(/^(\d{4})-(\d{2})-(\d{2})$/))) [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if (from === "YYYY.MM.DD" && (match = input.match(/^(\d{4})\.(\d{2})\.(\d{2})$/))) [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if (from === "YYYY/MM/DD" && (match = input.match(/^(\d{4})\/(\d{2})\/(\d{2})$/))) [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if (from === "DD/MM/YYYY" && (match = input.match(/^(\d{2})\/(\d{2})\/(\d{4})$/))) [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if (from === "MM/DD/YYYY" && (match = input.match(/^(\d{2})\/(\d{2})\/(\d{4})$/))) [month, day, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  else if (from === "DD-MMM-YYYY" && (match = input.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/))) {
    day = Number(match[1]);
    month = MONTHS.indexOf(match[2]!.toUpperCase()) + 1;
    year = Number(match[3]);
  } else return null;
  if (!validParts(year, month, day)) return null;
  const y = String(year).padStart(4, "0");
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return to === "YYYYMMDD" ? `${y}${m}${d}` : `${y}-${m}-${d}`;
}

export function convertTimeValue(value: string, from: TimeFormat, to: TimeFormat): string | null {
  const patterns: Record<TimeFormat, RegExp> = {
    HHMM: /^(\d{2})(\d{2})$/,
    HHMMSS: /^(\d{2})(\d{2})(\d{2})$/,
    "HH:MM": /^(\d{2}):(\d{2})$/,
    "HH:MM:SS": /^(\d{2}):(\d{2}):(\d{2})$/,
  };
  const match = value.trim().match(patterns[from]);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? 0);
  if (hour > 23 || minute > 59 || second > 59) return null;
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  const ss = String(second).padStart(2, "0");
  if (to === "HHMM") return `${hh}${mm}`;
  if (to === "HHMMSS") return `${hh}${mm}${ss}`;
  if (to === "HH:MM") return `${hh}:${mm}`;
  return `${hh}:${mm}:${ss}`;
}

export function shiftDateTime(dateValue: string, timeValue: string, minutes: number): { date: string; time: string } | null {
  const date = convertDateValue(dateValue, "YYYY-MM-DD", "YYYY-MM-DD");
  const time = timeValue.match(/^(\d{2})(\d{2})(\d{2})?$/);
  if (!date || !time || Number(time[1]) > 23 || Number(time[2]) > 59 || Number(time[3] ?? 0) > 59) return null;
  const instant = new Date(`${date}T${time[1]}:${time[2]}:${time[3] ?? "00"}Z`);
  instant.setUTCMinutes(instant.getUTCMinutes() + minutes);
  return {
    date: instant.toISOString().slice(0, 10),
    time: `${String(instant.getUTCHours()).padStart(2, "0")}${String(instant.getUTCMinutes()).padStart(2, "0")}${time[3] ? String(instant.getUTCSeconds()).padStart(2, "0") : ""}`,
  };
}

export function convertFrequencyValue(value: string, direction: "KHZ_TO_MHZ" | "MHZ_TO_KHZ" | "FREQ_TO_BAND" | "BAND_TO_FREQ"): string {
  if (direction === "KHZ_TO_MHZ") return frequencyToMHz(value);
  if (direction === "MHZ_TO_KHZ") return frequencyToKHz(value);
  if (direction === "FREQ_TO_BAND") return bandFromFrequency(value);
  return frequencyFromBand(value);
}

export function modeToCabrillo(value: string, overrides: Record<string, string> = {}): string {
  const mode = value.trim().toUpperCase();
  const mapped = overrides[mode] ?? deprecatedModeMap[mode] ?? mode;
  return cabrilloModeMap[mapped] ?? mapped;
}

export function modeToAdif(value: string): { mode: string; submode?: string } {
  const original = value.trim().toUpperCase();
  const direct: Record<string, string> = { PH: "SSB", RY: "RTTY", DG: "DATA", CO: "CONTESTI", DO: "DOMINO", HE: "HELL", MF: "MFSK", MK: "MFSK", OL: "OLIVIA", PS: "PSK", PM: "PSK", PO: "PSK", QM: "PSK", PT: "PAC", TH: "THRB", TV: "SSTV", AX: "PKT" };
  const mode = deprecatedModeMap[original] ?? direct[original] ?? original;
  return mode !== original && !direct[original] ? { mode, submode: original } : { mode };
}

export function normalizeSerialValue(value: string, width: number): string | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed) || width < 1) return null;
  return String(Number(trimmed)).padStart(width, "0");
}

export function cleanUnsafeWhitespace(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F\u0081\u008D\u008F\u0090\u009D\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/g, (char) => char === "\r" || char === "\n" || char === "\t" ? char : " ");
}
