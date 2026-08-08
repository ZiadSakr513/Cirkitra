import type {
  CircuitProject,
  ConnectionEndpoint,
} from "../circuit/types.ts";
import { parseUnoPinLabel } from "./pins.ts";
import type { SimulatorSnapshot } from "./types.ts";

export interface LedCircuitBinding {
  anodeBoardPins: ReadonlyArray<string>;
  cathodeBoardPins: ReadonlyArray<string>;
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
    if (graph.componentTypes.get(endpoint.componentId) === "arduino-uno") {
      boardPins.add(endpoint.pin);
      continue;
    }

    graph.adjacency.get(key)?.forEach((neighbor) => {
      if (!visited.has(neighbor)) queue.push(neighbor);
    });
  }

  return [...boardPins].sort();
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
