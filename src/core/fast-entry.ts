import { validAdifDate, validAdifTime } from "./adif-schema";
import { bandFromFrequency, isPlausibleCallsign } from "./radio";

export interface FastEntryDefaults { date?: string; time?: string; frequency?: string; band?: string; mode?: string; stationProfile?: string; activity?: string; serial?: number }
export interface FastEntryRecord { line: number; source: string; valid: boolean; errors: string[]; values: Record<string, string>; inherited: string[] }
export interface FastEntryResult { records: FastEntryRecord[]; defaults: FastEntryDefaults }

function normalizedDate(value: string): string { return value.replaceAll("-", "").replaceAll("/", ""); }
function nextDate(value: string): string { const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`; const date = new Date(`${iso}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10).replaceAll("-", ""); }

/**
 * Tokens are explicit KEY=VALUE pairs. Bare tokens are accepted only for a
 * callsign and HHMM time. This keeps transcription predictable and reversible.
 */
export function parseFastEntry(source: string, initial: FastEntryDefaults = {}): FastEntryResult {
  const defaults = { ...initial }; const records: FastEntryRecord[] = []; let previousTime = defaults.time ?? "";
  source.split(/\r\n|\n|\r/).forEach((raw, lineIndex) => {
    const sourceLine = raw.trim(); if (!sourceLine || sourceLine.startsWith("#")) return;
    const values: Record<string, string> = {}; const errors: string[] = []; const inherited: string[] = [];
    const noteMatch = /(?:^|\s)NOTE=("[^"]*"|.*)$/i.exec(sourceLine); const working = noteMatch ? sourceLine.slice(0, noteMatch.index).trim() : sourceLine; if (noteMatch) values.NOTES = noteMatch[1]!.replace(/^"|"$/g, "");
    for (const token of working.split(/\s+/)) {
      const pair = /^([A-Z_]+)=(.*)$/i.exec(token); if (pair) { const key = pair[1]!.toUpperCase(); const value = pair[2]!; if (["DATE", "TIME", "CALL", "BAND", "FREQ", "MODE", "RST_S", "RST_R", "STX", "SRX", "PROFILE", "ACT"].includes(key)) values[key] = value; else errors.push(`Unknown token ${key}.`); }
      else if (/^(?:[01]\d|2[0-3])[0-5]\d(?:[0-5]\d)?$/.test(token) && !values.TIME) values.TIME = token;
      else if (isPlausibleCallsign(token) && !values.CALL) values.CALL = token.toUpperCase();
      else errors.push(`Cannot interpret “${token}”.`);
    }
    if (values.DATE) defaults.date = normalizedDate(values.DATE);
    for (const key of ["TIME", "FREQ", "BAND", "MODE", "PROFILE", "ACT"] as const) if (values[key]) (defaults as Record<string, unknown>)[key.toLowerCase() === "freq" ? "frequency" : key.toLowerCase()] = values[key];
    const carry: Array<[string, keyof FastEntryDefaults]> = [["DATE", "date"], ["FREQ", "frequency"], ["BAND", "band"], ["MODE", "mode"], ["PROFILE", "stationProfile"], ["ACT", "activity"]];
    for (const [field, key] of carry) if (!values[field] && defaults[key] !== undefined) { values[field] = String(defaults[key]); inherited.push(field); }
    if (!values.TIME && defaults.time) { values.TIME = defaults.time; inherited.push("TIME"); }
    if (previousTime && values.TIME && values.TIME < previousTime && Number(previousTime.slice(0, 2)) >= 20 && Number(values.TIME.slice(0, 2)) <= 4 && defaults.date && validAdifDate(defaults.date)) { defaults.date = nextDate(defaults.date); values.DATE = defaults.date; inherited.push("DATE_ROLLOVER"); }
    previousTime = values.TIME ?? previousTime; defaults.time = values.TIME ?? defaults.time;
    if (!values.STX && defaults.serial !== undefined) values.STX = String(defaults.serial).padStart(3, "0");
    if (values.STX && /^\d+$/.test(values.STX)) defaults.serial = Number(values.STX) + 1;
    if (!values.CALL) errors.push("CALL is required."); else if (!isPlausibleCallsign(values.CALL)) errors.push("CALL looks invalid.");
    if (!values.DATE || !validAdifDate(values.DATE)) errors.push("DATE must be YYYYMMDD or YYYY-MM-DD.");
    if (!values.TIME || !validAdifTime(values.TIME)) errors.push("TIME must be HHMM or HHMMSS UTC.");
    if (!values.MODE) errors.push("MODE is required.");
    if (!values.BAND && !values.FREQ) errors.push("BAND or FREQ is required.");
    if (values.FREQ && !bandFromFrequency(String(Number(values.FREQ) * (Number(values.FREQ) < 1000 ? 1000 : 1)))) errors.push("FREQ is outside a recognized amateur band.");
    records.push({ line: lineIndex + 1, source: raw, valid: errors.length === 0, errors, values, inherited });
  });
  return { records, defaults };
}

function tag(name: string, value: string): string { return value ? `<${name}:${value.length}>${value}` : ""; }
export function fastEntryToAdif(result: FastEntryResult): string {
  const map: Record<string, string> = { DATE: "QSO_DATE", TIME: "TIME_ON", CALL: "CALL", BAND: "BAND", FREQ: "FREQ", MODE: "MODE", RST_S: "RST_SENT", RST_R: "RST_RCVD", STX: "STX", SRX: "SRX", NOTES: "NOTES" };
  return `<ADIF_VER:5>3.1.7\r\n<PROGRAMID:13>LOG_WORKBENCH\r\n<EOH>\r\n${result.records.filter((record) => record.valid).map((record) => `${Object.entries(record.values).flatMap(([key, value]) => key === "ACT" ? [tag("MY_SIG", /^(?:K|VE)-\d/i.test(value) ? "POTA" : "ACTIVITY"), tag("MY_SIG_INFO", value)] : map[key] ? [tag(map[key]!, value)] : []).join(" ")} <EOR>`).join("\r\n")}\r\n`;
}
