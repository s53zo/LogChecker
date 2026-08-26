import { getContestLayout } from "./templates";
import type {
  CabrilloDocument,
  CabrilloLine,
  ContestLayout,
  QsoCell,
  QsoData,
  QtcData,
} from "./types";

const COMMON_COLUMNS = [
  { key: "FREQUENCY", label: "Frequency", start: 5, end: 10 },
  { key: "MODE", label: "Mode", start: 11, end: 13 },
  { key: "QSO_DATE", label: "Date", start: 14, end: 24 },
  { key: "TIME_ON", label: "Time", start: 25, end: 29 },
] as const;

const QTC_COLUMNS: ReadonlyArray<Omit<QsoCell, "value">> = [
  { key: "FREQUENCY", label: "Frequency", start: 5, end: 10 },
  { key: "MODE", label: "Mode", start: 11, end: 13 },
  { key: "QSO_DATE", label: "Transfer date", start: 14, end: 24 },
  { key: "TIME_ON", label: "Transfer time", start: 25, end: 29 },
  { key: "CALL_RX", label: "QTC receiver", start: 30, end: 43 },
  { key: "QTC_GROUP", label: "QTC group", start: 44, end: 50 },
  { key: "CALL_TX", label: "QTC sender", start: 55, end: 68 },
  { key: "TIME_QSO", label: "Reported QSO time", start: 69, end: 73 },
  { key: "CALL_QSO", label: "Reported callsign", start: 74, end: 87 },
  { key: "NR_QSO", label: "Reported serial", start: 88, end: 92 },
];

function lineId(index: number, raw: string): string {
  let hash = 2166136261;
  for (const char of raw) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `line-${index + 1}-${(hash >>> 0).toString(36)}`;
}

function cellValue(raw: string, start: number, end: number): string {
  return raw.slice(start, end).trim();
}

export function qsoColumns(layout?: ContestLayout): QsoCell[] {
  const common: QsoCell[] = COMMON_COLUMNS.map((column) => ({ ...column, value: "" }));
  if (!layout) {
    return [
      ...common,
      { key: "MY_CALL", label: "My call", value: "", start: 30, end: 43 },
      { key: "RST_SENT", label: "Sent RST", value: "", start: 44, end: 47 },
      { key: "STX_STRING", label: "Sent exchange", value: "", start: 48, end: 54 },
      { key: "CALL", label: "Call", value: "", start: 55, end: 68 },
      { key: "RST_RCVD", label: "Rcvd RST", value: "", start: 69, end: 72 },
      { key: "SRX_STRING", label: "Rcvd exchange", value: "", start: 73, end: 79 },
    ];
  }

  let start = 30;
  const custom = layout.fields.map((field) => {
    const end = start + field.width;
    const cell: QsoCell = {
      key: field.key,
      label: field.key.replaceAll("_", " "),
      value: "",
      start,
      end,
      description: field.description,
    };
    start = end + 1;
    return cell;
  });
  return [...common, ...custom];
}

function inferQso(cells: QsoCell[]): QsoData {
  const get = (...keys: string[]) => cells.find((cell) => keys.includes(cell.key))?.value ?? "";
  const sentParts = cells
    .filter((cell) => ["STX", "STX_STRING"].includes(cell.key))
    .map((cell) => cell.value)
    .filter(Boolean);
  const receivedParts = cells
    .filter((cell) => ["SRX", "SRX_STRING", "GRIDSQUARE"].includes(cell.key))
    .map((cell) => cell.value)
    .filter(Boolean);
  return {
    frequency: get("FREQUENCY"),
    mode: get("MODE"),
    date: get("QSO_DATE"),
    time: get("TIME_ON"),
    cells,
    call: get("CALL"),
    myCall: get("MY_CALL"),
    sentRst: get("RST_SENT"),
    receivedRst: get("RST_RCVD"),
    sentExchange: sentParts.join(" "),
    receivedExchange: receivedParts.join(" "),
  };
}

