import test from 'node:test';
import assert from 'node:assert/strict';
import { exportImport } from '../src/core/import-export.ts';
import { parseEdi, ediHeader } from '../src/core/edi.ts';

function document(values = {}, original = 'original input') {
  return {records:[{id:'row-1',sourceIndex:0,original,values:{CALL:'S53O',QSO_DATE:'20260906',TIME_ON:'1238',MODE:'SSB',BAND:'2M',STATION_CALLSIGN:'S53ZO',MY_GRIDSQUARE:'JN86CR',GRIDSQUARE:'JN86AT',QSO_POINTS:'16',...values},provenance:{},unmapped:{note:'=original'},issues:[]}],metadata:{},issues:[],warnings:[]};
}
const metadata = {utcConfirmed:true,contestName:'TEST',scoring:'claimed',claimedScore:'32',ediHeaders:{TDate:'20260906;20260906',PExch:'#'}};

test('EDI preserves an explicit band multiplier and rejects incompatible points-only scoring', () => {
  const settings = {...metadata,ediHeaders:{...metadata.ediHeaders,CQSOs:'1;2'}};
  const result = exportImport(document(), 'edi', settings);
  assert.equal(result.canExport,true,JSON.stringify(result.diagnostics));
  assert.equal(ediHeader(parseEdi(result.content),'CQSOs'),'1;2');
  const conflict = exportImport(document(),'edi',{...settings,scoring:'supplied-points'});
  assert.equal(conflict.canExport,false);
  assert.ok(conflict.diagnostics.some(d => d.code === 'IMPORT-SCORING-CONFLICT'));
  for (const CQSOs of ['1','1;garbage','1;Infinity','1;-2','1;2;3','1.5;2']) {
    assert.equal(exportImport(document(),'edi',{...metadata,ediHeaders:{...metadata.ediHeaders,CQSOs}}).canExport,false,CQSOs);
  }
});

test('EDI blocks retained native codes that contradict edited modes while preserving crossmodes', () => {
  for (const values of [{MODE:'CW',EDI_MODE_CODE:'1'},{MODE:'SSB',SUBMODE:'CW',EDI_MODE_CODE:'1'},{MODE:'FT8',EDI_MODE_CODE:'1'},{MODE:'SSB-CW',EDI_MODE_CODE:'1'}]) {
    const result=exportImport(document(values),'edi',metadata);
    assert.equal(result.canExport,false);
    assert.ok(result.diagnostics.some(d => d.code === 'IMPORT-EDI-MODE-CONFLICT'));
  }
  for (const [MODE,EDI_MODE_CODE] of [['SSB','3'],['CW','4'],['SSB','1']]) {
    const result=exportImport(document({MODE,EDI_MODE_CODE}),'edi',metadata);
    assert.equal(result.canExport,true,JSON.stringify(result.diagnostics));
    assert.equal(parseEdi(result.content).records[0].fields[3],EDI_MODE_CODE);
  }
});

test('CSV neutralizes spreadsheet formulas including source cells and preserves report originals', () => {
  for (const value of ['=1+1','+SUM(1)','-1+2','@SUM(1)',' \t=1+1','\tformula','\rformula']) {
    const doc=document({COMMENT:value},value);
    const result=exportImport(doc,'csv');
    assert.ok(result.content.includes("'"+value.replaceAll('"','""')),JSON.stringify(result.content));
    assert.equal(result.report.canonical.records[0].values.COMMENT,value);
    assert.equal(result.report.canonical.records[0].original,value);
    assert.equal(result.report.canonical.records[0].unmapped.note,'=original');
    assert.ok(result.lossReport.some(line=>line.includes('COMMENT')));
    assert.ok(result.lossReport.some(line=>line.includes('SOURCE_ROW')));
  }
  const result=exportImport(document({COMMENT:'ordinary - text'}),'csv');
  assert.equal(result.lossReport.length,0);
  assert.ok(result.content.includes('{""note"":""=original""}'));
  const header=exportImport(document({'=UNTRUSTED':'ordinary'}),'csv');
  assert.ok(header.content.startsWith("'=UNTRUSTED,"));
  assert.ok(header.lossReport.some(line=>line.includes('Header =UNTRUSTED')));
});

test('ADX forbidden XML characters become blocking diagnostics without losing original report', () => {
  for (const value of ['bad\u0001value','bad\u0000value','bad\ud800value','bad\ufffevalue']) {
    for (const doc of [document({COMMENT:value}),document({},value)]) {
      const result=exportImport(doc,'adx',metadata);
      assert.equal(result.canExport,false);
      assert.ok(result.diagnostics.some(d=>d.code === 'IMPORT-ADX-XML'));
      assert.equal(result.report.canonical,doc);
    }
  }
  assert.equal(exportImport(document({COMMENT:'Valid \t\n text 😀'}),'adx',metadata).canExport,true);
});
