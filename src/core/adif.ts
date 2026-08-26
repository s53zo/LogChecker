import type { AdifDocument, AdifRecord, AdifTag } from "./types";

interface ParsedSegment {
  tags: AdifTag[];
  end: number;
}

function parseTags(source: string, start = 0, stopAt?: "EOH" | "EOR"): ParsedSegment {
  const tags: AdifTag[] = [];
  const marker = /<\s*([A-Z][A-Z0-9_]*)(?::(\d+)(?::([^>]+))?)?\s*>/gi;
  marker.lastIndex = start;
  while (true) {
    const match = marker.exec(source);
    if (!match) return { tags, end: source.length };
    const name = match[1]!.toUpperCase();
    if (name === "EOH" || name === "EOR") {
      if (!stopAt || name === stopAt) return { tags, end: marker.lastIndex };
      continue;
    }
    const length = Number(match[2]);
    if (!Number.isFinite(length)) continue;
    const valueStart = marker.lastIndex;
    const valueEnd = valueStart + length;
    const raw = source.slice(match.index, valueEnd);
    tags.push({ name, value: source.slice(valueStart, valueEnd), type: match[3], raw });
    marker.lastIndex = valueEnd;
  }
}

export function parseAdif(source: string): AdifDocument {
  const eoh = /<\s*EOH\s*>/i.exec(source);
  const headerEnd = eoh ? (eoh.index + eoh[0].length) : 0;
  const headerSegment = eoh ? parseTags(source.slice(0, headerEnd), 0, "EOH") : { tags: [], end: 0 };
  const records: AdifRecord[] = [];
  const recordMarker = /<\s*EOR\s*>/gi;
  recordMarker.lastIndex = headerEnd;
  let recordStart = headerEnd;
  let index = 0;
  while (true) {
    const match = recordMarker.exec(source);
    if (!match) break;
    const end = match.index + match[0].length;
    const original = source.slice(recordStart, end);
    const tags = parseTags(original, 0, "EOR").tags;
    if (tags.length) records.push({ id: `adif-${++index}`, tags, original });
    recordStart = end;
  }
  return {
    format: "adif",
    source,
    header: headerSegment.tags,
    headerOriginal: source.slice(0, headerEnd),
    records,
    newline: source.includes("\r\n") ? "\r\n" : source.includes("\n") ? "\n" : source.includes("\r") ? "\r" : "\n",
    unparsedTail: source.slice(recordStart),
  };
}

export function adifValue(record: AdifRecord, name: string): string {
  return record.tags.find((tag) => tag.name === name.toUpperCase())?.value ?? "";
}

function serializeTag(tag: AdifTag): string {
  return `<${tag.name}:${tag.value.length}${tag.type ? `:${tag.type}` : ""}>${tag.value}`;
}

export function serializeAdif(document: AdifDocument): string {
  if (!document.records.some((record) => record.dirty)) return document.source;
  const header = document.headerOriginal || `<ADIF_VER:5>3.1.6${document.newline}<EOH>`;
  const records = document.records.map((record) => {
    if (!record.dirty) return record.original;
    let output = record.original;
    const changed = new Set(record.changedTags ?? []);
    for (const tag of record.tags.filter((candidate) => changed.has(candidate.name) && candidate.raw)) {
      const index = output.indexOf(tag.raw);
      if (index >= 0) output = `${output.slice(0, index)}${serializeTag(tag)}${output.slice(index + tag.raw.length)}`;
    }
    const additions = record.tags.filter((tag) => changed.has(tag.name) && !tag.raw).map(serializeTag).join(" ");
    if (additions) {
      const marker = /<\s*EOR\s*>/i.exec(output);
      output = marker ? `${output.slice(0, marker.index)}${additions} ${output.slice(marker.index)}` : `${output} ${additions} <EOR>`;
    }
    return output;
  });
  return `${header}${records.join("")}${document.unparsedTail}`;
}

export function updateAdifTag(
  document: AdifDocument,
  recordId: string,
  name: string,
  value: string,
): AdifDocument {
  const normalized = name.toUpperCase();
  return {
    ...document,
    records: document.records.map((record) => {
      if (record.id !== recordId) return record;
      const exists = record.tags.some((tag) => tag.name === normalized);
      const tags = exists
        ? record.tags.map((tag) => tag.name === normalized ? { ...tag, value } : tag)
        : [...record.tags, { name: normalized, value, raw: "" }];
      return { ...record, tags, dirty: true, changedTags: [...new Set([...(record.changedTags ?? []), normalized])] };
    }),
  };
}
