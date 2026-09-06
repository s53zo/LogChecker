import test from 'node:test';
import assert from 'node:assert/strict';
import { detectImport } from '../src/core/ingestion.ts';
import { ImportWorkspace, readImportPresets } from '../src/core/import-workspace.ts';
import { corpus } from './fixtures/import-corpus.mjs';

const workspace = (source = corpus.tsv) => new ImportWorkspace(detectImport(source, { strategy: 'delimited', delimiter: '\t', headerRow: 0 }));
const indexOf = (w, field) => w.session.columns.findIndex(column => column.field === field);
const contact = w => w.session.rows.find(row => row.included);
const memory = () => {
  let data = null;
  return { getItem: () => data, setItem: (_, value) => { data = value; } };
};

test('undo and redo restore mapping, metadata, cell values, and invalidate previews', () => {
  const w = workspace();
  const original = w.session;
  const call = indexOf(w, 'CALL');
  w.commit(w.session, { utcConfirmed: 'true', contestName: 'Test' }, 'adif');
  w.preview();
  assert.ok(w.result);
  w.mapColumn(call, { field: 'OPERATOR' });
  assert.equal(w.result, undefined);
  w.changeCell(contact(w).sourceIndex, call, 'S50C');
  assert.equal(contact(w).cells[call], 'S50C');
  w.undo();
  assert.equal(contact(w).cells[call], 'S53O');
  w.undo();
  assert.equal(w.session.columns[call].field, 'CALL');
  w.undo();
  assert.equal(w.session, original);
  assert.deepEqual(w.metadata, {});
  w.redo(); w.redo(); w.redo();
  assert.equal(contact(w).cells[call], 'S50C');
  assert.equal(w.session.columns[call].field, 'OPERATOR');
  assert.equal(w.metadata.contestName, 'Test');
  w.undo();
  w.mapColumn(call, { field: 'CALL' });
  assert.equal(w.redoStack.length, 0, 'new edits replace abandoned redo branch');
});

test('cell correction retains original source in provenance and conversion report', () => {
  const w = workspace();
  const call = indexOf(w, 'CALL');
  w.changeCell(contact(w).sourceIndex, call, 'oe8sdr/p');
  const record = w.normalized.records[0];
  assert.equal(record.values.CALL, 'OE8SDR/P');
  assert.equal(record.provenance.CALL[0].original, 'S53O');
  assert.ok(record.provenance.CALL[0].transformations.some(value => /edited/.test(value)));
  const report = JSON.parse(w.report());
  assert.equal(report.source, corpus.tsv);
  assert.equal(report.canonical.records[0].values.CALL, 'OE8SDR/P');
  assert.equal(report.canonical.records[0].provenance.CALL[0].original, 'S53O');
});

test('split and join preserve original exchange and are reversible', () => {
  const w = workspace('CALL\tSTX_STRING\nS53O\t001 JN86CR');
  w.split(1, ' ');
  assert.deepEqual(contact(w).cells, ['S53O', '001', 'JN86CR']);
  w.mapColumn(1, { field: 'STX' });
  w.mapColumn(2, { field: 'MY_GRIDSQUARE' });
  assert.equal(w.normalized.records[0].provenance.STX[0].original, '001 JN86CR');
  assert.equal(w.normalized.records[0].provenance.MY_GRIDSQUARE[0].original, '001 JN86CR');
  w.join([1, 2]);
  assert.deepEqual(contact(w).cells, ['S53O', '001 JN86CR']);
  w.undo();
  assert.deepEqual(contact(w).cells, ['S53O', '001', 'JN86CR']);
  w.redo();
  assert.equal(w.session.columns.length, 2);
  assert.equal(w.session.source, 'CALL\tSTX_STRING\nS53O\t001 JN86CR');
});

