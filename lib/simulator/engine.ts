import { solveCircuit } from "./circuit-state.ts";
import { DeviceRuntime, type DeviceValue } from "./devices.ts";
import { deviceInstances, splitDeviceArguments, DEVICE_CONSTANTS } from "./device-api.ts";
import type { CircuitProject } from "../circuit/types.ts";
import { COMPONENT_CATALOG } from "../circuit/catalog.ts";
import { createInitialPinStates, parseUnoPinLabel, UNO_PWM_PINS } from "./pins.ts";
import { compileArduinoSketch, evaluateRuntimeExpression } from "./parser.ts";
import type {
  ArduinoSimulatorOptions,
  CompiledArduinoSketch,
  DigitalLevel,
  SerialEntry,
  ServoState,
  LcdState,
  ToneState,
  SimulatedComponentState,
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
  servos: ServoState[],
  lcds: LcdState[],
  tones: ToneState[],
  componentStates: Readonly<Record<string, SimulatedComponentState>>,
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
    servos: Object.freeze(servos.map((item) => Object.freeze({ ...item }))),
    lcds: Object.freeze(lcds.map((item) => Object.freeze({ ...item, lines: Object.freeze([...item.lines]) }))),
    tones: Object.freeze(tones.map((item) => Object.freeze({ ...item }))),
    componentStates: Object.freeze({ ...componentStates }),
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
  private devices?: DeviceRuntime;
  private project?: CircuitProject;
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
  private servos = new Map<string, ServoState>();
  private lcds = new Map<string, LcdState>();
  private tones = new Map<number, ToneState>();
  private componentStates: Readonly<Record<string, SimulatedComponentState>> = {};
  private analogInputs = new Map<number, number>();
  private pulseInputs = new Map<number, number>();
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
      [...this.servos.values()], [...this.lcds.values()], [...this.tones.values()], this.componentStates,
    );
  }

  attachProject(project: CircuitProject) {
    const changed = this.project && JSON.stringify([this.project.components.map(c => [c.id, c.type]), this.project.connections]) !== JSON.stringify([project.components.map(c => [c.id, c.type]), project.connections]);
    this.project = project;
    if (!this.devices) this.devices = new DeviceRuntime(project, this.compiled.source);
    else this.devices.configure(project);
    if (changed) this.reset(); else this.commit();
  }
  injectPacket(componentId: string, payload: string) {
    if (this.status !== "running") return false;
    const delivered = this.devices?.injectPacket(componentId, payload) ?? false; this.commit(); return delivered;
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
    this.servos.clear();
    this.lcds.clear();
    this.tones.clear();
    this.componentStates = {};
    this.devices?.reset(this.compiled.source);
    this.commit();
    return this.snapshot;
  }

  run(): SimulatorSnapshot {
    if (this.project?.components.some(c => !COMPONENT_CATALOG[c.type])) { this.status = "error"; this.commit(); return this.snapshot; }
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
    if (this.project?.components.some(c => !COMPONENT_CATALOG[c.type])) { this.status = "error"; this.commit(); return this.snapshot; }
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
      if (this.waitRemainingMs > 0) {
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
    if (![...this.compiled.setup, ...this.compiled.loop].some(i => i.kind === "delay")) {
      // Library conversions may block even when a sketch contains no delay().
      // Consume that wait on the same clock before evaluating millis-based code.
      const elapsed = Math.min(budget, this.waitRemainingMs);
      this.waitRemainingMs -= elapsed;
      this.timeMs += budget;
      budget = 0;
    }
    let operations = 0;

    while (this.status === "running" && operations < this.maxOperationsPerAdvance) {
      this.normalizeCursor();
      if (this.status !== "running") break;

      if (this.waitRemainingMs > 0) {
        if (budget <= 0) break;
        const elapsed = Math.min(budget, this.waitRemainingMs);
        this.timeMs += elapsed;
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

    this.timeMs += budget;
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

  setAnalogInput(pin: number | string, value: number): SimulatorSnapshot {
    const number = this.resolvePin(pin);
    if (number === undefined) throw new RangeError(`Unknown Arduino Uno pin: ${pin}`);
    this.analogInputs.set(number, Math.round(Math.min(1023, Math.max(0, value))));
    return this.snapshot;
  }

  setPulseInput(pin: number | string, durationMicroseconds: number): SimulatorSnapshot {
    const number = this.resolvePin(pin);
    if (number === undefined) throw new RangeError(`Unknown Arduino Uno pin: ${pin}`);
    this.pulseInputs.set(number, Math.max(0, durationMicroseconds));
    return this.snapshot;
  }

  /** Atomically applies the inputs and derived component state from the circuit solver. */
  applyCircuitState(input: {
    digital?: Readonly<Record<number, DigitalLevel>>;
    analog?: Readonly<Record<number, number>>;
    components?: Readonly<Record<string, SimulatedComponentState>>;
  }): SimulatorSnapshot {
    let changed = false;
    Object.entries(input.digital ?? {}).forEach(([pin, value]) => {
      const number = Number(pin);
      const state = this.pins[number];
      if (!state || state.mode === "OUTPUT") return;
      const next = value === 1 ? 1 : 0;
      if (state.digitalValue !== next) {
        state.digitalValue = next;
        state.pwmValue = next ? 255 : 0;
        state.lastChangedAtMs = this.timeMs;
        changed = true;
      }
    });
    Object.entries(input.analog ?? {}).forEach(([pin, value]) => {
      this.analogInputs.set(Number(pin), Math.round(Math.min(1023, Math.max(0, value))));
    });
    const nextComponents = input.components ?? {};
    if (JSON.stringify(this.componentStates) !== JSON.stringify(nextComponents)) {
      this.componentStates = nextComponents;
      changed = true;
    }
    if (changed) this.commit();
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

  private updateDevices() {
    this.devices?.tick(this.timeMs, this.pins);
    if (!this.project || !this.devices || !this.snapshot) return;
    const solution = solveCircuit(this.project, { ...this.snapshot, pins: this.pins, timeMs: this.timeMs, componentStates: this.devices.states, deviceDrives: this.devices.drives, deviceBridges: this.devices.bridges });
    for (const [number, value] of Object.entries(solution.digitalInputs)) if (this.pins[Number(number)]?.mode !== "OUTPUT") { this.pins[Number(number)].digitalValue = value; this.pins[Number(number)].pwmValue = value * 255; }
    for (const [number, value] of Object.entries(solution.analogInputs)) this.analogInputs.set(Number(number), value);
    this.componentStates = { ...solution.componentStates, ...this.devices.states };
  }
  private execute(instruction: SketchInstruction) {
    this.updateDevices(); this.executeInstruction(instruction);
    if (this.devices?.pendingDelayMs) { this.waitRemainingMs = this.devices.pendingDelayMs; this.devices.pendingDelayMs = 0; }
    this.updateDevices();
  }
  private executeInstruction(instruction: SketchInstruction): void {
    if (instruction.kind === "bufferDeclare") {
      const size = Math.trunc(this.evaluate(instruction.size) ?? 0);
      if (size < 0 || size > 4096 || !this.devices) return;
      this.devices.values.set(instruction.name, Array.from({ length: size }, (_, i) => i < instruction.values.length ? Number(this.deviceValue(instruction.values[i])) & 255 : 0)); return;
    }
    if (instruction.kind === "bufferWrite") {
      const buffer = this.devices?.values.get(instruction.name), index = Math.trunc(this.evaluate(instruction.index) ?? -1);
      if (Array.isArray(buffer) && index >= 0 && index < buffer.length) buffer[index] = Number(this.deviceValue(instruction.expression)) & 255;
      else this.devices?.diagnostics.push({ severity: "error", code: "BUFFER_BOUNDS", line: instruction.line, message: `${instruction.name}[${index}] is outside its declared byte buffer.` });
      return;
    }
    if (instruction.kind === "deviceCall") {
      const args = instruction.args.map(arg => this.deviceValue(arg));
      if (instruction.instance === "__core" && instruction.method === "shiftOut") {
        const [data, clock, order, value] = args.map(Number);
        for (let bit = 0; bit < 8; bit++) {
          const d = this.pins[data], c = this.pins[clock];
          if (!d || !c || d.mode !== "OUTPUT" || c.mode !== "OUTPUT") break;
          d.pwmValue = ((value >> (order ? 7 - bit : bit)) & 1) * 255; d.digitalValue = d.pwmValue ? 1 : 0;
          c.pwmValue = 0; c.digitalValue = 0; this.updateDevices();
          c.pwmValue = 255; c.digitalValue = 1; this.updateDevices();
          c.pwmValue = 0; c.digitalValue = 0; this.updateDevices();
        }
      } else {
        this.devices?.invoke(instruction.instance, instruction.method, args, text => this.deviceValue(text));
        if (this.devices?.pendingDelayMs) { this.waitRemainingMs = this.devices.pendingDelayMs; this.devices.pendingDelayMs = 0; }
      }
      return;
    }
    if (instruction.kind === "serialExpression") {
      const value = this.deviceValue(instruction.expression);
      this.serial.push({ id: this.nextSerialId++, timestampMs: this.timeMs, text: String(value), newline: instruction.newline });
      this.serial = this.serial.slice(-this.maxSerialEntries); return;
    }

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

    if (instruction.kind === "servoAttach" || instruction.kind === "servoWrite") {
      const current = this.servos.get(instruction.instance) ?? { instance: instruction.instance, pin: -1, angle: 90, attached: false };
      const value = this.evaluate(instruction.expression);
      if (value !== undefined) {
        if (instruction.kind === "servoAttach") { current.pin = Math.trunc(value); current.attached = true; }
        else current.angle = Math.round(Math.min(180, Math.max(0, value)));
        this.servos.set(instruction.instance, current);
      }
      return;
    }

    if (instruction.kind === "lcdBegin") {
      const columns = Math.max(1, Math.trunc(this.evaluate(instruction.columns) ?? 16));
      const rows = Math.max(1, Math.trunc(this.evaluate(instruction.rows) ?? 2));
      this.lcds.set(instruction.instance, { instance: instruction.instance, columns, rows, column: 0, row: 0, lines: Array.from({ length: rows }, () => "") });
      return;
    }
    if (instruction.kind === "lcdClear") {
      const lcd = this.lcds.get(instruction.instance);
      if (lcd) { lcd.lines = Array.from({ length: lcd.rows }, () => ""); lcd.column = 0; lcd.row = 0; }
      return;
    }
    if (instruction.kind === "lcdCursor") {
      const lcd = this.lcds.get(instruction.instance);
      if (lcd) { lcd.column = Math.max(0, Math.trunc(this.evaluate(instruction.column) ?? 0)); lcd.row = Math.min(lcd.rows - 1, Math.max(0, Math.trunc(this.evaluate(instruction.row) ?? 0))); }
      return;
    }
    if (instruction.kind === "lcdPrint") {
      const lcd = this.lcds.get(instruction.instance);
      if (lcd) {
        const literal = /^(["'])([\s\S]*)\1$/.exec(instruction.expression.trim());
        const text = literal ? literal[2] : String(this.evaluate(instruction.expression) ?? "");
        const line = (lcd.lines[lcd.row] ?? "").padEnd(lcd.column, " ");
        const lines = [...lcd.lines];
        lines[lcd.row] = (line.slice(0, lcd.column) + text).slice(0, lcd.columns);
        lcd.lines = lines;
        lcd.column = Math.min(lcd.columns, lcd.column + text.length);
        if (instruction.newline) { lcd.row = Math.min(lcd.rows - 1, lcd.row + 1); lcd.column = 0; }
      }
      return;
    }
    if (instruction.kind === "tone") {
      const pin = Math.trunc(this.evaluate(instruction.pinExpression) ?? -1);
      if (pin >= 0) this.tones.set(pin, { pin, active: Boolean(instruction.frequencyExpression), frequency: Math.max(0, this.evaluate(instruction.frequencyExpression ?? "0") ?? 0) });
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

  private deviceValue(text: string): DeviceValue {
    const value = text.trim();
    if (/^"[\s\S]*"$/.test(value)) { try { return JSON.parse(value) as string; } catch { return value.slice(1, -1); } }
    if (/^'.'$/.test(value)) return value.charCodeAt(1);
    if (this.devices?.values.has(value)) return this.devices.values.get(value)!;
    if (value.startsWith("&")) return value;
    if (deviceInstances(this.compiled.source).has(value) || value === "Serial") return value;
    if (/^SPISettings\(/.test(value)) return 0;
    const segments = value.split(".");
    if (segments.length > 1 && this.devices?.values.has(segments[0])) {
      let result: DeviceValue = this.devices.values.get(segments.shift()!)!;
      for (const segment of segments) { if (typeof result !== "object" || Array.isArray(result)) return NaN; result = result[segment]; }
      return result;
    }
    return this.evaluate(value) ?? NaN;
  }
  private evaluate(expression: string): number | undefined {
    const values = new Map(this.variables);
    values.set("LOW", 0);
    values.set("HIGH", 1);
    values.set("false", 0);
    values.set("true", 1);
    values.set("LED_BUILTIN", 13);
    for (let analog = 0; analog < 6; analog += 1) values.set(`A${analog}`, 14 + analog);
    for (const [name, value] of Object.entries(DEVICE_CONSTANTS)) values.set(name, value);
    let expanded = expression.replace(/\b([A-Za-z_]\w*)\.getResponse\(\)/g, "$1__response");
    expanded = expanded.replace(/\bsizeof\s*\(\s*([A-Za-z_]\w*)\s*\)/g, (_text, name: string) => { const buffer = this.devices?.values.get(name); return String(Array.isArray(buffer) ? buffer.length : 1); });
    const callPattern = /([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*\(/g;
    let match: RegExpExecArray | null;
    while ((match = callPattern.exec(expanded))) {
      if (!deviceInstances(this.compiled.source).has(match[1])) continue;
      let depth = 1, end = callPattern.lastIndex; let quote = "";
      for (; end < expanded.length && depth; end++) {
        const char = expanded[end];
        if (quote) { if (char === "\\") end++; else if (char === quote) quote = ""; }
        else if (char === '"' || char === "'") quote = char;
        else if (char === "(") depth++; else if (char === ")") depth--;
      }
      if (depth) return undefined;
      const args = splitDeviceArguments(expanded.slice(callPattern.lastIndex, end - 1)).map(arg => this.deviceValue(arg));
      this.updateDevices();
      const result = this.devices?.invoke(match[1], match[2], args, text => this.deviceValue(text));
      const placeholder = `__deviceResult${values.size}`; values.set(placeholder, Number(result));
      expanded = expanded.slice(0, match.index) + placeholder + expanded.slice(end); callPattern.lastIndex = 0;
    }
    expanded = expanded.replace(/\b([A-Za-z_]\w*)\s*\[([^\]]+)\]/g, (_whole, name: string, index: string) => {
      const buffer = this.devices?.values.get(name), offset = Math.trunc(this.evaluate(index) ?? -1);
      const placeholder = `__bufferResult${values.size}`;
      values.set(placeholder, Array.isArray(buffer) ? buffer[offset] ?? NaN : NaN); return placeholder;
    });
    expanded = expanded.replace(/\b([A-Za-z_]\w*)(\.[A-Za-z_]\w*)+/g, (path: string) => {
      if (!this.devices?.values.has(path.split(".")[0])) return path;
      const placeholder = `__structuredResult${values.size}`; values.set(placeholder, Number(this.deviceValue(path))); return placeholder;
    });
    const normalized = expanded.replace(/\b([A-Za-z_]\w*)\.read\s*\(\s*\)/g, "servoRead_$1()");
    const functions: Record<string, (...args: number[]) => number> = {
      millis: () => this.timeMs,
      isnan: value => Number(Number.isNaN(value)),
      digitalRead: (pin) => this.pins[Math.trunc(pin)]?.digitalValue ?? 0,
      analogRead: (pin) => this.analogInputs.get(Math.trunc(pin)) ?? 0,
      pulseIn: (pin) => this.pulseInputs.get(Math.trunc(pin)) ?? 0,
      map: (value, fromLow, fromHigh, toLow, toHigh) => fromHigh === fromLow ? toLow : (value - fromLow) * (toHigh - toLow) / (fromHigh - fromLow) + toLow,
      constrain: (value, low, high) => Math.min(high, Math.max(low, value)),
      min: (...args) => Math.min(...args),
      max: (...args) => Math.max(...args),
    };
    this.servos.forEach((servo, name) => { functions[`servoRead_${name}`] = () => servo.angle; });
    return evaluateRuntimeExpression(normalized, values, functions);
  }

  private resolvePin(pin: number | string): number | undefined {
    if (typeof pin === "string") return parseUnoPinLabel(pin);
    return Number.isInteger(pin) && pin >= 0 && pin < this.pins.length
      ? pin
      : undefined;
  }

  private commit(): void {
    this.updateDevices();
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
      [...this.servos.values()], [...this.lcds.values()], [...this.tones.values()], this.componentStates,
    );
    if (this.devices) this.snapshot = Object.freeze({ ...this.snapshot, componentStates: Object.freeze({ ...this.snapshot.componentStates, ...this.devices.states }), deviceDrives: this.devices.drives.map(d => ({ ...d })), deviceBridges: this.devices.bridges.map(b => ({ ...b })), diagnostics: [...this.snapshot.diagnostics, ...this.devices.diagnostics, ...(this.project?.components.filter(c => !COMPONENT_CATALOG[c.type]).map(c => ({ severity: "error" as const, code: "component-unavailable", message: `${c.label} has no accepted simulation model. Saved wiring is preserved.` })) ?? [])] });
    for (const listener of this.listeners) listener(this.snapshot);
  }
}
