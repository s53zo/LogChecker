import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { exportImport, recoverImportCandidates } from '../src/core/import-export.ts';
import { importStructured } from '../src/core/import-structured.ts';
import { parseEdi, ediHeader } from '../src/core/edi.ts';
import { parseAdif, adifValue } from '../src/core/adif.ts';

function document(overrides = {}) {
  const values = { CALL:'S53O', QSO_DATE:'20260906', TIME_ON:'1238', MODE:'SSB', FREQ:'144.3999', BAND:'2M', STATION_CALLSIGN:'S53ZO', MY_GRIDSQUARE:'JN86CR', RST_SENT:'59', STX:'001', RST_RCVD:'59', SRX:'232', GRIDSQUARE:'JN86AT', QSO_POINTS:'16', ...overrides };
  return {records:[{id:'r1',sourceIndex:0,original:'original input',values,provenance:{},unmapped:{unknown:'kept'},issues:[]}],metadata:{},issues:[],warnings:[]};
}
const metadata = {utcConfirmed:true,contestName:'TEST',scoring:'supplied-points',ediHeaders:{TDate:'20260905;20260906',PExch:'#'}};
test('all target formats validate with confirmed metadata and preserve source report', () => {
  for (const format of ['adif','adx','edi','csv','cabrillo']) {
    const result = exportImport(document(),format,metadata);
    assert.equal(result.canExport,true,JSON.stringify(result.diagnostics));
    assert.equal(result.report.source,'original input');
    assert.equal(result.report.canonical.records[0].unmapped.unknown,'kept');
    assert.equal(result.content,exportImport(document(),format,metadata).content);
  }
});
test('missing metadata cannot invent station, UTC or scoring', () => {
  const result = exportImport(document({STATION_CALLSIGN:'',QSO_POINTS:''}),'edi');
  assert.equal(result.canExport,false);
  for (const code of ['IMPORT-UTC','IMPORT-STATION','IMPORT-SCORING','IMPORT-POINTS']) assert.ok(result.diagnostics.some(d => d.code === code),code);
  assert.ok(!result.content.includes('N0CALL'));
});
test('EDI blocks mixed station, band, locators and metadata conflicts', () => {
  for (const field of ['STATION_CALLSIGN','MY_GRIDSQUARE','BAND']) {
    const doc = document(); doc.records.push({...doc.records[0],id:'r2',values:{...doc.records[0].values,[field]:'OTHER'}});
    assert.ok(exportImport(doc,'edi',metadata).diagnostics.some(d => d.code === 'IMPORT-MIXED-METADATA'));
  }
});
test('EDI preserves points and derives ODX independently', () => {
  const result = exportImport(document({CALL:'IQ5NN',GRIDSQUARE:'JN63GN',QSO_POINTS:'999'}),'edi',metadata);
  const edi = parseEdi(result.content);
  assert.equal(ediHeader(edi,'CQSOP'),'999');
  assert.equal(ediHeader(edi,'CODXC'),'IQ5NN;JN63GN;455');
  assert.equal(edi.records[0].fields.length,15);
});
test('full original fixture retains all contacts, serials and 3877 supplied points', () => {
  const source = readFileSync(new URL('./fixtures/s53zo-20260906.txt',import.meta.url),'utf8');
  const doc = document(); doc.records = source.trim().split('\n').slice(1).map((line,index) => {
    const t = line.trim().split(/\s+/);
    return {...document().records[0],id:`r${index}`,original:line,sourceIndex:index+1,values:{QSO_DATE:t[0],TIME_ON:t[1],FREQ:String(Number(t[2].replace(',','.'))/1000),MODE:t[3] === 'USB' ? 'SSB' : t[3],STATION_CALLSIGN:t[4],RST_SENT:t[5],STX:t[6],MY_GRIDSQUARE:t[7],CALL:t[8],RST_RCVD:t[9],SRX:t[10],GRIDSQUARE:t[11],QSO_POINTS:t[12],BAND:'2M'}};
  });
  const result = exportImport(doc,'edi',{...metadata,source});
  assert.equal(result.canExport,true,JSON.stringify(result.diagnostics));
  const edi = parseEdi(result.content);
  assert.equal(edi.records.length,28);
  assert.equal(ediHeader(edi,'CToSc'),'3877');
  assert.equal(ediHeader(edi,'CODXC'),'IQ5NN;JN63GN;455');
  assert.deepEqual(edi.records.map(r => r.fields[5]),doc.records.map(r => r.values.STX));
});
test('invalid output separators and truncated Cabrillo values block export', () => {
  assert.equal(exportImport(document({SRX_STRING:'a;b'}),'edi',metadata).canExport,false);
  assert.equal(exportImport(document({STX_STRING:'too long exchange'}),'cabrillo',metadata).canExport,false);
});
test('unknown ADIF values and EDI flags survive native reimport', () => {
  const result = exportImport(document({EDI_DUPLICATE:'D',EDI_NEW_WWL:'N'}),'adif',metadata);
  assert.equal(adifValue(parseAdif(result.content).records[0],'APP_LOGCHECKER_QSO_POINTS'),'16');
  const session = importStructured(result.content);
  assert.equal(session.source,result.content);
  assert.ok(session.columns.some(c => c.field === 'EDI_DUPLICATE'));
  const edi = exportImport(document({EDI_DUPLICATE:'D'}),'edi',metadata);
  const restored = importStructured(edi.content);
  assert.ok(restored.columns.some(c => c.field === 'QSO_POINTS'));
});
test('recovery is bounded, validates candidates and respects a locked mapping', () => {
  const candidates = [{id:'bad',score:1,document:document({CALL:''})},{id:'good',score:0.9,document:document()}];
  assert.equal(recoverImportCandidates(candidates,'adif',metadata).selected.id,'good');
  const locked = recoverImportCandidates(candidates,'adif',metadata,{lockedCandidateId:'bad'});
  assert.equal(locked.selected.id,'bad'); assert.equal(locked.attempts.length,1); assert.equal(locked.result.canExport,false);
  assert.equal(recoverImportCandidates(candidates,'adif',metadata,{maxAttempts:1}).attempts.length,1);
});
test('EDI defaults dates from QSOs and rejects explicitly invalid chronology', () => {
  assert.equal(exportImport(document(),'edi',{...metadata,ediHeaders:{}}).canExport,true);
  for (const ediHeaders of [{TDate:'20260906;20260905',PExch:'#'}, {TDate:'20260230;20260301',PExch:'#'}]) {
    assert.equal(exportImport(document(),'edi',{...metadata,ediHeaders}).canExport,false);
  }
  const result = exportImport(document({STX:'1',SRX:'2'}),'edi',metadata);
  assert.equal(result.canExport,true);
  assert.equal(parseEdi(result.content).records[0].fields[5],'001');
  assert.ok(result.lossReport.some(s => s.includes('padded')));
  assert.equal(exportImport(document({STX:'12345'}),'edi',metadata).canExport,false);
});
test('invalid native source does not become valid by dropping broken source fragments', () => {
  const valid = exportImport(document(),'adif',metadata).content;
  const session = importStructured(valid + '<CALL:20>broken');
  assert.equal(exportImport(session,'adif',metadata).canExport,false);
});
test('equivalent manual band labels do not conflict with canonical bands', () => {
  for (const band of ['2m','144 MHz','144MHz','0.144 GHz']) {
    const result = exportImport(document(),'edi',{...metadata,band});
    assert.equal(result.canExport,true,JSON.stringify(result.diagnostics));
    assert.equal(ediHeader(parseEdi(result.content),'PBand'),'144 MHz');
  }
});
test('recognized digital modes project to Cabrillo DG with an explicit loss report', () => {
  for (const mode of ['FT8','PSK31','MFSK','OLIVIA','JT65','Q65']) {
    const result = exportImport(document({MODE:mode}),'cabrillo',metadata);
    assert.equal(result.canExport,true,JSON.stringify(result.diagnostics));
    assert.match(result.content,/QSO:.* DG /);
    assert.ok(result.lossReport.some(s => s.includes(`${mode} is projected`)));
  }
});
test('recovery cannot validate by dropping an invalid contact or changing source coverage', () => {
  const full = document();
  full.records.push({...document({QSO_DATE:'invalid'}).records[0],id:'r2',sourceIndex:1,original:'second original\ncontinuation'});
  const subset = document();
  const result = recoverImportCandidates([{id:'full',score:1,document:full},{id:'subset',score:0.9,document:subset}], 'adif',metadata);
  assert.equal(result.selected.id,'full');
  assert.equal(result.result.canExport,false);
  assert.equal(result.attempts[1].rejected,true);
  assert.equal(result.attempts[1].diagnostics[0].code,'IMPORT-RECOVERY-COVERAGE');
  for (const changed of [full.records.toReversed(), full.records.map(r => ({...r,original:r.original.replace('\ncontinuation','')})), [...full.records,full.records[0]]]) {
    const attempt = recoverImportCandidates([{id:'full',score:1,document:full},{id:'changed',score:0.9,document:{...full,records:changed}}],'adif',metadata);
    assert.equal(attempt.attempts[1].rejected,true);
  }
});
test('recovery permits value repairs when all original records remain covered', () => {
  const baseline = document({QSO_DATE:'invalid'});
  const fixed = document();
  const result = recoverImportCandidates([{id:'baseline',score:1,document:baseline},{id:'fixed',score:0.9,document:fixed}],'adif',metadata);
  assert.equal(result.selected.id,'fixed');
  assert.equal(result.result.canExport,true);
});
test('explicit EDI Other mode exports without inventing an ADIF mode', () => {
  const doc = document({MODE:'',EDI_MODE_CODE:'0'});
  const result = exportImport(doc,'edi',metadata);
  assert.equal(result.canExport,true,JSON.stringify(result.diagnostics));
  assert.equal(parseEdi(result.content).records[0].fields[3],'0');
  assert.equal(exportImport(doc,'adif',metadata).canExport,false);
  assert.equal(exportImport(doc,'cabrillo',metadata).canExport,false);
  assert.equal(exportImport(document({MODE:'',EDI_MODE_CODE:'99'}),'edi',metadata).canExport,false);
});
test('EDI retains explicit scoring summaries and flags without fabricating missing rules', () => {
  const summaries = {CWWLs:'1;5;2',CWWLB:'5',CExcs:'1;3;2',CExcB:'3',CDXCs:'1;1;2',CDXCB:'1'};
  const result = exportImport(document({EDI_NEW_WWL:'N',EDI_NEW_EXCHANGE:'N',EDI_NEW_DXCC:'N'}),'edi',{...metadata,scoring:'claimed',claimedScore:'100',ediHeaders:{...metadata.ediHeaders,...summaries}});
  assert.equal(result.canExport,true,JSON.stringify(result.diagnostics));
  const edi = parseEdi(result.content);
  for (const [key,value] of Object.entries(summaries)) assert.equal(ediHeader(edi,key),value);
  assert.deepEqual(edi.records[0].fields.slice(11,14),['N','N','N']);
  const unspecified = exportImport(document(),'edi',metadata);
  for (const key of Object.keys(summaries)) assert.ok(unspecified.content.includes(`${key}=\r\n`));
});
test('EDI rejects malformed scoring summaries and contradictory points-only settings', () => {
  for (const [key,value] of [['CWWLs','1;garbage;2'],['CExcs','1.5;0;1'],['CDXCs','1;0;Infinity'],['CWWLB','-1'],['CExcB','NaN'],['CDXCB','2;3']]) {
    const result = exportImport(document(),'edi',{...metadata,scoring:'claimed',claimedScore:'100',ediHeaders:{...metadata.ediHeaders,[key]:value}});
    assert.equal(result.canExport,false,`${key}=${value}`);
    assert.ok(result.diagnostics.some(d => d.code === 'IMPORT-SCORING-HEADER'));
  }
  const headers = {...metadata.ediHeaders,CWWLs:'1;5;2',CWWLB:'5'};
  const conflict = exportImport(document(),'edi',{...metadata,ediHeaders:headers});
  assert.equal(conflict.canExport,false);
  assert.ok(conflict.diagnostics.some(d => d.code === 'IMPORT-SCORING-CONFLICT'));
  assert.equal(exportImport(document(),'edi',{...metadata,ediHeaders:headers,scoring:'claimed',claimedScore:'42'}).canExport,true);
  assert.equal(exportImport(document(),'edi',{...metadata,ediHeaders:{...metadata.ediHeaders,CWWLs:'1;0;1',CWWLB:'0'}}).canExport,true);
});
