import { getBoardProfile, isBoardType } from "../lib/circuit/boards.ts";
import { getBoardProgram } from "../lib/circuit/board-programs.ts";
import { COMPONENT_CATALOG } from "../lib/circuit/catalog.ts";
import type { CircuitProject } from "../lib/circuit/types.ts";
import { ArduinoSimulator } from "../lib/simulator/engine.ts";
import { MultiBoardSimulator } from "../lib/simulator/multi-board.ts";
import { compileArduinoSketch } from "../lib/simulator/parser.ts";
import type { SimulatorSnapshot } from "../lib/simulator/types.ts";
import { hasForwardAndReverseStepperMotion, hasOppositeSignedStepperMotion, hasVisiblePixelsAcrossSnapshots, verifyRequiredNets } from "./ai-generation-stress-assertions.ts";
import type { CatalogReliabilityCase } from "./ai-generation-catalog-30-cases.ts";

export type SimulationRun = {
  input: "low" | "high";
  snapshots: readonly SimulatorSnapshot[];
};

/** Run each generated sketch on its declared board(s), under repeatable low/high inputs. */
export function simulateCatalogProject(project: CircuitProject, snapshotIntervalMs = 750): SimulationRun[] {
  const intervalMs = Number.isFinite(snapshotIntervalMs) && snapshotIntervalMs > 0
    ? Math.min(1_000, Math.max(10, Math.floor(snapshotIntervalMs)))
    : 1_000;
  const sampleRuntime = (advance: (milliseconds: number) => SimulatorSnapshot) => {
    const snapshots = [advance(0)];
    for (let timeMs = intervalMs; timeMs <= 10_000; timeMs += intervalMs) snapshots.push(advance(intervalMs));
    return snapshots;
  };
  const boards = project.components.filter(component => isBoardType(component.type));
  if (!boards.length) return [];
  return (["low", "high"] as const).map(input => {
    const variant = withDeterministicInputs(project, input);
    let snapshots: SimulatorSnapshot[];
    if (boards.length > 1) {
      const simulator = new MultiBoardSimulator();
      simulator.attachProject(variant);
      simulator.run();
      snapshots = sampleRuntime(milliseconds => simulator.advance(milliseconds));
    } else {
      const board = boards[0]!;
      const simulator = new ArduinoSimulator(getBoardProgram(variant, board.id), { boardId: board.type, boardComponentId: board.id });
      simulator.attachProject(variant);
      simulator.run();
      snapshots = sampleRuntime(milliseconds => simulator.advance(milliseconds));
    }
    return { input, snapshots };
  });
}

/** Independent assertions over the route's success response, wiring, code and observed runtime behavior. */
export function verifyCatalogGeneration(
  project: CircuitProject,
  testCase: CatalogReliabilityCase,
  runs: readonly SimulationRun[],
): string[] {
  const issues: string[] = [];
  const observedTypes = new Set(project.components.map(component => component.type));
  const missingTypes = testCase.expectedComponentTypes.filter(type => !observedTypes.has(type));
  if (missingTypes.length) issues.push(`Missing required component type(s): ${missingTypes.join(", ")}.`);

  const observedBoards = new Set(project.components.filter(component => isBoardType(component.type)).map(component => component.type));
  const missingBoards = testCase.expectedBoardTypes.filter(type => !observedBoards.has(type));
  if (missingBoards.length) issues.push(`Missing required board profile(s): ${missingBoards.join(", ")}.`);

  const netIssue = verifyRequiredNets(project, testCase.requiredNets);
  if (netIssue) issues.push(netIssue);

  const boardSources = project.components.filter(component => isBoardType(component.type)).map(board => ({ board, source: getBoardProgram(project, board.id) }));
  for (const { board, source } of boardSources) {
    const compilation = compileArduinoSketch(source, board.type);
    const errors = compilation.diagnostics.filter(diagnostic => diagnostic.severity === "error");
    if (!compilation.valid || errors.length) issues.push(`${board.label} sketch does not compile in the simulator: ${errors.map(error => error.message).slice(0, 3).join("; ") || "invalid sketch"}.`);
  }
  const source = boardSources.map(({ source }) => source).join("\n");
  const missingPatterns = testCase.behavior.requiredSketchPatterns.filter(pattern => !new RegExp(pattern, "i").test(source));
  if (missingPatterns.length) issues.push(`Sketch is missing requested behavior pattern(s): ${missingPatterns.join(", ")}.`);

  const snapshots = runs.flatMap(run => run.snapshots);
  const runtimeErrors = [...new Map(snapshots.flatMap(snapshot => snapshot.diagnostics)
    .filter(diagnostic => diagnostic.severity === "error")
    .map(diagnostic => [`${diagnostic.code}:${diagnostic.message}`, diagnostic])).values()];
  if (runtimeErrors.length) issues.push(`Simulation reported error(s): ${runtimeErrors.slice(0, 4).map(error => `${error.code}: ${error.message}`).join("; ")}.`);
  issues.push(...verifyBehaviorEvidence(project, testCase, runs));
  return issues;
}

