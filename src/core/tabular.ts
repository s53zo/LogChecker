export interface TableColumn {
  id: string;
  name: string;
}

export interface TableRow {
  id: string;
  cells: string[];
  original: string;
}

export interface TableDocument {
  columns: TableColumn[];
  rows: TableRow[];
  delimiter: string;
  source: string;
}

export interface TableSelection {
  rowIds?: readonly string[];
  columnIndexes?: readonly number[];
}

export interface TableChange {
  rowId?: string;
  columnIndex?: number;
  before: string;
  after: string;
  description: string;
}

export interface TablePreview {
  label: string;
  before: TableDocument;
  after: TableDocument;
  changes: TableChange[];
  warnings: string[];
  lossy: boolean;
}

const clone = (table: TableDocument): TableDocument => ({
  ...table,
  columns: table.columns.map((column) => ({ ...column })),
  rows: table.rows.map((row) => ({ ...row, cells: [...row.cells] })),
});

const rowSelected = (selection: TableSelection, id: string): boolean => !selection.rowIds?.length || selection.rowIds.includes(id);
const columnSelected = (selection: TableSelection, index: number): boolean => !selection.columnIndexes?.length || selection.columnIndexes.includes(index);

function result(label: string, before: TableDocument, after: TableDocument, changes: TableChange[], warnings: string[] = [], lossy = false): TablePreview {
  return { label, before, after, changes, warnings, lossy };
}

function rowId(index: number, original: string): string {
  let hash = 2166136261;
  for (const char of original) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `row-${index + 1}-${(hash >>> 0).toString(36)}`;
}

export function detectTextDelimiter(source: string): string {
  const lines = source.split(/\r\n|\r|\n/).filter((line) => line.trim()).slice(0, 50);
  const candidates = ["\t", ";", ",", "|"];
  const scored = candidates.map((delimiter) => {
    const counts = lines.map((line) => line.split(delimiter).length);
    const common = counts.filter((count) => count === counts[0] && count > 1).length;
    return { delimiter, common, width: counts[0] ?? 1 };
  }).sort((left, right) => right.common - left.common || right.width - left.width);
  const minimumAgreement = lines.length <= 1 ? 1 : Math.max(2, Math.ceil(lines.length * 0.7));
  return scored[0] && scored[0].common >= minimumAgreement ? scored[0].delimiter : "";
}

export function parseTextTable(source: string, delimiter = detectTextDelimiter(source)): TableDocument {
  const originals = source.split(/\r\n|\r|\n/);
  if (/(?:\r\n|\r|\n)$/.test(source)) originals.pop();
  const cells = originals.map((line) => delimiter ? line.split(delimiter) : [...line]);
  const width = Math.max(0, ...cells.map((row) => row.length));
  return {
    source,
    delimiter,
    columns: Array.from({ length: width }, (_, index) => ({ id: `column-${index + 1}`, name: `COLUMN_${index + 1}` })),
    rows: cells.map((values, index) => ({ id: rowId(index, originals[index]!), cells: [...values, ...Array(Math.max(0, width - values.length)).fill("")], original: originals[index]! })),
  };
}

export function serializeTextTable(table: TableDocument, delimiter = table.delimiter): string {
  return table.rows.map((row) => row.cells.join(delimiter)).join("\n");
}

export function mapSelectedCells(table: TableDocument, selection: TableSelection, label: string, transform: (value: string) => string, lossy = false): TablePreview {
  const after = clone(table);
  const changes: TableChange[] = [];
  after.rows.forEach((row, rowIndex) => {
    if (!rowSelected(selection, row.id)) return;
    row.cells.forEach((value, columnIndex) => {
      if (!columnSelected(selection, columnIndex)) return;
      const next = transform(value);
      if (next === value) return;
      changes.push({ rowId: row.id, columnIndex, before: value, after: next, description: label });
      after.rows[rowIndex]!.cells[columnIndex] = next;
    });
  });
  return result(label, table, after, changes, [], lossy && changes.length > 0);
}

