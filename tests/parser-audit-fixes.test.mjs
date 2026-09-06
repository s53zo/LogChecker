import test from 'node:test';
import assert from 'node:assert/strict';
import { detectImport, normalizeImport } from '../src/core/ingestion.ts';
import { importStructured } from '../src/core/import-structured.ts';
import { parseAdx, serializeAdx } from '../src/core/adx.ts';
import { exportImport } from '../src/core/import-export.ts';
import { assertImportSize } from '../src/core/import-limits.ts';

const adi = (time='1238', freq='144.3') => `<ADIF_VER:5>3.1.7<EOH><QSO_DATE:8>20260906<TIME_ON:${time.length}>${time}<CALL:4>S53O<MODE:3>SSB<FREQ:${freq.length}>${freq}<EOR>`;
test('mapped QSO evidence takes precedence over free-text summary/comment prefixes', () => {
  for (const comment of ['Total solar eclipse', 'Summary of contact', '# portable', '--- portable', '// portable']) {
    const result=normalizeImport(detectImport(`Comment,Date,Time,Call,Mode,Freq\n${comment},20260906,1238,S53O,SSB,144.3`));
    assert.equal(result.records.length,1,comment);
    assert.equal(result.records[0].values.COMMENT,comment);
  }
});
test('native MHz frequency is never guessed and native value errors can be corrected', () => {
  assert.equal(normalizeImport(importStructured(adi('1238','144000'))).records[0].values.FREQ,'144000');
  const session=importStructured(adi('9960'));
  assert.equal(exportImport(session,'adif').canExport,false);
  session.rows[0].cells[session.columns.findIndex(c=>c.field==='TIME_ON')]='1238';
  assert.equal(exportImport(session,'adif').canExport,true);
});
test('derived submode has provenance and conflicts regardless of column order', () => {
  for (const [head,values] of [['Submode,Mode','LSB,USB'],['Mode,Submode','USB,LSB']]) {
    const record=normalizeImport(detectImport(`${head},Date,Time,Call,Freq\n${values},20260906,1238,S53O,144.3`)).records[0];
    assert.ok(record.issues.some(i=>i.field==='SUBMODE'&&i.severity==='error'));
    assert.equal(record.values.SUBMODE,'LSB');
  }
  const record=normalizeImport(detectImport('Mode,Date,Time,Call,Freq\nUSB,20260906,1238,S53O,144.3')).records[0];
  assert.equal(record.provenance.SUBMODE[0].original,'USB');
});
test('ADX requires well formed XML and never discards malformed record fragments', () => {
  for (const source of ['<ADX><RECORDS><RECORD></RECORD><RECORD></RECORDS></ADX>', '<ADX><RECORDS></ADX></RECORDS>', '<ADX/><ADX/>', '<ADX><RECORDS/><CALL>&bogus;</CALL></ADX>', '<ADX><RECORDS/><CALL>&#0;</CALL></ADX>', '<ADX><RECORDS/><CALL A="x" A="y"/></ADX>', '<ADX><RECORDS/><CALL>\uD800</CALL></ADX>']) assert.throws(()=>parseAdx(source),undefined,source);
});
test('ADX reads CDATA, entities and quoted attribute delimiters without source loss', () => {
  const document=parseAdx('<ADX><RECORDS><RECORD><COMMENT><![CDATA[a < b & c]]></COMMENT><APP PROGRAMID="P" FIELDNAME="X" TYPE="S">a &amp; b</APP><CALL A=">">S53O</CALL></RECORD></RECORDS></ADX>');
  assert.equal(document.records[0].tags[0].value,'a < b & c');
  assert.equal(document.records[0].tags[1].value,'a & b');
  assert.equal(document.records[0].tags[2].value,'S53O');
  document.records[0].tags[0].value='bad\u0001';
  assert.throws(()=>serializeAdx(document));
});
test('native import limits source, field union and dense cell expansion', () => {
  assert.throws(()=>importStructured('x'.repeat(5_000_001),'test.adi'),/limit|exceeds/i);
  const fields=Array.from({length:257},(_,i)=>`<X${i}:1>x`).join('');
  assert.throws(()=>importStructured(`<EOH>${fields}<EOR>`),/columns/i);
  const records=Array.from({length:5001},(_,i)=>`<X${i%201}:1>x<EOR>`).join('');
  assert.throws(()=>importStructured(`<EOH>${records}`),/cells/i);
  assert.doesNotThrow(()=>assertImportSize(50000,20));
  assert.throws(()=>assertImportSize(50001,1),/records/i);
  assert.throws(()=>assertImportSize(4000,256),/cells/i);
});
test('XML validation checks nested structures, declarations, attributes and entities', () => {
  const invalid = ['<ADX><RECORDS/><A x="unterminated></A></ADX>', '<ADX><RECORDS/><A x="&amp"/></ADX>', '<ADX><RECORDS/><A x="a"y="b"/></ADX>', '<ADX><RECORDS/><A>&#x110000;</A></ADX>', '<ADX><RECORDS/><A><!-- a--b --></A></ADX>', '<?xml version="1.1"?><ADX><RECORDS/></ADX>', '<!DOCTYPE ADX><ADX><RECORDS/></ADX>', '<ADX><RECORDS/><EXTRA/></ADX>'];
  for (const source of invalid) assert.throws(()=>parseAdx(source),undefined,source);
  const document=parseAdx('<?xml version="1.0" encoding="UTF-8"?><adx:ADX xmlns:adx="urn:adif"><adx:RECORDS><adx:RECORD><adx:COMMENT>&amp;#65; &#x1F600;</adx:COMMENT></adx:RECORD></adx:RECORDS></adx:ADX>');
  assert.equal(document.records[0].tags[0].value,'&#65; 😀');
});
test('native truncated ADIF remains a source-integrity blocker after cell edits', () => {
  const session=importStructured(adi()+'<CALL:20>broken');
  session.rows[0].cells[session.columns.findIndex(c=>c.field==='TIME_ON')]='1240';
  assert.equal(exportImport(session,'adif').canExport,false);
  assert.match(session.metadata.IMPORT_SOURCE_ERRORS,/Unparsed/);
});
