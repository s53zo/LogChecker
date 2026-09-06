export const IMPORT_MAX_SOURCE = 5_000_000;
export const IMPORT_MAX_ROWS = 50_000;
export const IMPORT_MAX_COLUMNS = 256;
export const IMPORT_MAX_CELLS = 1_000_000;

export function assertImportSource(source: string): void {
  if (source.length > IMPORT_MAX_SOURCE) throw new Error('Input exceeds the 5 MB workbench limit; split it into smaller files.');
}

export function assertImportSize(rows: number, columns: number): void {
  if (rows > IMPORT_MAX_ROWS) throw new Error(`Input exceeds ${IMPORT_MAX_ROWS} records.`);
  if (columns > IMPORT_MAX_COLUMNS) throw new Error(`Input exceeds ${IMPORT_MAX_COLUMNS} columns.`);
  if (rows * columns > IMPORT_MAX_CELLS) throw new Error(`Input exceeds ${IMPORT_MAX_CELLS} editable cells; split it into smaller files.`);
}