export function parseQsoLine(raw: string, layout?: ContestLayout): QsoData {
  const columns = qsoColumns(layout);
  const fixedRaw = raw.startsWith("X-QSO:") ? raw.slice(2) : raw;
  const acceptsCompact = layout?.name.startsWith("DARC-WAEDC-");
  if (layout && fixedRaw.startsWith("QSO:") && (!acceptsCompact || isFixedWidthQso(fixedRaw, layout))) {
    const cells = columns.map((column) => ({
      ...column,
      value: cellValue(fixedRaw, column.start, column.end),
    }));
    return inferQso(cells);
  }

  const tokens = raw.replace(/^\s*X?-?QSO:\s*/i, "").trim().split(/\s+/);
  const values = tokens.slice(0, columns.length);
  const cells = columns.map((column, index) => ({ ...column, value: values[index] ?? "" }));
  return inferQso(cells);
}

export function isFixedWidthQso(raw: string, layout: ContestLayout): boolean {
  const fixedRaw = raw.startsWith("X-QSO:") ? raw.slice(2) : raw;
  return fixedRaw.length >= layout.minimumLength && layout.separators.every((position) => !fixedRaw[position] || /\s/.test(fixedRaw[position]!));
}

export function qtcColumns(): QsoCell[] {
  return QTC_COLUMNS.map((column) => ({ ...column, value: "" }));
}

function inferQtc(cells: QsoCell[]): QtcData {
  const get = (key: string) => cells.find((cell) => cell.key === key)?.value ?? "";
  return {
    frequency: get("FREQUENCY"), mode: get("MODE"), date: get("QSO_DATE"), time: get("TIME_ON"),
    receiver: get("CALL_RX"), group: get("QTC_GROUP"), sender: get("CALL_TX"),
    qsoTime: get("TIME_QSO"), qsoCall: get("CALL_QSO"), qsoSerial: get("NR_QSO"), cells,
  };
}

export function parseQtcLine(raw: string): QtcData {
  const columns = qtcColumns();
  if (isFixedWidthQtc(raw)) {
    return inferQtc(columns.map((column) => ({ ...column, value: cellValue(raw, column.start, column.end) })));
  }
  const tokens = raw.replace(/^\s*QTC:\s*/i, "").trim().split(/\s+/);
  return inferQtc(columns.map((column, index) => ({ ...column, value: tokens[index] ?? "" })));
}

export function isFixedWidthQtc(raw: string): boolean {
  return raw.length >= 89 &&
    /^\d{4}-\d{2}-\d{2}$/.test(raw.slice(14, 24)) &&
    /^(?:CW|PH|RY)$/.test(raw.slice(11, 13).trim().toUpperCase()) &&
    /^\d{1,3}\/(?:10|[1-9])$/.test(raw.slice(44, 50).trim());
}

export function formatQtc(qtc: QtcData): string {
  const values = new Map(qtc.cells.map((cell) => [cell.key, cell.value]));
  const chars = Array(92).fill(" ");
  [..."QTC:"].forEach((char, index) => { chars[index] = char; });
  for (const column of QTC_COLUMNS) {
    const width = column.end - column.start;
    const value = (values.get(column.key) ?? "").slice(0, width).padEnd(width);
    [...value].forEach((char, index) => { chars[column.start + index] = char; });
  }
  return chars.join("").trimEnd();
}

