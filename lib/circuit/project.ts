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
