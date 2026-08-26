import { bandFromFrequency, callsignPrefix } from "./radio";
import { geography, maidenheadDistanceKm, wpxPrefix } from "./geography";
import type { GeographyMatch } from "./geography";
import { isWaedcEuropean } from "./waedc";
import type { CabrilloDocument, ScoreResult, ScoreRow } from "./types";
import { DRCGWW_ZONE_POINTS } from "../data/drcgww-points.generated";

export interface ScoringContext {
  band: string;
  stationCall: string;
  station: GeographyMatch | null;
  worked: GeographyMatch | null;
  state: Map<string, Set<string>>;
}

export interface ScoringRule {
  id: string;
  name: string;
  description: string;
  points: (qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext) => number;
  bonusPoints?: (qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext) => number;
  multiplier: (qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext) => string;
  band?: (qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>) => string;
  duplicateKey?: (qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, band: string) => string;
  duplicatePolicy?: "band-mode-call" | "none";
  fixedMultipliers?: number;
  minimumMultipliers?: number;
  multiplierScope?: "global" | "band";
  bandMultiplier?: (band: string) => number;
  total?: (points: number, multipliers: number, rows: readonly ScoreRow[], document?: CabrilloDocument) => number;
  scoreBonus?: (document: CabrilloDocument) => number;
  scoreFormula?: (points: number, multipliers: number, bonus: number) => string;
  multiplierCount?: (rows: readonly ScoreRow[]) => number;
  bandMultiplierCount?: (rows: readonly ScoreRow[], band: string) => number;
  notes?: readonly string[];
}

function recoveredLocatorDistancePoints(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>): number {
  const distance = maidenheadDistanceKm(locatorValue(qso, "sent"), locatorValue(qso, "received"));
  return distance === null ? 0 : Math.floor(distance);
}

function recoveredWwDigiDistancePoints(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>): number {
  const distance = maidenheadDistanceKm(locatorValue(qso, "sent"), locatorValue(qso, "received"));
  return distance === null ? 0 : Math.floor(Math.ceil(distance) / 3000) + 1;
}

function avhfcLocator(value: string): string {
  const locator = value.split(",")[0]!.trim().toUpperCase();
  if (locator.length === 4) return `${locator}55AA`;
  return locator.length > 6 ? locator.slice(0, 6) : locator;
}

function avhfcDistanceBonus(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>): number {
  const sent = avhfcLocator(locatorValue(qso, "sent"));
  const received = avhfcLocator(locatorValue(qso, "received"));
  if (!sent || !received) return 0;
  if (sent === received) return 1;
  const distance = maidenheadDistanceKm(sent, received);
  return distance === null ? 0 : Math.floor(distance);
}

function qsoCell(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, key: string): string {
  return qso.cells.find((cell) => cell.key === key)?.value.trim().toUpperCase() ?? "";
}

function locatorValue(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, direction: "sent" | "received"): string {
  return direction === "sent"
    ? qsoCell(qso, "MY_GRIDSQUARE") || qsoCell(qso, "STX_STRING")
    : qsoCell(qso, "GRIDSQUARE") || qsoCell(qso, "SRX_STRING");
}

function bandProductTotal(_points: number, _multipliers: number, rows: readonly ScoreRow[]): number {
  const bands = new Map<string, { points: number; multipliers: Set<string> }>();
  for (const row of rows) {
    const current = bands.get(row.band) ?? { points: 0, multipliers: new Set<string>() };
    current.points += row.points;
    if (row.multiplier) current.multipliers.add(row.multiplier);
    bands.set(row.band, current);
  }
  return [...bands.values()].reduce((sum, band) => sum + band.points * band.multipliers.size, 0);
}

function dxccAndWpxMultiplierCount(rows: readonly ScoreRow[], band?: string): number {
  const values = new Set<string>();
  for (const row of rows) {
    if (row.duplicate || row.points <= 0 || (band && row.band !== band)) continue;
    if (row.country && row.country !== "Unknown") values.add(`DXCC|${row.country}`);
    const prefix = wpxPrefix(row.call);
    if (prefix) values.add(`WPX|${prefix}`);
  }
  return values.size;
}

function avhfcTotal(_points: number, _multipliers: number, rows: readonly ScoreRow[]): number {
  const bands = new Map<string, { points: number; bonus: number; multipliers: Set<string> }>();
  for (const row of rows) {
    const current = bands.get(row.band) ?? { points: 0, bonus: 0, multipliers: new Set<string>() };
    current.points += row.points;
    current.bonus += row.bonusPoints ?? 0;
    if (row.multiplier) current.multipliers.add(row.multiplier);
    bands.set(row.band, current);
  }
  return [...bands.values()].reduce((sum, band) => sum + band.points * band.multipliers.size + band.bonus, 0);
}

function recoveredXmasDok(value: string): string {
  const dok = value.trim().toUpperCase();
  return dok.length === 3 && dok.charCodeAt(0) >= 65 && dok.charCodeAt(1) <= 57 && dok.charCodeAt(2) <= 57 ? dok : "";
}

function isEstonianPrefix(call: string): boolean {
  return wpxPrefix(call).slice(0, 2) === "ES";
}

function xmasMultiplierCount(rows: readonly ScoreRow[], band?: string): number {
  const values = new Set<string>();
  for (const row of rows) {
    if (row.duplicate || row.points <= 0 || (band && row.band !== band)) continue;
    const scope = row.band;
    const prefix = row.multiplier.match(/WPX:([^;]+)/)?.[1]?.trim();
    const dok = row.multiplier.match(/DOK:([^;]+)/)?.[1]?.trim();
    if (prefix) values.add(`${scope}|WPX|${prefix}`);
    if (dok) values.add(`${scope}|DOK|${dok}`);
  }
  return values.size;
}

function recoveredUbaSection(value: string): string {
  const section = value.trim();
  return section.length > 2 && /^[A-Z]{2}/.test(section) ? section : "";
}

function ubaPskMultiplierCount(rows: readonly ScoreRow[], band?: string): number {
  const values = new Set<string>();
  for (const row of rows) {
    if (row.duplicate || row.points <= 0 || (band && row.band !== band)) continue;
    const prefix = row.multiplier.match(/WPX:([^;]+)/)?.[1]?.trim();
    const section = row.multiplier.match(/UBA:([^;]+)/)?.[1]?.trim();
    if (prefix) values.add(`${row.band}|WPX|${prefix}`);
    if (section) values.add(`${row.band}|UBA|${section}`);
  }
  return values.size;
}

const KCJ_JAPANESE_PREFIXES = new Set([
  "7J", "8J", "7L", "7N", "7K", "7M", "8K", "8L", "8M", "8N",
  "JA", "JB", "JC", "JD", "JE", "JF", "JG", "JH", "JI", "JJ",
  "JK", "JL", "JM", "JN", "JO", "JP", "JQ", "JR", "JS",
]);

function isKcjJapanese(call: string): boolean {
  const normalized = call.trim().toUpperCase();
  return !normalized.includes("/MM") && KCJ_JAPANESE_PREFIXES.has(wpxPrefix(normalized).slice(0, 2));
}

function recoveredKcjContinent(value: string): string {
  const exchange = value.trim().toUpperCase();
  // The DLL performs a substring search rather than token equality.
  return exchange && " AF AS EU NA OC SA ".includes(exchange) ? exchange : "";
}

const SARL_HF_AREA_8_PREFIXES = ["ZS7", "ZS8", "ZD9", "7P", "7Q", "C9", "Z2", "5R", "FR", "FH", "9J", "A2", "D2", "V5"] as const;
const SARL_HF_TARGET_PREFIXES = ["3B8", "3DA", "ZS", ...SARL_HF_AREA_8_PREFIXES] as const;

function sarlHfPrefix(call: string): string {
  const prefix = wpxPrefix(call);
  const legacyPrefix = prefix.slice(0, 3);
  return legacyPrefix && SARL_HF_TARGET_PREFIXES.some((candidate) => legacyPrefix.includes(candidate)) ? prefix : "";
}

function sarlHfArea(prefix: string): number {
  const legacyPrefix = prefix.slice(0, 3);
  for (let area = 1; area <= 6; area += 1) if (legacyPrefix.includes(`ZS${area}`)) return area;
  if (legacyPrefix.includes("3B8") || legacyPrefix.includes("3DA")) return 7;
  if (SARL_HF_AREA_8_PREFIXES.some((candidate) => legacyPrefix.includes(candidate))) return 8;
  return legacyPrefix.includes("ZS") ? 9 : 0;
}

function sarlHfBandState(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): { prefix: string; area: number; key: string } | null {
  if (context.band === "OTHER") return null;
  const prefix = sarlHfPrefix(qso.call);
  const area = sarlHfArea(prefix);
  return prefix && area ? { prefix, area, key: `${prefix}:${context.band}` } : null;
}

function sarlHfBonus(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  const current = sarlHfBandState(qso, context);
  const pending = new Set<string>();
  context.state.set("sarl-hf-current-area", pending);
  if (!current) return 0;
  const seen = context.state.get("sarl-hf-prefix-bands") ?? new Set<string>();
  context.state.set("sarl-hf-prefix-bands", seen);
  if (seen.has(current.key)) return 0;
  const priorBands = [...seen].filter((value) => value.startsWith(`${current.prefix}:`)).length;
  seen.add(current.key);
  pending.add(current.key);
  return priorBands === 2 ? 2 : 0;
}

function sarlHfMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  const current = sarlHfBandState(qso, context);
  const pending = context.state.get("sarl-hf-current-area");
  context.state.delete("sarl-hf-current-area");
  return current && pending?.has(current.key) ? `AREA:${current.area}` : "";
}

function sarlHfTotal(points: number, multipliers: number, rows: readonly ScoreRow[]): number {
  return points + multipliers * 2 + rows.reduce((sum, row) => sum + (row.bonusPoints ?? 0), 0);
}

const CIS_PREFIX_FRAGMENTS = [
  "RI1AN", "4J", "4K", "EK", "ER", "EV", "EU", "EW", "EX", "EY", "EZ",
  "UK", "UJ", "UL", "UM", "UN", "UO", "UP", "UQ", "EM", "EN", "EO", "U", "R",
] as const;

function isRecoveredCisCall(call: string): boolean {
  const normalized = call.trim().toUpperCase();
  if (normalized.slice(0, 4) === "R1AN" || normalized.includes("RI1AN")) return false;
  const prefix = wpxPrefix(normalized).slice(0, 2);
  return !!prefix && CIS_PREFIX_FRAGMENTS.some((candidate) => prefix.includes(candidate));
}

function isCisMobile(call: string): boolean {
  return /\/(?:M|MM)$/i.test(call.trim());
}

const CA_PARTY_US_PREFIXES = [
  "AA", "AB", "AC", "AD", "AE", "AF", "AI", "AJ", "AK", "AH", "KH", "NH", "WH",
  "AL", "KL", "NL", "WL", "KP", "NP", "WP", "AG", "KG", "NG", "WG", "K", "W", "N",
] as const;
const CA_PARTY_CANADIAN_PREFIXES = [
  "CF", "CG", "CH", "CI", "CJ", "CK", "CY", "CZ", "VA", "VB", "VC", "VD", "VE", "VF",
  "VG", "VO", "VX", "VY", "XJ", "XK", "XL", "XM", "XN", "XO",
] as const;
const CA_PARTY_US_SECTIONS = new Set("CT MA ME NH RI VT NY NJ DE PA MD DC AL GA KY NC FL SC TN VA AR LA MS NM TX OK CA HI AK AZ ID MT NV OR UT WA WY MI OH WV IL IN WI CO IA KS MN MO NE ND SD".split(" "));
const CA_PARTY_CANADIAN_SECTIONS = new Set("MR QC ON MB SK AB BC NT".split(" "));
const NY_QP_CANADIAN_SECTIONS = new Set("MAR NL QC ON MB SK AB BC NT".split(" "));
const NY_QP_COUNTIES = new Set("ALB ALL BRX BRM CAT CAY CHA CHE CGO CLI COL COR DEL DUT ERI ESS FRA FUL GEN GRE HAM HER JEF KIN LEW LIV MAD MON MTG NAS NEW NIA ONE ONO ONT ORA ORL OSW OTS PUT QUE REN ROC RIC SAR SCH SCO SCU SEN STL STE SUF SUL TIO TOM ULS WAR WAS WAY WES WYO YAT".split(" "));
const RAC_PROVINCES = new Set("NS QC ON MB SK AB BC NT NB NL NU YT PE".split(" "));
const RAC_STATIONS = new Set("VA2RAC VA3RAC VE1RAC VE4RAC VE5RAC VE6RAC VE7RAC VE8RAC VE9RAC VO1RAC VO2RAC VY0RAC VY1RAC VY2RAC".split(" "));
const TEN_RTTY_US_STATES = new Set("CT MA ME NH RI VT NY NJ DE PA MD DC AL GA KY NC FL SC TN VA AR LA MS NM TX OK CA HI AK AZ ID MT NV OR UT WA WY MI OH WV IL IN WI CO IA KS MN MO NE ND SD".split(" "));
const TEN_RTTY_CANADIAN_PROVINCES = new Set("NB NS QC ON MB SK AB BC NT NF LB YT PE NU".split(" "));

function recoveredPrefixFragment(call: string, values: readonly string[]): boolean {
  const prefix = wpxPrefix(call).slice(0, 2);
  return !!prefix && values.some((candidate) => prefix.includes(candidate));
}

function isRecoveredCaPartyUsCall(call: string): boolean {
  const normalized = call.trim().toUpperCase();
  if (!recoveredPrefixFragment(normalized, CA_PARTY_US_PREFIXES)) return false;
  const special = ["AG4", "KG4", "NG4", "WG4"].find((value) => normalized.includes(value));
  return !special || normalized.slice(normalized.indexOf(special) + 3).trim().length >= 3;
}

function caPartyMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, band: string): string {
  if (band === "OTHER") return "";
  const exchange = qso.receivedExchange.trim();
  if (!exchange) return "";
  // StartLine selects the in-California branch solely from the four-character
  // sent-QTH width. Outside entrants receive every worked county verbatim.
  if (qso.sentExchange.trim().length !== 4) return `COUNTY:${exchange}`;
  if (isRecoveredCaPartyUsCall(qso.call)) {
    const section = exchange.length === 4 ? "CA" : exchange;
    return CA_PARTY_US_SECTIONS.has(section) ? `US:${section}` : "";
  }
  return recoveredPrefixFragment(qso.call, CA_PARTY_CANADIAN_PREFIXES) && CA_PARTY_CANADIAN_SECTIONS.has(exchange)
    ? `CA:${exchange}`
    : "";
}

function nyQpMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, band: string): string {
  if (band === "OTHER") return "";
  const sent = qso.sentExchange.trim();
  const received = qso.receivedExchange.trim();
  if (!received || received === "DX") return "";
  const stationIsNy = NY_QP_COUNTIES.has(sent);
  if (!stationIsNy) return isRecoveredCaPartyUsCall(qso.call) && NY_QP_COUNTIES.has(received) ? `NYC:${received}` : "";
  if (isRecoveredCaPartyUsCall(qso.call)) {
    if (NY_QP_COUNTIES.has(received)) return `NYC:${received}; US:NY`;
    return CA_PARTY_US_SECTIONS.has(received) ? `US:${received}` : "";
  }
  return recoveredPrefixFragment(qso.call, CA_PARTY_CANADIAN_PREFIXES) && NY_QP_CANADIAN_SECTIONS.has(received)
    ? `CA:${received}`
    : "";
}

function scoringMultiplierTokens(value: string): string[] {
  return value.split(";").map((token) => token.trim()).filter(Boolean);
}

function tokenMultiplierCount(rows: readonly ScoreRow[], band?: string): number {
  const seen = new Set<string>();
  let count = 0;
  for (const row of rows) {
    if (row.duplicate || row.points <= 0) continue;
    for (const token of scoringMultiplierTokens(row.multiplier)) {
      if (seen.has(token)) continue;
      seen.add(token);
      if (!band || row.band === band) count += 1;
    }
  }
  return count;
}

function isRecoveredCanadianCall(call: string): boolean {
  return recoveredPrefixFragment(call, CA_PARTY_CANADIAN_PREFIXES);
}

function georgiaMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (context.band !== "80M" || !context.worked) return "";
  const prefix = wpxPrefix(qso.call);
  if (!prefix) return "";
  const tokens: string[] = [];
  if (context.worked.primaryPrefix === "4L") tokens.push(`4L:${qso.call.trim().toUpperCase()}`);
  tokens.push(`DXCC:${context.worked.country}`, `WPX:${prefix}`);
  return tokens.join("; ");
}

function tenRttyMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (context.band !== "10M" || !context.worked) return "";
  let exchange = qso.receivedExchange.trim();
  if (context.worked.primaryPrefix === "W") return TEN_RTTY_US_STATES.has(exchange) ? `STATE:${exchange}` : "";
  if (context.worked.primaryPrefix === "VE") {
    if (exchange === "PEI") exchange = "PE";
    else if (exchange === "NWT") exchange = "NT";
    return TEN_RTTY_CANADIAN_PROVINCES.has(exchange) ? `PROVINCE:${exchange}` : "";
  }
  return `DXCC:${context.worked.country}`;
}

const AADX_LEGACY_BANDS: Readonly<Record<string, string>> = {
  "50": "6M", "70": "4M", "144": "2M", "222": "1.25M", "432": "70CM", "903": "33CM",
  "1.2": "23CM", "2.3": "13CM", "3.4": "9CM", "5.6": "6CM", "10": "3CM", "24": "1.25CM",
  "47": "6MM", "76": "4MM", "119": "2.5MM", "142": "2MM", "241": "1MM",
};

function aadxBand(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>): string {
  const frequency = qso.frequency.trim().toUpperCase();
  return AADX_LEGACY_BANDS[frequency] ?? (bandFromFrequency(frequency) || "OTHER");
}

function aadxPoints(context: ScoringContext): number {
  if (!context.station || !context.worked || context.band === "OTHER") return 0;
  const factor = context.band === "160M" ? 3 : context.band === "80M" || context.band === "12M" ? 2 : 1;
  return context.station.continent === "AS" && context.worked.continent !== "AS" ? factor * 3 : factor;
}

function aadxMultiplier(_qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (!context.station || !context.worked || context.band === "OTHER") return "";
  return context.station.continent === "AS"
    ? `DXCC:${context.worked.primaryPrefix}`
    : `CONT:${context.worked.continent}`;
}

function afdxModeGroup(mode: string): string {
  const normalized = mode.trim().toUpperCase();
  return normalized === "PH" || normalized === "CW" ? normalized : "OTHER";
}

function afdxMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (context.band === "OTHER" || context.worked?.continent !== "AF" || !qso.receivedExchange.trim()) return "";
  return `AF:${afdxModeGroup(qso.mode)}:${context.worked.primaryPrefix}`;
}

function afdxMultiplierCount(rows: readonly ScoreRow[], band?: string): number {
  const bands = new Map<string, Set<string>>();
  for (const row of rows) {
    if (row.points <= 0 || row.duplicate || (band && row.band !== band)) continue;
    const values = bands.get(row.band) ?? new Set<string>();
    if (row.multiplier) values.add(row.multiplier);
    bands.set(row.band, values);
  }
  return [...bands.values()].reduce((sum, values) => sum + Math.max(1, values.size), 0);
}

function afdxTotal(_points: number, _multipliers: number, rows: readonly ScoreRow[]): number {
  const bands = new Map<string, { points: number; multipliers: Set<string> }>();
  for (const row of rows) {
    if (row.points <= 0 || row.duplicate) continue;
    const values = bands.get(row.band) ?? { points: 0, multipliers: new Set<string>() };
    values.points += row.points;
    if (row.multiplier) values.multipliers.add(row.multiplier);
    bands.set(row.band, values);
  }
  return [...bands.values()].reduce((sum, values) => sum + values.points * Math.max(1, values.multipliers.size), 0);
}

function agbMemberNumber(exchange: string): string {
  const normalized = exchange.trim().toUpperCase();
  const delimiter = Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"), normalized.lastIndexOf("A"));
  if (delimiter < 0 || delimiter === normalized.length - 1) return "";
  const member = normalized.slice(delimiter + 1).trim();
  const numeric = Number.parseInt(member, 10);
  return numeric > 0 ? String(numeric) : member;
}

function agbMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (context.band !== "80M" || !context.worked || !qso.receivedExchange.trim()) return "";
  const tokens: string[] = [];
  if (!/(?:\/M|\/A|\/P|\/MM)$/i.test(qso.call.trim())) tokens.push(`DXCC:${context.worked.primaryPrefix}`);
  const member = agbMemberNumber(qso.receivedExchange);
  if (member) tokens.push(`AGB:${member}`);
  return tokens.join("; ");
}

const ARI_PROVINCES = new Set("AL AT BI CN GE IM NO SP SV TO VB VC AO BG BS CO CR LC LO MB MI MN PV SO VA BL PD RO TV VE VI VR BZ TN GO PN TS UD BO FC FE MO PC PR RA RE RN AR FI GR LI LU MS PI PO PT SI AN AP AQ CH FM MC PE PS PU TE BA BR BT FG LE MT TA AV BN CB CE CS CZ IS KR NA PZ RC SA VV FR LT PG RI RM ROMA TR VT AG CL CT EN ME PA RG SR TP CA CI NU OG OR OT SS VS".split(" "));
const ARI_ITALIAN_DXCC = new Set(["I", "IS", "IT9"]);

function isRecoveredItalianCall(call: string): boolean {
  const prefix = wpxPrefix(call.trim().toUpperCase());
  return prefix.startsWith("I") && !prefix.includes("IG9") && !prefix.includes("IH9");
}

function ariMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (context.band === "OTHER" || !context.worked || !qso.receivedExchange.trim()) return "";
  const stationItalian = isRecoveredItalianCall(context.stationCall);
  if (!stationItalian && isRecoveredItalianCall(qso.call)) {
    const province = qso.receivedExchange.trim();
    return ARI_PROVINCES.has(province) ? `PROV:${province}` : "";
  }
  return ARI_ITALIAN_DXCC.has(context.worked.primaryPrefix) ? "" : `DXCC:${context.worked.primaryPrefix}`;
}

function ariMultiplierCount(rows: readonly ScoreRow[], band?: string): number {
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.duplicate || (band && row.band !== band)) continue;
    for (const token of scoringMultiplierTokens(row.multiplier)) seen.add(`${row.band}|${token}`);
  }
  return seen.size;
}

function arrl10ModeGroup(mode: string): string {
  return mode.trim().toUpperCase() === "CW" ? "CW" : "OTHER";
}

function arrl10Multiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (context.band !== "10M" || !context.worked) return "";
  let exchange = qso.receivedExchange.trim();
  if (!exchange) return "";
  const group = arrl10ModeGroup(qso.mode);
  const call = qso.call.trim().toUpperCase();
  if (/(?:\/M|\/MM)$/i.test(call)) return `${group}:MOBILE:${exchange}`;
  if (context.worked.primaryPrefix === "W" || context.worked.primaryPrefix === "KL7" || context.worked.primaryPrefix === "KH6") {
    return TEN_RTTY_US_STATES.has(exchange) ? `${group}:STATE:${exchange}` : "";
  }
  if (context.worked.primaryPrefix === "VE") {
    if (exchange === "PEI") exchange = "PE";
    else if (exchange === "NWT") exchange = "NT";
    return TEN_RTTY_CANADIAN_PROVINCES.has(exchange) ? `${group}:PROVINCE:${exchange}` : "";
  }
  if (context.worked.primaryPrefix === "XE") return `${group}:MEXICO:${call}`;
  return `${group}:DXCC:${context.worked.primaryPrefix}`;
}

const ARRL_160_SECTIONS = new Set("AK AL AR AZ CO CT DE EB EMA ENY EPA EWA GA IA ID IL IN KS KY LA LAX MDC ME MI MN MO MS MT NC ND NE NFL NH NLI NM NNJ NNY NTX NV OH OK OR ORG PAC PR RI SB SC SCV SD SDG SF SFL SJV SNJ STX SV TN UT VA VI VT WI WCF WMA WNY WPA WTX WV WWA WY AB BC MAR MB NL NT ON QC SK".split(" "));

function arrl160Region(call: string): "US" | "CA" | "DX" {
  if (isRecoveredCaPartyUsCall(call)) return "US";
  return isRecoveredCanadianCall(call) ? "CA" : "DX";
}

function arrl160Multiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (context.band !== "160M" || !context.worked || !qso.receivedExchange.trim()) return "";
  const stationRegion = arrl160Region(context.stationCall);
  const workedRegion = arrl160Region(qso.call);
  if (stationRegion === "DX" && workedRegion === "DX") return "";
  if (workedRegion === "DX") return `DXCC:${context.worked.primaryPrefix}`;
  const section = qso.receivedExchange.trim() === "NWT" ? "NT" : qso.receivedExchange.trim();
  return ARRL_160_SECTIONS.has(section) ? `SECTION:${section}` : "";
}

function arrlDxRegion(call: string): "US" | "CA" | "DX" {
  if (isRecoveredCaPartyUsCall(call)) return "US";
  return isRecoveredCanadianCall(call) ? "CA" : "DX";
}

function arrlDxMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (context.band === "OTHER" || !context.worked || !qso.receivedExchange.trim()) return "";
  const stationDomestic = arrlDxRegion(context.stationCall) !== "DX";
  const workedRegion = arrlDxRegion(qso.call);
  if (stationDomestic) return workedRegion === "DX" ? `DXCC:${context.worked.primaryPrefix}` : "";
  if (workedRegion === "US") return `STATE:${qso.receivedExchange.trim()}`;
  if (workedRegion === "CA") return `PROVINCE:${qso.receivedExchange.trim()}`;
  return "";
}

const ARRL_RTTY_AREAS = new Set("CT MA ME NH RI VT NY NJ DE PA MD DC AL GA KY NC FL SC TN VA AR LA MS NM TX OK CA HI AK AZ ID MT NV OR UT WA WY MI OH WV IL IN WI CO IA KS MN MO NE ND SD NB NS QC ON MB SK AB BC NT NF LB YT PE NU PEI NWT".split(" "));

function arrlRttyMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (context.band === "OTHER" || !context.worked || !qso.receivedExchange.trim()) return "";
  if (arrlDxRegion(qso.call) === "DX") return `DXCC:${context.worked.primaryPrefix}`;
  const area = qso.receivedExchange.trim();
  return ARRL_RTTY_AREAS.has(area) ? `AREA:${area}` : "";
}

const BARTG_AREA_PREFIXES = new Set(["JA", "VE", "W", "VK"]);

function bartgMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (context.band === "OTHER" || !context.worked || !qso.receivedExchange.trim()) return "";
  const tokens = [`DXCC:${context.worked.primaryPrefix}`];
  if (BARTG_AREA_PREFIXES.has(context.worked.primaryPrefix)) {
    const area = wpxPrefix(qso.call).match(/\d/)?.[0];
    if (area) tokens.push(`AREA:${context.worked.primaryPrefix}${area}`);
  }
  if (context.worked.continent) tokens.push(`CONT:${context.worked.continent}`);
  return tokens.join("; ");
}

function bartgFactorSets(rows: readonly ScoreRow[], band?: string): { bandMultipliers: Set<string>; continents: Set<string> } {
  const bandMultipliers = new Set<string>();
  const continents = new Set<string>();
  for (const row of rows) {
    if (row.duplicate || row.points <= 0 || (band && row.band !== band)) continue;
    for (const token of scoringMultiplierTokens(row.multiplier)) {
      if (token.startsWith("CONT:")) continents.add(token);
      else bandMultipliers.add(`${row.band}|${token}`);
    }
  }
  return { bandMultipliers, continents };
}

function bartgMultiplierCount(rows: readonly ScoreRow[], band?: string): number {
  const factors = bartgFactorSets(rows, band);
  return factors.bandMultipliers.size + (band ? 0 : factors.continents.size);
}

function bartgTotal(points: number, _multipliers: number, rows: readonly ScoreRow[]): number {
  const factors = bartgFactorSets(rows);
  return points * factors.bandMultipliers.size * factors.continents.size;
}

function bartgSprintMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  const candidates = scoringMultiplierTokens(bartgMultiplier(qso, context));
  const accepted: string[] = [];
  for (const token of candidates) {
    const storeName = `bartg-sprint-${token.slice(0, token.indexOf(":"))}`;
    const store = context.state.get(storeName) ?? new Set<string>();
    context.state.set(storeName, store);
    if (store.has(token)) continue;
    store.add(token);
    accepted.push(token);
  }
  return accepted.join("; ");
}

function bartgSprintFactors(rows: readonly ScoreRow[], band?: string): { multipliers: Set<string>; continents: Set<string> } {
  const multipliers = new Set<string>();
  const continents = new Set<string>();
  for (const row of rows) {
    if (row.duplicate || row.points <= 0 || (band && row.band !== band)) continue;
    for (const token of scoringMultiplierTokens(row.multiplier)) {
      if (token.startsWith("CONT:")) continents.add(token);
      else multipliers.add(token);
    }
  }
  return { multipliers, continents };
}

function bartgSprintMultiplierCount(rows: readonly ScoreRow[], band?: string): number {
  const factors = bartgSprintFactors(rows, band);
  return factors.multipliers.size + factors.continents.size;
}

function bartgSprintTotal(points: number, _multipliers: number, rows: readonly ScoreRow[]): number {
  const factors = bartgSprintFactors(rows);
  return points * factors.multipliers.size * factors.continents.size;
}

function cqmRussianParts(call: string): { digit: string; suffix: string } | null {
  const match = call.trim().toUpperCase().match(/([0-9])([A-Z])/);
  return match ? { digit: match[1]!, suffix: match[2]! } : null;
}

function cqmRussianZone(call: string, primaryPrefix: string): string {
  if (primaryPrefix === "RA2") return "SZ";
  if (primaryPrefix !== "RA1" && primaryPrefix !== "RA0") return "";
  const parts = cqmRussianParts(call);
  if (!parts) return "";
  const { digit, suffix } = parts;
  if (digit === "1") return "SZ";
  if ("234".includes(digit)) return suffix === "T" ? "CE" : "PV";
  if (digit === "5") return suffix === "A" ? "YU" : "CE";
  if ("67".includes(digit)) return "ALIUY".includes(suffix) ? "YU" : "SK";
  if ("89".includes(digit)) {
    if ("FSW".includes(suffix)) return "CE";
    if (suffix === "X") return "SZ";
    return "VTHZOUYM".includes(suffix) ? "UR" : "SI";
  }
  if (digit === "0") return "ABHOSUWY".includes(suffix) ? "UR" : "DV";
  return "";
}

