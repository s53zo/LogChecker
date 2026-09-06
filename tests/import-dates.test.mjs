import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectImport } from '../src/core/ingestion.ts';
import { ImportWorkspace } from '../src/core/import-workspace.ts';
import { importDateRange } from '../src/core/import-dates.ts';
import { renderImportWorkspace } from '../src/ui/import-view.ts';

const source = readFileSync(new URL('./fixtures/s53zo-20260906.txt',import.meta.url),'utf8');
const workspace = () => new ImportWorkspace(detectImport(source));
function preview(w) {
  w.commit(w.session,{...w.metadata,utcConfirmed:'true',contestName:'Fixture',scoring:'supplied-points'},'edi',false);
  w.preview();
  return w.result;
}

test('single-day log fills both date controls and EDI header without manual dates', () => {
  const w = workspace();
  const html = renderImportWorkspace({session:w.session,normalized:w.normalized,metadata:{},target:'edi',canUndo:false,canRedo:false,presets:[],page:0,notice:''});
  assert.match(html,/data-import-value="contestStart" value="20260906"/);
  assert.match(html,/data-import-value="contestEnd" value="20260906"/);
  const result = preview(w);
  assert.equal(result.canExport,true,JSON.stringify(result.diagnostics));
  assert.match(result.content,/TDate=20260906;20260906/);
});

test('date range uses earliest/latest selected contacts, independent of row order', () => {
  const w = workspace();
  w.changeCell(1,0,'20260908');
  w.changeCell(2,0,'20260905');
  assert.deepEqual(importDateRange(w.normalized),{start:'20260905',end:'20260908'});
  w.changeRow(2,{included:false});
  assert.deepEqual(importDateRange(w.normalized),{start:'20260906',end:'20260908'});
  w.undo();
  assert.deepEqual(importDateRange(w.normalized),{start:'20260905',end:'20260908'});
});

test('editing one date preserves the other inferred date and undo restores automatic range', () => {
  const w = workspace();
  w.commit(w.session,{contestStart:'2026-09-05'});
  assert.equal(w.exportMetadata().ediHeaders.TDate,'20260905;20260906');
  w.undo();
  assert.equal(w.exportMetadata().ediHeaders.TDate,undefined);
  assert.match(preview(w).content,/TDate=20260906;20260906/);
});

test('existing native contest interval remains authoritative unless overridden', () => {
  const w = workspace();
  w.session.metadata.TDate='20260905;20260907';
  assert.deepEqual(importDateRange(w.normalized),{start:'20260905',end:'20260907'});
  w.commit(w.session,{contestEnd:'20260908'});
  assert.equal(w.exportMetadata().ediHeaders.TDate,'20260905;20260908');
});

test('invalid or missing dates do not become inferred dates or permit export', () => {
  const w = workspace();
  for (const row of w.session.rows.filter(row=>row.included)) w.changeCell(row.sourceIndex,0,'20260230');
  assert.deepEqual(importDateRange(w.normalized),{start:'',end:''});
  assert.equal(preview(w).canExport,false);
});
