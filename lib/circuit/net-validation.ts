import { getBoardProfile, isBoardType } from "./boards.ts";
import { getComponentDefinition, type ComponentDefinition } from "./catalog.ts";

export type NetEndpointCompatibilityIssue = {
  code: "NET_POWER_GROUND_SHORT" | "NET_PIN_CONTENTION" | "NET_COMPONENT_SHORT";
  message: string;
  endpoints: Array<{ componentId: string; pin: string }>;
  netIds: string[];
  wireIds?: string[];
  expectedTopology: string;
};

type ElectricalNetGroup = {
  id: string;
  endpoints: readonly { componentId: string; pin: string }[];
  wireIds?: readonly string[];
};

/** Reject electrical shorts and incompatible GPIOs inside each physical net.
 * Shared board grounds and one GPIO from each of two boards remain valid. */
export function validateNetEndpointCompatibility(
  components: readonly { id: string; type: string; label?: string }[],
  nets: readonly ElectricalNetGroup[],
  availableParts: readonly ComponentDefinition[],
): NetEndpointCompatibilityIssue[] {
  const componentById = new Map(components.map(component => [component.id, component] as const));
  const definitionByType = new Map(availableParts.map(definition => [definition.id, definition] as const));
  const issues: NetEndpointCompatibilityIssue[] = [];
  const terminalPairs: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
    led: [["A", "K"]],
    buzzer: [["+", "-"]],
    "dc-supply": [["+", "-"]],
    "battery-cell": [["+", "-"]],
    "dc-motor": [["+", "-"]],
  };

  for (const net of nets) {
    const unique = new Map(net.endpoints.map(endpoint => [`${endpoint.componentId}:${endpoint.pin}`, endpoint] as const));
    const endpoints = [...unique.values()];
    if (endpoints.length < 2) continue;
    const boardGrounds: Array<{ componentId: string; pin: string }> = [];
    const boardRails: Array<{ componentId: string; pin: string }> = [];
    const boardGpios: Array<{ componentId: string; pin: string; runtimePin: number }> = [];
    const componentPins = new Map<string, Set<string>>();
    const trueGrounds: Array<{ componentId: string; pin: string }> = [];
    const positiveSupplies: Array<{ componentId: string; pin: string }> = [];

    for (const endpoint of endpoints) {
      const component = componentById.get(endpoint.componentId);
      if (!component) continue;
      const pins = componentPins.get(component.id) ?? new Set<string>();
      pins.add(endpoint.pin);
      componentPins.set(component.id, pins);
      if (isBoardType(component.type)) {
        const profile = getBoardProfile(component.type);
        if (!profile) continue;
        if (profile.groundPins.includes(endpoint.pin)) {
          boardGrounds.push(endpoint);
          trueGrounds.push(endpoint);
        } else if (Object.hasOwn(profile.rails, endpoint.pin)) {
          boardRails.push(endpoint);
          positiveSupplies.push(endpoint);
        } else {
          const ioPin = profile.ioPins.find(pin => pin.id === endpoint.pin);
          if (ioPin) boardGpios.push({ ...endpoint, runtimePin: ioPin.runtimePin });
        }
        continue;
      }

      if (component.type === "ground" && endpoint.pin === "GND") {
        trueGrounds.push(endpoint);
        continue;
      }
      const definition = definitionByType.get(component.type) ?? getComponentDefinition(component.type);
      const pin = definition?.pins.find(candidate => candidate.id === endpoint.pin);
      if (!pin) continue;
      if (definition?.metadata?.groundPins.includes(endpoint.pin)
        || (pin.direction === "power" && pin.signals.includes("ground"))) trueGrounds.push(endpoint);
      if (definition?.metadata?.supplies.some(supply => supply.pins.includes(endpoint.pin))
        || (pin.direction === "power" && pin.signals.includes("power"))) positiveSupplies.push(endpoint);
    }

    const issue = (code: NetEndpointCompatibilityIssue["code"], message: string, implicated: readonly { componentId: string; pin: string }[], expectedTopology: string) => {
      issues.push({
        code,
        message,
        endpoints: [...(implicated.length > 1 ? implicated : endpoints)],
        netIds: [net.id],
        ...(net.wireIds ? { wireIds: [...net.wireIds] } : {}),
        expectedTopology,
      });
    };

    if (trueGrounds.length && positiveSupplies.length) {
      issue(
        "NET_POWER_GROUND_SHORT",
        `Net ${net.id} directly joins positive supply endpoints ${positiveSupplies.map(endpoint => `${endpoint.componentId}.${endpoint.pin}`).join(", ")} to ground/return endpoints ${trueGrounds.map(endpoint => `${endpoint.componentId}.${endpoint.pin}`).join(", ")}.`,
        [...positiveSupplies, ...trueGrounds],
        "Keep positive supply and ground/return endpoints on separate nets; connect loads between them through their intended terminals.",
      );
    }

    const gpioConflict = (boardGpios.length > 0 && (trueGrounds.length > 0 || positiveSupplies.length > 0))
      || [...new Set(boardGpios.map(gpio => gpio.componentId))].some(boardId =>
        new Set(boardGpios.filter(gpio => gpio.componentId === boardId).map(gpio => gpio.runtimePin)).size > 1);
    if (gpioConflict) {
      const implicated = [...boardGpios, ...boardGrounds, ...boardRails, ...trueGrounds, ...positiveSupplies]
        .filter((endpoint, index, all) => all.findIndex(other => other.componentId === endpoint.componentId && other.pin === endpoint.pin) === index);
      issue(
        "NET_PIN_CONTENTION",
        `Net ${net.id} merges incompatible board pins: ${implicated.map(endpoint => `${endpoint.componentId}.${endpoint.pin}`).join(", ")}. A net may not join GPIO to a supply/return or join distinct GPIOs on the same board.`,
        implicated,
        "Separate board GPIO signals, supply rails, and ground returns onto distinct nets. A board-to-board signal may connect one GPIO from each board, with grounds on their own shared return net.",
      );
    }

    for (const [componentId, pins] of componentPins) {
      const component = componentById.get(componentId)!;
      const pairs = [...(terminalPairs[component.type] ?? [])];
      const definition = definitionByType.get(component.type) ?? getComponentDefinition(component.type);
      const metadata = definition?.metadata;
      if (metadata?.groundPins.length && metadata.supplies.length) {
        for (const supply of metadata.supplies) for (const groundPin of metadata.groundPins) {
          if (supply.pins.includes(groundPin)) continue;
          if (pins.has(groundPin) && supply.pins.some(pin => pins.has(pin))) pairs.push([groundPin, supply.pins.find(pin => pins.has(pin))!] as const);
        }
      }
      for (const [left, right] of pairs) {
        if (!pins.has(left) || !pins.has(right)) continue;
        issue(
          "NET_COMPONENT_SHORT",
          `Net ${net.id} shorts the opposing terminals ${component.label ?? component.id}.${left} and ${component.label ?? component.id}.${right}.`,
          [{ componentId, pin: left }, { componentId, pin: right }],
          `Keep ${component.label ?? component.id}.${left} and ${component.label ?? component.id}.${right} on separate nets, with the requested load or current-limiting path between them.`,
        );
      }
    }
  }
  return issues;
}

