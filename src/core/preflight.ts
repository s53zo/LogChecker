import { adifValue } from "./adif";
import { ADIF_CURRENT_VERSION, frequencyBand, normalizedBand, validAdifDate, validAdifTime, validGrid } from "./adif-schema";
import { geography } from "./geography";
import { isPlausibleCallsign } from "./radio";
import type { AdifDocument, AdifRecord, Diagnostic } from "./types";
import { parseAdif } from "./adif";
import { validateAdif } from "./validator";

export type PreflightProfileId = "generic" | "lotw" | "clublog" | "qrz" | "pota" | "sota" | "wwff" | "iota";

export interface PreflightProfile {
  id: PreflightProfileId;
  name: string;
  support: "full" | "partial" | "advisory";
  version: string;
  reviewed: string;
  source: string;
  description: string;
}

export interface PreflightOptions { qrzDateFrom?: string; qrzDateTo?: string }
export interface PreflightResult { profile: PreflightProfile; diagnostics: Diagnostic[]; ready: AdifRecord[]; rejected: AdifRecord[]; review: AdifRecord[] }

export const PREFLIGHT_PROFILES: readonly PreflightProfile[] = [
  { id: "generic", name: "Generic ADIF 3.1.7", support: "full", version: ADIF_CURRENT_VERSION, reviewed: "2026-08-26", source: "https://www.adif.org.uk/", description: "ADIF syntax and common field conformance." },
  { id: "lotw", name: "LoTW / TQSL", support: "full", version: "Documented web requirements", reviewed: "2026-08-26", source: "https://lotw.arrl.org/lotw-help/submitting-qsos/?lang=en", description: "Local TQSL readiness checks; final acceptance remains TQSL's responsibility." },
  { id: "clublog", name: "Club Log", support: "advisory", version: "Upload guidance", reviewed: "2026-08-26", source: "https://clublog.freshdesk.com/support/solutions/articles/53636-your-upload-report", description: "Core upload fields, statuses, and local entity assistance." },
  { id: "qrz", name: "QRZ Logbook", support: "advisory", version: "Logbook 3 FAQ", reviewed: "2026-08-26", source: "https://www.qrz.com/docs/logbook30/faq", description: "Core fields, zones, and optional target date range." },
  { id: "pota", name: "POTA", support: "full", version: "ADIF logging guide", reviewed: "2026-08-26", source: "https://docs.pota.app/docs/activator_reference/ADIF_for_POTA.html", description: "POTA reference and portable station fields." },
  { id: "sota", name: "SOTA", support: "partial", version: "ADIF conventions", reviewed: "2026-08-26", source: "https://www.sotadata.org.uk/", description: "Conservative SOTA reference checks." },
  { id: "wwff", name: "WWFF", support: "partial", version: "ADIF conventions", reviewed: "2026-08-26", source: "https://wwff.co/", description: "Conservative WWFF reference checks." },
  { id: "iota", name: "IOTA", support: "partial", version: "ADIF field definition", reviewed: "2026-08-26", source: "https://www.iota-world.org/", description: "IOTA reference syntax checks." },
];

function issue(profile: PreflightProfileId, record: AdifRecord, index: number, severity: Diagnostic["severity"], code: string, message: string, field?: string, suggestion?: string): Diagnostic {
  return { id: `${profile}-${code}-${record.id}-${field ?? ""}`, severity, code, message, lineId: record.id, lineNumber: index + 1, field, category: profile === "generic" ? "conformance" : "destination", suggestion };
}

function required(profile: PreflightProfileId, record: AdifRecord, index: number, diagnostics: Diagnostic[], field: string, alternative?: string): void {
  if (!adifValue(record, field) && (!alternative || !adifValue(record, alternative))) diagnostics.push(issue(profile, record, index, "error", `${profile.toUpperCase()}-REQUIRED`, `${field}${alternative ? ` or ${alternative}` : ""} is required.`, field));
}