function cqmRussianMultiplier(call: string, primaryPrefix: string): string {
  if (primaryPrefix !== "RA1" && primaryPrefix !== "RA0" && primaryPrefix !== "RA2") return primaryPrefix;
  const parts = cqmRussianParts(call);
  if (!parts) return primaryPrefix;
  const { digit, suffix } = parts;
  if (digit === "1" && suffix === "N") return "R1N";
  if (digit === "5") {
    const value: Readonly<Record<string, string>> = { S: "R4S", P: "R4P", U: "R4U", W: "R4W", Y: "R4Y" };
    return value[suffix] ?? primaryPrefix;
  }
  if (digit === "6" || digit === "7") {
    const value: Readonly<Record<string, string>> = { Z: "R9Z", I: "R6I", E: "R6E", P: "R6P", Q: "R6Q", W: "R6W", Y: "R6Y" };
    return value[suffix] ?? primaryPrefix;
  }
  if (digit === "8" || digit === "9") {
    const value: Readonly<Record<string, string>> = { W: "R9W", X: "R9X", M: "R9Z" };
    return value[suffix] ?? primaryPrefix;
  }
  if (digit === "0") {
    const value: Readonly<Record<string, string>> = { O: "R0O", Q: "R0Q", W: "R0W", Y: "R0Y" };
    return value[suffix] ?? primaryPrefix;
  }
  return primaryPrefix;
}

function cqmPoints(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.station || !context.worked) return 0;
  if (qso.call.toUpperCase().includes("/MM")) return 3;
  const stationZone = cqmRussianZone(context.stationCall, context.station.primaryPrefix);
  const workedZone = cqmRussianZone(qso.call, context.worked.primaryPrefix);
  if (stationZone && workedZone) return stationZone === workedZone ? 1 : 2;
  if (context.station.primaryPrefix === context.worked.primaryPrefix) return 1;
  return context.station.continent === context.worked.continent ? 2 : 3;
}

function cqmMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (context.band === "OTHER" || !context.worked || qso.call.toUpperCase().includes("/MM")) return "";
  return `COUNTRY:${cqmRussianMultiplier(qso.call, context.worked.primaryPrefix)}`;
}

function cqsaPortable(call: string): boolean {
  return call.toUpperCase().includes("/M");
}

function cqsaPoints(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.station || !context.worked) return 0;
  if (cqsaPortable(qso.call)) return 3;
  if (context.station.continent !== "SA" && context.worked.continent === "SA") return 10;
  if (context.station.primaryPrefix === context.worked.primaryPrefix) return 1;
  return context.station.continent === context.worked.continent ? 2 : 3;
}

function cqsaMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (context.band === "OTHER" || !context.worked || cqsaPortable(qso.call)) return "";
  const tokens = [`CONT:${context.worked.continent}`];
  if (context.worked.continent === "SA") tokens.push(`SA-DXCC:${context.worked.primaryPrefix}`);
  return tokens.join("; ");
}

const CQ_WPX_RTTY_BANDS = new Set(["80M", "40M", "20M", "15M", "10M"]);

function cqWpxRttyPoints(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (!CQ_WPX_RTTY_BANDS.has(context.band) || !context.station || !context.worked) return 0;
  const lowBand = context.band === "80M" || context.band === "40M";
  if (context.station.continent !== context.worked.continent) return lowBand ? 6 : 3;
  const sameEntity = context.station.primaryPrefix === context.worked.primaryPrefix && !qso.call.toUpperCase().includes("/MM");
  return sameEntity ? (lowBand ? 2 : 1) : (lowBand ? 4 : 2);
}

function cqWpxRttyMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (!CQ_WPX_RTTY_BANDS.has(context.band) || !context.worked) return "";
  const prefix = wpxPrefix(qso.call);
  if (!prefix) return "";
  const store = context.state.get("cq-wpx-rtty-prefix") ?? new Set<string>();
  context.state.set("cq-wpx-rtty-prefix", store);
  if (store.has(prefix)) return "";
  store.add(prefix);
  return `WPX:${prefix}`;
}

function cqWwZone(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>): string {
  // CQ-WW-RTTY has a dedicated CQZ cell; CW/SSB expose the received zone
  // through the ordinary received-exchange field.
  return (qsoCell(qso, "CQZ") || qso.receivedExchange.trim().split(/\s+/).at(-1) || "").toUpperCase();
}

function cqWwPoints(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.station || !context.worked || !cqWwZone(qso)) return 0;
  if (context.station.primaryPrefix === context.worked.primaryPrefix) return 0;
  if (context.station.continent !== context.worked.continent) return 3;
  return context.worked.continent === "NA" ? 2 : 1;
}

function cqWwMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  const zone = cqWwZone(qso);
  if (context.band === "OTHER" || !context.worked || !zone || /\/(?:MM|P|A|M)$/i.test(qso.call.trim())) return "";
  return `ZONE:${zone}; DXCC:${context.worked.primaryPrefix}`;
}

function cqWwMultiplierCount(rows: readonly ScoreRow[], band?: string): number {
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.duplicate || (band && row.band !== band)) continue;
    for (const token of scoringMultiplierTokens(row.multiplier)) seen.add(`${row.band}|${token}`);
  }
  return seen.size;
}

function gacwPoints(_qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.station || !context.worked) return 0;
  if (context.station.primaryPrefix === context.worked.primaryPrefix) return 0;
  if (context.station.continent === context.worked.continent) return 1;
  return context.worked.continent === "SA" ? 5 : 3;
}

function gacwMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (context.band === "OTHER" || !context.worked || /\/(?:MM|M)$/i.test(qso.call.trim())) return "";
  const zone = qsoCell(qso, "SRX_STRING") || qso.receivedExchange.trim().split(/\s+/).at(-1) || "";
  return `${zone ? `ZONE:${zone}; ` : ""}DXCC:${context.worked.primaryPrefix}`;
}

function isHungarianCall(call: string): boolean {
  const normalized = call.trim().toUpperCase().replace(/[^A-Z0-9/]/g, "");
  return normalized.startsWith("HA") || normalized.startsWith("HG");
}

function haDxPoints(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.station || !context.worked) return 0;
  const stationHungarian = isHungarianCall(context.stationCall);
  const workedHungarian = isHungarianCall(qso.call);
  if (stationHungarian) {
    if (workedHungarian) return 1;
    return context.station.continent === context.worked.continent ? 3 : 5;
  }
  if (workedHungarian) return 6;
  return context.station.continent === context.worked.continent ? 1 : 3;
}

function haDxMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (context.band === "OTHER" || !context.worked) return "";
  if (isHungarianCall(context.stationCall)) return `DXCC:${context.worked.primaryPrefix}`;
  if (!isHungarianCall(qso.call)) return "";
  const county = qsoCell(qso, "SRX_STRING") || qso.receivedExchange.trim().split(/\s+/).at(-1) || "";
  return county ? `COUNTY:${county}` : "";
}

function haDxMultiplierCount(rows: readonly ScoreRow[], band?: string): number {
  return Math.max(1, cqWwMultiplierCount(rows, band));
}

const HELVETIA_CANTONS = new Set("AG AI AR BE BL BS FR GE GL GR JU LU NE NW OW SG SH SO SZ TG TI UR VD VS ZG ZH".split(" "));

function isSwissHelvetiaCall(call: string): boolean {
  const normalized = call.trim().toUpperCase();
  if (normalized.includes("HB0") || normalized.includes("HE0")) return false;
  return normalized.startsWith("HB") || normalized.startsWith("HE");
}

function helvetiaCanton(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>): string {
  const value = qsoCell(qso, "SRX_STRING") || qso.receivedExchange.trim().split(/\s+/).at(-1) || "";
  return HELVETIA_CANTONS.has(value) ? value : "";
}

function helvetiaPoints(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.station || !context.worked) return 0;
  if (isSwissHelvetiaCall(qso.call)) return helvetiaCanton(qso) ? 10 : 0;
  return context.station.continent === context.worked.continent ? 1 : 3;
}

function helvetiaMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (context.band === "OTHER" || !context.worked) return "";
  if (isSwissHelvetiaCall(qso.call)) {
    const canton = helvetiaCanton(qso);
    if (!canton) return "";
    return `CANTON:${canton}; DXCC:${context.worked.primaryPrefix}`;
  }
  return `DXCC:${context.worked.primaryPrefix}`;
}

function isHolylandCall(call: string): boolean {
  const normalized = call.trim().toUpperCase().replace(/[^A-Z0-9/]/g, "");
  return normalized.startsWith("4X") || normalized.startsWith("4Z") || normalized.startsWith("J1");
}

function holylandPoints(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.station || !context.worked) return 0;
  if (qso.call.toUpperCase().includes("/MM")) return 4;
  const stationHolyland = isHolylandCall(context.stationCall);
  const workedHolyland = context.worked.primaryPrefix === "4X" || isHolylandCall(qso.call);
  if (stationHolyland) {
    if (workedHolyland) return 1;
    return context.station.continent === context.worked.continent ? 2 : 8;
  }
  if (workedHolyland) return 8;
  if (context.station.continent !== context.worked.continent) return 4;
  return context.station.primaryPrefix === context.worked.primaryPrefix ? 1 : 2;
}

function holylandMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (context.band === "OTHER" || !context.worked || qso.call.toUpperCase().includes("/MM")) return "";
  const tokens: string[] = [];
  if (context.worked.primaryPrefix === "4X" || isHolylandCall(qso.call)) {
    const area = qsoCell(qso, "SRX_STRING") || qso.receivedExchange.trim().split(/\s+/).at(-1) || "";
    if (area) tokens.push(`AREA:${area}`);
  }
  tokens.push(`DXCC:${context.worked.primaryPrefix}`);
  return tokens.join("; ");
}

function iaruExchange(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>): string {
  return (qsoCell(qso, "SRX_STRING") || qso.receivedExchange.trim().split(/\s+/).at(-1) || "").toUpperCase();
}

function iaruHfPoints(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.station || !context.worked) return 0;
  const exchange = iaruExchange(qso);
  if (!exchange) return 0;
  if (/^[A-Z]/.test(exchange)) return 1;
  const zone = Number.parseInt(exchange, 10);
  if (!Number.isFinite(zone) || zone < 1) return 0;
  if (zone === context.station.ituZone) return 1;
  return context.station.continent === context.worked.continent ? 3 : 5;
}

function iaruHfMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (context.band === "OTHER" || !context.worked) return "";
  const exchange = iaruExchange(qso);
  if (/^[A-Z]/.test(exchange)) return `HQ:${exchange}`;
  const zone = Number.parseInt(exchange, 10);
  return Number.isFinite(zone) && zone > 0 ? `ITU:${zone}` : "";
}

function jartsRttyPoints(_qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.station || !context.worked) return 0;
  return context.station.continent === context.worked.continent ? 2 : 3;
}

function jartsRttyMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (context.band === "OTHER" || !context.worked) return "";
  if (BARTG_AREA_PREFIXES.has(context.worked.primaryPrefix)) {
    const area = wpxPrefix(qso.call).match(/\d/)?.[0];
    return area ? `AREA:${context.worked.primaryPrefix}${area}` : "";
  }
  return `DXCC:${context.worked.primaryPrefix}`;
}

const JIDX_POINTS: Readonly<Record<string, number>> = {
  "160M": 4, "80M": 2, "40M": 1, "20M": 1, "15M": 1, "10M": 2,
};
const JIDX_JAPANESE_ENTITIES = new Set(["JA", "JD/O", "JD1/M"]);

function jidxPoints(_qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  const points = JIDX_POINTS[context.band] ?? 0;
  if (!points || !context.worked) return 0;
  const stationJapanese = isKcjJapanese(context.stationCall);
  const workedJapanese = JIDX_JAPANESE_ENTITIES.has(context.worked.primaryPrefix);
  return stationJapanese === workedJapanese ? 0 : points;
}

function jidxMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (!JIDX_POINTS[context.band] || !context.worked || /\/MM/i.test(qso.call)) return "";
  const stationJapanese = isKcjJapanese(context.stationCall);
  const workedJapanese = JIDX_JAPANESE_ENTITIES.has(context.worked.primaryPrefix);
  if (stationJapanese === workedJapanese) return "";
  const exchange = (qsoCell(qso, "SRX_STRING") || qso.receivedExchange.trim().split(/\s+/).at(-1) || "").toUpperCase();
  if (!exchange) return "";
  return stationJapanese
    ? `ZONE:${exchange}; DXCC:${context.worked.primaryPrefix}`
    : `PREFECTURE:${exchange}`;
}

function isJtDxCall(call: string): boolean {
  return /^(?:JT|JU|JV)/i.test(call.trim());
}

function jtDxPoints(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.station || !context.worked) return 0;
  if (context.station.primaryPrefix === "JT" && isJtDxCall(qso.call)) return 0;
  if (context.station.continent !== context.worked.continent) return 3;
  return context.station.primaryPrefix === context.worked.primaryPrefix ? 1 : 2;
}

function jtDxMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (context.band === "OTHER" || !context.worked || (context.station?.primaryPrefix === "JT" && isJtDxCall(qso.call))) return "";
  return isJtDxCall(qso.call)
    ? `JT:${qso.call.trim().toUpperCase()}`
    : `DXCC:${context.worked.primaryPrefix}`;
}

const LZ_DX_DISTRICTS = new Set("BU BL DO GA HA KA KD LV MN PA PD PK PL RS RZ SF SL SM SN SO SS SZ TA VD VN VT VR YA".split(" "));

function lzDxPoints(_qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.station || !context.worked) return 0;
  if (context.station.primaryPrefix !== "LZ" && context.worked.primaryPrefix === "LZ") return 10;
  return context.station.continent === context.worked.continent ? 1 : 3;
}

function lzDxMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (context.band === "OTHER" || !context.station || !context.worked) return "";
  const exchange = (qsoCell(qso, "SRX_STRING") || qso.receivedExchange.trim().split(/\s+/).at(-1) || "").toUpperCase();
  if (!exchange) return "";
  const stationBulgarian = context.station.primaryPrefix === "LZ";
  const workedBulgarian = context.worked.primaryPrefix === "LZ";
  if (!stationBulgarian) return workedBulgarian && LZ_DX_DISTRICTS.has(exchange) ? `DISTRICT:${exchange}` : (!workedBulgarian ? `ITU:${exchange}` : "");
  const tokens = [`DXCC:${context.worked.primaryPrefix}`];
  if (!workedBulgarian) tokens.unshift(`ITU:${exchange}`);
  return tokens.join("; ");
}

function marconiMemorialMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (context.band === "OTHER" || !context.worked || /\/(?:MM|M)$/i.test(qso.call.trim())) return "";
  return `DXCC:${context.worked.primaryPrefix}`;
}

function naqpMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (context.band === "OTHER" || !context.worked) return "";
  let qth = (qsoCell(qso, "QTH") || qsoCell(qso, "SRX_STRING") || qso.receivedExchange.trim().split(/\s+/).at(-1) || "").toUpperCase();
  if (!qth) return "";
  if (context.worked.primaryPrefix === "W" || context.worked.primaryPrefix === "KH6" || context.worked.primaryPrefix === "KL7") {
    if (qth === "MD") qth = "DC";
    return CA_PARTY_US_SECTIONS.has(qth) ? `STATE:${qth}` : "";
  }
  if (context.worked.primaryPrefix === "VE") return TEN_RTTY_CANADIAN_PROVINCES.has(qth) ? `PROVINCE:${qth}` : "";
  return context.worked.continent === "NA" ? `NA-COUNTRY:${qth}` : "";
}

const OCEANIA_DX_POINTS: Readonly<Record<string, number>> = {
  "160M": 20, "80M": 10, "40M": 5, "20M": 1, "15M": 2, "10M": 3,
};

function oceaniaDxEligible(context: ScoringContext): boolean {
  return !!context.station && !!context.worked && (context.station.continent === "OC" || context.worked.continent === "OC");
}

const OKOM_ENTITIES = new Set(["OK", "OM"]);

function isOkomStation(context: ScoringContext): boolean {
  return !!context.station && OKOM_ENTITIES.has(context.station.primaryPrefix);
}

function okomEligible(context: ScoringContext): boolean {
  return !!context.worked && isOkomStation(context) !== OKOM_ENTITIES.has(context.worked.primaryPrefix);
}

function okomMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (context.band === "OTHER" || !okomEligible(context)) return "";
  if (isOkomStation(context)) return wpxPrefix(qso.call);
  const district = (qsoCell(qso, "SRX_STRING") || qso.receivedExchange.trim().split(/\s+/).at(-1) || "").toUpperCase();
  return district ? `DISTRICT:${district}` : "";
}

function okomSsbPoints(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.station || !context.worked) return 0;
  if (/\/MM$/i.test(qso.call.trim())) return 5;
  const sameEntity = context.station.primaryPrefix === context.worked.primaryPrefix;
  if (isOkomStation(context)) return sameEntity ? 2 : 3;
  return sameEntity ? 1 : 3;
}

function okomSsbMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (context.band === "OTHER" || !context.worked || /\/MM$/i.test(qso.call.trim())) return "";
  if (!OKOM_ENTITIES.has(context.worked.primaryPrefix)) return `DXCC:${context.worked.primaryPrefix}`;
  const district = (qsoCell(qso, "SRX_STRING") || qso.receivedExchange.trim().split(/\s+/).at(-1) || "").toUpperCase();
  return district ? `OKOM:${district}` : "";
}

function okRttyPoints(_qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (!context.station || !context.worked) return 0;
  const factor = context.band === "40M" || context.band === "80M"
    ? 3
    : context.band === "10M" || context.band === "15M" || context.band === "20M" ? 1 : 0;
  if (!factor) return 0;
  return factor * (context.station.continent === context.worked.continent ? 1 : 2);
}

function okRttyMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (context.band === "OTHER" || !context.worked) return "";
  const tokens = [`DXCC:${context.worked.primaryPrefix}`];
  if (context.station?.primaryPrefix !== "OK" && context.worked.primaryPrefix === "OK") {
    tokens.push(`OK:${qso.call.trim().toUpperCase()}`);
  }
  return tokens.join("; ");
}

function okRttyMultiplierCount(rows: readonly ScoreRow[], band?: string): number {
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.duplicate || (band && row.band !== band)) continue;
    for (const token of scoringMultiplierTokens(row.multiplier)) seen.add(token);
  }
  return seen.size;
}

const PACC_PROVINCES = new Set("GR FR DR OV GD UT FL NH ZH NB ZL LB".split(" "));
const PACC_AREA_ENTITIES = new Set(["RA0", "UA9", "CE", "JA", "LU", "PY", "VE", "W", "VK", "ZS", "ZL"]);

function paccIsDutch(match: GeographyMatch | null): boolean {
  return match?.primaryPrefix === "PA";
}

function paccMode(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>): string {
  return qso.mode.trim().toUpperCase() === "CW" ? "CW" : "OTHER";
}

function paccArea(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, worked: GeographyMatch): string {
  let prefix = worked.primaryPrefix;
  if (!PACC_AREA_ENTITIES.has(prefix)) return "";
  if (prefix === "RA0" || prefix === "UA9") prefix = "RA";
  const call = qso.call.trim().toUpperCase();
  if (prefix === "VE") {
    if (call.includes("VO")) prefix = "VO";
    else if (call.includes("VY")) prefix = "VY";
  }
  const digit = call.match(/\d(?=[^\d]*$)/)?.[0] ?? "";
  return `${prefix}${digit}`;
}

function paccPoints(_qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.worked) return 0;
  return paccIsDutch(context.station) || paccIsDutch(context.worked) ? 1 : 0;
}

function paccMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (!paccPoints(qso, context) || !context.worked) return "";
  const mode = paccMode(qso);
  if (!paccIsDutch(context.station)) {
    const province = (qsoCell(qso, "SRX_STRING") || qso.receivedExchange.trim().split(/\s+/).at(-1) || "").toUpperCase();
    return PACC_PROVINCES.has(province) ? `${mode}:PROVINCE:${province}` : "";
  }
  const area = paccArea(qso, context.worked);
  return area ? `${mode}:AREA:${area}` : `${mode}:DXCC:${context.worked.primaryPrefix}`;
}

const PORTUGAL_DAY_ENTITIES = new Set(["CT", "CT3", "CU"]);

function portugalDayPoints(_qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.station || !context.worked) return 0;
  if (PORTUGAL_DAY_ENTITIES.has(context.worked.primaryPrefix)) {
    return PORTUGAL_DAY_ENTITIES.has(context.station.primaryPrefix) ? 5 : 10;
  }
  return context.station.continent === context.worked.continent ? 1 : 2;
}

function portugalDayMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (context.band === "OTHER" || !context.worked) return "";
  const tokens = [`DXCC:${context.worked.primaryPrefix}`];
  if (PORTUGAL_DAY_ENTITIES.has(context.worked.primaryPrefix)) {
    const district = (qsoCell(qso, "SRX_STRING") || qso.receivedExchange.trim().split(/\s+/).at(-1) || "").toUpperCase();
    if (district) tokens.push(`DISTRICT:${district}`);
  }
  return tokens.join("; ");
}

function portugalDayMultiplierCount(rows: readonly ScoreRow[], band?: string): number {
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.duplicate || row.points <= 0 || (band && row.band !== band)) continue;
    for (const token of scoringMultiplierTokens(row.multiplier)) seen.add(token);
  }
  return [...seen].reduce((total, token) => total + (token.startsWith("DISTRICT:") ? 5 : 1), 0);
}

const RADIO160_RUSSIAN_ENTITIES = new Set(["RA1", "RA2", "RA0", "R1F", "R1M"]);

function radio160Band(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>): string {
  const frequency = Number.parseFloat(qso.frequency);
  return frequency >= 1800 && frequency <= 2000 ? "160M" : "OTHER";
}

function radio160Points(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band !== "160M" || !context.station || !context.worked) return 0;
  const workedEntity = context.worked.primaryPrefix;
  const domestic = RADIO160_RUSSIAN_ENTITIES.has(context.station.primaryPrefix);
  const workedRussian = RADIO160_RUSSIAN_ENTITIES.has(workedEntity);
  const maritime = /\/MM$/i.test(qso.call.trim());
  if (!domestic) {
    if (workedRussian) return maritime ? 5 : 10;
    if (!maritime && context.station.continent === context.worked.continent) {
      return context.station.primaryPrefix === workedEntity ? 2 : 3;
    }
    return 5;
  }
  if (workedRussian) {
    if (maritime || context.station.continent !== context.worked.continent) return 5;
    const comparedEntity = workedEntity === "RA2" ? "RA1" : workedEntity;
    return comparedEntity === context.station.primaryPrefix ? 2 : 3;
  }
  return context.station.continent === context.worked.continent ? 3 : 5;
}

function radio160Multiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (context.band !== "160M" || !context.worked || /\/MM$/i.test(qso.call.trim())) return "";
  const tokens = [`DXCC:${context.worked.primaryPrefix}`];
  if (RADIO160_RUSSIAN_ENTITIES.has(context.worked.primaryPrefix)) {
    const oblast = (qsoCell(qso, "SRX_STRING") || qso.receivedExchange.trim().split(/\s+/).at(-1) || "").toUpperCase();
    if (oblast) tokens.push(`OBLAST:${oblast}`);
  }
  return tokens.join("; ");
}

function radioWwRttyMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (context.band === "OTHER" || !context.worked) return "";
  if (!RADIO160_RUSSIAN_ENTITIES.has(context.worked.primaryPrefix)) return `DXCC:${context.worked.primaryPrefix}`;
  const oblast = (qsoCell(qso, "SRX_STRING") || qso.receivedExchange.trim().split(/\s+/).at(-1) || "").toUpperCase();
  return oblast ? `OBLAST:${oblast}` : "";
}

function rccExchange(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>): string {
  return (qsoCell(qso, "SRX_STRING") || qso.receivedExchange.trim().split(/\s+/).at(-1) || "").toUpperCase();
}

function rccPoints(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.station || !context.worked) return 0;
  if (rccExchange(qso).includes("RCC")) return 10;
  return context.station.continent === context.worked.continent ? 3 : 5;
}

function rccMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (context.band === "OTHER" || !context.worked) return "";
  const exchange = rccExchange(qso);
  if (exchange.includes("RCC")) return `RCC:${qso.call.trim().toUpperCase()}`;
  const zone = Number.parseInt(exchange, 10);
  return Number.isFinite(zone) ? `ITU:${zone}` : "";
}

function rdacRda(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>): string {
  const value = (qsoCell(qso, "SRX_STRING") || qso.receivedExchange.trim().split(/\s+/).at(-1) || "").toUpperCase();
  return /^[A-Z]{2}/.test(value) ? value : "";
}

function rdacPoints(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.station || !context.worked) return 0;
  const stationRussian = RADIO160_RUSSIAN_ENTITIES.has(context.station.primaryPrefix);
  const workedRussian = RADIO160_RUSSIAN_ENTITIES.has(context.worked.primaryPrefix);
  if (!stationRussian) return workedRussian && rdacRda(qso) ? 10 : 0;
  if (workedRussian) {
    if (/\/MM$/i.test(qso.call.trim())) return 10;
    return context.station.continent === context.worked.continent ? 1 : 2;
  }
  return context.station.continent === context.worked.continent ? 3 : 5;
}

function rdacMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (context.band === "OTHER" || !context.station || !context.worked) return "";
  const stationRussian = RADIO160_RUSSIAN_ENTITIES.has(context.station.primaryPrefix);
  const workedRussian = RADIO160_RUSSIAN_ENTITIES.has(context.worked.primaryPrefix);
  const rda = workedRussian ? rdacRda(qso) : "";
  if (!stationRussian) return rda ? `RDA:${rda}` : "";
  return [rda ? `RDA:${rda}` : "", `DXCC:${context.worked.primaryPrefix}`].filter(Boolean).join("; ");
}

function rdacMultiplierCount(rows: readonly ScoreRow[], band?: string): number {
  const seenRda = new Set<string>();
  const seenDxcc = new Set<string>();
  let count = 0;
  for (const row of rows) {
    if (row.duplicate || row.points <= 0) continue;
    for (const token of scoringMultiplierTokens(row.multiplier)) {
      if (token.startsWith("RDA:")) {
        if (seenRda.has(token)) continue;
        seenRda.add(token);
        if (!band || row.band === band) count += 1;
      } else if (token.startsWith("DXCC:")) {
        const scoped = `${row.band}|${token}`;
        if (seenDxcc.has(scoped)) continue;
        seenDxcc.add(scoped);
        if (!band || row.band === band) count += 1;
      }
    }
  }
  return count;
}

function rdxcPoints(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.station || !context.worked) return 0;
  const stationRussian = RADIO160_RUSSIAN_ENTITIES.has(context.station.primaryPrefix);
  const workedRussian = RADIO160_RUSSIAN_ENTITIES.has(context.worked.primaryPrefix);
  const maritime = /\/MM$/i.test(qso.call.trim());
  if (!stationRussian) {
    if (workedRussian) return maritime ? 5 : 10;
    if (!maritime && context.station.continent === context.worked.continent) {
      return context.station.primaryPrefix === context.worked.primaryPrefix ? 2 : 3;
    }
    return 5;
  }
  if (workedRussian) {
    if (maritime) return 5;
    return context.station.continent === context.worked.continent ? 2 : 5;
  }
  return context.station.continent === context.worked.continent ? 3 : 5;
}

function rdxcMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (context.band === "OTHER" || !context.worked || /\/MM$/i.test(qso.call.trim())) return "";
  const tokens = [`DXCC:${context.worked.primaryPrefix}`];
  if (RADIO160_RUSSIAN_ENTITIES.has(context.worked.primaryPrefix)) {
    const oblast = rdacRda(qso);
    if (oblast) tokens.push(`OBLAST:${oblast}`);
  }
  return tokens.join("; ");
}

const REF_TERRITORY_PREFIXES = ["TQ", "TP", "TM", "TW", "HX", "TH", "HW", "TV", "TO", "TK", "TX"];

function isRefFrench(call: string, match: GeographyMatch | null): boolean {
  const normalized = call.trim().toUpperCase();
  return !!match && (match.primaryPrefix.startsWith("F") || REF_TERRITORY_PREFIXES.some((prefix) => normalized.startsWith(prefix)));
}

function refDepartment(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>): string {
  return (qsoCell(qso, "SRX_STRING") || qso.receivedExchange.trim().split(/\s+/).at(-1) || "").toUpperCase();
}

function refPoints(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.station || !context.worked) return 0;
  const stationFrench = isRefFrench(context.stationCall, context.station);
  const workedFrench = isRefFrench(qso.call, context.worked);
  if (!stationFrench) {
    if (!workedFrench) return 0;
    return context.station.continent !== context.worked.continent && context.station.primaryPrefix !== context.worked.primaryPrefix ? 3 : 1;
  }
  if (workedFrench) return context.station.continent === context.worked.continent ? 6 : 15;
  return context.station.continent === context.worked.continent ? 1 : 2;
}

function refMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (!refPoints(qso, context) || !context.station || !context.worked) return "";
  if (isRefFrench(qso.call, context.worked)) {
    const department = refDepartment(qso);
    return department ? `DEPT:${department}` : "";
  }
  return isRefFrench(context.stationCall, context.station) ? `DXCC:${context.worked.primaryPrefix}` : "";
}

const RNARS_CALL_AREA_ENTITIES = new Set(["VE", "VK", "W", "ZL", "ZS"]);

function rnarsExchange(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>): string {
  return (qsoCell(qso, "SRX_STRING") || qso.receivedExchange.trim().split(/\s+/).at(-1) || "").toUpperCase();
}

function rnarsPoints(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.worked) return 0;
  if (qso.call.trim().toUpperCase() === "GB4RN") return 10;
  const exchange = rnarsExchange(qso);
  if (!exchange) return 0;
  return /^[A-Z]/.test(exchange) ? 10 : 1;
}

function rnarsMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (!rnarsPoints(qso, context) || !context.worked) return "";
  const call = qso.call.trim().toUpperCase();
  if (call === "GB4RN") return "SPECIAL:GB4RN";
  if (!/^[A-Z]/.test(rnarsExchange(qso))) return "";
  const primary = context.worked.primaryPrefix;
  if (!RNARS_CALL_AREA_ENTITIES.has(primary)) return `DXCC:${primary}`;
  const digit = call.match(/\d(?=[^\d]*$)/)?.[0] ?? "";
  return digit ? `AREA:${primary}${digit}` : "";
}

