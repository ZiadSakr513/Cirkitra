import { getComponentDefinition } from "./catalog.ts";
import type { CircuitConnection, CircuitProject, ConnectionEndpoint } from "./types.ts";
import { getBoardProfile, isBoardType } from "./boards.ts";
import { POWER_TERMINAL_GROUPS } from "./terminal-groups.ts";
import { PowerRuntime } from "../simulator/power.ts";

/**
 * Correct an unambiguous direct connection from a board rail when a part's
 * catalog supply limits rule that rail out. This is deliberately limited to
 * direct board-rail wires: guessing through arbitrary nets could short two
 * supplies or silently change unrelated loads.
 */
export function repairUnsafeSupplyConnections(project: CircuitProject): {
  project: CircuitProject;
  repairs: Array<{ componentId: string; pin: string; fromVolts: number; toRail: string; toVolts: number }>;
} {
  const componentsById = new Map(project.components.map(component => [component.id, component]));
  const connections = [...project.connections];
  const removeIds = new Set<string>();
  const repairs: Array<{ componentId: string; pin: string; fromVolts: number; toRail: string; toVolts: number }> = [];

  for (const part of project.components) {
    if (isBoardType(part.type)) continue;
    const definition = getComponentDefinition(part.type);
    if (!definition?.metadata?.supplies.length) continue;

    for (const supply of definition.metadata.supplies) for (const pin of supply.pins) {
      const unsafe: Array<{ connection: CircuitConnection; boardId: string; sourcePin: string; volts: number }> = [];
      for (const connection of connections) {
        const other = connection.from.componentId === part.id && connection.from.pin === pin
          ? connection.to
          : connection.to.componentId === part.id && connection.to.pin === pin
            ? connection.from
            : undefined;
        if (!other) continue;
        const board = componentsById.get(other.componentId);
        if (!board || !isBoardType(board.type)) continue;
        const volts = getBoardProfile(board.type)?.rails[other.pin];
        if (volts !== undefined && (volts < supply.minVolts || volts > supply.maxVolts)) {
          unsafe.push({ connection, boardId: board.id, sourcePin: other.pin, volts });
        }
      }

      for (const source of unsafe) {
        const board = componentsById.get(source.boardId)!;
        const profile = getBoardProfile(board.type)!;
        const compatibleRails = Object.entries(profile.rails)
          .filter(([, volts]) => volts >= supply.minVolts && volts <= supply.maxVolts)
          .sort((left, right) => Math.abs(left[1] - Math.min(supply.maxVolts, Math.max(supply.minVolts, source.volts))) - Math.abs(right[1] - Math.min(supply.maxVolts, Math.max(supply.minVolts, source.volts))));
        const replacement = compatibleRails[0];
        if (!replacement) continue;
        const [rail, toVolts] = replacement;

        const alreadyOnSafeRail = connections.some(connection => {
          if (connection.id === source.connection.id) return false;
          const other = connection.from.componentId === part.id && connection.from.pin === pin
            ? connection.to
            : connection.to.componentId === part.id && connection.to.pin === pin
              ? connection.from
              : undefined;
          return other?.componentId === board.id && other.pin === rail;
        });

        if (alreadyOnSafeRail) removeIds.add(source.connection.id);
        else {
          const replaceEndpoint = (endpoint: CircuitConnection["from"]) =>
            endpoint.componentId === source.boardId && endpoint.pin === source.sourcePin
              ? { ...endpoint, pin: rail }
              : endpoint;
          const index = connections.findIndex(connection => connection.id === source.connection.id);
          if (index >= 0) connections[index] = {
            ...source.connection,
            from: replaceEndpoint(source.connection.from),
            to: replaceEndpoint(source.connection.to),
          };
        }
        repairs.push({ componentId: part.id, pin, fromVolts: source.volts, toRail: rail, toVolts });
      }
    }
  }

  if (!repairs.length) return { project, repairs };
  return {
    project: { ...project, connections: connections.filter(connection => !removeIds.has(connection.id)) },
    repairs,
  };
}

/** Use an explicitly requested standalone supply for one unambiguously paired
 * motor driver. Only direct driver supply wires can be rerouted, and unrelated
 * loads or ambiguous power nets are left for model repair. */
