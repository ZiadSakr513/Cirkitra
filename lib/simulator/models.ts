import type { CircuitComponent } from "../circuit/types.ts";

export type PinReading = { value?: number; conflict: boolean };
export interface ModelContext {
  component: CircuitComponent;
  read(pin: string): PinReading;
  connected(pin: string): boolean;
}
export interface ModelResult {
  powered: boolean;
  outputs: Record<string, number>;
  bridges: [string, string][];
  missing: string[];
}
export interface ElectricalModel {
  internalGroups?: readonly (readonly string[])[];
  evaluate(context: ModelContext): ModelResult;
}
const value = (c: ModelContext, pin: string) => c.read(pin).conflict ? undefined : c.read(pin).value;
const high = (c: ModelContext, pin: string) => (value(c, pin) ?? 0) >= 0.5;
const low = (c: ModelContext, pin: string) => value(c, pin) !== undefined && value(c, pin)! < 0.5;
function result(c: ModelContext, supplies: string[], grounds: string[]): ModelResult {
  return { powered: supplies.every(pin => high(c, pin)) && grounds.every(pin => low(c, pin)), outputs: {}, bridges: [], missing: [] };
}
function known(c: ModelContext, r: ModelResult, pins: string[]) {
  const missing = pins.filter(pin => value(c, pin) === undefined);
  r.missing.push(...missing);
  return !missing.length;
}
function mux(count: number, channel: string, grounds: string[]): ElectricalModel {
  return { evaluate(c) {
    const r = result(c, ["VCC"], grounds);
    const selectors = Array.from({ length: Math.log2(count) }, (_, index) => `S${index}`);
    if (r.powered && known(c, r, ["E", ...selectors]) && low(c, "E")) {
      const selected = selectors.reduce((sum, pin, bit) => sum + (high(c, pin) ? 1 << bit : 0), 0);
      r.bridges.push(["COM", `${channel}${selected}`]);
    }
    return r;
  } };
}
function bridge(c: ModelContext, r: ModelResult, inputs: string[], outputs: string[], enable?: string, sense?: string, coast00 = false) {
  if (!outputs.some(pin => c.connected(pin))) return;
  if (!known(c, r, [...inputs, ...(enable ? [enable] : []), ...(sense ? [sense] : [])])) return;
  if (sense && !low(c, sense)) return;
  const duty = enable ? value(c, enable)! : 1;
  if (duty <= 0) return;
  const a = value(c, inputs[0])!; const b = value(c, inputs[1])!;
  if (coast00 && a === 0 && b === 0) return;
  // DRV8833 uses low-side short braking for 11; averaged input PWM
  // represents slow decay against a high opposite input.
  r.outputs[outputs[0]] = coast00 ? Math.max(a - b, 0) : a * duty;
  r.outputs[outputs[1]] = coast00 ? Math.max(b - a, 0) : b * duty;
}
const l293d: ElectricalModel = {
  internalGroups: [["GND1", "GND2", "GND3", "GND4"]],
  evaluate(c) {
    const r = result(c, ["VSS", "VS"], ["GND1"]);
    if (r.powered) {
      bridge(c, r, ["IN1", "IN2"], ["OUT1", "OUT2"], "EN1");
      bridge(c, r, ["IN3", "IN4"], ["OUT3", "OUT4"], "EN2");
    }
    return r;
  },
};
const tb6612: ElectricalModel = {
  internalGroups: [["AO1_1", "AO1_2"], ["AO2_5", "AO2_6"], ["BO1_11", "BO1_12"], ["BO2_7", "BO2_8"], ["PGND1_3", "PGND1_4"], ["PGND2_9", "PGND2_10"], ["VM1", "VM2", "VM3"]],
  evaluate(c) {
    const r = result(c, ["VCC", "VM1"], ["GND"]);
    if (!r.powered || !known(c, r, ["STBY"]) || !high(c, "STBY")) return r;
    for (const [a, b, pwm, ground, out1, out2] of [["AIN1", "AIN2", "PWMA", "PGND1_3", "AO1_1", "AO2_5"], ["BIN1", "BIN2", "PWMB", "PGND2_9", "BO1_11", "BO2_7"]]) {
      if (![out1, out2].some(pin => c.connected(pin))) continue;
      if (!known(c, r, [a, b, pwm, ground]) || !low(c, ground)) continue;
      const duty = value(c, pwm)!;
      if (duty === 0 || (high(c, a) && high(c, b))) { r.outputs[out1] = 0; r.outputs[out2] = 0; }
      else if (high(c, a) || high(c, b)) { r.outputs[out1] = high(c, a) ? duty : 0; r.outputs[out2] = high(c, b) ? duty : 0; }
    }
    return r;
  },
};
const drv8833: ElectricalModel = { evaluate(c) {
  const r = result(c, ["VM"], ["GND"]);
  if (r.powered && known(c, r, ["nSLEEP"]) && high(c, "nSLEEP")) {
    bridge(c, r, ["AIN1", "AIN2"], ["AOUT1", "AOUT2"], undefined, "AISEN", true);
    bridge(c, r, ["BIN1", "BIN2"], ["BOUT1", "BOUT2"], undefined, "BISEN", true);
  }
  return r;
} };
const l298: ElectricalModel = { evaluate(c) {
  const r = result(c, ["VSS", "VS"], ["GND"]);
  if (r.powered) {
    bridge(c, r, ["IN1", "IN2"], ["OUT1", "OUT2"], "ENA", "SENSE_A");
    bridge(c, r, ["IN3", "IN4"], ["OUT3", "OUT4"], "ENB", "SENSE_B");
  }
  return r;
} };
const decoder: ElectricalModel = { evaluate(c) {
  const r = result(c, ["VCC"], ["GND"]);
  if (!r.powered || !known(c, r, ["E1", "E2", "E3"])) return r;
  const enabled = low(c, "E1") && low(c, "E2") && high(c, "E3");
  if (enabled && !known(c, r, ["A0", "A1", "A2"])) return r;
  const selected = ["A0", "A1", "A2"].reduce((sum, pin, bit) => sum + (high(c, pin) ? 1 << bit : 0), 0);
  for (let index = 0; index < 8; index++) r.outputs[`Y${index}`] = enabled && index === selected ? 0 : 1;
  return r;
} };
const analogTemperatureSensor: ElectricalModel = { evaluate(c) {
  const r = result(c, ["VCC"], ["GND"]);
  if (r.powered) {
    const temperature = Number(c.component.properties?.temperatureC ?? 24);
    const volts = 0.5 + (Number.isFinite(temperature) ? temperature : 24) / 100;
    r.outputs.OUT = Math.max(0, Math.min(1, volts / 5));
  }
  return r;
} };
const pirSensor: ElectricalModel = { evaluate(c) {
  const r = result(c, ["VCC"], ["GND"]);
  if (r.powered) r.outputs.OUT = Number(c.component.properties?.motion === true);
  return r;
} };
const soilMoistureSensor: ElectricalModel = { evaluate(c) {
  const r = result(c, ["VCC"], ["GND"]);
  if (r.powered) {
    const moisture = Math.max(0, Math.min(100, Number(c.component.properties?.moisture ?? 50)));
    // This is a normalized demonstration curve, not a voltage calibration or
    // volumetric-water-content estimate for a particular soil/probe.
    r.outputs.AOUT = Number.isFinite(moisture) ? 1 - moisture / 100 : 0.5;
  }
  return r;
} };
const ultrasonicSensor: ElectricalModel = { evaluate(c) {
  return result(c, ["VCC"], ["GND"]);
} };
function gate(operation: (a: boolean, b: boolean) => boolean, unary = false): ElectricalModel {
  return { evaluate(c) {
    const r = result(c, ["VCC"], ["GND"]);
    if (r.powered && known(c, r, unary ? ["A"] : ["A", "B"])) r.outputs.Y = operation(high(c, "A"), high(c, "B")) ? 1 : 0;
    return r;
  } };
}

/** Device models are selected by catalog model ID; legacy IDs remain compatible. */
export const ELECTRICAL_MODELS: Readonly<Record<string, ElectricalModel>> = {
  "mux-4067": mux(16, "I", ["GND"]), "mux-4051": mux(8, "A", ["GND", "VEE"]),
  "decoder-138": decoder, "driver-tb6612": tb6612, "driver-drv8833": drv8833, "driver-l298": l298, l293d,
  "temperature-sensor": analogTemperatureSensor, "pir-sensor": pirSensor,
  "hc-sr04": ultrasonicSensor,
  "soil-moisture-sen0193": soilMoistureSensor,
  "logic-and": gate((a, b) => a && b), "logic-or": gate((a, b) => a || b), "logic-xor": gate((a, b) => a !== b),
  "logic-nand": gate((a, b) => !(a && b)), "logic-nor": gate((a, b) => !(a || b)), "logic-not": gate(a => !a, true),
  potentiometer: { evaluate(c) {
    const r = result(c, ["VCC"], ["GND"]);
    if (r.powered) r.outputs.SIG = Math.min(100, Math.max(0, Number(c.component.properties?.value ?? 50))) / 100;
    return r;
  } },
};
