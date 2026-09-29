import assert from "node:assert/strict";
import test from "node:test";
import { BOARD_COMPONENTS, BOARD_IDS, BOARD_PROFILES, isBoardAnalogPin, isBoardDigitalOutputPin, isBoardPin, isBoardPwmPin, resolveBoardPin } from "./boards.ts";
import { compileArduinoSketch } from "../simulator/parser.ts";

test("the supported board profiles cover the existing Uno and five named boards", () => {
  assert.deepEqual(BOARD_IDS, ["arduino-uno", "arduino-mega-2560", "arduino-nano-classic", "esp32-devkitc-v4", "esp8266-nodemcu-v1", "raspberry-pi-pico"]);
  for (const id of BOARD_IDS) {
    assert.ok(BOARD_PROFILES[id].ioPins.length > 0, `${id} has no I/O pins`);
    assert.ok(BOARD_PROFILES[id].documentation.startsWith("https://"), `${id} has no documentation source`);
  }
});

test("AVR board pin maps retain analog aliases and board-specific capabilities", () => {
  assert.equal(resolveBoardPin("arduino-uno", "A5"), 19);
  assert.equal(resolveBoardPin("arduino-mega-2560", "A15"), 69);
  assert.equal(resolveBoardPin("arduino-mega-2560", "D53"), 53);
  assert.equal(isBoardPwmPin("arduino-mega-2560", 46), true);
  assert.equal(isBoardPwmPin("arduino-mega-2560", 47), false);
  assert.equal(resolveBoardPin("arduino-nano-classic", "A7"), 21);
  assert.equal(isBoardAnalogPin("arduino-nano-classic", 21), true);
  assert.equal(isBoardDigitalOutputPin("arduino-nano-classic", 21), false);
});

test("ESP profiles map silkscreen pins, reserve flash pins, and enforce input-only pins", () => {
  assert.equal(resolveBoardPin("esp32-devkitc-v4", "GPIO21"), 21);
  assert.equal(isBoardPin("esp32-devkitc-v4", 6), false);
  assert.equal(isBoardDigitalOutputPin("esp32-devkitc-v4", 34), false);
  assert.equal(isBoardPwmPin("esp32-devkitc-v4", 25), true);
  assert.equal(resolveBoardPin("esp8266-nodemcu-v1", "D1"), 5);
  assert.equal(resolveBoardPin("esp8266-nodemcu-v1", "D5"), 14);
  assert.equal(resolveBoardPin("esp8266-nodemcu-v1", "A0"), 17);
});

test("registered board terminals all sit on side headers, not floating top or bottom rows", () => {
  for (const boardId of BOARD_IDS.filter(id => id !== "arduino-uno")) {
    const component = BOARD_COMPONENTS[boardId];
    assert.ok(component, `${boardId} has a catalog definition`);
    assert.ok(component.pins.length > 0, `${boardId} exposes connector pins`);
    for (const pin of component.pins) {
      assert.ok(pin.side === "left" || pin.side === "right", `${boardId}.${pin.id} is on a side header, got ${pin.side}`);
    }
    const expected = [
      ...BOARD_PROFILES[boardId].ioPins.filter(pin => pin.runtimePin >= 0 && !pin.onboard).map(pin => pin.id),
      ...Object.keys(BOARD_PROFILES[boardId].rails),
      ...BOARD_PROFILES[boardId].groundPins,
    ].sort();
    assert.deepEqual(component.pins.map(pin => pin.id).sort(), expected, `${boardId} keeps every pin ID exactly once`);
  }
});

test("ESP32 DevKitC power and ground pins occupy their documented J2 and J3 header positions", () => {
  const pins = BOARD_COMPONENTS["esp32-devkitc-v4"].pins;
  const row = (side: "left" | "right") => pins.filter(pin => pin.side === side).sort((a, b) => a.order - b.order).map(pin => pin.id);
  assert.deepEqual(row("left"), ["3V3", "GPIO36", "GPIO39", "GPIO34", "GPIO35", "GPIO32", "GPIO33", "GPIO25", "GPIO26", "GPIO27", "GPIO14", "GPIO12", "GND", "GPIO13", "GPIO9", "GPIO10", "GPIO11", "5V"]);
  assert.deepEqual(row("right"), ["GND2", "GPIO23", "GPIO22", "GPIO1", "GPIO3", "GPIO21", "GND3", "GPIO19", "GPIO18", "GPIO5", "GPIO17", "GPIO16", "GPIO4", "GPIO0", "GPIO2", "GPIO15", "GPIO8", "GPIO7", "GPIO6"]);
  assert.equal(new Set(pins.map(pin => pin.id)).size, pins.length, "all electrical endpoints remain uniquely addressable");
});

test("Pico exposes only header GPIOs plus its onboard LED and ADC pins", () => {
  assert.equal(resolveBoardPin("raspberry-pi-pico", "GP0"), 0);
  assert.equal(resolveBoardPin("raspberry-pi-pico", "GP28"), 28);
  assert.equal(resolveBoardPin("raspberry-pi-pico", "GP25"), 25);
  assert.equal(isBoardAnalogPin("raspberry-pi-pico", 28), true);
  assert.equal(isBoardPin("raspberry-pi-pico", 23), false);
});

test("sketch compilation validates pin operations against the selected board", () => {
  const pico = compileArduinoSketch("void setup(){pinMode(LED_BUILTIN,OUTPUT); digitalWrite(LED_BUILTIN,HIGH);} void loop(){}", "raspberry-pi-pico");
  assert.equal(pico.valid, true, JSON.stringify(pico.diagnostics));
  const esp32 = compileArduinoSketch("void setup(){pinMode(34,OUTPUT);} void loop(){}", "esp32-devkitc-v4");
  assert.equal(esp32.valid, false);
  assert.match(esp32.diagnostics[0]?.message ?? "", /input-only/);
  const nano = compileArduinoSketch("void setup(){pinMode(A7,OUTPUT);} void loop(){}", "arduino-nano-classic");
  assert.equal(nano.valid, false);
  const node = compileArduinoSketch("void setup(){pinMode(D1,OUTPUT); analogWrite(D1,180);} void loop(){}", "esp8266-nodemcu-v1");
  assert.equal(node.valid, true, JSON.stringify(node.diagnostics));
  assert.equal(compileArduinoSketch("void setup(){Serial1.begin(9600);} void loop(){}", "arduino-mega-2560").valid, true);
  assert.ok(compileArduinoSketch("void setup(){Serial1.begin(9600);} void loop(){}", "arduino-uno").diagnostics.some(diagnostic => diagnostic.code === "UART_PORT_UNAVAILABLE"));
});
