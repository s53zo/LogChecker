import type { BuiltinImportPreset, CanonicalRecord, ImportColumn, ImportIssue, ImportOptions, ImportRow, ImportSession, NormalizedImport, ParsingCandidate } from "./ingestion-types";
import { assertImportSource, assertImportSize, IMPORT_MAX_ROWS as MAX_ROWS, IMPORT_MAX_COLUMNS as MAX_COLUMNS, IMPORT_MAX_CELLS } from './import-limits';
export type * from "./ingestion-types";

export const INGESTION_FIELDS = ["", "QSO_DATE", "TIME_ON", "FREQ", "BAND", "MODE", "SUBMODE", "CALL", "STATION_CALLSIGN", "RST_SENT", "RST_RCVD", "STX", "SRX", "STX_STRING", "SRX_STRING", "MY_GRIDSQUARE", "GRIDSQUARE", "QSO_POINTS", "COMMENT", "OPERATOR", "EDI_NEW_WWL", "EDI_NEW_EXCHANGE", "EDI_NEW_DXCC", "EDI_DUPLICATE"] as const;
const aliases: Record<string, string> = { date: "QSO_DATE", qsodate: "QSO_DATE", time: "TIME_ON", timeon: "TIME_ON", utc: "TIME_ON", freq: "FREQ", frequency: "FREQ", frequencykhz: "FREQ", frequencymhz: "FREQ", band: "BAND", mode: "MODE", submode: "SUBMODE", call: "CALL", callsign: "CALL", contactedcall: "CALL", mycall: "STATION_CALLSIGN", stationcallsign: "STATION_CALLSIGN", stationcall: "STATION_CALLSIGN", snt: "RST_SENT", sent: "RST_SENT", rstsent: "RST_SENT", rcvd: "RST_RCVD", received: "RST_RCVD", rstrcvd: "RST_RCVD", rstreceived: "RST_RCVD", stx: "STX", srx: "SRX", sentserial: "STX", serialsent: "STX", receivedserial: "SRX", serialreceived: "SRX", stxstring: "STX_STRING", srxstring: "SRX_STRING", sentexchange: "STX_STRING", receivedexchange: "SRX_STRING", mygrid: "MY_GRIDSQUARE", mygridsquare: "MY_GRIDSQUARE", mylocator: "MY_GRIDSQUARE", grid: "GRIDSQUARE", gridsquare: "GRIDSQUARE", locator: "GRIDSQUARE", pts: "QSO_POINTS", points: "QSO_POINTS", qsopoints: "QSO_POINTS", comment: "COMMENT", comments: "COMMENT", notes: "COMMENT", operator: "OPERATOR" };
const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const alias = (s: string) => aliases[key(s)] ?? (INGESTION_FIELDS.includes(s as typeof INGESTION_FIELDS[number]) ? s : "");
export const BUILTIN_IMPORT_PRESETS: BuiltinImportPreset[] = [{
  id: "grouped-vhf-exchanges", name: "VHF grouped sent and received exchanges",
  signatures: [["mycall", "snt exchange", "rcvd exchange"], ["station sent exchange", "contact received exchange"]],
  strategies: ["whitespace", "fixed-width"], headerAliases: { ...aliases },
  fields: ["QSO_DATE", "TIME_ON", "FREQ", "MODE", "STATION_CALLSIGN", "RST_SENT", "STX", "MY_GRIDSQUARE", "CALL", "RST_RCVD", "SRX", "GRIDSQUARE", "QSO_POINTS", "COMMENT"],
  transforms: { FREQ: { frequencyUnit: "auto" }, QSO_DATE: { dateOrder: "auto" } }, confidence: .98,
  applicableFormats: ["adif", "cabrillo", "edi", "csv"],
}];
const isCall = (s: string) => /^(?=.{3,20}$)(?=.*[A-Z])(?=.*\d)[A-Z0-9]+(?:\/[A-Z0-9]+)*$/.test(s.toUpperCase()) && !/^\d+$/.test(s) && !isGrid(s);
const isGrid = (s: string) => /^[A-R]{2}\d{2}(?:[A-X]{2}(?:\d{2})?)?$/i.test(s);
const isDate = (s: string) => /^(?:\d{8}|\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{4})$/.test(s);
const isTime = (s: string) => /^(?:[0-2]\d[0-5]\d(?:[0-5]\d)?|[0-2]?\d:[0-5]\d(?::[0-5]\d)?)(?:Z)?$/i.test(s);
const isMode = (s: string) => /^(USB|LSB|SSB|PHONE|PH|CW|FM|AM|FT8|FT4|RTTY|PSK31|DG|DIGI|DIGITAL)$/i.test(s);
const evidence = (s: string) => isDate(s) || isTime(s) || isGrid(s) || isCall(s) || isMode(s);