function coreChecks(profile: PreflightProfileId, record: AdifRecord, index: number, diagnostics: Diagnostic[]): void {
  required(profile, record, index, diagnostics, "CALL"); required(profile, record, index, diagnostics, "QSO_DATE"); required(profile, record, index, diagnostics, "TIME_ON", "TIME_OFF"); required(profile, record, index, diagnostics, "BAND", "FREQ"); required(profile, record, index, diagnostics, "MODE");
  const call = adifValue(record, "CALL");
  if (call && !isPlausibleCallsign(call)) diagnostics.push(issue(profile, record, index, "warning", `${profile.toUpperCase()}-CALL`, `${call} looks like an unusual callsign.`, "CALL"));
  const date = adifValue(record, "QSO_DATE"); if (date && !validAdifDate(date)) diagnostics.push(issue(profile, record, index, "error", `${profile.toUpperCase()}-DATE`, "QSO_DATE is not a valid YYYYMMDD date.", "QSO_DATE"));
  const time = adifValue(record, "TIME_ON") || adifValue(record, "TIME_OFF"); if (time && !validAdifTime(time)) diagnostics.push(issue(profile, record, index, "error", `${profile.toUpperCase()}-TIME`, "QSO time must be HHMM or HHMMSS UTC.", adifValue(record, "TIME_ON") ? "TIME_ON" : "TIME_OFF"));
  const band = normalizedBand(adifValue(record, "BAND")); const inferred = frequencyBand(adifValue(record, "FREQ"));
  if (band && inferred && band !== inferred) diagnostics.push(issue(profile, record, index, "error", `${profile.toUpperCase()}-BAND-FREQ`, `BAND ${band} conflicts with FREQ, which resolves to ${inferred}.`, "FREQ"));
}

function activityReference(record: AdifRecord, program: "POTA" | "SOTA" | "WWFF", own: boolean): string {
  const sig = adifValue(record, own ? "MY_SIG" : "SIG").toUpperCase();
  return sig === program ? adifValue(record, own ? "MY_SIG_INFO" : "SIG_INFO") : "";
}

export function runPreflight(document: AdifDocument, profileId: PreflightProfileId, options: PreflightOptions = {}): PreflightResult {
  const profile = PREFLIGHT_PROFILES.find((item) => item.id === profileId) ?? PREFLIGHT_PROFILES[0]!;
  const diagnostics: Diagnostic[] = validateAdif(document);
  const stationKeys = new Set<string>();
  document.records.forEach((record, index) => {
    if (profileId !== "generic") coreChecks(profileId, record, index, diagnostics);
    if (profileId === "lotw") {
      required(profileId, record, index, diagnostics, "STATION_CALLSIGN");
      const station = adifValue(record, "STATION_CALLSIGN").toUpperCase();
      const location = ["MY_DXCC", "MY_STATE", "MY_CNTY", "MY_CQ_ZONE", "MY_ITU_ZONE", "MY_GRIDSQUARE", "MY_VUCC_GRIDS"].map((field) => adifValue(record, field).toUpperCase()).join("|");
      if (station) stationKeys.add(`${station}|${location}`);
      const prop = adifValue(record, "PROP_MODE").toUpperCase(); const sat = adifValue(record, "SAT_NAME");
      if (prop === "SAT" && !sat) diagnostics.push(issue(profileId, record, index, "error", "LOTW-SAT-NAME", "SAT_NAME is required when PROP_MODE is SAT.", "SAT_NAME"));
      if (sat && prop !== "SAT") diagnostics.push(issue(profileId, record, index, "error", "LOTW-PROP-SAT", "PROP_MODE must be SAT when SAT_NAME is present.", "PROP_MODE", "Set PROP_MODE to SAT after confirming this is a satellite QSO."));
    } else if (profileId === "clublog") {
      const explicitCountry = adifValue(record, "COUNTRY"); const resolved = geography.lookup(adifValue(record, "CALL"));
      if (explicitCountry && resolved?.country && explicitCountry.toUpperCase() !== resolved.country.toUpperCase()) diagnostics.push(issue(profileId, record, index, "warning", "CLUBLOG-ENTITY", `COUNTRY “${explicitCountry}” differs from the local CTY result “${resolved.country}”; review the entity and DXCC fields manually.`, "COUNTRY"));
      if (!adifValue(record, "QSL_RCVD") && !adifValue(record, "LOTW_QSL_RCVD")) diagnostics.push(issue(profileId, record, index, "info", "CLUBLOG-QSL-STATUS", "No paper or LoTW received status is recorded.", "QSL_RCVD"));
    } else if (profileId === "qrz") {
      for (const [field, max] of [["CQZ", 40], ["ITUZ", 90]] as const) { const value = adifValue(record, field); if (value && (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > max)) diagnostics.push(issue(profileId, record, index, "error", `QRZ-${field}`, `${field} must be between 1 and ${max}.`, field)); }
      const date = adifValue(record, "QSO_DATE"); if (options.qrzDateFrom && date < options.qrzDateFrom.replaceAll("-", "")) diagnostics.push(issue(profileId, record, index, "error", "QRZ-DATE-RANGE", "QSO is before the configured QRZ logbook range.", "QSO_DATE")); if (options.qrzDateTo && date > options.qrzDateTo.replaceAll("-", "")) diagnostics.push(issue(profileId, record, index, "error", "QRZ-DATE-RANGE", "QSO is after the configured QRZ logbook range.", "QSO_DATE"));
    } else if (["pota", "sota", "wwff"].includes(profileId)) {
      const program = profileId.toUpperCase() as "POTA" | "SOTA" | "WWFF"; const ref = activityReference(record, program, true) || activityReference(record, program, false);
      if (!ref) diagnostics.push(issue(profileId, record, index, "error", `${program}-REFERENCE`, `No ${program} SIG/SIG_INFO or MY_SIG/MY_SIG_INFO reference is present.`, "MY_SIG_INFO"));
      else { const pattern = program === "POTA" ? /^[A-Z0-9]{1,4}-\d{4,5}$/ : program === "SOTA" ? /^[A-Z0-9]{1,4}\/[A-Z0-9]{2}-\d{3}$/ : /^[A-Z0-9]{1,4}FF-\d{4,5}$/; if (!pattern.test(ref.toUpperCase())) diagnostics.push(issue(profileId, record, index, "warning", `${program}-REFERENCE-FORMAT`, `${ref} does not match the common ${program} reference form.`, "MY_SIG_INFO")); }
    } else if (profileId === "iota") {
      const ref = adifValue(record, "MY_IOTA") || adifValue(record, "IOTA"); if (!ref) diagnostics.push(issue(profileId, record, index, "error", "IOTA-REFERENCE", "IOTA or MY_IOTA is required.", "MY_IOTA")); else if (!/^(?:AF|AN|AS|EU|NA|OC|SA)-\d{3}$/i.test(ref)) diagnostics.push(issue(profileId, record, index, "error", "IOTA-REFERENCE-FORMAT", `${ref} is not a valid IOTA reference form.`, "MY_IOTA"));
    }
    for (const field of ["GRIDSQUARE", "MY_GRIDSQUARE"]) { const value = adifValue(record, field); if (value && !validGrid(value)) diagnostics.push(issue(profileId, record, index, "error", `${profileId.toUpperCase()}-GRID`, `${field} is not a valid Maidenhead locator.`, field)); }
  });
  if (profileId === "lotw" && stationKeys.size > 1) diagnostics.unshift({ id: "lotw-mixed-location", severity: "error", code: "LOTW-MIXED-LOCATION", message: "The file contains multiple station callsign/location combinations. Split it before TQSL submission.", category: "destination", suggestion: "Split the export by station identity." });
  const byRecord = new Map<string, Diagnostic[]>(); diagnostics.forEach((item) => { if (item.lineId) byRecord.set(item.lineId, [...(byRecord.get(item.lineId) ?? []), item]); });
  const rejected = document.records.filter((record) => byRecord.get(record.id)?.some((item) => item.severity === "error"));
  const review = document.records.filter((record) => !rejected.includes(record) && byRecord.get(record.id)?.some((item) => item.severity === "warning"));
  const ready = document.records.filter((record) => !rejected.includes(record));
  return { profile, diagnostics, ready, rejected, review };
}

