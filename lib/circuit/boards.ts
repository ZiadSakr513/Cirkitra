import type { ComponentDefinition, ComponentPinDefinition, ComponentPropertyDefinition, PinSignal } from "./catalog.ts";

export interface BoardIoPin {
  id: string;
  label: string;
  runtimePin: number;
  analog?: boolean;
  pwm?: boolean;
  inputOnly?: boolean;
  analogOnly?: boolean;
  reserved?: boolean;
  onboard?: boolean;
  aliases?: readonly string[];
  signals?: readonly PinSignal[];
}

export interface BoardProfile {
  id: string;
  displayName: string;
  manufacturer: string;
  variant: string;
  mcu: string;
  logicVoltage: number;
  analogResolutionBits: number;
  analogReferenceVolts: number;
  runtimePinCount: number;
  ioPins: readonly BoardIoPin[];
  pwmPins: readonly number[];
  analogPins: readonly number[];
  constants: Readonly<Record<string, number>>;
  reservedPins: readonly number[];
  rails: Readonly<Record<string, number>>;
  groundPins: readonly string[];
  i2c: readonly { sda: number; scl: number }[];
  spi: readonly { mosi: number; miso: number; sck: number; ss: number }[];
  uart: readonly { rx: number; tx: number }[];
  builtinLed?: number;
  documentation: string;
}

const unoDigital = Array.from({ length: 14 }, (_, pin): BoardIoPin => ({
  id: `D${pin}`,
  label: pin === 0 ? "D0 / RX" : pin === 1 ? "D1 / TX" : `D${pin}${[3, 5, 6, 9, 10, 11].includes(pin) ? " ~" : ""}`,
  runtimePin: pin,
  pwm: [3, 5, 6, 9, 10, 11].includes(pin),
  signals: ["digital", ...(pin === 0 || pin === 1 ? ["uart" as const] : []), ...([3, 5, 6, 9, 10, 11].includes(pin) ? ["pwm" as const] : [])],
}));
const unoAnalog = Array.from({ length: 6 }, (_, index): BoardIoPin => ({
  id: `A${index}`,
  label: index === 4 ? "A4 / SDA" : index === 5 ? "A5 / SCL" : `A${index}`,
  runtimePin: index + 14,
  analog: true,
  signals: ["analog", "digital", ...(index === 4 || index === 5 ? ["i2c" as const] : [])],
}));
const megaDigital = Array.from({ length: 54 }, (_, pin): BoardIoPin => ({
  id: `D${pin}`,
  label: `D${pin}${[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 44, 45, 46].includes(pin) ? " ~" : ""}`,
  runtimePin: pin,
  pwm: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 44, 45, 46].includes(pin),
  signals: ["digital", ...([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 44, 45, 46].includes(pin) ? ["pwm" as const] : []), ...(pin === 20 || pin === 21 ? ["i2c" as const] : []), ...([0, 1, 14, 15, 16, 17, 18, 19].includes(pin) ? ["uart" as const] : []), ...([50, 51, 52, 53].includes(pin) ? ["spi" as const] : [])],
}));
const megaAnalog = Array.from({ length: 16 }, (_, index): BoardIoPin => ({
  id: `A${index}`,
  label: `A${index}`,
  runtimePin: index + 54,
  analog: true,
  signals: ["analog", "digital"],
}));

const nanoIo = [
  ...unoDigital,
  ...Array.from({ length: 8 }, (_, index): BoardIoPin => ({
    id: `A${index}`,
    label: `A${index}${index > 5 ? " (analog only)" : ""}`,
    runtimePin: index + 14,
    analog: true,
    inputOnly: index > 5,
    analogOnly: index > 5,
    signals: index > 5 ? ["analog" as const] : ["analog" as const, "digital" as const, ...(index === 4 || index === 5 ? ["i2c" as const] : [])],
  })),
];

