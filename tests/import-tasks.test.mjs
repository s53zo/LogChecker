import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchImportTask, prepareImport, runImportTask, IMPORT_WORKER_THRESHOLD } from '../src/core/import-tasks.ts';
import { ImportWorkspace } from '../src/core/import-workspace.ts';
import { corpus } from './fixtures/import-corpus.mjs';

test('background dispatcher prepares the same canonical data as the synchronous workspace', async () => {
  const prepared = await prepareImport(corpus.tsv);
  const workspace = new ImportWorkspace(prepared.session);
  assert.deepEqual(prepared.normalized, workspace.normalized);
  assert.ok(prepared.normalized.records.length > 0);
});

test('worker preview, report and reparse preserve source and expose undoable changes', () => {
  const prepared = dispatchImportTask({ kind: 'prepare', source: corpus.tsv });
  const workspace = new ImportWorkspace(prepared.session);
  workspace.metadata = { utcConfirmed: 'true' };
  const preview = dispatchImportTask({ kind: 'workspace', state: workspace.taskState(), operation: 'preview' });
  assert.equal(preview.changed, false);
  assert.equal(preview.state.result.canExport, true);
  const report = dispatchImportTask({ kind: 'workspace', state: preview.state, operation: 'report' });
  assert.equal(JSON.parse(report.report).source, corpus.tsv);
  const reparse = dispatchImportTask({ kind: 'workspace', state: workspace.taskState(), operation: 'reparse', options: { strategy: 'delimited', delimiter: '\t', headerRow: 0 } });
  assert.equal(reparse.changed, true);
  assert.equal(reparse.session.source, corpus.tsv);
});

test('recovery in a background task respects manually locked mappings', () => {
  const prepared = dispatchImportTask({ kind: 'prepare', source: corpus.tsv });
  const workspace = new ImportWorkspace(prepared.session);
  workspace.mapColumn(0, { field: 'COMMENT' });
  const result = dispatchImportTask({ kind: 'workspace', state: workspace.taskState(), operation: 'recover' });
  assert.equal(result.session.columns[0].field, 'COMMENT');
  assert.equal(result.state.locked, true);
  assert.match(result.state.notice, /Manual choices were preserved/);
});

test('cancelled jobs never dispatch even on the small-input fallback', async () => {
  const abort = new AbortController(); abort.abort();
  await assert.rejects(prepareImport(corpus.tsv, 'log.txt', abort.signal), { name: 'AbortError' });
});

test('large jobs terminate their worker on success and cancellation', async () => {
  const previous = globalThis.Worker;
  const instances = [];
  class FakeWorker {
    terminated = false;
    constructor() { instances.push(this); }
    terminate() { this.terminated = true; }
    postMessage(task) { this.task = task; }
  }
  globalThis.Worker = FakeWorker;
  try {
    const task = { kind: 'prepare', source: 'x'.repeat(IMPORT_WORKER_THRESHOLD + 1) };
    const pending = runImportTask(task);
    const result = dispatchImportTask({ kind: 'prepare', source: corpus.tsv });
    instances[0].onmessage({ data: { result } });
    assert.equal((await pending).session.source, corpus.tsv);
    assert.equal(instances[0].terminated, true);
    const abort = new AbortController();
    const cancelled = runImportTask(task, abort.signal);
    abort.abort();
    await assert.rejects(cancelled, { name: 'AbortError' });
    assert.equal(instances[1].terminated, true);
  } finally { globalThis.Worker = previous; }
});

test('revoked preset storage does not prevent later working-copy edits', () => {
  const prepared = dispatchImportTask({ kind: 'prepare', source: corpus.tsv });
  const workspace = new ImportWorkspace(prepared.session);
  workspace.savePreset('test', { getItem() { throw new Error('Access denied'); }, setItem() { throw new Error('Access denied'); } });
  const before = workspace.session.columns[0].field;
  workspace.mapColumn(0, { field: 'COMMENT' });
  assert.equal(workspace.session.columns[0].field, 'COMMENT');
  workspace.undo();
  assert.equal(workspace.session.columns[0].field, before);
});

test('large sources bound undo history while retaining two recent changes', () => {
  const prepared = dispatchImportTask({ kind: 'prepare', source: corpus.tsv });
  const workspace = new ImportWorkspace({ ...prepared.session, source: 'x'.repeat(5_000_001) });
  for (let i = 0; i < 10; i++) workspace.commit(workspace.session, { name: String(i) });
  assert.equal(workspace.undoStack.length, 2);
  workspace.undo();
  assert.equal(workspace.metadata.name, '8');
  workspace.undo();
  assert.equal(workspace.metadata.name, '7');
});
