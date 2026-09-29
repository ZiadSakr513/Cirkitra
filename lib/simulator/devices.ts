import type { CircuitComponent, CircuitProject } from "../circuit/types.ts";
import { deviceInstances, splitDeviceArguments, type DeviceInstance } from "./device-api.ts";
import { DeviceWiring } from "./device-wiring.ts";
import type { SimulatedComponentState, SimulatorDiagnostic, SimulatorSnapshot, UnoPinState } from "./types.ts";
import { boschMeasurementRegister } from "./bosch-registers.ts";
import { Bq27441Model } from "./bq27441.ts";
import { XBeeModel, XBeeFrameDecoder, encodeXBeeFrame } from "./xbee.ts";
import { LoRaModel } from "./lora.ts";
import { Sht31Model } from "./sht31.ts";
import { OneWireRuntime, sensorRom } from "./one-wire.ts";
import { PowerRuntime, type PowerResult } from "./power.ts";
import type { MotorSupplyLoad } from "./motor-loads.ts";
import { STATEFUL_MODEL_TYPES } from "./stateful-models.ts";
import { getBoardProfile } from "../circuit/boards.ts";

export type DeviceValue = number | string | boolean | number[] | { [key: string]: DeviceValue };
export interface UartTransmission { port: number; baud: number; data: readonly number[] }
export interface I2cPeerEndpoint {
  address(): number | undefined;
  receive(data: readonly number[]): boolean;
  request(length: number): readonly number[];
}
interface UdpSocketState { localPort: number; remoteAddress: string; remotePort: number; tx: number[]; rx: number[] }
export interface DeviceMemory {
  registers: Uint8Array; pointer: number; initialized: boolean; sleeping: boolean;
  readyAt: number; sampleAt: number; resolution: number; heater: boolean;
  shift: number; latch: number; clock: boolean; latchClock: boolean;
  tx: number[]; rx: number[]; packets: NonNullable<SimulatedComponentState["packets"]>[number][];
  frequency: number; spreading: number; bandwidth: number; coding: number; sync: number; crc: boolean;
  receiving: boolean; lastInterrupt: number; captured: number; previousInputs: number;
  displayBuffer: string[]; displayText: string[]; cursorColumn: number; cursorRow: number; textSize: number; displayOn: boolean;
  pixelBuffer: Array<{ r: number; g: number; b: number }>; pixels: Array<{ r: number; g: number; b: number }>; brightness: number;
  rtcEpochSeconds?: number; rtcSetAtMs?: number;
  stepCount: number; stepIntervalMs: number; lastStepAt: number;
}
interface SdFileHandle { componentId: string; path: string; position: number; mode: number; open: boolean }
export const STATEFUL_PARTS = STATEFUL_MODEL_TYPES;
const numeric = (c: CircuitComponent, property: string, fallback: number) => Number(c.properties?.[property] ?? fallback);
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const fromBcd = (value: number) => ((value >> 4) & 0x0f) * 10 + (value & 0x0f);
const toBcd = (value: number) => ((Math.floor(value / 10) << 4) | (value % 10)) & 0xff;
const bytes = (value: DeviceValue): number[] => Array.isArray(value) ? value.map(v => v & 255) : typeof value === "string" ? [...new TextEncoder().encode(value)] : [Number(value) & 255];
function memory(): DeviceMemory {
  const registers = new Uint8Array(256); registers[0] = 255; registers[1] = 255;
  return { registers, pointer: 0, initialized: false, sleeping: false, readyAt: 0, sampleAt: -Infinity, resolution: 12, heater: false, shift: 0, latch: 0, clock: false, latchClock: false, tx: [], rx: [], packets: [], frequency: 915000000, spreading: 7, bandwidth: 125000, coding: 5, sync: 0x12, crc: false, receiving: false, lastInterrupt: 255, captured: 0, previousInputs: 0, displayBuffer: Array(8).fill(""), displayText: Array(8).fill(""), cursorColumn: 0, cursorRow: 0, textSize: 1, displayOn: false, pixelBuffer: Array.from({ length: 8 }, () => ({ r: 0, g: 0, b: 0 })), pixels: Array.from({ length: 8 }, () => ({ r: 0, g: 0, b: 0 })), brightness: 255, stepCount: 0, stepIntervalMs: 0, lastStepAt: -1 };
}