const esp32Pins = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36, 39].map((pin): BoardIoPin => ({
  id: `GPIO${pin}`,
  label: `GPIO ${pin}${[34, 35, 36, 39].includes(pin) ? " · input" : ""}`,
  runtimePin: pin,
  analog: [0, 2, 4, 12, 13, 14, 15, 25, 26, 27, 32, 33, 34, 35, 36, 39].includes(pin),
  pwm: ![6, 7, 8, 9, 10, 11, 34, 35, 36, 39].includes(pin),
  reserved: [6, 7, 8, 9, 10, 11].includes(pin),
  inputOnly: [34, 35, 36, 39].includes(pin),
  // The DevKitC silk screen labels these pads by GPIO number. D0..Dxx names
  // belong to other boards (notably the ESP8266 NodeMCU) and are ambiguous.
  aliases: [`GPIO${pin}`],
  signals: ["digital", ...([0, 2, 4, 12, 13, 14, 15, 25, 26, 27, 32, 33, 34, 35, 36, 39].includes(pin) ? ["analog" as const] : []), ...(![6, 7, 8, 9, 10, 11, 34, 35, 36, 39].includes(pin) ? ["pwm" as const] : []), ...([1, 3, 16, 17].includes(pin) ? ["uart" as const] : []), ...([21, 22].includes(pin) ? ["i2c" as const] : []), ...([5, 18, 19, 23].includes(pin) ? ["spi" as const] : [])],
}));

const esp8266D = [16, 5, 4, 0, 2, 14, 12, 13, 15].map((gpio, index): BoardIoPin => ({
  id: `D${index}`,
  label: `D${index} / GPIO${gpio}`,
  runtimePin: gpio,
  analog: false,
  pwm: true,
  aliases: [`D${index}`, `GPIO${gpio}`],
  signals: ["digital", ...(index === 1 || index === 2 ? ["i2c" as const] : []), ...([5, 6, 7, 8].includes(index) ? ["spi" as const] : []), ...(index === 0 || index === 1 ? ["uart" as const] : []), "pwm"],
}));
const esp8266Io = [
  ...esp8266D,
  { id: "RX", label: "RX / GPIO3", runtimePin: 3, pwm: true, aliases: ["GPIO3"], signals: ["digital", "uart", "pwm"] as const },
  { id: "TX", label: "TX / GPIO1", runtimePin: 1, pwm: true, aliases: ["GPIO1"], signals: ["digital", "uart", "pwm"] as const },
  { id: "A0", label: "A0 / analog", runtimePin: 17, analog: true, inputOnly: true, signals: ["analog"] as const },
];

const picoIo: BoardIoPin[] = [...Array.from({ length: 23 }, (_, pin): BoardIoPin => ({
  id: `GP${pin}`,
  label: `GP${pin}${pin >= 26 ? " / ADC" : ""}`,
  runtimePin: pin,
  analog: pin >= 26,
  pwm: true,
  aliases: [`GPIO${pin}`, `GP${pin}`],
  signals: ["digital", ...(pin >= 26 ? ["analog" as const] : []), "pwm", ...([0, 1, 4, 5, 12, 13, 16, 17, 20, 21].includes(pin) ? ["uart" as const] : []), ...([0, 1, 4, 5, 8, 9, 12, 13, 16, 17, 20, 21, 24, 25, 26, 27].includes(pin) ? ["i2c" as const] : []), ...([2, 3, 4, 5, 6, 7, 10, 11, 14, 15, 16, 17, 18, 19, 22, 23].includes(pin) ? ["spi" as const] : [])],
})), ...[26, 27, 28].map((pin): BoardIoPin => ({
  id: `GP${pin}`, label: `GP${pin} / ADC`, runtimePin: pin, analog: true, pwm: true,
  aliases: [`GPIO${pin}`, `GP${pin}`], signals: ["digital", "analog", "pwm", "i2c", "spi"],
})), { id: "LED_BUILTIN", label: "Onboard LED · GP25", runtimePin: 25, pwm: true, onboard: true, aliases: ["GP25", "GPIO25"], signals: ["digital", "pwm"] }];

