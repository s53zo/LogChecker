export type LogFormat = "cabrillo" | "adif" | "edi" | "text";

export interface ContestField {
  key: string;
  width: number;
  description: string;
}

export interface ContestLayout {
  name: string;
  lineLength: number;
  minimumLength: number;
  separators: readonly number[];
  fields: readonly ContestField[];
  menuLabels: readonly string[];
  calculatorColumns: readonly string[];
  maxPoints: number | null;
}

export interface QsoCell {
  key: string;
  label: string;
  value: string;
  start: number;
  end: number;
  description?: string;
}

export interface QsoData {
  frequency: string;
  mode: string;
  date: string;
  time: string;
  cells: QsoCell[];
  call: string;
  myCall: string;
  sentRst: string;
  receivedRst: string;
  sentExchange: string;
  receivedExchange: string;
}

export interface QtcData {
  frequency: string;
  mode: string;
  date: string;
  time: string;
  receiver: string;
  group: string;
  sender: string;
  qsoTime: string;
  qsoCall: string;
  qsoSerial: string;
  cells: QsoCell[];
}

export interface CabrilloLine {
  id: string;
  lineNumber: number;
  raw: string;
  type: "header" | "qso" | "qtc" | "comment" | "blank" | "unknown";
  key?: string;
  value?: string;
  qso?: QsoData;
  qtc?: QtcData;
  dirty?: boolean;
}

export interface CabrilloDocument {
  format: "cabrillo";
  source: string;
  newline: "\n" | "\r\n" | "\r";
  trailingNewline: boolean;
  lines: CabrilloLine[];
  contest: string;
  layout?: ContestLayout;
}

export interface AdifTag {
  name: string;
  value: string;
  type?: string;
  raw: string;
}

export interface AdifRecord {
  id: string;
  tags: AdifTag[];
  original: string;
  dirty?: boolean;
  changedTags?: string[];
}

export interface AdifDocument {
  format: "adif";
  container: "adi" | "adx";
  source: string;
  header: AdifTag[];
  headerOriginal: string;
  records: AdifRecord[];
  newline: "\n" | "\r\n" | "\r";
  unparsedTail: string;
  parseWarnings?: string[];
}

export interface EdiRecord {
  id: string;
  lineNumber: number;
  raw: string;
  fields: string[];
  dirty?: boolean;
}

export interface EdiLine {
  id: string;
  lineNumber: number;
  raw: string;
  type: "signature" | "header" | "remarks-marker" | "remark" | "records-marker" | "qso" | "footer" | "blank" | "unknown";
  key?: string;
  value?: string;
  record?: EdiRecord;
}

export interface EdiDocument {
  format: "edi";
  source: string;
  newline: "\n" | "\r\n" | "\r";
  trailingNewline: boolean;
  lines: EdiLine[];
  records: EdiRecord[];
  version: string;
  declaredRecords: number | null;
}

export interface TextDocument {
  format: "text";
  source: string;
}

export type LogDocument = CabrilloDocument | AdifDocument | EdiDocument | TextDocument;

export type Severity = "error" | "warning" | "info";

export interface Diagnostic {
  id: string;
  severity: Severity;
  code: string;
  message: string;
  lineId?: string;
  lineNumber?: number;
  field?: string;
  category?: "syntax" | "conformance" | "destination" | "advisory";
  suggestion?: string;
}

export interface RepairChange {
  lineId: string;
  lineNumber: number;
  before: string;
  after: string;
  reasons: string[];
}

export interface ScoreRow {
  qsoId: string;
  band: string;
  mode: string;
  call: string;
  country: string;
  continent: string;
  prefix: string;
  points: number;
  bonusPoints?: number;
  multiplier: string;
  duplicate: boolean;
}

export interface ScoreResult {
  ruleId: string;
  ruleName: string;
  qsos: number;
  duplicates: number;
  points: number;
  multipliers: number;
  total: number;
  formula: string;
  rows: ScoreRow[];
  byBand: Array<{ band: string; qsos: number; points: number; multipliers: number }>;
  byMode: Array<{ mode: string; qsos: number; points: number }>;
  byCountry: Array<{ country: string; continent: string; qsos: number; points: number }>;
  byHour: Array<{ hour: string; qsos: number; points: number }>;
  notes: string[];
}
