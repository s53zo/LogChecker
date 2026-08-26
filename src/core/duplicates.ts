import { adifValue, parseAdif } from "./adif";
import { bandFromFrequency } from "./radio";
import type { AdifDocument, AdifRecord, AdifTag } from "./types";

export type DuplicateKind = "exact" | "lotw" | "near" | "possible" | "activity-aware";
export interface DuplicateCandidate { id: string; kind: DuplicateKind; first: AdifRecord; second: AdifRecord; differingFields: string[]; reason: string }

function upper(record: AdifRecord, field: string): string { return adifValue(record, field).trim().toUpperCase(); }
function band(record: AdifRecord): string { return upper(record, "BAND") || bandFromFrequency(adifValue(record, "FREQ")).toUpperCase(); }
function minute(record: AdifRecord): number | null { const date = upper(record, "QSO_DATE"); const time = upper(record, "TIME_ON").slice(0, 4); if (!/^\d{8}$/.test(date) || !/^\d{4}$/.test(time)) return null; const parsed = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8)), Number(time.slice(0, 2)), Number(time.slice(2, 4))); return Number.isNaN(parsed) ? null : parsed / 60000; }
function fields(record: AdifRecord): Map<string, string> { return new Map(record.tags.map((tag) => [tag.name, tag.value])); }
function differences(a: AdifRecord, b: AdifRecord): string[] { const aa = fields(a), bb = fields(b); return [...new Set([...aa.keys(), ...bb.keys()])].filter((key) => (aa.get(key) ?? "") !== (bb.get(key) ?? "")).sort(); }
function activity(record: AdifRecord): string { return ["SIG", "SIG_INFO", "MY_SIG", "MY_SIG_INFO"].map((field) => upper(record, field)).join("|"); }

export function findDuplicateCandidates(documents: readonly AdifDocument[], toleranceMinutes = 5): DuplicateCandidate[] {
  const candidates: DuplicateCandidate[] = []; const indexes = new Map<string, AdifRecord[]>();
  for (const document of documents) for (const record of document.records) {
    const call = upper(record, "CALL"); if (!call) continue; const key = `${call}|${upper(record, "QSO_DATE")}`; const pool = indexes.get(key) ?? [];
    for (const first of pool) { const firstMinute = minute(first), secondMinute = minute(record), delta = firstMinute === null || secondMinute === null ? Number.POSITIVE_INFINITY : Math.abs(firstMinute - secondMinute); const sameBand = band(first) === band(record); const sameMode = (upper(first, "SUBMODE") || upper(first, "MODE")) === (upper(record, "SUBMODE") || upper(record, "MODE")); const sameTime = delta === 0; const exact = sameTime && sameBand && sameMode; const lotw = exact && upper(first, "PROP_MODE") === upper(record, "PROP_MODE") && upper(first, "SAT_NAME") === upper(record, "SAT_NAME") && ["STATION_CALLSIGN", "MY_DXCC", "MY_STATE", "MY_CNTY", "MY_GRIDSQUARE"].every((field) => upper(first, field) === upper(record, field)); let kind: DuplicateKind | null = lotw ? "lotw" : exact ? "exact" : delta <= toleranceMinutes && sameBand && sameMode ? "near" : sameTime ? "possible" : null; if (!kind) continue; if (activity(first) && activity(record) && activity(first) !== activity(record)) kind = "activity-aware"; candidates.push({ id: `dup-${candidates.length + 1}`, kind, first, second: record, differingFields: differences(first, record), reason: kind === "near" ? `Same call, band, and mode within ${delta} minutes` : kind === "activity-aware" ? "Similar QSO with different activity references; keep both unless confirmed" : kind === "lotw" ? "Matches documented LoTW identity fields" : kind === "exact" ? "Same call, date/time, band, and mode" : "Same call and time with differing band or mode" }); }
    pool.push(record); indexes.set(key, pool);
  }
  return candidates;
}

function serializeRecords(base: AdifDocument, records: AdifRecord[]): AdifDocument { return parseAdif(`<ADIF_VER:5>3.1.7${base.newline}<EOH>${base.newline}${records.map((record) => `${record.tags.map((tag) => `<${tag.name}:${tag.value.length}${tag.type ? `:${tag.type}` : ""}>${tag.value}`).join(" ")} <EOR>`).join(base.newline)}${base.newline}`); }

export function resolveDuplicate(document: AdifDocument, candidate: DuplicateCandidate, action: "keep-first" | "keep-last" | "keep-both" | "merge", fieldChoices: Record<string, "first" | "second"> = {}): AdifDocument {
  if (action === "keep-both") return document;
  const remove = action === "keep-first" ? candidate.second.id : candidate.first.id; let replacement: AdifRecord | null = null;
  if (action === "merge") { const names = [...new Set([...candidate.first.tags.map((tag) => tag.name), ...candidate.second.tags.map((tag) => tag.name)])]; const tags: AdifTag[] = names.map((name) => { const a = candidate.first.tags.find((tag) => tag.name === name), b = candidate.second.tags.find((tag) => tag.name === name); if (!a) return { ...b! }; if (!b || a.value === b.value) return { ...a }; return { ...(fieldChoices[name] === "second" ? b : a) }; }); replacement = { ...candidate.first, tags, original: "", dirty: true, changedTags: names }; }
  const records = document.records.flatMap((record) => record.id === candidate.first.id && replacement ? [replacement] : record.id === (replacement ? candidate.second.id : remove) ? [] : [record]);
  return serializeRecords(document, records);
}

export function duplicateReportCsv(candidates: readonly DuplicateCandidate[]): string { const quote = (value: string) => `"${value.replaceAll("\"", "\"\"")}"`; return `Kind,First call,Second call,Differing fields,Reason\r\n${candidates.map((item) => [item.kind, upper(item.first, "CALL"), upper(item.second, "CALL"), item.differingFields.join(";"), item.reason].map(quote).join(",")).join("\r\n")}\r\n`; }
