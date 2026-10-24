import assert from "node:assert/strict";
import test from "node:test";

import { COMPONENT_CATALOG } from "../../../../lib/circuit/catalog.ts";
import { selectGenerationComponents } from "../../../../lib/circuit/discovery.ts";
import { requestedComponentCounts } from "./component-requirements.ts";

const definitions = Object.values(COMPONENT_CATALOG);

test("specific component models do not also require their embedded generic part", () => {
  for (const [specific, generic] of [
    ["ds18b20-waterproof", "ds18b20"],
    ["mpu-6050-breakout", "mpu-6050"],
    ["mg996r-servo", "servo"],
    ["sg90-servo", "servo"],
  ]) {
    const counts = requestedComponentCounts(`Use one ${specific}.`, definitions);
    assert.equal(counts.get(specific), 1);
    assert.equal(counts.has(generic), false, `${specific} must not require an extra ${generic}`);
  }
  const mixed = requestedComponentCounts("Use two MG996R servos and one servo.", definitions);
  assert.equal(mixed.get("mg996r-servo"), 2);
  assert.equal(mixed.get("servo"), 1);
});

test("counts explicit part quantities without treating board model numbers as quantities", () => {
  const counts = requestedComponentCounts("Use an Arduino Mega 2560, two LEDs, and one BME280 sensor.", definitions);
  assert.equal(counts.get("led"), 2);
  assert.equal(counts.get("bme280"), 1);
  assert.equal(counts.has("resistor"), false);
});

test("distinguishes addressable strip pixels from individually requested LEDs", () => {
  const stripOnly = requestedComponentCounts("Use one WS2812B LED strip with 8 LEDs.", definitions);
  assert.equal(stripOnly.get("ws2812b-strip-8"), 1);
  assert.equal(stripOnly.has("led"), false);

  const mixed = requestedComponentCounts("Use one LED and one WS2812B LED strip with 8 LEDs.", definitions);
  assert.equal(mixed.get("led"), 1);
  assert.equal(mixed.get("ws2812b-strip-8"), 1);

  const patternController = requestedComponentCounts("Create an ESP32 LED-pattern controller with a WS2812B strip.", definitions);
  assert.equal(patternController.has("led"), false, "the addressable strip itself satisfies a generic LED-pattern request");
  const indicator = requestedComponentCounts("Add one separate indicator LED beside a NeoPixel strip.", definitions);
  assert.equal(indicator.get("led"), 1, "an explicitly separate indicator LED remains required");
});

test("treats an RGB LED as its own component instead of also requiring a discrete LED", () => {
  const rgbOnly = requestedComponentCounts("Use one common-cathode RGB LED with a resistor on each color.", definitions);
  assert.equal(rgbOnly.get("rgb-led"), 1);
  assert.equal(rgbOnly.has("led"), false);

  const rgbWithIndicator = requestedComponentCounts("Use one RGB LED and one separate status LED.", definitions);
  assert.equal(rgbWithIndicator.get("rgb-led"), 1);
  assert.equal(rgbWithIndicator.get("led"), 1);
});

test("resolves the common SHT31 model name to the supported SHT31-DIS part", () => {
  const prompt = "Build an I2C sensor with one SHT31 and an Arduino Uno.";
  assert.ok(selectGenerationComponents(prompt, "simulation").some(part => part.id === "sht31-dis"));
  assert.equal(requestedComponentCounts(prompt, definitions).get("sht31-dis"), 1);
});

test("a specifically named GY-BME/P280 breakout does not also require the bare BME280 chip", () => {
  const counts = requestedComponentCounts(
    "Use exactly one GY-BME/P280 BME280 breakout, not the bare-chip BME280.",
    definitions,
  );
  assert.equal(counts.get("bme280-gy-bme-p280"), 1);
  assert.equal(counts.has("bme280"), false);
});

