// Data-only fixtures shared by parser, exporter and browser acceptance tests.
export const headers = ['QSO_DATE', 'TIME_ON', 'FREQ', 'MODE', 'STATION_CALLSIGN', 'RST_SENT', 'STX', 'MY_GRIDSQUARE', 'CALL', 'RST_RCVD', 'SRX', 'GRIDSQUARE', 'QSO_POINTS', 'COMMENT'];
export const rows = [
  ['20260906', '1238', '144.39990', 'USB', 'S53ZO', '59', '001', 'JN86CR', 'S53O', '59', '232', 'JN86AT', '16', 'First contact'],
  ['20260906', '1327', '144.11495', 'CW', 'S53ZO', '599', '023', 'JN86CR', 'HA2R', '599', '437', 'JN87UE', '125', 'Second contact'],
];
const quoted = (value, delimiter) => value.includes(delimiter) || /["\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
export const delimited = (delimiter, values = rows) => [headers, ...values].map((row) => row.map((cell) => quoted(cell, delimiter)).join(delimiter)).join('\n');
export const corpus = {
  csv: delimited(','),
  tsv: delimited('\t'),
  semicolon: delimited(';', rows.map((row) => row.map((cell, index) => index === 2 ? cell.replace('.', ',') : cell))),
  pipe: delimited('|'),
  quoted: delimited(',', rows.map((row) => [...row.slice(0, -1), 'He said "hello", then left'])),
  multilineQuoted: delimited(',', rows.map((row) => [...row.slice(0, -1), 'First line\nsecond line'])),
  headerless: rows.map((row) => row.slice(0, -1).join(' ')).join('\n'),
  fixedWidth: [headers, ...rows].map((row) => row.map((value) => value.padEnd(20)).join('')).join('\n'),
  repeatedHeader: [headers.join('\t'), rows[0].join('\t'), headers.join('\t'), rows[1].join('\t')].join('\n'),
  groupedHeaders: 'Date Time Frequency Mode Station Sent Exchange Contact Received Exchange Points\nYYYYMMDD HHMM MHz Mode Call RST Serial Grid Call RST Serial Grid Pts\n' + rows.map((row) => row.slice(0, -1).join(' ')).join('\n'),
  mixedNewlines: headers.join('\t') + '\r\n' + rows[0].join('\t') + '\r' + rows[1].join('\t') + '\n',
  missingCells: delimited('\t', [rows[0], rows[1].map((cell, index) => index === 10 ? '' : cell)]),
  shiftedCells: delimited('\t', [rows[0], rows[1].filter((_, index) => index !== 5)]),
  commentsAndSummary: '# Portable operation\n' + delimited('\t') + '\n-----\nTotal QSOs: 2\nPage 1 of 1\n',
  dateVariants: delimited('\t', [rows[0].map((cell, index) => index === 0 ? '2026-09-06' : index === 1 ? '12:38:00' : cell), rows[1].map((cell, index) => index === 0 ? '06/09/2026' : index === 1 ? '13:27' : cell)]),
  modeAliases: delimited('\t', ['USB', 'LSB', 'PHONE', 'SSB', 'CW'].map((mode) => rows[0].map((cell, index) => index === 3 ? mode : cell))),
  mixedBands: delimited('\t', [rows[0], rows[1].map((cell, index) => index === 2 ? '432.2' : cell)]),
  ambiguousExchanges: 'Date\tTime\tCall\tMode\tFreq\tExchange\tExchange\n20260906\t1238\tS53O\tSSB\t144.39990\t001\t232',
  malformed: delimited('\t', [rows[0], rows[1].map((cell, index) => index === 8 ? '???' : index === 11 ? 'ZZ99ZZ' : cell)]),
  duplicates: delimited('\t', [rows[0], rows[0], rows[1]]),
  html: delimited('\t', [rows[0].map((cell, index) => index === 13 ? '<img src=x onerror=alert(1)>' : cell)]),
  unclosedQuote: 'CALL,COMMENT\nS53O,"unterminated',
};
export const largeLog = (count = 10_000) => delimited('\t', Array.from({ length: count }, (_, index) => rows[index % rows.length].map((cell, column) => column === 6 ? String(index + 1) : cell)));
export const adif = '<ADIF_VER:5>3.1.7\n<EOH>\n<CALL:4>S53O <QSO_DATE:8>20260906 <TIME_ON:4>1238 <FREQ:9>144.39990 <MODE:3>SSB <RST_SENT:2>59 <RST_RCVD:2>59 <STX:3>001 <SRX:3>232 <GRIDSQUARE:6>JN86AT <EOR>\n';
export const cabrillo = 'START-OF-LOG: 3.0\nCALLSIGN: S53ZO\nCONTEST: GENERIC-CONTEST\nQSO: 144 PH 2026-09-06 1238 S53ZO 59 001 S53O 59 232\nEND-OF-LOG:\n';
export const edi = '[REG1TEST;1]\nTName=Test\nTDate=20260906;20260906\nPCall=S53ZO\nPWWLo=JN86CR\nPBand=144 MHz\nCQSOs=1;1\nCQSOP=16\nCToSc=16\nCODXC=S53O;JN86AT;16\n[QSORecords;1]\n260906;1238;S53O;1;59;001;59;232;;JN86AT;16;;;;\n';
export const adx = '<?xml version="1.0"?><ADX><HEADER><ADIF_VER>3.1.7</ADIF_VER></HEADER><RECORDS><RECORD><CALL>S53O</CALL><QSO_DATE>20260906</QSO_DATE><TIME_ON>1238</TIME_ON><FREQ>144.39990</FREQ><MODE>SSB</MODE></RECORD></RECORDS></ADX>';