export function verifyBehaviorEvidence(
  project: CircuitProject,
  testCase: Pick<CatalogReliabilityCase, "id" | "behavior">,
  runs: readonly SimulationRun[],
): string[] {
  const evidence = testCase.behavior.evidence;
  const snapshots = runs.flatMap(run => run.snapshots);
  const components = new Map(project.components.map(component => [component.id, component]));
  const states = snapshots.flatMap(snapshot => Object.entries(snapshot.componentStates).map(([id, state]) => ({ id, type: components.get(id)?.type ?? state.type, state })));
  const issue = (message: string) => [`${testCase.id}: ${message}`];

  if (evidence === "serial") {
    const hasSerial = snapshots.some(snapshot => snapshot.serial.some(entry => entry.text.trim())
      || Object.values(snapshot.boardSerial ?? {}).some(entries => entries.some(entry => entry.text.trim())));
    return hasSerial ? [] : issue("simulation produced no serial output.");
  }
  if (evidence === "display") {
    const hasRenderedText = snapshots.some(snapshot => snapshot.lcds.some(display => display.lines.some(line => line.trim()))
      || Object.values(snapshot.componentStates).some(state => state.display?.some(line => line.trim())
        || (typeof state.readings?.value === "number" && state.status === "Displaying")));
    return hasRenderedText ? [] : issue("simulation produced no visible text or numeric display output.");
  }
  if (evidence === "pixels") {
    return hasVisiblePixelsAcrossSnapshots(snapshots) ? [] : issue("no addressable LED pixel became visibly lit in simulation.");
  }
  if (evidence === "matrix") {
    const visible = states.some(({ state }) => (state.readings?.litPixels ?? 0) > 0 || state.display?.some(row => row.includes("#")));
    return visible ? [] : issue("the matrix remained blank in simulation.");
  }
  if (evidence === "matrix-and-spi-display") {
    const matrixVisible = states.some(({ type, state }) => type === "max7219-8x8-matrix"
      && ((state.readings?.litPixels ?? 0) > 0 || state.display?.some(row => row.includes("#"))));
    const spiDisplayActive = states.some(({ type, state }) => type === "st7735s-tft-1-8"
      && (state.status === "Displaying" || Number(state.readings?.spiBytes) > 0));
    return matrixVisible && spiDisplayActive ? [] : issue(`expected both a lit MAX7219 matrix and active TFT; observed matrix=${matrixVisible}, TFT=${spiDisplayActive}.`);
  }
  if (evidence === "stepper-indexer") {
    const motor = project.components.find(component => ["bipolar-stepper-motor", "nema17-stepper-17hs4401s", "stepper-28byj-48"].includes(component.type));
    return motor && hasForwardAndReverseStepperMotion(snapshots, motor.id)
      ? []
      : issue("stepper did not show nonzero forward and reverse motion in the sampled simulation.");
  }
  if (evidence === "joystick-stepper") {
    const motor = project.components.find(component => ["bipolar-stepper-motor", "nema17-stepper-17hs4401s", "stepper-28byj-48"].includes(component.type));
    const steps = motor ? runs.map(run => Number(run.snapshots.at(-1)?.componentStates[motor.id]?.readings?.steps)) : [];
    return motor && hasOppositeSignedStepperMotion(steps[0] ?? NaN, steps[1] ?? NaN)
      ? []
      : issue(`joystick extremes did not produce opposite signed stepper motion (samples: ${steps.join(", ") || "none"}).`);
  }
  if (evidence === "servo") {
    const angles = snapshots.flatMap(snapshot => snapshot.servos.filter(servo => servo.attached).map(servo => servo.angle));
    return angles.length && new Set(angles).size > 1
      ? []
      : issue(`servo did not respond to deterministic control changes (observed angles: ${[...new Set(angles)].join(", ") || "none"}).`);
  }
  if (evidence === "motor") {
    const speeds = states.filter(({ type }) => type === "dc-motor").map(({ state }) => Number(state.speed ?? 0));
    return speeds.some(speed => speed > 0.01) && new Set(speeds).size > 1
      ? []
      : issue(`motor did not show a powered speed change across deterministic inputs (observed speeds: ${[...new Set(speeds)].join(", ") || "none"}).`);
  }
  if (evidence === "tone") {
    return snapshots.some(snapshot => snapshot.tones.some(tone => tone.active)) ? [] : issue("no requested tone was audible in any deterministic simulation sample.");
  }
  if (evidence === "range-buzzer") {
    const hasDistanceDisplay = snapshots.some(snapshot => snapshot.lcds.some(display => display.lines.some(line => line.trim()))
      || Object.values(snapshot.componentStates).some(state => state.display?.some(line => line.trim())
        || (typeof state.readings?.value === "number" && state.status === "Displaying")));
    const buzzer = project.components.find(component => component.type === "buzzer");
    const nearRun = runs.find(run => run.input === "low");
    const farRun = runs.find(run => run.input === "high");
    const wiredTonePins = new Set(project.connections.flatMap(connection => {
      const positive = connection.from.componentId === buzzer?.id && connection.from.pin === "+" ? connection.to
        : connection.to.componentId === buzzer?.id && connection.to.pin === "+" ? connection.from : undefined;
      if (!positive) return [];
      const board = project.components.find(component => component.id === positive.componentId && isBoardType(component.type));
      if (!board) return [];
      const boardPin = getBoardProfile(board.type)?.ioPins.find(pin => pin.id === positive.pin || pin.label === positive.pin || pin.aliases?.includes(positive.pin));
      return boardPin ? [boardPin.runtimePin] : [];
    }));
    const hasActiveBuzzerTone = (snapshot: SimulatorSnapshot) => snapshot.tones.some(tone => tone.active && wiredTonePins.has(tone.pin));
    const isActive = (run: SimulationRun | undefined) => !!buzzer && wiredTonePins.size > 0 && !!run
      && run.snapshots.some(hasActiveBuzzerTone);
    const staysSilent = (run: SimulationRun | undefined) => !!buzzer && wiredTonePins.size > 0 && !!run
      && run.snapshots.every(snapshot => !hasActiveBuzzerTone(snapshot));
    return hasDistanceDisplay && isActive(nearRun) && staysSilent(farRun)
      ? []
      : issue(`distance warning failed its near/far replay (display=${hasDistanceDisplay}, near-active=${isActive(nearRun)}, far-silent=${staysSilent(farRun)}).`);
  }
  if (evidence === "digital-output") {
    const outputValues = snapshots.flatMap(snapshot => [
      ...snapshot.pins.filter(pin => pin.mode === "OUTPUT").map(pin => pin.digitalValue),
      ...Object.values(snapshot.boardPins ?? {}).flatMap(pins => pins.filter(pin => pin.mode === "OUTPUT").map(pin => pin.digitalValue)),
    ]);
    return new Set(outputValues).size > 1 ? [] : issue("digital outputs never changed state under deterministic low/high inputs.");
  }
  const anyVisible = snapshots.some(snapshot => snapshot.serial.some(entry => entry.text.trim())
    || snapshot.lcds.some(display => display.lines.some(line => line.trim()))
    || snapshot.tones.some(tone => tone.active)
    || snapshot.servos.some(servo => servo.attached)
    || Object.values(snapshot.componentStates).some(state => state.display?.some(line => line.trim()) || state.pixels?.some(pixel => pixel.r || pixel.g || pixel.b)));
  return anyVisible ? [] : issue("the project had no observable output during simulation.");
}

