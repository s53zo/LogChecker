import { recoveredData } from "../data/contests.generated";
import type { ContestLayout } from "./types";

export const contestNames = [...recoveredData.checkerContests];
export const calculatorContests = new Set<string>(recoveredData.calculatorContests);
export const scoringModuleNames = [...recoveredData.scoringModules];
export const headerTags = [...recoveredData.headerTags];
export const categories = [...recoveredData.categories];
export const adifFields = [...recoveredData.adifFields];
export const bands = [...recoveredData.bands];

const layoutMap = new Map<string, ContestLayout>(
  recoveredData.layouts.map((layout) => [layout.name, layout as ContestLayout]),
);

const waedcFields = [
  { key: "MY_CALL", width: 13, description: "Station callsign" },
  { key: "RST_SENT", width: 3, description: "RS/RST sent" },
  { key: "STX_STRING", width: 6, description: "Progressive serial sent" },
  { key: "CALL", width: 13, description: "Worked callsign" },
  { key: "RST_RCVD", width: 3, description: "RS/RST received" },
  { key: "SRX_STRING", width: 6, description: "Progressive serial received" },
  { key: "TRANSMITTER_ID", width: 1, description: "Optional transmitter ID" },
] as const;

for (const name of ["DARC-WAEDC-CW", "DARC-WAEDC-SSB", "DARC-WAEDC-RTTY"]) {
  layoutMap.set(name, {
    name,
    lineLength: 81,
    minimumLength: 79,
    separators: [4, 10, 13, 24, 29, 43, 47, 54, 68, 72, 79],
    fields: waedcFields,
    menuLabels: ["Sent serial", "Received serial"],
    calculatorColumns: ["RST", "Sent", "Callsign", "RST", "Received"],
    maxPoints: null,
  });
}

export function getContestLayout(name: string): ContestLayout | undefined {
  const normalized = name.trim().toUpperCase();
  return layoutMap.get(normalized) ??
    (normalized.endsWith("-CW") || normalized.endsWith("-SSB") || normalized.endsWith("-RTTY")
      ? layoutMap.get(normalized.replace(/-(?:CW|SSB|RTTY)$/, ""))
      : undefined);
}

export const cabrilloModeMap: Record<string, string> = {
  ...recoveredData.cabrilloModes,
  CW: "CW",
  SSB: "PH",
  USB: "PH",
  LSB: "PH",
  FM: "FM",
  AM: "AM",
  RTTY: "RY",
  FT4: "DG",
  FT8: "DG",
};

export const deprecatedModeMap: Record<string, string> = {
  ...recoveredData.deprecatedModes,
};
