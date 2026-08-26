import { updateHeader } from "./cabrillo";
import { multiplierCount, scoreCabrillo, scoringFormula, scoringRules, scoringTotal } from "./scoring";
import type { CabrilloDocument, ScoreResult, ScoreRow } from "./types";

export interface ScoreOverride {
  points?: number;
  multiplier?: string;
}

export type ScoreOverrides = Record<string, ScoreOverride>;

export function scoreWithOverrides(document: CabrilloDocument, ruleId: string, overrides: ScoreOverrides): ScoreResult {
  const base = scoreCabrillo(document, ruleId);
  const rows = base.rows.map((row) => {
    const override = overrides[row.qsoId];
    return override ? { ...row, points: override.points ?? row.points, multiplier: override.multiplier ?? row.multiplier } : row;
  });
  const points = rows.reduce((sum, row) => sum + row.points, 0);
  const rule = scoringRules.find((candidate) => candidate.id === ruleId) ?? scoringRules[0]!;
  const multipliers = multiplierCount(rule, rows);
  const byBandMap = new Map<string, { qsos: number; points: number; multipliers: Set<string> }>();
  rows.forEach((row) => {
    const current = byBandMap.get(row.band) ?? { qsos: 0, points: 0, multipliers: new Set<string>() };
    if (!row.duplicate) current.qsos += 1;
    current.points += row.points;
    if (!row.duplicate && row.multiplier) current.multipliers.add(row.multiplier);
    byBandMap.set(row.band, current);
  });
  const rowMap = new Map(rows.map((row) => [row.qsoId, row]));
  const byHourMap = new Map<string, { qsos: number; points: number }>();
  document.lines.filter((line) => line.qso && !line.raw.startsWith("X-QSO:")).forEach((line) => {
    const row = rowMap.get(line.id);
    if (!row) return;
    const hour = `${line.qso!.date} ${line.qso!.time.slice(0, 2)}:00`;
    const current = byHourMap.get(hour) ?? { qsos: 0, points: 0 };
    if (!row.duplicate) current.qsos += 1;
    current.points += row.points;
    byHourMap.set(hour, current);
  });
  const summarize = (keyOf: (row: ScoreRow) => string) => {
    const result = new Map<string, { qsos: number; points: number }>();
    for (const row of rows) {
      const key = keyOf(row) || "Unknown";
      const current = result.get(key) ?? { qsos: 0, points: 0 };
      if (!row.duplicate) current.qsos += 1;
      current.points += row.points;
      result.set(key, current);
    }
    return result;
  };
  const byMode = [...summarize((row) => row.mode)].map(([mode, data]) => ({ mode, ...data })).sort((left, right) => left.mode.localeCompare(right.mode));
  const byCountry = [...summarize((row) => `${row.country}\0${row.continent}`)].map(([key, data]) => { const [country, continent] = key.split("\0"); return { country: country!, continent: continent!, ...data }; }).sort((left, right) => right.qsos - left.qsos || left.country.localeCompare(right.country));
  return {
    ...base,
    rows,
    points,
    multipliers,
    total: scoringTotal(rule, points, multipliers, rows, document),
    formula: scoringFormula(rule, points, multipliers, document),
    byBand: [...byBandMap].map(([band, data]) => ({ band, qsos: data.qsos, points: data.points, multipliers: rule.bandMultiplier?.(band) ?? rule.bandMultiplierCount?.(rows, band) ?? data.multipliers.size })),
    byMode,
    byCountry,
    byHour: [...byHourMap].map(([hour, data]) => ({ hour, ...data })).sort((left, right) => left.hour.localeCompare(right.hour)),
    notes: Object.keys(overrides).length ? [...base.notes, "Manual point or multiplier corrections are applied; use Rescan to restore a row from the scoring rule."] : base.notes,
  };
}

export function updateClaimedScore(document: CabrilloDocument, score: ScoreResult): CabrilloDocument {
  return updateHeader(document, "CLAIMED-SCORE", String(score.total));
}

function quoteCsv(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function scoreRowsToCsv(score: ScoreResult): string {
  const header = ["QSO_ID", "CALL", "BAND", "MODE", "COUNTRY", "CONTINENT", "MATCHED_PREFIX", "POINTS", "BONUS_POINTS", "MULTIPLIER", "DUPLICATE"];
  const rows = score.rows.map((row) => [row.qsoId, row.call, row.band, row.mode, row.country, row.continent, row.prefix, row.points, row.bonusPoints ?? 0, row.multiplier, row.duplicate ? "Y" : "N"].map(quoteCsv).join(","));
  return `${header.join(",")}\r\n${rows.join("\r\n")}\r\n`;
}

export interface ActivityBucket {
  start: string;
  qsos: number;
  points: number;
}

export function activityBuckets(
  document: CabrilloDocument,
  rows: readonly ScoreRow[],
  intervalMinutes = 60,
  period?: { start?: string; end?: string },
): ActivityBucket[] {
  const interval = Math.max(1, Math.min(1440, Math.round(intervalMinutes)));
  const scoreRows = new Map(rows.map((row) => [row.qsoId, row]));
  const buckets = new Map<number, ActivityBucket>();
  for (const line of document.lines.filter((candidate) => candidate.qso)) {
    const row = scoreRows.get(line.id);
    if (!row) continue;
    const time = line.qso!.time.padEnd(4, "0");
    const timestamp = Date.parse(`${line.qso!.date}T${time.slice(0, 2)}:${time.slice(2, 4)}:00Z`);
    if (!Number.isFinite(timestamp)) continue;
    if (period?.start && timestamp < Date.parse(period.start)) continue;
    if (period?.end && timestamp > Date.parse(period.end)) continue;
    const size = interval * 60_000;
    const bucketStart = Math.floor(timestamp / size) * size;
    const current = buckets.get(bucketStart) ?? { start: new Date(bucketStart).toISOString(), qsos: 0, points: 0 };
    if (!row.duplicate) current.qsos += 1;
    current.points += row.points;
    buckets.set(bucketStart, current);
  }
  return [...buckets].sort((left, right) => left[0] - right[0]).map(([, bucket]) => bucket);
}
