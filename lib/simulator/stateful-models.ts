/** Runtime-backed model registrations; each published entry has simulator acceptance coverage. */
export const STATEFUL_MODEL_REGISTRY: Readonly<Record<string, string>> = Object.freeze({
  "bme280-runtime": "bme280", "bmp280-runtime": "bmp280", "sht31-runtime": "sht31-dis",
  "dht22-runtime": "dht22", "ds18b20-runtime": "ds18b20", "mpu6050-runtime": "mpu-6050",
  "74hc595-runtime": "74hc595", "mcp23017-runtime": "mcp23017", "tca9548a-runtime": "tca9548a",
  "rfm95w-runtime": "rfm95w", "xbee-runtime": "xbee-s2c-zigbee-th", "bq27441-runtime": "bq27441-g1",
  "bq76920-runtime": "bq76920", "bq24074-runtime": "bq24074",
});
export const STATEFUL_MODEL_TYPES = Object.freeze(Object.values(STATEFUL_MODEL_REGISTRY));
