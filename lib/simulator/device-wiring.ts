import { getComponentDefinition } from "../circuit/catalog.ts";
import { POWER_TERMINAL_GROUPS } from "../circuit/terminal-groups.ts";
import type { CircuitComponent, CircuitProject } from "../circuit/types.ts";
import type { SimulatorSnapshot, UnoPinState } from "./types.ts";
import { boardPinLabel, getBoardProfile, isBoardType, resolveBoardPin } from "../circuit/boards.ts";

const endpoint = (id: string, pin: string) => `${id}:${pin}`;
/** Connectivity for transactions is distinct from resistor conduction: pull-ups do not join buses. */
export class DeviceWiring {
  private graph = new Map<string, Set<string>>();
  constructor(readonly project: CircuitProject, readonly pins: readonly UnoPinState[], bridges: NonNullable<SimulatorSnapshot["deviceBridges"]> = [], private dcVoltage?: (id: string, pin: string) => number | undefined, private boardPins: SimulatorSnapshot["boardPins"] = {}, private controllerComponentId?: string, private controllerBoardType: string = project.board) {
    const join = (a: string, b: string) => {
      if (!this.graph.has(a)) this.graph.set(a, new Set());
      if (!this.graph.has(b)) this.graph.set(b, new Set());
      this.graph.get(a)!.add(b); this.graph.get(b)!.add(a);
    };
    project.connections.forEach(w => join(endpoint(w.from.componentId, w.from.pin), endpoint(w.to.componentId, w.to.pin)));
    for (const c of project.components) for (const group of POWER_TERMINAL_GROUPS[c.type] ?? []) for (const pin of group.slice(1)) join(endpoint(c.id, group[0]), endpoint(c.id, pin));
    bridges.forEach(b => join(endpoint(b.componentId, b.from), endpoint(b.componentId, b.to)));
    project.components.filter(c => isBoardType(c.type)).forEach(c => {
      const profile = getBoardProfile(c.type);
      const sda = profile?.constants.SDA;
      const scl = profile?.constants.SCL;
      if (sda !== undefined) join(endpoint(c.id, "SDA"), endpoint(c.id, boardPinLabel(c.type, sda)));
      if (scl !== undefined) join(endpoint(c.id, "SCL"), endpoint(c.id, boardPinLabel(c.type, scl)));
    });
  }
  private controllers() {
    return this.project.components.filter(component => isBoardType(component.type)
      && (this.controllerComponentId ? component.id === this.controllerComponentId : component.type === this.controllerBoardType));
  }
  net(id: string, pin: string): Set<string> {
    const pending = [endpoint(id, pin)]; const seen = new Set<string>();
    while (pending.length) { const item = pending.pop()!; if (seen.has(item)) continue; seen.add(item); pending.push(...this.graph.get(item) ?? []); }
    return seen;
  }
  connected(a: string, ap: string, b: string, bp: string) { return this.net(a, ap).has(endpoint(b, bp)); }
  wired(id: string, pin: string) { return this.net(id, pin).size > 1; }
  boardConnected(id: string, pin: string, runtimePin: number) {
    return this.controllers().some(board => {
      const boardPin = boardPinLabel(board.type, runtimePin);
      return resolveBoardPin(board.type, boardPin) !== undefined && this.connected(id, pin, board.id, boardPin);
    });
  }
  voltage(id: string, pin: string): number | undefined {
    const net = this.net(id, pin); const values: number[] = [];
    for (const part of this.project.components) {
      const has = (p: string) => net.has(endpoint(part.id, p));
      if (part.type === "ground" && has("GND")) values.push(0);
      if (isBoardType(part.type)) {
        const profile = getBoardProfile(part.type)!;
        if (profile.groundPins.some(has)) values.push(0);
        Object.entries(profile.rails).forEach(([rail, volts]) => { if (has(rail)) values.push(volts); });
        const boardPins = this.boardPins?.[part.id] ?? (part.type === this.project.board ? this.pins : []);
        boardPins.filter(p => p.mode === "OUTPUT" && has(p.label)).forEach(p => values.push(profile.logicVoltage * p.pwmValue / 255));
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
  i2c(c: CircuitComponent, sda = "SDA", scl = "SCL", requireExternalPullups = true): boolean {
    const wired = this.controllers().some(board => {
      const profile = isBoardType(board.type) ? getBoardProfile(board.type) : undefined;
      return profile?.i2c.some(bus => this.connected(c.id, sda, board.id, boardPinLabel(profile.id, bus.sda)) && this.connected(c.id, scl, board.id, boardPinLabel(profile.id, bus.scl))) ?? false;
    });
    return wired && (!requireExternalPullups || (this.pullup(c.id, sda) && this.pullup(c.id, scl)));
  }
  spi(c: CircuitComponent, cs: number | undefined, names = { mosi: "MOSI", miso: "MISO", sck: "SCK", cs: "NSS" }): boolean {
    return this.controllers().some(board => {
      const profile = isBoardType(board.type) ? getBoardProfile(board.type) : undefined;
      if (!profile) return false;
      const bus = profile.spi.find(candidate => this.connected(c.id, names.mosi, board.id, boardPinLabel(profile.id, candidate.mosi)) && this.connected(c.id, names.miso, board.id, boardPinLabel(profile.id, candidate.miso)) && this.connected(c.id, names.sck, board.id, boardPinLabel(profile.id, candidate.sck)));
      const chipSelectPins = cs === undefined ? profile.ioPins.filter(pin => !pin.reserved && (pin.signals ?? ["digital"]).includes("digital")).map(pin => pin.runtimePin) : [cs];
      return !!bus && chipSelectPins.some(runtimePin => this.connected(c.id, names.cs, board.id, boardPinLabel(profile.id, runtimePin)));
    });
  }
}
