export { ArduinoSimulator } from "./engine.ts";
export { MultiBoardSimulator } from "./multi-board.ts";
export { compileArduinoSketch } from "./parser.ts";
export { renderProgramExpression, renderSketchProgram, sketchProgramSchema, validateSketchProgram } from "./program.ts";
export type { ProgramExpression, ProgramSimpleStatement, ProgramStatement, SketchProgram, SketchProgramValidation, ValidatedSketchProgram } from "./program.ts";
export { SIMULATOR_CAPABILITY_REGISTRY } from "./capabilities.ts";
export {
  isBuzzerActive,
  isBuzzerCircuitPowered,
  isUninitializedMotorControlWarning,
  isLedCircuitPowered,
  resolveBuzzerCircuitBindings,
  resolveComponentBoardPins,
  resolveComponentBoardPinEndpoints,
  resolveComponentIoPins,
  resolveLedCircuitBindings,
  solveCircuit,
} from "./circuit-state.ts";
export type { BuzzerCircuitBinding, CircuitSolution, LedCircuitBinding, ResolvedBoardPin } from "./circuit-state.ts";
export {
  createInitialPinStates,
  parseBoardPinLabel,
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
  BoardPinState,
} from "./types.ts";
