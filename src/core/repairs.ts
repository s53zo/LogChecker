import { formatQso, isFixedWidthQso, parseCabrillo, parseQsoLine } from "./cabrillo";
import { cabrilloModeMap, deprecatedModeMap } from "./templates";
import { frequencyToKHz } from "./radio";
import type { CabrilloDocument, RepairChange } from "./types";

function expandTabs(value: string): string {
  let column = 0;
  let result = "";
  for (const char of value) {
    if (char === "\t") {
      const spaces = 8 - (column % 8);
      result += " ".repeat(spaces);
      column += spaces;
    } else {
      result += char;
      column += 1;
    }
  }
  return result;
}

export function previewCabrilloRepairs(document: CabrilloDocument): RepairChange[] {
  const changes: RepairChange[] = [];
  for (const line of document.lines) {
    let after = line.raw.replace(/[ \t]+$/g, "");
    const reasons: string[] = [];
    if (after.includes("\t")) {
      after = expandTabs(after);
      reasons.push("Expand tabs to fixed-width spaces");
    }
    if (line.type === "qso") {
      const qso = parseQsoLine(after, document.layout);
      const dateCell = qso.cells.find((cell) => cell.key === "QSO_DATE");
      const timeCell = qso.cells.find((cell) => cell.key === "TIME_ON");
      const modeCell = qso.cells.find((cell) => cell.key === "MODE");
      const frequencyCell = qso.cells.find((cell) => cell.key === "FREQUENCY");
      if (dateCell && /^\d{8}$/.test(dateCell.value)) {
        dateCell.value = `${dateCell.value.slice(0, 4)}-${dateCell.value.slice(4, 6)}-${dateCell.value.slice(6)}`;
        reasons.push("Normalize date to YYYY-MM-DD");
      }
      if (timeCell && /^\d{1,2}:\d{2}$/.test(timeCell.value)) {
        const [hour = "", minute = ""] = timeCell.value.split(":");
        timeCell.value = `${hour.padStart(2, "0")}${minute}`;
        reasons.push("Normalize time to HHMM");
      }
      if (modeCell) {
        const original = modeCell.value.toUpperCase();
        const current = deprecatedModeMap[original] ?? original;
        const mapped = cabrilloModeMap[current] ?? current;
        if (mapped !== original) {
          modeCell.value = mapped;
          reasons.push(`Map mode ${original} to ${mapped}`);
        }
      }
      if (frequencyCell && /^\d{1,3}[.,]\d+$/.test(frequencyCell.value)) {
        const normalized = frequencyToKHz(frequencyCell.value);
        if (normalized !== frequencyCell.value) {
          frequencyCell.value = normalized;
          reasons.push("Normalize frequency to kHz");
        }
      }
      const validWaedcTokens = !!document.layout?.name.startsWith("DARC-WAEDC-") &&
        !isFixedWidthQso(after, document.layout) &&
        after.trim().split(/\s+/).length >= 11;
      if (qso.call && (document.layout || reasons.length > 0) && !validWaedcTokens) {
        const aligned = formatQso(qso, document.layout, after.trimStart().startsWith("X-QSO:") ? "X-QSO:" : "QSO:");
        if (aligned !== after && document.layout) reasons.push(`Realign to ${document.layout.name} columns`);
        after = aligned;
      }
    }
    if (after !== line.raw) {
      if (!reasons.length) reasons.push("Remove trailing whitespace");
      changes.push({ lineId: line.id, lineNumber: line.lineNumber, before: line.raw, after, reasons });
    }
  }
  return changes;
}

export function applyCabrilloRepairs(document: CabrilloDocument, changes: RepairChange[]): CabrilloDocument {
  const replacements = new Map(changes.map((change) => [change.lineId, change.after]));
  const source = document.lines
    .map((line) => replacements.get(line.id) ?? line.raw)
    .join(document.newline) + (document.trailingNewline ? document.newline : "");
  return parseCabrillo(source);
}
