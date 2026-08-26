import { parseAdif, serializeAdif } from "../adif";
import { parseCabrillo, serializeCabrillo } from "../cabrillo";
import { parseEdi, serializeEdi } from "../edi";
import type { LogDocument } from "../types";
import type { DocumentSelection, TransformationCommand, TransformationPreview } from "./types";

export function sourceOfDocument(document: LogDocument): string {
  if (document.format === "cabrillo") return serializeCabrillo(document);
  if (document.format === "adif") return serializeAdif(document);
  if (document.format === "edi") return serializeEdi(document);
  return document.source;
}

export function parseLike<TDocument extends LogDocument>(document: TDocument, source: string): TDocument {
  if (document.format === "cabrillo") return parseCabrillo(source) as TDocument;
  if (document.format === "adif") return parseAdif(source) as TDocument;
  if (document.format === "edi") return parseEdi(source) as TDocument;
  return { format: "text", source } as TDocument;
}

export function previewTransformation<TDocument extends LogDocument>(
  document: TDocument,
  selection: DocumentSelection,
  command: TransformationCommand<TDocument>,
): TransformationPreview<TDocument> {
  return command.execute(document, selection);
}

export function applyTransformation<TDocument extends LogDocument>(preview: TransformationPreview<TDocument>): TDocument {
  return preview.after;
}

export function revertTransformation<TDocument extends LogDocument>(preview: TransformationPreview<TDocument>): TDocument {
  return preview.before;
}
