import { bandFromFrequency } from "./radio";

export const ADIF_CURRENT_VERSION = "3.1.7";

export type AdifDataType = "S" | "N" | "D" | "T" | "B" | "E" | "M" | "G";

export interface AdifFieldRule {
  type: AdifDataType;
  values?: readonly string[];
  minimum?: number;
  maximum?: number;
  deprecated?: boolean;
}

const modes = ["AM", "ARDOP", "ATV", "CHIP", "CLO", "CONTESTI", "CW", "DIGITALVOICE", "DOMINO", "DYNAMIC", "FAX", "FM", "FSK441", "FT8", "HELL", "ISCAT", "JT4", "JT6M", "JT9", "JT44", "JT65", "MFSK", "MSK144", "MT63", "OLIVIA", "OPERA", "PAC", "PAX", "PKT", "PSK", "PSK2K", "Q15", "QRA64", "ROS", "RTTY", "RTTYM", "SSB", "SSTV", "T10", "THOR", "THRB", "TOR", "V4", "VOI", "WINMOR", "WSPR"] as const;
const bands = ["2190M", "630M", "560M", "160M", "80M", "60M", "40M", "30M", "20M", "17M", "15M", "12M", "10M", "8M", "6M", "5M", "4M", "2M", "1.25M", "70CM", "33CM", "23CM", "13CM", "9CM", "6CM", "3CM", "1.25CM", "6MM", "4MM", "2.5MM", "2MM", "1MM", "SUBMM"] as const;
const statuses = ["Y", "N", "R", "I", "V"] as const;

export const ADIF_FIELD_RULES: Readonly<Record<string, AdifFieldRule>> = {
  ADIF_VER: { type: "S" }, PROGRAMID: { type: "S" }, PROGRAMVERSION: { type: "S" },
  CALL: { type: "S" }, STATION_CALLSIGN: { type: "S" }, OPERATOR: { type: "S" }, OWNER_CALLSIGN: { type: "S" },
  QSO_DATE: { type: "D" }, QSO_DATE_OFF: { type: "D" }, TIME_ON: { type: "T" }, TIME_OFF: { type: "T" },
  BAND: { type: "E", values: bands }, BAND_RX: { type: "E", values: bands }, FREQ: { type: "N", minimum: 0 }, FREQ_RX: { type: "N", minimum: 0 },
  MODE: { type: "E", values: modes }, SUBMODE: { type: "S" }, PROP_MODE: { type: "S" }, SAT_NAME: { type: "S" },
  RST_SENT: { type: "S" }, RST_RCVD: { type: "S" }, STX: { type: "N" }, SRX: { type: "N" }, STX_STRING: { type: "S" }, SRX_STRING: { type: "S" },
  GRIDSQUARE: { type: "G" }, MY_GRIDSQUARE: { type: "G" }, MY_VUCC_GRIDS: { type: "S" },
  LAT: { type: "S" }, LON: { type: "S" }, MY_LAT: { type: "S" }, MY_LON: { type: "S" },
  CQZ: { type: "N", minimum: 1, maximum: 40 }, ITUZ: { type: "N", minimum: 1, maximum: 90 }, MY_CQ_ZONE: { type: "N", minimum: 1, maximum: 40 }, MY_ITU_ZONE: { type: "N", minimum: 1, maximum: 90 },
  DXCC: { type: "N", minimum: 1 }, MY_DXCC: { type: "N", minimum: 1 }, CONT: { type: "E", values: ["AF", "AN", "AS", "EU", "NA", "OC", "SA"] },
  STATE: { type: "S" }, MY_STATE: { type: "S" }, CNTY: { type: "S" }, MY_CNTY: { type: "S" }, COUNTRY: { type: "S" }, MY_COUNTRY: { type: "S" },
  IOTA: { type: "S" }, MY_IOTA: { type: "S" }, SIG: { type: "S" }, SIG_INFO: { type: "S" }, MY_SIG: { type: "S" }, MY_SIG_INFO: { type: "S" },
  QSL_SENT: { type: "E", values: statuses }, QSL_RCVD: { type: "E", values: statuses }, LOTW_QSL_SENT: { type: "E", values: statuses }, LOTW_QSL_RCVD: { type: "E", values: statuses },
  EQSL_QSL_SENT: { type: "E", values: statuses }, EQSL_QSL_RCVD: { type: "E", values: statuses }, CLUBLOG_QSO_UPLOAD_STATUS: { type: "E", values: ["Y", "N", "M"] }, QRZCOM_QSO_UPLOAD_STATUS: { type: "E", values: ["Y", "N", "M"] },
  COMMENT: { type: "S" }, NOTES: { type: "M" }, NAME: { type: "S" }, ADDRESS: { type: "M" },
};

export const DEPRECATED_MODE_MAP: Readonly<Record<string, { mode: string; submode?: string }>> = {
  PSK31: { mode: "PSK", submode: "PSK31" }, PSK63: { mode: "PSK", submode: "PSK63" }, JT65: { mode: "MFSK", submode: "JT65" }, FT8: { mode: "MFSK", submode: "FT8" },
};

export function validAdifDate(value: string): boolean {
  if (!/^\d{8}$/.test(value)) return false;
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === iso;
}

export function validAdifTime(value: string): boolean {
  return /^(?:[01]\d|2[0-3])[0-5]\d(?:[0-5]\d)?$/.test(value);
}

export function validGrid(value: string): boolean {
  return /^(?:[A-R]{2}\d{2}(?:[A-X]{2}(?:\d{2})?)?)(?:,[A-R]{2}\d{2}(?:[A-X]{2}(?:\d{2})?)?)*$/i.test(value.trim());
}

export function normalizedBand(value: string): string {
  return value.trim().toUpperCase();
}

export function frequencyBand(value: string): string {
  if (!value.trim()) return "";
  const mhz = Number(value.replace(",", "."));
  return Number.isFinite(mhz) ? bandFromFrequency(String(mhz * 1000)).toUpperCase() : "";
}
