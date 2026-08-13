import type {
  CircuitProject,
  ConnectionEndpoint,
} from "../circuit/types.ts";
import { parseUnoPinLabel } from "./pins.ts";
import type { SimulatorSnapshot } from "./types.ts";
import type { SimulatedComponentState, SimulatorDiagnostic } from "./types.ts";

export interface LedCircuitBinding {
  anodeBoardPins: ReadonlyArray<string>;
  cathodeBoardPins: ReadonlyArray<string>;
}

export interface BuzzerCircuitBinding {
  positiveBoardPins: ReadonlyArray<string>;
  negativeBoardPins: ReadonlyArray<string>;
}

type ElectricalGraph = {
  adjacency: Map<string, Set<string>>;
  endpoints: Map<string, ConnectionEndpoint>;
  componentTypes: Map<string, string>;
};

const UNO_HIGH_SUPPLY_PINS = new Set(["5V", "3V3", "IOREF"]);

function endpointKey(endpoint: ConnectionEndpoint) {
  return `${endpoint.componentId}\u0000${endpoint.pin}`;
}

function registerEndpoint(graph: ElectricalGraph, endpoint: ConnectionEndpoint) {
  const key = endpointKey(endpoint);
  graph.endpoints.set(key, endpoint);
  if (!graph.adjacency.has(key)) graph.adjacency.set(key, new Set());
  return key;
}

function connectEndpoints(
  graph: ElectricalGraph,
  first: ConnectionEndpoint,
  second: ConnectionEndpoint,
) {
  const firstKey = registerEndpoint(graph, first);
  const secondKey = registerEndpoint(graph, second);
  graph.adjacency.get(firstKey)?.add(secondKey);
  graph.adjacency.get(secondKey)?.add(firstKey);
}

function buildElectricalGraph(project: CircuitProject): ElectricalGraph {
  const graph: ElectricalGraph = {
    adjacency: new Map(),
    endpoints: new Map(),
    componentTypes: new Map(
      project.components.map((component) => [component.id, component.type]),
    ),
  };

  project.connections.forEach((connection) => {
    connectEndpoints(graph, connection.from, connection.to);
  });

  // Wires meet on catalog pins, while a resistor conducts between its two pins.
  // LEDs are deliberately not bridged here: their anode and cathode must be
  // evaluated separately to preserve polarity.
  project.components.forEach((component) => {
    if (component.type === "resistor") {
      connectEndpoints(
        graph,
        { componentId: component.id, pin: "1" },
        { componentId: component.id, pin: "2" },
      );
    }
  });

  return graph;
}

function reachableBoardPins(
  graph: ElectricalGraph,
  start: ConnectionEndpoint,
): string[] {
  const startKey = registerEndpoint(graph, start);
  const queue = [startKey];
  const visited = new Set<string>();
  const boardPins = new Set<string>();

  while (queue.length > 0) {
    const key = queue.shift();
    if (!key || visited.has(key)) continue;
    visited.add(key);

    const endpoint = graph.endpoints.get(key);
    if (!endpoint) continue;
    const componentType = graph.componentTypes.get(endpoint.componentId);
    if (componentType === "ground") {
      boardPins.add("GND");
      continue;
    }
    if (componentType === "arduino-uno") {
      boardPins.add(endpoint.pin);
      continue;
    }

    graph.adjacency.get(key)?.forEach((neighbor) => {
      if (!visited.has(neighbor)) queue.push(neighbor);
    });
  }

  return [...boardPins].sort();
}

/** Resolve any component pin through wires/passive parts to Arduino pins or rails. */
export function resolveComponentBoardPins(
  project: CircuitProject,
  componentId: string,
  pin: string,
): ReadonlyArray<string> {
  return reachableBoardPins(buildElectricalGraph(project), { componentId, pin });
}

/** Resolve only addressable Uno I/O pins, excluding supply and ground rails. */
export function resolveComponentIoPins(
  project: CircuitProject,
  componentId: string,
  pin: string,
): ReadonlyArray<string> {
  return resolveComponentBoardPins(project, componentId, pin).filter(
    (boardPin) => parseUnoPinLabel(boardPin) !== undefined,
  );
}

