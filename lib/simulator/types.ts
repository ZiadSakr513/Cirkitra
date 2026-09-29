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
  | (InstructionSource & { kind: "bufferDeclare"; name: string; size: string; values: string[] })
  | (InstructionSource & { kind: "bufferWrite"; name: string; index: string; expression: string })
  | (InstructionSource & { kind: "deviceCall"; instance: string; method: string; args: string[] })
  | (InstructionSource & { kind: "fileOpen"; name: string; path: string; mode: string })
  | (InstructionSource & { kind: "serialExpression"; expression: string; newline: boolean })
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
      kind: "analogWriteExpression";
      pin: number;
      expression: string;
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
  i2cCallbacks?: Readonly<{ onReceive?: ReadonlyArray<SketchInstruction>; onRequest?: ReadonlyArray<SketchInstruction>; receiveParameter?: string }>;
  diagnostics: ReadonlyArray<SimulatorDiagnostic>;
  valid: boolean;
}

export interface BoardPinState {
  /** Arduino-compatible runtime pin number for the selected board profile. */
  number: number;
  /** Physical header label or board GPIO name. */
  label: string;
  mode: UnoPinMode;
  digitalValue: DigitalLevel;
  /** Last PWM duty written with analogWrite(), in the range 0-255. */
  pwmValue: number;
  lastChangedAtMs: number;
}
/** Backwards-compatible name for projects and tests that target the Uno. */
export type UnoPinState = BoardPinState;

export interface SerialEntry {
  id: number;
  timestampMs: number;
  text: string;
  newline: boolean;
}

export interface ServoState { instance: string; pin: number; angle: number; attached: boolean; boardId?: string; boardComponentId?: string; }
export interface LcdState { instance: string; columns: number; rows: number; column: number; row: number; lines: ReadonlyArray<string>; }
export interface ToneState { pin: number; active: boolean; frequency: number; boardId?: string; boardComponentId?: string; }

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
  readings?: Readonly<Record<string, number>>;
  status?: string;
  fault?: string;
  packets?: readonly { timeMs: number; direction: "tx" | "rx"; payload: string; status: string }[];
  display?: readonly string[];
  pixels?: readonly { r: number; g: number; b: number }[];
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
  primaryBoardId?: string;
  primaryBoardType?: string;
  /** Independent GPIO state for each placed board. `pins` remains the v1 primary-board alias. */
  boardPins?: Readonly<Record<string, ReadonlyArray<BoardPinState>>>;
  /** Full per-controller state for mixed-board projects. Child snapshots never contain this field. */
  boardSnapshots?: Readonly<Record<string, SimulatorSnapshot>>;
  /** Per-board solved input maps; the flat fields remain for v1 callers. */
  boardDigitalInputs?: Readonly<Record<string, Readonly<Record<number, 0 | 1>>>>;
  boardAnalogInputs?: Readonly<Record<string, Readonly<Record<number, number>>>>;
  serial: ReadonlyArray<SerialEntry>;
  /** Serial output kept separately for each placed board in mixed-board runs. */
  boardSerial?: Readonly<Record<string, ReadonlyArray<SerialEntry>>>;
  servos: ReadonlyArray<ServoState>;
  lcds: ReadonlyArray<LcdState>;
  tones: ReadonlyArray<ToneState>;
  componentStates: Readonly<Record<string, SimulatedComponentState>>;
  diagnostics: ReadonlyArray<SimulatorDiagnostic>;
  deviceDrives?: readonly { componentId: string; pin: string; value: number; weak?: boolean }[];
  deviceBridges?: readonly { componentId: string; from: string; to: string }[];
}

export interface ArduinoSimulatorOptions {
  /** Stable board profile id; defaults to the Uno for legacy callers. */
  boardId?: string;
  /** Optional placed-board id for mixed-board schematics. */
  boardComponentId?: string;
  /** Virtual milliseconds per real millisecond. Defaults to 1. */
  speed?: number;
  /** Protects the UI from sketches with infinite zero-delay loops. */
  maxOperationsPerAdvance?: number;
  /** Old serial entries are discarded after this limit. Defaults to 500. */
  maxSerialEntries?: number;
}

export type SimulatorListener = (snapshot: SimulatorSnapshot) => void;
