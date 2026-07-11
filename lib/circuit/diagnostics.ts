import { getComponentDefinition, getPinDefinition } from "./catalog.ts";
import type {
  CircuitComponent,
  CircuitProject,
  ConnectionEndpoint,
} from "./types.ts";

export type CircuitDiagnosticSeverity = "error" | "warning";

export type CircuitDiagnosticCode =
  | "duplicate-component-id"
  | "duplicate-connection-id"
  | "unknown-component-type"
  | "bad-connection-endpoint"
  | "unknown-pin"
  | "self-connection"
  | "duplicate-connection"
  | "missing-board"
  | "multiple-boards";

export interface CircuitDiagnostic {
  code: CircuitDiagnosticCode;
  severity: CircuitDiagnosticSeverity;
  message: string;
  /** JSONPath-like location for UI highlighting. */
  path: string;
  componentId?: string;
  connectionId?: string;
}

function endpointKey(endpoint: ConnectionEndpoint): string {
  return `${endpoint.componentId}\u0000${endpoint.pin}`;
}

function unorderedConnectionKey(
  from: ConnectionEndpoint,
  to: ConnectionEndpoint,
): string {
  return [endpointKey(from), endpointKey(to)].sort().join("\u0001");
}

function diagnoseEndpoint(
  endpoint: ConnectionEndpoint,
  path: string,
  connectionId: string,
  componentsById: ReadonlyMap<string, CircuitComponent[]>,
  diagnostics: CircuitDiagnostic[],
): void {
  const matchingComponents = componentsById.get(endpoint.componentId);
  if (!matchingComponents || matchingComponents.length === 0) {
    diagnostics.push({
      code: "bad-connection-endpoint",
      severity: "error",
      message: `Connection references missing component "${endpoint.componentId}".`,
      path,
      componentId: endpoint.componentId,
      connectionId,
    });
    return;
  }

  // A duplicate component ID is already reported separately. Use the first
  // definition here so the user also receives useful pin feedback.
  const component = matchingComponents[0];
  const definition = getComponentDefinition(component.type);
  if (!definition) return;

  if (!getPinDefinition(component.type, endpoint.pin)) {
    diagnostics.push({
      code: "unknown-pin",
      severity: "error",
      message: `Pin "${endpoint.pin}" does not exist on ${definition.displayName}.`,
      path: `${path}.pin`,
      componentId: component.id,
      connectionId,
    });
  }
}

/**
 * Run catalog-aware semantic checks after structural schema validation.
 * Diagnostics never throw, so partially broken drafts can still be opened.
 */
export function diagnoseCircuit(
  project: CircuitProject,
): CircuitDiagnostic[] {
  const diagnostics: CircuitDiagnostic[] = [];
  const componentsById = new Map<string, CircuitComponent[]>();
  const componentFirstIndexes = new Map<string, number>();

  project.components.forEach((component, index) => {
    const existing = componentsById.get(component.id);
    if (existing) {
      existing.push(component);
      diagnostics.push({
        code: "duplicate-component-id",
        severity: "error",
        message: `Component ID "${component.id}" is used more than once.`,
        path: `$.components[${index}].id`,
        componentId: component.id,
      });
    } else {
      componentsById.set(component.id, [component]);
      componentFirstIndexes.set(component.id, index);
    }

    if (!getComponentDefinition(component.type)) {
      diagnostics.push({
        code: "unknown-component-type",
        severity: "error",
        message: `Component type "${component.type}" is not supported.`,
        path: `$.components[${index}].type`,
        componentId: component.id,
      });
    }
  });

  const boards = project.components.filter(
    (component) => component.type === "arduino-uno",
  );
  if (boards.length === 0) {
    diagnostics.push({
      code: "missing-board",
      severity: "warning",
      message: "The project has no Arduino Uno component on the schematic.",
      path: "$.components",
    });
  } else if (boards.length > 1) {
    const duplicateBoardIndex = componentFirstIndexes.get(boards[1].id);
    diagnostics.push({
      code: "multiple-boards",
      severity: "warning",
      message: "Schema v1 simulates one Arduino Uno at a time.",
      path:
        duplicateBoardIndex === undefined
          ? "$.components"
          : `$.components[${duplicateBoardIndex}]`,
      componentId: boards[1].id,
    });
  }

  const connectionIds = new Set<string>();
  const connectionPairs = new Map<string, string>();

  project.connections.forEach((connection, index) => {
    const basePath = `$.connections[${index}]`;
    if (connectionIds.has(connection.id)) {
      diagnostics.push({
        code: "duplicate-connection-id",
        severity: "error",
        message: `Connection ID "${connection.id}" is used more than once.`,
        path: `${basePath}.id`,
        connectionId: connection.id,
      });
    } else {
      connectionIds.add(connection.id);
    }

    diagnoseEndpoint(
      connection.from,
      `${basePath}.from`,
      connection.id,
      componentsById,
      diagnostics,
    );
    diagnoseEndpoint(
      connection.to,
      `${basePath}.to`,
      connection.id,
      componentsById,
      diagnostics,
    );

    if (endpointKey(connection.from) === endpointKey(connection.to)) {
      diagnostics.push({
        code: "self-connection",
        severity: "error",
        message: "A connection cannot join a pin to itself.",
        path: basePath,
        connectionId: connection.id,
      });
    }

    const pairKey = unorderedConnectionKey(connection.from, connection.to);
    const existingConnectionId = connectionPairs.get(pairKey);
    if (existingConnectionId) {
      diagnostics.push({
        code: "duplicate-connection",
        severity: "warning",
        message: `This duplicates connection "${existingConnectionId}".`,
        path: basePath,
        connectionId: connection.id,
      });
    } else {
      connectionPairs.set(pairKey, connection.id);
    }
  });

  return diagnostics;
}

export function hasCircuitErrors(
  diagnostics: readonly CircuitDiagnostic[],
): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === "error");
}