/** Resolve each two-lead LED to the Uno pins connected to either side. */
export function resolveLedCircuitBindings(
  project: CircuitProject,
): ReadonlyMap<string, LedCircuitBinding> {
  const graph = buildElectricalGraph(project);
  const bindings = new Map<string, LedCircuitBinding>();

  project.components.forEach((component) => {
    if (component.type !== "led") return;
    bindings.set(component.id, {
      anodeBoardPins: reachableBoardPins(graph, {
        componentId: component.id,
        pin: "A",
      }),
      cathodeBoardPins: reachableBoardPins(graph, {
        componentId: component.id,
        pin: "K",
      }),
    });
  });

  return bindings;
}

/** Resolve each buzzer's positive and negative terminals to their Uno rails. */
export function resolveBuzzerCircuitBindings(
  project: CircuitProject,
): ReadonlyMap<string, BuzzerCircuitBinding> {
  const graph = buildElectricalGraph(project);
  const bindings = new Map<string, BuzzerCircuitBinding>();
  project.components.forEach((component) => {
    if (component.type !== "buzzer") return;
    bindings.set(component.id, {
      positiveBoardPins: reachableBoardPins(graph, { componentId: component.id, pin: "+" }),
      negativeBoardPins: reachableBoardPins(graph, { componentId: component.id, pin: "-" }),
    });
  });
  return bindings;
}

function boardPinLevel(
  pin: string,
  snapshot: SimulatorSnapshot,
): 0 | 1 | undefined {
  const normalized = pin.trim().toUpperCase();
  if (/^GND\d*$/.test(normalized)) return 0;
  if (UNO_HIGH_SUPPLY_PINS.has(normalized)) return 1;

  const number = parseUnoPinLabel(normalized);
  return number === undefined ? undefined : snapshot.pins[number]?.digitalValue;
}

/** True when the LED has a higher anode level than its cathode level. */
export function isLedCircuitPowered(
  binding: LedCircuitBinding | undefined,
  snapshot: SimulatorSnapshot,
): boolean {
  if (!binding) return false;
  const anodeHigh = binding.anodeBoardPins.some(
    (pin) => boardPinLevel(pin, snapshot) === 1,
  );
  const cathodeLow = binding.cathodeBoardPins.some(
    (pin) => boardPinLevel(pin, snapshot) === 0,
  );
  return anodeHigh && cathodeLow;
}

/** True while voltage is actively applied across a buzzer's terminals. */
export function isBuzzerCircuitPowered(
  binding: BuzzerCircuitBinding | undefined,
  snapshot: SimulatorSnapshot,
): boolean {
  if (!binding) return false;
  return binding.positiveBoardPins.some((pin) => boardPinLevel(pin, snapshot) === 1)
    && binding.negativeBoardPins.some((pin) => boardPinLevel(pin, snapshot) === 0);
}

export interface CircuitSolution {
  digitalInputs: Readonly<Record<number, 0 | 1>>;
  analogInputs: Readonly<Record<number, number>>;
  componentStates: Readonly<Record<string, SimulatedComponentState>>;
  diagnostics: ReadonlyArray<SimulatorDiagnostic>;
}

class DisjointSets {
  private readonly parent = new Map<string, string>();
  add(value: string) { if (!this.parent.has(value)) this.parent.set(value, value); }
  find(value: string): string {
    this.add(value);
    const parent = this.parent.get(value)!;
    if (parent === value) return value;
    const root = this.find(parent);
    this.parent.set(value, root);
    return root;
  }
  join(a: string, b: string) {
    const ar = this.find(a); const br = this.find(b);
    if (ar !== br) this.parent.set(br, ar);
  }
}

type NetReading = { value?: number; conflict: boolean };

/**
 * Solves the catalog's logical/voltage-level circuit model. This intentionally
 * is not SPICE: values are normalized to 0..1 and active devices are evaluated
 * to a stable fixed point.
 */
