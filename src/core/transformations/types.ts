import type { LogDocument } from "../types";

export type DocumentSelection =
  | { kind: "document" }
  | { kind: "rows"; ids: readonly string[] }
  | { kind: "fields"; fields: readonly string[]; ids?: readonly string[] }
  | { kind: "cells"; ids: readonly string[]; fields: readonly string[] }
  | { kind: "text"; start: number; end: number };

export interface TransformationChange {
  targetId: string;
  lineNumber?: number;
  field?: string;
  before: string;
  after: string;
  description: string;
}

export interface TransformationPreview<TDocument extends LogDocument = LogDocument> {
  operationId: string;
  label: string;
  before: TDocument;
  after: TDocument;
  changes: TransformationChange[];
  warnings: string[];
  lossy: boolean;
}

export interface TransformationCommand<TDocument extends LogDocument = LogDocument> {
  id: string;
  label: string;
  execute(document: TDocument, selection: DocumentSelection): TransformationPreview<TDocument>;
}

export function selectionIncludes(
  selection: DocumentSelection,
  id: string,
  field?: string,
): boolean {
  if (selection.kind === "document" || selection.kind === "text") return true;
  if (selection.kind === "rows") return selection.ids.includes(id);
  const rowMatches = !selection.ids || selection.ids.includes(id);
  return rowMatches && (!field || selection.fields.includes(field));
}

