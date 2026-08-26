import { parseAdif, updateAdifTag } from "./adif";
import type { AdifDocument, AdifRecord } from "./types";
import { maidenheadCenter } from "./geography";

export interface StationProfile {
  id: string; name: string; stationCallsign?: string; operator?: string; ownerCallsign?: string; dxcc?: string; country?: string; grid?: string; latitude?: string; longitude?: string; cqZone?: string; ituZone?: string; state?: string; county?: string; iota?: string; pota?: string; sota?: string; wwff?: string; band?: string; frequency?: string; mode?: string; propMode?: string; satellite?: string; notes?: string;
}
export interface StationProfileStore { version: 1; profiles: StationProfile[] }
export type ProfileApplyMode = "missing" | "replace";

const mapping: ReadonlyArray<[keyof StationProfile, string]> = [["stationCallsign", "STATION_CALLSIGN"], ["operator", "OPERATOR"], ["ownerCallsign", "OWNER_CALLSIGN"], ["dxcc", "MY_DXCC"], ["country", "MY_COUNTRY"], ["grid", "MY_GRIDSQUARE"], ["latitude", "MY_LAT"], ["longitude", "MY_LON"], ["cqZone", "MY_CQ_ZONE"], ["ituZone", "MY_ITU_ZONE"], ["state", "MY_STATE"], ["county", "MY_CNTY"], ["iota", "MY_IOTA"], ["band", "BAND"], ["frequency", "FREQ"], ["mode", "MODE"], ["propMode", "PROP_MODE"], ["satellite", "SAT_NAME"]];

function values(profile: StationProfile): Array<[string, string]> {
  const result = mapping.flatMap(([key, tag]) => profile[key] ? [[tag, String(profile[key])]] as Array<[string, string]> : []);
  for (const key of ["pota", "sota", "wwff"] as const) if (profile[key]) result.push(["MY_SIG", key.toUpperCase()], ["MY_SIG_INFO", profile[key]!]);
  return result;
}

export function applyStationProfile(document: AdifDocument, profile: StationProfile, recordIds?: readonly string[], mode: ProfileApplyMode = "missing"): { document: AdifDocument; changes: Array<{ recordId: string; field: string; before: string; after: string }> } {
  const selected = recordIds?.length ? new Set(recordIds) : null; const changes: Array<{ recordId: string; field: string; before: string; after: string }> = []; let next = document;
  for (const record of document.records) { if (selected && !selected.has(record.id)) continue; for (const [field, after] of values(profile)) { const before = record.tags.find((tag) => tag.name === field)?.value ?? ""; if (before === after || (mode === "missing" && before)) continue; changes.push({ recordId: record.id, field, before, after }); next = updateAdifTag(next, record.id, field, after); } }
  return { document: next, changes };
}

export function stationIdentity(record: AdifRecord): string { return ["STATION_CALLSIGN", "MY_DXCC", "MY_STATE", "MY_CNTY", "MY_GRIDSQUARE", "MY_SIG", "MY_SIG_INFO"].map((field) => record.tags.find((tag) => tag.name === field)?.value.trim().toUpperCase() ?? "").join("|"); }

export function splitByStation(document: AdifDocument): Map<string, AdifDocument> {
  const groups = new Map<string, AdifRecord[]>(); for (const record of document.records) { const key = stationIdentity(record) || "unassigned"; groups.set(key, [...(groups.get(key) ?? []), record]); }
  return new Map([...groups].map(([key, records]) => [key, parseAdif(`<ADIF_VER:5>3.1.7\n<EOH>\n${records.map((record) => `${record.tags.map((tag) => `<${tag.name}:${tag.value.length}>${tag.value}`).join(" ")} <EOR>`).join("\n")}\n`)]));
}

export type SplitCriterion = "station" | "date" | "activity";
export function splitAdif(document: AdifDocument, criterion: SplitCriterion): Map<string, AdifDocument> {
  if (criterion === "station") return splitByStation(document);
  const groups = new Map<string, AdifRecord[]>();
  for (const record of document.records) {
    const value = criterion === "date" ? record.tags.find((tag) => tag.name === "QSO_DATE")?.value : ["MY_SIG", "MY_SIG_INFO"].map((field) => record.tags.find((tag) => tag.name === field)?.value).filter(Boolean).join("-");
    const key = value?.trim() || "unassigned"; groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  return new Map([...groups].map(([key, records]) => [key, parseAdif(`<ADIF_VER:5>3.1.7\n<EOH>\n${records.map((record) => `${record.tags.map((tag) => `<${tag.name}:${tag.value.length}>${tag.value}`).join(" ")} <EOR>`).join("\n")}\n`)]));
}

export function validateStationProfile(profile: StationProfile): string[] {
  const warnings: string[] = [];
  if (profile.grid && !maidenheadCenter(profile.grid)) warnings.push("Grid is not a valid Maidenhead locator.");
  const latitude = Number(profile.latitude), longitude = Number(profile.longitude);
  if (profile.latitude && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) warnings.push("Latitude must be between -90 and 90.");
  if (profile.longitude && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)) warnings.push("Longitude must be between -180 and 180.");
  const center = profile.grid ? maidenheadCenter(profile.grid) : null;
  if (center && profile.latitude && profile.longitude && Number.isFinite(latitude) && Number.isFinite(longitude) && (Math.abs(center.latitude - latitude) > 2 || Math.abs(center.longitude - longitude) > 4)) warnings.push("Grid and coordinates appear inconsistent; review them before applying the profile.");
  return warnings;
}

export function safeProfileFilename(value: string, extension = "adi"): string { const base = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unassigned"; return `${base}.${extension}`; }

export function parseProfileStore(source: string): StationProfileStore { const value = JSON.parse(source) as Partial<StationProfileStore>; if (value.version !== 1 || !Array.isArray(value.profiles)) throw new Error("Unsupported station profile file."); return { version: 1, profiles: value.profiles.filter((profile) => profile && typeof profile.id === "string" && typeof profile.name === "string") }; }