function ruDigiMode(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>): string {
  return qso.mode.trim().toUpperCase() === "RY" ? "RY" : "OTHER";
}

function ruDigiPoints(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.station || !context.worked) return 0;
  let points = /\/QRP$/i.test(qso.call.trim())
    ? 5
    : context.station.primaryPrefix === context.worked.primaryPrefix
      ? 1
      : context.station.continent === context.worked.continent ? 3 : 5;
  if (context.band === "160M" || context.band === "80M" || context.band === "40M") points *= 2;
  return points;
}

function ruDigiMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (!ruDigiPoints(qso, context) || !context.worked) return "";
  const mode = ruDigiMode(qso);
  const tokens = [`${mode}:DXCC:${context.worked.primaryPrefix}`];
  if (context.worked.primaryPrefix.startsWith("R")) {
    const oblast = (qsoCell(qso, "SRX_STRING") || qso.receivedExchange.trim().split(/\s+/).at(-1) || "").toUpperCase();
    if (oblast) tokens.push(`${mode}:OBLAST:${oblast}`);
  }
  return tokens.join("; ");
}

function ruMmMode(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>): string {
  const mode = qso.mode.trim().toUpperCase();
  return mode === "RY" || mode === "CW" || mode === "PH" ? mode : "OTHER";
}

function ruMmPoints(_qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.station || !context.worked) return 0;
  let points = context.station.primaryPrefix === context.worked.primaryPrefix
    ? 1
    : context.station.continent === context.worked.continent ? 3 : 5;
  if (context.band === "160M" || context.band === "80M" || context.band === "40M") points *= 2;
  return points;
}

function ruMmMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (!ruMmPoints(qso, context) || !context.worked) return "";
  const mode = ruMmMode(qso);
  const tokens = [`${mode}:DXCC:${context.worked.primaryPrefix}`];
  if (context.worked.primaryPrefix.startsWith("R")) {
    const oblast = (qsoCell(qso, "SRX_STRING") || qso.receivedExchange.trim().split(/\s+/).at(-1) || "").toUpperCase();
    if (oblast) tokens.push(`${mode}:OBLAST:${oblast}`);
  }
  return tokens.join("; ");
}

function ruPskMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (!ruMmPoints(qso, context) || !context.worked) return "";
  const tokens = [`DXCC:${context.worked.primaryPrefix}`];
  if (context.worked.primaryPrefix.startsWith("R")) {
    const oblast = (qsoCell(qso, "SRX_STRING") || qso.receivedExchange.trim().split(/\s+/).at(-1) || "").toUpperCase();
    if (oblast) tokens.push(`OBLAST:${oblast}`);
  }
  return tokens.join("; ");
}

const SAC_SCANDINAVIAN_ENTITIES = new Set(["OH", "OH0", "OX", "OY", "OZ", "SM", "LA", "JW", "JX", "TF"]);

function sacIsScandinavian(match: GeographyMatch | null): boolean {
  return !!match && SAC_SCANDINAVIAN_ENTITIES.has(match.primaryPrefix);
}

function sacPoints(_qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.station || !context.worked) return 0;
  const stationScandinavian = sacIsScandinavian(context.station);
  const workedScandinavian = sacIsScandinavian(context.worked);
  if (stationScandinavian) return workedScandinavian ? 0 : context.worked.continent === "EU" ? 2 : 3;
  if (!workedScandinavian) return 0;
  return context.station.continent !== "EU" && (context.band === "80M" || context.band === "40M") ? 3 : 1;
}

function sacMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (!sacPoints(qso, context) || !context.station || !context.worked) return "";
  if (sacIsScandinavian(context.station)) return `DXCC:${context.worked.primaryPrefix}`;
  const digit = qso.call.trim().toUpperCase().match(/\d(?=[^\d]*$)/)?.[0] ?? "";
  return digit ? `AREA:${context.worked.primaryPrefix}${digit}` : "";
}

const SARTG_AREA_ENTITIES = new Set(["JA", "VE", "VK", "W"]);

function sartgPoints(_qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.station || !context.worked) return 0;
  if (context.station.continent !== context.worked.continent) return 15;
  return context.station.primaryPrefix === context.worked.primaryPrefix ? 5 : 10;
}

function sartgMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (!sartgPoints(qso, context) || !context.worked) return "";
  const tokens = [`DXCC:${context.worked.primaryPrefix}`];
  if (SARTG_AREA_ENTITIES.has(context.worked.primaryPrefix)) {
    const digit = qso.call.trim().toUpperCase().match(/\d(?=[^\d]*$)/)?.[0] ?? "";
    if (digit) tokens.push(`AREA:${context.worked.primaryPrefix}${digit}`);
  }
  return tokens.join("; ");
}

const SCC_AREA_ENTITIES = new Set(["W", "VE", "VK", "ZL", "ZS", "JA", "PY", "RA0", "LU"]);

function scoringCallArea(call: string, primary: string): string {
  const digit = call.trim().toUpperCase().match(/\d(?=[^\d]*$)/)?.[0] ?? "";
  return digit ? `${primary}${digit}` : primary;
}

function sccPoints(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.station || !context.worked) return 0;
  if (context.station.continent !== context.worked.continent) return 3;
  if (context.station.primaryPrefix !== context.worked.primaryPrefix) return 2;
  if (!SCC_AREA_ENTITIES.has(context.worked.primaryPrefix)) return 1;
  return scoringCallArea(context.stationCall, context.station.primaryPrefix) === scoringCallArea(qso.call, context.worked.primaryPrefix) ? 1 : 2;
}

function sccMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (!sccPoints(qso, context)) return "";
  const year = (qsoCell(qso, "SRX_STRING") || qso.receivedExchange.trim().split(/\s+/).at(-1) || "").toUpperCase();
  return year ? `YEAR:${year}` : "";
}

const SPDX_POLISH_PREFIXES = ["HF", "SR", "SO", "SP", "3Z", "SQ", "SN"];
const SPDX_VOIVODESHIPS = new Set("B C D F G J K L M O P R S U W Z".split(" "));

function spdxIsPolish(call: string): boolean {
  const normalized = call.trim().toUpperCase();
  return SPDX_POLISH_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function spdxPoints(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.worked) return 0;
  const stationPolish = spdxIsPolish(context.stationCall);
  const workedPolish = spdxIsPolish(qso.call);
  if (!stationPolish) return workedPolish ? 3 : 0;
  return context.worked.continent === "EU" ? 1 : 3;
}

function spdxMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (!spdxPoints(qso, context) || !context.worked) return "";
  if (spdxIsPolish(context.stationCall)) return `DXCC:${context.worked.primaryPrefix}`;
  const voivodeship = (qsoCell(qso, "SRX_STRING") || qso.receivedExchange.trim().split(/\s+/).at(-1) || "").toUpperCase();
  return SPDX_VOIVODESHIPS.has(voivodeship) ? `VOIVODESHIP:${voivodeship}` : "";
}

function spdxRttyPoints(_qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.station || !context.worked) return 0;
  if (context.station.primaryPrefix === context.worked.primaryPrefix) return 2;
  return context.station.continent === context.worked.continent ? 5 : 10;
}

function spdxRttyMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (!spdxRttyPoints(qso, context) || !context.worked) return "";
  const tokens = [`DXCC:${context.worked.primaryPrefix}`];
  const voivodeship = (qsoCell(qso, "SRX_STRING") || qso.receivedExchange.trim().split(/\s+/).at(-1) || "").toUpperCase();
  if (spdxIsPolish(qso.call) && SPDX_VOIVODESHIPS.has(voivodeship)) tokens.push(`VOIVODESHIP:${voivodeship}`);
  return tokens.join("; ");
}

function spdxRttyTotal(points: number, multipliers: number, rows: readonly ScoreRow[]): number {
  const eligible = new Set(["AF", "AS", "EU", "NA", "OC", "SA"]);
  const continents = new Set(rows.filter((row) => row.points > 0 && eligible.has(row.continent)).map((row) => row.continent));
  return points * multipliers * Math.max(1, continents.size);
}

function trcExchange(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, direction: "sent" | "received"): string {
  return direction === "sent"
    ? (qsoCell(qso, "STX_STRING") || qso.sentExchange.trim().split(/\s+/).at(-1) || "").toUpperCase()
    : (qsoCell(qso, "SRX_STRING") || qso.receivedExchange.trim().split(/\s+/).at(-1) || "").toUpperCase();
}

function trcPoints(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.worked) return 0;
  return trcExchange(qso, "received") === "TRC" ? (trcExchange(qso, "sent") === "TRC" ? 1 : 10) : 1;
}

function trcMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (!trcPoints(qso, context) || !context.worked) return "";
  const exchange = trcExchange(qso, "received");
  if (exchange === "TRC") return `TRC:${context.worked.primaryPrefix}`;
  const zone = Number.parseInt(exchange, 10);
  return Number.isFinite(zone) && zone > 0 ? `ITU:${zone}` : "";
}

const UR_DX_DIGI_OBLASTS = new Set("CH CN CR DN DO HA HE HM IF KI KO KR KV LU LV NI OD PO RI SL SU TE VI VO ZA ZH ZP".split(" "));

function urDxDigiMode(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>): string {
  return qso.mode.trim().toUpperCase() === "RY" ? "RY" : "PK";
}

function urDxDigiPoints(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.station || !context.worked) return 0;
  const maritime = /\/MM$/i.test(qso.call.trim());
  const stationUkrainian = context.station.primaryPrefix === "UR";
  const workedUkrainian = context.worked.primaryPrefix === "UR";
  let points: number;
  if (maritime) points = 5;
  else if (stationUkrainian) points = workedUkrainian ? 1 : context.station.continent === context.worked.continent ? 1 : 3;
  else if (workedUkrainian) points = context.station.continent === "EU" ? 5 : 10;
  else points = context.station.continent === context.worked.continent ? 1 : 3;
  return context.band === "10M" ? points * 2 : points;
}

function urDxDigiMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (!urDxDigiPoints(qso, context) || !context.worked || /\/MM$/i.test(qso.call.trim())) return "";
  const mode = urDxDigiMode(qso);
  const tokens = [`${mode}:DXCC:${context.worked.primaryPrefix}`];
  if (context.worked.primaryPrefix === "UR") {
    const oblast = (qsoCell(qso, "SRX_STRING") || qso.receivedExchange.trim().split(/\s+/).at(-1) || "").toUpperCase();
    if (UR_DX_DIGI_OBLASTS.has(oblast)) tokens.push(`${mode}:OBLAST:${oblast}`);
  }
  return tokens.join("; ");
}

function uaDxPoints(_qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.station || !context.worked) return 0;
  const stationUkrainian = context.station.primaryPrefix === "UR";
  const workedUkrainian = context.worked.primaryPrefix === "UR";
  if (stationUkrainian) {
    if (workedUkrainian) return 1;
    return context.worked.continent === "EU" ? 2 : 3;
  }
  if (workedUkrainian) return 10;
  if (context.station.primaryPrefix === context.worked.primaryPrefix) return 1;
  return context.station.continent === context.worked.continent ? 2 : 3;
}

function uaDxMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (!uaDxPoints(qso, context) || !context.station || !context.worked) return "";
  const tokens = [`DXCC:${context.worked.primaryPrefix}`];
  if (context.station.primaryPrefix !== "UR" && context.worked.primaryPrefix === "UR") {
    const oblast = (qsoCell(qso, "SRX_STRING") || qso.receivedExchange.trim().split(/\s+/).at(-1) || "").toUpperCase();
    if (UR_DX_DIGI_OBLASTS.has(oblast)) tokens.push(`OBLAST:${oblast}`);
  }
  return tokens.join("; ");
}

const UBA_PROVINCES = new Set("AN BW HT LB LG NM LU OV VB WV BR".split(" "));

function ubaPoints(_qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.station || !context.worked) return 0;
  const stationBelgian = context.station.primaryPrefix === "ON";
  const workedBelgian = context.worked.primaryPrefix === "ON";
  if (stationBelgian) return workedBelgian ? 1 : context.worked.continent === "EU" ? 2 : 3;
  if (workedBelgian) return 10;
  return context.worked.continent === "EU" ? 3 : 1;
}

function ubaMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (!ubaPoints(qso, context) || !context.station || !context.worked) return "";
  if (context.station.primaryPrefix === "ON") return `DXCC:${context.worked.primaryPrefix}`;
  if (context.worked.primaryPrefix !== "ON") return context.worked.continent === "EU" ? `EUROPE:${context.worked.primaryPrefix}` : "";
  const tokens = [`ON-PREFIX:${wpxPrefix(qso.call)}`];
  const province = (qsoCell(qso, "SRX_STRING") || qso.receivedExchange.trim().split(/\s+/).at(-1) || "").replace(/[^A-Z]/g, "").toUpperCase();
  if (UBA_PROVINCES.has(province)) tokens.unshift(`PROVINCE:${province}`);
  return tokens.join("; ");
}

function ukDxPoints(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.station || !context.worked) return 0;
  if (/\/MM$/i.test(qso.call.trim())) return 3;
  const stationUk = UK_PRIMARY_PREFIXES.has(context.station.primaryPrefix);
  const workedUk = UK_PRIMARY_PREFIXES.has(context.worked.primaryPrefix);
  if (!stationUk && workedUk) return 5;
  if (context.station.primaryPrefix === context.worked.primaryPrefix) return 1;
  return context.station.continent === context.worked.continent ? 2 : 3;
}

function ukDxMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (!ukDxPoints(qso, context) || !context.worked || /\/MM$/i.test(qso.call.trim())) return "";
  const tokens = [`DXCC:${context.worked.primaryPrefix}`];
  const exchange = (qsoCell(qso, "SRX_STRING") || qso.receivedExchange.trim().split(/\s+/).at(-1) || "").toUpperCase();
  if (UK_PRIMARY_PREFIXES.has(context.worked.primaryPrefix) && exchange && !/^\d+$/.test(exchange)) tokens.push(`UK-AREA:${exchange}`);
  return tokens.join("; ");
}

const UKEIDX_DISTRICTS = new Set("AB AL AN AR BA BB BD BH BL BM BN BR BS CA CB CE CF CH CK CL CM CN CO CR CT CV CW DA DD DE DG DH DL DN DO DR DT DU DW DY EC EH EL EN EX FE FK FY GA GL GS GU GY HA HD HG HP HR HS HU HX IG IM IP IV JE KA KD KE KI KT KW KY LA LD LE LF LH LI LL LN LO LP LS LT LU MA ME MK ML MO MR MT NE NG NL NN NP NR NW OF OL OX PA PE PH PL PO PR RG RH RM RO SA SD SE SG SI SK SL SM SN SO SP SR SS ST SW SY TA TD TF TI TN TQ TR TS TW TY UB WA WC WD WF WI WL WM WN WR WS WT WV WX YO ZE".split(" "));

function ukeidxPoints(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.station || !context.worked) return 0;
  const lowBand = context.band === "80M" || context.band === "40M";
  const stationUk = UK_PRIMARY_PREFIXES.has(context.station.primaryPrefix);
  const workedUk = UK_PRIMARY_PREFIXES.has(context.worked.primaryPrefix);
  let points: number;
  if (stationUk) {
    points = context.worked.continent === "EU" ? 2 : 4;
    const time = Number.parseInt(qso.time, 10);
    if (time > 100 && time < 459) points *= 2;
  } else if (context.station.continent === "EU") {
    points = workedUk ? 2 : context.worked.continent === "EU" ? 1 : 2;
  } else {
    points = workedUk ? 4 : context.worked.continent === "EU" ? 2 : 1;
  }
  return lowBand ? points * 2 : points;
}

function ukeidxMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (!ukeidxPoints(qso, context) || !context.worked) return "";
  if (!UK_PRIMARY_PREFIXES.has(context.worked.primaryPrefix)) return `DXCC:${context.worked.primaryPrefix}`;
  const district = (qsoCell(qso, "SRX_STRING") || qso.receivedExchange.trim().split(/\s+/).at(-1) || "").toUpperCase();
  return UKEIDX_DISTRICTS.has(district) ? `DISTRICT:${district}` : "";
}

function uksmgPoints(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>): number {
  const sent = locatorValue(qso, "sent").toUpperCase();
  const received = locatorValue(qso, "received").toUpperCase();
  if (!sent || !received) return 0;
  if (sent === received) return 1;
  const distance = maidenheadDistanceKm(sent, received);
  return distance === null ? 0 : Math.ceil(distance);
}

function uksmgMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (!uksmgPoints(qso)) return "";
  const tokens: string[] = [];
  const member = Number.parseInt(qsoCell(qso, "SRX_STRING"), 10);
  if (Number.isFinite(member) && member > 0) tokens.push(`MEMBER:${member}`);
  const square = locatorValue(qso, "received").toUpperCase();
  if (square) tokens.push(`SQUARE:${square}`);
  if (context.worked && !/\/(?:M|MM)$/i.test(qso.call.trim())) tokens.push(`DXCC:${context.worked.primaryPrefix}`);
  return tokens.join("; ");
}

function uksmgTotal(points: number, multipliers: number): number {
  return points + multipliers * 500;
}

function unDxPoints(_qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.station || !context.worked) return 0;
  const stationKazakhstan = context.station.primaryPrefix === "UN";
  const workedKazakhstan = context.worked.primaryPrefix === "UN";
  if (stationKazakhstan) {
    if (workedKazakhstan) return 2;
    return context.worked.continent === "AS" ? 3 : 5;
  }
  if (workedKazakhstan) return 10;
  if (context.station.primaryPrefix === context.worked.primaryPrefix) {
    return context.station.continent === context.worked.continent ? 2 : 3;
  }
  return 5;
}

function unDxMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (!unDxPoints(qso, context) || !context.worked) return "";
  const tokens = [`DXCC:${context.worked.primaryPrefix}`];
  if (context.worked.primaryPrefix === "UN") {
    const district = (qsoCell(qso, "SRX_STRING") || qso.receivedExchange.trim().split(/\s+/).at(-1) || "").toUpperCase();
    if (district) tokens.push(`KDA:${district}`);
  }
  return tokens.join("; ");
}

function voltaZones(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>): readonly [number, number] {
  const sent = Number.parseInt(qsoCell(qso, "STX_STRING") || qso.sentExchange.trim(), 10);
  const received = Number.parseInt(qsoCell(qso, "SRX_STRING") || qso.receivedExchange.trim(), 10);
  return [sent, received];
}

function voltaPoints(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.station || !context.worked) return 0;
  const [sentZone, receivedZone] = voltaZones(qso);
  if (sentZone < 1 || sentZone > 40 || receivedZone < 1 || receivedZone > 40) return 0;
  if (context.station.primaryPrefix === context.worked.primaryPrefix) return 0;
  const base = DRCGWW_ZONE_POINTS[sentZone - 1]?.[receivedZone - 1] ?? 0;
  const doubleBand = context.band === "80M" || context.band === "10M";
  return base * (doubleBand && context.station.continent !== context.worked.continent ? 2 : 1);
}

function voltaMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (!voltaPoints(qso, context) || !context.station || !context.worked) return "";
  const tokens = [`DXCC:${context.worked.primaryPrefix}`];
  if (context.station.continent !== context.worked.continent) {
    const bands = context.state.get(`volta-four-band:${context.worked.primaryPrefix}`) ?? new Set<string>();
    context.state.set(`volta-four-band:${context.worked.primaryPrefix}`, bands);
    const before = bands.size;
    bands.add(context.band);
    if (before < 4 && bands.size === 4) tokens.push(`4-BAND:${context.worked.primaryPrefix}`);
  }
  return tokens.join("; ");
}

function voltaTotal(points: number, multipliers: number, rows: readonly ScoreRow[]): number {
  const acceptedQsos = rows.filter((row) => row.band !== "OTHER" && row.country !== "Unknown").length;
  return acceptedQsos * points * multipliers;
}

const WAE_CALL_AREA_ENTITIES = new Set("W VE VK ZL ZS JA PY RA0".split(" "));
const WAE_MULTIPLIER_WEIGHTS: Readonly<Record<string, number>> = { "80M": 4, "40M": 3, "20M": 2, "15M": 2, "10M": 2 };

function waePoints(_qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext, rtty = false): number {
  if (!WAE_MULTIPLIER_WEIGHTS[context.band] || !context.station || !context.worked) return 0;
  return rtty || isWaedcEuropean(context.station) !== isWaedcEuropean(context.worked) ? 1 : 0;
}

function waeMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext, rtty = false): string {
  if (!waePoints(qso, context, rtty) || !context.worked) return "";
  if (!WAE_CALL_AREA_ENTITIES.has(context.worked.primaryPrefix)) return `DXCC:${context.worked.primaryPrefix}`;
  const digit = wpxPrefix(qso.call).match(/\d/)?.[0];
  return digit ? `AREA:${context.worked.primaryPrefix}${digit}` : `DXCC:${context.worked.primaryPrefix}`;
}

function waeMultiplierCount(rows: readonly ScoreRow[]): number {
  const seen = new Set<string>();
  let total = 0;
  for (const row of rows) {
    if (row.duplicate || row.points <= 0) continue;
    for (const token of scoringMultiplierTokens(row.multiplier)) {
      const key = `${row.band}|${token}`;
      if (!seen.has(key)) {
        seen.add(key);
        total += WAE_MULTIPLIER_WEIGHTS[row.band] ?? 0;
      }
    }
  }
  return total;
}

function waeBandMultiplierCount(rows: readonly ScoreRow[], band: string): number {
  return new Set(rows.filter((row) => !row.duplicate && row.points > 0 && row.band === band).flatMap((row) => scoringMultiplierTokens(row.multiplier))).size;
}

function waeQtcCount(document?: CabrilloDocument): number {
  return document?.lines.filter((line) => line.key === "QTC").length ?? 0;
}

function waeTotal(points: number, multipliers: number, _rows: readonly ScoreRow[], document?: CabrilloDocument): number {
  return (points + waeQtcCount(document)) * multipliers;
}

function wagPoints(_qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.station || !context.worked) return 0;
  const stationGerman = context.station.primaryPrefix === "DL";
  const workedGerman = context.worked.primaryPrefix === "DL";
  if (!stationGerman) return workedGerman ? 3 : 0;
  if (workedGerman) return 1;
  return context.worked.continent === "EU" ? 3 : 5;
}

function wagMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (!wagPoints(qso, context) || !context.station || !context.worked) return "";
  if (context.station.primaryPrefix === "DL") return `DXCC:${context.worked.primaryPrefix}`;
  const dok = (qsoCell(qso, "SRX_STRING") || qso.receivedExchange).replace(/[^A-Z0-9]/gi, "").toUpperCase();
  return dok ? `DOK:${dok}` : "";
}

const XE_RTTY_STATES = new Set("AGS BC BCS CAM CHS CHH COA COL DF EMX DGO GTO GRO HGO JAL MIC MOR NAY NL OAX PUE QRO QTR SLP SIN SON TAB TMS TLX VER YUC ZAC".split(" "));

function xeRttyState(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>): string {
  return (qsoCell(qso, "SRX_STRING") || qso.receivedExchange.trim().split(/\s+/).at(-1) || "").toUpperCase();
}

function xeRttyPoints(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.station || !context.worked) return 0;
  if (context.worked.primaryPrefix === "XE" && !XE_RTTY_STATES.has(xeRttyState(qso))) return 0;
  return context.station.primaryPrefix === context.worked.primaryPrefix ? 2 : 3;
}

function xeRttyMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (!xeRttyPoints(qso, context) || !context.worked) return "";
  return context.worked.primaryPrefix === "XE" ? `XE-STATE:${xeRttyState(qso)}` : `DXCC:${context.worked.primaryPrefix}`;
}

function ybDxPoints(_qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.station || !context.worked) return 0;
  const stationIndonesian = context.station.primaryPrefix === "YB";
  const workedIndonesian = context.worked.primaryPrefix === "YB";
  if (stationIndonesian) {
    if (workedIndonesian) return 0;
    return context.worked.continent === context.station.continent ? 5 : 10;
  }
  if (workedIndonesian) return 10;
  if (context.station.primaryPrefix === context.worked.primaryPrefix) return 1;
  return context.station.continent === context.worked.continent ? 2 : 3;
}

function ybDxMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (context.band === "OTHER" || !context.station || !context.worked) return "";
  const tokens = [`DXCC:${context.worked.primaryPrefix}`];
  if (context.station.primaryPrefix === "YB" || context.worked.primaryPrefix === "YB") tokens.push(`WPX:${wpxPrefix(qso.call)}`);
  return tokens.join("; ");
}

const YO_COUNTIES = new Set("AR CS HD TM BU IF CT BR GL TL VN AB BH BN CJ SM SJ MM BV CV HR MS SB AG DJ GJ MH OT VL BC BT IS NT SV VS BZ CL DB GR IL PH TR".split(" "));

function yoCounty(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>): string {
  const received = qsoCell(qso, "SRX_STRING") || qso.receivedExchange;
  const letters = received.toUpperCase().replace(/[^A-Z]/g, "");
  return YO_COUNTIES.has(letters) ? letters : "";
}

function isRomanian(match: GeographyMatch | null): boolean {
  return match?.primaryPrefix === "YO";
}

function yoDxPoints(_qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.station || !context.worked) return 0;
  const stationRomanian = isRomanian(context.station);
  const workedRomanian = isRomanian(context.worked);
  if (!stationRomanian) {
    if (workedRomanian) return 8;
    if (context.station.primaryPrefix === context.worked.primaryPrefix) {
      return context.station.continent === context.worked.continent ? 1 : 2;
    }
    return 4;
  }
  if (workedRomanian) return context.station.continent === context.worked.continent ? 0 : 4;
  return 8;
}

function yoDxMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  const points = yoDxPoints(qso, context);
  if (!points || !context.station || !context.worked) return "";
  if (!isRomanian(context.station) && isRomanian(context.worked)) {
    const county = yoCounty(qso);
    return county ? `YO-COUNTY:${county}` : "";
  }
  return `DXCC:${context.worked.primaryPrefix}`;
}

function yoPskBand(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>): string {
  const frequency = Number.parseFloat(qso.frequency);
  return frequency >= 3500 && frequency <= 4000 ? "80M" : "OTHER";
}

function yoPskPoints(_qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band !== "80M" || !context.worked) return 0;
  return isRomanian(context.worked) ? 2 : 1;
}

function yoPskMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (!yoPskPoints(qso, context) || !context.worked) return "";
  const tokens = [`DXCC:${context.worked.primaryPrefix}`];
  const county = isRomanian(context.worked) ? yoCounty(qso) : "";
  if (county) tokens.unshift(`YO-COUNTY:${county}`);
  return tokens.join("; ");
}

function yuDxPoints(_qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.station || !context.worked) return 0;
  if (context.station.primaryPrefix === context.worked.primaryPrefix) return 1;
  return context.station.continent === context.worked.continent ? 2 : 4;
}

function yuDxMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (!yuDxPoints(qso, context) || context.worked?.primaryPrefix !== "YU") return "";
  const exchange = (qsoCell(qso, "SRX_STRING") || qso.receivedExchange).trim();
  return exchange ? `YU:${exchange}` : "";
}

function cq160Band(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>): string {
  const frequency = Number.parseFloat(qso.frequency);
  return frequency >= 1800 && frequency <= 2100 ? "160M" : "OTHER";
}

function cq160Eligible(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): boolean {
  const frequency = Number.parseFloat(qso.frequency);
  return context.band === "160M" && frequency >= 1800 && frequency <= 2100 && !!context.worked && !!qso.receivedExchange.trim();
}

function cq160Points(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (!cq160Eligible(qso, context) || !context.station || !context.worked) return 0;
  if (/\/(?:MM|A)$/i.test(qso.call.trim())) return 5;
  if (context.station.continent !== context.worked.continent) return 10;
  return context.station.primaryPrefix === context.worked.primaryPrefix ? 2 : 5;
}

function cq160Multiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (!cq160Eligible(qso, context) || !context.worked || /\/(?:MM|A)$/i.test(qso.call.trim())) return "";
  const tokens = [`DXCC:${context.worked.primaryPrefix}`];
  const exchange = qso.receivedExchange.trim();
  if (context.worked.primaryPrefix === "W" && TEN_RTTY_US_STATES.has(exchange)) tokens.push(`STATE:${exchange}`);
  else if (context.worked.primaryPrefix === "VE" && TEN_RTTY_CANADIAN_PROVINCES.has(exchange)) tokens.push(`PROVINCE:${exchange}`);
  return tokens.join("; ");
}

function cqWwRttyZone(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>): string {
  const raw = qsoCell(qso, "CQZ") || qso.receivedExchange.trim().split(/\s+/)[0] || "";
  if (!raw) return "";
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed <= 40 ? String(parsed) : "";
}

function cqWwRttyPoints(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.station || !context.worked || !cqWwRttyZone(qso)) return 0;
  if (context.station.primaryPrefix === context.worked.primaryPrefix) return 1;
  return context.station.continent === context.worked.continent ? 2 : 3;
}

function cqWwRttyMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  const zone = cqWwRttyZone(qso);
  if (context.band === "OTHER" || !context.worked || !zone) return "";
  const tokens = [`ZONE:${zone}`, `DXCC:${context.worked.primaryPrefix}`];
  const area = qsoCell(qso, "SRX_STRING").trim().toUpperCase();
  if (context.worked.primaryPrefix === "W" && TEN_RTTY_US_STATES.has(area)) tokens.push(`AREA:${area}`);
  else if (context.worked.primaryPrefix === "VE" && (TEN_RTTY_CANADIAN_PROVINCES.has(area) || area === "PEI")) tokens.push(`AREA:${area}`);
  return tokens.join("; ");
}

const ARR_PSK_SPECIAL_CALLS = new Set(["CT1ARR", "CQ3EPC", "CS2EPC"]);
const ARR_PSK_PORTUGUESE = new Set(["CT", "CT3", "CU"]);

function arrPskEntity(match: GeographyMatch | null): string {
  if (!match) return "";
  if (match.primaryPrefix === "IT9" || match.primaryPrefix === "IG9") return "I";
  if (match.primaryPrefix === "YU8") return "YU";
  return match.primaryPrefix;
}

function arrPskMultiplierCount(rows: readonly ScoreRow[], band?: string): number {
  const dxcc = new Set<string>();
  let portugueseContacts = 0;
  for (const row of rows) {
    if (row.duplicate || (band && row.band !== band)) continue;
    for (const token of scoringMultiplierTokens(row.multiplier)) {
      if (token.startsWith("CT:")) portugueseContacts += 1;
      else dxcc.add(`${row.band}|${token}`);
    }
  }
  return dxcc.size + portugueseContacts;
}

