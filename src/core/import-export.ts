import { parseAdif } from './adif';
import { parseAdx, serializeAdx } from './adx';
import { parseCabrillo, formatQso, qsoColumns } from './cabrillo';
import { parseEdi } from './edi';
import { maidenheadDistanceKm } from './geography';
import { normalizeImport } from './ingestion';
import { importDateRange } from './import-dates';
import type { ImportSession, NormalizedImport } from './ingestion-types';
import { cabrilloModeMap, getContestLayout } from './templates';
import { frequencyBand, validAdifDate } from './adif-schema';
import { validateAdif, validateCabrillo, validateEdi } from './validator';
import type { Diagnostic } from './types';

export type ImportExportFormat = 'adif' | 'adx' | 'cabrillo' | 'edi' | 'csv';
export interface ImportExportMetadata {
  source?: string; utcConfirmed?: boolean; contestName?: string; section?: string;
  stationCall?: string; stationLocator?: string; band?: string;
  scoring?: 'supplied-points' | 'claimed'; claimedScore?: string;
  ediHeaders?: Record<string, string>;
}
export interface ImportExportResult {
  content: string; text: string; canExport: boolean; records: number;
  diagnostics: Diagnostic[]; lossReport: string[];
  report: { version: 1; source: string; format: ImportExportFormat; metadata: ImportExportMetadata; canonical: NormalizedImport; losses: string[]; diagnostics: Diagnostic[] };
}
const ediBands: Record<string, string> = { '6M': '50 MHz', '4M': '70 MHz', '2M': '144 MHz', '1.25M': '222 MHz', '70CM': '432 MHz', '23CM': '1.3 GHz', '13CM': '2.3 GHz', '9CM': '3.4 GHz', '6CM': '5.7 GHz', '3CM': '10 GHz', '1.25CM': '24 GHz', '6MM': '47 GHz', '4MM': '76 GHz' };
const ediModes: Record<string, string> = { SSB: '1', USB: '1', LSB: '1', CW: '2', 'SSB-CW': '3', 'CW-SSB': '4', AM: '5', FM: '6', RTTY: '7', SSTV: '8', ATV: '9' };
// WWROF QSO specification represents VHF+ as band codes, not six-digit kHz.
const cabBands: Record<string,string> = {'6M':'50','4M':'70','2M':'144','1.25M':'222','70CM':'432','33CM':'902','23CM':'1.2G','13CM':'2.3G','9CM':'3.4G','6CM':'5.7G','3CM':'10G','1.25CM':'24G','6MM':'47G','4MM':'75G','2.5MM':'122G','2MM':'134G','1MM':'241G'};
const digitalModes = new Set(['DG','DIGITAL','DATA','FT4','FT8','PSK','PSK31','PSK63','PSK125','QPSK','QPSK31','QPSK63','MFSK','MFSK8','MFSK16','OLIVIA','DOMINO','DOMINOF','DOMINOEX','CONTESTI','CONTESTIA','HELL','HELL80','AMTORFEC','PAC','PAC2','PAC3','PAX','PKT','PACKET','FSK441','FST4','FST4W','JS8','JT4','JT6M','JT9','JT44','JT65','Q65','MSK144','ISCAT','WSPR','THOR','THRB','THROB','CHIP','CLO','DIGITALVOICE','DSTAR','C4FM','DMR','FREEDV','ROS','VARA','WINMOR','ARDOP']);
function bandIdentity(value: string): string {
  const compact = value.toUpperCase().replace(/\s+/g,'');
  const known = Object.entries(ediBands).find(([,label]) => label.toUpperCase().replace(/\s+/g,'') === compact)?.[0];
  if (known) return known;
  const frequency = /^(\d+(?:[.,]\d+)?)(MHZ|GHZ|KHZ)$/.exec(compact);
  if (frequency) return frequencyBand(String(Number(frequency[1]!.replace(',','.')) * (frequency[2] === 'GHZ' ? 1000 : frequency[2] === 'KHZ' ? 0.001 : 1))) || value;
  return compact;
}
const tag = (name: string, value: string) => `<${name}:${value.length}>${value}`;
const quote = (value: string) => /[,"\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

export function exportImport(input: ImportSession | NormalizedImport, format: ImportExportFormat, metadata: ImportExportMetadata = {}): ImportExportResult {
  const doc: NormalizedImport = 'rows' in input ? normalizeImport(input) : input;
  const source = metadata.source ?? ('source' in input ? input.source : doc.records.map(r => r.original).join('\n'));
  const diagnostics: Diagnostic[] = doc.issues.map((issue, index) => ({ id: `import-${index}`, ...issue, lineId: issue.rowId }));
  const lossReport: string[] = [];
  const issue = (code: string, message: string, field?: string, severity: Diagnostic['severity'] = 'error') => diagnostics.push({ id: `${code}-${diagnostics.length}`, code, message, field, severity });
  if (doc.metadata.IMPORT_SOURCE_ERRORS) issue('IMPORT-SOURCE-ERROR', doc.metadata.IMPORT_SOURCE_ERRORS);
  const common = (field: string, explicit?: string) => {
    const identity = (value: string) => field === 'BAND' ? bandIdentity(value) : value.trim().toUpperCase();
    const values = [...new Set(doc.records.map(r => r.values[field] ?? '').filter(Boolean).map(identity))];
    const chosen = identity(explicit || doc.metadata[field] || (values.length === 1 ? values[0] : '') || '');
    if ((format === 'edi' || (format === 'cabrillo' && field === 'STATION_CALLSIGN')) && (values.length > 1 || values.some(v => chosen && v !== chosen))) issue('IMPORT-MIXED-METADATA', `${field} differs across records or conflicts with metadata. Split the log or correct the mapping.`, field);
    return chosen;
  };
  const station = common('STATION_CALLSIGN', metadata.stationCall);
  const locator = common('MY_GRIDSQUARE', metadata.stationLocator);
  const band = common('BAND', metadata.band);
  const contest = metadata.contestName || doc.metadata.TName || doc.metadata.CONTEST_ID || '';
  if (!doc.records.length) issue('IMPORT-EMPTY', 'No QSO records are selected.');
  if (format !== 'csv' && !metadata.utcConfirmed && doc.metadata.UTC_STATUS !== 'UTC') issue('IMPORT-UTC', 'Confirm that the log times are UTC before exporting.', 'TIME_ON');
  if (format !== 'csv') for (const record of doc.records) {
    for (const field of ['CALL', 'QSO_DATE', 'TIME_ON', 'MODE']) if (!record.values[field] && !(field === 'MODE' && format === 'edi' && /^[0-9]$/.test(record.values.EDI_MODE_CODE ?? ''))) issue('IMPORT-REQUIRED', `Source row ${record.sourceIndex + 1}: ${field} is required.`, field);
  }
  const used = new Set<string>();
  let content = '';
  if (format === 'adif' || format === 'adx') {
    const records = doc.records.map(record => {
      const values = { ...record.values };
      if (!values.STATION_CALLSIGN && station) values.STATION_CALLSIGN = station;
      if (!values.MY_GRIDSQUARE && locator) values.MY_GRIDSQUARE = locator;
      if (contest) values.CONTEST_ID = contest;
      const fields = Object.entries(values).filter(([, value]) => value).map(([name, value]) => {
        used.add(name);
        if (!/^[A-Z][A-Z0-9_]*$/.test(name)) { issue('IMPORT-FIELD-NAME', `Invalid field name ${name}.`); return ''; }
        const target = name === 'QSO_POINTS' || name.startsWith('EDI_') ? `APP_LOGCHECKER_${name}` : name;
        return tag(target, value);
      });
      fields.push(tag('APP_LOGCHECKER_SOURCE_ROW', record.original));
      if (Object.keys(record.unmapped).length) fields.push(tag('APP_LOGCHECKER_UNMAPPED', JSON.stringify(record.unmapped)));
      return fields.join(' ') + ' <EOR>';
    });
    content = `${tag('ADIF_VER', '3.1.7')} ${tag('PROGRAMID', 'LogChecker')} <EOH>\r\n${records.join('\r\n')}\r\n`;
    if (format === 'adx') {
      try {
        content = serializeAdx(parseAdif(content));
        diagnostics.push(...validateAdif(parseAdx(content)));
      } catch (error) {
        content = '';
        issue('IMPORT-ADX-XML', `ADX cannot represent this document as well-formed XML: ${error instanceof Error ? error.message : String(error)}. Original values remain in the conversion report.`);
      }
    } else diagnostics.push(...validateAdif(parseAdif(content)));
  } else if (format === 'csv') {
    const names = [...new Set(doc.records.flatMap(r => Object.keys(r.values)))].sort();
    names.forEach(name => used.add(name));
    const csvCell = (value: string, label: string) => {
      // Quoting CSV syntax alone does not prevent spreadsheet formula execution.
      // Inspect every cell, including headers and provenance, without editing the report.
      if (/^[\s\u0000-\u001f]*[=+@-]/u.test(value) || /^[\t\r\n]/.test(value)) {
        lossReport.push(`${label}: prefixed an apostrophe for spreadsheet safety; the original value remains in the conversion report.`);
        value = `'${value}`;
      }
      return quote(value);
    };
    const headers = [...names, 'SOURCE_ROW', 'UNMAPPED'];
    content = [headers.map(name => csvCell(name, `Header ${name}`)).join(','), ...doc.records.map(r => [...names.map(n => r.values[n] ?? ''), r.original, JSON.stringify(r.unmapped)].map((value,index) => csvCell(value, `Row ${r.sourceIndex + 1}: ${headers[index]}`)).join(','))].join('\r\n') + '\r\n';
  } else if (format === 'edi') {
    if (!station) issue('IMPORT-STATION', 'A station callsign is required.', 'STATION_CALLSIGN');
    if (!contest) issue('IMPORT-CONTEST', 'Enter the contest name.', 'TName');
    const headers = { ...doc.metadata, ...metadata.ediHeaders };
    if (!headers.TDate) {
      const dates = importDateRange({records:doc.records, metadata:headers});
      headers.TDate = `${dates.start};${dates.end}`;
    }
    const contestDates = (headers.TDate ?? '').split(';');
    if (contestDates.length !== 2 || contestDates.some(d => !validAdifDate(d)) || contestDates[0]! > contestDates[1]!) issue('IMPORT-CONTEST-DATES', 'Enter the actual contest start and end dates as YYYYMMDD;YYYYMMDD, in chronological order.', 'TDate');
    // PExch is an optional additional station exchange. RST, serial numbers
    // and locators have their own fields and do not require a PExch value.
    const scoring = metadata.scoring;
    let nonneutralScoring = false;
    const nonnegativeNumber = (value: string) => /^\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value));
    let bandMultiplier = '1';
    if (headers.CQSOs) {
      const parts = headers.CQSOs.split(';');
      if (parts.length !== 2 || !/^\d+$/.test(parts[0] ?? '') || !nonnegativeNumber(parts[1] ?? '')) issue('IMPORT-SCORING-HEADER', 'CQSOs must contain a nonnegative integer count and a finite nonnegative band multiplier separated by a semicolon.', 'CQSOs');
      else {
        bandMultiplier = parts[1]!;
        if (Number(bandMultiplier) !== 1) nonneutralScoring = true;
      }
    }
    for (const key of ['CWWLs','CExcs','CDXCs']) {
      const value = headers[key] ?? '';
      if (!value) continue;
      const parts = value.split(';');
      if (parts.length !== 3 || !/^\d+$/.test(parts[0] ?? '') || parts.some(part => !nonnegativeNumber(part))) issue('IMPORT-SCORING-HEADER', `${key} must contain a nonnegative integer count, bonus and multiplier separated by semicolons.`, key);
      else if (Number(parts[1]) !== 0 || Number(parts[2]) !== 1) nonneutralScoring = true;
    }
    for (const key of ['CWWLB','CExcB','CDXCB']) {
      const value = headers[key] ?? '';
      if (!value) continue;
      if (!nonnegativeNumber(value)) issue('IMPORT-SCORING-HEADER', `${key} must be a finite nonnegative number.`, key);
      else if (Number(value) !== 0) nonneutralScoring = true;
    }
    if (scoring === 'supplied-points' && nonneutralScoring) issue('IMPORT-SCORING-CONFLICT', 'Supplied-points scoring conflicts with the entered bonuses or multipliers. Choose claimed-score mode and enter the contest total.');
    if (!scoring && !headers.CToSc) issue('IMPORT-SCORING', 'Choose supplied-points scoring or supply the contest claimed score.');
    let points = 0, allPoints = true, odx: { call: string; grid: string; distance: number } | undefined;
    const records = doc.records.map(r => {
      const v = r.values;
      const p = v.QSO_POINTS ?? '';
      if (v.EDI_DUPLICATE === 'D' && Number(p) !== 0) issue('IMPORT-EDI-DUPLICATE-POINTS', `Source row ${r.sourceIndex + 1}: EDI duplicate contacts must have zero points. Confirm the correction explicitly.`, 'QSO_POINTS');
      if (contestDates.length === 2 && v.QSO_DATE && (v.QSO_DATE < contestDates[0]! || v.QSO_DATE > contestDates[1]!)) issue('IMPORT-CONTEST-RANGE', `Source row ${r.sourceIndex + 1} is outside the supplied contest dates.`, 'QSO_DATE');
      if (!/^\d{1,6}$/.test(p)) { allPoints = false; issue('IMPORT-POINTS', `Source row ${r.sourceIndex + 1}: supply valid QSO points; distance is never substituted for points.`, 'QSO_POINTS'); }
      else if (v.EDI_DUPLICATE !== 'D') points += Number(p);
      const distance = maidenheadDistanceKm(locator, v.GRIDSQUARE ?? '');
      if (distance !== null && v.EDI_DUPLICATE !== 'D' && (!odx || distance > odx.distance)) odx = { call: v.CALL ?? '', grid: v.GRIDSQUARE ?? '', distance };
      const mode = v.EDI_MODE_CODE || ediModes[v.MODE ?? ''];
      if (!mode) issue('IMPORT-EDI-MODE', `Mode ${v.MODE || '(empty)'} has no confirmed EDI mode mapping.`, 'MODE');
      if (v.EDI_MODE_CODE) {
        // Cross-mode codes retain the transmitted mode (3 = SSB/CW, 4 = CW/SSB).
        const transmitted = (code: string) => code === '3' ? '1' : code === '4' ? '2' : code;
        for (const field of ['MODE','SUBMODE']) {
          const value = v[field] ?? '';
          const mapped = ediModes[value];
          const conflict = value && (mapped
            ? transmitted(mapped) !== transmitted(mode ?? '') || (['3','4'].includes(mapped) && mapped !== mode)
            : mode !== '0');
          if (conflict) issue('IMPORT-EDI-MODE-CONFLICT', `Source row ${r.sourceIndex + 1}: ${field} ${value} conflicts with retained EDI mode code ${v.EDI_MODE_CODE}. Correct the mode code or remove its mapping before exporting.`, field);
        }
      }
      const serial = (name: string) => {
        const value = v[name] ?? '';
        if (!value) return '';
        if (!/^\d{1,4}$/.test(value)) { issue('IMPORT-EDI-SERIAL', `Source row ${r.sourceIndex + 1}: ${name} must contain at most four digits.`, name); return value; }
        if (value.length < 3) lossReport.push(`Row ${r.sourceIndex + 1}: ${name} padded from ${value} to ${value.padStart(3,'0')} for EDI; original preserved.`);
        return value.padStart(3,'0');
      };
      for (const field of ['RST_SENT','RST_RCVD']) if (v[field] && !/^.{2,3}$/.test(v[field]!)) issue('IMPORT-EDI-RST', `${field} must be empty or two/three characters.`, field);
      if ((v.SRX_STRING ?? '').length > 6) issue('IMPORT-EDI-EXCHANGE', 'EDI received exchange supports at most six characters.', 'SRX_STRING');
      if (v.GRIDSQUARE && !/^[A-R]{2}\d{2}(?:[A-X]{2})?$/i.test(v.GRIDSQUARE)) issue('IMPORT-EDI-GRID', 'EDI received locator must contain four or six characters.', 'GRIDSQUARE');
      const fields = [(v.QSO_DATE ?? '').slice(2), (v.TIME_ON ?? '').slice(0, 4), v.CALL, mode ?? '', v.RST_SENT, serial('STX'), v.RST_RCVD, serial('SRX'), v.SRX_STRING, v.GRIDSQUARE, p, v.EDI_NEW_EXCHANGE, v.EDI_NEW_WWL, v.EDI_NEW_DXCC, v.EDI_DUPLICATE].map(x => x ?? '');
      if (fields.some(value => /[;\r\n]/.test(value))) issue('IMPORT-EDI-SEPARATOR', `Source row ${r.sourceIndex + 1} contains an EDI separator in a field.`);
      if ((v.TIME_ON ?? '').length > 4) lossReport.push(`Row ${r.sourceIndex + 1}: EDI stores minutes; seconds remain in the conversion report.`);
      return fields.join(';');
    });
    ['QSO_DATE','TIME_ON','CALL','MODE','RST_SENT','STX','RST_RCVD','SRX','SRX_STRING','GRIDSQUARE','QSO_POINTS','STATION_CALLSIGN','MY_GRIDSQUARE','BAND','EDI_MODE_CODE','EDI_NEW_EXCHANGE','EDI_NEW_WWL','EDI_NEW_DXCC','EDI_DUPLICATE'].forEach(k => used.add(k));
    const frequencies = doc.records.filter(record => record.values.FREQ).length;
    if (frequencies) {
      used.add('FREQ');
      lossReport.push(`EDI stores the band in PBand, not each contact's exact frequency. Original frequencies for ${frequencies} contacts remain in the conversion report.`);
    }
    const sidebands = doc.records.filter(record => ['USB','LSB'].includes(record.values.SUBMODE ?? '') && record.values.MODE === 'SSB');
    if (sidebands.length) lossReport.push(`EDI represents USB/LSB as SSB. Sideband details for ${sidebands.length} contacts remain in the conversion report.`);
    // Only summarized SSB sidebands are accounted for; unusual submodes still
    // get their normal per-record loss notice below.
    const summarizedSidebands = new Set(sidebands.map(record => record.id));
    for (const record of doc.records) {
      if (record.values.SUBMODE && !summarizedSidebands.has(record.id)) lossReport.push(`Row ${record.sourceIndex + 1}: SUBMODE is retained in the report but not represented in EDI.`);
    }
    used.add('SUBMODE');
    const total = scoring === 'supplied-points' && allPoints ? String(points) : metadata.claimedScore ?? headers.CToSc ?? '';
    if (!total) issue('IMPORT-SCORE', 'Supply the claimed contest score or choose supplied-points scoring.');
    if (total && !/^\d+$/.test(total)) issue('IMPORT-SCORE', 'Claimed score must be a nonnegative integer.');
    const output: Record<string, string> = {
      TName: contest, TDate: headers.TDate ?? '', PCall: station, PWWLo: locator,
      PExch: headers.PExch ?? '', PAdr1: headers.PAdr1 ?? '', PAdr2: headers.PAdr2 ?? '', PSect: metadata.section || headers.PSect || '', PBand: ediBands[band.toUpperCase()] || headers.PBand || band,
      PClub: headers.PClub ?? '', RName: headers.RName ?? '', RCall: headers.RCall ?? '', RAdr1: headers.RAdr1 ?? '', RAdr2: headers.RAdr2 ?? '', RPoCo: headers.RPoCo ?? '', RCity: headers.RCity ?? '', RCoun: headers.RCoun ?? '', RPhon: headers.RPhon ?? '', RHBBS: headers.RHBBS ?? '',
      MOpe1: headers.MOpe1 ?? '', MOpe2: headers.MOpe2 ?? '', STXEq: headers.STXEq ?? '', SPowe: headers.SPowe ?? '', SRXEq: headers.SRXEq ?? '', SAnte: headers.SAnte ?? '', SAntH: headers.SAntH ?? ';',
      CQSOs: `${doc.records.filter(r => r.values.EDI_DUPLICATE !== 'D').length};${bandMultiplier}`, CQSOP: allPoints ? String(points) : '', CToSc: total,
      CODXC: odx ? `${odx.call};${odx.grid};${Math.round(odx.distance)}` : '',
    };
    // Empty summary values explicitly retain unspecified contest scoring rules.
    for (const key of ['CWWLs','CWWLB','CExcs','CExcB','CDXCs','CDXCB']) output[key] = headers[key] ?? '';
    for (const [key, value] of Object.entries(output)) if (/[\r\n]/.test(value)) issue('IMPORT-HEADER-INJECTION', `${key} must not contain line breaks.`, key);
    content = `[REG1TEST;1]\r\n${Object.entries(output).map(([k,v]) => `${k}=${v}`).join('\r\n')}\r\n[Remarks]\r\n\r\n[QSORecords;${records.length}]\r\n${records.join('\r\n')}\r\n`;
    diagnostics.push(...validateEdi(parseEdi(content)));
  } else {
    if (!station) issue('IMPORT-STATION', 'A station callsign is required.', 'STATION_CALLSIGN');
    if (!contest) issue('IMPORT-CONTEST', 'Enter the Cabrillo contest identifier.', 'CONTEST');
    const layout = getContestLayout(contest);
    const lines = ['START-OF-LOG: 3.0', `CALLSIGN: ${station}`, `CONTEST: ${contest}`, 'CREATED-BY: LogChecker'];
    if ([station, contest].some(v => /[\r\n]/.test(v))) issue('IMPORT-HEADER-INJECTION', 'Header values must not contain line breaks.');
    for (const r of doc.records) {
      const v = r.values, columns = qsoColumns(layout);
      const modeInput = (v.SUBMODE || v.MODE || '').toUpperCase();
      const mode = digitalModes.has(modeInput) || digitalModes.has((v.MODE || '').toUpperCase()) ? 'DG' : cabrilloModeMap[modeInput] || cabrilloModeMap[v.MODE || ''];
      if (mode === 'DG' && modeInput !== 'DG') lossReport.push(`Row ${r.sourceIndex + 1}: ${modeInput} is projected to Cabrillo DG; precise mode remains in the report.`);
      if ((v.TIME_ON ?? '').length > 4) lossReport.push(`Row ${r.sourceIndex + 1}: Cabrillo stores minutes; seconds remain in the report.`);
      if (!mode) issue('IMPORT-CAB-MODE', `Confirm Cabrillo mode for ${v.MODE ?? '(empty)'}.`, 'MODE');
      const bandCode = cabBands[(v.BAND ?? '').toUpperCase()];
      if (!v.FREQ && !bandCode) issue('IMPORT-FREQUENCY', 'Cabrillo export requires a frequency or supported band code; no representative frequency is invented.', 'FREQ');
      if (bandCode) { used.add('BAND'); if (v.FREQ) lossReport.push(`Row ${r.sourceIndex + 1}: Cabrillo uses band code ${bandCode}; precise frequency remains in the report.`); }
      const values: Record<string,string> = { ...v, FREQUENCY: bandCode || (v.FREQ ? String(Math.round(Number(v.FREQ) * 1000)) : ''), MODE: mode ?? '', MY_CALL: v.STATION_CALLSIGN || station, QSO_DATE: (v.QSO_DATE ?? '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1-$2-$3'), TIME_ON: (v.TIME_ON ?? '').slice(0,4), STX_STRING: v.STX_STRING || v.STX || '', SRX_STRING: v.SRX_STRING || v.SRX || '' };
      for (const column of columns) {
        column.value = values[column.key] ?? '';
        const sourceKey = ({ FREQUENCY:'FREQ', MY_CALL:'STATION_CALLSIGN' } as Record<string,string>)[column.key] ?? column.key;
        used.add(sourceKey);
        if (column.key === 'STX_STRING' && !v.STX_STRING) used.add('STX');
        if (column.key === 'SRX_STRING' && !v.SRX_STRING) used.add('SRX');
        if (column.value.length > column.end - column.start) issue('IMPORT-CAB-WIDTH', `Row ${r.sourceIndex + 1}: ${column.key} exceeds the selected contest column width.`, column.key);
        if (/[\r\n]/.test(column.value)) issue('IMPORT-CAB-SEPARATOR', 'Cabrillo values must not contain line breaks.');
      }
      lines.push(formatQso({ frequency:values.FREQUENCY!, mode:mode ?? '', date:values.QSO_DATE!, time:values.TIME_ON!, call:v.CALL ?? '', myCall:station, sentRst:v.RST_SENT ?? '', receivedRst:v.RST_RCVD ?? '', sentExchange:values.STX_STRING!, receivedExchange:values.SRX_STRING!, cells:columns }, layout));
    }
    content = [...lines, 'END-OF-LOG:'].join('\r\n') + '\r\n';
    diagnostics.push(...validateCabrillo(parseCabrillo(content)));
  }
  for (const r of doc.records) {
    const lost = Object.keys(r.values).filter(k => r.values[k] && !used.has(k));
    if (lost.length) lossReport.push(`Row ${r.sourceIndex + 1}: ${lost.join(', ')} are retained in the report but not represented in ${format.toUpperCase()}.`);
    if (Object.keys(r.unmapped).length && format !== 'csv' && format !== 'adif' && format !== 'adx') lossReport.push(`Row ${r.sourceIndex + 1}: unmapped columns remain in the report.`);
  }
  const report = { version: 1 as const, source, format, metadata, canonical: doc, losses: lossReport, diagnostics };
  return { content, text: content, records: doc.records.length, diagnostics, canExport: !diagnostics.some(d => d.severity === 'error'), lossReport, report };
}