const definitions: Record<string, BoardProfile> = {
  "arduino-uno": {
    id: "arduino-uno", displayName: "Arduino Uno", manufacturer: "Arduino", variant: "Uno Rev3", mcu: "ATmega328P", logicVoltage: 5, analogResolutionBits: 10, analogReferenceVolts: 5, runtimePinCount: 20,
    ioPins: [...unoDigital, ...unoAnalog], pwmPins: [3, 5, 6, 9, 10, 11], analogPins: [14, 15, 16, 17, 18, 19], constants: { A0: 14, A1: 15, A2: 16, A3: 17, A4: 18, A5: 19, LED_BUILTIN: 13, SDA: 18, SCL: 19, MOSI: 11, MISO: 12, SCK: 13, SS: 10 }, reservedPins: [], rails: { "5V": 5, "3V3": 3.3, IOREF: 5 }, groundPins: ["GND", "GND2", "GND3"], i2c: [{ sda: 18, scl: 19 }], spi: [{ mosi: 11, miso: 12, sck: 13, ss: 10 }], uart: [{ rx: 0, tx: 1 }], builtinLed: 13, documentation: "https://docs.arduino.cc/hardware/uno-rev3/",
  },
  "arduino-mega-2560": {
    id: "arduino-mega-2560", displayName: "Arduino Mega 2560", manufacturer: "Arduino", variant: "Mega 2560 Rev3", mcu: "ATmega2560", logicVoltage: 5, analogResolutionBits: 10, analogReferenceVolts: 5, runtimePinCount: 70,
    ioPins: [...megaDigital, ...megaAnalog], pwmPins: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 44, 45, 46], analogPins: Array.from({ length: 16 }, (_, i) => i + 54), constants: { ...Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`A${i}`, i + 54])), LED_BUILTIN: 13, SDA: 20, SCL: 21, MOSI: 51, MISO: 50, SCK: 52, SS: 53 }, reservedPins: [], rails: { "5V": 5, "3V3": 3.3, IOREF: 5 }, groundPins: ["GND", "GND2", "GND3", "GND4"], i2c: [{ sda: 20, scl: 21 }], spi: [{ mosi: 51, miso: 50, sck: 52, ss: 53 }], uart: [{ rx: 0, tx: 1 }, { rx: 19, tx: 18 }, { rx: 17, tx: 16 }, { rx: 15, tx: 14 }], builtinLed: 13, documentation: "https://docs.arduino.cc/hardware/mega-2560/",
  },
  "arduino-nano-classic": {
    id: "arduino-nano-classic", displayName: "Arduino Nano", manufacturer: "Arduino", variant: "Classic Nano, ATmega328P", mcu: "ATmega328P", logicVoltage: 5, analogResolutionBits: 10, analogReferenceVolts: 5, runtimePinCount: 22,
    ioPins: nanoIo, pwmPins: [3, 5, 6, 9, 10, 11], analogPins: Array.from({ length: 8 }, (_, i) => i + 14), constants: { ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`A${i}`, i + 14])), LED_BUILTIN: 13, SDA: 18, SCL: 19, MOSI: 11, MISO: 12, SCK: 13, SS: 10 }, reservedPins: [], rails: { "5V": 5, "3V3": 3.3 }, groundPins: ["GND", "GND2"], i2c: [{ sda: 18, scl: 19 }], spi: [{ mosi: 11, miso: 12, sck: 13, ss: 10 }], uart: [{ rx: 0, tx: 1 }], builtinLed: 13, documentation: "https://docs.arduino.cc/hardware/nano/",
  },
  "esp32-devkitc-v4": {
    id: "esp32-devkitc-v4", displayName: "ESP32 DevKitC V4", manufacturer: "Espressif", variant: "ESP32-DevKitC V4, ESP32-WROOM-32E", mcu: "ESP32", logicVoltage: 3.3, analogResolutionBits: 12, analogReferenceVolts: 3.3, runtimePinCount: 40,
    ioPins: esp32Pins, pwmPins: esp32Pins.filter(pin => pin.pwm).map(pin => pin.runtimePin), analogPins: esp32Pins.filter(pin => pin.analog).map(pin => pin.runtimePin), constants: { LED_BUILTIN: 2, SDA: 21, SCL: 22, MOSI: 23, MISO: 19, SCK: 18, SS: 5 }, reservedPins: [6, 7, 8, 9, 10, 11], rails: { "3V3": 3.3, "5V": 5 }, groundPins: ["GND", "GND2", "GND3"], i2c: [{ sda: 21, scl: 22 }], spi: [{ mosi: 23, miso: 19, sck: 18, ss: 5 }, { mosi: 13, miso: 12, sck: 14, ss: 15 }], uart: [{ rx: 3, tx: 1 }, { rx: 16, tx: 17 }], builtinLed: 2, documentation: "https://docs.espressif.com/projects/esp-idf/en/stable/esp32/hw-reference/esp32/get-started-devkitc.html",
  },
  "esp8266-nodemcu-v1": {
    id: "esp8266-nodemcu-v1", displayName: "ESP8266 NodeMCU", manufacturer: "Espressif / NodeMCU community", variant: "NodeMCU DevKit V1.0, ESP-12E", mcu: "ESP8266EX", logicVoltage: 3.3, analogResolutionBits: 10, analogReferenceVolts: 3.3, runtimePinCount: 18,
    ioPins: esp8266Io, pwmPins: [0, 1, 2, 3, 4, 5, 12, 13, 14, 15, 16], analogPins: [17], constants: { D0: 16, D1: 5, D2: 4, D3: 0, D4: 2, D5: 14, D6: 12, D7: 13, D8: 15, D9: 3, D10: 1, LED_BUILTIN: 2, SDA: 4, SCL: 5, MOSI: 13, MISO: 12, SCK: 14, SS: 15 }, reservedPins: [6, 7, 8, 9, 10, 11], rails: { "3V3": 3.3 }, groundPins: ["GND", "GND2", "GND3"], i2c: [{ sda: 4, scl: 5 }], spi: [{ mosi: 13, miso: 12, sck: 14, ss: 15 }], uart: [{ rx: 3, tx: 1 }], builtinLed: 2, documentation: "https://arduino-esp8266.readthedocs.io/en/latest/",
  },
  "raspberry-pi-pico": {
    id: "raspberry-pi-pico", displayName: "Raspberry Pi Pico", manufacturer: "Raspberry Pi", variant: "Pico, RP2040, non-wireless", mcu: "RP2040", logicVoltage: 3.3, analogResolutionBits: 12, analogReferenceVolts: 3.3, runtimePinCount: 30,
    ioPins: picoIo, pwmPins: picoIo.map(pin => pin.runtimePin), analogPins: [26, 27, 28], constants: { LED_BUILTIN: 25, SDA: 4, SCL: 5, MOSI: 19, MISO: 16, SCK: 18, SS: 17 }, reservedPins: [], rails: { "3V3": 3.3, VBUS: 5 }, groundPins: ["GND", "GND2", "GND3"], i2c: [{ sda: 4, scl: 5 }, { sda: 0, scl: 1 }, { sda: 8, scl: 9 }, { sda: 12, scl: 13 }, { sda: 16, scl: 17 }, { sda: 20, scl: 21 }, { sda: 2, scl: 3 }, { sda: 6, scl: 7 }, { sda: 10, scl: 11 }, { sda: 14, scl: 15 }, { sda: 18, scl: 19 }, { sda: 26, scl: 27 }], spi: [{ mosi: 19, miso: 16, sck: 18, ss: 17 }, { mosi: 15, miso: 12, sck: 14, ss: 13 }], uart: [{ rx: 1, tx: 0 }, { rx: 5, tx: 4 }], builtinLed: 25, documentation: "https://datasheets.raspberrypi.com/pico/getting-started-with-pico.pdf",
  },
};