const CWJF_NORMAL_BANDS = new Set(["80M", "40M", "20M", "15M", "10M"]);

function cwjfPoints(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.station || !context.worked) return 0;
  const exchange = qso.receivedExchange.trim().toUpperCase();
  if (exchange.length === 3 && "CYMQ".includes(exchange.at(-1)!)) return 10;
  if (qso.call.toUpperCase().includes("/MM")) return 3;
  if (!CWJF_NORMAL_BANDS.has(context.band)) return 0;
  if (context.station.primaryPrefix === context.worked.primaryPrefix) return 1;
  const low = context.band === "80M" || context.band === "40M";
  return context.station.continent === context.worked.continent ? (low ? 4 : 2) : (low ? 6 : 3);
}

function cwjfMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (context.band === "OTHER" || !context.worked) return "";
  const tokens: string[] = [];
  if (context.worked.continent === "SA") tokens.push(`SA-WPX:${wpxPrefix(qso.call)}`);
  const seen = context.state.get("cwjf-dxcc") ?? new Set<string>();
  context.state.set("cwjf-dxcc", seen);
  if (!seen.has(context.worked.primaryPrefix)) {
    seen.add(context.worked.primaryPrefix);
    tokens.push(`DXCC:${context.worked.primaryPrefix}`);
  }
  return tokens.join("; ");
}

function digQsoMember(exchange: string): number {
  const parsed = Number.parseInt(exchange.trim(), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function digQsoMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (context.band === "OTHER" || !context.worked) return "";
  const tokens = [`DXCC:${context.worked.primaryPrefix}`];
  const member = digQsoMember(qso.receivedExchange);
  if (member !== 0) {
    const seen = context.state.get("dig-qso-members") ?? new Set<string>();
    context.state.set("dig-qso-members", seen);
    const key = String(member);
    if (!seen.has(key)) {
      seen.add(key);
      tokens.push(`DIG:${key}`);
    }
  }
  return tokens.join("; ");
}

const DL_RTTY_AREA_ENTITIES = new Set(["JA", "VE", "W", "VK"]);

function dlRttyPoints(_qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.station || !context.worked) return 0;
  let points = context.station.primaryPrefix === context.worked.primaryPrefix
    ? 5
    : context.station.continent === context.worked.continent ? 10 : 15;
  if (context.worked.primaryPrefix === "DL") points += context.station.continent === context.worked.continent ? 3 : 5;
  return points;
}

function dlRttyMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (context.band === "OTHER" || !context.worked) return "";
  const tokens = [`DXCC:${context.worked.primaryPrefix}`];
  if (DL_RTTY_AREA_ENTITIES.has(context.worked.primaryPrefix)) {
    const digit = wpxPrefix(qso.call).match(/\d/)?.[0];
    if (digit) tokens.push(`AREA:${context.worked.primaryPrefix}${digit}`);
  }
  return tokens.join("; ");
}

function dlRttyMultiplierCount(rows: readonly ScoreRow[], band?: string): number {
  const values = new Set<string>();
  for (const row of rows) {
    if (row.duplicate || row.points <= 0 || (band && row.band !== band)) continue;
    for (const token of scoringMultiplierTokens(row.multiplier)) values.add(`${row.band}|${token}`);
  }
  return values.size;
}

function drcgWwPoints(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.worked) return 0;
  const sentZone = Number.parseInt(qso.sentExchange.trim(), 10);
  const receivedZone = Number.parseInt(qso.receivedExchange.trim(), 10);
  if (sentZone < 1 || sentZone > 40 || receivedZone < 1 || receivedZone > 40) return 0;
  const base = DRCGWW_ZONE_POINTS[sentZone - 1]?.[receivedZone - 1] ?? 0;
  return base * (context.band === "80M" ? 3 : context.band === "20M" ? 2 : 1);
}

function drcgWwMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (context.band === "OTHER" || !context.worked) return "";
  if (!DL_RTTY_AREA_ENTITIES.has(context.worked.primaryPrefix)) return `DXCC:${context.worked.primaryPrefix}`;
  const digit = wpxPrefix(qso.call).match(/\d/)?.[0];
  return digit ? `AREA:${context.worked.primaryPrefix}${digit}` : "";
}

const EA_PROVINCES = new Set("A AB AL AV B BA BI BU C CA CC CE CO CR CS CU GC GI GR GU H HU IB J L LE LO LU M MA ML MU NA O OU P PO S SA SE SG SO SS T TE TF TO V VA VI Z ZA".split(" "));

function isEaContestCall(call: string): boolean {
  return /^(?:EA|EB|EC|ED|EE|EF|EG|EH|AM|AO)/.test(call.trim().toUpperCase());
}

function eaContestEligible(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): boolean {
  return context.band !== "OTHER" && !!context.worked
    && (!isEaContestCall(qso.call) || EA_PROVINCES.has(qso.receivedExchange.trim().toUpperCase()));
}

function eaContestMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (!eaContestEligible(qso, context) || !context.worked) return "";
  const tokens: string[] = [];
  const call = qso.call.trim().toUpperCase();
  const prefix = wpxPrefix(call);
  if (call === "EA4URE") tokens.push("EADX100:EA4URE");
  if (isEaContestCall(call)) tokens.push(`EA:${prefix}`);
  tokens.push(`DXCC:${context.worked.primaryPrefix}`);
  if (DL_RTTY_AREA_ENTITIES.has(context.worked.primaryPrefix)) {
    const digit = prefix.match(/\d/)?.[0];
    if (digit) tokens.push(`AREA:${context.worked.primaryPrefix}${digit}`);
  }
  return tokens.join("; ");
}

function epcSpMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (context.band === "OTHER" || !context.worked || /\/M(?:M)?(?:\/|$)/.test(qso.call.trim().toUpperCase())) return "";
  const tokens = [`DXCC:${context.worked.primaryPrefix}`];
  if (context.worked.primaryPrefix === "SP") tokens.push(`SP:${wpxPrefix(qso.call)}`);
  return tokens.join("; ");
}

function isMobileSuffix(call: string): boolean {
  return /\/M(?:M)?(?:\/|$)/.test(call.trim().toUpperCase());
}

function epcUkrPoints(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.station || !context.worked) return 0;
  const stationIsUkraine = context.station.primaryPrefix === "UR";
  const workedIsUkraine = context.worked.primaryPrefix === "UR";
  if (!stationIsUkraine && workedIsUkraine) return 10;
  if (context.station.continent !== context.worked.continent) return 5;
  if (context.station.primaryPrefix !== context.worked.primaryPrefix) return 2;
  return isMobileSuffix(qso.call) ? 3 : 1;
}

function epcUkrMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (context.band === "OTHER" || !context.worked || isMobileSuffix(qso.call)) return "";
  const tokens = [`DXCC:${context.worked.primaryPrefix}`];
  const oblast = qso.receivedExchange.trim().toUpperCase();
  if (context.worked.primaryPrefix === "UR" && oblast.includes("UR")) tokens.push(`OBLAST:${oblast}`);
  return tokens.join("; ");
}

function epcWwPoints(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.station || !context.worked) return 0;
  if (qso.call.trim().toUpperCase().includes("/MM")) return 3;
  if (context.station.primaryPrefix === context.worked.primaryPrefix) return 1;
  if (context.station.continent === context.worked.continent) {
    if (["80M", "40M", "20M"].includes(context.band)) return 2;
    if (["15M", "10M"].includes(context.band)) return 3;
    return 0;
  }
  if (context.band === "80M") return 6;
  if (["40M", "20M", "15M"].includes(context.band)) return 4;
  return context.band === "10M" ? 5 : 0;
}

const EUDXC_WAE_ENTITIES = new Set("OE ON LZ OK OM 5B 9A OZ OX ES OH OH0 OY OJ0 F PJ7 FG FH FS FJ FY DL SV SV5 SV9 HA EI I IG9 IT9 IS0 LY YL LX 9H PA SP CT CT3 CU YO EA EA6 EA9 SM".split(" "));

function eudxcMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (context.band === "OTHER" || !context.worked) return "";
  const tokens: string[] = [];
  if (EUDXC_WAE_ENTITIES.has(context.worked.primaryPrefix)) {
    const region = qso.receivedExchange.trim().toUpperCase();
    if (region) tokens.push(`REGION:${region}`);
  }
  const area = wpxPrefix(qso.call);
  if (area) tokens.push(`WAE:${area}`);
  return tokens.join("; ");
}

function euPskEntity(primaryPrefix: string): string {
  return primaryPrefix === "YU8" ? "YU" : primaryPrefix === "IG9" || primaryPrefix === "IT9" ? "I" : primaryPrefix;
}

function euPskContinents(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): { station: string; worked: string } {
  return {
    station: /^[A-Z]/.test(qso.sentExchange.trim().toUpperCase()) ? "EU" : context.station?.continent ?? "",
    worked: /^[A-Z]/.test(qso.receivedExchange.trim().toUpperCase()) ? "EU" : context.worked?.continent ?? "",
  };
}

function euPskPoints(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): number {
  if (context.band === "OTHER" || !context.station || !context.worked) return 0;
  const continents = euPskContinents(qso, context);
  if (continents.station !== "EU" && continents.worked === "EU") return 5;
  if (continents.station !== continents.worked) return 3;
  if (euPskEntity(context.station.primaryPrefix) !== euPskEntity(context.worked.primaryPrefix)) return 2;
  return qso.call.trim().toUpperCase().includes("/MM") ? 3 : 1;
}

function euPskMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (context.band === "OTHER" || !context.worked) return "";
  const tokens = [`DXCC:${euPskEntity(context.worked.primaryPrefix)}`];
  if (euPskContinents(qso, context).worked === "EU") {
    const area = qso.receivedExchange.trim().toUpperCase();
    if (area) tokens.push(`EU-AREA:${area}`);
  }
  return tokens.join("; ");
}

const FT8_DX_US_STATES = new Set("CT MA ME NH RI VT NY NJ DE PA MD DC AL GA KY NC FL SC TN VA AR LA MS NM TX OK CA HI AK AZ ID MT NV OR UT WA WY MI OH WV IL IN WI CO IA KS MN MO NE ND SD".split(" "));
const FT8_DX_CANADIAN_PROVINCES = new Set("NB NS QC ON MB SK AB BC NT NF LB YT PE NU".split(" "));

function ft8DxMultiplier(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>, context: ScoringContext): string {
  if (context.band === "OTHER" || !context.worked) return "";
  let exchange = qso.receivedExchange.trim().toUpperCase();
  if (exchange === "PEI") exchange = "PE";
  if (exchange === "NWT") exchange = "NT";
  if (context.worked.primaryPrefix === "W") return FT8_DX_US_STATES.has(exchange) ? `STATE:${exchange}` : "";
  if (context.worked.primaryPrefix === "VE") return FT8_DX_CANADIAN_PROVINCES.has(exchange) ? `PROVINCE:${exchange}` : "";
  return `DXCC:${context.worked.primaryPrefix}`;
}

const SARL_VHF_BAND_FACTOR: Readonly<Record<string, number>> = {
  "10M": 2, "4M": 5, "2M": 2, "1.25M": 2, "70CM": 7, "33CM": 7,
  "23CM": 15, "13CM": 15, "9CM": 15, "6CM": 15, "3CM": 15,
  "1.25CM": 15, "6MM": 15, "4MM": 15, "2.5MM": 15, "2MM": 15, "1MM": 15,
};

function sarlVhfTotal(_points: number, _multipliers: number, rows: readonly ScoreRow[]): number {
  const bands = new Map<string, { points: number; multipliers: Set<string> }>();
  for (const row of rows) {
    const current = bands.get(row.band) ?? { points: 0, multipliers: new Set<string>() };
    current.points += row.points;
    if (row.multiplier) current.multipliers.add(row.multiplier);
    bands.set(row.band, current);
  }
  return [...bands].reduce((sum, [band, data]) => sum + data.points * data.multipliers.size * (SARL_VHF_BAND_FACTOR[band] ?? 0), 0);
}

function aegeanVhfTotal(_points: number, _multipliers: number, rows: readonly ScoreRow[]): number {
  const bands = new Map<string, { qsos: number; points: number; multipliers: Set<string> }>();
  for (const row of rows) {
    const current = bands.get(row.band) ?? { qsos: 0, points: 0, multipliers: new Set<string>() };
    current.qsos += 1;
    current.points += row.points;
    if (row.multiplier) current.multipliers.add(row.multiplier);
    bands.set(row.band, current);
  }
  return [...bands.values()].reduce((sum, data) => sum + data.qsos * data.points * data.multipliers.size, 0);
}

const ARRL_SECTIONS = new Set("CO IA KS MN MO ND NE SD CT EMA ME NH RI VT WMA ENY NLI NNJ NNY SNJ WNY DE EPA MDC WPA AL GA KY NC NFL PR SC SFL TN VA VI WCF AR LA MS NM NTX OK STX WTX EB LAX ORG PAC SB SCV SDG SF SJV SV AK AZ EWA ID MT NV OR UT WWA WY MI OH WV IL IN WI AB BC GH MB NB NL NS ONE ONN ONS PE QC SK TER".split(" "));

function recoveredArrlSection(exchange: string): string {
  const normalized = exchange.trim().toUpperCase();
  const tokens = normalized.split(/[^A-Z0-9]+/).filter(Boolean);
  for (let index = tokens.length - 1; index >= 0; index -= 1) if (ARRL_SECTIONS.has(tokens[index]!)) return tokens[index]!;
  return [...ARRL_SECTIONS].sort((left, right) => right.length - left.length).find((section) => normalized.endsWith(section)) ?? "";
}

export function multiplierCount(rule: ScoringRule, rows: readonly ScoreRow[]): number {
  if (rule.multiplierCount) return rule.multiplierCount(rows);
  if (rule.fixedMultipliers !== undefined) return rule.fixedMultipliers;
  if (rule.bandMultiplier) return [...new Set(rows.filter((row) => !row.duplicate && row.points > 0).map((row) => row.band))].reduce((sum, band) => sum + rule.bandMultiplier!(band), 0);
  const count = new Set(rows.filter((row) => !row.duplicate && row.multiplier).map((row) => rule.multiplierScope === "band" ? `${row.band}|${row.multiplier}` : row.multiplier)).size;
  return Math.max(rule.minimumMultipliers ?? 0, count);
}

const BASSO_FERRARESE_JOLLY_CALLS = new Set(["IQ4FF", "I4JEE", "IZ4OSH", "IK4RDP", "IZ4ISC", "IZ4SJI"]);
const BALTIC_PRIMARY_PREFIXES = new Set(["ES", "YL", "LY"]);
const GDBAGE_INDONESIAN_CALL = /^(?:Y[B-H]|[78][A-I]|P[K-O]|JZ)/i;
const AP_SPRINT_PRIMARY_PREFIXES = new Set([
  "3D2", "3D2R", "3D2C", "4W", "1S", "9M2", "9M6", "9V", "BV", "BV9", "BY", "BS7", "C2", "DU",
  "FK", "FK8C", "FW", "H4", "H40", "HL", "HS", "JA", "JD/O", "JD1M", "KH2", "KH9", "KH0", "P2",
  "T2", "T30", "T33", "T8", "RA0", "V6", "V7", "V8", "VK", "VK9L", "VK9M", "VK9N", "VK9W", "VR",
  "XU", "3W", "XX9", "YB", "YJ", "ZL", "ZL9",
]);
const UK_PRIMARY_PREFIXES = new Set(["G", "GD", "GI", "GJ", "GM", "GU", "GW"]);
const RSGB_160_DISTRICTS = new Set("AB EL LE SK AL EC LL SL BM EH LN SM BA EN LS SN BB EX LU SO BD FK MR SP BH FY ME SR BL GS MK SS BN GL ML ST BR GU NL SW BS GY NE SY BT HA NG TA CA HD NN TD CB HG NP TF CF HP NR TN CH HR NW TQ CM HS OL TR CO HU OX TS CR HX PA TW CT IG PE UB CV IM PH WL CW IP PL WA DA IV PO WC DD JE PR WD DE KA RG WF DG KT RH WN DH KW RM WR DL KY SD WS DN LP SA WV DT LA SE YO DY LD SG ZE".split(" "));
const RSGB_SSB_FD_EXTRA_ITU_ZONES = new Set([46, 47, 48, 52, 53, 57, 66, 67, 74, 75]);
const RSGB_SSB_FD_EXTRA_PREFIXES = new Set(["FT8W", "FT8X", "FT8Z"]);
const ARRL_VHF_FACTORS: Readonly<Record<string, number>> = {
  "6M": 1, "4M": 1, "2M": 1, "1.25M": 2, "70CM": 2, "33CM": 3, "23CM": 3,
  "13CM": 4, "9CM": 4, "6CM": 4, "3CM": 4, "1.25CM": 4, "6MM": 4,
  "4MM": 4, "2.5MM": 4, "2MM": 4, "1MM": 4,
};
const ARRL_VHF_JAN_FACTORS: Readonly<Record<string, number>> = {
  ...ARRL_VHF_FACTORS, "33CM": 4, "23CM": 4, "13CM": 8, "9CM": 8, "6CM": 8,
  "3CM": 8, "1.25CM": 8, "6MM": 8, "4MM": 8, "2.5MM": 8, "2MM": 8, "1MM": 8,
};
const ARRL_UHF_FACTORS: Readonly<Record<string, number>> = {
  "1.25M": 3, "70CM": 3, "33CM": 6, "23CM": 6, "13CM": 12, "9CM": 12,
  "6CM": 12, "3CM": 12, "1.25CM": 12, "6MM": 12, "4MM": 12,
  "2.5MM": 12, "2MM": 12, "1MM": 12,
};

function isPortableWorkedCall(call: string): boolean {
  return /\/(?:P|M|MM)$/i.test(call.trim());
}

function isRsgbSsbFdReducedPointEntity(worked: GeographyMatch | null): boolean {
  if (!worked) return false;
  return ((worked.ituZone >= 17 && worked.ituZone <= 39) && worked.primaryPrefix !== "BY")
    || RSGB_SSB_FD_EXTRA_ITU_ZONES.has(worked.ituZone)
    || RSGB_SSB_FD_EXTRA_PREFIXES.has(worked.primaryPrefix);
}

function epcMemberId(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>): string {
  const exchange = qso.receivedExchange.trim().toUpperCase();
  if (!exchange.includes("EPC")) return "";
  const digits = exchange.replace(/\D/g, "");
  if (digits === "0000") return "";
  return `EPC${String(Number.parseInt(digits || "0", 10) || 0).padStart(4, "0")}`;
}

function iotaReference(value: string): string {
  const exchange = value.trim().toUpperCase();
  return /(?:AF|AN|AS|EU|NA|OC|SA)-\d+/i.test(exchange) ? exchange.match(/(?:AF|AN|AS|EU|NA|OC|SA)-\d+/i)![0]!.toUpperCase() : "";
}

function isApSprintEntity(match: GeographyMatch | null): boolean {
  return !!match && AP_SPRINT_PRIMARY_PREFIXES.has(match.primaryPrefix);
}

function bassoFerrareseEligible(qso: NonNullable<CabrilloDocument["lines"][number]["qso"]>): boolean {
  return ["40M", "20M"].includes(bandFromFrequency(qso.frequency));
}

function bassoFerrareseTotal(_points: number, _multipliers: number, rows: readonly ScoreRow[]): number {
  const bands = new Map<string, { points: number; jolly: number }>();
  for (const row of rows) {
    if (row.points <= 0) continue;
    const current = bands.get(row.band) ?? { points: 0, jolly: 0 };
    current.points += row.points;
    if (row.multiplier === "JOLLY") current.jolly += 1;
    bands.set(row.band, current);
  }
  return [...bands.values()].reduce((sum, band) => sum + band.points * (band.jolly > 0 ? band.jolly * 100 : 1), 0);
}

export function scoringTotal(rule: ScoringRule, points: number, multipliers: number, rows: readonly ScoreRow[], document?: CabrilloDocument): number {
  const bonus = document && rule.scoreBonus ? rule.scoreBonus(document) : 0;
  if (rule.bandMultiplier) {
    const byBand = new Map<string, number>();
    for (const row of rows) byBand.set(row.band, (byBand.get(row.band) ?? 0) + row.points);
    return [...byBand].reduce((sum, [band, bandPoints]) => sum + bandPoints * rule.bandMultiplier!(band), bonus);
  }
  return (rule.total?.(points, multipliers, rows, document) ?? points * multipliers) + bonus;
}

export function scoringFormula(rule: ScoringRule, points: number, multipliers: number, document?: CabrilloDocument): string {
  const bonus = document && rule.scoreBonus ? rule.scoreBonus(document) : 0;
  return rule.scoreFormula?.(points, multipliers, bonus) ?? (rule.bandMultiplier
    ? `Sum of per-band points × recovered band factor (${points.toLocaleString()} points, ${multipliers.toLocaleString()} total active factors)`
    : rule.total === bandProductTotal
    ? `Sum of per-band points × per-band multipliers (${points.toLocaleString()} points, ${multipliers.toLocaleString()} band multipliers)`
    : `${points.toLocaleString()} points × ${multipliers.toLocaleString()} multipliers`);
}

