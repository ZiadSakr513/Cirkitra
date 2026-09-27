import type { CircuitComponent, CircuitProject } from "../circuit/types.ts";
import { POWER_TERMINAL_GROUPS } from "../circuit/terminal-groups.ts";
import type { SimulatedComponentState, SimulatorDiagnostic } from "./types.ts";

type Branch = { id: string; a: string; b: string; value: number };
const key = (id: string, pin: string) => `${id}:${pin}`;
const prop = (part: CircuitComponent, name: string, fallback: number) => Number(part.properties?.[name] ?? fallback);
export interface PowerResult {
  voltage(id: string, pin: string): number | undefined;
  current(id: string): number;
  states: Record<string, SimulatedComponentState>;
  diagnostics: SimulatorDiagnostic[];
}
/** Limited DC nodal solver. Current sources, resistors, ideal supplies, and switched returns. */
export class PowerRuntime {
  private charge = new Map<string, number>();
  private lastTime = 0;
  reset() { this.charge.clear(); this.lastTime = 0; }
  solve(project: CircuitProject, timeMs: number, controls: Readonly<Record<string, number>> = {}, charging: Readonly<Record<string, number>> = {}): PowerResult {
    const dt = Math.max(0, timeMs - this.lastTime) / 3600000; this.lastTime = timeMs;
    const parent = new Map<string, string>();
    const find = (p: string): string => { if (!parent.has(p)) parent.set(p, p); const root = parent.get(p)!; if (root === p) return p; const next = find(root); parent.set(p, next); return next; };
    const join = (a: string, b: string) => parent.set(find(a), find(b));
    for (const w of project.connections) join(key(w.from.componentId, w.from.pin), key(w.to.componentId, w.to.pin));
    const ground = "__ground";
    for (const c of project.components) {
      for (const group of POWER_TERMINAL_GROUPS[c.type] ?? []) for (const pin of group.slice(1)) join(key(c.id, group[0]), key(c.id, pin));
      if (c.type === "ground") join(key(c.id, "GND"), ground);
      if (c.type === "arduino-uno") for (const pin of ["GND", "GND2", "GND3"]) join(key(c.id, pin), ground);
    }
    const node = (id: string, pin: string) => find(key(id, pin));
    const sources: Branch[] = []; const resistors: Branch[] = []; const currents: Branch[] = [];
    const add = (list: Branch[], c: CircuitComponent, a: string, b: string, value: number, suffix = "") => list.push({ id: c.id + suffix, a: node(c.id, a), b: node(c.id, b), value });
    for (const c of project.components) {
      if (c.type === "arduino-uno") { add(sources, c, "5V", "GND", 5, ":5V"); add(sources, c, "3V3", "GND", 3.3, ":3V3"); }
      if (c.type === "dc-supply" && c.properties?.enabled !== false) add(sources, c, "+", "-", prop(c, "voltage", 5));
      if (c.type === "battery-cell") {
        if (!this.charge.has(c.id)) this.charge.set(c.id, Math.max(0, Math.min(100, prop(c, "initialSoc", 50))));
        const soc = this.charge.get(c.id)!;
        add(sources, c, "+", "-", soc < 5 ? 2.5 + soc * 0.112 : 3 + 1.2 * soc / 100);
        if (charging[c.id]) add(currents, c, "-", "+", charging[c.id], ":charge");
      }
      if (c.type === "resistor") add(resistors, c, "1", "2", Math.max(0.000001, prop(c, "resistance", 220)));
      if (c.type === "dc-load" && c.properties?.enabled !== false) add(resistors, c, "+", "-", Math.max(0.001, prop(c, "resistance", 100)));
      if (c.type === "ideal-mosfet") add(resistors, c, "D", "S", controls[c.id] ? 0.001 : 1e12);
      if (c.type === "bq24074") {
        if (controls[`${c.id}:input`]) add(sources, c, "IN", "OUT_10", controls[`${c.id}:drop`] ?? 0.6);
        else if (controls[`${c.id}:battery`]) add(resistors, c, "BAT_2", "OUT_10", 0.1);
        if (controls[`${c.id}:charge`]) add(currents, c, "IN", "VSS", controls[`${c.id}:charge`], ":charging");
      }
    }
    // Only grounded connected subgraphs are solvable; isolated nodes remain floating.
    const graph = new Map<string, Set<string>>();
    for (const branch of [...sources, ...resistors]) {
      if (branch.value >= 1e11) continue;
      if (!graph.has(branch.a)) graph.set(branch.a, new Set()); if (!graph.has(branch.b)) graph.set(branch.b, new Set());
      graph.get(branch.a)!.add(branch.b); graph.get(branch.b)!.add(branch.a);
    }
    const reference = find(ground), reachable = new Set([reference]), pending = [reference];
    while (pending.length) { const p = pending.pop()!; for (const next of graph.get(p) ?? []) if (!reachable.has(next)) { reachable.add(next); pending.push(next); } }
    const nodes = [...reachable].filter(n => n !== reference), indexes = new Map(nodes.map((n, i) => [n, i]));
    const activeSources = sources.filter(b => reachable.has(b.a) && reachable.has(b.b));
    const size = nodes.length + activeSources.length;
    const matrix = Array.from({ length: size }, () => Array(size + 1).fill(0) as number[]);
    const stamp = (a: string, b: string, g: number) => { const ai = indexes.get(a), bi = indexes.get(b); if (ai !== undefined) matrix[ai][ai] += g; if (bi !== undefined) matrix[bi][bi] += g; if (ai !== undefined && bi !== undefined) { matrix[ai][bi] -= g; matrix[bi][ai] -= g; } };
    resistors.filter(b => reachable.has(b.a) && reachable.has(b.b)).forEach(b => stamp(b.a, b.b, 1 / b.value));
    currents.forEach(b => { const a = indexes.get(b.a), z = indexes.get(b.b); if (a !== undefined) matrix[a][size] -= b.value; if (z !== undefined) matrix[z][size] += b.value; });
    activeSources.forEach((b, i) => {
      const row = nodes.length + i, a = indexes.get(b.a), z = indexes.get(b.b);
      if (a !== undefined) { matrix[a][row] += 1; matrix[row][a] += 1; }
      if (z !== undefined) { matrix[z][row] -= 1; matrix[row][z] -= 1; }
      matrix[row][size] = b.value;
    });
    let valid = true;
    for (let column = 0; column < size; column++) {
      let pivot = column; for (let row = column + 1; row < size; row++) if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row;
      if (Math.abs(matrix[pivot][column]) < 1e-12) { valid = false; break; }
      [matrix[pivot], matrix[column]] = [matrix[column], matrix[pivot]];
      const div = matrix[column][column]; for (let j = column; j <= size; j++) matrix[column][j] /= div;
      for (let row = 0; row < size; row++) if (row !== column) { const factor = matrix[row][column]; for (let j = column; j <= size; j++) matrix[row][j] -= factor * matrix[column][j]; }
    }
    const voltages = new Map<string, number>([[reference, 0]]);
    if (valid) nodes.forEach((n, i) => voltages.set(n, matrix[i][size]));
    const currentMap = new Map<string, number>();
    if (valid) activeSources.forEach((b, i) => currentMap.set(b.id, -matrix[nodes.length + i][size]));
    if (valid) resistors.forEach(b => currentMap.set(b.id, ((voltages.get(b.a) ?? 0) - (voltages.get(b.b) ?? 0)) / b.value));
    const states: Record<string, SimulatedComponentState> = {};
    for (const c of project.components.filter(c => ["battery-cell", "dc-supply", "dc-load", "ideal-mosfet"].includes(c.type))) {
      const a = voltages.get(node(c.id, c.type === "ideal-mosfet" ? "D" : "+")), b = voltages.get(node(c.id, c.type === "ideal-mosfet" ? "S" : "-"));
      const current = currentMap.get(c.id) ?? 0;
      if (c.type === "battery-cell") this.charge.set(c.id, Math.max(0, Math.min(100, this.charge.get(c.id)! - current * dt * 100000 / Math.max(1, prop(c, "capacityMah", 2000)))));
      states[c.id] = { type: c.type, powered: valid && a !== undefined && b !== undefined && Math.abs(a - b) > 0.001, status: valid ? "DC model" : "Power conflict", readings: { voltage: a !== undefined && b !== undefined ? a - b : 0, current, ...(c.type === "battery-cell" ? { soc: this.charge.get(c.id)!, remainingMah: this.charge.get(c.id)! / 100 * prop(c, "capacityMah", 2000), temperature: prop(c, "temperature", 25) } : {}) } };
    }
    return { voltage: (id, pin) => voltages.get(node(id, pin)), current: id => currentMap.get(id) ?? 0, states, diagnostics: valid ? [] : [{ severity: "error", code: "DC_POWER_CONFLICT", message: "The power circuit has contradictory sources or an unsupported ideal loop. Check sources, returns and sense resistors." }] };
  }
}
