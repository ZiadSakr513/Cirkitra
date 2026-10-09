import assert from "node:assert/strict";
import test from "node:test";

import { COMPONENT_CATALOG } from "../../../../lib/circuit/catalog.ts";
import { selectGenerationComponents } from "../../../../lib/circuit/discovery.ts";
import { requestedComponentCounts } from "./component-requirements.ts";

const definitions = Object.values(COMPONENT_CATALOG);

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