export const tableTransforms = {
  replace(table: TableDocument, selection: TableSelection, find: string, replacement: string): TablePreview {
    return mapSelectedCells(table, selection, "Replace text", (value) => value.replaceAll(find, replacement), true);
  },
  removeAlpha: (table: TableDocument, selection: TableSelection) => mapSelectedCells(table, selection, "Remove alphabetic characters", (value) => value.replace(/[A-Za-z]/g, ""), true),
  removeNumeric: (table: TableDocument, selection: TableSelection) => mapSelectedCells(table, selection, "Remove numeric characters", (value) => value.replace(/[0-9]/g, ""), true),
  removeSymbols: (table: TableDocument, selection: TableSelection) => mapSelectedCells(table, selection, "Remove symbols", (value) => value.replace(/[^A-Za-z0-9\s]/g, ""), true),
  trim: (table: TableDocument, selection: TableSelection) => mapSelectedCells(table, selection, "Trim cells", (value) => value.trim(), true),
  trimAll: (table: TableDocument, selection: TableSelection) => mapSelectedCells(table, selection, "Remove all whitespace", (value) => value.replace(/\s/g, ""), true),
  removeLeft: (table: TableDocument, selection: TableSelection) => mapSelectedCells(table, selection, "Remove left character", (value) => value.slice(1), true),
  removeRight: (table: TableDocument, selection: TableSelection) => mapSelectedCells(table, selection, "Remove right character", (value) => value.slice(0, -1), true),
  fill: (table: TableDocument, selection: TableSelection, value: string) => mapSelectedCells(table, selection, "Fill cells", () => value, true),
  empty: (table: TableDocument, selection: TableSelection) => mapSelectedCells(table, selection, "Empty cells", (value) => " ".repeat(value.length), true),
};

export function insertColumn(table: TableDocument, afterIndex: number, name = "UNASSIGNED", values: readonly string[] = []): TablePreview {
  const after = clone(table);
  const index = Math.max(0, Math.min(after.columns.length, afterIndex + 1));
  after.columns.splice(index, 0, { id: `column-${crypto.randomUUID()}`, name });
  const changes: TableChange[] = [];
  after.rows.forEach((row, rowIndex) => {
    const value = values[rowIndex] ?? "";
    row.cells.splice(index, 0, value);
    changes.push({ rowId: row.id, columnIndex: index, before: "", after: value, description: "Insert column" });
  });
  return result("Insert column", table, after, changes);
}

export function duplicateColumn(table: TableDocument, columnIndex: number): TablePreview {
  const column = table.columns[columnIndex];
  if (!column) return result("Duplicate column", table, table, [], ["The selected column does not exist."]);
  return insertColumn(table, columnIndex, `${column.name}_COPY`, table.rows.map((row) => row.cells[columnIndex] ?? ""));
}

export function moveColumns(table: TableDocument, columnIndexes: readonly number[], direction: "left" | "right"): TablePreview {
  const selected = new Set(columnIndexes.filter((index) => index >= 0 && index < table.columns.length));
  if (!selected.size) return result(`Move columns ${direction}`, table, table, [], ["Select at least one column."]);
  const boundary = direction === "left" ? 0 : table.columns.length - 1;
  if (selected.has(boundary)) return result(`Move columns ${direction}`, table, table, [], [`The selected columns cannot move further ${direction}.`]);

  const order = table.columns.map((_, index) => index);
  const indexes = [...selected].sort((left, right) => direction === "left" ? left - right : right - left);
  for (const index of indexes) {
    const target = direction === "left" ? index - 1 : index + 1;
    [order[index], order[target]] = [order[target]!, order[index]!];
  }

  const after = clone(table);
  after.columns = order.map((index) => ({ ...table.columns[index]! }));
  after.rows = table.rows.map((row) => ({ ...row, cells: order.map((index) => row.cells[index] ?? "") }));
  const changes = [...selected].sort((left, right) => left - right).map((index) => {
    const column = table.columns[index]!;
    const target = order.indexOf(index);
    return { columnIndex: index, before: String(index + 1), after: String(target + 1), description: `Move ${column.name} ${direction}` };
  });
  return result(`Move columns ${direction}`, table, after, changes);
}