export function preflightSubset(document: AdifDocument, records: readonly AdifRecord[]): AdifDocument {
  const nl = document.newline;
  return parseAdif(`<ADIF_VER:5>3.1.7${nl}<PROGRAMID:13>LOG_WORKBENCH${nl}<EOH>${nl}${records.map((record) => `${record.tags.map((tag) => `<${tag.name}:${tag.value.length}${tag.type ? `:${tag.type}` : ""}>${tag.value}`).join(" ")} <EOR>`).join(nl)}${records.length ? nl : ""}`);
}

export function preflightReportHtml(result: PreflightResult): string {
  const escape = (value: unknown) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;");
  const rows = result.diagnostics.map((item) => `<tr><td>${escape(item.severity)}</td><td>${escape(item.code)}</td><td>${escape(item.lineNumber ?? "document")}</td><td>${escape(item.field ?? "")}</td><td>${escape(item.message)}</td><td>${escape(item.suggestion ?? "")}</td></tr>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(result.profile.name)} preflight</title><style>body{font:16px system-ui;margin:2rem;color:#17202a}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:.45rem;text-align:left}th{background:#eee}</style></head><body><h1>${escape(result.profile.name)} preflight report</h1><p>Generated ${escape(new Date().toISOString())}. Local preparation only; external acceptance is not guaranteed.</p><p>Ready: ${result.ready.length} · Rejected: ${result.rejected.length} · Review: ${result.review.length}</p><table><thead><tr><th>Severity</th><th>Code</th><th>Record</th><th>Field</th><th>Finding</th><th>Suggestion</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
}