export function repairExplicitMotorSupplyConnections(project: CircuitProject, prompt: string): {
  project: CircuitProject;
  repairs: Array<{ driverId: string; supplyId: string; motorSupplyPins: string[]; groundBoardId: string; groundPin: string }>;
} {
  const requestsSeparateMotorSupply = /\b(?:separate|external|dedicated|adjustable|bench)\b[\s\S]{0,45}\b(?:motor|fan|actuator)\b[\s\S]{0,25}\b(?:power\s*)?supply\b|\b(?:motor|fan|actuator)\b[\s\S]{0,35}\b(?:separate|external|dedicated|adjustable|bench)\b[\s\S]{0,25}\b(?:power\s*)?supply\b/i.test(prompt);
  if (!requestsSeparateMotorSupply) return { project, repairs: [] };

  const motorPinsByDriver: Readonly<Record<string, readonly string[]>> = {
    tb6612fng: ["VM1", "VM2", "VM3"], drv8833: ["VM"], l293d: ["VS"], l298: ["VS"],
  };
  const drivers = project.components.filter(component => motorPinsByDriver[component.type]?.length);
  const supplies = project.components.filter(component => component.type === "dc-supply" && component.properties?.enabled !== false);
  const boards = project.components.filter(component => isBoardType(component.type));
  if (drivers.length !== 1 || supplies.length !== 1) return { project, repairs: [] };

  const driver = drivers[0]!;
  const supply = supplies[0]!;
  const voltage = Number(supply.properties?.voltage ?? 5);
  const definition = getComponentDefinition(driver.type);
  const motorSupplyPins = [...(motorPinsByDriver[driver.type] ?? [])];
  if (!Number.isFinite(voltage) || motorSupplyPins.some(pin => {
    const spec = definition?.metadata?.supplies.find(item => item.pins.includes(pin));
    return !spec || voltage < spec.minVolts || voltage > spec.maxVolts;
  })) return { project, repairs: [] };

  const controlPinsByDriver: Readonly<Record<string, readonly string[]>> = {
    tb6612fng: ["AIN1", "AIN2", "BIN1", "BIN2", "PWMA", "PWMB", "STBY"],
    drv8833: ["AIN1", "AIN2", "BIN1", "BIN2", "nSLEEP"],
    l293d: ["IN1", "IN2", "IN3", "IN4", "EN1", "EN2"],
    l298: ["IN1", "IN2", "IN3", "IN4", "ENA", "ENB"],
  };
  const controllingBoards = new Set(project.connections.flatMap(connection => {
    const endpoint = [connection.from, connection.to].find(item => item.componentId === driver.id && controlPinsByDriver[driver.type]?.includes(item.pin));
    if (!endpoint) return [];
    const peer = connection.from === endpoint ? connection.to : connection.from;
    return boards.some(candidate => candidate.id === peer.componentId) ? [peer.componentId] : [];
  }));
  const board = controllingBoards.size === 1
    ? boards.find(candidate => candidate.id === [...controllingBoards][0])
    : controllingBoards.size === 0 && boards.length === 1 ? boards[0] : undefined;
  const groundPin = board && getBoardProfile(board.type)?.groundPins[0];
  if (!board || !groundPin) return { project, repairs: [] };

  const connections = project.connections.map(connection => ({ ...connection, from: { ...connection.from }, to: { ...connection.to } }));
  const key = (componentId: string, pin: string) => `${componentId}:${pin}`;
  const reachable = (start: string, wires = connections) => {
    const graph = new Map<string, Set<string>>();
    for (const connection of wires) {
      const from = key(connection.from.componentId, connection.from.pin);
      const to = key(connection.to.componentId, connection.to.pin);
      if (!graph.has(from)) graph.set(from, new Set());
      if (!graph.has(to)) graph.set(to, new Set());
      graph.get(from)!.add(to); graph.get(to)!.add(from);
    }
    const pending = [start]; const seen = new Set<string>();
    while (pending.length) {
      const current = pending.pop()!;
      if (seen.has(current)) continue;
      seen.add(current); pending.push(...(graph.get(current) ?? []));
    }
    return seen;
  };
  const componentById = new Map(project.components.map(component => [component.id, component]));
  const supplyNegative = key(supply.id, "-");
  const negativeEndpoints = reachable(supplyNegative);
  const isGroundEndpoint = (endpoint: string) => {
    const separator = endpoint.lastIndexOf(":");
    const componentId = endpoint.slice(0, separator); const pin = endpoint.slice(separator + 1);
    const component = componentById.get(componentId);
    return !!component && (component.type === "ground" && pin === "GND"
      || isBoardType(component.type) && !!getBoardProfile(component.type)?.groundPins.includes(pin)
      || !!getComponentDefinition(component.type)?.metadata?.groundPins.includes(pin));
  };
  if ([...negativeEndpoints].some(endpoint => endpoint !== supplyNegative && !isGroundEndpoint(endpoint))) return { project, repairs: [] };

  const allowedBoardSupplyPins = new Set(["VIN", "RAW", "VBAT", "BAT", "VUSB"]);
  const allowedPositiveEndpoint = (endpoint: string) => {
    const separator = endpoint.lastIndexOf(":");
    const componentId = endpoint.slice(0, separator); const pin = endpoint.slice(separator + 1);
    if (componentId === driver.id) return motorSupplyPins.includes(pin);
    if (componentId === supply.id) return pin === "+";
    const component = componentById.get(componentId);
    return !!component && isBoardType(component.type)
      && (allowedBoardSupplyPins.has(pin) || getBoardProfile(component.type)?.rails[pin] !== undefined);
  };
  // A model or staged assembler may flatten a shared power net into a star
  // (VM1 to VIN, VM1 to VM2, VM1 to VM3). Check the whole connected net rather
  // than assuming each power pin owns exactly one direct wire.
  const motorSupplyNet = new Set<string>();
  for (const pin of motorSupplyPins) {
    for (const endpoint of reachable(key(driver.id, pin))) motorSupplyNet.add(endpoint);
  }
  if ([...motorSupplyNet].some(endpoint => !allowedPositiveEndpoint(endpoint))) return { project, repairs: [] };

  const ids = new Set(connections.map(connection => connection.id));
  const addWire = (from: CircuitConnection["from"], to: CircuitConnection["to"], stem: string) => {
    const base = stem.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 56);
    let id = base; let suffix = 1;
    while (ids.has(id)) id = `${base}_${suffix++}`;
    ids.add(id); connections.push({ id, from, to, color: "#f59e0b" });
  };
  // Isolate the driver-only power net from an onboard VIN/5 V rail before
  // rebuilding it from the explicitly requested external source. The net
  // preflight above prevents removing wires for any unrelated load.
  for (let index = connections.length - 1; index >= 0; index -= 1) {
    const connection = connections[index]!;
    const from = key(connection.from.componentId, connection.from.pin);
    const to = key(connection.to.componentId, connection.to.pin);
    if (motorSupplyNet.has(from) && motorSupplyNet.has(to)) connections.splice(index, 1);
  }
  for (const pin of motorSupplyPins) {
    addWire({ componentId: supply.id, pin: "+" }, { componentId: driver.id, pin }, `motor_supply_${driver.id}_${pin}_${supply.id}`);
  }
  const sourceNet = reachable(key(supply.id, "+"));
  if ([...sourceNet].some(endpoint => endpoint !== key(supply.id, "+") && !motorSupplyPins.some(pin => endpoint === key(driver.id, pin)))) return { project, repairs: [] };
  if (negativeEndpoints.size === 1) addWire({ componentId: supply.id, pin: "-" }, { componentId: board.id, pin: groundPin }, `motor_return_${supply.id}_${board.id}`);

  const changed = connections.length !== project.connections.length
    || connections.some((connection, index) => connection.from.componentId !== project.connections[index]?.from.componentId
      || connection.from.pin !== project.connections[index]?.from.pin
      || connection.to.componentId !== project.connections[index]?.to.componentId
      || connection.to.pin !== project.connections[index]?.to.pin);
  if (!changed) return { project, repairs: [] };
  return {
    project: { ...project, connections },
    repairs: [{ driverId: driver.id, supplyId: supply.id, motorSupplyPins, groundBoardId: board.id, groundPin }],
  };
}

/**
 * Connect a missing supply/return only when the circuit contains one
 * unambiguous compatible source. Ambiguous rails remain for Gemini to repair.
 */
