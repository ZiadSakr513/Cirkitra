/** SHT3x-DIS command/state model. See Sensirion datasheet v7 and Alert Mode v3.1. */
export function shtCrc(data: readonly number[]): number {
  let crc = 255;
  for (const value of data) { crc ^= value; for (let i = 0; i < 8; i++) crc = ((crc << 1) ^ (crc & 128 ? 0x31 : 0)) & 255; }
  return crc;
}
const word = (value: number) => { const pair = [value >> 8 & 255, value & 255]; return [...pair, shtCrc(pair)]; };
const bounded = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const rawTemperature = (value: number) => Math.round((bounded(value, -45, 130) + 45) * 65535 / 175);
const rawHumidity = (value: number) => Math.round(bounded(value, 0, 100) * 65535 / 100);
const singleCommands: Record<number, number> = { 0x2400: 15, 0x240b: 6, 0x2416: 4, 0x2c06: 15, 0x2c0d: 6, 0x2c10: 4 };
const periodicCommands: Record<number, number> = { 0x2032: 2000, 0x2024: 2000, 0x202f: 2000, 0x2130: 1000, 0x2126: 1000, 0x212d: 1000, 0x2236: 500, 0x2220: 500, 0x222b: 500, 0x2334: 250, 0x2322: 250, 0x2329: 250, 0x2737: 100, 0x2721: 100, 0x272a: 100, 0x2b32: 250 };
const limitWrites: Record<number, number> = { 0x611d: 0, 0x6116: 1, 0x610b: 2, 0x6100: 3 };
const limitReads: Record<number, number> = { 0xe11f: 0, 0xe114: 1, 0xe109: 2, 0xe102: 3 };

export class Sht31Model {
  status = 0x8010;
  heater = false;
  readyAt = 0;
  temperature = NaN;
  humidity = NaN;
  private environment = { temperature: 25, humidity: 50 };
  private pending?: { temperature: number; humidity: number };
  private period = 0;
  private nextSample = 0;
  private response: number[] = [];
  private dataReady = false;
  private fetch = false;
  private limits = [0xcd33, 0xc92d, 0x3869, 0x3466];
  private tAlert = false;
  private hAlert = false;
  reset() {
    this.status = 0x8010; this.heater = false; this.readyAt = 0; this.temperature = NaN; this.humidity = NaN;
    this.pending = undefined; this.period = 0; this.response = []; this.dataReady = false; this.fetch = false;
    this.limits = [0xcd33, 0xc92d, 0x3869, 0x3466]; this.tAlert = false; this.hAlert = false;
  }
  tick(time: number, temperature: number, humidity: number) {
    this.environment = { temperature: bounded(temperature, -45, 130), humidity: bounded(humidity, 0, 100) };
    if (this.pending && time >= this.readyAt) {
      this.temperature = this.pending.temperature; this.humidity = this.pending.humidity; this.pending = undefined; this.dataReady = true;
      if (this.period) this.alerts();
    }
    if (this.period && time >= this.nextSample && !this.pending) {
      // Skip missed wall-clock frames without accumulating extra measurements.
      this.start(time, 15); this.nextSample = time + this.period;
    }
  }
  private start(time: number, duration: number) { this.pending = { ...this.environment }; this.readyAt = time + duration; this.dataReady = false; }
  private alerts() {
    const t = rawTemperature(this.temperature) >> 7, h = rawHumidity(this.humidity) >> 9;
    const evaluate = (value: number, limits: number[], previous: boolean) => {
      const [highSet, highClear, lowClear, lowSet] = limits;
      if (lowSet > highSet) return false;
      return value >= highSet || value <= lowSet || (previous && !(value < highClear && value > lowClear));
    };
    this.tAlert = evaluate(t, this.limits.map(v => v & 511), this.tAlert);
    this.hAlert = evaluate(h, this.limits.map(v => v >> 9), this.hAlert);
    this.status = (this.status & ~0x8c00) | (this.tAlert ? 0x400 : 0) | (this.hAlert ? 0x800 : 0) | (this.tAlert || this.hAlert || (this.status & 16) ? 0x8000 : 0);
  }
  /** Acknowledgment is 0 on success and 3 for invalid command/data. */
  write(data: readonly number[], time: number): number {
    if (data.length < 2) return 3;
    const command = data[0] << 8 | data[1]; this.response = []; this.fetch = false;
    if (singleCommands[command]) { this.period = 0; this.start(time, singleCommands[command]); return 0; }
    if (periodicCommands[command]) { this.period = periodicCommands[command]; this.nextSample = time + this.period; this.start(time, 15); return 0; }
    if (command === 0xe000) { this.fetch = true; return 0; }
    if (command === 0x3093) { this.period = 0; this.pending = undefined; return 0; }
    if (command === 0x30a2) { this.reset(); this.readyAt = time + 1; return 0; }
    if (command === 0x306d || command === 0x3066) { this.heater = command === 0x306d; this.status = this.heater ? this.status | 0x2000 : this.status & ~0x2000; return 0; }
    if (command === 0x3041) { this.status &= ~0x8c10; this.tAlert = false; this.hAlert = false; return 0; }
    if (command === 0xf32d) { this.response = word(this.status); return 0; }
    if (Object.hasOwn(limitReads, command)) { this.response = word(this.limits[limitReads[command]]); return 0; }
    if (Object.hasOwn(limitWrites, command)) {
      if (data.length !== 5 || shtCrc(data.slice(2, 4)) !== data[4]) { this.status |= 1; return 3; }
      this.limits[limitWrites[command]] = data[2] << 8 | data[3]; this.status &= ~1; return 0;
    }
    this.status |= 2; return 3;
  }
  read(count: number, time: number): number[] {
    if (this.response.length) return this.response.splice(0, count);
    if (!this.dataReady || time < this.readyAt || (this.period && !this.fetch)) return [];
    const result = [...word(rawTemperature(this.temperature)), ...word(rawHumidity(this.humidity))].slice(0, count);
    this.dataReady = false; this.fetch = false; return result;
  }
  /** The adapter captures a real sample, then blocks the sketch for its conversion time. */
  libraryMeasurement(time: number): { temperature: number; humidity: number; delay: number } {
    this.write([0x24, 0x00], time);
    return { ...this.environment, delay: 15 };
  }
}
