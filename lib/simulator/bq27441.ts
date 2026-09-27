export interface GaugeReadings { voltage: number; current: number; temperature: number; soc: number; capacityMah: number }

/** BQ27441-G1A standard command words and STATE data block. Current is positive into the cell. */
export class Bq27441Model {
  private readings?: GaugeReadings;
  private designCapacity?: number;
  private control = 0;
  private controlLow = 0;
  private dataClass = 0;
  private dataBlock = new Uint8Array(32);
  private config = false;
  private inserted = true;
  private por = true;
  reset() { this.readings = undefined; this.designCapacity = undefined; this.control = 0; this.controlLow = 0; this.dataClass = 0; this.dataBlock.fill(0); this.config = false; this.inserted = true; this.por = true; }
  update(readings?: GaugeReadings) { this.readings = readings; }
  get flags() {
    const r = this.readings;
    return (this.por ? 32 : 0) | (this.config ? 16 : 0) | (r && this.inserted ? 8 : 0) | (r && r.current < 0 ? 1 : 0) | (r && r.soc <= 10 ? 4 : 0) | (r && r.soc <= 5 ? 2 : 0) | (r && r.soc >= 99.5 ? 512 : 0) | (r && r.soc < 99.5 ? 256 : 0) | (r && r.temperature > 60 ? 0x8000 : 0) | (r && r.temperature < 0 ? 0x4000 : 0);
  }
  setCapacity(value: number) { if (!Number.isInteger(value) || value < 1 || value > 65535) return false; this.designCapacity = value; return true; }
  setConfig(enabled: boolean) { this.config = enabled; if (!enabled) this.por = false; }
  word(register: number): number {
    const r = this.readings;
    if (register === 0) return this.control === 1 ? 0x0421 : 0x0082;
    if (register === 6) return this.flags;
    if (!r) return 0;
    const full = this.designCapacity ?? r.capacityMah, remaining = full * r.soc / 100;
    const words: Record<number, number> = { 2: (r.temperature + 273.15) * 10, 4: r.voltage * 1000, 8: remaining, 10: full, 12: remaining, 14: full, 16: r.current * 1000, 18: r.current * 1000, 20: r.current * 1000, 24: r.voltage * r.current * 1000, 28: r.soc, 30: (r.temperature + 273.15) * 10, 40: remaining, 42: remaining, 44: full, 46: full, 48: r.soc, 60: full };
    return Math.round(words[register] ?? 0) & 65535;
  }
  read(register: number) {
    if (register >= 0x40 && register < 0x60) return this.dataBlock[register - 0x40];
    if (register === 0x60) return 255 - (this.dataBlock.reduce((sum, byte) => sum + byte, 0) & 255);
    return this.word(register & ~1) >> (register & 1 ? 8 : 0) & 255;
  }
  write(register: number, value: number) {
    value &= 255;
    if (register === 0) this.controlLow = value;
    if (register === 1) {
      this.control = this.controlLow | value << 8;
      if (this.control === 0x13) this.setConfig(true);
      if ([0x42, 0x43, 0x44].includes(this.control)) this.setConfig(false);
      if (this.control === 0x41) { const readings = this.readings; this.reset(); this.readings = readings; }
      if (this.control === 0x0c) this.inserted = true;
      if (this.control === 0x0d) this.inserted = false;
    }
    if (register === 0x3e) {
      this.dataClass = value; this.dataBlock.fill(0);
      if (value === 82) { const capacity = this.designCapacity ?? this.readings?.capacityMah ?? 2000; this.dataBlock[10] = capacity >> 8; this.dataBlock[11] = capacity; }
    }
    if (this.config && register >= 0x40 && register < 0x60) this.dataBlock[register - 0x40] = value;
    if (this.config && register === 0x60 && value === this.read(0x60) && this.dataClass === 82) this.setCapacity(this.dataBlock[10] << 8 | this.dataBlock[11]);
  }
}
