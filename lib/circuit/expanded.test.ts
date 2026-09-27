import test from "node:test";
import assert from "node:assert/strict";
import { EXPANDED_COMPONENTS } from "./parts.ts";
import { INTERNAL_COMPONENT_CATALOG, componentMatchesSearch, simulationCapability } from "./catalog.ts";
import { safeParseCircuitProject } from "./schema.ts";
import { createDefaultBlinkProject } from "./default-project.ts";
import { componentSize, pinPosition } from "../schematic/geometry.ts";
import { discoverLibraryCandidates, selectGenerationComponents } from "./discovery.ts";

test("20 verified entries retain distinct pins, documented variants, and reusable layouts", () => {
  assert.equal(Object.keys(EXPANDED_COMPONENTS).length, 20);
  assert.equal(Object.values(EXPANDED_COMPONENTS).filter(p => simulationCapability(p) === "simulated").length, 20);
  for (const part of Object.values(EXPANDED_COMPONENTS)) {
    assert.ok(part.metadata?.manufacturer && part.metadata.variant && part.metadata.documentation.length);
    assert.equal(new Set(part.pins.map(p => p.id)).size, part.pins.length);
    assert.equal(new Set(part.pins.map(p => p.number)).size, part.pins.length);
    const size = componentSize(part.id);
    assert.equal(size.height, part.height);
    for (const pin of part.pins) {
      const point = pinPosition({ type: part.id, x: 0, y: 0 }, pin.id, part)!;
      assert.ok(point.x >= 0 && point.x <= size.width && point.y >= 0 && point.y <= size.height);
    }
    for (const supply of part.metadata!.supplies) for (const pin of supply.pins) assert.ok(part.pins.some(p => p.id === pin), pin);
    const project = createDefaultBlinkProject();
    project.components.push({ id: "new-part", type: part.id, label: part.displayName, x: 700, y: 0 });
    const parsed = safeParseCircuitProject(JSON.parse(JSON.stringify(project)));
    assert.equal(parsed.success, true, part.id);
  }
});
test("search finds interfaces, manufacturer, aliases, and library names", () => {
  for (const [id, query] of [["rfm95w", "LoRa"], ["xbee-s2c-zigbee-th", "Zigbee"], ["bq76920", "BMS"], ["ds18b20", "DallasTemperature"], ["cd74hc4067", "demux"], ["bme280", "Bosch I2C"]]) assert.ok(componentMatchesSearch(INTERNAL_COMPONENT_CATALOG[id], query));
});
test("AI catalog retrieval includes only simulated parts and library discovery only produces review candidates", () => {
  assert.ok(selectGenerationComponents("LoRa RFM95W", "simulation").some(p => p.id === "rfm95w"));
  assert.ok(selectGenerationComponents("LoRa RFM95W", "simulation").every(p => simulationCapability(p) !== "unavailable"));
  assert.ok(selectGenerationComponents("CD74HC4067 mux", "simulation").some(p => p.id === "cd74hc4067"));
  const candidates = discoverLibraryCandidates({ libraries: [{ name: "LoRa", version: "1" }, { name: "LoRa", version: "2" }, { name: "Math" }] }, "lora");
  assert.equal(candidates.length, 1); assert.deepEqual(candidates[0].versions, ["1", "2"]); assert.equal(candidates[0].reviewStatus, "needs-hardware-review");
});

test("generic motor-driver requests retrieve one driver while explicit requests keep the named part", () => {
  const generic = selectGenerationComponents("Build a room controller with a BME280, LCD, DC fan, and one motor driver", "simulation").map(part => part.id);
  assert.equal(generic.filter(id => ["l293d", "tb6612fng", "drv8833", "l298"].includes(id)).length, 1);
  assert.ok(generic.includes("l293d"));

  const explicit = selectGenerationComponents("Build a room controller with a BME280, LCD, DC fan, and TB6612FNG motor driver", "simulation").map(part => part.id);
  assert.ok(explicit.includes("tb6612fng"));
  assert.equal(explicit.filter(id => ["l293d", "tb6612fng", "drv8833", "l298"].includes(id)).length, 1);
});