/** Collapse wire endpoints into physical nets, then apply project-wide electrical rules. */
export function validateProjectNetEndpointCompatibility(
  components: readonly { id: string; type: string; label?: string }[],
  connections: readonly { id: string; from: { componentId: string; pin: string }; to: { componentId: string; pin: string } }[],
  availableParts: readonly ComponentDefinition[],
): NetEndpointCompatibilityIssue[] {
  const parent = new Map<string, string>();
  const find = (value: string): string => {
    const current = parent.get(value);
    if (!current || current === value) { parent.set(value, value); return value; }
    const root = find(current);
    parent.set(value, root);
    return root;
  };
  const join = (left: string, right: string) => {
    const a = find(left), b = find(right);
    if (a !== b) parent.set(b, a);
  };
  const key = (endpoint: { componentId: string; pin: string }) => `${endpoint.componentId}:${endpoint.pin}`;
  for (const connection of connections) join(key(connection.from), key(connection.to));
  const nets = new Map<string, { id: string; endpoints: { componentId: string; pin: string }[]; wireIds: string[] }>();
  for (const connection of connections) {
    const root = find(key(connection.from));
    const net = nets.get(root) ?? { id: `wire-net:${root}`, endpoints: [], wireIds: [] };
    for (const endpoint of [connection.from, connection.to]) {
      if (!net.endpoints.some(item => item.componentId === endpoint.componentId && item.pin === endpoint.pin)) net.endpoints.push(endpoint);
    }
    net.wireIds.push(connection.id);
    nets.set(root, net);
  }
  return validateNetEndpointCompatibility(components, [...nets.values()], availableParts);
}
