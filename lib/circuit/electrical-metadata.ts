import { getComponentDefinition } from "./catalog.ts";
import type { CircuitProject } from "./types.ts";

/** Check known rail voltages without pretending the normalized solver models volts. */
export function validatePartWiring(project: CircuitProject) {
  const issues: { severity: "warning" | "error"; code: string; message: string }[] = [];
  const graph = new Map<string, Set<string>>();
  const key = (id: string, pin: string) => `${id}:${pin}`;
  for (const wire of project.connections) {
    const a = key(wire.from.componentId, wire.from.pin); const b = key(wire.to.componentId, wire.to.pin);
    if (!graph.has(a)) graph.set(a, new Set()); if (!graph.has(b)) graph.set(b, new Set());
    graph.get(a)!.add(b); graph.get(b)!.add(a);
  }
  const voltages = new Map<string, number>();
  for (const part of project.components) if (part.type === "arduino-uno") {
    voltages.set(key(part.id, "5V"), 5); voltages.set(key(part.id, "3V3"), 3.3); voltages.set(key(part.id, "IOREF"), 5);
  }
  for (const part of project.components) {
    const definition = getComponentDefinition(part.type);
    if (!definition?.metadata) continue;
    for (const pin of definition.pins) if (pin.noConnect && graph.has(key(part.id, pin.id))) issues.push({ severity: "error", code: "no-connect-pin", message: `${part.label} pin ${pin.number} (${pin.label}) must be left unconnected.` });
    for (const supply of definition.metadata.supplies) for (const pin of supply.pins) {
      const pending = [key(part.id, pin)]; const visited = new Set<string>();
      while (pending.length) {
        const endpoint = pending.pop()!; if (visited.has(endpoint)) continue; visited.add(endpoint);
        const voltage = voltages.get(endpoint);
        if (voltage !== undefined && (voltage < supply.minVolts || voltage > supply.maxVolts)) {
          issues.push({ severity: "warning", code: "supply-voltage-range", message: `${part.label} ${pin} is wired to ${voltage} V; its documented range is ${supply.minVolts}–${supply.maxVolts} V.` }); break;
        }
        pending.push(...(graph.get(endpoint) ?? []));
      }
    }
  }
  return issues;
}
