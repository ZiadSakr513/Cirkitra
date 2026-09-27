import type { CircuitComponent, CircuitProject } from "../circuit/types.ts";
import type { SimulatedComponentState } from "./types.ts";

export interface MotorSupplyLoad {
  motorId: string;
  driverId: string;
  supplyPin: string;
  returnPin: string;
  current: number;
}

type DriverChannel = { outputs: [string[], string[]]; supplyPin: string; returnPin: string };
const DRIVER_CHANNELS: Readonly<Record<string, readonly DriverChannel[]>> = {
  l293d: [
    { outputs: [["OUT1"], ["OUT2"]], supplyPin: "VS", returnPin: "GND1" },
    { outputs: [["OUT3"], ["OUT4"]], supplyPin: "VS", returnPin: "GND1" },
  ],
  tb6612fng: [
    { outputs: [["AO1_1", "AO1_2"], ["AO2_5", "AO2_6"]], supplyPin: "VM1", returnPin: "PGND1_3" },
    { outputs: [["BO1_11", "BO1_12"], ["BO2_7", "BO2_8"]], supplyPin: "VM1", returnPin: "PGND2_9" },
  ],
  drv8833: [
    { outputs: [["AOUT1"], ["AOUT2"]], supplyPin: "VM", returnPin: "GND" },
    { outputs: [["BOUT1"], ["BOUT2"]], supplyPin: "VM", returnPin: "GND" },
  ],
  l298: [
    { outputs: [["OUT1"], ["OUT2"]], supplyPin: "VS", returnPin: "GND" },
    { outputs: [["OUT3"], ["OUT4"]], supplyPin: "VS", returnPin: "GND" },
  ],
};

const endpoint = (componentId: string, pin: string) => `${componentId}:${pin}`;

/** Estimate the DC input demand implied by the solved motor drive levels.
 * The simulator has no torque, back-EMF, or stall model; this is a configurable
 * full-drive current estimate scaled by the displayed PWM/speed level.
 */
export function deriveMotorSupplyLoads(
  project: CircuitProject,
  componentStates: Readonly<Record<string, SimulatedComponentState>>,
): MotorSupplyLoad[] {
  const parents = new Map<string, string>();
  const find = (value: string): string => {
    if (!parents.has(value)) parents.set(value, value);
    const parent = parents.get(value)!;
    if (parent === value) return value;
    const root = find(parent); parents.set(value, root); return root;
  };
  const join = (a: string, b: string) => { const rootA = find(a), rootB = find(b); if (rootA !== rootB) parents.set(rootB, rootA); };
  for (const wire of project.connections) join(endpoint(wire.from.componentId, wire.from.pin), endpoint(wire.to.componentId, wire.to.pin));
  for (const component of project.components) {
    if (component.type === "resistor") join(endpoint(component.id, "1"), endpoint(component.id, "2"));
    if (component.type === "tb6612fng") {
      for (const group of [["AO1_1", "AO1_2"], ["AO2_5", "AO2_6"], ["BO1_11", "BO1_12"], ["BO2_7", "BO2_8"], ["VM1", "VM2", "VM3"], ["PGND1_3", "PGND1_4"], ["PGND2_9", "PGND2_10"]]) {
        for (const pin of group.slice(1)) join(endpoint(component.id, group[0]), endpoint(component.id, pin));
      }
    }
  }

  const motors = project.components.filter(component => component.type === "dc-motor");
  const drivers = project.components.filter(component => DRIVER_CHANNELS[component.type]);
  const loads: MotorSupplyLoad[] = [];
  for (const motor of motors) {
    const state = componentStates[motor.id];
    if (!state?.powered || state.direction === "brake" || state.direction === "coast") continue;
    const plus = find(endpoint(motor.id, "+")), minus = find(endpoint(motor.id, "-"));
    const matches: Array<{ driver: CircuitComponent; channel: DriverChannel }> = [];
    for (const driver of drivers) for (const channel of DRIVER_CHANNELS[driver.type]) {
      const outputA = new Set(channel.outputs[0].map(pin => find(endpoint(driver.id, pin))));
      const outputB = new Set(channel.outputs[1].map(pin => find(endpoint(driver.id, pin))));
      if ((outputA.has(plus) && outputB.has(minus)) || (outputA.has(minus) && outputB.has(plus))) matches.push({ driver, channel });
    }
    // Ambiguous/shorted bridge wiring cannot be assigned a dependable source load.
    if (matches.length !== 1) continue;
    const { driver, channel } = matches[0];
    const configured = Number(motor.properties?.currentAtFullDrive ?? 0.2);
    const fullDriveAmps = Number.isFinite(configured) ? Math.max(0, Math.min(20, configured)) : 0.2;
    const speed = Number.isFinite(state.speed) ? Math.max(0, Math.min(1, state.speed!)) : 0;
    const current = fullDriveAmps * speed;
    if (current > 0) loads.push({ motorId: motor.id, driverId: driver.id, supplyPin: channel.supplyPin, returnPin: channel.returnPin, current });
  }
  return loads;
}
