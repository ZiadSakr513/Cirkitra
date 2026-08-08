import type {
  ComponentProperties,
  ComponentPropertyValue,
} from "./types.ts";

export type ComponentCategory =
  | "boards"
  | "passives"
  | "inputs"
  | "outputs"
  | "displays"
  | "motors"
  | "logic"
  | "sensors"
  | "drivers";

export type PinDirection =
  | "input"
  | "output"
  | "bidirectional"
  | "passive"
  | "power";

export type PinSignal =
  | "digital"
  | "analog"
  | "pwm"
  | "power"
  | "ground"
  | "uart"
  | "i2c"
  | "spi";

export type PinSide = "top" | "right" | "bottom" | "left";

export interface ComponentPinDefinition {
  id: string;
  label: string;
  direction: PinDirection;
  signals: readonly PinSignal[];
  side: PinSide;
  order: number;
}

export interface ComponentPropertyDefinition {
  label: string;
  kind: "string" | "number" | "boolean" | "color" | "select";
  defaultValue: ComponentPropertyValue;
  unit?: string;
  min?: number;
  max?: number;
  options?: readonly string[];
}

export interface ComponentDefinition {
  id: string;
  displayName: string;
  category: ComponentCategory;
  description: string;
  width: number;
  height: number;
  accent: string;
  simulated: boolean;
  pins: readonly ComponentPinDefinition[];
  properties: Readonly<Record<string, ComponentPropertyDefinition>>;
  defaultProperties: Readonly<ComponentProperties>;
}

const digitalPins: ComponentPinDefinition[] = Array.from(
  { length: 14 },
  (_, index) => ({
    id: `D${index}`,
    label:
      index === 0
        ? "D0 / RX"
        : index === 1
          ? "D1 / TX"
          : [3, 5, 6, 9, 10, 11].includes(index)
            ? `D${index} ~`
            : `D${index}`,
    direction: "bidirectional" as const,
    signals:
      index === 0 || index === 1
        ? (["digital", "uart"] as const)
        : [3, 5, 6, 9, 10, 11].includes(index)
          ? (["digital", "pwm"] as const)
          : (["digital"] as const),
    side: "right" as const,
    order: index,
  }),
);

const analogPins: ComponentPinDefinition[] = Array.from(
  { length: 6 },
  (_, index) => ({
    id: `A${index}`,
    label:
      index === 4 ? "A4 / SDA" : index === 5 ? "A5 / SCL" : `A${index}`,
    direction: "input" as const,
    signals:
      index === 4 || index === 5
        ? (["analog", "digital", "i2c"] as const)
        : (["analog", "digital"] as const),
    side: "left" as const,
    order: index + 8,
  }),
);

const binaryGatePins: readonly ComponentPinDefinition[] = [
  {
    id: "A",
    label: "A",
    direction: "input",
    signals: ["digital"],
    side: "left",
    order: 0,
  },
  {
    id: "B",
    label: "B",
    direction: "input",
    signals: ["digital"],
    side: "left",
    order: 1,
  },
  {
    id: "Y",
    label: "Y",
    direction: "output",
    signals: ["digital"],
    side: "right",
    order: 0,
  },
  {
    id: "VCC",
    label: "VCC",
    direction: "power",
    signals: ["power"],
    side: "top",
    order: 0,
  },
  {
    id: "GND",
    label: "GND",
    direction: "power",
    signals: ["ground"],
    side: "bottom",
    order: 0,
  },
];

function binaryGate(
  id: string,
  displayName: string,
  description: string,
): ComponentDefinition {
  return {
    id,
    displayName,
    category: "logic",
    description,
    width: 100,
    height: 72,
    accent: "#8b5cf6",
    simulated: true,
    pins: binaryGatePins,
    properties: {},
    defaultProperties: {},
  };
}

/**
 * The complete v1 component contract. Pin IDs are stable API values; UI labels
 * may change, but saved projects and AI output must use the IDs exactly.
 */
