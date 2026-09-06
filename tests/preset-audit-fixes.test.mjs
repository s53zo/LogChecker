import test from 'node:test';
import assert from 'node:assert/strict';
import { detectImport } from '../src/core/ingestion.ts';
import { ImportWorkspace, readImportPresets } from '../src/core/import-workspace.ts';
import { dispatchImportTask } from '../src/core/import-tasks.ts';
import { importStructured } from '../src/core/import-structured.ts';

const source = 'Date\tTime\tCall\tFreq\tMode\tExchange\n20260906\t1200\tS53O\t144.3\tSSB\t001 JN86CR Portable';
const workspace = (text = source) => new ImportWorkspace(detectImport(text, { strategy: 'delimited', delimiter: '\t', headerRow: 0 }));
const memory = () => {
  let raw = null;
  return { getItem: () => raw, setItem: (_, value) => { raw = value; } };
};
const row = w => w.session.rows.find(item => item.included);

test('saved added constant column replays on fresh and already transformed source exactly once', () => {
  const storage = memory(), first = workspace();
  first.addColumn();
  first.mapColumn(6, { field: 'OPERATOR', transform: { constant: 's53zo' } });
  first.savePreset('Operator', storage);
  const second = workspace();
  second.applyPreset('Operator', storage);
  assert.equal(second.session.columns.length, 7);
  assert.equal(second.normalized.records[0].values.OPERATOR, 'S53ZO');
  assert.equal(second.normalized.records[0].provenance.OPERATOR[0].original, '');
  assert.equal(second.session.source, source);
  second.applyPreset('Operator', storage);
  assert.equal(second.session.columns.length, 7);
  assert.equal(second.session.recipe.steps.length, 1);
  second.undo(); second.undo();
  assert.equal(second.session.columns.length, 6);
  assert.equal(second.session.recipe, undefined);
  second.redo();
  assert.equal(second.normalized.records[0].values.OPERATOR, 'S53ZO');
});

test('structural recipes preserve the native parser for known ADIF sources', () => {
  const text = '<ADIF_VER:5>3.1.7<EOH><CALL:4>S53O<QSO_DATE:8>20260906<TIME_ON:4>1200<FREQ:5>144.3<MODE:3>SSB<EOR>';
  const storage = memory(), first = new ImportWorkspace(importStructured(text));
  first.addColumn();
  first.mapColumn(5, { field: 'OPERATOR', transform: { constant: 'S53ZO' } });
  first.savePreset('Native', storage);
  const second = new ImportWorkspace(importStructured(text.replace('S53O', 'S50C')));
  second.applyPreset('Native', storage);
  assert.equal(second.normalized.records[0].values.CALL, 'S50C');
  assert.equal(second.normalized.records[0].values.OPERATOR, 'S53ZO');
  assert.equal(second.session.selectedCandidateId, 'structured');
  assert.equal(second.session.columns.length, 6);
});

test('split and join recipes preserve source provenance and use saved widths on new matching rows', () => {
  const storage = memory(), first = workspace();
  first.split(5, ' ');
  first.join([6, 7]);
  first.mapColumn(5, { field: 'STX' });
  first.mapColumn(6, { field: 'COMMENT' });
  first.addColumn();
  first.mapColumn(7, { field: 'OPERATOR', transform: { constant: 'S53ZO' } });
  first.savePreset('Exchanges', storage);
  const nextSource = source.replace('001 JN86CR Portable', '002 JN76AA Home station');
  const second = workspace(nextSource), before = second.session;
  second.applyPreset('Exchanges', storage);
  assert.deepEqual(row(second).cells.slice(5), ['002', 'JN76AA Home station', '']);
  const record = second.normalized.records[0];
  assert.equal(record.values.STX, '002');
  assert.equal(record.values.COMMENT, 'JN76AA Home station');
  assert.equal(record.values.OPERATOR, 'S53ZO');
  assert.equal(record.provenance.STX[0].original, '002 JN76AA Home station');
  assert.equal(record.provenance.STX[0].sourceIndex, 1);
  assert.equal(second.session.source, nextSource);
  const applied = second.session;
  second.undo(); assert.equal(second.session, before);
  second.redo(); assert.equal(second.session, applied);
  second.savePreset('Reused', storage);
  const third = workspace(); third.applyPreset('Reused', storage);
  assert.equal(third.session.recipe.steps.length, 3);
  assert.deepEqual(row(third).cells.slice(5), ['001', 'JN86CR Portable', '']);
});