test('user constants record their origin and station promotion is undoable', () => {
  const w = workspace();
  w.addColumn();
  const added = w.session.columns.length - 1;
  w.mapColumn(added, { field: 'OPERATOR', transform: { constant: 's53zo' } });
  const p = w.normalized.records[0].provenance.OPERATOR[0];
  assert.equal(w.normalized.records[0].values.OPERATOR, 'S53ZO');
  assert.equal(p.original, '');
  assert.ok(p.transformations.includes('User-supplied constant'));
  w.promote();
  assert.equal(w.metadata.stationCall, 'S53ZO');
  assert.equal(w.metadata.stationLocator, 'JN86CR');
  assert.equal(w.metadata.operator, 'S53ZO');
  w.undo();
  assert.deepEqual(w.metadata, {});
});

test('preset persistence reuses user mapping and can be undone or deleted', () => {
  const storage = memory();
  const first = workspace();
  first.mapColumn(indexOf(first, 'COMMENT'), { field: 'STX_STRING' });
  first.savePreset('Portable logger', storage);
  assert.equal(readImportPresets(storage).length, 1);
  const second = workspace();
  const before = second.session;
  second.applyPreset('Portable logger', storage);
  assert.equal(second.session.columns.at(-1).field, 'STX_STRING');
  second.undo();
  assert.equal(second.session, before);
  second.deletePreset('Portable logger', storage);
  assert.equal(readImportPresets(storage).length, 0);
});

test('presets with mismatched widths leave the active interpretation intact', () => {
  const storage = memory();
  workspace().savePreset('Wide', storage);
  const narrow = workspace('CALL\tMODE\nS53O\tSSB');
  const before = narrow.session;
  narrow.applyPreset('Wide', storage);
  assert.equal(narrow.session, before);
  assert.match(narrow.notice, /width differs/);
});

test('unreadable, malformed and unsupported preset envelopes are ignored', () => {
  for (const data of ['{', 'null', '{}', '[null]', '[{"version":2}]', ' '.repeat(500_001)]) assert.deepEqual(readImportPresets({ getItem: () => data }), []);
  assert.deepEqual(readImportPresets({ getItem: () => { throw Error('denied'); } }), []);
  const w = workspace();
  w.savePreset('Blocked', { getItem: () => null, setItem: () => { throw Error('quota'); } });
  assert.match(w.notice, /unavailable or full/);
  assert.equal(w.normalized.records.length, 2);
});

test('malformed persisted transformations are rejected before they can crash normalization', () => {
  const storage = memory();
  workspace().savePreset('Broken', storage);
  const baseline = JSON.parse(storage.getItem())[0];
  for (const transform of [{ constant: 42 }, { dateOrder: 'random' }, { frequencyUnit: 'metres' }, []]) {
    const preset = structuredClone(baseline);
    preset.columns[0].transform = transform;
    assert.deepEqual(readImportPresets({ getItem: () => JSON.stringify([preset]) }), [], JSON.stringify(transform));
  }
});

test('recovery retains manually selected mapping and corrected values', () => {
  const w = workspace();
  const call = indexOf(w, 'CALL');
  w.changeCell(contact(w).sourceIndex, call, 'S50C');
  w.mapColumn(indexOf(w, 'COMMENT'), { field: '' });
  const before = w.session;
  w.recover();
  assert.equal(w.session, before);
  assert.equal(w.normalized.records[0].values.CALL, 'S50C');
  assert.equal(w.session.columns.at(-1).field, '');
  assert.match(w.notice, /checked 1 interpretations/);
  assert.match(w.notice, /Manual choices were preserved/);
});

test('native output remains gated until time basis is confirmed and invalid values corrected', () => {
  const w = workspace();
  w.preview();
  assert.equal(w.result.canExport, false);
  assert.ok(w.result.diagnostics.some(item => item.code === 'IMPORT-UTC'));
  w.commit(w.session, { utcConfirmed: 'true' });
  w.preview();
  assert.equal(w.result.canExport, true, JSON.stringify(w.result.diagnostics));
  const call = indexOf(w, 'CALL');
  w.changeCell(contact(w).sourceIndex, call, '???');
  w.preview();
  assert.equal(w.result.canExport, false);
  w.undo();
  assert.equal(w.result, undefined);
  w.preview();
  assert.equal(w.result.canExport, true);
});
