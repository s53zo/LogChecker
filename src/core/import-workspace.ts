import { detectImport, normalizeImport, selectImportCandidate } from "./ingestion";
import type { ImportColumn, ImportOptions, ImportRecipe, ImportRecipeStep, ImportSession, NormalizedImport } from "./ingestion-types";
import { exportImport, recoverImportCandidates, type ImportExportFormat, type ImportExportMetadata } from "./import-export";
import { assertImportSize } from "./import-limits";
import { importStructured } from "./import-structured";
import { importDateRange } from "./import-dates";

export interface ImportPreset {
  version: 1;
  id: string;
  name: string;
  options: ImportOptions;
  columns: Array<Pick<ImportColumn, "name" | "field" | "transform">>;
  signature: string[];
  applicableFormats: ImportExportFormat[];
  recipe?: ImportRecipe;
}
interface Snapshot { session: ImportSession; target: ImportExportFormat; metadata: Record<string, string>; locked: boolean; presets?: string; }
export interface ImportTaskState extends Snapshot { notice: string; result?: ReturnType<typeof exportImport>; recoveryAttempts: unknown[]; }
const PRESET_KEY = "log-workbench:import-presets:v1";
const MAX_HISTORY = 30;
const MAX_RECIPE_STEPS = 100;

/** Validate the entire structural program before parsing or allocating its result. */
function validRecipe(value: unknown, finalWidth: number): value is ImportRecipe {
  if (!value || typeof value !== "object") return false;
  const recipe = value as ImportRecipe;
  if (!Array.isArray(recipe.baseSignature) || recipe.baseSignature.length > 100 || !recipe.baseSignature.every(name => typeof name === "string") || !Array.isArray(recipe.steps) || recipe.steps.length > MAX_RECIPE_STEPS) return false;
  if (recipe.structured !== undefined && typeof recipe.structured !== "boolean") return false;
  let width = recipe.baseSignature.length;
  for (const step of recipe.steps) {
    if (!step || typeof step !== "object") return false;
    if (step.kind === "add-column") width++;
    else if (step.kind === "split") {
      if (!Number.isInteger(step.index) || step.index < 0 || step.index >= width || typeof step.separator !== "string" || !step.separator || step.separator.length > 4096 || !Number.isInteger(step.width) || step.width < 2 || step.width > 20) return false;
      width += step.width - 1;
    } else if (step.kind === "join") {
      if (!Array.isArray(step.indexes) || step.indexes.length < 2 || step.indexes.length > width || new Set(step.indexes).size !== step.indexes.length || !step.indexes.every(index => Number.isInteger(index) && index >= 0 && index < width)) return false;
      width -= step.indexes.length - 1;
    } else return false;
    if (width > 100) return false;
  }
  return width === finalWidth;
}

export function readImportPresets(storage: Pick<Storage, "getItem">): ImportPreset[] {
  try {
    const raw = storage.getItem(PRESET_KEY) ?? "[]";
    if (raw.length > 500_000) return [];
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter((item): item is ImportPreset => {
      if (!item || item.version !== 1 || typeof item.id !== "string" || typeof item.name !== "string" || !item.options || Array.isArray(item.options) || !Array.isArray(item.columns) || item.columns.length > 100 || !Array.isArray(item.signature) || !item.signature.every((s: unknown) => typeof s === "string") || !Array.isArray(item.applicableFormats)) return false;
      const o = item.options;
      if (o.strategy !== undefined && !["auto", "delimited", "whitespace", "fixed-width"].includes(o.strategy)) return false;
      if (o.delimiter !== undefined && (typeof o.delimiter !== "string" || o.delimiter.length !== 1)) return false;
      if (o.boundaries !== undefined && (!Array.isArray(o.boundaries) || o.boundaries.length > 100 || !o.boundaries.every((v: unknown) => typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 4096))) return false;
      if (o.headerRow !== undefined && o.headerRow !== null && (!Number.isInteger(o.headerRow) || o.headerRow < 0)) return false;
      if (item.recipe !== undefined && !validRecipe(item.recipe, item.columns.length)) return false;
      return item.columns.every((column: ImportColumn) => {
        if (!column || typeof column.name !== "string" || typeof column.field !== "string" || !/^[A-Z0-9_]*$/.test(column.field) || !column.transform || typeof column.transform !== "object" || Array.isArray(column.transform)) return false;
        const t = column.transform;
        return (t.constant === undefined || typeof t.constant === "string") && (t.uppercase === undefined || typeof t.uppercase === "boolean") && (t.dateOrder === undefined || ["auto", "ymd", "dmy", "mdy"].includes(t.dateOrder)) && (t.frequencyUnit === undefined || ["auto", "MHz", "kHz", "Hz"].includes(t.frequencyUnit));
      });
    }).slice(0, 50);
  } catch { return []; }
}

