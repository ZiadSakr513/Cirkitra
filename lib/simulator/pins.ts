import {
  UNO_ANALOG_PIN_COUNT,
  UNO_DIGITAL_PIN_COUNT,
  UNO_PIN_COUNT,
  type UnoPinState,
} from "./types.ts";

export const UNO_PWM_PINS = new Set([3, 5, 6, 9, 10, 11]);

export function isUnoPin(pin: number): boolean {
  return Number.isInteger(pin) && pin >= 0 && pin < UNO_PIN_COUNT;
}

export function unoPinLabel(pin: number): string {
  if (!isUnoPin(pin)) {
    return `Pin ${pin}`;
  }

  return pin < UNO_DIGITAL_PIN_COUNT
    ? `D${pin}`
    : `A${pin - UNO_DIGITAL_PIN_COUNT}`;
}

export function parseUnoPinLabel(label: string): number | undefined {
  const normalized = label.trim().toUpperCase();
  const digital = /^D(\d{1,2})$/.exec(normalized);
  if (digital) {
    const pin = Number(digital[1]);
    return pin >= 0 && pin < UNO_DIGITAL_PIN_COUNT ? pin : undefined;
  }

  const analog = /^A(\d)$/.exec(normalized);
  if (analog) {
    const offset = Number(analog[1]);
    return offset >= 0 && offset < UNO_ANALOG_PIN_COUNT
      ? UNO_DIGITAL_PIN_COUNT + offset
      : undefined;
  }

  if (/^\d{1,2}$/.test(normalized)) {
    const pin = Number(normalized);
    return isUnoPin(pin) ? pin : undefined;
  }

  return undefined;
}

export function createInitialPinStates(): UnoPinState[] {
  return Array.from({ length: UNO_PIN_COUNT }, (_, number) => ({
    number,
    label: unoPinLabel(number),
    mode: "INPUT" as const,
    digitalValue: 0 as const,
    pwmValue: 0,
    lastChangedAtMs: 0,
  }));
}
