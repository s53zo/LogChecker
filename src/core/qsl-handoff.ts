import { adifValue } from "./adif";
import type { AdifDocument, AdifRecord } from "./types";

export const QSL_LABEL_TOOL_URL = "https://s53zo.github.io/ADIF-to-QSL-label/make_qsl_labels.html";
export const QSL_LABEL_TOOL_ORIGIN = "https://s53zo.github.io";
export const LOG_TRANSFER_TYPE = "sh6_log";
export const LOG_TRANSFER_ACK_TYPE = "sh6_log_received";
export const MAX_TRANSFER_BYTES = 50 * 1024 * 1024;

export interface LogTransferPayload {
  type: typeof LOG_TRANSFER_TYPE;
  name: string;
  content: string;
}

export interface QslReadinessIssue {
  recordId: string;
  recordNumber: number;
  fields: string[];
}

export interface QslReadiness {
  total: number;
  ready: number;
  blocked: QslReadinessIssue[];
  alreadySent: number;
}

const requiredValue = (record: AdifRecord, fields: readonly string[]): boolean =>
  fields.some((field) => Boolean(adifValue(record, field).trim()));

export function qslReadiness(document: AdifDocument): QslReadiness {
  const blocked: QslReadinessIssue[] = [];
  let alreadySent = 0;
  document.records.forEach((record, index) => {
    const missing: string[] = [];
    if (!requiredValue(record, ["CALL"])) missing.push("CALL");
    if (!requiredValue(record, ["QSO_DATE"])) missing.push("QSO_DATE");
    if (!requiredValue(record, ["TIME_ON", "TIME_OFF"])) missing.push("TIME_ON or TIME_OFF");
    if (!requiredValue(record, ["BAND", "FREQ"])) missing.push("BAND or FREQ");
    if (!requiredValue(record, ["MODE"])) missing.push("MODE");
    if (missing.length) blocked.push({ recordId: record.id, recordNumber: index + 1, fields: missing });
    if (["Y", "Q"].includes(adifValue(record, "QSL_SENT").trim().toUpperCase())) alreadySent += 1;
  });
  return { total: document.records.length, ready: document.records.length - blocked.length, blocked, alreadySent };
}

export function safeTransferFilename(input: string): string {
  const stem = (input || "radio-log").replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "").slice(0, 96);
  return `${stem || "radio-log"}.adi`;
}

export function isTrustedLogTransferOrigin(origin: string, currentOrigin: string): boolean {
  if (origin === QSL_LABEL_TOOL_ORIGIN || origin === currentOrigin) return true;
  try {
    const url = new URL(origin);
    const current = new URL(currentOrigin);
    const local = (value: URL) => value.hostname === "127.0.0.1" || value.hostname === "localhost";
    return local(url) && local(current) && (url.protocol === "http:" || url.protocol === "https:");
  } catch {
    return false;
  }
}

export function parseLogTransferPayload(data: unknown): LogTransferPayload | null {
  if (!data || typeof data !== "object") return null;
  const value = data as Partial<LogTransferPayload>;
  if (value.type !== LOG_TRANSFER_TYPE || typeof value.content !== "string" || !value.content.trim()) return null;
  if (new TextEncoder().encode(value.content).byteLength > MAX_TRANSFER_BYTES) return null;
  if (!/<(?:EOR|EOH)(?:\s*\/?)>/i.test(value.content)) return null;
  return { type: LOG_TRANSFER_TYPE, name: safeTransferFilename(typeof value.name === "string" ? value.name : "online-log.adi"), content: value.content };
}
