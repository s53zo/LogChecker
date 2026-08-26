import "./styles.css";
import { countBucket, trackEvent } from "./core/analytics";
import { adifValue, parseAdif, serializeAdif, updateAdifTag } from "./core/adif";
import { parseAdx, serializeAdx } from "./core/adx";
import { PREFLIGHT_PROFILES, preflightReportHtml, preflightSubset, runPreflight, type PreflightProfileId, type PreflightResult } from "./core/preflight";
import { applyStationProfile, parseProfileStore, safeProfileFilename, splitAdif, validateStationProfile, type SplitCriterion, type StationProfile } from "./core/station-profiles";
import { duplicateReportCsv, findDuplicateCandidates, resolveDuplicate, type DuplicateCandidate } from "./core/duplicates";
import { fastEntryToAdif, parseFastEntry, type FastEntryResult } from "./core/fast-entry";
import { LOG_TRANSFER_ACK_TYPE, LOG_TRANSFER_TYPE, QSL_LABEL_TOOL_ORIGIN, QSL_LABEL_TOOL_URL, isTrustedLogTransferOrigin, parseLogTransferPayload, qslReadiness, safeTransferFilename } from "./core/qsl-handoff";
import {
  extractAdifCallsigns,
  filterAdif,
  filterAdifRecords,
  mergeAdif,
  modernizeDeprecatedModes,
  serializeAdifWithOptions,
  type AdifExportOptions,
  type AdifMergeResult,
} from "./core/adif-tools";
import {
  formatQso,
  parseCabrillo,
  qsoColumns,
  serializeCabrillo,
  updateHeader,
  updateQsoCell,
  updateQtcCell,
} from "./core/cabrillo";
import { CallsignDatabase } from "./core/callsigns";
import { geography } from "./core/geography";
import { adifToCabrillo, cabrilloToAdif, defaultAdifToCabrilloTarget, defaultCabrilloToAdifTarget, documentToCsv, type ConversionResult } from "./core/converter";
import { decodeLogFile, detectFormat } from "./core/format";
import { EDI_MODE_NAMES, EDI_QSO_FIELDS, EDI_SCORE_FORMULAS, calculateEdiScore, ediField, ediHeader, ediToAdif, ediToCsv, parseEdi, serializeEdi, updateEdiHeader, updateEdiRecord, updateEdiScoreHeaders, type EdiScoreFormula } from "./core/edi";
import { addMinimalCabrilloHeader, applyHeaderTemplate, deleteHeaderTemplate, extractHeaderTemplate, loadHeaderTemplates, removeCabrilloHeader, saveHeaderTemplate } from "./core/header-templates";
import { bandFromFrequency } from "./core/radio";
import { paperQsoColumns, validatePaperQso } from "./core/paper";
import { CTY_DATA_URLS, MASTER_DATA_URLS, fetchReferenceData } from "./core/remote-data";
import { applyCabrilloRepairs, previewCabrilloRepairs } from "./core/repairs";
import { findAll, nextMatchIndex, replaceAll, replaceOne, type SearchMatch, type SearchOptions } from "./core/search";
import { recommendedRuleId, scoringRules } from "./core/scoring";
import { activityBuckets, scoreRowsToCsv, scoreWithOverrides, updateClaimedScore, type ScoreOverrides } from "./core/score-tools";
import { activityChartSvg, activityToCsv, scoringReportHtml } from "./core/reports";
import { clearDraft, loadDraft, loadSettings, saveDraft, saveSettings } from "./core/storage";
import { adifFields, contestNames, getContestLayout } from "./core/templates";
import {
  addSerialColumn,
  alignRows,
  copyColumn,
  deleteColumns,
  deleteRows,
  duplicateColumn,
  joinColumns,
  insertColumn,
  moveColumns,
  moveRow,
  pasteColumn,
  parseTextTable,
  renameColumn,
  serializeTextTable,
  shiftRows,
  splitColumn,
  tableTransforms,
  type TableDocument,
  type TablePreview,
} from "./core/tabular";
import { textTableToAdif, textTableToCabrillo, textTableToCsv } from "./core/table-converter";
import {
  addFooterCommand,
  cleanUnsafeWhitespaceCommand,
  createConvertModeCommand,
  createConvertDateCommand,
  createConvertFrequencyCommand,
  createConvertTimeCommand,
  createLineEndingCommand,
  createNormalizeSerialCommand,
  createNormalizeModesCommand,
  createSequentialSerialCommand,
  createShiftQsoTimeCommand,
  removeFooterCommand,
  sortQsoChronologicallyCommand,
  type DocumentSelection,
  type TransformationPreview,
} from "./core/transformations";
import type {
  AdifDocument,
  CabrilloDocument,
  Diagnostic,
  EdiDocument,
  LogDocument,
  RepairChange,
  ScoreResult,
} from "./core/types";
import { validateAdif, validateCabrillo, validateEdi } from "./core/validator";

type View = "open" | "header" | "qsos" | "problems" | "preflight" | "duplicates" | "repair" | "search" | "convert" | "score" | "statistics" | "export";
type ReferenceDataStatus = "bundled" | "idle" | "loading" | "online" | "local" | "error";

interface AppState {
  document: LogDocument | null;
  fileName: string;
  encoding: string;
  view: View;
  diagnostics: Diagnostic[];
  selectedId: string;
  selectedRows: string[];
  undo: string[];
  redo: string[];
  repairs: RepairChange[];
  score: ScoreResult | null;
  ediScoreFormula: EdiScoreFormula | "auto";
  ruleId: string;
  paperOpen: boolean;
  conversion: { type: "adif" | "adx" | "cabrillo" | "edi" | "csv"; result: ConversionResult } | null;
  preflightProfile: PreflightProfileId;
  preflight: PreflightResult | null;
  stationProfiles: StationProfile[];
  activeProfileId: string;
  duplicateTolerance: number;
  duplicates: DuplicateCandidate[];
  fastEntrySource: string;
  fastEntry: FastEntryResult | null;
  stationCall: string;
  conversionContest: string;
  callbookName: string;
  ctyName: string;
  masterStatus: ReferenceDataStatus;
  ctyStatus: ReferenceDataStatus;
  masterSource: string;
  ctySource: string;
  masterUpdated: string;
  ctyUpdated: string;
  masterError: string;
  ctyError: string;
  transformation: TransformationPreview | null;
  searchMatches: SearchMatch[];
  searchOptions: SearchOptions;
  searchReplacement: string;
  searchIndex: number;
  textTable: TableDocument | null;
  tablePreview: TablePreview | null;
  selectedTableRows: string[];
  selectedTableColumns: number[];
  tableUndo: TableDocument[];
  tableRedo: TableDocument[];
  tableClipboard: string[] | null;
  adifOptions: AdifExportOptions;
  adifMerge: (AdifMergeResult & { fileNames: string[] }) | null;
  csvDelimiter: "," | ";";
  scoreOverrides: ScoreOverrides;
  statisticsInterval: number;
  statisticsStart: string;
  statisticsEnd: string;
  showNonprinting: boolean;
  invalidIndex: number;
  modeMappings: Record<string, string>;
  callbookQuery: string;
  callbookSuggestions: string[];
  cabrilloToAdifMap: Record<string, string>;
  adifToCabrilloMap: Record<string, string>;
  autoImportAdif: boolean;
}

const SAMPLE = `START-OF-LOG: 3.0
CALLSIGN: S53ZO
CONTEST: CQ-WPX-CW
CATEGORY-OPERATOR: SINGLE-OP
CATEGORY-BAND: ALL
CATEGORY-MODE: CW
CATEGORY-POWER: LOW
CLAIMED-SCORE: 0
CREATED-BY: Amateur Radio Log Workbench sample
QSO:  7025 CW 2026-05-30 0012 S53ZO         599 001    K1ABC         599 023
QSO: 14028 CW 2026-05-30 0117 S53ZO         599 002    DL1AAA        599 041
QSO: 21035 CW 2026-05-30 0242 S53ZO         599 003    JA1XYZ        599 118
QSO:  7025 CW 2026-05-30 0310 S53ZO         599 004    K1ABC         599 094
END-OF-LOG:
`;

const views: Array<{ id: View; label: string }> = [
  { id: "open", label: "Open" },
  { id: "header", label: "Log details" },
  { id: "qsos", label: "Contacts" },
  { id: "problems", label: "Problems" },
  { id: "preflight", label: "Preflight" },
  { id: "duplicates", label: "Duplicates" },
  { id: "repair", label: "Repair" },
  { id: "search", label: "Search" },
  { id: "convert", label: "Convert" },
  { id: "statistics", label: "Analyze" },
  { id: "score", label: "Score" },
  { id: "export", label: "Export" },
];

const savedSettings = loadSettings({ modeMappings: {} as Record<string, string>, cabrilloToAdifMap: {} as Record<string, string>, adifToCabrilloMap: {} as Record<string, string> });

const state: AppState = {
  document: null,
  fileName: "No log open",
  encoding: "",
  view: "open",
  diagnostics: [],
  selectedId: "",
  selectedRows: [],
  undo: [],
  redo: [],
  repairs: [],
  score: null,
  ediScoreFormula: "auto",
  ruleId: "generic-prefix",
  paperOpen: false,
  conversion: null,
  preflightProfile: "generic",
  preflight: null,
  stationProfiles: (() => { try { return (JSON.parse(localStorage.getItem("log-workbench:station-profiles:v1") ?? "{\"version\":1,\"profiles\":[]}") as { profiles?: StationProfile[] }).profiles ?? []; } catch { return []; } })(),
  activeProfileId: "",
  duplicateTolerance: 5,
  duplicates: [],
  fastEntrySource: localStorage.getItem("log-workbench:fast-entry-draft:v1") ?? "",
  fastEntry: null,
  stationCall: "",
  conversionContest: "GENERIC-CONTEST",
  callbookName: "",
  ctyName: "Bundled recovered DXCC table",
  masterStatus: "idle",
  ctyStatus: "bundled",
  masterSource: "",
  ctySource: "Bundled application data",
  masterUpdated: "",
  ctyUpdated: "",
  masterError: "",
  ctyError: "",
  transformation: null,
  searchMatches: [],
  searchOptions: { query: "", direction: "forward", wrap: true },
  searchReplacement: "",
  searchIndex: -1,
  textTable: null,
  tablePreview: null,
  selectedTableRows: [],
  selectedTableColumns: [],
  tableUndo: [],
  tableRedo: [],
  tableClipboard: null,
  adifOptions: { tagCase: "upper", includeTypes: false, decimalSeparator: ".", newline: "\r\n" },
  adifMerge: null,
  csvDelimiter: ",",
  scoreOverrides: {},
  statisticsInterval: 60,
  statisticsStart: "",
  statisticsEnd: "",
  showNonprinting: false,
  invalidIndex: -1,
  modeMappings: savedSettings.modeMappings,
  callbookQuery: "",
  callbookSuggestions: [],
  cabrilloToAdifMap: savedSettings.cabrilloToAdifMap,
  adifToCabrilloMap: savedSettings.adifToCabrilloMap,
  autoImportAdif: localStorage.getItem("log-workbench:auto-import-adif:v1") !== "false",
};

const callbook = new CallsignDatabase();
let masterRequestVersion = 0;
let ctyRequestVersion = 0;

function referenceUpdateLabel(updated: string): string {
  if (!updated) return "";
  const value = new Date(updated);
  return Number.isNaN(value.getTime()) ? updated : value.toLocaleDateString("en-US");
}

async function refreshMasterOnline(notifyUser = true): Promise<void> {
  const requestVersion = ++masterRequestVersion;
  state.masterStatus = "loading";
  state.masterError = "";
  render();
  try {
    const remote = await fetchReferenceData(MASTER_DATA_URLS);
    if (requestVersion !== masterRequestVersion) return;
    const count = callbook.loadBuffer(remote.buffer);
    if (!count) throw new Error("The downloaded MASTER.DTA contained no valid callsigns.");
    if (requestVersion !== masterRequestVersion) return;
    state.callbookName = "Online MASTER.DTA";
    state.masterStatus = "online";
    state.masterSource = remote.source;
    state.masterUpdated = remote.lastModified || new Date().toISOString();
    state.masterError = "";
    state.callbookQuery = "";
    state.callbookSuggestions = [];
    if (state.document) state.diagnostics = diagnosticsFor(state.document);
    render();
    trackEvent("reference_data_refresh", { area: "master", result: "success", record_bucket: countBucket(count) });
    if (notifyUser) toast(`${count.toLocaleString()} current MASTER.DTA callsigns loaded.`);
  } catch (error) {
    if (requestVersion !== masterRequestVersion) return;
    state.masterStatus = "error";
    state.masterError = error instanceof Error ? error.message : String(error);
    render();
    trackEvent("reference_data_refresh", { area: "master", result: "error" });
    if (notifyUser) toast("MASTER.DTA refresh failed; the existing callsign data was kept.");
  }
}

async function refreshCtyOnline(notifyUser = true): Promise<void> {
  const requestVersion = ++ctyRequestVersion;
  state.ctyStatus = "loading";
  state.ctyError = "";
  render();
  try {
    const remote = await fetchReferenceData(CTY_DATA_URLS);
    if (requestVersion !== ctyRequestVersion) return;
    const count = geography.loadCty(new TextDecoder("utf-8").decode(remote.buffer));
    if (requestVersion !== ctyRequestVersion) return;
    state.ctyName = "Online CTY.DAT";
    state.ctyStatus = "online";
    state.ctySource = remote.source;
    state.ctyUpdated = remote.lastModified || new Date().toISOString();
    state.ctyError = "";
    if (state.document?.format === "cabrillo") state.score = scoreWithOverrides(state.document, state.ruleId, state.scoreOverrides);
    render();
    trackEvent("reference_data_refresh", { area: "cty", result: "success", record_bucket: countBucket(count) });
    if (notifyUser) toast(`${count.toLocaleString()} current CTY prefixes loaded.`);
  } catch (error) {
    if (requestVersion !== ctyRequestVersion) return;
    state.ctyStatus = "error";
    state.ctyError = error instanceof Error ? error.message : String(error);
    render();
    trackEvent("reference_data_refresh", { area: "cty", result: "error" });
    if (notifyUser) toast("CTY.DAT refresh failed; the existing country data was kept.");
  }
}

async function refreshReferenceData(notifyUser = true): Promise<void> {
  await Promise.all([refreshMasterOnline(notifyUser), refreshCtyOnline(notifyUser)]);
}

function persistSettings(): void {
  saveSettings({ modeMappings: state.modeMappings, cabrilloToAdifMap: state.cabrilloToAdifMap, adifToCabrilloMap: state.adifToCabrilloMap });
}
const app = document.querySelector<HTMLDivElement>("#app")!;

