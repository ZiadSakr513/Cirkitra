/** Explicit browser adapters. These describe implemented calls, not installed C++. */
export interface DeviceApi {
  header: string;
  type: string;
  component?: string;
  singleton?: string;
  methods: Readonly<Record<string, readonly [number, number]>>;
}
const calls = (zero: string, one = "", two = ""): DeviceApi["methods"] => Object.fromEntries([
  ...zero.split(" ").filter(Boolean).map(name => [name, [0, 0]]),
  ...one.split(" ").filter(Boolean).map(name => [name, [1, 1]]),
  ...two.split(" ").filter(Boolean).map(name => [name, [2, 2]]),
]);
export const DEVICE_APIS: readonly DeviceApi[] = [
  { header: "Wire.h", type: "TwoWire", singleton: "Wire", methods: { ...calls("begin endTransmission available read", "beginTransmission write", "requestFrom"), write: [1, 2], endTransmission: [0, 1], requestFrom: [2, 3] } },
  { header: "SPI.h", type: "SPIClass", singleton: "SPI", methods: calls("begin end endTransaction", "transfer beginTransaction") },
  { header: "SoftwareSerial.h", type: "SoftwareSerial", methods: calls("available read", "begin write print println") },
  { header: "Adafruit_BME280.h", type: "Adafruit_BME280", component: "bme280", methods: { ...calls("readTemperature readPressure readHumidity takeForcedMeasurement sensorID"), begin: [0, 2], setSampling: [0, 6] } },
  { header: "Adafruit_BMP280.h", type: "Adafruit_BMP280", component: "bmp280", methods: { ...calls("readTemperature readPressure takeForcedMeasurement sensorID"), begin: [0, 2], setSampling: [0, 5] } },
  { header: "Adafruit_SHT31.h", type: "Adafruit_SHT31", component: "sht31-dis", methods: { ...calls("readTemperature readHumidity reset isHeaterEnabled readStatus", "heater"), begin: [0, 1] } },
  { header: "DHT.h", type: "DHT", component: "dht22", methods: { begin: [0, 1], readTemperature: [0, 2], readHumidity: [0, 1], read: [0, 1] } },
  { header: "OneWire.h", type: "OneWire", component: "ds18b20", methods: { ...calls("reset read reset_search", "select search", "write"), write: [1, 2], skip: [0, 0] } },
  { header: "DallasTemperature.h", type: "DallasTemperature", component: "ds18b20", methods: { ...calls("begin getDeviceCount requestTemperatures", "getTempCByIndex getTempC setWaitForConversion", "getAddress"), setResolution: [1, 2], getResolution: [0, 1], requestTemperaturesByAddress: [1, 1] } },
  { header: "Adafruit_MPU6050.h", type: "Adafruit_MPU6050", component: "mpu-6050", methods: { ...calls("getAccelerometerRange getGyroRange getFilterBandwidth", "setAccelerometerRange setGyroRange setFilterBandwidth enableSleep enableCycle enableDataReadyInterrupt"), begin: [0, 3], getEvent: [3, 3] } },
  { header: "Adafruit_MCP23X17.h", type: "Adafruit_MCP23X17", component: "mcp23017", methods: { ...calls("readGPIOAB getLastInterruptPin getCapturedInterrupt"), begin_I2C: [0, 2], pinMode: [2, 2], digitalWrite: [2, 2], digitalRead: [1, 1], writeGPIOAB: [1, 1], setupInterrupts: [3, 3], setupInterruptPin: [2, 2], clearInterrupts: [0, 0] } },
  { header: "TCA9548.h", type: "TCA9548", component: "tca9548a", methods: { ...calls("begin getChannelMask closeAll isConnected", "setChannelMask selectChannel enableChannel disableChannel isEnabled"), reset: [0, 0] } },
  { header: "LoRa.h", type: "LoRaClass", singleton: "LoRa", component: "rfm95w", methods: { ...calls("end endPacket available read peek idle sleep packetRssi packetSnr", "begin setFrequency setSpreadingFactor setSignalBandwidth setCodingRate4 setSyncWord setTxPower write print println"), write: [1, 2], endPacket: [0, 1], setPins: [1, 3], beginPacket: [0, 1], parsePacket: [0, 1], receive: [0, 1], enableCrc: [0, 0], disableCrc: [0, 0] } },
  { header: "XBee.h", type: "XBee", component: "xbee-s2c-zigbee-th", methods: { setSerial: [1, 1], begin: [1, 1], send: [1, 1], readPacket: [0, 1], getResponse: [0, 0] } },
  { header: "XBee.h", type: "XBeeAddress64", methods: calls("getMsb getLsb", "setMsb setLsb") },
  { header: "XBee.h", type: "ZBTxRequest", methods: calls("getFrameId", "setFrameId setAddress64 setPayload setPayloadLength") },
  { header: "XBee.h", type: "ZBTxStatusResponse", methods: calls("getFrameId getDeliveryStatus getDiscoveryStatus getTxRetryCount getRemoteAddress") },
  { header: "XBee.h", type: "ZBRxResponse", methods: { ...calls("getDataLength getOption getRemoteAddress16", "getData"), getRemoteAddress64: [0, 0] } },
  { header: "XBee.h", type: "XBeeResponse", methods: calls("isAvailable isError getApiId getErrorCode", "getZBTxStatusResponse getZBRxResponse") },
  { header: "SparkFunBQ27441.h", type: "BQ27441", singleton: "lipo", component: "bq27441-g1", methods: { ...calls("begin voltage flags status deviceType", "setCapacity"), current: [0, 1], capacity: [0, 1], soc: [0, 1], temperature: [0, 1], enterConfig: [0, 1], exitConfig: [0, 1] } },
  { header: "bq769x0.h", type: "bq769x0", component: "bq76920", methods: { ...calls("update checkStatus getBatteryVoltage getBatteryCurrent enableCharging enableDischarging disableCharging disableDischarging", "getCellVoltage setShuntResistorValue setBalancingThresholds enableAutoBalancing", "setCellUndervoltageProtection setCellOvervoltageProtection setShortCircuitProtection setOvercurrentDischargeProtection"), getTemperatureDegC: [0, 1], getTemperatureDegF: [0, 1], begin: [1, 2], setTemperatureLimits: [4, 4], setBalancingThresholds: [0, 3], enableAutoBalancing: [0, 0] } },
];
export interface DeviceInstance { name: string; api: DeviceApi; args: string[] }
export function splitDeviceArguments(text: string): string[] {
  const out: string[] = []; let start = 0; let depth = 0; let quote = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = ""; }
    else if (c === '"' || c === "'") quote = c;
    else if ("([{⟨".includes(c)) depth++;
    else if (")] }⟩".replace(" ", "").includes(c)) depth--;
    else if (c === "," && depth === 0) { out.push(text.slice(start, i).trim()); start = i + 1; }
  }
  if (text.slice(start).trim()) out.push(text.slice(start).trim());
  return out;
}
export function deviceInstances(source: string): Map<string, DeviceInstance> {
  const instances = new Map<string, DeviceInstance>();
  for (const api of DEVICE_APIS) {
    if (api.singleton) instances.set(api.singleton, { name: api.singleton, api, args: [] });
    for (const match of source.matchAll(new RegExp(`\\b${api.type}\\s+([A-Za-z_]\\w*)\\s*(?:=\\s*${api.type}\\s*)?(?:\\(([^;]*?)\\))?\\s*;`, "g"))) {
      instances.set(match[1], { name: match[1], api, args: splitDeviceArguments(match[2] ?? "") });
    }
  }
  const responseApi = DEVICE_APIS.find(api => api.type === "XBeeResponse")!;
  for (const instance of [...instances.values()]) if (instance.api.type === "XBee") instances.set(`${instance.name}__response`, { name: `${instance.name}__response`, api: responseApi, args: [] });
  return instances;
}
export const DEVICE_CONSTANTS: Record<string, number> = {
  DHT22: 22, INPUT: 0, OUTPUT: 1, INPUT_PULLUP: 2, MSBFIRST: 1, LSBFIRST: 0, SPI_MODE0: 0,
  MPU6050_RANGE_2_G: 0, MPU6050_RANGE_4_G: 1, MPU6050_RANGE_8_G: 2, MPU6050_RANGE_16_G: 3,
  MPU6050_RANGE_250_DEG: 0, MPU6050_RANGE_500_DEG: 1, MPU6050_RANGE_1000_DEG: 2, MPU6050_RANGE_2000_DEG: 3,
  ZB_TX_STATUS_RESPONSE: 0x8b, ZB_RX_RESPONSE: 0x90, SUCCESS: 0,
  REMAIN: 0, FULL: 1, AVAIL: 2, AVAIL_FULL: 3, REMAIN_F: 4, REMAIN_UF: 5, FULL_F: 6, FULL_UF: 7, DESIGN: 8, FILTERED: 0, UNFILTERED: 1, BATTERY: 0, INTERNAL_TEMP: 1,
  bq76920: 1, AVG: 0, STBY: 1, MAX: 2, CHANGE: 1, FALLING: 2, RISING: 3,
};
