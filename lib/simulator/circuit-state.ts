import type {
  CircuitProject,
  ConnectionEndpoint,
} from "../circuit/types.ts";
import { getComponentDefinition, simulationCapability } from "../circuit/catalog.ts";
import { solveNetwork } from "./network.ts";
import { STATEFUL_MODEL_REGISTRY } from "./stateful-models.ts";
import { POWER_MODEL_REGISTRY } from "./power-models.ts";
import { validatePartWiring } from "../circuit/electrical-metadata.ts";
import { resolveBoardPin, getBoardProfile, isBoardType } from "../circuit/boards.ts";
import type { SimulatorSnapshot } from "./types.ts";
import type { SimulatedComponentState, SimulatorDiagnostic } from "./types.ts";

export interface LedCircuitBinding {
  anodeBoardPins: ReadonlyArray<string>;
  cathodeBoardPins: ReadonlyArray<string>;
  anodeEndpoints?: ReadonlyArray<ResolvedBoardPin>;
  cathodeEndpoints?: ReadonlyArray<ResolvedBoardPin>;
}

export interface BuzzerCircuitBinding {
  positiveBoardPins: ReadonlyArray<string>;
  negativeBoardPins: ReadonlyArray<string>;
  positiveEndpoints?: ReadonlyArray<ResolvedBoardPin>;
  negativeEndpoints?: ReadonlyArray<ResolvedBoardPin>;
}

export interface ResolvedBoardPin {
  boardId: string;
  componentId: string;
  pin: string;
}

type ElectricalGraph = {
  adjacency: Map<string, Set<string>>;
  endpoints: Map<string, ConnectionEndpoint>;
  componentTypes: Map<string, string>;
};

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

function reachableBoardPinEndpoints(graph: ElectricalGraph, start: ConnectionEndpoint): ResolvedBoardPin[] {
  const startKey = registerEndpoint(graph, start);
  const queue = [startKey];
  const visited = new Set<string>();
  const boardPins = new Map<string, ResolvedBoardPin>();

  while (queue.length > 0) {
    const key = queue.shift();
    if (!key || visited.has(key)) continue;
    visited.add(key);

    const endpoint = graph.endpoints.get(key);
    if (!endpoint) continue;
    const componentType = graph.componentTypes.get(endpoint.componentId);
    if (componentType === "ground") {
      boardPins.set(`ground:${endpoint.componentId}:GND`, { boardId: "ground", componentId: endpoint.componentId, pin: "GND" });
    } else if (componentType && isBoardType(componentType)) {
      boardPins.set(`${componentType}:${endpoint.componentId}:${endpoint.pin}`, { boardId: componentType, componentId: endpoint.componentId, pin: endpoint.pin });
    }

    graph.adjacency.get(key)?.forEach((neighbor) => {
      if (!visited.has(neighbor)) queue.push(neighbor);
    });
  }

  return [...boardPins.values()].sort((a, b) => a.boardId.localeCompare(b.boardId) || a.componentId.localeCompare(b.componentId) || a.pin.localeCompare(b.pin));
}

function reachableBoardPins(graph: ElectricalGraph, start: ConnectionEndpoint): string[] {
  return [...new Set(reachableBoardPinEndpoints(graph, start).map(endpoint => endpoint.boardId === "ground" ? "GND" : endpoint.pin))].sort();
}

/** Resolve any component pin through wires/passive parts to Arduino pins or rails. */
export function resolveComponentBoardPins(
  project: CircuitProject,
  componentId: string,
  pin: string,
): ReadonlyArray<string> {
  return reachableBoardPins(buildElectricalGraph(project), { componentId, pin });
}

/** Resolve wiring while retaining which physical board pin each net reaches. */
export function resolveComponentBoardPinEndpoints(project: CircuitProject, componentId: string, pin: string): ReadonlyArray<ResolvedBoardPin> {
  return reachableBoardPinEndpoints(buildElectricalGraph(project), { componentId, pin });
}

/** Resolve only addressable Uno I/O pins, excluding supply and ground rails. */
export function resolveComponentIoPins(
  project: CircuitProject,
  componentId: string,
  pin: string,
): ReadonlyArray<string> {
  return resolveComponentBoardPinEndpoints(project, componentId, pin)
    .filter(endpoint => endpoint.boardId !== "ground" && resolveBoardPin(endpoint.boardId, endpoint.pin) !== undefined)
    .map(endpoint => endpoint.pin);
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
      anodeEndpoints: reachableBoardPinEndpoints(graph, { componentId: component.id, pin: "A" }),
      cathodeEndpoints: reachableBoardPinEndpoints(graph, { componentId: component.id, pin: "K" }),
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
      positiveEndpoints: reachableBoardPinEndpoints(graph, { componentId: component.id, pin: "+" }),
      negativeEndpoints: reachableBoardPinEndpoints(graph, { componentId: component.id, pin: "-" }),
    });
  });
  return bindings;
}

