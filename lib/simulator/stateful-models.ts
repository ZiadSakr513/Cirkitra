import { SCREENSHOT_COMPONENTS } from "../circuit/screenshot-components.ts";

/** Runtime-backed model registrations; each published entry has simulator acceptance coverage. */
const EXISTING_STATEFUL_MODELS: Readonly<Record<string, string>> = {
  "bme280-runtime": "bme280", "bmp280-runtime": "bmp280", "sht31-runtime": "sht31-dis",
  "dht22-runtime": "dht22", "ds18b20-runtime": "ds18b20", "mpu6050-runtime": "mpu-6050",
  "74hc595-runtime": "74hc595", "mcp23017-runtime": "mcp23017", "tca9548a-runtime": "tca9548a",
  "rfm95w-runtime": "rfm95w", "xbee-runtime": "xbee-s2c-zigbee-th", "bq27441-runtime": "bq27441-g1",
  "bq76920-runtime": "bq76920", "bq24074-runtime": "bq24074",
  "bh1750-sen0097-runtime": "bh1750-sen0097",
  "ssd1306-oled-runtime": "ssd1306-oled-128x64",
  "ws2812b-strip-8-runtime": "ws2812b-strip-8",
  "ky-040-runtime": "ky-040",
  "keypad-4x4-runtime": "keypad-4x4",
  "relay-module-1ch-runtime": "relay-module-1ch-active-low",
  "ds3231-rtc-runtime": "ds3231-rtc",
  "sn74ahct1g125-runtime": "sn74ahct1g125",
  "micro-sd-spi-runtime": "micro-sd-spi-module",
  "mfrc522-rfid-runtime": "mfrc522-rfid-module",
  "a4988-stepper-runtime": "a4988-stepper-driver",
  "bipolar-stepper-runtime": "bipolar-stepper-motor",
};
const SCREENSHOT_STATEFUL_MODELS = Object.fromEntries(Object.values(SCREENSHOT_COMPONENTS)
  .filter(part => part.id !== "battery-9v")
  .map(part => [part.simulation!.model!, part.id]));
export const STATEFUL_MODEL_REGISTRY: Readonly<Record<string, string>> = Object.freeze({
  ...EXISTING_STATEFUL_MODELS,
  ...SCREENSHOT_STATEFUL_MODELS,
});
export const STATEFUL_MODEL_TYPES = Object.freeze(Object.values(STATEFUL_MODEL_REGISTRY));