export function repairMissingPowerConnections(project: CircuitProject): {
  project: CircuitProject;
  repairs: Array<{ componentId: string; pin: string; sourceComponentId: string; sourcePin: string; volts: number | "GND" }>;
} {
  const parent = new Map<string, string>();
  const key = (id: string, pin: string) => `${id}:${pin}`;
  const find = (node: string): string => {
    const root = parent.get(node) ?? node;
    if (root === node) { parent.set(node, node); return node; }
    const resolved = find(root); parent.set(node, resolved); return resolved;
  };
  const join = (a: string, b: string) => { const first = find(a); const second = find(b); if (first !== second) parent.set(second, first); };
  const connections = [...project.connections];
  for (const wire of connections) join(key(wire.from.componentId, wire.from.pin), key(wire.to.componentId, wire.to.pin));
  for (const component of project.components) for (const group of POWER_TERMINAL_GROUPS[component.type] ?? []) {
    for (let index = 1; index < group.length; index += 1) join(key(component.id, group[0]), key(component.id, group[index]));
  }
  for (const component of project.components.filter(item => isBoardType(item.type))) {
    const profile = getBoardProfile(component.type)!;
    for (let index = 1; index < profile.groundPins.length; index += 1) join(key(component.id, profile.groundPins[0]), key(component.id, profile.groundPins[index]));
    const rails = Object.entries(profile.rails);
    for (let index = 0; index < rails.length; index += 1) for (let next = index + 1; next < rails.length; next += 1) {
      if (rails[index][1] === rails[next][1]) join(key(component.id, rails[index][0]), key(component.id, rails[next][0]));
    }
  }
  const reachable = (start: string) => {
    const graph = new Map<string, Set<string>>();
    for (const wire of connections) {
      const a = key(wire.from.componentId, wire.from.pin); const b = key(wire.to.componentId, wire.to.pin);
      if (!graph.has(a)) graph.set(a, new Set()); if (!graph.has(b)) graph.set(b, new Set());
      graph.get(a)!.add(b); graph.get(b)!.add(a);
    }
    for (const component of project.components.filter(item => isBoardType(item.type))) {
      const profile = getBoardProfile(component.type)!;
      if (profile.groundPins.length > 1) for (let index = 1; index < profile.groundPins.length; index += 1) {
        const a = key(component.id, profile.groundPins[0]); const b = key(component.id, profile.groundPins[index]);
        if (!graph.has(a)) graph.set(a, new Set()); if (!graph.has(b)) graph.set(b, new Set());
        graph.get(a)!.add(b); graph.get(b)!.add(a);
      }
    }
    for (const component of project.components) for (const group of POWER_TERMINAL_GROUPS[component.type] ?? []) {
      for (let index = 1; index < group.length; index += 1) {
        const a = key(component.id, group[0]); const b = key(component.id, group[index]);
        if (!graph.has(a)) graph.set(a, new Set()); if (!graph.has(b)) graph.set(b, new Set());
        graph.get(a)!.add(b); graph.get(b)!.add(a);
      }
    }
    const pending = [start]; const seen = new Set<string>();
    while (pending.length) { const current = pending.pop()!; if (seen.has(current)) continue; seen.add(current); pending.push(...(graph.get(current) ?? [])); }
    return seen;
  };
  type PowerOutput = { componentId: string; pin: string; volts: number };
  const outputs: PowerOutput[] = [];
  const returns: Array<{ componentId: string; pin: string }> = [];
  for (const component of project.components) {
    if (isBoardType(component.type)) {
      const profile = getBoardProfile(component.type)!;
      for (const [pin, volts] of Object.entries(profile.rails)) outputs.push({ componentId: component.id, pin, volts });
      for (const pin of profile.groundPins) returns.push({ componentId: component.id, pin });
    } else if (component.type === "ground") returns.push({ componentId: component.id, pin: "GND" });
    else if (component.type === "dc-supply" && component.properties?.enabled !== false) {
      outputs.push({ componentId: component.id, pin: "+", volts: Number(component.properties?.voltage ?? 5) });
      // A floating negative terminal is not a common-ground source.
      const negativeNet = reachable(key(component.id, "-"));
      if (project.components.some(candidate => isBoardType(candidate.type)
        && getBoardProfile(candidate.type)!.groundPins.some(pin => negativeNet.has(key(candidate.id, pin))))
        || project.components.some(candidate => candidate.type === "ground" && negativeNet.has(key(candidate.id, "GND")))) {
        returns.push({ componentId: component.id, pin: "-" });
      }
    } else if (component.type === "battery-cell") {
      const soc = Math.max(0, Math.min(100, Number(component.properties?.initialSoc ?? 50)));
      outputs.push({ componentId: component.id, pin: "+", volts: soc < 5 ? 2.5 + soc * 0.112 : 3 + 1.2 * soc / 100 });
      const negativeNet = reachable(key(component.id, "-"));
      if (project.components.some(candidate => isBoardType(candidate.type)
        && getBoardProfile(candidate.type)!.groundPins.some(pin => negativeNet.has(key(candidate.id, pin))))
        || project.components.some(candidate => candidate.type === "ground" && negativeNet.has(key(candidate.id, "GND")))) {
        returns.push({ componentId: component.id, pin: "-" });
      }
    }
  }

  const repairs: Array<{ componentId: string; pin: string; sourceComponentId: string; sourcePin: string; volts: number | "GND" }> = [];
  const connectionIds = new Set(connections.map(connection => connection.id));
  const addWire = (componentId: string, pin: string, sourceComponentId: string, sourcePin: string) => {
    const baseId = `power_${componentId}_${pin}_${sourceComponentId}_${sourcePin}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 56);
    let id = baseId; let suffix = 1;
    while (connectionIds.has(id)) id = `${baseId}_${suffix++}`;
    connectionIds.add(id);
    connections.push({ id, from: { componentId, pin }, to: { componentId: sourceComponentId, pin: sourcePin } });
  };
  const isReachableTo = (componentId: string, pin: string, terminals: readonly { componentId: string; pin: string }[]) => {
    const net = reachable(key(componentId, pin));
    return terminals.some(terminal => net.has(key(terminal.componentId, terminal.pin)));
  };
  for (const component of project.components) {
    if (isBoardType(component.type)) continue;
    const definition = getComponentDefinition(component.type);
    const supplies = definition?.metadata?.supplies ?? [];
    for (const supply of supplies) for (const pin of supply.pins) {
      if (isReachableTo(component.id, pin, outputs)) continue;
      const byNet = new Map<string, PowerOutput[]>();
      for (const output of outputs) if (output.volts >= supply.minVolts && output.volts <= supply.maxVolts) {
        const root = find(key(output.componentId, output.pin));
        const candidates = byNet.get(root) ?? []; candidates.push(output); byNet.set(root, candidates);
      }
      const compatibleNets = [...byNet.values()];
      if (compatibleNets.length !== 1) continue;
      const source = compatibleNets[0][0];
      if (isReachableTo(component.id, pin, outputs)) continue;
      addWire(component.id, pin, source.componentId, source.pin);
      repairs.push({ componentId: component.id, pin, sourceComponentId: source.componentId, sourcePin: source.pin, volts: source.volts });
    }
    for (const pin of definition?.metadata?.groundPins ?? []) {
      if (isReachableTo(component.id, pin, returns) || !returns.length) continue;
      const byNet = new Map<string, typeof returns>();
      for (const terminal of returns) {
        const root = find(key(terminal.componentId, terminal.pin));
        const candidates = byNet.get(root) ?? []; candidates.push(terminal); byNet.set(root, candidates);
      }
      if (byNet.size !== 1) continue;
      const source = [...byNet.values()][0][0];
      addWire(component.id, pin, source.componentId, source.pin);
      repairs.push({ componentId: component.id, pin, sourceComponentId: source.componentId, sourcePin: source.pin, volts: "GND" });
    }
  }
  if (!repairs.length) return { project, repairs };
  return { project: { ...project, connections }, repairs };
}

/**
 * Repair the very specific, unambiguous upstream/downstream topology for a
 * two-zone BME280 circuit behind one TCA9548A. Gemini must have explicitly
 * requested the muxed arrangement, the code must select channels 0 and 1,
 * and sensor labels must identify west/east. Existing nets are only joined
 * when they contain the expected active endpoints plus passive resistors.
 */
export function repairDualBmeI2cMuxWiring(project: CircuitProject, prompt: string, code: string): {
  project: CircuitProject;
  repairs: Array<{ fromComponentId: string; fromPin: string; toComponentId: string; toPin: string }>;
} {
  const requestIsExplicit = /tca\s*9548a/i.test(prompt)
    && /mcp\s*23017/i.test(prompt)
    && ((prompt.match(/bme\s*280/gi)?.length ?? 0) >= 2 || /\b(?:two|2)\s+(?:identical\s+)?bme\s*280\b/i.test(prompt))
    && /(?:channel|ch)\s*0/i.test(prompt)
    && /(?:channel|ch)\s*1/i.test(prompt);
  if (!requestIsExplicit || !/\.selectChannel\s*\(\s*0\s*\)/.test(code) || !/\.selectChannel\s*\(\s*1\s*\)/.test(code)) {
    return { project, repairs: [] };
  }

  const muxes = project.components.filter(component => component.type === "tca9548a");
  const expanders = project.components.filter(component => component.type === "mcp23017");
  const sensors = project.components.filter(component => component.type === "bme280");
  const boards = project.components.filter(component => isBoardType(component.type));
  if (muxes.length !== 1 || expanders.length !== 1 || sensors.length !== 2 || boards.length !== 1) return { project, repairs: [] };
  const west = sensors.find(sensor => /\bwest\b/i.test(`${sensor.label} ${sensor.id}`));
  const east = sensors.find(sensor => /\beast\b/i.test(`${sensor.label} ${sensor.id}`));
  if (!west || !east || west.id === east.id) return { project, repairs: [] };

  const board = boards[0];
  const profile = getBoardProfile(board.type);
  if (!profile || profile.i2c.length !== 1) return { project, repairs: [] };
  const bus = profile.i2c[0];
  const sdaPin = profile.ioPins.find(pin => pin.runtimePin === bus.sda)?.id;
  const sclPin = profile.ioPins.find(pin => pin.runtimePin === bus.scl)?.id;
  if (!sdaPin || !sclPin) return { project, repairs: [] };

  const connections = [...project.connections];
  const endpointKey = (componentId: string, pin: string) => `${componentId}:${pin}`;
  const getNet = (componentId: string, pin: string): Set<string> => {
    const graph = new Map<string, Set<string>>();
    for (const connection of connections) {
      const a = endpointKey(connection.from.componentId, connection.from.pin);
      const b = endpointKey(connection.to.componentId, connection.to.pin);
      if (!graph.has(a)) graph.set(a, new Set());
      if (!graph.has(b)) graph.set(b, new Set());
      graph.get(a)!.add(b); graph.get(b)!.add(a);
    }
    const pending = [endpointKey(componentId, pin)];
    const seen = new Set<string>();
    while (pending.length) {
      const current = pending.pop()!;
      if (seen.has(current)) continue;
      seen.add(current);
      pending.push(...(graph.get(current) ?? []));
    }
    return seen;
  };
  const activeComponentsInNet = (net: Set<string>) => new Set([...net]
    .map(endpoint => endpoint.slice(0, endpoint.lastIndexOf(":")))
    .filter(id => project.components.find(component => component.id === id)?.type !== "resistor"));
  const safeToJoin = (aId: string, aPin: string, bId: string, bPin: string, allowedActive: Set<string>) => {
    const a = getNet(aId, aPin);
    const b = getNet(bId, bPin);
    const allActive = new Set([...activeComponentsInNet(a), ...activeComponentsInNet(b)]);
    return [...allActive].every(id => allowedActive.has(id));
  };
  const wireExists = (aId: string, aPin: string, bId: string, bPin: string) => getNet(aId, aPin).has(endpointKey(bId, bPin));
  const usedIds = new Set(connections.map(connection => connection.id));
  const repairs: Array<{ fromComponentId: string; fromPin: string; toComponentId: string; toPin: string }> = [];
  const addWire = (fromComponentId: string, fromPin: string, toComponentId: string, toPin: string) => {
    if (wireExists(fromComponentId, fromPin, toComponentId, toPin)) return;
    const root = `i2c_repair_${fromComponentId}_${fromPin}_${toComponentId}_${toPin}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 56);
    let id = root; let suffix = 1;
    while (usedIds.has(id)) id = `${root}_${suffix++}`;
    usedIds.add(id);
    connections.push({ id, from: { componentId: fromComponentId, pin: fromPin }, to: { componentId: toComponentId, pin: toPin } });
    repairs.push({ fromComponentId, fromPin, toComponentId, toPin });
  };

  const mux = muxes[0];
  const expander = expanders[0];
  // Only repair the MCP23017 if the mux upstream bus is already correctly
  // connected to the selected board's I2C pair.
  for (const [devicePin, boardPin] of [["SDA", sdaPin], ["SCL", sclPin]] as const) {
    if (!wireExists(mux.id, devicePin, board.id, boardPin)) return { project, repairs: [] };
  }
  for (const [devicePin, boardPin] of [["SDA", sdaPin], ["SCL", sclPin]] as const) {
    if (!wireExists(expander.id, devicePin, board.id, boardPin)
      && safeToJoin(expander.id, devicePin, board.id, boardPin, new Set([expander.id, board.id, mux.id]))) {
      addWire(expander.id, devicePin, board.id, boardPin);
    }
  }

  for (const [sensor, channel] of [[west, 0], [east, 1]] as const) {
    for (const [sensorPin, muxPin] of [["SDI", `SD${channel}`], ["SCK", `SC${channel}`]] as const) {
      if (wireExists(sensor.id, sensorPin, mux.id, muxPin)) continue;
      if (!safeToJoin(sensor.id, sensorPin, mux.id, muxPin, new Set([sensor.id, mux.id]))) {
        // Never partially repair a conflicting downstream net.
        return { project, repairs: [] };
      }
      addWire(sensor.id, sensorPin, mux.id, muxPin);
    }
  }

  if (!repairs.length) return { project, repairs };
  return { project: { ...project, connections }, repairs };
}