function boardPinLevel(
  pin: string | ResolvedBoardPin,
  snapshot: SimulatorSnapshot,
): 0 | 1 | undefined {
  const endpoint = typeof pin === "string" ? undefined : pin;
  const normalized = (endpoint?.pin ?? pin as string).trim().toUpperCase();
  if (/^GND\d*$/.test(normalized)) return 0;
  if (endpoint?.boardId === "ground") return 0;
  const boardId = endpoint?.boardId ?? snapshot.primaryBoardType ?? "arduino-uno";
  const profile = getBoardProfile(boardId);
  if (profile?.rails[normalized] !== undefined) return 1;
  const number = resolveBoardPin(boardId, normalized);
  if (number === undefined) return undefined;
  const pins = endpoint
    ? snapshot.boardPins?.[endpoint.componentId] ?? (snapshot.primaryBoardId === endpoint.componentId || (!snapshot.primaryBoardId && snapshot.primaryBoardType === endpoint.boardId) ? snapshot.pins : undefined)
    : snapshot.pins;
  return pins?.[number]?.digitalValue;
}

/** True when the LED has a higher anode level than its cathode level. */
export function isLedCircuitPowered(
  binding: LedCircuitBinding | undefined,
  snapshot: SimulatorSnapshot,
): boolean {
  if (!binding) return false;
  const anodeHigh = (binding.anodeEndpoints ?? binding.anodeBoardPins).some(
    (pin) => boardPinLevel(pin, snapshot) === 1,
  );
  const cathodeLow = (binding.cathodeEndpoints ?? binding.cathodeBoardPins).some(
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
  return (binding.positiveEndpoints ?? binding.positiveBoardPins).some((pin) => boardPinLevel(pin, snapshot) === 1)
    && (binding.negativeEndpoints ?? binding.negativeBoardPins).some((pin) => boardPinLevel(pin, snapshot) === 0);
}

/** True only while a buzzer is powered or toned during active simulation. */
export function isBuzzerActive(
  binding: BuzzerCircuitBinding | undefined,
  snapshot: SimulatorSnapshot,
): boolean {
  if (!binding || snapshot.status !== "running") return false;

  const toneActive = snapshot.tones.some(tone => tone.active && (binding.positiveEndpoints ?? []).some(endpoint =>
    endpoint.boardId === tone.boardId && (endpoint.componentId === tone.boardComponentId || (!tone.boardComponentId && endpoint.boardId === snapshot.primaryBoardType)) && resolveBoardPin(endpoint.boardId, endpoint.pin) === tone.pin));
  return toneActive || isBuzzerCircuitPowered(binding, snapshot);
}

export interface CircuitSolution {
  digitalInputs: Readonly<Record<number, 0 | 1>>;
  analogInputs: Readonly<Record<number, number>>;
  boardDigitalInputs: Readonly<Record<string, Readonly<Record<number, 0 | 1>>>>;
  boardAnalogInputs: Readonly<Record<string, Readonly<Record<number, number>>>>;
  componentStates: Readonly<Record<string, SimulatedComponentState>>;
  diagnostics: ReadonlyArray<SimulatorDiagnostic>;
}

/**
 * Solves the catalog's logical/voltage-level circuit model. This intentionally
 * is not SPICE: values are normalized to 0..1 and active devices are evaluated
 * to a stable fixed point.
 */
export function solveCircuit(
  project: CircuitProject,
  snapshot: SimulatorSnapshot,
): CircuitSolution {
  const network = solveNetwork(project, snapshot);
  const reading = network.reading;
  const high = (id: string, pin: string) => !reading(id, pin).conflict && (reading(id, pin).value ?? 0) >= 0.5;
  const low = (id: string, pin: string) => !reading(id, pin).conflict && reading(id, pin).value !== undefined && reading(id, pin).value! < 0.5;
  const powered = (id: string) => high(id, "VCC") && low(id, "GND");
  const diagnostics: SimulatorDiagnostic[] = validatePartWiring(project);
  if (!network.stable) diagnostics.push({ severity: "error", code: "circuit-unstable", message: "The circuit did not settle; check feedback and switched connections." });
  if (network.conflict) diagnostics.push({ severity: "error", code: "output-contention", message: "A circuit net is being driven to conflicting voltage levels." });
  const componentStates: Record<string, SimulatedComponentState> = {};
  const level = (id: string, pin: string) => {
    const item = reading(id, pin);
    return item.conflict ? "conflict" : item.value === undefined ? "floating" : item.value >= 0.5 ? "high" : "low";
  };
  project.components.forEach((component) => {
    const { id, type } = component;
    const definition = getComponentDefinition(type);
    if (isBoardType(type)) {
      // Board profiles are controller runtimes, not external loads that need
      // supply pins wired into their own component symbol.
      componentStates[id] = { type, powered: true };
    } else if (definition && simulationCapability(definition) === "unavailable") {
      componentStates[id] = { type, powered: false };
      diagnostics.push({ severity: "error", code: "component-unavailable", message: `${component.label} has no accepted simulation model yet. Its saved wiring is preserved; remove it from this circuit to run.` });
    } else if (definition?.simulation?.model && (STATEFUL_MODEL_REGISTRY[definition.simulation.model] || POWER_MODEL_REGISTRY[definition.simulation.model])) {
      // These models are evaluated by DeviceRuntime, not the combinational network.
      const state = snapshot.componentStates[id];
      componentStates[id] = state ?? { type, powered: false };
      if (STATEFUL_MODEL_REGISTRY[definition.simulation.model] && !state?.powered) diagnostics.push({ severity: "warning", code: "component-unpowered", message: `${component.label}: connect its supply and ground pins.` });
    } else if (definition?.simulation?.model) {
      const result = network.results.get(id);
      const isPowered = network.stable && !!result?.powered;
      componentStates[id] = type === "soil-moisture-sen0193"
        ? { type, powered: isPowered, status: isPowered ? "Monitoring" : "Unpowered", analogValue: Math.round((result?.outputs.AOUT ?? 0) * 1023), readings: isPowered ? { moisture: Number(component.properties?.moisture ?? 50) } : {} }
        : { type, powered: isPowered, channels: result?.outputs };
      if (!result?.powered) diagnostics.push({ severity: "warning", code: "component-unpowered", message: `${component.label}: connect its supply and ground pins.` });
      if (result?.missing.length) diagnostics.push({ severity: "warning", code: "floating-control", message: `${component.label}: undriven control or sense pins: ${[...new Set(result.missing)].join(", ")}.` });
    } else if (["hc-sr04", "temperature-sensor", "pir-sensor"].includes(type)) {
      const isPowered = network.stable && high(id, "VCC") && low(id, "GND");
      if (type === "temperature-sensor") {
        const temperature = Number(component.properties?.temperatureC ?? 24);
        const output = isPowered ? reading(id, "OUT").value : undefined;
        componentStates[id] = { type, powered: isPowered, ...(output === undefined ? {} : { analogValue: Math.round(output * 1023) }), readings: isPowered ? { temperatureC: temperature } : {} };
      } else if (type === "pir-sensor") {
        const motion = isPowered && component.properties?.motion === true;
        componentStates[id] = { type, powered: isPowered, level: !isPowered ? "floating" : motion ? "high" : "low", readings: isPowered ? { motion: Number(motion) } : {} };
      } else {
        const distance = Number(component.properties?.distanceCm ?? 100);
        componentStates[id] = { type, powered: isPowered, readings: isPowered ? { distanceCm: distance } : {} };
      }
      if (!isPowered) diagnostics.push({ severity: "warning", code: "component-unpowered", message: `${component.label}: connect its supply and ground pins.` });
    } else if (type === "led" || type === "buzzer") {
      const a = reading(id, type === "led" ? "A" : "+");
      const b = reading(id, type === "led" ? "K" : "-");
      componentStates[id] = { type, powered: network.stable && !a.conflict && !b.conflict && a.value !== undefined && b.value !== undefined && a.value - b.value > 0.01 };
    } else if (type.startsWith("logic-")) {
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
      componentStates[id] = { type, powered: supply !== undefined && ground !== undefined, analogValue: Math.round(analogValue * 1023) };
    } else if (type === "toggle-switch") {
      componentStates[id] = { type, powered: reading(id, "COM").value !== undefined, position: component.properties?.position === true };
    } else if (type === "l293d") {
      const groundPins = ["GND1", "GND2", "GND3", "GND4"];
      const connected = (pin: string) => project.connections.some(({ from, to }) =>
        (from.componentId === id && from.pin === pin) || (to.componentId === id && to.pin === pin));
      const isPowered = high(id, "VSS") && high(id, "VS") && low(id, "GND1");
      componentStates[id] = { type, powered: isPowered, channels: { OUT1: reading(id, "OUT1").value ?? 0, OUT2: reading(id, "OUT2").value ?? 0, OUT3: reading(id, "OUT3").value ?? 0, OUT4: reading(id, "OUT4").value ?? 0 } };
      if (!isPowered) diagnostics.push({ severity: "warning", code: "component-unpowered", message: `${component.label} needs VSS, VS, and a ground connection.` });
      else if (groundPins.some((pin) => !connected(pin))) {
        diagnostics.push({ severity: "warning", code: "motor-driver-ground-wiring", message: `${component.label}: connect all four ground pins for real hardware.` });
      }
      for (const [enable, outputs] of [["EN1", ["OUT1", "OUT2"]], ["EN2", ["OUT3", "OUT4"]]] as const) {
        if (!connected(enable) && outputs.some(connected)) {
          diagnostics.push({ severity: "warning", code: "motor-driver-enable-floating", message: `${component.label} ${enable} is disconnected; connect it to 5V or a PWM output to drive this motor.` });
        }
      }
    } else if (type === "dc-motor") {
      const positive = reading(id, "+").value; const negative = reading(id, "-").value;
      const delta = network.stable && !reading(id, "+").conflict && !reading(id, "-").conflict && positive !== undefined && negative !== undefined ? positive - negative : 0;
      const speed = Math.min(1, Math.abs(delta));
      componentStates[id] = { type, powered: speed > 0.01, direction: speed <= 0.01 ? (positive !== undefined && negative !== undefined ? "brake" : "coast") : delta > 0 ? "forward" : "reverse", speed };
    }
  });

  const digitalInputs: Record<number, 0 | 1> = {}; const analogInputs: Record<number, number> = {};
  const boardDigitalInputs: Record<string, Record<number, 0 | 1>> = {};
  const boardAnalogInputs: Record<string, Record<number, number>> = {};
  const boards = project.components.filter(item => isBoardType(item.type));
  boards.forEach(board => {
    const pins = snapshot.boardPins?.[board.id]
      ?? (snapshot.primaryBoardId === board.id || (!snapshot.primaryBoardId && board.type === project.board && board.id === boards.find(item => item.type === board.type)?.id) ? snapshot.pins : []);
    const digital: Record<number, 0 | 1> = {}; const analog: Record<number, number> = {};
    const adcMax = 2 ** (getBoardProfile(board.type)?.analogResolutionBits ?? 10) - 1;
    pins.forEach(pin => {
      if (pin.mode === "OUTPUT") return;
      const item = reading(board.id, pin.label);
      if (item.value === undefined || item.conflict) return;
      digital[pin.number] = item.value >= 0.5 ? 1 : 0;
      analog[pin.number] = Math.round(item.value * adcMax);
    });
    boardDigitalInputs[board.id] = digital;
    boardAnalogInputs[board.id] = analog;
    if (board.id === (snapshot.primaryBoardId ?? boards.find(item => item.type === project.board)?.id)) {
      Object.assign(digitalInputs, digital); Object.assign(analogInputs, analog);
    }
  });
  return { digitalInputs, analogInputs, boardDigitalInputs, boardAnalogInputs, componentStates, diagnostics };
}

/** Ignore motor-control floating warnings during sketch startup only when the
 * reported pins are physically wired to Uno I/O that has not been configured yet. */
export function isUninitializedMotorControlWarning(
  project: CircuitProject,
  snapshot: SimulatorSnapshot,
  diagnostic: SimulatorDiagnostic,
): boolean {
  if (diagnostic.code !== "floating-control" || snapshot.phase !== "setup") return false;
  const match = diagnostic.message.match(/^(.+?): undriven control or sense pins: (.+)\.$/);
  if (!match) return false;
  const driver = project.components.find(component => component.label === match[1]
    && ["tb6612fng", "drv8833", "l298", "l293d"].includes(component.type));
  if (!driver) return false;
  const missingPins = match[2].split(",").map(pin => pin.trim()).filter(Boolean);
  return missingPins.length > 0 && missingPins.every(pin => {
    const wires = project.connections.filter(connection =>
      [connection.from, connection.to].some(endpoint => endpoint.componentId === driver.id && endpoint.pin === pin));
    return wires.length > 0 && wires.every(connection => {
      const peer = connection.from.componentId === driver.id && connection.from.pin === pin ? connection.to : connection.from;
      const peerComponent = project.components.find(component => component.id === peer.componentId);
      if (!peerComponent || !isBoardType(peerComponent.type)) return false;
      const number = resolveBoardPin(peerComponent.type, peer.pin);
      const pins = snapshot.boardPins?.[peerComponent.id]
        ?? (snapshot.primaryBoardId === peerComponent.id ? snapshot.pins : undefined);
      return number !== undefined && pins?.[number]?.mode === "INPUT";
    });
  });
}
