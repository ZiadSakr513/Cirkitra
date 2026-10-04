import { isBoardType } from "../../../../lib/circuit/boards.ts";
import type { ComponentDefinition } from "../../../../lib/circuit/catalog.ts";

const GENERIC_ALIASES = new Set([
  "sensor", "sensors", "pressure", "temperature", "humidity", "mux", "multiplexer",
  "wireless", "radio", "i2c", "spi", "uart", "module", "chip", "driver", "motor driver",
  "motor drivers", "h bridge", "h bridges", "battery", "power",
]);
const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};
const LOGIC_GATE_OPERATORS: Record<string, string> = {
  "logic-and": "and",
  "logic-or": "or",
  "logic-xor": "xor",
  "logic-nand": "nand",
  "logic-nor": "nor",
  "logic-not": "not",
};
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function explicitlyRequestsLogicGate(componentId: string, prompt: string): boolean {
  const operator = LOGIC_GATE_OPERATORS[componentId];
  if (!operator) return true;
  const escapedOperator = escapeRegex(operator);
  const explicitGate = new RegExp(
    `\\b(?:(?:add|include|place|use|insert|connect|wire|need|want)\\s+(?:(?:a|an|the|one|two|three|four|five|\\d+)\\s+)?|(?:a|an|the|one|two|three|four|five|\\d+)\\s+)(?:logic\\s+)?${escapedOperator}\\s+(?:logic\\s+)?gate\\b`,
  );
  const namedLogic = new RegExp(`\\b(?:logic|logical)\\s+${escapedOperator}(?:\\s+gate)?\\b`);
  return explicitGate.test(prompt) || namedLogic.test(prompt);
}

/** Count explicitly requested part instances without treating board-model and
 * addressable-strip pixel numbers as separate hardware. */
export function requestedComponentCounts(prompt: string, definitions: readonly ComponentDefinition[]): Map<string, number> {
  const normalizedPrompt = ` ${normalize(prompt)} `;
  const counts = new Map<string, number>();
  for (const definition of definitions) {
    if (isBoardType(definition.id)) continue;
    if (definition.id in LOGIC_GATE_OPERATORS && !explicitlyRequestsLogicGate(definition.id, normalize(prompt))) continue;
    if (definition.id === "ground" && !/(?:\b(?:ground|gnd)\s+(?:symbol|component|part)\b|\b(?:add|include|place)\s+(?:(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+)?(?:ground|gnd)\b)/i.test(normalizedPrompt)) continue;
    const names = [definition.id, definition.displayName, ...(definition.requestAliases ?? []), ...(definition.metadata?.aliases ?? [])]
      .map(normalize)
      .filter(name => name.length > 2 && !GENERIC_ALIASES.has(name));
    if (definition.id === "led" && /\b(?:built in|on board|onboard|integrated)\s+(?:status\s+)?led\b/.test(normalizedPrompt)) continue;
    let matchedName: string | undefined;
    for (const name of names.sort((a, b) => b.length - a.length)) {
      if (normalizedPrompt.includes(` ${name} `) || normalizedPrompt.includes(` ${name}s `)) { matchedName = name; break; }
    }
    if (!matchedName) continue;
    const escapedName = escapeRegex(matchedName).replace(/\ /g, "\\s+");
    const quantity = new RegExp(`(?:^|\\s)(\\d+|${Object.keys(NUMBER_WORDS).join("|")})\\s+(?:x\\s+)?${escapedName}s?(?:\\s|$)`, "i").exec(normalizedPrompt);
    const parsedQuantity = quantity ? Number(quantity[1]) || NUMBER_WORDS[quantity[1].toLowerCase()] || 1 : 1;
    const quantityPosition = quantity ? normalizedPrompt.indexOf(quantity[1], quantity.index + 1) : -1;
    if (definition.id === "led" && quantityPosition >= 0) {
      const clauseStart = Math.max(
        normalizedPrompt.lastIndexOf(",", quantityPosition),
        normalizedPrompt.lastIndexOf(" and ", quantityPosition),
        normalizedPrompt.lastIndexOf(";", quantityPosition),
      ) + 1;
      const precedingClause = normalizedPrompt.slice(clauseStart, quantityPosition);
      if (/\b(?:ws2812[a-z0-9]*|neopixel|addressable|led|pixel)\b[\s\S]{0,50}\b(?:led\s+)?strip\b/.test(precedingClause)) continue;
    }
    const appearsInsideModelNumber = quantityPosition >= 0 && definitions.some(part => {
      const digitNames = [part.id, part.displayName, ...(part.metadata?.aliases ?? [])]
        .map(normalize)
        .filter(name => /\d/.test(name));
      return digitNames.some(name => {
        let searchFrom = 0;
        while (true) {
          const namePosition = normalizedPrompt.indexOf(name, searchFrom);
          if (namePosition < 0) return false;
          if (quantityPosition >= namePosition && quantityPosition < namePosition + name.length) return true;
          searchFrom = namePosition + name.length;
        }
      });
    });
    counts.set(definition.id, Math.max(counts.get(definition.id) ?? 0, appearsInsideModelNumber || parsedQuantity > 100 ? 1 : parsedQuantity));
  }

  const explicitStandaloneMotorSupply = /\b(?:(?:separate|external|regulated|bench|adjustable|dedicated)\s+){1,3}(?:(?:dc|motor|fan|actuator|power)\s+){0,3}(?:power\s+)?supply\b|\b(?:motor|fan|actuator)\s+(?:power\s+)?supply\b/.test(normalizedPrompt);
  if (definitions.some(definition => definition.id === "dc-supply")
    && (/\b(?:(?:separate|external|regulated|bench)\s+)*(?:5v|5\s+v|five\s+volt)(?:\s+dc)?\s+(?:power\s+)?supply\b|\b(?:separate|external|bench)\s+(?:dc|regulated)\s+power\s+supply\b/.test(normalizedPrompt)
      || explicitStandaloneMotorSupply)) {
    counts.set("dc-supply", Math.max(counts.get("dc-supply") ?? 0, 1));
  }
  return counts;
}
