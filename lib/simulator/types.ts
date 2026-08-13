export const UNO_DIGITAL_PIN_COUNT = 14;
export const UNO_ANALOG_PIN_COUNT = 6;
export const UNO_PIN_COUNT = UNO_DIGITAL_PIN_COUNT + UNO_ANALOG_PIN_COUNT;

export type DigitalLevel = 0 | 1;

export type UnoPinMode = "INPUT" | "OUTPUT" | "INPUT_PULLUP";

export type SimulatorStatus =
  | "idle"
  | "running"
  | "paused"
  | "completed"
  | "error";

export type SimulatorPhase = "setup" | "loop" | "complete";

export type DiagnosticSeverity = "warning" | "error";

export interface SimulatorDiagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  line?: number;
  column?: number;
}

interface InstructionSource {
  /** One-based line in the original sketch. */
  line: number;
  /** The source statement, trimmed for diagnostics and UI display. */
  source: string;
}

export type SketchInstruction =
  | (InstructionSource & {
      kind: "pinMode";
      pin: number;
      mode: UnoPinMode;
    })
  | (InstructionSource & {
      kind: "digitalWrite";
      pin: number;
      value: DigitalLevel;
    })
  | (InstructionSource & {
      kind: "digitalWriteExpression";
      pin: number;
      expression: string;
    })
  | (InstructionSource & {
      kind: "analogWrite";
      pin: number;
      value: number;
    })
  | (InstructionSource & {
      kind: "delay";
      durationMs: number;
    })
  | (InstructionSource & {
      kind: "serialPrint";
      value: string;
      newline: boolean;
    })
  | (InstructionSource & {
      kind: "declare";
      name: string;
      expression: string;
    })
  | (InstructionSource & {
      kind: "assign";
      name: string;
      expression: string;
    })
  | (InstructionSource & {
      kind: "jumpIfFalse";
      expression: string;
      target: number;
    })
  | (InstructionSource & {
      kind: "jump";
      target: number;
    });

export interface CompiledArduinoSketch {
  source: string;
  setup: ReadonlyArray<SketchInstruction>;
  loop: ReadonlyArray<SketchInstruction>;
  globals: Readonly<Record<string, number>>;
  diagnostics: ReadonlyArray<SimulatorDiagnostic>;
  valid: boolean;
}

export interface UnoPinState {
  /** Arduino's numeric pin value: D0-D13 are 0-13 and A0-A5 are 14-19. */
  number: number;
  /** Human-readable Uno label, for example D13 or A0. */
  label: string;
  mode: UnoPinMode;
  digitalValue: DigitalLevel;
  /** Last PWM duty written with analogWrite(), in the range 0-255. */
  pwmValue: number;
  lastChangedAtMs: number;
}

export interface SerialEntry {
  id: number;
  timestampMs: number;
  text: string;
  newline: boolean;
}

export interface SimulatorSnapshot {
  status: SimulatorStatus;
  phase: SimulatorPhase;
  timeMs: number;
  speed: number;
  programCounter: number;
  loopCount: number;
  waitRemainingMs: number;
  pins: ReadonlyArray<UnoPinState>;
  serial: ReadonlyArray<SerialEntry>;
  diagnostics: ReadonlyArray<SimulatorDiagnostic>;
}

export interface ArduinoSimulatorOptions {
  /** Virtual milliseconds per real millisecond. Defaults to 1. */
  speed?: number;
  /** Protects the UI from sketches with infinite zero-delay loops. */
  maxOperationsPerAdvance?: number;
  /** Old serial entries are discarded after this limit. Defaults to 500. */
  maxSerialEntries?: number;
}

export type SimulatorListener = (snapshot: SimulatorSnapshot) => void;