export const BOARD_PROFILES: Readonly<Record<string, BoardProfile>> = Object.freeze(definitions);
export const BOARD_IDS = Object.freeze(Object.keys(BOARD_PROFILES));
/** Registered generic GPIO/peripheral runtime target for each board component. */
export const BOARD_PROFILE_MODEL_REGISTRY: Readonly<Record<string, string>> = Object.freeze(Object.fromEntries(
  BOARD_IDS.filter(id => id !== "arduino-uno").map(id => [`board-profile:${id}`, id]),
));
export function getBoardProfile(id: string): BoardProfile | undefined { return BOARD_PROFILES[id]; }
export function isBoardType(id: string): boolean { return Object.hasOwn(BOARD_PROFILES, id); }

export function boardApiConstants(boardId: string): Readonly<Record<string, number>> {
  const profile = getBoardProfile(boardId);
  if (!profile) return {};
  const pins = Object.fromEntries(profile.ioPins.flatMap(pin => [
    [pin.id, pin.runtimePin] as const,
    ...(pin.aliases ?? []).map(alias => [alias, pin.runtimePin] as const),
  ]));
  return { ...pins, ...profile.constants };
}

export function resolveBoardPin(boardId: string, pin: string | number): number | undefined {
  const profile = getBoardProfile(boardId);
  if (!profile) return undefined;
  if (typeof pin === "number") {
    if (!Number.isInteger(pin) || pin < 0 || pin >= profile.runtimePinCount || profile.reservedPins.includes(pin)) return undefined;
    return profile.ioPins.some(item => item.runtimePin === pin && !item.reserved) ? pin : undefined;
  }
  const normalized = pin.trim().toUpperCase();
  const constant = boardApiConstants(boardId)[normalized];
  if (constant !== undefined && resolveBoardPin(boardId, constant) !== undefined) return constant;
  const match = profile.ioPins.find(item => item.id.toUpperCase() === normalized || item.label.toUpperCase() === normalized || (item.aliases ?? []).some(alias => alias.toUpperCase() === normalized));
  if (match && !match.reserved && !profile.reservedPins.includes(match.runtimePin)) return match.runtimePin;
  if (/^\d+$/.test(normalized)) return resolveBoardPin(boardId, Number(normalized));
  return undefined;
}

