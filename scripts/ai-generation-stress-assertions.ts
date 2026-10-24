import { boardPinLabel, getBoardProfile, isBoardType } from "../lib/circuit/boards.ts";
import type { CircuitProject } from "../lib/circuit/types.ts";
import { POWER_TERMINAL_GROUPS } from "../lib/circuit/terminal-groups.ts";
import type { ComplexPinExpectation } from "./ai-generation-complex-reliability-cases.ts";

export type PixelObservationSnapshot = {
  componentStates?: Readonly<Record<string, { pixels?: readonly { r: number; g: number; b: number }[] }>>;
  boardSnapshots?: Readonly<Record<string, PixelObservationSnapshot>>;
};

export type StepperObservationSnapshot = {
  componentStates?: Readonly<Record<string, {
    direction?: string;
    readings?: Readonly<Record<string, unknown>>;
  }>>;
  boardSnapshots?: Readonly<Record<string, StepperObservationSnapshot>>;
};

/** Accept visible output observed at any deterministic simulation sample, not
 * only the final frame after a blink or startup animation has gone dark. */
export function hasVisiblePixelsAcrossSnapshots(snapshots: readonly PixelObservationSnapshot[]): boolean {
  const hasPixels = (snapshot: PixelObservationSnapshot): boolean =>
    Object.values(snapshot.componentStates ?? {}).some(state => state.pixels?.some(pixel => pixel.r > 0 || pixel.g > 0 || pixel.b > 0))
    || Object.values(snapshot.boardSnapshots ?? {}).some(hasPixels);
  return snapshots.some(hasPixels);
}

/** Stepper direction is a relative response: either joystick side may be
 * called forward by the sketch, as long as the two sides move oppositely. */
export function hasOppositeSignedStepperMotion(firstSteps: number, secondSteps: number): boolean {
  return Number.isFinite(firstSteps) && Number.isFinite(secondSteps)
    && firstSteps !== 0 && secondSteps !== 0
    && Math.sign(firstSteps) !== Math.sign(secondSteps);
}

/** Confirm that a driver actually pulsed a stepper in both directions during
 * the sampled run, rather than merely configuring GPIO outputs. */
export function hasForwardAndReverseStepperMotion(snapshots: readonly StepperObservationSnapshot[], motorId: string): boolean {
  const directions = new Set<string>();
  const stepCounts = new Set<number>();
  const visit = (snapshot: StepperObservationSnapshot) => {
    const state = snapshot.componentStates?.[motorId];
    if (state?.direction === "forward" || state?.direction === "reverse") directions.add(state.direction);
    const steps = Number(state?.readings?.steps);
    if (Number.isFinite(steps)) stepCounts.add(steps);
    for (const child of Object.values(snapshot.boardSnapshots ?? {})) visit(child);
  };
  snapshots.forEach(visit);
  return directions.has("forward") && directions.has("reverse")
    && stepCounts.size > 1 && [...stepCounts].some(steps => steps !== 0);
}

/** Check required schematic nets without mistaking separate board ground pads
 * for isolated electrical nodes; pads on one board share its ground plane. */
export function verifyRequiredNets(project: CircuitProject, requirements: readonly (readonly ComplexPinExpectation[])[]): string | undefined {
  const parent = new Map<string, string>();
  const key = (componentId: string, pin: string) => `${componentId}:${pin}`;
  const find = (value: string): string => {
    const current = parent.get(value);
    if (!current || current === value) { parent.set(value, value); return value; }
    const root = find(current);
    parent.set(value, root);
    return root;
  };
  const join = (left: string, right: string) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  };

  // Ground header pins are bonded internally on a physical board. Do not join
  // ground pins between different boards: a mixed-board common return still
  // has to be visible in the actual generated wiring.
  for (const board of project.components.filter(component => isBoardType(component.type))) {
    const profile = getBoardProfile(board.type);
    const grounds = profile?.groundPins.map(pin => key(board.id, pin)) ?? [];
    for (let index = 1; index < grounds.length; index += 1) join(grounds[0]!, grounds[index]!);
    for (const io of profile?.ioPins ?? []) {
      for (const alias of io.aliases ?? []) join(key(board.id, io.id), key(board.id, alias));
    }
    for (const [signal, runtimePin] of Object.entries(profile?.constants ?? {})) {
      if ((signal === "SDA" || signal === "SCL") && typeof runtimePin === "number") {
        join(key(board.id, signal), key(board.id, boardPinLabel(board.type, runtimePin)));
      }
    }
  }
  for (const component of project.components) {
    for (const group of POWER_TERMINAL_GROUPS[component.type] ?? []) {
      for (const pin of group.slice(1)) join(key(component.id, group[0]!), key(component.id, pin));
    }
  }
  // The TB6612FNG's repeated package pins are physically duplicated pads on
  // the same output terminal. Keep this verifier consistent with the
  // electrical metadata used by the simulator and circuit diagnostics.
  const duplicatedOutputPads: Record<string, string[][]> = {
    tb6612fng: [["AO1_1", "AO1_2"], ["AO2_5", "AO2_6"], ["BO1_11", "BO1_12"], ["BO2_7", "BO2_8"]],
  };
  for (const component of project.components) {
    for (const group of duplicatedOutputPads[component.type] ?? []) {
      for (const pin of group.slice(1)) join(key(component.id, group[0]!), key(component.id, pin));
    }
  }
  const groundSymbols = project.components.filter(component => component.type === "ground");
  for (const ground of groundSymbols.slice(1)) join(key(groundSymbols[0]!.id, "GND"), key(ground.id, "GND"));
  for (const connection of project.connections) {
    join(key(connection.from.componentId, connection.from.pin), key(connection.to.componentId, connection.to.pin));
  }

  for (const [index, requirement] of requirements.entries()) {
    const endpointRootSets = requirement.map(expected => {
      const candidates = project.components.filter(component => component.type === expected.componentType
        && (!expected.labelIncludes || component.label.toLowerCase().includes(expected.labelIncludes.toLowerCase())));
      const component = candidates[expected.occurrence ?? 0];
      if (!component) return { expected, roots: new Set<string>(), missingComponent: true };
      return {
        expected,
        roots: new Set(expected.pins
          .map(pin => find(key(component.id, pin)))
          .filter(root => project.connections.some(wire =>
            find(key(wire.from.componentId, wire.from.pin)) === root
            || find(key(wire.to.componentId, wire.to.pin)) === root))),
        missingComponent: false,
      };
    });
    const missing = endpointRootSets.find(item => item.missingComponent || item.roots.size === 0);
    if (missing) {
      return `Required net ${index + 1} is missing a connected endpoint: ${missing.expected.componentType}${missing.expected.labelIncludes ? ` (label contains "${missing.expected.labelIncludes}")` : ""}.${missing.expected.pins.join("/")}${missing.expected.occurrence === undefined ? "" : ` [${missing.expected.occurrence}]`}.`;
    }
    const shared = [...endpointRootSets[0]!.roots].some(root => endpointRootSets.every(item => item.roots.has(root)));
    if (!shared) {
      return `Required net ${index + 1} does not join ${endpointRootSets.map(item => `${item.expected.componentType}${item.expected.labelIncludes ? ` (label contains "${item.expected.labelIncludes}")` : ""}.${item.expected.pins.join("/")}`).join(" with ")}.`;
    }
  }
  return undefined;
}
