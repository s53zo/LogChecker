import { parseAdif } from './adif';
import { parseAdx } from './adx';
import { parseCabrillo } from './cabrillo';
import { cabrilloToAdif } from './converter';
import { parseEdi, ediToAdif } from './edi';
import { detectFormat } from './format';
import type { ImportSession } from './ingestion-types';
import { validateAdif, validateCabrillo, validateEdi } from './validator';
import { assertImportSource, assertImportSize } from './import-limits';

/** Converts known log containers into the same editable mapping session as tabular text. */
export function importStructured(source: string, fileName = ''): ImportSession | null {
  assertImportSource(source);
  const format = detectFormat(source, fileName);
  if (format === 'text') return null;
  const metadata: Record<string,string> = { UTC_STATUS:'UTC' };
  const sourceErrors: string[] = [];
  const historicalErrors: string[] = [];
  let originals: string[] = [];
  let document;
  if (format === 'edi') {
    const edi = parseEdi(source);
    const diagnostics = validateEdi(edi).filter(d => d.severity === 'error');
    historicalErrors.push(...diagnostics.map(d => d.message));
    sourceErrors.push(...diagnostics.filter(d => ['EDI-SIGNATURE','EDI-RECORDS-MARKER','EDI-RECORD-COUNT','EDI-FIELD-COUNT'].includes(d.code)).map(d => d.message));
    assertImportSize(edi.records.length, 1);
    for (const line of edi.lines) if (line.type === 'header' && line.key) metadata[line.key] = line.value ?? '';
    originals = edi.records.map(r => r.raw);
    document = parseAdif(ediToAdif(edi).content);
    const mapping = ['EDI_NEW_EXCHANGE','EDI_NEW_WWL','EDI_NEW_DXCC','EDI_DUPLICATE'];
    document.records.forEach((record,index) => {
      const original = edi.records[index]!;
      mapping.forEach((name,i) => record.tags.push({name,value:original.fields[11+i] ?? '',raw:''}));
    });
  } else if (format === 'cabrillo') {
    const cab = parseCabrillo(source);
    const diagnostics = validateCabrillo(cab).filter(d => d.severity === 'error');
    historicalErrors.push(...diagnostics.map(d => d.message));
    sourceErrors.push(...diagnostics.filter(d => ['QSO-LENGTH','QSO-ALIGNMENT'].includes(d.code)).map(d => d.message));
    assertImportSize(cab.lines.filter(line => line.qso).length, 1);
    for (const line of cab.lines) if (line.type === 'header' && line.key) metadata[line.key] = line.value ?? '';
    metadata.CONTEST_ID = cab.contest;
    originals = cab.lines.filter(l => l.qso && !l.raw.startsWith('X-QSO:')).map(l => l.raw);
    document = parseAdif(cabrilloToAdif(cab).content);
  } else document = /<(?:[\w.-]+:)?ADX\b/i.test(source) ? parseAdx(source) : parseAdif(source);
  assertImportSize(document.records.length, 1);
  if (format === 'adif') {
    const diagnostics = validateAdif(document).filter(d => d.severity === 'error');
    historicalErrors.push(...diagnostics.map(d => d.message));
    sourceErrors.push(...diagnostics.filter(d => ['ADIF-LENGTH','ADX-PARSE'].includes(d.code)).map(d => d.message));
  }
  if (document.unparsedTail.trim()) sourceErrors.push('Unparsed source fragment remains; repair the native source before conversion.');
  if (sourceErrors.length) metadata.IMPORT_SOURCE_ERRORS = sourceErrors.join('\n');
  if (historicalErrors.length) metadata.IMPORT_SOURCE_DIAGNOSTICS = historicalErrors.join('\n');
  for (const tag of document.header) if (!metadata[tag.name]) metadata[tag.name] = tag.value;
  const names = [...new Set(document.records.flatMap(r => r.tags.map(t => t.name)))];
  assertImportSize(document.records.length, names.length);
  const canonical = (name:string) => ['APP_LOGCHECKER_QSO_POINTS','APP_LOGCHECKER_EDI_QSO_POINTS'].includes(name) ? 'QSO_POINTS' : name.startsWith('APP_LOGCHECKER_EDI_') ? name.slice('APP_LOGCHECKER_'.length) : name;
  const columns = names.map((name,index) => ({id:`column-${index}`,name,field:canonical(name),confidence:1,reasons:[`Explicit ${format.toUpperCase()} field`],transform:name === 'FREQ' ? {frequencyUnit:'MHz' as const} : {}}));
  const rows = document.records.map((record,index) => ({id:`structured-${index}`,sourceIndex:index,original:originals[index] ?? record.original,cells:names.map(name => record.tags.find(t => t.name === name)?.value ?? ''),kind:'qso' as const,included:true,warnings:[]}));
  return { source,options:{strategy:'delimited',delimiter:'\t',headerRow:null},candidates:[{id:'structured',strategy:'delimited',delimiter:'\t',score:1,reasons:[`Recognized ${format.toUpperCase()} container`],width:names.length}],selectedCandidateId:'structured',columns,rows,metadata,warnings:document.parseWarnings ?? [] };
}
