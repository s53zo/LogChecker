import { recoveredDxccEntities } from "../data/dxcc.generated";
import { normalizeCallsign } from "./radio";

export interface GeographyMatch {
  country: string;
  continent: string;
  cqZone: number | null;
  ituZone: number;
  latitude: number;
  longitude: number;
  utcOffset: number;
  primaryPrefix: string;
  matchedPrefix: string;
}

const PORTABLE_SUFFIXES = new Set(["A", "AM", "M", "MM", "P", "QRP", "R"]);
const CACHE_LIMIT = 10_000;

export interface DxccEntity {
  name: string;
  cqZone: number | null;
  ituZone: number;
  latitude: number;
  longitude: number;
  utcOffset: number;
  primaryPrefix: string;
  continent: string;
  prefixes: readonly string[];
}

type Entity = DxccEntity;
export interface PrefixRecord { prefix: string; exact: boolean; entity: Entity }

function cleanPrefix(prefix: string): string {
  return prefix.trim().toUpperCase().replace(/^=|[^A-Z0-9/]/g, "");
}

function baseCall(call: string): string {
  const parts = call.split("/").filter(Boolean);
  if (parts.length < 2) return call;
  if (PORTABLE_SUFFIXES.has(parts.at(-1)!)) return parts[0]!;
  return parts.reduce((best, part) => part.length > best.length ? part : best, "");
}

function lookupCandidates(call: string): string[] {
  const parts = call.split("/").filter(Boolean);
  const candidates = [call];
  if (parts.length > 1) {
    const suffix = parts.at(-1)!;
    // A short location prefix such as EA8/S53ZO or S53ZO/4 takes precedence;
    // common operating suffixes such as /P do not describe geography.
    const locationParts = parts.filter((part) => !PORTABLE_SUFFIXES.has(part) && part.length <= 4);
    candidates.push(...locationParts, baseCall(call));
    if (/^[A-Z]{0,3}\d{1,2}$/.test(suffix) && !PORTABLE_SUFFIXES.has(suffix)) candidates.unshift(suffix);
  }
  return [...new Set(candidates.filter(Boolean))];
}

function isOrdinaryUsKg4(call: string): boolean {
  const base = baseCall(call);
  // Guantanamo calls traditionally have KG4 plus two letters; ordinary FCC
  // calls in the fourth district have KG4 plus three letters.
  return /^KG4[A-Z]{3}$/.test(base);
}

export class GeographyDatabase {
  private prefixes = new Map<string, Entity>();
  private exact = new Map<string, Entity>();
  private readonly cache = new Map<string, GeographyMatch | null>();
  private usEntity: Entity | undefined;

  constructor(entities: readonly Entity[] = recoveredDxccEntities) {
    this.replace(entities.flatMap((entity) => [entity.primaryPrefix, ...entity.prefixes].map((prefix) => ({ prefix: cleanPrefix(prefix), exact: false, entity }))));
  }

  private replace(records: readonly PrefixRecord[]): number {
    this.prefixes = new Map();
    this.exact = new Map();
    this.cache.clear();
    for (const record of records) {
      const prefix = cleanPrefix(record.prefix);
      if (!prefix) continue;
      const target = record.exact ? this.exact : this.prefixes;
      if (!target.has(prefix)) target.set(prefix, record.entity);
    }
    const entities = [...new Set([...this.prefixes.values(), ...this.exact.values()])];
    this.usEntity = entities.find((entity) => entity.name === "United States" || entity.name.startsWith("USA "));
    return this.prefixes.size + this.exact.size;
  }

  loadCty(source: string): number {
    const records = parseCtyDat(source);
    if (!records.length) throw new Error("No valid CTY.DAT records were found; the existing offline table was not changed.");
    return this.replace(records);
  }

  reset(): number {
    return this.replace(recoveredDxccEntities.flatMap((entity) => [entity.primaryPrefix, ...entity.prefixes].map((prefix) => ({ prefix: cleanPrefix(prefix), exact: false, entity }))));
  }

  lookup(input: string): GeographyMatch | null {
    const call = normalizeCallsign(input);
    if (!call) return null;
    if (this.cache.has(call)) return this.cache.get(call)!;

    let entity: Entity | undefined;
    let matchedPrefix = "";
    for (const candidate of lookupCandidates(call)) {
      const exact = this.exact.get(candidate);
      if (exact) {
        entity = exact;
        matchedPrefix = candidate;
        break;
      }
      for (let length = candidate.length; length > 0; length -= 1) {
        const prefix = candidate.slice(0, length);
        const hit = this.prefixes.get(prefix);
        if (hit) {
          entity = hit;
          matchedPrefix = prefix;
          break;
        }
      }
      if (entity) break;
    }

    if (entity?.name === "Guantanamo Bay" && matchedPrefix === "KG4" && isOrdinaryUsKg4(call) && this.usEntity) {
      entity = this.usEntity;
      matchedPrefix = "K";
    }

    const match = entity ? {
      country: entity.name.replace(/:$/, ""),
      continent: entity.continent === "AN" ? "OC" : entity.continent.replace("*", ""),
      cqZone: entity.cqZone,
      ituZone: entity.ituZone,
      latitude: entity.latitude,
      longitude: entity.longitude,
      utcOffset: entity.utcOffset,
      primaryPrefix: entity.primaryPrefix,
      matchedPrefix,
    } : null;

    if (this.cache.size >= CACHE_LIMIT) this.cache.clear();
    this.cache.set(call, match);
    return match;
  }

