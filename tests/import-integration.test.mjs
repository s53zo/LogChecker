import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectImport } from '../src/core/ingestion.ts';
import { ImportWorkspace, readImportPresets } from '../src/core/import-workspace.ts';
import { renderImportWorkspace } from '../src/ui/import-view.ts';
import { detectFormat } from '../src/core/format.ts';

test('missing trailing source cells can be filled without losing the original', () => {
  const source = 'Date,Time,Call,Mode,Freq,Comment\n20260906,1238,S53O,SSB,144.3';
  const w = new ImportWorkspace(detectImport(source));
  w.changeCell(1, 5, 'Added by user');
  assert.equal(w.normalized.records[0].values.COMMENT, 'Added by user');
  assert.equal(w.session.source, source);
  assert.equal(w.normalized.records[0].provenance.COMMENT[0].original, '');
  w.undo();
  assert.equal(w.normalized.records[0].values.COMMENT, undefined);
});

test('a rejected delimiter candidate cannot crash workspace recovery', () => {
  const source = 'Date\tTime\tCall\tMode\tFreq\tComment\n20260906\t1238\tS53O\tSSB\t144.3\t' + ','.repeat(300);
  const w = new ImportWorkspace(detectImport(source));
  w.commit(w.session, {utcConfirmed: 'true'}, 'adif', false);
  assert.doesNotThrow(() => w.recover());
  assert.equal(w.result.canExport, true);
  const report = JSON.parse(w.report());
  assert.equal(report.source, source);
  assert.ok(report.recoveryAttempts.length >= 1);
});

test('preset save and deletion are reversible in browser storage', () => {
  let raw = null;
  const storage = {getItem: () => raw, setItem: (_key, value) => {raw = value;}};
  const w = new ImportWorkspace(detectImport('CALL,MODE\nS53O,SSB'));
  w.savePreset('My mapping', storage);
  assert.equal(readImportPresets(storage).length, 1);
  w.undo();
  assert.equal(readImportPresets(storage).length, 0);
  w.redo();
  w.deletePreset('My mapping', storage);
  assert.equal(readImportPresets(storage).length, 0);
  w.undo();
  assert.equal(readImportPresets(storage).length, 1);
});

test('import rendering escapes untrusted source, mappings, metadata, presets and diagnostics', () => {
  const payload = '<img src=x onerror="alert(1)">';
  const w = new ImportWorkspace(detectImport('Date,Time,Call,Mode,Freq,Comment\n20260906,1238,S53O,SSB,144.3,' + payload));
  w.session.columns[0].name = payload;
  const html = renderImportWorkspace({session:w.session, normalized:w.normalized, target:'adif', metadata:{stationCall:payload}, canUndo:false, canRedo:false, page:0, notice:payload, presets:[{id:payload,name:payload}], result:{content:payload,canExport:false,diagnostics:[{severity:'error',message:payload}],lossReport:[payload]}});
  assert.ok(!html.includes(payload));
  assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'));
  assert.ok(!/<script\b/i.test(html));
});

test('plain text .log reports enter table inference rather than empty Cabrillo', () => {
  assert.equal(detectFormat('Date Time Call Mode\n20260906 1238 S53O USB', 'logger.log'), 'text');
  assert.equal(detectFormat('CALLSIGN: S53ZO\nCONTEST: CQ-WPX-CW', 'logger.log'), 'cabrillo');
});

test('provenance distinguishes safe normalization, suggestions, ambiguity and explicit edits', () => {
  const w = new ImportWorkspace(detectImport('Date,Time,Call,Mode,Freq\n06/09/2026,1238,s53o,usb,"144399,90"'));
  let record = w.normalized.records[0];
  assert.equal(record.provenance.CALL[0].classification, 'lossless-normalization');
  assert.equal(record.provenance.FREQ[0].classification, 'suggested-repair');
  assert.equal(record.provenance.QSO_DATE[0].classification, 'ambiguous');
  w.changeCell(1, 2, '???');
  assert.equal(w.normalized.records[0].provenance.CALL[0].classification, 'unsupported');
  w.changeCell(1, 2, 'S50C');
  assert.equal(w.normalized.records[0].provenance.CALL[0].classification, 'user-supplied');
});