export function boardPinLabel(boardId: string, runtimePin: number): string {
  const profile = getBoardProfile(boardId);
  const pin = profile?.ioPins.find(item => item.runtimePin === runtimePin && !item.reserved);
  if (pin) return pin.id === "LED_BUILTIN" ? "GP25" : pin.id;
  return `Pin ${runtimePin}`;
}
export function isBoardPin(boardId: string, runtimePin: number): boolean { return resolveBoardPin(boardId, runtimePin) !== undefined; }
export function isBoardPwmPin(boardId: string, runtimePin: number): boolean { return !!getBoardProfile(boardId)?.pwmPins.includes(runtimePin); }
export function isBoardAnalogPin(boardId: string, runtimePin: number): boolean { return !!getBoardProfile(boardId)?.analogPins.includes(runtimePin); }
export function isBoardInputOnlyPin(boardId: string, runtimePin: number): boolean { return !!getBoardProfile(boardId)?.ioPins.some(pin => pin.runtimePin === runtimePin && pin.inputOnly); }
export function isBoardDigitalPin(boardId: string, runtimePin: number): boolean { return !!getBoardProfile(boardId)?.ioPins.some(pin => pin.runtimePin === runtimePin && !pin.reserved && !pin.analogOnly && (pin.signals ?? ["digital"]).includes("digital")); }
export function isBoardDigitalOutputPin(boardId: string, runtimePin: number): boolean { return isBoardDigitalPin(boardId, runtimePin) && !isBoardInputOnlyPin(boardId, runtimePin); }

function ioPinDefinition(pin: BoardIoPin, index: number, side: "left" | "right"): ComponentPinDefinition {
  return { id: pin.id, label: pin.label, direction: pin.reserved ? "passive" : pin.inputOnly ? "input" : "bidirectional", signals: pin.reserved ? [] : pin.signals ?? ["digital"], side, order: index, noConnect: pin.reserved };
}

type BoardHeaderRows = { left: string[]; right: string[] };

/** Physical J2/J3 row order for the registered ESP32-DevKitC V4, viewed from above with USB at the top. */
const ESP32_DEVKITC_HEADER_ROWS: BoardHeaderRows = {
  left: ["3V3", "GPIO36", "GPIO39", "GPIO34", "GPIO35", "GPIO32", "GPIO33", "GPIO25", "GPIO26", "GPIO27", "GPIO14", "GPIO12", "GND", "GPIO13", "GPIO9", "GPIO10", "GPIO11", "5V"],
  right: ["GND2", "GPIO23", "GPIO22", "GPIO1", "GPIO3", "GPIO21", "GND3", "GPIO19", "GPIO18", "GPIO5", "GPIO17", "GPIO16", "GPIO4", "GPIO0", "GPIO2", "GPIO15", "GPIO8", "GPIO7", "GPIO6"],
};

function boardHeaderRows(profile: BoardProfile): BoardHeaderRows {
  if (profile.id === "esp32-devkitc-v4") {
    return { left: [...ESP32_DEVKITC_HEADER_ROWS.left], right: [...ESP32_DEVKITC_HEADER_ROWS.right] };
  }

  const physicalIo = profile.ioPins.filter(pin => pin.runtimePin >= 0 && !pin.onboard);
  const half = Math.ceil(physicalIo.length / 2);
  const rows: BoardHeaderRows = {
    left: physicalIo.slice(0, half).map(pin => pin.id),
    right: physicalIo.slice(half).map(pin => pin.id),
  };
  // Keep supply and ground terminals on the board's two edge headers instead
  // of drawing fictitious connector rows above and below the board artwork.
  for (const id of [...Object.keys(profile.rails), ...profile.groundPins]) {
    const row = rows.left.length <= rows.right.length ? rows.left : rows.right;
    row.push(id);
  }
  return rows;
}

