import type { LogDocument } from "./types";
import { parseLike, sourceOfDocument } from "./transformations/engine";
import type { DocumentSelection, TransformationChange, TransformationPreview } from "./transformations/types";

export interface SearchOptions {
  query: string;
  matchCase?: boolean;
  wholeWord?: boolean;
  regularExpression?: boolean;
  direction?: "forward" | "backward";
  wrap?: boolean;
}

export interface SearchMatch {
  start: number;
  end: number;
  value: string;
  lineNumber: number;
  column: number;
}

function safePattern(options: SearchOptions, global = true): RegExp {
  if (!options.query) throw new Error("Enter text to search for.");
  if (options.query.length > 500) throw new Error("The search pattern is too long.");
  if (options.regularExpression && /(?:\([^)]*[+*][^)]*\)|\[[^\]]+\])[+*{]/.test(options.query)) {
    throw new Error("Nested repeating groups are not allowed because they can make the browser unresponsive.");
  }
  const escaped = options.regularExpression ? options.query : options.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const source = options.wholeWord ? `\\b(?:${escaped})\\b` : escaped;
  try {
    return new RegExp(source, `${global ? "g" : ""}${options.matchCase ? "" : "i"}u`);
  } catch (error) {
    throw new Error(`Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function rangesFor(document: LogDocument, selection: DocumentSelection): Array<{ start: number; end: number }> {
  const source = sourceOfDocument(document);
  if (selection.kind === "document") return [{ start: 0, end: source.length }];
  if (selection.kind === "text") return [{ start: Math.max(0, selection.start), end: Math.min(source.length, selection.end) }];
  if (document.format === "cabrillo") {
    const ids = selection.kind === "rows" || selection.kind === "cells" ? selection.ids : selection.ids;
    if (!ids?.length) return [{ start: 0, end: source.length }];
    const selected = new Set(ids);
    const ranges: Array<{ start: number; end: number }> = [];
    let offset = 0;
    for (const line of document.lines) {
      if (selected.has(line.id)) ranges.push({ start: offset, end: offset + line.raw.length });
      offset += line.raw.length + document.newline.length;
    }
    return ranges;
  }
  return [{ start: 0, end: source.length }];
}

function location(source: string, offset: number): { lineNumber: number; column: number } {
  const prior = source.slice(0, offset).split(/\r\n|\r|\n/);
  return { lineNumber: prior.length, column: (prior.at(-1)?.length ?? 0) + 1 };
}

export function findAll(document: LogDocument, selection: DocumentSelection, options: SearchOptions): SearchMatch[] {
  const source = sourceOfDocument(document);
  const regex = safePattern(options);
  const matches: SearchMatch[] = [];
  for (const range of rangesFor(document, selection)) {
    const segment = source.slice(range.start, range.end);
    regex.lastIndex = 0;
    while (true) {
      const match = regex.exec(segment);
      if (!match) break;
      const start = range.start + match.index;
      const position = location(source, start);
      matches.push({ start, end: start + match[0].length, value: match[0], ...position });
      if (!match[0].length) regex.lastIndex += 1;
      if (matches.length >= 20_000) throw new Error("Search stopped after 20,000 matches. Narrow the search or selection.");
    }
  }
  return options.direction === "backward" ? matches.reverse() : matches;
}

export function replaceAll(
  document: LogDocument,
  selection: DocumentSelection,
  options: SearchOptions,
  replacement: string,
): TransformationPreview {
  const matches = findAll(document, selection, { ...options, direction: "forward" });
  let source = sourceOfDocument(document);
  const single = safePattern(options, false);
  const changes: TransformationChange[] = [];
  for (const match of [...matches].reverse()) {
    const after = options.regularExpression ? match.value.replace(single, replacement) : replacement;
    source = `${source.slice(0, match.start)}${after}${source.slice(match.end)}`;
    changes.unshift({ targetId: `text-${match.start}`, lineNumber: match.lineNumber, before: match.value, after, description: "Replace matching text" });
  }
  return {
    operationId: "replace-all",
    label: "Replace matching text",
    before: document,
    after: parseLike(document, source),
    changes,
    warnings: [],
    lossy: matches.length > 0,
  };
}

export function replaceOne(document: LogDocument, match: SearchMatch, options: SearchOptions, replacement: string): TransformationPreview {
  const source = sourceOfDocument(document);
  if (match.start < 0 || match.end > source.length || source.slice(match.start, match.end) !== match.value) {
    throw new Error("The selected search match is stale. Run the search again.");
  }
  const afterValue = options.regularExpression ? match.value.replace(safePattern(options, false), replacement) : replacement;
  const afterSource = `${source.slice(0, match.start)}${afterValue}${source.slice(match.end)}`;
  return {
    operationId: "replace-next",
    label: "Replace selected match",
    before: document,
    after: parseLike(document, afterSource),
    changes: [{ targetId: `text-${match.start}`, lineNumber: match.lineNumber, before: match.value, after: afterValue, description: "Replace selected match" }],
    warnings: [],
    lossy: true,
  };
}

export function nextMatchIndex(matches: readonly SearchMatch[], current: number, direction: "forward" | "backward", wrap = true): number {
  if (!matches.length) return -1;
  const next = current + (direction === "backward" ? -1 : 1);
  if (next >= 0 && next < matches.length) return next;
  if (!wrap) return Math.max(0, Math.min(matches.length - 1, current));
  return direction === "backward" ? matches.length - 1 : 0;
}
