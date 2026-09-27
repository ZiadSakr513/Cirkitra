import { getComponentDefinition } from "../circuit/catalog.ts";
import { POWER_TERMINAL_GROUPS } from "../circuit/terminal-groups.ts";
import type { CircuitComponent, CircuitProject } from "../circuit/types.ts";
import type { SimulatorSnapshot, UnoPinState } from "./types.ts";

const endpoint = (id: string, pin: string) => `${id}:${pin}`;
/** Connectivity for transactions is distinct from resistor conduction: pull-ups do not join buses. */
export class DeviceWiring {
  private graph = new Map<string, Set<string>>();
  constructor(readonly project: CircuitProject, readonly pins: readonly UnoPinState[], bridges: NonNullable<SimulatorSnapshot["deviceBridges"]> = [], private dcVoltage?: (id: string, pin: string) => number | undefined) {
    const join = (a: string, b: string) => {
      if (!this.graph.has(a)) this.graph.set(a, new Set());
      if (!this.graph.has(b)) this.graph.set(b, new Set());
      this.graph.get(a)!.add(b); this.graph.get(b)!.add(a);
    };
    project.connections.forEach(w => join(endpoint(w.from.componentId, w.from.pin), endpoint(w.to.componentId, w.to.pin)));
    for (const c of project.components) for (const group of POWER_TERMINAL_GROUPS[c.type] ?? []) for (const pin of group.slice(1)) join(endpoint(c.id, group[0]), endpoint(c.id, pin));
    bridges.forEach(b => join(endpoint(b.componentId, b.from), endpoint(b.componentId, b.to)));
    project.components.filter(c => c.type === "arduino-uno").forEach(c => { join(endpoint(c.id, "SDA"), endpoint(c.id, "A4")); join(endpoint(c.id, "SCL"), endpoint(c.id, "A5")); });
  }
  net(id: string, pin: string): Set<string> {
    const pending = [endpoint(id, pin)]; const seen = new Set<string>();
    while (pending.length) { const item = pending.pop()!; if (seen.has(item)) continue; seen.add(item); pending.push(...this.graph.get(item) ?? []); }
    return seen;
  }
  connected(a: string, ap: string, b: string, bp: string) { return this.net(a, ap).has(endpoint(b, bp)); }
  wired(id: string, pin: string) { return this.net(id, pin).size > 1; }
  boardConnected(id: string, pin: string, boardPin: string) {
    return this.project.components.some(c => c.type === "arduino-uno" && this.connected(id, pin, c.id, boardPin));
  }
  voltage(id: string, pin: string): number | undefined {
    const net = this.net(id, pin); const values: number[] = [];
    for (const part of this.project.components) {
      const has = (p: string) => net.has(endpoint(part.id, p));
      if (part.type === "ground" && has("GND")) values.push(0);
      if (part.type === "arduino-uno") {
        if (["GND", "GND2", "GND3"].some(has)) values.push(0);
        if (["5V", "IOREF"].some(has)) values.push(5);
        if (has("3V3")) values.push(3.3);
        this.pins.filter(p => p.mode === "OUTPUT" && has(p.label)).forEach(p => values.push(5 * p.pwmValue / 255));
      }
    }
    return values.length ? Math.max(...values) - Math.min(...values) < 0.01 ? values[0] : undefined : this.dcVoltage?.(id, pin);
  }
  powered(c: CircuitComponent): boolean {
    const meta = getComponentDefinition(c.type)?.metadata;
    if (!meta) return false;
    return meta.supplies.every(s => s.pins.every(pin => {
      const v = this.voltage(c.id, pin); return v !== undefined && v >= s.minVolts && v <= s.maxVolts;
    })) && meta.groundPins.every(pin => this.voltage(c.id, pin) === 0);
  }
  pullup(id: string, pin: string): boolean {
    return this.project.components.some(c => c.type === "resistor" && ["1", "2"].some((lead, index) =>
      this.connected(id, pin, c.id, lead) && (this.voltage(c.id, index ? "1" : "2") ?? 0) > 2 && Number(c.properties?.resistance ?? 10000) > 0));
  }
  i2c(c: CircuitComponent, sda = "SDA", scl = "SCL"): boolean {
    return this.boardConnected(c.id, sda, "A4") && this.boardConnected(c.id, scl, "A5") && this.pullup(c.id, sda) && this.pullup(c.id, scl);
  }
  spi(c: CircuitComponent, cs: number, names = { mosi: "MOSI", miso: "MISO", sck: "SCK", cs: "NSS" }): boolean {
    return this.boardConnected(c.id, names.mosi, "D11") && this.boardConnected(c.id, names.miso, "D12") && this.boardConnected(c.id, names.sck, "D13") && this.boardConnected(c.id, names.cs, `D${cs}`);
  }
}