/** RFC-style delimiter scanner: quoted newlines and escaped quotes stay in one record. */
function delimited(source: string, delimiter: string): ImportRow[] {
  const rows: ImportRow[] = []; let cells: string[] = [], cell = "", quoted = false, closed = false, start = 0, line = 0, startLine = 0, totalCells = 0; let errors = new Set<string>();
  const push = (end: number) => { cells.push(cell); totalCells += cells.length; if (totalCells > IMPORT_MAX_CELLS) throw new Error(`Input exceeds ${IMPORT_MAX_CELLS} editable cells.`); assertImportSize(rows.length + 1, 1); if (quoted) errors.add("Unclosed quoted field; review the record boundary."); rows.push({ ...row(rows.length, startLine, source.slice(start, end), cells, quoted ? ["Unclosed quoted field; review the record boundary."] : []), errors: [...errors] }); cells = []; cell = ""; closed = false; errors = new Set(); };
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
    if (ch === '"') {
      if (quoted && source[i + 1] === '"') { cell += '"'; i++; }
      else if (quoted) { quoted = false; closed = true; }
      else if (!cell && !closed) quoted = true;
      else { errors.add("Unexpected quote inside an unquoted field; repair the source quoting or choose another interpretation."); cell += ch; }
    }
    else if (!quoted && ch === delimiter) { cells.push(cell); cell = ""; closed = false; if (cells.length >= MAX_COLUMNS) throw new Error(`Input exceeds ${MAX_COLUMNS} columns.`); }
    else if (ch === "\n" || ch === "\r") { const crlf = ch === "\r" && source[i + 1] === "\n"; if (quoted) cell += crlf ? "\r\n" : ch; else { push(i); start = i + (crlf ? 2 : 1); startLine = line + 1; } if (crlf) i++; line++; }
    else { if (closed && !quoted && !/\s/.test(ch)) errors.add("Unexpected text after a closing quote; repair the source quoting or choose another interpretation."); cell += ch; }
    if (rows.length > MAX_ROWS) throw new Error(`Input exceeds ${MAX_ROWS} records.`);
  }
  if (start < source.length) push(source.length);
  return rows;
}
function row(index: number, sourceIndex: number, original: string, cells: string[], warnings: string[] = []): ImportRow { return { id: `import-row-${index}`, sourceIndex, original, cells, originalCells: [...cells], kind: "qso", included: true, warnings }; }
function parse(source: string, candidate: ParsingCandidate): ImportRow[] {
  if (candidate.strategy === "delimited") return delimited(source, candidate.delimiter!);
  const lines = source.split(/\r\n|\r|\n/); if (lines.at(-1) === "") lines.pop();
  if (lines.length > MAX_ROWS) throw new Error(`Input exceeds ${MAX_ROWS} records.`);
  let totalCells = 0;
  return lines.map((line, i) => { const bounds = [0, ...(candidate.boundaries ?? []), line.length]; const cells = candidate.strategy === "fixed-width" ? bounds.slice(0, -1).map((start, j) => line.slice(start, bounds[j + 1])) : line.trim().split(/\s+/); if (cells.length > MAX_COLUMNS) throw new Error(`Input exceeds ${MAX_COLUMNS} columns.`); totalCells += cells.length; if (totalCells > IMPORT_MAX_CELLS) throw new Error(`Input exceeds ${IMPORT_MAX_CELLS} editable cells.`); return row(i, i, line, cells); });
}
function boundaries(source: string): number[] {
  const lines = source.split(/\r\n|\r|\n/).filter(s => /\d/.test(s) && s.trim().split(/\s+/).length >= 4).slice(0, 100);
  if (lines.length < 2) return [];
  const width = Math.min(2000, ...lines.map(s => s.length)); const result: number[] = []; let inGap = false;
  for (let i = 1; i < width; i++) { const gap = lines.every(s => /\s/.test(s[i] ?? " ")); if (inGap && !gap) result.push(i); inGap = gap; }
  return result.slice(0, MAX_COLUMNS - 1);
}
function assess(rows: ImportRow[], candidate: ParsingCandidate): ParsingCandidate {
  const active = rows.filter(r => r.original.trim() && !/^\s*[#;]/.test(r.original)).slice(0, 200);
  const counts = new Map<number, number>(); active.forEach(r => counts.set(r.cells.length, (counts.get(r.cells.length) ?? 0) + 1));
  const [width = 0, count = 0] = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0] ?? [];
  const recognized = active.reduce((n, r) => n + r.cells.filter(c => evidence(c.trim())).length, 0);
  const headers = active.reduce((n, r) => Math.max(n, r.cells.filter(c => alias(c.trim())).length), 0);
  const score = width < 2 ? 0 : Math.min(100, count / Math.max(1, active.length) * 35 + recognized / Math.max(1, active.length * width) * 45 + Math.min(20, headers * 3));
  return { ...candidate, width, score: Math.round(score * 100) / 100, reasons: [`${count}/${active.length} sampled rows have ${width} fields.`, `${recognized} recognizable values; ${headers} recognized headings.`] };
}

export function detectImport(source: string, options: ImportOptions = {}): ImportSession {
  assertImportSource(source);
  const clean = source.replace(/^\uFEFF/, "");
  const specs: ParsingCandidate[] = ["\t", ";", ",", "|"].map((delimiter, i) => ({ id: `delimiter-${i}`, strategy: "delimited", delimiter, score: 0, reasons: [], width: 0 }));
  specs.push({ id: "whitespace", strategy: "whitespace", score: 0, reasons: [], width: 0 });
  const inferred = options.boundaries ?? boundaries(clean);
  specs.push({ id: "fixed-width", strategy: "fixed-width", boundaries: [...new Set(inferred.filter(n => Number.isInteger(n) && n > 0 && n <= 10000))].sort((a, b) => a - b), score: 0, reasons: [], width: 0 });
  if (options.strategy === "delimited" && options.delimiter && !specs.some(s => s.delimiter === options.delimiter)) { if (options.delimiter.length !== 1) throw new Error("Choose a single-character delimiter."); specs.push({ id: "delimiter-custom", strategy: "delimited", delimiter: options.delimiter, score: 0, reasons: [], width: 0 }); }
  // Score bounded samples; only the selected interpretation is materialized for the full source.
  const sample = clean.slice(0, 100_000);
  const candidates = specs.map(c => {
    try { return assess(parse(sample, c), c); }
    catch (error) { return { ...c, score: -1, reasons: [error instanceof Error ? error.message : "This interpretation exceeds parsing limits."] }; }
  }).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const chosen = candidates.find(c => options.strategy && options.strategy !== "auto" && c.strategy === options.strategy && (c.strategy !== "delimited" || !options.delimiter || c.delimiter === options.delimiter)) ?? candidates[0]!;
  const rows = parse(clean, chosen);
  const header = options.headerRow === null ? undefined : options.headerRow !== undefined ? rows.find(r => r.sourceIndex === options.headerRow) : rows.slice(0, 30).find(r => r.cells.filter(c => alias(c.trim())).length >= 2 && !r.cells.some(c => isDate(c.trim())));
  const headerKey = header?.original.trim();
  const mappedQso = (r: ImportRow) => header && ['QSO_DATE', 'TIME_ON', 'CALL'].filter(field => header.cells.some((name, i) => alias(name.trim()) === field && Boolean(r.cells[i]?.trim()))).length >= 2;
  rows.forEach(r => { const text = r.original.trim(); if (!text) r.kind = "blank"; else if (r === header || (headerKey && text === headerKey)) r.kind = "header"; else if (mappedQso(r)) r.kind = "qso"; else if (/^(?:[-=_*]{3,}|#|\/\/)/.test(text)) r.kind = "comment"; else if (/^(?:total\b|summary\b|page\s+\d|\d+\s+qsos?\b)/i.test(text)) r.kind = "summary"; else if (/^[A-Za-z][\w -]{1,35}\s*[:=]/.test(text) && !r.cells.some(c => isDate(c.trim()))) r.kind = "metadata"; r.included = r.kind === "qso"; });
  const normalizedHeader = header?.original.toLowerCase().replace(/\s+/g, " ") ?? "";
  const preset = BUILTIN_IMPORT_PRESETS.find(p => p.strategies.includes(chosen.strategy) && p.signatures.some(signature => signature.every(part => normalizedHeader.includes(part))));
  const grouped = Boolean(preset);
  if (grouped) rows.forEach(r => { if (/YYYYMMDD\s+HHMM/i.test(r.original) && !r.cells.some(c => /^\d{8}$/.test(c))) { r.kind = "header"; r.included = false; } });
  const tail = preset?.fields.at(-1) === "COMMENT" ? preset.fields.length - 1 : header?.cells.length && alias(header.cells.at(-1)!.trim()) === "COMMENT" ? header.cells.length - 1 : undefined;
  if (tail !== undefined && chosen.strategy === "whitespace") rows.forEach(r => { if (r.included && r.cells.length > tail + 1) { const tokens = [...r.original.matchAll(/\S+/g)]; const comment = r.original.slice(tokens[tail]?.index ?? r.original.length).trimEnd(); r.cells = [...r.cells.slice(0, tail), comment]; r.originalCells = [...r.cells]; } });
  const data = rows.filter(r => r.included); const width = Math.min(MAX_COLUMNS, Math.max(header?.cells.length ?? 0, ...data.slice(0, 200).map(r => r.cells.length)));
  assertImportSize(rows.length, preset ? Math.max(preset.fields.length, width) : width);
  if (rows.reduce((count, r) => count + r.cells.length, 0) > IMPORT_MAX_CELLS) throw new Error(`Input exceeds ${IMPORT_MAX_CELLS} editable cells.`);
  const columns: ImportColumn[] = Array.from({ length: preset ? Math.max(preset.fields.length, width) : width }, (_, i) => { const name = preset ? preset.fields[i] ?? `COLUMN_${i + 1}` : header?.cells[i]?.trim() || `COLUMN_${i + 1}`; const field = preset?.headerAliases[key(name)] ?? alias(name); return { id: `import-column-${i}`, name, field, confidence: field ? preset?.confidence ?? .98 : 0, reasons: field ? [preset ? `Matched preset: ${preset.name}.` : "Recognized header alias."] : [], transform: { frequencyUnit: /khz/i.test(name) ? "kHz" : /mhz/i.test(name) ? "MHz" : "auto", dateOrder: "auto", ...preset?.transforms[field] } }; });
  inferColumns(columns, rows.filter(r => r.included));
  rows.forEach(r => { if (r.included && r.cells.length < columns.length && !(columns.at(-1)?.field === "COMMENT" && r.cells.length === columns.length - 1)) r.warnings.push(`Found ${r.cells.length} cells for ${columns.length} columns; check missing or shifted values.`); });
  const metadata: Record<string, string> = {}; rows.filter(r => r.kind === "metadata").forEach(r => { const m = /^\s*([^:=]+)[:=]\s*(.*)$/.exec(r.original); if (m) { const name = m[1]!.trim(), value = m[2]!.trim(); metadata[name] = value; if (["timezone", "timestandard", "utcstatus"].includes(key(name)) && /^(UTC|GMT|Z)$/i.test(value)) metadata.UTC_STATUS = "UTC"; } });
  if (header?.cells.some(c => key(c) === "utc")) metadata.UTC_STATUS = "UTC";
  return { source, options, candidates, selectedCandidateId: chosen.id, columns, rows, metadata, warnings: chosen.score < 50 ? ["Structure confidence is low; review the selected interpretation and mappings."] : [] };
}

function inferColumns(columns: ImportColumn[], data: ImportRow[]): void {
  const used = new Set(columns.map(c => c.field));
  columns.forEach((column, i) => {
    if (column.field) return; const values = data.slice(0, 100).map(r => r.cells[i]?.trim() ?? "").filter(Boolean); if (!values.length) return;
    const ratio = (test: (s: string) => boolean) => values.filter(test).length / values.length;
    let field = "";
    if (ratio(isDate) > .8) field = "QSO_DATE";
    else if (ratio(isMode) > .8) field = "MODE";
    else if (ratio(s => /^\d+[.,]\d+$/.test(s) && [1, 1000, 1_000_000].some(div => frequencyBand(Number(s.replace(",", ".")) / div))) > .8) field = "FREQ";
    else if (ratio(isTime) > .8 && columns.some(c => c.field === "QSO_DATE")) field = "TIME_ON";
    else if (ratio(isCall) > .8 && columns.filter((_, j) => data.slice(0, 100).filter(r => isCall(r.cells[j]?.trim() ?? "")).length > data.slice(0, 100).length * .8).length === 1) field = "CALL";
    else if (ratio(isGrid) > .8 && columns.filter((_, j) => data.slice(0, 100).filter(r => isGrid(r.cells[j]?.trim() ?? "")).length > data.slice(0, 100).length * .8).length === 1) field = "GRIDSQUARE";
    if (field && !used.has(field)) { column.field = field; column.confidence = .85; column.reasons = ["Inferred from consistent sampled values; review this suggestion."]; used.add(field); }
    else { column.reasons = ["Meaning is ambiguous; assign this column explicitly."]; }
  });
}

export function selectImportCandidate(session: ImportSession, id: string): ImportSession {
  const candidate = session.candidates.find(c => c.id === id); if (!candidate) return session;
  return detectImport(session.source, { ...session.options, strategy: candidate.strategy, delimiter: candidate.delimiter, boundaries: candidate.boundaries });
}

const bandRanges: Array<[number, number, string]> = [[1.8, 2, "160M"], [3.5, 4, "80M"], [5, 5.5, "60M"], [7, 7.3, "40M"], [10.1, 10.15, "30M"], [14, 14.35, "20M"], [18.068, 18.168, "17M"], [21, 21.45, "15M"], [24.89, 24.99, "12M"], [28, 29.7, "10M"], [50, 54, "6M"], [70, 71, "4M"], [144, 148, "2M"], [222, 225, "1.25M"], [420, 450, "70CM"], [902, 928, "33CM"], [1240, 1300, "23CM"], [2300, 2450, "13CM"], [3300, 3500, "9CM"], [5650, 5925, "6CM"], [10000, 10500, "3CM"]];
export const frequencyBand = (mhz: number): string => bandRanges.find(([a, b]) => mhz >= a && mhz <= b)?.[2] ?? "";

export function normalizeImport(session: ImportSession): NormalizedImport {
  assertImportSize(session.rows.length, session.columns.length);
  const allIssues: ImportIssue[] = []; const seen = new Set<string>();
  const records = session.rows.filter(r => r.included).map(r => {
    const record: CanonicalRecord = { id: r.id, sourceIndex: r.sourceIndex, original: r.original, values: {}, provenance: {}, unmapped: {}, issues: [] };
    const issue = (code: string, message: string, field?: string, severity: "error" | "warning" = "error") => record.issues.push({ code, message, severity, rowId: r.id, field });
    r.warnings.filter(w => !/^Found \d+ cells for \d+ columns;/.test(w)).forEach(w => issue("structure", w, undefined, "warning"));
    // The grouped whitespace report explicitly has an optional final comment.
    // Delimited rows must include the final delimiter: a short numeric exchange
    // row can otherwise be mistaken for an absent comment and shift serials.
    const groupedWhitespace = session.candidates.find(c => c.id === session.selectedCandidateId)?.strategy === "whitespace" && session.columns.some(c => c.reasons.some(reason => reason.startsWith("Matched preset:")));
    const absentTrailingComment = groupedWhitespace && session.columns.at(-1)?.field === "COMMENT" && r.cells.length === session.columns.length - 1 && session.columns.slice(0, -1).every((c, i) => c.field && (r.cells[i] ?? "").trim());
    if (r.cells.length < session.columns.length && !absentTrailingComment) issue("structure", `Found ${r.cells.length} cells for ${session.columns.length} columns; repair missing or shifted cells before export.`);
    r.errors?.forEach(message => issue("malformed-record", message));
    session.columns.forEach((c, i) => {
      const original = r.originalCells ? r.originalCells[i] ?? "" : r.cells[i] ?? ""; if (!c.field) { record.unmapped[c.id] = original; return; }
      if (!/^[A-Z][A-Z0-9_]*$/.test(c.field)) { issue("invalid-mapping", "Field names must use uppercase letters, numbers and underscores."); return; }
      let value = c.transform.constant ?? r.cells[i] ?? ""; const transformations: string[] = [];
      if ((r.cells[i] ?? "") !== original) transformations.push("User edited the source cell");
      if (c.transform.constant !== undefined) transformations.push("User-supplied constant");
      if (value !== value.trim()) transformations.push("Trimmed surrounding whitespace"); value = value.trim();
      if (!value) return;
      const field = c.field;
      if (["CALL", "STATION_CALLSIGN", "GRIDSQUARE", "MY_GRIDSQUARE", "MODE", "SUBMODE", "BAND", "OPERATOR"].includes(field) || c.transform.uppercase) { if (value !== value.toUpperCase()) transformations.push("Normalized letter case"); value = value.toUpperCase(); }
      if (field === "QSO_DATE") {
        let parts: string[] | undefined;
        if (/^\d{8}$/.test(value)) parts = [value.slice(0, 4), value.slice(4, 6), value.slice(6)];
        else if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(value)) parts = value.split(/[-/.]/);
        else if (/^\d{1,2}[-/.]\d{1,2}[-/.]\d{4}$/.test(value)) { const [a = "", b = "", y = ""] = value.split(/[-/.]/); const order = c.transform.dateOrder; if (order === "dmy" || (order !== "mdy" && Number(a) > 12)) parts = [y, b, a]; else if (order === "mdy" || Number(b) > 12) parts = [y, a, b]; else issue("ambiguous-date", "Choose day/month order for this date.", field); }
        if (parts) { const [y = "", m = "", d = ""] = parts; const date = new Date(`${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}T00:00:00Z`); if (!Number.isFinite(date.getTime()) || date.getUTCMonth() + 1 !== Number(m) || date.getUTCDate() !== Number(d)) issue("invalid-date", "Invalid calendar date.", field); else { const next = `${y}${m.padStart(2, "0")}${d.padStart(2, "0")}`; if (next !== value) transformations.push("Normalized date to YYYYMMDD"); value = next; } }
        else if (!record.issues.some(e => e.field === field)) issue("invalid-date", "Unsupported date; choose a format or edit the value.", field);
      }
      if (field === "TIME_ON") { const clock = /^(\d{1,2}):(\d{2})(?::(\d{2}))?Z?$/i.exec(value); value = clock ? `${clock[1]!.padStart(2, "0")}${clock[2]}${clock[3] ?? ""}` : value.replace(/Z$/i, ""); if (!/^\d{4}(?:\d{2})?$/.test(value) || Number(value.slice(0, 2)) > 23 || Number(value.slice(2, 4)) > 59 || Number(value.slice(4) || 0) > 59) issue("invalid-time", "Time must be a valid HHMM or HHMMSS value.", field); if (value !== original.trim()) transformations.push("Normalized time punctuation"); }
      if (field === "FREQ") { const decimal = value.replace(",", "."); const n = Number(decimal); if (!/^\d+(?:\.\d+)?$/.test(decimal) || !Number.isFinite(n) || n <= 0) issue("invalid-frequency", "Frequency must be a positive number.", field); else { let unit = c.transform.frequencyUnit ?? "auto"; if (unit === "auto") { const possible = ([1, 1000, 1_000_000] as const).filter(div => frequencyBand(n / div)); if (possible.length === 1) unit = possible[0] === 1 ? "MHz" : possible[0] === 1000 ? "kHz" : "Hz"; else { issue("ambiguous-frequency", "Select the frequency unit explicitly.", field); unit = "MHz"; } } const divisor = unit === "Hz" ? 1_000_000 : unit === "kHz" ? 1000 : 1; value = String(Number((n / divisor).toFixed(9))); if (value !== original.trim()) transformations.push(`Converted ${unit} to MHz; normalized decimal notation`); } }
      if (field === "MODE") { const modes: Record<string, string> = { USB: "SSB", LSB: "SSB", PHONE: "SSB", PH: "SSB", DG: "DIGITAL", DIGI: "DIGITAL" }; if (modes[value]) { transformations.push(`Mapped mode ${value} to ${modes[value]}`); value = modes[value]!; } }
      if (["CALL", "STATION_CALLSIGN"].includes(field) && !isCall(value)) issue("invalid-call", "Unrecognized callsign; inspect the original value.", field);
      if (["GRIDSQUARE", "MY_GRIDSQUARE"].includes(field) && !isGrid(value)) issue("invalid-locator", "Invalid Maidenhead locator.", field);
      if (["STX", "SRX", "QSO_POINTS"].includes(field) && !/^\d+$/.test(value)) issue("invalid-number", "Expected a non-negative integer; free-form exchanges use exchange fields.", field);
      if (["RST_SENT", "RST_RCVD"].includes(field) && !/^[1-5][1-9][1-9]?$/.test(value) && !/^[+-]\d{1,2}$/.test(value)) issue("invalid-report", "Unrecognized signal report.", field);
      if (record.values[field] !== undefined && record.values[field] !== value) issue("duplicate-mapping", "Multiple columns map conflicting values to this field.", field);
      else record.values[field] = value;
      (record.provenance[field] ??= []).push({ columnId: c.id, sourceIndex: r.sourceIndex, original, normalized: value, confidence: c.confidence, transformations });
    });
    for (const mode of record.provenance.MODE ?? []) {
      const derived = /^Mapped mode (USB|LSB) to SSB$/.exec(mode.transformations.find(change => /^Mapped mode (USB|LSB) to SSB$/.test(change)) ?? '')?.[1];
      if (!derived) continue;
      if (record.values.SUBMODE && record.values.SUBMODE !== derived) issue('submode-conflict', 'Explicit submode conflicts with the sideband supplied in MODE.', 'SUBMODE');
      else record.values.SUBMODE = derived;
      (record.provenance.SUBMODE ??= []).push({ ...mode, normalized: derived, transformations: [...mode.transformations, 'Derived submode from supplied mode alias'] });
    }
    const freq = record.values.FREQ; const band = freq ? frequencyBand(Number(freq)) : "";
    if (band && !record.values.BAND && !record.issues.some(i => i.field === "FREQ")) { record.values.BAND = band; record.provenance.BAND = [{ columnId: "derived", sourceIndex: r.sourceIndex, original: freq!, normalized: band, confidence: 1, transformations: ["Derived band from normalized frequency"] }]; }
    else if (band && record.values.BAND && band !== record.values.BAND) issue("band-conflict", "Band conflicts with normalized frequency.", "BAND");
    for (const field of ["QSO_DATE", "TIME_ON", "CALL", "MODE"]) if (!record.values[field] && !(field === "MODE" && /^[0-9]$/.test(record.values.EDI_MODE_CODE ?? ""))) issue("missing-field", `${field} is not mapped or is empty.`, field);
    if (!record.values.FREQ && !record.values.BAND) issue("missing-field", "Map frequency or band.", "FREQ");
    r.cells.slice(session.columns.length).forEach((v, i) => { record.unmapped[`extra-${i}`] = v; issue("extra-cell", "Extra cells are preserved but unmapped.", undefined, "warning"); });
    const signature = JSON.stringify(record.values); if (seen.has(signature)) issue("duplicate-row", "Identical normalized QSO; review before excluding or marking duplicate.", undefined, "warning"); seen.add(signature);
    for (const [field, items] of Object.entries(record.provenance)) for (const item of items) {
      const errors = record.issues.filter(issue => issue.field === field && issue.severity === "error");
      const column = session.columns.find(column => column.id === item.columnId);
      item.classification = errors.some(issue => /ambiguous|conflict|duplicate-mapping/.test(issue.code)) ? "ambiguous"
        : errors.length ? "unsupported"
        : item.transformations.some(change => change.startsWith("User")) ? "user-supplied"
        : (!column?.locked && item.confidence < .95) || (field === "FREQ" && column?.transform.frequencyUnit === "auto" && item.transformations.length > 0) ? "suggested-repair"
        : item.transformations.length ? "lossless-normalization" : "preserved";
    }
    allIssues.push(...record.issues); return record;
  });
  const metadata = { ...session.metadata };
  for (const field of ["STATION_CALLSIGN", "MY_GRIDSQUARE", "BAND"]) { const values = new Set(records.map(r => r.values[field]).filter(Boolean)); if (values.size === 1 && records.every(r => r.values[field])) metadata[field] ??= [...values][0]!; }
  return { records, metadata, issues: allIssues, warnings: [...session.warnings, ...(metadata.UTC_STATUS === "UTC" ? [] : ["Times have not been confirmed as UTC; no timezone conversion was applied."])] };
}
