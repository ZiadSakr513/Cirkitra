import { getComponentDefinition } from "./catalog.ts";
import type { CircuitComponent, CircuitConnection, CircuitProject, ConnectionEndpoint } from "./types.ts";
import { boardApiConstants, getBoardProfile, isBoardType, resolveBoardPin } from "./boards.ts";


function uniqueComponentId(preferred: string, occupied: Set<string>) {
  let id = preferred.replace(/[^A-Za-z0-9_-]/g, "-");
  if (!/^[A-Za-z]/.test(id)) id = `ground-${id}`;
  let suffix = 2;
  const base = id;
  while (occupied.has(id)) id = `${base}-${suffix++}`;
  occupied.add(id);
  return id;
}

function replaceEndpoint(
  connection: CircuitConnection,
  side: "from" | "to",
  endpoint: ConnectionEndpoint,
): CircuitConnection {
  return { ...connection, [side]: endpoint };
}

/**
 * Spread repeated Arduino ground returns across its three physical GND pins.
 * Further returns receive their own zero-volt ground terminal beside the load.
 */
export function normalizeGroundReturns(project: CircuitProject): CircuitProject {
  const boards = new Map(project.components.filter(component => isBoardType(component.type)).map(board => [board.id, board]));
  if (boards.size === 0) return project;
  const componentById = new Map(project.components.map((component) => [component.id, component]));
  const occupiedIds = new Set(project.components.map((component) => component.id));
  const additions: CircuitComponent[] = [];
  const groundReturnIndexes = new Map<string, number>();
  let changed = false;

  const connections = project.connections.map((original) => {
    const fromBoard = boards.get(original.from.componentId);
    const toBoard = boards.get(original.to.componentId);
    const fromGroundPins = fromBoard ? getBoardProfile(fromBoard.type)?.groundPins ?? [] : [];
    const toGroundPins = toBoard ? getBoardProfile(toBoard.type)?.groundPins ?? [] : [];
    const side = fromGroundPins.includes(original.from.pin) ? "from" : toGroundPins.includes(original.to.pin) ? "to" : null;
    if (!side) return original;

    const board = side === "from" ? fromBoard! : toBoard!;
    const boardGroundPins = side === "from" ? fromGroundPins : toGroundPins;
    const groundReturnIndex = groundReturnIndexes.get(board.id) ?? 0;
    groundReturnIndexes.set(board.id, groundReturnIndex + 1);

    const loadEndpoint = side === "from" ? original.to : original.from;
    const assignedPin = boardGroundPins[groundReturnIndex];
    if (assignedPin) {
      if (original[side].pin === assignedPin) return original;
      changed = true;
      return replaceEndpoint(original, side, { componentId: board.id, pin: assignedPin });
    }

    const load = componentById.get(loadEndpoint.componentId);
    const definition = load ? getComponentDefinition(load.type) : undefined;
    const groundId = uniqueComponentId(`ground-${original.id}`, occupiedIds);
    const overflowIndex = additions.length;
    additions.push({
      id: groundId,
      type: "ground",
      label: `GND ${overflowIndex + 1}`,
      x: (load?.x ?? board.x) + ((definition?.width ?? 80) - 56) / 2 + (overflowIndex % 3) * 14,
      y: (load?.y ?? board.y) + (definition?.height ?? 80) + 34 + Math.floor(overflowIndex / 3) * 72,
      rotation: 0,
      properties: { automatic: true },
    });
    changed = true;
    return replaceEndpoint(original, side, { componentId: groundId, pin: "GND" });
  });

  if (!changed) return project;
  return { ...project, components: [...project.components, ...additions], connections };
}