/** Restore an omitted TB6612 STBY wire only when the prompt and sketch both
 * explicitly map standby to the same otherwise-unused board GPIO. */
export function repairExplicitTb6612StandbyWiring(project: CircuitProject, prompt: string, code: string): {
  project: CircuitProject;
  repairs: Array<{ driverId: string; boardId: string; boardPin: string }>;
} {
  const drivers = project.components.filter(component => component.type === "tb6612fng");
  const boards = project.components.filter(component => isBoardType(component.type));
  if (drivers.length !== 1 || boards.length !== 1) return { project, repairs: [] };
  const mapping = prompt.match(/\b(?:STBY|standby)\s*(?:pin\s*)?(?:D)?(\d+)\b|\b(?:D)?(\d+)\s*(?:pin\s*)?(?:for\s+)?(?:STBY|standby)\b/i);
  const pinNumber = Number(mapping?.[1] ?? mapping?.[2]);
  if (!Number.isInteger(pinNumber)) return { project, repairs: [] };
  const pinName = `D${pinNumber}`;
  const driver = drivers[0];
  const board = boards[0];
  const boardPin = getBoardProfile(board.type)?.ioPins.find(pin => pin.id === pinName);
  if (!boardPin || project.connections.some(connection =>
    (connection.from.componentId === driver.id && connection.from.pin === "STBY")
      || (connection.to.componentId === driver.id && connection.to.pin === "STBY"))) return { project, repairs: [] };

  const variableNames = [...code.matchAll(/\b(?:const\s+)?(?:int|byte|uint\d+_t)\s+([A-Za-z_]\w*)\s*=\s*(?:D)?(\d+)\s*;/gi)]
    .filter(match => Number(match[2]) === pinNumber && /stby|standby/i.test(match[1]))
    .map(match => match[1]);
  const pinUsedInSketch = new RegExp(`\\b(?:pinMode|digitalWrite|analogWrite)\\s*\\(\\s*D?${pinNumber}\\b`, "i").test(code)
    || variableNames.some(name => new RegExp(`\\b(?:pinMode|digitalWrite|analogWrite)\\s*\\(\\s*${name}\\b`, "i").test(code));
  if (!pinUsedInSketch) return { project, repairs: [] };

  const net = new Set<string>([`${board.id}:${pinName}`]);
  const pending = [...net];
  while (pending.length) {
    const current = pending.pop()!;
    for (const connection of project.connections) {
      const from = `${connection.from.componentId}:${connection.from.pin}`;
      const to = `${connection.to.componentId}:${connection.to.pin}`;
      const next = from === current ? to : to === current ? from : undefined;
      if (next && !net.has(next)) { net.add(next); pending.push(next); }
    }
  }
  const componentById = new Map(project.components.map(component => [component.id, component]));
  const activeIds = new Set([...net].map(endpoint => endpoint.slice(0, endpoint.lastIndexOf(":")))
    .filter(id => componentById.get(id)?.type !== "resistor"));
  if ([...activeIds].some(id => id !== board.id)) return { project, repairs: [] };

  const idBase = `explicit_stby_${driver.id}_${board.id}_${pinName}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 56);
  let id = idBase; let suffix = 1;
  const ids = new Set(project.connections.map(connection => connection.id));
  while (ids.has(id)) id = `${idBase}_${suffix++}`;
  const connection: CircuitConnection = { id, from: { componentId: board.id, pin: pinName }, to: { componentId: driver.id, pin: "STBY" } };
  return {
    project: { ...project, connections: [...project.connections, connection] },
    repairs: [{ driverId: driver.id, boardId: board.id, boardPin: pinName }],
  };
}

/** Tie only floating address/mode straps to the local validated rails for the
 * explicitly requested default-address dual-BME/TCA/MCP I2C arrangement. */
export function repairFloatingI2cModeStraps(project: CircuitProject, prompt: string, code: string): {
  project: CircuitProject;
  repairs: Array<{ componentId: string; pin: string; referencePin: string }>;
} {
  const explicitlyRequested = /tca\s*9548a/i.test(prompt)
    && /mcp\s*23017/i.test(prompt)
    && ((prompt.match(/bme\s*280/gi)?.length ?? 0) >= 2 || /\b(?:two|2)\s+(?:identical\s+)?bme\s*280\b/i.test(prompt))
    && /(?:channel|ch)\s*0/i.test(prompt)
    && /(?:channel|ch)\s*1/i.test(prompt)
    && /(?:i2c|two\s+wire)/i.test(prompt);
  if (!explicitlyRequested || /\b(?:pinMode|digitalWrite|digitalRead)\s*\([^)]*\b(?:reset|csb|sdo|a0|a1|a2)\w*/i.test(code)) {
    return { project, repairs: [] };
  }
  const muxes = project.components.filter(component => component.type === "tca9548a");
  const expanders = project.components.filter(component => component.type === "mcp23017");
  const sensors = project.components.filter(component => component.type === "bme280");
  if (muxes.length !== 1 || expanders.length !== 1 || sensors.length !== 2) return { project, repairs: [] };
  const addressConfigured = (type: string, address: string) => code.includes(address)
    && (type === "tca9548a" ? /TCA9548\s+\w+\s*\([^;]*0x70/i.test(code) : /begin_I2C\s*\(\s*0x20\s*\)/i.test(code));
  if (!addressConfigured("tca9548a", "0x70") || !addressConfigured("mcp23017", "0x20") || !/begin\s*\(\s*0x76\s*\)/i.test(code)) {
    return { project, repairs: [] };
  }

  const connections = [...project.connections];
  const targets = [
    ...muxes.map(component => ({ component, high: [["RESET", "VCC"]] as const, low: [["A0", "GND"], ["A1", "GND"], ["A2", "GND"]] as const })),
    ...expanders.map(component => ({ component, high: [["RESET", "VDD"]] as const, low: [["A0", "VSS"], ["A1", "VSS"], ["A2", "VSS"]] as const })),
    ...sensors.map(component => ({ component, high: [["CSB", "VDDIO"]] as const, low: [["SDO", "GND_1"]] as const })),
  ];
  const usedIds = new Set(connections.map(connection => connection.id));
  const repairs: Array<{ componentId: string; pin: string; referencePin: string }> = [];
  for (const target of targets) for (const [pin, referencePin] of [...target.high, ...target.low]) {
    if (connections.some(connection =>
      (connection.from.componentId === target.component.id && connection.from.pin === pin)
        || (connection.to.componentId === target.component.id && connection.to.pin === pin))) continue;
    // The reference rail/return must already have at least one physical wire.
    if (!connections.some(connection =>
      (connection.from.componentId === target.component.id && connection.from.pin === referencePin)
        || (connection.to.componentId === target.component.id && connection.to.pin === referencePin))) continue;
    const idBase = `i2c_strap_${target.component.id}_${pin}_${referencePin}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 56);
    let id = idBase; let suffix = 1;
    while (usedIds.has(id)) id = `${idBase}_${suffix++}`;
    usedIds.add(id);
    connections.push({ id, from: { componentId: target.component.id, pin }, to: { componentId: target.component.id, pin: referencePin } });
    repairs.push({ componentId: target.component.id, pin, referencePin });
  }
  return repairs.length ? { project: { ...project, connections }, repairs } : { project, repairs };
}