function withDeterministicInputs(project: CircuitProject, level: "low" | "high"): CircuitProject {
  const next = structuredClone(project);
  for (const component of next.components) {
    const definition = COMPONENT_CATALOG[component.type];
    if (!definition) continue;
    const defaults = definition.defaultProperties;
    const properties = { ...defaults, ...component.properties };
    const low = level === "low";
    if (component.type === "potentiometer") properties.value = low ? 10 : 90;
    if (component.type === "ky-023-joystick") {
      // Drive rail-to-rail so fixed thresholds work across 10-bit AVR and
      // 12-bit ESP32/Pico ADC profiles (a 10% sample can sit above a 400-count
      // reverse threshold on a 12-bit board).
      properties.x = low ? 0 : 100;
      properties.y = low ? 100 : 0;
      properties.pressed = false;
    }
    if (component.type === "as5600-magnetic-encoder") properties.angleDeg = low ? 20 : 300;
    if (component.type === "hc-sr04" || component.type === "jsn-sr04t-ultrasonic" || component.type === "vl53l0x-tof-distance") {
      properties.distanceCm = low ? 15 : 150;
      properties.distance = low ? 15 : 150;
    }
    if (component.type === "temperature-sensor" || definition.category === "sensors") {
      properties.temperatureC = low ? 20 : 36;
      properties.temperature = low ? 20 : 36;
      properties.humidityPct = low ? 35 : 75;
      properties.humidity = low ? 35 : 75;
      properties.moisture = low ? 20 : 80;
      properties.lux = low ? 30 : 900;
      properties.lightLevel = low ? 30 : 900;
      properties.motion = !low;
      properties.co2Ppm = low ? 450 : 1_400;
      properties.co2 = low ? 450 : 1_400;
    }
    if (component.type === "push-button" || component.type === "dip-switch-8") {
      properties.pressed = !low;
      properties.switch1 = !low;
      properties.position = !low;
    }
    component.properties = properties;
  }
  return next;
}
