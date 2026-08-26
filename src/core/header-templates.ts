import { parseCabrillo, serializeCabrillo, updateHeader } from "./cabrillo";
import type { CabrilloDocument } from "./types";

export interface CabrilloHeaderTemplate {
  name: string;
  fields: Array<{ key: string; value: string }>;
}

export function extractHeaderTemplate(document: CabrilloDocument, name: string): CabrilloHeaderTemplate {
  return {
    name: name.trim() || "Header template",
    fields: document.lines
      .filter((line) => line.type === "header" && line.key && line.key !== "END-OF-LOG")
      .map((line) => ({ key: line.key!, value: line.value ?? "" })),
  };
}

export function applyHeaderTemplate(document: CabrilloDocument, template: CabrilloHeaderTemplate): CabrilloDocument {
  let result = document;
  for (const field of template.fields) result = updateHeader(result, field.key, field.value);
  return result;
}

export function removeCabrilloHeader(document: CabrilloDocument): CabrilloDocument {
  const lines = document.lines.filter((line) => line.type !== "header" || line.key === "END-OF-LOG");
  const source = lines.map((line) => line.raw).join(document.newline) + (document.trailingNewline ? document.newline : "");
  return parseCabrillo(source);
}

export function addMinimalCabrilloHeader(document: CabrilloDocument, stationCall = "N0CALL", contest = "GENERIC-CONTEST"): CabrilloDocument {
  if (document.lines.some((line) => line.key === "START-OF-LOG")) return document;
  const header = [`START-OF-LOG: 3.0`, `CALLSIGN: ${stationCall || "N0CALL"}`, `CONTEST: ${contest || "GENERIC-CONTEST"}`, "CREATED-BY: Contest Log Workbench"];
  const body = serializeCabrillo(document).replace(/^(?:\r\n|\r|\n)+/, "");
  return parseCabrillo(`${header.join(document.newline)}${document.newline}${body}`);
}

const STORAGE_KEY = "contest-log-workbench:header-templates:v1";

export function loadHeaderTemplates(): CabrilloHeaderTemplate[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is CabrilloHeaderTemplate => Boolean(item && typeof item.name === "string" && Array.isArray(item.fields))) : [];
  } catch {
    return [];
  }
}

export function saveHeaderTemplate(template: CabrilloHeaderTemplate): void {
  const templates = loadHeaderTemplates().filter((item) => item.name !== template.name);
  templates.push(template);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
}

export function deleteHeaderTemplate(name: string): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(loadHeaderTemplates().filter((item) => item.name !== name)));
}

