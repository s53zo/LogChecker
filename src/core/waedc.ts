import type { GeographyMatch } from "./geography";

// Current DARC WAE entities plus recovered historical aliases used by legacy
// logs. WAEDC contest geography is not identical to raw continent codes.
export const WAEDC_EUROPEAN_ENTITIES = new Set(
  "1A 3A 4O 4U1I 4U1V 9A 9H C3 CT CU DL E7 EA EA6 EI ER ES EU F G GD GI GJ GM GU GW HA HB HB0 HV I IS IT9 JW JX LA LX LY LZ OE OH OH0 OJ0 OK OM ON OY OZ PA R1F RA RA1 RA2 S5 SM SP SV SV5 SV9 T7 TA1 TF TK UR YL YO YU Z3 Z6 ZA ZB Z7 T9 R1M YU8".split(" "),
);

export function isWaedcEuropean(match: GeographyMatch | null): boolean {
  return !!match && WAEDC_EUROPEAN_ENTITIES.has(match.primaryPrefix);
}