/** Immutable session snapshots keep all material import decisions reversible. */
export class ImportWorkspace {
  session: ImportSession;
  target: ImportExportFormat = "adif";
  metadata: Record<string, string> = {};
  page = 0;
  notice = "Review suggested fields, confirm the time basis, then preview an output.";
  result: ReturnType<typeof exportImport> | undefined;
  readonly undoStack: Snapshot[] = [];
  readonly redoStack: Snapshot[] = [];
  private locked = false;
  private presetStorage?: Pick<Storage, "getItem" | "setItem">;
  private recoveryAttempts: unknown[] = [];
  private normalizedCache?: NormalizedImport;

  constructor(session: ImportSession) { this.session = session; }

  seedNormalized(value: NormalizedImport): void { this.normalizedCache = value; }
  taskState(): ImportTaskState { return { session: this.session, target: this.target, metadata: this.metadata, locked: this.locked, notice: this.notice, result: this.result, recoveryAttempts: this.recoveryAttempts }; }
  applyTaskState(state: ImportTaskState, normalized?: NormalizedImport): void {
    this.session = state.session; this.target = state.target; this.metadata = state.metadata; this.locked = state.locked;
    this.notice = state.notice; this.result = state.result; this.recoveryAttempts = state.recoveryAttempts; this.normalizedCache = normalized;
  }

