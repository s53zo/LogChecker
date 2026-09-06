import { detectImport, normalizeImport } from "./ingestion";
import { importStructured } from "./import-structured";
import { ImportWorkspace, type ImportTaskState } from "./import-workspace";
import type { ImportOptions, ImportSession, NormalizedImport } from "./ingestion-types";
import { detectFormat } from "./format";

export const IMPORT_WORKER_THRESHOLD = 100_000;
export function needsImportWorker(session: ImportSession): boolean {
  return session.source.length > IMPORT_WORKER_THRESHOLD || session.rows.length * session.columns.length > 100_000;
}
export type ImportOperation = "normalize" | "reparse" | "candidate" | "preview" | "recover" | "report" | "split" | "join" | "promote" | "preset-apply";
export type ImportTask = { kind: "prepare"; source: string; fileName?: string } | {
  kind: "workspace"; state: ImportTaskState; operation: ImportOperation;
  options?: ImportOptions; value?: string; index?: number; indexes?: number[]; presets?: string;
};
export interface ImportTaskResult { session: ImportSession; normalized: NormalizedImport; state?: ImportTaskState; changed?: boolean; report?: string; }

/** Pure dispatch is shared by module workers and deterministic node tests. */
export function dispatchImportTask(task: ImportTask): ImportTaskResult {
  if (task.kind === "prepare") {
    const session = importStructured(task.source, task.fileName ?? "pasted.txt") ?? detectImport(task.source);
    return { session, normalized: normalizeImport(session) };
  }
  const workspace = new ImportWorkspace(task.state.session);
  workspace.applyTaskState(task.state);
  const original = workspace.session;
  const metadata = workspace.metadata;
  let report: string | undefined;
  switch (task.operation) {
    case "normalize": break;
    case "reparse": workspace.reparse(task.options ?? workspace.session.options); break;
    case "candidate": workspace.candidate(task.value ?? ""); break;
    case "preview": workspace.preview(); break;
    case "recover": workspace.recover(); break;
    case "report": report = workspace.report(); break;
    case "split": workspace.split(task.index ?? 0, task.value ?? " "); break;
    case "join": workspace.join(task.indexes ?? []); break;
    case "promote": workspace.promote(); break;
    case "preset-apply": workspace.applyPreset(task.value ?? "", { getItem: () => task.presets ?? "[]" }); break;
  }
  return { session: workspace.session, normalized: workspace.normalized, state: workspace.taskState(), changed: workspace.session !== original || workspace.metadata !== metadata, report };
}

/** One worker per job bounds lifetime and makes cancellation immediate. */
export function runImportTask(task: ImportTask, signal?: AbortSignal): Promise<ImportTaskResult> {
  if (signal?.aborted) return Promise.reject(new DOMException("Import operation cancelled", "AbortError"));
  // Native sources can be short yet have many distinct tags per record. Inspect
  // them in a worker before allocating a dense table; later jobs know its size.
  const background = task.kind === "prepare"
    ? task.source.length > IMPORT_WORKER_THRESHOLD || detectFormat(task.source, task.fileName) !== "text"
    : needsImportWorker(task.state.session);
  if (!background || typeof Worker === "undefined") {
    return Promise.resolve().then(() => {
      if (signal?.aborted) throw new DOMException("Import operation cancelled", "AbortError");
      return dispatchImportTask(task);
    });
  }
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./import-worker.ts", import.meta.url), { type: "module" });
    const cleanup = () => { worker.terminate(); signal?.removeEventListener("abort", abort); };
    const abort = () => { cleanup(); reject(new DOMException("Import operation cancelled", "AbortError")); };
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<{ result?: ImportTaskResult; error?: string }>) => {
      cleanup();
      if (event.data.result) resolve(event.data.result);
      else reject(new Error(event.data.error ?? "Background import failed. Original source is retained."));
    };
    worker.onerror = (event) => { cleanup(); reject(new Error(event.message || "Background import failed. Original source is retained.")); };
    worker.onmessageerror = () => { cleanup(); reject(new Error("Could not read the background import result. Original source is retained.")); };
    try { worker.postMessage(task); } catch (error) { cleanup(); reject(error); }
  });
}

export function prepareImport(source: string, fileName?: string, signal?: AbortSignal): Promise<ImportTaskResult> {
  return runImportTask({ kind: "prepare", source, fileName }, signal);
}
