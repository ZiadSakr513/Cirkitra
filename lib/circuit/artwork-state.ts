import type { SimulatedComponentState } from "../simulator/types.ts";

/** Return a finite, bounded angle suitable for a physical-artwork transform. */
export function clampArtworkAngle(value: unknown, fallback = 0, maximum = 360): number {
  const angle = Number(value);
  return Number.isFinite(angle) ? Math.max(0, Math.min(maximum, angle)) : fallback;
}

/** Simulator-backed numeric position for a stepper rotor. */
export function artworkStepperAngle(state?: SimulatedComponentState): number {
  return clampArtworkAngle(state?.readings?.angleDegrees, 0, 360);
}

/** The TM1637 device runtime stores the rendered segment string in display state. */
export function artworkDisplayLines(state?: SimulatedComponentState): string[] {
  return (state?.display ?? []).map(line => String(line).replace(/\s+$/, ""));
}

/** SPI-only models expose transfer activity rather than pretending to render pixels. */
export function artworkSpiActivityLines(state?: SimulatedComponentState): string[] {
  const bytes = Number(state?.readings?.spiBytes);
  return state?.powered && Number.isFinite(bytes) && bytes > 0
    ? ["SIM SPI TX", `${Math.trunc(bytes)} BYTES`]
    : [];
}

/** True only when the simulator says a powered actuator is actually energized. */
export function artworkActuatorEnergized(state?: SimulatedComponentState): boolean {
  if (!state?.powered) return false;
  const energized = Number(state.readings?.energized ?? state.channels?.energized ?? state.readings?.enabled ?? 0);
  return energized > 0 || /\benergized\b|\bopen\b/i.test(state.status ?? "");
}

/** Water-flow artwork follows the simulated flow control/pulse rate, not supply alone. */
export function artworkFlowing(state?: SimulatedComponentState): boolean {
  if (!state?.powered) return false;
  const flowLpm = state.readings?.flowLpm;
  const pulseHz = state.readings?.pulseHz;
  return Number(flowLpm ?? pulseHz ?? 0) > 0;
}

/** A bounded joystick travel derived from the same 0–100 controls as its ADC model. */
export function artworkJoystickOffset(value: unknown): number {
  const position = clampArtworkAngle(value, 50, 100);
  return (position - 50) * 0.24;
}