export function solveCircuit(
  project: CircuitProject,
  snapshot: SimulatorSnapshot,
): CircuitSolution {
  const sets = new DisjointSets();
  const key = (componentId: string, pin: string) => endpointKey({ componentId, pin });
  project.connections.forEach(({ from, to }) => sets.join(endpointKey(from), endpointKey(to)));
  project.components.forEach((component) => {
    const join = (a: string, b: string) => sets.join(key(component.id, a), key(component.id, b));
    if (component.type === "resistor") join("1", "2");
    if (component.type === "push-button") {
      const closed = (component.properties?.pressed === true) !== (component.properties?.normallyClosed === true);
      if (closed) join("1", "2");
    }
    if (component.type === "toggle-switch") join("COM", component.properties?.position === true ? "NO" : "NC");
  });

  const base = new Map<string, number[]>();
  const drive = (componentId: string, pin: string, value: number) => {
    const root = sets.find(key(componentId, pin));
    const values = base.get(root) ?? [];
    values.push(Math.min(1, Math.max(0, value)));
    base.set(root, values);
  };
  project.components.forEach((component) => {
    if (component.type === "ground") drive(component.id, "GND", 0);
    if (component.type !== "arduino-uno") return;
    ["GND", "GND2", "GND3"].forEach((pin) => drive(component.id, pin, 0));
    ["5V", "3V3", "IOREF"].forEach((pin) => drive(component.id, pin, 1));
    snapshot.pins.forEach((pin) => {
      if (pin.mode === "OUTPUT") drive(component.id, pin.label, pin.pwmValue / 255);
    });
  });

  const derived = new Map<string, number>();
  const activeConflictRoots = new Set<string>();
  const reading = (componentId: string, pin: string): NetReading => {
    const root = sets.find(key(componentId, pin));
    const values = [...(base.get(root) ?? [])];
    const extra = derived.get(root);
    if (extra !== undefined) values.push(extra);
    if (!values.length) return { conflict: false };
    const min = Math.min(...values); const max = Math.max(...values);
    return { value: values.reduce((sum, item) => sum + item, 0) / values.length, conflict: activeConflictRoots.has(root) || max - min > 0.2 };
  };
  const high = (id: string, pin: string) => (reading(id, pin).value ?? 0) >= 0.5;
  const low = (id: string, pin: string) => reading(id, pin).value !== undefined && (reading(id, pin).value ?? 1) < 0.5;
  const powered = (id: string) => high(id, "VCC") && low(id, "GND");
  const activeTypes = new Set(["logic-and", "logic-or", "logic-xor", "logic-nand", "logic-nor", "logic-not", "l293d"]);
  let stable = false;
  for (let iteration = 0; iteration < 32; iteration += 1) {
    const next = new Map<string, number>();
    activeConflictRoots.clear();
    const output = (id: string, pin: string, value: number) => {
      const root = sets.find(key(id, pin));
      const current = next.get(root);
      if (current !== undefined && Math.abs(current - value) > 0.2) activeConflictRoots.add(root);
      next.set(root, current === undefined ? value : (current + value) / 2);
    };
    project.components.forEach((component) => {
      const { id, type } = component;
      if (type === "potentiometer") {
        const supply = reading(id, "VCC").value; const ground = reading(id, "GND").value;
        const position = Math.min(100, Math.max(0, Number(component.properties?.value ?? 50)));
        if (supply !== undefined && ground !== undefined) output(id, "SIG", ground + (supply - ground) * position / 100);
      }
      if (type.startsWith("logic-") && powered(id)) {
        const a = high(id, "A"); const b = high(id, "B");
        const value = type === "logic-and" ? a && b
          : type === "logic-or" ? a || b
            : type === "logic-xor" ? a !== b
              : type === "logic-nand" ? !(a && b)
                : type === "logic-nor" ? !(a || b)
                  : !a;
        output(id, "Y", value ? 1 : 0);
      }
      if (type === "l293d" && high(id, "VSS") && high(id, "VS") && low(id, "GND1") && low(id, "GND2") && low(id, "GND3") && low(id, "GND4")) {
        [["EN1", "IN1", "OUT1"], ["EN1", "IN2", "OUT2"], ["EN2", "IN3", "OUT3"], ["EN2", "IN4", "OUT4"]].forEach(([enable, input, out]) => {
          const duty = reading(id, enable).value ?? 0;
          if (duty > 0) output(id, out, high(id, input) ? duty : 0);
        });
      }
    });
    stable = next.size === derived.size && [...next].every(([root, value]) => derived.get(root) === value);
    derived.clear(); next.forEach((value, root) => derived.set(root, value));
    if (stable) break;
  }

  const diagnostics: SimulatorDiagnostic[] = [];
  if (!stable && project.components.some((item) => activeTypes.has(item.type))) diagnostics.push({ severity: "error", code: "circuit-unstable", message: "The connected logic did not settle; check for an unclocked feedback loop." });
  if (activeConflictRoots.size > 0 || [...base.keys()].some((root) => {
    const values = [...(base.get(root) ?? [])];
    const active = derived.get(root); if (active !== undefined) values.push(active);
    return values.length > 1 && Math.max(...values) - Math.min(...values) > 0.2;
  })) diagnostics.push({ severity: "error", code: "output-contention", message: "A circuit net is being driven to conflicting voltage levels." });
  const componentStates: Record<string, SimulatedComponentState> = {};
  const level = (id: string, pin: string) => {
    const item = reading(id, pin);
    return item.conflict ? "conflict" : item.value === undefined ? "floating" : item.value >= 0.5 ? "high" : "low";
  };
  project.components.forEach((component) => {
    const { id, type } = component;
    if (type.startsWith("logic-")) {
      const isPowered = powered(id);
      componentStates[id] = { type, powered: isPowered, level: isPowered ? level(id, "Y") : "floating" };
      if (!isPowered) diagnostics.push({ severity: "warning", code: "component-unpowered", message: `${component.label} needs VCC and GND.` });
      ["A", ...(type === "logic-not" ? [] : ["B"])].forEach((pin) => {
        if (reading(id, pin).value === undefined) diagnostics.push({ severity: "warning", code: "floating-input", message: `${component.label} input ${pin} is floating.` });
      });
    } else if (type === "rgb-led") {
      const common = reading(id, "COM").value;
      const channels = Object.fromEntries(["R", "G", "B"].map((pin) => [pin, common !== undefined ? Math.max(0, (reading(id, pin).value ?? 0) - common) : 0]));
      componentStates[id] = { type, powered: Object.values(channels).some((value) => value > 0.01), channels };
    } else if (type === "seven-segment") {
      const commonLow = (reading(id, "COM").value ?? 1) < 0.5;
      const segments = ["A", "B", "C", "D", "E", "F", "G", "DP"].filter((pin) => commonLow && high(id, pin));
      componentStates[id] = { type, powered: segments.length > 0, segments };
    } else if (type === "potentiometer") {
      const supply = reading(id, "VCC").value; const ground = reading(id, "GND").value;
      const position = Math.min(100, Math.max(0, Number(component.properties?.value ?? 50)));
      const analogValue = supply !== undefined && ground !== undefined ? ground + (supply - ground) * position / 100 : 0;
      derived.set(sets.find(key(id, "SIG")), analogValue);
      componentStates[id] = { type, powered: supply !== undefined && ground !== undefined, analogValue: Math.round(analogValue * 1023) };
    } else if (type === "toggle-switch") {
      componentStates[id] = { type, powered: reading(id, "COM").value !== undefined, position: component.properties?.position === true };
    } else if (type === "l293d") {
      const isPowered = high(id, "VSS") && high(id, "VS") && ["GND1", "GND2", "GND3", "GND4"].every((pin) => low(id, pin));
      componentStates[id] = { type, powered: isPowered, channels: { OUT1: reading(id, "OUT1").value ?? 0, OUT2: reading(id, "OUT2").value ?? 0, OUT3: reading(id, "OUT3").value ?? 0, OUT4: reading(id, "OUT4").value ?? 0 } };
      if (!isPowered) diagnostics.push({ severity: "warning", code: "component-unpowered", message: `${component.label} needs VSS, VS, and all four ground pins connected.` });
    } else if (type === "dc-motor") {
      const positive = reading(id, "+").value; const negative = reading(id, "-").value;
      const delta = (positive ?? 0) - (negative ?? 0); const speed = Math.min(1, Math.abs(delta));
      componentStates[id] = { type, powered: speed > 0.01, direction: speed <= 0.01 ? (positive !== undefined && negative !== undefined ? "brake" : "coast") : delta > 0 ? "forward" : "reverse", speed };
    }
  });

  const digitalInputs: Record<number, 0 | 1> = {}; const analogInputs: Record<number, number> = {};
  project.components.filter((item) => item.type === "arduino-uno").forEach((board) => snapshot.pins.forEach((pin) => {
    if (pin.mode === "OUTPUT") return;
    const item = reading(board.id, pin.label);
    if (item.value === undefined || item.conflict) return;
    digitalInputs[pin.number] = item.value >= 0.5 ? 1 : 0;
    analogInputs[pin.number] = Math.round(item.value * 1023);
  }));
  return { digitalInputs, analogInputs, componentStates, diagnostics };
}