export const COMPONENT_CATALOG = {
  ground: {
    id: "ground",
    displayName: "Ground",
    category: "passives",
    description: "Zero-volt reference terminal for clean ground returns.",
    width: 56,
    height: 58,
    accent: "#8fa5b5",
    simulated: true,
    pins: [
      {
        id: "GND",
        label: "GND",
        direction: "power",
        signals: ["ground"],
        side: "top",
        order: 0,
      },
    ],
    properties: {},
    defaultProperties: {},
  },
  "arduino-uno": {
    id: "arduino-uno",
    displayName: "Arduino Uno",
    category: "boards",
    description: "ATmega328P development board and the v1 simulation target.",
    width: 260,
    height: 310,
    accent: "#0f9d9a",
    simulated: true,
    pins: [
      {
        id: "IOREF",
        label: "IOREF",
        direction: "power",
        signals: ["power"],
        side: "left",
        order: 0,
      },
      {
        id: "RESET",
        label: "RESET",
        direction: "input",
        signals: ["digital"],
        side: "left",
        order: 1,
      },
      {
        id: "5V",
        label: "5V",
        direction: "power",
        signals: ["power"],
        side: "left",
        order: 3,
      },
      {
        id: "3V3",
        label: "3.3V",
        direction: "power",
        signals: ["power"],
        side: "left",
        order: 2,
      },
      {
        id: "VIN",
        label: "VIN",
        direction: "power",
        signals: ["power"],
        side: "left",
        order: 6,
      },
      {
        id: "GND",
        label: "GND",
        direction: "power",
        signals: ["ground"],
        side: "left",
        order: 4,
      },
      {
        id: "GND2",
        label: "GND",
        direction: "power",
        signals: ["ground"],
        side: "left",
        order: 5,
      },
      {
        id: "AREF",
        label: "AREF",
        direction: "input",
        signals: ["analog"],
        side: "right",
        order: 14,
      },
      {
        id: "GND3",
        label: "GND",
        direction: "power",
        signals: ["ground"],
        side: "right",
        order: 15,
      },
      {
        id: "SDA",
        label: "SDA",
        direction: "bidirectional",
        signals: ["digital", "i2c"],
        side: "right",
        order: 16,
      },
      {
        id: "SCL",
        label: "SCL",
        direction: "bidirectional",
        signals: ["digital", "i2c"],
        side: "right",
        order: 17,
      },
      ...digitalPins,
      ...analogPins,
    ],
    properties: {
      clockHz: {
        label: "Clock",
        kind: "number",
        defaultValue: 16_000_000,
        unit: "Hz",
        min: 1_000_000,
        max: 20_000_000,
      },
    },
    defaultProperties: { clockHz: 16_000_000 },
  },
  led: {
    id: "led",
    displayName: "LED",
    category: "outputs",
    description: "A two-lead light-emitting diode.",
    width: 72,
    height: 88,
    accent: "#ef4444",
    simulated: true,
    pins: [
      {
        id: "A",
        label: "Anode (+)",
        direction: "passive",
        signals: ["digital", "pwm"],
        side: "top",
        order: 0,
      },
      {
        id: "K",
        label: "Cathode (-)",
        direction: "passive",
        signals: ["ground"],
        side: "bottom",
        order: 0,
      },
    ],
    properties: {
      color: {
        label: "Color",
        kind: "color",
        defaultValue: "#ef4444",
      },
      forwardVoltage: {
        label: "Forward voltage",
        kind: "number",
        defaultValue: 2,
        unit: "V",
        min: 1,
        max: 4,
      },
    },
    defaultProperties: { color: "#ef4444", forwardVoltage: 2 },
  },
  "rgb-led": {
    id: "rgb-led",
    displayName: "RGB LED",
    category: "outputs",
    description: "Four-lead, common-cathode RGB LED.",
    width: 92,
    height: 104,
    accent: "#ec4899",
    simulated: true,
    pins: [
      ...["R", "G", "B"].map((id, order) => ({
        id,
        label: id,
        direction: "input" as const,
        signals: ["digital", "pwm"] as const,
        side: "top" as const,
        order,
      })),
      {
        id: "COM",
        label: "Common (-)",
        direction: "power",
        signals: ["ground"],
        side: "bottom",
        order: 0,
      },
    ],
    properties: {},
    defaultProperties: {},
  },
  resistor: {
    id: "resistor",
    displayName: "Resistor",
    category: "passives",
    description: "Current-limiting or pull-up/pull-down resistor.",
    width: 112,
    height: 48,
    accent: "#c08457",
    simulated: true,
    pins: [
      {
        id: "1",
        label: "1",
        direction: "passive",
        signals: ["digital", "analog", "power", "ground"],
        side: "left",
        order: 0,
      },
      {
        id: "2",
        label: "2",
        direction: "passive",
        signals: ["digital", "analog", "power", "ground"],
        side: "right",
        order: 0,
      },
    ],
    properties: {
      resistance: {
        label: "Resistance",
        kind: "number",
        defaultValue: 220,
        unit: "ohm",
        min: 0,
        max: 10_000_000,
      },
    },
    defaultProperties: { resistance: 220 },
  },
  "push-button": {
    id: "push-button",
    displayName: "Push Button",
    category: "inputs",
    description: "Momentary normally-open push button.",
    width: 80,
    height: 64,
    accent: "#64748b",
    simulated: true,
    pins: [
      {
        id: "1",
        label: "1",
        direction: "passive",
        signals: ["digital", "power", "ground"],
        side: "left",
        order: 0,
      },
      {
        id: "2",
        label: "2",
        direction: "passive",
        signals: ["digital", "power", "ground"],
        side: "right",
        order: 0,
      },
    ],
    properties: {
      normallyClosed: {
        label: "Normally closed",
        kind: "boolean",
        defaultValue: false,
      },
    },
    defaultProperties: { normallyClosed: false },
  },
  "toggle-switch": {
    id: "toggle-switch",
    displayName: "Toggle Switch",
    category: "inputs",
    description: "Single-pole, double-throw interactive switch.",
    width: 88,
    height: 72,
    accent: "#64748b",
    simulated: true,
    pins: [
      {
        id: "COM",
        label: "Common",
        direction: "passive",
        signals: ["digital", "power", "ground"],
        side: "left",
        order: 0,
      },
      {
        id: "NO",
        label: "NO",
        direction: "passive",
        signals: ["digital", "power", "ground"],
        side: "right",
        order: 0,
      },
      {
        id: "NC",
        label: "NC",
        direction: "passive",
        signals: ["digital", "power", "ground"],
        side: "right",
        order: 1,
      },
    ],
    properties: {},
    defaultProperties: {},
  },
  potentiometer: {
    id: "potentiometer",
    displayName: "Potentiometer",
    category: "inputs",
    description: "Interactive analog voltage divider.",
    width: 88,
    height: 96,
    accent: "#f59e0b",
    simulated: true,
    pins: [
      {
        id: "VCC",
        label: "VCC",
        direction: "power",
        signals: ["power"],
        side: "top",
        order: 0,
      },
      {
        id: "GND",
        label: "GND",
        direction: "power",
        signals: ["ground"],
        side: "bottom",
        order: 0,
      },
      {
        id: "SIG",
        label: "Wiper",
        direction: "output",
        signals: ["analog"],
        side: "right",
        order: 0,
      },
    ],
    properties: {
      value: {
        label: "Position",
        kind: "number",
        defaultValue: 50,
        unit: "%",
        min: 0,
        max: 100,
      },
      resistance: {
        label: "Resistance",
        kind: "number",
        defaultValue: 10_000,
        unit: "ohm",
        min: 1,
        max: 1_000_000,
      },
    },
    defaultProperties: { value: 50, resistance: 10_000 },
  },
  "seven-segment": {
    id: "seven-segment",
    displayName: "7-Segment Display",
    category: "displays",
    description: "Single-digit common-cathode display with decimal point.",
    width: 116,
    height: 152,
    accent: "#ef4444",
    simulated: true,
    pins: [
      ...["A", "B", "C", "D", "E", "F", "G", "DP"].map(
        (id, order) => ({
          id,
          label: id,
          direction: "input" as const,
          signals: ["digital"] as const,
          side: order < 4 ? ("left" as const) : ("right" as const),
          order: order % 4,
        }),
      ),
      {
        id: "COM",
        label: "Common",
        direction: "power",
        signals: ["ground"],
        side: "bottom",
        order: 0,
      },
    ],
    properties: {
      color: {
        label: "Color",
        kind: "color",
        defaultValue: "#ef4444",
      },
    },
    defaultProperties: { color: "#ef4444" },
  },
  "lcd-16x2": {
    id: "lcd-16x2",
    displayName: "16x2 LCD",
    category: "displays",
    description: "HD44780-compatible 16-column, 2-row character LCD.",
    width: 224,
    height: 112,
    accent: "#2563eb",
    simulated: true,
    pins: [
      ...["VSS", "VDD", "VO", "RS", "RW", "E"].map((id, order) => ({
        id,
        label: id,
        direction:
          id === "VSS" || id === "VDD"
            ? ("power" as const)
            : ("input" as const),
        signals:
          id === "VSS"
            ? (["ground"] as const)
            : id === "VDD"
              ? (["power"] as const)
              : id === "VO"
                ? (["analog"] as const)
                : (["digital"] as const),
        side: "bottom" as const,
        order,
      })),
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `D${index}`,
        label: `D${index}`,
        direction: "bidirectional" as const,
        signals: ["digital"] as const,
        side: "bottom" as const,
        order: index + 6,
      })),
      {
        id: "A",
        label: "Backlight +",
        direction: "power",
        signals: ["power"],
        side: "bottom",
        order: 14,
      },
      {
        id: "K",
        label: "Backlight -",
        direction: "power",
        signals: ["ground"],
        side: "bottom",
        order: 15,
      },
    ],
    properties: {
      text: {
        label: "Initial text",
        kind: "string",
        defaultValue: "",
      },
    },
    defaultProperties: { text: "" },
  },
  buzzer: {
    id: "buzzer",
    displayName: "Piezo Buzzer",
    category: "outputs",
    description: "Tone-capable piezoelectric buzzer.",
    width: 80,
    height: 80,
    accent: "#334155",
    simulated: true,
    pins: [
      {
        id: "+",
        label: "+",
        direction: "input",
        signals: ["digital", "pwm"],
        side: "top",
        order: 0,
      },
      {
        id: "-",
        label: "-",
        direction: "power",
        signals: ["ground"],
        side: "bottom",
        order: 0,
      },
    ],
    properties: {},
    defaultProperties: {},
  },
  servo: {
    id: "servo",
    displayName: "Servo",
    category: "motors",
    description: "Hobby servo controlled by a pulse-width signal.",
    width: 104,
    height: 96,
    accent: "#3b82f6",
    simulated: true,
    pins: [
      {
        id: "VCC",
        label: "VCC",
        direction: "power",
        signals: ["power"],
        side: "left",
        order: 0,
      },
      {
        id: "GND",
        label: "GND",
        direction: "power",
        signals: ["ground"],
        side: "left",
        order: 1,
      },
      {
        id: "SIG",
        label: "Signal",
        direction: "input",
        signals: ["digital", "pwm"],
        side: "left",
        order: 2,
      },
    ],
    properties: {
      angle: {
        label: "Initial angle",
        kind: "number",
        defaultValue: 90,
        unit: "deg",
        min: 0,
        max: 180,
      },
    },
    defaultProperties: { angle: 90 },
  },
  "dc-motor": {
    id: "dc-motor",
    displayName: "DC Motor",
    category: "motors",
    description: "Two-terminal brushed DC motor for use with a driver.",
    width: 88,
    height: 88,
    accent: "#475569",
    simulated: true,
    pins: [
      {
        id: "+",
        label: "+",
        direction: "passive",
        signals: ["power", "pwm"],
        side: "left",
        order: 0,
      },
      {
        id: "-",
        label: "-",
        direction: "passive",
        signals: ["power", "ground", "pwm"],
        side: "right",
        order: 0,
      },
    ],
    properties: {
      rpm: {
        label: "Rated speed",
        kind: "number",
        defaultValue: 6000,
        unit: "RPM",
        min: 0,
        max: 100_000,
      },
    },
    defaultProperties: { rpm: 6000 },
  },
  l293d: {
    id: "l293d",
    displayName: "L293D Motor Driver",
    category: "drivers",
    description: "Dual H-bridge motor driver IC.",
    width: 152,
    height: 208,
    accent: "#334155",
    simulated: true,
    pins: [
      ...[
        "EN1",
        "IN1",
        "OUT1",
        "GND1",
        "GND2",
        "OUT2",
        "IN2",
        "VS",
      ].map((id, order) => ({
        id,
        label: id,
        direction: (id.startsWith("IN") || id.startsWith("EN")
          ? "input"
          : id.startsWith("OUT")
            ? "output"
            : "power") as PinDirection,
        signals: (id.startsWith("GND")
          ? ["ground"]
          : id === "VS"
            ? ["power"]
            : ["digital", "pwm"]) as PinSignal[],
        side: "left" as const,
        order,
      })),
      ...[
        "EN2",
        "IN3",
        "OUT3",
        "GND3",
        "GND4",
        "OUT4",
        "IN4",
        "VSS",
      ].map((id, order) => ({
        id,
        label: id,
        direction: (id.startsWith("IN") || id.startsWith("EN")
          ? "input"
          : id.startsWith("OUT")
            ? "output"
            : "power") as PinDirection,
        signals: (id.startsWith("GND")
          ? ["ground"]
          : id === "VSS"
            ? ["power"]
            : ["digital", "pwm"]) as PinSignal[],
        side: "right" as const,
        order,
      })),
    ],
    properties: {},
    defaultProperties: {},
  },
  "logic-and": binaryGate("logic-and", "AND Gate", "Two-input AND gate."),
  "logic-or": binaryGate("logic-or", "OR Gate", "Two-input OR gate."),
  "logic-xor": binaryGate("logic-xor", "XOR Gate", "Two-input XOR gate."),
  "logic-nand": binaryGate(
    "logic-nand",
    "NAND Gate",
    "Two-input NAND gate.",
  ),
  "logic-nor": binaryGate("logic-nor", "NOR Gate", "Two-input NOR gate."),
  "logic-not": {
    id: "logic-not",
    displayName: "NOT Gate",
    category: "logic",
    description: "Digital inverter.",
    width: 96,
    height: 64,
    accent: "#8b5cf6",
    simulated: true,
    pins: [
      binaryGatePins[0],
      binaryGatePins[2],
      binaryGatePins[3],
      binaryGatePins[4],
    ],
    properties: {},
    defaultProperties: {},
  },
  "hc-sr04": {
    id: "hc-sr04",
    displayName: "HC-SR04",
    category: "sensors",
    description: "Ultrasonic distance sensor module.",
    width: 152,
    height: 80,
    accent: "#06b6d4",
    simulated: true,
    pins: [
      {
        id: "VCC",
        label: "VCC",
        direction: "power",
        signals: ["power"],
        side: "bottom",
        order: 0,
      },
      {
        id: "TRIG",
        label: "TRIG",
        direction: "input",
        signals: ["digital"],
        side: "bottom",
        order: 1,
      },
      {
        id: "ECHO",
        label: "ECHO",
        direction: "output",
        signals: ["digital"],
        side: "bottom",
        order: 2,
      },
      {
        id: "GND",
        label: "GND",
        direction: "power",
        signals: ["ground"],
        side: "bottom",
        order: 3,
      },
    ],
    properties: {
      distanceCm: {
        label: "Distance",
        kind: "number",
        defaultValue: 100,
        unit: "cm",
        min: 2,
        max: 400,
      },
    },
    defaultProperties: { distanceCm: 100 },
  },
  "pir-sensor": {
    id: "pir-sensor",
    displayName: "PIR Motion Sensor",
    category: "sensors",
    description: "Interactive digital passive infrared motion sensor.",
    width: 104,
    height: 88,
    accent: "#06b6d4",
    simulated: true,
    pins: [
      {
        id: "VCC",
        label: "VCC",
        direction: "power",
        signals: ["power"],
        side: "bottom",
        order: 0,
      },
      {
        id: "OUT",
        label: "OUT",
        direction: "output",
        signals: ["digital"],
        side: "bottom",
        order: 1,
      },
      {
        id: "GND",
        label: "GND",
        direction: "power",
        signals: ["ground"],
        side: "bottom",
        order: 2,
      },
    ],
    properties: {
      motion: {
        label: "Motion detected",
        kind: "boolean",
        defaultValue: false,
      },
    },
    defaultProperties: { motion: false },
  },
} satisfies Record<string, ComponentDefinition>;

export type SupportedComponentType = keyof typeof COMPONENT_CATALOG;

export const SUPPORTED_COMPONENT_TYPES = Object.freeze(
  Object.keys(COMPONENT_CATALOG) as SupportedComponentType[],
);

export const COMPONENT_CATEGORIES = Object.freeze([
  "boards",
  "passives",
  "inputs",
  "outputs",
  "displays",
  "motors",
  "logic",
  "sensors",
  "drivers",
] satisfies ComponentCategory[]);

export function isSupportedComponentType(
  type: string,
): type is SupportedComponentType {
  return Object.prototype.hasOwnProperty.call(COMPONENT_CATALOG, type);
}

export function getComponentDefinition(
  type: string,
): ComponentDefinition | undefined {
  return isSupportedComponentType(type) ? COMPONENT_CATALOG[type] : undefined;
}

export function getPinDefinition(
  type: string,
  pin: string,
): ComponentPinDefinition | undefined {
  return getComponentDefinition(type)?.pins.find(
    (definition) => definition.id === pin,
  );
}

export function createDefaultProperties(type: string): ComponentProperties {
  const defaults = getComponentDefinition(type)?.defaultProperties ?? {};
  return { ...defaults };
}