test("matches capacitor values written as spaced or Unicode microfarads", () => {
  for (const prompt of [
    "Use a 1 uF timing capacitor.",
    "Use a 1 µF timing capacitor.",
  ]) {
    assert.equal(requestedComponentCounts(prompt, definitions).get("capacitor-1uf"), 1, prompt);
  }
  assert.equal(requestedComponentCounts("Add a 100 µF electrolytic capacitor.", definitions).get("electrolytic-capacitor-100uf"), 1);
  assert.equal(requestedComponentCounts("Add one capacitor across the supply rails.", definitions).get("capacitor-1uf"), 1);
  assert.equal(requestedComponentCounts("Add a bulk capacitor across the supply rails.", definitions).get("electrolytic-capacitor-100uf"), 1);
});

test("counts exact MOSFET and IR receiver variants without broad-alias siblings", () => {
  const idealMosfet = requestedComponentCounts("Switch the load with an ideal-mosfet.", definitions);
  assert.equal(idealMosfet.get("ideal-mosfet"), 1);
  assert.equal(idealMosfet.has("n-mosfet-2n7000"), false);

  const nmos = requestedComponentCounts("Use a 2N7000 N-MOSFET to switch the load.", definitions);
  assert.equal(nmos.get("n-mosfet-2n7000"), 1);
  assert.equal(nmos.has("ideal-mosfet"), false);

  const bothMosfets = requestedComponentCounts("Use an ideal MOSFET and one 2N7000 N-MOSFET.", definitions);
  assert.equal(bothMosfets.get("ideal-mosfet"), 1);
  assert.equal(bothMosfets.get("n-mosfet-2n7000"), 1);

  const vs1838 = requestedComponentCounts("Use a VS1838B IR receiver module.", definitions);
  assert.equal(vs1838.get("vs1838b-ir-receiver-module"), 1);
  assert.equal(vs1838.has("tsop4838-ir-receiver"), false);

  const tsop = requestedComponentCounts("Use a TSOP4838 IR receiver.", definitions);
  assert.equal(tsop.get("tsop4838-ir-receiver"), 1);
  assert.equal(tsop.has("vs1838b-ir-receiver-module"), false);
});

test("recognizes explicit ground symbols and separate motor supplies", () => {
  assert.equal(requestedComponentCounts("Connect all grounds and share a common ground.", definitions).has("ground"), false);
  assert.equal(requestedComponentCounts("Add one Ground symbol to the circuit.", definitions).get("ground"), 1);

  const prompt = "Use a DC motor with a separate adjustable motor supply.";
  assert.equal(requestedComponentCounts(prompt, definitions).get("dc-supply"), 1);
  assert.ok(selectGenerationComponents(prompt, "simulation").some(part => part.id === "dc-supply"));
});

test("selects and counts natural-language ultrasonic sensor requests", () => {
  for (const [prompt, count] of [
    ["create an ESP32 robot car with ultrasonic sensor", 1],
    ["Build a rover with two sonar sensors", 2],
  ] as const) {
    const selected = selectGenerationComponents(prompt, "simulation");
    assert.ok(selected.some(part => part.id === "hc-sr04"), `catalog slice should include HC-SR04 for: ${prompt}`);
    assert.equal(requestedComponentCounts(prompt, definitions).get("hc-sr04"), count);
  }
});

test("does not mistake ordinary conjunctions for requested logic gates", () => {
  const prompt = "Set the distance threshold and gate mode, then enable the motor or buzzer as needed.";
  const counts = requestedComponentCounts(prompt, definitions);
  assert.equal(counts.has("logic-and"), false);
  assert.equal(counts.has("logic-or"), false);
});

test("counts logic gates when explicitly requested", () => {
  const counts = requestedComponentCounts("Add an AND gate and one OR gate to combine the two sensor inputs.", definitions);
  assert.equal(counts.get("logic-and"), 1);
  assert.equal(counts.get("logic-or"), 1);
});
