import type { ComponentDefinition } from "./catalog.ts";
import { SIMULATION_PROPERTIES } from "./simulation-properties.ts";
/** Functional primitives required by battery-management examples, not physical IC variants. */
export const POWER_COMPONENTS: Record<string, ComponentDefinition> = Object.fromEntries([
  ["dc-supply", "DC Supply", ["+", "-"]], ["battery-cell", "Li-ion Cell", ["+", "-"]], ["dc-load", "DC Load", ["+", "-"]], ["ideal-mosfet", "Ideal N-MOS Switch", ["G", "D", "S"]],
].map(([id, name, terminals]) => {
  const type = String(id); const pins = terminals as string[]; const properties = SIMULATION_PROPERTIES[type];
  return [type, { id: type, displayName: String(name), description: "Functional DC simulation component.", category: "power", width: 160, height: 144, accent: "#e8ad53", simulated: true, symbol: "module", pins: pins.map((pin, index) => ({ id: pin, label: pin, number: String(index + 1), side: index ? "right" : "left", order: index ? index - 1 : 0, direction: "passive", signals: ["analog"] })), properties, defaultProperties: Object.fromEntries(Object.entries(properties).map(([key, p]) => [key, p.defaultValue])), simulation: { capability: "simulated", model: `${type}-runtime`, behavior: "Functional DC source, load, battery charge, or switching model.", limitations: "Idealized DC behavior; no transient, thermal or electrochemical model." } } satisfies ComponentDefinition];
}));
