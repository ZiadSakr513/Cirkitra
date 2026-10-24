"use client";

import { useEffect, useRef, useState } from "react";
import type { SimulatorStatus } from "../lib/simulator/types.ts";
import { stepServoVisualAngle } from "../lib/circuit/servo-motion.ts";

export function useServoVisualAngle({
  enabled,
  commandAngle,
  resetAngle,
  status,
  playbackSpeed,
}: {
  enabled: boolean;
  commandAngle?: number;
  resetAngle: number;
  status: SimulatorStatus;
  playbackSpeed: number;
}) {
  const [angle, setAngle] = useState(resetAngle);
  const angleRef = useRef(resetAngle);
  const targetRef = useRef(commandAngle);

  useEffect(() => {
    if (!enabled) return;
    targetRef.current = commandAngle;
    if (status === "idle") {
      const reset = stepServoVisualAngle({ currentAngle: angleRef.current, resetAngle, elapsedSeconds: 0, status });
      angleRef.current = reset;
      setAngle(reset);
    }
  }, [commandAngle, enabled, resetAngle, status]);

  useEffect(() => {
    if (!enabled || status !== "running" || commandAngle === undefined) return;
    let frame = 0;
    let previousTime = 0;
    const tick = (now: number) => {
      const elapsedSeconds = previousTime === 0 ? 0 : Math.max(0, Math.min(0.05, (now - previousTime) / 1000));
      previousTime = now;
      const next = stepServoVisualAngle({
        currentAngle: angleRef.current,
        commandAngle: targetRef.current,
        resetAngle,
        elapsedSeconds,
        playbackSpeed,
        status,
      });
      if (Math.abs(next - angleRef.current) > 0.001) {
        angleRef.current = next;
        setAngle(next);
      }
      if (Math.abs(next - (targetRef.current ?? next)) > 0.001) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [commandAngle, enabled, playbackSpeed, resetAngle, status]);

  return enabled ? angle : resetAngle;
}
