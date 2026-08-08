import { diagnoseCircuit, type CircuitDiagnostic } from "./diagnostics.ts";
import { normalizeGroundReturns } from "./project.ts";
import {
  safeParseCircuitProject,
  type ValidationIssue,
} from "./schema.ts";
import {
  ARDUINO_UNO_BOARD,
  CIRCUIT_PROJECT_SCHEMA_VERSION,
  type CircuitProject,
} from "./types.ts";

export type MigratedCircuitProjectVersion = 0 | null;

export interface CircuitProjectMigrationResult {
  value: unknown;
  migratedFrom: MigratedCircuitProjectVersion;
}

export type CircuitProjectImportResult =
  | {
      ok: true;
      project: CircuitProject;
      migratedFrom: MigratedCircuitProjectVersion;
      diagnostics: CircuitDiagnostic[];
    }
  | {
      ok: false;
      stage: "json" | "schema";
      migratedFrom: MigratedCircuitProjectVersion;
      issues: ValidationIssue[];
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function migrateEndpoint(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return {
    componentId: value.componentId,
    pin: value.pin ?? value.pinId,
  };
}

function migrateConnection(value: unknown, index: number): unknown {
  if (!isRecord(value)) return value;
  return {
    id: value.id ?? `wire-${index + 1}`,
    from: migrateEndpoint(value.from),
    to: migrateEndpoint(value.to),
    ...(value.color === undefined ? {} : { color: value.color }),
  };
}

function migrateComponent(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const position = isRecord(value.position) ? value.position : undefined;
  return {
    id: value.id,
    type: value.type ?? value.typeId,
    label: value.label ?? value.name ?? value.id,
    x: value.x ?? position?.x,
    y: value.y ?? position?.y,
    ...(value.rotation === undefined ? {} : { rotation: value.rotation }),
    ...(value.properties === undefined ? {} : { properties: value.properties }),
  };
}

function legacyCode(value: Record<string, unknown>): unknown {
  if (typeof value.code === "string") return value.code;
  if (typeof value.firmware === "string") return value.firmware;
  if (isRecord(value.firmware) && typeof value.firmware.source === "string") {
    return value.firmware.source;
  }
  return "";
}

/**
 * Upgrade the supported unversioned/v0 format to v1 without mutating input.
 * Unknown future versions are intentionally left untouched so validation can
 * reject them instead of silently corrupting a newer file.
 */
export function migrateCircuitProject(
  input: unknown,
): CircuitProjectMigrationResult {
  if (!isRecord(input)) return { value: input, migratedFrom: null };

  const declaredVersion = input.schemaVersion ?? input.version;
  if (declaredVersion !== undefined && declaredVersion !== 0) {
    return { value: input, migratedFrom: null };
  }

  const rawConnections = Array.isArray(input.connections)
    ? input.connections
    : Array.isArray(input.wires)
      ? input.wires
      : [];

  const migrated = {
    schemaVersion: CIRCUIT_PROJECT_SCHEMA_VERSION,
    id: input.id,
    name: input.name,
    description:
      typeof input.description === "string" ? input.description : "",
    board:
      input.board === "arduino:avr:uno" || input.board === undefined
        ? ARDUINO_UNO_BOARD
        : input.board,
    components: Array.isArray(input.components)
      ? input.components.map(migrateComponent)
      : input.components,
    connections: rawConnections.map(migrateConnection),
    code: legacyCode(input),
  };

  return { value: migrated, migratedFrom: 0 };
}

/** Parse JSON (when needed), migrate known legacy data, and validate v1. */
export function importCircuitProject(
  input: string | unknown,
): CircuitProjectImportResult {
  let decoded: unknown = input;
  if (typeof input === "string") {
    try {
      decoded = JSON.parse(input) as unknown;
    } catch (error) {
      return {
        ok: false,
        stage: "json",
        migratedFrom: null,
        issues: [
          {
            code: "invalid_value",
            path: "$",
            message:
              error instanceof Error ? error.message : "Invalid JSON document.",
            received: input,
          },
        ],
      };
    }
  }

  const migration = migrateCircuitProject(decoded);
  const validation = safeParseCircuitProject(migration.value);
  if (!validation.success) {
    return {
      ok: false,
      stage: "schema",
      migratedFrom: migration.migratedFrom,
      issues: validation.issues,
    };
  }

  const normalized = normalizeGroundReturns(validation.data);
  return {
    ok: true,
    project: normalized,
    migratedFrom: migration.migratedFrom,
    diagnostics: diagnoseCircuit(normalized),
  };
}

/** Serialize a validated project for `.aics` export. */
export function exportCircuitProject(
  project: CircuitProject,
  pretty = true,
): string {
  return JSON.stringify(project, null, pretty ? 2 : undefined);
}