/** Complete a missing I2C display/sensor bus only when prompt, library use,
 * and board profile identify one exact MCU bus. Existing active miswiring is
 * left for Gemini to repair; this only joins floating/passive nets. */
export function repairExplicitI2cPeripheralBus(project: CircuitProject, prompt: string): {
  project: CircuitProject;
  repairs: Array<{ componentId: string; pin: string; boardId: string; boardPin: string }>;
} {
  const descriptors: Record<string, { sda: string; scl: string; pullups: boolean }> = {
    "ssd1306-oled-128x64": { sda: "SDA", scl: "SCL", pullups: true },
    "ds3231-rtc": { sda: "SDA", scl: "SCL", pullups: false },
    "bh1750-sen0097": { sda: "SDA", scl: "SCL", pullups: false },
    "sht31-dis": { sda: "SDA", scl: "SCL", pullups: false },
    "mpu-6050": { sda: "SDA", scl: "SCL", pullups: true },
    "mcp23017": { sda: "SDA", scl: "SCL", pullups: true },
    "tca9548a": { sda: "SDA", scl: "SCL", pullups: true },
    "bme280": { sda: "SDI", scl: "SCK", pullups: true },
    "bmp280": { sda: "SDI", scl: "SCK", pullups: true },
  };
  const i2cParts = project.components.filter(component => descriptors[component.type]);
  if (i2cParts.length !== 1) {
    return { project, repairs: [] };
  }
  const peripheral = i2cParts[0];
  // The dedicated dual-zone repair owns the multiplexed BME280 case.
  if (project.components.some(component => component.type === "tca9548a") && peripheral.type !== "tca9548a") return { project, repairs: [] };
  const descriptor = descriptors[peripheral.type];
  const definition = getComponentDefinition(peripheral.type);
  if (!definition?.metadata?.libraries.length) return { project, repairs: [] };
  const promptCompact = prompt.toLowerCase().replace(/[^a-z0-9]/g, "");
  const programs = project.components.filter(component => isBoardType(component.type)).flatMap(board => {
    const code = project.programs?.[board.id] ?? (board.type === project.board ? project.code : "");
    const profile = getBoardProfile(board.type);
    if (!code || !profile || !definition.metadata!.libraries.some(library => library.headers.some(header => code.includes(header)))) return [];
    const profileName = profile.displayName.toLowerCase().replace(/[^a-z0-9]/g, "");
    const profileId = profile.id.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!promptCompact.includes(profileName) && !promptCompact.includes(profileId)) return [];
    return [{ board, profile, code }];
  });
  if (programs.length !== 1) return { project, repairs: [] };
  const { board, profile } = programs[0];
  const explicitBus = profile.i2c.filter(bus => {
    const sdaNumbered = new RegExp(`(?:sda.{0,16}(?:gpio|gp)?${bus.sda}\\b|(?:gpio|gp)?${bus.sda}\\b.{0,16}sda)`, "i").test(prompt);
    const sclNumbered = new RegExp(`(?:scl.{0,16}(?:gpio|gp)?${bus.scl}\\b|(?:gpio|gp)?${bus.scl}\\b.{0,16}scl)`, "i").test(prompt);
    return sdaNumbered && sclNumbered;
  });
  const selectedBus = profile.i2c.length === 1 ? profile.i2c[0] : explicitBus.length === 1 ? explicitBus[0] : undefined;
  if (!selectedBus) return { project, repairs: [] };
  const boardSda = profile.ioPins.find(pin => pin.runtimePin === selectedBus.sda)?.id;
  const boardScl = profile.ioPins.find(pin => pin.runtimePin === selectedBus.scl)?.id;
  if (!boardSda || !boardScl) return { project, repairs: [] };

  const connections = [...project.connections];
  const key = (componentId: string, pin: string) => `${componentId}:${pin}`;
  const getNet = (componentId: string, pin: string) => {
    const graph = new Map<string, Set<string>>();
    for (const wire of connections) {
      const from = key(wire.from.componentId, wire.from.pin); const to = key(wire.to.componentId, wire.to.pin);
      if (!graph.has(from)) graph.set(from, new Set()); if (!graph.has(to)) graph.set(to, new Set());
      graph.get(from)!.add(to); graph.get(to)!.add(from);
    }
    const pending = [key(componentId, pin)]; const seen = new Set<string>();
    while (pending.length) { const current = pending.pop()!; if (seen.has(current)) continue; seen.add(current); pending.push(...(graph.get(current) ?? [])); }
    return seen;
  };
  const powerPin = (componentId: string, pin: string) => {
    const component = project.components.find(item => item.id === componentId);
    const profileForComponent = component && isBoardType(component.type) ? getBoardProfile(component.type) : undefined;
    return Boolean(profileForComponent && (Object.hasOwn(profileForComponent.rails, pin) || profileForComponent.groundPins.includes(pin)));
  };
  const safeToJoin = (componentId: string, pin: string, boardPin: string) => {
    const endpointNet = getNet(componentId, pin); const boardNet = getNet(board.id, boardPin);
    const ids = new Set([...endpointNet, ...boardNet].map(endpoint => endpoint.slice(0, endpoint.lastIndexOf(":"))));
    for (const endpoint of [...endpointNet, ...boardNet]) {
      const split = endpoint.lastIndexOf(":");
      if (powerPin(endpoint.slice(0, split), endpoint.slice(split + 1))) return false;
    }
    return [...ids].every(id => {
      if (id === componentId || id === board.id) return true;
      const component = project.components.find(item => item.id === id);
      if (component?.type === "resistor") return true;
      return Boolean(component && getComponentDefinition(component.type)?.metadata?.interfaces.includes("I2C"));
    });
  };
  const connected = (aId: string, aPin: string, bId: string, bPin: string) => getNet(aId, aPin).has(key(bId, bPin));
  const ids = new Set(connections.map(wire => wire.id));
  const repairs: Array<{ componentId: string; pin: string; boardId: string; boardPin: string }> = [];
  const addWire = (componentId: string, pin: string, boardPin: string) => {
    if (connected(componentId, pin, board.id, boardPin) || !safeToJoin(componentId, pin, boardPin)) return false;
    const base = `i2c_bus_${componentId}_${pin}_${board.id}_${boardPin}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 56);
    let id = base; let suffix = 1; while (ids.has(id)) id = `${base}_${suffix++}`; ids.add(id);
    connections.push({ id, from: { componentId, pin }, to: { componentId: board.id, pin: boardPin } });
    repairs.push({ componentId, pin, boardId: board.id, boardPin });
    return true;
  };

  for (const [devicePin, boardPin] of [[descriptor.sda, boardSda], [descriptor.scl, boardScl]] as const) {
    // Refuse to repair either line if the other line is already actively
    // connected somewhere incompatible. No endpoint is rerouted here.
    const net = getNet(peripheral.id, devicePin);
    const active = [...net].map(endpoint => endpoint.slice(0, endpoint.lastIndexOf(":")))
      .filter(id => project.components.find(component => component.id === id)?.type !== "resistor");
    if (active.some(id => id !== peripheral.id && id !== board.id
      && !getComponentDefinition(project.components.find(component => component.id === id)?.type ?? "")?.metadata?.interfaces.includes("I2C"))) {
      return { project, repairs: [] };
    }
    addWire(peripheral.id, devicePin, boardPin);
  }

  // The simulated bare-bus wiring check requires one external pull-up per
  // line for devices whose model specifies that requirement. Reuse only a
  // matching resistor that is already wired to this board's compatible rail.
  if (descriptor.pullups) {
    const rails = Object.entries(profile.rails).filter(([, volts]) => volts >= 2.0 && volts <= 5.5);
    const preferred = rails.find(([pin, volts]) => pin === "3V3" && Math.abs(volts - 3.3) < 0.01);
    const selectedRail = preferred ?? (rails.length === 1 ? rails[0] : undefined);
    if (selectedRail) {
      const missing = ([[descriptor.sda, boardSda], [descriptor.scl, boardScl]] as const)
        .filter(([devicePin]) => !project.components.some(resistor => resistor.type === "resistor"
          && Number(resistor.properties?.resistance ?? 10_000) >= 3_000
          && Number(resistor.properties?.resistance ?? 10_000) <= 10_000
          && connected(peripheral.id, devicePin, resistor.id, "1")
          && connected(resistor.id, "2", board.id, selectedRail[0])))
        .filter(([devicePin]) => !project.components.some(resistor => resistor.type === "resistor"
          && Number(resistor.properties?.resistance ?? 10_000) >= 3_000
          && Number(resistor.properties?.resistance ?? 10_000) <= 10_000
          && connected(peripheral.id, devicePin, resistor.id, "2")
          && connected(resistor.id, "1", board.id, selectedRail[0])));
      const unused = project.components.filter(resistor => resistor.type === "resistor"
        && Number(resistor.properties?.resistance ?? 10_000) >= 3_000
        && Number(resistor.properties?.resistance ?? 10_000) <= 10_000
        && !connected(peripheral.id, descriptor.sda, resistor.id, "1") && !connected(peripheral.id, descriptor.sda, resistor.id, "2")
        && !connected(peripheral.id, descriptor.scl, resistor.id, "1") && !connected(peripheral.id, descriptor.scl, resistor.id, "2")
        && (["1", "2"] as const).some(lead => connected(resistor.id, lead, board.id, selectedRail[0])));
      if (missing.length > 0 && unused.length === missing.length) {
        for (const [[devicePin], resistor] of missing.map((item, index) => [item, unused[index]] as const)) {
          const railLead = connected(resistor.id, "1", board.id, selectedRail[0]) ? "1" : "2";
          const freeLead = railLead === "1" ? "2" : "1";
          const wireId = `i2c_pullup_${resistor.id}_${devicePin}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 56);
          if (!ids.has(wireId)) { ids.add(wireId); connections.push({ id: wireId, from: { componentId: peripheral.id, pin: devicePin }, to: { componentId: resistor.id, pin: freeLead } }); repairs.push({ componentId: peripheral.id, pin: devicePin, boardId: resistor.id, boardPin: freeLead }); }
        }
      }
    }
  }

  // In a mixed-board project, select the explicitly named peripheral board's
  // own supply and ground rails when the matching display/sensor pins float.
  const supplyPin = definition.metadata?.supplies[0]?.pins[0];
  const compatibleRail = Object.entries(profile.rails).find(([pin, volts]) => pin === "3V3" && volts >= (definition.metadata?.supplies[0]?.minVolts ?? 0) && volts <= (definition.metadata?.supplies[0]?.maxVolts ?? 100))
    ?? Object.entries(profile.rails).find(([, volts]) => volts >= (definition.metadata?.supplies[0]?.minVolts ?? 0) && volts <= (definition.metadata?.supplies[0]?.maxVolts ?? 100));
  if (supplyPin && compatibleRail && !connections.some(wire => [wire.from, wire.to].some(endpoint => endpoint.componentId === peripheral.id && endpoint.pin === supplyPin))) {
    const id = `i2c_power_${peripheral.id}_${supplyPin}_${board.id}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 56);
    if (!ids.has(id)) { ids.add(id); connections.push({ id, from: { componentId: peripheral.id, pin: supplyPin }, to: { componentId: board.id, pin: compatibleRail[0] } }); repairs.push({ componentId: peripheral.id, pin: supplyPin, boardId: board.id, boardPin: compatibleRail[0] }); }
  }
  const groundPin = definition.metadata?.groundPins[0];
  const boardGround = profile.groundPins[0];
  if (groundPin && boardGround && !connections.some(wire => [wire.from, wire.to].some(endpoint => endpoint.componentId === peripheral.id && endpoint.pin === groundPin))) {
    const id = `i2c_ground_${peripheral.id}_${groundPin}_${board.id}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 56);
    if (!ids.has(id)) { ids.add(id); connections.push({ id, from: { componentId: peripheral.id, pin: groundPin }, to: { componentId: board.id, pin: boardGround } }); repairs.push({ componentId: peripheral.id, pin: groundPin, boardId: board.id, boardPin: boardGround }); }
  }

  return repairs.length ? { project: { ...project, connections }, repairs } : { project, repairs };
}

