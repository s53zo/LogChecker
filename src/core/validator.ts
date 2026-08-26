import { adifValue } from "./adif";
import { bandFromFrequency, isPlausibleCallsign } from "./radio";
import { geography } from "./geography";
import { isFixedWidthQso } from "./cabrillo";
import { isWaedcEuropean } from "./waedc";
import { EDI_MODE_NAMES, EDI_QSO_FIELDS, ediField, ediHeader } from "./edi";
import { ADIF_CURRENT_VERSION, ADIF_FIELD_RULES, DEPRECATED_MODE_MAP, frequencyBand, validAdifDate, validAdifTime, validGrid } from "./adif-schema";
import type { AdifDocument, CabrilloDocument, Diagnostic, EdiDocument } from "./types";

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

function validCompactDate(value: string): boolean {
  if (!/^\d{6}$/.test(value)) return false;
  const year = Number(value.slice(0, 2)) >= 70 ? `19${value.slice(0, 2)}` : `20${value.slice(0, 2)}`;
  const iso = `${year}-${value.slice(2, 4)}-${value.slice(4, 6)}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === iso;
}

function isPlausibleEdiCall(value: string): boolean {
  const call = value.trim().toUpperCase();
  return call.length >= 3 && call.length <= 14 && /[A-Z]/.test(call) && /\d/.test(call) && /^[A-Z0-9]+(?:\/[A-Z0-9]+)*$/.test(call);
}

export function validateEdi(document: EdiDocument): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const signature = document.lines.find((line) => line.type !== "blank");
  if (signature?.type !== "signature") push(diagnostics, "error", "EDI-SIGNATURE", "The first content line must be [REG1TEST;1].", signature?.id, signature?.lineNumber);
  else if (document.version !== "1") push(diagnostics, "warning", "EDI-VERSION", `REG1TEST version “${document.version}” is not the documented version 1.`, signature.id, signature.lineNumber);
  const recordsMarker = document.lines.find((line) => line.type === "records-marker");
  if (!recordsMarker) push(diagnostics, "error", "EDI-RECORDS-MARKER", "[QSORecords;count] is missing.");
  if (document.declaredRecords !== null && document.declaredRecords !== document.records.length) push(diagnostics, "error", "EDI-RECORD-COUNT", `[QSORecords] declares ${document.declaredRecords} records, but ${document.records.length} follow.`, recordsMarker?.id, recordsMarker?.lineNumber);
  for (const key of ["TName", "TDate", "PCall", "PWWLo", "PBand"]) {
    if (!ediHeader(document, key).trim()) push(diagnostics, "error", "EDI-HEADER-REQUIRED", `${key} is required by REG1TEST.`, document.lines.find((line) => line.key === key)?.id, document.lines.find((line) => line.key === key)?.lineNumber, key);
  }
  const dates = ediHeader(document, "TDate").split(";");
  if (dates.length !== 2 || dates.some((date) => !/^\d{8}$/.test(date))) push(diagnostics, "error", "EDI-CONTEST-DATE", "TDate must contain YYYYMMDD;YYYYMMDD.", document.lines.find((line) => line.key === "TDate")?.id, document.lines.find((line) => line.key === "TDate")?.lineNumber, "TDate");
  if (!isPlausibleEdiCall(ediHeader(document, "PCall"))) push(diagnostics, "warning", "EDI-STATION-CALL", "PCall looks like an unusual callsign.", document.lines.find((line) => line.key === "PCall")?.id, document.lines.find((line) => line.key === "PCall")?.lineNumber, "PCall");
  if (!/^[A-R]{2}\d{2}(?:[A-X]{2})?(?:\d{2})?$/i.test(ediHeader(document, "PWWLo"))) push(diagnostics, "error", "EDI-STATION-WWL", "PWWLo must be a 4, 6, or 8 character Maidenhead locator.", document.lines.find((line) => line.key === "PWWLo")?.id, document.lines.find((line) => line.key === "PWWLo")?.lineNumber, "PWWLo");

  for (const record of document.records) {
    const error = (code: string, message: string, field: typeof EDI_QSO_FIELDS[number], severity: Diagnostic["severity"] = "error") => push(diagnostics, severity, code, message, record.id, record.lineNumber, field);
    if (record.fields.length < EDI_QSO_FIELDS.length) error("EDI-FIELD-COUNT", `QSO record has ${record.fields.length} fields; ${EDI_QSO_FIELDS.length} are required.`, "DATE");
    if (!validCompactDate(ediField(record, "DATE"))) error("EDI-QSO-DATE", `Date “${ediField(record, "DATE") || "empty"}” is not YYMMDD.`, "DATE");
    if (!/^(?:[01]\d|2[0-3])[0-5]\d$/.test(ediField(record, "TIME"))) error("EDI-QSO-TIME", `Time “${ediField(record, "TIME") || "empty"}” is not HHMM UTC.`, "TIME");
    const call = ediField(record, "CALL");
    if (!isPlausibleEdiCall(call)) error("EDI-QSO-CALL", `Callsign “${call || "empty"}” is not plausible.`, "CALL");
    const mode = ediField(record, "MODE_CODE");
    if (!(mode in EDI_MODE_NAMES)) error("EDI-QSO-MODE", `Mode code “${mode}” is outside the REG1TEST 0–9 table.`, "MODE_CODE");
    const locator = ediField(record, "WWL_RCVD");
    if (locator && !/^[A-R]{2}\d{2}(?:[A-X]{2})?(?:\d{2})?$/i.test(locator)) error("EDI-QSO-WWL", `Locator “${locator}” is not a 4, 6, or 8 character Maidenhead locator.`, "WWL_RCVD");
    const points = ediField(record, "QSO_POINTS");
    if (points && points !== "ERROR" && !/^\d{1,6}$/.test(points)) error("EDI-QSO-POINTS", `QSO points “${points}” must be numeric or ERROR.`, "QSO_POINTS");
    for (const field of ["NEW_EXCHANGE", "NEW_WWL", "NEW_DXCC"] as const) if (ediField(record, field) && ediField(record, field) !== "N") error("EDI-QSO-FLAG", `${field} must be empty or N.`, field);
    if (ediField(record, "DUPLICATE") && ediField(record, "DUPLICATE") !== "D") error("EDI-QSO-DUPLICATE-FLAG", "DUPLICATE must be empty or D.", "DUPLICATE");
  }
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
  for (const warning of document.parseWarnings ?? []) diagnostics.push({ id: `ADX-PARSE-${diagnostics.length}`, severity: "error", code: "ADX-PARSE", message: warning, category: "syntax" });
  const version = document.header.find((tag) => tag.name === "ADIF_VER")?.value.trim();
  if (!version) diagnostics.push({ id: "ADIF-VERSION-MISSING", severity: "warning", code: "ADIF-VERSION-MISSING", message: "The header has no ADIF_VER declaration.", category: "conformance", suggestion: `Add ADIF_VER ${ADIF_CURRENT_VERSION} when exporting a repaired copy.` });
  else if (!/^\d+\.\d+\.\d+$/.test(version)) diagnostics.push({ id: "ADIF-VERSION-MALFORMED", severity: "error", code: "ADIF-VERSION-MALFORMED", message: `ADIF_VER “${version}” is malformed.`, category: "syntax", field: "ADIF_VER" });
  else if (version.localeCompare(ADIF_CURRENT_VERSION, undefined, { numeric: true }) > 0) diagnostics.push({ id: "ADIF-VERSION-FUTURE", severity: "warning", code: "ADIF-VERSION-FUTURE", message: `This file declares ADIF ${version}, newer than bundled ${ADIF_CURRENT_VERSION}; unknown fields are preserved but may not be validated.`, category: "conformance", field: "ADIF_VER" });
  else if (version !== ADIF_CURRENT_VERSION) diagnostics.push({ id: "ADIF-VERSION-OLDER", severity: "info", code: "ADIF-VERSION-OLDER", message: `This file declares ADIF ${version}; repaired exports default to ${ADIF_CURRENT_VERSION}.`, category: "conformance", field: "ADIF_VER" });
  document.records.forEach((record, index) => {
    const lineNumber = index + 1;
    const call = adifValue(record, "CALL");
    if (!call) push(diagnostics, "error", "ADIF-CALL-EMPTY", "CALL is required.", record.id, lineNumber, "CALL");
    else if (!isPlausibleCallsign(call)) push(diagnostics, "warning", "ADIF-CALL", `${call} looks like an unusual callsign.`, record.id, lineNumber, "CALL");
    const date = adifValue(record, "QSO_DATE");
    if (!validAdifDate(date)) push(diagnostics, "error", "ADIF-DATE", "QSO_DATE must be a valid YYYYMMDD date.", record.id, lineNumber, "QSO_DATE");
    const time = adifValue(record, "TIME_ON") || adifValue(record, "TIME_OFF");
    if (!validAdifTime(time)) push(diagnostics, "error", "ADIF-TIME", "TIME_ON or TIME_OFF must contain valid HHMM or HHMMSS UTC.", record.id, lineNumber, "TIME_ON");
    const band = adifValue(record, "BAND") || bandFromFrequency(adifValue(record, "FREQ"));
    if (!band) push(diagnostics, "warning", "ADIF-BAND", "BAND or a recognizable FREQ is required for Cabrillo conversion.", record.id, lineNumber, "BAND");
    if (!adifValue(record, "MODE")) push(diagnostics, "error", "ADIF-MODE", "MODE is required.", record.id, lineNumber, "MODE");
    for (const tag of record.tags) {
      const declared = /^<\s*[A-Z][A-Z0-9_]*:(\d+)/i.exec(tag.raw)?.[1];
      if (declared !== undefined && Number(declared) !== tag.value.length) push(diagnostics, "error", "ADIF-LENGTH", `${tag.name} declares ${declared} characters but contains ${tag.value.length}.`, record.id, lineNumber, tag.name);
      const rule = ADIF_FIELD_RULES[tag.name]; if (!rule) continue;
      if (tag.type && tag.type.toUpperCase() !== rule.type && !(rule.type === "E" && tag.type.toUpperCase() === "S")) push(diagnostics, "warning", "ADIF-TYPE", `${tag.name} declares type ${tag.type}; the bundled definition uses ${rule.type}.`, record.id, lineNumber, tag.name);
      if (rule.type === "N" && (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(tag.value) || (rule.minimum !== undefined && Number(tag.value) < rule.minimum) || (rule.maximum !== undefined && Number(tag.value) > rule.maximum))) push(diagnostics, "error", "ADIF-NUMBER", `${tag.name} is outside its numeric definition.`, record.id, lineNumber, tag.name);
      if (rule.type === "D" && !validAdifDate(tag.value)) push(diagnostics, "error", "ADIF-DATE-TYPE", `${tag.name} is not a valid ADIF date.`, record.id, lineNumber, tag.name);
      if (rule.type === "T" && !validAdifTime(tag.value)) push(diagnostics, "error", "ADIF-TIME-TYPE", `${tag.name} is not a valid ADIF time.`, record.id, lineNumber, tag.name);
      if (rule.type === "G" && !validGrid(tag.value)) push(diagnostics, "error", "ADIF-GRID", `${tag.name} is not a valid Maidenhead locator.`, record.id, lineNumber, tag.name);
      if (rule.values && !rule.values.includes(tag.value.toUpperCase())) push(diagnostics, "error", "ADIF-ENUM", `${tag.name} value “${tag.value}” is not in the bundled ADIF enumeration.`, record.id, lineNumber, tag.name);
    }
    const explicitBand = adifValue(record, "BAND").toUpperCase(); const freqBand = frequencyBand(adifValue(record, "FREQ"));
    if (explicitBand && freqBand && explicitBand !== freqBand) push(diagnostics, "error", "ADIF-BAND-FREQ", `BAND ${explicitBand} conflicts with FREQ, which resolves to ${freqBand}.`, record.id, lineNumber, "FREQ");
    const explicitRx = adifValue(record, "BAND_RX").toUpperCase(); const freqRxBand = frequencyBand(adifValue(record, "FREQ_RX"));
    if (explicitRx && freqRxBand && explicitRx !== freqRxBand) push(diagnostics, "error", "ADIF-BAND-RX-FREQ", `BAND_RX ${explicitRx} conflicts with FREQ_RX, which resolves to ${freqRxBand}.`, record.id, lineNumber, "FREQ_RX");
    const mode = adifValue(record, "MODE").toUpperCase(); if (DEPRECATED_MODE_MAP[mode]) { const replacement = DEPRECATED_MODE_MAP[mode]!; diagnostics.push({ id: `ADIF-DEPRECATED-MODE-${record.id}`, severity: "warning", code: "ADIF-DEPRECATED-MODE", message: `${mode} should be exported as MODE ${replacement.mode}${replacement.submode ? ` with SUBMODE ${replacement.submode}` : ""}.`, lineId: record.id, lineNumber, field: "MODE", category: "conformance", suggestion: "Preview the modern mode migration." }); }
    const prop = adifValue(record, "PROP_MODE").toUpperCase(), sat = adifValue(record, "SAT_NAME");
    if (prop === "SAT" && !sat) push(diagnostics, "error", "ADIF-SAT-NAME", "SAT_NAME is required when PROP_MODE is SAT.", record.id, lineNumber, "SAT_NAME");
    if (sat && prop !== "SAT") push(diagnostics, "error", "ADIF-SAT-PROP", "PROP_MODE must be SAT when SAT_NAME is present.", record.id, lineNumber, "PROP_MODE");
  });
  return diagnostics;
}
