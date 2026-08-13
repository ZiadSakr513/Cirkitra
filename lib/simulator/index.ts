export { ArduinoSimulator } from "./engine.ts";
export { compileArduinoSketch } from "./parser.ts";
export {
  isBuzzerCircuitPowered,
  isLedCircuitPowered,
  resolveBuzzerCircuitBindings,
  resolveComponentBoardPins,
  resolveComponentIoPins,
  resolveLedCircuitBindings,
  solveCircuit,
} from "./circuit-state.ts";
export type { BuzzerCircuitBinding, CircuitSolution, LedCircuitBinding } from "./circuit-state.ts";
export {
  createInitialPinStates,
  isUnoPin,
  parseUnoPinLabel,
  UNO_PWM_PINS,
  unoPinLabel,
} from "./pins.ts";
export {
  UNO_ANALOG_PIN_COUNT,
  UNO_DIGITAL_PIN_COUNT,
  UNO_PIN_COUNT,
} from "./types.ts";
export type {
  ArduinoSimulatorOptions,
  CompiledArduinoSketch,
  DiagnosticSeverity,
  DigitalLevel,
  SerialEntry,
  SimulatorDiagnostic,
  SimulatorListener,
  SimulatorPhase,
  SimulatorSnapshot,
  SimulatorStatus,
  SimulatedComponentState,
  SketchInstruction,
  UnoPinMode,
  UnoPinState,
} from "./types.ts";
