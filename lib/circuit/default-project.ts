import {
  ARDUINO_UNO_BOARD,
  CIRCUIT_PROJECT_SCHEMA_VERSION,
  type CircuitProject,
} from "./types.ts";

const blinkCode = `// AI Circuit Studio: external LED blink
const int LED_PIN = 13;

void setup() {
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_PIN, HIGH);
  delay(1000);
  digitalWrite(LED_PIN, LOW);
  delay(1000);
}
`;

/** A valid, simulation-ready starter project with an external current limiter. */
export const DEFAULT_BLINK_PROJECT: CircuitProject = {
  schemaVersion: CIRCUIT_PROJECT_SCHEMA_VERSION,
  id: "starter-blink",
  name: "Blink an LED",
  description:
    "Arduino Uno pin D13 blinks a red LED through a 220 ohm current-limiting resistor.",
  board: ARDUINO_UNO_BOARD,
  components: [
    {
      id: "uno",
      type: "arduino-uno",
      label: "Arduino Uno",
      x: 120,
      y: 100,
      properties: { clockHz: 16_000_000 },
    },
    {
      id: "r1",
      type: "resistor",
      label: "R1 · 220 Ω",
      x: 500,
      y: 180,
      rotation: 0,
      properties: { resistance: 220 },
    },
    {
      id: "led1",
      type: "led",
      label: "LED1 · Red",
      x: 720,
      y: 160,
      rotation: 90,
      properties: { color: "#ef4444", forwardVoltage: 2 },
    },
  ],
  connections: [
    {
      id: "wire-d13-r1",
      from: { componentId: "uno", pin: "D13" },
      to: { componentId: "r1", pin: "1" },
      color: "#f59e0b",
    },
    {
      id: "wire-r1-led",
      from: { componentId: "r1", pin: "2" },
      to: { componentId: "led1", pin: "A" },
      color: "#ef4444",
    },
    {
      id: "wire-led-gnd",
      from: { componentId: "led1", pin: "K" },
      to: { componentId: "uno", pin: "GND" },
      color: "#334155",
    },
  ],
  code: blinkCode,
};

/** Return a fully independent starter value safe for mutable editor state. */
export function createDefaultBlinkProject(): CircuitProject {
  return {
    ...DEFAULT_BLINK_PROJECT,
    components: DEFAULT_BLINK_PROJECT.components.map((component) => ({
      ...component,
      properties: component.properties
        ? { ...component.properties }
        : undefined,
    })),
    connections: DEFAULT_BLINK_PROJECT.connections.map((connection) => ({
      ...connection,
      from: { ...connection.from },
      to: { ...connection.to },
    })),
  };
}