export function deleteColumns(table: TableDocument, columnIndexes: readonly number[], keepSelected = false): TablePreview {
  const selected = new Set(columnIndexes);
  const removed = table.columns.map((_, index) => index).filter((index) => keepSelected ? !selected.has(index) : selected.has(index));
  const after = clone(table);
  const changes: TableChange[] = [];
  [...removed].sort((a, b) => b - a).forEach((index) => {
    after.columns.splice(index, 1);
    after.rows.forEach((row) => {
      const [value = ""] = row.cells.splice(index, 1);
      changes.push({ rowId: row.id, columnIndex: index, before: value, after: "", description: "Delete column" });
    });
  });
  return result(keepSelected ? "Delete unselected columns" : "Delete columns", table, after, changes, [], changes.length > 0);
}

export function splitColumn(table: TableDocument, columnIndex: number, separator: string): TablePreview {
  if (!separator) return result("Split column", table, table, [], ["Enter a separator before splitting."]);
  const after = clone(table);
  const column = after.columns[columnIndex];
  if (!column) return result("Split column", table, table, [], ["The selected column does not exist."]);
  after.columns.splice(columnIndex + 1, 0, { id: `column-${crypto.randomUUID()}`, name: `${column.name}_2` });
  const changes: TableChange[] = [];
  after.rows.forEach((row) => {
    const original = row.cells[columnIndex] ?? "";
    const position = original.indexOf(separator);
    const left = position >= 0 ? original.slice(0, position) : original;
    const right = position >= 0 ? original.slice(position + separator.length) : "";
    row.cells[columnIndex] = left;
    row.cells.splice(columnIndex + 1, 0, right);
    if (position >= 0) changes.push({ rowId: row.id, columnIndex, before: original, after: `${left} | ${right}`, description: "Split column" });
  });
  return result("Split column", table, after, changes, [], false);
}

export function joinColumns(table: TableDocument, columnIndexes: readonly number[], combineWithSpace = false): TablePreview {
  const indexes = [...new Set(columnIndexes)].filter((index) => index >= 0 && index < table.columns.length).sort((a, b) => a - b);
  if (indexes.length < 2) return result("Join columns", table, table, [], ["Select at least two columns."]);
  const after = clone(table);
  const first = indexes[0]!;
  const changes: TableChange[] = [];
  after.rows.forEach((row) => {
    const before = indexes.map((index) => row.cells[index] ?? "");
    const joined = combineWithSpace ? before.map((value) => value.trim()).filter(Boolean).join(" ") : before.join("");
    row.cells[first] = joined;
    changes.push({ rowId: row.id, columnIndex: first, before: before.join(" | "), after: joined, description: combineWithSpace ? "Combine columns" : "Join columns" });
    indexes.slice(1).reverse().forEach((index) => row.cells.splice(index, 1));
  });
  indexes.slice(1).reverse().forEach((index) => after.columns.splice(index, 1));
  return result(combineWithSpace ? "Combine columns" : "Join columns", table, after, changes, [], false);
}

export function renameColumn(table: TableDocument, columnIndex: number, name: string): TablePreview {
  const after = clone(table);
  const column = after.columns[columnIndex];
  if (!column) return result("Rename column", table, table, [], ["The selected column does not exist."]);
  const before = column.name;
  column.name = name.trim().toUpperCase() || "UNASSIGNED";
  return result("Rename column", table, after, before === column.name ? [] : [{ columnIndex, before, after: column.name, description: "Rename column" }]);
}

export function deleteRows(table: TableDocument, rowIds: readonly string[]): TablePreview {
  const selected = new Set(rowIds);
  const removed = table.rows.filter((row) => selected.has(row.id));
  const after = clone(table);
  after.rows = after.rows.filter((row) => !selected.has(row.id));
  return result("Delete rows", table, after, removed.map((row) => ({ rowId: row.id, before: row.cells.join(table.delimiter), after: "", description: "Delete row" })), [], removed.length > 0);
}

