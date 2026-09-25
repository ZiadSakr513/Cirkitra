import type { SimulatorStatus } from "../simulator/types.ts";

/** Presentation of solved motor drive, without inventing mechanical RPM. */
export function motorDisplay(input: {
  powered: boolean; direction?: string; speed?: number;
  status: SimulatorStatus; playbackSpeed: number;
}) {
  const drive = Number.isFinite(input.speed) ? Math.min(1, Math.max(0, input.speed ?? 0)) : 0;
  const cleared = input.status === "idle" || input.status === "error";
  const active = !cleared && input.powered && drive > 0.01 && (input.direction === "forward" || input.direction === "reverse");
  const direction = active ? input.direction! : !cleared && input.direction === "brake" ? "brake" : "coast";
  const playback = Number.isFinite(input.playbackSpeed) && input.playbackSpeed > 0 ? input.playbackSpeed : 1;
  return {
    active,
    direction,
    moving: active && input.status === "running",
    duration: Math.max(0.15, Math.min(12, 1.2 / Math.max(0.1, drive) / playback)),
    label: active ? `${direction === "reverse" ? "Reverse" : "Forward"} · ${Math.round(drive * 100)}%`
      : `Stopped · ${direction === "brake" ? "Brake" : "Coast"}`,
  };
}