export interface RecoveryCandidate { id: string; document: ImportSession | NormalizedImport; score: number; }
function recoveryCoverage(document: ImportSession | NormalizedImport): string[] {
  const records = 'rows' in document ? document.rows.filter(row => row.included) : document.records;
  // Include raw multiline text and source position, with multiplicity and order intact.
  // Two interpretations may change cells, but cannot change which source records count.
  return records.map(record => JSON.stringify([record.sourceIndex, record.original.replace(/\r\n|\r/g, '\n')]));
}
export function recoverImportCandidates(candidates: RecoveryCandidate[], format: ImportExportFormat, metadata: ImportExportMetadata = {}, options: { lockedCandidateId?: string; maxAttempts?: number } = {}) {
  const ordered = [...candidates].filter(c => !options.lockedCandidateId || c.id === options.lockedCandidateId).sort((a,b) => b.score - a.score || a.id.localeCompare(b.id));
  const baseline = options.lockedCandidateId ? candidates.find(c => c.id === options.lockedCandidateId) : candidates[0];
  const coverage = baseline ? recoveryCoverage(baseline.document) : [];
  const limit = Math.max(1, Math.min(8, Math.floor(options.maxAttempts ?? 4) || 1));
  const attempts: Array<{id:string; errors:number; warnings:number; rejected?: boolean; diagnostics?: Diagnostic[]}> = [];
  let selected: RecoveryCandidate | undefined, result: ImportExportResult | undefined;
  for (const candidate of ordered.slice(0,limit)) {
    const candidateCoverage = recoveryCoverage(candidate.document);
    if (coverage.length !== candidateCoverage.length || coverage.some((record,index) => record !== candidateCoverage[index])) {
      attempts.push({id:candidate.id,errors:1,warnings:0,rejected:true,diagnostics:[{id:`recovery-coverage-${candidate.id}`,code:'IMPORT-RECOVERY-COVERAGE',severity:'error',message:'Rejected interpretation: it drops, adds, reorders, or changes the source QSO records. Exclude rows explicitly in the mapping workspace before retrying.'}]});
      continue;
    }
    const next = exportImport(candidate.document, format, metadata);
    const errors = next.diagnostics.filter(d => d.severity === 'error').length, warnings = next.diagnostics.filter(d => d.severity === 'warning').length;
    attempts.push({id:candidate.id, errors,warnings});
    if (!result || errors < result.diagnostics.filter(d => d.severity === 'error').length) { selected = candidate; result = next; }
    if (next.canExport) break;
  }
  return { selected, result, attempts, stoppedReason: result?.canExport ? 'validated' : options.lockedCandidateId ? 'user-mapping-locked' : 'review-required' };
}
