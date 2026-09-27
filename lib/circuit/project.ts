import { getComponentDefinition } from "./catalog.ts";
import type { CircuitComponent, CircuitConnection, CircuitProject, ConnectionEndpoint } from "./types.ts";

const UNO_GROUND_PINS = ["GND", "GND2", "GND3"] as const;

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
  const uno = project.components.find((component) => component.type === "arduino-uno");
  if (!uno) return project;

  const componentById = new Map(project.components.map((component) => [component.id, component]));
  const occupiedIds = new Set(project.components.map((component) => component.id));
  const additions: CircuitComponent[] = [];
  let groundReturnIndex = 0;
  let changed = false;

  const connections = project.connections.map((original) => {
    const side = original.from.componentId === uno.id && /^GND\d*$/.test(original.from.pin)
      ? "from"
      : original.to.componentId === uno.id && /^GND\d*$/.test(original.to.pin)
        ? "to"
        : null;
    if (!side) return original;

    const loadEndpoint = side === "from" ? original.to : original.from;
    const assignedPin = UNO_GROUND_PINS[groundReturnIndex];
    groundReturnIndex += 1;
    if (assignedPin) {
      if (original[side].pin === assignedPin) return original;
      changed = true;
      return replaceEndpoint(original, side, { componentId: uno.id, pin: assignedPin });
    }

    const load = componentById.get(loadEndpoint.componentId);
    const definition = load ? getComponentDefinition(load.type) : undefined;
    const groundId = uniqueComponentId(`ground-${original.id}`, occupiedIds);
    const overflowIndex = additions.length;
    additions.push({
      id: groundId,
      type: "ground",
      label: `GND ${overflowIndex + 1}`,
      x: (load?.x ?? uno.x) + ((definition?.width ?? 80) - 56) / 2 + (overflowIndex % 3) * 14,
      y: (load?.y ?? uno.y) + (definition?.height ?? 80) + 34 + Math.floor(overflowIndex / 3) * 72,
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
  const uno = project.components.find((component) => component.type === "arduino-uno");
  const connections = project.connections.map((connection) => ({
    ...connection,
    from: { ...connection.from },
    to: { ...connection.to },
  }));
  const usedIds = new Set(connections.map((connection) => connection.id));
  let changed = false;
  const preserveStandbyControl = options.preserveStandbyControl === true
    || /\b(?:pinMode|digitalWrite|analogWrite)\s*\([^)]*\b(?:STBY|standby|nSLEEP)\w*\b/i.test(project.code);
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

  for (const driver of project.components) {
    if (driver.type === "l293d" && uno) {
      for (const [enable, outputs] of [["EN1", ["OUT1", "OUT2"]], ["EN2", ["OUT3", "OUT4"]]] as const) {
        if (connected(driver.id, enable) || !outputs.some((pin) => connected(driver.id, pin))) continue;
        addConnection(`enable-${driver.id}-${enable}`, { componentId: uno.id, pin: "5V" }, { componentId: driver.id, pin: enable });
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
      if (standbyEndpoint.componentId !== uno?.id) continue;
      const pinMatch = standbyEndpoint.pin.match(/^(D|A)(\d+)$/);
      if (!pinMatch) continue;
      const codePin = Number(pinMatch[2]) + (pinMatch[1] === "A" ? 14 : 0);
      const codeRefsPin = (pin: string, number: number) => new RegExp(`\\b(?:${pin}|${number})\\b`, "i").test(project.code);
      if (codeRefsPin(standbyEndpoint.pin, codePin) || (pinMatch[1] === "A" && codeRefsPin(standbyEndpoint.pin, Number(pinMatch[2])))) continue;

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