function parseLines(source: string, layout?: ContestLayout): CabrilloLine[] {
  const rawLines = source.split(/\r\n|\n|\r/);
  if (/(?:\r\n|\n|\r)$/.test(source)) rawLines.pop();
  return rawLines.map((raw, index) => {
    const base = { id: lineId(index, raw), lineNumber: index + 1, raw };
    if (!raw.trim()) return { ...base, type: "blank" };
    if (/^\s*(?:QSO|X-QSO):/i.test(raw)) {
      return { ...base, type: "qso", qso: parseQsoLine(raw, layout) };
    }
    if (/^\s*QTC:/i.test(raw)) {
      return { ...base, type: "qtc", key: "QTC", value: raw.replace(/^\s*QTC:\s*/i, ""), qtc: parseQtcLine(raw) };
    }
    if (/^\s*(?:#|;)/.test(raw)) return { ...base, type: "comment" };
    const header = raw.match(/^\s*([A-Z][A-Z0-9-]*):\s?(.*)$/i);
    if (header) {
      return {
        ...base,
        type: "header",
        key: header[1]!.toUpperCase(),
        value: header[2] ?? "",
      };
    }
    return { ...base, type: "unknown" };
  });
}

export function parseCabrillo(source: string): CabrilloDocument {
  const newline = source.includes("\r\n") ? "\r\n" : source.includes("\n") ? "\n" : source.includes("\r") ? "\r" : "\n";
  const firstPass = parseLines(source);
  const contest = firstPass.find((line) => line.key === "CONTEST")?.value?.trim().toUpperCase() ?? "GENERIC-CONTEST";
  const layout = getContestLayout(contest);
  return {
    format: "cabrillo",
    source,
    newline,
    trailingNewline: /(?:\r\n|\n|\r)$/.test(source),
    lines: parseLines(source, layout),
    contest,
    layout,
  };
}

export function serializeCabrillo(document: CabrilloDocument): string {
  const text = document.lines.map((line) => line.raw).join(document.newline);
  return text + (document.trailingNewline ? document.newline : "");
}

export function formatQso(qso: QsoData, layout?: ContestLayout, record = "QSO:"): string {
  const columns = qsoColumns(layout);
  const values = new Map(qso.cells.map((cell) => [cell.key, cell.value]));
  const targetLength = Math.max(layout?.lineLength ?? 79, ...columns.map((cell) => cell.end));
  const chars = Array(targetLength).fill(" ");
  [..."QSO:"].forEach((char, index) => { chars[index] = char; });
  for (const column of columns) {
    const width = column.end - column.start;
    const value = (values.get(column.key) ?? "").slice(0, width).padEnd(width);
    [...value].forEach((char, index) => { chars[column.start + index] = char; });
  }
  const result = chars.join("").trimEnd();
  return record === "X-QSO:" ? `X-${result}` : result;
}

export function updateHeader(document: CabrilloDocument, key: string, value: string): CabrilloDocument {
  const normalized = key.toUpperCase();
  const index = document.lines.findIndex((line) => line.key === normalized);
  const lines = document.lines.map((line) => ({ ...line }));
  const raw = `${normalized}: ${value}`;
  if (index >= 0 && lines[index]) {
    lines[index] = { ...lines[index], raw, value, dirty: true };
  } else {
    const insertAt = Math.max(1, lines.findIndex((line) => line.type === "qso"));
    lines.splice(insertAt, 0, {
      id: `line-new-${crypto.randomUUID()}`,
      lineNumber: insertAt + 1,
      raw,
      type: "header",
      key: normalized,
      value,
      dirty: true,
    });
  }
  lines.forEach((line, lineIndex) => { line.lineNumber = lineIndex + 1; });
  const next = { ...document, lines };
  if (normalized === "CONTEST") return parseCabrillo(serializeCabrillo(next));
  return next;
}

export function updateQsoCell(
  document: CabrilloDocument,
  lineIdValue: string,
  field: string,
  value: string,
): CabrilloDocument {
  const lines = document.lines.map((line) => {
    if (line.id !== lineIdValue || !line.qso) return line;
    const cells = line.qso.cells.map((cell) => cell.key === field ? { ...cell, value } : cell);
    const qso = inferQso(cells);
    return { ...line, qso, raw: formatQso(qso, document.layout), dirty: true };
  });
  return { ...document, lines };
}

export function updateQtcCell(document: CabrilloDocument, lineIdValue: string, field: string, value: string): CabrilloDocument {
  const lines = document.lines.map((line) => {
    if (line.id !== lineIdValue || !line.qtc) return line;
    const cells = line.qtc.cells.map((cell) => cell.key === field ? { ...cell, value } : cell);
    const qtc = inferQtc(cells);
    return { ...line, qtc, value: formatQtc(qtc).slice(5), raw: formatQtc(qtc), dirty: true };
  });
  return { ...document, lines };
}

export function replaceCabrilloSource(source: string): CabrilloDocument {
  return parseCabrillo(source);
}