function boardDefinition(profile: BoardProfile): ComponentDefinition {
  const physicalIo = profile.ioPins.filter(pin => pin.runtimePin >= 0 && !pin.onboard);
  const headerRows = boardHeaderRows(profile);
  const ioById = new Map(physicalIo.map(pin => [pin.id, pin]));
  const powerById = new Map<string, Pick<ComponentPinDefinition, "id" | "label" | "direction" | "signals">>();
  for (const id of Object.keys(profile.rails)) powerById.set(id, { id, label: id, direction: "power", signals: ["power"] });
  for (const id of profile.groundPins) powerById.set(id, { id, label: "GND", direction: "power", signals: ["ground"] });
  const pinsForRow = (ids: readonly string[], side: "left" | "right") => ids.map((id, order) => {
    const ioPin = ioById.get(id);
    return ioPin ? ioPinDefinition(ioPin, order, side) : { ...powerById.get(id)!, side, order };
  });
  const pinDefinitions = [...pinsForRow(headerRows.left, "left"), ...pinsForRow(headerRows.right, "right")];
  const height = Math.max(240, Math.max(headerRows.left.length, headerRows.right.length) * 19 + 82);
  const width = profile.id === "arduino-mega-2560" ? 340 : profile.id.includes("esp") ? 230 : 270;
  const properties: Record<string, ComponentPropertyDefinition> = profile.id.startsWith("esp") ? {
    networkSsid: { kind: "string", label: "Virtual Wi-Fi network", defaultValue: "CirkitraNet" },
    networkPassword: { kind: "string", label: "Virtual Wi-Fi password", defaultValue: "cirkitra123" },
    udpPeerEnabled: { kind: "boolean", label: "Virtual UDP peer enabled", defaultValue: true },
    peerSsid: { kind: "string", label: "UDP peer network", defaultValue: "CirkitraNet" },
    peerPassword: { kind: "string", label: "UDP peer password", defaultValue: "cirkitra123" },
    peerAddress: { kind: "string", label: "UDP peer address", defaultValue: "192.0.2.2" },
    peerPort: { kind: "number", label: "UDP peer port", defaultValue: 4210, min: 1, max: 65535 },
  } : {};
  return {
    id: profile.id, displayName: profile.displayName, category: "boards",
    description: `${profile.variant} development board with ${profile.mcu} simulation profile.`,
    width, height, accent: "#0f9d9a", simulated: true,
    pins: pinDefinitions, properties, defaultProperties: Object.fromEntries(Object.entries(properties).map(([key, property]) => [key, property.defaultValue])), symbol: "module",
    simulation: { capability: "simulated", model: `board-profile:${profile.id}`, behavior: `Board-specific GPIO, ADC, PWM, UART, I2C, and SPI profile at ${profile.logicVoltage}V logic.`, limitations: "Only the documented browser-simulator API subset executes; the model is not a cycle-accurate MCU or electrical analog analysis." },
    metadata: {
      manufacturer: profile.manufacturer, variant: profile.variant, kind: "module", aliases: [profile.mcu], interfaces: ["GPIO", "ADC", "PWM", "UART", "I2C", "SPI", ...(profile.id.startsWith("esp") ? ["Wi-Fi"] : [])],
      supplies: [], groundPins: profile.groundPins, documentation: [{ title: `${profile.displayName} documentation`, url: profile.documentation, section: "Pinout and board reference" }], libraries: profile.id.startsWith("esp") ? [{ name: profile.id.startsWith("esp32") ? "Arduino ESP32 WiFi" : "ESP8266WiFi", url: profile.id.startsWith("esp32") ? "https://github.com/espressif/arduino-esp32" : "https://github.com/esp8266/Arduino", headers: [profile.id.startsWith("esp32") ? "WiFi.h" : "ESP8266WiFi.h", "WiFiUdp.h"], note: "The simulator supports connection to a configured virtual network and UDP peer only; it does not access the internet or execute arbitrary libraries." }] : [], notes: [`${profile.logicVoltage}V I/O logic.`, `ADC resolution ${profile.analogResolutionBits}-bit; analog reference ${profile.analogReferenceVolts}V.`, ...(profile.id.startsWith("esp") ? ["Virtual Wi-Fi and UDP only; no BLE, internet, or radio propagation."] : [])], verifiedOn: "2026-09-28",
    },
  };
}

export const BOARD_COMPONENTS: Readonly<Record<string, ComponentDefinition>> = Object.freeze(Object.fromEntries(
  BOARD_IDS.filter(id => id !== "arduino-uno").map(id => [id, boardDefinition(BOARD_PROFILES[id])]),
));