/**
 * Correct a DC motor that is wired directly to the wrong pins on one known
 * H-bridge. This handles a common generated-netlist mistake where the two
 * physical TB6612FNG AO1 pads (AO1_1 and AO1_2) are mistaken for opposite
 * outputs, or the motor leads are split across two channels. Only direct
 * motor-to-driver output wires are changed, and only when there is one
 * unambiguous driver for that motor.
 */
export function repairMotorDriverOutputConnections(project: CircuitProject): {
  project: CircuitProject;
  repairs: Array<{ motorId: string; motorLabel: string; driverId: string; driverType: string; channel: number }>;
  outputShortRepairs: Array<{ driverId: string; driverType: string; channel: number }>;
} {
  const channels: Record<string, Array<{ pins: [string, string]; aliases: [string[], string[]] }>> = {
    l293d: [
      { pins: ["OUT1", "OUT2"], aliases: [["OUT1"], ["OUT2"]] },
      { pins: ["OUT3", "OUT4"], aliases: [["OUT3"], ["OUT4"]] },
    ],
    tb6612fng: [
      { pins: ["AO1_1", "AO2_5"], aliases: [["AO1_1", "AO1_2"], ["AO2_5", "AO2_6"]] },
      { pins: ["BO1_11", "BO2_7"], aliases: [["BO1_11", "BO1_12"], ["BO2_7", "BO2_8"]] },
    ],
    drv8833: [
      { pins: ["AOUT1", "AOUT2"], aliases: [["AOUT1"], ["AOUT2"]] },
      { pins: ["BOUT1", "BOUT2"], aliases: [["BOUT1"], ["BOUT2"]] },
    ],
    l298: [
      { pins: ["OUT1", "OUT2"], aliases: [["OUT1"], ["OUT2"]] },
      { pins: ["OUT3", "OUT4"], aliases: [["OUT3"], ["OUT4"]] },
    ],
  };
  const drivers = project.components.filter(component => channels[component.type]);
  const motors = project.components.filter(component => component.type === "dc-motor");
  if (!drivers.length || !motors.length) return { project, repairs: [], outputShortRepairs: [] };

  const connections = [...project.connections];
  const repairs: Array<{ motorId: string; motorLabel: string; driverId: string; driverType: string; channel: number }> = [];
  const outputShortRepairs: Array<{ driverId: string; driverType: string; channel: number }> = [];

  // A generated netlist can put a direct wire between the two output sides of
  // one H-bridge channel. That shorts the driver's outputs and also makes a
  // motor wired across the channel appear shorted. Remove only this exact,
  // unambiguous output-to-output connection; leave other joined nets to the
  // validator and Gemini's targeted repair.
  for (const driver of drivers) {
    const locations = new Map<string, { channelIndex: number; side: number }>();
    channels[driver.type].forEach((channel, channelIndex) => channel.aliases.forEach((aliases, side) =>
      aliases.forEach(pin => locations.set(pin, { channelIndex, side }))));
    const repairedChannels = new Set<number>();
    const retained = connections.filter(connection => {
      if (connection.from.componentId !== driver.id || connection.to.componentId !== driver.id) return true;
      const from = locations.get(connection.from.pin);
      const to = locations.get(connection.to.pin);
      if (!from || !to || from.channelIndex !== to.channelIndex || from.side === to.side) return true;
      repairedChannels.add(from.channelIndex);
      return false;
    });
    if (retained.length !== connections.length) {
      connections.splice(0, connections.length, ...retained);
      for (const channelIndex of repairedChannels) outputShortRepairs.push({ driverId: driver.id, driverType: driver.type, channel: channelIndex + 1 });
    }
  }

  for (const motor of motors) {
    const directOutputWires = (driver: typeof drivers[number]) => {
      const outputAliases = channels[driver.type].flatMap((channel, channelIndex) => channel.aliases.flatMap((aliases, side) =>
        aliases.map(pin => ({ pin, channelIndex, side }))));
      return (["+", "-"] as const).map(terminal => {
        const matches = connections.flatMap((connection, index) => {
          const other = connection.from.componentId === motor.id && connection.from.pin === terminal
            ? connection.to
            : connection.to.componentId === motor.id && connection.to.pin === terminal
              ? connection.from
              : undefined;
          if (other?.componentId !== driver.id) return [];
          const output = outputAliases.find(candidate => candidate.pin === other.pin);
          return output ? [{ index, endpoint: other, ...output }] : [];
        });
        return matches.length === 1 ? matches[0] : undefined;
      });
    };

    const candidates = drivers.map(driver => ({ driver, wires: directOutputWires(driver) }))
      .filter(candidate => candidate.wires.some(Boolean));
    if (candidates.length !== 1) continue;
    const [{ driver, wires }] = candidates;
    const plus = wires[0];
    const minus = wires[1];
    if (!plus || !minus) continue;

    // Already on one valid bridge channel; leave the generated topology alone.
    if (plus.channelIndex === minus.channelIndex && plus.side !== minus.side) continue;

    // Prefer the bridge already selected by the + lead, then the - lead.
    const channelIndex = plus.channelIndex ?? minus.channelIndex ?? 0;
    const channel = channels[driver.type][channelIndex];
    let plusSide: number;
    if (plus.channelIndex === channelIndex) plusSide = plus.side;
    else if (minus.channelIndex === channelIndex) plusSide = 1 - minus.side;
    else plusSide = 0;
    const desired = [channel.pins[plusSide], channel.pins[1 - plusSide]] as const;
    const chosen = [plus, minus] as const;
    for (let terminalIndex = 0; terminalIndex < chosen.length; terminalIndex += 1) {
      const wire = chosen[terminalIndex];
      const pin = desired[terminalIndex];
      if (wire.endpoint.pin === pin) continue;
      const connection = connections[wire.index];
      const replace = (endpoint: CircuitConnection["from"]) =>
        endpoint.componentId === driver.id && endpoint.pin === wire.endpoint.pin
          ? { ...endpoint, pin }
          : endpoint;
      connections[wire.index] = { ...connection, from: replace(connection.from), to: replace(connection.to) };
    }
    repairs.push({ motorId: motor.id, motorLabel: motor.label, driverId: driver.id, driverType: driver.type, channel: channelIndex + 1 });
  }

  if (!repairs.length && !outputShortRepairs.length) return { project, repairs, outputShortRepairs };
  return { project: { ...project, connections }, repairs, outputShortRepairs };
}

