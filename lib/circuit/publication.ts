import type { ComponentDefinition } from "./catalog.ts";
import { ELECTRICAL_MODELS } from "../simulator/models.ts";
import { COMPONENT_EXAMPLES } from "./component-examples.ts";
import { STATEFUL_MODEL_REGISTRY } from "../simulator/stateful-models.ts";
import { POWER_MODEL_REGISTRY } from "../simulator/power-models.ts";
import { BOARD_PROFILE_MODEL_REGISTRY } from "./boards.ts";

/** Each named fixture must be executed by publication.test.ts, not merely documented. */
export const COMPONENT_ACCEPTANCE: Readonly<Record<string, string>> = {
  "arduino-mega-2560": "board-profile-gpio-blink", "arduino-nano-classic": "board-profile-gpio-blink",
  "esp32-devkitc-v4": "board-profile-gpio-blink", "esp8266-nodemcu-v1": "board-profile-gpio-blink",
  "raspberry-pi-pico": "board-profile-gpio-blink",
  cd74hc4067: "mux-switches-reading", cd74hc4051: "mux-switches-reading", "74hc138": "decoder-switches-led",
  tb6612fng: "independent-opposite-motors", drv8833: "independent-opposite-motors", l298: "independent-opposite-motors",
  bme280: "wired-temperature-pressure-humidity", bmp280: "wired-temperature-pressure", "sht31-dis": "timed-temperature-humidity",
  ds18b20: "onewire-conversion-readback",
  dht22: "dht-timed-sampling",
  "hc-sr04": "hc-sr04-trigger-echo-distance",
  "mpu-6050": "imu-structured-live-readings",
  "soil-moisture-sen0193": "soil-probe-changes-board-adc",
  "bh1750-sen0097": "bh1750-reports-wired-lux",
  "ssd1306-oled-128x64": "ssd1306-sketch-updates-screen-buffer",
  "ws2812b-strip-8": "ws2812b-individual-pixels-update-on-show",
  sn74ahct1g125: "level-shifter-translates-esp32-to-5v-ws2812b",
  "ky-040": "ky040-encoder-and-button-follow-live-inputs",
  "keypad-4x4": "keypad-row-column-and-key-input-follow-sketch",
  "relay-module-1ch-active-low": "relay-active-low-switches-wired-contact-load",
  "ds3231-rtc": "ds3231-wire-registers-follow-simulated-time",
  "micro-sd-spi-module": "sd-library-stores-and-reads-card-file",
  "mfrc522-rfid-module": "wired-mfrc522-reads-interactive-tag-uid",
  "a4988-stepper-driver": "a4988-step-pulses-drive-wired-stepper",
  "bipolar-stepper-motor": "a4988-step-pulses-drive-wired-stepper",
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
  const registeredBoard = model ? BOARD_PROFILE_MODEL_REGISTRY[model] : undefined;
  if (!model || (!ELECTRICAL_MODELS[model] && !STATEFUL_MODEL_REGISTRY[model] && !POWER_MODEL_REGISTRY[model] && !registeredBoard)) issues.push("No registered simulation model.");
  if (registeredBoard && registeredBoard !== definition.id) issues.push("Registered board profile targets a different component.");
  if (model && (STATEFUL_MODEL_REGISTRY[model] ?? POWER_MODEL_REGISTRY[model]) !== undefined && (STATEFUL_MODEL_REGISTRY[model] ?? POWER_MODEL_REGISTRY[model]) !== definition.id) issues.push("Registered device model targets a different component.");
  if (!COMPONENT_EXAMPLES[definition.id]) issues.push("No runnable example.");
  if (!COMPONENT_ACCEPTANCE[definition.id]) issues.push("No acceptance fixture.");
  return issues;
}
