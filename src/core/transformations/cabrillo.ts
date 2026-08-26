import { parseCabrillo, serializeCabrillo, updateQsoCell } from "../cabrillo";
import type { CabrilloDocument, CabrilloLine } from "../types";
import type { DocumentSelection, TransformationChange, TransformationCommand, TransformationPreview } from "./types";
import { selectionIncludes } from "./types";
import { convertDateValue, convertFrequencyValue, convertTimeValue, modeToCabrillo, normalizeSerialValue, shiftDateTime, type DateFormat, type TimeFormat } from "./values";

function preview(
  id: string,
  label: string,
  before: CabrilloDocument,
  after: CabrilloDocument,
  changes: TransformationChange[],
  warnings: string[] = [],
  lossy = false,
): TransformationPreview<CabrilloDocument> {
  return { operationId: id, label, before, after, changes, warnings, lossy };
}

function selectedQsoLines(document: CabrilloDocument, selection: DocumentSelection): CabrilloLine[] {
  return document.lines.filter((line) => line.qso && selectionIncludes(selection, line.id));
}

export function createShiftQsoTimeCommand(minutes: number): TransformationCommand<CabrilloDocument> {
  return {
    id: "shift-qso-time",
    label: `${minutes < 0 ? "Subtract" : "Add"} ${Math.abs(minutes)} minutes`,
    execute(document, selection) {
      let after = document;
      const changes: TransformationChange[] = [];
      const warnings: string[] = [];
      for (const line of selectedQsoLines(document, selection)) {
        const shifted = shiftDateTime(line.qso!.date, line.qso!.time, minutes);
        if (!shifted) {
          warnings.push(`Line ${line.lineNumber}: invalid date or time was not changed.`);
          continue;
        }
        if (shifted.date !== line.qso!.date) {
          changes.push({ targetId: line.id, lineNumber: line.lineNumber, field: "QSO_DATE", before: line.qso!.date, after: shifted.date, description: "Shift QSO date" });
          after = updateQsoCell(after, line.id, "QSO_DATE", shifted.date);
        }
        if (shifted.time !== line.qso!.time) {
          changes.push({ targetId: line.id, lineNumber: line.lineNumber, field: "TIME_ON", before: line.qso!.time, after: shifted.time, description: "Shift QSO time" });
          after = updateQsoCell(after, line.id, "TIME_ON", shifted.time);
        }
      }
      return preview(this.id, this.label, document, after, changes, warnings);
    },
  };
}

export function createConvertModeCommand(from: string, to: string, overrides: Record<string, string> = {}): TransformationCommand<CabrilloDocument> {
  const sourceMode = modeToCabrillo(from);
  const targetMode = modeToCabrillo(to, overrides);
  return {
    id: "convert-mode",
    label: `Convert mode ${sourceMode} to ${targetMode}`,
    execute(document, selection) {
      let after = document;
      const changes: TransformationChange[] = [];
      for (const line of selectedQsoLines(document, selection)) {
        if (line.qso!.mode.toUpperCase() !== sourceMode) continue;
        changes.push({ targetId: line.id, lineNumber: line.lineNumber, field: "MODE", before: line.qso!.mode, after: targetMode, description: "Convert mode" });
        after = updateQsoCell(after, line.id, "MODE", targetMode);
      }
      return preview(this.id, this.label, document, after, changes);
    },
  };
}

export function createNormalizeModesCommand(overrides: Record<string, string> = {}): TransformationCommand<CabrilloDocument> {
  return {
    id: "normalize-modes",
    label: "Normalize modes with built-in and local mappings",
    execute(document, selection) {
      let after = document;
      const changes: TransformationChange[] = [];
      for (const line of selectedQsoLines(document, selection)) {
        const target = modeToCabrillo(line.qso!.mode, overrides);
        if (!target || target === line.qso!.mode) continue;
        changes.push({ targetId: line.id, lineNumber: line.lineNumber, field: "MODE", before: line.qso!.mode, after: target, description: "Normalize mode" });
        after = updateQsoCell(after, line.id, "MODE", target);
      }
      return preview(this.id, this.label, document, after, changes);
    },
  };
}

export function createNormalizeSerialCommand(field: string, width: number): TransformationCommand<CabrilloDocument> {
  return {
    id: "normalize-serial",
    label: `Normalize ${field} to ${width} digits`,
    execute(document, selection) {
      let after = document;
      const changes: TransformationChange[] = [];
      const warnings: string[] = [];
      for (const line of selectedQsoLines(document, selection)) {
        if (!selectionIncludes(selection, line.id, field)) continue;
        const cell = line.qso!.cells.find((candidate) => candidate.key === field);
        if (!cell) {
          warnings.push(`Line ${line.lineNumber}: ${field} is not present in this layout.`);
          continue;
        }
        const value = normalizeSerialValue(cell.value, width);
        if (value === null) {
          warnings.push(`Line ${line.lineNumber}: “${cell.value}” is not a serial number.`);
          continue;
        }
        if (value === cell.value) continue;
        changes.push({ targetId: line.id, lineNumber: line.lineNumber, field, before: cell.value, after: value, description: "Normalize serial number" });
        after = updateQsoCell(after, line.id, field, value);
      }
      return preview(this.id, this.label, document, after, changes, warnings);
    },
  };
}

