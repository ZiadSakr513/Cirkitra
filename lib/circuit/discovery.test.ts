import assert from "node:assert/strict";
import test from "node:test";

import { selectGenerationComponents } from "./discovery.ts";

test("short WS2812B matrix wording selects the contextual matrix part without sibling pixel variants", () => {
  const selected = new Set(selectGenerationComponents(
    "Build an 8x8 WS2812B matrix sign with a 5 V supply and level shifter.",
    "simulation",
  ).map(part => part.id));
  assert.ok(selected.has("ws2812b-matrix-8x8"));
  assert.ok(!selected.has("neopixel-ring-24"));
  assert.ok(!selected.has("ws2812b-strip-8"));
  assert.ok(!selected.has("ws2812b-strip-30"));
  assert.ok(!selected.has("ws2812b-strip-60"));
});

test("keeps multiple explicitly requested addressable-LED variants in one build", () => {
  const selected = new Set(selectGenerationComponents(
    "Build one WS2812B LED Strip · 8 pixels and one NeoPixel Ring · 24 pixels; drive both from separate data pins.",
    "simulation",
  ).map(part => part.id));
  assert.ok(selected.has("ws2812b-strip-8"));
  assert.ok(selected.has("neopixel-ring-24"));
  assert.ok(!selected.has("ws2812b-strip-30"));
  assert.ok(!selected.has("ws2812b-strip-60"));
  assert.ok(!selected.has("ws2812b-matrix-8x8"));
});

test("a negated exact sensor model is not re-selected through a broad environmental alias", () => {
  const selected = new Set(selectGenerationComponents(
    "Build an ambient-light instrument with a VEML7700 lux sensor. Do not add a BH1750 or any other sensor.",
    "simulation",
  ).map(part => part.id));
  assert.ok(selected.has("veml7700-light-sensor"));
  assert.ok(!selected.has("bh1750-sen0097"));
});

test("preserves exact servo and OLED variants in edits, including plural SG90s", () => {
  const arm = new Set(selectGenerationComponents("Edit the arm and preserve all three SG90s", "simulation", ["arduino-uno", "sg90-servo"]).map(part => part.id));
  assert.ok(arm.has("sg90-servo"));
  assert.ok(!arm.has("servo"));
  assert.ok(!arm.has("mg996r-servo"));

  const oled = new Set(selectGenerationComponents("Edit this monitor and keep its OLED", "simulation", ["arduino-uno", "sh1107-oled-128x128"]).map(part => part.id));
  assert.ok(oled.has("sh1107-oled-128x128"));
  assert.ok(!oled.has("ssd1306-oled-128x64"));
});

test("robot-arm discovery does not add potentiometers unless explicitly requested", () => {
  const unspecified = new Set(selectGenerationComponents("Create a five-axis robot arm that moves through a pick-and-place sequence", "simulation").map(part => part.id));
  assert.ok(unspecified.has("servo"));
  assert.ok(!unspecified.has("potentiometer"));

  const requested = new Set(selectGenerationComponents("Create a five-axis robot arm with five potentiometers controlling the joints", "simulation").map(part => part.id));
  assert.ok(requested.has("potentiometer"));
});

test("discovers capacitors written with spaced or Unicode microfarad units", () => {
  for (const prompt of ["Use a 1 uF capacitor for timing.", "Use a 1 µF capacitor for timing."]) {
    const selected = new Set(selectGenerationComponents(prompt, "simulation").map(part => part.id));
    assert.ok(selected.has("capacitor-1uf"), prompt);
    assert.ok(!selected.has("electrolytic-capacitor-100uf"), prompt);
  }
  const bulk = new Set(selectGenerationComponents("Add a bulk capacitor across the supply rails.", "simulation").map(part => part.id));
  assert.ok(bulk.has("electrolytic-capacitor-100uf"));
  assert.ok(!bulk.has("capacitor-1uf"));
  const generic = new Set(selectGenerationComponents("Add one capacitor across the supply rails.", "simulation").map(part => part.id));
  assert.ok(generic.has("capacitor-1uf"));
  assert.ok(!generic.has("electrolytic-capacitor-100uf"));
});

test("selects one exact MOSFET and IR receiver variant instead of its broad-alias sibling", () => {
  const ideal = new Set(selectGenerationComponents("Use the ideal-mosfet to switch the DC load.", "simulation").map(part => part.id));
  assert.ok(ideal.has("ideal-mosfet"));
  assert.ok(!ideal.has("n-mosfet-2n7000"));

  const discrete = new Set(selectGenerationComponents("Use a 2N7000 N-MOSFET as a low-side switch.", "simulation").map(part => part.id));
  assert.ok(discrete.has("n-mosfet-2n7000"));
  assert.ok(!discrete.has("ideal-mosfet"));

  const vs1838 = new Set(selectGenerationComponents("Use a VS1838B IR receiver module.", "simulation").map(part => part.id));
  assert.ok(vs1838.has("vs1838b-ir-receiver-module"));
  assert.ok(!vs1838.has("tsop4838-ir-receiver"));

  const tsop = new Set(selectGenerationComponents("Use a TSOP4838 IR receiver.", "simulation").map(part => part.id));
  assert.ok(tsop.has("tsop4838-ir-receiver"));
  assert.ok(!tsop.has("vs1838b-ir-receiver-module"));
});

test("an explicit OLED controller selects only its requested physical variant", () => {
  for (const [prompt, selected, excluded] of [
    ["Use an SH1107 128x128 OLED", "sh1107-oled-128x128", "ssd1306-oled-128x64"],
    ["Use an SSD1306 128x64 OLED", "ssd1306-oled-128x64", "sh1107-oled-128x128"],
  ] as const) {
    const ids = new Set(selectGenerationComponents(prompt, "simulation").map(part => part.id));
    assert.ok(ids.has(selected), prompt);
    assert.ok(!ids.has(excluded), prompt);
  }
});

test("generation selects only the named board profile, including each new ESP32 variant", () => {
  const cases = [
    ["Use the ESP32 NodeMCU-32S board profile", "esp32-nodemcu-32s"],
    ["Use the 30-pin ESP32 DevKit V1 profile", "esp32-devkit-v1-30pin"],
    ["Use the XIAO ESP32-S3 Sense board profile", "xiao-esp32s3-sense"],
    ["Use the Freenove ESP32-S3-WROOM board profile", "freenove-esp32s3-wroom"],
  ] as const;
  const boardIds = ["arduino-uno", "arduino-mega-2560", "arduino-nano-classic", "esp32-devkitc-v4", "esp8266-nodemcu-v1", "raspberry-pi-pico", "esp32-nodemcu-32s", "esp32-devkit-v1-30pin", "xiao-esp32s3-sense", "freenove-esp32s3-wroom"];
  for (const [prompt, expected] of cases) {
    const selectedBoards = selectGenerationComponents(prompt, "simulation").map(part => part.id).filter(id => boardIds.includes(id));
    assert.deepEqual(selectedBoards, [expected], prompt);
  }
});
