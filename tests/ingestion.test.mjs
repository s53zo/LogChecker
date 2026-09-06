import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { detectImport, normalizeImport, selectImportCandidate } from '../src/core/ingestion.ts';
import { corpus, largeLog } from './fixtures/import-corpus.mjs';

test('S53ZO grouped table preserves all QSOs, serials, points and provenance', () => {
  const source = readFileSync(new URL('./fixtures/s53zo-20260906.txt', import.meta.url), 'utf8');
  const session = detectImport(source), result = normalizeImport(session);
  assert.equal(session.source, source);
  assert.equal(result.records.length, 28);
  assert.equal(result.records.reduce((n, r) => n + Number(r.values.QSO_POINTS), 0), 3877);
  assert.equal(result.issues.length, 0);
  assert.equal(result.metadata.STATION_CALLSIGN, 'S53ZO');
  assert.equal(result.metadata.MY_GRIDSQUARE, 'JN86CR');
  assert.equal(result.records[0].values.FREQ, '144.3999');
  assert.equal(result.records[0].values.STX, '001');
  assert.equal(result.records[27].values.CALL, 'OE3XOB/P');
  assert.equal(result.records[22].values.MODE, 'CW');
  assert.equal(result.records[0].provenance.FREQ[0].original, '144399,90');
});

