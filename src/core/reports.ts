import type { CabrilloDocument, ScoreResult } from "./types";
import { activityBuckets, scoreRowsToCsv, type ActivityBucket } from "./score-tools";

const escapeHtml = (value: unknown): string => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

export function activityToCsv(buckets: readonly ActivityBucket[]): string {
  return `START,QSOS,POINTS\r\n${buckets.map((bucket) => `${bucket.start},${bucket.qsos},${bucket.points}`).join("\r\n")}\r\n`;
}

export function activityChartSvg(buckets: readonly ActivityBucket[], title = "Contest activity"): string {
  const width = 1000;
  const height = 420;
  const pad = 60;
  const max = Math.max(1, ...buckets.map((bucket) => bucket.points));
  const barWidth = Math.max(2, (width - pad * 2) / Math.max(1, buckets.length));
  const bars = buckets.map((bucket, index) => {
    const valueHeight = bucket.points / max * (height - pad * 2);
    const x = pad + index * barWidth;
    const y = height - pad - valueHeight;
    return `<rect x="${x}" y="${y}" width="${Math.max(1, barWidth - 2)}" height="${valueHeight}" fill="#1d6f78"><title>${escapeHtml(bucket.start)}: ${bucket.points} points</title></rect>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title"><title id="title">${escapeHtml(title)}</title><rect width="100%" height="100%" fill="white"/><text x="${pad}" y="32" font-family="sans-serif" font-size="22" fill="#17262b">${escapeHtml(title)}</text><line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" stroke="#5d6c70"/>${bars}</svg>`;
}

export function scoringReportHtml(document: CabrilloDocument, score: ScoreResult, generatedAt = new Date()): string {
  const station = document.lines.find((line) => line.key === "CALLSIGN")?.value ?? "";
  const bandRows = score.byBand.map((row) => `<tr><td>${escapeHtml(row.band)}</td><td>${row.qsos}</td><td>${row.points}</td><td>${row.multipliers}</td></tr>`).join("");
  const countryRows = score.byCountry.map((row) => `<tr><td>${escapeHtml(row.country)}</td><td>${escapeHtml(row.continent)}</td><td>${row.qsos}</td><td>${row.points}</td></tr>`).join("");
  const qsoRows = score.rows.map((row) => `<tr><td>${escapeHtml(row.call)}</td><td>${escapeHtml(row.band)}</td><td>${escapeHtml(row.mode)}</td><td>${escapeHtml(row.country)}</td><td>${row.points}</td><td>${row.bonusPoints ?? 0}</td><td>${escapeHtml(row.multiplier)}</td><td>${row.duplicate ? "Duplicate" : "Counted"}</td></tr>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(document.contest)} scoring report</title><style>body{font:15px system-ui,sans-serif;color:#17262b;max-width:1100px;margin:2rem auto;padding:0 1rem}table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{border:1px solid #aab5b8;padding:.45rem;text-align:left}th{background:#edf4f3}.score{font-size:2.5rem;font-weight:750}@media print{body{margin:0;max-width:none}}</style></head><body><h1>${escapeHtml(document.contest)} scoring report</h1><p>Station: <strong>${escapeHtml(station)}</strong></p><p class="score">${score.total.toLocaleString()}</p><p>${escapeHtml(score.formula)}; ${score.qsos} counted QSOs; ${score.duplicates} duplicates.</p><h2>Band totals</h2><table><thead><tr><th>Band</th><th>QSOs</th><th>Points</th><th>Multipliers</th></tr></thead><tbody>${bandRows}</tbody></table><h2>Countries</h2><table><thead><tr><th>Country</th><th>Continent</th><th>QSOs</th><th>Points</th></tr></thead><tbody>${countryRows}</tbody></table><h2>Calculation trace</h2><table><thead><tr><th>Call</th><th>Band</th><th>Mode</th><th>Country</th><th>Points</th><th>Bonus</th><th>Multiplier</th><th>Status</th></tr></thead><tbody>${qsoRows}</tbody></table><p>Generated locally ${escapeHtml(generatedAt.toISOString())}. ${escapeHtml(score.ruleName)}.</p></body></html>`;
}

export { scoreRowsToCsv, activityBuckets };
