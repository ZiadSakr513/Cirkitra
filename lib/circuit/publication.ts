import type { ComponentDefinition } from "./catalog.ts";
import { ELECTRICAL_MODELS } from "../simulator/models.ts";
import { COMPONENT_EXAMPLES } from "./component-examples.ts";
import { STATEFUL_MODEL_REGISTRY } from "../simulator/stateful-models.ts";
import { POWER_MODEL_REGISTRY } from "../simulator/power-models.ts";

/** Each named fixture must be executed by publication.test.ts, not merely documented. */
export const COMPONENT_ACCEPTANCE: Readonly<Record<string, string>> = {
  cd74hc4067: "mux-switches-reading", cd74hc4051: "mux-switches-reading", "74hc138": "decoder-switches-led",
  tb6612fng: "independent-opposite-motors", drv8833: "independent-opposite-motors", l298: "independent-opposite-motors",
  bme280: "wired-temperature-pressure-humidity", bmp280: "wired-temperature-pressure", "sht31-dis": "timed-temperature-humidity",
  ds18b20: "onewire-conversion-readback",
  dht22: "dht-timed-sampling",
  "mpu-6050": "imu-structured-live-readings",
  tca9548a: "isolated-mux-channel-reaches-device",
  mcp23017: "gpio-expander-switches-wired-led",
  "74hc595": "shift-register-clock-and-latch-drive-led",
  rfm95w: "wired-lora-peer-send-and-receive",
  "xbee-s2c-zigbee-th": "wired-zigbee-peer-send-and-receive",
  "bq27441-g1": "wired-fuel-gauge-reports-discharging-cell",
  bq24074: "wired-charger-charges-and-protects-battery", bq76920: "wired-three-cell-monitor-controls-discharge",
  "dc-supply": "wired-supply-powers-switched-load", "battery-cell": "wired-cell-supplies-load",
  "dc-load": "wired-load-draws-current", "ideal-mosfet": "wired-gate-switches-load",
};
export function publicationIssues(definition: ComponentDefinition): string[] {
  const issues: string[] = [];
  if (!definition.simulated || definition.simulation?.capability !== "simulated") issues.push("Simulation is unfinished.");
  const model = definition.simulation?.model;
  if (!model || (!ELECTRICAL_MODELS[model] && !STATEFUL_MODEL_REGISTRY[model] && !POWER_MODEL_REGISTRY[model])) issues.push("No registered simulation model.");
  if (model && (STATEFUL_MODEL_REGISTRY[model] ?? POWER_MODEL_REGISTRY[model]) !== undefined && (STATEFUL_MODEL_REGISTRY[model] ?? POWER_MODEL_REGISTRY[model]) !== definition.id) issues.push("Registered device model targets a different component.");
  if (!COMPONENT_EXAMPLES[definition.id]) issues.push("No runnable example.");
  if (!COMPONENT_ACCEPTANCE[definition.id]) issues.push("No acceptance fixture.");
  return issues;
}