  get prefixCount(): number {
    return this.prefixes.size + this.exact.size;
  }

  get entityCount(): number {
    return new Set([...this.prefixes.values(), ...this.exact.values()].map((entity) => `${entity.name}\0${entity.primaryPrefix}`)).size;
  }

  get exactCallCount(): number {
    return this.exact.size;
  }
}

function parseCtyToken(token: string, base: Entity): PrefixRecord | null {
  let text = token.trim().replace(/[;,]+$/, "");
  if (!text) return null;
  const exact = text.startsWith("=");
  if (exact) text = text.slice(1);
  const cq = text.match(/\((\d+)\)/)?.[1];
  const itu = text.match(/\[(\d+)\]/)?.[1];
  const continent = text.match(/\{([A-Z]{2})\}/i)?.[1];
  const coordinates = text.match(/<(-?[\d.]+)\/(-?[\d.]+)>/);
  const utc = text.match(/~(-?[\d.]+)~/)?.[1];
  const prefix = cleanPrefix(text.replace(/\([^)]*\)|\[[^\]]*\]|<[^>]*>|\{[^}]*\}|~[^~]*~/g, ""));
  if (!prefix) return null;
  return {
    prefix,
    exact,
    entity: {
      ...base,
      cqZone: cq ? Number(cq) : base.cqZone,
      ituZone: itu ? Number(itu) : base.ituZone,
      continent: continent?.toUpperCase() ?? base.continent,
      latitude: coordinates ? Number(coordinates[1]) : base.latitude,
      // CTY.DAT stores longitude as positive west and its GMT field with the
      // opposite sign to JavaScript/ISO UTC offsets, including token overrides.
      longitude: coordinates ? -Number(coordinates[2]) : base.longitude,
      utcOffset: utc ? -Number(utc) : base.utcOffset,
    },
  };
}

export function parseCtyDat(source: string): PrefixRecord[] {
  if (!source.trim() || /<html|<body/i.test(source)) return [];
  const chunks = source.replace(/\r/g, "").split(";");
  const records: PrefixRecord[] = [];
  for (const chunk of chunks) {
    const line = chunk.split("\n").map((part) => part.trim()).filter((part) => part && !part.startsWith("#")).join(" ");
    const fields = line.split(":");
    if (fields.length < 9) continue;
    const [name, cq, itu, continent, latitude, longitude, utc, primary, ...aliases] = fields;
    const base: Entity = {
      name: name!.trim(), cqZone: Number(cq) || null, ituZone: Number(itu) || 0,
      continent: continent!.trim().toUpperCase(), latitude: Number(latitude) || 0,
      longitude: -(Number(longitude) || 0), utcOffset: -(Number(utc) || 0),
      primaryPrefix: cleanPrefix(primary!), prefixes: [],
    };
    for (const token of [primary!, ...aliases.join(":").split(/[\s,]+/)]) {
      const parsed = parseCtyToken(token, base);
      if (parsed) records.push(parsed);
    }
  }
  return records;
}

export function wpxPrefix(input: string): string {
  const call = normalizeCallsign(input);
  if (!call) return "";
  const parts = call.split("/").filter(Boolean);
  const base = baseCall(call);
  const location = parts.find((part) => part !== base && !PORTABLE_SUFFIXES.has(part) && /[A-Z]/.test(part));
  const source = (location || base).replace(/[^A-Z0-9]/g, "");
  const digit = source.search(/\d(?!.*\d)/);
  if (digit >= 0) return source.slice(0, digit + 1);
  const letters = source.replace(/[^A-Z]/g, "");
  return letters ? `${letters.slice(0, 2)}0` : "";
}

export function maidenheadCenter(locator: string): { latitude: number; longitude: number } | null {
  const grid = locator.trim().toUpperCase();
  if (!/^[A-R]{2}\d{2}(?:[A-X]{2})?(?:\d{2})?$/.test(grid)) return null;
  let longitude = (grid.charCodeAt(0) - 65) * 20 - 180;
  let latitude = (grid.charCodeAt(1) - 65) * 10 - 90;
  let width = 2;
  let height = 1;
  longitude += Number(grid[2]) * 2;
  latitude += Number(grid[3]);
  if (grid.length >= 6) {
    width /= 24; height /= 24;
    longitude += (grid.charCodeAt(4) - 65) * width;
    latitude += (grid.charCodeAt(5) - 65) * height;
  }
  if (grid.length >= 8) {
    width /= 10; height /= 10;
    longitude += Number(grid[6]) * width;
    latitude += Number(grid[7]) * height;
  }
  return { latitude: latitude + height / 2, longitude: longitude + width / 2 };
}

export function maidenheadDistanceKm(first: string, second: string): number | null {
  const a = maidenheadCenter(first);
  const b = maidenheadCenter(second);
  if (!a || !b) return null;
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);
  const deltaLat = radians(b.latitude - a.latitude);
  const deltaLon = radians(b.longitude - a.longitude);
  const h = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export const geography = new GeographyDatabase();
