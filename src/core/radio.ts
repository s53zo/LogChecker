const BAND_RANGES: Array<[number, number, string]> = [
  [1800, 2000, "160M"],
  [3500, 4000, "80M"],
  [5000, 5500, "60M"],
  [7000, 7300, "40M"],
  [10100, 10150, "30M"],
  [14000, 14350, "20M"],
  [18068, 18168, "17M"],
  [21000, 21450, "15M"],
  [24890, 24990, "12M"],
  [28000, 29700, "10M"],
  [50000, 54000, "6M"],
  [70000, 71000, "4M"],
  [144000, 148000, "2M"],
  [222000, 225000, "1.25M"],
  [420000, 450000, "70CM"],
  [902000, 928000, "33CM"],
  [1200000, 1300000, "23CM"],
  [2300000, 2450000, "13CM"],
  [3300000, 3500000, "9CM"],
  [5650000, 5925000, "6CM"],
  [10000000, 10500000, "3CM"],
  [24000000, 24250000, "1.25CM"],
  [47000000, 47200000, "6MM"],
  [75500000, 81000000, "4MM"],
  [119000000, 123000000, "2.5MM"],
  [134000000, 149000000, "2MM"],
  [241000000, 300000000, "1MM"],
];

const REPRESENTATIVE_FREQUENCIES: Record<string, string> = {
  "160M": "1850", "80M": "3550", "60M": "5357", "40M": "7050", "30M": "10120",
  "20M": "14050", "17M": "18100", "15M": "21050", "12M": "24920", "10M": "28050",
  "6M": "50100", "4M": "70200", "2M": "144300", "1.25M": "223500",
  "70CM": "432100", "33CM": "902100", "23CM": "1296100", "13CM": "2304000",
  "9CM": "3400000", "6CM": "5760000", "3CM": "10368000", "1.25CM": "24048000",
  "6MM": "47088000", "4MM": "76032000", "2.5MM": "122250000", "2MM": "142000000", "1MM": "241000000",
};

export function bandFromFrequency(input: string): string {
  const compact = input.trim().toUpperCase();
  if (Object.hasOwn(REPRESENTATIVE_FREQUENCIES, compact)) return compact;
  const gigahertz = compact.match(/^(\d+(?:[.,]\d+)?)G$/);
  let numeric = gigahertz ? Number(gigahertz[1]!.replace(",", ".")) * 1_000_000 : Number(compact.replace(",", "."));
  if (!Number.isFinite(numeric)) return "";
  if (numeric < 1000) numeric *= 1000;
  return BAND_RANGES.find(([low, high]) => numeric >= low && numeric <= high)?.[2] ?? "";
}

export function frequencyToKHz(input: string): string {
  const numeric = Number(input.replace(",", "."));
  if (!Number.isFinite(numeric)) return input.trim().toUpperCase();
  return String(Math.round(numeric < 1000 ? numeric * 1000 : numeric));
}

export function frequencyToMHz(input: string): string {
  const numeric = Number(input.replace(",", "."));
  if (!Number.isFinite(numeric)) return "";
  return (numeric >= 1000 ? numeric / 1000 : numeric).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

export function frequencyFromBand(input: string): string {
  return REPRESENTATIVE_FREQUENCIES[input.trim().toUpperCase()] ?? "";
}

export function normalizeCallsign(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9/]/g, "");
}

export function isPlausibleCallsign(input: string): boolean {
  const call = normalizeCallsign(input);
  if (call.length < 3 || call.length > 15 || !/[A-Z]/.test(call) || !/\d/.test(call)) return false;
  return /^(?:[A-Z0-9]{1,4}\/)?[A-Z0-9]{1,7}(?:\/[A-Z0-9]{1,4})?$/.test(call);
}

export function callsignPrefix(input: string): string {
  const call = normalizeCallsign(input).split("/").sort((a, b) => b.length - a.length)[0] ?? "";
  const match = call.match(/^([A-Z]*\d)[A-Z]*/);
  if (match) return match[1]!;
  const letters = call.match(/^[A-Z]+/)?.[0] ?? call.slice(0, 2);
  return `${letters}0`;
}
