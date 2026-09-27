import type { CircuitComponent } from "../circuit/types.ts";
import type { SimulatedComponentState } from "./types.ts";

export function encodeXBeeFrame(data: readonly number[], escaped = true): number[] {
  const body = [data.length >> 8, data.length & 255, ...data, 255 - (data.reduce((sum, value) => sum + value, 0) & 255)];
  return [0x7e, ...body.flatMap(value => escaped && [0x7e, 0x7d, 0x11, 0x13].includes(value) ? [0x7d, value ^ 0x20] : [value])];
}
export class XBeeFrameDecoder {
  private buffer: number[] | undefined;
  private escape = false;
  error = false;
  reset() { this.buffer = undefined; this.escape = false; this.error = false; }
  push(byte: number, escaped = true): number[] | undefined {
    byte &= 255;
    if (byte === 0x7e && (escaped || !this.buffer)) { this.buffer = []; this.escape = false; return; }
    if (!this.buffer) return;
    if (escaped && !this.escape && byte === 0x7d) { this.escape = true; return; }
    if (this.escape) { byte ^= 0x20; this.escape = false; }
    this.buffer.push(byte);
    if (this.buffer.length < 2) return;
    const length = this.buffer[0] << 8 | this.buffer[1];
    if (length > 512) { this.error = true; this.buffer = undefined; return; }
    if (this.buffer.length !== length + 3) return;
    const buffer = this.buffer; this.buffer = undefined;
    if ((buffer.slice(2).reduce((sum, value) => sum + value, 0) & 255) !== 255) { this.error = true; return; }
    this.error = false; return buffer.slice(2, -1);
  }
}
const addressBytes = (value: string) => /^[0-9a-f]{16}$/i.test(value) ? value.match(/../g)!.map(v => parseInt(v, 16)) : [];
const asHex = (data: readonly number[]) => data.map(n => n.toString(16).padStart(2, "0")).join("").toUpperCase();
type Packet = NonNullable<SimulatedComponentState["packets"]>[number];

/** S2C Zigbee host mode: API 1/2, transmit request, receive packet, and local AT frames. */
export class XBeeModel {
  private decoder = new XBeeFrameDecoder();
  private output: number[] = [];
  private pending: { at: number; frameId: number; payload: number[]; success: boolean }[] = [];
  private pan?: number;
  private powered = false;
  private awake = false;
  private associatedAt = Infinity;
  packets: Packet[] = [];
  error = "";
  get associated() { return this.powered && this.awake && this.associatedAt === 0; }
  reset() { this.decoder.reset(); this.output = []; this.pending = []; this.pan = undefined; this.powered = false; this.awake = false; this.associatedAt = Infinity; this.packets = []; this.error = ""; }
  private compatible(c: CircuitComponent) { return c.properties?.peerEnabled !== false && (this.pan ?? Number(c.properties?.panId ?? 4660)) === Number(c.properties?.peerPanId ?? 4660); }
  private escaped(c: CircuitComponent) { return Number(c.properties?.apiMode ?? 2) === 2; }
  private frame(data: readonly number[], c: CircuitComponent) { this.output.push(...encodeXBeeFrame(data, this.escaped(c))); }
  private record(time: number, direction: "tx" | "rx", data: readonly number[], status: string) {
    this.packets.push({ timeMs: time, direction, payload: new TextDecoder().decode(new Uint8Array(data)), status }); this.packets = this.packets.slice(-100);
  }
  tick(c: CircuitComponent, time: number, powered: boolean, awake: boolean) {
    if (!powered) { if (this.powered) this.reset(); return; }
    if (!this.powered) this.associatedAt = time + 100;
    this.powered = powered; this.awake = awake;
    if (!this.compatible(c)) this.associatedAt = Infinity;
    else if (this.associatedAt === Infinity) this.associatedAt = time + 100;
    else if (awake && this.associatedAt > 0 && time >= this.associatedAt) { this.associatedAt = 0; this.frame([0x8a, 2], c); }
    if (!awake) return;
    for (const tx of this.pending.filter(tx => time >= tx.at)) {
      const delivered = tx.success && this.associated && this.compatible(c);
      this.record(tx.at, "tx", tx.payload, delivered ? "Delivered to Zigbee virtual peer" : "Zigbee delivery failed");
      if (tx.frameId) this.frame([0x8b, tx.frameId, 0xff, 0xfe, 0, delivered ? 0 : 0x24, 0], c);
    }
    this.pending = this.pending.filter(tx => time < tx.at);
  }
  write(data: readonly number[], c: CircuitComponent, time: number, hostConnected: boolean) {
    if (!this.powered || !this.awake || !hostConnected) return 0;
    for (const byte of data) {
      const frame = this.decoder.push(byte, this.escaped(c));
      if (this.decoder.error) this.error = "Invalid API frame length or checksum.";
      if (frame) this.request(frame, c, time);
    }
    return data.length;
  }
  private request(frame: number[], c: CircuitComponent, time: number) {
    if (frame[0] === 0x10 && frame.length >= 14) {
      const destination = asHex(frame.slice(2, 10)), expected = String(c.properties?.destination ?? "0013A20000000001").toUpperCase();
      const broadcast = destination === "000000000000FFFF";
      const payload = frame.slice(14);
      const success = this.associated && this.compatible(c) && (destination === expected || broadcast) && payload.length <= 84;
      this.pending.push({ at: time + Math.max(1, payload.length), frameId: frame[1], payload, success }); return;
    }
    if (frame[0] === 0x08 && frame.length >= 4) {
      const command = String.fromCharCode(frame[2], frame[3]), parameter = frame.slice(4);
      let status = 0, result: number[] = [];
      if (command === "AI") result = [this.associated ? 0 : 0x21];
      else if (command === "ID") {
        if (parameter.length) { this.pan = parameter.reduce((value, byte) => value * 256 + byte, 0); this.associatedAt = time + 100; }
        else { const pan = this.pan ?? Number(c.properties?.panId ?? 4660); result = [0, 0, 0, 0, 0, 0, pan >> 8 & 255, pan & 255]; }
      } else if (command === "SH") result = [0, 0x13, 0xa2, 0];
      else if (command === "SL") result = [0, 0, 0, 2];
      else if (command === "AP") result = [this.escaped(c) ? 2 : 1];
      else status = 2;
      if (frame[1]) this.frame([0x88, frame[1], frame[2], frame[3], status, ...result], c);
      return;
    }
    this.error = `Unsupported Zigbee API frame 0x${(frame[0] ?? 0).toString(16)}. Use 0x10 transmit or 0x08 local AT.`;
  }
  available(hostConnected: boolean) { return this.powered && this.awake && hostConnected ? this.output.length : 0; }
  read(hostConnected: boolean) { return this.available(hostConnected) ? this.output.shift()! : -1; }
  inject(data: readonly number[], c: CircuitComponent, time: number, hostConnected: boolean) {
    const source = addressBytes(String(c.properties?.destination ?? "0013A20000000001"));
    const delivered = hostConnected && this.associated && this.compatible(c) && data.length <= 84 && source.length === 8;
    this.record(time, "rx", data, delivered ? "Received Zigbee packet" : "Not delivered: association, sleep, host wiring, address, or packet size");
    if (delivered) this.frame([0x90, ...source, 0xff, 0xfe, 1, ...data], c);
    return delivered;
  }
}
