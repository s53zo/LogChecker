import type { AdifDocument, AdifRecord, AdifTag } from "./types";

function decodeXml(value: string): string {
  return value.replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", "\"").replaceAll("&apos;", "'").replaceAll("&amp;", "&");
}

function encodeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;").replaceAll("'", "&apos;");
}

function localName(name: string): string { return name.split(":").at(-1)!.toUpperCase(); }

function tagsFromXml(source: string): AdifTag[] {
  const tags: AdifTag[] = [];
  const element = /<([A-Za-z_][\w.:-]*)([^>]*)>([\s\S]*?)<\/\1\s*>/g;
  for (const match of source.matchAll(element)) {
    let name = localName(match[1]!);
    if (["ADX", "HEADER", "RECORDS", "RECORD"].includes(name)) continue;
    if (/<[A-Za-z_]/.test(match[3]!)) continue;
    const type = /\bTYPE\s*=\s*["']([^"']+)["']/i.exec(match[2]!)?.[1];
    if (name === "APP") { const program = /\bPROGRAMID\s*=\s*["']([^"']+)["']/i.exec(match[2]!)?.[1]; const field = /\bFIELDNAME\s*=\s*["']([^"']+)["']/i.exec(match[2]!)?.[1]; if (program && field) name = `APP_${program}_${field}`.toUpperCase(); }
    if (name === "USERDEF") { const field = /\bFIELDNAME\s*=\s*["']([^"']+)["']/i.exec(match[2]!)?.[1]; if (field) name = `USERDEF_${field}`.toUpperCase(); }
    tags.push({ name, value: decodeXml(match[3]!), type, raw: match[0] });
  }
  return tags;
}

export function parseAdx(source: string): AdifDocument {
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) throw new Error("ADX with DTD or entity declarations is not accepted for safety.");
  const root = /<(?:[\w.-]+:)?ADX\b/i.test(source);
  if (!root) throw new Error("The XML document has no ADX root element.");
  const headerMatch = /<(?:[\w.-]+:)?HEADER\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?HEADER\s*>/i.exec(source);
  const recordsBlock = /<(?:[\w.-]+:)?RECORDS\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?RECORDS\s*>/i.exec(source);
  const records: AdifRecord[] = [];
  if (recordsBlock) {
    const recordPattern = /<(?:[\w.-]+:)?RECORD\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?RECORD\s*>/gi;
    let index = 0;
    for (const match of recordsBlock[1]!.matchAll(recordPattern)) {
      records.push({ id: `adif-${++index}`, tags: tagsFromXml(match[1]!), original: match[0] });
    }
  }
  const warnings: string[] = [];
  if (!recordsBlock) warnings.push("ADX RECORDS container is missing or malformed.");
  return { format: "adif", container: "adx", source, header: tagsFromXml(headerMatch?.[1] ?? ""), headerOriginal: headerMatch?.[0] ?? "", records, newline: source.includes("\r\n") ? "\r\n" : "\n", unparsedTail: "", parseWarnings: warnings };
}

function xmlTag(tag: AdifTag, indent: string): string {
  const app = /^APP_([^_]+)_(.+)$/.exec(tag.name);
  if (app) return `${indent}<APP PROGRAMID="${encodeXml(app[1]!)}" FIELDNAME="${encodeXml(app[2]!)}"${tag.type ? ` TYPE="${encodeXml(tag.type)}"` : ""}>${encodeXml(tag.value)}</APP>`;
  const userdef = /^USERDEF_(.+)$/.exec(tag.name);
  if (userdef) return `${indent}<USERDEF FIELDNAME="${encodeXml(userdef[1]!)}"${tag.type ? ` TYPE="${encodeXml(tag.type)}"` : ""}>${encodeXml(tag.value)}</USERDEF>`;
  return `${indent}<${tag.name}>${encodeXml(tag.value)}</${tag.name}>`;
}

export function serializeAdx(document: AdifDocument): string {
  const nl = document.newline === "\r" ? "\n" : document.newline;
  const header = document.header.some((tag) => tag.name === "ADIF_VER") ? document.header.map((tag) => tag.name === "ADIF_VER" ? { ...tag, value: "3.1.7" } : tag) : [{ name: "ADIF_VER", value: "3.1.7", raw: "" }, ...document.header];
  return `<?xml version="1.0" encoding="UTF-8"?>${nl}<ADX>${nl}  <HEADER>${nl}${header.map((tag) => xmlTag(tag, "    ")).join(nl)}${nl}  </HEADER>${nl}  <RECORDS>${nl}${document.records.map((record) => `    <RECORD>${nl}${record.tags.map((tag) => xmlTag(tag, "      ")).join(nl)}${nl}    </RECORD>`).join(nl)}${nl}  </RECORDS>${nl}</ADX>${nl}`;
}

export function adxToAdifDocument(document: AdifDocument): AdifDocument {
  return { ...document, container: "adi", source: "", headerOriginal: "", records: document.records.map((record) => ({ ...record, original: "", dirty: true, changedTags: record.tags.map((tag) => tag.name) })) };
}
