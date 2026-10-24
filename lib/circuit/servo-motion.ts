const DEFAULT_SERVO_SPEED_DEGREES_PER_SECOND = 540;
const MAX_VISUAL_FRAME_SECONDS = 0.05;
export const SCHEMATIC_SERVO_SPEED_DEGREES_PER_SECOND = 240;

/** Advance a displayed servo angle toward its simulator target without snapping. */
export function advanceServoVisualAngle(
  currentAngle: number,
  targetAngle: number,
  elapsedSeconds: number,
  speedDegreesPerSecond = DEFAULT_SERVO_SPEED_DEGREES_PER_SECOND,
): number {
  const current = Number.isFinite(currentAngle) ? Math.max(0, Math.min(180, currentAngle)) : 90;
  const target = Number.isFinite(targetAngle) ? Math.max(0, Math.min(180, targetAngle)) : current;
  const elapsed = Number.isFinite(elapsedSeconds) ? Math.max(0, Math.min(MAX_VISUAL_FRAME_SECONDS, elapsedSeconds)) : 0;
  const speed = Number.isFinite(speedDegreesPerSecond) ? Math.max(0, speedDegreesPerSecond) : DEFAULT_SERVO_SPEED_DEGREES_PER_SECOND;
  const maxStep = elapsed * speed;
  const difference = target - current;

  if (Math.abs(difference) <= maxStep) return target;
  return current + Math.sign(difference) * maxStep;
}

/**
 * Advance schematic artwork from the circuit command clock. Paused simulations
 * retain the horn's current visual angle; reset returns it to the component's
 * configured initial angle. An absent command (for example, a lost signal or
 * supply) never invents a new target.
 */
export function stepServoVisualAngle(input: {
  currentAngle: number;
  commandAngle?: number;
  resetAngle: number;
  elapsedSeconds: number;
  playbackSpeed?: number;
  status: "idle" | "running" | "paused" | "completed" | "error";
}): number {
  const resetAngle = Number.isFinite(input.resetAngle) ? Math.max(0, Math.min(180, input.resetAngle)) : 90;
  if (input.status === "idle") return resetAngle;
  if (input.status !== "running" || input.commandAngle === undefined) {
    return Number.isFinite(input.currentAngle) ? Math.max(0, Math.min(180, input.currentAngle)) : resetAngle;
  }
  const playbackSpeed = Number.isFinite(input.playbackSpeed) ? Math.max(0, input.playbackSpeed ?? 1) : 1;
  return advanceServoVisualAngle(
    input.currentAngle,
    input.commandAngle,
    input.elapsedSeconds * playbackSpeed,
    SCHEMATIC_SERVO_SPEED_DEGREES_PER_SECOND,
  );
}
