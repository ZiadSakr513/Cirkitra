import { getComponentDefinition } from "../circuit/catalog.ts";
import type { CircuitProject } from "../circuit/types.ts";
import type { SimulatorSnapshot } from "./types.ts";
import { ELECTRICAL_MODELS, type ModelResult, type PinReading } from "./models.ts";
import { getBoardProfile, isBoardType } from "../circuit/boards.ts";

class Nets {
  private parent = new Map<string, string>();
  find(key: string): string {
    const parent = this.parent.get(key);
    if (!parent) { this.parent.set(key, key); return key; }
    if (parent === key) return key;
    const root = this.find(parent); this.parent.set(key, root); return root;
  }
  join(a: string, b: string) { const ar = this.find(a); const br = this.find(b); if (ar !== br) this.parent.set(br, ar); }
}
const key = (id: string, pin: string) => `${id}:${pin}`;
type Edge = [string, string];
type Drive = [string, number];
const signature = (edges: Edge[], drives: Drive[]) => JSON.stringify([edges, drives]);

export function solveNetwork(project: CircuitProject, snapshot: SimulatorSnapshot) {
  const edges: Edge[] = project.connections.map(w => [key(w.from.componentId, w.from.pin), key(w.to.componentId, w.to.pin)]);
  const base: Drive[] = [];
  snapshot.deviceBridges?.forEach(b => edges.push([key(b.componentId, b.from), key(b.componentId, b.to)]));
  snapshot.deviceDrives?.filter(d => !d.weak).forEach(d => base.push([key(d.componentId, d.pin), d.value]));
  const devices = project.components.map(component => ({ component, model: ELECTRICAL_MODELS[getComponentDefinition(component.type)?.simulation?.model ?? component.type] }));
  for (const { component: c, model } of devices) {
    const join = (a: string, b: string) => edges.push([key(c.id, a), key(c.id, b)]);
    for (const group of model?.internalGroups ?? []) group.slice(1).forEach(pin => join(group[0], pin));
    if (c.type === "resistor") join("1", "2");
    if (c.type === "push-button" && ((c.properties?.pressed === true) !== (c.properties?.normallyClosed === true))) join("1", "2");
    if (c.type === "toggle-switch") join("COM", c.properties?.position === true ? "NO" : "NC");
    if (c.type === "ground") base.push([key(c.id, "GND"), 0]);
    if (isBoardType(c.type)) {
      const profile = getBoardProfile(c.type)!;
      profile.groundPins.forEach(pin => base.push([key(c.id, pin), 0]));
      Object.keys(profile.rails).forEach(pin => base.push([key(c.id, pin), 1]));
      const boards = project.components.filter(item => item.type === c.type);
      const state = snapshot.boardPins?.[c.id]
        ?? (c.type === project.board && c.id === boards[0]?.id ? snapshot.pins : undefined);
      state?.forEach(pin => { if (pin.mode === "OUTPUT") base.push([key(c.id, pin.label), pin.pwmValue / 255]); });
    }
  }
  const wired = new Set(project.connections.flatMap(w => [key(w.from.componentId, w.from.pin), key(w.to.componentId, w.to.pin)]));
  const connected = (id: string, pin: string) => {
    const model = devices.find(device => device.component.id === id)?.model;
    const group = model?.internalGroups?.find(group => group.includes(pin)) ?? [pin];
    return group.some(member => wired.has(key(id, member)));
  };
  let dynamicEdges: Edge[] = []; let outputs: Drive[] = []; let stable = false;
  let readings = new Map<string, PinReading>(); let nets = new Nets();
  let results = new Map<string, ModelResult>();
  const reading = (id: string, pin: string): PinReading => readings.get(nets.find(key(id, pin))) ?? { conflict: false };
  for (let pass = 0; pass < 32; pass++) {
    // Rebuild topology every pass: changing a select line must disconnect the old channel.
    nets = new Nets(); [...edges, ...dynamicEdges].forEach(([a, b]) => nets.join(a, b));
    const values = new Map<string, number[]>();
    for (const [endpoint, value] of [...base, ...outputs]) {
      const root = nets.find(endpoint); const group = values.get(root) ?? []; group.push(value); values.set(root, group);
    }
    // A MCU's internal pull-up is weak: it leaves a floating input HIGH but
    // yields to a real wired low. Do not average it against an output drive.
    for (const board of project.components.filter(component => isBoardType(component.type))) {
      const pins = snapshot.boardPins?.[board.id]
        ?? (snapshot.primaryBoardId === board.id || (!snapshot.primaryBoardId && board.type === project.board && board.id === project.components.find(item => item.type === board.type)?.id) ? snapshot.pins : []);
      for (const pin of pins) if (pin.mode === "INPUT_PULLUP") {
        const root = nets.find(key(board.id, pin.label));
        if (!values.has(root)) values.set(root, [1]);
      }
    }
    readings = new Map([...values].map(([root, group]) => [root, { value: group.reduce((sum, value) => sum + value, 0) / group.length, conflict: Math.max(...group) - Math.min(...group) > 0.000001 }]));
    const nextEdges: Edge[] = []; const nextOutputs: Drive[] = [];
    results = new Map();
    for (const { component, model } of devices) {
      if (!model) continue;
      const result = model.evaluate({ component, read: pin => reading(component.id, pin), connected: pin => connected(component.id, pin) });
      results.set(component.id, result);
      result.bridges.forEach(([a, b]) => nextEdges.push([key(component.id, a), key(component.id, b)]));
      Object.entries(result.outputs).forEach(([pin, value]) => nextOutputs.push([key(component.id, pin), value]));
    }
    stable = signature(nextEdges, nextOutputs) === signature(dynamicEdges, outputs);
    if (stable) break;
    dynamicEdges = nextEdges; outputs = nextOutputs;
  }
  const componentById = new Map(project.components.map(component => [component.id, component]));
  const wireIdsByEdge = new Map<string, string[]>();
  const edgeKey = (left: string, right: string) => JSON.stringify(left < right ? [left, right] : [right, left]);
  for (const wire of project.connections) {
    const wireKey = edgeKey(key(wire.from.componentId, wire.from.pin), key(wire.to.componentId, wire.to.pin));
    const wireIds = wireIdsByEdge.get(wireKey) ?? [];
    wireIds.push(wire.id);
    wireIdsByEdge.set(wireKey, wireIds);
  }
  const findDrivePath = (start: string, target: string): string[] => {
    if (start === target) return [start];
    const adjacent = new Map<string, string[]>();
    for (const [left, right] of edges) {
      const from = adjacent.get(left) ?? []; from.push(right); adjacent.set(left, from);
      const to = adjacent.get(right) ?? []; to.push(left); adjacent.set(right, to);
    }
    const previous = new Map<string, { endpoint: string; label: string }>();
    const pending = [start];
    previous.set(start, { endpoint: "", label: "" });
    while (pending.length) {
      const current = pending.shift()!;
      for (const next of adjacent.get(current) ?? []) {
        if (previous.has(next)) continue;
        const wires = wireIdsByEdge.get(edgeKey(current, next));
        previous.set(next, { endpoint: current, label: wires?.length ? `wire ${wires.join("/")}` : "internal component link" });
        if (next === target) {
          const path = [target];
          let cursor = target;
          while (cursor !== start) {
            const step = previous.get(cursor)!;
            path.push(step.label, step.endpoint);
            cursor = step.endpoint;
          }
          return path.reverse();
        }
        pending.push(next);
      }
    }
    return [];
  };
  const conflictingDrives = new Map<string, Array<{ endpoint: string; value: number }>>();
  for (const [endpoint, value] of [...base, ...outputs]) {
    const root = nets.find(endpoint);
    if (!readings.get(root)?.conflict) continue;
    const group = conflictingDrives.get(root) ?? [];
    if (!group.some(drive => drive.endpoint === endpoint && drive.value === value)) group.push({ endpoint, value });
    conflictingDrives.set(root, group);
  }
  const describeDrive = ({ endpoint, value }: { endpoint: string; value: number }) => {
    const separator = endpoint.lastIndexOf(":");
    const id = endpoint.slice(0, separator); const pin = endpoint.slice(separator + 1);
    return `${componentById.get(id)?.label ?? id} ${pin}=${value >= 0.5 ? "HIGH" : "LOW"} (${Number(value.toFixed(3))})`;
  };
  const describeTerminal = (endpoint: string) => {
    const separator = endpoint.lastIndexOf(":");
    const id = endpoint.slice(0, separator); const pin = endpoint.slice(separator + 1);
    return `${componentById.get(id)?.label ?? id} ${pin}`;
  };
  const conflicts = [...conflictingDrives].map(([root, drives]) => {
    const terminals = [...new Set(edges.flatMap(([a, b]) => [a, b]).filter(endpoint => nets.find(endpoint) === root))];
    const orderedTerminals = [...new Set([...drives.map(drive => drive.endpoint), ...terminals])];
    const pins = orderedTerminals.slice(0, 20).map(describeTerminal);
    const opposing = drives.flatMap((left, index) => drives.slice(index + 1).filter(right => (left.value >= 0.5) !== (right.value >= 0.5)).map(right => [left, right] as const));
    const paths = opposing.slice(0, 2).flatMap(([left, right]) => {
      const path = findDrivePath(left.endpoint, right.endpoint);
      if (!path.length) return [];
      return [`source path ${path.map((part, index) => index % 2 === 0 ? describeTerminal(part) : `[${part}]`).join(" → ")}`];
    });
    return `${pins.length ? `connected pins ${pins.join(", ")}; ` : ""}${paths.length ? `${paths.join("; ")}; ` : ""}drives ${drives.map(describeDrive).join(", ")}`;
  });
  return { reading, results, stable, conflict: [...readings.values()].some(item => item.conflict), conflicts };
}
