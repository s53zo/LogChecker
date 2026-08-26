import { adifValue } from "./adif";
import { bandFromFrequency, isPlausibleCallsign } from "./radio";
import { geography } from "./geography";
import { isFixedWidthQso } from "./cabrillo";
import { isWaedcEuropean } from "./waedc";
import type { AdifDocument, CabrilloDocument, Diagnostic } from "./types";

function validDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function push(
  list: Diagnostic[],
  severity: Diagnostic["severity"],
  code: string,
  message: string,
  lineId?: string,
  lineNumber?: number,
  field?: string,
): void {
  list.push({ id: `${code}-${lineId ?? list.length}-${field ?? ""}`, severity, code, message, lineId, lineNumber, field });
}

export function validateCabrillo(document: CabrilloDocument): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const first = document.lines.find((line) => line.type !== "blank" && line.type !== "comment");
  if (first?.key !== "START-OF-LOG") push(diagnostics, "error", "CAB-START", "The first content line must be START-OF-LOG.", first?.id, first?.lineNumber);
  if (!document.lines.some((line) => line.key === "END-OF-LOG")) push(diagnostics, "error", "CAB-END", "END-OF-LOG is missing.");
  for (const required of ["CALLSIGN", "CONTEST"]) {
    const line = document.lines.find((candidate) => candidate.key === required);
    if (!line?.value?.trim()) push(diagnostics, "error", "CAB-HEADER-REQUIRED", `${required} is required.`, line?.id, line?.lineNumber, required);
  }
  const ownCall = document.lines.find((line) => line.key === "CALLSIGN");
  if (ownCall?.value && !isPlausibleCallsign(ownCall.value)) push(diagnostics, "warning", "CAB-CALLSIGN", "The station callsign looks unusual.", ownCall.id, ownCall.lineNumber, "CALLSIGN");
  if (!document.layout && document.contest !== "GENERIC-CONTEST") push(diagnostics, "info", "CAB-LAYOUT", `No detailed recovered column layout is available for ${document.contest}; generic QSO checks are active.`);

  const seen = new Map<string, number>();
  for (const line of document.lines.filter((candidate) => candidate.type === "qso" && candidate.qso)) {
    const qso = line.qso!;
    if (!qso.call) push(diagnostics, "error", "QSO-CALL-EMPTY", "Worked callsign is empty.", line.id, line.lineNumber, "CALL");
    else if (!isPlausibleCallsign(qso.call)) push(diagnostics, "warning", "QSO-CALL", `${qso.call} looks like an unusual callsign.`, line.id, line.lineNumber, "CALL");
    if (!validDate(qso.date)) push(diagnostics, "error", "QSO-DATE", `Date “${qso.date || "empty"}” is not YYYY-MM-DD.`, line.id, line.lineNumber, "QSO_DATE");
    if (!/^(?:[01]\d|2[0-3])[0-5]\d$/.test(qso.time)) push(diagnostics, "error", "QSO-TIME", `Time “${qso.time || "empty"}” is not HHMM.`, line.id, line.lineNumber, "TIME_ON");
    if (!bandFromFrequency(qso.frequency)) push(diagnostics, "warning", "QSO-FREQUENCY", `Frequency or band “${qso.frequency || "empty"}” is not recognized.`, line.id, line.lineNumber, "FREQUENCY");
    if (!/^(?:CW|PH|FM|RY|DG|AM)$/i.test(qso.mode)) push(diagnostics, "warning", "QSO-MODE", `Mode “${qso.mode || "empty"}” is not a standard Cabrillo mode.`, line.id, line.lineNumber, "MODE");
    if (!qso.receivedExchange) push(diagnostics, "warning", "QSO-EXCHANGE", "Received exchange is empty.", line.id, line.lineNumber, "SRX_STRING");
    if (document.layout) {
      const waedcCompact = document.layout.name.startsWith("DARC-WAEDC-") && !isFixedWidthQso(line.raw, document.layout);
      if (!waedcCompact) {
        if (line.raw.length < document.layout.minimumLength) push(diagnostics, "error", "QSO-LENGTH", `Line has ${line.raw.length} characters; ${document.layout.minimumLength} are required by ${document.layout.name}.`, line.id, line.lineNumber);
        const offset = line.raw.startsWith("X-QSO:") ? 2 : 0;
        const badSeparator = document.layout.separators.find((position) => line.raw[position + offset] && !/\s/.test(line.raw[position + offset]!));
        if (badSeparator !== undefined) push(diagnostics, "error", "QSO-ALIGNMENT", `Expected whitespace at column ${badSeparator + 1}.`, line.id, line.lineNumber);
      } else if (line.qso!.cells.some((cell) => cell.key !== "TRANSMITTER_ID" && !cell.value) || line.raw.trim().split(/\s+/).length < 11) {
        push(diagnostics, "error", "QSO-LENGTH", `QSO line is neither a complete whitespace-delimited record nor the ${document.layout.name} fixed-column layout.`, line.id, line.lineNumber);
      }
    }
    const duplicateKey = `${bandFromFrequency(qso.frequency)}|${qso.mode}|${qso.call.toUpperCase()}`;
    if (seen.has(duplicateKey)) push(diagnostics, "warning", "QSO-DUPLICATE", `Possible duplicate of line ${seen.get(duplicateKey)} on the same band and mode.`, line.id, line.lineNumber, "CALL");
    else if (qso.call) seen.set(duplicateKey, line.lineNumber);
  }
  if (/^DARC-WAEDC-(?:CW|SSB|RTTY)$/.test(document.contest)) validateWaedcQtcs(document, diagnostics);
  return diagnostics;
}

