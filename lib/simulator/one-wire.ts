import type { CircuitComponent, CircuitProject } from "../circuit/types.ts";
import type { DeviceWiring } from "./device-wiring.ts";

/** Maxim reflected CRC-8, used by both ROM discovery and scratchpad transfers. */
export function oneWireCrc(data: readonly number[]): number {
  let crc = 0;
  for (let byte of data) for (let bit = 0; bit < 8; bit++) {
    const mix = (crc ^ byte) & 1;
    crc >>>= 1; if (mix) crc ^= 0x8c; byte >>>= 1;
  }
  return crc;
}
export function sensorRom(id: string): number[] {
  // Stable identity survives save/load and is independent of placement or bus order.
  let hash = 2166136261, second = 5381;
  for (const char of id) { hash = Math.imul(hash ^ char.charCodeAt(0), 16777619); second = Math.imul(second, 33) ^ char.charCodeAt(0); }
  const rom = [0x28, hash & 255, hash >>> 8 & 255, hash >>> 16 & 255, hash >>> 24 & 255, second & 255, second >>> 8 & 255];
  return [...rom, oneWireCrc(rom)];
}
interface TemperatureState {
  resolution: number; temperature: number; pending?: number; readyAt: number;
  failed: boolean; strong: boolean; highAlarm: number; lowAlarm: number;
}
interface BusState { search: number; selection?: number[]; rx: number[]; write: number[]; command: number }

export class OneWireRuntime {
  private devices = new Map<string, TemperatureState>();
  private buses = new Map<number, BusState>();
  private wiring?: DeviceWiring;
  private project?: CircuitProject;
  private time = 0;
  reset() { this.devices.clear(); this.buses.clear(); this.time = 0; }
  private state(id: string) {
    let state = this.devices.get(id);
    if (!state) { state = { resolution: 12, temperature: 85, readyAt: 0, failed: false, strong: false, highAlarm: 75, lowAlarm: 70 }; this.devices.set(id, state); }
    return state;
  }
  private bus(pin: number) {
    let state = this.buses.get(pin);
    if (!state) { state = { search: 0, rx: [], write: [], command: 0 }; this.buses.set(pin, state); }
    return state;
  }
  private parasite(c: CircuitComponent) { return this.wiring?.voltage(c.id, "VDD") === 0; }
  powered(c: CircuitComponent) {
    const w = this.wiring;
    return !!w && (w.powered(c) || (this.parasite(c) && w.voltage(c.id, "GND") === 0 && w.pullup(c.id, "DQ")));
  }
  tick(project: CircuitProject, wiring: DeviceWiring, time: number) {
    this.project = project; this.wiring = wiring; this.time = time;
    for (const c of project.components.filter(c => c.type === "ds18b20")) {
      const s = this.state(c.id);
      if (!this.powered(c)) { this.devices.delete(c.id); continue; }
      if (s.pending !== undefined) {
        if (this.parasite(c) && !s.strong) s.failed = true;
        if (time >= s.readyAt) { if (!s.failed) s.temperature = s.pending; s.pending = undefined; s.strong = false; }
      }
    }
  }
  parts(pin: number) {
    return this.project?.components.filter(c => c.type === "ds18b20" && this.powered(c) && this.wiring!.boardConnected(c.id, "DQ", pin) && this.wiring!.pullup(c.id, "DQ")) ?? [];
  }
  addressed(pin: number, address: readonly number[]) { return this.parts(pin).find(c => sensorRom(c.id).every((byte, i) => byte === address[i])); }
  resolution(c: CircuitComponent, value?: number) {
    const s = this.state(c.id);
    if (value !== undefined) s.resolution = Math.max(9, Math.min(12, Math.trunc(value)));
    return s.resolution;
  }
  convert(parts: readonly CircuitComponent[], strong: boolean): number {
    let delay = 0;
    for (const c of parts) {
      const s = this.state(c.id), duration = 750 / (1 << (12 - s.resolution));
      const scale = 1 << (s.resolution - 8);
      s.pending = Math.round(Math.max(-55, Math.min(125, Number(c.properties?.temperature ?? 25))) * scale) / scale;
      s.readyAt = this.time + duration; s.strong = strong; s.failed = this.parasite(c) && !strong;
      delay = Math.max(delay, duration);
    }
    return delay;
  }
  temperature(c: CircuitComponent) {
    const s = this.state(c.id);
    return s.failed || s.pending !== undefined ? -127 : s.temperature;
  }
  private selected(pin: number) { const selection = this.bus(pin).selection; return selection ? this.parts(pin).filter(c => sensorRom(c.id).every((b, i) => b === selection[i])) : this.parts(pin); }
  transaction(pin: number, method: string, args: (number | number[])[]): number | number[] {
    const bus = this.bus(pin);
    if (method === "reset") { bus.rx = []; bus.write = []; bus.command = 0; bus.selection = undefined; return Number(this.parts(pin).length > 0); }
    if (method === "reset_search") { bus.search = 0; return 0; }
    if (method === "search") { const c = this.parts(pin)[bus.search++]; return c ? sensorRom(c.id) : 0; }
    if (method === "select") { bus.selection = Array.isArray(args[0]) ? [...args[0]] : []; return 0; }
    if (method === "skip") { bus.selection = undefined; return 0; }
    const selected = this.selected(pin);
    if (method === "write") {
      const value = Number(args[0]) & 255;
      if (bus.command === 0x4e && bus.write.length < 3) {
        bus.write.push(value);
        if (bus.write.length === 3) for (const c of selected) { const s = this.state(c.id); s.highAlarm = bus.write[0]; s.lowAlarm = bus.write[1]; s.resolution = 9 + ((value >> 5) & 3); }
        return 0;
      }
      bus.command = value;
      if (value === 0x44) this.convert(selected, !!args[1]);
      if (value === 0xb4) bus.rx = [Number(selected.every(c => !this.parasite(c)))];
      if (value === 0xbe && selected.length === 1) {
        const s = this.state(selected[0].id), raw = Math.round(s.temperature * 16);
        const data = [raw & 255, raw >> 8 & 255, s.highAlarm, s.lowAlarm, 0x1f | ((s.resolution - 9) << 5), 255, 12, 16];
        bus.rx = [...data, oneWireCrc(data)];
      }
      return 0;
    }
    if (method === "read") return bus.rx.shift() ?? Number(selected.length > 0 && selected.every(c => this.state(c.id).pending === undefined && !this.state(c.id).failed));
    throw new Error(`Unsupported 1-Wire transaction: ${method}`);
  }
}
