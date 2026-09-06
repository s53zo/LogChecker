import test from 'node:test';
import assert from 'node:assert/strict';
import { runImportTask, dispatchImportTask, needsImportWorker } from '../src/core/import-tasks.ts';
import { importStructured } from '../src/core/import-structured.ts';
import { ImportWorkspace } from '../src/core/import-workspace.ts';
import { exportImport } from '../src/core/import-export.ts';
import * as native from './fixtures/import-corpus.mjs';

test('small native sources are inspected in a worker before dense table allocation', async () => {
  const previous = globalThis.Worker;
  let worker;
  globalThis.Worker = class {
    constructor() { worker = this; }
    postMessage(task) { this.task = task; }
    terminate() { this.terminated = true; }
  };
  try {
    const source = '<ADIF_VER:5>3.1.7<EOH><CALL:4>S53O<QSO_DATE:8>20260906<TIME_ON:4>1238<MODE:3>SSB<FREQ:5>144.3<EOR>';
    const pending = runImportTask({kind:'prepare', source, fileName:'small.adi'});
    assert.ok(worker, 'native input must not select the byte-count-only synchronous path');
    worker.onmessage({data:{result:dispatchImportTask(worker.task)}});
    assert.equal((await pending).normalized.records.length, 1);
    assert.equal(worker.terminated, true);
  } finally { globalThis.Worker = previous; }
});

test('known table work size influences worker routing even with a tiny original source', () => {
  assert.equal(needsImportWorker({source:'small',rows:Array(2001),columns:Array(50)}), true);
  assert.equal(needsImportWorker({source:'small',rows:Array(20),columns:Array(10)}), false);
});

test('repairing a native EDI callsign clears its current error but retains history', () => {
  const original = native.edi.replace(';S53O;1;', ';BAD;1;');
  const w = new ImportWorkspace(importStructured(original));
  const metadata = {ediHeaders:{PExch:'#'}};
  assert.equal(exportImport(w.session,'edi',metadata).canExport, false);
  w.changeCell(0, w.session.columns.findIndex(c => c.field === 'CALL'), 'S53O');
  const result = exportImport(w.session,'edi',metadata);
  assert.equal(result.canExport, true, JSON.stringify(result.diagnostics));
  assert.match(result.report.source, /;BAD;1;/);
  assert.match(w.session.metadata.IMPORT_SOURCE_DIAGNOSTICS, /BAD/);
});

test('native EDI mode repairs cannot silently export the previous mode', () => {
  const w = new ImportWorkspace(importStructured(native.edi));
  const metadata = {ediHeaders:{PExch:'#'}};
  w.changeCell(0, w.session.columns.findIndex(c => c.field === 'MODE'), 'CW');
  assert.equal(exportImport(w.session,'edi',metadata).canExport, false);
  w.changeCell(0, w.session.columns.findIndex(c => c.field === 'EDI_MODE_CODE'), '2');
  const result = exportImport(w.session,'edi',metadata);
  assert.equal(result.canExport, true, JSON.stringify(result.diagnostics));
  assert.match(result.content, /;S53O;2;/);
});
