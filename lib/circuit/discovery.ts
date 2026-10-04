import { COMPONENT_CATALOG, componentMatchesSearch, simulationCapability, type ComponentDefinition } from "./catalog.ts";

export type GenerationTarget = "simulation";
const essentials = ["arduino-uno", "ground", "resistor", "led"];
/** Retrieve a bounded catalog slice; exact requested parts and current parts win. */
export function selectGenerationComponents(prompt: string, target: GenerationTarget, currentTypes: string[] = []): ComponentDefinition[] {
  const tokens = prompt.toLowerCase().match(/[a-z0-9][a-z0-9-]*/g) ?? [];
  const scored = Object.values(COMPONENT_CATALOG)
    .filter(part => simulationCapability(part) !== "unavailable")
    .map(part => ({ part, score: tokens.reduce((sum, token) => sum + (token.length > 2 && componentMatchesSearch(part, token) ? (part.id === token ? 100 : 1) : 0), 0) }))
    .filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.part.id.localeCompare(b.part.id));
  const ids = new Set([...essentials, ...currentTypes]);
  const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const requested = ` ${normalize(prompt)} `;
  const genericAliases = new Set(["sensor", "sensors", "pressure", "temperature", "humidity", "mux", "multiplexer", "wireless", "radio", "i2c", "spi", "uart", "module", "chip", "driver", "motor driver", "motor drivers", "h bridge", "h bridges", "battery", "power"]);
  const explicitlyRequested = new Set<string>();
  // Explicit hardware names must survive scoring, including "DC supply" in a
  // long prompt dominated by sensor and bus keywords.
  for (const part of Object.values(COMPONENT_CATALOG)) {
    const names = [part.id, part.displayName, ...(part.requestAliases ?? []), ...(part.metadata?.aliases ?? []).filter(alias => !genericAliases.has(normalize(alias)))];
    if (names.some(name => requested.includes(` ${normalize(name)} `))) {
      explicitlyRequested.add(part.id);
      ids.add(part.id);
    }
  }
  const normalizedPrompt = normalize(prompt);
  const explicitStandaloneMotorSupply = /\b(?:(?:separate|external|regulated|bench|adjustable|dedicated)\s+){1,3}(?:(?:dc|motor|fan|actuator|power)\s+){0,3}(?:power\s+)?supply\b|\b(?:motor|fan|actuator)\s+(?:power\s+)?supply\b/.test(normalizedPrompt);
  if (COMPONENT_CATALOG["dc-supply"]
    && (/\b(?:(?:separate|external|regulated|bench)\s+)*(?:5v|5\s+v|five\s+volt)(?:\s+dc)?\s+(?:power\s+)?supply\b|\b(?:separate|external|bench)\s+(?:dc|regulated)\s+power\s+supply\b/.test(normalizedPrompt)
      || explicitStandaloneMotorSupply)) {
    explicitlyRequested.add("dc-supply");
    ids.add("dc-supply");
  }
  const explicitlyNamedHardware = [...explicitlyRequested].filter(id => !essentials.includes(id));
  // Keep broad discovery for open-ended prompts, but when a user names actual
  // parts, avoid sending unrelated catalog entries and their APIs to Gemini.
  if (explicitlyNamedHardware.length === 0) scored.slice(0, 16).forEach(({ part }) => ids.add(part.id));
  if (/motor|fan|car|robot|driver|bridge/i.test(prompt)) {
    ids.add("dc-motor");
    const driverTypes = ["l293d", "tb6612fng", "drv8833", "l298"];
    const requestedDrivers = driverTypes.filter(id => explicitlyRequested.has(id));
    const selectedDrivers = requestedDrivers.length ? requestedDrivers : ["l293d"];
    // Generic phrases such as "a motor driver" must not retrieve every
    // supported bridge and invite the model to emit several alternatives.
    for (const id of driverTypes) {
      if (!selectedDrivers.includes(id) && !currentTypes.includes(id)) ids.delete(id);
    }
    selectedDrivers.forEach(id => ids.add(id));
  }
  if (/lcd|display/i.test(prompt)) ids.add("lcd-16x2");
  if (/button|mute/i.test(prompt)) ids.add("push-button");
  if (/temperature/i.test(prompt) && ![...explicitlyRequested].some(id => ["bme280", "bmp280", "sht31-dis", "dht22", "ds18b20", "mpu-6050", "temperature-sensor"].includes(id))) ids.add("temperature-sensor");
  return [...ids].map(id => COMPONENT_CATALOG[id]).filter(part => part && (simulationCapability(part) !== "unavailable"));
}

/** Import metadata as review candidates only; never publish libraries as parts. */
export function discoverLibraryCandidates(index: { libraries?: { name: string; website?: string; sentence?: string; version?: string; category?: string }[] }, query: string) {
  const groups = new Map<string, { name: string; url: string; summary: string; versions: string[]; reviewStatus: "needs-hardware-review" }>();
  for (const library of index.libraries ?? []) {
    if (!query.trim() || !`${library.name} ${library.sentence ?? ""}`.toLowerCase().includes(query.toLowerCase().trim())) continue;
    const id = library.name.toLowerCase();
    const candidate = groups.get(id) ?? { name: library.name, url: library.website ?? "", summary: library.sentence ?? "", versions: [], reviewStatus: "needs-hardware-review" as const };
    if (library.version && !candidate.versions.includes(library.version)) candidate.versions.push(library.version);
    groups.set(id, candidate);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}