export function createSequentialSerialCommand(field: string, start = 1, width = 3): TransformationCommand<CabrilloDocument> {
  return {
    id: "sequential-serial",
    label: `Fill ${field} with sequential serial numbers`,
    execute(document, selection) {
      let after = document;
      const changes: TransformationChange[] = [];
      const warnings: string[] = [];
      let serial = start;
      for (const line of selectedQsoLines(document, selection)) {
        if (!selectionIncludes(selection, line.id, field)) continue;
        const cell = line.qso!.cells.find((candidate) => candidate.key === field);
        if (!cell) {
          warnings.push(`Line ${line.lineNumber}: ${field} is not present in this layout.`);
          continue;
        }
        const value = String(serial++).padStart(width, "0");
        if (value === cell.value) continue;
        changes.push({ targetId: line.id, lineNumber: line.lineNumber, field, before: cell.value, after: value, description: "Assign sequential serial number" });
        after = updateQsoCell(after, line.id, field, value);
      }
      return preview(this.id, this.label, document, after, changes, warnings);
    },
  };
}

export function createConvertFieldCommand(
  field: string,
  label: string,
  convert: (value: string) => string | null,
  options: { lossy?: boolean; warning?: string } = {},
): TransformationCommand<CabrilloDocument> {
  return {
    id: `convert-${field.toLowerCase()}`,
    label,
    execute(document, selection) {
      let after = document;
      const changes: TransformationChange[] = [];
      const warnings: string[] = options.warning ? [options.warning] : [];
      for (const line of selectedQsoLines(document, selection)) {
        if (!selectionIncludes(selection, line.id, field)) continue;
        const cell = line.qso!.cells.find((candidate) => candidate.key === field);
        if (!cell) continue;
        const value = convert(cell.value);
        if (value === null || value === "") {
          warnings.push(`Line ${line.lineNumber}: “${cell.value}” could not be converted and was left unchanged.`);
          continue;
        }
        if (value === cell.value) continue;
        changes.push({ targetId: line.id, lineNumber: line.lineNumber, field, before: cell.value, after: value, description: label });
        after = updateQsoCell(after, line.id, field, value);
      }
      return preview(this.id, this.label, document, after, changes, warnings, options.lossy && changes.length > 0);
    },
  };
}

export const createConvertDateCommand = (field: string, from: DateFormat) =>
  createConvertFieldCommand(field, `Convert ${field} from ${from}`, (value) => convertDateValue(value, from, "YYYY-MM-DD"));

export const createConvertTimeCommand = (field: string, from: TimeFormat, to: TimeFormat) =>
  createConvertFieldCommand(field, `Convert ${field} from ${from} to ${to}`, (value) => convertTimeValue(value, from, to), { lossy: from === "HHMMSS" && to !== "HHMMSS", warning: from === "HHMMSS" && to !== "HHMMSS" ? "Seconds are removed by this conversion." : undefined });

export const createConvertFrequencyCommand = (field: string, direction: "KHZ_TO_MHZ" | "MHZ_TO_KHZ" | "FREQ_TO_BAND" | "BAND_TO_FREQ") =>
  createConvertFieldCommand(field, `Convert ${field}: ${direction.replaceAll("_", " ").toLowerCase()}`, (value) => convertFrequencyValue(value, direction), { lossy: direction === "BAND_TO_FREQ", warning: direction === "BAND_TO_FREQ" ? "The generated frequency is a representative value inferred from the band." : undefined });

export const sortQsoChronologicallyCommand: TransformationCommand<CabrilloDocument> = {
  id: "sort-qso-chronologically",
  label: "Sort QSO lines chronologically",
  execute(document, selection) {
    const selectedIndexes = document.lines
      .map((line, index) => line.qso && selectionIncludes(selection, line.id) ? index : -1)
      .filter((index) => index >= 0);
    const sorted = selectedIndexes
      .map((index) => document.lines[index]!)
      .sort((left, right) => `${left.qso!.date}${left.qso!.time}`.localeCompare(`${right.qso!.date}${right.qso!.time}`));
    const lines = document.lines.map((line) => ({ ...line }));
    const changes: TransformationChange[] = [];
    selectedIndexes.forEach((index, position) => {
      const beforeLine = document.lines[index]!;
      const afterLine = sorted[position]!;
      lines[index] = { ...afterLine, lineNumber: index + 1 };
      if (beforeLine.id !== afterLine.id) changes.push({ targetId: beforeLine.id, lineNumber: index + 1, before: beforeLine.raw, after: afterLine.raw, description: "Move QSO into chronological order" });
    });
    const source = lines.map((line) => line.raw).join(document.newline) + (document.trailingNewline ? document.newline : "");
    return preview(this.id, this.label, document, parseCabrillo(source), changes);
  },
};

export const addFooterCommand: TransformationCommand<CabrilloDocument> = {
  id: "add-footer",
  label: "Add END-OF-LOG",
  execute(document) {
    if (document.lines.some((line) => line.key === "END-OF-LOG")) return preview(this.id, this.label, document, document, []);
    const source = `${serializeCabrillo(document).replace(/(?:\r\n|\n|\r)*$/, "")}${document.newline}END-OF-LOG:${document.trailingNewline ? document.newline : ""}`;
    return preview(this.id, this.label, document, parseCabrillo(source), [{ targetId: "document-footer", before: "", after: "END-OF-LOG:", description: "Add Cabrillo footer" }]);
  },
};

export const removeFooterCommand: TransformationCommand<CabrilloDocument> = {
  id: "remove-footer",
  label: "Remove END-OF-LOG",
  execute(document) {
    const footerLines = document.lines.filter((line) => line.key === "END-OF-LOG");
    if (!footerLines.length) return preview(this.id, this.label, document, document, []);
    const source = document.lines.filter((line) => line.key !== "END-OF-LOG").map((line) => line.raw).join(document.newline) + (document.trailingNewline ? document.newline : "");
    const changes = footerLines.map((line) => ({ targetId: line.id, lineNumber: line.lineNumber, before: line.raw, after: "", description: "Remove Cabrillo footer" }));
    return preview(this.id, this.label, document, parseCabrillo(source), changes);
  },
};