  get normalized(): NormalizedImport { return this.normalizedCache ??= normalizeImport(this.session); }
  private snapshot(): Snapshot {
    let presets: string | undefined;
    try { if (this.presetStorage) presets = this.presetStorage.getItem(PRESET_KEY) ?? "[]"; } catch { /* Browser storage can be revoked independently of this working copy. */ }
    return { session: this.session, target: this.target, metadata: this.metadata, locked: this.locked, ...(presets !== undefined ? { presets } : {}) };
  }
  private restore(snapshot: Snapshot): void {
    this.session = snapshot.session; this.target = snapshot.target; this.metadata = snapshot.metadata; this.locked = snapshot.locked;
    if (snapshot.presets !== undefined) { try { this.presetStorage?.setItem(PRESET_KEY, snapshot.presets); } catch { this.notice = "History restored in memory; browser preset storage could not be updated."; } }
    this.invalidate();
  }
  private invalidate(): void { this.normalizedCache = undefined; this.result = undefined; this.recoveryAttempts = []; }
  commit(session = this.session, metadata = this.metadata, target = this.target, lock = true): void {
    this.undoStack.push(this.snapshot());
    // Keep at least two undo steps, limiting source-equivalent history to 10 MB.
    const historyLimit = Math.min(MAX_HISTORY, Math.max(2, Math.floor(10_000_000 / Math.max(1, session.source.length))));
    while (this.undoStack.length > historyLimit) this.undoStack.shift();
    this.redoStack.length = 0;
    this.session = session; this.metadata = metadata; this.target = target; this.locked ||= lock;
    this.invalidate();
  }
  undo(): void { const value = this.undoStack.pop(); if (value) { this.redoStack.push(this.snapshot()); this.restore(value); this.notice = "Import change undone."; } }
  redo(): void { const value = this.redoStack.pop(); if (value) { this.undoStack.push(this.snapshot()); this.restore(value); this.notice = "Import change restored."; } }
  reparse(options: ImportOptions): void {
    this.commit(detectImport(this.session.source, options)); this.page = 0;
    this.notice = "Reinterpreted the original source. Prior mapping and row edits are available in Undo.";
  }
  candidate(id: string): void {
    this.commit(selectImportCandidate(this.session, id)); this.page = 0;
    this.notice = "Selected another interpretation of the original source. Review its mappings.";
  }
  mapColumn(index: number, update: Partial<ImportColumn>): void {
    this.commit({ ...this.session, columns: this.session.columns.map((column, i) => i === index ? { ...column, ...update, locked: true } : column) });
  }
  changeCell(sourceIndex: number, index: number, value: string): void {
    this.commit({ ...this.session, rows: this.session.rows.map(row => row.sourceIndex !== sourceIndex ? row : {
      ...row, originalCells: row.originalCells ?? [...row.cells], cells: Array.from({ length: Math.max(row.cells.length, this.session.columns.length) }, (_, i) => i === index ? value : row.cells[i] ?? ""),
    }) });
  }
  changeRow(sourceIndex: number, change: Partial<ImportSession["rows"][number]>): void {
    this.commit({ ...this.session, rows: this.session.rows.map(row => row.sourceIndex === sourceIndex ? { ...row, ...change } : row) });
  }
  private appendRecipe(step: ImportRecipeStep): ImportRecipe {
    const recipe = this.session.recipe ?? { baseSignature: this.session.columns.map(column => column.name.toLowerCase()), steps: [], structured: this.session.selectedCandidateId === "structured" };
    if (recipe.steps.length >= MAX_RECIPE_STEPS) throw new Error("A mapping preset supports at most 100 structural operations. Reinterpret the source to start a new recipe.");
    return { ...recipe, steps: [...recipe.steps, step] };
  }
  split(index: number, separator: string, savedWidth?: number): void {
    const column = this.session.columns[index];
    if (!column || !separator || this.session.columns.length >= 100) return;
    if (separator.length > 4096) throw new Error("Split separators must not exceed 4096 characters.");
    assertImportSize(this.session.rows.length, this.session.columns.length + 1);
    const pieces = this.session.rows.map(row => separator === " " ? (row.cells[index] ?? "").trim().split(/\s+/) : (row.cells[index] ?? "").split(separator));
    const width = savedWidth ?? Math.min(20, Math.max(1, ...pieces.slice(0, 1000).map(values => values.length)));
    if (width < 2) { this.notice = "The separator did not split this column."; return; }
    if (!Number.isInteger(width) || width > 20 || this.session.columns.length + width - 1 > 100) throw new Error("Splitting would exceed the 100-column mapping limit.");
    assertImportSize(this.session.rows.length, this.session.columns.length + width - 1);
    const recipe = this.appendRecipe({ kind: "split", index, separator, width });
    const additions = Array.from({ length: width }, (_, i) => ({ ...column, id: `${column.id}-split-${i}`, name: `${column.name} ${i + 1}`, field: "", confidence: 0, reasons: ["Manually split; choose a field."], transform: {}, locked: true }));
    this.commit({ ...this.session, recipe, columns: [...this.session.columns.slice(0, index), ...additions, ...this.session.columns.slice(index + 1)], rows: this.session.rows.map((row, r) => {
      const values = pieces[r]!;
      const split = Array.from({ length: width }, (_, i) => i === width - 1 ? values.slice(i).join(separator) : values[i] ?? "");
      const originals = row.originalCells ?? row.cells;
      return { ...row, cells: [...row.cells.slice(0, index), ...split, ...row.cells.slice(index + 1)], originalCells: [...originals.slice(0, index), ...Array(width).fill(originals[index] ?? ""), ...originals.slice(index + 1)] };
    }) });
    this.notice = `Split ${column.name} into ${width} fields; original values remain in provenance.`;
  }
  join(indexes: number[]): void {
    const selected = [...new Set(indexes)].filter(i => Number.isInteger(i) && i >= 0 && i < this.session.columns.length).sort((a,b) => a-b);
    if (selected.length < 2) { this.notice = "Choose at least two column numbers to combine."; return; }
    const first = selected[0]!;
    const keep = this.session.columns.map((_,i) => i).filter(i => i === first || !selected.includes(i));
    assertImportSize(this.session.rows.length, keep.length);
    const recipe = this.appendRecipe({ kind: "join", indexes: selected });
    this.commit({ ...this.session, recipe, columns: keep.map(i => i === first ? { ...this.session.columns[i]!, name: "Combined exchange", field: "", confidence: 0, reasons: ["Manually combined; choose a field."], locked: true } : this.session.columns[i]!), rows: this.session.rows.map(row => ({ ...row,
      cells: keep.map(i => i === first ? selected.map(j => row.cells[j] ?? "").join(" ").trim() : row.cells[i] ?? ""),
      originalCells: keep.map(i => i === first ? selected.map(j => (row.originalCells ?? row.cells)[j] ?? "").join(" | ") : (row.originalCells ?? row.cells)[i] ?? ""),
    })) });
  }
  addColumn(): void {
    if (this.session.columns.length >= 100) return;
    assertImportSize(this.session.rows.length, this.session.columns.length + 1);
    const recipe = this.appendRecipe({ kind: "add-column" });
    this.commit({ ...this.session, recipe, columns: [...this.session.columns, { id: `constant-${this.session.columns.length}`, name: "Constant", field: "", confidence: 0, reasons: ["User-supplied constant."], transform: {}, locked: true }], rows: this.session.rows.map(row => ({ ...row, cells: [...row.cells, ""], originalCells: [...(row.originalCells ?? row.cells), ""] })) });
  }
  promote(): void {
    const keys: Record<string, string> = { STATION_CALLSIGN: "stationCall", MY_GRIDSQUARE: "stationLocator", BAND: "band", OPERATOR: "operator" };
    const values = { ...this.metadata };
    let count = 0;
    for (const [field, key] of Object.entries(keys)) {
      const distinct = new Set(this.normalized.records.map(record => record.values[field] ?? ""));
      if (distinct.size === 1 && [...distinct][0]) { values[key] = [...distinct][0]!; count++; }
    }
    this.commit(this.session, values);
    this.notice = `${count} consistent station fields promoted. Contest dates and scoring still need your review.`;
  }
  exportMetadata(): ImportExportMetadata {
    const m = this.metadata;
    const dates = importDateRange(this.normalized);
    const ediNames: Record<string, string> = { operator: "MOpe1", club: "PClub", exchange: "PExch", power: "SPowe", transmitter: "STXEq", receiver: "SRXEq", antenna: "SAnte", antennaHeight: "SAntH", name: "RName", address: "RAdr1", email: "RHBBS" };
    return {
      source: this.session.source, utcConfirmed: m.utcConfirmed === "true", contestName: m.contestName, section: m.section,
      stationCall: m.stationCall, stationLocator: m.stationLocator, band: m.band,
      scoring: m.scoring === "supplied-points" ? "supplied-points" : m.scoring === "claimed" ? "claimed" : undefined,
      claimedScore: m.claimedScore,
      ediHeaders: { ...Object.fromEntries(Object.entries(ediNames).filter(([key]) => m[key] !== undefined).map(([key,header]) => [header,m[key]!])), ...Object.fromEntries(Object.entries(m).filter(([key]) => key.startsWith("edi:")).map(([key,value]) => [key.slice(4),value])),
        ...(m.contestStart !== undefined || m.contestEnd !== undefined ? { TDate: `${(m.contestStart ?? dates.start).replaceAll("-", "")};${(m.contestEnd ?? dates.end).replaceAll("-", "")}` } : {}) },
    };
  }
  preview(): void {
    this.result = exportImport(this.session, this.target, this.exportMetadata());
    this.notice = this.result.canExport ? "Preview validated. Review warnings and target losses before downloading." : "Resolve the listed issues before downloading this target. Your source is retained.";
  }
  recover(): void {
    const candidates = this.locked ? [{ id: this.session.selectedCandidateId, document: this.normalized, score: 1 }] : this.session.candidates.filter(candidate => candidate.score >= 0).slice(0, 8).flatMap(candidate => {
      try { return [{ id: candidate.id, document: normalizeImport(selectImportCandidate(this.session, candidate.id)), score: candidate.score }]; }
      catch { return []; }
    });
    const recovery = recoverImportCandidates(candidates, this.target, this.exportMetadata(), { ...(this.locked ? { lockedCandidateId: this.session.selectedCandidateId } : {}), maxAttempts: 8 });
    this.notice = `Recovery checked ${recovery.attempts.length} interpretations. ${recovery.stoppedReason}. ${this.locked ? "Manual choices were preserved." : "Review the selected mapping."}`;
    // Recovery's selected candidate is applied only when the user has not edited a mapping.
    if (!this.locked && recovery.selected && recovery.selected.id !== this.session.selectedCandidateId) {
      this.commit(selectImportCandidate(this.session, recovery.selected.id), this.metadata, this.target, false);
    }
    this.recoveryAttempts = recovery.attempts;
    this.result = exportImport(this.session, this.target, this.exportMetadata());
  }
  report(): string {
    if (!this.result) this.preview();
    return JSON.stringify({ version: 1, source: this.session.source, options: this.session.options, recipe: this.session.recipe, candidates: this.session.candidates, selectedCandidateId: this.session.selectedCandidateId, columns: this.session.columns, rows: this.session.rows, metadata: this.metadata, canonical: this.normalized, recoveryAttempts: this.recoveryAttempts, conversion: this.result?.report }, null, 2);
  }
  savePreset(name: string, storage: Pick<Storage, "getItem" | "setItem">): void {
    const cleaned = name.trim().slice(0, 80);
    if (!cleaned) { this.notice = "Enter a name for this mapping preset."; return; }
    const presets = readImportPresets(storage).filter(preset => preset.name !== cleaned);
    const candidate = this.session.candidates.find(c => c.id === this.session.selectedCandidateId);
    const preset: ImportPreset = { version: 1, id: cleaned, name: cleaned, options: { ...this.session.options, strategy: candidate?.strategy, delimiter: candidate?.delimiter, boundaries: candidate?.boundaries }, columns: this.session.columns.map(({name, field, transform}) => ({name, field, transform})), signature: this.session.columns.map(column => column.name.toLowerCase()), applicableFormats: ["adif", "adx", "cabrillo", "edi", "csv"], ...(this.session.recipe ? { recipe: this.session.recipe } : {}) };
    try { this.presetStorage = storage; this.commit(this.session, this.metadata, this.target, false); storage.setItem(PRESET_KEY, JSON.stringify([...presets, preset].slice(-50))); this.notice = "Mapping saved locally. Presets include constant values you configured. Undo is available."; }
    catch { this.notice = "Browser storage is unavailable or full; the current mapping is still usable."; }
  }
  applyPreset(id: string, storage: Pick<Storage, "getItem">): void {
    const preset = readImportPresets(storage).find(value => value.id === id);
    if (!preset) return;
    let session = preset.recipe?.structured ? importStructured(this.session.source) : detectImport(this.session.source, preset.options);
    if (!session) { this.notice = "This preset requires a recognized structured log; mapping was not applied."; return; }
    if (preset.recipe) {
      const signature = session.columns.map(column => column.name.toLowerCase());
      if (signature.length !== preset.recipe.baseSignature.length || signature.some((name, index) => name !== preset.recipe!.baseSignature[index])) { this.notice = "Preset source columns differ from this input; structural operations were not applied."; return; }
      let width = session.columns.length;
      for (const step of preset.recipe.steps) {
        width += step.kind === "add-column" ? 1 : step.kind === "split" ? step.width - 1 : 1 - step.indexes.length;
        assertImportSize(session.rows.length, width);
      }
      // Replay against a fresh parse; failed operations never change this workspace.
      const replay = new ImportWorkspace(session);
      for (const step of preset.recipe.steps) {
        if (step.kind === "add-column") replay.addColumn();
        else if (step.kind === "split") replay.split(step.index, step.separator, step.width);
        else replay.join(step.indexes);
        // Replay is one user operation, so intermediate copies need no undo history.
        replay.undoStack.length = 0;
      }
      session = replay.session;
    }
    if (session.columns.length !== preset.columns.length) { this.notice = "Preset width differs from this source; mapping was not applied. Choose columns manually."; return; }
    this.commit({ ...session, columns: session.columns.map((column,i) => ({ ...column, ...preset.columns[i]!, locked: true, reasons: [`Applied user preset: ${preset.name}`], confidence: 1 })) });
    this.notice = "Preset applied. Review sample values before export; matching widths alone do not prove matching semantics.";
  }
  deletePreset(id: string, storage: Pick<Storage, "getItem" | "setItem">): void {
    try { this.presetStorage = storage; this.commit(this.session, this.metadata, this.target, false); storage.setItem(PRESET_KEY, JSON.stringify(readImportPresets(storage).filter(preset => preset.id !== id))); this.notice = "Local preset removed; Undo restores it."; }
    catch { this.notice = "Browser storage could not be updated."; }
  }
}