const escapeHtml = (input: unknown): string => String(input ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

function sourceOf(documentValue: LogDocument): string {
  if (documentValue.format === "cabrillo") return serializeCabrillo(documentValue);
  if (documentValue.format === "adif") return documentValue.container === "adx" ? serializeAdx(documentValue) : serializeAdif(documentValue);
  if (documentValue.format === "edi") return serializeEdi(documentValue);
  return documentValue.source;
}

function parseSource(source: string, fileName = state.fileName): LogDocument {
  const format = detectFormat(source, fileName);
  if (format === "cabrillo") return parseCabrillo(source);
  if (format === "adif") return /<(?:[\w.-]+:)?ADX\b/i.test(source) || fileName.toLowerCase().endsWith(".adx") ? parseAdx(source) : parseAdif(source);
  if (format === "edi") return parseEdi(source);
  return { format: "text", source };
}

function diagnosticsFor(documentValue: LogDocument): Diagnostic[] {
  const base = documentValue.format === "cabrillo"
    ? validateCabrillo(documentValue)
    : documentValue.format === "adif"
      ? validateAdif(documentValue)
      : documentValue.format === "edi"
        ? validateEdi(documentValue)
        : [{ id: "text-format", severity: "info", code: "TEXT", message: "Plain text is open. Use the raw editor to prepare Cabrillo, ADIF, or REG1TEST EDI content." } satisfies Diagnostic];
  if (!callbook.size || documentValue.format === "text") return base;
  const calls = documentValue.format === "cabrillo"
    ? documentValue.lines.filter((line) => line.qso?.call).map((line) => ({ id: line.id, line: line.lineNumber, call: line.qso!.call }))
    : documentValue.format === "adif"
      ? documentValue.records.map((record, index) => ({ id: record.id, line: index + 1, call: adifValue(record, "CALL") })).filter((item) => item.call)
      : documentValue.records.map((record) => ({ id: record.id, line: record.lineNumber, call: ediField(record, "CALL") })).filter((item) => item.call);
  for (const item of calls) {
    if (!callbook.has(item.call)) base.push({ id: `master-${item.id}`, severity: "info", code: "MASTER-NOT-FOUND", message: `${item.call} was not found in the loaded local callsign list. This is only an advisory.`, lineId: item.id, lineNumber: item.line, field: "CALL" });
  }
  return base;
}

function setDocument(documentValue: LogDocument, options: { history?: boolean; toast?: string } = {}): void {
  if (options.history !== false && state.document) {
    state.undo.push(sourceOf(state.document));
    if (state.undo.length > 60) state.undo.shift();
    state.redo = [];
  }
  state.document = documentValue;
  if (documentValue.format === "text") {
    if (!state.textTable || state.textTable.source !== documentValue.source) state.textTable = parseTextTable(documentValue.source);
  } else {
    state.textTable = null;
  }
  state.diagnostics = diagnosticsFor(documentValue);
  state.repairs = documentValue.format === "cabrillo" ? previewCabrilloRepairs(documentValue) : [];
  state.score = documentValue.format === "cabrillo" ? scoreWithOverrides(documentValue, state.ruleId, state.scoreOverrides) : null;
  state.conversion = null;
  state.transformation = null;
  state.searchMatches = [];
  state.tablePreview = null;
  state.adifMerge = null;
  state.preflight = null;
  state.duplicates = documentValue.format === "adif" ? findDuplicateCandidates([documentValue], state.duplicateTolerance) : [];
  if (documentValue.format === "cabrillo") {
    state.stationCall = documentValue.lines.find((line) => line.key === "CALLSIGN")?.value ?? state.stationCall;
    state.conversionContest = documentValue.contest;
  } else if (documentValue.format === "edi") {
    state.stationCall = ediHeader(documentValue, "PCall") || state.stationCall;
  }
  saveDraft({ fileName: state.fileName, source: sourceOf(documentValue), savedAt: new Date().toISOString() });
  render();
  if (options.toast) toast(options.toast);
}

function loadSource(source: string, fileName: string, encoding = "UTF-8"): void {
  state.fileName = fileName;
  state.encoding = encoding;
  state.undo = [];
  state.redo = [];
  state.selectedId = "";
  state.selectedRows = [];
  state.selectedTableRows = [];
  state.selectedTableColumns = [];
  state.tableUndo = [];
  state.tableRedo = [];
  state.scoreOverrides = {};
  state.ediScoreFormula = "auto";
  state.view = "open";
  const parsed = parseSource(source, fileName);
  state.ruleId = parsed.format === "cabrillo" ? recommendedRuleId(parsed.contest) : "generic-prefix";
  setDocument(parsed, { history: false, toast: `${fileName} opened locally.` });
}

function qsoCount(): number {
  if (!state.document) return 0;
  if (state.document.format === "cabrillo") return state.document.lines.filter((line) => line.qso).length;
  if (state.document.format === "adif" || state.document.format === "edi") return state.document.records.length;
  return 0;
}

function navCount(view: View): string {
  if (!state.document) return "";
  if (view === "qsos") return String(qsoCount());
  if (view === "problems") return String(state.diagnostics.length);
  if (view === "repair") return String(state.repairs.length);
  return "";
}

function layoutName(): string {
  if (!state.document) return "—";
  if (state.document.format === "cabrillo") return state.document.layout?.name ?? "Generic";
  return state.document.format.toUpperCase();
}

function documentStatus(): string {
  const errors = state.diagnostics.filter((item) => item.severity === "error").length;
  if (!state.document) return "Waiting for a log";
  if (errors) return `${errors} error${errors === 1 ? "" : "s"} to review`;
  if (state.diagnostics.length) return `${state.diagnostics.length} advisory item${state.diagnostics.length === 1 ? "" : "s"}`;
  return "Ready to export";
}

function shell(content: string): string {
  return `<div class="app-shell">
    <header class="topbar">
      <div class="brand"><div class="brand-mark" aria-hidden="true">QSO</div><div><h1>Amateur Radio Log Workbench</h1><p>Inspect · repair · convert · analyze · score</p></div></div>
      <div class="top-actions">
        <span class="privacy-chip"><span>Private browser processing</span></span>
        <button class="btn ghost" data-action="undo" ${!(state.undo.length || state.tableUndo.length) ? "disabled" : ""} title="Undo (Ctrl+Z)">Undo</button>
        <button class="btn ghost" data-action="redo" ${!(state.redo.length || state.tableRedo.length) ? "disabled" : ""} title="Redo (Ctrl+Y)">Redo</button>
        <button class="btn primary" data-action="choose-file">Open file</button>
        <input id="file-input" class="hidden" type="file" accept=".log,.cbr,.cab,.adi,.adif,.adx,.edi,.txt,text/plain,application/xml,text/xml" />
        <input id="callbook-input" class="hidden" type="file" accept=".dta,.txt,text/plain" />
        <input id="cty-input" class="hidden" type="file" accept=".dat,.txt,text/plain" />
        <input id="adif-merge-input" class="hidden" type="file" accept=".adi,.adif,text/plain" multiple />
        <input id="duplicate-compare-input" class="hidden" type="file" accept=".adi,.adif,.adx,text/plain,application/xml" multiple />
        <input id="profile-import-input" class="hidden" type="file" accept=".json,application/json" />
      </div>
    </header>
    <div class="workspace">
      <aside class="sidebar" aria-label="Workflow">
        <div class="file-card"><p class="eyebrow">Current log</p><div class="file-name" title="${escapeHtml(state.fileName)}">${escapeHtml(state.fileName)}</div><div class="file-meta">${state.document ? `${state.document.format.toUpperCase()} · ${qsoCount()} QSOs · ${escapeHtml(state.encoding || "text")}` : "Files stay on this device"}</div></div>
        <nav class="nav-list">${views.map((view) => `<button class="nav-button ${state.view === view.id ? "active" : ""}" data-view="${view.id}" ${!state.document && view.id !== "open" ? "disabled" : ""}><span>${view.label}</span>${navCount(view.id) ? `<span class="nav-number">${navCount(view.id)}</span>` : ""}</button>`).join("")}</nav>
        <div class="sidebar-footer">Cabrillo 3.0 · ADIF 3.1.7 / ADX · REG1TEST EDI<br />Log data stays local. Google Analytics usage telemetry.</div>
      </aside>
      <main id="main-content" class="main" tabindex="-1">${content}</main>
    </div>
    <div class="toast-region" aria-live="polite" aria-atomic="true"></div>
  </div>`;
}

function emptyView(): string {
  const draft = loadDraft();
  return `<section class="empty-workspace">
    <div class="drop-zone card" data-drop-zone>
      <div><div class="drop-icon" aria-hidden="true">QSO:</div><p class="eyebrow">Private browser toolbox</p><h2>Make more of any amateur-radio log.</h2>
      <p>Work with Cabrillo, ADIF, IARU Region 1 EDI, or ordinary text. Inspect contacts, repair malformed records, convert formats, analyze activity, and score supported contests.</p>
      <div class="button-row" style="justify-content:center"><button class="btn primary" data-action="choose-file">Choose a log</button><button class="btn" data-action="sample">Try a sample</button>${draft ? `<button class="btn ghost" data-action="restore-draft">Restore local draft</button>` : ""}</div>
      <div class="format-strip"><span class="format-pill">.CBR</span><span class="format-pill">.LOG</span><span class="format-pill">.ADI</span><span class="format-pill">.ADX</span><span class="format-pill">.EDI</span><span class="format-pill">.TXT</span></div></div>
    </div>
    <div class="status-banner info" style="margin-top:1rem"><span>i</span><div><strong>Looking for a dedicated log analyzer?</strong><br />The author recommends <a href="https://s53m.com/SH6" target="_blank" rel="noopener noreferrer" data-analytics="sh6_recommendation">SH6</a>, a free online amateur-radio log analyzer.</div></div>
    ${onlineImportPanel()}
    ${referenceDataPanel()}
  </section>`;
}

function onlineImportPanel(): string {
  return `<section class="card" style="margin-top:1rem" aria-label="Online ADIF import"><div class="card-head"><h3>Online ADIF handoff</h3><span class="format-pill">Browser to browser</span></div><div class="card-body stack"><label><input id="auto-import-adif" type="checkbox" ${state.autoImportAdif ? "checked" : ""} /> Automatically open ADIF sent by trusted S53ZO web tools</label><p class="help-text">Compatible tools can open this page and pass an ADIF directly between browser tabs. The log is carried in memory with <code>postMessage</code>; it is not put in the URL or uploaded to a server.</p></div></section>`;
}

function pageHead(eyebrow: string, title: string, subtitle: string, actions = ""): string {
  return `<div class="page-head"><div><p class="eyebrow">${escapeHtml(eyebrow)}</p><h2>${escapeHtml(title)}</h2><p class="page-subtitle">${escapeHtml(subtitle)}</p></div>${actions ? `<div class="button-row">${actions}</div>` : ""}</div>`;
}

function metric(label: string, value: string | number, note: string): string {
  return `<div class="metric card"><div class="metric-label">${escapeHtml(label)}</div><div class="metric-value">${escapeHtml(value)}</div><div class="metric-note">${escapeHtml(note)}</div></div>`;
}

function referenceStatusText(kind: "master" | "cty"): string {
  const status = kind === "master" ? state.masterStatus : state.ctyStatus;
  const updated = kind === "master" ? state.masterUpdated : state.ctyUpdated;
  const error = kind === "master" ? state.masterError : state.ctyError;
  if (status === "loading") return "Checking for fresh data…";
  if (status === "error") return `Refresh unavailable; active data kept${error ? ` · ${error}` : ""}`;
  if (status === "idle") return "Waiting for online refresh";
  if (updated) return `updated ${referenceUpdateLabel(updated)}`;
  return status === "bundled" ? "bundled offline data" : "ready";
}

function referenceDataPanel(): string {
  return `<section class="card reference-data-panel" aria-label="Reference data status"><div class="card-head"><h3>Reference data</h3><button class="btn ghost" data-action="refresh-reference-data" ${state.masterStatus === "loading" || state.ctyStatus === "loading" ? "disabled" : ""}>Refresh both</button></div><div class="card-body reference-data-grid"><div><strong>MASTER.DTA</strong><span data-reference-status="master">${escapeHtml(state.callbookName || "MASTER.DTA")} · ${escapeHtml(referenceStatusText("master"))}</span></div><div><strong>CTY.DAT</strong><span data-reference-status="cty">${escapeHtml(state.ctyName)} · ${escapeHtml(referenceStatusText("cty"))}</span></div></div><p class="help-text reference-network-note">The app checks these public reference files with two direct GET requests. It sends no log text, filename, callsign query, or cookies; as with any web request, the data host receives the connection IP and standard request headers. Google Analytics records general interface usage, but custom events never include uploaded log data or user-entered values.</p></section>`;
}

function rawEditor(): string {
  if (!state.document) return "";
  const source = sourceOf(state.document);
  const visible = source.replace(/\r\n|\r|\n|\t| /g, (value) => value === "\t" ? "→\t" : value === " " ? "·" : "↵\n");
  return `<section class="card"><div class="card-head"><h3>Raw source</h3><span class="help-text">Loss-preserving until you apply an edit</span></div><div class="card-body"><div class="field-grid three" style="margin-bottom:.8rem"><label class="field"><span>Go to line</span><input id="goto-line" class="input" type="number" min="1" value="1" /></label><label class="field"><span>Character</span><input id="goto-character" class="input" type="number" min="1" value="1" /></label><div class="field field-action"><span>Source navigation</span><button class="btn" data-action="goto-position">Go</button></div></div><label class="field"><span>Log text</span><textarea id="raw-source" class="textarea" spellcheck="false">${escapeHtml(source)}</textarea></label><div class="button-row" style="margin-top:.8rem"><button class="btn dark" data-action="apply-raw">Apply source changes</button><button class="btn ghost" data-action="download-original">Download current source</button><button class="btn ghost" data-action="toggle-nonprinting">${state.showNonprinting ? "Hide" : "Show"} nonprinting characters</button></div>${state.showNonprinting ? `<pre class="code-preview" aria-label="Visible whitespace preview">${escapeHtml(visible)}</pre>` : ""}</div></section>`;
}

function callsignAssistance(): string {
  const match = state.callbookQuery ? geography.lookup(state.callbookQuery) : null;
  const geographyResult = match ? `<div class="table-wrap"><table class="data-table" aria-label="Local CTY callsign result"><thead><tr><th>Country</th><th>Prefix</th><th>Continent</th><th>CQ</th><th>ITU</th><th>Coordinates</th><th>UTC</th></tr></thead><tbody><tr><td>${escapeHtml(match.country)}</td><td>${escapeHtml(`${match.primaryPrefix} (${match.matchedPrefix})`)}</td><td>${escapeHtml(match.continent)}</td><td>${escapeHtml(match.cqZone ?? "—")}</td><td>${escapeHtml(match.ituZone || "—")}</td><td>${escapeHtml(`${match.latitude.toFixed(2)}, ${match.longitude.toFixed(2)}`)}</td><td>${escapeHtml(`${match.utcOffset >= 0 ? "+" : ""}${match.utcOffset}`)}</td></tr></tbody></table></div>` : state.callbookQuery ? `<div class="status-banner info"><span>i</span><div>No local CTY geography match was found for <strong>${escapeHtml(state.callbookQuery)}</strong>.</div></div>` : "";
  return `<section class="card"><div class="card-head"><h3>Local callsign assistance</h3></div><div class="card-body stack"><div class="callbook-status"><div><strong>${callbook.size ? `${callbook.size.toLocaleString()} calls loaded` : "No database loaded"}</strong><span>${escapeHtml(state.callbookName || "Optional MASTER.DTA or text file")} · ${escapeHtml(referenceStatusText("master"))}</span></div><div class="button-row"><button class="btn" data-action="refresh-master" ${state.masterStatus === "loading" ? "disabled" : ""}>Refresh online</button><button class="btn" data-action="choose-callbook">Load file</button>${callbook.size ? `<button class="btn ghost" data-action="clear-callbook">Clear</button>` : ""}</div></div><div class="field-grid"><label class="field"><span>Callsign or prefix</span><input id="callbook-query" class="input" value="${escapeHtml(state.callbookQuery)}" autocomplete="off" /></label><div class="field field-action"><span>MASTER and CTY assistance</span><button class="btn" data-action="search-callbook">Inspect locally</button></div></div>${state.callbookSuggestions.length ? `<div><p class="help-text">MASTER.DTA prefix or one-character matches</p><div class="format-strip">${state.callbookSuggestions.map((call) => `<span class="format-pill">${escapeHtml(call)}</span>`).join("")}</div></div>` : ""}${geographyResult}<div class="callbook-status"><div><strong>${geography.prefixCount.toLocaleString()} CTY entries across ${geography.entityCount.toLocaleString()} entities · ${geography.exactCallCount.toLocaleString()} exact calls</strong><span>${escapeHtml(state.ctyName)} · ${escapeHtml(referenceStatusText("cty"))}</span></div><div class="button-row"><button class="btn" data-action="refresh-cty" ${state.ctyStatus === "loading" ? "disabled" : ""}>Refresh online</button><button class="btn" data-action="choose-cty">Load file</button>${state.ctyStatus !== "bundled" ? `<button class="btn ghost" data-action="reset-cty">Use bundled</button>` : ""}</div></div><p class="help-text">Portable calls are matched by base or operating location. MASTER suggestions and CTY country, zone, location, and time-zone data are assistance only, never authoritative validation. Online refresh fetches only the public reference files; logs and callsign searches remain local.</p></div></section>`;
}

function openView(): string {
  if (!state.document) return emptyView();
  const errors = state.diagnostics.filter((item) => item.severity === "error").length;
  const warnings = state.diagnostics.filter((item) => item.severity === "warning").length;
  return `${pageHead("Workspace", state.fileName, "A local, editable working copy. Nothing in this log is transmitted from your browser.", `<button class="btn" data-action="save-draft">Save draft</button><button class="btn danger" data-action="close-log">Close</button>`)}
    <div class="metric-grid">${metric("Contacts", qsoCount(), "parsed QSO records")}${metric("Errors", errors, "must review")}${metric("Warnings", warnings, "format-aware advice")}${metric("Layout", layoutName(), state.document.format === "cabrillo" ? "fixed-column template" : "record format")}</div>
    <div class="grid-2"><div class="stack">${rawEditor()}</div><aside class="stack">
      <section class="card"><div class="card-head"><h3>Readiness</h3></div><div class="card-body"><div class="status-banner ${errors ? "warning" : "success"}"><span>${errors ? "●" : "✓"}</span><div><strong>${escapeHtml(documentStatus())}</strong><br />${errors ? "Open Problems to jump directly to each affected field." : "You can continue to analysis, conversion, scoring, or export."}</div></div></div></section>
      ${onlineImportPanel()}
      ${callsignAssistance()}
    </aside></div>`;
}

function cabrilloHeaderView(documentValue: CabrilloDocument): string {
  const header = (key: string) => documentValue.lines.find((line) => line.key === key)?.value ?? "";
  const fields: Array<[string, string]> = [
    ["CALLSIGN", "Station callsign"], ["CONTEST", "Contest"], ["CLAIMED-SCORE", "Claimed score"], ["CLUB", "Club"],
    ["CATEGORY-OPERATOR", "Operator"], ["CATEGORY-BAND", "Band"], ["CATEGORY-MODE", "Mode"], ["CATEGORY-POWER", "Power"],
    ["CATEGORY-ASSISTED", "Assisted"], ["CATEGORY-STATION", "Station"], ["LOCATION", "Location"], ["EMAIL", "Email"],
    ["NAME", "Name"], ["ADDRESS", "Address"], ["ADDRESS-CITY", "City"], ["ADDRESS-COUNTRY", "Country"],
  ];
  const templates = loadHeaderTemplates();
  const pending = state.transformation?.operationId === "remove-header" ? state.transformation : null;
  return `${pageHead("Cabrillo header", "Entry identity and categories", "Fields update their original header lines. Unknown and contest-specific header tags remain untouched.")}
    <section class="card" style="margin-bottom:1rem"><div class="card-head"><h3>Header templates</h3><span class="help-text">Stored only in this browser</span></div><div class="card-body"><div class="field-grid three"><label class="field"><span>Template name</span><input id="header-template-name" class="input" value="Station defaults" /></label><div class="field field-action"><span>Save current fields</span><button class="btn" data-action="save-header-template">Save template</button></div><label class="field"><span>Saved template</span><select id="header-template-select" class="select"><option value="">Choose…</option>${templates.map((template) => `<option value="${escapeHtml(template.name)}">${escapeHtml(template.name)}</option>`).join("")}</select></label></div><div class="button-row" style="margin-top:.7rem"><button class="btn" data-action="load-header-template">Load selected</button><button class="btn" data-action="add-minimal-header">Add missing minimum header</button><button class="btn ghost" data-action="delete-header-template">Delete selected</button><button class="btn danger" data-action="preview-remove-header">Remove header…</button></div>${pending ? `<div class="status-banner warning" style="margin-top:.8rem"><span>!</span><div><strong>${pending.changes.length} header lines will be removed.</strong><br />QSO, comment, unknown, and END-OF-LOG lines will remain.<div class="button-row" style="margin-top:.5rem"><button class="btn primary" data-action="apply-transformation">Apply removal</button><button class="btn ghost" data-action="cancel-transformation">Cancel</button></div></div></div>` : ""}</div></section>
    <section class="card"><div class="card-head"><h3>Header fields</h3><span class="format-pill">${escapeHtml(documentValue.layout?.name ?? "GENERIC")}</span></div><div class="card-body"><div class="field-grid three">${fields.map(([key, label]) => `<label class="field"><span>${escapeHtml(label)}</span>${key === "CONTEST" ? `<input class="input" data-header-key="${key}" list="contest-list" value="${escapeHtml(header(key))}" />` : `<input class="input" data-header-key="${key}" value="${escapeHtml(header(key))}" />`}</label>`).join("")}</div>
    <datalist id="contest-list">${contestNames.map((name) => `<option value="${escapeHtml(name)}"></option>`).join("")}</datalist>
    <div class="status-banner info" style="margin-top:1rem"><span>i</span><div><strong>${documentValue.layout ? documentValue.contest.startsWith("DARC-WAEDC-") ? "Official DARC WAEDC layout active" : "Recovered fixed-column layout active" : "Generic layout active"}</strong><br />${documentValue.layout ? documentValue.contest.startsWith("DARC-WAEDC-") ? "QSO and QTC records accept the official DARC field order; recovered fixed-width columns are also validated." : `${documentValue.layout.fields.length} contest exchange fields and ${documentValue.layout.minimumLength}-character minimum QSO lines.` : "This contest remains editable and receives generic validation, but exact column checks are unavailable."}</div></div></div></section>`;
}

function adifHeaderView(documentValue: AdifDocument): string {
  return `${pageHead("ADIF metadata", "Header and conversion defaults", "ADIF header tags remain lossless. Set the station and contest values used when creating Cabrillo output.")}
    <div class="grid-2"><section class="card"><div class="card-head"><h3>ADIF header</h3></div><div class="card-body"><div class="field-grid">${documentValue.header.length ? documentValue.header.map((tag) => `<label class="field"><span>${escapeHtml(tag.name)}</span><input class="input" value="${escapeHtml(tag.value)}" readonly /></label>`).join("") : `<p class="help-text">This file has no explicit ADIF header. Records are still available.</p>`}</div></div></section>
    <section class="card"><div class="card-head"><h3>Cabrillo defaults</h3></div><div class="card-body stack"><label class="field"><span>Station callsign</span><input id="station-call" class="input" value="${escapeHtml(state.stationCall)}" /></label><label class="field"><span>Contest</span><input id="conversion-contest" class="input" list="contest-list" value="${escapeHtml(state.conversionContest)}" /></label><datalist id="contest-list">${contestNames.map((name) => `<option value="${escapeHtml(name)}"></option>`).join("")}</datalist><p class="help-text">These settings stay in this browser and do not modify the ADIF records.</p></div></section></div>`;
}

function ediHeaderView(documentValue: EdiDocument): string {
  const fields: Array<[string, string]> = [
    ["TName", "Contest name"], ["TDate", "Contest dates"], ["PCall", "Station callsign"], ["PWWLo", "Station locator"],
    ["PExch", "Sent exchange"], ["PSect", "Section"], ["PBand", "Band"], ["PClub", "Club"],
    ["RName", "Responsible operator"], ["RCall", "Responsible callsign"], ["MOpe1", "Operators 1"], ["MOpe2", "Operators 2"],
    ["SPowe", "Power (W)"], ["SAnte", "Antenna"], ["SAntH", "Antenna heights"], ["CQSOs", "Claimed QSOs"],
    ["CQSOP", "Claimed QSO points"], ["CToSc", "Claimed total score"], ["CODXC", "Best DX"],
  ];
  const unknown = documentValue.lines.filter((line) => line.type === "header" && line.key && !fields.some(([key]) => key.toUpperCase() === line.key!.toUpperCase()));
  return `${pageHead("REG1TEST EDI header", "European VHF contest entry", "Header values update in place. Unknown keys, remarks, line endings, and record fields remain attached to the original document.")}
    <section class="card"><div class="card-head"><h3>REG1TEST fields</h3><span class="format-pill">Version ${escapeHtml(documentValue.version || "unknown")}</span></div><div class="card-body"><div class="field-grid three">${fields.map(([key, label]) => `<label class="field"><span>${escapeHtml(label)} · ${escapeHtml(key)}</span><input class="input" data-edi-header-key="${escapeHtml(key)}" value="${escapeHtml(ediHeader(documentValue, key))}" /></label>`).join("")}</div>${unknown.length ? `<p class="help-text" style="margin-top:1rem">${unknown.length} additional header field${unknown.length === 1 ? " is" : "s are"} preserved and editable in Raw source: ${escapeHtml(unknown.map((line) => line.key).join(", "))}.</p>` : ""}</div></section>`;
}

function headerView(): string {
  if (!state.document) return emptyView();
  if (state.document.format === "cabrillo") return cabrilloHeaderView(state.document);
  if (state.document.format === "adif") return adifHeaderView(state.document);
  if (state.document.format === "edi") return ediHeaderView(state.document);
  return `${pageHead("Header", "Plain text has no structured header", "Use the raw editor to add START-OF-LOG or ADIF tags, then apply the changes.")}${rawEditor()}`;
}

function rowHasError(id: string): boolean {
  return state.diagnostics.some((item) => item.lineId === id && item.severity === "error");
}

function cabrilloQsoTable(documentValue: CabrilloDocument): string {
  const allRows = documentValue.lines.filter((line) => line.qso);
  const rows = allRows.slice(0, 1_000);
  const keys = ["FREQUENCY", "MODE", "QSO_DATE", "TIME_ON", "MY_CALL", "RST_SENT", "STX", "STX_STRING", "CALL", "RST_RCVD", "SRX", "SRX_STRING", "GRIDSQUARE"];
  const present = keys.filter((key) => rows.some((line) => line.qso?.cells.some((cell) => cell.key === key)));
  return `<div class="table-wrap"><table class="data-table"><thead><tr><th><span class="sr-only">Select</span></th><th>Line</th>${present.map((key) => `<th>${escapeHtml(key.replaceAll("_", " "))}</th>`).join("")}</tr></thead><tbody>${rows.map((line) => `<tr id="row-${escapeHtml(line.id)}" class="${state.selectedId === line.id ? "selected" : ""} ${rowHasError(line.id) ? "has-error" : ""}"><td><input type="checkbox" data-select-qso="${escapeHtml(line.id)}" aria-label="Select QSO on line ${line.lineNumber}" ${state.selectedRows.includes(line.id) ? "checked" : ""} /></td><td class="line-no">${line.lineNumber}</td>${present.map((key) => { const cell = line.qso!.cells.find((candidate) => candidate.key === key); return `<td>${cell ? `<input class="cell-input" aria-label="${escapeHtml(`${key} line ${line.lineNumber}`)}" data-qso-id="${escapeHtml(line.id)}" data-qso-field="${escapeHtml(key)}" value="${escapeHtml(cell.value)}" style="min-width:${Math.max(4, Math.min(cell.end - cell.start, 14))}ch" />` : ""}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div>${allRows.length > rows.length ? `<p class="help-text">Showing the first ${rows.length.toLocaleString()} of ${allRows.length.toLocaleString()} QSOs for responsiveness. Validation, transformations, scoring, and exports still process the full log.</p>` : ""}`;
}

function cabrilloQtcTable(documentValue: CabrilloDocument): string {
  const rows = documentValue.lines.filter((line) => line.qtc).slice(0, 1_000);
  if (!rows.length) return "";
  const keys = ["FREQUENCY", "MODE", "QSO_DATE", "TIME_ON", "CALL_RX", "QTC_GROUP", "CALL_TX", "TIME_QSO", "CALL_QSO", "NR_QSO"];
  return `<section class="card" style="margin-top:1rem"><div class="card-head"><h3>QTC records</h3><span class="help-text">Official DARC order: receiver, group, sender, reported QSO</span></div><div class="card-body"><div class="table-wrap"><table class="data-table" aria-label="WAEDC QTC records"><thead><tr><th>Line</th>${keys.map((key) => `<th>${escapeHtml(key.replaceAll("_", " "))}</th>`).join("")}</tr></thead><tbody>${rows.map((line) => `<tr id="row-${escapeHtml(line.id)}" class="${state.selectedId === line.id ? "selected" : ""} ${rowHasError(line.id) ? "has-error" : ""}"><td class="line-no">${line.lineNumber}</td>${keys.map((key) => { const cell = line.qtc!.cells.find((candidate) => candidate.key === key)!; return `<td><input class="cell-input" aria-label="${escapeHtml(`${cell.label} line ${line.lineNumber}`)}" data-qtc-id="${escapeHtml(line.id)}" data-qtc-field="${escapeHtml(key)}" value="${escapeHtml(cell.value)}" style="min-width:${Math.max(4, Math.min(cell.end - cell.start, 14))}ch" /></td>`; }).join("")}</tr>`).join("")}</tbody></table></div></div></section>`;
}

function adifQsoTable(documentValue: AdifDocument): string {
  const fields = ["QSO_DATE", "TIME_ON", "CALL", "BAND", "FREQ", "MODE", "RST_SENT", "STX_STRING", "RST_RCVD", "SRX_STRING"];
  const records = documentValue.records.slice(0, 1_000);
  return `<div class="table-wrap"><table class="data-table"><thead><tr><th><span class="sr-only">Select</span></th><th>#</th>${fields.map((field) => `<th>${field.replaceAll("_", " ")}</th>`).join("")}</tr></thead><tbody>${records.map((record, index) => `<tr id="row-${escapeHtml(record.id)}" class="${state.selectedId === record.id ? "selected" : ""} ${rowHasError(record.id) ? "has-error" : ""}"><td><input type="checkbox" data-select-qso="${escapeHtml(record.id)}" aria-label="Select ADIF record ${index + 1}" ${state.selectedRows.includes(record.id) ? "checked" : ""} /></td><td class="line-no">${index + 1}</td>${fields.map((field) => `<td><input class="cell-input" aria-label="${field} record ${index + 1}" data-adif-id="${escapeHtml(record.id)}" data-adif-field="${field}" value="${escapeHtml(adifValue(record, field))}" /></td>`).join("")}</tr>`).join("")}</tbody></table></div>${documentValue.records.length > records.length ? `<p class="help-text">Showing the first ${records.length.toLocaleString()} of ${documentValue.records.length.toLocaleString()} records for responsiveness. Other workflows still process the full file.</p>` : ""}`;
}

function ediQsoTable(documentValue: EdiDocument): string {
  const fields = ["DATE", "TIME", "CALL", "MODE_CODE", "RST_SENT", "QSO_SENT", "RST_RCVD", "QSO_RCVD", "EXCHANGE_RCVD", "WWL_RCVD", "QSO_POINTS", "NEW_EXCHANGE", "NEW_WWL", "NEW_DXCC", "DUPLICATE"] as const;
  const records = documentValue.records.slice(0, 1_000);
  return `<div class="table-wrap"><table class="data-table" aria-label="REG1TEST EDI QSO records"><thead><tr><th>Line</th>${fields.map((field) => `<th>${escapeHtml(field.replaceAll("_", " "))}</th>`).join("")}</tr></thead><tbody>${records.map((record) => `<tr id="row-${escapeHtml(record.id)}" class="${state.selectedId === record.id ? "selected" : ""} ${rowHasError(record.id) ? "has-error" : ""}"><td class="line-no">${record.lineNumber}</td>${fields.map((field) => `<td><input class="cell-input" aria-label="${escapeHtml(`${field} line ${record.lineNumber}`)}" data-edi-id="${escapeHtml(record.id)}" data-edi-field="${escapeHtml(field)}" value="${escapeHtml(ediField(record, field))}" ${field === "MODE_CODE" ? `title="${escapeHtml(EDI_MODE_NAMES[ediField(record, field)] ?? "Unknown mode")}"` : ""} /></td>`).join("")}</tr>`).join("")}</tbody></table></div>${documentValue.records.length > records.length ? `<p class="help-text">Showing the first ${records.length.toLocaleString()} of ${documentValue.records.length.toLocaleString()} records. Validation and exports still process the full log.</p>` : ""}`;
}

function paperLogger(): string {
  if (!state.paperOpen || state.document?.format !== "cabrillo") return "";
  const columns = paperQsoColumns(state.document);
  const modes = ["CW", "PH", "RY", "DG", "FM", "AM"];
  const paperLabels: Record<string, string> = { FREQUENCY: "Frequency kHz", MODE: "Mode", QSO_DATE: "Date", TIME_ON: "Time UTC", MY_CALL: "My callsign", CALL: "Worked callsign", RST_SENT: "Sent RST", STX: "Sent serial", STX_STRING: "Sent exchange", RST_RCVD: "Received RST", SRX: "Received serial", SRX_STRING: "Received exchange", MY_GRIDSQUARE: "Sent grid", GRIDSQUARE: "Received grid" };
  const input = (cell: typeof columns[number], index: number) => {
    const label = paperLabels[cell.key] || cell.description || cell.label.replaceAll("_", " ");
    const required = /^(?:FREQUENCY|MODE|QSO_DATE|TIME_ON|MY_CALL|CALL|RST_SENT|RST_RCVD|STX|STX_STRING|SRX|SRX_STRING|GRIDSQUARE|MY_GRIDSQUARE)$/.test(cell.key);
    if (cell.key === "MODE") return `<label class="field"><span>${escapeHtml(label)}</span><select class="select" name="paper-cell-${index}" data-paper-index="${index}">${modes.map((mode) => `<option ${cell.value === mode ? "selected" : ""}>${mode}</option>`).join("")}</select></label>`;
    const type = cell.key === "QSO_DATE" ? "date" : "text";
    const inputmode = /^(?:FREQUENCY|TIME_ON|STX|SRX)$/.test(cell.key) ? ` inputmode="numeric"` : "";
    return `<label class="field"><span>${escapeHtml(label)}</span><input class="input" name="paper-cell-${index}" data-paper-index="${index}" data-paper-key="${escapeHtml(cell.key)}" type="${type}" value="${escapeHtml(cell.value)}" maxlength="${cell.end - cell.start}" ${required ? "required" : ""}${inputmode} autocomplete="off" /></label>`;
  };
  const fast = state.fastEntry;
  return `<section class="card" style="margin-bottom:1rem"><div class="card-head"><h3>Manual QSO entry — ${escapeHtml(state.document.contest)}</h3><button class="btn ghost" data-action="toggle-paper">Close</button></div><div class="card-body"><h4>Structured entry</h4><form id="paper-form" novalidate><div class="field-grid three">${columns.map(input).join("")}</div><div id="paper-validation" class="status-banner info" aria-live="polite" style="margin-top:1rem"><span>i</span><div>Enter the worked station and contest exchange. Fields follow the active recovered Cabrillo layout.</div></div><div class="button-row" style="margin-top:1rem"><button class="btn primary" type="submit">Add QSO</button><span class="help-text">Enter validates and adds the contact; defaults advance for the next QSO.</span></div></form><hr /><h4>Fast field transcription</h4><p class="help-text">Use explicit tokens such as <code>DATE=20260826 TIME=1200 CALL=S53M FREQ=14.025 MODE=CW RST_S=599 RST_R=599 STX=001 SRX=042 ACT=SI-1234 NOTE=&quot;portable&quot;</code>. Date, time, band/frequency, mode, profile, and activity may carry forward and are identified below. Callsigns and QSL state never carry forward.</p><textarea id="fast-entry-source" class="raw-editor" rows="8" spellcheck="false" aria-label="Fast-entry transcription">${escapeHtml(state.fastEntrySource)}</textarea><div class="button-row" style="margin-top:.7rem"><button class="btn" data-action="preview-fast-entry">Validate transcription</button><button class="btn primary" data-action="add-fast-entry" ${!fast?.records.some((record) => record.valid) ? "disabled" : ""}>Add valid QSOs</button><button class="btn ghost" data-action="download-fast-source" ${!state.fastEntrySource ? "disabled" : ""}>Download source</button>${fast?.records.some((record) => record.valid) ? `<button class="btn ghost" data-action="download-fast" data-fast-format="adi">ADI</button><button class="btn ghost" data-action="download-fast" data-fast-format="adx">ADX</button><button class="btn ghost" data-action="download-fast" data-fast-format="cabrillo">Cabrillo</button><button class="btn ghost" data-action="download-fast" data-fast-format="csv">CSV</button>` : ""}</div>${fast ? `<div class="status-banner ${fast.records.every((record) => record.valid) ? "success" : "warning"}" style="margin-top:.7rem"><span>${fast.records.every((record) => record.valid) ? "✓" : "!"}</span><div><strong>${fast.records.filter((record) => record.valid).length} valid · ${fast.records.filter((record) => !record.valid).length} need correction</strong><br />Inherited values are visible in the table.</div></div><div class="table-wrap"><table class="data-table"><thead><tr><th>Line</th><th>Call</th><th>Date/time</th><th>Band/frequency</th><th>Mode</th><th>Inherited</th><th>Status</th></tr></thead><tbody>${fast.records.map((record) => `<tr class="${record.valid ? "" : "has-error"}"><td>${record.line}</td><td>${escapeHtml(record.values.CALL ?? "")}</td><td>${escapeHtml(`${record.values.DATE ?? ""} ${record.values.TIME ?? ""}`)}</td><td>${escapeHtml(record.values.BAND || record.values.FREQ || "")}</td><td>${escapeHtml(record.values.MODE ?? "")}</td><td>${escapeHtml(record.inherited.join(", ") || "—")}</td><td>${escapeHtml(record.valid ? "Ready" : record.errors.join(" "))}</td></tr>`).join("")}</tbody></table></div>` : ""}</div></section>`;
}

function qsosView(): string {
  if (!state.document) return emptyView();
  const actions = state.document.format === "cabrillo" ? `<button class="btn primary" data-action="toggle-paper">${state.paperOpen ? "Close manual entry" : "Add QSO manually"}</button>` : "";
  const table = state.document.format === "cabrillo" ? cabrilloQsoTable(state.document) : state.document.format === "adif" ? adifQsoTable(state.document) : state.document.format === "edi" ? ediQsoTable(state.document) : rawEditor();
  const qtcTable = state.document.format === "cabrillo" ? cabrilloQtcTable(state.document) : "";
  return `${pageHead("Structured log", `${qsoCount()} contact${qsoCount() === 1 ? "" : "s"}`, "Edit fields directly. Original unknown content remains attached to the source document.", actions)}${paperLogger()}<section class="card"><div class="card-head"><h3>QSO records</h3><span class="help-text">Pink rows contain an error</span></div><div class="card-body">${table}</div></section>${qtcTable}`;
}

function problemsView(): string {
  if (!state.document) return emptyView();
  const errors = state.diagnostics.filter((item) => item.severity === "error").length;
  const warnings = state.diagnostics.filter((item) => item.severity === "warning").length;
  return `${pageHead("Validation", state.diagnostics.length ? `${state.diagnostics.length} item${state.diagnostics.length === 1 ? "" : "s"} to review` : "No problems found", "Checks cover document structure, dates, times, frequency, mode, callsigns, exchanges, duplicates and recovered fixed columns.", `<button class="btn" data-action="previous-invalid" ${!state.diagnostics.length ? "disabled" : ""}>Previous invalid</button><button class="btn" data-action="next-invalid" ${!state.diagnostics.length ? "disabled" : ""}>Next invalid</button><button class="btn" data-view="repair">Preview repairs</button>`)}
    <div class="metric-grid">${metric("Errors", errors, "submission blockers")}${metric("Warnings", warnings, "manual review")}${metric("Information", state.diagnostics.length - errors - warnings, "format notes")}${metric("QSOs", qsoCount(), "records checked")}</div>
    <section class="card"><div class="card-head"><h3>Actionable diagnostics</h3></div><div class="card-body">${state.diagnostics.length ? `<div class="diagnostic-list">${state.diagnostics.map((item) => `<button class="diagnostic" data-diagnostic-id="${escapeHtml(item.id)}"><span class="severity-dot ${item.severity}"></span><span><strong>${escapeHtml(item.message)}</strong><span>${item.lineNumber ? `Line ${item.lineNumber}${item.field ? ` · ${escapeHtml(item.field)}` : ""}` : "Document-level check"}</span></span><code>${escapeHtml(item.code)}</code></button>`).join("")}</div>` : `<div class="status-banner success"><span>✓</span><div><strong>The implemented checks passed.</strong><br />Contest rules can still require organizer-specific review.</div></div>`}</div></section>`;
}

function stationProfilesPanel(): string {
  const active = state.stationProfiles.find((profile) => profile.id === state.activeProfileId);
  const profileWarnings = active ? validateStationProfile(active) : [];
  const fields: Array<[keyof StationProfile, string]> = [["name", "Profile name"], ["stationCallsign", "Station callsign"], ["operator", "Operator"], ["ownerCallsign", "Owner callsign"], ["dxcc", "My DXCC"], ["country", "Country"], ["grid", "Grid"], ["latitude", "Latitude"], ["longitude", "Longitude"], ["cqZone", "CQ zone"], ["ituZone", "ITU zone"], ["state", "State"], ["county", "County"], ["iota", "IOTA"], ["pota", "POTA reference"], ["sota", "SOTA reference"], ["wwff", "WWFF reference"], ["band", "Default band"], ["frequency", "Default frequency"], ["mode", "Default mode"], ["propMode", "Propagation mode"], ["satellite", "Satellite"], ["notes", "Local notes"]];
  return `<section class="card" style="margin-top:1rem"><div class="card-head"><h3>Station and portable profiles</h3><div class="button-row"><button class="btn ghost" data-action="import-profiles">Import</button><button class="btn ghost" data-action="export-profiles" ${!state.stationProfiles.length ? "disabled" : ""}>Export</button></div></div><div class="card-body stack"><div class="field-grid three"><label class="field"><span>Saved profile</span><select id="station-profile-select" class="select"><option value="">New profile</option>${state.stationProfiles.map((profile) => `<option value="${escapeHtml(profile.id)}" ${profile.id === state.activeProfileId ? "selected" : ""}>${escapeHtml(profile.name)}</option>`).join("")}</select></label><label class="field"><span>Apply behavior</span><select id="profile-apply-mode" class="select"><option value="missing">Fill missing fields</option><option value="replace">Replace existing fields</option></select></label><div class="field field-action"><span>Target</span><span class="help-text">${state.selectedRows.length ? `${state.selectedRows.length} selected records` : "all records or date range"}</span></div><label class="field"><span>Apply from date</span><input id="profile-date-from" class="input" type="date" /></label><label class="field"><span>Apply through date</span><input id="profile-date-to" class="input" type="date" /></label><label class="field"><span>Split export by</span><select id="profile-split-criterion" class="select"><option value="station">Station identity</option><option value="date">QSO date</option><option value="activity">Activity reference</option></select></label></div><form id="station-profile-form"><input type="hidden" name="profileId" value="${escapeHtml(active?.id ?? "")}" /><div class="field-grid three">${fields.map(([key, label]) => `<label class="field"><span>${escapeHtml(label)}</span><input class="input" name="${key}" value="${escapeHtml(active?.[key] ?? "")}" ${key === "name" ? "required" : ""} /></label>`).join("")}</div>${profileWarnings.map((warning) => `<div class="status-banner warning"><span>!</span><div>${escapeHtml(warning)}</div></div>`).join("")}<div class="button-row"><button class="btn" type="submit">Save profile</button><button class="btn ghost" type="button" data-action="duplicate-profile" ${!active ? "disabled" : ""}>Duplicate</button><button class="btn ghost" type="button" data-action="delete-profile" ${!active ? "disabled" : ""}>Delete</button><button class="btn primary" type="button" data-action="preview-apply-profile" ${!active || state.document?.format !== "adif" ? "disabled" : ""}>Preview apply</button><button class="btn" type="button" data-action="split-station" ${state.document?.format !== "adif" ? "disabled" : ""}>Create split files</button></div></form><p class="help-text">Selected rows take precedence over a date range. Profiles and notes stay in this browser; notes are never written to a log.</p></div></section>`;
}

function compactTransformationReview(): string {
  const preview = state.transformation; if (!preview) return "";
  return `<section class="card" style="margin:1rem 0"><div class="card-head"><h3>${escapeHtml(preview.label)} · ${preview.changes.length} change${preview.changes.length === 1 ? "" : "s"}</h3><div class="button-row"><button class="btn ghost" data-action="cancel-transformation">Cancel</button><button class="btn primary" data-action="apply-transformation" ${!preview.changes.length ? "disabled" : ""}>Apply changes</button></div></div><div class="card-body">${preview.lossy ? `<div class="status-banner warning"><span>!</span><div><strong>Potentially lossy operation</strong><br />Review the affected records and keep the original file.</div></div>` : ""}${preview.warnings.map((warning) => `<div class="status-banner warning"><span>!</span><div>${escapeHtml(warning)}</div></div>`).join("")}<div class="repair-list">${preview.changes.slice(0, 200).map((change) => `<article class="repair-item"><div class="repair-title"><span>${change.lineNumber ? `Record ${change.lineNumber}` : "Record"}${change.field ? ` · ${escapeHtml(change.field)}` : ""}</span><strong>${escapeHtml(change.description)}</strong></div><div class="diff"><pre>${escapeHtml(change.before)}</pre><span>→</span><pre>${escapeHtml(change.after)}</pre></div></article>`).join("")}</div></div></section>`;
}

function preflightView(): string {
  if (!state.document) return emptyView();
  if (state.document.format !== "adif") return `${pageHead("Submission preflight", "Convert this log to ADIF first", "Destination profiles operate on ADI or ADX records and never upload them.")}<div class="status-banner info"><span>i</span><div><strong>ADIF document required</strong><br />Use Convert to create an ADIF preview, then open that file for destination checking.</div></div>`;
  const result = state.preflight;
  const profile = PREFLIGHT_PROFILES.find((item) => item.id === state.preflightProfile)!;
  return `${pageHead("Submission preflight", "Check before uploading elsewhere", "Local checks identify documented problems but cannot guarantee acceptance by an external service.")}
    <section class="card"><div class="card-head"><h3>Destination</h3><span class="support-chip">${escapeHtml(profile.support)} support</span></div><div class="card-body stack"><div class="field-grid three"><label class="field"><span>Preflight profile</span><select id="preflight-profile" class="select">${PREFLIGHT_PROFILES.map((item) => `<option value="${item.id}" ${item.id === state.preflightProfile ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}</select></label>${state.preflightProfile === "qrz" ? `<label class="field"><span>QRZ range start</span><input id="qrz-date-from" type="date" class="input" /></label><label class="field"><span>QRZ range end</span><input id="qrz-date-to" type="date" class="input" /></label>` : ""}</div><p>${escapeHtml(profile.description)}</p><p class="help-text">Version: ${escapeHtml(profile.version)} · reviewed ${escapeHtml(profile.reviewed)} · <a href="${escapeHtml(profile.source)}" target="_blank" rel="noopener noreferrer">source documentation</a></p><div class="button-row"><button class="btn primary" data-action="run-preflight">Run local preflight</button>${result?.diagnostics.some((item) => item.code === "ADIF-DEPRECATED-MODE") ? `<button class="btn" data-action="preview-modernize-modes">Preview mode migration</button>` : ""}${result ? `<button class="btn" data-action="download-preflight-ready">Export ready ADI</button><button class="btn ghost" data-action="download-preflight-rejected" ${!result.rejected.length ? "disabled" : ""}>Export rejected ADI</button><button class="btn ghost" data-action="download-preflight-report">HTML report</button>` : ""}</div></div></section>
    ${result ? `<div class="metric-grid" style="margin-top:1rem">${metric("Ready", result.ready.length, "exportable records")}${metric("Rejected", result.rejected.length, "blocking errors")}${metric("Review", result.review.length, "warnings")}${metric("Findings", result.diagnostics.length, result.profile.name)}</div><section class="card"><div class="card-head"><h3>Preflight findings</h3></div><div class="card-body">${result.diagnostics.length ? `<div class="diagnostic-list">${result.diagnostics.map((item) => `<button class="diagnostic" data-preflight-diagnostic="${escapeHtml(item.id)}"><span class="severity-dot ${item.severity}"></span><span><strong>${escapeHtml(item.message)}</strong><span>${item.lineNumber ? `Record ${item.lineNumber}${item.field ? ` · ${escapeHtml(item.field)}` : ""}` : "Document-level"}${item.suggestion ? ` · ${escapeHtml(item.suggestion)}` : ""}</span></span><code>${escapeHtml(item.code)}</code></button>`).join("")}</div>` : `<div class="status-banner success"><span>✓</span><div><strong>All implemented ${escapeHtml(result.profile.name)} checks passed.</strong><br />Final acceptance remains the destination service's responsibility.</div></div>`}</div></section>` : ""}${compactTransformationReview()}${stationProfilesPanel()}`;
}

function duplicateView(): string {
  if (!state.document) return emptyView();
  if (state.document.format !== "adif") return `${pageHead("Duplicate workbench", "Open an ADIF or ADX log", "Duplicate comparison operates on structured ADIF fields.")}<div class="status-banner info"><span>i</span><div>Convert the current file to ADIF before reviewing duplicate candidates.</div></div>`;
  return `${pageHead("Duplicate workbench", `${state.duplicates.length} candidate${state.duplicates.length === 1 ? "" : "s"}`, "Exact, LoTW, near, possible, and activity-aware matches are shown separately.", `<button class="btn" data-action="choose-duplicate-files">Compare other files</button><button class="btn" data-action="download-duplicate-report" ${!state.duplicates.length ? "disabled" : ""}>Download CSV report</button>`)}<section class="card" style="margin-bottom:1rem"><div class="card-body"><div class="field-grid"><label class="field"><span>Near-match tolerance (minutes)</span><input id="duplicate-tolerance" class="input" type="number" min="0" max="60" value="${state.duplicateTolerance}" /></label><div class="field field-action"><span>Recheck</span><button class="btn" data-action="scan-duplicates">Scan current log</button></div></div></div></section>${compactTransformationReview()}${state.duplicates.length ? `<div class="duplicate-list">${state.duplicates.slice(0, 500).map((candidate) => `<section class="card"><div class="card-head"><h3>${escapeHtml(candidate.kind)} · ${escapeHtml(adifValue(candidate.first, "CALL"))}</h3><span class="help-text">${escapeHtml(candidate.reason)}</span></div><div class="card-body"><div class="grid-2"><pre class="code-preview">${escapeHtml(candidate.first.tags.map((tag) => `${tag.name}=${tag.value}`).join("\n"))}</pre><pre class="code-preview">${escapeHtml(candidate.second.tags.map((tag) => `${tag.name}=${tag.value}`).join("\n"))}</pre></div><p class="help-text">Differing fields: ${escapeHtml(candidate.differingFields.join(", ") || "none")}</p>${candidate.differingFields.length ? `<div class="field-grid three">${candidate.differingFields.map((field) => `<label class="field"><span>${escapeHtml(field)}</span><select class="select" data-duplicate-choice="${candidate.id}" data-duplicate-field="${escapeHtml(field)}"><option value="first">First: ${escapeHtml(adifValue(candidate.first, field) || "empty")}</option><option value="second">Second: ${escapeHtml(adifValue(candidate.second, field) || "empty")}</option></select></label>`).join("")}</div>` : ""}<div class="button-row"><button class="btn" data-action="resolve-duplicate" data-duplicate-id="${candidate.id}" data-resolution="keep-first">Keep first</button><button class="btn" data-action="resolve-duplicate" data-duplicate-id="${candidate.id}" data-resolution="keep-last">Keep last</button><button class="btn ghost" data-action="resolve-duplicate" data-duplicate-id="${candidate.id}" data-resolution="keep-both">Keep both</button><button class="btn primary" data-action="resolve-duplicate" data-duplicate-id="${candidate.id}" data-resolution="merge">Merge chosen fields</button></div></div></section>`).join("")}</div>` : `<div class="status-banner success"><span>✓</span><div><strong>No duplicate candidates found.</strong><br />The indexed matcher checked the current document.</div></div>`}`;
}

function repairView(): string {
  if (!state.document) return emptyView();
  if (state.document.format !== "cabrillo") return `${pageHead("Repair", "Cabrillo Doctor tools", "Fixed-column realignment applies to Cabrillo logs. ADIF and EDI fields can be edited directly in the QSO table.")}<div class="status-banner info"><span>i</span><div><strong>No Cabrillo repair preview</strong><br />This format has no fixed-column Cabrillo repairs; edit its structured fields or raw source directly.</div></div>`;
  const transformation = state.transformation;
  const selectedLabel = state.selectedRows.length ? `${state.selectedRows.length} selected QSO${state.selectedRows.length === 1 ? "" : "s"}` : "all QSOs";
  return `${pageHead("Cabrillo Doctor", state.repairs.length ? `${state.repairs.length} proposed automatic line change${state.repairs.length === 1 ? "" : "s"}` : "No automatic repairs proposed", "Preview every automatic or manual transformation before applying it.", state.repairs.length ? `<button class="btn primary" data-action="apply-repairs">Apply automatic repairs</button>` : "")}
    <div class="status-banner ${state.repairs.length ? "warning" : "success"}" style="margin-bottom:1rem"><span>${state.repairs.length ? "!" : "✓"}</span><div><strong>${state.repairs.length ? "Review before applying" : "Column structure is stable"}</strong><br />Unknown and malformed non-QSO lines are never discarded.</div></div>
    <section class="card" style="margin-bottom:1rem"><div class="card-head"><h3>Manual transformations</h3><span class="help-text">Target: ${escapeHtml(selectedLabel)}</span></div><div class="card-body stack">
      <div class="field-grid three"><label class="field"><span>Time shift in minutes</span><input id="transform-minutes" class="input" type="number" value="60" /></label><div class="field field-action"><span>QSO date and time</span><button class="btn" data-action="preview-time-shift">Preview shift</button></div><div class="field field-action"><span>Record order</span><button class="btn" data-action="preview-sort">Preview chronological sort</button></div></div>
      <div class="field-grid three"><label class="field"><span>Mode from</span><input id="transform-mode-from" class="input" value="PH" maxlength="24" /></label><label class="field"><span>Mode to</span><input id="transform-mode-to" class="input" value="CW" maxlength="24" /></label><div class="field field-action"><span>Mode values</span><div class="button-row"><button class="btn" data-action="preview-mode">Preview conversion</button><button class="btn ghost" data-action="save-mode-mapping">Save mapping</button><button class="btn ghost" data-action="preview-normalize-modes">Use mappings</button></div></div></div><p class="help-text">${Object.keys(state.modeMappings).length} extended mode mapping${Object.keys(state.modeMappings).length === 1 ? "" : "s"} saved locally in this browser.</p>
      <div class="field-grid three"><label class="field"><span>Serial field</span><select id="transform-serial-field" class="select"><option>STX</option><option>STX_STRING</option><option>SRX</option><option>SRX_STRING</option></select></label><label class="field"><span>Serial width</span><input id="transform-serial-width" class="input" type="number" min="1" max="12" value="3" /></label><div class="field field-action"><span>Serial numbers</span><button class="btn" data-action="preview-serial">Preview normalization</button></div></div>
      <div class="field-grid three"><label class="field"><span>Sequential start</span><input id="transform-serial-start" class="input" type="number" min="0" value="1" /></label><div class="field field-action"><span>Selected serial field</span><button class="btn" data-action="preview-sequential-serial">Preview sequence</button></div><div></div></div>
      <div class="field-grid three"><label class="field"><span>Date source format</span><select id="transform-date-from" class="select"><option>YYYY-MM-DD</option><option>YYYYMMDD</option><option>YYYY.MM.DD</option><option>YYYY/MM/DD</option><option>DD-MMM-YYYY</option><option>DD/MM/YYYY</option><option>MM/DD/YYYY</option></select></label><div class="field field-action"><span>QSO_DATE → YYYY-MM-DD</span><button class="btn" data-action="preview-date-convert">Preview date conversion</button></div><div></div></div>
      <div class="field-grid three"><label class="field"><span>Time source</span><select id="transform-time-from" class="select"><option>HHMM</option><option>HHMMSS</option><option>HH:MM</option><option>HH:MM:SS</option></select></label><label class="field"><span>Time target</span><select id="transform-time-to" class="select"><option>HHMM</option><option>HHMMSS</option><option>HH:MM</option><option>HH:MM:SS</option></select></label><div class="field field-action"><span>TIME_ON</span><button class="btn" data-action="preview-time-convert">Preview format conversion</button></div></div>
      <div class="field-grid three"><label class="field"><span>Frequency field</span><select id="transform-frequency-field" class="select"><option>FREQUENCY</option><option>FREQ_RX</option><option>BAND</option></select></label><label class="field"><span>Conversion</span><select id="transform-frequency-direction" class="select"><option value="KHZ_TO_MHZ">kHz to MHz</option><option value="MHZ_TO_KHZ">MHz to kHz</option><option value="FREQ_TO_BAND">Frequency to band</option><option value="BAND_TO_FREQ">Band to representative frequency</option></select></label><div class="field field-action"><span>Frequency or band</span><button class="btn" data-action="preview-frequency-convert">Preview conversion</button></div></div>
      <div class="button-row"><button class="btn" data-action="preview-unicode">Clean unsafe characters</button><button class="btn" data-action="preview-line-ending" data-newline="lf">Use LF</button><button class="btn" data-action="preview-line-ending" data-newline="crlf">Use CRLF</button><button class="btn" data-action="preview-line-ending" data-newline="cr">Use CR</button><button class="btn" data-action="preview-footer" data-footer="add">Add footer</button><button class="btn" data-action="preview-footer" data-footer="remove">Remove footer</button></div>
      <p class="help-text">Select QSO rows in the QSO table to limit row-aware transformations. With no rows selected, every QSO is included.</p>
    </div></section>
    ${transformation ? `<section class="card" style="margin-bottom:1rem"><div class="card-head"><h3>${escapeHtml(transformation.label)} · ${transformation.changes.length} change${transformation.changes.length === 1 ? "" : "s"}</h3><div class="button-row"><button class="btn ghost" data-action="cancel-transformation">Cancel</button><button class="btn primary" data-action="apply-transformation" ${!transformation.changes.length ? "disabled" : ""}>Apply changes</button></div></div><div class="card-body">${transformation.lossy ? `<div class="status-banner warning"><span>!</span><div><strong>Potentially lossy operation</strong><br />Keep the original file and review every change below.</div></div>` : ""}${transformation.warnings.map((warning) => `<div class="status-banner warning"><span>!</span><div>${escapeHtml(warning)}</div></div>`).join("")}<div class="repair-list">${transformation.changes.slice(0, 500).map((change) => `<article class="repair-item"><div class="repair-title"><span>${change.lineNumber ? `Line ${change.lineNumber}` : "Document"}${change.field ? ` · ${escapeHtml(change.field)}` : ""}</span><span class="repair-reasons">${escapeHtml(change.description)}</span></div><div class="diff"><span class="diff-del">− ${escapeHtml(change.before)}</span><span class="diff-add">+ ${escapeHtml(change.after)}</span></div></article>`).join("")}</div>${transformation.changes.length > 500 ? `<p class="help-text">Preview limited to the first 500 changes.</p>` : ""}</div></section>` : ""}
    <div class="repair-list">${state.repairs.map((change) => `<article class="repair-item"><div class="repair-title"><span>Line ${change.lineNumber}</span><span class="repair-reasons">${escapeHtml(change.reasons.join(" · "))}</span></div><div class="diff"><span class="diff-del">− ${escapeHtml(change.before)}</span><span class="diff-add">+ ${escapeHtml(change.after)}</span></div></article>`).join("")}</div>`;
}

function searchView(): string {
  if (!state.document) return emptyView();
  const options = state.searchOptions;
  const transformation = state.transformation?.operationId === "replace-all" ? state.transformation : null;
  return `${pageHead("Search and replace", state.searchMatches.length ? `${state.searchMatches.length} match${state.searchMatches.length === 1 ? "" : "es"}` : "Find log content", "Search the whole source or only QSO rows selected in the structured table.")}
    <section class="card"><div class="card-head"><h3>Search options</h3><span class="help-text">${state.selectedRows.length ? `${state.selectedRows.length} selected QSO rows` : "Whole document"}</span></div><div class="card-body stack">
      <div class="field-grid"><label class="field"><span>Find</span><input id="search-query" class="input" value="${escapeHtml(options.query)}" /></label><label class="field"><span>Replace with</span><input id="search-replacement" class="input" value="${escapeHtml(state.searchReplacement)}" /></label></div>
      <div class="button-row"><label><input id="search-case" type="checkbox" ${options.matchCase ? "checked" : ""} /> Match case</label><label><input id="search-word" type="checkbox" ${options.wholeWord ? "checked" : ""} /> Whole word</label><label><input id="search-regex" type="checkbox" ${options.regularExpression ? "checked" : ""} /> Regular expression</label><label><input id="search-backward" type="checkbox" ${options.direction === "backward" ? "checked" : ""} /> Search backward</label><label><input id="search-wrap" type="checkbox" ${options.wrap !== false ? "checked" : ""} /> Wrap search</label></div>
      <div class="button-row"><button class="btn dark" data-action="find-all">Find and mark all</button><button class="btn" data-action="find-previous" ${!state.searchMatches.length ? "disabled" : ""}>Previous</button><button class="btn" data-action="find-next" ${!state.searchMatches.length ? "disabled" : ""}>Next</button><button class="btn" data-action="preview-replace-next" ${!state.searchMatches.length ? "disabled" : ""}>Preview replace next</button><button class="btn" data-action="preview-replace">Preview replace all</button></div>
    </div></section>
    ${transformation ? `<section class="card" style="margin-top:1rem"><div class="card-head"><h3>Replacement preview · ${transformation.changes.length} change${transformation.changes.length === 1 ? "" : "s"}</h3><div class="button-row"><button class="btn ghost" data-action="cancel-transformation">Cancel</button><button class="btn primary" data-action="apply-transformation" ${!transformation.changes.length ? "disabled" : ""}>Apply replacement</button></div></div><div class="card-body"><div class="repair-list">${transformation.changes.slice(0, 500).map((change) => `<article class="repair-item"><div class="repair-title"><span>Line ${change.lineNumber ?? "—"}</span><span class="repair-reasons">${escapeHtml(change.description)}</span></div><div class="diff"><span class="diff-del">− ${escapeHtml(change.before)}</span><span class="diff-add">+ ${escapeHtml(change.after)}</span></div></article>`).join("")}</div></div></section>` : ""}
    ${state.searchMatches.length ? `<section class="card" style="margin-top:1rem"><div class="card-head"><h3>Matches</h3><span class="help-text">Mark-all result</span></div><div class="card-body"><div class="diagnostic-list">${state.searchMatches.slice(0, 1000).map((match, index) => `<button class="diagnostic ${index === state.searchIndex ? "selected" : ""}" data-search-offset="${match.start}" data-search-end="${match.end}"><span class="severity-dot info"></span><span><strong>${escapeHtml(match.value)}</strong><span>Line ${match.lineNumber} · column ${match.column}</span></span><code>${match.start}</code></button>`).join("")}</div>${state.searchMatches.length > 1000 ? `<p class="help-text">Showing the first 1,000 matches.</p>` : ""}</div></section>` : ""}`;
}

function convertView(): string {
  if (!state.document) return emptyView();
  if (state.document.format !== "text" || !state.textTable) {
    return `${pageHead("Convert", "Structured format conversion", "Review source and target fields before creating a converted file.")}<section class="card"><div class="card-body"><div class="status-banner info"><span>i</span><div><strong>${state.document.format.toUpperCase()} is already structured.</strong><br />Use Export to preview Cabrillo, ADIF, and CSV output. Unknown source fields are retained where the target format permits it.</div></div><div class="button-row" style="margin-top:1rem"><button class="btn primary" data-view="export">Open export and conversion</button></div></div></section>`;
  }
  const table = state.textTable;
  const preview = state.tablePreview;
  const shownColumns = table.columns.slice(0, 120);
  const shownRows = table.rows.slice(0, 500);
  const assigned = table.columns.filter((column) => !/^COLUMN_\d+$/.test(column.name) && column.name !== "UNASSIGNED").length;
  return `${pageHead("Plain-text mapper", `${table.rows.length} rows · ${table.columns.length} columns`, "Define logical fields, preview table operations, validate mappings, and export without changing the original uploaded file.")}
    <div class="metric-grid">${metric("Rows", table.rows.length, "imported records")}${metric("Columns", table.columns.length, table.delimiter ? `detected ${table.delimiter === "\t" ? "tab" : table.delimiter} delimiter` : "character grid")}${metric("Assigned", assigned, "named ADIF fields")}${metric("Selected", state.selectedTableColumns.length, "columns")}</div>
    <section class="card" style="margin-bottom:1rem"><div class="card-head"><h3>Table operations</h3><span class="help-text">Every operation is previewed and undoable</span></div><div class="card-body stack">
      <div class="field-grid three"><label class="field"><span>Find text</span><input id="table-find" class="input" /></label><label class="field"><span>Replacement, constant, or default</span><input id="table-value" class="input" /></label><label class="field"><span>Split separator</span><input id="table-separator" class="input" maxlength="8" value=" " /></label></div>
      <div class="button-row"><button class="btn" data-table-operation="replace">Replace</button><button class="btn" data-table-operation="trim">Trim</button><button class="btn" data-table-operation="trim-all">Remove spaces</button><button class="btn" data-table-operation="remove-alpha">Remove alpha</button><button class="btn" data-table-operation="remove-numeric">Remove numeric</button><button class="btn" data-table-operation="remove-symbols">Remove symbols</button><button class="btn" data-table-operation="remove-left">Remove left char</button><button class="btn" data-table-operation="remove-right">Remove right char</button><button class="btn" data-table-operation="fill">Fill</button><button class="btn" data-table-operation="empty">Empty</button></div>
      <div class="button-row"><button class="btn" data-table-operation="serial">Add serial</button><button class="btn" data-table-operation="insert">Insert column</button><button class="btn" data-table-operation="duplicate">Duplicate column</button><button class="btn" data-table-operation="copy">Copy column</button><button class="btn" data-table-operation="paste">Paste column</button><button class="btn" data-table-operation="move-column-left">Move column left</button><button class="btn" data-table-operation="move-column-right">Move column right</button><button class="btn" data-table-operation="split">Split column</button><button class="btn" data-table-operation="join">Join columns</button><button class="btn" data-table-operation="combine">Combine columns</button><button class="btn" data-table-operation="delete-columns">Delete columns</button><button class="btn" data-table-operation="keep-columns">Keep selected columns</button></div>
      <div class="button-row"><button class="btn" data-table-operation="shift-left">Shift rows left</button><button class="btn" data-table-operation="shift-right">Shift rows right</button><button class="btn" data-table-operation="align">Align selected rows</button><button class="btn" data-table-operation="move-up">Move row up</button><button class="btn" data-table-operation="move-down">Move row down</button><button class="btn danger" data-table-operation="delete-rows">Delete rows</button></div>
    </div></section>
    ${preview ? `<section class="card" style="margin-bottom:1rem"><div class="card-head"><h3>${escapeHtml(preview.label)} · ${preview.changes.length} change${preview.changes.length === 1 ? "" : "s"}</h3><div class="button-row"><button class="btn ghost" data-action="cancel-table-preview">Cancel</button><button class="btn primary" data-action="apply-table-preview" ${!preview.changes.length ? "disabled" : ""}>Apply</button></div></div><div class="card-body">${preview.warnings.map((warning) => `<div class="status-banner warning"><span>!</span><div>${escapeHtml(warning)}</div></div>`).join("")}<div class="repair-list">${preview.changes.slice(0, 300).map((change) => `<article class="repair-item"><div class="repair-title"><span>${change.rowId ? escapeHtml(change.rowId) : "Column"}${change.columnIndex === undefined ? "" : ` · ${change.columnIndex + 1}`}</span><span>${escapeHtml(change.description)}</span></div><div class="diff"><span class="diff-del">− ${escapeHtml(change.before)}</span><span class="diff-add">+ ${escapeHtml(change.after)}</span></div></article>`).join("")}</div></div></section>` : ""}
    <section class="card"><div class="card-head"><h3>Field mapping</h3><span class="help-text">Select columns with the header checkboxes; rename using the field lists</span></div><div class="card-body"><div class="table-wrap"><table class="data-table mapping-table"><thead><tr><th>Row</th>${shownColumns.map((column, index) => `<th><label><input type="checkbox" data-table-column="${index}" ${state.selectedTableColumns.includes(index) ? "checked" : ""} /><span class="sr-only">Select column ${index + 1}</span></label><input class="input column-name" data-column-name="${index}" list="adif-field-list" value="${escapeHtml(column.name)}" aria-label="Field name for column ${index + 1}" /></th>`).join("")}</tr></thead><tbody>${shownRows.map((row) => `<tr><td><label><input type="checkbox" data-table-row="${escapeHtml(row.id)}" ${state.selectedTableRows.includes(row.id) ? "checked" : ""} /><span class="sr-only">Select row</span></label></td>${shownColumns.map((_, index) => `<td><input class="cell-input" data-table-cell-row="${escapeHtml(row.id)}" data-table-cell-column="${index}" value="${escapeHtml(row.cells[index] ?? "")}" aria-label="Row field ${index + 1}" /></td>`).join("")}</tr>`).join("")}</tbody></table></div><datalist id="adif-field-list">${adifFields.map((field) => `<option value="${escapeHtml(field)}"></option>`).join("")}</datalist>${table.columns.length > shownColumns.length || table.rows.length > shownRows.length ? `<p class="help-text">The interactive preview shows the first ${shownColumns.length} columns and ${shownRows.length} rows for responsiveness; operations still apply to the selected full table.</p>` : ""}</div></section>
    <section class="card" style="margin-top:1rem"><div class="card-head"><h3>Mapped output</h3></div><div class="card-body"><div class="button-row"><button class="btn primary" data-action="preview-table-export" data-export-type="adif">Preview ADIF</button><button class="btn" data-action="preview-table-export" data-export-type="cabrillo">Preview Cabrillo</button><button class="btn" data-action="preview-table-export" data-export-type="csv">Preview CSV</button></div></div></section>`;
}

function scoreView(): string {
  if (!state.document) return emptyView();
  if (state.document.format === "edi") return ediScoreView(state.document);
  if (state.document.format !== "cabrillo" || !state.score) return `${pageHead("Scoring", "Cabrillo log required", "Convert the current file to Cabrillo to calculate a transparent contest score.")}<div class="status-banner info"><span>i</span><div><strong>Scoring is unavailable for this format.</strong><br />ADIF conversion is available in Export.</div></div>`;
  const score = state.score;
  return `${pageHead("Transparent scoring", score.ruleName, "Choose a fixture-backed rule. Each contact exposes editable points and multiplier inputs.", `<button class="btn" data-action="download-score-csv">Detailed CSV</button><button class="btn" data-action="preview-report">HTML report</button><button class="btn primary" data-action="update-claimed-score">Update CLAIMED-SCORE</button>`)}
    <div class="grid-2"><section class="score-hero"><p class="eyebrow">Calculated score</p><div class="score-total">${score.total.toLocaleString()}</div><div class="score-formula">${escapeHtml(score.formula)} · ${score.duplicates} duplicates removed</div></section>
    <section class="card"><div class="card-head"><h3>Scoring rule</h3></div><div class="card-body stack"><label class="field"><span>Rule</span><select id="score-rule" class="select">${scoringRules.map((rule) => `<option value="${rule.id}" ${rule.id === state.ruleId ? "selected" : ""}>${escapeHtml(rule.name)}</option>`).join("")}</select></label><p class="help-text">${escapeHtml(scoringRules.find((rule) => rule.id === state.ruleId)?.description ?? "")}</p><button class="btn dark" data-action="calculate-score">Recalculate</button></div></section></div>
    <section class="card" style="margin-top:1rem"><div class="card-head"><h3>Contact scoring trace</h3><span class="help-text">${score.qsos} valid contacts · edit then Rescan to restore rule values</span></div><div class="card-body"><div class="table-wrap"><table class="data-table"><thead><tr><th>Call</th><th>Band</th><th>Mode</th><th>Country</th><th>Points</th><th>Bonus</th><th>Multiplier</th><th>Status</th><th>Rule</th></tr></thead><tbody>${score.rows.map((row) => `<tr><td>${escapeHtml(row.call)}</td><td>${escapeHtml(row.band)}</td><td>${escapeHtml(row.mode)}</td><td>${escapeHtml(row.country)}</td><td><input class="cell-input" type="number" data-score-id="${escapeHtml(row.qsoId)}" data-score-field="points" value="${row.points}" aria-label="Points for ${escapeHtml(row.call)}" /></td><td>${row.bonusPoints ?? 0}</td><td><input class="cell-input" data-score-id="${escapeHtml(row.qsoId)}" data-score-field="multiplier" value="${escapeHtml(row.multiplier)}" aria-label="Multiplier for ${escapeHtml(row.call)}" /></td><td>${row.duplicate ? "Duplicate" : "Counted"}</td><td><button class="btn ghost" data-action="rescan-score-row" data-score-id="${escapeHtml(row.qsoId)}">Rescan</button></td></tr>`).join("")}</tbody></table></div>${score.notes.map((note) => `<p class="help-text">${escapeHtml(note)}</p>`).join("")}</div></section>`;
}

function ediScoreView(documentValue: EdiDocument): string {
  const score = calculateEdiScore(documentValue, state.ediScoreFormula);
  const claimedMatches = score.claimedTotal !== null && score.claimedTotal === score.total;
  const statusLabel: Record<(typeof score.rows)[number]["status"], string> = { counted: "Counted", duplicate: "Duplicate", error: "Error record", incomplete: "Incomplete / zero points" };
  const formulaOptions = (Object.entries(EDI_SCORE_FORMULAS) as Array<[EdiScoreFormula, string]>).map(([value, label]) => `<option value="${value}" ${state.ediScoreFormula === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
  return `${pageHead("EDI score recalculation", ediHeader(documentValue, "TName") || "REG1TEST / EDI", "Recalculate declared totals from the file’s per-QSO points and scoring flags.", `<button class="btn primary" data-action="update-edi-score">Update EDI score fields</button>`)}
    <div class="grid-2"><section class="score-hero"><p class="eyebrow">Calculated score</p><div class="score-total">${score.total.toLocaleString()}</div><div class="score-formula">${escapeHtml(score.formulaLabel)} · ${score.duplicates} duplicate${score.duplicates === 1 ? "" : "s"} excluded</div></section>
    <section class="card"><div class="card-head"><h3>Total-score formula</h3></div><div class="card-body stack"><label class="field"><span>Formula</span><select id="edi-score-formula" class="select"><option value="auto" ${state.ediScoreFormula === "auto" ? "selected" : ""}>Auto-detect from CToSc</option>${formulaOptions}</select></label><p class="help-text">The EDI standard does not define one universal CToSc formula. Auto-detect compares the claimed score with safe combinations of recorded points, bonuses and multipliers.</p><button class="btn dark" data-action="calculate-edi-score">Recalculate</button></div></section></div>
    <div class="metric-grid" style="margin-top:1rem">${metric("Valid QSOs", score.validQsos, "positive recorded points")}${metric("QSO points", score.qsoPoints.toLocaleString(), "CQSOP")}${metric("Duplicates", score.duplicates, "D flag excluded")}${metric("Incomplete", score.invalid, "ERROR or zero/missing points")}</div>
    <section class="card" style="margin-bottom:1rem"><div class="card-head"><h3>Claimed total comparison</h3><span class="help-text">${score.inferred ? "Formula inferred from CToSc" : "Selected/default formula"}</span></div><div class="card-body stack">
      <div class="status-banner ${claimedMatches ? "success" : "warning"}"><span>${claimedMatches ? "✓" : "!"}</span><div><strong>${score.claimedTotal === null ? "No claimed CToSc is present" : `Claimed ${score.claimedTotal.toLocaleString()} · calculated ${score.total.toLocaleString()}`}</strong><br />${claimedMatches ? "The recalculated total matches the file." : "Review the selected formula before updating the header."}</div></div>
      ${score.warnings.map((warning) => `<div class="status-banner warning"><span>!</span><div>${escapeHtml(warning)}</div></div>`).join("")}
      <div class="table-wrap"><table class="data-table"><thead><tr><th>Component</th><th>Count</th><th>Bonus each</th><th>Bonus total</th><th>Multiplier</th></tr></thead><tbody>
        <tr><td>WWL</td><td>${score.newWwls}</td><td>${score.newWwls ? score.wwlBonus / score.newWwls : 0}</td><td>${score.wwlBonus}</td><td>${score.wwlMultiplier}</td></tr>
        <tr><td>Exchange</td><td>${score.newExchanges}</td><td>${score.newExchanges ? score.exchangeBonus / score.newExchanges : 0}</td><td>${score.exchangeBonus}</td><td>${score.exchangeMultiplier}</td></tr>
        <tr><td>DXCC</td><td>${score.newDxccs}</td><td>${score.newDxccs ? score.dxccBonus / score.newDxccs : 0}</td><td>${score.dxccBonus}</td><td>${score.dxccMultiplier}</td></tr>
      </tbody></table></div>
    </div></section>
    <section class="card"><div class="card-head"><h3>Contact scoring trace</h3><span class="help-text">${score.rows.length} records · first ${Math.min(score.rows.length, 1000)} shown</span></div><div class="card-body"><div class="table-wrap"><table class="data-table"><thead><tr><th>Line</th><th>Call</th><th>Recorded points</th><th>Status</th></tr></thead><tbody>${score.rows.slice(0, 1000).map((row) => `<tr><td>${row.lineNumber}</td><td>${escapeHtml(row.call)}</td><td>${row.points}</td><td>${statusLabel[row.status]}</td></tr>`).join("")}</tbody></table></div><p class="help-text">Per-QSO points are authoritative input to this recalculation and are not replaced by an assumed distance formula. Edit them in QSOs when the contest adjudication requires a correction.</p></div></section>`;
}

function bars(entries: Array<{ label: string; value: number }>): string {
  const max = Math.max(1, ...entries.map((item) => item.value));
  return `<div class="bar-chart">${entries.map((item) => `<div class="bar-row"><span>${escapeHtml(item.label)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, item.value / max * 100)}%"></div></div><strong>${item.value}</strong></div>`).join("")}</div>`;
}

interface GeneralAnalysisRecord {
  call: string;
  date: string;
  time: string;
  band: string;
  mode: string;
  country: string;
  qsl: string;
}

function groupedCounts(values: string[]): Array<{ label: string; value: number }> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value || "Unknown", (counts.get(value || "Unknown") ?? 0) + 1);
  return [...counts].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

function generalAnalysisView(documentValue: AdifDocument | EdiDocument): string {
  const records: GeneralAnalysisRecord[] = documentValue.format === "adif"
    ? documentValue.records.map((record) => {
      const call = adifValue(record, "CALL").trim().toUpperCase();
      const frequency = adifValue(record, "FREQ");
      return {
        call, date: adifValue(record, "QSO_DATE"), time: adifValue(record, "TIME_ON") || adifValue(record, "TIME_OFF"),
        band: adifValue(record, "BAND").toUpperCase() || bandFromFrequency(frequency),
        mode: (adifValue(record, "SUBMODE") || adifValue(record, "MODE")).toUpperCase(),
        country: geography.lookup(call)?.country ?? "Unresolved",
        qsl: adifValue(record, "QSL_RCVD").toUpperCase() || "Not recorded",
      };
    })
    : documentValue.records.map((record) => {
      const call = ediField(record, "CALL").trim().toUpperCase();
      return {
        call, date: ediField(record, "DATE"), time: ediField(record, "TIME"), band: ediHeader(documentValue, "PBand") || "Unknown",
        mode: EDI_MODE_NAMES[ediField(record, "MODE_CODE")] ?? `Mode ${ediField(record, "MODE_CODE") || "unknown"}`,
        country: geography.lookup(call)?.country ?? "Unresolved", qsl: "Not recorded",
      };
    });
  const uniqueCalls = new Set(records.map((record) => record.call).filter(Boolean)).size;
  const seen = new Set<string>();
  let duplicateCandidates = 0;
  for (const record of records) {
    const key = `${record.call}|${record.date}|${record.time}|${record.band}|${record.mode}`;
    if (record.call && seen.has(key)) duplicateCandidates += 1;
    seen.add(key);
  }
  if (documentValue.format === "edi") duplicateCandidates = Math.max(duplicateCandidates, documentValue.records.filter((record) => ediField(record, "DUPLICATE").trim().toUpperCase() === "D").length);
  const dated = records.filter((record) => record.date).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  const bands = groupedCounts(records.map((record) => record.band));
  const modes = groupedCounts(records.map((record) => record.mode));
  const countries = groupedCounts(records.map((record) => record.country));
  const days = groupedCounts(records.map((record) => record.date));
  const qsl = documentValue.format === "adif" ? groupedCounts(records.map((record) => record.qsl)) : [];
  const table = (title: string, entries: Array<{ label: string; value: number }>, label: string) => `<section class="card"><div class="card-head"><h3>${escapeHtml(title)}</h3></div><div class="card-body"><div class="table-wrap"><table class="data-table"><thead><tr><th>${escapeHtml(label)}</th><th>QSOs</th></tr></thead><tbody>${entries.slice(0, 100).map((item) => `<tr><td>${escapeHtml(item.label)}</td><td>${item.value}</td></tr>`).join("")}</tbody></table></div></div></section>`;
  return `${pageHead("Log analysis", "Activity and contact overview", "General statistics work without a contest rule. Country results use the active local CTY data as assistance.")}
    <div class="metric-grid">${metric("Contacts", records.length, "all parsed records")}${metric("Unique calls", uniqueCalls, "distinct callsigns")}${metric("Duplicate candidates", duplicateCandidates, "same call, date, time, band and mode")}${metric("Date range", dated.length ? `${dated[0]!.date}–${dated.at(-1)!.date}` : "—", "first to last record")}</div>
    <div class="grid-2"><section class="card"><div class="card-head"><h3>QSOs by band</h3></div><div class="card-body">${bars(bands.slice(0, 15))}</div></section><section class="card"><div class="card-head"><h3>QSOs by mode</h3></div><div class="card-body">${bars(modes.slice(0, 15))}</div></section></div>
    <div class="grid-2" style="margin-top:1rem">${table("Band totals", bands, "Band")}${table("Mode totals", modes, "Mode")}</div>
    <div class="grid-2" style="margin-top:1rem">${table("Activity by date", days, "Date")}${table("Countries", countries, "Country")}</div>
    ${qsl.length ? `<div style="margin-top:1rem">${table("Paper QSL status", qsl, "Status")}</div>` : ""}`;
}

function statisticsView(): string {
  if (!state.document) return emptyView();
  if (state.document.format === "adif" || state.document.format === "edi") return generalAnalysisView(state.document);
  if (state.document.format !== "cabrillo" || !state.score) return `${pageHead("Log analysis", "Map the text log first", "Assign fields in Convert to unlock structured contact analysis.")}<div class="status-banner info"><span>i</span><div><strong>Structured records are required</strong><br />The current plain-text document has no field mapping yet.</div></div>`;
  const score = state.score;
  const buckets = activityBuckets(state.document, score.rows, state.statisticsInterval, { start: state.statisticsStart || undefined, end: state.statisticsEnd || undefined });
  return `${pageHead("Contest analysis", "Band and activity breakdown", "Accessible tables accompany every compact chart; counts exclude detected duplicates.", `<button class="btn" data-action="download-statistics-csv">Activity CSV</button><button class="btn" data-action="download-statistics-svg">Chart SVG</button>`)}
    <section class="card" style="margin-bottom:1rem"><div class="card-head"><h3>Chart period</h3></div><div class="card-body"><div class="field-grid three"><label class="field"><span>Start date and time</span><input id="statistics-start" class="input" type="datetime-local" value="${escapeHtml(state.statisticsStart)}" /></label><label class="field"><span>End date and time</span><input id="statistics-end" class="input" type="datetime-local" value="${escapeHtml(state.statisticsEnd)}" /></label><label class="field"><span>Interval in minutes</span><select id="statistics-interval" class="select">${[15, 30, 60, 120, 240, 1440].map((value) => `<option value="${value}" ${state.statisticsInterval === value ? "selected" : ""}>${value}</option>`).join("")}</select></label></div></div></section>
    <div class="grid-2"><section class="card"><div class="card-head"><h3>QSOs by band</h3></div><div class="card-body">${bars(score.byBand.map((row) => ({ label: row.band, value: row.qsos })))}</div></section><section class="card"><div class="card-head"><h3>Points by interval</h3></div><div class="card-body">${bars(buckets.map((row) => ({ label: row.start.slice(5, 16).replace("T", " "), value: row.points })))}</div></section></div>
    <div class="grid-2" style="margin-top:1rem"><section class="card"><div class="card-head"><h3>Band totals</h3></div><div class="card-body"><div class="table-wrap"><table class="data-table"><thead><tr><th>Band</th><th>QSOs</th><th>Points</th><th>Multipliers</th></tr></thead><tbody>${score.byBand.map((row) => `<tr><td>${escapeHtml(row.band)}</td><td>${row.qsos}</td><td>${row.points}</td><td>${row.multipliers}</td></tr>`).join("")}</tbody></table></div></div></section><section class="card"><div class="card-head"><h3>Mode totals</h3></div><div class="card-body"><div class="table-wrap"><table class="data-table"><thead><tr><th>Mode</th><th>QSOs</th><th>Points</th></tr></thead><tbody>${score.byMode.map((row) => `<tr><td>${escapeHtml(row.mode)}</td><td>${row.qsos}</td><td>${row.points}</td></tr>`).join("")}</tbody></table></div></div></section></div>
    <section class="card" style="margin-top:1rem"><div class="card-head"><h3>Country and continent totals</h3><span class="help-text">Resolved locally from the recovered DXCC table; treat as assistance</span></div><div class="card-body"><div class="table-wrap"><table class="data-table"><thead><tr><th>Country</th><th>Continent</th><th>QSOs</th><th>Points</th></tr></thead><tbody>${score.byCountry.map((row) => `<tr><td>${escapeHtml(row.country)}</td><td>${escapeHtml(row.continent || "—")}</td><td>${row.qsos}</td><td>${row.points}</td></tr>`).join("")}</tbody></table></div></div></section>`;
}

function buildConversion(type: "adif" | "adx" | "cabrillo" | "edi" | "csv"): ConversionResult | null {
  if (!state.document) return null;
  if (type === "csv" && state.document.format === "edi") return ediToCsv(state.document, state.csvDelimiter);
  if (type === "csv" && (state.document.format === "cabrillo" || state.document.format === "adif")) return documentToCsv(state.document, state.csvDelimiter);
  if (type === "adif" && state.document.format === "edi") return ediToAdif(state.document);
  if (type === "adif" && state.document.format === "cabrillo") return cabrilloToAdif(state.document, { fieldMap: state.cabrilloToAdifMap });
  if (type === "adif" && state.document.format === "adif") return { content: serializeAdifWithOptions(state.document, state.adifOptions), warnings: [], records: state.document.records.length };
  if (type === "adx" && state.document.format === "adif") return { content: serializeAdx(state.document), warnings: state.document.container === "adi" ? ["ADX is canonical XML output; keep the original ADI file for exact source recovery."] : [], records: state.document.records.length };
  if (type === "cabrillo" && state.document.format === "adif") return adifToCabrillo(state.document, state.stationCall, state.conversionContest, { fieldMap: state.adifToCabrilloMap });
  return { content: sourceOf(state.document), warnings: [], records: qsoCount() };
}

function qslAdifDocument(): { document: AdifDocument; content: string; warnings: string[] } | null {
  if (!state.document || state.document.format === "text") return null;
  const result = buildConversion("adif");
  if (!result) return null;
  return { document: parseAdif(result.content), content: result.content, warnings: result.warnings };
}

function qslPrintingCard(): string {
  const prepared = qslAdifDocument();
  if (!prepared) return "";
  const readiness = qslReadiness(prepared.document);
  const blocked = readiness.blocked.length;
  const status = blocked ? `${blocked} contact${blocked === 1 ? "" : "s"} need required QSL fields` : `${readiness.ready} contact${readiness.ready === 1 ? "" : "s"} ready`;
  return `<section class="card" style="margin-top:1rem"><div class="card-head"><h3>Prepare QSL printing</h3><span class="support-chip">${escapeHtml(status)}</span></div><div class="card-body stack"><p>Open ADIF to QSL Labels and preload this working log for label or card printing.</p>${blocked ? `<div class="status-banner warning"><span>!</span><div><strong>Complete the required fields before handoff.</strong><br />Missing CALL, QSO_DATE, time, band/frequency, or MODE in records: ${escapeHtml(readiness.blocked.slice(0, 10).map((item) => item.recordNumber).join(", "))}${blocked > 10 ? "…" : ""}.</div></div>` : `<div class="status-banner success"><span>✓</span><div><strong>The ADIF has the minimum fields used for QSL printing.</strong><br />The receiving tool still lets you filter contacts and choose the label layout.</div></div>`}${readiness.alreadySent ? `<div class="status-banner info"><span>i</span><div>${readiness.alreadySent} record${readiness.alreadySent === 1 ? " is" : "s are"} marked QSL_SENT=Y or Q. Review the receiving tool's filters before printing again.</div></div>` : ""}${prepared.warnings.map((warning) => `<div class="status-banner warning"><span>!</span><div>${escapeHtml(warning)}</div></div>`).join("")}<div class="button-row"><button class="btn primary" data-action="open-qsl-printing" ${blocked || !readiness.total ? "disabled" : ""}>Open QSL label tool</button><a class="btn ghost" href="${QSL_LABEL_TOOL_URL}" target="_blank" rel="noopener noreferrer">Open without log</a></div><p class="help-text">The handoff sends the ADIF only to the newly opened QSL-label tab. It is never included in analytics or a URL.</p></div></section>`;
}

function specialistToolsCard(): string {
  return `<section class="card" style="margin-top:1rem"><div class="card-head"><h3>Continue with specialized tools</h3><span class="format-pill">Free online services</span></div><div class="card-body"><p class="page-subtitle">Your log is checked and prepared. Choose what you would like to do next.</p><div class="grid-2" style="margin-top:1rem"><article class="card"><div class="card-body stack"><div><p class="eyebrow">Explore your operation</p><h3>Analyze the log with SH6</h3></div><p>Discover operating patterns, charts, maps, rates, countries, bands, and other detailed log insights in the author’s free online analyzer.</p><a class="btn dark" href="https://s53m.com/SH6" target="_blank" rel="noopener noreferrer" data-analytics="sh6_recommendation">Open SH6 log analyzer</a></div></article><article class="card"><div class="card-body stack"><div><p class="eyebrow">Finish the paper workflow</p><h3>Print QSL labels and cards</h3></div><p>Turn an ADIF log into print-ready QSL labels or cards with customizable layouts, fields, filters, and PDF output.</p><a class="btn dark" href="${QSL_LABEL_TOOL_URL}" target="_blank" rel="noopener noreferrer" data-analytics="qsl_service_link">Open ADIF to QSL</a></div></article></div></div></section>`;
}

function openQslPrinting(): void {
  const prepared = qslAdifDocument();
  if (!prepared) { toast("Open a Cabrillo, ADIF, ADX, or EDI log first."); return; }
  const readiness = qslReadiness(prepared.document);
  if (!readiness.total || readiness.blocked.length) { toast("Complete the required QSL fields before sending this log."); return; }
  const receiver = window.open(QSL_LABEL_TOOL_URL, "_blank");
  if (!receiver) { toast("Popup blocked. Allow popups to open the QSL label tool."); return; }
  const payload = { type: LOG_TRANSFER_TYPE, name: safeTransferFilename(state.fileName), content: prepared.content } as const;
  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    try { receiver.postMessage(payload, QSL_LABEL_TOOL_ORIGIN); } catch { /* The target may still be loading. */ }
    if (attempts >= 15) window.clearInterval(timer);
  }, 350);
  try { receiver.postMessage(payload, QSL_LABEL_TOOL_ORIGIN); } catch { /* The retry loop handles a loading target. */ }
  const onAck = (event: MessageEvent): void => {
    if (event.origin !== QSL_LABEL_TOOL_ORIGIN || event.source !== receiver || event.data?.type !== LOG_TRANSFER_ACK_TYPE) return;
    window.clearInterval(timer);
    window.removeEventListener("message", onAck);
    toast("Log loaded in the QSL label tool.");
  };
  window.addEventListener("message", onAck);
  window.setTimeout(() => window.removeEventListener("message", onAck), 8_000);
  trackEvent("qsl_print_handoff", { document_format: state.document?.format ?? "none", record_bucket: countBucket(readiness.total), result: "opened" });
}

function exportView(): string {
  if (!state.document) return emptyView();
  const opposite = state.document.format === "cabrillo" ? "adif" : state.document.format === "adif" ? "cabrillo" : state.document.format === "edi" ? "adif" : null;
  const currentExtension = state.document.format === "adif" ? state.document.container : state.document.format === "cabrillo" ? "log" : state.document.format === "edi" ? "edi" : "txt";
  const preview = state.conversion;
  const filterPreview = state.transformation?.operationId === "filter-adif" ? state.transformation : null;
  const mappingCard = (() => {
    if (state.document?.format === "cabrillo") {
      const sources = [...new Set(state.document.lines.flatMap((line) => line.qso?.cells.map((cell) => cell.key) ?? []))];
      return `<section class="card" style="margin-bottom:1rem"><div class="card-head"><h3>Cabrillo → ADIF field mapping</h3><button class="btn ghost" data-action="reset-conversion-map" data-map-direction="cabrillo-adif">Reset defaults</button></div><div class="card-body"><p class="help-text">Override a target tag before previewing. Leave a target blank to keep the original QSO only in the recovery field.</p><div class="field-grid three">${sources.map((source) => { const target = Object.prototype.hasOwnProperty.call(state.cabrilloToAdifMap, source) ? state.cabrilloToAdifMap[source]! : defaultCabrilloToAdifTarget(source); return `<label class="field"><span>${escapeHtml(source)}</span><input class="input" data-conversion-map="cabrillo-adif" data-map-source="${escapeHtml(source)}" list="conversion-adif-fields" value="${escapeHtml(target)}" placeholder="Recovery only" /></label>`; }).join("")}</div><datalist id="conversion-adif-fields">${adifFields.map((field) => `<option value="${escapeHtml(field)}"></option>`).join("")}</datalist></div></section>`;
    }
    if (state.document?.format === "adif") {
      const sources = [...new Set(state.document.records.flatMap((record) => record.tags.map((entry) => entry.name)))];
      const targets = [...new Set(qsoColumns(getContestLayout(state.conversionContest)).map((cell) => cell.key))];
      return `<section class="card" style="margin-bottom:1rem"><div class="card-head"><h3>ADIF → Cabrillo field mapping</h3><button class="btn ghost" data-action="reset-conversion-map" data-map-direction="adif-cabrillo">Reset defaults</button></div><div class="card-body stack"><div class="field-grid"><label class="field"><span>Station callsign</span><input id="station-call" class="input" value="${escapeHtml(state.stationCall)}" /></label><label class="field"><span>Target contest</span><input id="conversion-contest" class="input" list="contest-list" value="${escapeHtml(state.conversionContest)}" /></label></div><datalist id="contest-list">${contestNames.map((name) => `<option value="${escapeHtml(name)}"></option>`).join("")}</datalist><p class="help-text">Targets are fields in the selected recovered contest layout. Leave a target blank when the value has no Cabrillo representation.</p><div class="field-grid three">${sources.map((source) => { const target = Object.prototype.hasOwnProperty.call(state.adifToCabrilloMap, source) ? state.adifToCabrilloMap[source]! : defaultAdifToCabrilloTarget(source, state.conversionContest); return `<label class="field"><span>${escapeHtml(source)}</span><input class="input" data-conversion-map="adif-cabrillo" data-map-source="${escapeHtml(source)}" list="conversion-cabrillo-fields" value="${escapeHtml(target)}" placeholder="Recovery only" /></label>`; }).join("")}</div><datalist id="conversion-cabrillo-fields">${targets.map((field) => `<option value="${escapeHtml(field)}"></option>`).join("")}</datalist></div></section>`;
    }
    return "";
  })();
  const adifTools = state.document.format === "adif" ? `<section class="card" style="margin-bottom:1rem"><div class="card-head"><h3>ADIF merge, filters, and options</h3><span class="help-text">Unknown fields remain attached to retained records</span></div><div class="card-body stack">
    <div class="field-grid three"><label class="field"><span>Date from</span><input id="adif-date-from" class="input" type="date" /></label><label class="field"><span>Date to</span><input id="adif-date-to" class="input" type="date" /></label><label class="field"><span>Callsign</span><input id="adif-filter-call" class="input" /></label><label class="field"><span>Band list</span><input id="adif-filter-band" class="input" placeholder="40M,20M" /></label><label class="field"><span>Mode list</span><input id="adif-filter-mode" class="input" placeholder="CW,SSB" /></label><label class="field"><span>Submode list</span><input id="adif-filter-submode" class="input" /></label><label class="field"><span>CQ zones</span><input id="adif-filter-zone" class="input" placeholder="14,15" /></label><label class="field"><span>Operator</span><input id="adif-filter-operator" class="input" /></label><label class="field"><span>Paper QSL status</span><input id="adif-filter-qsl" class="input" placeholder="Y,N,R" /></label><label class="field"><span>Continents</span><input id="adif-filter-continent" class="input" placeholder="EU,NA" /></label></div><p class="help-text">If CQZ or CONT is absent, zone and continent filters use the active local DXCC/CTY table as advisory fallback data.</p>
    <div class="button-row"><button class="btn" data-action="preview-adif-filter">Preview filters</button><select id="adif-merge-strategy" class="select" aria-label="Duplicate handling"><option value="keep-first">Keep first duplicate</option><option value="keep-last">Keep last duplicate</option><option value="keep-all">Keep all records</option></select><button class="btn" data-action="choose-adif-merge">Merge ADIF files</button><button class="btn" data-action="download-callsigns">Save callsign list</button></div>
    <div class="button-row"><label><input id="adif-lowercase" type="checkbox" ${state.adifOptions.tagCase === "lower" ? "checked" : ""} /> Lowercase tags</label><label><input id="adif-types" type="checkbox" ${state.adifOptions.includeTypes ? "checked" : ""} /> Type indicators</label><label><input id="adif-comma" type="checkbox" ${state.adifOptions.decimalSeparator === "," ? "checked" : ""} /> Comma frequency decimal</label></div>
    ${state.adifMerge ? `<div class="status-banner warning"><span>!</span><div><strong>${state.adifMerge.document.records.length} merged records · ${state.adifMerge.duplicates.length} duplicate${state.adifMerge.duplicates.length === 1 ? "" : "s"}</strong><br />${escapeHtml(state.adifMerge.fileNames.join(", "))}<div class="button-row" style="margin-top:.6rem"><button class="btn primary" data-action="apply-adif-merge">Apply merge</button><button class="btn ghost" data-action="cancel-adif-merge">Cancel</button></div></div></div>` : ""}
    ${filterPreview ? `<div class="status-banner warning"><span>!</span><div><strong>${filterPreview.changes.length} record${filterPreview.changes.length === 1 ? "" : "s"} would be removed</strong><br />Filtering is undoable after application.<div class="button-row" style="margin-top:.6rem"><button class="btn primary" data-action="apply-transformation" ${!filterPreview.changes.length ? "disabled" : ""}>Apply filters</button><button class="btn ghost" data-action="cancel-transformation">Cancel</button></div></div></div>` : ""}
  </div></section>` : "";
  const structuredPreview = preview?.result.previewRows?.length ? (() => { const rows = preview.result.previewRows!.slice(0, 100); const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].slice(0, 24); return `<div class="table-wrap" style="margin-bottom:1rem"><table class="data-table"><thead><tr>${columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(row[column] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>${preview.result.previewRows!.length > rows.length ? `<p class="help-text">Structured preview shows the first ${rows.length} records.</p>` : ""}`; })() : "";
  return `${pageHead("Export", "Review, then download", "Generated files remain in browser memory until you choose Download. Conversion warnings are shown before the file is created.")}
    ${adifTools}
    ${mappingCard}
    <div class="grid-2"><section class="card"><div class="card-head"><h3>Available outputs</h3></div><div class="card-body stack">
      <button class="btn dark" data-action="preview-export" data-export-type="${state.document.format === "adif" ? "adif" : state.document.format === "cabrillo" ? "cabrillo" : state.document.format === "edi" ? "edi" : "csv"}">Preview current ${state.document.format.toUpperCase()}</button>
      ${state.document.format === "adif" ? `<button class="btn" data-action="preview-export" data-export-type="adx">Create ADX XML</button>` : ""}
      ${opposite ? `<button class="btn" data-action="preview-export" data-export-type="${opposite}">Convert to ${opposite.toUpperCase()}</button>` : ""}
      ${state.document.format !== "text" ? `<label class="field"><span>CSV delimiter</span><select id="csv-delimiter" class="select"><option value="," ${state.csvDelimiter === "," ? "selected" : ""}>Comma</option><option value=";" ${state.csvDelimiter === ";" ? "selected" : ""}>Semicolon</option></select></label><button class="btn" data-action="preview-export" data-export-type="csv">Create CSV table</button>` : ""}
      <p class="help-text">Current source downloads as .${currentExtension}. Converted output is intentionally canonicalized and may be lossy; keep your original file.</p>
    </div></section><section class="card"><div class="card-head"><h3>Privacy</h3></div><div class="card-body"><div class="status-banner success"><span>✓</span><div><strong>Local export</strong><br />Log contents remain on this device. Google Analytics receives only general interface usage events, never filenames, callsigns, searches, exchanges, or uploaded text.</div></div></div></section></div>
    ${qslPrintingCard()}
    ${specialistToolsCard()}
    ${preview ? `<section class="card" style="margin-top:1rem"><div class="card-head"><h3>${preview.type.toUpperCase()} preview · ${preview.result.records} records</h3><button class="btn primary" data-action="download-preview">Download ${preview.type.toUpperCase()}</button></div><div class="card-body">${preview.result.warnings.map((warning) => `<div class="status-banner warning" style="margin-bottom:.7rem"><span>!</span><div>${escapeHtml(warning)}</div></div>`).join("")}${preview.result.lossReport?.length ? `<div class="status-banner warning" style="margin-bottom:.7rem"><span>!</span><div><strong>Fields requiring recovery or manual mapping</strong><ul>${preview.result.lossReport.map((loss) => `<li>${escapeHtml(loss)}</li>`).join("")}</ul></div></div>` : ""}${structuredPreview}<pre class="code-preview">${escapeHtml(preview.result.content.slice(0, 24_000))}${preview.result.content.length > 24_000 ? "\n… preview truncated …" : ""}</pre></div></section>` : ""}`;
}

function viewContent(): string {
  switch (state.view) {
    case "header": return headerView();
    case "qsos": return qsosView();
    case "problems": return problemsView();
    case "preflight": return preflightView();
    case "duplicates": return duplicateView();
    case "repair": return repairView();
    case "search": return searchView();
    case "convert": return convertView();
    case "score": return scoreView();
    case "statistics": return statisticsView();
    case "export": return exportView();
    default: return openView();
  }
}

function render(): void {
  app.innerHTML = shell(viewContent());
  if (state.selectedId && state.view === "qsos") {
    requestAnimationFrame(() => document.getElementById(`row-${state.selectedId}`)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  }
}

function toast(message: string): void {
  requestAnimationFrame(() => {
    const region = document.querySelector<HTMLElement>(".toast-region");
    if (!region) return;
    const item = document.createElement("div");
    item.className = "toast";
    item.textContent = message;
    region.append(item);
    window.setTimeout(() => item.remove(), 3500);
  });
}

function download(content: string, extension: string): void {
  const base = state.fileName.replace(/\.[^.]+$/, "") || "radio-log";
  downloadNamed(content, `${base}.${extension}`);
}

function downloadNamed(content: string, fileName: string): void {
  const extension = fileName.split(".").at(-1) ?? "txt";
  const suffix = extension.split(".").at(-1)?.toLowerCase();
  const mime = suffix === "csv" ? "text/csv;charset=utf-8" : suffix === "html" ? "text/html;charset=utf-8" : suffix === "svg" ? "image/svg+xml;charset=utf-8" : suffix === "adx" || suffix === "xml" ? "application/xml;charset=utf-8" : suffix === "json" ? "application/json;charset=utf-8" : "text/plain;charset=utf-8";
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
  trackEvent("file_download", { format: suffix || "text", document_format: state.document?.format ?? "none" });
}

async function openFile(file: File): Promise<void> {
  try {
    const decoded = decodeLogFile(await file.arrayBuffer());
    loadSource(decoded.text, file.name, decoded.encoding);
    trackEvent("file_open", { document_format: state.document?.format ?? "text", record_bucket: countBucket(qsoCount()), result: decoded.warning ? "warning" : "success", source_type: "local_file" });
    if (decoded.warning) toast(decoded.warning);
  } catch {
    trackEvent("file_open", { document_format: "unknown", result: "error", source_type: "local_file" });
    toast("The selected file could not be opened.");
  }
}

function undo(): void {
  if (state.view === "convert" && state.textTable && state.tableUndo.length) {
    state.tableRedo.push(state.textTable);
    state.textTable = state.tableUndo.pop()!;
    state.tablePreview = null;
    render();
    toast("Table change undone.");
    return;
  }
  if (!state.document || !state.undo.length) return;
  state.redo.push(sourceOf(state.document));
  const source = state.undo.pop()!;
  setDocument(parseSource(source), { history: false, toast: "Change undone." });
}

function redo(): void {
  if (state.view === "convert" && state.textTable && state.tableRedo.length) {
    state.tableUndo.push(state.textTable);
    state.textTable = state.tableRedo.pop()!;
    state.tablePreview = null;
    render();
    toast("Table change restored.");
    return;
  }
  if (!state.document || !state.redo.length) return;
  state.undo.push(sourceOf(state.document));
  const source = state.redo.pop()!;
  setDocument(parseSource(source), { history: false, toast: "Change restored." });
}

function currentTransformationSelection(): DocumentSelection {
  return state.selectedRows.length ? { kind: "rows", ids: state.selectedRows } : { kind: "document" };
}

function showTransformation(preview: TransformationPreview): void {
  state.transformation = preview;
  trackEvent("transformation_preview", { operation: preview.operationId, change_bucket: countBucket(preview.changes.length), document_format: preview.before.format, selection: state.selectedRows.length ? "selected_rows" : "document" });
  render();
  toast(preview.changes.length ? `${preview.changes.length} proposed change${preview.changes.length === 1 ? "" : "s"}.` : "This transformation would make no changes.");
}

function readSearchOptions(): SearchOptions {
  state.searchOptions = {
    query: document.querySelector<HTMLInputElement>("#search-query")?.value ?? state.searchOptions.query,
    matchCase: document.querySelector<HTMLInputElement>("#search-case")?.checked ?? false,
    wholeWord: document.querySelector<HTMLInputElement>("#search-word")?.checked ?? false,
    regularExpression: document.querySelector<HTMLInputElement>("#search-regex")?.checked ?? false,
    direction: document.querySelector<HTMLInputElement>("#search-backward")?.checked ? "backward" : "forward",
    wrap: document.querySelector<HTMLInputElement>("#search-wrap")?.checked ?? true,
  };
  state.searchReplacement = document.querySelector<HTMLInputElement>("#search-replacement")?.value ?? state.searchReplacement;
  return state.searchOptions;
}

function previewTableOperation(operation: string): void {
  const table = state.textTable;
  if (!table) return;
  const columns = state.selectedTableColumns;
  const rows = state.selectedTableRows;
  const selection = { rowIds: rows.length ? rows : undefined, columnIndexes: columns.length ? columns : undefined };
  const value = document.querySelector<HTMLInputElement>("#table-value")?.value ?? "";
  const find = document.querySelector<HTMLInputElement>("#table-find")?.value ?? "";
  const separator = document.querySelector<HTMLInputElement>("#table-separator")?.value ?? "";
  trackEvent("table_operation_preview", { operation, selection: rows.length || columns.length ? "selection" : "document", document_format: "text" });
  let preview: TablePreview | null = null;
  if (["replace", "trim", "trim-all", "remove-alpha", "remove-numeric", "remove-symbols", "remove-left", "remove-right", "fill", "empty"].includes(operation) && !columns.length) {
    toast("Select at least one table column first.");
    return;
  }
  switch (operation) {
    case "replace": preview = tableTransforms.replace(table, selection, find, value); break;
    case "trim": preview = tableTransforms.trim(table, selection); break;
    case "trim-all": preview = tableTransforms.trimAll(table, selection); break;
    case "remove-alpha": preview = tableTransforms.removeAlpha(table, selection); break;
    case "remove-numeric": preview = tableTransforms.removeNumeric(table, selection); break;
    case "remove-symbols": preview = tableTransforms.removeSymbols(table, selection); break;
    case "remove-left": preview = tableTransforms.removeLeft(table, selection); break;
    case "remove-right": preview = tableTransforms.removeRight(table, selection); break;
    case "fill": preview = tableTransforms.fill(table, selection, value); break;
    case "empty": preview = tableTransforms.empty(table, selection); break;
    case "serial": preview = addSerialColumn(table, columns[0] ?? -1); break;
    case "insert": preview = insertColumn(table, columns[0] ?? table.columns.length - 1); break;
    case "duplicate": preview = columns.length === 1 ? duplicateColumn(table, columns[0]!) : null; break;
    case "copy": if (columns.length === 1) { state.tableClipboard = copyColumn(table, columns[0]!); toast(`Copied column ${columns[0]! + 1}.`); return; } break;
    case "paste": preview = state.tableClipboard ? pasteColumn(table, columns[0] ?? table.columns.length - 1, state.tableClipboard) : null; break;
    case "move-column-left": preview = moveColumns(table, columns, "left"); break;
    case "move-column-right": preview = moveColumns(table, columns, "right"); break;
    case "split": preview = columns.length === 1 ? splitColumn(table, columns[0]!, separator) : null; break;
    case "join": preview = joinColumns(table, columns, false); break;
    case "combine": preview = joinColumns(table, columns, true); break;
    case "delete-columns": preview = deleteColumns(table, columns); break;
    case "keep-columns": preview = deleteColumns(table, columns, true); break;
    case "delete-rows": preview = rows.length ? deleteRows(table, rows) : null; break;
    case "shift-left": preview = rows.length ? shiftRows(table, rows, "left") : null; break;
    case "shift-right": preview = rows.length ? shiftRows(table, rows, "right") : null; break;
    case "align": preview = rows.length && columns.length ? alignRows(table, rows, columns) : null; break;
    case "move-up": preview = rows.length === 1 ? moveRow(table, rows[0]!, "up") : null; break;
    case "move-down": preview = rows.length === 1 ? moveRow(table, rows[0]!, "down") : null; break;
  }
  if (!preview) {
    toast(operation.includes("row") || operation.startsWith("shift") || operation === "align" ? "Select the required row and column range first." : operation === "paste" ? "Copy a column before pasting it." : "Select the required column or columns first.");
    return;
  }
  state.tablePreview = preview;
  render();
  toast(preview.changes.length ? `${preview.changes.length} table changes proposed.` : preview.warnings[0] ?? "No changes proposed.");
}

function addPaperQso(form: HTMLFormElement): void {
  if (state.document?.format !== "cabrillo") return;
  const data = new FormData(form);
  const columns = qsoColumns(state.document.layout);
  columns.forEach((cell, index) => { cell.value = String(data.get(`paper-cell-${index}`) ?? "").trim().toUpperCase(); });
  const issues = validatePaperQso(columns);
  if (issues.length) {
    showPaperValidation(form, issues.map((issue) => issue.message), true);
    form.querySelector<HTMLElement>(`[data-paper-index="${issues[0]!.index}"]`)?.focus();
    return;
  }
  const qso = { frequency: "", mode: "", date: "", time: "", cells: columns, call: "", myCall: "", sentRst: "", receivedRst: "", sentExchange: "", receivedExchange: "" };
  const qsoLine = formatQso(qso, state.document.layout);
  const lines = [...state.document.lines];
  const end = lines.findIndex((line) => line.key === "END-OF-LOG");
  lines.splice(end >= 0 ? end : lines.length, 0, { id: "", lineNumber: 0, raw: qsoLine, type: "qso" });
  const source = lines.map((line) => line.raw).join(state.document.newline) + state.document.newline;
  setDocument(parseCabrillo(source), { toast: "Paper QSO added." });
  state.paperOpen = true;
}

function fastEntryDocument(): AdifDocument | null {
  if (!state.fastEntry) return null;
  let documentValue = parseAdif(fastEntryToAdif(state.fastEntry));
  const profile = state.stationProfiles.find((item) => item.id === state.activeProfileId);
  if (profile) documentValue = applyStationProfile(documentValue, profile, undefined, "missing").document;
  return documentValue;
}

function showPaperValidation(form: HTMLFormElement, messages: readonly string[], invalid: boolean): void {
  const target = form.querySelector<HTMLElement>("#paper-validation");
  if (!target) return;
  target.className = `status-banner ${invalid ? "warning" : "success"}`;
  target.innerHTML = `<span>${invalid ? "!" : "✓"}</span><div>${messages.length ? `<ul>${messages.slice(0, 8).map((message) => `<li>${escapeHtml(message)}</li>`).join("")}</ul>` : "The QSO fields are valid and ready to add."}</div>`;
}

function validatePaperForm(form: HTMLFormElement): void {
  if (state.document?.format !== "cabrillo") return;
  const data = new FormData(form);
  const columns = qsoColumns(state.document.layout);
  columns.forEach((cell, index) => { cell.value = String(data.get(`paper-cell-${index}`) ?? "").trim().toUpperCase(); });
  const issues = validatePaperQso(columns);
  showPaperValidation(form, issues.map((issue) => issue.message), issues.length > 0);
}

function focusSourceRange(start: number, end: number): void {
  state.view = "open";
  render();
  requestAnimationFrame(() => {
    const editor = document.querySelector<HTMLTextAreaElement>("#raw-source");
    if (!editor) return;
    editor.focus();
    editor.setSelectionRange(start, end);
  });
}

function sourceOffsetAt(source: string, lineNumber: number, character: number): number {
  const starts = [0];
  const newline = /\r\n|\r|\n/g;
  while (true) {
    const match = newline.exec(source);
    if (!match) break;
    starts.push(match.index + match[0].length);
  }
  const line = Math.max(1, Math.min(starts.length, Math.round(lineNumber)));
  const start = starts[line - 1]!;
  const end = line < starts.length ? starts[line]! : source.length;
  return Math.min(end, start + Math.max(0, Math.round(character) - 1));
}

function navigateInvalid(direction: "forward" | "backward"): void {
  if (!state.diagnostics.length) return;
  state.invalidIndex = nextMatchIndex(state.diagnostics.map((_, index) => ({ start: index, end: index + 1, value: "", lineNumber: 0, column: 0 })), state.invalidIndex, direction, true);
  const item = state.diagnostics[state.invalidIndex];
  if (item?.lineId) { state.selectedId = item.lineId; state.view = "qsos"; render(); }
  else if (item?.lineNumber && state.document) {
    const source = sourceOf(state.document);
    const start = sourceOffsetAt(source, item.lineNumber, 1);
    focusSourceRange(start, start);
  }
}

app.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action], [data-view], [data-diagnostic-id], [data-preflight-diagnostic], [data-search-line], [data-search-offset], [data-table-operation], [data-analytics]");
  if (!target) return;
  const documentFormat = state.document?.format ?? "none";
  if (target.dataset.analytics) trackEvent("outbound_link", { action: target.dataset.analytics, view: state.view, document_format: documentFormat });
  if (target.dataset.action) trackEvent("ui_action", { action: target.dataset.action, view: state.view, document_format: documentFormat, format: target.dataset.exportType ?? "none" });
  const view = target.dataset.view as View | undefined;
  if (view) { trackEvent("workspace_view", { view, document_format: documentFormat }); state.view = view; render(); return; }
  if (target.dataset.diagnosticId) {
    trackEvent("diagnostic_open", { document_format: documentFormat, view: state.view });
    const item = state.diagnostics.find((candidate) => candidate.id === target.dataset.diagnosticId);
    if (item?.lineId) { state.selectedId = item.lineId; state.view = "qsos"; render(); }
    return;
  }
  if (target.dataset.preflightDiagnostic) {
    const item = state.preflight?.diagnostics.find((candidate) => candidate.id === target.dataset.preflightDiagnostic);
    if (item?.lineId) { state.selectedId = item.lineId; state.view = "qsos"; render(); }
    return;
  }
  if (target.dataset.searchLine) {
    trackEvent("search_result_open", { document_format: documentFormat, view: state.view });
    const line = Number(target.dataset.searchLine);
    state.view = "open";
    render();
    requestAnimationFrame(() => {
      const editor = document.querySelector<HTMLTextAreaElement>("#raw-source");
      if (!editor) return;
      const lines = editor.value.split(/\r\n|\r|\n/);
      const start = lines.slice(0, Math.max(0, line - 1)).reduce((sum, value) => sum + value.length + 1, 0);
      editor.focus();
      editor.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0));
    });
    return;
  }
  if (target.dataset.searchOffset !== undefined) {
    trackEvent("search_result_open", { document_format: documentFormat, view: state.view });
    const start = Number(target.dataset.searchOffset);
    const end = Number(target.dataset.searchEnd ?? start);
    state.searchIndex = state.searchMatches.findIndex((match) => match.start === start && match.end === end);
    focusSourceRange(start, end);
    return;
  }
  if (target.dataset.tableOperation) {
    previewTableOperation(target.dataset.tableOperation);
    return;
  }
  switch (target.dataset.action) {
    case "choose-file": document.querySelector<HTMLInputElement>("#file-input")?.click(); break;
    case "open-qsl-printing": openQslPrinting(); break;
    case "choose-callbook": document.querySelector<HTMLInputElement>("#callbook-input")?.click(); break;
    case "choose-cty": document.querySelector<HTMLInputElement>("#cty-input")?.click(); break;
    case "refresh-master": void refreshMasterOnline(); break;
    case "refresh-cty": void refreshCtyOnline(); break;
    case "refresh-reference-data": void refreshReferenceData(); break;
    case "clear-callbook":
      masterRequestVersion += 1;
      callbook.clear();
      state.callbookName = "";
      state.masterStatus = "idle";
      state.masterSource = "";
      state.masterUpdated = "";
      state.masterError = "";
      state.callbookQuery = "";
      state.callbookSuggestions = [];
      render(); toast("Local callsign assistance cleared from memory.");
      break;
    case "reset-cty":
      ctyRequestVersion += 1;
      geography.reset();
      state.ctyName = "Bundled recovered DXCC table";
      state.ctyStatus = "bundled";
      state.ctySource = "Bundled application data";
      state.ctyUpdated = "";
      state.ctyError = "";
      if (state.document?.format === "cabrillo") state.score = scoreWithOverrides(state.document, state.ruleId, state.scoreOverrides);
      render(); toast("Bundled offline DXCC table restored.");
      break;
    case "search-callbook": {
      state.callbookQuery = document.querySelector<HTMLInputElement>("#callbook-query")?.value ?? "";
      state.callbookSuggestions = callbook.suggestions(state.callbookQuery, 12);
      if (!state.callbookSuggestions.length) state.callbookSuggestions = callbook.correctionSuggestions(state.callbookQuery, 12);
      const geographyMatch = geography.lookup(state.callbookQuery);
      render();
      if (!state.callbookSuggestions.length && !geographyMatch) toast("No local MASTER or CTY match found.");
      break;
    }
    case "choose-adif-merge": document.querySelector<HTMLInputElement>("#adif-merge-input")?.click(); break;
    case "choose-duplicate-files": document.querySelector<HTMLInputElement>("#duplicate-compare-input")?.click(); break;
    case "import-profiles": document.querySelector<HTMLInputElement>("#profile-import-input")?.click(); break;
    case "export-profiles": downloadNamed(JSON.stringify({ version: 1, profiles: state.stationProfiles }, null, 2), "station-profiles.json"); break;
    case "duplicate-profile": {
      const profile = state.stationProfiles.find((item) => item.id === state.activeProfileId); if (!profile) break;
      const copy = { ...profile, id: crypto.randomUUID(), name: `${profile.name} copy` }; state.stationProfiles.push(copy); state.activeProfileId = copy.id; localStorage.setItem("log-workbench:station-profiles:v1", JSON.stringify({ version: 1, profiles: state.stationProfiles })); render(); break;
    }
    case "delete-profile": {
      const profile = state.stationProfiles.find((item) => item.id === state.activeProfileId); if (!profile || !window.confirm(`Delete station profile “${profile.name}”?`)) break;
      state.stationProfiles = state.stationProfiles.filter((item) => item.id !== profile.id); state.activeProfileId = ""; localStorage.setItem("log-workbench:station-profiles:v1", JSON.stringify({ version: 1, profiles: state.stationProfiles })); render(); toast("Station profile deleted from this browser."); break;
    }
    case "preview-apply-profile": if (state.document?.format === "adif") {
      const profile = state.stationProfiles.find((item) => item.id === state.activeProfileId); if (!profile) break;
      const mode = document.querySelector<HTMLSelectElement>("#profile-apply-mode")?.value === "replace" ? "replace" : "missing"; const from = document.querySelector<HTMLInputElement>("#profile-date-from")?.value.replaceAll("-", "") ?? ""; const to = document.querySelector<HTMLInputElement>("#profile-date-to")?.value.replaceAll("-", "") ?? ""; const rangeIds = state.document.records.filter((record) => { const date = adifValue(record, "QSO_DATE"); return (!from || date >= from) && (!to || date <= to); }).map((record) => record.id); const ids = state.selectedRows.length ? state.selectedRows : from || to ? rangeIds : undefined; const applied = applyStationProfile(state.document, profile, ids, mode);
      showTransformation({ operationId: "apply-station-profile", label: `Apply station profile ${profile.name}`, before: state.document, after: applied.document, changes: applied.changes.map((change) => ({ targetId: change.recordId, field: change.field, before: change.before, after: change.after, description: `${change.field}: ${change.before || "empty"} → ${change.after}` })), warnings: mode === "replace" ? ["Existing station fields will be replaced where the profile supplies a value."] : [], lossy: mode === "replace" && applied.changes.some((change) => change.before) }); break;
    }
    case "split-station": if (state.document?.format === "adif") { const criterion = (document.querySelector<HTMLSelectElement>("#profile-split-criterion")?.value ?? "station") as SplitCriterion; const groups = splitAdif(state.document, criterion); for (const [identity, part] of groups) downloadNamed(serializeAdifWithOptions(part), safeProfileFilename(`${criterion}-${identity}`)); toast(`${groups.size} ${criterion} file${groups.size === 1 ? "" : "s"} prepared locally.`); break; }
    case "run-preflight": if (state.document?.format === "adif") { state.preflight = runPreflight(state.document, state.preflightProfile, { qrzDateFrom: document.querySelector<HTMLInputElement>("#qrz-date-from")?.value, qrzDateTo: document.querySelector<HTMLInputElement>("#qrz-date-to")?.value }); trackEvent("preflight_complete", { profile: state.preflightProfile, result: state.preflight.rejected.length ? "blocked" : "ready", record_bucket: countBucket(state.document.records.length) }); render(); break; }
    case "preview-modernize-modes": if (state.document?.format === "adif") { const migrated = modernizeDeprecatedModes(state.document); showTransformation({ operationId: "modernize-adif-modes", label: "Modernize deprecated ADIF modes", before: state.document, after: migrated.document, changes: migrated.changes.map((change) => ({ targetId: change.recordId, field: "MODE", before: change.before, after: change.after, description: `${change.before} → ${change.after}` })), warnings: [], lossy: false }); break; }
    case "download-preflight-ready": if (state.document?.format === "adif" && state.preflight) downloadNamed(serializeAdifWithOptions(preflightSubset(state.document, state.preflight.ready)), "preflight-ready.adi"); break;
    case "download-preflight-rejected": if (state.document?.format === "adif" && state.preflight) downloadNamed(serializeAdifWithOptions(preflightSubset(state.document, state.preflight.rejected)), "preflight-rejected.adi"); break;
    case "download-preflight-report": if (state.preflight) downloadNamed(preflightReportHtml(state.preflight), "preflight-report.html"); break;
    case "scan-duplicates": if (state.document?.format === "adif") { state.duplicateTolerance = Math.max(0, Math.min(60, Number(document.querySelector<HTMLInputElement>("#duplicate-tolerance")?.value ?? 5))); state.duplicates = findDuplicateCandidates([state.document], state.duplicateTolerance); trackEvent("duplicate_scan", { result: state.duplicates.length ? "matches" : "none", record_bucket: countBucket(state.document.records.length) }); render(); break; }
    case "download-duplicate-report": downloadNamed(duplicateReportCsv(state.duplicates), "duplicate-review.csv"); break;
    case "resolve-duplicate": if (state.document?.format === "adif" && target.dataset.duplicateId) { const candidate = state.duplicates.find((item) => item.id === target.dataset.duplicateId); if (!candidate) break; const resolution = target.dataset.resolution as "keep-first" | "keep-last" | "keep-both" | "merge"; if (resolution === "keep-both") { state.duplicates = state.duplicates.filter((item) => item.id !== candidate.id); render(); break; } const choices: Record<string, "first" | "second"> = {}; document.querySelectorAll<HTMLSelectElement>(`[data-duplicate-choice="${candidate.id}"]`).forEach((select) => { if (select.dataset.duplicateField) choices[select.dataset.duplicateField] = select.value === "second" ? "second" : "first"; }); const after = resolveDuplicate(state.document, candidate, resolution, choices); showTransformation({ operationId: "resolve-duplicate", label: `${resolution.replaceAll("-", " ")} duplicate`, before: state.document, after, changes: [{ targetId: candidate.second.id, before: candidate.reason, after: resolution, description: `${resolution} ${adifValue(candidate.first, "CALL")}` }], warnings: resolution === "merge" && candidate.differingFields.length ? ["The displayed field choices control conflicting nonblank values; review this record-level preview before applying."] : [], lossy: resolution !== "merge" }); break; }
    case "preview-fast-entry": { const input = document.querySelector<HTMLTextAreaElement>("#fast-entry-source"); state.fastEntrySource = input?.value ?? state.fastEntrySource; const profile = state.stationProfiles.find((item) => item.id === state.activeProfileId); state.fastEntry = parseFastEntry(state.fastEntrySource, { stationProfile: profile?.name, serial: 1 }); localStorage.setItem("log-workbench:fast-entry-draft:v1", state.fastEntrySource); render(); break; }
    case "download-fast-source": downloadNamed(state.fastEntrySource, "field-transcription.txt"); break;
    case "download-fast": { const documentValue = fastEntryDocument(); if (!documentValue) break; const format = target.dataset.fastFormat; if (format === "adx") downloadNamed(serializeAdx(documentValue), "field-transcription.adx"); else if (format === "cabrillo") downloadNamed(adifToCabrillo(documentValue, state.stationCall || "N0CALL", state.document?.format === "cabrillo" ? state.document.contest : state.conversionContest).content, "field-transcription.log"); else if (format === "csv") downloadNamed(documentToCsv(documentValue).content, "field-transcription.csv"); else downloadNamed(serializeAdifWithOptions(documentValue), "field-transcription.adi"); break; }
    case "add-fast-entry": if (state.document?.format === "cabrillo" && state.fastEntry) { const adifDocument = fastEntryDocument()!; const converted = parseCabrillo(adifToCabrillo(adifDocument, state.stationCall || state.document.lines.find((line) => line.key === "CALLSIGN")?.value || "N0CALL", state.document.contest).content); const newRows = converted.lines.filter((line) => line.qso).map((line) => line.raw); const lines = state.document.lines.map((line) => line.raw); const end = state.document.lines.findIndex((line) => line.key === "END-OF-LOG"); lines.splice(end >= 0 ? end : lines.length, 0, ...newRows); setDocument(parseCabrillo(`${lines.join(state.document.newline)}${state.document.newline}`), { toast: `${newRows.length} valid transcribed QSO${newRows.length === 1 ? "" : "s"} added. Undo is available.` }); state.paperOpen = true; break; }
    case "reset-conversion-map": {
      if (target.dataset.mapDirection === "cabrillo-adif") state.cabrilloToAdifMap = {};
      else state.adifToCabrilloMap = {};
      state.conversion = null;
      persistSettings();
      render(); toast("Default conversion mappings restored.");
      break;
    }
    case "sample": loadSource(SAMPLE, "sample-cq-wpx.log", "UTF-8"); break;
    case "restore-draft": { const draft = loadDraft(); if (draft) loadSource(draft.source, draft.fileName, "Local draft"); break; }
    case "save-draft": if (state.document) { saveDraft({ fileName: state.fileName, source: sourceOf(state.document), savedAt: new Date().toISOString() }); toast("Draft saved in this browser."); } break;
    case "close-log": state.document = null; state.fileName = "No log open"; state.diagnostics = []; state.undo = []; state.redo = []; state.view = "open"; render(); break;
    case "undo": undo(); break;
    case "redo": redo(); break;
    case "apply-raw": { const raw = document.querySelector<HTMLTextAreaElement>("#raw-source"); if (raw) setDocument(parseSource(raw.value), { toast: "Source changes applied." }); break; }
    case "download-original": if (state.document) download(sourceOf(state.document), state.document.format === "adif" ? state.document.container : state.document.format === "cabrillo" ? "log" : state.document.format === "edi" ? "edi" : "txt"); break;
    case "toggle-nonprinting": state.showNonprinting = !state.showNonprinting; render(); break;
    case "goto-position": if (state.document) {
      const line = Number(document.querySelector<HTMLInputElement>("#goto-line")?.value ?? 1);
      const character = Number(document.querySelector<HTMLInputElement>("#goto-character")?.value ?? 1);
      const offset = sourceOffsetAt(sourceOf(state.document), line, character);
      const editor = document.querySelector<HTMLTextAreaElement>("#raw-source");
      editor?.focus(); editor?.setSelectionRange(offset, offset);
      break;
    }
    case "next-invalid": navigateInvalid("forward"); break;
    case "previous-invalid": navigateInvalid("backward"); break;
    case "save-header-template": if (state.document?.format === "cabrillo") {
      const name = document.querySelector<HTMLInputElement>("#header-template-name")?.value ?? "Station defaults";
      saveHeaderTemplate(extractHeaderTemplate(state.document, name));
      render(); toast(`Header template “${name}” saved locally.`);
      break;
    }
    case "load-header-template": if (state.document?.format === "cabrillo") {
      const name = document.querySelector<HTMLSelectElement>("#header-template-select")?.value ?? "";
      const template = loadHeaderTemplates().find((item) => item.name === name);
      if (template) setDocument(applyHeaderTemplate(state.document, template), { toast: `Header template “${name}” applied. Undo is available.` }); else toast("Choose a saved header template first.");
      break;
    }
    case "delete-header-template": {
      const name = document.querySelector<HTMLSelectElement>("#header-template-select")?.value ?? "";
      if (name) { deleteHeaderTemplate(name); render(); toast(`Header template “${name}” deleted from this browser.`); } else toast("Choose a saved header template first.");
      break;
    }
    case "preview-remove-header": if (state.document?.format === "cabrillo") {
      const after = removeCabrilloHeader(state.document);
      const changes = state.document.lines.filter((line) => line.type === "header" && line.key !== "END-OF-LOG").map((line) => ({ targetId: line.id, lineNumber: line.lineNumber, before: line.raw, after: "", description: "Remove Cabrillo header line" }));
      showTransformation({ operationId: "remove-header", label: "Remove Cabrillo header", before: state.document, after, changes, warnings: ["A minimal header can be added again from the Header screen or restored with Undo."], lossy: true });
      break;
    }
    case "add-minimal-header": if (state.document?.format === "cabrillo") setDocument(addMinimalCabrilloHeader(state.document, state.stationCall, state.conversionContest), { toast: "Minimal Cabrillo header added. Undo is available." }); break;
    case "toggle-paper": state.paperOpen = !state.paperOpen; render(); break;
    case "apply-repairs": if (state.document?.format === "cabrillo") { trackEvent("repair_apply", { document_format: "cabrillo", change_bucket: countBucket(state.repairs.length) }); setDocument(applyCabrilloRepairs(state.document, state.repairs), { toast: `${state.repairs.length} repairs applied. Undo is available.` }); } break;
    case "preview-time-shift": if (state.document?.format === "cabrillo") {
      const minutes = Number(document.querySelector<HTMLInputElement>("#transform-minutes")?.value ?? 0);
      showTransformation(createShiftQsoTimeCommand(minutes).execute(state.document, currentTransformationSelection()));
      break;
    }
    case "preview-sort": if (state.document?.format === "cabrillo") { showTransformation(sortQsoChronologicallyCommand.execute(state.document, currentTransformationSelection())); break; }
    case "preview-mode": if (state.document?.format === "cabrillo") {
      const from = document.querySelector<HTMLInputElement>("#transform-mode-from")?.value ?? "";
      const to = document.querySelector<HTMLInputElement>("#transform-mode-to")?.value ?? "";
      showTransformation(createConvertModeCommand(from, to, state.modeMappings).execute(state.document, currentTransformationSelection()));
      break;
    }
    case "save-mode-mapping": {
      const from = document.querySelector<HTMLInputElement>("#transform-mode-from")?.value.trim().toUpperCase() ?? "";
      const to = document.querySelector<HTMLInputElement>("#transform-mode-to")?.value.trim().toUpperCase() ?? "";
      if (!from || !to) { toast("Enter both mode values before saving a mapping."); break; }
      state.modeMappings = { ...state.modeMappings, [from]: to };
      persistSettings();
      render(); toast(`Mode mapping ${from} → ${to} saved locally.`);
      break;
    }
    case "preview-normalize-modes": if (state.document?.format === "cabrillo") {
      showTransformation(createNormalizeModesCommand(state.modeMappings).execute(state.document, currentTransformationSelection()));
      break;
    }
    case "preview-serial": if (state.document?.format === "cabrillo") {
      const field = document.querySelector<HTMLSelectElement>("#transform-serial-field")?.value ?? "STX";
      const width = Number(document.querySelector<HTMLInputElement>("#transform-serial-width")?.value ?? 3);
      showTransformation(createNormalizeSerialCommand(field, width).execute(state.document, currentTransformationSelection()));
      break;
    }
    case "preview-sequential-serial": if (state.document?.format === "cabrillo") {
      const field = document.querySelector<HTMLSelectElement>("#transform-serial-field")?.value ?? "STX";
      const width = Number(document.querySelector<HTMLInputElement>("#transform-serial-width")?.value ?? 3);
      const start = Number(document.querySelector<HTMLInputElement>("#transform-serial-start")?.value ?? 1);
      showTransformation(createSequentialSerialCommand(field, start, width).execute(state.document, currentTransformationSelection()));
      break;
    }
    case "preview-date-convert": if (state.document?.format === "cabrillo") {
      const from = document.querySelector<HTMLSelectElement>("#transform-date-from")?.value as Parameters<typeof createConvertDateCommand>[1];
      showTransformation(createConvertDateCommand("QSO_DATE", from).execute(state.document, currentTransformationSelection()));
      break;
    }
    case "preview-time-convert": if (state.document?.format === "cabrillo") {
      const from = document.querySelector<HTMLSelectElement>("#transform-time-from")?.value as Parameters<typeof createConvertTimeCommand>[1];
      const to = document.querySelector<HTMLSelectElement>("#transform-time-to")?.value as Parameters<typeof createConvertTimeCommand>[2];
      showTransformation(createConvertTimeCommand("TIME_ON", from, to).execute(state.document, currentTransformationSelection()));
      break;
    }
    case "preview-frequency-convert": if (state.document?.format === "cabrillo") {
      const field = document.querySelector<HTMLSelectElement>("#transform-frequency-field")?.value ?? "FREQUENCY";
      const direction = document.querySelector<HTMLSelectElement>("#transform-frequency-direction")?.value as Parameters<typeof createConvertFrequencyCommand>[1];
      showTransformation(createConvertFrequencyCommand(field, direction).execute(state.document, currentTransformationSelection()));
      break;
    }
    case "preview-unicode": if (state.document) { showTransformation(cleanUnsafeWhitespaceCommand.execute(state.document, { kind: "document" })); break; }
    case "preview-line-ending": if (state.document) {
      const value = target.dataset.newline;
      const newline = value === "crlf" ? "\r\n" : value === "cr" ? "\r" : "\n";
      showTransformation(createLineEndingCommand<LogDocument>(newline).execute(state.document, { kind: "document" }));
      break;
    }
    case "preview-footer": if (state.document?.format === "cabrillo") {
      showTransformation((target.dataset.footer === "remove" ? removeFooterCommand : addFooterCommand).execute(state.document, { kind: "document" }));
      break;
    }
    case "cancel-transformation": state.transformation = null; render(); break;
    case "apply-transformation": if (state.transformation) { trackEvent("transformation_apply", { operation: state.transformation.operationId, document_format: state.transformation.after.format, change_bucket: countBucket(state.transformation.changes.length) }); setDocument(state.transformation.after, { toast: `${state.transformation.changes.length} transformation change${state.transformation.changes.length === 1 ? "" : "s"} applied. Undo is available.` }); } break;
    case "find-all": if (state.document) {
      try { state.searchMatches = findAll(state.document, currentTransformationSelection(), readSearchOptions()); trackEvent("search_complete", { document_format: state.document.format, result: state.searchMatches.length ? "matches" : "no_matches", record_bucket: countBucket(state.searchMatches.length), selection: state.selectedRows.length ? "selected_rows" : "document" }); state.searchIndex = state.searchMatches.length ? 0 : -1; render(); }
      catch (error) { toast(error instanceof Error ? error.message : String(error)); }
      break;
    }
    case "find-next":
    case "find-previous": if (state.searchMatches.length) {
      state.searchIndex = nextMatchIndex(state.searchMatches, state.searchIndex, target.dataset.action === "find-previous" ? "backward" : "forward", state.searchOptions.wrap !== false);
      render();
      requestAnimationFrame(() => document.querySelector(".diagnostic.selected")?.scrollIntoView({ block: "center" }));
      break;
    }
    case "preview-replace-next": if (state.document && state.searchMatches.length) {
      try {
        const index = state.searchIndex >= 0 ? state.searchIndex : 0;
        showTransformation(replaceOne(state.document, state.searchMatches[index]!, readSearchOptions(), state.searchReplacement));
      } catch (error) { toast(error instanceof Error ? error.message : String(error)); }
      break;
    }
    case "preview-replace": if (state.document) {
      try { showTransformation(replaceAll(state.document, currentTransformationSelection(), readSearchOptions(), state.searchReplacement)); }
      catch (error) { toast(error instanceof Error ? error.message : String(error)); }
      break;
    }
    case "cancel-table-preview": state.tablePreview = null; render(); break;
    case "apply-table-preview": if (state.tablePreview && state.textTable) {
      trackEvent("table_operation_apply", { operation: state.tablePreview.label, document_format: "text", change_bucket: countBucket(state.tablePreview.changes.length) });
      state.tableUndo.push(state.textTable);
      state.tableRedo = [];
      const next = state.tablePreview.after;
      const source = serializeTextTable(next, next.delimiter);
      state.textTable = { ...next, source };
      state.document = { format: "text", source };
      state.tablePreview = null;
      state.selectedTableRows = [];
      state.selectedTableColumns = [];
      saveDraft({ fileName: state.fileName, source, savedAt: new Date().toISOString() });
      render();
      toast("Table transformation applied. Undo is available.");
      break;
    }
    case "preview-table-export": if (state.textTable) {
      const type = target.dataset.exportType as "adif" | "cabrillo" | "csv";
      const result = type === "adif" ? textTableToAdif(state.textTable) : type === "cabrillo" ? textTableToCabrillo(state.textTable, state.stationCall, state.conversionContest) : textTableToCsv(state.textTable);
      state.conversion = { type, result };
      state.view = "export";
      render();
      break;
    }
    case "preview-adif-filter": if (state.document?.format === "adif") {
      const list = (id: string) => (document.querySelector<HTMLInputElement>(id)?.value ?? "").split(/[,;\s]+/).filter(Boolean);
      const filter = {
        dateFrom: document.querySelector<HTMLInputElement>("#adif-date-from")?.value,
        dateTo: document.querySelector<HTMLInputElement>("#adif-date-to")?.value,
        callsign: document.querySelector<HTMLInputElement>("#adif-filter-call")?.value,
        bands: list("#adif-filter-band"), modes: list("#adif-filter-mode"), submodes: list("#adif-filter-submode"),
        cqZones: list("#adif-filter-zone"), operator: document.querySelector<HTMLInputElement>("#adif-filter-operator")?.value,
        qslStatus: list("#adif-filter-qsl"), continents: list("#adif-filter-continent"),
      };
      const retainedRecords = filterAdifRecords(state.document, filter);
      const filtered = filterAdif(state.document, filter);
      const retained = new Set(retainedRecords.map((record) => record.id));
      const changes = state.document.records.filter((record) => !retained.has(record.id)).map((record, index) => ({ targetId: record.id, lineNumber: index + 1, before: adifValue(record, "CALL") || record.original.slice(0, 40), after: "", description: "Filter out ADIF record" }));
      showTransformation({ operationId: "filter-adif", label: "Filter ADIF records", before: state.document, after: filtered, changes, warnings: [], lossy: changes.length > 0 });
      break;
    }
    case "apply-adif-merge": if (state.adifMerge) setDocument(state.adifMerge.document, { toast: `${state.adifMerge.document.records.length} merged ADIF records applied. Undo is available.` }); break;
    case "cancel-adif-merge": state.adifMerge = null; render(); break;
    case "download-callsigns": if (state.document?.format === "adif") download(`${extractAdifCallsigns(state.document).join("\n")}\n`, "txt"); break;
    case "calculate-score": if (state.document?.format === "cabrillo") { state.score = scoreWithOverrides(state.document, state.ruleId, state.scoreOverrides); trackEvent("score_recalculate", { document_format: "cabrillo", record_bucket: countBucket(state.score.qsos), result: "success" }); render(); toast("Score recalculated."); } break;
    case "calculate-edi-score": if (state.document?.format === "edi") { const score = calculateEdiScore(state.document, state.ediScoreFormula); trackEvent("score_recalculate", { document_format: "edi", record_bucket: countBucket(score.validQsos), result: "success" }); render(); toast("EDI score recalculated from the current records."); } break;
    case "update-edi-score": if (state.document?.format === "edi") {
      const score = calculateEdiScore(state.document, state.ediScoreFormula);
      setDocument(updateEdiScoreHeaders(state.document, score), { toast: `EDI score fields updated to ${score.total.toLocaleString()}. Undo is available.` });
      break;
    }
    case "rescan-score-row": if (state.document?.format === "cabrillo" && target.dataset.scoreId) {
      delete state.scoreOverrides[target.dataset.scoreId];
      state.score = scoreWithOverrides(state.document, state.ruleId, state.scoreOverrides);
      render(); toast("Scoring rule restored for this QSO.");
      break;
    }
    case "update-claimed-score": if (state.document?.format === "cabrillo" && state.score) setDocument(updateClaimedScore(state.document, state.score), { toast: `CLAIMED-SCORE updated to ${state.score.total}. Undo is available.` }); break;
    case "download-score-csv": if (state.score) download(scoreRowsToCsv(state.score), "score.csv"); break;
    case "preview-report": if (state.document?.format === "cabrillo" && state.score) download(scoringReportHtml(state.document, state.score), "report.html"); break;
    case "download-statistics-csv": if (state.document?.format === "cabrillo" && state.score) download(activityToCsv(activityBuckets(state.document, state.score.rows, state.statisticsInterval, { start: state.statisticsStart || undefined, end: state.statisticsEnd || undefined })), "activity.csv"); break;
    case "download-statistics-svg": if (state.document?.format === "cabrillo" && state.score) download(activityChartSvg(activityBuckets(state.document, state.score.rows, state.statisticsInterval, { start: state.statisticsStart || undefined, end: state.statisticsEnd || undefined }), `${state.document.contest} activity`), "activity.svg"); break;
    case "preview-export": {
      const type = target.dataset.exportType as "adif" | "adx" | "cabrillo" | "edi" | "csv";
      const result = buildConversion(type);
      if (result) { trackEvent("conversion_preview", { document_format: state.document?.format ?? "none", format: type, record_bucket: countBucket(result.records), result: result.warnings.length ? "warning" : "success" }); state.conversion = { type, result }; render(); }
      break;
    }
    case "download-preview": if (state.conversion) download(state.conversion.result.content, state.conversion.type === "adif" ? "adi" : state.conversion.type === "adx" ? "adx" : state.conversion.type === "cabrillo" ? "log" : state.conversion.type === "edi" ? "edi" : "csv"); break;
    case "clear-draft": clearDraft(); toast("Local draft removed."); break;
  }
});

app.addEventListener("change", async (event) => {
  const target = event.target as HTMLInputElement | HTMLSelectElement;
  const editedArea = target.dataset.headerKey || target.dataset.ediHeaderKey ? "header"
    : target.dataset.qsoId || target.dataset.qtcId || target.dataset.adifId || target.dataset.ediId ? "contact"
      : target.dataset.scoreId ? "score" : target.dataset.conversionMap || target.dataset.columnName !== undefined ? "mapping" : "settings";
  if (target.id !== "file-input" && target.id !== "callbook-input" && target.id !== "cty-input" && target.id !== "adif-merge-input") trackEvent("workspace_change", { area: editedArea, document_format: state.document?.format ?? "none", view: state.view });
  if (target.dataset.conversionMap && target.dataset.mapSource) {
    const source = target.dataset.mapSource.toUpperCase();
    if (target.dataset.conversionMap === "cabrillo-adif") state.cabrilloToAdifMap[source] = target.value.trim().toUpperCase();
    else state.adifToCabrilloMap[source] = target.value.trim().toUpperCase();
    state.conversion = null;
    persistSettings();
    render(); toast(`${source} conversion target updated.`);
    return;
  }
  if (target instanceof HTMLInputElement && target.dataset.selectQso) {
    state.selectedRows = target.checked
      ? [...new Set([...state.selectedRows, target.dataset.selectQso])]
      : state.selectedRows.filter((id) => id !== target.dataset.selectQso);
  }
  if (target instanceof HTMLInputElement && target.dataset.tableColumn) {
    const index = Number(target.dataset.tableColumn);
    state.selectedTableColumns = target.checked ? [...new Set([...state.selectedTableColumns, index])].sort((a, b) => a - b) : state.selectedTableColumns.filter((item) => item !== index);
  }
  if (target instanceof HTMLInputElement && target.dataset.tableRow) {
    const id = target.dataset.tableRow;
    state.selectedTableRows = target.checked ? [...new Set([...state.selectedTableRows, id])] : state.selectedTableRows.filter((item) => item !== id);
  }
  if (target instanceof HTMLInputElement && target.dataset.columnName !== undefined && state.textTable) {
    const index = Number(target.dataset.columnName);
    const preview = renameColumn(state.textTable, index, target.value);
    if (preview.changes.length) {
      state.tableUndo.push(state.textTable);
      state.tableRedo = [];
      state.textTable = { ...preview.after, source: state.textTable.source };
      render();
      toast(`Column ${index + 1} mapped to ${state.textTable.columns[index]?.name}.`);
    }
  }
  if (target instanceof HTMLInputElement && target.dataset.tableCellRow && target.dataset.tableCellColumn !== undefined && state.textTable) {
    const rowIndex = state.textTable.rows.findIndex((row) => row.id === target.dataset.tableCellRow);
    const columnIndex = Number(target.dataset.tableCellColumn);
    if (rowIndex >= 0 && state.textTable.rows[rowIndex]?.cells[columnIndex] !== target.value) {
      state.tableUndo.push(state.textTable);
      state.tableRedo = [];
      const next: TableDocument = { ...state.textTable, columns: state.textTable.columns.map((column) => ({ ...column })), rows: state.textTable.rows.map((row) => ({ ...row, cells: [...row.cells] })) };
      next.rows[rowIndex]!.cells[columnIndex] = target.value;
      next.source = serializeTextTable(next, next.delimiter);
      state.textTable = next;
      state.document = { format: "text", source: next.source };
      render();
    }
  }
  if (target.id === "file-input" && target instanceof HTMLInputElement && target.files?.[0]) await openFile(target.files[0]);
  if (target.id === "auto-import-adif" && target instanceof HTMLInputElement) {
    state.autoImportAdif = target.checked;
    localStorage.setItem("log-workbench:auto-import-adif:v1", String(target.checked));
    trackEvent("online_adif_import_setting", { enabled: target.checked });
    toast(target.checked ? "Trusted online ADIF handoff enabled." : "Online ADIF handoff disabled.");
  }
  if (target.id === "profile-import-input" && target instanceof HTMLInputElement && target.files?.[0]) { try { const store = parseProfileStore(await target.files[0].text()); state.stationProfiles = store.profiles; state.activeProfileId = store.profiles[0]?.id ?? ""; localStorage.setItem("log-workbench:station-profiles:v1", JSON.stringify(store)); render(); toast(`${store.profiles.length} station profile${store.profiles.length === 1 ? "" : "s"} imported locally.`); } catch (error) { toast(error instanceof Error ? error.message : String(error)); } }
  if (target.id === "callbook-input" && target instanceof HTMLInputElement && target.files?.[0]) {
    masterRequestVersion += 1;
    const file = target.files[0];
    const count = callbook.loadBuffer(await file.arrayBuffer());
    if (!count) {
      trackEvent("local_reference_file", { area: "master", result: "error" });
      toast("No valid callsigns were found; the existing local callbook was kept.");
    } else {
      state.callbookName = file.name;
      state.masterStatus = "local";
      state.masterSource = file.name;
      state.masterUpdated = new Date(file.lastModified || Date.now()).toISOString();
      state.masterError = "";
      state.callbookQuery = "";
      state.callbookSuggestions = [];
      if (state.document) state.diagnostics = diagnosticsFor(state.document);
      trackEvent("local_reference_file", { area: "master", result: "success", record_bucket: countBucket(count) });
      render(); toast(`${count.toLocaleString()} local callsigns loaded.`);
    }
  }
  if (target.id === "cty-input" && target instanceof HTMLInputElement && target.files?.[0]) {
    ctyRequestVersion += 1;
    const file = target.files[0];
    try {
      const count = geography.loadCty(await file.text());
      state.ctyName = file.name;
      state.ctyStatus = "local";
      state.ctySource = file.name;
      state.ctyUpdated = new Date(file.lastModified || Date.now()).toISOString();
      state.ctyError = "";
      if (state.document?.format === "cabrillo") state.score = scoreWithOverrides(state.document, state.ruleId, state.scoreOverrides);
      trackEvent("local_reference_file", { area: "cty", result: "success", record_bucket: countBucket(count) });
      render(); toast(`${count.toLocaleString()} local CTY prefixes loaded.`);
    } catch (error) {
      trackEvent("local_reference_file", { area: "cty", result: "error" });
      toast(error instanceof Error ? error.message : String(error));
    }
  }
  if (target.id === "adif-merge-input" && target instanceof HTMLInputElement && target.files?.length && state.document?.format === "adif") {
    const files = [...target.files];
    const documents = await Promise.all(files.map(async (file) => parseAdif(await file.text())));
    const strategy = document.querySelector<HTMLSelectElement>("#adif-merge-strategy")?.value as "keep-first" | "keep-last" | "keep-all" | undefined;
    state.adifMerge = { ...mergeAdif([state.document, ...documents], strategy ?? "keep-first"), fileNames: files.map((file) => file.name) };
    trackEvent("adif_merge_preview", { document_format: "adif", record_bucket: countBucket(state.adifMerge.document.records.length), result: state.adifMerge.duplicates.length ? "duplicates" : "success" });
    render();
    toast(`${files.length} ADIF file${files.length === 1 ? "" : "s"} prepared for merge.`);
  }
  if (target.id === "duplicate-compare-input" && target instanceof HTMLInputElement && target.files?.length && state.document?.format === "adif") {
    const files = [...target.files]; const documents = await Promise.all(files.map(async (file) => { const source = await file.text(); return file.name.toLowerCase().endsWith(".adx") || /<(?:[\w.-]+:)?ADX\b/i.test(source) ? parseAdx(source) : parseAdif(source); })); const combined = mergeAdif([state.document, ...documents], "keep-all").document; const added = combined.records.length - state.document.records.length;
    showTransformation({ operationId: "load-duplicate-comparison", label: `Add ${files.length} comparison file${files.length === 1 ? "" : "s"}`, before: state.document, after: combined, changes: [{ targetId: "comparison-files", before: `${state.document.records.length} current records`, after: `${combined.records.length} combined records`, description: `${added} records will be added for duplicate review` }], warnings: ["Applying adds the comparison records to this local working document. Resolve candidates afterward or Undo to restore the original."], lossy: false });
  }
  if (target.dataset.headerKey && state.document?.format === "cabrillo") setDocument(updateHeader(state.document, target.dataset.headerKey, target.value), { toast: `${target.dataset.headerKey} updated.` });
  if (target.dataset.ediHeaderKey && state.document?.format === "edi") setDocument(updateEdiHeader(state.document, target.dataset.ediHeaderKey, target.value), { toast: `${target.dataset.ediHeaderKey} updated.` });
  if (target.dataset.qsoId && target.dataset.qsoField && state.document?.format === "cabrillo") setDocument(updateQsoCell(state.document, target.dataset.qsoId, target.dataset.qsoField, target.value.toUpperCase()));
  if (target.dataset.qtcId && target.dataset.qtcField && state.document?.format === "cabrillo") setDocument(updateQtcCell(state.document, target.dataset.qtcId, target.dataset.qtcField, target.value.toUpperCase()));
  if (target.dataset.adifId && target.dataset.adifField && state.document?.format === "adif") setDocument(updateAdifTag(state.document, target.dataset.adifId, target.dataset.adifField, target.value));
  if (target.dataset.ediId && target.dataset.ediField && state.document?.format === "edi") setDocument(updateEdiRecord(state.document, target.dataset.ediId, target.dataset.ediField as typeof EDI_QSO_FIELDS[number], target.value.toUpperCase()));
  if (target.dataset.scoreId && target.dataset.scoreField && state.document?.format === "cabrillo") {
    const current = state.scoreOverrides[target.dataset.scoreId] ?? {};
    state.scoreOverrides[target.dataset.scoreId] = target.dataset.scoreField === "points" ? { ...current, points: Number(target.value) } : { ...current, multiplier: target.value };
    state.score = scoreWithOverrides(state.document, state.ruleId, state.scoreOverrides);
    render();
  }
  if (target.id === "score-rule") { state.ruleId = target.value; state.scoreOverrides = {}; if (state.document?.format === "cabrillo") state.score = scoreWithOverrides(state.document, state.ruleId, state.scoreOverrides); render(); }
  if (target.id === "edi-score-formula") { state.ediScoreFormula = target.value as EdiScoreFormula | "auto"; render(); }
  if (target.id === "station-call") state.stationCall = target.value.toUpperCase();
  if (target.id === "station-profile-select") { state.activeProfileId = target.value; render(); }
  if (target.id === "preflight-profile") { state.preflightProfile = target.value as PreflightProfileId; state.preflight = null; trackEvent("preflight_profile_select", { profile: state.preflightProfile }); render(); }
  if (target.id === "conversion-contest") { state.conversionContest = target.value.toUpperCase(); state.conversion = null; render(); }
  if (target.id === "adif-lowercase" && target instanceof HTMLInputElement) state.adifOptions.tagCase = target.checked ? "lower" : "upper";
  if (target.id === "adif-types" && target instanceof HTMLInputElement) state.adifOptions.includeTypes = target.checked;
  if (target.id === "adif-comma" && target instanceof HTMLInputElement) state.adifOptions.decimalSeparator = target.checked ? "," : ".";
  if (target.id === "csv-delimiter") state.csvDelimiter = target.value === ";" ? ";" : ",";
  if (target.id === "statistics-start") { state.statisticsStart = target.value; render(); }
  if (target.id === "statistics-end") { state.statisticsEnd = target.value; render(); }
  if (target.id === "statistics-interval") { state.statisticsInterval = Number(target.value); render(); }
});

app.addEventListener("submit", (event) => {
  const form = event.target as HTMLFormElement;
  const formId = form.getAttribute("id");
  if (formId === "paper-form") { event.preventDefault(); trackEvent("manual_qso_submit", { document_format: "cabrillo", view: state.view }); addPaperQso(form); }
  if (formId === "station-profile-form") { event.preventDefault(); const data = new FormData(form); const name = String(data.get("name") ?? "").trim(); if (!name) { toast("Profile name is required."); return; } const id = String(data.get("profileId") || crypto.randomUUID()); const profile: StationProfile = { id, name }; for (const key of ["stationCallsign", "operator", "ownerCallsign", "dxcc", "country", "grid", "latitude", "longitude", "cqZone", "ituZone", "state", "county", "iota", "pota", "sota", "wwff", "band", "frequency", "mode", "propMode", "satellite", "notes"] as const) { const value = String(data.get(key) ?? "").trim(); if (value) profile[key] = value; } const index = state.stationProfiles.findIndex((item) => item.id === id); if (index >= 0) state.stationProfiles[index] = profile; else state.stationProfiles.push(profile); state.activeProfileId = id; localStorage.setItem("log-workbench:station-profiles:v1", JSON.stringify({ version: 1, profiles: state.stationProfiles })); trackEvent("station_profile_save", { result: index >= 0 ? "updated" : "created" }); render(); const warnings = validateStationProfile(profile); toast(warnings.length ? `Profile saved with ${warnings.length} warning${warnings.length === 1 ? "" : "s"} to review.` : "Station profile saved locally."); }
});

app.addEventListener("input", (event) => {
  const target = event.target as HTMLElement;
  if (target.id === "fast-entry-source" && target instanceof HTMLTextAreaElement) { state.fastEntrySource = target.value; localStorage.setItem("log-workbench:fast-entry-draft:v1", target.value); }
  const form = target.closest<HTMLFormElement>("#paper-form");
  if (form && (target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) validatePaperForm(form);
});

app.addEventListener("dragover", (event) => { event.preventDefault(); document.querySelector("[data-drop-zone]")?.classList.add("dragging"); });
app.addEventListener("dragleave", () => document.querySelector("[data-drop-zone]")?.classList.remove("dragging"));
app.addEventListener("drop", (event) => {
  event.preventDefault();
  document.querySelector("[data-drop-zone]")?.classList.remove("dragging");
  const file = event.dataTransfer?.files[0];
  if (file) void openFile(file);
});

window.addEventListener("message", (event) => {
  if (!state.autoImportAdif || !isTrustedLogTransferOrigin(event.origin, window.location.origin)) return;
  const expectedSource = event.source === window.opener || event.source === window.parent || (event.source === window && event.origin === window.location.origin);
  if (!expectedSource) return;
  const payload = parseLogTransferPayload(event.data);
  if (!payload) return;
  try {
    const parsed = parseAdif(payload.content);
    if (!parsed.records.length) throw new Error("No ADIF records were found.");
    loadSource(payload.content, payload.name, "Browser handoff");
    trackEvent("file_open", { document_format: "adif", record_bucket: countBucket(parsed.records.length), result: "success", source_type: "browser_handoff" });
    event.source?.postMessage({ type: LOG_TRANSFER_ACK_TYPE, name: payload.name }, { targetOrigin: event.origin });
  } catch {
    trackEvent("file_open", { document_format: "adif", result: "error", source_type: "browser_handoff" });
    toast("The online ADIF handoff could not be opened.");
  }
});

window.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "o") { event.preventDefault(); document.querySelector<HTMLInputElement>("#file-input")?.click(); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && !event.shiftKey) { event.preventDefault(); undo(); }
  if (((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") || ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "z")) { event.preventDefault(); redo(); }
  if (event.key === "F2" && state.diagnostics.length) { event.preventDefault(); const next = state.diagnostics.findIndex((item) => item.lineId === state.selectedId) + 1; const item = state.diagnostics[next % state.diagnostics.length]; if (item?.lineId) { state.selectedId = item.lineId; state.view = "qsos"; render(); } }
});

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js"));
}

render();
void refreshReferenceData(false);