/** Tie active, unmanaged motor-driver standby/enable pins to a valid high rail. */
export function connectFloatingMotorDriverEnables(
  project: CircuitProject,
  options: { preserveStandbyControl?: boolean } = {},
): CircuitProject {
  const boards = project.components.filter((component) => isBoardType(component.type));
  const connections = project.connections.map((connection) => ({
    ...connection,
    from: { ...connection.from },
    to: { ...connection.to },
  }));
  const usedIds = new Set(connections.map((connection) => connection.id));
  let changed = false;
  const projectPrograms = boards.map(board => project.programs?.[board.id] ?? (board.type === project.board ? project.code : ""));
  const preserveStandbyControl = options.preserveStandbyControl === true
    || projectPrograms.some(source => /\b(?:pinMode|digitalWrite|analogWrite)\s*\([^)]*\b(?:STBY|standby|nSLEEP)\w*\b/i.test(source));
  const connected = (componentId: string, pin: string) => connections.some(({ from, to }) =>
    (from.componentId === componentId && from.pin === pin) || (to.componentId === componentId && to.pin === pin));
  const addConnection = (idBase: string, from: CircuitConnection["from"], to: CircuitConnection["to"]) => {
    let id = idBase;
    let suffix = 2;
    while (usedIds.has(id)) id = `${idBase}-${suffix++}`;
    usedIds.add(id);
    connections.push({ id, from, to, color: "#f59e0b" });
    changed = true;
  };

  const boardForDriver = (driverId: string, controlPins: readonly string[]) => {
    for (const connection of connections) {
      const endpoint = [connection.from, connection.to].find(item => item.componentId === driverId && controlPins.includes(item.pin));
      if (!endpoint) continue;
      const peer = connection.from === endpoint ? connection.to : connection.from;
      const board = boards.find(candidate => candidate.id === peer.componentId);
      if (board) return board;
    }
    return boards.find(candidate => candidate.id === project.activeBoardId) ?? boards.find(candidate => candidate.type === project.board) ?? boards[0];
  };

  for (const driver of project.components) {
    const driverBoard = boardForDriver(driver.id, ["EN1", "EN2", "IN1", "IN2", "IN3", "IN4", "A1", "A2", "B1", "B2", "ENA", "ENB", "STBY", "nSLEEP"]);
    if (driver.type === "l293d" && driverBoard) {
      for (const [enable, outputs] of [["EN1", ["OUT1", "OUT2"]], ["EN2", ["OUT3", "OUT4"]]] as const) {
        if (connected(driver.id, enable) || !outputs.some((pin) => connected(driver.id, pin))) continue;
        const profile = getBoardProfile(driverBoard.type)!;
        const rail = profile.rails["5V"] !== undefined ? "5V" : Object.keys(profile.rails)[0];
        if (rail) addConnection(`enable-${driver.id}-${enable}`, { componentId: driverBoard.id, pin: rail }, { componentId: driver.id, pin: enable });
      }
    }

    if (driver.type === "tb6612fng") {
      const motorOutputs = ["AO1_1", "AO1_2", "AO2_5", "AO2_6", "BO1_11", "BO1_12", "BO2_7", "BO2_8"];
      if (!motorOutputs.some((pin) => connected(driver.id, pin))) continue;
      const logicSupply = connections.find(({ from, to }) =>
        (from.componentId === driver.id && from.pin === "VCC") || (to.componentId === driver.id && to.pin === "VCC"));
      if (!logicSupply) continue;
      const supplyEndpoint = logicSupply.from.componentId === driver.id && logicSupply.from.pin === "VCC"
        ? logicSupply.to
        : logicSupply.from;
      const standbyWire = connections.find(({ from, to }) =>
        (from.componentId === driver.id && from.pin === "STBY") || (to.componentId === driver.id && to.pin === "STBY"));
      if (!standbyWire) {
        if (preserveStandbyControl) continue;
        addConnection(`enable-${driver.id}-STBY`, supplyEndpoint, { componentId: driver.id, pin: "STBY" });
        continue;
      }

      if (preserveStandbyControl) continue;

      const standbyEndpoint = standbyWire.from.componentId === driver.id && standbyWire.from.pin === "STBY"
        ? standbyWire.to
        : standbyWire.from;
      const standbyBoard = boards.find(candidate => candidate.id === standbyEndpoint.componentId);
      if (!standbyBoard) continue;
      const codePin = resolveBoardPin(standbyBoard.type, standbyEndpoint.pin);
      if (codePin === undefined) continue;
      const source = project.programs?.[standbyBoard.id] ?? (standbyBoard.type === project.board ? project.code : "");
      const codeRefsPin = (pin: string, number: number) => new RegExp(`\\b(?:${pin}|${number})\\b`, "i").test(source);
      const aliases = Object.entries(boardApiConstants(standbyBoard.type)).filter(([, value]) => value === codePin).map(([name]) => name);
      if (codeRefsPin(standbyEndpoint.pin, codePin) || aliases.some(alias => codeRefsPin(alias, codePin))) continue;

      // A TB6612 STBY wire ending at an unused MCU input is physically connected
      // but electrically floating. Replace that endpoint with the known VCC net.
      const wireIndex = connections.findIndex(({ id }) => id === standbyWire.id);
      const repairedWire = connections[wireIndex];
      if (repairedWire.from.componentId === driver.id && repairedWire.from.pin === "STBY") connections[wireIndex] = { ...repairedWire, to: supplyEndpoint };
      else connections[wireIndex] = { ...repairedWire, from: supplyEndpoint };
      changed = true;
    }
  }
  return changed ? { ...project, connections } : project;
}

/**
 * Remove a placed component and every wire attached to it.
 *
 * Boards deliberately use the same operation as every other catalog part so
 * the editor can represent an empty canvas or let the user swap boards.
 */
export function removeComponentFromProject(
  project: CircuitProject,
  componentId: string,
): CircuitProject {
  return removeComponentsFromProject(project, [componentId]);
}

/** Remove several placed components and every wire attached to any of them. */
export function removeComponentsFromProject(
  project: CircuitProject,
  componentIds: readonly string[],
): CircuitProject {
  const removedIds = new Set(componentIds);
  if (!project.components.some((component) => removedIds.has(component.id))) {
    return project;
  }

  return {
    ...project,
    components: project.components.filter(
      (component) => !removedIds.has(component.id),
    ),
    connections: project.connections.filter(
      (connection) =>
        !removedIds.has(connection.from.componentId) &&
        !removedIds.has(connection.to.componentId),
    ),
  };
}
