import { dispatchImportTask, type ImportTask } from "./import-tasks";

self.onmessage = (event: MessageEvent<ImportTask>) => {
  try { self.postMessage({ result: dispatchImportTask(event.data) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : "Could not process this log. Original source is retained." }); }
};
