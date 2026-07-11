import {
  ARDUINO_UNO_BOARD,
  CIRCUIT_PROJECT_SCHEMA_VERSION,
  type CircuitProject,
} from "./types.ts";

export type ValidationIssueCode =
  | "invalid_type"
  | "required"
  | "invalid_value"
  | "unsupported_version";

export interface ValidationIssue {
  code: ValidationIssueCode;
  path: string;
  message: string;
  received?: unknown;
}

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; issues: ValidationIssue[] };

export class CircuitProjectValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super(
      `Invalid circuit project: ${issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("; ")}`,
    );
    this.name = "CircuitProjectValidationError";
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addRequiredString(
  object: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
): void {
  const value = object[key];
  if (typeof value !== "string") {
    issues.push({
      code: value === undefined ? "required" : "invalid_type",
      path: `${path}.${key}`,
      message: "Expected a string.",
      received: value,
    });
  } else if (value.trim().length === 0) {
    issues.push({
      code: "invalid_value",
      path: `${path}.${key}`,
      message: "Expected a non-empty string.",
      received: value,
    });
  }
}

function addFiniteNumber(
  object: Record<string, unknown>,
  key: string,
  path: string,
  issues: ValidationIssue[],
): void {
  const value = object[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push({
      code: value === undefined ? "required" : "invalid_type",
      path: `${path}.${key}`,
      message: "Expected a finite number.",
      received: value,
    });
  }
}

function validateEndpoint(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!isRecord(value)) {
    issues.push({
      code: value === undefined ? "required" : "invalid_type",
      path,
      message: "Expected a connection endpoint object.",
      received: value,
    });
    return;
  }

  addRequiredString(value, "componentId", path, issues);
  addRequiredString(value, "pin", path, issues);
}

function validateProperties(
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): void {
  if (!isRecord(value)) {
    issues.push({
      code: "invalid_type",
      path,
      message: "Expected a property object.",
      received: value,
    });
    return;
  }

  for (const [key, property] of Object.entries(value)) {
    const propertyType = typeof property;
    if (
      property !== null &&
      propertyType !== "string" &&
      propertyType !== "number" &&
      propertyType !== "boolean"
    ) {
      issues.push({
        code: "invalid_type",
        path: `${path}.${key}`,
        message: "Expected a string, number, boolean, or null.",
        received: property,
      });
    } else if (propertyType === "number" && !Number.isFinite(property)) {
      issues.push({
        code: "invalid_value",
        path: `${path}.${key}`,
        message: "Expected a finite number.",
        received: property,
      });
    }
  }
}

/** Validate the portable v1 shape without applying catalog semantics. */
export function safeParseCircuitProject(
  value: unknown,
): ValidationResult<CircuitProject> {
  const issues: ValidationIssue[] = [];

  if (!isRecord(value)) {
    return {
      success: false,
      issues: [
        {
          code: "invalid_type",
          path: "$",
          message: "Expected a circuit project object.",
          received: value,
        },
      ],
    };
  }

  if (value.schemaVersion !== CIRCUIT_PROJECT_SCHEMA_VERSION) {
    issues.push({
      code:
        typeof value.schemaVersion === "number"
          ? "unsupported_version"
          : value.schemaVersion === undefined
            ? "required"
            : "invalid_type",
      path: "$.schemaVersion",
      message: `Expected schema version ${CIRCUIT_PROJECT_SCHEMA_VERSION}.`,
      received: value.schemaVersion,
    });
  }

  addRequiredString(value, "id", "$", issues);
  addRequiredString(value, "name", "$", issues);

  if (typeof value.description !== "string") {
    issues.push({
      code: value.description === undefined ? "required" : "invalid_type",
      path: "$.description",
      message: "Expected a string.",
      received: value.description,
    });
  }

  if (value.board !== ARDUINO_UNO_BOARD) {
    issues.push({
      code: "invalid_value",
      path: "$.board",
      message: `Only ${ARDUINO_UNO_BOARD} is supported in schema v1.`,
      received: value.board,
    });
  }

  if (!Array.isArray(value.components)) {
    issues.push({
      code: value.components === undefined ? "required" : "invalid_type",
      path: "$.components",
      message: "Expected an array of components.",
      received: value.components,
    });
  } else {
    value.components.forEach((component, index) => {
      const path = `$.components[${index}]`;
      if (!isRecord(component)) {
        issues.push({
          code: "invalid_type",
          path,
          message: "Expected a component object.",
          received: component,
        });
        return;
      }

      addRequiredString(component, "id", path, issues);
      addRequiredString(component, "type", path, issues);
      addRequiredString(component, "label", path, issues);
      addFiniteNumber(component, "x", path, issues);
      addFiniteNumber(component, "y", path, issues);

      if (
        component.rotation !== undefined &&
        component.rotation !== 0 &&
        component.rotation !== 90 &&
        component.rotation !== 180 &&
        component.rotation !== 270
      ) {
        issues.push({
          code: "invalid_value",
          path: `${path}.rotation`,
          message: "Expected 0, 90, 180, or 270 degrees.",
          received: component.rotation,
        });
      }

      if (component.properties !== undefined) {
        validateProperties(component.properties, `${path}.properties`, issues);
      }
    });
  }

  if (!Array.isArray(value.connections)) {
    issues.push({
      code: value.connections === undefined ? "required" : "invalid_type",
      path: "$.connections",
      message: "Expected an array of connections.",
      received: value.connections,
    });
  } else {
    value.connections.forEach((connection, index) => {
      const path = `$.connections[${index}]`;
      if (!isRecord(connection)) {
        issues.push({
          code: "invalid_type",
          path,
          message: "Expected a connection object.",
          received: connection,
        });
        return;
      }

      addRequiredString(connection, "id", path, issues);
      validateEndpoint(connection.from, `${path}.from`, issues);
      validateEndpoint(connection.to, `${path}.to`, issues);

      if (
        connection.color !== undefined &&
        typeof connection.color !== "string"
      ) {
        issues.push({
          code: "invalid_type",
          path: `${path}.color`,
          message: "Expected a string.",
          received: connection.color,
        });
      }
    });
  }

  if (typeof value.code !== "string") {
    issues.push({
      code: value.code === undefined ? "required" : "invalid_type",
      path: "$.code",
      message: "Expected Arduino C++ source as a string.",
      received: value.code,
    });
  }

  if (issues.length > 0) {
    return { success: false, issues };
  }

  return { success: true, data: value as unknown as CircuitProject };
}

export function parseCircuitProject(value: unknown): CircuitProject {
  const result = safeParseCircuitProject(value);
  if (!result.success) {
    throw new CircuitProjectValidationError(result.issues);
  }
  return result.data;
}

/** Small dependency-free schema facade with a familiar parse/safeParse API. */
export const circuitProjectSchema = Object.freeze({
  parse: parseCircuitProject,
  safeParse: safeParseCircuitProject,
});
