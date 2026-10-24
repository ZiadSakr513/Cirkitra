/** DC circuit primitives solved by PowerRuntime, outside the normalized GPIO network. */
export const POWER_MODEL_REGISTRY: Readonly<Record<string, string>> = Object.freeze({
  "dc-supply-runtime": "dc-supply", "battery-cell-runtime": "battery-cell",
  "dc-load-runtime": "dc-load", "ideal-mosfet-runtime": "ideal-mosfet", "battery-9v-runtime": "battery-9v",
});