export function moveRow(table: TableDocument, rowIdValue: string, direction: "up" | "down"): TablePreview {
  const index = table.rows.findIndex((row) => row.id === rowIdValue);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= table.rows.length) return result(`Move row ${direction}`, table, table, [], ["The row cannot move further."]);
  const after = clone(table);
  [after.rows[index], after.rows[target]] = [after.rows[target]!, after.rows[index]!];
  return result(`Move row ${direction}`, table, after, [{ rowId: rowIdValue, before: String(index + 1), after: String(target + 1), description: `Move row ${direction}` }]);
}

export function addSerialColumn(table: TableDocument, afterIndex: number, start = 1, width = 3, name = "SERIAL"): TablePreview {
  return insertColumn(table, afterIndex, name, table.rows.map((_, index) => String(start + index).padStart(width, "0")));
}

export function copyColumn(table: TableDocument, columnIndex: number): string[] {
  return table.rows.map((row) => row.cells[columnIndex] ?? "");
}

export function pasteColumn(table: TableDocument, afterIndex: number, values: readonly string[], name = "PASTED"): TablePreview {
  const preview = insertColumn(table, afterIndex, name, values);
  return { ...preview, label: "Paste column", changes: preview.changes.map((change) => ({ ...change, description: "Paste column" })) };
}

export function shiftRows(table: TableDocument, rowIds: readonly string[], direction: "left" | "right"): TablePreview {
  const selected = new Set(rowIds);
  const after = clone(table);
  const changes: TableChange[] = [];
  const warnings: string[] = [];
  after.rows.forEach((row) => {
    if (!selected.has(row.id)) return;
    const before = row.cells.join(table.delimiter);
    if (direction === "left") {
      const removed = row.cells.shift() ?? "";
      row.cells.push("");
      if (removed.trim()) warnings.push(`${row.id}: shifting left discarded “${removed}”.`);
    } else {
      const removed = row.cells.pop() ?? "";
      row.cells.unshift("");
      if (removed.trim()) warnings.push(`${row.id}: shifting right discarded “${removed}”.`);
    }
    changes.push({ rowId: row.id, before, after: row.cells.join(table.delimiter), description: `Shift row ${direction}` });
  });
  return result(`Shift rows ${direction}`, table, after, changes, warnings, warnings.length > 0);
}

export function alignRows(table: TableDocument, rowIds: readonly string[], columnIndexes: readonly number[]): TablePreview {
  const selected = new Set(rowIds);
  const indexes = [...columnIndexes].sort((a, b) => a - b);
  const starts = table.rows.filter((row) => selected.has(row.id)).map((row) => indexes.find((index) => row.cells[index]?.trim()) ?? -1).filter((index) => index >= 0);
  if (!starts.length) return result("Align selected rows", table, table, [], ["No non-empty selected cells were found."]);
  const frequency = new Map<number, number>();
  starts.forEach((start) => frequency.set(start, (frequency.get(start) ?? 0) + 1));
  const target = [...frequency].sort((left, right) => right[1] - left[1] || left[0] - right[0])[0]![0];
  let after = table;
  const changes: TableChange[] = [];
  const warnings: string[] = [];
  table.rows.filter((row) => selected.has(row.id)).forEach((row) => {
    const start = indexes.find((index) => row.cells[index]?.trim()) ?? target;
    const delta = target - start;
    if (!delta) return;
    let rowTable = after;
    for (let count = 0; count < Math.abs(delta); count += 1) {
      const shifted = shiftRows(rowTable, [row.id], delta > 0 ? "right" : "left");
      rowTable = shifted.after;
      warnings.push(...shifted.warnings);
    }
    after = rowTable;
    changes.push({ rowId: row.id, before: row.cells.join(table.delimiter), after: after.rows.find((candidate) => candidate.id === row.id)!.cells.join(table.delimiter), description: `Align row to column ${target + 1}` });
  });
  return result("Align selected rows", table, after, changes, warnings, warnings.length > 0);
}