export type PartWiringDiagnostic = {
  severity: "warning" | "error";
  code: string;
  message: string;
  componentIds: string[];
  wireIds: string[];
  nets: Array<{ id: string; endpoints: ConnectionEndpoint[]; wireIds: string[] }>;
  expectedTopology: string;
};

/** Check known rail voltages without pretending the normalized solver models volts. */
export function validatePartWiring(project: CircuitProject) {
  const issues: PartWiringDiagnostic[] = [];
  const graph = new Map<string, Set<string>>();
  const key = (id: string, pin: string) => `${id}:${pin}`;
  const parent = new Map<string, string>();
  const edgeGraph = new Map<string, Array<{ to: string; wireId?: string }>>();
  const find = (node: string): string => {
    const root = parent.get(node) ?? node;
    if (root === node) { parent.set(node, node); return node; }
    const result = find(root); parent.set(node, result); return result;
  };
  const join = (left: string, right: string) => {
    const a = find(left); const b = find(right);
    if (a !== b) parent.set(b, a);
  };
  const topologyFor = (seeds: readonly string[]) => {
    const roots = new Set(seeds.map(find));
    const matched = project.connections.filter(wire => roots.has(find(key(wire.from.componentId, wire.from.pin))) || roots.has(find(key(wire.to.componentId, wire.to.pin))));
    const endpoints = new Map<string, ConnectionEndpoint>();
    for (const wire of matched) {
      endpoints.set(key(wire.from.componentId, wire.from.pin), wire.from);
      endpoints.set(key(wire.to.componentId, wire.to.pin), wire.to);
    }
    const wireIds = matched.map(wire => wire.id);
    return {
      componentIds: [...new Set([...seeds.map(seed => seed.slice(0, seed.indexOf(":"))), ...matched.flatMap(wire => [wire.from.componentId, wire.to.componentId])])],
      wireIds,
      nets: [...roots].map(root => ({
        id: `net:${[...endpoints.keys()].filter(endpoint => find(endpoint) === root).sort()[0] ?? root}`,
        endpoints: [...endpoints.values()].filter(endpoint => find(key(endpoint.componentId, endpoint.pin)) === root),
        wireIds: matched.filter(wire => find(key(wire.from.componentId, wire.from.pin)) === root || find(key(wire.to.componentId, wire.to.pin)) === root).map(wire => wire.id),
      })),
    };
  };
  const addIssue = (severity: "warning" | "error", code: string, message: string, seeds: readonly string[], expectedTopology: string) => {
    const topology = topologyFor(seeds);
    issues.push({ severity, code, message, ...topology, expectedTopology });
  };
  const motorShortTopology = (start: string, goal: string) => {
    const previous = new Map<string, { from: string; wireId?: string }>();
    const pending = [start];
    previous.set(start, { from: start });
    while (pending.length && !previous.has(goal)) {
      const current = pending.shift()!;
      for (const edge of edgeGraph.get(current) ?? []) {
        if (previous.has(edge.to)) continue;
        previous.set(edge.to, { from: current, ...(edge.wireId ? { wireId: edge.wireId } : {}) });
        pending.push(edge.to);
      }
    }
    if (!previous.has(goal)) return topologyFor([start, goal]);
    const pathNodes = [goal];
    const pathWireIds: string[] = [];
    let current = goal;
    while (current !== start) {
      const step = previous.get(current)!;
      if (step.wireId) pathWireIds.push(step.wireId);
      current = step.from;
      pathNodes.push(current);
    }
    const endpoints = [...new Set(pathNodes)].map(value => {
      const separator = value.indexOf(":");
      return { componentId: value.slice(0, separator), pin: value.slice(separator + 1) };
    });
    return {
      componentIds: [...new Set(endpoints.map(endpoint => endpoint.componentId))],
      wireIds: [...new Set(pathWireIds)],
      nets: [{ id: `net:${find(start)}`, endpoints, wireIds: [...new Set(pathWireIds)] }],
    };
  };
  for (const wire of project.connections) {
    const a = key(wire.from.componentId, wire.from.pin); const b = key(wire.to.componentId, wire.to.pin);
    if (!graph.has(a)) graph.set(a, new Set()); if (!graph.has(b)) graph.set(b, new Set());
    graph.get(a)!.add(b); graph.get(b)!.add(a);
    edgeGraph.set(a, [...(edgeGraph.get(a) ?? []), { to: b, wireId: wire.id }]);
    edgeGraph.set(b, [...(edgeGraph.get(b) ?? []), { to: a, wireId: wire.id }]);
    join(a, b);
  }
  const voltages = new Map<string, number>();
  for (const part of project.components) if (isBoardType(part.type)) {
    Object.entries(getBoardProfile(part.type)!.rails).forEach(([pin, volts]) => voltages.set(key(part.id, pin), volts));
  }
  for (const part of project.components) {
    if (part.type === "dc-supply" && part.properties?.enabled !== false) voltages.set(key(part.id, "+"), Number(part.properties?.voltage ?? 5));
    if (part.type === "battery-cell") {
      const soc = Math.max(0, Math.min(100, Number(part.properties?.initialSoc ?? 50)));
      voltages.set(key(part.id, "+"), soc < 5 ? 2.5 + soc * 0.112 : 3 + 1.2 * soc / 100);
    }
  }
  const groundSources = project.components.flatMap(part => isBoardType(part.type)
    ? getBoardProfile(part.type)!.groundPins.map(pin => key(part.id, pin))
    : part.type === "ground" ? [key(part.id, "GND")] : []);
  // Use the DC solver's node voltages when available. Looking only at the
  // voltage of a source component on the same wired net misreads the top of
  // a series battery stack as one cell's voltage (for example, 10.8 V as 3.6 V).
  const solvedPower = new PowerRuntime().solve(project, 0);
  const reachableFrom = (start: string) => {
    const pending = [start]; const visited = new Set<string>();
    while (pending.length) { const endpoint = pending.pop()!; if (visited.has(endpoint)) continue; visited.add(endpoint); pending.push(...(graph.get(endpoint) ?? [])); }
    return visited;
  };
  for (const part of project.components) {
    const definition = getComponentDefinition(part.type);
    if (!definition?.metadata) continue;
    for (const pin of definition.pins) if (pin.noConnect && graph.has(key(part.id, pin.id))) addIssue("error", "no-connect-pin", `${part.label} pin ${pin.number} (${pin.label}) must be left unconnected.`, [key(part.id, pin.id)], "Leave this pin disconnected.");
    for (const supply of definition.metadata.supplies) for (const pin of supply.pins) {
      const visited = reachableFrom(key(part.id, pin));
      const resolvedVoltage = solvedPower.voltage(part.id, pin);
      const connectedSources = resolvedVoltage !== undefined
        ? [resolvedVoltage]
        : [...visited].flatMap(endpoint => voltages.has(endpoint) ? [voltages.get(endpoint)!] : []);
      if (!connectedSources.length) {
        addIssue("warning", "supply-not-connected", `${part.label} supply pin ${pin} is not wired to a known-voltage source; expected ${supply.minVolts}–${supply.maxVolts} V.`, [key(part.id, pin)], `Connect ${part.label}.${pin} to one source within ${supply.minVolts}–${supply.maxVolts} V.`);
      } else {
        const unsafe = connectedSources.find(voltage => voltage < supply.minVolts || voltage > supply.maxVolts);
        if (unsafe !== undefined) addIssue("warning", "supply-voltage-range", `${part.label} supply pin ${pin} is wired to ${unsafe} V; its documented range is ${supply.minVolts}–${supply.maxVolts} V.`, [key(part.id, pin)], `Connect ${part.label}.${pin} to a source within ${supply.minVolts}–${supply.maxVolts} V.`);
      }
    }
    for (const pin of definition.metadata.groundPins) {
      const reachable = reachableFrom(key(part.id, pin));
      const explicitlyGroundedReturn = project.components.some(candidate =>
        (candidate.type === "dc-supply" || candidate.type === "battery-cell")
        && reachable.has(key(candidate.id, "-"))
        && groundSources.some(endpoint => reachableFrom(key(candidate.id, "-")).has(endpoint)));
      if ([...reachable].some(endpoint => groundSources.includes(endpoint)) || explicitlyGroundedReturn) continue;
      addIssue("warning", "ground-not-connected", `${part.label} ground pin ${pin} is not wired to a board ground, ground symbol, or power return.`, [key(part.id, pin)], `Connect ${part.label}.${pin} to the common circuit ground.`);
    }
  }

  // Repeated physical pads on the TB6612FNG are aliases of one electrical
  // output. Treat them as the same net when checking whether a motor spans a
  // complete H-bridge channel.
  const internalAliases: Record<string, string[][]> = {
    tb6612fng: [["AO1_1", "AO1_2"], ["AO2_5", "AO2_6"], ["BO1_11", "BO1_12"], ["BO2_7", "BO2_8"]],
  };
  for (const part of project.components) for (const group of internalAliases[part.type] ?? []) {
    for (let index = 1; index < group.length; index += 1) {
      const first = key(part.id, group[0]), alias = key(part.id, group[index]);
      join(first, alias);
      edgeGraph.set(first, [...(edgeGraph.get(first) ?? []), { to: alias }]);
      edgeGraph.set(alias, [...(edgeGraph.get(alias) ?? []), { to: first }]);
    }
  }

  const motorDriverChannels: Record<string, Array<[string, string]>> = {
    "l293d": [["OUT1", "OUT2"], ["OUT3", "OUT4"]],
    "tb6612fng": [["AO1_1", "AO2_5"], ["BO1_11", "BO2_7"]],
    "drv8833": [["AOUT1", "AOUT2"], ["BOUT1", "BOUT2"]],
    "l298": [["OUT1", "OUT2"], ["OUT3", "OUT4"]],
  };
  const motorDrivers = project.components.filter(part => motorDriverChannels[part.type]);
  const describeMotorNet = (motorId: string, terminal: string) => {
    const endpoint = key(motorId, terminal);
    const connectedOutputs = motorDrivers.flatMap(driver => (motorDriverChannels[driver.type] ?? []).flatMap(([outputA, outputB], channelIndex) => {
      const sidePins = [outputA, outputB].map(pin => internalAliases[driver.type]?.find(group => group.includes(pin)) ?? [pin]);
      const sides = sidePins.map(pins => pins.filter(pin => find(key(driver.id, pin)) === find(endpoint)));
      if (!sides.some(pins => pins.length)) return [];
      return [`${driver.label} channel ${channelIndex === 0 ? "A" : "B"} (${sides.map(pins => pins.join("/") || "open").join(" ↔ ")})`];
    }));
    return `${terminal} -> ${connectedOutputs.length ? connectedOutputs.join(", ") : "no motor-driver output"}`;
  };
  for (const motor of project.components.filter(part => part.type === "dc-motor")) {
    const positive = key(motor.id, "+");
    const negative = key(motor.id, "-");
    const positiveConnected = (graph.get(positive) ?? new Set()).size > 0;
    const negativeConnected = (graph.get(negative) ?? new Set()).size > 0;
    if (!positiveConnected || !negativeConnected) {
      const open = [!positiveConnected ? "+" : "", !negativeConnected ? "-" : ""].filter(Boolean).join(" and ");
      addIssue("error", "motor-terminal-open", `${motor.label} has an unconnected ${open} terminal; connect both motor leads.`, [positive, negative], `Connect ${motor.label}.+ and ${motor.label}.- to separate opposing outputs on one driver channel.`);
      continue;
    }
    if (find(positive) === find(negative)) {
      const message = `${motor.label} + and - terminals are connected to the same net (${describeMotorNet(motor.id, "+")}; ${describeMotorNet(motor.id, "-")}). For a TB6612FNG, AO1_1/AO1_2 are duplicate pads; put the other motor lead on AO2_5/AO2_6.`;
      issues.push({
        severity: "error",
        code: "motor-terminals-shorted",
        message,
        ...motorShortTopology(positive, negative),
        expectedTopology: `Place ${motor.label}.+ and ${motor.label}.- on different output nets of one H-bridge channel; remove the shorting path identified by wireIds and connect the opposite motor terminal to the channel's other output.`,
      });
      continue;
    }
    if (motorDrivers.length && !motorDrivers.some(driver =>
      (motorDriverChannels[driver.type] ?? []).some(([outputA, outputB]) => {
        const a = find(key(driver.id, outputA)); const b = find(key(driver.id, outputB));
        return (find(positive) === a && find(negative) === b) || (find(positive) === b && find(negative) === a);
      }))) {
      addIssue("error", "motor-driver-output-wiring", `${motor.label} is not connected across two outputs of one motor-driver channel. Current wiring: ${describeMotorNet(motor.id, "+")}; ${describeMotorNet(motor.id, "-")}. Connect both leads to the same channel's opposing outputs.`, [positive, negative], `Connect both motor terminals to different outputs within one motor-driver channel, keeping other loads and driver channels separate.`);
    }
  }
  return issues;
}