function validateWaedcQtcs(document: CabrilloDocument, diagnostics: Diagnostic[]): void {
  const qtcLines = document.lines.filter((line) => line.type === "qtc" && line.qtc);
  const expectedMode = document.contest.endsWith("-CW") ? "CW" : document.contest.endsWith("-SSB") ? "PH" : "RY";
  const groups = new Map<string, typeof qtcLines>();
  const pairCounts = new Map<string, number>();
  const reported = new Map<string, number>();

  for (const line of document.lines.filter((candidate) => candidate.type === "qso" && candidate.qso)) {
    const qso = line.qso!;
    if (qso.mode.toUpperCase() !== expectedMode) push(diagnostics, "error", "WAEDC-QSO-MODE", `${document.contest} QSO mode must be ${expectedMode}.`, line.id, line.lineNumber, "MODE");
    if (!/^\d{1,6}$/.test(qso.sentExchange)) push(diagnostics, "error", "WAEDC-STX", "WAEDC sent exchange must be a progressive serial number.", line.id, line.lineNumber, "STX_STRING");
    if (!/^\d{1,6}$/.test(qso.receivedExchange)) push(diagnostics, "error", "WAEDC-SRX", "WAEDC received exchange must be a serial number; use 000 when none was sent.", line.id, line.lineNumber, "SRX_STRING");
  }

  for (const line of qtcLines) {
    const qtc = line.qtc!;
    const fieldError = (code: string, message: string, field: string) => push(diagnostics, "error", code, message, line.id, line.lineNumber, field);
    if (!bandFromFrequency(qtc.frequency) || !/^(?:3[5-9]\d{2}|7\d{3}|14\d{3}|21\d{3}|28\d{3})$/.test(qtc.frequency)) fieldError("QTC-FREQUENCY", `QTC frequency “${qtc.frequency || "empty"}” is not on a WAEDC band.`, "FREQUENCY");
    if (qtc.mode.toUpperCase() !== expectedMode) fieldError("QTC-MODE", `${document.contest} QTC mode must be ${expectedMode}.`, "MODE");
    if (!validDate(qtc.date)) fieldError("QTC-DATE", `QTC date “${qtc.date || "empty"}” is not YYYY-MM-DD.`, "QSO_DATE");
    if (!/^(?:[01]\d|2[0-3])[0-5]\d$/.test(qtc.time)) fieldError("QTC-TIME", `QTC transfer time “${qtc.time || "empty"}” is not HHMM.`, "TIME_ON");
    if (!/^(?:[01]\d|2[0-3])[0-5]\d$/.test(qtc.qsoTime)) fieldError("QTC-QSO-TIME", `Reported QSO time “${qtc.qsoTime || "empty"}” is not HHMM.`, "TIME_QSO");
    for (const [value, field, label] of [[qtc.receiver, "CALL_RX", "QTC receiver"], [qtc.sender, "CALL_TX", "QTC sender"], [qtc.qsoCall, "CALL_QSO", "reported callsign"]] as const) {
      if (!isPlausibleCallsign(value)) fieldError("QTC-CALL", `${label} “${value || "empty"}” is not a plausible callsign.`, field);
    }
    if (!/^\d{1,4}$/.test(qtc.qsoSerial)) fieldError("QTC-SERIAL", `Reported QSO serial “${qtc.qsoSerial || "empty"}” must contain one to four digits.`, "NR_QSO");

    const group = qtc.group.match(/^(\d{1,3})\/(10|[1-9])$/);
    if (!group) {
      fieldError("QTC-GROUP", `QTC group “${qtc.group || "empty"}” must be series/count, with a count from 1 to 10.`, "QTC_GROUP");
    } else {
      const series = Number(group[1]);
      if (series < 1) fieldError("QTC-GROUP", "QTC series numbering starts at 1.", "QTC_GROUP");
      const key = `${qtc.sender.toUpperCase()}|${series}`;
      groups.set(key, [...(groups.get(key) ?? []), line]);
    }

    const pair = [qtc.sender.toUpperCase(), qtc.receiver.toUpperCase()].sort().join("|");
    pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
    if (qtc.qsoCall.toUpperCase() === qtc.receiver.toUpperCase() && qtc.qsoCall) fieldError("QTC-RETURN", "A QTC may not report a QSO back to the station that originally made it.", "CALL_QSO");
    const reportedKey = `${qtc.qsoTime}|${qtc.qsoCall.toUpperCase()}|${qtc.qsoSerial}`;
    if (reported.has(reportedKey)) fieldError("QTC-REPORTED-TWICE", `This QSO was already reported as a QTC on line ${reported.get(reportedKey)}.`, "CALL_QSO");
    else reported.set(reportedKey, line.lineNumber);

    const receiverGeo = geography.lookup(qtc.receiver);
    const senderGeo = geography.lookup(qtc.sender);
    if (receiverGeo && senderGeo) {
      if (expectedMode === "RY" && receiverGeo.continent === senderGeo.continent) fieldError("QTC-CONTINENT", "WAEDC RTTY QTCs must be exchanged between different continents.", "CALL_RX");
      if (expectedMode !== "RY" && !isWaedcEuropean(receiverGeo)) fieldError("QTC-RECEIVER-EU", "WAEDC CW/SSB QTCs must be sent to a European station.", "CALL_RX");
      if (expectedMode !== "RY" && isWaedcEuropean(senderGeo)) fieldError("QTC-SENDER-DX", "WAEDC CW/SSB QTCs must be sent by a non-European station.", "CALL_TX");
    }
  }

  for (const lines of groups.values()) {
    const first = lines[0]!;
    const qtc = first.qtc!;
    const expected = Number(qtc.group.split("/")[1]);
    if (lines.length !== expected) push(diagnostics, "error", "QTC-SERIES-SIZE", `QTC series ${qtc.group} from ${qtc.sender} contains ${lines.length} record${lines.length === 1 ? "" : "s"}; ${expected} are declared.`, first.id, first.lineNumber, "QTC_GROUP");
    const signatures = new Set(lines.map((line) => `${bandFromFrequency(line.qtc!.frequency)}|${line.qtc!.mode}|${line.qtc!.receiver}`));
    if (signatures.size > 1) push(diagnostics, "error", "QTC-SERIES-METADATA", `QTC series ${qtc.group} changes band, mode, or receiving station. Transfer minutes and dates may vary within a series.`, first.id, first.lineNumber, "QTC_GROUP");
  }
  for (const [pair, count] of pairCounts) {
    if (count > 10) push(diagnostics, "error", "QTC-PAIR-LIMIT", `${pair.replace("|", " and ")} exchange ${count} QTCs; WAEDC permits at most 10 between two stations.`);
  }
}

