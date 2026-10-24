import { COMPONENT_CATALOG, componentMatchesSearch, simulationCapability, type ComponentDefinition } from "./catalog.ts";
import { BOARD_IDS, isBoardType } from "./boards.ts";

export type GenerationTarget = "simulation";
const essentials = ["arduino-uno", "ground", "resistor", "led"];
const boardRequestAliases: Record<string, string[]> = {
  "arduino-uno": ["arduino uno", "uno rev3"],
  "arduino-mega-2560": ["arduino mega 2560", "mega 2560"],
  "arduino-nano-classic": ["arduino nano", "nano v3", "classic nano"],
  "esp32-devkitc-v4": ["esp32 devkitc v4", "esp32 devkit c v4"],
  "esp8266-nodemcu-v1": ["esp8266 nodemcu", "esp8266 nodemcu v1"],
  "raspberry-pi-pico": ["raspberry pi pico", "pico rp2040"],
  "esp32-nodemcu-32s": ["esp32 nodemcu 32s", "nodemcu 32s"],
  "esp32-devkit-v1-30pin": ["30 pin esp32 devkit v1", "esp32 devkit v1 30 pin", "doit esp32 devkit v1"],
  "xiao-esp32s3-sense": ["xiao esp32 s3 sense", "xiao esp32s3 sense"],
  "freenove-esp32s3-wroom": ["freenove esp32 s3 wroom", "freenove esp32s3 wroom"],
};
const normalize = (text: string) => text.toLowerCase()
  .replace(/[µμ]/g, "u")
  .replace(/don't/g, "dont")
  .replace(/(\d)\s+(?=u?f\b)/g, "$1")
  .replace(/[^a-z0-9]+/g, " ").trim();
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function containsPhrase(prompt: string, value: string): boolean {
  const normalized = normalize(value);
  if (!normalized) return false;
  const phrase = escapeRegex(normalized).replace(/\s+/g, "\\s+");
  return new RegExp(`(?:^|\\s)${phrase}(?:s)?(?=\\s|$)`).test(prompt);
}
function negatesPhrase(prompt: string, value: string): boolean {
  const normalized = normalize(value);
  if (!normalized) return false;
  const phrase = escapeRegex(normalized).replace(/\s+/g, "\\s+");
  const namedPart = `(?:a|an|the|any)?\\s*${phrase}(?:s)?(?=\\s|$)`;
  return new RegExp(`(?:^|\\s)(?:do\\s+not|dont|never)\\s+(?:(?:add|include|use|select|want|need|require)\\s+)?${namedPart}`).test(prompt)
    || new RegExp(`(?:^|\\s)(?:avoid|exclude|omit|without|not)\\s+${namedPart}`).test(prompt);
}
/** Retrieve a bounded catalog slice; exact requested parts and current parts win. */
export function selectGenerationComponents(prompt: string, target: GenerationTarget, currentTypes: string[] = []): ComponentDefinition[] {
  const tokens = prompt.toLowerCase().match(/[a-z0-9][a-z0-9-]*/g) ?? [];
  const scored = Object.values(COMPONENT_CATALOG)
    .filter(part => simulationCapability(part) !== "unavailable")
    .map(part => ({ part, score: tokens.reduce((sum, token) => sum + (token.length > 2 && componentMatchesSearch(part, token) ? (part.id === token ? 100 : 1) : 0), 0) }))
    .filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.part.id.localeCompare(b.part.id));
  const ids = new Set([...essentials, ...currentTypes]);
  const requested = normalize(prompt);
  const genericAliases = new Set(["sensor", "sensors", "pressure", "temperature", "humidity", "temperature humidity", "temperature and humidity", "pressure humidity temperature", "environment", "lux", "light sensor", "ambient light", "air quality", "presence sensor", "radar", "clock", "stepper", "stepper motor", "stepper driver", "motor", "servo", "mosfet", "ir receiver", "infrared receiver", "mux", "multiplexer", "wireless", "radio", "i2c", "spi", "uart", "module", "chip", "driver", "motor driver", "motor drivers", "h bridge", "h bridges", "battery", "power"]);
  const explicitlyRequested = new Set<string>();
  // Explicit hardware names must survive scoring, including "DC supply" in a
  // long prompt dominated by sensor and bus keywords.
  for (const part of Object.values(COMPONENT_CATALOG)) {
    const names = isBoardType(part.id)
      ? boardRequestAliases[part.id] ?? []
      : [part.id, part.displayName, ...(part.requestAliases ?? []).filter(alias => !genericAliases.has(normalize(alias))), ...(part.metadata?.aliases ?? []).filter(alias => !genericAliases.has(normalize(alias)))];
    const specificNames = [part.id, part.displayName, ...(part.requestAliases ?? []), ...(part.metadata?.aliases ?? [])]
      .filter(name => normalize(name).length >= 4);
    if (specificNames.some(name => negatesPhrase(requested, name))) continue;
    if (names.some(name => containsPhrase(requested, name))) {
      explicitlyRequested.add(part.id);
      ids.add(part.id);
    }
  }
  const normalizedPrompt = requested;

  const pixelVariants = ["ws2812b-strip-8", "ws2812b-strip-30", "ws2812b-strip-60", "neopixel-ring-24", "ws2812b-matrix-8x8"];
  const servoVariants = ["servo", "sg90-servo", "mg996r-servo"];
  const oledVariants = ["ssd1306-oled-128x64", "sh1107-oled-128x128"];
  const stepperMotorVariants = ["bipolar-stepper-motor", "stepper-28byj-48", "nema17-stepper-17hs4401s"];
  const stepperDriverVariants = ["a4988-stepper-driver", "tmc2209-stepper-driver", "uln2003-stepper-driver"];
  const bme280Variants = ["bme280", "bme280-gy-bme-p280"];
  const ds18b20Variants = ["ds18b20", "ds18b20-waterproof"];
  const ambientLightVariants = ["bh1750-sen0097", "veml7700-light-sensor"];
  const motionRadarVariants = ["rcwl-0516-microwave-radar", "ld2410c-mmwave-radar"];
  const imuVariants = ["mpu-6050", "mpu-6050-breakout"];
  const matrixVariants = ["max7219-8x8-matrix", "ws2812b-matrix-8x8"];
  const l298Variants = ["l298", "l298n-driver-module"];
  const keepVariants = (group: string[], preferred: string[] = []) => {
    const explicit = group.filter(id => explicitlyRequested.has(id));
    const exactExplicit = group.filter(id => {
      const part = COMPONENT_CATALOG[id];
      return part && [id, part.displayName].some(name => containsPhrase(requested, name));
    });
    const existing = group.filter(id => currentTypes.includes(id));
    // A user can explicitly request multiple sibling variants in one build
    // (for example an 8-pixel strip and a 24-pixel ring). Variant inference
    // should disambiguate a single generic request, not erase other exact
    // hardware names the request also contains.
    const keep = exactExplicit.length > 1 ? exactExplicit
      : preferred.length ? [...new Set([...preferred, ...exactExplicit])]
        : exactExplicit.length ? exactExplicit : existing.length ? existing : explicit;
    if (!keep.length) return;
    for (const id of group) if (!keep.includes(id)) ids.delete(id);
    keep.forEach(id => ids.add(id));
    for (const id of group) if (!keep.includes(id)) explicitlyRequested.delete(id);
  };

  let pixelVariant: string | undefined;
  if (/\b(?:ws2812b?|neopixel|addressable)\b/.test(normalizedPrompt)) {
    if (/\bmatrix\b|\b8\s*(?:x|by)\s*8\b/.test(normalizedPrompt)) pixelVariant = "ws2812b-matrix-8x8";
    else if (/\bring\b/.test(normalizedPrompt)) pixelVariant = "neopixel-ring-24";
    else if (/\bstrip\b/.test(normalizedPrompt)) {
      if (/\b60\b/.test(normalizedPrompt)) pixelVariant = "ws2812b-strip-60";
      else if (/\b30\b/.test(normalizedPrompt)) pixelVariant = "ws2812b-strip-30";
      else pixelVariant = "ws2812b-strip-8";
    }
  }
  if (pixelVariant) explicitlyRequested.add(pixelVariant);
  keepVariants(pixelVariants, pixelVariant ? [pixelVariant] : []);

  const robotArmPrompt = /\b(?:robot(?:ic)?\s+arm|manipulator)\b/.test(normalizedPrompt);
  let servoVariant: string | undefined;
  if (containsPhrase(normalizedPrompt, "mg996r")) servoVariant = "mg996r-servo";
  else if (containsPhrase(normalizedPrompt, "sg90")) servoVariant = "sg90-servo";
  else if (robotArmPrompt && !servoVariants.some(id => currentTypes.includes(id))) servoVariant = "servo";
  if (servoVariant) explicitlyRequested.add(servoVariant);
  keepVariants(servoVariants, servoVariant ? [servoVariant] : []);

  let oledVariant: string | undefined;
  if (/\bsh1107\b|\b128\s*x\s*128\b/.test(normalizedPrompt)) oledVariant = "sh1107-oled-128x128";
  else if (/\bssd1306\b|\b128\s*x\s*64\b/.test(normalizedPrompt)) oledVariant = "ssd1306-oled-128x64";
  if (oledVariant) explicitlyRequested.add(oledVariant);
  keepVariants(oledVariants, oledVariant ? [oledVariant] : []);

  let bme280Variant: string | undefined;
  if (/\b(?:gy\s+bme|p280)\b|\bbme280\s+(?:gy\s+)?breakout\b/.test(normalizedPrompt)) bme280Variant = "bme280-gy-bme-p280";
  else if (containsPhrase(normalizedPrompt, "bme280")) bme280Variant = "bme280";
  if (bme280Variant) explicitlyRequested.add(bme280Variant);
  keepVariants(bme280Variants, bme280Variant ? [bme280Variant] : []);

  let ds18b20Variant: string | undefined;
  if (/\bwaterproof\s+ds18b20\b|\bds18b20\s+waterproof\b|\bds18b20\s+probe\b/.test(normalizedPrompt)) ds18b20Variant = "ds18b20-waterproof";
  else if (containsPhrase(normalizedPrompt, "ds18b20")) ds18b20Variant = "ds18b20";
  if (ds18b20Variant) explicitlyRequested.add(ds18b20Variant);
  keepVariants(ds18b20Variants, ds18b20Variant ? [ds18b20Variant] : []);

  const lightVariant = containsPhrase(normalizedPrompt, "veml7700") ? "veml7700-light-sensor"
    : containsPhrase(normalizedPrompt, "bh1750") ? "bh1750-sen0097" : undefined;
  if (lightVariant) explicitlyRequested.add(lightVariant);
  keepVariants(ambientLightVariants, lightVariant ? [lightVariant] : []);

  const radarVariantsRequested = [
    ...(containsPhrase(normalizedPrompt, "rcwl-0516") ? ["rcwl-0516-microwave-radar"] : []),
    ...(containsPhrase(normalizedPrompt, "ld2410c") ? ["ld2410c-mmwave-radar"] : []),
  ];
  radarVariantsRequested.forEach(id => explicitlyRequested.add(id));
  keepVariants(motionRadarVariants, radarVariantsRequested);

  let imuVariant: string | undefined;
  if (/\bgy\s*521\b|\bmpu\s*6050\s+breakout\b/.test(normalizedPrompt)) imuVariant = "mpu-6050-breakout";
  else if (containsPhrase(normalizedPrompt, "mpu-6050")) imuVariant = "mpu-6050";
  if (imuVariant) explicitlyRequested.add(imuVariant);
  keepVariants(imuVariants, imuVariant ? [imuVariant] : []);

  let matrixVariant: string | undefined;
  if (/\bmax7219\b/.test(normalizedPrompt)) matrixVariant = "max7219-8x8-matrix";
  else if (/\b(?:ws2812b|neopixel)\b/.test(normalizedPrompt) && /\bmatrix\b|\b8\s*(?:x|by)\s*8\b/.test(normalizedPrompt)) matrixVariant = "ws2812b-matrix-8x8";
  if (matrixVariant) explicitlyRequested.add(matrixVariant);
  keepVariants(matrixVariants, matrixVariant ? [matrixVariant] : []);

  const l298Variant = /\bl298n\b/.test(normalizedPrompt) ? "l298n-driver-module"
    : /\bl298\b/.test(normalizedPrompt) ? "l298" : undefined;
  if (l298Variant) explicitlyRequested.add(l298Variant);
  keepVariants(l298Variants, l298Variant ? [l298Variant] : []);

  const capacitorVariants = ["capacitor-1uf", "electrolytic-capacitor-100uf"];
  const mentionsCapacitor = /\bcapacitors?\b/.test(normalizedPrompt);
  const explicitCapacitors = capacitorVariants.filter(id => explicitlyRequested.has(id));
  const capacitorVariant = /\b(?:electrolytic|bulk|smoothing|reservoir)\s+capacitor\b/.test(normalizedPrompt)
    ? "electrolytic-capacitor-100uf"
    : /\b(?:1\s*u\s*f|1uf|decoupling\s+capacitor|bypass\s+capacitor)\b/.test(normalizedPrompt)
      ? "capacitor-1uf"
      : mentionsCapacitor ? "capacitor-1uf" : undefined;
  if (capacitorVariant) explicitlyRequested.add(capacitorVariant);
  keepVariants(capacitorVariants, [...new Set([...(capacitorVariant ? [capacitorVariant] : []), ...explicitCapacitors])]);

  const mosfetVariants = ["n-mosfet-2n7000", "ideal-mosfet"];
  const explicitIdealMosfet = /\bideal\s+(?:n\s+)?mosfet\b|\bideal\s+n\s*mos\s+switch\b/.test(normalizedPrompt)
    || containsPhrase(normalizedPrompt, "ideal-mosfet");
  const explicitNmos = /\b2n7000\b/.test(normalizedPrompt)
    || (!explicitIdealMosfet && /\bn\s*mosfet\b|\bn\s+channel\s+mosfet\b/.test(normalizedPrompt));
  const mosfetVariant = explicitIdealMosfet && !explicitNmos ? "ideal-mosfet"
    : explicitNmos && !explicitIdealMosfet ? "n-mosfet-2n7000"
      : /\bmosfet\b/.test(normalizedPrompt) && !explicitIdealMosfet ? "n-mosfet-2n7000" : undefined;
  if (mosfetVariant) explicitlyRequested.add(mosfetVariant);
  keepVariants(mosfetVariants, mosfetVariant ? [mosfetVariant] : []);

  const irReceiverVariants = ["tsop4838-ir-receiver", "vs1838b-ir-receiver-module"];
  const explicitTsop = containsPhrase(normalizedPrompt, "tsop4838");
  const explicitVs1838 = containsPhrase(normalizedPrompt, "vs1838b");
  const irReceiverVariant = explicitTsop && !explicitVs1838 ? "tsop4838-ir-receiver"
    : explicitVs1838 && !explicitTsop ? "vs1838b-ir-receiver-module"
      : !explicitTsop && !explicitVs1838 && /\b(?:ir|infrared)\s+receivers?\b/.test(normalizedPrompt)
        ? (/\bmodule\b/.test(normalizedPrompt) ? "vs1838b-ir-receiver-module" : "tsop4838-ir-receiver")
        : undefined;
  if (irReceiverVariant) explicitlyRequested.add(irReceiverVariant);
  keepVariants(irReceiverVariants, irReceiverVariant ? [irReceiverVariant] : []);

  const stepperRequested = /\bstepper\b|\ba4988\b|\btmc2209\b|\buln2003\b/.test(normalizedPrompt);
  const namedStepperMotors = [
    ...( /\b28byj\s*48\b/.test(normalizedPrompt) ? ["stepper-28byj-48"] : [] ),
    ...( /\bnema\s*17\b|\b17hs4401s?\b/.test(normalizedPrompt) ? ["nema17-stepper-17hs4401s"] : [] ),
    ...( /\bbipolar\s+stepper\s+motor\b/.test(normalizedPrompt) ? ["bipolar-stepper-motor"] : [] ),
  ];
  namedStepperMotors.forEach(id => explicitlyRequested.add(id));
  const stepperMotorVariant = namedStepperMotors.length === 1 ? namedStepperMotors[0]
    : namedStepperMotors.length > 1 ? undefined
      : stepperRequested && /\bstepper\s+motor\b/.test(normalizedPrompt) ? "bipolar-stepper-motor" : undefined;
  if (stepperMotorVariant) explicitlyRequested.add(stepperMotorVariant);
  keepVariants(stepperMotorVariants, namedStepperMotors.length > 1 ? namedStepperMotors : stepperMotorVariant ? [stepperMotorVariant] : []);

  const namedStepperDrivers = [
    ...( /\ba4988\b/.test(normalizedPrompt) ? ["a4988-stepper-driver"] : [] ),
    ...( /\btmc2209\b/.test(normalizedPrompt) ? ["tmc2209-stepper-driver"] : [] ),
    ...( /\buln2003\b/.test(normalizedPrompt) ? ["uln2003-stepper-driver"] : [] ),
  ];
  namedStepperDrivers.forEach(id => explicitlyRequested.add(id));
  const stepperDriverVariant = namedStepperDrivers.length === 1 ? namedStepperDrivers[0]
    : namedStepperDrivers.length > 1 ? undefined
      : stepperRequested && /\bstepper\s+driver\b/.test(normalizedPrompt) ? "a4988-stepper-driver" : undefined;
  if (stepperDriverVariant) explicitlyRequested.add(stepperDriverVariant);
  keepVariants(stepperDriverVariants, namedStepperDrivers.length > 1 ? namedStepperDrivers : stepperDriverVariant ? [stepperDriverVariant] : []);
  const explicitlyRequestsDcMotor = /\b(?:dc|brushed|gear)\s+motors?\b/.test(normalizedPrompt);
  if (stepperRequested && !explicitlyRequestsDcMotor && !/\bfans?\b|\bcars?\b|\brovers?\b/.test(normalizedPrompt)) ids.delete("dc-motor");

  const namedBoards = BOARD_IDS.filter(id => explicitlyRequested.has(id));
  const currentBoards = currentTypes.filter(isBoardType);
  const selectedBoards = namedBoards.length ? namedBoards : currentBoards.length ? currentBoards : ["arduino-uno"];
  for (const id of BOARD_IDS) if (!selectedBoards.includes(id)) ids.delete(id);
  selectedBoards.forEach(id => ids.add(id));

  const explicitStandaloneMotorSupply = /\b(?:(?:separate|external|regulated|bench|adjustable|dedicated)\s+){1,3}(?:(?:dc|motor|fan|actuator|power)\s+){0,3}(?:power\s+)?supply\b|\b(?:motor|fan|actuator)\s+(?:power\s+)?supply\b/.test(normalizedPrompt);
  const explicitlyRejectsSupply = /\b(?:no|not|without|dont|never)\b(?:\s+\w+){0,5}\s+(?:dc\s+)?(?:motor\s+)?(?:power\s+)?supply\b/.test(normalizedPrompt);
  if (COMPONENT_CATALOG["dc-supply"]
    && (/\b(?:(?:separate|external|regulated|bench|dedicated)\s+)*(?:5v|5\s+v|five\s+volt)(?:\s+(?:dc|strip|servo|motor|led|pixel|display))?\s+(?:power\s+)?supply\b|\b(?:separate|external|bench)\s+(?:dc|regulated)\s+power\s+supply\b|\b\d+(?:\.\d+)?\s*v(?:\s+dc)?\s+(?:power\s+)?supply\b/.test(normalizedPrompt)
      || explicitStandaloneMotorSupply) && !explicitlyRejectsSupply) {
    explicitlyRequested.add("dc-supply");
    ids.add("dc-supply");
  }
  const explicitlyNamedHardware = [...explicitlyRequested].filter(id => !essentials.includes(id));
  // Keep broad discovery for open-ended prompts, but when a user names actual
  // parts, avoid sending unrelated catalog entries and their APIs to Gemini.
  if (explicitlyNamedHardware.length === 0 && currentTypes.length === 0) scored.slice(0, 16).forEach(({ part }) => ids.add(part.id));
  const requestsDcMotion = explicitlyRequested.has("dc-motor") || /\b(?:dc|brushed|gear)\s+motors?\b|\bfans?\b|\bcars?\b|\brovers?\b/.test(normalizedPrompt);
  const requestsDcBridge = /\b(?:motor\s+driver|h\s+bridge|bridge)\b/.test(normalizedPrompt);
  if (!robotArmPrompt && !stepperRequested && (requestsDcMotion || requestsDcBridge)) {
    ids.add("dc-motor");
    const driverTypes = ["l293d", "tb6612fng", "drv8833", "l298", "l298n-driver-module"];
    const requestedDrivers = driverTypes.filter(id => {
      if (id === "l298" && /\bl298n\b/.test(normalizedPrompt)) return false;
      if (id === "l298n-driver-module" && /\bl298\b/.test(normalizedPrompt) && !/\bl298n\b/.test(normalizedPrompt)) return false;
      const part = COMPONENT_CATALOG[id];
      return part && [id, part.displayName, ...(part.requestAliases ?? []), ...(part.metadata?.aliases ?? [])]
        .filter(name => !genericAliases.has(normalize(name)))
        .some(name => containsPhrase(normalizedPrompt, name));
    });
    const selectedDrivers = requestedDrivers.length ? requestedDrivers : requestsDcBridge || /\bcars?\b|\brovers?\b/.test(normalizedPrompt) ? ["l293d"] : [];
    // Generic phrases such as "a motor driver" must not retrieve every
    // supported bridge and invite the model to emit several alternatives.
    for (const id of driverTypes) {
      if (!selectedDrivers.includes(id) && !currentTypes.includes(id)) ids.delete(id);
    }
    selectedDrivers.forEach(id => ids.add(id));
  }
  const hasSpecificDisplay = [...explicitlyRequested, ...currentTypes].some(id => COMPONENT_CATALOG[id]?.category === "displays" && id !== "lcd-16x2");
  if (/\blcd\b|\bdisplay\b/.test(normalizedPrompt) && !hasSpecificDisplay) ids.add("lcd-16x2");
  if (/button|mute/i.test(prompt)) ids.add("push-button");
  if (/temperature/i.test(normalizedPrompt) && ![...explicitlyRequested, ...currentTypes].some(id => ["bme280", "bme280-gy-bme-p280", "bmp280", "sht31-dis", "dht11", "dht22", "ds18b20", "ds18b20-waterproof", "ntc-thermistor-10k", "temperature-sensor"].includes(id))) ids.add("temperature-sensor");
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