export const scoringRules: ScoringRule[] = [
  {
    id: "generic-prefix",
    name: "Generic prefix score",
    description: "One point per non-duplicate QSO multiplied by unique worked callsign prefixes.",
    points: () => 1,
    multiplier: (qso) => wpxPrefix(qso.call) || callsignPrefix(qso.call),
  },
  {
    id: "wfd-recovered",
    name: "WFD recovered QSO points",
    description: "Ported from wfd.dll: two points for CW/digital contacts and one point for phone contacts. The legacy module explicitly excludes objective multipliers.",
    points: (qso) => /^(?:PH|FM|AM)$/i.test(qso.mode) ? 1 : 2,
    multiplier: () => "QSO",
    fixedMultipliers: 1,
  },
  {
    id: "cq-wpx-recovered",
    name: "CQ WPX recovered scoring",
    description: "Recovered CQ WPX behavior: contacts score by band and geographic relationship; unique WPX prefixes multiply the QSO points.",
    points: (_qso, { band, station, worked }) => {
      if (!station || !worked) return 0;
      if (station.country === worked.country) return 1;
      const lowBand = ["160M", "80M", "40M"].includes(band);
      if (station.continent === worked.continent) {
        const northAmericaBonus = station.continent === "NA" ? 2 : 1;
        return (lowBand ? 2 : 1) * northAmericaBonus;
      }
      return lowBand ? 6 : 3;
    },
    multiplier: (qso) => wpxPrefix(qso.call),
    duplicateKey: (qso, band) => `${band}|${qso.call.toUpperCase()}`,
  },
  {
    id: "sarl-youth-recovered",
    name: "SARL Youth Sprint recovered scoring",
    description: "Recovered SARL Youth Sprint age-branch points with no multiplier: youth-to-youth 5, youth-to-other 2, other-to-youth 2, other-to-other 1.",
    points: (qso) => {
      const sentAge = Number.parseInt(qso.sentExchange, 10);
      const receivedAge = Number.parseInt(qso.receivedExchange, 10);
      if (!Number.isFinite(sentAge) || !Number.isFinite(receivedAge)) return 0;
      const sentYouth = sentAge < 26;
      const receivedYouth = receivedAge < 26;
      if (sentYouth) return receivedYouth ? 5 : 2;
      return receivedYouth ? 2 : 1;
    },
    multiplier: () => "QSO",
    fixedMultipliers: 1,
  },
  {
    id: "sarl-yl-recovered",
    name: "SARL YL Sprint recovered scoring",
    description: "Recovered SARL YL Sprint exchange branches with no multiplier: YL-to-YL 5, mixed YL 3, neither YL 1.",
    points: (qso) => {
      const sentYl = qso.sentExchange.trim().toUpperCase() === "YL";
      const receivedYl = qso.receivedExchange.trim().toUpperCase() === "YL";
      if (sentYl && receivedYl) return 5;
      if (sentYl || receivedYl) return 3;
      return 1;
    },
    multiplier: () => "QSO",
    fixedMultipliers: 1,
  },
  {
    id: "wia-ha-recovered",
    name: "WIA Harry Angel recovered scoring",
    description: "Recovered wiaha.dll behavior: valid 80 m CW contacts score 2 points, other valid 80 m modes score 1, with no multiplier.",
    points: (qso, { band }) => band === "80M" ? (qso.mode.toUpperCase() === "CW" ? 2 : 1) : 0,
    multiplier: () => "QSO",
    duplicateKey: (qso, band) => `${band}|${qso.call.toUpperCase()}`,
    fixedMultipliers: 1,
  },
  {
    id: "ukeicc-recovered",
    name: "UKEICC 80 m recovered scoring",
    description: "Recovered ukeicc.dll locator-distance points: one point in the first 500 km, then one additional point for each started 500 km.",
    points: (qso) => {
      const sent = qso.sentExchange.trim().split(/\s+/).at(-1) ?? "";
      const received = qso.receivedExchange.trim().split(/\s+/).at(-1) ?? "";
      if (sent.toUpperCase() === received.toUpperCase() && sent) return 1;
      const distance = maidenheadDistanceKm(sent, received);
      if (distance === null) return 0;
      const roundedUp = Math.ceil(distance);
      return roundedUp < 500 ? 1 : Math.floor(roundedUp / 500) + 1;
    },
    multiplier: () => "QSO",
    duplicateKey: (qso, band) => `${band}|${qso.call.toUpperCase()}`,
    fixedMultipliers: 1,
  },
  {
    id: "radio-popov-recovered",
    name: "Radio Popov recovered scoring",
    description: "Recovered popov.dll behavior: each valid contact contributes the numeric received points exchange; there is no contest multiplier.",
    points: (qso) => {
      const value = Number.parseInt(qso.receivedExchange.trim(), 10);
      return Number.isFinite(value) && value >= 0 ? value : 0;
    },
    multiplier: () => "QSO",
    duplicateKey: (qso, band) => `${band}|${qso.call.toUpperCase()}`,
    fixedMultipliers: 1,
  },
  {
    id: "ig-rtty-recovered",
    name: "IG-RY recovered scoring",
    description: "Recovered igrtty.dll behavior: one point per valid contact multiplied by unique received year exchanges across all bands.",
    points: (qso) => qso.receivedExchange.trim() ? 1 : 0,
    multiplier: (qso) => qso.receivedExchange.trim().toUpperCase(),
    duplicateKey: (qso, band) => `${band}|${qso.call.toUpperCase()}`,
  },
  {
    id: "cwops-recovered",
    name: "CW-OPS recovered scoring",
    description: "Recovered cwops.dll behavior: one point per valid contact multiplied by unique worked callsigns across all bands.",
    points: () => 1,
    multiplier: (qso) => qso.call.trim().toUpperCase(),
    duplicateKey: (qso, band) => `${band}|${qso.call.toUpperCase()}`,
  },
  {
    id: "hsc-recovered",
    name: "HSC-CW recovered scoring",
    description: "Recovered hsc.dll behavior: contacts with a positive numeric HSC membership exchange score five points; NM and other non-empty exchanges score one.",
    points: (qso) => {
      const exchange = qso.receivedExchange.trim().toUpperCase();
      if (!exchange) return 0;
      return exchange !== "NM" && Number.parseInt(exchange, 10) > 0 ? 5 : 1;
    },
    multiplier: () => "QSO",
    duplicateKey: (qso, band) => `${band}|${qso.call.toUpperCase()}`,
    fixedMultipliers: 1,
  },
  {
    id: "arrl-ss-recovered",
    name: "ARRL Sweepstakes recovered scoring",
    description: "Recovered arrlss.dll behavior: two points per valid contact multiplied by unique recognized ARRL/RAC sections.",
    points: () => 2,
    multiplier: (qso) => recoveredArrlSection(qso.receivedExchange),
    duplicateKey: (qso, band) => `${band}|${qso.call.toUpperCase()}`,
  },
  {
    id: "euhfc-recovered",
    name: "EUHFC recovered scoring",
    description: "Recovered euhfc.dll behavior: one point per valid contact multiplied by unique received-year exchanges on each band.",
    points: (qso) => qso.receivedExchange.trim() ? 1 : 0,
    multiplier: (qso) => qso.receivedExchange.trim().toUpperCase(),
    duplicateKey: (qso, band) => `${band}|${qso.call.toUpperCase()}`,
    multiplierScope: "band",
  },
  {
    id: "spar-wfd-recovered",
    name: "SPAR Winter Field Day recovered scoring",
    description: "Recovered sparwfd.dll behavior: one point per CW, phone, RTTY, television, or satellite QSO multiplied by unique modes on each band.",
    points: (qso) => /^(?:CW|PH|RY|TV|SA)$/i.test(qso.mode) ? 1 : 0,
    multiplier: (qso) => /^(?:CW|PH|RY|TV|SA)$/i.test(qso.mode) ? qso.mode.trim().toUpperCase() : "",
    duplicateKey: (qso, band) => `${band}|${qso.mode.toUpperCase()}|${qso.call.toUpperCase()}`,
    multiplierScope: "band",
  },
  {
    id: "popov-vhf-recovered",
    name: "Popov VHF recovered scoring",
    description: "Recovered popvhf.dll behavior: each valid locator pair contributes its whole-kilometre great-circle distance, summed without a multiplier or duplicate elimination.",
    points: recoveredLocatorDistancePoints,
    multiplier: () => "QSO",
    duplicatePolicy: "none",
    fixedMultipliers: 1,
  },
  {
    id: "tmc-rtty-recovered",
    name: "TMC RTTY recovered scoring",
    description: "Recovered tmc.dll behavior: each valid locator pair contributes its whole-kilometre great-circle distance, summed without a multiplier or duplicate elimination.",
    points: recoveredLocatorDistancePoints,
    multiplier: () => "QSO",
    duplicatePolicy: "none",
    fixedMultipliers: 1,
  },
  {
    id: "pears-vhf-recovered",
    name: "PEARS VHF/UHF recovered scoring",
    description: "Recovered pears.dll behavior: whole-kilometre locator distance points, with a one-point same-locator contact, multiplied by unique four-character received grid squares on each band.",
    points: (qso) => {
      const sent = locatorValue(qso, "sent");
      const received = locatorValue(qso, "received");
      if (sent && sent === received) return 1;
      return recoveredLocatorDistancePoints(qso);
    },
    multiplier: (qso) => locatorValue(qso, "received").slice(0, 4),
    duplicatePolicy: "none",
    multiplierScope: "band",
    total: bandProductTotal,
  },
  {
    id: "digifest-recovered",
    name: "DIGIFEST recovered scoring",
    description: "Recovered digifest.dll behavior: whole-kilometre locator points, with a one-point same-locator contact, multiplied by unique four-character received grid squares across all bands.",
    points: (qso) => {
      const sent = locatorValue(qso, "sent");
      const received = locatorValue(qso, "received");
      if (sent && sent === received) return 1;
      return recoveredLocatorDistancePoints(qso);
    },
    multiplier: (qso) => locatorValue(qso, "received").slice(0, 4),
    duplicatePolicy: "none",
  },
  {
    id: "wia-vhf-recovered",
    name: "WIA VHF/UHF recovered scoring",
    description: "Recovered wiavhf.dll behavior: one base point plus ten for each newly seen sent and received four-character grid on a band, multiplied by the module's fixed band factor.",
    points: (qso, { band, state }) => {
      const sent = locatorValue(qso, "sent").slice(0, 4);
      const received = locatorValue(qso, "received").slice(0, 4);
      if (!sent || !received) return 0;
      const sentKey = `${band}|sent`;
      const receivedKey = `${band}|received`;
      const sentSeen = state.get(sentKey) ?? new Set<string>();
      const receivedSeen = state.get(receivedKey) ?? new Set<string>();
      let points = 1;
      if (!sentSeen.has(sent)) { sentSeen.add(sent); points += 10; }
      if (!receivedSeen.has(received)) { receivedSeen.add(received); points += 10; }
      state.set(sentKey, sentSeen);
      state.set(receivedKey, receivedSeen);
      return points;
    },
    multiplier: (qso) => locatorValue(qso, "received").slice(0, 4),
    duplicatePolicy: "none",
    bandMultiplier: (band) => ({ "10M": 1, "4M": 1, "2M": 3, "1.25M": 3, "70CM": 5, "33CM": 5, "23CM": 8, "13CM": 10, "9CM": 10, "6CM": 10, "3CM": 10, "1.25CM": 10, "6MM": 10, "4MM": 10, "2.5MM": 10, "2MM": 10, "1MM": 10 }[band] ?? 0),
  },
  {
    id: "sarl-vhf-recovered",
    name: "SARL VHF/UHF recovered scoring",
    description: "Recovered sarlvhf.dll behavior: whole-kilometre locator points multiplied per band by unique four-character received grids and a fixed band factor.",
    points: (qso) => {
      const sent = locatorValue(qso, "sent");
      const received = locatorValue(qso, "received");
      if (sent && sent === received) return 1;
      return recoveredLocatorDistancePoints(qso);
    },
    multiplier: (qso) => locatorValue(qso, "received").slice(0, 4),
    duplicatePolicy: "none",
    multiplierScope: "band",
    total: sarlVhfTotal,
    scoreFormula: (points, multipliers) => `Sum of per-band distance points × unique grids × recovered band factor (${points.toLocaleString()} points, ${multipliers.toLocaleString()} band-grid multipliers)`,
  },
  {
    id: "aegean-vhf-recovered",
    name: "Aegean VHF recovered scoring",
    description: "Recovered aegvhf.dll behavior: for each band, QSO count × summed rounded-up locator kilometres × unique four-character received grids.",
    points: (qso) => {
      const sent = locatorValue(qso, "sent");
      const received = locatorValue(qso, "received");
      if (sent && sent === received) return 1;
      const distance = maidenheadDistanceKm(sent, received);
      return distance === null ? 0 : Math.ceil(distance);
    },
    multiplier: (qso) => locatorValue(qso, "received").slice(0, 4),
    duplicatePolicy: "none",
    multiplierScope: "band",
    total: aegeanVhfTotal,
    scoreFormula: (points, multipliers) => `Sum of per-band QSO count × distance points × unique grids (${points.toLocaleString()} points, ${multipliers.toLocaleString()} band-grid multipliers)`,
  },
  {
    id: "rsgb-low-power-recovered",
    name: "RSGB Low Power recovered scoring",
    description: "Recovered rsgblp.dll behavior: /M or /P stations score 15 points at up to 10 W and 5 otherwise; fixed stations score 10 points at up to 10 W and 5 otherwise.",
    points: (qso) => {
      if (!qso.call.trim()) return 0;
      const powerText = qsoCell(qso, "SRX_STRING") || qso.receivedExchange;
      const power = Number.parseFloat(powerText.trim().toUpperCase().replace("W", "."));
      const lowPower = power > 0 && power <= 10;
      const portable = /\/(?:M|P)$/i.test(qso.call.trim());
      return portable ? (lowPower ? 15 : 5) : (lowPower ? 10 : 5);
    },
    multiplier: () => "QSO",
    duplicatePolicy: "none",
    fixedMultipliers: 1,
  },
  {
    id: "remembrance-day-recovered",
    name: "Remembrance Day recovered scoring",
    description: "Recovered remd.dll behavior: band-dependent base points, tripled strictly between 11:00 and 16:00, and doubled for CW or RTTY, with no multiplier.",
    points: (qso, { band }) => {
      if (!qso.call.trim()) return 0;
      const microwaveOr160 = ["23CM", "13CM", "9CM", "6CM", "3CM", "1.25CM", "6MM", "4MM", "2.5MM", "2MM", "1MM", "160M"].includes(band);
      let points = microwaveOr160 ? 2 : 1;
      const minutes = Number.parseInt(qso.time.slice(0, 2), 10) * 60 + Number.parseInt(qso.time.slice(2, 4), 10);
      if (Number.isFinite(minutes) && minutes > 660 && minutes < 960) points *= 3;
      if (/^(?:CW|RY)$/i.test(qso.mode)) points *= 2;
      return points;
    },
    multiplier: () => "QSO",
    duplicatePolicy: "none",
    fixedMultipliers: 1,
  },
  {
    id: "basso-ferrarese-recovered",
    name: "BASSO-FERRARESE recovered scoring",
    description: "Recovered basfer.dll behavior: only 40 m and 20 m contacts count; six embedded Jolly calls score 100 points and produce the legacy per-band Jolly factor.",
    points: (qso) => bassoFerrareseEligible(qso) ? (BASSO_FERRARESE_JOLLY_CALLS.has(qso.call.trim().toUpperCase()) ? 100 : 1) : 0,
    multiplier: (qso) => bassoFerrareseEligible(qso) && BASSO_FERRARESE_JOLLY_CALLS.has(qso.call.trim().toUpperCase()) ? "JOLLY" : "",
    duplicatePolicy: "none",
    multiplierCount: (rows) => rows.filter((row) => row.multiplier === "JOLLY" && row.points > 0).length,
    bandMultiplierCount: (rows, band) => rows.filter((row) => row.band === band && row.multiplier === "JOLLY" && row.points > 0).length,
    total: bassoFerrareseTotal,
    scoreFormula: (points, multipliers) => `Sum per band of points × (Jolly QSOs × 100, or 1 when none) (${points.toLocaleString()} points, ${multipliers.toLocaleString()} Jolly QSOs)`,
    notes: ["Fixture-backed exact port of the legacy module's unusual per-band Jolly multiplication. Out-of-band contacts score zero, and repeated contacts are retained as the DLL did."],
  },
  {
    id: "bdm-ww-rtty-recovered",
    name: "BDM-WW-RTTY recovered scoring",
    description: "Recovered bdm.dll behavior: five points for a contact on the operator's continent and ten points for a contact on another continent, with no contest multiplier.",
    points: (_qso, { station, worked }) => !station || !worked ? 0 : (station.continent === worked.continent ? 5 : 10),
    multiplier: () => "QSO",
    duplicatePolicy: "none",
    fixedMultipliers: 1,
    notes: ["Fixture-backed recovered continent comparison using the active local DXCC/CTY table. Unresolved calls score zero conservatively; every parsed row is counted as in the DLL."],
  },
  {
    id: "aegean-rtty-recovered",
    name: "AEGEAN-RTTY recovered scoring",
    description: "Recovered aegean.dll behavior: band- and continent-dependent points, doubled for worked /QRP stations, tripled for SV5/SV8/SV9, plus the legacy 20-point operator /QRP bonus.",
    points: (qso, { band, station, worked }) => {
      if (!station || !worked) return 0;
      const sameContinent = station.continent === worked.continent;
      let points = sameContinent
        ? ({ "160M": 3, "80M": 3, "40M": 3, "20M": 1, "15M": 1, "10M": 1 }[band] ?? 0)
        : ({ "80M": 6, "40M": 6, "20M": 2, "15M": 2, "10M": 2 }[band] ?? 0);
      if (/[\\/]QRP/i.test(qso.call)) points *= 2;
      if (/^SV(?:5|8|9)$/i.test(worked.matchedPrefix)) points *= 3;
      return points;
    },
    multiplier: () => "QSO",
    duplicatePolicy: "none",
    fixedMultipliers: 1,
    scoreBonus: (document) => /[\\/]QRP/i.test(document.lines.find((line) => line.key === "CALLSIGN")?.value ?? "") ? 20 : 0,
    scoreFormula: (points, _multipliers, bonus) => `${points.toLocaleString()} recovered QSO points${bonus ? ` + ${bonus.toLocaleString()} operator QRP bonus` : ""}`,
    notes: ["Fixture-backed recovered band, continent, worked-QRP, Aegean-island-prefix, and operator-QRP branches. Local DXCC/CTY resolution is used; unresolved calls score zero conservatively."],
  },
  {
    id: "baltic-recovered",
    name: "BALTIC recovered scoring",
    description: "Recovered baltic.dll behavior: Baltic operators score one point within their continent and two outside it; other operators score 10/20 for Baltic contacts and one for other contacts.",
    points: (_qso, { station, worked }) => {
      if (!station || !worked) return 0;
      const sameContinent = station.continent === worked.continent;
      if (BALTIC_PRIMARY_PREFIXES.has(station.primaryPrefix)) return sameContinent ? 1 : 2;
      return BALTIC_PRIMARY_PREFIXES.has(worked.primaryPrefix) ? (sameContinent ? 10 : 20) : 1;
    },
    multiplier: () => "QSO",
    duplicatePolicy: "none",
    fixedMultipliers: 1,
    notes: ["Fixture-backed recovered Baltic/non-Baltic and continent branches using the active local DXCC/CTY table. Every parsed row is counted as in the DLL."],
  },
  {
    id: "inorc-recovered",
    name: "INORC recovered scoring",
    description: "Recovered inorc.dll behavior: member contacts score 10 points and non-members one, doubled on 20/15/10 m; unique worked members multiply the points with a minimum multiplier of one.",
    points: (qso, { band }) => {
      const member = /^[A-Z]/i.test(qso.receivedExchange.trim());
      const highBand = ["20M", "15M", "10M"].includes(band);
      return member ? (highBand ? 20 : 10) : (highBand ? 2 : 1);
    },
    multiplier: (qso) => /^[A-Z]/i.test(qso.receivedExchange.trim()) ? qso.call.trim().toUpperCase() : "",
    duplicatePolicy: "none",
    minimumMultipliers: 1,
    notes: ["Fixture-backed recovered member/non-member, high-band, and unique-member multiplier branches. Empty exchanges score conservatively as non-member contacts, matching the DLL's first-character test."],
  },
  {
    id: "wwpmc-recovered",
    name: "WWPMC recovered scoring",
    description: "Recovered pmc.dll behavior: member/non-member point branches and unique received PMC identifiers per band and CW/non-CW group.",
    points: (qso) => {
      const operatorExchange = qso.sentExchange.trim().toUpperCase();
      const workedExchange = qso.receivedExchange.trim().toUpperCase();
      const operatorMember = /^[A-Z]{2}.{1,}$/.test(operatorExchange);
      const workedMember = /^[A-Z]{2}.{1,}$/.test(workedExchange);
      if (!operatorMember) return workedMember ? 25 : 5;
      return workedMember && workedExchange !== operatorExchange ? 10 : 5;
    },
    multiplier: (qso) => {
      const exchange = qso.receivedExchange.trim().toUpperCase();
      return /^[A-Z]{2}.{1,}$/.test(exchange) ? `${qso.mode.toUpperCase() === "CW" ? "CW" : "OTHER"}|${exchange}` : "";
    },
    duplicatePolicy: "none",
    multiplierScope: "band",
    minimumMultipliers: 1,
    notes: ["Fixture-backed recovered operator/received membership, same-member, and band/mode-scoped multiplier branches. The legacy two-leading-letter membership test is preserved exactly."],
  },
  {
    id: "ukr-champ-rtty-recovered",
    name: "UKR-CHAMP-RTTY recovered scoring",
    description: "Recovered urtty.dll behavior: 12 points for the first worked-DXCC plus received-serial combination on a band and two points for a repeated combination.",
    points: (qso, { band, worked, state }) => {
      const received = qsoCell(qso, "SRX") || qso.receivedExchange.trim().split(/\s+/).at(-1) || "";
      if (!worked || !received) return 0;
      const stateKey = `${band}|country-serial`;
      const seen = state.get(stateKey) ?? new Set<string>();
      const key = `${worked.primaryPrefix}|${received.toUpperCase()}`;
      const first = !seen.has(key);
      seen.add(key);
      state.set(stateKey, seen);
      return first ? 12 : 2;
    },
    multiplier: () => "QSO",
    duplicatePolicy: "none",
    fixedMultipliers: 1,
    notes: ["Fixture-backed literal port of the recovered `Rcvd` calculator-column behavior. `Rcvd` is the received serial, distinct from the region exchange; local DXCC/CTY data supplies the country key."],
  },
  {
    id: "gdbage-dx-recovered",
    name: "GDBAGE-DX-TEST recovered scoring",
    description: "Recovered gdbage.dll behavior: three points on 80 m and two on other bands, multiplied by unique Indonesian WPX prefixes on each band.",
    points: (_qso, { band, worked }) => worked ? (band === "80M" ? 3 : 2) : 0,
    multiplier: (qso) => GDBAGE_INDONESIAN_CALL.test(qso.call.trim()) ? wpxPrefix(qso.call) : "",
    duplicatePolicy: "none",
    multiplierScope: "band",
    notes: ["Fixture-backed recovered 80 m point branch and embedded YB-YH, 7A-7I, 8A-8I, PK-PO, and JZ multiplier-prefix ranges. Unresolved calls score zero conservatively."],
  },
  {
    id: "ap-sprint-recovered",
    name: "AP-SPRINT recovered scoring",
    description: "Recovered apsprint.dll behavior: AP operators count all resolved contacts, other operators count AP contacts only; one point per accepted QSO times unique WPX prefixes globally.",
    points: (_qso, { station, worked }) => worked && (isApSprintEntity(station) || isApSprintEntity(worked)) ? 1 : 0,
    multiplier: (qso, { station, worked }) => worked && (isApSprintEntity(station) || isApSprintEntity(worked)) ? wpxPrefix(qso.call) : "",
    duplicatePolicy: "none",
    notes: ["Fixture-backed against the DLL's embedded AP DXCC entity list and global prefix store. The exact recovered primary entities are used instead of a broad continent approximation."],
  },
  {
    id: "9a-cw-recovered",
    name: "9A-CW recovered scoring",
    description: "Recovered 9acw.dll behavior: Croatian/operator, band, and continent point branches multiplied by unique worked DXCC entities on each band.",
    points: (_qso, { band, station, worked }) => {
      if (!station || !worked) return 0;
      const lowBand = ["160M", "80M", "40M"].includes(band);
      const operatorCroatian = station.primaryPrefix === "9A";
      const workedCroatian = worked.primaryPrefix === "9A";
      const sameContinent = station.continent === worked.continent;
      if (!operatorCroatian && workedCroatian) return lowBand ? 10 : 6;
      if (operatorCroatian) return lowBand ? (sameContinent ? 4 : 10) : (sameContinent ? 2 : 6);
      return lowBand ? (sameContinent ? 2 : 6) : (sameContinent ? 1 : 3);
    },
    multiplier: (_qso, { worked }) => worked?.primaryPrefix ?? "",
    duplicatePolicy: "none",
    multiplierScope: "band",
    notes: ["Fixture-backed recovered Croatian/non-Croatian, low-band, continent, and per-band DXCC branches using the active local DXCC/CTY table."],
  },
  {
    id: "rsgb-160-recovered",
    name: "RSGB-160 recovered scoring",
    description: "Recovered rsgb160.dll behavior: two points per valid 1.8–2.1 MHz QSO plus five for each first UK district or DXCC, according to operator location.",
    points: (qso, { station, worked, state }) => {
      const frequency = Number.parseFloat(qso.frequency);
      if (!station || !worked || !Number.isFinite(frequency) || frequency < 1800 || frequency > 2100) return 0;
      const operatorUk = UK_PRIMARY_PREFIXES.has(station.primaryPrefix);
      const workedUk = UK_PRIMARY_PREFIXES.has(worked.primaryPrefix);
      let key = "";
      let stateKey = "";
      if (workedUk) {
        const district = qsoCell(qso, "SRX_STRING") || qso.receivedExchange.trim().split(/\s+/).at(-1) || "";
        if (!RSGB_160_DISTRICTS.has(district.toUpperCase())) return 0;
        key = district.toUpperCase();
        stateKey = "district";
      } else if (operatorUk) {
        key = worked.primaryPrefix;
        stateKey = "dxcc";
      } else {
        return 2;
      }
      const seen = state.get(stateKey) ?? new Set<string>();
      const first = !seen.has(key);
      seen.add(key);
      state.set(stateKey, seen);
      return first ? 7 : 2;
    },
    multiplier: () => "QSO",
    duplicatePolicy: "none",
    fixedMultipliers: 1,
    notes: ["Fixture-backed recovered frequency bounds, UK operator/contact classification, embedded district validation, and first-district/first-DXCC bonuses. Bonuses are included in per-QSO points as in the DLL total."],
  },
  {
    id: "rsgb-nfd-recovered",
    name: "RSGB-NFD recovered scoring",
    description: "Recovered rsgbnfd.dll behavior: EU contacts score two and other continents three, doubled on 10/160 m and doubled for /P or /M contacts.",
    points: (qso, { band, worked }) => {
      if (!worked) return 0;
      const bandFactor = band === "10M" || band === "160M" ? 2 : 1;
      const portableFactor = isPortableWorkedCall(qso.call) ? 2 : 1;
      return (worked.continent === "EU" ? 2 : 3) * bandFactor * portableFactor;
    },
    multiplier: () => "QSO",
    duplicatePolicy: "none",
    fixedMultipliers: 1,
    notes: ["Fixture-backed against every EU/DX, ordinary/10-or-160-m, and fixed/portable branch. The DLL scores every parsed QSO and uses local DXCC data; unresolved calls score zero conservatively."],
  },
  {
    id: "rsgb-ssb-fd-recovered",
    name: "RSGB-SSB-FD recovered scoring",
    description: "Recovered rsgbsfd.dll behavior: two or five points for the embedded ITU-zone/entity set, otherwise three, with non-portable DXCC multipliers on each band.",
    points: (qso, { worked }) => {
      if (!worked) return 0;
      if (!isRsgbSsbFdReducedPointEntity(worked)) return 3;
      return isPortableWorkedCall(qso.call) ? 5 : 2;
    },
    multiplier: (qso, { worked }) => isPortableWorkedCall(qso.call) ? "" : worked?.primaryPrefix ?? "",
    duplicatePolicy: "none",
    multiplierScope: "band",
    notes: ["Fixture-backed recovered ITU 17–39 range, BY exclusion, explicit ITU-zone exceptions, portable point branch, and band-scoped non-portable primary-DXCC multipliers. Unresolved calls score zero conservatively."],
  },
  {
    id: "arrl-uhf-recovered",
    name: "ARRL UHF recovered scoring",
    description: "Recovered arrluhf.dll behavior: fixed UHF/microwave band points multiplied by unique four-character received grid squares on each band.",
    points: (_qso, { band }) => ARRL_UHF_FACTORS[band] ?? 0,
    multiplier: (qso, { band }) => ARRL_UHF_FACTORS[band] ? locatorValue(qso, "received").slice(0, 4) : "",
    duplicatePolicy: "none",
    multiplierScope: "band",
    notes: ["Fixture-backed recovered 1.25 m/70 cm, 33/23 cm, and 13 cm-through-1 mm point groups. Every parsed valid-band QSO counts; received four-character grids are band-scoped multipliers."],
  },
  {
    id: "arrl-vhf-recovered",
    name: "ARRL VHF recovered scoring",
    description: "Recovered arrlvhf.dll behavior: fixed VHF/UHF/microwave band points multiplied by unique four-character received grid squares on each band.",
    points: (_qso, { band }) => ARRL_VHF_FACTORS[band] ?? 0,
    multiplier: (qso, { band }) => ARRL_VHF_FACTORS[band] ? locatorValue(qso, "received").slice(0, 4) : "",
    duplicatePolicy: "none",
    multiplierScope: "band",
    notes: ["Fixture-backed recovered 6/4/2 m, 1.25 m/70 cm, 33/23 cm, and 13 cm-through-1 mm point groups. Every parsed valid-band QSO counts."],
  },
  {
    id: "arrl-vhf-jan-recovered",
    name: "ARRL January VHF recovered scoring",
    description: "Recovered arrlvjan.dll behavior: January-specific fixed band points multiplied by unique four-character received grid squares on each band.",
    points: (_qso, { band }) => ARRL_VHF_JAN_FACTORS[band] ?? 0,
    multiplier: (qso, { band }) => ARRL_VHF_JAN_FACTORS[band] ? locatorValue(qso, "received").slice(0, 4) : "",
    duplicatePolicy: "none",
    multiplierScope: "band",
    notes: ["Fixture-backed January factors: one point through 2 m, two on 1.25 m/70 cm, four on 33/23 cm, and eight on 13 cm through 1 mm."],
  },
  {
    id: "cq-vhf-recovered",
    name: "CQ-VHF recovered scoring",
    description: "Recovered cqvhf.dll behavior: two points on 4 m and 2 m, one on other recognized bands, multiplied by unique sent-to-received four-character grid paths per band.",
    points: (_qso, { band }) => band === "OTHER" ? 0 : (band === "4M" || band === "2M" ? 2 : 1),
    multiplier: (qso, { band }) => {
      if (band === "OTHER") return "";
      const sent = locatorValue(qso, "sent").toUpperCase();
      const received = locatorValue(qso, "received").slice(0, 4).toUpperCase();
      return sent && received ? `${sent}->${received}` : "";
    },
    duplicatePolicy: "none",
    multiplierScope: "band",
    notes: ["Fixture-backed recovered 4 m/2 m point branch, no-dedup behavior, and sent-grid-to-received-grid path identity. The recovered module retains the full sent value and truncates the received grid to four characters."],
  },
  {
    id: "epc-psk63-recovered",
    name: "EPC-PSK63 recovered scoring",
    description: "Recovered epc.dll behavior: five points for a nonzero EPC member exchange, one for a non-member exchange, multiplied by unique EPC numbers per band.",
    points: (qso) => {
      if (!qso.receivedExchange.trim()) return 0;
      if (!qso.receivedExchange.toUpperCase().includes("EPC")) return 1;
      return epcMemberId(qso) ? 5 : 0;
    },
    multiplier: (qso) => epcMemberId(qso),
    duplicateKey: (qso, band) => `${band}|${qso.call.toUpperCase()}`,
    multiplierScope: "band",
    notes: ["Fixture-backed recovered member/non-member/zero-member branches, band-plus-callsign duplicate identity, and band-scoped normalized EPC membership multipliers."],
  },
  {
    id: "ari-sez-recovered",
    name: "ARI-SEZ recovered scoring",
    description: "Recovered arisez.dll behavior: fixed HF band points multiplied by unique four-character received sections per band and CW/phone/other mode group.",
    points: (_qso, { band }) => ({ "160M": 2, "80M": 2, "40M": 1, "20M": 3, "15M": 5, "10M": 5 }[band] ?? 0),
    multiplier: (qso, { band }) => {
      if (band === "OTHER") return "";
      const section = qso.receivedExchange.trim().toUpperCase().slice(0, 4);
      if (!section) return "";
      const mode = qso.mode.toUpperCase() === "CW" ? "CW" : qso.mode.toUpperCase() === "PH" ? "PH" : "OTHER";
      return `${mode}|${section}`;
    },
    duplicatePolicy: "none",
    multiplierScope: "band",
    notes: ["Fixture-backed recovered 160/80/40/20/15/10 m point table, zero-point recognized-band behavior, and independent CW, PH, and other-mode section stores on each band."],
  },
  {
    id: "rsgb-iota-recovered",
    name: "RSGB-IOTA recovered scoring",
    description: "Recovered iota.dll behavior: entrant/target island status determines 2, 5, or 15 points; unique worked IOTA references multiply by band and CW/phone group.",
    points: (qso) => {
      const stationIota = iotaReference(qso.sentExchange);
      const workedIota = iotaReference(qso.receivedExchange);
      if (!stationIota) return workedIota ? 15 : 2;
      return workedIota && workedIota !== stationIota ? 15 : 5;
    },
    multiplier: (qso) => {
      const reference = iotaReference(qso.receivedExchange);
      if (!reference) return "";
      return `${qso.mode.toUpperCase() === "CW" ? "CW" : "PH"}|${reference}`;
    },
    duplicatePolicy: "none",
    multiplierScope: "band",
    notes: ["Fixture-backed recovered non-island/island entrant branches, same/other/non-island contacts, and separate CW versus non-CW IOTA multiplier stores per band."],
  },
  {
    id: "ww-digi-recovered",
    name: "WW-DIGI recovered scoring",
    description: "Recovered wwdigi.dll behavior: one point per started 3,000 km locator-distance interval, multiplied separately by unique four-character received squares on each band.",
    points: (qso) => recoveredWwDigiDistancePoints(qso),
    multiplier: (qso) => locatorValue(qso, "received").slice(0, 4).toUpperCase(),
    duplicatePolicy: "none",
    multiplierScope: "band",
    total: bandProductTotal,
    notes: ["Fixture-backed recovered ceil(distance)/3000 interval calculation, per-band square stores, per-band product total, and no duplicate elimination. Invalid locators score zero conservatively."],
  },
  {
    id: "ybdx-80m-recovered",
    name: "YBDX-80M recovered scoring",
    description: "Recovered yb80m.dll behavior: 50 points for Indonesian contacts, three within the operator's continent, and five across continents, multiplied by unique DXCC entities and WPX prefixes.",
    points: (_qso, { band, station, worked }) => {
      if (band !== "80M" || !station || !worked) return 0;
      if (worked.primaryPrefix === "YB") return 50;
      return worked.continent === station.continent ? 3 : 5;
    },
    multiplier: (qso, { band, worked }) => band === "80M" && worked ? `DXCC:${worked.country}; WPX:${wpxPrefix(qso.call)}` : "",
    duplicatePolicy: "none",
    multiplierCount: (rows) => dxccAndWpxMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => dxccAndWpxMultiplierCount(rows, band),
    notes: ["Fixture-backed recovered 3/5/50-point geography branches, 3.5–4.0 MHz bounds, independent DXCC/WPX multiplier stores, and no duplicate elimination. Unresolved calls score zero conservatively."],
  },
  {
    id: "avhfc-recovered",
    name: "AVHFC recovered scoring",
    description: "Recovered avhfc.dll behavior: one point on 6 m and two on 2 m, multiplied by unique received squares per band, plus whole-kilometre distance bonuses.",
    points: (_qso, { band }) => band === "6M" ? 1 : band === "2M" ? 2 : 0,
    bonusPoints: (qso, { band }) => band === "6M" || band === "2M" ? avhfcDistanceBonus(qso) : 0,
    multiplier: (qso, { band }) => band === "6M" || band === "2M" ? avhfcLocator(locatorValue(qso, "received")) : "",
    duplicatePolicy: "none",
    multiplierScope: "band",
    total: avhfcTotal,
    scoreFormula: (points, multipliers) => `Sum of per-band points × squares + distance bonuses (${points.toLocaleString()} base points, ${multipliers.toLocaleString()} band squares)`,
    notes: ["Fixture-backed recovered 6 m/2 m point branches, four-character locator expansion, six-character truncation, whole-kilometre distance bonuses, per-band squares, and no duplicate elimination."],
  },
  {
    id: "dmc-rtty-recovered",
    name: "DMC-RTTY recovered scoring",
    description: "Recovered dmc.dll behavior: one point for every recognized-band contact, multiplied by unique portable-aware WPX prefixes across the log.",
    points: (_qso, { band }) => band === "OTHER" ? 0 : 1,
    multiplier: (qso, { band }) => band === "OTHER" ? "" : wpxPrefix(qso.call),
    duplicatePolicy: "none",
    notes: ["Fixture-backed recovered recognized-band QSO count, global portable-aware WPX prefix store, and no duplicate elimination."],
  },
  {
    id: "darc-xmas-recovered",
    name: "DARC-XMAS recovered scoring",
    description: "Recovered dxmas.dll behavior: one point per recognized-band contact, multiplied by unique WPX prefixes and recovered DOK exchanges on each band.",
    points: (qso, { band }) => band !== "OTHER" && !!wpxPrefix(qso.call) ? 1 : 0,
    multiplier: (qso, { band }) => {
      if (band === "OTHER") return "";
      const prefix = wpxPrefix(qso.call);
      if (!prefix) return "";
      const dok = recoveredXmasDok(qso.receivedExchange);
      return `WPX:${prefix}${dok ? `; DOK:${dok}` : ""}`;
    },
    duplicatePolicy: "none",
    multiplierScope: "band",
    multiplierCount: (rows) => xmasMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => xmasMultiplierCount(rows, band),
    notes: ["Fixture-backed recovered per-band WPX/DOK stores, total-QSO × total-multiplier formula, and no duplicate elimination. The DLL's exact DOK test checks a three-character value, first character >= A, and only upper bounds on the remaining characters; that legacy quirk is preserved."],
  },
  {
    id: "es-open-hf-recovered",
    name: "ES-OPEN-HF recovered scoring",
    description: "Recovered esopen.dll behavior: Estonian entrants score all contacts while other entrants score only Estonian contacts; CW is worth two points and other modes one.",
    points: (qso) => {
      const operatorIsEs = isEstonianPrefix(qso.myCall);
      const workedIsEs = isEstonianPrefix(qso.call);
      if (!operatorIsEs && !workedIsEs) return 0;
      return qso.mode.toUpperCase() === "CW" ? 2 : 1;
    },
    multiplier: (qso, { band }) => {
      if (band === "OTHER" || !isEstonianPrefix(qso.call)) return "";
      return `${qso.mode.toUpperCase() === "CW" ? "CW" : "OTHER"}|${wpxPrefix(qso.call)}`;
    },
    duplicatePolicy: "none",
    multiplierScope: "band",
    notes: ["Fixture-backed recovered entrant/worked ES eligibility, CW/non-CW points, separate per-band CW/non-CW Estonian prefix stores, and no duplicate elimination."],
  },
  {
    id: "uba-psk63-prefix-recovered",
    name: "UBA-PSK63-PREFIX recovered scoring",
    description: "Recovered ubapsk.dll behavior: one point per recognized-band contact, multiplied by unique WPX prefixes and qualifying UBA exchanges on each band.",
    points: (qso, { band }) => band !== "OTHER" && !!wpxPrefix(qso.call) ? 1 : 0,
    multiplier: (qso, { band }) => {
      if (band === "OTHER") return "";
      const prefix = wpxPrefix(qso.call);
      if (!prefix) return "";
      const section = recoveredUbaSection(qso.receivedExchange);
      return `WPX:${prefix}${section ? `; UBA:${section}` : ""}`;
    },
    duplicatePolicy: "none",
    multiplierScope: "band",
    multiplierCount: (rows) => ubaPskMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => ubaPskMultiplierCount(rows, band),
    notes: ["Fixture-backed recovered QSO count, per-band portable-aware WPX and UBA exchange stores, total-QSO × total-multiplier formula, and no duplicate elimination. The DLL recognizes a UBA exchange only when it has at least three characters and begins with two uppercase ASCII letters; that exact case-sensitive test is preserved."],
  },
  {
    id: "kcj-recovered",
    name: "KCJ recovered scoring",
    description: "Recovered kcj.dll behavior: Japanese entrants score Japanese contacts at one point and other contacts at five; other entrants score only Japanese contacts at one point.",
    points: (qso, { band }) => {
      if (band === "OTHER") return 0;
      const stationIsJapanese = isKcjJapanese(qso.myCall);
      const workedIsJapanese = isKcjJapanese(qso.call);
      if (!stationIsJapanese) return workedIsJapanese ? 1 : 0;
      return workedIsJapanese ? 1 : 5;
    },
    multiplier: (qso, { band }) => {
      if (band === "OTHER") return "";
      const stationIsJapanese = isKcjJapanese(qso.myCall);
      const workedIsJapanese = isKcjJapanese(qso.call);
      const exchange = qso.receivedExchange.trim().toUpperCase();
      if (!exchange || (!stationIsJapanese && !workedIsJapanese)) return "";
      if (workedIsJapanese) return `JA:${exchange}`;
      const continent = recoveredKcjContinent(exchange);
      return stationIsJapanese && continent ? `CONT:${continent}` : "";
    },
    duplicatePolicy: "none",
    multiplierScope: "band",
    notes: ["Fixture-backed recovered Japanese-prefix table, /MM exclusion, entrant branches, per-band Japanese-exchange and continent stores, and no duplicate elimination. The legacy continent test accepts any non-empty substring of its embedded ' AF AS EU NA OC SA ' text; that quirk is preserved and exposed by the fixture."],
  },
  {
    id: "sarl-hf-recovered",
    name: "SARL-HF recovered scoring",
    description: "Recovered sarlhf.dll behavior: one phone or two CW/digital points, plus two points per new southern-African area on each band and per prefix first worked on its third band.",
    points: (qso, { band }) => band === "OTHER" || !wpxPrefix(qso.call) ? 0 : qso.mode.toUpperCase() === "PH" ? 1 : 2,
    bonusPoints: sarlHfBonus,
    multiplier: sarlHfMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    total: sarlHfTotal,
    scoreFormula: () => "QSO points + (2 × band-area multipliers) + third-band prefix bonuses",
    notes: ["Fixture-backed recovered additive calculation and embedded southern-African prefix/area table. Repeated contacts still score QSO points; a repeated WPX prefix on the same band cannot add an area, and the prefix receives its two-point 3 Band bonus only on its first contact on a third distinct band."],
  },
  {
    id: "cis-qpsk63-dx-recovered",
    name: "CIS-QPSK63-DX recovered scoring",
    description: "Recovered cis.dll behavior: three points for embedded CIS prefixes and one for other calls, multiplied by unique non-placeholder received exchanges.",
    points: (qso, { band }) => band === "OTHER" || !qso.call.trim() || isCisMobile(qso.call) ? 0 : isRecoveredCisCall(qso.call) ? 3 : 1,
    multiplier: (qso, { band }) => {
      const exchange = qso.receivedExchange.trim();
      return band === "OTHER" || isCisMobile(qso.call) || !exchange || exchange.includes("0000") ? "" : exchange;
    },
    duplicatePolicy: "none",
    notes: ["Fixture-backed recovered embedded CIS prefix fragments, R1AN/RI1AN exclusions, global received-exchange store, and no duplicate elimination. The DLL excludes only /M and /MM mobile suffixes—not /P—and performs its placeholder and multiplier comparisons case-sensitively."],
  },
  {
    id: "ca-qso-party-recovered",
    name: "CA-QSO-PARTY recovered scoring",
    description: "Recovered caparty.dll behavior: phone contacts score two points and other modes three, multiplied by counties for outside entrants or recognized states/provinces for California entrants.",
    points: (qso, { band }) => band === "OTHER" || !qso.call.trim() ? 0 : qso.mode.toUpperCase() === "PH" ? 2 : 3,
    multiplier: (qso, { band }) => caPartyMultiplier(qso, band),
    duplicatePolicy: "none",
    notes: ["Fixture-backed recovered sent-QTH-width entrant branch, embedded US/Canadian callsign and section tables, four-character California-county normalization to CA, global multiplier stores, and no duplicate elimination. The embedded legacy tables and case-sensitive comparisons are preserved, including short AG4/KG4/NG4/WG4 exclusions."],
  },
  {
    id: "ny-qso-party-recovered",
    name: "NY-QSO-PARTY recovered scoring",
    description: "Recovered nyqp.dll behavior: CW scores two points, RY three, and other modes one, multiplied by recovered county/state/province sets according to entrant location.",
    points: (qso, { band }) => {
      if (band === "OTHER" || !qso.call.trim() || !qso.receivedExchange.trim()) return 0;
      const mode = qso.mode.toUpperCase();
      return mode === "CW" ? 2 : mode === "RY" ? 3 : 1;
    },
    multiplier: (qso, { band }) => nyQpMultiplier(qso, band),
    duplicatePolicy: "none",
    multiplierCount: (rows) => tokenMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => tokenMultiplierCount(rows, band),
    notes: ["Fixture-backed recovered New York-county entrant detection, embedded county/state/province and callsign-prefix tables, global multiplier stores, and no duplicate elimination. A qualifying New York county worked by a New York entrant can introduce both its county and the NY state multiplier; DX exchanges never multiply."],
  },
  {
    id: "rac-recovered",
    name: "RAC recovered scoring",
    description: "Recovered rac.dll behavior: embedded RAC stations score 20 points, other Canadian calls 10, and other calls two, multiplied by Canadian provinces per band and CW/non-CW group.",
    points: (qso, { band }) => {
      if (band === "OTHER" || !qso.call.trim() || !qso.receivedExchange.trim()) return 0;
      const call = qso.call.trim().toUpperCase();
      return RAC_STATIONS.has(call) ? 20 : isRecoveredCanadianCall(call) ? 10 : 2;
    },
    multiplier: (qso, { band }) => {
      const province = qso.receivedExchange.trim();
      if (band === "OTHER" || !isRecoveredCanadianCall(qso.call) || !RAC_PROVINCES.has(province)) return "";
      return `${qso.mode.toUpperCase() === "CW" ? "CW" : "OTHER"}:${province}`;
    },
    duplicatePolicy: "none",
    multiplierScope: "band",
    notes: ["Fixture-backed recovered RAC-station list, embedded Canadian callsign/province tables, 20/10/2-point branches, per-band CW/non-CW province stores, and no duplicate elimination. Province comparisons retain the DLL's case sensitivity."],
  },
  {
    id: "georgia-recovered",
    name: "GEORGIA recovered scoring",
    description: "Recovered georgia.dll behavior: 80 m contacts score by Georgia/entity/continent relationship and multiply by independent Georgian-call, DXCC-entity, and WPX-prefix stores.",
    points: (qso, context) => {
      const prefix = wpxPrefix(qso.call);
      if (context.band !== "80M" || !prefix || !context.station || !context.worked) return 0;
      if (context.worked.primaryPrefix === "4L") return 10;
      if (context.worked.continent !== context.station.continent) return 4;
      return context.worked.country !== context.station.country ? 2 : 1;
    },
    multiplier: georgiaMultiplier,
    duplicatePolicy: "none",
    multiplierCount: (rows) => tokenMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => tokenMultiplierCount(rows, band),
    notes: ["Fixture-backed recovered 3500–4000 kHz eligibility; Georgian-call, DXCC-entity, and portable-aware WPX multiplier stores; operator-relative 10/4/2/1-point branches; and no duplicate elimination. Calls unresolved by the local DXCC/CTY data score zero conservatively."],
  },
  {
    id: "10m-rtty-recovered",
    name: "10M-RTTY recovered scoring",
    description: "Recovered 10rtty.dll behavior: one point per resolved 28.000–29.700 MHz contact, multiplied by unique US states, Canadian provinces, and other DXCC entities.",
    points: (_qso, context) => context.band === "10M" && context.worked ? 1 : 0,
    multiplier: tenRttyMultiplier,
    duplicatePolicy: "none",
    notes: ["Fixture-backed recovered inclusive 28000–29700 kHz gate, global state/province/DXCC stores, PEI-to-PE and NWT-to-NT legacy normalization, and no duplicate elimination. Calls unresolved by local DXCC/CTY data score zero conservatively; comparisons retain the DLL's case sensitivity."],
  },
  {
    id: "aadx-recovered",
    name: "AADX recovered scoring",
    description: "Recovered aadx.dll behavior: band-weighted contacts, tripled for Asian entrants working outside Asia, multiplied by band-scoped DXCC entities or continents according to entrant location.",
    band: aadxBand,
    points: (_qso, context) => aadxPoints(context),
    multiplier: aadxMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    notes: ["Fixture-backed recovered Asian/non-Asian entrant branches, 160 m and 80/12 m band weights, all embedded legacy VHF/microwave frequency tokens, band-scoped DXCC-or-continent stores, and no duplicate elimination. Calls unresolved by local DXCC/CTY data score zero conservatively."],
  },
  {
    id: "africa-dx-recovered",
    name: "AFRICA-DX recovered scoring",
    description: "Recovered afdx.dll behavior: African contacts score two points and others one, with African DXCC multipliers separated by band and PH/CW/other mode group.",
    band: aadxBand,
    points: (qso, context) => context.band === "OTHER" || !context.worked || !qso.receivedExchange.trim() ? 0 : context.worked.continent === "AF" ? 2 : 1,
    multiplier: afdxMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    multiplierCount: (rows) => afdxMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => afdxMultiplierCount(rows, band),
    total: afdxTotal,
    scoreFormula: () => "Sum by band of QSO points × max(1, African DXCC multipliers)",
    notes: ["Fixture-backed recovered African/non-African points, PH/CW/other mode-separated African DXCC stores per band, minimum factor one on a worked band, legacy VHF/microwave frequency tokens, and no duplicate elimination. A non-empty received exchange is required by the recovered parser but does not otherwise affect scoring."],
  },
  {
    id: "agb-party-recovered",
    name: "AGB-PARTY recovered scoring",
    description: "Recovered agbparty.dll behavior: same-continent members/non-members score five/one and cross-continent contacts three, multiplied by unique DXCC entities and received AGB numbers.",
    points: (qso, context) => {
      if (context.band !== "80M" || !context.station || !context.worked || !qso.receivedExchange.trim()) return 0;
      if (context.worked.continent !== context.station.continent) return 3;
      return agbMemberNumber(qso.receivedExchange) ? 5 : 1;
    },
    multiplier: agbMultiplier,
    duplicatePolicy: "none",
    multiplierCount: (rows) => tokenMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => tokenMultiplierCount(rows, band),
    notes: ["Fixture-backed recovered 80 m gate, operator-relative 5/1/3 points, exchange-derived AGB membership IDs, independent global DXCC and member-number stores, portable suffix exclusions from DXCC only, and no duplicate elimination. Membership matching is assistance derived from the log exchange, not an authoritative roster lookup."],
  },
  {
    id: "ari-dx-recovered",
    name: "ARI-DX recovered scoring",
    description: "Recovered ari.dll behavior: Italian and non-Italian entrant point branches with band-scoped DXCC entities and, for outside entrants, Italian provinces.",
    band: aadxBand,
    points: (qso, context) => {
      if (context.band === "OTHER" || !context.station || !context.worked || !qso.receivedExchange.trim()) return 0;
      if (isRecoveredItalianCall(context.stationCall)) return context.worked.continent === "EU" ? 1 : 3;
      if (isRecoveredItalianCall(qso.call)) return 10;
      if (context.worked.primaryPrefix === context.station.primaryPrefix) return 0;
      return context.worked.continent === context.station.continent ? 1 : 3;
    },
    multiplier: ariMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    multiplierCount: (rows) => ariMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => ariMultiplierCount(rows, band),
    notes: ["Fixture-backed recovered Italian-call detection with IG9/IH9 exclusions, entrant-relative 10/0/1/3-point branches, embedded province list, per-band province and non-Italian DXCC stores, legacy frequency tokens, and no duplicate elimination. The DLL permits a zero-point same-entity contact to introduce its DXCC multiplier; that behavior is preserved."],
  },
  {
    id: "arrl-10-recovered",
    name: "ARRL-10 recovered scoring",
    description: "Recovered arrl10.dll behavior: four CW or two other-mode points, doubled for CW novice/technician suffixes, with mode-separated state, province, Mexico, DXCC, and mobile multipliers.",
    points: (qso, context) => {
      if (context.band !== "10M" || !context.worked || !qso.receivedExchange.trim()) return 0;
      const cw = qso.mode.trim().toUpperCase() === "CW";
      return cw && /(?:[\\/]N|[\\/]T)$/i.test(qso.call.trim()) ? 8 : cw ? 4 : 2;
    },
    multiplier: arrl10Multiplier,
    duplicatePolicy: "none",
    notes: ["Fixture-backed recovered inclusive 28000–29700 kHz gate, 4/2 points and CW /N or /T doubling, separate CW/non-CW stores for US states, Canadian provinces, Mexican calls, other DXCC entities, and mobile received exchanges, plus no duplicate elimination. PEI/NWT are normalized to the embedded legacy PE/NT values."],
  },
  {
    id: "arrl-160-recovered",
    name: "ARRL-160 recovered scoring",
    description: "Recovered arrl160.dll behavior: U.S./Canadian entrants score section contacts two and DX five, while outside entrants score only U.S./Canadian contacts, multiplied by global sections and DXCC entities.",
    points: (qso, context) => {
      if (context.band !== "160M" || !context.worked || !qso.receivedExchange.trim()) return 0;
      const stationRegion = arrl160Region(context.stationCall);
      const workedRegion = arrl160Region(qso.call);
      if (stationRegion === "DX") return workedRegion === "DX" ? 0 : 2;
      return workedRegion === "DX" ? 5 : 2;
    },
    multiplier: arrl160Multiplier,
    duplicatePolicy: "none",
    notes: ["Fixture-backed recovered inclusive 1800–2000 kHz gate, U.S./Canadian/outside entrant branches, embedded ARRL/RAC section validation, global section and DXCC stores, NWT-to-NT normalization, and no duplicate elimination. Invalid received sections retain QSO points but do not multiply."],
  },
  {
    id: "arrl-dx-recovered",
    name: "ARRL-DX recovered scoring",
    description: "Recovered arrldx.dll behavior: W/VE entrants score outside entities and outside entrants score W/VE contacts, with three points per accepted QSO and band-scoped multipliers.",
    band: aadxBand,
    points: (qso, context) => {
      if (context.band === "OTHER" || !context.worked || !qso.receivedExchange.trim()) return 0;
      const stationDomestic = arrlDxRegion(context.stationCall) !== "DX";
      const workedDomestic = arrlDxRegion(qso.call) !== "DX";
      return stationDomestic === workedDomestic ? 0 : 3;
    },
    multiplier: arrlDxMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    notes: ["Fixture-backed recovered reciprocal W/VE-versus-DX eligibility, three-point contacts, per-band DXCC or received state/province stores, repeat-contact behavior, KG4 handling, and the DLL's complete legacy HF/VHF/microwave band decoder. Received state/province values are retained verbatim because the recovered module does not validate them."],
  },
  {
    id: "arrl-rtty-recovered",
    name: "ARRL-RTTY recovered scoring",
    description: "Recovered arrlrtty.dll behavior: one point per resolved contact, multiplied by global DXCC entities and validated W/VE states or provinces.",
    band: aadxBand,
    points: (qso, context) => context.band === "OTHER" || !context.worked || !qso.receivedExchange.trim() ? 0 : 1,
    multiplier: arrlRttyMultiplier,
    duplicatePolicy: "none",
    notes: ["Fixture-backed recovered one-point contacts, global DXCC and combined U.S./Canadian area stores, embedded legacy state/province validation including PEI/NWT aliases, KG4 handling, complete legacy HF/VHF/microwave band decoding, and no duplicate elimination. Alias values are intentionally not normalized because the DLL stores the received spelling verbatim."],
  },
  {
    id: "bartg-rtty-recovered",
    name: "BARTG-RTTY recovered scoring",
    description: "Recovered bartg.dll behavior: one point per contact, multiplied by band-scoped DXCC entities and JA/VE/W/VK call areas, then by global continents.",
    band: aadxBand,
    points: (qso, context) => context.band === "OTHER" || !context.worked || !qso.receivedExchange.trim() ? 0 : 1,
    multiplier: bartgMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    multiplierCount: (rows) => bartgMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => bartgMultiplierCount(rows, band),
    total: bartgTotal,
    scoreFormula: () => "QSOs × (band-scoped DXCC + JA/VE/W/VK call areas) × continents",
    notes: ["Fixture-backed recovered one-point contacts, band-scoped DXCC and JA/VE/W/VK call-area stores, global continent factor, KG4 and Antarctic remapping inherited from local DXCC resolution, complete legacy HF/VHF/microwave band decoding, and no duplicate elimination."],
  },
  {
    id: "bartg-sprint-recovered",
    name: "BARTG-SPRINT recovered scoring",
    description: "Recovered bartgspt.dll behavior: one point per contact, multiplied by global DXCC entities and JA/VE/W/VK call areas, then by global continents.",
    band: aadxBand,
    points: (qso, context) => context.band === "OTHER" || !context.worked || !qso.receivedExchange.trim() ? 0 : 1,
    multiplier: bartgSprintMultiplier,
    duplicatePolicy: "none",
    multiplierCount: (rows) => bartgSprintMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => bartgSprintMultiplierCount(rows, band),
    total: bartgSprintTotal,
    scoreFormula: () => "QSOs × global (DXCC + JA/VE/W/VK call areas) × global continents",
    notes: ["Fixture-backed recovered one-point contacts, globally unique DXCC, JA/VE/W/VK call-area, and continent stores with first-band attribution, complete legacy HF/VHF/microwave band decoding, and no duplicate elimination. Unlike the full BARTG module, Sprint does not reset DXCC or area multipliers by band."],
  },
  {
    id: "cq-m-recovered",
    name: "CQ-M recovered scoring",
    description: "Recovered cqm.dll behavior: same-entity, same-continent, and cross-continent contacts score one, two, or three points, with Russian regional handling and countries per band.",
    band: aadxBand,
    points: cqmPoints,
    multiplier: cqmMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    notes: ["Fixture-backed recovered 1/2/3 geography points, three-point maritime-mobile contacts excluded from multipliers, Russian broad-region point comparisons, detailed R1N/R4/R6/R9/R0 multiplier identities, per-band country stores, complete legacy HF/VHF/microwave decoding, and no duplicate elimination. The embedded historical Russian mapping is retained as recovered rather than replaced with current administrative regions."],
  },
  {
    id: "cqsa-recovered",
    name: "CQSA recovered scoring",
    description: "Recovered cqsa.dll behavior: one/two/three-point geography contacts or ten points for outside entrants working South America, multiplied by continents and South American DXCC entities per band.",
    band: aadxBand,
    points: cqsaPoints,
    multiplier: cqsaMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    multiplierCount: (rows) => ariMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => ariMultiplierCount(rows, band),
    notes: ["Fixture-backed recovered South-American/outside entrant branches, 1/2/3/10-point geography values, three-point /M and /MM contacts excluded from multipliers, per-band continent and South-American DXCC stores, complete legacy HF/VHF/microwave decoding, and no duplicate elimination."],
  },
  {
    id: "cq-wpx-rtty-recovered",
    name: "CQ-WPX-RTTY recovered scoring",
    description: "Recovered cqwpxrtty.dll behavior: RTTY-specific same-entity, same-continent, and cross-continent points multiplied by globally unique WPX prefixes.",
    band: aadxBand,
    points: cqWpxRttyPoints,
    multiplier: cqWpxRttyMultiplier,
    duplicatePolicy: "none",
    multiplierCount: (rows) => rows.reduce((count, row) => count + (row.points > 0 && row.multiplier ? 1 : 0), 0),
    bandMultiplierCount: (rows, band) => rows.reduce((count, row) => count + (row.band === band && row.points > 0 && row.multiplier ? 1 : 0), 0),
    notes: ["Fixture-backed recovered 80/40 m 2/4/6-point and 20/15/10 m 1/2/3-point branches, same-continent /MM handling, globally unique portable-aware WPX prefixes with first-band attribution, and no duplicate elimination. Frequencies outside the five recovered contest bands do not score or multiply."],
  },
  {
    id: "cq-ww-recovered",
    name: "CQ-WW recovered scoring",
    description: "Recovered cqww.dll behavior: same-entity contacts score zero, same-continent contacts one or two, and cross-continent contacts three, multiplied by CQ zones and DXCC entities per band.",
    band: aadxBand,
    points: cqWwPoints,
    multiplier: cqWwMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    multiplierCount: (rows) => cqWwMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => cqWwMultiplierCount(rows, band),
    notes: ["Fixture-backed recovered zero-point same-entity, one-point same-continent, two-point North-American same-continent, and three-point cross-continent branches; CQ-zone and DXCC stores per band; /MM, /P, /A, and /M multiplier exclusions; complete legacy HF/VHF/microwave decoding; and no duplicate elimination. Same-entity contacts can still introduce both multipliers, matching the DLL."],
  },
  {
    id: "cq-160-recovered",
    name: "CQ-160 recovered scoring",
    description: "Recovered cqww160.dll behavior: same-entity, same-continent, and cross-continent contacts score two, five, or ten points, multiplied by DXCC entities and eligible U.S./Canadian exchanges.",
    band: cq160Band,
    points: cq160Points,
    multiplier: cq160Multiplier,
    duplicatePolicy: "none",
    multiplierCount: (rows) => cqWwMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => cqWwMultiplierCount(rows, band),
    notes: ["Fixture-backed recovered inclusive 1800–2100 kHz gate; 2/5/10-point geography branches; five-point /MM and /A contacts excluded from multipliers; embedded U.S. state and Canadian province validation; independent DXCC and state/province stores; and no duplicate elimination. The recovered DLL counts W and VE entities as DXCC multipliers in addition to a valid state or province."],
  },
  {
    id: "cq-ww-rtty-recovered",
    name: "CQ-WW-RTTY recovered scoring",
    description: "Recovered cqwwrtty.dll behavior: same-entity, same-continent, and cross-continent contacts score one, two, or three points, multiplied by zones, DXCC entities, and eligible U.S./Canadian areas per band.",
    band: aadxBand,
    points: cqWwRttyPoints,
    multiplier: cqWwRttyMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    multiplierCount: (rows) => cqWwMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => cqWwMultiplierCount(rows, band),
    notes: ["Fixture-backed recovered 1/2/3-point entity/continent branches; numeric zones up to 40; independent per-band zone, DXCC, and validated U.S./Canadian area stores; PEI legacy spelling; complete legacy band decoding; portable-suffix participation; and no duplicate elimination."],
  },
  {
    id: "arr-psk63-recovered",
    name: "ARR-PSK63 recovered scoring",
    description: "Recovered ctarr.dll behavior: Portuguese contacts score five points, three embedded event stations ten, and other resolved contacts one, multiplied by per-band DXCC entities plus every Portuguese contact.",
    band: aadxBand,
    points: (qso, context) => {
      if (context.band === "OTHER" || !context.worked) return 0;
      if (ARR_PSK_SPECIAL_CALLS.has(qso.call.trim().toUpperCase())) return 10;
      return ARR_PSK_PORTUGUESE.has(arrPskEntity(context.worked)) ? 5 : 1;
    },
    multiplier: (qso, context) => {
      const entity = arrPskEntity(context.worked);
      if (context.band === "OTHER" || !entity) return "";
      return `DXCC:${entity}${ARR_PSK_PORTUGUESE.has(entity) ? `; CT:${qso.call.trim().toUpperCase()}` : ""}`;
    },
    duplicatePolicy: "none",
    multiplierScope: "band",
    multiplierCount: (rows) => arrPskMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => arrPskMultiplierCount(rows, band),
    notes: ["Fixture-backed recovered 1/5/10-point branches, embedded event calls, per-band DXCC stores, one additional multiplier for every Portuguese contact, IT9/IG9-to-I and YU8-to-YU normalization, complete legacy band decoding, and no duplicate elimination."],
  },
  {
    id: "cwjf-mm-recovered",
    name: "CWJF-MM recovered scoring",
    description: "Recovered cwjf.dll behavior: band/geography points, maritime-mobile and exchange bonuses, per-band South-American prefixes, and globally unique DXCC entities.",
    band: aadxBand,
    points: cwjfPoints,
    multiplier: cwjfMultiplier,
    duplicatePolicy: "none",
    multiplierCount: (rows) => cqWwMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => cqWwMultiplierCount(rows, band),
    notes: ["Fixture-backed recovered 80/40 m 1/4/6 and 20/15/10 m 1/2/3 geography branches; three-point /MM contacts; ten-point three-character exchanges ending C, Y, M, or Q; per-band South-American WPX prefixes; global DXCC entities with first-band attribution; complete legacy band decoding; and no duplicate elimination."],
  },
  {
    id: "dig-qso-party-recovered",
    name: "DIG-QSO-PARTY recovered scoring",
    description: "Recovered digdl.dll behavior: DIG-member contacts score ten points and other resolved contacts one, multiplied by DXCC entities per band and globally unique DIG numbers.",
    band: aadxBand,
    points: (qso, context) => context.band === "OTHER" || !context.worked ? 0 : digQsoMember(qso.receivedExchange) !== 0 ? 10 : 1,
    multiplier: digQsoMultiplier,
    duplicatePolicy: "none",
    multiplierCount: (rows) => cqWwMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => cqWwMultiplierCount(rows, band),
    notes: ["Fixture-backed recovered one/ten-point DIG exchange branches, per-band DXCC stores, global numeric DIG-member stores with first-band attribution, complete legacy band decoding, and no duplicate elimination. Membership is inferred from the received numeric exchange and is not an authoritative roster lookup."],
  },
  {
    id: "dl-dx-rtty-recovered",
    name: "DL-DX-RTTY recovered scoring",
    description: "Recovered dlrtty.dll behavior: country/continent points plus a German-contact bonus, multiplied by per-band DXCC entities and JA/VE/W/VK call areas.",
    band: aadxBand,
    points: dlRttyPoints,
    multiplier: dlRttyMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    multiplierCount: (rows) => dlRttyMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => dlRttyMultiplierCount(rows, band),
    notes: ["Fixture-backed recovered 5/10/15-point entity/continent branches; three/five-point Germany bonus; per-band DXCC and JA/VE/W/VK call-area stores; complete legacy band decoding; and no duplicate elimination. Calls unresolved by local DXCC/CTY data score zero conservatively."],
  },
  {
    id: "drcg-ww-rtty-recovered",
    name: "DRCG-WW-RTTY recovered scoring",
    description: "Recovered drcgww.dll behavior: a 40×40 sent/received CQ-zone point table with 20 m and 80 m factors, multiplied by per-band DXCC entities or call areas.",
    band: aadxBand,
    points: drcgWwPoints,
    multiplier: drcgWwMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    multiplierCount: (rows) => dlRttyMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => dlRttyMultiplierCount(rows, band),
    notes: ["Fixture-backed against recovered matrix cells, 20 m doubling, 80 m tripling, per-band non-JA/VE/W/VK DXCC stores, mutually exclusive JA/VE/W/VK call-area stores, complete legacy band decoding, and no duplicate elimination. Zones outside 1–40 and calls unresolved by local DXCC/CTY data score zero conservatively."],
  },
  {
    id: "ea-rtty-recovered",
    name: "EA-RTTY recovered scoring",
    description: "Recovered ea.dll behavior: entrant-relative Spanish/DX points multiplied by per-band entities, Spanish call prefixes, JA/VE/W/VK areas, and the EA4URE bonus.",
    band: aadxBand,
    points: (qso, context) => {
      if (!eaContestEligible(qso, context)) return 0;
      const entrantIsEa = isEaContestCall(context.stationCall);
      const workedIsEa = isEaContestCall(qso.call);
      return workedIsEa ? (entrantIsEa ? 2 : 3) : 1;
    },
    multiplier: eaContestMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    multiplierCount: (rows) => dlRttyMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => dlRttyMultiplierCount(rows, band),
    notes: ["Fixture-backed recovered EA-entrant 2/1 and outside-entrant 3/1 point branches; embedded province validation for Spanish contacts; per-band entity, Spanish callsign-prefix, and JA/VE/W/VK area stores; EA4URE per-band bonus; full legacy band decoding; and no duplicate elimination. Invalid Spanish exchanges and calls unresolved by local DXCC/CTY data score zero conservatively."],
  },
  {
    id: "polska-ww-bpsk63-recovered",
    name: "POLSKA-WW-BPSK63 recovered scoring",
    description: "Recovered epcsp.dll behavior: entity/continent points multiplied by per-band DXCC entities and Polish callsign prefixes.",
    band: aadxBand,
    points: (_qso, context) => {
      if (context.band === "OTHER" || !context.station || !context.worked) return 0;
      if (context.station.primaryPrefix === context.worked.primaryPrefix) return 1;
      return context.station.continent === context.worked.continent ? 2 : 3;
    },
    multiplier: epcSpMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    multiplierCount: (rows) => dlRttyMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => dlRttyMultiplierCount(rows, band),
    notes: ["Fixture-backed recovered one/two/three-point entity/continent branches; per-band DXCC and Polish-prefix stores; /M and /MM multiplier exclusion while retaining QSO points; complete legacy band decoding; and no duplicate elimination. Calls unresolved by local DXCC/CTY data score zero conservatively."],
  },
  {
    id: "epc-ukr-dx-recovered",
    name: "EPC-UKR-DX recovered scoring",
    description: "Recovered epcukr.dll behavior: Ukraine-sensitive geography and mobile points multiplied by per-band DXCC entities and Ukrainian oblast exchanges.",
    band: aadxBand,
    points: epcUkrPoints,
    multiplier: epcUkrMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    multiplierCount: (rows) => dlRttyMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => dlRttyMultiplierCount(rows, band),
    notes: ["Fixture-backed recovered ten-point outside-Ukraine-to-Ukraine branch; one/two/five-point entity/continent branches; three-point same-entity mobile branch; per-band DXCC and exchange-derived Ukrainian oblast stores; /M and /MM multiplier exclusion; complete legacy band decoding; and no duplicate elimination. Calls unresolved by local DXCC/CTY data score zero conservatively."],
  },
  {
    id: "epc-ww-dx-recovered",
    name: "EPC-WW-DX recovered scoring",
    description: "Recovered epcww.dll behavior: band-specific entity/continent points multiplied by per-band DXCC entities.",
    band: aadxBand,
    points: epcWwPoints,
    multiplier: (qso, context) => context.band === "OTHER" || !context.worked || qso.call.trim().toUpperCase().includes("/MM") ? "" : `DXCC:${context.worked.primaryPrefix}`,
    duplicatePolicy: "none",
    multiplierScope: "band",
    notes: ["Fixture-backed recovered same-entity one-point branch; same-continent 2/3-point and cross-continent 4/5/6-point band branches; three-point /MM override with multiplier exclusion; per-band DXCC stores; complete legacy band decoding; and no duplicate elimination. Unsupported contest bands and calls unresolved by local DXCC/CTY data score zero conservatively."],
  },
  {
    id: "eudxc-recovered",
    name: "EUDXC recovered scoring",
    description: "Recovered eudxc.dll behavior: WAE-sensitive entity/continent points multiplied by per-band received regions and callsign areas.",
    band: aadxBand,
    points: (_qso, context) => {
      if (context.band === "OTHER" || !context.station || !context.worked) return 0;
      if (context.station.primaryPrefix === context.worked.primaryPrefix) return 2;
      if (EUDXC_WAE_ENTITIES.has(context.worked.primaryPrefix)) return 10;
      return context.station.continent === context.worked.continent ? 3 : 5;
    },
    multiplier: eudxcMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    multiplierCount: (rows) => dlRttyMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => dlRttyMultiplierCount(rows, band),
    notes: ["Fixture-backed recovered two-point same-entity, ten-point WAE-entity, and three/five-point non-WAE geography branches; embedded WAE entity list; per-band received-region and derived callsign-area stores; full legacy band decoding; and no duplicate elimination. Calls unresolved by local DXCC/CTY data score zero conservatively."],
  },
  {
    id: "eu-psk-dx-recovered",
    name: "EU-PSK-DX recovered scoring",
    description: "Recovered eupsk.dll behavior: exchange-aware European geography points multiplied by per-band DXCC entities and received EU areas.",
    band: aadxBand,
    points: euPskPoints,
    multiplier: euPskMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    multiplierCount: (rows) => dlRttyMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => dlRttyMultiplierCount(rows, band),
    notes: ["Fixture-backed recovered alphabetic sent/received exchange EU overrides; one/two/three/five-point entity and continent branches; three-point same-entity /MM override; per-band normalized DXCC and received EU-area stores; YU8-to-YU and IG9/IT9-to-I normalization; full legacy band decoding; and no duplicate elimination. Calls unresolved by local DXCC/CTY data score zero conservatively."],
  },
  {
    id: "ft8-dx-recovered",
    name: "FT8-DX recovered scoring",
    description: "Recovered ft8dx.dll behavior: one point per resolved contact multiplied by global U.S. states, Canadian provinces, and other DXCC entities.",
    band: aadxBand,
    points: (_qso, context) => context.band === "OTHER" || !context.worked ? 0 : 1,
    multiplier: ft8DxMultiplier,
    duplicatePolicy: "none",
    multiplierCount: (rows) => tokenMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => tokenMultiplierCount(rows, band),
    notes: ["Fixture-backed recovered one-point contacts; global U.S.-state, Canadian-province, and other-DXCC stores with first-band attribution; PEI-to-PE and NWT-to-NT normalization; embedded state/province validation; complete legacy band decoding; and no duplicate elimination. W/VE contacts with invalid exchanges retain points without a multiplier; unresolved calls score zero conservatively."],
  },
  {
    id: "gacw-recovered",
    name: "GACW WWSA recovered scoring",
    description: "Recovered gacw.dll behavior: entity/continent-relative points multiplied by CQ zones and DXCC entities per band.",
    band: aadxBand,
    points: gacwPoints,
    multiplier: gacwMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    multiplierCount: (rows) => cqWwMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => cqWwMultiplierCount(rows, band),
    notes: ["Fixture-backed recovered zero-point same-entity, one-point same-continent, three-point cross-continent, and five-point worked-South-America branches; per-band received-CQ-zone and primary-DXCC stores; /M and /MM multiplier exclusions; complete legacy band decoding; and no duplicate elimination. Unresolved calls score zero conservatively."],
  },
  {
    id: "ha-dx-recovered",
    name: "HA-DX recovered scoring",
    description: "Recovered hadx.dll behavior: Hungarian and non-Hungarian entrant point branches multiplied by per-band counties or DXCC entities.",
    band: aadxBand,
    points: haDxPoints,
    multiplier: haDxMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    minimumMultipliers: 1,
    multiplierCount: (rows) => haDxMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => haDxMultiplierCount(rows, band),
    notes: ["Fixture-backed recovered Hungarian-entrant 1/3/5-point and outside-entrant 1/3/6-point branches; per-band DXCC multipliers for Hungarian entrants and received-county multipliers for outside entrants working HA/HG calls; minimum multiplier of one; complete legacy band decoding; and no duplicate elimination. The DLL's embedded county text is not consulted during ProcessLine, so non-empty received county values are preserved rather than restricted to a modern list."],
  },
  {
    id: "helvetia-recovered",
    name: "HELVETIA recovered scoring",
    description: "Recovered helvetia.dll behavior: Swiss canton contacts and geography-relative DX contacts multiplied by cantons and DXCC entities per band.",
    band: aadxBand,
    points: helvetiaPoints,
    multiplier: helvetiaMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    multiplierCount: (rows) => cqWwMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => cqWwMultiplierCount(rows, band),
    notes: ["Fixture-backed recovered ten-point Swiss, one-point same-continent, and three-point cross-continent branches; embedded 26-canton validation; HB0/HE0 exclusions from Swiss-call handling; independent canton and DXCC stores per band; complete legacy band decoding; and no duplicate elimination. Swiss calls with invalid canton exchanges score zero and do not multiply."],
  },
  {
    id: "holyland-recovered",
    name: "HOLYLAND recovered scoring",
    description: "Recovered holyland.dll behavior: Israeli and outside entrant geography points multiplied by Israeli areas and DXCC entities per band.",
    band: aadxBand,
    points: holylandPoints,
    multiplier: holylandMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    multiplierCount: (rows) => cqWwMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => cqWwMultiplierCount(rows, band),
    notes: ["Fixture-backed recovered outside-entrant 1/2/4/8-point and Israeli-entrant 1/2/8-point branches; four-point maritime-mobile override; 4X/4Z/J1 entrant recognition; per-band Israeli-area and DXCC stores; complete legacy band decoding; and no duplicate elimination. As in ProcessLine, non-empty received Israeli area values are accepted without a separate embedded-area validator."],
  },
  {
    id: "iaru-hf-recovered",
    name: "IARU-HF recovered scoring",
    description: "Recovered iaruhf.dll behavior: ITU-zone geography and HQ contacts multiplied by ITU zones and HQ abbreviations per band.",
    band: aadxBand,
    points: iaruHfPoints,
    multiplier: iaruHfMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    multiplierCount: (rows) => cqWwMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => cqWwMultiplierCount(rows, band),
    notes: ["Fixture-backed recovered one-point same-ITU-zone, three-point same-continent/different-zone, five-point cross-continent/different-zone, and one-point alphabetic HQ branches; independent received-ITU and HQ stores per band; complete legacy band decoding; and no duplicate elimination. Malformed or empty received exchanges score zero conservatively."],
  },
  {
    id: "jarts-ww-rtty-recovered",
    name: "JARTS-WW-RTTY recovered scoring",
    description: "Recovered jartsrtty.dll behavior: same/cross-continent points multiplied by mutually exclusive DXCC entities or JA/VE/W/VK call areas per band.",
    band: aadxBand,
    points: jartsRttyPoints,
    multiplier: jartsRttyMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    multiplierCount: (rows) => cqWwMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => cqWwMultiplierCount(rows, band),
    notes: ["Fixture-backed recovered two-point same-continent and three-point cross-continent branches; mutually exclusive per-band DXCC or JA/VE/W/VK callsign-area stores; complete legacy band decoding; and no duplicate elimination. Calls unresolved by local DXCC/CTY data score zero conservatively."],
  },
  {
    id: "jidx-recovered",
    name: "JIDX recovered scoring",
    description: "Recovered jidx.dll behavior: reciprocal Japan/DX band points multiplied by prefectures or CQ zones plus DXCC entities per band.",
    band: aadxBand,
    points: jidxPoints,
    multiplier: jidxMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    multiplierCount: (rows) => cqWwMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => cqWwMultiplierCount(rows, band),
    notes: ["Fixture-backed reciprocal Japanese-versus-DX eligibility; recovered four-point 160 m, two-point 80/10 m, and one-point 40/20/15 m table; outside-entrant prefectures or Japanese-entrant CQ zones plus DXCC entities per band; /MM multiplier exclusion; complete legacy band decoding; and no duplicate elimination. ProcessLine accepts non-empty prefecture and CQ-zone exchanges without separate range validation, so this port preserves that behavior."],
  },
  {
    id: "jt-dx-recovered",
    name: "JT-DX recovered scoring",
    description: "Recovered jtdx.dll behavior: entity/continent points multiplied by DXCC entities or individual Mongolian calls per band.",
    band: aadxBand,
    points: jtDxPoints,
    multiplier: jtDxMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    notes: ["Fixture-backed recovered one-point same-entity, two-point same-continent, and three-point cross-continent branches; per-band DXCC entities for ordinary calls; per-band individual JT/JU/JV calls for Mongolian contacts; Mongolian-to-Mongolian exclusion; complete legacy band decoding; and no duplicate elimination. Calls unresolved by local DXCC/CTY data score zero conservatively."],
  },
  {
    id: "lz-dx-recovered",
    name: "LZ-DX recovered scoring",
    description: "Recovered lzdx.dll behavior: Bulgarian/outside entrant points multiplied by per-band ITU zones, districts, or DXCC entities.",
    band: aadxBand,
    points: lzDxPoints,
    multiplier: lzDxMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    multiplierCount: (rows) => cqWwMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => cqWwMultiplierCount(rows, band),
    notes: ["Fixture-backed outside-entrant ten-point Bulgarian contacts and otherwise one/three-point same/cross-continent branches; embedded 28-district table; outside-entrant district-or-ITU stores; Bulgarian-entrant DXCC plus non-Bulgarian ITU stores; complete legacy band decoding; and no duplicate elimination. Received ITU values are retained without separate range validation because ProcessLine does not validate them."],
  },
  {
    id: "marconi-memorial-recovered",
    name: "MARCONI-MEMORIAL recovered scoring",
    description: "Recovered mmchf.dll behavior: one point per resolved contact multiplied by unique non-mobile DXCC entities on each band.",
    band: aadxBand,
    points: (_qso, { band, worked }) => band !== "OTHER" && worked ? 1 : 0,
    multiplier: marconiMemorialMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    notes: ["Fixture-backed one-point contacts, per-band primary-DXCC stores, /M and /MM multiplier exclusions, complete legacy band decoding, and no duplicate elimination. Mobile contacts retain their QSO point, matching ProcessLine."],
  },
  {
    id: "naqp-recovered",
    name: "NAQP recovered scoring",
    description: "Recovered naqp.dll behavior: one-point contacts multiplied by North American states, provinces, and received country/QTH tokens per band.",
    band: aadxBand,
    points: (_qso, { band, worked }) => band !== "OTHER" && worked ? 1 : 0,
    multiplier: naqpMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    notes: ["Fixture-backed one-point resolved contacts; embedded U.S. state and Canadian province tables; per-band received-QTH multipliers for other North American entities; the recovered MD-to-DC normalization; complete legacy band decoding; and no duplicate elimination. Outside-North-America contacts retain their QSO point but do not multiply."],
  },
  {
    id: "oceania-dx-recovered",
    name: "OCEANIA-DX recovered scoring",
    description: "Recovered oceania.dll behavior: Oceania-eligible band-weighted contacts multiplied by unique callsign prefixes on each band.",
    band: aadxBand,
    points: (_qso, context) => oceaniaDxEligible(context) ? (OCEANIA_DX_POINTS[context.band] ?? 0) : 0,
    multiplier: (qso, context) => oceaniaDxEligible(context) && OCEANIA_DX_POINTS[context.band] ? wpxPrefix(qso.call) : "",
    duplicatePolicy: "none",
    multiplierScope: "band",
    notes: ["Fixture-backed entrant-or-worked Oceania eligibility; recovered 20/10/5/1/2/3 point table for 160/80/40/20/15/10 metres; portable-aware per-band prefixes; complete legacy band decoding; and no duplicate elimination. Calls unresolved by local DXCC/CTY data score zero conservatively."],
  },
  {
    id: "ok-om-dx-recovered",
    name: "OK-OM-DX recovered scoring",
    description: "Recovered okom.dll behavior: reciprocal OK/OM-versus-DX geography points multiplied by districts or callsign prefixes per band.",
    band: aadxBand,
    points: (_qso, context) => !okomEligible(context) ? 0 : (context.station!.continent === context.worked!.continent ? 1 : 3),
    multiplier: okomMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    notes: ["Fixture-backed reciprocal OK/OL/OM-versus-DX eligibility, one/three-point same/cross-continent branches, outside-entrant received districts, domestic-entrant portable-aware prefixes, complete legacy band decoding, and no duplicate elimination. Received district text is retained without separate validation because ProcessLine accepts any non-empty value."],
  },
  {
    id: "okom-dx-ssb-recovered",
    name: "OKOM-DX-SSB recovered scoring",
    description: "Recovered okomssb.dll behavior: same/different-entity and maritime-mobile points multiplied by OK/OM districts or DXCC entities per band.",
    band: aadxBand,
    points: okomSsbPoints,
    multiplier: okomSsbMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    notes: ["Fixture-backed outside-entrant one/three-point and OK/OM-entrant two/three-point same/different-primary-DXCC branches; five-point /MM contacts with no multiplier; per-band OK/OM received districts and other DXCC entities; complete legacy band decoding; and no duplicate elimination. ProcessLine compares continent and, for outside entrants, OK/OM identity in two discarded expressions; this port preserves the effective same/different-DXCC result rather than assigning meaning to those dead comparisons."],
  },
  {
    id: "ok-dx-rtty-recovered",
    name: "OK-DX-RTTY recovered scoring",
    description: "Recovered okrtty.dll behavior: band-weighted same/cross-continent points multiplied by per-band DXCC entities and, for outside entrants, individual OK callsigns.",
    band: aadxBand,
    points: okRttyPoints,
    multiplier: okRttyMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    multiplierCount: (rows) => okRttyMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => okRttyMultiplierCount(rows, band),
    notes: ["Fixture-backed same/cross-continent points with recovered one/two-point factors on 10/15/20 metres and three/six-point factors on 40/80 metres; per-band primary-DXCC stores; additional exact OK-callsign stores for non-OK/OL entrants; complete legacy band decoding; and no duplicate elimination. ProcessLine still records multipliers on recognized zero-point bands, so that unusual legacy behavior is deliberately retained."],
  },
  {
    id: "pacc-recovered",
    name: "PACC recovered scoring",
    description: "Recovered pacc.dll behavior: reciprocal Netherlands contacts multiplied by provinces for DX entrants or mode-specific DXCC/callsign areas for Dutch entrants.",
    band: aadxBand,
    points: paccPoints,
    multiplier: paccMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    notes: ["Fixture-backed reciprocal one-point Netherlands eligibility; embedded 12-province table for outside entrants; separate CW/non-CW multiplier stores; Dutch-entrant per-band DXCC entities or recovered W/VE/VO/VY/JA/CE/LU/PY/VK/ZS/ZL/RA callsign areas; complete legacy band decoding; and no duplicate elimination. Any mode other than exact CW uses the DLL's second multiplier store."],
  },
  {
    id: "portugal-day-recovered",
    name: "PORTUGAL-DAY recovered scoring",
    description: "Recovered pdc.dll behavior: entity/continent points multiplied by per-band DXCC entities and five-count Portuguese districts.",
    band: aadxBand,
    points: portugalDayPoints,
    multiplier: portugalDayMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    multiplierCount: (rows) => portugalDayMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => portugalDayMultiplierCount(rows, band),
    notes: ["Fixture-backed one/two-point same/cross-continent contacts; five-point domestic and ten-point outside contacts with CT, CT3, or CU; per-band DXCC entities; Portuguese received districts worth five multipliers each; complete legacy band decoding; and no duplicate elimination. Received district text is retained without a separate validation table because ProcessLine accepts it directly."],
  },
  {
    id: "radio-160-recovered",
    name: "RADIO-160 recovered scoring",
    description: "Recovered radio160.dll behavior: Russian-sensitive 160-metre geography points multiplied by global DXCC entities and received oblasts.",
    band: radio160Band,
    points: radio160Points,
    multiplier: radio160Multiplier,
    duplicatePolicy: "none",
    multiplierScope: "global",
    multiplierCount: (rows) => cqWwMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => cqWwMultiplierCount(rows, band),
    notes: ["Fixture-backed exact 1800–2000 kHz eligibility; recovered domestic-Russian and outside-entrant entity/continent point branches; /MM five-point and multiplier exclusions; global primary-DXCC and Russian-oblast stores; and no duplicate elimination. The DLL maps worked RA2 to RA1 only during the domestic same-entity comparison, and that asymmetric effective behavior is preserved."],
  },
  {
    id: "radio-ww-rtty-recovered",
    name: "RADIO-WW-RTTY recovered scoring",
    description: "Recovered radiotty.dll behavior: same/cross-continent points multiplied by per-band DXCC entities or received Russian oblasts.",
    band: aadxBand,
    points: (_qso, context) => context.band === "OTHER" || !context.station || !context.worked ? 0 : (context.station.continent === context.worked.continent ? 5 : 10),
    multiplier: radioWwRttyMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    notes: ["Fixture-backed five/ten-point same/cross-continent branches; mutually exclusive per-band primary-DXCC or RA1/RA2/RA0/R1F/R1M received-oblast stores; complete legacy band decoding; and no duplicate elimination. The received exchange is required by GetRequired; unlike the DLL's malformed-line fallback, this port does not infer a missing oblast from a callsign-area table."],
  },
  {
    id: "rcc-cup-recovered",
    name: "RCC-CUP recovered scoring",
    description: "Recovered rcc.dll behavior: RCC-member or geography points multiplied by per-band member callsigns or normalized ITU zones.",
    band: aadxBand,
    points: rccPoints,
    multiplier: rccMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    notes: ["Fixture-backed ten-point exchanges containing RCC; otherwise three/five-point same/cross-continent contacts; mutually exclusive per-band exact member-callsign or integer-normalized received-ITU stores; complete legacy band decoding; and no duplicate elimination. The DLL identifies membership by substring rather than validating a membership number, and that behavior is preserved."],
  },
  {
    id: "rdac-recovered",
    name: "RDAC recovered scoring",
    description: "Recovered rdac.dll behavior: reciprocal Russian/DX points multiplied by global RDA values and, for Russian entrants, per-band DXCC entities.",
    band: aadxBand,
    points: rdacPoints,
    multiplier: rdacMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "global",
    multiplierCount: (rows) => rdacMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => rdacMultiplierCount(rows, band),
    notes: ["Fixture-backed outside-entrant ten-point Russian contacts with valid RDA; Russian-entrant one/two-point Russian same/cross-continent, ten-point /MM, and three/five-point other same/cross-continent branches; globally unique RDA values; per-band DXCC entities for Russian entrants; complete legacy bands; and no duplicate elimination. RDA validation preserves the DLL's minimal two-leading-uppercase-letter test."],
  },
  {
    id: "rdxc-recovered",
    name: "RDXC recovered scoring",
    description: "Recovered rdxc.dll behavior: reciprocal Russian/DX geography points multiplied by per-band DXCC entities and Russian oblasts.",
    band: aadxBand,
    points: rdxcPoints,
    multiplier: rdxcMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    multiplierCount: (rows) => cqWwMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => cqWwMultiplierCount(rows, band),
    notes: ["Fixture-backed outside-entrant Russian ten-point, /MM five-point, and other same-entity/same-continent/remaining two/three/five-point branches; Russian-entrant Russian same/cross-continent two/five-point and other three/five-point branches; per-band DXCC and Russian-oblast stores; complete legacy bands; and no duplicate elimination. The DLL infers oblast from a legacy callsign table; this browser port uses the required received two-letter oblast so valid logs score equivalently without an opaque outdated inference."],
  },
  {
    id: "ref-recovered",
    name: "REF recovered scoring",
    description: "Recovered ref.dll behavior: reciprocal French/DX geography points multiplied by per-band departments or DXCC entities.",
    band: aadxBand,
    points: refPoints,
    multiplier: refMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    notes: ["Fixture-backed outside-entrant one/three-point French contacts; French-entrant six/fifteen-point French and one/two-point other contacts; recovered F/TQ/TP/TM/TW/HX/TH/HW/TV/TO/TK/TX recognition; per-band received departments or DXCC entities; complete legacy bands; and no duplicate elimination. Department text is retained without a separate validation table because ProcessLine accepts it directly."],
  },
  {
    id: "rnars-recovered",
    name: "RNARS recovered scoring",
    description: "Recovered rnars.dll behavior: one-point non-members and ten-point members multiplied by global DXCC entities or selected call areas.",
    band: aadxBand,
    points: rnarsPoints,
    multiplier: rnarsMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "global",
    multiplierCount: (rows) => tokenMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => tokenMultiplierCount(rows, band),
    notes: ["Fixture-backed one-point numeric and ten-point alphabetic received-exchange branches; exact GB4RN ten-point special multiplier; globally unique DXCC multipliers except VE/VK/W/ZL/ZS call areas; complete legacy bands; first-occurrence band attribution; and no duplicate elimination. Membership remains an advisory syntax test because the DLL tests only whether the first received character is alphabetic."],
  },
  {
    id: "ru-ww-digi-recovered",
    name: "RU-WW-DIGI recovered scoring",
    description: "Recovered rudigi.dll behavior: entity/continent points with low-band doubling, multiplied by mode-separated per-band DXCC entities and Russian oblasts.",
    band: aadxBand,
    points: ruDigiPoints,
    multiplier: ruDigiMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    multiplierCount: (rows) => ariMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => ariMultiplierCount(rows, band),
    notes: ["Fixture-backed one/three/five-point same-entity/same-continent/cross-continent branches; /QRP five-point override; 160/80/40-metre doubling; independently unique RY and non-RY per-band DXCC and Russian-prefix received-oblast stores; complete legacy bands; and no duplicate elimination."],
  },
  {
    id: "ru-ww-mm-recovered",
    name: "RU-WW-MM recovered scoring",
    description: "Recovered rumm.dll behavior: entity/continent points with low-band doubling, multiplied by four mode-separated per-band DXCC and Russian-oblast stores.",
    band: aadxBand,
    points: ruMmPoints,
    multiplier: ruMmMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    multiplierCount: (rows) => ariMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => ariMultiplierCount(rows, band),
    notes: ["Fixture-backed one/three/five-point same-entity/same-continent/cross-continent branches; 160/80/40-metre doubling; independently unique RY/CW/PH/other per-band DXCC and Russian-prefix received-oblast stores; complete legacy bands; and no duplicate elimination."],
  },
  {
    id: "ru-ww-psk-recovered",
    name: "RU-WW-PSK recovered scoring",
    description: "Recovered ruspsk.dll behavior: entity/continent points with low-band doubling, multiplied by per-band DXCC entities and Russian oblasts.",
    band: aadxBand,
    points: ruMmPoints,
    multiplier: ruPskMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    multiplierCount: (rows) => ariMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => ariMultiplierCount(rows, band),
    notes: ["Fixture-backed one/three/five-point same-entity/same-continent/cross-continent branches; 160/80/40-metre doubling; per-band DXCC and Russian-prefix received-oblast stores; complete legacy bands; and no duplicate elimination."],
  },
  {
    id: "sac-recovered",
    name: "SAC recovered scoring",
    description: "Recovered sac.dll reciprocal Scandinavian/DX scoring with per-band callsign-area or DXCC multipliers.",
    band: aadxBand,
    points: sacPoints,
    multiplier: sacMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    notes: ["Fixture-backed Scandinavian-entrant two-point European and three-point non-European contacts; outside-entrant Scandinavian-only contacts with non-European 80/40-metre three-point weighting; per-band Scandinavian callsign areas or worked DXCC entities; complete legacy bands; and no duplicate elimination."],
  },
  {
    id: "sartg-rtty-recovered",
    name: "SARTG-RTTY recovered scoring",
    description: "Recovered sartgrtty.dll behavior: entity/continent points multiplied by per-band DXCC entities and selected callsign areas.",
    band: aadxBand,
    points: sartgPoints,
    multiplier: sartgMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    multiplierCount: (rows) => ariMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => ariMultiplierCount(rows, band),
    notes: ["Fixture-backed five/ten/fifteen-point same-entity/same-continent/cross-continent branches; per-band DXCC plus JA/VE/VK/W callsign-area stores; complete legacy bands; and no duplicate elimination."],
  },
  {
    id: "scc-rtty-recovered",
    name: "SCC-RTTY recovered scoring",
    description: "Recovered scc.dll behavior: entity/continent and selected callsign-area points multiplied by received years on each band.",
    band: aadxBand,
    points: sccPoints,
    multiplier: sccMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    notes: ["Fixture-backed one/two/three-point same-entity/same-continent/cross-continent branches; recovered W/VE/VK/ZL/ZS/JA/PY/RA0/LU same-entity callsign-area comparison; per-band received-year stores; complete legacy bands; and no duplicate elimination."],
  },
  {
    id: "sp-dx-recovered",
    name: "SP-DX recovered scoring",
    description: "Recovered spdx.dll reciprocal Polish/DX scoring with per-band voivodeship or DXCC multipliers.",
    band: aadxBand,
    points: spdxPoints,
    multiplier: spdxMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    notes: ["Fixture-backed outside-entrant three-point Polish contacts and Polish-entrant one/three-point Europe/other contacts; recovered HF/SR/SO/SP/3Z/SQ/SN recognition; per-band validated voivodeships or DXCC entities; complete legacy bands; and no duplicate elimination."],
  },
  {
    id: "sp-dx-rtty-recovered",
    name: "SP-DX-RTTY recovered scoring",
    description: "Recovered spdxrtty.dll entity/continent points multiplied by per-band DXCC/voivodeships and distinct worked continents.",
    band: aadxBand,
    points: spdxRttyPoints,
    multiplier: spdxRttyMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    multiplierCount: (rows) => ariMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => ariMultiplierCount(rows, band),
    total: spdxRttyTotal,
    notes: ["Fixture-backed two/five/ten-point same-entity/same-continent/cross-continent branches; per-band DXCC and Polish voivodeship stores; AF/AS/EU/NA/OC/SA worked-continent factor with recovered minimum one; complete legacy bands; and no duplicate elimination."],
  },
  {
    id: "trc-dx-recovered",
    name: "TRC-DX recovered scoring",
    description: "Recovered trc.dll exchange scoring multiplied by per-band received ITU zones and TRC-member entities.",
    band: aadxBand,
    points: trcPoints,
    multiplier: trcMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    notes: ["Fixture-backed one-point normal contacts, ten-point TRC contacts for non-member entrants, one-point TRC contacts for entrants sending TRC, integer-normalized received ITU zones, separate per-band TRC resolved-entity stores, complete legacy bands, and no duplicate elimination."],
  },
  {
    id: "ur-dx-digi-recovered",
    name: "UR-DX-DIGI recovered scoring",
    description: "Recovered uadigi.dll reciprocal Ukrainian/DX points multiplied by RTTY/PSK-separated per-band DXCC entities and Ukrainian oblasts.",
    band: aadxBand,
    points: urDxDigiPoints,
    multiplier: urDxDigiMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    multiplierCount: (rows) => ariMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => ariMultiplierCount(rows, band),
    notes: ["Fixture-backed Ukrainian/outside reciprocal one/three/five/ten-point geography branches; maritime-mobile five-point override; 10-metre point doubling; independently unique RY and PK per-band DXCC and validated Ukrainian-oblast stores; complete legacy bands; and no duplicate elimination. Ukrainian recognition uses the local DXCC primary entity UR, equivalent to the DLL's embedded EM/EN/EO/UR/US-UT/UU-UV/UW-UZ/U5 prefix list for resolved calls."],
  },
  {
    id: "ua-dx-recovered",
    name: "Ukrainian DX recovered scoring",
    description: "Recovered uadx.dll reciprocal Ukrainian/DX geography points multiplied by per-band DXCC entities and outside-entrant Ukrainian oblasts.",
    band: aadxBand,
    points: uaDxPoints,
    multiplier: uaDxMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    multiplierCount: (rows) => ariMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => ariMultiplierCount(rows, band),
    notes: ["Fixture-backed outside-entrant one/two/three-point DX and ten-point Ukrainian contacts; Ukrainian-entrant one-point domestic, two-point European, and three-point non-European contacts; per-band DXCC and outside-entrant validated Ukrainian-oblast stores; complete legacy bands; and no duplicate elimination. Ukrainian recognition uses the local DXCC primary entity UR, equivalent to the DLL's embedded prefix list for resolved calls."],
  },
  {
    id: "uba-recovered",
    name: "UBA recovered scoring",
    description: "Recovered uba.dll reciprocal Belgian/DX points multiplied by per-band DXCC or outside-entrant Belgian province, prefix, and European-entity stores.",
    band: aadxBand,
    points: ubaPoints,
    multiplier: ubaMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    multiplierCount: (rows) => ariMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => ariMultiplierCount(rows, band),
    notes: ["Fixture-backed outside-entrant ten-point Belgian, three-point other-European, and one-point non-European contacts; Belgian-entrant one/two/three-point domestic/European/non-European contacts; embedded AN/BW/HT/LB/LG/NM/LU/OV/VB/WV/BR province validation; per-band Belgian WPX-style prefix, province, European entity, or DXCC stores; complete legacy bands; and no duplicate elimination."],
  },
  {
    id: "uk-dx-recovered",
    name: "UK-DX recovered scoring",
    description: "Recovered ukdx.dll entity/continent points with outside-entrant UK bonus, multiplied by per-band DXCC entities and received UK areas.",
    band: aadxBand,
    points: ukDxPoints,
    multiplier: ukDxMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    multiplierCount: (rows) => ariMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => ariMultiplierCount(rows, band),
    notes: ["Fixture-backed one/two/three-point same-entity/same-continent/cross-continent branches; outside-entrant five-point UK contacts; maritime-mobile three-point override without multipliers; per-band DXCC and UK received-area stores; complete legacy bands; and no duplicate elimination."],
  },
  {
    id: "ukeidx-recovered",
    name: "UKEIDX recovered scoring",
    description: "Recovered ukeidx.dll entrant-region and band points multiplied by per-band DXCC entities or validated UK districts.",
    band: aadxBand,
    points: ukeidxPoints,
    multiplier: ukeidxMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    notes: ["Fixture-backed UK, European, and non-European entrant branches; 80/40-metre doubling; recovered UK-entrant 0101–0458 UTC doubling; per-band DXCC or embedded UK-district stores; complete legacy bands; and no duplicate elimination."],
  },
  {
    id: "uksmg-recovered",
    name: "UKSMG recovered scoring",
    description: "Recovered uksmg.dll locator-distance points plus fixed bonuses for unique members, DXCC entities, and received squares.",
    points: (qso) => uksmgPoints(qso),
    multiplier: uksmgMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "global",
    multiplierCount: (rows) => tokenMultiplierCount(rows),
    total: uksmgTotal,
    scoreFormula: (points, multipliers) => `${points} + (${multipliers} × 500)`,
    notes: ["Fixture-backed same-locator one-point and rounded-up locator-distance branches; globally unique positive member numbers, received grids, and non-mobile DXCC entities; /M and /MM DXCC exclusion; fixed 500-point multiplier bonuses; and no duplicate elimination."],
  },
  {
    id: "un-dx-recovered",
    name: "UN-DX recovered scoring",
    description: "Recovered undx.dll reciprocal Kazakhstan/DX points multiplied by per-band DXCC entities and Kazakhstan district exchanges.",
    band: aadxBand,
    points: unDxPoints,
    multiplier: unDxMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    multiplierCount: (rows) => ariMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => ariMultiplierCount(rows, band),
    notes: ["Fixture-backed Kazakhstan-entrant two-point domestic, three-point Asian, and five-point non-Asian contacts; outside-entrant ten-point Kazakhstan, two-point same-entity, and five-point other-entity contacts; per-band DXCC and unvalidated received Kazakhstan-district stores; complete legacy bands; and no duplicate elimination. Kazakhstan recognition uses the local DXCC primary entity UN, equivalent to the DLL's embedded UN/UO/UP/UQ prefix test."],
  },
  {
    id: "volta-rtty-recovered",
    name: "VOLTA-RTTY recovered scoring",
    description: "Recovered volta.dll zone-table points multiplied by accepted QSOs, per-band countries, and intercontinental four-band DXCC bonuses.",
    band: aadxBand,
    points: voltaPoints,
    multiplier: voltaMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    multiplierCount: (rows) => ariMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => ariMultiplierCount(rows, band),
    total: voltaTotal,
    scoreFormula: () => "accepted QSOs × zone-table points × (band countries + four-band DXCC bonuses)",
    notes: ["Fixture-backed recovered 40×40 sent/received CQ-zone point table, intercontinental doubling on 80 and 10 metres, per-band worked-country stores, four-band intercontinental DXCC bonuses, accepted-QSO × points × multipliers formula, complete legacy bands, and no duplicate elimination. The browser requires four distinct bands for the four-band bonus; the DLL's unguarded occurrence counter was only equivalent after duplicate-free preprocessing."],
  },
  {
    id: "wae-dx-recovered",
    name: "WAE DX recovered scoring",
    description: "Recovered waedx.dll Europe-versus-outside QSOs and QTCs multiplied by weighted per-band countries and selected call areas.",
    band: aadxBand,
    points: (qso, context) => waePoints(qso, context),
    multiplier: (qso, context) => waeMultiplier(qso, context),
    duplicatePolicy: "none",
    multiplierScope: "band",
    multiplierCount: waeMultiplierCount,
    bandMultiplierCount: waeBandMultiplierCount,
    total: waeTotal,
    scoreFormula: () => "(eligible QSOs + parsed QTC records) × weighted band countries/call areas",
    notes: ["Fixture-backed recovered Europe-versus-outside eligibility, one point per accepted QSO, W/VE/VK/ZL/ZS/JA/PY/RA0 call-area handling, per-band country stores weighted 4× on 80 m, 3× on 40 m, and 2× on 20/15/10 m, parsed Cabrillo QTC-record bonuses, and no duplicate elimination. European eligibility follows the DLL's embedded entity list."],
  },
  {
    id: "wae-rtty-recovered",
    name: "WAE RTTY recovered scoring",
    description: "Recovered waertty.dll worldwide QSOs and QTCs multiplied by weighted per-band countries and selected call areas.",
    band: aadxBand,
    points: (qso, context) => waePoints(qso, context, true),
    multiplier: (qso, context) => waeMultiplier(qso, context, true),
    duplicatePolicy: "none",
    multiplierScope: "band",
    multiplierCount: waeMultiplierCount,
    bandMultiplierCount: waeBandMultiplierCount,
    total: waeTotal,
    scoreFormula: () => "(accepted QSOs + parsed QTC records) × weighted band countries/call areas",
    notes: ["Fixture-backed recovered worldwide RTTY eligibility, one point per resolved QSO, W/VE/VK/ZL/ZS/JA/PY/RA0 call-area handling, per-band country stores weighted 4× on 80 m, 3× on 40 m, and 2× on 20/15/10 m, parsed Cabrillo QTC-record bonuses, and no duplicate elimination."],
  },
  {
    id: "wag-recovered",
    name: "WAG recovered scoring",
    description: "Recovered wag.dll reciprocal German/DX points multiplied by per-band DXCC entities or received DOKs.",
    band: aadxBand,
    points: wagPoints,
    multiplier: wagMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    multiplierCount: (rows) => ariMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => ariMultiplierCount(rows, band),
    notes: ["Fixture-backed German-entrant one/three/five-point domestic/European/non-European contacts; outside-entrant three-point German contacts; per-band DXCC or received-DOK stores; complete legacy bands; and no duplicate elimination. The browser preserves the full normalized DOK rather than the DLL's apparent first-letter truncation, a documented correction to a legacy parsing defect."],
  },
  {
    id: "xe-rtty-recovered",
    name: "XE-RTTY recovered scoring",
    description: "Recovered xertty.dll entity-relative points multiplied by per-band DXCC entities or validated Mexican states.",
    band: aadxBand,
    points: xeRttyPoints,
    multiplier: xeRttyMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    multiplierCount: (rows) => ariMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => ariMultiplierCount(rows, band),
    notes: ["Fixture-backed two-point same-entity and three-point different-entity contacts; embedded Mexican-state validation; per-band non-Mexican DXCC and Mexican-state stores; complete legacy bands; and no duplicate elimination. Mexico recognition uses the local DXCC primary entity XE, equivalent to the DLL's recovered prefix test."],
  },
  {
    id: "yb-dx-recovered",
    name: "YB-DX recovered scoring",
    description: "Recovered ybdxc.dll reciprocal Indonesian/DX points multiplied by per-band DXCC and entrant-dependent WPX stores.",
    band: aadxBand,
    points: ybDxPoints,
    multiplier: ybDxMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    multiplierCount: (rows) => ariMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => ariMultiplierCount(rows, band),
    notes: ["Fixture-backed outside-entrant ten-point Indonesian and one/two/three-point other contacts; Indonesian-entrant zero-point domestic, five-point Asian, and ten-point non-Asian contacts; per-band DXCC plus outside-entrant Indonesian-WPX or Indonesian-entrant all-WPX stores; complete legacy bands; and no duplicate elimination. Zero-point domestic Indonesian contacts can introduce DXCC and WPX multipliers, matching the DLL."],
  },
  {
    id: "yo-dx-recovered",
    name: "YO-DX recovered scoring",
    description: "Recovered yodx.dll reciprocal Romanian/DX points multiplied by per-band Romanian counties or DXCC entities.",
    band: aadxBand,
    points: yoDxPoints,
    multiplier: yoDxMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    notes: ["Fixture-backed outside-entrant eight-point Romanian, one/two-point same-entity, and four-point other contacts; Romanian-entrant zero-point domestic and eight-point DX contacts; per-band validated Romanian-county or DXCC stores; complete legacy bands; and no duplicate elimination. Romanian recognition uses the active local DXCC primary entity, equivalent to the DLL's embedded YO/YP/YQ/YR test."],
  },
  {
    id: "yo-psk31-recovered",
    name: "YO-PSK31 recovered scoring",
    description: "Recovered yopsk.dll 80-metre one/two-point contacts multiplied by global DXCC entities and validated Romanian counties.",
    band: yoPskBand,
    points: yoPskPoints,
    multiplier: yoPskMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "global",
    multiplierCount: (rows) => ariMultiplierCount(rows),
    bandMultiplierCount: (rows, band) => ariMultiplierCount(rows, band),
    notes: ["Fixture-backed exact 3500–4000 kHz eligibility, two-point Romanian and one-point other resolved contacts, independent global DXCC and validated Romanian-county stores, and no duplicate elimination. The recovered module ignores the entrant callsign and can count both YO DXCC and county on one contact."],
  },
  {
    id: "yu-dx-recovered",
    name: "YU-DX recovered scoring",
    description: "Recovered yudx.dll entity/continent points multiplied by received YU exchanges on each band.",
    band: aadxBand,
    points: yuDxPoints,
    multiplier: yuDxMultiplier,
    duplicatePolicy: "none",
    multiplierScope: "band",
    notes: ["Fixture-backed one/two/four-point same-entity/same-continent/cross-continent branches, per-band received-exchange multipliers for worked YU entities, complete legacy bands, and no duplicate elimination. ProcessLine accepts any non-empty YU received exchange, so the browser retains it without inventing a district table."],
  },
];

