import type { CircuitComponent } from "../circuit/types.ts";
import type { SimulatedComponentState } from "./types.ts";

const bandwidths = [7800, 10400, 15600, 20800, 31250, 41700, 62500, 125000, 250000, 500000];
const property = (c: CircuitComponent, key: string, fallback: number) => Number(c.properties?.[key] ?? fallback);
type Packet = NonNullable<SimulatedComponentState["packets"]>[number];

/** Functional SX127x LoRa packet engine; high-level adapters and SPI share these registers. */
export class LoRaModel {
  readonly registers = new Uint8Array(128);
  private fifo = new Uint8Array(256);
  private readRemaining = 0;
  private pending?: { at: number; data: number[]; compatible: boolean };
  packets: Packet[] = [];
  initialized = false;
  constructor() { this.reset(); }
  reset() {
    this.registers.fill(0); this.fifo.fill(0); this.readRemaining = 0; this.pending = undefined; this.packets = []; this.initialized = false;
    this.registers[0x42] = 0x12; this.registers[0x1d] = 0x72; this.registers[0x1e] = 0x70; this.registers[0x39] = 0x12;
  }
  get mode() { return this.registers[1] & 7; }
  get frequency() { return (this.registers[6] << 16 | this.registers[7] << 8 | this.registers[8]) * 32000000 / 524288; }
  get bandwidth() { return bandwidths[this.registers[0x1d] >> 4] ?? 0; }
  get spreading() { return this.registers[0x1e] >> 4; }
  get coding() { return ((this.registers[0x1d] >> 1) & 7) + 4; }
  get crc() { return !!(this.registers[0x1e] & 4); }
  get sleeping() { return this.mode === 0; }
  get receiving() { return this.mode === 5 || this.mode === 6; }
  get txDone() { return !!(this.registers[0x12] & 8); }
  get rxDone() { return !!(this.registers[0x12] & 64); }
  get busyUntil() { return this.pending?.at ?? 0; }
  private compatible(c: CircuitComponent) {
    return c.properties?.peerEnabled !== false && Math.abs(this.frequency - property(c, "peerFrequency", 915000000)) < 62 && this.bandwidth === property(c, "peerBandwidth", 125000) && this.spreading === property(c, "peerSpreading", 7) && this.coding === property(c, "peerCoding", 5) && this.registers[0x39] === property(c, "peerSyncWord", 18) && this.crc === Boolean(c.properties?.peerCrc ?? false);
  }
  private record(time: number, direction: "tx" | "rx", data: readonly number[], status: string) {
    this.packets.push({ timeMs: time, direction, payload: new TextDecoder().decode(new Uint8Array(data)), status }); this.packets = this.packets.slice(-100);
  }
  tick(time: number) {
    if (this.pending && time >= this.pending.at) {
      this.record(this.pending.at, "tx", this.pending.data, this.pending.compatible ? "Delivered to virtual peer" : "Peer unavailable or incompatible");
      this.pending = undefined; this.registers[0x12] |= 8; this.registers[1] = 0x81;
    }
  }
  read(register: number) {
    if (register === 0) { const value = this.fifo[this.registers[0x0d]++]; this.readRemaining = Math.max(0, this.readRemaining - 1); return value; }
    return this.registers[register & 127];
  }
  write(register: number, value: number, c: CircuitComponent, time: number) {
    register &= 127; value &= 255;
    if (register === 0) { this.fifo[this.registers[0x0d]++] = value; return; }
    if (register === 0x12) { this.registers[register] &= ~value; return; }
    this.registers[register] = value;
    if (register === 0x0d) this.readRemaining = this.registers[0x13];
    if (register !== 1) return;
    if (!(value & 128)) { this.initialized = false; return; }
    this.initialized = true;
    if ((value & 7) === 0) { this.pending = undefined; return; }
    if ((value & 7) === 3) {
      const length = this.registers[0x22], base = this.registers[0x0e];
      const data = Array.from({ length }, (_, i) => this.fifo[(base + i) & 255]);
      // Deterministic packet completion, deliberately not an RF airtime/propagation model.
      this.pending = { at: time + Math.max(1, length), data, compatible: this.compatible(c) };
      this.registers[0x12] &= ~8;
    }
  }
  begin(frequency: number, c: CircuitComponent, time: number) {
    if (!Number.isFinite(frequency) || frequency < 137000000 || frequency > 1020000000) return 0;
    this.reset(); this.setFrequency(frequency); this.write(1, 0x81, c, time); return 1;
  }
  setFrequency(frequency: number) { const frf = Math.floor(frequency * 524288 / 32000000); this.registers[6] = frf >> 16; this.registers[7] = frf >> 8; this.registers[8] = frf; }
  setBandwidth(value: number) { const index = bandwidths.findIndex(b => b >= value); this.registers[0x1d] = ((index < 0 ? 9 : index) << 4) | (this.registers[0x1d] & 15); }
  beginPacket(implicit: boolean, c: CircuitComponent, time: number) {
    if (this.pending) return 0;
    this.write(1, 0x81, c, time); this.registers[0x1d] = (this.registers[0x1d] & ~1) | Number(implicit); this.registers[0x0d] = this.registers[0x0e]; this.registers[0x22] = 0; return 1;
  }
  append(data: readonly number[], c: CircuitComponent, time: number) {
    const accepted = data.slice(0, 255 - this.registers[0x22]);
    for (const value of accepted) this.write(0, value, c, time);
    this.registers[0x22] += accepted.length; return accepted.length;
  }
  parse(size: number, c: CircuitComponent, time: number) {
    if (this.rxDone) {
      this.registers[0x12] &= ~64; this.registers[0x0d] = this.registers[0x10]; this.readRemaining = this.registers[0x13]; this.write(1, 0x81, c, time); return this.readRemaining;
    }
    this.registers[0x1d] = (this.registers[0x1d] & ~1) | Number(size > 0);
    if (size > 0) this.registers[0x22] = size;
    this.write(1, 0x86, c, time); return 0;
  }
  available() { return this.readRemaining; }
  byte(peek = false) {
    if (!this.readRemaining) return -1;
    return peek ? this.fifo[this.registers[0x0d]] : this.read(0);
  }
  inject(data: readonly number[], c: CircuitComponent, time: number, hostConnected: boolean) {
    const compatible = this.compatible(c) && (!(this.registers[0x1d] & 1) || data.length === this.registers[0x22]);
    const delivered = hostConnected && this.initialized && this.receiving && compatible && data.length <= 255 && !this.rxDone;
    this.record(time, "rx", data, delivered ? "Received" : "Not delivered: host wiring, mode, peer settings, or receive buffer");
    if (!delivered) return false;
    const base = this.registers[0x0f]; data.forEach((value, i) => { this.fifo[(base + i) & 255] = value; });
    this.registers[0x10] = base; this.registers[0x0d] = base; this.registers[0x13] = data.length; this.readRemaining = data.length;
    this.registers[0x19] = Math.round(property(c, "peerSnr", 8) * 4); this.registers[0x1a] = Math.round(property(c, "peerRssi", -60) + (this.frequency < 525000000 ? 164 : 157));
    this.registers[0x12] |= 64;
    if (this.mode === 6) this.registers[1] = 0x81;
    return true;
  }
}
