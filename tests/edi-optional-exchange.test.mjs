import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectImport } from '../src/core/ingestion.ts';
import { exportImport } from '../src/core/import-export.ts';

const source = readFileSync(new URL('./fixtures/s53zo-20260906.txt', import.meta.url), 'utf8');
const metadata = {utcConfirmed:true,contestName:'Fixture',scoring:'supplied-points',ediHeaders:{TDate:'20260905;20260906'}};

test('RST/serial/locator log exports EDI with an unspecified additional exchange', () => {
  const result = exportImport(detectImport(source), 'edi', metadata);
  assert.equal(result.canExport, true, JSON.stringify(result.diagnostics));
  assert.match(result.content, /^PExch=\r?$/m);
  assert.match(result.content, /^CQSOP=3877\r?$/m);
  assert.equal(result.records, 28);
});

test('EDI representation reductions are summarized without losing canonical details', () => {
  const result = exportImport(detectImport(source), 'edi', metadata);
  assert.equal(result.lossReport.length, 2, result.lossReport.join('\n'));
  assert.ok(result.lossReport.some(note => note.includes('28') && note.includes('frequenc')));
  assert.ok(result.lossReport.some(note => note.includes('22') && note.includes('SSB')));
  assert.equal(result.report.source, source);
  assert.equal(result.report.canonical.records[0].values.FREQ, '144.3999');
  assert.equal(result.report.canonical.records[0].values.SUBMODE, 'USB');
});

test('supplied additional exchange values are preserved', () => {
  const result = exportImport(detectImport(source), 'edi', {...metadata,ediHeaders:{...metadata.ediHeaders,PExch:'DOK01'}});
  assert.equal(result.canExport, true);
  assert.match(result.content, /^PExch=DOK01\r?$/m);
});
