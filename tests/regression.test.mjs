import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseAdif, serializeAdif, updateAdifTag, adifValue } from '../src/core/adif.ts';
import { parseCabrillo, serializeCabrillo, updateHeader } from '../src/core/cabrillo.ts';
import { parseEdi, serializeEdi, ediField, ediHeader, calculateEdiScore, ediToAdif } from '../src/core/edi.ts';
import { detectFormat, decodeLogFile } from '../src/core/format.ts';
import { parseTextTable, serializeTextTable, tableTransforms, splitColumn, joinColumns, renameColumn, moveColumns, deleteRows, shiftRows } from '../src/core/tabular.ts';
import { textTableToAdif, textTableToCsv } from '../src/core/table-converter.ts';
import { adif, cabrillo, edi, adx } from './fixtures/import-corpus.mjs';

test('original S53ZO fixture independently matches supplied acceptance facts', () => {
  const source = readFileSync(new URL('./fixtures/s53zo-20260906.txt', import.meta.url), 'utf8');
  const records = source.trim().split('\n').slice(1).map((line) => line.trim().split(/\s+/));
  assert.equal(records.length, 28);
  assert.equal(records.reduce((sum, row) => sum + Number(row[12]), 0), 3877);
  assert.deepEqual([...new Set(records.map((row) => row[4]))], ['S53ZO']);
  assert.deepEqual([...new Set(records.map((row) => row[7]))], ['JN86CR']);
  assert.deepEqual(records.map((row) => row[6]), Array.from({ length: 28 }, (_, index) => String(index + 1).padStart(3, '0')));
  const odx = records.reduce((best, row) => Number(row[12]) > Number(best[12]) ? row : best);
  assert.deepEqual([odx[8], odx[11], odx[12]], ['IQ5NN', 'JN63GN', '455']);
});

test('existing format detection recognizes native formats regardless of misleading extension', () => {
  for (const [source, expected] of [[adif, 'adif'], [adx, 'adif'], [cabrillo, 'cabrillo'], [edi, 'edi']]) assert.equal(detectFormat(source, 'input.txt'), expected);
  assert.equal(detectFormat('CALL\tMODE\nS53O\tSSB', 'input.txt'), 'text');
});

test('unmodified native documents round-trip without changing source', () => {
  for (const [source, parse, serialize] of [[adif, parseAdif, serializeAdif], [cabrillo, parseCabrillo, serializeCabrillo], [edi, parseEdi, serializeEdi]]) {
    for (const newline of ['\n', '\r\n', '\r']) {
      const text = source.replaceAll('\n', newline);
      assert.equal(serialize(parse(text)), text);
    }
  }
});

test('ADIF edits preserve unrelated fields and original document', () => {
  const before = parseAdif(adif);
  const after = updateAdifTag(before, before.records[0].id, 'call', 'OE8SDR/P');
  const reread = parseAdif(serializeAdif(after));
  assert.equal(adifValue(before.records[0], 'CALL'), 'S53O');
  assert.equal(adifValue(reread.records[0], 'CALL'), 'OE8SDR/P');
  assert.equal(adifValue(reread.records[0], 'STX'), '001');
  assert.equal(adifValue(reread.records[0], 'FREQ'), '144.39990');
});

test('Cabrillo header editing preserves QSO text', () => {
  const before = parseCabrillo(cabrillo);
  const after = updateHeader(before, 'CALLSIGN', 'S50C');
  assert.match(serializeCabrillo(after), /CALLSIGN: S50C/);
  assert.match(serializeCabrillo(before), /CALLSIGN: S53ZO/);
  assert.equal(after.lines.find((line) => line.type === 'qso').raw, before.lines.find((line) => line.type === 'qso').raw);
});

test('EDI parsing, score and ADIF conversion retain contact identity and reports', () => {
  const document = parseEdi(edi);
  assert.equal(document.records.length, 1);
  assert.equal(ediHeader(document, 'PCall'), 'S53ZO');
  assert.equal(ediField(document.records[0], 'CALL'), 'S53O');
  assert.equal(calculateEdiScore(document, 'points').qsoPoints, 16);
  const converted = parseAdif(ediToAdif(document).content);
  assert.equal(adifValue(converted.records[0], 'CALL'), 'S53O');
  assert.equal(adifValue(converted.records[0], 'RST_SENT'), '59');
  assert.equal(adifValue(converted.records[0], 'MODE'), 'SSB');
});

test('table transformations isolate selected cells and preserve original text', () => {
  const table = parseTextTable(' a ;1\n b ;2', ';');
  const preview = tableTransforms.trim(table, { rowIds: [table.rows[0].id], columnIndexes: [0] });
  assert.equal(preview.after.rows[0].cells[0], 'a');
  assert.equal(preview.after.rows[1].cells[0], ' b ');
  assert.equal(table.rows[0].cells[0], ' a ');
  assert.equal(preview.after.rows[0].original, ' a ;1');
  assert.equal(preview.changes.length, 1);
});

test('table split, join and column movement preserve ordering and inputs', () => {
  const table = parseTextTable('S53O/JN86AT;001\nHA2R/JN87UE;023', ';');
  const split = splitColumn(table, 0, '/').after;
  assert.deepEqual(split.rows[0].cells, ['S53O', 'JN86AT', '001']);
  assert.deepEqual(joinColumns(split, [0, 1], true).after.rows[0].cells, ['S53O JN86AT', '001']);
  assert.deepEqual(moveColumns(split, [2], 'left').after.rows[0].cells, ['S53O', '001', 'JN86AT']);
  assert.deepEqual(table.rows[0].cells, ['S53O/JN86AT', '001']);
  assert.equal(splitColumn(table, 0, '').warnings.length, 1);
});

test('row deletion and shifts have reviewable change records', () => {
  const table = parseTextTable('S53O;001\nHA2R;023', ';');
  assert.equal(deleteRows(table, [table.rows[0].id]).after.rows[0].cells[0], 'HA2R');
  const shifted = shiftRows(table, [table.rows[0].id], 'left');
  assert.deepEqual(shifted.after.rows[0].cells, ['001', '']);
  assert.equal(shifted.lossy, true);
  assert.equal(shifted.warnings.length, 1);
  assert.equal(table.rows.length, 2);
});

test('existing table conversion respects mapping and quotes CSV output', () => {
  let table = parseTextTable('S53O;20260906;1238;SSB;144.3999', ';');
  ['CALL', 'QSO_DATE', 'TIME_ON', 'MODE', 'FREQ'].forEach((name, index) => { table = renameColumn(table, index, name).after; });
  const converted = textTableToAdif(table);
  assert.equal(converted.records, 1);
  assert.equal(adifValue(parseAdif(converted.content).records[0], 'CALL'), 'S53O');
  table.rows[0].cells[0] = 'a,"b"';
  assert.match(textTableToCsv(table).content, /"a,""b"""/);
  assert.equal(serializeTextTable(parseTextTable('a;b\nc;d', ';')), 'a;b\nc;d');
});

test('file decoding recognizes Unicode BOM and reports legacy fallback', () => {
  assert.deepEqual(decodeLogFile(Uint8Array.of(239, 187, 191, 65).buffer), { text: 'A', encoding: 'UTF-8 BOM' });
  assert.deepEqual(decodeLogFile(Uint8Array.of(255, 254, 65, 0).buffer), { text: 'A', encoding: 'UTF-16 LE' });
  const legacy = decodeLogFile(Uint8Array.of(0xe9).buffer);
  assert.equal(legacy.text, 'é');
  assert.equal(legacy.encoding, 'Windows-1252');
  assert.ok(legacy.warning);
});
