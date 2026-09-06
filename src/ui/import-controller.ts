import { ImportWorkspace, readImportPresets } from "../core/import-workspace";
import type { ImportSession, ParsingStrategy, ColumnTransform, ImportRow, NormalizedImport } from "../core/ingestion-types";
import type { ImportExportFormat } from "../core/import-export";
import { needsImportWorker, runImportTask, type ImportTask } from "../core/import-tasks";
import { renderImportWorkspace } from "./import-view";

export class ImportController {
  workspace: ImportWorkspace;
  private editedInput: HTMLInputElement | null = null;
  private normalized: NormalizedImport;
  private jobVersion = 0;
  private pending?: AbortController;
  private normalizeTimer?: ReturnType<typeof setTimeout>;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private structuralPending = false;
  private structureViewStale = false;
  private deferredActions: Array<() => void> = [];
  private refresh: () => void;
  private download: (source: string, extension: string) => void;
  private legacy: () => void;
  constructor(session: ImportSession, refresh: () => void, download: (source: string, extension: string) => void, legacy: () => void, prepared?: NormalizedImport) {
    this.refresh = refresh;
    this.download = download;
    this.legacy = legacy;
    this.workspace = new ImportWorkspace(session);
    this.normalized = prepared ?? (needsImportWorker(session) ? { records: [], metadata: {}, issues: [], warnings: [] } : this.workspace.normalized);
    this.workspace.seedNormalized(this.normalized);
    if (!prepared && needsImportWorker(session)) this.background({ operation: "normalize" });
  }
  dispose(): void { this.jobVersion++; this.pending?.abort(); this.pending = undefined; if (this.normalizeTimer !== undefined) clearTimeout(this.normalizeTimer); this.normalizeTimer = undefined; if (this.refreshTimer !== undefined) clearTimeout(this.refreshTimer); this.refreshTimer = undefined; this.structuralPending = false; this.deferredActions = []; }
  get recordCount(): number { return this.large ? this.normalized.records.length : this.workspace.normalized.records.length; }
  undo(): void { if (this.defer(() => this.undo())) return; this.editedInput = null; this.run(() => this.workspace.undo()); }
  redo(): void { if (this.defer(() => this.redo())) return; this.editedInput = null; this.run(() => this.workspace.redo()); }
  private defer(action: () => void): boolean {
    if (!this.structuralPending) return false;
    this.deferredActions.push(action);
    return true;
  }
  private refreshAfterPointer(): void {
    // A worker may finish between the pointer-down blur and the button's click.
    if (document.querySelector("button:active")) {
      this.refreshTimer = setTimeout(() => { this.refreshTimer = undefined; this.refreshAfterPointer(); }, 20);
    } else this.refresh();
  }
  private updateHistoryButtons(): void {
    for (const action of ["undo", "redo"] as const) {
      const disabled = this.workspace[action === "undo" ? "undoStack" : "redoStack"].length === 0;
      document.querySelectorAll<HTMLButtonElement>(`[data-import-action="${action}"], [data-action="${action}"]`).forEach(button => { button.disabled = disabled; });
    }
  }
  private updateStructureControls(): void {
    document.querySelectorAll<HTMLFieldSetElement>("[data-import-structure-controls]").forEach(fieldset => { fieldset.disabled = this.structuralPending || this.structureViewStale; });
  }
  private get large(): boolean { return needsImportWorker(this.workspace.session); }
  private background(options: Omit<Extract<ImportTask, { kind: "workspace" }>, "kind" | "state">, refresh = true, after?: (result: Awaited<ReturnType<typeof runImportTask>>) => void): void {
    this.dispose();
    const version = this.jobVersion;
    const abort = this.pending = new AbortController();
    this.structuralPending = ["reparse", "candidate", "split", "join", "preset-apply", "recover"].includes(options.operation);
    this.updateStructureControls();
    const w = this.workspace;
    const task: ImportTask = { kind: "workspace", state: w.taskState(), ...options };
    w.notice = this.structuralPending
      ? "Updating the log structure in the background. Mapping and row editing resume when the updated columns appear."
      : "Processing this log in the background. You can keep reviewing; new changes replace this operation.";
    document.querySelector<HTMLButtonElement>('[data-import-action="download"]')?.setAttribute("disabled", "");
    const notice = document.querySelector<HTMLElement>(".import-notice");
    if (notice) notice.textContent = w.notice;
    void runImportTask(task, abort.signal).then(result => {
      if (version !== this.jobVersion) return;
      this.pending = undefined;
      this.structureViewStale ||= this.structuralPending && !!result.changed;
      if (options.operation !== "normalize" && result.state) {
        if (result.changed) w.commit();
        w.applyTaskState(result.state, result.normalized);
        if (["reparse", "candidate", "preset-apply"].includes(options.operation)) w.page = 0;
      } else { w.seedNormalized(result.normalized); w.notice = "Values updated. Validate & preview to check the current export."; }
      this.normalized = result.normalized;
      after?.(result);
      const deferred = this.deferredActions;
      this.deferredActions = [];
      this.structuralPending = false;
      this.updateStructureControls();
      for (const action of deferred) action();
      if (refresh) this.refreshAfterPointer();
    }).catch(error => {
      if (version !== this.jobVersion || abort.signal.aborted) return;
      this.pending = undefined;
      this.structuralPending = false;
      this.deferredActions = [];
      this.updateStructureControls();
      w.notice = `${error instanceof Error ? error.message : "Background processing failed."} Your original source is retained.`;
      if (refresh) this.refreshAfterPointer();
      else if (notice) notice.textContent = w.notice;
    });
  }
  render(): string {
    const w = this.workspace;
    this.structureViewStale = false;
    return renderImportWorkspace({ session: w.session, normalized: this.large ? this.normalized : w.normalized, metadata: w.metadata, target: w.target, result: this.pending || this.normalizeTimer !== undefined ? undefined : w.result,
      canUndo: w.undoStack.length > 0, canRedo: w.redoStack.length > 0, structurePending: this.structuralPending, page: w.page, notice: w.notice, presets: readImportPresets(localStorage) });
  }
  private run(action: () => void, refresh = true): void {
    this.dispose();
    try { action(); } catch (error) { this.workspace.notice = error instanceof Error ? error.message : "This input could not be interpreted. The original source is retained."; }
    if (this.large && !refresh) this.normalizeTimer = setTimeout(() => { this.normalizeTimer = undefined; this.background({ operation: "normalize" }, false); }, 150);
    else if (this.large) this.background({ operation: "normalize" }, refresh);
    else if (refresh) this.refresh();
    if (!refresh) {
      this.updateHistoryButtons();
      // A text input's blur/change fires between pointer down and click on the
      // next button. Replacing that button here would swallow the user's click.
      document.querySelector<HTMLButtonElement>('[data-import-action="download"]')?.setAttribute("disabled", "");
      document.querySelector<HTMLElement>(".import-result")?.setAttribute("hidden", "");
      const notice = document.querySelector<HTMLElement>(".import-notice");
      if (notice) notice.textContent = "Value updated. Validate & preview to refresh the normalized result.";
    }
  }
  click(element: HTMLElement): boolean {
    const action = element.dataset.importAction;
    if (!action) return false;
    if ((this.structuralPending || this.structureViewStale) && !["preview", "recover", "report", "download", "page-prev", "page-next", "undo", "redo", "legacy", "promote"].includes(action)) return true;
    if (this.defer(() => this.click(element))) return true;
    this.editedInput = null;
    const w = this.workspace, index = Number(element.dataset.importIndex ?? element.dataset.index ?? 0);
    const value = element.dataset.importValue ?? element.dataset.value ?? "";
    const currentBoundaries = () => w.session.options.boundaries ?? w.session.candidates.find(c => c.id === w.session.selectedCandidateId)?.boundaries ?? [];
    const input = (id: string) => document.getElementById(id) instanceof HTMLInputElement ? (document.getElementById(id) as HTMLInputElement).value : "";
    if (this.large) {
      let task: Omit<Extract<ImportTask, { kind: "workspace" }>, "kind" | "state"> | undefined;
      switch (action) {
        case "candidate": task = { operation: "candidate", value }; break;
        case "reparse": task = { operation: "reparse", options: w.session.options }; break;
        case "boundary-add": {
          const boundary = Number(input("import-boundary-new"));
          if (!Number.isInteger(boundary) || boundary <= 0 || boundary > 4096) { w.notice = "Boundary must be between 1 and 4096."; this.refresh(); return true; }
          task = { operation: "reparse", options: { ...w.session.options, strategy: "fixed-width", boundaries: [...new Set([...currentBoundaries(), boundary])].sort((a,b) => a-b) } }; break;
        }
        case "boundary-delete": task = { operation: "reparse", options: { ...w.session.options, strategy: "fixed-width", boundaries: currentBoundaries().filter((_, i) => i !== index) } }; break;
        case "split": task = { operation: "split", index, value: input(`import-split-${index}`) }; break;
        case "join": task = { operation: "join", indexes: input(`import-join-${index}`).split(",").map(item => Number(item.trim()) - 1) }; break;
        case "promote": task = { operation: "promote" }; break;
        case "preset-apply": task = { operation: "preset-apply", value, presets: JSON.stringify(readImportPresets(localStorage)) }; break;
        case "preview": case "recover": case "report": task = { operation: action }; break;
        case "download": task = { operation: "preview" }; break;
        case "legacy":
          this.dispose();
          try { this.legacy(); } catch (error) { w.notice = error instanceof Error ? error.message : "Classic table could not open this source."; }
          this.refresh(); return true;
      }
      if (task) {
        this.background(task, true, result => {
          if (action === "report" && result.report) this.download(result.report, "conversion.json");
          if (action === "download" && w.result?.canExport) this.download(w.result.content, w.target === "adif" ? "adi" : w.target === "cabrillo" ? "log" : w.target);
        });
        return true;
      }
    }
    this.run(() => {
      switch (action) {
        case "undo": w.undo(); break;
        case "redo": w.redo(); break;
        case "candidate": w.candidate(value); break;
        case "reparse": w.reparse(w.session.options); break;
        case "boundary-add": {
          const boundary = Number(input("import-boundary-new"));
          if (!Number.isInteger(boundary) || boundary <= 0 || boundary > 4096) throw new Error("Boundary must be a whole character position between 1 and 4096.");
          const boundaries = [...new Set([...currentBoundaries(), boundary])].sort((a,b) => a-b);
          w.reparse({ ...w.session.options, strategy: "fixed-width", boundaries }); break;
        }
        case "boundary-delete": w.reparse({ ...w.session.options, strategy: "fixed-width", boundaries: currentBoundaries().filter((_, i) => i !== index) }); break;
        case "add-column": w.addColumn(); break;
        case "split": w.split(index, input(`import-split-${index}`)); break;
        case "join": w.join(input(`import-join-${index}`).split(",").map(value => Number(value.trim()) - 1)); break;
        case "promote": w.promote(); break;
        case "preset-save": w.savePreset(input("import-preset-name"), localStorage); break;
        case "preset-apply": w.applyPreset(value, localStorage); break;
        case "preset-delete": w.deletePreset(value, localStorage); break;
        case "page-prev": w.page = Math.max(0, w.page - 1); break;
        case "page-next": w.page = Math.min(Math.max(0, Math.ceil(w.session.rows.length / 30) - 1), w.page + 1); break;
        case "preview": w.preview(); break;
        case "recover": w.recover(); break;
        case "download": w.preview(); if (w.result?.canExport) this.download(w.result.content, w.target === "adif" ? "adi" : w.target === "cabrillo" ? "log" : w.target); break;
        case "report": this.download(w.report(), "conversion.json"); break;
        case "legacy": this.legacy(); break;
      }
    });
    return true;
  }
  change(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): boolean {
    const field = element.dataset.importField;
    if (!field) return false;
    if ((this.structuralPending || this.structureViewStale) && !["metadata", "target"].includes(field)) return true;
    const savedValue = element.value;
    const savedChecked = element instanceof HTMLInputElement ? element.checked : false;
    if (this.defer(() => { element.value = savedValue; if (element instanceof HTMLInputElement) element.checked = savedChecked; this.change(element); })) return true;
    const w = this.workspace;
    const index = Number(element.dataset.importIndex ?? element.dataset.index ?? 0);
    const key = element.dataset.importValue ?? element.dataset.value ?? "";
    const value = element instanceof HTMLInputElement && element.type === "checkbox" ? String(element.checked) : element.value;
    if (field === "cell" && (w.session.rows.find(row => row.sourceIndex === index)?.cells[Number(key)] ?? "") === value) return true;
    if (field === "metadata" && w.metadata[key] === value) return true;
    if (field === "constant" && (w.session.columns[index]?.transform.constant ?? "") === value) return true;
    if (this.large && ["candidate", "strategy", "delimiter", "headerRow", "boundary"].includes(field)) {
      if (field === "candidate") this.background({ operation: "candidate", value });
      else {
        const options = { ...w.session.options };
        if (field === "strategy") options.strategy = value as ParsingStrategy;
        if (field === "delimiter") { options.strategy = "delimited"; options.delimiter = value === "\\t" ? "\t" : value; }
        if (field === "headerRow") options.headerRow = value === "" || value === "auto" ? undefined : value === "none" || value === "0" ? null : Number(value) - 1;
        if (field === "boundary") {
          const position = Number(value);
          if (!Number.isInteger(position) || position < 1 || position > 4096) { w.notice = "Boundary must be between 1 and 4096."; this.refresh(); return true; }
          const boundaries = [...(options.boundaries ?? w.session.candidates.find(c => c.id === w.session.selectedCandidateId)?.boundaries ?? [])];
          boundaries[index] = position; options.strategy = "fixed-width"; options.boundaries = [...new Set(boundaries)].sort((a,b) => a-b);
        }
        this.background({ operation: "reparse", options });
      }
      return true;
    }
    this.run(() => {
      const column = w.session.columns[index];
      switch (field) {
        case "candidate": w.candidate(value); break;
        case "strategy": w.reparse({ ...w.session.options, strategy: value as ParsingStrategy }); break;
        case "delimiter": w.reparse({ ...w.session.options, strategy: "delimited", delimiter: value === "\\t" ? "\t" : value }); break;
        case "headerRow": w.reparse({ ...w.session.options, headerRow: value === "" || value === "auto" ? undefined : value === "none" || value === "0" ? null : Number(value) - 1 }); break;
        case "boundary": {
          const boundaries = [...(w.session.options.boundaries ?? w.session.candidates.find(c => c.id === w.session.selectedCandidateId)?.boundaries ?? [])];
          const position = Number(value);
          if (!Number.isInteger(position) || position < 1 || position > 4096) throw new Error("Boundary must be between 1 and 4096.");
          boundaries[index] = position;
          w.reparse({ ...w.session.options, strategy: "fixed-width", boundaries: [...new Set(boundaries)].sort((a,b) => a-b) }); break;
        }
        case "mapping": if (column) w.mapColumn(index, { field: value }); break;
        case "dateOrder": case "frequencyUnit": case "constant": case "uppercase":
          if (column) {
            const transform: ColumnTransform = { ...column.transform, [field]: field === "uppercase" ? value === "true" : value };
            if (field === "constant" && value === "") delete transform.constant;
            w.mapColumn(index, { transform });
          } break;
        case "row-included": w.changeRow(index, { included: value === "true" }); break;
        case "row-kind": w.changeRow(index, { kind: value as ImportRow["kind"], included: value === "qso" }); break;
        case "cell": w.changeCell(index, Number(key), value); break;
        case "metadata": w.commit(w.session, { ...w.metadata, [key]: value }, w.target, false); break;
        case "target": w.commit(w.session, w.metadata, value as ImportExportFormat, false); break;
      }
    }, !(element instanceof HTMLInputElement && !["checkbox", "radio", "range"].includes(element.type)));
    return true;
  }
  input(element: HTMLInputElement): boolean {
    if (!["cell", "metadata", "constant"].includes(element.dataset.importField ?? "") || ["checkbox", "radio"].includes(element.type)) return false;
    if ((this.structuralPending || this.structureViewStale) && element.dataset.importField !== "metadata") return true;
    const value = element.value;
    if (this.defer(() => { element.value = value; this.input(element); })) return true;
    const history = [...this.workspace.undoStack];
    const sameEdit = this.editedInput === element;
    this.change(element);
    if (sameEdit) this.workspace.undoStack.splice(0, this.workspace.undoStack.length, ...history);
    this.editedInput = element;
    return true;
  }
}