export function recommendedRuleId(contest: string): string {
  const name = contest.trim().toUpperCase();
  if (name === "CQ-WPX-RTTY") return "cq-wpx-rtty-recovered";
  if (name.startsWith("CQ-WPX")) return "cq-wpx-recovered";
  if (name === "CQ-WW-RTTY") return "cq-ww-rtty-recovered";
  if (name === "CQ-WW-CW" || name === "CQ-WW-SSB") return "cq-ww-recovered";
  if (name === "CQ-160-CW" || name === "CQ-160-SSB") return "cq-160-recovered";
  if (name === "ARR-PSK63") return "arr-psk63-recovered";
  if (name === "CWJF-MM") return "cwjf-mm-recovered";
  if (name === "DIG-QSO-PARTY") return "dig-qso-party-recovered";
  if (name === "DIG-PA") return "dig-qso-party-recovered";
  if (name === "DL-DX-RTTY") return "dl-dx-rtty-recovered";
  if (name === "DRCG-WW-RTTY" || name === "LDC-RTTY") return "drcg-ww-rtty-recovered";
  if (name === "EA-RTTY") return "ea-rtty-recovered";
  if (name === "POLSKA-WW-BPSK63") return "polska-ww-bpsk63-recovered";
  if (name === "EPC-UKR-DX") return "epc-ukr-dx-recovered";
  if (name === "EPC-WW-DX") return "epc-ww-dx-recovered";
  if (name === "EUDXC") return "eudxc-recovered";
  if (name === "EU-PSK-DX") return "eu-psk-dx-recovered";
  if (name === "FT8-DX" || name === "FT8-RU") return "ft8-dx-recovered";
  if (name === "GACW") return "gacw-recovered";
  if (name === "HA-DX") return "ha-dx-recovered";
  if (name === "HELVETIA") return "helvetia-recovered";
  if (name === "HOLYLAND") return "holyland-recovered";
  if (name === "IARU-HF") return "iaru-hf-recovered";
  if (name === "JARTS-WW-RTTY") return "jarts-ww-rtty-recovered";
  if (name === "JIDX-CW" || name === "JIDX-SSB" || name === "JIDX-PH") return "jidx-recovered";
  if (name === "JT-DX" || name === "JT-DX-RTTY") return "jt-dx-recovered";
  if (name === "LZ-DX") return "lz-dx-recovered";
  if (name === "MARCONI-MEMORIAL") return "marconi-memorial-recovered";
  if (name === "NAQP-CW" || name === "NAQP-RTTY" || name === "NAQP-SSB") return "naqp-recovered";
  if (name === "OCEANIA-DX-CW" || name === "OCEANIA-DX-SSB") return "oceania-dx-recovered";
  if (name === "OK-OM-DX") return "ok-om-dx-recovered";
  if (name === "OKOM-DX-SSB") return "okom-dx-ssb-recovered";
  if (name === "OK-DX-RTTY") return "ok-dx-rtty-recovered";
  if (name === "PACC") return "pacc-recovered";
  if (name === "PDC" || name === "PORTUGAL-DAY" || name === "PORTUGAL=DAY") return "portugal-day-recovered";
  if (name === "RADIO-160") return "radio-160-recovered";
  if (name === "RADIO-WW-RTTY") return "radio-ww-rtty-recovered";
  if (name === "RCC-CUP") return "rcc-cup-recovered";
  if (name === "RDAC") return "rdac-recovered";
  if (name === "RDXC") return "rdxc-recovered";
  if (name === "REF-160M" || name === "REF-CW" || name === "REF-SSB") return "ref-recovered";
  if (name === "RNARS" || name === "RNARS-CW") return "rnars-recovered";
  if (name === "RUS-WW-DIGI" || name === "RU-WW-DIGI") return "ru-ww-digi-recovered";
  if (name === "RUS-WW-MM" || name === "RU-WW-MM") return "ru-ww-mm-recovered";
  if (name === "RUS-WW-PSK" || name === "RU-WW-PSK") return "ru-ww-psk-recovered";
  if (name === "SAC-CW" || name === "SAC-SSB") return "sac-recovered";
  if (name === "SARTG-RTTY" || name === "SARTG RTTY" || name === "SARTG") return "sartg-rtty-recovered";
  if (name === "SCC-RTTY" || name === "SCC RTTY") return "scc-rtty-recovered";
  if (name === "SP-DX" || name === "SPDX" || name === "SPDX CONTEST") return "sp-dx-recovered";
  if (name === "SP-DX-RTTY" || name === "SP DX RTTY" || name === "SPDX-RTTY") return "sp-dx-rtty-recovered";
  if (name === "TRC-DX" || name === "TRC DX") return "trc-dx-recovered";
  if (name === "UR-DX-DIGI" || name === "UR DX DIGI") return "ur-dx-digi-recovered";
  if (name === "UDXC" || name === "UADX" || name === "UA-DX" || name === "UKRAINIAN DX") return "ua-dx-recovered";
  if (name === "UBA" || name === "UBA-CW" || name === "UBA-SSB") return "uba-recovered";
  if (name === "UKDX" || name === "UK-DX-CW" || name === "UK-DX-RTTY" || name === "UK-DX-SSB") return "uk-dx-recovered";
  if (name === "UKEIDX" || name === "UKEIDX-CW" || name === "UKEIDX-SSB") return "ukeidx-recovered";
  if (name === "UKSMG") return "uksmg-recovered";
  if (name === "UN-DX" || name === "UNDX") return "un-dx-recovered";
  if (name === "VOLTA-RTTY" || name === "VOLTA RTTY") return "volta-rtty-recovered";
  if (name === "DARC-WAEDC-CW" || name === "DARC-WAEDC-SSB" || name === "WAEDC") return "wae-dx-recovered";
  if (name === "DARC-WAEDC-RTTY") return "wae-rtty-recovered";
  if (name === "WAG-CW" || name === "WAG-SSB" || name === "WAG-MIXED" || name === "WAG") return "wag-recovered";
  if (name === "XE-RTTY" || name === "XE-INTL-RTTY" || name === "XERTTY") return "xe-rtty-recovered";
  if (name === "YB-DX" || name === "YB DX CONTEST") return "yb-dx-recovered";
  if (name === "YODX" || name === "YO-DX" || name === "YO DX") return "yo-dx-recovered";
  if (name === "YO-PSK31" || name === "YO PSK31") return "yo-psk31-recovered";
  if (name === "YU-DX" || name === "YUDX" || name === "YU DX CONTEST") return "yu-dx-recovered";
  if (name === "WFD" || name.includes("WINTER-FIELD-DAY")) return "wfd-recovered";
  if (name === "SARL-YOUTH-SPRINT") return "sarl-youth-recovered";
  if (name === "SARL-YL-SPRINT") return "sarl-yl-recovered";
  if (name === "WIA-HA") return "wia-ha-recovered";
  if (name.startsWith("UKEICC-80M")) return "ukeicc-recovered";
  if (name === "RADIO-POPOV") return "radio-popov-recovered";
  if (name === "IG-RY" || name === "IG-RTTY") return "ig-rtty-recovered";
  if (name === "CW-OPS") return "cwops-recovered";
  if (name === "HSC" || name === "HSC-CW") return "hsc-recovered";
  if (name === "ARRL-SS-CW" || name === "ARRL-SS-SSB") return "arrl-ss-recovered";
  if (name === "EUHFC" || name === "EU-HF") return "euhfc-recovered";
  if (name === "SPAR-WFD") return "spar-wfd-recovered";
  if (name === "POPOV-VHF") return "popov-vhf-recovered";
  if (name === "TMC-RTTY") return "tmc-rtty-recovered";
  if (name === "PEARS-VHF-UHF") return "pears-vhf-recovered";
  if (name === "DIGIFEST") return "digifest-recovered";
  if (name === "WIA-VHF-UHF") return "wia-vhf-recovered";
  if (name === "SARL-VHF" || name === "SARL-VHF-DIGITAL") return "sarl-vhf-recovered";
  if (name === "AEGEAN-VHF") return "aegean-vhf-recovered";
  if (name === "RSGB-LOW-POWER") return "rsgb-low-power-recovered";
  if (name === "REMEMBRANCE-DAY") return "remembrance-day-recovered";
  if (name === "BASSO-FERRARESE") return "basso-ferrarese-recovered";
  if (name === "BDM-WW-RTTY") return "bdm-ww-rtty-recovered";
  if (name === "AEGEAN-RTTY") return "aegean-rtty-recovered";
  if (name === "BALTIC") return "baltic-recovered";
  if (name === "INORC") return "inorc-recovered";
  if (name === "WWPMC") return "wwpmc-recovered";
  if (name === "UKR-CHAMP-RTTY") return "ukr-champ-rtty-recovered";
  if (name === "GDBAGE-DX-TEST") return "gdbage-dx-recovered";
  if (name === "AP-SPRINT") return "ap-sprint-recovered";
  if (name === "9A-CW") return "9a-cw-recovered";
  if (name === "RSGB-160") return "rsgb-160-recovered";
  if (name === "RSGB-NFD") return "rsgb-nfd-recovered";
  if (name === "RSGB-SSB-FD") return "rsgb-ssb-fd-recovered";
  if (name === "ARRL-UHF-AUG") return "arrl-uhf-recovered";
  if (name === "ARRL-VHF-JAN") return "arrl-vhf-jan-recovered";
  if (name === "ARRL-VHF-JUN" || name === "ARRL-VHF-SEP") return "arrl-vhf-recovered";
  if (name === "CQ-VHF") return "cq-vhf-recovered";
  if (name === "EPC-PSK63") return "epc-psk63-recovered";
  if (name === "ARI-SEZ") return "ari-sez-recovered";
  if (name === "RSGB-IOTA") return "rsgb-iota-recovered";
  if (name === "WW-DIGI") return "ww-digi-recovered";
  if (name === "YBDX-80M") return "ybdx-80m-recovered";
  if (name === "AVHFC") return "avhfc-recovered";
  if (name === "DMC-RTTY") return "dmc-rtty-recovered";
  if (name === "DARC-XMAS" || name === "XMAS") return "darc-xmas-recovered";
  if (name === "ES-OPEN-HF") return "es-open-hf-recovered";
  if (name === "UBA-PSK63-PREFIX") return "uba-psk63-prefix-recovered";
  if (name === "KCJ" || name === "KCJ-TOPBAND") return "kcj-recovered";
  if (name === "SARL-HF-CW" || name === "SARL-HF-PHONE") return "sarl-hf-recovered";
  if (name === "CIS-QPSK63-DX") return "cis-qpsk63-dx-recovered";
  if (name === "CA-QSO-PARTY") return "ca-qso-party-recovered";
  if (name === "NY-QSO-PARTY") return "ny-qso-party-recovered";
  if (name === "RAC-CANADA-DAY" || name === "RAC-CANADA-WINTER") return "rac-recovered";
  if (name === "GEORGIA") return "georgia-recovered";
  if (name === "10M-RTTY") return "10m-rtty-recovered";
  if (name === "AADX-CW" || name === "AADX-SSB" || name === "ALL-ASIAN-CW" || name === "ALL-ASIAN-SSB") return "aadx-recovered";
  if (name === "AFRICA-DX") return "africa-dx-recovered";
  if (name === "AGB-PARTY") return "agb-party-recovered";
  if (name === "ARI-DX") return "ari-dx-recovered";
  if (name === "ARRL-10") return "arrl-10-recovered";
  if (name === "ARRL-160") return "arrl-160-recovered";
  if (name === "ARRL-DX-CW" || name === "ARRL-DX-SSB") return "arrl-dx-recovered";
  if (name === "ARRL-RTTY") return "arrl-rtty-recovered";
  if (name === "BARTG-RTTY") return "bartg-rtty-recovered";
  if (name === "BARTG-SPRINT") return "bartg-sprint-recovered";
  if (name === "CQ-M") return "cq-m-recovered";
  if (name === "CQSA-CW" || name === "CQSA-RTTY" || name === "CQSA-SSB") return "cqsa-recovered";
  return "generic-prefix";
}

