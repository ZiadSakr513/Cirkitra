/** The on-disk/API schema version for CircuitProject. */
export const CIRCUIT_PROJECT_SCHEMA_VERSION = 1 as const;

export const ARDUINO_UNO_BOARD = "arduino-uno" as const;

export type CircuitProjectSchemaVersion =
  typeof CIRCUIT_PROJECT_SCHEMA_VERSION;
export type CircuitBoard = typeof ARDUINO_UNO_BOARD;
export type CircuitRotation = 0 | 90 | 180 | 270;
export type ComponentPropertyValue = string | number | boolean | null;
export type ComponentProperties = Record<string, ComponentPropertyValue>;

/** A component placed on the schematic canvas. */
export interface CircuitComponent {
  id: string;
  /** A catalog ID such as `arduino-uno`, `led`, or `push-button`. */
  type: string;
  label: string;
  x: number;
  y: number;
  rotation?: CircuitRotation;
  properties?: ComponentProperties;
}

/** A reference to one catalog pin on one placed component. */
export interface ConnectionEndpoint {
  componentId: string;
  pin: string;
}

/** A two-ended wire in the v1 schematic model. */
export interface CircuitConnection {
  id: string;
  from: ConnectionEndpoint;
  to: ConnectionEndpoint;
  color?: string;
}

/**
 * Portable v1 project contract used by the editor, APIs, and `.aics` files.
 *
 * Keep this object data-only. It must remain safe to serialize in a browser or
 * a Cloudflare Worker without Node-specific values.
 */
export interface CircuitProject {
  schemaVersion: CircuitProjectSchemaVersion;
  id: string;
  name: string;
  description: string;
  board: CircuitBoard;
  components: CircuitComponent[];
  connections: CircuitConnection[];
  /** Arduino C++ sketch source. */
  code: string;
}

export type CircuitProjectInput = Omit<CircuitProject, "schemaVersion"> & {
  schemaVersion?: CircuitProjectSchemaVersion;
};