export function validateAdif(document: AdifDocument): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  document.records.forEach((record, index) => {
    const lineNumber = index + 1;
    const call = adifValue(record, "CALL");
    if (!call) push(diagnostics, "error", "ADIF-CALL-EMPTY", "CALL is required.", record.id, lineNumber, "CALL");
    else if (!isPlausibleCallsign(call)) push(diagnostics, "warning", "ADIF-CALL", `${call} looks like an unusual callsign.`, record.id, lineNumber, "CALL");
    const date = adifValue(record, "QSO_DATE");
    if (!/^\d{8}$/.test(date)) push(diagnostics, "error", "ADIF-DATE", "QSO_DATE must contain YYYYMMDD.", record.id, lineNumber, "QSO_DATE");
    const time = adifValue(record, "TIME_ON") || adifValue(record, "TIME_OFF");
    if (!/^\d{4}(?:\d{2})?$/.test(time)) push(diagnostics, "error", "ADIF-TIME", "TIME_ON or TIME_OFF must contain HHMM or HHMMSS.", record.id, lineNumber, "TIME_ON");
    const band = adifValue(record, "BAND") || bandFromFrequency(adifValue(record, "FREQ"));
    if (!band) push(diagnostics, "warning", "ADIF-BAND", "BAND or a recognizable FREQ is required for Cabrillo conversion.", record.id, lineNumber, "BAND");
    if (!adifValue(record, "MODE")) push(diagnostics, "error", "ADIF-MODE", "MODE is required.", record.id, lineNumber, "MODE");
  });
  return diagnostics;
}