export function scoreCabrillo(document: CabrilloDocument, ruleId = "generic-prefix"): ScoreResult {
  const rule = scoringRules.find((candidate) => candidate.id === ruleId) ?? scoringRules[0]!;
  const seen = new Set<string>();
  const rows: ScoreRow[] = [];
  const stationCall = document.lines.find((line) => line.key === "CALLSIGN")?.value ?? "";
  const stationGeo = geography.lookup(stationCall);
  const ruleState = new Map<string, Set<string>>();
  const scoringLines = document.lines.filter((candidate) => candidate.qso && !candidate.raw.startsWith("X-QSO:"));
  for (const line of scoringLines) {
    const qso = line.qso!;
    const band = rule.band?.(qso) ?? (bandFromFrequency(qso.frequency) || "OTHER");
    const duplicateKey = rule.duplicateKey?.(qso, band) ?? `${band}|${qso.mode}|${qso.call.toUpperCase()}`;
    const duplicate = rule.duplicatePolicy === "none" ? false : seen.has(duplicateKey);
    if (rule.duplicatePolicy !== "none") seen.add(duplicateKey);
    const geo = geography.lookup(qso.call);
    const context: ScoringContext = { band, stationCall, station: stationGeo, worked: geo, state: ruleState };
    const points = duplicate ? 0 : rule.points(qso, context);
    const bonusPoints = duplicate ? 0 : rule.bonusPoints?.(qso, context) ?? 0;
    const multiplier = duplicate ? "" : rule.multiplier(qso, context);
    rows.push({ qsoId: line.id, band, mode: qso.mode.toUpperCase(), call: qso.call, country: geo?.country ?? "Unknown", continent: geo?.continent ?? "", prefix: geo?.matchedPrefix ?? "", points, bonusPoints, multiplier, duplicate });
  }
  const points = rows.reduce((sum, row) => sum + row.points, 0);
  const multipliers = multiplierCount(rule, rows);
  const byBandMap = new Map<string, { qsos: number; points: number; multipliers: Set<string> }>();
  rows.forEach((row) => {
    const current = byBandMap.get(row.band) ?? { qsos: 0, points: 0, multipliers: new Set<string>() };
    if (!row.duplicate) current.qsos += 1;
    current.points += row.points;
    if (row.multiplier) current.multipliers.add(row.multiplier);
    byBandMap.set(row.band, current);
  });
  const byHourMap = new Map<string, { qsos: number; points: number }>();
  scoringLines.forEach((line, index) => {
    const row = rows[index]!;
    const qso = line.qso!;
    const hour = `${qso.date} ${qso.time.slice(0, 2)}:00`;
    const current = byHourMap.get(hour) ?? { qsos: 0, points: 0 };
    if (!row.duplicate) current.qsos += 1;
    current.points += row.points;
    byHourMap.set(hour, current);
  });
  const summarize = (keyOf: (row: ScoreRow) => string) => {
    const summary = new Map<string, { qsos: number; points: number }>();
    for (const row of rows) {
      const key = keyOf(row) || "Unknown";
      const current = summary.get(key) ?? { qsos: 0, points: 0 };
      if (!row.duplicate) current.qsos += 1;
      current.points += row.points;
      summary.set(key, current);
    }
    return summary;
  };
  const byModeMap = summarize((row) => row.mode);
  const byCountryMap = summarize((row) => `${row.country}\0${row.continent}`);
  return {
    ruleId: rule.id,
    ruleName: rule.name,
    qsos: rows.filter((row) => !row.duplicate).length,
    duplicates: rows.filter((row) => row.duplicate).length,
    points,
    multipliers,
    total: scoringTotal(rule, points, multipliers, rows, document),
    formula: scoringFormula(rule, points, multipliers, document),
    rows,
    byBand: [...byBandMap].map(([band, data]) => ({ band, qsos: data.qsos, points: data.points, multipliers: rule.bandMultiplier?.(band) ?? rule.bandMultiplierCount?.(rows, band) ?? data.multipliers.size })),
    byMode: [...byModeMap].map(([mode, data]) => ({ mode, ...data })).sort((left, right) => left.mode.localeCompare(right.mode)),
    byCountry: [...byCountryMap].map(([key, data]) => { const [country, continent] = key.split("\0"); return { country: country!, continent: continent!, ...data }; }).sort((left, right) => right.qsos - left.qsos || left.country.localeCompare(right.country)),
    byHour: [...byHourMap].map(([hour, data]) => ({ hour, ...data })).sort((a, b) => a.hour.localeCompare(b.hour)),
    notes: rule.notes ? [...rule.notes] : rule.id === "wfd-recovered" ? ["Matches the recovered module's QSO-point total. Objective multipliers are intentionally not counted."] : rule.id === "cq-wpx-recovered" ? ["Fixture-backed recovered calculation. Country resolution uses the active local DXCC/CTY table; unresolved calls score zero conservatively."] : rule.id === "sarl-youth-recovered" ? ["Fixture-backed recovered age-category point branches; invalid ages score zero conservatively."] : rule.id === "sarl-yl-recovered" ? ["Fixture-backed recovered YL exchange point branches; fixed multiplier of one."] : rule.id === "wia-ha-recovered" ? ["Fixture-backed recovered 80 m and mode branches; contacts outside 80 m score zero."] : rule.id === "ukeicc-recovered" ? ["Fixture-backed recovered locator-distance calculation; malformed locators score zero conservatively."] : rule.id === "radio-popov-recovered" ? ["Fixture-backed recovered received-points sum; malformed or negative point exchanges score zero conservatively."] : rule.id === "ig-rtty-recovered" ? ["Fixture-backed recovered QSO × unique received-year calculation."] : rule.id === "cwops-recovered" ? ["Fixture-backed recovered QSO × unique worked-callsign calculation."] : rule.id === "hsc-recovered" ? ["Fixture-backed recovered HSC membership/NM point branches; empty exchanges score zero conservatively."] : rule.id === "arrl-ss-recovered" ? ["Fixture-backed recovered two-point QSO and section-multiplier calculation using the module's embedded section list."] : rule.id === "euhfc-recovered" ? ["Fixture-backed recovered QSO × band-scoped received-year multiplier calculation."] : rule.id === "spar-wfd-recovered" ? ["Fixture-backed recovered QSO × band-scoped mode multiplier calculation; unsupported modes score zero conservatively."] : rule.id === "popov-vhf-recovered" || rule.id === "tmc-rtty-recovered" ? ["Fixture-backed recovered whole-kilometre locator-distance sum. The legacy modules count every parsed row and do not eliminate duplicates."] : rule.id === "pears-vhf-recovered" ? ["Fixture-backed recovered locator-distance points multiplied separately by unique four-character received grid squares on each band."] : rule.id === "digifest-recovered" ? ["Fixture-backed recovered locator-distance points multiplied by unique four-character received grid squares across all bands."] : rule.id === "wia-vhf-recovered" ? ["Fixture-backed recovered first-seen sent/received grid bonuses and fixed per-band factors; every parsed row is counted."] : rule.id === "sarl-vhf-recovered" ? ["Fixture-backed recovered per-band distance × grid × band-factor calculation; every parsed row is counted."] : rule.id === "aegean-vhf-recovered" ? ["Fixture-backed recovered per-band QSO × rounded-up distance × grid calculation; every parsed row is counted."] : rule.id === "rsgb-low-power-recovered" ? ["Fixture-backed recovered portable/fixed and 10-watt point branches; every parsed row is counted."] : rule.id === "remembrance-day-recovered" ? ["Fixture-backed recovered band, strict time-window, CW/RTTY point branches; every parsed row is counted."] : ["Generic scoring is a checking aid, not an official contest adjudication result."],
  };
}