test('recipes survive worker serialization and structural undo while fresh parsing resets them', () => {
  const first = workspace(); first.addColumn();
  const result = dispatchImportTask({ kind: 'workspace', state: structuredClone(first.taskState()), operation: 'split', index: 5, value: ' ' });
  first.commit(); first.applyTaskState(result.state, result.normalized);
  assert.deepEqual(first.session.recipe.steps.map(step => step.kind), ['add-column', 'split']);
  first.undo(); assert.equal(first.session.recipe.steps.length, 1);
  first.redo(); assert.equal(first.session.recipe.steps.length, 2);
  first.reparse(first.session.options);
  assert.equal(first.session.recipe, undefined);
  assert.equal(first.session.columns.length, 6);
  first.undo(); assert.equal(first.session.recipe.steps.length, 2);
  first.candidate('delimiter-0');
  assert.equal(first.session.recipe, undefined);
});

test('malformed and oversized structural recipes are rejected before changing the working copy', () => {
  const storage = memory(), first = workspace(); first.addColumn(); first.savePreset('Recipe', storage);
  const baseline = JSON.parse(storage.getItem())[0];
  const malformed = [
    null, {}, { baseSignature: ['call'], steps: [{ kind: 'eval', code: 'throw 1' }] },
    { baseSignature: baseline.recipe.baseSignature, steps: [{ kind: 'split', index: 999, width: 2, separator: ' ' }] },
    { baseSignature: baseline.recipe.baseSignature, steps: [{ kind: 'split', index: 0, width: 999999, separator: ' ' }] },
    { baseSignature: baseline.recipe.baseSignature, steps: [{ kind: 'join', indexes: [0, 0] }] },
    { baseSignature: baseline.recipe.baseSignature, steps: Array.from({ length: 101 }, () => ({ kind: 'add-column' })) },
  ];
  for (const recipe of malformed) {
    const badStorage = { getItem: () => JSON.stringify([{ ...baseline, recipe }]) };
    assert.deepEqual(readImportPresets(badStorage), []);
    const next = workspace(), before = next.session;
    next.applyPreset('Recipe', badStorage);
    assert.equal(next.session, before);
  }
});

test('structural presets reject different source headers despite matching widths; legacy presets still load', () => {
  const storage = memory(), first = workspace(); first.addColumn(); first.savePreset('Recipe', storage);
  const second = workspace(source.replace('Exchange', 'Other')), before = second.session;
  second.applyPreset('Recipe', storage);
  assert.equal(second.session, before);
  assert.match(second.notice, /source columns differ/);
  const old = workspace(); old.mapColumn(5, { field: 'COMMENT' }); old.savePreset('Legacy', storage);
  const third = workspace(); third.applyPreset('Legacy', storage);
  assert.equal(third.session.columns[5].field, 'COMMENT');
  assert.equal(third.session.recipe, undefined);
});

test('split and added columns enforce shared cell and preset width limits atomically', () => {
  const first = workspace();
  first.session = { ...first.session, rows: Array(50000).fill(row(first)), columns: Array(20).fill(first.session.columns[5]) };
  const before = first.session;
  assert.throws(() => first.addColumn(), /limit|exceed/i);
  assert.equal(first.session, before);
  assert.throws(() => first.split(5, ' '), /limit|exceed/i);
  assert.equal(first.session, before);
});
