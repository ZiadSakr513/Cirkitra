import { createInitialPinStates, parseUnoPinLabel, UNO_PWM_PINS } from "./pins.ts";
import { compileArduinoSketch, evaluateRuntimeExpression } from "./parser.ts";
import type {
  ArduinoSimulatorOptions,
  CompiledArduinoSketch,
  DigitalLevel,
  SerialEntry,
  SimulatorListener,
  SimulatorPhase,
  SimulatorSnapshot,
  SimulatorStatus,
  SketchInstruction,
  UnoPinState,
} from "./types.ts";

const DEFAULT_MAX_OPERATIONS = 1_000;
const DEFAULT_MAX_SERIAL_ENTRIES = 500;
const MIN_SPEED = 0.05;
const MAX_SPEED = 100;

function positiveInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}

function validSpeed(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value >= MIN_SPEED && value <= MAX_SPEED
    ? value
    : 1;
}

function freezeSnapshot(
  status: SimulatorStatus,
  phase: SimulatorPhase,
  timeMs: number,
  speed: number,
  programCounter: number,
  loopCount: number,
  waitRemainingMs: number,
  pins: UnoPinState[],
  serial: SerialEntry[],
  compiled: CompiledArduinoSketch,
): SimulatorSnapshot {
  const pinSnapshot = Object.freeze(
    pins.map((pin) => Object.freeze({ ...pin })),
  );
  const serialSnapshot = Object.freeze(
    serial.map((entry) => Object.freeze({ ...entry })),
  );
  const diagnosticSnapshot = Object.freeze(
    compiled.diagnostics.map((diagnostic) => Object.freeze({ ...diagnostic })),
  );

  return Object.freeze({
    status,
    phase,
    timeMs,
    speed,
    programCounter,
    loopCount,
    waitRemainingMs,
    pins: pinSnapshot,
    serial: serialSnapshot,
    diagnostics: diagnosticSnapshot,
  });
}

/**
 * A deterministic interpreter for the Arduino subset emitted by
 * compileArduinoSketch(). It does not own a timer: a browser UI drives it with
 * requestAnimationFrame by calling advance(realDeltaMs), which makes tests and
 * pause/resume behavior repeatable.
 */
export class ArduinoSimulator {
  private compiled: CompiledArduinoSketch;
  private status: SimulatorStatus = "idle";
  private phase: SimulatorPhase = "setup";
  private timeMs = 0;
  private speed: number;
  private programCounter = 0;
  private loopCount = 0;
  private waitRemainingMs = 0;
  private pins: UnoPinState[] = createInitialPinStates();
  private serial: SerialEntry[] = [];
  private variables = new Map<string, number>();
  private nextSerialId = 1;
  private readonly maxOperationsPerAdvance: number;
  private readonly maxSerialEntries: number;
  private readonly listeners = new Set<SimulatorListener>();
  private snapshot: SimulatorSnapshot;

  constructor(source = "", options: ArduinoSimulatorOptions = {}) {
    this.speed = validSpeed(options.speed);
    this.maxOperationsPerAdvance = positiveInteger(
      options.maxOperationsPerAdvance,
      DEFAULT_MAX_OPERATIONS,
    );
    this.maxSerialEntries = positiveInteger(
      options.maxSerialEntries,
      DEFAULT_MAX_SERIAL_ENTRIES,
    );
    this.compiled = compileArduinoSketch(source);
    this.variables = new Map(Object.entries(this.compiled.globals));
    this.status = this.compiled.valid ? "idle" : "error";
    this.snapshot = freezeSnapshot(
      this.status,
      this.phase,
      this.timeMs,
      this.speed,
      this.programCounter,
      this.loopCount,
      this.waitRemainingMs,
      this.pins,
      this.serial,
      this.compiled,
    );
  }

  getSnapshot = (): SimulatorSnapshot => this.snapshot;

  getCompiledSketch(): CompiledArduinoSketch {
    return this.compiled;
  }

  getSource(): string {
    return this.compiled.source;
  }

  getPinState(pin: number | string): UnoPinState | undefined {
    const number = this.resolvePin(pin);
    const state = number === undefined ? undefined : this.pins[number];
    return state ? { ...state } : undefined;
  }

