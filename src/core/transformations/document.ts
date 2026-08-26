import type { LogDocument } from "../types";
import { parseLike, sourceOfDocument } from "./engine";
import type { TransformationChange, TransformationCommand } from "./types";
import { cleanUnsafeWhitespace } from "./values";

export function createLineEndingCommand<TDocument extends LogDocument>(newline: "\n" | "\r\n" | "\r"): TransformationCommand<TDocument> {
  return {
    id: "change-line-endings",
    label: newline === "\r\n" ? "Use CRLF line endings" : newline === "\r" ? "Use CR line endings" : "Use LF line endings",
    execute(document) {
      const beforeSource = sourceOfDocument(document);
      const afterSource = beforeSource.replace(/\r\n|\r|\n/g, newline);
      const changes: TransformationChange[] = beforeSource === afterSource ? [] : [{ targetId: "document", before: "Current line endings", after: this.label, description: "Change line endings" }];
      return { operationId: this.id, label: this.label, before: document, after: parseLike(document, afterSource), changes, warnings: [], lossy: false };
    },
  };
}

export const cleanUnsafeWhitespaceCommand: TransformationCommand = {
  id: "clean-unsafe-whitespace",
  label: "Replace unsafe whitespace and control characters",
  execute(document) {
    const beforeSource = sourceOfDocument(document);
    const afterSource = cleanUnsafeWhitespace(beforeSource);
    const changes: TransformationChange[] = [];
    let replacements = 0;
    for (let index = 0; index < Math.min(beforeSource.length, afterSource.length); index += 1) {
      if (beforeSource[index] !== afterSource[index]) replacements += 1;
    }
    if (replacements) changes.push({ targetId: "document", before: `${replacements} unsafe character${replacements === 1 ? "" : "s"}`, after: `${replacements} space${replacements === 1 ? "" : "s"}`, description: "Replace unsafe nonprinting characters" });
    return { operationId: this.id, label: this.label, before: document, after: parseLike(document, afterSource), changes, warnings: [], lossy: replacements > 0 };
  },
};

