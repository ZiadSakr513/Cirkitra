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
    })
  | (InstructionSource & {
      kind: "servoAttach";
      instance: string;
      expression: string;
    })
  | (InstructionSource & {
      kind: "servoWrite";
      instance: string;
      expression: string;
    })
  | (InstructionSource & {
      kind: "lcdBegin";
      instance: string;
      columns: string;
      rows: string;
    })
  | (InstructionSource & {
      kind: "lcdClear";
      instance: string;
    })
  | (InstructionSource & {
      kind: "lcdCursor";
      instance: string;
      column: string;
      row: string;
    })
  | (InstructionSource & {
      kind: "lcdPrint";
      instance: string;
      expression: string;
      newline: boolean;
    })
  | (InstructionSource & {
      kind: "tone";
      pinExpression: string;
      frequencyExpression?: string;
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

export interface ServoState { instance: string; pin: number; angle: number; attached: boolean; }
export interface LcdState { instance: string; columns: number; rows: number; column: number; row: number; lines: ReadonlyArray<string>; }
export interface ToneState { pin: number; active: boolean; frequency: number; }

export type ElectricalLevel = "low" | "high" | "floating" | "conflict";
export interface SimulatedComponentState {
  type: string;
  powered: boolean;
  level?: ElectricalLevel;
  analogValue?: number;
  channels?: Readonly<Record<string, number>>;
  segments?: ReadonlyArray<string>;
  direction?: "forward" | "reverse" | "stopped" | "brake" | "coast";
  speed?: number;
  position?: boolean;
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
  servos: ReadonlyArray<ServoState>;
  lcds: ReadonlyArray<LcdState>;
  tones: ReadonlyArray<ToneState>;
  componentStates: Readonly<Record<string, SimulatedComponentState>>;
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