  subscribe(listener: SimulatorListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  load(source: string): SimulatorSnapshot {
    this.compiled = compileArduinoSketch(source);
    return this.reset();
  }

  reset(): SimulatorSnapshot {
    this.status = this.compiled.valid ? "idle" : "error";
    this.phase = "setup";
    this.timeMs = 0;
    this.programCounter = 0;
    this.loopCount = 0;
    this.waitRemainingMs = 0;
    this.pins = createInitialPinStates();
    this.serial = [];
    this.variables = new Map(Object.entries(this.compiled.globals));
    this.nextSerialId = 1;
    this.commit();
    return this.snapshot;
  }

  run(): SimulatorSnapshot {
    if (this.status !== "error" && this.status !== "completed") {
      this.status = "running";
      this.commit();
    }
    return this.snapshot;
  }

  pause(): SimulatorSnapshot {
    if (this.status === "running") {
      this.status = "paused";
      this.commit();
    }
    return this.snapshot;
  }

  setSpeed(speed: number): SimulatorSnapshot {
    if (!Number.isFinite(speed) || speed < MIN_SPEED || speed > MAX_SPEED) {
      throw new RangeError(`Simulation speed must be between ${MIN_SPEED} and ${MAX_SPEED}.`);
    }
    this.speed = speed;
    this.commit();
    return this.snapshot;
  }

  /**
   * Executes one source-level instruction while paused. A delay instruction
   * advances the virtual clock by its complete duration in the same step.
   */
  step(): SimulatorSnapshot {
    if (this.status === "error" || this.status === "completed") {
      return this.snapshot;
    }

    this.status = "paused";
    if (this.waitRemainingMs > 0) {
      this.timeMs += this.waitRemainingMs;
      this.waitRemainingMs = 0;
      this.commit();
      return this.snapshot;
    }

    this.normalizeCursor();
    if (this.phase === "complete") {
      this.commit();
      return this.snapshot;
    }

    const instruction = this.currentInstruction();
    if (instruction) {
      this.execute(instruction);
      this.programCounter += 1;
      if (instruction.kind === "delay") {
        this.timeMs += this.waitRemainingMs;
        this.waitRemainingMs = 0;
      }
      this.normalizeCursor();
    }

    this.commit();
    return this.snapshot;
  }

  /**
   * Advances a running sketch by real elapsed time. The configured speed turns
   * that duration into virtual Arduino milliseconds. Calling advance(0) is a
   * useful way to execute setup and other zero-time calls up to the first delay.
   */
  advance(realDeltaMs: number): SimulatorSnapshot {
    if (!Number.isFinite(realDeltaMs) || realDeltaMs < 0) {
      throw new RangeError("advance() requires a finite, non-negative duration.");
    }
    if (this.status !== "running") return this.snapshot;

    let budget = realDeltaMs * this.speed;
    this.timeMs += budget;
    let operations = 0;

    while (this.status === "running" && operations < this.maxOperationsPerAdvance) {
      this.normalizeCursor();
      if (this.status !== "running") break;

      if (this.waitRemainingMs > 0) {
        if (budget <= 0) break;
        const elapsed = Math.min(budget, this.waitRemainingMs);
        this.waitRemainingMs -= elapsed;
        budget -= elapsed;
        if (this.waitRemainingMs > 0) break;
        continue;
      }

      const instruction = this.currentInstruction();
      if (!instruction) break;
      this.execute(instruction);
      this.programCounter += 1;
      operations += 1;
    }

    this.commit();
    return this.snapshot;
  }

  /** Sets an externally-driven Uno input, such as a pushbutton or digital sensor. */
  setDigitalInput(
    pin: number | string,
    value: DigitalLevel | boolean,
  ): SimulatorSnapshot {
    const number = this.resolvePin(pin);
    if (number === undefined) {
      throw new RangeError(`Unknown Arduino Uno pin: ${pin}`);
    }

    const state = this.pins[number];
    const digitalValue: DigitalLevel = value === true || value === 1 ? 1 : 0;
    if (state.digitalValue !== digitalValue) {
      state.digitalValue = digitalValue;
      state.pwmValue = digitalValue === 1 ? 255 : 0;
      state.lastChangedAtMs = this.timeMs;
      this.commit();
    }
    return this.snapshot;
  }

  clearSerial(): SimulatorSnapshot {
    if (this.serial.length > 0) {
      this.serial = [];
      this.commit();
    }
    return this.snapshot;
  }

  private currentInstruction(): SketchInstruction | undefined {
    if (this.phase === "setup") {
      return this.compiled.setup[this.programCounter];
    }
    if (this.phase === "loop") {
      return this.compiled.loop[this.programCounter];
    }
    return undefined;
  }

  private normalizeCursor(): void {
    if (this.phase === "setup" && this.programCounter >= this.compiled.setup.length) {
      this.phase = "loop";
      this.programCounter = 0;
    }

    if (this.phase !== "loop") return;
    if (this.compiled.loop.length === 0) {
      this.phase = "complete";
      this.programCounter = 0;
      this.status = "completed";
      return;
    }

    if (this.programCounter >= this.compiled.loop.length) {
      this.loopCount += 1;
      this.programCounter = 0;
    }
  }

  private execute(instruction: SketchInstruction): void {
    if (instruction.kind === "jump") {
      this.programCounter = instruction.target - 1;
      return;
    }

    if (instruction.kind === "jumpIfFalse") {
      const value = this.evaluate(instruction.expression);
      if (!value) this.programCounter = instruction.target - 1;
      return;
    }

    if (instruction.kind === "declare" || instruction.kind === "assign") {
      const value = this.evaluate(instruction.expression);
      if (value !== undefined) this.variables.set(instruction.name, value);
      return;
    }

    if (instruction.kind === "delay") {
      this.waitRemainingMs = instruction.durationMs;
      return;
    }

    if (instruction.kind === "serialPrint") {
      this.serial.push({
        id: this.nextSerialId,
        timestampMs: this.timeMs,
        text: instruction.value,
        newline: instruction.newline,
      });
      this.nextSerialId += 1;
      if (this.serial.length > this.maxSerialEntries) {
        this.serial.splice(0, this.serial.length - this.maxSerialEntries);
      }
      return;
    }

    const pin = this.pins[instruction.pin];
    if (instruction.kind === "pinMode") {
      const nextDigital: DigitalLevel = instruction.mode === "INPUT_PULLUP" ? 1 : 0;
      const changed =
        pin.mode !== instruction.mode ||
        (instruction.mode !== "OUTPUT" && pin.digitalValue !== nextDigital) ||
        (instruction.mode !== "OUTPUT" && pin.pwmValue !== 0);
      pin.mode = instruction.mode;
      if (instruction.mode !== "OUTPUT") {
        pin.digitalValue = nextDigital;
        pin.pwmValue = 0;
      }
      if (changed) pin.lastChangedAtMs = this.timeMs;
      return;
    }

    if (instruction.kind === "digitalWrite" || instruction.kind === "digitalWriteExpression") {
      const rawValue = instruction.kind === "digitalWrite" ? instruction.value : this.evaluate(instruction.expression);
      const value: DigitalLevel = rawValue && rawValue !== 0 ? 1 : 0;
      const changed =
        pin.digitalValue !== value ||
        pin.pwmValue !== (value === 1 ? 255 : 0);
      pin.digitalValue = value;
      pin.pwmValue = value === 1 ? 255 : 0;
      if (changed) pin.lastChangedAtMs = this.timeMs;
      return;
    }

    const digitalValue: DigitalLevel = UNO_PWM_PINS.has(instruction.pin)
      ? instruction.value > 0
        ? 1
        : 0
      : instruction.value >= 128
        ? 1
        : 0;
    const changed =
      pin.digitalValue !== digitalValue || pin.pwmValue !== instruction.value;
    pin.digitalValue = digitalValue;
    pin.pwmValue = instruction.value;
    if (changed) pin.lastChangedAtMs = this.timeMs;
  }

  private evaluate(expression: string): number | undefined {
    const values = new Map(this.variables);
    values.set("LOW", 0);
    values.set("HIGH", 1);
    values.set("false", 0);
    values.set("true", 1);
    values.set("LED_BUILTIN", 13);
    for (let analog = 0; analog < 6; analog += 1) values.set(`A${analog}`, 14 + analog);
    return evaluateRuntimeExpression(expression, values, {
      millis: () => this.timeMs,
      digitalRead: (pin) => this.pins[Math.trunc(pin)]?.digitalValue ?? 0,
    });
  }

  private resolvePin(pin: number | string): number | undefined {
    if (typeof pin === "string") return parseUnoPinLabel(pin);
    return Number.isInteger(pin) && pin >= 0 && pin < this.pins.length
      ? pin
      : undefined;
  }

  private commit(): void {
    this.snapshot = freezeSnapshot(
      this.status,
      this.phase,
      this.timeMs,
      this.speed,
      this.programCounter,
      this.loopCount,
      this.waitRemainingMs,
      this.pins,
      this.serial,
      this.compiled,
    );
    for (const listener of this.listeners) listener(this.snapshot);
  }
}
