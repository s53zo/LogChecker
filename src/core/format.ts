import type { LogFormat } from "./types";

export function detectFormat(source: string, fileName = ""): LogFormat {
  const sample = source.slice(0, 32_000);
  const extension = fileName.toLowerCase().split(".").pop();
  if (/^\s*START-OF-LOG\s*:/im.test(sample) || /^\s*(?:QSO|X-QSO):/im.test(sample)) {
    return "cabrillo";
  }
  if (/<(?:ADIF_VER|EOH|CALL|QSO_DATE|EOR)(?::|>)/i.test(sample)) return "adif";
  if (extension === "adi" || extension === "adif") return "adif";
  if (extension === "cbr" || extension === "cab" || extension === "log") return "cabrillo";
  return "text";
}

export function decodeLogFile(buffer: ArrayBuffer): { text: string; encoding: string; warning?: string } {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder("utf-8").decode(bytes.slice(3)), encoding: "UTF-8 BOM" };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder("utf-16le").decode(bytes.slice(2)), encoding: "UTF-16 LE" };
  }
  const utf8 = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const replacementRatio = [...utf8].filter((char) => char === "�").length / Math.max(utf8.length, 1);
  if (replacementRatio < 0.001) return { text: utf8, encoding: "UTF-8" };
  return {
    text: new TextDecoder("windows-1252").decode(bytes),
    encoding: "Windows-1252",
    warning: "The file was not valid UTF-8 and was decoded as Windows-1252.",
  };
}
