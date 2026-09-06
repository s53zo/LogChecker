import type { AdifDocument, AdifRecord, AdifTag } from "./types";
import { assertImportSource, assertImportSize, IMPORT_MAX_CELLS } from './import-limits';

export function isXmlCharacter(code: number): boolean {
  return code === 9 || code === 10 || code === 13 || (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff);
}

function decodeXml(value: string): string {
  return value.replace(/&([^;\s<&]*);?|&/g, (raw: string, entity: string) => {
    const named: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };
    if (!raw.endsWith(';')) throw new Error('Malformed XML entity reference.');
    if (Object.hasOwn(named, entity)) return named[entity]!;
    const code = /^#x[0-9a-f]+$/i.test(entity) ? Number.parseInt(entity.slice(2), 16) : /^#\d+$/.test(entity) ? Number(entity.slice(1)) : -1;
    if (!isXmlCharacter(code)) throw new Error('Unknown or invalid XML entity reference.');
    return String.fromCodePoint(code);
  });
}

function encodeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;").replaceAll("'", "&apos;");
}

function localName(name: string): string { return name.split(":").at(-1)!.toUpperCase(); }

interface XmlNode { name: string; attributes: Record<string,string>; children: XmlNode[]; text: string; start: number; end: number; }

/** Bounded XML tokenization with exact nesting, quoted attributes and entity validation. */
function readXml(source: string): XmlNode {
  assertImportSource(source);
  for (const char of source) if (!isXmlCharacter(char.codePointAt(0)!)) throw new Error('XML contains an invalid character.');
  const stack: XmlNode[] = []; let root: XmlNode | undefined; let i = source.charCodeAt(0) === 0xfeff ? 1 : 0; let nodes = 0;
  const appendText = (value: string) => { if (stack.length) stack.at(-1)!.text += value; else if (value.trim()) throw new Error('XML text outside the root element.'); };
  while (i < source.length) {
    if (source[i] !== '<') { const end = source.indexOf('<', i); const text = source.slice(i, end < 0 ? source.length : end); if (text.includes(']]>')) throw new Error('Unexpected XML CDATA terminator.'); appendText(decodeXml(text)); i = end < 0 ? source.length : end; continue; }
    if (source.startsWith('<!--', i)) { const end = source.indexOf('-->', i + 4); if (end < 0 || source.slice(i + 4, end).includes('--') || source[end - 1] === '-') throw new Error('Malformed XML comment.'); i = end + 3; continue; }
    if (source.startsWith('<![CDATA[', i)) { const end = source.indexOf(']]>', i + 9); if (end < 0 || !stack.length) throw new Error('Malformed XML CDATA.'); appendText(source.slice(i + 9, end)); i = end + 3; continue; }
    if (source.startsWith('<?', i)) { const end = source.indexOf('?>', i + 2); const body = source.slice(i + 2, end); if (end < 0 || !/^[A-Za-z_][\w.:-]*(?:\s|$)/.test(body)) throw new Error('Malformed XML processing instruction.'); if (/^xml(?:\s|$)/i.test(body) && (i > (source.charCodeAt(0) === 0xfeff ? 1 : 0) || !/^xml\s+version\s*=\s*(['"])1\.0\1(?:\s+encoding\s*=\s*(['"])[A-Za-z][A-Za-z0-9._-]*\2)?(?:\s+standalone\s*=\s*(['"])(?:yes|no)\3)?\s*$/.test(body))) throw new Error('Invalid XML declaration.'); i = end + 2; continue; }
    if (source.startsWith('<!', i)) throw new Error('XML DTD or other declarations are not supported.');
    let end = i + 1, quote = '';
    for (; end < source.length; end++) { const ch = source[end]!; if (quote) { if (ch === quote) quote = ''; } else if (ch === '"' || ch === "'") quote = ch; else if (ch === '>') break; else if (ch === '<') throw new Error('Malformed XML tag.'); }
    if (end === source.length || quote) throw new Error('Unterminated XML tag.');
    const token = source.slice(i + 1, end);
    if (token.startsWith('/')) { const match = /^\/([A-Za-z_][\w.:-]*)\s*$/.exec(token); const node = stack.pop(); if (!match || !node || node.name !== match[1]) throw new Error('Mismatched XML closing tag.'); node.end = end + 1; }
    else {
      const match = /^([A-Za-z_][\w.:-]*)/.exec(token); if (!match) throw new Error('Invalid XML element name.');
      const selfClosing = token.endsWith('/'); const rest = token.slice(match[0].length, selfClosing ? -1 : undefined); const attributes: Record<string,string> = Object.create(null) as Record<string,string>; let cursor = 0;
      while (cursor < rest.length) { const attribute = /^\s+([A-Za-z_][\w.:-]*)\s*=\s*(["'])([^]*?)\2/.exec(rest.slice(cursor)); if (!attribute) { if (rest.slice(cursor).trim()) throw new Error('Malformed XML attribute.'); break; } const name = attribute[1]!; if (Object.hasOwn(attributes, name) || attribute[3]!.includes('<')) throw new Error('Duplicate or invalid XML attribute.'); attributes[name] = decodeXml(attribute[3]!); cursor += attribute[0].length; }
      const node: XmlNode = { name: match[1]!, attributes, children: [], text: '', start: i, end: end + 1 };
      if (++nodes > IMPORT_MAX_CELLS) throw new Error('XML node limit exceeded.');
      if (stack.length) stack.at(-1)!.children.push(node); else { if (root) throw new Error('XML has multiple root elements.'); root = node; }
      if (!selfClosing) { stack.push(node); if (stack.length > 64) throw new Error('XML nesting limit exceeded.'); }
    }
    i = end + 1;
  }
  if (stack.length || !root) throw new Error('Incomplete XML document.');
  return root;
}

export function assertXmlWellFormed(source: string): void { readXml(source); }

function tagsFromNode(node: XmlNode, source: string): AdifTag[] {
  if (node.text.trim()) throw new Error('Unexpected text in ADX container.');
  return node.children.map(child => {
    if (child.children.length) throw new Error('Nested ADX field content is unsupported; preserve and repair the source.');
    let name = localName(child.name);
    const attrs = Object.fromEntries(Object.entries(child.attributes).map(([key,value]) => [key.toUpperCase(), value]));
    if (name === 'APP' && attrs.PROGRAMID && attrs.FIELDNAME) name = `APP_${attrs.PROGRAMID}_${attrs.FIELDNAME}`.toUpperCase();
    if (name === 'USERDEF' && attrs.FIELDNAME) name = `USERDEF_${attrs.FIELDNAME}`.toUpperCase();
    return { name, value: child.text, type: attrs.TYPE, raw: source.slice(child.start, child.end) };
  });
}

export function parseAdx(source: string): AdifDocument {
  const root = readXml(source);
  if (localName(root.name) !== 'ADX') throw new Error('The XML document has no ADX root element.');
  if (root.text.trim() || root.children.some(node => !['HEADER','RECORDS'].includes(localName(node.name)))) throw new Error('Unsupported content in ADX root.');
  const headers = root.children.filter(node => localName(node.name) === 'HEADER');
  const containers = root.children.filter(node => localName(node.name) === 'RECORDS');
  if (headers.length > 1 || containers.length !== 1) throw new Error('ADX requires one RECORDS container and at most one HEADER.');
  const recordsBlock = containers[0]!;
  if (recordsBlock.text.trim() || recordsBlock.children.some(node => localName(node.name) !== 'RECORD')) throw new Error('Unsupported content in ADX RECORDS container.');
  assertImportSize(recordsBlock.children.length, 1);
  const records: AdifRecord[] = [];
  for (const node of recordsBlock.children) records.push({ id: `adif-${records.length + 1}`, tags: tagsFromNode(node, source), original: source.slice(node.start,node.end) });
  const header = headers[0];
  return { format: "adif", container: "adx", source, header: header ? tagsFromNode(header, source) : [], headerOriginal: header ? source.slice(header.start,header.end) : '', records, newline: source.includes("\r\n") ? "\r\n" : "\n", unparsedTail: "", parseWarnings: [] };
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
  const output = `<?xml version="1.0" encoding="UTF-8"?>${nl}<ADX>${nl}  <HEADER>${nl}${header.map((tag) => xmlTag(tag, "    ")).join(nl)}${nl}  </HEADER>${nl}  <RECORDS>${nl}${document.records.map((record) => `    <RECORD>${nl}${record.tags.map((tag) => xmlTag(tag, "      ")).join(nl)}${nl}    </RECORD>`).join(nl)}${nl}  </RECORDS>${nl}</ADX>${nl}`;
  assertXmlWellFormed(output);
  return output;
}

export function adxToAdifDocument(document: AdifDocument): AdifDocument {
  return { ...document, container: "adi", source: "", headerOriginal: "", records: document.records.map((record) => ({ ...record, original: "", dirty: true, changedTags: record.tags.map((tag) => tag.name) })) };
}