for (const name of ['csv','tsv','semicolon','pipe','quoted','multilineQuoted','mixedNewlines','repeatedHeader','commentsAndSummary']) {
  test(`${name}: auto-detects valid records and preserves values`, () => {
    const result = normalizeImport(detectImport(corpus[name]));
    assert.equal(result.records.length, 2);
    assert.equal(result.records[0].values.CALL, 'S53O');
    assert.equal(result.records[1].values.SRX, '437');
    assert.deepEqual(result.issues, []);
    if (name === 'multilineQuoted') assert.equal(result.records[0].values.COMMENT, 'First line\nsecond line');
    if (name === 'quoted') assert.equal(result.records[0].values.COMMENT, 'He said "hello", then left');
  });
}
test('manual fixed-width boundaries and candidate switching are deterministic', () => {
  const options = { strategy: 'fixed-width', boundaries: Array.from({length:13}, (_,i)=>(i+1)*20) };
  const session = detectImport(corpus.fixedWidth, options);
  assert.equal(normalizeImport(session).records[1].values.CALL, 'HA2R');
  assert.deepEqual(detectImport(corpus.csv).candidates, detectImport(corpus.csv).candidates);
  assert.equal(selectImportCandidate(session, 'whitespace').selectedCandidateId, 'whitespace');
});
test('ambiguous exchanges and headerless sent/received pairs are not invented', () => {
  const session = detectImport(corpus.ambiguousExchanges);
  assert.equal(session.columns[5].field, '');
  assert.equal(session.columns[6].field, '');
  assert.equal(normalizeImport(session).records[0].unmapped['import-column-5'], '001');
  const headerless = detectImport(corpus.headerless);
  assert.ok(!headerless.columns.some(c=>c.field==='STATION_CALLSIGN'));
});
test('multiline grouped headers are excluded and mapped', () => {
  const result = normalizeImport(detectImport(corpus.groupedHeaders));
  assert.equal(result.records.length, 2);
  assert.equal(result.records[1].values.CALL, 'HA2R');
});
test('ambiguous dates need explicit order; invalid calendar dates stay errors', () => {
  const session = detectImport(corpus.dateVariants);
  assert.ok(normalizeImport(session).issues.some(i=>i.code==='ambiguous-date'));
  session.columns.find(c=>c.field==='QSO_DATE').transform.dateOrder='dmy';
  assert.equal(normalizeImport(session).records[1].values.QSO_DATE, '20260906');
  session.rows.find(r=>r.included).cells[0] = '2026-02-30';
  assert.ok(normalizeImport(session).issues.some(i=>i.code==='invalid-date'));
});
test('malformed values, shifted cells, duplicates and conflicting mappings are surfaced', () => {
  assert.ok(normalizeImport(detectImport(corpus.malformed)).issues.some(i=>i.code==='invalid-call'));
  assert.ok(normalizeImport(detectImport(corpus.malformed)).issues.some(i=>i.code==='invalid-locator'));
  assert.ok(normalizeImport(detectImport(corpus.shiftedCells)).issues.length);
  assert.equal(normalizeImport(detectImport(corpus.duplicates)).issues.filter(i=>i.code==='duplicate-row').length, 1);
  const session=detectImport(corpus.csv); session.columns[4].field='CALL';
  assert.ok(normalizeImport(session).issues.some(i=>i.code==='duplicate-mapping'));
});
test('plausible shifted numeric cells block export until current row width is repaired', () => {
  const session=detectImport('Date,Time,Call,Mode,Freq,STX,SRX,QSO_POINTS\n20260906,1238,S53O,SSB,144.3,232,16');
  assert.ok(normalizeImport(session).issues.some(i=>i.code==='structure' && i.severity==='error'));
  session.rows.find(r=>r.included).cells.splice(5,0,'001');
  const repaired=normalizeImport(session);
  assert.ok(!repaired.issues.some(i=>i.code==='structure'));
  assert.equal(repaired.records[0].values.STX,'001');
  assert.equal(repaired.records[0].values.SRX,'232');
  const blankComment=detectImport('Date,Time,Call,Mode,Freq,Comment\n20260906,1238,S53O,SSB,144.3');
  assert.ok(normalizeImport(blankComment).issues.some(i=>i.code==='structure'));
  blankComment.rows.find(r=>r.included).cells.push('');
  assert.ok(!normalizeImport(blankComment).issues.some(i=>i.code==='structure'));
});
test('single-digit hour with seconds is normalized and malformed time stays invalid', () => {
  const session=detectImport('Date,Time,Call,Mode,Freq\n20260906,9:05:03,S53O,SSB,144.3');
  const result=normalizeImport(session);
  assert.equal(result.records[0].values.TIME_ON,'090503');
  assert.ok(!result.issues.some(i=>i.code==='invalid-time'));
  session.rows.find(r=>r.included).cells[1]='9:65:03';
  assert.ok(normalizeImport(session).issues.some(i=>i.code==='invalid-time'));
});
test('a trailing Comment header does not mask missing numeric exchange cells', () => {
  const session=detectImport('Date,Time,Call,Mode,Freq,STX,SRX,QSO_POINTS,Comment\n20260906,1238,S53O,SSB,144.3,232,16,17');
  assert.ok(normalizeImport(session).issues.some(i=>i.code==='structure' && i.severity==='error'));
  const explicitEmpty=detectImport('Date,Time,Call,Mode,Freq,STX,SRX,QSO_POINTS,Comment\n20260906,1238,S53O,SSB,144.3,001,232,16,');
  assert.ok(!normalizeImport(explicitEmpty).issues.some(i=>i.code==='structure'));
});
test('edited cells retain source provenance and constants are explicit', () => {
  const session=detectImport(corpus.csv); session.rows.find(r=>r.included).cells[8]='S59P';
  session.columns[6].transform.constant='999';
  const record=normalizeImport(session).records[0];
  assert.equal(record.values.CALL,'S59P'); assert.equal(record.provenance.CALL[0].original,'S53O');
  assert.equal(record.values.STX,'999'); assert.equal(record.provenance.STX[0].original,'001');
});
test('mixed bands are retained per record and not promoted', () => {
  const result=normalizeImport(detectImport(corpus.mixedBands));
  assert.deepEqual(result.records.map(r=>r.values.BAND),['2M','70CM']);
  assert.equal(result.metadata.BAND, undefined);
});
test('malformed quoted input warns; explicit size limits fail clearly', () => {
  const session=detectImport(corpus.unclosedQuote,{strategy:'delimited',delimiter:','});
  assert.ok(session.rows.some(r=>r.warnings.some(w=>w.includes('Unclosed'))));
  assert.throws(()=>detectImport('x'.repeat(5_000_001)),/5 MB/);
});
test('malformed CSV quotes are blocking errors instead of silent string repairs', () => {
  for (const comment of ['"hello"bad', 'unquoted"quote', '"unterminated']) {
    const source = `Date,Time,Call,Mode,Freq,Comment\n20260906,1238,S53O,SSB,144.3,${comment}`;
    const result = normalizeImport(detectImport(source, {strategy:'delimited',delimiter:','}));
    assert.ok(result.issues.some(i=>i.code==='malformed-record' && i.severity==='error'));
    assert.equal(result.records[0].original,source.split('\n')[1]);
  }
});
test('large logs and deterministic fuzz input terminate without parser crashes', () => {
  assert.equal(normalizeImport(detectImport(largeLog(10000))).records.length,10000);
  let state=817;
  for(let run=0;run<100;run++) { let source=''; for(let i=0;i<100;i++){state=(Math.imul(state,1664525)+1013904223)>>>0;source+='ABC0123,;|\t\n" '[state%14];} assert.doesNotThrow(()=>normalizeImport(detectImport(source))); }
});
test('whitespace comment tails preserve internal spacing without extra columns', () => {
  const session = detectImport('Date Time Call Mode Freq Comment\n20260906 1238 S53O SSB 144.3 First  contact with friend');
  const result = normalizeImport(session);
  assert.equal(session.columns.length, 6);
  assert.equal(result.records[0].values.COMMENT, 'First  contact with friend');
});
test('explicit fixed width can begin with no boundaries', () => {
  const session = detectImport('abcdef', {strategy:'fixed-width',boundaries:[]});
  assert.equal(session.selectedCandidateId, 'fixed-width');
  assert.equal(session.columns.length, 1);
});
test('a failing alternative delimiter does not abort a valid TSV interpretation', () => {
  const source='Date\tTime\tCall\tMode\tFreq\tComment\n20260906\t1238\tS53O\tSSB\t144.3\t'+','.repeat(300);
  const session=detectImport(source);
  assert.equal(normalizeImport(session).records[0].values.CALL, 'S53O');
  assert.ok(session.candidates.find(c=>c.delimiter===',').score < 0);
});
test('UTC evidence is required and numeric HF frequency is never inferred as time', () => {
  const session = detectImport('20260906 1238 14100 SSB S53O');
  assert.notEqual(session.columns[2].field, 'TIME_ON');
  assert.equal(session.metadata.UTC_STATUS, undefined);
  assert.equal(detectImport('Timezone: UTC\n'+corpus.tsv).metadata.UTC_STATUS,'UTC');
  assert.equal(detectImport('Date\tUTC\tCall\tMode\tFreq\n20260906\t1238\tS53O\tSSB\t144.3').metadata.UTC_STATUS,'UTC');
});
