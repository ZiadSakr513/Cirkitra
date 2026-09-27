/** Duplicate package pads connected internally; external pin IDs remain stable. */
export const POWER_TERMINAL_GROUPS: Readonly<Record<string, readonly (readonly string[])[]>> = {
  bq24074: [["BAT_2", "BAT_3"], ["OUT_10", "OUT_11"]],
};
