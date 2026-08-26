import { isPlausibleCallsign, normalizeCallsign } from "./radio";

const PORTABLE_SUFFIXES = new Set(["A", "AM", "M", "MM", "P", "QRP", "QRPP", "R"]);

function baseCallsign(input: string): string {
  const call = normalizeCallsign(input);
  const parts = call.split("/").filter(Boolean);
  if (parts.length < 2) return call;
  if (PORTABLE_SUFFIXES.has(parts.at(-1)!)) return parts[0]!;
  return parts.reduce((best, part) => part.length > best.length ? part : best, "");
}

export class CallsignDatabase {
  private calls = new Set<string>();
  private sorted: string[] = [];
  private byLength = new Map<number, string[]>();

  private replace(values: Iterable<string>): number {
    const calls = new Set<string>();
    for (const value of values) {
      const call = normalizeCallsign(value);
      if (!isPlausibleCallsign(call)) continue;
      calls.add(call);
      const base = baseCallsign(call);
      if (base && isPlausibleCallsign(base)) calls.add(base);
    }
    // A malformed or unrelated file must not silently replace a working local
    // callbook. Explicit clearing remains available through clear().
    if (!calls.size) return 0;
    this.calls = calls;
    this.sorted = [...this.calls].sort();
    this.byLength = new Map();
    for (const call of this.sorted) {
      const bucket = this.byLength.get(call.length) ?? [];
      bucket.push(call);
      this.byLength.set(call.length, bucket);
    }
    return this.calls.size;
  }

  load(source: string): number {
    return this.replace(
      source
        .split(/[\0\s,;]+/),
    );
  }

  loadBuffer(buffer: ArrayBuffer): number {
    const bytes = new Uint8Array(buffer);
    const nulRatio = bytes.reduce((count, byte) => count + (byte === 0 ? 1 : 0), 0) / Math.max(bytes.length, 1);
    const declaredOffset = bytes.length >= 4 ? new DataView(buffer).getUint32(0, true) : 0;
    const hasBinaryHeader = declaredOffset >= 4 && declaredOffset < bytes.length;
    if (nulRatio < 0.01 && !hasBinaryHeader) return this.load(new TextDecoder("utf-8").decode(bytes));
    // Legacy MASTER.DTA files begin with a little-endian offset to the first
    // NUL-delimited callsign. Honour it when valid so binary index bytes can
    // never be mistaken for callsigns. Some variants omit this header, hence
    // the conservative fallback to scanning the complete buffer.
    const payload = hasBinaryHeader
      ? bytes.subarray(declaredOffset)
      : bytes;
    const text = new TextDecoder("windows-1252").decode(payload);
    const values: string[] = [];
    const marker = /(?:^|\0)([A-Z0-9][A-Z0-9/]{2,14})(?=\0|$)/g;
    while (true) {
      const match = marker.exec(text);
      if (!match) break;
      const candidate = match[1]!;
      if (/[A-Z]/.test(candidate) && /\d/.test(candidate)) values.push(candidate);
    }
    // Some MASTER.DTA variants have a valid binary index but a packed payload
    // without consistent NUL delimiters. A conservative Latin-1 token scan is
    // useful as a fallback; replace() still applies the callsign grammar.
    if (values.length < 1_000) {
      const fallback = /[A-Z0-9/]{3,15}/g;
      while (true) {
        const match = fallback.exec(text);
        if (!match) break;
        if (/[A-Z]/.test(match[0]) && /\d/.test(match[0])) values.push(match[0]);
      }
    }
    return this.replace(values);
  }

  has(call: string): boolean {
    const normalized = normalizeCallsign(call);
    return this.calls.has(normalized) || this.calls.has(baseCallsign(normalized));
  }

  clear(): void {
    this.calls.clear();
    this.sorted = [];
    this.byLength.clear();
  }

  suggestions(partial: string, limit = 8): string[] {
    const needle = normalizeCallsign(partial);
    if (!needle) return [];
    let low = 0;
    let high = this.sorted.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.sorted[middle]! < needle) low = middle + 1;
      else high = middle;
    }
    const matches: string[] = [];
    for (let index = low; index < this.sorted.length && matches.length < limit; index += 1) {
      const call = this.sorted[index]!;
      if (!call.startsWith(needle)) break;
      matches.push(call);
    }
    return matches;
  }

  correctionSuggestions(input: string, limit = 5): string[] {
    const target = baseCallsign(input);
    if (!isPlausibleCallsign(target) || this.calls.has(target)) return [];
    const matches: string[] = [];
    for (const call of this.byLength.get(target.length) ?? []) {
      let differences = 0;
      for (let index = 0; index < target.length && differences <= 1; index += 1) {
        if (target[index] !== call[index]) differences += 1;
      }
      if (differences === 1) matches.push(call);
      if (matches.length >= limit) break;
    }
    return matches;
  }

  get size(): number {
    return this.calls.size;
  }
}
