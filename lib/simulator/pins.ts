import { UNO_PIN_COUNT, type BoardPinState } from "./types.ts";
import { boardPinLabel, getBoardProfile, isBoardPin, isBoardPwmPin, resolveBoardPin } from "../circuit/boards.ts";

export const UNO_PWM_PINS = new Set([3, 5, 6, 9, 10, 11]);

export function isUnoPin(pin: number): boolean {
  return isBoardPin("arduino-uno", pin);
}

export function unoPinLabel(pin: number): string {
  return boardPinLabel("arduino-uno", pin);
}

export function parseUnoPinLabel(label: string): number | undefined {
  return resolveBoardPin("arduino-uno", label);
}

export function parseBoardPinLabel(boardId: string, label: string): number | undefined { return resolveBoardPin(boardId, label); }
export function boardPwmPins(boardId: string): ReadonlySet<number> { return new Set(getBoardProfile(boardId)?.pwmPins ?? []); }
export function isPwmPin(boardId: string, pin: number): boolean { return isBoardPwmPin(boardId, pin); }
export function createInitialPinStates(boardId = "arduino-uno"): BoardPinState[] {
  const profile = getBoardProfile(boardId);
  return Array.from({ length: profile?.runtimePinCount ?? UNO_PIN_COUNT }, (_, number) => ({
    number,
    label: boardPinLabel(boardId, number),
    mode: "INPUT" as const,
    digitalValue: 0 as const,
    pwmValue: 0,
    lastChangedAtMs: 0,
  }));
}