/** One instance per running project. All mutation happens on the simulator clock. */
export class DeviceRuntime {
  readonly memory = new Map<string, DeviceMemory>();
  readonly diagnostics: SimulatorDiagnostic[] = [];
  readonly values = new Map<string, DeviceValue>();
  private instances = new Map<string, DeviceInstance>();
  private bindings = new Map<string, string>();
  private constructors = new Map<string, DeviceValue[]>();
  private time = 0;
  private power = new PowerRuntime();
  private powerResult?: PowerResult;
  private powerControls: Record<string, number> = {};
  private charging: Record<string, number> = {};
  private protectionSince = new Map<string, number>();
  private protectionLatched = new Map<string, number>();
  private chargerElapsed = new Map<string, number>();
  private chargerLastTick = new Map<string, number>();
  private chargerModes = new Map<string, number>();
  private chargerEnabled = new Map<string, boolean>();
  pendingDelayMs = 0;
  private wiring!: DeviceWiring;
  private wireAddress = 0;
  private wireTx: number[] = [];
  private wireRx: number[] = [];
  private wireMasterTransmitting = false;
  private wirePeripheralAddress?: number;
  private wirePeripheralTx: number[] = [];
  private wirePeripheralRx: number[] = [];
  private wireOnReceive = false;
  private wireOnRequest = false;
  private i2cPeers: readonly I2cPeerEndpoint[] = [];
  private spiAddress: number | undefined;
  private spiRead = false;
  private spiSelected: string | undefined;
  private uartRx = new Map<number, number[]>();
  private uartTx: UartTransmission[] = [];
  private wifiConnected = false;
  private udpSockets = new Map<string, UdpSocketState>();
  private udpPackets: NonNullable<SimulatedComponentState["packets"]>[number][] = [];
  private sdCards = new Map<string, Map<string, number[]>>();
  private sdMounted?: string;
  private sdHandles = new Map<string, SdFileHandle>();
  private pendingSdFile?: SdFileHandle;
  private radioPins = [10, 9, 2];
  private previousShift = new Map<string, number>();
  private oneWire = new OneWireRuntime();
  private gauges = new Map<string, Bq27441Model>();
  private gauge(c: CircuitComponent) { let model = this.gauges.get(c.id); if (!model) { model = new Bq27441Model(); this.gauges.set(c.id, model); } return model; }
  private zigbees = new Map<string, XBeeModel>();
  private responseDecoders = new Map<string, XBeeFrameDecoder>();
  private xbee(c: CircuitComponent) { let model = this.zigbees.get(c.id); if (!model) { model = new XBeeModel(); this.zigbees.set(c.id, model); } return model; }
  private radios = new Map<string, LoRaModel>();
  private lora(c: CircuitComponent) { let model = this.radios.get(c.id); if (!model) { model = new LoRaModel(); this.radios.set(c.id, model); } return model; }
  private shtSensors = new Map<string, Sht31Model>();
  private sht(c: CircuitComponent) { let model = this.shtSensors.get(c.id); if (!model) { model = new Sht31Model(); this.shtSensors.set(c.id, model); } return model; }
  states: Record<string, SimulatedComponentState> = {};
  drives: Array<NonNullable<SimulatorSnapshot["deviceDrives"]>[number]> = [];
  bridges: Array<NonNullable<SimulatorSnapshot["deviceBridges"]>[number]> = [];
  constructor(private project: CircuitProject, private source: string, private boardId: string = project.board, private boardComponentId?: string) {
    this.boardComponentId ??= project.components.find(component => component.type === boardId)?.id;
    this.reset();
  }
  configure(project: CircuitProject, boardId: string = this.boardId, boardComponentId?: string) {
    this.project = project;
    this.boardId = boardId;
    this.boardComponentId = boardComponentId ?? project.components.find(component => component.type === boardId)?.id;
  }
  boundComponentIds(): readonly string[] { return [...new Set(this.bindings.values())]; }
  reset(source = this.source) {
    this.source = source; this.instances = deviceInstances(source, this.boardId); this.bindings.clear(); this.constructors.clear(); this.memory.clear(); this.values.clear();
    this.states = {}; this.drives = []; this.bridges = []; this.time = 0; this.diagnostics.length = 0;
    this.power.reset(); this.powerControls = {}; this.charging = {}; this.protectionSince.clear(); this.protectionLatched.clear(); this.chargerElapsed.clear(); this.chargerLastTick.clear(); this.chargerModes.clear(); this.chargerEnabled.clear(); this.pendingDelayMs = 0;
    this.wireTx = []; this.wireRx = []; this.wireMasterTransmitting = false; this.wirePeripheralAddress = undefined; this.wirePeripheralTx = []; this.wirePeripheralRx = []; this.wireOnReceive = false; this.wireOnRequest = false; this.spiAddress = undefined; this.spiSelected = undefined; this.uartRx.clear(); this.uartTx = []; this.wifiConnected = false; this.udpSockets.clear(); this.udpPackets = []; this.radioPins = [10, 9, 2]; this.oneWire.reset(); this.shtSensors.clear(); this.radios.clear(); this.zigbees.clear(); this.responseDecoders.clear(); this.gauges.clear(); this.sdMounted = undefined; this.sdHandles.clear(); this.pendingSdFile = undefined;
    for (const c of this.project.components) if (STATEFUL_PARTS.includes(c.type)) { const m = memory(); if (c.type !== "mcp23017") m.registers.fill(0); this.memory.set(c.id, m); }
    for (const match of source.matchAll(/\b(?:const\s+)?(byte|uint8_t|char)\s+([A-Za-z_]\w*)\s*((?:\[[^\]]*\]\s*)+)\s*=\s*([^;]+);/g)) {
      const [, type, name, , initializer] = match;
      if (type === "char") {
        this.values.set(name, [...initializer.matchAll(/'(?:\\.|[^'\\])'/g)].map(([character]) => character.slice(1, -1).charCodeAt(0)));
      } else {
        const contents = initializer.slice(initializer.indexOf("{") + 1, initializer.lastIndexOf("}"));
        const entries = splitDeviceArguments(contents).map(item => Number(item.trim()));
        this.values.set(name, entries.every(Number.isFinite) ? entries : []);
      }
    }
    for (const match of source.matchAll(/\bDeviceAddress\s+([A-Za-z_]\w*)\s*(?:=\s*\{([^}]*)\})?\s*;/g)) this.values.set(match[1], match[2] ? splitDeviceArguments(match[2]).map(Number) : Array(8).fill(0));
  }
  private error(code: string, message: string) {
    if (!this.diagnostics.some(d => d.code === code && d.message === message)) this.diagnostics.push({ severity: "error", code, message });
  }
  private m(c: CircuitComponent) { let state = this.memory.get(c.id); if (!state) { state = memory(); this.memory.set(c.id, state); } return state; }
  bindOpenedFile(name: string): boolean {
    if (!this.pendingSdFile) { this.values.set(name, 0); return false; }
    this.sdHandles.set(name, this.pendingSdFile); this.pendingSdFile = undefined; this.values.set(name, 1); return true;
  }
  private sdCall(method: string, args: DeviceValue[], name: string): DeviceValue {
    const filename = String(args[0] ?? "").replaceAll("\\", "/").replace(/^\/+/, "");
    const clean = filename.split("/").filter(part => part && part !== "." && part !== "..").join("/");
    const cardFor = (cardId: string) => { let files = this.sdCards.get(cardId); if (!files) { files = new Map(); this.sdCards.set(cardId, files); } return files; };
    if (method === "begin") {
      const cs = Math.trunc(Number(args[0])); const profile = getBoardProfile(this.boardId);
      const pin = profile?.ioPins.find(item => item.runtimePin === cs && !item.reserved && (item.signals ?? ["digital"]).includes("digital"));
      const cards = this.project.components.filter(c => c.type === "micro-sd-spi-module" && this.powered(c)
        && this.wiring.spi(c, cs, { mosi: "DI", miso: "DO", sck: "CLK", cs: "CS" }) && this.wiring.boardConnected(c.id, "CS", cs));
      if (!pin || cards.length !== 1) {
        this.sdMounted = undefined;
        this.error(cards.length > 1 ? "SD_SPI_CONFLICT" : "SD_NOT_CONNECTED", `${name}.begin(${cs}): connect one powered microSD breakout's CLK/DO/DI to this board's SPI bus and CS to a supported digital pin.`);
        return 0;
      }
      const card = cards[0];
      if (card.properties?.cardPresent === false) { this.error("SD_CARD_MISSING", `${name}.begin(): no microSD card is inserted.`); return 0; }
      this.sdMounted = card.id; this.m(card).initialized = true; this.m(card).registers[0] = cs & 0xff; cardFor(card.id); this.pendingSdFile = undefined; return 1;
    }
    const cardId = this.sdMounted;
    const mountedCard = this.project.components.find(c => c.id === cardId);
    const mountedCs = mountedCard ? this.m(mountedCard).registers[0] : -1;
    if (!cardId || !mountedCard || !this.powered(mountedCard) || mountedCard.properties?.cardPresent === false
      || !this.wiring.spi(mountedCard, mountedCs, { mosi: "DI", miso: "DO", sck: "CLK", cs: "CS" })) {
      this.sdMounted = undefined;
      this.error("SD_NOT_MOUNTED", `${name}.${method}(): call SD.begin(cs) with a powered, connected card first.`); return method === "exists" || method === "remove" || method === "open" ? 0 : NaN;
    }
    const files = cardFor(cardId);
    if (method === "exists") return Number(files.has(clean));
    if (method === "remove") return Number(files.delete(clean));
    if (method === "open") {
      if (!clean) { this.pendingSdFile = undefined; return 0; }
      const mode = Number(args[1] ?? 0);
      if (mode !== 0 && mode !== 1) { this.error("SD_MODE_UNSUPPORTED", "SD.open supports FILE_READ and FILE_WRITE only."); this.pendingSdFile = undefined; return 0; }
      if (mode === 0 && !files.has(clean)) { this.pendingSdFile = undefined; return 0; }
      if (mode === 1 && !files.has(clean)) files.set(clean, []);
      const contents = files.get(clean)!;
      this.pendingSdFile = { componentId: cardId, path: clean, position: mode === 1 ? contents.length : 0, mode, open: true };
      return 1;
    }
    this.error("DEVICE_METHOD_UNIMPLEMENTED", `${name}.${method}() is outside the registered SD.h subset.`); return NaN;
  }
  private sdFileCall(name: string, method: string, args: DeviceValue[]): DeviceValue {
    const handle = this.sdHandles.get(name);
    if (!handle?.open) { this.error("SD_FILE_NOT_OPEN", `${name}.${method}(): open a file successfully before using its File handle.`); return method === "read" || method === "peek" ? -1 : 0; }
    const files = this.sdCards.get(handle.componentId); const contents = files?.get(handle.path);
    if (!contents) { this.error("SD_FILE_REMOVED", `${name}: the open file was removed from the virtual card.`); return -1; }
    const card = this.project.components.find(c => c.id === handle.componentId);
    if (!card || !this.powered(card) || card.properties?.cardPresent === false || this.sdMounted !== handle.componentId) {
      this.error("SD_CARD_UNAVAILABLE", `${name}: card power, insertion, or SPI connection was lost while the file was open.`); return -1;
    }
    if (method === "close") { handle.open = false; return 0; }
    if (method === "flush") return 0;
    if (method === "available") return Math.max(0, contents.length - handle.position);
    if (method === "position") return handle.position;
    if (method === "size") return contents.length;
    if (method === "seek") { handle.position = clamp(Math.trunc(Number(args[0])), 0, 8_388_608); return 1; }
    if (method === "peek") return contents[handle.position] ?? -1;
    if (method === "read") return contents[handle.position++] ?? -1;
    if (method === "write" || method === "print" || method === "println") {
      if (handle.mode !== 1) { this.error("SD_FILE_READ_ONLY", `${name}: write to a file opened with FILE_WRITE.`); return 0; }
      let data: number[];
      if (method === "println") data = args.length ? bytes(`${String(args[0])}\r\n`) : bytes("\r\n");
      else if (method === "print") data = args.length ? bytes(String(args[0])) : [];
      else data = bytes(args[0]).slice(0, args[1] === undefined ? undefined : Math.max(0, Math.trunc(Number(args[1]))));
      const card = this.project.components.find(c => c.id === handle.componentId);
      const limit = Math.max(1, Number(card?.properties?.capacityMiB ?? 32)) * 1024 * 1024;
      const cardSize = [...(files?.values() ?? [])].reduce((sum, file) => sum + file.length, 0);
      const overwritten = Math.min(data.length, Math.max(0, contents.length - handle.position));
      const accepted = Math.max(0, Math.min(data.length, limit - cardSize + overwritten));
      if (accepted < data.length) this.error("SD_CARD_FULL", "The simulated SD card capacity has been reached; remaining bytes were not written.");
      contents.splice(handle.position, accepted, ...data.slice(0, accepted)); handle.position += accepted; return accepted;
    }
    this.error("DEVICE_METHOD_UNIMPLEMENTED", `${name}.${method}() is outside the registered File subset.`); return NaN;
  }
  private mfrc522Call(name: string, method: string, args: DeviceValue[], evaluate: (text: string) => DeviceValue): DeviceValue {
    const logicVoltage = getBoardProfile(this.boardId)?.logicVoltage ?? 5;
    if (logicVoltage > 3.6) {
      this.error("RFID_LOGIC_LEVEL", `${name}: the MFRC522 module uses 3.3 V logic. ${this.boardId} outputs ${logicVoltage} V; add a supported level shifter or use a 3.3 V board.`);
      return 0;
    }
    const initialize = method === "PCD_Init";
    const c = this.resolve(name, args, evaluate, initialize);
    if (!c) {
      this.error("RFID_NOT_CONNECTED", `${name}.${method}(): connect 3.3 V, ground, SPI NSS/SCK/MOSI/MISO, and the configured reset pin to supported ${this.boardId} pins.`);
      return 0;
    }
    const m = this.m(c);
    if (method === "PCD_Init") { m.initialized = true; this.values.set(name, {}); return 1; }
    if (method === "PCD_Reset") { m.initialized = false; this.values.set(name, {}); return 0; }
    if (!m.initialized) { this.error("DEVICE_NOT_INITIALIZED", `${name}: call PCD_Init() before polling for a tag.`); return 0; }
    const uid = String(c.properties?.tagUid ?? "DEADBEEF").replace(/[^\da-f]/gi, "").toUpperCase();
    const bytes = uid.match(/.{2}/g)?.map(value => Number.parseInt(value, 16)) ?? [];
    const present = c.properties?.tagPresent === true && [4, 7, 10].includes(bytes.length);
    if (method === "PICC_IsNewCardPresent") return Number(present);
    if (method === "PICC_ReadCardSerial") {
      if (!present) return 0;
      this.values.set(name, { uid: { size: bytes.length, uidByte: bytes, sak: 8 } });
      this.m(c).captured = bytes.length;
      return 1;
    }
    if (method === "PICC_HaltA") return 0;
    this.error("DEVICE_METHOD_UNIMPLEMENTED", `${name}.${method}() is outside the supported MFRC522 UID-reading subset.`);
    return 0;
  }
  private high(c: CircuitComponent, pin: string) { return (this.wiring.voltage(c.id, pin) ?? 0) >= 2; }
  private address(c: CircuitComponent): number {
    const bit = (pin: string) => this.high(c, pin) ? 1 : 0;
    if (c.type === "bme280" || c.type === "bmp280") return 0x76 + bit("SDO");
    if (c.type === "sht31-dis") return 0x44 + bit("ADDR");
    if (c.type === "mpu-6050") return 0x68 + bit("AD0");
    if (c.type === "bh1750-sen0097") return this.high(c, "ADD") ? 0x5c : 0x23;
    if (c.type === "ssd1306-oled-128x64") return 0x3c;
    if (c.type === "mcp23017" || c.type === "tca9548a") return (c.type === "mcp23017" ? 0x20 : 0x70) + bit("A0") + 2 * bit("A1") + 4 * bit("A2");
    if (c.type === "ds3231-rtc") return 0x68;
    return c.type === "bq27441-g1" ? 0x55 : 0x08;
  }
  private configureBh1750(c: CircuitComponent, command: number): boolean {
    const m = this.m(c);
    if (command === 0x00) { m.sleeping = true; m.initialized = false; return true; }
    if (command === 0x01) { m.sleeping = false; return true; }
    if (command === 0x07) {
      if (m.sleeping) return false;
      m.readyAt = this.time;
      return true;
    }
    if (![0x10, 0x11, 0x13, 0x20, 0x21, 0x23].includes(command)) {
      this.error("BH1750_COMMAND", `BH1750 received unsupported command 0x${command.toString(16)}. Use a documented power, reset, or measurement-mode command.`);
      return false;
    }
    m.sleeping = false;
    m.initialized = true;
    m.registers[0] = command;
    m.readyAt = this.time + ([0x13, 0x23].includes(command) ? 16 : 120);
    return true;
  }
  private powered(c: CircuitComponent) { return this.wiring.powered(c); }
  private rtcDate(c: CircuitComponent, m: DeviceMemory): Date {
    if (m.rtcEpochSeconds !== undefined && m.rtcSetAtMs !== undefined) {
      return new Date(m.rtcEpochSeconds * 1000 + Math.max(0, this.time - m.rtcSetAtMs));
    }
    return new Date(Date.UTC(
      clamp(Math.trunc(numeric(c, "startYear", 2026)), 2000, 2199),
      clamp(Math.trunc(numeric(c, "startMonth", 1)), 1, 12) - 1,
      clamp(Math.trunc(numeric(c, "startDay", 1)), 1, 31),
      clamp(Math.trunc(numeric(c, "startHour", 12)), 0, 23),
      clamp(Math.trunc(numeric(c, "startMinute", 0)), 0, 59),
      clamp(Math.trunc(numeric(c, "startSecond", 0)), 0, 59),
    ) + Math.max(0, this.time));
  }
  private rtcRegister(c: CircuitComponent, m: DeviceMemory, register: number): number {
    const date = this.rtcDate(c, m);
    switch (register) {
      case 0: return toBcd(date.getUTCSeconds());
      case 1: return toBcd(date.getUTCMinutes());
      case 2: return toBcd(date.getUTCHours());
      case 3: return toBcd(date.getUTCDay() + 1);
      case 4: return toBcd(date.getUTCDate());
      case 5: return toBcd((date.getUTCMonth() + 1) | (date.getUTCFullYear() >= 2100 ? 0x80 : 0));
      case 6: return toBcd(date.getUTCFullYear() % 100);
      case 0x0e: return m.registers[0x0e];
      case 0x0f: return m.registers[0x0f];
      default: return m.registers[register & 0xff];
    }
  }
  private setRtcRegister(c: CircuitComponent, m: DeviceMemory, register: number, value: number) {
    if (register >= 0x0e) { m.registers[register & 0xff] = value & 0xff; return; }
    if (register > 6) return;
    const date = this.rtcDate(c, m);
    const values = [date.getUTCSeconds(), date.getUTCMinutes(), date.getUTCHours(), date.getUTCDay() + 1, date.getUTCDate(), date.getUTCMonth() + 1, date.getUTCFullYear()];
    const raw = value & 0xff;
    const decoded = register === 2 && (raw & 0x40)
      ? (fromBcd(raw & 0x1f) % 12) + (raw & 0x20 ? 12 : 0)
      : fromBcd(raw & (register === 0 ? 0x7f : register === 2 ? 0x3f : register === 5 ? 0x1f : 0xff));
    const maximum = [59, 59, 23, 7, 31, 12, 99][register];
    if (!Number.isInteger(decoded) || decoded < (register === 3 || register === 4 || register === 5 ? 1 : 0) || decoded > maximum) {
      this.error("RTC_INVALID_DATETIME", `DS3231 register 0x${register.toString(16)} received an invalid BCD time/date value.`);
      return;
    }
    values[register] = decoded;
    const month = register === 5 ? decoded : values[5];
    const hasCenturyBit = register === 5 ? Boolean(raw & 0x80) : date.getUTCFullYear() >= 2100;
    const year = register === 6 ? 2000 + decoded + (hasCenturyBit ? 100 : 0) : register === 5 ? 2000 + (date.getUTCFullYear() % 100) + (hasCenturyBit ? 100 : 0) : values[6];
    const day = values[4];
    const normalizedMonth = month & 0x7f;
    const candidate = new Date(Date.UTC(year, normalizedMonth - 1, day, values[2], values[1], values[0]));
    if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== normalizedMonth - 1 || candidate.getUTCDate() !== day) {
      this.error("RTC_INVALID_DATETIME", "DS3231 date register writes describe a day that does not exist in the selected month.");
      return;
    }
    m.rtcEpochSeconds = Math.floor(candidate.getTime() / 1000);
    m.rtcSetAtMs = this.time;
  }
  private busPresent(c: CircuitComponent) {
    if (!this.powered(c)) return false;
    if (["mcp23017", "tca9548a"].includes(c.type) && !this.high(c, "RESET")) return false;
    if (c.type === "sht31-dis" && (!this.high(c, "nRESET") || this.wiring.voltage(c.id, "ADDR") === undefined)) return false;
    if (c.type === "bh1750-sen0097") return this.wiring.i2c(c, "SDA", "SCL", false);
    if (c.type === "ssd1306-oled-128x64") return this.wiring.i2c(c);
    if (["bme280", "bmp280"].includes(c.type)) return this.high(c, "CSB") && this.wiring.i2c(c, "SDI", "SCK");
    if (c.type === "ds3231-rtc") return this.wiring.i2c(c, "SDA", "SCL", false);
    return this.wiring.i2c(c);
  }
  private byAddress(address: number): CircuitComponent | undefined {
    const candidates = this.project.components.filter(c => ["bme280", "bmp280", "sht31-dis", "mpu-6050", "mcp23017", "tca9548a", "bq27441-g1", "bq76920", "bh1750-sen0097", "ssd1306-oled-128x64", "ds3231-rtc"].includes(c.type) && this.address(c) === address && this.busPresent(c));
    if (candidates.length > 1) { this.error("I2C_ADDRESS_CONFLICT", `Multiple connected devices respond at 0x${address.toString(16)}. Change address straps or isolate a mux channel.`); return undefined; }
    return candidates[0];
  }
  tick(timeMs: number, pins: readonly UnoPinState[], motorLoads: readonly MotorSupplyLoad[] = [], boardPins?: SimulatorSnapshot["boardPins"]) {
    this.time = timeMs;
    // A switch's own upstream connection is checked before publishing downstream bridges.
    this.powerResult = this.power.solve(this.project, timeMs, this.powerControls, this.charging, motorLoads);
    for (const diagnostic of this.powerResult.diagnostics) this.error(diagnostic.code, diagnostic.message);
    this.wiring = new DeviceWiring(this.project, pins, [], this.powerResult.voltage, boardPins, this.boardComponentId, this.boardId);
    this.bridges = [];
    for (const c of this.project.components.filter(c => c.type === "tca9548a")) {
      const m = this.m(c);
      if (!this.powered(c) || !this.high(c, "RESET")) m.registers[0] = 0;
      else for (let ch = 0; ch < 8; ch++) if (m.registers[0] & (1 << ch)) this.bridges.push({ componentId: c.id, from: "SDA", to: `SD${ch}` }, { componentId: c.id, from: "SCL", to: `SC${ch}` });
    }
    for (const c of this.project.components.filter(component => component.type === "keypad-4x4")) {
      const key = String(c.properties?.key ?? "").slice(0, 1);
      const map = this.values.get(`component:${c.id}.keymap`);
      const keymap = Array.isArray(map) ? map : [..."123A456B789C*0#D"].map(character => character.charCodeAt(0));
      const index = key ? keymap.indexOf(key.charCodeAt(0)) : -1;
      if (index >= 0) this.bridges.push({ componentId: c.id, from: `R${Math.floor(index / 4) + 1}`, to: `C${index % 4 + 1}` });
    }
    for (const c of this.project.components.filter(component => component.type === "relay-module-1ch-active-low")) {
      const inputVoltage = this.wiring.voltage(c.id, "IN");
      if (!this.powered(c) || inputVoltage === undefined) continue;
      this.bridges.push(inputVoltage < 0.8
        ? { componentId: c.id, from: "COM", to: "NO" }
        : { componentId: c.id, from: "COM", to: "NC" });
    }
    this.wiring = new DeviceWiring(this.project, pins, this.bridges, this.powerResult.voltage, boardPins, this.boardComponentId, this.boardId);
    this.oneWire.tick(this.project, this.wiring, timeMs);
    if (this.spiSelected) {
      const selected = this.project.components.find(c => c.id === this.spiSelected);
      if (!selected || !this.powered(selected) || this.wiring.voltage(selected.id, selected.type === "rfm95w" ? "NSS" : "CSB") !== 0) {
        this.spiAddress = undefined; this.spiSelected = undefined;
      }
    }
    this.drives = []; this.states = {};
    this.previousShift = new Map([...this.memory].map(([id, m]) => [id, m.shift]));
    for (const c of this.project.components.filter(c => STATEFUL_PARTS.includes(c.type))) {
      const m = this.m(c); const powered = c.type === "ds18b20" ? this.oneWire.powered(c) : this.powered(c);
      if (!powered) { m.initialized = false; m.rx = []; m.tx = []; }
      const readings: Record<string, number> = {};
      if (["bme280", "bmp280", "sht31-dis", "dht22", "ds18b20", "mpu-6050"].includes(c.type)) {
        readings.temperature = numeric(c, "temperature", 25);
        if (["bme280", "sht31-dis", "dht22"].includes(c.type)) readings.humidity = clamp(numeric(c, "humidity", 50), 0, 100);
        if (["bme280", "bmp280"].includes(c.type)) readings.pressure = numeric(c, "pressure", 101325);
        if (c.type === "mpu-6050") for (const [key, fallback] of Object.entries({ ax: 0, ay: 0, az: 9.80665, gx: 0, gy: 0, gz: 0 })) readings[key] = numeric(c, key, fallback);
      }
      if (c.type === "sht31-dis") {
        const model = this.sht(c);
        if (!powered || !this.high(c, "nRESET")) { model.reset(); m.initialized = false; }
        else { model.tick(timeMs, numeric(c, "temperature", 25), numeric(c, "humidity", 50)); this.drive(c, "ALERT", Number(!!(model.status & 0x8000))); }
        m.readyAt = model.readyAt; m.heater = model.heater;
      }
      if (c.type === "bh1750-sen0097") readings.lux = clamp(numeric(c, "lux", 500), 0, 65535);
      if (c.type === "ky-040") {
        const position = Math.trunc(numeric(c, "position", 0));
        const phase = ((position % 4) + 4) % 4;
        const clk = [0, 1, 1, 0][phase];
        const dt = [0, 0, 1, 1][phase];
        const pressed = c.properties?.pressed === true;
        const boardProfile = getBoardProfile(this.boardId);
        const connected = (pin: string) => boardProfile?.ioPins.some(candidate => candidate.runtimePin !== undefined && !candidate.reserved && (candidate.signals ?? ["digital"]).includes("digital") && this.wiring.boardConnected(c.id, pin, candidate.runtimePin)) ?? false;
        if (powered && connected("CLK")) this.drive(c, "CLK", clk);
        if (powered && connected("DT")) this.drive(c, "DT", dt);
        if (powered && connected("SW")) this.drive(c, "SW", Number(!pressed));
        Object.assign(readings, { position, phase, buttonPressed: Number(pressed), clk, dt });
      }
      if (c.type === "keypad-4x4") {
        const key = String(c.properties?.key ?? "").slice(0, 1);
        const map = this.values.get(`component:${c.id}.keymap`);
        const keymap = Array.isArray(map) ? map : [..."123A456B789C*0#D"].map(character => character.charCodeAt(0));
        const index = key ? keymap.indexOf(key.charCodeAt(0)) : -1;
        if (key && index >= 0) Object.assign(readings, { keyCode: key.charCodeAt(0), row: Math.floor(index / 4) + 1, column: index % 4 + 1, pressed: 1 });
        else Object.assign(readings, { pressed: 0 });
      }
      if (c.type === "relay-module-1ch-active-low") {
        const inputVoltage = this.wiring.voltage(c.id, "IN");
        const energized = powered && inputVoltage !== undefined && inputVoltage < 0.8;
        Object.assign(readings, { energized: Number(energized), inputVoltage: inputVoltage ?? -1 });
      }
      if (c.type === "ds3231-rtc") {
        const date = this.rtcDate(c, m);
        Object.assign(readings, {
          year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(),
          hour: date.getUTCHours(), minute: date.getUTCMinutes(), second: date.getUTCSeconds(),
        });
      }
      if (c.type === "micro-sd-spi-module") {
        const files = this.sdCards.get(c.id) ?? new Map<string, number[]>();
        readings.cardPresent = Number(c.properties?.cardPresent !== false);
        readings.files = files.size;
        readings.storedBytes = [...files.values()].reduce((total, file) => total + file.length, 0);
        readings.capacityMiB = numeric(c, "capacityMiB", 32);
        this.drive(c, "CD", Number(c.properties?.cardPresent !== false));
      }
      if (c.type === "mfrc522-rfid-module") {
        const uid = String(c.properties?.tagUid ?? "DEADBEEF").replace(/[^\da-f]/gi, "").toUpperCase();
        const validUid = [8, 14, 20].includes(uid.length) && /^[\da-f]+$/i.test(uid);
        readings.tagPresent = Number(c.properties?.tagPresent === true && validUid);
        readings.uidLength = validUid ? uid.length / 2 : 0;
        if (validUid) readings.uidFirstByte = Number.parseInt(uid.slice(0, 2), 16);
      }
      if (c.type === "ssd1306-oled-128x64") Object.assign(readings, { width: 128, height: 64, lines: 8 });
      if (c.type === "ws2812b-strip-8") Object.assign(readings, { pixelCount: 8, litPixels: m.pixels.filter(pixel => pixel.r || pixel.g || pixel.b).length });
      if (c.type === "74hc595") this.shiftRegister(c, m, powered);
      if (c.type === "mcp23017") this.expander(c, m, powered);
      if (c.type === "mpu-6050" && powered && !m.sleeping && (m.registers[0x38] & 1)) this.drive(c, "INT", this.time >= m.readyAt ? 1 : 0);
      const readyForReading = c.type !== "bh1750-sen0097" || (m.initialized && timeMs >= m.readyAt);
      const display = c.type === "ssd1306-oled-128x64";
      const pixelStrip = c.type === "ws2812b-strip-8";
      const pixelPin = pixelStrip ? Number(this.values.get(`component:${c.id}.dataPin`) ?? -1) : -1;
      const dataConnected = pixelStrip && pixelPin >= 0 && this.wiring.boardConnected(c.id, "DIN", pixelPin);
      const encoder = c.type === "ky-040";
      const encoderPinsPresent = encoder && ["CLK", "DT"].every(pin => this.wiring.wired(c.id, pin));
      const keypad = c.type === "keypad-4x4";
      const keypadWired = keypad && [...Array(4)].every((_, index) => this.wiring.wired(c.id, `R${index + 1}`) && this.wiring.wired(c.id, `C${index + 1}`));
      const statePowered = keypad ? Boolean(keypadWired) : powered;
      const keyName = keypad ? String(c.properties?.key ?? "").slice(0, 1) : "";
      const relay = c.type === "relay-module-1ch-active-low";
      const relayInput = relay ? this.wiring.voltage(c.id, "IN") : undefined;
      const rtc = c.type === "ds3231-rtc";
      const sd = c.type === "micro-sd-spi-module";
      const cardPresent = c.properties?.cardPresent !== false;
      const sdConnected = sd && this.wiring.spi(c, Number(m.registers[0]), { mosi: "DI", miso: "DO", sck: "CLK", cs: "CS" });
      const rfid = c.type === "mfrc522-rfid-module";
      const tagUid = String(c.properties?.tagUid ?? "DEADBEEF").replace(/[^\da-f]/gi, "").toUpperCase();
      const tagPresent = c.properties?.tagPresent === true && [8, 14, 20].includes(tagUid.length);
      const rfidSsp = Number(m.registers[0x30]);
      const rfidReset = Number(m.registers[0x31]);
      const rfidConnected = rfid && Number.isFinite(rfidSsp) && Number.isFinite(rfidReset) && rfidSsp !== rfidReset
        && this.wiring.spi(c, rfidSsp, { mosi: "MOSI", miso: "MISO", sck: "SCK", cs: "NSS" })
        && this.wiring.boardConnected(c.id, "RST", rfidReset)
        && (this.wiring.voltage(c.id, "RST") === undefined || this.wiring.voltage(c.id, "RST")! >= 2);
      const rfidStatus = !rfidConnected ? "SPI disconnected" : tagPresent
        ? m.initialized ? `Tag ${tagUid}` : "Tag present · initialize reader"
        : "Ready · no tag";
      const rtcConnected = rtc && this.busPresent(c);
      this.states[c.id] = { type: c.type, powered: statePowered, readings: statePowered && powered && !m.sleeping && readyForReading && (!rtc || rtcConnected) && (!sd || cardPresent && sdConnected) && (!rfid || rfidConnected) ? readings : {}, status: !powered ? "Unpowered" : rtc ? rtcConnected ? "Running" : "I2C disconnected" : sd ? !cardPresent ? "No card" : !sdConnected ? "SPI disconnected" : this.sdMounted === c.id ? "Mounted" : "Ready" : rfid ? rfidStatus : encoder ? !encoderPinsPresent ? "Connect CLK and DT" : `Position ${numeric(c, "position", 0)}` : keypad ? !keypadWired ? "Wire all row and column pins" : keyName ? `Key ${keyName} pressed` : "Ready" : relay ? relayInput === undefined ? "Control floating" : relayInput < 0.8 ? "Energized · COM–NO" : "Released · COM–NC" : m.sleeping ? "Sleeping" : m.readyAt > timeMs ? "Measuring" : c.type === "bh1750-sen0097" && !m.initialized ? "Standby" : display ? !m.initialized ? "Standby" : m.displayOn ? "Displaying" : "Ready" : pixelStrip ? !m.initialized ? "Ready" : !dataConnected ? "Data disconnected" : m.pixels.some(pixel => pixel.r || pixel.g || pixel.b) ? "Displaying" : "Ready" : m.initialized ? "Ready" : "Powered", packets: m.packets.map(p => ({ ...p })), ...(display ? { display: powered && m.initialized && m.displayOn ? [...m.displayText] : [] } : {}), ...(pixelStrip ? { pixels: powered && m.initialized && dataConnected ? m.pixels.map(pixel => ({ ...pixel })) : m.pixels.map(() => ({ r: 0, g: 0, b: 0 })) } : {}) };
    }
    this.stepperDrivers();
    for (const c of this.project.components.filter(c => c.type === "rfm95w")) {
      const model = this.lora(c), powered = this.powered(c);
      if (!powered || this.wiring.voltage(c.id, "RESET") === 0) model.reset();
      else model.tick(timeMs);
      this.states[c.id] = { type: c.type, powered, status: !powered ? "Unpowered" : model.sleeping ? "Sleeping" : model.mode === 3 ? "Transmitting" : model.receiving ? "Receiving" : "Standby", packets: model.packets.map(p => ({ ...p })), readings: { frequency: model.frequency, spreading: model.spreading, bandwidth: model.bandwidth } };
      if (powered) this.drive(c, "DIO0", Number(model.rxDone || model.txDone));
    }
    for (const c of this.project.components.filter(c => c.type === "xbee-s2c-zigbee-th")) {
      const model = this.xbee(c), powered = this.powered(c) && this.high(c, "RESET"), awake = !this.high(c, "DIO8");
      model.tick(c, timeMs, powered, awake);
      this.states[c.id] = { type: c.type, powered, status: !powered ? "Unpowered or held in reset" : !awake ? "Sleeping" : model.associated ? "Associated" : "Joining Zigbee network", packets: model.packets.map(p => ({ ...p })), ...(model.error ? { fault: model.error } : {}) };
    }
    this.powerDevices();
    Object.assign(this.states, this.powerResult.states);
    // A grounded DC source also supplies the normalized motor/logic network.
    // Floating, disabled and conflicting sources must not create a HIGH rail.
    for (const c of this.project.components.filter(c => c.type === "dc-supply" || c.type === "battery-cell")) {
      const positive = this.powerResult.voltage(c.id, "+");
      const negative = this.powerResult.voltage(c.id, "-");
      if (this.powerResult.states[c.id]?.powered && negative !== undefined && Math.abs(negative) < 1e-6 && positive !== undefined && positive > 0) this.drive(c, "+", 1);
    }
    if (this.boardComponentId && this.boardId.startsWith("esp")) {
      const board = this.project.components.find(component => component.id === this.boardComponentId);
      if (board) this.states[board.id] = {
        type: board.type, powered: true,
        status: !this.wifiConnected ? "Wi-Fi disconnected" : this.virtualUdpPeerMatches() ? "Wi-Fi connected · UDP peer ready" : "Wi-Fi connected · UDP peer unavailable",
        readings: { wifiConnected: Number(this.wifiConnected), udpPeerEnabled: Number(board.properties?.udpPeerEnabled !== false) },
        packets: this.udpPackets.slice(-50),
      };
    }
  }
  private drive(c: CircuitComponent, pin: string, value: number, weak = false) { this.drives.push({ componentId: c.id, pin, value, weak }); }
  private shiftRegister(c: CircuitComponent, m: DeviceMemory, powered: boolean) {
    if (!powered) { m.shift = 0; m.latch = 0; m.clock = false; m.latchClock = false; return; }
    const clock = this.high(c, "SHCP"); const latch = this.high(c, "STCP");
    if (!this.high(c, "MR")) m.shift = 0;
    else if (clock && !m.clock) {
      let data = this.high(c, "DS");
      for (const previous of this.project.components.filter(p => p.type === "74hc595" && p.id !== c.id)) if (this.wiring.connected(c.id, "DS", previous.id, "Q7S")) data = !!((this.previousShift.get(previous.id) ?? 0) & 128);
      m.shift = ((m.shift << 1) | Number(data)) & 255;
    }
    if (latch && !m.latchClock) m.latch = m.shift;
    m.clock = clock; m.latchClock = latch;
    this.drive(c, "Q7S", (m.shift >> 7) & 1);
    if (this.wiring.voltage(c.id, "OE") === 0) for (let i = 0; i < 8; i++) this.drive(c, `Q${i}`, (m.latch >> i) & 1);
  }
  private stepperDrivers() {
    const drivers = this.project.components.filter(component => component.type === "a4988-stepper-driver");
    const motors = this.project.components.filter(component => component.type === "bipolar-stepper-motor");
    const motorWires = (driver: CircuitComponent, motor: CircuitComponent) => ["1A", "1B", "2A", "2B"].every(pin => this.wiring.connected(driver.id, pin, motor.id, pin));
    for (const driver of drivers) {
      const m = this.m(driver), powered = this.powered(driver);
      const controls = ["STEP", "DIR", "EN", "RST", "SLP"];
      const connected = (pin: string) => getBoardProfile(this.boardId)?.ioPins.some(candidate => candidate.runtimePin !== undefined && !candidate.reserved
        && (candidate.signals ?? ["digital"]).includes("digital") && this.wiring.boardConnected(driver.id, pin, candidate.runtimePin)) ?? false;
      const controlsConnected = controls.every(connected);
      const completeMotors = motors.filter(motor => motorWires(driver, motor));
      const motorHasExclusiveDriver = completeMotors.length === 1
        && drivers.filter(candidate => motorWires(candidate, completeMotors[0])).length === 1;
      const stepVoltage = this.wiring.voltage(driver.id, "STEP");
      const dirVoltage = this.wiring.voltage(driver.id, "DIR");
      const enableVoltage = this.wiring.voltage(driver.id, "EN");
      const resetVoltage = this.wiring.voltage(driver.id, "RST");
      const sleepVoltage = this.wiring.voltage(driver.id, "SLP");
      if (!controlsConnected) this.error("A4988_CONTROL_DISCONNECTED", `${driver.label}: wire STEP, DIR, EN, RST, and SLP to supported digital pins on ${this.boardId}.`);
      if (motors.length && completeMotors.length !== 1) this.error("A4988_MOTOR_WIRING", `${driver.label}: connect its four outputs 1A/1B/2A/2B to exactly one bipolar stepper motor with matching coil labels.`);
      if (!powered && controlsConnected) this.error("A4988_SUPPLY", `${driver.label}: supply VDD (3–5.5 V), VMOT (8–35 V), and both ground pins before stepping.`);
      const high = (voltage: number | undefined) => voltage !== undefined && voltage >= 2;
      const awake = high(resetVoltage) && high(sleepVoltage);
      const enabled = powered && controlsConnected && awake && enableVoltage !== undefined && enableVoltage < 0.8 && completeMotors.length === 1 && motorHasExclusiveDriver;
      const stepHigh = high(stepVoltage);
      let microstep = 1;
      const selectors = ["MS1", "MS2", "MS3"].map(pin => high(this.wiring.voltage(driver.id, pin)));
      const selectorBits = Number(selectors[0]) * 4 + Number(selectors[1]) * 2 + Number(selectors[2]);
      microstep = ({ 0: 1, 4: 2, 2: 4, 6: 8, 7: 16 } as Record<number, number>)[selectorBits] ?? 1;
      const rising = stepHigh && !m.clock;
      if (rising && enabled && dirVoltage !== undefined) {
        const direction = high(dirVoltage) ? 1 : -1;
        const motor = completeMotors[0];
        this.m(motor).stepCount += direction;
        m.stepCount += direction;
        if (m.lastStepAt >= 0) m.stepIntervalMs = Math.max(1, this.time - m.lastStepAt);
        m.lastStepAt = this.time;
        m.registers[0x20] = microstep;
        m.registers[0x21] = direction > 0 ? 1 : 0;
      }
      m.clock = stepHigh;
      const recent = m.lastStepAt >= 0 && this.time - m.lastStepAt <= Math.max(100, m.stepIntervalMs * 3);
      const rpm = recent && m.stepIntervalMs > 0 ? 60000 / m.stepIntervalMs / Math.max(1, numeric(completeMotors[0] ?? driver, "stepsPerRevolution", 200) * microstep) : 0;
      const driverStatus = !powered ? "Unpowered" : !controlsConnected ? "Connect STEP/DIR/EN/RST/SLP" : !awake ? resetVoltage !== undefined && resetVoltage < 2 ? "Reset" : "Sleeping" : enableVoltage !== undefined && enableVoltage >= 0.8 ? "Disabled" : completeMotors.length !== 1 ? "Connect one bipolar stepper" : !motorHasExclusiveDriver ? "Driver output conflict" : recent ? `Running · ${rpm.toFixed(1)} RPM` : "Stopped";
      if (completeMotors.length === 1 && !motorHasExclusiveDriver) this.error("A4988_OUTPUT_CONTENTION", `${driver.label}: another stepper driver is connected to the same motor coils; connect each driver to its own motor.`);
      this.states[driver.id] = { type: driver.type, powered, status: driverStatus, readings: { steps: m.stepCount, microstep, stepIntervalMs: m.stepIntervalMs, rpm, enabled: Number(enabled) } };
    }
    for (const motor of motors) {
      const driver = drivers.find(candidate => motorWires(candidate, motor));
      const m = this.m(motor);
      const driverState = driver ? this.states[driver.id] : undefined;
      const driverMemory = driver ? this.m(driver) : undefined;
      const powered = Boolean(driverState?.powered);
      if (!driver) {
        this.states[motor.id] = { type: motor.type, powered: false, status: "Connect all four coil wires", readings: { steps: m.stepCount, angleDegrees: 0, rpm: 0 } };
        continue;
      }
      const microstep = Number(driverState?.readings?.microstep ?? 1);
      const stepsPerRevolution = Math.max(1, numeric(motor, "stepsPerRevolution", 200) * microstep);
      const angle = ((m.stepCount / stepsPerRevolution * 360) % 360 + 360) % 360;
      const direction = m.stepCount === 0 ? "stopped" : Number(driverMemory?.registers[0x21]) ? "forward" : "reverse";
      const rpm = Number(driverState?.readings?.rpm ?? 0);
      this.states[motor.id] = { type: motor.type, powered, status: !powered ? "Unpowered" : rpm > 0 ? `${direction === "forward" ? "Forward" : "Reverse"} · ${rpm.toFixed(1)} RPM` : "Stopped", direction, speed: rpm > 0 ? Math.min(1, rpm / 300) : 0, readings: { steps: m.stepCount, angleDegrees: Number(angle.toFixed(2)), rpm, microstep } };
    }
  }
  private expander(c: CircuitComponent, m: DeviceMemory, powered: boolean) {
    if (!powered || !this.high(c, "RESET")) { m.registers.fill(0); m.registers[0] = 255; m.registers[1] = 255; m.lastInterrupt = 255; return; }
    let inputs = 0;
    for (let pin = 0; pin < 16; pin++) {
      const bank = pin >> 3; const bit = 1 << (pin & 7); const name = `GP${bank ? "B" : "A"}${pin & 7}`;
      if (!(m.registers[bank] & bit)) this.drive(c, name, Number(!!(m.registers[0x14 + bank] & bit)));
      else {
        const voltage = this.wiring.voltage(c.id, name);
        const high = voltage === undefined ? !!(m.registers[0x0c + bank] & bit) : voltage > 2;
        if (high) inputs |= 1 << pin;
        if (m.registers[0x0c + bank] & bit) this.drive(c, name, 1, true);
      }
    }
    for (let bank = 0; bank < 2; bank++) {
      const shift = bank * 8, mask = m.registers[bank], now = (inputs >> shift) & 255;
      const compare = m.registers[8 + bank], defaults = m.registers[6 + bank];
      const changed = ((now ^ (m.previousInputs >> shift)) & ~compare) | ((now ^ defaults) & compare);
      const pending = changed & m.registers[4 + bank] & mask;
      if (pending && !m.registers[0x0e + bank]) m.registers[0x10 + bank] = now;
      m.registers[0x0e + bank] |= pending;
      m.registers[0x12 + bank] = ((now & mask) | (m.registers[0x14 + bank] & ~mask)) ^ m.registers[2 + bank];
    }
    m.previousInputs = inputs;
    const interrupts = m.registers[0x0e] | m.registers[0x0f] << 8;
    m.lastInterrupt = interrupts ? Math.log2(interrupts & -interrupts) : 255;
    m.captured = m.registers[0x10] | m.registers[0x11] << 8;
    for (let bank = 0; bank < 2; bank++) {
      const active = !!(m.registers[0x0a] & 64 ? interrupts : m.registers[0x0e + bank]);
      const openDrain = !!(m.registers[0x0a] & 4), highPolarity = !!(m.registers[0x0a] & 2);
      if (!openDrain || active) this.drive(c, bank ? "INTB" : "INTA", openDrain ? 0 : Number(active === highPolarity));
    }
  }

  private readRegister(c: CircuitComponent, register: number): number {
    const m = this.m(c); const v = (property: string, fallback: number) => numeric(c, property, fallback);
    if (c.type === "ds3231-rtc") return this.rtcRegister(c, m, register);
    if (c.type === "bq27441-g1") return this.gauge(c).read(register);
    if (c.type === "tca9548a") return m.registers[0];
    if (["bme280", "bmp280"].includes(c.type)) {
      if (register === 0xd0) return c.type === "bme280" ? 0x60 : 0x58;
      if (register === 0xf3) return this.time < m.readyAt ? 8 : 0;
      const result = boschMeasurementRegister(register, v("temperature", 25), v("pressure", 101325), v("humidity", 50), c.type === "bme280");
      if (result !== undefined) return result;
    }
    if (c.type === "mpu-6050") {
      if (register === 0x75) return 0x68;
      if (register === 0x3a) return !m.sleeping && this.time >= m.readyAt ? 1 : 0;
      const offset = register - 0x3b;
      if (offset >= 0 && offset < 14) {
        const raw = [v("ax", 0) / 9.80665 * 16384 / (1 << ((m.registers[0x1c] >> 3) & 3)), v("ay", 0) / 9.80665 * 16384 / (1 << ((m.registers[0x1c] >> 3) & 3)), v("az", 9.80665) / 9.80665 * 16384 / (1 << ((m.registers[0x1c] >> 3) & 3)), (v("temperature", 25) - 36.53) * 340, v("gx", 0) * 180 / Math.PI * 131 / (1 << ((m.registers[0x1b] >> 3) & 3)), v("gy", 0) * 180 / Math.PI * 131 / (1 << ((m.registers[0x1b] >> 3) & 3)), v("gz", 0) * 180 / Math.PI * 131 / (1 << ((m.registers[0x1b] >> 3) & 3))][offset >> 1];
        return (clamp(Math.round(raw), -32768, 32767) >> (offset % 2 ? 0 : 8)) & 255;
      }
    }
    if (c.type === "rfm95w") return this.lora(c).read(register);
    const result = m.registers[register & 255];
    if (c.type === "mcp23017" && [0x10, 0x11, 0x12, 0x13].includes(register)) this.clearGpioInterrupt(m, register & 1);
    return result;
  }
  private writeRegister(c: CircuitComponent, register: number, value: number) {
    if (c.type === "ds3231-rtc") { this.setRtcRegister(c, this.m(c), register, value); return; }
    if (c.type === "bq27441-g1") { this.gauge(c).write(register, value); return; }
    if (c.type === "rfm95w") { this.lora(c).write(register, value, c, this.time); return; }
    const m = this.m(c); m.registers[register & 255] = value & 255;
    if (c.type === "tca9548a") m.registers[0] = value & 255;
    if (c.type === "mpu-6050" && register === 0x6b) { m.sleeping = !!(value & 64); if (value & 128) this.memory.set(c.id, memory()); }
    if (["bme280", "bmp280"].includes(c.type) && register === 0xf4) { m.sleeping = !(value & 3); m.readyAt = this.time + 10; }
    if (c.type === "mcp23017" && (register === 0x12 || register === 0x13)) m.registers[register + 2] = value & 255;
  }
  setI2cPeers(peers: readonly I2cPeerEndpoint[]) { this.i2cPeers = peers; }
  getI2cPeripheralAddress() { return this.wirePeripheralAddress; }
  isI2cRequestHandlerRegistered() { return this.wireOnRequest; }
  isI2cReceiveHandlerRegistered() { return this.wireOnReceive; }
  reportI2cError(code: string, message: string) { this.error(code, message); }
  receiveI2c(data: readonly number[]) { this.wirePeripheralRx.push(...data); this.wirePeripheralRx = this.wirePeripheralRx.slice(-4096); return this.wirePeripheralAddress !== undefined; }
  beginI2cRequest() { this.wirePeripheralTx = []; }
  endI2cRequest() { const data = this.wirePeripheralTx; this.wirePeripheralTx = []; return data; }
  private constructorArgs(name: string, evaluate: (text: string) => DeviceValue): DeviceValue[] {
    let args = this.constructors.get(name);
    if (!args) {
      const instance = this.instances.get(name);
      args = instance?.args.map(text => {
        if (instance.api.type === "Keypad") {
          const keymap = /^makeKeymap\s*\(\s*([A-Za-z_]\w*)\s*\)$/.exec(text);
          if (keymap) return this.values.get(keymap[1]) ?? [];
          if (this.values.has(text.trim())) return this.values.get(text.trim())!;
        }
        return evaluate(text);
      }) ?? [];
      this.constructors.set(name, args);
    }
    return args;
  }
  private resolve(name: string, args: DeviceValue[], evaluate: (text: string) => DeviceValue, initialize = false): CircuitComponent | undefined {
    const instance = this.instances.get(name); if (!instance?.api.component) return undefined;
    const ctor = this.constructorArgs(name, evaluate); const type = instance.api.component;
    if (["dht22", "ds18b20"].includes(type)) {
      let dataPin = Number(ctor[0]);
      if (instance.api.type === "DallasTemperature") dataPin = Number(this.constructorArgs(String(ctor[0]).replace(/^&/, ""), evaluate)[0]);
      const candidates = this.project.components.filter(c => c.type === type && this.wiring.boardConnected(c.id, type === "dht22" ? "DATA" : "DQ", dataPin) && this.wiring.pullup(c.id, type === "dht22" ? "DATA" : "DQ") && this.powered(c));
      const c = candidates[type === "ds18b20" ? Number(args[0] ?? 0) : 0];
      if (c && initialize) { this.m(c).initialized = true; this.bindings.set(name, c.id); }
      return c;
    }
    if (type === "ws2812b-strip-8") {
      const dataPin = Number(ctor[1] ?? -1);
      const profile = getBoardProfile(this.boardId);
      const pinSupported = profile?.ioPins.some(pin => pin.runtimePin === dataPin && !pin.reserved && (pin.signals ?? ["digital"]).includes("digital")) ?? false;
      const strips = this.project.components.filter(component => component.type === type && this.powered(component) && this.wiring.boardConnected(component.id, "DIN", dataPin));
      const c = strips.length === 1 && pinSupported ? strips[0] : undefined;
      if (!c && initialize) this.error("NEOPIXEL_NOT_CONNECTED", `${name}.begin(): connect one powered WS2812B DIN to a supported digital output on ${this.boardId}; the configured pin must match the sketch.`);
      if (c && initialize) {
        const vdd = this.wiring.voltage(c.id, "VDD") ?? 5;
        const requiredHigh = 0.7 * vdd;
        const boardVoltage = profile?.logicVoltage ?? 0;
        if (boardVoltage + 1e-6 < requiredHigh) {
          this.error("NEOPIXEL_LOGIC_LEVEL", `${name}.begin(): ${this.boardId} provides ${boardVoltage}V logic, below the WS2812B ${requiredHigh.toFixed(2)}V DIN high threshold at ${vdd}V strip supply. Use a compatible supply or level shifter.`);
          return undefined;
        }
        this.values.set(`component:${c.id}.dataPin`, dataPin);
        this.bindings.set(name, c.id);
      }
      return c;
    }
    if (type === "ky-040") {
      const clockPin = Number(ctor[0] ?? -1), dataPin = Number(ctor[1] ?? -1);
      const profile = getBoardProfile(this.boardId);
      const supported = (pin: number) => profile?.ioPins.some(candidate => candidate.runtimePin === pin && !candidate.reserved && (candidate.signals ?? ["digital"]).includes("digital")) ?? false;
      const c = this.project.components.find(component => component.type === type && this.powered(component)
        && this.wiring.boardConnected(component.id, "CLK", clockPin) && this.wiring.boardConnected(component.id, "DT", dataPin));
      if (!c || clockPin === dataPin || !supported(clockPin) || !supported(dataPin)) {
        this.error("ENCODER_NOT_CONNECTED", `${name}: connect a powered KY-040 CLK and DT to two distinct supported digital inputs on ${this.boardId}; check 5V and ground.`);
        return undefined;
      }
      this.bindings.set(name, c.id);
      return c;
    }
    if (type === "keypad-4x4") {
      const [rawKeymap, rawRows, rawColumns, rowCount, columnCount] = ctor;
      const keymap = Array.isArray(rawKeymap) ? rawKeymap : [];
      const rows = Array.isArray(rawRows) ? rawRows.map(Number) : [];
      const columns = Array.isArray(rawColumns) ? rawColumns.map(Number) : [];
      const profile = getBoardProfile(this.boardId);
      const supported = (pin: number) => profile?.ioPins.some(candidate => candidate.runtimePin === pin && !candidate.reserved && (candidate.signals ?? ["digital"]).includes("digital")) ?? false;
      const c = this.project.components.find(component => component.type === type && Number(rowCount) === 4 && Number(columnCount) === 4
        && keymap.length >= 16 && rows.length === 4 && columns.length === 4
        && rows.every((pin, index) => supported(pin) && this.wiring.boardConnected(component.id, `R${index + 1}`, pin))
        && columns.every((pin, index) => supported(pin) && this.wiring.boardConnected(component.id, `C${index + 1}`, pin)));
      if (!c) {
        this.error("KEYPAD_NOT_CONNECTED", `${name}: connect all four keypad rows and columns to distinct supported digital pins on ${this.boardId}; use a 4×4 keymap and pin arrays.`);
        return undefined;
      }
      this.values.set(`component:${c.id}.keymap`, keymap.slice(0, 16));
      this.values.set(`component:${c.id}.rowPins`, rows);
      this.values.set(`component:${c.id}.columnPins`, columns);
      this.bindings.set(name, c.id);
      return c;
    }
    if (type === "mfrc522-rfid-module") {
      const [ssPin, resetPin] = ctor.map(Number);
      const profile = getBoardProfile(this.boardId);
      const supports = (pin: number) => profile?.ioPins.some(candidate => candidate.runtimePin === pin && !candidate.reserved && (candidate.signals ?? ["digital"]).includes("digital")) ?? false;
      const c = this.project.components.find(component => component.type === type && this.powered(component)
        && supports(ssPin) && supports(resetPin) && ssPin !== resetPin
        && this.wiring.spi(component, ssPin, { mosi: "MOSI", miso: "MISO", sck: "SCK", cs: "NSS" })
        && this.wiring.boardConnected(component.id, "RST", resetPin)
        && (this.wiring.voltage(component.id, "RST") === undefined || this.wiring.voltage(component.id, "RST")! >= 2));
      if (c && initialize) {
        this.bindings.set(name, c.id);
        const memory = this.m(c);
        memory.registers[0x30] = ssPin;
        memory.registers[0x31] = resetPin;
      }
      return c;
    }
    if (type === "rfm95w") {
      const c = this.project.components.find(c => c.type === type && this.powered(c) && this.wiring.spi(c, this.radioPins[0]) && this.wiring.boardConnected(c.id, "RESET", this.radioPins[1]) && this.wiring.boardConnected(c.id, "DIO0", this.radioPins[2]));
      if (c && initialize) this.bindings.set(name, c.id); return c;
    }
    if (type === "xbee-s2c-zigbee-th") {
      const serialName = String(this.values.get(`${name}.serial`) ?? "Serial"); const serialArgs = this.constructorArgs(serialName, evaluate);
      const rx = Number(serialArgs[0] ?? 0), tx = Number(serialArgs[1] ?? 1);
      return this.project.components.find(c => c.type === type && this.powered(c) && this.wiring.boardConnected(c.id, "DOUT", rx) && this.wiring.boardConnected(c.id, "DIN", tx) && this.high(c, "RESET") && !this.high(c, "DIO8"));
    }
    if (["bme280", "bmp280"].includes(type) && ctor.length) {
      const c = this.project.components.find(c => c.type === type && this.powered(c) && this.wiring.spi(c, Number(ctor[0]), { mosi: "SDI", miso: "SDO", sck: "SCK", cs: "CSB" }));
      if (c && initialize) this.bindings.set(name, c.id); return c;
    }
    const defaults: Record<string, number> = { bme280: 0x77, bmp280: 0x77, "sht31-dis": 0x44, "mpu-6050": 0x68, mcp23017: 0x20, tca9548a: Number(ctor[0] ?? 0x70), "bq27441-g1": 0x55, bq76920: Number(ctor[1] ?? 0x08), "bh1750-sen0097": Number(ctor[0] ?? 0x23), "ssd1306-oled-128x64": 0x3c };
    const bound = this.project.components.find(c => c.id === this.bindings.get(name));
    const address = ["bh1750-sen0097", "ssd1306-oled-128x64"].includes(type)
      ? initialize ? Number(args[1] ?? defaults[type]) : Number(this.values.get(`${name}.address`) ?? defaults[type])
      : initialize ? Number(type === "bq76920" ? defaults[type] : args[0] ?? defaults[type]) : bound ? Number(this.values.get(`${name}.address`) ?? defaults[type]) : defaults[type];
    const c = this.byAddress(address);
    if (c?.type !== type) return undefined;
    if (initialize) { this.bindings.set(name, c.id); this.values.set(`${name}.address`, address); }
    return c;
  }
  invoke(name: string, method: string, args: DeviceValue[], evaluate: (text: string) => DeviceValue): DeviceValue {
    if (this.instances.get(name)?.api.type === "SDClass") return this.sdCall(method, args, name);
    if (this.instances.get(name)?.api.type === "File") return this.sdFileCall(name, method, args);
    if (this.instances.get(name)?.api.type === "MFRC522") return this.mfrc522Call(name, method, args, evaluate);
    if (name === "Wire") return this.wire(method, args);
    if (name === "SPI") return this.spi(method, args);
    if (this.instances.get(name)?.api.type === "HardwareSerial") return this.hardwareSerial(name, method, args);
    if (this.instances.get(name)?.api.header === "Encoder.h") {
      const c = this.resolve(name, args, evaluate);
      if (!c) return method === "write" ? 0 : NaN;
      const position = Math.trunc(numeric(c, "position", 0));
      const offsetKey = `${name}.offset`;
      const offset = Number(this.values.get(offsetKey) ?? 0);
      if (method === "read") return position - offset;
      if (method === "write") { this.values.set(offsetKey, position - Math.trunc(Number(args[0]))); return 0; }
      if (method === "readAndReset") { const result = position - offset; this.values.set(offsetKey, position); return result; }
      this.error("DEVICE_METHOD_UNIMPLEMENTED", `${name}.${method}() is outside the supported Encoder.h adapter.`);
      return NaN;
    }
    if (this.instances.get(name)?.api.header === "Keypad.h") {
      const c = this.resolve(name, args, evaluate);
      if (!c) return method === "getKey" || method === "getState" ? 0 : 0;
      const selected = String(c.properties?.key ?? "").slice(0, 1);
      const current = selected ? selected.charCodeAt(0) : 0;
      const keymap = this.values.get(`component:${c.id}.keymap`);
      const exists = Array.isArray(keymap) && keymap.includes(current);
      if (method === "isPressed") return Number(exists && current === Number(args[0]));
      if (method === "getState") return exists ? 1 : 0;
      if (method === "getKey") {
        const last = Number(this.values.get(`${name}.lastKey`) ?? 0);
        this.values.set(`${name}.lastKey`, exists ? current : 0);
        return exists && current !== last ? current : 0;
      }
      this.error("DEVICE_METHOD_UNIMPLEMENTED", `${name}.${method}() is outside the supported Keypad.h adapter.`);
      return 0;
    }
    if (this.instances.get(name)?.api.type === "Adafruit_NeoPixel") {
      if (method === "Color") {
        const [r, g, b] = args.map(value => clamp(Number(value), 0, 255));
        return ((r << 16) | (g << 8) | b) >>> 0;
      }
      const initialized = method === "begin";
      const c = this.resolve(name, args, evaluate, initialized);
      if (!c) {
        if (!initialized) this.error("NEOPIXEL_NOT_CONNECTED", `${name}.${method}(): no powered, correctly wired WS2812B strip responds on its configured digital pin.`);
        return method === "numPixels" ? 0 : method === "getPixelColor" ? 0 : 0;
      }
      const m = this.m(c);
      if (method === "begin") { m.initialized = true; return 1; }
      if (!m.initialized) { this.error("DEVICE_NOT_INITIALIZED", `${name}: call begin() before ${method}().`); return 0; }
      if (method === "numPixels") return m.pixelBuffer.length;
      if (method === "setBrightness") { m.brightness = clamp(Number(args[0]), 0, 255); return 0; }
      if (method === "clear") { m.pixelBuffer = m.pixelBuffer.map(() => ({ r: 0, g: 0, b: 0 })); return 0; }
      if (method === "getPixelColor") {
        const pixel = m.pixelBuffer[Math.trunc(Number(args[0]))];
        return pixel ? ((pixel.r << 16) | (pixel.g << 8) | pixel.b) >>> 0 : 0;
      }
      if (method === "setPixelColor") {
        const index = Math.trunc(Number(args[0]));
        if (index < 0 || index >= m.pixelBuffer.length) { this.error("NEOPIXEL_INDEX", `${name}.setPixelColor(): pixel index ${index} is outside 0..${m.pixelBuffer.length - 1}.`); return 0; }
        const [r, g, b] = args.length === 4
          ? args.slice(1).map(value => clamp(Number(value), 0, 255))
          : [Number(args[1]) >> 16 & 255, Number(args[1]) >> 8 & 255, Number(args[1]) & 255];
        m.pixelBuffer[index] = { r, g, b };
        return 0;
      }
      if (method === "show") {
        const scale = m.brightness / 255;
        m.pixels = m.pixelBuffer.map(pixel => ({ r: Math.round(pixel.r * scale), g: Math.round(pixel.g * scale), b: Math.round(pixel.b * scale) }));
        return 0;
      }
    }
    if (name === "WiFi") return this.wifi(method, args);
    if (this.instances.get(name)?.api.type === "WiFiUDP") return this.udp(name, method, args);
    if (name === "LoRa" && method === "setPins") { this.radioPins = [Number(args[0]), Number(args[1] ?? 9), Number(args[2] ?? 2)]; return 0; }
    if (method === "setSerial") { this.values.set(`${name}.serial`, String(args[0])); return 0; }
    const instance = this.instances.get(name);
    if (instance?.api.header === "XBee.h" && instance.api.type !== "XBee") return this.xbeeObject(name, method, args, evaluate);
    if (instance?.api.component === "ds18b20") return this.temperatureBus(name, method, args, evaluate);
    if (instance?.api.type === "SoftwareSerial") return this.serial(name, method, args, evaluate);
    const initialize = ["begin", "begin_I2C"].includes(method);
    const c = this.resolve(name, args, evaluate, initialize);
    if (!c) {
      this.error("DEVICE_NOT_CONNECTED", `${name}.${method}: no powered, correctly wired device responds. Check data pins, address, reset, ground and pull-ups.`);
      return initialize ? instance?.api.component === "bq76920" ? 1 : 0 : instance?.api.component === "ds18b20" ? -127 : NaN;
    }
    const m = this.m(c);
    if (c.type === "xbee-s2c-zigbee-th") return this.xbeeCall(c, name, method, args, evaluate);
    if (c.type === "bh1750-sen0097") {
      if (initialize) {
        const ok = this.configureBh1750(c, Number(args[0] ?? 0x10));
        if (ok && m.initialized) this.pendingDelayMs = Math.max(this.pendingDelayMs, m.readyAt - this.time);
        return Number(ok);
      }
      if (method === "configure") return Number(this.configureBh1750(c, Number(args[0])));
      if (method === "setMTreg") {
        const mtreg = Number(args[0]);
        if (!Number.isInteger(mtreg) || mtreg < 31 || mtreg > 254) { this.error("BH1750_MTREG", "BH1750 MTreg must be an integer from 31 through 254."); return 0; }
        m.registers[1] = mtreg;
        return 1;
      }
      if (method === "measurementReady") {
        const remaining = Math.max(0, m.readyAt - this.time);
        if (args[0] && remaining) this.pendingDelayMs = Math.max(this.pendingDelayMs, remaining);
        return Number(!m.sleeping && m.initialized && remaining === 0);
      }
      if (method === "readLightLevel") {
        if (!m.initialized) { this.error("DEVICE_NOT_INITIALIZED", `${name}: call begin() before readLightLevel().`); return -2; }
        const mode = m.registers[0];
        if (m.sleeping && [0x20, 0x21, 0x23].includes(mode)) this.configureBh1750(c, mode);
        this.pendingDelayMs = Math.max(this.pendingDelayMs, Math.max(0, m.readyAt - this.time));
        const maxLux = [0x11, 0x21].includes(mode) ? 27306.25 : 54612.5;
        const precision = [0x13, 0x23].includes(mode) ? 4 : [0x11, 0x21].includes(mode) ? 0.5 : 1;
        const measured = Math.min(clamp(numeric(c, "lux", 500), 0, 65535), maxLux);
        if ([0x20, 0x21, 0x23].includes(mode)) m.sleeping = true;
        return Math.round(measured / precision) * precision;
      }
    }
    if (c.type === "ssd1306-oled-128x64") {
      if (initialize) {
        m.initialized = true; m.displayOn = false; m.cursorColumn = 0; m.cursorRow = 0;
        m.displayBuffer = Array(8).fill(""); m.displayText = Array(8).fill("");
        return 1;
      }
      const blank = () => { m.displayBuffer = Array(8).fill(""); m.cursorColumn = 0; m.cursorRow = 0; };
      if (method === "clearDisplay") { blank(); return 0; }
      if (method === "setCursor") {
        const size = Math.max(1, m.textSize);
        m.cursorColumn = clamp(Math.floor(Number(args[0]) / (6 * size)), 0, 20);
        m.cursorRow = clamp(Math.floor(Number(args[1]) / (8 * size)), 0, 7);
        return 0;
      }
      if (method === "setTextSize") { m.textSize = clamp(Math.trunc(Number(args[0])), 1, 4); return 0; }
      if (method === "setTextColor") return 0;
      if (method === "print" || method === "println") {
        let text = String(args[0] ?? "");
        if (typeof args[0] === "number" && args[1] !== undefined) {
          const base = Number(args[1]); if ([2, 8, 10, 16].includes(base)) text = Math.trunc(Number(args[0])).toString(base).toUpperCase();
        }
        const columns = Math.max(1, Math.floor(21 / m.textSize));
        for (const char of text) {
          if (char === "\n" || m.cursorColumn >= columns) { m.cursorColumn = 0; m.cursorRow = Math.min(7, m.cursorRow + 1); if (char === "\n") continue; }
          const line = [...(m.displayBuffer[m.cursorRow] ?? "").padEnd(columns, " ")];
          line[m.cursorColumn] = char; m.displayBuffer[m.cursorRow] = line.join("").slice(0, columns); m.cursorColumn++;
        }
        if (method === "println") { m.cursorColumn = 0; m.cursorRow = Math.min(7, m.cursorRow + 1); }
        return text.length;
      }
      if (method === "display") { m.displayText = [...m.displayBuffer]; m.displayOn = true; return 0; }
    }
    if (initialize) {
      if (c.type === "rfm95w" && !this.lora(c).begin(Number(args[0]), c, this.time)) return 0;
      if (this.states[c.id]?.fault) return c.type === "bq76920" ? 1 : 0;
      m.initialized = true; m.sleeping = false; m.readyAt = this.time; return c.type === "bq76920" ? 0 : 1;
    }
    const initialized = c.type === "rfm95w" ? this.lora(c).initialized : m.initialized;
    if (!initialized && instance?.api.type !== "OneWire") { this.error("DEVICE_NOT_INITIALIZED", `${name}: call its initialization method before ${method}.`); return NaN; }
    if (c.type === "bq27441-g1" || c.type === "bq76920") return this.powerCall(c, method, args);
    if (c.type === "rfm95w") return this.loraCall(c, method, args);
    if (c.type === "mcp23017") return this.gpio(c, method, args);
    if (c.type === "sht31-dis") {
      const model = this.sht(c);
      if (method === "reset") { model.reset(); this.pendingDelayMs = 1; return 0; }
      if (method === "heater") { model.write([0x30, args[0] ? 0x6d : 0x66], this.time); return 0; }
      if (method === "isHeaterEnabled") return Number(model.heater);
      if (method === "readStatus") return model.status;
      if (method === "readTemperature" || method === "readHumidity") {
        const sample = model.libraryMeasurement(this.time); this.pendingDelayMs = sample.delay;
        return method === "readTemperature" ? sample.temperature : sample.humidity;
      }
    }
    if (c.type === "tca9548a") {
      const channel = clamp(Number(args[0]), 0, 7);
      if (method === "setChannelMask") m.registers[0] = Number(args[0]) & 255;
      if (method === "selectChannel") m.registers[0] = 1 << channel;
      if (method === "enableChannel") m.registers[0] |= 1 << channel;
      if (method === "disableChannel") m.registers[0] &= ~(1 << channel);
      if (["closeAll", "reset"].includes(method)) m.registers[0] = 0;
      return method === "isEnabled" ? Number(!!(m.registers[0] & (1 << channel))) : method === "isConnected" ? 1 : m.registers[0];
    }
    if (method === "reset") { this.memory.set(c.id, memory()); return 1; }
    if (method === "sensorID") return c.type === "bme280" ? 0x60 : 0x58;
    if (method === "setSampling") { m.sleeping = Number(args[0] ?? 3) === 0; m.readyAt = this.time + 10; return 0; }
    if (method === "takeForcedMeasurement") { m.sleeping = false; m.readyAt = this.time + 10; return 1; }
    if (method === "heater") { m.heater = Boolean(args[0]); return 0; }
    if (method === "isHeaterEnabled") return Number(m.heater);
    if (method === "readStatus") return m.heater ? 0x2000 : 0;
    if (method === "enableSleep") { m.sleeping = Boolean(args[0]); return 0; }
    if (method === "enableDataReadyInterrupt") { m.registers[0x38] = Number(Boolean(args[0])); return 0; }
    const configs: Record<string, number> = { AccelerometerRange: 0x1c, GyroRange: 0x1b, FilterBandwidth: 0x1a };
    for (const [config, register] of Object.entries(configs)) {
      if (method === `set${config}`) { m.registers[register] = Number(args[0]) << (register === 0x1a ? 0 : 3); return 0; }
      if (method === `get${config}`) return m.registers[register] >> (register === 0x1a ? 0 : 3);
    }
    if (method === "getEvent") {
      const readings = this.states[c.id]?.readings ?? {};
      if (m.sleeping) return 0;
      const objects: DeviceValue[] = [{ acceleration: { x: readings.ax, y: readings.ay, z: readings.az } }, { gyro: { x: readings.gx, y: readings.gy, z: readings.gz } }, { temperature: readings.temperature }];
      args.forEach((arg, i) => this.assignOutput(arg, objects[i])); return 1;
    }
    if (c.type === "dht22" && ["readTemperature", "readHumidity", "read"].includes(method)) {
      const force = Boolean(args[method === "readTemperature" ? 1 : 0]);
      if (force && this.time - m.sampleAt < 2000) return method === "read" ? 0 : NaN;
      if (this.time - m.sampleAt >= 2000) {
        this.values.set(`${c.id}.readTemperature`, clamp(numeric(c, "temperature", 25), -40, 80));
        this.values.set(`${c.id}.readHumidity`, clamp(numeric(c, "humidity", 50), 0, 100));
        m.sampleAt = this.time;
      }
      if (method === "read") return 1;
      const value = Number(this.values.get(`${c.id}.${method}`));
      return method === "readTemperature" && args[0] ? value * 1.8 + 32 : value;
    }
    if (["readTemperature", "readHumidity", "readPressure"].includes(method)) {
      if (m.sleeping || this.time < m.readyAt) return NaN;
      const property = method === "readHumidity" ? "humidity" : method === "readPressure" ? "pressure" : "temperature";
      return numeric(c, property, property === "temperature" ? 25 : property === "humidity" ? 50 : 101325);
    }
    this.error("DEVICE_METHOD_UNIMPLEMENTED", `${name}.${method} is not implemented.`); return NaN;
  }
  private wire(method: string, args: DeviceValue[]): DeviceValue {
    if (method === "begin") { this.wirePeripheralAddress = Number(args[0] ?? 0) || undefined; this.wirePeripheralTx = []; this.wirePeripheralRx = []; return 0; }
    if (method === "onReceive") { this.wireOnReceive = true; return 0; }
    if (method === "onRequest") { this.wireOnRequest = true; return 0; }
    if (method === "beginTransmission") { this.wireAddress = Number(args[0]); this.wireTx = []; this.wireMasterTransmitting = true; return 0; }
    if (method === "write") {
      const data = bytes(args[0]).slice(0, args[1] === undefined ? undefined : Math.max(0, Math.trunc(Number(args[1]))));
      if (this.wirePeripheralAddress !== undefined && !this.wireMasterTransmitting) this.wirePeripheralTx.push(...data);
      else this.wireTx.push(...data);
      return data.length;
    }
    if (method === "endTransmission") {
      const c = this.byAddress(this.wireAddress);
      const peers = this.i2cPeers.filter(peer => peer.address() === this.wireAddress);
      this.wireMasterTransmitting = false;
      if (c && peers.length) { this.error("I2C_ADDRESS_CONFLICT", `Multiple wired I2C devices respond at 0x${this.wireAddress.toString(16)}.`); this.wireTx = []; return 2; }
      if (!c) {
        if (peers.length !== 1) {
          this.wireTx = [];
          if (peers.length > 1) this.error("I2C_ADDRESS_CONFLICT", `Multiple wired I2C peripherals respond at 0x${this.wireAddress.toString(16)}.`);
          else if (!this.i2cPeers.some(peer => peer.address() === undefined)) this.error("I2C_DEVICE_NOT_CONNECTED", `No wired I2C device responds at 0x${this.wireAddress.toString(16)}.`);
          return 2;
        }
        const accepted = peers[0].receive(this.wireTx);
        this.wireTx = [];
        if (!accepted) { this.error("I2C_PEER_UNAVAILABLE", `No running peripheral board responds at I2C address 0x${this.wireAddress.toString(16)}.`); return 2; }
        return 0;
      }
      const m = this.m(c);
      if (c.type === "sht31-dis") { const result = this.wireTx.length ? this.sht(c).write(this.wireTx, this.time) : 0; this.wireTx = []; return result; }
      if (c.type === "bh1750-sen0097") { const result = this.wireTx.length ? Number(this.configureBh1750(c, this.wireTx[0]) ? 0 : 3) : 0; this.wireTx = []; return result; }
      if (this.wireTx.length) {
        if (c.type === "tca9548a") this.writeRegister(c, 0, this.wireTx[0]);
        else { m.pointer = this.wireTx[0]; this.wireTx.slice(1).forEach((v, i) => this.writeRegister(c, m.pointer + i, v)); }
      }
      this.wireTx = [];
      return 0;
    }
    if (method === "requestFrom") {
      const address = Number(args[0]);
      const c = this.byAddress(address); this.wireRx = [];
      const peers = this.i2cPeers.filter(peer => peer.address() === address);
      if (peers.length) {
        if (c || peers.length !== 1) { this.error("I2C_ADDRESS_CONFLICT", `Multiple wired I2C devices respond at 0x${address.toString(16)}.`); return 0; }
        this.wireRx = [...peers[0].request(clamp(Number(args[1]), 0, 256))].slice(0, clamp(Number(args[1]), 0, 256));
        return this.wireRx.length;
      }
      if (!c) {
        if (!this.i2cPeers.some(peer => peer.address() === undefined)) this.error("I2C_DEVICE_NOT_CONNECTED", `No wired I2C device responds at 0x${address.toString(16)}.`);
        return 0;
      }
      const m = this.m(c);
      if (c.type === "sht31-dis") { this.wireRx = this.sht(c).read(clamp(Number(args[1]), 0, 256), this.time); return this.wireRx.length; }
      if (c.type === "bh1750-sen0097") {
        const mode = m.registers[0];
        if (m.initialized && !m.sleeping && this.time >= m.readyAt) {
          const maxLux = [0x11, 0x21].includes(mode) ? 27306.25 : 54612.5;
          const precision = [0x13, 0x23].includes(mode) ? 4 : [0x11, 0x21].includes(mode) ? 0.5 : 1;
          const lux = Math.round(Math.min(clamp(numeric(c, "lux", 500), 0, 65535), maxLux) / precision) * precision;
          const raw = clamp(Math.round(lux * 1.2), 0, 65535);
          this.wireRx = [(raw >> 8) & 255, raw & 255].slice(0, clamp(Number(args[1]), 0, 2));
          if ([0x20, 0x21, 0x23].includes(mode)) m.sleeping = true;
          else m.readyAt = this.time + ([0x13].includes(mode) ? 16 : 120);
        }
        return this.wireRx.length;
      }
      this.wireRx = Array.from({ length: clamp(Number(args[1]), 0, 256) }, () => this.readRegister(c, m.pointer++)); return this.wireRx.length;
    }
    if (method === "available") return this.wirePeripheralAddress !== undefined && !this.wireMasterTransmitting ? this.wirePeripheralRx.length : this.wireRx.length;
    if (method === "read") return (this.wirePeripheralAddress !== undefined && !this.wireMasterTransmitting ? this.wirePeripheralRx : this.wireRx).shift() ?? -1;
    return 0;
  }
  private spi(method: string, args: DeviceValue[]): DeviceValue {
    if (method === "beginTransaction" || method === "endTransaction") { this.spiAddress = undefined; return 0; }
    if (method !== "transfer") return 0;
    const selected = this.project.components.filter(c => ["rfm95w", "bme280", "bmp280"].includes(c.type) && this.powered(c) && this.wiring.voltage(c.id, c.type === "rfm95w" ? "NSS" : "CSB") === 0 && this.wiring.spi(c, undefined, c.type === "rfm95w" ? { mosi: "MOSI", miso: "MISO", sck: "SCK", cs: "NSS" } : { mosi: "SDI", miso: "SDO", sck: "SCK", cs: "CSB" }));
    if (selected.length !== 1) { this.spiAddress = undefined; this.spiSelected = undefined; this.error("SPI_SELECTION", "SPI transfer needs exactly one powered, wired device selected."); return 255; }
    const c = selected[0]; const value = Number(args[0]);
    if (this.spiSelected !== c.id) this.spiAddress = undefined;
    this.spiSelected = c.id;
    if (this.spiAddress === undefined) { this.spiRead = c.type === "rfm95w" ? !(value & 128) : !!(value & 128); this.spiAddress = c.type === "rfm95w" ? value & 127 : value | 128; return 0; }
    const address = this.spiAddress;
    if (!(c.type === "rfm95w" && address === 0)) this.spiAddress++;
    if (this.spiRead) return this.readRegister(c, address);
    this.writeRegister(c, address, value); return 0;
  }
  private gpio(c: CircuitComponent, method: string, args: DeviceValue[]): DeviceValue {
    const m = this.m(c); const pin = clamp(Number(args[0]), 0, 15); const bank = pin >> 3; const bit = 1 << (pin & 7);
    if (method === "pinMode") { if (Number(args[1]) === 1) m.registers[bank] &= ~bit; else m.registers[bank] |= bit; if (Number(args[1]) === 2) m.registers[0x0c + bank] |= bit; else m.registers[0x0c + bank] &= ~bit; }
    if (method === "digitalWrite") { if (args[1]) m.registers[0x14 + bank] |= bit; else m.registers[0x14 + bank] &= ~bit; }
    if (method === "digitalRead") { const value = Number(!!(m.registers[0x12 + bank] & bit)); this.clearGpioInterrupt(m, bank); return value; }
    if (method === "writeGPIOAB") { m.registers[0x14] = Number(args[0]) & 255; m.registers[0x15] = Number(args[0]) >> 8; }
    if (method === "readGPIOAB") { const value = m.registers[0x12] | m.registers[0x13] << 8; this.clearGpioInterrupt(m); return value; }
    if (method === "setupInterruptPin") {
      m.registers[4 + bank] |= bit;
      if (Number(args[1]) === 1) m.registers[8 + bank] &= ~bit;
      else { m.registers[8 + bank] |= bit; if (Number(args[1]) === 2) m.registers[6 + bank] |= bit; else m.registers[6 + bank] &= ~bit; }
    }
    if (method === "setupInterrupts") m.registers[0x0a] = (args[0] ? 64 : 0) | (args[1] ? 4 : 0) | (args[2] ? 2 : 0);
    if (method === "getLastInterruptPin") return m.lastInterrupt;
    if (method === "getCapturedInterrupt") { const value = m.captured; this.clearGpioInterrupt(m); return value; }
    if (method === "clearInterrupts") this.clearGpioInterrupt(m);
    return 0;
  }
  private clearGpioInterrupt(m: DeviceMemory, bank?: number) {
    for (const b of bank === undefined ? [0, 1] : [bank]) m.registers[0x0e + b] = 0;
    const flags = m.registers[0x0e] | m.registers[0x0f] << 8;
    m.lastInterrupt = flags ? Math.log2(flags & -flags) : 255;
  }
  private assignOutput(target: DeviceValue, value: DeviceValue) {
    if (Array.isArray(target) && Array.isArray(value)) target.splice(0, target.length, ...value);
    else this.values.set(String(target).replace(/^&/, ""), value);
  }
  private temperatureBus(name: string, method: string, args: DeviceValue[], evaluate: (text: string) => DeviceValue): DeviceValue {
    const instance = this.instances.get(name)!;
    const ctor = this.constructorArgs(name, evaluate);
    const direct = instance.api.type === "OneWire";
    const pin = Number(direct ? ctor[0] : this.constructorArgs(String(ctor[0]).replace(/^&/, ""), evaluate)[0]);
    const parts = this.oneWire.parts(pin);
    const address = (value: DeviceValue): number[] => {
      const resolved = typeof value === "string" ? this.values.get(value.replace(/^&/, "")) : value;
      return Array.isArray(resolved) ? resolved : [];
    };
    if (direct) {
      const result = this.oneWire.transaction(pin, method, args.map(a => Array.isArray(a) ? a : typeof a === "string" && this.values.has(a) ? address(a) : Number(a)));
      if (Array.isArray(result)) { this.assignOutput(args[0], result); return 1; }
      return result;
    }
    if (method === "begin") { this.values.set(`${name}.initialized`, true); return 0; }
    if (!this.values.get(`${name}.initialized`)) { this.error("DEVICE_NOT_INITIALIZED", `${name}: call begin() before ${method}.`); return -127; }
    if (method === "getDeviceCount") return parts.length;
    if (method === "setWaitForConversion") { this.values.set(`${name}.wait`, Boolean(args[0])); return 0; }
    if (method === "getAddress") {
      const part = parts[Number(args[1])];
      if (!part) return 0;
      this.assignOutput(args[0], sensorRom(part.id)); return 1;
    }
    const byAddress = ["getTempC", "requestTemperaturesByAddress"].includes(method) || (method === "setResolution" && args.length === 2) || (method === "getResolution" && args.length === 1);
    const selected = byAddress ? this.oneWire.addressed(pin, address(args[0])) : method === "getTempCByIndex" ? parts[Number(args[0])] : parts[0];
    if (!selected) { this.error("DEVICE_NOT_CONNECTED", `${name}.${method}: no sensor at the requested address/index on D${pin}. Check power, ground and the data pull-up.`); return method.startsWith("getTemp") ? -127 : 0; }
    if (method === "setResolution") {
      for (const c of byAddress ? [selected] : parts) this.oneWire.resolution(c, Number(args.at(-1)));
      return 0;
    }
    if (method === "getResolution") return this.oneWire.resolution(selected);
    if (method === "requestTemperatures" || method === "requestTemperaturesByAddress") {
      const duration = this.oneWire.convert(byAddress ? [selected] : parts, true);
      if (this.values.get(`${name}.wait`) !== false) this.pendingDelayMs = duration;
      return 1;
    }
    if (method === "getTempC" || method === "getTempCByIndex") return this.oneWire.temperature(selected);
    this.error("DEVICE_METHOD_UNIMPLEMENTED", `${name}.${method} is not implemented.`); return NaN;
  }
  private serial(name: string, method: string, args: DeviceValue[], evaluate: (text: string) => DeviceValue): DeviceValue {
    if (method === "begin") { this.values.set(`${name}.baud`, Number(args[0])); return 0; }
    const pins = this.constructorArgs(name, evaluate);
    const c = this.project.components.find(c => c.type === "xbee-s2c-zigbee-th" && this.powered(c) && this.wiring.boardConnected(c.id, "DOUT", Number(pins[0] ?? 0)) && this.wiring.boardConnected(c.id, "DIN", Number(pins[1] ?? 1)) && this.high(c, "RESET") && !this.high(c, "DIO8"));
    if (!c) return method === "available" ? 0 : -1;
    const model = this.xbee(c), connected = Number(this.values.get(`${name}.baud`)) === numeric(c, "baudRate", 9600);
    if (method === "available") return model.available(connected);
    if (method === "read") return model.read(connected);
    if (["write", "print", "println"].includes(method)) return model.write(bytes(method === "write" ? args[0] : String(args[0]) + (method === "println" ? "\n" : "")), c, this.time, connected);
    this.error("DEVICE_METHOD_UNIMPLEMENTED", `${name}.${method} is not implemented.`); return NaN;
  }
  private hardwareSerial(name: string, method: string, args: DeviceValue[]): DeviceValue {
    const port = Number(name.match(/\d+$/)?.[0] ?? 0);
    const available = getBoardProfile(this.boardId)?.uart.length ?? 1;
    if (port <= 0 || port >= available) {
      this.error("UART_PORT_UNAVAILABLE", `${name} is not available on the selected board profile.`);
      return method === "available" ? 0 : -1;
    }
    if (method === "begin") { this.values.set(`${name}.baud`, Number(args[0])); return 0; }
    if (method === "flush") return 0;
    const rx = this.uartRx.get(port) ?? [];
    if (method === "available") return rx.length;
    if (method === "read") return rx.shift() ?? -1;
    if (["write", "print", "println"].includes(method)) {
      const baud = Number(this.values.get(`${name}.baud`) ?? 0);
      if (!baud) { this.error("UART_NOT_INITIALIZED", `${name}: call begin(baud) before transmitting.`); return 0; }
      const data = method === "write"
        ? bytes(args[0]).slice(0, args[1] === undefined ? undefined : Math.max(0, Math.trunc(Number(args[1]))))
        : [...new TextEncoder().encode(String(args[0] ?? "") + (method === "println" ? "\n" : ""))];
      this.uartTx.push({ port, baud, data });
      return data.length;
    }
    this.error("DEVICE_METHOD_UNIMPLEMENTED", `${name}.${method} is not implemented.`);
    return NaN;
  }
  private boardProperties() { return this.project.components.find(component => component.id === this.boardComponentId)?.properties ?? {}; }
  private virtualUdpPeerMatches() {
    const properties = this.boardProperties();
    return properties.udpPeerEnabled !== false
      && String(properties.peerSsid ?? "") === String(properties.networkSsid ?? "")
      && String(properties.peerPassword ?? "") === String(properties.networkPassword ?? "")
      && String(properties.peerAddress ?? "").length > 0
      && Number(properties.peerPort ?? 0) > 0;
  }
  private wifi(method: string, args: DeviceValue[]): DeviceValue {
    if (method === "mode") return 1;
    if (method === "begin") {
      const properties = this.boardProperties();
      this.wifiConnected = String(args[0] ?? "") === String(properties.networkSsid ?? "")
        && String(args[1] ?? "") === String(properties.networkPassword ?? "");
      if (!this.wifiConnected) this.error("WIFI_CONNECT_FAILED", `${this.boardId}: Wi-Fi credentials do not match this board's configured virtual network.`);
      return this.wifiConnected ? 3 : 6;
    }
    if (method === "status") return this.wifiConnected ? 3 : 6;
    if (method === "disconnect") { this.wifiConnected = false; return 1; }
    this.error("DEVICE_METHOD_UNIMPLEMENTED", `WiFi.${method} is outside the virtual Wi-Fi subset.`);
    return NaN;
  }
  private udp(name: string, method: string, args: DeviceValue[]): DeviceValue {
    let socket = this.udpSockets.get(name);
    if (!socket) { socket = { localPort: 0, remoteAddress: "", remotePort: 0, tx: [], rx: [] }; this.udpSockets.set(name, socket); }
    if (method === "begin") { socket.localPort = this.wifiConnected ? Number(args[0]) : 0; return Number(socket.localPort > 0); }
    if (method === "beginPacket") { socket.remoteAddress = String(args[0]); socket.remotePort = Number(args[1]); socket.tx = []; return Number(this.wifiConnected && socket.localPort > 0); }
    if (method === "write" || method === "print" || method === "println") {
      const content = method === "write" ? bytes(args[0]).slice(0, args[1] === undefined ? undefined : Math.max(0, Math.trunc(Number(args[1])))) : bytes(String(args[0] ?? "") + (method === "println" ? "\r\n" : ""));
      socket.tx.push(...content); return content.length;
    }
    if (method === "endPacket") {
      const delivered = this.wifiConnected && socket.localPort > 0 && this.virtualUdpPeerMatches()
        && socket.remoteAddress === String(this.boardProperties().peerAddress) && socket.remotePort === Number(this.boardProperties().peerPort);
      const payload = new TextDecoder().decode(new Uint8Array(socket.tx));
      this.udpPackets.push({ timeMs: this.time, direction: "tx", payload, status: delivered ? "Delivered to virtual UDP peer" : "Not delivered: peer, port, or Wi-Fi settings do not match" });
      if (!delivered) this.error("UDP_PEER_UNAVAILABLE", `${name}: no matching configured virtual UDP peer is reachable at ${socket.remoteAddress}:${socket.remotePort}.`);
      socket.tx = []; return Number(delivered);
    }
    if (method === "parsePacket") return socket.rx.length;
    if (method === "available") return socket.rx.length;
    if (method === "read") return socket.rx.shift() ?? -1;
    if (method === "remotePort") return socket.remotePort;
    if (method === "stop") { socket.localPort = 0; socket.rx = []; return 0; }
    this.error("DEVICE_METHOD_UNIMPLEMENTED", `${name}.${method} is outside the virtual UDP subset.`);
    return NaN;
  }
  drainUartTransmissions(): UartTransmission[] { const result = this.uartTx; this.uartTx = []; return result; }
  enqueueUart(port: number, baud: number, data: readonly number[]): boolean {
    const name = `Serial${port}`;
    if (Number(this.values.get(`${name}.baud`) ?? 0) !== baud) return false;
    const queue = this.uartRx.get(port) ?? [];
    queue.push(...data);
    this.uartRx.set(port, queue.slice(-4096));
    return true;
  }
  private xbeeObject(name: string, method: string, args: DeviceValue[], evaluate: (text: string) => DeviceValue): DeviceValue {
    const type = this.instances.get(name)?.api.type;
    const ctor = this.constructorArgs(name, evaluate);
    const frame = this.values.get(`${name}.frame`); const data = Array.isArray(frame) ? frame : [];
    if (type === "XBeeAddress64") {
      if (method === "getMsb") return Number(this.values.get(`${name}.msb`) ?? ctor[0] ?? 0);
      if (method === "getLsb") return Number(this.values.get(`${name}.lsb`) ?? ctor[1] ?? 0);
      this.values.set(`${name}.${method === "setMsb" ? "msb" : "lsb"}`, Number(args[0])); return 0;
    }
    if (type === "ZBTxRequest") { if (method === "getFrameId") return this.values.get(`${name}.frameId`) ?? 1; this.values.set(`${name}.${method.slice(3, 4).toLowerCase() + method.slice(4)}`, args[0]); return 0; }
    if (type === "XBeeResponse") {
      if (method === "isAvailable") return Number(data.length > 0);
      if (method === "isError") return Number(this.values.get(`${name}.error`) ?? 0);
      if (method === "getErrorCode") return this.values.get(`${name}.error`) ?? 0;
      if (method === "getApiId") return data[0] ?? 0;
      const expected = method === "getZBTxStatusResponse" ? 0x8b : 0x90;
      if (data[0] !== expected) { this.error("XBEE_RESPONSE_TYPE", `${name}.${method}: response frame has the wrong API ID.`); return 0; }
      this.values.set(`${String(args[0])}.frame`, [...data]); return 0;
    }
    if (type === "ZBTxStatusResponse") {
      const indexes: Record<string, number> = { getFrameId: 1, getTxRetryCount: 4, getDeliveryStatus: 5, getDiscoveryStatus: 6 };
      if (method === "getRemoteAddress") return (data[2] ?? 0) << 8 | (data[3] ?? 0);
      return data[indexes[method]] ?? NaN;
    }
    if (type === "ZBRxResponse") {
      if (method === "getDataLength") return Math.max(0, data.length - 12);
      if (method === "getData") return data[12 + Number(args[0])] ?? -1;
      if (method === "getOption") return data[11] ?? 0;
      if (method === "getRemoteAddress16") return (data[9] ?? 0) << 8 | (data[10] ?? 0);
      if (method === "getRemoteAddress64") return data.slice(1, 9);
    }
    this.error("DEVICE_METHOD_UNIMPLEMENTED", `${name}.${method} is not implemented.`); return NaN;
  }
  private xbeeCall(c: CircuitComponent, name: string, method: string, args: DeviceValue[], evaluate: (text: string) => DeviceValue): DeviceValue {
    const model = this.xbee(c), serialName = String(this.values.get(`${name}.serial`) ?? "Serial");
    if (method === "begin") { this.values.set(`${serialName}.baud`, Number(args[0])); return 0; }
    const connected = Number(this.values.get(`${serialName}.baud`)) === numeric(c, "baudRate", 9600);
    if (!connected) { this.error("UART_BAUD", `${name}: initialize the serial port at the module's configured baud rate.`); return 0; }
    if (method === "send") {
      const request = String(args[0]), ctor = this.constructorArgs(request, evaluate);
      if (this.instances.get(request)?.api.type !== "ZBTxRequest") { this.error("XBEE_REQUEST_TYPE", "XBee.send requires a registered ZBTxRequest."); return 0; }
      const address = String(this.values.get(`${request}.address64`) ?? ctor[0]);
      const high = Number(this.xbeeObject(address, "getMsb", [], evaluate)), low = Number(this.xbeeObject(address, "getLsb", [], evaluate));
      const payload = bytes(this.values.get(`${request}.payload`) ?? ctor[1]);
      const length = Number(this.values.get(`${request}.payloadLength`) ?? ctor[2] ?? payload.length);
      const frameId = Number(this.values.get(`${request}.frameId`) ?? 1);
      const addressBytes = [high >>> 24, high >>> 16 & 255, high >>> 8 & 255, high & 255, low >>> 24, low >>> 16 & 255, low >>> 8 & 255, low & 255];
      model.write(encodeXBeeFrame([0x10, frameId, ...addressBytes, 0xff, 0xfe, 0, 0, ...payload.slice(0, length)], numeric(c, "apiMode", 2) === 2), c, this.time, connected); return 0;
    }
    if (method === "readPacket") {
      const response = `${name}__response`;
      this.values.set(`${response}.frame`, []);
      let decoder = this.responseDecoders.get(name); if (!decoder) { decoder = new XBeeFrameDecoder(); this.responseDecoders.set(name, decoder); }
      while (model.available(connected)) { const frame = decoder.push(model.read(connected), numeric(c, "apiMode", 2) === 2); if (frame) { this.values.set(`${response}.frame`, frame); break; } }
      this.values.set(`${response}.error`, decoder.error ? 1 : 0);
      return Number((this.values.get(`${response}.frame`) as number[]).length > 0);
    }
    if (method === "getResponse") return `${name}__response`;
    this.error("DEVICE_METHOD_UNIMPLEMENTED", `${name}.${method} is not implemented.`); return NaN;
  }
  private loraCall(c: CircuitComponent, method: string, args: DeviceValue[]): DeviceValue {
    const model = this.lora(c);
    if (method === "setFrequency") { model.setFrequency(Number(args[0])); return 0; }
    if (method === "setSignalBandwidth") { model.setBandwidth(Number(args[0])); return 0; }
    if (method === "setSpreadingFactor") { model.registers[0x1e] = (clamp(Number(args[0]), 6, 12) << 4) | (model.registers[0x1e] & 15); return 0; }
    if (method === "setCodingRate4") { model.registers[0x1d] = (model.registers[0x1d] & ~14) | ((clamp(Number(args[0]), 5, 8) - 4) << 1); return 0; }
    if (method === "setSyncWord") { model.registers[0x39] = Number(args[0]); return 0; }
    if (method === "setTxPower") { model.registers[0x09] = 0x80 | (clamp(Number(args[0]), 2, 17) - 2); return 0; }
    if (method === "enableCrc" || method === "disableCrc") { model.registers[0x1e] = method === "enableCrc" ? model.registers[0x1e] | 4 : model.registers[0x1e] & ~4; return 0; }
    if (method === "sleep" || method === "end" || method === "idle" || method === "receive") { model.write(1, 0x80 | (method === "idle" ? 1 : method === "receive" ? 5 : 0), c, this.time); return 0; }
    if (method === "beginPacket") return model.beginPacket(Boolean(args[0]), c, this.time);
    if (["write", "print", "println"].includes(method)) {
      const data = bytes(method === "write" ? args[0] : String(args[0]) + (method === "println" ? "\n" : ""));
      return model.append(args.length > 1 ? data.slice(0, Number(args[1])) : data, c, this.time);
    }
    if (method === "endPacket") { model.write(1, 0x83, c, this.time); if (!args[0]) this.pendingDelayMs = model.busyUntil - this.time; return 1; }
    if (method === "parsePacket") return model.parse(Number(args[0] ?? 0), c, this.time);
    if (method === "available") return model.available();
    if (method === "read" || method === "peek") return model.byte(method === "peek");
    if (method === "packetRssi") return model.registers[0x1a] - (model.frequency < 525000000 ? 164 : 157);
    if (method === "packetSnr") return (model.registers[0x19] << 24 >> 24) / 4;
    this.error("DEVICE_METHOD_UNIMPLEMENTED", `LoRa.${method} is not implemented.`); return NaN;
  }
  private battery(c: CircuitComponent, pin = "BAT") {
    return this.project.components.find(b => b.type === "battery-cell" && this.wiring.connected(c.id, pin, b.id, "+"));
  }
  private senseResistor(c: CircuitComponent, positive: string, negative: string): number | undefined {
    const resistor = this.project.components.find(r => r.type === "resistor" && ((this.wiring.connected(c.id, positive, r.id, "1") && this.wiring.connected(c.id, negative, r.id, "2")) || (this.wiring.connected(c.id, positive, r.id, "2") && this.wiring.connected(c.id, negative, r.id, "1"))));
    return resistor ? Math.max(0.000001, numeric(resistor, "resistance", 0.01)) : undefined;
  }
  private groundResistor(c: CircuitComponent, pin: string): number | undefined {
    const resistor = this.project.components.find(r => r.type === "resistor" && ["1", "2"].some((lead, index) => this.wiring.connected(c.id, pin, r.id, lead) && this.wiring.voltage(r.id, index ? "1" : "2") === 0));
    return resistor ? numeric(resistor, "resistance", 10000) : undefined;
  }
  private powerDevices() {
    if (!this.powerResult) return;
    this.charging = {};
    for (const c of this.project.components.filter(c => ["bq24074", "bq27441-g1", "bq76920"].includes(c.type))) {
      const m = this.m(c), powered = this.powered(c); const readings: Record<string, number> = {};
      let status = powered ? "Ready" : "Unpowered", fault = "";
      if (c.type === "bq24074") {
        const battery = this.battery(c, "BAT_2"); const b = battery && this.powerResult.states[battery.id]?.readings;
        const input = this.powerResult.voltage(c.id, "IN"); const ground = this.powerResult.voltage(c.id, "VSS");
        const iSet = this.groundResistor(c, "ISET"), iLim = this.groundResistor(c, "ILIM");
        const mode = Number(this.high(c, "EN1")) + 2 * Number(this.high(c, "EN2"));
        const currentLimit = mode === 0 ? 0.1 : mode === 1 ? 0.5 : mode === 2 && iLim ? 1610 / iLim : 0;
        const enabled = this.wiring.voltage(c.id, "CE") === 0 && this.wiring.voltage(c.id, "EN1") !== undefined && this.wiring.voltage(c.id, "EN2") !== undefined;
        const temperature = b?.temperature ?? 25;
        const ts = this.groundResistor(c, "TS");
        const validGround = ground === 0 && this.wiring.voltage(c.id, "EP") === 0;
        const inputGood = input !== undefined && input >= 4.35 && input <= 10.2 && validGround;
        this.powerControls[`${c.id}:input`] = Number(inputGood && mode !== 3);
        this.powerControls[`${c.id}:battery`] = Number((!inputGood || mode === 3) && !!battery && validGround);
        this.powerControls[`${c.id}:drop`] = Math.max(0, (input ?? 5) - 4.4);
        const previousMode = this.chargerModes.get(c.id), previousEnabled = this.chargerEnabled.get(c.id);
        if (previousMode !== undefined && previousMode !== mode || previousEnabled !== undefined && previousEnabled !== enabled) {
          this.chargerElapsed.set(c.id, 0); m.registers[0] = 0; m.registers[1] = 0;
        }
        if (!enabled) this.chargerElapsed.set(c.id, 0);
        this.chargerModes.set(c.id, mode);
        this.chargerEnabled.set(c.id, enabled);
        let charge = enabled && inputGood && iSet && battery && ts && temperature >= 0 && temperature <= 45 ? Math.min(1.5, 890 / iSet, Math.max(0, currentLimit - Math.abs(this.powerResult.current(c.id)))) : 0;
        const voltage = b?.voltage ?? 0;
        if (voltage < 3) charge *= 0.1;
        if (voltage > 4.1) charge *= clamp((4.2 - voltage) / 0.1, 0, 1);
        const termResistor = this.groundResistor(c, "ITERM");
        const terminationCurrent = iSet && termResistor ? (mode === 0 ? 0.01 : 0.03) * termResistor / iSet : 0;
        if (voltage >= 4.1 && terminationCurrent > 0 && charge <= terminationCurrent) m.registers[0] = 1;
        if (voltage < 4.1) m.registers[0] = 0;
        const tmr = this.groundResistor(c, "TMR");
        const now = this.time, last = this.chargerLastTick.get(c.id) ?? now;
        const chargingNow = enabled && inputGood && battery && ts && temperature >= 0 && temperature <= 45 && voltage < 4.2 && !m.registers[0] && !m.registers[1];
        if (chargingNow) this.chargerElapsed.set(c.id, (this.chargerElapsed.get(c.id) ?? 0) + Math.max(0, now - last));
        this.chargerLastTick.set(c.id, now);
        const timerLimit = tmr ? tmr * 480 : undefined; // 48 s/kΩ × 10, converted to milliseconds.
        if (timerLimit !== undefined && (this.chargerElapsed.get(c.id) ?? 0) >= timerLimit) m.registers[1] = 1;
        if (m.registers[0] || m.registers[1]) charge = 0;
        this.powerControls[`${c.id}:charge`] = charge;
        if (battery) this.charging[battery.id] = charge;
        status = !inputGood ? "Battery power" : !battery ? "No battery" : !enabled ? "Charge disabled" : !ts || temperature < 0 || temperature > 45 ? "Temperature suspended" : m.registers[1] ? "Safety timer expired" : m.registers[0] ? "Charge complete" : charge === 0 ? "Input current limited" : voltage < 3 ? "Precharge" : voltage >= 4.1 ? "Constant voltage" : "Charging";
        readings.chargeCurrent = charge; readings.batteryVoltage = voltage; readings.inputVoltage = input ?? 0;
        readings.terminationCurrent = terminationCurrent; readings.chargeElapsedMs = this.chargerElapsed.get(c.id) ?? 0;
        if (timerLimit !== undefined) readings.timerRemainingMs = Math.max(0, timerLimit - (this.chargerElapsed.get(c.id) ?? 0));
        if (inputGood) this.drive(c, "PGOOD", 0);
        if (charge > 0) this.drive(c, "CHG", 0);
        if (!iSet || !ts) fault = "Connect ISET and TS programming/sensing resistors.";
      } else if (c.type === "bq27441-g1") {
        const battery = this.battery(c), b = battery && this.powerResult.states[battery.id]?.readings;
        const resistance = this.senseResistor(c, "SRP", "SRN");
        const vp = this.powerResult.voltage(c.id, "SRP"), vn = this.powerResult.voltage(c.id, "SRN");
        const inserted = !!this.groundResistor(c, "BIN");
        if (!battery || !resistance || vp === undefined || vn === undefined || !inserted) fault = "Connect BAT, BIN through a resistor, and both sides of the 10 mΩ sense resistor.";
        this.gauge(c).update(undefined);
        if (powered && !fault && b) {
          Object.assign(readings, b, { current: (vp! - vn!) / resistance!, capacityMah: numeric(battery!, "capacityMah", 2000) });
          this.gauge(c).update({ voltage: readings.voltage, current: readings.current, temperature: readings.temperature, soc: readings.soc, capacityMah: readings.capacityMah });
          if (b.soc <= 10) this.drive(c, "GPOUT", 0);
        }
      } else {
        const taps = Array.from({ length: 6 }, (_, i) => this.powerResult!.voltage(c.id, `VC${i}`));
        const cells = taps.slice(1).map((v, i) => v === undefined || taps[i] === undefined ? NaN : v - taps[i]!);
        const active = cells.filter(v => v > 0.05);
        const resistance = this.senseResistor(c, "SRP", "SRN");
        const vp = this.powerResult.voltage(c.id, "SRP"), vn = this.powerResult.voltage(c.id, "SRN");
        const current = vp !== undefined && vn !== undefined && resistance ? (vp - vn) / resistance : NaN;
        if (cells.some(Number.isNaN) || active.length < 3 || active.length > 5 || !resistance || !Number.isFinite(current)) fault = "Connect 3–5 ordered cell taps, unused tap shorts, and the current sense resistor.";
        const connectedCells = cells.map((_v, i) => this.project.components.find(b => b.type === "battery-cell" && this.wiring.connected(c.id, `VC${i + 1}`, b.id, "+") && this.wiring.connected(c.id, `VC${i}`, b.id, "-")));
        const temperature = connectedCells.filter(b => !!b).reduce((max, b) => Math.max(max, numeric(b!, "temperature", 25)), -Infinity);
        if (!Number.isFinite(temperature) || !this.groundResistor(c, "TS1")) fault = "Connect the battery cells and TS1 temperature-sensing resistor.";
        const uv = Number(this.values.get(`${c.id}.uv`) ?? 2.8), ov = Number(this.values.get(`${c.id}.ov`) ?? 4.25), oc = Number(this.values.get(`${c.id}.oc`) ?? 10);
        const lowVoltage = active.some(v => v < uv), highVoltage = active.some(v => v > ov), overcurrent = Math.abs(current) > oc, overtemperature = temperature > Number(this.values.get(`${c.id}.maxTemp`) ?? 60);
        const bad = lowVoltage || highVoltage || overcurrent || overtemperature;
        if (bad && !this.protectionSince.has(c.id)) this.protectionSince.set(c.id, this.time);
        if (!bad) this.protectionSince.delete(c.id);
        const tripped = bad && this.time - this.protectionSince.get(c.id)! >= Number(this.values.get(`${c.id}.delay`) ?? 100);
        const newFaultMask = (lowVoltage ? 8 : 0) | (highVoltage ? 4 : 0) | (overcurrent ? 2 : 0) | (overtemperature ? 0x20 : 0);
        if (tripped) this.protectionLatched.set(c.id, newFaultMask);
        const faultMask = this.protectionLatched.get(c.id) ?? 0;
        const protectionActive = tripped || faultMask !== 0;
        const ready = powered && !fault && !protectionActive;
        this.drive(c, "CHG", ready && !!(m.registers[5] & 1) ? 1 : 0);
        this.drive(c, "DSG", ready && !!(m.registers[5] & 2) ? 1 : 0);
        if (protectionActive || fault) this.drive(c, "ALERT", 1);
        m.registers[0] = faultMask;
        let balanceMask = m.registers[1] & 31;
        if (this.values.get(`${c.id}.autoBalance`) && ready && Math.abs(current) <= Number(this.values.get(`${c.id}.idleCurrent`) ?? 0.03)) {
          if (!this.values.has(`${c.id}.idleSince`)) this.values.set(`${c.id}.idleSince`, this.time);
          const idle = this.time - Number(this.values.get(`${c.id}.idleSince`));
          if (idle >= Number(this.values.get(`${c.id}.balanceIdle`) ?? 1800000)) {
            balanceMask = 0;
            const minimum = Math.min(...active);
            cells.forEach((voltage, i) => { if (voltage >= Number(this.values.get(`${c.id}.balanceMin`) ?? 3.4) && voltage - minimum > Number(this.values.get(`${c.id}.balanceDelta`) ?? 0.02) && !(balanceMask & (1 << (i - 1)))) balanceMask |= 1 << i; });
          }
        } else this.values.delete(`${c.id}.idleSince`);
        if (!ready) balanceMask = 0;
        m.registers[1] = balanceMask;
        connectedCells.forEach((cell, i) => { if (cell && (balanceMask & (1 << i))) this.charging[cell.id] = (this.charging[cell.id] ?? 0) - 0.05; });
        readings.balancing = balanceMask;
        active.forEach((voltage, i) => { readings[`cell${i + 1}`] = voltage; });
        readings.voltage = active.reduce((a, b) => a + b, 0); readings.current = Number.isFinite(current) ? current : 0; readings.temperature = temperature;
        status = fault ? "Wiring fault" : protectionActive ? "Protection active" : ready ? "Monitoring" : "Unpowered";
      }
      this.states[c.id] = { type: c.type, powered, status, readings, ...(fault ? { fault } : {}) };
    }
    for (const c of this.project.components.filter(c => c.type === "ideal-mosfet")) {
      let voltage = this.wiring.voltage(c.id, "G");
      for (const drive of this.drives) if (this.wiring.connected(c.id, "G", drive.componentId, drive.pin)) voltage = drive.value * 10;
      this.powerControls[c.id] = Number(voltage !== undefined && voltage - (this.powerResult.voltage(c.id, "S") ?? 0) >= numeric(c, "threshold", 2.5));
    }
  }
  private powerCall(c: CircuitComponent, method: string, args: DeviceValue[]): DeviceValue {
    const m = this.m(c); const state = this.states[c.id]; const r = state?.readings ?? {};
    if (state?.fault) { this.error("POWER_WIRING", `${c.label}: ${state.fault}`); return NaN; }
    if (c.type === "bq27441-g1") {
      const gauge = this.gauge(c);
      if (method === "setCapacity") return Number(gauge.setCapacity(Number(args[0])));
      if (method === "enterConfig" || method === "exitConfig") { gauge.setConfig(method === "enterConfig"); return 1; }
      if (method === "capacity") return gauge.word([12, 14, 8, 10, 42, 40, 46, 44, 60][Number(args[0] ?? 0)] ?? 12);
      if (method === "current") return gauge.word([16, 18, 20][Number(args[0] ?? 0)] ?? 16) << 16 >> 16;
      if (method === "voltage") return gauge.word(4);
      if (method === "temperature") return gauge.word(Number(args[0] ?? 0) === 0 ? 2 : 30);
      if (method === "soc") return gauge.word(28);
      if (method === "flags") return gauge.flags;
      if (method === "deviceType") return 0x0421;
      if (method === "status") return 0x0082;
    }
    if (method === "reset" || method === "softReset") { m.registers.fill(0); m.initialized = false; this.protectionSince.delete(c.id); this.protectionLatched.delete(c.id); return 1; }
    if (method === "voltage" || method === "getBatteryVoltage") return (r.voltage ?? NaN) * 1000;
    if (method === "current" || method === "getBatteryCurrent") return (r.current ?? NaN) * 1000;
    if (method === "getTemperatureDegC") return r.temperature ?? NaN;
    if (method === "getTemperatureDegF") return (r.temperature ?? NaN) * 1.8 + 32;
    if (method === "checkStatus") return m.registers[0];
    if (method === "soc") return r.soc ?? NaN;
    if (method === "capacity") return r.capacityMah ?? NaN;
    if (method === "remainingCapacity") return r.remainingMah ?? NaN;
    if (method === "flags") return m.registers[0];
    if (method === "getCellVoltage") return (r[`cell${Number(args[0])}`] ?? NaN) * 1000;
    if (method === "enableCharging") m.registers[5] |= 1;
    if (method === "enableDischarging") m.registers[5] |= 2;
    if (method === "disableCharging") m.registers[5] &= ~1;
    if (method === "disableDischarging") m.registers[5] &= ~2;
    if (method === "setCellUndervoltageProtection" || method === "setCellOvervoltageProtection") { this.values.set(`${c.id}.${method.includes("Undervoltage") ? "uv" : "ov"}`, Number(args[0]) / 1000); this.values.set(`${c.id}.delay`, Number(args[1]) * 1000); }
    if (method === "setOvercurrentDischargeProtection" || method === "setShortCircuitProtection") { this.values.set(`${c.id}.oc`, Number(args[0]) / 1000); this.values.set(`${c.id}.delay`, Number(args[1])); }
    if (method === "setTemperatureLimits") this.values.set(`${c.id}.maxTemp`, Math.min(Number(args[1]), Number(args[3])));
    if (method === "setShuntResistorValue") this.values.set(`${c.id}.shunt`, Number(args[0]) / 1000);
    if (method === "enterConfig" || method === "exitConfig") { this.values.set(`${c.id}.config`, method === "enterConfig"); return 1; }
    if (method === "setCapacity") { if (!this.values.get(`${c.id}.config`)) return 0; this.values.set(`${c.id}.capacity`, Number(args[0])); return 1; }
    if (method === "setBalancingThresholds") { this.values.set(`${c.id}.balanceIdle`, Number(args[0] ?? 30) * 60000); this.values.set(`${c.id}.balanceMin`, Number(args[1] ?? 3400) / 1000); this.values.set(`${c.id}.balanceDelta`, Number(args[2] ?? 20) / 1000); }
    if (method === "enableAutoBalancing") { this.values.set(`${c.id}.autoBalance`, true); return 0; }
    if (method === "update") return 0;
    if (["enableCharging", "enableDischarging", "disableCharging", "disableDischarging", "setCellUndervoltageProtection", "setCellOvervoltageProtection", "setOvercurrentDischargeProtection", "setShortCircuitProtection", "setTemperatureLimits", "setShuntResistorValue", "setBalancingThresholds"].includes(method)) return 1;
    this.error("DEVICE_METHOD_UNIMPLEMENTED", `${c.label}.${method} is not implemented.`); return NaN;
  }
  injectPacket(id: string, payload: string): boolean {
    if (id === this.boardComponentId && this.wifiConnected && this.virtualUdpPeerMatches()) {
      const sockets = [...this.udpSockets.values()].filter(socket => socket.localPort > 0);
      if (!sockets.length) return false;
      for (const socket of sockets) socket.rx.push(...bytes(payload));
      this.udpPackets.push({ timeMs: this.time, direction: "rx", payload, status: "Received from virtual UDP peer" });
      return true;
    }
    const c = this.project.components.find(c => c.id === id); if (!c || !this.wiring) return false;
    if (c.type === "rfm95w") { const host = !!this.resolve("LoRa", [], text => Number(text)); return this.lora(c).inject(bytes(payload), c, this.time, host); }
    if (c.type === "xbee-s2c-zigbee-th") {
      const host = [...this.instances.values()].some(instance => instance.api.type === "XBee" && this.resolve(instance.name, [], text => Number(text))?.id === c.id);
      return this.xbee(c).inject(bytes(payload), c, this.time, host);
    }
    return false;
  }
}
