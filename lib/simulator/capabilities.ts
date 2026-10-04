import { BOARD_IDS, BOARD_PROFILES } from "../circuit/boards.ts";
import { DEVICE_APIS, DEVICE_CONSTANTS } from "./device-api.ts";

/** Browser runtime adapters available to sketch validation and code generation. */
const libraries = {
  "Arduino.h": { methods: [] },
  "Servo.h": { className: "Servo", methods: ["attach", "write", "read"] },
  "LiquidCrystal.h": { className: "LiquidCrystal", methods: ["begin", "clear", "setCursor", "print", "println"] },
} as const;

const coreFunctions = {
  pinMode: [2, 2], digitalWrite: [2, 2], analogWrite: [2, 2], digitalRead: [1, 1], analogRead: [1, 1],
  millis: [0, 0], delay: [1, 1], delayMicroseconds: [1, 1], pulseIn: [2, 3], map: [5, 5], constrain: [3, 3], min: [2, 2], max: [2, 2],
  tone: [2, 3], noTone: [1, 1], shiftOut: [4, 4], SPISettings: [3, 3], isnan: [1, 1], sizeof: [1, 1], makeKeymap: [1, 1],
} as const;

const libraryMethodSignatures = {
  Servo: { attach: [1, 1], write: [1, 1], read: [0, 0] },
  LiquidCrystal: { begin: [2, 2], clear: [0, 0], setCursor: [2, 2], print: [1, 2], println: [1, 2] },
} as const;

const constructorSignatures: Readonly<Record<string, readonly [number, number]>> = {
  Servo: [0, 0], LiquidCrystal: [6, 6], SoftwareSerial: [2, 2], WiFiUDP: [0, 0],
  Adafruit_BME280: [0, 0], Adafruit_BMP280: [0, 0], Adafruit_SHT31: [0, 0], DHT: [2, 2],
  OneWire: [1, 1], DallasTemperature: [1, 1], Adafruit_MPU6050: [0, 0], BH1750: [0, 0],
  Adafruit_SSD1306: [2, 4], Adafruit_NeoPixel: [3, 3], Encoder: [2, 2], Keypad: [5, 5],
  Adafruit_MCP23X17: [0, 0], TCA9548: [1, 1], MFRC522: [2, 2], XBee: [0, 0],
  XBeeAddress64: [2, 2], ZBTxRequest: [3, 4], ZBTxStatusResponse: [0, 0], ZBRxResponse: [0, 0],
  XBeeResponse: [0, 0], SPISettings: [3, 3], bq769x0: [2, 2],
};

const builtinSingletons = {
  Serial: { header: "Arduino.h", methods: { begin: [1, 1], available: [0, 0], read: [0, 0], flush: [0, 0], print: [1, 2], println: [0, 2], write: [1, 2] } },
} as const;

/**
 * The shared capability registry is the source used by Gemini guidance,
 * structured-program validation, and the simulator's library-call validator.
 * Entries describe browser adapters, not installed native C++ libraries.
 */
export const SIMULATOR_CAPABILITY_REGISTRY = Object.freeze({
  boards: BOARD_PROFILES,
  boardIds: BOARD_IDS,
  deviceApis: DEVICE_APIS,
  constants: DEVICE_CONSTANTS,
  libraries,
  libraryMethodSignatures,
  constructorSignatures,
  builtinSingletons,
  coreFunctions,
  coreCalls: Object.keys(coreFunctions),
  coreTypes: ["void", "int", "long", "short", "byte", "uint8_t", "uint16_t", "uint32_t", "uint64_t", "size_t", "bool", "float", "double", "char", "DeviceAddress", "sensors_event_t"],
  extraHeaders: ["Adafruit_Sensor.h"],
});

export type SimulatorCapabilityRegistry = typeof SIMULATOR_CAPABILITY_REGISTRY;
